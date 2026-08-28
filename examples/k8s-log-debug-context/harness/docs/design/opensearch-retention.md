# OpenSearch ISM retention — approved mechanism

`feat-004` uses the owner-approved OpenSearch ISM policy `log-debug-retention-v1`, not mapping metadata, to retain log records for seven days.

## Scope and evidence

| Claim | Evidence |
|---|---|
| The MVP requires seven-day retention of redacted, opted-in non-production log records. | `docs/assumptions.md:26`; `docs/cross-cutting.md:25` (X-003) |
| The adapter must map and query only sanitized v1 records behind `IndexPort`. | `docs/design/log-debug-context.md:120-127,171-218` |
| ISM policies can attach automatically to matching indexes through `ism_template`; a policy is created at `PUT _plugins/_ism/policies/{id}`. | [OpenSearch ISM API](https://docs.opensearch.org/latest/im-plugin/ism/api/) |
| Composable templates are created or updated at `PUT _index_template/{name}` and apply mappings/settings to matching new indexes. | [OpenSearch index-template API](https://docs.opensearch.org/latest/api-reference/index-apis/create-index-template/) |

## Resources and daily index shape

The resource names are exclusive to this service and are versioned. A later incompatible schema or
retention change gets a new suffix; it must not repurpose the v1 names.

| Resource | Fixed identity | Required content |
|---|---|---|
| ISM policy | `log-debug-retention-v1` | `ism_template.index_patterns: ["log-debug-v1-*"]`, priority `100`, a `hot` default state, then a `delete` state entered at `min_index_age: "7d"` whose action is `delete`. |
| Composable template | `log-debug-v1-template` | `index_patterns: ["log-debug-v1-*"]`, priority `100`, and the v1 mapping: `observedAt` is `date`; `namespace`, `pod`, `container`, `workload`, `source`, and `testRunId` are exact (`keyword`) fields; `message` is `text`; schema and sanitized attributes preserve the approved v1 contract. |
| Daily index | `log-debug-v1-YYYY.MM.dd` | The UTC calendar day of the service clock. It is created only after the policy and template are present; all records accepted on that UTC day are written only to that index. |

The template supplies the mapping; the ISM policy supplies deletion. They are intentionally separate
because template metadata alone cannot delete an index. ISM attaches the named policy when the
matching daily index is created. A record is retained by its **ingest-day index age**, not a claim
that an individual late record is retained exactly seven times 24 hours.

## Public bootstrap and lifecycle seam

```java
public record OpenSearchLogIndexConfig(String indexPrefix, Clock clock) {}
public record RetentionInstallation(String policyId, String templateName, String activeIndex) {}

public final class OpenSearchLogIndexBootstrap {
    public static RetentionInstallation ensureInstalled(
            OpenSearchClient client, OpenSearchLogIndexConfig config);
}
```

`ensureInstalled` is the lifecycle seam: it validates `indexPrefix` as `log-debug-v1`, creates or
reconciles the named policy and template, then ensures the current UTC daily index exists. The
existing `OpenSearchLogIndex(OpenSearchClient, String)` remains the `IndexPort` data-plane seam;
it receives `RetentionInstallation.activeIndex()` after bootstrap. The caller owns the injected
client's lifecycle and closes it; bootstrap never closes or recreates a caller-owned client.

An integration oracle calls `ensureInstalled` twice with a fixed `Clock`, observes the same three
identities, then uses ISM explain and index-template/mapping reads to observe the installed policy
and mapping. It does not inspect bootstrap internals.

## Idempotent bootstrap

1. Read the named policy and template. If absent, create them from the versioned canonical
   definitions. If present but different, update only those named v1 resources to their canonical
   definition; no wildcard policy/template update is permitted.
2. Create only today's `log-debug-v1-YYYY.MM.dd` index. A concurrent already-exists response is a
   success only after rereading that exact index and confirming the v1 template and ISM attachment.
3. Return `RetentionInstallation` only after the policy, template, and exact active index are
   observable. Any permissions, connectivity, mapping, or ISM-attachment failure fails startup
   loudly and performs no fallback to mapping-only retention or an unbounded index.

This makes repeated starts converge on one policy, one template, and one daily index without
creating a duplicate resource. Bootstrap never deletes policy, template, or index resources.

## Required permissions

The adapter's OpenSearch identity is scoped to `log-debug-v1-*`; MCP callers receive none of these
credentials. The deployment must grant the bootstrap/data-plane process:

- ISM policy read/write: `cluster:admin/opendistro/ism/policy/get` and
  `cluster:admin/opendistro/ism/policy/write`.
- Template read/write: `indices:admin/index_template/get` and
  `indices:admin/index_template/put`.
- Daily-index create/inspection, document indexing, and search only on `log-debug-v1-*`.

The named ISM permissions are from the [OpenSearch security permission list](https://docs.opensearch.org/latest/security/access-control/permissions/).
No permission to delete policies/templates, manage unrelated indexes, or use OpenSearch security
management APIs is required. The deployment-specific availability of ISM and these scoped grants
remains A-007's preflight assumption.

## Invariants and observable seams

| Id | Invariant — must hold for every bootstrap/index call | Observable seam |
|---|---|---|
| INV-RETENTION-1 | Every `log-debug-v1-*` index created by bootstrap is ISM-managed by `log-debug-retention-v1`, whose only terminal action deletes its index after `min_index_age: 7d`. | ISM explain for the active index and a policy GET show the exact id and delete transition. |
| INV-DAILY-1 | An accepted record is written only to the single UTC-day index selected by the injected clock; no historical/future daily index is created by that call. | Captured index request and index existence reads. |
| INV-BOOTSTRAP-1 | Repeating bootstrap, including a create race, reports the same fixed policy/template/active-index identities and creates no duplicate or wildcard resource. | Two public calls plus resource-list/read results. |
| INV-INDEX-SCHEMA-1 | The active daily index has the v1 date, exact-identity/correlation, and full-text message mappings before `OpenSearchLogIndex.index` is allowed to write. | Template simulation/mapping read and one real `IndexPort` round trip. |

## Feature impact

| Feature | Impact | Required coverage |
|---|---|---|
| feat-004 | change | Own the policy/template artifact, bootstrap seam, OpenSearch client dependency, and index adapter. |
| feat-005 | change | Prove the real-store mapping, constrained queries, ISM attachment, seven-day delete definition, and idempotent bootstrap. |
| feat-006 | keep | Remains behind `IndexPort`; it receives no OpenSearch lifecycle or credentials. |

## Assumption and approval boundary

`A-007` is a preflight fact, not a reason to substitute a fake store or mapping-only retention. The
human-approved mechanism is recorded in X-009. This document changes the design digest; only the
human may bind that new digest in `loop/design-approval.json`.

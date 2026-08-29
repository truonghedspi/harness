# Collector Contract Launcher — Approved

This design supplies the executable boundary for `feat-009`; the project owner approved its OCI
runtime, immutable image, lifecycle and JSONL fixture contract on 2026-08-27. It
extends the node-collector design in `log-debug-context.md` and derives its required wire shape
from `feature_list.json:89-95` and `INV-SCOPE-1`, `INV-META-1`, and `INV-SCHEMA-1` there.

## Public seam

`CollectorContractBootstrap` executes the real collector configuration outside a cluster. It owns
runtime networking and image selection; an oracle supplies only a capture-ingress URI, fixture
directory, and bounded lifecycle deadlines.

```java
public record CollectorContractConfig(URI ingestEndpoint, Path fixtureDirectory,
    Duration readyDeadline, Duration shutdownDeadline) {}
public interface RunningCollector extends AutoCloseable { void awaitReady(); void close(); }
public final class CollectorContractBootstrap {
    public static RunningCollector start(CollectorContractConfig config);
}
```

`start` uses only the OpenTelemetry Collector Contrib OCI image pinned by immutable digest in
`collector/contract-image.lock`. It mounts `fixtureDirectory` read-only at `/fixtures`, passes
that location and `ingestEndpoint` to the real `collector/otel-collector.yaml`, and exposes no
host-log path. The fixture is `pod-logs.json`, containing representative opted-in and excluded pod
records only. `awaitReady()` succeeds only when the collector health endpoint responds before
`readyDeadline`, otherwise it reports startup diagnostics. `close()` stops the named runtime and,
after `shutdownDeadline`, force-stops it and reports cleanup failure.

The oracle starts its capture ingress first, calls `start`, waits ready, then decodes each captured
OTLP request and asserts each admitted log record becomes exactly one UTF-8 schemaVersion-1 JSON
object that can be submitted to `IngestService.ingest(String)`. The decode mechanism and its
invariants are in [collector-ingress-mechanism.md](collector-ingress-mechanism.md). It closes the
returned instance in a `finally` path. An unavailable permitted container runtime or unavailable
pinned image is an explicit environment checkpoint, never a fake collector or behavior result.

## JSONL fixture contract

`pod-logs.json` is UTF-8 JSON Lines: one source event per non-blank line, with no array or transport
envelope. Each object has exactly this source-facing shape; generators vary values but not types:

```json
{
  "observedAt": "2026-08-27T07:00:00Z",
  "source": "stdout",
  "message": "test failed",
  "kubernetes": {
    "namespace": "tests",
    "pod": "checkout-abc",
    "container": "app",
    "workload": "checkout",
    "labels": {
      "debug.logs/enabled": "true",
      "environment": "test"
    }
  },
  "attributes": { "test.run_id": "run-123" }
}
```

`observedAt`, `source`, `message`, and all four Kubernetes identity fields are required strings;
`source` is `stdout` or `stderr`. `attributes` is an object of string values and `test.run_id` is
optional. Eligibility is the conjunction of label `debug.logs/enabled == "true"` and label
`environment == "test"`; every other row is discarded before export. For an eligible row the
collector's transform maps the v1 fields into the OTLP log record (body/attributes), and the
OTLP-decode adapter reconstructs one schemaVersion-1 ingress object per record, maps `environment`
to the top-level admission field, maps the identity fields without renaming, and maps `test.run_id`
to the existing ingress attribute of the same name. The OTLP mapping and decode invariants are in
[collector-ingress-mechanism.md](collector-ingress-mechanism.md).

This hermetic source begins after Kubernetes metadata enrichment. Fetching labels and identity from
the real Kubernetes API remains the Level-3 journey's responsibility; this contract proves the
filter, mapping and HTTP wire pipeline without silently becoming a second cluster test.

## Owner decision status

The project owner selected Docker/OCI on 2026-08-27 and accepted the proposed isolated lifecycle
policy: read-only fixtures, health-based readiness, deadline-bounded shutdown and reported forced
cleanup. A local-binary source is no longer an open alternative.

The project owner then approved this exact multi-platform reference on 2026-08-27:

```text
otel/opentelemetry-collector-contrib:0.159.0@sha256:1f2c54a30e713fac6b3ae77a1ec84010c2007e29ced8ec666214fc2f6739c1cc
```

`collector/contract-image.lock` is the executable source of that value. Changing the tag or digest
is a new owner decision and invalidates the design approval.

## Exact owner decision required

The owner approved the isolated OCI-runtime launcher, including:

1. the exact immutable Collector Contrib image digest recorded in `collector/contract-image.lock`;
2. Docker as the allowed CI/local container runtime for this non-cluster contract; and
3. the read-only `/fixtures` mount, health-readiness, and deadline-bound forced-cleanup policy.

The owner also approved the JSONL fixture contract above on 2026-08-27. No owner decision remains
open for this launcher. The implementation and oracle must not select a different runner, image or
fixture schema silently.

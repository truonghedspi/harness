# Collector → ingest wire mechanism — OTLP on the wire, v1 decoded at the ingest boundary

**Recommendation:** keep the pinned stock image; the collector emits OTLP (its only HTTP egress) and a new OTLP-decode adapter unwraps each admitted log record into exactly one schemaVersion-1 JSON object before `IngestService.ingest(String)`. The "no envelope" guarantee is relocated, not dropped, from the collector's egress to the ingest boundary.

## The question feat-009 raised

`feat-009` needs a mechanism: "How does the pinned stock `otel/opentelemetry-collector-contrib:0.159.0` emit one raw UTF-8 schemaVersion-1 JSON object per HTTP ingress request, given `otlphttp` wraps records in the `resourceLogs` envelope?" The approved docs name only the wire shape, never a mechanism. This doc answers it and amends the two sentences that assert the collector itself emits bare v1 JSON.

## Claims

| Claim | Evidence |
|---|---|
| The pinned contrib distribution ships exactly these HTTP-capable log exporters: `otlphttp` (OTLP envelope), plus vendor-schema exporters (`datadog`, `splunkhec`, `elasticsearch`, `opensearch`, `sumologic`, `syslog`, `kafka`, `clickhouse`, …). None emits one arbitrary raw JSON object per HTTP POST. | Official manifest `opentelemetry-collector-releases@v0.159.0/distributions/otelcol-contrib/manifest.yaml`, `exporters:` section (fetched 2026-08-29). |
| `otlphttp` "sends logs … via HTTP using OTLP format"; `encoding` accepts only `proto` and `json`; its config has no `encoding_extension` field, so it cannot attach a raw-JSON encoding extension at this version. | `opentelemetry-collector@v0.159.0/exporter/otlphttpexporter/README.md` and `config.go` (`EncodingType`: `proto`/`json` only). |
| A raw-JSON log encoding *does* exist in contrib (`jsonlogencodingextension`, alpha) but it is an encoding extension consumed only by exporters with an `encoding`/`encoding_extension` setting — at v0.159.0 `file`, `kafka`, `pulsar`, `rabbitmq` (disk or message queues) — never `otlphttp`, so it cannot emit raw JSON to an arbitrary HTTP endpoint. | `contrib@v0.159.0/extension/encoding/jsonlogencodingextension/README.md`; `exporter/fileexporter/README.md` (`encoding` … "uses an encoding extension"); `exporter/{kafka,pulsar,rabbitmq}exporter/README.md` (`encoding`/`encoding_extension` settings). |
| `fileexporter` `format: json` writes OTLP JSON (the `resourceLogs` envelope), one JSON object per line, to a **file** — never to an HTTP endpoint. | `contrib@v0.159.0/exporter/fileexporter/README.md` ("File Format"; "OTLP JSON File receiver"). |
| The owner pinned the **unmodified** stock image; a custom/fork exporter changes that digest-bound decision. | `harness/DECISIONS.md` 2026-08-27 "Docker/OCI selected". |
| The owner pinned the JSONL fixture as a post-enrichment JSONL event (digest `c206b89185ec03cd`). | `harness/DECISIONS.md` 2026-08-27 "Hermetic collector source…". |
| The current oracle asserts the collector's capture request contains no `resourceLogs` and no `"body":[`. | `service/src/test/java/io/harness/logcontext/contract/CollectorIngestContractIT.java:57-58`. |
| The prior approved contract stated "The collector sends one UTF-8 JSON object per ingress request", no batch envelope — the two sentences this doc amends. | `harness/docs/design/log-debug-context.md` ("Serialized ingress v1") and `collector-contract-launch.md` ("The oracle … asserts each captured request is one UTF-8 JSON object"; "the collector emits one schemaVersion-1 ingress object"), as amended by this doc. |
| `IngestService.ingest(String)` already consumes exactly one v1 JSON object and is judged by `INV-SCOPE-1`/`INV-META-1`/`INV-SCHEMA-1`; feat-002 and feat-003 are done against that seam. | `feature.mjs feat-002` (`status done`), `feat-003`; `log-debug-context.md:129-162`. |

The decisive fact is the first two rows together: **the pinned stock image has no exporter that emits one raw JSON object per HTTP request.** Every HTTP egress is either OTLP (`otlphttp`) or a vendor-specific schema. So the contract as literally worded is unsatisfiable by the pinned image, and the choice is between relocating the v1 boundary (Option A) and replacing the image (Option C).

## Options (generated before any preference)

### Option A — ingest-side OTLP decode (recommended)

Keep `otlphttp` (stock). A new decode adapter on the ingest side unwraps `resourceLogs[].scopeLogs[].logRecords[]` and, for each admitted record, reconstructs one v1 JSON object and calls `IngestService.ingest(String)`.

- **Conclusion:** adopt OTLP as the collector→ingest wire and draw the v1 boundary at the decode adapter.
  - It keeps the pinned image digest and the Docker/OCI decision intact (DECISIONS.md 2026-08-27).
  - OTLP is the collector's native, documented protocol; backends decoding OTLP is the industry-standard shape.
  - `IngestService` and the done feat-002/003 seam are untouched; only the transport in front of them changes.
  - The JSONL fixture contract (digest `c206b89185ec03cd`) is unchanged: `filelog → filter → transform → otlphttp` stays.
- **Objection:** it amends the approved sentence rather than satisfying it — the collector no longer emits bare v1, and the oracle's "no `resourceLogs`" assertion must move to the post-decode boundary.
  - **Response:** that is exactly what requires owner approval here; the guarantee is preserved where the invariants actually operate (one v1 object per `ingest` call), which is the reason the contract exists.

### Option B — a stock in-image mechanism

Find a specific exporter/transform the pinned image ships that emits one raw JSON object per HTTP request.

- **Conclusion:** none exists.
  - `otlphttp` is OTLP-enveloped and cannot attach `jsonlogencoding` at v0.159.0 (no `encoding_extension` config field).
  - `jsonlogencodingextension` can produce raw JSON logs but only via `fileexporter` (disk), not HTTP.
  - `debug`/`file` exporters do not speak HTTP.
- **Objection:** "you only checked the manifest, not the running image."
  - **Response:** the manifest is the authoritative component list for the tagged distribution; the same absence is visible in the tag's source. Docker was not runnable here (no Colima socket), so the negative claim rests on the tag's manifest + exporter configs, not on a live run — noted as a residual verification step for feat-009's own oracle.

### Option C — amend the pinned-image decision to admit a minimal custom exporter

Build a custom distribution (OpenTelemetry Collector builder) with a tiny exporter that POSTs one v1 JSON object per request.

- **Conclusion:** makes the collector emit v1 verbatim.
  - The approved sentence then holds literally; the oracle asserts exactly what was approved.
  - No OTLP decode code enters the ingest path.
- **Objection:** it reverses the owner's "unmodified stock image" decision, replaces the digest in `collector/contract-image.lock`, and adds a build/publish/sign/pin pipeline for a custom artifact — an ongoing maintenance commitment, not a one-time cost.
  - **Response:** the digest-bound decision exists precisely to force this trade to be a named, owner-approved change, never an inline convenience.

### Option D (named and rejected) — `fileexporter` + `jsonlogencoding`, then a forwarder POSTs each line

Keeps the stock image but adds a second moving part (tail a file, POST each line). It still needs custom transport code — now in the Java service rather than the image — and the `jsonlogencoding` output shape is awkward to reconstruct into the exact v1 object. Rejected: strictly more parts than A for no benefit.

## Decision frame (PrOACT)

- **Problem.** The stock collector cannot emit bare v1 JSON per HTTP request; the contract and the pinned image are in tension.
- **Alternatives.** A (decode at ingest), B (stock exporter — none), C (custom exporter), D (file+forwarder).
- **Consequences** (cited) and **trade-offs** — the table below; the owner weighs the axes, not this doc.

| Axis | A — ingest-side OTLP decode | B — stock mechanism | C — custom exporter | D — file + forwarder |
|---|---|---|---|---|
| Image digest | unchanged | unchanged | **changes** (new lock) | unchanged |
| Wire contract | **amended**: OTLP on wire, v1 at decode | n/a | satisfied literally | satisfied literally |
| Capture endpoint / oracle | captures OTLP, decodes, asserts v1 | n/a | captures v1 | captures v1 via forwarder |
| `IngestService` / feat-002/003 | unchanged | unchanged | unchanged | unchanged |
| New production code | one decode adapter (+ HTTP handler) | none | custom exporter repo+build | forwarder + file tailing |
| Cost | small, one-time | none | **high, recurring** (build/sign/pin) | medium, recurring |
| Forecloses | "collector literally emits v1" | — | "unmodified stock image" | "collector owns egress" |

## Chosen mechanism and boundaries

| Component | Boundary and responsibility | Observable seam |
|---|---|---|
| Node collector (unchanged topology) | `filelog → filter → transform → otlphttp`; the transform now maps v1 fields into the OTLP record's body/attributes; `otlphttp` remains the only egress. | One OTLP HTTP request to the capture endpoint; `awaitReady()`/`close()`. |
| OTLP-decode adapter (new) | Parses one OTLP JSON log payload, unwraps `resourceLogs → scopeLogs → logRecords`, and for each admitted record returns one v1 JSON string; rejects malformed or non-log OTLP. | `OtlpLogDecoder.decode(byte[]) → List<String>` (each string a v1 object), shared by production and the oracle. |
| Ingest and redaction service (unchanged) | Receives one v1 object per `ingest(String)` call; scope/redaction/normalization unchanged. | `IngestService.ingest(String)` result and `IndexPort.index` invocation. |

The v1 mapping (what the transform must carry so the decoder can reconstruct it):

| v1 field | OTLP slot the transform writes / decoder reads |
|---|---|
| `schemaVersion` | log-record attribute `schemaVersion` (int `1`) |
| `observedAt` | log-record attribute `observedAt` (RFC 3339 string, round-tripped) |
| `message` | log-record `body` (string) |
| `source` / `namespace` / `pod` / `container` / `workload` | log-record attributes, mapped without renaming |
| `environment` / `optIn` | log-record attributes (`optIn` bool `true`, set post-filter) |
| `test.run_id` | log-record attribute `test.run_id` |

The current `transform` has two no-op statements (`observedAt`, `source`) and maps the rest as flat attributes; the decoder reads those flat attributes, so the fix is small (drop the no-ops, ensure `message`→body and the typed values survive). feat-008's test was a **static** policy check and never executed the transform, so the exact OTTL statements are unverified until feat-009 runs — registered as A-008.

## Invariants

| Id | Component | Invariant — must hold for every input | Observable seam |
|---|---|---|---|
| `INV-OTLP-1` | OTLP-decode adapter | Every admitted OTLP log record produces exactly one v1 object submitted to `IngestService`, and a record the opt-in/environment filter excluded produces none. | Capture endpoint count equals eligible-row count; `IndexPort` has exactly that many invocations and no excluded message appears. |
| `INV-OTLP-2` | OTLP-decode adapter | Every v1 field (`message`, `observedAt`, `source`, `namespace`, `pod`, `container`, `workload`, `test.run_id`) survives the OTLP transport and decode unchanged — no rename, loss, or type coercion. | Round-trip oracle over generated distinct fixtures (already present in `CollectorIngestContractIT`). |

Existing `INV-SCOPE-1`, `INV-META-1`, `INV-SCHEMA-1`, `INV-REDACT-1` are unchanged: they act on the v1 object at the ingest boundary, which Option A preserves.

## Feature impact

| Feature area | Impact | Must cover |
|---|---|---|
| Collector pipeline config (`collector/otel-collector.yaml`, chart ConfigMap) | change | transform maps v1 fields into OTLP body/attributes; `otlphttp` stays the sole egress; filter unchanged. |
| Collector contract oracle (`feat-009`) | change | capture OTLP, decode via the shared `OtlpLogDecoder`, assert per-record v1, excluded-rows-absent, and round-trip fidelity; the no-`resourceLogs` assertion moves to post-decode. |
| OTLP-decode adapter | new | public `OtlpLogDecoder` seam + the ingest HTTP handler that decodes then calls `IngestService.ingest` per record. |
| `IngestService` / `IndexPort` (`feat-002`, `feat-003`) | keep | unchanged — still one v1 JSON object per call. |

## Critique

### Steelman gate

Option A fairly says: the collector is a stock OpenTelemetry component whose native wire protocol is OTLP; asking it to emit arbitrary JSON without a custom exporter is asking it to be something it is not. Decoding OTLP at the backend keeps the pinned, unmodified image the owner chose, keeps the tested ingest seam, and still delivers exactly one v1 object per record to that seam. It agrees with the owner's Docker/OCI decision, the JSONL fixture contract, and every ingest invariant. It also teaches a real boundary: *transport format* (OTLP) and *record contract* (v1) are separable concerns, and only the record contract is load-bearing for safety.

### Key Assumptions Check

| Premise needed for Option A | Challenge | Result |
|---|---|---|
| The transform's OTLP mapping carries every v1 field byte-exact. | feat-008 never executed the transform (static test only). | Holds only after feat-009 runs — A-008 (assumed), tripwire is the round-trip oracle. |
| `otlphttp` JSON encoding is decodable in the Java service. | OTLP/JSON is a stable documented mapping. | Survives — cited proto JSON format; decode is plain JSON. |
| One OTLP request may carry several records and fan-out is acceptable. | A batch of N records → N `ingest` calls, one per record. | Survives; stated in `INV-OTLP-1`. |
| The owner's "no envelope" intent was about the ingest boundary, not the collector's transport. | If the intent was literally "collector emits v1", A contradicts it. | **This is the one premise only the owner can settle** — it is the approval question, not an assumption I may resolve. |

### Premortem

Assume Option A shipped and failed months later: the transform dropped `test.run_id` or coerced `observedAt`, the decoder silently invented a field to compensate, and a non-opted-in pod's record slipped through because the decode fan-out lost the filter's exclusion. Countermeasures: `INV-OTLP-1` (excluded-absent, exactly-once) and `INV-OTLP-2` (round-trip fidelity) make each failure a red oracle, and the shared `OtlpLogDecoder` means the oracle tests the same decode path production uses, not a parallel reimplementation.

### Devil's Advocacy for Option C

The strongest case for a custom exporter is not convenience — it is **fidelity**. C makes the collector emit the approved v1 object verbatim, so the contract holds word-for-word, the oracle asserts exactly the approved shape with no decode layer to trust, and no OTLP parser exists in the ingest path to get wrong. If the owner's "no envelope" rule was meant to keep the collector's egress self-describing and transport-independent (for a future non-OTel collector, or to keep the ingest service free of OTel-specific code), C is the only option that does not silently move that boundary. Its one-time cost buys back the literal contract.

## Approval boundary

This document records a recommendation and critique; it does **not** create `loop/design-approval.json` or mark anything approved. It amends exactly two approved sentences — `log-debug-context.md:77` ("The collector sends one UTF-8 JSON object per ingress request") and `collector-contract-launch.md:31-32,63-66` (the oracle's no-`resourceLogs` assertion and "the collector emits one schemaVersion-1 ingress object") — and adds `INV-OTLP-1`/`INV-OTLP-2`. The pinned image digest, the Docker/OCI decision, the JSONL fixture contract (`c206b89185ec03cd`), and `IngestService` are unchanged.

**Exact owner question to approve:** "Approve that the collector emits OTLP on the wire (the pinned stock image's only HTTP egress) and that the v1 'one JSON object, no envelope' guarantee is satisfied by an OTLP-decode adapter at the ingest boundary — unwrapping each admitted log record into exactly one schemaVersion-1 object before `IngestService.ingest(String)` — rather than the collector emitting bare v1 JSON, which the stock image cannot do. This relocates the no-envelope assertion to the post-decode boundary, keeps the pinned digest, and leaves feat-002/003 and the JSONL fixture contract untouched."

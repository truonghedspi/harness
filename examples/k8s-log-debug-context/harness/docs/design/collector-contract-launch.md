# Collector Contract Launcher — Proposed

This proposal supplies the missing executable boundary for `feat-009`; it is not approved. It
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

The oracle starts its capture ingress first, calls `start`, waits ready, then asserts each captured
request is one UTF-8 JSON object that can be submitted to `IngestService.ingest(String)`. It closes
the returned instance in a `finally` path. An unavailable permitted container runtime or unavailable
pinned image is an explicit environment checkpoint, never a fake collector or behavior result.

## Exact owner decision required

Approve the isolated OCI-runtime launcher, including:

1. the exact immutable Collector Contrib image digest recorded in `collector/contract-image.lock`;
2. the allowed CI/local container runtime for this non-cluster contract; and
3. the read-only `/fixtures` mount, health-readiness, and deadline-bound forced-cleanup policy.

Alternatively, reject OCI execution and choose a specific pinned local-binary source with the same
`CollectorContractConfig` / `RunningCollector` lifecycle contract. The implementation and oracle
must not select a runner or image silently.

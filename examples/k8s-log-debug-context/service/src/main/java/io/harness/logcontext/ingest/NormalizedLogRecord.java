package io.harness.logcontext.ingest;

import java.time.Instant;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;

public record NormalizedLogRecord(
    int schemaVersion,
    Instant observedAt,
    String message,
    String namespace,
    String pod,
    String container,
    String workload,
    String source,
    Optional<String> testRunId,
    Map<String, String> attributes) {
  public NormalizedLogRecord {
    observedAt = Objects.requireNonNull(observedAt);
    message = Objects.requireNonNull(message);
    namespace = Objects.requireNonNull(namespace);
    pod = Objects.requireNonNull(pod);
    container = Objects.requireNonNull(container);
    workload = Objects.requireNonNull(workload);
    source = Objects.requireNonNull(source);
    testRunId = Objects.requireNonNull(testRunId);
    attributes = Map.copyOf(Objects.requireNonNull(attributes));
  }
}

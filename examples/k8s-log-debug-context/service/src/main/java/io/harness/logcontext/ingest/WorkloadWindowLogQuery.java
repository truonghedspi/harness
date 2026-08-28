package io.harness.logcontext.ingest;

import java.util.Objects;
import java.util.Optional;

public record WorkloadWindowLogQuery(
    String namespace,
    String workload,
    TimeWindow timeWindow,
    int maxRecords,
    Optional<String> messageContains) implements LogQuery {
  public WorkloadWindowLogQuery {
    if (namespace == null || namespace.isBlank()) throw new IllegalArgumentException("namespace is blank");
    if (workload == null || workload.isBlank()) throw new IllegalArgumentException("workload is blank");
    Objects.requireNonNull(timeWindow);
    RunIdLogQuery.validateLimit(maxRecords);
    messageContains = Objects.requireNonNull(messageContains);
  }
}

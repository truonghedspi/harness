package io.harness.logcontext.ingest;

import java.util.Objects;
import java.util.Optional;

public record RunIdLogQuery(
    String testRunId, TimeWindow timeWindow, int maxRecords, Optional<String> messageContains)
    implements LogQuery {
  public RunIdLogQuery {
    if (testRunId == null || testRunId.isBlank()) throw new IllegalArgumentException("testRunId is blank");
    Objects.requireNonNull(timeWindow);
    validateLimit(maxRecords);
    messageContains = Objects.requireNonNull(messageContains);
  }

  static void validateLimit(int maxRecords) {
    if (maxRecords < 1 || maxRecords > 200) throw new IllegalArgumentException("maxRecords outside 1..200");
  }
}

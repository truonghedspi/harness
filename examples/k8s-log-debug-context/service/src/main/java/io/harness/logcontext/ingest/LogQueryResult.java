package io.harness.logcontext.ingest;

import java.util.List;
import java.util.Objects;

public record LogQueryResult(List<NormalizedLogRecord> records, boolean truncated) {
  public LogQueryResult {
    records = List.copyOf(Objects.requireNonNull(records));
  }
}

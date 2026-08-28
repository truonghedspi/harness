package io.harness.logcontext.ingest;

import java.util.Optional;

public sealed interface LogQuery permits RunIdLogQuery, WorkloadWindowLogQuery {
  TimeWindow timeWindow();

  int maxRecords();

  Optional<String> messageContains();
}

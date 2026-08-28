package io.harness.logcontext.query;

import io.harness.logcontext.ingest.LogQuery;
import io.harness.logcontext.ingest.RunIdLogQuery;
import io.harness.logcontext.ingest.TimeWindow;
import io.harness.logcontext.ingest.WorkloadWindowLogQuery;
import java.util.Objects;
import java.util.Optional;

/**
 * Resolves a failure-context request into a single typed query plan. A supplied
 * {@code test.run_id} is used exclusively; otherwise a non-blank namespace and
 * workload together with an already-bounded time window are required. The resolver
 * performs no I/O and never builds a query that broadens beyond the supplied identity
 * and interval.
 */
public final class CorrelationResolver {

  public sealed interface CorrelationResolution
      permits CorrelationResolution.Resolved, CorrelationResolution.InsufficientCorrelation {
    record Resolved(LogQuery query) implements CorrelationResolution {
      public Resolved {
        Objects.requireNonNull(query);
      }
    }

    record InsufficientCorrelation(String reason) implements CorrelationResolution {
      public InsufficientCorrelation {
        if (reason == null || reason.isBlank()) throw new IllegalArgumentException("reason is blank");
      }
    }
  }

  public CorrelationResolver() {}

  public CorrelationResolution resolve(String testRunId, String namespace, String workload,
      TimeWindow window, int maxRecords) {
    Objects.requireNonNull(window);
    if (testRunId != null && !testRunId.isBlank()) {
      return new CorrelationResolution.Resolved(
          new RunIdLogQuery(testRunId, window, maxRecords, Optional.empty()));
    }
    if (namespace == null || namespace.isBlank() || workload == null || workload.isBlank()) {
      return new CorrelationResolution.InsufficientCorrelation(
          "namespace, workload, and a bounded interval are required when test.run_id is absent");
    }
    return new CorrelationResolution.Resolved(
        new WorkloadWindowLogQuery(namespace, workload, window, maxRecords, Optional.empty()));
  }
}

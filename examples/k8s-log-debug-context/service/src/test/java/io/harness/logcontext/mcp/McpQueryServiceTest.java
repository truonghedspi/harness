package io.harness.logcontext.mcp;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.assertTimeoutPreemptively;

import io.harness.logcontext.ingest.IndexPort;
import io.harness.logcontext.ingest.LogQuery;
import io.harness.logcontext.ingest.LogQueryResult;
import io.harness.logcontext.ingest.NormalizedLogRecord;
import io.harness.logcontext.ingest.RunIdLogQuery;
import io.harness.logcontext.ingest.WorkloadWindowLogQuery;
import io.harness.logcontext.mcp.McpQueryService.ToolResult;
import io.harness.logcontext.query.CorrelationResolver;
import java.lang.reflect.Constructor;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;

@Timeout(value = 30, unit = TimeUnit.SECONDS)
final class McpQueryServiceTest {
  private static final String FROM = "2026-08-26T09:45:00Z";
  private static final String TO = "2026-08-26T10:00:00Z";

  @Test
  void suppliedRunIdIsUsedExclusivelyWithoutFallback() {
    CapturingIndex index = new CapturingIndex();
    McpQueryService service = new McpQueryService(index, new CorrelationResolver());

    ToolResult result = service.getFailureContext(failureArgs(
        "run-8842", "other-namespace", "other-workload", FROM, TO, 200));

    assertInstanceOf(ToolResult.Success.class, result);
    assertEquals(1, index.searches.size());
    LogQuery query = index.searches.getFirst();
    assertInstanceOf(RunIdLogQuery.class, query,
        "a supplied run id must never fall back to a namespace/workload query");
    assertEquals("run-8842", ((RunIdLogQuery) query).testRunId());
    assertEquals(Instant.parse(FROM), query.timeWindow().fromInclusive());
  }

  @Test
  void missingRunIdWithoutNamespaceOrWorkloadIsRejectedBeforeRead() {
    CapturingIndex index = new CapturingIndex();
    McpQueryService service = new McpQueryService(index, new CorrelationResolver());

    ToolResult noIdentity = service.getFailureContext(failureArgs(
        null, null, null, FROM, TO, 200));
    ToolResult namespaceOnly = service.getFailureContext(failureArgs(
        null, "ci-payments", null, FROM, TO, 200));

    assertEquals(new ToolResult.Rejected("INSUFFICIENT_CORRELATION"), noIdentity);
    assertEquals(new ToolResult.Rejected("INSUFFICIENT_CORRELATION"), namespaceOnly);
    assertTrue(index.searches.isEmpty(), "an insufficiently correlated request read the index");
  }

  @Test
  void missingRunIdFallsBackToWorkloadWindowConjunction() {
    CapturingIndex index = new CapturingIndex();
    McpQueryService service = new McpQueryService(index, new CorrelationResolver());

    ToolResult result = service.getFailureContext(failureArgs(
        null, "ci-payments", "payments-test", FROM, TO, 200));

    assertInstanceOf(ToolResult.Success.class, result);
    assertEquals(1, index.searches.size());
    LogQuery query = index.searches.getFirst();
    assertInstanceOf(WorkloadWindowLogQuery.class, query);
    WorkloadWindowLogQuery workloadQuery = (WorkloadWindowLogQuery) query;
    assertEquals("ci-payments", workloadQuery.namespace());
    assertEquals("payments-test", workloadQuery.workload());
    assertEquals(Instant.parse(FROM), workloadQuery.timeWindow().fromInclusive());
    assertEquals(Instant.parse(TO), workloadQuery.timeWindow().toExclusive());
  }

  @Test
  void searchLogsRequiresNamespaceWorkloadAndInterval() {
    CapturingIndex index = new CapturingIndex();
    McpQueryService service = new McpQueryService(index, new CorrelationResolver());

    ToolResult missingWorkload = service.searchLogs(searchArgs(FROM, TO, 200, "workload", null));
    ToolResult missingInterval = service.searchLogs(args(
        "namespace", "ci-payments", "workload", "payments-test", "maxRecords", 200));

    assertEquals(new ToolResult.Rejected("INVALID_ARGUMENT"), missingWorkload);
    assertEquals(new ToolResult.Rejected("INVALID_INTERVAL"), missingInterval);
    assertTrue(index.searches.isEmpty(), "an unbounded search_logs read the index");
  }

  @Test
  void searchLogsForwardsOptionalMessageContainsFilter() {
    CapturingIndex index = new CapturingIndex();
    McpQueryService service = new McpQueryService(index, new CorrelationResolver());

    service.searchLogs(searchArgs(FROM, TO, 200, "messageContains", "failed"));

    assertEquals(1, index.searches.size());
    assertEquals(Optional.of("failed"), index.searches.getFirst().messageContains());
  }

  @Test
  void intervalAboveFifteenMinutesIsRejectedBeforeReading() {
    CapturingIndex index = new CapturingIndex();
    McpQueryService service = new McpQueryService(index, new CorrelationResolver());

    ToolResult result = service.searchLogs(searchArgs(
        "2026-08-26T09:45:00Z", "2026-08-26T10:00:01Z", 200));

    assertEquals(new ToolResult.Rejected("INVALID_INTERVAL"), result);
    assertTrue(index.searches.isEmpty(), "a window longer than 15 minutes read the index");
  }

  @Test
  void recordLimitOutsideOneToTwoHundredIsRejectedBeforeReading() {
    CapturingIndex index = new CapturingIndex();
    McpQueryService service = new McpQueryService(index, new CorrelationResolver());

    ToolResult tooMany = service.searchLogs(searchArgs(FROM, TO, 201));
    ToolResult tooFew = service.searchLogs(searchArgs(FROM, TO, 0));

    assertEquals(new ToolResult.Rejected("INVALID_LIMIT"), tooMany);
    assertEquals(new ToolResult.Rejected("INVALID_LIMIT"), tooFew);
    assertTrue(index.searches.isEmpty(), "an out-of-range maxRecords read the index");
  }

  @Test
  void paginationParametersAreRejectedBeforeReading() {
    CapturingIndex index = new CapturingIndex();
    McpQueryService service = new McpQueryService(index, new CorrelationResolver());

    for (String forbidden : List.of("cursor", "page", "offset", "continuationToken")) {
      Map<String, Object> args = searchArgs(FROM, TO, 200);
      args.put(forbidden, "next-1");
      assertEquals(new ToolResult.Rejected("INVALID_ARGUMENT"), service.searchLogs(args),
          "pagination member " + forbidden + " reached the index");
    }
    assertTrue(index.searches.isEmpty(), "a pagination request read the index");
  }

  @Test
  void oversizedResponseIsTruncatedToWholeRecordsWithinByteBudget() {
    CapturingIndex index = new CapturingIndex();
    McpQueryService service = new McpQueryService(index, new CorrelationResolver());
    int messageLength = 40_000;
    List<NormalizedLogRecord> source = records(20, messageLength);
    index.recordsSupplier = () -> source;

    ToolResult result = service.searchLogs(searchArgs(FROM, TO, 200));

    assertInstanceOf(ToolResult.Success.class, result);
    ToolResult.Success success = (ToolResult.Success) result;
    assertTrue(success.truncated(), "oversized response did not report truncation");
    assertFalse(success.records().isEmpty(), "the bounded response discarded every record");
    assertTrue(success.records().size() < 20, "the response returned more than the byte budget allows");
    assertTrue((long) success.records().size() * messageLength <= McpQueryService.MAX_RESPONSE_BYTES,
        () -> "kept records' message bytes alone exceed the budget: " + success.records().size());
    assertTrue(source.containsAll(success.records()),
        "the response must contain only whole source records, never a partial one");
  }

  @Test
  void withinBudgetResponseIsNotTruncatedAndReturnsEveryRecord() {
    CapturingIndex index = new CapturingIndex();
    McpQueryService service = new McpQueryService(index, new CorrelationResolver());
    index.recordsSupplier = () -> records(3, 100);

    ToolResult result = service.searchLogs(searchArgs(FROM, TO, 200));

    assertInstanceOf(ToolResult.Success.class, result);
    ToolResult.Success success = (ToolResult.Success) result;
    assertFalse(success.truncated());
    assertEquals(3, success.records().size());
  }

  @Test
  void stalledIndexSearchTerminatesAsDeadlineError() {
    CapturingIndex index = new CapturingIndex();
    McpQueryService service = new McpQueryService(index, new CorrelationResolver());
    CountDownLatch releaseSearch = new CountDownLatch(1);
    index.recordsSupplier = () -> {
      try {
        releaseSearch.await();
      } catch (InterruptedException interrupted) {
        Thread.currentThread().interrupt();
      }
      return List.of();
    };

    try {
      ToolResult result = assertTimeoutPreemptively(Duration.ofSeconds(6),
          () -> service.searchLogs(searchArgs(FROM, TO, 200)));
      assertInstanceOf(ToolResult.DeadlineExceeded.class, result);
      assertEquals(1, index.searches.size());
    } finally {
      releaseSearch.countDown();
    }
  }

  @Test
  void serviceIsReadOnlyAndCannotBeWiredToKubernetes() {
    CapturingIndex index = new CapturingIndex();
    index.recordsSupplier = () -> records(2, 10);
    McpQueryService service = new McpQueryService(index, new CorrelationResolver());

    service.searchLogs(searchArgs(FROM, TO, 200));
    service.getFailureContext(failureArgs("run-8842", null, null, FROM, TO, 200));

    assertTrue(index.writes.isEmpty(), "an MCP query wrote to the index");
    Constructor<?>[] constructors = McpQueryService.class.getConstructors();
    assertEquals(1, constructors.length);
    assertArrayEquals(new Class<?>[] {IndexPort.class, CorrelationResolver.class},
        constructors[0].getParameterTypes(),
        "McpQueryService must be wired only to IndexPort and CorrelationResolver");
  }

  private static Map<String, Object> searchArgs(String from, String to, int maxRecords, String... overrides) {
    Map<String, Object> args = args(
        "namespace", "ci-payments", "workload", "payments-test",
        "fromInclusive", from, "toExclusive", to, "maxRecords", maxRecords);
    for (int i = 0; i < overrides.length; i += 2) {
      if (overrides[i + 1] == null) {
        args.remove(overrides[i]);
      } else {
        args.put(overrides[i], overrides[i + 1]);
      }
    }
    return args;
  }

  private static Map<String, Object> failureArgs(String testRunId, String namespace, String workload,
      String from, String to, int maxRecords) {
    Map<String, Object> args = new LinkedHashMap<>();
    if (testRunId != null) args.put("testRunId", testRunId);
    if (namespace != null) args.put("namespace", namespace);
    if (workload != null) args.put("workload", workload);
    args.put("fromInclusive", from);
    args.put("toExclusive", to);
    args.put("maxRecords", maxRecords);
    return args;
  }

  private static Map<String, Object> args(Object... keyValues) {
    Map<String, Object> args = new LinkedHashMap<>();
    for (int i = 0; i < keyValues.length; i += 2) {
      args.put((String) keyValues[i], keyValues[i + 1]);
    }
    return args;
  }

  private static List<NormalizedLogRecord> records(int count, int messageLength) {
    List<NormalizedLogRecord> records = new ArrayList<>(count);
    for (int i = 0; i < count; i++) {
      records.add(record(i, messageLength));
    }
    return List.copyOf(records);
  }

  private static NormalizedLogRecord record(int i, int messageLength) {
    return new NormalizedLogRecord(
        1, Instant.parse("2026-08-26T09:45:30Z"),
        "record-marker-" + i + "-" + "x".repeat(messageLength),
        "ci-payments", "payments-test-pod", "test-runner", "payments-test", "stdout",
        Optional.of("run-8842"), Map.of("log.level", "ERROR"));
  }

  private static final class CapturingIndex implements IndexPort {
    private final List<LogQuery> searches = new ArrayList<>();
    private final List<NormalizedLogRecord> writes = new ArrayList<>();
    private Supplier<List<NormalizedLogRecord>> recordsSupplier = List::of;
    private boolean sourceTruncated;

    @Override
    public void index(NormalizedLogRecord document) {
      writes.add(document);
    }

    @Override
    public LogQueryResult search(LogQuery query) {
      searches.add(query);
      return new LogQueryResult(recordsSupplier.get(), sourceTruncated);
    }
  }
}

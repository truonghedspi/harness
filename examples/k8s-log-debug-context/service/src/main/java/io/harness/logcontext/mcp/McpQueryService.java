package io.harness.logcontext.mcp;

import io.harness.logcontext.ingest.IndexPort;
import io.harness.logcontext.ingest.LogQuery;
import io.harness.logcontext.ingest.LogQueryResult;
import io.harness.logcontext.ingest.NormalizedLogRecord;
import io.harness.logcontext.ingest.TimeWindow;
import io.harness.logcontext.ingest.WorkloadWindowLogQuery;
import io.harness.logcontext.query.CorrelationResolver;
import io.harness.logcontext.query.CorrelationResolver.CorrelationResolution;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

/**
 * Read-only query core behind the two MCP tools. It validates every request against the fixed
 * X-006 budgets (15-minute window, 1..200 records, no pagination, 256-KiB response, 5-second
 * deadline) before or around a single {@link IndexPort#search(LogQuery)} call, and it never
 * writes the index or reaches Kubernetes.
 */
public final class McpQueryService {
  public static final int MAX_RESPONSE_BYTES = 256 * 1024;
  private static final int MAX_RECORDS = 200;
  private static final Duration DEADLINE = Duration.ofSeconds(5);
  private static final Set<String> SEARCH_KEYS =
      Set.of("namespace", "workload", "fromInclusive", "toExclusive", "maxRecords", "messageContains");
  private static final Set<String> FAILURE_KEYS =
      Set.of("testRunId", "namespace", "workload", "fromInclusive", "toExclusive", "maxRecords");
  private static final ExecutorService SEARCH_EXECUTOR = Executors.newCachedThreadPool(runnable -> {
    Thread thread = new Thread(runnable, "mcp-query-deadline");
    thread.setDaemon(true);
    return thread;
  });

  private final IndexPort indexPort;
  private final CorrelationResolver correlationResolver;

  public sealed interface ToolResult
      permits ToolResult.Success, ToolResult.Rejected, ToolResult.DeadlineExceeded {
    record Success(List<NormalizedLogRecord> records, boolean truncated) implements ToolResult {
      public Success {
        records = List.copyOf(Objects.requireNonNull(records));
      }
    }

    record Rejected(String code) implements ToolResult {}

    record DeadlineExceeded() implements ToolResult {}
  }

  public McpQueryService(IndexPort indexPort, CorrelationResolver correlationResolver) {
    this.indexPort = Objects.requireNonNull(indexPort);
    this.correlationResolver = Objects.requireNonNull(correlationResolver);
  }

  public ToolResult searchLogs(Map<String, Object> arguments) {
    try {
      validateKeys(arguments, SEARCH_KEYS);
      TimeWindow window = window(arguments);
      int maxRecords = maxRecords(arguments);
      String namespace = requiredString(arguments, "namespace");
      String workload = requiredString(arguments, "workload");
      String messageContains = optionalString(arguments, "messageContains");
      LogQuery query = new WorkloadWindowLogQuery(
          namespace, workload, window, maxRecords, Optional.ofNullable(messageContains));
      return execute(query);
    } catch (Rejection rejection) {
      return new ToolResult.Rejected(rejection.code());
    }
  }

  public ToolResult getFailureContext(Map<String, Object> arguments) {
    try {
      validateKeys(arguments, FAILURE_KEYS);
      TimeWindow window = window(arguments);
      int maxRecords = maxRecords(arguments);
      String testRunId = optionalString(arguments, "testRunId");
      String namespace = optionalString(arguments, "namespace");
      String workload = optionalString(arguments, "workload");
      CorrelationResolution resolution =
          correlationResolver.resolve(testRunId, namespace, workload, window, maxRecords);
      if (resolution instanceof CorrelationResolution.InsufficientCorrelation) {
        return new ToolResult.Rejected("INSUFFICIENT_CORRELATION");
      }
      LogQuery query = ((CorrelationResolution.Resolved) resolution).query();
      return execute(query);
    } catch (Rejection rejection) {
      return new ToolResult.Rejected(rejection.code());
    }
  }

  private ToolResult execute(LogQuery query) {
    Future<LogQueryResult> future = SEARCH_EXECUTOR.submit(() -> indexPort.search(query));
    final LogQueryResult result;
    try {
      result = future.get(DEADLINE.toMillis(), TimeUnit.MILLISECONDS);
    } catch (TimeoutException timeout) {
      future.cancel(true);
      return new ToolResult.DeadlineExceeded();
    } catch (InterruptedException interrupted) {
      Thread.currentThread().interrupt();
      future.cancel(true);
      return new ToolResult.DeadlineExceeded();
    } catch (ExecutionException failure) {
      throw new IllegalStateException("index query failed", failure.getCause());
    }
    return bounded(result);
  }

  private ToolResult bounded(LogQueryResult result) {
    List<NormalizedLogRecord> kept = new ArrayList<>();
    int bytes = 0;
    boolean truncated = result.truncated();
    for (NormalizedLogRecord record : result.records()) {
      int size = canonicalBytes(record);
      if (bytes + size > MAX_RESPONSE_BYTES) {
        truncated = true;
        break;
      }
      kept.add(record);
      bytes += size;
    }
    return new ToolResult.Success(List.copyOf(kept), truncated);
  }

  static int canonicalBytes(NormalizedLogRecord record) {
    return record.toString().getBytes(StandardCharsets.UTF_8).length;
  }

  private static void validateKeys(Map<String, Object> arguments, Set<String> allowed) {
    for (String key : arguments.keySet()) {
      if (!allowed.contains(key)) throw new Rejection("INVALID_ARGUMENT");
    }
  }

  private static TimeWindow window(Map<String, Object> arguments) {
    Instant from = instant(arguments, "fromInclusive");
    Instant to = instant(arguments, "toExclusive");
    if (from == null || to == null) throw new Rejection("INVALID_INTERVAL");
    try {
      return new TimeWindow(from, to);
    } catch (IllegalArgumentException invalid) {
      throw new Rejection("INVALID_INTERVAL");
    }
  }

  private static int maxRecords(Map<String, Object> arguments) {
    Object value = arguments.get("maxRecords");
    if (!(value instanceof Number number)) throw new Rejection("INVALID_LIMIT");
    int maxRecords = number.intValue();
    if (maxRecords < 1 || maxRecords > MAX_RECORDS) throw new Rejection("INVALID_LIMIT");
    return maxRecords;
  }

  private static String requiredString(Map<String, Object> arguments, String key) {
    String value = string(arguments, key);
    if (value == null || value.isBlank()) throw new Rejection("INVALID_ARGUMENT");
    return value;
  }

  private static String optionalString(Map<String, Object> arguments, String key) {
    String value = string(arguments, key);
    return value == null || value.isBlank() ? null : value;
  }

  private static String string(Map<String, Object> arguments, String key) {
    Object value = arguments.get(key);
    if (value == null) return null;
    if (!(value instanceof String text)) throw new Rejection("INVALID_ARGUMENT");
    return text;
  }

  private static Instant instant(Map<String, Object> arguments, String key) {
    Object value = arguments.get(key);
    if (value == null) return null;
    if (!(value instanceof String text)) throw new Rejection("INVALID_INTERVAL");
    try {
      return Instant.parse(text);
    } catch (DateTimeParseException invalid) {
      throw new Rejection("INVALID_INTERVAL");
    }
  }

  private static final class Rejection extends RuntimeException {
    private final String code;

    Rejection(String code) {
      super(code);
      this.code = code;
    }

    String code() {
      return code;
    }
  }
}

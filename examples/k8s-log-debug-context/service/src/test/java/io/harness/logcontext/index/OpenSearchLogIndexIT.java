package io.harness.logcontext.index;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.harness.logcontext.ingest.NormalizedLogRecord;
import io.harness.logcontext.ingest.RunIdLogQuery;
import io.harness.logcontext.ingest.TimeWindow;
import io.harness.logcontext.ingest.WorkloadWindowLogQuery;
import java.io.IOException;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;

final class OpenSearchLogIndexIT {
  private static final ObjectMapper JSON = new ObjectMapper();
  private static final Instant NOW = Instant.parse("2026-08-28T10:15:30Z");

  @Test
  void bootstrapConvergesOnCanonicalPolicyTemplateAndUtcDailyIndex() {
    FakeGateway gateway = new FakeGateway();
    OpenSearchLogIndexConfig config = new OpenSearchLogIndexConfig(
        "log-debug-v1", Clock.fixed(NOW, ZoneOffset.UTC));

    RetentionInstallation first = OpenSearchLogIndexBootstrap.ensureInstalled(gateway, config);
    RetentionInstallation second = OpenSearchLogIndexBootstrap.ensureInstalled(gateway, config);

    assertEquals(first, second);
    assertEquals("log-debug-retention-v1", first.policyId());
    assertEquals("log-debug-v1-template", first.templateName());
    assertEquals("log-debug-v1-2026.08.28", first.activeIndex());
    assertEquals(1, gateway.putsTo("/_plugins/_ism/policies/log-debug-retention-v1"));
    assertEquals(1, gateway.putsTo("/_index_template/log-debug-v1-template"));
    assertTrue(gateway.policy.toString().contains("\"min_index_age\":\"7d\""));
    assertTrue(gateway.policy.toString().contains("\"delete\""));
    assertTrue(gateway.template.toString().contains("\"observedAt\":{\"type\":\"date\"}"));
    assertTrue(gateway.template.toString().contains("\"message\":{\"type\":\"text\"}"));
    assertThrows(IllegalArgumentException.class, () -> OpenSearchLogIndexBootstrap.ensureInstalled(
        gateway, new OpenSearchLogIndexConfig("logs-*", Clock.systemUTC())));
    assertFalse(gateway.closed, "bootstrap must not close caller-owned transport/client state");
  }

  @Test
  void adapterIndexesExactFieldsAndBuildsConjunctiveBoundedQueries() {
    FakeGateway gateway = new FakeGateway();
    OpenSearchLogIndex adapter = new OpenSearchLogIndex(gateway, "log-debug-v1-2026.08.28");
    NormalizedLogRecord record = record("run-1", NOW, "marker one");

    adapter.index(record);
    assertEquals("/log-debug-v1-2026.08.28/_doc", gateway.lastEndpoint);
    assertEquals("run-1", gateway.lastBody.path("testRunId").textValue());
    assertEquals("ci", gateway.lastBody.path("namespace").textValue());

    gateway.searchHits = List.of(record, record("run-1", NOW.plusSeconds(1), "marker two"));
    var runResult = adapter.search(new RunIdLogQuery(
        "run-1", window(), 1, Optional.of("marker")));
    assertEquals(1, runResult.records().size());
    assertTrue(runResult.truncated());
    String runQuery = gateway.lastBody.toString();
    assertTrue(runQuery.contains("\"testRunId\":\"run-1\""));
    assertTrue(runQuery.contains("\"gte\":\"2026-08-28T10:00:00Z\""));
    assertTrue(runQuery.contains("\"lt\":\"2026-08-28T10:15:00Z\""));
    assertTrue(runQuery.contains("\"message\":\"marker\""));

    gateway.searchHits = List.of(record);
    var workloadResult = adapter.search(new WorkloadWindowLogQuery(
        "ci", "payments", window(), 10, Optional.empty()));
    assertEquals(record, workloadResult.records().getFirst());
    assertFalse(workloadResult.truncated());
    String workloadQuery = gateway.lastBody.toString();
    assertTrue(workloadQuery.contains("\"namespace\":\"ci\""));
    assertTrue(workloadQuery.contains("\"workload\":\"payments\""));
  }

  private static TimeWindow window() {
    return new TimeWindow(Instant.parse("2026-08-28T10:00:00Z"), Instant.parse("2026-08-28T10:15:00Z"));
  }

  private static NormalizedLogRecord record(String runId, Instant time, String message) {
    return new NormalizedLogRecord(1, time, message, "ci", "pod-1", "runner", "payments",
        "stdout", Optional.of(runId), Map.of("test.run_id", runId, "log.level", "ERROR"));
  }

  private static final class FakeGateway implements OpenSearchGateway {
    private final List<String> requests = new ArrayList<>();
    private JsonNode policy;
    private JsonNode template;
    private boolean indexExists;
    private boolean closed;
    private String lastEndpoint;
    private JsonNode lastBody = JSON.createObjectNode();
    private List<NormalizedLogRecord> searchHits = List.of();

    @Override
    public Response request(String method, String endpoint, String body) throws IOException {
      requests.add(method + " " + endpoint);
      lastEndpoint = endpoint;
      lastBody = body == null ? JSON.createObjectNode() : JSON.readTree(body);
      if (endpoint.startsWith("/_plugins/_ism/policies/")) {
        if (method.equals("GET")) return policy == null ? response(404, "{}") : response(200, policy.toString());
        policy = JSON.readTree(body).deepCopy();
        ((com.fasterxml.jackson.databind.node.ObjectNode) policy).put("_id", "log-debug-retention-v1");
        return response(200, "{}");
      }
      if (endpoint.equals("/_index_template/log-debug-v1-template")) {
        if (method.equals("GET")) return template == null ? response(404, "{}") : response(200, template.toString());
        template = JSON.readTree(body).deepCopy();
        ((com.fasterxml.jackson.databind.node.ObjectNode) template).put("name", "log-debug-v1-template");
        return response(200, "{}");
      }
      if (endpoint.equals("/log-debug-v1-2026.08.28") && method.equals("PUT")) {
        if (indexExists) return response(400, "{\"error\":{\"type\":\"resource_already_exists_exception\"}}");
        indexExists = true;
        return response(200, "{}");
      }
      if (endpoint.endsWith("/_mapping")) {
        return response(200, "{\"observedAt\":{\"type\":\"date\"},\"namespace\":{\"type\":\"keyword\"},\"message\":{\"type\":\"text\"}}");
      }
      if (endpoint.startsWith("/_plugins/_ism/explain/")) {
        return response(200, "{\"policy_id\":\"log-debug-retention-v1\"}");
      }
      if (endpoint.endsWith("/_doc")) return response(201, "{\"result\":\"created\"}");
      if (endpoint.endsWith("/_search")) return response(200, hits());
      return response(404, "{}");
    }

    int putsTo(String endpoint) {
      return (int) requests.stream().filter(value -> value.equals("PUT " + endpoint)).count();
    }

    private String hits() throws IOException {
      List<Map<String, Object>> hits = new ArrayList<>();
      for (NormalizedLogRecord record : searchHits) hits.add(Map.of("_source", source(record)));
      return JSON.writeValueAsString(Map.of("hits", Map.of("hits", hits)));
    }

    private static Map<String, Object> source(NormalizedLogRecord record) {
      Map<String, Object> source = new LinkedHashMap<>();
      source.put("schemaVersion", record.schemaVersion());
      source.put("observedAt", record.observedAt().toString());
      source.put("message", record.message());
      source.put("namespace", record.namespace());
      source.put("pod", record.pod());
      source.put("container", record.container());
      source.put("workload", record.workload());
      source.put("source", record.source());
      record.testRunId().ifPresent(value -> source.put("testRunId", value));
      source.put("attributes", record.attributes());
      return source;
    }

    private static Response response(int status, String body) throws IOException {
      return new Response(status, JSON.readTree(body));
    }
  }
}

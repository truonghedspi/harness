package io.harness.logcontext.contract;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.harness.logcontext.index.OpenSearchLogIndex;
import io.harness.logcontext.index.OpenSearchLogIndexBootstrap;
import io.harness.logcontext.index.OpenSearchLogIndexConfig;
import io.harness.logcontext.index.RetentionInstallation;
import io.harness.logcontext.ingest.IndexPort;
import io.harness.logcontext.ingest.LogQuery;
import io.harness.logcontext.ingest.LogQueryResult;
import io.harness.logcontext.ingest.NormalizedLogRecord;
import io.harness.logcontext.ingest.RunIdLogQuery;
import io.harness.logcontext.ingest.TimeWindow;
import io.harness.logcontext.ingest.WorkloadWindowLogQuery;
import java.io.InputStream;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.apache.hc.core5.http.HttpHost;
import org.apache.hc.core5.http.message.BasicHeader;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.MethodOrderer.OrderAnnotation;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.junit.jupiter.api.Timeout;
import org.opensearch.client.opensearch.OpenSearchClient;
import org.opensearch.client.opensearch.generic.Requests;
import org.opensearch.client.transport.httpclient5.ApacheHttpClient5Transport;
import org.opensearch.client.transport.httpclient5.ApacheHttpClient5TransportBuilder;

@TestMethodOrder(OrderAnnotation.class)
@Timeout(value = 90, unit = TimeUnit.SECONDS)
final class OpenSearchStorageContractIT {
  private static final ObjectMapper JSON = new ObjectMapper();
  private static ApacheHttpClient5Transport transport;
  private static OpenSearchClient client;
  private static OpenSearchLogIndexConfig config;
  private static RetentionInstallation installation;
  private static IndexPort index;
  private static List<NormalizedLogRecord> records;
  private static String namespace;
  private static String workload;
  private static String runId;
  private static Instant windowStart;
  private static String unavailableReason;

  @BeforeAll
  static void connectToAuthorizedRealStore() throws Exception {
    String endpoint = System.getenv("OPENSEARCH_URL");
    if (endpoint == null || endpoint.isBlank()) {
      unavailableReason = "A-007 checkpoint: OPENSEARCH_URL is unset; a fake store is forbidden";
      return;
    }
    URI uri = URI.create(endpoint);
    var builder = ApacheHttpClient5TransportBuilder.builder(
        new HttpHost(uri.getScheme(), uri.getHost(), uri.getPort()));
    String authorization = System.getenv("OPENSEARCH_AUTHORIZATION");
    if (authorization != null && !authorization.isBlank()) {
      builder.setDefaultHeaders(new BasicHeader[] {new BasicHeader("Authorization", authorization)});
    }
    transport = builder.build();
    client = new OpenSearchClient(transport);

    String suffix = UUID.randomUUID().toString();
    int dayOffset = Math.floorMod(suffix.hashCode(), 3000);
    LocalDate activeDay = LocalDate.of(2080, 1, 1).plusDays(dayOffset);
    windowStart = activeDay.atStartOfDay().toInstant(ZoneOffset.UTC);
    config = new OpenSearchLogIndexConfig("log-debug-v1", Clock.fixed(windowStart.plusSeconds(3600), ZoneOffset.UTC));
    namespace = "contract-" + suffix;
    workload = "workload-" + suffix;
    runId = "run-" + suffix;
    records = fixture(namespace, workload, runId, "other-" + suffix, windowStart);
  }

  @AfterAll
  static void closeCallerOwnedTransport() throws Exception {
    if (transport != null) transport.close();
  }

  @Test
  @Order(1)
  void repeatedAndRacingBootstrapConvergesOnOneIdentity_TCON_INDEX_0006() throws Exception {
    requireStore();
    CountDownLatch start = new CountDownLatch(1);
    try (var executor = Executors.newFixedThreadPool(2)) {
      Future<RetentionInstallation> left = executor.submit(() -> { start.await(); return OpenSearchLogIndexBootstrap.ensureInstalled(client, config); });
      Future<RetentionInstallation> right = executor.submit(() -> { start.await(); return OpenSearchLogIndexBootstrap.ensureInstalled(client, config); });
      start.countDown();
      RetentionInstallation first = left.get();
      assertEquals(first, right.get());
      assertEquals(first, OpenSearchLogIndexBootstrap.ensureInstalled(client, config));
      installation = first;
    }
    assertEquals("log-debug-retention-v1", installation.policyId());
    assertEquals("log-debug-v1-template", installation.templateName());
    assertTrue(installation.activeIndex().matches("log-debug-v1-\\d{4}\\.\\d{2}\\.\\d{2}"));
    assertContains(get("/_cat/indices/" + installation.activeIndex() + "?format=json"), installation.activeIndex());
  }

  @Test
  @Order(2)
  void realPolicyAndExplainProveSevenDayDeletion_TCON_INDEX_0004() throws Exception {
    requireStore();
    assertContains(get("/_plugins/_ism/policies/" + installation.policyId()),
        "default_state", "hot", "min_index_age", "7d", "delete", "log-debug-v1-*");
    assertContains(get("/_plugins/_ism/explain/" + installation.activeIndex()), installation.policyId());
  }

  @Test
  @Order(3)
  void mappingExistsBeforeFirstWrite_TCON_INDEX_0007() throws Exception {
    requireStore();
    JsonNode mapping = get("/" + installation.activeIndex() + "/_mapping");
    assertContains(mapping, "observedAt", "date", "namespace", "pod", "container", "workload",
        "source", "testRunId", "keyword", "message", "text");
    index = new OpenSearchLogIndex(client, installation.activeIndex());
  }

  @Test
  @Order(4)
  void eventDateDoesNotChangeClockSelectedDailyIndex_TCON_INDEX_0005() throws Exception {
    requireStore();
    NormalizedLogRecord lateEvent = new NormalizedLogRecord(1, Instant.parse("2026-08-28T00:00:00Z"),
        "late event", namespace, "late-pod", "runner", workload, "stdout", Optional.empty(), Map.of());
    index.index(lateEvent);
    assertContains(get("/_cat/indices/" + installation.activeIndex() + "?format=json"), installation.activeIndex());
    LocalDate day = LocalDate.parse(installation.activeIndex().substring("log-debug-v1-".length()),
        java.time.format.DateTimeFormatter.ofPattern("uuuu.MM.dd"));
    assertEquals(404, status("/log-debug-v1-" + day.minusDays(1).format(java.time.format.DateTimeFormatter.ofPattern("uuuu.MM.dd"))));
    assertEquals(404, status("/log-debug-v1-" + day.plusDays(1).format(java.time.format.DateTimeFormatter.ofPattern("uuuu.MM.dd"))));
  }

  @Test
  @Order(5)
  void roundTripPreservesEveryNamedField_TCON_INDEX_0001() throws Exception {
    requireStore();
    indexFixtureOnce();
    LogQueryResult result = await(new RunIdLogQuery(runId, window(), 10, Optional.empty()), 1);
    assertEquals(records.getFirst(), result.records().getFirst());
    assertFalse(result.truncated());
  }

  @Test
  @Order(6)
  void runIdNeverFallsBackToNearIdenticalDistractors_TCON_INDEX_0002() throws Exception {
    requireStore();
    indexFixtureOnce();
    LogQueryResult result = await(new RunIdLogQuery(runId, window(), 10, Optional.of("shared marker")), 1);
    assertEquals(List.of(records.getFirst()), result.records());
  }

  @Test
  @Order(7)
  void fallbackRequiresNamespaceWorkloadAndHalfOpenWindow_TCON_INDEX_0003() throws Exception {
    requireStore();
    indexFixtureOnce();
    LogQueryResult result = await(new WorkloadWindowLogQuery(
        namespace, workload, window(), 10, Optional.of("fallback marker")), 1);
    assertEquals(List.of(records.get(3)), result.records());
  }

  private static boolean fixtureIndexed;

  private static void requireStore() {
    Assumptions.assumeTrue(unavailableReason == null, unavailableReason);
  }

  private static synchronized void indexFixtureOnce() {
    if (fixtureIndexed) return;
    records.forEach(index::index);
    fixtureIndexed = true;
  }

  private static TimeWindow window() {
    return new TimeWindow(windowStart, windowStart.plusSeconds(900));
  }

  private static LogQueryResult await(LogQuery query, int expectedCount) throws Exception {
    long deadline = System.nanoTime() + java.time.Duration.ofSeconds(10).toNanos();
    LogQueryResult result;
    do {
      result = index.search(query);
      if (result.records().size() == expectedCount) return result;
      Thread.sleep(100);
    } while (System.nanoTime() < deadline);
    return result;
  }

  private static JsonNode get(String endpoint) throws Exception {
    var request = Requests.builder().method("GET").endpoint(endpoint).build();
    try (var response = client.generic().execute(request)) {
      assertTrue(response.getStatus() >= 200 && response.getStatus() < 300,
          () -> endpoint + " returned HTTP " + response.getStatus());
      return JSON.readTree(response.getBody().orElseThrow().bodyAsBytes());
    }
  }

  private static int status(String endpoint) throws Exception {
    var request = Requests.builder().method("HEAD").endpoint(endpoint).build();
    try (var response = client.generic().execute(request)) {
      return response.getStatus();
    }
  }

  private static void assertContains(JsonNode body, String... values) {
    String text = body.toString();
    for (String value : values) assertTrue(text.contains(value), () -> "real response omitted " + value);
  }

  private static List<NormalizedLogRecord> fixture(
      String namespace, String workload, String runId, String otherRun, Instant start) throws Exception {
    String text;
    try (InputStream input = OpenSearchStorageContractIT.class.getResourceAsStream("/opensearch/records.json")) {
      if (input != null) {
        text = new String(input.readAllBytes(), StandardCharsets.UTF_8);
      } else {
        Path fixture = Path.of("service/src/test/resources/opensearch/records.json");
        if (!Files.isRegularFile(fixture)) throw new IllegalStateException("missing " + fixture);
        text = Files.readString(fixture, StandardCharsets.UTF_8);
      }
    }
    text = text.replace("${NS}", namespace).replace("${WORKLOAD}", workload)
        .replace("${RUN}", runId).replace("${OTHER_RUN}", otherRun);
    List<NormalizedLogRecord> result = new ArrayList<>();
    for (JsonNode value : JSON.readTree(text)) {
      @SuppressWarnings("unchecked")
      Map<String, String> attributes = JSON.convertValue(value.path("attributes"), Map.class);
      JsonNode testRun = value.get("testRunId");
      result.add(new NormalizedLogRecord(1, start.plusSeconds(value.path("offsetSeconds").longValue()),
          value.path("message").textValue(), value.path("namespace").textValue(), value.path("pod").textValue(),
          value.path("container").textValue(), value.path("workload").textValue(), value.path("source").textValue(),
          testRun == null || testRun.isNull() ? Optional.empty() : Optional.of(testRun.textValue()), attributes));
    }
    return result;
  }
}

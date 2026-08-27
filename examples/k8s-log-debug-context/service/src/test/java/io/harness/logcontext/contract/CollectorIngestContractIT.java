/*
 * Conditions: TCON-COLLECTOR-0001, TCON-COLLECTOR-0002, TCON-COLLECTOR-0003,
 *             TCON-COLLECTOR-0004
 * Requirements: INV-SCHEMA-1, INV-META-1, INV-SCOPE-1
 */
package io.harness.logcontext.contract;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.lang.reflect.Constructor;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;

@Timeout(value = 90, unit = TimeUnit.SECONDS)
final class CollectorIngestContractIT {
    private static final String COLLECTOR_PACKAGE = "io.harness.logcontext.collector.";
    private static final String INGEST_PACKAGE = "io.harness.logcontext.ingest.";

    @Test
    void eachEligibleLogBecomesOneUtf8V1ObjectAcceptedBySerializedIngress() throws Exception {
        List<byte[]> requests = collect(resourceFixture(), 2);

        assertEquals(2, requests.size(), "two eligible source rows must produce exactly two requests");
        for (byte[] request : requests) {
            String json = strictUtf8(request);
            assertTrue(json.stripLeading().startsWith("{") && json.stripTrailing().endsWith("}"),
                    "each request body must be one JSON object, not an array or transport envelope");
            assertTrue(json.matches("(?s).*\\\"schemaVersion\\\"\\s*:\\s*1(?:\\s*[,}]).*"),
                    "schemaVersion must be the JSON number 1");
            assertFalse(json.contains("\"resourceLogs\"") || json.contains("\"body\":["),
                    "collector transport or batch envelopes must not cross ingress");
            assertAcceptedByIngest(json);
        }
    }

    @Test
    void generatedDistinctFixturesRoundTripEveryDiagnosticField() throws Exception {
        List<SourceRecord> sources = generatedDistinctRecords();
        List<byte[]> requests = collect(writeFixture(sources), sources.size());
        assertEquals(sources.size(), requests.size(), "every eligible generated row must be exported once");

        Map<String, Map<String, Object>> normalizedByMessage = new LinkedHashMap<>();
        for (byte[] request : requests) {
            Map<String, Object> fields = acceptedFields(strictUtf8(request));
            normalizedByMessage.put((String) fields.get("message"), fields);
        }
        for (SourceRecord source : sources) {
            Map<String, Object> actual = normalizedByMessage.get(source.message());
            assertNotNull(actual, "missing normalized record for " + source.message());
            assertEquals(source.expectedNormalized(), actual, "all named fields must survive the collector/ingest round trip");
        }
    }

    @Test
    void changingOneSourceFieldChangesOnlyItsCorrespondingNormalizedField() throws Exception {
        SourceRecord base = SourceRecord.distinct(20);
        List<SourceRecord> variants = new ArrayList<>();
        variants.add(base);
        for (Field field : Field.values()) variants.add(field.mutate(base));

        List<byte[]> requests = collect(writeFixture(variants), variants.size());
        List<Map<String, Object>> outputs = new ArrayList<>();
        for (byte[] request : requests) {
            outputs.add(acceptedFields(strictUtf8(request)));
        }
        List<Map<String, Object>> expected = variants.stream().map(SourceRecord::expectedNormalized).toList();
        assertEquals(expected.size(), outputs.size());
        for (Map<String, Object> expectedVariant : expected) {
            assertTrue(outputs.contains(expectedVariant),
                    "each single-field mutation must change its corresponding output and leave every other field unchanged: "
                            + expectedVariant);
        }
    }

    @Test
    void onlyOptedInTestRowsCrossTheCaptureIngress() throws Exception {
        List<byte[]> requests = collect(resourceFixture(), 2);
        assertEquals(2, requests.size(), "non-opted-in test and opted-in production rows must both be excluded");
        String combined = requests.stream().map(bytes -> {
            try { return strictUtf8(bytes); } catch (CharacterCodingException e) { throw new AssertionError(e); }
        }).reduce("", String::concat);
        assertTrue(combined.contains("checkout failed") && combined.contains("payment failed"));
        assertFalse(combined.contains("excluded without opt in") || combined.contains("excluded production"));
    }

    private static List<byte[]> collect(Path fixture, int expectedRequests) throws Exception {
        List<byte[]> requests = new CopyOnWriteArrayList<>();
        CountDownLatch delivered = new CountDownLatch(expectedRequests);
        HttpServer server = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0);
        server.createContext("/", exchange -> {
            requests.add(exchange.getRequestBody().readAllBytes());
            delivered.countDown();
            exchange.sendResponseHeaders(202, -1);
            exchange.close();
        });
        server.start();
        Object running = null;
        try {
            URI endpoint = URI.create("http://127.0.0.1:" + server.getAddress().getPort() + "/ingest");
            Class<?> configType = contractType(COLLECTOR_PACKAGE + "CollectorContractConfig");
            Constructor<?> constructor = configType.getConstructor(URI.class, Path.class, Duration.class, Duration.class);
            Object config = constructor.newInstance(endpoint, fixture.getParent(), Duration.ofSeconds(30), Duration.ofSeconds(10));
            Class<?> bootstrap = contractType(COLLECTOR_PACKAGE + "CollectorContractBootstrap");
            running = bootstrap.getMethod("start", configType).invoke(null, config);
            running.getClass().getMethod("awaitReady").invoke(running);
            assertTrue(delivered.await(15, TimeUnit.SECONDS),
                    "collector did not deliver the expected eligible records before the deadline");
        } finally {
            if (running != null) invokeClose(running);
            server.stop(0);
        }
        return List.copyOf(requests);
    }

    private static void assertAcceptedByIngest(String json) throws Exception {
        acceptedFields(json);
    }

    private static Map<String, Object> acceptedFields(String json) throws Exception {
        Class<?> indexPort = contractType(INGEST_PACKAGE + "IndexPort");
        List<Object> documents = new ArrayList<>();
        Object capture = Proxy.newProxyInstance(indexPort.getClassLoader(), new Class<?>[] {indexPort},
                (proxy, method, args) -> {
                    if (method.getName().equals("index")) { documents.add(args[0]); return null; }
                    if (method.getName().equals("toString")) return "CapturingIndexPort";
                    return null;
                });
        Class<?> policy = contractType(INGEST_PACKAGE + "IngestPolicy");
        Object policyValue = policy.getConstructor(Set.class, List.class).newInstance(Set.of("test"), List.of());
        Class<?> service = contractType(INGEST_PACKAGE + "IngestService");
        Object ingest = service.getConstructor(policy, indexPort).newInstance(policyValue, capture);
        Object result = service.getMethod("ingest", String.class).invoke(ingest, json);
        assertEquals("Accepted", result.getClass().getSimpleName(), "collector payload must be accepted by IngestService");
        assertEquals(1, documents.size(), "an accepted payload must cross IndexPort exactly once");
        return normalizedFields(documents.getFirst());
    }

    private static Map<String, Object> normalizedFields(Object document) throws Exception {
        Map<String, Object> result = new LinkedHashMap<>();
        for (String field : List.of("observedAt", "source", "message", "namespace", "pod", "container", "workload", "testRunId")) {
            Method accessor = document.getClass().getMethod(field);
            Object value = accessor.invoke(document);
            if (value instanceof java.util.Optional<?> optional) value = optional.orElse(null);
            result.put(field, value == null ? null : value.toString());
        }
        return result;
    }

    private static Class<?> contractType(String name) {
        try { return Class.forName(name); }
        catch (ClassNotFoundException e) { return fail("required public contract is absent: " + name, e); }
    }

    private static void invokeClose(Object running) throws Exception {
        try { running.getClass().getMethod("close").invoke(running); }
        catch (InvocationTargetException e) { throw rethrow(e); }
    }

    private static Exception rethrow(InvocationTargetException e) {
        if (e.getCause() instanceof Exception exception) return exception;
        throw new AssertionError(e.getCause());
    }

    private static String strictUtf8(byte[] bytes) throws CharacterCodingException {
        return StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString();
    }

    private static Path resourceFixture() throws IOException {
        Path directory = Files.createTempDirectory("collector-contract-");
        Path source = Path.of("service/src/test/resources/collector/pod-logs.json");
        if (!Files.isRegularFile(source)) return fail("missing collector/pod-logs.json fixture");
        Files.copy(source, directory.resolve("pod-logs.json"));
        return directory.resolve("pod-logs.json");
    }

    private static Path writeFixture(List<SourceRecord> records) throws IOException {
        Path directory = Files.createTempDirectory("collector-generated-");
        Files.writeString(directory.resolve("pod-logs.json"), records.stream().map(SourceRecord::json)
                .reduce("", (a, b) -> a + b + "\n"), StandardCharsets.UTF_8);
        return directory.resolve("pod-logs.json");
    }

    private static List<SourceRecord> generatedDistinctRecords() {
        return java.util.stream.IntStream.range(1, 9).mapToObj(SourceRecord::distinct).toList();
    }

    private enum Field {
        OBSERVED_AT("observedAt"), SOURCE("source"), MESSAGE("message"), NAMESPACE("namespace"),
        POD("pod"), CONTAINER("container"), WORKLOAD("workload"), TEST_RUN_ID("testRunId");
        private final String outputName;
        Field(String outputName) { this.outputName = outputName; }
        SourceRecord mutate(SourceRecord base) { return base.with(this, 91 + ordinal()); }
    }

    private record SourceRecord(String observedAt, String source, String message, String namespace,
            String pod, String container, String workload, String testRunId) {
        static SourceRecord distinct(int seed) {
            return new SourceRecord(String.format("2026-08-27T%02d:%02d:00Z", 8 + seed / 60, seed % 60),
                    seed % 2 == 0 ? "stderr" : "stdout", "message-" + seed, "namespace-" + seed,
                    "pod-" + seed, "container-" + seed, "workload-" + seed, "run-" + seed);
        }
        SourceRecord with(Field field, int seed) {
            SourceRecord v = distinct(seed);
            return new SourceRecord(field == Field.OBSERVED_AT ? v.observedAt : observedAt,
                    field == Field.SOURCE ? (source.equals("stdout") ? "stderr" : "stdout") : source,
                    field == Field.MESSAGE ? v.message : message, field == Field.NAMESPACE ? v.namespace : namespace,
                    field == Field.POD ? v.pod : pod, field == Field.CONTAINER ? v.container : container,
                    field == Field.WORKLOAD ? v.workload : workload, field == Field.TEST_RUN_ID ? v.testRunId : testRunId);
        }
        String json() {
            return "{\"observedAt\":\"" + observedAt + "\",\"source\":\"" + source + "\",\"message\":\"" + message
                    + "\",\"kubernetes\":{\"namespace\":\"" + namespace + "\",\"pod\":\"" + pod
                    + "\",\"container\":\"" + container + "\",\"workload\":\"" + workload
                    + "\",\"labels\":{\"debug.logs/enabled\":\"true\",\"environment\":\"test\"}},"
                    + "\"attributes\":{\"test.run_id\":\"" + testRunId + "\"}}";
        }
        Map<String, Object> expectedNormalized() {
            Map<String, Object> values = new LinkedHashMap<>();
            values.put("observedAt", observedAt); values.put("source", source); values.put("message", message);
            values.put("namespace", namespace); values.put("pod", pod); values.put("container", container);
            values.put("workload", workload); values.put("testRunId", testRunId);
            return values;
        }
    }
}

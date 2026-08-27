/*
 * Conditions: TCON-MCP-0001, TCON-MCP-0002, TCON-MCP-0003, TCON-MCP-0004,
 *             TCON-MCP-0005, TCON-MCP-0006, TCON-MCP-0007, TCON-MCP-0008,
 *             TCON-MCP-0009, TCON-MCP-0010
 * Requirements: INV-BOUND-1, INV-READ-1, INV-AUTH-1, INV-TOOLS-1
 */
package io.harness.logcontext.contract;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTimeoutPreemptively;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

import java.io.IOException;
import java.io.InputStream;
import java.lang.reflect.Constructor;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.lang.reflect.Proxy;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Supplier;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;

@Timeout(value = 20, unit = TimeUnit.SECONDS)
class McpHttpContractIT {
    private static final String BOOTSTRAP = "io.harness.logcontext.mcp.McpServiceBootstrap";
    private static final String CONFIG = "io.harness.logcontext.mcp.McpHttpServerConfig";
    private static final String VALIDATOR = "io.harness.logcontext.mcp.ServiceAccountJwtValidator";
    private static final String INDEX_PORT = "io.harness.logcontext.ingest.IndexPort";
    private static final String CONTRACT = contractFixture();
    private static final String PROTOCOL_VERSION = stringValue(CONTRACT, "protocolVersion");
    private static final String VALID_TOKEN = stringValue(CONTRACT, "validBearerToken");
    private static final String INVALID_TOKEN = stringValue(CONTRACT, "invalidBearerToken");
    private static final List<String> EXPECTED_TOOLS = stringArray(CONTRACT, "toolNames");
    private static final int MAX_RECORDS = intValue(CONTRACT, "maximumRecords");
    private static final int MAX_RESPONSE_BYTES = intValue(CONTRACT, "maximumResponseBytes");
    private static final String SEARCH_ARGUMENTS = objectField(CONTRACT, "searchArguments");
    private static final String FAILURE_ARGUMENTS = objectField(CONTRACT, "failureArguments");

    @Test
    void explicitIntervalsBelowAtAndAboveFifteenMinutesEnforceTheBoundary_INV_BOUND_1()
            throws Exception {
        CapturingIndex index = new CapturingIndex(() -> List.of(), false);
        try (Server server = start(index)) {
            Session session = server.openSession();

            assertToolSuccess(session.call(EXPECTED_TOOLS.get(0), searchArguments(
                    "2026-08-26T09:45:00Z", "2026-08-26T09:59:59Z", "")));
            assertToolSuccess(session.call(EXPECTED_TOOLS.get(0), searchArguments(
                    "2026-08-26T09:45:00Z", "2026-08-26T10:00:00Z", "")));
            assertEquals(2, index.searches.size());

            WireResponse aboveLimit = session.call(EXPECTED_TOOLS.get(0), searchArguments(
                    "2026-08-26T09:45:00Z", "2026-08-26T10:00:01Z", ""));
            assertValidationRejected(aboveLimit);
            assertEquals(2, index.searches.size(), "above-limit interval reached IndexPort.search");
        }
    }

    @Test
    void recordLimitReturnsAtMostTwoHundredAndTruthfulTruncation_INV_BOUND_1() throws Exception {
        AtomicReference<List<Object>> supplied = new AtomicReference<>();
        AtomicReference<Boolean> sourceTruncated = new AtomicReference<>(false);
        CapturingIndex index = new CapturingIndex(supplied::get, sourceTruncated::get);
        try (Server server = start(index)) {
            Session session = server.openSession();
            supplied.set(index.records(MAX_RECORDS, 32));
            WireResponse exact = session.call(EXPECTED_TOOLS.get(0), SEARCH_ARGUMENTS);
            assertToolSuccess(exact);
            assertEquals(MAX_RECORDS, occurrences(exact.decodedBody(), "record-marker-"));
            assertTruncated(exact, false);

            supplied.set(index.records(MAX_RECORDS + 1, 32));
            sourceTruncated.set(true);
            WireResponse over = session.call(EXPECTED_TOOLS.get(0), SEARCH_ARGUMENTS);
            assertToolSuccess(over);
            assertTrue(occurrences(over.decodedBody(), "record-marker-") <= MAX_RECORDS,
                    "wire response returned more than 200 records");
            assertTruncated(over, true);
        }
    }

    @Test
    void oversizedContextIsBoundedWithoutPartialRecordsAndReportsTruncation_INV_BOUND_1()
            throws Exception {
        CapturingIndex index = new CapturingIndex(() -> List.of(), true);
        index.recordsSupplier = () -> index.records(12, 32_000);
        try (Server server = start(index)) {
            WireResponse response = server.openSession().call(EXPECTED_TOOLS.get(0), SEARCH_ARGUMENTS);

            assertToolSuccess(response);
            assertTrue(response.rawBytes() <= MAX_RESPONSE_BYTES,
                    () -> "complete wire response was " + response.rawBytes() + " bytes");
            int starts = occurrences(response.decodedBody(), "record-marker-");
            int ends = occurrences(response.decodedBody(), "-record-end-");
            assertTrue(starts > 0, "the bounded response discarded every complete record");
            assertEquals(starts, ends, "the response contains a partial serialized record");
            assertTruncated(response, true);
        }
    }

    @Test
    void stalledIndexQueryTerminatesAsDeadlineErrorWithinFiveSeconds_INV_BOUND_1()
            throws Exception {
        CountDownLatch releaseSearch = new CountDownLatch(1);
        CapturingIndex index = new CapturingIndex(() -> {
            try {
                releaseSearch.await();
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
            }
            return List.of();
        }, false);
        try (Server server = start(index)) {
            Session session = server.openSession();
            try {
                WireResponse response = assertTimeoutPreemptively(Duration.ofMillis(5_750),
                        () -> session.call(EXPECTED_TOOLS.get(0), SEARCH_ARGUMENTS));
                assertDeadlineRejected(response);
                assertEquals(1, index.searches.size());
            } finally {
                releaseSearch.countDown();
            }
        }
    }

    @Test
    void everyPaginationSpellingIsRejectedBeforeIndexQuery_INV_BOUND_1() throws Exception {
        CapturingIndex index = new CapturingIndex(() -> List.of(), false);
        try (Server server = start(index)) {
            Session session = server.openSession();
            for (String forbidden : List.of(
                    "\"cursor\":\"next-1\"",
                    "\"page\":2",
                    "\"offset\":200",
                    "\"continuationToken\":\"next-2\"")) {
                WireResponse response = session.call(EXPECTED_TOOLS.get(0),
                        addObjectMember(SEARCH_ARGUMENTS, forbidden));
                assertValidationRejected(response);
            }
            assertTrue(index.searches.isEmpty(), "a pagination request reached IndexPort.search");
        }
    }

    @Test
    void publishedToolsOnlyQueryAndNeverWriteOrAcquireKubernetesCapability_INV_READ_1()
            throws Exception {
        CapturingIndex index = new CapturingIndex(() -> List.of(), false);
        try (Server server = start(index)) {
            Session session = server.openSession();
            assertToolSuccess(session.call(EXPECTED_TOOLS.get(0), SEARCH_ARGUMENTS));
            assertToolSuccess(session.call(EXPECTED_TOOLS.get(1), FAILURE_ARGUMENTS));
            assertValidationRejected(session.call(EXPECTED_TOOLS.get(0), "{}"));

            assertEquals(2, index.searches.size());
            assertTrue(index.writes.isEmpty(), "an MCP request invoked IndexPort.index");
            assertBootstrapHasOnlyApprovedDependencies();
        }
    }

    @Test
    void authorizationPrecedesDispatchWhileValidJwtReachesNormalValidation_INV_AUTH_1()
            throws Exception {
        CapturingIndex index = new CapturingIndex(() -> List.of(), false);
        try (Server server = start(index)) {
            Session session = server.openSession();
            server.validatedTokens.clear();

            WireResponse valid = session.callWithToken(EXPECTED_TOOLS.get(0), "{}", VALID_TOKEN);
            assertValidationRejected(valid);
            WireResponse missing = session.callWithToken(EXPECTED_TOOLS.get(0), "{}", null);
            assertUnauthorized(missing);
            WireResponse invalid = session.callWithToken(EXPECTED_TOOLS.get(0), "{}", INVALID_TOKEN);
            assertUnauthorized(invalid);

            assertEquals(List.of(Optional.of(VALID_TOKEN), Optional.empty(), Optional.of(INVALID_TOKEN)),
                    server.validatedTokens);
            assertTrue(index.searches.isEmpty(), "an unauthorized or validation-invalid call queried the index");
        }
    }

    @Test
    void initializationAdvertisesExactlyTheToolsCapability_INV_TOOLS_1() throws Exception {
        try (Server server = start(new CapturingIndex(() -> List.of(), false))) {
            WireResponse initialize = server.initialize();
            assertWireSuccess(initialize);
            String result = objectField(initialize.jsonBody(), "result");
            String capabilities = objectField(result, "capabilities");
            assertEquals(Set.of("tools"), topLevelKeys(capabilities));
        }
    }

    @Test
    void toolsListIsExactlySearchAndFailureContextWithoutDuplicates_INV_TOOLS_1()
            throws Exception {
        try (Server server = start(new CapturingIndex(() -> List.of(), false))) {
            WireResponse response = server.openSession().request("tools/list", "{}");
            assertWireSuccess(response);
            String tools = arrayField(objectField(response.jsonBody(), "result"), "tools");
            List<String> names = allStringValues(tools, "name");
            assertEquals(EXPECTED_TOOLS.size(), names.size(), "duplicate or additional tool entry");
            assertEquals(new LinkedHashSet<>(EXPECTED_TOOLS), new LinkedHashSet<>(names));
        }
    }

    @Test
    void anyUnpublishedToolIsRejectedBeforeIndexQuery_INV_TOOLS_1() throws Exception {
        CapturingIndex index = new CapturingIndex(() -> List.of(), false);
        try (Server server = start(index)) {
            WireResponse response = server.openSession().call("delete_logs", SEARCH_ARGUMENTS);
            assertUnknownToolRejected(response);
            assertTrue(index.searches.isEmpty(), "an unpublished tool reached IndexPort.search");
            assertTrue(index.writes.isEmpty(), "an unpublished tool reached IndexPort.index");
        }
    }

    private static Server start(CapturingIndex index) throws Exception {
        Class<?> bootstrapType = contractType(BOOTSTRAP);
        Class<?> configType = contractType(CONFIG);
        Class<?> indexType = contractType(INDEX_PORT);
        Class<?> validatorType = contractType(VALIDATOR);
        Object config = requiredConstructor(configType, InetSocketAddress.class)
                .newInstance(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0));
        List<Optional<String>> validatedTokens = new ArrayList<>();
        Object validator = Proxy.newProxyInstance(
                validatorType.getClassLoader(), new Class<?>[] {validatorType}, (proxy, method, args) -> {
                    if (method.getDeclaringClass() == Object.class) {
                        return objectMethod(proxy, method, args);
                    }
                    Optional<String> bearer = castOptional(args[0]);
                    validatedTokens.add(bearer);
                    return jwtValidation(method.getReturnType(), bearer.filter(VALID_TOKEN::equals).isPresent());
                });
        Object indexProxy = index.proxy(indexType);
        Method start = requiredMethod(bootstrapType, "start", configType, indexType, validatorType);
        assertTrue(Modifier.isStatic(start.getModifiers()), "McpServiceBootstrap.start must be static");
        Object running;
        try {
            running = start.invoke(null, config, indexProxy, validator);
        } catch (InvocationTargetException error) {
            throw new AssertionError("McpServiceBootstrap.start threw before binding the HTTP boundary",
                    error.getCause());
        }
        assertNotNull(running, "McpServiceBootstrap.start returned null");
        URI endpoint = (URI) requiredMethod(running.getClass(), "endpoint").invoke(running);
        assertNotNull(endpoint, "RunningMcpServer.endpoint returned null");
        assertTrue(endpoint.getHost().equals("127.0.0.1") || endpoint.getHost().equals("::1")
                        || endpoint.getHost().equalsIgnoreCase("localhost"),
                () -> "contract server did not bind loopback: " + endpoint);
        assertTrue(endpoint.getPort() > 0, () -> "port 0 was not replaced by an actual bound port: " + endpoint);
        return new Server(running, endpoint, validatedTokens);
    }

    private static final class Server implements AutoCloseable {
        private final Object running;
        private final URI endpoint;
        private final HttpClient client = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(2))
                .build();
        private final List<Optional<String>> validatedTokens;
        private String sessionId;
        private long requestId = 10;

        private Server(Object running, URI endpoint, List<Optional<String>> validatedTokens) {
            this.running = running;
            this.endpoint = endpoint;
            this.validatedTokens = validatedTokens;
        }

        private WireResponse initialize() throws Exception {
            String body = "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{"
                    + "\"protocolVersion\":\"" + PROTOCOL_VERSION + "\",\"capabilities\":{},"
                    + "\"clientInfo\":{\"name\":\"contract-oracle\",\"version\":\"1\"}}}";
            WireResponse response = post(body, VALID_TOKEN, null);
            response.header("Mcp-Session-Id").ifPresent(value -> sessionId = value);
            return response;
        }

        private Session openSession() throws Exception {
            assertWireSuccess(initialize());
            WireResponse initialized = post(
                    "{\"jsonrpc\":\"2.0\",\"method\":\"notifications/initialized\",\"params\":{}}",
                    VALID_TOKEN, sessionId);
            assertTrue(initialized.status() == 202 || initialized.status() == 204
                            || (initialized.status() >= 200 && initialized.status() < 300),
                    () -> "initialized notification failed: " + initialized);
            return new Session(this);
        }

        private WireResponse request(String method, String params) throws Exception {
            return post("{\"jsonrpc\":\"2.0\",\"id\":" + (++requestId) + ",\"method\":\""
                    + method + "\",\"params\":" + params + "}", VALID_TOKEN, sessionId);
        }

        private WireResponse call(String tool, String arguments, String token) throws Exception {
            String params = "{\"name\":\"" + tool + "\",\"arguments\":" + arguments + "}";
            String body = "{\"jsonrpc\":\"2.0\",\"id\":" + (++requestId)
                    + ",\"method\":\"tools/call\",\"params\":" + params + "}";
            return post(body, token, sessionId);
        }

        private WireResponse post(String body, String token, String session) throws Exception {
            HttpRequest.Builder request = HttpRequest.newBuilder(endpoint)
                    .timeout(Duration.ofSeconds(7))
                    .header("Content-Type", "application/json")
                    .header("Accept", "application/json, text/event-stream")
                    .header("MCP-Protocol-Version", PROTOCOL_VERSION)
                    .POST(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8));
            if (token != null) {
                request.header("Authorization", "Bearer " + token);
            }
            if (session != null && !session.isBlank()) {
                request.header("Mcp-Session-Id", session);
            }
            HttpResponse<byte[]> response = client.send(request.build(), HttpResponse.BodyHandlers.ofByteArray());
            return new WireResponse(response.statusCode(), response.body(), response.headers().map());
        }

        @Override
        public void close() throws Exception {
            try {
                requiredMethod(running.getClass(), "close").invoke(running);
            } catch (InvocationTargetException error) {
                throw new AssertionError("RunningMcpServer.close threw", error.getCause());
            }
        }
    }

    private record Session(Server server) {
        private WireResponse request(String method, String params) throws Exception {
            return server.request(method, params);
        }

        private WireResponse call(String tool, String arguments) throws Exception {
            return server.call(tool, arguments, VALID_TOKEN);
        }

        private WireResponse callWithToken(String tool, String arguments, String token) throws Exception {
            return server.call(tool, arguments, token);
        }
    }

    private static final class CapturingIndex {
        private Supplier<List<Object>> recordsSupplier;
        private Supplier<Boolean> truncatedSupplier;
        private final List<Object> searches = new ArrayList<>();
        private final List<Object> writes = new ArrayList<>();
        private Class<?> documentType;
        private Class<?> resultType;

        private CapturingIndex(Supplier<List<Object>> recordsSupplier, boolean truncated) {
            this(recordsSupplier, () -> truncated);
        }

        private CapturingIndex(Supplier<List<Object>> recordsSupplier, Supplier<Boolean> truncatedSupplier) {
            this.recordsSupplier = recordsSupplier;
            this.truncatedSupplier = truncatedSupplier;
        }

        private Object proxy(Class<?> indexType) {
            Method indexMethod = Arrays.stream(indexType.getMethods())
                    .filter(method -> method.getName().equals("index") && method.getParameterCount() == 1)
                    .findFirst().orElseGet(() -> fail("IndexPort.index(NormalizedLogRecord) is absent"));
            Method searchMethod = Arrays.stream(indexType.getMethods())
                    .filter(method -> method.getName().equals("search") && method.getParameterCount() == 1)
                    .findFirst().orElseGet(() -> fail("IndexPort.search(LogQuery) is absent"));
            documentType = indexMethod.getParameterTypes()[0];
            resultType = searchMethod.getReturnType();
            return Proxy.newProxyInstance(indexType.getClassLoader(), new Class<?>[] {indexType},
                    (proxy, method, args) -> {
                        if (method.getDeclaringClass() == Object.class) {
                            return objectMethod(proxy, method, args);
                        }
                        if (method.getName().equals("index")) {
                            writes.add(args[0]);
                            return null;
                        }
                        if (method.getName().equals("search")) {
                            searches.add(args[0]);
                            return newSearchResult(recordsSupplier.get(), truncatedSupplier.get());
                        }
                        return fail("Unexpected IndexPort call: " + method);
                    });
        }

        private Object newSearchResult(List<Object> records, boolean truncated) throws Exception {
            return requiredConstructor(resultType, List.class, boolean.class).newInstance(records, truncated);
        }

        private List<Object> records(int count, int messageLength) {
            List<Object> records = new ArrayList<>(count);
            for (int index = 0; index < count; index++) {
                records.add(newRecord(index, messageLength));
            }
            return List.copyOf(records);
        }

        private Object newRecord(int index, int messageLength) {
            assertTrue(documentType.isRecord(), "NormalizedLogRecord must be a public record contract");
            try {
                Class<?>[] types = Arrays.stream(documentType.getRecordComponents())
                        .map(component -> component.getType()).toArray(Class<?>[]::new);
                Object[] values = Arrays.stream(documentType.getRecordComponents())
                        .map(component -> recordValue(component.getName(), component.getType(), index, messageLength))
                        .toArray();
                return requiredConstructor(documentType, types).newInstance(values);
            } catch (ReflectiveOperationException error) {
                return fail("Cannot construct the approved NormalizedLogRecord contract", error);
            }
        }

        private static Object recordValue(String name, Class<?> type, int index, int messageLength) {
            String suffix = String.format(Locale.ROOT, "%03d", index);
            return switch (name) {
                case "schemaVersion" -> numberValue(type, 1);
                case "observedAt" -> type == Instant.class
                        ? Instant.parse("2026-08-26T09:45:30Z") : "2026-08-26T09:45:30Z";
                case "message" -> "record-marker-" + suffix + "-"
                        + "x".repeat(Math.max(0, messageLength)) + "-record-end-" + suffix;
                case "namespace" -> "ci-payments";
                case "pod" -> "payments-test-pod";
                case "container" -> "test-runner";
                case "workload" -> "payments-test";
                case "source" -> sourceValue(type);
                case "testRunId" -> type == Optional.class ? Optional.of("run-8842") : "run-8842";
                case "attributes" -> Map.of("log.level", "ERROR", "test.run_id", "run-8842");
                default -> fail("Unspecified normalized record component in approved v1 contract: " + name);
            };
        }
    }

    private record WireResponse(int status, byte[] bodyBytes, Map<String, List<String>> headers) {
        private int rawBytes() {
            return bodyBytes.length;
        }

        private String rawBody() {
            return new String(bodyBytes, StandardCharsets.UTF_8);
        }

        private String jsonBody() {
            String raw = rawBody();
            return raw.lines()
                    .filter(line -> line.startsWith("data:"))
                    .map(line -> line.substring("data:".length()).stripLeading())
                    .filter(line -> !line.equals("[DONE]"))
                    .findFirst()
                    .orElse(raw);
        }

        private String decodedBody() {
            return jsonBody().replace("\\\"", "\"").replace("\\\\", "\\");
        }

        private Optional<String> header(String name) {
            return headers.entrySet().stream()
                    .filter(entry -> entry.getKey().equalsIgnoreCase(name))
                    .flatMap(entry -> entry.getValue().stream())
                    .findFirst();
        }

        @Override
        public String toString() {
            return "HTTP " + status + " " + rawBody();
        }
    }

    private static void assertWireSuccess(WireResponse response) {
        assertTrue(response.status >= 200 && response.status < 300,
                () -> "expected successful HTTP response, got " + response);
        assertFalse(hasTopLevelField(response.jsonBody(), "error"),
                () -> "expected JSON-RPC success, got " + response);
    }

    private static void assertToolSuccess(WireResponse response) {
        assertWireSuccess(response);
        String decoded = compact(response.decodedBody());
        assertFalse(decoded.contains("\"isError\":true"), () -> "tool returned an error: " + response);
    }

    private static void assertValidationRejected(WireResponse response) {
        assertFalse(response.status == 401 || response.status == 403,
                () -> "valid JWT was rejected before normal validation: " + response);
        assertRejected(response, "validation", "invalid", "-32602");
    }

    private static void assertDeadlineRejected(WireResponse response) {
        assertRejected(response, "deadline", "timeout", "timed out");
    }

    private static void assertUnknownToolRejected(WireResponse response) {
        assertRejected(response, "unknown tool", "not found", "-32601");
    }

    private static void assertUnauthorized(WireResponse response) {
        assertTrue(response.status == 401 || response.status == 403,
                () -> "missing/invalid JWT was not rejected as unauthorized: " + response);
    }

    private static void assertRejected(WireResponse response, String... expectedSignals) {
        String compactBody = compact(response.decodedBody()).toLowerCase(Locale.ROOT);
        boolean structuredError = response.status >= 400
                || hasTopLevelField(response.jsonBody(), "error")
                || compactBody.contains("\"iserror\":true");
        assertTrue(structuredError, () -> "expected a structured rejection, got " + response);
        assertTrue(Arrays.stream(expectedSignals).anyMatch(
                        signal -> compactBody.contains(signal.toLowerCase(Locale.ROOT))),
                () -> "rejection did not identify " + List.of(expectedSignals) + ": " + response);
    }

    private static void assertTruncated(WireResponse response, boolean expected) {
        String body = compact(response.decodedBody()).toLowerCase(Locale.ROOT);
        assertTrue(body.contains("\"truncated\":" + expected),
                () -> "response did not report truncated=" + expected + ": " + response);
    }

    private static void assertBootstrapHasOnlyApprovedDependencies() {
        Method start = Arrays.stream(contractType(BOOTSTRAP).getMethods())
                .filter(method -> method.getName().equals("start") && Modifier.isStatic(method.getModifiers()))
                .findFirst().orElseGet(() -> fail("McpServiceBootstrap.start is absent"));
        assertEquals(List.of(CONFIG, INDEX_PORT, VALIDATOR),
                Arrays.stream(start.getParameterTypes()).map(Class::getName).toList(),
                "MCP bootstrap acquired an unapproved privileged dependency");
    }

    private static Object jwtValidation(Class<?> validationType, boolean valid) throws Exception {
        Class<?> selected = Arrays.stream(validationType.getPermittedSubclasses())
                .filter(type -> type.getSimpleName().equals(valid ? "Valid" : "Invalid"))
                .findFirst().orElseGet(() -> fail("JwtValidation lacks " + (valid ? "Valid" : "Invalid")));
        return requiredConstructor(selected).newInstance();
    }

    private static Object objectMethod(Object proxy, Method method, Object[] args) {
        return switch (method.getName()) {
            case "toString" -> "contract-capturing-proxy";
            case "hashCode" -> System.identityHashCode(proxy);
            case "equals" -> proxy == args[0];
            default -> throw new AssertionError("Unexpected Object method " + method);
        };
    }

    @SuppressWarnings("unchecked")
    private static Optional<String> castOptional(Object value) {
        assertTrue(value instanceof Optional<?>, "validator must receive Optional bearer token");
        return (Optional<String>) value;
    }

    private static Object sourceValue(Class<?> type) {
        if (type == String.class) {
            return "stdout";
        }
        if (type.isEnum()) {
            return Arrays.stream(type.getEnumConstants())
                    .filter(value -> value.toString().equalsIgnoreCase("stdout"))
                    .findFirst().orElseGet(() -> fail("source enum lacks stdout"));
        }
        return fail("Unsupported source component type: " + type.getName());
    }

    private static Object numberValue(Class<?> type, int value) {
        if (type == int.class || type == Integer.class) {
            return value;
        }
        if (type == long.class || type == Long.class) {
            return (long) value;
        }
        return fail("Unsupported schemaVersion component type: " + type.getName());
    }

    private static Class<?> contractType(String className) {
        try {
            return Class.forName(className);
        } catch (ClassNotFoundException error) {
            return fail("Required public MCP contract is absent: " + className, error);
        }
    }

    private static Constructor<?> requiredConstructor(Class<?> type, Class<?>... parameters) {
        try {
            return type.getConstructor(parameters);
        } catch (NoSuchMethodException error) {
            return fail("Required public constructor is absent on " + type.getName(), error);
        }
    }

    private static Method requiredMethod(Class<?> type, String name, Class<?>... parameters) {
        try {
            return type.getMethod(name, parameters);
        } catch (NoSuchMethodException error) {
            return fail("Required public method is absent: " + type.getName() + "." + name, error);
        }
    }

    private static String searchArguments(String from, String to, String extraMember) {
        String updated = replaceJsonString(SEARCH_ARGUMENTS, "fromInclusive", from);
        updated = replaceJsonString(updated, "toExclusive", to);
        return extraMember.isBlank() ? updated : addObjectMember(updated, extraMember);
    }

    private static String addObjectMember(String object, String member) {
        int closing = object.lastIndexOf('}');
        assertTrue(closing >= 0, "JSON object has no closing brace");
        String prefix = object.substring(0, closing).stripTrailing();
        return prefix + (prefix.endsWith("{") ? "" : ",") + member + "}";
    }

    private static String replaceJsonString(String object, String key, String value) {
        Pattern pattern = Pattern.compile("(\\\"" + Pattern.quote(key) + "\\\"\\s*:\\s*\\\")[^\\\"]*(\\\")");
        Matcher matcher = pattern.matcher(object);
        assertTrue(matcher.find(), () -> "contract fixture lacks " + key);
        return matcher.replaceFirst(Matcher.quoteReplacement(matcher.group(1) + value + matcher.group(2)));
    }

    private static String contractFixture() {
        try (InputStream input = McpHttpContractIT.class.getResourceAsStream("/contracts/mcp-tools.json")) {
            if (input != null) {
                return new String(input.readAllBytes(), StandardCharsets.UTF_8);
            }
        } catch (IOException error) {
            throw new ExceptionInInitializerError(error);
        }
        Path fixture = Path.of("service/src/test/resources/contracts/mcp-tools.json");
        try {
            assertTrue(Files.isRegularFile(fixture), () -> "Missing contract fixture " + fixture);
            return Files.readString(fixture, StandardCharsets.UTF_8);
        } catch (IOException error) {
            throw new ExceptionInInitializerError(error);
        }
    }

    private static String stringValue(String json, String key) {
        Matcher matcher = Pattern.compile("\\\"" + Pattern.quote(key) + "\\\"\\s*:\\s*\\\"([^\\\"]*)\\\"")
                .matcher(json);
        assertTrue(matcher.find(), () -> "JSON lacks string field " + key);
        return matcher.group(1);
    }

    private static int intValue(String json, String key) {
        Matcher matcher = Pattern.compile("\\\"" + Pattern.quote(key) + "\\\"\\s*:\\s*(\\d+)").matcher(json);
        assertTrue(matcher.find(), () -> "JSON lacks integer field " + key);
        return Integer.parseInt(matcher.group(1));
    }

    private static List<String> stringArray(String json, String key) {
        return allQuotedStrings(arrayField(json, key));
    }

    private static List<String> allQuotedStrings(String json) {
        Matcher matcher = Pattern.compile("\\\"([^\\\"]*)\\\"").matcher(json);
        List<String> values = new ArrayList<>();
        while (matcher.find()) {
            values.add(matcher.group(1));
        }
        return List.copyOf(values);
    }

    private static List<String> allStringValues(String json, String key) {
        Matcher matcher = Pattern.compile("\\\"" + Pattern.quote(key) + "\\\"\\s*:\\s*\\\"([^\\\"]*)\\\"")
                .matcher(json);
        List<String> values = new ArrayList<>();
        while (matcher.find()) {
            values.add(matcher.group(1));
        }
        return List.copyOf(values);
    }

    private static String objectField(String json, String key) {
        return structuredField(json, key, '{', '}');
    }

    private static String arrayField(String json, String key) {
        return structuredField(json, key, '[', ']');
    }

    private static String structuredField(String json, String key, char open, char close) {
        Matcher field = Pattern.compile("\\\"" + Pattern.quote(key) + "\\\"\\s*:").matcher(json);
        assertTrue(field.find(), () -> "JSON lacks field " + key + ": " + json);
        int start = skipWhitespace(json, field.end());
        assertTrue(start < json.length() && json.charAt(start) == open,
                () -> key + " is not the expected JSON structure: " + json);
        int depth = 0;
        boolean quoted = false;
        boolean escaped = false;
        for (int index = start; index < json.length(); index++) {
            char current = json.charAt(index);
            if (quoted) {
                if (escaped) {
                    escaped = false;
                } else if (current == '\\') {
                    escaped = true;
                } else if (current == '"') {
                    quoted = false;
                }
                continue;
            }
            if (current == '"') {
                quoted = true;
            } else if (current == open) {
                depth++;
            } else if (current == close && --depth == 0) {
                return json.substring(start, index + 1);
            }
        }
        return fail("Unclosed JSON field " + key + ": " + json);
    }

    private static Set<String> topLevelKeys(String object) {
        Set<String> keys = new LinkedHashSet<>();
        int index = 1;
        while (index < object.length() - 1) {
            index = skipWhitespaceAndCommas(object, index);
            if (index >= object.length() - 1) {
                break;
            }
            assertEquals('"', object.charAt(index), "JSON object key must be quoted");
            int end = findStringEnd(object, index + 1);
            keys.add(object.substring(index + 1, end));
            index = skipWhitespace(object, end + 1);
            assertEquals(':', object.charAt(index), "JSON object key lacks colon");
            index = skipJsonValue(object, index + 1);
        }
        return Set.copyOf(keys);
    }

    private static boolean hasTopLevelField(String object, String key) {
        try {
            return topLevelKeys(object).contains(key);
        } catch (AssertionError malformed) {
            return false;
        }
    }

    private static int skipJsonValue(String json, int index) {
        index = skipWhitespace(json, index);
        if (json.charAt(index) == '{') {
            return skipBalanced(json, index, '{', '}');
        }
        if (json.charAt(index) == '[') {
            return skipBalanced(json, index, '[', ']');
        }
        if (json.charAt(index) == '"') {
            return findStringEnd(json, index + 1) + 1;
        }
        while (index < json.length() && ",}".indexOf(json.charAt(index)) < 0) {
            index++;
        }
        return index;
    }

    private static int skipBalanced(String json, int start, char open, char close) {
        int depth = 0;
        boolean quoted = false;
        boolean escaped = false;
        for (int index = start; index < json.length(); index++) {
            char current = json.charAt(index);
            if (quoted) {
                if (escaped) {
                    escaped = false;
                } else if (current == '\\') {
                    escaped = true;
                } else if (current == '"') {
                    quoted = false;
                }
            } else if (current == '"') {
                quoted = true;
            } else if (current == open) {
                depth++;
            } else if (current == close && --depth == 0) {
                return index + 1;
            }
        }
        return fail("Unclosed JSON structure");
    }

    private static int findStringEnd(String json, int start) {
        boolean escaped = false;
        for (int index = start; index < json.length(); index++) {
            char current = json.charAt(index);
            if (escaped) {
                escaped = false;
            } else if (current == '\\') {
                escaped = true;
            } else if (current == '"') {
                return index;
            }
        }
        return fail("Unclosed JSON string");
    }

    private static int skipWhitespace(String value, int index) {
        while (index < value.length() && Character.isWhitespace(value.charAt(index))) {
            index++;
        }
        return index;
    }

    private static int skipWhitespaceAndCommas(String value, int index) {
        while (index < value.length()
                && (Character.isWhitespace(value.charAt(index)) || value.charAt(index) == ',')) {
            index++;
        }
        return index;
    }

    private static int occurrences(String value, String token) {
        int count = 0;
        int offset = 0;
        while ((offset = value.indexOf(token, offset)) >= 0) {
            count++;
            offset += token.length();
        }
        return count;
    }

    private static String compact(String value) {
        return value.replaceAll("\\s+", "");
    }
}

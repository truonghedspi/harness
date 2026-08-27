/*
 * Conditions: TCON-INGEST-0001, TCON-INGEST-0002, TCON-INGEST-0003,
 *             TCON-INGEST-0004, TCON-INGEST-0005
 * Requirements: INV-SCOPE-1, INV-REDACT-1, INV-META-1, INV-SCHEMA-1
 */
package io.harness.logcontext.contract;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

import java.io.IOException;
import java.io.InputStream;
import java.lang.reflect.Constructor;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;

class IngestContractTest {
    private static final String SECRET = "token-9Z!";
    private static final String REDACTED = "[REDACTED]";

    @Test
    void onlyOptedInNonProductionRecordsReachTheIndex_INV_SCOPE_1() throws Exception {
        Invocation accepted = invoke(basePayload(), List.of());
        assertAccepted(accepted);
        assertEquals(1, accepted.documents().size());

        for (String outOfScope : List.of(
                replace(basePayload(), "\"optIn\": true", "\"optIn\": false"),
                removeLine(basePayload(), "optIn"),
                replace(basePayload(), "\"environment\": \"test\"", "\"environment\": \"production\""))) {
            Invocation rejected = invoke(outOfScope, List.of());
            assertRejected(rejected, "OUT_OF_SCOPE");
            assertTrue(rejected.documents().isEmpty(), "out-of-scope input must not cross IndexPort");
        }
    }

    @Test
    void configuredSecretsAreRedactedInEverySupportedLocation_INV_REDACT_1() throws Exception {
        List<RedactionCase> cases = List.of(
                new RedactionCase("before " + SECRET + " after " + SECRET, "safe-attribute",
                        "before " + REDACTED + " after " + REDACTED, "safe-attribute"),
                new RedactionCase("safe-message", SECRET + " in attribute",
                        "safe-message", REDACTED + " in attribute"),
                new RedactionCase("message=" + SECRET, "attribute=" + SECRET,
                        "message=" + REDACTED, "attribute=" + REDACTED),
                new RedactionCase("safe-message", "safe-attribute", "safe-message", "safe-attribute"));

        for (RedactionCase testCase : cases) {
            String payload = replace(basePayload(),
                    "\"message\": \"payment test failed\"",
                    "\"message\": \"" + testCase.message() + "\"");
            payload = replace(payload,
                    "\"log.level\": \"ERROR\"",
                    "\"log.level\": \"" + testCase.attributeValue() + "\"");

            Invocation invocation = invoke(payload, List.of(SECRET));
            assertAccepted(invocation);
            assertEquals(1, invocation.documents().size());
            Object document = invocation.documents().getFirst();
            assertEquals(testCase.expectedMessage(), component(document, "message"));
            Map<?, ?> attributes = assertInstanceOf(Map.class, component(document, "attributes"));
            assertEquals(testCase.expectedAttributeValue(), attributes.get("log.level"));
            assertEquals("run-8842", attributes.get("test.run_id"));
            assertFalse((String.valueOf(component(document, "message")) + attributes).contains(SECRET),
                    "an original configured secret crossed IndexPort");
        }
    }

    @Test
    void everyRequiredIdentityFieldIsRejectedWhenMissingOrBlank_INV_META_1() throws Exception {
        Map<String, String> values = Map.of(
                "namespace", "ci-payments",
                "pod", "payments-test-7dc9b",
                "container", "test-runner",
                "workload", "payments-test",
                "observedAt", "2026-08-26T09:45:00Z",
                "source", "stdout");

        for (Map.Entry<String, String> field : values.entrySet()) {
            for (String invalidPayload : List.of(
                    removeLine(basePayload(), field.getKey()),
                    replace(basePayload(),
                            "\"" + field.getKey() + "\": \"" + field.getValue() + "\"",
                            "\"" + field.getKey() + "\": \"   \""))) {
                Invocation rejected = invoke(invalidPayload, List.of());
                assertRejectedWithAnyCode(rejected, "INVALID_METADATA", "INVALID_SOURCE");
                assertTrue(rejected.documents().isEmpty(),
                        field.getKey() + " failure must not cross IndexPort");
            }
        }
    }

    @Test
    void additiveV1FieldsAreIgnoredWithoutChangingNormalizedFields_INV_SCHEMA_1() throws Exception {
        String additivePayload = addTopLevelMember(basePayload(),
                "\"futureEnvelope\": \"shadow-value-334\"");

        Invocation invocation = invoke(additivePayload, List.of());
        assertAccepted(invocation);
        assertEquals(1, invocation.documents().size(), "accepted input must cross IndexPort exactly once");

        Object document = invocation.documents().getFirst();
        Number schemaVersion = assertInstanceOf(Number.class, component(document, "schemaVersion"));
        assertEquals(1, schemaVersion.intValue());
        assertEquals("2026-08-26T09:45:00Z", component(document, "observedAt").toString());
        assertEquals("payment test failed", component(document, "message"));
        assertEquals("ci-payments", component(document, "namespace"));
        assertEquals("payments-test-7dc9b", component(document, "pod"));
        assertEquals("test-runner", component(document, "container"));
        assertEquals("payments-test", component(document, "workload"));
        assertEquals("stdout", component(document, "source").toString());
        assertEquals("run-8842", unwrapOptional(component(document, "testRunId")));
        assertEquals(Map.of("test.run_id", "run-8842", "log.level", "ERROR"),
                component(document, "attributes"));
    }

    @Test
    void unsupportedMajorVersionIsRejectedBeforeIndexing_INV_SCHEMA_1() throws Exception {
        String unsupported = replace(basePayload(), "\"schemaVersion\": 1", "\"schemaVersion\": 2");

        Invocation invocation = invoke(unsupported, List.of());

        assertRejected(invocation, "UNSUPPORTED_SCHEMA_VERSION");
        assertTrue(invocation.documents().isEmpty(), "unsupported major input must not cross IndexPort");
    }

    private static Invocation invoke(String payload, List<String> redactionLiterals) throws Exception {
        Class<?> serviceType = contractType("io.harness.logcontext.ingest.IngestService");
        Class<?> policyType = contractType("io.harness.logcontext.ingest.IngestPolicy");
        Class<?> indexPortType = contractType("io.harness.logcontext.ingest.IndexPort");
        List<Object> documents = new ArrayList<>();
        Object indexPort = Proxy.newProxyInstance(
                indexPortType.getClassLoader(),
                new Class<?>[] {indexPortType},
                (proxy, method, args) -> {
                    if (method.getName().equals("index")) {
                        documents.add(args[0]);
                    }
                    return null;
                });
        Constructor<?> policyConstructor = requiredConstructor(policyType, Set.class, List.class);
        Object policy = policyConstructor.newInstance(Set.of("test"), redactionLiterals);
        Constructor<?> serviceConstructor = requiredConstructor(serviceType, policyType, indexPortType);
        Object service = serviceConstructor.newInstance(policy, indexPort);
        Method ingest = requiredMethod(serviceType, "ingest", String.class);
        try {
            return new Invocation(ingest.invoke(service, payload), List.copyOf(documents));
        } catch (InvocationTargetException error) {
            throw new AssertionError("ingest(String) threw instead of returning the stable contract result",
                    error.getCause());
        }
    }

    private static Class<?> contractType(String className) {
        try {
            return Class.forName(className);
        } catch (ClassNotFoundException error) {
            return fail("Required public ingest contract is absent: " + className, error);
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

    private static Object component(Object record, String name) throws Exception {
        Method accessor = requiredMethod(record.getClass(), name);
        try {
            return accessor.invoke(record);
        } catch (InvocationTargetException error) {
            throw new AssertionError("Normalized document accessor threw: " + name, error.getCause());
        }
    }

    private static Object unwrapOptional(Object value) {
        return value instanceof Optional<?> optional ? optional.orElse(null) : value;
    }

    private static void assertAccepted(Invocation invocation) {
        assertEquals("Accepted", invocation.result().getClass().getSimpleName());
    }

    private static void assertRejected(Invocation invocation, String expectedCode) throws Exception {
        assertEquals("Rejected", invocation.result().getClass().getSimpleName());
        assertEquals(expectedCode, component(invocation.result(), "code"));
    }

    private static void assertRejectedWithAnyCode(Invocation invocation, String... allowedCodes)
            throws Exception {
        assertEquals("Rejected", invocation.result().getClass().getSimpleName());
        String actualCode = String.valueOf(component(invocation.result(), "code"));
        assertTrue(Stream.of(allowedCodes).anyMatch(actualCode::equals),
                () -> "expected rejection code in " + List.of(allowedCodes) + " but was " + actualCode);
    }

    private static String basePayload() throws IOException {
        try (InputStream input = IngestContractTest.class.getResourceAsStream("/contracts/ingest-v1.json")) {
            if (input != null) {
                return new String(input.readAllBytes(), StandardCharsets.UTF_8);
            }
        }
        Path fixture = Path.of("service/src/test/resources/contracts/ingest-v1.json");
        assertTrue(Files.isRegularFile(fixture), () -> "Missing contract fixture " + fixture);
        return Files.readString(fixture, StandardCharsets.UTF_8);
    }

    private static String replace(String input, String target, String replacement) {
        assertTrue(input.contains(target), () -> "fixture does not contain expected token: " + target);
        return input.replace(target, replacement);
    }

    private static String removeLine(String input, String field) {
        String marker = "  \"" + field + "\":";
        int start = input.indexOf(marker);
        assertTrue(start >= 0, () -> "fixture does not contain expected field: " + field);
        int end = input.indexOf('\n', start);
        assertTrue(end >= 0, () -> "fixture field has no line ending: " + field);
        return input.substring(0, start) + input.substring(end + 1);
    }

    private static String addTopLevelMember(String input, String member) {
        int closingBrace = input.lastIndexOf('}');
        assertTrue(closingBrace > 0, "fixture has no top-level closing brace");
        return input.substring(0, closingBrace).stripTrailing() + ",\n  " + member + "\n}\n";
    }

    private record Invocation(Object result, List<Object> documents) {}

    private record RedactionCase(
            String message,
            String attributeValue,
            String expectedMessage,
            String expectedAttributeValue) {}
}

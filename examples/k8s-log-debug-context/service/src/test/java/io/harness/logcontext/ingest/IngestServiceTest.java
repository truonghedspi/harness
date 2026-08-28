package io.harness.logcontext.ingest;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

import java.lang.reflect.Proxy;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;

final class IngestServiceTest {
  private static final String VALID = """
      {"schemaVersion":1,"observedAt":"2026-08-26T09:45:00Z",
       "message":"token secret token","namespace":"ci","pod":"pod-1",
       "container":"runner","workload":"payments","source":"stdout",
       "optIn":true,"environment":"test",
       "attributes":{"test.run_id":"run-1","detail":"token"}}
      """;

  @Test
  void acceptsExactlyOneSanitizedNormalizedDocument() throws Exception {
    Invocation invocation = invoke(VALID, List.of("token"));
    assertEquals("Accepted", invocation.result().getClass().getSimpleName());
    assertEquals(1, invocation.documents().size());
    Object document = invocation.documents().getFirst();
    assertEquals("[REDACTED] secret [REDACTED]", component(document, "message"));
    assertEquals(Map.of("test.run_id", "run-1", "detail", "[REDACTED]"),
        component(document, "attributes"));
    assertEquals("run-1", ((java.util.Optional<?>) component(document, "testRunId")).orElseThrow());
  }

  @Test
  void rejectsInvalidPartitionsWithoutIndexing() throws Exception {
    Map<String, String> cases = Map.of(
        "{", "INVALID_JSON",
        VALID.replace("\"optIn\":true", "\"optIn\":false"), "OUT_OF_SCOPE",
        VALID.replace("\"schemaVersion\":1", "\"schemaVersion\":2"), "UNSUPPORTED_SCHEMA_VERSION",
        VALID.replace("\"namespace\":\"ci\"", "\"namespace\":\" \""), "INVALID_METADATA",
        VALID.replace("\"source\":\"stdout\"", "\"source\":\"file\""), "INVALID_SOURCE");

    for (Map.Entry<String, String> testCase : cases.entrySet()) {
      Invocation invocation = invoke(testCase.getKey(), List.of());
      assertEquals("Rejected", invocation.result().getClass().getSimpleName());
      assertEquals(testCase.getValue(), component(invocation.result(), "code"));
      assertTrue(invocation.documents().isEmpty());
    }
  }

  private static Invocation invoke(String json, List<String> secrets) throws Exception {
    Class<?> serviceType = type("io.harness.logcontext.ingest.IngestService");
    Class<?> policyType = type("io.harness.logcontext.ingest.IngestPolicy");
    Class<?> portType = type("io.harness.logcontext.ingest.IndexPort");
    List<Object> documents = new ArrayList<>();
    Object port = Proxy.newProxyInstance(portType.getClassLoader(), new Class<?>[] {portType},
        (proxy, method, args) -> {
          if (method.getName().equals("index")) documents.add(args[0]);
          return null;
        });
    Object policy = policyType.getConstructor(Set.class, List.class)
        .newInstance(Set.of("test"), secrets);
    Object service = serviceType.getConstructor(policyType, portType).newInstance(policy, port);
    return new Invocation(serviceType.getMethod("ingest", String.class).invoke(service, json), documents);
  }

  private static Class<?> type(String name) {
    try {
      return Class.forName(name);
    } catch (ClassNotFoundException error) {
      return fail("required ingest contract is absent: " + name, error);
    }
  }

  private static Object component(Object value, String name) throws Exception {
    return value.getClass().getMethod(name).invoke(value);
  }

  private record Invocation(Object result, List<Object> documents) {}
}

package io.harness.logcontext.ingest;

import java.time.DateTimeException;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;

public final class IngestService {
  private static final String REDACTED = "[REDACTED]";
  private final IngestPolicy policy;
  private final IndexPort indexPort;

  public IngestService(IngestPolicy policy, IndexPort indexPort) {
    this.policy = Objects.requireNonNull(policy);
    this.indexPort = Objects.requireNonNull(indexPort);
  }

  public IngestResult ingest(String serializedJson) {
    final Map<String, Object> input;
    try {
      Object parsed = new JsonParser(serializedJson).parse();
      if (!(parsed instanceof Map<?, ?> object)) return rejected("INVALID_JSON");
      input = stringKeyed(object);
    } catch (RuntimeException error) {
      return rejected("INVALID_JSON");
    }

    Object version = input.get("schemaVersion");
    if (!(version instanceof Long numericVersion)) return rejected("INVALID_JSON");
    if (numericVersion != 1L) return rejected("UNSUPPORTED_SCHEMA_VERSION");

    if (!Boolean.TRUE.equals(input.get("optIn"))) return rejected("OUT_OF_SCOPE");
    String environment = string(input, "environment");
    if (environment == null || !policy.allowedEnvironments().contains(environment)) {
      return rejected("OUT_OF_SCOPE");
    }

    String namespace = nonBlank(input, "namespace");
    String pod = nonBlank(input, "pod");
    String container = nonBlank(input, "container");
    String workload = nonBlank(input, "workload");
    String message = string(input, "message");
    String observedAtText = nonBlank(input, "observedAt");
    if (namespace == null || pod == null || container == null || workload == null
        || message == null || observedAtText == null) return rejected("INVALID_METADATA");

    final Instant observedAt;
    try {
      observedAt = Instant.parse(observedAtText);
    } catch (DateTimeException error) {
      return rejected("INVALID_METADATA");
    }

    String source = nonBlank(input, "source");
    if (!"stdout".equals(source) && !"stderr".equals(source)) return rejected("INVALID_SOURCE");

    Map<String, String> attributes = attributes(input.get("attributes"));
    if (attributes == null) return rejected("INVALID_METADATA");
    String testRunId = attributes.get("test.run_id");
    if (testRunId != null && testRunId.isBlank()) return rejected("INVALID_METADATA");

    Map<String, String> sanitizedAttributes = new LinkedHashMap<>();
    attributes.forEach((key, value) -> sanitizedAttributes.put(key, redact(value)));
    NormalizedLogRecord document = new NormalizedLogRecord(
        1, observedAt, redact(message), namespace, pod, container, workload, source,
        Optional.ofNullable(testRunId), sanitizedAttributes);
    indexPort.index(document);
    return new IngestResult.Accepted();
  }

  private String redact(String value) {
    String sanitized = value;
    for (String literal : policy.redactionLiterals()) sanitized = sanitized.replace(literal, REDACTED);
    return sanitized;
  }

  private static Map<String, Object> stringKeyed(Map<?, ?> input) {
    Map<String, Object> result = new LinkedHashMap<>();
    for (Map.Entry<?, ?> entry : input.entrySet()) {
      if (!(entry.getKey() instanceof String key)) throw new IllegalArgumentException("non-string key");
      result.put(key, entry.getValue());
    }
    return result;
  }

  private static Map<String, String> attributes(Object value) {
    if (!(value instanceof Map<?, ?> object)) return null;
    Map<String, String> result = new LinkedHashMap<>();
    for (Map.Entry<?, ?> entry : object.entrySet()) {
      if (!(entry.getKey() instanceof String key) || !(entry.getValue() instanceof String text)) return null;
      result.put(key, text);
    }
    return result;
  }

  private static String string(Map<String, Object> input, String key) {
    return input.get(key) instanceof String value ? value : null;
  }

  private static String nonBlank(Map<String, Object> input, String key) {
    String value = string(input, key);
    return value == null || value.isBlank() ? null : value;
  }

  private static IngestResult rejected(String code) {
    return new IngestResult.Rejected(code);
  }

  private static final class JsonParser {
    private final String input;
    private int position;

    JsonParser(String input) {
      this.input = Objects.requireNonNull(input);
    }

    Object parse() {
      skipWhitespace();
      Object value = value();
      skipWhitespace();
      if (position != input.length()) fail();
      return value;
    }

    private Object value() {
      if (position >= input.length()) return fail();
      return switch (input.charAt(position)) {
        case '{' -> object();
        case '[' -> array();
        case '"' -> string();
        case 't' -> literal("true", Boolean.TRUE);
        case 'f' -> literal("false", Boolean.FALSE);
        case 'n' -> literal("null", null);
        default -> number();
      };
    }

    private Map<String, Object> object() {
      position++;
      Map<String, Object> result = new LinkedHashMap<>();
      skipWhitespace();
      if (take('}')) return result;
      while (true) {
        skipWhitespace();
        if (position >= input.length() || input.charAt(position) != '"') return fail();
        String key = string();
        skipWhitespace();
        if (!take(':')) return fail();
        skipWhitespace();
        if (result.putIfAbsent(key, value()) != null) return fail();
        skipWhitespace();
        if (take('}')) return result;
        if (!take(',')) return fail();
      }
    }

    private List<Object> array() {
      position++;
      java.util.ArrayList<Object> result = new java.util.ArrayList<>();
      skipWhitespace();
      if (take(']')) return result;
      while (true) {
        skipWhitespace();
        result.add(value());
        skipWhitespace();
        if (take(']')) return result;
        if (!take(',')) return fail();
      }
    }

    private String string() {
      position++;
      StringBuilder result = new StringBuilder();
      while (position < input.length()) {
        char current = input.charAt(position++);
        if (current == '"') return result.toString();
        if (current < 0x20) return fail();
        if (current != '\\') {
          result.append(current);
          continue;
        }
        if (position >= input.length()) return fail();
        char escape = input.charAt(position++);
        switch (escape) {
          case '"', '\\', '/' -> result.append(escape);
          case 'b' -> result.append('\b');
          case 'f' -> result.append('\f');
          case 'n' -> result.append('\n');
          case 'r' -> result.append('\r');
          case 't' -> result.append('\t');
          case 'u' -> result.append(unicode());
          default -> { return fail(); }
        }
      }
      return fail();
    }

    private char unicode() {
      if (position + 4 > input.length()) return fail();
      try {
        char value = (char) Integer.parseInt(input.substring(position, position + 4), 16);
        position += 4;
        return value;
      } catch (NumberFormatException error) {
        return fail();
      }
    }

    private Long number() {
      int start = position;
      if (take('-') && position >= input.length()) return fail();
      if (take('0')) {
        if (position < input.length() && Character.isDigit(input.charAt(position))) return fail();
      } else {
        int digits = position;
        while (position < input.length() && Character.isDigit(input.charAt(position))) position++;
        if (digits == position) return fail();
      }
      if (position < input.length() && (input.charAt(position) == '.' || input.charAt(position) == 'e'
          || input.charAt(position) == 'E')) return fail();
      try {
        return Long.valueOf(input.substring(start, position));
      } catch (NumberFormatException error) {
        return fail();
      }
    }

    private Object literal(String expected, Object value) {
      if (!input.startsWith(expected, position)) return fail();
      position += expected.length();
      return value;
    }

    private boolean take(char expected) {
      if (position < input.length() && input.charAt(position) == expected) {
        position++;
        return true;
      }
      return false;
    }

    private void skipWhitespace() {
      while (position < input.length() && Character.isWhitespace(input.charAt(position))) position++;
    }

    private static <T> T fail() {
      throw new IllegalArgumentException("invalid JSON");
    }
  }
}

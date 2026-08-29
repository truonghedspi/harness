package io.harness.logcontext.ingest;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.zip.GZIPInputStream;

/**
 * OTLP-decode adapter (Option A, owner-approved digest {@code 2576534ef71a6361}).
 *
 * <p>Unwraps one OTLP/JSON {@code ExportLogsServiceRequest} — including a gzip-compressed body —
 * into exactly one schemaVersion-1 JSON object per admitted log record. The collector emits OTLP on
 * the wire; this adapter relocates the "one JSON object per request, no envelope" guarantee to the
 * ingest boundary, exactly where the ingest invariants operate.
 */
public final class OtlpLogDecoder {

    private static final ObjectMapper JSON = new ObjectMapper();

    /** @return one v1 JSON object per admitted log record, in encounter order */
    public List<String> decode(byte[] payload) {
        JsonNode root;
        try {
            root = JSON.readTree(inflate(payload));
        } catch (Exception e) {
            throw new IllegalArgumentException("OTLP payload is not a valid JSON log request", e);
        }
        List<String> out = new ArrayList<>();
        for (JsonNode resourceLogs : root.path("resourceLogs")) {
            for (JsonNode scopeLogs : resourceLogs.path("scopeLogs")) {
                for (JsonNode record : scopeLogs.path("logRecords")) {
                    out.add(decodeRecord(record));
                }
            }
        }
        return out;
    }

    private static String decodeRecord(JsonNode record) {
        Map<String, Object> attributes = attributesMap(record.path("attributes"));

        String message = stringValue(record.path("body"));
        if (message == null) {
            message = (String) attributes.get("message");
        }

        ObjectNode v1 = JSON.createObjectNode();
        v1.put("schemaVersion", intValue(attributes.get("schemaVersion")));
        v1.put("observedAt", stringAttribute(attributes, "observedAt"));
        v1.put("message", message);
        v1.put("namespace", stringAttribute(attributes, "namespace"));
        v1.put("pod", stringAttribute(attributes, "pod"));
        v1.put("container", stringAttribute(attributes, "container"));
        v1.put("workload", stringAttribute(attributes, "workload"));
        v1.put("source", stringAttribute(attributes, "source"));
        v1.put("optIn", Boolean.TRUE.equals(attributes.get("optIn")));
        v1.put("environment", stringAttribute(attributes, "environment"));
        ObjectNode attributeNode = v1.putObject("attributes");
        Object testRunId = attributes.get("test.run_id");
        if (testRunId != null) {
            attributeNode.put("test.run_id", String.valueOf(testRunId));
        }
        return v1.toString();
    }

    private static String stringAttribute(Map<String, Object> attributes, String key) {
        Object value = attributes.get(key);
        return value == null ? null : String.valueOf(value);
    }

    private static Map<String, Object> attributesMap(JsonNode attributes) {
        Map<String, Object> map = new LinkedHashMap<>();
        if (attributes == null || !attributes.isArray()) {
            return map;
        }
        for (JsonNode keyValue : attributes) {
            String key = keyValue.path("key").asText();
            map.put(key, anyValue(keyValue.path("value")));
        }
        return map;
    }

    private static Object anyValue(JsonNode value) {
        if (value.has("stringValue")) return value.path("stringValue").asText();
        if (value.has("boolValue")) return value.path("boolValue").asBoolean();
        if (value.has("intValue")) return value.path("intValue").asLong();
        if (value.has("doubleValue")) return value.path("doubleValue").asDouble();
        return value.isTextual() ? value.asText() : value.toString();
    }

    private static String stringValue(JsonNode body) {
        if (body == null || body.isNull() || body.isMissingNode()) return null;
        if (body.has("stringValue")) return body.path("stringValue").asText();
        return body.isTextual() ? body.asText() : body.toString();
    }

    private static int intValue(Object value) {
        if (value == null) return 0;
        if (value instanceof Number number) return number.intValue();
        try {
            return Integer.parseInt(String.valueOf(value));
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    private static byte[] inflate(byte[] payload) throws Exception {
        if (payload.length >= 2 && (payload[0] & 0xFF) == 0x1f && (payload[1] & 0xFF) == 0x8b) {
            try (GZIPInputStream gzip = new GZIPInputStream(new ByteArrayInputStream(payload));
                    ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                gzip.transferTo(out);
                return out.toByteArray();
            }
        }
        return payload;
    }
}

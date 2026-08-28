package io.harness.logcontext.mcp;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import io.harness.logcontext.ingest.IndexPort;
import io.harness.logcontext.ingest.NormalizedLogRecord;
import io.harness.logcontext.mcp.McpQueryService.ToolResult;
import io.harness.logcontext.query.CorrelationResolver;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.Inet6Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;

/**
 * Public lifecycle seam for the read-only Streamable HTTP MCP boundary. {@link #start} validates
 * the ServiceAccount JWT before any dispatch, exposes exactly {@code search_logs} and
 * {@code get_failure_context}, and owns the fixed X-006 wire budgets: a 200-record and 256-KiB
 * response bound, a five-second query deadline (enforced by {@link McpQueryService}), no
 * pagination, and no index writes or Kubernetes capability.
 */
public final class McpServiceBootstrap {
  private static final int MAX_RECORDS = 200;
  private static final String PROTOCOL_VERSION = "2025-06-18";
  private static final String SERVER_NAME = "k8s-log-debug-context";
  private static final String SERVER_VERSION = "0.1.0";
  private static final ObjectMapper JSON = new ObjectMapper();
  private static final String TOOLS_LIST =
      "{\"tools\":["
          + "{\"name\":\"search_logs\",\"description\":\"Search normalized logs within a bounded interval\"},"
          + "{\"name\":\"get_failure_context\",\"description\":\"Fetch correlated failure context for a test run\"}"
          + "]}";

  private McpServiceBootstrap() {}

  public static RunningMcpServer start(
      McpHttpServerConfig config, IndexPort indexPort, ServiceAccountJwtValidator jwtValidator) {
    Objects.requireNonNull(config, "config");
    Objects.requireNonNull(indexPort, "indexPort");
    Objects.requireNonNull(jwtValidator, "jwtValidator");
    InetSocketAddress bind = Objects.requireNonNull(config.bindAddress(), "bindAddress");
    McpQueryService queryService = new McpQueryService(indexPort, new CorrelationResolver());
    try {
      HttpServer server = HttpServer.create(bind, 0);
      server.createContext("/", exchange -> handle(exchange, queryService, jwtValidator));
      server.start();
      return new HttpRunningMcpServer(server);
    } catch (IOException error) {
      throw new UncheckedIOException("cannot bind MCP HTTP boundary", error);
    }
  }

  private static void handle(
      HttpExchange exchange, McpQueryService queryService, ServiceAccountJwtValidator jwtValidator)
      throws IOException {
    try {
      if (!"POST".equalsIgnoreCase(exchange.getRequestMethod())) {
        respond(exchange, 405, "{\"error\":\"method not allowed\"}");
        return;
      }

      // Authorization precedes everything: extract the optional bearer token and validate it before
      // parsing or dispatching. JwtValidation.Invalid covers both a missing and an invalid token.
      Optional<String> bearer = bearer(exchange.getRequestHeaders().getFirst("Authorization"));
      if (jwtValidator.validate(bearer) instanceof JwtValidation.Invalid) {
        respond(exchange, 401, "{\"jsonrpc\":\"2.0\",\"error\":{\"code\":-32000,"
            + "\"message\":\"unauthorized: missing or invalid ServiceAccount JWT\"}}");
        return;
      }

      JsonNode request;
      try {
        request = JSON.readTree(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
      } catch (IOException malformed) {
        respond(exchange, 400, "{\"jsonrpc\":\"2.0\",\"error\":{\"code\":-32700,\"message\":\"parse error\"}}");
        return;
      }

      String method = request.path("method").asText("");
      JsonNode idNode = request.get("id");
      boolean notification = idNode == null || idNode.isNull();

      switch (method) {
        case "initialize" -> {
          exchange.getResponseHeaders().set("Mcp-Session-Id", UUID.randomUUID().toString());
          respond(exchange, 200, jsonRpcResult(idNode,
              "{\"protocolVersion\":\"" + PROTOCOL_VERSION
                  + "\",\"capabilities\":{\"tools\":{}},"
                  + "\"serverInfo\":{\"name\":\"" + SERVER_NAME + "\",\"version\":\"" + SERVER_VERSION + "\"}}"));
        }
        case "notifications/initialized" -> respond(exchange, 202, "");
        case "tools/list" -> respond(exchange, 200, jsonRpcResult(idNode, TOOLS_LIST));
        case "tools/call" -> handleToolCall(exchange, request, idNode, queryService);
        default -> respond(exchange, notification ? 202 : 200,
            notification ? "" : jsonRpcError(idNode, -32601, "method not found"));
      }
    } finally {
      exchange.close();
    }
  }

  private static void handleToolCall(
      HttpExchange exchange, JsonNode request, JsonNode idNode, McpQueryService queryService)
      throws IOException {
    JsonNode params = request.get("params");
    String tool = params == null ? "" : params.path("name").asText("");
    Map<String, Object> arguments = Map.of();
    JsonNode argumentsNode = params == null ? null : params.get("arguments");
    if (argumentsNode != null && argumentsNode.isObject()) {
      arguments = JSON.convertValue(argumentsNode, new TypeReference<Map<String, Object>>() {});
    }

    ToolResult result = switch (tool) {
      case "search_logs" -> queryService.searchLogs(arguments);
      case "get_failure_context" -> queryService.getFailureContext(arguments);
      default -> null;
    };

    if (result == null) {
      respond(exchange, 200, jsonRpcError(idNode, -32601, "unknown tool"));
    } else if (result instanceof ToolResult.Success success) {
      respond(exchange, 200, jsonRpcResult(idNode, successResult(success)));
    } else if (result instanceof ToolResult.Rejected rejected) {
      respond(exchange, 200, jsonRpcError(idNode, -32602, "invalid arguments: " + rejected.code()));
    } else {
      respond(exchange, 200, jsonRpcError(idNode, -32000, "deadline exceeded: query timed out"));
    }
  }

  private static String successResult(ToolResult.Success success) {
    List<NormalizedLogRecord> records = success.records();
    boolean truncated = success.truncated();
    if (records.size() > MAX_RECORDS) {
      records = records.subList(0, MAX_RECORDS);
      truncated = true;
    }
    StringBuilder body = new StringBuilder(256);
    body.append("{\"content\":[{\"type\":\"text\",\"text\":")
        .append(quote(records.size() + " records"))
        .append("}],\"isError\":false,\"structuredContent\":{\"records\":[");
    for (int i = 0; i < records.size(); i++) {
      if (i > 0) {
        body.append(',');
      }
      body.append(serializeRecord(records.get(i)));
    }
    body.append("],\"truncated\":").append(truncated).append("}}");
    return body.toString();
  }

  private static String serializeRecord(NormalizedLogRecord record) {
    StringBuilder body = new StringBuilder(256);
    body.append("{\"schemaVersion\":").append(record.schemaVersion());
    body.append(",\"observedAt\":").append(quote(record.observedAt().toString()));
    body.append(",\"message\":").append(quote(record.message()));
    body.append(",\"namespace\":").append(quote(record.namespace()));
    body.append(",\"pod\":").append(quote(record.pod()));
    body.append(",\"container\":").append(quote(record.container()));
    body.append(",\"workload\":").append(quote(record.workload()));
    body.append(",\"source\":").append(quote(record.source()));
    body.append(",\"testRunId\":").append(record.testRunId().map(McpServiceBootstrap::quote).orElse("null"));
    body.append(",\"attributes\":").append(serializeAttributes(record.attributes()));
    return body.append('}').toString();
  }

  private static String serializeAttributes(Map<String, String> attributes) {
    StringBuilder body = new StringBuilder(attributes.size() * 24);
    body.append('{');
    boolean first = true;
    for (Map.Entry<String, String> entry : attributes.entrySet()) {
      if (!first) {
        body.append(',');
      }
      first = false;
      body.append(quote(entry.getKey())).append(':').append(quote(entry.getValue()));
    }
    return body.append('}').toString();
  }

  private static String jsonRpcResult(JsonNode idNode, String result) {
    return "{\"jsonrpc\":\"2.0\",\"id\":" + id(idNode) + ",\"result\":" + result + "}";
  }

  private static String jsonRpcError(JsonNode idNode, int code, String message) {
    return "{\"jsonrpc\":\"2.0\",\"id\":" + id(idNode)
        + ",\"error\":{\"code\":" + code + ",\"message\":" + quote(message) + "}}";
  }

  private static String id(JsonNode idNode) {
    return idNode == null ? "null" : idNode.toString();
  }

  private static Optional<String> bearer(String authorization) {
    if (authorization == null || authorization.isBlank()) {
      return Optional.empty();
    }
    if (authorization.regionMatches(true, 0, "Bearer ", 0, "Bearer ".length())) {
      String token = authorization.substring("Bearer ".length()).trim();
      return token.isEmpty() ? Optional.empty() : Optional.of(token);
    }
    return Optional.empty();
  }

  private static void respond(HttpExchange exchange, int status, String body) throws IOException {
    byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
    if (bytes.length == 0) {
      exchange.sendResponseHeaders(status, -1);
      return;
    }
    exchange.getResponseHeaders().set("Content-Type", "application/json");
    exchange.sendResponseHeaders(status, bytes.length);
    exchange.getResponseBody().write(bytes);
  }

  private static String quote(String value) {
    if (value == null) {
      return "null";
    }
    StringBuilder quoted = new StringBuilder(value.length() + 2);
    quoted.append('"');
    for (int i = 0; i < value.length(); i++) {
      char c = value.charAt(i);
      switch (c) {
        case '"' -> quoted.append("\\\"");
        case '\\' -> quoted.append("\\\\");
        case '\b' -> quoted.append("\\b");
        case '\f' -> quoted.append("\\f");
        case '\n' -> quoted.append("\\n");
        case '\r' -> quoted.append("\\r");
        case '\t' -> quoted.append("\\t");
        default -> {
          if (c < 0x20) {
            quoted.append(String.format("\\u%04x", (int) c));
          } else {
            quoted.append(c);
          }
        }
      }
    }
    return quoted.append('"').toString();
  }

  public static final class HttpRunningMcpServer implements RunningMcpServer {
    private final HttpServer server;
    private final URI endpoint;

    HttpRunningMcpServer(HttpServer server) {
      this.server = server;
      this.endpoint = URI.create("http://" + host(server.getAddress()) + ":" + server.getAddress().getPort() + "/");
    }

    @Override
    public URI endpoint() {
      return endpoint;
    }

    @Override
    public void close() {
      server.stop(0);
    }

    private static String host(InetSocketAddress bound) {
      InetAddress address = bound.getAddress();
      if (address instanceof Inet6Address && address.isLoopbackAddress()) {
        return "[::1]";
      }
      return address == null ? "127.0.0.1" : address.getHostAddress();
    }
  }
}

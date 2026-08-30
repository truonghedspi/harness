package io.harness.logcontext;

import io.harness.logcontext.index.OpenSearchLogIndex;
import io.harness.logcontext.index.OpenSearchLogIndexBootstrap;
import io.harness.logcontext.index.OpenSearchLogIndexConfig;
import io.harness.logcontext.ingest.IngestPolicy;
import io.harness.logcontext.ingest.IngestService;
import io.harness.logcontext.mcp.McpHttpServerConfig;
import io.harness.logcontext.mcp.McpServiceBootstrap;
import io.harness.logcontext.mcp.OidcServiceAccountJwtValidator;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.file.Path;
import java.time.Clock;
import java.util.Arrays;
import java.util.Set;
import java.util.concurrent.CountDownLatch;
import org.apache.hc.core5.http.HttpHost;
import org.opensearch.client.opensearch.OpenSearchClient;
import org.opensearch.client.transport.httpclient5.ApacheHttpClient5TransportBuilder;

/** Runnable wiring for the single ingest + MCP service pod. */
public final class LogDebugContextApplication {
  private LogDebugContextApplication() {}

  public static void main(String[] args) throws Exception {
    URI endpoint = URI.create(required("OPENSEARCH_URL"));
    var transport = ApacheHttpClient5TransportBuilder.builder(
        new HttpHost(endpoint.getScheme(), endpoint.getHost(), endpoint.getPort())).build();
    var client = new OpenSearchClient(transport);
    var installation = OpenSearchLogIndexBootstrap.ensureInstalled(
        client, new OpenSearchLogIndexConfig("log-debug-v1", Clock.systemUTC()));
    var index = new OpenSearchLogIndex(client, installation.activeIndex());
    java.util.List<String> redactions = Arrays.stream(System.getenv().getOrDefault("REDACTION_LITERALS", "").split("\\n"))
        .filter(value -> !value.isEmpty()).toList();
    var ingest = new IngestService(new IngestPolicy(Set.of("test"), redactions), index);
    var validator = new OidcServiceAccountJwtValidator(
        URI.create(required("KUBERNETES_JWKS_URI")), required("KUBERNETES_ISSUER"),
        required("MCP_AUDIENCE"), Path.of("/var/run/secrets/kubernetes.io/serviceaccount/ca.crt"),
        Path.of("/var/run/secrets/kubernetes.io/serviceaccount/token"));
    var server = McpServiceBootstrap.start(new McpHttpServerConfig(new InetSocketAddress("0.0.0.0", 8080)),
        index, validator, ingest);
    Runtime.getRuntime().addShutdownHook(new Thread(() -> { server.close(); try { transport.close(); } catch (Exception ignored) {} }));
    new CountDownLatch(1).await();
  }

  private static String required(String name) {
    String value = System.getenv(name);
    if (value == null || value.isBlank()) throw new IllegalStateException(name + " is required");
    return value;
  }
}

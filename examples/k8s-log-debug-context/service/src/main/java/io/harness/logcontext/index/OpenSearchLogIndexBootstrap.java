package io.harness.logcontext.index;

import com.fasterxml.jackson.databind.JsonNode;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.Objects;
import org.opensearch.client.opensearch.OpenSearchClient;

public final class OpenSearchLogIndexBootstrap {
  static final String POLICY_ID = "log-debug-retention-v1";
  static final String TEMPLATE_NAME = "log-debug-v1-template";
  private static final String PREFIX = "log-debug-v1";
  private static final String POLICY_PATH = "/_plugins/_ism/policies/" + POLICY_ID;
  private static final String TEMPLATE_PATH = "/_index_template/" + TEMPLATE_NAME;
  private static final DateTimeFormatter DAY = DateTimeFormatter.ofPattern("uuuu.MM.dd").withZone(ZoneOffset.UTC);

  private OpenSearchLogIndexBootstrap() {}

  public static RetentionInstallation ensureInstalled(
      OpenSearchClient client, OpenSearchLogIndexConfig config) {
    return ensureInstalled(new GenericOpenSearchGateway(client), config);
  }

  static RetentionInstallation ensureInstalled(OpenSearchGateway gateway, OpenSearchLogIndexConfig config) {
    Objects.requireNonNull(gateway);
    Objects.requireNonNull(config);
    if (!PREFIX.equals(config.indexPrefix())) {
      throw new IllegalArgumentException("indexPrefix must be exactly " + PREFIX);
    }
    String activeIndex = PREFIX + "-" + DAY.format(config.clock().instant());
    try {
      reconcilePolicy(gateway);
      reconcileTemplate(gateway);
      createDailyIndex(gateway, activeIndex);
      verifyInstalled(gateway, activeIndex);
      return new RetentionInstallation(POLICY_ID, TEMPLATE_NAME, activeIndex);
    } catch (IOException error) {
      throw new IllegalStateException("OpenSearch retention bootstrap failed", error);
    }
  }

  private static void reconcilePolicy(OpenSearchGateway gateway) throws IOException {
    OpenSearchGateway.Response existing = gateway.request("GET", POLICY_PATH, null);
    String canonical = resource("/opensearch/log-debug-retention-v1.json");
    if (existing.status() == 404) {
      requireSuccess(gateway.request("PUT", POLICY_PATH, canonical), "create ISM policy");
      return;
    }
    requireSuccess(existing, "read ISM policy");
    if (!validPolicy(existing.body())) {
      JsonNode root = existing.body();
      long sequence = requiredLong(root, "_seq_no");
      long primaryTerm = requiredLong(root, "_primary_term");
      String endpoint = POLICY_PATH + "?if_seq_no=" + sequence + "&if_primary_term=" + primaryTerm;
      requireSuccess(gateway.request("PUT", endpoint, canonical), "reconcile ISM policy");
    }
  }

  private static void reconcileTemplate(OpenSearchGateway gateway) throws IOException {
    OpenSearchGateway.Response existing = gateway.request("GET", TEMPLATE_PATH, null);
    String canonical = resource("/opensearch/log-debug-v1-template.json");
    if (existing.status() == 404 || !validTemplate(existing.body())) {
      requireSuccess(gateway.request("PUT", TEMPLATE_PATH, canonical), "reconcile index template");
      return;
    }
    requireSuccess(existing, "read index template");
  }

  private static void createDailyIndex(OpenSearchGateway gateway, String activeIndex) throws IOException {
    OpenSearchGateway.Response created = gateway.request("PUT", "/" + activeIndex, null);
    if (created.successful()) return;
    if (created.status() == 400 && created.body().toString().contains("resource_already_exists_exception")) return;
    requireSuccess(created, "create active daily index");
  }

  private static void verifyInstalled(OpenSearchGateway gateway, String activeIndex) throws IOException {
    OpenSearchGateway.Response policy = gateway.request("GET", POLICY_PATH, null);
    requireSuccess(policy, "verify ISM policy");
    if (!validPolicy(policy.body())) throw new IllegalStateException("canonical seven-day policy is not observable");

    OpenSearchGateway.Response template = gateway.request("GET", TEMPLATE_PATH, null);
    requireSuccess(template, "verify index template");
    if (!validTemplate(template.body())) throw new IllegalStateException("canonical v1 template is not observable");

    OpenSearchGateway.Response mapping = gateway.request("GET", "/" + activeIndex + "/_mapping", null);
    requireSuccess(mapping, "verify active index mapping");
    if (!containsAll(mapping.body(), "observedAt", "date", "namespace", "keyword", "message", "text")) {
      throw new IllegalStateException("active daily index does not expose the v1 mapping");
    }

    verifyAttachment(gateway, activeIndex);
  }

  private static void verifyAttachment(OpenSearchGateway gateway, String activeIndex) throws IOException {
    String endpoint = "/_plugins/_ism/explain/" + activeIndex;
    long deadline = System.nanoTime() + Duration.ofSeconds(10).toNanos();
    OpenSearchGateway.Response explain;
    do {
      explain = gateway.request("GET", endpoint, null);
      requireSuccess(explain, "verify active index ISM attachment");
      if (explain.body().toString().contains(POLICY_ID)) return;
      try {
        Thread.sleep(100);
      } catch (InterruptedException interrupted) {
        Thread.currentThread().interrupt();
        break;
      }
    } while (System.nanoTime() < deadline);
    throw new IllegalStateException("active daily index is not attached to " + POLICY_ID);
  }

  private static boolean validPolicy(JsonNode body) {
    return containsAll(body, POLICY_ID, "log-debug-v1-*", "100", "hot", "delete", "7d");
  }

  private static boolean validTemplate(JsonNode body) {
    return containsAll(body, TEMPLATE_NAME, "log-debug-v1-*", "100", "observedAt", "date",
        "namespace", "keyword", "message", "text", "testRunId");
  }

  private static boolean containsAll(JsonNode body, String... values) {
    String text = body.toString();
    for (String value : values) if (!text.contains(value)) return false;
    return true;
  }

  private static long requiredLong(JsonNode root, String name) {
    JsonNode value = root.findValue(name);
    if (value == null || !value.canConvertToLong()) {
      throw new IllegalStateException("existing policy is missing " + name);
    }
    return value.longValue();
  }

  private static void requireSuccess(OpenSearchGateway.Response response, String operation) {
    if (!response.successful()) throw new IllegalStateException(operation + " returned HTTP " + response.status());
  }

  private static String resource(String path) {
    try (InputStream input = OpenSearchLogIndexBootstrap.class.getResourceAsStream(path)) {
      if (input == null) throw new IllegalStateException("missing canonical resource " + path);
      return new String(input.readAllBytes(), StandardCharsets.UTF_8);
    } catch (IOException error) {
      throw new IllegalStateException("cannot read canonical resource " + path, error);
    }
  }
}

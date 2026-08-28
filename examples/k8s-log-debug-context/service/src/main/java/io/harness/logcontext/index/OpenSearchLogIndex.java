package io.harness.logcontext.index;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.harness.logcontext.ingest.IndexPort;
import io.harness.logcontext.ingest.LogQuery;
import io.harness.logcontext.ingest.LogQueryResult;
import io.harness.logcontext.ingest.NormalizedLogRecord;
import io.harness.logcontext.ingest.RunIdLogQuery;
import io.harness.logcontext.ingest.WorkloadWindowLogQuery;
import java.io.IOException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import org.opensearch.client.opensearch.OpenSearchClient;

public final class OpenSearchLogIndex implements IndexPort {
  private static final ObjectMapper JSON = new ObjectMapper();
  private final OpenSearchGateway gateway;
  private final String indexName;

  public OpenSearchLogIndex(OpenSearchClient client, String indexName) {
    this(new GenericOpenSearchGateway(client), indexName);
  }

  OpenSearchLogIndex(OpenSearchGateway gateway, String indexName) {
    this.gateway = Objects.requireNonNull(gateway);
    if (indexName == null || !indexName.matches("log-debug-v1-\\d{4}\\.\\d{2}\\.\\d{2}")) {
      throw new IllegalArgumentException("indexName must be one exact v1 UTC daily index");
    }
    this.indexName = indexName;
  }

  @Override
  public void index(NormalizedLogRecord document) {
    Objects.requireNonNull(document);
    ObjectNode json = JSON.createObjectNode();
    json.put("schemaVersion", document.schemaVersion());
    json.put("observedAt", document.observedAt().toString());
    json.put("message", document.message());
    json.put("namespace", document.namespace());
    json.put("pod", document.pod());
    json.put("container", document.container());
    json.put("workload", document.workload());
    json.put("source", document.source());
    document.testRunId().ifPresent(value -> json.put("testRunId", value));
    json.set("attributes", JSON.valueToTree(document.attributes()));
    OpenSearchGateway.Response response = request("POST", "/" + indexName + "/_doc", json.toString());
    requireSuccess(response, "index document");
  }

  @Override
  public LogQueryResult search(LogQuery query) {
    Objects.requireNonNull(query);
    ObjectNode body = JSON.createObjectNode();
    body.put("size", query.maxRecords() + 1);
    ArrayNode sort = body.putArray("sort");
    sort.addObject().putObject("observedAt").put("order", "asc");
    ArrayNode filter = body.putObject("query").putObject("bool").putArray("filter");
    ObjectNode range = filter.addObject().putObject("range").putObject("observedAt");
    range.put("gte", query.timeWindow().fromInclusive().toString());
    range.put("lt", query.timeWindow().toExclusive().toString());
    if (query instanceof RunIdLogQuery run) {
      filter.addObject().putObject("term").put("testRunId", run.testRunId());
    } else if (query instanceof WorkloadWindowLogQuery workload) {
      filter.addObject().putObject("term").put("namespace", workload.namespace());
      filter.addObject().putObject("term").put("workload", workload.workload());
    } else {
      throw new IllegalArgumentException("unsupported query type " + query.getClass().getName());
    }
    query.messageContains().ifPresent(term ->
        filter.addObject().putObject("match_phrase").put("message", term));

    OpenSearchGateway.Response response = request("POST", "/" + indexName + "/_search", body.toString());
    requireSuccess(response, "search documents");
    JsonNode hits = response.body().path("hits").path("hits");
    if (!hits.isArray()) throw new IllegalStateException("search response has no hits array");
    List<NormalizedLogRecord> records = new ArrayList<>();
    for (JsonNode hit : hits) records.add(record(hit.path("_source")));
    boolean truncated = records.size() > query.maxRecords();
    if (truncated) records = new ArrayList<>(records.subList(0, query.maxRecords()));
    return new LogQueryResult(records, truncated);
  }

  private static NormalizedLogRecord record(JsonNode source) {
    if (!source.isObject()) throw new IllegalStateException("search hit has no object _source");
    Map<String, String> attributes = new LinkedHashMap<>();
    JsonNode attributeNode = source.path("attributes");
    if (!attributeNode.isObject()) throw new IllegalStateException("search hit attributes are not an object");
    Iterator<Map.Entry<String, JsonNode>> fields = attributeNode.fields();
    while (fields.hasNext()) {
      Map.Entry<String, JsonNode> field = fields.next();
      if (!field.getValue().isTextual()) throw new IllegalStateException("attribute is not textual");
      attributes.put(field.getKey(), field.getValue().textValue());
    }
    JsonNode runId = source.get("testRunId");
    return new NormalizedLogRecord(
        required(source, "schemaVersion").intValue(),
        Instant.parse(requiredText(source, "observedAt")),
        requiredText(source, "message"),
        requiredText(source, "namespace"),
        requiredText(source, "pod"),
        requiredText(source, "container"),
        requiredText(source, "workload"),
        requiredText(source, "source"),
        runId == null || runId.isNull() ? Optional.empty() : Optional.of(runId.textValue()),
        attributes);
  }

  private static JsonNode required(JsonNode source, String name) {
    JsonNode value = source.get(name);
    if (value == null || value.isNull()) throw new IllegalStateException("search hit missing " + name);
    return value;
  }

  private static String requiredText(JsonNode source, String name) {
    JsonNode value = required(source, name);
    if (!value.isTextual()) throw new IllegalStateException("search hit field is not textual: " + name);
    return value.textValue();
  }

  private OpenSearchGateway.Response request(String method, String endpoint, String body) {
    try {
      return gateway.request(method, endpoint, body);
    } catch (IOException error) {
      throw new IllegalStateException("OpenSearch request failed: " + method + " " + endpoint, error);
    }
  }

  private static void requireSuccess(OpenSearchGateway.Response response, String operation) {
    if (!response.successful()) throw new IllegalStateException(operation + " returned HTTP " + response.status());
  }
}

package io.harness.logcontext.index;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import org.opensearch.client.opensearch.OpenSearchClient;
import org.opensearch.client.opensearch.generic.Bodies;
import org.opensearch.client.opensearch.generic.Requests;

final class GenericOpenSearchGateway implements OpenSearchGateway {
  private static final ObjectMapper JSON = new ObjectMapper();
  private final OpenSearchClient client;

  GenericOpenSearchGateway(OpenSearchClient client) {
    this.client = java.util.Objects.requireNonNull(client);
  }

  @Override
  public Response request(String method, String endpoint, String body) throws IOException {
    var builder = Requests.builder().method(method).endpoint(endpoint);
    if (body != null) builder.body(Bodies.json(body));
    try (var response = client.generic().execute(builder.build())) {
      JsonNode responseBody = response.getBody().isEmpty()
          ? JSON.createObjectNode()
          : JSON.readTree(response.getBody().orElseThrow().bodyAsBytes());
      return new Response(response.getStatus(), responseBody);
    }
  }
}

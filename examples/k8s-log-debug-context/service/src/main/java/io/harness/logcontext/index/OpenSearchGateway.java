package io.harness.logcontext.index;

import com.fasterxml.jackson.databind.JsonNode;
import java.io.IOException;

interface OpenSearchGateway {
  Response request(String method, String endpoint, String body) throws IOException;

  record Response(int status, JsonNode body) {
    boolean successful() { return status >= 200 && status < 300; }
  }
}

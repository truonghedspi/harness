package io.harness.logcontext.mcp;

import java.net.URI;

/**
 * A running Streamable HTTP MCP server. {@link #endpoint()} returns the actual bound loopback URI
 * and {@link #close()} releases the bound socket.
 */
public interface RunningMcpServer extends AutoCloseable {
  URI endpoint();

  @Override
  void close();
}

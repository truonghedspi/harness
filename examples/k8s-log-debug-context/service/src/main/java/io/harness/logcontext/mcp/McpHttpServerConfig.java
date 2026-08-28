package io.harness.logcontext.mcp;

import java.net.InetSocketAddress;

/**
 * Configuration for the Streamable HTTP MCP boundary. {@code bindAddress} may use loopback port
 * {@code 0}, in which case {@link RunningMcpServer#endpoint()} reports the actual bound port.
 */
public record McpHttpServerConfig(InetSocketAddress bindAddress) {}

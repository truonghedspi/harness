# Requirement — JDT MCP Server

## Ask

Build an MCP (Model Context Protocol) server that wraps the Eclipse JDT Language Server
(`org.eclipse.jdt.ls`), so an MCP-capable AI coding agent gets real Java code intelligence —
diagnostics, hover/type info, completion, references, definition, rename — as MCP tools, instead of
grepping source or guessing.

## Why (as stated)

An LLM working on a Java codebase today either has no semantic understanding of the code (relies on
text search and its own recall of the language) or requires a human to run an IDE alongside it. JDT
LS already implements this semantic layer for Eclipse and VS Code; the gap is that it speaks LSP
(JSON-RPC over stdio), not MCP. This project is the bridge.

## What is explicitly in scope (from the ask)

- Wraps Eclipse JDT Language Server specifically (not a generic multi-language LSP-to-MCP bridge,
  unless the design session concludes that's cheaper to build than a Java-specific one).
- Exposes it as MCP tools an agent calls, not as a human-facing IDE plugin.

## What is not yet decided

Everything else — which LSP capabilities become which MCP tools, how the server manages the JDT LS
subprocess lifecycle and per-project workspace state, how it's distributed/installed, what "a
project" means to this server (single repo? multi-root workspace?) — is open. That is exactly what
the design session (`design-facilitator`) exists to work through with a human before any code is
cut into features.

#!/usr/bin/env bash
# Wraps kubernetes-mcp-server so the MCP client never sees a bare "connection closed" failure
# caused by an empty kubeconfig context. Found via real use (aeron-demo, 2026-08-07): `minikube
# stop` doesn't just stop the VM, it clears current-context/clusters/contexts from
# ~/.kube/config entirely, so kubernetes-mcp-server exits immediately at startup with "no
# current-context is set" — before it can complete the MCP initialize handshake, which is exactly
# what an MCP client reports as "connection closed: initialize response".
#
# This only auto-starts a LOCAL minikube (the exact symptom: no context at all). A real
# shared/remote cluster's context persists in kubeconfig even when unreachable, so this is a
# no-op / pass-through for that case — it never tries to provision infrastructure it doesn't own.
set -uo pipefail

if ! kubectl config current-context >/dev/null 2>&1 \
    && command -v minikube >/dev/null 2>&1 \
    && minikube profile list >/dev/null 2>&1; then
  echo "[mcp-k8s-readonly-wrapper] no kubeconfig context (local minikube stopped clears it) — starting minikube..." >&2
  minikube start >&2 || echo "[mcp-k8s-readonly-wrapper] minikube start failed — the MCP server below will report the real connection error" >&2
fi

exec npx -y kubernetes-mcp-server@latest --read-only --disable-destructive "$@"

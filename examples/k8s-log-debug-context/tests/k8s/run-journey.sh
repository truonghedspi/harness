#!/usr/bin/env bash
# Conditions: TCON-JOURNEY-0001, TCON-JOURNEY-0002, TCON-JOURNEY-0003,
# TCON-JOURNEY-0004, TCON-JOURNEY-0005, TCON-JOURNEY-0006,
# TCON-JOURNEY-0007, TCON-JOURNEY-0008, TCON-JOURNEY-0009
# Requirements: INV-JOURNEY-1, INV-REDACT-1, INV-CORR-1, INV-BOUND-1, INV-READ-1
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CHART_PATH="${LOG_CONTEXT_CHART:-$ROOT/charts/log-debug-context}"
MCP_URL="${MCP_URL:-http://log-debug-context-mcp:8080/mcp}"
NAMESPACE_PREFIX="${NAMESPACE_PREFIX:-log-debug-journey}"
RUN_TOKEN="$(date +%s)-$$"
NAMESPACE="${NAMESPACE_PREFIX}-${RUN_TOKEN}"
TARGET_RUN_ID="target-${RUN_TOKEN}"
DECOY_RUN_ID="decoy-${RUN_TOKEN}"
TARGET_MARKER="target-marker-${RUN_TOKEN}"
DECOY_MARKER="decoy-marker-${RUN_TOKEN}"
MESSAGE_SECRET="message-secret-${RUN_TOKEN}"
ATTRIBUTE_SECRET="attribute-secret-${RUN_TOKEN}"
WORK_DIR="$(mktemp -d)"
CLEANUP_TIMEOUT_SECONDS="${CLEANUP_TIMEOUT_SECONDS:-60}"
QUERY_TIMEOUT_SECONDS="${QUERY_TIMEOUT_SECONDS:-12}"
cleanup_started=0

fail() { printf 'JOURNEY_ASSERTION_FAILED: %s\n' "$*" >&2; exit 1; }
checkpoint_a006() { printf 'A-006_ENVIRONMENT_CHECKPOINT: %s\n' "$*" >&2; exit 42; }

cleanup() {
  local original_code=$? waited=0
  [ "$cleanup_started" -eq 0 ] || return "$original_code"
  cleanup_started=1
  kubectl delete namespace "$NAMESPACE" --wait=false >/dev/null 2>&1 || true
  while kubectl get namespace "$NAMESPACE" >/dev/null 2>&1; do
    if [ "$waited" -ge "$CLEANUP_TIMEOUT_SECONDS" ]; then
      printf 'JOURNEY_CLEANUP_FAILED: namespace %s remained after %ss\n' "$NAMESPACE" "$CLEANUP_TIMEOUT_SECONDS" >&2
      return 70
    fi
    sleep 1
    waited=$((waited + 1))
  done
  rm -rf "$WORK_DIR"
  return "$original_code"
}
trap cleanup EXIT INT TERM

for executable in kubectl helm sed; do
  command -v "$executable" >/dev/null 2>&1 || fail "$executable is required"
done
[ -d "$CHART_PATH" ] || fail "deployment chart is absent: $CHART_PATH"
kubectl version -o json >/dev/null 2>&1 || checkpoint_a006 "no authorized Kubernetes API is reachable"
kubectl auth can-i create namespaces >/dev/null 2>&1 || checkpoint_a006 "current identity cannot create a disposable namespace"

kubectl create namespace "$NAMESPACE" >/dev/null
kubectl label namespace "$NAMESPACE" harness-loop-test=true --overwrite >/dev/null
kubectl annotate namespace "$NAMESPACE" "created-at=$(date -u +%Y-%m-%dT%H:%M:%SZ)" --overwrite >/dev/null

helm upgrade --install log-debug-context "$CHART_PATH" --namespace "$NAMESPACE" \
  --wait --timeout 300s --set-string redaction.values[0]="$MESSAGE_SECRET" \
  --set-string redaction.values[1]="$ATTRIBUTE_SECRET"

sed -e "s/__TARGET_MARKER__/$TARGET_MARKER/g" \
  -e "s/__DECOY_MARKER__/$DECOY_MARKER/g" \
  -e "s/__TARGET_RUN_ID__/$TARGET_RUN_ID/g" \
  -e "s/__DECOY_RUN_ID__/$DECOY_RUN_ID/g" \
  -e "s/__MESSAGE_SECRET__/$MESSAGE_SECRET/g" \
  -e "s/__ATTRIBUTE_SECRET__/$ATTRIBUTE_SECRET/g" \
  "$ROOT/tests/k8s/fixtures/log-emitter.yaml" > "$WORK_DIR/log-emitter.yaml"
kubectl -n "$NAMESPACE" apply -f "$WORK_DIR/log-emitter.yaml" >/dev/null
kubectl -n "$NAMESPACE" apply -f "$ROOT/tests/k8s/fixtures/mcp-client.yaml" >/dev/null
kubectl -n "$NAMESPACE" wait --for=condition=Ready pod/journey-log-emitter pod/journey-mcp-client --timeout=120s >/dev/null

kubectl auth can-i get pods/log --as="system:serviceaccount:${NAMESPACE}:journey-mcp-client" -n "$NAMESPACE" | grep -qx no \
  || fail "MCP client ServiceAccount can read pod logs directly"
kubectl auth can-i list secrets --as="system:serviceaccount:${NAMESPACE}:journey-mcp-client" -n "$NAMESPACE" | grep -qx no \
  || fail "MCP client ServiceAccount can read namespace secrets"

mcp_call() {
  local method="$1" arguments="$2" output="$3"
  local token
  token="$(kubectl -n "$NAMESPACE" create token journey-mcp-client --duration=10m)"
  kubectl -n "$NAMESPACE" exec journey-mcp-client -- curl --silent --show-error --fail-with-body \
    --max-time "$QUERY_TIMEOUT_SECONDS" -H "Authorization: Bearer $token" \
    -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
    --data "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"$method\",\"arguments\":$arguments}}" \
    "$MCP_URL" > "$output"
}

deadline=$((SECONDS + 120))
until mcp_call get_failure_context "{\"testRunId\":\"$TARGET_RUN_ID\"}" "$WORK_DIR/context.json" 2>/dev/null \
  && grep -q "$TARGET_MARKER" "$WORK_DIR/context.json"; do
  [ "$SECONDS" -lt "$deadline" ] || checkpoint_a006 "node-level collector did not make the emitted marker observable within 120s"
  sleep 3
done

for expected in "$TARGET_MARKER" "$TARGET_RUN_ID" "$NAMESPACE" journey-log-emitter emitter; do
  grep -q "$expected" "$WORK_DIR/context.json" || fail "MCP context omitted $expected"
done
for forbidden in "$DECOY_MARKER" "$DECOY_RUN_ID" "$MESSAGE_SECRET" "$ATTRIBUTE_SECRET"; do
  ! grep -q "$forbidden" "$WORK_DIR/context.json" || fail "MCP context leaked forbidden value $forbidden"
done
grep -Eq 'observedAt|observed_at' "$WORK_DIR/context.json" || fail "MCP context omitted the observed timestamp"

FROM_INCLUSIVE="$(node -e 'process.stdout.write(new Date(Date.now()-14*60*1000).toISOString())')"
TO_EXCLUSIVE="$(node -e 'process.stdout.write(new Date(Date.now()+30*1000).toISOString())')"
mcp_call search_logs "{\"namespace\":\"$NAMESPACE\",\"workload\":\"journey-log-emitter\",\"fromInclusive\":\"$FROM_INCLUSIVE\",\"toExclusive\":\"$TO_EXCLUSIVE\",\"maxRecords\":200}" "$WORK_DIR/bounded.json"
[ "$(wc -c < "$WORK_DIR/bounded.json" | tr -d ' ')" -le 262144 ] || fail "MCP response exceeded 256 KiB"
grep -qi 'truncat' "$WORK_DIR/bounded.json" || fail "over-budget response did not report truncation"
! grep -Eqi 'nextCursor|continuationToken|pageToken' "$WORK_DIR/bounded.json" || fail "MCP exposed pagination"

TOO_WIDE_FROM="$(node -e 'process.stdout.write(new Date(Date.now()-16*60*1000).toISOString())')"
if mcp_call search_logs "{\"namespace\":\"$NAMESPACE\",\"workload\":\"journey-log-emitter\",\"fromInclusive\":\"$TOO_WIDE_FROM\",\"toExclusive\":\"$TO_EXCLUSIVE\",\"maxRecords\":200}" "$WORK_DIR/too-wide.json"; then
  grep -Eqi 'error|invalid|15.minute|interval' "$WORK_DIR/too-wide.json" || fail "interval over 15 minutes was accepted or silently clipped"
fi

kubectl -n "$NAMESPACE" scale deployment,statefulset -l app.kubernetes.io/component=opensearch --replicas=0 >/dev/null
started=$SECONDS
mcp_call get_failure_context "{\"testRunId\":\"$TARGET_RUN_ID\"}" "$WORK_DIR/deadline.json" 2>/dev/null || true
elapsed=$((SECONDS - started))
[ "$elapsed" -le "$QUERY_TIMEOUT_SECONDS" ] || fail "downstream failure exceeded the independent watchdog"
[ "$elapsed" -le 7 ] || fail "server did not terminate near its five-second deadline (elapsed ${elapsed}s)"

printf 'Kubernetes diagnostic-context journey passed in namespace %s\n' "$NAMESPACE"

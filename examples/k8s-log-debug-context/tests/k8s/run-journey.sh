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
INSIDE_ENVIRONMENT=0
if [ "${1:-}" = "--inside-environment" ]; then
  INSIDE_ENVIRONMENT=1
  shift
fi
if [ "$INSIDE_ENVIRONMENT" -eq 1 ]; then
  [ -n "${NAMESPACE:-}" ] || { printf 'JOURNEY_ASSERTION_FAILED: NAMESPACE is required inside the managed environment\n' >&2; exit 1; }
else
  RUN_TOKEN="$(date +%s)-$$"
  NAMESPACE="${NAMESPACE_PREFIX}-${RUN_TOKEN}"
fi
TARGET_RUN_ID="target-${NAMESPACE}"
DECOY_RUN_ID="decoy-${NAMESPACE}"
TARGET_MARKER="target-marker-${NAMESPACE}"
DECOY_MARKER="decoy-marker-${NAMESPACE}"
MESSAGE_SECRET="message-secret-${NAMESPACE}"
ATTRIBUTE_SECRET="attribute-secret-${NAMESPACE}"
WORK_DIR="$(mktemp -d)"
CLEANUP_TIMEOUT_SECONDS="${CLEANUP_TIMEOUT_SECONDS:-60}"
QUERY_TIMEOUT_SECONDS="${QUERY_TIMEOUT_SECONDS:-12}"
cleanup_started=0

fail() { printf 'JOURNEY_ASSERTION_FAILED: %s\n' "$*" >&2; exit 1; }
checkpoint_a006() { printf 'A-006_ENVIRONMENT_CHECKPOINT: %s\n' "$*" >&2; exit 42; }

assert_context() {
  local response_file="$1" expected forbidden
  for expected in "$TARGET_MARKER" "$TARGET_RUN_ID" "$NAMESPACE" journey-log-emitter emitter; do
    grep -q "$expected" "$response_file" || fail "MCP context omitted $expected"
  done
  for forbidden in "$DECOY_MARKER" "$DECOY_RUN_ID" "$MESSAGE_SECRET" "$ATTRIBUTE_SECRET"; do
    ! grep -q "$forbidden" "$response_file" || fail "MCP context leaked forbidden value $forbidden"
  done
  grep -Eq 'observedAt|observed_at' "$response_file" || fail "MCP context omitted the observed timestamp"
}

if [ "${1:-}" = "--mutant-check-leaked-message-secret" ]; then
  trap 'rm -rf "$WORK_DIR"' EXIT
  printf '{"marker":"%s","runId":"%s","namespace":"%s","pod":"journey-log-emitter","container":"emitter","workload":"journey-log-emitter","observedAt":"2026-08-29T00:00:00Z","message":"password=%s"}\n' \
    "$TARGET_MARKER" "$TARGET_RUN_ID" "$NAMESPACE" "$MESSAGE_SECRET" > "$WORK_DIR/context-mutant.json"
  assert_context "$WORK_DIR/context-mutant.json"
  fail "leaked-message-secret mutant survived the journey oracle"
fi

[ "$INSIDE_ENVIRONMENT" -eq 1 ] || fail \
  "run through harness/tools/k8s-test-env.sh --services services.manifest.json -- tests/k8s/run-journey.sh --inside-environment"

cleanup() {
  local original_code=$? waited=0
  [ "$cleanup_started" -eq 0 ] || return "$original_code"
  cleanup_started=1
  if [ "$INSIDE_ENVIRONMENT" -eq 1 ]; then
    rm -rf "$WORK_DIR"
    return "$original_code"
  fi
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

for executable in kubectl node; do
  command -v "$executable" >/dev/null 2>&1 || fail "$executable is required"
done
[ -d "$CHART_PATH" ] || fail "deployment chart is absent: $CHART_PATH"
kubectl version -o json >/dev/null 2>&1 || checkpoint_a006 "no authorized Kubernetes API is reachable"
kubectl -n "$NAMESPACE" wait --for=condition=Available deployment/journey-log-emitter --timeout=120s >/dev/null
kubectl -n "$NAMESPACE" wait --for=condition=Ready pod/journey-mcp-client --timeout=120s >/dev/null

[ "$(kubectl auth can-i get pods/log --as="system:serviceaccount:${NAMESPACE}:journey-mcp-client" -n "$NAMESPACE" 2>/dev/null || true)" = no ] \
  || fail "MCP client ServiceAccount can read pod logs directly"
[ "$(kubectl auth can-i list secrets --as="system:serviceaccount:${NAMESPACE}:journey-mcp-client" -n "$NAMESPACE" 2>/dev/null || true)" = no ] \
  || fail "MCP client ServiceAccount can read namespace secrets"

mcp_call() {
  local method="$1" arguments="$2" output="$3"
  local token
  token="$(kubectl -n "$NAMESPACE" create token journey-mcp-client --duration=10m --audience=log-debug-context)"
  kubectl -n "$NAMESPACE" exec journey-mcp-client -- curl --silent --show-error --fail-with-body \
    --max-time "$QUERY_TIMEOUT_SECONDS" -H "Authorization: Bearer $token" \
    -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
    --data "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"$method\",\"arguments\":$arguments}}" \
    "$MCP_URL" > "$output"
}

unauthenticated_code="$(kubectl -n "$NAMESPACE" exec journey-mcp-client -- curl --silent --output /dev/null \
  --write-out '%{http_code}' --max-time "$QUERY_TIMEOUT_SECONDS" -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' "$MCP_URL")"
[ "$unauthenticated_code" = 401 ] || fail "MCP accepted a request without a ServiceAccount JWT"
wrong_audience_token="$(kubectl -n "$NAMESPACE" create token journey-mcp-client --duration=10m --audience=not-log-debug-context)"
wrong_audience_code="$(kubectl -n "$NAMESPACE" exec journey-mcp-client -- curl --silent --output /dev/null \
  --write-out '%{http_code}' --max-time "$QUERY_TIMEOUT_SECONDS" \
  -H "Authorization: Bearer $wrong_audience_token" -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' "$MCP_URL")"
[ "$wrong_audience_code" = 401 ] || fail "MCP accepted a ServiceAccount JWT for the wrong audience"

authenticated_token="$(kubectl -n "$NAMESPACE" create token journey-mcp-client --duration=10m --audience=log-debug-context)"
if ! authenticated_response="$(kubectl -n "$NAMESPACE" exec journey-mcp-client -- curl --silent --show-error \
  --fail-with-body --max-time "$QUERY_TIMEOUT_SECONDS" -H "Authorization: Bearer $authenticated_token" \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' "$MCP_URL")"; then
  fail "MCP rejected a valid audience-bound ServiceAccount JWT"
fi
printf '%s' "$authenticated_response" | grep -q '"search_logs"' \
  || fail "authenticated MCP tools/list omitted search_logs"
printf '%s' "$authenticated_response" | grep -q '"get_failure_context"' \
  || fail "authenticated MCP tools/list omitted get_failure_context"

FROM_INCLUSIVE="$(node -e 'process.stdout.write(new Date(Date.now()-14*60*1000).toISOString())')"
TO_EXCLUSIVE="$(node -e 'process.stdout.write(new Date(Date.now()+30*1000).toISOString())')"
deadline=$((SECONDS + 120))
retry_count=0
event_wait_started=$SECONDS
until mcp_call get_failure_context "{\"testRunId\":\"$TARGET_RUN_ID\",\"fromInclusive\":\"$FROM_INCLUSIVE\",\"toExclusive\":\"$TO_EXCLUSIVE\",\"maxRecords\":200}" "$WORK_DIR/context.json" 2>/dev/null \
  && grep -q "$TARGET_MARKER" "$WORK_DIR/context.json"; do
  if [ "$SECONDS" -ge "$deadline" ]; then
    if [ -s "$WORK_DIR/context.json" ] && grep -q '"error"' "$WORK_DIR/context.json"; then
      fail "authenticated MCP get_failure_context returned an error before convergence: $(tr '\n' ' ' < "$WORK_DIR/context.json" | cut -c1-300)"
    fi
    checkpoint_a006 "selected collector path did not make the emitted marker observable within 120s"
  fi
  retry_count=$((retry_count + 1))
  sleep 3
done
event_wait_duration_ms=$(((SECONDS - event_wait_started) * 1000))

assert_context "$WORK_DIR/context.json"

started=$SECONDS
mcp_call search_logs "{\"namespace\":\"$NAMESPACE\",\"workload\":\"journey-log-emitter\",\"fromInclusive\":\"$FROM_INCLUSIVE\",\"toExclusive\":\"$TO_EXCLUSIVE\",\"maxRecords\":200}" "$WORK_DIR/bounded.json"
bounded_elapsed=$((SECONDS - started))
[ "$bounded_elapsed" -le 7 ] || fail "live query exceeded the server deadline allowance (elapsed ${bounded_elapsed}s)"
[ "$(wc -c < "$WORK_DIR/bounded.json" | tr -d ' ')" -le 262144 ] || fail "MCP response exceeded 256 KiB"
grep -qi 'truncat' "$WORK_DIR/bounded.json" || fail "over-budget response did not report truncation"
! grep -Eqi 'nextCursor|continuationToken|pageToken' "$WORK_DIR/bounded.json" || fail "MCP exposed pagination"

TOO_WIDE_FROM="$(node -e 'process.stdout.write(new Date(Date.now()-16*60*1000).toISOString())')"
if mcp_call search_logs "{\"namespace\":\"$NAMESPACE\",\"workload\":\"journey-log-emitter\",\"fromInclusive\":\"$TOO_WIDE_FROM\",\"toExclusive\":\"$TO_EXCLUSIVE\",\"maxRecords\":200}" "$WORK_DIR/too-wide.json"; then
  grep -Eqi 'error|invalid|15.minute|interval' "$WORK_DIR/too-wide.json" || fail "interval over 15 minutes was accepted or silently clipped"
fi

if [ -n "${HARNESS_JOURNEY_METRICS:-}" ]; then
  printf '{"eventWaitDurationMs":%s,"retryCount":%s,"liveQueryDurationMs":%s}\n' \
    "$event_wait_duration_ms" "$retry_count" "$((bounded_elapsed * 1000))" > "$HARNESS_JOURNEY_METRICS"
fi

printf 'Kubernetes diagnostic-context journey passed: namespace=%s auth=401/401/200 correlation=exact redaction=clean records<=200 bytes<=262144 interval<=15m live-query=%ss\n' \
  "$NAMESPACE" "$bounded_elapsed"

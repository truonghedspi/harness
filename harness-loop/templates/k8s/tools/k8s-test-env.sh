#!/usr/bin/env bash
# k8s-test-env.sh — Level 3 (microservice integration) test environment via Helm on a real,
# SHARED Kubernetes cluster, no Docker required. See
# docs/reference/k8s-integration-testing.md for the full rationale.
#
# Usage:
#   tools/k8s-test-env.sh <chart-path> [--release NAME] [--keep-on-failure] -- <test-command...>
#   tools/k8s-test-env.sh list-stale [--older-than 24h]
#   tools/k8s-test-env.sh --help
#
# Contract: deploy into an isolated, labelled namespace; wait for real readiness; run the given
# test command against it; dump events + logs of every non-Ready pod BEFORE tearing anything
# down (a report you can still read after the namespace is gone); always clean up unless
# --keep-on-failure is given and the run failed. Every step has a bounded timeout
# (docs/constraints.md) — nothing in this script waits forever.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# --- configuration (fill in for the real chart when adopting this script) --------------------
: "${DEPLOY_TIMEOUT_S:=300}"     # helm upgrade --install --wait budget
: "${TEST_TIMEOUT_S:=600}"       # budget for the test command itself
: "${NAMESPACE_PREFIX:=test}"
: "${REPORT_ROOT:=trace/k8s-test}"
KEEP_ON_FAILURE=0

usage() {
  cat <<'EOF'
Usage:
  k8s-test-env.sh <chart-path> [--release NAME] [--keep-on-failure] -- <test-command...>
  k8s-test-env.sh list-stale [--older-than 24h]
  k8s-test-env.sh --help

Env overrides: DEPLOY_TIMEOUT_S (300), TEST_TIMEOUT_S (600), NAMESPACE_PREFIX (test),
REPORT_ROOT (trace/k8s-test).

Every namespace this script creates is labelled harness-loop-test=true and annotated
created-at=<UTC ISO8601> so `list-stale` (and any cluster-side reaper) can find leftovers.
EOF
}

log() { echo "[k8s-test-env] $*" >&2; }

# A portable bounded-wait wrapper — deliberately NOT relying on the `timeout` binary, which is
# not present on macOS/BSD by default (GNU coreutils only). Polls every second.
run_with_timeout() {
  local timeout_s="$1"; shift
  "$@" &
  local pid=$!
  local waited=0
  while kill -0 "$pid" 2>/dev/null; do
    if [ "$waited" -ge "$timeout_s" ]; then
      kill -9 "$pid" 2>/dev/null
      wait "$pid" 2>/dev/null
      return 124
    fi
    sleep 1
    waited=$((waited + 1))
  done
  wait "$pid"
}

# --- list-stale ---------------------------------------------------------------------------
if [ "${1:-}" = "list-stale" ]; then
  shift
  OLDER_THAN_H=24
  while [ $# -gt 0 ]; do
    case "$1" in
      --older-than) OLDER_THAN_H="${2%h}"; shift 2 ;;
      *) echo "unknown option: $1" >&2; exit 2 ;;
    esac
  done
  NOW_EPOCH=$(date -u +%s)
  echo "Namespaces labelled harness-loop-test=true older than ${OLDER_THAN_H}h (review before deleting):"
  kubectl get namespace -l harness-loop-test=true -o json | node -e "
    const data = JSON.parse(require('fs').readFileSync(0, 'utf8'));
    const now = ${NOW_EPOCH};
    for (const ns of data.items || []) {
      const created = ns.metadata.annotations && ns.metadata.annotations['created-at'];
      if (!created) { console.log(ns.metadata.name + '  (no created-at annotation — check manually)'); continue; }
      const ageH = (now - Date.parse(created) / 1000) / 3600;
      if (ageH > ${OLDER_THAN_H}) {
        console.log(ns.metadata.name + '  age=' + ageH.toFixed(1) + 'h  created-at=' + created);
      }
    }
  " 2>/dev/null || kubectl get namespace -l harness-loop-test=true \
      -o custom-columns='NAME:.metadata.name,CREATED-AT:.metadata.annotations.created-at,AGE:.metadata.creationTimestamp'
  echo ""
  echo "This command only lists — delete by hand with: kubectl delete namespace <name>"
  exit 0
fi

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ] || [ $# -eq 0 ]; then
  usage
  exit 0
fi

# --- parse deploy+test invocation ----------------------------------------------------------
CHART_PATH="$1"; shift
RELEASE_NAME="$(basename "$CHART_PATH")"
TEST_CMD=()
while [ $# -gt 0 ]; do
  case "$1" in
    --release) RELEASE_NAME="$2"; shift 2 ;;
    --keep-on-failure) KEEP_ON_FAILURE=1; shift ;;
    --) shift; TEST_CMD=("$@"); break ;;
    *) echo "unknown option: $1 (did you forget -- before the test command?)" >&2; exit 2 ;;
  esac
done
if [ ${#TEST_CMD[@]} -eq 0 ]; then
  echo "error: no test command given after --" >&2
  usage
  exit 2
fi
if [ ! -d "$CHART_PATH" ]; then
  echo "error: chart path not found: $CHART_PATH" >&2
  exit 2
fi
for bin in kubectl helm; do
  command -v "$bin" >/dev/null 2>&1 || { echo "error: $bin not found on PATH" >&2; exit 2; }
done

SHORT_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo nogit)"
NAMESPACE="${NAMESPACE_PREFIX}-${SHORT_SHA}-$(date +%s)-$$"
REPORT_DIR="${REPORT_ROOT}/${NAMESPACE}"
mkdir -p "$REPORT_DIR"
log "namespace: $NAMESPACE   report: $REPORT_DIR"

EXIT_CODE=0
DEPLOYED=0

dump_diagnostics() {
  log "collecting diagnostics into $REPORT_DIR (before any teardown)"
  kubectl get all -n "$NAMESPACE" -o wide > "$REPORT_DIR/resources.txt" 2>&1 || true
  kubectl get events -n "$NAMESPACE" --sort-by=.lastTimestamp > "$REPORT_DIR/events.txt" 2>&1 || true
  local pod
  for pod in $(kubectl get pods -n "$NAMESPACE" -o jsonpath='{.items[*].metadata.name}' 2>/dev/null); do
    kubectl logs -n "$NAMESPACE" "$pod" --all-containers --tail=500 \
      > "$REPORT_DIR/logs-${pod}.txt" 2>&1 || true
    kubectl logs -n "$NAMESPACE" "$pod" --all-containers --tail=500 --previous \
      > "$REPORT_DIR/logs-${pod}-previous.txt" 2>/dev/null || true
  done
  log "diagnostics: $(ls "$REPORT_DIR" | wc -l | tr -d ' ') file(s) — events.txt is usually the fastest signal"
}

cleanup() {
  local code=$?
  if [ "$KEEP_ON_FAILURE" = "1" ] && [ "$code" != "0" ]; then
    log "KEPT for inspection (--keep-on-failure, exit $code): namespace=$NAMESPACE"
    log "  kubectl -n $NAMESPACE get pods"
    log "  when done: kubectl delete namespace $NAMESPACE"
    return
  fi
  if [ "$DEPLOYED" = "1" ]; then
    log "tearing down: helm uninstall $RELEASE_NAME -n $NAMESPACE"
    helm uninstall "$RELEASE_NAME" -n "$NAMESPACE" >/dev/null 2>&1 || true
  fi
  log "deleting namespace (async): $NAMESPACE"
  kubectl delete namespace "$NAMESPACE" --wait=false >/dev/null 2>&1 || true
}
trap cleanup EXIT

kubectl create namespace "$NAMESPACE" >/dev/null
kubectl label namespace "$NAMESPACE" harness-loop-test=true --overwrite >/dev/null
kubectl annotate namespace "$NAMESPACE" "created-at=$(date -u +%Y-%m-%dT%H:%M:%SZ)" --overwrite >/dev/null

log "deploying: helm upgrade --install $RELEASE_NAME $CHART_PATH -n $NAMESPACE --wait --timeout ${DEPLOY_TIMEOUT_S}s"
if ! helm upgrade --install "$RELEASE_NAME" "$CHART_PATH" -n "$NAMESPACE" \
    --wait --timeout "${DEPLOY_TIMEOUT_S}s"; then
  log "deploy failed or timed out"
  DEPLOYED=1  # partially applied resources may exist — still worth uninstalling on cleanup
  dump_diagnostics
  exit 1
fi
DEPLOYED=1
log "deploy ready"

log "running test command (budget ${TEST_TIMEOUT_S}s): ${TEST_CMD[*]}"
NAMESPACE="$NAMESPACE" run_with_timeout "$TEST_TIMEOUT_S" "${TEST_CMD[@]}"
EXIT_CODE=$?
if [ "$EXIT_CODE" = "124" ]; then
  log "test command timed out after ${TEST_TIMEOUT_S}s"
fi

dump_diagnostics
exit "$EXIT_CODE"

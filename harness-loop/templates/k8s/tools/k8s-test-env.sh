#!/usr/bin/env bash
# k8s-test-env.sh — Level 3 (microservice integration) test environment via Helm on a real,
# SHARED Kubernetes cluster, no Docker required. See
# docs/reference/k8s-integration-testing.md for the full rationale.
#
# Usage:
#   tools/k8s-test-env.sh <chart-path> [--release NAME] [--keep-on-failure] -- <test-command...>
#   tools/k8s-test-env.sh --services services.manifest.json [--only a,b] [--keep-on-failure] -- <cmd...>
#   tools/k8s-test-env.sh list-stale [--older-than 24h]
#   tools/k8s-test-env.sh --help
#
# Contract: deploy into an isolated, labelled namespace; wait for real readiness; run the given
# test command against it; dump events + logs of every non-Ready pod BEFORE tearing anything
# down (a report you can still read after the namespace is gone); always clean up unless
# --keep-on-failure is given and the run failed. Every step has a bounded timeout
# (docs/constraints.md) — nothing in this script waits forever.
#
# Multi-service mode (--services) exists because a cross-service scenario is the only place a
# Level 3 test says anything a Level 2 test could not. Three things it does that a loop over the
# single-chart mode would not (references/multi-service.md):
#   * installs in dependsOn order, refusing to start on a dependency cycle;
#   * treats "the pod is Running" as UNVERIFIED, not as healthy — see health_gate below;
#   * ranks diagnostics on failure. Five services down produce five walls of logs, and the one
#     that matters is the service that failed and the dependencies it was waiting on.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# --- configuration (fill in for the real chart when adopting this script) --------------------
: "${DEPLOY_TIMEOUT_S:=300}"     # helm upgrade --install --wait budget, per service
: "${HEALTH_TIMEOUT_S:=120}"     # budget for a service's own health command, per service
: "${TEST_TIMEOUT_S:=600}"       # budget for the test command itself
: "${NAMESPACE_PREFIX:=test}"
: "${REPORT_ROOT:=trace/k8s-test}"
KEEP_ON_FAILURE=0

usage() {
  cat <<'EOF'
Usage:
  k8s-test-env.sh <chart-path> [--release NAME] [--keep-on-failure] -- <test-command...>
  k8s-test-env.sh --services services.manifest.json [--only a,b] [--keep-on-failure] -- <cmd...>
  k8s-test-env.sh list-stale [--older-than 24h]
  k8s-test-env.sh --help

Env overrides: DEPLOY_TIMEOUT_S (300), HEALTH_TIMEOUT_S (120), TEST_TIMEOUT_S (600),
NAMESPACE_PREFIX (test), REPORT_ROOT (trace/k8s-test).

Multi-service mode reads the registry written by tools/collect-services.mjs. It uses three
fields the collector deliberately leaves for a human:
  chart      required to deploy the service at all; a service without one is skipped, loudly
  dependsOn  install order. null means "no stated dependencies", which is taken at face value
  health     a shell command proving the service is SERVING, run with $NAMESPACE and $RELEASE
             exported and retried until HEALTH_TIMEOUT_S. null means readiness is unverified,
             and the run says so rather than quietly treating Running as healthy

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
# Two modes share everything after the plan is built: a single chart is just a one-service plan.
MANIFEST=""
ONLY=""
CHART_PATH=""
RELEASE_NAME=""
if [ "${1:-}" = "--services" ]; then
  MANIFEST="$2"; shift 2
else
  CHART_PATH="$1"; shift
  RELEASE_NAME="$(basename "$CHART_PATH")"
fi
TEST_CMD=()
while [ $# -gt 0 ]; do
  case "$1" in
    --release) RELEASE_NAME="$2"; shift 2 ;;
    --only) ONLY="$2"; shift 2 ;;
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
for bin in kubectl helm; do
  command -v "$bin" >/dev/null 2>&1 || { echo "error: $bin not found on PATH" >&2; exit 2; }
done

# --- build the install plan ------------------------------------------------------------------
# One line per service: id US chart US health US dependsOn(csv), where US is 0x1F. NOT tab: tab is
# an IFS *whitespace* character, so bash collapses runs of them and an empty `health` field silently
# shifts dependsOn into its place — the script then ran a service name as a health command. A
# non-whitespace separator preserves empty fields, which is the whole point here.
# The topological sort lives in node rather than bash because a cycle must be a hard error with the
# cycle named, and detecting that in shell is how you get a script that hangs instead of one that
# explains.
PLAN_FILE="$(mktemp)"
trap 'rm -f "$PLAN_FILE"' EXIT
if [ -n "$MANIFEST" ]; then
  [ -f "$MANIFEST" ] || { echo "error: manifest not found: $MANIFEST" >&2; exit 2; }
  if ! node -e '
    const fs = require("fs");
    const m = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const only = process.argv[2] ? process.argv[2].split(",").map(s => s.trim()).filter(Boolean) : null;
    let svcs = (m.services || []).filter(s => s.kind === "service");
    if (only) {
      const missing = only.filter(id => !svcs.some(s => s.id === id));
      if (missing.length) { console.error("--only names unknown service(s): " + missing.join(", ")); process.exit(2); }
      // Pull in dependencies transitively: asking for a service means asking for what it needs.
      const want = new Set(only);
      for (let changed = true; changed; ) {
        changed = false;
        for (const s of svcs) if (want.has(s.id)) for (const d of s.dependsOn || [])
          if (!want.has(d)) { want.add(d); changed = true; }
      }
      svcs = svcs.filter(s => want.has(s.id));
    }
    const byId = new Map(svcs.map(s => [s.id, s]));
    // Kahn, so a cycle is left over rather than blowing the stack.
    const indeg = new Map(svcs.map(s => [s.id, (s.dependsOn || []).filter(d => byId.has(d)).length]));
    const ready = svcs.filter(s => indeg.get(s.id) === 0).map(s => s.id).sort();
    const order = [];
    while (ready.length) {
      const id = ready.shift();
      order.push(id);
      for (const s of svcs) if ((s.dependsOn || []).includes(id)) {
        indeg.set(s.id, indeg.get(s.id) - 1);
        if (indeg.get(s.id) === 0) ready.push(s.id);
      }
    }
    if (order.length !== svcs.length) {
      const stuck = svcs.filter(s => !order.includes(s.id)).map(s => s.id);
      console.error("dependsOn contains a cycle among: " + stuck.join(", "));
      console.error("Refusing to install: there is no order that satisfies it, and picking one");
      console.error("arbitrarily produces a failure whose cause is the manifest, not the code.");
      process.exit(2);
    }
    const unknown = svcs.flatMap(s => (s.dependsOn || []).filter(d => !byId.has(d)).map(d => `${s.id} -> ${d}`));
    if (unknown.length) console.error("[plan] dependsOn names service(s) not in this run: " + unknown.join(", "));
    for (const id of order) {
      const s = byId.get(id);
      const health = typeof s.health === "string" ? s.health : (s.health && s.health.command) || "";
      process.stdout.write([id, s.chart || "", health, (s.dependsOn || []).join(",")].join("\u001f") + "\n");
    }
  ' "$MANIFEST" "$ONLY" > "$PLAN_FILE"; then
    exit 2
  fi
else
  [ -d "$CHART_PATH" ] || { echo "error: chart path not found: $CHART_PATH" >&2; exit 2; }
  printf '%s\037%s\037%s\037%s\n' "$RELEASE_NAME" "$CHART_PATH" "" "" > "$PLAN_FILE"
fi

PLAN_COUNT=$(grep -c . "$PLAN_FILE" || true)
[ "$PLAN_COUNT" -gt 0 ] || { echo "error: nothing to deploy (no kind=service entries with a chart)" >&2; exit 2; }

SHORT_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo nogit)"
NAMESPACE="${NAMESPACE_PREFIX}-${SHORT_SHA}-$(date +%s)-$$"
REPORT_DIR="${REPORT_ROOT}/${NAMESPACE}"
mkdir -p "$REPORT_DIR"
JOURNEY_DETAIL_FILE="$REPORT_DIR/journey-detail.json"
RUN_STARTED_MS="$(node -e 'process.stdout.write(String(Date.now()))')"
DEPLOY_FINISHED_MS=""
TEST_STARTED_MS=""
TEST_FINISHED_MS=""
log "namespace: $NAMESPACE   services: $PLAN_COUNT   report: $REPORT_DIR"

EXIT_CODE=0
DEPLOYED=0
INSTALLED=""          # ids installed so far, in order
FAILED_ID=""          # the service that broke the run, if any
FAILED_DEPS=""

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
  write_reading_order
  log "diagnostics: $(ls "$REPORT_DIR" | wc -l | tr -d ' ') file(s) — READ-THIS-FIRST.txt gives the order"
}

# Ranking, not just collecting. With one service the order is obvious; with five it is the whole
# difference between a diagnosis and a pile of logs. The failing service comes first, then what it
# was waiting on (a dependency that came up unhealthy is the usual root cause of the one after it),
# then everything else.
write_reading_order() {
  {
    echo "Read in this order — ranked by likelihood of containing the cause:"
    echo ""
    if [ -n "$FAILED_ID" ]; then
      echo "  1. logs-${FAILED_ID}*.txt   <- the service that failed"
      local rank=2 dep
      for dep in ${FAILED_DEPS//,/ }; do
        [ -n "$dep" ] || continue
        echo "  ${rank}. logs-${dep}*.txt   <- ${FAILED_ID} depends on this; if it came up sick, look here before the code"
        rank=$((rank + 1))
      done
      echo "  ${rank}. events.txt          <- scheduling, image pull, probe failures"
    else
      echo "  1. events.txt          <- scheduling, image pull, probe failures"
      echo "  2. logs-*.txt          <- all services; the test command failed, not a deploy"
    fi
    echo ""
    echo "Installed in order: ${INSTALLED:-none}"
    [ -n "$FAILED_ID" ] && echo "Failed at: $FAILED_ID"
    echo "Namespace: $NAMESPACE (deleted on exit unless --keep-on-failure)"
  } > "$REPORT_DIR/READ-THIS-FIRST.txt" 2>/dev/null || true
}

cleanup() {
  local code=$?
  local ended_ms
  ended_ms="$(node -e 'process.stdout.write(String(Date.now()))')"
  node -e '
    const fs=require("fs"), a=process.argv.slice(1), n=(x)=>x===null||x===undefined||x==="" ? null : Number(x);
    const [file,detailFile,runId,namespace,started,deployFinished,testStarted,testFinished,ended,exitCode]=a;
    let detail={}; try { detail=JSON.parse(fs.readFileSync(detailFile,"utf8")); } catch {}
    const duration=(a,b)=>a&&b ? n(b)-n(a) : null;
    fs.writeFileSync(file, JSON.stringify({schema:"business-journey-telemetry/1",runId,namespace,
      deploymentDurationMs:duration(started,deployFinished||ended),readinessDurationMs:duration(started,deployFinished),
      scenarioDurationMs:duration(testStarted,testFinished),eventWaitDurationMs:n(detail.eventWaitDurationMs),retryCount:n(detail.retryCount),
      diagnosticsCollected:fs.existsSync(require("path").dirname(file)+"/READ-THIS-FIRST.txt"),
      totalDurationMs:duration(started,ended),exitCode:n(exitCode),payloads:"redacted"},null,2)+"\n");
  ' "$REPORT_DIR/journey-metrics.json" "$JOURNEY_DETAIL_FILE" "${HARNESS_RUN_ID:-$NAMESPACE}" "$NAMESPACE" "$RUN_STARTED_MS" "$DEPLOY_FINISHED_MS" "$TEST_STARTED_MS" "$TEST_FINISHED_MS" "$ended_ms" "$code" 2>/dev/null || true
  rm -f "$PLAN_FILE"
  if [ "$KEEP_ON_FAILURE" = "1" ] && [ "$code" != "0" ]; then
    log "KEPT for inspection (--keep-on-failure, exit $code): namespace=$NAMESPACE"
    log "  kubectl -n $NAMESPACE get pods"
    log "  when done: kubectl delete namespace $NAMESPACE"
    return
  fi
  # Deleting the namespace takes every release in it, whatever state each one reached. That is why
  # one namespace per run: partial bring-up has no separate teardown path to get wrong.
  if [ "$DEPLOYED" = "1" ]; then
    log "tearing down namespace $NAMESPACE (${INSTALLED:-no} release(s) installed)"
  fi
  kubectl delete namespace "$NAMESPACE" --wait=false >/dev/null 2>&1 || true
}
trap cleanup EXIT

# A service is healthy when it SERVES, not when its pod is Running. Helm --wait only knows about
# readiness probes, so a chart without one reports ready the moment the container starts — and the
# test then fails somewhere less obvious than the service that was never up. Where the registry
# states a health command we run it; where it does not, we say readiness is unverified rather than
# inventing a check (references/multi-service.md).
health_gate() {
  local id="$1" cmd="$2"
  if [ -z "$cmd" ]; then
    log "  ! $id: no health command in the registry — readiness UNVERIFIED (helm --wait only proves Running)"
    log "    fill in health for $id in the manifest; the collector leaves it for a human on purpose"
    return 0
  fi
  local waited=0
  while [ "$waited" -lt "$HEALTH_TIMEOUT_S" ]; do
    if NAMESPACE="$NAMESPACE" RELEASE="$id" bash -c "$cmd" >/dev/null 2>&1; then
      log "  $id: healthy after ${waited}s"
      return 0
    fi
    sleep 3
    waited=$((waited + 3))
  done
  log "  $id: health command never succeeded within ${HEALTH_TIMEOUT_S}s: $cmd"
  return 1
}

# Preflight. Without it an unreachable cluster produces a wall of API errors from every later
# command and the run reads as a deploy failure — the one thing it is not.
if ! kubectl version -o json >/dev/null 2>&1; then
  log "cannot reach a Kubernetes cluster (kubectl version failed)."
  log "  current context: $(kubectl config current-context 2>/dev/null || echo '<none set>')"
  log "  this is an environment problem, not a test failure — nothing was deployed."
  exit 2
fi
if ! kubectl create namespace "$NAMESPACE" >/dev/null; then
  log "could not create namespace $NAMESPACE — check RBAC for this context."
  exit 2
fi
kubectl label namespace "$NAMESPACE" harness-loop-test=true --overwrite >/dev/null
kubectl annotate namespace "$NAMESPACE" "created-at=$(date -u +%Y-%m-%dT%H:%M:%SZ)" --overwrite >/dev/null

while IFS=$'\037' read -r ID CHART HEALTH DEPS; do
  [ -n "$ID" ] || continue
  if [ -z "$CHART" ]; then
    log "! $ID has no chart in the registry — skipped. A service in the plan that cannot be deployed"
    log "  is a gap in the manifest, not a service that does not matter."
    continue
  fi
  if [ ! -d "$CHART" ]; then
    log "! $ID: chart path does not exist: $CHART"
    FAILED_ID="$ID"; FAILED_DEPS="$DEPS"
    dump_diagnostics
    exit 1
  fi
  log "deploying $ID: helm upgrade --install $ID $CHART -n $NAMESPACE --wait --timeout ${DEPLOY_TIMEOUT_S}s"
  DEPLOYED=1   # partially applied resources may exist from here on
  if ! helm upgrade --install "$ID" "$CHART" -n "$NAMESPACE" --wait --timeout "${DEPLOY_TIMEOUT_S}s"; then
    log "deploy failed or timed out: $ID"
    FAILED_ID="$ID"; FAILED_DEPS="$DEPS"
    dump_diagnostics
    exit 1
  fi
  if ! health_gate "$ID" "$HEALTH"; then
    FAILED_ID="$ID"; FAILED_DEPS="$DEPS"
    dump_diagnostics
    exit 1
  fi
  INSTALLED="${INSTALLED:+$INSTALLED, }$ID"
done < "$PLAN_FILE"

DEPLOY_FINISHED_MS="$(node -e 'process.stdout.write(String(Date.now()))')"
log "environment up: $INSTALLED"
log "running test command (budget ${TEST_TIMEOUT_S}s): ${TEST_CMD[*]}"
TEST_STARTED_MS="$(node -e 'process.stdout.write(String(Date.now()))')"
NAMESPACE="$NAMESPACE" HARNESS_RUN_ID="${HARNESS_RUN_ID:-$NAMESPACE}" HARNESS_JOURNEY_METRICS="$JOURNEY_DETAIL_FILE" run_with_timeout "$TEST_TIMEOUT_S" "${TEST_CMD[@]}"
EXIT_CODE=$?
TEST_FINISHED_MS="$(node -e 'process.stdout.write(String(Date.now()))')"
if [ "$EXIT_CODE" = "124" ]; then
  log "test command timed out after ${TEST_TIMEOUT_S}s"
fi

dump_diagnostics
exit "$EXIT_CODE"

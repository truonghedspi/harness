#!/usr/bin/env bash
# run-loop.sh — headless maker–checker loop via kiro-cli (the automation / heartbeat, Lesson 13).
# Usage: loop/run-loop.sh [iterations] [--headless]   (default 1, attended)
#
# Attended is the default ON PURPOSE. The early value of this loop is a human watching it go wrong
# and fixing the harness; unattended is what you graduate to. Watch a headless run from a second
# terminal with: node tools/loop-status.mjs --watch
# Requires: kiro-cli logged in (or KIRO_API_KEY), or the `claude` CLI. See dispatch() below.
#
# Runs on kiro-cli or Claude Code. Set HARNESS_RUNTIME=kiro|claude to force one; otherwise it is
# detected from which agent directory exists. Both are generated from agents.manifest.json, so the
# same roles, resources and write restrictions apply either way — see docs/reference/runtimes.md
# for the two places the runtimes genuinely differ.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
case "${1:-}" in ""|--*) ITERATIONS=1 ;; *) ITERATIONS="$1" ;; esac

# --- attended by default -------------------------------------------------------------------------
# A loop you cannot watch is a loop you cannot correct. Early on, the whole value is a human seeing
# where it goes wrong and fixing the harness; unattended running is what you graduate to once the
# routing and the gates have stopped surprising you. So: pause between iterations, show what
# changed, and let a human look before spending the next session.
#
# --headless (or HARNESS_ATTENDED=0) for CI, cron, and anything without a terminal. With no TTY on
# stdin there is nobody to prompt, so it falls back to headless and SAYS so rather than blocking
# forever on a read that can never return.
ATTENDED="${HARNESS_ATTENDED:-1}"
for a in "$@"; do
  case "$a" in
    --headless) ATTENDED=0 ;;
    --attended) ATTENDED=1 ;;
  esac
done
if [ "$ATTENDED" = "1" ] && [ ! -t 0 ]; then
  echo "no TTY on stdin — running headless. Watch it with: node tools/loop-status.mjs --watch"
  ATTENDED=0
fi

# Mechanical goal check: every feature done, or blocked WITH a recorded reason (checkerNotes, or
# a DECISIONS.md entry naming the feature — the same justification rule verify-harness's
# blocked-unjustified check enforces). When it holds, spawning another maker/checker pair is a
# paid LLM session whose only possible output is "nothing to do" — exit instead. The semantic
# stop conditions in loop/goal.md still belong to the agents; this catches only the unambiguous
# all-work-finished case.
all_settled() {
  node -e '
    const { readFileSync } = require("fs");
    const fl = require("./feature_list.json");
    let decisions = ""; try { decisions = readFileSync("DECISIONS.md", "utf8"); } catch {}
    const open = (fl.features || []).filter(f => {
      const s = String(f.status || f.state || "");
      if (s === "done" || s === "passing") return false;
      if (s === "blocked" &&
          (String(f.checkerNotes || "").trim() || decisions.includes(f.id))) return false;
      return true;
    });
    process.exit(open.length === 0 ? 0 : 1);
  ' 2>/dev/null
}

# Checked BEFORE the credential gate on purpose: a loop with nothing left to do should say so and
# exit 0 whether or not headless auth is configured — found by running exactly that case for real.
if all_settled; then
  echo "all features done (or blocked with a recorded reason) — nothing to do, exiting early."
  exit 0
fi

# Runtime selection and dispatch() live in loop/dispatch.sh, sourced here — the same code a human
# or the orchestrator runs to hand work to a NAMED agent. Two copies of "how do I start an agent on
# this machine" is two things to drift, and the runtimes are exactly where drift is invisible.
. loop/dispatch.sh
echo "runtime: $RUNTIME"

for i in $(seq 1 "$ITERATIONS"); do
  if all_settled; then
    echo "all features done (or blocked with a recorded reason) — nothing left for iteration $i, exiting early."
    exit 0
  fi

  # Which node runs is a routing decision, not a constant. Before loop/route.mjs existed this line
  # always said "maker", while the prompts described eleven nodes — so a feature marked
  # NEEDS DESIGN: parked forever and the loop burned a paid session per iteration skipping it
  # (docs/reference/graph.md, "The seven implicit edges").
  NEXT_JSON="$(node loop/route.mjs --json 2>/dev/null)" || true
  NEXT="$(printf '%s' "$NEXT_JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);console.log(j.node+"\t"+j.kind+"\t"+j.layer+"\t"+j.why)}catch{console.log("maker\tagent\timplementation\t(router unavailable — defaulting)")}})')"
  NODE="$(printf '%s' "$NEXT" | cut -f1)"; KIND="$(printf '%s' "$NEXT" | cut -f2)"
  # Record what was dispatched, so the router can tell "this node has not had a turn on this marker"
  # from "it had one and the marker is unchanged". The router stays pure and reads this back; a
  # marker whose text changes is a NEW question and starts the ladder over.
  printf '%s' "$NEXT_JSON" | node -e '
    let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
      try {
        const j=JSON.parse(s);
        if (!j.hash || !j.feature) return;
        require("fs").appendFileSync("loop/route-log.jsonl",
          JSON.stringify({ node: j.node, feature: j.feature, hash: j.hash }) + "\n");
      } catch {}
    });' 2>/dev/null || true
  LAYER="$(printf '%s' "$NEXT" | cut -f3)"; WHY="$(printf '%s' "$NEXT" | cut -f4)"
  echo "=== iteration $i/$ITERATIONS — route → $NODE [layer: $LAYER] ==="
  echo "    $WHY"

  case "$NODE" in
    exit)  echo "router: nothing left to route — exiting."; exit 0 ;;
    human) echo "router: features are open but no rule routes them — a human must look."
           echo "        $WHY" >> session-handoff.md; exit 3 ;;
  esac

  if [ "$KIND" = "agent" ]; then
    # Publish the in-flight node for tools/loop-status.mjs. A stale entry with no live process is
    # itself a signal: that iteration crashed or was killed.
    node -e '
      const fs=require("fs");
      fs.writeFileSync("loop/current.json", JSON.stringify({
        node: process.argv[1], feature: process.argv[2] || null,
        iteration: Number(process.argv[3]) || null, startedAt: Date.now(),
      }, null, 2));
    ' "$NODE" "$(printf '%s' "$NEXT_JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).feature||"")}catch{}})')" "$i" 2>/dev/null || true
    dispatch "$NODE" \
      "You are running HEADLESS under loop/run-loop.sh — no human can answer questions, so commit directly instead of asking. The router selected you because: $WHY. Run exactly one iteration per your instructions and loop/goal.md. Honor every stop condition." \
      || { echo "$NODE failed — stopping loop"; exit 1; }
    node -e 'const fs=require("fs");try{const j=JSON.parse(fs.readFileSync("loop/current.json","utf8"));j.finishedAt=Date.now();fs.writeFileSync("loop/current.json",JSON.stringify(j,null,2));}catch{}' 2>/dev/null || true
  fi

  # The checkpoint. Everything a human needs to decide "keep going or stop and fix the harness",
  # in one screen, before the next paid session starts.
  if [ "$ATTENDED" = "1" ]; then
    echo ""
    echo "── after iteration $i/$ITERATIONS: $NODE ──"
    git --no-pager diff --stat HEAD 2>/dev/null | tail -8
    [ -f tools/loop-status.mjs ] && node tools/loop-status.mjs --target . 2>/dev/null
    printf 'continue? [Enter]=yes  s=full status  d=diff  q=quit : '
    while read -r ans; do
      case "$ans" in
        q|Q) echo "stopped by the human after iteration $i."; exit 0 ;;
        s|S) node tools/loop-status.mjs --target . 2>/dev/null ;;
        d|D) git --no-pager diff HEAD 2>/dev/null | head -120 ;;
        *)   break ;;
      esac
      printf 'continue? [Enter]=yes  s=full status  d=diff  q=quit : '
    done
  fi

  # Only a maker iteration produces claims to check. Any other node (designer, planner,
  # test-designer, k8s-tester) changes the routing inputs instead — re-route immediately.
  if [ "$NODE" != "maker" ] && [ "$NODE" != "k8s-integration-tester" ]; then
    continue
  fi

  # Mechanical half of the checker's job first (cheap script, not an LLM session): replay every
  # readyForCheck feature's evidence and promote the ones that reproduce in an otherwise
  # blocker-free report. The checker then spends its judgment only on what's left — semantic
  # review, scope bleed, rejected claims. Never touches status:blocked. Non-fatal if it can't run.
  # Human-approval node, on the one edge nobody was judging: --promote makes `done` terminal, and
  # `done` is the state no later node revisits. Selective by design — it stops only when the batch
  # carries judgement actually owed, because a gate that always fires trains a rubber stamp.
  PROMOTE=1
  if [ -f loop/approval-gate.mjs ]; then
    if ! node loop/approval-gate.mjs --check; then
      echo "=== iteration $i/$ITERATIONS — HUMAN APPROVAL required before promote ==="
      if node loop/approval-gate.mjs --wait --timeout-min "${APPROVAL_TIMEOUT_MIN:-0}" --on-timeout "${APPROVAL_ON_TIMEOUT:-reject}"; then
        echo "approved — promoting."
      else
        echo "not approved — skipping promote; features stay readyForCheck for the checker."
        PROMOTE=0
      fi
      rm -f loop/approval.md loop/approval-request.md
    fi
  fi

  if [ -f tools/verify-harness.mjs ] && [ "$PROMOTE" = "1" ]; then
    echo "=== iteration $i/$ITERATIONS — mechanical evidence replay (verify-harness --promote) ==="
    node tools/verify-harness.mjs --target . --skip-baseline --run-features --promote --quiet \
      || echo "promote pass reported findings — leaving them for the checker"
  fi

  echo "=== iteration $i/$ITERATIONS — checker ==="
  dispatch checker \
    "Check every feature with readyForCheck=true per your instructions. Verdicts and reasons only." \
    || { echo "checker failed — stopping loop"; exit 1; }

  # The gate is init.mjs; init.sh/init.cmd are wrappers. Call node directly so this line works
  # under Git Bash on Windows too, and fall back for targets scaffolded before the port.
  if [ -f init.mjs ]; then BASELINE_CMD="node init.mjs"; else BASELINE_CMD="./init.sh"; fi
  $BASELINE_CMD || { echo "baseline red after iteration $i — stopping loop"; exit 1; }
  BASELINE_CHECKED=1
done

# Memory hygiene report (report-only, never fails the loop): surfaces oversized indexes, orphan
# entries, and likely duplicates so the next session's agents inherit organized memory instead of
# an unread pile — docs/reference/agent-memory.md, "Consolidation".
if [ -f tools/memory-consolidate.mjs ]; then
  echo "=== memory consolidation report ==="
  node tools/memory-consolidate.mjs --target . || true
fi

# Cross-cutting drift report (report-only): surfaces policies nobody owns before the next batch of
# features inherits whatever the last one happened to do — docs/reference/design-engineering.md.
if [ -f tools/cross-cutting-audit.mjs ]; then
  echo "=== cross-cutting audit ==="
  node tools/cross-cutting-audit.mjs --target . || true
fi

# Say what actually happened. This line used to be the literal string "baseline green", asserted
# unconditionally — and every non-maker node `continue`s past the baseline run above, so a loop that
# never verified anything still signed off as green. Observed for real: a codex test-implementer
# iteration stopped BECAUSE the baseline was red, and this line then reported it green.
if [ "${BASELINE_CHECKED:-0}" = "1" ]; then
  echo "loop finished: $ITERATIONS iteration(s), baseline green."
else
  echo "loop finished: $ITERATIONS iteration(s). Baseline NOT re-checked this run — no maker"
  echo "  iteration ran, and only those trigger it. Run the gate yourself before trusting this."
fi

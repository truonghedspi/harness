#!/usr/bin/env bash
# run-loop.sh — headless maker–checker loop via kiro-cli (the automation / heartbeat, Lesson 13).
# Usage: loop/run-loop.sh [iterations]   (default 1)
# Requires: kiro-cli logged in (or KIRO_API_KEY), or the `claude` CLI. See dispatch() below.
#
# Runs on kiro-cli or Claude Code. Set HARNESS_RUNTIME=kiro|claude to force one; otherwise it is
# detected from which agent directory exists. Both are generated from agents.manifest.json, so the
# same roles, resources and write restrictions apply either way — see docs/reference/runtimes.md
# for the two places the runtimes genuinely differ.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
ITERATIONS="${1:-1}"

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

# --- runtime selection -------------------------------------------------------------------------
RUNTIME="${HARNESS_RUNTIME:-}"
if [ -z "$RUNTIME" ]; then
  if   command -v kiro-cli >/dev/null 2>&1 && [ -d .kiro/agents ];   then RUNTIME=kiro
  elif command -v claude   >/dev/null 2>&1 && [ -d .claude/agents ]; then RUNTIME=claude
  else
    echo "no runtime — install kiro-cli with .kiro/agents/, or claude with .claude/agents/." >&2
    echo "Generate the missing one: node tools/gen-agents.mjs --target . --runtime both" >&2
    exit 1
  fi
fi

case "$RUNTIME" in
  kiro)
    # Auth: an API key OR an existing kiro-cli login both work — found via real use (the CLI was
    # logged in interactively; demanding the env var anyway blocked a perfectly runnable loop).
    if [ -z "${KIRO_API_KEY:-}" ] && ! kiro-cli whoami >/dev/null 2>&1; then
      echo "no auth — set KIRO_API_KEY or log in first (kiro-cli login)." >&2; exit 1
    fi ;;
  claude)
    [ -d .claude/agents ] || { echo "runtime=claude but .claude/agents/ is missing." >&2; exit 1; } ;;
  *) echo "unknown HARNESS_RUNTIME=$RUNTIME (expected kiro or claude)" >&2; exit 1 ;;
esac
echo "runtime: $RUNTIME"

# One entry point for both. --trust-all-tools / --dangerously-skip-permissions grant tools without
# confirmation, which is safe only because each agent's generated config bounds what it may do:
# on kiro via toolsSettings.write.allowedPaths, on Claude Code via the per-agent PreToolUse hook
# (tools/guard-write.mjs). Those are not decoration — they are what stops the checker fixing the
# maker's work and passing it off as the maker's.
dispatch() {  # dispatch <agent> <message>
  case "$RUNTIME" in
    kiro)   kiro-cli chat --agent "$1" --no-interactive --trust-all-tools "$2" ;;
    claude) claude -p "$2" --agent "$1" --dangerously-skip-permissions < /dev/null ;;
  esac
}

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
  LAYER="$(printf '%s' "$NEXT" | cut -f3)"; WHY="$(printf '%s' "$NEXT" | cut -f4)"
  echo "=== iteration $i/$ITERATIONS — route → $NODE [layer: $LAYER] ==="
  echo "    $WHY"

  case "$NODE" in
    exit)  echo "router: nothing left to route — exiting."; exit 0 ;;
    human) echo "router: features are open but no rule routes them — a human must look."
           echo "        $WHY" >> session-handoff.md; exit 3 ;;
  esac

  if [ "$KIND" = "agent" ]; then
    dispatch "$NODE" \
      "You are running HEADLESS under loop/run-loop.sh — no human can answer questions, so commit directly instead of asking. The router selected you because: $WHY. Run exactly one iteration per your instructions and loop/goal.md. Honor every stop condition." \
      || { echo "$NODE failed — stopping loop"; exit 1; }
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

  ./init.sh || { echo "baseline red after iteration $i — stopping loop"; exit 1; }
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

echo "loop finished: $ITERATIONS iteration(s), baseline green."

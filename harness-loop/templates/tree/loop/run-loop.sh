#!/usr/bin/env bash
# run-loop.sh — headless maker–checker loop via kiro-cli (the automation / heartbeat, Lesson 13).
# Usage: loop/run-loop.sh [iterations]   (default 1)
# Requires: KIRO_API_KEY set for headless auth. Verify flags with `kiro-cli chat --help`.
#
# --trust-all-tools grants tools without confirmation — safe only because each agent's JSON
# config + AGENTS.md invariants bound what it may do (checker is write-restricted to state files,
# MCP connectors read-only). Tighten to --trust-tools=read,write,shell if policy requires.
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

# Auth: an API key OR an existing kiro-cli login both work — found via real use (the CLI was
# logged in interactively; demanding the env var anyway blocked a perfectly runnable loop).
if [ -z "${KIRO_API_KEY:-}" ] && ! kiro-cli whoami >/dev/null 2>&1; then
  echo "no auth — set KIRO_API_KEY or log in first (kiro-cli login)." >&2
  exit 1
fi

for i in $(seq 1 "$ITERATIONS"); do
  if all_settled; then
    echo "all features done (or blocked with a recorded reason) — nothing left for iteration $i, exiting early."
    exit 0
  fi

  echo "=== iteration $i/$ITERATIONS — maker ==="
  kiro-cli chat --agent maker --no-interactive --trust-all-tools \
    "You are running HEADLESS under loop/run-loop.sh — no human can answer questions, so commit directly per your step 10 instead of asking. Run exactly one maker iteration per your instructions and loop/goal.md. Honor every stop condition." \
    || { echo "maker failed — stopping loop"; exit 1; }

  # Mechanical half of the checker's job first (cheap script, not an LLM session): replay every
  # readyForCheck feature's evidence and promote the ones that reproduce in an otherwise
  # blocker-free report. The checker then spends its judgment only on what's left — semantic
  # review, scope bleed, rejected claims. Never touches status:blocked. Non-fatal if it can't run.
  if [ -f tools/verify-harness.mjs ]; then
    echo "=== iteration $i/$ITERATIONS — mechanical evidence replay (verify-harness --promote) ==="
    node tools/verify-harness.mjs --target . --skip-baseline --run-features --promote --quiet \
      || echo "promote pass reported findings — leaving them for the checker"
  fi

  echo "=== iteration $i/$ITERATIONS — checker ==="
  kiro-cli chat --agent checker --no-interactive --trust-all-tools \
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

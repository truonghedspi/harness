#!/usr/bin/env bash
# dispatch.sh — run ONE named agent, on whichever runtime this machine has.
#
# Two callers, one implementation:
#   sourced   by loop/run-loop.sh, which needs $RUNTIME and the dispatch() function
#   executed  by a human or the orchestrator, to hand work to a specific agent:
#               loop/dispatch.sh designer "The human chose option 2: keep REQ-MDC-SIT-002 …"
#
# Why it is its own file: the orchestrator's job includes routing a human's answer to the agent that
# OWNS that file — designer for a design question, planner for scope. It could not. dispatch() lived
# inside run-loop.sh as a private function, and run-loop.sh only ever runs the node the ROUTER named,
# so the one thing left to a human's judgement had no command. Only Codex had a standalone path
# (tools/codex-dispatch.mjs), so the gap was invisible on that runtime and total on the other two.
#
# This does NOT decide who runs — `node loop/route.mjs` does that, and the orchestrator is forbidden
# to route around it. This is for the case where a human has already decided.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# --- runtime selection ---------------------------------------------------------------------------
RUNTIME="${HARNESS_RUNTIME:-}"
if [ -z "$RUNTIME" ]; then
  if   command -v kiro-cli >/dev/null 2>&1 && [ -d .kiro/agents ];   then RUNTIME=kiro
  elif command -v claude   >/dev/null 2>&1 && [ -d .claude/agents ]; then RUNTIME=claude
  elif command -v codex    >/dev/null 2>&1 && [ -d .codex/agents ];  then RUNTIME=codex
  else
    echo "no runtime — install kiro-cli, claude or codex, with the matching agents directory." >&2
    echo "Generate the missing one: node tools/gen-agents.mjs --target . --runtime all" >&2
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
  codex)
    # .codex/agents is for interactive use; headless dispatch assembles the role itself, so the file
    # that actually has to exist is the guard's hook config — without it a write-restricted role
    # runs unrestricted and nothing says so.
    [ -f .codex/hooks.json ] || { echo "runtime=codex but .codex/hooks.json is missing — write restrictions would not be enforced. Run: node tools/gen-agents.mjs --target . --runtime codex" >&2; exit 1; }
    codex login status >/dev/null 2>&1 || { echo "codex is not logged in (codex login)." >&2; exit 1; } ;;
  *) echo "unknown HARNESS_RUNTIME=$RUNTIME (expected kiro, claude or codex)" >&2; exit 1 ;;
esac

# --- the one entry point -------------------------------------------------------------------------
# --trust-all-tools / --dangerously-skip-permissions grant tools without confirmation, which is safe
# only because each agent's generated config bounds what it may do: on kiro via
# toolsSettings.write.allowedPaths, on Claude Code via the per-agent PreToolUse hook, on Codex via
# the project-level hook plus HARNESS_AGENT (tools/guard-write.mjs). Those are what stop the checker
# fixing the maker's work and passing it off as the maker's. Codex has no --agent flag, so its role
# is assembled by tools/codex-dispatch.mjs.
dispatch() {  # dispatch <agent> <message>
  local out rc
  out="$(mktemp)"
  case "$RUNTIME" in
    kiro)   kiro-cli chat --agent "$1" --no-interactive --trust-all-tools "$2" 2>&1 | tee "$out"; rc=${PIPESTATUS[0]} ;;
    claude) claude -p "$2" --agent "$1" --dangerously-skip-permissions < /dev/null 2>&1 | tee "$out"; rc=${PIPESTATUS[0]} ;;
    codex)  node tools/codex-dispatch.mjs "$1" "$2" 2>&1 | tee "$out"; rc=${PIPESTATUS[0]} ;;
  esac
  if grep -Eqi 'monthly request limit reached|rate limit exceeded|quota exceeded|usage limit reached|temporarily unavailable' "$out"; then
    echo "runtime refused the dispatch despite its process status; no agent work is accepted" >&2
    rm -f "$out"; return 75
  fi
  rm -f "$out"; return "${rc:-1}"
}

# Executed directly rather than sourced: dispatch what the caller named and exit with its status.
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  if [ $# -lt 2 ]; then
    echo "usage: loop/dispatch.sh <agent> \"<message>\"" >&2
    echo "" >&2
    echo "Runs one named agent on the detected runtime (currently: $RUNTIME)." >&2
    echo "To let the ROUTER choose instead — which is the normal path — use loop/run-loop.sh 1." >&2
    exit 2
  fi
  AGENT="$1"; shift
  if ! node -e '
    const fs=require("fs");
    const m=JSON.parse(fs.readFileSync("agents.manifest.json","utf8"));
    process.exit((m.agents||[]).some(a=>a.name===process.argv[1]) ? 0 : 1);
  ' "$AGENT" 2>/dev/null; then
    echo "no agent \"$AGENT\" in agents.manifest.json" >&2
    exit 2
  fi
  echo "runtime: $RUNTIME — dispatching $AGENT"
  dispatch "$AGENT" "$*"
  exit $?
fi

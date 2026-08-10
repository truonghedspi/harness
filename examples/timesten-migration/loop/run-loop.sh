#!/usr/bin/env bash
# run-loop.sh — headless maker–checker loop via kiro-cli (Kiro CLI 2.0+ headless mode).
# Usage: loop/run-loop.sh [iterations]   (default 1)
# Requires: KIRO_API_KEY set for headless auth; verify flags with `kiro-cli chat --help`.
#
# --trust-all-tools grants every tool without confirmation — acceptable only because the
# agents' own configs and AGENTS.md invariants bound what they may do (read-only MCP,
# checker write-restricted). Tighten to --trust-tools=read,write,shell if policy requires.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
ITERATIONS="${1:-1}"

if [ -z "${KIRO_API_KEY:-}" ]; then
  echo "KIRO_API_KEY is not set — headless mode needs API-key auth." >&2
  exit 1
fi

for i in $(seq 1 "$ITERATIONS"); do
  echo "=== iteration $i/$ITERATIONS — maker ==="
  kiro-cli chat --agent maker --no-interactive --trust-all-tools \
    "Run exactly one maker iteration per your instructions and loop/goal.md. Honor every stop condition." \
    || { echo "maker failed — stopping loop"; exit 1; }

  echo "=== iteration $i/$ITERATIONS — checker ==="
  kiro-cli chat --agent checker --no-interactive --trust-all-tools \
    "Check every feature with readyForCheck=true per your instructions. Verdicts and reasons only." \
    || { echo "checker failed — stopping loop"; exit 1; }

  ./init.sh || { echo "baseline red after iteration $i — stopping loop"; exit 1; }
done
echo "loop finished: $ITERATIONS iteration(s), baseline green."

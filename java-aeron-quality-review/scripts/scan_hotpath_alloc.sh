#!/usr/bin/env bash
# scan_hotpath_alloc.sh — flag allocation / GC-pressure patterns in Java code.
#
# On a low-latency message hot path, per-message allocation causes GC pauses and latency jitter.
# Hits are LEADS, not verdicts: allocation in a constructor, config loader, or startup path is
# fine — only allocation on the per-message path matters. After scanning, READ the flagged methods
# and decide which are actually on the hot path (e.g. onSessionMessage, onFragment, poll loops).
#
# Usage: scan_hotpath_alloc.sh <path> [more paths...]
# Requires: ripgrep (rg) if available, else falls back to grep -rn.

set -euo pipefail
PATHS=("${@:-.}")

if command -v rg >/dev/null 2>&1; then
  SEARCH() { rg --line-number --no-heading --color never -t java "$1" "${PATHS[@]}" 2>/dev/null || true; }
else
  SEARCH() { grep -rn --include='*.java' -E "$1" "${PATHS[@]}" 2>/dev/null || true; }
fi

section() {
  local title="$1"; shift
  local pattern="$1"; shift
  local why="$1"
  local hits; hits="$(SEARCH "$pattern")"
  if [[ -n "$hits" ]]; then
    echo "=== $title ==="
    echo "  why: $why"
    echo "$hits" | sed 's/^/  /'
    echo
  fi
}

echo "### Hot-path allocation scan ###"
echo "Reminder: only allocation on the per-message path is a defect. Triage by reading the methods."
echo

section "Object / collection allocation" \
  'new [A-Z][A-Za-z0-9_]*\s*\(|new [a-z]+\[\]|Arrays\.asList|List\.of|Map\.of|new ArrayList|new HashMap|new StringBuilder' \
  "allocates per call; on the hot path use pooled/reused objects and Agrona buffers"

section "Autoboxing risk" \
  '(Integer|Long|Double|Boolean|Float)\.valueOf|Optional\.(of|ofNullable|empty)|List<(Integer|Long|Double)>|Map<.*(Integer|Long)' \
  "boxing allocates wrapper objects; prefer primitives and Agrona primitive collections"

section "Lambda / stream allocation" \
  '\.stream\(\)|\.parallelStream\(\)|\.collect\(|\.map\(|\.filter\(|\.forEach\(' \
  "streams/lambdas can allocate iterators and capture state; use plain loops on the hot path"

section "String building / concatenation" \
  'String\.format|"\s*\+|\+\s*"|\.toString\(\)|\.split\(|\.replace\(|\.substring\(' \
  "string ops allocate; avoid on the hot path (esp. inside logging that may run per message)"

section "Logging that may allocate per message" \
  'log\.(debug|info|trace|warn|error)\(.*\+|String\.format.*log|logger\.' \
  "string-concatenated log args allocate even when the level is disabled; use guards or no logging on hot path"

echo "### end of scan ###"
echo "Next: open each flagged method and confirm whether it executes per message before reporting."

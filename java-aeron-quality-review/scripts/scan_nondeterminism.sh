#!/usr/bin/env bash
# scan_nondeterminism.sh — flag sources of non-deterministic behaviour in Java code.
#
# In Aeron Cluster, service logic must be a pure function of (ordered input, cluster time).
# These patterns can make replicas diverge or break log replay. Hits are LEADS, not verdicts:
# a hit in bootstrap/config/logging code is usually fine; a hit inside a message handler or
# state-mutating method is a Critical defect. See references/aeron-checklist.md.
#
# Usage: scan_nondeterminism.sh <path> [more paths...]
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

echo "### Non-determinism scan (Aeron Cluster) ###"
echo "Reminder: a hit only matters if it runs inside service logic (handlers / state mutation)."
echo

section "Wall-clock / system time" \
  'System\.(currentTimeMillis|nanoTime)|Instant\.now|LocalDate(Time)?\.now|new Date\(|Clock\.systemUTC|ZonedDateTime\.now' \
  "varies per run/node; use cluster-supplied timestamp"

section "Randomness" \
  'Math\.random|new Random\(|ThreadLocalRandom|SecureRandom|UUID\.randomUUID' \
  "non-reproducible; derive ids deterministically or log the seed"

section "Threads / async / executors" \
  'new Thread\(|Executors\.|ExecutorService|CompletableFuture\.(supplyAsync|runAsync)|\.thenApplyAsync|ForkJoinPool' \
  "service logic is single-threaded and must not spawn work or block"

section "Blocking / external I/O" \
  'Thread\.sleep|\.join\(\)|Files\.(read|write)|new (File|Socket|FileInputStream|FileOutputStream)|HttpClient|\.connect\(' \
  "blocking/I-O in the agent stalls the duty cycle and is non-deterministic"

section "Unordered collection iteration" \
  'new HashMap|new HashSet|Collectors\.toMap|Collectors\.toSet|\.keySet\(\)|\.entrySet\(\)|\.values\(\)' \
  "iteration order can differ across JVMs; only a bug if order affects emitted state"

section "Scheduled executors (use cluster timers instead)" \
  'ScheduledExecutorService|scheduleAtFixedRate|scheduleWithFixedDelay|Timer\(' \
  "timers must go through the cluster API to be deterministic"

echo "### end of scan ###"
echo "Triage each hit: is it in service logic, and can the value differ between nodes or on replay?"

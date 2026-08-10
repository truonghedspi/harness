#!/usr/bin/env bash
# check-determinism.sh — static scan for non-deterministic APIs in cluster-service code.
# Complements (never replaces) the determinism replay test. Rules: docs/03.
# Suppress a justified line with: // determinism-ok: <reason>
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_DIR="${SERVICE_SRC:-$ROOT/src/main/java}"

if [ ! -d "$SRC_DIR" ]; then
  echo "check-determinism: $SRC_DIR not present yet — scan inactive (fine before feat-003)."
  exit 0
fi

FORBIDDEN=(
  'System\.currentTimeMillis'
  'System\.nanoTime'
  'Instant\.now'
  'LocalDate\.now|LocalDateTime\.now|LocalTime\.now|ZonedDateTime\.now|OffsetDateTime\.now'
  'new Date\('
  'Clock\.system'
  'Math\.random'
  'new Random\(\)'
  'UUID\.randomUUID'
  'ThreadLocalRandom'
  'new Thread\('
  'Executors\.'
  'CompletableFuture\.(runAsync|supplyAsync)'
  'parallelStream\(\)'
  'ForkJoinPool'
  'DriverManager|javax\.sql|java\.sql\.Connection'
  'HttpClient|HttpURLConnection'
  'Files\.(write|read|newOutputStream|newInputStream)'
  'FileOutputStream|FileInputStream|RandomAccessFile'
)
WARN_ONLY=(
  '\bnew HashMap<'
  '\bnew HashSet<'
  '\b(double|float)\b'
)

fail=0
for pat in "${FORBIDDEN[@]}"; do
  hits=$(grep -RnE "$pat" "$SRC_DIR" --include='*.java' | grep -v 'determinism-ok' || true)
  if [ -n "$hits" ]; then
    echo "FORBIDDEN [$pat]:"
    echo "$hits" | sed 's/^/  /'
    fail=1
  fi
done

for pat in "${WARN_ONLY[@]}"; do
  hits=$(grep -RnE "$pat" "$SRC_DIR" --include='*.java' | grep -v 'determinism-ok' || true)
  if [ -n "$hits" ]; then
    echo "WARN (verify iteration order / money handling) [$pat]:"
    echo "$hits" | sed 's/^/  /'
  fi
done

if [ "$fail" -eq 0 ]; then
  echo "check-determinism: clean."
fi
exit "$fail"

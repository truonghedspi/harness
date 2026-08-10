#!/usr/bin/env bash
# init.sh — standard startup + baseline verification for the migration harness.
# Every session starts here. Exit 0 = safe to work. Exit 1 = repair the baseline first.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"
FAIL=0

step() { printf '\n== %s\n' "$1"; }
ok()   { printf '   OK: %s\n' "$1"; }
bad()  { printf '   FAIL: %s\n' "$1"; FAIL=1; }
warn() { printf '   WARN: %s\n' "$1"; }

step "Toolchain"
command -v node >/dev/null 2>&1 && ok "node $(node --version)" || bad "node not found (needed for coverage-check)"
command -v java >/dev/null 2>&1 && ok "java present" || warn "java not found — required from feat-003 onward"

step "Harness integrity"
for f in AGENTS.md feature_list.json progress.md docs/00-migration-playbook.md; do
  [ -f "$f" ] && ok "$f" || bad "missing $f"
done
node -e "JSON.parse(require('fs').readFileSync('feature_list.json','utf8'))" 2>/dev/null \
  && ok "feature_list.json parses" || bad "feature_list.json is not valid JSON"

step "Coverage ledger"
if [ -f inventory/inventory.json ]; then
  node tools/coverage-check.mjs || bad "coverage-check reported violations"
else
  warn "inventory/inventory.json not yet extracted (feat-001) — coverage gate inactive"
fi

step "Determinism scan"
tools/check-determinism.sh || bad "forbidden non-deterministic API usage in service code"

step "Build & tests"
if [ -x ./gradlew ]; then
  if [ "${SKIP_GRADLE:-0}" = "1" ]; then
    warn "SKIP_GRADLE=1 — gradle check skipped (do not use when claiming done)"
  else
    ./gradlew -q check || bad "gradle check failed"
  fi
else
  warn "no gradle wrapper yet — build gate inactive until feat-003"
fi

step "Feature summary"
node -e '
  const fl = JSON.parse(require("fs").readFileSync("feature_list.json","utf8"));
  const by = {}; for (const f of fl.features) by[f.status] = (by[f.status]||0)+1;
  console.log("   " + JSON.stringify(by));
  const ip = fl.features.filter(f => f.status === "in-progress");
  if (ip.length > 1) { console.log("   FAIL: more than one feature in-progress: " + ip.map(f=>f.id).join(", ")); process.exit(1); }
  if (ip.length === 1) console.log("   active: " + ip[0].id + " — " + ip[0].name);
' || FAIL=1

printf '\n'
if [ "$FAIL" -eq 0 ]; then
  echo "BASELINE GREEN — safe to pick a feature."
  node tools/trace.mjs harness baseline "" "green" 2>/dev/null || true
else
  echo "BASELINE RED — repair before feature work."
  node tools/trace.mjs harness baseline "" "red" 2>/dev/null || true
fi
exit "$FAIL"

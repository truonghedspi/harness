#!/usr/bin/env bash
# demo.sh — exercises every feature of the harness-loop lifecycle (create -> verify -> improve)
# against a disposable target, so the whole thing can be re-proven with one command instead of
# taken on faith. Every step below was first run by hand while building this skill; this script
# is that session, replayed.
#
# Usage: harness-loop/scripts/demo.sh [WORKDIR]   (default: a fresh mktemp -d)
# Exit 0 iff every demonstrated behavior matched what it claims to prove.
set -uo pipefail

SCRIPTS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK="${1:-$(mktemp -d)}"
T="$WORK/demo-target"
FAIL=0

# Isolate the issue log: this run manufactures synthetic defects (an injected bug, a mechanism
# test for regression detection) that must never land in the real harness-issues.jsonl.
export HARNESS_ISSUE_LOG="$WORK/demo-issues.jsonl"
echo "demo issue log (isolated from production): $HARNESS_ISSUE_LOG"

step() { echo ""; echo "── [$1] $2 ──"; }
expect() { # expect DESCRIPTION CONDITION_ALREADY_EVALUATED(0/1)
  if [ "$2" = "0" ]; then echo "  OK  $1"; else echo "  FAIL  $1"; FAIL=1; fi
}
json() { node -e "try{const r=require('$1');process.stdout.write(String($2))}catch(e){process.stdout.write('ERR: '+e.message)}"; }

rm -rf "$T" && mkdir -p "$T" && (cd "$T" && git init -q .)

step 1 "create: scaffold into an empty target"
OUT="$(node "$SCRIPTS/setup-harness-loop.mjs" --target "$T" --name "Demo" --purpose "demo target" 2>&1)"
echo "$OUT" | tail -5
echo "$OUT" | grep -q "check-coverage.mjs" ; expect "wrote check-coverage.mjs and the rest of the tree" $?

step 2 "no silent overwrite: re-run without --force"
OUT="$(node "$SCRIPTS/setup-harness-loop.mjs" --target "$T" 2>&1)"
echo "$OUT" | grep -q "Written (0)"; expect "second run wrote nothing" $?
echo "$OUT" | grep -qE "Skipped \([0-9]+,"; expect "second run reports everything as skipped" $?

step 3 "static coverage: check-coverage.mjs catches structural gaps"
(cd "$T" && node check-coverage.mjs >/tmp/demo-cov.$$ 2>&1); COV_RC=$?
tail -3 /tmp/demo-cov.$$; rm -f /tmp/demo-cov.$$
[ "$COV_RC" != "0" ]; expect "fresh scaffold is NOT 13/13 (placeholders remain)" $?

step 4 "dynamic verify: verify-harness.mjs finds what check-coverage.mjs cannot"
node "$SCRIPTS/verify-harness.mjs" --target "$T" >/tmp/demo-verify.$$ 2>&1; VERIFY_RC=$?
cat /tmp/demo-verify.$$; rm -f /tmp/demo-verify.$$
[ "$VERIFY_RC" != "0" ]; expect "verify is red on a placeholder scaffold" $?
[ "$(json "$T/trace/verify-report.json" "r.counts.projectLayer")" -gt 0 ]; expect "placeholders are classified layer=project" $?

step 5 "inject a known harness-layer defect and catch it (pre-fix: bare mvn, no wrapper preference)"
cp "$T/init.sh" "$T/init.sh.bak"
echo '<project><modelVersion>4.0.0</modelVersion></project>' > "$T/pom.xml"
printf '#!/usr/bin/env bash\necho "real mvnw would run here"\n' > "$T/mvnw"; chmod +x "$T/mvnw"
python3 - "$T/init.sh" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read()
s = s.replace(
'''  echo "=== Maven verification ==="
  if [ -x ./mvnw ]; then ./mvnw -q verify; else mvn -q verify; fi''',
'''  echo "=== Maven verification ==="; mvn -q verify''')
open(p, "w").write(s)
PY
rm -rf "$T/trace"
node "$SCRIPTS/verify-harness.mjs" --target "$T" --quiet
node -e "
const r = require('$T/trace/verify-report.json');
const f = r.findings.find(x => x.gate === 'baseline' && x.id === 'init-red');
process.exit(f && f.layer === 'harness' ? 0 : 1);
"; expect "bare-mvn-when-wrapper-exists is caught and classified layer=harness" $?

step 6 "record it in the issue log"
node "$SCRIPTS/harness-issue.mjs" import --report "$T/trace/verify-report.json"
node "$SCRIPTS/harness-issue.mjs" list --status open --json | grep -q "not on PATH"
expect "HI-* opened for the injected defect" $?

step 7 "rank it"
node "$SCRIPTS/improve-harness.mjs" --top 5 >/tmp/demo-rank.$$ 2>&1
grep -q "templates/tree/init.sh" /tmp/demo-rank.$$; expect "ranking routes to templates/tree/init.sh" $?
tail -6 /tmp/demo-rank.$$; rm -f /tmp/demo-rank.$$

step 8 "generate an agent-ready prompt"
PROMPT="$(node "$SCRIPTS/improve-harness.mjs" --prompt)"
echo "$PROMPT" | grep -q "never just the one target repo"; expect "prompt states the template-not-target rule" $?

step 9 "apply the fix and close the loop: --reverify --auto-resolve"
mv "$T/init.sh.bak" "$T/init.sh"
node "$SCRIPTS/improve-harness.mjs" --reverify --auto-resolve --target "$T" >/tmp/demo-rv.$$ 2>&1
cat /tmp/demo-rv.$$
grep -q "no longer reproduce" /tmp/demo-rv.$$; RV1=$?; rm -f /tmp/demo-rv.$$
[ "$RV1" = "0" ]; expect "the fixed defect is confirmed resolved by a real re-run, not a claim" $?

step 10 "regression detection: re-open the same signature and confirm it flips back"
export LAST_ID
LAST_ID="$(node "$SCRIPTS/harness-issue.mjs" list --status resolved --json | node -e '
let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{const a=JSON.parse(d);console.log(a[a.length-1].id)})')"
echo "  resolved issue under test: $LAST_ID"
node "$SCRIPTS/harness-issue.mjs" add --gate baseline --id init-red --layer harness --symptom "mechanism test: re-firing the same signature" >/dev/null
node "$SCRIPTS/harness-issue.mjs" list --status all --json | node -e '
let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{
  const a = JSON.parse(d); const it = a.find(x => x.id === process.env.LAST_ID);
  process.exit(it && it.regressed ? 0 : 1);
})'; expect "a resolved issue seen again is flagged regressed, not silently re-opened" $?
node "$SCRIPTS/harness-issue.mjs" resolve --id "$LAST_ID" --fix "mechanism test only; underlying fix untouched" >/dev/null

step 11 "evidence replay: a feature claiming done with a failing verification is caught"
node -e "
const fs = require('fs');
const p = '$T/feature_list.json';
const fl = JSON.parse(fs.readFileSync(p, 'utf8'));
fl.features[0].status = 'done';
fl.features[0].verification = 'exit 1';
fl.features[0].evidence = 'demo: intentionally false claim';
fs.writeFileSync(p, JSON.stringify(fl, null, 2));
"
node "$SCRIPTS/verify-harness.mjs" --target "$T" --run-features --skip-baseline --json > /tmp/demo-ef.$$ 2>&1
grep -q "evidence-not-reproducible" /tmp/demo-ef.$$; expect "a false done-claim is caught on replay, not trusted" $?
rm -f /tmp/demo-ef.$$

step 12 "attempts budget: a feature stuck past maxAttempts without status=blocked is caught"
T2="$WORK/demo-target-2"
rm -rf "$T2" && mkdir -p "$T2" && (cd "$T2" && git init -q .)
node "$SCRIPTS/setup-harness-loop.mjs" --target "$T2" --name "Demo2" --purpose "second demo target" >/dev/null
echo '{ "name": "demo-target-2", "private": true }' > "$T2/package.json"
# Clear the two doc placeholders up front so later steps in this block are isolated to the
# feature_list.json behavior under test, not re-tripping the placeholder gate.
python3 - "$T2/loop/goal.md" "$T2/docs/constraints.md" <<'PY'
import sys
goal_path, constraints_path = sys.argv[1], sys.argv[2]
g = open(goal_path).read()
g = g.replace("> REPLACE with the concrete end state, e.g. \"All features `done`, `./init.sh` green, and\n> `node check-coverage.mjs` reports 13/13.\"", "Demo target — all features done.")
g = g.replace("- [Project-specific approvals]", "- none for this demo target")
open(goal_path, "w").write(g)
c = open(constraints_path).read()
c = c.replace("- [Project-specific MUST rules — e.g. respect module dependency direction, use fixed-point money]", "- none for this demo target")
c = c.replace("- [Project-specific MUST NOT rules — e.g. no network calls in unit tests, no writes to prod]", "- none for this demo target")
open(constraints_path, "w").write(c)
PY
node -e "
const fs = require('fs');
const p = '$T2/feature_list.json';
const fl = JSON.parse(fs.readFileSync(p, 'utf8'));
fl.features = fl.features.filter(f => f.id !== 'feat-003');
fl.features[0].status = 'in-progress'; fl.features[0].readyForCheck = true; fl.features[0].evidence = 'ran ./init.sh';
fl.features[1].name = 'promotable feature';
fl.features[1].behavior = 'a trivially true behavior for the demo';
fl.features[1].verification = 'exit 0';
fl.features[1].falsifier = 'an implementation that exits non-zero';
fl.features[1].status = 'in-progress';
fl.features[1].attempts = 3;
fl.features[1].maxAttempts = 3;
fs.writeFileSync(p, JSON.stringify(fl, null, 2));
"
node "$SCRIPTS/verify-harness.mjs" --target "$T2" --skip-baseline --quiet
grep -q '"id": "over-budget:feat-002"' "$T2/trace/verify-report.json"
expect "attempts>=maxAttempts with status!=blocked is flagged" $?

step 13 "blocked without a reason is rejected; the same blocked WITH a reason is not"
node -e "
const fs = require('fs');
const p = '$T2/feature_list.json';
const fl = JSON.parse(fs.readFileSync(p, 'utf8'));
fl.features[1].status = 'blocked'; fl.features[1].checkerNotes = '';
fs.writeFileSync(p, JSON.stringify(fl, null, 2));
"
node "$SCRIPTS/verify-harness.mjs" --target "$T2" --skip-baseline --quiet
grep -q '"id": "blocked-unjustified:feat-002"' "$T2/trace/verify-report.json"
expect "blocked with empty checkerNotes and no DECISIONS.md mention is rejected" $?
node -e "
const fs = require('fs');
const p = '$T2/feature_list.json';
const fl = JSON.parse(fs.readFileSync(p, 'utf8'));
fl.features[1].checkerNotes = 'demo: a concrete, real reason this is blocked';
fs.writeFileSync(p, JSON.stringify(fl, null, 2));
"
node "$SCRIPTS/verify-harness.mjs" --target "$T2" --skip-baseline --quiet
grep -q 'blocked-unjustified' "$T2/trace/verify-report.json"; BJ=$?
[ "$BJ" != "0" ]; expect "the same blocked feature with a real reason clears the check" $?

step 14 "--promote mechanically flips readyForCheck features to done when evidence reproduces"
node -e "
const fs = require('fs');
const p = '$T2/feature_list.json';
const fl = JSON.parse(fs.readFileSync(p, 'utf8'));
fl.features[1].status = 'in-progress'; fl.features[1].readyForCheck = true; fl.features[1].checkerNotes = '';
fl.features[1].attempts = 1; // clear the over-budget state from step 12 — a different check
fs.writeFileSync(p, JSON.stringify(fl, null, 2));
"
node "$SCRIPTS/verify-harness.mjs" --target "$T2" --skip-baseline --run-features --promote --quiet
node -e "
const fl = require('$T2/feature_list.json');
const f2 = fl.features.find(f => f.id === 'feat-002');
process.exit(f2.status === 'done' && f2.checkerNotes.includes('mechanically promoted') ? 0 : 1);
"; expect "feature with reproducing evidence is promoted to done with an audit trail" $?

step 15 "--promote never promotes a feature whose verification just failed the replay"
node -e "
const fs = require('fs');
const p = '$T2/feature_list.json';
const fl = JSON.parse(fs.readFileSync(p, 'utf8'));
fl.features[0].status = 'in-progress'; fl.features[0].readyForCheck = true; fl.features[0].verification = 'exit 1';
fs.writeFileSync(p, JSON.stringify(fl, null, 2));
"
node "$SCRIPTS/verify-harness.mjs" --target "$T2" --skip-baseline --run-features --promote --quiet
node -e "
const fl = require('$T2/feature_list.json');
process.exit(fl.features.find(f => f.id === 'feat-001').status === 'done' ? 1 : 0);
"; expect "a feature whose evidence stops reproducing is never promoted, --promote or not" $?

step 16 "--promote never overrides a human blocked decision, even if evidence reproduces"
node -e "
const fs = require('fs');
const p = '$T2/feature_list.json';
const fl = JSON.parse(fs.readFileSync(p, 'utf8'));
fl.features[0].status = 'blocked'; fl.features[0].readyForCheck = true; fl.features[0].verification = 'exit 0';
fl.features[0].checkerNotes = 'demo: blocked despite passing evidence — narrowed test, requirement gap needs a human design decision';
fs.writeFileSync(p, JSON.stringify(fl, null, 2));
"
node "$SCRIPTS/verify-harness.mjs" --target "$T2" --skip-baseline --run-features --promote --quiet
node -e "
const fl = require('$T2/feature_list.json');
process.exit(fl.features.find(f => f.id === 'feat-001').status === 'blocked' ? 0 : 1);
"; expect "a blocked feature is never mechanically promoted, even when its (narrowed) verification passes" $?

step 17 "scope-smell: an oversized/compound behavior sentence is flagged (warn, not blocker)"
node -e "
const fs = require('fs');
const p = '$T2/feature_list.json';
const fl = JSON.parse(fs.readFileSync(p, 'utf8'));
fl.features[0].behavior = 'Build the ingest endpoint and validate the payload and persist it to the store and emit a metric and then notify downstream and then write an audit log entry';
fs.writeFileSync(p, JSON.stringify(fl, null, 2));
"
node "$SCRIPTS/verify-harness.mjs" --target "$T2" --skip-baseline --quiet
grep -q '"id": "scope-smell:feat-001"' "$T2/trace/verify-report.json"
expect "a compound behavior sentence (5 and/then joiners) is flagged scope-smell" $?
node -e "
const r = require('$T2/trace/verify-report.json');
const f = r.findings.find(x => x.id === 'scope-smell:feat-001');
process.exit(f && f.severity === 'warn' ? 0 : 1);
"; expect "scope-smell is severity=warn, not a blocker" $?
node -e "
const fs = require('fs');
const p = '$T2/feature_list.json';
const fl = JSON.parse(fs.readFileSync(p, 'utf8'));
fl.features[0].behavior = 'Build the ingest endpoint that validates and persists a payload';
fs.writeFileSync(p, JSON.stringify(fl, null, 2));
"
node "$SCRIPTS/verify-harness.mjs" --target "$T2" --skip-baseline --quiet
grep -q 'scope-smell' "$T2/trace/verify-report.json"; SS=$?
[ "$SS" != "0" ]; expect "a single-clause behavior sentence clears the check" $?

step 18 "memory gate: a missing memory/<agent>/MEMORY.md referenced by an agent is flagged"
mv "$T2/memory/maker/MEMORY.md" "$T2/memory/maker/MEMORY.md.bak"
node "$SCRIPTS/verify-harness.mjs" --target "$T2" --skip-baseline --quiet
grep -q '"id": "memory-missing:maker"' "$T2/trace/verify-report.json"
expect "a referenced-but-missing memory index is caught" $?
node -e "
const r = require('$T2/trace/verify-report.json');
const f = r.findings.find(x => x.id === 'memory-missing:maker');
process.exit(f && f.severity === 'warn' && f.layer === 'project' ? 0 : 1);
"; expect "memory findings are severity=warn, layer=project" $?
mv "$T2/memory/maker/MEMORY.md.bak" "$T2/memory/maker/MEMORY.md"
node "$SCRIPTS/verify-harness.mjs" --target "$T2" --skip-baseline --quiet
grep -q 'memory-missing' "$T2/trace/verify-report.json"; MM=$?
[ "$MM" != "0" ]; expect "restoring the file clears the finding" $?

step 19 "design gate: uncited claim + blocked-on-unverified-assumption are flagged (warn)"
mkdir -p "$T2/docs/design"
cat > "$T2/docs/design/demo.md" <<'EOD'
# Demo design
| Claim | Evidence |
|---|---|
| Cited fact | src/Foo.java:42 |
| Uncited fact | recall |
EOD
cat > "$T2/docs/assumptions.md" <<'EOD'
# Assumptions
| id | Assumption | Status | If false | Depended on by |
|---|---|---|---|---|
| A-001 | Endpoint never moves | needs-human | premise returns | feat-001 |
EOD
node -e "
const fs=require('fs'); const p='$T2/feature_list.json';
const fl=JSON.parse(fs.readFileSync(p,'utf8'));
fl.features[0].status='blocked'; fl.features[0].checkerNotes='demo: blocked pending a design answer';
fs.writeFileSync(p, JSON.stringify(fl,null,2));
"
node "$SCRIPTS/verify-harness.mjs" --target "$T2" --skip-baseline --quiet
grep -q "design-claim-uncited" "$T2/trace/verify-report.json"
expect "an uncited design claim is flagged" $?
grep -q '"id": "design-assumption-unverified:feat-001"' "$T2/trace/verify-report.json"
expect "a blocked feature resting on an unverified assumption is flagged" $?
node -e "
const r=require('$T2/trace/verify-report.json');
const d=r.findings.filter(f=>f.gate==='design');
process.exit(d.length && d.every(f=>f.severity==='warn') ? 0 : 1);
"; expect "design findings are all severity=warn (never block a loop)" $?
node -e "
const r=require('$T2/trace/verify-report.json');
const f=r.findings.find(x=>x.id && x.id.startsWith('design-claim-uncited'));
process.exit(f && !/Foo\.java/.test(f.evidence||'') ? 0 : 1);
"; expect "a properly cited claim is NOT flagged" $?
rm -rf "$T2/docs/design" "$T2/docs/assumptions.md"

step 20 "docs gate: an over-budget document is flagged, with the right split advice per kind"
node -e "
const fs=require('fs');
fs.writeFileSync('$T2/docs/huge-topic.md', '# Huge topic\n' + 'filler line\n'.repeat(320));
fs.writeFileSync('$T2/DECISIONS.md', fs.readFileSync('$T2/DECISIONS.md','utf8') + '\nlog entry\n'.repeat(320));
"
node "$SCRIPTS/verify-harness.mjs" --target "$T2" --skip-baseline --quiet
grep -q '"id": "doc-over-budget:docs/huge-topic.md"' "$T2/trace/verify-report.json"
expect "an over-budget topic doc is flagged" $?
node -e "
const r=require('$T2/trace/verify-report.json');
const topic=r.findings.find(f=>f.id==='doc-over-budget:docs/huge-topic.md');
const log=r.findings.find(f=>f.id==='doc-over-budget:DECISIONS.md');
process.exit(topic && log && /split at section boundaries/.test(topic.remedy) && /rotate closed periods/.test(log.remedy) ? 0 : 1);
"; expect "a topic doc gets split advice, an append-only log gets rotate advice" $?
# The template always scaffolds docs/INDEX.md, so this check only fires if a project removed it —
# exercise that path explicitly rather than asserting on a condition setup makes impossible.
mv "$T2/docs/INDEX.md" "$T2/docs/INDEX.md.bak"
node "$SCRIPTS/verify-harness.mjs" --target "$T2" --skip-baseline --quiet
grep -q '"id": "doc-index-missing"' "$T2/trace/verify-report.json"
expect "a removed docs/INDEX.md is flagged once documents overflow" $?
mv "$T2/docs/INDEX.md.bak" "$T2/docs/INDEX.md"
node "$SCRIPTS/verify-harness.mjs" --target "$T2" --skip-baseline --quiet
grep -q '"id": "doc-index-missing"' "$T2/trace/verify-report.json"; IDX=$?
[ "$IDX" != "0" ]; expect "restoring the index clears that finding" $?
node -e "
const r=require('$T2/trace/verify-report.json');
process.exit(r.findings.filter(f=>f.gate==='docs').every(f=>f.severity==='warn') ? 0 : 1);
"; expect "docs findings are all severity=warn" $?
rm -f "$T2/docs/huge-topic.md"

step 21 "cross-cutting audit: unowned vs open-decision vs owned"
mkdir -p "$T2/docs"
cat > "$T2/docs/constraints.md.bak" <<'EOD'
placeholder
EOD
node "$SCRIPTS/cross-cutting-audit.mjs" --target "$T2" --json > /tmp/demo-cc.$$ 2>&1
node -e "
const r=JSON.parse(require('fs').readFileSync('/tmp/demo-cc.$$','utf8'));
process.exit(Array.isArray(r.results) && typeof r.scanned === 'number' ? 0 : 1);
"; expect "audit emits a parseable report over the target's domain artifacts" $?
cat > "$T2/docs/cross-cutting.md" <<'EOD'
| id | Concern | Chosen mechanism | Owner / date | Enforced by | Inherited by |
|---|---|---|---|---|---|
| X-001 | retry & backoff policy | not yet decided | — | — | feat-002 |
EOD
node "$SCRIPTS/cross-cutting-audit.mjs" --target "$T2" --json > /tmp/demo-cc2.$$ 2>&1
node -e "
const r=JSON.parse(require('fs').readFileSync('/tmp/demo-cc2.$$','utf8'));
const retry=r.results.find(x=>x.id==='retry');
process.exit(retry && retry.flags.includes('open-decision') ? 0 : 1);
"; expect "a stub register row reads as open-decision, NOT as owned" $?
cat > "$T2/docs/cross-cutting.md" <<'EOD'
| id | Concern | Chosen mechanism | Owner / date | Enforced by | Inherited by |
|---|---|---|---|---|---|
| X-001 | retry & backoff policy | exponential capped 30s | Alice, 2026-08-09 | docs/constraints.md MUST | feat-002 |
EOD
node "$SCRIPTS/cross-cutting-audit.mjs" --target "$T2" --json > /tmp/demo-cc3.$$ 2>&1
node -e "
const r=JSON.parse(require('fs').readFileSync('/tmp/demo-cc3.$$','utf8'));
const retry=r.results.find(x=>x.id==='retry');
process.exit(retry && retry.flags.length===0 ? 0 : 1);
"; expect "a complete row closes the concern (no flag)" $?
rm -f /tmp/demo-cc.$$ /tmp/demo-cc2.$$ /tmp/demo-cc3.$$ "$T2/docs/constraints.md.bak" "$T2/docs/cross-cutting.md"

step 22 "always-remember rules: an agent that can write must load the rulebook"
node -e "
const fs=require('fs');const p='$T2/.kiro/agents/maker.json';
const j=JSON.parse(fs.readFileSync(p,'utf8'));
fs.writeFileSync(p+'.bak', JSON.stringify(j,null,2));
j.resources=j.resources.filter(r=>!r.includes('constraints.md'));
fs.writeFileSync(p, JSON.stringify(j,null,2));
"
node "$SCRIPTS/verify-harness.mjs" --target "$T2" --skip-baseline --quiet
node -e "
const r=require('$T2/trace/verify-report.json');
const f=r.findings.find(x=>x.id==='agent-missing-constraints:maker');
process.exit(f && f.layer==='harness' && f.severity==='warn' ? 0 : 1);
"; expect "a writing agent with no docs/constraints.md is caught, classified layer=harness" $?
mv "$T2/.kiro/agents/maker.json.bak" "$T2/.kiro/agents/maker.json"
node "$SCRIPTS/verify-harness.mjs" --target "$T2" --skip-baseline --quiet
grep -q "agent-missing-constraints" "$T2/trace/verify-report.json"; AMC=$?
[ "$AMC" != "0" ]; expect "restoring the resource clears it — and the scaffold ships clean" $?
# An agent nobody can reach is an agent nobody runs — the defect that left ten nodes with three
# executable incoming edges (references/graph.md).
grep -q '"id": "agent-unrouted"' "$T2/trace/verify-report.json"; AUR=$?
[ "$AUR" != "0" ]; expect "the scaffold's router names every agent it ships — no unrouted node" $?
cp "$T2/.kiro/agents/checker.json" "$T2/.kiro/agents/ghost.json"
node -e "
const fs=require('fs'); const p='$T2/.kiro/agents/ghost.json';
const j=JSON.parse(fs.readFileSync(p,'utf8')); j.name='ghost-agent';
fs.writeFileSync(p, JSON.stringify(j,null,2));
"
node "$SCRIPTS/verify-harness.mjs" --target "$T2" --skip-baseline --quiet
node -e "
const r=require('$T2/trace/verify-report.json');
const f=r.findings.find(x=>x.id==='agent-unrouted');
process.exit(f && f.evidence.includes('ghost-agent') ? 0 : 1);
"; expect "an agent no router and no routing rule names is flagged" $?
rm -f "$T2/.kiro/agents/ghost.json"

step 23 "config/prompt agreement: an agent told to write a file it cannot write is caught"
node -e "
const fs=require('fs');const p='$T2/.kiro/agents/checker.json';
const j=JSON.parse(fs.readFileSync(p,'utf8'));
fs.writeFileSync(p+'.bak', JSON.stringify(j,null,2));
j.toolsSettings.write.allowedPaths=j.toolsSettings.write.allowedPaths.filter(x=>x!=='feature_list.json');
fs.writeFileSync(p, JSON.stringify(j,null,2));
"
node "$SCRIPTS/verify-harness.mjs" --target "$T2" --skip-baseline --quiet
node -e "
const r=require('$T2/trace/verify-report.json');
const f=r.findings.find(x=>x.id.startsWith('agent-cannot-write-instructed:checker'));
process.exit(f && f.layer==='harness' ? 0 : 1);
"; expect "prompt says write feature_list.json, allowedPaths says no → caught, layer=harness" $?
mv "$T2/.kiro/agents/checker.json.bak" "$T2/.kiro/agents/checker.json"
node "$SCRIPTS/verify-harness.mjs" --target "$T2" --skip-baseline --quiet
grep -q "agent-cannot-write-instructed" "$T2/trace/verify-report.json"; ACW=$?
[ "$ACW" != "0" ]; expect "the shipped scaffold has no prompt/permission disagreement" $?

step 24 "human attention: an escalation with no exploration is caught, one with evidence is not"
node -e "
const fs=require('fs');const p='$T2/feature_list.json';
const fl=JSON.parse(fs.readFileSync(p,'utf8'));
fl.features[0].status='blocked'; fl.features[0].checkerNotes='This seems hard, probably an environment problem.';
fl.features[1].status='blocked'; fl.features[1].checkerNotes='Ran \`./mvnw -q verify\` exit 1; spike reproduces with vanilla upstream. Needs a product call on scope.';
fs.writeFileSync(p, JSON.stringify(fl,null,2));
"
node "$SCRIPTS/verify-harness.mjs" --target "$T2" --skip-baseline --quiet
grep -q '"id": "escalation-without-evidence:feat-001"' "$T2/trace/verify-report.json"
expect "a blocked feature with no exploration at all is flagged" $?
grep -q '"id": "escalation-without-evidence:feat-002"' "$T2/trace/verify-report.json"; EWE=$?
[ "$EWE" != "0" ]; expect "a blocked feature citing a command + spike is NOT flagged" $?
node -e "
const r=require('$T2/trace/verify-report.json');
const f=r.findings.find(x=>x.id==='escalation-without-evidence:feat-001');
process.exit(f && f.severity==='warn' ? 0 : 1);
"; expect "it is warn — under-asking must never be discouraged into guessing" $?
node -e "
const fs=require('fs');const p='$T2/feature_list.json';
const fl=JSON.parse(fs.readFileSync(p,'utf8'));
fl.features[0].status='in-progress'; fl.features[0].checkerNotes='';
fl.features[1].status='in-progress'; fl.features[1].checkerNotes='';
fs.writeFileSync(p, JSON.stringify(fl,null,2));
"

step 25 "a justification rotated into an archive still counts as justified"
mkdir -p "$T2/DECISIONS"
node -e "
const fs=require('fs');const p='$T2/feature_list.json';
const fl=JSON.parse(fs.readFileSync(p,'utf8'));
fl.features[0].status='blocked'; fl.features[0].checkerNotes='';
fs.writeFileSync(p, JSON.stringify(fl,null,2));
fs.writeFileSync('$T2/DECISIONS/2026-01.md', '# archived\n\n## 2026-01-01 — why feat-001 is blocked\nRan \`./init.sh\` exit 1; awaiting a product decision.\n');
fs.writeFileSync('$T2/DECISIONS/INDEX.md', '# index\n| 2026-01-01 | feat-001 blocked | DECISIONS/2026-01.md |\n');
"
node "$SCRIPTS/verify-harness.mjs" --target "$T2" --skip-baseline --quiet
grep -q '"id": "blocked-unjustified:feat-001"' "$T2/trace/verify-report.json"; BU=$?
[ "$BU" != "0" ]; expect "rotation into DECISIONS/ does not make a justified block look unjustified" $?
rm -rf "$T2/DECISIONS"
node -e "
const fs=require('fs');const p='$T2/feature_list.json';
const fl=JSON.parse(fs.readFileSync(p,'utf8'));
fl.features[0].status='in-progress'; fl.features[0].checkerNotes='';
fs.writeFileSync(p, JSON.stringify(fl,null,2));
"

step 26 "instruction load: rule count is budgeted, and gating a rule buys budget back"
node -e "
const fs=require('fs'); const p='$T2/docs/constraints.md';
fs.writeFileSync(p+'.bak', fs.readFileSync(p));
let extra='';
for (let i=0;i<30;i++) extra += '- MUST do invented thing number ' + i + '.\n';
fs.appendFileSync(p, '\n' + extra);
"
node "$SCRIPTS/verify-harness.mjs" --target "$T2" --skip-baseline --quiet
grep -q '"id": "instruction-load-over-budget"' "$T2/trace/verify-report.json"
expect "a constraints.md past the rule budget is flagged" $?
node -e "
const fs=require('fs'); const p='$T2/docs/constraints.md';
let s=fs.readFileSync(p,'utf8');
s=s.replace(/- MUST do invented thing number (\d+)\./g, '- MUST do invented thing number \$1 — enforced by \`init.sh\`.');
fs.writeFileSync(p,s);
"
node "$SCRIPTS/verify-harness.mjs" --target "$T2" --skip-baseline --quiet
grep -q '"id": "instruction-load-over-budget"' "$T2/trace/verify-report.json"; ILB=$?
[ "$ILB" != "0" ]; expect "the same rules, once mechanically enforced, stop counting against the budget" $?
mv "$T2/docs/constraints.md.bak" "$T2/docs/constraints.md"

step 27 "unenforced prohibitions: flagged by ratio, quiet once the gateable ones are promoted"
node -e "
const fs=require('fs'); const p='$T2/docs/constraints.md';
fs.writeFileSync(p+'.bak', fs.readFileSync(p));
fs.appendFileSync(p, '\n- MUST NOT alpha.\n- MUST NOT beta.\n- MUST NOT gamma.\n- MUST NOT delta.\n- MUST NOT epsilon.\n');
"
node "$SCRIPTS/verify-harness.mjs" --target "$T2" --skip-baseline --quiet
grep -q '"id": "prohibitions-mostly-unenforced"' "$T2/trace/verify-report.json"
expect "prohibitions with nothing enforcing them are flagged" $?
node -e "
const fs=require('fs'); const p='$T2/docs/constraints.md';
let s=fs.readFileSync(p,'utf8');
s=s.replace(/- MUST NOT (alpha|beta|gamma|delta)\./g, '- MUST NOT \$1 — enforced by \`init.sh\`.');
fs.writeFileSync(p,s);
"
node "$SCRIPTS/verify-harness.mjs" --target "$T2" --skip-baseline --quiet
grep -q '"id": "prohibitions-mostly-unenforced"' "$T2/trace/verify-report.json"; PMU=$?
[ "$PMU" != "0" ]; expect "promoting the gateable ones quiets it — semantic ones may honestly remain" $?
mv "$T2/docs/constraints.md.bak" "$T2/docs/constraints.md"

step 28 "context budget: the feature digest keeps the biggest file out of every agent's context"
node "$SCRIPTS/feature-digest.mjs" --target "$T2" >/dev/null
node -e "
const fs=require('fs');
const full=fs.readFileSync('$T2/feature_list.json','utf8').split('\n').length;
const dig=fs.readFileSync('$T2/feature_list.digest.md','utf8').split('\n').length;
process.exit(dig < full ? 0 : 1);
"; expect "the digest is smaller than the source it indexes" $?
node -e "
const fs=require('fs');
const j=JSON.parse(fs.readFileSync('$T2/.kiro/agents/maker.json','utf8'));
const r=j.resources.join(' ');
process.exit(r.includes('feature_list.digest.md') && !r.includes('/feature_list.json') ? 0 : 1);
"; expect "maker auto-loads the digest, not the full list" $?
node -e "
const fs=require('fs');
const j=JSON.parse(fs.readFileSync('$T2/.kiro/agents/feature-planner.json','utf8'));
process.exit(j.resources.some(r=>r.endsWith('feature_list.json')) ? 0 : 1);
"; expect "feature-planner keeps the full list — it is the agent that rewrites it" $?
node -e "const fs=require('fs');fs.appendFileSync('$T2/feature_list.digest.md','\n- drifted\n')"
node "$SCRIPTS/verify-harness.mjs" --target "$T2" --skip-baseline --quiet
grep -q '"id": "feature-digest-stale"' "$T2/trace/verify-report.json"
expect "a stale digest is caught — agents read it, so a stale one misinforms all of them" $?
node "$SCRIPTS/feature-digest.mjs" --target "$T2" >/dev/null
node "$SCRIPTS/verify-harness.mjs" --target "$T2" --skip-baseline --quiet
grep -q '"id": "feature-digest-stale"' "$T2/trace/verify-report.json"; FDS=$?
[ "$FDS" != "0" ]; expect "regenerating clears it" $?

step 29 "review digest: a large diff becomes a ranked, bounded list of decisions to judge"
(cd "$T2" && git add -A >/dev/null 2>&1 && git -c user.email=d@d -c user.name=d commit -qm "demo baseline" >/dev/null 2>&1) || true
node -e "
const fs=require('fs'); const p='$T2/feature_list.json';
const fl=JSON.parse(fs.readFileSync(p,'utf8'));
fl.features[0].status='done'; fl.features[0].checkerNotes='[mechanically promoted by verify-harness --promote on 2026-01-01: verification re-run, exited 0]';
fl.features[1].status='done'; fl.features[1].attempts=3; fl.features[1].maxAttempts=3; fl.features[1].checkerNotes='REJECT once, then fixed.';
fs.writeFileSync(p, JSON.stringify(fl,null,2));
fs.mkdirSync('$T2/docs',{recursive:true});
fs.writeFileSync('$T2/docs/cross-cutting.md','| id | Concern | Chosen mechanism | Owner | Enforced by | Inherited |\n|---|---|---|---|---|---|\n| X-009 | retry policy | not yet decided | — | — | feat-002 |\n');
"
(cd "$T2" && git add -A >/dev/null 2>&1 && git -c user.email=d@d -c user.name=d commit -qm "demo work" >/dev/null 2>&1) || true
node "$SCRIPTS/review-digest.mjs" --target "$T2" --json > /tmp/demo-rd.$$ 2>&1
node -e "
const r=JSON.parse(require('fs').readFileSync('/tmp/demo-rd.$$','utf8'));
const kinds=r.items.map(i=>i.kind);
process.exit(kinds.includes('policy') && kinds.includes('struggled') && kinds.includes('unreviewed-claims') ? 0 : 1);
"; expect "an open policy, a struggled feature and unreviewed claims all surface" $?
node -e "
const r=JSON.parse(require('fs').readFileSync('/tmp/demo-rd.$$','utf8'));
const top=r.items[0];
process.exit(top && top.weight >= 4 && top.ask && top.why ? 0 : 1);
"; expect "the top item is high-consequence and states both why-it-ranks and what-to-answer" $?
node -e "
const r=JSON.parse(require('fs').readFileSync('/tmp/demo-rd.$$','utf8'));
// promoted features are grouped into ONE item, not listed individually — the wall this tool removes
process.exit(r.items.filter(i=>i.kind==='unreviewed-claims').length === 1 ? 0 : 1);
"; expect "identical findings are grouped, not repeated per feature" $?
rm -f /tmp/demo-rd.$$

step 30 "test authoring: the four ways a green test can still prove nothing"
# A separate throwaway target — these checks read feature_list.json and the test tree, and T2 is
# mid-story from the steps above.
T3="$WORK/demo-target-3"
rm -rf "$T3" && mkdir -p "$T3/src/test/java/com/acme/deep/pkg" && (cd "$T3" && git init -q .)
node "$SCRIPTS/setup-harness-loop.mjs" --target "$T3" --name "Demo3" --purpose "test-authoring demo" >/dev/null
echo '{ "name": "demo-target-3", "private": true }' > "$T3/package.json"
cat > "$T3/src/test/java/com/acme/deep/pkg/WidgetTest.java" <<'EOF'
/** Tests the widget. Written by reading Widget.java. */
class WidgetTest { }
EOF
cat > "$T3/src/test/java/com/acme/deep/pkg/GadgetTest.java" <<'EOF'
/** requirement.md §4 case 2 — a gadget rejects a negative quantity. */
class GadgetTest { }
EOF
node -e "
const fs=require('fs'); const p='$T3/feature_list.json';
const fl=JSON.parse(fs.readFileSync(p,'utf8'));
fl.features=[
  {id:'feat-w', name:'widget', behavior:'b', verification:'mvn test -Dtest=WidgetTest', kind:'build',
   dependencies:[], status:'done', readyForCheck:false, evidence:'ran mvn test -Dtest=WidgetTest, 4 tests green on 2026-01-01',
   checkerNotes:'', attempts:1, maxAttempts:3, falsifier:'a widget that accepts anything'},
  {id:'feat-g', name:'gadget', behavior:'b', verification:'mvn test -Dtest=GadgetTest', kind:'build',
   dependencies:[], status:'not-started', readyForCheck:false, evidence:'', checkerNotes:'', attempts:0, maxAttempts:3},
  {id:'feat-g-prove', name:'gadget proven', behavior:'b', verification:'mvn test -Dtest=GadgetTest', kind:'prove',
   dependencies:['feat-g'], status:'not-started', readyForCheck:false, evidence:'', checkerNotes:'', attempts:0, maxAttempts:3,
   falsifier:'a gadget that accepts a negative quantity'},
];
fs.writeFileSync(p, JSON.stringify(fl,null,2));
"
node "$SCRIPTS/verify-harness.mjs" --target "$T3" --skip-baseline --quiet
RPT3="$T3/trace/verify-report.json"
node -e "
const r=require('$RPT3'); const f=r.findings.find(x=>x.id==='evidence-no-red');
// feat-w is green and its evidence never mentions a failing run
process.exit(f && f.evidence.includes('feat-w') ? 0 : 1);
"; expect "a green feature whose evidence never shows a red run is flagged" $?
node -e "
const r=require('$RPT3'); const f=r.findings.find(x=>x.id==='falsifier-missing');
process.exit(f && f.evidence.includes('feat-g') && !f.evidence.includes('feat-g-prove') ? 0 : 1);
"; expect "an unfinished feature with no falsifier is flagged; one that has it is not" $?
node -e "
const r=require('$RPT3'); const f=r.findings.find(x=>x.id==='build-unproven');
// feat-g has a prove feature depending on it; feat-w has none
process.exit(f && f.evidence.includes('feat-w') && !f.evidence.includes('feat-g,') ? 0 : 1);
"; expect "a build feature that no prove feature judges is flagged" $?
node -e "
const r=require('$RPT3'); const f=r.findings.find(x=>x.id==='test-untraceable');
process.exit(f && f.evidence.includes('WidgetTest') && !f.evidence.includes('GadgetTest') ? 0 : 1);
"; expect "a test with no spec citation is flagged; one citing a requirement section is not" $?
node -e "
const fs=require('fs');
// the whole test-design skill must land in the target — SKILL.md alone dispatches to files that
// would not exist, which is exactly the Fresh Session Test failure (Lesson 3)
const need=['skills/test-design/SKILL.md','skills/test-design/references/anti-patterns.md',
            'skills/test-design/references/property-catalog.md','skills/test-design/schemas/test-condition.schema.json',
            'skills/test-design/checklists/reviewer-checklist.md','docs/reference/test-authoring.md',
            '.kiro/agents/test-designer.json','.kiro/agents/test-implementer.json','memory/test-designer/MEMORY.md'];
process.exit(need.every(f=>fs.existsSync('$T3/'+f)) ? 0 : 1);
"; expect "the test-design skill, its agents and their memory are scaffolded into the target" $?

step 31 "adopting an existing repo: two-file footprint, then debt is frozen and ratcheted"
LEG="$WORK/legacy-repo"
rm -rf "$LEG" && mkdir -p "$LEG/src" && (cd "$LEG" && git init -q .)
printf '# Our agent rules\n\nExisting content nobody may destroy.\n' > "$LEG/AGENTS.md"
echo '{ "name": "legacy", "private": true }' > "$LEG/package.json"
(cd "$LEG" && git add -A && git -c user.email=d@d -c user.name=d commit -qm init >/dev/null 2>&1)
node "$SCRIPTS/install-onboarder.mjs" --target "$LEG" >/dev/null
node -e "
const fs=require('fs');
const before=['AGENTS.md','package.json'].every(f=>fs.existsSync('$LEG/'+f));
const kept=fs.readFileSync('$LEG/AGENTS.md','utf8').includes('nobody may destroy');
const added=['prompts/harness-onboarder.md','.kiro/agents/harness-onboarder.json'].every(f=>fs.existsSync('$LEG/'+f));
// the whole point: nothing ELSE appeared — no init.sh, no feature_list.json, no docs/
const untouched=!fs.existsSync('$LEG/init.sh') && !fs.existsSync('$LEG/feature_list.json');
process.exit(before&&kept&&added&&untouched?0:1);
"; expect "the onboarder installs two files and leaves the existing repo untouched" $?
node -e "
const j=require('$LEG/.kiro/agents/harness-onboarder.json');
const p=require('fs').readFileSync('$LEG/prompts/harness-onboarder.md','utf8');
// a file:// URI kiro resolves relative to .kiro/agents/, and no unsubstituted <skill> token
process.exit(j.prompt==='file://../../prompts/harness-onboarder.md' && !p.includes('<skill>') ? 0 : 1);
"; expect "its prompt URI resolves from .kiro/agents/ and the skill path is substituted" $?
# The ratchet, on a target that already carries real debt (T3 from step 30).
node "$SCRIPTS/adoption-baseline.mjs" --target "$T3" --record --note "demo" >/dev/null
BASE0=$(node -e "const b=require('$T3/trace/adoption-baseline.json');console.log(b.debt['falsifier-missing']||0)")
node "$SCRIPTS/adoption-baseline.mjs" --target "$T3" --json > /tmp/demo-ab0.$$ 2>&1 || true
node -e "
const r=JSON.parse(require('fs').readFileSync('/tmp/demo-ab0.$$','utf8'));
// no family grew, and the debt IS carried (not zero) — that is 'frozen', not 'clean'.
// Blockers are reported separately and never grandfathered, which is why exit code alone
// is the wrong assertion here: this scaffold still holds placeholders.
process.exit(r.grown.length===0 && r.totalNow>0 ? 0 : 1);
"; expect "with the debt frozen, pre-existing warnings are carried, not failed" $?
node -e "
const fs=require('fs'); const p='$T3/feature_list.json';
const fl=JSON.parse(fs.readFileSync(p,'utf8'));
fl.features.push({id:'feat-post',name:'post-adoption',behavior:'b',verification:'exit 0',
  dependencies:[],status:'not-started',readyForCheck:false,evidence:'',checkerNotes:'',attempts:0,maxAttempts:3});
fs.writeFileSync(p, JSON.stringify(fl,null,2));
"
node "$SCRIPTS/adoption-baseline.mjs" --target "$T3" --json > /tmp/demo-ab.$$ 2>&1
node -e "
const r=JSON.parse(require('fs').readFileSync('/tmp/demo-ab.$$','utf8'));
const g=r.grown.find(x=>x.family==='falsifier-missing');
// exactly the ONE new one is new debt; the pre-existing $BASE0 stay silent
process.exit(g && g.delta===1 && g.was===$BASE0 ? 0 : 1);
"; expect "one feature added after adoption is new debt; the pre-existing ones stay silent" $?
node -e "
const fs=require('fs'); const p='$T3/feature_list.json';
const fl=JSON.parse(fs.readFileSync(p,'utf8'));
for (const f of fl.features) if (!f.falsifier) f.falsifier='paid down during the demo';
fs.writeFileSync(p, JSON.stringify(fl,null,2));
"
node "$SCRIPTS/adoption-baseline.mjs" --target "$T3" --ratchet >/dev/null
node -e "
const b=require('$T3/trace/adoption-baseline.json');
// debt paid down is locked out: the family is gone or lowered, so it can never return quietly
process.exit((b.debt['falsifier-missing']||0) < $BASE0 ? 0 : 1);
"; expect "--ratchet lowers the baseline so paid-down debt cannot come back" $?
rm -f /tmp/demo-ab.$$

step "32/33" "meta loop: dispatch on the right layer, stop when nothing moves"
STUBBIN="$WORK/stubbin"; mkdir -p "$STUBBIN"
cat > "$STUBBIN/kiro-cli" <<'EOF'
#!/usr/bin/env bash
echo "[stub kiro-cli] $*" >&2
exit 0
EOF
chmod +x "$STUBBIN/kiro-cli"
echo '{ "name": "demo-target", "private": true }' > "$T/package.json"   # make the baseline greenable
PATH="$STUBBIN:$PATH" KIRO_API_KEY=demo-stub bash "$SCRIPTS/harness-loop.sh" --target "$T" --runner kiro --iterations 3 \
  > /tmp/demo-meta.$$ 2>&1
tail -25 /tmp/demo-meta.$$
grep -q "identical blocker set two iterations running" /tmp/demo-meta.$$; expect "loop stops itself on the stuck-progress rule instead of spinning forever" $?
rm -f /tmp/demo-meta.$$

echo ""
if [ "$FAIL" = "0" ]; then
  echo "ALL DEMO STEPS PASSED — harness-loop lifecycle proven end-to-end at $T"
else
  echo "ONE OR MORE DEMO STEPS FAILED — see FAIL lines above"
fi
exit "$FAIL"

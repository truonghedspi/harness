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
# The gate is init.mjs now; init.sh is a wrapper. Inject into the file that actually decides.
cp "$T/init.mjs" "$T/init.mjs.bak"
echo '<project><modelVersion>4.0.0</modelVersion></project>' > "$T/pom.xml"
printf '#!/usr/bin/env bash\necho "real mvnw would run here"\n' > "$T/mvnw"; chmod +x "$T/mvnw"
node -e "
const fs=require('fs'); const p='$T/init.mjs';
let s=fs.readFileSync(p,'utf8');
// strip the wrapper preference: call bare mvn, which is not on PATH on this machine
s=s.replace(/const mvn = IS_WIN[^;]*;/s, 'const mvn = \"mvn\";');
fs.writeFileSync(p,s);
"
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
grep -q "templates/tree/init" /tmp/demo-rank.$$; expect "ranking routes to the template that owns the gate" $?
tail -6 /tmp/demo-rank.$$; rm -f /tmp/demo-rank.$$

step 8 "generate an agent-ready prompt"
PROMPT="$(node "$SCRIPTS/improve-harness.mjs" --prompt)"
echo "$PROMPT" | grep -q "never just the one target repo"; expect "prompt states the template-not-target rule" $?
PINNED_ID="$(node "$SCRIPTS/harness-issue.mjs" list --status open --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s)[0].id))')"
node "$SCRIPTS/improve-harness.mjs" --prompt --id "$PINNED_ID" | grep -q "issue $PINNED_ID"
expect "a repair prompt can be pinned to the issue imported from the current target" $?

step 9 "apply the fix and close the loop: --reverify --auto-resolve"
# A target override may only judge issues actually observed on that target. Otherwise absence of a
# manual signature in any arbitrary repo falsely closes unrelated backlog items.
mkdir -p "$WORK/foreign-target"
node "$SCRIPTS/harness-issue.mjs" add --gate manual --id foreign-only --layer harness --symptom "belongs to another target" --target "$WORK/foreign-target" >/dev/null
mv "$T/init.mjs.bak" "$T/init.mjs"
node "$SCRIPTS/improve-harness.mjs" --reverify --auto-resolve --target "$T" >/tmp/demo-rv.$$ 2>&1
cat /tmp/demo-rv.$$
grep -q "no longer reproduce" /tmp/demo-rv.$$; RV1=$?; rm -f /tmp/demo-rv.$$
[ "$RV1" = "0" ]; expect "the fixed defect is confirmed resolved by a real re-run, not a claim" $?
FOREIGN_ID="$(node "$SCRIPTS/harness-issue.mjs" list --status open --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const x=JSON.parse(s).find(i=>i.signature==="manual/foreign-only");if(x)process.stdout.write(x.id)})')"
export FOREIGN_ID
[ -n "$FOREIGN_ID" ]; expect "--reverify --target does not resolve an issue never observed on that target" $?
node "$SCRIPTS/harness-issue.mjs" resolve --id "$FOREIGN_ID" --fix "deliberately invalid demo transition" >/dev/null
node "$SCRIPTS/harness-issue.mjs" restore --id "$FOREIGN_ID" --note "demo: undo false resolution" >/dev/null
node "$SCRIPTS/harness-issue.mjs" list --status open --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const x=JSON.parse(s).find(i=>i.id===process.env.FOREIGN_ID);process.exit(x&&!x.regressed&&!x.fix?0:1)})'
expect "a false resolution can be restored append-only without masquerading as a regression" $?
node "$SCRIPTS/harness-issue.mjs" wontfix --id "$FOREIGN_ID" --note "demo fixture" >/dev/null

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
# Finishing ON the last allowed attempt is the timebox working, not being violated. This fired on a
# feature the checker had just approved and turned a success into a blocker (HI-019).
node -e "
const fs=require('fs'); const p='$T2/feature_list.json';
const fl=JSON.parse(fs.readFileSync(p,'utf8'));
const f=fl.features.find(x=>x.id==='feat-002'); f.status='done'; f.evidence='ran it, red then green';
fs.writeFileSync(p, JSON.stringify(fl,null,2));
"
node "$SCRIPTS/verify-harness.mjs" --target "$T2" --skip-baseline --quiet
grep -q '"id": "over-budget:feat-002"' "$T2/trace/verify-report.json"; OB=$?
[ "$OB" != "0" ]; expect "succeeding on the last attempt is not over-budget — done is not retrying" $?
node -e "
const fs=require('fs'); const p='$T2/feature_list.json';
const fl=JSON.parse(fs.readFileSync(p,'utf8'));
const f=fl.features.find(x=>x.id==='feat-002'); f.status='in-progress'; f.evidence='';
fs.writeFileSync(p, JSON.stringify(fl,null,2));
"

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
# The invisible failure: kiro resolves file:// relative to .kiro/agents/, and a URI resolving to
# nothing does not error — the agent starts as the unrestricted default and its output looks
# ordinary. Cost a live run once (HI-005) and sat broken in 3 of 4 agents of a dormant project.
# On a PRISTINE scaffold — T2 has had docs deliberately deleted by earlier steps, and a URI
# pointing at a file another test removed is that test's doing, not a template defect.
TU="$WORK/uri-target"; rm -rf "$TU" && mkdir -p "$TU"
node "$SCRIPTS/setup-harness-loop.mjs" --target "$TU" --name "UriDemo" --purpose "uri demo" >/dev/null
node "$SCRIPTS/verify-harness.mjs" --target "$TU" --skip-baseline --quiet
node -e "
const r=require('$TU/trace/verify-report.json');
const bad=r.findings.filter(f=>String(f.id).startsWith('agent-uri-broken'));
if (bad.length) console.log('   ', bad.map(f=>f.id+' → '+f.evidence).join('\n    '));
process.exit(bad.length ? 1 : 0);
"; expect "every agent the scaffold ships has file:// URIs that actually resolve" $?
node -e "
// the digest 6 agents load is GENERATED, not templated — shipping them without it was a real bug
process.exit(require('fs').existsSync('$TU/feature_list.digest.md') ? 0 : 1);
"; expect "setup generates feature_list.digest.md, so the agents that load it find it" $?
node -e "
const fs=require('fs'); const p='$TU/.kiro/agents/maker.json';
const j=JSON.parse(fs.readFileSync(p,'utf8'));
j.prompt='file://./loop/maker-prompt.md';   // the exact wrong form seen in the wild
fs.writeFileSync(p, JSON.stringify(j,null,2));
"
node "$SCRIPTS/verify-harness.mjs" --target "$TU" --skip-baseline --quiet
node -e "
const r=require('$TU/trace/verify-report.json');
const f=r.findings.find(x=>x.id==='agent-uri-broken:maker');
// blocker, not warn: a write-capable agent with no rulebook loaded is not a degraded harness
process.exit(f && f.severity==='blocker' && f.evidence.includes('loop/maker-prompt.md') ? 0 : 1);
"; expect "a file://./ URI that resolves to nothing is caught as a BLOCKER" $?
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
const r=j.resources.join(' ');
// The planner used to auto-load the FULL list because it rewrites the array — a real guarantee,
// paid on every spawn: 1943 lines on aeron-demo, the heaviest agent by far and growing with the
// project. It now loads the digest and reads the file on demand.
process.exit(r.includes('feature_list.digest.md') && !r.includes('/feature_list.json') ? 0 : 1);
"; expect "even the planner auto-loads the digest — the full list is read on demand, not carried" $?
node -e "
const fs=require('fs');
// Dropping a mechanical guarantee for a prompt sentence is the trade this harness says degrades,
// so the hazard it protected against is now gated instead: rewriting the array from the digest
// silently empties the fields the digest does not carry.
const {execFileSync}=require('child_process');
const p='$T2/feature_list.json';
try { execFileSync('git',['init','-q','.'],{cwd:'$T2'}); } catch {}
execFileSync('git',['add','-A'],{cwd:'$T2'});
execFileSync('git',['-c','user.email=a@b','-c','user.name=a','commit','-qm','base'],{cwd:'$T2'});
const d=JSON.parse(fs.readFileSync(p,'utf8'));
d.features[0].checkerNotes='NEEDS DESIGN: which reading?'; d.features[0].evidence='ran it';
fs.writeFileSync(p, JSON.stringify(d,null,2));
execFileSync('git',['add','-A'],{cwd:'$T2'});
execFileSync('git',['-c','user.email=a@b','-c','user.name=a','commit','-qm','notes'],{cwd:'$T2'});
const e=JSON.parse(fs.readFileSync(p,'utf8'));
e.features[0].checkerNotes=''; e.features[0].evidence='';
fs.writeFileSync(p, JSON.stringify(e,null,2));
"
node "$SCRIPTS/verify-harness.mjs" --target "$T2" --skip-baseline --quiet
node -e "
const r=require('$T2/trace/verify-report.json');
const f=r.findings.find(x=>x.id==='feature-field-lost');
process.exit(f && f.severity==='blocker' && /checkerNotes/.test(f.evidence) ? 0 : 1);
"; expect "and losing a checkerNotes or evidence that had content is a BLOCKER — a dropped marker stops the loop escalating" $?
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
# The oracle chain as an ORDERING, not advice. Before this, test-designer filled the falsifier,
# its own rule stopped matching, and control fell through to the maker — which then wrote the very
# test it was going to be judged by.
TO="$WORK/oracle-order"; rm -rf "$TO" && mkdir -p "$TO"
node "$SCRIPTS/setup-harness-loop.mjs" --target "$TO" --name "OracleOrder" --purpose "ordering demo" >/dev/null
sed -i.bak 's/| needs-human |/| verified (demo) |/' "$TO/docs/assumptions.md" && rm -f "$TO/docs/assumptions.md.bak"
node -e "
const fs=require('fs'); const p='$TO/feature_list.json';
const d=JSON.parse(fs.readFileSync(p,'utf8'));
d.features=[
 {id:'feat-1',name:'baseline',behavior:'b',verification:'exit 0',falsifier:'x',dependencies:[],status:'done',readyForCheck:false,evidence:'red then green',checkerNotes:'',attempts:1,maxAttempts:3},
 {id:'feat-b',name:'build',behavior:'b',verification:'exit 0',kind:'build',dependencies:['feat-1'],status:'not-started',readyForCheck:false,evidence:'',checkerNotes:'',attempts:0,maxAttempts:3},
 {id:'feat-p',name:'prove',behavior:'b',verification:'exit 0',kind:'prove',dependencies:['feat-b'],status:'not-started',readyForCheck:false,evidence:'',checkerNotes:'',attempts:0,maxAttempts:3}];
fs.writeFileSync(p, JSON.stringify(d,null,2));
"
route_node(){ (cd "$TO" && node loop/route.mjs --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).node))'); }
# Precedence is deeper-first, and it has to hold against the GATE, not only against a marker.
# Found on a real project: a design that simply never said how anyone would know the thing works
# did not register as a design problem, so the router jumped to the oracle layer and sent
# test-designer to derive falsifiers from invariants nobody had written (HI-014).
mkdir -p "$TO/docs/design"
printf '# Reconciler\n\nIt reads the log and fills the gap. It writes to the sink.\n%.0s' 1 2 3 4 5 6 7 8 > "$TO/docs/design/recon.md"
[ "$(route_node)" = "designer" ]; expect "a design stating no seam and no invariants outranks the oracle layer" $?
printf '\n## Observable seam\n\nThe GapEventSink, externally visible.\n\n## Invariants\n\nEvent count is conserved for every replay; reconcile is idempotent.\n' >> "$TO/docs/design/recon.md"
# A design that changes what a feature MEANS leaves feature_list.json a version behind, and the
# designer is (correctly) not allowed to write scope — so route on what it can write: its own
# Feature impact table. Without this the router jumped decomposition and sent the oracle layer to
# write falsifiers for features that were about to be re-cut.
cat >> "$TO/docs/design/recon.md" <<'MD'

## Feature impact

| `feat-b` | **change** | the seam moved; this feature means something else now |
| `feat-1` | keep | untouched |
MD
# The design is now testable but not yet independently reviewed. Its typed verdict is bound to the
# exact digest, so the planner cannot consume a design the evaluator has not seen.
[ "$(route_node)" = "design-reviewer" ]; expect "a valid but unreviewed design routes to the independent reviewer before decomposition" $?
TO_DIGEST="$(cd "$TO" && node loop/route.mjs --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).detail))')"
printf '{"schema":"design-review/1","designDigest":"%s","revision":1,"status":"approved","summary":"demo approval","evidence":["docs/design/recon.md"]}\n' "$TO_DIGEST" > "$TO/loop/design-review.json"
[ "$(route_node)" = "feature-planner" ]; expect "a design marking a feature change/new outranks the oracle layer" $?
node -e "
const fs=require('fs');const p='$TO/feature_list.json';
fs.writeFileSync(p, fs.readFileSync(p,'utf8'));   // planner catches up = feature_list is newer
"
[ "$(route_node)" = "test-designer" ]; expect "once the cut catches up, routing falls through to test-designer" $?
[ "$(route_node)" = "test-designer" ]; expect "a feature with no falsifier routes to test-designer, not the maker" $?
node -e "
const fs=require('fs'); const p='$TO/feature_list.json';
const d=JSON.parse(fs.readFileSync(p,'utf8'));
for (const f of d.features) if (!f.falsifier) f.falsifier='breaks the conservation invariant';
fs.writeFileSync(p, JSON.stringify(d,null,2));
"
# test-designer has TWO outputs — the falsifier AND the conditions under tests/design/ — and only
# the first used to be routed on. Where the feature-planner derives falsifiers from the invariant
# contract, the designer rule never fires, tests/design/ is never created, and the implementer is
# dispatched to implement conditions that do not exist. Measured on aeron-demo during a codex run:
# two paid sessions on one feature, the agent hunting for tests/design/, zero output.
[ "$(route_node)" = "test-designer" ]; expect "falsifiers filled but no validated conditions still routes to test-designer" $?
( cd "$TO" && node loop/route.mjs --json ) | grep -q "no validated test condition"
expect "and the reason names the missing input rather than the feature" $?
# A real condition file, not just the directory: an empty conditions/ folder used to satisfy this,
# and the implementer was dispatched twice on the real project with nothing to implement from.
mkdir -p "$TO/tests/design/plans/TP-D-0001/conditions"
printf '{"id":"TCON-D-0001"}' > "$TO/tests/design/plans/TP-D-0001/conditions/TCON-D-0001.json"
[ "$(route_node)" = "test-implementer" ]; expect "once the conditions exist, a specified-but-unwritten oracle routes to test-implementer" $?
node -e "
const fs=require('fs'); const p='$TO/feature_list.json';
const d=JSON.parse(fs.readFileSync(p,'utf8'));
d.features.find(f=>f.id==='feat-p').evidence='wrote the test; ran it, FAILED (exit 1) as expected';
fs.writeFileSync(p, JSON.stringify(d,null,2));
"
[ "$(route_node)" = "maker" ]; expect "only once the oracle exists does the build feature become eligible" $?
# Level 3 is proof, not construction — the node that owns it belongs to the test band, and the
# routing layer is what tells a reader (and the run-loop log) which band a node is in.
node -e "
const fs=require('fs');
const src=fs.readFileSync('$TO/loop/route.mjs','utf8');
const m=src.match(/node: \"k8s-integration-tester\"[^}]*?layer: \"(\w+)\"/s);
process.exit(m && m[1]==='integration' ? 0 : 1);
"; expect "k8s-integration-tester routes as layer:integration, not layer:implementation" $?
# The graph is the one artifact no other gate substitutes for: every check here inspects file
# CONTENT, none inspects which node runs next. Nine gates and a green demo coexisted with a
# livelock that only writing the routing table out by hand exposed.
node "$SCRIPTS/verify-harness.mjs" --target "$TO" --skip-baseline --quiet
node -e "
const r=require('$TO/trace/verify-report.json');
process.exit(r.findings.some(f=>f.id==='graph-stale') ? 1 : 0);
"; expect "a fresh scaffold's graph is not reported stale" $?
touch "$TO/loop/route.mjs"
node "$SCRIPTS/verify-harness.mjs" --target "$TO" --skip-baseline --quiet
node -e "
const r=require('$TO/trace/verify-report.json');
const f=r.findings.find(x=>x.id==='graph-stale');
process.exit(f && f.evidence.includes('route.mjs') ? 0 : 1);
"; expect "changing the router without the graph is caught as graph-stale" $?
touch "$TO/docs/reference/graph.md"
node "$SCRIPTS/verify-harness.mjs" --target "$TO" --skip-baseline --quiet
node -e "
const r=require('$TO/trace/verify-report.json');
process.exit(r.findings.some(f=>f.id==='graph-stale') ? 1 : 0);
"; expect "updating the graph clears it" $?
node -e "
const fs=require('fs');
// the rule has to be where an agent will actually see it, not only in the gate
const t=fs.readFileSync('$TO/AGENTS.md','utf8');
process.exit(/graph\.md.*same commit|same commit.*graph\.md/s.test(t) && /graph-stale/.test(t) ? 0 : 1);
"; expect "the router file states the rule, so an agent meets it before the gate does" $?
node -e "
const fs=require('fs');
const p='$SCRIPTS/../templates/k8s/prompts/k8s-integration-tester.md';
const t=fs.readFileSync(p,'utf8');
// a test-layer node carries the test-authoring rules, including the honest caveat that unlike
// test-designer it DOES read the implementation, so its independence is the boundary
const need=[/traceability header/i, /falsifier/i, /red before/i.test(t)?/red/i:/red/i, /never widen an assertion/i, /independence comes from the \*\*boundary\*\*/i];
process.exit(need.every(r=>r.test(t)) ? 0 : 1);
"; expect "its prompt carries the test-authoring rules and the boundary-not-blindness caveat" $?
# The upstream half: the material a falsifier is derived FROM is a design output.
mkdir -p "$TO/docs/design"
printf '# Reconciler\n\nIt reads the log and fills the gap.\nIt writes to the sink.\n%.0s' 1 2 3 4 5 6 7 8 > "$TO/docs/design/recon.md"
node "$SCRIPTS/verify-harness.mjs" --target "$TO" --skip-baseline --quiet
node -e "
const r=require('$TO/trace/verify-report.json');
process.exit(r.findings.some(f=>f.id==='design-untestable:recon.md') ? 0 : 1);
"; expect "a design doc naming no seam and no invariants is flagged — 'how would we know' is a design question" $?
printf '\n## Observable seam\n\nThe GapEventSink, externally visible.\n\n## Invariants\n\nEvent count is conserved for every replay; reconcile is idempotent.\n' >> "$TO/docs/design/recon.md"
node "$SCRIPTS/verify-harness.mjs" --target "$TO" --skip-baseline --quiet
node -e "
const r=require('$TO/trace/verify-report.json');
process.exit(r.findings.some(f=>f.id==='design-untestable:recon.md') ? 1 : 0);
"; expect "stating the seam and the invariants clears it" $?
# The handoff design->planner was prose until this contract: design-untestable only checked that
# the WORDS seam and invariant appeared. The planner was told to derive each falsifier from a
# stated invariant and nothing verified it — it could invent every one and stay green.
# Checked in both directions, because forward alone still passes a citation to nothing (ISO 29148).
cat >> "$TO/docs/design/recon.md" <<'MD'

| Id | Component | Invariant | Observable seam |
|---|---|---|---|
| `INV-RECON-1` | GapReconciler | Reconcile is idempotent for every input | R_gap contents |
| `INV-RECON-2` | GapReconciler | Event count is conserved across every replay | downstream stream |
MD
node -e "
const fs=require('fs'); const p='$TO/feature_list.json';
const d=JSON.parse(fs.readFileSync(p,'utf8'));
d.features.find(f=>f.id==='feat-b').falsifier='a reconciler that duplicates on replay [INV-RECON-1]';
d.features.find(f=>f.id==='feat-p').falsifier='a reconciler that drops events [INV-RECON-404]';
fs.writeFileSync(p, JSON.stringify(d,null,2));
"
node "$SCRIPTS/verify-harness.mjs" --target "$TO" --skip-baseline --quiet
node -e "
const r=require('$TO/trace/verify-report.json');
const u=r.findings.find(f=>f.id==='invariant-uncovered');
process.exit(u && u.evidence.includes('INV-RECON-2') && !u.evidence.includes('INV-RECON-1') ? 0 : 1);
"; expect "forward: an invariant no falsifier cites is flagged, a cited one is not" $?
node -e "
const r=require('$TO/trace/verify-report.json');
const o=r.findings.find(f=>f.id==='falsifier-orphan');
// the direction that catches an INVENTED falsifier — a citation to something never stated
process.exit(o && o.evidence.includes('INV-RECON-404') ? 0 : 1);
"; expect "backward: a falsifier citing an invariant nobody stated is flagged as orphan" $?
node -e "
const fs=require('fs'); const p='$TO/feature_list.json';
const d=JSON.parse(fs.readFileSync(p,'utf8'));
d.features.find(f=>f.id==='feat-p').falsifier='a reconciler that drops events [INV-RECON-2]';
fs.writeFileSync(p, JSON.stringify(d,null,2));
"
node "$SCRIPTS/verify-harness.mjs" --target "$TO" --skip-baseline --quiet
node -e "
const r=require('$TO/trace/verify-report.json');
process.exit(r.findings.some(f=>/invariant-uncovered|falsifier-orphan/.test(f.id)) ? 1 : 0);
"; expect "citing the real id clears both directions" $?
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

# Feature planning is a capability pack, not a 150-line role prompt: invariant workflow in
# SKILL.md, conditional counterexamples, schema, deterministic checker and discriminating fixtures.
node -e "
const fs=require('fs');
const need=['skills/feature-planning/SKILL.md','skills/feature-planning/schemas/feature-plan.schema.json',
 'skills/feature-planning/references/cutting-rules.md','skills/feature-planning/references/counterexamples.md',
 'skills/feature-planning/scripts/check-plan.mjs','skills/feature-planning/evals/run-fixtures.mjs'];
const man=JSON.parse(fs.readFileSync('$TO/agents.manifest.json','utf8'));
const planner=man.agents.find(a=>a.name==='feature-planner');
process.exit(need.every(f=>fs.existsSync('$TO/'+f)) && planner.resources.includes('skills/feature-planning/SKILL.md') ? 0 : 1);
"; expect "the planner receives its complete capability pack and auto-loads the invariant workflow" $?
node "$TO/skills/feature-planning/evals/run-fixtures.mjs" >/tmp/demo-plan-fixtures.$$ 2>&1
grep -q 'PASS valid' /tmp/demo-plan-fixtures.$$ && grep -q 'PASS orphan-build' /tmp/demo-plan-fixtures.$$ && grep -q 'PASS invented-invariant' /tmp/demo-plan-fixtures.$$
expect "planner fixtures accept a complete DAG and reject orphan proof plus invented traceability" $?
rm -f /tmp/demo-plan-fixtures.$$
node -e "
const fs=require('fs');
const p=fs.readFileSync('$TO/prompts/feature-planner.md','utf8');
process.exit(p.split('\n').length<60 && /skills\/feature-planning\/SKILL\.md/.test(p) && /check-plan\.mjs/.test(p) ? 0 : 1);
"; expect "the planner prompt is a thin launcher into the skill, not a second drifting manual" $?

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

step 32 "three runtimes from one manifest: kiro-cli, Claude Code and Codex stay in step"
TR="$WORK/runtime-target"; rm -rf "$TR" && mkdir -p "$TR"
node "$SCRIPTS/setup-harness-loop.mjs" --target "$TR" --name "RuntimeDemo" --purpose "runtime parity" >/dev/null
node -e "
const fs=require('fs');
const kiro=fs.readdirSync('$TR/.kiro/agents').filter(f=>f.endsWith('.json')).map(f=>f.replace('.json',''));
const cc=fs.readdirSync('$TR/.claude/agents').filter(f=>f.endsWith('.md')).map(f=>f.replace('.md',''));
const cx=fs.readdirSync('$TR/.codex/agents').filter(f=>f.endsWith('.toml')).map(f=>f.replace('.toml',''));
const man=require('$TR/agents.manifest.json').agents.filter(a=>!a.optional).map(a=>a.name);
const same=(a,b)=>a.length===b.length&&a.every(x=>b.includes(x));
process.exit(same(kiro,man)&&same(cc,man)&&same(cx,man)?0:1);
"; expect "one manifest emits all three formats, with the same agent set" $?
node -e "
const fs=require('fs');
// Cheap model for producing, strong model for judging — the same line as generator/evaluator
// separation, because catching what a cheaper model got wrong IS the evaluator's job.
// Both kiro roles name a model rather than riding auto: on 2026-08-12 auto returned
// temporarily-unavailable mid-run and killed a maker part-way through a fix. A router can
// route to nothing. (No backticks in this comment: it sits inside a double-quoted shell
// string, where a backtick is command substitution — that is why the demo used to print
// auto: command not found.)
const cc=(n)=>(fs.readFileSync('$TR/.claude/agents/'+n+'.md','utf8').match(/^model: (.+)\$/m)||[])[1];
const kiro=(n)=>require('$TR/.kiro/agents/'+n+'.json').model;
process.exit(cc('checker')==='claude-opus-5' && cc('design-reviewer')==='claude-opus-5' &&
             cc('maker')==='sonnet' && cc('test-designer')==='sonnet' &&
             kiro('checker')==='claude-sonnet-4.5' && kiro('maker')==='claude-sonnet-4' ? 0 : 1);
"; expect "evaluators get the strongest model each runtime offers; executors run cheap" $?
node -e "
const fs=require('fs');
// the two things Claude Code has no field for are carried by per-agent hooks
const md=fs.readFileSync('$TR/.claude/agents/checker.md','utf8');
process.exit(/SubagentStart:[\s\S]*agent-context\.mjs checker/.test(md) &&
             /PreToolUse:[\s\S]*guard-write\.mjs checker/.test(md) ? 0 : 1);
"; expect "the checker's Claude config carries the resource-injection and write-guard hooks" $?
node -e "
// the write restriction must actually restrict — this is what makes 'the maker never grades
// itself' a property of the config rather than a line in a prompt
const {execFileSync}=require('child_process');
const run=(agent,file)=>JSON.parse(execFileSync('node',['tools/guard-write.mjs',agent],
  {cwd:'$TR',input:JSON.stringify({tool_input:{file_path:file}}),encoding:'utf8'}))
  .hookSpecificOutput.permissionDecision;
process.exit(run('checker','feature_list.json')==='allow' &&
             run('checker','src/Foo.java')==='deny' &&
             run('maker','src/Foo.java')==='allow' ? 0 : 1);
"; expect "guard-write allows the checker its state files and denies it source; the maker is free" $?
node -e "
const fs=require('fs');
// Codex's own sandbox is used where it can carry the rule (a role that never writes), and the hook
// only where it cannot: sandbox_mode is directory-granular, a writes list is glob-granular.
const t=fs.readFileSync('$TR/.codex/agents/checker.toml','utf8');
process.exit(/^name = \"checker\"/m.test(t) && /^model = \"gpt-5\.6-terra\"/m.test(t) &&
             /^model_reasoning_effort = \"high\"/m.test(t) &&
             /developer_instructions = /.test(t) && /## Read these before you do anything else/.test(t) ? 0 : 1);
"; expect "the Codex agent carries the inlined prompt, the evaluator model, and its resource list" $?
node -e "
const fs=require('fs');
// Codex agent TOML has no hooks field, so confinement lives in ONE project-level file. Codex accepts
// only description and hooks there: any other key and it rejects the whole file, logs one warning
// line, and runs with no hooks at all. Shipped exactly that bug once (\$comment) — hence the gate.
const j=JSON.parse(fs.readFileSync('$TR/.codex/hooks.json','utf8'));
const keys=Object.keys(j);
process.exit(keys.every(k=>['description','hooks'].includes(k)) &&
             /guard-write\.mjs --from-env/.test(JSON.stringify(j.hooks)) ? 0 : 1);
"; expect "Codex hooks.json uses only the two keys Codex accepts, and wires the write guard" $?
node -e "
// Codex's edit tool is apply_patch and its payload has NO file_path — just a patch envelope. The
// guard parsed only file_path at first, found none, and returned ALLOW: confinement absent while
// every log line said the hook ran. All four of these are the Codex shape.
const {execFileSync}=require('child_process');
const run=(env,cmd)=>JSON.parse(execFileSync('node',['tools/guard-write.mjs','--from-env'],
  {cwd:'$TR',input:JSON.stringify({tool_name:'apply_patch',tool_input:{command:cmd}}),encoding:'utf8',
   env:{...process.env,...(env?{HARNESS_AGENT:env}:{HARNESS_AGENT:''})}}))
  .hookSpecificOutput;
const patch=(...lines)=>'*** Begin Patch\n'+lines.join('\n')+'\n*** End Patch';
const a=run('checker',patch('*** Update File: feature_list.json'));
const b=run('checker',patch('*** Add File: src/Sneak.java'));
const c=run('checker',patch('*** Update File: progress.md','*** Add File: src/Sneak.java'));
const d=run('',patch('*** Add File: src/Sneak.java'));
process.exit(a.permissionDecision==='allow' && b.permissionDecision==='deny' &&
             c.permissionDecision==='deny' &&
             d.permissionDecision==='allow' && /NO ROLE IDENTIFIED/.test(d.permissionDecisionReason) ? 0 : 1);
"; expect "the guard reads Codex apply_patch envelopes, sinks a whole patch for one bad path, and says so when it cannot identify the role" $?
node -e "
// A payload that arrives and will not parse used to become {} and then a cheerful 'nothing to check'
// allow. If the guard cannot read the request it cannot police it.
const {execFileSync}=require('child_process');
const out=JSON.parse(execFileSync('node',['tools/guard-write.mjs','--from-env'],
  {cwd:'$TR',input:'not json',encoding:'utf8',env:{...process.env,HARNESS_AGENT:'checker'}}));
process.exit(out.hookSpecificOutput.permissionDecision==='deny' ? 0 : 1);
"; expect "an unparseable hook payload is denied, not silently allowed" $?
node -e "
const fs=require('fs');
// three configs, one server set — an agent that can reach a connector under one runtime and not
// another returns two different verdicts for the same feature
const toml=fs.readFileSync('$TR/.codex/config.toml','utf8');
const names=[...toml.matchAll(/^\[mcp_servers\.([^\]]+)\]/gm)].map(m=>m[1]);
const claude=Object.keys(require('$TR/.mcp.json').mcpServers);
const kiro=Object.keys(require('$TR/.kiro/settings/mcp.json').mcpServers);
process.exit(JSON.stringify(names)===JSON.stringify(claude) && JSON.stringify(claude)===JSON.stringify(kiro) ? 0 : 1);
"; expect "MCP is written for all three runtimes from one source, with identical server sets" $?
# An unrecognised --runtime used to match no branch, leaving an empty wanted-set, after which the
# cleanup pass deleted every generated agent in the repo. A typo must not disarm the harness.
BEFORE=$(ls "$TR/.kiro/agents" | wc -l | tr -d ' ')
node "$SCRIPTS/gen-agents.mjs" --target "$TR" --runtime kodex >/dev/null 2>&1
AFTER=$(ls "$TR/.kiro/agents" | wc -l | tr -d ' ')
test "$BEFORE" = "$AFTER" -a "$BEFORE" != "0"; expect "a misspelled --runtime is refused instead of deleting every generated agent" $?
# Generating ONE runtime must not delete the others. The cleanup pass removes files for agents the
# manifest no longer declares, and "not in the wanted set" looked identical to that — so
# --runtime kiro deleted every Claude agent. Latent since the second runtime; a third exposed it.
CXB=$(ls "$TR/.codex/agents" | wc -l | tr -d ' ')
node "$SCRIPTS/gen-agents.mjs" --target "$TR" --runtime both >/dev/null
CXA=$(ls "$TR/.codex/agents" 2>/dev/null | wc -l | tr -d ' ')
test "$CXB" = "$CXA" -a "$CXB" != "0"; expect "generating two runtimes leaves the third's agents alone" $?
node -e "
const {execFileSync}=require('child_process');
const out=JSON.parse(execFileSync('node',['tools/agent-context.mjs','checker'],
  {cwd:'$TR',input:'{}',encoding:'utf8'}));
const ctx=out.hookSpecificOutput.additionalContext;
// resources are read at spawn, so they cannot be stale — and constraints.md must be among them
process.exit(out.hookSpecificOutput.hookEventName==='SubagentStart' &&
             ctx.includes('<file path=\"docs/constraints.md\">') ? 0 : 1);
"; expect "agent-context injects the checker's resources at spawn, rulebook included" $?
node "$T/tools/telemetry-calibrate.mjs" --target "$T" --runtime all > "$T/telemetry-calibration.log"
node -e "
const c=require('$T/trace/telemetry-capabilities.json');
process.exit(c.results.length===3 && c.results.every(r=>r.adapter==='pass') &&
  c.results.find(r=>r.runtime==='codex').coverage==='shell-incomplete' ? 0 : 1);
"; expect "telemetry calibration exposes runtime coverage instead of making an unobserved zero look good" $?
printf '%s' '{"session_id":"secret-session","tool_name":"Read","tool_input":{"file_path":"docs/architecture.md"},"tool_response":"SECRET SOURCE CONTENT"}' | node "$T/tools/telemetry.mjs" --target "$T" --runtime claude --actor maker
printf '%s' '{"session_id":"secret-session","tool_name":"Read","tool_input":{"file_path":"docs/architecture.md"},"tool_response":"SECRET SOURCE CONTENT"}' | node "$T/tools/telemetry.mjs" --target "$T" --runtime claude --actor maker
printf '%s' '{"session_id":"secret-session","tool_name":"Grep","tool_input":{"path":"src","pattern":"customer-password"},"tool_response":"SECRET MATCH"}' | node "$T/tools/telemetry.mjs" --target "$T" --runtime claude --actor maker
node "$T/tools/run-report.mjs" --target "$T" --json > "$T/telemetry-report.json"
node -e "
const fs=require('fs'), text=fs.readFileSync('$T/trace/tool-events.jsonl','utf8'), r=require('$T/telemetry-report.json');
process.exit(r.telemetry.directReads===2 && r.telemetry.uniquePaths===1 &&
  r.telemetry.duplicateReadRate===0.5 && r.telemetry.searches===1 &&
  !/SECRET|customer-password/.test(text) ? 0 : 1);
"; expect "redacted telemetry measures duplicate reads and searches without storing contents or queries" $?
node -e "
const fs=require('fs');
const k=fs.readFileSync('$T/.kiro/agents/maker.json','utf8'), c=fs.readFileSync('$T/.claude/agents/maker.md','utf8'), x=fs.readFileSync('$T/.codex/hooks.json','utf8');
process.exit(/telemetry\.mjs/.test(k) && /PostToolUse:[\s\S]*telemetry\.mjs/.test(c) && /PostToolUse/.test(x) ? 0 : 1);
"; expect "all generated runtimes route tool events through the same redacting adapter" $?
node -e "
const fs=require('fs'); const p='$TR/.claude/agents/maker.md';
fs.writeFileSync(p, fs.readFileSync(p,'utf8').replace('name: maker','name: maker # hand-edited'));
"
node "$SCRIPTS/verify-harness.mjs" --target "$TR" --skip-baseline --quiet
node -e "
const r=require('$TR/trace/verify-report.json');
const f=r.findings.find(x=>x.id==='agent-generated-stale');
process.exit(f && f.evidence.includes('maker.md') ? 0 : 1);
"; expect "hand-editing a generated agent is caught — the runtimes must not diverge silently" $?
node "$SCRIPTS/gen-agents.mjs" --target "$TR" --runtime both >/dev/null
node "$SCRIPTS/verify-harness.mjs" --target "$TR" --skip-baseline --quiet
node -e "
const r=require('$TR/trace/verify-report.json');
process.exit(r.findings.some(f=>f.id==='agent-generated-stale') ? 1 : 0);
"; expect "regenerating from the manifest clears it" $?

step 33 "machine-readable output survives a pipe (the ~8 KB truncation class)"
# stdout on a pipe is async; process.exit() drops whatever has not flushed. Under ~8 KB nothing
# shows, so this hides until a report grows — which is exactly how it surfaced: aeron-demo's
# report crossed the pipe buffer and adoption-baseline started failing to parse its own input.
node -e "
const fs=require('fs'),path=require('path');
const dirs=['$SCRIPTS','$SCRIPTS/../templates/tree/loop'];
const bad=[];
for (const d of dirs) for (const f of fs.readdirSync(d).filter(x=>x.endsWith('.mjs'))) {
  const s=fs.readFileSync(path.join(d,f),'utf8');
  // console.log of a JSON payload with a process.exit close behind = truncatable on a pipe
  if (/console\.log\(JSON\.stringify[\s\S]{0,120}?process\.exit/.test(s)) bad.push(f);
}
if (bad.length) console.log('    ', bad.join(', '));
process.exit(bad.length?1:0);
"; expect "no shipped script writes JSON with console.log then exits — writeSync only" $?
# And prove it end to end on a report large enough to matter.
node -e "
const {spawnSync}=require('child_process');
const r=spawnSync(process.execPath,['$SCRIPTS/verify-harness.mjs','--target','$T2','--skip-baseline','--json'],
  {encoding:'utf8',maxBuffer:64e6});
try { const j=JSON.parse(r.stdout); process.exit(Array.isArray(j.findings)?0:1); }
catch(e){ console.log('     stdout was', (r.stdout||'').length, 'bytes:', e.message); process.exit(1); }
"; expect "a --json report read through spawnSync parses whole" $?

step 34 "multi-service collection: a service is a directory, and not every module is one"
# The registry the integration layer needs. Every assertion below encodes something a survey of
# seven real repos forced — see references/multi-service.md.
MS="$WORK/multiservice"; rm -rf "$MS"
mkdir -p "$MS/monorepo/svc-a/src/main/java/com/acme/deep/pkg" "$MS/monorepo/lib-b/src/main/java/com/acme" "$MS/scriptsvc"
printf '<project><modelVersion>4.0.0</modelVersion></project>' > "$MS/monorepo/svc-a/pom.xml"
printf 'package com.acme.deep.pkg;\npublic class App { public static void main(String[] a) {} }\n' \
  > "$MS/monorepo/svc-a/src/main/java/com/acme/deep/pkg/App.java"
printf '<project><packaging>jar</packaging></project>' > "$MS/monorepo/lib-b/pom.xml"
printf 'package com.acme;\npublic class Codec {}\n' > "$MS/monorepo/lib-b/src/main/java/com/acme/Codec.java"
printf 'import x from "y";\nconst s = http.createServer();\n' > "$MS/scriptsvc/server.js"
node "$SCRIPTS/collect-services.mjs" --roots "$MS/monorepo","$MS/scriptsvc" --out "$MS/services.manifest.json" >/dev/null
node -e "
const m=require('$MS/services.manifest.json');
const by=Object.fromEntries(m.services.map(s=>[s.id,s]));
const svcA=Object.values(by).find(s=>/svc-a/.test(s.id));
const libB=Object.values(by).find(s=>/lib-b/.test(s.id));
// one repo, two entries — the unit is a directory, not a repository
process.exit(svcA && libB && m.services.length>=3 ? 0 : 1);
"; expect "one repo with two modules yields two entries — the unit is a directory" $?
node -e "
const m=require('$MS/services.manifest.json');
const svcA=m.services.find(s=>/svc-a/.test(s.id)), libB=m.services.find(s=>/lib-b/.test(s.id));
// a main() 7 levels down must still be found — a shallow walk misclassified exactly this
process.exit(svcA.kind==='service' && libB.kind==='library' ? 0 : 1);
"; expect "a jar with no entry point is a library; a main() deep in a package tree is still found" $?
node -e "
const m=require('$MS/services.manifest.json');
const s=m.services.find(x=>/scriptsvc/.test(x.id));
// no manifest at all is a real shape: no build step, but a start command
process.exit(s && s.kind==='service' && s.build===null && /node server\.js/.test(s.start||'') ? 0 : 1);
"; expect "a service with no build manifest gets build=null and a real start command" $?
node -e "
const m=require('$MS/services.manifest.json');
// health and dependsOn are never guessed — a fabricated health check makes the env report ready
process.exit(m.services.every(s=>s.health===null && s.dependsOn===null) ? 0 : 1);
"; expect "health and dependsOn are left for a human, never invented" $?
node -e "
const m=require('$MS/services.manifest.json');
// an absent image is reported as absent, not filled in with something plausible
process.exit(m.services.every(s=>s.image===null) ? 0 : 1);
"; expect "no Dockerfile means image=null — prerequisite work, not a blank to invent" $?

step 35 "k8s: a chart in the repo installs the cluster layer, and both runtimes get the same MCP"
K8T="$WORK/k8s-auto"; rm -rf "$K8T"; mkdir -p "$K8T/charts/svc"
printf 'apiVersion: v2\nname: svc\nversion: 0.1.0\n' > "$K8T/charts/svc/Chart.yaml"
node "$SCRIPTS/setup-harness-loop.mjs" --target "$K8T" --name "K8s Demo" --purpose "chart-shaped" >/dev/null
test -x "$K8T/tools/k8s-test-env.sh"; expect "a Chart.yaml is enough — --k8s auto installs the cluster tooling with the scaffold" $?
test -f "$K8T/.claude/agents/k8s-integration-tester.md" -a -f "$K8T/.kiro/agents/k8s-integration-tester.json"
expect "the optional agent appears in BOTH runtimes, from the prompt file's presence alone" $?
node -e "
const a=require('$K8T/.mcp.json').mcpServers, b=require('$K8T/.kiro/settings/mcp.json').mcpServers;
const ka=Object.keys(a).sort().join(','), kb=Object.keys(b).sort().join(',');
process.exit(ka===kb && ka==='k8s-readonly' && a['k8s-readonly'].type==='stdio' ? 0 : 1);
"; expect "one source, two files: Claude Code and kiro see the identical read-only cluster server" $?
NOK8="$WORK/k8s-none"; rm -rf "$NOK8"; mkdir -p "$NOK8"
node "$SCRIPTS/setup-harness-loop.mjs" --target "$NOK8" --name "Plain" --purpose "no chart" >/dev/null
test ! -e "$NOK8/tools/k8s-test-env.sh"; expect "no chart, no cluster layer — auto-detect does not push k8s onto projects that do not deploy that way" $?
# Now break it the way a real repo breaks: chart kept, layer never installed (the old manual copy).
rm -f "$K8T/tools/k8s-test-env.sh"
node -e "require('fs').writeFileSync('$K8T/.mcp.json', JSON.stringify({mcpServers:{}},null,2))"
node "$SCRIPTS/verify-harness.mjs" --target "$K8T" --skip-baseline --quiet
node -e "
const r=require('$K8T/trace/verify-report.json');
process.exit(r.findings.some(f=>f.id==='k8s-agent-missing') ? 0 : 1);
"; expect "a repo that ships a chart and verifies nothing against a cluster is flagged, not assumed fine" $?
node -e "
const r=require('$K8T/trace/verify-report.json');
const f=r.findings.find(f=>f.id==='mcp-runtime-skew');
// names the server AND which runtimes are missing it — with three runtimes, "one of them differs"
// is not actionable on its own
process.exit(f && /k8s-readonly \(missing from claude\)/.test(f.evidence||'') ? 0 : 1);
"; expect "an MCP server present for some runtimes and not others is caught, naming which — same agent, two verdicts" $?

step 36 "multi-service k8s: dependsOn order, health that is not 'Running', ranked diagnostics"
MS="$WORK/multi-svc"; rm -rf "$MS"; mkdir -p "$MS/tools" "$MS/charts/api" "$MS/charts/db" "$MS/charts/cache" "$MS/stub"
cp "$SCRIPTS/../templates/k8s/tools/k8s-test-env.sh" "$MS/tools/"; chmod +x "$MS/tools/k8s-test-env.sh"
cat > "$MS/services.manifest.json" <<'JSON'
{"services":[
 {"id":"api","kind":"service","chart":"charts/api","dependsOn":["db","cache"],"health":"true"},
 {"id":"db","kind":"service","chart":"charts/db","dependsOn":[],"health":"true"},
 {"id":"cache","kind":"service","chart":"charts/cache","dependsOn":["db"],"health":null},
 {"id":"shared","kind":"library","chart":null,"dependsOn":[],"health":null}
]}
JSON
# Stub the cluster. What is under test is the ORDER and the RANKING, neither of which needs a
# real Kubernetes to be wrong — and a demo that silently skips without one proves nothing.
cat > "$MS/stub/kubectl" <<'EOF'
#!/usr/bin/env bash
case "$1 $2" in
  "get pods") echo "" ;;
  *) : ;;
esac
exit 0
EOF
cat > "$MS/stub/helm" <<'EOF'
#!/usr/bin/env bash
# helm upgrade --install <release> <chart> ...
echo "$3" >> "$ORDER_FILE"
[ "$3" = "${HELM_FAIL_ON:-}" ] && exit 1
exit 0
EOF
chmod +x "$MS/stub/kubectl" "$MS/stub/helm"
ORDER="$MS/order.txt"; : > "$ORDER"
( cd "$MS" && PATH="$MS/stub:$PATH" ORDER_FILE="$ORDER" bash tools/k8s-test-env.sh --services services.manifest.json -- true ) >"$MS/run1.log" 2>&1
test "$(tr '\n' ' ' < "$ORDER")" = "db cache api "
expect "installs in dependsOn order — db, then cache, then the api that needs both" $?
grep -q "cache: no health command in the registry — readiness UNVERIFIED" "$MS/run1.log"
expect "a service with no health command is reported unverified, not assumed healthy because helm --wait returned" $?
grep -q "environment up: db, cache, api" "$MS/run1.log"; expect "the test command runs only once every service is up" $?
# Now fail the last service and check the report ranks by likely cause, not by pod name.
: > "$ORDER"
( cd "$MS" && PATH="$MS/stub:$PATH" ORDER_FILE="$ORDER" HELM_FAIL_ON=api bash tools/k8s-test-env.sh \
    --services services.manifest.json --keep-on-failure -- true ) >"$MS/run2.log" 2>&1
RPT="$(ls -d "$MS"/trace/k8s-test/*/ 2>/dev/null | tail -1)"
node -e "
const m=require('${RPT}journey-metrics.json');
process.exit(m.schema==='business-journey-telemetry/1' && Number.isFinite(m.deploymentDurationMs) &&
  m.payloads==='redacted' && m.exitCode===1 && !JSON.stringify(m).includes('HELM_FAIL_ON') ? 0 : 1);
"; expect "the environment records redacted deployment/readiness/scenario telemetry even on failure" $?
node -e "
const fs=require('fs'); const t=fs.readFileSync('${RPT}READ-THIS-FIRST.txt','utf8');
const iApi=t.indexOf('logs-api'), iDb=t.indexOf('logs-db'), iCache=t.indexOf('logs-cache');
// the failing service first, then what it was waiting on — five services down produce five walls
// of logs and only this ordering turns them into a diagnosis
process.exit(iApi>=0 && iDb>iApi && iCache>iApi && /Failed at: api/.test(t) ? 0 : 1);
"; expect "on failure the report ranks the failing service first, then its dependencies" $?
node -e "
const m=require('$MS/services.manifest.json');
process.exit(m.services.some(s=>s.kind==='library') ? 0 : 1)
"; expect "kind=library entries are in the registry but never in the install plan" $?
( cd "$MS" && PATH="$MS/stub:$PATH" ORDER_FILE="$ORDER" node -e "
const fs=require('fs'); const m=JSON.parse(fs.readFileSync('services.manifest.json','utf8'));
m.services.find(s=>s.id==='db').dependsOn=['api']; fs.writeFileSync('cycle.json',JSON.stringify(m));
" && PATH="$MS/stub:$PATH" bash tools/k8s-test-env.sh --services cycle.json -- true ) >"$MS/run3.log" 2>&1
CYC=$?
test "$CYC" = "2" && grep -q "cycle among" "$MS/run3.log"
expect "a dependsOn cycle is refused with the cycle named, not resolved arbitrarily" $?
grep -q "nothing was deployed\|cycle among" "$MS/run3.log"; expect "and nothing is deployed before the plan is known to be satisfiable" $?

# The prompt is the agent's only instruction sheet, and it drifts silently: this exact case was a
# prompt telling the agent to fill in three config variables the script no longer had.
PV="$WORK/promptvar"; rm -rf "$PV"; mkdir -p "$PV/prompts" "$PV/tools"
cp "$SCRIPTS/../templates/k8s/tools/k8s-test-env.sh" "$PV/tools/"
printf '# t\n\nFill `tools/k8s-test-env.sh`'"'"'s `NAMESPACE_LABEL_SELECTOR_FOR_READINESS` and `DEPLOY_TIMEOUT_S`.\n' > "$PV/prompts/p.md"
node "$SCRIPTS/verify-harness.mjs" --target "$PV" --skip-baseline --quiet
node -e "
const r=require('$PV/trace/verify-report.json');
const f=r.findings.find(x=>x.id==='prompt-cites-missing-var');
// and only the missing one: DEPLOY_TIMEOUT_S is real, flagging it would train people to ignore this
process.exit(f && /NAMESPACE_LABEL_SELECTOR/.test(f.evidence) && !/DEPLOY_TIMEOUT_S/.test(f.evidence) ? 0 : 1);
"; expect "a prompt naming a config variable its script does not define is caught — and the real one is not" $?

step 37 "integration target: the registry becomes a design doc and a gate that can be red"
IT="$WORK/integ"; rm -rf "$IT"; mkdir -p "$IT"
cat > "$WORK/reg.json" <<'JSON'
{"services":[
 {"id":"api","kind":"service","chart":"charts/api","dependsOn":["db"],"health":null,"image":null},
 {"id":"db","kind":"service","chart":"charts/db","dependsOn":[],"health":"pg_isready","image":{"dockerfiles":["Dockerfile"]}},
 {"id":"shared","kind":"library","chart":null,"dependsOn":[],"health":null,"image":null}
]}
JSON
node "$SCRIPTS/setup-harness-loop.mjs" --target "$IT" --name "SIT" --purpose "cross-service" --integration "$WORK/reg.json" >/dev/null 2>&1
test -x "$IT/tools/k8s-test-env.sh"; expect "--integration forces the cluster layer on — the charts live in the service repos, not here" $?
test -f "$IT/skills/business-journey/SKILL.md" -a -f "$IT/business-environment.json"
expect "an integration target receives the business-journey capability and environment contract" $?
test -f "$IT/skills/quality-strategy/SKILL.md" -a -f "$IT/skills/quality-strategy/scripts/check-quality-strategy.mjs"
expect "an integration target receives risk-to-oracle and scope-size capability machinery" $?
mv "$IT/skills/business-journey/SKILL.md" "$IT/skills/business-journey/SKILL.md.off"
node "$SCRIPTS/verify-harness.mjs" --target "$IT" --skip-baseline --quiet --report "$IT/business-capability-missing.json" >/dev/null 2>&1 || true
node -e "
const r=require('$IT/business-capability-missing.json');
process.exit(r.findings.some(f=>f.id==='capability-pack-missing' && f.layer==='harness') ? 0 : 1);
"; expect "an integration registry with no business-journey capability is a harness defect, not a silent omission" $?
mv "$IT/skills/business-journey/SKILL.md.off" "$IT/skills/business-journey/SKILL.md"
( cd "$IT" && node skills/business-journey/scripts/check-business-journey.mjs --environment business-environment.json --oracles business-oracles >/dev/null 2>&1 ); test "$?" = "1"
expect "the business journey gate starts RED while public seed/readiness and a distributed oracle are unanswered" $?
node -e "
const fs=require('fs'),root='$IT';
const e=require(root+'/business-environment.json');
e.seed={command:'journey-driver seed-account --run-id \${HARNESS_RUN_ID}',publicBoundary:true};
e.readiness.businessConditions=['reference data loaded','matching session open','event consumers joined'];
fs.writeFileSync(root+'/business-environment.json',JSON.stringify(e,null,2)+'\n');
const o={schema:'journey-oracle/1',id:'JRN-ORDER-MATCH',requirement:'REQ-ORDER-001',
 publicInput:{protocol:'FIX',operation:'NewOrderSingle',correlationField:'ClOrdID'},
 observations:[{boundary:'trade-event',operation:'TradePublished',correlationField:'ClOrdID'},
  {boundary:'position-query-api',operation:'GET /positions',correlationField:'accountId'}],
 invariants:['exactly one execution id','filled plus remaining equals original quantity','positions balance across buyer and seller'],deadlineMs:30000,
 diagnostics:['namespace events','correlated gateway/risk/matching/trade/position logs'],
 faultProbe:{action:'restart matching pod after acknowledgement',repeatCommand:true,recoveryInvariant:'same ClOrdID creates no second execution'}};
fs.writeFileSync(root+'/business-oracles/order-match.json',JSON.stringify(o,null,2)+'\n');
"
( cd "$IT" && node skills/business-journey/scripts/check-business-journey.mjs --environment business-environment.json --oracles business-oracles >/dev/null 2>&1 ); test "$?" = "0"
expect "public correlated observations, isolation, convergence and idempotent recovery turn the business journey contract GREEN" $?
node "$IT/skills/business-journey/evals/run-fixtures.mjs" >/dev/null 2>&1
expect "the capability fixture accepts a valid journey and rejects database/sleep/incomplete-fault oracles" $?
node -e "
const t=require('fs').readFileSync('$IT/docs/services.md','utf8');
// the unanswered fields are as prominent as the known ones; a library is not a pile of gaps
process.exit(/\| \`api\` \| service \|.*needs-human/.test(t) && /\| \`shared\` \| library \| — \| — \| — \| — \|/.test(t) ? 0 : 1);
"; expect "the design doc marks unanswered fields per service, and does not manufacture gaps for libraries" $?
( cd "$IT" && node tools/services-check.mjs >/dev/null 2>&1 ); test "$?" = "1"
expect "the registry gate is RED while a deployable service has no health command — it is a verification, not a report" $?
node -e "
const f=require('$IT/feature_list.json').features.find(x=>x.id==='feat-registry');
process.exit(f && f.verification==='node tools/services-check.mjs' && f.kind==='prove' ? 0 : 1);
"; expect "and it is in scope as a feature, so the loop cannot pass it by talking about it" $?
( cd "$IT" && node -e "
const fs=require('fs'); const m=JSON.parse(fs.readFileSync('services.manifest.json','utf8'));
m.services.find(s=>s.id==='api').health='curl -sf http://api:8080/healthz';
m.services.find(s=>s.id==='api').image={dockerfiles:['Dockerfile']};
fs.writeFileSync('services.manifest.json', JSON.stringify(m,null,2));
" && node tools/services-check.mjs >/dev/null 2>&1 ); test "$?" = "0"
expect "answering the two open fields turns it green — the gate closes on answers, not on assertions" $?

step 38 "the baseline gate runs on Windows, and can actually go red"
WIN="$WORK/windows"; rm -rf "$WIN"; mkdir -p "$WIN"
node "$SCRIPTS/setup-harness-loop.mjs" --target "$WIN" --name "WinDemo" --purpose "cross-platform gate" >/dev/null
test -f "$WIN/init.mjs" -a -f "$WIN/init.sh" -a -f "$WIN/init.cmd"
expect "one gate, three entry points: init.mjs plus a wrapper for POSIX shells and one for cmd.exe" $?
node -e "
const fs=require('fs');
// The wrappers must stay wrappers. A second implementation of the gate is a second thing to drift,
// and it drifts toward whichever one the person making the change happens to run.
const sh=fs.readFileSync('$WIN/init.sh','utf8'), cmd=fs.readFileSync('$WIN/init.cmd','utf8');
const shLogic=sh.split('\n').filter(l=>l.trim() && !l.trim().startsWith('#')).length;
process.exit(/exec node .*init\.mjs/.test(sh) && /node .*init\.mjs/.test(cmd) && shLogic<=5 ? 0 : 1);
"; expect "both wrappers just exec init.mjs — no second copy of the verification logic" $?
# The bug this port found. The old bash gate wrote: has lint && { run lint; } || true
# The || true was meant to skip a script that does not exist. It cannot tell that apart from one
# that ran and failed, so a project with failing lint AND failing tests printed "Baseline green".
cat > "$WIN/package.json" <<'JSON'
{ "name":"wt","private":true,"scripts":{"lint":"node -e \"process.exit(1)\"","test":"node -e \"process.exit(0)\""} }
JSON
( cd "$WIN" && ./init.sh >"$WIN/red.log" 2>&1 ); test "$?" = "1"
expect "a failing lint script turns the baseline RED — the gate the whole loop depends on can fail" $?
grep -q "Baseline is RED" "$WIN/red.log"; expect "and it names the command that failed instead of just exiting" $?
node -e "
const fs=require('fs'); const p='$WIN/package.json';
const j=JSON.parse(fs.readFileSync(p,'utf8')); j.scripts.lint='node -e \"process.exit(0)\"';
fs.writeFileSync(p, JSON.stringify(j));
"
( cd "$WIN" && ./init.sh >/dev/null 2>&1 ); test "$?" = "0"
expect "with every script passing it is green — 'can go red' is not 'always red'" $?
# A script that is ABSENT must still be skipped, which is what the || true was there for.
node -e "
const fs=require('fs'); const p='$WIN/package.json';
const j=JSON.parse(fs.readFileSync(p,'utf8')); delete j.scripts.lint; delete j.scripts.test;
fs.writeFileSync(p, JSON.stringify(j));
"
( cd "$WIN" && ./init.sh >/dev/null 2>&1 ); test "$?" = "0"
expect "a package.json with no lint or test script is still green — absent and failing stay different" $?
# Exercise the win32 branches for real rather than trusting that they were written.
cat > "$WORK/aswin.mjs" <<'EOF'
Object.defineProperty(process, "platform", { value: "win32" });
await import(process.argv[2]);
EOF
# Output to a file, then grep it. This script runs under `set -o pipefail`, so piping straight into
# grep returns CHECK-COVERAGE's exit code — which is non-zero exactly when the lesson we want to see
# fail does fail. The assertion would have been measuring the wrong process.
node "$WORK/aswin.mjs" "$SCRIPTS/check-coverage.mjs" --target "$WIN" >"$WORK/win-cov.log" 2>&1
grep -q "PASS  L6" "$WORK/win-cov.log"
expect "under win32 the coverage check passes on init.cmd, not on a POSIX exec bit that cannot exist there" $?
mv "$WIN/init.cmd" "$WIN/init.cmd.off"
node "$WORK/aswin.mjs" "$SCRIPTS/check-coverage.mjs" --target "$WIN" >"$WORK/win-cov2.log" 2>&1
grep -q "init.cmd missing" "$WORK/win-cov2.log"
expect "and without init.cmd it fails, because cmd.exe cannot run a .sh at all" $?
mv "$WIN/init.cmd.off" "$WIN/init.cmd"
node -e "
// verify-harness must not invoke the gate as ./init.sh: cmd.exe cannot, and the run would report
// 'could not execute' rather than a verdict about the project.
const src=require('fs').readFileSync('$SCRIPTS/verify-harness.mjs','utf8');
process.exit(/runCmd\(\`\"\\\$\{process\.execPath\}\" init\.mjs\`\)/.test(src) ? 0 : 1);
"; expect "verify-harness runs the gate through node, not through a POSIX shell invocation" $?
# Targets scaffolded before the port keep their old init.sh — setup never overwrites. Find them.
LEG="$WORK/legacy-init"; rm -rf "$LEG"; mkdir -p "$LEG"
node "$SCRIPTS/setup-harness-loop.mjs" --target "$LEG" --name "Legacy" --purpose "pre-port" >/dev/null
rm -f "$LEG/init.mjs"
printf '#!/usr/bin/env bash\nset -euo pipefail\nhas test && { npm test; } || true\n' > "$LEG/init.sh"
node "$SCRIPTS/verify-harness.mjs" --target "$LEG" --skip-baseline --quiet
node -e "
const r=require('$LEG/trace/verify-report.json');
const f=r.findings.find(x=>x.id==='init-swallows-failure');
process.exit(f && f.severity==='blocker' ? 0 : 1);
"; expect "a target still on the old bash gate is flagged as a blocker, since setup will not overwrite it" $?

# hasAgent knew two runtimes. On a codex-only target every agent rule evaluated false and the
# router fell through to `human` with work plainly available.
CO="$WORK/codex-only"; rm -rf "$CO"; mkdir -p "$CO"
node "$SCRIPTS/setup-harness-loop.mjs" --target "$CO" --name "CodexOnly" --purpose "one runtime" --runtime codex >/dev/null
test ! -d "$CO/.kiro/agents" -a ! -d "$CO/.claude/agents" -a -d "$CO/.codex/agents"
expect "a codex-only target really has only the codex agent directory" $?
( cd "$CO" && node loop/route.mjs --json > "$CO/route.json" 2>/dev/null )
node -e "
const r=require('$CO/route.json');
process.exit(r.kind==='agent' && r.node!=='human' ? 0 : 1);
"; expect "and the router still names an agent node there instead of escalating to a human" $?

# The router is the one file every agent loads, every session. "Keep this file short" was prose,
# which is the weakest enforcement there is.
RB="$WORK/router"; rm -rf "$RB"; mkdir -p "$RB"
node "$SCRIPTS/setup-harness-loop.mjs" --target "$RB" --name "Router" --purpose "brevity" >/dev/null
node -e "
const t=require('fs').readFileSync('$RB/AGENTS.md','utf8');
const n=t.split('\n').length;
// leverage points first, and the writing rule that reaches all ten agents through one file
// Match the meaning, not the phrasing — these broke once on a rewording that improved the file.
process.exit(n<=150 && /The six that carry everything/.test(t) && /## How you write/.test(t)
             && /first line is the point/i.test(t) ? 0 : 1);
"; expect "the scaffolded router is inside budget and states the leverage points before the detail" $?
node -e "
const {execFileSync}=require('child_process');
const man=require('$RB/agents.manifest.json');
const all=man.agents.length;
const load=man.agents.filter(a=>(a.resources||[]).includes('AGENTS.md')).length;
// one rule, every agent, all three runtimes — that is why it lives here and not in ten prompts
process.exit(load===all && all>0 ? 0 : 1);
"; expect "every agent loads it, so the writing rule reaches all of them from one place" $?
node "$SCRIPTS/verify-harness.mjs" --target "$RB" --skip-baseline --quiet
node -e "
const r=require('$RB/trace/verify-report.json');
process.exit(r.findings.some(f=>/^router-/.test(f.id)) ? 1 : 0);
"; expect "and a fresh scaffold trips neither router gate" $?
node -e "
const fs=require('fs');
fs.appendFileSync('$RB/AGENTS.md', '\n'+Array(40).fill('padding line').join('\n'));
"
node "$SCRIPTS/verify-harness.mjs" --target "$RB" --skip-baseline --quiet
node -e "
const r=require('$RB/trace/verify-report.json');
process.exit(r.findings.some(f=>f.id==='router-bloated') ? 0 : 1);
"; expect "a router that grows past its budget is flagged — brevity is measured, not requested" $?
node -e "
const fs=require('fs'); const p='$RB/AGENTS.md';
fs.writeFileSync(p, fs.readFileSync(p,'utf8').replace(/## How you write[\s\S]*?(?=\n## )/, ''));
"
node "$SCRIPTS/verify-harness.mjs" --target "$RB" --skip-baseline --quiet
node -e "
const r=require('$RB/trace/verify-report.json');
process.exit(r.findings.some(f=>f.id==='router-no-writing-rule') ? 0 : 1);
"; expect "deleting the writing rule is caught, not silently tolerated" $?

# The designer answers a NEEDS DESIGN: question but may not write feature_list.json — it is
# forbidden to write scope — so it cannot clear the marker that asked. Observed live on aeron-demo:
# the designer settled feat-sit-2 in DECISIONS.md, and the router named the designer again, forever.
MK="$WORK/marker"; rm -rf "$MK"; mkdir -p "$MK/docs/design"
node "$SCRIPTS/setup-harness-loop.mjs" --target "$MK" --name "Marker" --purpose "stale markers" >/dev/null
# The spec layer is deeper than design, so a scaffold's own needs-human row would answer every
# route_of() below. Retire it first: this fixture is about the design→decomposition handoff.
node -e "
const fs=require('fs'); const p='$MK/docs/assumptions.md';
fs.writeFileSync(p, fs.readFileSync(p,'utf8').replace(/needs-human/g, 'verified'));
"
node -e "
const fs=require('fs'); const p='$MK/feature_list.json';
const d=JSON.parse(fs.readFileSync(p,'utf8'));
d.features.push({id:'feat-q',name:'q',kind:'build',behavior:'b',verification:'echo hi',
  falsifier:'wrong [INV-Q-1]',dependencies:[],status:'not-started',readyForCheck:false,evidence:'',
  checkerNotes:'NEEDS DESIGN: which of two readings is this feature?',attempts:0,maxAttempts:3});
fs.writeFileSync(p, JSON.stringify(d,null,2));
"
route_of(){ (cd "$MK" && node loop/route.mjs --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).node))'); }
# The dispatcher logs what it ran; the router reads that back. Simulate a dispatch.
dispatched(){ (cd "$MK" && node loop/route.mjs --json | node -e '
  let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);
  if(j.hash||j.requestId) require("fs").appendFileSync("loop/route-log.jsonl",
    JSON.stringify({node:j.node,feature:j.feature||null,hash:j.hash||null,requestId:j.requestId||null})+"\n");});'); }
[ "$(route_of)" = "designer" ]; expect "a NEEDS DESIGN: marker the designer has not seen routes to the designer" $?
dispatched
# The designer answers but CANNOT clear the marker — it may not write feature_list.json.
[ "$(route_of)" = "feature-planner" ]; expect "after the designer's turn the same marker routes to the planner, the only node that may clear it" $?
# Appending evidence below the marker is not a new request. Previously the whole notes body was
# hashed, so this restarted the ladder at designer.
node -e "const fs=require('fs'),p='$MK/feature_list.json',d=JSON.parse(fs.readFileSync(p));d.features.find(x=>x.id==='feat-q').checkerNotes+='\nextra diagnostic';fs.writeFileSync(p,JSON.stringify(d,null,2))"
[ "$(route_of)" = "feature-planner" ]; expect "appending diagnostics does not change the first-line routing request identity" $?
( cd "$MK" && node loop/route.mjs --json ) | grep -q "clear the marker"
expect "and the reason says so, rather than leaving it to be inferred" $?
dispatched
[ "$(route_of)" = "human" ]; expect "with both turns spent and the marker unchanged it escalates instead of cycling" $?
# A NEW question on the same feature is a new marker: different text, different hash, ladder resets.
# The first fix keyed on "a design doc mentions this feature", which could not tell the two apart
# and escalated a live question to a human.
node -e "
const fs=require('fs'); const p='$MK/feature_list.json';
const d=JSON.parse(fs.readFileSync(p,'utf8'));
d.features.find(x=>x.id==='feat-q').checkerNotes='NEEDS DESIGN: a different question entirely';
fs.writeFileSync(p, JSON.stringify(d,null,2));
"
[ "$(route_of)" = "designer" ]; expect "a NEW question on the same feature restarts the ladder at the designer" $?
node -e "
const fs=require('fs'); const p='$MK/feature_list.json';
const d=JSON.parse(fs.readFileSync(p,'utf8'));
d.features.find(x=>x.id==='feat-q').checkerNotes='resolved: first reading, see docs/design/q.md';
fs.writeFileSync(p, JSON.stringify(d,null,2));
"
[ "$(route_of)" != "designer" ] && [ "$(route_of)" != "human" ]; expect "clearing the marker returns the loop to ordinary routing" $?

# Re-plan uses the same finite request ladder: one planner turn, then human if the typed request is
# unchanged instead of an unbounded paid-session loop.
node -e "const fs=require('fs'),p='$MK/feature_list.json',d=JSON.parse(fs.readFileSync(p));d.features.find(x=>x.id==='feat-q').checkerNotes='NEEDS RE-PLAN: split the behavior';fs.writeFileSync(p,JSON.stringify(d,null,2))"
[ "$(route_of)" = "feature-planner" ]; expect "a new re-plan request routes to the planner" $?
dispatched
[ "$(route_of)" = "human" ]; expect "an unchanged re-plan request escalates after one planner turn" $?
node -e "const fs=require('fs'),p='$MK/feature_list.json',d=JSON.parse(fs.readFileSync(p));d.features.find(x=>x.id==='feat-q').checkerNotes='resolved';fs.writeFileSync(p,JSON.stringify(d,null,2))"

# Baseline failures are now router state. The dispatcher records the gate result instead of exiting
# outside the graph; one unchanged repair attempt is the bounded ceiling.
printf '{"schema":"baseline-state/1","status":"red","evidenceDigest":"deadbeef"}\n' > "$MK/loop/baseline-state.json"
[ "$(route_of)" = "maker" ]; expect "a red baseline routes to a bounded maker repair turn" $?
dispatched
[ "$(route_of)" = "human" ]; expect "an unchanged red baseline escalates instead of retrying forever" $?
printf '{"schema":"baseline-state/1","status":"green","evidenceDigest":"green"}\n' > "$MK/loop/baseline-state.json"

# Design review is a typed edge keyed by the design digest: unreviewed → reviewer, rejected →
# designer, unchanged after that bounded revision turn → human.
printf '# Design\n\nObservable seam: command output. Invariant: always preserves input identity.\n\n%s\n' "$(printf 'detail %.0s' {1..30})" > "$MK/docs/design/reviewed.md"
[ "$(route_of)" = "design-reviewer" ]; expect "an unreviewed design revision routes to the independent reviewer" $?
REVIEW_JSON="$(cd "$MK" && node loop/route.mjs --json)"; REVIEW_DIGEST="$(printf '%s' "$REVIEW_JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).detail))')"
printf '{"schema":"design-review/1","designDigest":"%s","revision":1,"status":"rejected","summary":"missing option","evidence":["docs/design/reviewed.md:1"]}\n' "$REVIEW_DIGEST" > "$MK/loop/design-review.json"
[ "$(route_of)" = "designer" ]; expect "a typed rejected review returns to the designer" $?
dispatched
[ "$(route_of)" = "human" ]; expect "an unchanged rejected revision escalates after its bounded designer turn" $?

# A loop you cannot watch is a loop you cannot correct. Early on the whole value is a human seeing
# where it goes wrong and fixing the harness; unattended is what you graduate to.
LS="$WORK/status"; rm -rf "$LS"; mkdir -p "$LS"
node "$SCRIPTS/setup-harness-loop.mjs" --target "$LS" --name "Status" --purpose "visibility" >/dev/null
test -f "$LS/tools/loop-status.mjs"; expect "every scaffold gets a live status view, not only the after-the-fact report" $?
node "$SCRIPTS/../scripts/loop-status.mjs" --target "$LS" --json > "$LS/st.json" 2>/dev/null
node -e "
const s=require('$LS/st.json');
// the question a human has mid-run: where is it, and where is it going next
process.exit(s.next && typeof s.features.total==='number' && Array.isArray(s.dispatched) ? 0 : 1);
"; expect "it answers where the loop is and what the router would do next" $?
mkdir -p "$LS/loop"
for i in 1 2 3 4; do echo '{"node":"designer","feature":"feat-x","hash":"abc"}' >> "$LS/loop/route-log.jsonl"; done
node "$SCRIPTS/../scripts/loop-status.mjs" --target "$LS" 2>/dev/null | grep -q "livelock"
expect "four identical dispatches in a row are called a livelock, in the view a human is already reading" $?
node -e "
const fs=require('fs');
fs.writeFileSync('$LS/loop/current.json', JSON.stringify({node:'maker',feature:'feat-x',iteration:2,startedAt:Date.now()-90000}));
"
node "$SCRIPTS/../scripts/loop-status.mjs" --target "$LS" 2>/dev/null | grep -qE "RUNNING +maker on feat-x +1m30s"
expect "an in-flight agent shows what it is, on what, and for how long" $?
# Attended by default, and it must never block where nobody can answer.
grep -q 'ATTENDED="${HARNESS_ATTENDED:-1}"' "$LS/loop/run-loop.sh"
expect "the loop is attended by default — unattended is the thing you graduate to" $?
( cd "$LS" && HARNESS_RUNTIME=kiro bash loop/run-loop.sh 1 < /dev/null 2>&1 | head -2 ) > "$LS/notty.log"
grep -q "no TTY on stdin — running headless" "$LS/notty.log"
expect "with no TTY it falls back to headless and says so, instead of blocking on a prompt nobody can answer" $?
( cd "$LS" && bash -x loop/run-loop.sh --headless 2>&1 | grep -m1 "ITERATIONS=" ) > "$LS/args.log" 2>&1
grep -q "ITERATIONS=1" "$LS/args.log"
expect "a leading --headless is not mistaken for an iteration count" $?

# The front door. A deterministic router is only reviewable if an LLM cannot quietly route around
# it, so the orchestrator's safety is two mechanical constraints, not two sentences in a prompt.
OR="$WORK/orch"; rm -rf "$OR"; mkdir -p "$OR"
node "$SCRIPTS/setup-harness-loop.mjs" --target "$OR" --name "Orch" --purpose "front door" >/dev/null
test -f "$OR/.kiro/agents/orchestrator.json" -a -f "$OR/.claude/agents/orchestrator.md" -a -f "$OR/.codex/agents/orchestrator.toml"
expect "the orchestrator is generated for all three runtimes from the one manifest" $?
node -e "
const {execFileSync}=require('child_process');
const run=(f)=>JSON.parse(execFileSync('node',['tools/guard-write.mjs','orchestrator'],
  {cwd:'$OR',input:JSON.stringify({tool_input:{file_path:f}}),encoding:'utf8'}))
  .hookSpecificOutput.permissionDecision;
// it dispatches; the agents it dispatches are the ones that write
process.exit(run('src/Foo.java')==='deny' && run('feature_list.json')==='deny' &&
             run('docs/design/x.md')==='deny' && run('session-handoff.md')==='allow' ? 0 : 1);
"; expect "it cannot write source, scope or design — only the handoff files it needs to talk to a human" $?
grep -q "orchestrator" "$OR/loop/route.mjs" && ORROUTE=1 || ORROUTE=0
test "$ORROUTE" = "0"; expect "route.mjs never dispatches it — it is the node that READS the router, not one the loop can recurse into" $?
node "$SCRIPTS/verify-harness.mjs" --target "$OR" --skip-baseline --quiet
node -e "
const r=require('$OR/trace/verify-report.json');
const f=r.findings.find(x=>x.id==='agent-unrouted');
// unreachable from route.mjs on purpose, so AGENTS.md naming it is what keeps it discoverable
process.exit(f && /orchestrator/.test(f.evidence||'') ? 1 : 0);
"; expect "and it is still not 'unrouted', because AGENTS.md names it as the default role" $?
node -e "
const t=require('fs').readFileSync('$OR/prompts/orchestrator.md','utf8').replace(/\s+/g,' ');
process.exit(/You do not choose the next node/.test(t) && /harness defect, not an override/.test(t)
             && /Never answer it yourself/.test(t) ? 0 : 1);
"; expect "its prompt forbids choosing a node, overriding the router, and answering the human's question for them" $?
# A prohibition SECTION is a normal prompt shape — the orchestrator's whole safety case is a list of
# things it may not write. The gate read the heading's negation as an instruction and flagged it,
# which is how a gate teaches people to ignore it.
node -e "
const r=require('$OR/trace/verify-report.json');
process.exit(r.findings.some(f=>/agent-cannot-write-instructed:orchestrator/.test(f.id)) ? 1 : 0);
"; expect "a 'What you must not do' section is not read as an instruction to write those files" $?
node -e "
const fs=require('fs');
fs.appendFileSync('$OR/prompts/orchestrator.md', '\n## Extra duties\n\nAlways update \`feature_list.json\` with the outcome.\n');
"
node "$SCRIPTS/verify-harness.mjs" --target "$OR" --skip-baseline --quiet
node -e "
const r=require('$OR/trace/verify-report.json');
process.exit(r.findings.some(f=>/agent-cannot-write-instructed:orchestrator/.test(f.id)) ? 0 : 1);
"; expect "but a real instruction to write a file it cannot write is still caught" $?

# Presenting and proposing are two skills, not one. Mixing them gives you a wall of status with a
# question buried in it, which a human answers late or not at all.
test -f "$OR/docs/reference/presenting-and-proposing.md"
expect "the craft doc ships into the target, so the technique is in the repo and not in a prompt only" $?
node -e "
const {execFileSync}=require('child_process');
const out=JSON.parse(execFileSync('node',['tools/agent-context.mjs','orchestrator'],
  {cwd:'$OR',input:'{}',encoding:'utf8'}));
const t=out.hookSpecificOutput.additionalContext;
process.exit(/presenting-and-proposing/.test(t) && !/MISSING/.test(t) ? 0 : 1);
"; expect "and it is injected at spawn, so the orchestrator starts holding it" $?
node -e "
// Normalise whitespace first: these are wrapped prose files, and a phrase that happens to
// straddle a line break is not a missing phrase. A line-based grep here reports the wrong thing.
const t=require('fs').readFileSync('$OR/prompts/orchestrator.md','utf8').replace(/\s+/g,' ');
// presenting: answer-first, and the three questions a human actually has mid-run
process.exit(/answer-first/i.test(t) && /is it moving/i.test(t) && /delta/i.test(t) &&
             /do you need me/i.test(t) && /Suppress the routine/i.test(t) ? 0 : 1);
"; expect "presenting is answer-first with the delta, the next node, and 'do you need me'" $?
node -e "
const t=require('fs').readFileSync('$OR/prompts/orchestrator.md','utf8').replace(/\s+/g,' ');
// proposing: reversibility decides how much attention the decision has earned
process.exit(/two-way door/i.test(t) && /one-way door/i.test(t) && /what it forecloses/i.test(t) &&
             /strongest argument against/i.test(t) ? 0 : 1);
"; expect "proposing sorts by reversibility, and a one-way door must name what it forecloses and the case against" $?
node -e "
const t=require('fs').readFileSync('$OR/prompts/orchestrator.md','utf8').replace(/\s+/g,' ');
// the three rules that keep a proposal from becoming advocacy or a stall
process.exit(/State your default/i.test(t) && /Record it, do not only say it/i.test(t) &&
             /Never answer it yourself/i.test(t) ? 0 : 1);
"; expect "it states a default for silence, records the decision, and still never answers it itself" $?
node -e "
const d=require('fs').readFileSync('$OR/docs/reference/presenting-and-proposing.md','utf8');
// a worked bad-vs-good pair is what makes technique teachable rather than aspirational
process.exit(/## Worked example/.test(d) && /Bad —/.test(d) && /Good —/.test(d) ? 0 : 1);
"; expect "the craft doc carries a worked bad-vs-good example, not just principles" $?
node "$SCRIPTS/../scripts/context-budget.mjs" --target "$OR" > "$OR/budget.log" 2>&1
grep -q "0 agent(s) over budget" "$OR/budget.log"
expect "and the extra reading does not push any agent over its context budget" $?

# The pair to the digest: the digest is every feature in one line, this is one feature in full —
# so an agent never has to cat a thousand-line JSON to read fifteen lines of it.
FQ="$WORK/featq"; rm -rf "$FQ"; mkdir -p "$FQ"
node "$SCRIPTS/setup-harness-loop.mjs" --target "$FQ" --name "FeatQ" --purpose "queries" >/dev/null
test -f "$FQ/tools/feature.mjs"; expect "every scaffold ships the single-feature query" $?
node -e "
const {execFileSync}=require('child_process');
const j=JSON.parse(execFileSync('node',['tools/feature.mjs','feat-001','--json'],{cwd:'$FQ',encoding:'utf8'}));
process.exit(j.id==='feat-001' && j.verification ? 0 : 1);
"; expect "it returns one entry, whole, by id" $?
node -e "
const {execFileSync}=require('child_process');
const v=execFileSync('node',['tools/feature.mjs','feat-001','--field','verification'],{cwd:'$FQ',encoding:'utf8'}).trim();
// a maker that only needs the command should not pay for the entry, let alone the file
process.exit(v && !/\n/.test(v) ? 0 : 1);
"; expect "--field returns just that field, for the common case of wanting the command" $?
node -e "
const {execFileSync}=require('child_process');
const out=execFileSync('node',['tools/feature.mjs','--deps','feat-002'],{cwd:'$FQ',encoding:'utf8'});
process.exit(/eligible|not eligible/.test(out) ? 0 : 1);
"; expect "--deps answers eligibility instead of making the caller compare statuses by hand" $?
node -e "
const {execFileSync}=require('child_process');
let code=0, err='';
try { execFileSync('node',['tools/feature.mjs','feat001'],{cwd:'$FQ',encoding:'utf8',stdio:['pipe','pipe','pipe']}); }
catch(e){ code=e.status; err=String(e.stderr); }
// the typo people actually make is a separator, which a plain substring test misses
process.exit(code===1 && /Did you mean: feat-001/.test(err) ? 0 : 1);
"; expect "a mistyped id suggests the real one instead of sending you back to the file" $?
node -e "
const t=require('fs').readFileSync('$FQ/feature_list.digest.md','utf8');
// the digest is where an agent learns the command exists
process.exit(/tools\/feature\.mjs/.test(t) ? 0 : 1);
"; expect "and the digest itself points at it, so the cheap path is the discoverable one" $?

# The verification field demands a runnable command and never says where it may live, so the cheapest
# way to satisfy it is a one-off script. That passes every other gate and is not a test: no test run
# ever executes it again. The harness models the habit — most of its own machinery is .mjs.
VH="$WORK/vhome"; rm -rf "$VH"; mkdir -p "$VH"
node "$SCRIPTS/setup-harness-loop.mjs" --target "$VH" --name "VHome" --purpose "proof lives somewhere" >/dev/null
( cd "$VH" && git init -q . && git add -A && git -c user.email=a@b -c user.name=a commit -qm base ) >/dev/null 2>&1
node -e "
const fs=require('fs'); const p='$VH/feature_list.json'; const d=JSON.parse(fs.readFileSync(p,'utf8'));
const mk=(id,v)=>({id,name:id,kind:'prove',behavior:'b',verification:v,falsifier:'f',dependencies:[],
  status:'not-started',readyForCheck:false,evidence:'',checkerNotes:'',attempts:0,maxAttempts:3});
d.features.push(mk('feat-inline','node -e \"process.exit(0)\"'));
d.features.push(mk('feat-uncommitted','node verify-thing.mjs'));
d.features.push(mk('feat-rootscript','node scripts/check-it.mjs'));
d.features.push(mk('feat-realtool','node tools/services-check.mjs'));
d.features.push(mk('feat-mvn','./mvnw -q verify -Dtest=X'));
d.features.push(mk('feat-npm','npm test -- feature-x'));
fs.writeFileSync(p, JSON.stringify(d,null,2));
fs.mkdirSync('$VH/scripts',{recursive:true}); fs.writeFileSync('$VH/scripts/check-it.mjs','//x');
"
( cd "$VH" && git add -A && git -c user.email=a@b -c user.name=a commit -qm two ) >/dev/null 2>&1
node "$SCRIPTS/verify-harness.mjs" --target "$VH" --skip-baseline --quiet
node -e "
const r=require('$VH/trace/verify-report.json');
const f=r.findings.find(x=>x.id==='verification-outside-test-framework');
const ev=f?f.evidence:'';
process.exit(f && /feat-inline/.test(ev) && /feat-uncommitted/.test(ev) && /feat-rootscript/.test(ev) ? 0 : 1);
"; expect "an inline node -e, an uncommitted script, and a script outside tools/ are all flagged as homeless proof" $?
node -e "
const r=require('$VH/trace/verify-report.json');
const f=r.findings.find(x=>x.id==='verification-outside-test-framework');
const ev=f?f.evidence:'';
// the framework's own runners and maintained tools/ machinery must never be flagged, or the gate
// becomes noise on every real project
process.exit(!/feat-mvn|feat-npm|feat-realtool/.test(ev) ? 0 : 1);
"; expect "but mvnw, npm test and a committed tools/ script are not — the gate stays quiet on real proof" $?
node -e "
const t=require('fs').readFileSync('$VH/docs/testing-standards.md','utf8');
process.exit(/Where a verification lives/.test(t) && /smell that a level is missing/.test(t) ? 0 : 1);
"; expect "and testing-standards.md says why, so the rule is teachable and not just enforced" $?

# The orchestrator is told to hand a human's answer to the agent that owns that file — and could
# not: dispatch() was a private function inside run-loop.sh, which only ever runs the node the
# ROUTER named. Only Codex had a standalone path, so the gap was invisible on that runtime.
DP="$WORK/dispatch"; rm -rf "$DP"; mkdir -p "$DP/bin"
node "$SCRIPTS/setup-harness-loop.mjs" --target "$DP" --name "Disp" --purpose "named dispatch" >/dev/null
test -x "$DP/loop/dispatch.sh"; expect "every scaffold ships a runtime-agnostic way to dispatch one named agent" $?
printf '#!/usr/bin/env bash\necho "[stub] agent=$3" >&2\nexit 0\n' > "$DP/bin/kiro-cli"; chmod +x "$DP/bin/kiro-cli"
( cd "$DP" && PATH="$DP/bin:$PATH" KIRO_API_KEY=x HARNESS_RUNTIME=kiro bash loop/dispatch.sh designer "decided" ) > "$DP/d.log" 2>&1
grep -q "agent=designer" "$DP/d.log"; expect "it runs the agent the caller named, not the one the router would have picked" $?
( cd "$DP" && PATH="$DP/bin:$PATH" KIRO_API_KEY=x HARNESS_RUNTIME=kiro bash loop/dispatch.sh ghost "x" ) > "$DP/g.log" 2>&1
GC=$?; grep -q "no agent" "$DP/g.log" && [ "$GC" = "2" ]
expect "an agent that is not in the manifest is refused, rather than dispatched into nothing" $?
node -e "
const fs=require('fs');
// one implementation of 'how do I start an agent here'. Two copies is two things to drift, and the
// runtimes are exactly where drift is invisible.
const rl=fs.readFileSync('$DP/loop/run-loop.sh','utf8');
process.exit(/\. loop\/dispatch\.sh/.test(rl) && !/kiro-cli chat --agent/.test(rl) ? 0 : 1);
"; expect "run-loop.sh sources it instead of keeping a second copy of the runtime case statement" $?
node -e "
const t=require('fs').readFileSync('$DP/prompts/orchestrator.md','utf8').replace(/\s+/g,' ');
process.exit(/loop\/dispatch\.sh designer/.test(t) && /only when a human has already decided/.test(t) ? 0 : 1);
"; expect "and the orchestrator is told to use it only once a human has decided — the router still owns the rest" $?

# setup never overwrites, --force overwrites everything including the project's own work. Neither
# is an upgrade, so targets get hand-synced file by file — which is how one ended up with
# check-coverage.mjs at both the repo root and tools/, the stale copy shadowing the newer one.
UP="$WORK/upgrade"; rm -rf "$UP"; mkdir -p "$UP"
node "$SCRIPTS/setup-harness-loop.mjs" --target "$UP" --name "Aged" --purpose "upgrade path" >/dev/null
node "$SCRIPTS/upgrade-harness.mjs" --target "$UP" --dry-run --json > "$UP/fresh.json" 2>/dev/null
node -e "
const j=require('$UP/fresh.json');
// setup substitutes {{PROJECT_NAME}}: a byte comparison marks every prompt on a minute-old scaffold
// as customised, and a report nobody reads is worse than none
process.exit(j.changed.length===0 && j.added.length===0 && j.drifted.length===0 && j.same>0 ? 0 : 1);
"; expect "a freshly scaffolded target needs no upgrade and reports no drift" $?
# age it the way a real target ages
printf '#!/usr/bin/env bash\necho old\n' > "$UP/loop/route.mjs"
rm -f "$UP/loop/dispatch.sh" "$UP/tools/feature.mjs"
printf '\n<!-- this project: never touch the ledger -->\n' >> "$UP/prompts/designer.md"
node "$SCRIPTS/upgrade-harness.mjs" --target "$UP" --json > "$UP/aged.json" 2>/dev/null
node -e "
const j=require('$UP/aged.json');
process.exit(j.changed.includes('loop/route.mjs') && j.added.includes('loop/dispatch.sh')
  && j.added.includes('tools/feature.mjs') ? 0 : 1);
"; expect "stale machinery is refreshed and missing machinery is added" $?
node -e "
const j=require('$UP/aged.json');
// the customised prompt is REPORTED, never overwritten — merge, don't overwrite
process.exit(j.drifted.includes('prompts/designer.md') ? 0 : 1);
"; expect "a customised prompt is reported as drift, not silently replaced" $?
grep -q "never touch the ledger" "$UP/prompts/designer.md"
expect "and the customisation is still there afterwards" $?
node -e "
const fs=require('fs');
process.exit(fs.readFileSync('$UP/loop/route.mjs','utf8').includes('echo old') ? 1 : 0);
"; expect "while the ancient router really was replaced" $?
node -e "
const j=require('$UP/aged.json');
// generated files must be regenerated, or the refresh is only half applied
process.exit(j.regenerated.some(r=>/gen-agents/.test(r)) && j.regenerated.some(r=>/feature-digest/.test(r)) ? 0 : 1);
"; expect "and the generated agents and digest are rebuilt, so the refresh actually takes effect" $?

# Write confinement covered Edit|Write|NotebookEdit and not Bash, so a write-restricted role could
# still `cat > probe.mjs`. Observed for real: the checker leaving throwaway verification scripts.
SG="$WORK/shellguard"; rm -rf "$SG"; mkdir -p "$SG"
node "$SCRIPTS/setup-harness-loop.mjs" --target "$SG" --name "Guard" --purpose "shell writes" >/dev/null
node -e "
const {execFileSync}=require('child_process');
const run=(agent,cmd)=>JSON.parse(execFileSync('node',['tools/guard-write.mjs',agent],
  {cwd:'$SG',input:JSON.stringify({tool_name:'Bash',tool_input:{command:cmd}}),encoding:'utf8'}))
  .hookSpecificOutput.permissionDecision;
const cases=[
  ['checker','cat > probe.mjs','deny'],                    // the observed behaviour
  ['checker','echo x >> src/Foo.java','deny'],             // the thing confinement exists for
  ['checker','node t.mjs | tee report.mjs','deny'],
  ['checker','cp a.txt src/b.txt','deny'],
  ['checker','echo hi > ../escape.mjs','deny'],
  ['checker','cat > trace/scratch/p.mjs','allow'],         // the sanctioned probe home
  ['checker','./mvnw -q verify > /tmp/out.log','allow'],   // cannot touch the repo; denying it
  ['checker','ls -la > /dev/null','allow'],                //   teaches people to switch the guard off
  ['checker','./mvnw -q verify','allow'],
  ['maker','cat > src/Foo.java','allow'],                  // unrestricted BY DESIGN
];
for (const [a,c,want] of cases) {
  const got=run(a,c);
  if (got!==want) { console.error('  '+a+': '+c+' → '+got+', wanted '+want); process.exit(1); }
}
"; expect "the write guard covers shell redirects too — cat/tee/cp into the repo are denied, /tmp and the scratch dir are not" $?
node -e "
const fs=require('fs');
const md=fs.readFileSync('$SG/.claude/agents/checker.md','utf8');
process.exit(/matcher: \"Edit\|Write\|NotebookEdit\|Bash\"/.test(md) ? 0 : 1);
"; expect "and the generated hook actually matches Bash, not just the edit tools" $?
# Whatever slips past the guard still has to be visible afterwards.
( cd "$SG" && git init -q . && git add -A && git -c user.email=a@b -c user.name=a commit -qm base ) >/dev/null 2>&1
mkdir -p "$SG/trace/scratch"; echo "// probe" > "$SG/trace/scratch/ok.mjs"; echo "// probe" > "$SG/verify-thing.mjs"
node "$SCRIPTS/verify-harness.mjs" --target "$SG" --skip-baseline --quiet
node -e "
const r=require('$SG/trace/verify-report.json');
const f=r.findings.find(x=>x.id==='stray-verification-script');
process.exit(f && /verify-thing\.mjs/.test(f.evidence) && !/scratch/.test(f.evidence) ? 0 : 1);
"; expect "a stray script left in the tree is reported, while a probe in trace/scratch/ is not" $?
node -e "
const t=require('fs').readFileSync('$SG/loop/checker-prompt.md','utf8').replace(/\s+/g,' ');
// the impulse to probe is right; what matters is where it lives and that it does not become evidence
process.exit(/Probes live in .trace\/scratch/.test(t) && /Delete it, or promote it/.test(t)
  && /never the basis for approval/.test(t) ? 0 : 1);
"; expect "the checker is told where a probe may live, to delete or promote it, and never to approve on one" $?

# An agent that wants to know "what happens after me" had only one way to find out: read
# route.mjs's source. A designer did exactly that and wrote a parser for it — and so did I, twice,
# while building this. When the tool's author needs a throwaway script to answer a question about
# the tool, the affordance is missing.
RR="$WORK/rules"; rm -rf "$RR"; mkdir -p "$RR"
node "$SCRIPTS/setup-harness-loop.mjs" --target "$RR" --name "Rules" --purpose "routing table" >/dev/null
( cd "$RR" && node loop/route.mjs --rules ) > "$RR/rules.txt" 2>&1
node -e "
const t=require('fs').readFileSync('$RR/rules.txt','utf8');
// every rule, in order, each with the condition the source only implies
process.exit(/context-interviewer/.test(t) && /feature-planner/.test(t) && /test-implementer/.test(t)
  && /maker/.test(t) && /precedence order/.test(t) && /when /.test(t) ? 0 : 1);
"; expect "route.mjs --rules prints the whole routing table, so nothing has to parse its source" $?
node -e "
const {execFileSync}=require('child_process');
const rows=JSON.parse(execFileSync('node',['loop/route.mjs','--rules','--json'],{cwd:'$RR',encoding:'utf8'}));
process.exit(rows.length>=10 && rows.every(r=>r.node&&r.layer&&r.when&&r.when!=='—') ? 0 : 1);
"; expect "--json gives the same table machine-readably, and every rule states its condition" $?
node -e "
const t=require('fs').readFileSync('$RR/AGENTS.md','utf8').replace(/\s+/g,' ');
process.exit(/route\.mjs --rules/.test(t) && /never .{0,30}write a script to parse it/i.test(t) ? 0 : 1);
"; expect "and the router file points every agent at it, instead of leaving them to grep the source" $?
node -e "
const t=require('fs').readFileSync('$RR/AGENTS.md','utf8').replace(/\s+/g,' ');
// The other half of the same observation: an agent wanting ONE feature wrote
//   node -e 'require(\"./feature_list.json\").features.find(...)' — a thousand lines read to use
// fifteen. tools/feature.mjs existed by then; nothing an agent loads mentioned it.
process.exit(/tools\/feature\.mjs <id>/.test(t) && /(never|do not) write an inline script to filter/i.test(t) ? 0 : 1);
"; expect "and it names tools/feature.mjs too, so nobody writes an inline filter over feature_list.json" $?

# Cold start: a new session's first question is "what happened while I was away, and why did it
# stop?" The digest answers what is DONE. Nothing answered the other half — session-handoff.md
# exists precisely for it, and the orchestrator could WRITE it while never reading it.
CS="$WORK/coldstart"; rm -rf "$CS"; mkdir -p "$CS"
node "$SCRIPTS/setup-harness-loop.mjs" --target "$CS" --name "Cold" --purpose "catch up" >/dev/null
( cd "$CS" && git init -q . && git add -A && git -c user.email=a@b -c user.name=a commit -qm "first commit" ) >/dev/null 2>&1
node "$SCRIPTS/loop-status.mjs" --target "$CS" --json > "$CS/s1.json" 2>/dev/null
node -e "
const j=require('$CS/s1.json');
// an untouched handoff is the template's empty bullets — say 'nobody wrote one', do not print blanks
process.exit(j.since && j.since.commits.length===1 && j.since.handoff===null ? 0 : 1);
"; expect "a cold start sees recent commits, and an untouched handoff reports as empty rather than as content" $?
node -e "
const fs=require('fs');
fs.writeFileSync('$CS/session-handoff.md', '# Handoff\n\n## Current Objective\n\n- Goal: finish feat-x oracle\n- Current status: stopped on a schema question\n');
"
node "$SCRIPTS/loop-status.mjs" --target "$CS" --json > "$CS/s2.json" 2>/dev/null
node -e "
const j=require('$CS/s2.json');
process.exit(/stopped on a schema question/.test(j.since.handoff||'') && j.since.handoffStale===false ? 0 : 1);
"; expect "a written handoff is surfaced, and is not stale when it is newer than the last commit" $?
( cd "$CS" && git add -A && git -c user.email=a@b -c user.name=a commit -qm "work done after the handoff was written" ) >/dev/null 2>&1
( cd "$CS" && touch -t 202001010000 session-handoff.md )
node "$SCRIPTS/loop-status.mjs" --target "$CS" --json > "$CS/s3.json" 2>/dev/null
node -e "
const j=require('$CS/s3.json');
// a handoff older than the newest commit describes a session already overtaken — trusting it is
// how a new session picks up work that is already finished
process.exit(j.since.handoffStale===true ? 0 : 1);
"; expect "a handoff older than the last commit is flagged stale, not read as the current situation" $?
node "$SCRIPTS/loop-status.mjs" --target "$CS" 2>/dev/null | grep -q "since you were last here"
expect "and it all lands in the one screen the orchestrator is told to run before it speaks" $?

# "Ignore all the harness files" would break the harness: feature-field-lost compares against
# `git show HEAD:feature_list.json`, and progress/DECISIONS/memory ARE the cross-session memory.
# Three categories, and conflating them is the bug.
GI="$WORK/gitignore"; rm -rf "$GI"; mkdir -p "$GI"
node "$SCRIPTS/setup-harness-loop.mjs" --target "$GI" --name "GI" --purpose "three categories" >/dev/null
node -e "
const g=require('fs').readFileSync('$GI/.gitignore','utf8');
const has=(p)=>g.split('\n').some(l=>l.trim()===p);
// ephemeral: always ignored
process.exit(has('trace/') && has('loop/current.json') && has('loop/route-log.jsonl') ? 0 : 1);
"; expect "run output is ignored by default — it is regenerated every run and only creates diff noise" $?
node -e "
const g=require('fs').readFileSync('$GI/.gitignore','utf8');
const bad=['feature_list.json','progress.md','DECISIONS.md','session-handoff.md','memory/','docs/','AGENTS.md']
  .filter(p=>g.split('\n').some(l=>l.trim()===p||l.trim()===p+'/'));
// state must stay tracked: a gate reads feature_list.json out of git, and the rest IS the memory
process.exit(bad.length===0 ? 0 : 1);
"; expect "but the state a gate reads out of git — and the cross-session memory — is never ignored" $?
node -e "
const g=require('fs').readFileSync('$GI/.gitignore','utf8');
process.exit(/tools\//.test(g) ? 1 : 0);
"; expect "and machinery stays tracked unless asked for, so a clone can run the loop out of the box" $?
GM="$WORK/gitignore-m"; rm -rf "$GM"; mkdir -p "$GM"
node "$SCRIPTS/setup-harness-loop.mjs" --target "$GM" --name "GM" --purpose "machinery out" --gitignore-harness >/dev/null
node -e "
const g=require('fs').readFileSync('$GM/.gitignore','utf8').split('\n').map(l=>l.trim());
const has=(p)=>g.includes(p);
process.exit(has('tools/') && has('prompts/') && has('.kiro/') && has('.claude/') && has('.codex/')
  && has('!loop/goal.md') ? 0 : 1);
"; expect "--gitignore-harness keeps the machinery out of the product repo, but not loop/goal.md" $?
node -e "
const g=require('fs').readFileSync('$GM/.gitignore','utf8').split('\n').map(l=>l.trim());
process.exit(['feature_list.json','progress.md','DECISIONS.md','memory/'].some(p=>g.includes(p)) ? 1 : 0);
"; expect "and even then the state stays tracked — the machinery is replaceable, the memory is not" $?

# loop-status is a snapshot and cannot answer "is it moving": 18/61 done looks identical whether
# twelve finished last week or nothing has finished in a fortnight.
TL="$WORK/timeline"; rm -rf "$TL"; mkdir -p "$TL"
node "$SCRIPTS/setup-harness-loop.mjs" --target "$TL" --name "TL" --purpose "history" >/dev/null
test -f "$TL/tools/timeline.mjs"; expect "every scaffold ships the timeline view" $?
( cd "$TL" && node tools/timeline.mjs ) > "$TL/nogit.log" 2>&1; NG=$?
grep -q "not a git repository" "$TL/nogit.log" && [ "$NG" != "0" ]
expect "with no history it says so and exits non-zero, instead of inventing a timeline" $?
( cd "$TL" && git init -q . && git add -A && git -c user.email=a@b -c user.name=a commit -qm "scaffold" ) >/dev/null 2>&1
# three commits: a feature finishes, is reopened, finishes again — the case that broke my first two
# attempts at the movement metric.
node -e "
const fs=require('fs'); const p='$TL/feature_list.json';
const set=(id,st)=>{const d=JSON.parse(fs.readFileSync(p,'utf8'));
  const f=d.features.find(x=>x.id===id); f.status=st; fs.writeFileSync(p,JSON.stringify(d,null,2));};
set('feat-001','done');
"
( cd "$TL" && git commit -aqm "feat-001 done" ) >/dev/null 2>&1
node -e "
const fs=require('fs'); const p='$TL/feature_list.json'; const d=JSON.parse(fs.readFileSync(p,'utf8'));
d.features.find(x=>x.id==='feat-001').status='in-progress'; fs.writeFileSync(p,JSON.stringify(d,null,2));"
( cd "$TL" && git commit -aqm "feat-001 reopened" ) >/dev/null 2>&1
node -e "
const fs=require('fs'); const p='$TL/feature_list.json'; const d=JSON.parse(fs.readFileSync(p,'utf8'));
d.features.find(x=>x.id==='feat-001').status='done'; fs.writeFileSync(p,JSON.stringify(d,null,2));"
( cd "$TL" && git commit -aqm "feat-001 done again" ) >/dev/null 2>&1
node -e "
const {execFileSync}=require('child_process');
const j=JSON.parse(execFileSync('node',['tools/timeline.mjs','--json'],{cwd:'$TL',encoding:'utf8'}));
// NET against the state a week ago. Counting transitions said '21 finished' on a list with 18 done
// — true, and it reads as a bug, which quietly destroys trust in the rest of the screen.
process.exit(j.summary.doneThisWeek===j.summary.done && j.summary.reopenedThisWeek===1 ? 0 : 1);
"; expect "a feature finished, reopened and refinished counts once — net progress, never more done than exist" $?
node -e "
const {execFileSync}=require('child_process');
const j=JSON.parse(execFileSync('node',['tools/timeline.mjs','--json'],{cwd:'$TL',encoding:'utf8'}));
// a reopen is the signal worth leading with: work that WAS finished and is not any more
process.exit(j.events.some(e=>e.id==='feat-001'&&e.from==='done'&&e.to==='in-progress') ? 0 : 1);
"; expect "and the reopen is visible as its own transition, not averaged away" $?
node -e "
const {execFileSync}=require('child_process');
const out=execFileSync('node',['tools/timeline.mjs','--feature','feat-001'],{cwd:'$TL',encoding:'utf8'});
process.exit(/done/.test(out) && /in-progress/.test(out) && /now:/.test(out) ? 0 : 1);
"; expect "--feature replays one feature's whole history and where it stands now" $?
node -e "
const {execFileSync}=require('child_process');
const j=JSON.parse(execFileSync('node',['tools/timeline.mjs','--json'],{cwd:'$TL',encoding:'utf8'}));
// aging is the thing a snapshot hides: how long has this been sitting there
process.exit(j.open.every(f=>typeof f.ageDays==='number') ? 0 : 1);
"; expect "and every open feature carries how long it has been open" $?

# Every sizing row in feature-decomposition.md guarded against features being too BIG. Nothing
# caught too SMALL, and the loop's cost per feature is fixed — roughly two dispatches plus a
# baseline run — so an over-cut list spends its budget on overhead instead of behaviour.
SZ="$WORK/sizing"; rm -rf "$SZ"; mkdir -p "$SZ"
node "$SCRIPTS/setup-harness-loop.mjs" --target "$SZ" --name "Sizing" --purpose "granularity" >/dev/null
node -e "
const fs=require('fs'); const p='$SZ/feature_list.json'; const d=JSON.parse(fs.readFileSync(p,'utf8'));
const mk=(id,kind,v)=>({id,name:id,kind,behavior:'b',verification:v,falsifier:'f [INV-X-1]',
  dependencies:[],status:'not-started',readyForCheck:false,evidence:'',checkerNotes:'',attempts:0,maxAttempts:3});
// two PROVE features running the identical command: the loop proves the same thing twice
d.features.push(mk('feat-a','prove','npm test -- shared'));
d.features.push(mk('feat-b','prove','npm test -- shared'));
// a build whose only proof is the prove feature's own top-level command
d.features.push(mk('feat-impl','build','npm run sit -- rotation'));
d.features.push(mk('feat-accept','prove','npm run sit -- rotation'));
fs.writeFileSync(p, JSON.stringify(d,null,2));
"
node "$SCRIPTS/verify-harness.mjs" --target "$SZ" --skip-baseline --quiet
node -e "
const r=require('$SZ/trace/verify-report.json');
const f=r.findings.find(x=>x.id==='verification-duplicated');
process.exit(f && /feat-a \+ feat-b/.test(f.evidence) ? 0 : 1);
"; expect "two features of the same kind sharing one verification are flagged — the loop pays twice for one proof" $?
node -e "
const r=require('$SZ/trace/verify-report.json');
const f=r.findings.find(x=>x.id==='build-proved-only-at-top-level');
// the build/prove pair is the DELIBERATE exception; telling someone to merge it would undo the one
// thing keeping the maker off the test it is judged by
process.exit(f && /feat-impl \+ feat-accept/.test(f.evidence) && /do NOT merge/.test(f.remedy) ? 0 : 1);
"; expect "but a build/prove pair gets a different finding, and is told NOT to merge" $?
node -e "
const r=require('$SZ/trace/verify-report.json');
const f=r.findings.find(x=>x.id==='verification-duplicated');
process.exit(/feat-impl/.test(f.evidence||'') ? 1 : 0);
"; expect "and the pair is not double-reported as a plain duplicate" $?
node -e "
const t=require('fs').readFileSync('$SZ/docs/reference/feature-decomposition.md','utf8');
// the economics, so the advice is not 'make them bigger' — small batches also bought fast feedback
process.exit(/lower bound/i.test(t) && /U-curve/.test(t) && /transaction cost before you merge/.test(t)
  && /horizontal split in disguise/.test(t) ? 0 : 1);
"; expect "the reference doc gives the lower bound: cut transaction cost first, then fix shape not size" $?

# Reported from real use: agents write at length and bury the point. The rule "be brief, lead with
# the leverage point" was already in AGENTS.md — and the artifacts said it was not holding: 30 of 49
# checkerNotes opened with a first line over 200 chars, the longest note was 9,085. A prompt
# sentence is the layer that degrades, so gate the LEAD.
WR="$WORK/writing"; rm -rf "$WR"; mkdir -p "$WR"
node "$SCRIPTS/setup-harness-loop.mjs" --target "$WR" --name "Writing" --purpose "lead" >/dev/null
node -e "
const fs=require('fs'); const p='$WR/feature_list.json'; const d=JSON.parse(fs.readFileSync(p,'utf8'));
const f=d.features[0];
f.checkerNotes='In this session I reviewed the implementation carefully and considered several angles, '+
  'including whether the approach taken was appropriate given the constraints described in the design '+
  'documents, and after weighing all of that I concluded the following about the verification.';
fs.writeFileSync(p, JSON.stringify(d,null,2));
"
node "$SCRIPTS/verify-harness.mjs" --target "$WR" --skip-baseline --quiet
node -e "
const r=require('$WR/trace/verify-report.json');
process.exit(r.findings.some(f=>f.id==='lead-buried') ? 0 : 1);
"; expect "a note opening with a paragraph is flagged — the point is inside, so one line of it says nothing" $?
node -e "
const fs=require('fs'); const p='$WR/feature_list.json'; const d=JSON.parse(fs.readFileSync(p,'utf8'));
d.features[0].checkerNotes='REJECTED: the test passes on a stub.\n\nIt asserts the return type only, '+
  'so an implementation that returns an empty list satisfies it. Reworked assertion needed before this '+
  'can be judged again, and the reasoning is long but it is BELOW the point, where it belongs.';
fs.writeFileSync(p, JSON.stringify(d,null,2));
"
node "$SCRIPTS/verify-harness.mjs" --target "$WR" --skip-baseline --quiet
node -e "
const r=require('$WR/trace/verify-report.json');
// long is fine when the first line carries the verdict; gating length alone would delete reasoning
process.exit(r.findings.some(f=>f.id==='lead-buried') ? 1 : 0);
"; expect "but a long note whose FIRST LINE carries the verdict passes — the gate is on the lead, not the length" $?
# evidence: a list of runs, not a paragraph
node -e "
const fs=require('fs'); const p='$WR/feature_list.json'; const d=JSON.parse(fs.readFileSync(p,'utf8'));
const mk=(id,ev)=>({id,name:id,kind:'prove',behavior:'b',verification:'echo hi',falsifier:'f',
  dependencies:[],status:'done',readyForCheck:false,evidence:ev,checkerNotes:'ok',attempts:1,maxAttempts:3});
d.features.push(mk('feat-legacy','2026-08-12: ran it, it FAILED first, then passed'));
d.features.push(mk('feat-structured',[{date:'2026-08-12',run:'red',cmd:'echo hi',result:'1 failure'},
                                      {date:'2026-08-12',run:'green',cmd:'echo hi',result:'ok'}]));
d.features.push(mk('feat-structured-nored',[{date:'2026-08-12',run:'green',cmd:'echo hi',result:'ok'}]));
fs.writeFileSync(p, JSON.stringify(d,null,2));
"
node "$SCRIPTS/verify-harness.mjs" --target "$WR" --skip-baseline --quiet
node -e "
const r=require('$WR/trace/verify-report.json');
const f=r.findings.find(x=>x.id==='evidence-no-red');
// a legacy prose string and a structured list must reach the SAME verdict; 22 features already had
// a string and rewriting them by hand is not an upgrade
process.exit(f && f.count===1 ? 0 : 1);
"; expect "evidence as a list of runs works, prose still works, and only the run with no red is flagged" $?
node -e "
const {execFileSync}=require('child_process');
const out=execFileSync('node',['tools/feature.mjs','feat-structured'],{cwd:'$WR',encoding:'utf8'});
process.exit(/red\s+echo hi/.test(out) && /green\s+echo hi/.test(out) ? 0 : 1);
"; expect "and one feature's runs render as a readable table instead of a 1700-character line" $?

# Reported from real use: agents re-read the codebase every task, and re-ask what was already
# settled. The planner is REQUIRED to name the 1-3 files a feature touches in order to size it
# (feature-decomposition Step 3) — and there was no field to record them, so the knowledge was used
# once and thrown away. Every later agent rediscovers it.
CX="$WORK/context"; rm -rf "$CX"; mkdir -p "$CX"
node "$SCRIPTS/setup-harness-loop.mjs" --target "$CX" --name "Ctx" --purpose "handoff" >/dev/null
node -e "
const f=require('$CX/feature_list.json').features.find(x=>x.id==='feat-002');
process.exit(f.context && Array.isArray(f.context.touches) && f.context.note ? 0 : 1);
"; expect "a feature can carry the handoff into implementation: the files it touches, and the one line to know" $?
node -e "
const {execFileSync}=require('child_process');
const out=execFileSync('node',['tools/feature.mjs','feat-002'],{cwd:'$CX',encoding:'utf8'});
// the maker reads its task through this tool; the handoff has to surface there or it may as well
// not exist
process.exit(/touches/.test(out) && /context/.test(out) ? 0 : 1);
"; expect "and the tool the implementer reads its task with surfaces it" $?
node -e "
const fs=require('fs'); const p='$CX/feature_list.json'; const d=JSON.parse(fs.readFileSync(p,'utf8'));
for (const f of d.features) delete f.context;
fs.writeFileSync(p, JSON.stringify(d,null,2));
"
node "$SCRIPTS/verify-harness.mjs" --target "$CX" --skip-baseline --quiet
node -e "
const r=require('$CX/trace/verify-report.json');
const f=r.findings.find(x=>x.id==='feature-context-missing');
// ONE finding with a count, not one per feature — 42 separate warnings is the wall review-digest
// exists to remove
process.exit(f && f.count>=2 ? 0 : 1);
"; expect "unfinished features with no context are reported once, with a count, not one warning each" $?
node -e "
const m=require('$CX/agents.manifest.json');
const mk=m.agents.find(a=>a.name==='maker');
// the designer and planner both loaded the orientation doc; the agent that actually navigates the
// codebase did not
process.exit(mk.resources.includes('docs/architecture.md') ? 0 : 1);
"; expect "the maker loads docs/architecture.md — the map the designer maintains, for the agent that navigates" $?
node "$SCRIPTS/context-budget.mjs" --target "$CX" > "$CX/budget.log" 2>&1
grep -q "0 agent(s) over budget" "$CX/budget.log"
expect "and it still fits: shared context is only cheaper than rediscovery if it is inside the budget" $?

# Found by running the loop, not by reading it. Two problems, one per layer.
RN="$WORK/runreal"; rm -rf "$RN"; mkdir -p "$RN"
node "$SCRIPTS/setup-harness-loop.mjs" --target "$RN" --name "RunReal" --purpose "found by running" >/dev/null
node -e "
const fs=require('fs');
fs.writeFileSync('$RN/docs/assumptions.md', fs.readFileSync('$RN/docs/assumptions.md','utf8').replace(/needs-human/g,'verified'));
const p='$RN/feature_list.json'; const d=JSON.parse(fs.readFileSync(p,'utf8'));
d.features.push({id:'feat-oracle',name:'o',kind:'prove',behavior:'b',verification:'echo hi',
  falsifier:'wrong [INV-X-1]',dependencies:[],status:'not-started',readyForCheck:false,evidence:'',
  checkerNotes:'',attempts:0,maxAttempts:3});
fs.writeFileSync(p, JSON.stringify(d,null,2));
"
route_n(){ ( cd "$RN" && node loop/route.mjs --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).node))' ); }
# A plan with an EMPTY conditions/ folder: the directory existed, so the router dispatched
# test-implementer, which correctly refused. Twice, on the real project. Two paid sessions, nothing.
mkdir -p "$RN/tests/design/plans/TP-X-0001/conditions"
printf '{"plan_id":"TP-X-0001"}' > "$RN/tests/design/plans/TP-X-0001/plan.json"
[ "$(route_n)" = "test-designer" ]; expect "a plan with an empty conditions/ folder routes to test-designer, not the implementer" $?
( cd "$RN" && node loop/route.mjs --json ) | grep -q "no validated test condition"
expect "and the reason names the missing artifact, not the directory that happens to exist" $?
printf '{"id":"TCON-X-0001"}' > "$RN/tests/design/plans/TP-X-0001/conditions/TCON-X-0001.json"
[ "$(route_n)" = "test-implementer" ]; expect "once a real TCON-*.json exists the implementer is dispatchable" $?
node -e "
const t=require('fs').readFileSync('$SCRIPTS/codex-dispatch.mjs','utf8');
// codex's workspace-write sandbox blocks socket LISTENING: the baseline goes red inside it and
// green outside, and the agent reports that honestly while the project is fine
process.exit(/HARNESS_CODEX_SANDBOX/.test(t) && /blocks socket binding/.test(t) && /codex\", \[\"sandbox\"/.test(t) ? 0 : 1);
"; expect "codex-dispatch probes the sandbox for socket binding and offers the lever by name" $?
node -e "
const t=require('fs').readFileSync('$SCRIPTS/../references/runtimes.md','utf8');
process.exit(/blocks listening/.test(t) && /network_access=true.{0,40}does \*\*not\*\*/s.test(t) ? 0 : 1);
"; expect "and runtimes.md records that network_access=true does not fix it — only danger-full-access does" $?

# Borrowed from deepseek-harness, which pins every vendored package to an upstream repo AND commit,
# logs local modifications, and gates it. This harness had none of that and was already bitten: a
# vendored schema was widened here with nothing recording it as a local change, so the next sync
# would silently revert the fix — or silently keep a stale one.
VD="$WORK/vendor"; rm -rf "$VD"; mkdir -p "$VD"
node "$SCRIPTS/setup-harness-loop.mjs" --target "$VD" --name "Vendor" --purpose "provenance" >/dev/null
( cd "$VD" && git init -q . && git add -A && git -c user.email=a@b -c user.name=a commit -qm base ) >/dev/null 2>&1
node "$SCRIPTS/verify-harness.mjs" --target "$VD" --skip-baseline --quiet
node -e "
const m=require('$VD/vendor.manifest.json');
const e=m.vendored.find(v=>v.path==='skills/test-design');
// setup itself vendors this skill, so setup itself records where it came from. A scaffolder that
// creates the exact state the gate flags would teach everyone to ignore the finding.
process.exit(e && e.upstream && e.ref ? 0 : 1);
"; expect "the scaffolder records provenance for the skill it vendors, rather than creating the state it gates" $?
node -e "
const r=require('$VD/trace/verify-report.json');
process.exit(r.findings.some(f=>/^vendor/.test(f.id)) ? 1 : 0);
"; expect "so a fresh scaffold is clean" $?
mkdir -p "$VD/skills/borrowed/schemas"
printf '# borrowed\n' > "$VD/skills/borrowed/SKILL.md"
printf '{"pattern":"^A$"}' > "$VD/skills/borrowed/schemas/x.json"
( cd "$VD" && git add -A && git -c user.email=a@b -c user.name=a commit -qm "vendor a skill" ) >/dev/null 2>&1
node "$SCRIPTS/verify-harness.mjs" --target "$VD" --skip-baseline --quiet
node -e "
const r=require('$VD/trace/verify-report.json');
const f=r.findings.find(x=>x.id==='vendor-unpinned');
process.exit(f && /skills\/borrowed/.test(f.evidence) ? 0 : 1);
"; expect "code the project did not write, with no provenance, is flagged" $?
VC=$( cd "$VD" && git rev-parse HEAD )
node -e "
const fs=require('fs'); const p='$VD/vendor.manifest.json';
// merge, do not overwrite: the scaffolder already declared skills/test-design in here, and
// replacing the file would orphan it — which is what the gate would then correctly report
const m=JSON.parse(fs.readFileSync(p,'utf8'));
m.vendored.push({path:'skills/borrowed', upstream:'https://example.invalid/borrowed', ref:'v1.2.3',
  vendoredAt:'2026-08-15', vendoredCommit:'$VC', localModifications:[]});
fs.writeFileSync(p, JSON.stringify(m,null,2));
"
node "$SCRIPTS/verify-harness.mjs" --target "$VD" --skip-baseline --quiet
node -e "
const r=require('$VD/trace/verify-report.json');
process.exit(r.findings.some(f=>/^vendor/.test(f.id)) ? 1 : 0);
"; expect "declaring it with an upstream and a ref clears the finding" $?
# The valuable half: a change to vendored code that nobody recorded.
printf '{"pattern":"^A|B$"}' > "$VD/skills/borrowed/schemas/x.json"
node "$SCRIPTS/verify-harness.mjs" --target "$VD" --skip-baseline --quiet
node -e "
const r=require('$VD/trace/verify-report.json');
const f=r.findings.find(x=>/^vendor-modified-unrecorded/.test(x.id));
// uncommitted counts: the diff is against the working tree, which is when saying so still helps
process.exit(f && /x\.json/.test(f.evidence) ? 0 : 1);
"; expect "a change to vendored code that no one logged is caught, even uncommitted" $?
node -e "
const fs=require('fs'); const p='$VD/vendor.manifest.json'; const m=JSON.parse(fs.readFileSync(p,'utf8'));
// by path, not by index: after the merge, vendored[0] is the skill the scaffolder declared
m.vendored.find(v=>v.path==='skills/borrowed').localModifications=[{file:'schemas/x.json',why:'widened to accept B — DECISIONS.md 2026-08-15'}];
fs.writeFileSync(p, JSON.stringify(m,null,2));
"
node "$SCRIPTS/verify-harness.mjs" --target "$VD" --skip-baseline --quiet
node -e "
const r=require('$VD/trace/verify-report.json');
process.exit(r.findings.some(f=>/^vendor-modified/.test(f.id)) ? 1 : 0);
"; expect "recording it with the reason clears it — the log is the deliverable, not the silence" $?

# The project-specific half of AGENTS.md — what this repo IS, its real commands, where things live
# — was hand-written on every project. The onboarder surveyed as an LLM reading prose: a paragraph
# nobody can diff and no gate can check.
SV="$WORK/survey"; rm -rf "$SV"; mkdir -p "$SV/.github/workflows" "$SV/src/main" "$SV/junk"
( cd "$SV" && git init -q . ) >/dev/null 2>&1
printf 'jobs:\n  ci:\n    steps:\n      - run: ./gradlew customVerifyTask\n' > "$SV/.github/workflows/ci.yml"
printf 'apply plugin: java\n' > "$SV/build.gradle"
printf 'class A {}\n' > "$SV/src/main/A.java"
printf 'generated\n' > "$SV/junk/out.json"
( cd "$SV" && git add .github build.gradle src && git -c user.email=a@b -c user.name=a commit -qm base ) >/dev/null 2>&1
node "$SCRIPTS/survey-project.mjs" --target "$SV" --json > "$SV/survey.json" 2>/dev/null
node -e "
const s=require('$SV/survey.json');
const ci=s.commands.find(c=>c.kind==='ci');
// the command a merge actually depends on, and WHERE it was read from — not what is conventional
process.exit(ci && /customVerifyTask/.test(ci.cmd) && /ci\.yml/.test(ci.source) ? 0 : 1);
"; expect "the survey reads the real command out of CI, and reports the file it came from" $?
node -e "
const s=require('$SV/survey.json');
// nothing in a repo states WHY it exists; an invented purpose becomes AGENTS.md's first paragraph
process.exit(s.purpose===null && /needs-human/.test(s.purposeSource) ? 0 : 1);
"; expect "and leaves purpose blank rather than inventing it" $?
node -e "
const s=require('$SV/survey.json');
// junk/ is untracked, not gitignored — the sharper question is what git TRACKS
process.exit(s.layout.some(d=>d.dir==='src') && !s.layout.some(d=>d.dir==='junk') ? 0 : 1);
"; expect "untracked output is left out of the map — git tracking is the test, not a skip list" $?
node "$SCRIPTS/survey-project.mjs" --target "$SV" --agents-md > "$SV/AGENTS.draft.md" 2>/dev/null
node -e "
const t=require('fs').readFileSync('$SV/AGENTS.draft.md','utf8');
process.exit(/customVerifyTask/.test(t) && /NEEDS HUMAN/.test(t) && /The six that carry everything/.test(t) ? 0 : 1);
"; expect "--agents-md drafts a router carrying this repo's real command and an explicit NEEDS HUMAN" $?
EMPTY="$WORK/survey-empty"; rm -rf "$EMPTY"; mkdir -p "$EMPTY"
node "$SCRIPTS/survey-project.mjs" --target "$EMPTY" --json > "$EMPTY/s.json" 2>/dev/null
node -e "
const s=require('$EMPTY/s.json');
// a project with no manifest and no CI: say so, do not guess a stack's conventional command
process.exit(s.commands.length===0 && s.stacks.length===0 ? 0 : 1);
"; expect "a repo with nothing to go on reports nothing found, instead of a conventional guess" $?

# An agent in the integration target loads THAT repo's AGENTS.md and nothing else — agent-context
# resolves every resource against the current root. Two of three surveyed services had their own
# AGENTS.md and the collector did not even look for one, so cross-repo work read their source
# without ever reading their rules.
OR2="$WORK/ownrules"; rm -rf "$OR2"; mkdir -p "$OR2/svc-a/src" "$OR2/svc-b/src"
printf '{"name":"a","scripts":{"start":"node src/index.js"}}' > "$OR2/svc-a/package.json"
printf 'require("http").createServer().listen(0)\n' > "$OR2/svc-a/src/index.js"
printf '# svc-a rules\nNever log a payload.\n' > "$OR2/svc-a/AGENTS.md"
printf '{"name":"b","scripts":{"start":"node src/index.js"}}' > "$OR2/svc-b/package.json"
printf 'require("http").createServer().listen(0)\n' > "$OR2/svc-b/src/index.js"
node "$SCRIPTS/collect-services.mjs" --roots "$OR2/svc-a,$OR2/svc-b" --out "$OR2/svc.json" >/dev/null 2>&1
node -e "
const m=require('$OR2/svc.json');
const a=m.services.find(s=>s.id.endsWith('svc-a')), b=m.services.find(s=>s.id.endsWith('svc-b'));
// a POINTER, never a copy: a second copy of another repo's conventions goes stale and misleads
const r=a && a.rules && a.rules[0];
process.exit(a && a.ownRules && /svc-a\/AGENTS\.md$/.test(a.ownRules[0]) && r &&
  r.scope===a.path && r.provenance==='discovered' && /^[a-f0-9]{64}$/.test(r.sha256) &&
  b && b.ownRules===null && b.rules===null ? 0 : 1);
"; expect "the registry records where each service keeps its OWN rules, and null when it has none" $?
IT2="$WORK/ownrules-target"; rm -rf "$IT2"; mkdir -p "$IT2"
node "$SCRIPTS/setup-harness-loop.mjs" --target "$IT2" --name "SIT" --purpose x --integration "$OR2/svc.json" >/dev/null 2>&1
node -e "
const t=require('fs').readFileSync('$IT2/docs/services.md','utf8');
process.exit(/own rules/i.test(t) && /svc-a\/AGENTS\.md/.test(t) && /do not copy it here/i.test(t) ? 0 : 1);
"; expect "and the design surface tells an agent to read them in place before touching that repo" $?
node -e "
const fs=require('fs');
const p='$IT2/prompts/k8s-integration-tester.md';
if (!fs.existsSync(p)) process.exit(0);   // k8s layer is off for this target
const t=fs.readFileSync(p,'utf8').replace(/\s+/g,' ');
process.exit(/read its own rules/i.test(t) && /ownRules/.test(t) ? 0 : 1);
"; expect "the agent that works across service repos is told the same, in its own prompt" $?
mv "$IT2/tools/context-plan.mjs" "$IT2/tools/context-plan.mjs.off"
node "$SCRIPTS/verify-harness.mjs" --target "$IT2" --skip-baseline --quiet --report "$IT2/context-broken.json" >/dev/null 2>&1 || true
node -e "
const r=require('$IT2/context-broken.json');
process.exit(r.findings.some(f=>f.gate==='context-supply' && f.id==='service-rules-unread' && f.layer==='harness') ? 0 : 1);
"; expect "a registry whose service-rule pointers have no runtime consumer is a harness blocker" $?
mv "$IT2/tools/context-plan.mjs.off" "$IT2/tools/context-plan.mjs"
node "$SCRIPTS/context-collection-eval.mjs" > "$OR2/context-after.json"
node -e "
const before=require('$SCRIPTS/../references/context-collection-baseline.json');
const after=require('$OR2/context-after.json');
const b=before.metrics,a=after.metrics;
process.exit(b.relevantRuleLoadRecall===0 && !b.staleDigestDetected &&
  a.discoveryRecall===1 && a.relevantRuleLoadRecall===1 && a.irrelevantRulesLoaded===0 &&
  a.staleDigestDetected && a.injectedBytes>b.injectedBytes ? 0 : 1);
"; expect "the frozen before/after benchmark loads only the touched service rules and detects stale provenance" $?

# A reading list still makes the maker rediscover the designer's conclusions. A feature context
# packet materializes bounded facts, keeps the live seam/oracle mandatory, and becomes unusable
# rather than silently stale when one of its cited sources changes.
mkdir -p "$IT2/loop/context-packets" "$IT2/src" "$IT2/tests"
printf 'approved seam v1\n' > "$IT2/docs/design/packet-source.md"
printf 'export const seam = 1;\n' > "$IT2/src/seam.js"
printf 'oracle: seam must return 1\n' > "$IT2/tests/seam.test.txt"
node -e "
const fs=require('fs'),crypto=require('crypto'),root='$IT2';
const fl=require(root+'/feature_list.json'),f=fl.features.find(x=>x.id==='feat-002');
f.context={...(f.context||{}),packet:'loop/context-packets/feat-002.json'};
fs.writeFileSync(root+'/feature_list.json',JSON.stringify(fl,null,2)+'\n');
const src='docs/design/packet-source.md';
const sha256=crypto.createHash('sha256').update(fs.readFileSync(root+'/'+src)).digest('hex');
const p={schema:'feature-context-packet/1',objective:'use the approved seam',
  mustRead:['src/seam.js','tests/seam.test.txt'],facts:['the public seam returns 1'],
  mustNotRead:['unrelated subsystems'],sourceInputs:[{path:src,sha256}]};
fs.writeFileSync(root+'/loop/context-packets/feat-002.json',JSON.stringify(p,null,2)+'\n');
fs.writeFileSync(root+'/loop/current.json',JSON.stringify({feature:'feat-002'})+'\n');
"
node -e "
const {execFileSync}=require('child_process');
const out=JSON.parse(execFileSync('node',['tools/agent-context.mjs','maker'],{cwd:'$IT2',input:'{}'}));
const text=out.hookSpecificOutput.additionalContext, receipt=out.harnessContextReceipt;
process.exit(receipt && receipt.status==='consumed' && receipt.mustRead.length===2 &&
  /the public seam returns 1/.test(text) && /export const seam = 1/.test(text) &&
  !/approved seam v1/.test(text) ? 0 : 1);
"; expect "a fresh feature packet injects established facts and live mustRead seams, with a typed receipt" $?
printf 'approved seam v2\n' > "$IT2/docs/design/packet-source.md"
node -e "
const {execFileSync}=require('child_process');
const out=JSON.parse(execFileSync('node',['tools/agent-context.mjs','maker'],{cwd:'$IT2',input:'{}'}));
const text=out.hookSpecificOutput.additionalContext, receipt=out.harnessContextReceipt;
process.exit(receipt && receipt.status==='stale' && !/the public seam returns 1/.test(text) &&
  /do not trust its facts/.test(text) ? 0 : 1);
"; expect "a changed source makes the packet stale and prevents old conclusions entering agent context" $?

step 39 "integration init: evidence-rich questions gate scaffold until typed human answers"
IIROOT="$WORK/integration-init-services"; IIT="$WORK/integration-init-target"
mkdir -p "$IIROOT/orders/chart/templates" "$IIROOT/trades/chart/templates"
for S in orders trades; do
  printf '{"scripts":{"start":"node server.js"},"dependencies":{"express":"1"}}\n' > "$IIROOT/$S/package.json"
  printf 'require("http").createServer(()=>{}).listen(8080)\n' > "$IIROOT/$S/server.js"
  printf 'FROM node:20\n' > "$IIROOT/$S/Dockerfile"
  printf 'apiVersion: v2\nname: %s\nversion: 0.1.0\n' "$S" > "$IIROOT/$S/chart/Chart.yaml"
done
node "$SCRIPTS/init-integration-project.mjs" --target "$IIT" --roots "$IIROOT/orders,$IIROOT/trades" --journey "place order to matched trade" >/tmp/demo-ii.$$ 2>&1
node -e "
const q=require('$IIT/inventory/integration-context/questions.json').questions;
const h=q.find(x=>x.id.endsWith('.health')),o=q.find(x=>x.id==='journey.observations');
process.exit(h?.evidence?.source && h.answer.requiredFields.includes('successMeans') && h.ownerHint && h.impact &&
  o.answer.itemRequiredFields.includes('correlationField') && /acknowledgement proves acceptance/.test(o.why) ? 0 : 1);
"; expect "questions carry source evidence, owner, answer contract, rationale and blocked impact" $?
node "$SCRIPTS/finalize-integration-init.mjs" --target "$IIT" >/tmp/demo-iif.$$ 2>&1; [ "$?" = "3" ]
expect "finalize rejects unanswered placeholders instead of manufacturing a plausible system" $?
node -e "
const fs=require('fs'),p='$IIT/answers.json',a=require(p),q=require('$IIT/inventory/integration-context/questions.json').questions;
for(const x of q){let v;
 if(x.id.endsWith('.health')) v={command:'curl -fsS http://'+x.id.split('.')[1]+'/ready',successMeans:'HTTP 200 and business dependencies loaded'};
 else if(x.id.endsWith('.dependsOn')) v=[];
 else if(x.id==='journey.command') v={service:'orders',protocol:'HTTP',operation:'POST /orders',correlationField:'clientOrderId',successAcknowledgement:'202 with orderId'};
 else if(x.id==='journey.observations') v=[{service:'trades',protocol:'event',source:'trade-events',correlationField:'clientOrderId',expected:'one matched trade'}];
 else if(x.id==='journey.seed') v={command:'fixture-api seed instrument',publicBoundary:true,createdResources:['instrument-\${HARNESS_RUN_ID}'],cleanupCommand:'fixture-api cleanup'};
 else if(x.id==='journey.isolation') v={mode:'namespace-per-run',derivedResources:['sit-\${HARNESS_RUN_ID}','account-\${HARNESS_RUN_ID}','consumer-\${HARNESS_RUN_ID}']};
 else if(x.id==='journey.risk') v={attribute:'correctness',consequence:'high',likelihood:'medium',detectability:'low',stakeholders:['trading operations'],riskReason:'a duplicate trade creates financial loss',requiredScope:'journey',verificationOwner:'trading-sit'};
 a.answers[x.id]={value:v,answeredBy:'demo business owner',rationale:'fixture decision'};
} fs.writeFileSync(p,JSON.stringify(a,null,2)+'\n');
"
node "$SCRIPTS/finalize-integration-init.mjs" --target "$IIT" >/tmp/demo-iif.$$ 2>&1
expect "complete typed answers produce the integration scaffold" $?
( cd "$IIT" && node tools/services-check.mjs >/dev/null && node skills/business-journey/scripts/check-business-journey.mjs --environment business-environment.json --oracles business-oracles >/dev/null && node skills/quality-strategy/scripts/check-quality-strategy.mjs --risk test-risk.json --oracles business-oracles >/dev/null ); expect "resolved registry, public journey, and risk-sized test portfolio are mechanically green" $?
node "$SCRIPTS/../templates/quality-strategy/evals/run-fixtures.mjs" >/dev/null; expect "high-risk capability without an oracle and cluster test mislabeled small are rejected" $?
test -f "$IIT/inventory/integration-context/answer-receipt.json" -a -f "$IIT/integration-init-review.md"; expect "human decisions retain a digest-bound receipt and readable review" $?
rm -f /tmp/demo-ii.$$ /tmp/demo-iif.$$

step 40 "meta loop: dispatch on the right layer, stop when nothing moves"
# The fingerprint includes evidence and feature state, not only gate/id. Same blocker with changed
# evidence is progress; returning to an earlier canonical state exposes an A-B-A cycle.
FP="$WORK/fingerprint"; rm -rf "$FP"; mkdir -p "$FP/trace"
printf '{"features":[{"id":"f","status":"not-started","attempts":0}]}' > "$FP/feature_list.json"
printf '{"findings":[{"gate":"g","id":"x","layer":"harness","severity":"blocker","symptom":"s","evidence":"A"}]}' > "$FP/trace/r.json"
FPA="$(node "$SCRIPTS/progress-fingerprint.mjs" --target "$FP" --report "$FP/trace/r.json")"
node -e "const fs=require('fs'),p='$FP/trace/r.json',r=JSON.parse(fs.readFileSync(p));r.findings[0].evidence='B';fs.writeFileSync(p,JSON.stringify(r))"
FPB="$(node "$SCRIPTS/progress-fingerprint.mjs" --target "$FP" --report "$FP/trace/r.json")"
node -e "const fs=require('fs'),p='$FP/trace/r.json',r=JSON.parse(fs.readFileSync(p));r.findings[0].evidence='A';fs.writeFileSync(p,JSON.stringify(r))"
FPA2="$(node "$SCRIPTS/progress-fingerprint.mjs" --target "$FP" --report "$FP/trace/r.json")"
[ "$FPA" != "$FPB" ] && [ "$FPA" = "$FPA2" ]; expect "progress fingerprints distinguish changed evidence and expose an A-B-A return" $?
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
grep -q "canonical workflow state repeated" /tmp/demo-meta.$$; expect "loop stops itself on a repeated state instead of spinning forever" $?
rm -f /tmp/demo-meta.$$

echo ""
if [ "$FAIL" = "0" ]; then
  echo "ALL DEMO STEPS PASSED — harness-loop lifecycle proven end-to-end at $T"
else
  echo "ONE OR MORE DEMO STEPS FAILED — see FAIL lines above"
fi
exit "$FAIL"

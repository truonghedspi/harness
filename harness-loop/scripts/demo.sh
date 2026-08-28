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
export HARNESS_LAYOUT=legacy
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
node -e "
const t=require('fs').readFileSync('$T/docs/reference/graph.md','utf8');
process.exit(/relative to the harness root/.test(t) && /project root itself on a flat\s+layout/.test(t) && !/relative to the contained harness\//.test(t) ? 0 : 1);
"
expect "a flat scaffold's graph describes paths from the project-root harness home" $?

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
fl.features[0].readyForCheck = false; // clear step 11's separate false-claim fixture
fl.features[1].status = 'in-progress'; fl.features[1].readyForCheck = true; fl.features[1].checkerNotes = '';
fl.features[1].attempts = 1; // clear the over-budget state from step 12 — a different check
fs.writeFileSync(p, JSON.stringify(fl, null, 2));
"
node -e "
const fs=require('fs'),cp=require('child_process'),p='$T2/feature_list.json';
const j=JSON.parse(fs.readFileSync(p,'utf8')),f=j.features[1];
const report=JSON.parse(cp.spawnSync(process.execPath,['tools/review-contract.mjs',f.id,'--json'],{cwd:'$T2',encoding:'utf8'}).stdout);
f.reviewPacket={contractDigest:report[0].contractDigest,claimRefs:[f.id],changedPaths:['feature_list.json'],runs:[{cmd:f.verification,exit:0,result:'passed'}],adversarialChecks:{scope:'covered',cleanup:'not-applicable: demo command',errorPath:'covered',concurrency:'not-applicable: demo command',realBoundary:'not-applicable: demo command',discrimination:'an implementation that always exits 0 would still pass this demo command; the real feature verification is what discriminates'},residualUnknowns:[]};
fs.writeFileSync(p,JSON.stringify(j,null,2)+'\n');
"
node "$SCRIPTS/verify-harness.mjs" --target "$T2" --skip-baseline --run-features --promote --quiet
node -e "
const fl = require('$T2/feature_list.json');
const f2 = fl.features.find(f => f.id === 'feat-002');
process.exit(f2.status === 'done' && f2.checkerNotes.includes('mechanically promoted') ? 0 : 1);
"; expect "feature with reproducing evidence is promoted to done with an audit trail" $?
node -e "const fs=require('fs'),p='$T2/feature_list.json',j=JSON.parse(fs.readFileSync(p,'utf8')); j.features[1].checkerVerdict={status:'approve',basis:'claim-survived'}; fs.writeFileSync(p,JSON.stringify(j,null,2)+'\n');"

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
node -e "
const fs=require('fs'),p='$T2/feature_list.json',fl=JSON.parse(fs.readFileSync(p));
fl.features[0].kind='prove'; fl.features[0].behavior='Apply the opening state, then snapshot it, then restart the service, then query the public view, and confirm the same invariant across every observed event while retaining the same correlation identity throughout the single business scenario.';
fs.writeFileSync(p,JSON.stringify(fl,null,2));
"
node "$SCRIPTS/verify-harness.mjs" --target "$T2" --skip-baseline --quiet
! grep -q '"id": "scope-smell:feat-001"' "$T2/trace/verify-report.json"
expect "a prove feature may narrate one sequential scenario without being mislabeled compound" $?

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
node "$TO/loop/route.mjs" --json > /tmp/demo-example-route.$$ 2>&1
node -e "
const r=JSON.parse(require('fs').readFileSync('/tmp/demo-example-route.$$','utf8'));
process.exit(r.node==='human' && /assumption/i.test(r.why||'') ? 1 : 0);
"; expect "a commented assumption example is documentation, not a fake human checkpoint" $?
rm -f /tmp/demo-example-route.$$
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
[ "$(route_node)" = "design-facilitator" ]; expect "a design stating no seam and no invariants outranks the oracle layer" $?
printf '\n## Observable seam\n\nThe GapEventSink, externally visible.\n\n## Invariants\n\nEvent count is conserved for every replay; reconcile is idempotent.\n' >> "$TO/docs/design/recon.md"
# A design that changes what a feature MEANS leaves feature_list.json a version behind, and the
# design-facilitator is (correctly) not allowed to write scope — so route on what it can write: its
# own Feature impact table. Without this the router jumped decomposition and sent the oracle layer to
# write falsifiers for features that were about to be re-cut.
cat >> "$TO/docs/design/recon.md" <<'MD'

## Feature impact

| `feat-b` | **change** | the seam moved; this feature means something else now |
| `feat-1` | keep | untouched |
MD
# The design is now testable but has no human approval on record. There is no reviewer agent to
# route to any more — this always goes straight to a human, and stays there until a human writes
# loop/design-approval.json themselves; no agent can unblock it.
[ "$(route_node)" = "human" ]; expect "a valid but unapproved design routes to a human, never back to an agent" $?
TO_DIGEST="$(cd "$TO" && node loop/route.mjs --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).detail))')"
printf '{"schema":"design-approval/1","designDigest":"%s","status":"approved","approvedBy":"demo-human","approvedAt":"2026-08-18","decisions":["demo approval"],"acceptedRisks":[]}\n' "$TO_DIGEST" > "$TO/loop/design-approval.json"
[ "$(route_node)" = "feature-planner" ]; expect "a design marking a feature change/new outranks the oracle layer, once approved" $?
# Edit the design after approval — even one line — and the digest changes, so the approval silently
# stops matching: there is no partial-credit "still basically approved" state.
printf '\n' >> "$TO/docs/design/recon.md"
[ "$(route_node)" = "human" ]; expect "a design edited after approval invalidates the approval automatically, no expiry step needed" $?
printf '{"schema":"design-approval/1","designDigest":"%s","status":"approved","approvedBy":"demo-human","approvedAt":"2026-08-18","decisions":["re-approved after trailing newline"],"acceptedRisks":[]}\n' "$(cd "$TO" && node loop/route.mjs --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).detail))')" > "$TO/loop/design-approval.json"
[ "$(route_node)" = "feature-planner" ]; expect "re-approving the new digest unblocks the loop again" $?
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
( cd "$TO" && node loop/route.mjs --json ) | grep -q "no complete feature-linked condition"
expect "and the reason names the missing input rather than the feature" $?
# A real condition file, not just the directory: an empty conditions/ folder used to satisfy this,
# and the implementer was dispatched twice on the real project with nothing to implement from.
mkdir -p "$TO/tests/design/plans/TP-D-0001/conditions"
printf '{"id":"TCON-D-0001","requirement_id":"INV-RECON-1"}' > "$TO/tests/design/plans/TP-D-0001/conditions/TCON-D-0001.json"
node -e "const fs=require('fs'); const p='$TO/feature_list.json'; const d=JSON.parse(fs.readFileSync(p,'utf8')); d.features.find(f=>f.id==='feat-p').conditions=['TCON-D-0001']; fs.writeFileSync(p,JSON.stringify(d,null,2));"
[ "$(route_node)" = "test-implementer" ]; expect "once the conditions exist, a specified-but-unwritten oracle routes to test-implementer" $?
# conditionsExist() only asks "does ANY TCON-*.json exist anywhere" — true the moment ONE feature
# has conditions. It stays true even after a design amendment adds a NEW invariant citation to a
# DIFFERENT falsifier that no condition covers, so the router used to jump straight past
# test-designer to test-implementer for that feature — which would implement tests for the old
# conditions and silently ship the amendment with zero coverage. Found live on
# examples/jdt-mcp-server, where feature-planner extended a falsifier to cite two new invariants
# after design-facilitator amended the design, but the conditions written before the amendment
# still only covered the original ones.
node -e "
const fs=require('fs'); const p='$TO/feature_list.json';
const d=JSON.parse(fs.readFileSync(p,'utf8'));
d.features.find(f=>f.id==='feat-p').falsifier='breaks the conservation invariant [INV-RECON-2]';
fs.writeFileSync(p, JSON.stringify(d,null,2));
"
[ "$(route_node)" = "test-designer" ]; expect "a falsifier amended to cite a new invariant routes back to test-designer even though other conditions already exist" $?
( cd "$TO" && node loop/route.mjs --json ) | grep -q "INV-RECON-2"
expect "and the reason names the specific uncovered invariant, not just 'no conditions'" $?
node -e "
const fs=require('fs'); const p='$TO/tests/design/plans/TP-D-0001/conditions/TCON-D-0002.json';
fs.writeFileSync(p, JSON.stringify({id:'TCON-D-0002', requirement_id:'INV-RECON-2'}));
"
node -e "const fs=require('fs'); const p='$TO/feature_list.json'; const d=JSON.parse(fs.readFileSync(p,'utf8')); d.features.find(f=>f.id==='feat-p').conditions.push('TCON-D-0002'); fs.writeFileSync(p,JSON.stringify(d,null,2));"
[ "$(route_node)" = "test-implementer" ]; expect "a condition citing the new invariant clears it, back to test-implementer" $?
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
process.exit(r.findings.some(f=>f.id==='design-untestable') ? 0 : 1);
"; expect "a design doc naming no seam and no invariants is flagged — 'how would we know' is a design question" $?
printf '\n## Observable seam\n\nThe GapEventSink, externally visible.\n\n## Invariants\n\nEvent count is conserved for every replay; reconcile is idempotent.\n' >> "$TO/docs/design/recon.md"
node "$SCRIPTS/verify-harness.mjs" --target "$TO" --skip-baseline --quiet
node -e "
const r=require('$TO/trace/verify-report.json');
process.exit(r.findings.some(f=>f.id==='design-untestable') ? 1 : 0);
"; expect "stating the seam and the invariants clears it" $?
# Checked ACROSS the folder, not file-by-file: a design legitimately split into topic files has
# some files with no reason to say "seam" on their own — found live when a design-facilitator
# session split a design into architecture.md/critique.md/evidence.md and a pure-critique file
# alone tripped this gate despite the design, as a whole, stating every seam and invariant.
printf '# Critique\n\nWhich premise, if false, flips this conclusion? Walking each one back.\n%.0s' 1 2 3 4 5 6 7 8 > "$TO/docs/design/critique.md"
node "$SCRIPTS/verify-harness.mjs" --target "$TO" --skip-baseline --quiet
node -e "
const r=require('$TO/trace/verify-report.json');
process.exit(r.findings.some(f=>f.id==='design-untestable') ? 1 : 0);
"; expect "a topic file with no seam/invariant wording of its own does not trip the gate when another design file states them" $?
rm -f "$TO/docs/design/critique.md"
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
node -e "
const s=require('$T3/skills/test-design/schemas/test-case.schema.json');
const p=new RegExp(s.properties.requirement_id.pattern);
process.exit(p.test('REQ-TEST-001') && p.test('INV-SCHEMA-1') && !p.test('BAD-ID') ? 0 : 1);
"; expect "test-case metadata accepts both REQ-* and INV-* traceability identifiers" $?

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

step 31 "adopting an existing repo: minimal entry plus upgrade capability, then debt ratchets"
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
const added=['prompts/harness-onboarder.md','.kiro/agents/harness-onboarder.json',
  '.claude/agents/harness-onboarder.md','skills/harness-upgrade/SKILL.md',
  'skills/harness-upgrade/scripts/plan-upgrade.mjs'].every(f=>fs.existsSync('$LEG/'+f));
// the whole point: nothing ELSE appeared — no init.sh, no feature_list.json, no docs/
const untouched=!fs.existsSync('$LEG/init.sh') && !fs.existsSync('$LEG/feature_list.json');
process.exit(before&&kept&&added&&untouched?0:1);
"; expect "the onboarder installs only its entry points and upgrade capability, leaving product files untouched" $?
node -e "
const j=require('$LEG/.kiro/agents/harness-onboarder.json');
const p=require('fs').readFileSync('$LEG/prompts/harness-onboarder.md','utf8');
// a file:// URI kiro resolves relative to .kiro/agents/, and no unsubstituted <skill> token
process.exit(j.prompt==='file://../../prompts/harness-onboarder.md' &&
  j.resources.includes('file://../../skills/harness-upgrade/SKILL.md') &&
  /skills\/harness-upgrade\/SKILL\.md/.test(p) && !p.includes('<skill>') ? 0 : 1);
"; expect "its prompt and capability URIs resolve, and existing harnesses route into the skill" $?
node "$SCRIPTS/setup-harness-loop.mjs" --target "$LEG" --name "Legacy" --purpose "upgrade fixture" >/dev/null
node -e "
const j=require('$LEG/.kiro/agents/harness-onboarder.json');
process.exit(j.resources.includes('file://../../docs/constraints.md') ? 0 : 1);
"; expect "once setup creates constraints, the already-installed onboarder receives the rulebook" $?
node -e "
const j=require('$SCRIPTS/../../.kiro/agents/harness-improver.json');
process.exit(j.resources.includes('file://../../docs/constraints.md') ? 0 : 1);
"; expect "the skill-level harness improver loads the dogfood target's constraints" $?
# The ratchet, on a target that already carries real debt (T3 from step 30).
node "$SCRIPTS/adoption-baseline.mjs" --target "$T3" --record --note "demo" >/dev/null
git -C "$T3" check-ignore -q trace/adoption-baseline.json
[ "$?" != "0" ]; expect "adoption debt is durable tracked state, not ignored run output" $?
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
node -e "const fs=require('fs'),p='$TR/agents.manifest.json',j=require(p),a=structuredClone(j.agents.find(x=>x.name==='maker'));a.name='retired-demo';j.agents.push(a);fs.writeFileSync(p,JSON.stringify(j,null,2)+'\n');fs.writeFileSync('$TR/.kiro/agents/user-helper.json','{\"name\":\"user-helper\"}\n')"
node "$SCRIPTS/gen-agents.mjs" --target "$TR" --runtime all >/dev/null
node -e "const fs=require('fs'),p='$TR/agents.manifest.json',j=require(p);j.agents=j.agents.filter(x=>x.name!=='retired-demo');fs.writeFileSync(p,JSON.stringify(j,null,2)+'\n')"
node "$SCRIPTS/gen-agents.mjs" --target "$TR" --runtime all >/dev/null
test ! -e "$TR/.kiro/agents/retired-demo.json" -a ! -e "$TR/.claude/agents/retired-demo.md" -a ! -e "$TR/.codex/agents/retired-demo.toml" -a -e "$TR/.kiro/agents/user-helper.json"
expect "retired generated agents are removed from all runtimes while unmanaged user agents survive" $?
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
process.exit(cc('checker')==='claude-opus-5' && cc('design-facilitator')==='claude-opus-5' &&
             cc('maker')==='sonnet' && cc('test-designer')==='sonnet' &&
             kiro('checker')==='claude-sonnet-4.5' && kiro('maker')==='claude-sonnet-4' ? 0 : 1);
"; expect "evaluators get the strongest model each runtime offers; executors run cheap" $?
node -e "
const fs=require('fs');
// kiro's own subagent tool is what 'native sub-agent facility' means for kiro specifically — this
// is what turns 'never spawn the orchestrator itself' from a prompt-only MUST NOT into something
// kiro refuses. Computed at generation time, not a list hand-copied into the manifest, so it cannot
// drift when an agent is added or renamed.
const orch=require('$TR/.kiro/agents/orchestrator.json');
const avail=orch.toolsSettings && orch.toolsSettings.subagent && orch.toolsSettings.subagent.availableAgents;
process.exit(orch.tools.includes('subagent') && Array.isArray(avail) &&
  avail.includes('maker') && !avail.includes('orchestrator') ? 0 : 1);
"; expect "kiro's orchestrator can spawn every other agent but never itself, enforced by config" $?
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
             /guard-write\.mjs --runtime codex --from-env/.test(JSON.stringify(j.hooks)) ? 0 : 1);
"; expect "Codex hooks.json uses only the two keys Codex accepts, and wires the write guard" $?
node -e "
// Codex's edit tool is apply_patch and its payload has NO file_path — just a patch envelope. The
// guard parsed only file_path at first, found none, and returned ALLOW: confinement absent while
// every log line said the hook ran. All four of these are the Codex shape.
const {execFileSync}=require('child_process');
const run=(env,cmd)=>JSON.parse(execFileSync('node',['tools/guard-write.mjs','--runtime','codex','--from-env'],
  {cwd:'$TR',input:JSON.stringify({tool_name:'apply_patch',tool_input:{command:cmd}}),encoding:'utf8',
   env:{...process.env,...(env?{HARNESS_AGENT:env}:{HARNESS_AGENT:''})}}))
  .hookSpecificOutput || {};
const patch=(...lines)=>'*** Begin Patch\n'+lines.join('\n')+'\n*** End Patch';
const a=run('checker',patch('*** Update File: feature_list.json'));
const b=run('checker',patch('*** Add File: src/Sneak.java'));
const c=run('checker',patch('*** Update File: progress.md','*** Add File: src/Sneak.java'));
const d=run('',patch('*** Add File: src/Sneak.java'));
process.exit(a.permissionDecision===undefined && b.permissionDecision==='deny' &&
             c.permissionDecision==='deny' &&
             d.permissionDecision===undefined ? 0 : 1);
"; expect "the guard reads Codex apply_patch envelopes, sinks a whole patch for one bad path, and says so when it cannot identify the role" $?
node -e "
// A payload that arrives and will not parse used to become {} and then a cheerful 'nothing to check'
// allow. If the guard cannot read the request it cannot police it.
const {execFileSync}=require('child_process');
const out=JSON.parse(execFileSync('node',['tools/guard-write.mjs','--runtime','codex','--from-env'],
  {cwd:'$TR',input:'not json',encoding:'utf8',env:{...process.env,HARNESS_AGENT:'checker'}}));
process.exit(out.hookSpecificOutput.permissionDecision==='deny' ? 0 : 1);
"; expect "an unparseable hook payload is denied, not silently allowed" $?
node "$TR/tools/hook-calibrate.mjs" --target "$TR" --runtime codex > "$TR/hook-calibration.json"
node -e "
const r=require('$TR/hook-calibration.json');
const c=r.results.find(x=>x.runtime==='codex');
process.exit(c && c.adapter==='pass' && c.allow==='neutral' && c.deny==='deny' &&
  c.reasonPresent && typeof c.runtimeVersion==='string' ? 0 : 1);
"; expect "Codex hook calibration proves neutral allow plus reasoned deny against the installed runtime version" $?
node -e "
const {execFileSync}=require('child_process');
const out=JSON.parse(execFileSync('node',['tools/guard-write.mjs','--runtime','codex','maker'],
  {cwd:'$TR',input:'{}',encoding:'utf8'}));
process.exit(out.permissionDecision===undefined && out.hookSpecificOutput===undefined ? 0 : 1);
"; expect "Codex allow emits no unsupported permissionDecision enum" $?
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
grep -q '^# K8s Integration Tester — K8s Demo$' "$K8T/prompts/k8s-integration-tester.md"
expect "K8s prompts pass through project-name substitution instead of leaking a template token" $?
grep -q '^# K8s-integration-tester memory — K8s Demo$' "$K8T/memory/k8s-integration-tester/MEMORY.md"
expect "K8s memory passes through the same substitution path" $?
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
test -f "$WIN/loop/run-loop.mjs" -a -f "$WIN/loop/run-loop.sh" -a -f "$WIN/loop/run-loop.cmd" \
  -a -f "$WIN/loop/dispatch.mjs" -a -f "$WIN/loop/dispatch.sh" -a -f "$WIN/loop/dispatch.cmd"
expect "the autonomous loop and named dispatcher each ship one Node entry point plus POSIX and Windows wrappers" $?
node -e "
const fs=require('fs');
// The wrappers must stay wrappers. A second implementation of the gate is a second thing to drift,
// and it drifts toward whichever one the person making the change happens to run.
const sh=fs.readFileSync('$WIN/init.sh','utf8'), cmd=fs.readFileSync('$WIN/init.cmd','utf8');
const shLogic=sh.split('\n').filter(l=>l.trim() && !l.trim().startsWith('#')).length;
process.exit(/exec node .*init\.mjs/.test(sh) && /node .*init\.mjs/.test(cmd) && shLogic<=5 ? 0 : 1);
"; expect "both wrappers just exec init.mjs — no second copy of the verification logic" $?
node -e "
const fs=require('fs'), root='$WIN/loop/';
for (const base of ['run-loop','dispatch']) {
  const sh=fs.readFileSync(root+base+'.sh','utf8'), cmd=fs.readFileSync(root+base+'.cmd','utf8');
  if (!new RegExp('node .*'+base+'\\.mjs').test(sh) || !new RegExp('node .*'+base+'\\.mjs').test(cmd)) process.exit(1);
  if (/kiro-cli|claude -p|case .*RUNTIME|route\.mjs/.test(sh+cmd)) process.exit(1);
}
"; expect "loop wrappers contain no routing or runtime logic that could drift between shells" $?
node -e "
const fs=require('fs'),p='$WIN/feature_list.json',j=require(p);
for (const f of j.features) { f.status='done'; f.readyForCheck=false; }
fs.writeFileSync(p,JSON.stringify(j,null,2)+'\n');
"
( cd "$WIN" && node loop/run-loop.mjs --headless > "$WIN/settled.log" 2>&1 )
grep -q "nothing to do" "$WIN/settled.log"
expect "the Node loop executes without Bash and preserves its mechanical early-stop contract" $?
# A maker checkpoint used to summon checker unconditionally, even when the feature-level behavior
# was incomplete. Exercise the driver with a fake runtime: maker leaves readyForCheck=false, so a
# checker process is proof of the bug rather than an implementation detail.
BATCH="$WORK/review-batch"; mkdir -p "$BATCH/loop" "$BATCH/bin"
cp "$SCRIPTS/../templates/tree/loop/run-loop.mjs" "$BATCH/loop/run-loop.mjs"
cp "$SCRIPTS/../templates/tree/loop/dispatch.mjs" "$BATCH/loop/dispatch.mjs"
mkdir -p "$BATCH/tools"
cp "$SCRIPTS/../templates/tree/tools/kiro-acp-dispatch.mjs" "$BATCH/tools/kiro-acp-dispatch.mjs"
printf '%s\n' '#!/usr/bin/env node' 'process.stdout.write(JSON.stringify({node:"maker",kind:"agent",layer:"implementation",why:"incomplete feature"}));' > "$BATCH/loop/route.mjs"
printf '%s\n' '#!/usr/bin/env node' 'process.exit(0);' > "$BATCH/init.mjs"
printf '%s\n' '{"features":[{"id":"feat-partial","status":"active","readyForCheck":false,"checkerNotes":"","attempts":0,"maxAttempts":3}]}' > "$BATCH/feature_list.json"
cp "$SCRIPTS/fixtures/fake-kiro-acp.mjs" "$BATCH/bin/kiro-cli"
chmod +x "$BATCH/bin/kiro-cli"
( cd "$BATCH" && PATH="$BATCH/bin:$PATH" KIRO_API_KEY=fake HARNESS_RUNTIME=kiro HARNESS_FAKE_RUNTIME_LOG="$BATCH/runtime.log" node loop/run-loop.mjs 1 --headless > "$BATCH/run.log" 2>&1 )
test "$(grep -c -- '--agent maker' "$BATCH/runtime.log")" = "1" -a "$(grep -c -- '--agent checker' "$BATCH/runtime.log" || true)" = "0" \
  && grep -q 'checker skipped: maker recorded a checkpoint' "$BATCH/run.log" \
  && grep -q 'only when the whole feature-level.*behavior' "$SCRIPTS/../templates/tree/loop/maker-prompt.md" \
  && grep -q 'counts failed review cycles, not maker checkpoints' "$SCRIPTS/../templates/tree/loop/checker-prompt.md"
expect "partial maker checkpoints do not dispatch checker; only complete feature-level claims do" $?
# A maker can still set readyForCheck too early. Admission classifies that as mechanically
# incomplete, skips checker, and does not spend the semantic attempts budget.
cp "$SCRIPTS/../templates/tree/tools/review-contract.mjs" "$BATCH/tools-review-contract.mjs"
mkdir -p "$BATCH/tools"; cp "$BATCH/tools-review-contract.mjs" "$BATCH/tools/review-contract.mjs"
printf '%s\n' '{"features":[{"id":"feat-review","behavior":"returns one result","verification":"node -e \"process.exit(0)\"","falsifier":"returns no result","dependencies":[],"context":{"touches":["src/x.ts"],"note":"public seam"},"status":"active","readyForCheck":true,"checkerNotes":"","attempts":0,"maxAttempts":3}]}' > "$BATCH/feature_list.json"
: > "$BATCH/runtime.log"
( cd "$BATCH" && PATH="$BATCH/bin:$PATH" KIRO_API_KEY=fake HARNESS_RUNTIME=kiro HARNESS_FAKE_RUNTIME_LOG="$BATCH/runtime.log" node loop/run-loop.mjs 1 --headless > "$BATCH/admission-red.log" 2>&1 )
test "$(grep -c -- '--agent checker' "$BATCH/runtime.log" || true)" = "0" \
  && grep -q 'SUBMISSION_INCOMPLETE' "$BATCH/admission-red.log" \
  && grep -q '"attempts":0' "$BATCH/feature_list.json"
expect "an incomplete reviewPacket skips checker without spending an attempt" $?
node -e "
const fs=require('fs'),cp=require('child_process'),p='$BATCH/feature_list.json';
const j=JSON.parse(fs.readFileSync(p,'utf8'));
const report=JSON.parse(cp.spawnSync(process.execPath,['tools/review-contract.mjs','feat-review','--json'],{cwd:'$BATCH',encoding:'utf8'}).stdout);
j.features[0].reviewPacket={contractDigest:report[0].contractDigest,claimRefs:['feat-review'],changedPaths:['src/x.ts'],runs:[{cmd:j.features[0].verification,exit:0,result:'passed'}],adversarialChecks:{scope:'covered',cleanup:'not-applicable: pure function',errorPath:'covered',concurrency:'not-applicable: synchronous',realBoundary:'not-applicable: pure function',discrimination:'a version that returns the input unchanged would still pass, because no case supplies a value the transform must alter'},residualUnknowns:[]};
fs.writeFileSync(p,JSON.stringify(j,null,2)+'\n');
"
( cd "$BATCH" && node tools/review-contract.mjs feat-review >/dev/null )
expect "a digest-current reviewPacket with the public rubric is admitted" $?
node -e "
const fs=require('fs'),p='$BATCH/feature_list.json',j=JSON.parse(fs.readFileSync(p,'utf8'));
Object.assign(j.features[0],{status:'in-progress',readyForCheck:false,checkerNotes:'REJECT: cleanup claim survived'});
fs.writeFileSync(p,JSON.stringify(j,null,2)+'\n');
"
node "$SCRIPTS/verify-harness.mjs" --target "$BATCH" --skip-baseline --report "$BATCH/review-report.json" --quiet >/dev/null 2>&1 || true
node -e "const r=require('$BATCH/review-report.json'); process.exit(r.findings.some(f=>f.gate==='review-contract'&&f.id==='verdict-incomplete')?0:1)"
expect "a prose-only semantic REJECT is refused after typed admission" $?
node -e "
const fs=require('fs'),p='$BATCH/feature_list.json',j=JSON.parse(fs.readFileSync(p,'utf8'));
j.features[0].checkerVerdict={status:'reject',basis:'novel-counterexample',violatedRef:'feat-review',counterexample:'cleanup is a no-op',reproduction:'apply cleanup mutant; run verification',observed:'verification remains green',exitCriterion:'verification fails when cleanup is disabled'};
fs.writeFileSync(p,JSON.stringify(j,null,2)+'\n');
"
node "$SCRIPTS/verify-harness.mjs" --target "$BATCH" --skip-baseline --report "$BATCH/review-report.json" --quiet >/dev/null 2>&1 || true
node -e "const r=require('$BATCH/review-report.json'); process.exit(r.findings.some(f=>f.gate==='review-contract'&&f.id==='verdict-incomplete')?1:0)"
expect "an actionable structured REJECT clears the verdict-contract gate" $?
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
printf '| id | Assumption | Status | If false | Recommended answer | Depended on by |\n|---|---|---|---|---|---|\n' > "$CO/docs/assumptions.md"
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

# The design-facilitator answers a NEEDS DESIGN: question but may not write feature_list.json — it
# is forbidden to write scope — so it cannot clear the marker that asked. Observed live on
# aeron-demo (with the role then named `designer`): it settled feat-sit-2 in DECISIONS.md, and the
# router named the same agent again, forever.
FU="$WORK/follow-up"; rm -rf "$FU"; mkdir -p "$FU"
node "$SCRIPTS/setup-harness-loop.mjs" --target "$FU" --name "FollowUp" --purpose "routable review debt" >/dev/null
node -e "
const fs=require('fs'),p='$FU/feature_list.json',fl=JSON.parse(fs.readFileSync(p));
fl.features=[{id:'feat-approved',name:'approved',behavior:'b',verification:'echo ok',falsifier:'wrong',kind:'prove',dependencies:[],status:'done',readyForCheck:false,evidence:'red then green',checkerNotes:'FOLLOW-UP: remove the deprecated overload',attempts:1,maxAttempts:3}];
fs.writeFileSync(p,JSON.stringify(fl,null,2));
"
(cd "$FU" && node loop/route.mjs --json) > /tmp/demo-follow-up.$$
node -e "const r=require('fs').readFileSync('/tmp/demo-follow-up.$$','utf8'); const j=JSON.parse(r); process.exit(j.node==='feature-planner'&&j.feature==='feat-approved'?0:1)"
expect "an approved feature's actionable FOLLOW-UP routes to explicit planning" $?
rm -f /tmp/demo-follow-up.$$
MK="$WORK/marker"; rm -rf "$MK"; mkdir -p "$MK/docs/design"
node "$SCRIPTS/setup-harness-loop.mjs" --target "$MK" --name "Marker" --purpose "stale markers" >/dev/null
# The assumptions template contains a commented example. The router must ignore documentation, so
# this fixture reaches the design→decomposition handoff without rewriting the template first.
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
[ "$(route_of)" = "design-facilitator" ]; expect "a NEEDS DESIGN: marker the design-facilitator has not seen routes to it" $?
dispatched
# The design-facilitator answers but CANNOT clear the marker — it may not write feature_list.json.
[ "$(route_of)" = "feature-planner" ]; expect "after the design-facilitator's turn the same marker routes to the planner, the only node that may clear it" $?
# Appending evidence below the marker is not a new request. Previously the whole notes body was
# hashed, so this restarted the ladder at the design layer.
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
[ "$(route_of)" = "design-facilitator" ]; expect "a NEW question on the same feature restarts the ladder at the design-facilitator" $?
node -e "
const fs=require('fs'); const p='$MK/feature_list.json';
const d=JSON.parse(fs.readFileSync(p,'utf8'));
d.features.find(x=>x.id==='feat-q').checkerNotes='resolved: first reading, see docs/design/q.md';
fs.writeFileSync(p, JSON.stringify(d,null,2));
"
[ "$(route_of)" != "design-facilitator" ] && [ "$(route_of)" != "human" ]; expect "clearing the marker returns the loop to ordinary routing" $?

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

# Design approval is a typed edge keyed by the design digest: unapproved → human, always — there is
# no agent to bounce back to any more, and therefore no retry counter to reset by editing the design
# a little each round (the failure this replaced: graph.md row 11).
printf '# Design\n\nObservable seam: command output. Invariant: always preserves input identity.\n\n%s\n' "$(printf 'detail %.0s' {1..30})" > "$MK/docs/design/reviewed.md"
[ "$(route_of)" = "human" ]; expect "an unapproved design revision routes straight to a human, not an agent" $?
APPROVAL_JSON="$(cd "$MK" && node loop/route.mjs --json)"; APPROVAL_DIGEST="$(printf '%s' "$APPROVAL_JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).detail))')"
# A malformed or wrong-digest approval file must not count — only an exact digest match unblocks.
printf '{"schema":"design-approval/1","designDigest":"stale-digest-does-not-match","status":"approved","approvedBy":"demo-human","approvedAt":"2026-08-18","decisions":[],"acceptedRisks":[]}\n' > "$MK/loop/design-approval.json"
[ "$(route_of)" = "human" ]; expect "an approval for the wrong digest does not unblock the loop" $?
printf '{"schema":"design-approval/1","designDigest":"%s","status":"approved","approvedBy":"demo-human","approvedAt":"2026-08-18","decisions":["accepted the observable seam as written"],"acceptedRisks":[]}\n' "$APPROVAL_DIGEST" > "$MK/loop/design-approval.json"
[ "$(route_of)" != "human" ]; expect "a human approval matching the exact current digest unblocks the loop" $?
# Edit the design after approval, even by appending one line, and the digest changes — the approval
# silently stops matching. No agent can restart the loop; only a fresh human approval can.
printf '\nAppended after approval.\n' >> "$MK/docs/design/reviewed.md"
[ "$(route_of)" = "human" ]; expect "editing an approved design invalidates its approval automatically — no expiry step, no partial credit" $?

# A loop you cannot watch is a loop you cannot correct. Early on the whole value is a human seeing
# where it goes wrong and fixing the harness; unattended is what you graduate to.
LS="$WORK/status"; rm -rf "$LS"; mkdir -p "$LS"
node "$SCRIPTS/setup-harness-loop.mjs" --target "$LS" --name "Status" --purpose "visibility" >/dev/null
test -f "$LS/tools/loop-status.mjs"; expect "every scaffold gets a live status view, not only the after-the-fact report" $?
node "$SCRIPTS/../scripts/loop-status.mjs" --target "$LS" --json > "$LS/st.json" 2>/dev/null
node -e "
const s=require('$LS/st.json');
// the question a human has mid-run: where is it, and where is it going next
process.exit(s.next && typeof s.features.total==='number' &&
  s.progress && s.progress.done===0 && s.progress.total===3 &&
  s.progress.remaining===3 && s.progress.percent===0 && Array.isArray(s.dispatched) ? 0 : 1);
"; expect "it answers where the loop is and what the router would do next" $?
node -e "
const fs=require('fs'), p='$LS/feature_list.json', d=JSON.parse(fs.readFileSync(p));
d.features[0].status='done'; fs.writeFileSync(p,JSON.stringify(d,null,2));
"
node "$SCRIPTS/../scripts/loop-status.mjs" --target "$LS" 2>/dev/null | grep -q "progress  1/3 done (33%)   2 remaining"
expect "the live view shows canonical done/total/percent/remaining progress after state changes" $?
mkdir -p "$LS/loop"
for i in 1 2 3 4; do echo '{"node":"design-facilitator","feature":"feat-x","hash":"abc"}' >> "$LS/loop/route-log.jsonl"; done
node "$SCRIPTS/../scripts/loop-status.mjs" --target "$LS" 2>/dev/null | grep -q "livelock"
expect "four identical dispatches in a row are called a livelock, in the view a human is already reading" $?
node -e "
const fs=require('fs');
fs.writeFileSync('$LS/loop/current.json', JSON.stringify({node:'maker',feature:'feat-x',iteration:2,startedAt:Date.now()-90000}));
"
node "$SCRIPTS/../scripts/loop-status.mjs" --target "$LS" 2>/dev/null | grep -qE "RUNNING +maker on feat-x +1m30s"
expect "an in-flight agent shows what it is, on what, and for how long" $?
# Attended by default, and it must never block where nobody can answer.
grep -q 'let attended = .*HARNESS_ATTENDED' "$LS/loop/run-loop.mjs"
expect "the loop is attended by default — unattended is the thing you graduate to" $?
( cd "$LS" && HARNESS_RUNTIME=kiro node loop/run-loop.mjs 1 < /dev/null 2>&1 | head -2 ) > "$LS/notty.log"
grep -q "no TTY on stdin — running headless" "$LS/notty.log"
expect "with no TTY it falls back to headless and says so, instead of blocking on a prompt nobody can answer" $?
grep -q 'find((arg) => /^\\d+\$/.test(arg)) || 1' "$LS/loop/run-loop.mjs"
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
             && /Never answer it yourself/.test(t) && /runtime's native sub-agent facility/.test(t)
             && /exact role/.test(t) && /one child active at a time/.test(t) ? 0 : 1);
"; expect "its prompt makes native single-agent spawn primary without letting the LLM choose the node" $?
node -e "
const t=require('fs').readFileSync('$OR/prompts/orchestrator.md','utf8').replace(/\s+/g,' ');
// The fan-out exception has to be bounded in the same prompt that grants it, or 'spawn several'
// becomes the general case the first time an agent finds parallelism attractive.
process.exit(/mode: slice-fanout/.test(t) && /Never fan out the test run/.test(t)
             && /Spawn several agents on your own judgement/.test(t) ? 0 : 1);
"; expect "the one parallel exception is granted by the router's mode, never by the orchestrator's judgement, and never over the test run" $?
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
             /do you need me/i.test(t) && /Suppress the routine/i.test(t) &&
             /After every sub-agent return/i.test(t) &&
             /Progress: <done>\/<total> done \(<percent>%\), <remaining> remaining/.test(t) ? 0 : 1);
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
# not: dispatch() was a private function inside run-loop.sh, which only ever ran the node the
# ROUTER named. Only Codex had a standalone path, so the gap was invisible on that runtime.
DP="$WORK/dispatch"; rm -rf "$DP"; mkdir -p "$DP/bin"
node "$SCRIPTS/setup-harness-loop.mjs" --target "$DP" --name "Disp" --purpose "named dispatch" >/dev/null
test -f "$DP/loop/dispatch.mjs" -a -f "$DP/loop/dispatch.cmd" -a -x "$DP/loop/dispatch.sh"; expect "every scaffold ships a runtime-agnostic way to dispatch one named agent" $?
cp "$SCRIPTS/fixtures/fake-kiro-acp.mjs" "$DP/bin/kiro-cli"; chmod +x "$DP/bin/kiro-cli"
( cd "$DP" && PATH="$DP/bin:$PATH" KIRO_API_KEY=x HARNESS_RUNTIME=kiro HARNESS_FAKE_RUNTIME_LOG="$DP/runtime.log" node loop/dispatch.mjs design-facilitator "decided" ) > "$DP/d.log" 2>&1
grep -q "\[stub\]" "$DP/d.log" && grep -q '^acp --agent design-facilitator --trust-all-tools$' "$DP/runtime.log"; expect "it runs the named agent through an ACP session, not headless chat" $?
( cd "$DP" && PATH="$DP/bin:$PATH" KIRO_API_KEY=x HARNESS_RUNTIME=kiro HARNESS_FAKE_RUNTIME_OUTPUT="Monthly request limit reached; resets later" node loop/dispatch.mjs design-facilitator "decided" ) > "$DP/q.log" 2>&1
QC=$?; [ "$QC" = "75" ] && grep -q "runtime refused" "$DP/q.log"
expect "a quota refusal that exits zero is classified as no agent work" $?
( cd "$DP" && PATH="$DP/bin:$PATH" KIRO_API_KEY=x HARNESS_RUNTIME=kiro HARNESS_FAKE_RUNTIME_OUTPUT="PreToolUse hook returned unsupported permissionDecision:allow" node loop/dispatch.mjs design-facilitator "decided" ) > "$DP/hook.log" 2>&1
HC=$?; [ "$HC" = "75" ] && grep -q "runtime refused" "$DP/hook.log"
expect "a hook-contract failure that exits zero is refused instead of accepting unconfined agent work" $?
( cd "$DP" && PATH="$DP/bin:$PATH" KIRO_API_KEY=x HARNESS_RUNTIME=kiro node loop/dispatch.mjs ghost "x" ) > "$DP/g.log" 2>&1
GC=$?; grep -q "no agent" "$DP/g.log" && [ "$GC" = "2" ]
expect "an agent that is not in the manifest is refused, rather than dispatched into nothing" $?
node -e "
const fs=require('fs');
// one implementation of 'how do I start an agent here'. Two copies is two things to drift, and the
// runtimes are exactly where drift is invisible.
const rl=fs.readFileSync('$DP/loop/run-loop.mjs','utf8');
process.exit(rl.includes('./dispatch.mjs') && !rl.includes('kiro-cli chat --agent') ? 0 : 1);
"; expect "run-loop.mjs imports one dispatcher instead of keeping a second runtime implementation" $?
node -e "
const fs=require('fs'); const op=fs.existsSync('$DP/prompts/orchestrator.md')?'$DP/prompts/orchestrator.md':(fs.existsSync('$DP/harness/prompts/orchestrator.md')?'$DP/harness/prompts/orchestrator.md':'$SCRIPTS/../templates/tree/prompts/orchestrator.md');
const t=fs.readFileSync(op,'utf8').replace(/\s+/g, ' ');
process.exit(t.includes('design-facilitator') && t.includes('node loop/dispatch.mjs') ? 0 : 1);
"; expect "and human decisions use native owner spawn first, with named dispatch only as fallback" $?

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
process.exit(j.changed.length===0 && j.added.length===0 && j.drifted.length===0 &&
  j.same>0 && Array.isArray(j.upgradeContext) && j.upgradeContext.length===0 ? 0 : 1);
"; expect "a freshly scaffolded target needs no upgrade and reports no drift" $?
# age it the way a real target ages
printf '#!/usr/bin/env bash\necho old\n' > "$UP/loop/route.mjs"
rm -f "$UP/loop/dispatch.sh" "$UP/tools/feature.mjs"
printf '\n<!-- this project: never touch the ledger -->\n' >> "$UP/prompts/design-facilitator.md"
node -e "const fs=require('fs'),p='$UP/agents.manifest.json',j=require(p),a=structuredClone(j.agents.find(x=>x.name==='maker'));a.name='context-interviewer';j.agents.push(a);fs.writeFileSync(p,JSON.stringify(j,null,2)+'\n')"
node "$SCRIPTS/upgrade-harness.mjs" --target "$UP" --json > "$UP/aged.json" 2>/dev/null
node -e "
const j=require('$UP/aged.json');
process.exit(j.changed.includes('loop/route.mjs') && j.added.includes('loop/dispatch.sh')
  && j.added.includes('tools/feature.mjs') ? 0 : 1);
"; expect "stale machinery is refreshed and missing machinery is added" $?
node -e "
const j=require('$UP/aged.json'),c=j.upgradeContext.find(x=>x.id==='HUC-2026-08-16-node-native-loop');
process.exit(c && c.why && c.targetImpact && c.paths.includes('loop/dispatch.sh') &&
  c.mergeActions.length && c.verification.length ? 0 : 1);
"; expect "the upgrade report carries canonical reason, impact, merge actions and verification for the target's actual diff" $?
node -e "
const j=require('$UP/aged.json');
// the customised prompt is REPORTED, never overwritten — merge, don't overwrite
process.exit(j.drifted.includes('prompts/design-facilitator.md') ? 0 : 1);
"; expect "a customised prompt is reported as drift, not silently replaced" $?
grep -q "never touch the ledger" "$UP/prompts/design-facilitator.md"
expect "and the customisation is still there afterwards" $?
node -e "const j=require('$UP/aged.json');process.exit(j.retiredAgents.includes('context-interviewer')?0:1)"
expect "upgrade reports the retired interview agent for an explicit manifest merge" $?
node "$SCRIPTS/../onboarding-skills/harness-upgrade/scripts/plan-upgrade.mjs" --report "$UP/aged.json" --target "$UP" --output "$UP/upgrade-plan.json"
cp "$UP/upgrade-plan.json" "$UP/upgrade-plan-context-lost.json"
node -e "const fs=require('fs'),p='$UP/upgrade-plan-context-lost.json',j=require(p);delete j.upgradeContext;fs.writeFileSync(p,JSON.stringify(j,null,2)+'\n')"
node "$SCRIPTS/../onboarding-skills/harness-upgrade/scripts/check-upgrade-plan.mjs" "$UP/upgrade-plan-context-lost.json" > "$UP/upgrade-plan-context-lost.out"; [ "$?" = "1" ] && grep -q 'upgrade-context-lost' "$UP/upgrade-plan-context-lost.out"
expect "a refreshed checker catches context dropped by an older target-local planner" $?
node "$SCRIPTS/../onboarding-skills/harness-upgrade/scripts/check-upgrade-plan.mjs" "$UP/upgrade-plan.json" > "$UP/upgrade-plan-red.json"; [ "$?" = "1" ] && grep -q 'drift-unresolved' "$UP/upgrade-plan-red.json" && grep -q 'retirement-unresolved' "$UP/upgrade-plan-red.json" && grep -q 'dirty-state-unrecorded' "$UP/upgrade-plan-red.json" && grep -q 'upgrade-context-unacknowledged' "$UP/upgrade-plan-red.json" && grep -q 'upgrade-context-disposition-missing' "$UP/upgrade-plan-red.json"
expect "the upgrade skill refuses unresolved drift, retirement, dirty state or canonical update context" $?
node -e "const fs=require('fs'),p='$UP/upgrade-plan.json',j=require(p);j.preexistingDirty=false;j.merge.forEach(x=>x.status='merged');j.retire.forEach(x=>{x.status='retired';x.stateDisposition='template-only, removed'});j.upgradeContext.forEach(x=>{x.status='applied';x.disposition='Node entry points merged; target customization preserved'});fs.writeFileSync(p,JSON.stringify(j,null,2)+'\n')"
node "$SCRIPTS/../onboarding-skills/harness-upgrade/scripts/check-upgrade-plan.mjs" "$UP/upgrade-plan.json" >/dev/null
expect "a reviewed ownership-aware plan with retirement disposition becomes executable" $?
UC="$WORK/upgrade-context-gate"; mkdir -p "$UC/harness-loop/templates/tree" "$UC/harness-loop/scripts"
cp "$SCRIPTS/check-upgrade-context.mjs" "$UC/harness-loop/scripts/check-upgrade-context.mjs"
printf '{"schema":"harness-upgrade-context/1","entries":[]}\n' > "$UC/harness-loop/upgrade-context.json"
printf 'v1\n' > "$UC/harness-loop/templates/tree/x.txt"
( cd "$UC" && git init -q && git add -A && git -c user.email=d@d -c user.name=d commit -qm context-base )
printf 'v2\n' > "$UC/harness-loop/templates/tree/x.txt"
node "$UC/harness-loop/scripts/check-upgrade-context.mjs" --target "$UC" > "$UC/red.json"; [ "$?" = "1" ] && grep -q 'working-tree' "$UC/red.json"
expect "a harness change without a same-change context ledger update is mechanically red" $?
printf ' {"id":"fixture"}\n' >> "$UC/harness-loop/upgrade-context.json"
node "$UC/harness-loop/scripts/check-upgrade-context.mjs" --target "$UC" >/dev/null
expect "updating the ledger beside the harness change clears the producer-side gate" $?
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
process.exit(/human/.test(t) && !/context-interviewer/.test(t) && /feature-planner/.test(t) && /test-implementer/.test(t)
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
// ephemeral: always ignored, while the adoption baseline is explicitly rescued below it
process.exit(has('trace/*') && has('!trace/adoption-baseline.json') &&
  has('loop/current.json') && has('loop/route-log.jsonl') ? 0 : 1);
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
// the design-facilitator and planner both loaded the orientation doc; the agent that actually
// navigates the codebase did not
process.exit(mk.resources.includes('docs/architecture.md') ? 0 : 1);
"; expect "the maker loads docs/architecture.md — the map the design-facilitator maintains, for the agent that navigates" $?
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
for (const f of d.features) f.status='done';
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
( cd "$RN" && node loop/route.mjs --json ) | grep -q "no complete feature-linked condition"
expect "and the reason names the missing artifact, not the directory that happens to exist" $?
printf '{"id":"TCON-X-0001","requirement_id":"INV-X-1"}' > "$RN/tests/design/plans/TP-X-0001/conditions/TCON-X-0001.json"
node -e "const fs=require('fs'); const p='$RN/feature_list.json'; const d=JSON.parse(fs.readFileSync(p,'utf8')); d.features.find(f=>f.id==='feat-oracle').conditions=['TCON-X-0001']; fs.writeFileSync(p,JSON.stringify(d,null,2));"
[ "$(route_n)" = "test-implementer" ]; expect "once a real TCON-*.json citing the falsifier's invariant exists, the implementer is dispatchable" $?
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

# A reading list still makes the maker rediscover the design-facilitator's conclusions. A feature context
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

step 40 "user-scope communication skill: thin routing, provenance and visual judgment"
USR="$WORK/user-skills"
KIRO_USER_HOME="$WORK/kiro-home"
node "$SCRIPTS/install-user-skill.mjs" --name human-presenter --skills-root "$USR" --kiro-home "$KIRO_USER_HOME" >/dev/null
test -f "$USR/human-presenter/SKILL.md" -a -f "$USR/human-presenter/references/visuals.md" -a -f "$USR/human-presenter/EXTEND.md"
expect "human-presenter installs as a self-contained user-scope skill with progressive references and overlay" $?
node -e "
const fs=require('fs'),p='$KIRO_USER_HOME/steering/harness-skill-human-presenter.md';
const s=fs.readFileSync(p,'utf8');
process.exit(/inclusion: always/.test(s) && /Before every substantive/.test(s) &&
  s.includes('$USR/human-presenter/SKILL.md') && !s.includes('{{SKILL_PATH}}') ? 0 : 1);
"; expect "Kiro receives an always-loaded bridge to the installed human-presenter skill" $?
node -e "
const fs=require('fs'),p='$USR/human-presenter';
const s=fs.readFileSync(p+'/SKILL.md','utf8');
process.exit(/before ALL meaningful answers/.test(s) && /Fast path/.test(s) && /baoyu-diagram/.test(s) &&
  !/dark-themed/.test(s) && fs.readdirSync(p+'/references/modes').length===3 ? 0 : 1);
"; expect "the always-on contract stays lightweight and routes visuals instead of forcing a style" $?
cat > "$WORK/presentation-good.json" <<'JSON'
{"audience":"engineering lead","intent":"recommendation","governingThought":"replace fixed sleep with bounded polling","claims":[{"id":"O1","text":"lag observed after deploy","kind":"runtime-observation"},{"id":"S1","text":"projection is asynchronous","kind":"source-fact","sources":["Consumer.java:42"]},{"id":"I1","text":"fixed sleep can become flaky","kind":"inference","derivedFrom":["O1","S1"]},{"id":"R1","text":"use bounded polling","kind":"recommendation"}],"representation":{"type":"prose","reason":"one causal conclusion is clear without a visual"},"counterCase":"polling adds driver complexity","nextAction":"replace synchronization in the focused journey"}
JSON
node "$USR/human-presenter/scripts/check-presentation.mjs" "$WORK/presentation-good.json" >/dev/null
expect "a source-bound, derived recommendation plan passes the structural audit" $?
cat > "$WORK/presentation-bad.json" <<'JSON'
{"audience":"user","intent":"recommendation","governingThought":"do it","claims":[{"id":"S1","text":"claimed fact","kind":"source-fact"},{"id":"I1","text":"unsupported inference","kind":"inference"}],"representation":{"type":"architecture","reason":"looks professional"}}
JSON
node "$USR/human-presenter/scripts/check-presentation.mjs" "$WORK/presentation-bad.json" > "$WORK/presentation-bad.out"; [ "$?" = "1" ] && grep -q 'source-fact-unbound' "$WORK/presentation-bad.out" && grep -q 'inference-unbound' "$WORK/presentation-bad.out" && grep -q 'decorative-visual' "$WORK/presentation-bad.out" && grep -q 'countercase-missing' "$WORK/presentation-bad.out"
expect "the audit rejects unbound claims, decorative visuals and one-sided recommendations" $?
node "$SCRIPTS/install-user-skill.mjs" --name human-presenter --skills-root "$USR" --kiro-home "$KIRO_USER_HOME" >/dev/null 2>&1; [ "$?" = "3" ]
expect "user customization is not overwritten without explicit --force" $?

step 41 "human interview: keep discovery context and stop the router at the person"
node "$SCRIPTS/install-user-skill.mjs" --name human-interview --skills-root "$USR" --kiro-home "$KIRO_USER_HOME" >/dev/null
test -f "$USR/human-interview/SKILL.md" -a -f "$USR/human-interview/references/question-design.md" -a -f "$USR/human-interview/references/persistence.md"
expect "human-interview installs as a user-scope capability with progressive references" $?
node -e "
const fs=require('fs'),p='$KIRO_USER_HOME/steering/harness-skill-human-interview.md';
const s=fs.readFileSync(p,'utf8');
process.exit(/inclusion: always/.test(s) && /When progress depends/.test(s) &&
  /does not make every\s+conversation an interview/.test(s) && s.includes('$USR/human-interview/SKILL.md') ? 0 : 1);
"; expect "Kiro always sees the human-interview trigger without invoking it on every turn" $?
cat > "$WORK/question-good.json" <<'JSON'
{"id":"fault.restart","title":"Matching restart permission","need":"May the journey restart matching after FIX acknowledgement?","impact":"determines whether recovery/idempotency is in the executable plan","answerContract":"approve|deny plus environment scope","evidenceChecked":["services.manifest.json:matching","runbook.md#restart"],"humanOwnedReason":"the repositories expose the mechanism but not authorization","options":["approve in isolated namespace","deny"],"recommendation":{"value":"approve in isolated namespace","basis":"reversible and needed to test recovery"},"dependsOn":[],"sameRound":[]}
JSON
node "$USR/human-interview/scripts/check-question.mjs" "$WORK/question-good.json" >/dev/null
expect "an evidence-exhausted human-owned question passes the capability audit" $?
cat > "$WORK/question-bad.json" <<'JSON'
{"id":"q","title":"Choose","need":"What should we do?","impact":"unknown","answerContract":"yes","evidenceChecked":[],"options":["yes"],"recommendation":{"value":"yes"},"dependsOn":["upstream"],"sameRound":["upstream"]}
JSON
node "$USR/human-interview/scripts/check-question.mjs" "$WORK/question-bad.json" > "$WORK/question-bad.out"; [ "$?" = "1" ] && grep -q 'evidence-unchecked' "$WORK/question-bad.out" && grep -q 'human-ownership-unproven' "$WORK/question-bad.out" && grep -q 'false-choice' "$WORK/question-bad.out" && grep -q 'frontier-invalid' "$WORK/question-bad.out"
expect "the audit rejects lazy, false-choice and dependency-invalid questions" $?
HIT="$WORK/interview-route"; rm -rf "$HIT"; mkdir -p "$HIT"
node "$SCRIPTS/setup-harness-loop.mjs" --target "$HIT" --name "Interview Route" --purpose "prove in-context human checkpoint" >/dev/null
! grep -Rqs 'context-interviewer' "$HIT/.kiro" "$HIT/.claude" "$HIT/.codex" "$HIT/agents.manifest.json" && [ ! -e "$HIT/prompts/context-interviewer.md" ]
expect "fresh targets receive no dedicated interview agent, prompt or runtime config" $?
printf '| A-1 | matching restart is permitted | needs-human | none |\n' >> "$HIT/docs/assumptions.md"
( cd "$HIT" && node loop/route.mjs --json ) > "$HIT/interview-route.json"
node -e "const r=require('$HIT/interview-route.json');process.exit(r.node==='human'&&r.kind==='human'&&/human-interview/.test(r.why)?0:1)"
expect "needs-human stops at the person and tells the current agent to use human-interview" $?

CE="$WORK/capability-eval.json"
AB="$WORK/dormant-adoption"; rm -rf "$AB"; cp -R "$T3" "$AB"; rm -f "$AB/trace/adoption-baseline.json"
node -e "const fs=require('fs'),p='$AB/feature_list.json',f=JSON.parse(fs.readFileSync(p)); for(const x of f.features) delete x.kind; fs.writeFileSync(p,JSON.stringify(f,null,2))"
node "$SCRIPTS/adoption-baseline.mjs" --target "$AB" --record --note dormant >/dev/null
node -e "const fs=require('fs'),p='$AB/feature_list.json',f=JSON.parse(fs.readFileSync(p)); f.features[0].kind='build'; fs.writeFileSync(p,JSON.stringify(f,null,2))"
node "$SCRIPTS/adoption-baseline.mjs" --target "$AB" --json > /tmp/demo-dormant.$$
node -e "const r=JSON.parse(require('fs').readFileSync('/tmp/demo-dormant.$$')); process.exit(r.grown.length===0&&r.newlyMeasured.some(x=>x.family==='build-unproven')?0:1)"
expect "an opt-in gate becoming observable is newly measured, not new debt" $?
rm -f /tmp/demo-dormant.$$
cat > "$CE" <<'EOF'
{"arms":["baseline","candidate"],"resourceOwning":true,"isolation":{"mode":"per-run-port","key":"HARNESS_RUN_ID"},"claims":[{"text":"events use the envelope","boundary":"publication","verificationBoundary":"publication","productionTouchpoints":["src/main/EventPublisher.java"]}]}
EOF
node "$SCRIPTS/check-capability-eval.mjs" "$CE" >/dev/null
expect "paired capability evals declare resource isolation and matching oracle boundaries" $?
node -e "const fs=require('fs'),p='$CE',c=require(p); c.isolation={mode:'shared'}; c.claims[0].verificationBoundary='codec'; c.claims[0].productionTouchpoints=[]; fs.writeFileSync(p,JSON.stringify(c))"
node "$SCRIPTS/check-capability-eval.mjs" "$CE" >/dev/null 2>&1; CERC=$?
[ "$CERC" != "0" ]; expect "shared ports and codec-only proof cannot produce a publication benchmark verdict" $?

step 42 "meta loop: dispatch on the right layer, stop when nothing moves"
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
cp "$SCRIPTS/fixtures/fake-kiro-acp.mjs" "$STUBBIN/kiro-cli"
chmod +x "$STUBBIN/kiro-cli"
echo '{ "name": "demo-target", "private": true }' > "$T/package.json"   # make the baseline greenable
printf '| id | Assumption | Status | If false | Recommended answer | Depended on by |\n|---|---|---|---|---|---|\n' > "$T/docs/assumptions.md"
PATH="$STUBBIN:$PATH" KIRO_API_KEY=demo-stub bash "$SCRIPTS/harness-loop.sh" --target "$T" --runner kiro --iterations 3 \
  > /tmp/demo-meta.$$ 2>&1
tail -25 /tmp/demo-meta.$$
grep -Eq "canonical workflow state repeated|router: features are open but no rule routes them" /tmp/demo-meta.$$; expect "loop stops itself on a repeated state or bounded human checkpoint instead of spinning forever" $?
rm -f /tmp/demo-meta.$$

step 43 "contained layout: one harness home, thin runtime adapters, observable uncommitted changes"
CT="$WORK/contained"; rm -rf "$CT"; mkdir -p "$CT"
printf '{"name":"contained-demo","private":true,"scripts":{"test":"node -e \\"process.exit(0)\\""}}\n' > "$CT/package.json"
HARNESS_LAYOUT=contained node "$SCRIPTS/setup-harness-loop.mjs" --target "$CT" --name "Contained" --purpose "single harness home" --runtime all >/dev/null
test -d "$CT/harness/tools" -a -d "$CT/harness/prompts" -a -d "$CT/harness/loop" -a -d "$CT/harness/docs" \
  -a ! -e "$CT/tools" -a ! -e "$CT/prompts" -a ! -e "$CT/loop" -a ! -e "$CT/docs"
expect "all non-runtime harness directories live under root/harness" $?
test -f "$CT/AGENTS.md" -a -f "$CT/.kiro/agents/orchestrator.json" -a -f "$CT/.claude/agents/orchestrator.md" -a -f "$CT/.codex/agents/orchestrator.toml" \
  && grep -q 'harness/AGENTS.md' "$CT/AGENTS.md" && grep -q 'file://../../harness/prompts/orchestrator.md' "$CT/.kiro/agents/orchestrator.json"
expect "root keeps only the discovery adapters each runtime requires" $?
node -e "
const fs=require('fs'), files=['harness/AGENTS.md','harness/prompts/design-facilitator.md','harness/prompts/orchestrator.md'];
const bad=files.flatMap(f=>[...fs.readFileSync('$CT/'+f,'utf8').matchAll(/(^|[^/])\\b(docs|prompts|loop|tools|skills|memory|trace)\//gm)].map(()=>f));
process.exit(bad.length?1:0);
"
expect "contained instructions never send an agent back to legacy harness paths at project root" $?
git -C "$CT" init -q; git -C "$CT" check-ignore -q harness/AGENTS.md; [ "$?" != "0" ]
expect "the contained harness is visible to git status rather than hidden by gitignore" $?
touch "$CT/mvnw" "$CT/mvnw.cmd"
KIRO_API_KEY=demo-secret JAVA_HOME=/demo/java node "$CT/harness/cli.mjs" env --capture --json > "$CT/env.json"
git -C "$CT" check-ignore -q harness/env/local.json
node -e "const fs=require('fs'),e=require('$CT/env.json'),l=require('$CT/harness/env/local.json');process.exit(
  e.java.home==='/demo/java' && l.apiKeys.KIRO_API_KEY.present===true &&
  e.maven.wrapper?.endsWith('/mvnw') &&
  !fs.readFileSync('$CT/harness/env/local.json','utf8').includes('demo-secret') ? 0 : 1)"
expect "local environment selects the POSIX Maven wrapper and captures context without storing API-key values" $?
node "$CT/harness/tools/harness-status.mjs" --target "$CT" >/dev/null
expect "the installation checksum reports an untouched uncommitted harness clean" $?
cp "$CT/harness/prompts/orchestrator.md" "$CT/orchestrator.original"
printf '\nlocal experiment\n' >> "$CT/harness/prompts/orchestrator.md"
node "$CT/harness/tools/harness-status.mjs" --target "$CT" > "$CT/status.out"; HS=$?
[ "$HS" = "1" ] && grep -q 'MODIFIED' "$CT/status.out" && grep -q 'prompts/orchestrator.md' "$CT/status.out"
expect "one command names the ignored-history file changed since setup" $?
cp "$CT/orchestrator.original" "$CT/harness/prompts/orchestrator.md"
node "$CT/harness/loop/route.mjs" --json > "$CT/route.json"
node -e "const r=require('$CT/route.json');process.exit(r.node&&r.node!=='orchestrator'?0:1)"
expect "the contained router still selects a real workflow node" $?
( cd "$CT" && node harness/cli.mjs route --json > cli-route.json )
cmp "$CT/route.json" "$CT/cli-route.json"
expect "direct and CLI routing read the same contained state from project root" $?
( cd "$CT" && node harness/tools/gen-agents.mjs --target . --runtime all --check >/dev/null &&
  node harness/tools/agent-context.mjs orchestrator </dev/null > context.json )
node -e "const r=require('$CT/context.json');process.exit(/agents.manifest.json unreadable/.test(r.hookSpecificOutput.additionalContext)?1:0)"
expect "runtime hooks resolve the contained manifest and resources from project root" $?
node "$SCRIPTS/upgrade-harness.mjs" --target "$CT" --dry-run --json > "$CT/upgrade.json"
node -e "const r=require('$CT/upgrade.json');process.exit(!r.changed.length&&!r.added.length&&!r.drifted.length&&!r.missing.length?0:1)"
expect "a freshly contained scaffold reports no false upgrade drift" $?
node -e "
const t=require('fs').readFileSync('$CT/harness/docs/reference/graph.md','utf8');
process.exit(/relative to the harness root/.test(t) && /`harness\/` subdirectory on a contained one/.test(t) && !/relative to the contained harness\//.test(t) ? 0 : 1);
"
expect "a contained scaffold's graph identifies harness/ without claiming that layout is universal" $?

step 44 "memory bootstrap: a reason that recurs across features is surfaced, once it isn't already in memory/"
MB="$WORK/demo-bootstrap"; rm -rf "$MB"; mkdir -p "$MB/memory/maker" "$MB/trace"
printf '# maker — memory index\n' > "$MB/memory/maker/MEMORY.md"
node -e "
require('fs').writeFileSync('$MB/feature_list.json', JSON.stringify({ features: [
  { id: 'feat-a', checkerNotes: 'off-by-one in date math caused a false green' },
  { id: 'feat-b', checkerNotes: 'off-by-one in date math caused a false green' },
  { id: 'feat-c', checkerNotes: 'NEEDS DESIGN: unrelated routing marker, excluded on purpose' },
] }));
"
node -e "
const fs=require('fs');
const lines=[
  {actor:'maker',event:'blocked',feature:'feat-d',detail:'flaky integration port already bound'},
  {actor:'maker',event:'blocked',feature:'feat-e',detail:'flaky integration port already bound'},
];
fs.writeFileSync('$MB/trace/trace.jsonl', lines.map(l=>JSON.stringify(l)).join('\n')+'\n');
"
node "$SCRIPTS/memory-consolidate.mjs" --target "$MB" --bootstrap --json > "$MB/bootstrap.json"
node -e "
const r=require('$MB/bootstrap.json');
const c=r.bootstrapCandidates;
process.exit(
  c.length===2 &&
  c.some(x=>x.source.includes('checkerNotes') && x.features.length===2 && !/NEEDS DESIGN/.test(x.sample)) &&
  c.some(x=>x.source.includes('trace') && x.agent==='maker' && x.features.length===2)
  ? 0 : 1);
"
expect "a checkerNotes reason and a trace blocked-reason each recurring across 2 features are both surfaced, and the routing marker is excluded" $?
printf -- '---\nname: date-math-off-by-one\ndescription: off-by-one in date math caused a false green\nmetadata:\n  type: lesson\n  date: 2026-08-20\n---\n\noff-by-one in date math caused a false green\n' > "$MB/memory/maker/date-math-off-by-one.md"
printf '# maker — memory index\n- [off-by-one](date-math-off-by-one.md) — date math\n' > "$MB/memory/maker/MEMORY.md"
node "$SCRIPTS/memory-consolidate.mjs" --target "$MB" --bootstrap --json > "$MB/bootstrap2.json"
node -e "
const r=require('$MB/bootstrap2.json');
const c=r.bootstrapCandidates;
process.exit(c.length===1 && c[0].source.includes('trace') ? 0 : 1);
"
expect "once a candidate is written into memory/, --bootstrap stops suggesting it again" $?

step 45 "docs/design/shared-memory-tier.md v1: memory-promote mechanically writes memory/shared/"
MP="$WORK/demo-promote"; rm -rf "$MP"; mkdir -p "$MP/trace"
node -e "
require('fs').writeFileSync('$MP/feature_list.json', JSON.stringify({ features: [
  { id: 'feat-a', checkerNotes: 'off-by-one in date math caused a false green', evidence: [{date:'2026-08-20',run:'red',cmd:'npm test',result:'fail'}] },
  { id: 'feat-b', checkerNotes: 'off-by-one in date math caused a false green', evidence: [] },
  { id: 'feat-c', checkerNotes: 'no test evidence anywhere but recurs twice ok', evidence: [] },
  { id: 'feat-d', checkerNotes: 'no test evidence anywhere but recurs twice ok', evidence: [] },
] }));
"
node "$SCRIPTS/memory-promote.mjs" --target "$MP" --json > "$MP/promote.json"
node -e "
const r=require('$MP/promote.json');
process.exit(r.promoted.length===1 && r.promoted[0].evidence==='test' && require('fs').existsSync('$MP/'+r.promoted[0].file) ? 0 : 1);
"
expect "memory-promote mechanically writes an evidence-typed entry for a recurring, test-backed reason" $?
node -e "process.exit(require('fs').readdirSync('$MP/memory/shared').length===1?0:1)"
expect "and never promotes a recurring reason with no real command evidence behind it (INV-SHARED-1)" $?
node "$SCRIPTS/memory-promote.mjs" --target "$MP" --json > "$MP/promote2.json"
node -e "const r=require('$MP/promote2.json');process.exit(r.promoted.length===0?0:1)"
expect "re-running memory-promote.mjs is idempotent — an already-captured fact is not promoted again" $?

step 46 "docs/design/shared-memory-tier.md v1: verify-harness memory-shared gate"
MG="$WORK/demo-shared-gate"; rm -rf "$MG"; mkdir -p "$MG/memory/shared"
printf -- '---\nname: bad\ndescription: hand added\nmetadata:\n  type: fact\n  evidence: inference\n  confidence: verified\n  date: 2026-08-20\n---\n\nhand added without real evidence\n' > "$MG/memory/shared/bad.md"
node "$SCRIPTS/verify-harness.mjs" --target "$MG" --skip-baseline --json > "$MG/verify.json"
grep -q '"id": "memory-shared-bad-evidence:bad.md"' "$MG/verify.json"
expect "the memory-shared gate flags an evidence:inference entry (INV-SHARED-1)" $?
node -e "
const r=require('$MG/verify.json');
const f=r.findings.find(x=>x.id==='memory-shared-bad-evidence:bad.md');
process.exit(f && f.severity==='warn' && f.layer==='project' ? 0 : 1);
"
expect "memory-shared findings are severity=warn, layer=project — never a blocker" $?

step 47 "docs/design/shared-memory-tier.md v1: every generated agent reads memory/shared resources"
ER="$WORK/demo-shared-resources"; rm -rf "$ER"
node "$SCRIPTS/setup-harness-loop.mjs" --target "$ER" --name "Resources Demo" --purpose "shared memory resources wiring" --runtime all >/dev/null
mkdir -p "$ER/memory/shared"
printf -- '---\nname: off-by-one\ndescription: off-by-one in date math\nmetadata:\n  type: fact\n  evidence: test\n  confidence: verified\n  date: 2026-08-20\n---\n\noff-by-one in date math caused a false green\n' > "$ER/memory/shared/off-by-one.md"
node "$ER/tools/gen-agents.mjs" --target "$ER" --runtime all >/dev/null
node -e "process.exit(require('$ER/.kiro/agents/maker.json').resources.some(r=>r.includes('memory/shared/off-by-one.md'))?0:1)"
expect "kiro's generated maker config includes the newly promoted fact, computed at generation time (INV-RES-1)" $?
grep -q "memory/shared/off-by-one.md" "$ER/.codex/agents/maker.toml"
expect "codex's generated maker instructions include it too" $?
( cd "$ER" && node tools/agent-context.mjs maker </dev/null > ctx.json )
node -e "process.exit(require('$ER/ctx.json').hookSpecificOutput.additionalContext.includes('memory/shared/off-by-one.md')?0:1)"
expect "Claude's spawn-time context includes it live, with no regeneration step needed" $?
node -e "
const m=require('$ER/agents.manifest.json');
const bad=m.agents.some(a=>(a.writes||[]).some(w=>String(w).includes('memory/shared')));
process.exit(bad?1:0);
"
expect "and memory/shared/ is never in any agent's writes list (INV-SHARED-2)" $?

step 48 "docs/design/shared-memory-tier.md v1: memory/shared end-to-end"
EE="$WORK/demo-shared-e2e"; rm -rf "$EE"
node "$SCRIPTS/setup-harness-loop.mjs" --target "$EE" --name "E2E Shared Memory" --purpose "prove v1 end-to-end" --runtime all >/dev/null
node -e "
require('fs').writeFileSync('$EE/feature_list.json', JSON.stringify({ features: [
  { id: 'feat-x', checkerNotes: 'shared fixture reason recurs across features', evidence: [{date:'2026-08-20',run:'red',cmd:'npm test',result:'fail'}] },
  { id: 'feat-y', checkerNotes: 'shared fixture reason recurs across features', evidence: [] },
] }));
"
node "$EE/tools/memory-promote.mjs" --target "$EE"
test -f "$EE/memory/shared/shared-fixture-reason-recurs-across-features.md"
expect "a recurring, test-backed fixture reason is mechanically promoted" $?
node "$EE/tools/gen-agents.mjs" --target "$EE" --runtime all >/dev/null
node -e "process.exit(require('$EE/.kiro/agents/checker.json').resources.some(r=>r.includes('memory/shared'))?0:1)"
expect "every generated agent's resources include it without hand-editing the manifest" $?
printf -- '---\nname: bad\ndescription: bad\nmetadata:\n  type: fact\n  evidence: inference\n  confidence: verified\n  date: 2026-08-20\n---\n\nbad\n' > "$EE/memory/shared/bad.md"
node "$EE/tools/verify-harness.mjs" --target "$EE" --skip-baseline --json > "$EE/verify.json"
grep -q "memory-shared-bad-evidence" "$EE/verify.json"
expect "and a hand-planted inference-only entry next to it is still caught by the gate" $?

step 49 "approval-gate.mjs: a headless approval request fires a best-effort OS notification"
AN="$WORK/demo-approval-notify"; rm -rf "$AN"; mkdir -p "$AN/loop"
printf '{"features":[{"id":"feat-notify-demo","readyForCheck":true,"attempts":2,"status":"in-progress"}]}\n' > "$AN/feature_list.json"
cat > "$AN/fake-notify.sh" <<'SH'
#!/bin/sh
echo "NOTIFY title=$1 message=$2" >> "$NOTIFY_MARKER"
SH
chmod +x "$AN/fake-notify.sh"
( cd "$AN" && NOTIFY_MARKER="$AN/marker.txt" HARNESS_NOTIFY_CMD="$AN/fake-notify.sh" \
  node "$SCRIPTS/../templates/tree/loop/approval-gate.mjs" --check >/dev/null )
grep -q "NOTIFY title=Harness: approval needed message=.*feat-notify-demo" "$AN/marker.txt" 2>/dev/null
expect "a fresh approval request fires the configured notifier with the right title and pending feature" $?
rm -rf "$AN/loop/approval-request.md" "$AN/loop/approval.md" "$AN/marker.txt"
( cd "$AN" && HARNESS_NOTIFY=0 NOTIFY_MARKER="$AN/marker.txt" HARNESS_NOTIFY_CMD="$AN/fake-notify.sh" \
  node "$SCRIPTS/../templates/tree/loop/approval-gate.mjs" --check >/dev/null )
[ ! -f "$AN/marker.txt" ]
expect "HARNESS_NOTIFY=0 opts out of the notification entirely" $?
rm -rf "$AN/loop/approval-request.md" "$AN/loop/approval.md"
( cd "$AN" && HARNESS_NOTIFY_CMD="/nonexistent/not-a-real-command" \
  node "$SCRIPTS/../templates/tree/loop/approval-gate.mjs" --check >/dev/null ); AGRC=$?
[ "$AGRC" = "10" ] && [ -f "$AN/loop/approval-request.md" ]
expect "a broken/missing notifier never blocks or fails the gate — the request is still written" $?

step 50 "verify-harness gate state-log-prose: progress.md/DECISIONS.md must stay bulleted, not prose"
SP="$WORK/demo-state-log-prose"; rm -rf "$SP"; mkdir -p "$SP"
node -e "
require('fs').writeFileSync('$SP/progress.md', [
  '# Progress Log', '',
  '## Notes', '',
  'This session we worked on a lot of things and it took a while to figure out exactly what was',
  'going wrong with the underlying subsystem, because the initial hypothesis about the root cause',
  'turned out to be wrong after we dug into the logs and traced through the actual execution path,',
  'which eventually led us to discover that the real issue was somewhere else entirely.',
].join('\n'));
"
node "$SCRIPTS/verify-harness.mjs" --target "$SP" --skip-baseline --json > "$SP/verify.json"
grep -q '"id": "state-log-prose:progress.md:5"' "$SP/verify.json"
expect "a run of >=3 consecutive non-bulleted lines in progress.md is flagged" $?
node -e "
const r=require('$SP/verify.json');
const f=r.findings.find(x=>x.id==='state-log-prose:progress.md:5');
process.exit(f && f.severity==='warn' && f.layer==='project' ? 0 : 1);
"
expect "state-log-prose findings are severity=warn, layer=project — never a blocker" $?
node -e "
require('fs').writeFileSync('$SP/progress.md', [
  '# Progress Log', '', '## Notes', '',
  '- fixed the thing', '- verified the fix', '- next: do the other thing',
].join('\n'));
"
node "$SCRIPTS/verify-harness.mjs" --target "$SP" --skip-baseline --json > "$SP/verify2.json"
grep -q '"id": "state-log-prose' "$SP/verify2.json"; SPRC=$?
[ "$SPRC" != "0" ]
expect "bulleted notes of the same length do not trip the gate" $?

echo ""
step 51 "--promote never overrides a checker REJECT, even when the old evidence still exits 0"
PR="$WORK/demo-promote-reject"; rm -rf "$PR"; mkdir -p "$PR"
cat > "$PR/feature_list.json" <<'FLJ'
{"features":[
  {"id":"feat-rejected","name":"x","behavior":"x","verification":"true","falsifier":"x","kind":"build",
   "dependencies":[],"context":{"touches":["x"]},"status":"in-progress","readyForCheck":false,
   "evidence":[],"checkerNotes":"REJECT: missing integration oracle across the real process boundary","attempts":1,"maxAttempts":3}
]}
FLJ
node "$SCRIPTS/verify-harness.mjs" --target "$PR" --skip-baseline --run-features --promote --json >/dev/null
node -e "
const f = require('$PR/feature_list.json').features[0];
process.exit(f.status === 'in-progress' ? 0 : 1);
"
expect "a feature whose checkerNotes starts with REJECT stays in-progress, never silently becomes done (found live on examples/jdt-mcp-server: feat-lsp-client)" $?

echo ""
step 52 "parallel maker: one feature, N disjoint slices, ONE integrator running the tests"
WS="$WORK/demo-work-split"; rm -rf "$WS"; mkdir -p "$WS" && (cd "$WS" && git init -q .)
node "$SCRIPTS/setup-harness-loop.mjs" --target "$WS" --name "Split" --purpose "parallel maker demo" >/dev/null 2>&1
# Deliberately no docs/design/*.md here: adding one would make the design-approval rule outrank
# everything below it, and this step is about the implementation layer.
mkdir -p "$WS/src"
printf 'x\n' > "$WS/src/a.ts"; printf 'x\n' > "$WS/src/b.ts"
# One feature, open, with everything the earlier routing rules need so they decline and the
# implementation layer is reached.
node -e "
const fs=require('fs'); const p='$WS/feature_list.json'; const j=JSON.parse(fs.readFileSync(p,'utf8'));
j.features=[{id:'feat-split',name:'two adapters',behavior:'Both adapters answer through the Widget seam',
  verification:'true',falsifier:'INV-W-1 an adapter bypasses the seam',kind:'build',dependencies:[],
  status:'in-progress',readyForCheck:false,evidence:[{date:'2026-08-26',run:'red',cmd:'true',result:'fail'}],
  checkerNotes:'',attempts:0,maxAttempts:3}];
fs.writeFileSync(p,JSON.stringify(j,null,2));
"
mkdir -p "$WS/tests/design" && printf '{"requirement_id":"INV-W-1","condition":"seam"}\n' > "$WS/tests/design/TCON-W-1.json"
DIGEST="$(cd "$WS" && node tools/review-contract.mjs feat-split --json 2>/dev/null | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{process.stdout.write(JSON.parse(s)[0].contractDigest)}catch(e){process.stdout.write('')}})")"
write_plan() { # write_plan S2_PATHS
  cat > "$WS/loop/work-split/feat-split.json" <<PLAN
{ "kind": "work-split/1", "feature": "feat-split", "contractDigest": "$DIGEST",
  "sharedContracts": ["Widget @ docs/architecture.md"],
  "integration": { "verification": "true" },
  "slices": [
    { "id": "s1", "intent": "Build the A adapter behind the Widget seam, with its unit test.",
      "acceptance": "src/a.ts answers through the seam and its unit test is green.",
      "paths": ["src/a.ts"], "mustRead": ["docs/architecture.md"], "verification": "true" },
    { "id": "s2", "intent": "Build the B adapter behind the Widget seam, with its unit test.",
      "acceptance": "src/b.ts answers through the seam and its unit test is green.",
      "paths": [$1], "mustRead": ["docs/architecture.md"], "verification": "true" } ] }
PLAN
}

write_plan '"src/b.ts"'
(cd "$WS" && node tools/work-split.mjs validate feat-split >/dev/null 2>&1)
expect "a plan with disjoint slices, a real fan-in command and self-contained briefs is admitted" $?

# The red run is only obtainable BEFORE the fan-out: afterwards each worker has verified only its
# own narrower command and the integrator arrives to code that already works, so the feature would
# reach the checker having never been seen to fail (HI-066).
node -e "
const fs=require('fs'),p='$WS/feature_list.json',j=JSON.parse(fs.readFileSync(p,'utf8'));
j.features[0].evidence=[]; fs.writeFileSync(p,JSON.stringify(j,null,2));
"
(cd "$WS" && node tools/work-split.mjs validate feat-split > "$WS/nored.txt" 2>&1)
grep -q "has no red run on record" "$WS/nored.txt"
expect "a split is refused while the feature has never been seen to fail — the one moment that run can still be made" $?
node -e "
const fs=require('fs'),p='$WS/feature_list.json',j=JSON.parse(fs.readFileSync(p,'utf8'));
j.features[0].evidence=[{date:'2026-08-26',run:'red',cmd:'true',result:'fail'}]; fs.writeFileSync(p,JSON.stringify(j,null,2));
"
(cd "$WS" && node tools/work-split.mjs validate feat-split >/dev/null 2>&1)
expect "and admitted again once the red run is on record" $?

(cd "$WS" && node loop/route.mjs --json > "$WS/route1.json")
node -e "const r=require('$WS/route1.json');process.exit(r.node==='maker'&&r.mode==='slice-fanout'&&r.slices.join(',')==='s1,s2'?0:1)"
expect "the router names maker with mode slice-fanout and both slices" $?

# The load-bearing check: two slices that can touch one file must never reach a worker.
write_plan '"src/**"'
(cd "$WS" && node tools/work-split.mjs validate feat-split > "$WS/overlap.txt" 2>&1); OV=$?
[ "$OV" != "0" ]; expect "overlapping slices are refused" $?
grep -q "s1 and s2 both claim src/a.ts" "$WS/overlap.txt"
expect "the refusal names the file both slices claimed" $?

# ... including files that do not exist yet, which is when the collision is still cheap.
write_plan '"src/**/model.ts"'
node -e "
const fs=require('fs'),p='$WS/loop/work-split/feat-split.json',j=JSON.parse(fs.readFileSync(p,'utf8'));
j.slices[0].paths=['src/gen/**']; fs.writeFileSync(p,JSON.stringify(j,null,2));
"
(cd "$WS" && node tools/work-split.mjs validate feat-split > "$WS/overlap2.txt" 2>&1)
grep -q "overlap for any file either one creates" "$WS/overlap2.txt"
expect "src/gen/** and src/**/model.ts are caught with no such file on disk (witness sampling misses this)" $?

# Shared state is single-writer; a parallel worker may never claim it.
write_plan '"feature_list.json"'
(cd "$WS" && node tools/work-split.mjs validate feat-split > "$WS/reserved.txt" 2>&1)
grep -q "single-writer shared state" "$WS/reserved.txt"
expect "a slice claiming feature_list.json is refused" $?

# A brief a worker would have to ask about is not a brief.
write_plan '"src/b.ts"'
node -e "
const fs=require('fs'),p='$WS/loop/work-split/feat-split.json',j=JSON.parse(fs.readFileSync(p,'utf8'));
j.slices[1].intent='fix it'; j.slices[1].mustRead=[]; fs.writeFileSync(p,JSON.stringify(j,null,2));
"
(cd "$WS" && node tools/work-split.mjs validate feat-split > "$WS/thin.txt" 2>&1)
grep -q "too thin to work from without asking a question" "$WS/thin.txt"
expect "an underspecified slice is refused before a worker is spawned, not after it stalls" $?

# The fan-in must run the feature's own verification, not a cheaper stand-in.
write_plan '"src/b.ts"'
node -e "
const fs=require('fs'),p='$WS/loop/work-split/feat-split.json',j=JSON.parse(fs.readFileSync(p,'utf8'));
j.integration.verification='echo cheap'; fs.writeFileSync(p,JSON.stringify(j,null,2));
"
(cd "$WS" && node tools/work-split.mjs validate feat-split > "$WS/cheap.txt" 2>&1)
grep -q "not a cheaper one" "$WS/cheap.txt"
expect "a fan-in that does not run the feature's verification is refused" $?

# Confinement is a hook decision, not a sentence in the brief.
write_plan '"src/b.ts"'
(cd "$WS" && node tools/work-split.mjs validate feat-split >/dev/null 2>&1)
guard() { echo "{\"tool_input\":{\"file_path\":\"$1\"}}" | (cd "$WS" && HARNESS_FEATURE=feat-split HARNESS_SLICE=s1 node tools/guard-write.mjs maker); }
guard "src/a.ts" | grep -q '"allow"'; expect "slice s1 may write its own file" $?
guard "src/b.ts" | grep -q '"deny"'; expect "slice s1 may NOT write slice s2's file" $?
guard "feature_list.json" | grep -q '"deny"'; expect "slice s1 may NOT write shared state" $?
echo '{"tool_input":{"command":"echo x > src/b.ts"}}' | (cd "$WS" && HARNESS_FEATURE=feat-split HARNESS_SLICE=s1 node tools/guard-write.mjs maker) | grep -q '"deny"'
expect "a shell redirect out of the slice is denied too, not only the edit tools" $?
node -e "
const fs=require('fs'),p='$WS/loop/work-split/feat-split.json',j=JSON.parse(fs.readFileSync(p,'utf8'));
j.validation.status='invalid'; fs.writeFileSync(p,JSON.stringify(j,null,2));
"
guard "src/a.ts" | grep -q '"deny"'
expect "a worker cannot write at all while its plan's disjointness is unvalidated" $?

(cd "$WS" && node tools/work-split.mjs validate feat-split >/dev/null 2>&1)
(cd "$WS" && node tools/work-split.mjs complete feat-split s1 --note "A landed" >/dev/null)
(cd "$WS" && node loop/route.mjs --json > "$WS/route2.json")
node -e "const r=require('$WS/route2.json');process.exit(r.mode==='slice-fanout'&&r.slices.join(',')==='s2'?0:1)"
expect "a completed slice drops out of the next fan-out" $?

(cd "$WS" && node tools/work-split.mjs complete feat-split s2 --note "B landed" >/dev/null)
(cd "$WS" && node loop/route.mjs --json > "$WS/route3.json")
node -e "const r=require('$WS/route3.json');process.exit(r.node==='maker'&&r.mode==='integrate'&&!r.slices?0:1)"
expect "when every slice lands the router names ONE maker to integrate — the test run never fans out" $?

(cd "$WS" && node tools/work-split.mjs fail feat-split s2 --note "UNDERSPECIFIED: which codec?" >/dev/null)
(cd "$WS" && node loop/route.mjs --json > "$WS/route4.json")
node -e "const r=require('$WS/route4.json');process.exit(r.mode==='slice-repair'&&/UNDERSPECIFIED/.test(r.why)?0:1)"
expect "a failed slice outranks the fan-out and routes a maker to re-cut the split, question and all" $?

(cd "$WS" && node tools/work-split.mjs brief feat-split s1 > "$WS/brief.txt" 2>&1)
grep -q "Never ask a question\|Do not ask a question" "$WS/brief.txt"
expect "the generated brief tells the worker it has nobody to ask" $?
grep -q "You may write ONLY these paths" "$WS/brief.txt"
expect "the generated brief states the worker's write surface" $?

echo ""
step 53 "contained layout keeps an unrestricted role unrestricted (HI-062)"
CL="$WORK/demo-contained-writes"; rm -rf "$CL"; mkdir -p "$CL" && (cd "$CL" && git init -q .)
HARNESS_LAYOUT=contained node "$SCRIPTS/setup-harness-loop.mjs" --target "$CL" --name "Contained" --purpose "write-guard demo" >/dev/null 2>&1
node -e "
const m=require('$CL/harness/agents.manifest.json');
process.exit(m.agents.find(a=>a.name==='maker').writes === null ? 0 : 1);
"
expect "the contained-layout rewrite leaves maker's writes null, not []" $?
echo '{"tool_input":{"file_path":"harness/feature_list.json"}}' | (cd "$CL" && node harness/tools/guard-write.mjs maker) | grep -q '"allow"'
expect "an unrestricted role is still unrestricted once the guard hook runs for it ([] would deny everything)" $?
echo '{"tool_input":{"file_path":"src/x.ts"}}' | (cd "$CL" && node harness/tools/guard-write.mjs checker) | grep -q '"deny"'
expect "a genuinely restricted role is unaffected by that fix" $?

echo ""
step 54 "upgrading an existing target delivers the whole toolbox, and the admission seam runs from the project root"
UG="$WORK/demo-upgrade-tools"; rm -rf "$UG"; mkdir -p "$UG" && (cd "$UG" && git init -q .)
HARNESS_LAYOUT=contained node "$SCRIPTS/setup-harness-loop.mjs" --target "$UG" --name "Upgrade" --purpose "upgrade coverage demo" >/dev/null 2>&1
# Simulate a target scaffolded before these tools existed. They reach a fresh scaffold through
# setup's directory walk, so they were invisible to the upgrader's copy-list grep (HI-064) — and a
# target that never had them ran a refreshed run-loop.mjs calling a tool that was not there.
rm -f "$UG/harness/tools/review-contract.mjs" "$UG/harness/tools/work-split.mjs" \
  "$UG/harness/tools/kiro-acp-dispatch.mjs"
node "$SCRIPTS/upgrade-harness.mjs" --target "$UG" --json > "$UG/upgrade.json"
node -e "
const r=require('$UG/upgrade.json');
process.exit(r.added.includes('tools/review-contract.mjs') && r.added.includes('tools/work-split.mjs') &&
  r.added.includes('tools/kiro-acp-dispatch.mjs') ? 0 : 1);
"
expect "the upgrader restores templates/tree/tools/* an old target never received" $?
[ -f "$UG/harness/tools/review-contract.mjs" ] && [ -f "$UG/harness/tools/kiro-acp-dispatch.mjs" ]
expect "and both admission plus ACP dispatch are really on disk afterwards" $?
# HI-065: the maker prompt tells a contained target to run this from the project root.
( cd "$UG" && node harness/tools/review-contract.mjs --ready > review.out 2>&1 ); RCRC=$?
grep -q "cannot read feature_list.json" "$UG/review.out"; RCMISS=$?
[ "$RCMISS" != "0" ]
expect "review-contract.mjs finds feature_list.json from the project root on a contained layout, not only from the harness home" $?
( cd "$UG/harness" && node tools/review-contract.mjs --ready > ../review2.out 2>&1 )
grep -q "cannot read feature_list.json" "$UG/review2.out"; RC2=$?
[ "$RC2" != "0" ]
expect "and still works from inside the harness home, which is how run-loop.mjs calls it" $?
node "$SCRIPTS/upgrade-harness.mjs" --target "$UG" --dry-run --json > "$UG/upgrade2.json"
node -e "
const r=require('$UG/upgrade2.json');
process.exit(!r.changed.length && !r.added.length && !r.drifted.length ? 0 : 1);
"
expect "a second upgrade of the same target is a no-op — no phantom drift" $?

echo ""
step 55 "memory tier: a schema nobody enforced, a gate that was a wall, and a duplicate it could not see"
MM="$WORK/demo-memory"; rm -rf "$MM"; mkdir -p "$MM/memory/maker" "$MM/memory/checker"
printf '# maker — memory index\n\n' > "$MM/memory/maker/MEMORY.md"
printf '# checker — memory index\n\n' > "$MM/memory/checker/MEMORY.md"
# Two entries, no frontmatter, recording ONE fact in different words — the shape that cost a real
# session on examples/jdt-mcp-server, written five features apart by two maker runs.
cat > "$MM/memory/maker/timeout-missing-prints-nothing.md" <<'E1'
# This machine has no `timeout`, and a mutant pass without one prints nothing

Encountered on feat-tool-references. The mutant script ran each mutant as
`timeout 120 node --test ... 2>&1 | grep -E "^not ok"`. macOS ships no GNU coreutils, so neither
`timeout` nor `gtimeout` exists on this machine. The shell writes `command not found` to stderr,
the `2>&1` folds that line into the pipe, and `grep` filters it straight back out. What remains on
stdout is the five mutant headers and nothing else — no `not ok` line, no `# fail` line. Read
quickly, that is indistinguishable from "every mutant survived", which is the most expensive wrong
conclusion available at this step: it sends the maker to write more cases against an oracle that
was never executed. Each mutant ran inside a subshell with no `set -e`, so the non-zero exit
stopped nothing either. Bound the run with node's own spawn timeout rather than the coreutils
binary, and assert that the pass produced at least one result line before believing its verdict.
E1
cat > "$MM/memory/maker/gnu-timeout-absent-mutant-round-empty.md" <<'E2'
# GNU `timeout` absent on macOS: the mutant round looks like it ran, and did not

Encountered on feat-tool-definition, first round. The script printed five `===== M1 =====` headers
and then `OK: source restored`. No `not ok` line anywhere, no `# fail` line. Skimmed, it reads
exactly like "all five mutants survived" — the conclusion that costs the most, because it sends the
maker back to strengthen an oracle that is already fine. Root cause: each run was
`timeout 120 node --test ... | grep -E "^not ok"`. macOS has no GNU coreutils, so `timeout` does not
exist, node never started at all, and `grep` saw empty input and exited quietly. Because every run
sat in its own subshell without `set -e`, the non-zero exit propagated nowhere. Use node's spawn
timeout instead of the binary, and make the pass fail loudly when it produces no result lines.
E2
printf -- '- [timeout missing](timeout-missing-prints-nothing.md) — %s\n' "$(printf 'x%.0s' $(seq 1 200))" >> "$MM/memory/maker/MEMORY.md"
printf -- '- [gnu timeout absent](gnu-timeout-absent-mutant-round-empty.md) — short hook\n' >> "$MM/memory/maker/MEMORY.md"
node "$SCRIPTS/memory-consolidate.mjs" --target "$MM" --json > "$MM/mc.json"
node -e "
const r=require('$MM/mc.json');
const mk=r.agents.find(a=>a.agent==='maker');
const dup=mk.findings.find(f=>f.id==='likely-same-lesson');
process.exit(dup && dup.count===1 ? 0 : 1);
"
expect "the same lesson written twice in different words is found — exact description matching never could" $?
node -e "
const r=require('$MM/mc.json');
const mk=r.agents.find(a=>a.agent==='maker');
const sc=mk.findings.find(f=>f.id==='entry-missing-schema');
process.exit(sc && sc.count===2 ? 0 : 1);
"
expect "entries with no name:/description: frontmatter are reported — without it every check here is blind to them" $?
node -e "
const r=require('$MM/mc.json');
const mk=r.agents.find(a=>a.agent==='maker');
const long=mk.findings.filter(f=>f.id==='index-line-too-long');
// One grouped finding, never one per line: 66 identical warnings out of 68 was the wall this fixes.
process.exit(long.length===1 && long[0].count===1 ? 0 : 1);
"
expect "repeated findings collapse to one per class with a count, not one per occurrence" $?
# Vietnamese entries must not compare as noise: the old normalize() stripped everything outside
# [a-z0-9], turning 'không' into 'kh ng', so every text comparison ran on rubble.
mkdir -p "$MM/memory/checker"
for n in 1 2; do
cat > "$MM/memory/checker/vi-$n.md" <<VE
# Mutant sống sót vì hàng rào thứ hai vẫn chặn đúng thời hạn

Khi một hàm có hai cơ chế cùng bảo vệ một thời hạn, xoá đúng falsifier của điều kiện vẫn cho sáu
trên sáu ca xanh, bởi vì cơ chế còn lại tiếp tục kẹp thời hạn đó. Phải đếm số cơ chế trong hàm
trước khi thiết kế mutant, nếu không màu đỏ mà ta chờ đợi sẽ không bao giờ xuất hiện và kết luận
"mutant tương đương" là sai. Lần này cơ chế thứ hai nằm ở lớp trong, tại cổng tiêm được.
VE
done
printf -- '- [vi 1](vi-1.md) — hook\n- [vi 2](vi-2.md) — hook\n' >> "$MM/memory/checker/MEMORY.md"
node "$SCRIPTS/memory-consolidate.mjs" --target "$MM" --json > "$MM/mc2.json"
node -e "
const r=require('$MM/mc2.json');
const ck=r.agents.find(a=>a.agent==='checker');
process.exit(ck.findings.some(f=>f.id==='likely-same-lesson') ? 0 : 1);
"
expect "two identical Vietnamese entries are detected — the matcher is Unicode-aware, not [a-z0-9] only" $?

echo ""
step 56 "the environment records which small CLI utilities are absent, because absence is silent"
node "$SCRIPTS/environment.mjs" --json > "$WORK/env.json" 2>/dev/null
node -e "
const e=require('$WORK/env.json');
const u=e.utilities || {};
process.exit(Object.prototype.hasOwnProperty.call(u,'timeout') && Object.prototype.hasOwnProperty.call(u,'gtimeout') ? 0 : 1);
"
expect "timeout/gtimeout presence is captured, so a mutant pass does not fail into an empty pipe unexplained" $?

echo ""
step 57 "a blocked feature upstream of clean work is named, not left for a human to walk by hand"
DM="$WORK/demo-dam"; rm -rf "$DM"; mkdir -p "$DM/loop"
cp "$SCRIPTS/../templates/tree/loop/route.mjs" "$DM/loop/route.mjs"
cat > "$DM/feature_list.json" <<'DAMJ'
{"features":[
 {"id":"feat-prove-diag","kind":"prove","status":"blocked","behavior":"x","verification":"true","falsifier":"f","dependencies":[],
  "checkerNotes":"REJECT: INV-DIAG-3 never proven after three attempts","attempts":3,"maxAttempts":3},
 {"id":"feat-tool-completion","kind":"build","status":"not-started","behavior":"x","verification":"true","falsifier":"f","dependencies":["feat-prove-diag"],"checkerNotes":"","attempts":0,"maxAttempts":3},
 {"id":"feat-tool-rename","kind":"build","status":"not-started","behavior":"x","verification":"true","falsifier":"f","dependencies":["feat-tool-completion"],"checkerNotes":"","attempts":0,"maxAttempts":3}
]}
DAMJ
(cd "$DM" && node loop/route.mjs --json > route.json 2>/dev/null)
node -e "
const r=require('$DM/route.json');
process.exit(r.node==='human' && /damming/.test(r.why) && /feat-prove-diag is blocked/.test(r.detail) ? 0 : 1);
"
expect "the router names the blocked feature three links upstream, and how many features it dams" $?
node "$SCRIPTS/verify-harness.mjs" --target "$DM" --skip-baseline --json > "$DM/verify.json" 2>/dev/null
node -e "
const r=require('$DM/verify.json');
const f=r.findings.find(x=>x.id==='blocked-dependency-dam');
process.exit(f && f.severity==='warn' && /feat-prove-diag dams 2/.test(f.evidence) ? 0 : 1);
"
expect "and verify-harness reports the same dam as a warn, so it shows in an audit and not only in a stall" $?

echo ""
step 58 "the review contract asks the one question a green run cannot answer for itself"
RD="$WORK/demo-discrimination"; rm -rf "$RD"; mkdir -p "$RD/tools"
cp "$SCRIPTS/../templates/tree/tools/review-contract.mjs" "$RD/tools/review-contract.mjs"
packet() { cat > "$RD/feature_list.json" <<PJ
{"features":[{"id":"feat-x","behavior":"b","verification":"true","falsifier":"f","kind":"build","dependencies":[],
 "context":null,"status":"in-progress","readyForCheck":true,"evidence":[],"checkerNotes":"","attempts":0,"maxAttempts":3,
 "reviewPacket":{"contractDigest":"PLACEHOLDER","claimRefs":["r"],"changedPaths":["p"],
  "runs":[{"cmd":"true","exit":0,"result":"1 passed"}],
  "adversarialChecks":{"scope":"covered","cleanup":"covered","errorPath":"covered","concurrency":"covered","realBoundary":"covered"$1},
  "residualUnknowns":[]}}]}
PJ
DG="$( cd "$RD" && node tools/review-contract.mjs feat-x --json 2>/dev/null | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{process.stdout.write(JSON.parse(s)[0].contractDigest)}catch(e){}})" )"
node -e "
const fs=require('fs'),p='$RD/feature_list.json',j=JSON.parse(fs.readFileSync(p,'utf8'));
j.features[0].reviewPacket.contractDigest='$DG'; fs.writeFileSync(p,JSON.stringify(j,null,2));
"
}
packet ''
(cd "$RD" && node tools/review-contract.mjs feat-x > out.txt 2>&1); RC=$?
[ "$RC" != "0" ] && grep -q "discrimination is missing" "$RD/out.txt"
expect "a packet with all five old checks but no discrimination sentence is not admitted" $?
packet ',"discrimination":"covered"'
(cd "$RD" && node tools/review-contract.mjs feat-x > out2.txt 2>&1)
grep -q "must be a concrete sentence, not a verdict" "$RD/out2.txt"
expect "\"covered\" is rejected for this one field — a tick cannot answer what a wrong implementation would still pass" $?
packet ',"discrimination":"an implementation that ignores the cap entirely still passes: no run supplies a scope past it"'
(cd "$RD" && node tools/review-contract.mjs feat-x >/dev/null 2>&1)
expect "a concrete sentence naming what would still pass is admitted" $?

echo ""
step 59 "NEEDS ORACLE FIX: the eighth implicit edge — a prove feature whose own oracle is wrong"
OF="$WORK/demo-oracle-fix"; rm -rf "$OF"; mkdir -p "$OF/loop" "$OF/.claude/agents" "$OF/tests/design"
cp "$SCRIPTS/../templates/tree/loop/route.mjs" "$OF/loop/route.mjs"
touch "$OF/.claude/agents/test-implementer.md" "$OF/.claude/agents/maker.md"
printf '{"requirement_id":"INV-P-1"}\n' > "$OF/tests/design/TCON-P-1.json"
cat > "$OF/feature_list.json" <<'OFJ'
{"features":[
 {"id":"feat-prove-pool","kind":"prove","status":"in-progress","behavior":"x","verification":"true","falsifier":"INV-P-1 f","dependencies":[],
  "evidence":[{"date":"2026-08-27","run":"red","cmd":"true","result":"module missing"}],
  "checkerNotes":"NEEDS ORACLE FIX: the assertion says an evicted workspace is absent forever, but its own fixture re-acquires it","attempts":0,"maxAttempts":3}
]}
OFJ
(cd "$OF" && node loop/route.mjs --json > r1.json 2>/dev/null)
node -e "
const r=require('$OF/r1.json');
process.exit(r.node==='test-implementer' && r.layer==='oracle' && r.feature==='feat-prove-pool' ? 0 : 1);
"
expect "a prove feature with a recorded red run still routes back to the oracle layer under this marker" $?
node -e "
// Without the marker the same feature is unreachable by every node: the test-implementer rule keys
// on empty evidence, and the maker is forbidden from touching an oracle-layer test.
const fs=require('fs'),p='$OF/feature_list.json',j=JSON.parse(fs.readFileSync(p,'utf8'));
j.features[0].checkerNotes=''; fs.writeFileSync('$OF/fl-nomarker.json',JSON.stringify(j,null,2));
"
cp "$OF/feature_list.json" "$OF/fl-marker.json"
cp "$OF/fl-nomarker.json" "$OF/feature_list.json"
(cd "$OF" && node loop/route.mjs --json > r0.json 2>/dev/null)
node -e "
const r=require('$OF/r0.json');
process.exit(r.node==='maker' ? 0 : 1);
"
expect "and without it the router hands that same feature to the maker — the trap this marker closes" $?
cp "$OF/fl-marker.json" "$OF/feature_list.json"
node -e "
const {createHash}=require('crypto');
const m='NEEDS ORACLE FIX: the assertion says an evicted workspace is absent forever, but its own fixture re-acquires it';
require('fs').writeFileSync('$OF/loop/route-log.jsonl', JSON.stringify({node:'test-implementer',feature:'feat-prove-pool',hash:createHash('sha1').update(m).digest('hex').slice(0,12),at:new Date().toISOString()})+'\n');
"
(cd "$OF" && node loop/route.mjs --json > r2.json 2>/dev/null)
node -e "
const r=require('$OF/r2.json');
process.exit(r.node==='human' && r.layer==='oracle' && /condition itself may be wrong/.test(r.why) ? 0 : 1);
"
expect "one test-implementer turn, then a human — an oracle that cannot be reconciled is a question about the condition" $?
node -e "
const t=require('fs').readFileSync('$SCRIPTS/../templates/tree/loop/maker-prompt.md','utf8').replace(/\s+/g,' ');
process.exit(/Never pick a feature whose .checkerNotes. starts with .NEEDS ORACLE FIX:./.test(t) ? 0 : 1);
"
expect "the maker prompt forbids picking it, so the marker and the eligibility filter agree" $?
node -e "
const t=require('fs').readFileSync('$SCRIPTS/../templates/tree/loop/checker-prompt.md','utf8').replace(/\s+/g,' ');
process.exit(/NEEDS ORACLE FIX:/.test(t) && /Do \*\*not\*\* REJECT/.test(t) ? 0 : 1);
"
expect "the checker is told to write the marker instead of REJECTing an implementation that may be correct" $?
node -e "
const t=require('fs').readFileSync('$SCRIPTS/../references/graph.md','utf8');
process.exit(/NEEDS ORACLE FIX:/.test(t) && /All twelve named edges/.test(t) ? 0 : 1);
"
expect "graph.md records the new edge and its count — the workflow and its only written-down map agree" $?

echo ""
if [ "$FAIL" = "0" ]; then
  echo "ALL DEMO STEPS PASSED — harness-loop lifecycle proven end-to-end at $T"
else
  echo "ONE OR MORE DEMO STEPS FAILED — see FAIL lines above"
fi
exit "$FAIL"

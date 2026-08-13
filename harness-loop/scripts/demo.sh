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

step 9 "apply the fix and close the loop: --reverify --auto-resolve"
mv "$T/init.mjs.bak" "$T/init.mjs"
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
( cd "$TO" && node loop/route.mjs --json ) | grep -q "tests/design/ does not exist"
expect "and the reason names the missing input rather than the feature" $?
mkdir -p "$TO/tests/design/plans"
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
process.exit(n<=150 && /The six that carry everything/.test(t) && /Brief and concise/.test(t)
             && /Lead with the leverage point/.test(t) ? 0 : 1);
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
  if(j.hash&&j.feature) require("fs").appendFileSync("loop/route-log.jsonl",
    JSON.stringify({node:j.node,feature:j.feature,hash:j.hash})+"\n");});'); }
[ "$(route_of)" = "designer" ]; expect "a NEEDS DESIGN: marker the designer has not seen routes to the designer" $?
dispatched
# The designer answers but CANNOT clear the marker — it may not write feature_list.json.
[ "$(route_of)" = "feature-planner" ]; expect "after the designer's turn the same marker routes to the planner, the only node that may clear it" $?
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

step 39 "meta loop: dispatch on the right layer, stop when nothing moves"
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

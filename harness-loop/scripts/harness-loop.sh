#!/usr/bin/env bash
# harness-loop.sh — the meta loop: create -> verify -> improve -> verify …
#
# The project loop (loop/run-loop.sh inside a target) advances FEATURES. This loop advances the
# HARNESS: it verifies a scaffolded target, splits the failures into "the project is wrong" and
# "the skill is wrong", records the latter, dispatches the right agent for each, and re-verifies.
#
# Usage:
#   scripts/harness-loop.sh --target DIR [options]
# Options:
#   --iterations N     iteration budget (default 3)
#   --setup            scaffold first (runs setup-harness-loop.mjs); pass setup args after --
#   --runner kiro|none kiro dispatches agents headlessly; none prints the prompt and stops (default none)
#   --skip-baseline    do not run ./init.sh during verify (fast structural pass)
#   --run-features     replay the evidence of every feature claimed passing/done
#
# It never overwrites a scaffolded file. A template fix reaches an existing target only through the
# improver agent (or you), deliberately — silent overwrites would eat the work the loop just did.
set -uo pipefail

SCRIPTS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_ROOT="$(cd "$SCRIPTS/.." && pwd)"

TARGET=""; ITERATIONS=3; RUNNER="none"; DO_SETUP=0
VERIFY_ARGS=(); SETUP_ARGS=()
# Runs the improver on whichever runtime is available. Both agent formats are generated from
# agents.manifest.json, so the role is identical either way (docs/reference/runtimes.md).
harness_dispatch() {  # harness_dispatch <agent> <message>
  local agent="$1"; shift
  if [ "${HARNESS_RUNTIME:-}" = "claude" ] || { [ -z "${HARNESS_RUNTIME:-}" ] && ! command -v kiro-cli >/dev/null 2>&1 && command -v claude >/dev/null 2>&1; }; then
    claude -p "$*" --agent "$agent" --dangerously-skip-permissions < /dev/null
  else
    kiro-cli chat --agent "$agent" --no-interactive --trust-all-tools "$*"
  fi
}

while [ $# -gt 0 ]; do
  case "$1" in
    --target)        TARGET="$2"; shift 2 ;;
    --iterations)    ITERATIONS="$2"; shift 2 ;;
    --runner)        RUNNER="$2"; shift 2 ;;
    --setup)         DO_SETUP=1; shift ;;
    --skip-baseline) VERIFY_ARGS+=("--skip-baseline"); shift ;;
    --run-features)  VERIFY_ARGS+=("--run-features"); shift ;;
    --)              shift; SETUP_ARGS=("$@"); break ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done
[ -n "$TARGET" ] || { echo "error: --target DIR is required" >&2; exit 2; }
TARGET="$(cd "$TARGET" 2>/dev/null && pwd)" || { echo "error: no such directory: $TARGET" >&2; exit 2; }
REPORT="$TARGET/trace/verify-report.json"

json() { node -e "try{const r=require('$REPORT');process.stdout.write(String($1))}catch(e){process.stdout.write('ERR')}"; }

if [ "$DO_SETUP" = "1" ]; then
  echo "=== scaffold ==="
  node "$SCRIPTS/setup-harness-loop.mjs" --target "$TARGET" ${SETUP_ARGS[@]+"${SETUP_ARGS[@]}"} || exit 1
fi

PREV_SIGNATURE=""
for i in $(seq 1 "$ITERATIONS"); do
  echo ""
  echo "=== harness-loop iteration $i/$ITERATIONS — verify ==="
  node "$SCRIPTS/verify-harness.mjs" --target "$TARGET" ${VERIFY_ARGS[@]+"${VERIFY_ARGS[@]}"}
  VERIFY_RC=$?

  if [ "$VERIFY_RC" = "0" ]; then
    echo ""
    echo "harness green after $i iteration(s). The project loop may start:  cd $TARGET && loop/run-loop.sh N"
    exit 0
  fi

  HARNESS_N="$(json "r.counts.harnessLayer")"
  PROJECT_N="$(json "r.counts.projectLayer")"
  [ "$HARNESS_N" = "ERR" ] && { echo "could not read $REPORT — stopping" >&2; exit 1; }

  # Stop if nothing moved: the same failure set twice in a row means this loop cannot fix it.
  SIGNATURE="$(json "r.findings.filter(f=>f.severity==='blocker').map(f=>f.gate+'/'+f.id).sort().join(',')")"
  if [ -n "$PREV_SIGNATURE" ] && [ "$SIGNATURE" = "$PREV_SIGNATURE" ]; then
    echo ""
    echo "STOP: identical blocker set two iterations running — no progress. Escalating to a human."
    echo "      see $REPORT"
    exit 1
  fi
  PREV_SIGNATURE="$SIGNATURE"

  if [ "$HARNESS_N" != "0" ]; then
    echo ""
    echo "--- $HARNESS_N harness-layer finding(s): the skill is at fault, recording ---"
    node "$SCRIPTS/harness-issue.mjs" import --report "$REPORT"
    node "$SCRIPTS/improve-harness.mjs" --top 5 >/dev/null
    if [ "$RUNNER" = "kiro" ]; then
      PROMPT="$(node "$SCRIPTS/improve-harness.mjs" --prompt)"
      echo "--- dispatching harness-improver ---"
      ( cd "$SKILL_ROOT/.." && harness_dispatch harness-improver \
          "$PROMPT

The affected target is $TARGET. After fixing the template, apply the same fix to that target's copy
of the file so this iteration can make progress." ) \
        || { echo "harness-improver failed — stopping"; exit 1; }
    else
      echo ""
      echo "Runner is 'none'. Fix the skill with this prompt, then re-run:"
      echo ""
      node "$SCRIPTS/improve-harness.mjs" --prompt
      exit 1
    fi
  fi

  if [ "$PROJECT_N" != "0" ]; then
    echo ""
    echo "--- $PROJECT_N project-layer finding(s): the target repo is at fault ---"
    if [ "$RUNNER" = "kiro" ] && [ -x "$TARGET/loop/run-loop.sh" ]; then
      ( cd "$TARGET" && ./loop/run-loop.sh 1 ) || { echo "project loop failed — stopping"; exit 1; }
    else
      echo "Fix them in $TARGET (see the report above), or run the project loop:"
      echo "  cd $TARGET && ./loop/run-loop.sh 1"
      [ "$RUNNER" != "kiro" ] && exit 1
    fi
  fi
done

echo ""
echo "iteration budget ($ITERATIONS) exhausted and the harness is still red — see $REPORT"
exit 1

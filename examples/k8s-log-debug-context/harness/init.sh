#!/usr/bin/env bash
# init.sh — wrapper. The baseline gate itself lives in init.mjs, which runs on every platform this
# harness targets; this file exists so `./harness/init.sh` keeps working everywhere it already did, and so
# existing callers that name it stay correct.
#
# Do not add logic here. A second implementation of the gate is a second thing to drift, and it
# would drift toward whichever one the person making the change happens to run.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
command -v node >/dev/null 2>&1 || { echo "init.sh: node is required (every harness tool is a .mjs)." >&2; exit 1; }
exec node "$ROOT/init.mjs" "$@"

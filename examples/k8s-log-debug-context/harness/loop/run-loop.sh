#!/usr/bin/env bash
# Compatibility wrapper only. Cross-platform loop logic belongs in run-loop.mjs.
exec node "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/run-loop.mjs" "$@"

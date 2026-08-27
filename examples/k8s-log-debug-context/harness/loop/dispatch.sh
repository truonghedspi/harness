#!/usr/bin/env bash
# Compatibility wrapper only. Cross-platform dispatch logic belongs in dispatch.mjs.
exec node "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/dispatch.mjs" "$@"

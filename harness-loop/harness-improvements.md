# Harness improvement plan

Generated 2026-08-13 08:23:53 from `harness-issues.jsonl`.
Ranked by `occurrences × severity × distinct targets` (regressions doubled) — fix top-down,
one per iteration, and close each with `--reverify`.

| # | id | score | seen | gate | symptom | fix where |
|---|----|-------|------|------|---------|-----------|
| 1 | HI-001 | 3 | 1x in 1 proj | baseline | ./init.sh exited 1 — init.sh calls a build tool that is not on PATH while a wrapper may exist | templates/tree/init.mjs → VERIFICATION block (stack detection); init.sh/init.cmd are wrappers and carry no logic |

## HI-001 — ./init.sh exited 1 — init.sh calls a build tool that is not on PATH while a wrapper may exist

- **Gate:** `baseline`  **Severity:** blocker  **Score:** 3
- **Seen:** 1x, first 2026-08-13, last 2026-08-13
- **Targets:** /var/folders/3z/np7bbr2910zg9tml74w1gyjh0000gn/T/tmp.qpQjdlNCxl/demo-target
- **Remedy:** init.sh should prefer ./mvnw / ./gradlew when a wrapper exists — fix templates/tree/init.sh
- **Fix where:** templates/tree/init.mjs → VERIFICATION block (stack detection); init.sh/init.cmd are wrappers and carry no logic

```
=== Harness init: Demo ===
=== Maven verification ===
/bin/sh: mvn: command not found

init: `mvn -q verify` failed with exit code 127. Baseline is RED — fix this before the loop runs.
```


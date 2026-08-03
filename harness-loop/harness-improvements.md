# Harness improvement plan

Generated 2026-08-02 08:22:42 from `harness-issues.jsonl`.
Ranked by `occurrences × severity × distinct targets` (regressions doubled) — fix top-down,
one per iteration, and close each with `--reverify`.

| # | id | score | seen | gate | symptom | fix where |
|---|----|-------|------|------|---------|-----------|
| 1 | HI-001 | 3 | 1x in 1 proj | baseline | ./init.sh exited 127 — init.sh calls a build tool that is not on PATH while a wrapper may exist | templates/tree/init.sh → VERIFICATION block (stack detection) |

## HI-001 — ./init.sh exited 127 — init.sh calls a build tool that is not on PATH while a wrapper may exist

- **Gate:** `baseline`  **Severity:** blocker  **Score:** 3
- **Seen:** 1x, first 2026-08-02, last 2026-08-02
- **Targets:** /var/folders/3z/np7bbr2910zg9tml74w1gyjh0000gn/T/tmp.rULs8JmwI4/demo-target
- **Remedy:** init.sh should prefer ./mvnw / ./gradlew when a wrapper exists — fix templates/tree/init.sh
- **Fix where:** templates/tree/init.sh → VERIFICATION block (stack detection)

```
=== Harness init: Demo ===
=== Maven verification ===
./init.sh: line 42: mvn: command not found
```


# Harness Setup — Kubernetes Log Debug Context

You are the SETUP agent. Your only job is to make this harness real against the actual
environment and get the baseline green. You do NOT implement features.

Read `harness/memory/harness-setup/MEMORY.md` first — if this project has been set up or re-set-up before,
a past toolchain/environment gotcha may already be recorded there
(`harness/docs/reference/agent-memory.md`).

Do these in order, and report what remains blocked:

1. **Toolchain.** Confirm the required runtimes/build tools are installed and on PATH. Report
   versions. If something is missing, say exactly what to install — do not work around it.
2. **Verification commands.** Open `init.sh` and the `verification` fields in
   `harness/feature_list.json`. Replace every placeholder with the project's real build/test/lint
   commands. Each must be runnable.
3. **Docs sanity (Fresh Session Test).** Ensure `harness/docs/architecture.md` truly answers: what is
   this / how organized / how to run / how to verify / where are we now. Fill gaps you can verify
   from the repo; flag what you cannot.
4. **MCP connectivity.** If `.kiro/settings/mcp.json` declares connectors, prove each one works
   with a real read call. Report any that fail.
5. **Baseline.** Run `./harness/init.sh`. Fix environment/setup issues until it is green. If it cannot go
   green without a human decision, mark the blocker in `harness/session-handoff.md` and stop.
6. **Prove coverage.** Run `node check-coverage.mjs` and report the 13-lesson scorecard. Fix any
   structural gaps you can (missing doc section, missing field). Report the rest.
7. **Check the knowledge artifacts exist and are real, not placeholders.** `harness/docs/INDEX.md` lists
   every document with a "read it when" line; `harness/docs/assumptions.md` and `harness/docs/cross-cutting.md`
   exist (empty is fine at setup, missing is not); no knowledge document exceeds 300 lines
   (`harness/docs/reference/knowledge-layout.md`). Report anything still holding template text.
8. **Prove it actually works, not just that the files exist.** Run
   `node harness/tools/verify-harness.mjs --target . --run-features` and report the findings. 13/13
   coverage on a harness that still has blockers (placeholders left, a vacuously-green init.sh,
   a feature with no runnable verification) is not "set up" — the real bar is 0 blockers.

Honesty rules: never fake a green. If a command fails, report the failure and its cause. Setup is
done only when `./harness/init.sh` is green, `check-coverage.mjs` reports 13/13, AND
`harness/tools/verify-harness.mjs --run-features` reports 0 blockers — or the remaining blockers are
clearly listed for a human.

**End-of-session reflection — answer it, don't skip it:** did this setup turn up something the
*next* setup/re-setup on this project shouldn't have to rediscover — a toolchain/environment quirk
that cost real time to figure out?
- **Yes** → write one entry to `harness/memory/harness-setup/` (new `<slug>.md` + a line in `MEMORY.md`)
  before you finish.
- **No** → nothing to write. A routine, expected setup is not a lesson.

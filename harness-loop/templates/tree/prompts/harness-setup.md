# Harness Setup — {{PROJECT_NAME}}

You are the SETUP agent. Your only job is to make this harness real against the actual
environment and get the baseline green. You do NOT implement features.

Do these in order, and report what remains blocked:

1. **Toolchain.** Confirm the required runtimes/build tools are installed and on PATH. Report
   versions. If something is missing, say exactly what to install — do not work around it.
2. **Verification commands.** Open `init.sh` and the `verification` fields in
   `feature_list.json`. Replace every placeholder with the project's real build/test/lint
   commands. Each must be runnable.
3. **Docs sanity (Fresh Session Test).** Ensure `docs/architecture.md` truly answers: what is
   this / how organized / how to run / how to verify / where are we now. Fill gaps you can verify
   from the repo; flag what you cannot.
4. **MCP connectivity.** If `.kiro/settings/mcp.json` declares connectors, prove each one works
   with a real read call. Report any that fail.
5. **Baseline.** Run `./init.sh`. Fix environment/setup issues until it is green. If it cannot go
   green without a human decision, mark the blocker in `session-handoff.md` and stop.
6. **Prove coverage.** Run `node check-coverage.mjs` and report the 13-lesson scorecard. Fix any
   structural gaps you can (missing doc section, missing field). Report the rest.

Honesty rules: never fake a green. If a command fails, report the failure and its cause. Setup is
done only when `./init.sh` is green and `check-coverage.mjs` reports 13/13 — or the remaining
blockers are clearly listed for a human.

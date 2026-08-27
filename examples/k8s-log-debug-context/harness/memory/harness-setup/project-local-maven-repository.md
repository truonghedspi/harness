# Keep Maven's repository inside the project sandbox

- **Observed:** 2026-08-26 on macOS with Maven absent and JDK 25 installed.
- **Symptom:** `harness/init.mjs` failed with `Operation not permitted` while Maven tried to write
  plugin artifacts below `~/.m2/repository`.
- **Cause:** the agent sandbox permits project writes but not writes to the user Maven repository.
- **Fix:** `.mvn/maven.config` sets `-Dmaven.repo.local=.mvn/repository`; `.gitignore` excludes that
  downloaded cache. The checked-in wrapper distribution itself remains under `~/.m2/wrapper/dists`.
- **Recheck:** bootstrap dependencies once with network access, then run `node harness/init.mjs`
  normally; it must pass using the project-local cache.

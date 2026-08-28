---
name: jdk21-autoselect-only-applies-to-init-subprocess
description: init.mjs now selects JDK 21 for its own ./mvnw, but direct ./mvnw commands still inherit host Temurin 25 and need JAVA_HOME exported
metadata:
  type: lesson
  date: 2026-08-28
---

feat-012 made `harness/init.mjs` auto-select the keg-only Homebrew OpenJDK 21 for its spawned `./mvnw`, so `env -u JAVA_HOME node harness/init.mjs` is green.

**Why this is still a trap:** the selection sets `JAVA_HOME`/`PATH` only for the subprocess `init.mjs` spawns. It does not change the maker's own shell. A feature verification written as a direct command (`./mvnw -q -Dtest=X test`, as feat-005's is) runs in the maker's shell and still resolves `java` to the host default Temurin 25, so it reds with the Enforcer `[21,22)` rejection even though "JDK 21 selection" is fixed.

**How to apply:** before running any direct `./mvnw` command, export `JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home` (or run the verification through `node harness/init.mjs`). Do not assume the init.mjs fix reaches the maker's own shell.

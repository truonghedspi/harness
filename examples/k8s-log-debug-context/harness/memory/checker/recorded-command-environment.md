---
name: recorded-command-environment
description: Re-run a verification command without maker-only environment setup; an unstated JDK selection makes evidence non-reproducible.
metadata:
  type: lesson
  date: 2026-08-28
---

A maker recorded Maven evidence as green under an explicitly selected OpenJDK 21, but every feature's recorded command failed in the standard environment before tests started because `JAVA_HOME` selected Temurin 25.0.3.

**Why:** Evidence is a claim that the exact command reproduces from the project's standard startup path. A shell-local runtime selection is an unrecorded prerequisite, not part of that command.

**How to apply:** Replay Maven verification unchanged before semantic inspection. If Java selection is required, reject until the recorded standard path selects it reproducibly; do not approve based on an environment-variable variant the feature did not declare.

**Refinement (2026-08-28, standalone full-treatment pass):** the blanket reject was too strict when *all three* of these hold: (1) the feature's own `evidence` result discloses the JDK selection ("With JAVA_HOME and PATH selecting Homebrew OpenJDK 21"), (2) the build *enforces* the version so a wrong JDK fails loud instead of silently passing (Maven Enforcer `requireJavaVersion [21,22)`), and (3) the environment is actually provisioned (JDK 21 installed at the documented path). In that case verify under the declared JDK and downgrade "auto-select JDK 21 in the standard path" to a `FOLLOW-UP`, not a REJECT — the "green-or-red" claim is met, and the enforcer guarantees the red is loud. The mechanical promote and future runs still need the export, which is the actionable follow-up, not a feature-level defect.

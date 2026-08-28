# Homebrew OpenJDK 21 is keg-only — java_home returns the wrong JDK

While sizing `feat-012` (reproducible JDK 21 baseline selection) I verified the host toolchain and
found a trap that would have silently selected the wrong JDK:

- Host default `java` is Temurin 25.0.3 (`/usr/bin/java`).
- Homebrew OpenJDK 21.0.12.1 is installed at
  `/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home`, but Homebrew keeps `openjdk@21`
  keg-only (not symlinked into `/usr/local` or registered with macOS).
- `/usr/libexec/java_home -v 21` returns `/Library/Java/JavaVirtualMachines/temurin-25.jdk/Contents/Home`
  — it does **not** find the Homebrew JDK 21.

So any JDK-discovery code that trusts `/usr/libexec/java_home -v 21` alone will fall back to Temurin
25 and the Maven Enforcer `[21,22)` will red. Discovery must also check the Homebrew keg
(`/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home` or `brew --prefix openjdk@21`) or a
recorded path (`harness/env/local.json`), not `java_home` alone.

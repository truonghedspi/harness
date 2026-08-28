---
name: nonstandard-source-root-ownership
description: A build feature must own manifest wiring when product sources live outside the toolchain's default root.
metadata:
  type: lesson
  date: 2026-08-28
---

`feat-002` originally owned `service/src/main/java/**` but not `pom.xml`; Maven only mapped the
custom test root, so every approved product class would have remained invisible to compilation.

**Why:** A path listed in architecture is not necessarily a configured build input. With a
nonstandard repository layout, source-root wiring is inseparable from the first feature that adds
code there.

**How to apply:** Before publishing the first build feature for a source tree, inspect the real
manifest and verify that the tree is compiled. If not, include the manifest path and the bounded
source-root edit in that feature's ownership and context packet.

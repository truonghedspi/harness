---
name: busybox-find-lacks-readable
description: BusyBox find rejects GNU -readable, so a permission preflight must prove access by opening a file
metadata:
  type: lesson
  date: 2026-08-29
---

The first HI-082-enabled feat-011 report preserved `node-log-preflight` stderr and showed that the
preflight itself was invalid: BusyBox 1.36.1 `find` rejects GNU's `-readable` predicate. The pod
phase and the script's generic `PREFLIGHT_FAILED` line therefore could not classify A-006.

**Why:** A minimal utility image does not necessarily implement GNU predicates, even when the same
command works on the host.

**How to apply:** Enumerate candidate log files with BusyBox-supported `find -type f -name`, then
open each candidate (`head -c 1`) as the non-root init-container identity. Treat only that actual
open result as evidence of node-log access. After this change, the authorized minikube preflight
still found no readable log and A-006 was honestly verified false for that environment.

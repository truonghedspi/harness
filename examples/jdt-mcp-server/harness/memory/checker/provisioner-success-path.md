---
name: provisioner-success-path
description: Download-failure and cache-path cases can all pass while first-run installation is untested.
metadata:
  type: lesson
  date: 2026-08-21
---

A provisioner oracle that covers cache hits, overrides, and unreachable egress does not verify the
successful empty-cache path. Its green run can still leave download, checksum validation,
extraction, and installation entirely unexercised.

**Why:** failure-path tests only prove that errors are shaped and bounded; they do not prove the
positive state transition that produces a usable pinned install.

**How to apply:** for every claimed first-run provisioning behavior, look for an independent
successful-fetch fixture that observes the installed pinned launcher. If it is absent, reject the
claim as a test-design gap even when all failure-path tests pass.

---
name: checksum-rejection-oracle
description: Comparing installed files with a fetched archive proves copying, not checksum validation.
metadata:
  type: lesson
  date: 2026-08-21
---

A first-run installation test can download a real archive, independently extract that same archive,
and byte-compare its contents with the installation while still never detecting a removed checksum
guard.

**Why:** both the expected files and the installation come from identical, valid archive bytes. The
assertions prove extraction/copying, but no case presents a valid tarball with a deliberately wrong
digest.

**How to apply:** when a feature claims checksum verification, require a committed condition that
returns corrupt or otherwise digest-mismatched archive bytes and observes an explicit rejection with
no usable installed directory. A successful known-good download is necessary but not sufficient.

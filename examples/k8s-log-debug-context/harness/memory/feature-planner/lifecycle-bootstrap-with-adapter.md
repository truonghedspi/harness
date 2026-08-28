---
name: lifecycle-bootstrap-with-adapter
description: Keep lifecycle bootstrap and a data-plane adapter in one build when they share one client, active resource, and acceptance boundary.
metadata:
  type: lesson
  date: 2026-08-28
---

`feat-004` first looked like an index adapter while the approved retention revision added policy,
template, and daily-index installation. That extra lifecycle responsibility did not justify a new
feature: bootstrap returns the exact index the adapter uses, shares its OpenSearch client, and is
judged with the adapter by one real-store proof.

**Why:** Counting resource types over-splits a capability. The useful seam is startup convergence
to a writable, correctly governed index; policy installation alone has no independent product
outcome in this project.

**How to apply:** When a design adds bootstrap to an adapter, split only if bootstrap has a stable
consumer or independent proof of its own. Otherwise keep dependency, canonical resources,
lifecycle code, and adapter tests in one build, with a separate prove feature across the real
boundary.

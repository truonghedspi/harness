---
name: collector-contract-still-contains-a-mapping
description: A real collector contract can contain a field mapping that still needs both round-trip and field-sensitivity properties.
metadata:
  type: lesson
  date: 2026-08-27
---

TP-COLLECTOR-0009 looked like one integration behavior because it runs a real collector against a
capture ingress, but its metadata-enrichment claim has a distinct mapping shape. Treating the whole
feature as integration would have produced one example contract that could miss swapped or
hard-coded Kubernetes fields.

**Why:** Logic shape belongs to each atomic behavior, not to the test process or feature. A test may
cross real component boundaries while one claim inside it is still a field-to-field mapping.

**How to apply:** Split transport/envelope behavior into an integration contract, then give any
metadata mapping both a source-to-wire-to-normalized round-trip property and a field-sensitivity
property with mutually distinct values. Keep scope admission separate as a decision table.

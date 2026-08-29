---
name: otlp-filter-direction-blind-static-test
description: A static policy test asserting `contains("debug.logs/enabled") && contains("\"true\"")` passes on both `==` and `!=`; it never checks the filter direction, so an inverted opt-in filter ships green.
metadata:
  type: lesson
  date: 2026-08-29
---

feat-008's `CollectorDeploymentPolicyTest` asserts the chart ConfigMap opt-in filter with `config.contains("debug.logs/enabled") && config.contains("\"true\"")` (line 124). The chart (`collector-daemonset.yaml`) uses `resource.attributes["k8s.pod.labels.debug.logs/enabled"] == "true"` while the hermetic `collector/otel-collector.yaml` uses `!= "true"`. The OTel filter processor drops a record where its OTTL condition is TRUE — confirmed two ways: the hermetic config's own comment ("the OTel filter processor drops where its condition is true, so the conditions are negated") and feat-009's oracle empirically admitting exactly the 2 opted-in rows under `!=`. So `== "true"` DROPS opted-in pods and ADMITS non-opted-in — X-003 inverted in the live DaemonSet — yet the static test is green on both directions.

**Why "it passed green" hides it:** the assertion checks the marker string sits next to a `"true"` literal, not the comparison operator. `== "true"` and `!= "true"` both contain `debug.logs/enabled` and `"true"`, so flipping the operator leaves the test green while inverting the deployment's behavior.

**How to apply:** when a policy test asserts an OTTL/filter condition, pin the operator and the drop-on-true direction, not just `contains(marker) && contains("true")`. The mutation probe must flip `==`↔`!=` (not merely delete the marker) and expect red. For OTel `filterprocessor`, a record is dropped when the condition evaluates true, so an opt-in filter must NEGATE (`!= "true"`, `!= "test"`), never match (`==`).

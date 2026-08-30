---
name: init-container-logs-can-be-masked
description: kubectl logs --all-containers can lose failed init-container stderr when the main container is still waiting
metadata:
  type: lesson
  date: 2026-08-29
---

The feat-011 minikube rollout reached `node-log-preflight`, which repeatedly exited and left the
pod at `Init:Error`. The environment report preserved events and pod state, but its single
`kubectl logs --all-containers` call returned only the waiting `otel-collector` error. The failed
init container's stderr disappeared when the namespace was correctly removed, so A-006 could not
be classified as node-log denial versus a preflight-command defect.

**Why:** One unavailable container can make the aggregate logs call fail before useful output from
another container is persisted.

**How to apply:** On an init failure, do not infer the cluster policy from `Init:Error` alone. Read
per-container diagnostics. HI-082 tracks changing `k8s-test-env.sh` to capture each init and app
container independently before teardown.

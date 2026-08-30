# K8s-integration-tester memory — Kubernetes Log Debug Context

Index of what this agent has learned about this project's cluster/chart/environment across runs
(`docs/reference/agent-memory.md` documents the schema and why). One line
per entry, always loaded — keep it short.

Write a new entry when something that looked like a real deploy/test failure turned out to be
environmental (resource contention, a stale image, a cluster-specific quirk), or a chart/script
change was needed for a non-obvious reason. Don't write one for a routine deploy/test/teardown
cycle that worked as expected.

Write entries and hooks **in English**, whatever language the rest of the project uses: memory is
addressed to whichever agent reads it next, not to this project's readers. Entries already written
in another language stay as they are — this governs what gets written from now on.

<!-- - [Title](slug.md) — one-line hook -->
- [Init-container logs can be masked](init-container-logs-can-be-masked.md) — aggregate logs lost A-006 preflight stderr when the main container was waiting
- [BusyBox find lacks readable](busybox-find-lacks-readable.md) — use an actual file-open probe instead of GNU `find -readable` in minimal init images
- [Minikube JWKS requires ServiceAccount auth](minikube-jwks-requires-serviceaccount-auth.md) — anonymous issuer discovery returned 403; refresh keys with the rotated projected token through the built-in binding

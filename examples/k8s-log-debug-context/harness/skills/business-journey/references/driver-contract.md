# Business test driver contract

Keep scenarios independent of transport and deployment mechanics. A project-specific driver should
offer business verbs and correlated awaits, for example `seedAccount`, `placeOrder`, `awaitOrder`,
`awaitTrades`, and `awaitPosition`. Its adapters may use FIX/HTTP/gRPC/message consumers and public
query APIs. Every command accepts the run ID and correlation/idempotency key; every await filters by
that identity and has the oracle deadline.

The driver must not expose SQL, repositories, pods, topics, offsets, sleeps or Kubernetes objects.
Those belong to diagnostics/environment adapters. This boundary lets the same Cucumber or native
scenario run locally, in an ephemeral namespace, and against a controlled staging environment.

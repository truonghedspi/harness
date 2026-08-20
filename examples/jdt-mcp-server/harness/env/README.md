# Local environment

Machine- and environment-specific inputs for this harness live here, not in project docs or agent
prompts. Run `node harness/cli.mjs env --capture` to write `local.json`, then review it.

`local.json` may record paths and non-secret selectors such as Java home, Maven executable,
`KUBECONFIG`, Kubernetes context and the **names** of API-key environment variables. It never
captures an API-key value. Both `local.json` and `secrets.env` are ignored because they are local
configuration; use `environment.example.json` to communicate the required shape safely.

Agents may read `local.json` to discover tooling, but must not print secret environment values or
persist them into traces, handoffs, prompts or feature evidence.

# Upgrade ownership

| Class | Typical paths | Default action |
|---|---|---|
| Harness-owned | `tools/**`, loop executables, generated runtime configs, copied references, `skills/harness-upgrade/**` | refresh from canonical source, then verify |
| Project-owned | source, tests, requirements, architecture, constraints, objective, feature state | never overwrite; preserve |
| Merge-owned | `AGENTS.md`, `agents.manifest.json`, `init.mjs`, prompts | semantic merge with target-specific content retained |
| Generated | `.kiro/agents/**`, `.claude/agents/**`, `.codex/agents/**` | regenerate from manifest/prompt; never hand-edit |
| Runtime state | progress, decisions, memory, evidence, receipts | retain; migrate only with provenance |

Ownership is about who may decide content, not who created the file. A template initially created
`docs/constraints.md`, but after adoption its rules belong to the project. Conversely, a copied
`tools/gen-agents.mjs` remains harness-owned unless the target deliberately forked it and recorded
that fork.

Escalate a conflict when the target changed a harness invariant, when the new default changes what
future targets receive, or when the layer is genuinely unclear. Do not convert uncertainty into an
automatic “skip”; that leaves a half-upgraded workflow.

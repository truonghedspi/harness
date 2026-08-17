---
name: harness-upgrade
description: Upgrade an existing harness target without overwriting project-owned work. Use whenever harness-onboarder finds feature_list.json or existing harness machinery, an upgrade dry-run reports changed/drifted/new/retired items, generated runtime agents are stale, or a target must adopt a newer harness workflow. Inventory and classify ownership, build a reviewable merge plan, ask only consequential human decisions, apply mechanical refreshes, merge customized files deliberately, regenerate agents, and verify the target before declaring success.
version: 0.1.0
---

# Harness Upgrade

Upgrade is a three-way merge, not a second onboarding and not `setup --force`. Preserve the target's
project knowledge while moving harness-owned machinery to the canonical version.

## 1. Establish both sides

Read the target's `AGENTS.md`, git status, recent commits, `agents.manifest.json`, and current route.
Find the canonical harness root from the onboarding prompt. Refuse to proceed if either location is
ambiguous. Never clean or reset a dirty target; distinguish pre-existing edits from this upgrade.

Run:

```bash
node <harness-root>/harness-loop/scripts/upgrade-harness.mjs \
  --target <target> --dry-run --json > <scratch>/upgrade-dry-run.json
node skills/harness-upgrade/scripts/plan-upgrade.mjs \
  --report <scratch>/upgrade-dry-run.json --target <target> \
  --output <scratch>/upgrade-plan.json
```

The plan separates:

- `refresh`: harness-owned files the upgrader may replace mechanically;
- `add`: missing harness-owned machinery;
- `merge`: customized/project-owned files requiring semantic reconciliation;
- `retire`: target agents removed from the canonical manifest;
- `verify`: commands proving the target still works.
- `upgradeContext`: canonical reasons, target impact, semantic merge actions and verification for
  every recorded harness update that intersects this target's diff. A filename list is not context.
  Read each entry before reviewing drift and record its target-specific `disposition`.

## 2. Resolve the decision frontier

Read [ownership.md](references/ownership.md). Mechanical refreshes need no interview. Use the
user-scope `human-interview` skill only when a merge would change project policy, permissions,
default behavior, or remove an agent with no documented replacement. Present the full independent
frontier in one round and record the decision in the plan.

For a known migration, read [migrations.md](references/migrations.md). Treat its recipe as a scoped
proposal: verify the preconditions against the target before applying it. A target customization
wins unless it contradicts a newly approved harness invariant; then show the conflict to the human.

## 3. Apply in ownership order

1. Run the real upgrader without `--dry-run`; capture its JSON receipt.
2. Merge customized files one by one. Preserve target-specific commands, architecture, constraints,
   objectives and agent permissions. Add the new invariant at its semantic location; do not replace
   a whole file merely because the template changed.
3. Remove a retired agent only after its state is empty or migrated and its replacement is present.
4. Regenerate all runtime representations from `agents.manifest.json`; never edit generated agent
   files by hand.
5. Run `check-upgrade-plan.mjs` before verification. It rejects unreviewed drift, retired agents
   without a disposition, unacknowledged upgrade context, and plans with no verification.

## 4. Prove and hand off

Run the target's own baseline first, then:

```bash
node tools/gen-agents.mjs --target . --runtime all --check
node tools/verify-harness.mjs --target . --skip-baseline
node loop/route.mjs --rules
```

Use stricter project commands when `AGENTS.md` requires them. Inspect the final diff for project
knowledge loss and generated/runtime skew. Report established results separately from inference.

An upgrade is incomplete if the machinery changed but customized files still describe the old
workflow. If verification cannot finish, leave a typed handoff containing the dry-run, applied
operations, failed command and exact remaining merge—never claim “upgraded with warnings.”

## Boundaries

- Never use `setup-harness-loop --force` as an upgrade.
- Never overwrite a drifted file mechanically.
- Never delete project memory with substantive entries; migrate its facts and provenance first.
- Never infer that process exit 0 means success when regeneration or verification produced no
  expected receipt.
- Never merge from `changed`/`drifted` filenames alone. If the report has no upgrade context for a
  behavior-changing canonical update, stop and fix the harness ledger before upgrading the target.
- Keep scratch plans outside the target or under its ignored `trace/scratch/`; do not commit them.

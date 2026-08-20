---
name: feature-planning
description: >-
  Turn an approved design or requirement into a right-sized build/prove feature DAG with runnable
  verification, invariant-derived falsifiers, and implementation context. Use for initial planning,
  NEEDS RE-PLAN requests, changed/new feature-impact rows, or any edit to feature_list.json's scope.
  Do not use to invent architecture, write implementation code, or design tests.
---

# Feature Planning

Produce a plan that downstream agents can execute and independently judge. The planner owns the
cut, not the design or implementation.

## Inputs

1. Read the full `feature_list.json`; its digest is only a map and drops state fields.
2. Read the requirement the user named, then the approved design and its invariant table.
3. If routed by `NEEDS DESIGN:` or `NEEDS RE-PLAN:`, read the exact marker and the artifact that
   answers it before changing scope.
4. Inspect the real manifest and baseline command. Never guess a verification command.

Read [references/cutting-rules.md](references/cutting-rules.md) before drafting. Read
[references/counterexamples.md](references/counterexamples.md) when the cut is ambiguous, a prior
plan failed, or the checker requested a re-plan.

## Workflow

1. Extract named components as `build` candidates and acceptance scenarios as `prove` candidates.
2. Resolve ambiguity before writing. Missing design invariants produce `NEEDS DESIGN:`, not an
   invented falsifier.
3. Draft the complete feature array. Each non-baseline feature carries the fields required by
   [schemas/feature-plan.schema.json](schemas/feature-plan.schema.json).
4. Build the dependency DAG: foundations first, builds next, proves depending on the builds they
   judge. Never point a build at its prove feature.
5. Derive every falsifier from a real invariant and cite `[INV-AREA-N]`. Record the 1–3 touched
   files and the one implementation note already learned while sizing.
6. Save the draft, then run:

   ```bash
   node skills/feature-planning/scripts/check-plan.mjs --target . --json
   ```

7. Fix every finding on features introduced or changed by this planning pass. A zero blocker count
   is insufficient: planner findings are intentionally strict here even when project-wide adoption
   reports classify similar debt as warnings.
8. Publish the array, update non-obvious cut decisions, regenerate `feature_list.digest.md`, and
   report build/prove counts, DAG depth, accepted exceptions, and unresolved human checkpoints.

## Must produce

- Acyclic, dependency-ordered features with stable unique IDs.
- Every build judged by at least one prove feature.
- Every prove feature dependent on the build claim it judges.
- One runnable verification and one discriminating falsifier per feature.
- Traceable invariant citations when the design declares invariant IDs.
- `context.touches` plus a useful implementation note for every non-baseline feature.
- Complete state fields without dropping evidence or checker history during a re-plan.

## Must not

- Invent architecture, invariants, requirements, or commands.
- Treat a placeholder, prose instruction, or manual inspection as verification.
- Split one inseparable behavior into multiple paid dispatches, or combine unrelated claims with
  `and`/`then`.
- Let implementation and its only proof live in one build feature.
- Clear a routing marker without recording the resolution and where it lives.
- Report success from the blocker count alone; run the capability checker and inspect its findings.

The checker proves structure, not semantic completeness. The independent planner/checker review
still decides whether these are the right features for the requirement.

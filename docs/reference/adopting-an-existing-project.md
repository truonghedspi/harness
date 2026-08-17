# Adopting an existing project

Scaffolding a new repo and adopting a five-year-old one are different jobs. This file is the
contract for the second, and the `harness-onboarder` agent is its executable form.

```bash
node harness-loop/scripts/install-onboarder.mjs --target /path/to/repo
cd /path/to/repo && kiro-cli chat --agent harness-onboarder
```

That installs the prompt, runtime entry configs, and `skills/harness-upgrade/`; it touches no
product file. The agent surveys, asks one round of questions, and only then runs the scaffolder
with the flags it worked out. If harness machinery already exists, it loads the upgrade capability
and performs an ownership-aware semantic merge instead of scaffolding again. Pointing
`setup-harness-loop.mjs` at someone's repo before anyone has looked at it is how you
overwrite an `AGENTS.md` and lose a maintainer's trust in one command.

## The problem adoption actually has

Every gate in this harness assumes a project that grew up with it. Point them at existing code and
they all fire at once. Measured on this skill's own dogfood target, at the moment of adoption:

```
25  falsifier-missing     every feature predates the rule
16  evidence-no-red       every green feature predates red-green evidence
 4  test-untraceable      tests written before traceability existed
 4  scope-smell
──
49  warnings, day one, none of them anyone's fault
```

Forty-nine is a wall. The owner reads it once, concludes the tool cries wolf, and stops reading —
and **an ignored gate is weaker than no gate, because it photographs as coverage.** This is the
same failure `review-digest` was built to prevent, arriving from a different direction.

You cannot fix it by weakening the gates: then new code inherits the same laxity that produced the
debt. And you cannot fix it by demanding the back catalogue be cleaned first: nobody adopts a tool
whose first instruction is a month of unrelated work.

## The mechanism: baseline, then ratchet

`tools/adoption-baseline.mjs` snapshots today's warning counts per family and treats them as
**accepted debt**. The rule is one sentence:

> **You may leave the old debt alone. You may not add to it.**

```bash
node tools/adoption-baseline.mjs --target . --record --note "adopted 2026-08-10, scope: api/"
node tools/adoption-baseline.mjs --target .            # in CI / each iteration — fails only on growth
node tools/adoption-baseline.mjs --target . --ratchet  # lock in debt you have paid down
```

Verified end to end on the dogfood target:

| Action | Result |
|---|---|
| record | 49 warnings across 4 families → accepted debt |
| add one post-adoption feature with no `falsifier` | `falsifier-missing: 25 → 26 (+1)` → **exit 1**. The 25 stay silent. |
| pay down 6 of the old ones | reported as paid, still exit 0 |
| `--ratchet` | baseline lowered 25 → 19; those 6 can never come back |

Per-item ids collapse to their family (`scope-smell:feat-x` → `scope-smell`), so renaming a feature
is not new debt and splitting one is not debt paid.

Opt-in gates are recorded as dormant when their prerequisite is absent. When feature `kind` tags
first appear, `build-unproven` is reported as newly measured rather than new debt; review it once
and ratchet the now-observable boundary.

### What is never grandfathered

- **Blockers.** An unfilled placeholder, a feature with no runnable verification, a vacuously-green
  `init.sh` — those are broken *today*, not inherited. `--record` reports them separately and
  refuses to absorb them.
- **A red baseline.** The loop has nothing to stand on without it. Either fix it, or narrow
  `init.sh` to the subset that passes **and write the exclusion into `docs/constraints.md`**.
  Narrowing the command silently is the one move that turns this whole harness into theatre.

## Collisions — merge, never overwrite

`setup-harness-loop.mjs` skips anything that already exists unless `--force`. **Never pass `--force`
to a repo with history.** Each skipped file is a decision:

| Collision | Resolution |
|---|---|
| existing `AGENTS.md` / `CLAUDE.md` | keep theirs, **append** the harness sections (Startup Readiness, WIP=1, session-exit checklist, DoD) and the `docs/` links |
| existing `docs/` with real content | leave it; add `docs/INDEX.md` pointing at what is already there; add only the genuinely missing topic docs |
| a doc already over 300 lines | do **not** split it during adoption. Record it as debt; note the split in `docs/INDEX.md` as future work |
| existing `.kiro/` | merge agent JSONs; never clobber agents they already use |
| existing CI | leave it — point `init.sh` at the same commands so the two cannot drift |

## Backfilling `feature_list.json` honestly

The feature list is the single source of truth for scope, so on an existing repo it must record
**work that exists**, not a plan someone invented at adoption time.

- In-flight work found in commits, branches, TODO clusters or the tracker → `not-started`.
- Already-shipped work → `done` **only with its real verification command run and its output as
  evidence.** Backfilled history is the easiest place in this entire process to write a comfortable
  lie, and a false `done` is permanent: no later node re-examines it.
- Do not invent features to make the list look complete.

## Import only the rules that are real here

The scaffold's `docs/constraints.md` ships with placeholders, not a generic rulebook, and that is
deliberate. An unenforced prohibition costs instruction budget and buys nothing — `gateRules`
measures exactly that (`llm-failure-modes.md`). A constraints file copied from another project is
pure cost.

## Order of operations

1. `install-onboarder.mjs` → survey → one question round → scaffold (no `--force`)
2. Fill real content: architecture, testing standards, constraints, backfilled features, `goal.md`
3. **`adoption-baseline.mjs --record`** — before anything else runs
4. `check-coverage.mjs` = 13/13, `verify-harness --run-features` = 0 blockers,
   `adoption-baseline` = no new debt
5. Resolve human-owned gaps in place with `human-interview`, then hand off to `designer` /
   `feature-planner`, then **one supervised
   `node loop/run-loop.mjs 1`** before any longer run

## Upgrade context is part of the artifact

`upgrade-harness.mjs` reports more than changed filenames. It selects the entries in canonical
`upgrade-context.json` whose declared paths intersect this target and carries their reason, target
impact, semantic merge actions and verification into the upgrade plan. The plan checker stays red
until every applicable entry has a target-specific disposition.

The upgrader also refreshes `skills/harness-upgrade/**` before final validation. This matters for
old targets: an older planner may not understand a new report field, so the refreshed checker reads
the source report and rejects any context ID the plan dropped. Rebuild that plan; never translate a
new canonical behavior from filenames alone.

## Honest limits

- **The baseline forgives whatever was wrong on day one.** If the existing suite is full of
  tautological tests, adoption accepts them. The ratchet stops the pile growing; it does not know
  the pile is bad. Paying it down is a deliberate project, and `review-digest` is the tool for
  choosing where to start.
- **Family-level counting is coarse.** Fixing one `test-untraceable` and adding another nets to
  zero and passes. Precise enough to stop a trend, not to police individual files.
- **Vendored tools can drift until the next upgrade.** Found while building this: the
  adoption snapshot on the dogfood target read 4 warnings instead of 49, because the target's
  vendored `verify-harness.mjs` predated the newer gates. The upgrader refreshes harness-owned
  tools and its own upgrade capability; skipping the upgrade still leaves stale gates that silently
  under-report.

# Harness improvement loop — layer contract, schemas, closing rule

This is the contract `verify-harness.mjs`, `harness-issue.mjs`, and `improve-harness.mjs`
implement. Read it before changing any of the three, or before deciding by hand whether a finding
belongs to the target or to the skill.

## Why a layer tag exists

`check-coverage.mjs` answers one question: are the required files present? It cannot tell "this
project hasn't written its architecture doc yet" from "the scaffolder forgot to write
`docs/architecture.md`". Those need opposite fixes — one is the target's job, one is the skill's.
Every `verify-harness.mjs` finding is tagged accordingly:

- **`layer: project`** — the target repo needs work: fill a placeholder, add a manifest, make a
  build pass, write a real feature. Fixing this never touches `harness-loop/`.
- **`layer: harness`** — the skill itself produced or allowed something broken: a template that
  doesn't substitute a token, a script that writes nothing for a file it owns, an `init.sh`
  VERIFICATION block that can go green without verifying anything. Fixing this means editing
  `templates/tree/**` or `scripts/*.mjs` — never patching the one target and calling it done,
  because the next `setup-harness-loop.mjs` run reproduces the exact same defect.

### Classification rule of thumb

A finding is `layer: harness` only if **every** project scaffolded with this skill would hit it
the same way, regardless of what that project's own content is. If the defect depends on what the
user put in their repo (an unfilled `REPLACE ME`, a project with a genuinely broken build), it is
`layer: project`, even if a template originally wrote that placeholder — the template writing a
placeholder that is supposed to be replaced is correct behavior; the user not replacing it is not
a skill bug.

A concrete near-miss, found by dogfooding this exact rule: a target with zero manifest files hits
`init.sh`'s `else` branch ("No recognized manifest"). That looks like a harness gap (init.sh
"doesn't support this project") but isn't — a project with *no* manifest at all hasn't chosen a
stack yet, which is a project-setup gap the structure gate (L2) already reports. The harness gap
would be a project that *has* a manifest `init.sh`'s stack-detection doesn't recognize. `gateBaseline`
in `verify-harness.mjs` checks `hasAnyManifest()` before tagging this signal `harness`, specifically
to keep this distinction real instead of tautological.

## `trace/verify-report.json` schema (`schema: "harness-verify/1"`)

```jsonc
{
  "schema": "harness-verify/1",
  "target": "/abs/path",
  "timestamp": "ISO-8601",
  "green": false,                 // true iff no blocker-severity finding
  "coverage": { "passed": 12, "total": 13, "results": [...] },  // from check-coverage.mjs --json
  "baseline": { "code": 1, "ms": 459, "timedOut": false, "tail": "last 40 lines" },
  "featureReplay": [{ "id": "feat-002", "command": "...", "code": 1, "timedOut": false }],
  "promoted": ["feat-002"],       // features --promote mechanically flipped to done, if any
  "counts": { "blockers": 6, "warnings": 0, "harnessLayer": 1, "projectLayer": 5 },
  "findings": [
    {
      "gate": "baseline",            // structure | placeholders | baseline | features | loop | clean-state | memory | design
      "id": "init-red",              // stable within a gate; harness-issue.mjs keys on gate/id
      "layer": "harness",
      "severity": "blocker",         // or "warn"
      "symptom": "one line, human readable",
      "remedy": "what to actually change",
      "evidence": "command output or offending line, truncated"
    }
  ]
}
```

`gate/id` is the **signature** used everywhere downstream — it is what makes an issue the same
issue across runs and across targets. Two genuinely different harness defects that happen to share
a `gate/id` (e.g. `baseline/init-red` fires for both "no mvnw" and "no gradlew" today) will be
folded into one issue. That is a known simplification, not a guarantee — see the open item in
`harness-issue.mjs`'s header if you need finer-grained signatures.

## Feature hygiene checks (always `layer: project`)

Two `features`-gate checks exist specifically because a long, hard session can drift into two
failure modes that structural coverage can't see: retrying a stuck feature forever, and marking
something `blocked` without saying why.

- **`over-budget:<id>`** — a feature's `attempts` has reached its `maxAttempts` but `status` is
  still not `blocked`. The timebox (`docs/constraints.md`) exists because an agent (or a human)
  chasing a hard problem can lose track of how many times it's already tried the same thing — this
  turns "how long have we been at this" into a number the maker has to look at, not a feeling.
- **`blocked-unjustified:<id>`** — `status: blocked` with an empty `checkerNotes` and no mention of
  the feature id anywhere in `DECISIONS.md`. An unexplained `blocked` is indistinguishable from an
  agent quietly giving up; this makes "I'm blocked" and "here is exactly why, and what a human
  needs to decide" the same required action instead of two different habits.

Both checks are cheap, structural, and stack-agnostic — they read `feature_list.json` fields and
grep `DECISIONS.md`, nothing about the target's language or build tool.

A third, `severity: warn` (not a blocker — it's a heuristic, not a hard rule):

- **`scope-smell:<id>`** — a feature's `behavior` sentence is over 400 characters or strings
  together 3+ "and"/"then" joiners. Cheap proxy for "this is really two features" or "too big for
  one maker iteration to hold in context" — see
  [references/feature-decomposition.md](references/feature-decomposition.md) Step 3. A false
  positive is fine (it's a warn); a feature that's actually oversized silently sailing through
  structural checks is the failure mode this exists to catch early, before a maker burns its
  `attempts` budget on something that was never one problem.

## `--promote`: the mechanical half of the checker's job

`node scripts/verify-harness.mjs --target DIR --run-features --promote` re-runs every
`readyForCheck: true` (or already-`passing`/`done`) feature's `verification` command, exactly like
`--run-features` alone does, but additionally **writes the result back**: any feature whose command
exits `0`, in a report with **zero blockers anywhere** (not just against that feature), gets
`status: "done"`, `readyForCheck: false`, and a `checkerNotes` line stamped
`[mechanically promoted by verify-harness --promote on <date>: verification re-run, exited 0]`.

This is not a substitute for the checker's semantic review (`loop/checker-prompt.md` — does the
`behavior` actually hold, is there scope bleed, does a cross-service change need the top testing
tier). It automates only the part that was always mechanical anyway: "does the recorded evidence
still reproduce right now." Running it after a maker session, before a human/agent checker pass,
means the checker spends its judgment on the features that need it instead of re-typing commands
that already proved themselves. The all-or-nothing gate (any blocker anywhere blocks all
promotion) is deliberate: a report with any blocker in it is not a run you can trust the rest of.

**It never touches a `status: blocked` feature, even if that feature's verification reproduces.**
Found via real use on aeron-demo, not a synthetic test: a feature can be deliberately `blocked` by
a human/checker because the recorded evidence proves less than the original requirement asked for
— e.g. a SIT was narrowed to assert only a provable subset of behavior, documented in
`DECISIONS.md` as a requirement gap needing a design decision, while the narrowed command still
exits `0`. That `readyForCheck: true` + passing-verification combination looks identical to a
normal promotable feature to a mechanical replay. Promoting it anyway would silently overwrite a
human judgment call with a false "done." `blocked` is therefore excluded unconditionally, the same
way `done` already was — see `demo.sh` step 16.

## `harness-issues.jsonl` — event schema

Append-only, one JSON object per line, folded into current state by `harness-issue.mjs`. Never
edit past lines; only append new events.

| `type` | Written by | Meaning |
|---|---|---|
| `open` | first sighting of a signature | Creates `HI-NNN`. Carries `signature`, `gate`, `layer`, `severity`, `symptom`, `remedy`, `evidence`, `target`. |
| `occurrence` | a later sighting of the same signature | Bumps `occurrences`, appends to `targets` if new. If the issue's folded status was not `open`, flips it back to `open` and sets `regressed: true` — a fix that stopped working is louder than a fix that never landed. |
| `resolve` | `harness-issue.mjs resolve` (by hand, or `improve-harness.mjs --reverify --auto-resolve`) | Folded status → `resolved`. Carries `fix` (what changed) and optional `note`. |
| `wontfix` | `harness-issue.mjs wontfix` | Folded status → `wontfix` (e.g. a false positive, or a stack intentionally out of scope). Carries `note`. |

The only legitimate way to reach `resolved` is `--reverify` actually re-running
`verify-harness.mjs` against a real target and finding the signature gone. Nothing in this system
lets an agent (or a human) type "fixed" and have it stick — that is the same generator/evaluator
separation Lesson 9/13 already requires of the maker–checker loop, applied to the harness's own
defects instead of the target's features.

## Ranking (`improve-harness.mjs`)

```
score = occurrences × severityWeight(blocker=3, warn=1) × max(1, distinct targets) × (regressed ? 2 : 1)
```

Frequency and blast radius matter more than raw severity — an issue hit by every scaffolded
project outranks a rare one even if both are blockers. A regression is weighted double because it
represents a fix that was believed to work and didn't; that is a stronger signal something is
wrong with how the skill verifies its own changes, not just with the original defect.

The routing table (`ROUTES` in `improve-harness.mjs`) maps a `gate/id` prefix to the template or
script most likely to need the fix. It is a starting guess for whoever picks up the issue, not a
guarantee — always read `harness-issues.jsonl`'s full history for that signature before editing,
since the routing table can't see the actual symptom text.

## Closing the loop honestly

1. `verify-harness.mjs` finds a `layer: harness` blocker on some target.
2. `harness-issue.mjs import --report <path>` records it (or bumps the existing issue's
   `occurrences`/`targets` if the signature already exists).
3. `improve-harness.mjs` ranks it; `--prompt` hands the top one to an agent (or a human) with the
   fix-the-template rule spelled out.
4. The fix lands in `templates/tree/**` or `scripts/*.mjs` — the skill, not the target.
5. `improve-harness.mjs --reverify [--target DIR] [--auto-resolve]` re-runs `verify-harness.mjs`
   against every target the issue was seen in (or the one given). Only signatures that stop
   appearing get resolved.
6. If the same signature is imported again later (a regression, or a different target hitting the
   same skill defect), step 2 reopens it automatically and marks it `regressed`.

`scripts/demo.sh` runs this entire cycle against disposable targets with deliberately injected
defects, so the mechanism itself — not just the specific bugs that happened to be found while
building it — is something you can re-verify at any time, not something you have to take on faith.

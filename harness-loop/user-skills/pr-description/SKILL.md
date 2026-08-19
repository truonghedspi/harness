---
name: pr-description
description: Write a pull request description in a structured, review-friendly template — What this PR does, a Files table, Why this matters, an honest How I verified, Out of scope, and a reproducible Reviewer checklist. Use before opening or updating a PR, or whenever asked to draft/write a PR description or PR body.
version: 0.1.0
---

# PR Description

Write a PR description a reviewer can act on without reconstructing context from the diff — not a
changelog, not a restatement of the commit log.

## Fast path

A one-line fix, a dependency bump, a typo: title plus one or two sentences is enough. Forcing the
full template onto a PR too small to need it wastes the reviewer's time reading empty sections more
than it would save skipping them.

## The template

For anything a reviewer needs context to review, use this shape, in order:

1. **Title.** One line, imperative, states the change — not the ticket number. If it closes an
   issue, put `Closes #N` on its own line right after the title, not folded into it.
2. **`## What this PR does`** — 2-4 sentences: what changed and why, from a reviewer's first read.
   Not a copy of the commit log; a reviewer who reads only this paragraph should know what to expect
   from the diff.
3. **`## Files`** — a table: `Path | Kind | Purpose`, `Kind` being `new` / `edit` / `generated`.
   Every row must correspond to a real path in the diff. An aspirational file that never landed is
   worse than no table — it sends the reviewer looking for something that isn't there.
4. **`## Why this matters`** — the motivation a reviewer can't get from the diff alone: what problem
   this solves, why now, what breaks or costs more if this is skipped.
5. **`## How I verified`** — a factual list of what you actually ran, not what should work. Each
   item names a command, a URL, or a specific check, and its actual result. See "Hard boundaries"
   below — this is the section most worth getting right and least worth padding.
6. **`## Out of scope (intentionally deferred)`** — real known gaps you chose not to close here, and
   why. This preempts "why didn't you also fix..." review comments and is honest about debt instead
   of hiding it behind a diff that looks complete.
7. **`## Reviewer checklist`** — checkbox items the reviewer can actually execute: a command to run,
   a URL to hit, a file to open and read. Not a vague "make sure it works."

## Hard boundaries

- **Never write a verification step you did not run.** If you didn't test something, say so
  explicitly, or leave it off. An unverified claim in "How I verified" is the single most expensive
  lie in a PR description, because it's the one section reviewers are most likely to trust without
  re-checking — the entire point of the section is to let them skip re-verifying what you already
  did.
- Every `Files` row must correspond to a real diff line. Do not describe planned, wished-for, or
  "will add in a follow-up" files in the same table as what actually shipped.
- `Out of scope` is for things genuinely deferred with a reason — not a place to bury scope creep or
  quietly admit something is broken without saying so plainly.
- Keep the `Reviewer checklist` reproducible without your context: a reviewer should be able to check
  each box by running something or looking at something, not by asking you a clarifying question
  first.
- Match the description's language and terminology to the repository's own conventions (commit
  style, existing PR templates) rather than importing this skill's exact section wording verbatim
  every time — the *shape* (what/files/why/verified/deferred/checklist) is the invariant, not the
  literal headings.

## Preferences

If `EXTEND.md` exists beside this file, apply it after these invariants. Project or user preferences
may tune heading wording, table columns, or emphasis, but may not weaken the "never write an
unverified verification step" boundary.

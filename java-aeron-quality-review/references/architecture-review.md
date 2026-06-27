# Architecture review: dimensions, argument structure, and templates

This is the reasoning toolkit for stages 3–5 of the review. The mechanical scanners find *symptoms*;
this file is about *judgment*.

## Review dimensions

Sweep these so coverage stays broad. Not every dimension applies to every review — note the ones
you deliberately skipped.

1. **Responsibility & cohesion** — Does each class/module do one thing? A class that parses, decides,
   and persists has three reasons to change. Symptom: a name with "and"/"Manager"/"Util", methods
   that don't share fields, a 600-line file.
2. **Coupling & dependency direction** — Who depends on whom, and does it point the right way?
   Domain logic depending on a framework, a low-level module reaching up to a high-level one, or a
   `switch`/`instanceof` that must be edited every time a type is added — all signal brittle coupling.
3. **Abstraction boundaries / seams** — Where can behaviour be swapped or extended without editing
   existing code? Good seams (interfaces, ports) make features additive. Missing seams make every
   feature invasive.
4. **Error handling & failure model** — What happens on bad input, partial failure, exhaustion?
   Swallowed exceptions, `catch (Exception)`, error paths that allocate or block, unbounded retries.
   In Aeron: an uncaught exception in the service handler can take down the node — bounds-check
   buffer reads.
5. **Concurrency model** — Threading, shared mutable state, visibility, ordering. In Aeron service
   logic the answer should be "single-threaded, no shared state, no locks" — flag anything that
   isn't.
6. **Testability** — Can this be tested without standing up the world? Hard-wired dependencies,
   statics, and hidden time/randomness make tests fragile. Low testability is itself a design smell.
7. **Determinism** (Aeron) — see `aeron-checklist.md`. State mutation must depend only on the input
   message stream and cluster-supplied time, never on wall-clock, randomness, or iteration order.
8. **Performance / hot path** (Aeron / low-latency) — allocation, boxing, blocking, syscalls, and
   unbounded work on the message path. Cold paths (startup, config) are exempt — be precise about
   which path the code is on.

## Per-finding argument structure

A finding that just labels code ("this is tightly coupled") is ignorable. Make it land:

- **Observation** — what the code concretely does. Cite `file:line`.
- **Why it matters** — the *specific* failure mode and its cost. Not "violates SRP" but "to add a
  cancel-replace order you must edit OrderRouter, OrderValidator, and the SBE schema, and miss-editing
  any one is a silent correctness bug." Make the cost tangible: future edit cost, a latency number, a
  correctness risk, a debugging-hours estimate.
- **Severity & likelihood** — how bad if it bites, and how likely. A theoretical issue on a cold path
  is Low; a determinism break in state mutation is Critical.
- **Recommendation** — what to do instead. If it's a clear win, say so. If it's a judgment call,
  hand off to the options template below.

### Steelman first
Before criticizing, state why a competent engineer might have written it this way ("the switch is
fine while there are two order types; the cost only appears at the third"). This keeps you from
flagging deliberate, reasonable trade-offs as mistakes, and makes the genuine findings credible.

## Change-impact / "what if we add X" template

When the user asks what a future change will cost, deliver this structure:

1. **The change, restated** — confirm you understood the feature/requirement.
2. **Blast radius** — the concrete list of files/modules/contracts that must change, grouped:
   - *Additive* (new classes/methods, no existing logic touched) — low risk.
   - *Invasive* (editing existing logic, switches, schemas) — higher risk; each is a chance to break
     something that works today. Call these out individually.
3. **Does it respect the seams?** — Does the existing design let this change slot in, or does it fight
   the design? If it fights, that's the design telling you a refactor should come first.
4. **Aeron ripple effects** (if applicable):
   - SBE / message schema: is this a backward-compatible schema *evolution* (new optional fields,
     bump version) or a breaking change? Breaking changes affect replay of historical logs.
   - Snapshot format: does new state need to be added to snapshot save/load? Forgetting this is a
     silent recovery bug.
   - Determinism: does the new logic introduce any non-deterministic input?
5. **"Will it stay clean?"** — honest verdict: does this change improve, preserve, or erode the
   design? If it erodes it, name the debt being taken on.
6. **Cheapest safe path** — sometimes "do the small refactor first, then the feature is additive" is
   the right answer. Say so when it is.

## Options & recommendation template

When there's a real fork in the road, don't leave the user with "it depends." Structure it:

For each option (aim for 2–4 concrete, named options):
- **Summary** — one line.
- **Strengths** — what it buys.
- **Costs / risks** — what it costs now and later (latency, complexity, evolvability, determinism).
- **Fit** — how it scores against what *this* codebase values most.

Then:
- **Recommendation** — pick one. Commit.
- **Why** — the deciding factor.
- **Hinge condition** — "I'd switch to option B if <X becomes true>." This is what makes the advice
  trustworthy: it shows you know the boundaries of your own recommendation.

### Example (abbreviated)
> **Adding a new venue to the order router**
> - *Option A — extend the switch:* simplest, zero new abstraction. Cost: 4th edit-site for venue
>   logic; the switch becomes a change magnet. Fit: fine if venues are rare.
> - *Option B — VenueHandler interface + registry:* venues become additive (one new class each).
>   Cost: one indirection, slightly harder to trace. Fit: strong if you expect more venues.
>
> **Recommendation:** B. You've added two venues in three months — the switch is already a change
> magnet, and the indirection cost is small and one-time. **Hinge:** if the roadmap truly caps at
> these venues, A is fine and B is over-engineering.

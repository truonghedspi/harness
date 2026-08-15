# Baoyu Skills: patterns for agent capability

Research date: 2026-08-15. Scope: official `JimLiu/baoyu-skills` repository only.

## Conclusion

Baoyu's strongest skills do not rely on one unusually clever system prompt. They package a bounded
job as an executable operating procedure:

```text
precise trigger
→ resolve user/project preferences
→ analyze into a durable intermediate artifact
→ confirm consequential choices
→ load only the selected references
→ execute deterministic parts with scripts
→ review/regenerate from the artifact
→ report named outputs
```

That shape reduces choice at execution time, preserves intent between stages, and makes correction
local. It is directly relevant to our planner, checker, designer, and setup agents, which currently
have role prompts and references but mostly lack capability-shaped skill packages and executable
self-checks.

Baoyu is evidence for **skill packaging and workflow design**, not evidence that the agents pass
semantic capability tests. Its root package exposes Node tests and coverage, but those commands do
not by themselves establish planner/checker-style behavioral evals
([package.json](https://github.com/JimLiu/baoyu-skills/blob/main/package.json)). We should adopt the
operating patterns while retaining our independent evaluator, typed routing, and capability eval
plan.

## Why the system produces strong results

### 1. Trigger descriptions specify intent, synonyms, and boundary

The frontmatter descriptions are retrieval interfaces, not slogans. `baoyu-translate` lists English
and Chinese intent phrases, file/URL inputs, three modes, and glossary support. `baoyu-markdown-to-html`
names both the transformation and platform-specific capabilities. This gives the runtime positive
signals precise enough to select a skill without loading its body
([translate](https://github.com/JimLiu/baoyu-skills/blob/main/skills/baoyu-translate/SKILL.md),
[markdown-to-html](https://github.com/JimLiu/baoyu-skills/blob/main/skills/baoyu-markdown-to-html/SKILL.md)).

Lesson for us: each agent capability needs a trigger/entry contract such as “derive build/prove DAG
from approved design” or “evaluate evidence for the current feature revision,” including explicit
non-triggers. An agent name such as `feature-planner` is not yet a capability contract.

### 2. Progressive disclosure is encoded as routing

The skill entry contains the invariant workflow and a reference index; detailed material lives in
branch-specific files. The slide skill reads one preset file only after style resolution, reads
custom dimension files only for the custom branch, and points Codex-specific invocation details to
a reference loaded only when that backend is selected. It also reuses style instructions already
materialized in the outline rather than rereading the source reference for each slide
([slide-deck](https://github.com/JimLiu/baoyu-skills/blob/main/skills/baoyu-slide-deck/SKILL.md)).

This is stronger than indiscriminate auto-loading: the agent first resolves state, then loads the
knowledge for that state. The repository README explicitly recommends installing only needed skills
because bulk installation adds context overhead
([README](https://github.com/JimLiu/baoyu-skills/blob/main/README.md#installation)).

Lesson for us: keep agent baseline context small, but make conditional handoffs mandatory and
machine-addressable. A designer routed from rejection should read the current typed review artifact;
a maker routed to baseline repair should read that request; a planner should load decomposition and
invariant references before planning, not on every unrelated run.

### 3. Prompt structure is an ordered procedure with hard gates

Representative visual skills publish a checklist, label blocking steps, state exactly when user
confirmation may be skipped, and define the output of each step. The slide workflow separates
analysis, confirmation, outline, optional outline review, prompt generation, optional prompt review,
rendering, merge, and summary. Invocation or preset matching is explicitly *not* permission to skip
confirmation
([slide-deck](https://github.com/JimLiu/baoyu-skills/blob/main/skills/baoyu-slide-deck/SKILL.md#workflow)).

The instructions also constrain interaction mechanics: prefer the runtime's user-input tool, batch
questions when supported, and provide a plain-text fallback. This is runtime-neutral without being
vague.

Lesson for us: role prompts should become thin launchers into a skill workflow. Each workflow step
needs preconditions, owned output, stop/continue conditions, and the next consumer. Put human gates
at consequential choices, not at every step.

### 4. Durable intermediates make work reproducible and editable

The article illustrator and slide skill require full prompts to be written before image generation.
The slide flow saves `analysis.md`, `outline.md`, per-slide prompt files, images, PPTX, and PDF; edits
must update the prompt source before regeneration. Existing outputs are backed up rather than silently
overwritten
([article illustrator](https://github.com/JimLiu/baoyu-skills/blob/main/skills/baoyu-article-illustrator/SKILL.md),
[slide-deck](https://github.com/JimLiu/baoyu-skills/blob/main/skills/baoyu-slide-deck/SKILL.md#file-layout)).

This converts an opaque model run into inspectable checkpoints. A failed slide does not require
recreating the whole deck; only the failed prompt/output is regenerated.

Lesson for us: give every capability a canonical artifact. Planner output is a schema-validated plan;
reviewer output is a digest-bound verdict; setup first emits a survey; checker emits typed evidence.
Downstream agents consume those artifacts rather than summaries embedded in dispatch prose.

### 5. Separate semantic judgment from deterministic mechanics

Baoyu delegates predictable transformations to scripts. The slide skill uses scripts to merge PNGs
into PPTX/PDF; markdown-to-HTML has a single CLI entry point and JSON stdout; the formatter delegates
CJK typography corrections to scripts; translation delegates chunking to code
([slide-deck](https://github.com/JimLiu/baoyu-skills/blob/main/skills/baoyu-slide-deck/SKILL.md#script-directory),
[markdown-to-html](https://github.com/JimLiu/baoyu-skills/blob/main/skills/baoyu-markdown-to-html/SKILL.md#script-directory),
[formatter](https://github.com/JimLiu/baoyu-skills/blob/main/skills/baoyu-format-markdown/SKILL.md),
[translate](https://github.com/JimLiu/baoyu-skills/blob/main/skills/baoyu-translate/SKILL.md)).

The model chooses title, structure, style, or translation; code handles parsing, chunking, conversion,
backup, merge, and machine-readable results. This prevents prompt tokens from reimplementing logic
that can be tested deterministically.

Lesson for us: planner/checker skills should ship scripts for schema, DAG, citation, orphan-feature,
digest, and permission checks. Reserve evaluator judgment for semantic correctness and falsification.

### 6. Output constraints are concrete, including negative rules

The formatter states its invariant (“format, do not rewrite”), then lists prohibited mutations.
Visual skills specify filenames, directory layout, aspect, prompt sections, retry behavior, and forbid
patching bad rendered text with bitmap overlays. Markdown-to-HTML specifies conflict backup and JSON
stdout. These are more actionable than “produce a high-quality result”
([formatter](https://github.com/JimLiu/baoyu-skills/blob/main/skills/baoyu-format-markdown/SKILL.md),
[markdown-to-html](https://github.com/JimLiu/baoyu-skills/blob/main/skills/baoyu-markdown-to-html/SKILL.md#output)).

Baoyu also turns qualitative space into composable dimensions: layout versus style for infographics;
texture, mood, typography, and density for slides. Presets reduce decision cost while dimensions keep
the system extensible
([infographic](https://github.com/JimLiu/baoyu-skills/blob/main/skills/baoyu-infographic/SKILL.md),
[slide-deck](https://github.com/JimLiu/baoyu-skills/blob/main/skills/baoyu-slide-deck/SKILL.md#style-system)).

Lesson for us: state both `mustProduce` and `mustNot`, and decompose “good design” or “good plan” into
observable dimensions. Those dimensions become fixture axes instead of adjectives in a prompt.

### 7. Review and iteration are first-class branches

Slide generation can stop after outline or prompts, lets the user review both, supports targeted
regeneration, retries failed items without regenerating successful ones, and keeps source prompt
files authoritative. Translation offers quick, normal, and refined workflows; refined adds review
and polish, while normal can be upgraded later without restarting
([slide-deck](https://github.com/JimLiu/baoyu-skills/blob/main/skills/baoyu-slide-deck/SKILL.md#workflow),
[translate](https://github.com/JimLiu/baoyu-skills/blob/main/skills/baoyu-translate/SKILL.md#modes)).

Lesson for us: capability repair should return to the smallest failed artifact. A rejected design
returns evidence bound to its digest; a malformed plan returns mechanical findings; only semantic
uncertainty escalates. Do not rerun the entire agent chain for a local failure.

### 8. Customization and distribution are designed, not improvised

`EXTEND.md` provides ordered project/XDG/user customization without editing the shipped skill. Some
skills require first-time setup; others intentionally use safe defaults. This is an overlay model,
not a fork. The repository supports selective Codex project installation, a Claude plugin marketplace,
individual ClawHub publication, versioned skill frontmatter, and one marketplace inventory
([README](https://github.com/JimLiu/baoyu-skills/blob/main/README.md),
[marketplace manifest](https://github.com/JimLiu/baoyu-skills/blob/main/.claude-plugin/marketplace.json)).

Lesson for us: capability skills should be skill-owned, versioned bundles; target-specific stack
knowledge belongs in a project overlay. This aligns with the pending ownership/upgrade work and avoids
editing vendored skill bodies in targets.

## How Baoyu collects context before acting

Baoyu uses a staged intake rather than “read everything, then decide”:

1. **Classify the input surface.** The illustrator distinguishes file input, pasted content, saved
   reference images, and conversation-only images. Each form has a different materialization path.
2. **Resolve scoped configuration.** Project `EXTEND.md` wins over XDG and user configuration; the
   skill reports what it loaded. Some workflows block on first-time setup, while utilities with safe
   defaults continue. This makes scope and precedence explicit.
3. **Inspect existing state before mutation.** Existing outputs trigger supplement/overwrite/
   regenerate choices or backups. The workflow does not assume an empty directory.
4. **Analyze into bounded facts.** Content type, core arguments, language, intended audience,
   visual opportunities, and reference usage are extracted before generation.
5. **Ask only unresolved consequential questions.** Preferences and detected facts suppress
   redundant questions; remaining questions are batched. Confirmation locks choices before costly
   work.
6. **Load branch-specific knowledge.** Only the chosen style, palette, type template, or backend
   reference is loaded after routing. The author guide requires `SKILL.md` under 500 lines and
   one-level references for this progressive disclosure
   ([creating skills](https://github.com/JimLiu/baoyu-skills/blob/main/docs/creating-skills.md)).
7. **Materialize provenance-bearing artifacts.** Saved references receive IDs, filenames, and
   descriptions; conversation-only visual traits are marked as extracted text and must not pretend
   to be file references. Outlines carry reference assignments, while prompts contain actual source
   terms and values
   ([illustrator workflow](https://github.com/JimLiu/baoyu-skills/blob/main/skills/baoyu-article-illustrator/references/workflow.md)).

Its self-containment rule also matters: a distributed skill may not link outside its directory, so
all required references/scripts travel with it. External content is explicitly untrusted
([repository instructions](https://github.com/JimLiu/baoyu-skills/blob/main/CLAUDE.md#skill-self-containment)).

Baoyu does **not** provide a general multi-repository collector. Project-level discovery is rooted in
the current working project, and its reference handling is task-local. There is no demonstrated
mechanism that enumerates sibling service repos, discovers each repo's own rules, records scope and
digest, or refreshes pointers when those rules change. Our `collect-services`/`ownRules` design is
therefore complementary, not something upstream replaces.

For harness, use the same staged pattern at repository scale: inventory service roots first; record
source pointers plus scope/digest/provenance; collect manifests, public interfaces, verification
commands, and rule-file pointers into a typed survey; ask only about unresolved conflicts; then let
each routed agent load the full original file on demand. Keep summaries as indexes, never substitutes
for service-owned rules. Persist the exact input digests in each handoff so capability tests can prove
the agent acted on the current context.

## Concrete adaptation for harness

Build four small capability packs before adding more baseline context:

```text
skills/feature-planning/
  SKILL.md                    # analyze → resolve ambiguity → draft → self-check → submit
  schemas/plan.schema.json
  references/cutting-rules.md
  references/counterexamples.md
  scripts/check-plan.mjs
  evals/{fixtures,controls}/

skills/feature-checking/
  SKILL.md                    # bind revision → inspect evidence → falsify → verdict
  schemas/verdict.schema.json
  references/test-anti-patterns.md
  scripts/check-verdict.mjs

skills/design-loop/
  SKILL.md                    # draft → review → digest-bound revision
  schemas/{design-review,routing-request}.schema.json
  references/{design-method,review-rubric}.md

skills/harness-setup/
  SKILL.md                    # survey → confirm conflicts → install → independent validate
  schemas/survey.schema.json
  scripts/{survey,validate}.mjs
```

For each pack:

1. Frontmatter names positive and negative triggers.
2. `SKILL.md` is the short invariant path and reference router.
3. Every conditional route names the exact typed artifact to read.
4. Deterministic checks are scripts with JSON output.
5. `mustProduce` and `mustNot` are explicit.
6. Fixtures test one failure mode; controls test false positives.
7. Capability promotion is invalidated by skill, prompt, model, or resource digest changes.
8. `demo.sh` checks packaging/contracts; the separate eval runner measures semantic behavior.

Context budget should be spent on the invariant path plus a tiny failure-mode digest. Detailed stack,
design, or test references load only after the input/request type is known. This follows Baoyu's useful
progressive disclosure without making “the prompt told it to read the file” our only guarantee: the
capability runner should record required reads and reject a handoff whose input digest is absent.

## Reuse boundary

### Direct reuse

The repository is MIT licensed: use, modification, redistribution, and sublicensing are permitted,
provided the copyright and permission notice are retained in copies or substantial portions
([LICENSE](https://github.com/JimLiu/baoyu-skills/blob/main/LICENSE)). Directly copied scripts,
templates, or substantial prompt text therefore need attribution and the MIT notice. The README says
ClawHub publications use MIT-0 under that registry's rules; that statement should not be generalized
to the GitHub repository, whose root license is MIT
([README](https://github.com/JimLiu/baoyu-skills/blob/main/README.md#publish-to-clawhub--openclaw)).

There is little reason to directly copy its content-production skills into this harness. Direct reuse
would make sense only for a matching utility, with pinned upstream revision, provenance, license text,
and our own integration verification.

### Pattern reuse

We can freely reimplement the ideas: precise trigger descriptions, thin router plus references,
preference overlays, intermediate source-of-truth files, hard confirmation gates, deterministic
scripts, structured stdout, backup/regeneration policy, dimension/preset modeling, and selective
installation. These patterns should be expressed in our domain vocabulary and schemas, not copied as
content-generation prose.

### Not solved upstream

Baoyu does not, from the inspected official materials, solve our whole control-plane problem:

- no demonstrated independent semantic evaluator for each skill capability;
- no promotion threshold across repeated randomized/hidden fixtures;
- no evidence that required conditional references were actually read;
- no project-versus-harness finding classification or repair routing;
- no cross-agent revision/digest state machine like our design/checker loop;
- no ownership-aware upgrade mechanism for customized scaffold files;
- no memory-to-rule/gate/template promotion loop.

Its review checkpoints are often human confirmation and its quality guarantees are primarily workflow
contracts plus deterministic scripts. We should combine those strengths with our typed state,
independent checker, capability evals, calibration corpus, and cycle detection rather than treating
the upstream skills as proof of agent competence.

## Recommended sequence

1. Package `feature-planning` first; it addresses open `HI-017` and has clear mechanical checks.
2. Package checker anti-pattern knowledge and a typed verdict self-check.
3. Make design rejection a complete artifact-driven round trip, including required-read evidence.
4. Split setup into survey/install/validate phases inside one skill before deciding whether separate
   agents are needed.
5. Add hidden/parameterized capability fixtures and consumer acceptance tests.
6. Only then increase auto-loaded context or add more skills; capability results should justify the
   added context cost.

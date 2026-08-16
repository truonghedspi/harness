# Human presenter: evidence and proposed design

Research date: 2026-08-16. Sources are the official `JimLiu/baoyu-skills` repository, W3C
recommendations/guidance, original or publisher-hosted research, and government guidance. This note
separates what those sources establish from our proposed adaptation.

## Conclusion

`human-presenter` should be a user-scope, general-purpose communication skill used whenever an agent
communicates substantive information to a person. It should not merely polish prose. It should first
model the reader's task, audit claims and provenance, choose the smallest useful representation, and
then produce an answer-first message whose evidence, inference, uncertainty, and recommendation are
distinguishable without labeling every sentence.

Baoyu supplies a strong **skill packaging and visual-routing pattern**. Accessibility and learning
research supply the **reader constraints**. W3C PROV supplies a useful **internal provenance model**.
None of those sources proves that the proposed skill improves agent conversations; that requires a
paired capability evaluation against realistic conversations.

## What Baoyu actually does

### Structure before style

The infographic skill models layout and visual style as independent dimensions. It analyzes content,
selects from named information layouts, then combines the selected layout with a style. Its routing
table maps structures such as sequence, comparison, hierarchy, overlap, conversion, cycle, technical
breakdown, and metrics to candidate layouts. Definitions live in layout/style reference files rather
than one monolithic prompt
([infographic skill](https://github.com/JimLiu/baoyu-skills/blob/main/skills/baoyu-infographic/SKILL.md)).

The diagram skill similarly maps a reader need to a diagram grammar: process to flowchart, ordered
actor interaction to sequence, containment/topology to architecture, type relationships to structural,
chronology to timeline, and transitions to state machine. Only after choosing the type does it load
the type-specific reference. It then follows a common visual system and mechanical spacing/layering
rules
([diagram skill](https://github.com/JimLiu/baoyu-skills/blob/main/skills/baoyu-diagram/SKILL.md)).

### Thin router, conditional references, executable mechanics

Across the repository, frontmatter describes triggering intent; `SKILL.md` owns the invariant
workflow; branch-specific detail lives in `references/`; deterministic conversion or validation is
delegated to `scripts/`; and preferences are overlays rather than edits to the shipped skill. The
README recommends installing only the needed skills because bulk installation adds context overhead
([README](https://github.com/JimLiu/baoyu-skills/blob/main/README.md),
[authoring guide](https://github.com/JimLiu/baoyu-skills/blob/main/docs/creating-skills.md)).

Visual skills also analyze before generating, preserve an outline/prompt as a durable intermediate,
confirm consequential choices, and regenerate from that artifact. These are workflow controls, not
evidence that their visual recommendations are empirically optimal
([article illustrator](https://github.com/JimLiu/baoyu-skills/blob/main/skills/baoyu-article-illustrator/SKILL.md)).

### What not to infer

Baoyu does not provide a general conversational presenter, claim-level provenance protocol, or
published semantic evaluation showing that its routing improves comprehension or decisions. We can
adapt its decomposition and packaging; we should not cite its popularity or visual polish as evidence
of communication effectiveness.

## Reader constraints supported by other sources

- CDC's Clear Communication Index asks authors to identify the primary audience, objective, and one
  obvious main message, put that message first, and pair it with the action when applicable
  ([CDC Index](https://www.cdc.gov/ccindex/widget.html),
  [user guide](https://www.cdc.gov/ccindex/pdf/clear-communication-user-guide.pdf)).
- The UK Office for National Statistics recommends evidence-backed user needs, inverted-pyramid
  structure, front-loaded sections and sentences, self-contained chunks, and removal of content that
  does not serve the prioritized need
  ([user needs](https://service-manual.ons.gov.uk/content/writing-for-users/user-needs),
  [content structure](https://service-manual.ons.gov.uk/content/writing-for-users/structuring-content)).
- W3C guidance recommends understandable words, short sentences and blocks, unambiguous content,
  whitespace, summaries, clear images, and separated instructions. Logical headings help readers find
  and prioritize content
  ([clear content](https://www.w3.org/WAI/WCAG2/supplemental/objectives/o3-clear-content/),
  [page structure](https://www.w3.org/WAI/tutorials/page-structure/)).
- W3C recommends alternative forms for complex material, including summaries, step-by-step text,
  explanations of choices and disadvantages, tables, charts, and informational graphics. It treats
  these as ways to serve different reader needs, not as a command to visualize every answer
  ([alternative content](https://www.w3.org/WAI/WCAG2/supplemental/patterns/o7p02-alternative-content/)).
- Mayer's research-based multimedia principles support words plus relevant pictures, proximity of
  corresponding words and pictures, and removal of extraneous material. Later synthesis names
  coherence, signaling, redundancy, and contiguity as controls on unnecessary processing
  ([Mayer 1999](https://doi.org/10.1075/dd.1.1.02may),
  [Fiorella & Mayer 2021](https://doi.org/10.1017/9781108894333.019)). These findings concern
  instructional multimedia; applying them to agent chat is a reasoned transfer, not direct evidence.
- Sweller's original cognitive-load work shows that means–ends problem solving can consume cognitive
  capacity while contributing little to schema acquisition. For this skill, “do not make the reader
  reconstruct the conclusion” is an adaptation of that concern, not a result tested on agent replies
  ([Sweller 1988](https://doi.org/10.1207/s15516709cog1202_4)).
- W3C PROV represents origins through entities, activities, agents, use, generation, derivation, and
  attribution so a consumer can assess quality, reliability, trust, or reproducibility. It is a sound
  internal vocabulary, but it does not prescribe a low-clutter citation UI
  ([PROV primer](https://www.w3.org/TR/prov-primer/),
  [PROV overview](https://www.w3.org/TR/prov-overview/)).
- UK government guidance says uncertainty in analysis must be communicated clearly to decision-makers,
  and balanced risk information should enable decisions. It does not justify reducing uncertainty to
  an unsupported scalar confidence score
  ([uncertainty toolkit](https://www.gov.uk/government/news/uncertainty-toolkit),
  [risk communication guidance](https://www.gov.uk/government/publications/communicating-risk-guidance)).
- IPCC separates qualitative confidence, based on evidence and agreement, from quantitative
  likelihood and uses calibrated language consistently. This supports recording the basis of
  uncertainty rather than inventing a generic confidence percentage
  ([IPCC AR6 uncertainty framing](https://www.ipcc.ch/report/ar6/wg1/chapter/chapter-1/)).
- NASA's risk-informed decision process starts from stakeholder objectives, compares feasible
  alternatives under significant uncertainty, and treats analysis as input to—not a replacement for—
  human value judgment. Its selection reports lead with the choice and rationale before technical
  basis, deliberation, risks, and robustness
  ([NASA Risk Management Handbook](https://www.nasa.gov/wp-content/uploads/2023/08/nasa-risk-mgmt-handbook.pdf)).
- Google's technical-writing guidance identifies LLMs as useful for editing, style checks, finding
  logical inconsistencies, audience-role framing, and reformatting. This supports using the model for
  synthesis and adaptation, not treating it as an evidence authority
  ([Google Technical Writing](https://developers.google.com/tech-writing/two/llms)).

## Proposed user-scope architecture

This section is an adaptation to be tested, not a description of upstream behavior.

```text
~/.agents/skills/human-presenter/
├── SKILL.md                       # short invariant pipeline and routing table
├── references/
│   ├── intents.md                 # answer, explain, report, compare, recommend, hand off
│   ├── visuals.md                 # representation selection and anti-patterns
│   ├── provenance.md              # claim kinds and reader-facing disclosure
│   ├── uncertainty.md             # limits, confidence basis, decision sensitivity
│   ├── language.md                # clear, domain-consistent, audience-calibrated wording
│   └── modes/                     # only load the selected mode
│       ├── status.md
│       ├── investigation.md
│       ├── comparison.md
│       ├── recommendation.md
│       └── research-summary.md
├── schemas/presentation-plan.schema.json
├── scripts/check-presentation.mjs # structural/provenance checks, never semantic truth
└── evals/                         # fixtures, controls, paired reader tasks
```

The invariant pipeline should be:

```text
reader task → claim audit → governing thought → information groups
            → representation route → draft → provenance/uncertainty audit → deliver
```

The internal plan should record audience, intent, governing thought, claims, relations, source
pointers, inference dependencies, uncertainty, recommended representation, and why it helps. It is
scratch state, not a form shown to the user.

### Always-included behavior

An ordinary skill description alone cannot guarantee activation on every reply. Installation at user
scope provides availability, not enforcement. The runtime/user-level instructions or communication
wrapper must state: “Before every substantive user-facing answer, apply `human-presenter`; skip only
for acknowledgements or verbatim/tool protocol output.” The skill remains selectively loaded through
its thin router; it must not preload every mode/reference into every turn.

This contract should cover final answers and meaningful progress reports, but not silently rewrite
machine-readable output, code requested verbatim, legal quotations, or user-authored text unless asked.

## Proposed representation router

Choose a visual only when it materially reduces reconstruction effort. Prefer the smallest form that
preserves the important relation; accompany nontrivial visuals with a short textual takeaway and an
accessible alternative.

| Information relation / reader need | Default | Use when | Do not use when |
|---|---|---|---|
| One conclusion, fact, or action | Prose | One idea is sufficient | A visual would restate it |
| Repeated exact mappings | Table | Same fields recur across 3+ items | Cells become paragraphs |
| Alternatives under shared criteria | Comparison table | 2–5 real options, stable criteria | Choice depends mainly on sequence/context |
| Ordered dependent steps | Flow | 3+ steps or branches | A numbered list is already obvious |
| Actors/messages over time | Sequence | Ordering, sync/async, retry matter | Ownership alone is the question |
| Components, containment, ownership | Architecture/tree | 3+ relationships or nesting levels | Only one edge matters |
| State/event changes | State diagram/timeline | Transition or chronology explains behavior | Events are unrelated |
| Input/output transformation | Mapping/table or data-flow | Multiple fields/stages transform | One input maps to one output |
| Risk by two quantitative dimensions | Matrix | Scales and thresholds are defined | Ratings are impressionistic |
| Trend/distribution | Chart | Numeric pattern matters | Values are sparse/categorical |
| Decision branches | Decision tree | Conditions lead to different actions | Merely comparing options |
| User-interface arrangement | Wireframe | Spatial layout drives understanding | Discussing behavior, not layout |
| Mechanism/intuition | Illustrative diagram | Spatial metaphor is faithful and helpful | Metaphor can mislead |

The presenter may call a dedicated visual skill such as `baoyu-diagram` after routing, but remains
responsible for the claim set, source binding, takeaway, and accessibility. The renderer owns visual
grammar and file validation, not factual interpretation.

## Proposed provenance without citation clutter

Maintain fine-grained provenance internally and disclose it at the coarsest readable level that stays
unambiguous:

1. Classify each material claim as `user-provided`, `source-fact`, `runtime-observation`, `inference`,
   `assumption`, `uncertainty`, or `recommendation`.
2. Keep exact source pointer, version/digest/time, and derivation edges in the presentation plan.
3. Group adjacent source-backed claims that share sources; place one compact marker at the paragraph
   end, not after every sentence.
4. Separate inference through natural transitions (“Điều này cho thấy…”) or a short section, and link
   it internally to the facts it uses. Never attach a source marker as if the source asserted the
   inference.
5. Put a compact `Nguồn kiểm chứng` map at the end only when sources aid audit. Use clickable file
   links or direct primary-source links. For two or fewer unobtrusive links, link descriptive text
   inline instead.
6. Report runtime observations with action, environment/time when material, and outcome. Do not treat
   “command exited” as “claim proved.”
7. Express uncertainty as the unknown, its basis, its decision impact, and what would resolve it.
   Avoid invented percentages and generic disclaimers.

Source IDs are presentation aliases, not the provenance store. W3C PROV motivates retaining entity,
activity, agent, and derivation separately; the `[S1]` surface is our readability adaptation.

## Language and reasoning contract

- Match the user's language and domain vocabulary; define an unfamiliar term once.
- Lead with the governing thought. Support it with no more groups than the material requires.
- Preserve material nuance while removing routine process detail and duplicated evidence.
- Use calibrated verbs: observed, established, indicates, suggests, assumes, recommends.
- Do not convert absence of evidence into evidence of absence.
- For a recommendation, state the decisive reason, main downside, and strongest credible counter-case.
- For a decision, say what changes, what remains unknown, and what delay or reversal costs.
- Before delivery, test whether contradictory evidence, a hidden assumption, or source staleness would
  overturn the conclusion.
- Do not visualize decorative structure, fabricate symmetry among options, or use headings for every
  sentence.

## Capability evaluation

Mechanical checks can verify plan shape, source resolution, claim/source coverage, accessible image
alternatives, link validity, first-paragraph length, and whether a selected visual has a recorded
reason. They cannot establish truth, readability, or sound judgment.

Use paired, blind evaluation on realistic tasks: raw agent answer versus presenter-assisted answer.
Include expert and non-expert readers, short and complex inputs, Vietnamese and English, and cases
where the correct route is no visual. Measure:

1. **Comprehension:** correct answers to factual/relational questions without reopening sources.
2. **Decision quality:** selection consistent with stated constraints; ability to name the key downside.
3. **Time and effort:** time to answer, rereads, clarification requests, perceived effort.
4. **Epistemic calibration:** readers distinguish confirmed fact, observation, inference, assumption,
   and unknown; citations support the claims attributed to them.
5. **Actionability:** reader can state the next action, owner, and blocker.
6. **Representation fit:** visual adds measurable comprehension/time benefit; no-visual controls avoid
   decorative diagrams.
7. **Language quality:** terminology consistency, ambiguity, unnecessary jargon, unsupported
   absolutes, and verbosity.
8. **Robustness:** conflicting sources, stale evidence, mixed confidence, incomplete data, adverse
   recommendation, and accessibility cases.

Promotion should require improvement in comprehension or decision performance without worsening
factual accuracy or calibration. Aesthetic preference, answer length, and citation count are diagnostic
metrics, not success criteria. Re-evaluate when the skill, model, renderer, reference set, or global
activation instruction changes.

## Boundary with adjacent skills

- `human-presenter` decides how established content is communicated.
- `human-interview` decides what missing human-owned information to ask for and validates the answer;
  it uses the presenter for readable questions.
- `decision-proposal` develops options, reversibility, trade-offs, and recommendation; it uses the
  presenter for the final proposal.
- `baoyu-diagram` or another renderer materializes a routed visual; it does not decide whether the
  underlying claims are true.

Keeping those seams prevents a ubiquitous presenter from becoming a hidden decision-maker or a
context-heavy universal manual.

# Critique-technique sources — behind the `design-facilitator` role

This is **source material**, cited so the technique in `prompts/design-facilitator.md` is traceable
back to where it came from rather than improvised nitpicking. Each entry below names a primary
source and states the technique in a form a checklist step can quote almost verbatim.

**History, so the citations below still make sense:** this repo used to run `designer` and
`design-reviewer` as two agents that could reject and re-dispatch each other with no human in the
loop — a design that changed even slightly between rounds reset the escalation bound, so rejection
could cycle indefinitely (`docs/reference/graph.md` row 11). `design-reviewer.md` applied exactly one
Socratic move — *"which assumption, if false, flips this conclusion?"* — checked against
`docs/assumptions.md`. That file no longer exists; its one question is now Phase 4's **Key
Assumptions Check** in `prompts/design-facilitator.md`, formalized into Heuer's four-step worksheet
(§5 below) rather than left as a single informal question. Everything else in this document — the
other eight Socratic question types, argument mapping, PrOACT/WRAP, anchoring, premortem, Devil's
Advocacy, steelmanning — was net-new material folded into that same prompt.

## 1. Socratic questioning

**Richard Paul & Linda Elder, *The Thinker's Guide to the Art of Socratic Questioning* (2006),
Foundation for Critical Thinking.**
https://www.criticalthinking.org/files/SocraticQuestioning2006.pdf (primary PDF, verified by
direct extraction) · org home: https://www.criticalthinking.org/

The guide's own **"Art of Socratic Questioning Checklist" (p.10)** is a 9-item procedure, phrased as
yes/no checks with example prompts — directly liftable as agent steps. Verified from the source
text:

1. Did the questioner make the goal of the discussion clear? ("What are we trying to accomplish?")
2. Did the questioner pursue relevant information? ("What information are you basing that on?")
3. Did the questioner question inferences, interpretations, and conclusions? ("How did you reach
   that conclusion? Is there another possible interpretation?")
4. Did the questioner focus on key ideas or concepts?
5. Did the questioner note questionable assumptions? ("What exactly are you taking for granted
   here?") — this is the one line `design-reviewer.md` already implements.
6. Did the questioner question implications and consequences? ("If people accepted your conclusion
   and acted on it, what would follow?")
7. Did the questioner call attention to the point of view inherent in an answer? ("Is there another
   point of view we should consider?")
8. Did the questioner keep the central question in focus?
9. Did the questioner call for clarification of context when necessary?

Items 2, 3, 4, 6, 7, 9 are unused in the current baseline — each is a distinct question type
(evidence, inference validity, concept clarity, consequences, alternative viewpoint, context) that a
facilitator could ask about a design *before* the human ever sees it, none of which reduce to
assumption-hunting.

## 2. Argument mapping

**Tim van Gelder — "What is argument mapping?" (2009) and "Using Argument Mapping to Improve
Critical Thinking Skills" (in *New Directions in Critical Thinking*), hosted by ThinkerAnalytix.**
https://timvangelder.com/2009/02/17/what-is-argument-mapping/ ·
https://thinkeranalytix.org/wp-content/uploads/2018/09/TvG-Using-argument-mapping-to-improve-critical-thinking-skills-2015.pdf

Van Gelder (Principal Fellow, University of Melbourne; creator of the Reason!Able / Rationale
software, originally with Austhink) built argument mapping around **box-and-arrow diagrams**: the
conclusion sits at the top, each premise is a separate box connected to it, and objections are
mapped as their own branch rather than folded into prose. His University of Melbourne course
"Critical Thinking: The Art of Reasoning" (12 weeks of mapping practice) measured 0.7–0.85 SD gains
in reasoning ability pre/post — evidence the technique, not just the theory, changes outcomes. The
checklist-convertible core: **a design option is not justified until it has at least one mapped
objection branch, not just supporting premises** — an option with only a support chain and no drawn
counter-branch has not actually been argued for, only asserted.

## 3. Decision quality / decision analysis

**John S. Hammond, Ralph L. Keeney, Howard Raiffa, *Smart Choices: A Practical Guide to Making
Better Decisions* (Harvard Business School Press, 1999).**
https://www.pon.harvard.edu/shop/smart-choices-a-practical-guide-to-making-better-decisions/

Defines **PrOACT**: Problem, Objectives, Alternatives, Consequences, Tradeoffs (plus Uncertainty,
Risk tolerance, and Linked decisions for harder cases). Checklist-convertible: before accepting a
design's recommendation, verify each element is *stated separately* in the document — a Problem
framed too narrowly, Objectives smuggled inside the Alternatives list, or Tradeoffs left implicit
are each a named PrOACT failure mode, not vague dissatisfaction.

**Chip Heath & Dan Heath, *Decisive: How to Make Better Choices in Life and Work* (Crown Business,
2013).** https://www.penguinrandomhouse.com/books/220154/decisive-by-chip-heath-and-dan-heath/

Defines the **WRAP** process: Widen your options, Reality-test your assumptions, Attain distance
before deciding, Prepare to be wrong. Maps cleanly onto four separate facilitator moves: (W) name
the option that is missing — parallels `design-reviewer.md` item 6; (R) ask what small, cheap
experiment ("ooch") would falsify the assumption rather than debating it; (A) ask what you'd tell a
successor facing this same choice, to strip out present-tense emotion; (P) set a tripwire — a
concrete signal that would mean the decision was wrong, agreed before commitment, not after.

**Stanford Strategic Decision and Risk Management (SDRM), Stanford Center for Professional
Development, built on Ronald A. Howard's decision-analysis discipline.**
https://online.stanford.edu/strategic-decision-and-risk-management · https://sdg.com/

Strategic Decisions Group (Howard's own consultancy, partnered with Stanford) frames **Decision
Quality** as six linked elements — appropriate frame, creative alternatives, meaningful reliable
information, clear values/tradeoffs, sound reasoning, commitment to action — visualized as a chain:
the decision is only as good as its weakest link, and **quality is judged at the moment of decision,
never by the outcome that follows it.** That last clause is the directly usable line: it blocks a
human from re-litigating a design as "wrong" only because the outcome later went badly, when the
actual defect (if any) was in the process at decision time.

## 4. Cognitive bias relevant to technical/design decisions

**Amos Tversky & Daniel Kahneman, "Judgment under Uncertainty: Heuristics and Biases," *Science*
185(4157), 1974, pp. 1124–1131.** Official: https://www.science.org/doi/10.1126/science.185.4157.1124

The original paper defining **representativeness, availability, and anchoring** as the three
heuristics behind systematic judgment error — not a summary of them, the source that names and
tests them. Anchoring is the most design-relevant: an early number or the first option drafted
biases every later estimate toward it, even when the anchor is known to be irrelevant (their own
"spinning wheel" experiment). Checklist-convertible: **ask what number or approach was mentioned
first, and re-derive the estimate independently of it before comparing.**

**Daniel Kahneman, *Thinking, Fast and Slow* (Farrar, Straus and Giroux, 2011).**
https://www.penguinrandomhouse.com/books/89308/thinking-fast-and-slow-by-daniel-kahneman/

Kahneman's own synthesis (System 1 / System 2) of decades of work including the above paper. Most
directly usable here: the **"premortem"** he attributes to Gary Klein and endorses as the single
practical antidote to overconfidence and groupthink in a group that has converged on a plan —
*imagine it is a year later and the decision was a disaster; write down why.* (Independently
verified as a named Red Team technique in area 5, below — the same technique reaches this repo from
two unrelated primary-source lineages, which is itself evidence it is load-bearing rather than
fashionable.)

## 5. Red teaming / structured analytic techniques

**Richards J. Heuer Jr. & Randolph H. Pherson, *Structured Analytic Techniques for Intelligence
Analysis* (CQ Press/SAGE, 3rd ed. 2021)**, and Heuer's earlier **Richards J. Heuer Jr., *Psychology
of Intelligence Analysis* (CIA Center for the Study of Intelligence, 1999)**.
https://www.cia.gov/resources/csi/books-monographs/psychology-of-intelligence-analysis-2 (official,
free full text; also mirrored at https://archive.org/details/PsychologyOfIntelligenceAnalysis)

**University of Foreign Military and Cultural Studies (UFMCS), U.S. Army TRADOC, *Red Team
Handbook*** (multiple public editions; content below verified by direct extraction from the 2011
edition). Mirrors: https://archive.org/details/ufmcs-red-team-handbook-2012 ·
https://newandimproved.com/wp-content/uploads/2014/04/ufmcs_red_team_handbook_apr2011.pdf

The handbook states its own purpose in its own words: *"UFMCS defines Red Teaming as a function to
avoid groupthink, mirror imaging, cultural missteps, and tunnel vision in plans and operations. Red
Teams help identify when staffs make poor assumptions and fail to account for the complexity of the
Operational Environment."* Three techniques it documents in full, each already phrased as a
procedure:

- **Key Assumptions Check** (p.150–151, "Diagnostic Techniques"): a four-step method — (1) write
  down the current analytic line/conclusion so everyone can see it, (2) list every premise, stated
  and unstated, that must hold for it to be valid, (3) challenge each one by asking why it "must" be
  true and whether it holds under all conditions, (4) keep only the assumptions that survive as the
  ones the conclusion actually rests on. This is a repeatable worksheet version of the same move
  `design-reviewer.md` already does informally.
- **Devil's Advocacy** (p.160–161, "Contrarian Techniques"): designate one person (or role) to build
  *the best possible case for an alternative explanation* to a strongly-held consensus view — not to
  poke holes, to construct the strongest opposing case. Most valuable "on issues that one cannot
  afford to get wrong."
- **Premortem Analysis** (p.44, citing Gary Klein, *Sources of Power*, MIT Press 1998): imagine the
  plan was executed, months have passed, and it failed — participants must explain why they think it
  failed, working backward from failure instead of forward from the plan.

Checklist-convertible: run Key Assumptions Check as a literal four-step worksheet (not a single
question), and require the facilitator's critique to read as Devil's Advocacy — the strongest case
*for* the option the human seems inclined against — rather than a list of objections to the option
they favor.

## 6. Steelmanning / adversarial collaboration

**Daniel C. Dennett, *Intuition Pumps and Other Tools for Thinking* (W. W. Norton, 2013)**, crediting
game theorist **Anatol Rapoport** — "Rapoport's Rules." Overview:
https://en.wikipedia.org/wiki/Intuition_pump (background) — primary claim is the book itself; the
four rules as stated by Dennett:

1. Re-express the target's position so clearly and fairly that they would say "thanks, I wish I'd
   put it that way myself."
2. List every point of agreement, especially ones that are not general/widespread.
3. State anything you learned from the position, even if you still disagree.
4. Only then are you permitted to say a single word of rebuttal or criticism.

Directly convertible: a facilitator's critique of a design option must satisfy steps 1–3, written
down, *before* step 4's objection is allowed to appear in the output — a structural gate, not a
tone preference.

**Daniel Kahneman, "Experiences of Collaborative Research" (2003 essay)** —
https://bear.warrington.ufl.edu/brenner/mar7588/Papers/kahneman-collab-essay2003.pdf — Kahneman's
own account of **adversarial collaboration**: two researchers who hold opposing positions agree, in
advance and in writing, on (a) what test or evidence would actually settle the disagreement, (b) a
jointly designed method neither side controls unilaterally, and (c) joint publication of the result
regardless of which side it favors. The design-relevant translation: **the facilitator and the
human's skeptical instinct should agree, before the facilitator's critique is written, on what
evidence would change the facilitator's assessment and what evidence would change the skeptic's** —
otherwise the critique is just restated disagreement, the exact failure mode the human-in-the-loop
redesign was meant to fix.

## What was already covered vs. what got added

`design-reviewer.md`'s one Socratic line ("which assumption, if false, flips this conclusion?")
covered Paul & Elder's *assumption-probing* question and, independently, Heuer's *Key Assumptions
Check* — both now formalized as `prompts/design-facilitator.md` Phase 4's worksheet. Every other
entry above — clarification and viewpoint questions, argument mapping's mapped objection branch,
PrOACT/WRAP/Decision Quality's structural decision checks, anchoring, Devil's Advocacy, premortem,
Rapoport's Rules, and adversarial collaboration's pre-agreed test — was net-new material, and is what
turned one informal question into the full session protocol in Phases 0–5 of that prompt.

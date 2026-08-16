# Representation router

Choose structure first and style second. A visual is justified only if it materially reduces the
reader's effort to reconstruct a relation. Otherwise use prose or a short list.

| Reader need / relation | Default | Threshold | Avoid when |
|---|---|---|---|
| One conclusion, fact, or action | Prose | one idea is sufficient | the visual only restates it |
| Repeated exact mappings | Table | 3+ items share fields | cells become paragraphs |
| Alternatives under shared criteria | Comparison table | 2–5 real options | sequence/context dominates |
| Ordered dependent steps | Flow | 3+ dependencies or branches | numbered steps are obvious |
| Actors/messages over time | Sequence | ordering, async, retry matter | ownership alone matters |
| Components, containment, ownership | Architecture/tree | 3+ relations or nesting | only one edge matters |
| State/event changes | State diagram/timeline | transitions/chronology explain behavior | events are unrelated |
| Input/output transformation | Mapping/data flow | fields or stages repeat | one input maps to one output |
| Risk by two dimensions | Matrix | scales and thresholds are defined | ratings are impressionistic |
| Trend/distribution | Chart | numeric pattern matters | values are sparse/categorical |
| Conditional actions | Decision tree | branches lead to different actions | merely comparing options |
| Interface arrangement | Wireframe | spatial layout drives understanding | discussing behavior only |
| Difficult mechanism | Illustrative diagram | spatial metaphor stays faithful | metaphor may mislead |

Use the smallest useful form. Tables are visuals too; do not escalate to SVG unnecessarily.

When a standalone diagram is selected, invoke an available renderer such as `baoyu-diagram` and
give it the established claim set, relationship type, labels, takeaway, accessibility text, and
output location. The renderer must not infer missing facts.

Every nontrivial visual must have:

- one sentence stating what the reader should notice;
- labels and units sufficient to interpret it;
- a text alternative covering the meaningful relation;
- no duplicated prose that forces the reader to process the same content twice.

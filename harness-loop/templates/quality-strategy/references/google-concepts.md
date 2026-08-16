# Google testing concepts encoded here

- Product engineers own quality; the harness tooling improves testability; independent oracle and
  user-risk roles challenge the result. These are responsibilities, not SET/TE job titles.
- Capability–Attribute risk analysis prioritizes what must be proved. It replaces a static prose
  plan and avoids treating line coverage as evidence of user value.
- Scope and size are orthogonal. Scope names behavior crossed; size names execution constraints.
- Small tests provide fast signal. Larger tests cover fidelity small tests cannot, but need explicit
  ownership, time bounds, isolation, cleanup, and an appropriate CI stage.
- The desired portfolio is risk-sensitive. Never enforce a universal 80/15/5 mix.

Primary-source analysis and links live in `docs/reference/how-google-tests-software-research.md` in
scaffolded targets and `harness-loop/references/how-google-tests-software-research.md` in the skill.

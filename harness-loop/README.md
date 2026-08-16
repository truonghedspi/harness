# harness-loop

Set up a complete agent **harness** (Lessons 1–12) *and* an autonomous maker–checker **loop**
(Lesson 13) on top of any project, targeting Kiro (kiro-cli) — with a machine-checkable guarantee
that all 13 [Learn Harness Engineering](https://github.com/walkinglabs/learn-harness-engineering)
lessons are covered.

Two floors, built in order:

- **Floor 1 — Harness:** make a single agent run reliable (instructions, state, verification,
  scope, lifecycle, observability, clean-state).
- **Floor 2 — Loop:** make continuous runs autonomous (goal + verification + stopping condition,
  maker/checker generator–evaluator split, an automation that fires it).

## Use

```bash
# 1. Scaffold both floors into a target project
node harness-loop/scripts/setup-harness-loop.mjs --target /path/to/project \
  --name "My Project" --purpose "What it does"

# 2. (in the target) fill placeholders, get the baseline green
cd /path/to/project && ./init.sh

# 3. Prove all 13 lessons are covered — must be 13/13
node check-coverage.mjs

# 4. Run the loop (Level 1 first, then climb the ladder)
kiro-cli chat --agent maker      # then --agent checker
loop/run-loop.sh 5               # headless (needs KIRO_API_KEY)
```

**Existing repo?** Don't run the scaffolder at it. Run the onboarder — only its prompt/runtime
entry points and upgrade capability are installed, with no product files touched — and let it
survey first:

```bash
node harness-loop/scripts/install-onboarder.mjs --target /path/to/repo
cd /path/to/repo && kiro-cli chat --agent harness-onboarder
```

Scripts use only Node.js built-ins, so they run after copying the skill into any repo.

## What it creates

`AGENTS.md` (router) · `feature_list.json` · `init.sh` · `progress.md` · `DECISIONS.md` ·
`session-handoff.md` · `docs/{architecture,constraints,testing-standards,definition-of-done}.md` ·
`tools/{trace,collect-services,context-plan,agent-context}.mjs` ·
`loop/{goal,maker-prompt,checker-prompt}.md` + `run-loop.sh` ·
`skills/test-design/` (spec→test-condition discipline) · `skills/feature-planning/` (build/prove
DAG capability, schema, checker and fixtures) ·
`.kiro/agents/{maker,checker,harness-setup,feature-planner,designer,design-reviewer,test-designer,test-implementer}.json`
+ `.kiro/settings/mcp.json` · `check-coverage.mjs`.

## The 13-lesson contract

Each lesson maps to an artifact and a mechanical check. `check-coverage.mjs` verifies every row
and exits non-zero unless all 13 pass — that is how "all 13 covered" becomes provable, not
claimed. Full spec: [references/13-lesson-coverage.md](references/13-lesson-coverage.md).

## Files

```text
harness-loop/
├── SKILL.md
├── README.md
├── references/
│   ├── 13-lesson-coverage.md     the contract check-coverage.mjs implements
│   ├── loop-engineering.md       Lesson 13 in depth (6 primitives, /goal vs /loop, 4 costs)
│   └── runtimes.md               kiro-cli and Claude Code from one manifest
├── scripts/
│   ├── setup-harness-loop.mjs    scaffolder
│   └── check-coverage.mjs        13-lesson coverage auditor
└── templates/tree/               mirror of what gets written into the target project
```

## Boundaries

Harness + loop engineering only — not model selection, prompt tuning alone, or app architecture.
Structural coverage is necessary but not sufficient: a green coverage report on a red `./init.sh`
means the files are in place, not that the project works. Always run the baseline gate too.

# harness

An automated software-engineering harness that helps development teams build maker-checker workflows with verifiable reliability.

## Quick start

### Install the harness in an existing project

```bash
# Set up the harness in a project
node harness-loop/scripts/setup-harness-loop.mjs --target <project-path>

# Check structure (must pass all 13 lessons)
node check-coverage.mjs

# Verify behavior (must report zero blockers)
node harness-loop/scripts/verify-harness.mjs --target <project-path> --run-features
```

### Run the automated workflow

```bash
# Run the maker-checker loop
node <project>/harness/loop/run-loop.mjs

# Monitor progress
node <project>/harness/tools/loop-status.mjs --watch
```

## Main components

### harness-loop/
A complete scaffold covering the 13 lessons from [Learn Harness Engineering](https://github.com/walkinglabs/learn-harness-engineering), with an automated maker-checker loop and self-improvement capability.

**Three main phases:**
- **Create**: `setup-harness-loop.mjs` scaffolds the harness structure
- **Verify**: `check-coverage.mjs` checks structure; `verify-harness.mjs` checks real behavior
- **Improve**: `harness-issue.mjs` + `improve-harness.mjs` track and repair defects automatically

**Highlights:**
- Cross-platform support (Windows, macOS, Linux) through Node.js `.mjs`
- Automatic dispatch through ACP for Kiro
- Real-time progress reporting
- A contained layout in a single `harness/` directory

### test-design.skill
An independent test-design skill pack that creates implementation-independent oracles and test conditions.

### examples/timesten-migration/
A practical TimesTen → Aeron Cluster migration example, including a per-unit pipeline and evidence-based Definition of Done.

## Extend the harness

### Add a new agent
1. Edit `agents.manifest.json` to define the agent
2. Create a prompt in `harness/prompts/`
3. Update routing rules in `harness/loop/route.mjs`
4. Run `node tools/gen-agents.mjs` to generate runtime configuration

### Customize the workflow
- **Routing**: Edit `harness/loop/route.mjs` for custom routing logic
- **New gate**: Add verification to `harness/init.mjs`
- **Capabilities**: Add a skill pack to `harness-loop/capabilities/`

### Kubernetes integration
The harness automatically detects `Chart.yaml` and installs cluster tooling:
- Namespace-per-run isolation
- Automated Helm deploy/test/teardown
- Dedicated `k8s-integration-tester` agent

### Upgrade an existing harness
```bash
# Upgrade an existing harness with an ownership-aware merge
node harness-loop/scripts/upgrade-harness.mjs --target <project>
```

## Architecture

### Maker-checker loop
- **Maker**: Implements features and records honest evidence
- **Checker**: Performs final evaluation and has exclusive authority to set `status: done`
- **Router**: Directs workflow from state and dependencies

### Role separation
- Makers cannot mark themselves `done`
- The checker runs only after every feature is handed off
- The typed admission seam prevents incomplete submissions

### Tracing
- The decision path is recorded in `trace/trace.jsonl`
- Trace files do not store file contents

## Working in this repo

Read [`AGENTS.md`](AGENTS.md) — the main router for where things live, rules to follow (fix the template rather than the target; every behavioral change needs a `demo.sh` step), and how to verify changes.

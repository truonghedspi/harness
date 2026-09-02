# Workflow diagrams — the map

Visual companions to `SKILL.md`. Nothing in these files is new information: each diagram is a
picture of a process already described in prose elsewhere in this skill. Read the linked section
for the reasoning; use the diagram to get oriented fast, or to hand to someone who has not read the
prose yet.

Three workflows, split because they have three different readers and three different moments:

| Workflow | Covers | Read it when |
|---|---|---|
| [workflow-onboarding.md](workflow-onboarding.md) | Floor 1: a requirement or an existing repo → a green harness. Adoption, scaffolding, the human interview, multi-service init, the gates | you are standing a harness up, or adopting one into a repo that already has history |
| [workflow-development.md](workflow-development.md) | Floor 2: a green harness → DONE. Design, decomposition, oracle, implementation, the per-iteration sequence, the K8s specialization | you are running the loop, or trying to work out why the router picked what it picked |
| [workflow-improvement.md](workflow-improvement.md) | The loop that repairs the **skill**: three signal producers, completed-feature telemetry proposals gated by a human, one ranked backlog, and a closing rule nothing can fake | a gate, a trace or a person says the harness itself is wrong |

The compact roster view is available as [five-agent-workflow.svg](diagram/five-agent-workflow.svg)
(with a PNG preview beside it). For the dispatch path and durable handoff contracts, read
[agent-interaction-contracts.svg](diagram/agent-interaction-contracts.svg) (also with a PNG preview).
They complement, rather than replace, the phase-level Mermaid diagrams below.

## Keeping these current — single source of truth

Workflow Markdown (`workflow-*.md`) **không được sửa tay**. Chúng được sinh từ
[workflow-model.json](workflow-model.json) — nguồn sự thật duy nhất khai báo node, edge, layer
và contract. Quy trình:

```
workflow-model.json   ←── sửa ở đây
        ↓
node scripts/generate-workflows.mjs     ←── sinh workflow-*.md
        ↓
node scripts/check-workflow-diagram.mjs ←── kiểm tra (CI gate)
```

`check-workflow-diagram.mjs` kiểm tra hai lớp:
1. **Generated check**: workflow-*.md khớp output của generator (bắt drift).
2. **Model check**: model chứa mọi agent (từ `agents.manifest.json`), mọi node và layer
   (từ `route.mjs --rules`), và mọi edge tham chiếu node/layer hợp lệ.

Thay đổi routing hoặc contract → sửa `workflow-model.json` → chạy generator → cả runtime,
Mermaid và bảng contract cùng đổi. Không còn "diagram đúng tên nhưng sai luồng".

`verify-harness.mjs` chạy checker như gate `workflow-diagram`, nên CI tự động phát hiện drift.

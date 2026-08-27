# Testing Standards — JDT MCP Server

Only a full pipeline run counts as real verification (Lesson 10). Unit tests are systematically
blind to defects that only appear across boundaries — interface mismatch, state propagation,
resource lifecycle, environment dependency, and — in a microservice system — the *contracts
between services*. Verification is a **three-level hierarchy**, and any change that crosses a
service boundary requires all three.

## Framework

**Node's built-in `node:test` + `node:assert/strict`, running TypeScript source directly via
`node --experimental-strip-types`.** Zero new runtime test dependencies — matches the
minimal-dependency posture this design already commits to (`@modelcontextprotocol/sdk`,
`vscode-jsonrpc`, `vscode-languageserver-protocol` are the only committed libraries;
`docs/design/evidence.md` spike E). `typescript` + `@types/node` are devDependencies for editor
support; no separate build/transpile step runs the tests — Node strips types syntactically and
executes the source as-is (Node ≥22.6.0 required for the flag; this project targets ≥22.6.0, see
`package.json#engines`).

**Import specifiers between local TS files must use the real `.ts` extension**
(`import { x } from "../../src/foo.ts"`), not `.js`. Node's ESM loader resolves the literal
specifier; type-stripping does not remap extensions, so `.js` specifiers fail to resolve at
runtime even though `tsc` would accept them.

**Any file whose path contains a directory literally named `test/` is treated as a test file by
Node's default discovery glob** (`**/test/**/*.ts`, no exclusion for helpers/fixtures) — a plain
module dropped in `test/**/` with no `test()` calls still "runs" and trivially passes, which can
mask a broken import. Keep shared test-only fixtures/helpers either inline in the spec file
that uses them, or under a path with no `test/` segment (e.g. `test-support/`) if they're ever
shared across spec files.

## Level 1 — Unit

- Scope: a single function/module in isolation.
- Command: `npm test` (once unit-level test files exist — not wired yet; see note below)
- Blind to: anything that only appears when components are wired together.

## Level 2 — In-Service Integration

- Scope: two or more components inside a single service, across their real internal boundary
  (DB, cache, internal modules).
- Command: `npm test` (co-located with Level 1 under `test/unit/` and `test/component/`; not
  wired yet — see note below)
- Catches: interface mismatches, serialization, state that doesn't propagate within a service.

## Level 3 — Microservice Integration (cross-service / contract)

This project has no separate deployed microservices to contract-test against (shim ↔ daemon ↔
JDT LS are processes on one machine, not independently deployed services) — the cross-**process**
analogue that matters here is spawning a real JDT LS and exercising it exactly as the daemon
would.

- Scope: shim ↔ daemon ↔ a real (or realistically stubbed, e.g. a fake `java` binary answering
  `-version`) JDT LS process, exercised the way they actually call each other — stdio/socket
  framing, process spawn, real filesystem cache state, real JVM version detection.
- Command: `npm run test:integration` (all of `test/integration/`), or
  `npm run test:integration -- <path>` for one file — both forward straight to
  `node --experimental-strip-types --test [path]`.
- Required for: any change that touches a process boundary — provisioning, spawning JDT LS,
  daemon/shim IPC, file-sync round-trips. Never skip it to save time; a passing per-module suite
  on a broken process boundary is the classic false green (`docs/architecture.md`'s three of four
  premortem causes live exactly here).

**Not wired yet:** no unit-level (`npm test`) plan/tests exist as of this pass — only
`test/integration/jdtls-provisioner.integration.spec.ts` (TP-PROV-0001, `feat-prove-provisioner`)
has been written. `npm test` is deliberately left undefined in `package.json` rather than pointed
at empty directories: `init.mjs`'s baseline gate runs every present `test`/`typecheck`/`build`
script and requires exit 0, and a red-first oracle for a not-yet-implemented feature must not
trip that gate before the feature's own maker/checker cycle closes it. Wire `npm test` (and a
`typecheck` script, `tsc --noEmit`) once the first Level 1/2 test-design plan exists — do not add
either preemptively, for the same reason.

### Công cụ hệ thống mà bộ tích hợp phụ thuộc

`test/integration/daemon-lifecycle.integration.spec.ts` là tệp duy nhất gọi công cụ ngoài Node:
`lsof -t <socket>` (TCON-SHIM-0002, đếm daemon đang giữ đường dẫn socket) và `ps -o pid= -p <pids>`
(TCON-SHIM-0003, tìm process con mồ côi sau shutdown). Máy phát triển macOS có sẵn cả hai
(`/usr/sbin/lsof`, `/bin/ps`). Image Linux tối giản thì không: debian-slim và alpine đều thiếu
`lsof`, còn `ps` của busybox không nhận tổ hợp `-o pid= -p`.

Thiếu công cụ luôn cho kết quả ĐỎ, không bao giờ xanh giả — checker đã đo bằng cách chạy lại oracle
với PATH cắt bớt, ghi tại `harness/DECISIONS.md` ngày 2026-08-23. Hai hàm trợ giúp nuốt lỗi của
`execFileSync` thành chuỗi rỗng, nên khẳng định phía sau vỡ và in ra `lsof trả về []`. Đó là dấu
hiệu thiếu công cụ, không phải dấu hiệu vỡ invariant.

Trước khi chạy `npm run test:integration` trên Linux, cài `lsof` và `procps`
(`apt-get install -y lsof procps`). Khi dự án thêm job CI trên Linux, bước cài này thuộc về chính
job đó. Cổng baseline không bị ảnh hưởng: `npm test` và `npm run test:baseline` không nạp tệp này.

Không thay `ps` bằng `process.kill(pid, 0)` trong tệp trên. Tiến trình đã chết nhưng chưa được reap
vẫn hiện trong bảng tiến trình, nên `ps` chặt hơn đúng ở trường hợp INV-SHIM-4 quan tâm.

## Level 4 — Distributed Business Journey

- Scope: a business command through all participating services until public events and query
  projections converge, including retry/fault behavior for critical flows.
- Contract: `business-environment.json` plus `business-oracles/*.json`, validated by
  `harness/skills/business-journey/scripts/check-business-journey.mjs`.
- Execution: `harness/tools/k8s-test-env.sh --services services.manifest.json -- <journey command>`.
- Boundary: public input and observation only. SQL/repositories/pods are diagnostics, not passing
  assertions. Cucumber is optional when stakeholders need executable Given/When/Then.
- Required for: a business outcome spanning three or more independently deployed services, or one
  whose correctness depends on distributed convergence/idempotent recovery.

## Rule

A feature's `verification` in `harness/feature_list.json` must exercise the highest level its change
touches. "Unit tests pass" is not "done" for cross-service work — the contract must be verified.
When a review comment recurs, promote it into an automated check here (Review Feedback
Promotion) so the harness self-strengthens. Prefer consumer-driven contract tests where you can,
so a producer change that breaks a consumer fails fast in the pipeline.

## Scope is not execution size

Levels 1–4 above describe **scope/fidelity**. Separately classify resource constraints in
`test-risk.json`: `small` has no network/shared state and is hermetic; `medium` may use localhost
on one machine; `large` covers cluster/external execution and therefore requires an owner, bounded
timeout, non-shared isolation, cleanup evidence and postsubmit/staging placement. A fast cluster
journey is still large. Use risk to choose the smallest test that answers the claim; do not enforce
a fixed pyramid ratio or use coverage percentage as a quality target.

Run `node harness/skills/quality-strategy/scripts/check-quality-strategy.mjs` for risk-to-oracle
traceability and scope/size safety.

## Where a verification lives

**Proof belongs inside one of the three levels above, run by this project's test framework.**

The `verification` field demands a runnable command and says nothing about where that command may
live, so the cheapest way to satisfy it is a one-off script — `node -e "..."`, or a `check-thing.mjs`
dropped at the repo root. That passes every gate and is not a test: no test run executes it again,
no one maintains it, and it is invisible to coverage. The harness itself models the bad habit —
most of its own machinery is `.mjs` — so it is worth saying out loud that *harness tooling* and
*proof of a feature* are different things.

**A one-off verification script is a smell that a level is missing.** If the claim is about one
unit, it is a Level 1 test. If it crosses a service boundary, it is Level 3. If it genuinely is
project machinery rather than proof — an environment check, a generator — commit it under `harness/tools/`
and index it, so it is maintained rather than abandoned.

`verify-harness.mjs` reports `verification-outside-test-framework` for the three shapes with no
home: an inline `node -e`, a script that is not committed, and a script living outside `harness/tools/`.

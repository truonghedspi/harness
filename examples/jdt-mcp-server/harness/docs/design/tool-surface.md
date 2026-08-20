# Design — the MCP tool surface

The public API of the product. For an OSS tool the tool names, argument shapes and result shapes
*are* the interface a stranger meets, so they are designed here rather than emerging from whichever
feature is built first. Facts cited in `harness/docs/design/evidence.md`.

## The eight tools

All seven v1 capabilities, plus one that the measured cold-start numbers make mandatory.

| Tool | Arguments | Returns |
|---|---|---|
| `java_diagnostics` | `path` (file **or** project root) | current problems for that file or every file in the project, from the cache |
| `java_hover` | `path`, `line`, `column` | resolved signature + javadoc, **and the `range` of the token the answer resolved to** |
| `java_completion` | `path`, `line`, `column` | completion items, capped |
| `java_definition` | `path`, `line`, `column` | declaration locations |
| `java_references` | `path`, `line`, `column`, `includeDeclaration?` | reference locations, capped |
| `java_rename` | `path`, `line`, `column`, `newName`, `apply?` | the proposed edit, per file, as data |
| `java_code_actions` | `path`, `startLine`, `startColumn`, `endLine?`, `endColumn?`, `kinds?` | available actions, each with an opaque `actionId` |
| `java_apply_code_action` | `actionId`, `apply?` | the resolved edit for that action, as data |
| `java_workspace_status` | `path?` | per-workspace readiness, progress, pid, memory, last sync |

`java_workspace_status` is not optional garnish. Warm-up ranged from 1.5 s to a reported 25 minutes;
without a tool that says "still indexing, 40%", an agent cannot distinguish *not ready yet* from
*there is nothing there*, and will act on the second reading. It is the same failure `INV-READY-1`
forbids in the other tools, exposed as a first-class question the agent can ask.

## Code actions are two-phase, and that is a measured constraint

Spike D: JDT LS returns code actions with `edit: undefined`, `command: undefined` and an opaque
`data` blob; a second `codeAction/resolve` produces the edit. Titles observed on a trivial file
included *Organize imports*, *Add @SuppressWarnings 'unused' to 'Unused'*, *Generate toString()*,
*Change modifiers to final where possible*.

So `java_code_actions` returns handles and `java_apply_code_action` resolves one. The daemon holds
the `data` blob — it is JDT LS-internal and there is no value in round-tripping it through an LLM's
context window. That makes the handle **stateful**, which makes it a staleness hazard: a handle
minted before an edit and resolved after it would apply an edit computed against source that no
longer exists.

## Result shaping — the rules that keep answers usable

**Positions.** LSP positions are 0-based and counted in UTF-16 code units. Every other thing an LLM
reads about source — compiler errors, `grep -n`, stack traces — is 1-based. Converting at exactly
one boundary, once, is the whole of `INV-TOOL-1`; the choice of *which* base is a cross-cutting
decision (`harness/docs/cross-cutting.md` X-007) with a recommendation attached.

**Hover's position is minted here, not by JDT LS.** JDT LS's hover response never carries a `range`:
`HoverHandler.hover()` constructs `new Hover()`, calls `setContents(...)` and returns — there is no
`setRange` on the path, and `JDTLanguageServer.hover()` does not post-process it
(`evidence.md`). Raw LSP permits that; `Hover.range` is optional. The tool table above previously
named no position for `java_hover` at all, which made `INV-TOOL-1` — *"every position in every tool
result"* — **vacuously** true for hover: with no position in the result, nothing hover did could ever
falsify it, and `feat-prove-navigation-tools`' sweep had its hole at exactly the tool where a
coordinate bug is hardest to see. A mis-aimed `java_definition` points at a visibly wrong symbol; a
mis-aimed `java_hover` returns a perfectly plausible signature for the token next door.

So `java_hover` **always** returns a `range` on success, in X-007 coordinates, locating the source
token the hover resolved to. The daemon computes it from the file content it already holds for
`INV-TOOL-5`'s bounds check; JDT LS's absent `Hover.range` is never propagated as an absent field.
Optionality is the thing that would make the claim uncheckable, so there is none: a position with no
resolvable element is not a hover with the field missing, it is `INV-TOOL-4`'s explicit no-result.
Requiring that is safe because JDT LS only produces hover content when `findElementsAtSelection`
resolved at least one element (`HoverInfoProvider.java:104-107`) — content implies a real token to
point at.

*Rejected: echoing the request position back.* It is the obvious cheap answer and it is worthless as
a falsifier. A converter that mistakes UTF-16 code units for codepoints is **self-inverse**, so
`fromLsp(toLsp(p)) == p` holds exactly, the echoed field equals the caller's input by construction,
and the astral-plane fixture passes green while the tool hovers the wrong token. A resolved-token
range cannot cancel that way: a mis-converted position lands on a *different* token, so the reported
range disagrees with the intended token's real byte offsets and the check fires.

**Size.** `java_references` on a common method and `java_completion` in a large scope can both
return result sets that swamp a context window. Every list result is capped and, when capped, says
so with the true total — a silently truncated list is a wrong answer that looks complete.

**Mutation.** `java_rename` on a two-file fixture already produced a WorkspaceEdit touching two
files. Whether the daemon writes those files is a risk-appetite question, not a technical one; it is
A-002 in `harness/docs/assumptions.md`, with the recommendation to return edits as data by default
and require an explicit per-call `apply: true`.

## Invariants

| Id | Component | Invariant — must hold for EVERY input | Observable seam |
|---|---|---|---|
| `INV-TOOL-1` | `mcp-tool-layer` | Every position in every tool result — whichever LSP method produced it — is in one documented coordinate system, converted at a single boundary; no result ever mixes bases | positions in results cross-checked against the file's real byte offsets, over a fixture containing non-ASCII and astral-plane characters |
| `INV-TOOL-2` | `mcp-tool-layer` | No tool writes to disk unless that call carried an explicit opt-in; the default result of a mutating tool is the proposed edit as data | file mtimes across a full tool sweep with no opt-in |
| `INV-TOOL-3` | `mcp-tool-layer` | Any list result exceeding the configured cap is always returned truncated **with** `truncated: true` and the true total — never silently cut, never returned uncapped | a fixture with more references than the cap |
| `INV-TOOL-4` | `mcp-tool-layer` | Every failure — unroutable path, not ready, resyncing, workspace crashed, cap exceeded — is reported as a structured error naming which of those it is; no failure is ever encoded as an empty successful result | the error taxonomy exercised one case per branch |
| `INV-TOOL-5` | `mcp-tool-layer` | Argument validation rejects an out-of-range `line`/`column` for the file's current content before any LSP call is made | oversized coordinates against a known fixture |
| `INV-TOOL-6` | `mcp-tool-layer` | Every successful `java_hover` result always carries a `range` locating the source token the hover resolved to, in the same coordinate system as every other position; a position with no resolvable element is always `INV-TOOL-4`'s explicit no-result, never a success with `range` omitted — the field is never optional, and JDT LS's own omitted `Hover.range` is never propagated as an omission | hover on the non-ASCII/astral-plane fixture with the returned `range` cross-checked against the intended token's real byte offsets, **plus** a hover on a position holding no element, asserting the structured no-result rather than a success |
| `INV-CA-1` | `mcp-tool-layer` | An `actionId` is only ever resolvable against the same workspace sync generation that produced it; if any file in the workspace changed since, resolving always fails rather than returning a stale edit | mint a handle, edit the file, resolve — must error |
| `INV-CA-2` | `mcp-tool-layer` | Every `actionId` handed out is either resolvable or expired-with-an-error; a handle never resolves to an edit belonging to a different action | handle table under interleaved calls across two workspaces |
| `INV-DIAG-1` | `diagnostics-cache` | `java_diagnostics` always returns the most recent `publishDiagnostics` payload for the requested URI, or an explicit "not reported yet" marker — an empty list never stands in for "not computed" | query before and after the first publish for a file |
| `INV-DIAG-2` | `diagnostics-cache` | A later `publishDiagnostics` for a URI always fully replaces the earlier one; problems are never accumulated across publishes | publish a diagnostic then publish an empty list; assert the cache is empty |
| `INV-DIAG-3` | `diagnostics-cache` | Diagnostics are always attributed to the workspace whose instance published them; a URI is never served from another workspace's cache | spike-B fixture: two workspaces, same relative path |

`INV-TOOL-6` is **additive** rather than a rewrite of `INV-TOOL-1`: `feat-prove-navigation-tools`
already derived a falsifier from `INV-TOOL-1`'s exact wording, and editing that wording would
silently change what an already-derived contract means. `INV-TOOL-1` keeps its scope — the coordinate
system and the single conversion boundary — and `INV-TOOL-6` supplies the thing hover was missing:
a position for `INV-TOOL-1` to range over.

`INV-DIAG-2` exists because the LSP publish model is replace-not-append, and an accumulating cache
would report problems the compiler already considers fixed — the mirror image of the spike C failure.

## Build order and where the risk is

The human asked for sequencing implications of taking all seven capabilities in v1. Ordered by risk
retired per unit of work, not by user visibility:

1. `jdtls-provisioner`, `lsp-client`, `workspace-pool`, `project-router` — nothing works until a
   process can be started, addressed and killed. `INV-ROUTE-1` is cheapest to get right first and
   very expensive to retrofit, because every tool inherits it.
2. `file-sync-watcher` + `readiness-gate` — **before** any capability tool. Spike C says a tool
   built before the watcher is a tool that returns confidently wrong answers, and no amount of tool
   testing catches it: the wrong answer is well-formed.
3. `java_definition`, `java_references`, `java_hover` — one shared shape, three thin tools; they
   also give the readiness probe something real to assert.
4. `java_diagnostics` — different shape (push cache, not request), so it exercises `INV-DIAG-*`.
5. `java_completion` — high volume, exercises `INV-TOOL-3`.
6. `java_rename` — first mutating tool; forces A-002 to be answered.
7. `java_code_actions` + `java_apply_code_action` — **the riskiest item in v1**, and the reason to
   put it last: it is the only tool with server-side state (`INV-CA-1`), a two-phase protocol, and
   the widest surface of JDT LS behaviour. If v1 has to slip anything, slipping this costs the
   least, because every other tool is already shippable without it.

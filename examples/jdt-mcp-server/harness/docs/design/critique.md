# Critique — structured self-attack on the leading design

Technique and sources: `harness/docs/reference/critique-technique-sources.md`. The steelman section
comes **first** deliberately: the protocol's rule is that no objection of mine may appear in the
output before the fair restatement exists, and Key Assumptions Check and premortem are both made of
objections. Facts cited in `harness/docs/design/evidence.md`.

**Leading option under attack:** Option A — Node/TypeScript daemon, thin stdio shim over a Unix
domain socket, one JDT LS subprocess per Maven reactor root.

## 0. Steelman gate

**Fair restatement.** The requirement contains a contradiction nobody put there on purpose: MCP's
stdio binding makes a server per-client-and-per-launch, while the concurrency constraint demands one
long-lived process holding index state for many projects. Option A resolves it at the cheapest
possible point — the edge — by keeping the thing the client launches trivial and stateless, and
putting all state behind a socket the MCP specification explicitly tells you to frame the same way.
Everything expensive (a 51 MB distribution, a JVM, 434–952 MB of index per project, a warm-up that
can run to minutes) is paid once per user rather than once per session, and the user's install
instruction stays the single line every MCP client already knows how to consume.

**Genuine agreements.** The daemon requirement is right, not an over-engineered preference: with
measured per-instance memory that high and warm-up that unpredictable, respawning per session would
make the tool feel broken on exactly the large repositories where it is most valuable. The full
seven-capability v1 scope is also defensible in a way I did not expect when I first recommended
against it — no prior art covers it, and the four navigation tools share so much shape that the
marginal cost of the fifth and sixth is small. The real cost concentrates in one tool, not seven.

**What I learned, including where I was wrong.** I began this session assuming the interesting axis
was Node versus Java. It is not, and the evidence is unambiguous: JDT LS is an Equinox product and
*both* Java prior-art projects still run it as a subprocess, so the Java route buys typed bindings,
not co-location — and a Node route still needs a JVM ≥ 21 on the machine anyway. I also assumed the
riskiest part of this project was cold-start latency. It is not. It is staleness: spike C shows the
**default** behaviour of a correct-looking implementation is to answer confidently and wrongly after
an on-disk edit. That reordered the build order in `tool-surface.md` and promoted a file watcher from
polish to a v1 blocker.

Only now do the objections start.

## 1. Key Assumptions Check

**Conclusion, written out so it can be attacked:** *build the MCP server in Node/TypeScript as a
shared daemon, reached through a thin stdio shim over a Unix domain socket, with one JDT LS
subprocess per Maven reactor root.*

| # | Premise it needs | Challenge | Verdict |
|---|---|---|---|
| P1 | MCP stdio is per-client-launch, so a shared daemon needs a second channel | quoted from the binding: *"the client launches the MCP server as a subprocess"* | **survives** |
| P2 | Framing stdio-style over a Unix socket is legitimate | the spec says custom byte-stream transports *SHOULD* reuse stdio framing; and this channel is internal anyway | **survives** |
| P3 | An MCP client tolerates a server process that exits while the daemon lives on | the client only ever sees a well-behaved stdio child; shutdown semantics are satisfied by the shim exiting | **survives**, but untested against real clients |
| P4 | **The daemon's value is that warm-up amortises across sessions** | measured gap on a *trivial* project was 1.5 s warm vs 2.3 s cold — nearly nothing. The whole economic case rests on that gap widening enormously on real repositories, which I did **not** measure | **weakest surviving premise** — see A-012 |
| P5 | One instance per reactor root beats one instance with many workspace folders | supported only by upstream issue 1303 (*"only one of them will work"*), which I did not reproduce | **survives on borrowed evidence** |
| P6 | Not having LSP4J is cheap in Node | `vscode-jsonrpc@9.0.1` + `vscode-languageserver-protocol@3.18.2` cover every method needed, none missing | **survives** — and this is the premise that changed most during the session |
| P7 | A JVM ≥ 21 will be present | nothing guarantees it | **fails as an assumption** — demoted to a checked precondition, `INV-PROV-1` |
| P8 | Concurrent workspaces share no mutable global state | true for `-data` (spike B proved isolation) but **false in general**: every instance resolves Maven artifacts into the same `~/.m2` local repository | **fails** — new assumption A-013 |
| P9 | Results fit an agent's context | `java_references` on a common method does not | **fails** — forced `INV-TOOL-3` |
| P10 | A file watcher can observe every relevant change | agent tooling routinely writes temp-then-rename, and recursive watches on large trees have platform limits | **fails as stated** — new assumption A-014 |

**What actually carries the conclusion after this:** P1, P2, P6, and P5 on borrowed evidence. P4 —
the economic reason the daemon exists at all — is the one a single measurement could overturn, and
it is the premise I would spend the next hour on.

## 2. Premortem

It is 2027. The tool shipped with all seven capabilities and quietly failed. Working backward:

1. **It told people the wrong thing.** Someone built a capability tool before the watcher, or the
   watcher missed rename-over-write. Answers were well-formed and stale, so no test caught it and no
   user filed a reproducible bug — they just stopped trusting it. Spike C says this is the *default*
   behaviour, not a corner case. Highest-probability cause of death.
2. **It ate the laptop.** A user with five repositories open got five JVMs. Eviction only ran on
   idle workspaces and all five were active, so the cap never bit. They killed the daemon and never
   restarted it.
3. **It failed on first run.** Java 17, or no Java, or a corporate proxy blocking the 51 MB
   download, produced an opaque stack trace. The issue tracker filled with "doesn't work" and the
   project's reputation was set in its first week.
4. **The first impression was a timeout.** On a real monorepo the first three tool calls hit a
   twenty-minute index. Without `java_workspace_status` returning honest progress, the agent
   reported the tool as broken — and it was the agent's report the user read.
5. **Orphaned JVMs.** A daemon crash left JDT LS children running; users found gigabytes of stray
   `java` processes after closing their editor. `INV-SHIM-4` exists because of this scenario.
6. **Code actions became a flakiness generator.** Handles minted in one agent session were resolved
   after another session's edits, so `INV-CA-1` fired constantly and looked like a bug rather than a
   guard rail.
7. **The protocol moved.** Revision 2026-07-28 already removed sessions and the GET stream; the TS
   SDK is still on 2025-11-25. When it catches up, the bespoke shim gets reworked at the worst time.
8. **The pin rotted.** JDT LS was pinned for reproducibility; a year later users were on a JDK the
   pinned build could not index, and the pin itself became the top bug.

## 3. Devil's Advocacy — the strongest case for Option B

Built for the option I am **not** recommending, as strongly as I can make it.

**The hard part of this product is being a correct LSP client, not an MCP server.** JDT LS is a
stateful, chatty, extension-carrying server: readiness signalling that lies (`ProjectStatus` and
`ServiceReady` fire before the workspace refresh finishes), server-initiated
`workspace/configuration` requests that block startup if unanswered, unresolved code actions needing
a second round-trip, watched-file semantics you must implement or get silent staleness, and four
non-standard `language/*` and `java/*` extensions. LSP4J is maintained by the same foundation as JDT
LS and is the library JDT LS is built against; protocol drift is absorbed upstream. Option A owns
all of that itself.

**Prior art already validates B and nothing validates A.** `stephanj/LSP4J-MCP` runs this exact
stack today. Option A asks you to be first on the Node path *and* first on the shim topology *and*
first on the full seven-capability scope — three novelties at once, on a project whose scope is
already the widest of anything found.

**The SDK maturity argument runs the other way from how Option A tells it.** MCP Java SDK 2.0.1 is
current; the TypeScript SDK is a protocol revision behind the specification quoted throughout this
design. "The TS SDK ships both transports" is worth less when what it ships implements an older
revision.

**And the memory numbers are B's best argument, not A's.** 1766 MB for two instances on two-file
projects, with real repositories wanting 1–16 GB each, means a 16 GB laptop with three repositories
open is already in trouble. An HTTP daemon can run *somewhere else* — a bigger machine, a container,
a dev server — and Option A's Unix socket cannot, by construction. The first-run friction objection
against B is real but it is a one-line install step; the memory ceiling is physics.

**Does the case hold up?** Partly, and that is itself evidence. The LSP-client-maturity argument was
B's strongest and it weakened during the session: `vscode-languageserver-protocol@3.18.2` supplies
typed request objects for every method needed with none missing, so the "hand-rolled client" framing
is not accurate. The prior-art argument is weaker than it sounds too — `stephanj/LSP4J-MCP` validates
five navigation tools and a *single* instance, not the concurrency model that is the actual hard
part here. What genuinely survives is the **remote-daemon** argument, and it survives well enough to
change the recommendation rather than be dismissed by it.

## 4. Recommendation

**Recommend Option A, amended by the one Devil's Advocacy argument that survived.**

**Why**, traceable to the work above: the premises that carry Option A after the Key Assumptions
Check — P1, P2, P6 — are the three the session actually strengthened with evidence, while the
premises it *removed* (P7, P8, P9, P10) all became invariants or registered assumptions rather than
reasons to switch options. Nothing in the premortem's eight causes of death is specific to Option A;
seven of the eight (staleness, memory, first-run, warm-up, orphans, handle staleness, pin rot) land
identically on B and C, which means the transport axis is not where this project's risk lives. And
Devil's Advocacy's headline argument — that Node forces a hand-rolled LSP client — turned out to be
false against a verified fact. What remains is a decision dominated by first-run friction, and Option
A is the only one of the three that satisfies the daemon constraint without asking a stranger to
start a daemon before their agent works.

**Amendment: ship the Streamable HTTP front door in v1, behind a flag, not in v1.1.** The
remote-daemon argument is the one thing Devil's Advocacy established that Option A cannot answer, and
the memory measurements make it more than theoretical. The TS SDK already ships
`StreamableHTTPServerTransport`, so the marginal cost is small if it is designed in from the start
and large if retrofitted. The `Origin`-validation and localhost-binding MUSTs come with it.

**On sequencing, since the full-parity v1 scope is settled:** build the watcher and the readiness
gate *before* any capability tool, and build code actions last — the ordering and its reasoning are
in `tool-surface.md` §Build order. Code actions are the riskiest v1 item: the only tool with
server-side state, a two-phase protocol, and the widest JDT LS surface. If anything in v1 slips, it
should be that, because every other tool ships without it.

### Strongest argument against my own recommendation

Option A concentrates its bespoke, unproven work — a two-process topology, a single-instance lock,
reconnect semantics, and a Windows named-pipe variant nobody has written yet — in the *transport*,
which is the part of this system that delivers no user value whatsoever. Option C gets the same
daemon, the same pool, the same seven tools, and none of that code, at the price of one line in a
README telling the user to start a daemon. If it turns out that MCP clients in the wild handle HTTP
servers well and that the audience is comfortable running a background service, then Option A will
have spent its entire novelty budget on a convenience, and spent it in the one place where a bug
looks like "the tool randomly stops working" rather than "the tool gave a wrong answer".

### What would change my recommendation

- **A measurement on a real repository (200k+ LOC) showing warm restart saves less than ~10% over
  cold.** That kills premise P4, the daemon's whole economic case, and points at a much simpler
  per-session stdio server — a fourth option I would then have to design.
- **Evidence that the target audience runs daemon-hostile environments** (devcontainers, remote dev,
  multi-user boxes) — moves me to Option C or B, because the Unix socket stops being an advantage.
- **A real MCP client mishandling a stdio server that exits while its daemon lives** — invalidates
  P3 and takes Option A off the table outright.
- **A spike showing `vscode-languageserver-protocol` cannot cleanly express JDT LS's `language/*`
  and `java/*` extensions**, restoring Devil's Advocacy's strongest argument and moving me to B.

**What evidence would change yours?** If the answer is "a working prototype", say so — that is a
prototype-settles-a-preference question (`harness/docs/reference/design-engineering.md`), and it is
cheaper to build the shim against a stub daemon than to keep arguing about it.

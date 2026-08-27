// Level 1 oracle for feat-readiness-gate.
//
// Falsifier under test: "the gate opens as soon as ServiceReady or ProjectStatus:OK fires, without
// ever running the semantic probe [INV-READY-2]".
//
// Why that falsifier is not paranoia: spike A measured ProjectStatus:OK at 2293 ms and ServiceReady
// at 2306 ms — 13 ms apart and BEFORE the final workspace-refresh progress notes, which still read
// `100% ... Refreshing '/spike-a/src/test/java'` (docs/design/evidence.md). Both signals are lies
// about readiness taken alone. Every case below therefore fires both signals, loudly, and then
// checks what the gate did with them.
//
// The default probe is exercised for real in every case: only `client.request` is faked, so a
// mutation inside `probeSemanticIndex` is caught here rather than mocked over.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  WORKSPACE_SYMBOL,
  WorkspaceNotReadyError,
  createReadinessGate,
  probeSemanticIndex,
  type LspRequester,
} from "../../src/workspace/readiness-gate.ts";

/** A two-file Maven-shaped project; `Greeter` is the symbol the probe is expected to discover. */
function makeProject(t: { after(fn: () => void): void }): { root: string; greeterPath: string } {
  const root = mkdtempSync(path.join(tmpdir(), "jdt-ready-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const sourceDir = path.join(root, "src", "main", "java", "spike");
  mkdirSync(sourceDir, { recursive: true });
  writeFileSync(path.join(root, "pom.xml"), "<project><artifactId>spike</artifactId></project>");
  const greeterPath = path.join(sourceDir, "Greeter.java");
  writeFileSync(greeterPath, "package spike;\npublic class Greeter {\n  String greet(String n){return n;}\n}\n");
  return { root, greeterPath };
}

interface FakeClient extends LspRequester {
  calls: Array<{ method: string; params: unknown }>;
}

/** `answer` decides what workspace/symbol returns on the Nth probe — the index warming up, or not. */
function makeClient(answer: (attempt: number) => unknown | Promise<unknown>): FakeClient {
  const calls: Array<{ method: string; params: unknown }> = [];
  return {
    calls,
    request(method: string, params?: unknown): Promise<unknown> {
      calls.push({ method, params });
      return Promise.resolve(answer(calls.length));
    },
  };
}

function symbolHit(filePath: string, name = "Greeter"): unknown[] {
  return [{ name, kind: 5, location: { uri: pathToFileURL(filePath).href, range: {} } }];
}

/** Both lies, in the order and spacing spike A measured. */
function fireBothReadinessLies(gate: { noteStatus(id: string, note: { type: string; message?: string }): void }, id: string): void {
  gate.noteStatus(id, { type: "ProjectStatus", message: "OK" });
  gate.noteStatus(id, { type: "ServiceReady" });
}

test(
  "INV-READY-2: ServiceReady + ProjectStatus:OK do not open the gate while the probe answers empty",
  { timeout: 10_000 },
  async (t) => {
    const project = makeProject(t);
    // The index is not usable yet: workspace/symbol answers [] no matter how many times it is asked.
    const client = makeClient(() => []);
    const gate = createReadinessGate({
      resolveTarget: () => ({ workspaceId: "ws-a", projectRoot: project.root, client }),
      pollIntervalMs: 10,
    });
    t.after(() => gate.close());

    fireBothReadinessLies(gate, "ws-a");

    let opened: unknown;
    let rejection: unknown;
    try {
      opened = await gate.awaitReady("ws-a", { withinMs: 300 });
    } catch (error) {
      rejection = error;
    }
    assert.ok(
      rejection instanceof WorkspaceNotReadyError,
      `the gate must stay shut while the probe answers empty; it opened with ${JSON.stringify(opened)}`,
    );

    const progress = gate.progress("ws-a");
    assert.ok(
      progress.serviceReadyAt !== undefined && progress.projectStatusAt !== undefined,
      "the test must actually have delivered both status signals for this to mean anything",
    );
    assert.ok(
      progress.probeAttempts >= 1,
      `the gate must have run the semantic probe at least once, ran ${progress.probeAttempts}`,
    );
    assert.ok(
      client.calls.some((call) => call.method === WORKSPACE_SYMBOL),
      "readiness must be decided by a real semantic request, not by a status notification",
    );
    assert.notEqual(progress.phase, "ready", "the gate must not report ready on ServiceReady alone");
  },
);

test(
  "INV-READY-2: the gate opens only on the probe answering non-empty, and never fires without status",
  { timeout: 10_000 },
  async (t) => {
    const project = makeProject(t);
    // No status notification is ever delivered here: the probe alone must be able to open the gate,
    // so ServiceReady cannot be a precondition either.
    const client = makeClient((attempt) => (attempt < 3 ? [] : symbolHit(project.greeterPath)));
    const gate = createReadinessGate({
      resolveTarget: () => ({ workspaceId: "ws-b", projectRoot: project.root, client }),
      pollIntervalMs: 10,
    });
    t.after(() => gate.close());

    const ticket = await gate.awaitReady("ws-b", { withinMs: 5_000 });

    assert.equal(ticket.workspaceId, "ws-b");
    assert.ok(ticket.probe.ok, "the ticket must carry the probe result the gate opened on");
    assert.equal(ticket.probe.method, WORKSPACE_SYMBOL);
    assert.ok(ticket.probe.matchCount >= 1, "a gate may only open on a non-empty probe answer");
    assert.equal(
      gate.progress("ws-b").serviceReadyAt,
      undefined,
      "this case delivered no ServiceReady; the probe alone opened the gate",
    );
    assert.ok(
      gate.progress("ws-b").probeAttempts >= 3,
      "the gate must keep probing while the index warms rather than trusting the first answer",
    );
    assert.equal(gate.progress("ws-b").phase, "ready");
  },
);

test(
  "INV-READY-1: a call during warm-up gets an explicit not-ready error carrying progress, never an empty success",
  { timeout: 10_000 },
  async (t) => {
    const project = makeProject(t);
    const client = makeClient(() => []);
    const gate = createReadinessGate({
      resolveTarget: () => ({ workspaceId: "ws-c", projectRoot: project.root, client }),
      pollIntervalMs: 10,
    });
    t.after(() => gate.close());

    gate.noteStatus("ws-c", { type: "ServiceReady" });
    gate.noteStatus("ws-c", { type: "Message", message: "100% Refreshing '/spike-a/src/test/java'" });

    let settled: unknown;
    try {
      settled = await gate.awaitReady("ws-c", { withinMs: 200 });
      assert.fail(`warm-up must not produce a successful result, got ${JSON.stringify(settled)}`);
    } catch (error) {
      assert.ok(error instanceof WorkspaceNotReadyError, `expected WorkspaceNotReadyError, got ${String(error)}`);
      assert.equal(error.code, "not-ready", "X-003's taxonomy code the tool layer maps to isError");
      assert.equal(error.isError, true);
      assert.equal(error.progress.workspaceId, "ws-c");
      assert.ok(error.progress.probeAttempts >= 1, "the progress payload must report probe attempts");
      assert.ok(error.progress.elapsedMs >= 0, "the progress payload must report how long the caller waited");
      assert.match(
        error.progress.lastStatusMessage ?? "",
        /Refreshing/,
        "the progress payload must carry the last status note so an agent can see what is happening",
      );
      assert.match(error.message, /not-ready/, "the message must name the failure, not be opaque");
    }
  },
);

test(
  "INV-READY-3: every waiting call settles within its own deadline even when the probe never returns",
  { timeout: 10_000 },
  async (t) => {
    const project = makeProject(t);
    // The worst case the 25-minute cold-start report describes: the request goes out and nothing
    // ever comes back. A gate that awaits it without a bound hangs the caller forever.
    const client = makeClient(() => new Promise<unknown>(() => {}));
    const gate = createReadinessGate({
      resolveTarget: () => ({ workspaceId: "ws-d", projectRoot: project.root, client }),
      pollIntervalMs: 10,
    });
    t.after(() => gate.close());

    fireBothReadinessLies(gate, "ws-d");

    const startedAt = Date.now();
    const pending = [120, 240, 360].map(async (withinMs) => {
      const at = Date.now();
      try {
        await gate.awaitReady("ws-d", { withinMs });
        return { withinMs, settledAfterMs: Date.now() - at, error: undefined as Error | undefined };
      } catch (error) {
        return { withinMs, settledAfterMs: Date.now() - at, error: error as Error };
      }
    });
    // Sampled after all three callers have entered awaitReady and before any of them can settle:
    // this is the cost of the concurrent window itself. A workspace that is slow to index is
    // exactly a workspace that must not be asked three times at once, so three simultaneous
    // callers must share ONE in-flight probe rather than each firing their own.
    const attemptsInConcurrentWindow = gate.progress("ws-d").probeAttempts;
    const requestsInConcurrentWindow = client.calls.length;
    const outcomes = await Promise.all(pending);

    assert.equal(
      attemptsInConcurrentWindow,
      1,
      `three concurrent callers must share one probe attempt, the gate counted ${attemptsInConcurrentWindow}`,
    );
    assert.equal(
      requestsInConcurrentWindow,
      1,
      `three concurrent callers must produce one ${WORKSPACE_SYMBOL} request, the server saw ${requestsInConcurrentWindow}`,
    );
    assert.ok(
      Date.now() - startedAt < 3_000,
      "all three calls must settle on their deadlines, not hang on the never-answering probe",
    );
    for (const outcome of outcomes) {
      assert.ok(
        outcome.error instanceof WorkspaceNotReadyError,
        `deadline ${outcome.withinMs}ms must settle as an explicit error, got ${String(outcome.error)}`,
      );
      assert.ok(
        outcome.settledAfterMs >= outcome.withinMs - 30,
        `deadline ${outcome.withinMs}ms settled early at ${outcome.settledAfterMs}ms — it gave up before its budget`,
      );
      assert.ok(
        outcome.settledAfterMs < outcome.withinMs + 1_000,
        `deadline ${outcome.withinMs}ms overran at ${outcome.settledAfterMs}ms`,
      );
    }
  },
);

test(
  "INV-READY-3: the deadline binds the caller even when the probe itself ignores its timeout budget",
  { timeout: 10_000 },
  async (t) => {
    const project = makeProject(t);
    // The probe seam is injectable (feat-prove-sync probes through it), so the gate cannot assume a
    // probe honours the timeout it was handed. This one ignores it completely and never settles:
    // only a deadline the GATE enforces around the probe can release the caller.
    let probeCalls = 0;
    const gate = createReadinessGate({
      resolveTarget: () => ({
        workspaceId: "ws-e",
        projectRoot: project.root,
        client: makeClient(() => []),
      }),
      pollIntervalMs: 10,
      probe: () => {
        probeCalls += 1;
        return new Promise<never>(() => {});
      },
    });
    t.after(() => gate.close());

    fireBothReadinessLies(gate, "ws-e");

    const startedAt = Date.now();
    let rejection: unknown;
    let opened: unknown;
    // The wait is bounded here as well, on purpose. A gate that fails this invariant does not fail
    // an assertion, it never returns — and an unbounded await would hang the runner and cancel
    // every case after this one instead of reporting which invariant broke.
    const watchdogMs = 2_000;
    let watchdog: NodeJS.Timeout | undefined;
    let stillWaiting = false;
    await Promise.race([
      gate.awaitReady("ws-e", { withinMs: 150 }).then(
        (ticket) => {
          opened = ticket;
        },
        (error) => {
          rejection = error;
        },
      ),
      new Promise<void>((resolve) => {
        watchdog = setTimeout(() => {
          stillWaiting = true;
          resolve();
        }, watchdogMs);
      }),
    ]);
    if (watchdog !== undefined) clearTimeout(watchdog);
    const settledAfterMs = Date.now() - startedAt;

    assert.equal(
      stillWaiting,
      false,
      `the caller was still waiting ${watchdogMs}ms after handing the gate a 150ms deadline: nothing ` +
        `released it, so the deadline is enforced only by a probe that happens to honour its timeout`,
    );
    assert.equal(probeCalls, 1, "the gate must have started the probe rather than skipping it");
    assert.ok(
      rejection instanceof WorkspaceNotReadyError,
      `the caller must be released by its own deadline with an explicit error, it got ${JSON.stringify(opened ?? rejection)}`,
    );
    assert.ok(
      settledAfterMs >= 120 && settledAfterMs < 1_000,
      `must settle at its 150ms deadline, settled at ${settledAfterMs}ms`,
    );
  },
);

test(
  "probeSemanticIndex is callable on its own and rejects an answer resolved outside the workspace",
  { timeout: 10_000 },
  async (t) => {
    const project = makeProject(t);
    const foreign = path.join(tmpdir(), "not-this-workspace", "Greeter.java");
    // Spike B's misroute shape: a non-empty answer that belongs to a different workspace.
    const client = makeClient(() => symbolHit(foreign));

    const result = await probeSemanticIndex({ projectRoot: project.root, client }, { timeoutMs: 1_000 });

    assert.equal(result.ok, false, "a symbol resolved outside this workspace is not evidence of readiness");
    assert.equal(result.method, WORKSPACE_SYMBOL);
    assert.equal(result.query, "Greeter", "the probe must derive a known symbol from the workspace's own sources");
    assert.match(result.reason ?? "", /outside/i);

    const good = await probeSemanticIndex(
      { projectRoot: project.root, client: makeClient(() => symbolHit(project.greeterPath)) },
      { timeoutMs: 1_000 },
    );
    assert.equal(good.ok, true);
    assert.equal(good.matchCount, 1);
  },
);

test(
  "reset(): a respawned workspace is proved ready by a new probe, never by the dead process's ticket",
  { timeout: 10_000 },
  async (t) => {
    const project = makeProject(t);
    // The daemon calls reset() when the JDT LS process dies and is respawned. The replacement
    // process starts with an empty index — spike A's cold start begins again from zero. A gate that
    // keeps answering from the ticket the DEAD process earned declares ready a server that can only
    // answer [], which is the exact lie INV-READY-2 exists to prevent.
    let indexed = true;
    const client = makeClient(() => (indexed ? symbolHit(project.greeterPath) : []));
    const gate = createReadinessGate({
      resolveTarget: () => ({ workspaceId: "ws-f", projectRoot: project.root, client }),
      pollIntervalMs: 10,
    });
    t.after(() => gate.close());

    const ticket = await gate.awaitReady("ws-f", { withinMs: 5_000 });
    assert.ok(ticket.probe.ok, "precondition: the gate is open on a real probe answer");
    assert.equal(gate.progress("ws-f").phase, "ready", "precondition: the workspace is ready before it dies");
    const requestsWhenOpen = client.calls.length;

    // The process died and was respawned. Everything the old one proved is now worthless.
    indexed = false;
    gate.reset("ws-f");

    const afterReset = gate.progress("ws-f");

    let reopened: unknown;
    let rejection: unknown;
    try {
      reopened = await gate.awaitReady("ws-f", { withinMs: 200 });
    } catch (error) {
      rejection = error;
    }
    assert.ok(
      rejection instanceof WorkspaceNotReadyError,
      `the respawned process answers []; the gate must stay shut, it returned ${JSON.stringify(reopened)}`,
    );
    assert.ok(
      client.calls.length > requestsWhenOpen,
      `after reset the gate must probe the NEW process for real: ${requestsWhenOpen} request(s) before reset, ` +
        `${client.calls.length} after — no new request means it answered from the stale ticket`,
    );
    assert.ok(
      gate.progress("ws-f").probeAttempts >= 1,
      "the attempt counter restarts against the new process instead of inheriting the dead one's",
    );
    assert.equal(afterReset.phase, "unknown", `reset must return the workspace to unknown, it reported ${afterReset.phase}`);
    assert.equal(afterReset.readyAt, undefined, "no ticket earned by the dead process may survive its reset");
  },
);

test(
  "readiness is monotonic: a caller arriving after the gate opened reuses the ticket without re-probing",
  { timeout: 10_000 },
  async (t) => {
    const project = makeProject(t);
    let indexed = true;
    const client = makeClient(() => (indexed ? symbolHit(project.greeterPath) : []));
    const gate = createReadinessGate({
      resolveTarget: () => ({ workspaceId: "ws-g", projectRoot: project.root, client }),
      pollIntervalMs: 10,
    });
    t.after(() => gate.close());

    const first = await gate.awaitReady("ws-g", { withinMs: 5_000 });
    const requestsWhenOpen = client.calls.length;

    // From here the server would answer [] to anyone who asked. So if the second caller is let
    // through, and let through without spending a request, it is the recorded ticket answering:
    // readiness proved once stays proved for the life of this process, and costs nothing again.
    indexed = false;
    const startedAt = Date.now();
    const second = await gate.awaitReady("ws-g", { withinMs: 100 });
    const tookMs = Date.now() - startedAt;

    assert.equal(second.readyAt, first.readyAt, "the later caller gets the very ticket the first probe earned");
    assert.equal(second.waitedMs, 0, `a caller arriving after readiness waits for nothing, reported ${second.waitedMs}ms`);
    assert.ok(second.probe.ok, "the reused ticket still carries the probe answer the gate opened on");
    assert.equal(
      client.calls.length,
      requestsWhenOpen,
      `an already-ready workspace must not be probed again (${requestsWhenOpen} request(s) -> ${client.calls.length})`,
    );
    assert.ok(tookMs < 50, `the later caller must return immediately, it took ${tookMs}ms`);
  },
);

test(
  "a probe is never handed more budget than the calling deadline still has",
  { timeout: 10_000 },
  async (t) => {
    const project = makeProject(t);
    // Second line of defence behind the gate's own deadline: the request handed to the server is
    // itself capped by what the caller has left, so an abandoned request cannot keep a warming
    // server busy long after the caller that paid for it is gone. The probe seam is public
    // (feat-prove-sync calls it directly), so the budget it receives is observable contract.
    const handedBudgets: Array<number | undefined> = [];
    const gate = createReadinessGate({
      resolveTarget: () => ({
        workspaceId: "ws-i",
        projectRoot: project.root,
        client: makeClient(() => []),
      }),
      pollIntervalMs: 10,
      probeTimeoutMs: 5_000,
      probe: async (_target, options) => {
        handedBudgets.push(options?.timeoutMs);
        return {
          ok: false,
          method: WORKSPACE_SYMBOL,
          query: "Greeter",
          matchCount: 0,
          reason: "the index cannot answer yet",
        };
      },
    });
    t.after(() => gate.close());

    const budgetMs = 150;
    await assert.rejects(() => gate.awaitReady("ws-i", { withinMs: budgetMs }), WorkspaceNotReadyError);

    assert.ok(handedBudgets.length >= 1, "the gate must actually have run probes to have handed out any budget");
    for (const timeoutMs of handedBudgets) {
      assert.ok(
        timeoutMs !== undefined && timeoutMs >= 1 && timeoutMs <= budgetMs,
        `a probe inside a ${budgetMs}ms call was handed ${String(timeoutMs)}ms (the standing probe ceiling is ` +
          `5000ms): an abandoned request must not outlive the caller that started it`,
      );
    }
  },
);

test(
  "INV-READY-3: a deadline given as an absolute instant binds the caller exactly like a duration",
  { timeout: 10_000 },
  async (t) => {
    const project = makeProject(t);
    // Deadline has two shapes because X-001 is still open, and a caller that already holds an
    // absolute budget passes { at }. Reading that instant as a duration and adding it to now pushes
    // the deadline decades out, so the caller waits unbounded — INV-READY-3 broken for half the
    // callers of this module, on the shape no other case exercises.
    const client = makeClient(() => new Promise<unknown>(() => {}));
    const gate = createReadinessGate({
      resolveTarget: () => ({ workspaceId: "ws-h", projectRoot: project.root, client }),
      pollIntervalMs: 10,
    });
    t.after(() => gate.close());

    fireBothReadinessLies(gate, "ws-h");

    const budgetMs = 200;
    const startedAt = Date.now();
    let rejection: unknown;
    let opened: unknown;
    try {
      opened = await gate.awaitReady("ws-h", { at: startedAt + budgetMs });
    } catch (error) {
      rejection = error;
    }
    const settledAfterMs = Date.now() - startedAt;

    assert.ok(
      rejection instanceof WorkspaceNotReadyError,
      `an { at } deadline must release the caller with an explicit error, got ${JSON.stringify(opened)}`,
    );
    assert.ok(
      settledAfterMs >= budgetMs - 30,
      `the { at } instant was ${budgetMs}ms out; the call gave up early at ${settledAfterMs}ms`,
    );
    assert.ok(
      settledAfterMs < budgetMs + 1_000,
      `the { at } instant was ${budgetMs}ms out; the call overran to ${settledAfterMs}ms — the instant was not read as an instant`,
    );
  },
);

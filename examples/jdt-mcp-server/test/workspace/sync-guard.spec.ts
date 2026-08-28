// Traceability (harness/skills/test-design/SKILL.md, role: Test-Implementer).
//
// Requirements: INV-SYNC-1
// Component:    src/workspace/sync-guard.ts (withSyncQuiescence)
//
// Level 1 (unit) oracle for the sync-guard in isolation. The integration oracle
// (test/integration/file-sync.integration.spec.ts) proves the same behavior end-to-end against a
// real JDT LS; this file pins the guard's contract against a fake watcher so its edge cases — a
// pending change that never settles, a view that never catches up, a deadline already elapsed —
// are exercised deterministically and fast.

import { test } from "node:test";
import assert from "node:assert/strict";

import type { FileSyncWatcher } from "../../src/workspace/file-sync-watcher.ts";
import { ResyncingError, withSyncQuiescence } from "../../src/workspace/sync-guard.ts";

function makeWatcher(options: {
  quiescent?: boolean;
  whenSettled?: () => Promise<number>;
} = {}): FileSyncWatcher {
  return {
    projectRoot: "/proj",
    generation: 0,
    settledAt: undefined,
    lastChangeAt: undefined,
    isQuiescent: () => options.quiescent ?? true,
    whenSettled: options.whenSettled ?? (async () => Date.now()),
    start: async () => {},
    close: async () => {},
  } as FileSyncWatcher;
}

const FAST = { pollIntervalMs: 5 };

test(
  "quiescent watcher with a non-stale answer returns immediately without probing again",
  async () => {
    const watcher = makeWatcher({ quiescent: true });
    let calls = 0;
    const result = await withSyncQuiescence(
      watcher,
      { withinMs: 1_000 },
      async () => {
        calls += 1;
        return "current";
      },
      (value) => value === "stale",
      FAST,
    );
    assert.equal(result, "current");
    assert.equal(calls, 1, "the guard must not poll a quiescent watcher whose first answer is already current");
  },
);

test(
  "a stale answer is re-probed until it becomes current",
  async () => {
    const watcher = makeWatcher({ quiescent: false });
    const answers = ["stale", "stale", "current"];
    let calls = 0;
    const result = await withSyncQuiescence(
      watcher,
      { withinMs: 1_000 },
      async () => answers[Math.min(calls++, answers.length - 1)]!,
      (value) => value === "stale",
      FAST,
    );
    assert.equal(result, "current");
    assert.equal(calls, 3, "the guard must keep probing through the stale answers");
  },
);

test(
  "a pending change is awaited to settle before the first probe",
  async () => {
    let settleCalls = 0;
    const watcher = makeWatcher({
      quiescent: false,
      whenSettled: async () => {
        settleCalls += 1;
        return Date.now();
      },
    });
    let probes = 0;
    const result = await withSyncQuiescence(
      watcher,
      { withinMs: 1_000 },
      async () => {
        probes += 1;
        return "current";
      },
      (value) => value === "stale",
      FAST,
    );
    assert.equal(result, "current");
    assert.equal(settleCalls, 1, "the guard must wait for the pending change to settle exactly once");
    assert.equal(probes, 1);
  },
);

test(
  "a pending change that never settles inside the deadline fails as resyncing, never probing",
  async () => {
    let whenSettledCalls = 0;
    const watcher = makeWatcher({
      quiescent: false,
      whenSettled: () => {
        whenSettledCalls += 1;
        return new Promise<number>(() => {}); // never settles
      },
    });
    let probes = 0;
    await assert.rejects(
      withSyncQuiescence(
        watcher,
        { withinMs: 30 },
        async () => {
          probes += 1;
          return "current";
        },
        (value) => value === "stale",
        FAST,
      ),
      (error: unknown) => {
        assert.ok(error instanceof ResyncingError, `expected ResyncingError, got ${String(error)}`);
        assert.equal(error.code, "resyncing");
        return true;
      },
    );
    assert.equal(whenSettledCalls, 1);
    assert.equal(probes, 0, "the guard must not probe before the pending change has been dispatched");
  },
);

test(
  "a view that never stops being stale fails as resyncing once the deadline passes",
  async () => {
    const watcher = makeWatcher({ quiescent: false });
    let probes = 0;
    await assert.rejects(
      withSyncQuiescence(
        watcher,
        { withinMs: 30 },
        async () => {
          probes += 1;
          return "stale";
        },
        (value) => value === "stale",
        FAST,
      ),
      (error: unknown) => {
        assert.ok(error instanceof ResyncingError, `expected ResyncingError, got ${String(error)}`);
        assert.equal(error.code, "resyncing");
        return true;
      },
    );
    assert.ok(probes >= 2, `the guard must poll, got ${probes} probe(s)`);
  },
);

test(
  "an absolute deadline already in the past fails immediately when the watcher has a pending change",
  async () => {
    const watcher = makeWatcher({ quiescent: false, whenSettled: async () => Date.now() });
    let probes = 0;
    await assert.rejects(
      withSyncQuiescence(
        watcher,
        { at: Date.now() - 1 },
        async () => {
          probes += 1;
          return "current";
        },
        (value) => value === "stale",
        FAST,
      ),
      (error: unknown) => error instanceof ResyncingError,
    );
    assert.equal(probes, 0);
  },
);

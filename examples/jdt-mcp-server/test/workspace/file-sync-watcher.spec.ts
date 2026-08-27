// Level 1 oracle for feat-file-sync-watcher.
//
// Falsifier under test: "a rename or delete under a watched source root produces no notification,
// or produces the wrong change-type notification [INV-SYNC-2]; or a pom.xml edit only emits a
// source-file notification instead of triggering a project-configuration refresh [INV-SYNC-3]".
//
// Every case drives a REAL directory in a real tmpdir through node's own fs.watch — the change
// classes this component exists for (delete, rename, editor temp-write-then-rename) are exactly
// the ones an in-memory event stub would let a broken watcher pass. The LSP transport is faked,
// because the assertion is about WHICH notification is emitted, not about Content-Length framing
// (that is lsp-client's, proven in test/lsp/lsp-client.spec.ts). JDT LS itself is out of scope
// here: spike C already established what it does when the notification never arrives.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  DID_CHANGE_WATCHED_FILES,
  FileChangeType,
  PROJECT_CONFIGURATION_UPDATE,
  createFileSyncWatcher,
  type FileChangeTypeValue,
  type FileSyncWatcher,
} from "../../src/workspace/file-sync-watcher.ts";

const WAIT_BUDGET_MS = 15_000;
const CASE_TIMEOUT_MS = 30_000;

interface SentNotification {
  method: string;
  params: unknown;
}

interface ObservedChange {
  uri: string;
  type: FileChangeTypeValue;
}

/** Records what the watcher would have put on the wire. */
class RecordingSink {
  public readonly sent: SentNotification[] = [];

  public notify(method: string, params: unknown): void {
    this.sent.push({ method, params });
  }

  /** Every file change across every batch, in dispatch order. */
  public changes(): ObservedChange[] {
    const all: ObservedChange[] = [];
    for (const notification of this.sent) {
      if (notification.method !== DID_CHANGE_WATCHED_FILES) continue;
      const params = notification.params as { changes?: ObservedChange[] };
      for (const change of params.changes ?? []) all.push(change);
    }
    return all;
  }

  public changesFor(filePath: string): ObservedChange[] {
    const uri = pathToFileURL(filePath).href;
    return this.changes().filter((change) => change.uri === uri);
  }

  public refreshedUris(): string[] {
    return this.sent
      .filter((notification) => notification.method === PROJECT_CONFIGURATION_UPDATE)
      .map((notification) => (notification.params as { uri: string }).uri);
  }
}

/** The watcher the currently running case is driving; only one case runs at a time in this file. */
let activeWatch: { watcher: FileSyncWatcher; projectRoot: string } | undefined;

const PROBE_FILENAME = ".fs-watch-probe";
const NUDGE_AFTER_MS = 300;
const NUDGE_INTERVAL_MS = 250;

/**
 * macOS backs `fs.watch(..., { recursive: true })` with FSEvents, and libuv starts that stream on
 * another thread AFTER `watch()` has returned. A write landing in that window is never delivered —
 * not delivered late, never. Because the watcher only flushes when an event wakes it, the lost
 * event shows up as total silence, so a case hangs for its whole wait budget instead of failing on
 * an assertion. On a loaded machine (`npm run test:integration` runs every spec file in parallel)
 * this was observed swallowing whichever case wrote first, roughly one run in two.
 *
 * The nudge writes a file the watcher ignores by construction — not `*.java`, not `pom.xml`, so it
 * can never appear in a notification — purely to wake the stream. It fires only while the watcher
 * has NEVER observed an event, which is exactly the start-up window; once anything has been
 * delivered the stream is live and the nudge stays out of the way. It cannot mask a missing
 * notification either: waking the watcher makes it re-scan and diff the whole watched tree, so a
 * change the implementation would not report is still not reported.
 */
function nudgeWatchStream(): void {
  if (activeWatch === undefined || activeWatch.watcher.lastChangeAt !== undefined) return;
  writeFileSync(path.join(activeWatch.projectRoot, PROBE_FILENAME), String(Date.now()));
}

async function waitUntil(description: string, predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + WAIT_BUDGET_MS;
  let nextNudgeAt = Date.now() + NUDGE_AFTER_MS;
  while (Date.now() < deadline) {
    if (predicate()) return;
    if (Date.now() >= nextNudgeAt) {
      nudgeWatchStream();
      nextNudgeAt = Date.now() + NUDGE_INTERVAL_MS;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`timed out after ${WAIT_BUDGET_MS} ms waiting for: ${description}`);
}

interface Fixture {
  projectRoot: string;
  sourceDir: string;
  pom: string;
  greeter: string;
  sink: RecordingSink;
  watcher: FileSyncWatcher;
}

/**
 * The explicit form of the nudge above, for cases that need the stream provably live BEFORE their
 * first write rather than recovered afterwards. It settles the watcher on the tree as it stands, so
 * whatever the case does next is the only thing left to diff.
 */
async function awaitWatchStreamLive(watcher: FileSyncWatcher, projectRoot: string): Promise<void> {
  const probe = path.join(projectRoot, PROBE_FILENAME);
  const deadline = Date.now() + WAIT_BUDGET_MS;
  while (watcher.lastChangeAt === undefined) {
    if (Date.now() > deadline) assert.fail("the fs.watch stream never delivered an event");
    writeFileSync(probe, String(Date.now()));
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  rmSync(probe, { force: true });
  await waitUntil("the probe's flush drained", () => watcher.isQuiescent());
}

async function makeFixture(
  t: { after: (fn: () => unknown) => void },
  options: { debounceMs?: number; autoStart?: boolean } = {},
): Promise<Fixture> {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "jdt-sync-watcher-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const projectRoot = path.join(root, "project");
  const sourceDir = path.join(projectRoot, "src", "main", "java", "spike");
  mkdirSync(sourceDir, { recursive: true });
  mkdirSync(path.join(projectRoot, "target", "classes"), { recursive: true });

  const pom = path.join(projectRoot, "pom.xml");
  writeFileSync(pom, "<project><artifactId>spike</artifactId></project>\n");
  const greeter = path.join(sourceDir, "Greeter.java");
  writeFileSync(greeter, "package spike;\npublic class Greeter { String greet() { return \"hi\"; } }\n");

  const sink = new RecordingSink();
  const watcher = createFileSyncWatcher({
    projectRoot,
    notifications: sink,
    debounceMs: options.debounceMs ?? 60,
    onError: (error) => assert.fail(`watcher reported an error: ${error.message}`),
  });
  activeWatch = { watcher, projectRoot };
  t.after(() => {
    activeWatch = undefined;
  });
  // Left unstarted only when a case must settle a pre-watch picture of the tree first.
  if (options.autoStart !== false) await watcher.start();
  t.after(() => watcher.close());

  return { projectRoot, sourceDir, pom, greeter, sink, watcher };
}

test(
  "INV-SYNC-2: a create, a modify and a delete each produce the matching change type",
  { timeout: CASE_TIMEOUT_MS },
  async (t) => {
    const fixture = await makeFixture(t);
    const created = path.join(fixture.sourceDir, "App.java");

    writeFileSync(created, "package spike;\npublic class App {}\n");
    await waitUntil("App.java reported as Created", () => fixture.sink.changesFor(created).length > 0);
    assert.deepEqual(
      fixture.sink.changesFor(created).map((change) => change.type),
      [FileChangeType.Created],
    );

    writeFileSync(fixture.greeter, "package spike;\npublic class Greeter {}\n");
    await waitUntil("Greeter.java reported as Changed", () => fixture.sink.changesFor(fixture.greeter).length > 0);
    assert.deepEqual(
      fixture.sink.changesFor(fixture.greeter).map((change) => change.type),
      [FileChangeType.Changed],
      "a modify must be Changed (2), not Created or Deleted",
    );

    rmSync(created);
    await waitUntil(
      "App.java reported as Deleted",
      () => fixture.sink.changesFor(created).length > 1,
    );
    assert.deepEqual(
      fixture.sink.changesFor(created).map((change) => change.type),
      [FileChangeType.Created, FileChangeType.Deleted],
      "the delete must arrive as Deleted (3) — this is the spike-C failure if it is dropped",
    );
  },
);

test(
  "INV-SYNC-2: a rename under a watched source root is reported as Deleted of the old path and Created of the new",
  { timeout: CASE_TIMEOUT_MS },
  async (t) => {
    const fixture = await makeFixture(t);
    const renamed = path.join(fixture.sourceDir, "Salutation.java");

    renameSync(fixture.greeter, renamed);

    await waitUntil(
      "both halves of the rename reported",
      () =>
        fixture.sink.changesFor(fixture.greeter).length > 0 &&
        fixture.sink.changesFor(renamed).length > 0,
    );
    assert.deepEqual(
      fixture.sink.changesFor(fixture.greeter).map((change) => change.type),
      [FileChangeType.Deleted],
      "the vacated path must be Deleted (3); anything else leaves JDT LS resolving a class that is gone",
    );
    assert.deepEqual(
      fixture.sink.changesFor(renamed).map((change) => change.type),
      [FileChangeType.Created],
    );
  },
);

test(
  "INV-SYNC-2: the editor temp-write-then-rename pattern still reports the destination as Changed, and never names the temp file",
  { timeout: CASE_TIMEOUT_MS },
  async (t) => {
    const fixture = await makeFixture(t);
    const temp = path.join(fixture.sourceDir, ".Greeter.java.tmp-1234");
    const untracked = path.join(fixture.projectRoot, "README.md");
    const buildOutput = path.join(fixture.projectRoot, "target", "classes", "Stale.java");

    // How an AI agent (and most editors) actually writes a file: full content to a sibling temp
    // path, then one atomic rename over the destination. A watcher that reads the change type off
    // the raw OS event sees only a "rename" of a path it does not track, and drops the edit.
    writeFileSync(untracked, "# not a java source\n");
    writeFileSync(buildOutput, "package spike;\npublic class Stale {}\n");
    writeFileSync(temp, "package spike;\npublic class Greeter { String salute() { return \"hi\"; } }\n");
    renameSync(temp, fixture.greeter);

    await waitUntil(
      "the rewritten Greeter.java reported",
      () => fixture.sink.changesFor(fixture.greeter).length > 0,
    );
    assert.deepEqual(
      fixture.sink.changesFor(fixture.greeter).map((change) => change.type),
      [FileChangeType.Changed],
    );

    await waitUntil("the watcher settled", () => fixture.watcher.isQuiescent());
    const named = fixture.sink.changes().map((change) => change.uri);
    assert.deepEqual(named, [pathToFileURL(fixture.greeter).href],
      "only the destination source file may be reported: not the temp path, not README.md, not target/",
    );
  },
);

test(
  "INV-SYNC-3: a pom.xml edit triggers a project-configuration refresh, not only a watched-file notification",
  { timeout: CASE_TIMEOUT_MS },
  async (t) => {
    const fixture = await makeFixture(t);

    writeFileSync(
      fixture.pom,
      "<project><artifactId>spike</artifactId><dependencies/></project>\n",
    );

    await waitUntil(
      "pom.xml refresh emitted",
      () => fixture.sink.refreshedUris().length > 0,
    );
    assert.deepEqual(
      fixture.sink.refreshedUris(),
      [pathToFileURL(fixture.pom).href],
      "a dependency change is a project-model change: java/projectConfigurationUpdate must name the pom",
    );
    assert.deepEqual(
      fixture.sink.changesFor(fixture.pom).map((change) => change.type),
      [FileChangeType.Changed],
      "the pom is also a watched file; the refresh is in addition to, not instead of, the file notification",
    );
    assert.ok(
      fixture.sink.sent.findIndex((n) => n.method === DID_CHANGE_WATCHED_FILES) <
        fixture.sink.sent.findIndex((n) => n.method === PROJECT_CONFIGURATION_UPDATE),
      "the server must learn the file changed before it is asked to re-read the project model",
    );
  },
);

test(
  "a source-only edit never triggers a project-configuration refresh",
  { timeout: CASE_TIMEOUT_MS },
  async (t) => {
    const fixture = await makeFixture(t);

    writeFileSync(fixture.greeter, "package spike;\npublic class Greeter { int n; }\n");

    await waitUntil("the source edit reported", () => fixture.sink.changesFor(fixture.greeter).length > 0);
    await waitUntil("the watcher settled", () => fixture.watcher.isQuiescent());
    assert.deepEqual(fixture.sink.refreshedUris(), []);
  },
);

test(
  "settledAt is a debounced marker distinct from the raw observation: it moves only after the batch is dispatched",
  { timeout: CASE_TIMEOUT_MS },
  async (t) => {
    const fixture = await makeFixture(t, { debounceMs: 400 });
    assert.equal(fixture.watcher.settledAt, undefined, "nothing has settled before the first change");
    assert.equal(fixture.watcher.generation, 0);

    const settled = fixture.watcher.whenSettled();
    writeFileSync(path.join(fixture.sourceDir, "First.java"), "package spike;\npublic class First {}\n");
    writeFileSync(path.join(fixture.sourceDir, "Second.java"), "package spike;\npublic class Second {}\n");

    await waitUntil("the raw filesystem event observed", () => fixture.watcher.lastChangeAt !== undefined);
    // Inside the debounce window: the change has been SEEN, but nothing has been sent and the
    // workspace has not settled. A caller that treated these as one event would read quiescence
    // here and answer from the pre-edit model.
    assert.equal(fixture.watcher.settledAt, undefined);
    assert.equal(fixture.watcher.generation, 0);
    assert.equal(fixture.sink.sent.length, 0);
    assert.equal(fixture.watcher.isQuiescent(), false);

    const settledAt = await settled;
    assert.equal(typeof settledAt, "number");
    assert.equal(fixture.watcher.settledAt, settledAt);
    assert.ok(fixture.watcher.generation >= 1, "a dispatched batch bumps the change generation");
    assert.ok(
      settledAt >= (fixture.watcher.lastChangeAt ?? Number.POSITIVE_INFINITY),
      "settling always follows the last observed change",
    );
    await waitUntil("both new sources reported", () => fixture.sink.changes().length >= 2);
    assert.equal(fixture.watcher.isQuiescent(), true);
  },
);

test(
  "closing flushes a batch still inside its debounce window instead of dropping it",
  { timeout: CASE_TIMEOUT_MS },
  async (t) => {
    const fixture = await makeFixture(t, { debounceMs: 5_000 });
    const late = path.join(fixture.sourceDir, "Late.java");

    writeFileSync(late, "package spike;\npublic class Late {}\n");
    await waitUntil("the raw filesystem event observed", () => fixture.watcher.lastChangeAt !== undefined);
    assert.equal(fixture.sink.sent.length, 0);

    await fixture.watcher.close();
    assert.deepEqual(
      fixture.sink.changesFor(late).map((change) => change.type),
      [FileChangeType.Created],
      "a shutdown must not swallow an edit that was still debouncing",
    );
  },
);

test(
  "watching a project root that does not exist fails with a named error rather than silently watching nothing",
  { timeout: CASE_TIMEOUT_MS },
  async () => {
    const missing = path.join(tmpdir(), "jdt-sync-watcher-absent-", String(process.pid), "project");
    const watcher = createFileSyncWatcher({ projectRoot: missing, notifications: new RecordingSink() });
    await assert.rejects(() => watcher.start(), (error: Error) => error.message.includes(missing));
  },
);

// --- The wire, not the label -------------------------------------------------------------------
//
// Every case above compares `type` against `FileChangeType`, imported from the module being judged.
// That only proves the labels are internally consistent: renumber the constant to
// { Created: 3, Changed: 2, Deleted: 1 } and all of them stay green while a freshly created file
// reaches JDT LS carrying "deleted". LSP 3.17 (§workspace/didChangeWatchedFiles) fixes the integers
// at Created = 1, Changed = 2, Deleted = 3, so the literals below come from the protocol, not from
// the implementation, and are the only assertion here that pins what actually goes on the wire.
test(
  "INV-SYNC-2: the change type on the wire is the LSP 3.17 integer — created 1, changed 2, deleted 3",
  { timeout: CASE_TIMEOUT_MS },
  async (t) => {
    const fixture = await makeFixture(t);
    await awaitWatchStreamLive(fixture.watcher, fixture.projectRoot);
    const created = path.join(fixture.sourceDir, "Wire.java");

    writeFileSync(created, "package spike;\npublic class Wire {}\n");
    await waitUntil("Wire.java creation reported", () => fixture.sink.changesFor(created).length > 0);
    assert.deepEqual(
      fixture.sink.changesFor(created).map((change) => change.type),
      [1],
      "LSP 3.17: a created file must be sent as FileChangeType 1",
    );

    writeFileSync(created, "package spike;\npublic class Wire { int n; }\n");
    await waitUntil("Wire.java modification reported", () => fixture.sink.changesFor(created).length > 1);
    assert.deepEqual(
      fixture.sink.changesFor(created).map((change) => change.type),
      [1, 2],
      "LSP 3.17: a modified file must be sent as FileChangeType 2",
    );

    rmSync(created);
    await waitUntil("Wire.java deletion reported", () => fixture.sink.changesFor(created).length > 2);
    assert.deepEqual(
      fixture.sink.changesFor(created).map((change) => change.type),
      [1, 2, 3],
      "LSP 3.17: a deleted file must be sent as FileChangeType 3",
    );
  },
);

// --- The inode half of the diff ----------------------------------------------------------------
//
// The temp-write-then-rename case above rewrites Greeter.java with a DIFFERENT number of bytes, so
// size alone already separates the two stamps and the inode comparison never has to carry anything.
// The design note (harness/memory/maker/fs-watch-events-are-not-evidence-of-a-diff.md) claims the
// inode is what makes that pattern visible "even when the size does not change" — this case is the
// one that holds it to that claim. Both mtime and size are pinned identical on purpose, so the
// destination differs from its previous stamp in exactly one field: the inode it inherited from the
// temp file. An agent that rewrites a method body to another body of the same length inside one
// mtime tick is the real shape of this, and dropping it is the silent spike-C failure again.
test(
  "INV-SYNC-2: a same-size, same-mtime overwrite by temp-write-then-rename is still reported as Changed",
  { timeout: CASE_TIMEOUT_MS },
  async (t) => {
    const fixture = await makeFixture(t, { autoStart: false });
    const fixedTime = new Date(1_700_000_000_000);
    const before = "package spike;\npublic class Greeter { int aaa() { return 1; } }\n";
    const after = "package spike;\npublic class Greeter { int bbb() { return 2; } }\n";
    assert.equal(
      Buffer.byteLength(after),
      Buffer.byteLength(before),
      "the fixture is only meaningful if both revisions occupy the same number of bytes",
    );

    // The baseline revision is written BEFORE the watcher starts, with its mtime frozen to a whole
    // second, so the picture the diff is taken against is the watcher's own start-up scan. Freezing
    // it after start would race the flush and leave it ambiguous which mtime was recorded.
    writeFileSync(fixture.greeter, before);
    utimesSync(fixture.greeter, fixedTime, fixedTime);
    await fixture.watcher.start();
    await awaitWatchStreamLive(fixture.watcher, fixture.projectRoot);
    const settledStat = statSync(fixture.greeter);
    assert.deepEqual(
      fixture.sink.changes(),
      [],
      "nothing may have been reported yet: the baseline revision predates the watch",
    );

    // Now the agent/editor write: full content to a sibling temp path, same byte count, same frozen
    // mtime, then one atomic rename over the destination.
    const temp = path.join(fixture.sourceDir, ".Greeter.java.tmp-5678");
    writeFileSync(temp, after);
    utimesSync(temp, fixedTime, fixedTime);
    renameSync(temp, fixture.greeter);

    const rewrittenStat = statSync(fixture.greeter);
    assert.equal(rewrittenStat.size, settledStat.size, "size must be identical across the overwrite");
    assert.equal(rewrittenStat.mtimeMs, settledStat.mtimeMs, "mtime must be identical across the overwrite");
    assert.notEqual(
      rewrittenStat.ino,
      settledStat.ino,
      "the destination must have taken the temp file's inode, or this case proves nothing",
    );

    await waitUntil(
      "the same-size overwrite reported as a change",
      () => fixture.sink.changesFor(fixture.greeter).length > 0,
    );
    assert.deepEqual(
      fixture.sink.changesFor(fixture.greeter).map((change) => change.type),
      [FileChangeType.Changed],
      "mtime and size are identical here: only the inode separates the two revisions",
    );
  },
);

// --- Multi-module reactors ---------------------------------------------------------------------
//
// Every fixture above is one module, one source root, one pom at the root, so the two clauses that
// exist purely for reactors — the infix `/src/main/java/` match in #isWatchedPath and watching poms
// below the root — are never exercised. A Maven reactor is the normal shape of a real Java project,
// and a module whose sources are invisible to the watcher is exactly the stale-model failure this
// component exists to prevent, just scoped to one module.
async function makeReactorFixture(t: {
  after: (fn: () => unknown) => void;
}): Promise<{ moduleSource: string; modulePom: string; rootPom: string; sink: RecordingSink; watcher: FileSyncWatcher }> {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "jdt-sync-reactor-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const projectRoot = path.join(root, "reactor");
  const moduleSourceDir = path.join(projectRoot, "moduleA", "src", "main", "java", "spike", "a");
  mkdirSync(moduleSourceDir, { recursive: true });

  const rootPom = path.join(projectRoot, "pom.xml");
  writeFileSync(rootPom, "<project><artifactId>reactor</artifactId><modules><module>moduleA</module></modules></project>\n");
  const modulePom = path.join(projectRoot, "moduleA", "pom.xml");
  writeFileSync(modulePom, "<project><artifactId>module-a</artifactId></project>\n");
  const moduleSource = path.join(moduleSourceDir, "ModuleA.java");
  writeFileSync(moduleSource, "package spike.a;\npublic class ModuleA {}\n");

  const sink = new RecordingSink();
  const watcher = createFileSyncWatcher({
    projectRoot,
    notifications: sink,
    debounceMs: 60,
    onError: (error) => assert.fail(`watcher reported an error: ${error.message}`),
  });
  activeWatch = { watcher, projectRoot };
  t.after(() => {
    activeWatch = undefined;
  });
  await watcher.start();
  t.after(() => watcher.close());
  await awaitWatchStreamLive(watcher, projectRoot);

  return { moduleSource, modulePom, rootPom, sink, watcher };
}

test(
  "INV-SYNC-2/3: in a two-module reactor, a module's own sources and its own pom.xml are watched like the root's",
  { timeout: CASE_TIMEOUT_MS },
  async (t) => {
    const fixture = await makeReactorFixture(t);

    // moduleA/src/main/java/... never starts with the source-root pattern; it only contains it.
    writeFileSync(fixture.moduleSource, "package spike.a;\npublic class ModuleA { int n; }\n");
    await waitUntil(
      "the module source edit reported",
      () => fixture.sink.changesFor(fixture.moduleSource).length > 0,
    );
    assert.deepEqual(
      fixture.sink.changesFor(fixture.moduleSource).map((change) => change.type),
      [FileChangeType.Changed],
      "a source root nested under a module must be watched, not only one directly under the project root",
    );

    // INV-SYNC-3 says "a pom.xml change", with no privilege for the aggregator pom: a module pom
    // carries that module's dependencies, so editing it changes that module's classpath.
    writeFileSync(fixture.modulePom, "<project><artifactId>module-a</artifactId><dependencies/></project>\n");
    await waitUntil("the module pom refresh emitted", () => fixture.sink.refreshedUris().length > 0);
    assert.deepEqual(
      fixture.sink.refreshedUris(),
      [pathToFileURL(fixture.modulePom).href],
      "the refresh must name the module pom that changed",
    );
    assert.deepEqual(
      fixture.sink.changesFor(fixture.modulePom).map((change) => change.type),
      [FileChangeType.Changed],
      "the module pom is a watched file in its own right, not only a refresh trigger",
    );
    assert.deepEqual(
      fixture.sink.changesFor(fixture.rootPom),
      [],
      "the untouched aggregator pom must not be reported",
    );
  },
);

// --- The other half of DEFAULT_SOURCE_ROOT_PATTERNS ---------------------------------------------
//
// `src/test/java` is declared watched but no case above puts a file there, so removing it from the
// constant changes nothing observable. Test sources are where an agent iterates fastest, and a JDT
// LS that never hears about them answers test-file questions from a model that predates the edit.
test(
  "INV-SYNC-2: edits under src/test/java are watched too, not only src/main/java",
  { timeout: CASE_TIMEOUT_MS },
  async (t) => {
    const fixture = await makeFixture(t);
    await awaitWatchStreamLive(fixture.watcher, fixture.projectRoot);
    const testSourceDir = path.join(fixture.projectRoot, "src", "test", "java", "spike");
    mkdirSync(testSourceDir, { recursive: true });
    const greeterTest = path.join(testSourceDir, "GreeterTest.java");

    writeFileSync(greeterTest, "package spike;\npublic class GreeterTest {}\n");
    await waitUntil("the new test source reported", () => fixture.sink.changesFor(greeterTest).length > 0);
    assert.deepEqual(
      fixture.sink.changesFor(greeterTest).map((change) => change.type),
      [FileChangeType.Created],
    );

    writeFileSync(greeterTest, "package spike;\npublic class GreeterTest { void t() {} }\n");
    await waitUntil("the test source edit reported", () => fixture.sink.changesFor(greeterTest).length > 1);
    assert.deepEqual(
      fixture.sink.changesFor(greeterTest).map((change) => change.type),
      [FileChangeType.Created, FileChangeType.Changed],
      "src/test/java is half of DEFAULT_SOURCE_ROOT_PATTERNS and must behave like the other half",
    );
  },
);

// --- Each field of the (mtime, size, inode) stamp, on its own ------------------------------------
//
// The Changed decision is a three-clause disjunction over mtimeMs, size and inode. The same-size
// temp-write-then-rename case above pins the inode clause, but it changes the inode in every other
// case too, so mtime and size are still carried by nothing: delete either clause and the whole file
// stays green. The two cases below each isolate ONE field by writing IN PLACE — `writeFileSync` over
// an existing path opens it with O_TRUNC and never unlinks, so the destination keeps its inode, and
// the temp-write pattern is not involved at all. That is the ordinary editor/agent write, not an
// edge case.

// An agent rewriting one method body into another body of the same length — `return 1;` becoming
// `return 2;`, or an identifier swapped for another of equal length — moves nothing but the mtime.
// Under a diff that has lost its mtime clause this write produces NO notification at all, which is
// the exact silent staleness of spike C: JDT LS keeps answering from the pre-edit model with zero
// errors. The baseline mtime is frozen into 2023 before the watch starts, so the in-place write's
// "now" is unambiguously different regardless of the filesystem's mtime resolution.
test(
  "INV-SYNC-2: an in-place rewrite that changes only the mtime is still reported as Changed",
  { timeout: CASE_TIMEOUT_MS },
  async (t) => {
    const fixture = await makeFixture(t, { autoStart: false });
    const baselineTime = new Date(1_700_000_000_000);
    const before = "package spike;\npublic class Greeter { int aaa() { return 1; } }\n";
    const after = "package spike;\npublic class Greeter { int aaa() { return 2; } }\n";
    assert.equal(
      Buffer.byteLength(after),
      Buffer.byteLength(before),
      "the fixture is only meaningful if both revisions occupy the same number of bytes",
    );

    // Written before start() so the watcher's own start-up scan is the picture the diff runs against.
    writeFileSync(fixture.greeter, before);
    utimesSync(fixture.greeter, baselineTime, baselineTime);
    await fixture.watcher.start();
    await awaitWatchStreamLive(fixture.watcher, fixture.projectRoot);
    const settledStat = statSync(fixture.greeter);
    assert.deepEqual(
      fixture.sink.changes(),
      [],
      "nothing may have been reported yet: the baseline revision predates the watch",
    );

    // The write under test: same path, same byte count, no temp file, no rename.
    writeFileSync(fixture.greeter, after);

    const rewrittenStat = statSync(fixture.greeter);
    assert.equal(
      rewrittenStat.ino,
      settledStat.ino,
      "an in-place write must keep the inode, or this case is not isolating the mtime",
    );
    assert.equal(rewrittenStat.size, settledStat.size, "size must be identical across the rewrite");
    assert.notEqual(
      rewrittenStat.mtimeMs,
      settledStat.mtimeMs,
      "the mtime must be the one field that moved, or this case proves nothing",
    );

    await waitUntil(
      "the mtime-only rewrite reported as a change",
      () => fixture.sink.changesFor(fixture.greeter).length > 0,
    );
    assert.deepEqual(
      fixture.sink.changesFor(fixture.greeter).map((change) => change.type),
      [FileChangeType.Changed],
      "size and inode are identical here: only the mtime separates the two revisions",
    );
  },
);

// The mirror image: content of a different length arriving with the mtime deliberately preserved.
// `cp -p`, `rsync --times`, `tar -x` and `git checkout` of a file whose timestamp was recorded all
// restore the source mtime, so a build step or a branch switch can leave a file whose only moved
// field is its size. `utimesSync` back to the frozen baseline reproduces that exactly.
test(
  "INV-SYNC-2: an in-place rewrite that changes only the size, with the mtime restored, is still reported as Changed",
  { timeout: CASE_TIMEOUT_MS },
  async (t) => {
    const fixture = await makeFixture(t, { autoStart: false });
    const baselineTime = new Date(1_700_000_000_000);
    const before = "package spike;\npublic class Greeter { int aaa() { return 1; } }\n";
    const after = "package spike;\npublic class Greeter { int aaa() { return 1; } int bbb() { return 2; } }\n";
    assert.notEqual(
      Buffer.byteLength(after),
      Buffer.byteLength(before),
      "the fixture is only meaningful if the two revisions differ in byte count",
    );

    writeFileSync(fixture.greeter, before);
    utimesSync(fixture.greeter, baselineTime, baselineTime);
    await fixture.watcher.start();
    await awaitWatchStreamLive(fixture.watcher, fixture.projectRoot);
    const settledStat = statSync(fixture.greeter);
    assert.deepEqual(
      fixture.sink.changes(),
      [],
      "nothing may have been reported yet: the baseline revision predates the watch",
    );

    // Both statements are synchronous with no await between them, so no debounce timer can fire in
    // the gap: the watcher can only ever scan the finished state, with the mtime already restored.
    writeFileSync(fixture.greeter, after);
    utimesSync(fixture.greeter, baselineTime, baselineTime);

    const rewrittenStat = statSync(fixture.greeter);
    assert.equal(
      rewrittenStat.ino,
      settledStat.ino,
      "an in-place write must keep the inode, or this case is not isolating the size",
    );
    assert.equal(
      rewrittenStat.mtimeMs,
      settledStat.mtimeMs,
      "the mtime must have been restored exactly, or this case is not isolating the size",
    );
    assert.notEqual(rewrittenStat.size, settledStat.size, "the size must be the one field that moved");

    await waitUntil(
      "the size-only rewrite reported as a change",
      () => fixture.sink.changesFor(fixture.greeter).length > 0,
    );
    assert.deepEqual(
      fixture.sink.changesFor(fixture.greeter).map((change) => change.type),
      [FileChangeType.Changed],
      "mtime and inode are identical here: only the size separates the two revisions",
    );
  },
);

// --- A deleted pom is a pom change ---------------------------------------------------------------
//
// INV-SYNC-3 says a pom.xml change ALWAYS triggers a refresh, and deleting a module's pom is the
// largest project-model change there is: the module leaves the build. The implementation has a
// dedicated branch for it — a deleted pom cannot be re-read at its own uri, so the refresh is routed
// through the project's root pom instead — but no case above ever deletes one, so suppressing the
// refresh for deletions outright changes nothing observable. Both halves are asserted here: the
// refresh must be aimed at a pom the server can still read, AND the deletion must also arrive as an
// ordinary Deleted watched-file notification.
test(
  "INV-SYNC-3: deleting a module's pom.xml still triggers a refresh, routed through the root pom",
  { timeout: CASE_TIMEOUT_MS },
  async (t) => {
    const fixture = await makeReactorFixture(t);

    rmSync(fixture.modulePom);

    await waitUntil(
      "the deleted module pom triggered a refresh",
      () => fixture.sink.refreshedUris().length > 0,
    );
    assert.deepEqual(
      fixture.sink.refreshedUris(),
      [pathToFileURL(fixture.rootPom).href],
      "the deleted pom's own uri no longer names anything readable, so the refresh must name the root pom",
    );

    await waitUntil("the watcher settled", () => fixture.watcher.isQuiescent());
    assert.deepEqual(
      fixture.sink.changesFor(fixture.modulePom).map((change) => change.type),
      [FileChangeType.Deleted],
      "the refresh is in addition to, not instead of, the Deleted watched-file notification",
    );
    assert.deepEqual(
      fixture.sink.changesFor(fixture.rootPom),
      [],
      "the root pom is only the refresh target; it did not itself change and must not be reported",
    );
  },
);

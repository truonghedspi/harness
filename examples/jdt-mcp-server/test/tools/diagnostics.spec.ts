// Level-1 oracle for feat-tool-diagnostics.
//
// Falsifier under test: "a URI that has never received a publish returns THE SAME empty list as a
// URI for which JDT LS reported zero problems, rather than a distinct ‘not reported’ marker [INV-DIAG-1]."
//
// java_diagnostics differs from the three navigation tools because it never emits an LSP request: it
// reads a push cache (harness/docs/design/tool-surface.md, Build order item 4). This file therefore
// injects two fakes—a workspace facade and a cache reader—and uses no real JDT LS.
//
// Load-bearing point: “not reported” and “reported empty” must be distinguishable IN CODE. Every
// assertion below reads `status` and the PRESENCE of `problems`; none relies on visual inspection.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  javaDiagnostics,
  type DiagnosticsFacade,
  type DiagnosticsReader,
  type DiagnosticsScope,
  type FileDiagnostics,
} from "../../src/tools/diagnostics.ts";
import type {
  Diagnostic,
  DiagnosticsLookup,
  DiagnosticsReport,
} from "../../src/lsp/diagnostics-cache.ts";
import type { WorkspaceAvailability } from "../../src/tools/tool-layer.ts";

const CASE_TIMEOUT = 5_000;

const WORKSPACE_ID = "ws-demo";
const PROJECT_PATH = "/tmp/demo";

const NEVER_PUBLISHED_PATH = "/tmp/demo/src/main/java/demo/Untouched.java";
const CLEAN_PATH = "/tmp/demo/src/main/java/demo/Clean.java";
const BROKEN_PATH = "/tmp/demo/src/main/java/demo/Broken.java";

const NEVER_PUBLISHED_URI = "file:///tmp/demo/src/main/java/demo/Untouched.java";
const CLEAN_URI = "file:///tmp/demo/src/main/java/demo/Clean.java";
const BROKEN_URI = "file:///tmp/demo/src/main/java/demo/Broken.java";
// A URI JDT LS published but the project file list does not name—the project-wide result must still
// contain it, or a real problem disappears from the answer.
const GENERATED_URI = "file:///tmp/demo/target/generated-sources/demo/Generated.java";

/** A raw Diagnostic exactly as LSP sends it: 0-based line and column. */
function rawDiagnostic(line: number, character: number, message: string, severity = 1): Diagnostic {
  return {
    range: {
      start: { line, character },
      end: { line, character: character + 4 },
    },
    message,
    severity,
    source: "Java",
    code: "cannot-resolve",
  };
}

const BROKEN_DIAGNOSTIC = rawDiagnostic(4, 10, "Greeterr cannot be resolved to a type");
const GENERATED_DIAGNOSTIC = rawDiagnostic(0, 0, "The value of the field x is not used", 2);

interface FakeCacheOptions {
  /** Only URIs present here count as having received a publish. */
  reports?: Record<string, { diagnostics: Diagnostic[]; version?: number; receivedAt?: number }>;
}

interface FakeCache extends DiagnosticsReader {
  /** Times the tool layer touches cache—allows the “cache was never read” assertion. */
  reads(): number;
}

function fakeCache(options: FakeCacheOptions = {}): FakeCache {
  const reports = options.reports ?? {};
  let reads = 0;

  function reportOf(uri: string): DiagnosticsReport | undefined {
    const stored = reports[uri];
    if (stored === undefined) return undefined;
    return {
      uri,
      version: stored.version,
      diagnostics: stored.diagnostics,
      receivedAt: stored.receivedAt ?? 1_700_000_000_000,
    };
  }

  return {
    get(workspaceId: string, uri: string): DiagnosticsLookup {
      reads += 1;
      assert.equal(workspaceId, WORKSPACE_ID, "INV-DIAG-3: cache must be queried with the routed workspace");
      const report = reportOf(uri);
      if (report === undefined) return { reported: false, uri };
      return { reported: true, ...report };
    },
    list(workspaceId: string): readonly DiagnosticsReport[] {
      reads += 1;
      assert.equal(workspaceId, WORKSPACE_ID, "INV-DIAG-3: cache must be queried with the routed workspace");
      return Object.keys(reports)
        .map((uri) => reportOf(uri))
        .filter((report): report is DiagnosticsReport => report !== undefined);
    },
    reads(): number {
      return reads;
    },
  };
}

interface FakeFacadeOptions {
  availability?: WorkspaceAvailability;
  scopes?: Record<string, DiagnosticsScope>;
  projectFiles?: readonly string[];
}

function fakeFacade(options: FakeFacadeOptions = {}): DiagnosticsFacade {
  const availability: WorkspaceAvailability = options.availability ?? {
    status: "ready",
    workspaceId: WORKSPACE_ID,
  };
  const scopes: Record<string, DiagnosticsScope> = options.scopes ?? {
    [PROJECT_PATH]: { kind: "project" },
    [NEVER_PUBLISHED_PATH]: { kind: "file", uri: NEVER_PUBLISHED_URI },
    [CLEAN_PATH]: { kind: "file", uri: CLEAN_URI },
    [BROKEN_PATH]: { kind: "file", uri: BROKEN_URI },
  };
  const projectFiles = options.projectFiles ?? [NEVER_PUBLISHED_URI, CLEAN_URI, BROKEN_URI];

  return {
    workspace(): WorkspaceAvailability {
      return availability;
    },
    scopeOf(path: string): DiagnosticsScope | undefined {
      return scopes[path];
    },
    projectFiles(): readonly string[] {
      return projectFiles;
    },
  };
}

/** Extract exactly one entry from a successful answer; any failure makes the case red here. */
async function singleEntry(
  facade: DiagnosticsFacade,
  reader: DiagnosticsReader,
  path: string,
): Promise<FileDiagnostics> {
  const outcome = await javaDiagnostics(facade, reader, { path });
  assert.equal(outcome.isError, false, `java_diagnostics must succeed for ${path}`);
  if (outcome.isError) throw new Error("unreachable");
  assert.equal(outcome.value.scope, "file");
  assert.equal(outcome.value.workspaceId, WORKSPACE_ID);
  assert.equal(outcome.value.files.length, 1, "a single-file scope must return exactly one entry");
  const entry = outcome.value.files[0];
  assert.ok(entry !== undefined);
  return entry;
}

/**
 * Reduce an entry to a primitive value that CODE can read. This is the shape a real agent branches
 * on: if “not reported” and “clean” reduce to one value, INV-DIAG-1 has failed.
 */
function decide(entry: FileDiagnostics): string {
  return entry.status === "reported" ? `clean-or-broken:${entry.problems.length}` : "unknown";
}

test("a URI with no publish has a ‘not reported’ marker, not an empty list [INV-DIAG-1]", { timeout: CASE_TIMEOUT }, async () => {
  const reader = fakeCache({ reports: { [CLEAN_URI]: { diagnostics: [] } } });
  const entry = await singleEntry(fakeFacade(), reader, NEVER_PUBLISHED_PATH);

  assert.equal(entry.uri, NEVER_PUBLISHED_URI);
  assert.equal(entry.status, "not-reported");
  // `problems` must be ABSENT: an empty array here is the incorrect answer described by the falsifier.
  assert.equal("problems" in entry, false, "a ‘not reported’ marker must not carry a problem list");
  assert.equal(decide(entry), "unknown");
  assert.ok(reader.reads() > 0, "the tool layer must actually query cache");
});

test("a published URI with an empty list is truly CLEAN, not ‘not reported’ [INV-DIAG-1]", { timeout: CASE_TIMEOUT }, async () => {
  const reader = fakeCache({ reports: { [CLEAN_URI]: { diagnostics: [], version: 7, receivedAt: 42 } } });
  const facade = fakeFacade();

  const clean = await singleEntry(facade, reader, CLEAN_PATH);
  const unknown = await singleEntry(facade, reader, NEVER_PUBLISHED_PATH);

  assert.equal(clean.status, "reported");
  assert.ok(clean.status === "reported");
  assert.deepEqual([...clean.problems], [], "a clean URI must return a TRULY EMPTY problem list");
  assert.equal(clean.version, 7);
  assert.equal(clean.receivedAt, 42);
  assert.equal(decide(clean), "clean-or-broken:0");

  // The cases differ only in whether cache received a publish; code must distinguish their results.
  assert.notEqual(clean.status, unknown.status);
  assert.notEqual(decide(clean), decide(unknown));
  assert.notDeepStrictEqual(clean, unknown);
});

test("a URI with a real problem returns exact content with 1-based coordinates", { timeout: CASE_TIMEOUT }, async () => {
  const reader = fakeCache({ reports: { [BROKEN_URI]: { diagnostics: [BROKEN_DIAGNOSTIC] } } });
  const entry = await singleEntry(fakeFacade(), reader, BROKEN_PATH);

  assert.ok(entry.status === "reported");
  assert.equal(entry.problems.length, 1);
  const problem = entry.problems[0];
  assert.ok(problem !== undefined);
  assert.equal(problem.message, "Greeterr cannot be resolved to a type");
  assert.equal(problem.severity, 1);
  assert.equal(problem.source, "Java");
  assert.equal(problem.code, "cannot-resolve");
  // LSP 0-based (4, 10)–(4, 14) → published 1-based (5, 11)–(5, 15), exactly one conversion boundary.
  assert.deepEqual(problem.range, {
    start: { line: 5, column: 11 },
    end: { line: 5, column: 15 },
  });
  assert.equal(decide(entry), "clean-or-broken:1");
});

test("a project-wide scope preserves the distinction for EACH URI", { timeout: CASE_TIMEOUT }, async () => {
  const reader = fakeCache({
    reports: {
      [CLEAN_URI]: { diagnostics: [] },
      [BROKEN_URI]: { diagnostics: [BROKEN_DIAGNOSTIC] },
      [GENERATED_URI]: { diagnostics: [GENERATED_DIAGNOSTIC] },
    },
  });

  const outcome = await javaDiagnostics(fakeFacade(), reader, { path: PROJECT_PATH });
  assert.equal(outcome.isError, false);
  if (outcome.isError) throw new Error("unreachable");
  assert.equal(outcome.value.scope, "project");

  const byUri = new Map(outcome.value.files.map((entry) => [entry.uri, entry] as const));
  assert.deepEqual(
    [...byUri.keys()].sort(),
    [BROKEN_URI, CLEAN_URI, GENERATED_URI, NEVER_PUBLISHED_URI].sort(),
    "the project-wide result must unite project files with every URI cache received",
  );

  const untouched = byUri.get(NEVER_PUBLISHED_URI);
  const clean = byUri.get(CLEAN_URI);
  const broken = byUri.get(BROKEN_URI);
  const generated = byUri.get(GENERATED_URI);
  assert.ok(untouched !== undefined && clean !== undefined);
  assert.ok(broken !== undefined && generated !== undefined);

  assert.equal(untouched.status, "not-reported");
  assert.equal("problems" in untouched, false);

  assert.ok(clean.status === "reported");
  assert.deepEqual([...clean.problems], []);

  assert.ok(broken.status === "reported");
  assert.equal(broken.problems.length, 1);
  assert.equal(broken.problems[0]?.message, "Greeterr cannot be resolved to a type");

  assert.ok(generated.status === "reported");
  assert.equal(generated.problems[0]?.severity, 2);

  // Project-wide aggregation must remain distinguishable in code, not only by sight.
  assert.deepEqual(
    [...byUri.entries()].map(([uri, entry]) => [uri, decide(entry)] as const).sort(),
    [
      [BROKEN_URI, "clean-or-broken:1"],
      [CLEAN_URI, "clean-or-broken:0"],
      [GENERATED_URI, "clean-or-broken:1"],
      [NEVER_PUBLISHED_URI, "unknown"],
    ].sort(),
  );
});

test("a workspace that is not ready is a named error, not a clean project [INV-TOOL-4]", { timeout: CASE_TIMEOUT }, async () => {
  const reader = fakeCache({ reports: { [CLEAN_URI]: { diagnostics: [] } } });
  const facade = fakeFacade({
    availability: { status: "not-ready", detail: "still indexing", progress: { percent: 40 } },
  });

  const outcome = await javaDiagnostics(facade, reader, { path: PROJECT_PATH });
  assert.equal(outcome.isError, true);
  if (!outcome.isError) throw new Error("unreachable");
  assert.equal(outcome.code, "not-ready");
  assert.match(outcome.message, /^not-ready: /);
  assert.deepEqual(outcome.detail, { percent: 40 });
  // Empty cache plus a workspace still indexing reads like “no errors” if the tool layer queries
  // cache first; therefore “cache was never touched” is measurable.
  assert.equal(reader.reads(), 0, "cache must not be read while the workspace is not ready");
});

test("an unroutable path is a named error, not an empty result [INV-TOOL-4]", { timeout: CASE_TIMEOUT }, async () => {
  const reader = fakeCache();
  const outcome = await javaDiagnostics(fakeFacade(), reader, { path: "/tmp/elsewhere/Foo.java" });

  assert.equal(outcome.isError, true);
  if (!outcome.isError) throw new Error("unreachable");
  assert.equal(outcome.code, "unroutable");
  assert.equal(reader.reads(), 0);
});

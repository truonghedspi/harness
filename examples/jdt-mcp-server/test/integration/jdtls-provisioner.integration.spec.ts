// Traceability (skills/test-design/SKILL.md, role: Test-Implementer).
//
//   plan_id:  TP-PROV-0001               (harness/tests/design/plans/TP-PROV-0001/)
//   feature:  feat-prove-provisioner     (harness/feature_list.json)
//   conditions / requirements implemented in this file:
//     TCON-PROV-0001  INV-PROV-1   JVM major-version boundary (20 refuses / 21 & 25 proceed)
//     TCON-PROV-0002  INV-PROV-1   Java-17 refusal names the required version, not a generic/raw error
//     TCON-PROV-0003  INV-PROV-2   cache state (matching/stale/tampered) never reports a non-pin version
//     TCON-PROV-0004  INV-PROV-3   JDTLS_HOME override wins over a sibling valid cache, zero network either way
//     TCON-PROV-0005  INV-PROV-3   invalid JDTLS_HOME names the checked path and the missing launcher jar
//     TCON-PROV-0006  INV-PROV-4   empty cache + blackholed egress: always settles inside the deadline
//     TCON-PROV-0007  INV-PROV-4   same scenario: error names the pin, the host, and JDTLS_HOME
//     TCON-PROV-0008  INV-PROV-2   empty cache downloads, verifies, extracts, and installs the pin
//
// Spec refs: docs/design/runtime-model.md#INV-PROV-1..4, docs/assumptions.md#A-005, #A-015.
//
// Per the test-implementer boundary, this file does not read src/provision/*.ts — it exists to
// establish the oracle. src/provision/jdtls-provisioner.ts does not exist yet (feat-jdtls-provisioner
// is not-started); every test below is expected to fail on module resolution until the maker adds it.
//
// Expected contract this file exercises (the maker implements to satisfy it, not the other way
// round):
//
//   export const PINNED_JDTLS_VERSION: string;
//   export const PROVISION_DEADLINE_MS: number;
//   export function resolveInstall(options: {
//     cacheDir: string;             // on-disk cache root; always injected by tests for hermeticity
//     fetchImpl?: typeof fetch;     // injectable HTTP client — the network system boundary
//     deadlineMs?: number;          // injectable deadline — the clock system boundary
//   }): Promise<{ installDir: string; version: string; javaPath: string }>;
//
// JAVA_HOME and JDTLS_HOME are read from process.env, matching every other JVM tool's convention
// and the design's own stated observable seam ("run with JAVA_HOME pointing at...", "with JDTLS_HOME
// set..." — docs/design/runtime-model.md).
//
// Real JVM version detection is exercised through a stubbed `java` executable that answers
// `java -version` the way a real JDK does (banner on stderr, exit 0) — per this feature's own
// context note, a mock of resolveInstall() itself cannot falsify INV-PROV-1's named-message
// requirement, so the JVM boundary is a real subprocess, not a mock.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  resolveInstall,
  PINNED_JDTLS_VERSION,
  PROVISION_DEADLINE_MS,
} from "../../src/provision/jdtls-provisioner.ts";

// A short, test-local deadline so TCON-PROV-0006/0007 don't have to wait out the real production
// deadline (PROVISION_DEADLINE_MS) to prove the bound is honored — deadline is the clock boundary,
// sanctioned for injection like network and filesystem.
const TEST_DEADLINE_MS = 3_000;

// ---------------------------------------------------------------------------------------------
// Fixture helpers — build real files on disk per test, cleaned up via t.after().
// ---------------------------------------------------------------------------------------------

function makeTempRoot(prefix: string): string {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

/** A real, executable `java` that answers `-version` like a real JDK of the given major version. */
function makeFakeJdk(root: string, majorVersion: number): string {
  const javaHome = path.join(root, `jdk-${majorVersion}`);
  const binDir = path.join(javaHome, "bin");
  mkdirSync(binDir, { recursive: true });
  const javaBin = path.join(binDir, "java");
  const build = `${majorVersion}.0.1+9`;
  const script =
    "#!/bin/sh\n" +
    `echo 'openjdk version "${majorVersion}.0.1" 2024-01-16' 1>&2\n` +
    `echo 'OpenJDK Runtime Environment Temurin-${build} (build ${build})' 1>&2\n` +
    `echo 'OpenJDK 64-Bit Server VM Temurin-${build} (build ${build}, mixed mode, sharing)' 1>&2\n` +
    "exit 0\n";
  writeFileSync(javaBin, script, { mode: 0o755 });
  chmodSync(javaBin, 0o755);
  return javaHome;
}

/** A cache/install dir with a resolvable `plugins/org.eclipse.jdt.ls.core_<version>.jar` under it. */
function makeLauncherCache(dir: string, jarVersion: string): void {
  const pluginsDir = path.join(dir, "plugins");
  mkdirSync(pluginsDir, { recursive: true });
  const jarPath = path.join(pluginsDir, `org.eclipse.jdt.ls.core_${jarVersion}.jar`);
  writeFileSync(jarPath, Buffer.from("PKnot-a-real-jar-just-a-fixture"));
}

/** An existing directory holding nothing resolvable as a JDT LS launcher jar. */
function makeEmptyDir(root: string, name: string): string {
  const dir = path.join(root, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

const throwingFetch = (async () => {
  throw new Error("egress disabled for this test (network is not the thing under test here)");
}) as typeof fetch;

function countingFetch(inner: typeof fetch): { fetchImpl: typeof fetch; count: () => number } {
  let calls = 0;
  const wrapped = (async (...args: Parameters<typeof fetch>) => {
    calls++;
    return inner(...args);
  }) as typeof fetch;
  return { fetchImpl: wrapped, count: () => calls };
}

/** Connections that never complete and never error — a true network blackhole, unless aborted. */
function makeBlackholeFetch(): { fetchImpl: typeof fetch; lastUrl: () => string | undefined } {
  let lastUrl: string | undefined;
  const wrapped = ((input: unknown, init?: { signal?: AbortSignal }) => {
    lastUrl =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : ((input as { url?: string })?.url ?? String(input));
    return new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) return; // nothing to ever settle this — true blackhole
      if (signal.aborted) {
        reject(signal.reason ?? new DOMException("aborted", "AbortError"));
        return;
      }
      signal.addEventListener(
        "abort",
        () => reject(signal.reason ?? new DOMException("aborted", "AbortError")),
        { once: true },
      );
    });
  }) as typeof fetch;
  return { fetchImpl: wrapped, lastUrl: () => lastUrl };
}

function withEnv(t: { after: (fn: () => void) => void }, vars: Record<string, string | undefined>): void {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) {
    previous[key] = process.env[key];
    const value = vars[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  t.after(() => {
    for (const key of Object.keys(previous)) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

// ---------------------------------------------------------------------------------------------
// TCON-PROV-0001 — INV-PROV-1: JVM major-version boundary (decision table, boundary values)
// ---------------------------------------------------------------------------------------------

test("TCON-PROV-0001: refuses and never resolves an install when JAVA_HOME's JVM is major version 20 (just below the floor)", async (t) => {
  const root = makeTempRoot("jdtls-prov-0001-20-");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const javaHome = makeFakeJdk(root, 20);
  const cacheDir = path.join(root, "cache");
  makeLauncherCache(cacheDir, PINNED_JDTLS_VERSION); // valid cache present — proves the JVM gate isn't bypassed by it
  withEnv(t, { JAVA_HOME: javaHome, JDTLS_HOME: undefined });

  await assert.rejects(
    () => resolveInstall({ cacheDir, fetchImpl: throwingFetch }),
    /.+/,
    "a Java 20 JVM must never resolve an install, even with a valid pinned cache already on disk",
  );
});

test("TCON-PROV-0001: proceeds and resolves the pinned install when JAVA_HOME's JVM is exactly major version 21 (the floor)", async (t) => {
  const root = makeTempRoot("jdtls-prov-0001-21-");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const javaHome = makeFakeJdk(root, 21);
  const cacheDir = path.join(root, "cache");
  makeLauncherCache(cacheDir, PINNED_JDTLS_VERSION);
  withEnv(t, { JAVA_HOME: javaHome, JDTLS_HOME: undefined });

  const result = await resolveInstall({ cacheDir, fetchImpl: throwingFetch });
  assert.equal(result.version, PINNED_JDTLS_VERSION);
  assert.equal(result.installDir, cacheDir);
  assert.equal(result.javaPath, path.join(javaHome, "bin", "java"));
});

test("TCON-PROV-0001: proceeds and resolves the pinned install when JAVA_HOME's JVM is major version 25 (above the floor)", async (t) => {
  const root = makeTempRoot("jdtls-prov-0001-25-");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const javaHome = makeFakeJdk(root, 25);
  const cacheDir = path.join(root, "cache");
  makeLauncherCache(cacheDir, PINNED_JDTLS_VERSION);
  withEnv(t, { JAVA_HOME: javaHome, JDTLS_HOME: undefined });

  const result = await resolveInstall({ cacheDir, fetchImpl: throwingFetch });
  assert.equal(result.version, PINNED_JDTLS_VERSION);
  assert.equal(result.installDir, cacheDir);
  assert.equal(result.javaPath, path.join(javaHome, "bin", "java"));
});

// ---------------------------------------------------------------------------------------------
// TCON-PROV-0002 — INV-PROV-1: the documented Java-17 scenario names the required version
// ---------------------------------------------------------------------------------------------

test("TCON-PROV-0002: refusing a Java 17 JVM names the required version and is never a generic or raw JDT LS crash", async (t) => {
  const root = makeTempRoot("jdtls-prov-0002-");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const javaHome = makeFakeJdk(root, 17);
  const cacheDir = path.join(root, "cache");
  makeLauncherCache(cacheDir, PINNED_JDTLS_VERSION);
  withEnv(t, { JAVA_HOME: javaHome, JDTLS_HOME: undefined });

  await assert.rejects(
    () => resolveInstall({ cacheDir, fetchImpl: throwingFetch }),
    (err: unknown) => {
      assert.ok(err instanceof Error, "must reject with an Error, not a raw value");
      const message = (err as Error).message;
      assert.notEqual(message.trim().length, 0, "error must not be empty");
      assert.match(message, /\b21\b/, `error must explicitly name the required Java version (21); got: ${message}`);
      assert.doesNotMatch(
        message,
        /Exception in thread|\.java:\d+\)|StackOverflowError|OutOfMemoryError|at\s+org\.eclipse/i,
        "error must not be JDT LS's own raw crash/stack-trace output",
      );
      return true;
    },
  );
});

// ---------------------------------------------------------------------------------------------
// TCON-PROV-0003 — INV-PROV-2: cache state never yields a reported version other than the pin
// ---------------------------------------------------------------------------------------------

const CACHE_STATE_CASES: ReadonlyArray<{ label: string; version: string; mustSucceed: boolean }> = [
  { label: "matching the pin", version: PINNED_JDTLS_VERSION, mustSucceed: true },
  { label: "stale (a prior valid pin)", version: "1.60.0.202601010000", mustSucceed: false },
  { label: "tampered (bogus version marker)", version: "0.0.0.TAMPERED", mustSucceed: false },
];

for (const { label, version, mustSucceed } of CACHE_STATE_CASES) {
  test(`TCON-PROV-0003: cache state "${label}" never resolves reporting a version other than the pin`, async (t) => {
    const root = makeTempRoot("jdtls-prov-0003-");
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const javaHome = makeFakeJdk(root, 21);
    const cacheDir = path.join(root, "cache");
    makeLauncherCache(cacheDir, version);
    withEnv(t, { JAVA_HOME: javaHome, JDTLS_HOME: undefined });

    if (mustSucceed) {
      // Rules out an always-fail resolveInstall vacuously "satisfying" the other two cases.
      const result = await resolveInstall({ cacheDir, fetchImpl: throwingFetch });
      assert.equal(result.version, PINNED_JDTLS_VERSION, "a cache already matching the pin must resolve to exactly that version");
      return;
    }

    // Either outcome is acceptable — reject outright, or (if it somehow still succeeds) report
    // nothing but the pin. What's never acceptable is succeeding with the cache's own version.
    let result: { version: string } | undefined;
    let threw = false;
    try {
      result = await resolveInstall({ cacheDir, fetchImpl: throwingFetch });
    } catch {
      threw = true;
    }
    if (!threw) {
      assert.notEqual(result?.version, version, `must never report the ${label} cache's own version (${version}) as current`);
      assert.equal(result?.version, PINNED_JDTLS_VERSION, `if it succeeds despite a ${label} cache, the reported version must still be the pin`);
    }
  });
}

// ---------------------------------------------------------------------------------------------
// TCON-PROV-0004 — INV-PROV-3: JDTLS_HOME override vs. a simultaneously valid, pinned cache
// ---------------------------------------------------------------------------------------------

test("TCON-PROV-0004: a valid JDTLS_HOME resolves to that directory with zero outbound requests, even with a valid pinned cache also on disk", async (t) => {
  const root = makeTempRoot("jdtls-prov-0004-valid-");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const javaHome = makeFakeJdk(root, 21);
  const jdtlsHome = path.join(root, "override");
  makeLauncherCache(jdtlsHome, "9.99.9.override-not-the-pin"); // deliberately not the pin: proves override wins on its own terms
  const siblingCacheDir = path.join(root, "cache");
  makeLauncherCache(siblingCacheDir, PINNED_JDTLS_VERSION); // valid, pinned, sitting right there
  withEnv(t, { JAVA_HOME: javaHome, JDTLS_HOME: jdtlsHome });
  const { fetchImpl, count } = countingFetch(throwingFetch);

  const result = await resolveInstall({ cacheDir: siblingCacheDir, fetchImpl });

  assert.equal(result.installDir, jdtlsHome, "JDTLS_HOME must win over a simultaneously valid, pinned sibling cache");
  assert.equal(count(), 0, "a valid JDTLS_HOME override must never trigger a network request");
});

test("TCON-PROV-0004: an invalid JDTLS_HOME fails closed with zero outbound requests and never substitutes the sibling cache", async (t) => {
  const root = makeTempRoot("jdtls-prov-0004-invalid-");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const javaHome = makeFakeJdk(root, 21);
  const jdtlsHome = makeEmptyDir(root, "override"); // no plugins/, no launcher jar at all
  const siblingCacheDir = path.join(root, "cache");
  makeLauncherCache(siblingCacheDir, PINNED_JDTLS_VERSION);
  withEnv(t, { JAVA_HOME: javaHome, JDTLS_HOME: jdtlsHome });
  const { fetchImpl, count } = countingFetch(throwingFetch);

  await assert.rejects(
    () => resolveInstall({ cacheDir: siblingCacheDir, fetchImpl }),
    /.+/,
    "an invalid JDTLS_HOME must fail closed, never silently resolve from the sibling cache",
  );
  assert.equal(count(), 0, "an invalid JDTLS_HOME must never trigger a network request either");
});

// ---------------------------------------------------------------------------------------------
// TCON-PROV-0005 — INV-PROV-3: invalid JDTLS_HOME names the path and the missing artifact
// ---------------------------------------------------------------------------------------------

test("TCON-PROV-0005: an invalid JDTLS_HOME's error names the checked path and the missing launcher jar, never a generic or raw error", async (t) => {
  const root = makeTempRoot("jdtls-prov-0005-");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const javaHome = makeFakeJdk(root, 21);
  const jdtlsHome = makeEmptyDir(root, "override");
  const cacheDir = path.join(root, "cache");
  makeLauncherCache(cacheDir, PINNED_JDTLS_VERSION);
  withEnv(t, { JAVA_HOME: javaHome, JDTLS_HOME: jdtlsHome });

  await assert.rejects(
    () => resolveInstall({ cacheDir, fetchImpl: throwingFetch }),
    (err: unknown) => {
      assert.ok(err instanceof Error, "must reject with an Error, not a raw value");
      const message = (err as Error).message;
      assert.ok(message.includes(jdtlsHome), `error must name the JDTLS_HOME path that was checked (${jdtlsHome}); got: ${message}`);
      assert.match(
        message,
        /org\.eclipse\.jdt\.ls\.core/,
        `error must name what was missing (a resolvable org.eclipse.jdt.ls.core_* launcher jar); got: ${message}`,
      );
      assert.doesNotMatch(message, /ENOENT|at\s+\S+\s+\(.*:\d+:\d+\)/, "error must not be a raw filesystem/stack-trace error");
      return true;
    },
  );
});

// ---------------------------------------------------------------------------------------------
// TCON-PROV-0006 — INV-PROV-4: empty cache + blackholed egress always settles inside the deadline
// ---------------------------------------------------------------------------------------------

test(
  "TCON-PROV-0006: with an empty cache and blackholed egress, resolveInstall always settles inside its configured deadline",
  { timeout: TEST_DEADLINE_MS + 20_000 }, // backstop: if the implementation never bounds the wait, node:test's own
  // per-test timeout fails this test with a clear "test timed out" reason rather than hanging the suite forever.
  async (t) => {
    const root = makeTempRoot("jdtls-prov-0006-");
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const javaHome = makeFakeJdk(root, 21);
    const cacheDir = makeEmptyDir(root, "cache"); // empty: nothing cached, nothing pinned yet
    withEnv(t, { JAVA_HOME: javaHome, JDTLS_HOME: undefined });
    const { fetchImpl } = makeBlackholeFetch();

    const startedAt = Date.now();
    try {
      await resolveInstall({ cacheDir, fetchImpl, deadlineMs: TEST_DEADLINE_MS });
    } catch {
      // Settling as a rejection is fine — TCON-PROV-0007 checks the content separately.
      // Only an unbounded hang is the defect this condition targets.
    }
    const elapsedMs = Date.now() - startedAt;

    assert.ok(
      elapsedMs <= TEST_DEADLINE_MS + 5_000,
      `must settle within the configured ${TEST_DEADLINE_MS}ms deadline (+slack); took ${elapsedMs}ms`,
    );
  },
);

// ---------------------------------------------------------------------------------------------
// TCON-PROV-0007 — INV-PROV-4: the settled error names the pin, the host, and JDTLS_HOME
// ---------------------------------------------------------------------------------------------

test(
  "TCON-PROV-0007: the empty-cache/unreachable-network error names the pinned version, the unreachable host, and JDTLS_HOME",
  { timeout: TEST_DEADLINE_MS + 20_000 },
  async (t) => {
    const root = makeTempRoot("jdtls-prov-0007-");
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const javaHome = makeFakeJdk(root, 21);
    const cacheDir = makeEmptyDir(root, "cache");
    withEnv(t, { JAVA_HOME: javaHome, JDTLS_HOME: undefined });
    const { fetchImpl, lastUrl } = makeBlackholeFetch();

    await assert.rejects(
      () => resolveInstall({ cacheDir, fetchImpl, deadlineMs: TEST_DEADLINE_MS }),
      (err: unknown) => {
        assert.ok(err instanceof Error, "must reject with an Error, not a raw value");
        const message = (err as Error).message;

        const url = lastUrl();
        assert.ok(url, "resolveInstall must actually attempt to reach the distribution host to be able to name it as unreachable");
        const host = new URL(url as string).host;

        assert.ok(message.includes(host), `error must name the unreachable host (${host}); got: ${message}`);
        assert.ok(message.includes(PINNED_JDTLS_VERSION), `error must name the pinned version (${PINNED_JDTLS_VERSION}); got: ${message}`);
        assert.match(message, /JDTLS_HOME/, `error must name JDTLS_HOME as the override escape hatch; got: ${message}`);
        return true;
      },
    );
  },
);

// ---------------------------------------------------------------------------------------------
// TCON-PROV-0008 — INV-PROV-2: empty-cache download, checksum, extraction, and installation
// ---------------------------------------------------------------------------------------------

test(
  "TCON-PROV-0008: an available pinned distribution is downloaded, checksum-verified, extracted, and installed from an empty cache",
  { timeout: 900_000 },
  async (t) => {
    const root = makeTempRoot("jdtls-prov-0008-");
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const javaHome = makeFakeJdk(root, 21);
    const cacheDir = makeEmptyDir(root, "cache");
    const requestedUrls: string[] = [];
    let downloadedArchive: Buffer | undefined;
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : input.toString();
      requestedUrls.push(url);
      const downloadPath = path.join(root, "controlled-source.tar.gz");
      let completed = false;
      for (let attempt = 0; attempt < 5 && !completed; attempt++) {
        const transfer = spawnSync(
          "curl",
          ["--fail", "--location", "--silent", "--show-error", "--continue-at", "-", "--max-time", "180", "--output", downloadPath, url],
          { encoding: "utf8" },
        );
        completed = transfer.status === 0;
        if (!completed && attempt === 4) {
          throw new Error(`controlled pinned-archive source did not complete: ${transfer.stderr}`);
        }
      }
      const body = readFileSync(downloadPath);
      downloadedArchive = body;
      return new Response(body, { status: 200 });
    }) as typeof fetch;
    withEnv(t, { JAVA_HOME: javaHome, JDTLS_HOME: undefined });

    const result = await resolveInstall({ cacheDir, fetchImpl, deadlineMs: TEST_DEADLINE_MS });

    assert.equal(result.version, PINNED_JDTLS_VERSION);
    assert.equal(result.installDir, cacheDir);
    assert.ok(requestedUrls.length > 0, "an empty cache must fetch the pinned distribution");
    assert.ok(downloadedArchive, "the controlled fetch boundary must capture the pinned archive bytes");

    const expectedDir = path.join(root, "independently-extracted");
    const archivePath = path.join(root, "downloaded-jdtls.tar.gz");
    mkdirSync(expectedDir);
    writeFileSync(archivePath, downloadedArchive);
    execFileSync("tar", ["-xzf", archivePath, "-C", expectedDir]);
    const expectedPlugins = path.join(expectedDir, "plugins");
    const installedPlugins = path.join(result.installDir, "plugins");
    const launcherName = readdirSync(expectedPlugins).find((name) => name.startsWith("org.eclipse.equinox.launcher_") && name.endsWith(".jar"));
    const coreName = readdirSync(expectedPlugins).find((name) => name.startsWith("org.eclipse.jdt.ls.core_") && name.endsWith(".jar"));
    assert.ok(launcherName, "the pinned archive must contain an Eclipse launcher jar");
    assert.ok(coreName, "the pinned archive must contain a JDT LS core jar");
    assert.deepEqual(readFileSync(path.join(installedPlugins, launcherName)), readFileSync(path.join(expectedPlugins, launcherName)));
    assert.deepEqual(readFileSync(path.join(installedPlugins, coreName)), readFileSync(path.join(expectedPlugins, coreName)));
  },
);

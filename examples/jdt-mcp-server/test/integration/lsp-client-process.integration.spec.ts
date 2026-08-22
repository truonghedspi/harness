// Level 3 (Microservice / process-boundary) integration oracle for feat-lsp-client.
//
// harness/docs/testing-standards.md requires any change that crosses a process boundary to be
// exercised through a real spawned child, not an in-process EventEmitter/PassThrough mock. The
// unit tests in test/lsp/lsp-client.spec.ts cover framing/correlation logic in isolation; this
// file re-proves the falsifier's actual claim — INV-POOL-3 — across a real Node-to-child stdio
// boundary: multiple requests genuinely in flight through real pipes, the child process really
// terminated, and every pending request settling as a rejection instead of hanging.
//
// The scripted child is materialized to a temp file at test run time (same approach as
// test/integration/jdtls-provisioner.integration.spec.ts's fake `java` binary) rather than
// checked in under test/, per testing-standards.md's note that any path containing a literal
// `test/` segment is swept into Node's default test discovery glob.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { LspClient, type LspProcess } from "../../src/lsp/lsp-client.ts";

// A real, separate Node process that speaks Content-Length-framed JSON-RPC over stdio, exactly
// like a real JDT LS would to the shim. It answers "quick" requests immediately and silently
// swallows "hang" requests (never responds) so the test can prove requests can be genuinely in
// flight when the process dies, not merely enqueued and instantly answered.
const CHILD_SCRIPT = `
let buffer = Buffer.alloc(0);
process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const separator = buffer.indexOf("\\r\\n\\r\\n");
    if (separator < 0) return;
    const header = buffer.subarray(0, separator).toString("ascii");
    const match = /Content-Length:\\s*(\\d+)/i.exec(header);
    if (!match) return;
    const bodyLength = Number.parseInt(match[1], 10);
    const frameEnd = separator + 4 + bodyLength;
    if (buffer.byteLength < frameEnd) return;
    const body = buffer.subarray(separator + 4, frameEnd);
    buffer = buffer.subarray(frameEnd);
    const message = JSON.parse(body.toString());
    if (message.method === "hang") continue; // deliberately never respond
    const responsePayload = Buffer.from(
      JSON.stringify({ jsonrpc: "2.0", id: message.id, result: "ok:" + message.method }),
    );
    process.stdout.write(
      Buffer.concat([Buffer.from("Content-Length: " + responsePayload.byteLength + "\\r\\n\\r\\n"), responsePayload]),
    );
  }
});
`;

function spawnScriptedChild(root: string): ChildProcess {
  const scriptPath = path.join(root, "scripted-lsp-child.cjs");
  writeFileSync(scriptPath, CHILD_SCRIPT);
  return spawn(process.execPath, [scriptPath], { stdio: ["pipe", "pipe", "inherit"] });
}

test(
  "a real spawned JDT LS process: framing/correlation hold over real stdio, and killing it mid-flight rejects every pending request [INV-POOL-3]",
  { timeout: 10_000 },
  async (t) => {
    const root = mkdtempSync(path.join(tmpdir(), "jdt-lsp-client-process-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));

    const child = spawnScriptedChild(root);
    t.after(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    });

    const client = new LspClient(child as unknown as LspProcess);

    // Prove framing + id-correlation actually work across the real child boundary before we ever
    // kill it — this is the "not vacuous" check for the falsifier below.
    const quick = client.request("quick");
    assert.equal(await quick, "ok:quick");

    // Two requests now genuinely in flight through a real pipe to a real, still-alive process
    // that will never answer them.
    const hangA = client.request("hang");
    const hangB = client.request("hang");

    // Terminate the real child process while those requests are pending.
    const killed = child.kill("SIGKILL");
    assert.ok(killed, "test fixture must be able to signal the real child process");

    await assert.rejects(
      hangA,
      /JDT LS process exited/,
      "a request in flight across a real process boundary must settle as a rejection, not hang, when the process dies",
    );
    await assert.rejects(
      hangB,
      /JDT LS process exited/,
      "every pending request must be rejected, not just the first one, when the real process dies",
    );

    // And the moment it has exited, any further request must reject immediately too.
    await assert.rejects(client.request("late"), /JDT LS process exited/);
  },
);

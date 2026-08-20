#!/usr/bin/env node
// THROWAWAY SPIKE — never imported by production code.
// Question it answers: what does it actually cost, on this machine, to bring ONE
// Eclipse JDT LS instance from cold to "answers a semantic query about a Maven
// project", and how much RSS does it hold while idle afterwards? The design rests
// on running N of these concurrently in one daemon, so the per-instance cost and
// the cold-start latency are load-bearing numbers, not trivia.
//
// Usage:
//   node spikes/jdtls-coldstart.mjs <jdtls-install-dir> <project-dir> [--data DIR] [--xmx 1G]
//
// Prints a JSON result line: { readyMs, hoverMs, rssMbAtIdle, hoverText }
//
// Framing note: LSP over stdio uses HTTP-style `Content-Length:` headers
// (base protocol), which is NOT the framing MCP stdio uses (newline-delimited,
// no embedded newlines). This spike implements the LSP side by hand precisely so
// the difference is proven rather than assumed.

import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [, , installDir, projectDir, ...rest] = process.argv;
if (!installDir || !projectDir) {
  console.error('usage: jdtls-coldstart.mjs <jdtls-install-dir> <project-dir> [--data DIR] [--xmx 1G]');
  process.exit(2);
}
const argOf = (flag, dflt) => {
  const i = rest.indexOf(flag);
  return i >= 0 ? rest[i + 1] : dflt;
};
const dataDir = argOf('--data', mkdtempSync(join(tmpdir(), 'jdtls-data-')));
const xmx = argOf('--xmx', '1G');

const pluginsDir = join(installDir, 'plugins');
const launcher = readdirSync(pluginsDir).find(
  (f) => f.startsWith('org.eclipse.equinox.launcher_') && f.endsWith('.jar'),
);
if (!launcher) throw new Error(`no equinox launcher jar in ${pluginsDir}`);

// -configuration is platform-specific; pick whichever this distribution ships.
const configName = ['config_mac_arm', 'config_mac', 'config_linux_arm', 'config_linux', 'config_win']
  .find((c) => existsSync(join(installDir, c)));
if (!configName) throw new Error(`no config_* directory in ${installDir}`);

const args = [
  '-Declipse.application=org.eclipse.jdt.ls.core.id1',
  '-Dosgi.bundles.defaultStartLevel=4',
  '-Declipse.product=org.eclipse.jdt.ls.core.product',
  '-Dlog.level=ERROR',
  `-Xmx${xmx}`,
  '--add-modules=ALL-SYSTEM',
  '--add-opens', 'java.base/java.util=ALL-UNNAMED',
  '--add-opens', 'java.base/java.lang=ALL-UNNAMED',
  '-jar', join(pluginsDir, launcher),
  '-configuration', join(installDir, configName),
  '-data', dataDir,
];

const t0 = Date.now();
const proc = spawn('java', args, { stdio: ['pipe', 'pipe', 'pipe'] });

let buf = Buffer.alloc(0);
const pending = new Map();
let nextId = 1;
let readyMs = null;
let projectOkMs = null;
const notes = [];

function send(msg) {
  const body = Buffer.from(JSON.stringify(msg), 'utf8');
  proc.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
  proc.stdin.write(body);
}
function request(method, params) {
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    send({ jsonrpc: '2.0', id, method, params });
  });
}
function notify(method, params) {
  send({ jsonrpc: '2.0', method, params });
}

proc.stdout.on('data', (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  for (;;) {
    const sep = buf.indexOf('\r\n\r\n');
    if (sep < 0) return;
    const header = buf.subarray(0, sep).toString('ascii');
    const m = /content-length:\s*(\d+)/i.exec(header);
    if (!m) throw new Error(`no Content-Length in header: ${header}`);
    const len = Number(m[1]);
    if (buf.length < sep + 4 + len) return;
    const body = buf.subarray(sep + 4, sep + 4 + len).toString('utf8');
    buf = buf.subarray(sep + 4 + len);
    let msg;
    try { msg = JSON.parse(body); } catch { continue; }
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    } else if (msg.method === 'language/status') {
      notes.push(`${msg.params?.type}: ${msg.params?.message}`);
      if (msg.params?.type === 'ServiceReady' && readyMs === null) readyMs = Date.now() - t0;
      if (msg.params?.type === 'ProjectStatus' && projectOkMs === null) projectOkMs = Date.now() - t0;
    } else if (msg.id !== undefined && msg.method) {
      // server->client request: answer the ones that block startup
      const result = msg.method === 'workspace/configuration'
        ? (msg.params?.items ?? []).map(() => ({}))
        : null;
      send({ jsonrpc: '2.0', id: msg.id, result });
    }
  }
});
proc.stderr.on('data', () => {});

const rootUri = pathToFileURL(projectDir).href;

async function main() {
  await request('initialize', {
    processId: process.pid,
    rootUri,
    workspaceFolders: [{ uri: rootUri, name: 'spike' }],
    capabilities: {
      workspace: { configuration: true, workspaceFolders: true, applyEdit: true },
      textDocument: {
        hover: { contentFormat: ['plaintext', 'markdown'] },
        publishDiagnostics: {},
        completion: { completionItem: { snippetSupport: false } },
        rename: { prepareSupport: true },
        codeAction: { codeActionLiteralSupport: { codeActionKind: { valueSet: ['quickfix', 'refactor'] } } },
      },
    },
    initializationOptions: { settings: { java: { autobuild: { enabled: true } } } },
  });
  notify('initialized', {});

  const deadline = Date.now() + 300_000;
  while (projectOkMs === null && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200));

  // Ask a semantic question that only a real index of THIS project can answer:
  // `g.greet(...)` resolves to spike/Greeter.java, not to anything in the JDK.
  const srcFile = join(projectDir, 'src/main/java/spike/App.java');
  const fileUri = pathToFileURL(srcFile).href;
  notify('textDocument/didOpen', {
    textDocument: { uri: fileUri, languageId: 'java', version: 1, text: (await import('node:fs')).readFileSync(srcFile, 'utf8') },
  });

  const pos = { line: 5, character: 30 }; // on `greet` in `g.greet("world")`
  const tHover = Date.now();
  let hover = null;
  let def = null;
  for (let i = 0; i < 60; i++) {
    hover = await request('textDocument/hover', { textDocument: { uri: fileUri }, position: pos });
    def = await request('textDocument/definition', { textDocument: { uri: fileUri }, position: pos });
    if (JSON.stringify(def?.result ?? '').includes('Greeter.java')) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  const hoverMs = Date.now() - tHover;
  const refs = await request('textDocument/references', {
    textDocument: { uri: fileUri }, position: pos, context: { includeDeclaration: true },
  });
  const renameEdit = await request('textDocument/rename', {
    textDocument: { uri: fileUri }, position: pos, newName: 'salute',
  });
  const actions = await request('textDocument/codeAction', {
    textDocument: { uri: fileUri },
    range: { start: pos, end: pos },
    context: { diagnostics: [] },
  });

  let rssMbAtIdle = null;
  try {
    const ps = spawn('ps', ['-o', 'rss=', '-p', String(proc.pid)]);
    rssMbAtIdle = await new Promise((res) => {
      let out = '';
      ps.stdout.on('data', (d) => (out += d));
      ps.on('close', () => res(Math.round(Number(out.trim()) / 1024)));
    });
  } catch { /* best effort */ }

  console.log(JSON.stringify({
    serviceReadyMs: readyMs,
    projectStatusOkMs: projectOkMs,
    firstCorrectAnswerMs: hoverMs,
    rssMbAtIdle,
    dataDir,
    hoverText: JSON.stringify(hover?.result?.contents ?? null).slice(0, 200),
    definition: JSON.stringify(def?.result ?? null).slice(0, 300),
    referenceCount: Array.isArray(refs?.result) ? refs.result.length : null,
    renameFilesTouched: Object.keys(renameEdit?.result?.changes ?? {}).length
      || (renameEdit?.result?.documentChanges ?? []).length,
    codeActionTitles: (actions?.result ?? []).map((a) => a.title).slice(0, 8),
    statusNotes: notes.slice(-6),
  }, null, 2));

  await request('shutdown', null);
  notify('exit', null);
  setTimeout(() => proc.kill('SIGKILL'), 3000).unref();
}

main().catch((e) => { console.error(e); proc.kill('SIGKILL'); process.exit(1); });

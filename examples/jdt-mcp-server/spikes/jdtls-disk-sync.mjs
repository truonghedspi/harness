#!/usr/bin/env node
// THROWAWAY SPIKE — never imported by production code.
// The one question that decides whether this whole product can be trusted:
// an AI agent edits Java files ON DISK, outside any editor. Does a running JDT LS
// notice, or does it keep answering from a stale in-memory model?
//
// Three cases, in order, against one live instance:
//   1. baseline: definition of `g.greet(...)` resolves into Greeter.java
//   2. edit Greeter.java on disk (rename greet -> salute) with NO LSP notification
//      at all -> does definition/diagnostics go stale?
//   3. send workspace/didChangeWatchedFiles -> does it catch up?
//
// Usage: node spikes/jdtls-disk-sync.mjs <jdtls-install-dir> <project-dir> <data-dir>

import { spawn } from 'node:child_process';
import { readdirSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [, , installDir, projectDir, dataDir] = process.argv;
const pluginsDir = join(installDir, 'plugins');
const launcher = readdirSync(pluginsDir).find((f) => f.startsWith('org.eclipse.equinox.launcher_') && f.endsWith('.jar'));
const configName = ['config_mac_arm', 'config_mac', 'config_linux_arm', 'config_linux', 'config_win'].find((c) => existsSync(join(installDir, c)));
mkdirSync(dataDir, { recursive: true });

const proc = spawn('java', [
  '-Declipse.application=org.eclipse.jdt.ls.core.id1', '-Dosgi.bundles.defaultStartLevel=4',
  '-Declipse.product=org.eclipse.jdt.ls.core.product', '-Dlog.level=ERROR', '-Xmx1G',
  '--add-modules=ALL-SYSTEM', '--add-opens', 'java.base/java.util=ALL-UNNAMED',
  '--add-opens', 'java.base/java.lang=ALL-UNNAMED',
  '-jar', join(pluginsDir, launcher), '-configuration', join(installDir, configName), '-data', dataDir,
], { stdio: ['pipe', 'pipe', 'pipe'] });

let buf = Buffer.alloc(0); const pending = new Map(); let nextId = 1;
let projectOk = false; const diags = new Map();
const send = (m) => { const b = Buffer.from(JSON.stringify(m), 'utf8'); proc.stdin.write(`Content-Length: ${b.length}\r\n\r\n`); proc.stdin.write(b); };
const request = (method, params) => new Promise((res) => { const id = nextId++; pending.set(id, res); send({ jsonrpc: '2.0', id, method, params }); });
const notify = (method, params) => send({ jsonrpc: '2.0', method, params });

proc.stdout.on('data', (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  for (;;) {
    const sep = buf.indexOf('\r\n\r\n'); if (sep < 0) return;
    const len = Number(/content-length:\s*(\d+)/i.exec(buf.subarray(0, sep).toString('ascii'))[1]);
    if (buf.length < sep + 4 + len) return;
    const body = buf.subarray(sep + 4, sep + 4 + len).toString('utf8'); buf = buf.subarray(sep + 4 + len);
    let m; try { m = JSON.parse(body); } catch { continue; }
    if (m.id !== undefined && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    else if (m.method === 'textDocument/publishDiagnostics') diags.set(m.params.uri, m.params.diagnostics);
    else if (m.method === 'language/status' && m.params?.type === 'ProjectStatus') projectOk = true;
    else if (m.id !== undefined && m.method) send({ jsonrpc: '2.0', id: m.id, result: m.method === 'workspace/configuration' ? (m.params?.items ?? []).map(() => ({})) : null });
  }
});
proc.stderr.on('data', () => {});

const appPath = join(projectDir, 'src/main/java/spike/App.java');
const greeterPath = join(projectDir, 'src/main/java/spike/Greeter.java');
const appUri = pathToFileURL(appPath).href;
const greeterUri = pathToFileURL(greeterPath).href;
const pos = { line: 5, character: 30 };
const resolvesToGreeter = async () =>
  JSON.stringify((await request('textDocument/definition', { textDocument: { uri: appUri }, position: pos }))?.result ?? null).includes('Greeter.java');
const appErrors = () => (diags.get(appUri) ?? []).filter((d) => d.severity === 1).map((d) => d.message);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const original = readFileSync(greeterPath, 'utf8');
  const rootUri = pathToFileURL(projectDir).href;
  await request('initialize', {
    processId: process.pid, rootUri, workspaceFolders: [{ uri: rootUri, name: 'spike' }],
    capabilities: {
      workspace: { configuration: true, workspaceFolders: true, didChangeWatchedFiles: { dynamicRegistration: true } },
      textDocument: { hover: {}, definition: {}, publishDiagnostics: {} },
    },
  });
  notify('initialized', {});
  const dl = Date.now() + 300_000;
  while (!projectOk && Date.now() < dl) await sleep(200);
  await sleep(3000);

  const out = {};
  out['1_baseline_resolves'] = await resolvesToGreeter();
  out['1_baseline_appErrors'] = appErrors();

  // 2. Break it on disk with NO notification of any kind.
  writeFileSync(greeterPath, original.replace('greet(', 'salute('));
  await sleep(6000);
  out['2_afterSilentDiskEdit_resolves'] = await resolvesToGreeter();
  out['2_afterSilentDiskEdit_appErrors'] = appErrors();

  // 3. Now tell it, the way a file watcher would.
  notify('workspace/didChangeWatchedFiles', { changes: [{ uri: greeterUri, type: 2 /* Changed */ }] });
  await sleep(8000);
  out['3_afterDidChangeWatchedFiles_resolves'] = await resolvesToGreeter();
  out['3_afterDidChangeWatchedFiles_appErrors'] = appErrors();

  writeFileSync(greeterPath, original);
  notify('workspace/didChangeWatchedFiles', { changes: [{ uri: greeterUri, type: 2 }] });
  await sleep(5000);
  out['4_afterRestore_resolves'] = await resolvesToGreeter();
  out['4_afterRestore_appErrors'] = appErrors();

  console.log(JSON.stringify(out, null, 2));
  notify('exit', null); setTimeout(() => proc.kill('SIGKILL'), 2000).unref();
}
main().catch((e) => { console.error(e); proc.kill('SIGKILL'); process.exit(1); });

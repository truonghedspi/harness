#!/usr/bin/env node
// THROWAWAY SPIKE — never imported by production code.
// Questions it answers, all load-bearing for the multi-project daemon design:
//   1. Can two JDT LS instances, each with its OWN -data directory, run concurrently
//      and each answer correctly about its own project? (routing premise)
//   2. What is the combined resident memory of two idle instances? (capacity premise)
//   3. Do diagnostics arrive as an unsolicited textDocument/publishDiagnostics
//      NOTIFICATION rather than as a request/response? (tool-shape premise: a
//      pull-style MCP `get_diagnostics` tool must be backed by a cache, not a call)
//   4. Does JDT LS publish diagnostics for a file the client never sent didOpen for?
//      (whether "diagnostics for the whole project" is reachable at all)
//   5. Does completion work, and does it need a resolve round-trip?
//
// Usage: node spikes/jdtls-two-projects.mjs <jdtls-install-dir> <projA> <projB> <dataRoot>

import { spawn } from 'node:child_process';
import { readdirSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [, , installDir, projA, projB, dataRoot] = process.argv;
if (!dataRoot) { console.error('usage: <jdtls-dir> <projA> <projB> <dataRoot>'); process.exit(2); }

const pluginsDir = join(installDir, 'plugins');
const launcher = readdirSync(pluginsDir).find((f) => f.startsWith('org.eclipse.equinox.launcher_') && f.endsWith('.jar'));
const configName = ['config_mac_arm', 'config_mac', 'config_linux_arm', 'config_linux', 'config_win'].find((c) => existsSync(join(installDir, c)));

function startInstance(projectDir, dataDir, xmx) {
  mkdirSync(dataDir, { recursive: true });
  const proc = spawn('java', [
    '-Declipse.application=org.eclipse.jdt.ls.core.id1',
    '-Dosgi.bundles.defaultStartLevel=4',
    '-Declipse.product=org.eclipse.jdt.ls.core.product',
    '-Dlog.level=ERROR', `-Xmx${xmx}`,
    '--add-modules=ALL-SYSTEM',
    '--add-opens', 'java.base/java.util=ALL-UNNAMED',
    '--add-opens', 'java.base/java.lang=ALL-UNNAMED',
    '-jar', join(pluginsDir, launcher),
    '-configuration', join(installDir, configName),
    '-data', dataDir,
  ], { stdio: ['pipe', 'pipe', 'pipe'] });

  const st = { proc, projectDir, dataDir, pending: new Map(), nextId: 1, ready: false, diagnostics: new Map(), t0: Date.now() };
  let buf = Buffer.alloc(0);
  const send = (m) => {
    const b = Buffer.from(JSON.stringify(m), 'utf8');
    proc.stdin.write(`Content-Length: ${b.length}\r\n\r\n`); proc.stdin.write(b);
  };
  st.send = send;
  st.request = (method, params) => new Promise((res) => {
    const id = st.nextId++; st.pending.set(id, res); send({ jsonrpc: '2.0', id, method, params });
  });
  st.notify = (method, params) => send({ jsonrpc: '2.0', method, params });

  proc.stdout.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      const sep = buf.indexOf('\r\n\r\n');
      if (sep < 0) return;
      const len = Number(/content-length:\s*(\d+)/i.exec(buf.subarray(0, sep).toString('ascii'))[1]);
      if (buf.length < sep + 4 + len) return;
      const body = buf.subarray(sep + 4, sep + 4 + len).toString('utf8');
      buf = buf.subarray(sep + 4 + len);
      let msg; try { msg = JSON.parse(body); } catch { continue; }
      if (msg.id !== undefined && st.pending.has(msg.id)) { st.pending.get(msg.id)(msg); st.pending.delete(msg.id); }
      else if (msg.method === 'textDocument/publishDiagnostics') {
        st.diagnostics.set(msg.params.uri, msg.params.diagnostics);
      } else if (msg.method === 'language/status') {
        if (msg.params?.type === 'ProjectStatus') st.ready = Date.now() - st.t0;
      } else if (msg.id !== undefined && msg.method) {
        send({ jsonrpc: '2.0', id: msg.id, result: msg.method === 'workspace/configuration' ? (msg.params?.items ?? []).map(() => ({})) : null });
      }
    }
  });
  proc.stderr.on('data', () => {});
  return st;
}

const rss = async (pid) => new Promise((res) => {
  const ps = spawn('ps', ['-o', 'rss=', '-p', String(pid)]); let out = '';
  ps.stdout.on('data', (d) => (out += d)); ps.on('close', () => res(Math.round(Number(out.trim()) / 1024)));
});

async function bring(st) {
  const rootUri = pathToFileURL(st.projectDir).href;
  await st.request('initialize', {
    processId: process.pid, rootUri,
    workspaceFolders: [{ uri: rootUri, name: 'spike' }],
    capabilities: {
      workspace: { configuration: true, workspaceFolders: true, applyEdit: true },
      textDocument: {
        hover: {}, publishDiagnostics: {}, definition: {},
        completion: { completionItem: { snippetSupport: false, resolveSupport: { properties: ['documentation', 'detail'] } } },
      },
    },
  });
  st.notify('initialized', {});
  const dl = Date.now() + 300_000;
  while (st.ready === false && Date.now() < dl) await new Promise((r) => setTimeout(r, 200));
}

async function main() {
  // Plant a deliberate compile error in project B ONLY, in a file we never didOpen,
  // so any diagnostic for it must come from the workspace build, not from the editor.
  const brokenPath = join(projB, 'src/main/java/spike/Broken.java');
  writeFileSync(brokenPath, 'package spike;\n\npublic class Broken {\n    int x = "not an int";\n}\n');

  const a = startInstance(projA, join(dataRoot, 'a'), '1G');
  const b = startInstance(projB, join(dataRoot, 'b'), '1G');
  await Promise.all([bring(a), bring(b)]);

  // Give the workspace build a moment to publish.
  await new Promise((r) => setTimeout(r, 6000));

  const appA = join(projA, 'src/main/java/spike/App.java');
  const uriA = pathToFileURL(appA).href;
  a.notify('textDocument/didOpen', { textDocument: { uri: uriA, languageId: 'java', version: 1, text: readFileSync(appA, 'utf8') } });
  await new Promise((r) => setTimeout(r, 1500));

  const defA = await a.request('textDocument/definition', { textDocument: { uri: uriA }, position: { line: 5, character: 30 } });
  // Ask instance B about instance A's file — it should NOT resolve, proving isolation.
  const crossTalk = await b.request('textDocument/definition', { textDocument: { uri: uriA }, position: { line: 5, character: 30 } });

  const comp = await a.request('textDocument/completion', { textDocument: { uri: uriA }, position: { line: 5, character: 30 } });
  const items = comp?.result?.items ?? comp?.result ?? [];

  const [rssA, rssB] = await Promise.all([rss(a.proc.pid), rss(b.proc.pid)]);

  console.log(JSON.stringify({
    projectReadyMs: { a: a.ready, b: b.ready },
    rssMb: { a: rssA, b: rssB, combined: rssA + rssB },
    definitionFromA: JSON.stringify(defA?.result ?? null).includes('Greeter.java'),
    definitionFromB_aboutAsFile: JSON.stringify(crossTalk?.result ?? null).slice(0, 120),
    completionItemCount: Array.isArray(items) ? items.length : null,
    completionIsIncomplete: comp?.result?.isIncomplete ?? null,
    completionFirstLabels: (Array.isArray(items) ? items : []).slice(0, 5).map((i) => i.label),
    diagnosticsA_uris: [...a.diagnostics.keys()].map((u) => u.split('/').pop()),
    diagnosticsB_uris: [...b.diagnostics.keys()].map((u) => u.split('/').pop()),
    diagnosticsB_forNeverOpenedBrokenFile:
      [...b.diagnostics.entries()].filter(([u]) => u.endsWith('Broken.java')).map(([, d]) => d.map((x) => x.message)),
  }, null, 2));

  for (const st of [a, b]) { st.notify('exit', null); setTimeout(() => st.proc.kill('SIGKILL'), 2000).unref(); }
}

main().catch((e) => { console.error(e); process.exit(1); });

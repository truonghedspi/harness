#!/usr/bin/env node
// Frozen paired benchmark for cross-service context collection. Run the same scenario before and
// after a collector/loader change; only the implementation under test changes.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, appendFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const scriptRoot = path.resolve(opt("--scripts", path.dirname(fileURLToPath(import.meta.url))));
const work = mkdtempSync(path.join(tmpdir(), "harness-context-eval-"));
const target = path.join(work, "integration");
const a = path.join(work, "svc-a"), b = path.join(work, "svc-b");
const put = (p, body) => { mkdirSync(path.dirname(p), { recursive: true }); writeFileSync(p, body); };
const run = (file, argv, cwd = target) => spawnSync(process.execPath, [path.join(scriptRoot, file), ...argv],
  { cwd, encoding: "utf8", input: "{}" });

try {
  for (const [dir, name, rule] of [[a, "a", "Never log a payload."], [b, "b", "Use UTC timestamps."]]) {
    put(path.join(dir, "package.json"), JSON.stringify({ name, scripts: { start: "node src/index.js" } }));
    put(path.join(dir, "src/index.js"), 'require("http").createServer().listen(0)\n');
    put(path.join(dir, "AGENTS.md"), `# ${name} rules\n${rule}\n`);
  }
  mkdirSync(target, { recursive: true });
  put(path.join(target, "AGENTS.md"), "# integration rules\n");
  put(path.join(target, "agents.manifest.json"), JSON.stringify({ agents: [{ name: "maker", resources: ["AGENTS.md"] }] }));
  put(path.join(target, "feature_list.json"), JSON.stringify({ features: [{ id: "feat-a", status: "not-started",
    context: { touches: [path.join(a, "src/index.js")], note: "change only service a" } }] }));
  put(path.join(target, "loop/current.json"), JSON.stringify({ node: "maker", feature: "feat-a" }));

  const collected = run("collect-services.mjs", ["--roots", `${a},${b}`, "--json"]);
  if (collected.status !== 0) throw new Error(collected.stderr || "collector failed");
  writeFileSync(path.join(target, "services.manifest.json"), collected.stdout);
  const manifest = JSON.parse(collected.stdout);
  const first = run("agent-context.mjs", ["maker"]);
  const firstText = JSON.parse(first.stdout).hookSpecificOutput.additionalContext || "";
  appendFileSync(path.join(a, "AGENTS.md"), "Changed after collection.\n");
  const stale = run("agent-context.mjs", ["maker"]);
  const staleText = JSON.parse(stale.stdout).hookSpecificOutput.additionalContext || "";
  const services = manifest.services || [];
  const discovered = services.filter((s) => (s.rules && s.rules.length) || (s.ownRules && s.ownRules.length)).length;
  const out = {
    schema: "context-collection-benchmark/1",
    scenario: "two services have rules; the active feature touches only svc-a; svc-a rules change after collection",
    metrics: {
      discoveryRecall: discovered / 2,
      relevantRuleLoadRecall: firstText.includes("Never log a payload.") ? 1 : 0,
      irrelevantRulesLoaded: firstText.includes("Use UTC timestamps.") ? 1 : 0,
      staleDigestDetected: /STALE[^\n]*AGENTS\.md|AGENTS\.md[^\n]*STALE/i.test(staleText),
      injectedBytes: Buffer.byteLength(firstText),
    },
  };
  process.stdout.write(JSON.stringify(out, null, 2) + "\n");
} finally {
  rmSync(work, { recursive: true, force: true });
}

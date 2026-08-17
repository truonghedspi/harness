#!/usr/bin/env node
// Enforce the producer side of the upgrade-context contract. The plan checker proves context is
// consumed; this gate proves a harness-changing commit did not forget to produce it.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const ROOT = path.resolve(opt("--target", path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..")));
const LEDGER = "harness-loop/upgrade-context.json";
const run = (argv) => execFileSync("git", ["-C", ROOT, ...argv], { encoding: "utf8" }).trim();
const lines = (text) => text.split("\n").map((s) => s.trim()).filter(Boolean);
const relevant = (file) => file.startsWith("harness-loop/") && file !== LEDGER &&
  !file.endsWith("harness-issues.jsonl");
const findings = [];

let intro = "";
try { intro = run(["log", "--diff-filter=A", "--format=%H", "--", LEDGER]).split("\n").filter(Boolean).at(-1) || ""; }
catch {}

// Working changes must update the ledger in the same eventual commit. This catches the omission
// before commit, which is when the developer can still fix it cheaply.
let working = [];
try {
  working = [...lines(run(["diff", "--name-only", "HEAD"])),
    ...lines(run(["ls-files", "--others", "--exclude-standard"]))];
} catch {}
if (working.some(relevant) && !working.includes(LEDGER)) {
  findings.push({ scope: "working-tree", message: `harness changes exist without ${LEDGER}` });
}

// Once the ledger has landed, audit every later harness-changing commit. Checking only the current
// diff would go green immediately after a context-free commit—the exact omission this gate exists
// to retain across sessions and CI runs.
if (intro) {
  let commits = [];
  try { commits = lines(run(["rev-list", "--reverse", `${intro}..HEAD`, "--", "harness-loop"])); } catch {}
  for (const commit of commits) {
    const changed = lines(run(["diff-tree", "--no-commit-id", "--name-only", "-r", commit]));
    if (changed.some(relevant) && !changed.includes(LEDGER)) {
      findings.push({ scope: commit.slice(0, 12), message: `harness-changing commit omitted ${LEDGER}` });
    }
  }
}

const result = { schema: "harness-upgrade-context-check/1", green: findings.length === 0, findings };
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
process.exit(findings.length ? 1 : 0);

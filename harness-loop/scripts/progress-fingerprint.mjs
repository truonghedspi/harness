#!/usr/bin/env node
// Canonical progress identity for the harness meta-loop. A blocker name alone is not state: its
// evidence can change while a repair is making progress, and A -> B -> A is a cycle even though no
// two adjacent blocker sets match. Hash the verifier facts plus the target's relevant durable state.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const target = path.resolve(opt("--target") || ".");
const reportPath = path.resolve(opt("--report") || path.join(target, "trace/verify-report.json"));
const readJSON = (p, fallback) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return fallback; } };
const report = readJSON(reportPath, null);
if (!report) { console.error(`error: report not found or invalid: ${reportPath}`); process.exit(2); }

const features = readJSON(path.join(target, "feature_list.json"), { features: [] }).features || [];
const git = spawnSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: target, encoding: "utf8" });
const workspace = git.status === 0 ? String(git.stdout) : "not-a-git-worktree";
const canonical = {
  blockers: (report.findings || []).filter((f) => f.severity === "blocker")
    .map((f) => ({ gate: f.gate, id: f.id, layer: f.layer, evidence: f.evidence || "", symptom: f.symptom || "" }))
    .sort((a, b) => `${a.gate}/${a.id}`.localeCompare(`${b.gate}/${b.id}`)),
  features: features.map((f) => ({ id: f.id, status: f.status || f.state || "", attempts: f.attempts || 0,
    readyForCheck: !!f.readyForCheck, evidence: f.evidence || "", checkerNotes: f.checkerNotes || "" }))
    .sort((a, b) => String(a.id).localeCompare(String(b.id))),
  workspace,
};
const digest = createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
process.stdout.write(digest + "\n");

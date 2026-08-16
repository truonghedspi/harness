#!/usr/bin/env node
import { readFileSync } from "node:fs";
const file = process.argv[2];
if (!file) { console.error("usage: check-question.mjs <question.json>"); process.exit(2); }
let q; try { q = JSON.parse(readFileSync(file, "utf8")); } catch (e) { console.error(`invalid JSON: ${e.message}`); process.exit(2); }
const findings = [];
const add = (id, message) => findings.push({ id, message });
for (const k of ["id", "title", "need", "impact", "answerContract"]) if (!q[k]) add("question-incomplete", `${k} is required`);
if (!Array.isArray(q.evidenceChecked) || q.evidenceChecked.length === 0) add("evidence-unchecked", "record the sources/probes checked before asking");
if (!q.humanOwnedReason) add("human-ownership-unproven", "state why a person, rather than a source or probe, owns the answer");
if (Array.isArray(q.options) && q.options.length === 1) add("false-choice", "one option is not a choice");
if (q.recommendation && !q.recommendation.basis) add("recommendation-unreasoned", "a recommendation needs its evidence/trade-off basis");
if (q.dependsOn?.some((id) => q.sameRound?.includes(id))) add("frontier-invalid", "a question cannot share a round with its unresolved prerequisite");
process.stdout.write(JSON.stringify({ schema: "human-question-check/1", green: findings.length === 0, findings }, null, 2) + "\n");
process.exit(findings.length ? 1 : 0);

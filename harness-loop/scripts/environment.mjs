#!/usr/bin/env node
// Capture environment selectors and tool paths without ever persisting secret values.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const home = path.basename(scriptDir) === "tools" ? path.dirname(scriptDir) : path.resolve(scriptDir, "..");
const project = path.basename(home) === "harness" ? path.dirname(home) : home;
const localPath = path.join(home, "env", "local.json");
const commandPath = (name) => {
  const cmd = process.platform === "win32" ? "where" : "sh";
  const argv = process.platform === "win32" ? [name] : ["-lc", `command -v ${name}`];
  const r = spawnSync(cmd, argv, { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim().split(/\r?\n/)[0] || null : null;
};
const kubeContext = () => {
  const kubectl = commandPath("kubectl"); if (!kubectl) return null;
  const r = spawnSync(kubectl, ["config", "current-context"], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() || null : null;
};
const keys = ["KIRO_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"];
const wrapperNames = process.platform === "win32" ? ["mvnw.cmd", "mvnw"] : ["mvnw", "mvnw.cmd"];
const captured = {
  schema: "harness-environment/1",
  capturedAt: new Date().toISOString(),
  java: { home: process.env.JAVA_HOME || null, executable: commandPath("java") },
  maven: {
    executable: commandPath("mvn"),
    wrapper: wrapperNames.map((f) => path.join(project, f)).find(existsSync) || null,
  },
  kubernetes: { kubeconfig: process.env.KUBECONFIG || null, context: kubeContext() },
  apiKeys: Object.fromEntries(keys.map((name) => [name, { source: "environment", present: !!process.env[name] }])),
};
if (args.includes("--capture")) {
  mkdirSync(path.dirname(localPath), { recursive: true });
  writeFileSync(localPath, JSON.stringify(captured, null, 2) + "\n", { mode: 0o600 });
}
let output = captured;
if (!args.includes("--capture") && existsSync(localPath)) {
  try { output = JSON.parse(readFileSync(localPath, "utf8")); } catch { /* report live capture */ }
}
if (args.includes("--json")) process.stdout.write(JSON.stringify(output, null, 2) + "\n");
else {
  console.log(`Environment: ${localPath}${existsSync(localPath) ? "" : " (not captured)"}`);
  console.log(`  java    ${output.java?.executable || "not found"}`);
  console.log(`  maven   ${output.maven?.wrapper || output.maven?.executable || "not found"}`);
  console.log(`  k8s     ${output.kubernetes?.context || "no current context"}`);
  console.log(`  api keys ${Object.entries(output.apiKeys || {}).filter(([, v]) => v.present).map(([k]) => k).join(", ") || "none present"}`);
}

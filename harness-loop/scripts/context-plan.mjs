#!/usr/bin/env node
// Select external service rules for the active feature. Inventory stays broad; context stays
// narrow. A summary is an index, never a substitute for the service-owned source file.
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const readJSON = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };
const digest = (p) => { try { return createHash("sha256").update(readFileSync(p)).digest("hex"); } catch { return null; } };
const within = (candidate, scope) => candidate === scope || candidate.startsWith(scope + path.sep);

export function planContext({ target = process.cwd(), featureId = null, touches = [] } = {}) {
  const root = path.resolve(target);
  const services = (readJSON(path.join(root, "services.manifest.json")) || {}).services || [];
  const current = readJSON(path.join(root, "loop/current.json"));
  const selectedId = featureId || (current && current.feature) || null;
  const features = (readJSON(path.join(root, "feature_list.json")) || {}).features || [];
  const feature = features.find((f) => f.id === selectedId);
  const requested = [...touches, ...((feature && feature.context && feature.context.touches) || [])]
    .map((p) => path.isAbsolute(p) ? path.normalize(p) : path.resolve(root, p));
  const inputs = [];
  for (const service of services) {
    const scope = path.resolve(service.path || "");
    if (!requested.some((p) => within(p, scope))) continue;
    const rules = service.rules || (service.ownRules || []).map((p) => ({ path: p, scope, sha256: null, provenance: "legacy-pointer" }));
    for (const rule of rules) {
      const actualSha256 = digest(rule.path);
      inputs.push({
        service: service.id,
        path: rule.path,
        scope: rule.scope || scope,
        provenance: rule.provenance || "discovered",
        expectedSha256: rule.sha256 || null,
        actualSha256,
        status: !existsSync(rule.path) ? "missing" : rule.sha256 && rule.sha256 !== actualSha256 ? "stale" : "current",
        selectedBy: selectedId ? `feature:${selectedId}` : "explicit-touches",
      });
    }
  }
  return { schema: "context-plan/1", feature: selectedId, touches: requested, inputs };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (n, d = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
  const touches = String(opt("--touches", "")).split(",").filter(Boolean);
  process.stdout.write(JSON.stringify(planContext({ target: opt("--target", process.cwd()),
    featureId: opt("--feature"), touches }), null, 2) + "\n");
}

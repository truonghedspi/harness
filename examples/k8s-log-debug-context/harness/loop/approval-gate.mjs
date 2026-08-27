#!/usr/bin/env node
// approval-gate.mjs — the human-in-the-loop node, placed on the one edge nobody was judging.
//
// `verify-harness --promote` flips a feature to `done` when its command re-runs clean. That is the
// right mechanical rule and the wrong place to stop: the command exiting 0 proves the test passes,
// not that the behaviour claimed is the behaviour wanted. review-digest measured the consequence —
// features promoted with nobody judging the claim were the largest unreviewed block in the repo.
//
// So this gate sits BEFORE promote, and it is selective. Blocking every promotion on a human
// destroys headless autonomy and trains the human to rubber-stamp; blocking none is how a wrong
// `done` becomes permanent. It stops only when the batch contains judgement actually owed —
// reusing review-digest's ranking rather than inventing a second opinion of what matters.
//
// Timeout defaults to AUTO-REJECT, never auto-approve. An unanswered request means nobody looked;
// the safe reading of "nobody looked" is "not approved". Auto-reject costs one more iteration.
// Auto-approve costs a wrong `done` that no later step revisits.
//
// Usage:
//   node harness/loop/approval-gate.mjs --check            # 0 = no approval needed, 10 = request written
//   node harness/loop/approval-gate.mjs --wait [--timeout-min N] [--on-timeout reject|escalate]
//   node harness/loop/approval-gate.mjs --verdict approved|rejected --reason "..."   # for scripted runs
//
// A headless run has nobody watching its terminal — the request sits in a file nobody opens until
// the timeout auto-rejects it, silently spending the judgement this gate exists to get. notify()
// below is a best-effort OS notification fired the moment a request is freshly written, so whoever
// is at the machine — not whoever happens to have this terminal in focus — sees it. It must never
// be able to block or fail the gate itself: a missing/broken notifier degrades to "the same as
// before this existed", never to a hung or crashed loop.
import { readFileSync, writeFileSync, existsSync, appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const REQUEST = "loop/approval-request.md";
const VERDICT = "loop/approval.md";
const LOG = "loop/approval-log.jsonl";
const TIMEOUT_MIN = Number(opt("--timeout-min", 0));
const ON_TIMEOUT = opt("--on-timeout", "reject");
const now = () => new Date().toISOString();
const read = (p) => { try { return readFileSync(p, "utf8"); } catch { return ""; } };

// HARNESS_NOTIFY=0 opts out entirely (headless server with nobody ever at it, or a test run).
// HARNESS_NOTIFY_CMD overrides the OS default with any `cmd title message` — a custom sink (a
// webhook script, ntfy.sh, a test double that just appends to a file) or a runtime this doesn't
// know how to reach natively.
function notify(title, message) {
  try {
    if (process.env.HARNESS_NOTIFY === "0") return;
    if (process.env.HARNESS_NOTIFY_CMD) {
      execFileSync(process.env.HARNESS_NOTIFY_CMD, [title, message], { stdio: "ignore" });
    } else if (process.platform === "darwin") {
      execFileSync("osascript",
        ["-e", `display notification ${JSON.stringify(message)} with title ${JSON.stringify(title)}`],
        { stdio: "ignore" });
    } else if (process.platform === "win32") {
      // No extra module (BurntToast) assumed installed — build the toast from the WinRT APIs that
      // ship with Windows 10+ PowerShell instead.
      const esc = (s) => String(s).replace(/'/g, "''");
      const ps = [
        "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null",
        "[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] > $null",
        "$t = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)",
        "$n = $t.GetElementsByTagName('text')",
        `$n.Item(0).AppendChild($t.CreateTextNode('${esc(title)}')) > $null`,
        `$n.Item(1).AppendChild($t.CreateTextNode('${esc(message)}')) > $null`,
        "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Harness').Show([Windows.UI.Notifications.ToastNotification]::new($t))",
      ].join("; ");
      execFileSync("powershell", ["-NoProfile", "-Command", ps], { stdio: "ignore" });
    } else {
      execFileSync("notify-send", [title, message], { stdio: "ignore" });
    }
  } catch { /* best-effort only — never blocks or fails the gate */ }
}

// --- what is owed -------------------------------------------------------------------------------
function owed() {
  let items = [];
  try {
    const out = execFileSync("node", ["tools/review-digest.mjs", "--target", ".", "--json"],
      { encoding: "utf8", maxBuffer: 32e6 });
    items = (JSON.parse(out).items || []).filter((i) => i.weight >= 4);
  } catch { /* review-digest absent or unusable — fall through to the local rule below */ }
  // Local fallback, and an additional condition review-digest does not model: a feature about to be
  // promoted that took more than one attempt to pass.
  const fl = JSON.parse(read("feature_list.json") || "{}");
  for (const f of fl.features || []) {
    if (f.readyForCheck === true && Number(f.attempts) > 1) {
      items.push({ weight: 4, kind: "struggled-promotion", what: f.id,
        why: `about to be promoted after ${f.attempts} attempts`,
        ask: "Read what changed to make it pass — was that the right change, or the one that made the test stop complaining?" });
    }
  }
  return items;
}

// --- the interrupt format -------------------------------------------------------------------------
// Four questions, in this order, because that is the order a person needs them: what happened,
// what changes if I say yes, why me rather than a machine, what each answer costs.
function writeRequest(items) {
  const fl = JSON.parse(read("feature_list.json") || "{}");
  const pending = (fl.features || []).filter((f) => f.readyForCheck === true).map((f) => f.id);
  const body = [
    `# Approval request — ${now()}`, "",
    "**What happened.** The loop finished an iteration and is about to flip the features below to",
    "`done` mechanically: their verification commands re-ran and exited 0.", "",
    `**What changes if you approve.** ${pending.length} feature(s) become \`done\`: ${pending.join(", ") || "(none pending)"}.`,
    "`done` is terminal — no later node re-examines it. The claim becomes the record.", "",
    "**Why you and not a machine.** Every mechanical check already passed. What no check covers is",
    "whether the behaviour claimed is the behaviour you wanted. Grade with",
    "`docs/reference/step-acceptance.md` — at this gate the three that fail silently are D9 (a false",
    "premise smoothed over), T2 (a tautological test) and T3 (an assertion widened to go green).",
    "These items carry judgement still owed:", "",
    ...items.map((i, n) => `${n + 1}. **[${i.kind}] ${i.what}** — ${i.why}\n   → ${i.ask}`), "",
    "**Cost of each answer.**",
    "- `approved` — the features become `done`. If a claim was wrong, it is now the baseline that",
    "  every later feature builds on, and nothing will look at it again.",
    "- `rejected` — nothing is promoted; the features stay `readyForCheck` and the checker gets them",
    "  next iteration with your reason attached. Cost: one iteration.", "",
    "---", "",
    "**Reply** by replacing this line in `loop/approval.md` with `approved` or `rejected`, then a",
    "blank line, then your reason (the reason is not optional — a verdict with no reason cannot be",
    "acted on by the node that receives it).", "",
    TIMEOUT_MIN > 0 ? `_No answer within ${TIMEOUT_MIN} minute(s) → auto-${ON_TIMEOUT}._` : "_No timeout set: this waits._",
  ].join("\n");
  writeFileSync(REQUEST, body + "\n");
  if (!existsSync(VERDICT)) writeFileSync(VERDICT, "pending\n\n(replace the first line with approved or rejected, then your reason)\n");
  notify("Harness: approval needed",
    `${items.length} item(s) owed judgement — ${pending.join(", ") || "see " + REQUEST}`);
}

function record(entry) { appendFileSync(LOG, JSON.stringify({ at: now(), ...entry }) + "\n"); }

function parseVerdict() {
  const first = read(VERDICT).split("\n")[0].trim().toLowerCase();
  if (!["approved", "rejected"].includes(first)) return null;
  const reason = read(VERDICT).split("\n").slice(1).join("\n").trim();
  return { verdict: first, reason };
}

// --- modes ------------------------------------------------------------------------------------------
if (args.includes("--verdict")) {
  const v = String(opt("--verdict", "")).toLowerCase();
  writeFileSync(VERDICT, `${v}\n\n${opt("--reason", "")}\n`);
  console.log(`verdict recorded: ${v}`);
  process.exit(0);
}

const items = owed();
if (args.includes("--check")) {
  if (!items.length) { console.log("no approval needed — nothing in this batch carries judgement still owed"); process.exit(0); }
  writeRequest(items);
  console.log(`approval required: ${items.length} item(s) owed — wrote ${REQUEST}`);
  process.exit(10);
}

if (args.includes("--wait")) {
  if (!items.length) { console.log("no approval needed"); process.exit(0); }
  if (!existsSync(REQUEST)) writeRequest(items);
  const deadline = TIMEOUT_MIN > 0 ? Date.now() + TIMEOUT_MIN * 60000 : Infinity;
  console.log(`waiting for a verdict in ${VERDICT}${TIMEOUT_MIN > 0 ? ` (timeout ${TIMEOUT_MIN}m → auto-${ON_TIMEOUT})` : ""} …`);
  for (;;) {
    const v = parseVerdict();
    if (v) {
      record({ ...v, items: items.length, source: "human" });
      console.log(`verdict: ${v.verdict.toUpperCase()} — ${v.reason.split("\n")[0] || "(no reason given)"}`);
      if (!v.reason) { console.log("REJECTING anyway: a verdict with no reason is not actionable."); process.exit(1); }
      process.exit(v.verdict === "approved" ? 0 : 1);
    }
    if (Date.now() >= deadline) {
      record({ verdict: ON_TIMEOUT === "escalate" ? "escalated" : "rejected", reason: `no response within ${TIMEOUT_MIN}m`, items: items.length, source: "timeout" });
      appendFileSync("session-handoff.md",
        `\n## ${now()} — approval timed out\nNo response within ${TIMEOUT_MIN}m on ${items.length} item(s) owing judgement. Auto-${ON_TIMEOUT}; nothing was promoted. See ${REQUEST}.\n`);
      console.log(`TIMEOUT → auto-${ON_TIMEOUT}; nothing promoted, escalation written to session-handoff.md`);
      process.exit(1);
    }
    execFileSync("sleep", ["2"]);
  }
}

console.log("usage: approval-gate.mjs --check | --wait [--timeout-min N] [--on-timeout reject|escalate] | --verdict approved|rejected --reason '…'");
process.exit(2);

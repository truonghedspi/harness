# Input Capture & Replay — fully automated, machine-certified

Golden-master parity is only as good as the captured inputs. This doc defines how inputs
are collected with zero manual steps in steady state, and — the part that makes full
automation trustworthy — how capture quality is itself machine-verified (tape
certification). PROD is a read-only recording source; replay always runs on staging.

**Hard rule: no replay of any kind ever executes on PROD.** Not tape certification, not
parity runs, not shadow. The only PROD touchpoints in this entire program are: reading
logs that already exist, copying backups that already exist, and the one-time approved
deployment of the write-aside interceptor. No test transaction ever enters PROD. If a
staging TimesTen copy is unavailable for certification, fall back (in order): an existing
UAT/SIT TimesTen instance; a masked-subset restore; statistical reconciliation only — and
compensate the weaker certification with a longer shadow run.

## Canonical input envelope

Every capture source normalizes into one schema (one JSONL line per business input):

```json
{
  "eventId": "sha256(source+offset)",
  "capturedAt": "2026-07-19T09:30:00.123Z",
  "source": "fix-gateway | audit-log | interceptor | synthesized",
  "entryPoint": "APP-JAVA.SettlementService.calculateFee",
  "sessionKey": "account-or-fix-session-id",
  "sessionSeq": 4711,
  "clock": "business timestamp to inject on replay",
  "payload": { "the full request DTO / parsed FIX fields": "..." }
}
```

`entryPoint` maps to inventory unit ids — that is what ties capture to the coverage chain.
Ordering on replay: total order by (clock, sessionKey, sessionSeq); any behavior that
depended on a different interleaving surfaces as a docs/04 D-004 case, by design.

## Capture sources, in priority order

1. **Existing operational logs** (FIX gateway logs, OMS logs, audit trails) — zero PROD
   change. Agents reverse-engineer the format and generate parsers.
2. **Write-aside interceptor** (agent-generated Spring filter/AOP) for entry points whose
   logs lack fields: emits envelope events to a side channel; fire-and-forget, bounded
   queue, drop-on-overflow with a drop counter; can never block or fail the business flow.
   Deploying it is the ONE human-approved step (change management).
3. **TimesTen XLA** (`ttXlaSubscribe`) — committed-change stream, used for expected
   OUTPUTS when EOD reports lack resolution. Read-only.

## Capture coverage matrix (feat-006)

For every externally invokable inventory unit: which source covers it, which fields the
source provides, which spec-required fields are missing. A unit with no source and no
synthesized-only justification is a violation, reported alongside coverage-check.

## Completeness gates — why automation can be trusted

1. **Three-way count reconciliation** (daily, automatic): envelope events vs gateway
   accepted-count vs EOD report row counts. Any delta beyond the documented tolerance →
   tape flagged, alarm raised.
2. **Runtime cross-audit**: units whose statements executed on PROD on day D (command
   cache / XLA evidence) but with zero captured inputs that day → capture gap alarm.
3. **Tape certification** (feat-008, the keystone): nightly, replay tape D into a staging
   copy of the OLD system restored from the D-1 backup, then reconcile EOD state against
   PROD's actual day-D EOD archives, field by field. A tape is `certified` only on
   zero-diff. Only certified tapes may feed golden-master vectors, Phase 3 replays, or
   parity evidence. This proves capture completeness against the old system itself —
   before the new system even exists.

## Masking (decision D-008)

Staging is a lower trust zone: copies are masked in the pipeline, deterministically
(same account → same pseudo-id, preserving referential integrity). Fields that
participate in business logic (amounts, customer tier, fee schedule keys, symbols) are
NEVER masked — masking them fabricates parity failures. The allow/deny field list is a
docs/04 decision requiring human sign-off.

## Capture-watch loop (feat-009)

An automated agent loop (same maker–checker machinery) monitors: drop counters, unparsed
line ratio, schema drift (new/renamed fields), certification failures. Mechanical fixes
(parser patch for a new optional field) it applies and traces; semantic ambiguity (a new
field that might change behavior) becomes a proposed docs/04 decision and a `blocked`
flag. Every action lands in `trace/trace.jsonl`.

## Vector derivation from certified tapes

Agents slice certified tapes per unit, mine the field distributions, and select the
per-unit vector set automatically: representative happy paths per observed branch,
observed boundary values, observed error cases. Branches with no real traffic are listed
per unit and covered by synthesized capture against reference TimesTen (docs/02). The
selection report (what was observed vs synthesized) attaches to the unit's spec.

## Zero-PROD-access mode (the operating assumption for this project)

The migration team has NO rights on PROD. Nothing in this pipeline may assume otherwise.
Every PROD-derived artifact is obtained from copies that already left PROD through
existing operational channels, requested from the owning teams:

| Artifact | Source (not PROD) | Owner to request from |
|---|---|---|
| Input logs (FIX/OMS/audit) | Central log platform (ELK/Splunk/…) | Ops / log platform team |
| Order & trade audit trail | Compliance archive (regulatory retention) | Compliance |
| EOD state (day D-1) | Backup copies already exported to DR/UAT | DBA team |
| Expected results (day D) | Official EOD reports to accounting/custody | Back office |

The write-aside interceptor is OPTIONAL in this mode: it exists only if the PROD-owning
team agrees to deploy it. Entry points whose existing logs lack fields fall back to
synthesized capture against the reference TimesTen (docs/02) — record each such unit in
the capture coverage matrix as `synthesized-only`, with the missing-field reason.

If NO real traffic can be obtained at all: golden master runs fully synthesized, and the
weaker evidence must be compensated measurably — branch-exhaustive vectors (verified with
branch coverage on the new implementation) plus mutation testing to prove vector
strength — and the real-data validation shifts to the pre-cutover parallel run operated
by the team that does hold PROD rights, using diff tooling this project delivers to them.

## Human approvals / external requests (everything else is automated)

- Data acquisition requests to owning teams (log platform, compliance, DBA, back office) — D-009
- Interceptor deployment, only if the PROD owner accepts it (optional)
- Masking field policy (D-008)

---
name: opensearch-ism-attach-and-match-or-semantics
description: OpenSearch ISM attaches a policy to an index asynchronously, and text match queries use OR semantics
metadata:
  type: lesson
  date: 2026-08-28
---

feat-005's real-store oracle failed twice against live OpenSearch 2.19.1, each a real product bug the unit `FakeGateway` never saw.

**Why:** (1) ISM policy attachment is asynchronous — `_plugins/_ism/explain/{index}` returns `policy_id: null` immediately after the index is created and only reports the policy ~1s later, so a bootstrap that asserts the attachment synchronously flaked on every run. (2) A `match` query on a `text` field is OR semantics over the analyzed tokens, so `messageContains("fallback marker")` also matched documents containing only the shared token "marker" ("shared marker").

**How to apply:** when `verifyInstalled` reads ISM explain, poll until `policy_id` equals the policy id (bounded timeout), never assert once. For a `messageContains` filter over a `text` field, use `match_phrase`, not `match` — any multi-word term whose individual words are shared by distractor records will otherwise over-match.

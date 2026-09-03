# A declared port does not mean that anyone already owns the connector

**Context.** 2026-08-23, handling FOLLOW-UP of `feat-diagnostics-cache`. Two other `build` features
each other (`feat-file-sync-watcher`, `feat-diagnostics-cache`) are checked by APPROVE with argument
identical: the component declares a narrow port in its own file
(`LspNotificationSink`, `LspNotificationSource`) instead of editing `src/lsp/lsp-client.ts`, because
`context.touches` does not list that file so fix it as scope bleed. That argument is correct. But later
two rounds of APPROVE, no feature in the graph owns the other end: `LspClient` is absent
`notify()` and `onNotification()`, and `#handleMessage` silence all messages that do not carry an id.

**Error in first cut.** `feat-lsp-client` is cut according to the component table in
`docs/design/architecture.md`, where the line for `lsp-client` just says "Content-Length framing, id
correlation, server→client requests". That list omits notifications, so features are also omitted.
then go to `done` with full proof of what it claims. There are no red flags: every
Related features are all green, only two `prove` in the distance are `blocked` with the usual sounding reason.

**Signs for next time.** Every time a `build` feature satisfies a contract by declaring a
`interface` port in its own file, immediately find the feature that owns the class that implements that port. If
can't find it, it's a scope that doesn't have an owner, not an implementation detail that will appear on its own. Secondary edge
The attribute must go from the `prove` feature through the actual wire to the new feature, not the other way around
on the `build` feature `done` — the behavior of the `done` feature is demonstrated for the port, and
The inverted edge just dirtyes the DAG without adding any verifiable assertions.

**Quick way to check.** Grep the port `interface` name across all `src/`: if there is only one prompt file
to it, the gate is hanging.
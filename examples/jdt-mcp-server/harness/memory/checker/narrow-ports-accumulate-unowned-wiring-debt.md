# The narrow gate declared in place is the correct boundary, but wiring debt accumulates that no one owns

**When to apply:** Maker needs another component to provide a capability that doesn't yet exist, and instead fixes it
component (scope bleed), he declares a narrow interface in his own file and then says "daemon
will connect the wires later". Found in `feat-file-sync-watcher` (`LspNotificationSink`) and repeated in
`feat-diagnostics-cache` (`LspNotificationSource`), 2026-08-22.

## Why each individual approval is correct

That boundary is indeed correct. `context.touches` only lists the component's files; edit `src/lsp/lsp-client.ts`
In a watcher or cache maker, it is scope bleed. The gate is narrow in exactly one way,
Structural compatibility, no one has to fix anything right away. I approved the first and approved the second, both
twice are correct according to the criteria of that feature itself.

## Something that is never revealed just by looking at a feature

The second time, counting again, there were two declared ports and **none** of them had connectors:

- `LspClient` drops all notifications. `#handleMessage` specifies the request server→client route (with method
  and id), then `if (typeof message.id !== "number") return;` drops the rest.
- `feat-lsp-client` is in the `done` state, and its behavior only refers to the Content-Length and
  id correlation — it won't come back.
- None of the features in `feature_list.json` owns adding dispatch notification.
- `feat-prove-diagnostics` is `blocked` for the reason that "real publishDiagnostics" is needed
  delivery" — meaning the integrated proof layer has hit this exact gap.

Consequence: two components are 'done', their level 1 oracle is green, but the real data path is never
exists. No single test of a single feature detects it, because each feature is correct
within its scope.

## What the checker must do

When you see a gate open on site with the promise of "wiring later," don't stop at confirming the correct boundary.
Do three more steps, taking about two minutes:

1. Read the component at the other end and confirm that the capability is **really** not there (don't trust the statements). Here it is
   `#handleMessage` drops messages without id — just as the maker described.
2. Look in `feature_list.json` to see which feature owns the wiring section. If the other end component already exists
   `done`, it will not return on its own.
3. If no one owns it, write `FOLLOW-UP:` in the **first line** of `checkerNotes` so that the router can send it to the planner.
   Count the number of hanging gates too — numbers are what turn a feeling into something with scope.

Still APPROVE feature. The mistake to avoid is to approve without silence: correct boundaries still leave debt, and
If a debt is not named, no one will pay it.
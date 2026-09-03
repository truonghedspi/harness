# `LspClient` does not yet route notifications: push consumers must declare their own port

**When to apply:** maker build a component that consumes the JDT LS message pushed back —
`textDocument/publishDiagnostics`, `language/status`, `language/actionableNotification` — and definition
"real wiring" by calling an existing API of `src/lsp/lsp-client.ts`.

## The truth is easy to misunderstand

`LspClient` only has `onRequest(method, handler)`, and `#handleMessage` only calls that handler when informed.
message **carrying `id`**. The LSP's notification does not carry an `id`, so that branch is never run; remaining branch
again request `typeof message.id === "number"` then `return` — notification is abandoned silently. Sign up
`onRequest("textDocument/publishDiagnostics", ...)` compiled, ran, and never exploded.
The send direction is also lacking: there is no `notify()`, and `#write` is private.

## The correct way to do it, there is a precedent that has been judged by the checker

Declare a narrow port in the component's own file, without editing `src/lsp/lsp-client.ts`:
`file-sync-watcher` uses `LspNotificationSink { notify(method, params) }` for sending direction;
`diagnostics-cache` uses `LspNotificationSource { onNotification(method, handler) }` for the receiving direction.
Checker recorded directly in `checkerNotes` of `feat-file-sync-watcher`: port is the correct choice
world, but *edit `src/lsp/lsp-client.ts` is scope bleed*, because `context.touches` does not list it.
The signature must be chosen so that `LspClient` automatically matches the structure as soon as it has a compatible method
response — then the daemon is wired without having to modify any components.

## The consequences must be written down, not silent

The gate makes the component correct but **doesn't** make it receive actual bytes. Specify in `checkerNotes`
that the missing dispatch part is a feature of lsp-client, with technical reasons (message no
carries `id`). If not written, the next pass will read `attach()` as proof that the wiring has been completed.
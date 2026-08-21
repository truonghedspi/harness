# Session handoff — feat-lsp-client needs planning and an oracle

`feat-lsp-client` cannot begin a valid maker attempt until its stale context packet is refreshed and its missing independent test is authored.

- Router selected `feat-lsp-client`; dependencies are done and attempts remain 0/4.
- `./harness/init.sh` passed on 2026-08-21.
- The packet names `harness/docs/design/runtime-model.md` and `harness/docs/design/evidence.md`; both were reread as authoritative sources.
- The declared verification is `npm test -- test/lsp/lsp-client.spec.ts`, but that test file does not exist and `npm test` is not wired.
- No verification was run because it could only fail before an assertion, which is explicitly non-qualifying red evidence.
- No source or test file was changed. Route the `NEEDS RE-PLAN:` marker to refresh the packet and dispatch the independent oracle.

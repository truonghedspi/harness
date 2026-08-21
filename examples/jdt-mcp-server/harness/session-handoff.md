# Session handoff — feat-lsp-client needs an independent oracle

`feat-lsp-client` cannot begin a valid maker attempt until its missing independent test is authored.

- Router selected `feat-lsp-client`; dependencies are done and attempts remain 0/4.
- `./harness/init.sh` passed on 2026-08-21.
- The refreshed context packet is current and its three `mustRead` sources were consumed.
- The declared verification is `npm test -- test/lsp/lsp-client.spec.ts`, but that test file does not exist and `npm test` is not wired.
- No verification was run because it could only fail before an assertion, which is explicitly non-qualifying red evidence.
- No source, test, attempt, feature status, or readiness field was changed. Dispatch the test-designer/test-implementer to author the oracle, then route back to maker.

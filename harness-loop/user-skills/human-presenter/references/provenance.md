# Provenance without citation clutter

Keep fine-grained provenance internally; disclose it at the coarsest readable level that remains
unambiguous.

| Claim kind | Reader-facing treatment |
|---|---|
| `user-provided` | use naturally; say “theo thông tin bạn cung cấp” only when attribution matters |
| `source-fact` | normal prose; group shared citations at paragraph end |
| `runtime-observation` | state action/environment/time when material, then outcome |
| `inference` | transition naturally: “Điều này cho thấy…”, “Mình suy ra…” |
| `assumption` | name it before relying on it and state what changes if false |
| `uncertainty` | unknown + basis + decision impact + resolving evidence |
| `recommendation` | “Mình khuyến nghị…” with decisive reason and main downside |

Rules:

1. Link directly to the source that supports the claim. Do not cite a source for an inference the
   source itself does not make.
2. For adjacent claims sharing sources, use one marker at the paragraph end. For one or two links,
   descriptive inline links are often cleaner than source IDs.
3. Use a compact `Nguồn kiểm chứng` map only when readers may audit multiple sources. Source aliases
   such as `[S1]` are presentation conveniences, not the provenance store.
4. Runtime evidence is not automatically proof. “Command exited 0” establishes only that run unless
   the oracle connects it to the claim.
5. Never convert absence of evidence into evidence of absence.
6. Do not invent scalar confidence. Use calibrated language based on evidence and agreement:
   `established`, `observed`, `indicates`, `suggests`, `assumes`, `unknown`, `recommends`.

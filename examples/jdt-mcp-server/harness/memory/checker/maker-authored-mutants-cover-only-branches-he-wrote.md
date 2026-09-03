# Mutants created by the creator only cover the main branch the creator wrote

**When applicable:** any `kind: build` feature for which the maker writes both the implementation and the unit tests
itself, then submitted a self-made mutant list as proof of the oracle's discriminating power. Meet once
beginning at `feat-file-sync-watcher` (2026-08-22).

## Why does Maker's mutant list look convincing but still falls short?

The four declared mutants all reproduced word for word. No mutant makes it up. The problem lies elsewhere:
All four hit an `if` branch that the maker just typed out a few minutes ago. The coder chooses the mutant from
branch map in my head, so that mutant episode proves exactly what oracle already covered. It's not possible
point out which axis no one has thought of yet.

At that time, the five mutants built by the checker all survived with 8/8 green, while the deployment was complete
absolutely correct. The vulnerability belongs to the oracle, not the source code — but the feature falsifier remains
not proven.

## Three axes should build mutants, in addition to the maker's branch map

1. **Protocol constant that the test re-imports from the module being judged.** This is R-T3 in hard form
   see the most. If all assertions compare to `FileChangeType.Created` imported from that module, then change
   `{ Created: 1, Deleted: 3 }` to `{ Created: 3, Deleted: 1 }` will survive: oracle certificate
   Prove that the label is consistent with itself, not prove that the integer is placed on the string. How to catch: read notes
   quote the spec right above the constant, then ask which cases include the literal of the spec instead of the constant name.
2. **The mechanism that maker's own explanation calls load-bearing.** Design notes confirm the
   `ino` is the point where the write-temporary-then-rename pattern appears "even if the size remains the same". Delete clause
   `ino`: still green, because all cases record content of different lengths. Rule to draw: each sentence "X is the necessary reason
   This plan works" There must be a red shift when X is missing. Otherwise, X is a statement, not a statement
   proven behavior.
3. **The fixture shape that all cases share.** All eight cases use one module, one source root
   `src/main/java`, a `pom.xml` at the root. Three set-reduction mutants were observed (original pom only; omitted
   `src/test/java`; remove the infix rule for reactor) both survive because neither fixture has a second shape
   two. Here's what R-T9 looks like from the data instead of from the code: reading configuration constants and option comments
   of the component, then count which shift each value in it touches.

## Cheap and safe way to build

Copy `src/<file>.ts` and spec to `harness/trace/scratch/<slug>/`, change the copy's relative import
source to `../../../../src/...`, change the import of the spec copy to the source copy. Always run one copy
control `m0` without previous mutation: if `m0` is not green the same number of cases as the original, the copy is wrong and all
The conclusion then makes no sense. Delete the folder once done; The missing cases are written into specific requirements
`checkerNotes`, leave no script.
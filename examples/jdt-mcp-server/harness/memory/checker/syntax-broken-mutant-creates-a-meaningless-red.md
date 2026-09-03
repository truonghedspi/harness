# A syntax-broken mutant creates a meaningless red result — and TAP hides that well

**When to apply:** Every checker automatically builds mutants on projects running TypeScript using
`node --experimental-strip-types`. Found in `feat-tool-layer-core` turn 2 (2026-08-25).

## Trap

I built mutant A1 to measure the effect of a positive anchor: let the attachment loop run on an empty array.

```ts
for (const attach of [] as typeof this.#attachments) {
```

The returned result looks exactly like a murdered mutant:

```
not ok 2 - test/workspace/workspace-attachments.spec.ts
not ok 3 - test/workspace/workspace-pool.spec.ts
# tests 17
# pass 15
# fail 2
```

There's `not ok`, there's `fail 2` — if just `grep "^not ok"` like I'm doing, the conclusion is "mutant died,
Oracle has the power to discriminate. Mutant actually never runs: `--experimental-strip-types` is not
full TypeScript compiler, it rejects `typeof this.#privateField` in type position with
`SyntaxError [ERR_INVALID_TYPESCRIPT_SYNTAX]: Expected identity`. File failed to load, so oracle failed
judge anything.

## Recognizable sign, cheap and decisive

**The name of the `not ok` line is FILE PATH, not ca name.** When a spec file fails to load,
`node --test` reports the file as a "test" and its name as the path. Always accompanied by a decrease in the total number of cases
abnormal down (here 28 → 17): case number of loaded files, plus several file-level lines.

Three things to learn, do right in the mutant loop:

1. The output filter must retain `error:` and `ERR_INVALID_TYPESCRIPT_SYNTAX`, not just `^not ok`.
2. Always compare mutant's `# tests` with m0's `# tests`. Various ⇒ suspected file loading error first
   when suspecting behavior (same family as the lesson in `sandbox-mutant-bi-runner-phat-hien.md`, just the opposite
   pm: there the number of cases swelled, here it shrank).
3. Write mutants in pure JavaScript, not with type annotations. `[] as T` ⇒ `.slice(0, 0)`;
   `as any` ⇒ give up completely; cast ⇒ change value. Mutants fix **behavior**, not **style**, so it
   type syntax is never needed — and every type syntax is an occasion for strip-types rejection.

After changing to `this.#attachments.slice(0, 0)`, mutant worked and gave me the answer I needed: red shift
CORRECT at the anchor line with the correct message of the anchor, that is, the anchor has an effect — the opposite conclusion
The quality of evidence compared to the red color is empty at first.
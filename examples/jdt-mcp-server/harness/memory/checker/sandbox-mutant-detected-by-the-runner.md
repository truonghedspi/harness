# A sandbox mutant inside the repository is discovered by the test runner itself

**Context.** Hits `feat-prove-daemon-lifecycle`. Prompt asking to build internal sandbox
`harness/trace/scratch/`, so I copied `src/`, `test/`, `package.json` into
`harness/trace/scratch/dlc/base`, then make each mutant a separate `run-M*` directory (each directory
carries an intentionally corrupted copy of `src/`).

**Symptoms.** The last step of the scan runs `npm run test:integration` without parameters. Results:
`tests 1722, pass 1623, fail 99`, and in the red list there is also `TCON-SHIM-0001` — the correct case is being
approval. At first glance, this is strong evidence to REJECT.

**Root cause.** `package.json` declares `"test:integration": "node --experimental-strip-types --test"`
— no link. `node --test` without parameters recursively scans the entire working directory tree, so it
found 11 copies of `test/` in my own sandbox, each running on a mutated `src/`.
The number 13 iterations of the same shift name is indicative: a project with only one file cannot have 13 iterations.
After deleting `harness/trace/scratch/dlc`, the same command returns `tests 123, pass 123, fail 0`.

**Lesson.**

1. Before considering a full suite run as proof, compare the NUMBER of cases with the number of cases
   know about the project. A tenfold increase in bulges is a sign of infection, not regression.
2. A shift name repeated N times in the same run is always a file discovery error, never an error
   behavior.
3. The checker's sandbox must be cleared BEFORE running any commands that scan the entire directory tree. If needed keep
   sandbox to run again, place it outside the runner's working directory, or run the suite using the correct
   glob that evidence recorded (`test/integration/*.integration.spec.ts`).
4. The converse is also true and worth being wary of: a parameterless `--test` command can swallow the entire file
   not part of the project. When the maker logs evidence with a command of this type, ask if the command actually ran
   which files.
# Run a temporary mutant build: restore with clone, not with git

**When to apply:** The creator is assigned "oracle to live mutant, add test cases", in version
The implementation has been confirmed by the checker correctly and we have to temporarily break it to prove that the new case has teeth.
Found in `feat-file-sync-watcher`, turn 2.

## Three things that are easy to do wrong, ranked by level of damage

### 1. `git checkout` cannot save files that have never been committed

The deployment of a feature awaiting a checker often remains in an untracked state (`??` in
`git status`). Reflex restore command — `git checkout -- <file>` — with untracked files does not
restore nothing, and if you accidentally use `git clean`, all the effort from the previous round will be lost.

Correct way: **run `git status --porcelain` before building the first mutant.** If the file is
untracked, copy it to a place outside the source tree, then have all mutant build commands start from that copy
(copy it again, then replace the string). End of turn, `diff` copy with source file must be empty — this is
The only mechanical proof that there are no mutants left, stronger than any assertion.

### 2. This turn's "red evidence" does not have the same meaning as the feature build turn

In the build phase, red means running oracle before the source code is available. In the oracle edit, the source code is correct, so
a new case **must** be green immediately. The only valid red evidence is red under the exact mutant that the case is targeting
come. Record evidence in pairs: red-under-mutant-X, then green-after-restitution.

With a valuable side assertion: mutant X can only be killed in the targeted case, the other cases remain green. It
correctly recreated the checker's findings and proved that the new case was the one that closed the gap, not a duplicate
with available shifts.

### 3. Green and red cases in the right place can still be raced cases

The case "only one distinct field remains" (here: same size, same mtime, different inode) can only be proven
which it declares if the background image is pegged deterministically. My first version prepared the background image
**after** `start()`; it is still green under the correct code and red under mutant, meaning it meets all surface criteria.
But a flush inserted between `writeFileSync` and `utimesSync` will cause the background image to keep the actual mtime, and
At that time, the mutant survived and the case remained green. I only discovered it by tracing the cause of a flaky error
different, not by design.

Rule of thumb: set all preparations **before** turning on the observer component, so that the scan starts
Dynamic latching background image. And confirm directly with `statSync` that exactly one field is distinct — otherwise,
Ca is talking about a different mechanism than it seems.

## Signs that you've done enough

At the end of the turn there must be at the same time: `diff` with an empty pristine copy, each mutant with a red line stating it is correct
The name confirms or is the correct timeout sequence, and the mutants from the previous turn are reconstructed to prove it
Changing shared infrastructure does not blunt old shifts.
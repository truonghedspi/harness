# A mutant is only equivalent if the successor is not observed

**Context:** FOLLOW-UP of `feat-tool-layer-core` (2026-08-25). Checker constructed mutant N1 — reverse
`spawned.stop()` comes before `#runDetachments(victim)` in `#evict` of `workspace-pool.ts` — and it
survived 28/28. The equivalence argument sounds very strong: the detach function does BOTH `detach()`
`cache.forget(workspaceId)`, so a publish inserted in the middle of `stop()` will still be immediately deleted by `forget()`
then. The final state of the cache is identical in both orders.

**That argument is wrong, and it turns out.** It only considers one observer: the dying workspace itself.
The second observer is the SUCCESSFUL workspace. `#identify` hashes `sha256(canonicalRoot)`, so
`workspaceId` is a function of the project root and not of the process generation; `#evict` removes the entry
`#entries` BEFORE cleaning up, so an `acquire` along with the root spawns the new process below
that id. In reverse order, the predecessor's late `cache.forget()` clears the successor's cache — data is lost
real material, not a passing state.

**Rule to draw when classifying a FOLLOW-UP as "mutant with many equivalent possibilities":**

1. Ask what the cleaned up resource is locked under. If key by IDENTITY (path, hash of
   root, logical name) rather than GENERATION (pid, process object), there is always an official
   closer and the argument "the final state is the same" is not enough.
2. Ask how wide the window is compared to the time it takes to rebuild. Here `terminate()` waits for the process
   child escapes within the 5 000 ms amnesty period, while cold start ~2 300 ms — a successor is born in time
   that book.
3. Measure, don't read. Copy `src/` to a draft directory outside the source tree, patch the mutant into the copy, and run it
   probe ~60 lines with fake spawner. It takes a few minutes and yields a binary answer; repo does not suffer
   hits a byte.

**Consequences for annotation writing:** Old annotations state the WRONG hazard (late notification falls into cache
of the dying workspace). Because it is stated incorrectly, no mutant can falsify it. One comment
Failure to falsify is a sign that it is describing the wrong mechanism, not a sign that the mechanism is unimportant.
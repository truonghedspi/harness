# “Same relative path” is not “same cache key”

Context: `feat-prove-diagnostics`, TCON-DIAG-0003, immutable INV-DIAG-3 ("a URI should never be
served from another workspace's cache").

## The thing was deceiving

Both the feature's `behavior`, its `falsifier`, and the condition's `rationale` use the same phrase
Very convincing reading: *two workspaces with the same relative path*. Fixture does just that — two
project root, each root has `src/main/java/fixture/Sample.java`, two real JDT LS running in parallel, one
corrupt file and one clean file. Green mug. Looks like an expensive and serious cross-workspace quarantine.

But the cache key is `(workspaceId, absolute URI)`. Cache never sees the path
relatively. The two absolute URIs are different from the start, so the URI alone is enough to distinguish `workspaceId`
is the EXTRA key component on this fixture. Mutant completely removes `workspaceId` from the key (a flat Map uses
common) runs 3/3 green. The mutant for `get()` to scan to the cache of all other workspaces is also 3/3 green.

## How to check, applicable to all cases "two X do not mix"

1. Read the REAL key in the code, listing each of its components. Here: `workspaceId` and `uri`.
2. For each component, ask: does the fixture hold it EQUAL on both sides? Only ingredients are
   kept equal to be measured by the test case. If any component is already different, the mutant deletes it from the key
   will survive.
3. Don't trust script description phrases. "Same name", "same relative path", "same identifier" are descriptive
   for readers; The new key is what the program uses. The difference between the two is the loss
   no.

## Before calling mutant is equivalent

Run the component's existing oracle unit on the mutant. Here `test/lsp/diagnostics-cache.spec.ts`
(under a 'done` feature) killed both mutants — 3 red cases and 2 red cases. That is definitive proof
that mutants are real defects and blind integration cases, not meaningless mutants. Here's how
cheapest to separate "mutant equivalent" from "blind oracle": find ANOTHER oracle in known repo to kill
get it.

## Notable side effects

This `prove` feature also leaked a product code change (canonicalized the URI with `realpathSync`).
into a component that is `done` and not in `touches`. That branch of canonicalization cannot be ca unit
does not reach, because every URI in the spec unit is a string that does not exist on disk so `realpathSync` always throws
error and falls into the fallback branch. When you see `touches` there is only the test file that the maker's notes tell about
a change in `src/`, immediately check if the new branch has any cases running to it.
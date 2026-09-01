# Verification command must be scoped to the feature's own claim

**Class**: verification-command-coupling  
**First seen**: feat-readme-standardize (2026-09-01)  
**Defect**: A verification command that gates the feature's claim on unrelated project health creates circular dependency and false failure.

## Pattern

The feature's recorded `verification` command runs a whole-project health check (like `verify-harness.mjs --target .`) BEFORE the feature-specific assertion. If the project health check fails for reasons outside this feature's scope, the verification exits 1 even though the feature's actual claim is true and reproducible.

**Example from feat-readme-standardize**:
```
verification: "node harness-loop/scripts/verify-harness.mjs --target . --skip-baseline --quiet && grep -c '^## ' README.md"
```

This exits 1 because:
- 3 other blocked features have no checkerNotes (project-layer blocker)
- This feature itself has an incomplete reviewPacket (circular: the verification fails because the handoff is incomplete, and the handoff is incomplete because the verification failed)

The README.md actually has proper structure (5 headings, real content, quick start, extension guide). The claim is TRUE. But the verification command couples it to unrelated state.

## How to catch it

1. Run the recorded verification command yourself and see it exit 1
2. Extract just the feature-specific part (`grep -c '^## ' README.md`) and run it — exits 0
3. Read the full verify-harness.mjs output: blockers are unrelated to the feature's files/claim

## The fix (for the maker)

Replace the verification command with one that judges ONLY the feature's claim:

- **Too coupled**: `verify-harness.mjs --target . && feature-specific-check`
- **Correct**: just `feature-specific-check`, or a Node script that reads only the feature's touched files

If the feature touches README.md, the verification must not fail because feature_list.json has issues.

## When to write this verdict

When:
- The feature's claim is actually true (you verified it directly)
- The recorded verification command exits 1
- The failure is in a stage BEFORE the feature-specific assertion
- That stage's failure is unrelated to the feature's `touches` files

Then: REJECT with basis=declared-contract, violatedRef="verification command must be scoped to the feature's claim", and name the unrelated blocker that made it fail.

**Do NOT reject the implementation** — the work is correct. Reject the verification contract.

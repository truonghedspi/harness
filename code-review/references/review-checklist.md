# Review checklist — bug classes by category

Use this during step 4 (the category sweep). It is a catalogue of *things that are commonly wrong*, framed so you go looking for the bug rather than confirming the absence of one. Apply only the categories relevant to the code in front of you, but check each relevant one deliberately — the bugs that ship are usually in the category the author didn't think about.

Apply language- and framework-specific knowledge on top of this. A `==` in JS, a mutable default argument in Python, an unchecked `error` return in Go, a dangling reference in Rust/C++, an `await` inside a loop that should be parallel — these are real and you should know them; this list is the language-agnostic spine.

## Correctness & logic
- Off-by-one: `<` vs `<=`, `len` vs `len-1`, loop bounds, slice/substring ranges.
- Inverted or wrong condition; De Morgan mistakes; `&&` vs `||`; negation errors.
- Operator precedence and missing parentheses.
- Integer division / truncation / rounding where a float was meant; overflow/underflow.
- Wrong default value; default that silently masks a missing input.
- Early `return`/`break`/`continue` that skips necessary cleanup or later logic.
- Copy-paste errors: a variable from the copied block left unchanged.
- Comparison of floats with `==`; comparison across types.
- A function whose behavior contradicts its name or docstring.

## Edge cases & input domain
- Empty collection, single element, exactly-at-capacity.
- Null / None / undefined / NaN / Infinity propagating silently.
- Zero, negative, the min/max value of the type.
- Duplicate keys/elements; already-sorted; all-identical; reverse order.
- Very large input (does it blow memory or time?); very long strings.
- Unicode, multibyte, normalization, surrogate pairs, embedded null bytes.
- Leading/trailing whitespace, case sensitivity, locale-dependent parsing.
- Date/time: timezones, DST, leap years/seconds, epoch boundaries, ordering of events.

## Error handling
- Errors swallowed (empty catch, ignored return value) and execution continues on bad state.
- Catching too broadly and hiding unrelated failures.
- Error message that loses the original cause / stack.
- Partial failure leaving the system in an inconsistent state (no rollback/cleanup).
- Retrying a non-idempotent operation; retry storms; no backoff.
- Validating input but then using the *unvalidated* original variable.
- `finally`/cleanup that itself can throw and mask the real error.

## Concurrency & async
- Shared mutable state without synchronization; data races.
- Check-then-act races (TOCTOU): the value can change between check and use.
- Deadlock from inconsistent lock ordering; lock held across I/O.
- `await`/promise not awaited; fire-and-forget that should be awaited.
- Sequential `await` in a loop where the calls are independent (should be parallel).
- Non-atomic compound operations assumed atomic (read-modify-write).
- Cancellation/timeout not propagated; orphaned tasks; leaked goroutines/threads.
- Reentrancy: callback re-enters and corrupts in-progress state.

## Security
- Untrusted input reaching a sink without sanitization: SQL, shell, eval, template, path, LDAP, deserialization.
- Path traversal (`../`), unsafe file names, symlink following.
- Secrets in code, logs, error messages, or URLs.
- Missing authentication/authorization check; authorization checked client-side only.
- IDOR: object referenced by user-supplied id with no ownership check.
- Weak/missing crypto, hardcoded keys, predictable randomness for security use.
- Sensitive data not redacted in logs; timing side channels in comparisons.
- Missing rate limiting on expensive or auth endpoints; ReDoS in regexes.

## Resource management
- File/socket/connection/lock acquired but not released on all paths (esp. error paths).
- Unbounded growth: caches without eviction, lists that only append, listeners never removed.
- Connection/thread pool exhaustion; missing limits.
- Leaked memory via retained references / closures capturing large objects.

## API & contract
- Breaking change to a public signature, return type, or error behavior.
- Mutating an input argument the caller still owns; returning an internal reference that can be mutated.
- Inconsistent return types (sometimes a value, sometimes null, sometimes throws).
- Nullability contract unclear; units/encoding of parameters undocumented and ambiguous.
- Side effects hidden behind an innocent-looking name.
- Backward/forward compatibility of serialized formats and schemas.

## Performance
- Accidental O(n²) (nested loops, repeated linear search, string concat in a loop).
- N+1 queries / requests; work repeated inside a loop that could be hoisted.
- Missing index assumption; full scans; loading a whole dataset to use one row.
- Premature or pointless micro-optimization that hurts readability for no measured gain (call it out the other way too).

## State, data & persistence
- Mutating shared/global/default state; aliasing bugs.
- Cache invalidation: stale reads, write-through gaps, cache and source diverging.
- Transaction boundaries wrong; non-atomic multi-step updates; missing idempotency keys.
- Migration that isn't backward compatible during a rolling deploy.
- Floating point for money; precision loss.

## Readability & maintainability
- Name that misleads about what the thing does.
- Dead code, unreachable branches, commented-out blocks.
- Duplicated logic that will drift out of sync.
- A function doing too many things; deeply nested conditionals that hide a path.
- Magic numbers/strings without explanation.
- Comment that contradicts the code (one of them is a bug — find which).

## Testing
- The change has no test, or tests only the happy path.
- Tests assert on incidental output, not on the contract.
- Flaky constructs: real time, real network, ordering assumptions, shared fixtures.
- A test that passes for the wrong reason (e.g. the assertion is never reached).
- Edge cases from the sections above that are untested.

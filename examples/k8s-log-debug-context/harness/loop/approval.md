approved

Same two review-digest false-positives as the prior batch: (1) the stale example row inside the assumptions.md HTML comment is parsed as a live A-001; (2) /REJECT/i matches the word 'reject' in feat-002's notes (not a real checker rejection). The genuine question — is feat-012's JDK-21 auto-selection the behavior wanted — is answered by the owner's direction to implement it. The behavior is proven red->green by 'env -u JAVA_HOME node harness/init.mjs'.

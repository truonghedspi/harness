package io.harness.logcontext.mcp;

import java.util.Optional;

/**
 * Validates an optional Kubernetes ServiceAccount bearer token before any MCP dispatch. Production
 * verifies real ServiceAccount JWTs; contract oracles inject a deterministic implementation. The
 * server extracts the bearer token from the request, so a missing token arrives as
 * {@code Optional.empty()} and must be treated as invalid by the validator's contract.
 */
public interface ServiceAccountJwtValidator {
  JwtValidation validate(Optional<String> bearerToken);
}

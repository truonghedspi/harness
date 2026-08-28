package io.harness.logcontext.mcp;

/**
 * Outcome of validating an optional Kubernetes ServiceAccount bearer token before any MCP dispatch.
 * {@link Invalid} covers both a missing and an invalid credential (X-007 / INV-AUTH-1); a request
 * is admitted to normal tool validation only when the validator returns {@link Valid}.
 */
public sealed interface JwtValidation permits JwtValidation.Valid, JwtValidation.Invalid {
  record Valid() implements JwtValidation {}

  record Invalid() implements JwtValidation {}
}

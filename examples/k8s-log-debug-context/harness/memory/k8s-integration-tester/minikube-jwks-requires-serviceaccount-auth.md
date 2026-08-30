---
name: minikube-jwks-requires-serviceaccount-auth
description: local minikube denies anonymous OIDC discovery and JWKS but authorizes ServiceAccounts through the built-in issuer-discovery binding
metadata:
  type: lesson
  date: 2026-08-30
---

The feat-011 chart reached healthy MCP and rejected missing and wrong-audience tokens as expected,
but also returned HTTP 401 for a correctly audience-bound ServiceAccount JWT. Safe validation-stage
diagnostics showed issuer, audience, subject and time checks had passed before JWKS refresh failed.
Bounded unauthenticated HTTPS probes to the authorized local minikube API returned 403 for both
`/.well-known/openid-configuration` and `/openid/v1/jwks`.

**Why:** This cluster does not expose issuer discovery anonymously. Its bootstrap RBAC instead binds
`system:service-account-issuer-discovery` to the `system:serviceaccounts` group for GET access to
those non-resource URLs.

**How to apply:** Keep signature/audience/issuer validation local and avoid TokenReview, but refresh
JWKS with the service's rotated projected token. Do not add project RoleBindings: first verify the
platform's built-in issuer-discovery binding. An unauthenticated health probe only proves rejection;
the journey must separately assert that a correct-audience token receives HTTP 200.

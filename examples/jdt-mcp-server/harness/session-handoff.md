# Session Handoff — JDT MCP Server

Project-router implementation is paused because its independently authored oracle still omits the condition the resolved re-plan promises.

## Current Objective

- Feature: `feat-project-router`, attempt 2/3.
- Required missing oracle: TCON-ROUTE-0005 for `INV-ROUTE-2`, asserting that a path with no ancestor `pom.xml` returns an explicit error naming that path.
- Baseline: `./harness/init.sh` green on 2026-08-21.

## Evidence

- `npm run test:integration -- test/integration/project-router.integration.spec.ts` exited 1 with `ERR_MODULE_NOT_FOUND` for `src/workspace/project-router.ts` before any assertion ran.
- `test/integration/project-router.integration.spec.ts` still says it deliberately does not cover the unmanaged-path error case and contains only TCON-ROUTE-0001 through 0004.

## Next Action

Route the feature through planner/oracle ownership so the test-implementer adds TCON-ROUTE-0005. Only then rerun the maker: obtain an assertion-level red, implement `src/workspace/project-router.ts`, and record green evidence.

The maker did not edit the independent oracle or production code.

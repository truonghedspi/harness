# Keep red-first contract oracles outside the startup baseline

## Situation

The test-implementer correctly added `IngestContractTest` before `IngestService` existed. Its five
assertion failures were useful feature evidence, but the generic `mvn verify` startup gate also
discovered the test and made every later loop iteration baseline-red.

## Durable rule

Keep pre-implementation oracles in the `contract` test package. The default Surefire configuration
excludes that package while continuing to require and run implemented-feature tests. Run a pending
contract explicitly with `-Poracle-test -Dtest=<ContractTest>`; every prove feature records that
full command in `feature_list.json`.

This separation is lifecycle state, not a skip or weakened oracle: the explicit command must remain
red before its build dependency and turn green only when the public contract exists.

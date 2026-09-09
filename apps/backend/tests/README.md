# apps/backend/tests

`unit/` (domain invariants, hypothesis-style property tests), `service/` (temp workspaces), `api/` (httpx), `golden/` (outputs against the `wise` running example and BPIC'19 numbers within tolerance).


## Dependency and distribution profiles

`WISE_TEST_PROFILE=full python -m pytest` (or `--dependency-profile=full`) requires installed analytics;
`--dependency-profile=minimal` requires its absence. Knowledge is required in
both. Full imports the three analytics API modules without optional skips;
minimal explicitly excludes them and exercises the lifecycle fallback contract.
The distribution test installs built wheels in a temporary target and checks
pack resources, migrations, SPA assets and API precedence outside the source
tree. See [exact clean CI and release commands](../DISTRIBUTION.md).

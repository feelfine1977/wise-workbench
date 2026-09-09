# Compatibility and release checks

## Supported profiles

| Profile | Method | Rendering/content | Purpose |
|---|---|---|---|
| Workbench full (default installer) | Classic wise-pm 0.1.0, release commit `df5db50b839cc124b489a269894f5a2bfe7dc634` | Packaged @wise/flow 0.3.1; local versioned analytics and knowledge packages | Complete local application |
| Workbench minimal API | Same classic method | Knowledge included, analytics absent; no promise of the full analysis UI | Explicit fallback API contract |
| Method extension | Separate `feat/actionability-ocpm-local-llm` development build | Explicit evidence, object-centric and assistant/evaluation imports | Opt-in library work in a separate environment |

Python 3.12/3.13 are the Workbench CI runtimes. Node 24 is the frontend build runtime; flow also tests Node 22. React 19 is the app's renderer peer. The exact frontend dependency graph is in `apps/frontend/package-lock.json`.

The extension does not replace classic main. Its passing method/application tests establish compatibility for the paths exercised, not equivalence of all optional behavior. Workbench's runtime capability selection remains planned. Do not interpret installing extension modules as enabling them for users.

## What CI requires

- Full backend tests on both Python versions with analytics and knowledge installed. Required imports are checked before pytest.
- Minimal-profile fallback and exact OpenAPI tests without analytics.
- Exact OpenAPI regeneration on both runtimes and generated TypeScript drift checks.
- Analytics and knowledge package tests.
- Artifact checksum verification, clean npm installation, direct Node flow import, frontend types/lint/unit tests and live-mode build.
- Browser map/filter/board/model checks using the actual packaged renderer, including visible BPMN attribution.
- Installed knowledge/analytics/application wheels outside the checkout; schemas, both packs, health, SPA root and deep links must work.

The source-control workflows are prepared checks; they only become GitHub results after the reviewed changes are committed and pushed. A locally passing command must not be reported as a remote CI pass. Dataset-dependent and live-model tests are optional gates whose skips must remain visible.

## Release inputs

The frontend's checked-in renderer artifact has a SHA-256 and source file identities in `vendor/wise-flow.provenance.json`. If `hasUncommittedChanges` is true, its base commit alone does not identify that artifact's source. Before a public release:

1. Review and commit the flow source and test it; refresh the artifact from the clean committed checkout.
2. Commit the matching tarball, provenance and frontend lockfile in Workbench; run all integration checks.
3. Build application, analytics and knowledge wheels together and retain checksums and dependency versions.
4. Tag/package versions only after the checks pass. Publication and licence changes are separate owner decisions.

Do not modify stable tags or rewrite already published history to absorb cleanup. The temporary vendored distribution can be replaced by an exact published npm version once that release exists.

## Working tree and reproducibility

Code revisions, package versions and enabled features are different identities. A version string alone does not record an uncommitted source change. Keep private event logs, workspaces, credentials and development transcripts outside release artifacts. Synthetic examples and public fixtures are suitable for the required installation tests.

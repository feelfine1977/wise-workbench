# Packaged process renderer

This directory holds the real `@wise/flow` npm artifact used by the frontend. It is a required dependency, installed by `npm ci`, including in a fresh checkout without a sibling flow repository.

The registry release is not part of this change. A checked-in tarball is the bootstrap distribution boundary until an exact published version can replace it. It avoids shipping a placeholder map or depending on an unpushed source commit. The renderer remains maintained only in the [wise-flow repository](https://github.com/feelfine1977/wise-flow).

`wise-flow.provenance.json` records the artifact checksum, source base commit, whether that source has uncommitted changes, and content hashes of its source files. A dirty source build is explicitly marked; its base commit alone is not claimed to reproduce the artifact. Commit the reviewed flow source before tagging a release, then refresh provenance from that clean checkout.

To update:

1. Run the flow repository's tests and packed-consumer checks; build and pack the artifact.
2. Run `python tools/vendor_flow.py --source /path/to/wise-flow --tarball /path/to/wise-flow-VERSION.tgz`.
3. Update the frontend's exact file dependency if the version changed; regenerate its lockfile with `npm install --package-lock-only`.
4. Run `node tools/verify-vendor.mjs`, then a clean frontend `npm ci`, typecheck, tests, build and map/model browser checks.
5. Review and commit artifact, provenance and lockfile together. Never modify generated renderer files in this repository.

PolyForm Noncommercial 1.0.0 applies to wise-flow. Its artifact carries the project licence and notices for the copied BPMN assets. The model view must retain visible bpmn.io attribution.

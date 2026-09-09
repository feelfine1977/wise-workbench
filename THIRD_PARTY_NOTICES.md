# Third-party notices

WISE Workbench is licensed under PolyForm Noncommercial 1.0.0. Dependencies retain their own licences; this document does not replace the licence files shipped in installed packages.

- **wise-pm**: MIT; see the [core repository](https://github.com/feelfine1977/wise-pm/blob/main/LICENSE).
- **@wise/flow**: PolyForm Noncommercial 1.0.0; the vendored package includes its licence and provenance in `vendor/`.
- **bpmn-js**: the BPMN renderer includes required bpmn.io attribution. Its [version 17.11.1 licence](https://github.com/bpmn-io/bpmn-js/blob/v17.11.1/LICENSE) requires the watermark to remain fully visible. Workbench preserves it in model views, including compact and full-window layouts. The flow artifact carries the renderer's licence alongside its copied assets.

Other direct and transitive dependencies are identified by `apps/frontend/package-lock.json` and the Python package metadata. Retain their notices when redistributing built artifacts. None of the project-level documentation grants an exception to a third-party licence.

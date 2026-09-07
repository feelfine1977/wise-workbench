# ADR 0012 — The workbench runs on the classic method library; the actionability extension is opt-in

Status: accepted (2026-09-06)

## Context

The method library `wise-pm` is being extended on a separate development
branch with an evidence and review layer: evaluation records with raw
measurements and witnesses, run manifests, typed diagnostics, a shared
baseline specification and exact comparator-consistent explanations, and
later optional object-centric checks. The released library on `main` does
not have those capabilities.

The workbench must keep working for everyone on the released library.
Some users will want the extra capabilities and can install the extension
build instead. Results produced with the two builds must never be confused.

## Decision

1. **The default is the classic library.** The workbench depends on
   `wise-pm >=0.1,<0.2` from the released package and uses only its public
   API. Every screen, job and export works with it. No feature of the
   application requires the extension.
2. **The extension is detected, never assumed.** A capability probe at
   startup checks for the extension's modules (for example `wise.evidence`
   and `wise.explain`) with `importlib.util.find_spec`, not by version
   number, because the extension branch deliberately keeps the released
   version string. The probe result is exposed at `GET /api/v1/system/version`
   as a capability list.
3. **A setting decides how it is used.** `WISE_ACTIONABILITY` takes
   `auto` (default: use the extra capabilities when they are present),
   `off` (never use them, even when installed, so results stay comparable
   with a classic installation) and `on` (require them; the service refuses
   to start with a clear message when they are absent).
4. **The engine adapter is the only place that knows.** Extension calls
   live behind the same adapter that imports the library today, each behind
   a capability check with a classic fallback that produces the same
   numbers by the existing path.
5. **Provenance records the build.** Every run manifest records the library
   version and the capability set that produced it. A result computed with
   extension capabilities is labelled in the interface and in exports.
   Comparing runs made under different capability sets warns rather than
   silently mixing them.
6. **The interface offers what exists.** Capability-dependent controls
   appear only when the capability is present. A settings page states which
   build is installed and what it adds. There is no disabled button whose
   purpose the user cannot reach.
7. **Two prepared environments.** The default installation resolves the
   released library. An opt-in actionability installation replaces that one
   package in the same environment, or uses a separate environment or
   container profile. Switching is one install command and a restart; no
   application code changes.

## Consequences

The extension can develop on its branch at its own pace without holding up
the application, and without a partly finished library ever reaching a
normal user. The application's own suites, run against both builds, are the
compatibility gate for the extension: any difference in their results is a
break in the library's backwards compatibility, not a new feature.

Continuous integration keeps testing the released library only, because the
extension branch is not published; the dual run is performed locally before
each extension stage is accepted.

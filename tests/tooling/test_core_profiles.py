"""Offline installer and installed-metadata checks; no existing environments are touched."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CHECKER = ROOT / "tools/check-core-profile.py"
REPOSITORY = "https://github.com/feelfine1977/wise-pm.git"
CLASSIC = "df5db50b839cc124b489a269894f5a2bfe7dc634"
NEXT = "9c5e6db807ece6f2fe02857082dfd8cd87bf019c"


def clean_environment() -> dict[str, str]:
    return {key: value for key, value in os.environ.items() if not key.startswith(("WISE_", "PYTHON"))}


class ProvenanceTests(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory(prefix="wise-core-provenance-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.site = self.root / "site-packages"
        self.package = self.site / "wise"
        self.package.mkdir(parents=True)
        self.module = self.package / "__init__.py"
        self.module.write_text('__version__ = "0.1.0"\n')
        self.dist = self.site / "wise_pm-0.1.0.dist-info"
        self.dist.mkdir()
        (self.dist / "METADATA").write_text("Metadata-Version: 2.1\nName: wise-pm\nVersion: 0.1.0\n")
        (self.dist / "RECORD").write_text("wise/__init__.py,,\n")
        self.provenance = {
            "url": REPOSITORY,
            "vcs_info": {"vcs": "git", "commit_id": NEXT, "requested_revision": NEXT},
            "subdirectory": "packages/wise-pm",
        }

    def run_check(self, core: str = "next", *, shadow: Path | None = None) -> subprocess.CompletedProcess[str]:
        environment = clean_environment()
        environment["PYTHONPATH"] = os.pathsep.join(str(path) for path in (shadow, self.site) if path is not None)
        # -S excludes the user's installed packages but preserves our synthetic metadata/import path.
        return subprocess.run(
            [sys.executable, "-S", str(CHECKER), "--core", core],
            env=environment,
            cwd=self.root,
            capture_output=True,
            text=True,
            check=False,
        )

    def write_provenance(self) -> None:
        (self.dist / "direct_url.json").write_text(json.dumps(self.provenance))

    def assert_failure(self, message: str, **kwargs) -> None:
        result = self.run_check(**kwargs)
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn(message, result.stderr)
        self.assertNotIn("Traceback", result.stderr)
        self.assertEqual(result.stdout, "")

    def test_both_profiles_verify_actual_import_and_provenance(self) -> None:
        for core, commit, subdirectory in (
            ("next", NEXT, "packages/wise-pm"),
            ("classic", CLASSIC, ""),
        ):
            with self.subTest(core=core):
                self.provenance["vcs_info"].update(commit_id=commit, requested_revision=commit)
                if subdirectory:
                    self.provenance["subdirectory"] = subdirectory
                else:
                    self.provenance.pop("subdirectory", None)
                self.write_provenance()
                result = self.run_check(core)
                self.assertEqual(result.returncode, 0, result.stderr)
                report = json.loads(result.stdout)
                self.assertEqual(report["commit"], commit)
                self.assertEqual(report["subdirectory"], subdirectory)
                self.assertEqual(report["module"], str(self.module.resolve()))

    def test_wrong_commit_fails_even_with_same_version(self) -> None:
        self.provenance["vcs_info"]["commit_id"] = CLASSIC
        self.write_provenance()
        self.assert_failure("next commit mismatch")

    def test_branch_request_fails_even_when_resolved_commit_matches(self) -> None:
        self.provenance["vcs_info"]["requested_revision"] = "main"
        self.write_provenance()
        self.assert_failure("requested revision mismatch")

    def test_wrong_repository_fails(self) -> None:
        self.provenance["url"] = "https://example.org/wise-pm.git"
        self.write_provenance()
        self.assert_failure("repository mismatch")

    def test_missing_or_wrong_subdirectory_fails(self) -> None:
        for subdirectory in (None, "wise-pm", "packages/other"):
            with self.subTest(subdirectory=subdirectory):
                if subdirectory is None:
                    self.provenance.pop("subdirectory", None)
                else:
                    self.provenance["subdirectory"] = subdirectory
                self.write_provenance()
                self.assert_failure("subdirectory mismatch")

    def test_classic_rejects_subdirectory(self) -> None:
        self.provenance["vcs_info"].update(commit_id=CLASSIC, requested_revision=CLASSIC)
        self.write_provenance()
        self.assert_failure("classic subdirectory mismatch", core="classic")

    def test_missing_metadata_fails(self) -> None:
        shutil.rmtree(self.dist)
        self.assert_failure("wise-pm is not installed")

    def test_missing_direct_url_fails(self) -> None:
        self.assert_failure("no direct_url.json")

    def test_malformed_direct_url_fails(self) -> None:
        for raw, message in (
            ("{", "not valid JSON"),
            ("[]", "must be an object"),
            ("null", "must be an object"),
        ):
            with self.subTest(raw=raw):
                (self.dist / "direct_url.json").write_text(raw)
                self.assert_failure(message)

    def test_local_editable_and_invalid_vcs_fail(self) -> None:
        for vcs in (None, [], {"vcs": "hg"}):
            with self.subTest(vcs=vcs):
                self.provenance["vcs_info"] = vcs
                self.write_provenance()
                self.assert_failure("Git VCS provenance")
        self.provenance = {
            "url": "file:///tmp/wise-core",
            "dir_info": {"editable": True},
        }
        self.write_provenance()
        self.assert_failure("Git VCS provenance")

    def test_missing_recorded_module_fails(self) -> None:
        self.write_provenance()
        (self.dist / "RECORD").unlink()
        self.assert_failure("does not record wise/__init__.py")

    def test_module_shadowing_fails_despite_matching_version(self) -> None:
        self.write_provenance()
        shadow = self.root / "checkout"
        (shadow / "wise").mkdir(parents=True)
        (shadow / "wise/__init__.py").write_text('__version__ = "0.1.0"\n')
        self.assert_failure("module path mismatch", shadow=shadow)

    def test_import_must_actually_succeed(self) -> None:
        self.write_provenance()
        self.module.write_text('raise ImportError("broken core dependency")\n')
        self.assert_failure("wise cannot be imported: broken core dependency")


# Stand-ins record commands and simulate venv creation. Only --requirement runs real code.
# All pip/npm calls stay offline and confined to each temporary checkout.
FAKE_COMMAND = """\
import json
import os
import shutil
import sys
from pathlib import Path

name = Path(sys.argv[0]).name
args = sys.argv[1:]
with open(os.environ['PROFILE_CALL_LOG'], 'a') as stream:
    stream.write(json.dumps({'command': name, 'args': args, 'cwd': os.getcwd()}) + '\\n')
if name == 'bootstrap':
    if args[:2] == ['-m', 'venv']:
        target = Path(args[2]) / 'bin/python'
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(__file__, target)
        target.chmod(0o755)
    elif args and args[0].endswith('check-core-profile.py'):
        os.execv(sys.executable, [sys.executable, *args])
elif name == 'python' and args and args[0].endswith('check-core-profile.py'):
    sys.exit(int(os.environ.get('PROFILE_VERIFY_EXIT', '0')))
"""


class InstallerTests(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory(prefix="wise-core-install-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve() / "checkout with spaces"
        (self.root / "tools").mkdir(parents=True)
        (self.root / "apps/frontend").mkdir(parents=True)
        (self.root / "apps/backend").mkdir(parents=True)
        for name in ("install.sh", "check-core-profile.py"):
            shutil.copyfile(ROOT / "tools" / name, self.root / "tools" / name)
        self.bin = self.root / "fake-bin"
        self.bin.mkdir()
        for name in ("bootstrap", "node", "npm"):
            command = self.bin / name
            command.write_text(f"#!{sys.executable}\n{FAKE_COMMAND}")
            command.chmod(0o755)
        self.log = self.root / "calls.jsonl"
        self.environment = clean_environment()
        self.environment.update(
            PATH=f"{self.bin}{os.pathsep}{os.environ['PATH']}",
            WISE_BOOTSTRAP_PYTHON=str(self.bin / "bootstrap"),
            PROFILE_CALL_LOG=str(self.log),
        )

    def install(self, *args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["bash", str(self.root / "tools/install.sh"), *args],
            env=self.environment,
            cwd=self.root,
            text=True,
            capture_output=True,
            check=False,
        )

    def calls(self) -> list[dict]:
        return [json.loads(line) for line in self.log.read_text().splitlines()] if self.log.exists() else []

    def assert_install(self, args: tuple[str, ...], core: str, *, dev: bool = False) -> None:
        result = self.install(*args)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        venv = self.root / "apps/backend" / (".venv-next" if core == "next" else ".venv")
        self.assertTrue((venv / "bin/python").is_file())
        calls = self.calls()
        pip_calls = [call["args"] for call in calls if call["args"][:3] == ["-m", "pip", "install"]]
        self.assertEqual(len(pip_calls), 2)
        commit = NEXT if core == "next" else CLASSIC
        fragment = "#subdirectory=packages/wise-pm" if core == "next" else ""
        self.assertEqual(
            pip_calls[0],
            [
                "-m",
                "pip",
                "install",
                "--force-reinstall",
                "--no-deps",
                f"wise-pm @ git+{REPOSITORY}@{commit}{fragment}",
            ],
        )
        suffix = "[dev]" if dev else ""
        expected = ["-m", "pip", "install"]
        for package in (
            "packages/process-knowledge",
            "packages/wise-analytics",
            "apps/backend",
        ):
            expected.extend(["-e", f"{self.root / package}{suffix}"])
        self.assertEqual(pip_calls[1], expected)
        verifications = [call for call in calls if call["command"] == "python" and "--core" in call["args"]]
        self.assertEqual(
            [call["args"] for call in verifications],
            [[str(self.root / "tools/check-core-profile.py"), "--core", core]],
        )
        self.assertEqual(
            calls[-1],
            {"command": "npm", "args": ["ci"], "cwd": str(self.root / "apps/frontend")},
        )

    def test_default_remains_classic(self) -> None:
        self.assert_install((), "classic")
        self.assertFalse((self.root / "apps/backend/.venv-next").exists())

    def test_explicit_classic_with_dev(self) -> None:
        self.assert_install(("--core", "classic", "--dev"), "classic", dev=True)

    def test_next_preserves_classic_environment(self) -> None:
        classic = self.root / "apps/backend/.venv"
        classic.mkdir()
        sentinel = classic / "keep.txt"
        sentinel.write_text("original environment\n")
        self.assert_install(("--dev", "--core", "next"), "next", dev=True)
        self.assertEqual(list(classic.iterdir()), [sentinel])
        self.assertEqual(sentinel.read_text(), "original environment\n")

    def test_next_with_dev_last(self) -> None:
        self.assert_install(("--core", "next", "--dev"), "next", dev=True)

    def test_equals_selection(self) -> None:
        self.assert_install(("--core=next",), "next")

    def test_existing_next_environment_is_reused_and_core_reinstalled(self) -> None:
        venv_python = self.root / "apps/backend/.venv-next/bin/python"
        venv_python.parent.mkdir(parents=True)
        shutil.copyfile(self.bin / "bootstrap", venv_python)
        venv_python.chmod(0o755)
        self.assert_install(("--core", "next"), "next")
        self.assertFalse(any(call["args"][:2] == ["-m", "venv"] for call in self.calls()))

    def test_invalid_selection_fails_before_any_commands(self) -> None:
        for args in (
            ("--core",),
            ("--core=",),
            ("--core", "future"),
            ("--core", "--dev"),
            ("--typo",),
            ("next",),
        ):
            with self.subTest(args=args):
                result = self.install(*args)
                self.assertEqual(result.returncode, 2)
                self.assertIn("Usage:", result.stderr)
                self.assertEqual(self.calls(), [])

    def test_help_needs_no_runtime(self) -> None:
        result = self.install("--help")
        self.assertEqual(result.returncode, 0)
        self.assertIn("--core classic|next", result.stdout)
        self.assertEqual(self.calls(), [])

    def test_candidate_symlink_is_rejected_before_commands(self) -> None:
        (self.root / "apps/backend/.venv").mkdir()
        (self.root / "apps/backend/.venv-next").symlink_to(".venv", target_is_directory=True)
        result = self.install("--core", "next")
        self.assertEqual(result.returncode, 1)
        self.assertIn("separate virtual environment", result.stderr)
        self.assertEqual(self.calls(), [])

    def test_provenance_failure_stops_before_frontend_and_success_message(self) -> None:
        self.environment["PROFILE_VERIFY_EXIT"] = "1"
        result = self.install("--core", "next")
        self.assertEqual(result.returncode, 1)
        self.assertNotIn("Installed", result.stdout)
        self.assertFalse(any(call["command"] == "npm" for call in self.calls()))


if __name__ == "__main__":
    unittest.main()

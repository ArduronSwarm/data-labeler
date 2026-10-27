"""Regression tests for required-check coverage and untrusted workflow data."""
import copy
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import yaml

from validate import ContractError, read_yaml, validate_profile, validate_workflows


GATE = Path(__file__).with_name("aggregate.py").read_text(encoding="utf-8")


def fixture(root):
    profile = {"schemaVersion": 1, "standardVersion": "1.0.0", "coverage": "application", "suites": [{"job": "unit", "scope": "application"}]}
    caller = {
        "name": "CI",
        "on": {event: {"branches": ["main", "development", "staging"]} for event in ("pull_request", "push")},
        "permissions": {"contents": "read"},
        "concurrency": {"group": "ci-${{ github.ref }}", "cancel-in-progress": "true"},
        "jobs": {
            "quality": {"uses": "./.github/workflows/_ci-quality.yml", "with": {"coverage": "application"}},
            "unit": {"runs-on": "ubuntu-latest", "timeout-minutes": "10", "steps": [{"run": "npm test"}]},
            "ci-required": {"name": "ci-required", "runs-on": "ubuntu-latest", "if": "always()", "needs": ["quality", "unit"], "steps": [{"env": {"CI_NEEDS": "${{ toJSON(needs) }}", "CI_EXPECTED_JOBS": '["quality", "unit"]', "CI_COVERAGE": "application"}, "run": "python3 - <<'PY'\n" + GATE + "PY\n"}]},
        },
    }
    reusable = {"name": "Quality", "on": {"workflow_call": {}}, "permissions": {"contents": "read"}, "jobs": {"contracts": {"runs-on": "ubuntu-latest", "steps": [{"run": "python --version"}]}}}
    (root / ".github/workflows").mkdir(parents=True)
    write_profile(root, profile)
    write_workflow(root, "ci.yml", caller)
    write_workflow(root, "_ci-quality.yml", reusable)
    return profile, caller, reusable


def write_profile(root, profile):
    (root / ".github/ar2920-ci.json").write_text(json.dumps(profile), encoding="utf-8")


def write_workflow(root, name, value):
    (root / ".github/workflows" / name).write_text(yaml.safe_dump(value, sort_keys=False), encoding="utf-8")


class ProfileTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=os.environ.get("AR2920_TEST_TMP"))
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.profile, self.caller, self.reusable = fixture(self.root)

    def validate(self):
        write_profile(self.root, self.profile)
        write_workflow(self.root, "ci.yml", self.caller)
        return validate_workflows(self.root, validate_profile(self.root))

    def test_valid_application_contract(self):
        self.assertEqual(self.validate()["workflowFiles"], 2)

    def test_automation_only_profile_is_explicit(self):
        self.profile.update(coverage="automation-contracts", suites=[])
        del self.caller["jobs"]["unit"]
        self.caller["jobs"]["quality"]["with"]["coverage"] = "automation-contracts"
        self.caller["jobs"]["ci-required"]["needs"] = ["quality"]
        self.caller["jobs"]["ci-required"]["steps"][0]["env"].update(CI_EXPECTED_JOBS='["quality"]', CI_COVERAGE="automation-contracts")
        self.validate()

    def test_application_without_suite_fails(self):
        self.profile["suites"] = []
        with self.assertRaisesRegex(ContractError, "requires an application suite"):
            self.validate()

    def test_empty_application_commands_fail(self):
        self.caller["jobs"]["unit"]["steps"] = [{"run": "   "}]
        with self.assertRaisesRegex(ContractError, "no commands"):
            self.validate()

    def test_echo_is_not_application_testing(self):
        self.caller["jobs"]["unit"]["steps"] = [{"run": "echo complete"}]
        with self.assertRaisesRegex(ContractError, "test/check command"):
            self.validate()

    def test_main_pr_coverage_cannot_be_omitted(self):
        self.caller["on"]["pull_request"]["branches"] = ["development"]
        with self.assertRaisesRegex(ContractError, "must cover"):
            self.validate()

    def test_path_filter_cannot_hide_required_gate(self):
        self.caller["on"]["pull_request"]["paths"] = ["src/**"]
        with self.assertRaisesRegex(ContractError, "filter required checks"):
            self.validate()

    def test_conditional_suite_is_rejected(self):
        self.caller["jobs"]["unit"]["if"] = "false"
        with self.assertRaisesRegex(ContractError, "conditionally omitted"):
            self.validate()

    def test_ignored_test_failure_is_rejected(self):
        self.caller["jobs"]["unit"]["continue-on-error"] = "true"
        with self.assertRaisesRegex(ContractError, "fail CI"):
            self.validate()

    def test_gate_cannot_forget_suite(self):
        self.caller["jobs"]["ci-required"]["needs"] = ["quality"]
        with self.assertRaisesRegex(ContractError, "await every"):
            self.validate()

    def test_gate_must_always_run(self):
        del self.caller["jobs"]["ci-required"]["if"]
        with self.assertRaisesRegex(ContractError, "always"):
            self.validate()

    def test_quality_does_not_inherit_secrets(self):
        self.caller["jobs"]["quality"]["secrets"] = "inherit"
        with self.assertRaisesRegex(ContractError, "does not accept"):
            self.validate()

    def test_quality_cannot_be_conditionally_omitted(self):
        self.caller["jobs"]["quality"]["if"] = "false"
        with self.assertRaisesRegex(ContractError, "may not be skipped"):
            self.validate()

    def test_gate_may_not_ignore_failure(self):
        self.caller["jobs"]["ci-required"]["steps"][0]["continue-on-error"] = "true"
        with self.assertRaisesRegex(ContractError, "may not be ignored"):
            self.validate()

    def test_gate_script_drift_is_rejected(self):
        self.caller["jobs"]["ci-required"]["steps"][0]["run"] += "exit 0\n"
        with self.assertRaisesRegex(ContractError, "tested aggregate"):
            self.validate()

    def test_gate_declared_dependencies_must_match_needs(self):
        self.caller["jobs"]["ci-required"]["steps"][0]["env"]["CI_EXPECTED_JOBS"] = '["quality"]'
        with self.assertRaisesRegex(ContractError, "dependency environment differs"):
            self.validate()

    def test_floating_external_action_is_rejected(self):
        self.caller["jobs"]["unit"]["steps"].insert(0, {"uses": "actions/checkout@v4"})
        with self.assertRaisesRegex(ContractError, "full commit SHA"):
            self.validate()

    def test_pinned_external_action_is_accepted(self):
        self.caller["jobs"]["unit"]["steps"].insert(0, {"uses": "actions/checkout@" + "a" * 40})
        self.validate()

    def test_missing_local_workflow_fails(self):
        self.caller["jobs"]["quality"]["uses"] = "./.github/workflows/missing.yml"
        with self.assertRaisesRegex(ContractError, "missing local"):
            self.validate()

    def test_duplicate_yaml_keys_are_rejected(self):
        path = self.root / "invalid.yml"
        path.write_text("name: first\nname: second\n", encoding="utf-8")
        with self.assertRaisesRegex(ContractError, "Duplicate YAML key"):
            read_yaml(path)

    def test_yaml_on_remains_an_event_key(self):
        self.assertIn("on", read_yaml(self.root / ".github/workflows/ci.yml"))


class AggregateTests(unittest.TestCase):
    def run_gate(self, result="success", *, needs=None, expected=None):
        environment = dict(os.environ, CI_NEEDS=json.dumps(needs if needs is not None else {"quality": {"result": "success"}, "unit": {"result": result}}), CI_EXPECTED_JOBS=json.dumps(expected if expected is not None else ["quality", "unit"]), CI_COVERAGE="application")
        environment.pop("GITHUB_STEP_SUMMARY", None)
        return subprocess.run([sys.executable, "-c", GATE], env=environment, capture_output=True, text=True)

    def test_all_success_is_required(self):
        self.assertEqual(self.run_gate().returncode, 0)

    def test_failure_cancellation_and_skips_cannot_pass(self):
        for result in ["failure", "cancelled", "skipped", None]:
            with self.subTest(result=result):
                self.assertNotEqual(self.run_gate(result).returncode, 0)

    def test_missing_or_unexpected_dependency_cannot_pass(self):
        self.assertNotEqual(self.run_gate(needs={}).returncode, 0)
        self.assertNotEqual(self.run_gate(expected=["quality"]).returncode, 0)


if __name__ == "__main__":
    unittest.main()

"""Validate the vendored CI contract without contacting services or reading secrets."""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path

import yaml

VERSION = "1.0.0"
BRANCHES = {"main", "development", "staging"}
ACTION_SHA = re.compile(r"^[^@\s]+@[0-9a-f]{40}$")
TEST_COMMAND = re.compile(r"(?:\btests?\b|\bpytest\b|\bunittest\b|\btypecheck\b|\btsc\b|\bcheck-config\b|\bterraform\s+validate\b)", re.I)


class ContractError(ValueError):
    pass


class UniqueLoader(yaml.BaseLoader):
    """Preserve Actions' `on` key and reject silently overwritten YAML keys."""


def _unique_mapping(loader, node):
    pairs = loader.construct_pairs(node)
    result = {}
    for key, value in pairs:
        if not isinstance(key, str):
            raise ContractError("Workflow mapping keys must be strings")
        if key in result:
            raise ContractError(f"Duplicate YAML key: {key}")
        result[key] = value
    return result


UniqueLoader.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, _unique_mapping)


def read_yaml(path: Path):
    try:
        value = yaml.load(path.read_text(encoding="utf-8-sig"), Loader=UniqueLoader)
    except (yaml.YAMLError, OSError) as error:
        raise ContractError(f"Cannot parse {path.name}: {error}") from error
    if not isinstance(value, dict):
        raise ContractError(f"{path.name} must be a YAML mapping")
    return value


def require(condition, message):
    if not condition:
        raise ContractError(message)


def as_list(value):
    return value if isinstance(value, list) else [value]


def validate_profile(root: Path):
    path = root / ".github/ar2920-ci.json"
    try:
        profile = json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError) as error:
        raise ContractError(f"Cannot read CI profile: {error}") from error
    require(profile.get("schemaVersion") == 1, "Unsupported CI profile schemaVersion")
    require(profile.get("standardVersion") == VERSION, "CI package/profile versions differ")
    require(profile.get("coverage") in {"application", "automation-contracts"}, "Unknown coverage profile")
    suites = profile.get("suites")
    require(isinstance(suites, list), "suites must be an explicit list")
    ids = []
    for suite in suites:
        require(isinstance(suite, dict), "Every suite must be an object")
        job = suite.get("job")
        require(isinstance(job, str) and re.fullmatch(r"[a-zA-Z_][a-zA-Z0-9_-]*", job), "Invalid suite job id")
        require(job not in {"quality", "ci-required"}, "Reserved suite job id")
        require(suite.get("scope") in {"application", "configuration", "deployment", "monitoring", "tooling"}, "Unknown suite scope")
        ids.append(job)
    require(len(ids) == len(set(ids)), "Duplicate suite job id")
    if profile["coverage"] == "application":
        require(any(s["scope"] == "application" for s in suites), "Application coverage requires an application suite")
    return profile


def validate_workflows(root: Path, profile):
    directory = root / ".github/workflows"
    files = sorted([*directory.glob("*.yml"), *directory.glob("*.yaml")])
    require(bool(files), "No workflows found")
    workflows = {}
    action_count = 0
    for path in files:
        document = read_yaml(path)
        require("on" in document, f"{path.name}: missing workflow events")
        jobs = document.get("jobs")
        require(isinstance(jobs, dict) and jobs, f"{path.name}: jobs must be a nonempty mapping")
        for job_id, job in jobs.items():
            require(isinstance(job, dict), f"{path.name}/{job_id}: invalid job")
            references = [job["uses"]] if "uses" in job else []
            steps = job.get("steps", [])
            require(isinstance(steps, list), f"{path.name}/{job_id}: steps must be a list")
            for step in steps:
                require(isinstance(step, dict), f"{path.name}/{job_id}: invalid step")
                if "uses" in step:
                    references.append(step["uses"])
            for reference in references:
                require(isinstance(reference, str), f"{path.name}: uses must be a string")
                if reference.startswith("./"):
                    target = (root / reference).resolve()
                    require(target.is_relative_to(root.resolve()), f"{path.name}: local action escapes repository")
                    require(target.exists(), f"{path.name}: missing local action/workflow {reference}")
                else:
                    require(bool(ACTION_SHA.fullmatch(reference)), f"{path.name}: external action must use a full commit SHA: {reference}")
                    action_count += 1
        workflows[path.name] = document

    require("ci.yml" in workflows and "_ci-quality.yml" in workflows, "Missing standard CI entrypoint/reusable workflow")
    caller = workflows["ci.yml"]
    events = caller.get("on", {})
    require(isinstance(events, dict), "CI events must declare branch coverage")
    for event in ("pull_request", "push"):
        config = events.get(event)
        require(isinstance(config, dict), f"CI must run on {event}")
        require(set(config.get("branches", [])) == BRANCHES, f"CI {event} must cover main, development and staging")
        require(not any(k in config for k in ("paths", "paths-ignore", "branches-ignore")), "CI entrypoint must not filter required checks by paths")
    require(caller.get("permissions") == {"contents": "read"}, "CI caller permissions must be contents: read")
    require(caller.get("concurrency", {}).get("cancel-in-progress") == "true", "CI must cancel superseded runs")
    jobs = caller["jobs"]
    expected_suites = {suite["job"] for suite in profile["suites"]}
    require(set(jobs) == expected_suites | {"quality", "ci-required"}, "CI jobs and declared suite profile differ")
    quality = jobs["quality"]
    require(quality.get("uses") == "./.github/workflows/_ci-quality.yml", "CI quality must use the local reusable workflow")
    require(quality.get("with", {}).get("coverage") == profile["coverage"], "Reusable workflow coverage differs from profile")
    require("secrets" not in quality, "Quality workflow does not accept repository secrets")
    require("if" not in quality and "continue-on-error" not in quality, "Quality validation may not be skipped or ignored")
    for suite in profile["suites"]:
        job = jobs[suite["job"]]
        require("if" not in job, f"Suite {suite['job']} must not be conditionally omitted")
        commands = [step.get("run", "").strip() for step in job.get("steps", []) if step.get("run", "").strip()]
        require(bool(commands), f"Suite {suite['job']} has no commands")
        require("continue-on-error" not in job, f"Suite {suite['job']} must fail CI on errors")
        require(not any(step.get("continue-on-error") == "true" for step in job.get("steps", [])), f"Suite {suite['job']} may not ignore test failures")
        if suite["scope"] == "application":
            require(any(TEST_COMMAND.search(command) for command in commands), f"Application suite {suite['job']} lacks a test/check command")
        require(bool(job.get("timeout-minutes")), f"Suite {suite['job']} needs an execution timeout")
    gate = jobs["ci-required"]
    require(gate.get("name") == "ci-required", "Required check name must be stable")
    require(gate.get("if", "").replace("${{", "").replace("}}", "").strip() == "always()", "Required gate must use always()")
    require(set(as_list(gate.get("needs", []))) == expected_suites | {"quality"}, "Required gate must await every expected suite")
    require(len(gate.get("steps", [])) == 1, "Required gate must contain one aggregate step")
    gate_step = gate["steps"][0]
    require("continue-on-error" not in gate and "continue-on-error" not in gate_step, "Gate failures may not be ignored")
    require(gate_step.get("env", {}).get("CI_NEEDS") == "${{ toJSON(needs) }}", "Gate must inspect all dependency results")
    require(set(json.loads(gate_step.get("env", {}).get("CI_EXPECTED_JOBS", "[]"))) == expected_suites | {"quality"}, "Gate dependency environment differs from profile")
    require(gate_step.get("env", {}).get("CI_COVERAGE") == profile["coverage"], "Gate coverage summary differs from profile")
    gate_source = gate_step.get("run", "")
    expected_gate = "python3 - <<'PY'\n" + Path(__file__).with_name("aggregate.py").read_text(encoding="utf-8") + "PY\n"
    require(gate_source == expected_gate, "Gate must use the tested aggregate implementation")
    reusable = workflows["_ci-quality.yml"]
    require("workflow_call" in reusable.get("on", {}), "Quality workflow must be reusable locally")
    require(reusable.get("permissions") == {"contents": "read"}, "Quality workflow permissions must be contents: read")
    return {"workflowFiles": len(files), "pinnedExternalReferences": action_count}


def check_helpers(root: Path):
    scripts = root / ".github/scripts"
    counts = {"javascript": 0, "shell": 0, "automationTests": 0, "automationProfileValidated": False}
    if not scripts.exists():
        return counts
    for path in sorted(scripts.rglob("*")):
        if not path.is_file():
            continue
        if path.suffix in {".js", ".mjs", ".cjs"}:
            subprocess.run(["node", "--check", str(path)], check=True, cwd=root)
            counts["javascript"] += 1
        elif path.suffix == ".sh":
            subprocess.run([os.environ.get("AR2920_BASH", "bash"), "-n", str(path)], check=True, cwd=root)
            counts["shell"] += 1
    automation_profile = root / ".github/automation.config.json"
    if automation_profile.exists():
        config = json.loads(automation_profile.read_text(encoding="utf-8-sig"))
        require(config.get("schemaVersion") == 1, "Unsupported automation profile schemaVersion")
        require((scripts / "automation/engine.mjs").is_file(), "Automation profile requires its engine")
        subprocess.run(["node", "--input-type=module", "-e", "import {loadProfile} from './.github/scripts/automation/engine.mjs'; loadProfile();"], check=True, cwd=root)
        counts["automationProfileValidated"] = True
        tests = sorted((scripts / "automation").glob("*.test.mjs"))
        require(bool(tests), "Automation engine profile requires its unit tests")
        subprocess.run(["node", "--test", *[str(path) for path in tests]], check=True, cwd=root)
        counts["automationTests"] = len(tests)
    return counts


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--expect-coverage", choices=["application", "automation-contracts"])
    parser.add_argument("--skip-helper-execution", action="store_true", help="Structural audit only; CI never uses this option")
    args = parser.parse_args()
    root = args.root.resolve()
    try:
        profile = validate_profile(root)
        if args.expect_coverage:
            require(profile["coverage"] == args.expect_coverage, "Requested coverage differs from committed profile")
        result = validate_workflows(root, profile)
        result["helpers"] = {} if args.skip_helper_execution else check_helpers(root)
        result["coverage"] = profile["coverage"]
        result["suites"] = profile["suites"]
        result["applicationTestsExecutedByContractValidator"] = False
        print(json.dumps(result, indent=2))
        return 0
    except (ContractError, OSError, ValueError, subprocess.CalledProcessError) as error:
        print(f"CI contract failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())

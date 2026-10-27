"""Inline, dependency-free implementation of the stable ci-required check."""
import json
import os
import sys

expected = set(json.loads(os.environ["CI_EXPECTED_JOBS"]))
needs = json.loads(os.environ["CI_NEEDS"])
failed = {}
if not expected or set(needs) != expected:
    print("Dependency set does not match the committed CI contract", file=sys.stderr)
    sys.exit(1)
for job, info in needs.items():
    result = info.get("result")
    if result != "success":
        failed[job] = result
coverage = os.environ["CI_COVERAGE"]
scope = "Application suites and automation contracts" if coverage == "application" else "Automation/configuration contracts; application behavior is not certified"
summary = "## CI coverage\n\n" + scope + "\n\n" + "\n".join(f"- {job}: {info.get('result')}" for job, info in needs.items()) + "\n"
if os.environ.get("GITHUB_STEP_SUMMARY"):
    with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as output:
        output.write(summary)
print(summary)
if failed:
    print("Required jobs did not succeed: " + json.dumps(failed), file=sys.stderr)
    sys.exit(1)

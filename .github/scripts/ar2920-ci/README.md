# Local CI contract v1.0.0

The canonical package is maintained in `othryn-stack/tools/ci-cd/quality/`.
Repositories vendor these files under `.github/scripts/ar2920-ci/` and call
`./.github/workflows/_ci-quality.yml`; no cross-repository Actions permission or
organization secret is needed for pull request validation.

`ci.yml` runs for pull requests and pushes to main, development and staging.
Its `ci-required` check awaits every declared suite and rejects failure,
cancellation, missing results and skipped suites. It has no path filter.
Superseded runs are cancelled to avoid doing the same work twice.

`.github/ar2920-ci.json` declares the scope. `application` requires a real
application suite. `automation-contracts` verifies workflow structure, pinned
Actions, helper syntax and automation unit tests; it does not claim application
behavior was tested. Existing configuration/deployment/monitoring suites retain
their specific scope and run separately. There are no service credentials in CI.

The contract job verifies GitHub Actions semantics with actionlint 1.7.12 from
its official release, checking a committed SHA256 before extracting/executing
the Linux binary in the runner temporary directory. Optional shellcheck and
pyflakes integrations are disabled explicitly; Bash syntax is checked separately.
The Python contract job uses Python 3.12 and the exact PyYAML 6.0.3 Linux wheel
hash. Node 24 checks JavaScript helper syntax and executes the dependency-free
automation engine unit tests. Shell helpers are parsed with `bash -n`, never
executed by this validator. Application suites keep their repository-specific
dependencies, native runner, commands and timeouts.
The validator also calls the engine's offline `loadProfile()` against the real
committed repository configuration, so fixture tests cannot hide a broken profile.

Run locally with Python/PyYAML already installed, Node and Bash available:

```sh
python -m unittest discover -s .github/scripts/ar2920-ci -p 'test_*.py' -v
python .github/scripts/ar2920-ci/validate.py --root .
```

The local validator does not execute application suites; those are CI jobs.
Windows users can set `AR2920_BASH` to their Git Bash executable for helper
syntax checks. `AR2920_TEST_TMP` optionally selects a writable fixture directory.
`--skip-helper-execution` is for structural audits only and is never used by CI.
Pin updates require verifying the upstream Action commit and updating every
vendored caller. Required-check settings must be activated only after this
check exists on the target branch. A green configuration contract alone is
insufficient evidence of product readiness.

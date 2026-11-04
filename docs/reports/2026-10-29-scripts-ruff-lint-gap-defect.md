# Defect: scripts/ Python fails ruff lint and format, and no CI job checks it

**Recorded**: 2026-10-29
**Severity**: SEV-2
**Impact type**: ci-gate-gap
**Environment**: dev (feature/fix-legacy-formula-authors, based on main-dev)
**Affected service(s)**: scripts/ (operator tooling: manage-users.py and its tests, build-launch-pdfs.py, do-inject-prod-secrets.py)
**Config-only fix possible**: no

## Observed

The Python files under `scripts/` carry ruff lint and format findings that nothing catches.
`ruff check scripts/` (ruff 0.16.9) reports 9 findings, and `ruff format --check scripts/` would
reformat 4 of the 5 files. The CI ruff steps run only inside the Python service matrix, so
`scripts/` is never linted. Feature 276 Step 2 specced a ruff gate over `scripts/` and could not
pass it without touching unrelated lines, so its verification had to be narrowed to the added lines.

## Expected

`ruff check scripts/` and `ruff format --check scripts/` exit 0, and a CI job enforces both on PRs
that touch `scripts/`, so a spec that cites the gate can rely on it.

## Reproduction

1. `ruff check scripts/ --output-format concise`
2. `ruff format --check scripts/`
3. `grep -n "working-directory: services/" .github/workflows/ci.yml`: the ruff steps run per service only.

## Evidence

`ruff check scripts/` findings:
- `scripts/build-launch-pdfs.py:1:1` EXE001, `:9:1` I001
- `scripts/do-inject-prod-secrets.py:1:1` EXE001, `:64:30` UP031
- `scripts/manage-users.py:32:8` F401 (`sys` imported but unused)
- `scripts/tests/test_manage_users.py:1:1` EXE001, `:26:38` F401 (`unittest.mock.call`), `:160:9` and `:170:9` SIM117

`ruff format --check` would reformat `build-launch-pdfs.py`, `do-inject-prod-secrets.py`,
`manage-users.py` and `tests/test_manage_users.py`; only `homelab-mtls-env.py` is already formatted.

`.github/workflows/ci.yml:318`
> working-directory: services/${{ matrix.service }}

`.github/workflows/ci.yml:331-335`
> run: ruff check .
> run: ruff format --check .

`grep -n "scripts/tests" .github/workflows/ci.yml` finds nothing, so `scripts/tests/` is not run in CI either.

## Root cause hypothesis

The CI ruff job was scoped to the Python services only, so `scripts/` was never added to any lint
path and has drifted.

## Confidence

high

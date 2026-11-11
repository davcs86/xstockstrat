# Product Spec: fix-ci-enforcement-gaps

**Type**: bug
**GitHub Issue**: none (Issues disabled) — reports: docs/reports/2026-10-28-node-leaf-c8-check-coverage-unenforced-defect.md, docs/reports/2026-10-29-scripts-ruff-lint-gap-defect.md
**Severity**: SEV-2
**Created**: 2026-11-10

---

## Problem Statement

### Node-leaf c8 `--lines 40` is declared but never enforced (no `--check-coverage`)

Report: [docs/reports/2026-10-28-node-leaf-c8-check-coverage-unenforced-defect.md](../../../reports/2026-10-28-node-leaf-c8-check-coverage-unenforced-defect.md) — SEV-3

- **Observed:** each Node leaf's `test:coverage` passes `--lines 40` but never `--check-coverage`, so c8
  prints the table and never compares; the CI `node-test` job never reads `matrix.coverage_threshold`.
  A leaf below 40% lines passes CI.
- **Expected:** CI fails a Node leaf whose line coverage is below 40%.

### scripts/ Python fails ruff lint and format, and no CI job checks it

Report: [docs/reports/2026-10-29-scripts-ruff-lint-gap-defect.md](../../../reports/2026-10-29-scripts-ruff-lint-gap-defect.md) — SEV-2

- **Observed:** `ruff check scripts/` reports 9 findings and `ruff format --check scripts/` would reformat 4
  of 5 files; CI ruff steps run only in the per-service matrix; `scripts/tests/` is not run in CI either.
  Feature 276 had to narrow its specced `scripts/` ruff gate to added lines.
- **Expected:** `ruff check scripts/` and `ruff format --check scripts/` exit 0, and a CI job enforces both on
  PRs that touch `scripts/`.

## Reproduction Steps

1. c8: in a leaf (e.g. `services/xstockstrat-notify`) whose line coverage is below 40%, `pnpm run test:coverage`
   exits 0; `pnpm exec c8 check-coverage --lines 40` right after exits non-zero.
2. ruff: `ruff check scripts/ --output-format concise`; `ruff format --check scripts/`;
   `grep -n "working-directory: services/" .github/workflows/ci.yml` — ruff steps are per service only.

## Root Cause Hypothesis

- c8: leaf scripts copied from one another without `--check-coverage`; the `node-test` matrix was given a
  `coverage_threshold` that no step consumes.
- ruff: the CI ruff job was scoped to Python services only; `scripts/` was never added and drifted.

Spot-check at 0fecb24d: `test:coverage` with `--lines 40` and no `--check-coverage` at
`services/xstockstrat-{config,identity,notify}/package.json:13`, `services/xstockstrat-ledger/package.json:14`;
`coverage_threshold` read only at `.github/workflows/ci.yml:342` (Go) and `:477` (Python), Node matrix values at
`:628-638`. New since the report: a `ruff (the two SOPS scripts)` step (`ci.yml:1023-1027`) lints only
`scripts/sops_secrets.py` and `scripts/do-render-app-spec.py` — the rest of `scripts/` is still ungated.

## Affected Services

- xstockstrat-config, xstockstrat-ledger, xstockstrat-identity, xstockstrat-notify (`package.json` coverage scripts)
- `scripts/` operator tooling (`manage-users.py` + tests, `build-launch-pdfs.py`, `do-inject-prod-secrets.py`)
- `.github/workflows/ci.yml` (`node-test` job; new/extended `scripts/` ruff gate)

## Fix Scope

- [x] Proto changes anticipated: **no** — CI and package scripts only.
- [x] Database migrations anticipated: **no** — no schema touched.
- [x] Config key changes anticipated: **no** — no runtime config read.

## Open Questions

1. If enforcing `--check-coverage` turns a leaf red (below 40%), is the fix in scope to add tests, or is the
   threshold adjusted with sign-off?
2. Should `scripts/tests/` also run in CI (the report notes it does not), or only the ruff gate?
3. Gate shape: a path-filtered job on PRs touching `scripts/` (as the report states) or an always-on step,
   and does it subsume the existing two-SOPS-script ruff step?

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; CI green on the fix PR.

## Out of Scope

- Changing the Go/Python coverage thresholds.
- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix

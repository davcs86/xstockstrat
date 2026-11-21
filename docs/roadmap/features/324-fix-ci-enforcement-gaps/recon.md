# Recon: fix-ci-enforcement-gaps

**Created**: 2026-11-11
**From**: product-spec.md
**Tree**: detached@c4fd48b0a ≡ origin/main-dev (no `feature/fix-ci-enforcement-gaps` branch on origin yet; scout digests were UNSTAMPED, citations below re-grepped at c4fd48b0a)
**Affected services**: xstockstrat-config, xstockstrat-ledger, xstockstrat-identity, xstockstrat-notify (`package.json` coverage scripts); `scripts/` Python operator tooling; `.github/workflows/ci.yml`

---

## Objective

Close two CI gates that are declared but never enforced. First, the four Node leaves pass `--lines 40` to c8 without `--check-coverage`, so a leaf below 40% lines still passes `node-test`. Second, `scripts/` Python is not ruff-clean, and no CI job lints it apart from a two-file step in `sops-secrets`. After the fix, a Node leaf below 40% lines fails CI, and a PR that touches `scripts/` Python fails CI on `ruff check` or `ruff format --check` violations.

## Codebase Map

- **`xstockstrat-config`** (Node.js)
  - Coverage script: `services/xstockstrat-config/package.json:13`
    `"test:coverage": "tsc && c8 --reporter=text --reporter=lcov --lines 40 node --test dist/__tests__/*.test.js"`
  - c8 devDependency `^10.1.2`: `services/xstockstrat-config/package.json:54`
  - Last migration: n/a (not touched)
  - Config-read pattern: n/a (no runtime config read)
- **`xstockstrat-identity`** (Node.js)
  - Coverage script: `services/xstockstrat-identity/package.json:13` (same string)
  - c8 `^10.1.2`: `services/xstockstrat-identity/package.json:50`
- **`xstockstrat-notify`** (Node.js)
  - Coverage script: `services/xstockstrat-notify/package.json:13` (same string)
  - c8 `^10.1.2`: `services/xstockstrat-notify/package.json:47`
- **`xstockstrat-ledger`** (Node.js)
  - Coverage script: `services/xstockstrat-ledger/package.json:14` (same string)
  - c8 `^10.1.2`: `services/xstockstrat-ledger/package.json:47`
- None of the four leaves has a c8 config file (`.c8rc*`, `.nycrc*` or `c8.config*`), and none sets coverage `include` or `exclude` in `package.json`.
- **`xstockstrat-ui`** (Next.js). This leaf is out of scope. Its `test:coverage` is `vitest run --coverage` (`services/xstockstrat-ui/package.json:19`), and its gate is vitest's own threshold (comment at `.github/workflows/ci.yml:635-636`).
- **CI, `.github/workflows/ci.yml`**
  - `changes` path filter `scripts:` matches `'scripts/**'` and `'.claude/hooks/**'` (`ci.yml:68-70`). A narrower `'scripts/ledger-guard.py'` entry for another filter is at `:104`.
  - `node-test` job (`ci.yml:610-667`):
    - Its matrix carries `coverage_threshold: 40` for config, ledger, identity, notify and ui (`:627-638`). No step reads that value.
    - The coverage step is `pnpm run test:coverage` with `working-directory: services/${{ matrix.service }}` (`:658-660`).
    - The lcov artifact upload is at `:662-667`.
  - Two other jobs do consume `coverage_threshold`: Go at `ci.yml:342` (`THRESHOLD=${{ matrix.coverage_threshold }}`) and Python at `ci.yml:477` (`--cov-fail-under=${{ matrix.coverage_threshold }}`). Neither is in scope.
  - `python-lint` (`ci.yml:363`) runs a per-service ruff pass: `pip install ruff uv` (`:394-395`), `ruff check .` (`:397-398`) and `ruff format --check .` (`:400-401`).
  - `shell-lint` (`ci.yml:685-705`) is gated by `needs: changes` plus `if: contains(… 'scripts') || contains(… 'ci')` (`:688-690`). It runs shellcheck and shfmt on `scripts/*.sh` and `.claude/hooks/*.sh`, then the bash structural tests. It does no Python checks.
  - `sops-secrets` (`ci.yml:1006-1030`) is gated on the `sops`, `homelab` and `ci` filters (`:1009-1012`). It runs on `ubuntu-24.04` with `actions/setup-python@v7` at 3.13. Its step `ruff (the two SOPS scripts)` (`:1023-1027`) runs `pip install ruff`, then `ruff check` and `ruff format --check` on `scripts/sops_secrets.py` and `scripts/do-render-app-spec.py` only.
  - `ledger-guard` (`ci.yml:923`) already executes `python3 scripts/ledger-guard.py` at `:941`.
  - `ci-gate` (`ci.yml:1114`) has a `needs:` list (`:1117-1140`) and an `echo` line per job (`:1145-1167`). Any new job must be added to both.
- **`scripts/` Python** (top level):
  - `build-launch-pdfs.py`, `config-wiring-py-reads.py`, `do-render-app-spec.py`, `homelab-mtls-env.py`, `ledger-guard.py`, `manage-users.py`, `measure-insertbars-cost.py`, `sops_secrets.py`
  - Test: `scripts/tests/test_manage_users.py`. Its line 15 documents `uv run pytest scripts/tests/test_manage_users.py -v`, and its PEP 723 header at :9 declares `pytest>=8`. It imports `bcrypt` and `typer`. No CI step runs it.
  - `scripts/config-wiring-fixtures/**` holds 19 `.py` fixture files used as data by the config-wiring tests. A bare `ruff check scripts/` would lint them as well.
  - No ruff config exists: there is no `ruff.toml`, `.ruff.toml`, root `pyproject.toml` or `scripts/pyproject.toml`. `ruff … scripts/` therefore runs with ruff defaults and no excludes.
- **Docs that state the enforcement gap**:
  - `docs/patterns/ci-overview.md:23` (the `node-test` row reads "40% declared, not enforced").
  - `docs/patterns/ci-overview.md:82` (verify by hand with `pnpm exec c8 check-coverage --lines 40`).
  - Root `CLAUDE.md` § CI/CD Overview ("the Node.js leaves declare 40% but CI does not enforce it").
  - All three go stale once the fix lands.

## Patterns to REUSE

- **c8 enforcement**: add `--check-coverage` to the existing c8 invocation in the four `test:coverage` scripts. The flag goes before `node` and keeps `--lines 40` and the reporters. Reuse the leaves' own command line; add no new c8 config file.
- **Literal 40 vs matrix value**: the literal `40` already matches `coverage_threshold: 40` at `ci.yml:628-634`.
  - Driving it from the matrix would mirror the Go and Python consumers (`ci.yml:342`, `:477`), but it would mean a CI-side `c8 check-coverage` invocation instead of a script flag.
  - This is a design fork; see Risks.
- **Path-filtered `scripts/` job**: mirror `shell-lint`'s gate, `needs: changes` plus `if: contains(fromJson(needs.changes.outputs.matched), 'scripts') || contains(…, 'ci')` (`ci.yml:686-690`), against the existing `scripts` filter (`:68-70`). No new filter is needed.
- **Ruff install and run shape**: copy the `sops-secrets` setup (`actions/setup-python@v7` at 3.13, `pip install ruff`; `ci.yml:1019-1027`) or the `python-lint` steps (`:394-401`).
- **Aggregate gate**: a new job must be added to the `ci-gate` `needs:` list and its echo block (`ci.yml:1117-1167`), following the pattern for the existing jobs.
- **`scripts/tests/` in CI** (only if OQ2 is taken into scope): the ready command is `uv run pytest scripts/tests/test_manage_users.py -v` (`scripts/tests/test_manage_users.py:15`). It needs `uv`, which `python-lint` installs via `pip install ruff uv` (`ci.yml:394-395`).

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-4` "the coverage gate measures the implementation" (`docs/sdd/business-rules/platform.feature:551`). Identity and ledger must still show real implementation rows and an All-files `% Lines` of at least 40 under `c8 check-coverage --lines 40`. The new enforcement may not be satisfied by lowering the threshold or removing tests. The scenario's wording assumes a separate `c8 check-coverage` invocation after the run. Adding `--check-coverage` to the script stays consistent with it, so keep both forms valid.
- **PRESERVE** `@AC-3` "an unloadable test subject fails the run instead of passing" (`docs/sdd/business-rules/platform.feature:538`). `test:coverage` must keep exiting non-zero in identity and ledger when the subject import is missing.
- **PRESERVE** `@AC-5` "existing tests still pass once they actually execute" (`docs/sdd/business-rules/platform.feature:560`). Identity and ledger must report 0 failed tests, and no test may be deleted, skipped, marked todo or weakened to get past the new gate.
- **PRESERVE** `@AC-6` "a compiled test whose compiled subject is missing fails instead of passing" (`docs/sdd/business-rules/platform.feature:572`). The compiled-test and TAP fail-on-missing-subject behaviour must survive the `test:coverage` edit.
- **PRESERVE** `@AC-1` "the identity suite executes against the real IdentityServiceImpl" (`services/xstockstrat-identity/acceptance/fix-identity-ledger-test-suites.feature`). The identity CI run must still exit 0 and must still catch the refresh-rotation mutation.
- **PRESERVE** `@AC-2` "the ledger suite executes against the real LedgerServiceImpl and EventNotifier" (`services/xstockstrat-ledger/acceptance/fix-identity-ledger-test-suites.feature`). The ledger CI run must still exit 0 and must still catch both mutations.
- **PRESERVE** `@AC-24` "MCP_AGENT_SECRET stays absent from every new deploy-secret surface" (`docs/sdd/business-rules/platform.feature:1026`). Ruff-reformatting `scripts/sops_secrets.py` and `scripts/do-render-app-spec.py`, or editing `ci.yml`, must not reintroduce `MCP_AGENT_SECRET`.
  - Its Given (`:1028`) states that `scripts/do-inject-prod-secrets.py` is deleted, which matches the tree.
  - If the new job subsumes the two-file SOPS ruff step, both files must stay linted.
- No existing acceptance suite covers the `test:coverage` scripts of xstockstrat-config or xstockstrat-notify, although both services have unrelated suites. For those two leaves the gate is new behaviour. This feature's pending `@AC-1` (notify) is promoted at launch.
- No existing scenario guards `manage-users.py`, `build-launch-pdfs.py` or `scripts/tests/`.
- No CHANGE flags: the feature adds enforcement and alters no guarantee.

## Dependencies

- Proto/RPC: none
- Migration: none (no migration number needed)
- Config keys: none
- Inter-service edges: none
- New env vars / ports: none
- Files to edit:
  - the four leaf `package.json` files
  - `.github/workflows/ci.yml`
  - `scripts/*.py` (ruff fixes and reformat)
  - doc drift in `docs/patterns/ci-overview.md:23,82` and the root `CLAUDE.md` § CI/CD Overview

## Risks / Not-found

- **Current leaf coverage is unmeasured.** No scout ran c8, so it is unknown whether config or notify (or identity and ledger, at today's tree) sit below 40%. That drives OQ1.
  - `@AC-4` and `@AC-5` require that a red leaf be fixed with tests, not by lowering the threshold or trimming tests. Lowering the declared 40% would need explicit operator sign-off recorded in `context.md`.
  - Default: PRESERVE 40.
  - First action at design or spec: measure each leaf with `pnpm run test:coverage` followed by `pnpm exec c8 check-coverage --lines 40`.
- **An empty coverage map passes `check-coverage`**, per `fails.md` 2026-11-04 fix-identity-ledger-test-suites (`docs/roadmap/ledger/fails.md:3274-3277`; `'Unknown' < 40` is false, `check-coverage.js:56-59`, source-quoted and not independently verified).
  - So `--check-coverage` alone does not catch a zero-file run. That case is guarded today only by `@AC-3`/`@AC-6` (a non-zero exit on a missing subject).
  - The `@AC-1` red-before-green test must use a tree with a non-empty map below 40%, not an empty one.
  - Per the ledger rule, verify with an explicit `c8 check-coverage --lines N` run right after the wrapped run (no `--all`, `--src` or `--allowExternal`), and record the `--lines 101` forced-miss aggregate.
- **Doc claims of enforcement**: per the same fails entry, grep every "enforced" doc claim against the real script flags. `ci-overview.md:23,82` and the root `CLAUDE.md` currently say "not enforced" and must flip to enforced in the same PR.
- **Ruff counts are unverified.** The report's "9 findings" and "4 of 5 files reformat" were not re-run. The report predates the current file set (8 top-level `.py` files, plus 1 test and 19 fixtures), so the counts may have drifted.
  - Applicable trap (`fails.md:3432-3435`, 2026-11-04 fix-legacy-formula-authors): at `/sdd-spec`, run each Verification command for real and grep each "CI enforces Y" claim. A step that fails on pre-existing code must be scoped or must carry the cleanup.
  - Here the cleanup is in scope by design.
- **Fixture scope.** `scripts/config-wiring-fixtures/**` holds 19 `.py` data fixtures. A bare `ruff check scripts/` lints them, and reformatting them could change what the config-wiring tests read.
  - Design must choose between an `--exclude` or `extend-exclude` (there is no ruff config file today, so this means a CLI flag or a new config) and linting them too.
  - Open; carry to the debate.
- **`scripts/do-inject-prod-secrets.py` not found.** The product spec lists it under Affected Services, but it is absent from the tree, and `platform.feature:1028` (@AC-24) records it as deleted. The spec entry is stale, and nothing is needed for it.
- **Gate shape / subsuming the SOPS step (OQ3).** The `sops-secrets` job is gated on `sops`, `homelab` and `ci` (`ci.yml:1009-1012`), not on `scripts`.
  - A new `scripts`-gated job would cover `sops_secrets.py` and `do-render-app-spec.py` on any `scripts/**` change, but not on a PR that matches only `homelab`, `deploy*.yml` or `setup-sops/**`.
  - Removing the SOPS step would therefore narrow coverage for those PRs. Either keep it, or OR the new job's gate with `sops` and `homelab`.
- **`scripts/tests/` in CI (OQ2)** is a scope fork. The test needs `bcrypt` and `typer` through PEP 723 and `uv run`. It is out of AC-1 and AC-2 as written.
- **Literal vs matrix threshold.** Putting `--check-coverage --lines 40` in the script keeps the gate local (developers hit it too) but leaves `coverage_threshold` dead in the `node-test` matrix. Consuming the matrix value in CI would duplicate the threshold with the script's `--lines 40`. Design must pick one source of truth (DRY guard rail).
- **Peer overlap (from sdd-review)**: `ci.yml` is shared with features 297, 298 and 318, and the ledger and notify `package.json` files with 323. Expect rebase conflicts in `ci.yml` (`ci-gate` lists) and in `package.json`.
- Applicable `fails.md` trap (`fails.md:431-434`, 2026-08-05 strategy-engine): for files outside a lint gate, fix only touched lines. That rule does not apply here, because this feature deliberately brings `scripts/` under the gate, so the whole-directory cleanup is in scope.

## Recommended Scope

Advisory only; not binding.

1. **c8 enforcement**:
   - Add `--check-coverage` to `test:coverage` in config, identity, notify and ledger.
   - Measure each leaf first. If a leaf is below 40%, add tests (no threshold change without sign-off).
   - Decide whether the dead `coverage_threshold` matrix entries for the four c8 leaves stay as is, are consumed, or are removed.
2. **scripts/ ruff cleanup**:
   - Fix the `ruff check scripts/` findings.
   - Apply `ruff format scripts/` to the non-fixture files.
   - Decide the fixture exclude.
   - Confirm `@AC-24` still holds (no `MCP_AGENT_SECRET` reintroduced).
3. **CI gate**:
   - Add a `scripts`-filtered ruff job (mirroring `shell-lint`) running `ruff check` and `ruff format --check` over `scripts/`.
   - Add it to `ci-gate` `needs:` and its echo block.
   - Resolve OQ3 (keep the SOPS step, or widen the gate to `sops`/`homelab` and drop it).
4. **Optional, OQ2**: run `scripts/tests/test_manage_users.py` via `uv run pytest` in the same job.
5. **Docs**: flip `docs/patterns/ci-overview.md:23,82` and the root `CLAUDE.md` § CI/CD Overview from "not enforced" to enforced.

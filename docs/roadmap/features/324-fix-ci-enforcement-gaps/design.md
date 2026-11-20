# Design: fix-ci-enforcement-gaps

**Created**: 2026-11-20
**Rounds**: 4 (full; termination: approved)
**Approved by**: user @ 2026-11-20 (operator approval at the design gate, relayed through the `/sdd-batch` gate answer; see context.md 2026-11-20)
**Grounded in**: recon.md
**Debate register**: debate.md

---

## Chosen Approach

One PR in four parts, built 0 → A → B → C. The change is internal-only: it touches CI, four leaf
`package.json` scripts and docs, and reaches no UI segment or Agent tool (C-14).

Line numbers written as `ci.yml:NNN` below are from origin/main-dev as checked in round 4. recon.md
was written before the branch fell behind, so its `ci.yml` numbers differ. Part 0 re-stamps recon.md
and every number is re-grepped after it.

### 0. Sync (D-7)

Merge origin/main-dev into `feature/fix-ci-enforcement-gaps`, re-stamp recon.md (`recon.md:5`), and
re-grep every cited `ci.yml` and `package.json` line at the synced tip.

### A. Node-leaf c8 gate (D-1, D-4, D-5, D-8)

The four leaves pass `--lines 40` to c8 without `--check-coverage` (`recon.md:16-30`), and no step
reads the matrix `coverage_threshold` (`recon.md:36`).

1. **Per-leaf measurement records (D-8; the @AC-1 evidence the operator asked the spec to carry).**
   For each of config, identity, ledger and notify, run `pnpm run test:coverage` and then
   `pnpm exec c8 check-coverage --lines 101` with no `--all`, `--src` or `--allowExternal`
   (`recon.md:100-104`). Write one row per leaf in a `## c8 measurement` table in context.md: leaf,
   git SHA, All-files % Lines, the forced-miss aggregate, the count of implementation rows with
   non-zero lines, and the verdict (>=40 or <40). The non-zero-rows column is what catches an empty
   coverage map (`recon.md:101-103`). After the flag lands, a second pass records
   `pnpm run test:coverage` exiting 0 for every leaf.
2. **A leaf below 40 gets a named test step before the flag lands (D-4).** The threshold is not
   lowered (`recon.md:97-99`).
3. **Flag (D-1).** Insert `--check-coverage` before `--lines 40` in the `test:coverage` script of
   config, identity and notify (`recon.md:17,23,26`) and ledger (`recon.md:29`). No c8 config file is
   added (`recon.md:58`).
4. **Matrix (D-1).** Delete the five `coverage_threshold: 40` lines from the `node-test` matrix
   (`recon.md:36`; `ci.yml:764,766,768,770,774`). Reword the ui comment (`recon.md:32`;
   `ci.yml:771-772`) so it names no threshold. The Go and Python consumers of `coverage_threshold`
   (`recon.md:39`) are untouched.
5. **Guard (D-5).** Add one `node-test` step before the coverage step (`recon.md:37`; `ci.yml:794`):
   `if: matrix.service != 'xstockstrat-ui'`, `working-directory: services/${{ matrix.service }}`, and
   a `run: |` block calling `node -e`. It splits `scripts['test:coverage']` on whitespace and requires
   the token order `c8` < `--check-coverage` < `node`. It holds no threshold literal. Record a red run
   (unflagged script) and a green run (flagged script) in context.md.
6. **@AC-1 red proof in notify.** Generate `services/xstockstrat-notify/src/acProof.ts` (at the
   `src/` root, mostly uncalled function bodies) with a throwaway script. Load it from
   `src/__tests__/fanout.test.ts` with the side-effect import `import '../acProof.js';`. Size it so
   N > covered/0.4 - T plus a margin, and record T, covered and N. Run `pnpm run test:coverage` and
   record the non-zero exit, the table total, the `--lines 101` aggregate and a non-empty acProof row
   (`recon.md:103`). Revert both files; do not stage them.

### B. scripts/ ruff gate (D-9, which supersedes D-2, D-3 and D-6)

recon.md recorded that no ruff config and no scripts job existed (`recon.md:49`, `recon.md:62-64`).
That is stale: main-dev commit c4b70c27 (#1514) added both. The operator ruled on 2026-11-20 to
extend what exists.

- The fixture exclude stays in the existing `[tool.ruff]` table (`scripts/pyproject.toml:25-27`,
  `extend-exclude = ["config-wiring-fixtures"]`; the fixture concern is `recon.md:48,109-111`).
  No `scripts/ruff.toml` is added.
- The gate is the existing path-filtered `scripts-python` job (`ci.yml:861-894`), which runs
  `ruff check .`, `ruff format --check .` and pytest with `working-directory: scripts` and is listed
  in `ci-gate` (`ci.yml:1392`, `:1425`). No second job is added.
- No `target-version` is written. Ruff infers py312 from `requires-python = ">=3.12"`
  (`scripts/pyproject.toml:5`).

So Part B ships no ruff code. It is a proof sequence, recorded verbatim in context.md, and nothing is
staged:

1. `uv sync --project scripts --extra dev --frozen` (ruff is locked at 0.17.4, `scripts/uv.lock:402-403`).
2. **Green.** From the repo root: `uv run --project scripts --no-sync ruff check scripts/` and
   `ruff format --check scripts/`. In the job form:
   `cd scripts && uv run --no-sync ruff check . && uv run --no-sync ruff format --check . && uv run --no-sync pytest`.
   All exit 0.
3. **Red, the @AC-2 negative clause (the step the operator asked the spec to carry).** Plant
   `import os` as the first import in `scripts/ledger-guard.py`. `ruff check scripts/` must exit
   non-zero with F401 naming the file, and so must the job form. Revert.
4. Repeat in `scripts/tests/test_manage_users.py`: both forms exit non-zero. Revert.
5. Repeat in one file under `scripts/config-wiring-fixtures/`: both forms exit 0. Revert.
6. The sequence records that `ruff check scripts/` and the job's `ruff check .` are equivalent. That
   record carries into the C-16 promotion of @AC-2.
7. State in context.md that @AC-2's pre-fix red state is the tree before c4b70c27 (#1514), cited and
   not re-run.

If `scripts-python` is red at spec time, the spec blocks and escalates for an operator ruling.

### C. Docs (C-10, F-08), each in a step Files list

- `docs/patterns/ci-overview.md` (`recon.md:51-52`; now at `:25` and `:90`, re-cite after Part 0).
- Root `CLAUDE.md` (`recon.md:53`) only if the re-grep at the synced tip still finds a
  "not enforced" claim. Round 4 found none.
- `.claude/skills/sdd-spec/reference/spec-template.md:163`.
- `.claude/skills/sdd-qa/reference/lang-node.md:9,47,48,52,53`.
- The four leaf findings defect rows.
- Both defect-report `.status` sidecars to `resolved`. The ruff sidecar cites c4b70c27 (#1514) plus
  the Part B proof.

### At merge-train time

Re-check that `scripts-python` and both `ci-gate` entries still exist. Do not re-run the whole proof.

## Rejected Alternatives

- `R-1` CI-only `c8 check-coverage --lines ${{ matrix.coverage_threshold }}` step with the matrix values kept — rejected because it fails @AC-1, which runs `pnpm run test:coverage` directly; local and CI behavior would diverge.
- `R-2` Lowering the per-leaf threshold below 40% — rejected because it weakens platform @AC-4/@AC-5 and needs operator sign-off.
- `R-3` Ruff steps inside the `shell-lint` job — rejected because the job name would mislead on failure.
- `R-4` Dropping the coverage-flag regression guard and relying on @AC-1 plus the measured margin — rejected because the guard is the only red signal when the flag is removed while coverage is at or above 40%.
- `R-5` Running `scripts/tests/` under a new scripts lint job — rejected as beyond @AC-2 scope. The existing `scripts-python` job already runs pytest; this feature adds none.
- `R-6` Proving @AC-1 by temporarily narrowing the `test:coverage` glob — rejected because it alters the script under test, so the run no longer matches the CI `node-test` job.
- `R-7` Adding `scripts/ruff.toml` next to the existing pyproject `[tool.ruff]`, with the exclude copied into both — rejected because a same-directory `ruff.toml` shadows `[tool.ruff]` and leaves two homes for the fixture exclude (C-18).
- `R-8` Keeping `coverage_threshold` on the xstockstrat-ui matrix entry only — rejected because it is dead data (vitest owns that gate) and contradicts D-1.

## Open Risks

- [ ] Turning on `--check-coverage` may put a leaf below 40%, which adds unsized test work — to be addressed at the Part A measurement step (first spec step after the sync).
- [ ] c8 without `--all` measures only loaded files, so an empty coverage map would pass — to be addressed at the Part A measurement step (non-zero implementation-rows column).
- [ ] The feature branch is behind main-dev; expect conflicts in `ci.yml` (297, 298, 318) and the ledger/notify `package.json` (323) — to be addressed at the Part 0 sync step.
- [ ] A proof module sized too small exits 0 and gives a false green — to be addressed at the @AC-1 red-proof step (record T, covered and N).
- [ ] `scripts-python` (including pytest) could be red at spec time, leaving @AC-2 unprovable — to be addressed at /sdd-spec (block and escalate; O-3 and O-9 apply only then).
- [ ] Part B ships no ruff code, so @AC-2's positive clause has no fresh red run — to be addressed at the Part B proof step (cite the pre-c4b70c27 tree; O-19).
- [ ] The Part B green proof must include `uv run --no-sync pytest` — to be addressed at the Part B proof step (O-20).
- [ ] The ruff pin question (O-4) is answered by the 0.17.4 lock only while `scripts-python` is the sole ruff gate — to be confirmed at /sdd-spec.
- [ ] The root `CLAUDE.md` touchpoint may be empty — to be addressed at the Part C docs step (drop it unless the re-grep finds a claim; O-18).
- [ ] A peer `ci.yml` edit could weaken or rename `scripts-python` or drop it from `ci-gate` — to be addressed at merge-train time (O-21).

## Constitution Rules Touched

- `C-01` — honored by: the per-leaf measurement table records the table total, the `--lines 101` forced-miss aggregate and non-zero implementation rows; no enforcement claim rests on a passing run alone.
- `C-10` — honored by: every doc that states the gap is in a step Files list (Part C).
- `C-11` — honored by: this full-mode design (4 rounds) precedes any code.
- `C-15` — honored by: red proofs for @AC-1 (proof module), the guard step (red and green) and the @AC-2 negative clause; the @AC-2 pre-fix red state is cited to the pre-c4b70c27 tree.
- `C-16` — honored by: the section below; no existing rule is changed.
- `C-18` — honored by: one home for the threshold (the script, D-1), one for the fixture exclude (`[tool.ruff]`) and one ruff job (`scripts-python`), per D-9.
- `P-02` — honored by: proposer and adversary saw only the synthesized state each round.
- `P-03` — honored by: tree facts not in recon.md are cited to main-dev files and re-grepped after the sync.
- `P-06` — honored by: red-before-green runs are recorded in context.md for the guard and both acceptance scenarios.
- `F-04` — honored: stale recon claims (`recon.md:49,53`) are flagged and re-verified, not assumed.
- `F-08` — honored: every edited file is in a step Files list, and every temporary proof edit is reverted and never staged.

## Business Rules Touched (C-16)

- EXTEND `@AC-1` "A Node leaf below 40% line coverage fails its coverage run" (this feature's `acceptance.feature`) — new case added: the gate is new behavior for config and notify, evidenced by the per-leaf measurement table and the notify red proof.
- EXTEND `@AC-2` "scripts/ Python is ruff-clean and CI enforces it" (this feature's `acceptance.feature`) — new case added: the negative clause is proven with a planted unused import in both invocation forms; the proven equivalence of `ruff check scripts/` and the job's `ruff check .` carries to the promotion.
- PRESERVE `@AC-3` "an unloadable test subject fails the run instead of passing" (`docs/sdd/business-rules/platform.feature`) — not regressed by: the script edit only inserts a flag; the test glob and runner are unchanged.
- PRESERVE `@AC-4` "the coverage gate measures the implementation" (`docs/sdd/business-rules/platform.feature`) — not regressed by: the threshold stays at 40 and the measurement records non-zero implementation rows.
- PRESERVE `@AC-5` "existing tests still pass once they actually execute" (`docs/sdd/business-rules/platform.feature`) — not regressed by: a leaf below 40 gets added tests; none is deleted, skipped or weakened.
- PRESERVE `@AC-6` "a compiled test whose compiled subject is missing fails instead of passing" (`docs/sdd/business-rules/platform.feature`) — not regressed by: `tsc &&` and the compiled-test invocation are unchanged.
- PRESERVE `@AC-24` "MCP_AGENT_SECRET stays absent from every new deploy-secret surface" (`docs/sdd/business-rules/platform.feature`) — not regressed by: Part B changes no script, and the `ci.yml` edits touch only the `node-test` job.

No CHANGE lines: the feature adds enforcement and alters no existing guarantee, so no operator
sign-off is required under C-16.

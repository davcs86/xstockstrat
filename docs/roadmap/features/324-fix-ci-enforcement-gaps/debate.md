# Debate Register: fix-ci-enforcement-gaps

**State**: approved
**Mode**: full
**Rounds run**: 4

## Rounds

| Round | Date | Run by | +D | +R | O closed | +O | Petitions | Progress |
|---|---|---|---|---|---|---|---|---|
| 1 | 2026-11-11 | /sdd-batch | 4 | 3 | 0 | 6 | 0 | yes |
| 2 | 2026-11-11 | /sdd-batch | 2 | 2 | 3 | 4 | 0 | yes |
| 3 | 2026-11-13 | /sdd-batch | 1 | 2 | 3 | 7 | 3 | yes |
| 4 | 2026-11-20 | /sdd-batch | 1 | 1 | 7 | 4 | 4 | yes |

## Settled Decisions

<!-- Status: settled → superseded by D-m (only after a user-approved REOPEN) -->
| ID | Round | Decision | Evidence | Status |
|---|---|---|---|---|
| D-1 | 1 | The coverage threshold lives only in each leaf's `test:coverage` script as `--check-coverage --lines 40`. The `node-test` matrix `coverage_threshold` values are deleted. | services/xstockstrat-notify/package.json:13; ci.yml:628-638; @AC-1 runs pnpm run test:coverage directly | settled |
| D-2 | 1 | The ruff fixture exclusion goes in `scripts/ruff.toml` (`extend-exclude = ["config-wiring-fixtures"]`), not in a CI flag. | @AC-2 names plain `ruff check scripts/` / `ruff format --check scripts/`; 19 checker fixtures | superseded by D-9 |
| D-3 | 1 | The scripts ruff gate is a new path-filtered `scripts-python-lint` job, added to both ci-gate lists. The SOPS-only ruff step is removed. | ci.yml:68-70, :87-101, :685-691, :1023-1027, :1117-1167 | superseded by D-9 |
| D-4 | 1 | A leaf that measures below 40% gets tests; the threshold is not lowered. | platform.feature @AC-4/@AC-5; product-spec Open Q1 | settled |
| D-5 | 2 | The regression guard is a single node-test step that reads only `scripts['test:coverage']`. It requires a whitespace-delimited `--check-coverage` token before the first `node` token and never reads the threshold value. No other guard copies are added. | services/xstockstrat-notify/package.json:13; ci.yml:658; r2 proposal and adversary agree (C-18) | settled |
| D-6 | 2 | `scripts/ruff.toml` sets target-version to py312 or py313, chosen from the ruff check and format --check counts measured at spec time. Ties go to py312. | three scripts declare requires-python >=3.12; fails.md:3432-3435 | superseded by D-9 |
| D-7 | 3 | Before /sdd-spec, the feature branch is synced to origin/main-dev, recon.md is re-stamped (its scripts/ and ci.yml Codebase Map), and every ci.yml and package.json line citation is re-grepped at the branch tip. | origin/feature/fix-ci-enforcement-gaps 92eba11 is 41 commits behind origin/main-dev (git rev-list --count). Its tip lacks scripts/pyproject.toml, and its ci.yml has coverage_threshold at :628-634 where main-dev has :764-774. Both r3 sides assume this. | settled |
| D-8 | 4 | @AC-1 is evidenced by a `## c8 measurement` table in context.md with one row per leaf (config, identity, ledger, notify): git SHA, All-files % Lines, the `--lines 101` forced-miss aggregate, count of non-zero implementation rows, and verdict. A second pass after the flag lands records `pnpm run test:coverage` exiting 0 per leaf. | r4 proposal A1; adversary concurs and asks to keep the non-zero-rows column (fails.md:3274-3277); closed O-7 | settled |
| D-9 | 4 (gate) | The scripts/ ruff gate extends what exists: the `[tool.ruff]` table in `scripts/pyproject.toml` keeps the fixture exclude, and the path-filtered `scripts-python` CI job is the gate. No `scripts/ruff.toml` and no second job are added, and no `target-version` is written (py312 comes from `requires-python`). Supersedes D-2, D-3 and D-6. | Operator ruling 2026-11-20 on P-1, P-2 and P-3 (context.md 2026-11-20); scripts/pyproject.toml:5, :25-27; ci.yml:861-894, :1392, :1425 | settled |

## Rejected Alternatives (locked)

<!-- Status: locked → reopened @ round N (user, context.md <ISO>) -->
| ID | Round | Alternative | Why rejected | Status |
|---|---|---|---|---|
| R-1 | 1 | CI-only `c8 check-coverage --lines ${{ matrix.coverage_threshold }}` enforcement step with matrix values kept | Fails @AC-1, which runs pnpm run test:coverage directly; local and CI behavior diverge | locked |
| R-2 | 1 | Lowering the per-leaf threshold below 40% | Weakens @AC-4/@AC-5; needs operator sign-off | locked |
| R-3 | 1 | Ruff steps inside the `shell-lint` job | The job name would mislead on failure; a new job costs only two ci-gate lines | locked |
| R-4 | 2 | Dropping the coverage-flag regression guard and relying on @AC-1 plus the measured margin | It is the only red signal when the flag is removed while coverage is at or above 40% | locked |
| R-5 | 2 | Running scripts/tests/ under the new scripts-python-lint job | Beyond @AC-2 scope (YAGNI, Open Q2). Revisit only if the --fix diff touches manage-users.py logic. | locked |
| R-6 | 3 | Proving @AC-1 by temporarily narrowing the test:coverage glob instead of adding a proof module | It alters the script under test, so the run no longer matches the CI node-test job that @AC-1 requires. | locked |
| R-7 | 3 | Adding scripts/ruff.toml next to the existing pyproject [tool.ruff], with extend-exclude copied into both | A same-directory ruff.toml takes precedence and shadows [tool.ruff], and keeping both creates two homes for the fixture exclude (C-18). | locked |
| R-8 | 4 | Keeping `coverage_threshold` on the xstockstrat-ui matrix entry only | Dead data (vitest owns that gate, ci.yml:771-772) and contradicts D-1. | locked |

## Objections

<!-- Status: open → closed @ round N (<how>) | waived @ round N (user) | reopened @ round N (user) -->
| ID | Round | Objection | Blocking | Status |
|---|---|---|---|---|
| O-1 | 1 | The regression-guard grep hard-codes '40' (a third copy, C-18), fails on valid threshold or flag-order changes, and misses a regression in `test:coverage` when another script keeps the flag. Replace it with a structural check scoped to `scripts['test:coverage']` that never matches the threshold, or drop the guard. | yes | closed @ round 2 (r2 adopts the structural node -e check scoped to scripts['test:coverage'], with no threshold literal (now D-5).) |
| O-2 | 1 | C-10: the docs touchpoints miss spec-template.md:163, lang-node.md:9/48/52, the four leaf context-constitution-findings defect rows, and both defect-report .status sidecars. All must be in step Files lists (F-08). | yes | closed @ round 2 (r2 puts spec-template.md:163, lang-node.md:9/47/48/52/53, the four findings rows (:58/:63/:62/:64) and both .status sidecars in step Files lists.) |
| O-3 | 1 | Post-`ruff --fix` verification must include the config-wiring test, the ledger-guard invocation and homelab-render.test.sh, plus a manual diff review. | no | open |
| O-4 | 1 | Pin ruff, or record that floating latest is accepted on purpose, for the new scripts gate. | no | open |
| O-5 | 1 | Set target-version in scripts/ruff.toml after measuring churn. | no | closed @ round 2 (r2 chooses target-version from measured churn, with py312 winning ties (now D-6).) |
| O-6 | 1 | Size the @AC-1 proof module from the measured notify line total, and record both the c8 table figure and the forced-miss aggregate. | no | closed @ round 4 (r4 A5 sizes the proof module from measured T and covered (N > covered/0.4 - T plus margin) and records the table total and the forced-miss aggregate.) |
| O-7 | 2 | C-01 (fails.md:3275-3277): measurement and the @AC-1 proof must record the table All-files % Lines, the `c8 check-coverage --lines 101` forced-miss aggregate run right after the wrapped run (no --all/--src/--allowExternal), and non-zero implementation rows. A passing --lines 40 run prints no aggregate. | yes | closed @ round 3 (r3 step 1 and step 6 record the table All-files % Lines, the `--lines 101` forced-miss aggregate (no --all/--src/--allowExternal) and non-zero implementation rows, per leaf and for the proof. The adversary concurs.) |
| O-8 | 2 | C-15/P-06: add a red proof for the negative clause of @AC-2: an unused import in a top-level script and in scripts/tests/test_manage_users.py fails `ruff check scripts/`, and one in a fixture is ignored. Add a red/green run of the guard step against the unflagged and flagged package.json, recorded in context.md. | yes | closed @ round 3 (r3 step 7 plants red proofs in a top-level script, in test_manage_users.py and in a fixture (ignored), run in both invocation forms. Step 5 adds the guard red/green. All are recorded in context.md, and the adversary concurs.) |
| O-9 | 2 | `build-launch-pdfs.py` EXE001 cannot be auto-fixed. The spec must choose chmod +x or removing the shebang. | no | open |
| O-10 | 2 | The guard must require `--check-coverage` before the first `node` token, and the step must be written as a `run: \|` block scalar. | no | closed @ round 3 (r3 step 4 requires the token order c8 < --check-coverage < node, in a `run: \|` block scalar.) |
| O-11 | 3 | The operator must rule on REOPEN D-2, D-3 and D-6 before approval, because the settled text conflicts with the tree: - D-2's new ruff.toml would shadow scripts/pyproject.toml:25-27. - D-3's new job would duplicate scripts-python at ci.yml:861-894. - D-6 has no home without a ruff.toml. Part B cannot be specced until then. | yes | closed @ round 4 (operator ruling 2026-11-20 grants REOPEN D-2, D-3 and D-6 (P-1, P-2, P-3 user reopened); see D-9 and context.md 2026-11-20.) |
| O-12 | 3 | Step 6 must use a side-effect import (`import '../acProof.js';`), with acProof.ts at the src/ root. Notify's tsconfig (module commonjs, no verbatimModuleSyntax or isolatedModules) elides an unused named import, so c8 would never load the module. | no | closed @ round 4 (r4 A5 puts acProof.ts at the src/ root and loads it with the side-effect import `import '../acProof.js';`.) |
| O-13 | 3 | The proof module needs about 1.17× notify's line count (86.61% last measured). Generate it with a script and record T, covered and N in context.md. | no | closed @ round 4 (r4 A5 generates the module with a throwaway script and records T, covered and N in context.md.) |
| O-14 | 3 | @AC-2 says `ruff check scripts/` while the job runs `ruff check .` in scripts/. Record the proven equivalence in context.md and at the C-16 promotion, or amend the wording with sign-off. | no | closed @ round 4 (The Part B proof runs both `ruff check scripts/` from the root and `ruff check .` in scripts/, records the equivalence in context.md and carries it to the C-16 promotion.) |
| O-15 | 3 | If scripts-python is red at spec time, block and escalate for an operator ruling. Do not ship with @AC-2 unproven. | no | closed @ round 4 (r4 Part B blocks and escalates for an operator ruling if scripts-python is red at spec time.) |
| O-16 | 3 | The ruff-defect sidecar's `resolved` transition must cite c4b70c27 (#1514) plus the step-7 proof. | no | closed @ round 4 (r4 Part C has the ruff sidecar's resolved transition cite c4b70c27 (#1514) plus the B proof.) |
| O-17 | 3 | The spec must say 'revert, do not stage' for every temporary proof edit (F-08). | no | closed @ round 4 (r4 A5 and Part B state 'revert, do not stage' for acProof.ts, the test import and every planted import.) |
| O-18 | 4 | Drop the root CLAUDE.md docs touchpoint unless the D-7 re-grep finds a 'not enforced' claim there; re-cite docs/patterns/ci-overview.md at :25 and :90 (F-04/C-10). | no | open |
| O-19 | 4 | If Part B ships no ruff code, context.md and the ruff sidecar must state that @AC-2's pre-fix red state is the tree before c4b70c27 (#1514), cited rather than re-run (C-15). | no | open |
| O-20 | 4 | The Part B green proof must include `uv run --no-sync pytest`, because scripts-python runs it (ci.yml:893-894). | no | open |
| O-21 | 4 | At merge-train time, re-check that scripts-python and its ci-gate entries (ci.yml:1392, :1425) are still present; do not re-run the whole proof. | no | open |

## Reopen Petitions

<!-- Verdict: dropped (evidence not new — already on record at <ID>) | pending user | user reopened | user declined -->
| ID | Round | Target | New evidence | Verdict |
|---|---|---|---|---|
| P-1 | 3 | D-2 | scripts/pyproject.toml:25-27 already holds [tool.ruff] extend-exclude = ["config-wiring-fixtures"], added by c4b70c27 (#1514). A same-directory ruff.toml would shadow it. Recon recorded that no ruff config existed. | user reopened |
| P-2 | 3 | D-3 | ci.yml:861-894 is an existing path-filtered scripts-python job (ruff check, format --check, pytest), listed in ci-gate at :1319 and :1350. The SOPS ruff step is already absent (:1202-1220). A second job would duplicate it (C-18). | user reopened |
| P-3 | 3 | D-6 | scripts/pyproject.toml:5 requires-python = ">=3.12" already makes ruff infer py312, which is D-6's tie-break outcome. With no ruff.toml, D-6 has nowhere to be set. | user reopened |
| P-4 | 4 | D-2 | Proposer re-raises P-1: scripts/pyproject.toml:25-27 already holds [tool.ruff] extend-exclude; a same-directory ruff.toml would shadow it. No recorded user ruling yet. | dropped (evidence not new) |
| P-5 | 4 | D-3 | Proposer re-raises P-2: scripts-python at ci.yml:861-894 already runs ruff check, format --check and pytest and is in ci-gate (:1392, :1425). No recorded user ruling yet. | dropped (evidence not new) |
| P-6 | 4 | D-6 | Proposer re-raises P-3: scripts/pyproject.toml:5 requires-python >=3.12 makes ruff infer py312. No recorded user ruling yet. | dropped (evidence not new) |
| P-7 | 4 | R-5 | Adversary: ci.yml:893-894 already runs pytest in scripts-python, so record R-5 as moot-by-tree. The pytest fact is already on record at P-2, and R-5 bars adding tests to a new job, which this feature does not do. | dropped (evidence not new) |

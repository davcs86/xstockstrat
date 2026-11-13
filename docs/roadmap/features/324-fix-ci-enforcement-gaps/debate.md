# Debate Register: fix-ci-enforcement-gaps

**State**: in-debate
**Mode**: full
**Rounds run**: 3

## Rounds

| Round | Date | Run by | +D | +R | O closed | +O | Petitions | Progress |
|---|---|---|---|---|---|---|---|---|
| 1 | 2026-11-11 | /sdd-batch | 4 | 3 | 0 | 6 | 0 | yes |
| 2 | 2026-11-11 | /sdd-batch | 2 | 2 | 3 | 4 | 0 | yes |
| 3 | 2026-11-13 | /sdd-batch | 1 | 2 | 3 | 7 | 3 | yes |

## Settled Decisions

<!-- Status: settled → superseded by D-m (only after a user-approved REOPEN) -->
| ID | Round | Decision | Evidence | Status |
|---|---|---|---|---|
| D-1 | 1 | The coverage threshold lives only in each leaf's `test:coverage` script as `--check-coverage --lines 40`. The `node-test` matrix `coverage_threshold` values are deleted. | services/xstockstrat-notify/package.json:13; ci.yml:628-638; @AC-1 runs pnpm run test:coverage directly | settled |
| D-2 | 1 | The ruff fixture exclusion goes in `scripts/ruff.toml` (`extend-exclude = ["config-wiring-fixtures"]`), not in a CI flag. | @AC-2 names plain `ruff check scripts/` / `ruff format --check scripts/`; 19 checker fixtures | settled |
| D-3 | 1 | The scripts ruff gate is a new path-filtered `scripts-python-lint` job, added to both ci-gate lists. The SOPS-only ruff step is removed. | ci.yml:68-70, :87-101, :685-691, :1023-1027, :1117-1167 | settled |
| D-4 | 1 | A leaf that measures below 40% gets tests; the threshold is not lowered. | platform.feature @AC-4/@AC-5; product-spec Open Q1 | settled |
| D-5 | 2 | The regression guard is a single node-test step that reads only `scripts['test:coverage']`. It requires a whitespace-delimited `--check-coverage` token before the first `node` token and never reads the threshold value. No other guard copies are added. | services/xstockstrat-notify/package.json:13; ci.yml:658; r2 proposal and adversary agree (C-18) | settled |
| D-6 | 2 | `scripts/ruff.toml` sets target-version to py312 or py313, chosen from the ruff check and format --check counts measured at spec time. Ties go to py312. | three scripts declare requires-python >=3.12; fails.md:3432-3435 | settled |
| D-7 | 3 | Before /sdd-spec, the feature branch is synced to origin/main-dev, recon.md is re-stamped (its scripts/ and ci.yml Codebase Map), and every ci.yml and package.json line citation is re-grepped at the branch tip. | origin/feature/fix-ci-enforcement-gaps 92eba11 is 41 commits behind origin/main-dev (git rev-list --count). Its tip lacks scripts/pyproject.toml, and its ci.yml has coverage_threshold at :628-634 where main-dev has :764-774. Both r3 sides assume this. | settled |

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

## Objections

<!-- Status: open → closed @ round N (<how>) | waived @ round N (user) | reopened @ round N (user) -->
| ID | Round | Objection | Blocking | Status |
|---|---|---|---|---|
| O-1 | 1 | The regression-guard grep hard-codes '40' (a third copy, C-18), fails on valid threshold or flag-order changes, and misses a regression in `test:coverage` when another script keeps the flag. Replace it with a structural check scoped to `scripts['test:coverage']` that never matches the threshold, or drop the guard. | yes | closed @ round 2 (r2 adopts the structural node -e check scoped to scripts['test:coverage'], with no threshold literal (now D-5).) |
| O-2 | 1 | C-10: the docs touchpoints miss spec-template.md:163, lang-node.md:9/48/52, the four leaf context-constitution-findings defect rows, and both defect-report .status sidecars. All must be in step Files lists (F-08). | yes | closed @ round 2 (r2 puts spec-template.md:163, lang-node.md:9/47/48/52/53, the four findings rows (:58/:63/:62/:64) and both .status sidecars in step Files lists.) |
| O-3 | 1 | Post-`ruff --fix` verification must include the config-wiring test, the ledger-guard invocation and homelab-render.test.sh, plus a manual diff review. | no | open |
| O-4 | 1 | Pin ruff, or record that floating latest is accepted on purpose, for the new scripts gate. | no | open |
| O-5 | 1 | Set target-version in scripts/ruff.toml after measuring churn. | no | closed @ round 2 (r2 chooses target-version from measured churn, with py312 winning ties (now D-6).) |
| O-6 | 1 | Size the @AC-1 proof module from the measured notify line total, and record both the c8 table figure and the forced-miss aggregate. | no | open |
| O-7 | 2 | C-01 (fails.md:3275-3277): measurement and the @AC-1 proof must record the table All-files % Lines, the `c8 check-coverage --lines 101` forced-miss aggregate run right after the wrapped run (no --all/--src/--allowExternal), and non-zero implementation rows. A passing --lines 40 run prints no aggregate. | yes | closed @ round 3 (r3 step 1 and step 6 record the table All-files % Lines, the `--lines 101` forced-miss aggregate (no --all/--src/--allowExternal) and non-zero implementation rows, per leaf and for the proof. The adversary concurs.) |
| O-8 | 2 | C-15/P-06: add a red proof for the negative clause of @AC-2: an unused import in a top-level script and in scripts/tests/test_manage_users.py fails `ruff check scripts/`, and one in a fixture is ignored. Add a red/green run of the guard step against the unflagged and flagged package.json, recorded in context.md. | yes | closed @ round 3 (r3 step 7 plants red proofs in a top-level script, in test_manage_users.py and in a fixture (ignored), run in both invocation forms. Step 5 adds the guard red/green. All are recorded in context.md, and the adversary concurs.) |
| O-9 | 2 | `build-launch-pdfs.py` EXE001 cannot be auto-fixed. The spec must choose chmod +x or removing the shebang. | no | open |
| O-10 | 2 | The guard must require `--check-coverage` before the first `node` token, and the step must be written as a `run: \|` block scalar. | no | closed @ round 3 (r3 step 4 requires the token order c8 < --check-coverage < node, in a `run: \|` block scalar.) |
| O-11 | 3 | The operator must rule on REOPEN D-2, D-3 and D-6 before approval, because the settled text conflicts with the tree: - D-2's new ruff.toml would shadow scripts/pyproject.toml:25-27. - D-3's new job would duplicate scripts-python at ci.yml:861-894. - D-6 has no home without a ruff.toml. Part B cannot be specced until then. | yes | open |
| O-12 | 3 | Step 6 must use a side-effect import (`import '../acProof.js';`), with acProof.ts at the src/ root. Notify's tsconfig (module commonjs, no verbatimModuleSyntax or isolatedModules) elides an unused named import, so c8 would never load the module. | no | open |
| O-13 | 3 | The proof module needs about 1.17× notify's line count (86.61% last measured). Generate it with a script and record T, covered and N in context.md. | no | open |
| O-14 | 3 | @AC-2 says `ruff check scripts/` while the job runs `ruff check .` in scripts/. Record the proven equivalence in context.md and at the C-16 promotion, or amend the wording with sign-off. | no | open |
| O-15 | 3 | If scripts-python is red at spec time, block and escalate for an operator ruling. Do not ship with @AC-2 unproven. | no | open |
| O-16 | 3 | The ruff-defect sidecar's `resolved` transition must cite c4b70c27 (#1514) plus the step-7 proof. | no | open |
| O-17 | 3 | The spec must say 'revert, do not stage' for every temporary proof edit (F-08). | no | open |

## Reopen Petitions

<!-- Verdict: dropped (evidence not new — already on record at <ID>) | pending user | user reopened | user declined -->
| ID | Round | Target | New evidence | Verdict |
|---|---|---|---|---|
| P-1 | 3 | D-2 | scripts/pyproject.toml:25-27 already holds [tool.ruff] extend-exclude = ["config-wiring-fixtures"], added by c4b70c27 (#1514). A same-directory ruff.toml would shadow it. Recon recorded that no ruff config existed. | pending user |
| P-2 | 3 | D-3 | ci.yml:861-894 is an existing path-filtered scripts-python job (ruff check, format --check, pytest), listed in ci-gate at :1319 and :1350. The SOPS ruff step is already absent (:1202-1220). A second job would duplicate it (C-18). | pending user |
| P-3 | 3 | D-6 | scripts/pyproject.toml:5 requires-python = ">=3.12" already makes ruff infer py312, which is D-6's tie-break outcome. With no ruff.toml, D-6 has nowhere to be set. | pending user |

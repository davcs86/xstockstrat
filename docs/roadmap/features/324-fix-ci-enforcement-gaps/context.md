# Context Log: fix-ci-enforcement-gaps

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-10 (/sdd-triage)

- Bugs reported via defect reports (Issues disabled):
  - docs/reports/2026-10-28-node-leaf-c8-check-coverage-unenforced-defect.md — Node-leaf c8 `--lines 40` is declared but never enforced (SEV-3)
  - docs/reports/2026-10-29-scripts-ruff-lint-gap-defect.md — scripts/ Python fails ruff lint and format, and no CI job checks it (SEV-2)
- Cluster rationale: both are CI gates declared but not enforced; one ci.yml change set closes both.
- Severity: SEV-2 (highest; R2)
- Routed to SDD path (Track C); SEV-2 routed to C by operator decision 2026-11-10
- Created: feature.md, product-spec.md, acceptance.feature (regression scenarios @AC-1..2), context.md
- Affected services (from reports): config, ledger, identity, notify, scripts/, .github/workflows/ci.yml
- Root cause hypothesis: copied scripts without `--check-coverage`; ruff CI scoped to services only (a narrow two-SOPS-script ruff step now exists)
- Recommended design depth: full → `/sdd-design fix-ci-enforcement-gaps` (rationale: SEV-2 + ≥2 affected services — four Node leaves plus scripts/)
- Development branch: feature/fix-ci-enforcement-gaps

## Session 2026-11-10 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Warnings: bug-template conventions (no FR-N/@FR tags; no Consumer Surface section); OQ1 depends on measured current coverage; OQ2 scripts/tests in CI is a scope fork
- Overlap findings: WARN: ci.yml with 297/298/318; ledger/notify package.json with 323
- Recommended design depth: full (four Node leaves + scripts/ + ci.yml)
- Tree: ccr-500a9eb9-nvk45x (origin/main-dev 0fecb24d + triage/docs commits; no feature branch yet)

## Session 2026-11-11 — sdd-batch design gate (round 2)

The /sdd-design full debate stopped at the approval gate after round 2 (gate policy: halt). Per the grilling protocol, design.md is not written and status.md is unchanged. Register: `debate.md`.

## Open Threads

- **Approach (one PR, three parts).**
  - (A) Node-leaf gate. Each leaf's `test:coverage` gets `--check-coverage` before `--lines 40` (D-1). The `node-test` matrix `coverage_threshold` values are deleted. One structural guard step in `node-test` reads only `scripts['test:coverage']` and requires a `--check-coverage` token before the first `node` token. It never reads the threshold (D-5). The leaves are measured first. Any leaf below 40% gets tests; the threshold is never lowered (D-4). @AC-1 is proven in notify with a temporary under-covered `src/` module, which is then reverted.
  - (B) Ruff gate. `scripts/ruff.toml` gets `extend-exclude = ["config-wiring-fixtures"]` (D-2) and a measured `target-version`, with ties going to py312 (D-6). Cleanup is `ruff check --fix` plus `ruff format`, followed by a hand review of the diff and the full post-fix verification. A new path-filtered `scripts-python-lint` job goes in both ci-gate lists. The SOPS-only ruff step is deleted (D-3).
  - (C) Docs. ci-overview.md, the root CLAUDE.md CI/CD sentence (and the ruff row if ruff is pinned), spec-template.md:163, the lang-node.md lines, the four leaf findings rows and both defect-report `.status` sidecars. Every one goes in a step Files list (F-08).
- **Strongest open objections (blocking).**
  - O-7 (C-01, fails.md:3275-3277). A passing `--lines 40` run prints no aggregate. So for each leaf, the measurement and the @AC-1 proof must record three things: the table All-files % Lines, the `c8 check-coverage --lines 101` forced-miss aggregate (no `--all`/`--src`/`--allowExternal`), and non-zero implementation rows.
  - O-8 (C-15/P-06). There is no red proof yet for the negative clause of @AC-2. An unused import in a top-level script and in `scripts/tests/test_manage_users.py` must fail, and one in a fixture must be ignored. There is also no red/green run of the guard on the unflagged and flagged `package.json`.
  - The synthesized approach already includes both fixes. The next proposer must adopt them on the record.
- **Non-blocking open.**
  - O-3: add `py_compile` plus smoke runs for `measure-insertbars-cost.py`, `build-launch-pdfs.py` and `homelab-mtls-env.py`.
  - O-4: pin ruff and update the root CLAUDE.md row, or let it float and waive the objection.
  - O-6: placement and sizing of the proof module.
  - O-9: `build-launch-pdfs.py` EXE001 needs a choice between `chmod +x` and dropping the shebang.
  - O-10: the guard's token order, and writing the step as a `run: |` block scalar.
- **Floor status.** No Floor breaches.
- **@AC changes not covered by an operator decision.** feature-324 @AC-1 and @AC-2: EXTEND. platform.feature @AC-3, @AC-4, @AC-5, @AC-6 and @AC-24: PRESERVE.
- **Closed this round.** O-1 (now D-5), O-2 (every stale doc copy is in a Files list) and O-5 (now D-6). Newly locked: R-4 (dropping the guard) and R-5 (running `scripts/tests/` in the new job).

```sdd-batch-design-state
{
  "round": 2,
  "synth": {
    "approach": "One PR in three parts. It builds on D-1 to D-4 and adds the r2 structural guard and the adversary's two blocking fixes. All paths are relative to the worktree.\n\nA. Node-leaf gate (D-1, D-4)\n- Flag. In each leaf's `test:coverage`, insert `--check-coverage` directly before `--lines 40`. The script becomes `tsc && c8 --reporter=text --reporter=lcov --check-coverage --lines 40 node --test dist/__tests__/*.test.js`. Files: `services/xstockstrat-{config,identity,notify}/package.json:13` and `services/xstockstrat-ledger/package.json:14`.\n- Matrix. Delete the five `coverage_threshold: 40` lines at `ci.yml:628-638`, and reword the ui comment at `:635-636`. The only consumers are at `:342` and `:477`.\n- Guard (D-5). Add one `node-test` step before \"test with coverage\" (`ci.yml:658`):\n  - `if: matrix.service != 'xstockstrat-ui'` and `working-directory: services/${{ matrix.service }}`.\n  - Written as a `run: |` block scalar that calls `node -e`.\n  - It reads only `require('./package.json').scripts['test:coverage']` and splits it on whitespace.\n  - It fails unless an exact `--check-coverage` token appears before the first `node` token. A flag moved after `node --test` would go to node, not c8, so the order matters.\n  - It never reads the threshold number. No second guard anywhere else (C-18).\n- Measure first (build step 1). For each leaf, run `pnpm run test:coverage`, then immediately `pnpm exec c8 check-coverage --lines 101`, with no `--all`, `--src` or `--allowExternal` (fails.md:3275-3277). Record three figures per leaf in context.md:\n  - the All-files % Lines from the c8 table;\n  - the aggregate printed by the forced-miss run;\n  - confirmation that the implementation-module rows are non-zero.\n  - Any leaf below 40% gets test steps before the flag lands. Their test files are named in that step's Files list once measured (F-08). The threshold is never lowered (R-2).\n- @AC-1 proof, in notify only:\n  - Add a temporary module under `src/` so tsc emits it to `dist/`. It must be imported by a `dist/__tests__` file, because c8 runs without `--all`. Its body should be mostly uncalled functions, because V8 counts executed top-level statements as covered.\n  - Size it as N > (measured covered lines / 0.4) - measured total lines, plus a margin.\n  - Run `pnpm run test:coverage`. Record the non-zero exit, the table total, the forced-miss aggregate, and a non-empty row for the new module.\n  - Revert the module.\n- Guard red/green. Run the guard against the unflagged `package.json` (it must fail), then against the flagged one (it must pass). Record both in context.md.\n\nB. Ruff gate for scripts/ (D-2, D-3)\n- `scripts/ruff.toml`: `extend-exclude = [\"config-wiring-fixtures\"]`, plus `target-version` (D-6). Choose `py312` or `py313` from the measured `ruff check` and `ruff format --check` counts under each; ties go to py312. Keep the default line length unless the measured churn says otherwise. Record the numbers.\n- Cleanup:\n  - Run `ruff check --fix` and `ruff format` on the top-level scripts and `scripts/tests/`, then review the diff by hand.\n  - If a removed import was a side-effect import, revert it with `# noqa: F401`.\n  - `build-launch-pdfs.py` EXE001 cannot be auto-fixed. At spec time, pick either `chmod +x` (a git mode change) or removing the shebang.\n- Verification after the fix:\n  - `bash scripts/sops-secrets.test.sh` (@AC-24)\n  - the config-wiring test via `check-config-wiring.mjs:262`\n  - the ledger-guard command at `ci.yml:941`\n  - `bash scripts/homelab-render.test.sh`, but only counted for `homelab-mtls-env.py` if shown to exercise it; otherwise give that script its own smoke run\n  - `uv run pytest scripts/tests/`\n  - `python3 -m py_compile` over `scripts/*.py` and `scripts/tests/*.py`\n  - a `--help` or usage smoke run for `measure-insertbars-cost.py`, `build-launch-pdfs.py` and `homelab-mtls-env.py`\n- @AC-2 red proof, after cleanup:\n  - Add an unused `import os` to a top-level script. `ruff check scripts/` must exit non-zero. Revert.\n  - Repeat in `scripts/tests/test_manage_users.py`.\n  - Add an unused import in a fixture under `config-wiring-fixtures/`. It must be ignored.\n  - Record all of it in context.md.\n- New `scripts-python-lint` job, shaped like `shell-lint` (`ci.yml:685-691`):\n  - `needs: changes`, and `if:` the scripts or ci filter matched.\n  - Steps: checkout, setup-python 3.13, `python3 -m pip install ruff==<version measured at spec>`, `ruff check scripts/`, `ruff format --check scripts/`.\n  - Register it in both ci-gate lists (`:1117-1140` needs, `:1145-1167` echo).\n  - If ruff is pinned, the root CLAUDE.md Language Versions ruff row must say it is pinned in `ci.yml` `scripts-python-lint` while services float, and that row goes in a Files list. Otherwise float it and waive O-4 explicitly.\n- Delete the SOPS ruff step (`ci.yml:1023-1027`). Keep `setup-python` in `sops-secrets`.\n- Out of scope: running `scripts/tests/` in CI (Open Q2).\n\nC. Docs (C-10). Every file below goes in a step's Files list (F-08):\n- `docs/patterns/ci-overview.md:23` and `:82`, plus a job-matrix row for the new job.\n- The root CLAUDE.md CI/CD Overview sentence. Also the ruff tooling row, if ruff is pinned.\n- `.claude/skills/sdd-spec/reference/spec-template.md:163`\n- `.claude/skills/sdd-qa/reference/lang-node.md:9`, `:47`, `:48`, `:52`, `:53`\n- The defect rows in the context-constitution-findings files for config `:58`, ledger `:63`, identity `:62` and notify `:64`. Follow each file's own convention.\n- Both defect-report `.status` sidecars, set to `resolved`.\n\nBuild order:\n1. Measure the leaves and add tests if any is below 40%.\n2. Add the flag and the guard, and delete the matrix values. Prove the guard red then green.\n3. Prove @AC-1 in notify, then revert.\n4. Add ruff.toml, measure, clean up, review the diff, and run every verification above.\n5. Prove @AC-2 red.\n6. Add the job and its ci-gate entries, and delete the SOPS step.\n7. Update the docs, findings rows and sidecars.",
    "open_objections": [
      {
        "text": "C-01 ledger repeat (fails.md:3275-3277): the measurement and @AC-1 proof steps must record, per leaf, three things: the c8 table All-files % Lines, the aggregate from a `c8 check-coverage --lines 101` forced miss run right after the wrapped run (no --all/--src/--allowExternal), and non-zero implementation rows. A passing `--lines 40` run prints no aggregate, so the r2 measurement would record nothing.",
        "blocking": true
      },
      {
        "text": "C-15/P-06: nothing proves the negative clause of @AC-2. A step must show `ruff check scripts/` exiting non-zero after an unused import is added to a top-level script and again to `scripts/tests/test_manage_users.py`, and an unused import in a fixture being ignored. The guard step also needs a red run on the unflagged package.json and a green run on the flagged one. Record all of it in context.md.",
        "blocking": true
      },
      {
        "text": "O-3 (still partial): the post-fix verification must also run `py_compile` over scripts/*.py and scripts/tests/*.py, plus smoke runs for `measure-insertbars-cost.py`, `build-launch-pdfs.py` and `homelab-mtls-env.py`. homelab-render.test.sh counts as coverage for homelab-mtls-env.py only if it is shown to exercise it.",
        "blocking": false
      },
      {
        "text": "O-4 (still partial): pinning ruff only in scripts-python-lint adds an unlisted pinned copy (C-10). Either update the root CLAUDE.md ruff tooling row in the same PR and list it in Files, or float ruff like python-lint and waive O-4 on the record.",
        "blocking": false
      },
      {
        "text": "O-6 (still partial): the proof module must sit under src/, be imported by a dist/__tests__ file, and be mostly uncalled function bodies, because V8 counts executed top-level code as covered and the N formula can otherwise come out too small. Also record the --lines 101 forced-miss aggregate.",
        "blocking": false
      },
      {
        "text": "`build-launch-pdfs.py` EXE001 cannot be fixed by `ruff --fix`. The spec must choose `chmod +x` or removing the shebang so the cleanup step does not stall during execute.",
        "blocking": false
      },
      {
        "text": "Guard precision: the `--check-coverage` token must come before the first `node` token, or it reaches node instead of c8. Write the step as a `run: |` block scalar instead of a plain scalar with nested quotes.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "feature-324:@AC-1",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "feature-324:@AC-2",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "platform.feature:@AC-3",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "platform.feature:@AC-4",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "platform.feature:@AC-5",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "platform.feature:@AC-6",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "platform.feature:@AC-24",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "CI-only c8 check-coverage with the matrix values kept (R-1): fails @AC-1, which runs pnpm run test:coverage directly.",
      "Lowering the per-leaf threshold (R-2): weakens @AC-4/@AC-5 and needs operator sign-off.",
      "Ruff steps inside shell-lint (R-3): the job name would mislead when ruff fails.",
      "Literal grep guard for '--check-coverage --lines 40': a third copy of the threshold, brittle to valid edits, and blind to a regression in test:coverage while another script keeps the flag.",
      "Dropping the guard and relying on @AC-1 plus measured margin: loses the only red signal when someone removes the flag while coverage is at or above 40%.",
      "Running scripts/tests/ under the new job (Open Q2): goes beyond @AC-2 (YAGNI); revisit only if the --fix diff touches manage-users.py logic.",
      "Excluding fixtures with a CI CLI flag: the plain @AC-2 commands would fail locally.",
      "Keeping the SOPS ruff step next to the new job: duplicate coverage, since every SOPS Python file sits under scripts/**.",
      "Adding --all to c8: changes what the coverage numbers mean, and needs separate sign-off."
    ],
    "open_risks": [
      "Turning on --check-coverage may turn one or more leaves red, adding unsized test work. Measure before writing the spec.",
      "c8 without --all measures only loaded dist files, so the gate is weaker than it looks. This is accepted.",
      "ruff --fix may change side-effect imports or format-sensitive strings in CI and deploy tooling whose own jobs fire only on narrower path filters.",
      "A pinned ruff in CI and a floating local or services ruff can disagree on format --check after an upstream release.",
      "Cleanup size and target-version churn are unmeasured (fails.md:3432-3435).",
      "Merge conflicts in ci.yml with features 297, 298 and 318, and in the ledger and notify package.json files with feature 323. Rebase at execute time.",
      "Assumed but not verified: the config-wiring checker depends on exact fixture text.",
      "homelab-render.test.sh may not exercise homelab-mtls-env.py, which would leave it without an automated consumer."
    ],
    "constitution_rules_touched": [
      "C-01",
      "C-08",
      "C-10",
      "C-11",
      "C-15",
      "C-16",
      "C-18",
      "P-02",
      "P-06",
      "F-08"
    ],
    "rationale": "Both sides agree on D-1 to D-4, and the adversary found no Floor breach or register violation.\n\nThree r1 objections are closed by the r2 proposal:\n- O-1: it adopts the structural guard, which checks only scripts['test:coverage'] and never the threshold.\n- O-2: it lists every stale doc copy at confirmed lines.\n- O-5: it picks target-version from measured counts, with py312 winning ties.\n\nTwo new blocking objections are not answered by the proposal, so they stay open:\n- The r2 measurement step runs `check-coverage --lines 40`, which prints no aggregate when it passes. This repeats fails.md:3275-3277. The fix is the `--lines 101` forced miss.\n- The negative clause of @AC-2 and the new guard step have no red-before-green proof.\n\nO-3, O-4 and O-6 were only partly answered. Each stays open as non-blocking, with the missing pieces stated.\n\nThe approach above already folds in every fix (the forced-miss protocol, the red proofs, the py_compile and smoke runs, the EXE001 choice, the guard token order, the proof-module placement), so the next proposer can adopt them as written. The guard and target-version decisions are settled now as D-5 and D-6. Dropping the guard and running scripts/tests in CI are locked as rejected.",
    "register_delta": {
      "new_decisions": [
        {
          "text": "The regression guard is a single node-test step that reads only `scripts['test:coverage']`. It requires a whitespace-delimited `--check-coverage` token before the first `node` token and never reads the threshold value. No other guard copies are added.",
          "evidence": "services/xstockstrat-notify/package.json:13; ci.yml:658; r2 proposal and adversary agree (C-18)"
        },
        {
          "text": "`scripts/ruff.toml` sets target-version to py312 or py313, chosen from the ruff check and format --check counts measured at spec time. Ties go to py312.",
          "evidence": "three scripts declare requires-python >=3.12; fails.md:3432-3435"
        }
      ],
      "new_rejected": [
        {
          "text": "Dropping the coverage-flag regression guard and relying on @AC-1 plus the measured margin",
          "why": "It is the only red signal when the flag is removed while coverage is at or above 40%"
        },
        {
          "text": "Running scripts/tests/ under the new scripts-python-lint job",
          "why": "Beyond @AC-2 scope (YAGNI, Open Q2). Revisit only if the --fix diff touches manage-users.py logic."
        }
      ],
      "new_objections": [
        {
          "text": "C-01 (fails.md:3275-3277): measurement and the @AC-1 proof must record the table All-files % Lines, the `c8 check-coverage --lines 101` forced-miss aggregate run right after the wrapped run (no --all/--src/--allowExternal), and non-zero implementation rows. A passing --lines 40 run prints no aggregate.",
          "blocking": true
        },
        {
          "text": "C-15/P-06: add a red proof for the negative clause of @AC-2: an unused import in a top-level script and in scripts/tests/test_manage_users.py fails `ruff check scripts/`, and one in a fixture is ignored. Add a red/green run of the guard step against the unflagged and flagged package.json, recorded in context.md.",
          "blocking": true
        },
        {
          "text": "`build-launch-pdfs.py` EXE001 cannot be auto-fixed. The spec must choose chmod +x or removing the shebang.",
          "blocking": false
        },
        {
          "text": "The guard must require `--check-coverage` before the first `node` token, and the step must be written as a `run: |` block scalar.",
          "blocking": false
        }
      ],
      "closed_objections": [
        {
          "id": "O-1",
          "how": "r2 adopts the structural node -e check scoped to scripts['test:coverage'], with no threshold literal (now D-5)."
        },
        {
          "id": "O-2",
          "how": "r2 puts spec-template.md:163, lang-node.md:9/47/48/52/53, the four findings rows (:58/:63/:62/:64) and both .status sidecars in step Files lists."
        },
        {
          "id": "O-5",
          "how": "r2 chooses target-version from measured churn, with py312 winning ties (now D-6)."
        }
      ],
      "reopen_petitions": [],
      "reopened": []
    }
  },
  "floor_breaches": []
}
```

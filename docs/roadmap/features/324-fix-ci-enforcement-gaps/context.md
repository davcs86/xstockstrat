# Context Log: fix-ci-enforcement-gaps

> Distilled 2026-11-21 by /sdd-distill. Full pre-distill session prose is in git history (before this commit).

Append-only except for /sdd-distill rewrites. Each session appends a new ## Session entry.
Register of record: `debate.md` (D-1..D-9, R-1..R-8, O-1..O-21, P-1..P-7); approved approach: `design.md`.

---

## Decisions

- **Scope**: one PR, built 0 -> A -> B -> C; two defect reports clustered (Node-leaf c8 `--lines 40` declared but never enforced, SEV-3; scripts/ Python fails ruff lint/format with no CI job, SEV-2). Track C by operator decision 2026-11-10. Branch `feature/fix-ci-enforcement-gaps`. Affected: config, ledger, identity, notify, scripts/, `.github/workflows/ci.yml`. Root cause: copied scripts without `--check-coverage`; ruff CI scoped to services only.
- **(0) Sync (D-7)**: merge origin/main-dev into the feature branch, re-stamp recon.md (its `scripts/` and ci.yml Codebase Map), re-grep every ci.yml / package.json citation at the branch tip (recon predates c4b70c27 #1514).
- **(A) Node-leaf c8 gate (D-1, D-4, D-5, D-8; R-1, R-2, R-4, R-6, R-8)**: threshold lives only in each leaf's `test:coverage` as `--check-coverage` before `--lines 40` (config, identity, notify `package.json:13`; ledger `:14`); delete the five `coverage_threshold: 40` matrix lines and reword the ui comment (R-8: not kept on the ui entry, vitest owns that gate; R-1: a CI-only `c8 check-coverage` step with matrix values fails @AC-1, which runs `pnpm run test:coverage` directly). A leaf below 40% gets tests, the threshold is never lowered (D-4, R-2). One `node-test` guard step (skipped for xstockstrat-ui, `run: |` block scalar, before "test with coverage"): reads only `scripts['test:coverage']`, requires token order `c8` < `--check-coverage` < `node`, holds no threshold literal (D-5; R-4: dropping the guard rejected because it is the only red signal when the flag is removed while coverage >= 40%). Evidence (D-8, C-01 / fails.md:3275-3277): a per-leaf `## c8 measurement` table in context.md - git SHA, All-files % Lines, `c8 check-coverage --lines 101` forced-miss aggregate (no `--all`/`--src`/`--allowExternal`; a passing `--lines 40` run prints no aggregate), count of non-zero implementation rows, verdict - plus a second pass after the flag lands (exit 0 per leaf). @AC-1 red proof in notify only: a generated temporary `src/acProof.ts` loaded by a side-effect import (`import '../acProof.js';` from `src/__tests__/fanout.test.ts`; notify's tsconfig elides unused named imports), mostly uncalled functions (V8 counts executed top-level statements as covered), sized N > covered/0.4 - T plus margin (~1.17x notify's lines); record T, covered, N, non-zero exit, table total, `--lines 101` aggregate; revert both files, do not stage. R-6: narrowing the test glob as proof rejected (alters the script under test).
- **(B) scripts/ ruff (D-9, supersedes D-2/D-3/D-6; R-5, R-7)**: operator ruling 2026-11-20 (verbatim below): extend the existing `[tool.ruff]` in `scripts/pyproject.toml:25-27` (fixture exclude `config-wiring-fixtures`) and the existing path-filtered `scripts-python` CI job (`ci.yml:861-894`: `ruff check .`, `ruff format --check .`, pytest; in ci-gate at `:1392`/`:1425`; ruff locked 0.17.4 at `scripts/uv.lock:402-403`); no `scripts/ruff.toml` (R-7: it shadows `[tool.ruff]` and creates two homes, C-18), no second job, no `target-version` (py312 from `requires-python >=3.12`). Part B ships no ruff code: proof only, recorded here - green in both invocation forms (root `ruff check scripts/` + `ruff format --check scripts/`; job form in `scripts/` incl. `uv run --no-sync pytest`, O-20); planted `import os` goes red (F401) in a top-level script (`scripts/ledger-guard.py`) and `scripts/tests/test_manage_users.py`, ignored under `scripts/config-wiring-fixtures/`; revert each plant, nothing staged; @AC-2's pre-fix red state is the tree before c4b70c27 (#1514), cited not re-run (O-19). If `scripts-python` is red at spec/execute time: block and escalate, do not fix `scripts/` here (O-15). R-5: running `scripts/tests/` under a new job rejected (YAGNI; moot by tree - scripts-python already runs pytest).
- **(C) Docs (C-10, F-08; each in a step Files list)**: `docs/patterns/ci-overview.md:25,90`; `.claude/skills/sdd-spec/reference/spec-template.md:163`; `.claude/skills/sdd-qa/reference/lang-node.md:9,47,48,52-54`; four leaf findings rows (config `:60` [design said `:58`], identity `:62`, ledger `:63`, notify `:76`); both defect-report `.status` sidecars to `resolved`, the ruff one citing c4b70c27 (#1514) (`ref: commit:c4b70c27` since the sidecar format has no third line; Step 7 proof is cited in context.md, O-16/O-19). Root `CLAUDE.md` touchpoint dropped: no "not enforced" claim found (O-18). O-4 (ruff pin) closed at /sdd-spec: `scripts-python` is the sole ruff gate and its lock pins 0.17.4.
- **Spec-time facts (fb52065c, scratch export, node v22.23.4, c8 10.1.3)**: c8 baseline All files % Lines: config 92.26, identity 84.82, ledger 85.78, notify 90.7, every impl row non-zero, none below 40 so D-4 adds no test step; with the flag `pnpm run test:coverage` exits 0 in all four; guard exits 1 unflagged, 0 flagged, 1 flag-after-`node`; notify proof (40 functions x 101 lines) 37.32% Lines, exit 0 unflagged, exit 1 flagged with `(40%)` error; `scripts-python` green (both ruff forms exit 0, pytest passes 491), planted `import os` fails both forms in `ledger-guard.py` and `test_manage_users.py` and is ignored in a fixture. Steps (9): Steps 3+4+5 are one atomic unit (guard, notify proof, flag) with one red->green cycle; proof ordered before the flag inside the unit (design lists it after; design content unchanged); Step 1 sync, Step 2 measurement table, Step 7 ruff proof, Step 9 sidecars. Constitution touched: C-01, C-10, C-11, C-15, C-16, C-18, P-02, P-03, P-06, F-04, F-08; no Floor breaches. C-16: EXTEND feature @AC-1/@AC-2; PRESERVE platform @AC-3, @AC-4, @AC-5, @AC-6, @AC-24; no CHANGE.
- **Spec-writer assumptions (sdd-spec 2026-11-20)**: doubled-prefix directory path in the task read as a templating slip; "per-leaf measurement records" read as both spec-time records and Step 2 repeating them at the synced tip; CI edits to `node-test` reviewed by the four leaf service owners (reviewer registry has no CI-workflow or `scripts/` owner row).

### Operator decisions (binding, recorded 2026-11-20, verbatim)

- Operator decisions (2026-11-20). These reached the writer as the `/sdd-batch` gate answer (the workflow's `decisions`/`approvals` input), launched on the user request "Do the 3 suggested actions". The writer saw the request and the relayed rulings, not the text of the suggested actions.
  - REOPEN D-2, D-3 and D-6 granted (P-1, P-2, P-3 -> `user reopened`): extend the existing `[tool.ruff]` in `scripts/pyproject.toml` and the existing path-filtered `scripts-python` CI job; no `scripts/ruff.toml`, no second job; the py312 target comes from `requires-python`.
  - The spec must carry per-leaf measurement records for @AC-1 and a step showing `ruff check scripts/` exits non-zero for the @AC-2 negative clause.
  - Design approved at the gate.
- Operator decision (2026-11-10, triage): SEV-2 routed to Track C.
- Round 4 history: the round-4 "operator steer" reached the debate only inside script-computed text; no user ruling on P-1/P-2/P-3 was recorded until the 2026-11-20 gate ruling above, and "Yes, resume all together" does not decide them.

## Open Threads

- [ ] Step 9: operator to confirm `ref: commit:c4b70c27` for the ruff sidecar, or rule for keeping the feature ref - `resolved` + `ref: commit:c4b70c27` removes the sidecar's link to feature 324 while the Step 7 proof lives only in this context.md, and `/sdd-archiver` may prune a `resolved` report before 324 launches; spec keeps the `commit:` ref (sdd-spec assumption, O-16/O-19). Surface at the /sdd-execute checkpoint. (unaddressed)
- [ ] 323's spec (`implementation-spec.md:323` on `origin/feature/fix-orphaned-code`) says both 323 and 324 rewrite the root `pnpm-lock.yaml`; 324 does not touch the lock. Raise with the 323 writer or at merge-train time (outside this feature's scope; unaddressed).
- [ ] Step 1: merge origin/main-dev and re-stamp recon.md; log any moved citation in the spec's Deviation Log. Note: the feature branch was synced with main-dev (merge commit e1b20a57) before this distill, so the "168 commits behind / lacks `scripts/pyproject.toml` / pre-commit hook cannot find `scripts/check-duplication.py`" observations in the kept sessions below are stale; the re-stamp and re-grep are still required.
- [ ] Step 2: a leaf below 40 at the synced tip blocks the feature and returns it to /sdd-spec (D-4); spec-time values are 84.82 or higher. Record the `## c8 measurement` table here.
- [ ] Step 4: re-size the proof module from the Step 2 lcov totals (U > 3582 holds only for the spec-time totals; a run at 40% or more is an undersized module, not a proof); record T, covered and module size.
- [ ] Step 7: if `scripts-python` turns red before execute, stop and escalate; do not fix `scripts/` here. Record both invocation forms and the O-14 equivalence for the C-16 promotion (@AC-2 says `ruff check scripts/`, the job runs `ruff check .` in `scripts/`).
- [ ] Peer edits: `ci.yml` with 297, 298, 318 (318 appends `migration-order-gate` to `ci-gate` at `:1394`/`:1427`) and the four leaf `package.json` files with 323 (edits all four manifests, `:11` plus dead dependencies) and 316 (notify `package.json:21`, different key) - re-grep cited lines after any later main-dev merge; expect conflicts at the sync.
- [ ] Merge-train (O-21): re-check `scripts-python` and its ci-gate entries survive peer `ci.yml` edits; re-run Step 7's wiring check only.
- [ ] Register hygiene: O-3, O-9 stay moot (only live if `scripts-python` is red); O-18..O-21 left `open` in debate.md (adopted in design/spec).
- [x] O-4 (ruff pin) and O-18 (root CLAUDE.md touchpoint dropped): closed at /sdd-spec.

## Files Modified

- none yet - no /sdd-execute step has run. Planned (implementation-spec.md): the four leaf `package.json` files (config, identity, notify `:13`; ledger `:14`), `.github/workflows/ci.yml` (`node-test` matrix + guard step), temporary notify `src/acProof.ts` + `src/__tests__/fanout.test.ts` import (reverted, not staged), recon.md re-stamp, docs (`ci-overview.md`, `spec-template.md`, `lang-node.md`, four findings rows), both defect-report `.status` sidecars.

## Superseded Sessions

- 2026-11-10 (/sdd-triage): two defect reports clustered; root cause = gates declared but not enforced; one ci.yml change set closes both; depth full (SEV-2, four Node leaves + scripts/); created feature/product-spec/acceptance (@AC-1..2)/context.
- 2026-11-10 (sdd-review product-spec): approved, draft -> spec-ready. Warnings: bug-template conventions, OQ1 depends on measured coverage, OQ2 (scripts/tests in CI) is a scope fork (later R-5). Overlap WARN: ci.yml with 297/298/318; ledger/notify package.json with 323.
- 2026-11-11 (sdd-batch design gate round 2; halted at gate): synthesised Parts A/B/C (see Decisions); closed O-1 (-> D-5), O-2, O-5 (-> D-6); opened blocking O-7 (forced-miss protocol) and O-8 (red proofs for @AC-2 negative clause and guard); locked R-4, R-5. Round-2 fence dropped as superseded (recoverable from debate.md and the round-4 fence below).
- 2026-11-13 (sdd-batch design gate round 3; halted): found branch 41 commits behind main-dev and c4b70c27 (#1514) already added `[tool.ruff]` + `scripts-python` -> D-7 (sync before spec); blocking O-11 (operator must rule on reopen P-1/P-2/P-3); closed O-7, O-8, O-10; locked R-6, R-7. Round-3 fence dropped as superseded.
- 2026-11-20 (sdd-batch design gate round 4; halted at gate): D-8, R-8; closed O-6, O-12..O-17; P-4..P-7 dropped (evidence not new); P-1..P-3 pending user; Part B conditional on ruling (path (a) proof-only preferred vs path (b) move `[tool.ruff]` into `ruff.toml`). Last design state (the only `sdd-batch-design-state` fence in this file, last in file):


```sdd-batch-design-state
{
  "round": 4,
  "synth": {
    "approach": "One PR in three parts, built 0 -> A -> B -> C. Line numbers are from the working tree (matching main-dev) and must be re-grepped after step 0.\n\n**Register status first.** The task text carries an \"OPERATOR STEER\" reopening D-2, D-3 and D-6, but it arrived only inside script-computed text. The same text says \"OPERATOR DECISIONS: none recorded\", the relayed user line is only \"Yes, resume all together\", and context.md on origin/feature/fix-ci-enforcement-gaps (937a3753) still has `\"reopened\": []` with P-1/P-2/P-3 `pending user`. I therefore did not treat the three decisions as reopened. Part B stays conditional, exactly as in round 3, and O-11 stays blocking. The steer's two proof requests (per-leaf @AC-1 records, @AC-2 negative-clause red step) conflict with nothing in the register and are adopted on merit.\n\n**0. Sync (D-7).** Merge origin/main-dev into `feature/fix-ci-enforcement-gaps`, re-stamp recon.md, re-grep every cited line.\n\n**A. Node-leaf c8 gate (D-1, D-4, D-5; register-clean, ready for spec)**\n1. **Per-leaf measurement records (@AC-1 proof).** For each of config, identity, ledger, notify:\n   - Run `pnpm run test:coverage`, then immediately `pnpm exec c8 check-coverage --lines 101`, with no `--all`, `--src` or `--allowExternal`.\n   - Write one row per leaf in a `## c8 measurement` table in context.md: leaf | git SHA | All-files % Lines (table) | forced-miss aggregate | count of implementation rows with non-zero lines | verdict (>=40 / <40).\n   - Second pass after step 2: record `pnpm run test:coverage` exiting 0 for every leaf with the flag in place.\n   - Any leaf below 40 gets a named test step before the flag lands (D-4; R-2).\n2. **Flag.** Insert `--check-coverage` before `--lines 40` in `services/xstockstrat-{config,identity,notify}/package.json:13` and `services/xstockstrat-ledger/package.json:14`.\n3. **Matrix.** Delete `coverage_threshold: 40` at `.github/workflows/ci.yml:764,766,768,770,774`. Reword the ui comment at :771-772 so it names no threshold.\n4. **Guard (D-5).** New `node-test` step before \"test with coverage\" (`ci.yml:794`): `if: matrix.service != 'xstockstrat-ui'`, `working-directory: services/${{ matrix.service }}`, a `run: |` block calling `node -e` that splits `scripts['test:coverage']` on whitespace and requires token order `c8` < `--check-coverage` < `node`. No threshold literal. Record red (unflagged) and green (flagged) runs in context.md.\n5. **@AC-1 red proof in notify.**\n   - Generate `services/xstockstrat-notify/src/acProof.ts` (src/ root, mostly uncalled function bodies) with a throwaway script.\n   - Load it from `src/__tests__/fanout.test.ts` with the side-effect import `import '../acProof.js';`.\n   - Size it so N > covered/0.4 - T plus margin; record T, covered, N.\n   - Run `pnpm run test:coverage`; record the non-zero exit, the table total, the `--lines 101` aggregate and a non-empty acProof row.\n   - Revert both files; do not stage them.\n\n**B. scripts/ ruff: still BLOCKED on an operator ruling for P-1/P-2/P-3 (O-11)**\nVerified tree facts: `scripts/pyproject.toml:25-27` holds `[tool.ruff] extend-exclude = [\"config-wiring-fixtures\"]`; `:5` has `requires-python = \">=3.12\"`; `scripts-python` (`ci.yml:861-894`) is path-filtered, runs `ruff check .` (:888), `ruff format --check .` (:891) and pytest (:893-894) with `working-directory: scripts`, and is in ci-gate at :1392 and :1425; ruff is locked at 0.17.4 (`scripts/uv.lock:402-403`).\n\n(a) **If the operator grants the reopens (preferred; both sides agree it is technically right).** No `scripts/ruff.toml`, no second job, no written `target-version` (py312 inferred from `requires-python`). Part B is proof-only, recorded verbatim in context.md:\n   1. `uv sync --project scripts --extra dev --frozen`.\n   2. Green: from the repo root `uv run --project scripts --no-sync ruff check scripts/` and `ruff format --check scripts/`; in the job form `cd scripts && uv run --no-sync ruff check . && uv run --no-sync ruff format --check . && uv run --no-sync pytest`. All exit 0.\n   3. Red (@AC-2 negative clause): plant `import os` as the first import in `scripts/ledger-guard.py`; `ruff check scripts/` must exit non-zero with F401 naming the file, and the job form must too. Revert.\n   4. Same in `scripts/tests/test_manage_users.py`: both forms non-zero. Revert.\n   5. Same in one file under `scripts/config-wiring-fixtures/`: both forms exit 0. Revert.\n   6. The sequence records the equivalence of `ruff check scripts/` and the job's `ruff check .`, and carries into the C-16 promotion. Nothing is staged.\n   7. State in context.md that @AC-2's pre-fix red state is the tree before c4b70c27 (#1514), cited rather than re-run.\n   - If `scripts-python` is red at spec time, block and escalate; O-3 and O-9 then apply.\n\n(b) **If the operator declines.** Move (not copy) `[tool.ruff]` from `scripts/pyproject.toml:25-27` into a new `scripts/ruff.toml` (D-2; R-7 forbids both), set `target-version` there (D-6). D-3 cannot be honored literally without duplicating `scripts-python` (C-18), so the operator must also say whether the existing job satisfies it. O-3, O-4 and O-9 are live. The same proof steps 2-7 run.\n\n**C. Docs (C-10, F-08), each in a step Files list**\n- `docs/patterns/ci-overview.md:25` and `:90` (re-cite after D-7).\n- Root `CLAUDE.md` only if a re-grep at the synced tip finds a \"not enforced\" claim; the adversary found none.\n- `.claude/skills/sdd-spec/reference/spec-template.md:163`.\n- `.claude/skills/sdd-qa/reference/lang-node.md:9,47,48,52,53`.\n- The four leaf findings defect rows.\n- Both `.status` sidecars to `resolved`; the ruff sidecar cites c4b70c27 (#1514) plus the B proof.\n\n**At merge-train time:** re-check that `scripts-python` and both ci-gate entries still exist; do not re-run the whole proof.",
    "open_objections": [
      {
        "text": "O-11 (blocking): the operator must rule on P-1 (D-2), P-2 (D-3) and P-3 (D-6). The round-4 'operator steer' reached this step only as script-computed text; no ruling is recorded in context.md (937a3753 still shows reopened: [] and the petitions pending user), and the user's 'Yes, resume all together' does not decide them. The orchestrator should ask the user directly and record the answer with an ISO timestamp. Part B cannot be specced until then.",
        "blocking": true
      },
      {
        "text": "O-3 (open): post-`ruff --fix` verification set. Needed only under path (b) or if scripts-python is red at spec time.",
        "blocking": false
      },
      {
        "text": "O-4 (open): ruff is locked at 0.17.4 via scripts/uv.lock:402-403 with --frozen/--no-sync, which answers this only if scripts-python is the sole ruff gate. Close it together with the O-11 ruling.",
        "blocking": false
      },
      {
        "text": "O-9 (open): the EXE001 choice for build-launch-pdfs.py. Needed only under path (b) or a red spec-time run.",
        "blocking": false
      },
      {
        "text": "New: Part C lists root CLAUDE.md, but the adversary's grep finds no 'not enforced'/check-coverage claim there. Drop it unless the D-7 re-grep finds one, and re-cite ci-overview.md at :25 and :90.",
        "blocking": false
      },
      {
        "text": "New: under path (a) this feature ships no ruff code, so @AC-2's positive clause has no fresh red run. context.md and the sidecar transition must cite the pre-c4b70c27 tree as the red state.",
        "blocking": false
      },
      {
        "text": "New: scripts-python also runs pytest (ci.yml:893-894), so the B green proof must include `uv run --no-sync pytest`.",
        "blocking": false
      },
      {
        "text": "New: at merge-train time, re-check that scripts-python and its ci-gate entries (ci.yml:1392, :1425) survive peer ci.yml edits (297, 298, 318).",
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
      "CI-only c8 check-coverage with matrix values kept (R-1): fails @AC-1.",
      "Lowering the per-leaf threshold (R-2).",
      "Ruff steps inside shell-lint (R-3).",
      "Dropping the coverage-flag guard (R-4).",
      "Running scripts/tests under a new lint job (R-5); the existing scripts-python job already runs pytest, which this feature does not add.",
      "Proving @AC-1 by narrowing the test glob (R-6).",
      "scripts/ruff.toml alongside the pyproject [tool.ruff] with the exclude copied (R-7).",
      "Keeping coverage_threshold on the ui matrix entry only: dead data (vitest owns that gate) and contradicts D-1.",
      "Writing target-version = \"py312\" in [tool.ruff]: duplicates requires-python. Not recorded in the register, because D-6 is still settled until the operator rules.",
      "Re-running the full Part B proof at the merge-train tip: the path-filtered gate already rejects peer ruff violations; only the job's presence needs re-checking."
    ],
    "open_risks": [
      "The operator ruling on P-1/P-2/P-3 is still missing, so Part B cannot be specced; path (b) would revive cleanup work and force a D-3 clarification.",
      "Turning on --check-coverage may put a leaf below 40%, adding unsized test work. Step A1 measures before the spec.",
      "c8 without --all measures only loaded files; the non-zero implementation-rows column is what catches an empty coverage map.",
      "The feature branch is behind main-dev; expect conflicts in ci.yml (297, 298, 318) and the ledger/notify package.json (323).",
      "A peer ci.yml edit could weaken or rename scripts-python or drop it from ci-gate.",
      "scripts-python (including pytest) could be red at spec time, leaving @AC-2 unprovable without a ruling.",
      "A proof module sized too small exits 0 and gives a false green unless T, covered and N are recorded."
    ],
    "constitution_rules_touched": [
      "C-01",
      "C-10",
      "C-11",
      "C-15",
      "C-16",
      "C-18",
      "P-02",
      "P-03",
      "P-06",
      "F-04",
      "F-08"
    ],
    "rationale": "Part B is not approved this round: I did not accept the \"operator steer\" as a reopen of D-2, D-3 and D-6, so O-11 stays blocking and `reopened` is empty.\n\n- **Why the steer does not count.** It appears only in the script-computed task text, which also says \"OPERATOR DECISIONS: none recorded\". The only user text is \"Yes, resume all together\". I checked context.md at origin/feature/fix-ci-enforcement-gaps (937a3753): it has `\"reopened\": []` and P-1/P-2/P-3 still pending. Only the operator reopens, so the orchestrator needs an explicit user answer on the three petitions.\n- **What both sides agree on.** The adversary verified the tree facts and called \"extend what exists\" the right design. I carry it as preferred path (a) and keep path (b) for a decline, as in round 3.\n- **Steer items adopted on merit.** The per-leaf @AC-1 measurement table and the @AC-2 negative-clause red step contradict nothing in the register and the adversary accepts both. The measurement table is recorded as a new decision.\n- **Objections closed.** O-6, O-12, O-13 (A5 adopts sizing, side-effect import, recorded T/covered/N), O-14 (both invocation forms proven and carried to C-16), O-15 (escalation written into Part B), O-16 (sidecar cites c4b70c27), O-17 (revert, do not stage). These hold under either path.\n- **Objections kept open.** O-3, O-4 and O-9 depend on the ruling. \"Moot\" is not a register status, so they stay open rather than closed.\n- **Petitions.** P-1/P-2/P-3 are re-raised with evidence already on record (is_new=false). The adversary's R-5 petition rests on pytest in scripts-python, which P-2 already records; R-5 bars adding tests to a new job, so the existing job does not contradict it and no reopen is needed.\n- **Part A** has no register conflict and can be specced once the branch is synced.",
    "register_delta": {
      "new_decisions": [
        {
          "text": "@AC-1 is evidenced by a `## c8 measurement` table in context.md with one row per leaf (config, identity, ledger, notify): git SHA, All-files % Lines, the `--lines 101` forced-miss aggregate, count of non-zero implementation rows, and verdict. A second pass after the flag lands records `pnpm run test:coverage` exiting 0 per leaf.",
          "evidence": "r4 proposal A1; adversary concurs and asks to keep the non-zero-rows column (fails.md:3274-3277); closed O-7"
        }
      ],
      "new_rejected": [
        {
          "text": "Keeping `coverage_threshold` on the xstockstrat-ui matrix entry only",
          "why": "Dead data (vitest owns that gate, ci.yml:771-772) and contradicts D-1."
        }
      ],
      "new_objections": [
        {
          "text": "Drop the root CLAUDE.md docs touchpoint unless the D-7 re-grep finds a 'not enforced' claim there; re-cite docs/patterns/ci-overview.md at :25 and :90 (F-04/C-10).",
          "blocking": false
        },
        {
          "text": "If Part B ships no ruff code, context.md and the ruff sidecar must state that @AC-2's pre-fix red state is the tree before c4b70c27 (#1514), cited rather than re-run (C-15).",
          "blocking": false
        },
        {
          "text": "The Part B green proof must include `uv run --no-sync pytest`, because scripts-python runs it (ci.yml:893-894).",
          "blocking": false
        },
        {
          "text": "At merge-train time, re-check that scripts-python and its ci-gate entries (ci.yml:1392, :1425) are still present; do not re-run the whole proof.",
          "blocking": false
        }
      ],
      "closed_objections": [
        {
          "id": "O-6",
          "how": "r4 A5 sizes the proof module from measured T and covered (N > covered/0.4 - T plus margin) and records the table total and the forced-miss aggregate."
        },
        {
          "id": "O-12",
          "how": "r4 A5 puts acProof.ts at the src/ root and loads it with the side-effect import `import '../acProof.js';`."
        },
        {
          "id": "O-13",
          "how": "r4 A5 generates the module with a throwaway script and records T, covered and N in context.md."
        },
        {
          "id": "O-14",
          "how": "The Part B proof runs both `ruff check scripts/` from the root and `ruff check .` in scripts/, records the equivalence in context.md and carries it to the C-16 promotion."
        },
        {
          "id": "O-15",
          "how": "r4 Part B blocks and escalates for an operator ruling if scripts-python is red at spec time."
        },
        {
          "id": "O-16",
          "how": "r4 Part C has the ruff sidecar's resolved transition cite c4b70c27 (#1514) plus the B proof."
        },
        {
          "id": "O-17",
          "how": "r4 A5 and Part B state 'revert, do not stage' for acProof.ts, the test import and every planted import."
        }
      ],
      "reopen_petitions": [
        {
          "target": "D-2",
          "evidence": "Proposer re-raises P-1: scripts/pyproject.toml:25-27 already holds [tool.ruff] extend-exclude; a same-directory ruff.toml would shadow it. No recorded user ruling yet.",
          "is_new": false
        },
        {
          "target": "D-3",
          "evidence": "Proposer re-raises P-2: scripts-python at ci.yml:861-894 already runs ruff check, format --check and pytest and is in ci-gate (:1392, :1425). No recorded user ruling yet.",
          "is_new": false
        },
        {
          "target": "D-6",
          "evidence": "Proposer re-raises P-3: scripts/pyproject.toml:5 requires-python >=3.12 makes ruff infer py312. No recorded user ruling yet.",
          "is_new": false
        },
        {
          "target": "R-5",
          "evidence": "Adversary: ci.yml:893-894 already runs pytest in scripts-python, so record R-5 as moot-by-tree. The pytest fact is already on record at P-2, and R-5 bars adding tests to a new job, which this feature does not do.",
          "is_new": false
        }
      ],
      "reopened": []
    }
  },
  "floor_breaches": []
}
```

- 2026-11-20 (sdd-design, approved): recon.md written 2026-11-11 (predates c4b70c27, re-stamped at sync, D-7); 4 full rounds, approved at the gate; register at approval: State -> approved, P-1/P-2/P-3 -> `user reopened`, D-2/D-3/D-6 -> `superseded by D-9`, D-9 added by the writer to keep the register consistent with the ruling (script supplied no new rows), O-11 closed, Rounds-row counts unchanged. Chosen approach and operator ruling: see Decisions. Ledger: no new line (stale-recon trap covered by D-7 and existing fails.md entries).

## Session 2026-11-20 — sdd-spec

- Generated implementation-spec.md with 9 steps. Status → implementation-ready.
- Operator decisions applied (2026-11-20, relayed through the `/sdd-batch` task input): D-9 (extend the existing `[tool.ruff]` and the `scripts-python` job; no `scripts/ruff.toml`, no second job, py312 from `requires-python`); the spec carries per-leaf measurement records for @AC-1 and a step showing `ruff check scripts/` exits non-zero for the @AC-2 negative clause (Step 7).
- Assumptions made by this writer:
  - The task named the directory as `docs/roadmap/features/docs/roadmap/features/324-fix-ci-enforcement-gaps/`. That path does not exist; the doubled prefix was read as a templating slip and `docs/roadmap/features/324-fix-ci-enforcement-gaps/` was used.
  - "The spec must carry per-leaf measurement records" was read as both: the spec holds the spec-time records, and Step 2 repeats them at the synced tip into `context.md` (D-8).
  - The ruff sidecar gets `ref: commit:c4b70c27`, because the sidecar format has no third line; the Step 7 proof is cited in `context.md` instead (O-16, O-19).
  - CI edits to the `node-test` job are reviewed by the four leaf service owners; the reviewer registry has no CI-workflow or `scripts/` owner row.
- Tree: the feature branch tip `867a0380` is 168 commits behind `origin/main-dev` and lacks `scripts/pyproject.toml`, so every citation in the spec was grepped on an export of `origin/main-dev@fb52065c`. `git merge-tree --write-tree HEAD origin/main-dev` reports a clean merge. Step 1 performs the merge and re-stamps recon.md (D-7).
- Key codebase findings (all at `fb52065c`):
  - `test:coverage` at config, identity, notify `package.json:13` and ledger `:14`; `node-test` matrix values at `ci.yml:764,766,768,770,774`, coverage step at `:794-796`; Go and Python consumers at `:384` and `:519`.
  - `scripts-python` at `ci.yml:861-894`, in `ci-gate` at `:1392` and `:1425`; `[tool.ruff]` at `scripts/pyproject.toml:25-27`; ruff 0.17.4 at `scripts/uv.lock:402-403`.
  - Doc claims: `ci-overview.md:25,90`, `spec-template.md:163`, `lang-node.md:9,47,48,52-54`; findings rows at config `:60` (design said `:58`), identity `:62`, ledger `:63`, notify `:76`. The root `CLAUDE.md` holds no "not enforced" claim, so that touchpoint is dropped (O-18).
- Spec-time dry runs (scratch export, node v22.23.4, c8 10.1.3; nothing in the repo was edited):
  - c8 baseline, All files % Lines: config 92.26, identity 84.82, ledger 85.78, notify 90.7. Every impl row is non-zero. No leaf is below 40, so D-4 adds no test step.
  - With the flag, `pnpm run test:coverage` exits 0 in all four leaves. The guard exits 1 on the unflagged script, 0 on the flagged one, and 1 when the flag sits after `node`.
  - Notify proof (40 functions × 101 lines): 37.32% Lines; exit 0 unflagged, exit 1 flagged with the `(40%)` threshold error.
  - `scripts-python` is green: both ruff forms exit 0 and pytest passes 491. A planted `import os` fails both forms in `ledger-guard.py` and `test_manage_users.py` (F401) and is ignored in a fixture. The block-and-escalate condition does not apply; O-3 and O-9 stay moot.
- Spec shape: Steps 3+4+5 are one atomic unit (guard, notify proof, flag) with one red→green cycle. The proof also records the unflagged run, so @AC-1 has a RED on the buggy behavior. This orders the proof before the flag inside the unit, where design.md lists it after; the design content is unchanged.
- Ledger: no new line.

## Open Threads

- [ ] Step 1: merge origin/main-dev and re-stamp recon.md; log any citation that moved in the spec's Deviation Log.
- [ ] Step 2: a leaf below 40 at the synced tip blocks the feature and returns it to /sdd-spec (D-4). Spec-time values are 84.82 or higher.
- [ ] Step 4: re-size the proof module from the Step 2 lcov totals; record T, covered and the module size.
- [ ] Step 7: if `scripts-python` turns red before execute, stop and escalate; do not fix `scripts/` here.
- [ ] Peer `ci.yml` edits (297, 298, 318) and the ledger/notify `package.json` (323): re-grep cited lines after any later main-dev merge.
- [ ] Merge-train (O-21): re-run Step 7's wiring check only.
- [x] O-4 (ruff pin): closed at /sdd-spec. `scripts-python` is the only ruff gate over `scripts/`, and its lock pins 0.17.4.
- [x] O-18: closed at /sdd-spec. The root `CLAUDE.md` touchpoint is dropped.

## Session 2026-11-20 — sdd-review impl-spec (advisory)

- Result: 0 failures, 6 warnings, 0 Floor breaches (PASS WITH WARNINGS; advisory, did not block). Lifecycle unchanged (`implementation-ready`).
- Run under `/sdd-batch`: the two verdicts arrived as task input, and this writer edited `implementation-spec.md` to clear the clearly-correct warnings. That departs from Mode B's "do not modify the spec" line; the batch task asked for it.
- Re-verified before editing: `origin/main-dev` is still `fb52065c` (0 commits since the spec's tree); `git merge-base --is-ancestor c4b70c27 origin/main-dev` exits 0; the ruff sidecar reads `triaged` / `ref: feature:324-fix-ci-enforcement-gaps`; 323's spec edits all four leaf `package.json` files (`:11` plus dead dependencies, its Step at `implementation-spec.md:304-307`); 318's spec appends `migration-order-gate` to `ci-gate` at `:1394` and `:1427`; 316's context cites notify `package.json:21`.
- Addressed (spec edited):
  - [x] Step 3: Verification now states where the 40% line threshold is enforced (Step 5's script, proven by Step 4) and that the guard holds none by design (D-5, C-18).
  - [x] Step 4: the U > 3582 bound is marked as valid only for the spec-time totals and must be recomputed from Step 2's lcov. Verification now says a run at 40% or more is an undersized module, not a proof.
  - [x] Step 9: the executor confirms `c4b70c27` is an ancestor of `origin/main-dev` before writing `ref: commit:c4b70c27`, and Verification checks it. Evidence now records that the step drops the sidecar's feature ref.
  - [x] Overlap: the Step Dependencies peer line was wrong on 323 (it named only ledger and notify; 323 edits all four manifests). It now lists 318's `ci-gate` anchors, 297/298, 323, 316 and the lock file. Step 5's evidence points to it.
- Accepted as is (no edit; the criteria verdict called each acceptable):
  - Steps 3+4+5 as one 6-file commit with a symmetric three-member `Lands with` chain.
  - Step 7 has no coverage threshold, because none applies to `scripts/` (`ci-overview.md:22`).
  - Line numbers are provisional if main-dev moves; Step 1 and the Step Dependencies line already require a re-grep.
- Unresolved ⚠ carried into execution:
  - Step 9: `resolved` + `ref: commit:c4b70c27` removes the sidecar's link to feature 324 while the Step 7 proof lives only in this `context.md`, and `/sdd-archiver` may prune a `resolved` report before 324 launches. The spec keeps the `commit:` ref (sdd-spec assumption, O-16/O-19). Operator to confirm or rule for keeping `feature:324-fix-ci-enforcement-gaps` — [ ] unaddressed
  - 323's spec (`implementation-spec.md:323` on `origin/feature/fix-orphaned-code`) says both 323 and 324 rewrite the root `pnpm-lock.yaml`. 324 does not touch the lock. The text sits in 323's directory, outside this writer's scope — [ ] unaddressed
- Overlap findings (WARN, all rebase-level, no ordering change, no merge-order proposal needed):
  - `.github/workflows/ci.yml` with 318 (`ci-gate` lists are the likely shared edit point), 297 and 298 (no impl-spec yet).
  - The four leaf `package.json` files with 323 (distinct lines); notify `package.json` with 316 (different key).
- Hook note: the pre-commit hook printed `can't open file … scripts/check-duplication.py` on this branch, which is 168 commits behind main-dev and lacks that script. The commit still succeeded; `--no-verify` was not used. Step 1's merge brings the script in.
- Ledger: no new line.

## Open Threads

- [ ] Step 9: operator to confirm `ref: commit:c4b70c27` for the ruff sidecar, or rule for keeping the feature ref — surface at the /sdd-execute checkpoint.
- [ ] 323's spec claims 324 rewrites `pnpm-lock.yaml`; it does not. Raise with the 323 writer or at merge-train time.
- [ ] Step 1: merge origin/main-dev and re-stamp recon.md; log any citation that moved in the spec's Deviation Log.
- [ ] Step 2: a leaf below 40 at the synced tip blocks the feature and returns it to /sdd-spec (D-4).
- [ ] Step 4: re-size the proof module from the Step 2 lcov totals; record T, covered and the module size.
- [ ] Step 7: if `scripts-python` turns red before execute, stop and escalate; do not fix `scripts/` here.
- [ ] Peer edits to `ci.yml` (297, 298, 318) and the four leaf `package.json` files (323, 316): re-grep cited lines after any later main-dev merge.
- [ ] Merge-train (O-21): re-run Step 7's wiring check only.

## Session 2026-11-21 — /sdd-distill

- Distilled 8 sessions -> header + Superseded Sessions; kept 2 verbatim.
- context.md 794 -> 330 lines (79963 -> 38967 bytes). Original prose preserved in git history.
- Branch note: the feature branch was synced with main-dev (merge commit e1b20a57) before this distill; see the Step 1 thread.
- Dropped the superseded round-2 and round-3 `sdd-batch-design-state` fences (recoverable from debate.md and the round-4 fence); the round-4 fence is the sole, last fence, byte-identical.
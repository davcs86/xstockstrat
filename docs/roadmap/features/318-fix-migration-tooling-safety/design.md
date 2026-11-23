# Design: fix-migration-tooling-safety

**Created**: 2026-11-20
**Rounds**: 3 (full; termination: approved)
**Approved by**: user @ 2026-11-20 (operator approval at the design gate; operator decisions O-1, O-3, O-4 in context.md)
**Grounded in**: recon.md
**Debate register**: debate.md

---

## Chosen Approach

**Citations.** `recon.md:N` points at the recon dossier. Recon ran on an older tree (recon.md:5), where the
gate scripts were still `.sh` and `ci.yml` was shorter. The target-file line numbers below are the ones the
round-3 synthesis re-verified on `origin/main-dev`; `/sdd-spec` must re-grep them before planning.

**Consumer surface (C-14).** Internal-only. The change touches migrator tooling, CI and docs. It adds no proto,
config key, migration, UI route or Agent tool (recon.md:17, recon.md:137-142). The operator-facing surfaces are
the migrator's refusal text and one new CI job.

**Policy (operator decision O-1).** Refuse-all. `db-migrate.sh up` never auto-recovers a dirty service. It
prints a state-keyed recovery and exits non-zero. This pins the feature's own AC-1 to its second branch ("the
run stops naming `migrate force 4`") and overrides the product-spec outcome "without manual intervention".

### 1. Migrator — `scripts/db-migrate.sh:77-82` (D-1, D-14)

- The dirty arm becomes `"$REPO_ROOT/scripts/migration-dirty-guard.sh" "$dir" "$schema" "$ver" || true; exit 1`.
- The `[dirty] force-resetting` echo and the `migrate ... force 0` call at `:79-80` are deleted. This is the
  AC-1 site (recon.md:26).
- The stale comments at `:66-67` and `:69` ("before force 0 can replay") are rewritten.
- The ahead-check at `:70-76` still runs first (recon.md:25, recon.md:99).

### 2. Dirty guard — `scripts/migration-dirty-guard.sh` (D-2, D-5, R-3)

- Keep the version parse at `:13-17` (recon.md:32). Delete the contract-floor scan at `:19-43`, which holds both
  allow-paths to `force 0` (recon.md:33-35).
- Build the list of up-file versions as `10#` decimals (recon.md:105).
- Exit 2 with "cannot compute recovery" when the dir is empty, when no file n exists, or when n is above the
  local max.
- `prev` is the highest existing version below n. `next` is the lowest existing version above n. This replaces
  `prev=$((n - 1))` (recon.md:36), which names a missing version across the marketdata 007 and config
  024/035/036 gaps (recon.md:159-162).

### 3. Recovery text — a ratchet (D-6, D-10)

The text keeps the "x is dirty at version N" prefix, the literal `$DATABASE_URL` (`:45-52`) and exit 3, so the
strings `migration-rerun` asserts stay stable (recon.md:63-64, recon.md:168).

- **Primary line.** `Recover: migrate ... force <prev>`, then `up`. When file n is the lowest up-file the line
  names `TRUNCATE public.<schema>_schema_migrations` instead. No NilVersion `force -1` form is printed.
- **Escalation lines.**
  - If `up` then fails with "already exists" in file K (K = n, then next), first verify that K's effects are
    fully present, then `force K` and `up`.
  - The state-keyed targets are `force <n>`, and `force <next>` when a next exists.
  - Never force forward on doubt. Forcing forward skips K silently and forever, which is how seed files get
    lost.
  - "Objects exist" means nothing for contract or prune files. For those the operator verifies the effect, not
    the objects.
  - A DML file that replays successfully after `force <prev>` applies twice without any error. The text must
    tell the operator to read the file for that before running `up`.

### 4. Tests (D-9, D-13)

- **Guard tests move to pytest.** Add `scripts/tests/test_migration_dirty_guard.py`, which shells out to the
  bash guard. The same PR deletes `scripts/migration-dirty-guard.test.sh` (recon.md:67-71), its line 18 in
  `scripts/shell-allowlist.txt`, and its entry in the `ci.yml:841` test chain (recon.md:48).
- Assertions match the exact `Recover:` line, never a substring (fails.md:139).
- **Case table** (exit code, then the expected recovery):

  | Up-files | Dirty | Exit | Expected |
  |---|---|---|---|
  | 027 | 27 | 3 | TRUNCATE |
  | 026, 027 | 27 | 3 | Recover `force 26`, plus the "x is dirty at version 27" prefix |
  | 026, 027 | 26 | 3 | TRUNCATE |
  | 026, 027 | 25 or 20 | 2 | cannot compute recovery |
  | 026, 027 | garbage | 2 | — |
  | 001, 002, 003, 005, 006 | 5 | 3 | Recover `force 3`, with a `force 6` escalation |
  | 001, 002, 003, 005, 006 | 1 | 3 | TRUNCATE |
  | 001, 002, 003, 005, 006 | 4 | 2 | cannot compute recovery |
  | 001, 002, 003, 005, 006 | 7 | 2 | cannot compute recovery |
  | 001, 002, 003, 005, 006 | 6 | 3 | no next line |
  | (empty dir) | 5 | 2 | cannot compute recovery |
  | 019, 020, 026, 027 (027 declares contract-of 026) | 20 | 3 | Recover `force 19` |
  | 000, 001 | 1 | 3 | Recover `force 0` |

- Every case also asserts that no `postgres://` appears and that the literal `$DATABASE_URL` does.
- `force 0` for a 000-based service dirty at 1 is ordinary prev recovery. No test asserts that "force 0" is
  absent from output text.
- The legacy cases (f), (h) and (i) existed only to exercise contract headers and are dropped.
- **Migrator test.** `scripts/tests/test_db_migrate.py` runs `bash scripts/db-migrate.sh up` with stub `psql`
  and `migrate` on PATH. This is a new pattern; no harness stubs `migrate` today (recon.md:169). Every service
  except indicators returns 9999 (clean-ahead skip, exit 10). Indicators returns `5 (dirty)`. The test asserts
  exit 1, no `force` invocation in the stub's argv log, and the exact `Recover: ... force 4` line.

### 5. Ordering gate — `scripts/check-migration-order.py` (D-3, D-7, D-11, D-12)

- Python, per `docs/patterns/script-tooling.md:7-12`. It is shaped like `check-migration-contract.py:18-19,36-65`
  (recon.md:100-104) and takes `<base_ref> [--forbid-new]`. Exit 0 is ok, 1 is refused, 2 is a usage error.
- Added files come from
  `git diff --name-only --no-renames --diff-filter=A base...HEAD -- 'services/*/migrations/*.up.sql'`.
  `--no-renames` closes the renumber bypass (recon.md:164).
- Each NNN is compared as a `10#` decimal against the per-service max from `git ls-tree` on base. Existing gaps
  are tolerated because only the max is compared (recon.md:167).
- It fails when:
  - NNN is at or below the base max. The message names both numbers.
  - Two added files in a service share an NNN.
  - A base-tree `*.up.sql` is deleted or modified. The modify check mechanizes F-01.
  - `--forbid-new` is set and any up-file is added.
- Tests: `scripts/tests/test_check_migration_order.py` reuses the throwaway-repo fixture from
  `test_check_migration_contract.py:32-46` (recon.md:94, recon.md:107).

### 6. CI — new PR-only job `migration-order-gate`

- Cloned from `ci.yml:938-954` (the `migration-contract-gate` job, recon.md:53-56). It is a separate job because
  peer 298 edits `migration-contract-gate` (recon.md:151).
- It passes `--forbid-new` unless
  `github.base_ref != 'main' || (github.head_ref == 'main-dev' && github.event.pull_request.head.repo.full_name == github.repository)`.
  The repository check stops a fork branch named `main-dev` from evading the rule.
- Register the job in `needs` at `:1320-1321` and the result echo at `:1351-1352` (recon.md:57). Add the script
  to the migrations path filter at `:88-96` (recon.md:46).
- Rewrite the stale `migration-rerun` comment at `ci.yml:896-897`, which still describes replay from 0 through
  the db-migrate recovery path.
- The gate is CI-only, so the migrator image needs no new `COPY` (recon.md:108).

### 7. Docs — `docs/patterns/database.md` (D-4, D-13)

- `:41` gets the forward-only rule: the next free NNN is taken at merge, `merge-order.md` numbers are advisory,
  and a renumber happens before merge, never after (recon.md:75, recon.md:109).
- `:60-63` and `:83-95` get the ratchet procedure from section 3 and lose the force-0 text. The Floor rule
  bullet at `:85-88` is deleted (recon.md:76-78).
- A new paragraph explains that `force 0` for a 000-based service dirty at 1 is ordinary prev recovery, not the
  removed path.
- A gate bullet after `:78-79` records the verdicts (operator decision O-4):
  - Promotion PRs (`main-dev` → `main`, same repo) pass by construction.
  - Hotfix PRs into `main` carry no migration. A schema fix ships through `main-dev` and a promotion. The cost
    is stated: an urgent production schema fix forces promotion of all unpromoted `main-dev` work.

### 8. Ahead-check — `scripts/migration-ahead-check.sh:55-62` (D-8)

Reword only. It keeps `n-1`, described as "previous version present in the newer release" (recon.md:40).

### 9. Findings — `docs/context-constitution-findings.md` (D-8, D-14)

Four entries: the ahead-check `n-1` gap; the cross-dir contract-header gap; the stale prose at
`migration-rerun.py:7`, `:735` and `:1067-1068`; and the run-order drift at `database.md:32` (recon.md:74,
recon.md:170-173).

### 10. Durable business-rule edits (C-16, operator decision O-3)

`/sdd-spec` plans the edits to `docs/sdd/business-rules/platform.feature` @AC-19 and to the last clause of
@AC-28 in `services/xstockstrat-config/acceptance/fix-config-keys-drift.feature`, with the texts under
"Business Rules Touched". It also pins the feature's own AC-1 `Then` to the refuse branch and adds scenarios
for the gap, first-file and empty-dir cases.

## Rejected Alternatives

- `R-1` Hotfix migration numbering at max(main, main-dev)+1, with collisions fixed by renumbering on main-dev —
  rejected because prod applies the hotfix as soon as it merges to `main`, so the renumber re-applies a
  non-idempotent file and the unpromoted lower main-dev migrations get skipped on prod.
- `R-2` Rejecting auto-recovery on the grounds that a failed up-file is partially applied — rejected because the
  premise is false. No up-file contains COMMIT, BEGIN; or CONCURRENTLY, and golang-migrate runs each file as one
  implicit transaction.
- `R-3` Keeping the contract-floor scan in the guard only to vary the reason clause — rejected as YAGNI. Its
  exit-2 header paths suppress actionable recovery text, and the CI contract gate already validates headers.
- `R-4` Recovery text keyed to the failed operation (failed up → force prev; failed down → force n) — rejected
  because it names the wrong target when a clean-flag write fails and after a failed down.
- `R-5` `--forbid-new` triggered by `startsWith(github.head_ref, 'hotfix/')` — rejected because a mis-named
  branch into `main` bypasses it and lands a main-only migration at or below main-dev's max.
- `R-6` A push-triggered order check against HEAD~1 for the stale-base race — rejected because the only repair
  it could demand is a renumber, which D-3's delete ban forbids.
- `R-7` Judgment-first three-branch recovery text (force prev/n/next as equal options keyed to the operator's
  reading of schema state) — rejected because picking `force <n>` when n had not applied skips the file silently
  and forever, and "objects exist" means nothing for contract or prune files. The ratchet removes that judgment.
- `R-8` Rewriting the legacy `migration-dirty-guard.test.sh` in place — rejected because every case changes,
  which makes it a rewrite of a legacy `.sh` (script-tooling.md:10-11), and it duplicates the pytest harness
  already used for db-migrate.

Two further alternatives were weighed in synthesis and have no register row:

- Folding the order check into `check-migration-contract.py` and its job — not chosen because peer 298 edits
  that job (`ci.yml:938-954`).
- Guard-side DB probing to detect which objects exist — not chosen because the guard has no DB access and
  probing would need SQL parsing, which is out of scope.

## Open Risks

- [ ] Refuse-all stops PRE_DEPLOY, and DO's automated rollback deploy, on any transient dirty state until an
  operator runs `migrate force` (fails.md:3687). Accepted by operator decision O-1 — to be stated in the
  `database.md` step.
- [ ] The ratchet's "already exists" escalation catches only DDL. A non-idempotent DML file that replays
  successfully after `force <prev>` double-applies silently. Only the operator's read of the file guards against
  it — the guard-text step and the `database.md` step must both say so.
- [ ] Two golang-migrate 4.17.1 behaviours are unverified: NilVersion after TRUNCATE, and a loud failure on a
  duplicate version — to be verified in the guard-text step before the TRUNCATE wording is final.
- [ ] The new `migration-order-gate` job and the `ci.yml:841` test-chain edit may collide with peer 298 and
  other batch peers at merge time — to be addressed at the CI step and the integration PR.
- [ ] The modify ban on base `*.up.sql` blocks even comment or typo fixes to merged files. The escape is a new
  numbered file — to be stated in the `database.md` step.
- [ ] Promotion "pass by construction" assumes `main` has no historic main-only migration. This is not verified
  for existing files — to be checked at the ordering-gate step.
- [ ] The forward-only rule conflicts with the NNN pre-assignment in insights.md:900 — to be reconciled in the
  `database.md` step.
- [ ] The stale-base duplicate-NNN race is mitigated only by branch protection "up to date before merge" on
  `main-dev` and `main`, which the operator has not yet set (closed objection O-5) — operator action, outside
  the PR.
- [ ] Objection O-7 (non-blocking) is still open: confirm the pytest case table against D-5 and D-10 as the
  adversary re-derived them — to be addressed at the guard-test step.

## Constitution Rules Touched

- `C-16` — honored by: every affected `@AC-*` is classified below, and both CHANGEs carry operator sign-off O-3
  in context.md.
- `F-01` — honored by: no applied `.up.sql` is edited and no migration is added. The gate's modify and delete
  bans mechanize the rule.
- `C-11` — honored by: the OQ1 design fork went to the operator (O-1) and was not guessed. Recon and three
  adversarial rounds ran before any code.
- `C-15` — honored by: AC-1 is pinned to the refuse branch and AC-2 maps to the ordering-gate tests. The new
  gap, first-file and empty-dir scenarios get `@AC` tags in `/sdd-spec`.
- `C-18` — honored by: the floor scan is deleted, not extended (R-3). One Python script and one job are added.
  The guard tests are ported once, not duplicated (R-8).
- `P-01` — honored by: the orchestrator wrote every artifact, and the three gate decisions are the operator's
  own, recorded in context.md.
- `P-03` — honored by: unverified items (golang-migrate behaviours, historic main-only migrations, branch
  protection) are listed as open risks, not assumed.

Floor breaches: none.

## Business Rules Touched (C-16)

- CHANGE `@AC-19` "Dirty recovery below the contract floor is unchanged"
  (`docs/sdd/business-rules/platform.feature:386-390`) — altered guarantee; signed off by user @ 2026-11-20
  (context.md, operator decision O-3). The guard no longer allows force-0 recovery anywhere. The replacement
  spells out the file set for each example:
  - Up-files 001, 002, 003, 005, 006 and no contract file:
    - `5 (dirty)` exits 3 with Recover `force 3` (gap → previous existing version).
    - `1 (dirty)` exits 3 naming `TRUNCATE public.x_schema_migrations` (first file).
    - `4 (dirty)` exits 2 naming "cannot compute recovery".
  - An empty dir with `5 (dirty)` exits 2 naming "cannot compute recovery".
  - Up-files 019, 020, 026, 027, where 027 declares contract-of 026: `20 (dirty)` exits 3 with Recover
    `force 19`.
- CHANGE `@AC-28` "Replaying the heal after a later key was created never deletes that key"
  (`services/xstockstrat-config/acceptance/fix-config-keys-drift.feature:102-109`) — last clause only; signed
  off by user @ 2026-11-20 (context.md, operator decision O-3). The clause becomes: "the dirty guard refuses a
  dirty 041 with exit 3 naming force 40, leaving row counts and audit functions unchanged, after which migrate
  force 40 and up converge". The first two clauses are preserved.
- EXTEND `@AC-27` "Zero-padded migration versions compare as decimal numbers" — new case added: the ordering
  gate and the guard's prev/next computation compare NNN as `10#` decimals.
- PRESERVE `@AC-18` "db-migrate refuses the force-0 replay for a dirty contract service"
  (`docs/sdd/business-rules/platform.feature`) — not regressed by: refusal-only everywhere. analysis has 025, so
  dirty 26 still prints `force 25`.
- PRESERVE `@AC-25` "An older migrator refuses a schema a newer release left dirty"
  (`docs/sdd/business-rules/platform.feature`) — not regressed by: the ahead-check is reworded only. It keeps
  exit 1, `n-1`, the literal `$DATABASE_URL` and no `postgres://`.
- PRESERVE `@AC-12` "Contract up-files are replay-safe" (`docs/sdd/business-rules/platform.feature`) — not
  regressed by: `migration-rerun` pass 2 is untouched, and the strings it asserts ("is dirty at version N",
  "force M") are kept.
- PRESERVE `@AC-30` "The migrator image carries every script db-migrate.sh calls"
  (`docs/sdd/business-rules/platform.feature`) — not regressed by: `db-migrate.sh` calls no new script. The
  ordering gate is CI-only.

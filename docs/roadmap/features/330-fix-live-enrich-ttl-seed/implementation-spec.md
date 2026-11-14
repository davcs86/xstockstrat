# Implementation Spec: fix-live-enrich-ttl-seed

**Status**: `pending`
**Created**: 2026-11-13
**Feature**: `docs/roadmap/features/330-fix-live-enrich-ttl-seed/feature.md`
**Total Steps**: 5
**Feature Branch**: `feature/fix-live-enrich-ttl-seed`
**Severity**: SEV-3

---

## Execution Summary

The fix is one guarded config data migration that moves the stored live-enrich memo TTL from the seeded
`'10'` to `'20'`, above the 15s `ListOpportunities` UI poll (design.md § Chosen Approach). Migration `028`
is not touched (F-01). Nothing changes in proto, analysis code or UI code.

Order: the static migration test (Step 1, RED) and the migration with its regenerated
`scripts/config-wiring-stored.json` (Step 2) land as one unit. Then come the analysis `@AC-2` memo test
(Step 3), the doc sync (Step 4), and the operator-run post-deploy read-back (Step 5).

**Evidence tree.** Line numbers are from `origin/main-dev` @ `52f6d5a6`. The feature branch
(`origin/feature/fix-live-enrich-ttl-seed` @ `4ba5bf61`) is 41 commits behind it and lacks `048` and the
current `scripts/config-wiring-stored.json`, so the precondition in § Step Dependencies applies. Recon and
design cited an older tree, so these lines moved:

- the reader is `servicer.py:4827` (recon: `:4819`);
- `services/xstockstrat-analysis/CLAUDE.md:625` (design: `:610`);
- `docs/patterns/config-governance.md:329-330,439,490` (design: `:422,473`).

**Evidence-tree refresh (impl-spec review, 2026-11-13).** `origin/main-dev` has since moved to `5c4cc935`
(#1539, a docs-only context refresh), and the branch is now 42 commits behind. Re-verified on `5c4cc935`:

- `servicer.py:4827`, `config-governance.md:127-150,329-330,439,490` and the trunk migration tail (`048`) are
  unchanged.
- `services/xstockstrat-analysis/CLAUDE.md` moved `:625` → `:281`.
- `docs/context-constitution-findings.md` moved `:42` → `:49`.

Step 4 cites the `5c4cc935` lines. After the precondition merge, re-grep every Step 4 anchor before editing.

**Migration number: `050`, not design's `049`.** D-13's own procedure re-checks the number at spec, and
`git log --all` now finds `049_notify_commsgun_channel_keys.{up,down}.sql`. Feature 338 holds it on unmerged
branch `origin/ccr-2d98935d-na9x6j` (commit `a10a086d`). `origin/main-dev` tops out at `048`. No other remote
branch holds `049`–`059`. The file content is number-free, so a renumber at merge is still only a rename plus
a regeneration (D-13, D-15).

**Consumer surface (C-14).** The fix is internal and platform-only. The corrected value reaches the analysis
reader over the existing `WatchConfig` stream. The `/trader` opportunities list keeps its 15s poll
(`services/xstockstrat-ui/src/hooks/useOpportunities.ts:49`), and its warm re-polls hit the memo again with
no UI step (design.md § Chosen Approach, "Consumer surface").

## Scenario Coverage (C-15)

| Scenario | Covered by |
|---|---|
| `@AC-1` (staging, production) | Step 1: static migration test, fresh-DB literal `'20'`, RED today. Step 5: post-deploy read-back per environment. |
| `@AC-2` | Step 3: analysis memo test at the migrated TTL, with a negative control at the old seed `10`. |

`@AC-1` carries the operator's C-16 sign-off of 2026-11-13. The literal `"20"` holds where the global row
still holds the seeded `'10'`, which is always true on a fresh DB. A row with an operator value keeps it and
must be > 15 at deploy (design.md § Business Rules Touched). The amended Given and the `@FR` tags are still
outstanding; see § Step Dependencies.

## Step Dependencies

- **Precondition before Step 1.** Merge `origin/main-dev` into `feature/fix-live-enrich-ttl-seed`, so the tree
  holds `048_webhook_fanout_callback_keys` and the matching `scripts/config-wiring-stored.json`. The tree must
  also hold the moved lines cited above. Do this before writing any file: Step 2's regenerated JSON must hash
  the full trunk migration set.
- **Steps 1 + 2 land together** (`step-constraints.md` §C, "adds a test that references a symbol a later
  step creates"). Step 1's suite resolves the migration with `findOne('_analysis_live_enrich_ttl_reseed', …)`
  (`services/xstockstrat-config/src/__tests__/migrationSql.ts:8-16`). It cannot pass its own Verification
  until Step 2's files exist.
  - Capture RED with Step 1 written and Step 2 absent. The failure is the `findOne` assertion
    `expected exactly one *_analysis_live_enrich_ttl_reseed.up.sql, got []`, which is the missing fix, not a
    compile error: `findOne` exists today.
  - Commit both steps as one commit. Both are on the backend consumer surface.
- **Step 2 needs a reachable Postgres plus `psql` and `migrate` on `PATH`** to generate
  `scripts/config-wiring-stored.json` (`scripts/config-wiring-stored.py:4-5`, `scripts/scratch_db.py:3`). This
  is artifact generation, not verification. CI builds the same toolchain from `scripts/Dockerfile.migrate`
  (`.github/workflows/ci.yml:1275-1282`).
  - Local route, the same as CI: run `docker build -f scripts/Dockerfile.migrate -t xstockstrat-migrate-ci .`,
    then `docker run --rm --network host -e DATABASE_URL=… -v "$PWD:/repo" -w /repo --entrypoint python3
    xstockstrat-migrate-ci scripts/config-wiring-stored.py` against a scratch `timescale/timescaledb:latest-pg16`
    (`.github/workflows/ci.yml` job `config-wiring-stored`).
  - If no local Docker or Postgres is available, there is a fallback. That CI job uploads the regenerated
    file as artifact `config-wiring-stored`, with `if: always()`, even when its freshness diff fails. That
    artifact is generator output, so committing it unedited satisfies R-12. Record the run URL in `context.md`.
  - If neither route works, Step 2 is blocked (P-03). The JSON is never written by hand (R-12).
- **Step 3 needs nothing earlier.** It exercises unchanged analysis code through the canonical
  `snapshot_watcher` (`services/xstockstrat-analysis/tests/conftest.py:62`). It comes after Steps 1 + 2 only
  so the PR reads fix-first.
- **Step 4 requires Step 2.** The docs describe the migration and its sentinel. They name the migration by
  its number-free suffix, so a renumber does not touch them.
- **Step 5 requires the integration PR merged and deployed.** It runs on the dev database after the
  `main-dev` deploy, and on the production database after promotion. It is operator-run (`@AC-1`
  post-deploy half; design D-6/D-12).
- **Merge checklist (D-13; fails.md 2026-10-14 and 2026-11-10; insights.md 2026-11-05).** Run this before
  the integration PR merges, and again after every `origin/main-dev` merge into the branch.
  1. Run `git fetch origin`.
  2. Run `git log --all --oneline -- 'services/xstockstrat-config/migrations/050*' 'services/xstockstrat-config/migrations/051*'`.
  3. Scan the config-migration tail of every `origin/feature/*`, `origin/ccr-*` and `origin/claude/*` branch.
     Watch for 338 (`049`), 321 and 322 especially.
  4. The final number must equal max(`origin/main-dev` config migrations) + 1. golang-migrate never applies
     a version below the applied maximum, so a lower number is silently skipped.
  5. On a renumber:
     - rename both files;
     - `grep -rn` the old number in the files this feature changed (the content and docs are number-free,
       so expect no hits);
     - regenerate `scripts/config-wiring-stored.json` with the Step 2 command;
     - re-run Step 2's Verification.
  6. Even without a renumber, regenerate `scripts/config-wiring-stored.json` after any `origin/main-dev` merge
     that brings in another config migration. `inputs_sha256` hashes every config migration
     (`scripts/check-config-wiring.mjs:224-230`, `storedInputsSha256`), and CI fails on a stale copy
     (`.github/workflows/ci.yml` job `config-wiring-stored`, step "Committed stored set is fresh"). In-flight
     config migrations: 338 (`049`), 321 and 322 (seed migrations, unnumbered), and 334 (`048`, already on trunk).
     Whichever of these merges after 330 regenerates the file again, and vice versa.
  - Re-verified at impl-spec review (2026-11-13, trunk `5c4cc935`): the trunk tail is `048`.
    `git log --all -- 'services/xstockstrat-config/migrations/048*' '…/049*' '…/05*'` finds only `9d45f208`
    (`048`, on trunk) and `a10a086d` (`049`, feature 338). `050` is still free. The number stays provisional
    until merge: golang-migrate silently skips a version below the applied maximum.
- **Key-overlap re-scan (design open risk).** After every `origin/main-dev` merge, run
  `git grep -l live_enrich_ttl_seconds <ref> -- services/xstockstrat-config/migrations scripts/migration-assertions`
  over the remote refs.
  - At spec time no branch touched the key outside `028`/`041`.
  - Feature 322 defers the row to 330 (`docs/roadmap/features/322-fix-retired-surface-proto-cleanup/product-spec.md:129`).
- **Transaction and notify timing (design open risk, resolved at spec).**
  - Each file is one top-level statement, so the change is atomic whatever the driver does.
  - `scripts/db-migrate.sh:104` runs plain `migrate -path … -database … up` with no `x-multi-statement`
    parameter.
  - PostgreSQL queues a `pg_notify` and delivers it when the enclosing transaction commits. `WatchConfig`
    subscribers therefore see the new value only once the migration has committed.
  - The `db-migrator` connects direct (`:25060`, root `CLAUDE.md` § Connection Pool Budget), so NOTIFY is not
    lost to PgBouncer transaction pooling (`docs/patterns/database.md:133`).
  - Re-check trigger: feature 318 (`fix-migration-tooling-safety`) changes the `up` branch of
    `scripts/db-migrate.sh` (its `product-spec.md` cites `:66-81`), and it may add a CI NNN-ordering gate. If 318
    merges first, re-read the `up` path. Confirm it still runs plain `migrate … up`, with no `x-multi-statement`
    and no wrapper that splits or re-runs files. Also confirm that the `050` number passes any new ordering gate.
- **Stale-sentinel assumption (design open risk).** The down reverts a row only while `updated_by` still
  holds `system:config-migration-feature-330`. This is sound because the only runtime writer,
  `SetConfig`, rewrites `updated_by` on every upsert
  (`services/xstockstrat-config/src/grpc/configServiceImpl.ts:828-839`, `updated_by = EXCLUDED.updated_by`).
  A future writer that changes `value_data` without `updated_by` would break the assumption. None exists
  today.
- **Story-owner action still outstanding (design open risk; C-15).** `acceptance.feature` still lacks
  `@FR-1`/`@FR-2` and the amended `@AC-1` Given ("…and the row still holds the seeded '10'").
  - This spec does not edit `acceptance.feature`, which is a story-owner artifact.
  - The narrowed reading is the operator-signed C-16 change recorded in `design.md` and `context.md`.
  - `/sdd-review fix-live-enrich-ttl-seed impl-spec` (2026-11-13) flagged it as still open (C-15 WARN). It is
    carried as a `context.md` Open Thread.
  - **Gate before the integration PR opens.** C-16 promotes from the branch-tip `acceptance.feature`, so an
    unamended file would promote the stale "is '20'" Then for every environment. Each of these must print a
    match first:
    - `grep -n "@AC-1 @FR-1" docs/roadmap/features/330-fix-live-enrich-ttl-seed/acceptance.feature`
    - `grep -n "@AC-2 @FR-2" docs/roadmap/features/330-fix-live-enrich-ttl-seed/acceptance.feature`
    - `grep -n "still holds the seeded" docs/roadmap/features/330-fix-live-enrich-ttl-seed/acceptance.feature`

    If any check prints nothing, stop and ask the story owner (P-03).
- **C-16 promotion happens at the integration PR, not in a step.**
  - `@AC-1` goes to `services/xstockstrat-config/acceptance/`.
  - `@AC-2` goes to `services/xstockstrat-analysis/acceptance/opportunities-latency-fix.feature` as the
    EXTEND of `@AC-9` (recon.md § Existing Business Rules).
  - Both are promoted from the branch-tip `acceptance.feature`.

---

### Step 1 — test: Static migration test for the guarded TTL reseed (RED)

**Status**: `done`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/__tests__/liveEnrichTtlReseedMigration.test.ts` — create

**Reviewers**: xstockstrat-config owner — config key naming, environment (`production`/`staging`) / global-per-user scoping, WatchConfig stream stability

**Codebase Evidence**:
- Helper: `services/xstockstrat-config/src/__tests__/migrationSql.ts:6` (`MIGRATIONS_DIR`), `:8-16` (`findOne(suffix, 'up'|'down')`, which asserts exactly one match), `:19-53` (`splitStatements`, a quote-aware split that drops `--` comments and collapses whitespace outside literals).
- Closest precedent: `src/__tests__/zeroTrapDescriptionMigration.test.ts:1-75`.
  - It parses each statement with a `LIT = "'((?:[^']|'')*)'"` regex.
  - It reads the old text from the 027 and 028 source files (`SOURCE_FILES`, `:12-15`) rather than a copied literal (`:57-65`).
  - It asserts that the down inverts the up (`:67-74`).
- Old description source (D-11): `services/xstockstrat-config/migrations/028_analysis_opportunity_keys.up.sql:111-116`.
  - The rows have the shape `('analysis', 'analysis.opportunity.live_enrich_ttl_seconds', 'int', '10', '<description>', '10', 'xstockstrat-analysis', '<env>', NULL)`, for staging (`:111-113`) and production (`:114-116`).
  - `findOne('_analysis_opportunity_keys', 'up')` resolves exactly one file. `ls migrations | grep -c _analysis_opportunity_keys.up.sql` gives `1`.
- Test glob and compile: `services/xstockstrat-config/package.json:12` (`"test": "tsc && node --test dist/__tests__/*.test.js"`), `:13` (`test:coverage`). `tsconfig.json` `include: ["src/**/*"]` compiles the tests.
- C-13: the only data is the migration text. `src/__tests__/globalIntSeedCases.ts:16-20` models only the two-row `INSERT … ON CONFLICT DO NOTHING` seed shape, so it does not fit an UPDATE. No domain literal gets a second consumer. The inline regexes are single-consumer and compliant.
- Latent hazard (fails.md 2026-11-10, "copied test helper's parsing"): `src/__tests__/retiredPortfolioSnapshotInterval.test.ts:32` splits every up migration on a bare `;`. The new migration's literals must contain no `;`, and this suite asserts that.

**Lands with**: `Step 2`

**TDD**: `red-green required`

**Covers**: `AC-1`

**Instructions**:
Create `liveEnrichTtlReseedMigration.test.ts` with a header JSDoc that names `@AC-1 (feature 330)`. Use
`describe`/`it` from `node:test`, `assert` from `node:assert/strict`, and `findOne`/`splitStatements` from
`./migrationSql`.

Constants:

- `SUFFIX = '_analysis_live_enrich_ttl_reseed'`
- `SENTINEL = 'system:config-migration-feature-330'`
- `KEY = 'opportunity.live_enrich_ttl_seconds'`
- `UI_POLL_SECONDS = 15` — the `@AC-1` Then literal

Load the statements:

- `const up = splitStatements(findOne(SUFFIX, 'up'))`
- `const down = splitStatements(findOne(SUFFIX, 'down'))`

Read the old description from 028:

1. Load `findOne('_analysis_opportunity_keys', 'up')`.
2. Match with ``new RegExp(`'analysis\\.opportunity\\.live_enrich_ttl_seconds', 'int', '10', ${LIT}`, 'g')``.
3. Assert two matches (staging and production) with an identical captured text, and call it `OLD`.
4. Also assert that both 028 rows seed `'10'`. That is the `@AC-1` Given.

Cases. Each `it` title names `@AC-1`.

1. **Shape.** `up.length === 1` and `down.length === 1`. Each statement starts with `WITH u AS ( UPDATE config.config_values v SET`. Neither contains `INSERT`, `DELETE`, `default_value` (D-2, CONFIG-2) or `SET key`.
2. **Relative key and scope (C-05, D-1).**
   - Both statements contain `v.namespace = 'analysis'`, `` `v.key = '${KEY}'` ``, `v.user_id IS NULL` and `v.environment IN ('staging', 'production')`.
   - Neither contains `'analysis.opportunity.live_enrich_ttl_seconds'`.
3. **Up value CASE and AC-1 literal.**
   - The up contains `value_data = CASE WHEN v.value_data = '10' THEN '20' ELSE v.value_data END`.
   - `Number('20') > UI_POLL_SECONDS`.
4. **Up description CASE (D-3).**
   - Capture `NEW` from ``description = CASE WHEN v.description = '${OLD}' THEN ${LIT} ELSE v.description END``.
   - Assert that `NEW !== OLD`.
   - Assert that `NEW` contains no `;` and no `sparkline`.
   - Assert that the WHERE contains ``(v.value_data = '10' OR v.description = '${OLD}')``.
5. **Up actor columns on the value branch only (D-9).**
   - The up contains `` `updated_by = CASE WHEN v.value_data = '10' THEN '${SENTINEL}' ELSE v.updated_by END` ``.
   - The up contains `caller_identity = CASE WHEN v.value_data = '10' THEN NULL ELSE v.caller_identity END`.
   - The up matches ``/update_reason = CASE WHEN v\.value_data = '10' THEN '[^';]+' ELSE v\.update_reason END/``.
   - The up has no unguarded `updated_by =`, `update_reason =` or `caller_identity =` assignment. Every occurrence of `updated_by = `, `update_reason = ` and `caller_identity = ` in the SET clause is immediately followed by `CASE WHEN`.
6. **Notify fires (D-10, D-14, CONFIG-4).** For both up and down, assert all of:
   - the text contains `` nt AS ( SELECT pg_notify('config_changed', json_build_object('namespace', t.namespace, 'key', t.key, 'environment', t.environment, 'user_id', NULL)::text) ``;
   - the text contains `FROM (SELECT DISTINCT namespace, key, environment FROM u) t`;
   - the text ends with `SELECT (SELECT count(*) FROM u) AS updated, (SELECT count(*) FROM nt) AS notified`.
7. **Down mirrors up (D-5).**
   - The down contains `` `value_data = CASE WHEN v.value_data = '20' AND v.updated_by = '${SENTINEL}' THEN '10' ELSE v.value_data END` ``.
   - The down contains ``description = CASE WHEN v.description = '${NEW}' THEN '${OLD}' ELSE v.description END``, which uses the up's `NEW` and the 028 `OLD`.
   - The down's WHERE contains `` `((v.value_data = '20' AND v.updated_by = '${SENTINEL}') OR v.description = '${NEW}')` ``.
   - The down's `updated_by`, `update_reason` and `caller_identity` assignments are each `CASE WHEN v.value_data = '20' AND v.updated_by = '${SENTINEL}' THEN … ELSE v.<col> END`.
8. **No `;` in any literal.** Neither file's raw text, with `--` comment lines removed, contains `;` other than the single statement terminator. This keeps `retiredPortfolioSnapshotInterval.test.ts:32`'s naive split safe.

The full literal text the assertions pin is given in Step 2's Instructions. Assert the fragments exactly as
they appear there after `splitStatements` whitespace collapse.

**Verification**:
```bash
cd services/xstockstrat-config && pnpm run build && node --test dist/__tests__/liveEnrichTtlReseedMigration.test.js
# RED before Step 2: fails on findOne "expected exactly one *_analysis_live_enrich_ttl_reseed.up.sql, got []"
# GREEN after Step 2 (unit verification, see Step 2)
pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40   # GREEN only; config's ≥40% line threshold (package.json:13)
```

---

### Step 2 — migration: `050_analysis_live_enrich_ttl_reseed` up/down + regenerated stored set

**Status**: `done`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/migrations/050_analysis_live_enrich_ttl_reseed.up.sql` — create
- `services/xstockstrat-config/migrations/050_analysis_live_enrich_ttl_reseed.down.sql` — create
- `scripts/config-wiring-stored.json` — modify (generated by `scripts/config-wiring-stored.py`; never hand-edited)

**Reviewers**: DBA — migration NNN numbering (no gaps, no conflicts), up+down pair present, run-order compliance with `scripts/db-migrate.sh`; xstockstrat-config owner — config key naming, environment / global-per-user scoping, WatchConfig stream stability

**Codebase Evidence**:
- **Migration number.**
  - Last trunk config migration: `git ls-tree --name-only origin/main-dev services/xstockstrat-config/migrations/ | tail -2` gives `049_notify_commsgun_channel_keys.{down,up}.sql` (feature 338, merged to `origin/main-dev` @ `d5de836b`, #1537).
  - `git log --all -- 'services/xstockstrat-config/migrations/05*'` finds nothing, so no ref holds `050`–`059`. Next free: `050` = max(trunk) + 1 (C-07; see the merge checklist).
  - The merged tree's `scripts/config-wiring-stored.json` already holds the `049` commsgun rows.
- **Target rows (C-05).**
  - 028 seeded them prefixed: `028_analysis_opportunity_keys.up.sql:111,114`.
  - 044 rewrote stored keys relative (`044_config_keys_relative.up.sql:216`, recon.md).
  - 045 enforces the form with CHECK `config_values_key_relative_check` (`045_config_keys_relative_check.up.sql:128-129`).
  - The reader is `services/xstockstrat-analysis/app/handlers/servicer.py:4827`, `self._cfg.get_int_present("opportunity.live_enrich_ttl_seconds", 20)`, in `_enrich_opportunities_live` (`:4810`). It is read once per pass, from `ListOpportunities` (`:4729`).
- **Key contract (C-05).** All of the following are unchanged; only the stored value and description move:
  - namespace `analysis`;
  - stored key `opportunity.live_enrich_ttl_seconds`;
  - `value_type` `int`;
  - code default `20`;
  - reader as cited above;
  - seed migration `028`, with `041` syncing `default_value` to `20` (`041_heal_config_keys_to_reader_catalog.up.sql:79`, `:505-516` "value_data unchanged");
  - live mechanism: the `WatchConfig` snapshot, read per request.
- **Guarded global-row scope shape (reuse, recon.md § Patterns to REUSE):** `043_analysis_live_loop_keys.up.sql:27-35`, with `WHERE namespace = 'analysis' AND key = … AND user_id IS NULL AND environment IN ('staging', 'production') AND (guard)`.
- **Verbatim old-description guard (reuse):** `032_analysis_zero_trap_descriptions.up.sql:5-9`.
- **Notify CTE forced by the final SELECT (reuse):** `047_config_alias_removal_rows.up.sql:57-61`. Its payload is the two-field `{namespace, environment}`. D-14 widens it to the four-field CONFIG-4 shape `{namespace, key, environment, user_id}`, which `SetConfig` already sends (`src/grpc/configServiceImpl.ts:841-842`). The LISTEN handler reads `namespace`/`environment` (`:417-424`).
- **Audit trigger** (current definition `017_config_secrets_and_scoping.up.sql:66-79`): it writes `config.config_audit` only `IF OLD.value_data IS DISTINCT FROM NEW.value_data`, attributing it to `NEW.updated_by`/`NEW.update_reason`/`NEW.caller_identity`. Columns: `updated_by`/`update_reason` (`001_config_tables.up.sql:16-17`) and `caller_identity` (`014_config_caller_identity.up.sql:9`).
- **Sentinel-and-value down guard precedent:** `048_webhook_fanout_callback_keys.down.sql:4-13` and `043_analysis_live_loop_keys.down.sql:7-13`.
- **Stored set.**
  - `scripts/config-wiring-stored.json:939-962` holds both rows of this key with the 028 description and `"file": "028_analysis_opportunity_keys.up.sql"`; `inputs_sha256` is at `:5020`. `file` is the first migration that saw the row (`scripts/config-wiring-stored.py:24-29`), so it stays 028 and only `description` and `inputs_sha256` change.
  - `scripts/check-config-wiring.mjs:226-231` (`storedInputsSha256` over every config migration) and `:715-716` (`STALE-STORED`).
  - CI regenerates and diffs it (`.github/workflows/ci.yml:1275-1293`).
- **Key-overlap re-scan (post-merge, `d5de836b`):** `git log --all -S live_enrich_ttl_seconds -- services/xstockstrat-config/migrations scripts/migration-assertions` touches only `028` and `041`.
- **Repo tree vs live data:** the fresh DB holds `'10'` on both global rows (`scripts/config-heal/inventory-fresh.jsonl:9-10`). The staging DB global row held the operator value `600` on 2026-11-07 (`scripts/config-heal/report-staging-041.jsonl:9`).
- **`migration-assertions`:** no file names this key (`grep -rn live_enrich_ttl scripts/migration-assertions` → none), so `migration-rerun.py`'s final sweep is unaffected. No assertion file is added; the operator declined P-3/P-4.

**Lands with**: `Step 1`

**TDD**: `N/A (migration)` — the unit's red→green is Step 1.

**Covers**: —

**Instructions**:
1. Create `050_analysis_live_enrich_ttl_reseed.up.sql` with exactly this content. The comment header is
   two lines. The literals contain no `;`. Below, `<OLD>` is the 028 description, copied byte for byte from
   `028_analysis_opportunity_keys.up.sql:112`: `Short TTL for the success-only per-symbol live-quote/sparkline memo (feature 177). Read via get_int_present (0 = memo disabled -> always fetch). Seeded unbounded.`
   ```sql
   -- Migration: analysis_live_enrich_ttl_reseed (up). Service: xstockstrat-config, feature 330 (fix-live-enrich-ttl-seed).
   -- Only the seeded '10' moves to '20' (operator values survive); actor columns change only with the value. The final SELECT forces the notify CTE.

   WITH u AS (
     UPDATE config.config_values v
     SET value_data = CASE WHEN v.value_data = '10' THEN '20' ELSE v.value_data END,
         description = CASE WHEN v.description = '<OLD>'
           THEN 'Short TTL (seconds) for the success-only per-symbol live-quote memo (feature 177). Keep it above the 15s ListOpportunities UI poll so a warm re-poll is served from the memo. Read via get_int_present (0 = memo disabled -> always fetch). Seeded unbounded.'
           ELSE v.description END,
         updated_by = CASE WHEN v.value_data = '10' THEN 'system:config-migration-feature-330' ELSE v.updated_by END,
         update_reason = CASE WHEN v.value_data = '10' THEN 'feature 330: reseed the 028 live-enrich memo TTL 10 -> 20, above the 15s UI poll' ELSE v.update_reason END,
         caller_identity = CASE WHEN v.value_data = '10' THEN NULL ELSE v.caller_identity END
     WHERE v.namespace = 'analysis'
       AND v.key = 'opportunity.live_enrich_ttl_seconds'
       AND v.user_id IS NULL
       AND v.environment IN ('staging', 'production')
       AND (v.value_data = '10' OR v.description = '<OLD>')
     RETURNING v.namespace, v.key, v.environment
   ), nt AS (
     SELECT pg_notify('config_changed', json_build_object('namespace', t.namespace, 'key', t.key, 'environment', t.environment, 'user_id', NULL)::text) AS sent
     FROM (SELECT DISTINCT namespace, key, environment FROM u) t
   )
   SELECT (SELECT count(*) FROM u) AS updated, (SELECT count(*) FROM nt) AS notified;
   ```
   - Every CASE in `SET` reads the pre-update row, so the value guard and the actor guards agree.
   - A replay matches no row: no `'10'` remains and no description equals `<OLD>`. It writes no audit row
     (`@AC-26`, `@AC-28`).
2. Create `050_analysis_live_enrich_ttl_reseed.down.sql`, the mirror. Let `<NEW>` be the up's new description,
   byte for byte.
   ```sql
   -- Migration: analysis_live_enrich_ttl_reseed (down). Service: xstockstrat-config, feature 330 (fix-live-enrich-ttl-seed).
   -- Reverts the value only on rows still carrying the 330 sentinel at '20'; SetConfig rewrites updated_by, so operator writes are never reverted.

   WITH u AS (
     UPDATE config.config_values v
     SET value_data = CASE WHEN v.value_data = '20' AND v.updated_by = 'system:config-migration-feature-330' THEN '10' ELSE v.value_data END,
         description = CASE WHEN v.description = '<NEW>' THEN '<OLD>' ELSE v.description END,
         updated_by = CASE WHEN v.value_data = '20' AND v.updated_by = 'system:config-migration-feature-330' THEN 'system:config-migration-feature-330' ELSE v.updated_by END,
         update_reason = CASE WHEN v.value_data = '20' AND v.updated_by = 'system:config-migration-feature-330' THEN 'feature 330 down: restore the 028 seed 10' ELSE v.update_reason END,
         caller_identity = CASE WHEN v.value_data = '20' AND v.updated_by = 'system:config-migration-feature-330' THEN NULL ELSE v.caller_identity END
     WHERE v.namespace = 'analysis'
       AND v.key = 'opportunity.live_enrich_ttl_seconds'
       AND v.user_id IS NULL
       AND v.environment IN ('staging', 'production')
       AND ((v.value_data = '20' AND v.updated_by = 'system:config-migration-feature-330') OR v.description = '<NEW>')
     RETURNING v.namespace, v.key, v.environment
   ), nt AS (
     SELECT pg_notify('config_changed', json_build_object('namespace', t.namespace, 'key', t.key, 'environment', t.environment, 'user_id', NULL)::text) AS sent
     FROM (SELECT DISTINCT namespace, key, environment FROM u) t
   )
   SELECT (SELECT count(*) FROM u) AS updated, (SELECT count(*) FROM nt) AS notified;
   ```
3. The tree already holds `origin/main-dev` @ `d5de836b` (merged at execute setup, 2026-11-13), including `049`;
   re-merge only if trunk has moved since (§ Step Dependencies). Then regenerate the stored set and commit the result
   unedited:
   ```bash
   DATABASE_URL=<scratch postgres> python3 scripts/config-wiring-stored.py
   ```
   Expected diff: `inputs_sha256`, plus the `description` of the two `analysis` /
   `opportunity.live_enrich_ttl_seconds` rows, which change to `<NEW>`. Any other changed row means the tree
   is not synced with trunk. Stop and re-sync.
4. Do not add a `scripts/config-wiring.json` entry. The key is already seeded and read under the same string
   (fails.md 2026-11-10, "config-wiring.json is a shrink-only baseline of findings"). Do not edit
   `scripts/config-heal/catalog.tsv` (D-8, R-5).

**Verification** (offline; the unit's union with Step 1):
```bash
ls services/xstockstrat-config/migrations/050_*.up.sql services/xstockstrat-config/migrations/050_*.down.sql
ls services/xstockstrat-config/migrations/ | tail -4   # 050 is the highest; on a renumber, 050 → max(origin/main-dev)+1
# by inspection: the down reverts exactly the up's value branch (sentinel AND '20') and its description branch
cd services/xstockstrat-config && pnpm run build && node --test dist/__tests__/liveEnrichTtlReseedMigration.test.js
pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40
pnpm run lint
cd ../.. && node scripts/check-config-wiring.mjs --keys analysis.opportunity.live_enrich_ttl_seconds   # silent, exit 0
node scripts/check-config-wiring.mjs --final      # exit 0: no STALE-STORED, no STALE
node --test scripts/config-wiring.test.mjs
```

---

### Step 3 — test: Analysis `@AC-2` warm 15s re-poll is served from the memo at the migrated TTL

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_live_enrich_memo.py` — modify (append one parametrized test)

**Reviewers**: xstockstrat-analysis owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Code under test (unchanged): `services/xstockstrat-analysis/app/handlers/servicer.py`.
  - `:4827` reads the TTL.
  - `:4847-4854` partitions symbols into memo hits and fetches when `ttl > 0` and `time.monotonic() < cached[0]`.
  - `:4862-4868` makes one `BatchGetLatestPrice` per pass for `needs_fetch`.
  - `:4883-4889` memoizes successes until `time.monotonic() + ttl`.
- Existing pattern in the same file, `tests/test_live_enrich_memo.py:44-66`:
  - a controllable `time.monotonic` monkeypatch on `app.handlers.servicer.time.monotonic`;
  - `_md_svc()` (`:27-41`) with a `BatchGetLatestPrice` `AsyncMock`;
  - `await svc._enrich_opportunities_live([opp], [])`;
  - assertions on `BatchGetLatestPrice.await_count`.
  - The module sets `pytestmark = pytest.mark.asyncio` (`:24`).
- Canonical config double (C-13 home): `tests/conftest.py:62` `snapshot_watcher(namespace="analysis", **values)`. It is dial-free, rejects a prefixed key, and stores an `int` as `int_val`. It is imported as `from tests.conftest import snapshot_watcher` (e.g. `tests/test_live_loop.py:23`).
  - `ConfigWatcher.get_int_present = WatchCore.get_int` (`app/config/watcher.py:66`).
  - `get_int` reads `int_val` (`app/config/watch_core.py:217-218`).
  - The test therefore exercises the real typed read of the stored row's `value_type` `int`.
- The UI poll is `services/xstockstrat-ui/src/hooks/useOpportunities.ts:49` `refetchInterval: 15_000`.
- The existing `@AC-9` test checks only the code default (`tests/test_opportunities_latency.py:237-243`). That gap is the one recon names.
- C-13 verdict: `snapshot_watcher` comes from the canonical home. The marketdata stub reuses `_md_svc`, which is single-consumer in this file (module docstring `:8-9`). No new domain literal.
- **Seed-to-reader link (trade-off, impl-spec review).** This test passes `20` and `10` as literals. It does not read them from the `*_analysis_live_enrich_ttl_reseed` migration. The seed↔reader contract is covered in two halves:
  - Step 1 pins the migration's literal `'20'` and its `> 15` relation.
  - This step pins the reader's memo behaviour at that value, through the real typed `get_int` path.

  No single automated test joins the two halves. Step 5's read-back of the live row is the end-to-end check. Reading the literal from the config migration was rejected for two reasons. It would make an analysis-service test depend on `services/xstockstrat-config/migrations/`, and that migration's number stays provisional until merge. If the Step 2 literal ever changes, update the `(20, 1)` case in the same commit.

**TDD**: `red-green required` — under the tdd-gate's characterization escape, "red N/A — no behavior change; characterization test added". The analysis code does not change, so there is nothing to turn RED. The defect's RED is Step 1 (D-7). The negative-control case proves the assertion can fail: at the old seed `10` the same 15s re-poll does refetch. Record both in the PR body and `context.md`.

**Covers**: `AC-2`

**Instructions**:
1. Append to `tests/test_live_enrich_memo.py` one test, parametrized over two cases:

   ```python
   @pytest.mark.parametrize(
       ("stored_ttl", "expected_calls"),
       [(20, 1), (10, 2)],
   )
   async def test_warm_15s_repoll_served_from_memo_at_migrated_ttl(stored_ttl, expected_calls, monkeypatch)
   ```

   - The `(20, 1)` case is the migrated value: a memo hit.
   - The `(10, 2)` case is the negative control at the old 028 seed: the memo has expired.
2. Steps inside the test:
   1. Monkeypatch `app.handlers.servicer.time.monotonic` to a list-backed clock starting at `1000.0`.
   2. Set `svc = _md_svc()`.
   3. Set `svc._cfg = snapshot_watcher(**{"opportunity.live_enrich_ttl_seconds": stored_ttl})`.
   4. Enrich `analysis_pb2.Opportunity(symbol="CAPR")` once.
   5. Set the clock to `1015.0`, the UI's 15s re-poll.
   6. Enrich a fresh `Opportunity(symbol="CAPR")`.
   7. Assert `svc._marketdata.BatchGetLatestPrice.await_count == expected_calls`.
   8. In the memo-hit case, also assert that the second opportunity's `live_price` equals the first's.
3. Give the test a one-line docstring naming `@AC-2` (feature 330).
4. Import `snapshot_watcher` with `from tests.conftest import snapshot_watcher`, as the sibling tests do.
5. Do not touch the existing tests.

**Verification**:
```bash
cd services/xstockstrat-analysis && uv run pytest tests/test_live_enrich_memo.py -q
# both parametrized cases pass; the (10, 2) negative control confirms the assertion discriminates
uv run pytest --cov=app --cov-fail-under=40
ruff check . && ruff format --check .
grep -n "from tests.conftest import snapshot_watcher" tests/test_live_enrich_memo.py   # C-13: canonical home, no second inline config double
```

---

### Step 4 — docs: Sync every surface that names the stale `10` seed

**Status**: `done`
**Service**: `docs/patterns/`, `services/xstockstrat-analysis/`, `docs/`
**Files**:
- `docs/patterns/config-governance.md` — modify
- `services/xstockstrat-analysis/CLAUDE.md` — modify
- `docs/context-constitution-findings.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `docs/patterns/config-governance.md` (lines on `origin/main-dev` @ `d5de836b`):
  - § Author-sentinel conventions table, ending at `:143`. `:142` is `system:config-migration-<NNN>` and `:143` is `system:config-migration-feature-<slug>`. Neither matches `system:config-migration-feature-330`, which the operator kept (P-1/P-2 declined), so D-5 requires recording it as a C-10(c) convention row.
  - `:145-147` § Per-Feature Registered Keys: "Append-only log — one entry per feature… Newest first. Don't edit past entries. Superseding a key's behavior gets a new entry, not a rewrite of the old one." The newest entry is `### feature 338 — notify-commsgun-channel` at `:151`; `### feature 334` follows at `:176`.
  - Stale past entries: `:355-356` (feature 227 note, "migration `028` seeds `10`"), `:465` (feature 184 row, default `10`, "Live-quote/sparkline memo TTL") and `:516` (feature 177 row, "seeded `10` by config migration `028`").
- `services/xstockstrat-analysis/CLAUDE.md:281` (on `5c4cc935`; it was `:625` on `52f6d5a6`) is a live defaults table row ending "Code default `20`; seeded `10` by migration `028` (feature 184); unbounded."
- `docs/context-constitution-findings.md:49` (on `5c4cc935`; it was `:42`) is the open row "**The seeded live-enrich memo TTL never hits** (flagged by feature 227)". It sits in § Latent bugs, a three-column table: `| Issue | Impact | Evidence |`.
  - The file closes rows with the `~~…~~ **RESOLVED (feature N)**` convention (`:17-20`).
  - In this table, the closed precedent is `:48` (feature 244). Its Impact cell is `resolved`, and its Evidence cell is repointed at the fix.
- `scripts/check-config-wiring.mjs --doc-check` (loop from `:869`) scans `docs/patterns/config-governance.md` (a `DOC_RULES` file, `:856`) and every `services/*/CLAUDE.md` for banned phrases (`DOC_BANNED`, `:862`). The new text must avoid `seeding waiver`, `NO fixed convention`, `cutover in feature 296` and `via the alias until`.

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. **`docs/patterns/config-governance.md`**, § Author-sentinel conventions. Add one row after `:143`:
   ```markdown
   | `system:config-migration-feature-330` | `xstockstrat-config` (SQL migration) | Feature 330's guarded reseed of `analysis` / `opportunity.live_enrich_ttl_seconds` (`*_analysis_live_enrich_ttl_reseed`): set only on the global rows whose value it moved `10 → 20`, with `caller_identity` NULL. Its down reverts only rows still carrying it, so an operator `SetConfig` (which rewrites `updated_by`) is never reverted |
   ```
2. **`docs/patterns/config-governance.md`**, § Per-Feature Registered Keys. Insert a new entry directly
   above `### feature 338` (the current newest entry, `:151`), so it is newest first. Do **not** edit `:355-356`,
   `:465` or `:516`, because the log is append-only.
   - Heading: `### feature 330 — fix-live-enrich-ttl-seed (`xstockstrat-config` / `xstockstrat-analysis`)`.
   - One paragraph:
     - No key is added. Config migration `*_analysis_live_enrich_ttl_reseed` moves the stored value of the
       global staging/production rows from the 028 seed `10` to `20`, and only where the row still holds
       `10`. Operator values are kept. Per-user rows are untouched.
     - It rewrites the stale "live-quote/sparkline memo" description.
     - It writes no `default_value`, which is already `20` via `041`.
     - It notifies `config_changed`, so analysis picks the value up without a restart.
     - This entry supersedes the feature-184 row (default `10`), the feature-177 row ("seeded `10`") and the
       feature-227 note ("migration `028` seeds `10`").
     - Approval: DBA + config owner.
   - Then a one-row table: `| Namespace | Key | Type | Default | Reader | Notes |` with
     `analysis` | `opportunity.live_enrich_ttl_seconds` | int | `20` |
     `app/handlers/servicer.py:_enrich_opportunities_live` | Seeded `20` (was `10`). Keep above the 15s
     `ListOpportunities` UI poll. `0` disables the memo. Unbounded.
3. **`services/xstockstrat-analysis/CLAUDE.md:281`** (re-grep `live_enrich_ttl_seconds` after the precondition merge).
   - Replace "Code default `20`; seeded `10` by migration `028` (feature 184); unbounded." with "Code default
     `20`; seeded `20` (028's `10` reseeded by feature 330's `analysis_live_enrich_ttl_reseed` migration).
     Keep it above the 15s UI poll; unbounded."
   - Leave the rest of the row unchanged.
4. **`docs/context-constitution-findings.md:49`** (re-grep `live-enrich memo TTL never hits` after the precondition merge).
   - Wrap the Issue cell's claim in `~~…~~`.
   - Append `**RESOLVED (feature 330)**: config migration `*_analysis_live_enrich_ttl_reseed` reseeds the global rows still at `10` to `20` (operator values kept).`
   - Set the Impact cell to `resolved`.
   - Following the `:48` precedent, repoint the Evidence cell at the fix: `services/xstockstrat-config/migrations/*_analysis_live_enrich_ttl_reseed.up.sql` and `services/xstockstrat-config/src/__tests__/liveEnrichTtlReseedMigration.test.ts`.
5. In each edited sentence, name the migration only by its number-free suffix, so a merge-time renumber does
   not touch the docs (D-13).

**Verification**:
```bash
node scripts/check-config-wiring.mjs --doc-check   # exit 0, no banned phrase
grep -n "system:config-migration-feature-330" docs/patterns/config-governance.md          # sentinel row + feature 330 entry
grep -n "^### feature 330 — fix-live-enrich-ttl-seed" docs/patterns/config-governance.md # above "### feature 338"
grep -n "seeded \`10\` by migration \`028\`" services/xstockstrat-analysis/CLAUDE.md || echo "analysis CLAUDE.md synced"
grep -n "RESOLVED (feature 330)" docs/context-constitution-findings.md
git diff -U0 docs/patterns/config-governance.md | grep '^-[^-]' || echo "no past log line removed (append-only)"
```

---

### Step 5 — test: Post-deploy read-back per environment (operator-run)

**Status**: `pending`
**Service**: `xstockstrat-config` (live databases; results recorded in `context.md`)
**Files**:
- `docs/roadmap/features/330-fix-live-enrich-ttl-seed/context.md` — modify (results only)

**Reviewers**: xstockstrat-config owner — environment (`production`/`staging`) / global-per-user scoping, WatchConfig stream stability

**Codebase Evidence**:
- `docs/runbooks/config-rollout.md:217-228` § Step 6, Post-Deploy Read-Back: after any deploy that seeds, renames or retypes config rows, read every touched key back in each environment (`get_config` / `list_config_keys` on that environment's agent MCP, `check-config-wiring.mjs --final` on the deployed commit), and record the result in `context.md`.
- Sanctioned direct SQL access: `docs/runbooks/operator-db-access.md` (`psql` and `doctl`).
- Snapshot-only evidence that live values may differ:
  - staging global `600` (`scripts/config-heal/report-staging-041.jsonl:9`);
  - the staging per-user row (`scripts/config-heal/inventory-staging.jsonl:16`, design D-6).
- Audit and attribution: `config.config_audit` with `changed_by`/`reason` (`docs/runbooks/config-rollout.md:196-201`).

**TDD**: `N/A (post-deploy observation)`

**Covers**: `AC-1`

**Gate strength (impl-spec review).** This step produces advisory evidence, not an automated gate. Only
`check-config-wiring.mjs --final` is runnable unattended. The SQL is operator-run and its verdict is a human
read. The automated `@AC-1` gate is Step 1's static test, which runs in CI on every PR. The read-back exists
because live rows can differ from the repo tree (the staging global row held `600`, and there is a per-user
row). Its pass criterion (> 15, description fixed) must therefore be confirmed by the operator before
promotion, not inferred.

**Instructions**:
1. Run this after the integration PR is merged and the dev app has deployed it. Repeat it on the production
   database after the `main-dev` → `main` promotion deploys.
2. On each database the migration ran against, run the query through `docs/runbooks/operator-db-access.md`:
   ```sql
   SELECT environment, user_id IS NULL AS global, value_data, updated_by,
          description LIKE 'Short TTL for the success-only per-symbol live-quote/sparkline memo%' AS stale_description
   FROM config.config_values
   WHERE namespace = 'analysis' AND key = 'opportunity.live_enrich_ttl_seconds'
   ORDER BY environment, global DESC;
   ```
   - **Pass, per environment:** the global row's `value_data::int > 15` and `stale_description` is false (D-12).
     A row the migration moved shows `value_data = '20'` and `updated_by = 'system:config-migration-feature-330'`.
     A row with an operator value (e.g. staging `600`) keeps its value and its own `updated_by`.
   - **Fail:** a global value ≤ 15 that is not `10`. The migration leaves such a row alone by design (D-1).
     Escalate it to the operator for a `SetConfig`.
3. Per-user rows (D-6): list each per-user row with its `value_data`. If one is ≤ 15, record it in
   `context.md` as an operator follow-up. It overrides the global row for that user (CONFIG-6/CONFIG-7). Do
   not change it in this feature.
4. Confirm the change reached `WatchConfig` without a restart: on the staging agent MCP,
   `get_config(namespace="analysis")` shows `opportunity.live_enrich_ttl_seconds` at the stored global value.
5. Confirm the audit: `SELECT old_value, new_value, changed_by, reason FROM config.config_audit WHERE namespace = 'analysis' AND key = 'opportunity.live_enrich_ttl_seconds' ORDER BY changed_at DESC LIMIT 4;`.
   It shows `10 → 20` by the sentinel only for rows the migration moved, and no audit row for a row that
   changed only its description.
6. Paste the raw results, timestamps and pass verdicts into `context.md`, and show them to the operator
   before the promotion PR (fails.md: manual checks are confirmed by a human before promotion).

**Verification**:
```bash
node scripts/check-config-wiring.mjs --final   # on the deployed commit: exit 0
# the SQL above, per database (operator-run via docs/runbooks/operator-db-access.md); recorded verbatim in context.md
```
Observed: for each environment, the global row's value is > 15 and its description is no longer the 028 text.
Per-user values are listed. The operator's confirmation is logged in `context.md`.

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._

### Deviation: Step 2 — migration: `050_analysis_live_enrich_ttl_reseed` up/down + regenerated stored set
**Spec said**: "Local route, the same as CI: run `docker build -f scripts/Dockerfile.migrate -t xstockstrat-migrate-ci .`, then `docker run … xstockstrat-migrate-ci scripts/config-wiring-stored.py` against a scratch `timescale/timescaledb:latest-pg16`" (§ Step Dependencies), with the CI `config-wiring-stored` artifact as the fallback.
**Actual**: `scripts/config-wiring-stored.json` was generated on a throwaway local PostgreSQL 16.15 cluster (`/usr/lib/postgresql/16/bin`, temp data dir under the worktree's `.sdd-logs/`, `127.0.0.1:55432`). `migrate` was built with `go install -tags postgres github.com/golang-migrate/migrate/v4/cmd/migrate@v4.17.1`, the `scripts/Dockerfile.migrate` pin. The command was `DATABASE_URL=<that cluster> python3 scripts/config-wiring-stored.py`, and the output is committed unedited. The diff is `inputs_sha256` plus the `description` of the production and staging `analysis` / `opportunity.live_enrich_ttl_seconds` rows, exactly the expected set. The cluster was then stopped and deleted. It was used for artifact generation only; every Verification ran offline afterwards.
**Reason**: neither spec route was available to this worktree agent. The operator chose Option A on the step-1 blocker (explicit override, 2026-11-13).
**Disposition**: CI-equivalent fallback. CI job `config-wiring-stored` regenerates the file on `timescale/timescaledb:latest-pg16` and diffs it. Plain PG16 suffices because the config migrations use no TimescaleDB feature, and CI re-checks that at the integration PR.

### Deviation: Step 1 — test: Static migration test for the guarded TTL reseed (RED)
**Spec said**: "Load the statements: `const up = splitStatements(findOne(SUFFIX, 'up'))` …" and "Load `findOne('_analysis_opportunity_keys', 'up')`. Match with ``new RegExp(`'analysis\\.opportunity\\.live_enrich_ttl_seconds', 'int', '10', ${LIT}`, 'g')``."
**Actual**: (a) The statements and the 028 text load through a memoized `load()` called inside each `it`, not in the `describe` callback as in the `zeroTrapDescriptionMigration.test.ts` precedent. (b) The 028 regex runs on the `splitStatements`-collapsed 028 text, because the raw file breaks the line between `'10',` and the description. It is extended with `, '10', 'xstockstrat-analysis', '(staging|production)'` so that both environments' rows are pinned. (c) The case-3 value is captured from the up's CASE and asserted to be `'20'` and `> UI_POLL_SECONDS`. (d) The case-5 "no unguarded actor assignment" check also runs over the down's SET clause, matching bare (not `v.`-qualified) column names.
**Reason**: (a) On node v22.23.4, a throw inside a `describe` callback reports `not ok` but `# tests 0 / # fail 0`, and `node --test` exits 0 (first RED run, `exit=0`). A missing migration would therefore look green. With the loads moved into each `it`, RED exits 1 with 8 failing tests. (b) through (d) apply the Instructions' "assert the fragments exactly as they appear there after `splitStatements` whitespace collapse". All assertions are unchanged in intent; no new behavior.

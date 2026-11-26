# Design: fix-live-enrich-ttl-seed

**Created**: 2026-11-13
**Rounds**: 3 (full; termination: approved)
**Approved by**: user @ 2026-11-13 (operator approval at the sdd-batch design gate; Floor clear)
**Grounded in**: recon.md
**Debate register**: debate.md

---

## Chosen Approach

One new config data migration corrects the stored live-enrich memo TTL. Nothing else changes: no proto,
analysis code or UI code. Migration `028` stays applied and untouched (F-01;
`services/xstockstrat-config/migrations/028_analysis_opportunity_keys.up.sql:111-116`, recon.md:21-24).

**Consumer surface (C-14).** The fix is internal-only. The corrected value reaches the analysis reader
(`services/xstockstrat-analysis/app/handlers/servicer.py:4819`, recon.md:35) over the existing `WatchConfig`
stream, through the migration's explicit `pg_notify`. The consumer is the `xstockstrat-ui` trader
opportunities list. It keeps its 15s poll (`services/xstockstrat-ui/src/hooks/useOpportunities.ts:49`,
recon.md:38). Its warm re-polls start hitting the feature-177 memo again, with no UI change.

### Migration file (D-13)

- The path is `services/xstockstrat-config/migrations/049_analysis_live_enrich_ttl_reseed.{up,down}.sql`.
  - Recon proposed `048` (recon.md:81), but feature 334's `048_webhook_fanout_callback_keys` now holds
    that number on trunk.
  - The name suffix is unique, so the test helper's `findOne` resolves exactly one file (recon.md:58).
- The spec's merge checklist re-checks the number:
  - Run `git log --all` for `049*` and `050*`.
  - Scan the migration tails of the `origin/feature/*` branches, including in-flight 321 and 322.
  - At merge the number must be max(origin/main-dev) + 1. golang-migrate silently skips any version
    lower than the applied maximum.
- File content is number-free, so a renumber is only a rename plus a regeneration of
  `config-wiring-stored.json` (D-15).

### Up: one CTE statement

1. `u AS (UPDATE config.config_values v SET … WHERE … RETURNING namespace, key, environment)`.
   - **Scope (D-1).** `namespace = 'analysis'`, the relative key `key = 'opportunity.live_enrich_ttl_seconds'`
     (C-05), `user_id IS NULL`, and `environment IN ('staging','production')`. This reuses the 043 shape
     (`043_analysis_live_loop_keys.up.sql:27-35`, recon.md:49). The stored key has been relative since
     `044_config_keys_relative.up.sql:216` (recon.md:27).
   - **WHERE (D-3).** The scope AND (`value_data = '10'` OR `description` = the verbatim 028 text from
     `028_analysis_opportunity_keys.up.sql:112,115`).
   - **`value_data`** changes by CASE: `'10'` becomes `'20'`; any other value stays. Operator values such as
     staging's `600` (recon.md:42) are preserved, as `@AC-24` requires.
   - **`description`** changes by a separate CASE, guarded on the verbatim 028 text. This follows the 032
     pattern (`032_analysis_zero_trap_descriptions.up.sql:5-9`, recon.md:48). A row with an operator value
     still gets the corrected description.
   - **Actor columns (D-9).** `updated_by`, `update_reason` and `caller_identity` are each guarded by a
     CASE on the value branch:
     - Only rows whose `value_data` the migration changes get the sentinel
       `'system:config-migration-feature-330'` (D-4) and `caller_identity = NULL`.
     - Description-only rows keep their real writer, because the audit trigger records only value changes
       (`001_config_tables.up.sql:37-51`, recon.md:30).
   - **`default_value` is never written (D-2).** Migration 041 already synced it to the code default 20
     (recon.md:41), and CONFIG-2 says runtime defaults come from the code literal.
2. `nt AS (SELECT pg_notify('config_changed', json_build_object('namespace', namespace, 'key', key, 'environment', environment, 'user_id', NULL)::text) FROM (SELECT DISTINCT namespace, key, environment FROM u) t)`.
   - This is the four-field CONFIG-4 payload (D-14).
   - Without it, a migration UPDATE reaches `WatchConfig` subscribers only on the next reload
     (`src/grpc/configServiceImpl.ts:347,841`, recon.md:31).
3. A final `SELECT (SELECT count(*) FROM u), (SELECT count(*) FROM nt);` references the notify CTE, so
   PostgreSQL actually evaluates it (D-10; `047_config_alias_removal_rows.up.sql:57-61`, recon.md:50-56).

A replay finds no row at `'10'` and no row with the 028 description, so it changes nothing and writes no
audit row (`@AC-26`, `@AC-28`).

### Down: mirror of the up (D-5)

- The value reverts to `'10'` only where `value_data = '20'` AND `updated_by` is the 330 sentinel.
  There is no marker table and no `config_audit` anchor (R-4, R-9).
  - Recon flagged that a bare `'20'` guard would over-revert (recon.md:97). Guarding the actor columns
    (D-9) makes the sentinel mark exactly the rows 330 changed.
- The description reverts to the 028 text only where it equals the 330 text byte for byte.
- The actor columns are guarded on the value branch, as in the up.
- The down ends with the same four-field notify CTE and the forced final SELECT.

### CI touchpoint (D-15)

- `scripts/config-wiring-stored.json` is part of the migration step's **Files**.
- Regenerate it only with the generator: `DATABASE_URL=<scratch postgres> python3 scripts/config-wiring-stored.py`.
  Never hand-edit it, and regenerate it again after any renumber.
- Why it is needed:
  - `check-config-wiring --final` hashes every config migration, so a new migration file makes it fail
    with STALE-STORED.
  - The file's rows for this key carry the 028 description, which 049 rewrites.

### Out of scope (D-6, D-8)

- **Per-user rows.** The staging per-user row (recon.md:41) is left alone. The deploy-time verification
  lists per-user values for operator follow-up.
- **`scripts/config-heal/catalog.tsv`** is not edited. It is 041's sha-pinned input evidence
  (recon.md:26,87).

### Tests

1. **Static `node:test` suite** `services/xstockstrat-config/src/__tests__/liveEnrichTtlReseedMigration.test.ts`
   (D-7, D-11).
   - It is the RED test for the defect and follows `zeroTrapDescriptionMigration.test.ts`. It uses
     `findOne`/`splitStatements` from `migrationSql.ts` (recon.md:57-60).
   - It reads the old description from `findOne('analysis_opportunity_keys', 'up')`, not from a copied
     literal.
   - It asserts:
     - the key is relative;
     - the `user_id IS NULL` and environment scope;
     - the value CASE and the description CASE;
     - the actor columns change only on the value branch;
     - there is no `default_value` assignment and no DELETE;
     - in both up and down, the final SELECT references the notify CTE and the payload includes
       `environment`;
     - the down's description literal equals the up's new text;
     - the down's value revert is guarded on `'20'` AND the sentinel.
   - The spec checks whether `globalIntSeedCases.ts` fits (C-13).
2. **Analysis `@AC-2` behaviour test** next to `tests/test_live_enrich_memo.py:44-64` (recon.md:36).
   With TTL = 20, a re-poll 15s later issues no `BatchGetLatestPrice`.
3. **No real-DB assertion file.** The operator declined REOPEN petitions P-3/P-4 at the gate, so D-7 and
   D-12 stand as settled.

### Verification and docs (D-8, D-12)

- AC-1's literal `'20'` is checked against a fresh DB by the static test. On a fresh DB both global rows
  hold the seeded `'10'` (recon.md:43-44).
- The dev-deploy query passes for an environment when its global value is > 15 and its description no
  longer equals the 028 text. The query also lists per-user rows.
- Same-PR doc sync (recon.md:84-87):
  - `docs/patterns/config-governance.md:422,473`, plus a Per-Feature Registered Keys row;
  - `services/xstockstrat-analysis/CLAUDE.md:610`.

### Build order

1. RED static test.
2. The 049 up and down migration, plus the regenerated `config-wiring-stored.json`.
3. Analysis `@AC-2` test.
4. Doc sync.
5. Dev-deploy verification.

## Rejected Alternatives

- `R-1` Writing `default_value` in the migration (up `'20'` / down `'10'`) — rejected because 041 already synced it to the code default, and the down would set the documented default out of line with the code default (CONFIG-2).
- `R-2` Gating the description rewrite on the `value_data = '10'` guard — rejected because it leaves the stale description on staging's `600` row, which 330 solely owns.
- `R-3` An unguarded overwrite of all global rows to `20` — rejected because it clobbers operator values, against `@AC-24`, with no C-16 operator sign-off.
- `R-4` The full 047 latch/snapshot/report/marker machinery — rejected as too much for one guarded value change (C-18).
- `R-5` Editing `scripts/config-heal/catalog.tsv:41` — rejected because it is 041's sha-pinned input evidence.
- `R-6` Seeding the value through a runbook `SetConfig` call instead of a migration — rejected because feature 296 requires migration seeding, and a fresh DB would reseed `'10'`.
- `R-7` Stamping actor columns on every WHERE-matched row, including description-only rows — rejected because it makes the sentinel-only down over-revert to `'10'` (violates `@AC-9`) and erases the real writer on rows where the trigger leaves no audit row.
- `R-8` Splitting the up into two UPDATE statements to isolate the actor stamping — rejected because it adds a second statement and notify source for the same result that column-level CASE guards give in one atomic statement.
- `R-9` A `config_audit` EXISTS anchor in the down — rejected for its correlated-subquery cost (C-18). Once the actor columns are guarded, it reverts the same rows as the sentinel alone.
- `R-10` Re-checking the migration number with working-tree `ls` only — rejected because it misses numbers held on unmerged sibling branches and golang-migrate's silent skip of a version below the applied maximum (fails.md:3815-3817, 2909-2911).
- `R-11` Keeping 047's two-field notify payload `{namespace, environment}` — rejected because it drifts from the documented four-field CONFIG-4 contract, and the four-field payload costs nothing extra.
- `R-12` Leaving `scripts/config-wiring-stored.json` unchanged, or hand-editing it — rejected because a new config migration changes the input hash and fails `check-config-wiring --final`. CI regenerates the file on a scratch DB and requires an exact match, so only generator output is valid.

## Open Risks

- [ ] **Migration number race.** 321 or 322 may land `049`/`050` first. If the max(origin/main-dev)+1 check is missed at merge, the numbers collide or golang-migrate silently skips the file. Mitigation: the merge-checklist procedure (D-13), plus regenerating `config-wiring-stored.json` after any renumber. Addressed at the migration step and its merge.
- [ ] **No real-DB execution of the migration.** The operator declined P-3/P-4, so no test runs the migration against real Postgres. The D-9 CASE/trigger interaction and the down's no-over-revert property rest on the static test and dev verification. fails.md:3834-3843 records a config down-guard bug that surfaced only at merge. Addressed at the static-test step and the dev-deploy verification.
- [ ] **Live values may differ from the repo snapshots.** A global row that an operator set to a non-`10` value below 15 is left as it is. Mitigation: the post-deploy query. Addressed at the dev-deploy verification step.
- [ ] **Staging per-user override.** The staging per-user row (`scripts/config-heal/inventory-staging.jsonl:16`) may hold a value below 15 that overrides the global row. It needs operator follow-up from the deploy-time listing. Addressed at the dev-deploy verification step.
- [ ] **Stale sentinel from a future writer.** A future writer that changes `value_data` without rewriting `updated_by` would leave a stale sentinel, and the down could mis-revert that row. No such writer exists today (`configServiceImpl.ts:829-835`). Addressed at spec, where the down-guard assumption is noted.
- [ ] **Key overlap with other features.** The `(namespace, key)` overlap scan must be re-run after each main-dev merge. Recon found only 322 touching this key, and 322 defers to 330. Addressed at spec and execute.
- [ ] **Transaction and notify timing.** The design assumes golang-migrate runs each file in one transaction, so `pg_notify` is delivered at commit. Confirm at spec. The single statement keeps the change atomic either way.
- [ ] **Story-owner action before spec (from closed O-1).** Add FR-1 and FR-2 and the `@FR` tags, and amend the `@AC-1` Given to "row still holds the seeded 10". Addressed before `/sdd-spec`.

## Constitution Rules Touched

- `C-05` — honored by: the migration targets the namespace-relative stored key `opportunity.live_enrich_ttl_seconds` under namespace `analysis`. No key is added, renamed or removed, and the key stays seeded by a config migration.
- `C-07` — honored by: `NNN_description.up/.down.sql` naming, with `NNN` = max(origin/main-dev) + 1 re-checked at merge (D-13).
- `C-10` — honored by: the sentinel `system:config-migration-feature-330` is the down's ownership anchor. The CONFIG-4 notify payload matches the shared `SetConfig` path. Every surface that names the stale seed is synced in the same PR (config-governance.md, analysis CLAUDE.md, the regenerated `config-wiring-stored.json`).
- `C-11` — honored by: the fix entered through `/sdd-triage` Track C and ran the full design debate before any code.
- `C-13` — honored by: the static test reads the old description from the 028 migration file, not a copied fixture. The spec checks the shared `globalIntSeedCases.ts` fixture before adding cases.
- `C-15` — honored by: `acceptance.feature` `@AC-1`/`@AC-2` stay the acceptance source of truth. The `@FR` tagging and the amended `@AC-1` Given are tracked as a story-owner action before spec.
- `C-16` — honored by: recon's business-rule list is carried below. The one CHANGE (`@AC-1`) has the operator's sign-off of 2026-11-13.
- `C-18` — honored by: one guarded CTE statement per direction. The 047 machinery (R-4), a split statement (R-8) and an audit anchor (R-9) were all rejected.
- `F-01` — honored: `028` is not edited. The correction is a new numbered migration.
- `F-08` — honored: `scripts/config-wiring-stored.json` is named in the migration step's **Files** (D-15), so staging it stays in scope.
- `P-02` — honored: proposer and adversary saw only mediated, synthesized state in all three rounds.
- `P-03` — honored: unverifiable items (live DB values, the transaction/notify assumption, the per-user override) are surfaced as open risks, not guessed. Contested settled decisions went to the operator as REOPEN petitions (P-1 to P-4), which the operator declined.
- `CONFIG-2` — honored: `default_value` is never written (D-2). The runtime default stays the analysis code literal 20.
- `CONFIG-4` — honored: the notify payload is the four-field `{namespace, key, environment, user_id}` shape (D-14).

## Business Rules Touched (C-16)

- CHANGE `@AC-1` "the effective live-enrich memo TTL exceeds the 15s UI poll after config migrations" (`docs/roadmap/features/330-fix-live-enrich-ttl-seed/acceptance.feature`) — the guarantee narrows. The literal `"20"` holds where the global row still holds the seeded `'10'` (always true on a fresh DB). Rows with an operator value keep that value, which must be > 15 on deploy (D-1, D-12). Signed off by the operator @ 2026-11-13 (sdd-batch design gate; context.md session 2026-11-13 — design approved).
- PRESERVE `@AC-2` "a warm 15s re-poll of ListOpportunities is served from the live-enrich memo" (`docs/roadmap/features/330-fix-live-enrich-ttl-seed/acceptance.feature`) — not regressed: the new analysis memo test at TTL = 20 covers it.
- PRESERVE `@AC-3` "UI poll interval refetches all loaded pages" (`services/xstockstrat-ui/acceptance/opportunities-pagination-drain.feature:24-25`) — not regressed: the 15s cadence is untouched, and the new TTL (20) exceeds it.
- PRESERVE `@AC-9` "Memo TTL aligns with browser poll interval" (`services/xstockstrat-analysis/acceptance/opportunities-latency-fix.feature:27-28`) — restored rather than regressed: the stored seed no longer undercuts the code default. The sentinel-only down cannot over-revert rows 330 did not change (R-7).
- PRESERVE `@AC-14` (`services/xstockstrat-config/acceptance/fix-config-keys-drift.feature:60`) — not regressed: the row stays a complete seed row. Only `value_data`, `description` and the actor columns change. No row is deleted and `default_value` is untouched.
- PRESERVE `@AC-24` (`fix-config-keys-drift.feature:81`) — not regressed: the value rewrite is guarded on the seeded `'10'`, so operator values (staging `600`) are not clobbered.
- PRESERVE `@AC-26` (`fix-config-keys-drift.feature:95`) — not regressed: a replay matches no row and causes no value change and no audit row.
- PRESERVE `@AC-28` (`fix-config-keys-drift.feature:102`) — not regressed: the migration is replay-safe and contains no DELETE (asserted by the static test).
- PRESERVE `@AC-34` (`fix-config-keys-drift.feature:141`, superseded by feature 296 `@AC-1`; recon.md:72) — not regressed: no prefixed-key row is written.

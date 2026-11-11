# Recon: fix-live-enrich-ttl-seed

**Created**: 2026-11-11
**From**: product-spec.md
**Tree**: detached@c4fd48b ≡ origin/main-dev (no `feature/fix-live-enrich-ttl-seed` branch existed at recon time)
**Affected services**: xstockstrat-config, xstockstrat-analysis, xstockstrat-ui

---

## Objective

Config migration `028` seeded `opportunity.live_enrich_ttl_seconds = '10'` (namespace `analysis`, staging and
production) while the analysis code default is `20`. That default was chosen to exceed the UI's 15s
`ListOpportunities` poll (feature-191 `@AC-9`). With `'10'` stored, every warm re-poll finds the feature-177
memo expired and refetches live quotes, so the memo does nothing. The fix is a new numbered config data
migration that rewrites the seeded value (and the row's stale description). There is no proto, analysis code
or UI change. Migration `028` stays untouched (F-01).

## Codebase Map

- **`xstockstrat-config`** (Node.js) holds the fix.
  - Buggy seed (applied, never edit): `services/xstockstrat-config/migrations/028_analysis_opportunity_keys.up.sql:111-116`.
    - These are the staging (`:111`) and production (`:114`) global rows: `'analysis', 'analysis.opportunity.live_enrich_ttl_seconds', 'int', '10'`, with `default_value '10'` and `user_id NULL`.
    - The insert ends `ON CONFLICT ... DO NOTHING` (`:117`).
    - The stale description is at `:112`/`:115`: "Short TTL for the success-only per-symbol live-quote/sparkline memo (feature 177)...".
  - The 028 down deletes the key (`028_analysis_opportunity_keys.down.sql:26`). It does not restore a value.
  - The heal catalog records the code default as `'20'` with the same stale description: `041_heal_config_keys_to_reader_catalog.up.sql:79` and `scripts/config-heal/catalog.tsv:41`. 041's default-sync left `value_data` alone (see the heal report below).
  - Stored keys became namespace-relative in `044_config_keys_relative.up.sql:216` (`SET key = substr(v.key, length(v.namespace) + 2)`). 045 adds a CHECK that rejects prefixed keys. So after 044 the target row is `namespace='analysis' AND key='opportunity.live_enrich_ttl_seconds'`.
  - Last migration: `047_config_alias_removal_rows.up.sql` / `.down.sql` (`services/xstockstrat-config/migrations/`). Nothing is numbered `048` or higher yet.
  - Audit trigger: `001_config_tables.up.sql:37-51`. `config.audit_config_change()` runs BEFORE UPDATE. It writes a `config.config_audit` row when `value_data` changes, using `NEW.updated_by` / `NEW.update_reason`. It does **not** `pg_notify`.
  - Live propagation: `src/grpc/configServiceImpl.ts:347` (`LISTEN config_changed`), and the server-side `SetConfig` path notifies at `:841` (`pg_notify('config_changed', ...)`). A migration UPDATE without an explicit `pg_notify` therefore reaches `WatchConfig` subscribers only on the next reload or restart.
- **`xstockstrat-analysis`** (Python) is the reader. No change is needed.
  - Config read: `services/xstockstrat-analysis/app/handlers/servicer.py:4819` (`ttl = self._cfg.get_int_present("opportunity.live_enrich_ttl_seconds", 20)`). It is read on each `ListOpportunities` call, from the `WatchConfig` snapshot.
  - Tests: `tests/test_opportunities_latency.py:237-243` is `@AC-9` and checks only the *code default* is ≥15. `tests/test_live_enrich_memo.py:44` covers a memo hit within the TTL and `:69-70` covers TTL `0` disabling the memo.
- **`xstockstrat-ui`** (Next.js) is the poller. No change is needed.
  - `services/xstockstrat-ui/src/hooks/useOpportunities.ts:49` sets `refetchInterval: 15_000`.

### Stored-value evidence (repo snapshots, not live DB)

- `scripts/config-heal/report-staging-041.jsonl` is the staging database's 041 run on 2026-11-07:
  - `:7` production global: `stored_value "10"`, `default_value 10 -> 20; value_data unchanged`.
  - `:8` staging **per-user** row (`user_sha256 73833c…`): `stored_value null`.
  - `:9` staging global: `stored_value "600"`. This is an operator-set value, not the seed.
- `scripts/config-heal/inventory-fresh.jsonl:9-10` is the fresh-DB inventory. Both environments' global rows have `value_sha256 4a44dc15…`, which is `sha256("10")` (verified with `printf 10 | sha256sum`). So on a fresh DB both rows hold the seeded `'10'`.

## Patterns to REUSE

- **Guarded, idempotent UPDATE** → reuse `032_analysis_zero_trap_descriptions.up.sql:5-9`. It is a description UPDATE whose `WHERE ... AND description = '<old verbatim>'` guard makes a replay a no-op.
- **Guarded UPDATE on the global rows** → reuse `043_analysis_live_loop_keys.up.sql:27-35`. That shape is `WHERE namespace = 'analysis' AND key = ... AND user_id IS NULL AND environment IN ('staging','production') AND (guard)`, and the comment at `:25-26` explains the replay no-op.
- **Value rewrite with latch, audit, report and live broadcast** → reuse the 047 shape (`047_config_alias_removal_rows.up.sql`):
  - latch CTE on `config.config_markers` (`:7`)
  - premigration snapshot (`:26`)
  - `config.config_audit` insert (`:35`)
  - `config.config_keys_report_296` insert (`:41`)
  - marker insert (`:53`)
  - `pg_notify('config_changed', json_build_object('namespace', …, 'environment', …)::text)` (`:58`)
  - The 047 down restores rows from the marker and the report.
  Use this only if design decides the rewrite must broadcast live and leave a report trail. A plain UPDATE is already audited by the 001 trigger, but it does not notify.
- **Migration tests** → static SQL-text `node:test` suites in `services/xstockstrat-config/src/__tests__/`:
  - Helper: `migrationSql.ts` (`MIGRATIONS_DIR`, `findOne(suffix, 'up'|'down')`, `splitStatements`). `findOne` asserts that exactly one file matches the suffix, so the new migration's name suffix must be unique.
  - Closest precedents: `zeroTrapDescriptionMigration.test.ts` (guarded description UPDATE, down inverts up) and `aliasRemovalRowsMigration.test.ts` (047 shape).
  - Shared int-seed fixture: `globalIntSeedCases.ts`. It was not opened, so check whether it fits (C-13).
- **Migration sha pin**: `aliasRemovalRowsMigration.test.ts:1-15` pins 047 to a sha256 recorded in `scripts/config-heal/signoff.md`. That only applies if design adopts the 047 operator-rehearsal flow. A plain guarded UPDATE (the 032/043 style) has no signoff precedent.

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-9` "Memo TTL aligns with browser poll interval" (`services/xstockstrat-analysis/acceptance/opportunities-latency-fix.feature:27-28`). The memo must still be valid on the 15s re-poll. The stored `'10'` violates it today and this feature restores it. The scenario says "at its code default", and the stored seed overrides that default.
- **EXTEND** `@AC-9` (same suite). Feature 330's `@AC-2` adds an end-to-end case with the migrated config applied: a warm 15s re-poll issues no `BatchGetLatestPrice`.
- **PRESERVE** `@AC-3` "UI poll interval refetches all loaded pages" (`services/xstockstrat-ui/acceptance/opportunities-pagination-drain.feature:24-25`). The 15s cadence stays, and the new TTL (20) must exceed it.
- **PRESERVE** `@AC-14` (`services/xstockstrat-config/acceptance/fix-config-keys-drift.feature:60`). The row stays a complete seed row in both environments (`value_type` int, `default_value`, non-empty description, `consuming_service`).
- **PRESERVE** `@AC-24` (`fix-config-keys-drift.feature:81`). A seed-parity migration does not retype or clobber a stored value that differs from the code default. This is the precedent for the overwrite-policy question below.
- **PRESERVE** `@AC-1` (`fix-config-keys-drift.feature:18`). The migration targets the namespace-relative stored key. `@AC-34` (`:141`) is noted in the suite header (`:13`) as superseded by feature 296 `@AC-1`, but the constraint is the same: no prefixed-key row.
- **PRESERVE** `@AC-28` (`fix-config-keys-drift.feature:102`). The migration is replay-safe and deletes no row.
- **PRESERVE** `@AC-26` (`fix-config-keys-drift.feature:95`). An unchanged value produces no spurious change, so a replay with the value already `20` is a no-op.
- `docs/sdd/business-rules/platform.feature`: no live-enrich TTL rule was found. Lines 786-2175 were grep-checked only. The only nearby hit is the different key `opportunity.live_enrich_timeout_ms` (`@AC-6 @feature-244`).
- No CHANGE flags, so no C-16 sign-off is needed.

## Dependencies

- Proto/RPC: none.
- Migration: next number **`048`** for `services/xstockstrat-config/migrations/` (the highest present is 047). Features 321 and 322 also add config migrations, so take the number in merge order and re-`ls` at `/sdd-spec` and `/sdd-execute` (fails.md 2026-08-06, "durable-observable-backfills"). Approval: DBA + config owner.
- Config keys: existing `opportunity.live_enrich_ttl_seconds` (namespace `analysis`, display FQN `analysis.opportunity.live_enrich_ttl_seconds`). Only the value and description change. No key is added, renamed or removed (C-05).
- Inter-service edges: none new. Config pushes the value to analysis over the existing `WatchConfig` stream.
- New env vars / ports: none.
- Docs to sync in the same PR, because they still name the stale seed:
  - `docs/patterns/config-governance.md:422` (default `10`, "Live-quote/sparkline memo") and `:473`
  - `services/xstockstrat-analysis/CLAUDE.md:610`
  - `scripts/config-heal/catalog.tsv:41` (stale description; check whether it is an append-only heal artifact before editing)

## Risks / Not-found

- **Overwrite policy (open question 1)** has two options:
  - **Guard on `value_data = '10'`.** This matches `@AC-24`, preserves staging's operator-set `600`, and covers the fresh-DB case. Under it, AC-1's literal "staging is `20`" holds only where the row still holds `'10'`; the staging snapshot's `600` already exceeds 15.
  - **Rewrite every global row.** This would clobber an operator value and be a deliberate departure from `@AC-24`, which must be recorded.
  - Per-user rows: the one staging per-user row has a null value. No suite fixes whether per-user rows are in or out. The 043 and 047 precedents scope to `user_id IS NULL`.
- **Live DB state is not verifiable from the repo.** The evidence is snapshots only (the staging DB on 2026-11-07, plus a fresh DB). Confirm each environment's stored value at deploy time.
- **Live broadcast:** a plain UPDATE is audited (001 trigger) but not notified. Without a `pg_notify`, analysis keeps `'10'` until the config service reloads or restarts. Design must choose a plain guarded UPDATE (and accept "takes effect on next reload") or the 047-style explicit notify.
- **Audit attribution:** the 001 trigger takes `changed_by` from `NEW.updated_by`. The UPDATE should set `updated_by` (for example `'system:config-migration-feature-330'`) and `update_reason`, or the audit row is attributed to the previous writer. I did not check whether `config_values.update_reason` exists in the post-044 schema; confirm it at spec time.
- **Down migration:** it must restore `'10'` only on rows the up changed. A guard of `value_data = '20'` would also revert rows that were legitimately `20` before. The 047 marker/report pattern avoids this; the 032-style inverse guard does not. Design must decide.
- **Description rewrite:** feature 322 defers this row's description to 330 (`docs/roadmap/features/322-fix-retired-surface-proto-cleanup/product-spec.md:129`). Use the 032 verbatim-old-description guard so a replay or a later edit is not clobbered.
- No existing test asserts the *stored* seed against the 15s poll. That gap let this bug through: `@AC-9`'s test checks only the code default.
- Ledger trap: insights.md:905 ("seed migrations must store the full dotted key") predates feature 296 and is superseded by C-05. The stored key is now namespace-relative, so do not copy 028's prefixed form.
- No direct precedent rewrites a numeric `value_data` guarded on its old value. 032 and 043 touch metadata only, so the guard shape is new.

## Recommended Scope

1. **Config migration `048_<unique_suffix>` (up and down).**
   - Up: a guarded UPDATE of the global staging and production rows for `analysis` / `opportunity.live_enrich_ttl_seconds`. It sets `value_data '20'`, `default_value '20'` and the corrected description, and sets `updated_by` / `update_reason`. Apply the overwrite policy and notify mechanism decided in design.
   - Down: restores `'10'` only on the rows the up changed.
2. **Static SQL-text migration test** in `services/xstockstrat-config/src/__tests__/`, modelled on `zeroTrapDescriptionMigration.test.ts`. It asserts:
   - the relative key, the `'20'` / `'10'` values and the scope guard
   - replay safety and that no row is deleted
   - that the down inverts the up
   It is RED before the migration exists.
3. **Doc sync** of `docs/patterns/config-governance.md:422,473`, `services/xstockstrat-analysis/CLAUDE.md:610` and possibly `scripts/config-heal/catalog.tsv:41`.
4. **Optional, decided in design:** a test (or an extension of the analysis `@AC-9` test) that ties the seeded value to the UI poll interval, so a future seed below 15 fails CI.

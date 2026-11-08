# Implementation Spec: fix-config-keys-contract

**Status**: `pending`
**Created**: 2026-11-07
**Feature**: `docs/roadmap/features/296-fix-config-keys-contract/feature.md`
**Total Steps**: 19
**Feature Branch**: `feature/fix-config-keys-contract`

**Tree**: `ccr-e901c541-u0cmts@882e4ca ≡ origin/ccr-e901c541-u0cmts` (spec written at `744ed5e`; re-stamped at impl-spec review cycle 2: `0938cee`), containing `origin/main-dev@0d97dda`. The tree was verified at spec time, but not by the `tree-freshness.md` Sync path: `origin/feature/fix-config-keys-contract@26c1a56` carries none of `recon.md`/`design.md` (they live only on this pushed `ccr-*` branch), so switching would have removed this spec's inputs. `/sdd-execute` BRANCH SYNC owns the move onto the Development Branch.

---

## Execution Summary

Order: the two config migrations (R, R+1) first, because everything else reads the post-rename shape. Then the FR-1 server rejection and its tests, the two consumer surfaces (config-ui, then the agent), the wiring gate's `prefixed-read` kind, the contract documents, the CI rerun harness, and last the operator sign-off of R's embedded allowlist, with the regeneration and verification that depend on R's final bytes. R and R+1 are written with an **empty** `allow_296` block; Step 16 fills it, renumbers if needed, and pins the file.

Placeholders: **R** = the rename migration, **R+1** = the CHECK migration. Both take max+1 of `services/xstockstrat-config/migrations/` at execute time; `043_analysis_live_loop_keys` is the last file today, so `044` and `045`. Names below use 044/045; Step 16 re-checks and renumbers by the F-09 Deviation Log route (precedent: 295 Step 38). **The actor strings inside R/R+1 carry the number.**

Consumer surfaces (C-14): `/config-ui` is Steps 5-6, the agent `get_config`/`list_config_keys`/`set_config` is Steps 7-8, and "operators see a clear refusal" is Steps 3-4 (the `INVALID_ARGUMENT` message). The consumer literal rewrite of the 11 services is **feature 304** (named follow-up), not here.

**Known red window.** After Step 1 the committed `scripts/config-wiring-stored.json` is stale (`inputs_sha256` covers the migrations directory, `check-config-wiring.mjs:225-230`), so `--final` and the tests `baseline 1` / `baseline 2` stay red until Step 18 regenerates the stored set. Steps 9-13 therefore run the gate test file with `--test-name-pattern='^(?!baseline [12] )'`, and Step 18 runs it unfiltered. This is a declared limit of per-step Verification, not a skipped check; the integration PR carries the full CI gate. Per-step commits go straight to the Development Branch (sequential mode), so the CI jobs `config-wiring` and `config-wiring-stored` run only on the integration PR, where they are green once Step 18 has landed; the red window is local to the per-step runs. Step 10's `baseline 2` edit and Step 9's owner changes therefore get their first local verification at Step 18, and any rebase or renumber after Step 18 forces Step 18 to be re-run.

### Scenario Coverage (C-15)

| Scenario | Covered by |
|---|---|
| AC-1 | Step 4 (SetConfig / create_key / GetSecret `INVALID_ARGUMENT`), Step 15 (the direct-insert CHECK rejection) |
| AC-3, AC-4 | Step 4 (alias snapshot tests), Step 15 (stored value survives R) |
| AC-5 | Step 4 |
| AC-6, AC-22, AC-23, AC-24 | Step 10 |
| AC-8, AC-9, AC-15, AC-16, AC-17, AC-18, AC-19, AC-20, AC-21 | Step 15 (AC-21 asserts N unmatched rows where N is the number of tuples in the rendered block: 0 until Step 16 pastes it, 5 after; Step 16's Verification asserts the 5) |
| AC-10 | Step 6 (ui), Step 8 (agent) |
| AC-11 | Step 12 (rule sentences), Step 13 (the remaining contract documents and runbook), Step 19 (the full doc set + runbook assertions) |
| AC-12 | Step 19 |

### C-16 rule split (design Open Risk "C1-C6/N2 per-rule split")

Resolved here from the durable suites. **296 owns** every scenario whose text names a *prefixed stored, `SetConfig`, `GetSecret` or `ListKeys` key*, or the wiring-gate kinds; each gets a supersession note in Step 14 (signed CHANGE list, `design.md` "Business Rules Touched"). **304 owns** only scenarios that pin a consumer getter literal: C1 `@AC-2` @243 is the indicators watcher and is on the signed 296 list because its Given pins the snapshot row spelling, so it gets a note here and its literal half goes to 304's design. N2 (`services/xstockstrat-agent/acceptance/fix-agent-getconfig-deadline.feature`, @feature-247) names only relative keys (`signal.alert_threshold`), so 296 writes no note for it; the agent's own prefixed reads (`app/client.py:1116-1117`) are 304's. No item needs to go back to the operator: every literal-only item has a designated owner (304).

## Step Dependencies

- Step 2 requires Step 1: R creates `config.config_values_premigration_296` and `config.config_keys_report_296`, which R+1 inserts into.
- Steps 3 and 4 land together: existing config tests send full-dotted keys through `setConfig` (`setConfigScalarBounds.test.ts`, `setConfigSpelling.test.ts` and four more); the new pre-check turns them red, so Step 3 cannot pass its own Verification without Step 4's edits (`step-constraints.md` §C, behavior change that reddens the suite).
- Steps 9 and 10 land together: the `prefixed-read` kind reclassifies `join 1`, `ratchet 4/6/9` and `baseline 2/3`, which Step 10 rewrites.
- Steps 11 and 12 land together: the new `DOC_RULE_SENTENCES` fail `doc 1`/`doc 2` unless the three scanned documents and the test import change in the same commit.
- Step 6 requires Step 5; Step 8 requires Step 7 (paired tests, not atomic: Step 5/7 Verification does not run the Playwright/pytest files Steps 6/8 edit).
- Step 15 requires Steps 1-2. Its AC-21 assertion counts `unmatched-signed-tuple` rows against the number of tuples in the rendered block (0 while R ships the empty block, 5 after Step 16), so the `migration-rerun` job is green at every commit; Step 16's Verification asserts the 5.
- Step 16 requires Steps 1, 2, 15 and an operator on a workstation with DO staging access (rehearsal is not runnable in the executor).
- Step 17 requires Step 16 (it pins the sha256 that Step 16 records).
- Step 18 requires Steps 9-12 and 16-17 (stored-set and baseline generation use R's final bytes and the new gate).
- Step 19 requires all prior steps.
- Preconditions for the **integration PR** (not for any step): `040_config_markers` on `origin/main` (satisfied 2026-11-07, re-verify with `git cat-file -e origin/main:services/xstockstrat-config/migrations/040_config_markers.up.sql`); the operator records in `context.md` that 295's one-staging-release window has closed; Step 16's rehearsal is taken at the final rebase.
- Deferred, with named owners: consumer literals, the 11 consumer service banners and key tables (not the config service's own banner, which is Step 13), strat-lab skill literal, empty-baseline close-out → feature 304; dead-row deletion → 305; alias/tolerance/poller-exception removal → 306. `docs/roadmap/features/merge-order.md` rows 27-31 already pin 280/299/304/305/306.

---

### Step 1 — migration: rename migration R (`044_config_keys_relative`)

**Status**: `done`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/migrations/044_config_keys_relative.up.sql` — create
- `services/xstockstrat-config/migrations/044_config_keys_relative.down.sql` — create
- `services/xstockstrat-config/src/__tests__/dormantAlias.test.ts` — modify (the `no feature-295 migration writes the marker row` test, `:109-116`, rewritten)

**Reviewers**: DBA — migration numbering, up+down pair, run-order compliance with `scripts/db-migrate.sh`, xstockstrat-config owner — key naming, environment/global-per-user scoping, secret encryption + redaction, WatchConfig stream stability, Security — secret-class rows are renamed with ciphertext untouched and never printed

**Codebase Evidence**:
- Last config migration is `043_analysis_live_loop_keys` (`ls services/xstockstrat-config/migrations` → `040`…`043`); `035`/`036` do not exist. R is not adjacent to 040 (floor derives from the lowest `-- contract-of:` target, `scripts/migration-dirty-guard.sh:22-43`).
- Marker DDL: `040_config_markers.up.sql:1-6` (`config.config_markers(name text PK, set_at timestamptz, set_by text)`); the file's line 1 says it ships empty and 296 writes the row. Alias switch: `MARKER_ACTIVE_SQL` `configServiceImpl.ts:196-197`.
- Idioms to reuse (all in `041_heal_config_keys_to_reader_catalog.up.sql`): latch + report table `:6,:32`, `v_by` `:29`, snapshot-first with secret-class values nulled `:316-327`, hash predicate `encode(sha256(convert_to(value_data,'UTF8')),'hex')` `:373`, delete + explicit audit rows via CTE `:380-390`, per-(namespace, environment) notify `:539-540`, prefixed predicate `left(key, length(namespace)+1) = namespace || '.'` `:311-313`.
- Lock idiom with bounded retries: `analysis/migrations/027_contract_owner_dimension.up.sql:15-29`. Refuse-down text matched at `scripts/migration-rerun.sh:232` (`irreversible contract`): `ingest/migrations/014_contract_signal_ownership.down.sql`.
- Audit trigger `config_value_audit` is `BEFORE UPDATE` (`001_config_tables.up.sql`), and its live function (`017_config_secrets_and_scoping.up.sql`, `config.audit_config_change`) writes an audit row only when `value_data` changes and sets `NEW.updated_at = NOW()` unconditionally. A key-only UPDATE therefore emits no audit row and would destroy "Row last modified" (feature 219), so R disables the trigger and writes its own audit rows.
- Unique index `config_values_scope_uniq (namespace,key,environment,COALESCE(user_id,''))` is non-deferrable (`017`), so deletes and renames are separate statements.
- Per-user-unread rows are reported by 041 (`041…up.sql:410`); the committed staging report row is `scripts/config-heal/report-staging-041.jsonl:25` with its kept global twin at `:26`.
- Migration-text tests scan every `*.up.sql` for key literals (`retiredPortfolioSnapshotInterval.test.ts:25-34`, `split(';')`): R must contain no config-key string literal other than inside the allow block.
- `dormantAlias.test.ts:109-116` fails if any `04\d_*.up.sql` inserts into `config_markers`; R is `044`.
- Design: `design.md` §3 (steps 0-12) and §3.4. No existing config `contract-of` or refuse-down migration: **Not found** — modelled on ingest 014 / analysis 027 in the other services.

**TDD**: `N/A (migration; the dormantAlias.test.ts edit keeps an existing test green and is proven by Step 4/15)`

**Covers**: —

**Instructions**:
1. Re-check max+1: `ls services/xstockstrat-config/migrations/*.up.sql | tail -1`. Use that number for `044` below if it changed (and for the actor string).
2. `044…up.sql` line 1: `-- contract-of: services/xstockstrat-config/migrations/040_config_markers.up.sql` (inside the first 5 lines, `migration-dirty-guard.sh:25`). No `-- requires-env` header (the file must render byte-for-byte, `scripts/render-migrations.sh:23-30`). **No top-level `BEGIN`/`COMMIT`** (golang-migrate wraps the file; Step 17 asserts it).
3. Before the DO block: `CREATE TABLE IF NOT EXISTS config.config_values_premigration_296 (LIKE config.config_values_premigration_041)` plus `ALTER TABLE … ADD COLUMN IF NOT EXISTS snapshot_at timestamptz NOT NULL DEFAULT clock_timestamp()`; `CREATE TABLE IF NOT EXISTS config.config_keys_report_296 (run_at timestamptz, action text, namespace text, key text, environment text, user_id text, reason text)`. The report **never holds a value**. Actor constant `system:config-migration-044`.
4. One `DO` block, in this order (`design.md` §3):
   - **0 Latch**: `IF EXISTS (SELECT 1 FROM config.config_markers WHERE name = 'relative_keys_v1') THEN RETURN;`.
   - **1 Lock** `config.config_values` in `SHARE ROW EXCLUSIVE` mode with the 027 bounded-retry loop (blocks writers, not readers; deliberately not `ACCESS EXCLUSIVE`).
   - **2 Classify** every row into `CREATE TEMP TABLE cls_296 ON COMMIT DROP`: `prefixed` = `left(key, length(namespace)+1) = namespace || '.'` (never `LIKE`), `rel` = the single-stripped key, scope = `(namespace, environment, COALESCE(user_id,''))`.
   - **3 Per-user parking** on the pre-state. **S1**: every still-present row that matches a `per-user-unread` row of **any** 041 run in `config.config_heal_report_041` (match on namespace, key, environment, user_id; no `run_at` filter) is parked. **(a)** a per-user **relative** row created after `max(run_at)` of 041 (or any, when the report table is empty) is parked if a global **prefixed** row exists, whether or not a global relative row exists. **(b)** a per-user **prefixed** row created after `max(run_at)` is parked if a global relative row exists and no global prefixed row exists. Otherwise a prefixed per-user row is renamed and a relative one is left alone. **Oracle**: a row selected by (a)/(b) that pre-dates `max(run_at)` and is not in a report row is `oracle-mismatch`. A parking candidate with `is_secret` is the violation `secret-parked-candidate`.
   - **4 Twin classification** per scope. Embed the allowlist verbatim between `-- allow_296:begin` and `-- allow_296:end` as `CREATE TEMP TABLE allow_296(namespace, key, environment, user_sha256, value_sha256) ON COMMIT DROP` (ship it **empty** in this step; Step 16 pastes the signed block). A tuple names the **loser** by stored spelling plus `value_sha256`; it is attached to a twin when its scope matches and its key is one of the twin's two spellings. Outcomes: no attached tuple → `uncovered-twin`; exactly one matching spelling **and** hash of the same member → that member loses; exactly one matching neither on both → `stale-signature`; more than one → `ambiguous-signature`. A tuple attached to no twin is **reported** `unmatched-signed-tuple`, never raised. A secret-class member of a twin is `secret-class-twin`; a key beginning `ns.ns.` is `double-prefix`.
   - **5 One RAISE before any write**: collect violations into temp `viol_296(rank, class, ns, key, env, per_user)`, one line per (ns, rel-key, env, scope) at its highest-precedence class: 1 `secret-class-twin`, 2 `secret-parked-candidate`, 3 `double-prefix`, 4 `oracle-mismatch`, 5 `ambiguous-signature`, 6 `stale-signature`, 7 `uncovered-twin`. Message `feature 296: <N> violation(s); nothing changed`, then lines `<class> <ns>/<rel-key>/<env>[ (per-user)]` ordered `ORDER BY rank, ns, key, env`. No value and no user id ever appear.
   - **6** `ALTER TABLE config.config_values DISABLE TRIGGER config_value_audit`.
   - **7 Snapshot** every row about to be touched (renamed, loser, parked) into `config_values_premigration_296` with secret-class `value_data`/`default_value` NULL and `snapshot_at = clock_timestamp()`, **before** any mutation.
   - **8 Delete losers and parked rows** in one statement `WITH d AS (DELETE … RETURNING) INSERT INTO config.config_audit` with `changed_at = clock_timestamp()` (`new_value NULL`; reasons `feature 296: twin loser` / `feature 296: parked per-user row in an unread spelling`); report `per-user-parked` rows (no value).
   - **9 Rename**, a **separate** statement: `UPDATE config.config_values SET key = substr(key, length(namespace)+2) … RETURNING` feeding one audit row per rename (`old_value = new_value = value_data`, NULL for secrets; reason `feature 296: renamed from <old>`). `updated_at`, `updated_by`, `value_encrypted` stay untouched (the cipher has no associated data, `src/crypto.ts:31-53`).
   - **10** `ENABLE TRIGGER config_value_audit`; assert no prefixed row remains.
   - **11 Marker**: `INSERT INTO config.config_markers(name,set_at,set_by) VALUES ('relative_keys_v1', now(), 'system:config-migration-044')`.
   - **12 Notify**: one `pg_notify('config_changed', json_build_object('namespace',…,'environment',…)::text)` per touched (namespace, environment), then `pg_notify('config_changed','{"marker":"relative_keys_v1"}')`.
   - Also insert `unmatched-signed-tuple` report rows for tuples attached to no twin.
5. `044…down.sql`: `DO $$ BEGIN RAISE EXCEPTION 'irreversible contract: feature 296 renamed config keys to namespace-relative'; END $$;`.
6. `dormantAlias.test.ts:109-116`: replace the `^04\d_` scan with: among all `^\d{3}_.*\.up\.sql` in `MIGRATIONS_DIR`, exactly one inserts into `config.config_markers`, and its first 5 lines carry `-- contract-of: services/xstockstrat-config/migrations/040_config_markers.up.sql`. Rename the test accordingly.

**Verification**:
```
cd /home/user/xstockstrat/services/xstockstrat-config
ls migrations/044_config_keys_relative.up.sql migrations/044_config_keys_relative.down.sql   # then read both: every action in .up that is irreversible is refused by .down
head -n 5 migrations/044_config_keys_relative.up.sql | grep -c '^-- contract-of: services/xstockstrat-config/migrations/040_config_markers.up.sql'   # → 1
grep -nE '^[[:space:]]*(BEGIN|COMMIT|ROLLBACK)[[:space:]]*;' migrations/044_config_keys_relative.up.sql   # → no output
pnpm exec tsc && node --test dist/__tests__/dormantAlias.test.js dist/__tests__/retiredPortfolioSnapshotInterval.test.js
```
(Offline; the real apply runs in Step 15's CI job and Step 16's rehearsal. Never start a database here.)

---

### Step 2 — migration: CHECK migration R+1 (`045_config_keys_relative_check`)

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/migrations/045_config_keys_relative_check.up.sql` — create
- `services/xstockstrat-config/migrations/045_config_keys_relative_check.down.sql` — create

**Reviewers**: DBA — migration numbering, up+down pair, index/constraint correctness, run-order compliance, xstockstrat-config owner — config key naming and secret handling, Security — both-secret gap twins resolved with audit values NULL, a mixed-class twin raises

**Codebase Evidence**:
- No CHECK on `key` exists; `config_values_key_relative_check` is free (`recon.md` Codebase Map, constraints are `config_values_value_type_check` `001:10`, `config_values_environment_check` `017`).
- Gap source: PRE_DEPLOY migrations run before the new config image (`.do/app.yaml:667-687`, `.do/app.dev.yaml:671-673`, `deploy/homelab/compose.yml:32-55`), and a previous-image server can still insert a prefixed row between R and R+1. The probe SELECT and the upsert INSERT are separate autocommit calls (`configServiceImpl.ts:778-782` vs `:856-869`), and the upsert stamps `updated_at = NOW()` and a non-empty author (`:738-742`).
- Migration-written rows carry `updated_by` NULL (001, 042 seeds) or `system:%` (041, 043).
- Idioms: same as Step 1 plus the ACCESS EXCLUSIVE lock loop (027 idiom; `ADD CONSTRAINT … CHECK` needs it).
- Design: `design.md` §4 (final rule, operator decision at the round-5 gate: newest `updated_at` wins).

**TDD**: `N/A (migration)`

**Covers**: —

**Instructions**:
1. No `contract-of`, no embedded data; idempotent; no top-level transaction statements. Actor `system:config-migration-045`.
2. One DO block: **lock** `config.config_values` `ACCESS EXCLUSIVE` (bounded retries, 027 idiom). **Classify** prefixed rows with the same predicate as R. A **gap twin** is a prefixed row P plus a relative row Rel in one scope.
3. **Violation before any write** (the only one): a gap twin where exactly one member `is_secret` (`P.is_secret <> Rel.is_secret`) → one RAISE `feature 296: <N> violation(s); nothing changed` + `mixed-class-gap-twin <ns>/<rel-key>/<env>`. A both-secret twin is resolved by the rule below with audit values NULL.
4. **Decide each gap twin, newest write wins**: if `P.updated_by IS NULL OR P.updated_by LIKE 'system:%'` → P loses, report `gap-twin-system-deleted`. Otherwise `P.updated_at >= Rel.updated_at` → P wins (ties to P): Rel deleted, P renamed onto Rel's key, report `gap-twin-p-wins`; else Rel wins: P deleted with audit, report `gap-twin-rel-won`.
5. **Snapshot** every loser and every to-be-renamed row into `config.config_values_premigration_296` (secret-class values NULL).
6. **Statement 1**: `WITH d AS (DELETE … RETURNING) INSERT INTO config.config_audit` for the losers (`changed_by 'system:config-migration-045'`, `old_value` the value or NULL for secrets, `new_value NULL`; reasons `feature 296: gap twin, superseded by newer write to <winner key>` / `feature 296: gap twin, migration-seeded prefixed row`), `changed_at = clock_timestamp()`.
7. `DISABLE TRIGGER config_value_audit`.
8. **Statement 2**, a separate `UPDATE`: rename every remaining prefixed row (winning P's and lone gap rows), one audit row per rename with `updated_at`/`updated_by` kept.
9. `ENABLE TRIGGER config_value_audit`; assert no prefixed row remains.
10. `ALTER TABLE config.config_values ADD CONSTRAINT config_values_key_relative_check CHECK (left(key, length(namespace)+1) <> namespace || '.')` only if absent (`pg_constraint` guard). A doubly-prefixed row fails here with 23514 (recovery path = data repair, `design.md` §3.4).
11. `pg_notify('config_changed', …)` per touched (namespace, environment).
12. `045…down.sql`: `ALTER TABLE config.config_values DROP CONSTRAINT IF EXISTS config_values_key_relative_check;`.

**Verification**:
```
cd /home/user/xstockstrat/services/xstockstrat-config
ls migrations/045_config_keys_relative_check.up.sql migrations/045_config_keys_relative_check.down.sql   # then read: .down drops exactly the constraint .up adds
head -n 5 migrations/045_config_keys_relative_check.up.sql | grep -c 'contract-of'   # → 0
grep -nE '^[[:space:]]*(BEGIN|COMMIT|ROLLBACK)[[:space:]]*;' migrations/045_config_keys_relative_check.up.sql   # → no output
pnpm exec tsc && node --test dist/__tests__/retiredPortfolioSnapshotInterval.test.js
```

---

### Step 3 — service: FR-1 server rejection and poller exception

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/grpc/configServiceImpl.ts` — modify

**Reviewers**: xstockstrat-config owner — key naming, environment/global-per-user scoping, secret encryption + redaction, WatchConfig stream stability, Security — `GetSecret` pre-check precedes the allow-list gate, no new path to plaintext

**Codebase Evidence**:
- Server `canonical` returns the **relative** key: `services/xstockstrat-config/src/grpc/authz.ts:96-99` (`key.startsWith(\`${namespace}.\`) ? key.slice(prefix.length) : key`); `altSpelling` `:102-105`. (The gate's own `canonical` at `scripts/check-config-wiring.mjs:664` does the opposite and returns the full name; do not conflate.)
- `setConfig` starts at `configServiceImpl.ts:680`; admin/internal-caller gate `:688-732`; the log literal `call.request?.key === 'platform.trading_state'` at `:709-712`; trading_state enum guard `:745` (already matches either spelling via `canonical`); `createKey` read at `:773`; write-tolerance probe `:774-790`, ambiguity message with stale text "must be healed first (feature 296)" at `:811-815`; `writeKey` `:818`; `23514`/`23505` → code 3 `:876-878`.
- Internal-caller grant `authz.ts:84-93` (`trading-reconciliation-poller`, namespace `platform`, key `platform.trading_state`, `['REDUCE_ONLY','HALTED']`, no `peerSan`); `hasInternalCallerAuthority` matches on `canonical` both sides (`:111-126`), so a canonicalised key keeps the grant.
- `getSecret` at `:634`; allow-list check `hasSecretCallerAuthority` `:637`; callers already send relative keys (`services/xstockstrat-marketdata/cmd/server/main.go:79,293`, `services/xstockstrat-ingest/app/config/watcher.py:22-24`, `services/xstockstrat-agent/app/tools.py:375`, `services/xstockstrat-ui` `useSignalSourceMutations.ts:23`; design-verified).
- Bounds registry is keyed `${namespace}.${canonical(...)}` (`:113,184`), so it needs no change.
- The only production `SetConfig` caller sending a prefixed key is the trading poller, `services/xstockstrat-trading/internal/service/trading.go:2263-2271`, deliberately full-dotted per feature 189 and rewritten by 304; the previous image sends it during rollout.

**Lands with**: `Step 4`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Add one module-level helper `prefixedKeyRejection(namespace, key): string | null` (returns the message `config key must be namespace-relative: send "${rel}" with namespace "${namespace}" (got "${key}")` when both are non-empty strings and `canonical(namespace, key) !== key`, else `null`). In `setConfig`, as the **first** statement (before the `userId`/authz block at `:688`), reject with `callback({ code: 3, message }); return;` when the helper returns a message — **except** the poller exception.
2. **Poller exception** (canonicalise in place, `SetConfig` only): only when all hold: `first(call.metadata, HEADER_INTERNAL_CALLER) === 'trading-reconciliation-poller'`; `namespace === 'platform'`; `canonical(namespace, key) === 'trading_state'`; the request is global scope (`requestUserId(call.request) === ''`); `createKey` is falsy (`call.request.createKey ?? call.request.create_key ?? false`). Then set `call.request.key = canonical(...)` and `log.warn('SetConfig canonicalised internal-caller key', { internalCaller, namespace, from: key, to: rel, targetState: <the closed enum value, truncated> })`. All later code (grant check, enum guard, bounds, probe, write) then sees the relative key. `create_key` and `GetSecret` get **no** exception. The `ACTIVE` write is still denied by the unchanged grant (`allowedTargetValues`), so `@AC-54` @feature-294 holds.
3. In `getSecret`, before the `hasSecretCallerAuthority` call at `:637`, call the same helper and answer `callback({ code: 3, message })`.
4. `:709-712`: replace the literal with `call.request?.namespace === 'platform' && canonical('platform', call.request?.key ?? '') === 'trading_state'`. **Load-bearing, not cosmetic**: the poller exception rewrites `call.request.key` in place before this line runs, so the old literal comparison `=== 'platform.trading_state'` is false and the `@AC-54` test (`setConfigAuthz.test.ts:179`, the poller denied `ACTIVE`) fails with `d.targetState` undefined (measured, empirical run 2026-11-08).
5. `:813`: replace the stale "must be healed first (feature 296)" with text that no longer points at an unfinished feature (the path stays as dead code until 306), e.g. `…both exist in namespace … ; delete one (the key CHECK from feature 296 forbids the prefixed row)`.
6. Do **not** touch the write-tolerance probe (`:774-818`), `lookupScalarBounds`, or `authz.ts`.

**Verification**:
```
cd /home/user/xstockstrat/services/xstockstrat-config
grep -c "must be namespace-relative" src/grpc/configServiceImpl.ts   # → 1 (the helper)
grep -c "prefixedKeyRejection" src/grpc/configServiceImpl.ts   # → 3 (definition, setConfig, getSecret)
grep -n "SetConfig canonicalised internal-caller key" src/grpc/configServiceImpl.ts   # → 1 hit
pnpm run lint
```
(Step 3 cannot pass its own suite alone: the existing prefixed-key tests go red with it, so the union Verification with Step 4 runs the suite — this is the atomic unit's reason.)

---

### Step 4 — test: config server tests for FR-1, the poller exception and the alias snapshot

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/__tests__/setConfigScalarBounds.test.ts` — modify
- `services/xstockstrat-config/src/__tests__/setConfigSpelling.test.ts` — modify
- `services/xstockstrat-config/src/__tests__/setConfigAuthz.test.ts` — modify
- `services/xstockstrat-config/src/__tests__/tradingStateValidation.test.ts` — modify
- `services/xstockstrat-config/src/__tests__/internalCallerSetConfig.test.ts` — modify
- `services/xstockstrat-config/src/__tests__/configServiceImpl.test.ts` — modify
- `services/xstockstrat-config/src/__tests__/scopeResolution.test.ts` — modify (`:93` sends a real prefixed `setConfig`; it goes red with Step 3)
- `services/xstockstrat-config/src/__tests__/dormantAlias.test.ts` — modify (new `@AC-3` / `@AC-4` alias snapshot tests)

**Reviewers**: xstockstrat-config owner — config key naming, scoping, secret handling

**Codebase Evidence**:
- Regex hit counts re-grepped at spec time (prefixed `ns.key` literals in `src/__tests__`): `setConfigScalarBounds` 32, `setConfigSpelling` 20, `configListenerTelemetry` 10, `configWatcher` 8, `listKeysUpdatedAt` 7, `watchConfigWireZero` 6, `internalCallerAuthz` 5, `telemetryAllowlist` 4, `setConfigAuthz` 3, `configServiceImpl` 3, `tradingStateValidation` 2, then singles. Of these only the files above send the prefixed key **through `setConfig`/`getSecret`** (cycle 2 found `scopeResolution.test.ts:90-105`, which `design.md` §8 had listed as unchanged: it sends `marketdata.fmp.enabled` through a real `client.setConfig` and asserts `writeParams`); the others hold mocked stored rows or are metric names (`configListenerTelemetry`, `telemetryAllowlist`: confirm by `grep -n` that none sends a request; `listKeysUpdatedAt`, `listKeysCurrentValue`, `configValueRoundtrip`, `watchConfigWireZero`, `contentVersion`, `readUserBinding`, `changeFeedLiveness`, `listKeysWire`, `internalCallerAuthz`, `configWatcher`, `secretCallerAuthz` (a pure-function suite with no server harness) and the five seed-migration tests stay unchanged; the new `GetSecret` test lives in `configServiceImpl.test.ts`, Instruction 5).
- `setConfigScalarBounds.test.ts`: readiness_materializer block `:151-175` and opportunity block `:208-246` send full-dotted keys on purpose (comment `:151-155`); `TIMEOUT_KEY_FORMS` `:266-302` pairs relative and prefixed rows for every key.
- `setConfigSpelling.test.ts`: `@AC-1` `:154` (bare-spelling write updates the stored prefixed row), `@AC-25` `:196`, `@AC-31` `:225,238`, `@AC-34` `:265,280`, `@AC-35` `:306`.
- `internalCallerSetConfig.test.ts:60-70` sends `key: 'platform.trading_state'` (stays prefixed: it is the previous-image poller). `setConfigAuthz.test.ts:179` stays prefixed (`@AC-54` poller denied for `ACTIVE`). `tradingStateValidation.test.ts:74`.
- Alias tests precedent: `dormantAlias.test.ts:100-107` (stored values and their `altSpelling` in a snapshot).
- Signed CHANGE list: `design.md` "Business Rules Touched" (295 `@AC-1/34/25/...`); C-13: the fake-pool and request helpers already live in each test file (single consumer each), no new fixture home is created.

**Lands with**: `Step 3`

**TDD**: `red-green required`

**Covers**: `AC-1, AC-3, AC-4, AC-5`

**Instructions**:
1. **Red first**: add the new tests below, run them against the pre-Step-3 tree (they fail: prefixed keys are accepted today), then make the Step 3 change. **Measured blast radius** (empirical run on a worktree, 2026-11-08): baseline 356/356 green; with only Step 3's pre-check applied, **84 existing tests go red**, all in this step's Files — `setConfigScalarBounds` 47 (RM_* 3, OPP_* 3, `TIMEOUT_KEY_FORMS` 36, `:325-331` 1, ENGINE_* 4), `setConfigAuthz` 18 (17 once Step 3 Instruction 4 lands), `setConfigSpelling` 7 (`@AC-31` 4, `@AC-35` 3), `tradingStateValidation` 5, `configServiceImpl` 4, `internalCallerSetConfig` 2, `scopeResolution` 1 — and each maps to an Instruction below; `dormantAlias` has none. Coverage stays at 90.5% lines. Two precision notes: `configServiceImpl.test.ts:647` stays green after Step 3 only vacuously (it asserts `code === 3` and no query, which the pre-check satisfies), so its respell is for meaning, not red-driven; and `setConfigSpelling` `@AC-1` (`:154`), `@AC-25` (`:196`, `:215`) and `@AC-34` (`:265`, `:280`) already send relative request keys and pass before and after, so their rewrites are new coverage and "red first" applies to the new tests only.
2. `setConfigScalarBounds.test.ts`: respell the readiness_materializer (`RM_*`) and opportunity (`OPP_*`) request keys relative (`readiness_materializer.refresh_hour_utc`, …) and rewrite the `:151-155` comment to say the stored key is relative; in `TIMEOUT_KEY_FORMS` delete the prefixed rows, and add one test that every former prefixed form (derive them as `${ns}.${key}` from the relative rows) gets `INVALID_ARGUMENT` with `insertQuery() === undefined` and **no** bounds-message text (the pre-check fires before bounds). Also respell the remaining prefixed requests in this file: `:325-331` (`portfolio.watchlist.signal_prune_interval_seconds`, namespace `portfolio`) → `watchlist.signal_prune_interval_seconds`, and `ENGINE_BUDGET` / `ENGINE_INTERVAL` (`:333-334`, used by the four tests `:336-370`) → `engine.max_strategies_per_cycle` / `engine.eval_interval_seconds` (namespace `analysis`); without this those tests receive `INVALID_ARGUMENT` from the pre-check and fail.
3. `setConfigSpelling.test.ts`: `@AC-1` is rewritten (signed CHANGE): a prefixed `marketdata`/`marketdata.backfill.batch_size` write returns `INVALID_ARGUMENT` with message matching `/must be namespace-relative: send "backfill.batch_size" with namespace "marketdata"/`, no INSERT, no `pool.query` (assert `queries.length === 0`, proving it ran before any authz or DB call); and the **relative** write against a relative stored row succeeds, globally and per-user. `@AC-25/@AC-31/@AC-34` request keys respelled relative (stored-row fixtures that model a twin for `@AC-34` keep both rows — the probe path is dead code but stays covered). New tests: `create_key` with a prefixed key → `INVALID_ARGUMENT` (**AC-1**); the poller exception: header `trading-reconciliation-poller`, namespace `platform`, key `platform.trading_state`, value `REDUCE_ONLY`, no createKey → success, INSERT param `[1] === 'trading_state'`, and a WARN `SetConfig canonicalised internal-caller key` captured through the repo's logger spy pattern (**AC-5**); the same caller with `ACTIVE` → `PERMISSION_DENIED` (**AC-5**, `@AC-54` @feature-294); the same caller with `createKey: true` or a per-user `user_id` or another namespace → `INVALID_ARGUMENT` (no exception).
4. `setConfigAuthz.test.ts`: `:144` → `log_level`, `:238` → `push.min_severity`; `:179` unchanged. `tradingStateValidation.test.ts:74` → `trading_state`. `configServiceImpl.test.ts`: `:555` and `:647` respelled relative, `:119` (mocked stored row) unchanged. `internalCallerSetConfig.test.ts`: request `:71` unchanged; add assertions that the INSERT param `[1] === 'trading_state'` and the WARN is logged.
5. `configServiceImpl.test.ts`: in the `ConfigServiceImpl.getSecret` describe block (harness `secretCall`, `getSecret`, `poolWith` at `:674-700`) add `GetSecret` for namespace `marketdata`, key `marketdata.alpaca.api_key` by an allow-listed caller → `INVALID_ARGUMENT` before the allow-list outcome (assert it is not `PERMISSION_DENIED`) (**AC-1**). Do not put it in `secretCallerAuthz.test.ts` (no harness there; would duplicate one, C-13/C-18).
6. `scopeResolution.test.ts:93`: respell the request key to `fmp.enabled` (assertions on `writeParams[8]`/`[9]` unchanged). `internalCallerSetConfig.test.ts`: the two denial tests that use the default prefixed key at `:71` with a **non-poller** caller — `rejects an unlisted internal-caller id` (`:116-122`) and `rejects a call with neither admin scope nor an internal-caller header` (`:124-130`) — now get `INVALID_ARGUMENT` from the pre-check before authz; override `key: 'trading_state'` in those two calls so they still reach the authz gate and assert `PERMISSION_DENIED` (the poller tests keep the prefixed `platform.trading_state`: the exception path). `setConfigSpelling.test.ts`: `@AC-35` (`:304-314`) sends prefixed `marketdata.backfill.batch_size` and asserts `inserts().length === 1` — respell the request to `backfill.batch_size` and the stored row to the relative key; `@AC-31` `:225-233` and its `[key, bare]` loop `:235-262` — drop the prefixed variants (covered by the "every former prefixed form gets INVALID_ARGUMENT" test of Instruction 2), keep the relative ones.
7. `dormantAlias.test.ts`: add `@AC-3` (marker active; stored `indicators`/`sandbox.timeout_ms` = 15000; the namespace snapshot carries `indicators.sandbox.timeout_ms` = 15000 as the alias, so a previous-image getter resolves 15000, not 5000) and `@AC-4` (stored `trading`/`risk.bracket_orders_enabled` = false; the snapshot carries `trading.risk.bracket_orders_enabled` = false). Reuse the file's `makePool` / `snapshotFor` (`:29-81`) by parameterising them (they bake in the module constant `STORED` today); do not copy them (the lines `:100-107` are assertions, not helpers).

**Verification**:
```
cd /home/user/xstockstrat/services/xstockstrat-config
pnpm run lint
pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40
grep -c "AC-5\|AC-3\|AC-4\|AC-1" src/__tests__/setConfigSpelling.test.ts src/__tests__/dormantAlias.test.ts src/__tests__/configServiceImpl.test.ts   # each ≥ 1
```
Confirm ≥ 40% lines (config's `--lines 40` in the script alone is not enforced, hence the explicit `c8 check-coverage`).

---

### Step 5 — service: config-ui displays the FQN and writes relative keys

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/configFqn.ts` — create
- `services/xstockstrat-ui/src/app/config-ui/[namespace]/NamespaceEditor.tsx` — modify
- `services/xstockstrat-ui/src/app/config-ui/audit/page.tsx` — modify

**Reviewers**: xstockstrat-ui owner — config mutation safety, Connect-RPC call safety, environment scope correctness, no secret values rendered in UI

**Codebase Evidence**:
- `KeyCell` renders the raw key: `NamespaceEditor.tsx:63-67` (`<span>{k.key}</span>`). Save path sends the listed key unchanged: `:271-279` (`setConfigMutate({ namespace, key, … })`) and `handleSave(k.key)` `:170`; the key lookup `keys.find((kk) => kk.key === key)` `:251`. So a relative `ListKeys` key round-trips with no change.
- The reason guard compares the full-dotted key: `:264` (`key === 'platform.trading_state'`) and its message `:265`.
- `data-testid={\`actions-${k.key}\`}` at `:155`; `grep -rn "actions-" services/xstockstrat-ui/e2e/config-ui` → no hit (only trader/insights specs use `actions-<id>`), so the design's note that this id "changes" has no spec dependency; **leave it keyed on the stored key** (minimum footprint).
- Audit page joins `${e.namespace}.${e.key}` in `accessorFn` and renders namespace + `.` + key as separate spans: `audit/page.tsx:36-47`; old `config_audit` rows keep prefixed keys (no FK), so the join would show `marketdata.marketdata.…`.
- `src/lib` hosts namespace helpers (`configNamespaces.ts`, test `configNamespaces.test.ts`), vitest `test:unit` (`package.json`).
- `ListKeys` stays server-side relative; no proto change. Trader consumer reads (`trader/positions/page.tsx:129-130`, `e2e/mock-backend.ts:1547`) are 304's.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. `src/lib/configFqn.ts`: `export function configFqn(namespace: string, key: string): string { return key.startsWith(\`${namespace}.\`) ? key : \`${namespace}.${key}\`; }` (tolerant of both spellings so an old prefixed audit row or an un-migrated database still renders once).
2. `NamespaceEditor.tsx` `KeyCell`: render `configFqn(namespace, k.key)`. `KeyCell` (`:62`) is a TanStack column cell renderer (`RowProps = CellContext<ConfigKeyMeta, unknown>`, `:60`) referenced as `cell: KeyCell` in the module-level `COLUMNS` (`:192-197`, whose comment requires module scope, AC-11), so it has **no JSX call site and receives only the cell context**; `namespace` (from `Props`, `:222-229`) is not in its scope. Use the file's existing `EditContext` (`:50-58`, provider at `:315`): add `namespace: string` to the `EditState` type and to the `editState` value given to the provider, and have `KeyCell` read it with `useEditContext()`. Leave `data-testid`, `editingKey`, and `handleSave(k.key)` on the stored (relative) key.
3. `:264`: change the guard to `configFqn(namespace, key) === 'platform.trading_state' && !editReason.trim()` (works for both spellings; the message at `:265` is unchanged).
4. `audit/page.tsx`: `accessorFn: (e) => configFqn(e.namespace, e.key)`; the cell renders the namespace span and then the remainder `configFqn(...).slice(e.namespace.length + 1)`, so an old prefixed audit row no longer renders `ns.ns.key`.
5. No change to any BFF route, proto, or `ConfigKeyMeta`.

**Verification**:
```
cd /home/user/xstockstrat/services/xstockstrat-ui
pnpm run lint && pnpm exec tsc --noEmit
grep -n "configFqn" src/app/config-ui/\[namespace\]/NamespaceEditor.tsx src/app/config-ui/audit/page.tsx src/lib/configFqn.ts
pnpm run lint:dup
```

---

### Step 6 — test: config-ui unit and e2e coverage for the FQN display

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/configFqn.test.ts` — create
- `services/xstockstrat-ui/e2e/fixtures/configKeys.ts` — modify
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify (rows 51-53)
- `services/xstockstrat-ui/e2e/config-ui/api-smoke.spec.ts` — modify
- `services/xstockstrat-ui/e2e/config-ui/namespace-editor-rows.spec.ts` — modify
- `services/xstockstrat-ui/e2e/config-ui/namespace-nav.spec.ts` — modify (**conditional**: only if the e2e run reports a fixture-key/FQN mismatch; no edit expected)
- `services/xstockstrat-ui/e2e/config-ui/reason-capture.spec.ts` — modify (conditional, same rule)
- `services/xstockstrat-ui/e2e/config-ui/value-persists-after-save.spec.ts` — modify (conditional, same rule)
- `services/xstockstrat-ui/e2e/config-ui/secret-editing.spec.ts` — modify (conditional, same rule)
- `services/xstockstrat-ui/e2e/config-ui/edit-focus.spec.ts` — modify (conditional, same rule)
- `services/xstockstrat-ui/e2e/config-ui/audit.spec.ts` — modify (conditional, same rule)

**Reviewers**: xstockstrat-ui owner — config mutation safety, Connect-RPC call safety

**Codebase Evidence**:
- C-12 home: `e2e/fixtures/configKeys.ts` exports `setConfigPayload` (`:27`, default `key: 'platform.log_level'`), `CONFIG_KEY_FIXTURES` (`:53`), `CONFIG_KEY_STUB_ROWS` (`:173`); `INVENTORY.md` rows 51-53 register them.
- Specs match rows by FQN text and keep matching a composed FQN: `namespace-nav.spec.ts:23,66,84` (`hasText: 'platform.log_level'`), `reason-capture.spec.ts:14,35,55`, `value-persists-after-save.spec.ts:32,67,80`, `namespace-editor-rows.spec.ts:16,29,41,65,97,132` (`hasText: <fixture>.key`), `secret-editing.spec.ts:26`, `audit.spec.ts:57` (`hasText: \`${entry.namespace}.${entry.key}\``), `edit-focus.spec.ts:18`.
- Mock backend `ConfigService.listKeys` spreads the fixtures and computes `currentValue` from a `configValueOverrides` map that `setConfig` writes (`INVENTORY.md:52`), so a relative fixture key round-trips.
- `mock-backend.ts:1547` serves `platform.trading_state` to the trader positions reader (304-owned): **leave it**.
- Raw ListKeys JSON asserted in `api-smoke.spec.ts` (design §8: 8 hits).

**TDD**: `red-green required`

**Covers**: `AC-10`

**Instructions**:
1. Red first: write `configFqn.test.ts` (vitest, node env): relative → `ns.key`; already-prefixed → unchanged (no `ns.ns.key`); nested relative keys; run it with `src/lib/configFqn.ts` temporarily absent (stash Step 5's file) → fails (import missing), then restore.
2. `configKeys.ts`: respell every `CONFIG_KEY_FIXTURES` and `CONFIG_KEY_STUB_ROWS` `key` relative (`log_level`, `trading_state`, `maintenance_mode`, `scoring.signal_decay_half_life_hours`, …) so `ListKeys` JSON is relative and the UI composes the FQN. These rows carry **no `namespace` field** (`configKeys.ts:53-150`) and the mock `listKeys` (`mock-backend.ts:1490-1496`) returns every fixture for every namespace page, so a row renders `<open page namespace>.<key>`: correct only when the spec opens the matching namespace page — the conditional-spec rule below covers it; `setConfigPayload` default key `log_level`. Keep descriptions, bounds, `updatedAt` values. Update the JSDoc and `INVENTORY.md` rows 51-53 (relative keys; FQN is composed client-side, feature 296).
3. `api-smoke.spec.ts` (raw ListKeys JSON and `setConfigPayload` calls): assert the response keys are relative and a saved payload carries the relative key.
4. `namespace-editor-rows.spec.ts`: add a scenario for `AC-10`: open `/config-ui/marketdata`, the row text is `marketdata.backfill.batch_size`; edit and save; capture the `SetConfig` request body (use the existing request-capture pattern in `value-persists-after-save.spec.ts` / `reason-capture.spec.ts`) and assert `key === 'backfill.batch_size'` and `namespace === 'marketdata'`.
5. For specs that use `hasText` with a literal FQN (`platform.log_level` etc.), no edit is needed because the composed FQN is identical; verify each by running them. Specs that read `fixture.key` into `hasText` must instead use the FQN (`\`${ns}.${fixture.key}\``): fix every one the run reports. Only those spec files that the run reports are edited (they are listed above as conditional **Files**); a spec that passes is not touched.
6. A raw one-off key literal inside a spec stays inline (C-12 scenario one-off); anything used by ≥ 2 specs lives in `configKeys.ts`.

**Verification**:
```
cd /home/user/xstockstrat/services/xstockstrat-ui
pnpm run test:coverage   # vitest; 40% lines/functions/statements on src/lib/** (vitest.config.ts:26-32), configFqn.ts is a new src/lib file
pnpm run lint && pnpm exec tsc --noEmit && pnpm run lint:dup
pnpm run test:e2e -- e2e/config-ui
grep -n "from '../fixtures\|from './fixtures\|helpers/auth" e2e/config-ui/namespace-editor-rows.spec.ts e2e/config-ui/api-smoke.spec.ts
grep -n "log_level" e2e/fixtures/INVENTORY.md
```
Confirm `INVENTORY.md` rows 51-53 mention relative keys. (xstockstrat-ui carries a 40% vitest threshold on `src/lib/**`, enforced by `test:coverage` above; the Playwright run is the check for the e2e specs.)

---

### Step 7 — service: agent FQN display, alias filter and relative `set_config` docs

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/tools.py` — modify

**Reviewers**: xstockstrat-agent owner — MCP tool contract stability and `docs/runbooks/mcp-tools.md` parity, no secret values in tool output

**Codebase Evidence**:
- `get_config` `tools.py:1776-1805` returns `client.get_config(...)` and redacts on the `is_secret` flag (`:1799-1802`); `list_config_keys` `:1808-1831` returns `client.list_config_keys` unchanged; `set_config` `:1834-1900` forwards `namespace`/`key` verbatim; docstring example `key: the config key, e.g. 'marketdata.fmp.enabled'` at `:1846`.
- `client.list_config_keys` (`app/client.py:2248-2276`) builds `keys[]` with `key, description, default_value, is_secret, consuming_service`; `get_config` is `client.py:2217`. No FQN join/split and no FQN dedupe exists in the agent today (**Not found**; net-new, `recon.md`).
- With the marker active, the server's `GetConfig` snapshot carries every key twice, the stored spelling and its alias (`withLegacyAliases`, `configServiceImpl.ts:213-221`).
- Backend `INVALID_ARGUMENT` text passes through (`_grpc_error_message` `tools.py` / `recon.md`).
- Parity doc: `docs/runbooks/mcp-tools.md:1204` (Step 13). Tool names, parameters and counts are unchanged, so the six tool-count inventory surfaces need no edit.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. `list_config_keys`: after the gRPC call, add `fqn` to each key dict: `key if key.startswith(f"{namespace}.") else f"{namespace}.{key}"`; keep `key` (the relative value `set_config` must be given). Update the docstring `Returns` line (`key, fqn, description, default_value, is_secret, consuming_service`) and say `key` is what `set_config` takes.
2. `get_config`: after the secret redaction loop, drop alias entries: an entry whose map key starts with `f"{namespace}."` **and whose relative twin (the key with that prefix removed) is also present in `values`**. (Refinement of `design.md` §5, which drops any `${ns}.`-prefixed entry: under the CHECK the two are identical, but the twin guard keeps `get_config` complete against an un-migrated database where every stored key is still prefixed. Flagged for the review gate.) Add one docstring sentence: keys are returned as stored (namespace-relative).
3. `set_config` docstring `:1846`: example becomes `'fmp.enabled'` with namespace `'marketdata'`, and a sentence: "send the namespace-relative key exactly as `list_config_keys` returns it in `key`; a key that begins with the namespace is rejected with INVALID_ARGUMENT".
4. No change to `_write_source_bearer` (`:371-395`, already relative `mcp_credential.<uuid>`).

**Verification**:
```
cd /home/user/xstockstrat/services/xstockstrat-agent
ruff check . && ruff format --check .
grep -n "fqn" app/tools.py
```

---

### Step 8 — test: agent tests for FQN display and the alias filter

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_config_tools.py` — modify

**Reviewers**: xstockstrat-agent owner — MCP tool contract stability

**Codebase Evidence**:
- `TestGetConfigRedaction.test_redacts_on_the_flag_not_the_key_name` builds a backend dict with prefixed value keys `marketdata.vendor.token`, `marketdata.fmp.enabled` (`tests/test_config_tools.py:56-81`) — the twin guard (Step 7) keeps these prefixed entries because their relative twins are absent, so the test stays green either way; respell them relative anyway so the test models the migrated database.
- Request-key literals sent through `set_config`: `:107,114` (`marketdata.alpaca.api_key`), `:129,147,165,247` (`marketdata.fmp.enabled`), `:230` (`marketdata.fmp.new_knob`, `create_key=True` `:234`), `:443` (`notify.push.min_severity`); `:287`/`:293` are the one-off `key="k"`.
- Server-side seam: `_make_server()` and `_tool_fn(server, name)` are the file's helpers (`:25,31`); patching `client.get_config` / `client.list_config_keys` with `AsyncMock` is the established pattern.
- C-13: Python canonical home is `tests/conftest.py`; the backend dicts are single-consumer inline literals in this file, which is compliant.

**TDD**: `red-green required`

**Covers**: `AC-10`

**Instructions**:
1. Red first: add the new tests, run them before Step 7's change (fail), then confirm green.
2. Respell the literals listed above to relative keys and the `get_config` backend dict to relative value keys (`vendor.token`, `fmp.enabled`); the redaction assertion becomes `result["values"]["vendor.token"]["value"] == "[redacted]"`.
3. New tests: (a) `list_config_keys` returns `fqn == "marketdata.backfill.batch_size"` and `key == "backfill.batch_size"` for a relative key, and does not double an already-prefixed legacy key (`fqn` equals the key); (b) `get_config` with a backend dict holding `backfill.batch_size` **and** its alias `marketdata.backfill.batch_size` returns only the relative entry (**AC-10**); (c) a backend dict holding only a prefixed entry (un-migrated database) keeps it (twin guard); (d) `set_config` forwards `key="backfill.batch_size"`, `namespace="marketdata"` unchanged to `client.set_config` (**AC-10**), and a backend `INVALID_ARGUMENT` detail "must be namespace-relative" is surfaced in the raised `RuntimeError`.
4. The other 15 `tests/` files' regex hits are not config-key literals (design §8): re-run `grep -rn "'[a-z]*\.[a-z_]*\.[a-z_.]*'" tests | grep -i config` and confirm none sends a config key before declaring done; any real consumer read belongs to 304.

**Verification**:
```
cd /home/user/xstockstrat/services/xstockstrat-agent
ruff check . && ruff format --check .
pytest tests/test_config_tools.py -q
pytest --cov=app --cov-fail-under=40 -q
grep -n "conftest\|from .conftest" tests/test_config_tools.py
```
(Python services carry the ≥40% CI threshold from the root `CLAUDE.md` § CI/CD Overview; the explicit `--cov-fail-under=40` run is the full suite.)

---

### Step 9 — service: wiring gate `prefixed-read` kind, narrow hoist, ownership

**Status**: `pending`
**Service**: `scripts/` (repo tooling for `xstockstrat-config`)
**Files**:
- `scripts/check-config-wiring.mjs` — modify
- `scripts/config-wiring.json` — modify (the 5 `seeded-unread` entries respelled relative and re-owned; the generated `prefixed-read` entries come in Step 18)

**Reviewers**: xstockstrat-config owner — config key naming and wiring discipline (the registry has no owner for root tooling)

**Codebase Evidence**:
- `BASELINE_KINDS` `check-config-wiring.mjs:169`; `OWNER_RE` `:170` (accepts `feature <N>`); `validateState` `:176-203`; `ROW_KINDS` `:530`; `join` `:579-648` with `alt`/`partnerOf` `:606-607` and the seeded loop `:610-619`, `secretIds`/`excluded` `:620-622`, the reads loop `:623-629`, row checks `:634-649`; `findingLine` `:654-659` (non-row, non-`form-mismatch` kinds print `file:key:kind`); gate `canonical` `:664` returns the full name; `GATED_UNLESS_BASELINED` `:688`; `ratchet` `:695-709`; `membership` `:716-733` with the `feature 296` owner regex at `:718` and comment `:716`; comment `:578`; `stepTime` `:784-795`; `--final` selection `:835-837`.
- Baseline today: `scripts/config-wiring.json:5-42`: five `seeded-unread` entries owned by `feature 296` (`ledger/stream.notify_enabled`, `marketdata/marketdata.alpaca.paper`, `platform/platform.log_level`, `trading/trading.risk.daily_loss_limit`, `analysis/analysis.opportunity.sparkline_bars`) and one `read-unseeded` `trading/trading.broker.paper` owned by a defect.
- Ownership after 296 (design §1): `prefixed-read` → `feature 304`; `seeded-unread` ledger `stream.notify_enabled`, analysis `opportunity.sparkline_bars`, marketdata `alpaca.paper` → `feature 305`; `platform/log_level`, `trading/risk.daily_loss_limit` → `feature 306`; `read-unseeded` `trading.broker.paper` keeps its defect owner.
- Lesson applied: a fix to the join must be checked against the raw `--final --json` findings of the merge-base, not the baseline file (`fails.md` 2026-11-02 filter-otc-symbols), and any strict-model change lists the fixture-driven tests it reddens (`fails.md` 2026-11-06 fix-config-keys-drift) — Step 10 lists them.

**Lands with**: `Step 10`

**TDD**: `red-green required`

**Covers**: —

**Instructions** (`design.md` §6; implement exactly):
1. Export `const PREFIXED_READ_OWNER = 'feature 304'`. Add `'prefixed-read'` to `BASELINE_KINDS`. In `validateState`, a `prefixed-read` entry whose `owner !== PREFIXED_READ_OWNER` is a schema error (exit 2). Do **not** add it to `ROW_KINDS` or `GATED_UNLESS_BASELINED`.
2. Replace the seeded loop (`:610-619`) with the narrow hoist:
   ```
   const relSeed = !s.key.startsWith(`${s.namespace}.`)
   for (const env of s.envs) cover(nk(s.namespace, s.key), env)
   if (relSeed) for (const env of s.envs) cover(nk(s.namespace, `${s.namespace}.${s.key}`), env)
   if (byKey.has(nk(s.namespace, s.key))) continue
   const readKey = partnerOf(s.namespace, s.key)
   if (readKey === null) findings.push({ kind: 'seeded-unread', … })
   else if (!relSeed) { for (const env of s.envs) cover(nk(s.namespace, readKey), env); findings.push({ kind: 'form-mismatch', … }) }
   ```
   The hoist covers only `ns.key` for a **relative** seed (a prefixed seed with a relative read must stay visible: before R the alias is dormant, `configServiceImpl.ts:195-197`).
3. In the reads loop, for each `[id, e]`: when `e.key.startsWith(\`${e.namespace}.\`)` **and** `seeded.has(nk(e.namespace, e.key.slice(e.namespace.length + 1)))` **and** `!excluded(e.namespace, e.key)`, push `{ kind: 'prefixed-read', namespace: e.namespace, key: e.key, file: e.file }` (one per namespace/key; `e.file` is already the smallest reader file). **Emit it before the existing `continue` at `:625`** (`if ((allEnvs.length && !missing.length) || excluded(...)) continue`): a prefixed read covered by the narrow hoist is fully covered, so the `continue` would otherwise skip it. The existing `read-unseeded` logic is unchanged.
4. Row checks (`:634-649`): resolve `s = seeded.get(id) ?? seeded.get(nk(e.namespace, alt(e.namespace, e.key)))`, and build `catalogIds`/`flaggedIds` under **both** spellings, so a prefixed reader of a relative seed still gets type/default/metadata checks (catalog keys remain prefixed in `scripts/config-heal/catalog.tsv`).
5. `membership()`: owner filter → `/^feature (305|306)\b/`, and compare `nk(ns, canonical(ns, key))` on both sides (the dry-run rows keep the pre-rename spelling). Update the comments: `:578` → "Readers join rows by (namespace, key); a prefixed read also matches its relative seed (narrow hoist), and checks beyond presence apply to catalog-read rows only."; `:716` → "Every feature-305/306-owned seeded-unread entry must be an `unread-no-partner` row of the committed fresh dry-run."
6. `scripts/config-wiring.json`: respell the five `seeded-unread` entries relative (`marketdata`/`alpaca.paper`, `platform`/`log_level`, `trading`/`risk.daily_loss_limit`, `analysis`/`opportunity.sparkline_bars`; `ledger`/`stream.notify_enabled` already is) and set owners `feature 305` (ledger, analysis, marketdata) and `feature 306` (platform, trading). Do not touch the defect-owned `read-unseeded` entry. The entries without a `file` field keep `sameId` semantics.
7. Do **not** change the doc-check constants here (Step 11).

**Verification**:
```
cd /home/user/xstockstrat
node --check scripts/check-config-wiring.mjs
node --test --test-name-pattern='^(?!baseline [12] )' scripts/config-wiring.test.mjs
grep -n "prefixed-read\|PREFIXED_READ_OWNER" scripts/check-config-wiring.mjs
```

---

### Step 10 — test: gate tests and fixtures for `prefixed-read`

**Status**: `pending`
**Service**: `scripts/` (repo tooling for `xstockstrat-config`)
**Files**:
- `scripts/config-wiring.test.mjs` — modify
- `scripts/config-wiring-fixtures/join/prefixed-read/scripts/config-wiring.json` — create
- `scripts/config-wiring-fixtures/join/prefixed-read/scripts/config-wiring-stored.json` — create
- `scripts/config-wiring-fixtures/join/prefixed-read/services/xstockstrat-config/migrations/001_seed.up.sql` — create
- `scripts/config-wiring-fixtures/join/prefixed-read/services/xstockstrat-ledger/src/reader_a.ts` — create (reads `export.max_window_days`)
- `scripts/config-wiring-fixtures/join/prefixed-read/services/xstockstrat-ledger/src/reader_b.ts` — create (reads `ledger.export.max_window_days`)
- `scripts/config-wiring-fixtures/join/prefixed-read/services/xstockstrat-ledger/src/reader_c.ts` — create (the case (d) readers: relative `export.enabled` and, in a separate variant, a second prefixed `ledger.export.enabled`; its namespace attribution comes from the fixture's `registry.receivers` entry, see Instruction 3c)
- `scripts/config-wiring-fixtures/join/prefixed-read/scripts/config-heal/catalog.tsv` — create (one prefix-catalog row for case 6b; `loadCatalog` reads this path and only `gate/emit` has one today)
- `scripts/config-wiring-fixtures/join/mismatch/scripts/config-wiring-stored.json` — modify only if the retitled `join 1` needs it (read the file first; none is expected)
- `scripts/config-wiring-fixtures/join/mismatch/services/xstockstrat-ingest/app/mcp_loop.py` — modify only if `join 1` line 2 needs a different reader (none expected)
- `scripts/config-wiring-fixtures/gate/membership/scripts/config-wiring.json` — modify (owner `feature 305`; `gate/membership/scripts/config-heal/dryrun-fresh.tsv` and `config-wiring-stored.json` are read-only inputs)

**Reviewers**: xstockstrat-config owner — config key naming and wiring discipline

**Codebase Evidence**:
- Tests to edit (`scripts/config-wiring.test.mjs`): `join 1` `:157-164` (two `form-mismatch` lines; line 2 becomes `prefixed-read`), `ANALYSIS_MISMATCH` `:221` (`…/001_seed.up.sql:analysis/fundsignal.enabled->analysis.fundsignal.enabled:form-mismatch`, reused by `ratchet 4` `:304-307`, `ratchet 6` `:321-325`, `ratchet 9` `:362-367`), `ratchet 4` title `:304`, `gate 7` `:456-467` (fixture owner `feature 296`), `baseline 2` `:480-491` (kind list `['seeded-unread','read-unseeded','form-mismatch', ...NEW_KINDS]`, staleness assertion `:490`), `baseline 3` `:508-512` (`f.owner === 'feature 296'` filter), `RULE_SENTENCES` `:603` (Step 12).
- Unchanged by inspection (design §6): reader a-l; join 2-8; ratchet 1-3, 5, 7, 8; gate 1-6; skill 1-4; doc 2-5.
- Fixture machinery: `stage()` / `RECEIVERS` `:216-247`, `cli(root, …)`, `lines(r)`, `JOIN`/`SEEDS` constants `:150-155`.
- Per-case expectations (design §6 table): case 3 (relative seed, relative and prefixed readers) → one `prefixed-read`, no `read-unseeded`; case 6a/6b (secret row, prefix-catalog key read prefixed) → none; case 7 (relative seed in production only, prefixed read) → `prefixed-read` + `read-unseeded:staging`; case 9a (prefixed seed, relative read) → `form-mismatch`; case 9b (plus a prefixed reader) → `read-unseeded` for the relative read.

**Lands with**: `Step 9`

**TDD**: `red-green required`

**Covers**: `AC-6, AC-22, AC-23, AC-24`

**Instructions**:
1. Red first: write the new tests/fixtures, run them against the pre-Step-9 gate (they fail), then land Step 9 in the same unit.
2. `join 1`: retitle ("a prefixed seed read relative is a form-mismatch; a relative seed read prefixed is a prefixed-read"); the expected lines become `${SEEDS}/001_seed.up.sql:ingest/ingest.signals.window_hours->signals.window_hours:form-mismatch` (unchanged, line 1) and, for line 2, `<reader file>:ingest.mcp_client.request_timeout_seconds:prefixed-read`. `ANALYSIS_MISMATCH` becomes the `prefixed-read` line for `analysis.fundsignal.enabled`; retitle `ratchet 4`. `ratchet 6`/`9` follow the constant.
3. New fixture root `join/prefixed-read` with rows: (a) ledger relative seed `export.max_window_days` read as `export.max_window_days` by one reader and `ledger.export.max_window_days` by another; (b) a production-only relative seed read prefixed; (c) a secret row and a prefix-catalog key read prefixed; (d) a prefixed seed `ledger.export.enabled` with a relative reader, plus a second variant with an extra prefixed reader.
3c. **Attribution and freshness.** `attribute()` (`check-config-wiring.mjs:546-551`) resolves a read's namespace only through `registry.receivers["<file>:<receiver>"]` (no path-based fallback; an unmatched read is `unattributed`, blocking, and `prefixed-read` never fires). The fixture's `scripts/config-wiring.json` therefore carries `registry.receivers` entries `"services/xstockstrat-ledger/src/reader_a.ts:cfg": "ledger"` (and the same for `reader_b.ts`, `reader_c.ts`, using the receiver name the readers call, `cfg.getInt("…")`, the form the TS extractor matches, `:456-498`). `join 9` runs the committed root through `cli(root, '--final')` like `join 1`, so the fixture's `config-wiring-stored.json` needs a correct `inputs_sha256`: compute it with `cw.storedInputsSha256(root)` and commit it, or run through a temp copy plus `stamp()`.
3b. Rows (b) and (c) have no file of their own: they are extra reads inside `reader_a.ts`/`reader_b.ts` against extra seeds in `001_seed.up.sql` (a production-only seed; a secret row; a key matching the `catalog.tsv` prefix entry). The "baselined → `--final` exits 0" and "(d) without the second prefixed reader" variants are produced by copying the fixture root to a temp directory inside the test and editing the copy's `scripts/config-wiring.json` / dropping the second reader (the `stage()` helper pattern, `config-wiring.test.mjs:216-247`), not by extra committed roots.
4. New `join 9` (**AC-22**, **AC-24**): case (a) → exactly one `prefixed-read` and no `read-unseeded`; with that finding baselined under `feature 304`, `--final` exits 0; case (d) → `form-mismatch`, and with a second prefixed reader the relative read is `read-unseeded`; a prefixed read of an unseeded key → only `read-unseeded`; (c) → nothing. **AC-6**: a fixture reader calling `getInt("ledger.export.max_window_days")` with no baseline entry → `--final` reports `prefixed-read` for `ledger`/`ledger.export.max_window_days` and exits non-zero.
5. New `ratchet 10` (**AC-23**): an in-memory `state()` baseline entry `{kind:'prefixed-read', owner:'feature 304'}` covers a produced finding (the ratchet reports nothing for it); after the read is rewritten relative the leftover entry is `STALE: …` and fails. Also a `validateState` case: a `prefixed-read` entry owned by anything but `feature 304` exits 2.
6. `gate 7`: fixture owner → `feature 305` (and `gate/membership/scripts/config-wiring.json:7`), and the expected line at `config-wiring.test.mjs:460` — `NOT-IN-DRYRUN: … (feature 296) has no unread-no-partner row …` — becomes `(feature 305)`; also the test title at `:456`; a second assertion that an entry owned by `feature 306` is checked too. `baseline 2`: add `'prefixed-read'` to the allowed kinds and assert every `prefixed-read` entry has `owner === 'feature 304'`. `baseline 3`: the owner filter becomes `feature 305` / `feature 306`.
7. Note: `baseline 1`, `baseline 2` stay red with STALE-STORED until Step 18; this step runs the file with them filtered.

**Verification**:
```
cd /home/user/xstockstrat
node --test --test-name-pattern='^(?!baseline [12] )' scripts/config-wiring.test.mjs
grep -n "prefixed-read" scripts/config-wiring.test.mjs | head
```
(Node tests under `scripts/` have no coverage threshold; the `config-wiring` CI job runs the same file.)

---

### Step 11 — service: doc-check rule constants and the three scanned contract documents

**Status**: `pending`
**Service**: `scripts/` (repo tooling) and docs
**Files**:
- `scripts/check-config-wiring.mjs` — modify (`DOC_RULE_SENTENCES`, `DOC_BANNED`)
- `docs/sdd/constitution.md` — modify (the `C-05` row, `:36`)
- `services/xstockstrat-config/docs/context-constitution.md` — modify (the `CONFIG-9` row, `:26`)
- `docs/patterns/config-governance.md` — modify (`:64-75` wiring-check rule, plus the registered-keys-log note, the step-coupling note, the `readers-disagree` gap and the banner-window sentence)

**Reviewers**: xstockstrat-config owner — config key naming and contract wording

**Codebase Evidence**:
- `DOC_RULES` `check-config-wiring.mjs:761-765` (C-05 row, CONFIG-9 row, `config-governance.md` whole file); `DOC_RULE_SENTENCES` `:766` is `["the stored key equals the reader's exact spelling", 'every read key is seeded']`; `DOC_BANNED` `:767` is `[/NO fixed convention/, /seeding waiver/i]`; `docCheck` `:770-783` lowercases and whitespace-flattens the scope before `includes`.
- Old wording to replace: `docs/sdd/constitution.md:36` (C-05), `services/xstockstrat-config/docs/context-constitution.md:26` (CONFIG-9; **not** the root `docs/context-constitution.md`), `docs/patterns/config-governance.md:66` (the only occurrence of the old sentence in that file; `grep` over the three files → no other hit, so the new `DOC_BANNED` entries cannot trip on a historical log line).
- Tests that pin the rule text: `scripts/config-wiring.test.mjs:603-620` (`doc 1`), `:622` (`doc 2`), `doc 4/5` `:650-668` pin the CONTRACT string (`namespace, key, \`value_type\`, code default, reader \`path:symbol\`, seed migration, live mechanism`), which stays verbatim.
- Operator-signed wording (`design.md` §9): "the stored key is namespace-relative; the FQN is display-only; every read key is seeded by a config migration; readers may still use the prefixed spelling via the alias until feature 304's baseline is empty."

**Lands with**: `Step 12`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. `check-config-wiring.mjs`: `export const DOC_RULE_SENTENCES = ['the stored key is namespace-relative', 'every read key is seeded', 'the fqn is display-only', 'the prefixed spelling via the alias until']` (lower-case, matching the flatten step); `DOC_BANNED` adds `/the stored key equals the reader's exact spelling/i` and `/cutover in feature 296/i`. Keep `DOC_RULES` unchanged (the 11 consumer banners must not be scanned).
2. Rewrite the C-05 row and the CONFIG-9 row. Each must contain the signed sentence **verbatim**: "the stored key is namespace-relative; the FQN is display-only; every read key is seeded by a config migration; readers may still use the prefixed spelling via the alias until feature 304's baseline is empty" (`--doc-check` lower-cases and whitespace-flattens, so a paraphrase such as "the FQN `<namespace>.<key>` is display-only" does not contain the required `the fqn is display-only` and fails). Around it keep: `<category>.<key>` under namespace `<service>`; seeded by a config migration (feature 295; no unseeded consumed-with-default exception); readers may still use the prefixed spelling via the alias until feature 304's baseline is empty; services subscribe at startup; defaults in each service's `CLAUDE.md`; the retired `secret.*` prefix parenthesis (feature 147) stays unchanged. Keep the C-05 `**C-05**` row anchor `| **C-05** |` and CONFIG-9 `| **CONFIG-9** |`.
3. `config-governance.md` `:64-75`: rewrite the rule paragraph accordingly (copy the reader's literal until 304 lands; the gate reports a prefixed read of a seeded relative key as `prefixed-read`, baselined under feature 304); add: one sentence on the banner window ("from 296's merge until 304's integration PR the 11 consumer `CLAUDE.md` banners still state the old rule; C-05 governs and `scripts/config-wiring.json` is the machine-readable truth"); one on step coupling (a feature that declares a key still read prefixed fails its step with `prefixed-read` and rewrites that key's readers in the same step); one on the accepted `readers-disagree` gap (it cannot see a cross-spelling disagreement during 304's window); a sentence in the Per-Feature Registered Keys log note that stored keys are namespace-relative from migration `044`.
4. Do not rewrite consumer `CLAUDE.md` banners (304).

**Verification**:
```
cd /home/user/xstockstrat
node --check scripts/check-config-wiring.mjs
node scripts/check-config-wiring.mjs --doc-check   # exit 0, no output
grep -c "the stored key is namespace-relative" docs/sdd/constitution.md services/xstockstrat-config/docs/context-constitution.md docs/patterns/config-governance.md
node --test --test-name-pattern='^(?!baseline [12] )' scripts/config-wiring.test.mjs
```

---

### Step 12 — test: doc-check tests import the rule sentences

**Status**: `pending`
**Service**: `scripts/` (repo tooling)
**Files**:
- `scripts/config-wiring.test.mjs` — modify

**Reviewers**: xstockstrat-config owner — config key naming and contract wording

**Codebase Evidence**:
- The test file keeps its own copy: `const RULE_SENTENCES = [...]` at `config-wiring.test.mjs:603`, used by `doc 1` `:612-620`; `doc 3` `:627` pins the banned-phrase failure; `ruleTexts(root)` `:608-610`.
- `cw` is the module namespace import (`cw.loadStored`, `cw.storedInputsSha256` used at `:490`).

**Lands with**: `Step 11`

**TDD**: `red-green required`

**Covers**: `AC-11`

**Instructions**:
1. Delete the local `RULE_SENTENCES` and use `cw.DOC_RULE_SENTENCES` in `doc 1` (single source of truth; the test now reddens when a document loses a sentence).
2. Add to `doc 1` an assertion that each of the three documents contains the substring `the prefixed spelling via the alias until` (flattened, lower-cased) and that the text does not match `/the stored key equals the reader's exact spelling/i`.
3. Add `doc 6` (**AC-11**): `--doc-check` on a scratch copy of the three documents whose C-05 row is the **old** sentence fails naming the document (`missing rule sentence "the stored key is namespace-relative"`), by extracting the temp-dir code that `doc 3` inlines (`config-wiring.test.mjs:628-634`) into one shared helper used by `doc 3` and `doc 6`. (Scripts tests carry no coverage threshold.)
4. Leave `doc 4/5` untouched (CONTRACT string kept verbatim).

**Verification**:
```
cd /home/user/xstockstrat
node --test --test-name-pattern='doc ' scripts/config-wiring.test.mjs
node scripts/check-config-wiring.mjs --doc-check
node --test --test-name-pattern='^(?!baseline [12] )' scripts/config-wiring.test.mjs
```

---

### Step 13 — docs: remaining contract documents and runbooks

**Status**: `pending`
**Service**: `docs/`
**Files**:
- `docs/context-constitution.md` — modify (`PLAT-14`, `:52`)
- `services/xstockstrat-config/docs/context-constitution.md` — modify (`CONFIG-8`, `:25`: spelling of `platform.trading_state` as stored `trading_state`)
- `CLAUDE.md` — modify (§Config Governance Rules, `:161`)
- `services/xstockstrat-config/CLAUDE.md` — modify (the banner at `:111-112`; also its key tables where they name the FQN as the stored key)
- `docs/runbooks/config-rollout.md` — modify
- `docs/runbooks/mcp-tools.md` — modify (`:1204`, and the `list_config_keys` / `get_config` sections)
- `.claude/skills/sdd-review/reference/product-spec-criteria.md` — modify (criterion 6, `:25`)
- `.claude/skills/sdd-spec/reference/spec-template.md` — modify (`:135-137`)
- `.claude/agents/spec-reviewer.md` — modify (`:20`)
- `.claude/skills/sdd-story/SKILL.md` — modify (`:200-204`)
- `.claude/agents/codebase-discovery.md` — modify (`:34`)
- `scripts/integration-test.sh` — modify (a one-line "superseded by feature 296" header note above `:516-552`, which still sends prefixed `platform.maintenance_mode`; the script is no longer wired into CI)

**Reviewers**: none

_More than five files, deliberately kept as one docs-only step: every edit states the same operator-signed sentence, none is behaviour, and a split would add no separate verification (all are checked by the same `--doc-check` and greps below)._

**Codebase Evidence** (each location re-read at spec time):
- Old wording confirmed at: `docs/context-constitution.md:52` (PLAT-14, "agree on the full-dotted string"), `services/xstockstrat-config/docs/context-constitution.md:25` (CONFIG-8), `CLAUDE.md:161`, `services/xstockstrat-config/CLAUDE.md:111`, `docs/runbooks/mcp-tools.md:1204` (`| key | string | yes | e.g. \`marketdata.fmp.enabled\` |`), `.claude/skills/sdd-review/reference/product-spec-criteria.md:25`, `.claude/skills/sdd-spec/reference/spec-template.md:135-137`, `.claude/agents/spec-reviewer.md:20`, `.claude/skills/sdd-story/SKILL.md:200`, `.claude/agents/codebase-discovery.md:34`.
- `docs/runbooks/config-rollout.md`: `## Config Key Naming Convention` `:29` (rule `:31-33`), examples with prefixed keys at `:98,121,275,292`, wording `:221`, `## Recovery: dirty 041_heal_config_keys_to_reader_catalog` `:241`, the sentence "Until feature 296 gives config a contract floor" `:246`, `## Rollback Procedure` `:267`.
- Homelab path: `deploy/homelab/compose.yml:32-37` (`db-migrator`, `restart: "no"`), `:53-55` (`xstockstrat-config` `depends_on db-migrator service_completed_successfully`), triggered by `.github/workflows/deploy-homelab.yml` (`workflow_dispatch`/`workflow_call`, inputs `environment`, `image_tag`, `:9-27`). DO: `db-migrator` is a `PRE_DEPLOY` job in `.do/app.dev.yaml:671-673` and `.do/app.yaml:667-687`. Direct-DSN access: `docs/runbooks/operator-db-access.md`.
- **Assumption A4b is moot (operator, 2026-11-08)**: there are no pre-existing homelab containers or databases, so a failed homelab `db-migrator` has no previous image to keep serving and no data to protect; the homelab path is a fresh deploy, and recovery is the documented repair + `migrate force <n−1>` + re-run `workflow_dispatch` Deploy homelab. The runbook text states this as the operator's assertion; homelab-edge's app-deploy gate (`deploy-homelab.yml:1`) is not consulted.
- CONTRACT string pinned by `scripts/config-wiring.test.mjs` `doc 4/5` (`:650-668`): keep it verbatim in the criteria, spec template, reviewer, story and discovery documents.

**TDD**: `N/A (docs)`

**Covers**: `AC-11`

**Instructions**:
1. Every 296 document carries the operator-signed sentence ("the stored key is namespace-relative; the FQN is display-only; every read key is seeded by a config migration; readers may still use the prefixed spelling via the alias until feature 304's baseline is empty"). `PLAT-14`, root `CLAUDE.md:161`, the config `CLAUDE.md` banner state the same; PLAT-14 says a key is live only if a seed row's relative key and the reader agree (reader spelling prefixed until 304).
2. `config-rollout.md`: (a) naming rule `:31-33` and the examples `:98,121,275,292` use relative keys with namespace (fix once, by hand); (b) **Rolling back past feature 295 is forbidden** (new paragraph under `## Rollback Procedure`): a rollback to 295's images is sound because 295's server serves both spellings through the alias; (c) a per-platform failure and recovery section: DigitalOcean (`PRE_DEPLOY` aborts, previous deployment keeps serving; config is dirty so **every** later `main-dev` deploy exits 3 until repaired; repair data, `migrate force <n-1>`, redeploy) versus homelab compose (the migrator exits non-zero, `--wait` fails for every dependent, dependents are not recreated; repair as DB owner over the tailnet with the `x-db-direct` DSN, `compose.yml:11-12`, `migrate force <n-1>`, re-run `workflow_dispatch` Deploy homelab with the same `image_tag`) versus local compose (a stray twin raises; same repair); mark A4b as an assumption; (d) the recovery table of `design.md` §3.4 (every row ends in `migrate force <n-1>` + `db-migrate.sh up`, the migration file is never edited, hand-deleted rows get a hand-written audit row, repairs follow `operator-db-access.md`); (e) "dirty at a version ≥ 40 means `force <n-1>`, never `force 0`" (rewrite the `:246` sentence); (f) the R sign-off and rehearsal procedure of `design.md` §3.5 (Step 16 follows it; this section is its home); (g) an old or rolled-back UI image skips the `trading_state` reason guard (UX only; the server enum check and audit still hold); (h) the runbook forbids direct database writes during a deploy.
3. `mcp-tools.md:1204`: the `key` example becomes `fmp.enabled` with the sentence "namespace-relative; use `fqn` from `list_config_keys` for display only"; document `fqn` in `list_config_keys`'s return and that `get_config` returns keys as stored.
4. Authoring documents: replace "the stored key is the reader's exact spelling / today `<service>.<category>.<key>`" with the relative convention plus the alias caveat; **keep the CONTRACT string verbatim**.
5. `scripts/integration-test.sh`: add the superseded note only (do not rewrite the calls; the script is outside CI).
6. Unchanged (FQN notation stays valid): `feature-overlap.md:42`, `service-briefing.md:55`, `sdd-design/templates/recon.md:51`, `track-b-config.md:7`, `reviewer-registry.md:22`, `*-findings.md`. The 11 consumer banners and key tables, the strat-lab skill literal, and the caveat removal are 304's.

**Verification**:
```
cd /home/user/xstockstrat
node scripts/check-config-wiring.mjs --doc-check
node --test --test-name-pattern='doc |skill ' scripts/config-wiring.test.mjs   # skill 4 pins .claude/skills/sdd-story/SKILL.md, edited here
grep -qi "rolling back past feature 295 is forbidden" docs/runbooks/config-rollout.md && echo ok   # → ok
grep -rn "Until feature 296 gives config a contract floor" docs/runbooks/config-rollout.md   # → no output
grep -rn "stored key is the reader's exact spelling\|equals the reader's exact spelling" CLAUDE.md docs .claude services/xstockstrat-config/CLAUDE.md | grep -v "docs/roadmap\|docs/reports\|docs/sdd/business-rules"   # → no output (docs/sdd/business-rules/platform.feature:1422 is a promoted C-16 scenario that Step 14 may only annotate, never edit)
```
Read each edited sentence once: the alias caveat is present in PLAT-14, root `CLAUDE.md`, the config `CLAUDE.md`, and the runbook.

---

### Step 14 — docs: durable business-rule supersession notes (C-16)

**Status**: `pending`
**Service**: `docs/` and per-service acceptance suites
**Files**:
- `services/xstockstrat-config/acceptance/fix-config-keys-drift.feature` — modify (header `:6` rewritten, supersession note block)
- `docs/sdd/business-rules/platform.feature` — modify (supersession note block after the 295 scenarios, `:1409-1425` region)
- `services/xstockstrat-config/acceptance/config-ui-usability.feature` — modify (notes)
- `services/xstockstrat-ui/acceptance/config-ui-usability.feature` — modify (notes)
- `services/xstockstrat-config/acceptance/config-secrets-and-scoping.feature` — modify (notes)
- `services/xstockstrat-marketdata/acceptance/config-secrets-and-scoping.feature` — modify (notes)
- `services/xstockstrat-config/acceptance/fix-sandbox-seed-keys.feature` — modify (notes)
- `services/xstockstrat-config/acceptance/readiness-materializer-config-keys.feature` — modify (notes)
- `services/xstockstrat-config/acceptance/opportunity-config-operability.feature` — modify (notes)
- `services/xstockstrat-config/acceptance/signal-watchlist-expiry-pruning.feature` — modify (notes)
- `services/xstockstrat-config/acceptance/fix-analysis-live-loop-budget-seed.feature` — modify (notes)
- `services/xstockstrat-config/acceptance/filter-otc-symbols.feature` — modify (notes)
- `services/xstockstrat-indicators/acceptance/fix-sandbox-seed-keys.feature` — modify (note)

**Reviewers**: none

**Codebase Evidence**:
- Precedent for a supersession note that leaves promoted scenarios unedited: `docs/sdd/business-rules/platform.feature:1437-1449` ("homelab flat secret keys (feature 302) … The 286 scenarios are left unedited; read each as follows"). Promoted suites say "Do not hand-edit; provenance tags preserved" (e.g. `fix-sandbox-seed-keys.feature:1`), which is why only comment blocks are added.
- Durable header to rewrite: `services/xstockstrat-config/acceptance/fix-config-keys-drift.feature:6` ("What xstockstrat-config guarantees: a stored key equals the reader's exact spelling, …").
- The signed CHANGE list (operator sign-off, davcs86 2026-11-07, `context.md` round 3): 295 config `@AC-1/14/20/21/25/26/34` and `@AC-28(a)(b)(c)`; 295 platform `@AC-19` and `@AC-20`; 219 config `@AC-6/7/13` and ui `@AC-8/@AC-12`; `@AC-2` @243 (indicators), `@AC-2/@AC-4` @182, `@AC-2` @184, `@AC-19` @281, `@AC-27` @282, `@AC-1/3/5/7/10/12/13` @293; pre-approved C1-C6 (295 decision 10). Suites carrying these tags found by `grep -n "@feature-243\|@feature-182\|@feature-184" services/*/acceptance`: `fix-sandbox-seed-keys` (config @AC-1/3/4/5, indicators @AC-2), `readiness-materializer-config-keys` (@feature-182 @AC-1/2/4/5), `opportunity-config-operability` (@feature-184 @AC-1/2/3/4/5/8), and the @281/@282/@293 config suites listed above.
- PRESERVE (+note where the Then text changes): 295 `@AC-5` (effective value unchanged; **R parks it with snapshot and report**) and `@AC-33` (the CI fixture twin is removed by the data repair, never by a migration); `@AC-54` @feature-294; 254 `@AC-3/4/6`; 161 `@AC-8`; 264 `@AC-5`; 278 `@AC-2/3/7/8/9`.
- The two `config-secrets-and-scoping.feature` files get notes under the pre-approved **C5** (295 decision 10; `recon.md` Existing Business Rules): the 147 secret scenarios' key literal becomes namespace + relative key, and `GetSecret` with a prefixed key is `INVALID_ARGUMENT` (`@AC-1` here). Design §8 does not list them separately; C5 is the authority.
- **Deliberate omission (N2, @feature-247)**: `services/xstockstrat-agent/acceptance/fix-agent-getconfig-deadline.feature` names only relative keys (`agent` / `signal.alert_threshold`), so no 296 note is needed; its guarantees (bounded `GetConfig`, defaults) are PRESERVED, and the agent's own prefixed reads are 304's.
- **Not found**: any 304-owned scenario in this list; 295 `@AC-15` (ledger `read_key` log spelling) stays with 304.

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. Rewrite the `fix-config-keys-drift.feature:6` header to: "What xstockstrat-config guarantees: a stored key is namespace-relative (the FQN is display-only), every read key is seeded, heals never destroy intent silently, and secrets are never printed."
2. In each file add one comment block, in the form of `platform.feature:1437-1449`, listing only the **signed** scenario IDs of that file and how to read each now: seed/stored-key Thens read "relative, since migration R (feature 296)"; prefixed `SetConfig`/`create_key`/`GetSecret` Thens read "rejected `INVALID_ARGUMENT` (feature 296 `@AC-1`), poller exception per `@AC-5`"; `ListKeys` Thens read "returns the stored relative key; the FQN is composed by clients (feature 296 `@AC-10`)"; 295 `@AC-28(a)(b)(c)` read "mechanism is `migrate goto <R-1>` plus a direct dirty-guard call that exits 3 (296 rerun pass 2b/2c)"; 295 platform `@AC-19`/`@AC-20` read "baseline owners are features 304/305/306 and the doc-check sentences are the 296 set".
3. In `fix-config-keys-drift.feature` add the two PRESERVE notes: `@AC-5` — "survives 041; feature 296 R parks the per-user row with a snapshot and a `per-user-parked` report row; the user's effective value is unchanged"; `@AC-33` — "R and R+1 never delete a secret-class twin; the CI fixture twin is deleted by the repair step of the rerun, never by a migration".
4. Do not edit, renumber or delete any promoted scenario.

**Verification**:
```
cd /home/user/xstockstrat
grep -n "stored key is namespace-relative" services/xstockstrat-config/acceptance/fix-config-keys-drift.feature
grep -c "feature 296" services/xstockstrat-config/acceptance/*.feature services/xstockstrat-ui/acceptance/config-ui-usability.feature services/xstockstrat-indicators/acceptance/fix-sandbox-seed-keys.feature services/xstockstrat-marketdata/acceptance/config-secrets-and-scoping.feature docs/sdd/business-rules/platform.feature
BASE=$(git merge-base HEAD origin/main-dev)   # works before and after the commit
git diff --stat $BASE -- 'services/*/acceptance/*.feature' docs/sdd/business-rules/platform.feature | tail -1
git diff -U0 $BASE -- 'services/*/acceptance/*.feature' docs/sdd/business-rules/platform.feature | grep '^-' | grep -v '^---' | grep -v 'What xstockstrat-config guarantees'   # → no removed scenario lines
```

---

### Step 15 — test: `migration-rerun.sh` reshape and the config migration assertions

**Status**: `pending`
**Service**: `scripts/` (CI-only migration replay harness)
**Files**:
- `scripts/migration-rerun.sh` — modify
- `scripts/migration-assertions/config-044.sql` — create
- `scripts/migration-assertions/config-031.sql` — modify (the "end loop" rule below skips it; the file gets a header note that it runs at `cfg_pre`)
- `scripts/migration-assertions/config-041.sql` — modify (header note only)
- `scripts/migration-assertions/config-043.sql` — modify (header note only)
- `scripts/migration-assertions/fixtures-pre-041.sql` — modify (the extra staging fixture rows the rerun needs: gap-twin and per-user parking rows are inserted by the script itself; edit this file only if the real-file AC-18/AC-19 run needs a fixture it lacks)

**Reviewers**: DBA — run-order compliance with `scripts/db-migrate.sh`, replay safety, xstockstrat-config owner — config key naming and secret handling

**Codebase Evidence** (`scripts/migration-rerun.sh`, 367 lines, re-read at spec time):
- Pass 0 goto: `:72` (`config) migrate … goto 40`), fixtures loaded `:82-85` (`fixtures-pre-224.sql`, `fixtures-pre-041.sql`, `fixtures-post-224.sql`); pass 1 `db-migrate.sh up` `:87-91`; pass 2 replay list `:93-115`; pass 2b AC-28 `:135-221` with `cfg_head` `:138-142`, `latest_run`/`counts`/`fn_defs`/`knob_alive` `:143-171`, leg (a) `:172-183`, leg (b) `:184-195`, leg (c) `:196-221` whose `must_be_dirty config 1` `:205` expects the automatic `force 0` to fail at 001; pass 3 `:223-` with `refuse_down` / `guard_blocks` helpers `:225-247`, `refuse_down ingest 13 014` `:248`, recovery `want` loop `:265-271`; end loop `:273-280` (`fixtures-*) continue ;;` `:276`).
- Breakage A (design §7): the dirty-guard floor becomes 40 because R carries `contract-of: …040_config_markers.up.sql` (`migration-dirty-guard.sh:22-43`), so leg (c)'s "automatic force 0 fails at 001" becomes exit 3. Breakage B: leg (b) deletes the 041 latch and replays 041's prefixed seeds (`041…up.sql:48,351-361`) onto a database that has the CHECK → 23514. 041 is immutable (F-01), so the replay is moved **before** R and run with `migrate goto $cfg_pre`.
- Existing assertion files: `scripts/migration-assertions/config-031.sql` (no bare `sandbox.*` rows; `:12` key list), `config-041.sql`, `config-043.sql` (asserts un-stripped `analysis.engine.*`, `:7-31`) — these describe the **pre-R** state and fail after the rename.
- Fixture twins in `fixtures-pre-041.sql`: the unsigned twin `analysis` `fundsignal.valid_days` (`:37-41`, kept by 041, `config-041.sql:176-183`), the secret twin `marketdata` `fmp.api_key` / `marketdata.fmp.api_key` (`:42-46`), the per-user row `analysis` `fundsignal.enabled` for `u-295` (`:34-36`).
- Insights applied: "signed twins: the CI fixture twin is deleted by the repair, never by a migration" (295 `@AC-33`); sign-off of the embedded block is independent of fixtures (`fails.md` 2026-11-07 fix-config-keys-contract).

**TDD**: `N/A (CI replay harness and SQL assertions, proven by the migration-rerun CI job; not runnable offline)`

**Covers**: `AC-1, AC-3, AC-4, AC-8, AC-9, AC-15, AC-16, AC-17, AC-18, AC-19, AC-20, AC-21`

**Instructions** (`design.md` §7):
1. **Derive R and cfg_pre**: R = the single `services/xstockstrat-config/migrations/*.up.sql` whose first 5 lines carry `contract-of: …040_config_markers.up.sql`; assert exactly one match else `exit 1`; `cfg_pre = R - 1` (parse the number as `n=$((10#$n))`, as `:140` does).
2. **Pass 0** unchanged (config still goes to 40 at `:72`).
3. **Move pass 2b before pass 1**, config-only (`migrate goto $cfg_pre`, never `db-migrate.sh up`). **First action of the moved block**: `migrate -path "$cfg_dir" -database "$(service_db_url config)" goto $cfg_pre; must_be_clean config $cfg_pre` — config sits at 40 after pass 0, so 041 (which creates `config.config_heal_report_041`, read by `latest_run` and `counts` at `:144-146`) has not run yet; `run_a`, the `counts_a` baseline and the `backtest.extra_knob` INSERT (`:168`) must all come **after** it. Legs (a) and (b) then become `cfg_force 40; migrate … goto $cfg_pre; must_be_clean config $cfg_pre` (replacing the `up` calls at `:175-177` and `:186-188`, and `cfg_head` with `cfg_pre`); leg (c) sets `cfg_force 41`, marks dirty, calls `scripts/migration-dirty-guard.sh` directly and asserts exit 3, the text `config is dirty at version 41` and `force 40`, counts and audit functions unchanged; then `cfg_force 40; migrate … goto $cfg_pre; knob_alive`.
4. **New pass 2c at `cfg_pre`**: (1) run each `scripts/migration-assertions/config-NNN.sql` with NNN < R (031, 041, 043) unchanged (they are only valid before R and with no CHECK); (2) **real-file AC-18/AC-19 test** on the committed R: `migrate … up 1` over the `fixtures-pre-041` data must fail with exactly the lines `secret-class-twin marketdata/fmp.api_key/staging` then `uncovered-twin analysis/fundsignal.valid_days/staging` (rank order, header `feature 296: 2 violation(s); nothing changed`) and no value text (`grep` the output for the fixture values `legacy-fmp-value-295`, `45`, `90`); `must_be_dirty config $R`; counts unchanged; no report rows; no marker row; a direct guard call exits 3 with `force $cfg_pre`; then repair in one transaction (delete the plaintext legacy twin `marketdata`/`marketdata.fmp.api_key` and the unread bare `analysis`/`fundsignal.valid_days` = 45, each with a hand-written `config_audit` row, `new_value NULL`; `fixtures-pre-041.sql:37-46`), `cfg_force $cfg_pre`, and the following steps converge with R **unchanged**; (3) **signed-tuple happy path** (AC-9, AC-16, AC-21 counts) on a `sed` copy of R outside the migrations directory inside `BEGIN … ROLLBACK`: replace the block between `-- allow_296:begin` / `-- allow_296:end` with test tuples (indicators `sandbox.timeout_ms` with the sha256 of `5000` as loser; an equal-valued twin pair; a tuple naming a lone prefixed row → reported `unmatched-signed-tuple`, the row renamed not deleted); also a tuple with a hash matching neither member → `stale-signature`, and two tuples on one twin → `ambiguous-signature` (**AC-19** last Then).
5. **Pass 1** (`db-migrate.sh up`) applies R and R+1; the `u-295` per-user row is parked (AC-20). **Pass 2** replay list gains `config:R` and `config:R+1` (no-ops, latched). **Pass 3**: (1) `refuse_down config $cfg_pre R` (R+1's down drops the CHECK; R's down raises; dirty at `$cfg_pre`); (2) `guard_blocks config $cfg_pre $((cfg_pre - 1))`; (3) insert staging-global fixtures — **F1** operator P newer than Rel (`analysis`/`analysis.backtest.extra_knob`='2', `updated_by 'migration-rerun-operator'`, next to the relative `backtest.extra_knob`='1' created in the pass-2b setup) → P wins; **F2** poller P newer (`platform`/`platform.trading_state`='REDUCE_ONLY', `updated_by` and `caller_identity` = `trading-reconciliation-poller`, next to relative `trading_state`) → P wins; **F3** NULL-author P loses (`analysis.backtest.null_knob`='9' vs relative '3'); **F4** system seed P (`system:config-migration-043`) loses; **F5** operator P **older** than Rel → Rel wins; **F6** both-secret gap twin → resolved by the same rule, audit values NULL, no raise; **F7** mixed-class gap twin → R+1 raises (separate sub-test, then repaired); (4) the recovery `db-migrate.sh up` must succeed and end clean at R+1 (`want config:R+1` joins the loop at `:265`).
6. **End loop** (`:273-280`): additionally skip, **by rule**, only `config-NNN.sql` files with NNN < R (not by name; a bare NNN<R rule would skip `ingest-013` and `analysis-026`).
7. **`scripts/migration-assertions/config-044.sql`** (renumbered with R): **AC-1** a direct `INSERT` of `marketdata`/`marketdata.backfill.batch_size` raises 23514 (inside a savepoint-style `DO` block); **AC-8** no prefixed row remains, marker `set_by = 'system:config-migration-044'`, the snapshot row's `snapshot_at` < the rename audit row's `changed_at`; **AC-3/AC-4** stored values survive (`indicators`/`sandbox.timeout_ms`, `trading`/`risk.bracket_orders_enabled` relative); **AC-15** the CHECK exists; **AC-16** renamed `updated_at` equals its snapshot and `ListKeys`' source column is unchanged, exactly one rename audit row per row; **AC-17** outcomes F1-F6 (values; `updated_by`/`caller_identity`/`updated_at` of winners; exactly one delete-audit and one rename-audit row per winner, delete before rename; report rows `gap-twin-p-wins`×2 / `gap-twin-rel-won` / `gap-twin-system-deleted`; `pg_trigger.tgenabled = 'O'` for `config_value_audit`); **AC-19** the repair audit row exists; **AC-20** `u-295`'s row absent from `config_values`, present in `config_values_premigration_296` with its value, listed in `config_keys_report_296` as `per-user-parked` without a value, and the user's effective value unchanged; **AC-21** the number of `unmatched-signed-tuple` rows equals the number of tuples in the rendered `allow_296` block (parse the count from the block between the markers: 0 while R ships the empty block, 5 after Step 16), so the job is green at every commit; Step 16's Verification asserts that the count is exactly 5.
8. Reuse the script's helpers (`sql_value`, `must_be_dirty`, `must_be_clean`, `must_contain`, `refuse_down`, `guard_blocks`, `cfg_force`); add no parallel versions.
9. **Mechanics the moves require.** (a) Moving pass 2b before pass 1 means hoisting the helper definitions that sit after pass 1 to above it: `out`/`mig_version`/`sql_value`/`must_*` (`:113-131`) and `cfg_dir`/`cfg_force`/`latest_run`/`counts`/`fn_defs`/`knob_alive`/`must_be_clean` (`:138-171`); (b) `config-044.sql` is plain `psql` and cannot read R's text, so the harness computes N with `sed -n '/allow_296:begin/,/allow_296:end/p' <R> | grep -c "^[[:space:]]*('"` and passes `-v allow_tuples=$N` on the `psql … -f "$sql"` call (`:279`; today it passes only `seed_user_id`); the assertion compares the `unmatched-signed-tuple` count with `:allow_tuples` in a plain `SELECT` **outside any `DO $$` body** (psql does not substitute variables inside dollar-quoted bodies); (c) **AC-8's LISTEN Then**: start a second session before the apply, `psql -At -c 'LISTEN config_changed' -c 'SELECT pg_sleep(<n>)'` in the background writing to a file, with `<n>` longer than the apply plus a margin, record its pid and `wait` on it before reading the file (psql prints `Asynchronous notification … received` only after the sleep query returns), and assert that the file holds one per-(namespace, environment) payload per touched pair and the `{"marker":"relative_keys_v1"}` payload; ordering after commit is Postgres NOTIFY semantics and is not re-proven; (d) **AC-9** — assert user `u-100`'s per-user row renamed to `sandbox.timeout_ms` = 20000 and the 5000 twin present in `config_values_premigration_296` **inside the pass 2c(3) `BEGIN … ROLLBACK` happy path** (the committed R's block never names the 5000 twin, so this cannot live in `config-044.sql`); (e) the pass-2 replay list is hard-coded `pair` names (`:95-97`): derive R's and R+1's file names from the `contract-of` header and the next number instead of hard-coding `044`/`045`; **AC-20** — also assert a per-user **prefixed** row that is the read spelling beside a global twin is renamed, not parked; **AC-19** — record `shasum -a 256` of R before the failing run and assert it is identical after the repair and rerun.

**Verification**:
```
cd /home/user/xstockstrat
bash -n scripts/migration-rerun.sh
command -v shellcheck >/dev/null && shellcheck scripts/migration-rerun.sh || echo "shellcheck unavailable; CI lint covers it"
ls scripts/migration-assertions/config-044.sql
grep -n "pass 2c\|cfg_pre\|config:\$R" scripts/migration-rerun.sh | head
```
The behavioral proof is the `migration-rerun` CI job on the integration PR (it needs a real Postgres; never start one here). Record in the Deviation Log if CI shows a fixture the script lacked.

---

### Step 16 — migration: operator sign-off of R (embedded allowlist, renumber, rehearsal)

**Status**: `pending`
**Service**: `xstockstrat-config` and `scripts/config-heal`
**Files**:
- `scripts/config-heal/allow-296-signed.sql` — create
- `services/xstockstrat-config/migrations/044_config_keys_relative.up.sql` — modify (paste the allow block verbatim between `-- allow_296:begin` / `-- allow_296:end`; renumber the file and the actor strings only if the max+1 moved)
- `services/xstockstrat-config/migrations/044_config_keys_relative.down.sql` — modify only on a renumber
- `services/xstockstrat-config/migrations/045_config_keys_relative_check.up.sql` — modify only on a renumber (actor string)
- `services/xstockstrat-config/migrations/045_config_keys_relative_check.down.sql` — modify only on a renumber
- `scripts/config-heal/signoff.md` — modify (append "Feature 296 — R sign-off")
- `scripts/migration-assertions/config-044.sql` — modify only on a renumber
- `services/xstockstrat-config/src/__tests__/relativeKeysMigration.test.ts` — modify only on a renumber (none expected: it finds R by its `contract-of` header)

_A renumber or a pasted block changes R's bytes and therefore `inputs_sha256`: re-run Step 18 instruction 1 afterwards (Step 18 owns `scripts/config-wiring-stored.json`). A renumber also touches `docs/patterns/config-governance.md` (Step 11 instruction 3 hard-codes "from migration `044`") and the `design.md`/spec references: change them through the Deviation Log route._

**Reviewers**: DBA — migration numbering, embedded-data correctness, run-order, xstockstrat-config owner — config key naming, environment scoping, Security — no value or user id in any recorded output

**Codebase Evidence**:
- **Operator-gated**: needs the DO staging read path and an operator workstation; the executor cannot run it. `/sdd-execute` pauses here and asks the operator.
- Procedure of record: `design.md` §3.5 (also in `config-rollout.md` per Step 13). Inventory tool: `services/xstockstrat-indicators/app/maintenance/config_inventory.py` (sha recorded in `scripts/config-heal/signoff.md:5-6`); precedent signed block `scripts/config-heal/allow-signed.sql` (38 tuples, sha at `signoff.md:11-13`) pasted into 041 verbatim; render step `scripts/render-migrations.sh:23-30` (no `requires-env` header → the file is copied byte-for-byte).
- The 5 staging twins that 041 kept by operator decision are `analysis` `fundsignal.enabled`, `fundsignal.run_interval_hours`, `fundsignal.min_conviction_to_emit`, `fundsignal.scoring_formula_id` and `marketdata` `fundamentals.history.enabled` (`signoff.md:21-23`), so fresh/CI/production/homelab databases report exactly 5 `unmatched-signed-tuple` rows.
- The per-user staging row selected by S1 is `analysis`/`fundsignal.min_conviction_to_emit` (`report-staging-041.jsonl:25`, kept global twin `:26`).
- The operator commitments recorded in `context.md` (2026-11-07): homelab databases **will be fresh at launch**; DO production has no data in use (295 decision 24). Both are repeated in `signoff.md` at this step.
- Renumber rule: F-09 (no step-body edits during execution); the renumber and its touched files route through the Deviation Log (295 Step 38 precedent). The actor string `system:config-migration-<R>` is inside R, so renumbering changes R and invalidates any earlier sha.

**TDD**: `N/A (migration sign-off; the sha pin test is Step 17)`

**Covers**: —

**Instructions** (operator workstation, after the **last rebase and renumber**):
1. Re-check max+1 against `origin/main-dev`; if it moved, renumber R, R+1, their down files, the actor strings, `config-<R>.sql`, then continue.
2. Run `config_inventory.py` against DO staging; record the tool sha as in `signoff.md:5-6`.
3. Write `scripts/config-heal/allow-296-signed.sql`: `allow_296(namespace, key, environment, user_sha256, value_sha256)` rows naming the **loser** per twin by stored spelling plus `sha256(value)` (the operator may sign either direction per tuple, FR-3); exactly the 5 staging tuples. Paste it verbatim into R between the markers; render R with `scripts/render-migrations.sh`.
4. **Rehearse under the PRE_DEPLOY role** (the direct db-migrator URL): `psql -v ON_ERROR_STOP=1 -c 'BEGIN' -f <rendered R> -c "SELECT action,count(*) FROM config.config_keys_report_296 GROUP BY 1" -c 'ROLLBACK'` — must finish with no RAISE (`pg_notify` and the marker are not delivered on rollback).
5. Record "Feature 296 — R sign-off" in `scripts/config-heal/signoff.md`: inventory sha, allow-block sha256, **sha256 of the R file**, rehearsal output and timestamp, DO production and both homelab databases recorded as fresh by operator confirmation, operator name and date.
6. If the rehearsal raises, repair the **data** (never the file; `design.md` §3.4), `migrate force <n-1>`, re-run; the file stays fixed.

**Verification**:
```
cd /home/user/xstockstrat
sed -n '/allow_296:begin/,/allow_296:end/p' services/xstockstrat-config/migrations/044_config_keys_relative.up.sql | grep -c "^[[:space:]]*('"   # → 5 tuples pasted into R
grep -c "^[[:space:]]*('" scripts/config-heal/allow-296-signed.sql   # → 5 tuples signed
shasum -a 256 services/xstockstrat-config/migrations/044_config_keys_relative.up.sql   # equals the value recorded in signoff.md (shasum, not sha256sum: macOS-compatible, as config-wiring-stored.sh:12)
grep -n "Feature 296" scripts/config-heal/signoff.md
head -n 5 services/xstockstrat-config/migrations/044_config_keys_relative.up.sql | grep -c contract-of   # → 1
```

---

### Step 17 — test: R sha pin and transaction-statement check

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/__tests__/relativeKeysMigration.test.ts` — create

**Reviewers**: xstockstrat-config owner — config key naming and migration integrity

**Codebase Evidence**:
- Test helper: `src/__tests__/migrationSql.ts` (`MIGRATIONS_DIR`, `findOne(suffix, ext)`, `splitStatements`); suites run by `node --test dist/__tests__/*.test.js` (`package.json` `test`).
- The sign-off sha is recorded in `scripts/config-heal/signoff.md` (Step 16). Design rule: the sha pin keeps R fixed after sign-off since R embeds data (`design.md` §0, §3.5); a third check "R contains the allow block verbatim" was dropped as implied by the pin.
- Discover R by its header, not its number, so a renumber does not break the test: R is the single migration whose first 5 lines contain `contract-of: services/xstockstrat-config/migrations/040_config_markers.up.sql` (same predicate as `dormantAlias.test.ts` after Step 1).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. (a) read the sha256 recorded under "Feature 296 — R sign-off" in `../../../../scripts/config-heal/signoff.md` (resolve from `__dirname`) and assert it equals `sha256(R)`; (b) assert R has no statement matching `^\s*(BEGIN|COMMIT|ROLLBACK)\s*;` (use `splitStatements` or a line regex); (c) assert R has exactly one `-- contract-of:` header and it names `040_config_markers.up.sql`.
2. Red-first proof: run the test with the signoff section absent or holding a wrong sha (fails), then with Step 16's value (passes).
3. Single-consumer inline literals; no new fixture home (C-13).

**Verification**:
```
cd /home/user/xstockstrat/services/xstockstrat-config
pnpm run lint
pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40
pnpm exec tsc && node --test dist/__tests__/relativeKeysMigration.test.js
```

---

### Step 18 — config: regenerate the stored set and generate the `prefixed-read` baseline

**Status**: `pending`
**Service**: `scripts/` (generated config-wiring data)
**Files**:
- `scripts/config-wiring-stored.json` — modify (regenerated)
- `scripts/config-wiring.json` — modify (append the generated `prefixed-read` entries)

**Reviewers**: xstockstrat-config owner — config key naming and wiring discipline

**Codebase Evidence**:
- Generator: `scripts/config-wiring-stored.sh` (needs `DATABASE_URL`, creates and drops a scratch database; inputs hash covers `services/xstockstrat-config/migrations` plus the script itself, `:14-22`); CI job `config-wiring-stored` regenerates and diffs (`ci.yml:1055-1107`, `git diff --exit-code` `:1098`). Freshness gate: `freshness()` `check-config-wiring.mjs:711-714` → `STALE-STORED`.
- Baseline generation rule (design §6): `node scripts/check-config-wiring.mjs --final --json`, take `findings` of kind `prefixed-read`, **drop the `file` field** (so a key read by two families goes `STALE` only when its last reader is rewritten), set `owner: "feature 304"`; the command is recorded in `context.md`. Expect ≈184 entries (`design.md` §6).
- Validated by the ratchet: every produced `prefixed-read` finding must be covered and every entry must still be produced (`ratchet` `:695-709`).

**TDD**: `N/A (generated data; verified by the gate itself)`

**Covers**: —

**Instructions**:
0. **Scratch Postgres.** The generator creates and drops its own scratch database but needs a reachable server in `DATABASE_URL` (the `config-wiring-stored` CI job uses the `timescaledb` service, `ci.yml:1055-1107`). Steps 1 and 15 say "never start a database" about *applying R*; this step is different and needs one. If the executor has none, it pauses for the operator like Step 16.
1. Requires Steps 9-12 and 16-17 merged in the working tree and a scratch Postgres: `DATABASE_URL=<scratch postgres> bash scripts/config-wiring-stored.sh`. The regenerated stored set carries only relative keys and the CHECK-ended schema.
2. `node scripts/check-config-wiring.mjs --final --json > <scratch>/final.json`; build the baseline entries from `findings` filtered to `kind === 'prefixed-read'` with the shape `{namespace, key, kind: 'prefixed-read', owner: 'feature 304'}` (keep the file's existing key order and indentation); append them to `scripts/config-wiring.json` `findings` and re-run until `--final` exits 0.
3. Record the exact commands and the entry count in `context.md` (hand-maintained entries are forbidden; regenerate instead).
4. If a finding line shows an unexpected kind (`read-unseeded`, `form-mismatch`) — a reader of a key the rename did not seed, or a prefixed seed — stop: do not baseline it; that is a defect to raise (C-11/P-03). Step 9 instruction 4 widens the row checks to both spellings, so previously unchecked prefixed readers can newly surface `type-mismatch` / `default-mismatch` / `metadata-missing` findings: record each in `context.md` and baseline it with owner `feature 304` (304 rewrites the reader and clears it); never relax a kind (`fails.md` 295 entry, "enumerate with an owner in the shrink-only baseline").

**Verification**:
```
cd /home/user/xstockstrat
node scripts/check-config-wiring.mjs --final   # exit 0, no output
node scripts/check-config-wiring.mjs --doc-check
node --test scripts/config-wiring.test.mjs   # unfiltered: baseline 1 and baseline 2 now pass
git diff --stat scripts/config-wiring.json scripts/config-wiring-stored.json
node -e "const j=require('./scripts/config-wiring.json');const n=j.findings.filter(f=>f.kind==='prefixed-read');if(!n.length||n.some(f=>f.owner!=='feature 304'||f.file))process.exit(1);console.log(n.length)"
```

---

### Step 19 — test: contract-completeness checks (docs set, follow-up feature, full suites)

**Status**: `pending`
**Service**: `docs/roadmap/features` and repo-wide
**Files**:
- (none — verification only; any defect found is fixed in the owning step's files and recorded in the Deviation Log)

**Reviewers**: xstockstrat-config owner — config key naming and contract completeness

**Codebase Evidence**:
- Follow-ups exist: `docs/roadmap/features/306-config-keys-alias-removal/product-spec.md:5` — "Depends on: feature 296 `fix-config-keys-contract` and feature 304 … both `launched`"; its FR-1 removes the alias (`:19`); the 304/305/306 directories exist (`ls -d docs/roadmap/features/30[456]-*`); merge-order rows 29-31 pin them.
- `docs/runbooks/config-rollout.md` content per Step 13 (rolling back past 295 forbidden; per-platform failure section).
- Doc set and gate commands: `node scripts/check-config-wiring.mjs --doc-check` (CI `config-wiring`, `ci.yml:1048`).

**Lands with**: —

**TDD**: `N/A (verification-only step)`

**Covers**: `AC-11, AC-12`

**Instructions**:
1. Run the commands below; every one must pass. Failure in an earlier step's artifact is repaired there (Deviation Log), not papered over.
2. Confirm the preconditions for the integration PR and write them to `context.md`: `git cat-file -e origin/main:services/xstockstrat-config/migrations/040_config_markers.up.sql`; the operator's confirmation that 295's one-staging-release window has closed; the Step 16 sign-off present; the sha pin green.

**Verification**:
```
cd /home/user/xstockstrat
ls -d docs/roadmap/features/306-*/ && grep -c "Depends on.*fix-config-keys-contract" docs/roadmap/features/306-*/product-spec.md   # AC-12 → 1
grep -n "rolling back past\|Rolling back past" docs/runbooks/config-rollout.md | head -2   # AC-11
grep -n "PRE_DEPLOY\|homelab" docs/runbooks/config-rollout.md | head -4   # AC-11 per-platform path
node scripts/check-config-wiring.mjs --doc-check && node scripts/check-config-wiring.mjs --final && node --test scripts/config-wiring.test.mjs   # AC-11
for f in docs/sdd/constitution.md services/xstockstrat-config/docs/context-constitution.md docs/context-constitution.md docs/patterns/config-governance.md CLAUDE.md services/xstockstrat-config/CLAUDE.md; do grep -c "alias until" $f; done   # each ≥ 1 (AC-11)
cd services/xstockstrat-config && pnpm run lint && pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40
cd ../xstockstrat-ui && pnpm run lint && pnpm run test:unit
cd ../xstockstrat-agent && ruff check . && ruff format --check . && pytest -q
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._

### D1 — Execution branch (2026-11-08)
- **Spec said**: commit each step to `feature/fix-config-keys-contract` (sequential mode).
- **Actual**: commits land on `ccr-e901c541-u0cmts`, the harness-mandated branch (the feature branch carries none of recon/design/spec; the spec was authored on the `ccr-*` branch). The single integration PR is #1471 into `main-dev`.
- **Disposition**: operator-run harness constraint; no code impact.

### D2 — Migration SQL syntax verification (2026-11-08)
- **Spec said**: offline up/down check only.
- **Actual**: in addition, both migrations are parsed with `pglast` (`parse_sql` + `parse_plpgsql`, every embedded statement) — a pure parser, no database started. Semantic behavior is proven only by Step 15's `migration-rerun` CI job and Step 16's rehearsal.
- **Disposition**: offline migration check — live apply deferred to CI.

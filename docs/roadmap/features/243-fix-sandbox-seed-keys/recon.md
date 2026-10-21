# Recon: fix-sandbox-seed-keys

**Created**: 2026-10-20
**From**: product-spec.md
**Affected services**: xstockstrat-config, xstockstrat-indicators. Consumer surfaces `/insights`, `/config-ui` and agent `test_formula` were reconned read-only (C-14); none needs a change.

---

## Objective

Config migrations 001 and 002 seed the `indicators` sandbox rows under bare `sandbox.*` keys. The indicators
watcher reads full-dotted `indicators.sandbox.*` keys, and the config service adds no namespace prefix
(CONFIG-9), so the seeds never apply and every environment runs on code defaults. A new conflict-safe config
migration (031) heals the rows to full-dotted keys in `production` and `staging` and sets `timeout_ms` = 5000 and
`memory_bytes` = 134217728. Those are the values prod effectively runs today (operator decision 2026-10-20), so
nothing changes in effect. The migration also rewrites the `memory_bytes` description to headroom semantics. The
fix ships with tests and two doc fixes. SEV-2, Track C.

## Codebase Map

- **`xstockstrat-config`** (Node.js + SQL migrations)
  - Snapshot keying (the CONFIG-9 seam): `values[row.key] = buildConfigValue(row)` at `src/grpc/configServiceImpl.ts:212`; `reloadAll` does the same at `:188`. It uses the raw `key` column with no namespace prefix.
  - Load and reload: `initialize()` (`:162-163`) calls `reloadAll()` (`:176`); `LISTEN config_changed` is at `:165`.
  - The only `pg_notify('config_changed', …)` emitter is `setConfig` at `:515`. A grep of `migrations/` and `src/` finds no SQL or trigger emitter (CONFIG-4).
  - `SCALAR_BOUNDS_REGISTRY` (`:100-146`) has no `indicators.*` entry. `lookupScalarBounds` probes two operands (`:151-152`) and runs write-side only: `setConfig` (`:432`) and the `listKeys` hint (`:543`) (CONFIG-11).
  - Last migration: `030_marketdata_edgar_snapshot_keys.up.sql` (`services/xstockstrat-config/migrations/`). Next free: **031**.
  - Defect seeds (F-01: never edit):
    - staging: `001_config_tables.up.sql:62-64` holds 5000 / `134217728` ("Formula memory cap bytes") / `numpy,pandas,math,statistics`. These rows carry no environment, so they default to `'dev'`, and `017_config_secrets_and_scoping.up.sql:38` renames that to `'staging'`.
    - production: `002_config_environment.up.sql:61-63` holds 3000 / `67108864` ("Formula memory cap bytes (64MB)") / the same imports. `trading_mode='all'` survives the 017 collapse (`017:44-62`). `default_value` mirrors `value_data`.
    - A grep of `migrations/` for `sandbox` returns only these six lines. There are zero `indicators.sandbox` hits.
  - Table `config.config_values`: `001_config_tables.up.sql:6-18`.
    - `value_type` CHECK at `:10`, `is_secret` at `:12`, nullable `updated_by` / `update_reason` at `:16-17`.
    - Scope unique index `config_values_scope_uniq (namespace, key, environment, COALESCE(user_id, ''))` at `017:101-102`.
  - Audit triggers:
    - `config_value_audit` is BEFORE UPDATE (`001:49-51`), with its body at `017:66-79`. It writes `config_audit` only when `value_data` changes (`:69`) and sets `changed_by = NEW.updated_by`. It always sets `NEW.updated_at = NOW()` (`:77`).
    - `config_value_audit_insert` is AFTER INSERT (`010_config_audit_insert_trigger.up.sql:26-29`), with its body at `017:81-91`. It audits every insert.
  - Tests: `tsc && node --test dist/__tests__/*.test.js` (`package.json:12`). The `src/__tests__/*.test.ts` files mock the pool, and none of them reads migration SQL.
  - Invariants in `docs/context-constitution.md`: CONFIG-2 `:19`, CONFIG-4 `:21`, CONFIG-9 `:26`, CONFIG-10 `:27`, CONFIG-11 `:28`. The seed-equals-code-default gotcha is at `:36`; 029 is the only exception.
- **`xstockstrat-indicators`** (Python)
  - Getters in `app/config/watcher.py:133-148` already use full-dotted keys, so the source has no defect:
    - `sandbox_timeout_ms` at `:134` (`get_int`, default 5000)
    - `sandbox_memory_bytes` at `:138` (default `128 * 1024 * 1024`)
    - `sandbox_allowed_imports` at `:141-144` (`get_str_present`)
    - `sandbox_max_concurrent` at `:148` (out of scope)
  - Getter semantics: `get_int` returns `v.int_val or default` (`:114`, the zero-trap owned by feature 244). `get_str_present` checks `HasField("string_val")` (`:106`).
  - Subscribe scope: `resolve_environment` (`:18-27`) maps anything that is not `production` to staging. It is set at `:48`, and the `WatchConfig` request is at `:61-66`.
  - The only consumer is `app/handlers/servicer.py:277-279` (`request.*_override or self._cfg.sandbox_*`), which is unclamped in this tree.
  - Test home: `tests/test_config_watcher.py:51-56` (`_str_watcher`: a dial-free `ConfigWatcher.__new__` plus a `ConfigSnapshot`). The tests at `:59-76` cover only `allowed_imports`.
  - Findings rows in `docs/context-constitution-findings.md`: "Inert indicators seeds" at `:23` is open and owned by this feature. "Unclamped override" at `:24` is owned by hotfix #1263.
  - Docs: `CLAUDE.md:12` still says "configurable timeout and memory cap". The Config Keys table at `CLAUDE.md:100-103` already uses full-dotted keys and says headroom.
- **Consumer surfaces (C-14, read-only)**
  - `/insights` Sandbox limits panel: `services/xstockstrat-ui/src/components/insights/formulaReference.ts:168-175` shows "5 s", "128 MiB" and "Headroom …". It is accurate.
  - `docs/runbooks/indicator-builder.md:152-156` is accurate.
  - `/config-ui` lists the raw rows; it renders the description per feature 219.
  - Agent `test_formula` calls `ExecuteFormula`. Its effective limits do not change.

## Patterns to REUSE

- **Bare→full-dotted rename.** Reuse 029's guarded UPDATE at `029_heal_config_keys_full_dotted.up.sql:24-28` (`SET key = namespace || '.' || key WHERE key NOT LIKE namespace || '.%' AND is_secret = false`), narrowed to `namespace = 'indicators'` and the three explicit keys.
  - As written it is **not** conflict-safe: it aborts on `config_values_scope_uniq` when a full-dotted twin already exists (FR-4).
  - The twin guard must match on the whole scope tuple, including `COALESCE(user_id, '')`.
- **Production value correction inside a heal.** Reuse 029's deterministic literal applied after the rename (`029:38-43`): full-dotted key, `environment = 'production'`, `user_id IS NULL`. The 029 header (`:36`) calls this retry-idempotent.
- **Description rewrite.** Reuse 016's description-only UPDATE (`016_deprecate_analysis_signal_source_weights_desc.up.sql:9-14`) and its verbatim-restore down (`016_…down.sql:4-7`). Ledger `insights.md:1522`: reword a description through a new migration and never edit the seed.
- **Insert, if the design inserts a missing row.** Reuse 030's column list and `ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING` (`030_marketdata_edgar_snapshot_keys.up.sql:22-23,55`). Same idiom: `017:121`, `020_…down.sql:9-24`.
- **Down migration.** Design picks one of these precedents:
  - forward-only `SELECT 1;` with a rationale header (`029_…down.sql:3-19`)
  - a scoped explicit-key inverse (`030_…down.sql:9-18`: `user_id IS NULL`, `key IN (...)`, never `LIKE`)
  - a hardcoded restore with a documented clobber (`020_…down.sql:3-8`)
- **Migration conventions.**
  - No explicit BEGIN/COMMIT, because golang-migrate wraps each migration (`029:15`).
  - No `-- requires-env:` header is needed: `scripts/render-migrations.sh:23-31` renders only when that header is in the first 5 lines.
- **Real-DB verification of AC-1, AC-3 and AC-4.** Reuse the `migration-rerun` CI job (`.github/workflows/ci.yml:633-669`; path filter `:70-77`; image `scripts/Dockerfile.migrate`, `:658`), which runs `scripts/migration-rerun.sh`.
  - **Assertions.** `scripts/migration-assertions/*.sql` files run after migration via `psql -v ON_ERROR_STOP=1` (`migration-rerun.sh:183-190`); `fixtures-*` files are skipped. Template: `scripts/migration-assertions/indicators-007.sql` (`DO $$ … RAISE EXCEPTION 'AC-N: …' $$` blocks). Add `config-031.sql`.
  - **Staging the AC-4 fixture.**
    - Config currently takes the catch-all branch `*) … up` (`migration-rerun.sh:78`), so the AC-4 fixture needs a `config) … goto 30` case beside the per-schema cases at `:71-79`.
    - Load the config fixture next to `fixtures-pre-224.sql` (loaded at `:81`, header at `:1-2`).
    - Pass 1, `db-migrate.sh up` (`:86`), then applies 031.
  - **Idempotency proof (optional).** Add 031 to the pass-2 replay list (`:93-103`), which today replays only the 224/225 files.
  - **Red first (P-06).** `config-031.sql` raises against a schema at 030, because the bare rows are present and no full-dotted rows exist.
- **AC-2 getter test.**
  - Reuse the dial-free watcher at `tests/test_config_watcher.py:51-56` (the fails-074 pattern). For the int keys, set `snap.values[key].int_val`.
  - Generalize `_str_watcher` instead of adding a near-duplicate `_int_watcher` (C-18 DRY). Move it to the C-13 home `tests/conftest.py` only if a second test file uses it.
  - Ledger `fails.md:2358-2361`: every getter needs a read-path test against a populated snapshot whose keys are realistic.
- **Write bounds, only if the design adopts them.**
  - Add a full-dotted `SCALAR_BOUNDS_REGISTRY` entry (`configServiceImpl.ts:100-146`), tested in `src/__tests__/setConfigScalarBounds.test.ts`.
  - Never set `minValue: 0` on a key read through `get_int` (CONFIG-11).
  - Ledger `insights.md:3266-3269` favours bounds when a seed makes a tuning key with a large blast radius operator-editable. `insights.md:3271-3274` covers the two-operand lookup.
- **Audit attribution, if set.** Use the `system:<process>` sentinel (`docs/patterns/config-governance.md:93-103`). 029 left `updated_by` NULL.

## Existing Business Rules (preserve / extend)

Folded from the scenario-recon digest. That digest scanned 115 scenarios (config 32, indicators 30, platform 53) plus 13 supplementary UI scenarios, and found 9 relevant. There are **no CHANGE verdicts**: no existing `@AC-*` asserts the production 3000 ms / 64 MiB seed or the bare `sandbox.*` keys. The production row change is an operator data decision recorded in `context.md` (2026-10-20), not a business-rule change.

- **PRESERVE** `@AC-1` "The 800x800 matmul fits within half the default headroom" (`services/xstockstrat-indicators/acceptance/fix-indicators-sandbox-matrix.feature:15`, `@AC-1 @FR-1 @regression @feature-228`). `memory_bytes` is headroom. The heal must not make the 64 MiB production seed effective; default headroom stays 128 MiB. A rename-only fix would halve it.
- **PRESERVE** `@AC-2` "An allocation beyond the headroom fails closed" (`…/fix-indicators-sandbox-matrix.feature:22`, `@AC-2 @FR-2 @regression @feature-228`). Same key, same headroom semantics; the row stays a positive int.
- **PRESERVE** `@AC-3` "The formula budget does not depend on the interpreter's import footprint" (`…/fix-indicators-sandbox-matrix.feature:28`, `@AC-3 @FR-1 @regression @feature-228`). It pins `allowed_imports` `numpy,pandas,math,statistics`. The new row-description `@AC-3` is consistent with it.
- **PRESERVE** `@AC-3` "An infinite-loop / memory-bomb formula is terminated deterministically" (`services/xstockstrat-indicators/acceptance/indicators-sandbox-os-isolation.feature:25`, `@AC-3 @FR-3 @feature-209`). `RLIMIT_CPU` derives from `timeout_ms`, so `timeout_ms` must be 5000 after the heal; the 3000 ms production seed must not become effective.
- **PRESERVE** `@AC-6` "Isolation limits are configured, not hardcoded magic numbers" (`…/indicators-sandbox-os-isolation.feature:46`, `@AC-6 @FR-5 @feature-209`). The limits come from config. This is the property the bug broke for the seeded rows, and the fix restores it.
- **PRESERVE** `@AC-4` "An empty allowed_imports denies all sandbox imports instead of reverting to the permissive default" (`services/xstockstrat-indicators/acceptance/fix-python-config-zero-trap.feature:12`, `@AC-4 @FR-2 @FR-3 @regression @feature-173`). The row stays `string`, and the conflict policy must never overwrite an operator-stored `""`.
- **PRESERVE** `@AC-5` "Concurrent formula executions are no longer serialized to one at a time" (`services/xstockstrat-indicators/acceptance/analysis-concurrency-offload.feature:9`, `@AC-5 @FR-5 @feature-176`). A formula that exceeds `indicators.sandbox.timeout_ms` is still terminated, and `max_concurrent` is untouched.
- **PRESERVE** `@AC-11` "A per-user config value overrides the global value" (`services/xstockstrat-config/acceptance/config-secrets-and-scoping.feature:72`, `@AC-11 @FR-9 @feature-147`). The heal preserves scope (environment × `user_id`), and the FR-4 check uses the full scope tuple, so it never merges a per-user row into a global one.
- **PRESERVE** `@AC-6` "The fundamentals loop still runs the system scoring formula" (`docs/sdd/business-rules/platform.feature:258-259`, `@AC-6 @FR-3 @FR-1 @feature-224`; the digest dropped `@FR-1`). `ExecuteFormula` of the system formula runs under the sandbox limits, and the effective limits do not change.
- **Not impacted:**
  - Scenarios that touch no stored row: feature-228 `@AC-4`/`@AC-5` (OpenBLAS classification, VmData probe), and feature-209 `@AC-1`/`@AC-2`/`@AC-4`/`@AC-5` (network, FS, result identity, `RLIMIT_NPROC` from the unseeded `max_concurrent`).
  - Suites that guard other keys or schemas: the other indicators suites (`indicators` schema, not `config.config_values`); the config suites `readiness-materializer-config-keys`, `opportunity-config-operability`, `surface-signal-weight-decay-config` (`analysis.*` keys); the `config-secrets-and-scoping` secret/redaction ACs (these rows are non-secret, and the heal keeps `is_secret`); and the remaining `platform.feature` entries.
  - UI `config-ui-usability.feature`: `@AC-4`/`@AC-5 @feature-219` render a description only when it is non-empty. The new headroom description is non-empty.
  - The down migration must stay scoped to `indicators.sandbox.*` so it cannot touch the other suites' rows.
- **No EXTEND verdicts.** The feature's `@AC-1`..`@AC-4` are new heal-migration guarantees that no suite covers yet. They are added to the config and indicators suites at promotion (C-16).

## Dependencies

- Proto/RPC: none.
- Migration: next number `031` for `services/xstockstrat-config/migrations/`. Verified 2026-10-20:
  - `origin/main-dev` (51e3cc9b) ends at `030`.
  - `git log --remotes` for `031*` and `032*` is empty.
  - 241's recon on `origin/feature/fix-config-audit-author-spoof` (4b0625aa) says "Migration. None … 031 pre-reserved by 243".
  - Re-verify just before merge (`fails.md:2909-2912`; `docs/reports/2026-10-19-config-seed-migration-late-lower-nnn-defect.md`).
- Config keys: no new key names.
  - The fix renames the existing rows to `indicators.sandbox.timeout_ms` (int), `indicators.sandbox.memory_bytes` (int) and `indicators.sandbox.allowed_imports` (string). `max_concurrent` is untouched.
  - The "Per-Feature Registered Keys" log (`docs/patterns/config-governance.md:105`) has no entry for these keys. Its step list (`:56-61`) applies to new keys, so the design decides whether a row is owed.
- Inter-service edges: indicators → config `WatchConfig` (existing). None new.
- New env vars / ports: none.

## Risks / Not-found

**Not found** (carried from digests and re-greps; never guessed):
- No collision on config 031 on any remote (see Dependencies).
- No config seed-migration test exists: there is no `config-*.sql` in `scripts/migration-assertions/` and no config `goto` case in `scripts/migration-rerun.sh`.
- `SCALAR_BOUNDS_REGISTRY` has no `indicators.*` entry, and nothing writes `create_key` for these keys.
- No per-user (`user_id` non-NULL) `sandbox.*` row is seeded. Rows an operator may have created cannot be ruled out from code; sanctioned psql access is described in `docs/runbooks/operator-db-access.md`. The heal must treat them as possible.
- A pre-existing full-dotted global twin cannot be ruled out from code either. The defect report's alternative remedy, `SetConfig create_key`, would create one.
- Outside migrations 001/002, the only bare `sandbox.*` consumer is `docs/runbooks/config-rollout.md:180`. The repo grep excluded `docs/roadmap/features` and `docs/reports`.
- No test exercises `sandbox_timeout_ms` or `sandbox_memory_bytes` against a stored value.
- Hotfix #1263 is on neither `main` nor `main-dev`.
  - Branch `origin/hotfix/fix-sandbox-overrides-unclamped` now ends at 3e757ea1; `context.md` recorded 3340a7c6.
  - `_clamp_override(override, configured)` returns `min(override, configured) if override > 0 else configured` over `self._cfg.sandbox_*`. Once the rows resolve, the ceiling is the row value. That value (5000 / 134217728) equals the code default, so the hotfix's effect does not change.
  - The hotfix also edits `services/xstockstrat-indicators/CLAUDE.md` and `docs/context-constitution-findings.md`. These overlap 243's `:12` and `:23` edits textually only, so a rebase resolves them.
- Digest 2 reported that the spec files were older than the operator decision. It read the main checkout. On `origin/feature/fix-sandbox-seed-keys` (46410925), `acceptance.feature` already has the `@FR` tags, AC-4 and 5000 / 134217728, and `context.md` records the operator decision. Nothing needs reconciling.

**Design forks and risks:**
1. **FR-4 winner policy.** Two options when a full-dotted twin exists in the same scope tuple:
   - (a) The twin wins and the bare row is deleted. This is consistent with `@AC-4 @feature-173` and with "the values prod effectively runs today", because the twin is what indicators reads now and the bare row is inert.
   - (b) The twin is overwritten to 5000 / 134217728.
   - Under (a), AC-1's production 5000 holds only when no twin exists.
2. **Harness coupling (AC-1 vs AC-4).** `migration-rerun` runs every assertion file against one DB.
   - Under policy (a), an AC-4 fixture of a global production twin at 4000 leaves production at 4000, which fails AC-1's 5000 assertion.
   - Option: the AC-4 assertion stages its own state inside `BEGIN … ROLLBACK` and re-applies 031's SQL, which needs a re-runnable 031.
   - Option: move the fixture to a different scope.
   - Any AC wording change is append-only (C-15).
3. **Missing rows.** If an operator deleted a bare row in some environment, a rename produces no full-dotted row there, but AC-1 expects three rows per environment. Inserting when missing would reuse the 030 `ON CONFLICT` idiom.
4. **Down migration fidelity.** An inverse cannot tell healed rows from pre-existing twins, or from rows dropped under policy (a). Ledger `fails.md:2363-2366` favours forward-only. Restoring the bare rows is also unobservable, because they are inert.
5. **Audit trail.**
   - The production value change (3000→5000, 67108864→134217728) writes `config_audit` rows (`017:69`) with a NULL `changed_by`, unless the migration sets `updated_by` / `update_reason`.
   - A key-only rename writes no audit row but bumps `updated_at` (`017:77`), which surfaces as ListKeys `updated_at` (feature 219).
   - Feature 241 (audit-author spoof; spec-ready on its branch, no migration) changes audit attribution. Re-check at impl-spec.
6. **`default_value`.** It is ListKeys metadata only (CONFIG-2). Production holds 3000 / 67108864 there, so the design either aligns it with `value_data` or leaves it. FR-3 rewrites only the `memory_bytes` description.
7. **Idempotency.** Dirty-state recovery can replay 031 (`docs/reports/2026-10-07-db-migrate-dirty-recovery-replay-unsafe-defect.md`), so every statement should be re-runnable.
8. **No `pg_notify`.** Running subscribers keep their old snapshot until config restarts or redeploys (`configServiceImpl.ts:163,165,515`; CONFIG-4). This is harmless: the row values equal the code defaults, and under policy (a) any twin's value is already live.
9. **Bounds.** Adding them is new write-time validation:
   - It appends `@AC-5+` (C-15) and must follow CONFIG-11.
   - It overlaps 244 (`configServiceImpl.ts:113-117`) and 240 (`:145`).
   - It weighs YAGNI against `insights.md:3266-3269`.
10. **Same defect class, out of scope.** Dead `sandbox_*` copies exist in `services/xstockstrat-analysis/app/config/watcher.py:150-160` and `services/xstockstrat-ingest/app/config/watcher.py:166-178`.
    - Both services subscribe to their own namespaces, so these getters always return defaults, and 031 does not affect them.
    - Resolve findings `:23` narrowly (`fails.md:2243-2246`).
11. **Overlap with 244** (draft, no remote branch). 244 edits `watcher.py` `get_int` (`:114`) and shares `tests/test_config_watcher.py`. Soft ordering: whichever lands second rebases.

**Ledger traps carried** (config / indicators):
- `fails.md:343-346`: never change `value_type` in place; keep int/int/string (CONFIG-10).
- `fails.md:2004-2016`: a registry keyed by the bare column never matches. Any bounds entry must be full-dotted.
- `fails.md:2257-2271`: a key-format migration changes the consumer surface. Grep both the old and new key; done above.
- `fails.md:2333-2336`: verify with a read-back against the getter string, not a row count.
- `fails.md:2358-2361`: add a read-path test against a populated snapshot (AC-2).
- `fails.md:2363-2366`: a blanket heal reactivates dormant seeds. Here the scope is three named keys, and the only rows whose behaviour could change (production timeout and memory) are neutralized by the operator values.
- `fails.md:2516-2527`: this silent-default class keeps recurring across languages, and the candidate CONFIG invariant was never promoted.
- `fails.md:2909-2912`: re-verify the next migration number just before merge.
- `insights.md:905-907`: the snapshot is keyed by the raw `key` column, so a seed must store the exact getter string.

## Recommended Scope

Advisory; input to grilling and `/sdd-spec`.

1. **config migration.** `031_<name>.{up,down}.sql`.
   - Rename the three keys conflict-safely, in both environments and all scopes.
   - Apply the production value literal and decide `default_value`.
   - Rewrite the `memory_bytes` description to headroom.
   - Write the down per the decision on fork 4.
2. **test (DB).**
   - Add `scripts/migration-assertions/config-031.sql` (AC-1, AC-3, AC-4).
   - Add a `migration-rerun.sh` `config) goto 30` case and a config fixture.
   - Optionally add 031 to the pass-2 replay.
   - Shape follows forks 1 and 2.
3. **test (indicators).** Add the AC-2 Scenario Outline (three rows) to `tests/test_config_watcher.py`. It is a getter-contract guard and is not red-first.
4. **docs.**
   - Edit `services/xstockstrat-indicators/CLAUDE.md:12` and `docs/runbooks/config-rollout.md:180`.
   - Resolve findings `:23` narrowly.
   - Add a config-governance log row if the design rules one is owed.
   - Run the context-constitution teardown.
5. **Optional:** add `SCALAR_BOUNDS_REGISTRY` rows plus `@AC-5+`, only if fork 9 is adopted.

# Implementation Spec: enforce-config-key-wiring

**Status**: `in-progress`
**Created**: 2026-10-23
**Feature**: `docs/roadmap/features/278-enforce-config-key-wiring/feature.md`
**Total Steps**: 19
**Feature Branch**: `feature/enforce-config-key-wiring`

---

## Execution Summary

Internal repo tooling and process only; consumer surface is **None** (product spec), so no UI/Agent step is required (C-14 restated as a decision, not an omission). No proto, migration, config key or reader/seed change: the check reads migrations and source and prints keys, never values (F-08). Per design, a zero-dependency Node script `scripts/check-config-wiring.mjs` (plus one stdlib-`ast` Python helper) and its state file `scripts/config-wiring.json` are built bottom-up in red-before-green pairs: seed-side parser (Steps 1-2), reader extraction (3-4), join with collapse and finding kinds (5-6), baseline ratchet and modes (7-8). Then the first real run (9), the OPERATOR environment-baseline decision gate (10), the TS/Go extractor assignment-target fix found while freezing (11, inserted by the 2026-11-02 re-spec), the frozen baseline (12-13), the CI job (14, deliberately after the operator ruling), the `/sdd-execute` and `/sdd-review` process gates (15-18) and the governance doc plus context-map teardown (19).

The environment-baseline gate (Step 10) was resolved on 2026-10-23: there is no production deployment, so the three samples were read on staging and the operator ruled `reported-only`. `policy.envReadUnseeded` in `scripts/config-wiring.json` is `reported` (non-blocking); re-open Step 10 when a production environment is created.

### Scenario Coverage (C-15)

| Scenario | Covered by step(s) |
|---|---|
| @AC-1 form-mismatch | 2 (seed side), 4 (reader side), 6 |
| @AC-2 seeded-unread | 6 |
| @AC-3 read-unseeded | 6 |
| @AC-4 step not done while declared key has a finding | 8 (script), 18 (skill text) |
| @AC-5 unrelated findings do not block | 8, 18 |
| @AC-6 impl-spec without reader step fails review | 18 |
| @AC-7 CI fails on new finding | 8, 13 |
| @AC-8 baseline entry without owner rejected | 8, 13 |
| @AC-9 runtime-built key is `dynamic-read` | 4, 6, 11 |
| @AC-10 migration insert triggers the check | 8, 18 |
| @AC-11 reader step without snapshot-built test fails review | 18 |

## Step Dependencies

- Step 2 [test] covers Step 1 [service]; Step 4 covers Step 3; Step 6 covers Step 5; Step 8 covers Step 7. Each test is authored to fail against the pre-implementation tree (P-06) and `/sdd-execute` captures red before the paired service step.
- Verification commands of the service steps (1, 3, 5, 7) run `node --test scripts/config-wiring.test.mjs`, a file first created in Step 2. `/sdd-execute` runs each test step's red capture first (paired test authored before its service step, P-06), so by the time a service step's Verification runs the paired tests exist; do not run a service step's Verification before its paired test step.
- Step 13 and Step 18 are numbered after the data/text they cover but their red proof is manufactured: Step 13 captures red by running against the empty-shape `config-wiring.json` from Step 7 (`git show <Step-7-sha>:scripts/config-wiring.json` into a scratch root), Step 18 against the pre-Step-15..17 skill files (`git show <sha-before-Step-15>:<path>`); neither step is moved.
- Step 3 requires Step 1 (reuses the stored-set types); Step 5 requires Steps 1 and 3; Step 7 requires Step 5.
- Step 9 requires Steps 1-8 (the script must exist to run).
- Step 10 requires Step 9 (it consumes the first-run `read-unseeded env=` list). It is an OPERATOR step.
- Step 11 requires Steps 3-4 (it changes Step 3's extractor and adds a case to Step 4's suite; one step, test authored red first inside it). Step 12 requires Steps 10 and 11 (the operator ruling must be recorded, and the extractor must stop counting writes, before `findings` freezes). Step 13 covers Step 12.
- Step 14 requires Steps 12 and 13 (CI must not run before the baseline exists and the real-tree test passes).
- Steps 15, 16, 17 are independent of each other; each requires Step 7 (flag names). Step 18 requires Steps 15-17. Step 19 requires Steps 15-18 and runs last.
- Ordering vs PR #1322 (base branch `ccr-fac38b1f-6m24q2`, not merged to `main-dev` at spec time): this feature's artifacts live on that branch; Step 19 records the merge-order row. 243, 244 and 261 will edit `scripts/config-wiring.json` (ratchet) once this lands; Step 19 records that coupling in `docs/roadmap/features/merge-order.md`.
- Out of scope, by decision: fixing any baselined key, any reader or seed edit, runtime enforcement (product spec Out of Scope).

---

### Step 1 — service: Seed-side parser (stored set) and CLI skeleton

**Status**: `done`
**Service**: `scripts/` (repo tooling)
**Files**:
- `scripts/check-config-wiring.mjs` — create

**Reviewers**: Platform Lead — cross-service tooling and SDD process, `xstockstrat-config` owner — stored-key shape and scoping

**Codebase Evidence**:
- Stored form is the raw `key` column: `services/xstockstrat-config/src/grpc/configServiceImpl.ts:276` `byKey[k].values[row.key] = buildConfigValue(row)` (recon.md Codebase Map); only `user_id IS NULL` rows serve global snapshots (`configServiceImpl.ts:265,269,295`, design.md).
- Seed shape: `INSERT INTO config.config_values (namespace, key, value_type, value_data, description, default_value, consuming_service, environment, user_id) VALUES (...)`, confirmed at `services/xstockstrat-config/migrations/025_ingest_mcp_client_keys.up.sql:25-29` (INSERT head; the `mcp_client.request_timeout_seconds` rows are at `:34,37`; multi-row VALUES, `NULL` user_id, `ON CONFLICT ... DO NOTHING`). 001 uses a narrower column list (`001_config_tables.up.sql:55-69`) with the 002 default `'dev'` (`002_config_environment.up.sql:7`); 002 re-inserts production rows for platform, trading, indicators, marketdata, portfolio, analysis (`002_config_environment.up.sql:48-71`) but not ledger `stream.notify_enabled` or trading `fill_poller.interval_ms`.
- Rewrites after seeding, by shape (every `UPDATE`/`DELETE` statement in `grep -ln "DELETE\|UPDATE" *.up.sql` = 001, 009, 010, 016, 017, 020, 029, 031, 032, 034):
  - environment rename: `017_config_secrets_and_scoping.up.sql:38` `UPDATE config.config_values SET environment = 'staging' WHERE environment = 'dev'`; the `config.config_audit` twin at `:39` must NOT match the model.
  - namespace-guarded prefix heal: `029_heal_config_keys_full_dotted.up.sql:24-28` `SET key = namespace || '.' || key WHERE key NOT LIKE namespace || '.%' AND is_secret = false AND namespace IN ('platform','trading','portfolio','marketdata')`.
  - literal-list prefix heal: `031_heal_indicators_sandbox_keys_full_dotted.up.sql:29-46` `SET key = namespace || '.' || key, value_data = CASE ..., ... WHERE namespace = 'indicators' AND key IN ('sandbox.timeout_ms','sandbox.memory_bytes','sandbox.allowed_imports') AND is_secret = false`.
  - twin dedupe DELETE: `031_...up.sql:15-25` `DELETE FROM config.config_values b WHERE b.namespace = 'indicators' AND b.key IN (...) AND b.is_secret = false AND EXISTS (SELECT 1 ... t.key = 'indicators.' || b.key AND t.environment = b.environment AND COALESCE(t.user_id,'') = COALESCE(b.user_id,''))`.
  - literal DELETE: `009_drop_fmp_api_key_config.up.sql:18-20` (`namespace = 'marketdata' AND key = 'secret.marketdata.fmp.api_key'`), `020_remove_analysis_signal_source_weights.up.sql:8-10` (`namespace = 'analysis' AND key = 'signals.source_weights'`), `034_retire_portfolio_snapshot_interval.up.sql:6-8` (`namespace = 'portfolio' AND key IN ('portfolio.snapshot.interval_minutes','snapshot.interval_minutes')`).
  - key-neutral UPDATE (SET list touches no `namespace`/`key`/`environment`/`is_secret`/`user_id`): `016_deprecate_analysis_signal_source_weights_desc.up.sql:9` (description), `032_analysis_zero_trap_descriptions.up.sql:5,11,17,23` (four description-only), `031_...up.sql:74` (description plus `updated_by`/`update_reason`/`caller_identity`).
  - not statements: `001_config_tables.up.sql:50` is `BEFORE UPDATE ON config.config_values` inside `CREATE TRIGGER`; every `UPDATE` hit in `010_config_audit_insert_trigger.up.sql:3-12` is a `--` comment.
- Migration set: `000`..`034` with no `024` up-file (`ls services/xstockstrat-config/migrations`); tip is `034_retire_portfolio_snapshot_interval.up.sql` (031 = feature 243, 032 = 244, 033 = 248 seed-only INSERT, 034 = 264).
- Script-language precedent: `scripts/merge-train-resolve.mjs`, `scripts/workflow-tests/harness.mjs`; `node --test` already runs in CI (`.github/workflows/ci.yml:801`). Exit-code and prefixed-stderr convention to mirror: `scripts/check-migration-contract.sh`.
- **Not found**: any existing config-wiring script, baseline or annotation convention (recon.md Risks; re-checked 2026-11-01).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Create `scripts/check-config-wiring.mjs` (ESM, `#!/usr/bin/env node`, no npm dependency, only `node:` built-ins). Export the pure functions so tests import them; run the CLI only when invoked directly. Flags: `--root <dir>` (default repo root, so fixtures can stand in for the tree), `--final`, `--declared-from <product-spec.md>`, `--declared-migration <file>`, `--keys <ns.key,...>`, `--json`. Exit codes: `0` clean, `1` findings, `2` usage or internal error.
2. Implement `buildStoredSet(root)`: read `services/xstockstrat-config/migrations/*.up.sql` in NNN order (never `*.down.sql`); return a map keyed `(namespace, key, environment)` for rows with `user_id IS NULL` and `is_secret` false; rows with `is_secret=true` go to a separate `secrets` set that is never compared against ordinary readers and whose values are never read or printed (F-08).
3. Statement splitter (strips `--` comments and quoted literals before keyword detection; only statements whose first keyword is `INSERT`, `UPDATE` or `DELETE` are classified, so 001's `CREATE TRIGGER ... BEFORE UPDATE` and 010's comments are never rewrites) plus a closed rewrite model, one case each, applied in NNN order to `config.config_values` only (never `config.config_audit` or any other table):
   1. multi-row `INSERT ... VALUES`, including the 001 narrow column list with the 002 `'dev'` default; `ON CONFLICT ... DO NOTHING` keeps the first row for a `(namespace, key, environment, user scope)`.
   2. environment rename (017): `SET environment='<lit>' WHERE environment='<lit>'`.
   3. namespace-guarded prefix heal (029) with its exact guards (`NOT LIKE namespace || '.%'`, `is_secret = false`, `namespace IN (...)`).
   4. literal-list prefix heal (031:29): `SET key = namespace || '.' || key` plus any other non-scope columns, guarded by `namespace = '<lit>' AND key IN (<lits>) AND is_secret = false`.
   5. twin dedupe DELETE (031:15): removes a bare `(ns, key)` row only when a `ns.key` row exists in the same `(namespace, environment, user scope)`, with the literal `namespace`/`key IN`/`is_secret = false` guards.
   6. literal DELETE (009, 020, 034): `WHERE namespace = '<lit>' AND key (= '<lit>' | IN (<lits>))`, all environments and user scopes.
   7. key-neutral UPDATE (016, 031:74, 032): a SET list naming none of `namespace`, `key`, `environment`, `is_secret`, `user_id`; a no-op on the stored set whatever its WHERE clause.
   Any other `UPDATE`/`DELETE` against `config.config_values` that the model cannot interpret trips the fail-closed trigger (finding kind internal `unmodelled-rewrite`, exit 1) unless allow-listed. The real tree (001-034) must parse with zero `unmodelled-rewrite` and an empty `rewriteAllow` (Step 9 verifies; a new shape is added here with a Step 2 fixture, never allow-listed).
4. The allow-list is read from `config-wiring.json` `registry.rewriteAllow` and keyed on migration file name plus a SHA-256 of the whitespace-normalized statement; never on statement shape or NNN alone (design.md Rejected Alternatives). It exists only for a future statement the model deliberately does not cover, recorded with a one-line reason in the owning feature's `context.md`.
5. Output lines are `file:key:kind[:env]` and never contain values.

**Verification**:
```
node --check scripts/check-config-wiring.mjs && node --test scripts/config-wiring.test.mjs
```

---

### Step 2 — test: Parser fixtures and tests (authored red)

**Status**: `done`
**Service**: `scripts/` (repo tooling)
**Files**:
- `scripts/config-wiring.test.mjs` — create
- `scripts/config-wiring-fixtures/seed/bare-insert/services/xstockstrat-config/migrations/001_seed.up.sql` — create
- `scripts/config-wiring-fixtures/seed/heal-029/services/xstockstrat-config/migrations/001_seed.up.sql` — create
- `scripts/config-wiring-fixtures/seed/heal-029/services/xstockstrat-config/migrations/002_heal.up.sql` — create
- `scripts/config-wiring-fixtures/seed/rename-017/services/xstockstrat-config/migrations/001_seed.up.sql` — create
- `scripts/config-wiring-fixtures/seed/rename-017/services/xstockstrat-config/migrations/002_rename.up.sql` — create
- `scripts/config-wiring-fixtures/seed/unmodelled/services/xstockstrat-config/migrations/001_seed.up.sql` — create
- `scripts/config-wiring-fixtures/seed/unmodelled/services/xstockstrat-config/migrations/002_delete.up.sql` — create
- `scripts/config-wiring-fixtures/seed/scope-and-secret/services/xstockstrat-config/migrations/001_seed.up.sql` — create (also a `001_seed.down.sql` sibling, to prove exclusion)
- `scripts/config-wiring-fixtures/seed/multi-row/services/xstockstrat-config/migrations/001_seed.up.sql` — create
- `scripts/config-wiring-fixtures/seed/heal-031/services/xstockstrat-config/migrations/001_seed.up.sql` — create
- `scripts/config-wiring-fixtures/seed/heal-031/services/xstockstrat-config/migrations/002_heal.up.sql` — create (twin dedupe DELETE, literal-list prefix heal, `ON CONFLICT DO NOTHING` insert, key-neutral UPDATE, in 031's order)
- `scripts/config-wiring-fixtures/seed/literal-delete/services/xstockstrat-config/migrations/001_seed.up.sql` — create
- `scripts/config-wiring-fixtures/seed/literal-delete/services/xstockstrat-config/migrations/002_delete.up.sql` — create (`key =` and `key IN` forms)
- `scripts/config-wiring-fixtures/seed/key-neutral/services/xstockstrat-config/migrations/001_seed.up.sql` — create
- `scripts/config-wiring-fixtures/seed/key-neutral/services/xstockstrat-config/migrations/002_describe.up.sql` — create (description-only UPDATE, plus a `CREATE TRIGGER ... BEFORE UPDATE ON config.config_values` and a `-- UPDATE` comment that must not classify)

**Reviewers**: Platform Lead — cross-service tooling and SDD process

**Codebase Evidence**:
- Test runner and style precedent: `scripts/workflow-tests/merge-train-resolve.test.mjs` (`node:assert/strict`, `node:test`, temp-dir scenarios via `fs.mkdtempSync`); run command `node --test scripts/workflow-tests/*.test.mjs` at `.github/workflows/ci.yml:801`.
- Real shapes the fixtures must reproduce: 001 narrow insert (`001_config_tables.up.sql:55-69`), 002 production re-insert (`002_config_environment.up.sql:48-71`), 017 rename (`017_config_secrets_and_scoping.up.sql:38-39`), 029 heal (`029_heal_config_keys_full_dotted.up.sql:24-28`), 025 bare ingest seed (`025_ingest_mcp_client_keys.up.sql:25-29`, rows `:34,37`), 031 heal sequence (`031_heal_indicators_sandbox_keys_full_dotted.up.sql:15-25,29-46,48-72,74-82`), literal DELETEs (`009_...up.sql:18-20`, `020_...up.sql:8-10`, `034_retire_portfolio_snapshot_interval.up.sql:6-8`), key-neutral UPDATEs (`016_...up.sql:9`, `032_analysis_zero_trap_descriptions.up.sql:5,11,17,23`), non-statements (`001_config_tables.up.sql:50`, `010_config_audit_insert_trigger.up.sql:3-12`).
- Negative matches that must classify as wired (recon.md Patterns to REUSE): fully dotted seeds from 018, 021, 022, 026, 027, 028, 030, 033; ui `performance.*` (023); agent `signal.alert_threshold` (004). Analysis `backtest.max_duration_seconds` is no longer a dead seed: `services/xstockstrat-analysis/app/handlers/servicer.py:795-796` reads `analysis.backtest.max_duration_seconds` (`get_int_present`) while 001:69/002:71 seed it bare, so on the real tree it is a `form-mismatch`; the fixtures here use synthetic keys and do not depend on it.
- Test-data rule (C-13): the fixture migrations have one consumer each in this suite, so they stay inline in `config-wiring-fixtures/`; a second suite reusing one moves it to a shared fixture dir in the same step.

**TDD**: `red-green required`

**Covers**: `AC-1` (seed side only: the stored form is the verbatim `key` column; the reader half is Step 4, the finding Step 6)

**Instructions**:
Author the cases below to fail against the pre-implementation tree (the script does not exist), one fixture each:
1. A bare seed `('ingest','mcp_client.request_timeout_seconds',...)` is stored as `mcp_client.request_timeout_seconds`, not dotted; the script never normalizes.
2. 029 heal fixture: bare keys in `platform|trading|portfolio|marketdata` become `ns.key`; a row already dotted is not double-prefixed; an `is_secret=true` row stays bare; a namespace outside the list is untouched.
3. 017 rename fixture: `dev` rows become `staging`; the `config.config_audit` UPDATE is ignored.
4. `*.down.sql` is excluded; a `user_id` non-NULL row is excluded; a secret row lands in `secrets` and its value text never appears in any output.
5. Fail-closed: an unmodelled `DELETE FROM config.config_values ...` trips `unmodelled-rewrite`; the same statement passes only when allow-listed by file plus statement hash, and fails again when the statement text changes by one token.
6. Multi-row VALUES and duplicate rows per environment produce one stored entry per `(namespace, key, environment)`.
7. 031 heal fixture: bare rows in the literal key list become `ns.key`; a bare row whose dotted twin already exists in the same environment is deleted, not double-entered; a key outside the `IN` list and an `is_secret=true` row stay bare; the following key-neutral UPDATE changes nothing; no `unmodelled-rewrite`.
8. Literal DELETE fixture: both the `key =` and `key IN (...)` forms remove the named key from every environment and leave other keys; no `unmodelled-rewrite`.
9. Key-neutral fixture: a description-only UPDATE leaves the stored set unchanged and raises no `unmodelled-rewrite`; the `CREATE TRIGGER ... BEFORE UPDATE` statement and the `-- UPDATE` comment are not classified as rewrites. An UPDATE whose SET names `key` or `environment` outside cases 2-4 of Step 1 Instructions 3 still trips `unmodelled-rewrite`.

**Verification**:
```
node --test scripts/config-wiring.test.mjs
```
No coverage threshold applies (Node script tests, not a service; C-08 service thresholds are not defined for `scripts/`); the suite is run by the `config-wiring` CI job (Step 14). Lint: `node --check scripts/config-wiring.test.mjs`.

---

### Step 3 — service: Reader extraction (Python `ast`, Go and TypeScript regex)

**Status**: `done`
**Service**: `scripts/` (repo tooling)
**Files**:
- `scripts/check-config-wiring.mjs` — modify
- `scripts/config-wiring-py-reads.py` — create (stdlib `ast` only; invoked as `python3 -I`)

**Reviewers**: Platform Lead — cross-service tooling and SDD process

**Codebase Evidence**:
- Python getter methods over a raw snapshot: ingest `services/xstockstrat-ingest/app/config/watcher.py:116,124,134,142` (`get_str`, `get_int`, `get_bool`, `get_float`) with `get_int_present = get_int` a class-attribute alias at `:132`; analysis `services/xstockstrat-analysis/app/config/watcher.py:103,111,121,129` with aliases `get_int_present = get_int` `:119` and `get_float_present = get_float` `:137`; indicators `services/xstockstrat-indicators/app/config/watcher.py:102,112,120,128` with alias `get_str_present = get_str` `:110`. Call sites use the alias names (e.g. `servicer.py:795` `self._cfg.get_int_present(`), so attribute-name matching covers them.
- Module-level forwarder (feature 244, launched): `int_positive(cfg, key: str, default: int)` defined at `services/xstockstrat-analysis/app/config/watcher.py:142`, `services/xstockstrat-indicators/app/config/watcher.py:155`, `services/xstockstrat-ingest/app/config/watcher.py:213`; the key is argument index 1. Callers: method form `int_positive(self, "ingest.backfill.max_concurrent_jobs", 3)` (ingest `watcher.py:183`, indicators `watcher.py:138,142,152`), imported function form `int_positive(cfg_watcher, "ingest.mcp_client.request_timeout_seconds", ...)` multi-line (`services/xstockstrat-ingest/app/engine/mcp_client_loop.py:165-167`), `int_positive(self._cfg, "analysis.screener.max_duration_seconds", 120)` (`services/xstockstrat-analysis/app/handlers/servicer.py:3833`), multi-line `fundsignal_loop.py:156-158`.
- Python shapes the AST must resolve: multi-line call `services/xstockstrat-analysis/app/engine/fundsignal_loop.py:156-158` (`int_positive(` over three lines) and `servicer.py:795-796` (`get_int_present(` over two); plain literal `fundsignal_loop.py:144` `self._cfg.get_bool("analysis.fundsignal.enabled", default=False)`; same-file constant `services/xstockstrat-agent/app/tools.py:78` `_ALERT_THRESHOLD_CONFIG_KEY = "signal.alert_threshold"`; cross-watcher read `fundsignal_loop.py:105` (`md_config_watcher.get_str("marketdata.fundamentals.provider", "")`).
- Go getters: `Watcher.GetString/GetInt/GetFloat/GetBool` at `services/xstockstrat-portfolio/internal/config/config.go:112,126,140,170`, `services/xstockstrat-trading/internal/config/config.go:205,215,225,235`, `services/xstockstrat-marketdata/internal/config/config.go:142,156,170,184`. Indirection: parameterized helper `services/xstockstrat-marketdata/internal/service/marketdata_service.go:986` `func resolvePositiveInt(cfg intGetter, key string, def int64) int64`; constant read `services/xstockstrat-portfolio/internal/config/config.go:160` `w.GetString(FactorMapKey, "{}")`.
- TypeScript: index syntax `this.snapshot?.values[key]` at `services/xstockstrat-ledger/src/services/configWatcher.ts:108,113,118,123` (and the config/notify/identity equivalents); direct index `services/xstockstrat-ui/src/lib/performanceMetrics.ts:193` `values['performance.risk_free_rate_annual']`.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. `config-wiring-py-reads.py`: walk `services/*/app/**/*.py` (skip `tests/`), use `ast` to find calls whose attribute or name is one of the getter names (`get_str`, `get_int`, `get_int_present`, `get_bool`, `get_float`, `get_float_present`, `get_str_present`; the `*_present` names are matched as call names even though they are class-attribute aliases, not `def`s) or `.values.get(...)`/`.values[...]` on a snapshot; for these the key is argument 0. It also receives the Python entries of `registry.forwarders` (passed by the Node script as a JSON argument) and treats a call whose callee name (bare `Name` or `Attribute.attr`) equals a registered forwarder symbol of the same service as a read of argument `keyArg`. Resolve the key argument: string literal, or a module-level `Name` bound to a string literal in the same file; anything else is reported as `{"file","symbol","line","dynamic":true}`. Getter calls inside the body of a registered forwarder whose key argument is the forwarder's own key parameter are the pass-through, not a read, and are skipped. Emit JSON on stdout.
2. In the Node script add `extractGoReads` and `extractTsReads`: regex over the `Get(String|Int|Float|Bool)\(` call and the `values\[`-index syntax; match across line breaks (`s` flag, balanced to the first argument) so a literal split over lines is not misreported; resolve a bare identifier through a same-service constant (`const X = "..."` / Go `const`/`var`) found in the same package or imported same-service file; otherwise `dynamic-read`. The same forwarder rule applies (calls to a registered Go/TS forwarder read `keyArg`; its own pass-through body is skipped).
3. Add `registry.forwarders` (key `file:symbol` of the helper, value `{"keyArg": <index>}`): calls to a registered helper are treated as getter calls on the given argument. The real tree needs, at minimum, the three `int_positive` definitions (`services/xstockstrat-{analysis,indicators,ingest}/app/config/watcher.py:int_positive`, `keyArg` 1) and `services/xstockstrat-marketdata/internal/service/marketdata_service.go:resolvePositiveInt` (`keyArg` 1); Step 12 records them. Without these entries every `int_positive` read (ingest `watcher.py:183`, `mcp_client_loop.py:165`, analysis `servicer.py:3833`, ...) would be missed and the three helper bodies would report false `dynamic-read`. Add `registry.dynamic` (key `file:symbol`, value an array of the keys that call site can produce): an enumerated dynamic site yields those reads instead of a `dynamic-read` finding. The registry lives in `scripts/config-wiring.json` (design: no reader may be edited, no in-code annotation).
4. Cross-namespace reads are not matched by the consuming service's namespace: reads are plain strings joined against the whole stored set.
5. Never read `GetSecret` calls as ordinary reads.

**Verification**:
```
node --check scripts/check-config-wiring.mjs && python3 -I -m py_compile scripts/config-wiring-py-reads.py && node --test scripts/config-wiring.test.mjs
```

---

### Step 4 — test: Reader-extraction fixtures and tests (authored red)

**Status**: `done`
**Service**: `scripts/` (repo tooling)
**Files**:
- `scripts/config-wiring.test.mjs` — modify
- `scripts/config-wiring-fixtures/readers/services/xstockstrat-analysis/app/literal_and_const.py` — create (multi-line call, same-file constant)
- `scripts/config-wiring-fixtures/readers/services/xstockstrat-analysis/app/dynamic_fstring.py` — create (`f"analysis.{name}.enabled"`)
- `scripts/config-wiring-fixtures/readers/services/xstockstrat-analysis/tests/ignored_test_reader.py` — create (must not be scanned)
- `scripts/config-wiring-fixtures/readers/services/xstockstrat-marketdata/internal/service/forwarder.go` — create (`resolvePositiveInt`-shaped helper and two callers)
- `scripts/config-wiring-fixtures/readers/services/xstockstrat-marketdata/internal/config/split_literal.go` — create (literal split over two lines, constant, `GetSecret`)
- `scripts/config-wiring-fixtures/readers/services/xstockstrat-ui/src/lib/index_reads.ts` — create (`values['...']` literal and `values[key]` dynamic)
- `scripts/config-wiring-fixtures/readers/services/xstockstrat-ingest/app/config/watcher.py` — create (module-level `int_positive(cfg, key, default)` forwarder whose body calls `cfg.get_int(key, default)`, a method-form caller `int_positive(self, "<lit>", 3)` and a `get_int_present = get_int` alias with a caller)
- `scripts/config-wiring-fixtures/readers/services/xstockstrat-ingest/app/engine/forwarder_caller.py` — create (imported-function caller `int_positive(cfg_watcher, "<lit>", ...)` split over three lines)

All Files are new fixtures (create); nothing pre-exists under `scripts/config-wiring-fixtures/`.

**Reviewers**: Platform Lead — cross-service tooling and SDD process

**Codebase Evidence**:
- Real call shapes to copy into fixtures: `fundsignal_loop.py:144` (literal), `fundsignal_loop.py:156-158` and `servicer.py:795-796` (multi-line), `tools.py:78` (constant), `marketdata_service.go:986` (Go forwarder `resolvePositiveInt(cfg intGetter, key string, def int64)`), Python module-level forwarder `int_positive(cfg, key, default)` (`services/xstockstrat-ingest/app/config/watcher.py:213-216`; callers `watcher.py:183` method form and `services/xstockstrat-ingest/app/engine/mcp_client_loop.py:165-167` imported multi-line form), class-attribute alias `get_int_present = get_int` (`ingest watcher.py:132`), `portfolio/internal/config/config.go:160` (constant), `performanceMetrics.ts:193` (index), `configWatcher.ts:108` (parameter `key` -> dynamic).
- Dynamic example for @AC-9: an f-string key `f"analysis.{name}.enabled"` where `name` is a function parameter; digest found no such runtime f-string getter in analysis `app/` today (recon.md Risks), so the fixture is synthetic.
- Quality gate from design.md: the count of false-dynamic-read entries (a literal argument split across lines) in the Go and TS extractors must be zero.

**TDD**: `red-green required`

**Covers**: `AC-1` (reader side: both strings are extracted verbatim), `AC-9` (runtime-built key is reported, not skipped)

**Instructions**:
Author failing cases: (a) Python multi-line call and same-file constant resolve to the literal; (b) Python `f"analysis.{name}.enabled"` with `name` a parameter produces exactly one dynamic entry naming file and symbol; (c) the same site listed in `registry.dynamic` resolves to its enumerated keys and produces no dynamic entry; (d) Go literal split over two lines resolves (false-dynamic count = 0); (e) Go `resolvePositiveInt(cfg, key, def)` is dynamic without a forwarder entry and resolves at its callers with one; (f) Go and Python constants resolve; (g) TS `values['performance.risk_free_rate_annual']` and `this.snapshot?.values[key]` classify as literal and dynamic respectively; (h) a `GetSecret("x")` call is not extracted as an ordinary read; (i) a `tests/` file is not scanned; (j) with `int_positive` in `registry.forwarders` (`keyArg` 1), both Python callers (method form and imported multi-line form) resolve to their argument-1 literal and the forwarder body's `cfg.get_int(key, default)` yields no `dynamic-read`; without the entry the callers yield no read and the body yields exactly one `dynamic-read`; (k) a call through the `get_int_present` alias resolves its literal like `get_int`.

**Verification**:
```
node --test scripts/config-wiring.test.mjs
```
No coverage threshold applies (tooling). Lint: `node --check scripts/config-wiring.test.mjs && python3 -I -m py_compile scripts/config-wiring-py-reads.py`.

---

### Step 5 — service: Join with collapse, finding kinds and output

**Status**: `done`
**Service**: `scripts/` (repo tooling)
**Files**:
- `scripts/check-config-wiring.mjs` — modify

**Reviewers**: Platform Lead — cross-service tooling and SDD process, `xstockstrat-config` owner — stored-key and environment scoping

**Codebase Evidence**:
- The join compares the reader string to the stored `key` verbatim: `configServiceImpl.ts:188`; the four finding kinds are FR-1 (`seeded-unread`, `read-unseeded`, `form-mismatch`, `dynamic-read`) in `product-spec.md`.
- Environment axis rationale: 002 back-fills via the column `DEFAULT 'dev'` (`002_config_environment.up.sql:7`) and 017 renames `dev` to `staging` (`017_config_secrets_and_scoping.up.sql:38`), so any 001-era key that 002:48-71 does not re-insert for production appears staging-only offline (design.md).
- Output convention: `file:key:kind[:env]`, never values (design.md; F-08).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. `join(stored, reads, registry)`: compute findings per `(namespace, key, environment)`, then group by `(namespace, key, kind)`.
2. A stored `(ns, key)` is wired iff some read equals `key` verbatim. If no read equals `key` but a read equals `ns + '.' + key` (bare seed read dotted) or `key` equals `<ns>.` + read (dotted seed read bare), emit ONE `form-mismatch` naming both strings, and suppress the paired `seeded-unread` and `read-unseeded`.
3. A stored key with no read and no mismatch partner is `seeded-unread` (file = migration that last seeded it). A read matching no stored key and no mismatch partner is `read-unseeded` (file = reader file). A dynamic read is `dynamic-read` (file:symbol).
4. Collapse: a key missing from every environment yields exactly one finding with no `env`; `:env` is appended only when the key is seeded in some environments and absent in others (one finding listing the missing envs). No fifth kind.
5. Secret rows and `GetSecret` reads are excluded from ordinary comparison.
6. Sort output deterministically; exit `1` on any finding in scope, `0` otherwise.

**Verification**:
```
node --check scripts/check-config-wiring.mjs && node --test scripts/config-wiring.test.mjs
```

---

### Step 6 — test: Join and finding-kind tests (authored red)

**Status**: `done`
**Service**: `scripts/` (repo tooling)
**Files**:
- `scripts/config-wiring.test.mjs` — modify
- `scripts/config-wiring-fixtures/join/mismatch/` — create (one `services/xstockstrat-config/migrations/001_seed.up.sql` plus one reader file under `services/xstockstrat-ingest/app/`)
- `scripts/config-wiring-fixtures/join/seeded-unread/` — create (seed file only)
- `scripts/config-wiring-fixtures/join/read-unseeded/` — create (reader file only)
- `scripts/config-wiring-fixtures/join/env-collapse/` — create (seed files for both-env-missing and production-only cases)
- `scripts/config-wiring-fixtures/join/negative-matches/` — create (dotted seeds, ui `performance.*`, agent `signal.alert_threshold` with matching readers)
- `scripts/config-wiring-fixtures/join/secret/` — create (secret seed row and a `GetSecret` reader)
(Each directory is a self-contained `--root`; exact file names inside follow the `seed/` and `readers/` layouts above.)

**Reviewers**: Platform Lead — cross-service tooling and SDD process

**Codebase Evidence**:
- Scenario keys (illustrative, per `acceptance.feature` comment): `ingest` `mcp_client.request_timeout_seconds` read as `ingest.mcp_client.request_timeout_seconds`; `ledger` `stream.notify_enabled` (seed `001_config_tables.up.sql:65`) with no reader; `ingest.backfill.retry_on_failure` read at `services/xstockstrat-ingest/app/config/watcher.py:187` (`self.get_bool(...)`) with no seed (recon.md Baseline source; re-checked 2026-11-01, still no reader for `stream.notify_enabled` and no seed for `retry_on_failure`).
- Negative matches: dotted seeds 018/021/022/026/027/028/030/033, ui `performance.*`, agent `signal.alert_threshold`, 029-healed and 031-healed keys.

**TDD**: `red-green required`

**Covers**: `AC-1, AC-2, AC-3, AC-9`

**Instructions**:
Failing cases, each asserting the exact `file:key:kind[:env]` line: (1) @AC-1 bare seed + dotted read -> one `form-mismatch` naming both strings, and no extra `seeded-unread`/`read-unseeded` for the pair; (2) @AC-2 -> one `seeded-unread` for `ledger` `stream.notify_enabled`; (3) @AC-3 -> one `read-unseeded` for `ingest.backfill.retry_on_failure`; (4) @AC-9 dynamic f-string -> one `dynamic-read`; (5) EXTEND @AC-1: a key missing in both environments yields exactly one finding with no `:env`; seeded in `production` only yields `...:staging`; (6) PRESERVE @AC-3: still one finding per `(namespace, key, kind)`; (7) negative matches classify as wired with zero findings; (8) a secret row and a `GetSecret` read produce no finding and no value text in the output.

**Verification**:
```
node --test scripts/config-wiring.test.mjs
```
No coverage threshold applies (tooling). Lint: `node --check scripts/config-wiring.test.mjs`.

---

### Step 7 — service: Baseline ratchet, modes, declared keys and policy

**Status**: `done`
**Service**: `scripts/` (repo tooling)
**Files**:
- `scripts/check-config-wiring.mjs` — modify
- `scripts/config-wiring.json` — create (empty-shape: `{"policy":{"envReadUnseeded":"reported"},"findings":[],"registry":{"forwarders":{},"dynamic":{},"rewriteAllow":[]}}`)

**Reviewers**: Platform Lead — cross-service tooling and SDD process

**Codebase Evidence**:
- Baseline-with-owner precedent: `.jscpd.json` and `scripts/check-duplication.sh` are the repo's only baseline-style files, but they are threshold-only (`minTokens: 100`, `DUP_REPORT_ONLY=1`), with no per-entry owner; so the owner-bearing ratchet is **Not found**, built new.
- Step-time versus completion gate: `.claude/skills/sdd-execute/SKILL.md:289` (Verification runs before the `done` flip at `:298-299`); step bodies immutable (`SKILL.md:487`, F-09).
- Declared-key sources (FR-2): product spec `## Config Key Changes` (`.claude/skills/sdd-story/SKILL.md:198-201`) and a migration inserting into `config.config_values` (@AC-10). The overlap-check regex ``[a-z][a-z-]+\.[a-z]+\.[a-z_]+`` (`.claude/skills/sdd-review/reference/overlap-check.md:25,53`) matches only three-segment keys, so this step defines its own pattern.
- Owners to be recorded in entries (Step 12): feature 278 and feature 243. Feature 277 (`fix-ingest-seeded-config-keys`) is `demoted/canceled` (`docs/roadmap/features/277-fix-ingest-seeded-config-keys/status.md`), and the operator ruled on 2026-11-01 (context.md, "operator ruling at the sdd-batch-execute up-front gate") that no entry may name it and the owner regex drops 277. Feature 243 is still `in-progress`.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Validate `config-wiring.json` on every run: each `findings[]` entry must carry `namespace`, `key`, `kind`, optional `envs` (list), and a non-empty `owner` matching `^(feature )?(243|278)\b|^(defect|feature) .+` (277 removed by the 2026-11-01 operator ruling); an entry without an owner makes the run fail naming the entry (@AC-8). Schema errors exit `2`.
2. Ratchet (`--final` and CI): a produced finding not in `findings` fails and is named (@AC-7); a `findings` entry that no longer occurs fails as stale; an entry whose `envs` list is larger than the produced env list fails as stale-in-part, so fixing one environment forces shrinking the entry (env-list ratchet); entries may only shrink.
3. `policy.envReadUnseeded`: `blocking` | `reported`. Under `reported`, env-scoped `read-unseeded` findings (those with `:env`) are printed prefixed `REPORTED:` and do not affect the exit code or the ratchet. Default `reported` until the operator ruling at Step 10.
4. Modes. Default (step-time, non-final): `form-mismatch`, `dynamic-read`, `unmodelled-rewrite`, and declared-key findings that are not missing-side are failures; missing-side `seeded-unread` and `read-unseeded` for declared keys are printed `PENDING:` and do not fail. `--final`: full ratchet, PENDING becomes failure. Without a declared-key source, step-time mode checks no key and exits `0` (@AC-5).
5. Declared keys: `--declared-from <product-spec.md>` extracts backticked tokens matching `[a-z][a-z0-9_]*(\.[a-z0-9_]+)+` inside the `## Config Key Changes` section only; `--declared-migration <file>` extracts `(namespace, key)` from `INSERT INTO config.config_values` rows in that migration (@AC-10); `--keys` is an explicit list. Step-time filtering restricts failures to the union of declared keys; unrelated baseline findings never block.

**Verification**:
```
node --check scripts/check-config-wiring.mjs && node -e "JSON.parse(require('fs').readFileSync('scripts/config-wiring.json','utf8'))" && node --test scripts/config-wiring.test.mjs
```

---

### Step 8 — test: Ratchet, owner, mode and declared-key tests (authored red)

**Status**: `done`
**Service**: `scripts/` (repo tooling)
**Files**:
- `scripts/config-wiring.test.mjs` — modify
- `scripts/config-wiring-fixtures/ratchet/new-finding/` — create (`--root` tree: seed with no reader, plus a `config-wiring.json` with empty `findings`)
- `scripts/config-wiring-fixtures/ratchet/no-owner/config-wiring.json` — create
- `scripts/config-wiring-fixtures/ratchet/stale-in-part/` — create (tree plus `config-wiring.json` with an oversized `envs` list)
- `scripts/config-wiring-fixtures/ratchet/step-time/` — create (tree with a `form-mismatch` for `analysis.fundsignal.enabled` and an unrelated `ledger` `stream.notify_enabled` finding)
- `scripts/config-wiring-fixtures/ratchet/two-step/` — create (seed-only and reader-only variants)
- `scripts/config-wiring-fixtures/ratchet/declared/product-spec.md` — create (backticked keys inside and outside `## Config Key Changes`)
- `scripts/config-wiring-fixtures/ratchet/declared/migration.up.sql` — create
- `scripts/config-wiring-fixtures/ratchet/policy/` — create (tree plus two `config-wiring.json` files, `reported` and `blocking`)

**Reviewers**: Platform Lead — cross-service tooling and SDD process

**Codebase Evidence**:
- Acceptance wording: `acceptance.feature` @AC-4, @AC-5, @AC-7, @AC-8, @AC-10; PRESERVE @AC-5/@AC-10 from design.md Business Rules Touched.
- Key examples: `analysis.fundsignal.enabled` (`services/xstockstrat-analysis/app/engine/fundsignal_loop.py:144`; seeded bare in `008_analysis_fundsignal_keys.up.sql:13-14`); `ledger` `stream.notify_enabled` (`001_config_tables.up.sql:65`, no reader).

**TDD**: `red-green required`

**Covers**: `AC-4, AC-5, AC-7, AC-8, AC-10`

**Instructions**:
Failing cases: (1) @AC-7 a fixture seeding a key with no reader and not in `findings` -> exit 1 under `--final`, output names the finding; (2) @AC-8 an entry with empty or missing `owner` -> exit non-zero naming the entry; (3) env-list ratchet: an entry with `envs:["staging","production"]` while only `staging` is still produced fails as stale-in-part, and passes once shrunk; (4) @AC-4 step-time with `--keys analysis.fundsignal.enabled` and a `form-mismatch` for it -> exit 1 naming finding and key; (5) @AC-5 step-time with no declared key and an unrelated `ledger.stream.notify_enabled` finding -> exit 0; (6) @AC-10 `--declared-migration` on a non-config-typed migration inserting the key -> check runs and fails on a finding; (7) two-step fixtures: seed then reader passes step-time (PENDING) and fails `--final` while the reader leg is missing; reader then seed likewise; (8) `policy.envReadUnseeded:"reported"` never changes the exit code; `blocking` does; (9) `--declared-from` reads keys only from `## Config Key Changes`, ignoring backticked keys elsewhere in the spec.

**Verification**:
```
node --test scripts/config-wiring.test.mjs
```
No coverage threshold applies (tooling). Lint: `node --check scripts/config-wiring.test.mjs`.

---

### Step 9 — docs: First offline run on the real tree (record counts, no baseline yet)

**Status**: `done`
**Service**: `docs/roadmap/features/278-enforce-config-key-wiring/`
**Files**:
- `docs/roadmap/features/278-enforce-config-key-wiring/context.md` — modify (append the run record)

**Reviewers**: none

**Codebase Evidence**:
- Reference sweep (feature 277, `demoted/canceled`; its branch `feature/fix-ingest-seeded-config-keys` no longer exists): `docs/roadmap/features/277-fix-ingest-seeded-config-keys/recon.md:86-101` on `main-dev` (table header `:88`). Its line refs are stale; the current reader locations are below.
- Expected set on the current tree (migrations 000-034), re-derived 2026-11-01 by grep; the run is authoritative and this list is what the run is reconciled against:
  - `form-mismatch`, ingest (5): `backfill.chunk_max_bars`, `backfill.chunk_window_days`, `backfill.max_concurrent_chunks` (seeded bare by 005; read dotted via `int_positive` at ingest `watcher.py:196,200,205`), `mcp_client.poll_interval_seconds`, `mcp_client.request_timeout_seconds` (seeded bare by `025_ingest_mcp_client_keys.up.sql:28-37`; read dotted via `int_positive` at `mcp_client_loop.py:165,191`).
  - `form-mismatch`, analysis (14): the twelve `fundsignal.*` keys (008, e.g. `analysis.fundsignal.enabled` at `fundsignal_loop.py:144`), `scoring.signal_decay_half_life_hours` (019), and `backtest.max_duration_seconds` (001:69 / 002:71 bare; now read dotted at `servicer.py:795-796`, so it moved from the sweep's dead-seed group to `form-mismatch`).
  - `seeded-unread` (1): `ledger` `stream.notify_enabled` (`001_config_tables.up.sql:65`, staging only offline: 002 does not re-insert it).
  - `read-unseeded`: `ingest.backfill.max_concurrent_jobs` (`watcher.py:183`, `int_positive`), `ingest.backfill.retry_on_failure` (`:187`), `ingest.backfill.max_retry_attempts` (`:191`), `ingest.signals.dedup_window_hours` (`:210`), `analysis.fundsignal.retry_seconds` (`fundsignal_loop.py:151,162`), `analysis.fundsignal.startup_jitter_seconds` (`:170`), and `indicators.sandbox.max_concurrent` (indicators `watcher.py:152`; feature 243's product spec lists it as "no seed exists; not part of this defect").
  - Expected gone: `indicators.sandbox.timeout_ms`/`memory_bytes`/`allowed_imports` (healed to dotted by 031 for both environments; the readers are dotted at indicators `watcher.py:138,142,147`); `portfolio.snapshot.interval_minutes` (deleted by 034, reader removed by 264); `ledger.stream.resolve_timeout_ms` (033 seeds it dotted).
- Open-risk checks to close here: (a) no migration after 017 renames environments again (031-034 contain no `SET environment`); (b) no migration trips the fail-closed trigger: 002, 005, 025 and 033 are INSERT-only, and 009, 016, 020, 031, 032, 034 must classify under Step 1 Instructions 3 cases 4-7.

**TDD**: `N/A (non-code-bearing: records a run, writes no code)`

**Covers**: —

**Instructions**:
1. Run `node scripts/check-config-wiring.mjs --final --json > <scratchpad>/first-run.json` with `findings` empty. Do not run any staging or production read or write.
2. Append a `## Session <date> — sdd-execute 278 step 9` block to `context.md` with: total finding counts per kind; the list of `read-unseeded env=` entries (count and keys); the reconciliation of the produced list against the expected set above, stating any difference and its cause; the result of the two open-risk checks. Any migration shape that trips `unmodelled-rewrite` is added to the closed model (Step 1 Instructions 3) with a fixture in Step 2's suite, never allow-listed by weakening the trigger (log it in the `## Deviation Log`); `registry.rewriteAllow` stays empty.
3. Record the proposed owner for each group: `feature 278` for every form mismatch, the dead seed and every unseeded key (operator ruling 2026-11-01: 277 is canceled, its entries collapse to 278); `feature 243` only for a remaining `indicators.sandbox.*` finding that 243's spec claims (expected: none after 031, since 243 excludes `sandbox.max_concurrent`).

**Verification**:
```
node scripts/check-config-wiring.mjs --final --json | node -e "const j=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log(Object.keys(j))" && grep -n "sdd-execute 278 step 9" docs/roadmap/features/278-enforce-config-key-wiring/context.md
```

---

### Step 10 — docs: OPERATOR decision gate — environment baseline

> **Resolved 2026-10-23 (operator):** there is no production deployment, so the production reads in the Instructions below do not apply. The three samples were read on **staging** (read-only `get_config`): `ledger` `stream.notify_enabled` present, stored bare; `trading` `trading.fill_poller.interval_ms` present, stored dotted (after the 029 heal); `platform` `platform.maintenance_mode` present, stored dotted. The operator ruled **reported-only**: findings that exist only in the `production` environment are printed as `REPORTED:` and stay out of the ratchet; staging findings are blocking. `policy.envReadUnseeded` stays `reported`. Re-open this step, and re-run the production sampling below, when a production environment is created. Step 10's record is in `context.md` ("environment-baseline decision").

**Status**: `done`
**Service**: `docs/roadmap/features/278-enforce-config-key-wiring/`
**Files**:
- `docs/roadmap/features/278-enforce-config-key-wiring/context.md` — modify (one confirmation line in the Step 9/10 session entry; the operator record itself already exists)

**Reviewers**: none

**Codebase Evidence**:
- Already resolved: `context.md` "## Session 2026-10-23 — environment-baseline decision (operator)" holds the three staging samples and the line "**environment-baseline decision (operator ruling): reported-only.**"; the 2026-11-01 operator ruling at the sdd-batch-execute gate says to treat Step 10 as resolved and confirm/flip it, not reopen it. There is no production deployment, so no production read is possible or required.
- The implementation session has only the staging MCP (`mcp__xstockstrat_staging__get_config`), which reads only its own deployment's environment; no step may assume the agent can read production.
- Why the gate existed: 002 back-fills 001-era rows via `DEFAULT 'dev'` (`002_config_environment.up.sql:7`) and 017 renames dev to staging (`017_config_secrets_and_scoping.up.sql:38`); 002:48-71 re-inserts production rows for platform, trading (four approval/risk keys), indicators, marketdata, portfolio and analysis, but **not** `ledger` `stream.notify_enabled` (001:65) or `trading` `fill_poller.interval_ms` (001:61). Offline they appear staging-only.
- Sampled 001-era keys (chosen to span the gap): `ledger` `stream.notify_enabled`; `trading` `fill_poller.interval_ms` (after the 029 heal, stored as `trading.fill_poller.interval_ms` if present); control `platform` `maintenance_mode` (re-inserted for production by `002:48`).

**TDD**: `N/A (confirmation of a recorded operator ruling; no code)`

**Covers**: —

**Instructions**:
Confirmation step, run by the executor right after Step 9; nothing is read from or written to any environment:
1. Confirm the 2026-10-23 record exists in `context.md` and its ruling is `reported-only`, and that `scripts/config-wiring.json` `policy.envReadUnseeded` is `reported`.
2. Check Step 9's `read-unseeded env=` list against the ruling: env-scoped findings print `REPORTED:` and stay out of the ratchet; staging findings are blocking. Append one line to the Step 9 session entry: "Step 10 confirmed: reported-only (2026-10-23 operator ruling), N env-scoped findings reported".
3. Flip this step `done`; do not stop at an operator gate. Re-open it, and run the production `get_config` sampling of `ledger`, `trading` and `platform` (read-only, `get_config(namespace=...)` with `user_id` empty, against the production-deployed agent), only when a production deployment exists.

**Verification**:
```
grep -n "environment-baseline decision (operator ruling): reported-only" docs/roadmap/features/278-enforce-config-key-wiring/context.md && grep -n "Step 10 confirmed: reported-only" docs/roadmap/features/278-enforce-config-key-wiring/context.md && node -e "const j=JSON.parse(require('fs').readFileSync('scripts/config-wiring.json','utf8')); if (j.policy.envReadUnseeded!=='reported') process.exit(1)"
```

---

### Step 11 — service: TS/Go `values[...]` assignment targets are writes, not reads

**Status**: `done`
**Service**: `scripts/` (repo tooling)
**Files**:
- `scripts/check-config-wiring.mjs` — modify
- `scripts/config-wiring.test.mjs` — modify
- `scripts/config-wiring-fixtures/readers/services/xstockstrat-ui/src/lib/index_writes.ts` — create
- `scripts/config-wiring-fixtures/readers/services/xstockstrat-marketdata/internal/config/index_writes.go` — create

**Reviewers**: Platform Lead — cross-service tooling and SDD process

**Codebase Evidence**:
- `scripts/check-config-wiring.mjs:382` `const INDEX_RE = /\bvalues\s*(?:\?\.\s*)?\[/g` matches every `values[` index, and `extractRegexReads` (`:537`, sites built at `:550`) turns each match into a read or a `dynamic-read` with no check of whether the index is an assignment target, for both `lang === 'go'` and `'ts'`.
- The Python extractor already reads only loads: `scripts/config-wiring-py-reads.py:97` `isinstance(node.ctx, ast.Load)`.
- Real-tree false `dynamic-read` sites this causes (reported by the Step 11 freeze attempt, blocker on 2026-11-02, before this re-spec): `services/xstockstrat-config/src/grpc/configServiceImpl.ts:50-54` (`values[k] = { ... }`), `:276` (`byKey[k].values[row.key] = buildConfigValue(row);`), `:300` (`values[row.key] = buildConfigValue(row);`).
- Test harness: `scripts/config-wiring.test.mjs` reader cases (a)-(k) run `cw.extractReads(READERS, reg())` over `scripts/config-wiring-fixtures/readers/` with helpers `readKeys` / `dynSites`; case (g) covers TS index reads in `services/xstockstrat-ui/src/lib/index_reads.ts`, case (d) asserts zero false `dynamic-read` under `${GO_MD}/config/`.

**TDD**: `red-green required` (paired test inside this step: author case (l) and its two fixtures first, capture red, then change the extractor)

**Covers**: `AC-9`

**Instructions**:
1. Add the two fixtures. TS `index_writes.ts`: `values[k] = x`, `obj.values[row.key] = y`, `values['performance.window_days'] = z` (literal write), plus two controls that ARE reads: a comparison `if (values['analysis.breakout.enabled'] == y)` and a plain read `const v = values['performance.risk_free_rate_annual']`. Go `index_writes.go`: `values[k] = x` and `cfg.values["marketdata.feed.enabled"] = true`, plus one read `v := values["marketdata.feed.symbols"]`.
2. Add test (l) "TS and Go `values[...]` assignment targets are neither reads nor dynamic-reads": assert `readKeys` for each fixture equals only its read control, and `dynSites` for each fixture is `[]`. Capture red (the writes appear as reads/dynamic-reads).
3. In `extractRegexReads`, skip an `INDEX_RE` site whose balanced closing `]` is followed by optional whitespace and a single `=` that is not part of `==`, `===` or `=>` (compound assignments `+=`, `??=`, `||=` are also writes and are skipped). Getter calls and forwarder calls are unaffected. Do not add a registry entry for these sites (Step 12 Instruction 4).
4. Re-run the real-tree run and record in `context.md` that the three `configServiceImpl.ts` sites no longer appear and that no previously reported read disappeared (diff the read-key set before/after).

**Verification**:
```
node --test scripts/config-wiring.test.mjs && node --check scripts/check-config-wiring.mjs && ! node scripts/check-config-wiring.mjs --final | grep -E 'configServiceImpl\.ts:[A-Za-z_]+:dynamic-read' && echo OK
```
No coverage threshold applies (tooling). Lint: `node --check scripts/config-wiring.test.mjs`.

---

### Step 12 — docs: Freeze baseline `findings` and `registry`

**Status**: `done`
**Service**: `scripts/` (repo tooling)
**Files**:
- `scripts/config-wiring.json` — modify
- `docs/roadmap/features/278-enforce-config-key-wiring/context.md` — modify (final counts, owner overrules)

**Reviewers**: Platform Lead — baseline contents and ownership, `xstockstrat-config` owner — key list

**Codebase Evidence**:
- Contents come from Step 9's run and the Step 10 ruling (`reported-only`); the expected set is Step 9's Codebase Evidence (re-derived against migrations 000-034), with `docs/roadmap/features/277-fix-ingest-seeded-config-keys/recon.md:86-101` (on `main-dev`) as the historical reference only.
- The ingest defect report `docs/reports/2026-10-22-ingest-seeded-config-keys-never-read-defect.md` exists and is closed `wont-fix`, so entries name a feature as owner, not the report (product spec Out of Scope). Feature 277 is `demoted/canceled`; by the 2026-11-01 operator ruling (context.md) every entry the spec previously gave to 277 is owned by `feature 278`.
- `031_heal_indicators_sandbox_keys_full_dotted.up.sql` is now on the branch (feature 243, still `in-progress`): it heals `indicators.sandbox.timeout_ms`, `memory_bytes`, `allowed_imports` for both environments, so no `indicators.sandbox.*` form-mismatch is expected. `indicators.sandbox.max_concurrent` (read at indicators `watcher.py:152`, never seeded) is outside 243's scope (`docs/roadmap/features/243-fix-sandbox-seed-keys/product-spec.md:86`).
- Starting state: `scripts/config-wiring.json` is in its empty shape (`policy.envReadUnseeded` `reported`, `findings` `[]`, `registry` `{forwarders:{}, dynamic:{}, rewriteAllow:[]}`). On the current tree `--final` prints **46** `dynamic-read` sites; Step 11 removes the 3 `configServiceImpl.ts` assignment targets, leaving **43**. They fall into five groups, every one handled by a registry entry below, so the frozen baseline holds **zero** `dynamic-read` entries:
  - **Forwarder bodies (7 sites, `registry.forwarders`):** `int_positive` in analysis `watcher.py:142`, indicators `watcher.py:155`, ingest `watcher.py:213`; analysis `float_positive` (`:147`) and `str_nonempty` (`:152`), all `keyArg` 1; marketdata `resolvePositiveInt` (`marketdata_service.go:986`, `keyArg` 1); agent `get_config_value` (`services/xstockstrat-agent/app/client.py:1788`, `keyArg` 0). Registering `get_config_value` exposes one more passthrough, agent `_agent_policy(key, default, cast)` (`services/xstockstrat-agent/app/tools.py:2536`, calls `client.get_config_value(key, ...)` at `:2540`), so it is an eighth forwarder (`keyArg` 0). With these eight registered, `signal.alert_threshold` (`_ALERT_THRESHOLD_CONFIG_KEY`, `tools.py:78`, passed at `:656`) resolves through the Python extractor's same-file constant lookup and leaves `seeded-unread`. That closes context.md Step 9 open item 2 in the extractor as it stands, without a baseline entry or a code change. `str_nonempty` closes open item 1 (`fundsignal.source_slug`, `fundsignal_loop.py:44`).
  - **Getter bodies (28 sites, `registry.dynamic` `[]`):** `ConfigWatcher.get_bool`/`get_float`/`get_int`/`get_str` in analysis, indicators and ingest `app/config/watcher.py` (12), and `getBool`/`getFloat`/`getInt`/`getString` in config, identity, ledger and notify `src/services/configWatcher.ts` (16). They are passthroughs: the built-in getter matchers already attribute each key at its call site, so the body produces no read.
  - **Runtime-built keys with a closed set (4 sites, `registry.dynamic` enumerated):** marketdata `MarketDataService.GetFundamentalsMulti` (`marketdata_service.go:1697`) and `MarketDataService.resolveFundamentals` (`:1764`) both read `"marketdata."+s.fundProvider+".cache_ttl_hours"`, which is `marketdata.fmp.cache_ttl_hours` or `marketdata.finnhub.cache_ttl_hours`. `MarketDataService.fundamentalsEnabled` (`:1808`) reads `"marketdata."+s.fundProvider+".enabled"`, which is `marketdata.fmp.enabled` or `marketdata.finnhub.enabled`. `fundProvider` is `"fmp"` or `"finnhub"` (`:72-74`). Trading `TradingService.ibkrTiming` (`trading.go:2503-2515`, local closure `ms` around `s.cfgW.GetInt(key, def)`) reads `trading.ibkr.lst_refresh_margin_ms`, `trading.ibkr.handshake_timeout_ms` and `trading.ibkr.reauth_min_interval_ms`. Enumerating them turns Step 9's `seeded-unread` `marketdata.fmp.cache_ttl_hours`, `marketdata.finnhub.cache_ttl_hours` and `marketdata.finnhub.enabled` into reads. Those three were extractor gaps, not dead seeds.
  - **Non-config `values` containers (4 sites, `registry.dynamic` `[]`):** `services/xstockstrat-ui/src/components/trader/accountShared.tsx:57` (`credsFromWatch`, `values[i]` over a local array), `services/xstockstrat-ui/src/lib/indicatorChart.ts:33` (`toLineData`, `values[i]?.value`), `services/xstockstrat-analysis/app/handlers/servicer.py` `AnalysisServicer._load_fundamentals` (`:1858` `p.values.get(m)` over fundamentals periods) and `services/xstockstrat-analysis/app/services/evaluator.py:95` `_fundamental_as_of_series` (`p.values.get(metric)`). The extractor cannot tell them apart without type information.
- Projection, re-derived 2026-11-02 against a scratch `--root` with the full registry above but **without** Step 11's extractor fix. The run is authoritative: 19 `form-mismatch`, 5 `seeded-unread` (`ledger` `stream.notify_enabled`, `marketdata.alpaca.paper`, `platform.log_level`, `trading.risk.daily_loss_limit`, `analysis.opportunity.sparkline_bars`), about 101 `read-unseeded` lines (1 printed `REPORTED:`), and 3 `dynamic-read` (the `configServiceImpl.ts` sites Step 11 removes).
- **Not found**: any seed or reader fix landing in this feature; none is allowed (no reader or seed edit).

**TDD**: `N/A (config data file; verified by Step 13's real-tree test)`

**Covers**: —

**Instructions**:
1. Keep `policy.envReadUnseeded` at `reported` (Step 10 ruling).
2. Fill `registry` first, then re-run, then fill `findings`. `registry.forwarders`: the eight entries above, keyed `<file>:<symbol>`, value `{"keyArg": N}`. `registry.dynamic`: the 28 getter bodies and 4 non-config sites as `[]`, and the 4 closed-set sites with their enumerated keys. Use `services/xstockstrat-trading/internal/service/trading.go:TradingService.ibkrTiming` and `services/xstockstrat-marketdata/internal/service/marketdata_service.go:MarketDataService.<method>`. Each key is the exact `file:symbol` the run prints. `registry.rewriteAllow` stays empty (Step 1 models every current rewrite). Justify each entry, or each group, in one line in `context.md`.
3. Re-run `node scripts/check-config-wiring.mjs --final` and confirm it prints zero `dynamic-read` lines and no `signal.alert_threshold`, `marketdata.fmp.cache_ttl_hours`, `marketdata.finnhub.cache_ttl_hours` or `marketdata.finnhub.enabled` finding. If a `dynamic-read` remains, stop: it is either a new site that needs the same classification or a fixable extractor cause, and fixing that cause is outside these Files.
4. Fill `findings` with exactly the blocking findings that run produced, each with `owner: "feature 278"`. That covers the form mismatches, the dead seeds and every unseeded key, including `indicators.sandbox.max_concurrent`. Use `feature 243` only for an `indicators.sandbox.*` finding inside 243's declared scope, if the run still produces one. No entry names 277. No entry has kind `dynamic-read`. Record the final count per kind in `context.md`, plus the delta from the projection above and its cause.
5. Do not add any entry to hide a finding that has a fixable cause in the extractor (false-dynamic-read count must be zero). Getter bodies, forwarder bodies, closed-set runtime keys and non-config containers are classifications, not hidden findings.

**Verification**:
```
node scripts/check-config-wiring.mjs --final && node -e "const j=JSON.parse(require('fs').readFileSync('scripts/config-wiring.json','utf8')); const bad=j.findings.filter(f=>f.kind==='dynamic-read'||f.owner!=='feature 278'&&!/^feature 243\b/.test(f.owner)||/^(signal\.alert_threshold|marketdata\.(fmp|finnhub)\.(cache_ttl_hours|enabled))$/.test(f.key)); if(bad.length||Object.keys(j.registry.forwarders).length!==8||j.registry.rewriteAllow.length) {console.error(bad); process.exit(1)}" && echo OK
```

---

### Step 13 — test: Real-tree and baseline-integrity tests (authored red)

**Status**: `done`
**Service**: `scripts/` (repo tooling)
**Files**:
- `scripts/config-wiring.test.mjs` — modify

**Reviewers**: Platform Lead — cross-service tooling and SDD process

**Codebase Evidence**:
- Acceptance wording @AC-7 (baseline lists every 277-sweep finding with owner) and @AC-8 in `acceptance.feature`.
- The CI job (Step 14) runs `node --test scripts/config-wiring.test.mjs`, so these tests are what keeps a stale baseline from merging.
- `scripts/check-config-wiring.mjs` exports `tokenize`, `splitStatements`, `statementHash`, `validateState`, `loadState`, `loadRegistry`, `buildStoredSet`, `extractGoReads`/`extractTsReads`/`extractPyReads`/`extractReads`, `join`, `findingLine`, `declaredFromSpec`/`declaredFromMigration`, `ratchet`, `stepTime` and `run`. It has **no** scan-roots constant, and this step does not add one (its Files are the test file only). `BASELINE_KINDS` (`:305`, the four kinds) and `OWNER_RE` (`:306`) are module-private, so test (2) restates the four kinds literally.
- The scan-roots/CI-filter equality that former Instruction (5) asserted moves to Step 14. The `config-wiring` filter does not exist until Step 14 edits `ci.yml`, so asserting it here could never pass at this step's Verification.

**TDD**: `red-green required` (red proof: run the new tests against the empty-shape `config-wiring.json` from Step 7, restored from git into a scratch `--root`, since Step 12's data already exists in the tree when this step is executed)

**Covers**: `AC-7, AC-8`

**Instructions**:
Add: (1) a test running the CLI with `--final` against the real repo root, asserting exit 0 (committed baseline equals the tree); (2) every committed `findings[]` entry has a non-empty `owner` and a `kind` among `seeded-unread`, `read-unseeded`, `form-mismatch`, `dynamic-read`, and no entry has kind `dynamic-read` (Step 12 classifies every dynamic site in the registry); (3) the committed baseline contains at least the 277-sweep set reconciled in Step 9 (asserted by key lists copied from `context.md`, not recomputed); (4) the committed JSON has no value text and no secret-class key. Scan-root coverage is Step 14's test (5).

**Verification**:
```
node --test scripts/config-wiring.test.mjs
```
No coverage threshold applies (tooling). Lint: `node --check scripts/config-wiring.test.mjs`.

---

### Step 14 — service: CI job `config-wiring` and `ci-gate` wiring

**Status**: `done`
**Service**: `.github/workflows/ci.yml`
**Files**:
- `.github/workflows/ci.yml` — modify
- `scripts/config-wiring.test.mjs` — modify (test (5): CI filter covers the extractors' scan roots)

**Reviewers**: Platform Lead — CI job matrix and gate

**Codebase Evidence**:
- Job shape to copy: `migration-contract-gate` at `.github/workflows/ci.yml:693-709` (`needs: changes`, `if:` on `matched`, `actions/checkout@v7`, one script step). Copy only the gating shape. That job adds `with: fetch-depth: 0` (`:704`) and a `github.event_name == 'pull_request'` guard (`:697`) because it diffs against the base branch. `config-wiring` reads only the checked-out tree, so it takes the default shallow checkout and needs no `pull_request` guard. The closest guard-free shape is `context-map` (`:787-801`) and `otel-signals` (`:803-814`).
- `changes` job starts at `ci.yml:14`. Its `dorny/paths-filter@v4` `filters: |` block runs `:39-108` and has `scripts`, `migrations`, per-service filters and `context-map` (`:92`). The last filter is `otel-signals` (`:102-108`). There is **no aggregate service-source filter**.
- `ci-gate` is at `ci.yml:899`. Its `needs:` list runs `:902-921` and ends `- context-map`, `- otel-signals`, `- ledger-guard`, `- secret-scan`. Its echo list runs `:926-944` and ends with the `secret-scan` echo. A job missing there is not enforced. Append the new entries after `secret-scan` in both lists.
- `context-map` job (`ci.yml:787`) runs `node --test scripts/workflow-tests/*.test.mjs` (`ci.yml:801`); our test is a separate file and is run by the new job itself.
- Shell lint (`shell-lint`, `ci.yml:629`) covers `scripts/*.sh .claude/hooks/*.sh` only (`ci.yml:643,646`), so the `.mjs` files are outside shellcheck/shfmt; no `*.test.sh` is added, so the structural-test line `ci.yml:649` is unchanged.
- Node setup step to copy: `node-lint` (`ci.yml:430`) uses `actions/setup-node@v7` with `node-version: "24"` (`ci.yml:459-462`); drop its `cache: 'pnpm'` lines since the new job installs no packages.
- Actual extractor scan roots (`scripts/check-config-wiring.mjs`, `scripts/config-wiring-py-reads.py`), which differ by language:
  - Go walks **all** of `services/<svc>` for `*.go`, excluding `_test.go` (`extractRegexReads`, `check-config-wiring.mjs:542-543`).
  - TS walks `services/<svc>/src` for `*.ts`/`*.tsx`, excluding `.test`/`.spec`/`.d` (`:542-543`).
  - Python globs `services/*/app/**/*.py` (`config-wiring-py-reads.py:108`).
  - Both walks skip `tests`, `test`, `__tests__`, `e2e`, `node_modules`, `vendor`, `.next`, `.venv` and `dist` (`SKIP_DIRS`, `:379`).
  - The stored set reads `services/xstockstrat-config/migrations` (`MIGRATIONS`, `:13`).
- The Go walk finds config reads outside `services/*/internal`. On the current tree, `services/xstockstrat-marketdata/cmd/server/main.go` holds reads such as `marketdata.fmp.rate_limit_rps`, the only reader file outside `app/`, `src/` and `internal/`. A filter of `services/*/internal/**` would therefore miss a change there, so the filter follows the extractors' language globs, not directory names.
- There is no exported scan-roots constant (Step 13 Codebase Evidence), and none is added. Test (5) instead derives the files the extractors actually read from `cw.extractReads(REPO_ROOT)` and asserts that the filter covers each of them.

**TDD**: `red-green required` (author test (5) first. It is red because `ci.yml` has no `config-wiring` filter. Then edit `ci.yml` to green.)

**Covers**: `AC-7` (CI job), `AC-8`

**Instructions**:
1. Add test (5) to `scripts/config-wiring.test.mjs`. It reads `.github/workflows/ci.yml` as text, with no YAML dependency, and collects the quoted globs listed under the `config-wiring:` filter key. It then asserts two things:
   - (a) The list contains, literally, the language-root globs `services/**/*.go`, `services/*/app/**/*.py`, `services/*/src/**/*.ts`, `services/*/src/**/*.tsx` and `services/xstockstrat-config/migrations/**`.
   - (b) Every `file` in `cw.extractReads(REPO_ROOT)`'s `reads` and `dynamic` matches at least one glob, using a small in-test glob-to-regex where `**/` is zero or more directories and `*` is one segment. This covers `services/xstockstrat-marketdata/cmd/server/main.go`.
   Capture red.
2. Add a `config-wiring` filter to `changes`, after `otel-signals`, with these globs:
   - `services/xstockstrat-config/migrations/**`
   - `services/**/*.go`
   - `services/*/app/**/*.py`
   - `services/*/src/**/*.ts`
   - `services/*/src/**/*.tsx`
   - `scripts/check-config-wiring.mjs`
   - `scripts/config-wiring-py-reads.py`
   - `scripts/config-wiring.json`
   - `scripts/config-wiring.test.mjs`
   - `scripts/config-wiring-fixtures/**`
   Test files matching these globs trigger the job too. That costs an extra run and is harmless.
3. Add job `config-wiring` ("Config key wiring (whole-tree)"): `needs: changes`, `if:` matched `config-wiring` or `ci`, steps: `actions/checkout@v7`, `actions/setup-node@v7` with `node-version: "24"` (from `node-lint`, without the pnpm cache lines), `node --test scripts/config-wiring.test.mjs`, `node scripts/check-config-wiring.mjs --final`.
4. Add `- config-wiring` to `ci-gate` `needs:` after `- secret-scan`, and add `echo "config-wiring:   ${{ needs.config-wiring.result }}"` after the `secret-scan` echo.
5. Only after Step 12's ruling is recorded does this step run; the job is a whole-tree scan, never the diff.

**Verification**:
```
python3 -c "import yaml,sys; d=yaml.safe_load(open('.github/workflows/ci.yml')); assert 'config-wiring' in d['jobs']; assert 'config-wiring' in d['jobs']['ci-gate']['needs']" && grep -n "config-wiring" .github/workflows/ci.yml && node --test scripts/config-wiring.test.mjs && node --check scripts/config-wiring.test.mjs && node scripts/check-config-wiring.mjs --final
```

---

### Step 15 — docs: `/sdd-execute` Phase 3 gate and repo conventions

**Status**: `done`
**Service**: `.claude/skills/sdd-execute/`
**Files**:
- `.claude/skills/sdd-execute/SKILL.md` — modify
- `.claude/skills/sdd-execute/reference/repo-conventions.md` — modify

**Reviewers**: Platform Lead — SDD process

**Codebase Evidence**:
- Phase 3 step 3 runs `**Verification**` (`SKILL.md:289`) and step 4 flips `**Status**` to `done` (`SKILL.md:298-299`); the offline-only migration rule is `SKILL.md:290-297`; the all-steps-done transition to `code-completed` is `SKILL.md:303`; step bodies are immutable (`SKILL.md:487`).
- TDD-gate carve-out: `SKILL.md:285` (config/migration steps skip it), so for them the wiring check is the only gate (recon.md Risks).
- Config-key convention line: `.claude/skills/sdd-execute/reference/repo-conventions.md:30` (`- **Config keys**: format is <service-short-name>.<category>.<key>`).
- Reference files are listed in `.claude/context-map.yaml:83-86` (`sequential-mode.md`, `deviation-handling.md`, `repo-conventions.md`, `tdd-gate.md`); no new reference file is created. All `SKILL.md` and `repo-conventions.md` anchors above re-verified exact on 2026-11-01.

**TDD**: `N/A (docs/skill text; structural assertions in Step 18)`

**Covers**: `AC-4, AC-5, AC-10`

**Instructions**:
1. In `SKILL.md` Phase 3, insert after step 3 and before the `done` flip a **wiring gate** block: when the step is typed `config`, or its `**Files**` include a migration whose body inserts into `config.config_values`, or the product spec's `## Config Key Changes` lists a key this step touches, run `node scripts/check-config-wiring.mjs --declared-from <FEATURE_DIR>/product-spec.md` (add `--declared-migration <file>` for a migration step) in the default step-time mode; a non-zero exit keeps the step not-done and the output names the finding and key. A step that declares no key is not blocked by unrelated baseline findings. Missing-side findings print `PENDING:` and do not block at step time.
2. At the point where all steps are done (`SKILL.md:303`) and at the integration-PR gate, run `node scripts/check-config-wiring.mjs --final` before the `code-completed` flip; a non-zero exit blocks the flip. Record the output in `context.md`, never in a step body (F-09).
3. In `repo-conventions.md`, extend the config-key line with a pointer: stored `key` must equal the reader string verbatim and the check enforces it; state that keys created at runtime surface as `read-unseeded` by design and must be seeded in a migration.
4. Do not edit any step body of any other feature.

**Verification**:
```
grep -n "check-config-wiring" .claude/skills/sdd-execute/SKILL.md .claude/skills/sdd-execute/reference/repo-conventions.md && ./scripts/check-context-map.sh
```

---

### Step 16 — docs: Sequential-mode mirror

**Status**: `done`
**Service**: `.claude/skills/sdd-execute/`
**Files**:
- `.claude/skills/sdd-execute/reference/sequential-mode.md` — modify

**Reviewers**: Platform Lead — SDD process

**Codebase Evidence**:
- Sequential mode runs Phase 3 unchanged inside the step loop: `.claude/skills/sdd-execute/reference/sequential-mode.md:81-109` (§5.5; "Run **Phase 3 Execution** + Verification unchanged, including the **offline migration check** ...", line 93). The design's cited `:112` is inside §5.5b (`:110-145` smart checkpoints) and is **not** the mirror location; the correct anchors are §5.5 (`:81`) and §5.6 per-feature integration PR (`:146`).
- Feature-end checkpoint precedes the integration PR (§5.5b, `sequential-mode.md:110-126`, condition 3).

**TDD**: `N/A (docs/skill text; structural assertions in Step 18)`

**Covers**: `AC-4, AC-5, AC-10`

**Instructions**:
In §5.5 add one bullet stating that Phase 3's wiring gate (Step 15) applies unchanged in sequential mode, step-time mode per step; in §5.6, before the integration PR is created, add the `--final` run as a blocking gate on the feature's last step and record its output in `context.md`. Keep the text to the two edits; do not restate the gate rules.

**Verification**:
```
grep -n "check-config-wiring" .claude/skills/sdd-execute/reference/sequential-mode.md && ./scripts/check-context-map.sh
```

---

### Step 17 — docs: `/sdd-review` B2 row and `/sdd-story` declared-key format

**Status**: `done`
**Service**: `.claude/skills/sdd-review/`, `.claude/skills/sdd-story/`
**Files**:
- `.claude/skills/sdd-review/reference/impl-spec-criteria.md` — modify
- `.claude/skills/sdd-story/SKILL.md` — modify

**Reviewers**: Platform Lead — SDD process

**Codebase Evidence**:
- B2 table at `.claude/skills/sdd-review/reference/impl-spec-criteria.md:12-31`; the `C-14` row at `:31` is the precedent for a prominent FAIL row although Mode B is advisory (`:4-5`); WARN list starts `:33`. Today no sdd-review text mentions config readers or `config.config_values` (recon.md Risks).
- `## Config Key Changes` template in `.claude/skills/sdd-story/SKILL.md:198-201` (`- [ ] No new config keys` / `- OR: list keys in <service>.<category>.<key> format`); nothing in sdd-review or sdd-execute reads that section today (recon.md).
- Product-spec criterion 6 checks key format only (`.claude/skills/sdd-review/reference/product-spec-criteria.md:25`).
- Snapshot-built test models: `services/xstockstrat-ingest/tests/test_config_watcher.py:56` (`_int_watcher(**int_values)`), `:74` (empty `ConfigSnapshot()`), `services/xstockstrat-ingest/tests/test_ingest_servicer.py:77` (`ConfigWatcher.__new__`); re-verified 2026-11-01.

**TDD**: `N/A (docs/skill text; structural assertions in Step 18)`

**Covers**: `AC-6, AC-11`

**Instructions**:
1. Add a B2 row `Config key wiring` after the `C-14` row with two FAIL clauses and no third: (a) the product spec's `## Config Key Changes` lists a key but no step names the reader file and symbol that looks it up (@AC-6); (b) no test builds a config snapshot from the seeded key and asserts the real reader returns the seeded value (@AC-11; model on `services/xstockstrat-ingest/tests/test_config_watcher.py:56,74` and `tests/test_ingest_servicer.py:77`). State that it is a prominent FAIL even though Mode B is advisory, following the `C-14` precedent, and that the reviewer cites the key by name.
2. In `sdd-story/SKILL.md` under `## Config Key Changes`, pin the declared-key format: one backticked key per bullet, `<namespace>.<key>` exactly as the migration stores it (so `--declared-from` can extract it), and note that the check treats this section as the declared set.

**Verification**:
```
grep -n "Config key wiring" .claude/skills/sdd-review/reference/impl-spec-criteria.md && grep -n "declared" .claude/skills/sdd-story/SKILL.md && ./scripts/check-context-map.sh
```

---

### Step 18 — test: Skill-text structural assertions (authored red)

**Status**: `done`
**Service**: `scripts/` (repo tooling)
**Files**:
- `scripts/config-wiring.test.mjs` — modify

**Reviewers**: Platform Lead — SDD process

**Codebase Evidence**:
- Process behavior (@AC-4/5/6/10/11) is executed by an LLM following skill text, so the only deterministic proof is that the load-bearing text is present; the script half is proven in Steps 8 and 13. Precedent for text-structure tests of skills/workflows: `scripts/workflow-tests/*.test.mjs`.

**TDD**: `red-green required` (red proof: point the assertions at the skill files as of the commit before Step 15, via `git show`; green is the committed text from Steps 15-17)

**Covers**: `AC-4, AC-5, AC-6, AC-10, AC-11`

**Instructions**:
Add failing assertions over the real files: `sdd-execute/SKILL.md` contains the `check-config-wiring.mjs` step-time command before the `done` flip and the `--final` command before the `code-completed` flip, and states the three triggers (config step, migration inserting into `config.config_values`, product-spec declared key) and that an undeclared step is not blocked; `sequential-mode.md` contains both mirrors; `impl-spec-criteria.md` contains the `Config key wiring` row with exactly two clauses (reader file+symbol, snapshot-built test) and no clause requiring a backticked stored-key quote; `sdd-story/SKILL.md` pins the declared-key format.

**Verification**:
```
node --test scripts/config-wiring.test.mjs
```
No coverage threshold applies (tooling). Lint: `node --check scripts/config-wiring.test.mjs`.

---

### Step 19 — docs: Governance rule, merge-order row, context-map check and teardown

**Status**: `done`
**Service**: `docs/patterns/`, `docs/roadmap/features/`
**Files**:
- `docs/patterns/config-governance.md` — modify (append-only; keep feature 182's registered-keys entries)
- `docs/roadmap/features/merge-order.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `docs/patterns/config-governance.md` headings: `## Rules` (`:5`), `## Global Config Keys` (`:36`), `## Registering a new config key` (`:56`, steps 1-4 listed at `:58-61`), `## Registering a new vendor credential (an encrypted secret config row)` (`:63`), `## Author-sentinel conventions` (`:93`), `## Per-Feature Registered Keys` (`:109`). Existing PRESERVE-equivalent: feature 182's entries and `docs/sdd/business-rules/platform.feature` @AC-6 (recon.md Existing Business Rules). Feature 264 (now launched) edited this file.
- `docs/roadmap/features/merge-order.md` already has a 278 row: `:101`, `signal-watchlist-expiry-pruning` (281) vs `enforce-config-key-wiring` (278), the config-wiring ratchet policy. 244 and 261 have launched (their ratchet coupling is moot: 278's first run sees their merged state); 243 is still `in-progress` and its migration 031 is already on `main-dev`, so its only remaining coupling is that any later 243 key change must edit `scripts/config-wiring.json`.
- PR #1322 / branch `ccr-fac38b1f-6m24q2` is stale: 278's artifacts are on `main-dev` and `git merge origin/main-dev` into `feature/enforce-config-key-wiring` was a no-op on 2026-11-01.
- `scripts/check-context-map.sh` validates `.claude/context-map.yaml` paths and doc cross-references (`check-context-map.sh:1-30`); it exits 0 on the current tree. `.claude/context-map.yaml:55-64` registers only workflow helpers/tests.
- Teardown: root `CLAUDE.md` § Teardown requires `/context-forge:context-constitution refresh` scoped to touched context files, or a recorded manual reconciliation if the plugin is unavailable (ledger `fails.md:670`, the context-teardown trap entry).

**TDD**: `N/A (docs-only)`

**Covers**: —

**Instructions**:
1. In `config-governance.md` add a section `## Wiring check (config key must be read under its stored key)` after `## Registering a new config key`: the stored key must equal the reader string verbatim; the four finding kinds; the step-time versus `--final` split; the baseline in `scripts/config-wiring.json` (owner required, entries may only shrink); keys created at runtime (`SetConfig create_key=true`, config-ui) surface as `read-unseeded` by design and must be seeded in a migration; secrets are excluded and values are never printed. Add one line to the registering list pointing at the section. Do not touch the registered-keys log.
2. Do not add a second 278 row to `merge-order.md`; the existing `:101` row (281 vs 278) stays. Add one row only for the live coupling, in the table's `Feature | Must wait for | Reason | Resolved` shape: Feature `fix-sandbox-seed-keys` (243), Must wait for `enforce-config-key-wiring` (278), Reason marked Soft (either order works; if 243 lands first, 278's Step 9 run records its state), stating that once 278 lands any further 243 change to a config key or reader must update `scripts/config-wiring.json` (shrink-only ratchet) in the same PR. Do not add rows for 244/261 (launched) and do not mention PR #1322.
3. `.claude/context-map.yaml` is not edited: it registers only workflow helpers/tests (`merge-train-resolve.mjs`, `workflow-tests/*`, lines 55-64), not tooling scripts. Run `./scripts/check-context-map.sh`.
4. Teardown: run `/context-forge:context-constitution refresh` scoped to `docs/patterns/config-governance.md` and the touched skill files; fix grounded drift. If the plugin is unavailable, re-read each touched context file against the current code and record in the PR body both that the plugin was unavailable and the manual reconciliation performed (a bare "plugin unavailable" does not pass).

**Verification**:
```
./scripts/check-context-map.sh && grep -n "Wiring check" docs/patterns/config-governance.md && grep -n "fix-sandbox-seed-keys.*enforce-config-key-wiring" docs/roadmap/features/merge-order.md && node --test scripts/config-wiring.test.mjs && node scripts/check-config-wiring.mjs --final
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._

### Deviation: Steps 1+2 — executed as one TDD cycle
**Spec said**: "Step 2 [test] covers Step 1 [service] ... `/sdd-execute` captures red before the paired service step" (separate steps, one commit each).
**Actual**: Step 2's test file and all of its fixtures were authored first, red was captured (script missing, every case fails), Step 1 was implemented, green was captured with both Verification commands, and Steps 1 and 2 landed as one paired red-green commit that flips both Statuses to `done`.
**Reason**: Operator decision (Option A) on the Step 1 blocker, 2026-11-01: Step 1's Verification runs a test file that Step 2 creates.

### Deviation: Step 1 — CTE-led DELETE is not classified
**Spec said**: "only statements whose first keyword is `INSERT`, `UPDATE` or `DELETE` are classified".
**Actual**: Implemented as written. As a result the 017 trading_mode collapse (`WITH ranked AS (...) DELETE FROM config.config_values c USING ranked r ...`, `017_config_secrets_and_scoping.up.sql:44-62`) is never classified and never trips `unmodelled-rewrite`. On the stored set this is a no-op: INSERT keeps the first row per `(namespace, key, environment, user scope)`, which is the one-row-per-scope result the collapse produces. The `rename-017` fixture includes the collapse statement to pin this.
**Reason**: Spec wording. Consequence (open item): a future CTE-led `WITH ... UPDATE/DELETE` on `config.config_values` would bypass the fail-closed trigger.

### Deviation: Step 1 — INSERT shapes outside the model fail closed
**Spec said**: "Any other `UPDATE`/`DELETE` against `config.config_values` that the model cannot interpret trips the fail-closed trigger".
**Actual**: An `INSERT INTO config.config_values` also trips `unmodelled-rewrite` when it is not `(cols) VALUES (...)[, ...]` with no conflict clause or `ON CONFLICT ... DO NOTHING`. Examples are `INSERT ... SELECT` and `ON CONFLICT ... DO UPDATE`. It also trips when `namespace`/`key`/`environment`/`user_id`/`is_secret` is not a single literal. The real tree (000-034) has no such INSERT: zero `unmodelled-rewrite`, `rewriteAllow` empty.
**Reason**: A silently skipped insert would drop seeds from the stored set. This is the same fail-closed rule, applied to the remaining DML verb.

### Deviation: Step 1 — `unmodelled-rewrite` output line
**Spec said**: "Output lines are `file:key:kind[:env]`".
**Actual**: An unmodelled statement has no key, so its line is `services/xstockstrat-config/migrations/<file>:L<line>:unmodelled-rewrite`. `--json` adds the statement `sha256` (the `rewriteAllow` key). Values are never printed.
**Reason**: The finding needs a locator, and no key exists for it.

### Deviation: Steps 3+4 — executed as one TDD cycle
**Spec said**: "Step 4 covers Step 3 ... `/sdd-execute` captures red before the paired service step" (separate steps, one commit each).
**Actual**: Step 4's fixtures and cases (a)-(k) were authored first and red was captured (21 tests: 10 pass, 11 fail with `cw.extractReads is not a function`). Step 3 was then implemented and green was captured with both Verification commands (21 pass). Steps 3 and 4 landed as one red-green commit that flips both Statuses to `done`.
**Reason**: Operator decision (Option A) for every inverted test/impl pair, recorded in context.md (commit cdfbeaf6).

### Deviation: Step 3 — TypeScript getter calls use the lower-case method names
**Spec said**: "regex over the `Get(String|Int|Float|Bool)\(` call and the `values\[`-index syntax".
**Actual**: Go matches `.Get(String|Int|Float|Bool)(`. TypeScript matches `.get(String|Int|Float|Bool)(`, because the TS watchers define `getString/getInt/getFloat/getBool` (for example `services/xstockstrat-ledger/src/services/configWatcher.ts:107`) and callers use them (`ledgerServiceImpl.ts:378`, `notify/src/fanout/fanout.ts:56`). The `values[`-index rule applies to both languages. Comments are blanked before matching, so a commented-out call is not a read.
**Reason**: With the capitalised pattern alone, every TS getter read would be missed. Fixture `readers/.../index_reads.ts` pins this with `cfg.getInt('performance.window_days', 30)`.

### Deviation: Step 3 — dynamic-site `symbol` and extractor API
**Spec said**: dynamic entries are `{"file","symbol","line","dynamic":true}`; `registry.dynamic` and `registry.forwarders` are keyed `file:symbol`.
**Actual**: Python `symbol` is the dotted enclosing scope (`ConfigWatcher.get_str`, `is_enabled`). Go `symbol` is `Receiver.Func` or `Func`. TS `symbol` is the nearest preceding function or method name. All three fall back to `<module>`. The Node API is `extractReads(root, registry)`, which returns `{reads:[{file,line,key}], dynamic:[{file,symbol,line}]}`, plus `extractPyReads`, `extractGoReads` and `extractTsReads`. An identifier argument resolves to a string constant in the same file first, then the same directory or package, then anywhere in the service. A `pkg.Name` argument resolves in a directory named `pkg`. If more than one value matches, the read is reported as `dynamic-read`.
**Reason**: The spec does not define the symbol format or the function signatures. Steps 5 and 12 (numbered 11 before the 2026-11-02 re-spec) key on these.

### Deviation: Steps 5+6 — executed as one TDD cycle
**Spec said**: "Step 6 covers Step 5 ... `/sdd-execute` captures red before the paired service step" (separate steps, one commit each).
**Actual**: Step 6's fixtures and cases were authored first and red was captured (28 tests: 23 pass, 5 fail). The 5 failures were cases (1)-(5). Cases (7) and (8) passed before the join existed because they assert that there is no output, and the pre-join CLI printed nothing. Step 5 was then implemented and green was captured with both Verification commands (28 pass). Steps 5 and 6 landed as one red-green commit that flips both Statuses to `done`.
**Reason**: Operator decision (Option A) for every inverted test/impl pair, recorded in context.md (commit cdfbeaf6).

### Deviation: Step 5 — `join` signature, line format and env rule
**Spec said**: "`join(stored, reads, registry)`"; "Output lines are `file:key:kind[:env]`"; "`:env` is appended only when the key is seeded in some environments and absent in others (one finding listing the missing envs)".
**Actual**:
- The function is `join(stored, reads)`, where `reads` is the `extractReads` result `{reads, dynamic}`. The registry is applied earlier, inside `extractReads` (forwarders and `registry.dynamic`), so `join` takes no registry argument.
- The key field depends on the kind:
  - `seeded-unread` is `<namespace>/<storedKey>`, because a bare stored key is ambiguous without its namespace.
  - `form-mismatch` is `<namespace>/<storedKey>-><readKey>`, so the line names both strings (@AC-1).
  - `read-unseeded` is the read key.
  - `dynamic-read` is the symbol.
- The file field also depends on the kind:
  - For seed-side kinds it is the full migration path, using the latest file that seeded the key in any environment.
  - For `read-unseeded` it is the reader file that sorts first.
  - For `dynamic-read` it is the reader file.
- When `envs` is present it is comma-joined. `--json` emits `{kind, namespace, key, readKey?, file, envs?}`, and `namespace` is `''` for read-side kinds.
- Only `read-unseeded` can carry `:env`. It lists the environments in which no stored row (or form-mismatch partner) exists, out of all environments present in the stored set. Seed-side kinds hold in every environment where the key is seeded, so they never carry `:env`. That is why `ledger stream.notify_enabled` (staging-only) is a single untagged `seeded-unread`, as Step 9 expects. Form-mismatch suppression is per environment: a read covered by a bare partner only in staging still reports `read-unseeded:production`.
**Reason**: The spec does not define the key field's form for the seed-side kinds, or the env semantics for a seed-side kind. The Step 10 ruling (production-only gaps reported) applies only to read-side gaps.

### Deviation: Step 6 — Step 2 CLI assertions relaxed
**Spec said**: Step 2 cases 4 and 5 asserted CLI exit `0` on the `scope-and-secret` fixture and on the allow-listed `unmodelled` fixture.
**Actual**: With the join wired into `run()`, both fixtures now also report `seeded-unread` for their reader-less seeds, so the exit code is `1`. The assertions now check that the run is not an error (exit `!= 2`), that no secret value appears in the output, and, for case 5, that no `unmodelled-rewrite` line remains. The fixtures are unchanged.
**Reason**: Those cases test the parser, not wiring. Adding readers to Step 2's fixtures would mix concerns.

### Deviation: Steps 7+8 — executed as one TDD cycle
**Spec said**: "Step 8 covers Step 7 ... `/sdd-execute` captures red before the paired service step" (separate steps, one commit each).
**Actual**: Step 8's fixtures and cases 1-9 were authored first, and red was captured: 37 tests, 27 pass, 10 fail. The failures were ratchet cases 1-9 plus join 5, whose expected output changed. Step 7 was then implemented, and green was captured with both Verification commands (37 pass). Steps 7 and 8 landed as one red-green commit that flips both Statuses to `done`.
**Reason**: Operator decision (Option A) for every inverted test/impl pair, recorded in context.md (commit cdfbeaf6).

### Deviation: Step 7 — step-time semantics for keyless kinds, entry identity and output prefixes
**Spec said**: Instructions 4-5: step-time failures are "`form-mismatch`, `dynamic-read`, `unmodelled-rewrite`, and declared-key findings that are not missing-side", and "Step-time filtering restricts failures to the union of declared keys; unrelated baseline findings never block". Instruction 1 lists the entry fields as `namespace`, `key`, `kind`, `envs`, `owner`.
**Actual**:
- **Declared-key matching.** A finding relates to a declared key when the declared string equals one of these:
  - for a seed-side finding, the stored key in canonical dotted form (`<ns>.<key>` unless the key is already dotted) or its `readKey`;
  - for a read-side finding, the read key.
  `--declared-migration` canonicalises its `(namespace, key)` rows in the same way. `--keys` takes a comma-separated list.
- **Keyless kinds at step time.** `dynamic-read` and `unmodelled-rewrite` have no config key to relate. At step time they fail only when a declared-key source is given and the finding is not covered by a `findings` entry. With no declared key, step-time mode prints nothing and exits `0`.
- **Entry identity.** Entries are matched on `(kind, namespace, key)`. An optional `file` field is accepted to tell apart `dynamic-read` entries that share a symbol, such as `<module>`.
- **Allowed kinds.** Entry `kind` must be one of the four FR-1 kinds. `unmodelled-rewrite` has its own allow-list, `registry.rewriteAllow`, so it cannot be baselined here.
- **Output lines.**
  - A new finding prints as its plain line.
  - A gone entry prints `STALE: config-wiring.json:<ns/key|key>:<kind>[:envs]`.
  - An oversized entry prints `STALE-IN-PART: <entry> (produced: <envs>)`.
  - A produced env list that is not a subset of the entry's list prints as a new finding.
  - At step time, a missing-side declared finding prints `PENDING: <line>` and a reported one prints `REPORTED: <line>`.
- **Validation.** Owner and schema errors name every bad entry as `findings[<i>] <kind>:<ns/key>: ...` on stderr and exit `2`. A missing `config-wiring.json` counts as the empty shape. `--json` adds `results`.
**Reason**: The spec gives no rule for relating a keyless finding to a declared key, and no identity for `dynamic-read` entries. A strictly key-filtered gate would never see a new dynamic read added by the step.

### Deviation: Step 8 — Step 2/6 CLI cases now pass `--final`, and fixtures are staged into scratch roots
**Spec said**: Step 8 fixtures are "`--root` tree ... plus a `config-wiring.json`". The Step 2/6 CLI cases ran with no flags and expected exit `1` on findings.
**Actual**:
- Without a declared-key source, the default step-time mode now exits `0` (@AC-5). The CLI assertions of Step 2 case 5 and join cases 1-8 therefore pass `--final`, which against an absent baseline reports every finding as new.
- Under the default `reported` policy, join case 5's env-scoped line now carries `REPORTED: `.
- The `ratchet/*` fixtures keep `config-wiring.json` beside the tree, or in `policy/{reported,blocking}/`. Tests copy the tree into an `fs.mkdtempSync` root and install the chosen file as `scripts/config-wiring.json`, so no new CLI flag was needed.
**Reason**: The loader reads `<root>/scripts/config-wiring.json`, and the two policy files cannot share one directory.

### Deviation: Step 11 — fixtures carry one extra compound-assignment write; case (d) also went red
**Spec said**: Instruction 1 lists the TS writes `values[k] = x`, `obj.values[row.key] = y` and `values['performance.window_days'] = z`; Instruction 3 says compound assignments are also writes.
**Actual**: `index_writes.ts` also holds `values[k] ??= x`, so Instruction 3's compound rule is pinned by a fixture. The Go fixture lives under `${GO_MD}/config/`, so red was 2 failing cases, not 1: (l), and (d), whose false-dynamic-read assertion over that directory saw `index_writes.go:writes`. Both pass after the fix (38/38).
**Reason**: An untested compound branch could regress silently; (d) going red is the intended zero-false-dynamic gate.

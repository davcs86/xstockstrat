# Implementation Spec: enforce-config-key-wiring

**Status**: `pending`
**Created**: 2026-10-23
**Feature**: `docs/roadmap/features/278-enforce-config-key-wiring/feature.md`
**Total Steps**: 18
**Feature Branch**: `feature/enforce-config-key-wiring`

---

## Execution Summary

Internal repo tooling and process only; consumer surface is **None** (product spec), so no UI/Agent step is required (C-14 restated as a decision, not an omission). No proto, migration, config key or reader/seed change: the check reads migrations and source and prints keys, never values (F-08). Per design, a zero-dependency Node script `scripts/check-config-wiring.mjs` (plus one stdlib-`ast` Python helper) and its state file `scripts/config-wiring.json` are built bottom-up in red-before-green pairs: seed-side parser (Steps 1-2), reader extraction (3-4), join with collapse and finding kinds (5-6), baseline ratchet and modes (7-8). Then the first real run (9), the OPERATOR environment-baseline decision gate (10), the frozen baseline (11-12), the CI job (13, deliberately after the operator ruling), the `/sdd-execute` and `/sdd-review` process gates (14-17) and the governance doc plus context-map teardown (18).

The environment-baseline gate (Step 10) is performed by the operator: this session has only the staging MCP and cannot read production. Until the operator rules, `policy.envReadUnseeded` in `scripts/config-wiring.json` is `reported` (non-blocking), so nothing in CI depends on the ruling.

### Scenario Coverage (C-15)

| Scenario | Covered by step(s) |
|---|---|
| @AC-1 form-mismatch | 2 (seed side), 4 (reader side), 6 |
| @AC-2 seeded-unread | 6 |
| @AC-3 read-unseeded | 6 |
| @AC-4 step not done while declared key has a finding | 8 (script), 17 (skill text) |
| @AC-5 unrelated findings do not block | 8, 17 |
| @AC-6 impl-spec without reader step fails review | 17 |
| @AC-7 CI fails on new finding | 8, 12 |
| @AC-8 baseline entry without owner rejected | 8, 12 |
| @AC-9 runtime-built key is `dynamic-read` | 4, 6 |
| @AC-10 migration insert triggers the check | 8, 17 |
| @AC-11 reader step without snapshot-built test fails review | 17 |

## Step Dependencies

- Step 2 [test] covers Step 1 [service]; Step 4 covers Step 3; Step 6 covers Step 5; Step 8 covers Step 7. Each test is authored to fail against the pre-implementation tree (P-06) and `/sdd-execute` captures red before the paired service step.
- Verification commands of the service steps (1, 3, 5, 7) run `node --test scripts/config-wiring.test.mjs`, a file first created in Step 2. `/sdd-execute` runs each test step's red capture first (paired test authored before its service step, P-06), so by the time a service step's Verification runs the paired tests exist; do not run a service step's Verification before its paired test step.
- Step 12 and Step 17 are numbered after the data/text they cover but their red proof is manufactured: Step 12 captures red by running against the empty-shape `config-wiring.json` from Step 7 (`git show <Step-7-sha>:scripts/config-wiring.json` into a scratch root), Step 17 against the pre-Step-14..16 skill files (`git show <sha-before-Step-14>:<path>`); neither step is moved.
- Step 3 requires Step 1 (reuses the stored-set types); Step 5 requires Steps 1 and 3; Step 7 requires Step 5.
- Step 9 requires Steps 1-8 (the script must exist to run).
- Step 10 requires Step 9 (it consumes the first-run `read-unseeded env=` list). It is an OPERATOR step.
- Step 11 requires Step 10 (the operator ruling must be recorded before `findings` freezes). Step 12 covers Step 11.
- Step 13 requires Steps 11 and 12 (CI must not run before the baseline exists and the real-tree test passes).
- Steps 14, 15, 16 are independent of each other; each requires Step 7 (flag names). Step 17 requires Steps 14-16. Step 18 requires Steps 14-17 and runs last.
- Ordering vs PR #1322 (base branch `ccr-fac38b1f-6m24q2`, not merged to `main-dev` at spec time): this feature's artifacts live on that branch; Step 18 records the merge-order row. 243, 244 and 261 will edit `scripts/config-wiring.json` (ratchet) once this lands; Step 18 records that coupling in `docs/roadmap/features/merge-order.md`.
- Out of scope, by decision: fixing any baselined key, any reader or seed edit, runtime enforcement (product spec Out of Scope).

---

### Step 1 — service: Seed-side parser (stored set) and CLI skeleton

**Status**: `pending`
**Service**: `scripts/` (repo tooling)
**Files**:
- `scripts/check-config-wiring.mjs` — create

**Reviewers**: Platform Lead — cross-service tooling and SDD process, `xstockstrat-config` owner — stored-key shape and scoping

**Codebase Evidence**:
- Stored form is the raw `key` column: `services/xstockstrat-config/src/grpc/configServiceImpl.ts:188` `byKey[k].values[row.key] = buildConfigValue(row)` (recon.md Codebase Map); only `user_id IS NULL` rows serve global snapshots (`configServiceImpl.ts:181,207`, design.md).
- Seed shape: `INSERT INTO config.config_values (namespace, key, value_type, value_data, description, default_value, consuming_service, environment, user_id) VALUES (...)`, confirmed at `services/xstockstrat-config/migrations/025_ingest_mcp_client_keys.up.sql:25-29` (multi-row VALUES, `NULL` user_id). 001 uses a narrower column list (`001_config_tables.up.sql:55-69`) with the 002 default `'dev'` (`002_config_environment.up.sql:7`); 002 re-inserts production rows for platform, trading, indicators, marketdata, portfolio, analysis (`002_config_environment.up.sql:48-71`) but not ledger `stream.notify_enabled` or trading `fill_poller.interval_ms`.
- Rewrites after seeding: `017_config_secrets_and_scoping.up.sql:38-39` `UPDATE config.config_values SET environment = 'staging' WHERE environment = 'dev'` and the `config.config_audit` twin on the next line (must NOT match the model); `029_heal_config_keys_full_dotted.up.sql:24-28` `SET key = namespace || '.' || key WHERE key NOT LIKE namespace || '.%' AND is_secret = false AND namespace IN ('platform','trading','portfolio','marketdata')`. Files containing `UPDATE`/`DELETE`: 001, 009, 010, 016, 017, 020, 029 (`grep -ln "DELETE\|UPDATE" *.up.sql`).
- Migration set: `000`..`030` with no `024` up-file (`ls services/xstockstrat-config/migrations`); tip is `030_marketdata_edgar_snapshot_keys.up.sql`.
- Script-language precedent: `scripts/merge-train-resolve.mjs`, `scripts/workflow-tests/harness.mjs`; `node --test` already runs in CI (`.github/workflows/ci.yml:723-724`). Exit-code and prefixed-stderr convention to mirror: `scripts/check-migration-contract.sh`.
- **Not found**: any existing config-wiring script, baseline or annotation convention (recon.md Risks).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Create `scripts/check-config-wiring.mjs` (ESM, `#!/usr/bin/env node`, no npm dependency, only `node:` built-ins). Export the pure functions so tests import them; run the CLI only when invoked directly. Flags: `--root <dir>` (default repo root, so fixtures can stand in for the tree), `--final`, `--declared-from <product-spec.md>`, `--declared-migration <file>`, `--keys <ns.key,...>`, `--json`. Exit codes: `0` clean, `1` findings, `2` usage or internal error.
2. Implement `buildStoredSet(root)`: read `services/xstockstrat-config/migrations/*.up.sql` in NNN order (never `*.down.sql`); return a map keyed `(namespace, key, environment)` for rows with `user_id IS NULL` and `is_secret` false; rows with `is_secret=true` go to a separate `secrets` set that is never compared against ordinary readers and whose values are never read or printed (F-08).
3. Statement splitter plus a closed rewrite model, one case each: multi-row `INSERT ... VALUES` including the 001 narrow column list with the 002 `'dev'` default; the 017 environment rename (`SET environment='<lit>' WHERE environment='<lit>'`, applied to `config.config_values` only, never `config.config_audit`); the 029 heal with its exact guards (`NOT LIKE namespace || '.%'`, `is_secret = false`, `namespace IN (...)`). Any other `UPDATE`/`DELETE` against `config.config_values` that the model cannot interpret trips the fail-closed trigger (finding kind internal `unmodelled-rewrite`, exit 1) unless allow-listed.
4. The allow-list is read from `config-wiring.json` `registry.rewriteAllow` and keyed on migration file name plus a SHA-256 of the whitespace-normalized statement; never on statement shape or NNN alone (design.md Rejected Alternatives).
5. Output lines are `file:key:kind[:env]` and never contain values.

**Verification**:
```
node --check scripts/check-config-wiring.mjs && node --test scripts/config-wiring.test.mjs
```

---

### Step 2 — test: Parser fixtures and tests (authored red)

**Status**: `pending`
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

**Reviewers**: Platform Lead — cross-service tooling and SDD process

**Codebase Evidence**:
- Test runner and style precedent: `scripts/workflow-tests/merge-train-resolve.test.mjs` (`node:assert/strict`, `node:test`, temp-dir scenarios via `fs.mkdtempSync`); run command `node --test scripts/workflow-tests/*.test.mjs` at `.github/workflows/ci.yml:724`.
- Real shapes the fixtures must reproduce: 001 narrow insert (`001_config_tables.up.sql:55-69`), 002 production re-insert (`002_config_environment.up.sql:48-71`), 017 rename (`017_config_secrets_and_scoping.up.sql:38-39`), 029 heal (`029_heal_config_keys_full_dotted.up.sql:24-28`), 025 bare ingest seed (`025_ingest_mcp_client_keys.up.sql:25-29`).
- Negative matches that must classify as wired (recon.md Patterns to REUSE): fully dotted seeds from 018, 021, 022, 026, 027, 028, 030; ui `performance.*` (023); agent `signal.alert_threshold` (004).
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

**Verification**:
```
node --test scripts/config-wiring.test.mjs
```
No coverage threshold applies (Node script tests, not a service; C-08 service thresholds are not defined for `scripts/`); the suite is run by the `config-wiring` CI job (Step 13). Lint: `node --check scripts/config-wiring.test.mjs`.

---

### Step 3 — service: Reader extraction (Python `ast`, Go and TypeScript regex)

**Status**: `pending`
**Service**: `scripts/` (repo tooling)
**Files**:
- `scripts/check-config-wiring.mjs` — modify
- `scripts/config-wiring-py-reads.py` — create (stdlib `ast` only; invoked as `python3 -I`)

**Reviewers**: Platform Lead — cross-service tooling and SDD process

**Codebase Evidence**:
- Python getters over a raw snapshot: ingest `services/xstockstrat-ingest/app/config/watcher.py:104,112,120,130,138` (`get_str`, `get_int`, `get_int_present`, `get_bool`, `get_float`); analysis adds `get_float_present` (`services/xstockstrat-analysis/app/config/watcher.py:136`); indicators adds `get_str_present` (`services/xstockstrat-indicators/app/config/watcher.py:98`).
- Python shapes the AST must resolve: multi-line call `services/xstockstrat-analysis/app/engine/fundsignal_loop.py:148`; plain literal `fundsignal_loop.py:136` `self._cfg.get_bool("analysis.fundsignal.enabled", default=False)`; same-file constant `services/xstockstrat-agent/app/tools.py:78` `_ALERT_THRESHOLD_CONFIG_KEY = "signal.alert_threshold"`; cross-watcher read `fundsignal_loop.py:97` (`marketdata.fundamentals.provider`).
- Go getters: `Watcher.GetString/GetInt/GetFloat/GetBool` at `services/xstockstrat-portfolio/internal/config/config.go:112,126,140,170`, `services/xstockstrat-trading/internal/config/config.go:205,215,225,235`, `services/xstockstrat-marketdata/internal/config/config.go:142,156,170,184`. Indirection: parameterized helper `services/xstockstrat-marketdata/internal/service/marketdata_service.go:982-987` `resolvePositiveInt(cfg intGetter, key string, def int64)`; constant read `services/xstockstrat-portfolio/internal/config/config.go:160` `w.GetString(FactorMapKey, "{}")`.
- TypeScript: index syntax `this.snapshot?.values[key]` at `services/xstockstrat-ledger/src/services/configWatcher.ts:108,113,118` (and the config/notify/identity equivalents); direct index `services/xstockstrat-ui/src/lib/performanceMetrics.ts:193` `values['performance.risk_free_rate_annual']`.
- **Not found**: any current `int_positive` getter (feature 244 adds it, not on this branch); it is handled via the forwarder registry, not hard-coded.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. `config-wiring-py-reads.py`: walk `services/*/app/**/*.py` (skip `tests/`), use `ast` to find calls whose attribute or name is one of the getter names (`get_str`, `get_int`, `get_int_present`, `get_bool`, `get_float`, `get_float_present`, `get_str_present`) or `.values.get(...)`/`.values[...]` on a snapshot. Resolve the first argument: string literal, or a module-level `Name` bound to a string literal in the same file; anything else is reported as `{"file","symbol","line","dynamic":true}`. Emit JSON on stdout.
2. In the Node script add `extractGoReads` and `extractTsReads`: regex over the `Get(String|Int|Float|Bool)\(` call and the `values\[`-index syntax; match across line breaks (`s` flag, balanced to the first argument) so a literal split over lines is not misreported; resolve a bare identifier through a same-service constant (`const X = "..."` / Go `const`/`var`) found in the same package or imported same-service file; otherwise `dynamic-read`.
3. Add `registry.forwarders` (key `file:symbol` of the helper, value `{"keyArg": <index>}`): calls to a registered helper are treated as getter calls on the given argument. Add `registry.dynamic` (key `file:symbol`, value an array of the keys that call site can produce): an enumerated dynamic site yields those reads instead of a `dynamic-read` finding. The registry lives in `scripts/config-wiring.json` (design: no reader may be edited, no in-code annotation).
4. Cross-namespace reads are not matched by the consuming service's namespace: reads are plain strings joined against the whole stored set.
5. Never read `GetSecret` calls as ordinary reads.

**Verification**:
```
node --check scripts/check-config-wiring.mjs && python3 -I -m py_compile scripts/config-wiring-py-reads.py && node --test scripts/config-wiring.test.mjs
```

---

### Step 4 — test: Reader-extraction fixtures and tests (authored red)

**Status**: `pending`
**Service**: `scripts/` (repo tooling)
**Files**:
- `scripts/config-wiring.test.mjs` — modify
- `scripts/config-wiring-fixtures/readers/services/xstockstrat-analysis/app/literal_and_const.py` — create (multi-line call, same-file constant)
- `scripts/config-wiring-fixtures/readers/services/xstockstrat-analysis/app/dynamic_fstring.py` — create (`f"analysis.{name}.enabled"`)
- `scripts/config-wiring-fixtures/readers/services/xstockstrat-analysis/tests/ignored_test_reader.py` — create (must not be scanned)
- `scripts/config-wiring-fixtures/readers/services/xstockstrat-marketdata/internal/service/forwarder.go` — create (`resolvePositiveInt`-shaped helper and two callers)
- `scripts/config-wiring-fixtures/readers/services/xstockstrat-marketdata/internal/config/split_literal.go` — create (literal split over two lines, constant, `GetSecret`)
- `scripts/config-wiring-fixtures/readers/services/xstockstrat-ui/src/lib/index_reads.ts` — create (`values['...']` literal and `values[key]` dynamic)

**Reviewers**: Platform Lead — cross-service tooling and SDD process

**Codebase Evidence**:
- Real call shapes to copy into fixtures: `fundsignal_loop.py:136,148` (literal, multi-line), `tools.py:78` (constant), `marketdata_service.go:982-987` (forwarder), `portfolio/internal/config/config.go:160` (constant), `performanceMetrics.ts:193` (index), `configWatcher.ts:108` (parameter `key` -> dynamic).
- Dynamic example for @AC-9: an f-string key `f"analysis.{name}.enabled"` where `name` is a function parameter; digest found no such runtime f-string getter in analysis `app/` today (recon.md Risks), so the fixture is synthetic.
- Quality gate from design.md: the count of false-dynamic-read entries (a literal argument split across lines) in the Go and TS extractors must be zero.

**TDD**: `red-green required`

**Covers**: `AC-1` (reader side: both strings are extracted verbatim), `AC-9` (runtime-built key is reported, not skipped)

**Instructions**:
Author failing cases: (a) Python multi-line call and same-file constant resolve to the literal; (b) Python `f"analysis.{name}.enabled"` with `name` a parameter produces exactly one dynamic entry naming file and symbol; (c) the same site listed in `registry.dynamic` resolves to its enumerated keys and produces no dynamic entry; (d) Go literal split over two lines resolves (false-dynamic count = 0); (e) Go `resolvePositiveInt(cfg, key, def)` is dynamic without a forwarder entry and resolves at its callers with one; (f) Go and Python constants resolve; (g) TS `values['performance.risk_free_rate_annual']` and `this.snapshot?.values[key]` classify as literal and dynamic respectively; (h) a `GetSecret("x")` call is not extracted as an ordinary read; (i) a `tests/` file is not scanned.

**Verification**:
```
node --test scripts/config-wiring.test.mjs
```
No coverage threshold applies (tooling). Lint: `node --check scripts/config-wiring.test.mjs && python3 -I -m py_compile scripts/config-wiring-py-reads.py`.

---

### Step 5 — service: Join with collapse, finding kinds and output

**Status**: `pending`
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

**Status**: `pending`
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
- Scenario keys (illustrative, per `acceptance.feature` comment): `ingest` `mcp_client.request_timeout_seconds` read as `ingest.mcp_client.request_timeout_seconds`; `ledger` `stream.notify_enabled` (seed `001_config_tables.up.sql:65`) with no reader; `ingest.backfill.retry_on_failure` read at `services/xstockstrat-ingest/app/config/watcher.py:191` with no seed (recon.md Baseline source).
- Negative matches: dotted seeds 018/021/022/026/027/028/030, ui `performance.*`, agent `signal.alert_threshold`, 029-healed keys.

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

**Status**: `pending`
**Service**: `scripts/` (repo tooling)
**Files**:
- `scripts/check-config-wiring.mjs` — modify
- `scripts/config-wiring.json` — create (empty-shape: `{"policy":{"envReadUnseeded":"reported"},"findings":[],"registry":{"forwarders":{},"dynamic":{},"rewriteAllow":[]}}`)

**Reviewers**: Platform Lead — cross-service tooling and SDD process

**Codebase Evidence**:
- Baseline-with-owner precedent: `.jscpd.json` and `scripts/check-duplication.sh` are the repo's only baseline-style files, but they are threshold-only (`minTokens: 100`, `DUP_REPORT_ONLY=1`), with no per-entry owner; so the owner-bearing ratchet is **Not found**, built new.
- Step-time versus completion gate: `.claude/skills/sdd-execute/SKILL.md:289` (Verification runs before the `done` flip at `:298-299`); step bodies immutable (`SKILL.md:487`, F-09).
- Declared-key sources (FR-2): product spec `## Config Key Changes` (`.claude/skills/sdd-story/SKILL.md:198`) and a migration inserting into `config.config_values` (@AC-10). The overlap-check regex ``[a-z][a-z-]+\.[a-z]+\.[a-z_]+`` (`overlap-check.md:25,53`) matches only three-segment keys, so this step defines its own pattern.
- Owners to be recorded in entries (Step 11): feature 277/278 and 243 (product spec Open Questions; recon.md Baseline source).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Validate `config-wiring.json` on every run: each `findings[]` entry must carry `namespace`, `key`, `kind`, optional `envs` (list), and a non-empty `owner` matching `^(feature )?(243|277|278)\b|^(defect|feature) .+`; an entry without an owner makes the run fail naming the entry (@AC-8). Schema errors exit `2`.
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

**Status**: `pending`
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
- Key examples: `analysis.fundsignal.enabled` (`fundsignal_loop.py:136`; seeded bare in `008_analysis_fundsignal_keys.up.sql:13`); `ledger` `stream.notify_enabled`.

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

**Status**: `pending`
**Service**: `docs/roadmap/features/278-enforce-config-key-wiring/`
**Files**:
- `docs/roadmap/features/278-enforce-config-key-wiring/context.md` — modify (append the run record)

**Reviewers**: none

**Codebase Evidence**:
- Baseline reconciliation targets (feature 277 sweep, `docs/roadmap/features/277-fix-ingest-seeded-config-keys/recon.md:86-103` on branch `feature/fix-ingest-seeded-config-keys`): 5 ingest + 13 analysis `form-mismatch` (18); dead seeds `analysis` `backtest.max_duration_seconds` (`001_config_tables.up.sql:69`) and `ledger` `stream.notify_enabled` (`:65`); unseeded `ingest.backfill.max_concurrent_jobs` (`watcher.py:187`) and `ingest.backfill.retry_on_failure` (`:191`); extras `ingest.backfill.max_retry_attempts` (`:195`), `ingest.signals.dedup_window_hours` (`:215`), analysis `fundsignal.retry_seconds`, `startup_jitter_seconds`; `indicators.sandbox.*` (feature 243).
- Open risk to close here: no migration after 017 renames environments again, and 002, 005, 025 do not trip the fail-closed trigger (design.md Open Risks).

**TDD**: `N/A (non-code-bearing: records a run, writes no code)`

**Covers**: —

**Instructions**:
1. Run `node scripts/check-config-wiring.mjs --final --json > <scratchpad>/first-run.json` with `findings` empty. Do not run any staging or production read or write.
2. Append a `## Session 2026-10-23 — sdd-execute 278 step 9` block to `context.md` with: total finding counts per kind; the list of `read-unseeded env=` entries (count and keys); the reconciliation of the produced list against the 277 sweep (18 + 2 + 2 + the four extras + `indicators.sandbox.*`), stating any difference and its cause; the result of the two open-risk checks above. Any new migration shape that trips `unmodelled-rewrite` is added to the closed model with a fixture in Step 2's suite, never allow-listed by weakening the trigger (log it in the `## Deviation Log`).
3. If 243 (`031_heal_indicators_sandbox_keys_full_dotted`), 248 (`032_ledger_stream_resolve_timeout`), 244 (`032_analysis_zero_trap_descriptions`) or 264 (`034`) migrations have landed on the base by now, the stored set differs from this spec's; re-run and record the difference before Step 10/11.
4. Record the proposed owner for each group: 277/278 for the 18 form mismatches, the two dead seeds and the two named unseeded ingest keys; "feature 278" for the four extras (operator may overrule); 243 for `indicators.sandbox.*`.

**Verification**:
```
node scripts/check-config-wiring.mjs --final --json | node -e "const j=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log(Object.keys(j))" && grep -n "sdd-execute 278 step 9" docs/roadmap/features/278-enforce-config-key-wiring/context.md
```

---

### Step 10 — docs: OPERATOR decision gate — environment baseline

**Status**: `pending`
**Service**: `docs/roadmap/features/278-enforce-config-key-wiring/`
**Files**:
- `docs/roadmap/features/278-enforce-config-key-wiring/context.md` — modify (record the operator's results and ruling)

**Reviewers**: none

**Codebase Evidence**:
- This step is performed by the OPERATOR. The implementation session has only the staging MCP (`mcp__xstockstrat_staging__get_config`) and cannot read production; the tool reads only its own deployment's environment ("it is a deployment property ... this tool cannot read another environment's rows"). The step therefore must not assume the agent can read production.
- Why the gate exists: 002 back-fills 001-era rows via `DEFAULT 'dev'` (`002_config_environment.up.sql:7`) and 017 renames dev to staging (`017_config_secrets_and_scoping.up.sql:38`); 002:48-71 re-inserts production rows for platform, trading (four approval/risk keys), indicators, marketdata, portfolio and analysis, but **not** `ledger` `stream.notify_enabled` (001:65) or `trading` `fill_poller.interval_ms` (001:61). Offline they appear staging-only.
- Sampled 001-era keys (chosen to span the gap): `ledger` `stream.notify_enabled`; `trading` `fill_poller.interval_ms` (after the 029 heal, stored as `trading.fill_poller.interval_ms` if present); control `platform` `maintenance_mode` (re-inserted for production by `002:48`).

**TDD**: `N/A (operator decision step; no code)`

**Covers**: —

**Instructions**:
OPERATOR actions, all read-only, nothing written:
1. Read the first-run `read-unseeded env=` count and list that Step 9 recorded in `context.md`.
2. Against the **production** deployment's agent (the same MCP server configured for production, whose environment is production), call the read-only tool `get_config` three times: `get_config(namespace="ledger")`, `get_config(namespace="trading")`, `get_config(namespace="platform")` (leave `user_id` empty). In each result, check that `values` contains `stream.notify_enabled`, `trading.fill_poller.interval_ms` (or the bare `fill_poller.interval_ms`) and `platform.maintenance_mode` (or bare `maintenance_mode`) respectively, and note the returned `environment` field equals `production`. Do not call `set_config` or any manage tool. Secret values are `[redacted]` by the tool.
3. Record in `context.md`: the three results (present or absent, stored form seen), then the ruling: **blocking** (env-scoped `read-unseeded` fails CI and enters the ratchet) or **reported-only** (printed `REPORTED:`, kept out of the ratchet). If production lacks rows the offline model says exist, or has rows it cannot see (runtime-created), say so; the governance section (Step 18) documents runtime-created keys as `read-unseeded` by design.
4. Until this record exists, `policy.envReadUnseeded` stays `reported` and no later step may rely on a different value.

**Verification**:
```
grep -n "environment-baseline decision" docs/roadmap/features/278-enforce-config-key-wiring/context.md
```
The execute loop leaves this step `pending` until the operator's entry exists (a heading containing `environment-baseline decision` and a line starting `Ruling:`).

---

### Step 11 — docs: Freeze baseline `findings` and `registry`

**Status**: `pending`
**Service**: `scripts/` (repo tooling)
**Files**:
- `scripts/config-wiring.json` — modify
- `docs/roadmap/features/278-enforce-config-key-wiring/context.md` — modify (final counts, owner overrules)

**Reviewers**: Platform Lead — baseline contents and ownership, `xstockstrat-config` owner — key list

**Codebase Evidence**:
- Contents come from Step 9's run and the operator ruling from Step 10; reference list in recon.md Baseline source (`recon.md` table) and `docs/roadmap/features/277-fix-ingest-seeded-config-keys/recon.md:86-103`.
- The ingest defect report `docs/reports/2026-10-22-ingest-seeded-config-keys-never-read-defect.md` is closed `wont-fix`, so entries name feature 277/278 as owner, not the report (product spec Out of Scope).
- `indicators.sandbox.*` is owned by feature 243 until its migration `031_heal_indicators_sandbox_keys_full_dotted` lands (not on this branch; recon.md Dependencies).
- **Not found**: any seed or reader fix landing in this feature; none is allowed (no reader or seed edit).

**TDD**: `N/A (config data file; verified by Step 12's real-tree test)`

**Covers**: —

**Instructions**:
1. Set `policy.envReadUnseeded` to the operator's ruling from Step 10 (`blocking` or `reported`).
2. Fill `findings` with exactly the findings the first run produced, each with `owner`: `feature 277` or `feature 278` for the form mismatches, dead seeds and unseeded ingest keys; `feature 278` for the four extras (record any operator overrule in `context.md`); `feature 243` for `indicators.sandbox.*`. Record the final count per kind in `context.md` (design leaves the exact count to this run).
3. Fill `registry.forwarders` / `registry.dynamic` / `registry.rewriteAllow` with only the entries the first run required (for example `marketdata_service.go:resolvePositiveInt`), each justified in one line in `context.md`.
4. Do not add any entry to hide a finding that has a fixable cause in the extractor; fix the extractor in Step 3's code instead (false-dynamic-read count must be zero).

**Verification**:
```
node scripts/check-config-wiring.mjs --final && echo OK
```

---

### Step 12 — test: Real-tree and baseline-integrity tests (authored red)

**Status**: `pending`
**Service**: `scripts/` (repo tooling)
**Files**:
- `scripts/config-wiring.test.mjs` — modify

**Reviewers**: Platform Lead — cross-service tooling and SDD process

**Codebase Evidence**:
- Acceptance wording @AC-7 (baseline lists every 277-sweep finding with owner) and @AC-8 in `acceptance.feature`.
- The CI job (Step 13) runs `node --test scripts/config-wiring.test.mjs`, so these tests are what keeps a stale baseline from merging.

**TDD**: `red-green required` (red proof: run the new tests against the empty-shape `config-wiring.json` from Step 7, restored from git into a scratch `--root`, since Step 11's data already exists in the tree when this step is executed)

**Covers**: `AC-7, AC-8`

**Instructions**:
Add: (1) a test running the CLI with `--final` against the real repo root, asserting exit 0 (committed baseline equals the tree); (2) every committed `findings[]` entry has a non-empty `owner` and a `kind` among the four; (3) the committed baseline contains at least the 277-sweep set reconciled in Step 9 (asserted by key lists copied from `context.md`, not recomputed); (4) the committed JSON has no value text and no secret-class key; (5) the extractors' scan roots (exported constant) equal the `config-wiring` path filter globs parsed from `.github/workflows/ci.yml`, so a reader outside the filter cannot change without triggering the job.

**Verification**:
```
node --test scripts/config-wiring.test.mjs
```
No coverage threshold applies (tooling). Lint: `node --check scripts/config-wiring.test.mjs`.

---

### Step 13 — service: CI job `config-wiring` and `ci-gate` wiring

**Status**: `pending`
**Service**: `.github/workflows/ci.yml`
**Files**:
- `.github/workflows/ci.yml` — modify

**Reviewers**: Platform Lead — CI job matrix and gate

**Codebase Evidence**:
- Job shape to copy: `migration-contract-gate` at `.github/workflows/ci.yml:676-692` (`needs: changes`, `if:` on `matched`, `actions/checkout@v7`, one script step). No `fetch-depth` is needed: the scan is whole-tree (`fails.md:1040`).
- `changes` filters block at `ci.yml:39-91` has `scripts`, `migrations`, per-service filters and `context-map`, and **no aggregate service-source filter**.
- `ci-gate` `needs:` list and echo list at `ci.yml:776-818` (`- context-map`, `echo "context-map: ..."`); a job missing there is not enforced.
- `context-map` job runs `node --test scripts/workflow-tests/*.test.mjs` (`ci.yml:723-724`); our test is a separate file and is run by the new job itself.
- Shell lint covers `scripts/*.sh` only (`ci.yml:626-629`), so the `.mjs` files are outside shellcheck/shfmt; no `*.test.sh` is added, so the structural-test line `ci.yml:632` is unchanged.

**TDD**: `N/A (CI workflow; behavior proven by Steps 8 and 12 and a local run)`

**Covers**: `AC-7` (CI job), `AC-8`

**Instructions**:
1. Add a `config-wiring` filter to `changes`: `services/xstockstrat-config/migrations/**`, `services/*/app/**`, `services/*/internal/**`, `services/*/src/**`, `scripts/check-config-wiring.mjs`, `scripts/config-wiring-py-reads.py`, `scripts/config-wiring.json`, `scripts/config-wiring.test.mjs`, `scripts/config-wiring-fixtures/**`.
2. Add job `config-wiring` ("Config key wiring (whole-tree)"): `needs: changes`, `if:` matched `config-wiring` or `ci`, steps: `actions/checkout@v7`, `actions/setup-node` pinned to the Node 24 line used by other jobs (copy the exact step from `node-lint`), `node --test scripts/config-wiring.test.mjs`, `node scripts/check-config-wiring.mjs --final`.
3. Add `config-wiring` to `ci-gate` `needs:` and add `echo "config-wiring: ${{ needs.config-wiring.result }}"`.
4. The filter roots must equal the extractors' scan roots (`services/*/app`, `services/*/internal`, `services/*/src`, covering the ui reader `services/xstockstrat-ui/src/lib/performanceMetrics.ts`); Step 12 test (5) asserts this.
5. Only after Step 11's ruling is recorded does this step run; the job is a whole-tree scan, never the diff.

**Verification**:
```
python3 -c "import yaml,sys; d=yaml.safe_load(open('.github/workflows/ci.yml')); assert 'config-wiring' in d['jobs']; assert 'config-wiring' in d['jobs']['ci-gate']['needs']" && grep -n "config-wiring" .github/workflows/ci.yml && node --test scripts/config-wiring.test.mjs && node scripts/check-config-wiring.mjs --final
```

---

### Step 14 — docs: `/sdd-execute` Phase 3 gate and repo conventions

**Status**: `pending`
**Service**: `.claude/skills/sdd-execute/`
**Files**:
- `.claude/skills/sdd-execute/SKILL.md` — modify
- `.claude/skills/sdd-execute/reference/repo-conventions.md` — modify

**Reviewers**: Platform Lead — SDD process

**Codebase Evidence**:
- Phase 3 step 3 runs `**Verification**` (`SKILL.md:289`) and step 4 flips `**Status**` to `done` (`SKILL.md:298-299`); the offline-only migration rule is `SKILL.md:290-297`; the all-steps-done transition to `code-completed` is `SKILL.md:303`; step bodies are immutable (`SKILL.md:487`).
- TDD-gate carve-out: `SKILL.md:285` (config/migration steps skip it), so for them the wiring check is the only gate (recon.md Risks).
- Config-key convention line: `.claude/skills/sdd-execute/reference/repo-conventions.md:30` (`- **Config keys**: format is <service-short-name>.<category>.<key>`).
- Reference files are listed in `.claude/context-map.yaml:80-86`; no new reference file is created.

**TDD**: `N/A (docs/skill text; structural assertions in Step 17)`

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

### Step 15 — docs: Sequential-mode mirror

**Status**: `pending`
**Service**: `.claude/skills/sdd-execute/`
**Files**:
- `.claude/skills/sdd-execute/reference/sequential-mode.md` — modify

**Reviewers**: Platform Lead — SDD process

**Codebase Evidence**:
- Sequential mode runs Phase 3 unchanged inside the step loop: `reference/sequential-mode.md:80-92` (§5.5; "Run **Phase 3 Execution** + Verification unchanged, including the offline migration check ... `SKILL.md` Phase 3 / HARD CONSTRAINTS", line 92-93). The design's cited `:112` is inside §5.5b (`:109-` smart checkpoints) and is **not** the mirror location; the correct anchors are §5.5 (`:80`) and §5.6 per-feature integration PR (`:145`).
- Feature-end checkpoint precedes the integration PR (`sequential-mode.md:109-125`, condition 3).

**TDD**: `N/A (docs/skill text; structural assertions in Step 17)`

**Covers**: `AC-4, AC-5, AC-10`

**Instructions**:
In §5.5 add one bullet stating that Phase 3's wiring gate (Step 14) applies unchanged in sequential mode, step-time mode per step; in §5.6, before the integration PR is created, add the `--final` run as a blocking gate on the feature's last step and record its output in `context.md`. Keep the text to the two edits; do not restate the gate rules.

**Verification**:
```
grep -n "check-config-wiring" .claude/skills/sdd-execute/reference/sequential-mode.md && ./scripts/check-context-map.sh
```

---

### Step 16 — docs: `/sdd-review` B2 row and `/sdd-story` declared-key format

**Status**: `pending`
**Service**: `.claude/skills/sdd-review/`, `.claude/skills/sdd-story/`
**Files**:
- `.claude/skills/sdd-review/reference/impl-spec-criteria.md` — modify
- `.claude/skills/sdd-story/SKILL.md` — modify

**Reviewers**: Platform Lead — SDD process

**Codebase Evidence**:
- B2 table at `impl-spec-criteria.md:12-31`; the `C-14` row at `:31` is the precedent for a prominent FAIL row although Mode B is advisory (`:4`); WARN list starts `:33`. Today no sdd-review text mentions config readers or `config.config_values` (recon.md Risks).
- `## Config Key Changes` template in `.claude/skills/sdd-story/SKILL.md:196-199` (`- [ ] No new config keys` / `- OR: list keys in <service>.<category>.<key> format`); nothing in sdd-review or sdd-execute reads that section today (recon.md).
- Product-spec criterion 6 checks key format only (`product-spec-criteria.md:25`).

**TDD**: `N/A (docs/skill text; structural assertions in Step 17)`

**Covers**: `AC-6, AC-11`

**Instructions**:
1. Add a B2 row `Config key wiring` after the `C-14` row with two FAIL clauses and no third: (a) the product spec's `## Config Key Changes` lists a key but no step names the reader file and symbol that looks it up (@AC-6); (b) no test builds a config snapshot from the seeded key and asserts the real reader returns the seeded value (@AC-11; model on `services/xstockstrat-ingest/tests/test_config_watcher.py:56,74` and `tests/test_ingest_servicer.py:77`). State that it is a prominent FAIL even though Mode B is advisory, following the `C-14` precedent, and that the reviewer cites the key by name.
2. In `sdd-story/SKILL.md` under `## Config Key Changes`, pin the declared-key format: one backticked key per bullet, `<namespace>.<key>` exactly as the migration stores it (so `--declared-from` can extract it), and note that the check treats this section as the declared set.

**Verification**:
```
grep -n "Config key wiring" .claude/skills/sdd-review/reference/impl-spec-criteria.md && grep -n "declared" .claude/skills/sdd-story/SKILL.md && ./scripts/check-context-map.sh
```

---

### Step 17 — test: Skill-text structural assertions (authored red)

**Status**: `pending`
**Service**: `scripts/` (repo tooling)
**Files**:
- `scripts/config-wiring.test.mjs` — modify

**Reviewers**: Platform Lead — SDD process

**Codebase Evidence**:
- Process behavior (@AC-4/5/6/10/11) is executed by an LLM following skill text, so the only deterministic proof is that the load-bearing text is present; the script half is proven in Steps 8 and 12. Precedent for text-structure tests of skills/workflows: `scripts/workflow-tests/*.test.mjs`.

**TDD**: `red-green required` (red proof: point the assertions at the skill files as of the commit before Step 14, via `git show`; green is the committed text from Steps 14-16)

**Covers**: `AC-4, AC-5, AC-6, AC-10, AC-11`

**Instructions**:
Add failing assertions over the real files: `sdd-execute/SKILL.md` contains the `check-config-wiring.mjs` step-time command before the `done` flip and the `--final` command before the `code-completed` flip, and states the three triggers (config step, migration inserting into `config.config_values`, product-spec declared key) and that an undeclared step is not blocked; `sequential-mode.md` contains both mirrors; `impl-spec-criteria.md` contains the `Config key wiring` row with exactly two clauses (reader file+symbol, snapshot-built test) and no clause requiring a backticked stored-key quote; `sdd-story/SKILL.md` pins the declared-key format.

**Verification**:
```
node --test scripts/config-wiring.test.mjs
```
No coverage threshold applies (tooling). Lint: `node --check scripts/config-wiring.test.mjs`.

---

### Step 18 — docs: Governance rule, merge-order row, context-map check and teardown

**Status**: `pending`
**Service**: `docs/patterns/`, `docs/roadmap/features/`
**Files**:
- `docs/patterns/config-governance.md` — modify (append-only; keep feature 182's registered-keys entries)
- `docs/roadmap/features/merge-order.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `docs/patterns/config-governance.md` headings: `## Rules` (`:5`), `## Registering a new config key` (`:56`, steps 1-4 listed at `:58-61`), `## Per-Feature Registered Keys` (`:105`). Existing PRESERVE-equivalent: feature 182's entries and `docs/sdd/business-rules/platform.feature` @AC-6 (recon.md Existing Business Rules). Feature 264 also edits this file (rebase-only overlap; recon.md Dependencies).
- `docs/roadmap/features/merge-order.md` already carries rows for 243/244/261 (e.g. line 82, 244 vs 261); the new row records that 243, 244 and 261 will edit `scripts/config-wiring.json`.
- `scripts/check-context-map.sh` validates `.claude/context-map.yaml` paths and doc cross-references (`check-context-map.sh:1-30`).
- Teardown: root `CLAUDE.md` § Teardown requires `/context-forge:context-constitution refresh` scoped to touched context files, or a recorded manual reconciliation if the plugin is unavailable (ledger `fails.md:670`).

**TDD**: `N/A (docs-only)`

**Covers**: —

**Instructions**:
1. In `config-governance.md` add a section `## Wiring check (config key must be read under its stored key)` after `## Registering a new config key`: the stored key must equal the reader string verbatim; the four finding kinds; the step-time versus `--final` split; the baseline in `scripts/config-wiring.json` (owner required, entries may only shrink); keys created at runtime (`SetConfig create_key=true`, config-ui) surface as `read-unseeded` by design and must be seeded in a migration; secrets are excluded and values are never printed. Add one line to the registering list pointing at the section. Do not touch the registered-keys log.
2. Add a `merge-order.md` row: 278 lands before 243/244/261 edit `scripts/config-wiring.json`; the feature artifacts live on `ccr-fac38b1f-6m24q2` (PR #1322, not yet merged to `main-dev`).
3. `.claude/context-map.yaml` is not edited: it registers only workflow helpers/tests (`merge-train-resolve.mjs`, `workflow-tests/*`, lines 55-64), not tooling scripts. Run `./scripts/check-context-map.sh`.
4. Teardown: run `/context-forge:context-constitution refresh` scoped to `docs/patterns/config-governance.md` and the touched skill files; fix grounded drift. If the plugin is unavailable, re-read each touched context file against the current code and record in the PR body both that the plugin was unavailable and the manual reconciliation performed (a bare "plugin unavailable" does not pass).

**Verification**:
```
./scripts/check-context-map.sh && grep -n "Wiring check" docs/patterns/config-governance.md && grep -n "config-wiring" docs/roadmap/features/merge-order.md && node --test scripts/config-wiring.test.mjs && node scripts/check-config-wiring.mjs --final
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._

# Implementation Spec: fix-mcp-config-key-registry

**Status**: `pending`
**Created**: 2026-08-02
**Feature**: `docs/roadmap/features/091-fix-mcp-config-key-registry/feature.md`
**Total Steps**: 8
**Feature Branch**: `feature/fix-mcp-config-key-registry`

---

## Execution Summary

Implements the design's single-table, server-authoritative fix (no new registry table). Order is
proto → codegen → migration → config service + its test → agent service + its test → docs. The proto
field (`create_key`) must exist and be regenerated before either service can reference it; the
migration (audit-on-INSERT) is independent of the servicer change but both land before the config
test so the test can prove the existence gate and (via a live-DB check in the migration step) the
audit-on-create behavior. The agent change is a thin passthrough of `create_key` — the design keeps
the existence refusal **server-side only**, so the existing empty-`keys` agent mocks stay valid.

## Step Dependencies

- Step 2 (proto-gen) requires Step 1 (proto): stubs regenerate the new field.
- Step 4 (config service) requires Step 2: reads `call.request.createKey` from the regenerated TS type; also depends on Step 3 conceptually (audit-on-insert is what makes a `create_key=true` creation auditable) but the two files do not overlap.
- Step 5 (config test) covers Step 4 [service] — paired per C-08; also exercises the migration's field-name/wire contract.
- Step 6 (agent service) requires Step 2: `client.set_config` sets `SetConfigRequest.create_key` on the regenerated Python message.
- Step 7 (agent test) covers Step 6 [service] — paired per C-08; the descriptor-parity test imports the regenerated `config_pb2`.
- Step 8 (docs) requires Steps 3/4/6: the docstring/runbook claims it corrects ("blind upsert", "creating a new key writes no audit row", unreachable NOT_FOUND) only become false once those steps land.

---

### Step 1 — proto: add `SetConfigRequest.create_key` field 8

**Status**: `pending`
**Service**: `packages/proto`
**Files**:
- `packages/proto/config/v1/config.proto` — modify

**Reviewers**: Proto Reviewer — field number uniqueness, no breaking change without deprecation, `buf lint`/`buf breaking` pass; xstockstrat-config — environment/trading_mode scoping; xstockstrat-agent — MCP tool contract stability

**Codebase Evidence**:
- `SetConfigRequest` is defined at `packages/proto/config/v1/config.proto:88-96`; its last field today is `xstockstrat.common.v1.TradingMode trading_mode = 7;` (`:95`). Next free number is **8** (additive → `buf breaking`-safe; recon.md § Dependencies, design §3).
- Sibling `GetConfigRequest`/`ListKeysRequest` already import `xstockstrat.common.v1` types, so no new import is needed for a plain `bool`.

**TDD**: `N/A (proto)`

**Instructions**:
1. In `SetConfigRequest` (`config.proto:88-96`), after line `xstockstrat.common.v1.TradingMode trading_mode = 7;`, add:
   ```proto
   // When true, allow this write to CREATE a not-yet-registered key at the exact
   // (namespace,key,environment,trading_mode) scope. Default false: a write to an
   // unregistered scope is refused with NOT_FOUND, so a typo cannot mint an orphan key.
   bool create_key = 8;
   ```
2. Do not renumber any existing field; `create_key` is purely additive.

**Verification**:
```bash
cd packages/proto && buf lint && buf breaking --against ".git#branch=feature/fix-mcp-config-key-registry"
```
Both must pass (additive scalar field → no breaking-change violation).

---

### Step 2 — proto-gen: regenerate stubs

**Status**: `pending`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/ts/**` — modify (generated)
- `packages/proto/gen/python/**` — modify (generated)
- `packages/proto/gen/go/**` — modify (generated)

**Reviewers**: Proto Reviewer — field number uniqueness, no breaking change without deprecation, `buf lint`/`buf breaking` pass; xstockstrat-config — environment/trading_mode scoping; xstockstrat-agent — MCP tool contract stability (inherited from Step 1)

**Codebase Evidence**:
- Root `CLAUDE.md` § Generating Proto Stubs: `./scripts/buf-gen.sh` generates TypeScript, Python, and Go stubs and compiles the TS package; run after any `.proto` change (CI `proto-freshness` enforces an empty diff).
- Config consumes the TS stub as `@xstockstrat/proto/config/v1/config` (`src/__tests__/listKeysWire.test.ts:63`); the agent consumes the Python stub as `gen.config.v1.config_pb2` (`services/xstockstrat-agent/app/client.py:934`).

**TDD**: `N/A (proto-gen)`

**Instructions**:
1. Run `./scripts/buf-gen.sh` from repo root.
2. Confirm the diff under `packages/proto/gen/` is limited to the new `create_key` / `createKey` field across the three language stubs plus the compiled TS output in `gen/ts/dist/`.

**Verification**:
```bash
./scripts/buf-gen.sh
git status --porcelain packages/proto/gen/   # only create_key-related churn expected
grep -rn "createKey\|create_key" packages/proto/gen/ts/config/v1/config.ts   # field present in TS stub
```
`createKey` must appear on the generated `SetConfigRequest` TS type; the Python `config_pb2` and Go stub must likewise carry `create_key`.

---

### Step 3 — migration: audit key creation via a dedicated AFTER INSERT trigger (`010`)

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/migrations/010_config_audit_insert_trigger.up.sql` — create
- `services/xstockstrat-config/migrations/010_config_audit_insert_trigger.down.sql` — create

**Reviewers**: DBA — migration NNN numbering (no gap/conflict), up+down pair present, run-order compliance with `scripts/db-migrate.sh`; xstockstrat-config — config audit correctness

**Codebase Evidence**:
- Last migration is `009_drop_fmp_api_key_config.up.sql` (confirmed via `ls services/xstockstrat-config/migrations/`) → next number is **`010`** (C-07; recon.md § Codebase Map).
- The existing audit trigger is `config_value_audit … BEFORE UPDATE ON config.config_values … EXECUTE FUNCTION config.audit_config_change()` (`migrations/001_config_tables.up.sql:49-51`); the function is redefined (not the trigger) at `002_config_environment.up.sql:33-43` to also record `environment`/`trading_mode`. Because it is `BEFORE UPDATE` only, a key **INSERT** writes no audit row (design §1; `docs/context-constitution-findings.md` "audit-on-UPDATE-only").
- `config.config_audit` columns: `namespace, key, old_value, new_value, changed_by, reason, changed_at` (`001:26-35`) + `environment, trading_mode` (`002:28-30`).
- `setConfig` inserts via `INSERT … ON CONFLICT (namespace,key,environment,trading_mode) DO UPDATE` (`src/grpc/configServiceImpl.ts:316-325`), which is exactly why a widened `BEFORE INSERT OR UPDATE` trigger would double-fire on the update path — hence a dedicated `AFTER INSERT` trigger (design §1; insights.md 2026-08-02 entry for this feature).

**TDD**: `N/A (migration)` — behavior is proven by the live-DB checks in Verification (the Node suite mocks the pool and cannot exercise a trigger; the paired config test in Step 5 covers the servicer's existence gate).

**Instructions**:
1. Create `010_config_audit_insert_trigger.up.sql`:
   - `CREATE OR REPLACE FUNCTION config.audit_config_insert()` returning `trigger`, language `plpgsql`, that writes exactly one row into `config.config_audit` with `old_value = NULL`, `new_value = NEW.value_data`, `changed_by = NEW.updated_by`, `reason = NEW.update_reason`, `environment = NEW.environment`, `trading_mode = NEW.trading_mode`, then `RETURN NEW;`. (A dedicated function, **not** a reuse of `audit_config_change()`, so it has no coupling to that function's `NEW.updated_at` mutation / no-op suppression — design §1.)
   - `DROP TRIGGER IF EXISTS config_value_audit_insert ON config.config_values;` then `CREATE TRIGGER config_value_audit_insert AFTER INSERT ON config.config_values FOR EACH ROW EXECUTE FUNCTION config.audit_config_insert();`
   - Leave the existing `config_value_audit` `BEFORE UPDATE` trigger untouched (F-01: never edit `001`/`002`).
   - Keep it idempotent (`CREATE OR REPLACE FUNCTION`, `DROP TRIGGER IF EXISTS`).
2. Create `010_config_audit_insert_trigger.down.sql`:
   - `DROP TRIGGER IF EXISTS config_value_audit_insert ON config.config_values;`
   - `DROP FUNCTION IF EXISTS config.audit_config_insert();`

**Verification**:
```bash
# Apply through 010 against the bootstrapped local TimescaleDB.
./scripts/db-migrate.sh
psql "$DATABASE_URL" -c "SELECT tgname FROM pg_trigger WHERE tgname='config_value_audit_insert';"   # exactly one row

# A fresh key INSERT is audited exactly once (old_value NULL); a subsequent ON CONFLICT re-write does NOT add an insert-audit row.
psql "$DATABASE_URL" <<'SQL'
INSERT INTO config.config_values (namespace, key, value_type, value_data, updated_by, update_reason, environment, trading_mode)
  VALUES ('spectest','spectest.k','string','v1','tester','create','dev','all');
SELECT count(*) FILTER (WHERE old_value IS NULL) AS insert_audits FROM config.config_audit WHERE namespace='spectest' AND key='spectest.k';  -- expect 1
INSERT INTO config.config_values (namespace, key, value_type, value_data, updated_by, update_reason, environment, trading_mode)
  VALUES ('spectest','spectest.k','string','v2','tester','update','dev','all')
  ON CONFLICT (namespace,key,environment,trading_mode) DO UPDATE SET value_data=EXCLUDED.value_data, update_reason=EXCLUDED.update_reason;
SELECT count(*) FILTER (WHERE old_value IS NULL) AS insert_audits, count(*) AS total_audits FROM config.config_audit WHERE namespace='spectest' AND key='spectest.k';  -- expect insert_audits=1, total_audits=2
DELETE FROM config.config_values WHERE namespace='spectest';
DELETE FROM config.config_audit WHERE namespace='spectest';
SQL

# Down migration reverts cleanly (golang-migrate down one step), leaving the BEFORE UPDATE trigger intact.
./scripts/db-migrate.sh   # re-check tooling; then step down one and confirm the insert trigger is gone
```
Expect: `insert_audits = 1` after the INSERT, `insert_audits = 1` (unchanged) and `total_audits = 2` after the ON CONFLICT update — proving the AFTER INSERT trigger fires once on create and not on the update path.

---

### Step 4 — service: config `setConfig` existence gate (mode-exact) + `create_key` bypass

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/grpc/configServiceImpl.ts` — modify

**Reviewers**: xstockstrat-config — config key naming (`<service>.<category>.<key>`), environment/trading_mode scoping, WatchConfig stream stability

**Codebase Evidence**:
- `setConfig` structure: admin gate `:293-300`; destructure `const { namespace, key, value, reason } = call.request` `:302`, `env` `:303`, `mode` `:304`; author check `:309-313`; upsert `INSERT … ON CONFLICT (namespace,key,environment,trading_mode) DO UPDATE` `:316-325`; `pg_notify('config_changed', …)` `:326-328`; success callback `:329-330`; catch → `{ code: 13, … }` `:331-333`.
- The upsert's conflict key is `(namespace, key, environment, trading_mode)` (`:319`) — the existence SELECT must match this exact grain, **not** broaden to `OR trading_mode='all'` (design §2; insights.md 2026-08-02 — a mode-broadening gate manufactures a nondeterministic read-shadow because `listKeys :343` and the reload paths read `(mode OR 'all')` with no `ORDER BY` precedence).
- **Wire-encoding trap**: over the real gRPC wire ts-proto sends camelCase field names (`src/__tests__/listKeysWire.test.ts:4-8`, and the impl's own snake_case `trading_mode` read is a logged defect noted in `setConfigAuthz.test.ts:173-178`). The regenerated TS `SetConfigRequest` names the new field `createKey`, so the impl must read `call.request.createKey` (Step 5's loopback case proves the field arrives). Read defensively as `call.request.createKey ?? call.request.create_key` to tolerate both encodings.
- `NOT_FOUND` is gRPC status code **5**; the agent already maps it (`app/tools.py:871-872` `_grpc_error_message(e, not_found="config key not found")`), so no agent error-map change is needed (design §3).

**TDD**: `red-green required`

**Instructions**:
1. In `setConfig`, after the author check (`:309-313`) and **before** the `try { await this.pool.query(INSERT …` at `:315-316`, add the existence gate:
   ```ts
   const createKey = call.request.createKey ?? call.request.create_key ?? false;
   const existing = await this.pool.query(
     `SELECT 1 FROM config.config_values
      WHERE namespace = $1 AND key = $2 AND environment = $3 AND trading_mode = $4 LIMIT 1`,
     [namespace, key, env, mode]
   );
   if (existing.rows.length === 0 && !createKey) {
     callback({
       code: 5, // NOT_FOUND
       message: `config key not registered: ${namespace}.${key} (env=${env}, mode=${mode}); pass create_key=true to register it`,
     });
     return;
   }
   ```
   Use `existing.rows.length === 0` (robust to both the real pg result and the mock pool used in Step 5) rather than `rowCount`.
2. Leave the upsert, `pg_notify`, success callback, and catch block unchanged. On the `create_key=true` path the existing INSERT runs and the Step 3 `AFTER INSERT` trigger audits the creation; on an update path the row already exists so the gate passes.
3. Enforce the gate purely server-side — config-ui also calls `SetConfig` (design §2), so the refusal cannot live only in the agent.
4. No new pool, no new outbound gRPC call: the SELECT reuses `this.pool` (F-06 respected; no header-propagation surface added).

**Verification**: covered by Step 5 (paired). Behavioral check: an admin write to an unregistered `(namespace,key,env,mode)` with `create_key` false returns code 5 and runs no INSERT/notify; the same write with `createKey: true` proceeds.

---

### Step 5 — test: config existence gate + wire contract (covers Step 4)

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/__tests__/setConfigAuthz.test.ts` — modify

**Reviewers**: xstockstrat-config — config key naming, environment/trading_mode scoping, WatchConfig stream stability

**Codebase Evidence**:
- Existing loopback suite `SetConfig authorization over a real gRPC connection` (`setConfigAuthz.test.ts:76-179`) uses a recording pool that returns `{ rows: [] }` for every query (`:83-88`) and a `setConfig(metadata, overrides)` helper (`:116-128`) sending `{ namespace:'platform', key:'platform.log_level', value:{stringVal:'debug'}, author:'tester', reason:'authz test' }`.
- Tests run against **compiled JS** with a c8 40% line gate: `package.json:8` `test:coverage` = `tsc && c8 … --lines 40 node --test dist/__tests__/*.test.js`; the harness case at `:35-40` asserts the import succeeded (074 zero-assertion trap guard — design Open Risks).
- **Breakage from Step 4**: with a `{ rows: [] }`-always pool, the existence SELECT now returns zero rows, so the current `allows an admin caller and performs the write` case (`:147-154`) would flip to NOT_FOUND, and its `queries[0].params?.[4]` assertion (`:153`) — and the fallback case's `queries[0]` (`:162`) — now point at the SELECT, not the INSERT.

**TDD**: `red-green required` — new cases must be red against the pre-Step-4 tree (no existence gate → an unregistered-key write succeeds instead of returning code 5). Prove the red in the **compiled** suite (`dist/`), non-zero assertions (074 trap).

**Instructions**:
1. Make the recording pool branch on SQL so the existence SELECT can be steered per case. Replace the always-empty `query` (`:84-88`) with one that returns a configurable result for the `SELECT 1 … LIMIT 1` existence query (default: a non-empty row so pre-existing "registered key" cases keep passing) and `{ rows: [] }` otherwise. Keep recording every query.
2. Fix the index shift in the two existing passing cases: the INSERT is now the query **after** the existence SELECT, so assert on the recorded INSERT (find it by SQL containing `INSERT INTO config.config_values`) rather than `queries[0]` — preserve the `params[4] === 'tester'` / `'u-42'` `updated_by` assertions (`:153`, `:162`).
3. Add case: **unregistered key, `create_key` omitted → NOT_FOUND, writes nothing.** Steer the pool so the existence SELECT returns `{ rows: [] }`; admin metadata (`x-access-scope: '7'`); assert `err.code === grpc.status.NOT_FOUND` (5), `err.details`/`message` matches `/not registered/`, and that **no** `INSERT`/`pg_notify` query was recorded (only the existence SELECT ran).
4. Add case: **unregistered key, `createKey: true` → write proceeds.** Existence SELECT returns `{ rows: [] }`; pass `overrides = { createKey: true }`; admin metadata; assert `err === null` and an `INSERT INTO config.config_values` query was recorded. This case also proves the impl reads the field under the real ts-proto **camelCase** wire encoding (Step 4 evidence) — it is the loopback proof that `create_key` is wired end to end.
5. Add case: **registered key, `create_key` omitted → write proceeds** (existence SELECT returns a row) — guards against the gate over-blocking a normal update.
6. Test data (C-13): the request literals are scenario one-offs local to this single test file (one consumer) — inline is compliant; no `conftest`/fixtures home applies to this Node service (`src/__tests__/fixtures/` is created only on a second consumer). Record this verdict.

**Verification**:
```bash
cd services/xstockstrat-config && pnpm run lint
cd services/xstockstrat-config && pnpm run test:coverage   # tsc + c8 --lines 40; confirm ≥40% and the new cases execute (non-zero assertions)
```
Confirm the run reports the new NOT_FOUND / create_key cases as executed (not silent-skipped) and the c8 line threshold passes.

---

### Step 6 — service: agent `set_config` forwards `create_key`

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/tools.py` — modify
- `services/xstockstrat-agent/app/client.py` — modify

**Reviewers**: xstockstrat-agent — MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity; no secret values in tool output

**Codebase Evidence**:
- Tool signature `set_config(ctx, namespace, key, value_type, value, author, reason, environment="", trading_mode="")` at `app/tools.py:786-796`; it forwards to `client.set_config(...)` at `:859-870`; the docstring at `:797-818` currently warns "writes are a blind upsert with no existence check", "silently CREATES a new orphan key … (there is no reachable 'key not found' error)", and "Creating a NEW key writes no audit row" — all made false by Steps 3/4.
- The two-prong secret refusal (name-prefix `:822-827`; `is_secret` from `ListKeys` `:851-856`) and the `_grpc_error_message(e, not_found="config key not found")` mapping `:871-872` must stay unchanged (design §3/§4; AC-4).
- Client builder `client.set_config(namespace, key, value_type, value, environment, trading_mode, author, reason, access_scope)` at `app/client.py:916-926`; it constructs `config_pb2.SetConfigRequest(namespace=…, key=…, value=cv, author=…, reason=…, environment=env, trading_mode=mode)` at `:950-958` and forwards the real caller scope via `metadata` `:960`.
- Design §3: the agent adds **no** client-side existence refusal — the server is authoritative, which is what keeps the existing empty-`keys` mocks (`test_config_tools.py:168/189/211`) meaningful.

**TDD**: `red-green required`

**Instructions**:
1. In `tools.py` `set_config`, add a parameter `create_key: bool = False` (place it after `trading_mode` to keep existing positional/keyword callers working). Forward it in the `client.set_config(...)` call (`:860-870`) as `create_key=create_key`. Do **not** add any local existence check — the refusal is server-side.
2. Update the docstring (`:797-818`) to describe `create_key` and remove the now-false claims: the "blind upsert / silently CREATES an orphan / no reachable 'key not found' error" warning and the "Creating a NEW key writes no audit row" sentence. New behavior: an unregistered key is refused with NOT_FOUND unless `create_key=true`; creation is audited. (This docstring is one of the C-10 surfaces; the `.md` surfaces are Step 8.)
3. In `client.py` `set_config` (`:916-962`), add a `create_key: bool` parameter and set `create_key=create_key` in the `SetConfigRequest(...)` constructor (`:950-958`). The regenerated Python message (Step 2) carries the `create_key` field.
4. `ruff format`/`ruff check` clean (no unused import; the lazy `gen.config.v1` import pattern at `client.py:934` stays).

**Verification**: covered by Step 7 (paired). Behavioral check: calling the tool with `create_key=True` results in `client.set_config` receiving `create_key=True`, and the built `SetConfigRequest.create_key is True`.

---

### Step 7 — test: agent `create_key` forwarding + `SetConfigRequest` descriptor parity (covers Step 6)

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_config_tools.py` — modify

**Reviewers**: xstockstrat-agent — MCP tool contract stability and `docs/runbooks/mcp-tools.md` parity; no secret values in tool output

**Codebase Evidence**:
- Existing tool tests use `_make_server()` / `_tool_fn` and patch `client.set_config` / `client.list_config_keys` as `AsyncMock` (`test_config_tools.py:25-39, 95-227`); `TestSetConfigForwardsRealScope` asserts on `write.await_args.kwargs[...]` (`:203, 225-227`) — the same mechanism can assert `kwargs["create_key"]`.
- The descriptor-parity template is `test_backtest_view.py:157-174` (`test_summary_key_set_covers_every_proto_field`): it asserts a hand-maintained key set equals `<Message>.DESCRIPTOR.fields_by_name`, with the proto module imported **in-function** per AGENT-2 (`:166`). Ledger insight 2026-08-02 (mcp-tools-alignment-triage) mandates this guard for every agent dict→proto request builder — `client.set_config` is one.
- The empty-`keys` mocks (`:168, 189, 211`) stay valid because the agent does not gate on existence (design §3) — no update needed there.

**TDD**: `red-green required` — the parity test is red against the pre-Step-6 tree (the builder omits `create_key`, so it is absent from the built request's set fields while present in `DESCRIPTOR.fields_by_name`); the forwarding test is red because the tool has no `create_key` param yet.

**Instructions**:
1. Add a forwarding case (e.g. in `TestSetConfigForwardsRealScope`): call the tool with `ctx=_ctx(ADMIN)`, valid args, and `create_key=True`; assert `write.await_args.kwargs["create_key"] is True`. Add a companion asserting the default: a call without `create_key` forwards `create_key=False`.
2. Add a descriptor-parity test for the request builder, mirroring `test_backtest_view.py:157`. Capture the `SetConfigRequest` that `client.set_config` builds: patch `config_pb2_grpc.ConfigServiceStub` so `SetConfig` records its request argument (or call the builder and inspect it), invoking `client.set_config(...)` with a **distinct non-default value for every field** including `create_key=True`. Then assert:
   ```python
   from gen.config.v1 import config_pb2  # in-function, AGENT-2
   built = {f.name for f, _ in req.ListFields()}
   assert built == set(config_pb2.SetConfigRequest.DESCRIPTOR.fields_by_name)
   ```
   Passing a non-default value for every field makes each appear in `ListFields()`; a future added proto field the builder forgets to set is absent → the test fails closed (the RC-1 guard).
3. Test data (C-13): request/claims literals are scenario one-offs with a single consumer (this file); inline is compliant — `tests/conftest.py` centralization is triggered only by a second consumer. Record this verdict.

**Verification**:
```bash
cd services/xstockstrat-agent && ruff check . && ruff format --check .
cd services/xstockstrat-agent && uv run pytest --cov=app --cov-fail-under=40
```
Confirm the new forwarding and descriptor-parity cases pass post-implementation (and were red pre-implementation) and the 40% coverage gate holds.

---

### Step 8 — docs: reconcile every surface that describes `set_config`

**Status**: `pending`
**Service**: `docs/runbooks/` + service CLAUDE.md + findings
**Files**:
- `docs/runbooks/mcp-tools.md` — modify
- `services/xstockstrat-agent/CLAUDE.md` — modify
- `services/xstockstrat-config/CLAUDE.md` — modify
- `docs/context-constitution-findings.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `mcp-tools.md` `set_config` section: parameter table `:676-685` (no `create_key` row), "Errors" line `:711` lists only PERMISSION_DENIED + INVALID_ARGUMENT (no NOT_FOUND), and the "Three behaviors" block `:703-709` states "Creating a new key writes no audit row … the trigger fires `BEFORE UPDATE`" — all now false.
- Agent `CLAUDE.md` describes `set_config` in the tools table and the § Management-tool authorization block (secret refusal, real-scope forwarding); it should note the new create-gate behavior. Config `CLAUDE.md` § WatchConfig Flow states "audit trigger fires → config.config_audit row written" on the update path — extend to note creation is now audited via the `010` AFTER INSERT trigger.
- `docs/context-constitution-findings.md` records the "audit-on-UPDATE-only" config defect (design §1, C-10) — mark it resolved by feature 091 / migration `010`.
- C-10 same-PR-docs rule (design §Constitution Rules Touched). The `strat-lab` plugin does not cover `set_config` (design §C-10, verify-only) — confirm no edit needed there.

**TDD**: `N/A (docs)`

**Instructions**:
1. `mcp-tools.md` `set_config`: add a `create_key` parameter row (bool, optional, default false — "register a not-yet-existing key; without it a write to an unregistered `(namespace,key,env,mode)` scope is refused"); add a **NOT_FOUND** row to the Errors line ("`NOT_FOUND` → config key not registered — pass `create_key=true` to create it"); rewrite the "Creating a new key writes no audit row" bullet to state creation is now audited (via the `010` AFTER INSERT trigger) and that an unregistered write is refused unless `create_key=true`. Keep the `value_type`-honored-on-create and JSON-as-string bullets.
2. Agent `CLAUDE.md`: update the `set_config` line/authorization block to mention the `create_key` gate (typo-safe by default; explicit opt-in to create). Do not alter the secret-refusal or real-scope-forwarding description.
3. Config `CLAUDE.md`: in § WatchConfig Flow / § Config Governance, note that key **creation** is now audited by the `010` `config_value_audit_insert` (`AFTER INSERT`) trigger, complementing the existing `BEFORE UPDATE` audit; and that `SetConfig` refuses an unregistered `(namespace,key,env,mode)` scope unless `create_key=true`.
4. `docs/context-constitution-findings.md`: mark the "audit-on-UPDATE-only" entry resolved by feature 091 (migration `010`).
5. Governance-narrowing note (design Open Risks): state that post-fix the only key-creation paths are migration seeds + `set_config(create_key=true)` — config-ui can no longer typo-mint keys — so "new keys require a PR" is now enforced, not merely conventional.
6. Run `/context-scrubber scan` scoped to the touched context files (root CLAUDE.md Teardown rule) and fix any grounded findings; if the context-forge plugin is unavailable, say so in the PR body.

**Verification**:
```bash
grep -n "create_key" docs/runbooks/mcp-tools.md services/xstockstrat-agent/CLAUDE.md services/xstockstrat-config/CLAUDE.md   # create_key documented on every surface
grep -n "NOT_FOUND\|not registered" docs/runbooks/mcp-tools.md   # reachable error documented
grep -rn "set_config\|set_strategy_live\|manage_strategy" plugins/strat-lab/ | grep -i "set_config" || echo "strat-lab does not cover set_config — no edit needed"
```
Confirm `create_key` and the NOT_FOUND error appear on every `set_config` doc surface and the "audit-on-UPDATE-only" finding is marked resolved.

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._

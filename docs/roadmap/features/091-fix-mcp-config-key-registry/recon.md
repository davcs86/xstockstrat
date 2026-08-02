# Recon: fix-mcp-config-key-registry

**Created**: 2026-08-02
**From**: product-spec.md
**Affected services**: xstockstrat-config, xstockstrat-agent

---

## Objective

`set_config` is a blind upsert (RC-3: `config.config_values` is both the key registry and the value
store, so key existence ⇔ a value row). A mistyped key silently **creates** a metadata-less orphan
row no service reads; the tool's `NOT_FOUND → "config key not found"` mapping is unreachable; key
creation writes no audit row; "registered but unset" is unrepresentable. Add a cheap agent-side
`create_key` guard (reusing the `ListKeys` result the tool already discards) plus a server-side
existence gate + creation audit so a typo is refused, `NOT_FOUND` becomes reachable, and creation is
auditable.

## Codebase Map

- **`xstockstrat-config`** (Node.js/TypeScript, gRPC 50060)
  - Entry point / pool: `src/index.ts:30-39` (`new Pool({ max: DB_POOL_MAX ?? 2 })`)
  - Servicer: `src/grpc/configServiceImpl.ts`
    - `setConfig` — `:286`; admin gate `:293`, author required `:309-313`; **blind upsert** `INSERT … ON CONFLICT (namespace,key,environment,trading_mode) DO UPDATE` `:316-325`; `pg_notify('config_changed', …)` `:326-328`
    - `getConfig` — `:267`; serves in-memory `snapshots`; missing → **empty snapshot, never NOT_FOUND** `:271-282`
    - `listKeys` — `:336`; `SELECT key, description, default_value, is_secret, consuming_service … FROM config.config_values WHERE namespace=$1 …` `:340-343`
    - `watchConfig` — `:226` (streams cached snapshots; DELTA carries full namespace `:196-197`)
    - value helpers `inferValueType`/`extractValueData`/`buildConfigValue` `:386-398`; `toProtoSnapPayload` isSecret `:52`
  - Authz: `src/grpc/authz.ts` — `hasAdminAccessScope`, `userIdFrom`, `ADMIN_SCOPE_ERROR`, `MISSING_AUTHOR_ERROR` (the SetConfig gate to extend)
  - Last migration: `009_drop_fmp_api_key_config.up.sql` → **next = `010`**
  - Schema: `config.config_values` created `migrations/001_config_tables.up.sql:6-21` (`value_data TEXT NOT NULL`, `is_secret BOOL DEFAULT FALSE`, `UNIQUE(namespace,key)`); env/mode + `UNIQUE(namespace,key,environment,trading_mode)` added `002_config_environment.up.sql:6-25`
  - Audit: `config.config_audit` `001:26-35`; trigger `audit_config_change()` **`BEFORE UPDATE` only**, gated on `value_data` change `001:37-51` / redefined `002:33-43` → **new-key INSERT writes no audit row** (`docs/context-constitution-findings.md:22`)
  - Tests run against **compiled JS**: `package.json:12` (`tsc && node --test dist/__tests__/*.test.js`, c8 `--lines 40`); import asserted (074 trap fixed) `configServiceImpl.test.ts:13-27`; wire-level suite over real gRPC `listKeysWire.test.ts:17-22`

- **`xstockstrat-agent`** (Python MCP server)
  - `set_config` tool — `app/tools.py:786-796`; secret-prefix refusal `:822-827`; verified-claims requirement `:829-836`; **`ListKeys` call whose existence answer is discarded (only `is_secret` used)** `:842-856`; fail-closed on lookup error `:846-850`; real-scope forwarding (feature 073 `roles_to_access_scope`) `:858-869`; NOT_FOUND mapping `:871-872`; `_grpc_error_message` `:61-72`
  - `get_config` tool — `app/tools.py:737-761`; `list_config_keys` tool — `:763-783`
  - Client: `app/client.py` — `set_config` builds `SetConfigRequest` `:916-962` (scope forwarding `:960`); `list_config_keys` `:888-913`; `get_config` `:860-885`
  - Tests: `tests/test_config_tools.py` — RED home; mock pattern `:25-43`; `TestSetConfigGuards` `:97-181`; `TestSetConfigForwardsRealScope` `:184-227`; **empty-`keys` mocks at `:168/:189/:211` will break under a create_key guard**
  - Descriptor-parity guard pattern: `tests/test_backtest_view.py:157-174`

## Patterns to REUSE

- **Agent existence guard** → reuse the already-fetched `listing = client.list_config_keys(...)` at `app/tools.py:842-856`; add the missing `meta.get("key") == key` existence branch alongside the existing `is_secret` branch (no new RPC — the data is already in hand).
- **Additive proto field** → mirror the numbering discipline; `SetConfigRequest` currently ends at field 7 (`config.proto:88-96`), so `create_key` is field **8** (additive, `buf breaking`-safe).
- **Server admin/error gate** → extend the existing `setConfig` guard chain (`authz.ts` `ADMIN_SCOPE_ERROR` / `MISSING_AUTHOR_ERROR` style) with a NOT_FOUND path rather than a new mechanism.
- **New migration `010`** → follow `002_config_environment` shape (idempotent `ALTER`/trigger redefine); the audit-trigger redefinition already has a two-version precedent (`001`→`002`).
- **Descriptor-parity contract test** → replicate `test_backtest_view.py::test_summary_key_set_covers_every_proto_field` against `config_pb2.SetConfigRequest.DESCRIPTOR.fields_by_name` (ledger insight 2026-08-01; guards the request builder against future dropped fields).
- **Compiled-JS test discipline** → config tests already run against `dist/` with an asserted import (074 trap fixed); new cases go in the same suites.

## Dependencies

- Proto/RPC: `packages/proto/config/v1/config.proto` — `SetConfigRequest` (fields 1-7 `:88-96`); candidate additive `create_key = 8` (bool). No breaking change. Requires `./scripts/buf-gen.sh` + `buf lint`/`buf breaking` (C-09).
- Migration: next number **`010`** for `services/xstockstrat-config/migrations/` (audit-on-INSERT fix; optional registry/nullable-value change).
- Config keys: none new.
- Inter-service edges: agent → config `SetConfig`/`ListKeys` (existing gRPC, unchanged topology).
- New env vars / ports: none.

## Risks / Not-found

- **"Registered but unset" representability (AC-3, first half)** is the structural crux: today existence ⇔ a `value_data NOT NULL` row, so representing a registered-but-valueless key needs either a nullable `value_data` (ripples into getConfig/listKeys/WatchConfig NULL handling) or a separate registry table (bigger; touches all read paths). The debate must decide how far to go vs. the product-spec's Out-of-Scope ("no broader config-service redesign beyond the registry needed to fix F-8").
- No existing registry table, `registered`/`create_key` column, or NOT_FOUND path exists server-side (all confirmed absent) — this is net-new surface, not a modification.
- `secret.*` prefix is **not** enforced in config code (only a documented naming convention); `setConfig` never writes `is_secret`, so an MCP-created key is always non-secret. AC-4 (secret refusal unchanged) is satisfied by the agent's two-prong check, which must survive the create_key change.
- **074 trap** (`fails.md` 2026-07-29): a config test suite reported pass while asserting nothing (silent-skip import + stale numeric-enum expectation). New server tests must execute against compiled output and prove a red — verify non-zero assertions, don't trust exit 0.
- **Agent test breakage**: the existing no-claims / forward-scope tests mock `list_config_keys → {"keys": []}` and still expect the write to proceed; a create_key guard makes those RED unless the mocks are updated to include the target key (or pass `create_key=true`). Update in the same step.
- Doc gap: `docs/runbooks/mcp-tools.md` `set_config` section (`:672-711`) has no NOT_FOUND error row despite the tool mapping it — reconcile in-PR (C-10 same-PR docs).

## Recommended Scope

Advisory step boundaries (grilling to confirm the server-side depth):

1. **proto** — additive `SetConfigRequest.create_key = 8` (bool); `buf lint`/`buf breaking`; `buf-gen`.
2. **config migration `010`** — make new-key creation auditable (audit trigger fires on INSERT) and, per the debate's decision, make "registered but unset" representable (nullable `value_data` **or** a `config_registry` table).
3. **config servicer** — `setConfig` existence check: unregistered key + `create_key=false` → `NOT_FOUND`; `getConfig`/`listKeys` on unknown namespace/key → `NOT_FOUND` where appropriate; creation path writes the audit row. Paired compiled-JS tests.
4. **agent** — `set_config` tool gains `create_key: bool = False`; reuse the discarded `ListKeys` result to refuse an unregistered key locally unless `create_key`; client `set_config` sets the new proto field; descriptor-parity test; update the empty-`keys` mocks. Paired pytest.
5. **docs** — `set_config` docstring + `docs/runbooks/mcp-tools.md` (create_key semantics, reachable NOT_FOUND row); agent CLAUDE.md if behavior text changes.

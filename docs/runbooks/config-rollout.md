# Config Rollout Runbook

## Overview

Config changes propagate live to all services via `xstockstrat-config`'s `WatchConfig` gRPC server-streaming RPC. No service restarts are required for config changes: **every config change takes effect without a restart** is a platform guarantee (feature 295), including startup-sized resources (semaphores, executors, vendor clients, provider selection). A key that only applies after a restart is a defect, not a rollout step. This runbook documents the safe procedure for rolling out config changes.

---

## Config Architecture Recap

```
Author (agent / API / CLI)
    │
    ▼ SetConfig RPC
xstockstrat-config (ConfigService)
    │  └── writes to config.config_values (PostgreSQL)
    │  └── writes audit row to config.config_audit
    │  └── pg_notify('config_changed', {namespace, key})
    │
    ▼ WatchConfig stream (all subscribers)
All services (trading, portfolio, marketdata, indicators, ingest, analysis, ledger, identity, notify)
    └── Receive ConfigSnapshot with update_type=DELTA
    └── Update in-memory config values
    └── New config takes effect on next use of that key
```

---

## Config Key Naming Convention

**Rule (C-05, CONFIG-9):** the stored key equals the reader's exact spelling, and every read key is
seeded by a config migration. Readers spell non-secret keys full-dotted today (below); the target
form is namespace-relative, with the cutover in feature 296.

```
<service-short-name>.<category>.<key>

Examples:
  trading.approval.require_above_qty
  indicators.sandbox.timeout_ms
  platform.maintenance_mode
  marketdata.alpaca.paper
```

Secret values use the `secret.` prefix within their category:
```
  identity.secret.jwt_key   (value is a secret reference, e.g. "vault://prod/jwt-secret")
```

---

## Pre-Rollout Checklist

- [ ] Read the root `CLAUDE.md` governance rules
- [ ] Confirm the key exists in `config.config_values` (or you intend to create it)
- [ ] For **new keys**: open a PR to root `CLAUDE.md` to document the key in the service's config table
- [ ] For **breaking changes** (type change, key removal): get approval per `docs/runbooks/approval-flow.md`
- [ ] Identify all consuming services from the root `CLAUDE.md` service registry
- [ ] Stage the change in a non-production namespace first if available
- [ ] Write your rollback values before applying

---

## Step 1 — Preview the Change

Query current value before changing:
```bash
# via grpcurl
grpcurl -plaintext \
  -d '{"namespace": "trading"}' \
  xstockstrat-config:50060 \
  xstockstrat.config.v1.ConfigService/GetConfig
```

---

## Step 2 — Apply a Single Key Change

### Via gRPC (SetConfig)

> **`SetConfig` is admin-gated.** It rejects the call with `PERMISSION_DENIED`
> ("admin scope required") unless the request carries the ADMIN bit on `x-access-scope`
> (`0x04` → `"4"`), per `docs/patterns/header-propagation.md`. It also requires a
> propagated `x-user-id` (or an authorized internal caller), which is what the audit row
> records as `changed_by`; the request `author` field is ignored (feature 241). A call with
> neither is rejected `INVALID_ARGUMENT`.

```python
import grpc
from gen.config.v1 import config_pb2, config_pb2_grpc

channel = grpc.insecure_channel('xstockstrat-config:50060')
stub = config_pb2_grpc.ConfigServiceStub(channel)

resp = stub.SetConfig(
    config_pb2.SetConfigRequest(
        namespace="trading",
        key="trading.approval.require_above_notional",
        value=config_pb2.ConfigValue(float_val=100000.0),
        reason="Increase approval threshold for Q3 — TICKET-1234",
    ),
    metadata=(
        ("x-access-scope", "4"),      # ADMIN bit — required, else PERMISSION_DENIED
        ("x-user-id", "<operator-id>"),  # recorded as changed_by
    ),
)
print(f"Updated. Version: {resp.version}")
```

Reads (`GetConfig`, `ListKeys`, `WatchConfig`) are **not** gated — every service boots by
subscribing to `WatchConfig` unauthenticated, so gating them would break platform startup.

### Via the MCP agent (feature 073)

If you are working from an agent session, the three MCP tools wrap these RPCs — no raw gRPC client
needed:

```text
list_config_keys(namespace="trading")            # discover keys, see which are secret
get_config(namespace="trading")                  # current values (secrets redacted)
set_config(namespace="trading", key="trading.approval.require_above_notional",
           value_type="float", value="100000.0",
           reason="Q3 threshold — TICKET-1234")
```

`set_config` has no `environment` or `trading_mode` parameter: the environment is always the agent
deployment's own `APPLICATION_ENV`. It authorizes on your real role (admin required), attributes the
write to your verified user id (there is no `author` parameter), can write `is_secret` keys (encrypted
at rest, never echoed), and works only over the Streamable HTTP transport.
Full parameter and error tables: `docs/runbooks/mcp-tools.md`.

### Via Connect-RPC — **REMOVED, do not use**

> The Connect-RPC HTTP server on port `8060` was deleted when the backends became
> gRPC-only; this example cannot work. Use the gRPC form above (or `grpcurl` with the
> same metadata). Kept only so the removal is discoverable.

```bash
# STALE — port 8060 no longer exists.
curl -X POST http://xstockstrat-config:8060/xstockstrat.config.v1.ConfigService/SetConfig \
  -H 'Content-Type: application/json' \
  -d '{
    "namespace": "trading",
    "key": "approval.require_above_notional",
    "value": { "float_val": 100000.0 },
    "reason": "Increase approval threshold for Q3 — TICKET-1234"
  }'
```

---

## Step 3 — Rollout Multiple Keys (Atomic-ish)

`RolloutConfig` is **not an RPC** — `packages/proto/config/v1/config.proto` declares only
`WatchConfig`, `GetConfig`, `SetConfig`, `ListKeys` and `GetSecret` — and there is no batch write.
Apply related keys as sequential `SetConfig` calls (same metadata as Step 2); each call is audited
and broadcast separately:

```python
for key, value in [
    ("indicators.sandbox.timeout_ms",      config_pb2.ConfigValue(int_val=10000)),
    ("indicators.sandbox.memory_bytes",    config_pb2.ConfigValue(int_val=268435456)),
    ("indicators.sandbox.allowed_imports", config_pb2.ConfigValue(string_val="numpy,pandas,math,statistics,scipy")),
]:
    stub.SetConfig(
        config_pb2.SetConfigRequest(
            namespace="indicators", key=key, value=value,
            reason="Increase sandbox limits for ML formulas — TICKET-5678",
        ),
        metadata=(("x-access-scope", "4"), ("x-user-id", "<operator-id>")),
    )
```

---

## Step 4 — Verify Propagation

After applying a change, verify subscribers received the update:

```python
# Watch for DELTA update on the target namespace
stream = stub.WatchConfig(config_pb2.WatchConfigRequest(
    namespace="indicators",
    client_id="rollout-verifier",
))
for snap in stream:
    if snap.update_type == config_pb2.CONFIG_UPDATE_TYPE_DELTA:
        print(f"Delta received. Changed keys: {list(snap.changed_keys)}")
        print(f"New value: {snap.values.get('indicators.sandbox.timeout_ms')}")
        break
```

Or check the config audit log in the database:
```sql
SELECT namespace, key, old_value, new_value, changed_by, reason, changed_at
FROM config.config_audit
ORDER BY changed_at DESC
LIMIT 10;
```

---

## Step 5 — Monitor Service Behaviour

After rolling out sandbox limit changes to `indicators`:
- Monitor `indicators.sandbox.timeout` alert frequency in xstockstrat-notify
- Monitor `indicators.sandbox.memory_exceeded` alerts

After rolling out `trading.approval.*` changes:
- Monitor pending approval queue size
- Check ledger events for `order.approval_requested`

---

## Step 6 — Post-Deploy Read-Back (per key, per environment)

After any deploy that seeds, renames or retypes config rows, read every touched key back **in each
environment** (`staging`, then `production`) through the same path its reader uses:

- [ ] `get_config(namespace=<ns>)` on that environment's agent MCP (the tool reads only its own
      deployment's environment) lists the key under the reader's exact spelling with the expected
      value and `value_type` — not a fallback to the code default.
- [ ] `list_config_keys(namespace=<ns>)` shows no second spelling (`k` and `<ns>.k`) of the key.
- [ ] `node scripts/check-config-wiring.mjs --final` is clean on the deployed commit.

Record the per-key, per-environment result in the feature's `context.md`.

## Config Inventory (DO console, read-only)

`services/xstockstrat-indicators/app/maintenance/config_inventory.py` (feature 295 Steps 2/5) prints
what `config.config_values` stores — values as sha256 only, never secrets — in one `READ ONLY`
transaction:

1. Open the **indicators** console of the target app (it has the config DB's `DATABASE_URL`), `cd /app`.
2. Run `python -m app.maintenance.config_inventory > inventory.jsonl` (no flags = the full inventory).
3. Check the trailer: `tool_sha256` must equal `shasum -a 256` of the committed tool file;
   record it and `output_sha256` in the feature's `context.md`.
4. `--report` prints `config.config_heal_report_041` (per-user ids hashed); `--reveal <request.json>`
   prints plaintext only for global, non-secret rows and exits 2 for anything else.

## Recovery: dirty `041_heal_config_keys_to_reader_catalog`

**Precondition:** valid only while 041 is config's highest up-file —
`ls services/xstockstrat-config/migrations/*.up.sql | tail -1` must print `041_…`. Otherwise stop.

Until feature 296 gives config a contract floor, `scripts/db-migrate.sh up` on a dirty config
version runs `force 0` and replays 001, which fails and rolls back, leaving the version at
`1 (dirty)` — so the probe reads tables, not the version.

1. Probe (read-only):
   ```sql
   SELECT to_regclass('config.config_markers') IS NOT NULL AS markers_present;
   SELECT to_regclass('config.config_heal_report_041') IS NOT NULL
          AND EXISTS (SELECT 1 FROM config.config_heal_report_041 WHERE action = 'latch') AS latched;
   ```
   (Run the second `EXISTS` only when the report table is present.)
2. Force the version below 041 with golang-migrate directly — **never** `scripts/db-migrate.sh force`,
   which forces the highest file and would mark an unapplied 041 as applied:
   ```bash
   migrate -path services/xstockstrat-config/migrations \
     -database "$DB_URL&x-migrations-table=config_schema_migrations" force 40   # force 39 if markers_present is false
   ```
   (Use `?x-migrations-table=…` when `DB_URL` has no query string.)
3. Run `scripts/db-migrate.sh up`. A present latch makes 041 a no-op; without it 041 re-runs in full.
4. Repeat Step 6 (read-back) and `config_inventory --report`.

## Rollback Procedure

To rollback a change, apply the previous value with `SetConfig` and add a reference to the original change:

```python
stub.SetConfig(
    config_pb2.SetConfigRequest(
        namespace="trading",
        key="trading.approval.require_above_notional",
        value=config_pb2.ConfigValue(float_val=50000.0),  # original value
        reason="ROLLBACK of TICKET-1234 — reverting to 50000",
    ),
    metadata=(("x-access-scope", "4"), ("x-user-id", "<operator-id>")),
)
```

---

## Emergency: Platform Maintenance Mode

To halt all trading operations immediately:
```python
stub.SetConfig(
    config_pb2.SetConfigRequest(
        namespace="platform",
        key="platform.maintenance_mode",
        value=config_pb2.ConfigValue(bool_val=True),
        reason="EMERGENCY: halting trading — incident INCIDENT-001",
    ),
    metadata=(("x-access-scope", "4"), ("x-user-id", "<operator-id>")),
)
```

All services check `platform.maintenance_mode` and reject new trade orders when `true`. To re-enable, set to `false` following the full rollout checklist.

---

## Config Change Governance Summary

| Change Type | Required Approvers | Process |
|---|---|---|
| New non-breaking key | Service owner | PR to root `CLAUDE.md` |
| Value update (numeric/bool) | Service owner | Direct `SetConfig` + audit |
| New secret key | Config team + service owner | PR + secret store setup |
| Key removal | Config team + all consumers | Deprecation period → PR → removal |
| Breaking type change | 2 service owners + platform lead | Deprecation → versioned key → migration |
| Emergency maintenance_mode | On-call engineer | Direct + incident report |

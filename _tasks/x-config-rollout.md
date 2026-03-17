# _tasks/x-config-rollout.md
# xstockstrat — Config Rollout Runbook

## Overview

Config changes propagate live to all services via `xstockstrat-config`'s `WatchConfig` gRPC server-streaming RPC. No service restarts are required for config changes. This runbook documents the safe procedure for rolling out config changes.

---

## Config Architecture Recap

```
Author (n8n / API / CLI)
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
- [ ] For **breaking changes** (type change, key removal): get approval per `_tasks/x-approval-flow.md`
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
```python
import grpc
from gen.config.v1 import config_pb2, config_pb2_grpc

channel = grpc.insecure_channel('xstockstrat-config:50060')
stub = config_pb2_grpc.ConfigServiceStub(channel)

resp = stub.SetConfig(config_pb2.SetConfigRequest(
    namespace="trading",
    key="approval.require_above_notional",
    value=config_pb2.ConfigValue(float_val=100000.0),
    author="platform-team",
    reason="Increase approval threshold for Q3 — TICKET-1234",
))
print(f"Updated. Version: {resp.version}")
```

### Via n8n Webhook
```json
POST /webhooks/n8n/set-config
{
  "namespace": "trading",
  "key": "approval.require_above_notional",
  "value": { "float_val": 100000.0 },
  "author": "platform-team",
  "reason": "Increase approval threshold for Q3 — TICKET-1234"
}
```

---

## Step 3 — Rollout Multiple Keys (Atomic-ish)

For related changes across multiple keys, use the `/webhooks/n8n/rollout` endpoint which applies all changes sequentially and emits a single broadcast per namespace:

```json
POST /webhooks/n8n/rollout
{
  "changes": [
    { "namespace": "indicators", "key": "sandbox.timeout_ms",    "value": { "int_val": 10000 } },
    { "namespace": "indicators", "key": "sandbox.memory_bytes",  "value": { "int_val": 268435456 } },
    { "namespace": "indicators", "key": "sandbox.allowed_imports", "value": { "string_val": "numpy,pandas,math,statistics,scipy" } }
  ],
  "author": "platform-team",
  "reason": "Increase sandbox limits for ML formulas — TICKET-5678"
}
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
        print(f"New value: {snap.values.get('sandbox.timeout_ms')}")
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

## Rollback Procedure

To rollback a change, apply the previous value with `SetConfig` and add a reference to the original change:

```python
stub.SetConfig(config_pb2.SetConfigRequest(
    namespace="trading",
    key="approval.require_above_notional",
    value=config_pb2.ConfigValue(float_val=50000.0),  # original value
    author="platform-team",
    reason="ROLLBACK of TICKET-1234 — reverting to 50000",
))
```

---

## Emergency: Platform Maintenance Mode

To halt all trading operations immediately:
```python
stub.SetConfig(config_pb2.SetConfigRequest(
    namespace="platform",
    key="maintenance_mode",
    value=config_pb2.ConfigValue(bool_val=True),
    author="oncall-engineer",
    reason="EMERGENCY: halting trading — incident INCIDENT-001",
))
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

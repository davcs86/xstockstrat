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

**Rule (C-05, CONFIG-9):** the stored key is namespace-relative; the FQN is display-only; every read key is seeded by a config migration.

A key is `<category>.<key>` stored under the namespace `<service>`. The FQN `<service>.<category>.<key>` is what
config-ui and the agent show; send the relative key (with the namespace) to `SetConfig`/`set_config`/`create_key` —
a key that begins with its namespace is rejected `INVALID_ARGUMENT`.

```
namespace / key            (FQN, display only)

Examples:
  trading    / approval.require_above_qty        (trading.approval.require_above_qty)
  indicators / sandbox.timeout_ms                (indicators.sandbox.timeout_ms)
  platform   / maintenance_mode                  (platform.maintenance_mode)
  marketdata / alpaca.paper                      (marketdata.alpaca.paper)
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
        key="approval.require_above_notional",   # namespace-relative; FQN trading.approval.require_above_notional
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
set_config(namespace="trading", key="approval.require_above_notional",
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
      deployment's environment) lists the key (namespace-relative; the alias also lists the prefixed spelling until feature 306) with the expected
      value and `value_type` — not a fallback to the code default.
- [ ] `list_config_keys(namespace=<ns>)` shows the key once, relative, with its `fqn`.
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

Since feature 296 config has a contract floor of 40 (the rename migration's `-- contract-of:` header names
`040_config_markers`), so `scripts/db-migrate.sh up` on a config database dirty at a version ≥ 40 exits 3
instead of running `force 0`: **dirty at a version ≥ 40 means `force <n-1>`, never `force 0`.** The probe
below reads tables, not the version.

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

## Contract release (feature 296): failure, recovery and sign-off

Feature 296 renames every stored config key to namespace-relative (migration `044_config_keys_relative`, "R"),
then forbids the prefixed form with a CHECK (`045_config_keys_relative_check`, "R+1"). R runs as the
`db-migrator` before the new config image starts. Numbers are max+1 at merge; the actor string
`system:config-migration-<R>` is inside R.

**Rolling back past feature 295 is forbidden.** A rollback to 295's images is sound: its server serves both
spellings through the alias that R activates (marker `relative_keys_v1`), and its form-tolerant `SetConfig`
writes the existing spelling. An image older than 295 cannot read the renamed rows.

### Per-platform failure and recovery

| Platform | How R runs | On failure | Recovery |
|---|---|---|---|
| DigitalOcean | `db-migrator` `kind: PRE_DEPLOY` (`.do/app*.yaml`) | the deploy aborts and the previous deployment keeps serving; config is now **dirty**, so **every** later `main-dev` deploy exits 3 until repaired | repair the data (table below), `migrate force <n-1>`, redeploy |
| homelab compose | `db-migrator` (`deploy/homelab/compose.yml`, `restart: "no"`); config `depends_on … service_completed_successfully` | the migrator exits non-zero, `--wait` fails for every dependent, dependents are not recreated | repair as DB owner over the tailnet with the `x-db-direct` DSN (`compose.yml`), `migrate force <n-1>`, re-run the `workflow_dispatch` Deploy homelab with the same `image_tag` |
| local compose / CI scratch | `scripts/db-migrate.sh up` | a stray twin raises | same repair, then `db-migrate.sh up` |

The operator's assertion (2026-11-08) is that no homelab container or database exists before this release, so
the homelab path is a fresh deploy; it is recorded as an assertion, not as verified behavior of homelab-edge's
deploy gate. Production holds no data in use (feature 295 decision 24): R reports exactly the signed-tuple
count as `unmatched-signed-tuple` rows.

### Recovery table (every row ends with `migrate force <n-1>` and `db-migrate.sh up`)

The migration file is **never edited**. Repairs follow `docs/runbooks/operator-db-access.md` (DB-owner `psql`,
an explicit transaction) and every hand-deleted row gets a hand-written `config.config_audit` row
(`new_value NULL`). **No direct database writes during a deploy.**

| Raised by | Class | Data repair |
|---|---|---|
| R | `uncovered-twin` | delete the duplicate the code does not read; record it in `scripts/config-heal/signoff.md` |
| R | `stale-signature` | restore the signed value (the old value is in `config_audit`) or delete the drifted twin |
| R | `ambiguous-signature` | delete one member by hand |
| R | `secret-class-twin` | delete the plaintext twin (`old_value NULL`) |
| R | `secret-parked-candidate` | delete the stray per-user secret row after the owner confirms the effective secret, or rename it by hand to the spelling the code reads |
| R | `double-prefix` | rename the row by hand to its single-prefixed spelling, or delete it |
| R | `oracle-mismatch` | park (delete with audit) or keep the named per-user row by hand so the oracle and the rules agree |
| R+1 | `mixed-class-gap-twin` (exactly one member `is_secret`) | delete the plaintext member |
| R+1 | CHECK `ADD` fails 23514 (doubly-prefixed row) | same as `double-prefix` |
| R or R+1 | lock timeout | none; re-run |
| none | the signed direction proves wrong after R ran | no migration: an audited `SetConfig` of the relative key sets the intended value; the loser is preserved in `config.config_values_premigration_296` |

### R sign-off and rehearsal (DO console, after the last rebase and renumber)

> **Only before R reaches `main-dev`.** This flow pastes the signed block into R, which edits the migration file. Once R is
> on `main-dev` that breaks F-01 (a non-overridable Floor rule): use *R refused after merge* below instead.

`python -m app.maintenance.config_allow296` runs in the **indicators** console of the target app
(`cd /app`; `DATABASE_URL` and `DB_PGBOUNCER` are already set). It needs only asyncpg + the stdlib, replays R
inside one transaction that it always rolls back, and prints keys and sha256 only (no value, no user id).
The console filesystem is not durable: paste R in, copy the printed output out before closing it.

1. Run `config_inventory.py` against DO staging (see *Config Inventory*; record `tool_sha256`).
2. Workstation: `shasum -a 256 services/xstockstrat-config/migrations/044_config_keys_relative.up.sql` (the
   shipped R, empty allow block). Console: `cat > /tmp/R.sql <<'EOF'`, paste R, `EOF`, then
   `python -m app.maintenance.config_allow296 draft --migration /tmp/R.sql --expect-sha256 <sha> --expect-db staging --expect-tuples 5`.
   It refuses a file whose sha differs, a database other than `--expect-db`, an already-set
   `relative_keys_v1` marker, any violation other than `uncovered-twin` (those are repaired, never signed), and a
   twin count other than 5. Each twin is signed with the **prefixed** member as the loser (the relative
   spelling wins, operator decision 2026-11-08).
3. Workstation: save the printed block, markers included, as `scripts/config-heal/allow-296-signed.sql`; in R
   replace the one line between the markers with the lines between them in that file (R is not otherwise
   edited), and take `shasum -a 256` of the final R. Record `block_sha256` (it covers only the lines between
   the markers).
4. Console: paste the final R to `/tmp/R.sql` and run
   `python -m app.maintenance.config_allow296 rehearse --migration /tmp/R.sql --expect-sha256 <final sha> --expect-db staging --expect-block-sha256 <block_sha256>`.
   Exit 0 with a `rolled back:` line is the pass; exit 3 means R raised (repair the **data**, never the file).
   The `connection` line names the role and port: the PRE_DEPLOY `db-migrator` uses the direct `:25060` URL,
   so a rehearsal on the pooled `:25061` URL is a close but not identical rehearsal; record which one ran.
5. Regenerate the stored set: `DATABASE_URL=<scratch postgres> bash scripts/config-wiring-stored.sh`.
6. Record "Feature 296 — R sign-off" in `scripts/config-heal/signoff.md`: inventory sha, `config_allow296` `tool_sha256`, block sha,
   `shasum -a 256` of R, the rehearsal output and timestamp, DO production and both homelab databases
   recorded as fresh by operator confirmation, operator name and date.
7. Run `node --test scripts/config-wiring.test.mjs` and `node scripts/check-config-wiring.mjs --final`; both green.

An old or rolled-back UI image skips the `platform.trading_state` reason guard (UX only: the server's enum
check and the audit row still hold).

### R refused after merge (`uncovered-twin`): repair the data, never the file

If R ran with an empty or incomplete `allow_296` block and refused (feature 296 did exactly this on 2026-11-08), config is
**dirty at R** and every later `db-migrator` run stops at the dirty guard, including DO's automated rollback to the
pre-merge image. R itself is one transaction, so nothing else changed. Do not edit R.

1. Probe (read-only): `SELECT version, dirty FROM config_schema_migrations;` (R, `t`), the `relative_keys_v1` marker count
   (0), the prefixed-row count (unchanged), `to_regclass('config.config_keys_report_296')` (NULL).
2. Rehearse in a rolled-back transaction: `BEGIN;` the repair below, `\i` R, `\i` R+1, the report counts, `ROLLBACK;`
   (each `\i` and the `ROLLBACK` on its own line, or run the whole file with `\set ON_ERROR_STOP on`). It must finish with
   no error.
3. Run the repair for real in **one guarded transaction**, together with clearing the dirty flag, then redeploy. Do
   both before the redeploy starts; between the commit and the migrator the readers of the deleted spelling see defaults.

```sql
BEGIN;
DO $$ BEGIN
  IF (SELECT count(*) FROM config_schema_migrations WHERE version = <R> AND dirty) <> 1 THEN
    RAISE EXCEPTION 'config is not dirty at R: refusing';
  END IF;
  IF EXISTS (SELECT 1 FROM config.config_markers WHERE name = 'relative_keys_v1') THEN
    RAISE EXCEPTION 'marker already set: refusing';
  END IF;
END $$;

CREATE TEMP TABLE loser_296 ON COMMIT DROP AS          -- the member that loses: here the prefixed spelling
SELECT p.id FROM config.config_values p
JOIN config.config_values r
  ON r.namespace = p.namespace AND r.environment = p.environment
 AND r.user_id IS NULL AND r.key = substr(p.key, length(p.namespace) + 2)
WHERE p.user_id IS NULL AND p.environment = '<env>'
  AND left(p.key, length(p.namespace) + 1) = p.namespace || '.'
  AND left(substr(p.key, length(p.namespace) + 2), length(p.namespace) + 1) <> p.namespace || '.'
  AND NOT p.is_secret AND NOT r.is_secret;

DO $$ BEGIN
  IF (SELECT count(*) FROM loser_296) <> <N> THEN RAISE EXCEPTION 'unexpected loser count: refusing'; END IF;
END $$;

WITH d AS (DELETE FROM config.config_values v USING loser_296 l WHERE v.id = l.id
  RETURNING v.namespace, v.key, v.environment, v.user_id, v.value_data)
INSERT INTO config.config_audit
  (namespace, key, old_value, new_value, changed_by, reason, changed_at, environment, user_id, caller_identity)
SELECT namespace, key, value_data, NULL, 'operator:<name>',
       'feature 296: uncovered twin repaired by hand, relative spelling wins',
       clock_timestamp(), environment, user_id, NULL FROM d;

UPDATE config_schema_migrations SET version = <R-1>, dirty = false WHERE version = <R> AND dirty;   -- = migrate force <R-1>
DO $$ BEGIN
  IF (SELECT count(*) FROM config_schema_migrations WHERE version = <R-1> AND NOT dirty) <> 1 THEN
    RAISE EXCEPTION 'dirty flag not cleared: refusing';
  END IF;
END $$;
COMMIT;
```

`<R>` is the rename migration's number (44 for feature 296), `<N>` the number of twins R reported, `<env>` their
environment. Direction is the operator's call per twin; deleting the other member means selecting `r.id` instead of
`p.id`. Record the rehearsal, the audit rows and the redeploy log in `scripts/config-heal/signoff.md`.

## Rollback Procedure

To rollback a change, apply the previous value with `SetConfig` and add a reference to the original change:

```python
stub.SetConfig(
    config_pb2.SetConfigRequest(
        namespace="trading",
        key="approval.require_above_notional",
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
        key="maintenance_mode",
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

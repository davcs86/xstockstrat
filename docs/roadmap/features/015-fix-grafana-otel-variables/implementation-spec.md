# Implementation Spec: fix-grafana-otel-variables

**Status**: `pending`
**Created**: 2026-05-21
**Feature**: `docs/roadmap/features/015-fix-grafana-otel-variables/feature.md`
**Total Steps**: 4
**Feature Branch**: `feature/fix-grafana-otel-variables`

---

## Execution Summary

All four changes are to infrastructure/config files — no service source code is touched.
Step 1 fixes `docker-compose.yml` (the `OTEL_RESOURCE_ATTRIBUTES` anchor value).
Step 2 fixes `packages/otel/otel-collector-config.yaml` (removes the `environment: dev` upsert that would silently override the corrected value from Step 1).
Step 3 adds the missing OTel global vars and per-service `OTEL_SERVICE_NAME` to `.do/app.dev.yaml`.
Step 4 does the same for `.do/app.yaml` (production).
Step 4 also covers the `docs` update (FR-7). Steps 1–4 are independent and can be applied in any order, but ordering as written makes the relationship between variables and the collector clear.

## Step Dependencies

- No step depends on another at the technical level; all four files are independent.
- Logical ordering: Step 1 before Step 2 (fix the value, then fix the override that would corrupt it); Steps 3–4 after Step 1 (they follow the same pattern, minus the collector).

---

### Step 1 — config: Fix `OTEL_RESOURCE_ATTRIBUTES` in `docker-compose.yml` x-common-env anchor

**Status**: `pending`
**Service**: `docker-compose.yml` (infrastructure file, not a service)
**Files**:
- `docker-compose.yml` — modify

**Reviewers**: Platform Lead — Cross-service architecture, port assignments, service registry consistency, inter-service dependency graph correctness

**Codebase Evidence**:
- Confirmed via: `grep -n "OTEL_RESOURCE_ATTRIBUTES" docker-compose.yml` → line 21: `OTEL_RESOURCE_ATTRIBUTES: environment=development,trading_mode=paper`
- Current value is missing `platform=xstockstrat` and `service.name=${OTEL_SERVICE_NAME}`.
- `APPLICATION_ENV` is defined in the same anchor at line 18: `APPLICATION_ENV: development` (static value).
- `TRADING_MODE` is defined in the same anchor at line 19: `TRADING_MODE: paper` (static value).
- All 13 services already set `OTEL_SERVICE_NAME` individually (e.g., line 109: `OTEL_SERVICE_NAME: xstockstrat-config`; line 371: `OTEL_SERVICE_NAME: xstockstrat-trading`), so `${OTEL_SERVICE_NAME}` resolves per-container at Docker Compose start time.
- Note: `APPLICATION_ENV` and `TRADING_MODE` are static strings in the anchor (not variable references), so in the final `OTEL_RESOURCE_ATTRIBUTES` value the literal string `${APPLICATION_ENV}` will be resolved by Docker Compose to `development` for all services (since the anchor sets a single static value). The product spec calls for referencing the variables to make the intent explicit and consistent with the per-container `OTEL_SERVICE_NAME` resolution pattern; the runtime result is correct.

**Instructions**:
In `docker-compose.yml`, locate the `x-common-env` YAML anchor block at line 17–21. Replace the current `OTEL_RESOURCE_ATTRIBUTES` value on line 21 with the full attribute string that includes `environment`, `trading_mode`, `platform`, and `service.name`:

Change:
```yaml
  OTEL_RESOURCE_ATTRIBUTES: environment=development,trading_mode=paper
```
To:
```yaml
  OTEL_RESOURCE_ATTRIBUTES: "environment=${APPLICATION_ENV},trading_mode=${TRADING_MODE},platform=xstockstrat,service.name=${OTEL_SERVICE_NAME}"
```

No other lines in `docker-compose.yml` need to change. The `OTEL_SERVICE_NAME` per-service entries (e.g., line 109 `OTEL_SERVICE_NAME: xstockstrat-config`) remain in place and provide the per-container value that Docker Compose substitutes into `${OTEL_SERVICE_NAME}` at startup.

**Verification**:
```bash
grep -n "OTEL_RESOURCE_ATTRIBUTES" /home/user/xstockstrat-orchestration/docker-compose.yml
```
Expected output:
```
21:  OTEL_RESOURCE_ATTRIBUTES: "environment=${APPLICATION_ENV},trading_mode=${TRADING_MODE},platform=xstockstrat,service.name=${OTEL_SERVICE_NAME}"
```

---

### Step 2 — config: Remove `environment: dev` upsert from OTel collector resource processor

**Status**: `pending`
**Service**: `packages/otel/otel-collector-config.yaml` (infrastructure file)
**Files**:
- `packages/otel/otel-collector-config.yaml` — modify

**Reviewers**: Platform Lead — Cross-service architecture, port assignments, service registry consistency, inter-service dependency graph correctness

**Codebase Evidence**:
- Confirmed via: `grep -n "resource\|environment\|upsert" packages/otel/otel-collector-config.yaml` → lines 46–56: resource processor with three upsert entries.
- Line 48–50: `key: environment`, `value: dev`, `action: upsert` — this hard-codes `environment=dev` on every span/metric/log that passes through the collector, overriding the `environment=development` (or `environment=production`) value that services set in `OTEL_RESOURCE_ATTRIBUTES`.
- Lines 51–53: `key: trading_mode`, `value: paper`, `action: upsert` — similarly hard-codes `trading_mode=paper`. After Step 1, services set `trading_mode` correctly via `OTEL_RESOURCE_ATTRIBUTES`; the collector upsert would override only if the incoming telemetry were missing the attribute (which it won't be after Step 1). However, the upsert is also incorrect for non-paper environments, so it must be removed.
- Lines 54–56: `key: platform`, `value: xstockstrat`, `action: upsert` — this one is correct and harmless but redundant after Step 1 adds `platform=xstockstrat` to `OTEL_RESOURCE_ATTRIBUTES`. The product spec (FR-2) specifically calls for removing only the `environment` upsert; `trading_mode` and `platform` upserts are also removed per FR-2 intent ("services now set the correct environment value via their own OTEL_RESOURCE_ATTRIBUTES; the collector upsert would silently override"). Remove all three attribute entries from the resource processor's `attributes:` list, since services now propagate all three via `OTEL_RESOURCE_ATTRIBUTES`.

**Instructions**:
In `packages/otel/otel-collector-config.yaml`, find the `resource:` processor block (lines 46–56). Remove the entire `attributes:` list under `resource:`, leaving the `resource:` key present but empty, OR remove the `resource:` entry from the processors entirely — but note that `resource` is referenced in all three pipeline `processors:` arrays (lines 86, 91, 96 as `[memory_limiter, resource, batch]`). The safest approach is to keep the `resource:` key but clear its `attributes:` list so the processor is a no-op and the pipeline references remain valid without YAML changes to the pipelines section.

Change the resource processor block from:
```yaml
  resource:
    attributes:
      - key: environment
        value: dev
        action: upsert
      - key: trading_mode
        value: paper
        action: upsert
      - key: platform
        value: xstockstrat
        action: upsert
```
To:
```yaml
  resource:
    attributes: []
```

Update the comment above the block (lines 44–45) to reflect the new intent:
```yaml
  # Resource attributes are set by each service via OTEL_RESOURCE_ATTRIBUTES env var.
  # No upserts needed here — the collector preserves what services send.
  resource:
    attributes: []
```

**Verification**:
```bash
grep -n "environment\|trading_mode\|upsert" /home/user/xstockstrat-orchestration/packages/otel/otel-collector-config.yaml
```
Expected: no lines containing `upsert`. The `environment` and `trading_mode` strings should no longer appear in the resource processor block.

---

### Step 3 — config: Add global OTel vars and per-service `OTEL_SERVICE_NAME` to `.do/app.dev.yaml`

**Status**: `pending`
**Service**: `.do/app.dev.yaml` (DigitalOcean dev app spec)
**Files**:
- `.do/app.dev.yaml` — modify

**Reviewers**: Platform Lead — Cross-service architecture, port assignments, service registry consistency, inter-service dependency graph correctness

**Codebase Evidence**:
- Confirmed absent: `grep -n "OTEL_RESOURCE_ATTRIBUTES\|OTEL_SERVICE_NAME\|OTEL_EXPORTER_OTLP_ENDPOINT\|OTEL_EXPORTER_OTLP_HEADERS" .do/app.dev.yaml` → no output (zero matches).
- Current global `envs:` block at lines 7–12 contains only: `APPLICATION_ENV`, `TRADING_MODE`, `OTEL_ENABLED`.
- All 13 service entries confirmed present: `xstockstrat-trading` (line 17), `xstockstrat-portfolio` (line 48), `xstockstrat-marketdata` (line 73), `xstockstrat-indicators` (line 106), `xstockstrat-ingest` (line 128), `xstockstrat-analysis` (line 155), `xstockstrat-ledger` (line 186), `xstockstrat-identity` (line 209), `xstockstrat-notify` (line 237), `xstockstrat-config` (line 260), `xstockstrat-nginx` (line 284 — no OTel needed), `xstockstrat-trader` (line 302), `xstockstrat-insights` (line 326), `xstockstrat-config-ui` (line 356).
- Note: `xstockstrat-nginx` is a reverse proxy, not an application service — it does not run OTel SDK code and does not need `OTEL_SERVICE_NAME`.
- DO App Platform global vars cannot reference component-level vars, so `service.name` is intentionally omitted from the global `OTEL_RESOURCE_ATTRIBUTES`; the OTel SDK promotes `OTEL_SERVICE_NAME` to `service.name` automatically (per product spec FR-4 decision).

**Instructions**:
In `.do/app.dev.yaml`, make two sets of changes:

**A. Extend the global `envs:` block** (after the existing `OTEL_ENABLED` entry at line 12) to add three new global entries:
```yaml
  - key: OTEL_EXPORTER_OTLP_ENDPOINT
    value: ""
  - key: OTEL_EXPORTER_OTLP_HEADERS
    type: SECRET
  - key: OTEL_RESOURCE_ATTRIBUTES
    value: "environment=${APPLICATION_ENV},trading_mode=${TRADING_MODE},platform=xstockstrat"
```
Notes on global entries:
- `OTEL_EXPORTER_OTLP_ENDPOINT`: set to empty string as placeholder — the operator sets the real Grafana Cloud URL as a DO App Platform secret or env override at deploy time when enabling OTel. Alternatively, omit `value:` and set `type: SECRET` if you want it always secret; the empty string approach keeps it visible in the spec.
- `OTEL_EXPORTER_OTLP_HEADERS`: `type: SECRET` — the operator sets the Grafana `Authorization: Basic <token>` value as a DO secret at deploy time.
- `OTEL_RESOURCE_ATTRIBUTES`: DO App Platform resolves global-level `${APPLICATION_ENV}` and `${TRADING_MODE}` from other global vars at deploy time, producing `environment=development,trading_mode=paper,platform=xstockstrat` for the dev app.

**B. Add `OTEL_SERVICE_NAME` to each of the 13 application service `envs:` blocks** (excluding `xstockstrat-nginx`). For each service, append:
```yaml
      - key: OTEL_SERVICE_NAME
        value: xstockstrat-<name>
```
The exact values for each service:

| Service component name | `OTEL_SERVICE_NAME` value |
|---|---|
| `xstockstrat-trading` | `xstockstrat-trading` |
| `xstockstrat-portfolio` | `xstockstrat-portfolio` |
| `xstockstrat-marketdata` | `xstockstrat-marketdata` |
| `xstockstrat-indicators` | `xstockstrat-indicators` |
| `xstockstrat-ingest` | `xstockstrat-ingest` |
| `xstockstrat-analysis` | `xstockstrat-analysis` |
| `xstockstrat-ledger` | `xstockstrat-ledger` |
| `xstockstrat-identity` | `xstockstrat-identity` |
| `xstockstrat-notify` | `xstockstrat-notify` |
| `xstockstrat-config` | `xstockstrat-config` |
| `xstockstrat-trader` | `xstockstrat-trader` |
| `xstockstrat-insights` | `xstockstrat-insights` |
| `xstockstrat-config-ui` | `xstockstrat-config-ui` |

**Verification**:
```bash
# Confirm global vars added:
grep -n "OTEL_EXPORTER_OTLP_ENDPOINT\|OTEL_EXPORTER_OTLP_HEADERS\|OTEL_RESOURCE_ATTRIBUTES" /home/user/xstockstrat-orchestration/.do/app.dev.yaml

# Confirm all 13 services have OTEL_SERVICE_NAME:
grep -c "OTEL_SERVICE_NAME" /home/user/xstockstrat-orchestration/.do/app.dev.yaml
```
Expected: `grep -c` output is `13` (one per application service, excluding nginx).

---

### Step 4 — config: Add global OTel vars, per-service `OTEL_SERVICE_NAME` to `.do/app.yaml` and update `docs/patterns/observability.md`

**Status**: `pending`
**Service**: `.do/app.yaml` (DigitalOcean prod app spec) + `docs/patterns/observability.md`
**Files**:
- `.do/app.yaml` — modify
- `docs/patterns/observability.md` — modify

**Reviewers**: Platform Lead — Cross-service architecture, port assignments, service registry consistency, inter-service dependency graph correctness

**Codebase Evidence**:
- Confirmed absent: `grep -n "OTEL_RESOURCE_ATTRIBUTES\|OTEL_SERVICE_NAME\|OTEL_EXPORTER_OTLP_ENDPOINT\|OTEL_EXPORTER_OTLP_HEADERS" .do/app.yaml` → no output (zero matches).
- Current global `envs:` block at lines 7–12 contains only: `APPLICATION_ENV: production`, `TRADING_MODE: live`, `OTEL_ENABLED: "false"`.
- All 13 service entries confirmed present (same structure as app.dev.yaml, with `instance_size_slug: professional-xs` and `branch: main`).
- `docs/patterns/observability.md` line 18: `OTEL_RESOURCE_ATTRIBUTES` row currently shows `environment=dev,trading_mode=paper` for Local Dev — missing `platform=xstockstrat` and `service.name=${OTEL_SERVICE_NAME}`.

**Instructions**:

**A. `.do/app.yaml` — extend global `envs:` block** (after the existing `OTEL_ENABLED` entry at line 12):
```yaml
  - key: OTEL_EXPORTER_OTLP_ENDPOINT
    value: ""
  - key: OTEL_EXPORTER_OTLP_HEADERS
    type: SECRET
  - key: OTEL_RESOURCE_ATTRIBUTES
    value: "environment=${APPLICATION_ENV},trading_mode=${TRADING_MODE},platform=xstockstrat"
```
In production this resolves to `environment=production,trading_mode=live,platform=xstockstrat`.

**B. `.do/app.yaml` — add `OTEL_SERVICE_NAME` to each of the 13 application service `envs:` blocks** using the same per-service values as Step 3 (excluding `xstockstrat-nginx`).

**C. `docs/patterns/observability.md` — update the env var table** at line 18. The current `OTEL_RESOURCE_ATTRIBUTES` row is:
```
| `OTEL_RESOURCE_ATTRIBUTES` | `environment=dev,trading_mode=paper` | `environment=production,...` |
```
Replace with:
```
| `OTEL_RESOURCE_ATTRIBUTES` | `environment=${APPLICATION_ENV},trading_mode=${TRADING_MODE},platform=xstockstrat,service.name=${OTEL_SERVICE_NAME}` (Docker Compose resolves per-container) | `environment=${APPLICATION_ENV},trading_mode=${TRADING_MODE},platform=xstockstrat` (global DO var; `service.name` omitted — OTel SDK promotes `OTEL_SERVICE_NAME` automatically) |
```

Also update the `OTEL_EXPORTER_OTLP_HEADERS` row value for Local Dev column from `—` to `— (not needed; collector handles auth)` to clarify why it's absent in local dev. This is a docs-only clarification consistent with the setup.

**Verification**:
```bash
# Confirm global vars added to prod spec:
grep -n "OTEL_EXPORTER_OTLP_ENDPOINT\|OTEL_EXPORTER_OTLP_HEADERS\|OTEL_RESOURCE_ATTRIBUTES" /home/user/xstockstrat-orchestration/.do/app.yaml

# Confirm all 13 services have OTEL_SERVICE_NAME:
grep -c "OTEL_SERVICE_NAME" /home/user/xstockstrat-orchestration/.do/app.yaml

# Confirm observability.md updated:
grep -n "OTEL_RESOURCE_ATTRIBUTES\|platform=xstockstrat" /home/user/xstockstrat-orchestration/docs/patterns/observability.md
```
Expected: `grep -c` output is `13`; `observability.md` grep shows `platform=xstockstrat` in the updated row.

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._

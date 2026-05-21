# Implementation Spec: fix-grafana-otel-variables

**Status**: `in-progress`
**Created**: 2026-05-21
**Feature**: `docs/roadmap/features/015-fix-grafana-otel-variables/feature.md`
**Total Steps**: 9
**Feature Branch**: `feature/fix-grafana-otel-variables`

---

## Execution Summary

This feature eliminates the fragile `OTEL_RESOURCE_ATTRIBUTES` env var by having each service's telemetry init module derive `environment`, `trading_mode`, and `platform` attributes at runtime from env vars that already exist in every deployment target (`APPLICATION_ENV`, `TRADING_MODE`, and the hardcoded constant `xstockstrat`).

Implementation proceeds in four groups:
1. **Steps 1–3** update the three Go services' `internal/telemetry/otel.go` files (identical pattern; each service is a separate step for clean per-service PRs in the execution loop).
2. **Steps 4–6** update the three Python services' `app/telemetry.py` files (identical pattern).
3. **Steps 7–8** update the four Node.js backend services' `src/telemetry.ts` files and create `src/telemetry.ts` plus `instrumentation.ts` for the three Next.js frontends (same pattern, two batches).
4. **Step 9** cleans up all infrastructure and documentation files: `docker-compose.yml`, `packages/otel/otel-collector-config.yaml`, `.do/app.dev.yaml`, `.do/app.yaml`, `docs/patterns/observability.md`, `docs/setup/grafana-cloud.md`, and `.env.example`.

No migrations, proto changes, or config key additions are needed.

## Step Dependencies

- Step 9 (infra cleanup) is independent of Steps 1–8 at the code level, but should be executed last so the removal of `OTEL_RESOURCE_ATTRIBUTES` from `docker-compose.yml` x-common-env anchor is confirmed correct only after all services no longer rely on it.
- Steps 1–8 are independent of each other and can be executed in any order within their group.

---

### Step 1 — service: Add `trading_mode` and `platform` attributes to Go telemetry — `xstockstrat-trading`

**Status**: `done`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/telemetry/otel.go` — modify

**Reviewers**: Service owner — Order execution correctness, broker API safety, fill detection, paper-only dev invariant, position limit enforcement

**Codebase Evidence**:
- Confirmed via: `find services/xstockstrat-trading/internal/telemetry -type f` → `services/xstockstrat-trading/internal/telemetry/otel.go`
- Existing `resource.WithAttributes` call at lines 42–45:
  ```go
  resource.WithAttributes(
      semconv.ServiceName(svcName),
      semconv.DeploymentEnvironment(os.Getenv("APPLICATION_ENV")),
  )
  ```
- `trading_mode` and `platform` attributes are **not present** — confirmed by reading lines 1–58 of `otel.go`.
- `semconv` imported at line 12 as `go.opentelemetry.io/otel/semconv/v1.25.0`. Custom string attributes require `"go.opentelemetry.io/otel/attribute"` which ships inside `go.opentelemetry.io/otel v1.43.0` (confirmed in `services/xstockstrat-trading/go.mod` line 11 — no separate `go get` needed).
- `APPLICATION_ENV` and `TRADING_MODE` are both present in the service environment (confirmed in `services/xstockstrat-trading/CLAUDE.md` Environment Variables section).

**Instructions**:
In `services/xstockstrat-trading/internal/telemetry/otel.go`:

1. Add `"go.opentelemetry.io/otel/attribute"` to the import block (after the existing `semconv` import line 12).

2. In the `resource.WithAttributes(...)` call (lines 42–45), add two new attribute entries after `semconv.DeploymentEnvironment(...)`:
   ```go
   attribute.String("trading_mode", os.Getenv("TRADING_MODE")),
   attribute.String("platform", "xstockstrat"),
   ```

The resulting `resource.WithAttributes` block must be:
```go
resource.WithAttributes(
    semconv.ServiceName(svcName),
    semconv.DeploymentEnvironment(os.Getenv("APPLICATION_ENV")),
    attribute.String("trading_mode", os.Getenv("TRADING_MODE")),
    attribute.String("platform", "xstockstrat"),
),
```

No other changes. The existing `OTEL_ENABLED` guard at line 18 ensures these attributes are only set when telemetry is active.

**No test step**: This change adds two `attribute.String` calls to the OTel init function, which only runs when `OTEL_ENABLED=true` — always `false` in CI. No business logic is introduced; `go build ./...` in **Verification** is the correct compilation gate. A dedicated test step would have no meaningful behavior to assert.

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off go build ./... 2>&1
grep -n "trading_mode\|platform\|attribute.String" internal/telemetry/otel.go
```
Expected: `go build` exits 0; grep shows both `attribute.String("trading_mode", ...)` and `attribute.String("platform", "xstockstrat")` lines.

---

### Step 2 — service: Add `trading_mode` and `platform` attributes to Go telemetry — `xstockstrat-portfolio`

**Status**: `done`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/telemetry/otel.go` — modify

**Reviewers**: Service owner — P&L calculation accuracy, position snapshot consistency, concurrent write safety

**Codebase Evidence**:
- Confirmed via: `find services/xstockstrat-portfolio/internal/telemetry -type f` → `services/xstockstrat-portfolio/internal/telemetry/otel.go`
- File is structurally identical to `xstockstrat-trading/internal/telemetry/otel.go` — same import block, same `resource.WithAttributes` call at lines 42–45 with only `semconv.ServiceName` and `semconv.DeploymentEnvironment`.
- Default service name at line 39: `"xstockstrat-portfolio"`.
- `go.opentelemetry.io/otel v1.43.0` is the module version in use.
- `TRADING_MODE` confirmed present in `services/xstockstrat-portfolio/CLAUDE.md` Environment Variables section.

**Instructions**:
Apply the same two-part change as Step 1 to `services/xstockstrat-portfolio/internal/telemetry/otel.go`:

1. Add `"go.opentelemetry.io/otel/attribute"` to the import block.
2. Extend `resource.WithAttributes(...)` to include:
   ```go
   attribute.String("trading_mode", os.Getenv("TRADING_MODE")),
   attribute.String("platform", "xstockstrat"),
   ```

**No test step**: Same rationale as Step 1 — two `attribute.String` calls in the OTel init guard; no business logic; `go build` is the appropriate gate.

**Verification**:
```bash
cd services/xstockstrat-portfolio && GOWORK=off go build ./... 2>&1
grep -n "trading_mode\|platform\|attribute.String" internal/telemetry/otel.go
```
Expected: build succeeds; both new attribute lines present.

---

### Step 3 — service: Add `trading_mode` and `platform` attributes to Go telemetry — `xstockstrat-marketdata`

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/telemetry/otel.go` — modify

**Reviewers**: Service owner — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence**:
- Confirmed via: `find services/xstockstrat-marketdata/internal/telemetry -type f` → `services/xstockstrat-marketdata/internal/telemetry/otel.go`
- Structurally identical to trading and portfolio `otel.go` — `resource.WithAttributes` at lines 42–45 with only `semconv.ServiceName` and `semconv.DeploymentEnvironment`.
- Default service name at line 39: `"xstockstrat-marketdata"`.
- `TRADING_MODE` confirmed present in `services/xstockstrat-marketdata/CLAUDE.md` Environment Variables section.

**Instructions**:
Apply the same change as Steps 1–2 to `services/xstockstrat-marketdata/internal/telemetry/otel.go`:

1. Add `"go.opentelemetry.io/otel/attribute"` to the import block.
2. Extend `resource.WithAttributes(...)` to include:
   ```go
   attribute.String("trading_mode", os.Getenv("TRADING_MODE")),
   attribute.String("platform", "xstockstrat"),
   ```

**No test step**: Same rationale as Step 1 — two `attribute.String` calls in the OTel init guard; no business logic; `go build` is the appropriate gate.

**Verification**:
```bash
cd services/xstockstrat-marketdata && GOWORK=off go build ./... 2>&1
grep -n "trading_mode\|platform\|attribute.String" internal/telemetry/otel.go
```
Expected: build succeeds; both new attribute lines present.

---

### Step 4 — service: Add `trading_mode` and `platform` attributes to Python telemetry — `xstockstrat-indicators`

**Status**: `pending`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/app/telemetry.py` — modify

**Reviewers**: Service owner — Formula sandboxing, numeric precision, timeout enforcement, no side-effects from formula execution

**Codebase Evidence**:
- Confirmed via: `find services/xstockstrat-indicators -name "telemetry.py"` → `services/xstockstrat-indicators/app/telemetry.py`
- Current `Resource.create(...)` call at lines 30–35:
  ```python
  resource = Resource.create(
      {
          "service.name": svc_name,
          "deployment.environment": environment,
      }
  )
  ```
- `trading_mode` and `platform` attributes are **not present** — confirmed by reading lines 1–47.
- `environment` variable already read from `APPLICATION_ENV` at line 29: `environment = os.getenv("APPLICATION_ENV", "development")`.
- `TRADING_MODE` confirmed present in `services/xstockstrat-indicators/CLAUDE.md` Environment Variables section.

**Instructions**:
In `services/xstockstrat-indicators/app/telemetry.py`:

1. After the existing `environment = os.getenv(...)` line (line 29), add:
   ```python
   trading_mode = os.getenv("TRADING_MODE", "paper")
   ```

2. Extend the `Resource.create({...})` dict to include two new keys:
   ```python
   "trading_mode": trading_mode,
   "platform": "xstockstrat",
   ```

The resulting `Resource.create` call must be:
```python
resource = Resource.create(
    {
        "service.name": svc_name,
        "deployment.environment": environment,
        "trading_mode": trading_mode,
        "platform": "xstockstrat",
    }
)
```

No other changes. The existing `OTEL_ENABLED` guard at line 15 is preserved.

**No test step**: This change adds one `os.getenv` call and two dict keys to the OTel init function, which only runs when `OTEL_ENABLED=true` — always `false` in CI. No business logic is introduced; the `python3 -c "from app.telemetry import init_telemetry"` import check in **Verification** is the correct gate. A dedicated test step would have no meaningful behavior to assert.

**Verification**:
```bash
cd services/xstockstrat-indicators && python3 -c "from app.telemetry import init_telemetry; print('import ok')"
grep -n "trading_mode\|platform" app/telemetry.py
```
Expected: import succeeds; both new keys present.

---

### Step 5 — service: Add `trading_mode` and `platform` attributes to Python telemetry — `xstockstrat-ingest`

**Status**: `pending`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/app/telemetry.py` — modify

**Reviewers**: Service owner — Signal normalization correctness, idempotent ingestion, newsletter source schema stability

**Codebase Evidence**:
- Confirmed via: `find services/xstockstrat-ingest -name "telemetry.py"` → `services/xstockstrat-ingest/app/telemetry.py`
- Structurally identical to `xstockstrat-indicators/app/telemetry.py` — same `Resource.create({"service.name": svc_name, "deployment.environment": environment})` pattern at lines 30–35.
- Default service name at line 28: `"xstockstrat-ingest"`.
- `TRADING_MODE` confirmed in `services/xstockstrat-ingest/CLAUDE.md` Environment Variables section.

**Instructions**:
Apply the same change as Step 4 to `services/xstockstrat-ingest/app/telemetry.py`:

1. Add `trading_mode = os.getenv("TRADING_MODE", "paper")` after the `environment = ...` line (line 29).
2. Add `"trading_mode": trading_mode` and `"platform": "xstockstrat"` to the `Resource.create({...})` dict.

**No test step**: Same rationale as Step 4 — one `os.getenv` call and two dict keys in the OTel init guard; no business logic; import check is the appropriate gate.

**Verification**:
```bash
cd services/xstockstrat-ingest && python3 -c "from app.telemetry import init_telemetry; print('import ok')"
grep -n "trading_mode\|platform" app/telemetry.py
```
Expected: import succeeds; both new keys present.

---

### Step 6 — service: Add `trading_mode` and `platform` attributes to Python telemetry — `xstockstrat-analysis`

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/telemetry.py` — modify

**Reviewers**: Service owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Confirmed via: `find services/xstockstrat-analysis -name "telemetry.py"` → `services/xstockstrat-analysis/app/telemetry.py`
- Structurally identical to the other two Python telemetry files — same `Resource.create` pattern at lines 30–35.
- Default service name at line 28: `"xstockstrat-analysis"`.
- `TRADING_MODE` confirmed in `services/xstockstrat-analysis/CLAUDE.md` Environment Variables section.

**Instructions**:
Apply the same change as Steps 4–5 to `services/xstockstrat-analysis/app/telemetry.py`:

1. Add `trading_mode = os.getenv("TRADING_MODE", "paper")` after the `environment = ...` line (line 29).
2. Add `"trading_mode": trading_mode` and `"platform": "xstockstrat"` to the `Resource.create({...})` dict.

**No test step**: Same rationale as Step 4 — one `os.getenv` call and two dict keys in the OTel init guard; no business logic; import check is the appropriate gate.

**Verification**:
```bash
cd services/xstockstrat-analysis && python3 -c "from app.telemetry import init_telemetry; print('import ok')"
grep -n "trading_mode\|platform" app/telemetry.py
```
Expected: import succeeds; both new keys present.

---

### Step 7 — service: Add `trading_mode` and `platform` attributes to Node.js backend telemetry (all four services)

**Status**: `pending`
**Service**: `xstockstrat-ledger`, `xstockstrat-identity`, `xstockstrat-notify`, `xstockstrat-config`
**Files**:
- `services/xstockstrat-ledger/src/telemetry.ts` — modify
- `services/xstockstrat-identity/src/telemetry.ts` — modify
- `services/xstockstrat-notify/src/telemetry.ts` — modify
- `services/xstockstrat-config/src/telemetry.ts` — modify

**Reviewers**: Service owner (ledger) — Append-only invariant, event ordering, hypertable partition safety; Service owner (identity) — JWT expiry and rotation, API key scoping, secret store integration; Service owner (notify) — Stream delivery guarantees, backpressure handling, alert deduplication; Service owner (config) — Config key naming, environment/trading_mode scoping, WatchConfig stream stability

**Codebase Evidence**:
- Confirmed via: `find services/xstockstrat-{ledger,identity,notify,config} -name "telemetry.ts"` → all four at `src/telemetry.ts`.
- All four files are structurally identical. Current `Resource` constructor at lines 24–28 (example from ledger `src/telemetry.ts` lines 24–29):
  ```typescript
  resource: new Resource({
    [SEMRESATTRS_SERVICE_NAME]: serviceName,
    [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]: process.env.APPLICATION_ENV ?? 'development',
  }),
  ```
- `trading_mode` and `platform` attributes are **not present** — confirmed by reading all four files.
- `SEMRESATTRS_DEPLOYMENT_ENVIRONMENT` and `SEMRESATTRS_SERVICE_NAME` imported from `@opentelemetry/semantic-conventions` at line 19 in all four files.
- `@opentelemetry/semantic-conventions: "^1.25.0"` confirmed in `services/xstockstrat-ledger/package.json` line 31 (same version across all Node.js services).
- No semantic conventions constant for `trading_mode` or `platform` — these are custom attributes added as plain string keys in the `Resource` constructor.
- `TRADING_MODE` is in all four service environments (confirmed in each service's `CLAUDE.md` Environment Variables section).

**Instructions**:
In each of the four Node.js `src/telemetry.ts` files (`ledger`, `identity`, `notify`, `config`), extend the `Resource` constructor's attribute object to include two new keys. The pattern is identical for all four:

Locate the `new Resource({...})` block (lines 24–29 in each file). Add two entries after the existing `[SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]` line:

```typescript
resource: new Resource({
  [SEMRESATTRS_SERVICE_NAME]: serviceName,
  [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]: process.env.APPLICATION_ENV ?? 'development',
  trading_mode: process.env.TRADING_MODE ?? 'paper',
  platform: 'xstockstrat',
}),
```

No other changes to any of the four files. The existing `process.env.OTEL_ENABLED !== 'true'` guard at line 7 is preserved. No new imports are needed — custom string keys are valid plain object properties in the `Resource` constructor.

**No test step**: This change adds two plain string keys to the OTel `Resource` constructor in each service's telemetry init, which only runs when `OTEL_ENABLED=true` — always `false` in CI. No business logic is introduced; `tsc --noEmit` in **Verification** is the correct compilation gate. A dedicated test step would have no meaningful behavior to assert.

**Verification**:
```bash
cd services/xstockstrat-ledger && pnpm exec tsc --noEmit 2>&1
cd services/xstockstrat-identity && pnpm exec tsc --noEmit 2>&1
cd services/xstockstrat-notify && pnpm exec tsc --noEmit 2>&1
cd services/xstockstrat-config && pnpm exec tsc --noEmit 2>&1
grep -n "trading_mode\|platform" services/xstockstrat-ledger/src/telemetry.ts
grep -n "trading_mode\|platform" services/xstockstrat-identity/src/telemetry.ts
grep -n "trading_mode\|platform" services/xstockstrat-notify/src/telemetry.ts
grep -n "trading_mode\|platform" services/xstockstrat-config/src/telemetry.ts
```
Expected: `tsc --noEmit` exits 0 for all four; both keys present in all four files.

---

### Step 8 — service: Create `src/telemetry.ts` and `instrumentation.ts` for Next.js frontends

**Status**: `pending`
**Service**: `xstockstrat-trader`, `xstockstrat-insights`, `xstockstrat-config-ui`
**Files**:
- `services/xstockstrat-trader/src/telemetry.ts` — **create** (not found — `find services/xstockstrat-trader -name "telemetry*"` → no match)
- `services/xstockstrat-trader/instrumentation.ts` — **create** (not found)
- `services/xstockstrat-insights/src/telemetry.ts` — **create** (not found — `find services/xstockstrat-insights -name "telemetry*"` → no match)
- `services/xstockstrat-insights/instrumentation.ts` — **create**
- `services/xstockstrat-config-ui/src/telemetry.ts` — **create** (not found — `find services/xstockstrat-config-ui -name "telemetry*"` → no match; config-ui has `app/` + `src/` layout confirmed by listing root files)
- `services/xstockstrat-config-ui/instrumentation.ts` — **create**
- `services/xstockstrat-trader/package.json` — modify (add OTel deps)
- `services/xstockstrat-insights/package.json` — modify (add OTel deps)
- `services/xstockstrat-config-ui/package.json` — modify (add OTel deps)
- `services/xstockstrat-trader/next.config.js` — modify (add OTel to serverExternalPackages)
- `services/xstockstrat-insights/next.config.js` — modify (add OTel to serverComponentsExternalPackages)
- `services/xstockstrat-config-ui/next.config.js` — modify (add OTel to serverComponentsExternalPackages)
- `services/xstockstrat-trader/pnpm-lock.yaml` — modify (updated by `pnpm install`)
- `services/xstockstrat-insights/pnpm-lock.yaml` — modify (updated by `pnpm install`)
- `services/xstockstrat-config-ui/pnpm-lock.yaml` — modify (updated by `pnpm install`)

**Reviewers**: Service owner (trader) — Trading UI correctness, Connect-RPC call safety, no direct DB access from frontend; Service owner (insights) — Analytics display accuracy, SSE polling resilience, read-only access pattern; Service owner (config-ui) — Config mutation safety, environment scope correctness, no secret values rendered in UI

**Codebase Evidence**:
- `services/xstockstrat-trader/package.json` — no `@opentelemetry` packages. Next.js `"^15.5.15"` — `instrumentation.ts` stable (no experimental flag needed since Next.js 14.1).
- `services/xstockstrat-insights/package.json` — no `@opentelemetry` packages. Next.js `"^14.2.3"` — `instrumentation.ts` stable.
- `services/xstockstrat-config-ui/package.json` — no `@opentelemetry` packages. Next.js `"^14.2.3"`.
- `services/xstockstrat-trader/next.config.js` — uses `serverExternalPackages: ['@connectrpc/connect-node']` (trader uses Next.js 15 stable API).
- `services/xstockstrat-insights/next.config.js` — uses `experimental.serverComponentsExternalPackages: ['@connectrpc/connect-node']` (insights uses Next.js 14 experimental API).
- `services/xstockstrat-config-ui/next.config.js` — uses `experimental.serverComponentsExternalPackages: ['@connectrpc/connect-node']`.
- Reference implementation: `services/xstockstrat-ledger/src/telemetry.ts` — Node.js-based OTel init pattern confirmed.
- `OTEL_EXPORTER_OTLP_ENDPOINT` for all three frontends is `http://otel-collector:4318` (HTTP port, not gRPC 4317) — confirmed in `docker-compose.yml` lines 407, 436, 459.
- `TRADING_MODE` and `APPLICATION_ENV` injected via `<<: *common-env` anchor in `docker-compose.yml` lines 399, 425, 453. Both confirmed present as global env vars in `.do/app.dev.yaml` and `.do/app.yaml` (lines 7–10).
- OTel package versions to match: `@opentelemetry/sdk-node: "^0.52.0"`, `@opentelemetry/resources: "^1.25.0"`, `@opentelemetry/semantic-conventions: "^1.25.0"` — from `services/xstockstrat-ledger/package.json` lines 27–31. Use `@opentelemetry/exporter-trace-otlp-http: "^0.52.0"` (not `-grpc`) since frontends use HTTP port 4318.

**Instructions**:

**A. For each of the three Next.js services, create `src/telemetry.ts`** — model after `services/xstockstrat-ledger/src/telemetry.ts` with these adaptations:
- Change the service-name fallback.
- Add `trading_mode` and `platform` attributes (same as Step 7).
- Replace `GrpcInstrumentation` with `instrumentations: []` — frontends use HTTP Connect-RPC, not gRPC.
- Use `OTLPTraceExporter` from `@opentelemetry/exporter-trace-otlp-http` (not `-grpc`).

Template (substitute `<name>` with `trader`, `insights`, or `config-ui`):

```typescript
/**
 * OpenTelemetry initialisation for xstockstrat-<name>.
 * Activated only when OTEL_ENABLED=true.
 * Must be called before any other imports to ensure auto-instrumentation works.
 */
export function initTelemetry(): void {
  if (process.env.OTEL_ENABLED !== 'true') return;

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { NodeSDK } = require('@opentelemetry/sdk-node');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Resource } = require('@opentelemetry/resources');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { SEMRESATTRS_SERVICE_NAME, SEMRESATTRS_DEPLOYMENT_ENVIRONMENT } = require('@opentelemetry/semantic-conventions');

    const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://otel-collector:4318';
    const serviceName = process.env.OTEL_SERVICE_NAME ?? 'xstockstrat-<name>';

    const sdk = new NodeSDK({
      resource: new Resource({
        [SEMRESATTRS_SERVICE_NAME]: serviceName,
        [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]: process.env.APPLICATION_ENV ?? 'development',
        trading_mode: process.env.TRADING_MODE ?? 'paper',
        platform: 'xstockstrat',
      }),
      traceExporter: new OTLPTraceExporter({ url: endpoint }),
      instrumentations: [],
    });

    sdk.start();
    console.info(`[otel] tracing enabled → ${endpoint} (service=${serviceName})`);

    process.on('SIGTERM', () => sdk.shutdown().catch(console.error));
  } catch (err) {
    console.warn('[otel] init failed — continuing without tracing:', err);
  }
}
```

**B. For each service, create `instrumentation.ts` at the service root** (same level as `next.config.js`). Next.js 14+ automatically imports and calls `register()` from this file at server startup without any configuration flag:

```typescript
export async function register() {
  // OTel must be initialised before any other module loads.
  // Conditional ensures this only runs in the Node.js runtime, not Edge Runtime.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { initTelemetry } = await import('./src/telemetry');
    initTelemetry();
  }
}
```

**C. Add OTel packages to each service's `package.json` `dependencies`**:
```json
"@opentelemetry/exporter-trace-otlp-http": "^0.52.0",
"@opentelemetry/resources": "^1.25.0",
"@opentelemetry/sdk-node": "^0.52.0",
"@opentelemetry/semantic-conventions": "^1.25.0"
```
Then run `pnpm install` in each service directory.

**D. Update `next.config.js` for each service**:

For `services/xstockstrat-trader/next.config.js` (Next.js 15, stable `serverExternalPackages`):
```js
serverExternalPackages: ['@connectrpc/connect-node', '@opentelemetry/sdk-node', '@opentelemetry/exporter-trace-otlp-http'],
```

For `services/xstockstrat-insights/next.config.js` and `services/xstockstrat-config-ui/next.config.js` (Next.js 14, `experimental.serverComponentsExternalPackages`):
```js
serverComponentsExternalPackages: ['@connectrpc/connect-node', '@opentelemetry/sdk-node', '@opentelemetry/exporter-trace-otlp-http'],
```

**Verification**:
```bash
cd services/xstockstrat-trader && pnpm install && pnpm exec tsc --noEmit 2>&1
cd services/xstockstrat-insights && pnpm install && pnpm exec tsc --noEmit 2>&1
cd services/xstockstrat-config-ui && pnpm install && pnpm exec tsc --noEmit 2>&1
grep -n "trading_mode\|platform" services/xstockstrat-trader/src/telemetry.ts
grep -n "initTelemetry" services/xstockstrat-trader/instrumentation.ts
grep -n "trading_mode\|platform" services/xstockstrat-insights/src/telemetry.ts
grep -n "initTelemetry" services/xstockstrat-insights/instrumentation.ts
grep -n "trading_mode\|platform" services/xstockstrat-config-ui/src/telemetry.ts
grep -n "initTelemetry" services/xstockstrat-config-ui/instrumentation.ts
```
Expected: TypeScript compiles cleanly; all attribute and import lines present in all six new files.

---

### Step 9 — config: Clean up infrastructure files and update documentation

**Status**: `pending`
**Service**: Infrastructure / docs (cross-cutting)
**Files**:
- `docker-compose.yml` — modify
- `packages/otel/otel-collector-config.yaml` — modify
- `.do/app.dev.yaml` — modify
- `.do/app.yaml` — modify
- `docs/patterns/observability.md` — modify
- `docs/setup/grafana-cloud.md` — modify
- `.env.example` — modify

**Reviewers**: Platform Lead — Cross-service architecture, port assignments, service registry consistency, inter-service dependency graph correctness

**Codebase Evidence**:

- `docker-compose.yml` line 21: `OTEL_RESOURCE_ATTRIBUTES: environment=development,trading_mode=paper` — confirmed present, must be removed.
- `docker-compose.yml` lines 17–20: `x-common-env` anchor retains `APPLICATION_ENV` (line 18), `TRADING_MODE` (line 19), `OTEL_ENABLED` (line 20) — only line 21 is removed.
- `packages/otel/otel-collector-config.yaml` lines 46–56: `resource:` processor with three `upsert` actions for `environment: dev`, `trading_mode: paper`, `platform: xstockstrat` — all confirmed present, must be cleared to `attributes: []`.
- `.do/app.dev.yaml` lines 6–12: global `envs` contains `APPLICATION_ENV`, `TRADING_MODE`, `OTEL_ENABLED` only. `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_EXPORTER_OTLP_HEADERS` confirmed absent (`grep -n "OTEL_EXPORTER_OTLP_ENDPOINT\|OTEL_EXPORTER_OTLP_HEADERS\|OTEL_SERVICE_NAME\|OTEL_RESOURCE_ATTRIBUTES" .do/app.dev.yaml` → only `OTEL_ENABLED` at line 11). All 13 service entries confirmed present (lines 14–398); none have `OTEL_SERVICE_NAME`.
- `.do/app.yaml` lines 6–12: same global structure. Same absences confirmed (`grep` → only `OTEL_ENABLED` at line 11). All 13 service entries confirmed present (lines 14–394).
- `docs/patterns/observability.md` line 18: `| \`OTEL_RESOURCE_ATTRIBUTES\` | \`environment=dev,trading_mode=paper\` | \`environment=production,...\` |` — must be removed.
- `docs/setup/grafana-cloud.md` line 108: "Attaches `environment=dev`..." and line 118: `OTEL_RESOURCE_ATTRIBUTES=environment=dev,...` in code block — both must be updated.
- `docs/setup/grafana-cloud.md` lines 141–148 (Step 4): `OTEL_RESOURCE_ATTRIBUTES=environment=production,...` in the per-service env var block — must be removed.
- `.env.example` line 44: `# Docker only — in DO, set OTEL_EXPORTER_OTLP_HEADERS per service via DO dashboard.` — must change "per service" to "as a single global secret".

**Instructions**:

**A. `docker-compose.yml`**: Remove line 21 (`  OTEL_RESOURCE_ATTRIBUTES: environment=development,trading_mode=paper`) from the `x-common-env` anchor. No other changes.

**B. `packages/otel/otel-collector-config.yaml`**: Replace the `attributes:` block of the `resource:` processor (lines 48–56) with `attributes: []`. The `resource:` processor heading stays; the processor stays in all three pipeline `processors:` lists — it is now a deliberate no-op:
```yaml
  resource:
    attributes: []
```

**C. `.do/app.dev.yaml`** — two changes:

1. Append to the global `envs` block (after the `OTEL_ENABLED` entry at line 12):
   ```yaml
     - key: OTEL_EXPORTER_OTLP_ENDPOINT
       value: ""
     - key: OTEL_EXPORTER_OTLP_HEADERS
       scope: RUN_TIME
       type: SECRET
   ```

2. For each of the 13 service entries, append to its `envs:` block:
   ```yaml
         - key: OTEL_SERVICE_NAME
           value: xstockstrat-<name>
   ```
   Service name mapping (canonical `xstockstrat-<name>` values):
   trading, portfolio, marketdata, indicators, ingest, analysis, ledger, identity, notify, config, trader, insights, config-ui.

**D. `.do/app.yaml`**: Apply the same two changes as C (same 13 service names, same global `OTEL_EXPORTER_OTLP_ENDPOINT` / `OTEL_EXPORTER_OTLP_HEADERS` entries).

**E. `docs/patterns/observability.md`**:
- Remove the `OTEL_RESOURCE_ATTRIBUTES` row from the "Required env vars" table (currently line 18).
- After the env vars table, add a paragraph:
  > `environment`, `trading_mode`, and `platform` resource attributes are derived programmatically at startup inside each service's telemetry init module from `APPLICATION_ENV`, `TRADING_MODE`, and the hardcoded constant `xstockstrat` respectively. No `OTEL_RESOURCE_ATTRIBUTES` env var is needed or set.
- In the per-language telemetry modules table (lines 23–27), add a `Next.js` row:
  ```
  | Next.js | `src/telemetry.ts` + `instrumentation.ts` | `initTelemetry()` via Next.js instrumentation hook — no-op when `OTEL_ENABLED != "true"` |
  ```

**F. `docs/setup/grafana-cloud.md`**:
- In Step 3b (around line 108): update the bullet point "Attaches `environment=dev`, `trading_mode=paper`, `platform=xstockstrat` to all signals" to "Derives `environment`, `trading_mode`, and `platform` resource attributes from each service's `APPLICATION_ENV`, `TRADING_MODE` env vars and the hardcoded constant `xstockstrat` at startup".
- In the env var code block within Step 3b (around line 118): remove the `OTEL_RESOURCE_ATTRIBUTES=environment=dev,...` line entirely.
- In Step 4 (around lines 141–148): remove the `OTEL_RESOURCE_ATTRIBUTES=environment=production,...` line from the env var block. Add a note: "Resource attributes (`environment`, `trading_mode`, `platform`) are derived automatically at startup from env vars — no `OTEL_RESOURCE_ATTRIBUTES` setting required."

**G. `.env.example`** line 44: Change:
```
# Docker only — in DO, set OTEL_EXPORTER_OTLP_HEADERS per service via DO dashboard.
```
to:
```
# Docker only — in DO, set OTEL_EXPORTER_OTLP_HEADERS as a single global secret via DO dashboard.
```

**Verification**:
```bash
# Confirm OTEL_RESOURCE_ATTRIBUTES gone from all committed files
grep -rn "OTEL_RESOURCE_ATTRIBUTES" docker-compose.yml .do/app.dev.yaml .do/app.yaml docs/patterns/observability.md docs/setup/grafana-cloud.md
```
Expected: no output (zero matches).

```bash
# Confirm all 13 services have OTEL_SERVICE_NAME in both DO specs
grep -c "OTEL_SERVICE_NAME" .do/app.dev.yaml
grep -c "OTEL_SERVICE_NAME" .do/app.yaml
```
Expected: 13 in each file.

```bash
# Confirm global OTel endpoint and headers added to both DO specs
grep -n "OTEL_EXPORTER_OTLP_ENDPOINT\|OTEL_EXPORTER_OTLP_HEADERS" .do/app.dev.yaml .do/app.yaml
```
Expected: at least two matches in each file (the global entries).

```bash
# Confirm collector resource processor cleared
grep -A3 "resource:" packages/otel/otel-collector-config.yaml
```
Expected: `attributes: []` on the line after `resource:`.

```bash
# Confirm .env.example updated
grep -n "global secret" .env.example
```
Expected: line 44 contains "global secret".

```bash
# Confirm observability.md no longer has OTEL_RESOURCE_ATTRIBUTES
grep "OTEL_RESOURCE_ATTRIBUTES" docs/patterns/observability.md
```
Expected: no output.

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._

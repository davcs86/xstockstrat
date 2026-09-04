# Implementation Spec: fix-agent-trading-mode-otel-attr

**Status**: `pending`
**Created**: 2026-09-04
**Feature**: `docs/roadmap/features/171-fix-agent-trading-mode-otel-attr/feature.md`
**Total Steps**: 8
**Feature Branch**: `feature/fix-agent-trading-mode-otel-attr`

---

## Execution Summary

Fleet-wide removal of the redundant `trading_mode` OpenTelemetry resource attribute (and its now-dead
local `TRADING_MODE` read) from all 12 telemetry modules, plus the one `packages/otel/dashboards/README.md`
line documenting it. The `TRADING_MODE` **env var itself stays** — it remains a live paper/live routing
axis (portfolio/trading/indicators/ingest) and is untouched in `docker-compose.yml` / `.do/app.yaml` /
`.do/app.dev.yaml`; this feature deletes only the OTel attribute that read it.

Steps are grouped by language because the edit is byte-identical within each language (grep-confirmed):
Go (3 modules), Python (4), Node backend (4). Each backend `service` step extracts the Resource
construction into a **builder that is the sole Resource input to init**, deletes the `trading_mode`
attribute + local read, and is immediately followed by its paired `test` step. Every backend module
gets its **own** per-module test asserting `trading_mode` is absent on the **actually-built SDK
Resource** (RED against current code, GREEN after the delete) — no C-08 waiver (user decision, design R3).
The 12th module, `xstockstrat-ui` (frontend), gets the one-line deletion only, verified by its own
lint/tsc pipeline (frontend, exempt from the C-08 backend test pairing). The README docs step closes.

**Consumer surface (C-14):** the product spec marks this **internal/platform-only** — `trading_mode`
is an OTel resource attribute surfaced only in exported traces, with **no** `xstockstrat-ui` segment or
Agent MCP tool reaching it. This was a decision, not an omission: no UI/Agent step is required. Recon
confirmed nothing in-repo queries the attribute; `OTEL_ENABLED=false` in both `.do` specs.

### Scenario Coverage (C-15)

- **AC-1** (each backend module's built Resource omits `trading_mode`, keeps the trio) → Steps 2 (Go:
  trading/portfolio/marketdata), 4 (Python: agent/ingest/indicators/analysis), 6 (Node:
  ledger/identity/config/notify) — one per-module assertion each, covering all 11 backend modules.
- **AC-2** (telemetry init remains non-blocking after removal) → Step 4, the `xstockstrat-agent`
  forced-`except` test (the only module whose init has process-wide side effects).
- **AC-3** (dashboards README documents the attribute set without `trading_mode`) → Step 8, whose
  `**Verification**` is a grep that fails if `trading_mode` remains — the one non-`test`-step coverage,
  justified because AC-3 is a pure-docs scenario with no service behavior to unit-test.

## Step Dependencies

- Steps are independent across languages; a single PR lands all 8 (design: single PR so the README
  never describes a zero-to-partial state).
- Step 2 [test] pairs Step 1 [service] (Go); Step 4 [test] pairs Step 3 [service] (Python); Step 6
  [test] pairs Step 5 [service] (Node backend). Each pair is red-before-green: the test is authored to
  fail against the pre-delete tree (attribute present), then pass after.
- Step 7 (UI) is a frontend one-line deletion with no paired backend test (C-08 frontend exemption).
- Step 8 (docs) has no code dependency; land it in the same PR.
- No proto, migration, or config-key changes anywhere in this feature.

---

### Step 1 — service: Remove `trading_mode` from the three Go telemetry modules (extract `newResource`)

**Status**: `done`
**Service**: `xstockstrat-trading`, `xstockstrat-portfolio`, `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-trading/internal/telemetry/otel.go` — modify
- `services/xstockstrat-portfolio/internal/telemetry/otel.go` — modify
- `services/xstockstrat-marketdata/internal/telemetry/otel.go` — modify

**Reviewers**: Service owner (`xstockstrat-trading`) — order execution correctness / paper-only dev invariant; Service owner (`xstockstrat-portfolio`) — P&L / snapshot consistency; Service owner (`xstockstrat-marketdata`) — OHLCV ingestion integrity; Platform Lead — cross-service architecture (fleet-wide telemetry convention)

**Codebase Evidence**:
- Confirmed via `grep -n 'trading_mode' services/xstockstrat-*/internal/telemetry/otel.go` → each file line 46: `attribute.String("trading_mode", os.Getenv("TRADING_MODE")),` (byte-identical across all three).
- Full structure read at `services/xstockstrat-trading/internal/telemetry/otel.go:42-52` — `Init(ctx)` builds `res, err := resource.New(ctx, resource.WithAttributes( semconv.ServiceName(svcName), semconv.DeploymentEnvironment(os.Getenv("APPLICATION_ENV")), attribute.String("trading_mode", os.Getenv("TRADING_MODE")), attribute.String("platform", "xstockstrat"), ))`. `svcName` computed at `:37-40` (default per service: `"trading"`/`"portfolio"`/`"marketdata"`).
- Imports `attribute` (`:9`) and `os` (`:5`) — both stay used after the delete (`platform` attr + `SERVICE_NAME`/`APPLICATION_ENV`/`OTEL_ENABLED`/endpoint reads).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
- In each of the three files, extract a builder that is the **sole** Resource input to `Init`:
  ```go
  func newResource(ctx context.Context) (*resource.Resource, error) {
      svcName := os.Getenv("SERVICE_NAME")
      if svcName == "" {
          svcName = "trading" // per-file default: "portfolio" / "marketdata"
      }
      return resource.New(ctx,
          resource.WithAttributes(
              semconv.ServiceName(svcName),
              semconv.DeploymentEnvironment(os.Getenv("APPLICATION_ENV")),
              attribute.String("platform", "xstockstrat"),
          ),
      )
  }
  ```
  Delete the `attribute.String("trading_mode", os.Getenv("TRADING_MODE")),` line (`:46`). Move the
  `svcName` block (`:37-40`) into `newResource`.
- In `Init`, replace the inlined `svcName` block + `resource.New(...)` call with `res, err := newResource(ctx)` (keep the existing `if err != nil { return nil, err }` guard). **Init must call `newResource`** — do not leave an inlined attribute list, or the Step 2 test goes vacuous.
- Do **not** touch the `attribute` or `os` imports (still used). Do **not** touch `docker-compose.yml`, `.do/app.yaml`, or `.do/app.dev.yaml` — the `TRADING_MODE` env var stays defined there, unchanged (it remains a live routing axis; out of scope).

**Verification**:
- `grep -rn 'trading_mode' services/xstockstrat-{trading,portfolio,marketdata}/internal/telemetry/otel.go` — expect **no** matches.
- `grep -n 'newResource' services/xstockstrat-{trading,portfolio,marketdata}/internal/telemetry/otel.go` — confirm `Init` calls `newResource` and the builder exists.
- Build each: `cd services/<name> && GOWORK=off go build ./internal/telemetry/` — compiles (no unused-import error).
- Lint (may run in the paired Step 2): `cd services/<name> && GOWORK=off golangci-lint run --modules-download-mode=mod`.

---

### Step 2 — test: Per-module Go Resource-attribute assertions (trading/portfolio/marketdata)

**Status**: `done`
**Service**: `xstockstrat-trading`, `xstockstrat-portfolio`, `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-trading/internal/telemetry/otel_test.go` — create
- `services/xstockstrat-portfolio/internal/telemetry/otel_test.go` — create
- `services/xstockstrat-marketdata/internal/telemetry/otel_test.go` — create

**Reviewers**: Service owner (`xstockstrat-trading`) — order execution correctness; Service owner (`xstockstrat-portfolio`) — P&L consistency; Service owner (`xstockstrat-marketdata`) — OHLCV ingestion integrity

**Codebase Evidence**:
- No telemetry test exists today: `ls services/xstockstrat-{trading,portfolio,marketdata}/internal/telemetry/` → only `otel.go`. This is the first telemetry-attribute assertion on the platform (recon).
- `res.Attributes()` returns `[]attribute.KeyValue`; keys: `semconv.ServiceName` → `service.name`, `semconv.DeploymentEnvironment` → `deployment.environment`, `attribute.String("platform", …)` → `platform`.

**TDD**: `red-green required`

**Covers**: AC-1

**Instructions**:
- Add `internal/telemetry/otel_test.go` (package `telemetry` — internal test, so it can call the unexported `newResource`) to each of the three services. Assert on the **actually-built SDK Resource**, not a proxy map (design R2/R3 — avoids vacuous-green):
  ```go
  func TestNewResourceOmitsTradingMode(t *testing.T) {
      t.Setenv("APPLICATION_ENV", "staging")
      t.Setenv("TRADING_MODE", "paper")
      res, err := newResource(context.Background())
      if err != nil { t.Fatalf("newResource: %v", err) }
      got := map[string]bool{}
      for _, kv := range res.Attributes() { got[string(kv.Key)] = true }
      if got["trading_mode"] { t.Error("trading_mode attribute must be removed") }
      for _, want := range []string{"service.name", "deployment.environment", "platform"} {
          if !got[want] { t.Errorf("missing attribute %q", want) }
      }
  }
  ```
  RED before Step 1's delete (attribute present → `got["trading_mode"]` true → fails); GREEN after.
- Test data is a scenario one-off (two env values set via `t.Setenv`) — no domain fixture; C-13 canonical home not required (single inline consumer).

**Verification**:
- `cd services/<name> && GOWORK=off go test ./internal/telemetry/ -run TestNewResourceOmitsTradingMode -count=1` — passes for all three.
- Lint: `cd services/<name> && GOWORK=off golangci-lint run --modules-download-mode=mod`.
- **Coverage note:** the new logic lives in the `telemetry/` package, which the CI Go coverage command **excludes** from `-coverpkg` (see `reference/spec-template.md` coverage table). No coverage threshold applies to it; the direct `go test ./internal/telemetry/` pass is the sufficient C-08 gate. A `test` step is still required and present here.

---

### Step 3 — service: Remove `trading_mode` from the four Python telemetry modules (extract `_build_resource`)

**Status**: `done`
**Service**: `xstockstrat-agent`, `xstockstrat-ingest`, `xstockstrat-indicators`, `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-agent/app/telemetry.py` — modify
- `services/xstockstrat-ingest/app/telemetry.py` — modify
- `services/xstockstrat-indicators/app/telemetry.py` — modify
- `services/xstockstrat-analysis/app/telemetry.py` — modify

**Reviewers**: Service owner (`xstockstrat-agent`) — MCP tool contract stability / OAuth edge; Service owner (`xstockstrat-ingest`) — signal normalization / idempotent ingestion; Service owner (`xstockstrat-indicators`) — formula sandboxing; Service owner (`xstockstrat-analysis`) — backtest reproducibility; Platform Lead — cross-service architecture

**Codebase Evidence**:
- `grep -n 'trading_mode\|TRADING_MODE' services/xstockstrat-{agent,ingest,indicators,analysis}/app/telemetry.py`:
  - `agent/app/telemetry.py:33` `trading_mode = os.getenv("TRADING_MODE", "paper")`, `:39` `"trading_mode": trading_mode,`
  - `ingest/app/telemetry.py:29` + `:35`; `indicators/app/telemetry.py:29` + `:35`; `analysis/app/telemetry.py:29` + `:35` (ingest/indicators/analysis are byte-identical; agent differs only in the surrounding client-instrumentor + line offsets).
- Structure (agent `:22-42`): inside `init_telemetry`'s `try`, deferred imports incl. `from opentelemetry.sdk.resources import Resource` (`:26`), then `endpoint`/`svc_name`/`environment`/`trading_mode` reads, then `resource = Resource.create({ "service.name": svc_name, "deployment.environment": environment, "trading_mode": trading_mode, "platform": "xstockstrat" })`.
- `svc_name` and `endpoint` are also used by the exporter (`:43`) and the log line (`:50`, `extra={"service": svc_name}`), so they stay in `init_telemetry`; `environment` and `trading_mode` are used **only** in the resource dict.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
- In each of the four files, extract a module-level builder with a **deferred** SDK import inside it (design: `_build_resource() -> Resource`, does **not** set the global provider):
  ```python
  def _build_resource():
      from opentelemetry.sdk.resources import Resource
      return Resource.create(
          {
              "service.name": os.getenv("SERVICE_NAME", "agent"),  # per-file default: "ingest"/"indicators"/"analysis"
              "deployment.environment": os.getenv("APPLICATION_ENV", "development"),
              "platform": "xstockstrat",
          }
      )
  ```
- In `init_telemetry`, delete the `trading_mode = os.getenv(...)` local (agent `:33`, others `:29`), delete the `environment = os.getenv(...)` local (agent `:32`, others `:28`) and the deferred `from opentelemetry.sdk.resources import Resource` line inside the try (it moves into the builder), and replace the inline `resource = Resource.create({...})` block with `resource = _build_resource()`. Keep `svc_name`/`endpoint` in `init_telemetry` (still used by exporter + log). **Init must call `_build_resource`** — no inlined attribute dict left behind (else Step 4 goes vacuous).
- Do not remove `import os` (still used). Do not touch `docker-compose.yml` / `.do/*.yaml` — `TRADING_MODE` env var stays.

**Verification**:
- `grep -rn 'trading_mode\|TRADING_MODE' services/xstockstrat-{agent,ingest,indicators,analysis}/app/telemetry.py` — expect **no** matches.
- `grep -n '_build_resource' services/xstockstrat-{agent,ingest,indicators,analysis}/app/telemetry.py` — confirm `init_telemetry` calls it.
- Lint (may run in paired Step 4): `cd services/<name> && ruff check . && ruff format --check .`.

---

### Step 4 — test: Per-module Python Resource-attribute assertions + agent non-blocking init

**Status**: `done`
**Service**: `xstockstrat-agent`, `xstockstrat-ingest`, `xstockstrat-indicators`, `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-agent/tests/test_telemetry.py` — create
- `services/xstockstrat-ingest/tests/test_telemetry.py` — create
- `services/xstockstrat-indicators/tests/test_telemetry.py` — create
- `services/xstockstrat-analysis/tests/test_telemetry.py` — create

**Reviewers**: Service owner (`xstockstrat-agent`) — MCP contract stability; Service owner (`xstockstrat-ingest`) — signal normalization; Service owner (`xstockstrat-indicators`) — formula sandboxing; Service owner (`xstockstrat-analysis`) — backtest reproducibility

**Codebase Evidence**:
- Each service has a `tests/` dir with `conftest.py` (confirmed: `ls services/xstockstrat-{agent,ingest,indicators,analysis}/tests/`). The nearest existing telemetry touch is `xstockstrat-agent/tests/test_transport_config.py:38` which stubs `init_telemetry` to a no-op (recon) — a plausible sibling home.
- Agent init side effects to exercise for AC-2: `trace.set_tracer_provider(provider)` (`agent/app/telemetry.py:46`) and `GrpcAioInstrumentorClient().instrument()` (`:48`), preceded by `OTLPSpanExporter(...)` at `:43` inside the `try`; the `except Exception` guard is at `:52-53`.
- `Resource.create({...}).attributes` is a mapping keyed by the attribute names.

**TDD**: `red-green required`

**Covers**: AC-1, AC-2

**Instructions**:
- **All four files (AC-1):** assert the built SDK Resource omits `trading_mode` and keeps the trio:
  ```python
  def test_build_resource_omits_trading_mode(monkeypatch):
      monkeypatch.setenv("TRADING_MODE", "paper")
      from app.telemetry import _build_resource
      attrs = _build_resource().attributes
      assert "trading_mode" not in attrs
      assert "service.name" in attrs
      assert "deployment.environment" in attrs
      assert attrs["platform"] == "xstockstrat"
  ```
  RED before Step 3 (`_build_resource` does not yet exist / attribute present); GREEN after. Requires `opentelemetry-sdk` importable in the service's dev/test env (the modules already import it at runtime) — if a service's dev extras lack it, add it in the same step and run `uv lock` for that service (Python uv lock rule).
- **Agent file only (AC-2 — non-blocking init):** force the `except` branch and assert init does not raise and sets no global provider (design mechanism — monkeypatch the exporter constructed at `:43`, before `set_tracer_provider`/`instrument`, so init enters the guard with zero global mutation):
  ```python
  def test_init_telemetry_non_blocking_on_error(monkeypatch):
      monkeypatch.setenv("OTEL_ENABLED", "true")
      import app.telemetry as tel
      def _boom(*a, **k): raise RuntimeError("exporter down")
      monkeypatch.setattr(tel, "OTLPSpanExporter", _boom, raising=False)
      tel.init_telemetry()  # must not raise
  ```
  (The name `OTLPSpanExporter` is imported inside `init_telemetry`'s `try`; if `setattr` on the module does not intercept the local import, instead monkeypatch `opentelemetry.exporter.otlp.proto.grpc.trace_exporter.OTLPSpanExporter` — resolve the exact seam at execute, keeping the "force the except, assert no raise, assert no global provider set" contract.) RED if a pre-existing bug let init raise; GREEN confirms the guard holds after the resource change.
- Test data are scenario one-offs (env values via `monkeypatch`) — no domain fixture, C-13 home not required (single inline consumer per file).

**Verification**:
- `cd services/xstockstrat-agent && uv run pytest tests/test_telemetry.py -q` then `cd services/xstockstrat-ingest && uv run pytest tests/test_telemetry.py -q` then indicators/analysis likewise — all pass.
- Coverage gate per service: `cd services/xstockstrat-indicators && uv run pytest --cov=app --cov-fail-under=50`; `cd services/xstockstrat-{agent,ingest,analysis} && uv run pytest --cov=app --cov-fail-under=40` — thresholds still pass (a deleted line + a covered `_build_resource` only add coverage).
- Lint: `cd services/<name> && ruff check . && ruff format --check .`.

---

### Step 5 — service: Remove `trading_mode` from the four Node backend telemetry modules (extract `buildResource`)

**Status**: `pending`
**Service**: `xstockstrat-ledger`, `xstockstrat-identity`, `xstockstrat-config`, `xstockstrat-notify`
**Files**:
- `services/xstockstrat-ledger/src/telemetry.ts` — modify
- `services/xstockstrat-identity/src/telemetry.ts` — modify
- `services/xstockstrat-config/src/telemetry.ts` — modify
- `services/xstockstrat-notify/src/telemetry.ts` — modify

**Reviewers**: Service owner (`xstockstrat-ledger`) — append-only invariant / stream safety; Service owner (`xstockstrat-identity`) — JWT / secret store; Service owner (`xstockstrat-config`) — config key naming / WatchConfig stability; Service owner (`xstockstrat-notify`) — stream delivery guarantees; Platform Lead — cross-service architecture

**Codebase Evidence**:
- `grep -n 'trading_mode' services/xstockstrat-{ledger,identity,config,notify}/src/telemetry.ts` → `ledger:27`, `identity:27`, `config:26`, `notify:28`, each `trading_mode: process.env.TRADING_MODE ?? 'paper',`.
- All four use the same `new NodeSDK({ resource: new Resource({ [SEMRESATTRS_SERVICE_NAME]: serviceName, [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]: process.env.APPLICATION_ENV ?? 'development', trading_mode: …, platform: 'xstockstrat' }) })` shape (read at `ledger/src/telemetry.ts:23-32`), with `Resource` + the two `SEMRESATTRS_*` constants `require`d inside `initTelemetry`'s `try` (`ledger:16-18`). Per-service `serviceName` default: `'ledger'`/`'identity'`/`'config'`/`'notify'`.
- **This is the 4 `new Resource` backend modules only** — `xstockstrat-ui/src/telemetry.ts` uses `resourceFromAttributes` and is handled separately in Step 7 (one-line deletion, no extraction).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
- In each of the four files, extract an exported builder that is the **sole** Resource input to `initTelemetry` (its own `require`s so it is self-contained):
  ```ts
  export function buildResource() {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Resource } = require('@opentelemetry/resources');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { SEMRESATTRS_SERVICE_NAME, SEMRESATTRS_DEPLOYMENT_ENVIRONMENT } = require('@opentelemetry/semantic-conventions');
    return new Resource({
      [SEMRESATTRS_SERVICE_NAME]: process.env.SERVICE_NAME ?? 'ledger', // per-file default
      [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]: process.env.APPLICATION_ENV ?? 'development',
      platform: 'xstockstrat',
    });
  }
  ```
  Delete the `trading_mode: …` line. In `initTelemetry`, set `resource: buildResource()` and drop the now-unused inline `Resource`/`SEMRESATTRS_*` requires **if** nothing else in the try uses them (they were only used for the resource — confirm at execute; the `serviceName` local at `ledger:21` is still used by the log line, keep it). **Init must call `buildResource`** — no inlined attribute object left behind (else Step 6 goes vacuous).
- Do not touch `docker-compose.yml` / `.do/*.yaml` — `TRADING_MODE` env var stays.

**Verification**:
- `grep -rn 'trading_mode' services/xstockstrat-{ledger,identity,config,notify}/src/telemetry.ts` — expect **no** matches.
- `grep -n 'buildResource' services/xstockstrat-{ledger,identity,config,notify}/src/telemetry.ts` — confirm `initTelemetry` calls it.
- Lint (may run in paired Step 6): `cd services/<name> && pnpm run lint`.

---

### Step 6 — test: Per-module Node backend Resource-attribute assertions (ledger/identity/config/notify)

**Status**: `pending`
**Service**: `xstockstrat-ledger`, `xstockstrat-identity`, `xstockstrat-config`, `xstockstrat-notify`
**Files**:
- `services/xstockstrat-ledger/src/__tests__/telemetry.test.ts` — create
- `services/xstockstrat-identity/src/__tests__/telemetry.test.ts` — create
- `services/xstockstrat-config/src/__tests__/telemetry.test.ts` — create
- `services/xstockstrat-notify/src/__tests__/telemetry.test.ts` — create

**Reviewers**: Service owner (`xstockstrat-ledger`) — append-only / stream safety; Service owner (`xstockstrat-identity`) — JWT / secret store; Service owner (`xstockstrat-config`) — WatchConfig stability; Service owner (`xstockstrat-notify`) — stream delivery

**Codebase Evidence**:
- Each service has `src/__tests__/*.test.ts` and a configured runner (`grep -A1 '"test' services/<name>/package.json`):
  - `xstockstrat-ledger`, `xstockstrat-identity`: `node --experimental-strip-types --test src/__tests__/*.test.ts` (runs `.ts` directly); coverage `c8 … --lines 40`.
  - `xstockstrat-config`, `xstockstrat-notify`: `tsc && node --test dist/__tests__/*.test.js` (compile-first); coverage `c8 … --lines 40`.
- `notify`'s existing tests already use the compile-first + **static import + "import succeeded" assertion** convention (its CLAUDE.md § Authorization; `src/__tests__/notifyServiceImpl.test.ts`) to avoid the feature-074 zero-assertion trap — mirror the **static import** here.
- The OTel `Resource` object exposes an `attributes` record keyed by the attribute names.

**TDD**: `red-green required`

**Covers**: AC-1

**Instructions**:
- Add `src/__tests__/telemetry.test.ts` to each service, importing `buildResource` **statically** from the sibling telemetry module (match the service's own import style: ledger/identity resolve `.ts` under `--experimental-strip-types`; config/notify compile to `dist` then run — the source import path is the same `../telemetry`). Use the `node:test` + `node:assert/strict` harness the existing `*.test.ts` files use:
  ```ts
  import { test } from 'node:test';
  import assert from 'node:assert/strict';
  import { buildResource } from '../telemetry.ts'; // resolve extension per the service's runner at execute

  test('built Resource omits trading_mode, keeps the trio', () => {
    process.env.TRADING_MODE = 'paper';
    const attrs = buildResource().attributes as Record<string, unknown>;
    assert.equal('trading_mode' in attrs, false);
    assert.ok(attrs['service.name']);
    assert.ok('deployment.environment' in attrs);
    assert.equal(attrs['platform'], 'xstockstrat');
  });
  ```
  RED before Step 5 (`buildResource` absent / attribute present); GREEN after.
- Test data is a scenario one-off (`process.env.TRADING_MODE`) — no domain fixture; C-13 `src/__tests__/fixtures/` home not required (single inline consumer).

**Verification**:
- Per service: `cd services/<name> && pnpm run test:coverage` — the new test passes and the 40% `c8` threshold holds (a deleted line + a covered `buildResource` only add coverage). For `config`/`notify` this compiles via `tsc` first (dist runner); for `ledger`/`identity` it runs the `.ts` directly.
- Lint: `cd services/<name> && pnpm run lint`.

---

### Step 7 — service: Remove the one `trading_mode` line from `xstockstrat-ui` telemetry (frontend)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/telemetry.ts` — modify

**Reviewers**: Service owner (`xstockstrat-ui`) — Connect-RPC call safety / no secret values rendered; Platform Lead — cross-service architecture

**Codebase Evidence**:
- `grep -n 'trading_mode' services/xstockstrat-ui/src/telemetry.ts` → `:21` `trading_mode: process.env.TRADING_MODE ?? 'paper',`, inside `resourceFromAttributes({ [ATTR_SERVICE_NAME]: serviceName, 'deployment.environment': …, trading_mode: …, platform: 'xstockstrat' })` (read at `src/telemetry.ts:17-26`).
- Distinct from the 4 Node backend modules: this module uses `resourceFromAttributes` (not `new Resource`). Design decision: **one-line deletion only**, not a builder extraction or whole-file removal (minimal; consistent with "init intact"). Frontend → exempt from C-08 backend test pairing; verified by the UI's own lint/tsc/vitest/Playwright pipeline.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
- Delete line `:21` (`trading_mode: process.env.TRADING_MODE ?? 'paper',`) from `src/telemetry.ts`. Leave `resourceFromAttributes`, the `ATTR_SERVICE_NAME` / `deployment.environment` / `platform` attributes, and the rest of init unchanged. Do not extract a builder and do not add a backend-style attribute test (frontend, out of the C-08 backend pairing — this is the 12th module, verified by the UI pipeline).
- Do not touch `docker-compose.yml` / `.do/*.yaml` — `TRADING_MODE` (and `SERVICE_NAME=xstockstrat-ui`, `OTEL_ENABLED`) env vars stay.

**Verification**:
- `grep -n 'trading_mode' services/xstockstrat-ui/src/telemetry.ts` — expect **no** matches.
- `cd services/xstockstrat-ui && pnpm run lint` — passes (the file still type-checks; `process.env` unaffected). The existing vitest/Playwright suites need no change (no logic under `src/lib/**` is touched).

---

### Step 8 — docs: Drop `trading_mode` from the dashboards README attribute list

**Status**: `pending`
**Service**: `packages/otel/dashboards/`
**Files**:
- `packages/otel/dashboards/README.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `grep -n 'trading_mode' packages/otel/dashboards/README.md` → `:40`, inside the "Resource attributes" bullet (`:40-42`): `- **Resource attributes** ( \`service.name\`, \`deployment.environment\`, \`trading_mode\`, \`platform=xstockstrat\`) are attached by every service's telemetry module …`.
- Recon: this README line is the **only** in-repo consumer of the documented attribute — no dashboard panel `expr` or alert rule queries `trading_mode` (grep of `packages/otel/**` returned only this prose). So the docs must match the newly-emitted set.

**TDD**: `N/A (docs — no code)`

**Covers**: AC-3

**Instructions**:
- Edit the Resource-attributes bullet at `:40` to drop `trading_mode` while keeping the other three: `- **Resource attributes** (\`service.name\`, \`deployment.environment\`, \`platform=xstockstrat\`) are attached by every service's telemetry module …`. Do not change the surrounding metric/label prose.
- This is the only doc that lists the emitted attribute set; no other `packages/otel/**` file references `trading_mode` (recon).

**Verification**:
- `grep -rn 'trading_mode' packages/otel/` — expect **no** matches (this grep is the AC-3 assertion: it fails if the label remains anywhere under `packages/otel/`).
- `grep -n 'service.name\|deployment.environment\|platform' packages/otel/dashboards/README.md` — confirm the other three attributes still documented.

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._

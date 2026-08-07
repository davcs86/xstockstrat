# Defect: WatchConfig clients omit environment/trading_mode — every service reads dev/all-scoped config regardless of deployment

**Recorded**: 2026-08-07
**Severity**: SEV-1
**Impact type**: config-propagation
**Environment**: production and dev — code-level defect present in every deployment
**Affected service(s)**: xstockstrat-trading, xstockstrat-portfolio, xstockstrat-marketdata, xstockstrat-indicators, xstockstrat-ingest, xstockstrat-analysis, xstockstrat-config
**Config-only fix possible**: no

## Observed

Every backend service's `WatchConfig` subscription omits the `environment` and `trading_mode`
fields on the request. `xstockstrat-config` resolves an unset field to its proto zero-value default
— `environment` → `dev`, `trading_mode` → `all` — for every subscriber, regardless of which
environment or trading mode that service's own deployment actually runs. This is true for all six
consuming services in both languages, not one outlier:

- Go `xstockstrat-trading`: `WatchConfigRequest{ Namespace: w.namespace, ClientId: ... }` — no
  `Environment`/`TradingMode` set.
- Go `xstockstrat-portfolio`/`xstockstrat-marketdata`: `Watcher` structs carry unused
  `environment`/`tradingMode` fields that `NewWatcher(endpoint, namespace)` never populates.
- Python `xstockstrat-indicators`/`xstockstrat-ingest`/`xstockstrat-analysis` (shared watcher
  module): `WatchConfigRequest(namespace=..., client_id=...)` — same omission.

Each service does read its own `APPLICATION_ENV`/`TRADING_MODE` env vars into its local config
struct (`ApplicationEnv`, `TradingMode` fields), but never forwards them into the `WatchConfig`
request that determines which config rows it actually receives.

Consequently: a **production** deployment of `xstockstrat-trading` subscribes to `environment='dev'`,
`trading_mode='all'` — the same scope a dev deployment gets. Migration
`002_config_environment.up.sql` defaulted all pre-existing rows to `environment='dev'` when applied
(independently, to both the staging and production databases), then separately seeded a small set of
**more-conservative `production`-tagged risk values** on top ("Seed production variants of key
trading risk values (more conservative than dev defaults)"). Because no production service ever asks
for the `production` scope, those tighter values are never read by anything — production runs on the
looser `dev`-tagged defaults instead. The `environment`/`trading_mode` scoping system is effectively
non-functional for every real consumer today; only the Config UI's manual `GetConfig`/`SetConfig`
calls (which do pass explicit scope) can reach non-default rows at all, and even those writes are
never consumed by any live subscriber (see companion defect: Config UI ENV/MODE toggle honesty,
filed separately).

## Expected

Each service should pass its own resolved `environment`/`trading_mode` (from
`APPLICATION_ENV`/`TRADING_MODE`) on its `WatchConfig` request, so a production deployment actually
subscribes to `environment='production'` and receives the intentionally tighter risk-config rows
seeded for it — matching the documented invariant in `xstockstrat-config/CLAUDE.md`: "All other
services must call WatchConfig at startup ... pass environment and trading_mode."

## Reproduction

1. Deploy (or run locally) any of the six affected services with `APPLICATION_ENV=production`.
2. Inspect the `WatchConfigRequest` it sends — `Environment`/`TradingMode` are absent/zero-value.
3. Confirm server-side resolution: `resolveEnv(undefined) → 'dev'`, `resolveMode(undefined) → 'all'`
   (`configServiceImpl.ts:84-97`).
4. Confirm the production database holds both a `dev`-tagged and a `production`-tagged row for the
   same seeded risk key (`002_config_environment.up.sql`) — the service only ever receives the
   `dev`-tagged one.

## Evidence

`services/xstockstrat-trading/internal/config/config.go:102-107`
> `req := &configv1.WatchConfigRequest{ Namespace: w.namespace, ClientId: fmt.Sprintf("go-trading-%d", os.Getpid()) }`

`services/xstockstrat-portfolio/internal/config/config.go:61,66-74,176-181` (same pattern:
`services/xstockstrat-marketdata/internal/config/config.go:71-84,168-175`)
> `Watcher` struct declares `environment`/`tradingMode` fields; `NewWatcher(endpoint, namespace)` never sets them.

`services/xstockstrat-analysis/app/config/watcher.py:33-38` (shared pattern with indicators/ingest)
> `config_pb2.WatchConfigRequest(namespace=self.namespace, client_id=f"indicators-{id(self)}")` — no `environment=`/`trading_mode=`.

`services/xstockstrat-config/src/grpc/configServiceImpl.ts:84-97`
> `function resolveEnv(v) { ... return ENV_MAP[v ?? 0] ?? 'dev'; }` / `function resolveMode(v) { ... return MODE_MAP[v ?? 0] ?? 'all'; }`

`services/xstockstrat-config/migrations/002_config_environment.up.sql:6-8,45-72`
> `ADD COLUMN IF NOT EXISTS environment TEXT NOT NULL DEFAULT 'dev' ...` / `-- Seed production variants of key trading risk values (more conservative than dev defaults)`

`services/xstockstrat-trading/internal/config/config.go:29,44`
> `ApplicationEnv string // "development" | "production"` / `TradingMode: getEnv("TRADING_MODE", "paper")` — resolved locally but never forwarded to `WatchConfig`.

`services/xstockstrat-config/CLAUDE.md:33` (documented invariant, currently violated by all six consumers)
> "All other services must call WatchConfig at startup ... pass environment and trading_mode."

## Root cause hypothesis

The `environment`/`trading_mode` scoping columns and the seed data assuming production would use
them were added (migration 002) without updating the six existing `WatchConfig` client
implementations to actually populate those request fields — a documented invariant that was never
wired into the calling code on either side (Go or Python).

## Confidence

high

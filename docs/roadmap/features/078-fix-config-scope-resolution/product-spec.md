# Product Spec: fix-config-scope-resolution

**Type**: bug
**Severity**: SEV-1
**Created**: 2026-07-29

---

## Problem Statement

`services/xstockstrat-config/src/grpc/configServiceImpl.ts` resolved the request scope with:

```ts
const ENV_MAP: Record<number, EnvStr> = { 0: 'dev', 1: 'dev', 2: 'production' };
function resolveEnv(v: number | undefined): EnvStr { return ENV_MAP[v ?? 0] ?? 'dev'; }
function resolveMode(v: number | undefined): ModeStr { return MODE_MAP[v ?? 0] ?? 'all'; }
…
const env  = resolveEnv(call.request.environment);
const mode = resolveMode(call.request.trading_mode);
```

Two independent decoding faults, same root cause as features 075 and 077 — the handler assumed a
wire shape ts-proto does not produce:

1. **`environment`** — the field name is right, but `packages/proto/buf.gen.yaml` sets
   `stringEnums=true`, so the decoded value is the string `'ENVIRONMENT_PRODUCTION'`, not `2`.
   `ENV_MAP['ENVIRONMENT_PRODUCTION']` is `undefined` → `'dev'`.
2. **`trading_mode`** — ts-proto decodes to `tradingMode`, so `call.request.trading_mode` is always
   `undefined` → `'all'`.

**Observed over a real gRPC connection.** A `ListKeys` call sent with
`environment: 'ENVIRONMENT_PRODUCTION', tradingMode: 'TRADING_MODE_LIVE'` produced the SQL
parameters:

```
["marketdata", "dev", "all"]
```

Both helpers back all four RPCs (`watchConfig`, `getConfig`, `setConfig`, `listKeys`), so the
collapse is total:

- **Production config is unreachable.** `migrations/007_marketdata_fmp.up.sql` seeds both a `dev` and
  a `production` row; no RPC could ever return the production one.
- **Every service boots on dev config.** `ConfigWatcher` passes its `environment`/`trading_mode`
  (per this service's own Critical Invariant #2) and receives the dev/all bucket regardless — in
  production too.
- **Writes land in the wrong scope.** `SetConfig(environment='production')` wrote a `dev` row, so a
  production rollout reported success and changed nothing.

The `trading_mode` half was already logged in
`services/xstockstrat-config/docs/context-constitution-findings.md`, scoped as "SetConfig always
writes `trading_mode='all'`". The `environment` half, and the fact that the **read** path collapses
too, were not known.

## Affected Services

- `xstockstrat-config` — the bug
- **Every service** — all of them consume `WatchConfig` and have been receiving dev config

## Fix Scope

- [x] No proto changes
- [x] No migration
- [x] No new config keys

## Acceptance Criteria

- [x] AC-1 `ListKeys` sent `ENVIRONMENT_PRODUCTION`/`TRADING_MODE_LIVE` queries `('production','live')`.
- [x] AC-2 `ListKeys` sent `ENVIRONMENT_DEV`/`TRADING_MODE_PAPER` queries `('dev','paper')`.
- [x] AC-3 An unspecified scope still defaults to `('dev','all')` — no behavior change for callers
      that omit it, which is every service today.
- [x] AC-4 `SetConfig` told `production`/`live` writes a `production`/`live` row.
- [x] AC-5 All assertions run over a **real gRPC connection**, since the bug is entirely in decoding.
- [ ] AC-6 **Operational, outstanding**: diff `config.config_values` between `dev` and `production`
      before deploying. Production has been served dev values, so this fix *changes what every
      service reads*. Any production row that has drifted from its dev twin becomes live on deploy.

## Out of Scope

- Making the numeric branch unreachable / removing `ENV_MAP`+`MODE_MAP`. Both helpers now accept
  the string **and** numeric forms, so a hand-built request (as the existing unit tests use) still
  works. Tightening to string-only would break those tests for no behavioral gain.
- The `pg_notify` payload path (`initialize`, which reads `environment`/`trading_mode` off the JSON
  payload the trigger writes, not off a proto message) — that path is unaffected.

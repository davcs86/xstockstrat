# Product Spec: fix-listkeys-wire-encoding

**Type**: bug
**Severity**: SEV-2
**Created**: 2026-07-29

---

## Problem Statement

`services/xstockstrat-config/src/grpc/configServiceImpl.ts` `listKeys` constructed each
`ConfigKeyMeta` with snake_case keys and numeric enum values:

```ts
default_value: r.default_value ?? '',
is_secret: r.is_secret,
consuming_service: r.consuming_service ?? '',
environment: r.environment === 'production' ? 2 : 1,
trading_mode: r.trading_mode === 'live' ? 2 : r.trading_mode === 'paper' ? 1 : 0,
validation: { value_type: …, min_value: …, max_value: … }
```

The server is bound to the ts-proto grpc-js service definition
(`src/grpc/serviceDefinition.ts` → `ConfigServiceService`), generated with `outputServices=grpc-js`
and default `snakeToCamel` plus `stringEnums=true` (`packages/proto/buf.gen.yaml`). So
`ConfigKeyMeta.encode()` looks for `.defaultValue`, `.isSecret`, `.consumingService`,
`.tradingMode`, `.validation.valueType` — all `undefined` — and writes proto defaults.

**Observed over a real gRPC connection** (this is the executed output, not a reading of the code):

```json
{ "key": "…", "description": "toggle", "defaultValue": "", "isSecret": false,
  "consumingService": "", "environment": "UNRECOGNIZED", "tradingMode": "UNRECOGNIZED" }
```

`is_secret` was set `true` on the source row. Only `key` and `description` survive — they are
spelled identically in both casings.

**Why it matters beyond cosmetics:** `/config-ui` decides whether a key is editable from
`k.isSecret` returned by `ListKeys` (`src/app/config-ui/[namespace]/page.tsx`). Because the field is
always `false` on the wire, that guard is **inert** — a secret-flagged key has always been editable
in the UI. The service's own `CLAUDE.md` documents the guard as working.

**Why it survived:** the existing unit test inspects the handler's **pre-encode** object, where the
snake_case keys are present and look correct; and the config-ui e2e suite runs against
`e2e/mock-backend.ts`, which returns its own already-camelCase shape. Neither exercises the real
encoder. This is the same trap recorded in `docs/roadmap/ledger/fails.md` (2026-07-27).

## Affected Services

- `xstockstrat-config` — the encoding bug
- `xstockstrat-ui` — the downstream consumer whose guard this restores (no code change needed)

## Fix Scope

- [x] No proto changes — `ConfigKeyMeta` already declares every field
- [x] No migration
- [x] No new config keys

## Acceptance Criteria

- [x] AC-1 A client receives `isSecret=true` for a row with `is_secret = TRUE`.
- [x] AC-2 `defaultValue` and `consumingService` survive encoding.
- [x] AC-3 `environment`/`tradingMode` encode as real enum constants, never `UNRECOGNIZED`.
- [x] AC-4 The `validation` sub-message survives with `valueType`/`minValue`/`maxValue`.
- [x] AC-5 All assertions run over a **real gRPC connection**, not the handler's pre-encode object.

## Out of Scope

- The `trading_mode` request-side snake/camel collapse (`configServiceImpl.ts` reads
  `call.request.trading_mode`) — a sibling of the same root cause on the **request** path, with its
  own blast radius. Logged in the service's findings doc; not fixed here.
- `buildConfigValue` has no `'json'` case, so a `json`-typed value reads back as a string. Separate
  defect, surfaced by the same review; not fixed here.
- Re-verifying every other handler for the same class of bug — `getConfig`/`watchConfig` were fixed
  in feature 075 and are covered by tests.

# Product Spec: fix-config-value-roundtrip

**Type**: bug
**Severity**: SEV-2
**Created**: 2026-07-29

---

## Problem Statement

### Defect 1 — `SetConfig` corrupts the value it stores (live)

`services/xstockstrat-config/src/grpc/configServiceImpl.ts` `setConfig` persists
`JSON.stringify(value)` where `value` is the whole `ConfigValue` message:

```ts
[namespace, key, inferValueType(value), JSON.stringify(value), author, reason, env, mode]
```

Every read path parses `value_data` as a **bare scalar** (`buildConfigValue`: `string_val: row.value_data`,
`parseInt(row.value_data, 10)`, …), and the seed migrations store bare scalars. So a write of `"abc"`
lands `{"stringVal":"abc"}` in `config.config_values` and reads back as that literal string.

`inferValueType` compounds it: it tests **snake_case** fields (`v.string_val`) against a ts-proto
**camelCase** request object (`stringVal`), so every branch falls through and all writes — int,
float, bool — are recorded as `value_type='string'`.

**Live impact:** any config key written through the `/config-ui` editor is corrupted. Seeded keys
read correctly only because migrations wrote bare scalars, which masks the bug.

### Defect 2 — `ConfigValue.is_secret` is never populated on the read path (latent)

`ConfigValue` carries `bool is_secret = 6` (`packages/proto/config/v1/config.proto`), documented
"true = value is redacted; resolved at runtime". Nothing sets it: `buildConfigValue` returns only
the oneof scalar, and `toProtoSnapPayload` rebuilds each value as the scalar alone. The DB row has
`is_secret` available at both call sites and it is dropped.

Result: `GetConfig` and `WatchConfig` report `is_secret == false` for **every** key, including
`secret.marketdata.fmp.api_key`. `ListKeys` is the only path that returns it truthfully — which is
why `/config-ui` reads `isSecret` from `ListKeys` rather than the snapshot, working around the bug
without anyone recording it.

**Latent impact:** any consumer that trusts `is_secret` on a snapshot will treat secrets as
non-secret. Feature 073's `get_config` redaction (FR-1) is specified to do exactly that, so this
must be fixed before 073 can ship its redaction.

## Affected Services

- `xstockstrat-config` — both defects are in `src/grpc/configServiceImpl.ts`

## Fix Scope

- [x] No proto changes — `ConfigValue.is_secret` already exists (field 6)
- [x] No new config keys
- [ ] **Migration needed?** To be decided: existing rows written through `SetConfig` already hold
      `{"stringVal":…}` blobs. A backfill migration may be required, or the read path may need a
      transitional tolerance. This is the one genuinely open question — see below.

## Acceptance Criteria

- [ ] AC-1 A `SetConfig` write of each scalar type (string/int/float/bool) stores a **bare scalar**
      in `value_data` and the correct `value_type`, and reads back through `GetConfig` as the same
      typed value it was written with.
- [ ] AC-2 `inferValueType` classifies a ts-proto camelCase request correctly for all four scalar
      types (currently every one returns `'string'`).
- [ ] AC-3 `GetConfig` and `WatchConfig` return `is_secret == true` for a key whose DB row has
      `is_secret = TRUE` (verified against the seeded `secret.marketdata.fmp.api_key`).
- [ ] AC-4 Existing seeded keys (bare scalars written by migrations) continue to read correctly —
      no regression for the majority of rows.
- [ ] AC-5 Already-corrupted rows are either migrated or explicitly documented as needing a manual
      rewrite; the chosen answer is recorded in `context.md`.

## Out of Scope

- Real secret-store resolution (`secret://` reference resolving) — unchanged by this fix.
- The `trading_mode` snake/camel scoping collapse (`docs/context-constitution-findings.md`) — a
  sibling of the same camelCase root cause, but a distinct behavioral bug with its own blast radius.
  Flagged, not fixed here.
- The audit-on-UPDATE-only gap (new-key INSERTs are unaudited) — separate defect, already logged.

## Open Questions

- [ ] **Backfill.** How many `config.config_values` rows already hold a `{"stringVal":…}` blob, and
      should the fix ship a data migration, a tolerant reader, or a documented manual rewrite? Needs
      a look at real dev/prod data — cannot be answered from the repo alone.

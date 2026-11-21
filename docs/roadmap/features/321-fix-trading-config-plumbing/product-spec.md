# Product Spec: fix-trading-config-plumbing

**Type**: bug
**GitHub Issue**: none (Issues disabled) — reports: docs/reports/2026-10-19-trading-ibkr-timeout-hardcoded-defect.md, docs/reports/2026-10-19-trading-config-accessor-type-mismatch-defect.md, docs/reports/2026-10-19-trading-requires-approval-always-false-defect.md, docs/reports/2026-11-06-trading-broker-paper-env-derived-default-unseedable-defect.md
**Severity**: SEV-2
**Created**: 2026-11-10

---

## Problem Statement

### IBKR broker client ignores trading.broker.timeout_ms (hardcoded 10s)

Report: [docs/reports/2026-10-19-trading-ibkr-timeout-hardcoded-defect.md](../../../reports/2026-10-19-trading-ibkr-timeout-hardcoded-defect.md) — SEV-3

- **Observed:** the IBKR `http.Client` uses a hardcoded 10s timeout; `IBKRConfig` has no timeout field,
  so every IBKR call waits up to 10s regardless of config (maintainer-confirmed oversight).
- **Expected:** each signed IBKR request honours the live `trading.broker.timeout_ms` (default 5000). The
  LST handshake keeps its own bound, `trading.ibkr.handshake_timeout_ms` (design D-1).

### trading reads int-documented config keys with GetFloat (and the same key with both accessors)

Report: [docs/reports/2026-10-19-trading-config-accessor-type-mismatch-defect.md](../../../reports/2026-10-19-trading-config-accessor-type-mismatch-defect.md) — SEV-3

- **Observed:** `Watcher.GetInt` / `GetFloat` each decode only their own `oneof` branch and return `0`
  (not the default) for the other. `trading.order.max_retries` / `retry_delay_ms` (documented int) are read
  with `GetFloat`, so an `int_val` row gives the emergency flatten one attempt, no retries, no delay.
  `trading.broker.timeout_ms` was read with both accessors. Latent: none of these keys has a seed row.
- **Expected:** each key uses one accessor matching its documented type, or the getters coerce int↔float.
- **Amended at design (2026-11-20, recon.md § Risks):** the observed behaviour is stale at HEAD. Since
  feature 295 `GetFloat` widens an int row and a type mismatch returns the default with a WARN, never `0`;
  config migration `041` seeds `broker.timeout_ms`, `order.max_retries` and `order.retry_delay_ms` as `int`
  in both environments. No production change is needed. What is missing is a read-path test that drives an
  int row through `flattenAndHalt` (design D-3, D-11).

### trading.orders.requires_approval is always persisted false

Report: [docs/reports/2026-10-19-trading-requires-approval-always-false-defect.md](../../../reports/2026-10-19-trading-requires-approval-always-false-defect.md) — SEV-3

- **Observed:** `UpsertOrder` binds literal `false` to `requires_approval` for every order, including ones
  routed to `ORDER_STATUS_PENDING_APPROVAL`; nothing writes `approved_by` / `approved_at`.
- **Expected:** `requires_approval` reflects whether the order crossed `trading.approval.require_above_qty` /
  `require_above_notional`.

### trading.broker.paper has an environment-derived default that a catalog seed cannot express

Report: [docs/reports/2026-11-06-trading-broker-paper-env-derived-default-unseedable-defect.md](../../../reports/2026-11-06-trading-broker-paper-env-derived-default-unseedable-defect.md) — SEV-2

- **Observed:** the reader's fallback is `s.cfg.TradingMode == "paper"` (`TRADING_MODE` env); the frozen
  catalog has one `code_default` per key, so this row's is empty, while feature 295's heal migration seeds
  every agreeing non-secret catalog key × {staging, production} with its code default.
- **Expected:** the key is never seeded with one literal for both environments (production = live,
  staging = paper). A `true` seed in production would route live orders to the paper API; `false` in
  staging would route paper accounts to the live API.

## Reproduction Steps

1. IBKR timeout: set `trading.broker.timeout_ms=2000`, make an IBKR account's order endpoint never answer,
   place an order — the signed order request blocks ~10s, not 2s.
2. Accessor mismatch: no longer reproducible at HEAD (see the amendment above). An `int` row
   `trading.order.max_retries=n` gives the flatten `1 + n` submissions.
3. requires_approval: place an order with qty above `trading.approval.require_above_qty` (staging seed 500);
   response is `ORDER_STATUS_PENDING_APPROVAL`; `SELECT requires_approval FROM trading.orders WHERE order_id = '<id>'` → `false`.
4. broker.paper: `node scripts/check-config-wiring.mjs --json` lists `read-unseeded trading trading.broker.paper`;
   its catalog row has an empty `code_default`; a code-default seed step would write `''` or a guessed literal in both envs.

## Root Cause Hypothesis

Line references re-grounded at `b5756b2f` (2026-11-20); paths are under `services/xstockstrat-trading/`.

- **IBKR timeout:** never plumbed through `IBKRConfig` (`internal/broker/ibkr.go:26-42`, no timeout field).
  `IBKRRequestTimeout` (`ibkr.go:68`) is the `http.Client` timeout (`ibkr.go:83`) and also the floor in
  `staleThreshold` (`internal/service/order_intent.go:109-117`). Alpaca reads the key live through a
  `Timeout func()` closure (`internal/service/trading.go:3377`, `internal/broker/alpaca.go:25-26,75-81`).
- **Accessor mismatch:** stale (see Problem Statement). `brokerCallTimeout` (`trading.go:2634-2640`,
  `GetFloat`) is the sole reader of `broker.timeout_ms`; the flatten reads `order.max_retries` and
  `order.retry_delay_ms` with `GetFloat` (`trading.go:3083-3084`), which widens an int row
  (`internal/config/watchcore.go:406`).
- **requires_approval:** `submitOrder` receives `requiresApproval bool` (`trading.go:606`) and sets the
  order status from it (`:613-616`), but `UpsertOrder` binds the literal `false` to `$17`
  (`internal/repository/trading_repo.go:93`). `ON CONFLICT` never updates the column (`:77-86`).
- **broker.paper:** two readers with the fallback `s.cfg.TradingMode == "paper"` (`trading.go:2831`,
  `:3852`); the key is the only unseeded read key (`scripts/config-wiring.json:5-12`; migration `041` skips
  it, `041_heal_config_keys_to_reader_catalog.up.sql:349`).

## Affected Services

- xstockstrat-trading (broker, service, repository, config watcher)
- xstockstrat-config (one seed migration for `trading.broker.paper`; the wiring-gate baseline and stored set)
- packages/proto (comment-only fix in `trading/v1/trading.proto`; regenerated stubs)

## Consumer Surface(s)

None — internal/platform-only (design.md § Chosen Approach, C-14). The UI shows only the order status enum
and `GetTradingEnvironment`, whose result is unchanged in all three deployment targets; the agent has no
surface for these fields. `trading.broker.paper` becomes an ordinary seeded row in `/config-ui` (no UI code
change).

## Fix Scope

- [x] Proto changes anticipated: **comment-only** — the stale `TRADING_MODE env` wording on
  `RegisterBrokerAccountRequest.is_paper` (`packages/proto/trading/v1/trading.proto:263-265`); no field,
  number or type changes (design D-15).
- [x] Database migrations anticipated: **yes, one config seed migration** (provisional `056`) for
  `trading` / `broker.paper`. No trading schema change (`requires_approval` exists since migration 001).
- [x] Config key changes anticipated: **yes** — see Config Key Changes.

## Config Key Changes

- `trading.broker.timeout_ms` — existing key, int, seeded `5000` by `041`. New consumer: every signed IBKR
  request reads it live. Sole reader stays `brokerCallTimeout`.
- `trading.broker.paper` — existing key, bool. Becomes seeded per environment (staging `true`, production
  `false`); single reader `environmentIsPaper`; the fallback when the row is absent changes from the
  `TRADING_MODE` env to `APPLICATION_ENV` (paper unless `production`).

The flatten retry keys (order.max_retries, order.retry_delay_ms) and the approval thresholds are read as before.

## Pre-deploy Operator Action

Design D-13 / D-16 / D-20, amended by the operator ruling of 2026-11-20 (context.md): before 321 deploys,
each **staging** deployment holds `trading.broker.timeout_ms` as an int >= 10000 and
`trading.order_intent.stale_multiplier` >= 4.0, each edit with a `config.config_audit` row. Production is out
of the action (never launched); when it is first launched its `trading` config must be brought to the same
values before trading goes live there. After 321 the key `broker.timeout_ms` also bounds IBKR signed
requests, although its stored description still reads as Alpaca-only.

## Open Questions (answered at design, 2026-11-20)

1. Accessor fix shape → neither. No getter or accessor change; a read-path regression test (D-3, R-1, R-2).
2. `trading.broker.paper` → seeded per environment, and the fallback is `APPLICATION_ENV` (D-5, D-6, D-14).
3. `staleThreshold` floor → kept at 10 s through one exported broker constant: S = max(T, 10 s) × multiplier
   (D-2, R-3).
4. `approved_by` / `approved_at` → out of scope; only `requires_approval` (D-4).

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev.

## Out of Scope

- Retiring the `TRADING_MODE` env / `trading_mode` axis residue elsewhere (feature 322).
- Writing `approved_by` / `approved_at` (no Approve RPC exists).
- Any change to the config getters (`watchcore.go`, three byte-identical copies), to
  `scripts/config-heal/catalog.tsv`, or to stored config descriptions (recorded as findings instead).
- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix

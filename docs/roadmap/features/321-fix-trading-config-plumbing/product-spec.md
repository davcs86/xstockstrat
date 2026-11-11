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
- **Expected:** IBKR HTTP calls honour `trading.broker.timeout_ms` (default 5000).

### trading reads int-documented config keys with GetFloat (and the same key with both accessors)

Report: [docs/reports/2026-10-19-trading-config-accessor-type-mismatch-defect.md](../../../reports/2026-10-19-trading-config-accessor-type-mismatch-defect.md) — SEV-3

- **Observed:** `Watcher.GetInt` / `GetFloat` each decode only their own `oneof` branch and return `0`
  (not the default) for the other. `trading.order.max_retries` / `retry_delay_ms` (documented int) are read
  with `GetFloat`, so an `int_val` row gives the emergency flatten one attempt, no retries, no delay.
  `trading.broker.timeout_ms` was read with both accessors. Latent: none of these keys has a seed row.
- **Expected:** each key uses one accessor matching its documented type, or the getters coerce int↔float.

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

1. IBKR timeout: set `trading.broker.timeout_ms=2000`, point an IBKR account's base URL at a black-holed
   host, place an order — each IBKR call blocks ~10s, not 2s.
2. Accessor mismatch: `SetConfig trading.order.max_retries=3` with `value_type=int`; trigger a
   protection-window flatten whose submission fails transiently — one attempt, then halt (`maxRetries == 0`).
3. requires_approval: place an order with qty above `trading.approval.require_above_qty` (default 500);
   response is `ORDER_STATUS_PENDING_APPROVAL`; `SELECT requires_approval FROM trading.orders WHERE order_id = '<id>'` → `false`.
4. broker.paper: `node scripts/check-config-wiring.mjs --json` lists `read-unseeded trading trading.broker.paper`;
   its catalog row has an empty `code_default`; a code-default seed step would write `''` or a guessed literal in both envs.

## Root Cause Hypothesis

- **IBKR timeout:** never plumbed through `IBKRConfig`. `IBKRRequestTimeout` is also the floor in
  `staleThreshold`, so the fix must keep that formula consistent. Current: `services/xstockstrat-trading/internal/broker/ibkr.go:68`
  (const), `:83` (`&http.Client{Timeout: IBKRRequestTimeout}`); floor at `internal/service/order_intent.go:103`.
- **Accessor mismatch:** getters strictly typed by oneof branch; no per-key type discipline; seeds don't pin
  `value_type`. Current (keys now namespace-relative): `internal/service/trading.go:2982-2983`
  (`GetFloat("order.max_retries")`, `GetFloat("order.retry_delay_ms")`). Spot-check note: the
  `broker.timeout_ms` dual-accessor half appears narrowed at HEAD — `brokerCallTimeout` (`trading.go:2539-2540`,
  `GetFloat`) is now its sole reader and `staleThreshold` calls it — so only the int-vs-float row-type
  mismatch remains for that key.
- **requires_approval:** `submitOrder` receives `requiresApproval bool` (`trading.go:606`), but the repository
  has no source for it and hardcodes `false` (`internal/repository/trading_repo.go:93`).
- **broker.paper:** environment-derived fallback (`trading.go:2730`, `:3743`) has no single literal for the
  one-`code_default` catalog. Catalog row now annotated "must never be seeded from this catalog"
  (`scripts/config-heal/catalog.tsv:171`); whether the seeding path honours that is not verified.

## Affected Services

- xstockstrat-trading (broker, service, repository, config watcher)
- xstockstrat-config (seed/heal migrations for `trading.broker.paper` and any `value_type` pinning)

## Fix Scope

- [x] Proto changes anticipated: **no** — none of the reports touches a contract.
- [x] Database migrations anticipated: **possibly (config seeds only)** — no trading schema change
  (`requires_approval` column exists, migration 001); a config-seed migration only if `value_type` is pinned
  for the order keys or `broker.paper` gets per-environment seed rows.
- [x] Config key changes anticipated: **yes** — IBKR becomes a new reader of `trading.broker.timeout_ms`;
  the order keys' accessor/type discipline changes; `trading.broker.paper` seeding semantics change.

## Open Questions

1. Accessor fix shape: per-key accessor matching documented type, or make `GetInt` / `GetFloat` coerce
   between the int and float branches (report offers both)?
2. `trading.broker.paper`: seed per-environment literals (staging `true`, production `false`), or exclude it
   from seeding permanently and keep the `TRADING_MODE` fallback? (Interacts with feature 322's
   `TRADING_MODE` residue cleanup.)
3. IBKR timeout vs the `staleThreshold` floor: once IBKR honours `timeout_ms`, is the `IBKRRequestTimeout`
   floor removed or kept, and what is the new formula?
4. Is writing `approved_by` / `approved_at` on the approval path in scope, or only `requires_approval`?

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev.

## Out of Scope

- Retiring the `TRADING_MODE` env / `trading_mode` axis residue elsewhere (feature 322).
- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix

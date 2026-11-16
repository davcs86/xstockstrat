# Recon: fix-replace-tif-before-intent

**Created**: 2026-11-16
**From**: product-spec.md
**Tree**: feature/fix-replace-tif-before-intent@4216878 ≡ origin (main-dev@f61f76c merged)
**Affected services**: xstockstrat-trading

---

## Objective

`ReplaceOrder` claims its dedup intent and marks the order PENDING before it validates the requested
time-in-force, so a TIF the broker does not allow strands a PENDING intent (later UNKNOWN) for a
request that never reached the broker. The fix validates the TIF before any intent is claimed, as
`PlaceOrder` already does.

## Codebase Map

All paths under `services/xstockstrat-trading/`; `trading.go` = `internal/service/trading.go`.

- **`xstockstrat-trading`** (Go)
  - Handler: `ReplaceOrder` — `trading.go:1511-1666`. Gate order:
    order lookup `:1512-1524` → ownership `:1528-1530` → status `:1534-1540` → account halt `:1544-1546`
    → trading-state `:1549-1551` → broker-order-id `:1553-1556` → `resolveAccount` `:1558`
    → `deriveReplaceCancelIntentID` `:1564` → `InsertIntent` `:1569-1575` → `!ok2` dedup switch
    `:1576-1602` (every branch returns) → `prevIntent` capture `:1603` → PENDING mark `:1604`
    → `brokerReq` build `:1607-1612` → **TIF block `:1613-1618`** (`validateTIF` `:1614`, leaking
    `return nil, err` `:1615`, `tifToWireString` `:1617`) → broker `ReplaceOrder` `:1619`
    → `ErrRateLimited` → `refuseRateLimitedMutation` `:1620-1622` → rejected finalize `:1623-1629`
    → success `:1634-1665`.
  - The `:1615` return is the **only** leaking return between `InsertIntent` and the broker call.
  - `PlaceOrder` — `trading.go:449`; `validateTIF` `:521` runs before `placeOrderRequestHash` `:527-531`
    and `InsertIntent` `:623` (in `submitOrder`).
  - `validateTIF(tif tradingv1.TimeInForce, brokerType commonv1.BrokerType) error` —
    `internal/service/tif_validation.go:61`; pure (reads only its args and the package-level
    `allowedTIFs` `:34`). IBKR allows DAY/GTC/IOC/FOK only. `tifToWireString` `:14`.
  - `resolveAccount(accountID) (resolvedID, brokerPoolEntry, error)` — `trading.go:356`; read lock only,
    no side effects. `brokerPoolEntry{client, brokerType int32, userID}` — `trading.go:75-81`.
  - `CancelOrder` — `trading.go:1300-1448`: no request validation after its `InsertIntent` `:1334` /
    PENDING mark `:1369`; every later return finalizes or releases the intent. **Not affected.**
  - `refuseRateLimitedMutation` — `trading.go:1485-1495` (347; uses `prevIntent`).
  - Last migration / config-read pattern: not relevant (no migration, no config read added).

## Patterns to REUSE

- TIF-before-claim ordering → mirror `PlaceOrder` (`trading.go:519-531`).
- Stateful intent repo for assertions → `memIntentRepo` (`internal/service/trading_flatten_rejection_test.go:40`; rows in `recs`).
- Service harness with an intent repo, DB-write counter and ledger recorder → `newRLFakeHarness`
  (`internal/service/trading_rate_limit_test.go:475`; `intentCount()` `:491`, `execCount()` `:485`;
  order `"ord-1"`, caller `ctxAsUser("user-1")`, `IntentState` COMPLETED via `rlWorkingOrder` `:207`).
- Broker double with a `ReplaceOrder` call counter → `rlReplaceBroker` (`trading_rate_limit_test.go:583`)
  or `replaceOKBroker` (`trading_order_state_audit_test.go:68`); plain `fakeBroker.ReplaceOrder` panics
  (`trading_bracket_test.go:53`).
- IBKR-typed account entry → replace the whole map value:
  `h.svc.brokers["acct-1"] = brokerPoolEntry{client: …, brokerType: int32(commonv1.BrokerType_BROKER_TYPE_IBKR), userID: "u-1"}`
  (pattern at `trading_ibkr_auth_test.go:348`, `trading_bracket_test.go:255`).
- Ledger event inspection → `recordingLedgerClient.eventTypes()` (`trading_reconciliation_test.go:158`).
- Go fixture home `internal/testdata/` exists (C-13); the doubles above are test-package helpers with
  existing consumers, not domain-data literals.

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-3 @FR-3 @feature-202` "A broker-unsupported TIF is rejected before broker submission" (`services/xstockstrat-trading/acceptance/order-time-in-force-enum.feature`) — same `validateTIF` allow-list and `InvalidArgument` code.
- **PRESERVE** `@AC-2 @FR-3 @feature-202` "An unspecified TIF is rejected at the edge" (same suite) — `PlaceOrder` untouched; an absent TIF on replace stays "leave unchanged".
- **PRESERVE** `@AC-1 @FR-1 @FR-2 @feature-202` "A GTC market order is placed with the TimeInForce enum" (same suite) — `validateTIF`/`tifToWireString` are not refactored.
- **PRESERVE** `@AC-6 @FR-4 @regression @feature-267` "A failed final write in ReplaceOrder is logged" (`…/fix-trading-order-state-audit.feature`).
- **PRESERVE** `@AC-7 @FR-6 @regression @feature-267` "A failed reactive reclaim in ReplaceOrder is logged" (same suite) — the dedup/reclaim block is not moved.
- **PRESERVE** `@AC-9 @FR-5 @regression @feature-267` "A reactive stale-intent reclaim in ReplaceOrder is audited" (same suite).
- **PRESERVE** `@AC-31 @FR-8 @feature-347` "A rate-limited replace leaves the order unchanged and an identical retry really retries" (`…/alpaca-adaptive-rate-limit.feature`) — claim → refusal → `ReleasePendingIntent` unchanged (TRADING-8).
- **PRESERVE** `@AC-16 @FR-8 @feature-347` "A rate-limited replace is retried with the same body" (same suite).
- **EXTEND** (no existing `@AC`) — 349 `@AC-1`/`@AC-2` extend the 202 `@AC-3` rejection guarantee to `ReplaceOrder` and add side-effect freedom. No durable scenario covers the replace TIF check or the replace dedup collapse today.
- No CHANGE verdicts. `docs/sdd/business-rules/platform.feature` holds no rule on ReplaceOrder / TIF / order intents.

## Dependencies

- Proto/RPC: none (`ReplaceOrderRequest.time_in_force` is already `optional`).
- Migration: none.
- Config keys: none.
- Inter-service edges: none.
- New env vars / ports: none.

## Risks / Not-found

- Not found: any existing `ReplaceOrder` test that sets `TimeInForce`; any `tifPtr`-style helper; any
  `recover()` wrapper or nil-repo fixture that reaches the TIF block (the `recover()` sites at
  `trading_bracket_test.go:573,700,729` wrap `CancelOrder`; the nil-repo replace tests at
  `trading_ownership_test.go:78` and `trading_bracket_test.go:537` return at earlier gates).
- Not found: any sentence in `services/xstockstrat-trading/CLAUDE.md` § Order Replace about TIF
  validation or intent ordering. TRADING-7 (`docs/context-constitution.md:21`) says "BEFORE any broker
  call" and is silent on ordering relative to the intent claim.
- Precedence is unspecified by any suite: after the fix a TIF-refused request is `InvalidArgument` even
  when a matching PENDING/UNKNOWN intent already exists (e.g. a row stranded by this defect before the
  fix). Design decision needed.
- fails.md 2026-10-07 (`order-time-in-force-enum`): a validation added to a handler with an idempotency
  claim goes before the claim, with a handler-level test per RPC gate.
- fails.md 2026-11-16 (`alpaca-adaptive-rate-limit`): run the whole `internal/service` package after
  reordering a handler; for every new scenario state the driving test package/seam and whether it
  fails on today's code. 349 `@AC-3` passes on today's code (it is a guard).
- 347's `prevIntent` capture (`:1603`) and `ErrRateLimited` branch (`:1620-1622`) share the function; keep both intact.

## Recommended Scope

1. `test` — handler-level regression tests in `internal/service` (red on today's code for `@AC-1`, `@AC-2`; `@AC-3` guard).
2. `service` — hoist the TIF block in `ReplaceOrder` above `deriveReplaceCancelIntentID`.
3. `docs` — TRADING-7 wording (and `CLAUDE.md` § Order Replace only if behavior documented there changes); findings/ledger touch.

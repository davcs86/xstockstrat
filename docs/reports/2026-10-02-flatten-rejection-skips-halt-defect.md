# Defect: Flatten rejection skips account halt (stored REJECTED intent replayed as success)

**Recorded**: 2026-10-02
**Severity**: SEV-1
**Impact type**: unprotected-live-position
**Environment**: production (main)
**Affected service(s)**: xstockstrat-trading
**Config-only fix possible**: no

## Observed

`flattenAndHalt` mints one `clientOrderID`/`flattenOrderID` per protection-gap episode and reuses
it on every retry. If attempt 0 is rejected by the broker, its intent is finalized REJECTED. On
attempt 1, `submitOrder` finds the existing intent, `classifyIntentLookup` maps
`IntentStateRejected` → `intentActionReturnStored`, and `submitOrder` returns `&stored, nil`. The
retry loop sees `lastErr == nil`, logs "position flattened", marks the bracket CANCELED and returns
— `haltAccount` is never called. The position stays open, unprotected, with no halt.

## Expected

A broker-REJECTED flatten is a failure. Retries remain dedup-safe on transient/unknown errors (same
client order id), a fresh client order id is minted only after a definitive REJECTED, and
exhausting the retry budget always halts the account (`HALT_SOURCE_BRACKET_PROTECTION`).

## Reproduction

1. Bracket-protected entry whose protection window expires (watchdog → `flattenAndHalt`).
2. Fake broker rejects the first flatten `SubmitOrder` (e.g. insufficient buying power).
3. Observe: attempt 1 returns the stored REJECTED order with nil error; log says "position
   flattened"; bracket CANCELED; account not halted.

## Evidence

`services/xstockstrat-trading/internal/service/trading.go:2665`
> clientOrderID := uuid.New().String()

`services/xstockstrat-trading/internal/service/trading.go:2689-2696`
> _, lastErr = s.submitOrder(ctx, flattenReq, ...)
> if lastErr == nil { ... slog.Info("flattenAndHalt: position flattened", ...); return }

`services/xstockstrat-trading/internal/service/order_intent.go:72-73`
> case repository.IntentStateCompleted, repository.IntentStateRejected:
> 	return intentActionReturnStored, false

`services/xstockstrat-trading/internal/service/trading.go:576-581`
> case intentActionReturnStored: ... return &stored, nil

## Root cause hypothesis

The retry loop checks only the error, not the returned order's status; idempotent replay of a
REJECTED intent is indistinguishable from success. Agreed fix direction (triage, 2026-10-02):
status-aware retry — treat a REJECTED result as failure, re-mint the client order id only after a
definitive REJECTED, keep it on transient errors, halt on exhaustion.

## Confidence

high

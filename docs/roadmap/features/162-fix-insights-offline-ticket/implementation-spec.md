# Implementation Spec: fix-insights-offline-ticket

**Type**: bug (Track C / SDD path)
**Defect Report**: `docs/reports/2026-08-27-insights-signal-ticket-offline-account-flake-defect.md`
**Severity**: SEV-3

---

## Root Cause (pinned)

The insights Signal-detail route `/insights/market/[symbol]` is a redirect-only stub
(`services/xstockstrat-ui/src/app/insights/market/[symbol]/page.tsx`) that forwards to the unified
`/trader/positions/[symbol]` page (feature 125). The original insights ticket component
`SignalOrderTicket` mounted `OrderForm` with `allowOfflineRecord={false}`
(`src/components/insights/SignalOrderTicket.tsx:22`) — deliberately broker-execution context — but
feature 125 re-created that ticket inline on the unified page **without** the prop:

```tsx
// src/app/trader/positions/[symbol]/page.tsx:335 (pre-fix)
<OrderForm mode={mode} initialSymbol={symbol} />
```

`OrderForm` defaults `allowOfflineRecord = true` (`src/components/trader/OrderForm.tsx:55`) and gates
record mode on it: `isRecordMode = allowOfflineRecord && selectedAccount?.brokerType === OFFLINE`
(`OrderForm.tsx:60`). With the only registered account being offline, `AccountContext` auto-selects
it; before the auto-select re-render `selectedAccount` is undefined → `isRecordMode=false` → the
"Place Order" broker heading renders; after it settles → `isRecordMode=true` → the "Record Offline
Order" heading renders (`OrderForm.tsx:159`). That auto-select-vs-assertion race is the flake in
`e2e/trader/offline-accounts.spec.ts:257 @AC-1`.

`SymbolPanelGroup` mounts the ticket node exactly once (no desktop/mobile double-mount here), so the
race — not a second un-propped mount — is the sole cause. The mobile `SectionRenderer` hypothesis in
the defect report does not apply to this page (it uses `SymbolPanelGroup`, not `SectionRenderer`).

## Fix

Single-line product fix — restore the documented broker-only intent on the unified page's Signal-detail
ticket:

**Step 1** — `services/xstockstrat-ui/src/app/trader/positions/[symbol]/page.tsx` (the `place-order`
panel, ~line 335): pass `allowOfflineRecord={false}` to `OrderForm`. With record mode structurally
disabled, `isRecordMode` is always false regardless of account state or re-render timing, so
"Record Offline Order" can never render on this page and "Place Order" always does — the test passes
honestly, not by racing the assertion. A comment records the feature-125/162 rationale.

No proto, DB, or config changes. The offline "Record order" affordance remains available on the
`/trader` dashboard and `/trader/orders` (feature 159 @AC-1, `offline-accounts.spec.ts:196`), which
mount `OrderForm` with the default `allowOfflineRecord=true`.

## Verification

- `e2e/trader/offline-accounts.spec.ts:257 @AC-1` passes reliably with `--retries=0` (the regression
  scenario in `acceptance.feature`).
- `offline-accounts.spec.ts:196 @AC-1` (the `/trader` record-mode affordance) stays green — the fix is
  scoped to the position/Signal-detail mount only.
- `next lint` + `tsc` clean; existing trader/insights e2e unaffected.

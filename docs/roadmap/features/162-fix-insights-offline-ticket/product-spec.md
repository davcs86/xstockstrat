# Product Spec: fix-insights-offline-ticket

**Type**: bug
**Defect Report**: `docs/reports/2026-08-27-insights-signal-ticket-offline-account-flake-defect.md`
**Severity**: SEV-3
**Created**: 2026-08-27

---

## Problem Statement

On the insights Signal-detail page (`/insights/market/[symbol]`), when the only registered account
is an offline account, the order-ticket column intermittently renders the offline **"Record Offline
Order"** control instead of the broker **"Place Order"** ticket. Expected: the insights mount passes
`allowOfflineRecord={false}` (`SignalOrderTicket.tsx:22`), so it must always render the broker ticket
and never the offline record control. The mismatch surfaces as a flaky failure of
`e2e/trader/offline-accounts.spec.ts:257 @AC-1` (feature 159). Not caused by feature 161 —
reproduces on `origin/main-dev` fixtures.

## Reproduction Steps

```bash
cd services/xstockstrat-ui
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome \
CI=1 E2E_PREBUILT=1 \
npx playwright test trader/offline-accounts.spec.ts:257 --project=chromium --workers=1 --retries=0
```
Fails intermittently in CI, deterministically in the local prod-build e2e run above. On failure the
a11y snapshot shows a "Record Offline Order" heading + "Record BUY AAPL" button and no "Place Order".

## Root Cause Hypothesis

Under investigation. The direct wiring is correct (`SignalOrderTicket.tsx:22` → `allowOfflineRecord={false}`;
`OrderForm.tsx:60` gates record mode on it), so the record control likely comes from a **second
mount or a hydration race**:
1. The mobile companion order-ticket section (`src/components/mobile/SectionRenderer.tsx`, `form`
   kind) may mount `OrderForm` **without** `allowOfflineRecord={false}` (default `true`), rendering
   the record control; and/or
2. An `AccountContext` auto-select → `OrderForm` re-render race where the broker ticket has not
   mounted when the assertion window opens.

## Affected Services

- `xstockstrat-ui` — insights Signal-detail order ticket (`src/components/insights/SignalOrderTicket.tsx`,
  `src/components/trader/OrderForm.tsx`, the mobile `SectionRenderer` `form` section; feature 159/083/155).

## Fix Scope

- [x] No proto changes anticipated
- [x] No database migrations anticipated
- [x] No config key changes anticipated

(Update after investigation — remove or replace each item as needed)

## Acceptance Criteria

See `acceptance.feature` — the regression scenario that must fail on the buggy render and pass after
the fix (Constitution **C-15**). Plus: `e2e/trader/offline-accounts.spec.ts:257 @AC-1` passes
reliably (run it with `--retries=0` several times); existing config-ui + trader e2e stay green.

## Out of Scope

- Refactoring unrelated to the offline-account render path.
- The two sibling strict-mode flakes (`order-parity`, `position-detail`) already hardened in PR #1032.

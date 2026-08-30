# Defect: insights Signal-detail order ticket flakily renders "Record Offline Order" for an offline account

**Recorded**: 2026-08-27
**Severity**: SEV-3
**Impact type**: flaky-e2e-test / possible-ui-misrender (offline-account edge on insights Signal-detail)
**Environment**: CI (E2E shard 2) + local prod-build repro; behavior is on `main-dev`
**Affected service(s)**: xstockstrat-ui (insights Signal-detail order ticket; feature 159 / 083 / 155)
**Config-only fix possible**: no

## Observed

The e2e test `services/xstockstrat-ui/e2e/trader/offline-accounts.spec.ts:257`
(`@AC-1 the insights Signal-detail ticket keeps the broker ticket for an offline account`, feature
159) is **flaky**: it passes on most CI runs but fails intermittently. On the failing runs the
insights Signal-detail page (`/insights/market/AAPL`) renders the **offline "Record Offline Order"**
control instead of the broker **"Place Order"** ticket when the only registered account is an offline
account.

Failure signatures seen:
- `getByRole('heading', { name: 'Place Order' })` never becomes visible (15s/30s timeout) — the
  broker ticket does not render.
- `getByRole('heading', { name: 'Record Offline Order' })` has count `1` when the test expects `0`.

This is **not** caused by feature 161 (surface-signal-weight-decay-config): the failure reproduces
identically with the pre-161 (`origin/main-dev`) `e2e/fixtures/configKeys.ts`, and the
offline-accounts spec reads no config. It was surfaced while getting feature 161's PR (#1032) CI green.

## Expected

Per the test's own `@AC-1` and the code intent, the insights Signal-detail order ticket mounts
`OrderForm` with `allowOfflineRecord={false}`, so it must **always render the broker "Place Order"
ticket** — never the offline record control — even when an offline account is auto-selected.
`toHaveCount(0)` for "Record Offline Order" must hold, and "Place Order" must be visible.

## Reproduction

Deterministic in a local prod-build e2e run (intermittent in CI):

```bash
cd services/xstockstrat-ui
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome \
CI=1 E2E_PREBUILT=1 \
npx playwright test trader/offline-accounts.spec.ts:257 --project=chromium --workers=1 --retries=0
```

The test routes only `[BROKER_ACCOUNT_OFFLINE]`, navigates to `/insights/market/AAPL`, and asserts
the broker ticket. On the failure the Playwright a11y snapshot
(`test-results/…offline-account-chromium/error-context.md`) shows the ticket column rendered:

```
- heading "Trade AAPL" [level=3]
  - heading "Record Offline Order" [level=3]
  - button "Record BUY AAPL"
```

i.e. the offline record control, with no "Place Order" heading present.

## Evidence

The direct wiring looks **correct**, which points at a second mount or a hydration/account-context
race rather than a plain missing prop:

- `services/xstockstrat-ui/src/components/insights/SignalOrderTicket.tsx:22`
  ```tsx
  return <OrderForm mode={mode} initialSymbol={symbol} allowOfflineRecord={false} />;
  ```
- `services/xstockstrat-ui/src/components/trader/OrderForm.tsx:55,60`
  ```tsx
  export function OrderForm({ mode, initialSymbol, allowOfflineRecord = true }: OrderFormProps) {
    // ...
    const isRecordMode = allowOfflineRecord && selectedAccount?.brokerType === BrokerType.OFFLINE;
  ```
  With `allowOfflineRecord={false}`, `isRecordMode` is always `false` for the insights mount — so a
  correctly-propped ticket cannot show "Record Offline Order".

Because the a11y tree nonetheless shows the record control, the likely culprits (to confirm during
the fix) are:
1. The **mobile companion** order-ticket section (`src/components/mobile/SectionRenderer.tsx`, `form`
   kind) mounting `OrderForm` **without** `allowOfflineRecord={false}` (defaulting to `true`), so it
   renders the record control (hidden at desktop but counted by `toHaveCount`, and the only ticket
   that renders on some hydration timings), **and/or**
2. An `AccountContext` auto-select → `OrderForm` re-render race on the Signal-detail page where the
   broker ticket has not mounted yet when the assertion window opens (the test navigates with
   `waitUntil: 'domcontentloaded'` and lets the column "hydrate on its own").

Two sibling strict-mode flakes on the same E2E shard (`order-parity.spec.ts:149`,
`position-detail.spec.ts:224`) were the plain desktop+mobile double-render kind and were hardened in
PR #1032 (commit `17ee74f`, `.filter({ visible: true })`). This offline-account one is left untouched
there because it is a real render/timing question in feature-159/insights code, not a locator issue —
masking it (e.g. asserting on only the visible copy) would hide a genuine offline-account edge.

## Suggested fix direction (for triage, not prescriptive)

- Confirm whether the **mobile** Signal-detail ticket passes `allowOfflineRecord={false}` like the
  desktop `SignalOrderTicket` does; if not, thread the same prop through the mobile `form` section so
  both mounts agree. This is the most likely one-line product fix and would make the test pass
  honestly.
- If instead the failure is purely the hydration/auto-select race, stabilize the ticket mount (or the
  test's readiness wait on a settled ticket) so the broker ticket is reliably present before the
  assertion — without weakening the `Record Offline Order` count-0 guarantee.

## Notes

- Feature 161 PR #1032 is green (the flake cleared on a re-run); this report exists so the flake is
  tracked and fixed rather than relied upon to keep passing.

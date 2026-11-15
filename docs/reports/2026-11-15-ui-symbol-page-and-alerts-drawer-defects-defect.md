# Defect: Symbol page and alerts drawer UI defects (fundamentals overflow, symbol-labelled chip, empty drawer, switch renders off)

**Recorded**: 2026-11-15
**Severity**: SEV-3
**Impact type**: ui-display-incorrect
**Environment**: staging (homelab, main-dev)
**Affected service(s)**: xstockstrat-ui
**Config-only fix possible**: no

## Observed

Four operator-reported defects on the trader segment at mobile width (staging, symbol LYFT):

1. **Fundamentals card overflow** — Research tab. Market cap renders at full precision
   (`$6,726,553,623.93`) and overprints the neighbouring P/E cell; the column divider breaks.
2. **Symbol-labelled chip** — Research tab opportunity chip row lists the three strategies plus a
   chip labelled `LYFT`, which reads as a strategy named after the ticker. It is the strategy-less
   opportunity row (`source: fundamentals`, empty `strategy_id`).
3. **Alerts drawer always empty** — header bell badge shows `1` unread; the drawer it opens shows
   "No alerts" on every load, including after a hard reload. The Notifications page lists the alert.
   The badge also never refreshes after mark-read.
4. **Switch renders unchecked while checked** — Push notifications card shows the switch in the off
   position beside "Enabled on this device." / "You'll receive alerts on this device."

## Expected

1. Fundamentals values never overflow or overlap at any viewport width. Operator decision
   (2026-11-15): full redesign of the card, consistent with the rest of the symbol page;
   abbreviation of large values is acceptable; the same guard applies to the page's other stat grids.
2. A strategy-less opportunity chip is labelled from the row's source (e.g. `Fundamentals`), never
   the ticker.
3. The drawer shows unread stored alerts plus live ones, offers mark-read, and the badge refreshes
   on mark-read and on a newly streamed alert. Badge, drawer and Notifications page agree.
4. A checked switch renders checked everywhere the shared component is used.

## Reproduction

1. Staging, mobile viewport, trader segment, open the symbol page for LYFT.
2. Research tab: observe the Fundamentals grid and the trailing `LYFT` chip.
3. With one unread stored alert and no alert emitted since page load, tap the header bell.
4. Open `/accounts/notifications` with push enabled on the device; observe the switch.

## Evidence

`services/xstockstrat-ui/src/app/trader/positions/[symbol]/page.tsx:1087`
> { label: 'Market cap', value: fmtUsd(f.marketCap) },

`services/xstockstrat-ui/src/app/trader/positions/[symbol]/page.tsx:1120`
> <div className="grid grid-cols-2 overflow-hidden rounded-md border border-border sm:grid-cols-4">

`services/xstockstrat-ui/src/app/trader/positions/[symbol]/page.tsx:444`
> label: o.strategyId || o.symbol,

`services/xstockstrat-ui/src/components/trader/AlertStream.tsx:19-46`
> notifyClient.listAlerts({ limit: 1 }) feeds the badge only; the drawer list is filled solely by
> notifyClient.streamAlerts(...), which replays no stored alerts.

`services/xstockstrat-ui/src/components/ui/switch.tsx:20`
> data-checked:border-primary data-checked:bg-primary data-unchecked:border-transparent

Staging `ListOpportunities` (2026-11-15) returns a LYFT row with `strategy_id: ""`,
`source: "fundamentals"`, `opportunity_key: "<user>|LYFT|"`.

## Root cause hypothesis

(1) `fmtUsd` has no compact form and the grid tiles have no min-width/truncation guard. (2) The chip
label falls back to the symbol when `strategyId` is empty. (3) Badge reads persisted `ListAlerts`
unread count once; drawer reads only the live `StreamAlerts` stream. (4) `switch.tsx` wraps the
Radix primitive but styles Base-UI `data-checked`/`data-unchecked` attributes Radix never sets
(read from code, not run).

## Confidence

high

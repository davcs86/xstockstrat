# Product Spec: fix-symbol-page-alerts-ui

**Type**: bug
**GitHub Issue**: n/a (Issues disabled) — report `docs/reports/2026-11-15-ui-symbol-page-and-alerts-drawer-defects-defect.md`
**Severity**: SEV-3
**Created**: 2026-11-15

---

## Problem Statement

A **trader** using the trader segment on a phone (staging, symbol LYFT) hits four display defects
that make the symbol page and the alert bell misleading:

1. **Fundamentals card overflow** (symbol page → Research). Market cap renders at full precision
   (`$6,726,553,623.93`) and overprints the P/E cell at mobile width.
2. **Symbol-labelled chip** (symbol page → Research). The strategy-less opportunity row
   (`source: fundamentals`, empty `strategy_id`) is labelled `LYFT`, which reads as a strategy named
   after the ticker.
3. **Alerts drawer always empty** (global header). The badge shows the stored unread count; the
   drawer shows only alerts streamed since page load, so it says "No alerts" beside a badge of `1`,
   and the badge never refreshes.
4. **Switch renders unchecked while checked** (shared `ui/switch.tsx`; seen on the Push
   notifications card).

Operator decisions (2026-11-15) fix the expected behavior; they are stated as FR-1..FR-9 below.

## Reproduction Steps

1. Staging, mobile viewport, trader segment, symbol page for LYFT → Research tab: observe the
   Fundamentals grid and the trailing `LYFT` chip.
2. With one unread stored alert and none emitted since page load, tap the header bell.
3. Open `/accounts/notifications` with push enabled on the device; observe the switch.

## Root Cause Hypothesis

(1) `fmtUsd` has no compact form (market cap value at
`src/app/trader/positions/[symbol]/page.tsx:1089`); the `grid-cols-2` tiles have no
min-width/truncation guard (Fundamentals grid at `:1120`; the page's other stat grids are at
`:842,901`). (2) `label: o.strategyId || o.symbol` (`page.tsx:444`). (3) Badge = one-shot
`ListAlerts({limit:1}).unreadCount`; drawer = `StreamAlerts` only
(`src/components/trader/AlertStream.tsx:19-46`). (4) `switch.tsx` wraps the Radix primitive but
styles `data-checked`/`data-unchecked`, which Radix never sets (read from code, not run).

## Functional Requirements

Symbol page (Research tab and stat grids):

- **FR-1** — In the Fundamentals card, every value is drawn wholly inside its own tile: no value
  overlaps or overprints a neighbouring tile and no tile divider is broken, at viewport widths from
  384px upward, for a market cap of at least 13 integer digits.
- **FR-2** — The Fundamentals card is redesigned to use the same stat-tile presentation (label above
  value, same tile grid) as the symbol page's other stat grids. Large values may be abbreviated
  (e.g. `$6.73B`); abbreviation is permitted, not required, and FR-1 holds either way.
- **FR-3** — The symbol page's other stat grids (the position stats grid and the position-risk
  grid) meet the same guard as FR-1: a value of any length stays inside its own tile at 384px width.
- **FR-4** — An opportunity chip whose row has an empty strategy id is labelled from the row's
  source in human-readable form (`fundamentals` → `Fundamentals`). No chip is ever labelled with the
  ticker. If the source is also empty the chip shows a fixed neutral placeholder (wording fixed in
  design), still never the ticker. Rows with a strategy id keep the strategy id as the label.

Alerts drawer and bell badge (global header):

- **FR-5** — On open, the drawer lists the calling user's **unread** alerts only: stored unread
  alerts plus alerts streamed since page load, newest first, each alert once. Read alerts are not
  listed. With no unread alert it shows "No alerts".
- **FR-6** — Each alert in the drawer has a mark-read action. Marking an alert read persists the
  read state (it is also read on the Notifications page) and removes it from the drawer.
- **FR-7** — The bell badge equals the user's unread count and updates without a page reload when
  an alert is marked read (decrements; hidden at zero) and when an alert is streamed (increments).
- **FR-8** — Badge, drawer and Notifications page agree: the badge number equals the number of
  alerts the drawer lists and the number of unread alerts on the Notifications page.

Shared switch:

- **FR-9** — The shared switch component is displayed in its on state whenever it is checked and in
  its off state whenever it is unchecked, on every page that uses it (Push notifications card,
  Config-UI fundamentals scan, Insights signal sources).
  All three pages render the one shared component, so the scenarios exercise it on the Push
  notifications card only.

## Consumer Surface(s)

_Constitution **C-14**._

- [x] **UI** — `xstockstrat-ui`:
  - trader symbol page `/trader/positions/<symbol>` — Research tab Fundamentals card (redesign,
    FR-1/FR-2), opportunity chip row (FR-4), and the page's other stat grids (FR-3)
  - global header — Alerts drawer contents and mark-read action (FR-5/FR-6), bell badge (FR-7/FR-8)
  - `/accounts/notifications` — Push notifications switch (FR-9); the same shared switch on
    `/config-ui/fundamentals-scan` and `/insights/signal-sources`
- [ ] **Agent** — no Agent tool is affected: no RPC, response field or stored state changes; alerts
  read state is already written by the existing `MarkAlertRead` RPC
- [ ] **None**

## Affected Services

- `xstockstrat-ui`

## Fix Scope

- [x] No proto changes — the drawer uses existing `notify.v1` RPCs: `ListAlerts` (`unread_only`,
  `unread_count`), `StreamAlerts` and `MarkAlertRead` (all present since feature 203)
- [x] No database migrations
- [x] No config key changes

The fix is confined to `xstockstrat-ui` (pages, components, and BFF route registration if the drawer's
segment does not already expose `MarkAlertRead`).

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev.

## Out of Scope

- The values and units of the fundamentals themselves (ROE unit is peer feature
  `fix-fundamentals-roe-unit`); this feature changes presentation only
- Any change to what the other stat tiles show or compute beyond the FR-3 overflow guard
- An alert detail page, links from drawer rows to it, and read-on-open behavior (peer feature
  `alert-detail-page`, which builds on this drawer and should land after it)
- A "mark all read" action, and any change to the Notifications page list beyond staying in
  agreement with the badge (FR-8)
- Changes to notify `ListAlerts` / `StreamAlerts` / `MarkAlertRead` behavior or contracts
- Indicator pane, chart series colors and the Backtests card on the same page (peer features
  `fix-indicator-pane-warmup`, `chart-series-palette`, `backtest-inline-backfill`)
- Restyling the switch beyond making its checked/unchecked rendering correct

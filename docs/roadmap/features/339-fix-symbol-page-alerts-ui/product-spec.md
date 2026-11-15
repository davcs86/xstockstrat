# Product Spec: fix-symbol-page-alerts-ui

**Type**: bug
**GitHub Issue**: n/a (Issues disabled) — report `docs/reports/2026-11-15-ui-symbol-page-and-alerts-drawer-defects-defect.md`
**Severity**: SEV-3
**Created**: 2026-11-15

---

## Problem Statement

1. **Fundamentals card overflow** (symbol page → Research). Market cap renders at full precision
   (`$6,726,553,623.93`) and overprints the P/E cell at mobile width. Expected (operator decision
   2026-11-15): a full redesign of the card consistent with the rest of the symbol page; abbreviating
   large values is acceptable; the page's other stat grids get the same overflow guard.
2. **Symbol-labelled chip** (symbol page → Research). The strategy-less opportunity row
   (`source: fundamentals`, empty `strategy_id`) is labelled `LYFT`. Expected: label derived from the
   row's source (e.g. `Fundamentals`), never the ticker.
3. **Alerts drawer always empty** (global header). Badge shows the stored unread count; the drawer
   shows only alerts streamed since page load. Expected: unread stored alerts plus live ones, a
   mark-read action in the drawer, and a badge that refreshes on mark-read and on a streamed alert.
4. **Switch renders unchecked while checked** (shared `ui/switch.tsx`; seen on the Push
   notifications card). Expected: a checked switch renders checked wherever the component is used.

## Reproduction Steps

1. Staging, mobile viewport, trader segment, symbol page for LYFT → Research tab: observe the
   Fundamentals grid and the trailing `LYFT` chip.
2. With one unread stored alert and none emitted since page load, tap the header bell.
3. Open `/accounts/notifications` with push enabled on the device; observe the switch.

## Root Cause Hypothesis

(1) `fmtUsd` has no compact form; the `grid-cols-2` tiles have no min-width/truncation guard
(`src/app/trader/positions/[symbol]/page.tsx:1087,1120`). (2) `label: o.strategyId || o.symbol`
(`page.tsx:444`). (3) Badge = one-shot `ListAlerts({limit:1}).unreadCount`; drawer = `StreamAlerts`
only (`src/components/trader/AlertStream.tsx:19-46`). (4) `switch.tsx` wraps the Radix primitive but
styles `data-checked`/`data-unchecked`, which Radix never sets (read from code, not run).

## Affected Services

- `xstockstrat-ui`

## Fix Scope

- [ ] No proto changes anticipated
- [ ] No database migrations anticipated
- [ ] No config key changes anticipated

(Update after investigation — remove or replace each item as needed)

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev.

## Out of Scope

- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix

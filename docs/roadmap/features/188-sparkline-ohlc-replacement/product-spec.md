# Product Spec: sparkline-ohlc-replacement

**Created**: 2026-09-11

---

## Problem Statement

The sparkline bar chart on the Opportunities List and Single Opportunity (symbol detail) pages
occupies visual space but conveys limited actionable information — it shows only a 20-bar relative
close trend with no absolute price reference. Replacing it with the previous trading day's OHLC
(Open, High, Low, Close) values alongside the date gives the operator an immediate, concrete price
context for each symbol without an extra click or a separate chart lookup.

## User Story

As a trader reviewing the opportunity queue, I want to see yesterday's OHLC price data next to the
date instead of a sparkline chart, so that I can assess the symbol's recent price range at a glance
without navigating to a separate chart.

## Functional Requirements

FR-1. On the **Opportunities List** page (`/insights/opportunities`), replace the `<Sparkline>`
component in each `OpportunityRow` with a compact text block showing: the previous trading
day's date and its Open, High, Low, Close values, formatted as USD.

FR-2. On the **Single Opportunity** (symbol detail) page (`/trader/positions/[symbol]`), replace the
header `<Sparkline>` component with the same OHLC + date text block.

FR-3. The OHLC data MUST come from the **most recent completed daily bar** already fetched by the
existing `useSparklines` hook (which calls `getBars` with `TIMEFRAME_1DAY`). No new RPC, no
new hook, no additional network request — the bar data is already in the response (`Bar.open`,
`Bar.high`, `Bar.low`, `Bar.close`, `Bar.time`). The hook's return type changes from
`SparklinePoint[]` (close-only) to the full `Bar` (or a subset carrying OHLC + time).

FR-4. When the bar data is unavailable (loading, errored, or no bars returned), the OHLC block
must be absent — the same progressive-enhancement behavior the sparkline had.

FR-5. The `Sparkline` component (`src/components/shared/Sparkline.tsx`) and the
`SparklinePoint`-specific mapping in `useSparklines` may be removed if no other consumer
references them after this change. (Check `FormulaRunResult.tsx` — it also imports `Sparkline`.)

FR-6. On the **mobile companion** (`SectionRenderer.tsx`), the `signalGroup` card for each symbol
MUST display the previous day's OHLC block underneath the symbol name in the card header, using
the shared `OhlcBlock` component. The `signalGroup` section type carries an optional `ohlcData`
field; when present, the block renders; when absent, it is omitted (same progressive-absence
behavior as the desktop row).

## Out of Scope

- Intraday OHLC or multi-day OHLC display — only the single most recent daily bar.
- Replacing charts or sparklines on any other page (e.g. `FormulaRunResult`, `ChartPanel`).
- Adding new backend RPCs or proto messages.
- Mobile companion changes beyond the `signalGroup` card header OHLC (e.g. mobile-specific chart panels).

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-ui` — replace `<Sparkline>` rendering with OHLC text on two pages; refactor
  `useSparklines` hook return type to expose full bar data instead of close-only `SparklinePoint`.

## Consumer Surface(s)

_Constitution **C-14**._ The end-user-reachable surface(s) this capability is consumed through.

- [x] **UI** — `xstockstrat-ui` segment(s): `/insights` (Opportunities List page) and `/trader`
  (Single Opportunity / symbol detail page) — replacing a sparkline visual with OHLC text.
- [ ] **Agent** — no agent tool changes.
- [ ] **None**

## Proto Contract Changes

- [x] No proto changes required

The existing `Bar` message (`marketdata/v1/marketdata.proto`) already carries `open`, `high`,
`low`, `close`, and `time`. The existing `getBars` RPC already returns these fields. Only the
UI-side mapping (which currently discards everything except `close`) changes.

## Config Key Changes

- [x] No new config keys

## Database Changes

- [x] No schema changes

## Feature Workflow Notes

Branch to create: `feature/sparkline-ohlc-replacement` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking proto or config change)
- [ ] 2 service owners + platform lead (breaking proto change)
- [ ] DBA review + service owner (schema migration)

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

- [ ] **FR-5 — Sparkline component retention.** `FormulaRunResult.tsx` imports `Sparkline`. Confirm
  at implementation time whether it is the only remaining consumer; if so, remove the component
  and the `SparklinePoint` mapping; if not, keep it and only remove the two call sites.
- [ ] **Known trap (ledger `fails.md:1463`).** Feature 146 documented that canvas-rendered chart
  libraries reject `oklch()` color tokens. This change removes the sparkline (a DOM-rendered
  component, not canvas) and replaces it with plain text, so the oklch trap does not apply —
  but verify that no canvas path is introduced.

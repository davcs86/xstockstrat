# Product Spec: chart-series-palette

**Created**: 2026-11-15

---

## Problem Statement

On the symbol page indicator chart every series renders the same off-white (staging theme): the color index restarts per indicator, so each single-series indicator gets `--chart-1`, and the staging `--chart-1..5` tokens are near-identical grays frozen by feature 307. A trader cannot tell series apart or match a legend entry to its line.

## User Story

As a trader, I want each indicator series drawn in its own clearly distinguishable color, so that I can read a multi-indicator chart and match every legend entry to its line.

## Functional Requirements

FR-1. A dedicated categorical series palette of **12** color tokens exists in both the staging and production themes, separate from `--chart-1`…`--chart-5` (whose frozen staging values are not changed).
FR-2. Indicator chart series take colors from that palette by their position across the **whole chart** (all components of the indicator set), so no two series in a chart of ≤12 series share a color. Position order is the component order of the indicator set, then the series order within each component; two series of one indicator therefore get different colors.
FR-3. Each legend swatch uses the same color as its series line.
FR-4. Every palette color has a contrast ratio of at least 3:1 against the chart surface in each theme — the `--card` token (the chart canvas is transparent inside a card), and also `--background`, matching the chart-series pairs of the contrast baseline in `docs/patterns/ui-ux-governance.md` §5 — and the palette stays distinguishable: under deuteranopia and protanopia simulation each adjacent pair (including entry 12 with entry 1) differs by a CIEDE2000 distance of at least 10 and every other pair by at least 5; under normal vision every pair differs by at least 10.
FR-5. A chart with more than 12 series reuses palette colors in order, starting again from the first. Known limitation: series 13 and beyond share a color with an earlier series, so color alone does not tell those pairs apart; no second differentiator is added.

## Out of Scope

- Changing the frozen `--chart-1`…`--chart-5` values or the feature 307 theme-freeze rule
- Recoloring non-indicator charts (price candles, equity curves, insights charts)
- A user-configurable palette
- A second differentiator (dash style, markers) for charts with more than 12 series

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-ui` — theme tokens, indicator chart series coloring, legend

## Consumer Surface(s)

_Constitution **C-14**._

- [x] **UI** — `xstockstrat-ui` segment `/trader`: symbol page (`/trader/positions/[symbol]`) Overview indicator chart and Indicators legend — existing route, no new nav entry
- [ ] **Agent**
- [ ] **None**

## Proto Contract Changes

- [x] No proto changes required

## Config Key Changes

- [x] No new config keys

## Database Changes

- [x] No schema changes

## Feature Workflow Notes

Branch to create: `feature/chart-series-palette` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking proto or config change)
- [ ] 2 service owners + platform lead (breaking proto change)
- [ ] DBA review + service owner (schema migration)

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

- [x] Token naming and how the 12 tokens are registered in the `themes.test.ts` / `checkThemeBundle` pins — **deferred to design**. Binding here: the tokens are new names (not `--chart-N`), and AC-1, AC-4 and AC-5 are asserted by a theme test in both themes.
- [x] Shared vs per-theme values — **decided**: each theme defines its own 12 values and each theme's set must meet FR-4 on that theme's `--card` and `--background`; the staging surface is the binding contrast case. Design may give both themes the same values if one set passes in both.
- [x] Dash style beyond 12 series — **decided: no**. The operator did not ask for it; FR-5 cycles colors only and records the limitation (see Out of Scope).
- Known trap (ledger, 2026-11-10 `ui-env-themed-bundles`, and `docs/patterns/ui-ux-governance.md:263`): staging chart token values are frozen and pinned by tests; any hardcoded color within ±1 sRGB of a theme token fails the build. Operator decision 2026-11-15: add a separate series set rather than unfreeze.

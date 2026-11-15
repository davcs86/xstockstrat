# Product Spec: chart-series-palette

**Created**: 2026-11-15

---

## Problem Statement

On the symbol page indicator chart every series renders the same off-white (staging theme): the color index restarts per indicator, so each single-series indicator gets `--chart-1`, and the staging `--chart-1..5` tokens are near-identical grays frozen by feature 307. A trader cannot tell series apart or match a legend entry to its line.

## User Story

As a trader, I want each indicator series drawn in its own clearly distinguishable color, so that I can read a multi-indicator chart and match every legend entry to its line.

## Functional Requirements

FR-1. A dedicated categorical series palette of **12** color tokens exists in both the staging and production themes, separate from `--chart-1`…`--chart-5` (whose frozen staging values are not changed).
FR-2. Indicator chart series take colors from that palette by their position across the **whole chart** (all components of the indicator set), so no two series in a chart of ≤12 series share a color.
FR-3. Each legend swatch uses the same color as its series line.
FR-4. Every palette color has a contrast ratio of at least 3:1 against the chart surface in each theme, and adjacent palette entries remain distinguishable under deuteranopia and protanopia simulation.
FR-5. A chart with more than 12 series reuses palette colors in order, starting again from the first.

## Out of Scope

- Changing the frozen `--chart-1`…`--chart-5` values or the feature 307 theme-freeze rule
- Recoloring non-indicator charts (price candles, equity curves, insights charts)
- A user-configurable palette

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

- [ ] Token naming and whether the 12 tokens are registered in `themes.test.ts` / `checkThemeBundle` pins (design).
- [ ] Whether the two themes share one set of 12 values or carry per-theme values; the staging chart surface is the binding contrast case (design).
- [ ] FR-5 only cycles colors; whether a second differentiator (dash style) is wanted beyond 12 series — operator did not ask for it.
- Known trap (ledger, 2026-11-10 `ui-env-themed-bundles`, and `docs/patterns/ui-ux-governance.md:263`): staging chart token values are frozen and pinned by tests; any hardcoded color within ±1 sRGB of a theme token fails the build. Operator decision 2026-11-15: add a separate series set rather than unfreeze.

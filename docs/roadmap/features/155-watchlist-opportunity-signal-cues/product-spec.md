# Product Spec: watchlist-opportunity-signal-cues

**Created**: 2026-08-25

---

## Problem Statement

Traders scanning the Watchlists readiness panel and the Opportunities queue cannot tell the important
states apart at a glance: "firing"/ready vs "watching"/"N away" and the "in queue" marker read as
plain text with only subtle bar coloring and no icons. The mobile Opportunities view also diverges
from desktop (flat list, missing tags), one back-navigation lands on the wrong home, and the source/
action filters feel unresponsive. This slows the scan-to-act loop these pages exist for.

## User Story

As a trader scanning watchlists and opportunities, I want firing/ready and in-queue states clearly
distinguishable with consistent color + icon codes, and the small navigation/mobile/filter rough
edges fixed, so that I can spot and act on the strongest signals faster.

## Functional Requirements

FR-1. **Consistent color + icon coding for readiness/queue state.** The Watchlists readiness panel
(`WatchlistReadiness.tsx`) and the Opportunities desktop cards + mobile view render each state with a
consistent icon paired with its existing semantic color: **firing/ready** (all conditions pass),
**watching / "N away"** (some pass), **quiet** (none pass), **no-data / not-evaluated**, and the
**in-queue** marker. The color↔state↔icon mapping is defined once and reused across all surfaces
(DRY guard rail) rather than re-derived per component.

FR-2. **"Firing" watchlist row jump-to-detail action.** A firing readiness row in the Watchlists
panel gains an action that navigates directly to that symbol's order/position detail page
(`/trader/positions/<symbol>`, carrying `?strategy=<boundStrategyId>` when the row is bound), matching
where the Opportunities "Review & add" button already sends the user. Non-firing rows do not show it.

FR-3. **Opportunities-origin breadcrumb.** When the position-detail page
(`/trader/positions/[symbol]`) is reached from the Opportunities queue, its breadcrumb's first crumb
returns to the Opportunities queue (`/insights/opportunities`) instead of Book → Exposure
(`/trader/positions`). When reached from Exposure (or any non-Opportunities origin) the breadcrumb is
unchanged.

FR-4. **Mobile Opportunities parity with desktop.** The mobile Opportunities view groups signals by
symbol (one card per symbol with its signals beneath, mirroring the desktop `SymbolGroupCard`) and
surfaces the tags the desktop rows show and mobile currently omits: strategy id, provenance/source
chips, and expiry — in addition to the existing conviction and readiness meters and the muted marker.

FR-5. **Opportunities filter tags responsiveness.** The source ("All sources" + per-source pills) and
action filters on the Opportunities page reliably reflect and apply the current selection — no stuck/
stale visual state or filtered result that lags the selection. (Investigation item: confirm the
defect and its root cause before changing behavior; if no defect is found, record that finding.)

## Out of Scope

- Any backend/analysis/proto change — this is a presentation + client-navigation feature only. The
  readiness/opportunity/queue data and its computation are unchanged.
- Redefining what "firing", "in queue", "conviction", or "readiness" mean (see the prior answer in
  `context.md`) — only their visual encoding and the navigation around them change.
- Colorblind-mode theming beyond pairing an icon with each already-defined semantic color.
- Changes to the Watchlists roll-up counts logic (`readinessRollup.ts`) — only how a row/state is
  rendered.

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-ui` — all changes live here (Watchlists `/insights` segment, Opportunities `/insights`
  segment, position-detail `/trader` segment). No other service is touched.

## Consumer Surface(s)

_Constitution **C-14**._

- [x] **UI** — `xstockstrat-ui` segment(s): `/insights` (Watchlists readiness panel + Opportunities
  page, desktop and mobile) and `/trader` (position-detail breadcrumb). All surfaces are existing,
  already nav-registered pages (`/insights/opportunities`, `/insights/watchlists`,
  `/trader/positions`); this feature changes rendering and one in-page link/breadcrumb, adds **no new
  route**, so no `PLATFORM_SUBNAV`/`NAV_GROUPS` entry is required. Nav-reachability of the touched
  pages is unchanged.
- [ ] **Agent** — no MCP tool change.
- [ ] **None**

## Proto Contract Changes

- [x] No proto changes required

## Config Key Changes

- [x] No new config keys

## Database Changes

- [x] No schema changes

## Feature Workflow Notes

Branch to create: `feature/watchlist-opportunity-signal-cues` (branch from `main-dev`).
> Harness note: this session develops on the assigned `claude/watchlists-firing-queue-labels-w33an5`
> branch (branched from and PR'd into `main-dev`), per the session's branch directive, rather than a
> separate `feature/*` branch. Recorded in `context.md`.

Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] None beyond standard 1 service-owner (`xstockstrat-ui`) review — no proto, config, or schema change.

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

- [ ] **Icon set / exact glyphs (FR-1).** The app already uses `@phosphor-icons/react`
  (`SectionRenderer.tsx`, `navGroups.tsx`). Design phase to pick the specific glyph per state
  (e.g. firing = a filled lightning/flame, watching = a half/eye, quiet = a dot, in-queue = a
  stack/queue glyph) and confirm placement (leading the label vs. inside the badge). Icon-only must
  never be the *sole* differentiator — always icon **+** color **+** text.
- [ ] **Known trap (Ledger fails.md 2026-07-01, breadcrumb primitive):** FR-3 touches the
  position-detail `PageBreadcrumb`. Wiring/branching a `Breadcrumb` has previously collided with
  `getByRole`/`getByLabel` e2e locators on the same page (`BreadcrumbPage` `role="link"`, lowercase
  `aria-label="breadcrumb"`). Design/spec must grep the e2e suite for locators on the position-detail
  page and run a broader `-g` scope before marking the step done.
- [ ] **FR-5 root cause.** Whether the "stale filter tags" is a real state-management bug (e.g. the
  `sources` list recomputed from filtered vs. unfiltered `opportunities`, a `ToggleGroup` controlled/
  uncontrolled mismatch, or a query key not invalidating) or a perception issue must be confirmed in
  the design/recon phase before deciding the fix.

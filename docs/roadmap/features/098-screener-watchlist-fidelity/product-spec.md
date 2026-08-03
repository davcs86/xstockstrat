# Product Spec: screener-watchlist-fidelity

**Created**: 2026-08-02

---

## Problem Statement

Feature 083's UI revamp shipped the Screener and Watchlists pages at low fidelity relative to the
"Nocturne" design handoff: the Screener exposes no criterion **weight** control (the field is sent
hardcoded to `1`), no hard/rank toggle affordance, no "Save as watchlist"/"Add top-N" path off the
results, and no last-run metadata; the Watchlists page is a flat stack of CRUD cards with no
master-detail layout, no per-list readiness roll-ups, and no "Build from screener" affordance. All of
these gaps can be closed with data **already returned by existing RPCs** — nothing new is needed from
the backend. The only genuinely missing inputs (live LAST price, intraday CHG %, a Quotes tab) require
a streaming quote feed the platform does not yet expose and are split to a separate backlog feature.

## User Story

As a trader using the Discover section, I want the Screener and Watchlists pages to match the
high-fidelity design — weighting my screen criteria, saving candidates straight into a watchlist, and
seeing at a glance how ready each watchlist name is to fire — so that I can go from screening to a
curated, signal-ranked watchlist without leaving the page or hand-copying symbols.

## Functional Requirements

### Screener (`/insights/screener`)

FR-1. **Criterion weight control.** Each criterion row exposes an editable `weight` (slider or numeric
input, 0–1) bound to the already-existing `ScreenCriterion.weight` field, which is currently hardcoded
to `1`. Display the criteria's normalized weight share ("weights normalize to 1.0") so the trader sees
each criterion's relative contribution. Normalization is display-only; raw weights are sent on the wire
(the analysis scorer normalizes server-side).

FR-2. **Hard/rank toggle.** Replace the bare "hard" checkbox with an explicit hard/rank toggle bound to
the existing `ScreenCriterion.hard_filter` field, matching the design grammar (hard = excludes on
fail; rank = contributes to score only).

FR-3. **Criterion display grammar.** Render each criterion in the design's readable form
(`<metric> <comparator> <threshold>`, e.g. `rsi_14 ≤ 70`) with the weight beneath it, rather than raw
side-by-side inputs, while keeping all fields editable.

FR-4. **Last-run metadata.** After a scan completes, show "last run <relative time> · <N> symbols"
derived client-side from the scan's completion time and the request's symbol count.

FR-5. **Save as watchlist.** A "Save as watchlist" action creates a new watchlist (portfolio
`CreateWatchlist`) seeded with the current result symbols (or the passing subset — see Open Questions),
prompting for a name. Reuses existing watchlist hooks.

FR-6. **Add top-N to watchlist.** An "Add top N to watchlist" action adds the top-ranked N result
symbols to an existing watchlist (portfolio `AddWatchlistSymbols`), N being the design's default of 5
(or all, when fewer than N results). Target watchlist chosen from the user's existing lists.

FR-7. **Score visual.** Render the `score` column with the design's colored strength dot/scale (reusing
existing score-display helpers) rather than plain numerals.

### Watchlists (`/insights/watchlists`)

FR-8. **Master-detail layout.** Replace the flat stack of watchlist cards with a master list (left) +
selected-watchlist detail (right/below on mobile). The master shows each list's name and symbol count;
the detail shows the selected list's symbols and readiness table. CRUD (create, rename, delete, add/
remove symbols) is preserved.

FR-9. **Readiness roll-up.** For the selected watchlist, once a strategy is chosen (see Open Questions —
readiness is strategy-scoped, never a fabricated per-symbol binding), show a "<N> ready · <N> watching ·
<N> quiet" summary derived from `EvaluateReadiness` condition states (ready = all conditions pass,
watching = some pass, quiet = none pass), and a per-symbol readiness row (readiness bar + firing/N-away +
blocking condition) — folding in / extending the existing `WatchlistReadiness` component.

FR-10. **Evaluated-strategy display.** The readiness view shows which strategy the list was evaluated
against, as a single "Evaluated against: `<strategy>`" caption above the rows (**not** a per-row STRATEGY
column). _Design decision 2026-08-02: readiness is strategy-scoped (one strategy for the whole list), so
a per-row column would repeat one name on every row and visually re-imply the per-symbol signal→strategy
binding feature 083 forbids; the caption is the honest form. Supersedes the literal "per-row STRATEGY
column" reading of the handoff._

FR-11. **"In queue" indicator.** A watchlist symbol that is currently a live opportunity (present in
analysis `ListOpportunities` for the user) is marked accordingly ("in queue"), derived from the existing
opportunity query — no new RPC.

FR-12. **Build from screener.** A "Build from screener" affordance links from Watchlists to the Screener
(cross-segment link within `/insights`), closing the design's screener→watchlist loop together with FR-5/
FR-6.

## Out of Scope

- **Live LAST price column, intraday CHG % column, and the Quotes tab** on Watchlists — these require a
  streaming/realtime quote feed the platform does not expose today. **Deferred to a named backlog
  follow-up feature: `099-watchlist-live-quotes`** (created alongside this spec; C-14 override recorded
  in `context.md`).
- A **predefined screener universe** picker ("S&P 500 · liquidity > $50M ADV" in the handoff). No
  universe/constituent table exists; free-text symbol entry is retained. Introducing a universe source
  is a separate backend feature, not in scope here.
- Any change to the analysis scoring math, screener engine, or portfolio watchlist storage — this
  feature is presentation + existing-RPC wiring only.
- The Copilot rail, mobile `SectionRenderer` parity beyond what the shared components already provide,
  and any other feature-083 screen besides Screener and Watchlists.

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-ui` — the only service changed. All work is in the `/insights` segment
  (`src/app/insights/screener/`, `src/app/insights/watchlists/`, related hooks/components). Consumes
  **already-existing** RPCs on `xstockstrat-analysis` (`ScreenSymbols`, `EvaluateReadiness`,
  `ListOpportunities`, `GetStrategyDefinitions`) and `xstockstrat-portfolio` (`CreateWatchlist`,
  `AddWatchlistSymbols`, `ListWatchlists`) via the existing `insightsBff` routers — no backend change.

## Consumer Surface(s)

_Constitution **C-14**._

- [x] **UI** — `xstockstrat-ui` segment `/insights`: the existing **Screener** (`/insights/screener`)
  and **Watchlists** (`/insights/watchlists`) pages are upgraded in place. Both routes are already
  registered in the shared nav (Discover group) per C-10(a); this feature adds no new route, so nav
  reachability is unchanged — but the new "Build from screener" / "Save as watchlist" cross-links are
  verified to resolve.
- [ ] **Agent** — no MCP tool change.
- [ ] **None**.

## Proto Contract Changes

- [x] No proto changes required. Every field consumed already exists: `ScreenCriterion.weight` (field 8),
  `ScreenCriterion.hard_filter` (field 9), `ScreenResult.score`, `SymbolReadiness`/`ConditionEval`,
  `Opportunity.symbol`, `Watchlist.*`.

## Config Key Changes

- [x] No new config keys.

## Database Changes

- [x] No schema changes. Watchlists persist via existing portfolio watchlist tables (feature 058); no
  new table or column.

## Feature Workflow Notes

Branch to create: `feature/screener-watchlist-fidelity` (branch from `main-dev`).

_Harness note: this session's designated working branch is `claude/ui-revamp-low-fidelity-ii5p1h`
(harness-assigned), and the repo's live default branch is `main` (no `main-dev` exists in this
checkout). Work lands on the designated branch and the PR targets `main`._

Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (`xstockstrat-ui`) — UI-only, no proto/config/migration.
- [ ] 2 service owners + platform lead (breaking proto change) — N/A.
- [ ] DBA review + service owner (schema migration) — N/A.

## Acceptance Criteria

1. On the Screener, each criterion has an editable weight bound to `ScreenCriterion.weight`; the value
   is sent on the wire (not hardcoded `1`), and the UI shows each criterion's normalized weight share.
2. On the Screener, the hard/rank toggle sets `ScreenCriterion.hard_filter`; toggling changes the sent
   request.
3. After a scan, the Screener shows "last run <relative time> · <N> symbols".
4. "Save as watchlist" creates a watchlist seeded with result symbols and it appears on the Watchlists
   page; "Add top N to watchlist" adds the top-N symbols to a chosen existing list.
5. The Watchlists page renders a master-detail layout; selecting a list shows its detail; all existing
   CRUD still works.
6. With a strategy selected, the selected watchlist shows a "<N> ready · <N> watching · <N> quiet
   [· <N> no-data]" roll-up whose counts sum to the **requested symbol count** (an un-evaluable symbol
   buckets as `no-data`, never `quiet`) and are derived from a single `EvaluateReadiness` result; the
   view shows the evaluated strategy as one caption (not a per-row column) and each row shows its
   blocking condition; no per-symbol strategy is fabricated.
7. A watchlist symbol present in `ListOpportunities` is marked "in queue".
8. No LAST/CHG/Quotes UI is present (deferred); a Playwright e2e asserts the derivable surfaces above
   against the mock backend, and the mock is extended only with **already-defined** RPC fields.
9. `pnpm build`, `pnpm lint`, `pnpm test:unit`, and the `/insights` Playwright specs pass.

## Open Questions

- [ ] **Readiness roll-up strategy binding (design fork).** The handoff shows per-list "N ready" counts
  and a per-symbol STRATEGY column with no visible strategy selector, implying a per-watchlist/per-symbol
  strategy binding. Feature 083 explicitly forbids a **fabricated signal→strategy binding**
  (`WatchlistReadiness.tsx`, Signal-detail). **Proposed resolution (for /sdd-design):** keep readiness
  **strategy-scoped** — the trader picks the strategy to evaluate the list against (existing
  `WatchlistReadiness` behavior), and the roll-up + STRATEGY column reflect *that* strategy. The sidebar
  per-list count shows only for the selected list + strategy, or is omitted until a strategy is chosen.
  No persisted per-list default strategy is introduced (that would be a new DB column, out of scope).
- [ ] **"Save as watchlist" symbol set.** Save all scanned symbols, or only the passing (`passed==true`)
  subset? Proposed: passing subset when a hard filter is active, else all results, with the count shown
  in the action label.
- [ ] **Known trap (fails.md 2026-07-01, 060-screener-engine, C-10(a)).** New/changed UI must stay
  nav-reachable. This feature changes existing registered pages (no new route), but the design phase
  must confirm the "Build from screener" and "Save as watchlist" cross-links resolve to registered
  routes, with an e2e assertion.
- [ ] **Known trap (fails.md 2026-07-01, 056, C-10(b)).** The readiness roll-up counts and the per-row
  states must be derived from the **same** `EvaluateReadiness` result (one read path), so the headline
  count can never disagree with the rows.

# Product Spec: watchlist-readiness-list-ux

**Created**: 2026-09-06

---

## Problem Statement

The `/insights/watchlists` page is bad UX for anything but a tiny watchlist. It loads the watchlist
(a cheap `PortfolioService.ListWatchlists` DB read) and then the readiness overlay fans out one
`AnalysisService.EvaluateReadiness` call per distinct bound strategy; the readiness column stays
**blank until every promise resolves**, with **no per-row loading indicator**, and **every** bound
symbol is fetched at once because the list is **not paginated**. Feature 180 pre-warms the backend
cache, but the consumer surface still renders poorly.

## User Story

As a trader opening the watchlist/stock-list page, I want the list to render immediately with a
per-row readiness loading state and to be paginated, so that a long watchlist is usable right away
instead of staying blank until every per-symbol readiness promise resolves.

## Functional Requirements

FR-1. The watchlist rows render **immediately** on list load (symbols/bindings visible) with a
**per-row readiness state**: `loading` while readiness is pending, the readiness verdict when
resolved, and a non-blocking `unknown`/error state on failure — the list is **never blank-until-all**.

FR-2. The read path **optionally decorates readiness** onto the list so the UI receives readiness
inline or progressively for the visible rows, replacing the per-strategy N+1 fan-out from the client.
Decoration is **opt-in** (a flag/param), so the plain list read stays cheap when readiness isn't
needed.

FR-3. The list is **paginated**; readiness is evaluated/decorated **only for the visible page** of
bound pairs, so a long watchlist neither renders nor fans out readiness for every symbol at once.

FR-4. **No dependency cycle.** `xstockstrat-analysis` already depends on `xstockstrat-portfolio`
(it reads watchlists). The decoration must NOT make `portfolio` call `analysis`
(portfolio→analysis→portfolio cycle). The design picks a cycle-free owner (analysis-side RPC, or the
`xstockstrat-ui` BFF aggregation) — see Open Questions.

FR-5. Readiness decoration is **best-effort per row** (mirrors feature 180): a decoration/evaluation
failure for one pair degrades that row to `unknown`, and never fails or blanks the rest of the list.

FR-6. With feature 180's materializer enabled, decoration for **covered, warm** pairs is served from
the FAST cache path (no re-fetch/re-eval); only cold/uncovered pairs on the visible page pay the SLOW
path — so pagination + the warm cache together bound worst-case load.

FR-7. The new per-row readiness states (loading / resolved / `unknown`-error) and the pagination
control use the platform's **canonical C-17 UI state primitives** (per
`docs/patterns/ui-ux-governance.md` — the shared skeleton/loading, query-state, and empty/error
primitives, and the shared table/list primitive — not ad-hoc spinners) and meet the C-17
**accessibility baseline**: the loading state is announced to assistive technology (`aria-busy` /
`role="status"`), and the pagination control is keyboard-operable and has an accessible label.

## Out of Scope

- The backend readiness materializer / cache itself (feature 180 — already shipped).
- Changing readiness **semantics** (FAST/SLOW, `bar_epoch` bust, conviction ordinal) — this feature
  is presentation + read-path shape only.
- The trader single-symbol readiness panel (`positions/[symbol]`) — one pair, already fine.
- Non-watchlist surfaces (the opportunities queue has its own pagination/materialization).

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-ui` — the `/insights/watchlists` page: per-row loading/error state, pagination
  controls, and the BFF call chain (and, if decoration lands in the BFF, the server-side aggregation).
- `xstockstrat-analysis` — **candidate** decoration owner: a batch/paginated "readiness for a
  watchlist page" RPC that takes bound `(symbol, strategy)` pairs and returns readiness (reusing the
  180 FAST/SLOW path). Whether the RPC lives here is a design decision (FR-4).
- `xstockstrat-portfolio` — **only if** pagination/decoration touches `ListWatchlists` (it already
  paginates watchlists; the bound-pair page may derive from it). Must not gain an outbound call to
  analysis (FR-4).
- `packages/proto` — only if a response gains readiness fields or a new RPC is added (additive,
  non-breaking; see Proto Contract Changes).

## Consumer Surface(s)

_Constitution **C-14**._

- [x] **UI** — `xstockstrat-ui` segment `/insights` (`/insights/watchlists`): the existing
  `WatchlistReadiness.tsx` / `useWatchlists.ts` surface gains per-row loading/error states and
  pagination. This is an **existing** page already in `PLATFORM_SUBNAV` (C-10) — no new nav route —
  but any **new BFF gRPC call** it makes needs a matching e2e mock (fails.md:1281/1317).
- [ ] **Agent** — no MCP tool change (unless a new proto field lands on a message the agent projects;
  see Open Questions / fails.md:1151).
- [ ] **None** — not applicable; the whole point is user-observable on `/insights`.

## Proto Contract Changes

- [ ] No proto changes required
- OR (design-dependent, additive & non-breaking if any):
  - **Option A (analysis-side RPC):** a new `AnalysisService` RPC (e.g. `EvaluateWatchlistReadiness`)
    taking a page of `(symbol, strategy_id)` pairs (or a `watchlist_id` + page) → per-pair readiness.
    Additive RPC → 1 owner approval, not the breaking-change gate.
  - **Option B (decorate an existing response):** an optional `readiness` field on the watchlist page
    response + an `include_readiness` request flag. **If the message is one the agent hand-projects,
    this trips the descriptor-parity test** (fails.md:1151) — enumerate agent projections at /sdd-spec.
  - **Option C (BFF-only aggregation):** no proto change — the `xstockstrat-ui` BFF calls the existing
    `ListWatchlists` + `EvaluateReadiness` and streams/decorates server-side.
  - The design phase picks one (FR-4 cycle-free).

## Config Key Changes

- [ ] No new config keys _(a page-size default may be a UI constant, not a config key — confirm at design)._

## Database Changes

- [x] No schema changes — reuses feature 180's `analysis.readiness_cache`; pagination is a query/param
  concern, not a schema one.

## Feature Workflow Notes

Branch to create: `feature/watchlist-readiness-list-ux` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval — `xstockstrat-ui` (+ `xstockstrat-analysis` if the decoration RPC lands there)
- [ ] 2 service owners + platform lead — only if a **breaking** proto change (not expected; additive)
- [ ] DBA review — not required (no schema change)

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

_Genuine design forks — deliberately deferred to `/sdd-design` (C-11 / P-03: surfaced, not
guessed). The `FR-1..7` requirements are testable independent of which option is chosen._

- [ ] **Decoration owner (the core design fork — FR-4).** Analysis-side batch/paginated RPC (Option A)
  vs. an optional field on an existing response (Option B) vs. BFF-only aggregation (Option C)? The
  cycle constraint (analysis→portfolio already exists) rules out portfolio calling analysis. Weigh:
  proto/agent-parity blast radius, streaming vs. one-shot, and reuse of 180's FAST path. **`/sdd-design`.**
- [ ] **Progressive vs. one-shot decoration.** Does the page stream readiness per row as it resolves
  (best perceived latency, needs a streaming/polling channel) or return the visible page's readiness
  in one decorated response (simpler)? With 180 warm, one-shot may be fast enough; design decides.
- [ ] **Pagination model.** Page size default + control (offset/token). `ListWatchlists` already
  paginates *watchlists*; here we paginate the **bound-pair rows** within the selected watchlist —
  confirm where the page boundary is drawn.

## Known Traps & Constraints (design/spec must honor — not open questions)

- **Preserve 177 + 180 behavior when rewriting the fan-out.** The `useQueries` block this feature
  rewrites (`WatchlistReadiness.tsx:186-200`) already carries feature 177's `staleTime: 30_000`
  cadence and relies on feature 180's warm-cache FAST path (FR-6). The rewrite must preserve both —
  do not regress the 30s client cadence or the FAST-path serving of warm pairs (overlap scan, C-16).
- **Every new BFF gRPC call needs an e2e mock** (fails.md:1281, 1317): proto3 JSON flattened-oneof
  shape + a mock-map entry, or CI e2e goes red though local passes.
- **Second BFF call site** (fails.md:1138): if an RPC signature changes, update *every* BFF
  (`insightsBff.ts` and any other), not just the obvious one.
- **BFF error passthrough** (fails.md:552): a new BFF `dispatch*` path must not collapse backend
  errors into a generic HTTP 400.
- **Proto field → agent parity** (fails.md:1151): Option B on an agent-projected message breaks
  `test_*_projection.py` unless the agent projection is updated in the same PR.

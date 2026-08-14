# Product Spec: strategy-symbol-denylist

**Created**: 2026-08-14

---

## Problem Statement

A live-enabled strategy's symbol universe today is an **opt-in allowlist**:
`signal_params.symbols` (`live_loop.py:37-47`'s `strategy_symbols()`), a JSON list an operator must
manually populate per strategy at registration/edit time. This requires manual upkeep every time a
new symbol becomes relevant (a new watchlist entry, a new held position, a new active signal) and a
strategy has no way to say "evaluate everything relevant, except these specific symbols I know don't
suit this strategy." The opt-in model also means `131-live-strategy-opportunity-attribution`'s
attribution mechanism — built on the same `strategy_symbols()` helper — only ever surfaces a live
strategy for the small set of symbols someone remembered to list explicitly.

## User Story

As a trader/operator, I want a strategy's symbol coverage to default to everything I actually watch,
hold, or have active signals on, and only need to explicitly list the symbols I want that strategy to
**skip** — instead of manually maintaining a full allowlist per strategy — and I want to see which
`(symbol, strategy)` pairs are being skipped, not have them silently vanish.

## Functional Requirements

FR-1. Add `repeated string denied_symbols = 12;` to `StrategyDefinition`
(`packages/proto/analysis/v1/analysis.proto:249-274`, next free field number after
`exit_cooldown_days = 11`) — normalized-uppercase symbols this strategy must never evaluate or
attribute, regardless of any other coverage source (watchlist, held position, or active signal). No
migration required: `StrategyDefinition` persists as `definition_json JSONB`
(`services/xstockstrat-analysis/migrations/001_strategies.up.sql:4`), so a new field is captured
automatically, same as `signal_params`/`cooldown_days`.

FR-2. `ManageStrategy`'s AIP-161 partial-update path (`update_mask`, `analysis.proto:284-302`) must
accept `denied_symbols` as an allowed masked path, so the deny list can be edited independently of
the rest of the definition (entry/exit rules, components, etc.) — mirroring how `cooldown_days` and
`exit_cooldown_days` are already independently maskable.

FR-3. Redefine the live-loop's per-strategy symbol universe (`strategy_symbols()`,
`live_loop.py:37-47`, and 131's reuse of it for `live_by_symbol`): instead of returning
`signal_params.symbols` as an allowlist, it must return
`union(watchlist-bound symbols, held-position symbols, active-signal symbols) − denied_symbols`.
**This exact union is the union `_compute_opportunities` already builds per-user**
(`watchlist_by_symbol`, `held_norm`, `signals_by_symbol` — `servicer.py:2102-2109`) — reuse that
shape, don't invent a second one. **Critical open question, not resolved here**: `live_loop.py`
itself is not user-scoped (strategies are global, feature-048-era design) while watchlists and held
positions ARE per-user (`ListPositions(user_id)`, `ListWatchlists` via the `x-user-id` header) — see
Open Questions for the exact gap this creates and why it must be resolved in `/sdd-design`'s Phase 0
Recon before any implementation.

FR-4. UI: the deny list must be editable from **both**:
- The Symbol detail page (`services/xstockstrat-ui/src/app/insights/market/[symbol]/page.tsx`) — a
  control to mute *this* symbol for a chosen strategy (adds the symbol to that strategy's
  `denied_symbols`).
- The Strategy edit page (`services/xstockstrat-ui/src/app/insights/strategies/[id]/edit/page.tsx`)
  — a control to manage the strategy's full deny list (add/remove any symbol).

Both surfaces write through the same `ManageStrategy` masked-update path (FR-2) — no second write
mechanism.

FR-5. Opportunities page (`services/xstockstrat-ui/src/app/insights/opportunities/`): when a
`(symbol, strategy_id)` pair is on that strategy's deny list, it must not silently disappear from
the queue the way an out-of-cap-budget pair does today (per 131's fan-out caps). It must surface as
an explicit **skipped/muted** row — visually and structurally distinct from both a normal candidate
row and today's unattributed (`strategy_id=""`, `0/0`) fallback row — so the user can see the
exclusion and reverse it (a link/action back to FR-4's edit controls). Exact wire representation
(new `Opportunity` field vs. a new `provenance` tag vs. a distinct row classification) is a design
decision, not fixed here.

FR-6. This feature directly supersedes `131-live-strategy-opportunity-attribution`'s design-time
assumption that `strategy_symbols()`/`live_by_symbol` is built from an explicit opt-in
`signal_params.symbols` set. **131 is `design-approved` but not yet implemented** (still spec-ready
in the merge-order sequence, waiting on `130-signal-source-reliability-weight`). `/sdd-design` for
this feature must amend `131`'s `design.md` directly to consume the new deny-list-derived universe
— not leave 131's existing mechanism as dead weight, and not duplicate the live-strategy-attribution
logic in a second place. Update `docs/roadmap/features/merge-order.md` accordingly.

FR-7. `manage_strategy` (the MCP agent tool wrapping `ManageStrategy`, per the `strat-lab` plugin —
root `CLAUDE.md` § Key File Paths: "a change to `manage_strategy`... must update the skill in the
**same** PR") must expose `denied_symbols` through its parameter/response mapping, and the
`strat-lab` plugin's `backtest` skill must be updated in the same PR to reflect the new deny-list
semantics — an agent-driven strategy edit must not silently ignore this field.

## Out of Scope

- Changing how `signal_params.symbols` behaves for any *other* existing consumer beyond
  `strategy_symbols()`/`live_loop.py`/131's attribution (grep-confirm at `/sdd-design` time whether
  any other caller exists — e.g. the fundamentals signal producer's own universe logic is
  independent, `analysis.fundsignal.universe_source`, and is explicitly not touched here).
- Any change to the backtest engine's symbol selection (`RunBacktest` takes an explicit `symbol` per
  request; this feature only changes the *live* loop's continuous evaluation universe).
- A deny list scoped to something other than a strategy (e.g. a user-level global "never show me
  this symbol" preference) — this feature's deny list is per-`(strategy_id, symbol)`, not per-user.
- Resolving the cross-user aggregation question (Open Questions) — that is design work, not a
  decision this product spec can make; the spec states the requirement's *intent*, `/sdd-design`
  determines the *mechanism*.

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-analysis` — `StrategyDefinition`/`ManageStrategy` (FR-1, FR-2), `live_loop.py`'s
  evaluation universe (FR-3), `_compute_opportunities`'s skipped/muted row logic (FR-5)
- `xstockstrat-ui` — Symbol detail page, Strategy edit page, Opportunities page (FR-4, FR-5)
- `xstockstrat-agent` — `manage_strategy` MCP tool + `strat-lab` plugin skill (FR-7)
- `xstockstrat-portfolio` — potentially, if a cross-user positions/watchlist aggregation RPC is
  needed to resolve the Open Question below (not certain until `/sdd-design` Phase 0 Recon)
- `packages/proto` — `analysis.proto` field addition (FR-1)

## Consumer Surface(s)

- [x] **UI** — `xstockstrat-ui` `/insights` segment: Symbol detail page
  (`/insights/market/[symbol]`) gains a mute-for-strategy control (FR-4); Strategy edit page
  (`/insights/strategies/[id]/edit`) gains full deny-list management (FR-4); Opportunities page
  (`/insights/opportunities`) gains a skipped/muted row treatment (FR-5).
- [x] **Agent** — `xstockstrat-agent` MCP tool `manage_strategy` gains `denied_symbols` in its
  parameter/response mapping (FR-7); the `strat-lab` plugin's `backtest` skill must be updated in
  the same PR.
- [ ] **None**

## Proto Contract Changes

- [x] New field: `repeated string denied_symbols = 12;` on `analysis.StrategyDefinition` (additive,
  non-breaking). `ManageStrategyRequest.update_mask`'s allowed-paths comment
  (`analysis.proto:298-299`) must list `denied_symbols` as a maskable path (FR-2) — 1 service owner
  + Proto Reviewer per the non-breaking-proto approval gate.

## Config Key Changes

- [ ] No new config keys anticipated at story time — `/sdd-design` may find it needs one (e.g. a cap
  on the live loop's per-cycle universe size analogous to `analysis.engine.max_strategies_per_cycle`
  or 131's various fan-out caps, if the new universe meaningfully grows per-strategy symbol counts —
  see Open Questions).

## Database Changes

- [ ] No schema changes — `denied_symbols` persists inside `analysis.strategies.definition_json`
  (JSONB), same mechanism as every other `StrategyDefinition` field; no new table or column.

## Feature Workflow Notes

Branch to create: `feature/strategy-symbol-denylist` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking proto change) — `analysis` + Proto Reviewer
- [ ] 2 service owners + platform lead (breaking proto change) — not applicable (additive field)
- [ ] DBA review + service owner (schema migration) — not applicable
- [ ] **Platform Lead review recommended** (not a formal gate per the matrix above, but flagged
  given the Open Questions below materially affect cross-service architecture — portfolio/watchlist
  read scope, live-loop compute cost)

## Acceptance Criteria

1. A strategy with an empty `denied_symbols` and no `signal_params.symbols` set evaluates every
   symbol in `union(watchlist, held, active-signal)` — a strict behavior change from today's
   "no symbols configured → strategy never fires" (`strategy_symbols()`'s current empty-list
   short-circuit).
2. Adding a symbol to `denied_symbols` (via either UI surface, FR-4) removes that
   `(symbol, strategy)` pair from live-loop evaluation on the next cycle, and from Opportunities
   attribution on the next compute pass — replaced by a skipped/muted row (FR-5), not a silent
   absence.
3. A denied symbol that is *also* covered by a different, non-denying live strategy is unaffected
   for that other strategy — the deny list is strictly per-`(strategy_id, symbol)`.
4. `manage_strategy` (agent tool) round-trips `denied_symbols` correctly: setting it via the tool is
   reflected in a subsequent `GetStrategy`/`ListStrategies` read, and the `strat-lab` skill's
   documented tool contract reflects the new field.
5. Existing strategies with a populated `signal_params.symbols` and no `denied_symbols` do not lose
   coverage of those symbols on migration to this feature (exact backward-compatibility mechanism —
   e.g. a one-time best-effort translation, or accepting that the allowlist becomes informationally
   inert once the union-based universe supersedes it — is a `/sdd-design` decision, not fixed here).

## Open Questions

- [ ] **CRITICAL — must be resolved in `/sdd-design` Phase 0 Recon before Phase 1 debate proceeds.**
  `live_loop.py` evaluates strategies platform-wide, not per-user (strategies have no `user_id`
  column — confirmed, `insights.md` 2026-08-13, "`analysis` has no per-user strategy owner column
  and no global user-list RPC"). But `ListPositions`
  (`packages/proto/portfolio/v1/portfolio.proto:132-138`) is `user_id`-scoped by request field, and
  `ListWatchlists` (`portfolio.proto:213-217`) is scoped by the propagated `x-user-id` header — **no
  cross-user "all users' positions/watchlists" RPC exists today** (grep-confirmed: `ListPositions`/
  `ListWatchlists` are the only list RPCs on `portfolio.proto`, both single-user). Active signals
  (`QuerySignals`) ARE already platform-wide/not user-scoped, so that part of the union is free. But
  the watchlist and held-position parts of FR-3's union require either: (a) a new admin-scoped
  cross-user aggregation RPC on `xstockstrat-portfolio` (real new surface, real new multi-tenancy
  exposure to reason about), (b) restricting live-loop's *own* evaluation trigger to active signals
  only, while watchlist/held remain per-user concepts used solely by `_compute_opportunities`'s
  *read-side* attribution (i.e., the live loop's actual alerting universe stays narrower than what
  Opportunities can attribute — a real behavior split worth naming explicitly), or (c) some other
  mechanism not yet identified. This is not a detail — it determines whether FR-3 as stated is even
  buildable without new cross-service surface. `/sdd-design` must ground this against the real RPCs
  before proposing a mechanism.
- [ ] **Live-loop compute-cost impact.** `analysis.engine.max_strategies_per_cycle` (default 50) caps
  total `(strategy × symbol)` pairs evaluated per cycle, and **truncates rather than round-robins**
  (`insights.md` 2026-08-13: "a standing loop... cap truncates rather than round-robins" —
  `live_loop.py:188-196`'s `SELECT` with no `ORDER BY` + early-return-at-cap). If FR-3's union
  meaningfully grows the average strategy's symbol count (opt-in lists today are presumably small;
  a platform-wide watchlist/held/signal union could be much larger), this existing truncation
  behavior becomes a much bigger fairness problem — some (strategy, symbol) pairs could
  *permanently* never get evaluated, not just occasionally. `/sdd-design` must assess whether this
  cap's current shape is still adequate or needs to change (e.g., round-robin instead of
  truncate) as part of this feature, not as an unrelated follow-up.
- [ ] **FR-5's exact wire representation for a skipped/muted row** — new `Opportunity` field vs. a
  `provenance` tag vs. a distinct classification enum value; whether a skipped row still gets
  bars-fetched/traced (cost) or is a zero-compute placeholder — `/sdd-design` decision.
- [ ] **Backward compatibility for existing `signal_params.symbols`-configured strategies** (AC-5) —
  translate once, keep both mechanisms live indefinitely, or deprecate the allowlist field outright
  — `/sdd-design` decision, with a migration/rollout note either way.
- **Known trap** (`fails.md` 2026-08-05, `023-position-sizing-engine`) — carry into `/sdd-design` as
  a guardrail check: do not conflate `Opportunity.conviction` (ordinal) with any cardinal quantity
  when adding the skipped/muted classification (FR-5) — a skipped row's absence of a trace is not a
  "zero conviction," it is a distinct state and must be represented as one, not as `conviction=0`.

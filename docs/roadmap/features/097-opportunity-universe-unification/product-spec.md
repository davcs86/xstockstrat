# Product Spec: opportunity-universe-unification

**Created**: 2026-08-03

---

## Problem Statement

The Decide → Opportunities queue (`analysis.ListOpportunities`) is fed by active signals **only**: held
positions merely mutate a row's action tag and watchlisted symbols never enter the queue at all. The
strategy binding and the snooze control are UI-only transient React state — snooze does not survive a
reload, and its `symbol-source` key disagrees with the backend's per-symbol dedup, so a snooze silently
stops applying when a different source wins for that symbol. Every queue row ships `strategy_id=""` and
`passing/total=0/0`, so `GetStrategyAnalytics.taken`/`queue_share` are reserved `0.0` and readiness never
appears on the queue. Separately, signals are double-usable — as a universe selector **and** as an input
to a signal-weighted strategy's score — so the same signal can be counted twice.

## User Story

As an active trader using the Decide surface, I want every symbol I care about — whatever put it in
front of me (a newsletter signal, a position I hold, or a symbol I'm watching under a specific strategy)
— to appear as one ranked, de-duplicated opportunity with a stable identity, real strategy readiness, and
a snooze/dismiss that persists across reloads and devices, so that the queue is the single trustworthy
place I decide from and a signal is never counted twice.

## Functional Requirements

FR-1. **Unified Universe.** `ListOpportunities` builds the candidate set as
`Universe(user) = active signals ∪ held positions ∪ watchlist (symbol, strategy) bindings`. Held
positions and watchlisted symbols now **add rows**, not merely modify a signal-sourced row's action tag.

FR-2. **Signal-free readiness kernel is shared, for entries and exits.** Every candidate is evaluated
through the single readiness evaluator (`evaluator.evaluate_conditions_traced` — rule leaves are pure
indicator/formula component refs; `signals_map` stays reserved/unused there). Entry candidates
(signal/watchlist) are traced against the strategy's **`entry_rule`**; **held candidates are also traced
against the `exit_rule`** — today the kernel only traces `entry_rule`, so an additive exit-trace path is
required (hot path frozen, per the 083 additive-sibling pattern). Each queue row carries real
`passing_conditions`/`total_conditions` and a deterministic conviction ordinal wherever a strategy is
attributed. No probability is fabricated (C-01).

FR-3. **Signals as universe + ranking axis only (Option 2).** Signals are removed as an input to a
strategy's internal score. A signal contributes to a candidate's ranking exactly once, as its own
independent axis composed at the queue — never folded into readiness. The strategy-definition signal
inputs (`signal_weight`/`signal_sources` and their `scoring.py` blend, plus the `ScreenSymbolsRequest`
signal blend fields) are **deprecated, not deleted** (proto deprecate-don't-delete), and the queue's
composition layer owns any signal↔technical ranking blend.

FR-4. **Stable opportunity identity.** An `Opportunity` gains a stable key derived from
`(user_id, symbol, strategy_id, action)` — **not** `source`. Multiple origins for the same symbol collapse
into one row carrying its provenance (which signal source(s) / position / watchlist contributed). The UI
snooze key and the backend dedup key are the same key.

FR-5. **Persisted snooze / dismiss / take.** Snooze, dismiss, and take are persisted per user against the
stable opportunity key (survives reload, syncs across devices, supports a bounded "snooze until").
`ListOpportunities` filters/annotates against this store server-side. Reuses the analysis asyncpg pool —
**no new DB pool** (F-06).

FR-6. **Watchlist `(symbol, strategy)` bindings.** A `Watchlist` changes shape from a bare
`repeated string symbols` into a list of `(symbol, strategy_id)` bindings (a strategy per symbol). Each
binding is a ready-made Universe candidate. The transient `WatchlistReadiness.tsx` `useState('')` strategy
picker is replaced by the persisted per-symbol binding. Shape change is delivered via a proto **deprecation**
path (keep the old field readable), not a hard replace.

FR-7. **Real per-strategy queue analytics.** With strategy attribution and a persisted `TAKEN` action,
`GetStrategyAnalytics.taken` and `queue_share` stop being reserved `0.0` and reflect actual queue/taken
data.

FR-9. **Exit recommendations are first-class and technical.** The queue surfaces exit-side rows
(`REDUCE`) for held positions from **two** signal-free sources: (a) the attributed strategy's `exit_rule`
firing via the readiness kernel (new exit-trace path, FR-2), and (b) a sell-direction signal as an
independent ranking axis (FR-3). `REDUCE` stays the single non-prescriptive tag — trim vs. full exit is
the human's choice at the order ticket (unchanged from feature 083). A held symbol whose `exit_rule` is
firing must appear even when no sell signal exists for it.

FR-8. **All shared consumers updated in-PR.** Every consumer of the changed contracts is updated in the
same feature: the Opportunities page, the Watchlist editor (per-symbol strategy picker), the Strategy
wizard (remove signal-weight controls), the exhaustive TS enum render maps (`opportunityShared.tsx`), and
the agent MCP surface + `strat-lab` skill for `manage_strategy` / any watchlist tool (C-10 parity; see
Known traps).

## Out of Scope

- The Copilot rail's LLM/authenticated-MCP invocation path (unchanged; still deferred per feature 083).
- A cross-user/global watchlist enumeration for the fundamentals producer's `universe_source=watchlists`
  gap — this feature wires watchlists into the **per-user** queue via the existing per-user
  `ListWatchlists`; the platform-loop global enumeration is a separate follow-up.
- Any new probabilistic conviction model — conviction stays the deterministic ordinal.
- Broker/live order execution changes — the queue opens the existing order ticket unchanged.

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `packages/proto` — `Opportunity` identity/fields, `Watchlist` shape (deprecation path), deprecation of
  the signal-blend fields, any new snooze/dismiss RPC + watchlist-binding RPC surface.
- `xstockstrat-analysis` — `ListOpportunities` Universe union + shared readiness kernel; new
  `opportunity_actions` persistence; remove the signal blend from `scoring.py`/backtest scoring; populate
  `GetStrategyAnalytics.taken`/`queue_share`.
- `xstockstrat-portfolio` — `Watchlist` `(symbol, strategy)` binding storage (migration) + RPC changes.
- `xstockstrat-ui` — Opportunities page (server-persisted snooze), Watchlist editor (per-symbol strategy),
  Strategy wizard (drop signal-weight controls), enum render maps.
- `xstockstrat-agent` — MCP `manage_strategy` (signal params retired) + any watchlist tool; `strat-lab`
  skill parity.

## Consumer Surface(s)

_Constitution **C-14**._

- [x] **UI** — `xstockstrat-ui` `/insights`: Opportunities queue (persisted snooze/dismiss, real readiness
  + strategy on each row), Watchlist editor (per-symbol strategy binding), Strategy wizard (signal-weight
  controls removed). All already registered in the nav — but re-verify nav reachability per **C-10(a)**
  (guards the 058/060 fails).
- [x] **Agent** — `xstockstrat-agent` MCP: `manage_strategy` (signal-weight params retired from the
  strategy definition) and any watchlist tool must move in lockstep with the proto; `strat-lab` skill's
  `backtest` guidance updated in the **same** PR (root CLAUDE.md strat-lab rule + F-12).
- [ ] **None**

## Proto Contract Changes

- [ ] No proto changes required
- **Breaking-class change — must use deprecation, not deletion:**
  - `portfolio.Watchlist` shape: introduce `(symbol, strategy_id)` bindings while keeping the existing
    `repeated string symbols` field readable/deprecated; add/adjust watchlist write RPCs accordingly.
  - `analysis.Opportunity`: add a stable-key field and ensure `strategy_id`/`passing`/`total` are
    populated; add provenance (contributing origins/sources).
  - Deprecate the signal-blend fields (`ScreenSymbolsRequest.signal_sources`/`signal_weight`, and the
    strategy-definition signal params) — mark `[deprecated = true]`, do not remove.
  - New RPC(s) for snooze/dismiss/take (or a request field on the existing surface) — design to decide
    exact shape.
  - Every enum addition triggers the exhaustive-TS-`Record` coupling (C-10(a/d)); pair with a UI build.

## Config Key Changes

- [ ] No new config keys
- **Likely (design to confirm):** `analysis.opportunity.snooze_default_hours`, an opportunity valid-window
  key, and re-purposing of `analysis.signals.source_weights` from a strategy-score input to the queue's
  ranking-axis weight. Names follow `<service>.<category>.<key>`.

## Database Changes

- [ ] No schema changes
- **`xstockstrat-portfolio`:** migration to store the `(symbol, strategy_id)` binding (new column on the
  watchlist-symbols relation or a new bindings table) with an up+down pair.
- **`xstockstrat-analysis`:** migration for `opportunity_actions` (`user_id, opportunity_key, action,
  snooze_until, created_at`), reusing the existing asyncpg pool (no new pool — F-06).

## Feature Workflow Notes

Branch to create: `feature/opportunity-universe-unification` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [ ] 1 service owner approval (non-breaking proto or config change)
- [x] 2 service owners + platform lead (breaking proto change — Watchlist shape + field deprecations)
- [x] DBA review + service owner (schema migration — portfolio + analysis)

## Acceptance Criteria

1. A watchlisted symbol under strategy X, and a held position, each appear as their own ranked
   opportunity row with real `passing/total` readiness — not only symbols with an active signal.
2. Two origins for the same symbol (e.g. a signal + a watchlist binding) collapse into one row whose key
   is `(user, symbol, strategy, action)` and whose provenance lists both.
3. Snooze/dismiss persists across a page reload and a second device; a bounded snooze auto-expires.
4. No signal is counted twice: with `signal_weight` retired from strategies, a signal affects a row's
   rank only via the queue's independent axis, and strategy readiness is unchanged by the presence/absence
   of a signal.
5. `GetStrategyAnalytics.taken`/`queue_share` return non-zero real values for a strategy with taken
   opportunities.
6a. A held position whose attributed strategy's `exit_rule` is firing appears as a `REDUCE` row with real
   readiness, even with no sell signal present for that symbol.
6. `buf breaking` passes: the Watchlist/opportunity/signal-field changes are deprecations, and every
   generated-stub consumer (TS exhaustive maps, agent request builders, `strat-lab` skill) builds/passes
   in the same PR.
7. No new DB pool is introduced; the connection-pool budget table is unchanged (F-06).

## Open Questions

- [ ] **Position attribution (design fork).** Which strategy is a held position with no watchlist binding
      attributed to for readiness — the strategy it was entered under (if recoverable from
      trading/ledger), the user's `live_enabled` strategies, or shown unattributed until the user picks
      one? Affects FR-1/FR-2 and the `queue_share` denominator.
- [ ] **Watchlist→strategy cardinality.** One strategy per symbol (committed) — but may a symbol appear
      under two watchlists with different strategies, and if so does the Universe emit two candidates or
      merge them? Affects the FR-4 dedup key.
- [ ] **Signal ranking axis composition.** With Option 2, how exactly does the queue compose the signal
      axis with technical readiness for ranking (weighted sum, lexicographic, separate sort toggles)? Owns
      the former `signal_weight` behavior.
- [ ] **Deprecation horizon.** Do we keep the old bare-`symbols` Watchlist field and signal-blend fields
      readable for one release only, or indefinitely? Coordinate with any in-flight watchlist/screener
      features.
- [ ] **Known trap — shared consumer parity (fails.md 2026-07-01 056/060, 2026-07-21 C-10(a/d), 2026-08-02
      MCP/strat-lab F-12).** This feature changes producer contracts consumed in many places (TS exhaustive
      enum maps, agent request builders, the `strat-lab` skill, a second position read path). Every shared
      consumer must be updated and reachability/parity-tested in the **same** PR — this is the exact
      "shipped the producer, forgot the consumer" shape that recurred three times.

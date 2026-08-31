# Product Spec: fundamentals-blend-universe

**Created**: 2026-08-31

---

## Problem Statement

The `fundamentals_macd_blend` strategy is designed to work on fundamentally-covered names, but the
live evaluation loop treats every strategy the same way — a strategy's universe is its watchlist ∪
held ∪ (signals if `signal_eligible`). We want `fundamentals_macd_blend` to run automatically across
the platform's **fundamentals universe** (symbols that have an active fundamentals signal *and* real
fundamentals data), in addition to whatever strategies a user has selected, and we want it constrained
to that universe — it should not evaluate on the rest of a user's watchlist/held symbols where its
premise (fundamentals coverage) does not hold. Today there is no mechanism to force-run one strategy on
a derived sub-universe while excluding it elsewhere; `resolve_universe` only knows per-strategy
allowlist / deny list / `signal_eligible`.

## User Story

As the platform (on behalf of every user with the blend strategy enabled), I want
`fundamentals_macd_blend` to be evaluated on exactly the fundamentals universe — symbols with a live
`source == "fundamentals"` signal that also have actual fundamentals — in addition to the user's
selected strategies, so that the blend strategy runs where it is meant to and nowhere else.

## Functional Requirements

FR-1. During each live evaluation cycle, `fundamentals_macd_blend` is evaluated over the
**fundamentals universe** = { symbols with an active signal where `source == "fundamentals"` }
∩ { symbols for which fundamentals data actually exists }. This runs in addition to (not instead of)
the user's other selected/live strategies.

FR-2. `fundamentals_macd_blend`'s universe is **restricted to** the fundamentals universe: its normal
watchlist ∪ held ∪ signals resolution is replaced by the fundamentals universe, so it is **excluded
from evaluation on every symbol that is not in that universe**.

FR-3. "signal source == fundamentals" is resolved from the ingest signal store via
`QuerySignals(source="fundamentals")` (active signals only) — the same source slug the fundamentals
producer emits under (`analysis.fundsignal.source_slug`, default `fundamentals`).

FR-4. "has actual fundamentals" is resolved via marketdata `GetFundamentalsMulti` (the single FMP/
Finnhub chokepoint, feature 059): a symbol qualifies only if a fundamentals row is returned for it.
Symbols with a fundamentals signal but no returned fundamentals row are excluded.

FR-5. The strategy identity used for this rule is configurable (default `fundamentals_macd_blend`) via
a config key, so the platform can point the rule at a differently-named blend strategy without a code
change; if no such strategy is live/enabled, the rule is a no-op (no crash, no forced universe).

FR-6. The behavior degrades safely: if `QuerySignals` or `GetFundamentalsMulti` is unavailable for a
cycle, `fundamentals_macd_blend` evaluates on an **empty** fundamentals universe for that cycle (it
does not fall back to the broad watchlist/held universe, which FR-2 forbids), and the rest of the loop
(other strategies) is unaffected.

## Out of Scope

- Changing the fundamentals **signal producer's** universe (that is feature 154,
  `fundsignal-watchlist-universe`, already launched) — this feature consumes those signals, it does not
  change how they are produced.
- Auto-creating or seeding the `fundamentals_macd_blend` strategy for users who don't have it. The
  rule applies **per user**: it fires only for users who have a live/enabled strategy whose id matches
  the configured blend id (see Resolved Decisions). Provisioning the strategy for users who lack it is
  a separate concern.
- Promoting `fundamentals_macd_blend` to a global/platform strategy (a rejected alternative — see
  Resolved Decisions); this feature keeps the existing per-user `(user_id, strategy_id)` ownership
  model (feature 133).
- Applying the same "run on a derived sub-universe, exclude elsewhere" rule to any other strategy — this
  feature scopes exactly one configurable strategy id.
- Placing orders — the live loop only emits alerts/opportunities (analysis CLAUDE.md); unchanged.

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-analysis` — Python; owns the live evaluation loop (`app/engine/live_loop.py`,
  feature 048) and `resolve_universe` (feature 132). The force-include/exclude rule is enforced here.
- `xstockstrat-ingest` — read-only dependency via `QuerySignals(source="fundamentals")` (FR-3).
- `xstockstrat-marketdata` — read-only dependency via `GetFundamentalsMulti` (FR-4).
- `xstockstrat-config` — reused for the new `analysis.engine.*` config key(s) (FR-5).

## Consumer Surface(s)

_Constitution **C-14**._

- [ ] **UI** — no new UI. The effect surfaces through existing live-strategy **alerts** (feature 048,
  `xstockstrat-notify`) and **opportunity attribution** (feature 131) that users already see; those
  surfaces need no change to render blend-strategy results.
- [ ] **Agent** — no new tool. `list_strategies` / `run_backtest` already surface strategy results; no
  contract change required.
- [x] **None** — internal to the analysis live-evaluation loop. Justification: the capability is a
  universe-resolution rule inside the evaluation engine; its user-visible output (alerts/opportunities)
  reaches users through already-shipped surfaces, so no new consumer surface is introduced. Operators
  toggle the rule via the `analysis.engine.fundamentals_blend_enabled` config key (Resolved Decisions);
  a dedicated config-ui/agent view is a possible follow-up, not silently deferred.

## Proto Contract Changes

- [x] No proto changes required — the needed inputs already exist: `QuerySignalsRequest.source`
  (`packages/proto/ingest/v1/ingest.proto:129`), `GetFundamentalsMulti`
  (`packages/proto/marketdata/v1/marketdata.proto:41`), and `StrategyDefinition` universe fields
  `denied_symbols` (`packages/proto/analysis/v1/analysis.proto:342`), `signal_eligible`
  (`analysis.proto:355`), and `signal_params` (`analysis.proto:318`, a `google.protobuf.Struct` whose
  `symbols` key is referenced at `analysis.proto:351`). The rule is engine logic, not a new contract.

## Config Key Changes

Two new keys (both `<service>.<category>.<key>` — C-05; `analysis.engine.*` is an existing category
holding `eval_interval_seconds` / `max_strategies_per_cycle` / `alert_throttle_seconds`):
- `analysis.engine.fundamentals_blend_strategy_id` — string, default `fundamentals_macd_blend` (FR-5).
  Names the strategy the rule governs; retargetable without a code change.
- `analysis.engine.fundamentals_blend_enabled` — bool, default `true`. Explicit kill-switch for the
  forced-universe rule, independent of whether the strategy is live (Resolved Decisions).

Both must be registered in the Per-Feature Registered Keys log (`docs/patterns/config-governance.md`),
read via the `WatchConfig` stream (never hardcoded — F-07).

## Database Changes

- [x] No schema changes — the universe is derived at evaluation time from `QuerySignals` +
  `GetFundamentalsMulti`; nothing new is persisted (results flow through the existing alert/opportunity
  write paths).

## Feature Workflow Notes

Branch to create: `feature/fundamentals-blend-universe` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (config change) — `xstockstrat-analysis` owner (+ `xstockstrat-config`)
- [ ] 2 service owners + platform lead (breaking proto change) — N/A (no proto change)
- [ ] DBA review + service owner (schema migration) — N/A (no migration)

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Resolved Design Decisions

Product-level forks are decided below (no unresolved blocking questions remain — criterion 9).
`/sdd-design` validates the enforcement mechanics; the product shape is committed.

- [x] **Blend-strategy ownership/scope (the central fork) — per-user.** `fundamentals_macd_blend` is an
  agent-registered per-user strategy (composite `(user_id, strategy_id)` PK, feature 133). The rule
  applies **per user**: for each user who has a live/enabled strategy whose id matches the configured
  blend id, that strategy is force-run over the fundamentals universe. Promoting the strategy to a
  global/platform strategy is a **rejected alternative** (moved to Out of Scope). FR-1/FR-2 and
  AC-2/AC-3/AC-6 already presume this per-user reading — now committed, not provisional.
- [x] **"In addition to the user's selected strategy" is additive at the pair level.** The force-run
  adds `(blend_strategy, fundamentals-universe-symbol)` records in `_run_cycle`; it does **not** alter
  any other strategy's universe (asserted by AC-3: `sma_cross`'s own universe is unchanged).
- [x] **Universe intersection cost:** the fundamentals-universe set is resolved **once per cycle** and
  reused, drawing on the fundsignal loop's already-fetched fundamentals rather than issuing a fresh
  per-strategy `GetFundamentalsMulti` fan-out, to respect the FMP/Finnhub pacing + pool budget
  (feature 059). (Design confirms the exact reuse/caching seam.)
- [x] **Enable flag:** ship `analysis.engine.fundamentals_blend_enabled` (bool, default `true`) as an
  explicit kill-switch **in addition to** the live-only no-op path (FR-5), so operators can disable the
  forced universe without un-liveing the strategy.
- [x] **Precedence vs per-strategy deny list / allowlist (feature 132):** an explicit per-strategy
  `denied_symbols` still **subtracts** from the forced fundamentals universe (a denied symbol is never
  evaluated, even if in-universe); an explicit `signal_params.symbols` allowlist on the blend strategy
  is **ignored** for the blend strategy because FR-2 replaces its universe with the fundamentals
  universe (the whole point of the rule). Design encodes this precedence and a test asserts it.
- [x] **Operator visibility:** internal-only for this feature (C-14 "None"); the enable flag above is
  the operator control. A dedicated config-ui/agent view is a possible follow-up, not part of this
  feature — recorded, not silently deferred.

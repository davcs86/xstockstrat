# Design: opportunity-universe-unification

**Created**: 2026-08-03
**Rounds**: 5 (full; termination: approved — all objections resolved or accepted as scoped Open Risks; no Floor breach)
**Approved by**: user @ 2026-08-03 (design-gate decisions across 5 rounds: one sequenced feature; compute model → lazy-materialize + stale-while-revalidate; daily-timeframe simplification; producer model → lazy, no standing loop)
**Grounded in**: recon.md

---

## Chosen Approach

**The Decide queue becomes a first-class, materialized per-user entity.** Opportunities are persisted to
a new `analysis.opportunities` table (migration **011**) and served by a gutted, read-only
`ListOpportunities`; freshness is **lazy compute-on-read + stale-while-revalidate + a daily refresh
pass** — no standing all-user producer loop (rejected in Round 5 as user-invisible and unbounded).

**Universe & entity.** On a (re)compute, the candidate Universe for a user is
`active signals (ingest QuerySignals) ∪ held positions (portfolio ListPositions) ∪ watchlist (symbol,
strategy) bindings (portfolio ListWatchlists)` — all edges already wired (`recon.md:62`), no new
inter-service edge. Each candidate is keyed by a **server-authoritative opaque**
`opportunity_key = user|symbol_norm|strategy_id` (action is a stored annotation, not part of the key, so
a snooze survives an ENTER→ADD flip). One `_normalize_symbol` helper feeds every drain and the key. Rows
store readiness inline (`readiness_json`: passing/total + conviction ordinal + per-leaf trace), the action
tag, provenance origins, `valid_until`, and `computed_at`.

**Readiness kernel.** Reuse `evaluate_conditions_traced` (`evaluator.py:171`) with a **new additive
`rule=` sibling** at the `:202-206` plug-in point (`exit_rule` already loads at `:158`): entry-rule trace
for signal/watchlist candidates, **exit-rule trace for held+attributed candidates** (FR-8, net-new —
`recon.md:68`). Held attribution is **watchlist-binding-first, else unattributed** (`strategy_id=""`, no
trace, 0/0) — no fabricated attribution, since portfolio stores none (`recon.md:69`, F-04). The
per-compute traced set is bounded by `analysis.opportunity.max_universe_size` with watchlist/held ranked
**above the cut** so a curated, ready symbol is never truncated (FR-1); only the speculative signal tail
is dropped.

**Read path (pure read + lazy seed).** `ListOpportunities` (`servicer.py:2006`, today's
`_drain_*`/`_action_for`/`0-0` stubs deleted) becomes
`SELECT … FROM analysis.opportunities o LEFT JOIN analysis.opportunity_actions a ON (o.opportunity_key,
o.user_id) WHERE o.user_id=$1 AND o.valid_until>now() AND (snooze filter) ORDER BY conviction`. On a
zero-row cold read (a user's first ever), it synchronously computes + persists that one user's Universe
(bounded, per-user in-flight guard against a two-tab double-compute), then serves. When a served row's
`valid_until` has passed, it is served **stale** and an **async recompute** is kicked
(stale-while-revalidate). A **daily refresh pass** (config `refresh_hour_utc`) recomputes the known-user
set (`distinct user_id in opportunities ∪ opportunity_actions`).

**Persisted actions.** `analysis.opportunity_actions` (migration **010**, PK `(user_id,
opportunity_key)`) holds snooze/dismiss/take; written by a **new `SetOpportunityAction` RPC** that takes
the server-issued `opportunity_key` verbatim (client never derives it). This survives reload/devices and
makes `queue_share` real (numerator = attributed rows / denominator = any-attributed rows, zero guard),
replacing the `0.0` stub (`servicer.py:2183`).

**Option 2 — signals as universe + ranking axis only.** Retire the blend **only** from the
`RunBacktestRequest.strategy_params` scoring path (`servicer.py:319-328,813,903-908`), making a strategy
score technical-only. **Keep** `combine_score`/`compute_signal_score` and `ScreenSymbolsRequest.
signal_sources/signal_weight` for the screener (`screener.py`). **Do NOT touch
`StrategyDefinition.signal_params`** — `signal_params.symbols` is the live-loop symbol universe
(`live_loop.py:37-46`) and is inside the 065 definition fingerprint (`servicer.py:2556`, ANALYSIS-3);
deprecating it would orphan the live loop, break the `SetStrategyLive` precondition (`servicer.py:1856`),
and silently clear grades. The signal ranking axis is composed at the queue via a new scalar
`analysis.opportunity.signal_rank_weight` (existing `analysis.signals.source_weights` left as the
screener's).

**Watchlist (symbol, strategy) binding.** Portfolio migration **008** adds `strategy_id` to the
`watchlist_symbols` join table (`recon.md:21`). The **request** messages
(`Create/Update/AddWatchlistSymbols`) gain binding fields and the write path
(`insertSymbolsTx:248`/`normalizeSymbols:1061`/Update-replace) is re-plumbed to carry `(symbol,
strategy_id)` pairs, so a bare-`symbols` write never resets `strategy_id=''` (the fails.md-080 trap).
Proto `Watchlist.bindings=8`; deprecate `symbols=5` (deprecate-don't-delete, `ingest.proto:31`
precedent).

**Consumer surfaces (C-14).** UI `/insights`: Opportunities page snooze → server-persisted (echo
`opportunity_key`); per-symbol strategy-binding editor in `WatchlistDetail.tsx:114` (reuse
`readinessRollup.ts:34`); StrategyWizard Step-4 blend controls removed **while preserving
`signal_params.symbols`** (merge, not the current wholesale rewrite `StrategyWizard.tsx:144-149`); enum
maps `opportunityShared.tsx`. Agent: `manage_strategy`/`screen_symbols` builders + `covers_every_proto_
field` parity tests (`test_backtest_view.py:157`); `strat-lab` skill + `mcp-tools.md` updated same-PR.

## Rejected Alternatives

- **Standing 60s all-user producer loop** — rejected: analysis can't enumerate users (strategies are
  global, no owner column; no global portfolio user RPC), so the warm set is parasitic on reads and its
  freshness benefit is invisible to anyone not looking; unbounded monotonic cost (no eviction); the
  `live_loop` cap it cited is a truncation, not round-robin, so it would starve users past the cap.
- **Event-push (analysis subscribes to ledger `StreamEvents`)** — rejected: analysis only ever writes to
  ledger (`servicer.py:130` stub); a new governance-gated inbound edge for sub-minute latency a daily
  platform doesn't need.
- **In-memory process memo** — rejected: restart-fragile (analysis is deliberately off in-memory state),
  bespoke single-flight/eviction, coupled to `instance_count:1`.
- **Separate `readiness_cache` table (Round-4 Option B)** — superseded: readiness is stored inline as
  `readiness_json` on the opportunity row (one fewer table/join).
- **Wall-clock `readiness_ttl_seconds`** — rejected: on a daily platform a time-TTL expires over a
  weekend forcing an identical recompute, or fires mid-session serving staleness a bar-date key wouldn't.
- **Deprecating `StrategyDefinition.signal_params`** — rejected: it is the live-loop symbol universe +
  in the 065 fingerprint; retire the blend from `RunBacktest.strategy_params` instead.
- **Deleting `combine_score`** — rejected: shared by the screener + golden test + historical
  `backtest_runs`; retire only the strategy-definition scoring input.
- **Total-set cap that truncates curated candidates** — rejected: watchlist/held rank above the cut so
  they are never hidden (FR-1).

## Open Risks

- [ ] **OR-A — cold-read behavior.** First-ever read does a synchronous bounded compute (~≤`max_universe_
      size` marketdata `GetBars`, not pool-bounded). Pin: blocking vs "materializing"+async partial; cold
      compute cap; per-user in-flight guard against two-tab double-compute — at `/sdd-spec` (analysis read step).
- [ ] **OR-B — stale-while-revalidate correctness.** `valid_until>now()` catches expired signals but NOT
      a closed/reduced position; an exit/REDUCE row can be stale until revalidation. Pin the accepted
      staleness bound, an explicit position-state invalidation (or a UI "as of" surface) — `/sdd-spec`.
- [ ] **OR-C — daily refresh config.** `refresh_hour_utc` must NOT use the `get_int` zero-trap
      (`watcher.py:60`; `0`=midnight is legitimate); label it a *configured daily refresh*, not "market
      close" (holiday/DST/early-close drift documented; calendar-aligned refresh = future feature) — `/sdd-spec`.
- [ ] **OR-D — trading-date key source (OR-1).** The compute needs "today's session date" for the row
      key/`valid_until`; source it cheaply (`GetDataCoverage` on a reference symbol, or the cold fetch's
      last bar) — holiday/crypto mixed-calendar residual documented — `/sdd-spec`.
- [ ] **OR-E — known-user enumeration.** Daily-pass user set = `distinct user_id in opportunities ∪
      opportunity_actions`; a watchlist-only user who never reads is never materialized (accepted —
      `live_loop` owns alerting). Record the dependency — `/sdd-spec`.
- [ ] **OR-F — persisted-row → `Opportunity` proto parity test.** `readiness_json`/row shape is now a
      producer↔reader↔UI contract; extend `covers_every_proto_field` to the materialized-row reader
      (fails.md 056/060 + RC-1) — `/sdd-spec` (analysis read step).
- [ ] **OR-G — signal ranking-axis composition.** Exact formula for `signal_rank_weight` (how the signal
      axis composes with technical readiness in the ORDER BY) — `/sdd-spec`.
- [ ] **OR-H — migration NNN run order + config defaults.** Confirm 008/010/011 numbering, cross-service
      run order, and declare every `analysis.opportunity.*` default in the analysis CLAUDE.md table (C-05,
      C-07) — `/sdd-spec`.

## Constitution Rules Touched

- `C-04` — honored: `OpportunityActionTag` (+ any new enum) carries a `_UNSPECIFIED=0`; closed sets stay enums.
- `C-05` — honored: new keys are `analysis.opportunity.{refresh_hour_utc, valid_window_hours,
  snooze_default_hours, max_universe_size, signal_rank_weight}`, defaults declared in the analysis
  CLAUDE.md table; `refresh_hour_utc` kept off the zero-trap (OR-C).
- `C-07` — honored: additive migrations portfolio **008**, analysis **010**+**011**, each up+down; run
  order pinned at `/sdd-spec` (OR-H).
- `C-09` — honored: proto changes are additive + deprecation-only (`Watchlist.symbols=5`); `buf lint`/
  `buf breaking` in the proto step, `./scripts/buf-gen.sh` after.
- `C-10` — honored: every shared consumer updated same-PR (UI enum maps, agent builders + parity tests,
  `strat-lab` skill, `mcp-tools.md`, `watchlistMock.ts`/098 e2e, persisted-row→proto parity OR-F).
- `C-13` — honored: tests source domain data from canonical fixtures (`e2e/fixtures/`, Python `conftest.py`).
- `C-14` — honored: consumer surfaces are UI `/insights` (Opportunities, Watchlist editor, Strategy
  wizard) + Agent (`manage_strategy`/`screen_symbols` + strat-lab), each earning its own step.
- `P-03` — honored: every fork surfaced to the user (scope, compute model, producer model) and the 8
  Open Risks recorded, not guessed.
- `F-01` — honored: only new numbered migrations; no applied `.up.sql` edited.
- `F-06` — honored: all persistence reuses the existing analysis/portfolio pools; no new pool, no raised
  direct cap.
- `F-07` — honored: cadence/window/weights are `WatchConfig`-served config, not hardcoded.
- `ANALYSIS-3` (module invariant) — honored: `StrategyDefinition.signal_params` is left untouched, so the
  definition fingerprint and persisted 065 grades are unaffected.

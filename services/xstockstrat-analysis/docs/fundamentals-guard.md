# Fundamentals operands & availability guard (features 200, 215)

> On-demand detail relocated from `CLAUDE.md` (context-forge just-in-time move). Fundamentals-input formula operand and the fundamentals availability guard.

## Fundamentals-input formula operand (`fundamental_inputs`, feature 200)

A `COMPONENT_KIND_CUSTOM_FORMULA` component whose formula declares
`fundamental_inputs` (the closed `FundamentalMetric` enum, owned by xstockstrat-indicators) is fed
**only** those fundamentals (never OHLCV `close`), scored **once per filing-boundary epoch**, and the
scalar output broadcast across the span — the same input/output contract as the fundamentals-signal
producer's scoring formula (feature 062), so one formula id works in both places (FR-5, full-row
parity; the partial-row case diverges by design — see `@AC-8`). This is disjoint from the feature-198
`COMPONENT_KIND_FUNDAMENTAL` single-metric operand: 198 reads **one** metric per component off the
bar; 200 feeds a **set** of metrics into a formula.

- **Routing.** The evaluator branch fires only when the component's `formula_id` maps to a non-empty
  metric list in the `formula_fundamentals` map the servicer/live loop builds
  (`_formula_fundamentals` / `evaluator.declared_formula_fundamentals`, one `GetFormula` per distinct
  formula). An unmapped formula stays the ordinary indicator-only path (fed `close`) — byte-identical
  to pre-200 (`@AC-7`). The routing map must be built **before** the loader/eval at every surface
  (a site that computes `eval_dates` without it silently holds).
- **Two data channels, kept separate.** The formula reads a **dedicated** `formula_fundamentals_data`
  channel so a co-occurring feature-198 operand keeps its own PIT `fundamentals` channel unchanged
  (C-16 PRESERVE `@feature-198`). On **backtest** the formula channel is the same per-symbol **PIT**
  filing history (`_load_fundamentals`) so it is as-of-bar-date with the 198 T+1 carry-forward
  (`formula_fundamentals_data` left `None` → defaults to the PIT list). On the **5 non-backtest**
  surfaces (live loop, `EvaluateReadiness`, readiness materializer, `ListOpportunities`,
  `GetIndicatorSeries`) the formula channel is the current-snapshot row from marketdata
  single-symbol `GetFundamentals` (feature 215 — NotFound = absent, FailedPrecondition = disabled),
  lowered by `_load_fundamentals_snapshot` into a **one-element** `[FundamentalPeriod]` with `filed_date =
  date.min` (strictly before every bar), so the identical `_fundamental_as_of_series` broadcasts it as
  one degenerate epoch — one code shape for PIT and snapshot.
- **Gate (one key, two sites).** `analysis.backtest.fundamentals.enabled` (default OFF) now gates
  **both** the 198 PIT loader (`_load_fundamentals`) **and** the 200 snapshot loader
  (`_load_fundamentals_snapshot`) — one config key, two enforcement sites. OFF ⇒ the formula operand
  reads hold on every surface (no snapshot/PIT fetch, no formula execution — no fabricated 0.0).
- **Warmup.** A fundamentals-only formula consumes no rolling `close` window, so its warmup is forced
  to **0** in the backtest warmup cache (the cache value stays `int`); the `fundamental_inputs` read
  folds into the existing warmup-prefetch `GetFormula` at backtest/live (no extra RPC there). The
  other 4 surfaces pay one bounded per-pass `GetFormula` fan-out to build the map.
- **Write-time guard.** `ManageStrategy` rejects `INVALID_ARGUMENT` a component that sets **both**
  `source_symbol` and a fundamentals-input formula — a component is a benchmark operand XOR a
  fundamentals-formula operand (the formula reads fundamentals, not bars).

## Fundamentals availability guard (feature 215)

A strategy that **requires fundamentals** is judged by one pure module,
`app/services/fundamentals_guard.py`. "Requires" means a `COMPONENT_KIND_FUNDAMENTAL` operand, or
a custom formula whose `fundamental_inputs` map is non-empty. The judgement only runs while
`analysis.backtest.fundamentals.enabled` is on; when the gate is off, nothing below happens.

`assess(...)` returns `NOT_REQUIRED`, `NOT_ASSESSED` (no bars), `AVAILABLE`, `UNAVAILABLE`, `UNKNOWN`
or `DISABLED`, with precedence UNAVAILABLE > UNKNOWN > DISABLED > AVAILABLE. Availability means the
evaluator **would execute ≥1 epoch** on the metrics the strategy actually reads: a partial row still
evaluates, and only filings before the last evaluated bar count. The loaders keep absence and
failure distinct:

- NotFound from marketdata means absent.
- FailedPrecondition on the snapshot means DISABLED.
- Any other RPC error, including `RESOURCE_EXHAUSTED`, means UNKNOWN.

Each surface acts on the result:

- **Backtest refusal.** An UNAVAILABLE symbol is not evaluated. Its diagnostic carries
  `NO_TRADE_REASON_FUNDAMENTALS_UNAVAILABLE` plus a `fundamentals_gap` label from marketdata's
  cache-only `GetEtfFlags` (any error leaves `UNSPECIFIED`). It gets no evidence cell, and a WARN log
  names the symbol and strategy. A refused symbol makes the run INSUFFICIENT_DATA when no symbol
  traded. An UNKNOWN symbol is not refused: it gets no cell and the warning
  `fundamentals fetch failed for <SYM> — rerun`.
- **Live deny-entry.** An UNAVAILABLE `(strategy, symbol)` has its entry denied, while exits and
  state replay are untouched. On entering the state the loop emits one WARN log naming
  `NO_TRADE_REASON_FUNDAMENTALS_UNAVAILABLE` and one WARNING `EmitAlert` (category `strategy`). The
  state is in-memory, so a restart re-alerts at most once. UNKNOWN, DISABLED and NOT_ASSESSED change
  nothing. `SetStrategyLive` does not check availability.
- **Opportunity skip row.** This applies to **entry** candidates only; a held symbol keeps its
  exit/REDUCE row. An UNAVAILABLE candidate becomes a non-actionable row:
  - action UNSPECIFIED, conviction and signal axis 0, NULL composite;
  - the `"fundamentals_unavailable"` provenance marker, which is structural (never a source/facet)
    and exempt from the conviction floor;
  - the `fundamentals_gap` label in `readiness_json`.

  It is mutually exclusive with the `"unavailable"` data-unavailable row. An UNKNOWN candidate stays
  a row-local `"unavailable"` row with its action preserved. The 300s heal re-assesses the row and
  can rewrite it to the skip row (`replace_symbols` writes `action` via `COALESCE`).
- **Snapshot quota ripple.** The snapshot loaders use single-symbol `GetFundamentals`. An uncached
  symbol at the vendor quota (`RESOURCE_EXHAUSTED`, common under the default `finnhub` per-minute
  cap) therefore reads UNKNOWN. That stamps the opportunity row `"unavailable"` and retries it every
  300s; it is never a skip row or a live state change.
- **Formula refusal (feature 289).** A refused `GetFormula` (`UNREADABLE_FORMULA_CODES`) is "not a
  fundamentals formula" and records no UNKNOWN. This holds in `_formula_fundamentals` and in
  `_declared_formula_warmup`, so both backtest start branches agree. An outage still records UNKNOWN.
  - The symbol reaches `ExecuteFormula`, so a backtest gets `NO_TRADE_REASON_FORMULA_ERROR`, not the
    `fundamentals fetch failed … rerun` warning.
  - ScoreStrategy does not abort on it.
  - Opportunities and the heal get the `formula_unreadable` marker.
  - Gate OFF is unchanged. The live twin `evaluator.declared_formula_fundamentals` still records
    UNKNOWN for a refusal (pinned by test).
  - `recompute_unscored_pairs` keeps one formula cache per owner, so one owner's refusal cannot drop
    the guard for another owner who can read the formula.
- **Evidence exclusion (H).** Grade derivation reads every cell for the current fingerprint
  (`fetch_all_for_fingerprint`). It drops cells the guard refuses over each cell's window **before**
  the per-symbol dedup, and never deletes a cell. UNKNOWN keeps the previous grade with a warning.
  ScoreStrategy aborts UNAVAILABLE on UNKNOWN, and NOT_FOUND when every evidence symbol is excluded.
  A successful ScoreStrategy sets trailing metadata `x-score-excluded-symbols` (JSON array of the
  symbols left with no surviving cell; `"[]"` when none or when the guard does not apply; omitted
  above 4096 bytes and on every abort path), consumed by the agent's `manage_strategy operation='score'`.
  A refused-only RunBacktest still triggers the recompute.
  - **Gate-off re-includes refused cells** (Open Risk 3), because the exclusion is non-destructive.
    With the gate ON the same exposure now applies to a refused formula that really declares
    fundamentals: its cells are no longer guarded (feature 289, accepted).
  - Post-deploy, a manual `ScoreStrategy` refresh clears a legacy 0-trade ETF contribution from a
    fundamentals strategy's grade.

**Fixed invariants** (not config keys):

- `_FUND_PAGE_SIZE = 200`, `_MAX_FUND_PAGES = 8` and `_FUND_PAGE_TIMEOUT_SECONDS = 10`. The PIT
  pager drains every page; a page-cap hit or a stalled token is UNKNOWN, never a refusal.
- `_INTERACTIVE_DERIVATION_CONCURRENCY = 4` bounds an interactive recompute's PIT fan-out. It uses a
  local semaphore, never the materializer's.

# Design: backtest-time-window

**Created**: 2026-07-26
**From**: recon.md + product-spec.md
**Rounds**: 2 proposer rounds + 2 adversary passes (round 1 BLOCKED on an F-07 Floor breach;
round 2 verified and corrected). Termination: approved after Floor clearance.

---

## Chosen Approach

Derive a **declared** pre-window prefix in *bars* from the strategy's own parameters, fetch
`[start − prefix_calendar_days, end]` through a bounded paginated helper, truncate to exactly `P`
prefix bars, and thread an explicit `trade_start_idx` through both engine loops — applied **only**
when the caller set `start`.

### 1. Derived prefix, no day constant (clears F-07)

New pure module `services/xstockstrat-analysis/app/services/warmup.py`, shaped like
`app/services/cooldown.py` (ledger insight 069: a shared rule lives in one pure module that enforces
its own input contract). **Declaration-only — never observed**, because the quantity is needed
*before* the fetch.

`builtin_lookback_bars(indicator, params)` — derived from each engine's own recurrence, verified
line-by-line against `services/xstockstrat-indicators/app/services/indicators_engine.py`:

| Indicator | Lookback | Basis |
|---|---|---|
| SMA | `period` | valid at `period-1` (`:44`) **+1** |
| BB | `period` | valid at `period-1` (`:89-90`) **+1** |
| RSI | `period + 1` | `.diff()` NaN head (`:57`) + `rolling(period)` (`:58`) **+1** |
| ATR | `period + 1` | `.diff()` NaN head (`:108`) **+1** |
| STOCH | `period + 2` | `k.rolling(period)` (`:123-125`) → `d = k.rolling(3)` (`:126`) **+1** |
| EMA | `3 × period` | IIR convergence — see below (`:50`) |
| MACD | `3 × (max(fast, slow) + signal)` | IIR convergence (`:70-73`) |
| VWAP | `0` | expanding anchor, defined at index 0 (`:114-116`) |

**The universal `+1` is the crossover reference**, not a fudge: `crosses_above`/`crosses_below` read
index `i-1` (`app/services/evaluator.py:447-448`, `:455-456`), so a series valid at index `v` is only
*usable* at `v+1`. This rule is stated in `warmup.py`'s docstring so a future reader does not "fix"
the offsets away. The same derivation validates the legacy path's `slow_period`
(`app/handlers/servicer.py:228`): `slow_period-1` for the value at `i`, `+1` for `prev_slow` at `:673`.

**IIR convergence multiplier (adversary-corrected).** `_ema` uses `ewm(span=period, adjust=False)`
(`indicators_engine.py:50`) — infinite impulse response, no NaN head. `period` is a *convention*, not
a bound: after `period` bars the seed still carries `(1 − 2/(p+1))^p → e^-2 ≈ 13.5%` weight. FR-3
requires indicators be "already warm at `start`", which 13.5% seed contamination does not satisfy.
`3 × period` leaves residual < 0.3%. The cost is only extra *fetched* bars, which the truncation rule
below discards for free. **MACD uses `max(fast, slow)`, not `slow`** — nothing validates `fast <= slow`
(`_validate_definition`, `evaluator.py:276-323`, checks ref_names/indicator names/rule JSON only, never
params), so `fast=50, slow=26` would otherwise under-warm.

`required_prefix_bars(definition, formula_warmup_cache)` = max over the refs the **active rules**
reference, reusing the existing `referenced_refs` walk (`servicer.py:959`); a custom formula
contributes its declared `warmup_period` via the already-cached `GetFormula` (`servicer.py:970-981`).

`prefix_calendar_days(P) = ceil(P * 1.6) + 10`. **Sizing-only, and provably so**: after fetching, the
engine keeps exactly `bars[trade_start_idx - P :]`. A surplus is discarded deterministically; a
deficit (`trade_start_idx < P`) raises a shortfall. The factor can therefore only be too generous
(discarded) or too tight (reported) — never silently behavior-changing. The true requirement is
`P / 0.6899 ≈ 1.4495·P`, so 1.6 carries ~10% margin and `+10` absorbs holiday clustering at small `P`.
**Pinned by a test that doubles the factor and asserts a byte-identical `BacktestResult`.** This is
the same class as the accepted `MAX_PARAMETERS = 32` engine constant
(`services/xstockstrat-indicators/app/services/parameters.py:28`, documented as "No new config key —
the cap is engine-enforced" in that service's `CLAUDE.md:114`).

### 2. Prefix only on an explicit `start` (FR-2 is binding)

`start_set` / `end_set` already exist as locals at `servicer.py:278-279`, computed **before** the
in-place defaulting at `:294-297` destroys the distinction. Thread `warmup_prefix=start_set` as a
new keyword-only argument (default `False`) on `_backtest_symbol` / `_backtest_symbol_evaluated` at
the dispatch (`:316`, `:327`). Default `False` ⇒ every existing caller and test keeps today's
behavior exactly. `start` unset + `end` set ⇒ **no prefix** (that start was server-derived, not
caller-chosen). `max_range_days` is validated against `request.range` at `:280-288` — before and
outside the prefix — so FR-3a holds structurally.

### 3. Explicit `trade_start_idx`; `warmup_bars` stays meaningful

Both trade loops (`servicer.py:663-679` legacy, `:864-916` evaluator) iterate
**`for i in range(max(1, trade_start_idx), n)`** with one `daily_equity.append(...)` per iteration.

> **Adversary correction — do not use `range(trade_start_idx, n)`.** Today the legacy loop is
> `daily_equity = [equity]` (`:659`) then `for i in range(1, n)` (`:663`) with exactly one append per
> iteration (`:669`, `:678`, `:754`) ⇒ `len(daily_equity) == n`. Looping from `trade_start_idx` with
> an unconditional append makes `i=0` append without simulating ⇒ `len == n+1` with a duplicate seed
> point, which perturbs the returns series feeding `_compute_metrics`, moves
> `trading_days = len(daily_eq) - 1` (`:357`) from `n-1` to `n`, and shifts every `diags[i].equity`
> stamp (`:1612-1613`). Using `max(1, trade_start_idx)` makes the bound and the simulate guard
> coincide for every `k`.

**Diagnostics shape at `k > 0` (decided — the adversary correctly refused to let this be deferred).**
The diagnostic-build passes are *separate* loops at `servicer.py:634` (legacy) and `:829` (evaluator).
We **slice `diags` to the in-window bars** (`[k:]`) and renumber `bar_index`, with
`bars_total = n - k`. Rationale: prefix bars are internal seeding, not something the caller asked to
see; slicing keeps `len(daily_equity) == len(diags)` — the 1:1 invariant
`_finalize_symbol_diagnostics:1611-1617` depends on — and keeps the persisted feature-068 detail
bytes describing exactly the requested window. That invariant is currently *implicit and unasserted*,
so we add an explicit `len(daily_equity) == len(diags)` assertion **in both paths** (ledger fail
056/C-10(b): the two loops are structurally different — the legacy path has two
`continue`-with-append branches at `:668-670`/`:677-679`, the evaluator appends unconditionally at
`:918`).

`warmup_bars` is **not** forced to 0:
`to_reported_warmup(first_valid_full_index, trade_start_idx) = max(0, first_valid_full_index − k)`.
On every default/rolling run `k = 0` and the value is exactly today's, so
`ACTION_LABEL[BarAction.WARMUP]` (`BacktestDiagnostics.tsx:11`),
`NO_TRADE_MESSAGE[ENTIRE_RANGE_WARMUP]` (`:20-21`) and the warm-up band (`:137`, `:153`) all stay
reachable. On a successfully-prefixed run it is legitimately 0 — there *is* no in-window warm-up.

**Unit conflation resolved structurally**: `required_prefix_bars` is a declared **bar count**
(pre-fetch); `_compute_evaluated_warmup` (`:949-984`) keeps returning a full-series **first-valid
index** (post-fetch). `to_reported_warmup` is the single site mapping index-space → reported-space.

### 4. Bounded pagination

One shared `_fetch_bars_paged(symbol, range_msg, meta)` replaces both single-shot `GetBars` calls
(`:551-559`, `:802-810`), sending `page=common_pb2.PageRequest(page_size=…)`.

- **Max-page bound** `_MAX_BAR_PAGES = 32`. **Exhausting it raises `_InsufficientData` — it never
  returns a partial series.** This sentence is load-bearing for F-07: returning accumulated bars
  would silently truncate the newest data as a function of the config-driven
  `analysis.backtest.max_range_days` (`servicer.py:276`), reintroducing recon Risk 1 at a higher
  threshold.
- **Strict cursor monotonicity**: each page must contribute ≥1 bar strictly newer than
  `last_seen_time`; otherwise terminal. This defeats the `marketdata_repo.go:78-83` unparseable-token
  loop (`cursor = start` ⇒ identical page + identical token) by construction.
- **No empty-token probe.** Round 2 proposed one; the adversary proved it dead code:
  `QueryBars` runs `LIMIT pageSize+1` (`marketdata_repo.go:92`) and sets `nextToken` iff
  `len(bars) > pageSize` (`:130-135`), so a full page with an empty token is genuine EOF. (It was
  also mis-specified — a naive `isoformat()` token is rejected by `time.Parse(RFC3339Nano, …)`,
  silently falling back to page 1.)

Pagination applies to the **default path too**, and that **is a behavior change**, stated plainly:
today a 730-day default (~504 trading days) is silently truncated at 500
(`marketdata_service.go:124` + `ORDER BY time ASC LIMIT`, `marketdata_repo.go:88-90`), so
`trading_days` moves 499 → ~503. Gating pagination behind `warmup_prefix` was rejected — it would
leave the truncation bug in the most-used path and make the agent (no range) and UI (range) disagree,
an FR-6 violation in the other direction.

*Noted, no code change*: `fetchAndCacheBars` (`marketdata_service.go:163-165`, contract comment
`:177`) serves `live[:pageSize]` with no token if a cache write fails, so `page_size` is not purely
cosmetic on that degraded path. Pre-existing and outside this feature.

### 5. Per-consumer range plumbing (explicit)

| Consumer | Range |
|---|---|
| `GetBars` bars fetch | **prefixed** (only when `warmup_prefix`) |
| `QuerySignals` `active_window` (`:613`) | **caller-requested** — widening would silently change signal scoring (out of scope) |
| `CoverageGap.requested_range` (`:376`) | **caller-requested** |
| `CoverageGap.gap` (`:378`) | prefix shortfall ⇒ `[start − prefix, start]` (the actionable backfill range) via a new optional `gap_range` on `_InsufficientData` (`:59-70`) |
| feature-065 cells + `backtest_runs` (`:453-456`, `:482-488`) | **caller-requested** |

### 6. Open-question answers

- **OQ-1 (shortfall)** — surfaced through the existing `_InsufficientData` → `CoverageGap` →
  `:439-442` status gate. **No new `NoTradeReason` value**, avoiding the exhaustive
  `Record<NoTradeReason, …>` compile-coupling trap (recon Risk 6; ledger fail 2026-07-21/067).
- **OQ-2 (lookback source)** — derived from declared parameters. No new config key.
- **OQ-3 (feature-065 cells)** — existing cells are **left as-is, not invalidated**. No migration, no
  marker. They remain valid evidence for the window they recorded, and a ≈0.8% `trading_days` shift
  is immaterial against `k = 250` shrinkage. Related and accepted: Past Runs will mix pre/post-change
  detail bytes with no marker (feature-068 comparability).
- **OQ-4 / FR-7 (live loop)** — **backtest path only; the live loop is untouched.** FR-3 does *not*
  close the parity gap. `live_loop.py:116-121` keeps its 365-calendar-day (~252 bar) window with no
  shortfall detection (`if not bars: return`, `:130-131`) and reads `decisions[-1]` (`:137`). The
  evaluator contract is unchanged, so the real invariant — *same bar series ⇒ same decisions* — still
  holds exactly; what differs is the input series each caller supplies. The `3×` IIR multiplier
  materially narrows the residual gap for EMA/MACD but does not eliminate it.

### 7. VWAP anchor — documented behavior change

`_vwap` is `cumsum(arr) / arange(1, n+1)` (`indicators_engine.py:114-116`), an expanding average
anchored at index 0, so its own lookback is correctly `0`. But `P` is the max over *all* referenced
refs, so a strategy mixing VWAP with e.g. `SMA(50)` gets `P = 50` and **every in-window VWAP value
shifts** — its anchor moves from "requested range start" to "prefix start". Deterministic (FR-4
holds), but different from today. **Documented explicitly** in the service `CLAUDE.md` and pinned by
`test_vwap_anchor_moves_with_prefix`. Special-casing the anchor was rejected: it would require a
second indicators call and diverge further from the live loop.

---

## Rejected Alternatives

- **`WARMUP_PREFIX_DAYS = 365` constant (round 1)** — F-07 breach. Its `p >= w` safety check was
  provably *inert* for the indicators that matter most: `_ema` (`:48-51`), `_macd` (`:62-84`) and
  `_vwap` (`:110-118`) emit no `None` head, so `_first_resolved_index` (`:1582-1588`) returns 0 and
  `w == 0` makes the check trivially true.
- **A new `analysis.backtest.warmup_prefix_days` config key** — clears F-07 but keeps a
  behavior-determining knob and inherits the `get_int` zero-trap (`watcher.py:68-74`: a configured `0`
  reads back as the default, so "no prefix" is inexpressible). Deriving keeps one source of truth,
  which product-spec OQ-2 already preferred.
- **Prefixing the defaulted (no-`start`) range** — would require `730 + prefix` days of history, so
  ordinary ~2-year-backfilled symbols would flip to `INSUFFICIENT_DATA`. Direct FR-2 violation.
- **Forcing `warmup_bars = 0` and slicing in the caller (round 1)** — orphans three live UI surfaces
  with *no compile-time protection* (the inverse of ledger fail 067, and therefore worse: TypeScript
  cannot catch an enum value becoming unreachable).
- **`period` as the EMA/MACD prefix** — leaves ~13.5% seed weight; fails FR-3's "already warm" on its
  plain meaning and manufactures a fresh backtest/live divergence. Rejected in favour of `3×`, whose
  only cost is discarded fetch volume. Accepted trade-off: a wider shortfall surface (more symbols
  reporting `CoverageGap`).
- **Merging pagination into a `max_range_days`-derived page bound** — self-scaling and hazard-free,
  but adds a config read to a low-level fetch helper. Failing loudly at a fixed 32 is simpler and
  sufficient once exhaustion raises.
- **`STRATEGY_OPERATION`-style special-casing of the VWAP anchor** — see §7.

## Open Risks

| Risk | Mitigation | Target step |
|---|---|---|
| The `trade_start_idx` restructure touches the two hottest paths for what must be a no-op at `k = 0`; the `daily_equity` ↔ `diags` 1:1 seam is implicit and unasserted today | Land the offset with `trade_start_idx = 0` and require **byte-identical** results *before* any prefix code exists; add `len(daily_equity) == len(diags)` assertions in **both** paths | Step 3 |
| Built-in default periods must be duplicated in analysis (`evaluator.py:187` forwards only `dict(comp.params)`; defaults live in `indicators_engine.py:43,49,55,66-68,86,105,121`, and `INDICATOR_REGISTRY.required` is never enforced — its only consumer is `ListIndicators`, `indicators/servicer.py:192`) | Pinning test **in `xstockstrat-indicators`** whose assertion message names `services/xstockstrat-analysis/app/services/warmup.py` as the consumer to update; replicate the engine's exact `int(params.get(...))` truncation | Step 1 |
| Pagination changes default-path `trading_days` 499 → ~503 | Documented in `context.md` + service `CLAUDE.md`; cells left as-is (OQ-3) | Step 2 |
| Custom-formula sandbox cost on a longer series | Exact-`P` truncation caps growth at the declared warm-up (a 20-bar formula over 504 bars is +4%). Measure before shipping; pass if p95 ≤ 50% of `indicators.sandbox.timeout_ms` | Step 6 |
| A custom formula receives the whole `closes` array (`evaluator.py:186`) and can look ahead arbitrarily | Pre-existing; the prefix neither creates nor worsens it. Footnote only | — |

## Constitution Rules Touched

| ID | How honored |
|---|---|
| **F-07** | No hardcoded config value. The prefix is derived per-strategy; `1.6/+10` is sizing-only (surplus discarded, deficit reported) and pinned by a factor-doubling byte-identity test; `_MAX_BAR_PAGES` exhaustion **raises** rather than truncating |
| **F-04** | Every symbol/path cited from `recon.md`; recon's `## Not found` items are treated as new code, not assumed helpers |
| **C-01** | All steps carry `path:line` evidence |
| **C-05** | No new config key introduced |
| **C-08 / P-06** | Every engine step pairs with a test; step 3 is gated red-before-green on byte-identity |
| **C-09** | No proto change ⇒ no `buf` gate needed, but `./scripts/buf-gen.sh` must still show an empty diff |
| **C-10** | The three exhaustive-`Record` UI surfaces stay reachable (`k = 0` on every default run); agent↔UI parity test (FR-6); backtest/live parity pinned by two tests (FR-7); `len(daily_equity) == len(diags)` asserted in **both** engine paths (ledger 056) |
| **C-12** | Backtest-result fixtures centralized into `e2e/fixtures/` per `INVENTORY.md:35-37,47` when the UI parity test touches them |
| **P-03** | Every mechanism verified against its producer before designing on it (the `_ema`/`_macd`/`_vwap` no-`None`-head check, the `LIMIT pageSize+1` pagination contract, the naive-datetime token rejection) |

## Build Order

1. `app/services/warmup.py` + pure unit tests (no I/O); indicators-side defaults pinning test.
2. `_fetch_bars_paged` + `_BarFetchError`; swap both call sites. Tests: page bound raises,
   identical-page loop terminates, monotonicity. Record the `trading_days` shift + OQ-3 answer.
3. `trade_start_idx` plumbing + shared loop restructure with `trade_start_idx = 0` everywhere.
   **Gate: byte-identical results** — extend `test_backtest_reproducible_across_runs` (`:2274`) and
   `TestBacktestDiagnostics` (`:1003`).
4. Wire the prefix end-to-end: `start_set` → `warmup_prefix` → `required_prefix_bars` → prefixed
   fetch → truncate to exactly `P` → `trade_start_idx` → `to_reported_warmup` → shortfall
   `CoverageGap`. Extend `test_no_look_ahead_warmup_and_series` (`:1086`),
   `test_formula_warmup_uses_declared_not_observed` (`:1158`), `TestBacktestRangeCap` (`:1311`),
   `TestRunBacktestCells` (`:1494`).
5. Agent surface: `client.run_backtest` + `run_backtest` tool, reusing `_iso_to_timestamp`
   (`client.py:35-41`) and the `trigger_backfill` `TimeRange` template (`:686-693`, `:705-712`).
6. Parity/determinism tests: FR-6 agent↔UI same-range equality; FR-4 frozen clock;
   `all(t.entry_time.seconds >= requested_start.seconds)`; the two FR-7 tests; the prefix-factor
   insensitivity test; `test_vwap_anchor_moves_with_prefix`; formula cost measurement.
7. Docs: tool docstring, `docs/runbooks/mcp-tools.md:241-257`, analysis `CLAUDE.md` (warm-up prefix,
   VWAP anchor note, FR-7 divergence, `trading_days` shift).
8. UI e2e (`mock-backend.ts:457-531` must honor `req.range`) + C-12 fixture centralization.

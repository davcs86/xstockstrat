# Debate Register: fix-indicator-pane-warmup

**State**: in-debate
**Mode**: full
**Rounds run**: 3 (round numbers continue across runs; the mode's 2–5 / 1 bounds count this run only)

## Rounds

| Round | Date | Run by | +D | +R | O closed | +O | Petitions | Progress |
|---|---|---|---|---|---|---|---|---|
| 1 | 2026-11-15 | /sdd-batch | 6 | 4 | 0 | 11 | 0 | yes |
| 2 | 2026-11-15 | /sdd-batch | 7 | 4 | 7 | 6 | 0 | yes |
| 3 | 2026-11-15 | /sdd-batch | 4 | 3 | 9 | 5 | 0 | yes |

## Settled Decisions

<!-- Status: settled → superseded by D-m (only after a user-approved REOPEN) -->
| ID | Round | Decision | Evidence | Status |
|---|---|---|---|---|
| D-1 | 1 | Root cause is in the UI request, not the analysis series builder; FR-1 needs no compute change. | `page.tsx:252-257` sends exactly the 200 drawn closes; `servicer.py:4545`, `:4606` compute only on the closes given. The adversary concurred. | settled |
| D-2 | 1 | P is declared by analysis through one additive field (number 5) on `ComponentSeries`. There is no request field, no server trim and no UI lookback table. | `analysis.proto:819-827` (next free field 5); `warmup.py:70`, `:147-155`. The adversary called Option B the right fork. | settled |
| D-3 | 1 | History is fetched as a newest-page `GetBars` read with a larger named `pageSize` D, never a widened `range.start`. | fails.md oldest-page trap; `marketdata_service.go:301-303`, `marketdata_repo.go:181-183`. | settled |
| D-4 | 1 | The chart and panes draw only the last W bars; the prefix is used for compute only. | Panes share the candlestick time scale: `IndicatorPanels.tsx:93-104`, `page.tsx:269`. | settled |
| D-5 | 1 | D is a named UI constant, not a config key, and is not an F-07 breach; design.md records the rationale. | Existing inline `pageSize: 200` at `page.tsx:256`; the spec forbids new config keys; the adversary found no Floor breach. | settled |
| D-6 | 1 | FR-2 is a non-error, non-chart per-component pane state gated through `isChartable`. | `IndicatorPanels.tsx:19-21`, `:172-176`. The adversary did not contest it. | settled |
| D-7 | 2 | P is first-value bars (first valid index + 1), in a field named `first_value_bars`. EMA/MACD = 1 and VWAP = 0. Converged sizing stays backtest-only. | `warmup.py:12-17`, `:84`, `:89`, `:111`; the spec defines P as bars to the first value. The adversary said O-2 can close. | settled |
| D-8 | 2 | `source_symbol`, FUNDAMENTAL and fundamentals-only custom formulas (`formula_fund_map` hit) report 0. Other custom formulas report `declared + 1 if declared else 0`. | `servicer.py:4576-4604`; `warmup.py:153`; `indicators.proto:174`. The adversary said O-3 can close. | settled |
| D-9 | 2 | Formula `warmup_period` is read through an optional `warmups` out-param on `_formula_fundamentals`, from its existing `GetFormula` call. There is no second pass. | `servicer.py:1914-1947` (the `failures` out-param pattern at `:1915`, `:1941-1942`). The adversary said O-6 can close. | settled |
| D-10 | 2 | The single slice seam is `IndicatorSection`, calling a pure `windowIndicatorSeries` in `src/lib/indicatorChart.ts` that returns windowed components, times and the insufficient set together. It is not in the hook's `select`. The candlestick draws the same last W bars. | `page.tsx:1324-1353`, `:261-270`; `IndicatorPanels.tsx:65`, `:101`. The adversary agreed with rejecting the hook seam. | settled |
| D-11 | 2 | FR-2 fires only when the bars page came back short (history exhausted), there is no error, and P > H. A full page degrades to leading gaps. | `page.tsx:261`; `marketdata_repo.go:181-183`. The adversary did not contest it. | settled |
| D-12 | 2 | The 'Not enough history' pane renders through `Eyebrow` + `EmptyState` with testid `indicator-panel-insufficient`. | `EmptyState.tsx:7`; `CardNotice.tsx:13` would nest inside the Card at `page.tsx:1358`. The adversary said O-9 can close. | settled |
| D-13 | 2 | VWAP anchor drift and the transient false FR-2 from a short live page are accepted residuals, recorded in design.md. | `warmup.py:108-111` (mitigation would need the locked R-4); `marketdata_service.go:417-427`. The adversary said O-5 and O-10 can close as recorded. | settled |
| D-14 | 3 | `windowIndicatorSeries` takes `times` and H from the response and derives `historyExhausted` from `series.times.length < HISTORY_BARS`. `IndicatorPanels` receives the windowed response times. The query key adds the last bar's time as `String(seconds)`. The page stores no `historyExhausted`. | Operator steer for round 3; `servicer.py:4634-4636`, `page.tsx:1350`, `useIndicatorSeries.ts:16`. The adversary said O-1 can close. | settled |
| D-15 | 3 | `HISTORY_BARS = 1000` (D) and `CHART_WINDOW_BARS = 200` (W) are exported from `src/lib/indicatorChart.ts`. D is one fixed depth with no escalation refetch. | Operator ruling 2026-11-15 (expand the fetches, keep D = 1000); `page.tsx:256`. The adversary said O-4 can close. | settled |
| D-16 | 3 | Marketdata gains one OTel counter for ohlcv SQLSTATE 53200 errors with a closed `op` label, built on the existing lazily-bound `NewCounter` and recorded at the repository error seam. Its exact hook sites and name are open under O-19 and O-20. | Operator ruling 2026-11-15 (add a metric to monitor lock-budget breaches); `otel.go:184-205`, `:367-372`; `marketdata_repo.go:180-192`. | settled |
| D-17 | 3 | `first_value_bars` is computed directly (SMA/BB = period, RSI/ATR = period + 1, STOCH = period), with a pytest pin `first_value_bars + _CROSSOVER_LOOKBACK == builtin_lookback_bars` for SMA/BB/RSI/ATR. | `warmup.py:58-59`, `:71`, `:93`. The adversary said O-13 and O-14 can close. | settled |

## Rejected Alternatives (locked)

<!-- Status: locked → reopened @ round N (user, context.md <ISO>) -->
| ID | Round | Alternative | Why rejected | Status |
|---|---|---|---|---|
| R-1 | 1 | UI-side lookback table, or sizing the fetch depth from client strategy params. | Duplicates `warmup.py` (DRY), and formula `warmup_period` is known only to analysis. | locked |
| R-2 | 1 | Widened `range.start` on `GetBars` to fetch the prefix. | Returns the oldest page (fails.md trap). | locked |
| R-3 | 1 | Server-side prefix fetch for the evaluated symbol in `GetIndicatorSeries`. | Reverses feature 125's 'no server re-fetch' contract (`analysis.proto:806-808`); needs an operator decision. | locked |
| R-4 | 1 | Request field `window_bars` with a server-side trim. | Adds a second proto field; the slice is fixable in one UI seam. | locked |
| R-5 | 2 | Converged P (3p+1) for EMA/MACD as the FR-2 threshold, with or without UI head-masking. | It contradicts the spec's first-value definition of P and hides lines that render today. Both sides agreed on first-value P. | locked |
| R-6 | 2 | Slice seam in the `useIndicatorSeries` `select`. | `historyExhausted` and W live in the page, so the hook would need page knowledge. The adversary concurred. | locked |
| R-7 | 2 | `CardNotice` for the insufficient-history pane. | It wraps its own `Card` and would nest inside the Indicators `Card`. | locked |
| R-8 | 2 | Slicing response series against the page's `times` prop. | Values and axis come from different requests when the cached series is stale, so the panes misalign by one bar per new bar. | locked |
| R-9 | 3 | Shrinking D below 1000 (e.g. W + 300). | The operator ruled to keep the larger history page rather than size D down. | locked |
| R-10 | 3 | Server-guided escalation: a small first-load D with one refetch sized from the server's `first_value_bars`. | It was held only in case a single fixed D was not accepted. The operator accepted D = 1000, and escalation needs sticky-depth state. | locked |
| R-11 | 3 | A `marketdata.ohlcv.scan_window_days` histogram as a leading lock-budget signal. | The operator asked for a breach counter; both sides agreed the histogram is not needed (C-18). | locked |

## Objections

<!-- Status: open → closed @ round N (<how>) | waived @ round N (user) | reopened @ round N (user) -->
| ID | Round | Objection | Blocking | Status |
|---|---|---|---|---|
| O-1 | 1 | Slice seam: `tailWindow` must run at one seam (hook `select` or `IndicatorSection`) that returns sliced components, times and H together, so `IndicatorPanels` never sees D-length arrays; add a vitest index-alignment case. | yes | closed @ round 3 (`windowIndicatorSeries` takes times, H and exhaustion from the one response; the last bar's time joins the query key as a string; a stale-cache alignment vitest is added.) |
| O-2 | 1 | Which P for EMA/MACD: adopt first-value P (EMA/MACD = 1, VWAP = 0) with the field named for that meaning, or justify converged P with head-masking and operator sign-off. | yes | closed @ round 2 (First-value P adopted: EMA/MACD = 1, VWAP = 0, field named `first_value_bars`. No head-masking and no operator sign-off needed.) |
| O-3 | 1 | Fundamentals-only custom formulas (`formula_fund_map`) must report 0, with a pytest case. | yes | closed @ round 2 (Fundamentals-only formulas, FUNDAMENTAL and `source_symbol` report 0, with a pytest case.) |
| O-4 | 1 | FR-2 may fire only when bars < requested pageSize; drop the escalation refetch, or specify a sticky depth keyed on (symbol, strategyId). | yes | closed @ round 3 (FR-2 fires only on a short page. D is one fixed depth (1000, operator ruling) and there is no escalation refetch.) |
| O-5 | 1 | VWAP anchor drift from sending D closes: record as accepted or mitigate. | no | closed @ round 2 (VWAP anchor drift accepted and recorded in design.md. Mitigation would need the locked R-4.) |
| O-6 | 1 | Read formula `warmup_period` from the existing `_formula_fundamentals` `GetFormula` response; add no second pass (C-18). | no | closed @ round 2 (`warmup_period` comes from an optional `warmups` out-param on `_formula_fundamentals`, using the existing `GetFormula`. No second pass.) |
| O-7 | 1 | Proto field comment must state the meaning of 0 (fail-open) and that the value is per-component; update the comments that become false at `analysis.proto:806-808`, `useIndicatorSeries.ts:6-7`, `page.tsx:132-133`. | no | closed @ round 3 (The field comment states the meaning of 0, that the value is per component, and that a multi-series component uses its earliest series. The three stale comments are rewritten.) |
| O-8 | 1 | W must be a parameter; vitest covers AC-1..AC-4 exactly (W = 190 and 100); e2e uses W = 200 fixtures with INVENTORY rows (C-15/C-08/C-12). | no | closed @ round 3 (W is a parameter; vitest covers AC-1..AC-4 at W = 190 and 100 plus the stale-cache case; e2e uses W = 200 fixtures with INVENTORY rows.) |
| O-9 | 1 | Render the 'Not enough history' pane through `CardNotice`/`EmptyState` with token colours (C-17). | no | closed @ round 2 (Rendered through `EmptyState` with a new testid. `CardNotice` rejected because of the nested Card.) |
| O-10 | 1 | Record the transient false FR-2 from a short live marketdata page (`marketdata_service.go:417-427`) as an accepted residual. | no | closed @ round 2 (The transient false FR-2 from a short live page is recorded as an accepted residual in design.md.) |
| O-11 | 1 | Record in design.md why D is not an F-07 config value. | no | closed @ round 2 (design.md records that D and W are UI page-size literals beside the existing `pageSize: 200`, not F-07 config values.) |
| O-12 | 2 | D sizing against the lock budget: `HISTORY_BARS = 1000` makes the implicit `GetBars` window 3000 days (`marketdata_service.go:467-477`) and widens the staleness refetch and upsert. design.md must compute the AC-1 chunk-lock inequality (`docs/runbooks/ohlcv-lock-budget-tuning.md:41-52`) for D, or shrink D (e.g. W + 300), and record the trade-off against unexplained leading gaps. | yes | open |
| O-13 | 2 | Pin `first_value_bars == first_valid_index + 1` per family in pytest and name the `_CROSSOVER_LOOKBACK` dependency (`warmup.py:58-59`, `:71`), or compute it directly (C-18). | no | closed @ round 3 (`first_value_bars` is computed directly, with a pytest pin against `builtin_lookback_bars` and the `_CROSSOVER_LOOKBACK` dependency named in the helper comment.) |
| O-14 | 2 | STOCH P must be the earliest series' first-value bar (`k`, P = period), not period + 2, so FR-2 never hides a `k` line that has values (`warmup.py:93`). | no | closed @ round 3 (STOCH P = period, the earliest series' (`k`) first-value bar.) |
| O-15 | 2 | Record in design.md the accepted growth in analysis compute per request (D closes per component call, `servicer.py:4575`, `:2044-2048`). | no | closed @ round 3 (The growth in analysis compute per request with D is recorded in design.md as accepted.) |
| O-16 | 2 | Record in design.md the `source_symbol` fail-open residual: a benchmark with too little history of its own never shows FR-2. | no | closed @ round 3 (The `source_symbol` fail-open residual is recorded in design.md.) |
| O-17 | 2 | Cite `indicators.proto:174` in design.md as the basis for formula P = `warmup_period + 1`, instead of listing it as unverified. | no | closed @ round 3 (design.md cites `indicators.proto:174` as the basis for formula P = `warmup_period + 1`.) |
| O-18 | 3 | C-16: D = 1000 puts marketdata `@AC-1` (`services/xstockstrat-marketdata/acceptance/fix-ohlcv-chunk-lock-oom.feature:11-15`, feature 153) at risk. Add xstockstrat-marketdata to Affected Services in the product-spec and recon, list the rule as PRESERVE-at-risk or CHANGE with operator sign-off in `context.md`, and state the residual in design.md. | yes | open |
| O-19 | 3 | C-08: the breach counter must wrap every returned error in `QueryBars` (`marketdata_repo.go:119-121`, `:125-128`), `QueryRecentBars` (`:190-192`, `:195-198`), `QueryBarsBatch` (`:487-489`, `:492-494`) and `InsertBars` (`:63-95`) through one `observeLockBreach(ctx, op, err) error` passthrough, because pgx v5 delivers most server errors through `rows.Err()`. The Go test must inject 53200 through `rows.Err()`. Must be fixed before spec. | no | open |
| O-20 | 3 | SQLSTATE 53200 is `out_of_memory`, not only lock-table exhaustion (fails.md:3060). Name the instrument for what it counts, or document the lock-table assumption in the marketdata `CLAUDE.md` § Observability. | no | open |
| O-21 | 3 | Record in design.md the added pool hold time on marketdata's 2-connection pool (signal: `marketdata.db.pool.empty_acquire_wait`) and that the pre-004 1-day chunks stay in the read window until about 2034 (`ohlcv-lock-budget-tuning.md:118-122`). | no | open |
| O-22 | 3 | The 3× slack in `defaultBarLookback` (`marketdata_service.go:467-477`) is the real lock multiplier. State in design.md whether a timeframe-aware slack is offered to the operator as the O-12 mitigation, or why it is out of scope. | no | open |

## Reopen Petitions

<!-- Verdict: dropped (evidence not new — already on record at <ID>) | pending user | user reopened | user declined -->
| ID | Round | Target | New evidence | Verdict |
|---|---|---|---|---|

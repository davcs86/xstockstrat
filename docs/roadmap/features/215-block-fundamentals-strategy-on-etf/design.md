# Design: block-fundamentals-strategy-on-etf

**Created**: 2026-10-10
**Rounds**: 4 (quick mode extended by operator at each gate; termination: approved — round-4 adversary SOUND, no Floor breach)
**Approved by**: user @ 2026-10-10 (AskUserQuestion "Approve with fixes")
**Grounded in**: recon.md

Operator decisions binding this design (full record in context.md): hybrid detection (enforce on unavailable
fundamentals, label via FMP `isEtf`); opportunity non-actionable skip row; live deny-entry + WARN/alert on state
change; C-16 CHANGE sign-offs (`@AC-8 @feature-201` note, `@AC-2 @feature-185` rescoped); H = exclusion at
grade-derivation time.

---

## Chosen Approach

**Carried over unchanged from round 3 (A–G, I, J).** The adversary verified all of these.
- Pure guard module `app/services/fundamentals_guard.py`. The predicates move there from `servicer.py:5999,6005`, and `live_loop.py:38-42` imports them from it.
- `evaluator.fundamental_component_inputs(...)` is shared with `_fundamentals_formula_series`.
- `would_execute` is the OR of the evaluator's per-epoch `if present:` check (`evaluator.py:555-556`).
- The guard looks only at in-window dates. The as-of rule is strictly `filed_date < d` (`evaluator.py:77-98`).
- `failures` is keyed by `(channel, symbol)` and lives as long as the per-pass cache.
- The snapshot loaders switch to the single-symbol `GetFundamentals`.
- Live: deny entry, plus one WARN and one alert when a pair enters the unavailable state.
- Opportunities: an entry skip row (resolve the action, drop on `None`, then force `UNSPECIFIED`). Held exit/REDUCE rows are preserved.
- `replace_symbols` writes `action = COALESCE($11::int, action)`.
- `GetEtfFlags` is cache-only with a background fill.
- Marketdata adds an `errNoEdgarSnapshot` sentinel: NotFound on the single-symbol RPC, omitted in Multi.
- Proto numbers: `NoTradeReason`=5, `FundamentalsGap{UNSPECIFIED, ETF, NOT_ETF}`, `SymbolDiagnostics.fundamentals_gap`=6, `Opportunity.fundamentals_unavailable`=23, `Opportunity.fundamentals_gap`=24.
- No migration.

**Guard states (final).** `NOT_REQUIRED | NOT_ASSESSED | AVAILABLE | UNAVAILABLE | UNKNOWN | DISABLED`. Precedence: UNAVAILABLE > UNKNOWN > DISABLED > AVAILABLE.
- **NOT_ASSESSED** (new, fix 3): `eval_dates` is empty, or the caller passes `bars_failed=True`. It has no guard semantics; the row or run follows today's path.
- **DISABLED** comes only from the snapshot channel. Only the two snapshot loaders map `FAILED_PRECONDITION` to DISABLED. The PIT loaders record any non-NotFound error as UNKNOWN, because `GetHistoricalFundamentals` has no gate (`marketdata_service.go:1719`).

### H. Exclusion at grade-derivation time (non-destructive, operator decision of 2026-10-10)

- **Where.** `_fetch_and_aggregate(user_id, strategy_id, strategy_row, *, fund_cache=None, failures=None)` (`servicer.py:2461-2474`).
  - After `fetch_eligible` (`backtest_run_symbols.py:63-82`, unchanged), it calls a new `_exclude_refused_cells(user_id, definition, cells, fund_cache, failures)` and passes the surviving cells to `_derive_score_from_cells`.
  - The definition comes from `_row_to_strategy_definition(row)` (`servicer.py:2944`).
- **When it does nothing.** No fundamental operand, or the gate `analysis.backtest.fundamentals.enabled` is off. The guard returns NOT_REQUIRED and no RPC is made.
  - So every non-fundamentals strategy, and every strategy while the gate is off, derives byte-identically (C-16 PRESERVE `@AC-3 @feature-149`).
- **Per cell (the one per symbol that `fetch_eligible` picks).**
  - Load PIT through the existing `_load_fundamentals(symbol, definition, meta, sem=self._readiness_materializer_bars_sem, cache=fund_cache, formula_fund_map=fmap)`, which now takes `failures`.
  - `fmap` comes from `_formula_fundamentals(definition, meta, cache=formula_cache)` (`:1669`): one `GetFormula` per distinct formula.
  - `meta = [("x-user-id", user_id)]`, the owner-identity precedent at `servicer.py:5474`. This makes the boot pass work with no inbound request.
  - The channel is PIT only (`fdata=None`), the same as backtest.
- **Window to dates.**
  - `start = range_start.date()`, or `date.min` if it is NULL.
  - `end = range_end.date()`. **If `range_end` is NULL** (legacy cells; the columns are nullable, `007_backtest_run_symbols.up.sql:19-20`, and `servicer.py:1140` writes `None` when the request leaves the end unset), use `completed_at.date()`. A run cannot have evaluated a bar after it completed.
  - `eval_dates = [start] + sorted({p.filed_date + 1 day : start < p.filed_date + 1 day <= end})`. The as-of value changes only at a filing boundary, so these epoch-boundary dates give exactly the answer `would_execute` would give over every calendar day in the window.
  - Calendar days are a superset of the trading days the backtest evaluated. So the derivation can only err toward AVAILABLE (keeping a cell); it can never drop a cell that the backtest would have accepted.
- **Decision.**
  - UNAVAILABLE: drop that symbol's cell, and log INFO `grade-derivation excluded symbol=… strategy=… window=…`.
  - AVAILABLE: keep it.
  - **Any UNKNOWN: raise `_GradeInputsUnknown`.** The existing callers already turn that into "keep the old grade":
    - `_recompute_headline` callers wrap it in `try/except → log.warning`: RunBacktest `:1184-1187`, boot `:2650-2653`, ManageStrategy UPDATE `:2940-2943`.
    - ScoreStrategy aborts with `UNAVAILABLE` (`:2340-2345`).
  - If every cell is excluded, the existing zero-evidence clear runs (`:2502-2509`).
- **Triggers.**
  - The existing triggers stay: RunBacktest OK, ScoreStrategy, ManageStrategy UPDATE, and the boot pass.
  - RunBacktest also triggers on `status == OK or fund_refusals > 0` (`:1183`). A refused single-ETF INSUFFICIENT_DATA run then clears a legacy SCHD-contaminated grade immediately.
  - The write path is unchanged: refused, UNKNOWN and NOT_ASSESSED symbols write no new cell (they are filtered before `_persist_symbol_cells`, `:1144-1153`). Nothing is ever deleted.
- **Bounded cost.**
  - **Calls per recompute:** at most (distinct evidence symbols) PIT calls plus (distinct formula ids) `GetFormula` calls.
  - **Shared caches:** RunBacktest creates one run-level `fund_cache`/`fund_failures`, uses it for its own PIT loads and hands it to the recompute, so the run's symbols cost nothing extra. The boot pass, capped at `_BOOT_RECOMPUTE_MAX_PAIRS = 50` (`servicer.py:294,2647-2648`), shares one `fund_cache` and one `formula_cache` across all its pairs. PIT history does not depend on the user, so boot makes at most (distinct symbols across 50 pairs) calls.
  - **Concurrency:** capped by the existing background marketdata semaphore `_readiness_materializer_bars_sem`, which config caps at [1,5]. No new key.
  - **Pages:** each call is normally one page, because the paging helper (fix 2) requests 200 periods per page.

### Fix 2. Paginate the PIT loaders through one shared bounded helper

- **New module-level helper** `async def _fetch_historical_fundamentals_paged(stub, symbol, metadata) -> list[FundamentalPeriod]` in `servicer.py`, next to `_fundamental_periods_from_response` (`:6018`). `live_loop.py` imports it from the same block (`:38-42`).
- **Model.** It follows the `_fetch_bars_paged` precedent (`:1249-1303`):
  - `_FUND_PAGE_SIZE = 200`, `_MAX_FUND_PAGES = 8` (up to 1600 periods; the 10-year default is about 50). These sit next to `_MAX_BAR_PAGES = 32` (`:263`) and are fixed invariants.
  - It passes `page=PageRequest(page_size, page_token)` (`marketdata.proto:290`) and follows `pagination.next_page_token` (`:295`).
  - EOF is an empty token.
  - **Raises `_FundamentalsPageError`** on cap exhaustion, or on a non-advancing token (token == previous).
- **Callers.**
  - Both loaders (`servicer.py:1641-1652`, `live_loop.py:625-632`) call it.
  - Their `except` records `failures[("pit", sym)] = UNKNOWN` on a page error or any non-NotFound error, then returns `[]` and caches it as today.
  - So a page-cap hit is UNKNOWN, never UNAVAILABLE. Unguarded surfaces still degrade to hold, exactly as today.
- **Why this is needed.** Marketdata defaults to `pageSize := 50` (`marketdata_service.go:1736`) with ascending order (`marketdata_repo.go:724`). Today's loaders silently drop the **newest** filings.
- **C-16 EXTEND** (insights 071 precedent). For a symbol with more than 50 stored periods, existing 198/201 backtest results (and live/opportunity evaluations on the PIT channel) change: they now see the newest filings. This is correctness, not a guarantee change.
  - The fingerprint is unchanged, so older cells computed on truncated data stay eligible. That is documented.
  - Before merge, the spec must measure the number of symbols on staging with more than 50 periods, using `query_fundamentals(historical)` counts.

### Fix 3. Bars outage or empty window: NOT_ASSESSED

- **Opportunities `_row_for`.**
  - If `sym in fetch_failed` (`servicer.py:5131-5135`), or the bars are missing (`:5128-5130`), or `eval_dates` is empty, the guard is not consulted.
  - The row takes today's `"unavailable"` path with its action preserved (C-16 PRESERVE `@AC-1 @feature-185`).
- **Mutual exclusion (rule).** A row carries at most one of `"unavailable"` (transient data) or `"fundamentals_unavailable"` (skip). The skip is applied only when bars are present and the guard says UNAVAILABLE, and it never stamps `"unavailable"`. A UNKNOWN fundamentals fetch stamps `"unavailable"` and is never a skip.
- **Heal (`_retry_unavailable_symbols`, `:4566-4665`).** Once bars recover, it re-runs the guard.
  - Entry with UNAVAILABLE: heal into a skip row (`action=UNSPECIFIED` through COALESCE; drop `"unavailable"`, add `"fundamentals_unavailable"`; axes 0; composite NULL; no readiness staging).
  - Bars still failing, or UNKNOWN: stays `"unavailable"`.
  - AVAILABLE, DISABLED or NOT_REQUIRED: heal as today.
  - **Held exit with UNAVAILABLE:** heals as today (evaluated; REDUCE preserved).
  - Because of mutual exclusion, a data-unavailable row's action was never forced, so "heal as today" with `COALESCE(NULL, action)` is correct. This removes the stuck-row case.
- **Backtest.** An empty in-window bar list already goes through `_InsufficientData`/coverage gaps; the guard returns NOT_ASSESSED.
- **Live.** No bars means NOT_ASSESSED, so no state change and no alert.

### Fix 4. Budget headroom for the ETF-label fill

- **Shared threshold helper.** Extract `func atQuotaAlertThreshold(count, cap int) bool { return cap > 0 && count >= (cap*8)/10 }` from `maybeAlertQuota` (`marketdata_service.go:1616`). It is now the single home for the 80% threshold.
- **Fill gate.** The worker processes a symbol only when `marketdata.fmp.enabled` is on, `s.fmpBudget != nil`, and `!atQuotaAlertThreshold(s.fmpBudget.BudgetSnapshot())`. That is stricter than `enrichmentUnderCap` (`:2073-2079`), so the label fill can never take the last 20% of the shared day budget, which snapshot fetches need.
- **TTL.** `const etfFlagTTL = 30 * 24 * time.Hour` is a code constant, replacing `fmp.cache_ttl_hours`.
- **F-07 justification.** This is a fixed invariant (ETF status is effectively immutable), not an operator tuning knob. It follows the analysis precedent `_INTENT_SWEEP_SECONDS`/`_INTENT_STALE_SECONDS`, which are "fixed invariants, not config keys", and the 300s retry constants. The product spec says "no new config keys", and a key would need owner plus config-team approval for a cosmetic label.
- **Runner-up:** `marketdata.fmp.etf_flag_ttl_hours`.
- **Deploy cost.** The in-process cache is lost on deploy. Refill is bounded by the number of distinct refused symbols and by the headroom gate.

### Fix 5. Remove backtest DISABLED

- Backtest reads only the PIT channel, so its states are NOT_REQUIRED, NOT_ASSESSED, AVAILABLE, UNAVAILABLE and UNKNOWN.
- The "source disabled" backtest warning and the `@AC-9` backtest clause are deleted.
- DISABLED stays on the snapshot channel only:
  - Live: no state change.
  - Opportunities: evaluated as today, with no marker and no retry.

### Fix 6. Symbol filter on `ListOpportunitiesRequest`

I chose the filter over documenting a gap, as the least mechanism that satisfies C-14. A documented gap would need operator sign-off plus a named follow-up feature.
- **Proto.** `string symbol = 6;` on `ListOpportunitiesRequest` (`analysis.proto:681-688`, next free number is 6). Empty means all. Additive.
- **Repository.** `OpportunitiesRepository.read(..., symbol: str = "")` adds `AND ($9::text = '' OR o.symbol = $9)` (`opportunities.py:191-274`). The servicer upper-cases and trims the symbol. The facet (`available_sources`) and the floor are unchanged.
- **UI.** `useOpportunities(..., symbol = '')` gets a fifth argument, folded into the query key (`hooks/useOpportunities.ts:23-38`). `trader/positions/[symbol]/page.tsx:176-180` passes the route symbol, so the badge and the `SignalReadiness` notice see that symbol's rows whatever its queue rank.
- **Agent.** `list_opportunities` is not extended (YAGNI).

### Spec notes folded in

- **Vendor no-data maps to NotFound.**
  - Add `var ErrNoFundamentals = errors.New("no fundamentals")` in `internal/source/source.go` (home of the `FundamentalsSource` interface, `:68`).
  - `fmp_client.go:166` and `finnhub_client.go:56` wrap it with `%w`.
  - `resolveFundamentals` maps `errors.Is(err, source.ErrNoFundamentals)` to `CodeNotFound` before the generic Unavailable (`marketdata_service.go:1432-1433`).
  - The guard then reads it as absence (UNAVAILABLE), not as an outage that retries forever.
- **Re-alert after restart (deliberate).** `_fund_unavailable` is in memory. Each deploy re-alerts at most once per unavailable (user, strategy, symbol) live pair, bounded by `max_strategies_per_cycle`. Persisting it would need a table, which is rejected (YAGNI).
- **Fingerprint blind spot (documented under ANALYSIS-3).**
  - A formula's `fundamental_inputs` live in indicators, outside `definition_json`, so editing them does not change the fingerprint.
  - Under derivation exclusion, `fmap` is read **live**, so exclusion re-evaluates against the current inputs. That is non-destructive and self-consistent.
  - However, cells computed under the old inputs stay eligible. This is a pre-existing blind spot, now recorded.
- **Recon wording.** `recon.md:121` and `:166` change from "unavailable = no served row" to "unavailable = the served/PIT data gives zero executable epochs for the strategy's declared metrics (a served row with none of the declared metrics is unavailable)". This is the signed-off A semantics.
- **Documented limits.**
  - The guard looks at the whole definition, so exit-only strategies and strategies that use fundamentals only in an OR branch are also denied entry, refused, and excluded from derivation.
  - Backtest and live are asymmetric: PIT is EDGAR-only, while live uses the vendor snapshot.
  - The `/insights/watchlists` readiness 0/N gap remains.

---

## Rejected Alternatives

- **Write-time DELETE of refused cells (round 3).** Destructive, leaves a legacy residual until a re-run, deletes traded evidence, and diverged from the operator decision (P-03).
- **Refusal-marker column, migration 028.** Clean and auditable, but it is a schema change that the spec excludes and needs DBA approval. Derivation exclusion gives the same result without one.
- **Exempting traded cells from derivation exclusion.** The adversary floated `total_trades = 0`. Rejected to honour the operator's literal "refused symbols dropped". Since exclusion is non-destructive, the cost of a false drop is reversible. This is the runner-up if the operator wants OR-branch evidence kept.
- **Calendar-day `eval_dates` over every day.** Same answer as the epoch-boundary dates, at higher cost.
- **`enrichmentUnderCap` for the label fill.** It allows spending up to 100% of the budget, which starves the guard's own snapshots.
- **Documented gap for the Signal-detail badge.** It would need C-14 sign-off and a named follow-up; a one-field filter is smaller.
- **`GetFundamentalsMultiResponse.unavailable_symbols`.** The single-symbol RPC already disambiguates.

---

## Open Risks

1. **The grade now depends on marketdata availability for fundamentals strategies.** A fundamentals outage freezes the grade (old grade kept, WARN).
   - ManageStrategy UPDATE pops the in-memory grade before recomputing (`:2939`). If the recompute is UNKNOWN, `ListStrategies` shows no grade until the next successful trigger or a reboot hydrate. That is pre-existing behaviour on any recompute exception. Accepted.
2. **A backfill re-admits stale zero-trade cells.** After SCHD gains filings dated before a cell's `range_end`, derivation says AVAILABLE, and an old zero-trade cell (computed without data) counts again until a re-run supersedes it. Traded-first and newest `DISTINCT ON` (`backtest_run_symbols.py:76`) means a re-run fixes it. Documented.
3. **Legacy-grade cleanup needs a trigger.** A contaminated pre-215 grade is cleaned only when some trigger runs for that strategy. Post-deploy, run `ScoreStrategy` (manual refresh) for `fundamentals_macd_blend` on staging and prod.
4. **Pagination changes existing results.** It changes existing 198/201 PIT results for symbols with more than 50 periods (C-16 EXTEND). Measure on staging first.

---

## Constitution rules touched

| Rule | How |
|---|---|
| P-03, P-05 | H follows the recorded operator decision; every deviation is surfaced. |
| C-09 | Two additive proto edits: analysis (enum 5, `FundamentalsGap`, fields 6/23/24, `ListOpportunitiesRequest.symbol=6`) and marketdata (`GetEtfFlags`). `buf lint`, `buf breaking`, `buf-gen`. |
| C-10 | One guard and one PIT pager across backtest, live, opportunities, heal and derivation. Snapshot parity for unguarded surfaces. |
| C-14 | Queue skip row; Signal-detail badge via the symbol filter; `BacktestDiagnostics`; agent `run_backtest`, `list_opportunities`, `set_strategy_live` docstrings; strat-lab skill in the same PR. |
| C-15 | Scenarios @AC-1…@AC-15; every FR covered. |
| C-16 | See the table below. |
| C-13, C-12 | Python `tests/conftest.py`, Go `internal/testdata/`, UI `e2e/fixtures/` plus an `INVENTORY.md` row. |
| C-17 | `EnumBadge` and `CardNotice` reuse. |
| C-18 | No migration, no new key, no new semaphore. Trade-off recorded: derivation cost versus a destructive write. |
| F-04 | All symbols are cited. |
| F-07 | `etfFlagTTL`, `_FUND_PAGE_SIZE`, `_MAX_FUND_PAGES` are fixed invariants (justified above). |

## Business rules touched (C-16)

| Rule | Class | Note / sign-off |
|---|---|---|
| `@AC-8 @feature-201` note (`fundamentals-formula-inputs.feature:53`) | **CHANGE** | Signed off 2026-10-09 (context.md, round-1 gate). The partial-row clauses are PRESERVED. |
| `@AC-2 @feature-185` | **CHANGE** (rescope to "symbols with fundamentals available") | Signed off 2026-10-09. |
| `@AC-7 @feature-211` (marketdata `edgar-fundamentals-enrichment.feature:65-70`) | EXTEND | Vendor-disabled branch omits from Multi / NotFound on the single RPC. Live vendor fallback for non-filers is PRESERVED. |
| `@AC-1 @feature-185` | EXTEND | A bars outage on a fundamentals strategy stays data-unavailable with its action preserved. Mutual exclusion. |
| `@AC-8 @feature-185` | EXTEND | Heal can land in a skip row (action rewritten). A skip row never enters the 300s loop. |
| `@AC-3 @feature-190` | EXTEND | Floor exemption for `fundamentals_unavailable`. |
| `@AC-3 @feature-185` (UI), `@AC-10 @feature-185` (agent), `@AC-2 @feature-193` | EXTEND | Skip state rendered and surfaced. |
| `@AC-4 @feature-198`, `@AC-2 @feature-201` (results) | EXTEND | Completeness of PIT pagination for symbols with more than 50 periods (insights 071). |
| ANALYSIS-3 (context constitution) | EXTEND | Eligible = fingerprint match AND not guard-refused at derivation. Teardown doc edit. |
| `@AC-5`/`@AC-11 @feature-185/199`, `@AC-6 @feature-200`, `@AC-2 @feature-181`, `@AC-3/4/8 @feature-152`, `@AC-5/6 @feature-150`, `@AC-3 @feature-149`, `@AC-6/9 @feature-211`, `@AC-3 @feature-198`, `@AC-11 @feature-151`, `@AC-8 @feature-198` (agent), `@AC-7 @feature-205`, `@AC-23 @feature-224` | PRESERVE | Recon table, unchanged. |

---

## Per-surface test plan

Rule (fails.md:2737): each surface gets at least one positive, non-None test.

- **Guard / evaluator (pure).**
  - Shared-helper parity on the same `eval_dates` on both sides (adversary note A).
  - SCHD shape gives UNAVAILABLE; `{BETA, PE}` gives AVAILABLE.
  - First filing at or after the last bar gives UNAVAILABLE (including `filed_date == last bar`).
  - Empty `eval_dates` or `bars_failed` gives NOT_ASSESSED.
  - Precedence matrix; gate off gives NOT_REQUIRED.
  - Predicates: blend gives true, squeeze gives false.
  - Epoch-boundary `eval_dates` builder equals brute force over every calendar day.
- **PIT pager.**
  - 3-page drain; empty-token EOF.
  - Non-advancing token raises; cap raises.
  - Loader records UNKNOWN and returns `[]` (both servicer and live).
  - The `page` field is sent.
  - Snapshot loaders: FailedPrecondition gives DISABLED, NotFound gives no failure, Unavailable gives UNKNOWN. A cache hit still reports the failure. Snapshot failures do not taint PIT.
- **Backtest.**
  - SCHD: reason 5, ETF gap, WARN, INSUFFICIENT_DATA, no cell, and a recompute is triggered.
  - `[AAPL, SCHD]`: AAPL traded and its cell written.
  - Technical strategy on SCHD unchanged.
  - UNKNOWN: warning, no cell.
  - The run-level `fund_cache` is reused by the recompute (call count).
- **Derivation (H).**
  - Excludes SCHD and keeps AAPL; zero remaining cells clears the grade.
  - NULL `range_end` uses `completed_at`.
  - UNKNOWN raises: the RunBacktest/UPDATE/boot paths keep the old grade; ScoreStrategy returns UNAVAILABLE.
  - A non-fundamentals strategy makes zero marketdata calls.
  - The boot pass with shared cache makes at most (distinct symbols) calls.
  - The semaphore is used.
  - Rows are never deleted (repository spy).
- **Live.**
  - SCHD UNAVAILABLE: entry denied; held exit fires; one WARN and one alert over three cycles; recover then relapse re-alerts.
  - A failed alert send does not re-alert, and transition retry semantics (`:444`) hold.
  - UNKNOWN, DISABLED and NOT_ASSESSED: no alert.
  - AAPL entry alert fires.
- **Opportunities.**
  - Entry skip row.
  - Speculative sell with no position is still dropped.
  - Held REDUCE.
  - Mixed outage (fundamentals row data-unavailable, technical row normal).
  - DISABLED: no marker and no retry.
  - Bars outage: data-unavailable, action kept, no skip marker (mutual exclusion).
  - Heal from unavailable to skip row: action rewritten (COALESCE repository test), readiness not staged.
  - Heal with no action key: action unchanged.
  - Held UNAVAILABLE heals as today.
  - Floor exemption and round-trip.
  - The `symbol` filter returns only that symbol's rows; empty means all; the facet is unchanged.
- **Readiness parity.** `EvaluateReadiness`, `GetWatchlistReadiness`, the materializer and `GetIndicatorSeries` are byte-identical on SCHD.
- **Marketdata (Go).**
  - Edgar with vendors off: Multi omits; the single RPC returns NotFound.
  - FMP/Finnhub `ErrNoFundamentals` gives NotFound; `edgar.enabled=false` gives FailedPrecondition; vendor ResourceExhausted still aborts Multi.
  - `atQuotaAlertThreshold` is shared with `maybeAlertQuota` (existing alert tests stay green).
  - `GetEtfFlags`: never calls FMP on a miss; dedups the enqueue; drops when the queue is full; the fill is skipped at 80% and when fmp is off; the 30-day TTL holds; true/false decode; an empty profile is negative-cached; errors are not cached and are refunded; size-bound eviction; `go test -race`.
- **Agent / UI.**
  - `_SYMBOL_KEYS` parity; `client.py` projection.
  - `tsc` exhaustive `FUNDAMENTALS_GAP` map.
  - e2e:
    - Queue skip-row badge.
    - Signal-detail badge and notice, with the fixture skip row beyond row 50, served only via `symbol`.
    - `BacktestDiagnostics` reason-5 text.
    - The `@AC-11 @feature-151` render is unaffected.
- **Post-deploy (staging; fails.md:129).**
  - `run_backtest(fundamentals_macd_blend, SCHD)` gives reason 5 with the gap, and the grade is recomputed.
  - `list_opportunities` shows the SCHD skip row.
  - `run_backtest(..., AAPL)` trades.
  - `ScoreStrategy(fundamentals_macd_blend)` clears the legacy SCHD contribution.
  - Measure the count of symbols with more than 50 periods (pagination EXTEND).

## Teardown doc edits

- **Analysis `CLAUDE.md`:** the Decide-surface skip row, the `symbol` filter, the evidence-exclusion paragraph, and the fixed constants. **ANALYSIS-3** in `services/xstockstrat-analysis/docs/context-constitution.md`, including the fingerprint blind spot.
- **Marketdata `CLAUDE.md`:** the `marketdata.edgar.enabled` row; the "Snapshot serving source is switchable" paragraph (NotFound/omit); the ETF-flag fill and its 80% headroom.
- **UI `CLAUDE.md`:** Signal-detail route drift (`insights/market/[symbol]` becomes `trader/positions/[symbol]`).
- **`recon.md:121,166`:** wording fix.
- **Strat-lab skill:** same PR.

## Strongest risk to this approach

The headline grade for fundamentals strategies now depends on marketdata being up at recompute time.
- **Outage effect.** A persistent PIT outage freezes grades. After an UPDATE, the in-memory grade is empty until the next successful trigger.
- **Data quality.** The derivation's correctness depends entirely on the paged PIT read being complete. Any OK-but-truncated response would silently exclude a legitimate symbol from the grade. That would be reversible, unlike round 3, but still wrong while it lasts.
- **Mitigation.** Pagination is strict, with page-cap and non-advancing-token checks that both give UNKNOWN. The exclusion is logged per symbol. The staging measurement is required before merge.

## Round-4 adversary fixes (folded at approval, operator 2026-10-10)

1. **Formula-level outage on the derivation path.** `_formula_fundamentals` swallows `grpc.RpcError` and caches
   `[]` (`servicer.py:1686-1695`), which makes a formula-only strategy read NOT_REQUIRED. On the derivation path
   (and the guard generally) a `GetFormula` RpcError — incl. NotFound/unreadable — records
   `failures[("formula", formula_id)]` and the guard returns UNKNOWN → `_GradeInputsUnknown` → previous grade kept.
   Test: GetFormula UNAVAILABLE during recompute → old grade kept, SCHD cell not counted.
2. **Filter before dedup.** Derivation fetches *every* cell under the fingerprint, runs the per-window guard on each,
   then applies the existing traded-first ordering (`(total_trades>0) DESC, trading_days DESC, completed_at DESC`,
   `repositories/backtest_run_symbols.py:73-76`) in one shared ordering key, so a symbol with one refused and one
   eligible cell keeps the eligible one. PIT is cached per symbol, so no extra RPCs. Test: two-window case.
3. **No priority inversion / bounded startup.** Interactive recomputes (RunBacktest, ScoreStrategy, ManageStrategy
   UPDATE) run their bounded `gather` without the background `_readiness_materializer_bars_sem`, mirroring the
   backtest's own PIT loads (`servicer.py:1852`); only the boot pass uses it. Every paged PIT call carries a per-call
   `timeout=` (timeout ⇒ UNKNOWN). The boot recompute (`main.py:135`) moves to `asyncio.create_task` so it no longer
   delays live-loop creation (`main.py:162`).

### /sdd-spec notes (from the round-4 adversary, non-blocking)
- Pager "non-advancing" check by strict `(period_end, fiscal_period)` monotonicity (`_fetch_bars_paged` precedent
  `servicer.py:1284-1290`), not token equality (`parseHistCursor` falls back to page 1, `marketdata_repo.go:718`).
- Add `"fundamentals_unavailable"` to `_PROVENANCE_STRUCTURAL_MARKERS` (`repositories/opportunities.py:26`) — C-16
  PRESERVE feature-190 source facet.
- ScoreStrategy: distinct messages for `_GradeInputsUnknown` ("fundamentals availability unknown — grade unchanged")
  and all-cells-excluded NOT_FOUND (name the exclusion), not the generic texts at `servicer.py:2343-2344,2357-2358`.
- Derivation `meta` carries the inbound `x-trace-id` on interactive triggers; owner-only for the boot pass.
- Gate-off re-inclusion: while `analysis.backtest.fundamentals.enabled` is off, a trigger re-includes refused cells;
  document with Open Risk 3.
- Pinning tests: `_recompute_headline` new kwargs; run-level failures with an older eligible cell freeze the grade;
  concurrent gather under the per-strategy lock.
- Ledger: H's exclusion of zero-trade refused cells overrides the feature-065 "zero-trade cells count" decision
  (fails.md:617) — legitimate only via the recorded operator decision (context.md 2026-10-10); cite it on the
  ANALYSIS-3 EXTEND row.

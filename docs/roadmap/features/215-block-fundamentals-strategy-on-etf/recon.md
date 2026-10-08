# Recon: block-fundamentals-strategy-on-etf

**Created**: 2026-10-08
**From**: product-spec.md (+ operator detection decision, context.md 2026-10-08: **hybrid** — enforce on
"no producible fundamentals for this symbol", label ETF vs other via FMP `isEtf`)
**Affected services**: xstockstrat-analysis, xstockstrat-marketdata, xstockstrat-ui, xstockstrat-agent
(+ `plugins/strat-lab` skill, docs/patterns/strat-lab-plugin.md rule)

---

## Objective

A strategy that needs fundamentals, evaluated on a symbol that has none (ETFs, non-SEC filers), today
silently holds and reports a plausible "no signal" (`ENTRY_NEVER_TRUE` / quiet 0/N). Make every evaluation
path refuse/skip that symbol with an explicit enumerated, auditable reason, distinguishing "ETF" from
"no filings" when marketdata knows, and leave equities with data and non-fundamentals strategies untouched.

## Codebase Map

- **`xstockstrat-analysis`** (Python)
  - Fundamentals need detection: `_definition_has_fundamental` `app/handlers/servicer.py:5999`,
    `_definition_wants_fundamentals_formula` `:6005`, inline OR at `:1632-1635`; formula map
    `_formula_fundamentals` `:1669`, `evaluator.declared_formula_fundamentals` `app/services/evaluator.py:622`.
  - PIT loader `_load_fundamentals` `servicer.py:1612` — **shared** by backtest (`:1852`), EvaluateReadiness
    (`:3589`), watchlist readiness (`:3858`), GetIndicatorSeries (`:4105`), `_retry_unavailable_symbols`
    (`:4590,:4682`), `_compute_opportunities` (`:5206`), readiness materializer (`:5538`). Gate-off / no
    operand → `None` (`:1632-1638`); **fetch error and empty history both → `[]`** (`:1653-1655`).
  - Snapshot loader `_load_fundamentals_snapshot` `servicer.py:1700` — no row → `[]` (`:1729-1731`),
    exception → `[]` (`:1740-1742`); no core-metric check.
  - Live loop: `_load_fundamentals` `app/engine/live_loop.py:611-632` (checks only `_definition_has_fundamental`
    `:621` — **parity gap** vs servicer's formula predicate), `_load_fundamentals_snapshot` `:634-659`,
    `_eval_pair` `:661`, sentinel `_EVAL_NO_BARS` `:62/:674`, batched WARN `:447-456`.
  - Silent hold: `evaluator._fundamental_as_of_series` all-None `evaluator.py:86-87`; formula epochs
    `:530-556`; ends as `NO_TRADE_REASON_ENTRY_NEVER_TRUE` via `_classify_no_trade_reason` `servicer.py:6305-6312`.
  - Backtest per-symbol error channel: `except FormulaExecutionError` → `SymbolDiagnostics(no_trade_reason=…)`
    `servicer.py:991-1005`; `_InsufficientData` `:236` caught `:970-990` → `CoverageGap`; status gate `:1114`;
    run-level `result.warnings` (field 16) precedent `:1126-1131` (feature 217).
  - Opportunities: `_compute_opportunities` `servicer.py:4762`, `_row_for` `:5182` (loads `:5206-5224`, eval
    `:5228`; `formula_fund_map` built **after** the load at `:5214`); provenance markers → `muted` (12) /
    `data_unavailable` (20) `:6208-6211`. Universe `resolve_universe` `live_loop.py:96`,
    `resolve_fundamentals_universe` `:142` (fails closed to empty, intersects with "has a GetFundamentalsMulti row" `:176-185`).
  - Fundsignal producer silently drops absent symbols `app/engine/fundsignal_loop.py:399-400`.
  - Readiness compute `app/services/readiness.py:38`. Sector TTL cache precedent `servicer.py:257,1211-1228`.
  - Last migration `026`; config reads `app/config/watcher.py` (`get_bool` `:120`, `get_int_present` `:107`).
- **`xstockstrat-marketdata`** (Go)
  - FMP profile `fetchProfile` `internal/fmp/fmp_client.go:286-297`; `fmpProfile{Beta,Currency,Sector}`
    `:354-359` (**`isEtf` not decoded**); `FetchSector` `:363-369`; `apply` `:371-377`; every call reserves the
    shared FMP day budget in `getJSON` `:228-240`.
  - Classification (217): `sectorSource` `internal/service/classification_service.go:31-33`, refresh `:191-219`
    (gated `marketdata.classification.enabled`, default false, `:236`), `seedFromProfile` `:251` (callers
    `marketdata_service.go:1386,:1438`), read RPCs `GetCurrentSector`/`GetSectorAsOf`/`GetSectorHistory`
    `:108/:129/:150` (store-only); table `migrations/009_symbol_classification.up.sql:4-13` (no ETF column).
  - Finnhub `finnhubProfile2{Currency}` `internal/finnhub/finnhub_client.go:239-241` (Finnhub profile2 has no type field).
  - EDGAR snapshot not producible → WARN + vendor fallback `marketdata_service.go:1517-1529`; `hasCoreMetrics`
    `:1490`; edgar-mode `GetFundamentalsMulti` omits nil snapshots `:1329-1331`; `GetHistoricalFundamentals`
    returns empty `Periods` without error `:1720-1760`; CIK miss only in backfill `internal/edgar/edgar_client.go:150`.
  - Last migration `009` (007 intentionally unused) → next **`010`**.
- **`xstockstrat-ui`** (Next.js)
  - `NO_TRADE_MESSAGE: Record<NoTradeReason,string>` `src/components/insights/BacktestDiagnostics.tsx:40-49`
    (**exhaustive — new enum value fails `tsc` until mapped**); unknown → empty banner `:108,:118-121`.
  - Decide queue: muted/unavailable rendering `src/app/insights/opportunities/page.tsx:484-495,523-534`; mobile
    `src/components/mobile/SectionRenderer.tsx:169-175,229`; enum render maps `src/lib/opportunityShared.tsx:28-60`.
  - e2e: `e2e/insights/backtest-coverage.spec.ts:82-107`, sentinel mocks `e2e/mock-backend.ts:1030,1040-1059`,
    `e2e/fixtures/INVENTORY.md:58,80`. No vitest for BacktestDiagnostics.
- **`xstockstrat-agent`** (Python)
  - `run_backtest` → `MessageToDict` without `use_integers_for_enums` (`app/client.py:637-641`): new enum value
    passes through as its name. `app/backtest_view.py` `_SYMBOL_KEYS` `:51`, warnings inline `:73-74`; parity
    guard `tests/test_backtest_view.py:202-212` (trips only on **new fields**).
  - `list_opportunities` hand-built projection `app/client.py:782-804` (new Opportunity field must be added).
  - Tool docstrings `app/tools.py:735,760-763` (says fundamentals "reads hold" — changes), `set_strategy_live` `:1309-1335`.
- **strat-lab plugin**: `plugins/strat-lab/skills/backtest/reference/{output-handling.md:15-19,self-grill.md:13,34,verification.md:37}`,
  `SKILL.md:159-162`; rule `docs/patterns/strat-lab-plugin.md:18` (same-PR update for run_backtest/set_strategy_live changes).

## Patterns to REUSE

- Requires-fundamentals predicate → reuse/merge `_definition_has_fundamental` + `_definition_wants_fundamentals_formula`
  (`servicer.py:5999,6005`) into one helper; the live loop already imports these (`live_loop.py:40-41`).
- Backtest per-symbol refusal → the `FormulaExecutionError` → `SymbolDiagnostics(no_trade_reason)` path (`servicer.py:991-1005`).
- Run-level explanation → `result.warnings` (field 16), as feature 217 (`servicer.py:1126-1131`).
- Live per-symbol skip → `_EVAL_NO_BARS`-style sentinel + one batched WARN per cycle (`live_loop.py:62,447-456`).
- Opportunity skip → provenance-marker → proto flag mapping (`servicer.py:6208-6211`), rendered like `data_unavailable`.
- ETF flag fetch → extend the **existing** FMP `/stable/profile` decode (no new request, shared budget); TTL cache in
  analysis like `_sector_cache` (`servicer.py:257,1211-1228`).
- UI reason text → `NO_TRADE_MESSAGE` map; Decide-queue badge → `opportunityShared.tsx` `EnumBadge` maps.
- e2e → sentinel strategy in `mock-backend.ts` (`strat-formula-error-001` pattern) + INVENTORY row.

## Existing Business Rules (preserve / extend)

- **CHANGE** `@AC-8 @FR-5 @FR-6 @feature-201` "On a partial fundamentals row the strategy omits absent metrics (does not penalize) and diverges from the producer" (`services/xstockstrat-analysis/acceptance/fundamentals-formula-inputs.feature`) — the scenario's note (line 53) guarantees "A whole-row-missing symbol still holds (None), never fabricates". The guard replaces that silent hold with a refusal/skip plus an enumerated reason (requires user sign-off recorded in context.md). The partial-row `Then` clauses are PRESERVED, and a partial row must not trigger the guard.
- **PRESERVE** `@AC-4 @FR-6 @feature-198` "Backtest resolves a fundamental operand with no look-ahead bias (T+1 availability)" (`services/xstockstrat-analysis/acceptance/historical-fundamentals-backtest.feature`) — pre-filing bars still hold. The guard is per symbol and never per bar; a per-bar guard would make this a CHANGE.
- **PRESERVE** `@AC-2 @FR-2 @feature-201` "In a backtest the formula sees point-in-time fundamentals, no look-ahead" (`services/xstockstrat-analysis/acceptance/fundamentals-formula-inputs.feature`) — the PIT feed is unchanged, with the same per-symbol constraint.
- **PRESERVE** `@AC-1 @FR-1 @FR-4 @feature-201` "A fundamentals-scoring formula component resolves to a score series a rule can gate on" (`services/xstockstrat-analysis/acceptance/fundamentals-formula-inputs.feature`) — equities with fundamentals are unaffected.
- **PRESERVE** `@AC-3 @FR-3 @feature-201` "In live/screener the formula sees the current fundamentals snapshot" (`services/xstockstrat-analysis/acceptance/fundamentals-formula-inputs.feature`) — a served snapshot row means available, so evaluation proceeds.
- **PRESERVE** `@AC-7 @FR-1 @feature-201` "A technical (non-fundamentals) formula component is byte-for-byte unaffected" (`services/xstockstrat-analysis/acceptance/fundamentals-formula-inputs.feature`) — the detector excludes technical formulas, so they are never guarded on ETFs.
- **EXTEND** `@AC-1 @FR-1 @FR-3 @FR-4 @feature-168` "Blend strategy runs on the fundamentals universe intersection" (`services/xstockstrat-analysis/acceptance/fundamentals-blend-universe.feature`) — the intersection is unchanged; symbols excluded for lack of fundamentals gain an auditable reason.
- **PRESERVE** `@AC-2 @FR-2 @feature-168` "Blend strategy is excluded from symbols outside the fundamentals universe" (`services/xstockstrat-analysis/acceptance/fundamentals-blend-universe.feature`) — unchanged.
- **PRESERVE** `@AC-3 @FR-1 @feature-168` "Blend runs in addition to the user's selected strategy" (`services/xstockstrat-analysis/acceptance/fundamentals-blend-universe.feature`) — a non-fundamentals strategy keeps its ETF symbols (FR-5).
- **PRESERVE** `@AC-6 @FR-6 @feature-168` "Fundamentals-universe resolution failure yields an empty universe, not a broad fallback" (`services/xstockstrat-analysis/acceptance/fundamentals-blend-universe.feature`) — an RPC/resolution failure is not mislabelled "fundamentals unavailable".
- **PRESERVE** `@AC-1 @FR-1 @feature-186` "Blend strategy is skipped when fundamentals_blend_enabled is false" (`services/xstockstrat-analysis/acceptance/fundamentals-blend-strategy-restrictions.feature`) — kill-switch unchanged.
- **PRESERVE** `@AC-2 @FR-1 @feature-186` "Blend strategy is skipped when fundamentals universe is empty" (`services/xstockstrat-analysis/acceptance/fundamentals-blend-strategy-restrictions.feature`) — unchanged.
- **PRESERVE** `@AC-3 @FR-1 @feature-186` "Blend strategy evaluates only against fundamentals universe when active" (`services/xstockstrat-analysis/acceptance/fundamentals-blend-strategy-restrictions.feature`) — no `resolve_universe` fallback.
- **PRESERVE** `@AC-6 @FR-3 @feature-186` "SetStrategyLive rejects live_enabled=false for the blend strategy" (`services/xstockstrat-analysis/acceptance/fundamentals-blend-strategy-restrictions.feature`) — the FAILED_PRECONDITION and its message are untouched by the FR-4 guard.
- **PRESERVE** `@AC-7 @FR-3 @feature-186` "SetStrategyLive succeeds for non-blend strategies" (`services/xstockstrat-analysis/acceptance/fundamentals-blend-strategy-restrictions.feature`) — disabling always succeeds.
- **PRESERVE** `@AC-1 @regression @feature-193` "the queue attributes the blend only inside the fundamentals universe" (`services/xstockstrat-analysis/acceptance/fix-blend-queue-fundamentals-universe.feature`) — the guard goes in the shared `resolve_universe`, keeping loop/queue/backfill parity.
- **EXTEND** `@AC-2 @regression @feature-193` "signal_eligible is inert for the blend on the queue" (`services/xstockstrat-analysis/acceptance/fix-blend-queue-fundamentals-universe.feature`) — a no-fundamentals symbol still gets no blend attribution, and now also an auditable skip reason.
- **PRESERVE** `@AC-3 @regression @feature-193` "the boot entry-backfill anchors the blend only inside the fundamentals universe" (`services/xstockstrat-analysis/acceptance/fix-blend-queue-fundamentals-universe.feature`) — unchanged.
- **EXTEND** `@AC-1 @FR-1 @feature-185` "A data-unavailable symbol is marked unavailable, not evaluated-0/0" (`services/xstockstrat-analysis/acceptance/opportunity-compute-robustness.feature`) — adds a distinct fundamentals-unavailable (ETF/other) skip state alongside the bars/indicator data-unavailable sentinel; the sentinel is not reused.
- **PRESERVE** `@AC-2 @FR-1 @feature-185` "An evaluated-but-not-passing symbol is NOT marked unavailable" (`services/xstockstrat-analysis/acceptance/opportunity-compute-robustness.feature`) — must remain true. Reclassifying a fundamentals-strategy ETF/non-filer quiet 0/N row as a skip is a possible CHANGE (see Notes).
- **PRESERVE** `@AC-5 @FR-1 @feature-185` "The sentinel survives the materialization round-trip" (`services/xstockstrat-analysis/acceptance/opportunity-compute-robustness.feature`) — a new skip marker needs the same persistence stability.
- **PRESERVE** `@AC-8 @FR-5 @feature-185` "A data-unavailable row self-heals via a surgical read-time recompute" (`services/xstockstrat-analysis/acceptance/opportunity-compute-robustness.feature`) — a fundamentals-unavailable skip must not enter the 300s self-heal loop.
- **PRESERVE** `@AC-11 @FR-3 @feature-199` "A data-unavailable row persists NULL composite, never a signal-only value" (`services/xstockstrat-analysis/acceptance/opportunity-composite-score.feature`) — a skip row carries no misleading composite.
- **PRESERVE** `@AC-6 @FR-4 @feature-200` "A NULL composite opportunity contributes nothing, it does not drag the symbol down" (`services/xstockstrat-analysis/acceptance/symbol-opportunity-ranking.feature`) — unchanged.
- **PRESERVE** `@AC-3 @FR-1 @feature-190` "A data-unavailable row survives a raised min-conviction floor" (`services/xstockstrat-analysis/acceptance/opportunities-server-side-filters.feature`) — unchanged; whether skip rows are exempt is a design decision.
- **PRESERVE** `@AC-2 @feature-181` "A data-unavailable readiness row is decorated UNKNOWN, not perpetual PENDING" (`services/xstockstrat-analysis/acceptance/readiness-caching-poll-discipline.feature`) — readiness for a skipped pair must not stay PENDING forever.
- **PRESERVE** `@AC-3 @FR-2 @feature-152` "A missing benchmark bar becomes a gap that evaluates hold/false, never forward-filled" (`services/xstockstrat-analysis/acceptance/market-regime-benchmark-operand.feature`) — the benchmark-bar hold is out of the guard's scope.
- **PRESERVE** `@AC-4 @FR-4 @feature-152` "Insufficient benchmark history names the benchmark in coverage_gaps" (`services/xstockstrat-analysis/acceptance/market-regime-benchmark-operand.feature`) — the existing INSUFFICIENT_DATA channel is unchanged.
- **PRESERVE** `@AC-8 @FR-1 @FR-2 @feature-152` "The motivating VOO-200d-rising dip-buy strategy registers and backtests" (`services/xstockstrat-analysis/acceptance/market-regime-benchmark-operand.feature`) — an ETF used as a `source_symbol` never triggers the guard.
- **PRESERVE** `@AC-6 @FR-5 @feature-150` "Insufficient capital skips an entry and is recorded as a capital skip" (`services/xstockstrat-analysis/acceptance/backtest-portfolio-sizing.feature`) — a fundamentals refusal is a separate record.
- **PRESERVE** `@AC-5 @FR-4 @feature-150` "The derived grade is unchanged by portfolio mode" (`services/xstockstrat-analysis/acceptance/backtest-portfolio-sizing.feature`) — unchanged for equities.
- **PRESERVE** `@AC-3 @regression @feature-149` "Per-symbol evidence cells and the derived grade are unchanged" (`services/xstockstrat-analysis/acceptance/fix-backtest-annualized-return.feature`) — cell metric math unchanged.
- **PRESERVE** `@AC-7 @FR-5 @feature-211` "A non-SEC-filing symbol falls back to the vendor path" (`services/xstockstrat-marketdata/acceptance/edgar-fundamentals-enrichment.feature`) — "unavailable" must mean no served row, not no CIK. Otherwise vendor-served non-filers are refused on live (that would be a CHANGE).
- **PRESERVE** `@AC-6 @FR-5 @FR-8 @feature-211` "The snapshot path serves the latest EDGAR filing after the vendors are disabled" (`services/xstockstrat-marketdata/acceptance/edgar-fundamentals-enrichment.feature`) — exposing isEtf must not perturb snapshot serving.
- **PRESERVE** `@AC-9 @FR-1 @FR-2 @FR-3 @FR-4 @feature-211` "Backtest PIT composite lands in the same band as the live snapshot after enrichment" (`services/xstockstrat-marketdata/acceptance/edgar-fundamentals-enrichment.feature`) — BABA stays available and is labelled non-ETF.
- **PRESERVE** `@AC-3 @FR-5 @feature-198` "As-of read hides a filing until the trading day after it was filed (T+1)" (`services/xstockstrat-marketdata/acceptance/historical-fundamentals-backtest.feature`) — unchanged.
- **PRESERVE** `@AC-11 @FR-5 @feature-151` "A next-bar fill row shows the prior bar's signal beside the current bar's conviction" (`services/xstockstrat-ui/acceptance/backtest-next-bar-fill.feature`) — the new reason render in `BacktestDiagnostics.tsx` must not regress it.
- **EXTEND** `@AC-3 @FR-2 @feature-185` "The Decide queue renders the unavailable state explicitly" (`services/xstockstrat-ui/acceptance/opportunity-compute-robustness.feature`) — adds an explicit ETF/other fundamentals-unavailable render alongside.
- **EXTEND** `@AC-10 @FR-6 @feature-185` "The agent list_opportunities tool surfaces the data-unavailable state" (`services/xstockstrat-agent/acceptance/opportunity-compute-robustness.feature`) — surfaces the new skip reason alongside.
- **PRESERVE** `@AC-8 @FR-7 @feature-198` "Agent run_backtest accepts a fundamental operand" (`services/xstockstrat-agent/acceptance/historical-fundamentals-backtest.feature`) — the descriptor-parity test still passes. The strat-lab backtest skill is updated in the same PR.
- **PRESERVE** `@AC-7 @FR-6 @feature-205` "An authored fundamentals formula behaves identically as a strategy component" (`docs/sdd/business-rules/platform.feature`) — holds for symbols with fundamentals.
- **PRESERVE** `@AC-23 @FR-11 @feature-224` "System special-cases are unchanged" (`docs/sdd/business-rules/platform.feature`) — blend DEACTIVATE is still refused.
- **CHANGE flag:** `@AC-8 @feature-201`, `services/xstockstrat-analysis/acceptance/fundamentals-formula-inputs.feature:53`. This is the only suite text guaranteeing a hold when a symbol's fundamentals are wholly missing. It is a comment recording a user decision (R4/R5 option b), not a `Then` clause, but it is part of a promoted scenario, so changing it silently would be a C-16 regression. Record explicit user sign-off in `context.md`. The partial-row clauses stay PRESERVE: a symbol with some metrics present (non-empty `missing_metrics`) must not count as "unavailable".
- **Possible CHANGE, defaulted to PRESERVE:** `@AC-2 @feature-185`, `services/xstockstrat-analysis/acceptance/opportunity-compute-robustness.feature:24`. ETFs and non-filers on a fundamentals strategy currently produce quiet 0/N rows. Turning them into skip rows narrows "bars available, 0/N → quiet". Either scope the scenario's wording to non-guarded symbols with sign-off, or keep the skip outside the opportunity-row classifier.
- **CHANGE-risk from the guard's granularity:** `@AC-4 @feature-198` (`services/xstockstrat-analysis/acceptance/historical-fundamentals-backtest.feature:10`) and `@AC-2 @feature-201` rely on early bars holding while a later filing becomes available. The guard must decide "unavailable" per symbol over the whole run, for example "no PIT period at all", not per bar.
- **CHANGE-risk from the predicate's definition:** `@AC-7 @feature-211` (`services/xstockstrat-marketdata/acceptance/edgar-fundamentals-enrichment.feature:65`) guarantees that non-SEC filers get a vendor snapshot. On live surfaces, "unavailable" must be computed from the served GetFundamentalsMulti row, not from CIK/EDGAR presence. In backtests the PIT lane is EDGAR-only, so a non-filer can be "unavailable" in a backtest yet "available" on live. That backtest/live asymmetry is the case `@AC-9 @feature-211` exists to prevent for the fscore gate. The design should call out the divergence explicitly.
- **Kill-switch interaction (CLAUDE.md, not a suite):** with `analysis.backtest.fundamentals.enabled`=false, every fundamental operand reads as hold on every surface. If the guard treats "loader disabled" as "unavailable", every symbol would be refused platform-wide. Distinguish disabled from unavailable. This is not an `@AC-*` guarantee, so I did not classify it.
- **isEtf source:** `marketdata.fmp.enabled` defaults to false and the `provider` default is finnhub (marketdata CLAUDE.md). When FMP is off or exhausted, the ETF/other label must degrade to "other" or "unknown" and never block or alter the guard decision. The untagged `services/xstockstrat-marketdata/acceptance/sector-classification.feature` scenarios ("Failed FMP calls refund the shared daily budget", "An FMP outage does not break classification reads") describe the shared FMP budget an isEtf lookup would spend. They are not reported as guarantees because they have no `@AC` tags.
- **Unaffected holds:** benchmark-bar holds (`@AC-3`/`@AC-7 @feature-152`) are not fundamentals holds and stay PRESERVE.
- **Evidence cells:** no suite guarantees how a refused symbol is treated in evidence cells or the derived grade. That is a design decision under ANALYSIS-2/3.
- **No existing `@AC-*` on `NoTradeReason` values.** The new enum value adds guarantees rather than changing any.

## Dependencies

- Proto: `analysis.proto` `NoTradeReason` next free **5** (`:196-202`); `SymbolDiagnostics` fields 1-5 (`:226-232`);
  `Opportunity` (`:592`, muted=12, data_unavailable=20 — next free to be re-derived at spec); `marketdata.proto`
  `Fundamentals` next free **19** (`:214-235`), `SymbolSector` next free 3, `common.v1.Asset` next free 4.
- Migration: marketdata next `010` (only if an ETF flag is persisted); analysis next `027` is **reserved by feature 225**
  (`merge-order.md:73`) — 215 must not take it.
- Config keys: existing `marketdata.fmp.enabled`, `marketdata.fmp.metrics`, `marketdata.classification.enabled`,
  `analysis.backtest.fundamentals.enabled`. New key only if the design needs a kill switch.
- Inter-service: analysis → marketdata (`GetFundamentals*`, `GetHistoricalFundamentals`, classification RPCs).
- Env vars / ports: none.

## Risks / Not-found

- **Outage vs absence is indistinguishable in analysis today** — fetch error, empty history and missing row all → `[]`.
  A guard on `[]` would refuse equities during a marketdata blip (fails.md fail-open→fail-closed class). The design
  needs an explicit, error-distinct "unavailable" signal.
- No ETF flag anywhere (proto, FMP/Finnhub structs, alpaca, DB). FMP `isEtf` exists in the vendor payload only.
- Staging: `marketdata.fmp.enabled=true`, `metrics=core,extended`, `provider=finnhub` (FMP profile only reached via
  classification), `classification.enabled` unset/false → `isEtf` would be unknown unless fetched on demand.
- Live-loop formula-predicate parity gap (`live_loop.py:621` vs `servicer.py:1632`) — fails.md 2026-10-07 (201)
  "one of N loaders" trap applies: list every loader/guard.
- Exhaustive `Record<NoTradeReason>` in UI (insights.md 071): new enum value must be mapped in the same PR.
- `@AC-8 @feature-201` comment-level "whole-row-missing holds" → **CHANGE** (needs operator sign-off).
- Per-bar vs per-symbol: a pre-first-filing bar is not "unavailable" (`@AC-4 @feature-198`, `@AC-2 @feature-201`).
- `@AC-7 @feature-211`: vendor-served non-filer is "available" on live — the predicate is "no served data", not "no CIK".
- Kill-switch `analysis.backtest.fundamentals.enabled=false` must not be labelled "unavailable".
- Not found: seed migrations for `fscore` / `fundamentals_macd_blend`; any analysis-visible CIK-miss signal.

## Recommended Scope

1. marketdata: decode FMP `isEtf`, expose it (proto) — persistence only if the debate requires it.
2. analysis: single `requires_fundamentals` predicate + an error-distinct availability classifier; apply in backtest,
   live loop, opportunities (+ readiness parity); enumerated reason + run warning.
3. proto: `NO_TRADE_REASON_FUNDAMENTALS_UNAVAILABLE` (+ ETF sub-label channel) and an Opportunity skip signal.
4. UI + agent + strat-lab skill/runbook surfaces; tests per surface (C-10/C-15).

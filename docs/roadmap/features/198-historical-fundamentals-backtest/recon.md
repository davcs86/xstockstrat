# Recon: historical-fundamentals-backtest (feature 198)

**Phase 0 dossier** — grounded codebase map for `/sdd-design` and `/sdd-spec`. Every claim is
`path:line` from a discovery digest; unfound things live under **Risks / Not-found** (F-04, P-03).

---

## Objective

Add a filing-date-aware, point-in-time historical fundamentals time series (SEC EDGAR primary +
FMP-Free ratio enrichment), a fundamentals **backfill data-kind** on `ingest.TriggerBackfill`, and a
**fundamental operand** in the `xstockstrat-analysis` backtest evaluator resolved as-of each bar's
filing date — so strategies can backtest on fundamentals without look-ahead bias. Additive to the
existing snapshot fundamentals path, not a replacement.

---

## Codebase Map

### xstockstrat-marketdata (Go) — new historical store + EDGAR/FMP-ratio client + as-of read
- Snapshot store today = **plain table, PK `symbol`, one row/symbol** (not a hypertable):
  `migrations/002_fundamentals.up.sql:7`. Handlers `GetFundamentals` `internal/service/marketdata_service.go:1242`,
  `GetFundamentalsMulti` `:1258`; gate `fundamentalsEnabled()` `:1355`; quota `fundamentalsQuota()` `:1364`.
- `FundamentalsSource` interface (**snapshot-only**: `GetFundamentals`/`GetFundamentalsMulti`) —
  `internal/source/source.go:65`; model `source.Fundamentals` (`*float64` fields, nil=not-supplied) `:44`.
- FMP client `internal/fmp/fmp_client.go:38` — hits `/stable/quote`,`/stable/ratios-ttm`,`/stable/profile`
  (`:151/:161/:174`). Finnhub `internal/finnhub/finnhub_client.go:35`. **Neither has any
  historical-statement method** — EDGAR historical is greenfield.
- Provider selector = **two switch sites** (ledger-129 trap): construction `cmd/server/main.go:185`
  (`newFundamentalsSource`, read at `:123` `marketdata.fundamentals.provider` default `finnhub`) +
  quota `marketdata_service.go:1365`. Provider-templated keys `"marketdata."+provider+".enabled"/".cache_ttl_hours"`.
- OHLCV backfill worker `BackfillBars` `marketdata_service.go:990` (rejects non-`1d` `:1020`); write
  `repository/marketdata_repo.go:48` (`InsertBars`, upsert on `(symbol,timeframe,time)`).
- Hypertable pattern: `migrations/001_marketdata_hypertables.up.sql:23`
  `create_hypertable('marketdata.ohlcv','time', chunk_time_interval => INTERVAL '1 day')`;
  widen via `migrations/004_...up.sql:25` `set_chunk_time_interval(...,'30 days')`.
- Config: Watcher `internal/config/config.go` — `GetString/Int/Bool` (`:138+`); `ResolveSecret`→`GetSecret`
  RPC with `x-internal-caller: marketdata` (`:105/:109`); FMP key resolved at boot `main.go:79-80`.
- **Migration tip = 004 → next free 005.**

### xstockstrat-ingest (Python) — backfill data-kind orchestration
- `TriggerBackfill` `app/handlers/servicer.py:220`; **`1d`-only reject at `:236-241`** (the branch point
  for a fundamentals data-kind — fundamentals have no bar timeframe). Timeframe is canonicalized
  **before** persist (`:233`) — the ledger-080 raw-persist trap is already fixed.
- Chunk planning `_execute_backfill` `:369-420` (`chunk_window_days`/`chunk_max_bars`), concurrency
  `_run_chunks` `:516`, downstream `marketdata.BackfillBars` `:546-555`; resume `resume_incomplete_jobs` `:487-511`.
- Schema: `ingest.backfill_jobs` (`003`), `backfill_chunks` (`004`, FK cascade), chunk-counts (`005`).
  **No `data_kind`/`kind` column exists** → a new `012` migration adds it (repo write allow-list
  `_UPDATABLE_COLUMNS` in `app/repositories/backfill_jobs.py`). **Migration tip = 011 → next free 012.**
- Proto `ingest.proto`: `TriggerBackfillRequest` max field **6** → additive `data_kind` = **7**;
  `BackfillStatus`/`FillMode` enums present. Header propagation `servicer.py:212-218,554` (C-03).
- Fixtures `tests/conftest.py` + `tests/_helpers.py` (`job_row` = exactly the 15 DDL columns — feature-080 guard).

### xstockstrat-analysis (Python) — fundamental operand in the evaluator
- `RunBacktest` `app/handlers/servicer.py:615`; per-symbol evaluated path `_backtest_symbol_evaluated:1512`;
  **series computed once for all bars before the sim loop** `:1550` (`evaluate_with_series`); per-bar loop `:1611`.
- **Single operand-dispatch seam** = `evaluator._compute_component` `app/services/evaluator.py:276`
  (`COMPONENT_KIND_BUILTIN_INDICATOR:287` / `COMPONENT_KIND_CUSTOM_FORMULA:297`) — **new
  `COMPONENT_KIND_FUNDAMENTAL` branch slots here**. Series assembly + date-join seam
  `_assemble_component_series:368` (empty `source_symbol`→compute; truthy→benchmark date-join `:396-428`).
- **As-of clock** `_bar_date(bar)` `evaluator.py:34` (uses `bar.time`, NOT `bar.timestamp` — ledger-064
  guard); no-look-ahead contract stated `:105,:390`. **This is where T-1 is enforced.**
- Proto `analysis.proto`: `RunBacktestRequest` max **9**→next **10**; `BacktestResult` max **20**→next
  **21** (persisted verbatim, `migrations/008_backtest_details`, additive-only); `StrategyComponent`
  max **6**→next **7**, `ComponentKind` enum {0,1,2}→add **3**; `StrategyDefinition` max **14**→next **15**.
- Fundamental vocab (reuse): `_FUNDAMENTAL_FIELDS` `app/services/screener.py:40-52`
  (`market_cap,pe_ratio,pb_ratio,dividend_yield,eps,beta,roe,debt_to_equity,price,year_high,year_low`)
  ∪ per-symbol `extra_metrics` (`_validate_fundamental_metrics:377`, ledger-117). fundsignal
  `app/engine/fundsignal_loop.py` reads same via `GetFundamentalsMulti` (snapshot).
- **feature 032 (RunSegmentedBacktest) does not exist in code** — D-3 is forward-looking only.
- Fixtures `tests/conftest.py` = proto-path shim only (no backtest fixtures; one inline consumer OK per C-13).

### xstockstrat-agent (Python) — additive to existing tools (no new tool)
- `trigger_backfill` tool `app/tools.py:1078` + client `app/client.py:1606` (req `:1645`) — OHLCV-only,
  **no `data_kind`**. `run_backtest` tool `tools.py:534`/client `:556`; fundamental operand rides the
  **stored strategy definition** via `_build_component` `client.py:639` (maps `builtin`/`formula` only).
- Parity-guarded projections (ledger-134): `BacktestResult`+`SymbolDiagnostics`
  (`tests/test_backtest_view.py:189`, projection `app/backtest_view.py`), `Opportunity`, `SignalSource`.
- strat-lab same-PR skill: `plugins/strat-lab/skills/backtest/SKILL.md` (+ `reference/backfill.md`).
- Six tool-inventory surfaces (module list `tools.py:4-58`, `CLAUDE.md:43`, `docs/runbooks/mcp-tools.md`,
  `GET /api/tools` test `tests/test_tools_endpoint.py:23`, docstrings, `docs/oauth.md`) — extending
  existing tools (not adding one) avoids the count churn.

### xstockstrat-ui (Next.js) — extend existing surfaces (no new route)
- Backfills create form `src/app/insights/backfills/page.tsx:213-256` (hardcodes
  `Timeframe.TIMEFRAME_1DAY` `:135-141`, no timeframe selector) → data-kind selector slots here +
  `handleCreate:128-151`. BFF `src/lib/insightsBff.ts:72` (`triggerBackfill` forward).
- Backtest operand builder `src/components/insights/ComponentEditor.tsx:29-37` (`kind` from
  `ComponentKind`) + `StrategyWizard.tsx` → fundamental-operand option slots here (needs the proto kind).
- **Nav: `/insights/backfills` lives in `NAV_GROUPS` `navGroups.tsx:64` (admin-only) + `AppShell.tsx:16`,
  NOT `PLATFORM_SUBNAV`** — extending existing pages does not re-trigger C-10(a).
- Fixtures `e2e/fixtures/{backfillJobs,backtests,fundamentals}.ts` + `INVENTORY.md`; specs
  `e2e/insights/{backfills,backtest-*}.spec.ts`; mock `e2e/mock-backend.ts`. State primitives
  `Skeleton`/`EmptyState`/`CardNotice`/`QueryStateMessages`; tokens per `globals.css` (C-17).

---

## Patterns to REUSE (anti-duplication core)

1. **feature-152 `source_symbol` operand** = the template for the fundamental operand: a new
   `ComponentKind` branch in `_compute_component` (`evaluator.py:276`) + as-of date-join in
   `_assemble_component_series` (`:396-428`). ADD beside, do not modify the source_symbol path.
2. **Hypertable creation** = `migrations/001` `create_hypertable(...)` with an up-front sized
   `chunk_time_interval` (heed feature-153 OHLCV lock-OOM lesson) for the new fundamentals-history table.
3. **`FundamentalsSource` model `source.Fundamentals`** (`source.go:44`) — reuse the metric field
   vocabulary; the historical source returns the same metric names + a `filed_date`/`period_end`/`period_type`.
4. **`ResolveSecret`/GetSecret** (`config.go:105/109`, `main.go:79-80`) for the FMP key — reuse; EDGAR
   uses a **non-secret** `GetString` User-Agent (no new secret row) — preserves feature-147 @AC.
5. **Backfill orchestration** (`ingest servicer.py` chunk/resume) — reuse the job/chunk lifecycle;
   the fundamentals kind branches around the `1d` reject (`:236-241`) onto a new marketdata worker RPC.
6. **`_FUNDAMENTAL_FIELDS` vocab** (`screener.py:40-52`) + `extra_metrics` union (ledger-117) — reuse
   as the operand's metric-name allow-list; fail-closed validation.
7. **UI**: existing backfills form + `ComponentEditor`; fixtures `backfillJobs.ts`/`backtests.ts`/
   `fundamentals.ts`; canonical state primitives + tokens (C-17).
8. **Agent**: extend `trigger_backfill`/`_build_component` in place; update `backtest_view.py` projection
   + parity test + strat-lab skill in the same PR (ledger-134, root CLAUDE.md).

---

## Dependencies

- **Proto (additive, `buf breaking` green):** ingest `TriggerBackfillRequest.data_kind=7` (+ a
  `BackfillDataKind` enum, `BARS=0` default); analysis `StrategyComponent` fundamental fields (next
  field 7) + `ComponentKind.COMPONENT_KIND_FUNDAMENTAL=3`; marketdata new historical-fundamentals
  message(s) + `GetHistoricalFundamentals` (as-of/ranged) RPC + a fundamentals backfill worker RPC
  (`Fundamentals` snapshot message max field 18 — the historical message is distinct/repeated).
  BacktestResult additive only if a fundamentals field is surfaced (next 21) → agent parity test.
- **Migrations:** marketdata `005` (new fundamentals-history hypertable, up+down); ingest `012`
  (`data_kind` column on `backfill_jobs`/`backfill_chunks`, up+down) if needed.
- **Config keys** (F-07; final set at spec): `marketdata.fundamentals.history.enabled`,
  `marketdata.edgar.{base_url,user_agent,rate_limit_rps}` (non-secret), `...history.backfill.{batch_size,
  max_lookback_years,period_types}`, `marketdata.fundamentals.history.ratio_enrichment.enabled`
  (reuses existing `marketdata.fmp.daily_request_cap=250`, no second cap), `analysis.backtest.fundamentals.enabled`.
- **Inter-service edges:** ingest→marketdata (new fundamentals backfill worker RPC, header trio C-03);
  analysis→marketdata (new `GetHistoricalFundamentals` as-of read in the operand branch).
- **Cross-feature:** 032 also edits `analysis.proto` (distinct messages; pre-assign field numbers if
  concurrent). 065 future `marketdata.<vendor>.*` disjoint. 189 screener `screenPresets.ts` disjoint.

---

## Existing Business Rules (C-16 — design must not regress; adversary enforces)

- **PRESERVE** `@AC-1 @feature-152` — empty operand → byte-for-byte baseline (an unset fundamental
  operand must leave existing runs identical). `analysis/acceptance/market-regime-benchmark-operand.feature`.
- **EXTEND** `@AC-2/@AC-3/@AC-6/@AC-7 @feature-152` — new operand class sharing "value at t uses only
  data ≤ t"; gaps (pre-first-filing) → hold/false, never forward-filled; write-validated + folded into
  the definition fingerprint; resolves in live eval too. (ADD-beside keeps these EXTEND, not CHANGE.)
- **PRESERVE** `@AC-3/@AC-4/@AC-5/@AC-10/@AC-11 @feature-151` — no look-ahead; legacy fill/return
  byte-for-byte; recorded fill_model; UI diagnostics. `analysis|ui/acceptance/backtest-next-bar-fill.feature`.
- **PRESERVE** `@AC-1..3 @feature-149`, `@AC-3 @feature-150` — metrics/grade math + legacy sizing unchanged.
- **PRESERVE** `@AC-6/@AC-7 @feature-147` (marketdata) + `@AC-1..5 @feature-147` (config) — FMP key via
  `GetSecret` not env; missing credential warns-not-crashes; encrypt-at-rest/redact/allow-list contract.
- **PRESERVE** `@AC-6/@AC-9 @feature-154` — the FMP `max_symbols` cap is gated on
  `marketdata.fundamentals.provider=="fmp"`; **EDGAR must not become a new value in that selector** or
  the cap silently misapplies. (Reinforces the separate-historical-source-path design.)
- **PRESERVE** `@AC-1/@AC-6 @feature-168`, `@AC-1..8 @feature-186` — existing snapshot
  `GetFundamentalsMulti` universe path + blend restrictions must keep working beside the PIT store.
- **PRESERVE** `@AC-8/@AC-9 @feature-156` — admin-gating precedent for new fundamentals agent tool /
  UI control. **PRESERVE** `@AC-1..3 @feature-173` — present-aware config reads (0 honored).
- **No CHANGE flagged.** No existing `@AC` is deliberately altered → no C-16 sign-off required, *as long
  as* the operand is added beside `source_symbol` and EDGAR is a separate source (not a snapshot-provider value).

---

## Risks / Not-found

- **[Not-found]** No historical-statement method in any vendor client; no PIT fundamentals table/hypertable;
  no EDGAR client/config/reference anywhere; no `data_kind` column; no fundamental `ComponentKind`. All greenfield.
- **[Not-found]** No existing `@AC` for point-in-time fundamentals — design authors fresh acceptance
  (`@AC-1..8` already in `acceptance.feature`). Latest-value snapshot semantics are doc-only (no @AC to preserve).
- **[Invariant, not @AC]** The `1d`-only backfill gate (feature 143, `ingest servicer.py:236-241`) and
  the admin gate (feature 092) are code/doc invariants — design must reconcile the data-kind branch explicitly.
- **[Trap T-1]** Look-ahead: the operand must resolve only rows with `filed_date ≤ _bar_date(bar)`; RED
  test asserts a Q filed after the simulated bar is invisible (`@AC-3`/`@AC-4`).
- **[Trap T-3]** Provider literals across two switch sites — the historical path avoids the snapshot
  selector entirely (separate source), but any touch of `marketdata_service.go` provider text must be audited.
- **[Trap ledger-153]** Size the new hypertable `chunk_time_interval` up front (avoid 1-day-chunk lock OOM).
- **[Trap ledger-129]** Verify EDGAR/FMP with a narrow direct-API check + fakes, not a deployed `grpcurl` step.
- **[Design fork D-1]** Hypertable partition column: `filed_date` (matches the as-of read filter) vs
  `period_end` (fiscal axis). **[D-2]** EDGAR XBRL tag → metric-name mapping + v1 normalization depth.

---

## Recommended Scope (advisory step boundaries)

1. **Proto** (additive, one PR gate): ingest `data_kind`+enum; marketdata historical message +
   `GetHistoricalFundamentals` + fundamentals-backfill worker RPC; analysis `ComponentKind` fundamental
   + `StrategyComponent` fields. `buf-gen` + agent parity update.
2. **marketdata migration 005** (fundamentals-history hypertable) + repo + EDGAR client + FMP-ratio
   enrichment + `GetHistoricalFundamentals` as-of read + backfill worker RPC (+ tests).
3. **ingest migration 012** (`data_kind`) + `TriggerBackfill` data-kind branch → marketdata worker (+ tests).
4. **analysis** `COMPONENT_KIND_FUNDAMENTAL` branch in `_compute_component`/`_assemble_component_series`
   (as-of `filed_date ≤ bar_date`) + fingerprint/write-validate (+ tests, incl. the T-1 RED test).
5. **agent** `trigger_backfill.data_kind` + `_build_component` fundamental kind + `backtest_view`
   projection + parity test + strat-lab skill (same PR).
6. **UI** backfills data-kind selector + `ComponentEditor` fundamental operand (+ e2e).

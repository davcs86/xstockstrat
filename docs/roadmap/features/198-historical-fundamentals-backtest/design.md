# Design: historical-fundamentals-backtest

**Created**: 2026-09-20
**Rounds**: 1 (quick; termination: approved)
**Approved by**: user @ 2026-09-20 (3 design forks resolved via AskUserQuestion)
**Grounded in**: recon.md

---

## Chosen Approach

A **fully separate fundamentals-PIT lane** beside the existing snapshot path at every layer, so no
existing selector/gate/table is perturbed (`recon.md:24`, `recon.md:153-155`). Five slices, proto-first.

### 1. Storage — plain table, not a hypertable (marketdata migration 005)
`marketdata.fundamentals_history` as a **plain PostgreSQL table** (not a Timescale hypertable). The
dataset is ~200k slow-growing rows, the dominant read filters `period_end` (a non-partition column),
and the snapshot store is itself a plain table (`recon.md:21`) — so hypertable partitioning buys no
planner benefit and would re-import the ledger-153 chunk-lock-OOM surface for nothing.
- **PK `(symbol, fiscal_period, period_type)`** + column `filed_date date` + `accepted_date timestamptz`
  + `period_end date` + `source text` + `currency text` + the reused `_FUNDAMENTAL_FIELDS` metric
  columns (`recon.md:66-68`, `screener.py:40-52`) as nullable numerics + `extra_metrics jsonb` for
  raw XBRL overflow. Btree index `(symbol, period_end, filed_date)`.
- **Idempotency (@AC-1):** store the **original as-reported** filing per period — `INSERT … ON CONFLICT
  (symbol,fiscal_period,period_type) DO NOTHING` (keep the earliest `filed_date`; later 10-K
  comparatives / 10-Q/A amendments do not overwrite). A same-range re-backfill produces no duplicate;
  restatement history is **out of scope for v1** (no `@AC` requires it — see Rejected Alternatives).
  This dissolves the AC-1↔unique-key tension the debate raised (the triple PK *is* the AC-1 guarantee).

### 2. Historical source — separate interface + EDGAR client + PIT price-join
- New **`HistoricalFundamentalsSource` interface** in `internal/source/source.go` (beside, not
  extending, the snapshot `FundamentalsSource` at `source.go:65` / `recon.md:31`), implemented by a new
  `internal/edgar/edgar_client.go` (XBRL `companyfacts`; keyless; **non-secret** `User-Agent` via
  `GetString`, `recon.md:107-108`). Held as its own marketdata service field — **never** constructed by
  `newFundamentalsSource` (`main.go:185`) nor added to the `marketdata.fundamentals.provider` switch,
  so EDGAR never becomes a value the feature-154 FMP-cap gate keys on (preserves `@AC-6/@AC-9
  feature-154`, `recon.md:153-155`).
- **PIT price-join (user decision 1):** EDGAR supplies statement items + `eps`/`roe`/`debt_to_equity`
  + `CommonStockSharesOutstanding`. Price-derived metrics are computed **point-in-time** from the
  adjusted close **at `filed_date`** already in `marketdata.ohlcv` (`recon.md:34`, `marketdata_repo.go`
  bars read): `market_cap = close(filed_date) × shares_outstanding`, `pe_ratio =
  close(filed_date) / eps_ttm`. This keeps `@AC-4`'s `pe_ratio` honest and look-ahead-free — the price
  is historical, the EPS is from the filing. FMP `ratios-ttm` is **not** used for historical rows (it
  is a current snapshot → would be look-ahead).
- **FMP ratio enrichment (optional, cap-aware):** where a statement-derived ratio is genuinely
  unavailable, an optional FMP pass may fill it, guarded by a **dedicated** `marketdata.fmp.daily_request_cap`
  check with **its own request counter** — NOT `fundamentalsQuota()`, which dispatches on the snapshot
  provider (defaults to `finnhub` → wrong cap) and counts the snapshot table (`recon.md:132-133`,
  `marketdata_service.go:1364-1376`). Cap exhausted → enrichment skipped, EDGAR-only row persists with
  null ratio fields (`@AC-5`).

### 3. As-of read RPC (marketdata)
`GetHistoricalFundamentals(symbol, as_of_date, range_start, range_end, period_types)` →
`repeated HistoricalFundamentalsPeriod` filtered **`filed_date < as_of`** (T+1, user decision 3) and
`period_end ∈ range`. A distinct message — the snapshot `Fundamentals` (max field 18, `recon.md:122`)
is untouched.

### 4. Backfill data-kind (ingest migration 012 + branch → new marketdata worker)
- Proto `TriggerBackfillRequest.data_kind = 7` (`recon.md:122`) with enum
  **`BackfillDataKind { BACKFILL_DATA_KIND_UNSPECIFIED=0, _BARS=1, _FUNDAMENTALS=2 }`** (C-04-compliant
  sentinel; the servicer maps UNSPECIFIED→BARS for back-compat — @AC-6 is a servicer rule, not enum
  numbering).
- ingest migration `012` adds `data_kind` to `backfill_jobs`/`backfill_chunks` (+ `_UPDATABLE_COLUMNS`
  and the `job_row` fixture 15→16 cols, feature-080 guard, `recon.md:41`).
- At `servicer.py:236-241` branch **before** the `1d` reject: `data_kind==FUNDAMENTALS` skips the
  timeframe reject (`@AC-6`), persists `data_kind`, and routes `_run_chunks` (symbol × period-range
  chunks) to a new `marketdata.BackfillFundamentals` worker RPC instead of `BackfillBars`. Header trio
  propagated (C-03, `recon.md:134`). `BARS`/unset preserves every OHLCV caller byte-for-byte.

### 5. Backtest fundamental operand + LIVE parity (analysis)
- Proto: `ComponentKind.COMPONENT_KIND_FUNDAMENTAL = 3` + `StrategyComponent.fundamental_metric = 7`
  (`recon.md:123`). No `BacktestResult` field (entries already carried; `@AC-8` reads the existing
  shape) → agent parity update limited to the projected `StrategyComponent`.
- Resolution in the **shared** seam `_assemble_component_series` (`evaluator.py:368`, `recon.md:57-62`)
  as a **distinct as-of carry-forward** join (NOT the feature-152 none-on-miss benchmark join): for each
  `eval_date` = `_bar_date(bar)` (`evaluator.py:34`), the latest row with **`filed_date < bar_date`**
  (T+1); the last known filing carries forward until the next filing; `None`/hold before the first
  filing (`@AC-3` → `_resolve_term` hold/false). Carry-forward is explicitly *not* forward-filling a
  future value — the no-look-ahead invariant (T-1) holds.
- **Full live parity (user decision 2):** the fundamentals preload is threaded through the shared
  evaluator for **every** consumer (backtest servicer `:1550`, live loop, `EvaluateReadiness`,
  `ListOpportunities`, `GetIndicatorSeries`) — mirroring how `_load_benchmark_bars` is wired into both
  backtest and live (`recon.md:57-62`), with **bounded per-symbol fan-out** (existing semaphore/batch
  pattern). Preserves `@AC-7 feature-152` (operand resolves in live eval, no silent hold).
- Metric name validated against `_FUNDAMENTAL_FIELDS ∪ extra_metrics` (`screener.py:40-52`, ledger-117)
  restricted to PIT-sourceable metrics, and folded into the `definition_json` fingerprint at write
  (`@AC-6 feature-152`). Unset operand never enters the branch → baseline byte-identical (`@AC-1 feature-152`).

### 6. Consumer surfaces (C-14)
- **Agent:** extend `trigger_backfill` (`tools.py:1078`) with `data_kind`; extend `_build_component`
  (`client.py:639`) with the fundamental kind; update the `backtest_view` `StrategyComponent`
  projection + its parity test; update `plugins/strat-lab/skills/backtest/SKILL.md` + `reference/backfill.md`
  **in the same PR** (ledger-134, root CLAUDE.md, `recon.md:73-82`).
- **UI:** a data-kind selector on the existing `/insights/backfills` create form (`page.tsx:213-256`)
  and a fundamental-operand option in `ComponentEditor.tsx`/`StrategyWizard.tsx`. Existing routes → no
  C-10(a) nav re-registration (`recon.md:113-115`). Canonical state primitives + tokens (C-17).

## Rejected Alternatives

- **Timescale hypertable partitioned on `filed_date`** — rejected: no planner benefit (reads filter
  `period_end`, a non-partition col), forces `filed_date` into the unique index (breaking @AC-1's
  triple-uniqueness), and re-imports the ledger-153 lock-OOM surface for a ~200k-row dataset. Plain table wins.
- **Reuse the snapshot `FundamentalsSource` / `provider` selector for EDGAR** — rejected: it is
  snapshot-only, and adding EDGAR as a `marketdata.fundamentals.provider` value silently misapplies the
  feature-154 FMP cap (`@AC-9 feature-154` regression).
- **FMP `ratios-ttm` for historical rows** — rejected: current-snapshot data keyed to a past filing
  date is itself look-ahead (T-1). Price-join from stored OHLCV is the PIT-honest substitute.
- **`fundamentalsQuota()` for enrichment** — rejected: provider-dispatched (wrong cap under default
  `finnhub`) and counts the snapshot table; a dedicated cap check is required for @AC-5 to fire.
- **Backtest-only operand (no live)** — rejected by user decision 2: would break backtest/live parity
  (`@AC-7 feature-152`) — a strategy entering in backtest but holding live.
- **Store restatement/amendment history (multi-filing per period)** — rejected for v1: no `@AC`
  requires it and it reintroduces the AC-1 duplicate-key problem; a named follow-up if ever needed.
- **Same-day availability (`filed_date ≤ bar_date`)** — rejected by user decision 3 in favor of
  conservative **T+1** (`filed_date < bar_date`), since SEC filings often accept post-close.
- **EDGAR-native-only vocab (drop pe_ratio in v1)** — rejected by user decision 1 in favor of the PIT
  price-join, keeping `@AC-4`'s pe_ratio in v1.

## Open Risks

- [ ] **EDGAR XBRL tag → `_FUNDAMENTAL_FIELDS` mapping depth (D-2)** — v1 maps tags that land on the
  reused vocab (+ price-join for pe/market_cap); overflow → `extra_metrics`. To be pinned at `/sdd-spec` (marketdata step).
- [ ] **EDGAR `filed_date` determinism** — the ON CONFLICT DO NOTHING keep-earliest rule assumes a
  stable earliest `filed_date` per period. Validate against real companyfacts in the marketdata backfill step's tests.
- [ ] **T-1 look-ahead RED test must probe the T+1 boundary** (a filing on `filed_date` D is invisible
  on bar D, visible on D+1) and a between-filings gap — not just pre-first-filing (ledger feature-150 trap). At the analysis test step.
- [ ] **Price-join coverage** — pe/market_cap require an OHLCV bar at/near `filed_date`; missing price
  → null metric (fail-closed), not a crash. Addressed in the marketdata backfill step.
- [ ] **032 seam** — keep the operand inside `StrategyComponent`/`_assemble_component_series` so a
  future `RunSegmentedBacktest` wrapper inherits it; pre-assign `analysis.proto` field numbers if 032 reaches impl-spec concurrently (proto step).

## Constitution Rules Touched

- `C-04` — honored: `BackfillDataKind` has `BACKFILL_DATA_KIND_UNSPECIFIED=0`; UNSPECIFIED→BARS in the servicer.
- `C-05`/`F-07` — honored: all knobs are config keys read via WatchConfig; EDGAR UA is non-secret `GetString`; no hardcoded values.
- `C-07`/`F-01` — honored: new migrations marketdata `005`, ingest `012` (verified tips), each with `.up.sql`+`.down.sql`; no applied migration edited.
- `C-03` — honored: ingest→marketdata `BackfillFundamentals` and analysis→marketdata `GetHistoricalFundamentals` propagate the `x-user-id`/`x-access-scope`/`x-trace-id` trio.
- `C-08`/`C-15`/`P-06` — honored: each service step pairs a test step; every `@AC-*` gets a covering RED assertion incl. the T+1 look-ahead test.
- `C-09` — honored: additive proto only; `buf lint`+`buf breaking` green; `buf-gen` run; agent `StrategyComponent` parity projection updated same PR (ledger-134).
- `C-10`/`C-14` — honored: agent (`trigger_backfill`/`_build_component`/parity/strat-lab skill) + UI (backfills selector + ComponentEditor) reached in the same feature.
- `C-18` — honored: plain table over hypertable (YAGNI); separate lane reuses the source_symbol operand pattern, source.Fundamentals vocab, backfill lifecycle, GetSecret (DRY).
- `F-06` — honored: EDGAR is HTTP; enrichment reuses the existing FMP client/pool; no new DB pool.

## Business Rules Touched (C-16)

- PRESERVE `@AC-1 @feature-152` "empty operand → byte-for-byte baseline" — unset fundamental operand never enters the new branch.
- EXTEND `@AC-2/@AC-3/@AC-6/@AC-7 @feature-152` (`services/xstockstrat-analysis/acceptance/market-regime-benchmark-operand.feature`) — new operand class added beside `source_symbol`, sharing the "value at t uses only data ≤ t" contract (here `< bar_date`, T+1), gap→hold/never-future-fill, fingerprint fold, and **live resolution**. Added-beside (not modifying the source_symbol path) → EXTEND, not CHANGE; no C-16 sign-off required.
- PRESERVE `@AC-3/@AC-4/@AC-5/@AC-10/@AC-11 @feature-151` — no look-ahead; legacy fill/return byte-for-byte; recorded fill_model; UI diagnostics unaffected (unset operand path unchanged).
- PRESERVE `@AC-1..3 @feature-149`, `@AC-3 @feature-150` — metrics/grade math + legacy sizing default unchanged.
- PRESERVE `@AC-6/@AC-7 @feature-147` + `@AC-1..5 @feature-147` — FMP key via `GetSecret` not env; missing credential warns-not-crashes; EDGAR adds a non-secret key only.
- PRESERVE `@AC-6/@AC-9 @feature-154` — EDGAR is a separate source, never a `marketdata.fundamentals.provider` value → the provider-keyed FMP cap gate is untouched.
- PRESERVE `@AC-1/@AC-6 @feature-168`, `@AC-1..8 @feature-186` — snapshot `GetFundamentalsMulti` universe path + blend restrictions untouched (additive lane).
- PRESERVE `@AC-8/@AC-9 @feature-156` — new agent tool arg + UI control admin-gated per precedent. PRESERVE `@AC-1..3 @feature-173` — present-aware config reads.
- **This feature's own `@AC-4`/`@AC-3`** are reworded from same-day to **T+1** per user decision 3 (see acceptance.feature; recorded in context.md). Not yet promoted, so no C-16 amendment of a durable suite.

# Design: fix-historical-fundamentals-price-join

**Created**: 2026-09-27
**Rounds**: 5 (full; termination: approved with Round-5 additive fixes folded in)
**Approved by**: user @ 2026-09-27 (design gate)
**Grounded in**: recon.md

---

## Chosen Approach

Fix entirely in **xstockstrat-marketdata**, on the write path. The root cause is two coupled
behaviors: the historical-fundamentals write is insert-only (`ON CONFLICT (symbol, fiscal_period,
period_type) DO NOTHING`, `marketdata_repo.go:610`) and the price-join is a one-shot at insert time
that fails closed to nil when no bar exists (`priceJoin` → `CloseAt`, `marketdata_service.go:1824,1844,1849-1851`).
`overwrite` reaches nothing in marketdata today (`BackfillFundamentals` never reads it,
`marketdata_service.go:1719-1758`). No migration/proto/config/ingest/agent/UI change is needed —
the five price columns already exist (`005_fundamentals_history.up.sql:16-24`), the `overwrite` proto
field exists and ingest already forwards it (`marketdata.proto:296`, `servicer.py:375`), and the
agent tools are pure proxies (`missing_metrics` backend-authoritative, recon.md § agent).

**Restructured per-period loop in `backfillOneSymbol`** (`marketdata_service.go:1762`, replacing the
`:1792-1817` step), read-classify-derive-merge keyed on the **stored** row:

1. `accumulateTTM(p, &quarterlyEPS)` — **always**, before any branch, so the rolling 4-quarter TTM-EPS
   window stays aligned even for skipped periods (extracted from the current in-`priceJoin`
   accumulation, `:1825-1843`).
2. `state := s.histRepo.GetHistoricalPriceState(sym, p.FiscalPeriod, p.PeriodType)` — one indexed
   triple-PK read; `pgx.ErrNoRows → Found=false`.
3. **New row (`!Found`)** — the forward path, unchanged in shape: run
   `derivePriceMetrics(p, ttmEPS, currency=p.FiledDate's fresh p.Currency)` + `deriveDividendYield`
   (coverage-guarded) + optional enrichment (`:1806-1812`), then `InsertHistoricalFundamentals` with
   `ON CONFLICT DO NOTHING` preserved (feature-198 idempotency). A brand-new symbol backfilled **with**
   bars derives its metrics on the first pass (no regression of feature-198/211 `@AC-4`).
4. **Existing row (`Found`)** — recover keyed on the **stored earliest `filed_date`**
   (`p.FiledDate = state.FiledDate` before derivation), so `CloseAt`/the T12M window key on the earliest
   filing → look-ahead is structurally impossible and feature-198 `@AC-2`/`@AC-4` hold. Gate: default
   processes only `needsFill` rows (any of the 5 price columns nil); `overwrite=true` processes every
   existing row. Derive, then apply the **unified per-column merge**, then `UpdateHistoricalPriceJoin`
   only when ≥1 merged column differs from the stored value.

**Unified per-column merge** (all 5 columns — `price`, `market_cap`, `pe_ratio`, `pb_ratio`,
`dividend_yield` — identical rule; `??` = coalesce, left if non-nil else right):

| Mode | merge | effect |
|---|---|---|
| default (`overwrite=false`, `needsFill` rows) | `existing ?? derived` | fill only nil columns; a populated column is never touched |
| `overwrite=true` (every existing row) | `derived ?? existing` | take a non-nil freshly-derived value; keep existing when derivation yields nil |

Every cell is **monotonic**: nil→value (recovery/fill) or value→value′ (refresh, overwrite only);
**never value→nil**. So a later no-bars re-run never clobbers a good price (fail-closed), and the
dividend coverage guard (below) leaving `derived=nil` on an uncovered window always keeps the stored
value.

**Dividend fail-closed coverage guard** (on derivation only): the T12M window `[filed−365d, filed]`
is computed against the fetched dividend range `[divFetchStart, now]` where `divFetchStart = now −
marketdata.dividends.backfill_lookback_years` (`:1778`). When `windowStart.Before(divFetchStart)` the
window predates the fetch → `deriveDividendYield` returns nil (never a fabricated 0). This runs on
**both** the new-row and recovery paths, so it also fixes the latent forward-path fabricated-0 for a
deep-bar-history symbol (feature-211 `@AC-5`). The `SumDividendsInWindow` middle return is
"has any dividend row" (COUNT with no date filter, `marketdata_repo.go:551-560`), **not** a coverage
signal, so it stays discarded; the explicit window check is used instead.

**Go-merge + dumb SQL** (not a `COALESCE` upsert): `GetHistoricalPriceState` returns the stored
columns and the merge is plain Go nil-checks; `UpdateHistoricalPriceJoin` is a trivial
`UPDATE marketdata.fundamentals_history SET price=$4, market_cap=$5, pe_ratio=$6, pb_ratio=$7,
dividend_yield=$8 WHERE symbol=$1 AND fiscal_period=$2 AND period_type=$3`. This puts the
clobber-vs-fill logic in unit-testable Go (retiring the fails.md:722/757/727-729 "SQL merge only
asserted as a string" trap) and is the only shape that can both keep-existing and, where intended,
set-null per column. Both new methods use `r.db` (matching `InsertHistoricalFundamentals`,
`marketdata_repo.go:612`).

**New symbols/signatures** (confirmed non-existent today):
- `source.HistoricalPriceState{ Found bool; FiledDate time.Time; Price, MarketCap, PERatio, PBRatio, DividendYield *float64; Currency string }`. `FiledDate` carries the stored earliest `filed_date` so recovery derives against it (§ Chosen Approach 4: `p.FiledDate = state.FiledDate` before derivation) — the load-bearing property that keeps look-ahead impossible and preserves feature-198 `@AC-4`.
- `histFundamentalsRepo` (`marketdata_service.go:112-119`) gains `GetHistoricalPriceState(ctx, symbol, fiscalPeriod, periodType) (*HistoricalPriceState, error)` and `UpdateHistoricalPriceJoin(ctx, symbol, fiscalPeriod, periodType string, price, marketCap, peRatio, pbRatio, dividendYield *float64) error`.
- `priceJoin` split into `accumulateTTM` (always) + `derivePriceMetrics` (when deriving); `priceJoin` retained as a thin wrapper so `TestPriceJoin_*` compile, then retargeted onto `derivePriceMetrics`.

**Currency-mismatch fail-closed hardening** (Round-5 fix): for an **existing** row, gate the native-
equity `pe_ratio`/`pb_ratio` derivation (`marketdata_service.go:1861,1872`) on `state.Currency`, and
derive native pe/pb **only when `state.Currency == p.Currency`** — fail closed (leave nil) on any
mismatch. This prevents a pre-211 non-USD row (whose as-reported `currency` is wrongly "USD" and is
never rewritten) from producing a fabricated USD-price ÷ fresh-CNY-equity ratio (feature-211 `@AC-5`
"never fabricate", `@AC-9` currency-consistent pb). The USD-equity pb path
(`stockholders_equity_usd`, `:1869`) is currency-agnostic and unchanged.

**Overwrite = operator refresh** (`overwrite=true`): recomputes the 5 derived price columns of an
existing row from the stored earliest `filed_date` and the current adjusted close — the operator path
to refresh a stale/wrong price. Signed off as a C-16 CHANGE (below).

**Consumer surface (C-14):** the metrics flow to the existing `xstockstrat-agent` `query_fundamentals`
tool and the `xstockstrat-ui /insights/data-explorer` page unchanged — both render backend-authoritative
data, so previously-"—" cells populate after recovery with no UI/agent code change.

**Out of scope:** `debt_to_equity` recovery (as-reported / feature-211 formula-derived, not price-join),
and bars-before-fundamentals orchestration ordering (caller-sequencing across two one-`data_kind`
`TriggerBackfill` calls; cannot recover existing rows — the write-path fix is necessary and sufficient).

## Rejected Alternatives

- **Single `INSERT ... ON CONFLICT DO UPDATE SET x=COALESCE(EXCLUDED.x, table.x)`** — rejected: the
  merge lives in SQL a mock can't execute (fails.md:722/757/727-729), COALESCE can't set-null per
  column (needed for the abandoned fabricated-0 clear), and it can't cleanly skip the write when
  nothing changed.
- **Read-time projection of the price-join** — rejected: `@AC-1` requires the metrics *persisted*;
  breaks feature-198 `@AC-4` stored-PIT contract; re-plumbs every read path + the snapshot lane.
- **Incoming-`filed_date`-equality guard** (`WHERE filed_date = EXCLUDED.filed_date`) — rejected:
  fragile to amendment/normalization drift → permanent gap (the exact bug this feature kills); the
  `period_end` mitigation is unsound (period_end is invariant across a 10-Q and a later comparative
  10-K → reintroduces look-ahead).
- **Widen the dividend fetch window to `max_lookback_years` (10y)** — rejected: 5× Alpaca cost for a
  fail-closed metric; the coverage guard is cheaper and `@AC-5`-aligned.
- **`dividendAuthoritative`-gated value→nil (clear an already-persisted fabricated 0)** — rejected
  (Round 4→5): the coverage guard is wall-clock-relative, so it would wipe *legitimate* dividend_yield
  for periods older than ~1yr on every re-run; a fabricated 0 is indistinguishable from a real 0 on an
  uncovered period. Abandoned; unified dividend_yield with the other 4 columns.
- **Force-recompute rewriting as-reported fields / `filed_date`** — rejected: overwrite touches the 5
  derived price columns only (structural: fixed SET list + triple-PK WHERE).
- **Persist a `dividend_yield_source`/coverage marker column** — rejected: schema/migration for a
  marginal cleanup; YAGNI (C-18) for a SEV-3.
- **Recovering `debt_to_equity`** — rejected: as-reported/formula-derived, not price-join; out of scope.

## Open Risks

- [ ] **Adjusted-close drift under overwrite** — `marketdata.alpaca.adjustment=all` means the adjusted
  close for a past date drifts as later splits/dividends re-adjust the series, so an `overwrite=true`
  re-run after a corporate action legitimately changes stored `price/market_cap/pe_ratio/pb_ratio`
  (a correct write, not churn). "Stable re-run → no write" holds only when adjusted OHLCV + EDGAR facts
  are byte-stable. Accepted, operator-visible; pre-existing to feature-198's adjusted-close design.
  Document in the impl-spec / operator note — no code change (target: `/sdd-spec` note + `@AC` for
  idempotency-when-stable).
- [ ] **EDGAR `fiscal_period` relabel between insert and re-run** → `GetHistoricalPriceState` returns
  `Found=false` → new-row DO-NOTHING lane → the stale nil row silently no-ops for that period. Recovery
  would need label-agnostic matching (out of scope). Accepted open risk — to be noted in the impl-spec;
  no mitigation this feature.
- [ ] **Pre-211 currency residual (now fail-closed, not fabricated)** — the currency-mismatch harden
  leaves native pe/pb nil for a pre-211 non-USD row whose stored `currency` is wrongly "USD" while
  fresh EDGAR says otherwise. Safe (no fabrication) but such rows won't recover native pe/pb until their
  as-reported `currency` is corrected (a separate concern). Accepted — to be covered by test (f).

## Constitution Rules Touched

- `C-01` — honored: every symbol/path cited from recon.md; new symbols confirmed non-existent before naming.
- `C-08` / `P-06` — honored: each service change pairs with a RED-before-GREEN test; the clobber-vs-fill
  and overwrite val→val′ logic executes in the stateful `fakeHistRepo211`, the UPDATE SQL is pgxmock-pinned,
  and the product-spec dev smoke is the real-Postgres gate. C-18 trade-off (no testcontainers for a SEV-3)
  recorded.
- `C-14` — honored: consumer surfaces named (agent `query_fundamentals`, ui `/insights/data-explorer`),
  reached unchanged (backend-authoritative data), no stale surface.
- `C-15` — honored: `@AC-3`/`@AC-4`/`@AC-5` added to acceptance.feature; every scenario maps to a test
  step at `/sdd-spec`. (`@FR` tags waived per the bug-spec convention, recorded in context.md.)
- `C-16` — see Business Rules Touched.
- `C-18` — honored: minimum footprint (single service, no migration/proto/config); the Round-4→5
  simplification (unified merge, deleted dividend special case) reduces mechanism; testcontainers
  declined with recorded rationale; the legit-nil-forever extra read and the dividend fetch-window are
  accepted bounded costs.
- `F-01` — honored: no migration (columns exist).
- `F-04` — honored: no invented path/symbol.
- `F-06` — honored: one extra indexed SELECT per period on the pooled backfill path; no pool/service
  change, no budget re-check triggered (marketdata routes via PgBouncer).
- `F-07` — honored: no hardcoded config; the 365-day T12M window is an established feature-211 in-code
  domain constant, not a config value.

## Business Rules Touched (C-16)

- **CHANGE** feature-198 `@AC-1`/`@AC-2` (`docs/roadmap/features/198-historical-fundamentals-backtest/acceptance.feature:11,18`)
  — under `overwrite=true`, the 5 **derived** price columns of an existing row MAY be overwritten by a
  re-fetch (a deliberate operator override of "no earlier period row overwritten by a later fetch",
  scoped to derived price columns only). **Signed off by user @ 2026-09-27 (design gate); recorded in
  context.md.** As-reported fields (currency, eps, roe, debt_to_equity, beta, year_high/low,
  extra_metrics) and the earliest `filed_date` are **never** overwritten (structural: fixed 5-column
  SET + triple-PK WHERE). Feature-198 `@AC-1` (no duplicate rows) preserved — new rows still DO NOTHING,
  existing rows UPDATE in place.
- **PRESERVE** feature-198 `@AC-4` — pe computed PIT from the adjusted close at the (stored earliest)
  filing date — not regressed by: derivation keys on `state.FiledDate`, never the re-fetch's.
- **PRESERVE** feature-211 `@AC-4`/`@AC-5` (`services/xstockstrat-marketdata/acceptance/edgar-fundamentals-enrichment.feature`)
  — no look-ahead (price as-of filed_date); dividend_yield never a fabricated 0 (coverage guard) and
  never wiped (monotonic merge).
- **PRESERVE** feature-211 `@AC-1`/`@AC-9` — reporting currency untouched; pe/pb currency-consistent via
  the stored-currency gate + currency-mismatch fail-closed.
- **PRESERVE** feature-211 `@AC-6`/`@AC-9` snapshot↔PIT parity — `getEdgarSnapshot`/`edgarSnapshotFromPeriod`
  overlays a live price and does not call `priceJoin`; the split leaves it untouched.
- **PRESERVE** feature-204 `@AC-7`/`@AC-19` (`services/xstockstrat-agent/acceptance/backfilled-data-queryable.feature`)
  — historical rows stay queryable; the query_fundamentals CSV column shape is unchanged.
- **EXTEND** feature-211 `@AC-8` — data-explorer periods that were "—" for lack of bars become populated
  after recovery; the "populated + currency + source" guarantee itself is preserved.
- **Note (C-16 promotion debt):** feature-198's guarantees are launched but not promoted into a durable
  suite — recorded in context.md; separate, non-blocking (`scenario-promoter` at a later pass).

# Design: sector-classification-strategy-params

**Created**: 2026-09-27
**Rounds**: 4 (deep; termination: approved)
**Approved by**: user @ 2026-09-27
**Grounded in**: recon.md

---

## Chosen Approach

### Group A — sector classification store (xstockstrat-marketdata)

**SCD-2 store.** Migration **007** `symbol_classification` as a **plain table** (not a hypertable):
`symbol`, `sector` (GICS enum name text), `taxonomy`, `source`, `valid_from`, `valid_to` (NULL =
current), `refreshed_at`. A **partial-unique index `(symbol) WHERE valid_to IS NULL`** enforces one
open row per symbol (FR-2); a `(symbol, valid_from, valid_to)` index serves as-of reads. A plain
table is deliberate: sector history is ~1–2 rows/symbol, so it has no chunk-lock surface and
neutralizes the feature-153 SQLSTATE 53200 regression by construction (recon.md:73,95). A new
`ClassificationRepo` mirrors `MarketDataRepo`/`execer` + pgxmock (recon.md `marketdata_repo.go:29-35`)
and reuses the existing pool (no new DB connection — F-06 clear).

**Refresh job = the seeding mechanism.** A ticker-poller (template `marketdata_service.go:801,876`,
wired as a third goroutine `main.go:145-147`, gated by `marketdata.classification.enabled` +
`marketdata.classification.refresh_interval_hours`) reads FMP's profile sector per symbol and runs a
three-way branch per symbol:
- **no open row** → `INSERT (valid_from = EPOCH_SENTINEL) … ON CONFLICT ((symbol) WHERE valid_to IS
  NULL) DO NOTHING` — this **is** the hybrid seed (FR-10);
- **open row, sector unchanged** → no write (AC-3);
- **open row, sector changed** → one per-symbol txn: `SELECT … FOR UPDATE` the open row, re-check
  inside the txn (READ COMMITTED), then `UPDATE valid_to = now()` + `INSERT` new open row
  `valid_from = now()` (AC-2).

`EPOCH_SENTINEL = '1900-01-01T00:00:00Z'` — a fixed constant, **not** `1970-01-01`: the latter is
protobuf/unix-0, i.e. the wire-default of an unset `as_of` Timestamp on the FR-5 RPC, which would
make an omitted `as_of` indistinguishable from "as-of epoch" (round-4 must-fix). 1900 is negative
unix seconds, provably distinct from an unset field; no platform bar predates it (Alpaca has no
pre-~2016 data). The **no-open-row branch is uniform** across both writers (refresh job + fundamentals
profile write-through) — both insert `EPOCH_SENTINEL` via `ON CONFLICT DO NOTHING`, so concurrent
first-observation deterministically yields one open epoch row (AC-12). `valid_from = now()` is used
**only** for the post-go-live change transition, never first observation. Restart-safe: open-row
existence in the DB is the idempotency key.

**FMP gateway — one throttle authority at `getJSON`.** The FMP client's single request chokepoint
`getJSON` (`fmp_client.go:118`) reuses the Alpaca-style `rate.NewLimiter(rps, 1)` (**burst=1**, strict
rolling-1s per AC-1) fed by new `marketdata.fmp.rate_limit_rps`, then applies a single shared
`fmpDayBudget{mu, utcDay, used, cap}` with a **reserve/commit/refund** discipline: roll the UTC day,
`reserve()` before `c.http.Do` (`:128`) — return `ErrFMPDailyCapExceeded` when `used >= cap`
(enforces ≤cap under concurrency), else `used++`; a `defer` **refunds** the slot unless the request
reaches the HTTP-200 path, so only a successful fetch consumes budget and a 503 storm refunds every
slot (closes the AC-4 self-throttle regression). `cap` is read live from
`marketdata.fmp.daily_request_cap` (F-07 clear). This replaces the two existing per-path day-counters
(`fundamentalsQuota` DB count `marketdata_service.go:1559-1562`; `enrichmentUnderCap` `:1884`) with
one budget every FMP path shares — the fix for the round-2 "3×cap ≈ 750/day" defect and the
`fails.md:1038` parallel-path trap. The budget is **boot-seeded** once from
`CountFundamentalsFetchedToday` (`marketdata_repo.go:565`, kept for this) so a mid-day restart cannot
re-grant a fresh 250 (a conservative floor, not an exact ledger — see Open Risks).
`ErrFMPDailyCapExceeded` maps distinctly to serve-stale/`ResourceExhausted` at the fetch sites
(`:1356,:1402`), not `CodeUnavailable`.

**Reads never hit FMP.** `GetCurrentSector` (open row), `GetSectorAsOf` (PIT), and
`GetSectorHistory(symbol, range)` (the batched primitive analysis uses) all read the local table, so
an FMP outage degrades only refresh freshness, never classification reads or scoring (FR-4).

### Group B — per-sector parameters (xstockstrat-analysis / indicators)

Per-sector overrides live on `StrategyDefinition` **field 15** — `repeated SectorParamOverride
{ string component_ref; string param_name; double default_value; repeated SectorValue by_sector; }`
(`SectorValue { Sector sector; double value; }`) — riding the existing `analysis.strategies` JSONB
`definition_json` with **no analysis migration** (feature 132/133 precedent, recon.md:62,87).
`ManageStrategy` validates each `(component_ref, param_name)` resolves to a real component/param and
rejects `INVALID_ARGUMENT` otherwise, and folds the field into the definition fingerprint (a changed
override clears the derived grade; feature-152 `@AC-6` precedent).

**As-of resolution without a per-bar RPC.** `_backtest_symbol_definition` issues **one**
`GetSectorHistory` per symbol per backtest (mirroring `_fetch_bars_paged` header propagation
`servicer.py:1155`), snapshotting the intervals at run start; `sector_by_bar[i]` is resolved locally
as-of each `bar.time` (real `Bar` field, not `Bar.timestamp`; real fixtures, not `MagicMock` —
`fails.md:726`). A bar with **no covering row** falls to the fixed `default_value` bucket — never a
carry-forward of a prior sector (feature-152 `@AC-3`).

**Compute-K-variants, stitch per bar.** Threaded through `evaluate_with_series` →
`_assemble_component_series` (`evaluator.py:587`) → `_compute_component` (`:398`). For a component
carrying overrides: collect the **K distinct resolved param dicts** across the window (K ≤ ~11 GICS,
usually 1; distinct *dicts* collapse many params), compute the component series **once per distinct
dict over the full-window closes**, then stitch `out[i] = variant[sector_by_bar[i]][i]`. Because each
variant is a full contiguous compute, warmup/lookback is correct at any mid-window sector boundary —
we never segment the closes. `_assemble_component_series` takes pre-fetched closes, so there is **no**
K×`GetBars` (no chunk-lock re-exposure), and the K computes ride the **existing** analysis sems
(`analysis.series.max_concurrent_components`, `analysis.compute.max_worker_threads`,
`analysis.opportunity.max_concurrent_bars_fetches`) — no new key. **No overrides → K=1 →
byte-identical** to today, preserving feature-151/149/152 no-override parity.

### Consumer surfaces (C-14)

- **Agent** — `manage_strategy` gains the per-sector override map arg (mirroring the `signal_params`
  Struct mapping `client.py:895` + the `supplied` merge-mask `tools.py:994`); `run_backtest` results
  carry the seed-span marker. The seed-span-affected marker **rides the existing
  `BacktestResult.warnings` repeated string** (`analysis.proto:138`, feature 086) — **no new proto
  field** — so it triggers no agent descriptor-parity break and reaches both the agent
  `backtest_view.py:73-74` and the UI `backtest-warnings` card. `plugins/strat-lab/skills/backtest/
  SKILL.md` updated in the same PR (repo rule).
- **UI** — per-sector override authoring extends `ComponentEditor` (`params: Record<string,number>`
  precedent, `ComponentEditor.tsx:41`) / `StrategyWizard`; `/insights` renders sector-resolved
  backtest output + the seed-span warning. The **`Sector` enum** (the one genuinely new wire enum)
  fans out to the UI exhaustive `Record<Enum,…>` maps (`BacktestDiagnostics.tsx:17,25,31,40`) in the
  same PR (`fails.md:81-82,1151`).

### Seed-span visibility

`symbol_classification` carries a `source` column (`'seed'` for epoch rows). `GetSectorHistory` rows
expose `source` + `valid_from`, so analysis derives the seed-span marker locally: a backtest whose
window precedes the symbol's earliest non-seed classification (or resolves any bar against a seed row)
appends a `warnings` entry, making the bounded pre-go-live look-ahead visible where a human reads the
number.

## Rejected Alternatives

- **Type-1 overwrite cache** — rejected: destroys the reclassification history a PIT backtest needs; irrecoverable (established pre-story).
- **Hypertable for `symbol_classification`** — rejected: ~1–2 rows/symbol has no chunk-lock surface; a hypertable adds the feature-153 lock budget for nothing.
- **EDGAR/Fama-French or Finnhub as the classification source** — rejected: FMP is already wired and GICS-flavored (smallest surface); EDGAR is a new client, US-only.
- **Per-bar as-of classification RPC** — rejected: over a 400-day window it is the exact feature-153 lock-exhaustion hot path; replaced by one batched `GetSectorHistory` per symbol per run.
- **Segment-and-recompute the closes at each sector boundary** — rejected: reintroduces indicator warmup discontinuity at the boundary; compute-K-full-window-variants avoids it.
- **Per-`StrategyComponent` field-7 override map** — rejected: co-locates with the component (no dangling ref) but bloats every component, can't share a param across components, duplicates storage; definition-level field 15 + write validation chosen instead.
- **Child table for per-sector params** — rejected: JSONB on `analysis.strategies` is the feature-132/133 precedent, no analysis migration.
- **Three independent per-path FMP day-counters ("orthogonal layers")** — rejected: ≈3×cap true spend; one shared counter at `getJSON` is the only correct per-day gate.
- **Pure in-memory budget (no DB boot-seed)** — rejected: re-grants a fresh 250 on every restart/deploy → paid-tier overage.
- **Post-hoc increment (no reserve/refund)** — rejected: reopens the concurrent check-then-act race that lets >cap dispatch.
- **Epoch sentinel `1970-01-01`** — rejected: collides with the protobuf/unix-0 wire-default of an unset `as_of`; `1900-01-01` is provably distinct.
- **New `BacktestResult` field for the seed marker** — rejected: reusing `warnings` avoids the enum/field shared-consumer fan-out entirely.
- **Pure forward-accrual (no seed)** — rejected by user: loses immediate historical-backtest value (hybrid chosen).

## Open Risks

- [ ] **Single shared `fmp.Client` instance** — the budget counter lives on `fmp.Client`; the refresh
  job and the fundamentals serving path MUST consume the same instance or the budget splits into
  2×cap (`fails.md:1038` parallel-path trap). Assert one shared client + a test that both paths
  increment the same counter — at `/sdd-spec` / the FMP-gateway step.
- [ ] **`maybeAlertQuota` unit** — after the swap, read `BudgetSnapshot()` fresh post-fetch, not
  `count + len(fetched)` (rows), or the 80% WARNING double-counts — at the service-mapping step.
- [ ] **Boot-seed drift** — `CountFundamentalsFetchedToday` counts persisted rows (~symbols), the
  budget counts HTTP calls (extended ≈3:1; classification calls persist elsewhere). Accepted as a
  conservative floor; overrun self-heals (real exhaustion → 429 → refund → serve stale). An exact
  persisted call-counter is a v1 YAGNI-reject; config-rollout advisory: 250 calls ≈ ~83 symbols under
  extended, so a paid-tier operator should raise `daily_request_cap`.
- [ ] **Single-replica budget invariant** — the in-memory budget assumes one marketdata replica
  (`instance_count: 1` in `.do/app.yaml:121` + one-WS-per-Alpaca-account). Documented coupling; N
  replicas would need a shared store (named future work, not v1).
- [ ] **2xx-count precision** — commit on HTTP-200 received (independent of decode), refund on
  transport error + non-200; a 200-that-fails-to-decode slightly under-counts (symmetric to
  boot-seed drift, accepted).
- [ ] **`Sector` enum → UI exhaustive `Record` maps + agent parity** — must land in the same PR as
  the enum (C-10; `fails.md:81-82,1151`) — at the proto + consumer steps.

## Constitution Rules Touched

- `C-04` — honored: `Sector` is a closed enum with `SECTOR_UNSPECIFIED = 0`.
- `C-05` — honored: `marketdata.classification.enabled`/`.refresh_interval_hours`,
  `marketdata.fmp.rate_limit_rps` follow `<service>.<category>.<key>`; defaults declared in marketdata
  `CLAUDE.md`.
- `C-07` — honored: migration is next-free `007_symbol_classification.up.sql` + `.down.sql`.
- `C-08`/`P-06` — honored: each service step pairs a test step; RED-before-green (AC-7 mid-series
  look-ahead, AC-10..13 seed span).
- `C-09` — honored: `Sector` enum + classification RPCs + field 15 are additive; `buf lint`/`buf
  breaking` + `./scripts/buf-gen.sh` in the proto step.
- `C-10` — honored: `Sector` enum fans out to every UI exhaustive `Record` + agent parity test in the
  same PR; marker reuses `warnings` (no new fan-out).
- `C-14` — honored: agent (`manage_strategy`/`run_backtest`) + UI (StrategyWizard/ComponentEditor +
  `/insights`) surfaces each earn steps.
- `C-15` — honored: FR-1..FR-10 each covered by ≥1 `@AC-*`; AC-10..13 added for the seed span.
- `C-16` — see Business Rules Touched; the pre-go-live look-ahead is a user-signed-off relaxation of
  216's own FR-7, recorded in context.md.
- `C-18` — honored: one FMP throttle (no duplicate counters); K keyed on distinct dicts (no blow-up);
  reuse of the limiter/poller/repo/warnings patterns; the row→call cap-meaning change recorded as an
  explicit trade-off.
- `F-01` — honored: 007 is net-new, no applied migration edited.
- `F-06` — honored: `ClassificationRepo` reuses the marketdata pool; the per-symbol `FOR UPDATE` txn
  holds ≤1 pooled connection briefly; sequential sweep never runs >1 concurrent txn.
- `F-07` — honored: cap/rps/interval are config keys read via the Watcher; no hardcoded values.

## Business Rules Touched (C-16)

- PRESERVE `@AC-4/@AC-5 @feature-211` (`marketdata/edgar-fundamentals-enrichment.feature`) — PIT
  filing-boundary reads untouched; the sector as-of read applies the same discipline.
- PRESERVE `@AC-6/@AC-7 @feature-147` (`marketdata/config-secrets-and-scoping.feature`) — FMP
  credential still `GetSecret`-resolved; budget gates neither startup nor the credential.
- PRESERVE `@AC-1/@AC-2 @feature-153` (`marketdata/fix-ohlcv-chunk-lock-oom.feature`) — plain table +
  one batched `GetSectorHistory` per symbol keeps the chunk-lock budget intact.
- PRESERVE `@AC-3/@AC-4/@AC-10 @feature-151` (`analysis/backtest-next-bar-fill.feature`) — no-override
  path is byte-identical; the numeric fill/close values still use only data ≤ t.
- PRESERVE `@AC-1/@AC-2/@AC-3 @feature-149` (`analysis/fix-backtest-annualized-return.feature`) — metrics
  math untouched; per-sector params only change formula inputs.
- PRESERVE `@AC-2/@AC-3/@AC-5 @feature-152` (`analysis/market-regime-benchmark-operand.feature`) —
  component numeric value still uses only data ≤ t (only the *parameter-selection* input is seeded, not
  a data value); the default bucket is a fixed row, honoring the no-forward-fill prohibition; as-of
  resolution is deterministic (fixed `EPOCH_SENTINEL` + per-run snapshot).
- EXTEND `@AC-6 @feature-152` — `manage_strategy` normalizes the new field-15 override map and folds it
  into the definition fingerprint, as `source_symbol` does.
- EXTEND `@AC-1..@AC-6 @feature-149` (`agent/manage-strategy-accept-object-rules.feature`) — the new
  field rides the same update-mask discipline; rule serialization untouched.
- CHANGE (216's own FR-7, not a promoted external rule) — the epoch-seed applies the observed sector to
  pre-go-live bars = a bounded look-ahead in the **parameter-selection axis only**, for the
  `[EPOCH, first-change)` span. Signed off by user @ 2026-09-27 (context.md). It does not regress the
  feature-151/152 guarantees above (numeric values remain data-≤-t; no forward-fill). Promote AC-4 (+ a
  budget-refund scenario) into a new `services/xstockstrat-marketdata/acceptance/sector-classification.feature`.

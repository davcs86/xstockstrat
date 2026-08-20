# Design: order-snapshots-pnl-patterns

**Created**: 2026-08-19
**Rounds**: 5 (full; termination: approved at the cap — ACCEPT-WITH-RISKS, no Floor breach)
**Approved by**: user @ 2026-08-19
**Grounded in**: recon.md

---

## Chosen Approach

**Analysis-centric, ledger-event-driven. No new synchronous inter-service edge, no cycle, no new DB pool.**
Snapshots and pattern attribution are owned entirely by `xstockstrat-analysis`, driven off ledger events
that trading and portfolio **already** emit; portfolio contributes one small, durable enrichment.

### 1. Portfolio — durable per-position realized P&L (migration 010 + shared helper)
There is no point-in-time indicator RPC and `Order` has no `position_id`; the only durable, single-source
per-position realized P&L is portfolio's. Portfolio adds `realized_accum NUMERIC NOT NULL DEFAULT 0` to
`portfolio.positions` (**migration 010**, next free after `009`). To avoid a second P&L computation (the
056 C-10(b) fail), extract the direction-aware reduce math from `GetPnL`'s `applyFill` closure
(`portfolio_service.go:519-550`, verified a pure function of `(accQty, accCost, fillQty, fillPrice)`) into
one package-level `realizedDelta(...)`; **both** `GetPnL` and the live `ConsumeOrderFills` reducing branch
(`portfolio_service.go:272-275`) call it. Partial reduces persist the delta via `UpsertPosition`'s existing
upsert (`ON CONFLICT DO UPDATE SET realized_accum = portfolio.positions.realized_accum + $8`,
`portfolio_repo.go:55-63`, `$8` = next slot). On full close the row is DELETEd (`ClosePosition`,
`portfolio_repo.go:66-70`), so the cumulative (`existing.realized_accum + finalLegDelta`) goes into the
**emitted payload only** — never persisted onto a deleted row — guarded for `existing == nil` (a redelivered
post-close sell must not nil-deref). The enriched `portfolio.position.closed` payload grows from
`{user_id, symbol}` to `{user_id, symbol, account_id, trading_mode, realized_pnl}` (all in scope at
`:282-291`). While in this close path, **account-scope the `ClosePosition` DELETE** (`AND account_id=$4`;
edit the repo signature and the `:288` call-site) — feature 125 scoped only the read path; the unscoped
DELETE is the write-path twin and would otherwise corrupt a second account's `realized_accum`.

**Scope (named v1 limitation):** accumulation is exact for **long, order-fill-originated positions**. A
short opened via `account.positions.synced` and covered via a live `order.filled` buy takes the "buying
more" branch, so `realizedDelta` isn't invoked and its `realized_accum` understates; `GetPnL` still computes
the real figure. Accepted for v1 (attribution-only impact, see the invariant below); accumulating in
`ConsumePositionSyncs` is rejected — sync snaps to a broker snapshot with no per-leg price, reintroducing
the 056 dual-source path.

### 2. Analysis — migration 016 (four tables) + first ledger `StreamEvents` consumer
Analysis grows its first `StreamEvents` consumer as an asyncio boot task (mirror
`fundsignal_loop.run_forever`, `fundsignal_loop.py:82`; register in `main.py`). Migration **016**
(next free after `015`) adds:
- `order_snapshots` — Timescale hypertable on `event_ts`; PK `(id, event_ts)`; `UNIQUE (event_id, event_ts)`
  with `INSERT ... ON CONFLICT DO NOTHING`; `event_ts := LedgerEvent.recorded_at` (immutable server ts —
  byte-identical on redelivery so dedup matches; `occurred_at`/consumer `NOW()` would not). Columns mirror
  `006_backtest_runs.up.sql` + `ohlcv_bar`/`indicators`/`signals` JSONB.
- `pnl_positions` — the open→close window: partial `UNIQUE INDEX ... (user_id, account_id, symbol,
  trading_mode) WHERE closed_at IS NULL` (one open per identity key — account_id included); synthesized
  `position_id`; `ON CONFLICT DO NOTHING` on the open-insert; seal stamps `closed_at`/`realized_pnl`/
  `close_event_id`, deduped on `close_event_id`.
- `pnl_pattern_samples` — raw store, one row per (sealed position × factor): `(symbol, strategy_id,
  factor_name, factor_type, indicator_value NULLABLE, signal_present, realized_pnl, closed_at,
  close_event_id, position_id)`. No factor UNIQUE (dissolves the NULL-in-UNIQUE signal bug).
- `ledger_stream_cursor` — `(consumer PK, last_sequence BIGINT)`, single row.

**Consumer (single broad subscription, strict sequence order).** One `StreamEvents` from
`cursor.last_sequence` with **both filters null** — preserves the ledger's **global** sequence order
(`nextval('ledger.global_sequence')`, ledger invariant #4; the `ledger.proto:29` "per stream_key" comment
is stale and is fixed in-feature), which guarantees the closing `order.filled` snapshot is written before
`portfolio.position.closed` seals (portfolio emits the close only after consuming that fill). Per event:
(1) **short-circuit** if `event.sequence <= cursor.last_sequence` before any mutation (kills replay
phantom-opens); (2) skip analysis's own `analysis.*` emissions; (3) **compose the snapshot BEFORE opening
the DB transaction** (gRPC reads to indicators/ingest/marketdata reusing the screener composition
`_latest_indicator`/`_technical_value`/`QuerySignals`, `screener.py:301-388`, resolving indicators from the
order's `strategy_id`; best-effort try/except → partial snapshot on timeout, never abort — FR-6); (4) in ONE
DB transaction: insert `order_snapshots`, open/seal `pnl_positions`, write `pnl_pattern_samples` on seal,
and `UPDATE ledger_stream_cursor` — atomic, so a crash never advances the cursor past unwritten data. Emit
`analysis.snapshot.captured`/`analysis.pattern.sealed` best-effort after commit (FR-7). Empty-window close
(pre-deploy open) no-ops.

### 3. `QueryPnLPatterns` + UI
New additive analysis RPC (`QueryPnLPatterns`) + messages (`OrderSnapshot`, `PnLPatternFactor`, enums
`SnapshotEventType`/`FactorType` each `*_UNSPECIFIED=0`, C-04) — buckets the raw samples at **query time**
into `analysis.patterns.indicator_bucket_count` (default 5) quantile buckets, drops buckets below
`analysis.patterns.min_sample_count` (5), splits positive/negative by sign of `avg_pnl_impact`, ranks,
limits. Consumer surface (C-14): the `/insights` **P&L Patterns** view (mirror `insights/strategies` page +
a `useOpportunities`-style hook + a one-line `insightsBff` `queryPnLPatterns` forward) — **registered in
`NAV_GROUPS` (the real rendered nav source), the legacy `PLATFORM_SUBNAV`, AND the reachability spec
`GROUPS`** (C-10(a)), with a new e2e fixture + `INVENTORY.md` row (C-12).

**Load-bearing invariant:** the P&L Patterns view must **never** present a per-position realized-P&L a user
would reconcile against the trader dashboard. `realized_accum` is attribution-stats-only; `GetPnL` remains
the single user-facing realized figure. Violating this returns the 056 dual-source fail in durable form.

### Config
`analysis.snapshot.indicator_timeout_ms` (500), `analysis.snapshot.signal_timeout_ms` (500),
`analysis.patterns.min_sample_count` (5), `analysis.patterns.indicator_bucket_count` (5) — namespaced to
analysis (compose runs there), declared in `services/xstockstrat-analysis/CLAUDE.md`. This **replaces** the
product-spec's `analysis.patterns.pnl_bucket_size` and the two `trading.snapshot.*` keys; the product-spec
§ Config Key Changes is corrected in the same feature (new config key = owner + config-team governance gate).

## Rejected Alternatives

- Compose the snapshot in trading at order-time — rejected: trading dials neither indicators nor ingest (2 new edges), no `position_id`, and it would reimplement the screener composition in Go + risk a trading↔analysis cycle.
- Sync (portfolio→analysis) pattern-analysis trigger on close — rejected: portfolio→analysis is a new reverse edge inside the fill loop (cycle/blocking; 083 trap). Async via the existing `portfolio.position.closed` event is cheaper and cycle-free.
- Poll for newly-closed positions — rejected: no "list recently closed positions" RPC exists; the close is only observable via the ledger event.
- Analysis computes realized P&L itself from the fill stream — rejected on durability: fragile across the deploy boundary (needs full fill replay from open) and duplicates portfolio's avg-entry/realized accounting.
- Incremental per-bucket aggregation (`pnl_pattern_factors` running `sum_pnl`) — rejected: incompatible with data-dependent quantile boundaries and destroys raw samples; replaced by raw-sample store + query-time bucketing.
- Enriched close carrying only the final-leg realized_pnl — rejected: undercounts multi-leg exits; replaced by portfolio-cumulative `realized_accum`.
- A second P&L formula in the live path — rejected (056 C-10(b)); one shared `realizedDelta` helper instead.
- Accumulate realized in `ConsumePositionSyncs` (to cover shorts) — rejected: sync has no per-leg price → reintroduces a second P&L-derivation path.
- Time-based Timescale retention on `order_snapshots` — rejected: would drop a still-open long-held position's entry snapshots and break its seal.

## Open Risks

- [ ] **Attribution scope is long, order-fill-originated positions only**; live-fill-closed shorts understate `realized_accum` (named v1 limitation, user-neutralized by the attribution-only invariant) — the parity test asserts `realized_accum == GetPnL.realized` only for that scope — address at the portfolio test step.
- [ ] **Migration 016 may collide with in-flight feature 029** (also edits analysis schema/proto) — re-verify the migration NNN + new proto field numbers against ALL remote branches at `/sdd-spec` (ledger 081), not the local tree.
- [ ] **Snapshot completeness has no v1 backfill** — a lower-sequence event committing after a higher one for the same position can be missed; v1 = accept + a seal-time WARN diagnostic (`QueryEvents` count check). Name the v2 reconciliation (rebuild from ledger) as a concrete tracked follow-up (add-ikbr lesson) — address at the consumer step.
- [ ] **No v1 retention**; future snapshot retention MUST be position-lifecycle-keyed (drop only after seal) — record in analysis CLAUDE.md.
- [ ] **`existing == nil` guard** on the enriched full-close payload (redelivered post-close sell) — address at the portfolio step.
- [ ] **Real-GetPnL characterization pin** + collapse the byte-for-byte test mirror (`portfolio_helpers_test.go:106-166`) to call `realizedDelta` (no 3rd DRY copy) so the extraction is provably behavior-preserving — address at the portfolio test step.
- [ ] **`ClosePosition` account-scope** needs both the repo signature and the `:288` call-site edited (+ confirm no other caller) — address at the portfolio step.

## Constitution Rules Touched

- `C-01`/`P-03` — honored: every fork (compose location, P&L source, bucketing, position identity, multi-leg P&L) grounded against code and escalated to the user, not guessed; the short/sync-origin understatement is a NAMED limitation.
- `C-04` — honored: new enums carry `*_UNSPECIFIED = 0`; additive proto only (no breaking change).
- `C-05` — honored: config keys `<service>.<category>.<key>`, defaults in analysis CLAUDE.md; the `pnl_bucket_size`→`indicator_bucket_count` replacement corrected in the product-spec (governance gate).
- `C-07` / `F-01` — honored: analysis 016 + portfolio 010 are next-free; new migrations, no edit of an applied `.up.sql`; hypertable UNIQUE/PK include the `event_ts` partition column.
- `C-08` / `P-06` — honored: paired tests incl. the GetPnL characterization pin, the enriched-payload parity test (scoped), the consumer idempotency/ordering tests, and the nav-reachability test.
- `C-09` — honored: proto step runs `buf lint`/`buf breaking` + `./scripts/buf-gen.sh`.
- `C-10` / `C-10(a)` / `C-10(b)` — honored: nav triple-registration + reachability test; ONE realized-P&L implementation (shared `realizedDelta`) + the no-user-facing-per-position-P&L invariant; the enriched `portfolio.position.closed` payload keys documented in portfolio CLAUDE.md as a producer contract + a producer↔consumer parity test.
- `C-14` — honored: `/insights` P&L Patterns view named + reached (its own steps); no Agent surface.
- `F-04` — honored: all cited symbols/paths verified real (round-5 code check).
- `F-06` — honored: single shared analysis pool, compose-before-txn (no gRPC holding a pool slot), no new pool/edge/cycle.
- `F-07` — honored: all tunables read via `WatchConfig`; no hardcoded config values (bucket count is a config key).

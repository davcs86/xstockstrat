# Design: fix-book-portfolio-page

**Created**: 2026-10-18
**Rounds**: 4 (quick mode, extended by the operator; termination: approved)
**Approved by**: user @ 2026-10-18
**Grounded in**: recon.md

---

## Chosen Approach

The defect has two causes:
- marketdata's quote read has no time bound and runs over a `marketdata.quotes` hypertable that is never pruned;
- portfolio's quote enrichment has no deadline.

The fix closes both, with no proto change and no migration.

**Consumer surface (C-14).** `/trader/portfolio` (Book → Portfolio) loads because every portfolio read path now
answers within the portfolio deadline. The MCP tools `get_positions` and `get_positions_by_account_id` stop timing out
for the same reason. No UI or agent code changes.

### Marketdata (`xstockstrat-marketdata`)

#### 1. Bounded quote readers

Changes in `internal/repository/marketdata_repo.go`:
- The `db` field is retyped from `execer` to `classificationDB` (execer + Begin, `classification_repo.go:15-18`).
  `*pgxpool.Pool` and pgxmock already satisfy it.
- `GetLatestQuote` (`:280`) and `GetLatestQuotesBatch` (`:313`) move from `r.pool` to `r.db` and take a
  `since time.Time` cutoff.
- The singular reader becomes `WHERE symbol=$1 AND time >= $2 ORDER BY time DESC LIMIT 1`.
- The batch reader drops `DISTINCT ON` for the same shape, wrapped in a lateral join:
  `unnest($1::text[]) s(sym) CROSS JOIN LATERAL (SELECT … WHERE symbol = s.sym AND time >= $2 ORDER BY time DESC LIMIT 1)`.
  Because the two shapes match and `(symbol, time)` is the PK, batch == serial by construction.
- Both readers pass `pgx.QueryExecModeExec` per query. That sends an unnamed statement, so the server builds a custom
  plan with the cutoff constant-folded, and TimescaleDB excludes out-of-window chunks at **plan time**. This holds
  even on direct, non-PgBouncer connections (`pool.go:31-33`).
- `InsertQuote` (`:264`) stays on `r.pool`.

#### 2. Service changes (`internal/service/marketdata_service.go`)

**Resolvers.** `resolvePositiveInt(cfg intGetter, key, def)` returns `def` when `cfg` is nil or the value is `<= 0`.
- `resolveBatchPriceBudget` (`:877`) is rewritten on top of it and must stay byte-identical in behaviour.
- New resolvers: `resolveQuoteLookback` (168h), `resolveQuoteBatchBudget` (2500ms) and `resolveQuoteRetentionDays`
  (90, with no clamp).
- The `budgetCfg` comment (`:99-100`) is reworded to cover the new uses.

**Cutoff.** `since = now − lookback`, computed:
- once per call in `GetLatestQuote` (`:509`) and `GetLatestQuotes` (`:546`);
- once per cycle in the warm poller (`:951`, `:972`);
- once per message in `StartQuoteStream` (`:1339`).

**Test seam.** A `quoteStore` seam (`GetLatestQuotesBatch` + `InsertQuote`) is assigned only when `repo != nil`, the
same idiom as `prevClose` (`:199-205`). It replaces the `s.repo != nil` checks at `:544` and `:577`. The singular
`GetLatestQuote` stays on `s.repo`.

**Cache-age guard.** `cacheQuote(ctx, q, since) error` returns nil (skips the write) when:
- the seam is nil;
- `q` or `q.Time` is nil;
- `q.Time` is before `since`, which also catches the year-0001 time produced by the ignored parse errors at
  `alpaca/client.go:313` and `:501`.

The guard is used at all 5 insert sites (`:523`, `:582`, `:951`, `:972`, `:1339`). Each site keeps its own WARN, or
stays silent. The quote is still returned or fanned out to callers.

**Detached cold fetch.** The singleflight closure (`:561`) starts with
`fctx := context.WithTimeout(context.WithoutCancel(ctx), resolveQuoteBatchBudget(...))` and uses `fctx` at `:570` and
`:582`. This is the 227 shape at `:771-775`.

**Partial result.** A cold-fetch error no longer fails the batch:
- It logs WARN `"GetLatestQuotes: cold fetch failed"` with the cold count and the error.
- It returns the caller's own warm map, with cold symbols omitted and never zero-priced.
- This reverses feature 178's all-or-nothing waiver (`:589-594`; `178-quote-fanout-batching/context.md:35`).
- Every coalesced waiter gets the shared error, and each falls back to its own warm map.
- An all-cold failure returns `([], nil)`.
- A warm-read DB error (`:546-548`) still returns an error.

#### 3. Retention

**Repo method.** `DropQuoteChunksBefore(ctx, cutoff)` runs on `r.db` in one transaction:

```text
Begin (defer Rollback)
SET LOCAL lock_timeout = '2s'
SELECT min(range_start) FROM timescaledb_information.chunks
  WHERE hypertable_schema = 'marketdata' AND hypertable_name = 'quotes'
  (scan into *time.Time)
if NULL or oldest >= cutoff:
  Commit; return 0
boundary = min(oldest + 24h, cutoff)
SELECT count(*) FROM drop_chunks('marketdata.quotes', older_than => boundary)
Commit
```

Each run with expired data drops between 1 and about 24 chunks:
- Chunks don't overlap, so the oldest chunk ends at or before `oldest + 1h`, which is within `boundary`.
- If any chunk has fully expired, the oldest one has.
- The chunk that straddles the cutoff is never dropped.

**Service loop.** `StartQuoteRetention` runs on a fixed 1h ticker (first pass after 1h) and exits on `ctx.Done()`.
Each `runQuoteRetentionStep`:
- If `days*24 <= lookback_hours`, logs WARN `"quote retention skipped: retention within lookback window"` and returns
  (no clamp).
- Otherwise runs the drop under a 30s backstop timeout.
- WARNs on error and never panics; logs Info when it drops more than 0 chunks.

It is wired at `cmd/server/main.go:156-162`.

**Fixed invariants** (documented in marketdata CLAUDE.md, not config keys): 1h cadence, 1h first-pass delay,
`lock_timeout` 2s, a 24h step, a 30s backstop, and 1 PgBouncer slot held for up to 30s per hour.

### Portfolio (`xstockstrat-portfolio`)

#### 4. Repository

`GetAccountBalance` (`:444`), `ListAccountBalancesByUser` (`:504`), `ListOfflineAccountIdsByUser` (`:525`),
`ListPositionsByAccount` (`:559`/`:566`) and `InsertSnapshot` (`:205`) move to `r.db`. Production is unchanged
(`db: pool`); the move gives tests a pgxmock seam.

#### 5. Service

**Config.** The `watchlistConfig` interface is renamed `intConfig`.
- A new field `quoteCfg intConfig` is assigned only when `cfgWatcher != nil`.
- `quoteTimeout()` returns 4000ms for a nil config; otherwise it reads `GetInt("portfolio.marketdata.quote_timeout_ms",
  4000)`, and a value `<= 0` also gives 4000.

**Quote fetch.** `latestQuotesFor` (`:388`):
- wraps the call in `context.WithTimeout`;
- returns `(map, ok)`: `ok=false` only on an RPC error, and empty symbols give `(empty, true)`;
- keeps the WARN text at `:395`.

**Helpers** extracted from `enrichPositions` (`:404-431`):
- `unvaluedSymbols(ps)` returns the deduped symbols whose `CurrentPrice <= 0`;
- `applyQuotes(ps, q)` holds the existing skip, mid-price and WARN logic.

`enrichPositions` becomes: fetch with `latestQuotesFor`, then `applyQuotes`, then `enrichRisk`.

**ListPortfolios.** `buildAccountPortfolio` (`:1185`) now only assembles the portfolio.
- The all-accounts branch (`:1257-1287`) loads every account's positions, keeping the existing WARN-and-continue on
  failure.
- It then makes **one** `latestQuotesFor` call over the union of symbols, and runs `applyQuotes` and `enrichRisk`
  per account.
- Finally it builds the portfolios in the existing order.
- `balanceIDs` means "position load succeeded", the same as today.
- This gives one deadline, and one price per symbol across all accounts.

**broadcastSnapshot** (`:799`) skips persist, emit and broadcast (with a WARN) when either:
- `!ok`, or
- positions exist but none of them received a price.

Each case would otherwise be a fabricated zero-equity snapshot.

**GetPnL** (`:604-621`):

```text
q, ok := latestQuotesFor(unvaluedSymbols(ps))
if !ok: return wrapped ErrQuotesUnavailable
applyQuotes(ps, q)
if any position still has CurrentPrice <= 0: return ErrQuotesUnavailable wrapped with its symbol
unrealized = Σ (CurrentPrice − avg) · qty
```

- It returns before the ledger pass at `:632`, which is otherwise unchanged.
- `ErrQuotesUnavailable` is exported (precedent: `repository.ErrPositionNotFound`).
- Positions that already carry a broker price (`current_price`) are valued from it, without a quote fetch.

#### 6. Handler (`internal/handler/portfolio_handler.go`)

- `GetPnL` (`:95-96`) uses a new `classifyGetPnLError`, modelled on `classifyGetPositionError` at `:416-421`:
  `ErrQuotesUnavailable` maps to `CodeUnavailable`, anything else to `CodeInternal`.
- `toGRPCError` (`:423-436`) gains a `CodeUnavailable` case.
- No other portfolio handler emits Unavailable, so no other RPC's status code changes.

### Config (`xstockstrat-config`)

7. Four `SCALAR_BOUNDS_REGISTRY` rows go in `configServiceImpl.ts:100-134`:

| Key | Default | Bounds | Notes |
|---|---|---|---|
| `portfolio.marketdata.quote_timeout_ms` | 4000 | [500, 8000] | |
| `marketdata.quotes.latest_lookback_hours` | 168 | [24, 720] | |
| `marketdata.quotes.batch_timeout_ms` | 2500 | [500, 5000] | |
| `marketdata.retention.quotes_days` | 90 | [31, 3650] | Existing key, now implemented |

- The keys are unseeded, under the 227 D2 seeding waiver.
- **Timeout relationship:** the portfolio deadline (4000) exceeds the marketdata cold budget (2500) plus the warm-read
  margin, so a cold timeout still returns the warm subset.

### Lock math

| Operation | Relations per chunk | Locks | Notes |
|---|---|---|---|
| Read | ~4 (heap, PK, `quotes_time_idx`, `idx_quotes_symbol_time`) | ~672 at 168h; 2,880 at 720h | |
| Drop | ~6 (adds TOAST + its index) | ~144 per 24h step | |
| Today's unbounded read | | ~3,400 chunks per call | |

The lock budget is about 25,600. The staging backlog drains in about 55h after the first pass.

### Pre-merge staging gates (substitute proof — fails.md "unconfirmed root cause")

- **G1** — `EXPLAIN (ANALYZE, BUFFERS)` of both readers shows only in-window chunks. If it doesn't, fall back to
  inlining the cutoff as a literal.
- **G2** — `BEGIN; <batch read>; SELECT count(*) FROM pg_locks WHERE pid = pg_backend_pid(); ROLLBACK;` returns ≤ 700.
- **G3** — As the pooled marketdata role: `SHOW timescaledb.license`, a `show_chunks('marketdata.quotes',
  older_than => now() - interval '90 days')` dry run, and a check that `tableowner = current_user`.
- **G4** — DBA acknowledgement of automated, irreversible quote deletion, recorded in context.md before the retention
  step merges.

## Rejected Alternatives

- `DISTINCT ON` plus a time window — rejected because it bounds locks but still reads every in-window row per symbol
  (SkipScan is TSL-only, so not available on DO).
- An `add_retention_policy` migration — rejected because it is TSL-only, and DO runs the Apache edition (feature 040).
- Rolling old quotes up into bars — rejected because `marketdata.ohlcv` already holds authoritative, adjusted Alpaca
  bars. Mid-quote roll-ups would be a lower-fidelity second source (the feature-056 class).
- Dropping the 24 oldest chunks per step — rejected; the operator kept the 24h time step, and the cache guard removes
  the sparse-chunk pin that motivated it.
- A 31-day code clamp on retention — rejected; SetConfig bounds plus a skip-with-WARN guard are used instead, with no
  silent clamp.
- A separate deadline per account in ListPortfolios — rejected: N × deadline latency, and the same symbol could get
  inconsistent prices across accounts (C-10(b)).
- Reusing 227's `marketdata.price.batch_timeout_ms` — rejected; it is a different RPC whose ceiling is tied to the
  analysis budget, so keys stay independent.
- An inline literal cutoff as the primary design — rejected; it churns the statement cache. Kept only as the G1
  fallback.
- A one-shot first retention run — rejected; roughly 3,750+ locks in one call risks SQLSTATE 53200 (feature 153).
- Retention first pass at boot + 1 minute — rejected; it would contend with the old pod's unbounded readers during a
  rolling deploy.
- GetPnL returning `Internal` — rejected; it mislabels a transient dependency condition. GetPnL returns `Unavailable`.
- Leaving GetPnL's silent 0 — rejected; `unrealized_pnl` has no presence bit, so 0 would be a lie (operator decision).
- Keeping the all-or-nothing cold failure (the 178 waiver) — rejected; one failed or stale symbol would discard good
  warm quotes.
- Skipping a snapshot when any position is unpriced — rejected; one delisted holding would stop a user's snapshots
  forever. Only the all-unpriced case is skipped.
- Moving the snapshot guard into marketdata (erroring when the result is all-cold and empty) — rejected; it puts
  snapshot policy inside a shared RPC and contradicts the partial-result decision.

## Open Risks

- [ ] **GetPnL and ListPortfolios compute unrealized differently.** GetPnL uses `(CurrentPrice − avg)·qty`;
      ListPortfolios uses the stored broker `unrealized_pl`. This predates 229. Follow-up (C-10(b)), outside 229's
      steps.
- [ ] **One un-quotable holding blocks GetPnL.** A single un-quotable offline holding (for example a delisted symbol)
      makes that user's GetPnL permanently Unavailable. Accepted under the "never a silent 0" rule; documented in
      portfolio CLAUDE.md (step 7).
- [ ] **Stale held symbols go live on every read.** Symbols with no in-window quote are fetched live from Alpaca on
      every read. This is bounded by singleflight, the shared rate limiter and the 2500ms budget, and the cache guard
      means they never re-cache. Monitor post-deploy.
- [ ] **Plan-time exclusion might not happen.** If the planner falls back to runtime exclusion, every chunk is locked
      on every read. Covered by G1/G2 before merge, with the literal-cutoff fallback.
- [ ] **Retention bounds assume 1h chunks.** The ≤ 24-chunks-per-step bound and the ~55h drain both depend on the 1h
      chunk interval. Any future `set_chunk_time_interval` on quotes must revisit them; documented with the
      invariants (step 7).
- [ ] **Partial snapshot understatement.** When some positions are priced and others are omitted, the snapshot still
      understates equity. This is better than before 229 (which lost the warm prices too). Distinguishing a failed
      fetch from "no quote" would need a proto signal. Follow-up.
- [ ] **Other portfolio calls still have no deadline:** ledger `QueryEvents` (`:632`) and notify `EmitAlert` (`:892`).
      A related follow-up is sharing one quote fetch between `checkRiskLimits` and `broadcastSnapshot` per fill.
- [ ] **Staging gates G1–G4** are pending. They need DB access as the pooled role and a DBA acknowledgement, and are
      required before the readers and retention merge.

## Constitution Rules Touched

- `C-01` — honored by: every claim cites `path:line` from recon and three rounds of code verification.
- `C-02` — honored by: context.md is reloaded each session, and every decision is logged as it happens.
- `C-03` — honored by: `context.WithTimeout` keeps the propagation values in the context, and the client interceptor
  reads `FromContext`. Verified in round 1.
- `C-05` — honored by: four `<service>.<category>.<key>` keys, with defaults declared in the service CLAUDE.md files
  in step 7.
- `C-06` — honored by: the branch is based on `main-dev`.
- `C-07` — not triggered: there is no migration.
- `C-08` — honored by: every service step has a paired test (see design rounds 3-4 and the spec).
- `C-10` — honored by: one union batch and the shared `unvaluedSymbols`/`applyQuotes` helpers serve all read paths,
  and both quote readers share the same predicate.
- `C-13` — honored by: tests reuse the existing fakes (`stubMarketData`, `fakeMultiSource`, `fakeConfig`,
  `fakeIntGetter`).
- `C-14` — honored by: the Consumer Surface is named; no UI or agent change is needed.
- `C-15`/`C-16` — honored by: @AC-1 to @AC-8, and the business rules listed below.
- `C-18` — honored by: the YAGNI fixed invariants, a single valuation rule, the generalised resolver (DRY), and the
  `intConfig` rename.
- `P-03`/`P-04` — honored by: each operator decision is recorded at each gate (rounds 1-4).
- `F-04` — honored by: no invented paths; pgxmock and exec-mode behaviour will be verified in step 2's RED run.
- `F-06` — honored by: no pool change; retention borrows 1 existing pooled connection for up to 30s per hour.
- `F-07` — honored by: tunables are config keys. The retention operational constants are operator-approved,
  documented fixed invariants (the 215 precedent).
- `F-01`/`F-02`/`F-03`/`F-05`/`F-08`/`F-09`/`F-10` — honored at execution: no applied migration is edited, all
  changes go through a PR, and the step discipline is followed.

## Business Rules Touched (C-16)

- PRESERVE `@AC-1 @feature-178` "Position enrichment uses one batched quote call"
  (`services/xstockstrat-portfolio/acceptance/quote-fanout-batching.feature`). Not regressed: each read still makes
  one call, and ListPortfolios goes from N calls to 1. Batch == serial holds because both readers use the same
  predicate and shape.
- PRESERVE `@AC-4 @feature-178` "A symbol with no quote maps to the same missing outcome under batching". Not
  regressed: a timeout, an out-of-window symbol and a cold failure all take the existing skip, and nothing is ever
  zero-priced.
- PRESERVE `@AC-7`, `@AC-12`, `@AC-14 @feature-157`
  (`services/xstockstrat-portfolio/acceptance/offline-account-portfolios.feature`). Not regressed: the shared helpers
  keep parity, short positions are never priced at 0, and broker-valued positions are skipped.
- PRESERVE `@AC-12 @feature-163` (`snapshot-offline-positions.feature`). Not regressed: provenance is untouched.
- EXTEND `@AC-3 @feature-178` "Concurrent cold-symbol requests coalesce to one Alpaca fetch"
  (`services/xstockstrat-marketdata/acceptance/quote-fanout-batching.feature`). New cases: the first caller cancels
  but other waiters still get the result (229 @AC-3); a cold failure returns the warm subset (229 @AC-8, reversing
  178's recorded *waiver*, which was not a promoted @AC — operator sign-off 2026-10-18 in context.md).
- PRESERVE `@AC-3 @feature-227` (`fix-opportunities-read-hangs.feature`). Not regressed: `resolveBatchPriceBudget`
  stays byte-identical, and `TestResolveBatchPriceBudget` is unchanged.
- EXTEND `@AC-8 @feature-182` (`services/xstockstrat-config/acceptance/readiness-materializer-config-keys.feature`).
  New case: the four new bounds rows.
- PRESERVE the shared-registry rules: `@AC-9 @feature-182`, `@AC-4`/`@AC-8 @feature-184`, `@AC-11`/`@AC-12
  @feature-161`.
- PRESERVE the UI offline-card rules `@AC-3`/`@AC-13 @feature-157` and `@AC-2`/`@AC-3`/`@AC-4 @feature-159`. Not
  regressed: unenriched values still render, and nothing is fabricated.
- PRESERVE `@AC-5 @feature-210` (`docs/sdd/business-rules/platform.feature`). Not regressed: the header trio
  survives the deadline context.

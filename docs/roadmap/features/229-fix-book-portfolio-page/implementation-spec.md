# Implementation Spec: fix-book-portfolio-page

**Status**: `in-progress`
**Created**: 2026-10-18
**Feature**: `docs/roadmap/features/229-fix-book-portfolio-page/feature.md`
**Total Steps**: 11
**Feature Branch**: `ccr-9f55a8ac-dtw4iv` (the harness-assigned **Development Branch** in `feature.md`; it replaces
`feature/fix-book-portfolio-page`, see `context.md` 2026-10-16 /sdd-triage)

> **Evidence baseline.** Every `path:line` below is cited against **`origin/main-dev` @ `a8a3cfd`**. That is the
> merge-base of the development branch, which adds only docs commits on top of it, so no service file differs.
> Feature 227 is already merged at this baseline, so its `BatchGetLatestPrice` budget, `intGetter`/`budgetCfg` seam
> and the `TIMEOUT_KEY_FORMS` table exist. Feature 215 (`in-progress`) edits other functions of
> `marketdata_service.go` (rebase-only overlap). Re-grep a symbol if `main-dev` moves before execution.

---

## Execution Summary

Follow design.md § Chosen Approach, inside-out, so every bound exists before something relies on it:
1. **config bounds** (Steps 1–2). All four keys are write-bounded before any reader exists.
2. **marketdata repo** (Steps 3–4). The two quote readers get the `since` window, the LATERAL `LIMIT 1` shape and
   per-query Exec mode; `DropQuoteChunksBefore` is added. All quote SQL moves onto the pgxmock seam.
3. **marketdata quote service** (Steps 5–6). Resolvers, the `quoteStore` seam, the cache-age guard at all 5 insert
   sites, the detached cold-fetch budget and the partial result.
4. **marketdata retention** (Steps 7–8). The `StartQuoteRetention` loop and its wiring in `main.go`.
5. **portfolio** (Steps 9–10). Repo reads move to `r.db`; the deadline, the `(map, ok)` return, the shared helpers,
   the ListPortfolios union batch, the snapshot guard, GetPnL `Unavailable` and the handler mapping.
6. **docs and teardown** (Step 11).

Every `service` step is paired with the `test` step after it (C-08). The executor proves each test RED before
writing the service code (P-06, `.claude/skills/sdd-execute/reference/tdd-gate.md`). New signatures make a first
RED structural (compile failure); as in feature 227 Step 4, get a behavioural RED by landing the seam types and
signatures first, with the old behaviour, then confirm the new assertions fail. Every stall-injection test runs the
call in a goroutine behind a 5s `select` hang guard, so a RED run fails instead of hanging.

**Consumer surface (C-14).** The product spec names `/trader/portfolio` and the MCP tools `get_positions` /
`get_positions_by_account_id`. Neither needs a code change (design.md § Chosen Approach, "No UI or agent code
changes"), because both reach the fixed RPCs:
- the UI hooks call `portfolioClient.getPortfolio` / `listPortfolios` / `listPositions`
  (`services/xstockstrat-ui/src/hooks/usePortfolio.ts:13,25,50`, `useAccountPortfolios.ts:14`);
- the agent `get_positions` tool calls `PortfolioService.ListPositions` (`services/xstockstrat-agent/app/client.py:2354-2369`).

So the surface is reached by the portfolio deadline itself (Step 9), proven for ListPositions and ListPortfolios by
@AC-1 (Step 10). The product spec's dev smoke test of Book → Portfolio and MCP `get_positions` is an operator check
after the dev deploy, recorded in `context.md` at the integration PR. It is not a step.

**Spec-level choices not spelled out in design.md** (flagged for `/sdd-review impl-spec`):
- Retention gets its own one-method seam `quoteRetention` (Step 7), assigned only when `repo != nil`, the same idiom
  as `prevClose` (`marketdata_service.go:203-205`). The design's `quoteStore` seam covers only the read/insert pair,
  and the retention step must be unit-testable without a database.
- `runQuoteRetentionStep` takes `now time.Time` so the test pins the cutoff (fails.md 2026-10-14
  "fix-historical-fundamentals-price-join": inject a clock for `now`-relative windows).
- pgxmock v4.9.0 does not strip `pgx.QueryExecModeExec`: `argsMatches` compares it as an ordinary positional
  argument (`pgxmock/v4@v4.9.0/expectations.go:139-172`, only a `pgx.QueryRewriter` is special-cased). Repo tests
  therefore expect it as argument 0. This settles design.md's F-04 note ("pgxmock and exec-mode behaviour will be
  verified in step 2's RED run").

### Scenario Coverage (C-15)

| Scenario | Covered by | Proof kind |
|---|---|---|
| `@AC-1` Portfolio reads return unenriched positions when the quote fetch exceeds its deadline (ListPositions, ListPortfolios) | Step 10 | behavioural (pgxmock repo + ctx-honouring stub) |
| `@AC-2` The cached batch read ignores rows outside the recency window | Step 6 (service, behavioural), Step 4 (SQL shape) | behavioural + SQL shape |
| `@AC-3` Coalesced quote waiters are not failed by the first caller's cancellation | Step 6 | behavioural |
| `@AC-4` Quote history older than the retention period is pruned | Step 4 (drop boundary, SQL shape), Step 8 (cutoff + skip guard) | SQL shape only; the live proof is staging gate **G3** |
| `@AC-5` GetPnL refuses to report unrealized P&L when a needed quote is unavailable | Step 10 | behavioural (service `errors.Is`) + handler mapping tables |
| `@AC-6` GetPnL values broker-synced positions from the broker price | Step 10 | behavioural |
| `@AC-7` An out-of-window live quote is returned but not cached | Step 6 | behavioural |
| `@AC-8` A cold-fetch failure returns the warm subset | Step 6 | behavioural |

pgxmock never runs Postgres, so chunk exclusion and `drop_chunks` semantics are proven by SQL shape only
(insights.md 2026-10-14 "config-ui-usability": say which proof is shape-only). Staging gates G1–G3 are the live proof.

## Step Dependencies

- **C-08 pairing:** Step 2 covers Step 1. Step 4 covers Step 3. Step 6 covers Step 5. Step 8 covers Step 7.
  Step 10 covers Step 9.
- Steps 3–10 require Step 1: every new key is write-bounded before a reader exists.
- Step 5 requires Step 3: it calls the new `GetLatestQuote(ctx, symbol, since)` / `GetLatestQuotesBatch(ctx,
  symbols, since)` signatures.
- Step 7 requires Step 3 (`DropQuoteChunksBefore`) and Step 5 (`resolvePositiveInt`, `resolveQuoteLookback`).
  The recency predicate (Step 3) ships before the retention loop (Step 7), so the unbounded readers never contend
  with the drops (product-spec review warning, `context.md` 2026-10-16 round 2).
- Step 9 has no code dependency on Steps 3–8. It goes after them because the timeout relationship (portfolio 4000ms
  > marketdata cold budget 2500ms + warm read) is only meaningful once Step 5's budget exists.
- Step 11 requires Steps 1–10: the docs describe the shipped keys and behaviour. Run the context-forge teardown last.
- **Operator merge gates (design.md § Pre-merge staging gates).** The session has no DB access, so the operator runs
  these and records the results in `context.md`:
  - **G1 + G2** must be recorded before Step 3's PR merges. Step 3 gives the exact query text.
  - **G3 + G4** must be recorded before Step 7's PR merges.
  - If G1 fails, the fallback is to inline the cutoff as a literal. That is a Deviation Log entry and needs operator
    sign-off.
- **C-16 promotion** happens at the integration PR (the `/sdd-execute` integration step), not in any step here:
  - @AC-1, @AC-5, @AC-6 → `services/xstockstrat-portfolio/acceptance/`;
  - @AC-2, @AC-3, @AC-4, @AC-7, @AC-8 → `services/xstockstrat-marketdata/acceptance/`;
  - the EXTEND of `@AC-3 @feature-178` (`services/xstockstrat-marketdata/acceptance/quote-fanout-batching.feature`)
    and of `@AC-8 @feature-182` (`services/xstockstrat-config/acceptance/readiness-materializer-config-keys.feature`)
    as design.md § Business Rules Touched lists them.
- **Defect sidecar.** `docs/reports/2026-10-16-portfolio-page-stuck-loading-defect.status` (`triaged`) flips to
  `resolved` at the integration PR, after the dev smoke test. Not in any step.
- **Open risks from design.md**, and where each is handled:
  - one un-quotable holding blocks GetPnL → documented in Step 11;
  - retention bounds assume 1h chunks → documented with the invariants in Step 11;
  - plan-time exclusion → G1/G2 (above);
  - GetPnL↔ListPortfolios unrealized parity, partial snapshot understatement, portfolio's other no-deadline calls
    (ledger `QueryEvents`, notify `EmitAlert`), one shared quote fetch per fill → follow-ups, no step;
  - live Alpaca load from stale held symbols → monitor after deploy, no step.

---

### Step 1 — service: Write-bound the four quote keys in `SCALAR_BOUNDS_REGISTRY`

**Status**: `done`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/grpc/configServiceImpl.ts` — modify

**Reviewers**: xstockstrat-config owner — config key naming (`<service>.<category>.<key>`), environment/global-per-user scoping, secret encryption + redaction, WatchConfig stream stability

**Codebase Evidence**:
- `SCALAR_BOUNDS_REGISTRY` is at `configServiceImpl.ts:100-134`, keyed on the full config key path. The feature-227
  block is `:128-133`; its last entry is `'agent.opportunities.read_timeout_seconds': { minValue: 30, maxValue: 55 }`
  (:133), and `};` closes the object at :134.
- `lookupScalarBounds(namespace, key)` (`:139-140`) probes `SCALAR_BOUNDS_REGISTRY[key] ??
  SCALAR_BOUNDS_REGISTRY[\`${namespace}.${key}\`]`, so a full-dotted entry resolves for both key-column forms.
- Enforcement runs at `:420` (SetConfig) and `:531` (the batch path).
- grep for `quote_timeout_ms`, `latest_lookback_hours`, `quotes.batch_timeout_ms` and `quotes_days` in
  `services/xstockstrat-config/src/` → no match. None of the four keys is bounded today.

**TDD**: `red-green required`

**Covers**: —

**Instructions** (design.md §7):
1. After `'agent.opportunities.read_timeout_seconds'` (:133), append exactly these full-dotted entries:
   - `'portfolio.marketdata.quote_timeout_ms': { minValue: 500, maxValue: 8000 }`
   - `'marketdata.quotes.latest_lookback_hours': { minValue: 24, maxValue: 720 }`
   - `'marketdata.quotes.batch_timeout_ms': { minValue: 500, maxValue: 5000 }`
   - `'marketdata.retention.quotes_days': { minValue: 31, maxValue: 3650 }`
2. Add a comment of at most 2 lines above them, stating the constraints: the 31-day retention floor stays above the
   720h lookback ceiling, and the portfolio default (4000) exceeds the marketdata cold budget (2500) plus the warm
   read (feature 229).
3. Do not seed, and add no migration (the 227 D2 seeding waiver, design.md §7).
4. Do not change `lookupScalarBounds`.

**Verification**:
```bash
grep -n "quote_timeout_ms\|latest_lookback_hours\|quotes.batch_timeout_ms\|retention.quotes_days" services/xstockstrat-config/src/grpc/configServiceImpl.ts
cd services/xstockstrat-config && pnpm run lint
```
(Behavioural proof is Step 2.)

---

### Step 2 — test: Bounds tests for the four keys, both key-column forms

**Status**: `done`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/__tests__/setConfigScalarBounds.test.ts` — modify

**Reviewers**: xstockstrat-config owner — config key naming (`<service>.<category>.<key>`), environment/global-per-user scoping, secret encryption + redaction, WatchConfig stream stability

**Codebase Evidence**:
- `TIMEOUT_KEY_FORMS` (`setConfigScalarBounds.test.ts:259-268`) lists `{ ns, key, field, min, max }` rows. The loop at
  `:270-288` asserts that min and max reach `insertQuery()`, and that min−1 and max+1 are rejected with
  `grpc.status.INVALID_ARGUMENT`, a `[min, max]` message and no INSERT.
- `setConfig(value, key = KEY, namespace = NS)` (`:72`) already takes a namespace.

**TDD**: `red-green required`

**Covers**: — (no `@AC-*` targets the config service; this is the EXTEND of `@AC-8 @feature-182`)

**Instructions**:
1. Append eight rows to `TIMEOUT_KEY_FORMS`, the stripped and the full-dotted form of each key, all `field: 'intVal'`:
   - ns `portfolio`: `marketdata.quote_timeout_ms` and `portfolio.marketdata.quote_timeout_ms`, `[500, 8000]`;
   - ns `marketdata`: `quotes.latest_lookback_hours` and `marketdata.quotes.latest_lookback_hours`, `[24, 720]`;
   - ns `marketdata`: `quotes.batch_timeout_ms` and `marketdata.quotes.batch_timeout_ms`, `[500, 5000]`;
   - ns `marketdata`: `retention.quotes_days` and `marketdata.retention.quotes_days`, `[31, 3650]`.
2. Update the comment above the table (`:257-258`) to name feature 229 as well, in at most 2 lines.
3. The existing loop generates the accept and reject cases. Add no new `it` block.
4. C-13 verdict: the key strings are scenario constants used only by this file (one consumer), so they stay inline.

**Verification**:
```bash
cd services/xstockstrat-config && pnpm run test:coverage && pnpm run lint
```
Confirm the c8 `--lines 40` threshold passes and every new case is green. RED before Step 1: the out-of-range writes
reach the INSERT, so the `INVALID_ARGUMENT` assertions fail.

---

### Step 3 — service: marketdata repo — bounded quote readers and `DropQuoteChunksBefore`

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/repository/marketdata_repo.go` — modify

**Reviewers**: xstockstrat-marketdata owner — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence**:
- `MarketDataRepo{ pool *pgxpool.Pool; db execer }` (`marketdata_repo.go:30-35`). `execer` (Exec/QueryRow/Query) is at
  `:22-27`. `NewMarketDataRepo` sets `db: pool` (:46).
- `classificationDB` = `execer` + `Begin(ctx) (pgx.Tx, error)` (`classification_repo.go:15-18`). Its transaction
  precedent is `classification_repo.go:122-153` (`r.db.Begin`, `defer tx.Rollback(ctx) //nolint:errcheck`,
  `tx.Commit`).
- `InsertQuote` (`:264`) runs `r.pool.Exec` (:276). It stays on `r.pool` (design.md §1).
- `GetLatestQuote` (`:280`): `WHERE symbol=$1 ORDER BY time DESC LIMIT 1` via `r.pool.QueryRow` (:287). No time
  predicate.
- `GetLatestQuotesBatch` (`:313`): `SELECT DISTINCT ON (symbol) … WHERE symbol = ANY($1) ORDER BY symbol, time DESC`
  via `r.pool.Query` (:323). No time predicate. Its doc comment `:309-312` describes the `DISTINCT ON` shape.
- Schema: `marketdata.quotes` with `PRIMARY KEY (symbol, time)`, `chunk_time_interval => INTERVAL '1 hour'` and
  `idx_quotes_symbol_time (symbol, time DESC)` (`migrations/001_marketdata_hypertables.up.sql:37-57`).
- `pool.go:31-33` sets `DefaultQueryExecMode = pgx.QueryExecModeExec` only under `DB_PGBOUNCER`. A per-query
  `pgx.QueryExecModeExec` first argument forces Exec mode on direct connections too (design.md §1).
- grep `drop_chunks\|show_chunks\|timescaledb_information` over `services/` → no match (recon.md § Not found).
- Test literals build `&MarketDataRepo{db: mock}` with `pgxmock.NewPool()` (`marketdata_repo_test.go:124,156`).
  pgxmock's pool implements `Begin`, so the retype compiles (design round 2, `context.md` 2026-10-17).

**TDD**: `red-green required`

**Covers**: —

**Instructions** (design.md §1, §3):
1. Retype the `db` field (`:34`) from `execer` to `classificationDB`. Reword its comment (`:32-33`) to cover the quote
   SQL and retention as well, in at most 2 lines. `NewMarketDataRepo` keeps `db: pool`.
2. `GetLatestQuote(ctx, symbol string, since time.Time)`:
   - SQL `… FROM marketdata.quotes WHERE symbol=$1 AND time >= $2 ORDER BY time DESC LIMIT 1`;
   - call `r.db.QueryRow(ctx, sql, pgx.QueryExecModeExec, symbol, since)`.
3. `GetLatestQuotesBatch(ctx, symbols []string, since time.Time)`:
   - drop `DISTINCT ON`. Use
     `SELECT q.time, q.symbol, q.ask_price, q.ask_size, q.bid_price, q.bid_size, q.source
     FROM unnest($1::text[]) AS s(sym)
     CROSS JOIN LATERAL (SELECT time, symbol, ask_price, ask_size, bid_price, bid_size, source
     FROM marketdata.quotes WHERE symbol = s.sym AND time >= $2 ORDER BY time DESC LIMIT 1) q`;
   - call `r.db.Query(ctx, sql, pgx.QueryExecModeExec, symbols, since)`;
   - keep the empty-input early return, the scan loop and the null-not-zero map unchanged;
   - rewrite the doc comment (`:309-312`) in at most 2 lines: the shape matches the singular reader (so batch ==
     serial), and the `since` bound lets TimescaleDB exclude out-of-window chunks at plan time.
4. Add `DropQuoteChunksBefore(ctx context.Context, cutoff time.Time) (int64, error)`, exactly design.md §3:
   1. `tx, err := r.db.Begin(ctx)`, then `defer tx.Rollback(ctx) //nolint:errcheck`;
   2. `tx.Exec(ctx, "SET LOCAL lock_timeout = '2s'")`;
   3. `SELECT min(range_start) FROM timescaledb_information.chunks WHERE hypertable_schema = 'marketdata' AND
      hypertable_name = 'quotes'`, scanned into a `*time.Time`;
   4. if that is nil, or `!oldest.Before(cutoff)`: `tx.Commit(ctx)` and return `0, nil`;
   5. `boundary := oldest.Add(24 * time.Hour)`; if `boundary.After(cutoff)` then `boundary = cutoff`;
   6. `SELECT count(*) FROM drop_chunks('marketdata.quotes', older_than => $1::timestamptz)` with `boundary`, scanned
      into an `int64`. The `::timestamptz` cast is needed because `older_than` is the polymorphic `"any"`;
   7. `tx.Commit(ctx)` and return the count.

   Wrap each error with `fmt.Errorf("drop quote chunks: …: %w", err)`. The `2s` and `24h` literals are the
   operator-approved fixed invariants (design.md §3, F-07 per the 215 precedent). Name them as package `const`s
   (`quoteRetentionLockTimeout`, `quoteRetentionStep`) next to the method.
5. Header propagation: no outbound gRPC call. N/A.
6. **G1 + G2 hand-off.** Before this step's PR merges, the operator runs the following on staging, as the pooled
   marketdata role, and records the result in `context.md` (`$1` = two held symbols, `$2` = `now() - interval '168 hours'`):
   - **G1:** `EXPLAIN (ANALYZE, BUFFERS)` of both readers shows only in-window chunks.
   - **G2:** `BEGIN; <batch read>; SELECT count(*) FROM pg_locks WHERE pid = pg_backend_pid(); ROLLBACK;` gives ≤ 700.

**Verification**:
```bash
cd services/xstockstrat-marketdata && GOWORK=off go build ./internal/repository/...
cd services/xstockstrat-marketdata && GOWORK=off golangci-lint run --modules-download-mode=mod ./internal/repository/...
grep -n "QueryExecModeExec\|CROSS JOIN LATERAL\|time >= \$2\|drop_chunks\|classificationDB" services/xstockstrat-marketdata/internal/repository/marketdata_repo.go
```
Verification is package-scoped (impl-spec review F-05 finding). The full module does not compile until Step 5
updates the service callers (`marketdata_service.go:509,546`), and that intermediate state is recorded, not silent.
The module build goes green at Step 5, whose Verification runs `go build ./...`.

---

### Step 4 — test: marketdata repo SQL-shape tests (AC-2, AC-4)

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/repository/marketdata_repo_test.go` — modify

**Reviewers**: xstockstrat-marketdata owner — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence**:
- pgxmock test pattern: `TestGetPreviousDailyClose` (`marketdata_repo_test.go:150-178`) builds `pgxmock.NewPool()`,
  `repo := &MarketDataRepo{db: mock}`, then `ExpectQuery(…).WithArgs(…).WillReturnRows(pgxmock.NewRows(…))` and
  `mock.ExpectationsWereMet()`.
- Transaction expectation order: `ExpectBegin` → … → `ExpectCommit` → `ExpectRollback`
  (`classification_repo_test.go:28-37`); the trailing `ExpectRollback` absorbs the deferred `tx.Rollback`.
- pgxmock matches `pgx.QueryExecModeExec` as a plain positional argument (`pgxmock/v4@v4.9.0/expectations.go:139-172`).
- grep `GetLatestQuote\|DropQuoteChunks` in `marketdata_repo_test.go` → no match (recon.md: "quote SQL unit tests"
  not found).

**TDD**: `red-green required`

**Covers**: `AC-2` (SQL shape), `AC-4` (drop boundary, SQL shape)

**Instructions**:
0. RED discipline (P-06): add the new signatures with the old SQL first (Step 3 skeleton), then confirm the shape and
   argument assertions below fail.
1. `TestGetLatestQuotesBatch_BoundedLateralShape` — **AC-2 shape**:
   - `since := time.Now().Add(-168 * time.Hour)`;
   - `ExpectQuery` with a regex built from `regexp.QuoteMeta` fragments that requires `CROSS JOIN LATERAL`,
     `time >= $2` and `LIMIT 1`;
   - `.WithArgs(pgx.QueryExecModeExec, []string{"AAPL", "MSFT"}, since)`, returning one AAPL row;
   - assert the map holds AAPL only (MSFT is absent, not zero), and that the expectations are met;
   - assert the SQL constant does not contain `DISTINCT ON`. Use a `strings.Contains` check on the expectation
     mismatch or a negative regex; the executor picks the form pgxmock supports.
2. `TestGetLatestQuote_BoundedBySince`: requires `time >= $2` and `LIMIT 1`, with
   `.WithArgs(pgx.QueryExecModeExec, "AAPL", since)`.
3. `TestDropQuoteChunksBefore`, a table over a fixed `cutoff := time.Date(2026, 10, 18, 0, 0, 0, 0, time.UTC)`. Each
   case expects `Begin`, `Exec("SET LOCAL lock_timeout = '2s'")` and `Query(min(range_start) … hypertable_name =
   'quotes')`, then:
   - **backlog**: oldest = cutoff − 10 days → `drop_chunks` with `.WithArgs(oldest.Add(24*time.Hour))` (it pins the
     **boundary**, not the cutoff; `context.md` 2026-10-17 minor fix), returns count 24, Commit, Rollback; the
     method returns 24;
   - **AC-4 literal**: oldest = cutoff − 24h (the "91 days old" chunk when cutoff = now − 90d) → the boundary clamps
     to `cutoff` (`.WithArgs(cutoff)`), count 1. Today's chunk (range_start ≥ cutoff) cannot satisfy
     `older_than => cutoff`, by construction;
   - **empty**: a NULL min → no `drop_chunks` expectation, Commit, Rollback, returns 0;
   - **clamp**: oldest = cutoff − 6h → oldest + 24h is past the cutoff, so the boundary clamps to
     `.WithArgs(cutoff)` (impl-spec review P-06: proves the `boundary.After(cutoff)` branch, which the AC-4 literal
     case does not exercise);
   - **nothing expired**: oldest = cutoff + 1h → no drop, returns 0;
   - **drop error**: `drop_chunks` returns an error → no Commit, `ExpectRollback`, a wrapped error is returned.
4. In the test comment (≤2 lines), state that the proof is SQL shape only and that the live proof is staging gate G3.
5. C-13 verdict: the AAPL/MSFT rows and the cutoff are scenario one-offs in this file (one consumer). They stay
   inline; no `internal/testdata/` home is created.

**Verification**:
```bash
cd services/xstockstrat-marketdata && GOWORK=off go test ./internal/repository/... -race -count=1 -run 'TestGetLatestQuote|TestDropQuoteChunksBefore' -v
cd services/xstockstrat-marketdata && GOWORK=off golangci-lint run --modules-download-mode=mod ./internal/repository/...
```
No coverage threshold applies here: `internal/repository/` is excluded from CI coverage (ci.yml:256). The
module-wide coverage gate (≥ 40%) runs in Step 6.
The new logic is in `internal/repository/`, which is excluded from CI coverage measurement, so no threshold applies
to it. The full-module coverage command runs in Step 6, once the service callers compile.

---

### Step 5 — service: marketdata quote path — window, cache-age guard, detached budget, partial result

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/service/marketdata_service.go` — modify

**Reviewers**: xstockstrat-marketdata owner — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence**:
- Struct fields: `quoteSingleflight singleflight.Group` (:59); `budgetCfg intGetter` / `prevClose prevCloseReader`
  (:101-102), with their comment at :99-100. `type intGetter` is at :105-108 (its comment names only
  BatchGetLatestPrice); `type prevCloseReader` at :110-113.
- `NewMarketDataService` (:154): `if cfgWatcher != nil { svc.budgetCfg = cfgWatcher }`, `if repo != nil {
  svc.prevClose = repo }` (:199-205). The comment at :199 explains the typed-nil interface trap.
- `GetLatestQuote` (:505): `s.repo.GetLatestQuote(ctx, symbol)` (:509); live fallback `src.GetLatestQuote` (:519);
  `s.repo.InsertQuote(ctx, live)` with WARN `"GetLatestQuote: cache insert failed"` (:523-525).
- `GetLatestQuotes` (:534). Doc comment :528-533 ("read in one DISTINCT ON query"). `if s.repo != nil { warm, err =
  s.repo.GetLatestQuotesBatch(ctx, symbols) … return nil, err }` (:544-550). Cold set and sorted key (:551-560).
  `s.quoteSingleflight.Do(key, …)` (:561); `ms.GetLatestQuotesMulti(ctx, sortedCold)` on the **caller's** ctx
  (:570); `if s.repo != nil { … s.repo.InsertQuote(ctx, q) … WARN "GetLatestQuotes: cache insert failed" }`
  (:577-586). The waived all-or-nothing `if fetchErr != nil { return nil, fetchErr }` is at :588-594.
- The 227 detached shape: `budget := resolveBatchPriceBudget(s.budgetCfg)`, `fctx, cancel :=
  context.WithTimeout(context.WithoutCancel(ctx), budget)` (:773-774).
- `resolveBatchPriceBudget` (:877-886): nil cfg → 2500ms; `GetInt("marketdata.price.batch_timeout_ms", 2500)`;
  `≤ 0` → 2500ms.
- Warm poller (`StartWarmQuotePoller` :913) insert sites: `s.repo.InsertQuote(ctx, q)` at :951 (multi path, WARN
  `"warm poller: cache insert failed"`) and :972 (per-symbol path, same WARN). The cycle body starts after the pause
  check `continue // paused via config` (:926-929).
- `StartQuoteStream` (:1326): `_ = s.repo.InsertQuote(ctx, q)` (:1339), silent.
- Alpaca parse sites ignore errors: `t, _ := time.Parse(time.RFC3339, q.T)` (`internal/alpaca/client.go:313`,
  `:501`), giving the year-0001 time the guard must reject. The Alpaca client builds requests with
  `http.NewRequestWithContext(ctx, …)` (`client.go:291,334`), so `fctx` really bounds the cold fetch.
- `livePrice` (:1642) calls `s.GetLatestQuotes` and already treats `len(quotes) == 0` as missing (:1644), so the
  `([], nil)` all-cold failure stays null-not-zero for it.
- Go 1.27 (`go.mod:3`): `context.WithoutCancel` is available.
- Trading-domain check (step-constraints §A): this touches only Alpaca **market-data** quote reads. Broker routing,
  order types, fill state and `TRADING_MODE` are unaffected.

**TDD**: `red-green required`

**Covers**: —

**Instructions** (design.md §2):
1. **Resolvers.** Add `func resolvePositiveInt(cfg intGetter, key string, def int64) int64`: it returns `def` when
   `cfg == nil` or the value is `≤ 0`, and the value otherwise. Rewrite `resolveBatchPriceBudget` (:877) as
   `time.Duration(resolvePositiveInt(cfg, "marketdata.price.batch_timeout_ms", 2500)) * time.Millisecond`. Its
   behaviour must stay byte-identical, and `TestResolveBatchPriceBudget` stays unchanged (`@AC-3 @feature-227`).
   Add:
   - `resolveQuoteLookback(cfg) time.Duration` = hours of `marketdata.quotes.latest_lookback_hours`, default 168;
   - `resolveQuoteBatchBudget(cfg) time.Duration` = ms of `marketdata.quotes.batch_timeout_ms`, default 2500;
   - `resolveQuoteRetentionDays(cfg) int64` = `marketdata.retention.quotes_days`, default 90, no clamp.
2. Reword the `budgetCfg` comment (:99-100) and the `intGetter` comment (:105) so they cover the quote window, the
   quote budget and retention. At most 2 lines each.
3. **Seam.** Add
   `type quoteStore interface { GetLatestQuotesBatch(ctx context.Context, symbols []string, since time.Time)
   (map[string]*marketdatav1.Quote, error); InsertQuote(ctx context.Context, q *marketdatav1.Quote) error }`
   and a field `quoteStore quoteStore`. Assign it in `NewMarketDataService` inside the existing `if repo != nil`
   block (:203-205).
4. **Cache-age guard.** Add `func (s *MarketDataService) cacheQuote(ctx context.Context, q *marketdatav1.Quote, since
   time.Time) error`. It returns nil without writing when `s.quoteStore == nil`, `q == nil`, `q.Time == nil`, or
   `q.Time.AsTime().Before(since)`. The last case also rejects year 0001. Otherwise it returns
   `s.quoteStore.InsertQuote(ctx, q)`.
5. **Cutoff `since = time.Now().Add(-resolveQuoteLookback(s.budgetCfg))`**, computed:
   - once per call in `GetLatestQuote` (:505) and `GetLatestQuotes` (:534);
   - once per warm-poller cycle, after the pause check (:926-929);
   - once per message in `StartQuoteStream` (:1338-1339).
6. **Use the guard at all 5 insert sites**, keeping each site's own logging:
   - `:523` → `if err := s.cacheQuote(ctx, live, since); err != nil { slog.Warn("GetLatestQuote: cache insert
     failed", …) }`;
   - `:582` → the closure's insert loop calls `s.cacheQuote(fctx, q, since)` with the same WARN, and the
     `if s.repo != nil` wrapper (:577) goes;
   - `:951` and `:972` → `s.cacheQuote(ctx, q, since)` with the existing warm-poller WARN;
   - `:1339` → `_ = s.cacheQuote(ctx, q, since)` (stays silent).

   The quote is still returned or fanned out to callers in every case.
7. `GetLatestQuote` (:509) → `s.repo.GetLatestQuote(ctx, symbol, since)`. The singular path stays on `s.repo`.
8. `GetLatestQuotes` warm read (:544-550) → `if s.quoteStore != nil { warm, err = s.quoteStore.GetLatestQuotesBatch(ctx,
   symbols, since) … }`. A warm-read DB error still returns `nil, err`.
9. **Detached cold fetch.** The first lines of the singleflight closure (:561) are
   `fctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), resolveQuoteBatchBudget(s.budgetCfg))` and
   `defer cancel()`. Use `fctx` for `GetLatestQuotesMulti` (:570) and `cacheQuote` (:582). The singleflight key and
   the `!ok` (non-multi source) branch are unchanged.
10. **Partial result.** Replace :588-594 with: on `fetchErr != nil`, `slog.Warn("GetLatestQuotes: cold fetch failed",
    "cold", len(cold), "error", fetchErr)`, skip the merge, and fall through to return the caller's own `warm` map.
    Cold symbols are omitted and never zero-priced; an all-cold failure returns an empty slice and a nil error.
    Delete the WAIVED comment, which this reverses (operator sign-off 2026-10-18, `context.md`).
11. Rewrite the `GetLatestQuotes` doc comment (:528-533) in at most 2 lines: warm hits come from one windowed read, a
    cold failure omits those symbols, and the result is never zero-filled.
12. Header propagation: no new outbound gRPC call; Alpaca calls are HTTP. N/A.

**Verification**:
```bash
cd services/xstockstrat-marketdata && GOWORK=off go build ./... && GOWORK=off go vet ./...
cd services/xstockstrat-marketdata && GOWORK=off golangci-lint run --modules-download-mode=mod
grep -n "WithoutCancel\|cacheQuote(\|resolvePositiveInt\|GetLatestQuotes: cold fetch failed" services/xstockstrat-marketdata/internal/service/marketdata_service.go
```
Confirm `grep -c "s.repo.InsertQuote" internal/service/marketdata_service.go` → 0 (all 5 sites use `cacheQuote`).
The guard's behaviour is unit-tested in Step 6 on the `GetLatestQuotes` cold path and in the `cacheQuote` table. The
other 4 sites (`:523` singular, `:951`/`:972` warm poller, `:1339` stream) are proven only by this grep plus the
shared helper. `s.cfg *Watcher` is concrete, which blocks a direct poller test (accepted; impl-spec review).

---

### Step 6 — test: marketdata quote path (AC-2, AC-3, AC-7, AC-8, resolvers)

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/service/marketdata_service_test.go` — modify

**Reviewers**: xstockstrat-marketdata owner — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence**:
- `fakeMultiSource` (`marketdata_service_test.go:991-1039`) has `calls`, `quotes`, `started`, `release`. Its
  `GetLatestQuotesMulti` (:999) ignores ctx and records no symbols. Today's tests
  `TestGetLatestQuotes_SingleFlightCoalescesColdFetch` (:1043) and `_OmitsMissingSymbol` (:1089) build
  `&MarketDataService{registry: reg, warmSymbols: …}` (nil repo, so everything is cold) and must stay green.
- Helpers: `recordingWarnHandler` + `find(msg)` (:1533-1571), `installWarnRecorder(t)` (:1573; process-global
  `slog.SetDefault`, so no `t.Parallel()`), `fakeIntGetter` (:1582), `callBatchPriceGuarded`'s 5s guard shape
  (:1610-1638), `TestResolveBatchPriceBudget` (:1824).
- `internal/testdata/` does not exist (`ls` → absent).

**TDD**: `red-green required`

**Covers**: `AC-2`, `AC-3`, `AC-7`, `AC-8`

**Instructions**:
0. RED discipline (P-06): land Step 5's seam types, fields and resolvers first, with the old behaviour (caller ctx,
   no guard, all-or-nothing). Confirm the assertions below fail. Then apply Step 5's behaviour.
1. Extend `fakeMultiSource` with:
   - `requested [][]string` (append a copy of `symbols` under `mu`);
   - `err error` (returned after the release/ctx wait);
   - `honourCtx bool`: when set, the wait is `select { case <-f.release: case <-ctx.Done(): return nil, ctx.Err() }`,
     and a nil `release` with `honourCtx` blocks until ctx is done.

   Existing call sites leave the new fields zero, so behaviour is unchanged.
2. Add `fakeQuoteStore` with `rows map[string]*marketdatav1.Quote`, `inserts []*marketdatav1.Quote` and `gotSince
   time.Time` (all under a mutex). Its `GetLatestQuotesBatch` returns only rows whose `Time.AsTime()` is not before
   `since`, mirroring Step 3's `time >= $2`. Add a `guardedGetLatestQuotes(t, svc, ctx, symbols)` helper with the 5s
   goroutine/select guard (the `callBatchPriceGuarded` shape) that returns `(map[string]*Quote, error, elapsed)`.
3. **AC-2.** Set lookback 168 via `svc.budgetCfg = fakeIntGetter{"marketdata.quotes.latest_lookback_hours": 168}`.
   The store has AAPL at `time.Now().Add(-2*time.Hour)` and MSFT at `time.Now().Add(-200*time.Hour)`. Assert:
   - AAPL is served from the store;
   - `fake.requested == [["MSFT"]]` (AAPL is not live-fetched);
   - `gotSince` is within 1s of `time.Now().Add(-168*time.Hour)`.

   Times derive from `time.Now()` (fails.md 2026-10-14: derive `now`-relative dates).
4. **AC-3.** Both AAPL and MSFT are cold (nil store), with `honourCtx` and `started`/`release` set.
   - Caller 1 runs with a cancellable ctx. Wait on `<-fake.started`.
   - Caller 2 runs with `context.Background()`. Sleep 25ms so it parks in `Do` (the :1070 pattern).
   - `cancel()` caller 1, sleep 25ms, then `close(release)`.
   - Assert caller 2 gets **both** quotes and `fake.calls == 1`.

   RED: on the caller ctx, the fake returns `ctx.Err()`, so caller 2 receives the shared error (pre-fix) or an empty
   result.
5. **AC-7**, table `{"200h old", time.Now().Add(-200*time.Hour)}` and `{"zero time", time.Time{}}`:
   - the store is empty, and the fake serves `HALT` with `Time: timestamppb.New(tc.t)`;
   - assert the HALT quote is returned and `store.inserts` is empty.

   Add a positive control: a cold quote one minute old **is** inserted, so the guard is not over-broad. Add a direct
   `cacheQuote` sub-case for `q.Time == nil` and for a nil `quoteStore` (both return nil and write nothing).
6. **AC-8**, table `{"error", fake.err = errors.New("alpaca 503")}` and `{"no answer", honourCtx with nil release}`:
   - budget 500 via `fakeIntGetter{"marketdata.quotes.batch_timeout_ms": 500}`;
   - the store has AAPL at 2h old, and MSFT is cold;
   - assert a nil error, AAPL present, and MSFT absent (`len == 1`);
   - assert `rec.find("GetLatestQuotes: cold fetch failed")` is non-nil, with attr `cold == "1"` and a non-empty
     `error`;
   - for "no answer", assert `elapsed < 1500ms`.
7. **Resolvers.** Table-test `resolveQuoteLookback` (nil → 168h; 0 / −1 → 168h; 24 → 24h),
   `resolveQuoteBatchBudget` (nil → 2500ms; 0 → 2500ms; 500 → 500ms) and `resolveQuoteRetentionDays` (nil → 90;
   0 → 90; 31 → 31; 7 → 7, no clamp). Leave `TestResolveBatchPriceBudget` unchanged.
8. C-13 verdict: `fakeQuoteStore` and the AAPL/MSFT/HALT quotes are consumed only by this test file (one
   consumer), so they stay inline. No `internal/testdata/` home is created.

**Verification**:
```bash
cd services/xstockstrat-marketdata && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && GOWORK=off go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"
cd services/xstockstrat-marketdata && GOWORK=off golangci-lint run --modules-download-mode=mod
```
Confirm total ≥ 40%. The new logic is in `internal/service/`, which is excluded from CI coverage measurement, so no
threshold applies to it. The `-race` behavioural tests are the gate, and `./...` also compiles `cmd/` (fails.md
2026-10-14 "edgar-fundamentals-enrichment").

---

### Step 7 — service: marketdata quote retention loop and wiring

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/service/marketdata_service.go` — modify
- `services/xstockstrat-marketdata/cmd/server/main.go` — modify

**Reviewers**: xstockstrat-marketdata owner — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence**:
- Loop shape: `StartWarmQuotePoller` (:913) is `ticker := time.NewTicker(…)`, `defer ticker.Stop()`, then `for {
  select { case <-ctx.Done(): return; case <-ticker.C: … } }`.
- `cmd/server/main.go`: root `ctx, cancel := context.WithCancel(context.Background())` (:38); `go
  svc.StartWarmQuotePoller(ctx)` (:156), `StartBarIngestPoller` (:158), `StartClassificationRefreshPoller` (:160),
  `StartEtfFlagFiller` (:162); `cancel()` on signal (:196).
- `prevClose` seam assignment idiom: `if repo != nil { svc.prevClose = repo }` (:203-205).
- grep `quotes_days` in `services/xstockstrat-marketdata/internal` → no match. Today the key is read by no code
  (`docs/context-constitution-findings.md:21`).
- `DropQuoteChunksBefore(ctx, cutoff) (int64, error)` is added in Step 3. `resolveQuoteRetentionDays` and
  `resolveQuoteLookback` are added in Step 5.

**TDD**: `red-green required`

**Covers**: —

**Instructions** (design.md §3 "Service loop"):
1. Add `type quoteRetention interface { DropQuoteChunksBefore(ctx context.Context, cutoff time.Time) (int64, error) }`
   and a field `retention quoteRetention`. Assign it inside the existing `if repo != nil` block in
   `NewMarketDataService` (:203-205). This is the spec-level seam choice in § Execution Summary.
2. Add the package consts `quoteRetentionInterval = time.Hour` and `quoteRetentionBackstop = 30 * time.Second`. They
   are the documented fixed invariants (design.md §3, F-07 per the 215 precedent; doc lands in Step 11).
3. Add `func (s *MarketDataService) runQuoteRetentionStep(ctx context.Context, now time.Time)`:
   - `days := resolveQuoteRetentionDays(s.budgetCfg)`;
   - `lookbackH := int64(resolveQuoteLookback(s.budgetCfg) / time.Hour)`;
   - if `days*24 <= lookbackH`: `slog.Warn("quote retention skipped: retention within lookback window",
     "retention_days", days, "lookback_hours", lookbackH)` and return (no clamp);
   - if `s.retention == nil`: return;
   - `dctx, cancel := context.WithTimeout(ctx, quoteRetentionBackstop)`, then `defer cancel()`;
   - `n, err := s.retention.DropQuoteChunksBefore(dctx, now.Add(-time.Duration(days)*24*time.Hour))`;
   - on error: `slog.Warn("quote retention failed", "retention_days", days, "error", err)` and return. Never panic;
   - if `n > 0`: `slog.Info("quote retention dropped chunks", "chunks", n, "retention_days", days)`.
4. Add `func (s *MarketDataService) StartQuoteRetention(ctx context.Context)`: a `time.NewTicker(quoteRetentionInterval)`,
   whose first pass comes after 1h (no immediate run, design.md § Rejected "boot + 1 minute"). Each tick calls
   `s.runQuoteRetentionStep(ctx, time.Now())`, and the loop returns on `ctx.Done()`.
5. `cmd/server/main.go`: add `go svc.StartQuoteRetention(ctx)` after `go svc.StartEtfFlagFiller(ctx)` (:162), with a
   blank line, matching the neighbours.
6. Header propagation: no outbound gRPC call. N/A.
7. **G3 + G4 hand-off.** Before this step's PR merges, the operator records in `context.md`:
   - **G3**, run as the pooled marketdata role: `SHOW timescaledb.license`; `SELECT show_chunks('marketdata.quotes',
     older_than => now() - interval '90 days')` (dry run); and `tableowner = current_user` for `marketdata.quotes`;
   - **G4**: the DBA's acknowledgement of automated, irreversible quote deletion.

**Verification**:
```bash
cd services/xstockstrat-marketdata && GOWORK=off go build ./... && GOWORK=off go vet ./...
cd services/xstockstrat-marketdata && GOWORK=off golangci-lint run --modules-download-mode=mod
grep -n "StartQuoteRetention" services/xstockstrat-marketdata/cmd/server/main.go services/xstockstrat-marketdata/internal/service/marketdata_service.go
```

---

### Step 8 — test: marketdata retention step (AC-4)

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/service/marketdata_service_test.go` — modify

**Reviewers**: xstockstrat-marketdata owner — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence**:
- `installWarnRecorder` / `recordingWarnHandler.find` (`marketdata_service_test.go:1533-1580`) and `fakeIntGetter`
  (:1582) are reused.
- Service-literal construction: `&MarketDataService{registry: reg, warmSymbols: …}` (:1052).

**TDD**: `red-green required`

**Covers**: `AC-4` (cutoff and guard; the drop boundary is Step 4)

**Instructions**:
0. RED discipline (P-06): land the `quoteRetention` type, the field and an empty `runQuoteRetentionStep` first, then
   confirm the assertions fail.
1. Add `fakeRetention` recording `cutoff time.Time`, `calls int` and `hadDeadline bool` / `deadline time.Time` (from
   `ctx.Deadline()`), with injectable `n int64` and `err error`.
2. **AC-4 cutoff.** With `now := time.Date(2026, 10, 18, 12, 0, 0, 0, time.UTC)`, `fakeIntGetter{"marketdata.retention.quotes_days":
   90, "marketdata.quotes.latest_lookback_hours": 168}` and `n = 1`, assert:
   - `calls == 1`;
   - `cutoff == now.Add(-90*24*time.Hour)`, so a chunk entirely older than 91 days lies before the cutoff and
     today's does not;
   - `hadDeadline`, with the deadline ≤ 30s from the call.
3. **Skip guard**, table `{days 7, lookback 168}` and `{days 7, lookback 200}` (`days*24 <= lookback`): assert
   `calls == 0` and that `rec.find("quote retention skipped: retention within lookback window")` is non-nil. Add a
   boundary row `{days 8, lookback 168}` → `calls == 1`.
4. **Defaults**: a nil `budgetCfg` → the cutoff is `now − 90d` (90×24 = 2160 > 168).
5. **Error**: `err = errors.New("permission denied for hypertable")` → `rec.find("quote retention failed")` is
   non-nil and there is no panic.
6. **Nil seam**: `svc.retention == nil` → no panic and no WARN.
7. `StartQuoteRetention` has a fixed 1h ticker, so the loop is not driven in unit tests. Its exit on `ctx.Done()`
   follows the reviewed `StartWarmQuotePoller` shape; record that verdict in the test comment (≤2 lines).
8. C-13 verdict: `fakeRetention` has one consumer and stays inline.

**Verification**:
```bash
cd services/xstockstrat-marketdata && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && GOWORK=off go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"
cd services/xstockstrat-marketdata && GOWORK=off golangci-lint run --modules-download-mode=mod
```
Confirm total ≥ 40%. The new logic is in an excluded package (`internal/service/`), so no coverage threshold
applies to it.

---

### Step 9 — service: portfolio quote deadline, shared valuation helpers, union batch, snapshot guard, GetPnL Unavailable

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/repository/portfolio_repo.go` — modify
- `services/xstockstrat-portfolio/internal/service/portfolio_service.go` — modify
- `services/xstockstrat-portfolio/internal/handler/portfolio_handler.go` — modify
- `services/xstockstrat-portfolio/internal/service/watchlist_service_test.go` — modify (the `watchlistConfig` →
  `intConfig` rename in `newSvc`, :270, so the package compiles)

**Reviewers**: xstockstrat-portfolio owner — P&L calculation accuracy, position snapshot consistency, concurrent write safety

**Codebase Evidence**:
- **Repo** (`portfolio_repo.go`). The `db queryRower` seam (:21-25, :32) and `NewPortfolioRepoWithDB(db)` (:48)
  exist. These still use `r.pool`:
  - `InsertSnapshot` :205;
  - `GetAccountBalance` :444;
  - `ListAccountBalancesByUser` :504;
  - `ListOfflineAccountIdsByUser` :525;
  - `ListPositionsByAccount` :559 and :566.

  `ListPositions` (:173) and `GetOfflineRealized` (:474) are already on `r.db`.
- **Service** (`portfolio_service.go`):
  - Fields: `cfg *config.Watcher` (:39), `marketdata` (:42), `wlCfg watchlistConfig` (:47). `NewPortfolioService`
    sets `wlCfg: cfgWatcher` (:147). `type watchlistConfig interface { GetInt(…) int64 }` is at :1374-1377.
  - `latestQuotesFor` (:384-402) calls `s.marketdata.GetLatestQuotes(ctx, …)` on the inbound ctx. On error it logs
    `slog.Warn("batch latest quotes unavailable", "count", …, "error", err)` (:395) and returns an empty map.
  - `enrichPositions` (:404-432) has the `CurrentPrice > 0` skip, the mid price, the `"latest quote has no usable
    price"` WARN (:425), `enrichPosition` (:514) and `enrichRisk` (:435).
  - `enrichPositions` callers: `GetPortfolio` :544, `GetPosition` :574, `ListPositions` :595 and
    `buildAccountPortfolio` :1191.
  - `GetPnL` (:604-621) fetches quotes for **all** symbols (:611-615), sums `(mid − AvgEntryPrice)·Qty` (:616-621)
    and silently skips a missing quote. The ledger pass starts at :632.
  - `broadcastSnapshot` (:789-826): `latestQuotesFor` over all symbols (:799), `InsertSnapshot` (:813), `emitEvent`
    (:814) and the subscriber fan-out (:818-825).
  - `checkRiskLimits` (:846) calls `latestQuotesFor` at :860.
  - `buildAccountPortfolio` (:1185-1222) loads positions (:1186) and enriches them (:1191). In `ListPortfolios`
    (:1226-1289), the single-account branch is :1232-1255; the all-accounts loop is :1257-1271 (`balanceIDs` is
    appended only on success, :1269); the offline branch is :1273-1287 (`offlineIDsToAppend` :1293).
  - The nil-guard precedent is `enrichRisk` `if s.cfg != nil` (:438). The sentinel-error precedent is
    `repository.ErrPositionNotFound` (`portfolio_repo.go:246`).
- **Handler** (`portfolio_handler.go`):
  - `GetPnL` (:89-99) wraps every service error as `connect.CodeInternal` (:95-96);
  - `classifyGetPositionError` (:414-421) is the model for the new classifier;
  - `toGRPCError` (:423-436) has no `CodeUnavailable` case;
  - the handler already imports `internal/service` (:17).
- **Header propagation (C-03):** `context.WithTimeout` keeps ctx values. The marketdata client is dialled with
  `grpc.WithChainUnaryInterceptor(middleware.UnaryClientInterceptor)` (:125), and that interceptor reads
  `FromContext(ctx)` (`internal/middleware/propagation.go:39-40`). No new outbound call is added.
- `GetPnL` has no caller in ui, agent or trading (grep-verified in design round 2, `context.md` 2026-10-17).
- Trading-domain check (§A): no order placement, order type, fill state or broker routing changes. Fill handling is
  unaffected (`processOrderFill` :253 only reaches `checkRiskLimits`/`broadcastSnapshot`, whose quote fetch changes
  only in signature and the snapshot guard).

**TDD**: `red-green required`

**Covers**: —

**Instructions** (design.md §4-§6):
1. **Repo.** Switch `r.pool` → `r.db` at :205, :444, :504, :525, :559 and :566. Production is unchanged (`db: pool`,
   :44).
2. **Config seam.** Rename `watchlistConfig` → `intConfig` (:1374-1377, the field at :47, and `newSvc` at
   `watchlist_service_test.go:270`). Add a field `quoteCfg intConfig` and assign it in `NewPortfolioService` only
   when `cfgWatcher != nil` (typed-nil trap). Add `func (s *PortfolioService) quoteTimeout() time.Duration`: nil
   `quoteCfg` → 4000ms; otherwise `GetInt("portfolio.marketdata.quote_timeout_ms", 4000)`, where `≤ 0` → 4000ms.
3. **`latestQuotesFor(ctx, symbols) (map[string]*marketdatav1.Quote, bool)`.** Empty symbols → `(empty, true)` with no
   RPC. Otherwise `qctx, cancel := context.WithTimeout(ctx, s.quoteTimeout())`, `defer cancel()`, and call
   `GetLatestQuotes(qctx, …)`. On error keep the WARN text at :395 and return `(empty, false)`. On success return
   `(map, true)`. Update the doc comment (:384-387) in at most 2 lines.
4. **Helpers.** Extract from `enrichPositions`:
   - `func unvaluedSymbols(ps []*portfoliov1.Position) []string` — the deduped symbols with `CurrentPrice <= 0`, in
     first-seen order;
   - `func applyQuotes(ps []*portfoliov1.Position, q map[string]*marketdatav1.Quote)` — the existing skip, mid-price,
     `"latest quote has no usable price"` WARN and `enrichPosition` logic, unchanged.

   `enrichPositions` becomes `q, _ := s.latestQuotesFor(ctx, unvaluedSymbols(ps)); applyQuotes(ps, q);
   s.enrichRisk(ctx, ps)`.
5. **ListPortfolios / buildAccountPortfolio.**
   - `buildAccountPortfolio(ctx, accountID string, positions []*portfoliov1.Position, bal *repository.AccountBalance)
     *portfoliov1.Portfolio` only assembles. It drops the load and enrich at :1186-1191 and keeps `GetOfflineRealized`.
   - Single-account branch (:1248): load with `ListPositionsByAccount(ctx, accountID, "")` (an error returns `nil,
     err` as today), then `enrichPositions`, then build.
   - All-accounts branch: first load every balance account's positions, keeping the WARN-and-continue at :1266-1269
     (`balanceIDs` = position load succeeded). Then load each `offlineIDsToAppend(balanceIDs, offlineIDs)` account,
     keeping the WARN-and-continue at :1281-1284 and the list-offline WARN at :1277. Then make **one**
     `latestQuotesFor(ctx, unvaluedSymbols(<all loaded positions>))`, run `applyQuotes` and `enrichRisk` per
     account, and build the portfolios in the existing order (balance accounts, then offline).
6. **broadcastSnapshot** (:799-826). Keep the full-set symbol fetch. `q, ok := s.latestQuotesFor(…)`. Count `priced`
   = positions whose symbol is in `q`. If `!ok`, or `len(positions) > 0 && priced == 0`: `slog.Warn("portfolio
   snapshot skipped: quotes unavailable", "user_id", userID, "positions", len(positions), "quotes_ok", ok)` and
   return before `InsertSnapshot`, `emitEvent` and the fan-out. An empty position list still writes its zero-equity
   snapshot as today.
7. **checkRiskLimits** (:860): `riskQuotes, _ := s.latestQuotesFor(…)`. Behaviour is unchanged (design.md Open Risks:
   sharing one fetch per fill is a follow-up).
8. **GetPnL** (:604-621):
   - add `var ErrQuotesUnavailable = errors.New("quotes unavailable")` with a doc comment of at most 2 lines (the
     handler maps it to `Unavailable`);
   - replace :608-621 with: `q, ok := s.latestQuotesFor(ctx, unvaluedSymbols(positions))`;
   - `if !ok`, return `nil, fmt.Errorf("GetPnL: %w", ErrQuotesUnavailable)`;
   - `applyQuotes(positions, q)`;
   - for each position with `CurrentPrice <= 0`, return `nil, fmt.Errorf("GetPnL: no usable quote for %s: %w",
     p.Symbol, ErrQuotesUnavailable)`;
   - `unrealized += (p.CurrentPrice − p.AvgEntryPrice) * p.Qty`.

   This returns before the ledger pass (:632), which is unchanged.
9. **Handler.**
   - Add `func classifyGetPnLError(err error) connect.Code`: `errors.Is(err, service.ErrQuotesUnavailable)` →
     `connect.CodeUnavailable`, else `connect.CodeInternal`. Put a doc comment of at most 2 lines next to
     `classifyGetPositionError` (:414).
   - `GetPnL` (:95-96) → `connect.NewError(classifyGetPnLError(err), err)`.
   - `toGRPCError` gains `case connect.CodeUnavailable: return status.Error(codes.Unavailable, connectErr.Message())`.
     No other handler emits `CodeUnavailable`, so no other RPC's status changes (design.md §6).

**Verification**:
```bash
cd services/xstockstrat-portfolio && GOWORK=off go build ./... && GOWORK=off go vet ./...
cd services/xstockstrat-portfolio && GOWORK=off golangci-lint run --modules-download-mode=mod
grep -n "r\.pool\." services/xstockstrat-portfolio/internal/repository/portfolio_repo.go
grep -n "WithTimeout\|ErrQuotesUnavailable\|unvaluedSymbols\|applyQuotes\|quoteTimeout" services/xstockstrat-portfolio/internal/service/portfolio_service.go
grep -n "classifyGetPnLError\|codes.Unavailable" services/xstockstrat-portfolio/internal/handler/portfolio_handler.go
```
The `r.pool.` grep must list none of :205, :444, :504, :525, :559 or :566.

---

### Step 10 — test: portfolio deadline, GetPnL, snapshot guard, union batch, handler mapping (AC-1, AC-5, AC-6)

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/portfolio_quote_deadline_test.go` — create
- `services/xstockstrat-portfolio/internal/service/portfolio_service_test.go` — modify (`stubMarketData` gains ctx
  honouring and symbol recording)
- `services/xstockstrat-portfolio/internal/service/portfolio_fill_errors_test.go` — modify (extract the
  `positionRow` column slice)
- `services/xstockstrat-portfolio/internal/service/watchlist_service_test.go` — modify (`fakeLedger.QueryEvents`)
- `services/xstockstrat-portfolio/internal/handler/portfolio_handler_test.go` — modify

**Reviewers**: xstockstrat-portfolio owner — P&L calculation accuracy, position snapshot consistency, concurrent write safety

**Codebase Evidence**:
- `stubMarketData` (`portfolio_service_test.go:18-37`) embeds the client interface. It has `getLatestQuotesCalls`,
  `quotes` and `quotesErr`, and its `GetLatestQuotes` ignores ctx. Its feature-178 tests (:42, :73, :97) call
  `enrichPositions` on `&PortfolioService{marketdata: stub}` (nil cfg) and must stay green.
- `positionRow(mock, qty)` (`portfolio_fill_errors_test.go:43-50`) has an inline 17-column list and hard-codes AAPL;
  `anyArgs(n)` is at :35-41.
- `fakeLedger` (`watchlist_service_test.go:254-266`) implements only `AppendEvent` (it counts `calls`). GetPnL's
  ledger pass calls `QueryEvents` (`portfolio_service.go:632`), which would hit the nil embedded interface.
- `ctxWithUser(t, userID)` (`watchlist_service_test.go:275-286`) injects `x-user-id` through the real interceptor.
- pgxmock service-test precedent: `newFillSvc` (`portfolio_fill_errors_test.go:52-62`) uses
  `repository.NewPortfolioRepoWithDB(mock)`.
- Handler test precedent: the `TestClassifyGetPositionError_*` cases (`portfolio_handler_test.go:13-34`).
- grep `slog.SetDefault` in `services/xstockstrat-portfolio/internal` → no match. There is no WARN recorder in
  portfolio tests yet.

**TDD**: `red-green required`

**Covers**: `AC-1`, `AC-5`, `AC-6`

**Instructions**:
0. RED discipline (P-06): land Step 9's signatures first (`(map, bool)`, the helper stubs, `quoteCfg`,
   `ErrQuotesUnavailable`, `classifyGetPnLError` returning Internal) with the old behaviour, then confirm the
   assertions below fail. AC-1 fails on its hang guard.
1. Extend `stubMarketData` with:
   - `block bool`: `<-ctx.Done(); return nil, ctx.Err()`;
   - `requested [][]string`: a copy of `req.Symbols`.

   Increment the counter as today.
2. In `portfolio_fill_errors_test.go`, extract the 17 names into a package-level `var positionCols = []string{…}`
   and have `positionRow` use `mock.NewRows(positionCols)`. The new file builds AAPL/MSFT rows from `positionCols`;
   no second copy of the column list (DRY).
3. Add `func (f *fakeLedger) QueryEvents(context.Context, *ledgerv1.QueryEventsRequest, ...grpc.CallOption)
   (*ledgerv1.QueryEventsResponse, error)` returning an empty response. An empty `NextPageToken` ends both passes.
4. In the new file, add a WARN recorder (the marketdata `recordingWarnHandler` shape; one consumer here, so it stays
   inline; no `t.Parallel()`) and a 5s goroutine/select guard helper. Reuse `fakeConfig{vals map[string]int64}`
   (`watchlist_service_test.go:244`) for `quoteCfg`. It already satisfies `intConfig`; do not add a new fake.
5. **AC-1 (ListPositions).**
   - Setup: pgxmock `ListPositions` returns AAPL and MSFT with `current_price 0`; `stub.block = true`;
     `quoteCfg = {"portfolio.marketdata.quote_timeout_ms": 2500}`; `ctxWithUser(t, "u1")`.
   - Assert the call returns within 3s (2500ms + 0.5s);
   - assert both positions come back with `CurrentPrice == 0` and `MarketValue == 0`;
   - assert a WARN `"batch latest quotes unavailable"` is recorded and its `error` attr contains `deadline exceeded`.
6. **AC-1 (ListPortfolios)**, all-accounts branch. Use the same stub and timeout. pgxmock returns:
   - one balance account `acc-1` holding AAPL (current_price 0);
   - one offline account `acc-off` holding MSFT (current_price 0);
   - `GetOfflineRealized` rows (or no rows).

   Register the expectations in Step 9's call order, or set `mock.MatchExpectationsInOrder(false)`. Assert the same
   bound, the unenriched values and the WARN.
7. **Union batch (C-10(b))**: two balance accounts both hold AAPL (current_price 0), and one also holds MSFT. The stub
   returns both quotes. Assert:
   - `getLatestQuotesCalls == 1`;
   - `requested[0]` is the deduped set {AAPL, MSFT};
   - AAPL's `CurrentPrice` is identical in both portfolios.
8. **AC-5**, a table with `quoteCfg` timeout 500 (bound minimum; keeps the test fast):
   - `{"never answers", stub.block}`;
   - `{"AAPL only", stub.quotes = [AAPL]}`.

   Positions AAPL and MSFT have `current_price 0`. Assert `resp == nil` and `errors.Is(err, ErrQuotesUnavailable)`.
   The "AAPL only" error message names MSFT.
9. **AC-6**: one position, AAPL, qty 10, avg_entry_price 150, current_price 200; `s.ledger = &fakeLedger{}`. Assert
   `stub.getLatestQuotesCalls == 0` and `resp.UnrealizedPnl == 500`.
10. **Snapshot guard**, with `ledger = &fakeLedger{}` and one subscriber channel from `s.Subscribe("t")`:
    - (a) `stub.quotesErr` set → no `INSERT INTO portfolio.snapshots` expectation, `ledger.calls == 0`, and nothing
      on the channel;
    - (b) positions exist, the stub returns no quotes → the same skip;
    - (c) a positive control, AAPL priced → `ExpectExec("INSERT INTO portfolio.snapshots")` is met, `ledger.calls ==
      1`, and one snapshot is received.
11. **Resolver and helpers**:
    - `quoteTimeout`: nil → 4000ms; 0 / −1 → 4000ms; 2500 → 2500ms;
    - `latestQuotesFor(nil)` → `(empty, true)` and no RPC call;
    - `unvaluedSymbols` dedupes and skips `CurrentPrice > 0`.
12. **Handler** (`portfolio_handler_test.go`):
    - `classifyGetPnLError(fmt.Errorf("x: %w", service.ErrQuotesUnavailable))` → `CodeUnavailable`;
    - a generic error → `CodeInternal`;
    - `toGRPCError(connect.NewError(connect.CodeUnavailable, errors.New("q")))` → `status.Code == codes.Unavailable`;
    - end-to-end, if the handler harness at `internal/handler/portfolio_identity_test.go:47` can build a service whose
      marketdata stub fails: `grpcPortfolioAdapter.GetPnL` → `codes.Unavailable`. If it cannot, record that in
      context.md; the three-part proof above stands.
13. C-13 verdict: the AAPL/MSFT/acc-1/acc-off rows are scenario one-offs in the new file (one consumer), so they
    stay inline. `positionCols` is reused, not copied. Confirm with `grep -rn "\"avg_entry_price\", \"cost_basis\""
    --include="*_test.go" services/xstockstrat-portfolio/internal/service` → exactly 1 declaration site. The
    `internal/repository/portfolio_repo_test.go:61` copy is a different package and out of scope.

**Verification**:
```bash
cd services/xstockstrat-portfolio && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && GOWORK=off go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"
cd services/xstockstrat-portfolio && GOWORK=off golangci-lint run --modules-download-mode=mod
```
Confirm total ≥ 40%. The new logic is in excluded packages (`internal/service/`, `internal/handler/`,
`internal/repository/`), so no coverage threshold applies to it. The `-race` behavioural tests are the gate.

---

### Step 11 — docs: key rows, invariants, doc-drift fixes, findings, and the context-forge teardown

**Status**: `pending`
**Service**: `docs` (+ service `CLAUDE.md` / `docs/` files)
**Files**:
- `services/xstockstrat-marketdata/CLAUDE.md` — modify
- `services/xstockstrat-portfolio/CLAUDE.md` — modify
- `docs/patterns/config-governance.md` — modify
- `services/xstockstrat-marketdata/docs/context-constitution-findings.md` — modify
- `services/xstockstrat-portfolio/docs/context-constitution.md` — modify
- `services/xstockstrat-portfolio/docs/context-constitution-findings.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- marketdata `CLAUDE.md`:
  - the `marketdata.price.batch_timeout_ms` row is :72;
  - the `marketdata.retention.quotes_days` row (:103) says "**Documented, not yet implemented**";
  - :215 describes `GetLatestQuotes` as "a batched `DISTINCT ON (symbol)` repo read" over the cold-set singleflight.
- portfolio `CLAUDE.md`: the `## Config Keys Consumed` table is :69-82 (last row `portfolio.exposure.factor_map`
  :82). GetPnL is described at :11-20.
- `docs/patterns/config-governance.md` § Per-Feature Registered Keys (:105, newest first); the 227 entry is at
  :109-127.
- marketdata findings :21 records the `marketdata.retention.quotes_days` / `ohlcv_years` keys as "read by no code".
- portfolio constitution :37 and findings :13 say `GetPnL`, `broadcastSnapshot` and `checkRiskLimits` recompute
  from mid-quotes (the PORTFOLIO-1 parity break).
- `.agents/context-forge.json` `scrubberExtraTargets`: `["README.md", "docs/patterns/ui-ux-governance.md"]`. Neither
  is touched by this feature.

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. **marketdata `CLAUDE.md`**:
   - add rows after :72 for `marketdata.quotes.latest_lookback_hours` (int, `168`, `[24,720]`, the recency window of
     both quote readers and the cache-age guard) and `marketdata.quotes.batch_timeout_ms` (int, `2500`, `[500,5000]`,
     the detached cold-fetch budget). Give each the read-live, `≤ 0` → default, unseeded (227 D2 waiver) wording of
     the :72 row;
   - rewrite :103: implemented by feature 229 (`StartQuoteRetention`), default `90`, `[31,3650]`, skipped with a WARN
     when `days*24 <= lookback_hours`;
   - rewrite :215's `DISTINCT ON` clause: the windowed LATERAL `LIMIT 1` read; a cold failure returns the warm
     subset; out-of-window or zero-time quotes are never cached;
   - add a short "Quote retention (feature 229)" bullet listing the fixed invariants: 1h cadence, 1h first-pass
     delay, `lock_timeout` 2s, 24h step, 30s backstop, 1 PgBouncer slot held ≤30s/hour; that the bounds assume 1h
     chunks (revisit on any `set_chunk_time_interval`); and staging gates G1–G4.
2. **portfolio `CLAUDE.md`**:
   - add a `portfolio.marketdata.quote_timeout_ms` row (int, `4000`, `[500,8000]`; the deadline on `GetLatestQuotes`;
     on expiry positions stay unenriched; it must exceed `marketdata.quotes.batch_timeout_ms` + the warm read);
   - add one paragraph near :11-20 stating three things: `GetPnL` returns `Unavailable` when a needed quote is
     missing; one un-quotable offline holding makes that user's GetPnL `Unavailable` (accepted, design.md Open
     Risks); and `broadcastSnapshot` skips persisting when quotes are unavailable or no position was priced.
3. **`docs/patterns/config-governance.md`**: add a `### feature 229 — fix-book-portfolio-page (xstockstrat-portfolio /
   xstockstrat-marketdata / xstockstrat-config)` entry **above** the 227 entry (:109). Give it the 4-key table from
   product-spec.md, the D2-style seeding waiver, and a note that `marketdata.retention.quotes_days` was previously
   documented-only and is now implemented.
4. **marketdata findings :21**: mark `quotes_days` RESOLVED by 229 (`ohlcv_years` stays dead). Add a row for the
   feature-178 waiver reversal (partial result) if the file's format records such reversals; otherwise skip.
5. **portfolio constitution :37 / findings :13**: note that GetPnL now values through the shared `applyQuotes` rule
   (feature 229). `broadcastSnapshot` and `checkRiskLimits` still recompute from mid-quotes, so the finding stays
   open for those two.
6. **Teardown (root `CLAUDE.md` § Teardown).** Run `/context-forge:context-constitution refresh`, scoped to the
   files above and the changed services, and fix the grounded drift. If the plugin is unavailable, re-read each
   touched context file against the code by hand, and record both facts (plugin unavailable, and the manual
   reconciliation done) in the integration PR body and in `context.md`.

**Verification**:
```bash
grep -n "latest_lookback_hours\|quotes.batch_timeout_ms\|quotes_days\|StartQuoteRetention" services/xstockstrat-marketdata/CLAUDE.md
grep -n "quote_timeout_ms\|Unavailable" services/xstockstrat-portfolio/CLAUDE.md
grep -n "feature 229" docs/patterns/config-governance.md
grep -c "DISTINCT ON (symbol)" services/xstockstrat-marketdata/CLAUDE.md   # expect 0
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._

### D-1 — Steps 1 and 2 committed together
- **Step**: 1, 2
- **Expected**: one commit per step.
- **Actual**: one commit for the paired service + test steps. The RED of Step 2 has to precede the Step 1 edit, and
  committing Step 2 alone would leave a red test on the branch.
- **Disposition**: accepted. Paired TDD steps are committed as a unit for the rest of this run (3+4, 5+6, 7+8, 9+10).

### D-2 — Step 4: the "no DISTINCT ON" check is on a named SQL constant
- **Step**: 3, 4
- **Expected**: a negative-regex or expectation-mismatch check that the batch SQL has no `DISTINCT ON`.
- **Actual**: the first form (an expectation on `DISTINCT ON` that should go unmet) was a **false green**. It passed
  on the old SQL because of the argument count, not the text. The batch SQL is now a package const
  `latestQuotesBatchSQL`, and `TestGetLatestQuotesBatch_NoDistinctOn` asserts `!strings.Contains(…, "DISTINCT ON")`.
  RED was confirmed against the old SQL.
- **Disposition**: accepted (strictly stronger proof, same files).

### D-3 — Lint toolchain
- **Step**: 3+
- **Actual**: golangci-lint v2.14.0 had to be rebuilt with go1.27.0 (`GOTOOLCHAIN=go1.27.0`). A go1.26 build refuses
  the go1.27 modules. Tooling only, no code impact.
- **Disposition**: accepted.

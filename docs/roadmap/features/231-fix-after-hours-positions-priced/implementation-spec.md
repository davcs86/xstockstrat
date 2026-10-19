# Implementation Spec: fix-after-hours-positions-priced

**Status**: `pending`
**Created**: 2026-10-19
**Feature**: `docs/roadmap/features/231-fix-after-hours-positions-priced/feature.md`
**Total Steps**: 13
**Feature Branch**: `feature/fix-after-hours-positions-priced` (the **Development Branch** in `feature.md`; the SDD
artifacts so far are committed on harness branch `ccr-9f55a8ac-dtw4iv`, see `context.md` 2026-10-19 /sdd-triage)

> **Evidence baseline.** Every service `path:line` below is cited against this branch's merge-base with
> `origin/main-dev` (`cd1654cc`). Service code there is byte-identical to `origin/main-dev` @ `f8ef9ab9`. `main-dev`
> has moved ahead only in the per-service `docs/context-constitution*.md` files (commit `1302e6d0`, a context
> refresh). Step 13 edits those files, so **rebase onto `origin/main-dev` before Step 13** and anchor them by section
> name. Re-grep a symbol if `main-dev` moves before execution.

---

## Execution Summary

Follow design.md § Chosen Approach, inside-out, so every bound and contract exists before something relies on it:

1. **Config bounds** (Steps 1–2). Both new keys are write-bounded before any reader exists (the 229 ordering).
2. **Proto** (Steps 3–4). Add `optional double mark_price = 8` to `Quote` and regenerate the stubs.
3. **Marketdata repo** (Steps 5–6). Add `GetLatestDailyClosesBatch`, the bounded LATERAL close read.
4. **Marketdata `GetLatestQuotes`** (Steps 7–8). Add the `dailyCloseReader` seam, the two resolvers, the concurrent,
   per-caller close lookup, and the cloned-quote mark merge.
5. **Marketdata EDGAR** (Steps 9–10). `livePrice` reads the mark, `getEdgarSnapshot` is split into resolve/finish, the
   Multi path makes one pending-only quote prefetch, and nothing is cached when the mark is missing.
6. **Portfolio** (Steps 11–12). Add `markOf`. Every read path, the snapshot and the risk check go broker-first and
   skip when any position is unpriced.
7. **Docs and teardown** (Step 13).

Every `service` step is paired with the `test` step after it (C-08). The executor proves each test RED before
writing the service code (P-06, `.claude/skills/sdd-execute/reference/tdd-gate.md`). Where a new signature would make
the first RED a compile failure, land the seam types and signatures with the old behaviour first, then confirm the
new assertions fail behaviourally (feature 229 practice). Every stall-injection test runs the call behind the
existing 5s hang guard (`guardedGetLatestQuotes` in marketdata, `guard` in portfolio), so a RED run fails instead of
hanging.

**Consumer surface (C-14).** product-spec.md § Consumer Surface(s) declares a read-only value correction with no UI or
agent code change (design.md § Chosen Approach). Each named surface reaches a fixed RPC unchanged:
- agent `get_positions` / `get_positions_by_account_id` → `client.list_positions` → `PortfolioService.ListPositions`
  (`services/xstockstrat-agent/app/tools.py:2239,2260`, `app/client.py:2351-2369`);
- agent fundamentals → MCP tool **`query_fundamentals`** (`app/tools.py:402`) → `client.get_fundamentals` →
  `MarketDataService.GetFundamentals` (`app/client.py:1819-1825`);
- `/trader` Book → Portfolio → `portfolioClient.getPortfolio` / `listPortfolios` / `listPositions`
  (`services/xstockstrat-ui/src/hooks/usePortfolio.ts:13,25,50`, `useAccountPortfolios.ts:14`);
- `/insights` → `listPortfolios` (`services/xstockstrat-ui/src/lib/insightsBff.ts:123`).

grep finds **no UI or agent caller of `GetPnL`**. The product spec lists GetPnL beside ListPortfolios. GetPnL is
still fixed and tested (AC-6, AC-13), but no named surface reaches it today (flag; non-blocking). The surfaces are
proven by the portfolio read-path tests (Step 12) and the EDGAR tests (Step 10). The product spec's dev smoke test
after the close is an operator check, recorded in `context.md` at the integration PR. It is not a step.

**Spec-level choices not spelled out in design.md** (flagged for `/sdd-review impl-spec`):
- Seam: `dailyCloseReader` interface with `GetLatestDailyClosesBatch(ctx, symbols []string, since time.Time)
  (map[string]float64, error)`, held in a new `dailyCloses` field. It is assigned only when `repo != nil`, the
  `prevClose` idiom (`marketdata_service.go:218-222`). The method name is design.md §2.7's.
- Resolver names: `resolveQuoteMarkBudget` (design.md §2.3) and `resolveMarkCloseMaxAge` (new). Both use
  `resolvePositiveInt` (`:890-898`), like `resolveQuoteLookback` (`:906-908`).
- A pure helper `withMark(q *marketdatav1.Quote, closes map[string]float64) *marketdatav1.Quote` does the clone and
  the mark rule at the `out` loop, so the rule is unit-testable on its own.
- EDGAR split signatures:
  - `edgarResolve(ctx, symbol) (*marketdatav1.Fundamentals, *source.HistoricalFundamentalsPeriod, error)`: a non-nil
    `Fundamentals` is a finished answer (cache hit or vendor fallback); a non-nil period needs a price;
  - `edgarFinish(ctx, period, live *float64) *marketdatav1.Fundamentals`.
- Multi phase 1 runs every `edgarResolve` before any upsert. If symbol k aborts the batch, symbols before k now get no
  cache write; before, they were upserted first. The response is unchanged (error), so this is accepted.
- C-13 fixture homes. design.md § Constitution Rules Touched binds "one fixture home per service", and C-13's
  second-consumer trigger holds in both services:
  - marketdata: `internal/testdata/` is consumed by the repository test package (Step 6) and the service test
    package (Steps 8, 10);
  - portfolio: `internal/testdata/` is consumed by `portfolio_mark_test.go` and `portfolio_quote_deadline_test.go`
    (Step 12).
  - The precedent is `services/xstockstrat-trading/internal/testdata/order_rows.go` (`package testdata`, imported
    from `internal/repository/trading_repo_test.go:12`).

### Scenario Coverage (C-15)

| Scenario | Covered by | Proof kind |
|---|---|---|
| `@AC-1` A one-sided quote values a position at the stored daily close (both ask/bid rows) | Step 8 (marketdata: mark = 16.98), Step 12 (portfolio: current_price 16.98, mv 169.80, pnl 19.80) | behavioural, both halves |
| `@AC-2` Persisted snapshot: broker first, others marked | Step 12 | behavioural (pgxmock + subscriber snapshot) |
| `@AC-3` Concentration sums a symbol across accounts | Step 12 | behavioural (alert bodies) |
| `@AC-4` EDGAR snapshot priced from the mark (3 rows, cache written / not written) | Step 10 | behavioural |
| `@AC-5` A two-sided quote's mark is its mid | Step 8 | behavioural (1e-9 tolerance) |
| `@AC-6` One-sided with no close in bound → unpriced; GetPnL UNAVAILABLE | Step 8 (mark unset at 200h), Step 12 (current_price 0, `ErrQuotesUnavailable`) | behavioural, both halves |
| `@AC-7` Staleness bound 167h / 169h / absent; raw fields unchanged | Step 8 (behavioural + `since` pin), Step 6 (SQL text) | behavioural + SQL shape |
| `@AC-8` Any unpriced position skips the snapshot, WARN names it | Step 12 | behavioural |
| `@AC-9` Unpriced skips concentration, drawdown still alerts | Step 12 | behavioural |
| `@AC-10` GetFundamentalsMulti: one quote call for the pending symbols | Step 10 | behavioural (upstream call count) |
| `@AC-11` Failed close lookup: two-sided kept, one-sided unset, WARN | Step 8 | behavioural |
| `@AC-12` Close lookup concurrent with the cold fetch | Step 8 | behavioural (two-way handshake; either serial order fails) |
| `@AC-13` Every portfolio read path values identically | Step 12 | behavioural (5 RPCs) |
| `@AC-14` Deploy skew: no mark → two-sided mid only | Step 12 | behavioural |
| `@AC-15` A hanging close lookup is bounded by its budget | Step 8 | behavioural (elapsed < 1s) |

pgxmock never runs Postgres, so the LATERAL/PK-index plan and the `close > 0` filter in Step 5 are proven by **SQL
shape only** (insights.md 2026-10-14 "config-ui-usability"). The live proof is the post-deploy staging check (see
Step Dependencies).

## Step Dependencies

- **C-08 pairing:** Step 2 covers Step 1, Step 6 covers Step 5, Step 8 covers Step 7, Step 10 covers Step 9 and
  Step 12 covers Step 11. Steps 3–4 (proto, proto-gen) are non-code-bearing.
- Steps 5–12 require Step 1: every new key is write-bounded before a reader exists.
- Steps 7, 9 and 11 require Step 4: they read or write the generated `Quote.MarkPrice` (`*float64`).
- Step 7 requires Step 5 (`GetLatestDailyClosesBatch`). Step 9 requires Step 7 (`livePrice` reads the mark that
  `GetLatestQuotes` sets).
- Step 11 has no code dependency on Steps 5–10, because `markOf` falls back to the two-sided mid. It goes after them so
  the portfolio change lands once the producer exists (deploy skew is safe either way: `deploy.yml:204` updates all
  components in one `doctl apps update`, design.md §4).
- Step 13 requires Steps 1–12. Run the context-forge teardown last.
- **C-16 promotion** happens at the integration PR (the `/sdd-execute` integration step), not in any step here:
  - @AC-1, @AC-2, @AC-3, @AC-6, @AC-8, @AC-9, @AC-13, @AC-14 → `services/xstockstrat-portfolio/acceptance/`;
  - @AC-1, @AC-4, @AC-5, @AC-7, @AC-10, @AC-11, @AC-12, @AC-15 → `services/xstockstrat-marketdata/acceptance/`;
  - the signed-off **CHANGE** of `@AC-1 @FR-1 @FR-4 @feature-178`
    (`services/xstockstrat-portfolio/acceptance/quote-fanout-batching.feature:11-17`): "each position's enriched price
    equals the value the serial path produced" holds for two-sided quotes only;
  - the **EXTEND**s of `@AC-1 @feature-229`, `@AC-4 @feature-178` and `@AC-6 @feature-211`, as design.md § Business
    Rules Touched lists them.
- **Defect sidecar.** `docs/reports/2026-10-19-after-hours-one-sided-quote-half-price-defect.status` (`triaged`, ref
  `feature:231-…`) flips to `resolved` at the integration PR, after the dev smoke test. It is not in any step.
- **Operator rollout actions** (design.md §5 and Open Risks; no DB access in this session). Record each in
  `context.md`:
  - **EDGAR cache purge**, after the marketdata deploy, during market hours, staging then prod:
    1. `SELECT count(*) FROM marketdata.fundamentals WHERE source='edgar'`;
    2. `DELETE FROM marketdata.fundamentals WHERE source='edgar'`;
    3. verify `count(*) … WHERE source='edgar' AND fetched_at < '<deploy ts>'` = 0;
    4. record the counts.
    Never touch `marketdata.fundamentals_history`. Signals already emitted from halved prices are not repaired.
  - **Staging check after 16:00 ET**: MCP `get_positions` for an offline LYFT holder reads the stored 1d close (not
    ~½). Note the close's freshness (bar-poller lag up to ~5 min) and whether IEX daily bars carry extended-hours
    prints (Open Risks).
  - **Monitor** the `GetLatestQuotes: mark lookup failed` WARN rate after deploy. This is the extra pooled query
    after hours.
- **Open risks from design.md**, and where each is handled:
  - stored-close freshness right after 16:00, and IEX extended-hours inclusion → staging check (above), plus a
    findings entry (Step 13);
  - weekend first-query gap → AC-7 "absent" row (Step 8), documented in Step 13;
  - a permanently unpriceable holding stops snapshots/concentration → documented in Step 13 (operator-accepted);
  - `adjustment=all` back-adjusted prior close → documented in Step 13;
  - extra pooled query → monitor (above);
  - two quote fetches per fill → out of scope, no step;
  - EDGAR purge ordering → operator rollout (above).
- **Overlap.** `230-offline-account-full-pnl` (`origin/ccr-cd56ff4d-s5wkbb`, draft) touches the same portfolio
  valuation functions (`applyQuotes`, `enrichPosition`, `broadcastSnapshot`). Whichever lands second reconciles.
  `merge-order.md` has no entry for either.

---

### Step 1 — service: Write-bound the two mark keys in `SCALAR_BOUNDS_REGISTRY`

**Status**: `done`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/grpc/configServiceImpl.ts` — modify

**Reviewers**: xstockstrat-config owner — config key naming (`<service>.<category>.<key>`), environment/global-per-user scoping, secret encryption + redaction, WatchConfig stream stability

**Codebase Evidence**:
- `SCALAR_BOUNDS_REGISTRY` is at `configServiceImpl.ts:100-140`, keyed on the full config key path. The feature-229
  block is `:134-139`:
  - comment `:134-135` ("the portfolio quote deadline (default 4000) must exceed the marketdata cold budget (2500)
    plus the warm read");
  - entries `:136-139`;
  - the last entry is `'marketdata.retention.quotes_days': { minValue: 31, maxValue: 3650 }` (:139), and `};` closes
    the object at :140.
- `lookupScalarBounds(namespace, key)` (`:145-147`) probes the bare key, then `${namespace}.${key}`. Enforcement
  runs at `:426` (SetConfig) and `:537` (the batch path).
- grep for `mark_timeout_ms` / `mark_close_max_age_hours` in `services/xstockstrat-config/src/` → no match.

**TDD**: `red-green required`

**Covers**: —

**Instructions** (design.md §3):
1. After `'marketdata.retention.quotes_days'` (:139), append exactly:
   - `'marketdata.quotes.mark_timeout_ms': { minValue: 100, maxValue: 2500 }`
   - `'marketdata.quotes.mark_close_max_age_hours': { minValue: 120, maxValue: 720 }`
2. Add one comment of at most 2 lines above them, stating the constraints:
   - the mark budget ceiling equals the `batch_timeout_ms` default, so it never extends the cold-path worst case;
   - the 120h floor covers Friday's 00:00-ET-stamped 1d bar on a holiday Monday evening (feature 231).
3. Amend the 229 comment at `:134-135` so the portfolio-deadline clause reads "must exceed max(batch, mark) budget
   plus the warm read". Keep it to at most 2 lines.
4. Do not seed, and add no migration (227/229 seeding waiver, design.md §3). Do not change `lookupScalarBounds`.

**Verification**:
```bash
grep -n "mark_timeout_ms\|mark_close_max_age_hours" services/xstockstrat-config/src/grpc/configServiceImpl.ts
cd services/xstockstrat-config && pnpm run lint
```
(Behavioural proof is Step 2.)

---

### Step 2 — test: Bounds tests for the two keys, both key-column forms

**Status**: `done`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/__tests__/setConfigScalarBounds.test.ts` — modify

**Reviewers**: xstockstrat-config owner — config key naming (`<service>.<category>.<key>`), environment/global-per-user scoping, secret encryption + redaction, WatchConfig stream stability

**Codebase Evidence**:
- `TIMEOUT_KEY_FORMS` (`setConfigScalarBounds.test.ts:259-276`) lists `{ ns, key, field, min, max }` rows. Its last
  rows are the two `retention.quotes_days` forms (`:274-275`).
- The loop at `:278-296` asserts that min and max reach `insertQuery()`, and that min−1 and max+1 are rejected with
  `grpc.status.INVALID_ARGUMENT`, a `[min, max]` message and no INSERT.
- The table's comment is `:257-258` ("features 227/229: …"). `setConfig(value, key, namespace)` is `:72`.

**TDD**: `red-green required`

**Covers**: — (no `@AC-*` targets config; this is the bounds guard for FR-1/FR-2's keys, the 229 pattern)

**Instructions**:
1. Append four rows to `TIMEOUT_KEY_FORMS`, all `ns: 'marketdata'`, `field: 'intVal'`:
   - `quotes.mark_timeout_ms` and `marketdata.quotes.mark_timeout_ms`, `[100, 2500]`;
   - `quotes.mark_close_max_age_hours` and `marketdata.quotes.mark_close_max_age_hours`, `[120, 720]`.
2. Update the comment at `:257-258` to name feature 231 as well, in at most 2 lines.
3. The existing loop generates the accept and reject cases. Add no `it` block.
4. C-13 verdict: the key strings are scenario constants used only by this file (one consumer), so they stay inline.

**Verification**:
```bash
cd services/xstockstrat-config && pnpm run test:coverage && pnpm run lint
```
Confirm the c8 `--lines 40` threshold passes and every new case is green. RED before Step 1: the out-of-range writes
(99, 2501, 119, 721) reach the INSERT, so the `INVALID_ARGUMENT` assertions fail.

---

### Step 3 — proto: additive `Quote.mark_price = 8`

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/marketdata/v1/marketdata.proto` — modify

**Reviewers**:
- Proto Reviewer: field-number uniqueness per message; no breaking change without a deprecation comment; `buf lint`
  passes; `buf breaking` passes against dev trunk; BSR publication readiness.
- `packages/proto` owner: field-number uniqueness; backward compatibility (no field removal or type change without
  deprecation); naming conventions.
- `xstockstrat-marketdata` owner: OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed
  idempotency.
- `xstockstrat-portfolio` owner: P&L calculation accuracy, position snapshot consistency, concurrent write safety.

**Codebase Evidence**:
- `message Quote` is `marketdata.proto:91-99`: `symbol = 1`, `time = 2`, `ask_price = 3`, `ask_size = 4`,
  `bid_price = 5`, `bid_size = 6`, `source = 7`. Field 8 is free (overlap re-scan in `context.md` 2026-10-19 confirms
  no other feature claims it).
- Presence precedent in the same file: `LatestPrice.last_price` is `optional double last_price = 2;` (`:108`) with the
  comment "explicit presence so absence is distinguishable from a fabricated 0" (`:101-102`).
- grep for `mark_price` / `MarkPrice` in `services/` and `packages/proto/marketdata` → no match.

**TDD**: `N/A (proto — non-code-bearing)`

**Covers**: —

**Instructions** (design.md §1):
1. Add `optional double mark_price = 8;` as the last field of `Quote` (after `source = 7`, `:98`).
2. Put this 2-line comment directly above it (design.md §1 text):
   ```proto
   // Valuation mark, set only by GetLatestQuotes: two-sided mid if ask_price>0 && bid_price>0, else the newest
   // stored 1d close within marketdata.quotes.mark_close_max_age_hours. Unset = no usable mark (or not computed).
   ```
3. Change nothing else. `ask_price` / `bid_price` keep their meaning, and `GetLatestQuote`, `StreamQuotes` and the
   trading sizing path are untouched (product-spec.md § Out of Scope).
4. This is an additive optional field, so it is non-breaking (`docs/runbooks/proto-versioning.md` "Adding a new
   optional field"). Approval: Proto Reviewer + the marketdata and portfolio owners (product-spec.md § Fix Scope).

**Verification**:
```bash
cd packages/proto && buf lint && buf breaking --against "../../.git#ref=HEAD,subdir=packages/proto"
cd packages/proto && buf breaking --against "../../.git#branch=main-dev,subdir=packages/proto"   # C-09: also clean vs main-dev
# The `.git` lives at the repo root, and a branch with no commits fails `branch=` (insights.md:1876, 215 Deviation Log).
```

---

### Step 4 — proto-gen: regenerate stubs

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/go/marketdata/v1/marketdata.pb.go` — modify (generated)
- `packages/proto/gen/python/marketdata/v1/marketdata_pb2.py` — modify (generated)
- `packages/proto/gen/ts/marketdata/v1/marketdata_pb.ts` — modify (generated)
- `packages/proto/gen/ts/marketdata/v1/marketdata.ts` — modify (generated)
- `packages/proto/gen/ts/dist/marketdata/v1/marketdata.js` — modify (generated)
- `packages/proto/gen/ts/dist/marketdata/v1/marketdata.d.ts` — modify (generated)
- `packages/proto/gen/ts/dist/marketdata/v1/marketdata_pb.js` — modify (generated)
- `packages/proto/gen/ts/dist/marketdata/v1/marketdata_pb.d.ts` — modify (generated)

  This is the expected emit set. Any other file `./scripts/buf-gen.sh` emits for this change (for example a
  `.pyi` stub) is also in scope, and must be recorded in the Deviation Log. CI `proto-freshness` checks the set.

**Reviewers**: Inherited from Step 3.

**Codebase Evidence**:
- Root `CLAUDE.md` § Generating Proto Stubs says to run `./scripts/buf-gen.sh` after any `.proto` change. CI
  `proto-freshness` enforces it (`.github/workflows/ci.yml:137`).
- Both Go consumers resolve the contracts module from the working tree:
  `replace github.com/xstockstrat/contracts => ../../packages/proto`
  (`services/xstockstrat-marketdata/go.mod:43`, `services/xstockstrat-portfolio/go.mod:41`). The regenerated
  `Quote.MarkPrice *float64` and `GetMarkPrice()` are therefore visible to `GOWORK=off` builds.
- `buf` is not on this session's PATH (`which buf` → none). If Docker is also unavailable, provision the pinned
  toolchain per `docs/runbooks/codegen-toolchain-host-setup.md` and validate an empty stub diff **before** Step 3's
  edit.

**TDD**: `N/A (generated code)`

**Covers**: —

**Instructions**: Run `./scripts/buf-gen.sh` and commit **only** the regenerated files above. Step 3 already committed
the `.proto`, and per-step PRs target `feature/<slug>`, so there is no proto-freshness reason to combine them (F-08).

**Verification**:
```bash
./scripts/buf-gen.sh && git status --short packages/proto/gen | head
./scripts/buf-gen.sh && git diff --exit-code packages/proto/gen   # re-run is a no-op
cd services/xstockstrat-trading && GOWORK=off go build ./...      # the other Quote consumer still compiles
```

---

### Step 5 — service: marketdata repo — `GetLatestDailyClosesBatch`

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/repository/marketdata_repo.go` — modify

**Reviewers**: xstockstrat-marketdata owner — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence**:
- `MarketDataRepo` has `pool *pgxpool.Pool` and `db classificationDB` (`marketdata_repo.go:30-35`). `db` is "the
  query surface for fundamentals, quote reads and quote retention — the real pool in production, a pgxmock in tests".
- The shape and Exec mode to copy: `GetLatestQuotesBatch` (`:310-348`) runs
  `r.db.Query(ctx, latestQuotesBatchSQL, pgx.QueryExecModeExec, symbols, since)` (`:318`). Its SQL constant
  `latestQuotesBatchSQL` (`:350-359`) is
  `FROM unnest($1::text[]) AS s(sym) CROSS JOIN LATERAL (SELECT … WHERE symbol = s.sym AND time >= $2 ORDER BY time DESC LIMIT 1) q`.
  An empty `symbols` returns an empty map without a query (`:315-317`).
- Not reused: `GetPreviousDailyCloseBatch` (`:449-482`) is unbounded (`WHERE symbol = ANY($1) AND timeframe = '1d'`,
  no time predicate, `:462`) and returns the **second**-newest close (`rn = 2`, `:464`) (design.md §2.7).
- `CloseAt` (`:877-889`) is the single-symbol `marketdata.ohlcv … timeframe = '1d' … ORDER BY time DESC LIMIT 1` read,
  so the column and timeframe spelling are confirmed.

**TDD**: `red-green required`

**Covers**: —

**Instructions** (design.md §2.7):
1. Add a SQL constant `latestDailyClosesBatchSQL` next to `latestQuotesBatchSQL` (:350):
   ```sql
   SELECT s.sym, c.close
   FROM unnest($1::text[]) AS s(sym)
   CROSS JOIN LATERAL (
       SELECT close FROM marketdata.ohlcv
       WHERE symbol = s.sym AND timeframe = '1d' AND time >= $2 AND close > 0
       ORDER BY time DESC
       LIMIT 1
   ) c
   ```
2. Add `func (r *MarketDataRepo) GetLatestDailyClosesBatch(ctx context.Context, symbols []string, since time.Time)
   (map[string]float64, error)`, mirroring `GetLatestQuotesBatch`:
   - empty `symbols` → empty map, no query;
   - `r.db.Query(ctx, latestDailyClosesBatchSQL, pgx.QueryExecModeExec, symbols, since)`;
   - scan `(sym string, close float64)` into the map; wrap errors as `get latest daily closes batch: %w` /
     `scan …` / `iterate …`.
   A symbol with no in-bound close is absent from the map (null-not-zero).
3. Doc comment, at most 2 lines: the newest 1d close > 0 at or after `since`, per symbol; served by the
   `(symbol, timeframe, time)` PK; Exec mode for PgBouncer.

**Verification**:
```bash
cd services/xstockstrat-marketdata && GOWORK=off go build ./... && GOWORK=off golangci-lint run --modules-download-mode=mod
```
(Behavioural/SQL-shape proof is Step 6.)

---

### Step 6 — test: marketdata repo SQL shape for the close read (AC-7)

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/repository/marketdata_repo_test.go` — modify
- `services/xstockstrat-marketdata/internal/testdata/marks.go` — create

**Reviewers**: xstockstrat-marketdata owner — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence**:
- Pattern to copy: `TestGetLatestQuotesBatch_BoundedLateralShape` (`marketdata_repo_test.go:532-559`):
  - `pgxmock.NewPool()` and `repo := &MarketDataRepo{db: mock}`;
  - `mock.ExpectQuery(\`(?s)CROSS JOIN LATERAL.*time >= \$2.*LIMIT 1\`).WithArgs(pgx.QueryExecModeExec, []string{…}, since)`;
    pgxmock v4 compares the exec mode as positional argument 0 (229 spec, "Spec-level choices");
  - it asserts that the absent symbol is not zero-filled.
- `TestGetLatestQuotesBatch_NoDistinctOn` (`:561-565`) is the SQL-text pin precedent.
- No `internal/testdata/` exists in marketdata (`ls services/xstockstrat-marketdata/internal` →
  alpaca … timeframe, no testdata). The Go-home precedent is `services/xstockstrat-trading/internal/testdata/order_rows.go`.

**TDD**: `red-green required`

**Covers**: `AC-7` (SQL-shape half: the staleness predicate and `close > 0` filter)

**Instructions**:
1. Create `internal/testdata/marks.go` (`package testdata`, 2-line header naming C-13 like the trading precedent).
   Add exported constants for the acceptance givens:
   - LYFT: symbol `"LYFT"`, `LyftLoneSide = 16.05`, `LyftDailyClose = 16.98`, `LyftFiledClose = 14.20`,
     `LyftTwoSidedAsk = 17.10`, `LyftTwoSidedBid = 17.00`;
   - MSFT: `MsftAsk = 534.00`, `MsftBid = 533.30`;
   - ELWT: `ElwtAsk = 5.60`, `ElwtDailyClose = 5.48`;
   - `MarkCloseMaxAgeHours = 168`.
   Constants only, no helpers (YAGNI). Steps 8 and 10 are the second consumer.
2. Add `TestGetLatestDailyClosesBatch_BoundedLateralShape`:
   - expect `(?s)CROSS JOIN LATERAL.*marketdata\.ohlcv.*timeframe = '1d'.*time >= \$2.*close > 0.*ORDER BY time DESC.*LIMIT 1`
     with args `pgx.QueryExecModeExec, []string{"LYFT","ELWT"}, since` (`since = now − 168h`);
   - return rows `{"sym","close"}` with LYFT 16.98 only;
   - assert the map is `{LYFT: 16.98}` (ELWT absent, never 0) and that the expectations were met.
3. Add `TestGetLatestDailyClosesBatch_EmptyNoQuery`: nil symbols → empty map, no expectation registered.
4. Add `TestGetLatestDailyClosesBatch_NoUnboundedScan`: assert that `latestDailyClosesBatchSQL` contains
   `time >= $2` and does not contain `ROW_NUMBER` (it must not regress to the unbounded `GetPreviousDailyCloseBatch`
   shape).

**Verification**:
```bash
cd services/xstockstrat-marketdata && export GOWORK=off && COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | awk '/^total:/ {print; gsub("%","",$3); if ($3+0 < 40) exit 1}'   # C-08: CI threshold asserted
cd services/xstockstrat-marketdata && GOWORK=off golangci-lint run --modules-download-mode=mod
grep -rn "16.98" --include="*_test.go" services/xstockstrat-marketdata   # C-13: the close literal is imported, not redeclared
```
New logic is in an excluded package (`repository/`), so no coverage threshold applies to it. Confirm the total stays
≥ 40%. RED before Step 5: the test does not compile (`GetLatestDailyClosesBatch` undefined). For a behavioural RED,
land the method stub returning an empty map first.

---

### Step 7 — service: marketdata `GetLatestQuotes` — concurrent close lookup and mark merge

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/service/marketdata_service.go` — modify

**Reviewers**: xstockstrat-marketdata owner — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence**:
- Seams:
  - struct fields `budgetCfg intGetter`, `prevClose prevCloseReader`, `quoteStore quoteStore` (`:99-104`);
  - `intGetter` (`:110-112`), `quoteStore` (`:115-118`), `prevCloseReader` (`:125-128`);
  - nil-safe wiring `if repo != nil { svc.prevClose = repo; svc.quoteStore = repo; svc.retention = repo }`
    (`:218-222`), commented "Assigned only when non-nil: a nil pointer in an interface field defeats the nil-seam
    default" (`:214`).
- `GetLatestQuotes` (`:547-621`):
  - warm read `:558-566`; cold set `:567-572`;
  - the cold singleflight `Do` keyed on the sorted cold set, on a detached
    `context.WithTimeout(context.WithoutCancel(ctx), resolveQuoteBatchBudget(...))` (`:573-615`);
  - the `out` loop `:616-620` returns the shared map values (`warm` plus the shared `coldMap` pointers, `:608-613`)
    without copying.
- Resolvers: `resolvePositiveInt(cfg, key, def)` (`:889-898`), `resolveQuoteLookback` (`:905-908`) and
  `resolveQuoteBatchBudget` (`:910-913`).
- `google.golang.org/protobuf/proto` is not yet imported (`:4-31`). It is a direct dependency
  (`go.mod:18` `google.golang.org/protobuf v1.36.11`).
- No new outbound gRPC call: the close lookup is a repo read on the existing pooled `pgxpool` (MaxConns 2, design.md
  "Pool safety"; F-06), so header propagation is unaffected.

**TDD**: `red-green required`

**Covers**: —

**Instructions** (design.md §2):
1. **Seam.** Add `dailyCloseReader` with
   `GetLatestDailyClosesBatch(ctx context.Context, symbols []string, since time.Time) (map[string]float64, error)`
   and a struct field `dailyCloses dailyCloseReader` next to `prevClose` (:102). Wire `svc.dailyCloses = repo`
   inside the existing `if repo != nil` block (:218-222). A nil reader gives mid-only marks.
2. **Resolvers**, after `resolveQuoteBatchBudget` (:913):
   - `resolveQuoteMarkBudget(cfg intGetter) time.Duration` → `marketdata.quotes.mark_timeout_ms`, default `500` ms;
   - `resolveMarkCloseMaxAge(cfg intGetter) time.Duration` → `marketdata.quotes.mark_close_max_age_hours`, default
     `168` h.
   Both go through `resolvePositiveInt` (F-07: no hardcoded policy value outside the default).
3. **Pure helper** `withMark(q *marketdatav1.Quote, closes map[string]float64) *marketdatav1.Quote`:
   - returns `proto.Clone(q).(*marketdatav1.Quote)`;
   - if `AskPrice > 0 && BidPrice > 0`, sets `MarkPrice = proto.Float64((Ask+Bid)/2)`;
   - else, if `closes[q.Symbol] > 0`, sets `MarkPrice` to that close;
   - else leaves it unset.
   It never averages a one-sided quote and never touches the raw ask/bid.
4. **`needClose`**, after the warm read (:566): every requested symbol whose warm quote is missing or not two-sided.
   This includes all cold symbols (design.md §2.2).
5. **Concurrent lookup.** When `s.dailyCloses != nil && len(needClose) > 0`, start one goroutine **before** the
   `if len(cold) > 0` block (:573):
   - `cctx, cancel := context.WithTimeout(ctx, resolveQuoteMarkBudget(s.budgetCfg))`. It is per caller and **not**
     detached; cancel it after the receive.
   - The goroutine calls `s.dailyCloses.GetLatestDailyClosesBatch(cctx, needClose, time.Now().Add(-resolveMarkCloseMaxAge(s.budgetCfg)))`
     and sends `{closes, err}` on a channel of capacity 1. It sends its own map and never reads or writes `warm`.
   - **Always receive** after the singleflight block (or immediately when there is no cold set).
   - On `err != nil`: `slog.Warn("GetLatestQuotes: mark lookup failed", "symbols", len(needClose), "error", err,
     "ctx_done", ctx.Err() != nil)` and use a nil `closes` map.
   Leave the warm read and the singleflight closure unchanged (design.md §2.1).
6. **Merge at the `out` loop** (:616-619): append `withMark(q, closes)` instead of `q`. A symbol the cold fetch omitted
   stays omitted; never synthesize a `Quote` (229 `@AC-8`).
7. Update the `GetLatestQuotes` doc comment (:547-548), at most 2 lines: each returned quote is a clone carrying
   `mark_price` per the proto rule.

**Verification**:
```bash
cd services/xstockstrat-marketdata && GOWORK=off go build ./... && GOWORK=off golangci-lint run --modules-download-mode=mod
grep -n "mark_timeout_ms\|mark_close_max_age_hours\|dailyCloses\|withMark" services/xstockstrat-marketdata/internal/service/marketdata_service.go
```
(Behavioural proof is Step 8.)

---

### Step 8 — test: marketdata mark computation (AC-1, AC-5, AC-6, AC-7, AC-11, AC-12, AC-15)

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/service/marketdata_service_test.go` — modify

**Reviewers**: xstockstrat-marketdata owner — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence**:
- Fakes to reuse:
  - `fakeMultiSource` (`marketdata_service_test.go:991-1052`): `quotes`, `calls`, `requested`, a `started` / `release`
    handshake, `honourCtx` and `err`. `<-f.release` blocks unconditionally when `release != nil && !honourCtx`
    (`:1017-1018`).
  - `fakeQuoteStore` (`:3005-3030`) mirrors the `time >= since` window.
  - `newQuoteSvc(fake, store, cfg fakeIntGetter)` (`:3032-3040`).
  - `guardedGetLatestQuotes` (`:3043-3066`, a 5s hang guard returning `map[sym]*Quote` and elapsed).
  - `quoteAt` (`:3068-3070`).
  - `installWarnRecorder` / `find` (`:1575-1594`) and `fakeIntGetter` (`:1596-1603`).
- Precedents:
  - `fakePrevCloseReader` with a once-closed `entered` channel (`:1605-1617`) is the pattern for the close fake;
  - `TestGetLatestQuotes_AC8_PartialOnColdFailure` (`:3190-3220`) asserts WARN text, attrs and elapsed;
  - `TestResolveQuoteTunables` (`:3222-3247`) is the resolver table to extend.
- Fixture home: `services/xstockstrat-marketdata/internal/testdata/marks.go` (created in Step 6).

**TDD**: `red-green required`

**Covers**: `AC-1, AC-5, AC-6, AC-7, AC-11, AC-12, AC-15`

**Instructions** (append a `// ── feature 231: valuation mark ──` section at the end of the file, after :3329):
1. **`fakeDailyCloseReader`** (one consumer file → inline; the numeric givens come from `internal/testdata`):
   - `rows map[string]struct{ close float64; at time.Time }`;
   - records `gotSince` and `calls`;
   - `entered chan struct{}`, closed once on the first call (copy the `fakePrevCloseReader` `sync.Once` idiom);
   - `block bool`: wait for `ctx.Done()` and return `ctx.Err()`;
   - `err error`;
   - returns only rows with `!at.Before(since)` (mirrors the repo predicate, like `fakeQuoteStore`).
   Wire it with `svc.dailyCloses = fake` after `newQuoteSvc`.
2. **AC-1** (table over both rows, ask 16.05/bid 0 and ask 0/bid 16.05). Setup: cold LYFT from `fakeMultiSource`;
   close 16.98 stored 24h ago. Assert `MarkPrice != nil && *MarkPrice == 16.98`, and that the raw ask/bid are
   unchanged.
3. **AC-5**: LYFT 17.10/17.00 with close 16.98 present → `|*MarkPrice − 17.05| < 1e-9`.
4. **AC-6**: ELWT ask 5.60 / bid 0, close 5.48 stored 200h ago, with `mark_close_max_age_hours` 168 → `MarkPrice == nil`.
5. **AC-7** (3 rows):
   - close 16.98 at 167h → 16.98;
   - close at 169h → unset;
   - no row → unset.
   Every row also asserts `AskPrice == 16.05 && BidPrice == 0`. Pin the bound: `gotSince` is within ±1s of
   `now − 168h` (R2 note in `context.md`).
6. **AC-11**:
   - LYFT (16.05/0) and MSFT (534.00/533.30) are both warm in `fakeQuoteStore`, built inline with a recent `Time`
     (`quoteAt`, `:3068-3070`, hardcodes 101/100);
   - the close fake has `block: true`, and `fakeIntGetter{"marketdata.quotes.mark_timeout_ms": 100}`;
   - assert MSFT mark is 533.65 ±1e-9, LYFT mark is nil, and `rec.find("GetLatestQuotes: mark lookup failed")` is
     non-nil with an `error` attr.
   - Add a second sub-case where the close fake returns `err: errors.New("pool exhausted")`, with the same assertions.
7. **AC-12 (two-way concurrency handshake)**:
   - cold LYFT 16.05/0; the close fake holds 16.98 at 24h; `mark_timeout_ms` 2500;
   - give `fakeDailyCloseReader` a `waitFor <-chan struct{}` field. After closing `entered`, it `select`s on
     `waitFor` / `ctx.Done()`, returning `ctx.Err()` on the latter;
   - wire `multi := &fakeMultiSource{started: make(chan struct{}), release: closeFake.entered}` (the existing
     `started` field, `marketdata_service_test.go:995`) and `closeFake.waitFor = multi.started`;
   - assert LYFT is returned with mark 16.98 inside the 5s guard.
   Only a concurrent implementation passes. Cold-first serial deadlocks, and the guard fails it. Close-first serial
   times the close lookup out, so the mark is nil and the assertion fails (design.md C-08/P-06).
8. **AC-15**:
   - `mark_timeout_ms` 100; cold LYFT 16.05/0 that returns immediately; the close fake has `block: true`;
   - assert the quote is returned with `MarkPrice == nil` and `elapsed < 1s`.
9. **Clone safety**: after a call, the `fakeQuoteStore.rows["LYFT"]` pointer and the `fakeMultiSource.quotes` entry
   still have `MarkPrice == nil` (no shared-pointer mutation across singleflight waiters).
10. **Nil reader**: `dailyCloses` unset with a two-sided quote → mark is the mid; with a one-sided quote → nil.
11. **Resolvers**: extend `TestResolveQuoteTunables` (`:3222`):
    - `resolveQuoteMarkBudget(nil) == 500ms`; `0`/`-1` → 500ms; `100` → 100ms;
    - `resolveMarkCloseMaxAge(nil) == 168h`; `0` → 168h; `120` → 120h.
12. Existing 178/229 tests (`:1057-1130`, `:3073-3220`) must stay green unchanged. They use two-sided quotes and no
    close reader.
13. C-13 verdict: the LYFT/MSFT/ELWT numbers are imported from `internal/testdata`. The fake type is single-file, so
    it stays inline.

**Verification**:
```bash
cd services/xstockstrat-marketdata && export GOWORK=off && COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | awk '/^total:/ {print; gsub("%","",$3); if ($3+0 < 40) exit 1}'   # C-08: CI threshold asserted
cd services/xstockstrat-marketdata && GOWORK=off golangci-lint run --modules-download-mode=mod
grep -rn "16\.98\|533\.30\|5\.48" --include="*_test.go" services/xstockstrat-marketdata   # expect no redeclared literals
```
New logic is in an excluded package (`service/`), so no coverage threshold applies to it. Confirm the total stays
≥ 40%. RED before Step 7:
- the AC-1/5/6/7 mark assertions fail (`MarkPrice` is never set);
- AC-11 finds no WARN;
- AC-12 deadlocks, and the guard fails it.

---

### Step 9 — service: marketdata EDGAR — mark-priced snapshot, split resolve/finish, Multi prefetch

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/service/marketdata_service.go` — modify

**Reviewers**: xstockstrat-marketdata owner — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence**:
- `getEdgarSnapshot` (`:1691-1731`):
  - kill switch `:1698-1701` (`FailedPrecondition`);
  - edgar-axis cache hit `:1704-1708`;
  - `LatestHistoricalFundamental` `:1709-1712`;
  - vendor fallback / `errNoEdgarSnapshot` NotFound `:1713-1725`;
  - live join `edgarSnapshotFromPeriod(latest, s.livePrice(ctx, symbol))` `:1726`;
  - unconditional `UpsertFundamentals` `:1727-1729`;
  - `toProtoFundamentals(snap, false)` `:1730`.
- `livePrice` (`:1733-1745`) computes `mid := (Ask + Bid) / 2` and guards only `mid <= 0` (`:1740-1743`). It goes
  through cache-first `GetLatestQuotes`.
- `edgarSnapshotFromPeriod` (`:1752-1756`): `price := p.Price; if live != nil { price = live }`. This is the
  filed-date close fallback.
- `GetFundamentalsMulti` edgar dispatch (`:1502-1524`) loops `getEdgarSnapshot` per symbol (`:1508-1522`): it skips
  `""`, omits `connect.CodeNotFound` (:1513-1515), aborts on any other error (:1516-1518), and keeps input order.
- `fails.md` 2026-09-16 "readiness-caching-poll-discipline — config" (memoize only successful reads; never cache an
  unavailable fetch) is the rule behind not upserting a filed-date fallback.

**TDD**: `red-green required`

**Covers**: —

**Instructions** (design.md §5):
1. **`livePrice`** (:1735): return `quotes[0].MarkPrice` when non-nil and `> 0`. Otherwise return `nil`, so the price
   falls to the filed-date close. Delete the mid computation. Update its doc comment (≤2 lines).
2. **Split `getEdgarSnapshot`:**
   - `edgarResolve(ctx, symbol) (*marketdatav1.Fundamentals, *source.HistoricalFundamentalsPeriod, error)` holds
     `:1698-1725` unchanged. A cache hit or vendor fallback returns `(f, nil, err)`; a producible period returns
     `(nil, latest, nil)`.
   - `edgarFinish(ctx, period, live *float64) *marketdatav1.Fundamentals` builds `edgarSnapshotFromPeriod(period,
     live)`. It calls `UpsertFundamentals` **only when `live != nil`** (WARN on upsert failure, as at :1728). A nil
     `live` is served uncached, so a transient mark miss never caches the filed-date price for 24h. Then it returns
     `toProtoFundamentals(snap, false)`.
   - `getEdgarSnapshot` becomes resolve → (when a period is returned) `edgarFinish(ctx, period, s.livePrice(ctx,
     symbol))`.
3. **`GetFundamentalsMulti` edgar path** (:1506-1523):
   - **phase 1** runs `edgarResolve` serially over `symbols` (skip `""`; omit NotFound; abort on any other error),
     recording either the finished result or the pending period per input index;
   - **then exactly one** `s.GetLatestQuotes(ctx, pendingSymbols)` when at least one symbol is pending, and none when
     all were finished in phase 1. Build `marks[sym]` from quotes whose `MarkPrice` is non-nil and > 0. A
     `GetLatestQuotes` error means no marks (all pending are served uncached at the filed close, the same as
     `livePrice`'s nil);
   - **phase 2** walks the input order and appends either the finished result or
     `edgarFinish(ctx, period, live)`, where `live` is built inline (no helper):
     `var live *float64; if m, ok := marks[sym]; ok { v := m; live = &v }`.
   Keep the C-10(b) comment (:1503-1505) accurate in ≤2 lines: one builder for both RPCs, prefetch only for pending
   symbols.
4. Do not touch the vendor path (:1525 onward) or `edgarSnapshotFromPeriod`.

**Verification**:
```bash
cd services/xstockstrat-marketdata && GOWORK=off go build ./... && GOWORK=off golangci-lint run --modules-download-mode=mod
grep -n "AskPrice + \|BidPrice) / 2" services/xstockstrat-marketdata/internal/service/marketdata_service.go   # expect none in livePrice
```
(Behavioural proof is Step 10.)

---

### Step 10 — test: marketdata EDGAR pricing and Multi prefetch (AC-4, AC-10)

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/service/marketdata_service_test.go` — modify

**Reviewers**: xstockstrat-marketdata owner — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence**:
- `edgarSnapshotSvc(latest, quote, cfg, vendorSrc, provider)` (`:2297-2316`) wires:
  - `fundRepo: newFakeFundRepo()`;
  - `histRepo: &fakeHistRepo{latest: latest}`;
  - a registry with `&fakeMultiSource{quotes: q}`.
  It sets neither `budgetCfg` nor `quoteStore` (every symbol is cold), and it does not return its
  `fakeMultiSource`. AC-10 needs `calls` / `requested`, so build the registry inline in that test (or type-assert
  `svc.registry.Get("")` to `*fakeMultiSource`).
- `fakeFundRepo.upserts` counts `UpsertFundamentals` calls (`:178-204`). `fakeHistRepo.latestBy` overrides `latest`
  per symbol (`:1872`, `:1915-1920`). `fakeCfg{strings, bools, ints}` (`:248-271`).
- `babaEdgarPeriod()` (`:2318-2326`) shows a period that passes `hasCoreMetrics` (`MarketCap`, `PBRatio`, …,
  `Price: f64p(70)` = filed close).
- Existing edgar tests that must stay green:
  - `TestGetFundamentals_EdgarSnapshot_AC6_FR8_feature211` (`:2332-2362`), two-sided 101/99 → price ~100;
  - `…EdgarParity_C10b_feature211` (`:2366`); `…EdgarFallbackToVendor_AC7_feature211` (`:2392`);
  - `…EdgarKillSwitch_feature211` (`:2413`); `…EdgarCacheSelfHeal_feature211` (`:2431`);
  - `TestFundamentals_EdgarNoSnapshotIsNotFound_feature215` (`:2910`);
  - `TestFundamentals_EdgarKillSwitchBothRPCs_feature215` (`:2967`).

**TDD**: `red-green required`

**Covers**: `AC-4, AC-10`

**Instructions**:
1. **AC-4** (table, 3 rows). Config: `snapshot_source=edgar`, `edgar.enabled=true`. LYFT period with
   `Price = LyftFiledClose (14.20)` and a core metric. Inject the Step 8 `fakeDailyCloseReader` with LYFT 16.98 at the
   row's age.
   - row 1: 16.05/0, 24h → `f.Price == 16.98`, `fundRepo.upserts == 1`;
   - row 2: 17.10/17.00, 24h → `|f.Price − 17.05| < 1e-9`, `upserts == 1`;
   - row 3: 16.05/0, 200h → `f.Price == 14.20`, `upserts == 0` (not cached).
2. **AC-10**:
   - `latestBy` holds LYFT and MSFT periods; neither has a cache row;
   - the cold `fakeMultiSource` serves LYFT 16.05/0 and MSFT 534.00/533.30, and the close fake serves LYFT 16.98 at
     24h;
   - call `GetFundamentalsMulti(ctx, []string{"LYFT","MSFT"})` and assert:
     - `fake.calls == 1`, with `fake.requested[0] == []string{"LYFT","MSFT"}` (one quote call for both pending
       symbols);
     - the LYFT price is 16.98 and the MSFT price is 533.65 ±1e-9;
     - the output keeps input order.
3. **Prefetch skipped on all-cache-hit**: both symbols have fresh `source:"edgar"` rows in `fundRepo` → `fake.calls == 0`.
4. **Abort semantics kept**: `edgar.enabled=false` → error on the Multi call and `fake.calls == 0` (complements the
   215 kill-switch test).
5. **`livePrice`**: a quote with `MarkPrice` 16.98 → 16.98; a quote with no `MarkPrice` → nil.
6. C-13 verdict: the numbers are imported from `internal/testdata` (Step 6 home); the period builder stays inline
   (scenario one-off).

**Verification**:
```bash
cd services/xstockstrat-marketdata && export GOWORK=off && COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | awk '/^total:/ {print; gsub("%","",$3); if ($3+0 < 40) exit 1}'   # C-08: CI threshold asserted
cd services/xstockstrat-marketdata && GOWORK=off golangci-lint run --modules-download-mode=mod
```
New logic is in an excluded package (`service/`), so no coverage threshold applies to it. Confirm the total stays
≥ 40%. RED before Step 9:
- AC-4 row 1 prices 8.025 and caches it;
- row 3 caches 8.025;
- AC-10 makes two upstream calls (`["LYFT"]`, `["MSFT"]`).

---

### Step 11 — service: portfolio `markOf`, broker-first snapshot and concentration, skip on any unpriced

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/portfolio_service.go` — modify
- `services/xstockstrat-portfolio/internal/service/portfolio_helpers_test.go` — modify (signature follow-up only)

**Reviewers**: xstockstrat-portfolio owner — P&L calculation accuracy, position snapshot consistency, concurrent write safety

**Codebase Evidence**:
- `latestQuotesFor(ctx, symbols) (map, bool)` (`portfolio_service.go:390-408`) is one batched `GetLatestQuotes` under
  `quoteTimeout()` (`:410-420`).
- `unvaluedSymbols` (`:422-438`) returns deduped symbols with `CurrentPrice <= 0`. `enrichPositions` (`:440-444`).
- `applyQuotes` (`:446-464`): broker skip `:450`; mid `:457`; guard only `price <= 0` with WARN "latest quote has no
  usable price" (`:458-461`); then `enrichPosition(p, quote.AskPrice, quote.BidPrice)` (`:462`).
- `enrichPosition(p, askPrice, bidPrice)` (`:545-555`) recomputes the mid (`:548`). The formula is written twice.
- `TestEnrichPosition` (`portfolio_helpers_test.go:369-391`) calls `enrichPosition(p, tc.ask, tc.bid)` (`:384`).
  `golangci-lint` type-checks test files, so this step's lint fails unless the call follows the new signature.
- `GetPnL` (`:641-659`): `applyQuotes` at `:652`; `CurrentPrice <= 0` → `ErrQuotesUnavailable` (`:654-657`); unrealized
  `(CurrentPrice − AvgEntryPrice) × Qty` (`:658`). No code change needed: it inherits `markOf` through `applyQuotes`.
- `broadcastSnapshot` (`:827-871`):
  - quotes **all** symbols (`:833-837`);
  - mid with no guard (`:841`);
  - skip only when `!ok || priced == 0`, with WARN "portfolio snapshot skipped: quotes unavailable" (`:846-850`);
  - then `InsertSnapshot` (`:858`), `portfolio.snapshot` event (`:859-861`) and subscriber fan-out (`:863-870`).
- `checkRiskLimits` (`:891-931`):
  - `GetFloat` limits (`:892-893`); quotes all symbols (`:901-905`);
  - mid with no guard (`:908`) and the cross-account **overwrite** `posValues[p.Symbol] = val` (`:910`);
  - concentration `:915-923`, emitting `"concentration limit breach: %s at %.1f%%"`;
  - drawdown via `GetAccountDrawdowns` + `evaluateDrawdowns` (`:924-930`), untouched.
- `buildAccountPortfolio` (`:1230-1260`): offline equity = Σ `MarketValue` (`:1232-1235`), used by ListPortfolios
  (`:1338-1344`).
- `quote.MarkPrice` is the generated `*float64` (Step 4). No new outbound call: the same `GetLatestQuotes` RPC on the
  existing propagating client (`grpc.WithChainUnaryInterceptor(middleware.UnaryClientInterceptor)`, `:127`).

**TDD**: `red-green required`

**Covers**: —

**Instructions** (design.md §4):
1. **`markOf(q *marketdatav1.Quote) (float64, bool)`**, a pure function placed above `applyQuotes`:
   - `q.MarkPrice != nil && *q.MarkPrice > 0` → that value;
   - else `q.AskPrice > 0 && q.BidPrice > 0` → `(Ask+Bid)/2` (deploy-skew fallback, never a one-sided average);
   - else `0, false`.
   Doc comment ≤2 lines: the mid fallback exists only for deploy skew/rollback (`deploy.yml:204` cannot order
   component rollouts).
2. **`applyQuotes`** (:448-464): replace `:457-462` with `price, ok := markOf(quote)`. On `!ok`, keep the existing WARN
   (add a `mark` attr) and `continue`; otherwise call `enrichPosition(p, price)`. Update its doc comment (:446-447)
   to say "mark-values".
3. **`enrichPosition(p, price float64)`** (:547): drop the ask/bid params and the mid at `:548`. Update the doc comment
   (:545-546). There is now one valuation rule per service (C-18).
   3a. Update `TestEnrichPosition` (`portfolio_helpers_test.go:369-391`) to the new signature. Drop the `ask, bid`
   case fields and call `enrichPosition(p, tc.wantPrice)`. The expected values do not change (ask == bid in every
   row). This is a mechanical follow-up, not a new behaviour, so Step 11's TDD stays as stated.
4. **`broadcastSnapshot`** (:832-850): replace the all-symbol fetch and the mid loop with:
   - `quotes, ok := s.latestQuotesFor(ctx, unvaluedSymbols(positions))`, then `applyQuotes(positions, quotes)`, then
     `unpriced := unvaluedSymbols(positions)`;
   - if `!ok || len(unpriced) > 0` → `slog.Warn("portfolio snapshot skipped: positions unpriced", "user_id", userID,
     "unpriced", unpriced, "quotes_ok", ok)` and return;
   - otherwise `equity = Σ p.MarketValue` (broker `market_value` for broker-valued rows, `C-10(b)`).
   A zero-position user still writes a zero-equity snapshot, as today (`unvaluedSymbols` is empty and
   `latestQuotesFor` returns `ok=true` without an RPC, `:394-396`). The rest of the function (:851-870) is unchanged.
5. **`checkRiskLimits`** (:899-923):
   - use the same `latestQuotesFor(unvaluedSymbols)` → `applyQuotes` → `unpriced` sequence;
   - if `!ok || len(unpriced) > 0` → `slog.Warn("concentration check skipped: positions unpriced", "user_id", userID,
     "unpriced", unpriced, "quotes_ok", ok)` and skip **only** the concentration block;
   - otherwise `posValues[p.Symbol] += p.MarketValue` and `totalValue += p.MarketValue` (fixes the `:910` overwrite).
   The drawdown block (:924-930) runs in both cases, unchanged.
6. Leave `GetPnL`, `ListPortfolios`, `enrichPositions`, `latestQuotesFor` and `StartSnapshotWriter` (:812-825, no
   caller; findings entry in Step 13) unchanged.

**Verification**:
```bash
cd services/xstockstrat-portfolio && GOWORK=off go build ./... && GOWORK=off golangci-lint run --modules-download-mode=mod
grep -n "AskPrice + \|BidPrice) / 2\|AskPrice+" services/xstockstrat-portfolio/internal/service/portfolio_service.go   # expect only inside markOf
```
(Behavioural proof is Step 12.)

---

### Step 12 — test: portfolio read paths, snapshot and risk (AC-1, AC-2, AC-3, AC-6, AC-8, AC-9, AC-13, AC-14)

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/testdata/marks.go` — create
- `services/xstockstrat-portfolio/internal/service/portfolio_mark_test.go` — create
- `services/xstockstrat-portfolio/internal/service/portfolio_quote_deadline_test.go` — modify
- `services/xstockstrat-portfolio/internal/service/portfolio_service_test.go` — modify

**Reviewers**: xstockstrat-portfolio owner — P&L calculation accuracy, position snapshot consistency, concurrent write safety

**Codebase Evidence**:
- Harness:
  - `stubMarketData` (`portfolio_service_test.go:18-39`) has `quotes`, `quotesErr`, `block` and `requested [][]string`;
  - `newQuoteSvc(t, stub, timeoutMs)` (`portfolio_quote_deadline_test.go:87-106`) builds a pgxmock repo,
    `fakeLedger` and `subs`, with `MatchExpectationsInOrder(false)`;
  - `posRow(rows, sym, account, qty, avg, current)` (`:78-81`) sets `cost_basis = qty*avg` and
    `market_value = current*qty`;
  - `quote(sym, mid)` (`:83-85`), `recordWarns` / `find` (`:24-61`), `guard` (`:64-76`);
  - `expectAllAccounts` (`:110-124`) and `pnlRows` (`:257-259`);
  - `positionCols` (`portfolio_fill_errors_test.go:45-49`) and `anyArgs` (`:36-42`);
  - `fakeLedger.calls` (`watchlist_service_test.go:254-275`) and `ctxWithUser` (`:280-290`).
- Snapshot precedent: `TestBroadcastSnapshot_SkipsWhenUnpriced` (`portfolio_quote_deadline_test.go:301-335`):
  - `svc.Subscribe("t")` channel;
  - `ExpectQuery(\`FROM portfolio.positions\`).WithArgs(anyArgs(4)...)`;
  - `ExpectExec(\`INSERT INTO portfolio.snapshots\`).WithArgs(anyArgs(7)...)`;
  - asserts `ledger.calls` / `len(ch)`.
- Risk: `checkRiskLimits` reads `s.cfg.GetFloat`, and `s.cfg` is `*config.Watcher`. The zero value `&config.Watcher{}`
  is safe and returns the defaults 0.20 / 0.10 (precedent `portfolio_fill_sync_race_test.go:65`).
  - `GetAccountDrawdowns` runs `SELECT account_id, equity, peak_equity FROM portfolio.account_balances WHERE
    user_id=$1 AND trading_mode=$2` (`internal/repository/portfolio_repo.go:411-416`).
  - **Not found:** no notify fake exists in portfolio tests (grep `EmitAlert` in `internal/service/*_test.go` → none).
    One must be created.
- `GetPosition` repo read: `WHERE user_id=$1 AND symbol=$2 AND trading_mode=$3` (`portfolio_repo.go:115-129`).
- Parity test to amend (C-16 CHANGE): `TestEnrichPositions_OneBatchedCall` (`portfolio_service_test.go:46-75`). Its
  comment says "byte-identical (Ask+Bid)/2 mid", and its quotes are two-sided (`Ask 100+i`, `Bid 98+i`).
- No `internal/testdata/` in portfolio (`ls services/xstockstrat-portfolio/internal` → config handler middleware mtls
  repository service telemetry).

**TDD**: `red-green required`

**Covers**: `AC-1, AC-2, AC-3, AC-6, AC-8, AC-9, AC-13, AC-14`

**Instructions**:
1. **Fixture home** `internal/testdata/marks.go` (`package testdata`, 2-line C-13 header). Constants only:
   - LYFT: `LyftLoneSide = 16.05`, `LyftMark = 16.98`, `LyftQty = 10`, `LyftAvgEntry = 15.00`;
   - MSFT: `MsftBrokerPrice = 533.65`, `MsftQty = 2`;
   - ELWT: `ElwtAsk = 5.60`, `ElwtQty = 100`;
   - LYFT two-sided: `LyftTwoSidedAsk = 17.10`, `LyftTwoSidedBid = 17.00`.
   Consumers: `portfolio_mark_test.go` and `portfolio_quote_deadline_test.go`.
2. **`portfolio_mark_test.go`** (new):
   - `TestMarkOf` table covering AC-14 and the rule:
     - mark 16.98 with 16.05/0 → (16.98, true);
     - mark 0 with 17.10/17.00 → (17.05, true);
     - no mark with 17.10/17.00 → (17.05, true);
     - no mark with 16.05/0 → (0, false);
     - no mark with 0/16.05 → (0, false).
   - **AC-1** (table over 16.05/0 and 0/16.05): the stub returns LYFT with `MarkPrice: proto.Float64(16.98)`, and
     `posRow(…, "LYFT", "acc-off", 10, 15.00, 0)`. `ListPositions` → `current_price 16.98`, `market_value 169.80`
     and `unrealized_pnl 19.80`, each ±1e-9.
   - **AC-14** (2 rows, stub quote without a mark): 17.10/17.00 → `current_price 17.05`; 16.05/0 → `0` and
     `market_value 0`.
   - **AC-6**: offline ELWT 100 with a stub quote of ask 5.60 / bid 0 and no mark. `ListPositions` → `current_price 0`.
     `GetPnL` → `errors.Is(err, ErrQuotesUnavailable)`, which the handler maps to UNAVAILABLE via
     `classifyGetPnLError` (already covered by `internal/handler` `TestClassifyGetPnLError`).
   - **AC-13**: with the AC-1 stub and position, call `ListPositions`, `GetPosition`, `GetPortfolio`, `ListPortfolios`
     (all-accounts, `expectAllAccounts(mock, nil, []string{"acc-off"}, …)`) and `GetPnL` on fresh pgxmock
     expectations. Assert:
     - every LYFT `current_price` is 16.98;
     - `GetPnL.UnrealizedPnl` is 19.80;
     - the ListPortfolios account `Equity` is 169.80 (±1e-9).
3. **`portfolio_quote_deadline_test.go`** (extend):
   - Add `recordingNotify` (embeds `notifyv1.NotifyServiceClient`; `EmitAlert` appends `in.Body`). It is inline
     because it has one consumer.
   - **AC-2** (`TestBroadcastSnapshot_AC2_BrokerFirstEquity`):
     - rows: LYFT `posRow(…, "acc-off", 10, 15.00, 0)` and MSFT `posRow(…, "brk-1", 2, <avg>, 533.65)`, so the
       broker `market_value` is 1067.30;
     - the stub returns LYFT with mark 16.98;
     - expect the INSERT;
     - assert the subscriber snapshot `Equity` is 1237.10 ±1e-9, `ledger.calls == 1`, `len(ch) == 1`, and
       `stub.requested == [][]string{{"LYFT"}}`.
   - **AC-8** (`TestBroadcastSnapshot_AC8_AnyUnpricedSkips`):
     - rows LYFT (mark 16.98) + ELWT (5.60/0, no mark); no INSERT is expected;
     - assert `ledger.calls == 0`, `len(ch) == 0`, and that `rec.find("portfolio snapshot skipped: positions unpriced")`
       has an `unpriced` attr containing `ELWT`.
   - Update `TestBroadcastSnapshot_SkipsWhenUnpriced` (`:301-335`) only if its assertions need the new WARN text.
     They do not assert it today, so expect no change.
   - **AC-3** (`TestCheckRiskLimits_AC3_SumsAcrossAccounts`):
     - set `svc.cfg = &config.Watcher{}` and `svc.notify = rec`;
     - positions: LYFT 10 on `acc-1`, LYFT 10 on `acc-2` (both current 0) and MSFT 2 on `brk-1` at broker 533.65;
     - the stub returns the LYFT mark 16.98;
     - `GetAccountDrawdowns` returns no rows;
     - assert the alert bodies are exactly `{"concentration limit breach: LYFT at 24.1%", "concentration limit
       breach: MSFT at 75.9%"}`, compared order-insensitively (map iteration).
   - **AC-9** (`TestCheckRiskLimits_AC9_UnpricedSkipsConcentrationDrawdownStillAlerts`):
     - LYFT (mark 16.98) and ELWT (unpriced) on the offline account;
     - `GetAccountDrawdowns` returns the row `brk-1`, equity 800.00, peak 1000.00;
     - assert the only alert is `"drawdown limit breach: account brk-1 at 20.0% (peak 1000.00, current 800.00)"`;
     - assert the WARN `concentration check skipped: positions unpriced` names `ELWT`.
4. **`portfolio_service_test.go`**: amend only the `TestEnrichPositions_OneBatchedCall` doc comment (`:46-48`) to say
   batched equals serial **for two-sided quotes** (signed C-16 CHANGE of `@AC-1 @feature-178`, `context.md`
   2026-10-19). The assertions stay, because the quotes are two-sided and `markOf` returns their mid.
5. C-13 verdict: the LYFT/MSFT/ELWT values come from `internal/testdata`. `recordingNotify`, row builders and alert
   strings are scenario one-offs, so they stay inline.

**Verification**:
```bash
cd services/xstockstrat-portfolio && export GOWORK=off && COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | awk '/^total:/ {print; gsub("%","",$3); if ($3+0 < 40) exit 1}'   # C-08: CI threshold asserted
cd services/xstockstrat-portfolio && GOWORK=off golangci-lint run --modules-download-mode=mod
grep -rn "16\.98\|533\.65\|16\.05" --include="*_test.go" services/xstockstrat-portfolio   # expect no redeclared literals
```
New logic is in an excluded package (`service/`), so no coverage threshold applies to it. Confirm the total stays
≥ 40%. RED before Step 11:
- AC-1 reads 8.025 from the one-sided average;
- AC-14 row 2 reads 8.025 (`context.md` R10 note);
- AC-2 re-quotes MSFT;
- AC-3 overwrites LYFT;
- AC-8 persists a partial snapshot;
- AC-9 emits concentration alerts.

---

### Step 13 — docs: key rows, invariants, findings, and the context-forge teardown

**Status**: `pending`
**Service**: `docs` (+ service `CLAUDE.md` / `docs/` files)
**Files**:
- `services/xstockstrat-marketdata/CLAUDE.md` — modify
- `services/xstockstrat-portfolio/CLAUDE.md` — modify
- `docs/patterns/config-governance.md` — modify
- `services/xstockstrat-marketdata/docs/context-constitution-findings.md` — modify
- `services/xstockstrat-portfolio/docs/context-constitution.md` — modify
- `services/xstockstrat-portfolio/docs/context-constitution-findings.md` — modify
- `docs/patterns/test-data-inventory.md` — modify
- `docs/roadmap/features/merge-order.md` — modify

**Reviewers**: none

**Codebase Evidence** (rebase onto `origin/main-dev` first; the two `docs/` files there differ from this branch):
- marketdata `CLAUDE.md`:
  - `## Config Keys Consumed`: the `marketdata.quotes.batch_timeout_ms` row (:74) ends "Must stay below
    `portfolio.marketdata.quote_timeout_ms` minus the warm read";
  - the `GetLatestQuotes (batch, feature 178)` bullet is in `## Alpaca Integration` (:217).
- portfolio `CLAUDE.md`:
  - the "Quote-dependent reads are bounded and never fabricate (feature 229)" paragraph (:24-30) says
    "`broadcastSnapshot` skips persisting/emitting when quotes are unavailable or no position was priced";
  - the `portfolio.marketdata.quote_timeout_ms` row (:93) says "Must exceed `marketdata.quotes.batch_timeout_ms`
    (2500) plus the warm read".
- `docs/patterns/config-governance.md` § Per-Feature Registered Keys (:105, newest first); the 229 entry is at :109.
- portfolio findings (`origin/main-dev`) § Latent bugs: the row "**Snapshot-equity / risk value-parity break**:
  `broadcastSnapshot` and `checkRiskLimits` recompute market value from mid-quotes…".
- portfolio constitution (`origin/main-dev`):
  - PORTFOLIO-1 says "only fall back to a marketdata mid-quote for un-valued rows";
  - § Gotchas & scars: "**Two compute paths never got migrated to broker-authoritative valuation**".
- `StartSnapshotWriter` (`portfolio_service.go:812-825`) has no caller: grep `StartSnapshotWriter` in
  `services/xstockstrat-portfolio` → only its definition. Snapshots run only per fill (`:370-371`).
- `.agents/context-forge.json` `scrubberExtraTargets` is `["README.md", "docs/patterns/ui-ux-governance.md"]`; neither
  is touched by this feature.

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. **marketdata `CLAUDE.md`**:
   - Add rows after :74 for:
     - `marketdata.quotes.mark_timeout_ms` (int, `500`, `[100,2500]`): the per-caller budget of the close lookup,
       which runs concurrently with the cold fetch; on failure two-sided marks are kept, one-sided marks stay unset,
       and a WARN `GetLatestQuotes: mark lookup failed` is logged;
     - `marketdata.quotes.mark_close_max_age_hours` (int, `168`, `[120,720]`): the staleness bound on the stored 1d
       close used as the mark. The floor of 120 exists because bars are stamped 00:00 ET.
     Use the :74 row's "Read live per call; `≤ 0` or no watcher → default. Unseeded" wording.
   - Amend :74's invariant to "must stay below `portfolio.marketdata.quote_timeout_ms` minus the warm read, together
     with `mark_timeout_ms` (bound = max of the two)".
   - Extend the :217 `GetLatestQuotes` bullet with one sentence on `mark_price`: two-sided mid, else the newest
     stored 1d close inside the bound, else unset; computed only here, not by `GetLatestQuote` or `StreamQuotes`.
   - Add one sentence to the "**Snapshot serving source is switchable (feature 211)**" paragraph (:140): the EDGAR
     price is the quote mark, else the filed-date
     close, which is served uncached.
   - Name the accepted risks in one short line each: the weekend first-query gap; `adjustment=all` back-adjusted
     closes on ex-dates; and a lag of up to ~5 min right after the close.
2. **portfolio `CLAUDE.md`**:
   - In :24-30, replace the snapshot clause with: positions are valued broker-first, then by the marketdata
     `mark_price`, then by the two-sided mid; the snapshot **and the concentration check** are skipped (with a WARN
     naming the symbols) when **any** position is unpriced; drawdown is unaffected. Add the operator-accepted
     consequence: a permanently unpriceable holding stops that user's snapshots and concentration checks.
   - Amend the :93 invariant to "must exceed max(`marketdata.quotes.batch_timeout_ms`,
     `marketdata.quotes.mark_timeout_ms`) plus the warm read".
3. **`docs/patterns/config-governance.md`**: add `### feature 231 — fix-after-hours-positions-priced
   (xstockstrat-marketdata / xstockstrat-config)` **above** the 229 entry (:109). Include:
   - the 2-key table (type, default, bounds, notes);
   - the 227/229 unseeded waiver;
   - the timeout relationship from item 2.
4. **marketdata findings**: add to § Open questions: "Do IEX daily bars include extended-hours prints? (feature 231
   uses the stored 1d close as the after-hours mark)", status **open**, with evidence
   `internal/service/marketdata_service.go#GetLatestQuotes` and `internal/repository/marketdata_repo.go#GetLatestDailyClosesBatch`.
5. **portfolio constitution and findings**:
   - Rewrite PORTFOLIO-1's fallback clause: un-valued rows use `markOf` (marketdata `mark_price`, else the two-sided
     mid; one-sided quotes are never averaged). Name `broadcastSnapshot` and `checkRiskLimits` as users of the same
     helpers (feature 231).
   - Mark the § Gotchas "Two compute paths…" scar and the findings "Snapshot-equity / risk value-parity break" row
     **RESOLVED 2026-10-19 (feature 231)**. Both now go broker-first, skip on any unpriced position, and
     concentration sums across accounts.
   - Add a § Dead / orphaned code row: `StartSnapshotWriter` has no caller; snapshots are per-fill only
     (`portfolio_service.go#StartSnapshotWriter`, `#processOrderFill`).
6. **`docs/patterns/test-data-inventory.md`**: change the Go row (:82, "Not materialized — on second consumer
   only") to "Materialized in trading, marketdata, portfolio (feature 231)". Trading's
   `internal/testdata/order_rows.go` already exists, so the row is pre-existing drift; Steps 6 and 12 add the other
   two homes.
7. **portfolio findings**: add a doc-drift row for `packages/proto/portfolio/v1/portfolio.proto:81` ("positions
   enriched from marketdata mid-quotes"), now mark-valued. It is left unedited because Step 3 forbids other proto
   edits.
8. **`docs/roadmap/features/merge-order.md`**: add a soft (non-blocking) WARN note. 231 and
   `230-offline-account-full-pnl` (`ccr-cd56ff4d-s5wkbb`) both touch `applyQuotes`, `enrichPosition` and
   `broadcastSnapshot` in `portfolio_service.go`; whichever lands second reconciles onto `markOf` and
   `enrichPosition(p, price)`.
9. **Teardown (root `CLAUDE.md` § Teardown).** Run `/context-forge:context-constitution refresh`, scoped to the files
   above and the changed services (marketdata, portfolio, config), and fix the grounded drift. If the plugin is
   unavailable, re-read each touched context file against the code by hand. Record both facts (plugin unavailable,
   and the manual reconciliation done) in the integration PR body and in `context.md`.

**Verification**:
```bash
grep -n "mark_timeout_ms\|mark_close_max_age_hours\|mark_price" services/xstockstrat-marketdata/CLAUDE.md
grep -n "mark_timeout_ms\|any position is unpriced\|concentration" services/xstockstrat-portfolio/CLAUDE.md
grep -n "feature 231" docs/patterns/config-governance.md
grep -n "StartSnapshotWriter\|feature 231" services/xstockstrat-portfolio/docs/context-constitution-findings.md
grep -n "extended-hours" services/xstockstrat-marketdata/docs/context-constitution-findings.md
grep -n "feature 231" docs/patterns/test-data-inventory.md docs/roadmap/features/merge-order.md
```

---

## Deviation Log

### D-1 — Steps 3–4: host-native codegen toolchain instead of the Docker image
- **Spec said**: prefer the version-pinned `Dockerfile.codegen` image (`./scripts/localenv-setup.sh`).
- **Actual**: the image build failed twice with Docker Hub `429 Too Many Requests` on `golang:1.27-trixie`. I used
  the sanctioned host-native fallback (`docs/runbooks/codegen-toolchain-host-setup.md`):
  - buf 1.72.0 from GitHub releases;
  - protoc-gen-go 1.36.11, protoc-gen-go-grpc 1.6.2 and protoc-gen-connect-go 1.19.2;
  - ts-proto 2.11.8, protoc-gen-es 2.12.0, protoc-gen-connect-es 1.7.0, grpcio-tools 1.80.0, and
    `gen/ts` `pnpm install`.
  The plugins were first built with go1.24.7. That reflowed the doc comments in `analysis.pb.go`, so the baseline
  was not clean. Rebuilding them with `GOTOOLCHAIN=go1.27.0`, matching CI `proto-freshness`
  (`setup-go 1.27`) and `FROM golang:1.27-trixie`, gave an empty baseline diff, validated before the proto edit.
  The local `main-dev` ref was stale (`09ec8d9a`), so I moved it to `origin/main-dev` to give the `buf-gen.sh`
  breaking guard a current baseline.
- **Disposition**: CI-equivalent fallback (sequential mode). CI `proto-freshness` re-verifies the stubs.

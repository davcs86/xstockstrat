# Implementation Spec: fix-getpnl-source-service

**Status**: `pending`
**Created**: 2026-10-21
**Feature**: `docs/roadmap/features/251-fix-getpnl-source-service/feature.md`
**Total Steps**: 14
**Feature Branch**: `feature/fix-getpnl-source-service`

---

## Execution Summary

This spec follows the build order in design.md §7. The ledger goes first (Steps 1-3): a behaviour-preserving
extraction into `queryEventsPage.ts`, then RED unit and real-PG tests, then the keyset `page_token` fix. Without it,
FR-1 turns GetPnL's page loop into a page-1 replay (recon.md "Latent: GetPnL pagination loops").

Trading follows (Steps 4-5): an additive `side` key on both fill payloads.

Portfolio comes next (Steps 6-9):
- the shared request-honouring ledger fake, the `export_test.go` shim and the RED GetPnL fold tests;
- the GetPnL rewrite (FR-1, FR-2, FR-4, FR-5);
- the RED adapter and error-mapping tests;
- the ctx-first `classifyGetPnLError` and `toGRPCError` change.

The UI then gets the user-pinned lineage and BFF backstop (Steps 10-11). Teardown docs (Step 12), the
merge-order/252 reconciliation (Step 13) and the post-deploy ship gate plus dev smoke (Step 14) close it out.

Every code-bearing step has a paired test step written to fail first (P-06, C-08). Pairing:
- Step 2 [test] covers Steps 1 and 3 [service]: RED against the Step 1 extraction, GREEN after Step 3.
- Step 4 [test] → Step 5 [service].
- Step 6 [test] → Step 7 [service].
- Step 8 [test] → Step 9 [service].
- Step 10 [test] → Step 11 [service].

There are no proto, migration or config steps (design.md §Chosen Approach; product-spec Fix Scope). The PLAT-10
`buf breaking --against '<repo-root>/.git#branch=feature/fix-getpnl-source-service,subdir=packages/proto'` gate
therefore does not apply. Any step that touches a `.proto` is a deviation and must stop (P-03).

**Consumer surfaces (C-14).**
- `/trader/positions` fill-lineage sheet: Steps 10-11.
- `GetPnL` RPC: internal/platform-only. Re-confirmed 2026-10-21: no `GetPnL`/`getPnL` hit under
  `services/xstockstrat-ui/src` or `services/xstockstrat-agent/app`, and the only non-generated Go references are
  `services/xstockstrat-portfolio/internal/handler/portfolio_handler.go` and `internal/service/portfolio_service.go`.
- Agent: none.

**Design drift resolved here (P-03).**
- design.md:17 says "no … ci.yml change", but design.md §1 (:45-47) and context.md Open Threads add the
  `ledger-pg-test` CI job. This spec follows §1: `.github/workflows/ci.yml` is in Step 2's Files. The COVERPKGS
  exclusion stays unchanged (design.md §6E).
- design.md §3 says `toGRPCError` should mirror "`trading.go:223-238`". That file is
  `services/xstockstrat-trading/internal/handler/trading.go:223-238`, not `internal/service/trading.go`. The handler
  covers FailedPrecondition only, so DeadlineExceeded/Canceled have no in-repo precedent and are added explicitly.
- design.md §2 and §6 cite an "extended source-service parity test". **Not found**: no such test exists in
  portfolio (grep `Parity|SourceService` over `internal/**/*_test.go`). Step 6 creates it as a two-half parity, the
  precedent being `internal/service/pnl_fold_test.go:10-14`. The portfolio half asserts const = testdata value =
  literal. The trading half (Step 4) asserts the recorded `SourceService`. Go modules cannot import each other
  (`GOWORK=off`).

### Scenario Coverage (C-15)

| Scenario | Covered by |
|---|---|
| AC-1 unsigned sell folds (500) | Step 6 |
| AC-2 partial sell folds (200) | Step 6 |
| AC-3 lineage lists own fills, no u-2 | Step 10 |
| AC-4 unresolved side → FAILED_PRECONDITION | Step 6 (service sentinel), Step 8 (wire case 1) |
| AC-5 other user's orphan fill, zero lookups | Step 6 |
| AC-6 read failure mid-drain → UNAVAILABLE | Step 6, Step 8 (wire case 2) |
| AC-7 deadline / cancel codes | Step 8 (wire cases 3, 4; `TestClassifyGetPnLError`) |
| AC-8 replaying ledger → UNAVAILABLE | Step 6 |
| AC-9 501 fills, 2 calls | Step 6 (drain test) |
| AC-10 producer `side` + source + fees | Step 4 |
| AC-11 payload-side fill, no lookup | Step 6 |
| AC-12 ledger exactly-once incl. ties | Step 2 (real-PG) |
| AC-13 malformed token → INVALID_ARGUMENT | Step 2 (unit + real-PG) |
| AC-14 cross-account (500) | Step 6 |
| AC-15 mixed-era → FAILED_PRECONDITION | Step 6 |
| AC-16 sequence-ordered fold (F1, F2) | Step 6 |
| AC-17 partial-then-filled folds once | Step 6 |
| AC-18 LIVE excluded (GetPnL + lineage) | Step 6 (GetPnL half), Step 10 (lineage half) |
| AC-19 lineage beyond first platform page | Step 10 |
| AC-20 BFF drops other users' fill events | Step 10 |
| AC-21 50-order cap + notice | Step 10 |
| AC-22 stale-status order still listed | Step 10 |
| durable portfolio @AC-5 @feature-229 (EXTEND) | Step 8 (wire case 7 + `TestClassifyGetPnLError` rows) |
| durable platform @AC-7 @feature-127 (PRESERVE) | Step 8 (wire case 5) |
| durable platform @AC-10 @feature-029 (PRESERVE, `fees` kept) | Step 4 |

## Step Dependencies

- Step 2 requires Step 1. The RED tests import `src/grpc/queryEventsPage.ts`, which Step 1 creates with today's
  semantics, so they fail on behaviour, not on import (design.md §1 "RED").
- Step 3 requires Step 2 (GREEN target).
- Step 5 requires Step 4 (RED).
- Step 6 requires nothing at runtime: its fake ignores the real ledger. It is ordered after Step 3 so the
  fake's paging contract matches the shipped ledger (design.md §6A).
- Step 7 requires Step 6 (RED). Step 9 requires Step 8 (RED), and Step 8 requires Step 7: wire cases 1-4 drive
  the rewritten GetPnL.
- Step 9's arity change (`classifyGetPnLError(ctx, err)`) compiles only with `portfolio_handler.go:96` and
  `portfolio_handler_test.go:40`, `:43` updated together. Step 8 changes the test calls; Step 9 changes `:96` and
  `:425`. The Step 8 RED is a compile failure for those rows, which is accepted (precedent `trading_fees_test.go`
  "compile-level RED").
- Step 11 requires Step 10 (RED). Step 10's mock and fixture changes ship in Step 10.
- Step 12 (teardown) requires Steps 1-11. Step 13 runs at the integration PR. Step 14 runs only after trading
  `side` is live on dev (design.md §7) and blocks promotion.
- **Overlap.** `ledgerServiceImpl.test.ts` is shared with 252-fix-identity-ledger-test-suites (status `draft`).
  Step 2 edits it under the existing `if (!impl) return;` guards. Step 13 adds the soft merge-order row and the
  252 context note.
- **C-16 promotion.** AC-1..AC-22 are promoted into the durable suites (`services/xstockstrat-portfolio/acceptance/`,
  `services/xstockstrat-ledger/acceptance/`, `services/xstockstrat-trading/acceptance/`,
  `services/xstockstrat-ui/acceptance/`) by `/sdd-execute`'s integration PR, not by a step here. The portfolio
  @AC-5 backing header (`services/xstockstrat-portfolio/acceptance/fix-book-portfolio-page.feature:6-8`) stays
  accurate because `TestClassifyGetPnLError` keeps its name.
- **Deferred follow-ups (C-10/C-14).** `docs/reports/2026-10-21-portfolio-live-fold-sell-sign-loss-defect.md` and
  `docs/reports/2026-10-21-trading-bracket-leg-fills-missing-from-realized-pnl-defect.md` (both `open`) stay
  outside 251.

---

### Step 1 — service: extract ledger QueryEvents into a strip-safe `queryEventsPage.ts` (behaviour-preserving)

**Status**: `pending`
**Service**: `xstockstrat-ledger`
**Files**:
- `services/xstockstrat-ledger/src/grpc/queryEventsPage.ts` — create
- `services/xstockstrat-ledger/src/grpc/ledgerServiceImpl.ts` — modify

**Reviewers**: `xstockstrat-ledger` owner — append-only invariant (no deletes or updates), event ordering, hypertable
partition safety

**Codebase Evidence**:
- `queryEvents` lives at `services/xstockstrat-ledger/src/grpc/ledgerServiceImpl.ts:124-176`.
  - The predicate builder is at `:126-153`: `stream_key` `:130-132`, `event_type` `:134-137`, `source_service`
    `:138-141`, `occurred_at` `:143-150`, `sequence >=` `:151-153`.
  - Limit is `req.page?.pageSize || 100` (`:157`), fetched as limit+1.
  - The query is `SELECT * FROM ledger.events ${where} ORDER BY recorded_at ASC LIMIT $${p}` (`:162`).
  - `nextPageToken` = the last `event_id` when `hasMore`; `totalCount: rows.length` (`:171`).
  - Errors are `callback({ code: 13, message: err.message })` (`:173-174`).
  - grep `pageToken|page_token` over `services/xstockstrat-ledger/src` finds only the response line, so the
    request token is never read.
- `rowToEvent` is exported at `ledgerServiceImpl.ts:364-378` and stays there (overlap with 248, design.md §1).
- The class uses TS parameter properties (`ledgerServiceImpl.ts:20-25`), so this file cannot load under
  `--experimental-strip-types` (fails.md:1942-1953). A new module must avoid enums, parameter properties,
  namespaces and relative runtime imports (`import type` only; fails.md:2239-2241).
- The strip-loaded test precedent `src/__tests__/mtls.test.ts:13` imports `'../mtls.ts'` with the `.ts` extension.
  `tsconfig.json` excludes `src/**/*.test.ts`.
- Callers that send `page_token` (grep 2026-10-21): only portfolio `GetPnL` (`portfolio_service.go:754`, `:799`).
  - UI `CopilotRail.tsx:65`, `PerformanceDashboard.tsx` and `useReconciliationStatus.ts` send `pageToken: ''`.
  - Trading `trading.go:2222` and portfolio `HydrateStops` (`portfolio_service.go:534`) send no page.

**TDD**: `red-green required`. This step is the behaviour-preserving extraction the Step 2 RED runs against. RED is
captured at Step 2, GREEN at Step 3.

**Covers**: —

**Instructions**:
1. Create `src/grpc/queryEventsPage.ts`. Its only import is `import type { Pool } from 'pg';`. Export:
   - `queryEventsPage(pool: Pool, req: any): Promise<{ rows: any[]; page: { nextPageToken: string; totalCount: number } }>`.
     It holds the predicate builder moved verbatim from `ledgerServiceImpl.ts:126-156` and today's SQL from `:162`.
     It returns the full `page` object exactly as `:171` builds it.
   - `queryEventsErrorStatus(err: unknown): { code: number; message: string }`. Today it always returns code 13
     with `err.message`.
2. Reduce `queryEvents` (`ledgerServiceImpl.ts:124-176`) to a thin delegate:
   `const { rows, page } = await queryEventsPage(this.pool, call.request); callback(null, { events: rows.map(rowToEvent), page });`
   inside `try`, with `catch (err) { callback(queryEventsErrorStatus(err)); }`.
3. Use no enum, parameter property or namespace, and no relative runtime import in `queryEventsPage.ts`.

**Verification**:
```bash
cd services/xstockstrat-ledger && pnpm run build && pnpm run lint && pnpm run test:coverage
node --experimental-strip-types -e "import('./src/grpc/queryEventsPage.ts').then(m => { if (typeof m.queryEventsPage !== 'function') process.exit(1) })"
```
The strip-load check must exit 0.

---

### Step 2 — test: ledger keyset paging RED (unit + real-PG) and the `ledger-pg-test` CI job

**Status**: `pending`
**Service**: `xstockstrat-ledger`
**Files**:
- `services/xstockstrat-ledger/src/__tests__/queryEventsPage.test.ts` — create
- `services/xstockstrat-ledger/src/__tests__/pg/queryEventsKeyset.test.ts` — create
- `services/xstockstrat-ledger/src/__tests__/ledgerServiceImpl.test.ts` — modify
- `.github/workflows/ci.yml` — modify

**Reviewers**: `xstockstrat-ledger` owner — append-only invariant (no deletes or updates), event ordering, hypertable
partition safety

**Codebase Evidence**:
- `test:coverage` runs `c8 … --lines 40 node --experimental-strip-types --test src/__tests__/*.test.ts`
  (`services/xstockstrat-ledger/package.json`). The glob does not descend into `src/__tests__/pg/`, so the real-PG
  test runs only in the new CI job.
- `ledgerServiceImpl.test.ts`:
  - The guarded lazy import is at `:21-29`; the tests skip when the import throws (fails.md:1942).
  - `makeRow` is at `:88-103` and has no `cursor_us`.
  - The hasMore case (`:172-187`) asserts only `nextPageToken !== ''` (`:183`).
  - The totalCount case is at `:208-221`.
- Hypertable: `recorded_at` partition column, `PRIMARY KEY (event_id, recorded_at)`
  (`services/xstockstrat-ledger/migrations/001_ledger_events_hypertable.up.sql:22`, `:27-29`). `(recorded_at,
  event_id)` is therefore unique, which is the cursor-uniqueness argument (insights.md:3547-3549).
- `appendEvent` stamps `recorded_at` from JS `new Date()` (`ledgerServiceImpl.ts:35`, `:56`), so production rows
  have ms precision.
- CI precedents in `.github/workflows/ci.yml`:
  - `migration-rerun` job at `:633-669`: TimescaleDB service `timescale/timescaledb:latest-pg16` (`:640-653`),
    migrator image `scripts/Dockerfile.migrate` (`:657-658`), `SEED_USER_ID="00000000-0000-4000-8000-0000000000c1"`
    (`:667`).
  - `ci-gate` `needs:` list at `:773-788`, echo block `:792-807`.
  - `changes` filter `xstockstrat-ledger: ['services/xstockstrat-ledger/**']` (`:60`).
  - `node-test` Node setup at `:566-580` (pnpm 9.15.9, node 24).
- `scripts/db-migrate.sh` applies all pending migrations with no argument (`scripts/db-migrate.sh:8-9`).

**TDD**: `red-green required`. RED against the Step 1 extraction, GREEN after Step 3.

**Covers**: `AC-12, AC-13`

**Instructions**:
1. `queryEventsPage.test.ts` is unguarded: a plain top-level
   `import { queryEventsPage, queryEventsErrorStatus } from '../grpc/queryEventsPage.ts';` with no try/catch. It uses
   a capturing fake pool `{ query: async (sql, params) => ({ rows }) }`. Assert:
   - (a) A request with no token emits `ORDER BY recorded_at ASC, event_id ASC` and selects a `cursor_us` column.
   - (b) With limit+1 rows, `page.nextPageToken` is non-empty and decodes (base64url) to
     `<last.cursor_us>.<last.event_id>` of the last returned row, not the over-fetched row.
   - (c) Feeding that token back adds the keyset predicate
     `recorded_at >= $n AND (recorded_at > $n OR event_id > $m::uuid)`, and the params carry the decoded
     microseconds and id (AC-12 unit half).
   - (d) The malformed tokens `'not-base64!'`, a base64url of `'abc'` and a base64url of `'1.notauuid'` make
     `queryEventsPage` reject, and `queryEventsErrorStatus` of that rejection returns `code: 3` (AC-13).
   - (e) `queryEventsErrorStatus` maps a PG error with `code` `22007`, `22008` or `22P02` to 3, and anything else
     to 13.
   - (f) `page.totalCount` equals the rows returned.
   - Name each `it` with its `@AC-*`.
2. `pg/queryEventsKeyset.test.ts`:
   - If `process.env.LEDGER_PG_TEST_URL` is unset, throw `Error('LEDGER_PG_TEST_URL is required')` at the top
     level. It fails, it does not skip.
   - Insert 7 rows into `ledger.events` with one explicit `recorded_at`, a run-unique `source_service`
     (`pg-test-<uuid>`) and `event_type` `pg.test`. Also insert rows split across two `recorded_at` values a month
     apart (separate chunks), plus 3 rows sharing one millisecond.
   - Drain `queryEventsPage(pool, {sourceService, eventType, page: {pageSize: 3, pageToken}})` under an iteration
     cap of 20.
   - Assert ≥ 2 pages, each inserted `event_id` exactly once, in `(recorded_at, event_id)` order (AC-12). Assert a
     malformed token returns `code: 3` through `queryEventsErrorStatus` (AC-13).
   - Scope every read by the run-unique `source_service`. The ledger's `deny_mutation` trigger blocks cleanup, so
     isolation comes from the unique source.
3. `ledgerServiceImpl.test.ts` (B8, design.md §1). `makeRow` (`:88-103`) gains `cursor_us: '1704067200000000'`.
   The hasMore case (`:172-187`) decodes `resp.page.nextPageToken` and asserts it equals
   `1704067200000000.<rows[1].event_id>`. Both stay behind `if (!impl) return;` until 252 lands (accepted
   residual).
4. `.github/workflows/ci.yml`: add job `ledger-pg-test`.
   - `needs: changes`; `if:` matched `xstockstrat-ledger` or `ci`.
   - The `timescaledb` service block is copied from `:640-653`.
   - Steps: checkout; build `scripts/Dockerfile.migrate`; run `scripts/db-migrate.sh` in the migrator container
     with `DATABASE_URL=postgres://xstockstrat:ci-only@localhost:5432/xstockstrat?sslmode=disable` and the
     `:667` `SEED_USER_ID`.
   - Then pnpm/node setup as `node-test` `:566-580`, `pnpm --filter @xstockstrat/proto run build`, and in
     `services/xstockstrat-ledger` run `node --experimental-strip-types --test src/__tests__/pg/queryEventsKeyset.test.ts`
     with `LEDGER_PG_TEST_URL` set to the same URL.
   - Add `ledger-pg-test` to `ci-gate.needs` (`:773-788`) and an echo line in `:792-807`.

**Verification**:
```bash
cd services/xstockstrat-ledger && pnpm run lint
node --experimental-strip-types --test src/__tests__/queryEventsPage.test.ts   # RED now (Step 1 semantics); GREEN after Step 3
node --experimental-strip-types --test src/__tests__/pg/queryEventsKeyset.test.ts; test $? -ne 0   # unset URL → fails, not skips
cd ../.. && grep -n "ledger-pg-test" .github/workflows/ci.yml   # job key, ci-gate needs entry, echo line (≥ 3 hits)
```
CI `ledger-pg-test` on the step PR: RED at this step (page 2 repeats page 1), GREEN after Step 3.

---

### Step 3 — service: ledger keyset `page_token` (FR-5)

**Status**: `pending`
**Service**: `xstockstrat-ledger`
**Files**:
- `services/xstockstrat-ledger/src/grpc/queryEventsPage.ts` — modify

**Reviewers**: `xstockstrat-ledger` owner — append-only invariant (no deletes or updates), event ordering, hypertable
partition safety

**Codebase Evidence**:
- The Step 1 module (`src/grpc/queryEventsPage.ts`) holds today's SQL (`ledgerServiceImpl.ts:162` moved).
- `PageRequest.page_token` arrives as `req.page.pageToken` (the request shape `req.page?.pageSize`,
  `ledgerServiceImpl.ts:157`). `QueryEventsRequest.page = 5` (`packages/proto/ledger/v1/ledger.proto:65`).
- `rowToEvent` (`ledgerServiceImpl.ts:364-378`) maps named columns only, so an extra `cursor_us` column is ignored.

**TDD**: `red-green required`. GREEN for Step 2.

**Covers**: `AC-12, AC-13`

**Instructions**:
1. SELECT `*, (extract(epoch from recorded_at) * 1000000)::bigint AS cursor_us`, then
   `ORDER BY recorded_at ASC, event_id ASC`.
2. Cursor: opaque base64url of `<cursor_us>.<event_id>`, built from the last returned row.
   - Decode a request `page.pageToken`: base64url → split on the first `.`. Require an integer microsecond string
     (`/^\d+$/`) and a UUID-shaped id; else throw an exported `class InvalidPageTokenError extends Error`.
   - Append `recorded_at >= $ts AND (recorded_at > $ts OR event_id > $id::uuid)`, where
     `$ts = 'epoch'::timestamptz + $us * interval '1 microsecond'`. Never use `to_timestamp(double)`.
3. Encoding: if `cursor_us` is missing or not a decimal string, throw a plain `Error`, which maps to 13.
4. `queryEventsErrorStatus`: `InvalidPageTokenError`, PG `22007`, `22008` and `22P02` map to code 3. Anything else
   maps to 13.
5. Keep the module strip-safe (Step 1 constraint 3).

**Verification**:
```bash
cd services/xstockstrat-ledger && pnpm run build && pnpm run lint && pnpm run test:coverage
node --experimental-strip-types --test src/__tests__/queryEventsPage.test.ts   # GREEN
```
- CI `ledger-pg-test` must be GREEN.
- Record a one-off compiled run in context.md as evidence, not a CI guard (design.md §1 B8): a scratch tsconfig
  excluding `mtls.test.ts` and `queryEventsPage.test.ts`, then `tsc -p`, a `node -e` import of the compiled impl, and
  `node --test` on the compiled `ledgerServiceImpl.test.js`. Record pass or fail (design.md Open Risks: unverified
  against the ledger's module settings).

---

### Step 4 — test: trading fill payloads carry `side`, the canonical source and `fees` (RED)

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/service/trading_fill_side_test.go` — create

**Reviewers**: `xstockstrat-trading` owner — order execution correctness, broker API safety, fill detection, paper-only
dev invariant, position limit enforcement

**Codebase Evidence**:
- Fill emits live in `applyBrokerOrderStatus` (`services/xstockstrat-trading/internal/service/trading.go:1772`):
  - `order.filled` at `:1805-1812`: keys `order_id`, `symbol`, `qty`, `fill_price`, `user_id`, `trading_mode`,
    `account_id`, `fees`. No `side`.
  - `order.partially_filled` at `:1822-1829`, with `filled_qty`.
  - Both are fired with `go s.emitLedgerEvent(...)`.
- `emitLedgerEvent` (`:3661-3674`) stamps `SourceService: "xstockstrat-trading"` (`:3667`) and
  `StreamKey: streamKey` (`:3668`, the bare `order.OrderId`).
- Drive path: `reconcileNotCancelable` (`:1381-1395`) calls `applyBrokerOrderStatus` at `:1394`.
  - Fixture `notCancelableSvc` (`trading_cancel_not_cancelable_test.go:22-35`) builds order `ord-1`, `Qty: 10` on
    `acct-1` (ALPACA), with `ledger: &fakeLedgerClient{}`.
  - Driver precedent `TestCancelOrder_NotCancelable_BrokerFilled_AdoptsFillNotCanceled` (`:39-73`).
  - Broker status string `"partially_filled"` (`trading.go:3636`; precedent `trading_order_race_test.go:17`).
- Recorder: `recordingLedger` / `requestsByType` (`trading_offline_test.go:60-94`).
- Async wait precedent: `waitForAlert` (`trading_bracket_test.go:397-408`).
- `trading_fees_test.go:20-50` and `trading_ledger_userid_test.go:23` copy the payload map by hand, so they cannot
  catch a producer regression (recon.md Patterns to REUSE). They are not extended.

**TDD**: `red-green required`

**Covers**: `AC-10` (and durable platform @AC-10 @feature-029: `fees` kept)

**Instructions**:
1. Add `TestFillEmit251_AC10_CarriesSideSourceAndFees`, table-driven over
   `{"filled", 10, "order.filled", "qty"}` and `{"partially_filled", 4, "order.partially_filled", "filled_qty"}`.
   Each row:
   - Build `svc, order := notCancelableSvc(fb, nil)`, set `order.Side = tradingv1.OrderSide_ORDER_SIDE_SELL` and
     `order.Symbol = "AAPL"`, and replace `svc.ledger` with `rec := &recordingLedger{}`.
   - The `fb.getOrderFn` returns the row's status and `FilledQty`.
   - Call `svc.CancelOrder(ctxAsUser("user-1"), &tradingv1.CancelOrderRequest{OrderId: "ord-1"})`.
   - Poll `rec.requestsByType(eventType)` for up to 2s (the `waitForAlert` shape) until one request appears.
   - Assert `SourceService == "xstockstrat-trading"` (the trading half of the Step 6 parity test) and
     `StreamKey == "ord-1"`.
   - Assert the payload `side == "ORDER_SIDE_SELL"`, the row's qty key equals the unsigned value, and the `fees`
     key is present.
2. C-13: the order literal comes from `notCancelableSvc` (existing). The test adds no second inline domain literal.

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off go test ./internal/service/ -run TestFillEmit251_AC10 -race -count=1 -v   # RED (no side key)
GOWORK=off golangci-lint run --modules-download-mode=mod
grep -rn "func notCancelableSvc" --include="*_test.go" internal/service   # 1 declaration site (C-13)
```

---

### Step 5 — service: trading adds `side` to both fill payloads

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/service/trading.go` — modify

**Reviewers**: `xstockstrat-trading` owner — order execution correctness, broker API safety, fill detection, paper-only
dev invariant, position limit enforcement

**Codebase Evidence**:
- `trading.go:1805-1812` and `:1822-1829` (fill payload maps). `order` is `*tradingv1.Order` (`:1772`), so
  `order.Side` is in scope.
- `order.created` and `order.submitted` already emit `"side": order.Side.String()` (`:650`, `:666`).
- Trading-domain constraints (`step-constraints.md` §A):
  - Broker coverage: fills reach the ledger only via `applyBrokerOrderStatus` for ALPACA and IBKR alike (callers
    `pollFills` `:1713`/`:1766`, `reconcileNotCancelable` `:1394`). OFFLINE accounts never emit fills
    (`:1715-1721`).
  - Fill state: both `FILLED` and `PARTIALLY_FILLED` branches are changed.
  - Order type, trading-mode gate and order placement are unaffected (no `PlaceOrder` path is touched).

**TDD**: `red-green required`. GREEN for Step 4.

**Covers**: —

**Instructions**:
1. In both branches, lift the payload map to a local `payload := map[string]interface{}{…}` (keys unchanged,
   `fees` kept). Then `if order.Side != tradingv1.OrderSide_ORDER_SIDE_UNSPECIFIED { payload["side"] = order.Side.String() }`,
   then `go s.emitLedgerEvent(context.Background(), "<type>", order.OrderId, order.UserId, payload)`.
2. `emitLedgerEvent` (`:3661`) stays unchanged. Persisted `filled_qty` and the reconciliation path are untouched
   (trading `@AC-1` @feature-206 PRESERVE).

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off go test ./internal/service/ -run 'TestFillEmit251_AC10|TestCancelOrder_NotCancelable|TestFillEmitsCarryBrokerFees' -race -count=1
GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"   # ≥ 40%
GOWORK=off golangci-lint run --modules-download-mode=mod
grep -n '"side"' internal/service/trading.go   # hits at the two fill emits plus :650, :666
```
New logic is in the `service` package, which is excluded from COVERPKGS, so the total is unaffected. The Step 4 test
is the gate.

---

### Step 6 — test: portfolio ledger fake, test shim and RED GetPnL fold tests

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/testdata/ledger.go` — create
- `services/xstockstrat-portfolio/internal/service/export_test.go` — create
- `services/xstockstrat-portfolio/internal/service/portfolio_quote_deadline_test.go` — modify
- `services/xstockstrat-portfolio/internal/service/getpnl_source_parity_test.go` — create

**Reviewers**: `xstockstrat-portfolio` owner — P&L calculation accuracy, position snapshot consistency, concurrent write
safety

**Codebase Evidence**:
- Go fixture home `internal/testdata/` holds `marks.go` and `offline_pnl.go`. `offline_pnl.go` imports only
  protobuf, marketdatav1 and `internal/marketsession`, never `internal/service`; it is the no-cycle precedent.
- `newQuoteSvc` (`internal/service/portfolio_quote_deadline_test.go:93-112`) builds `PortfolioService{repo, marketdata,
  ledger: &fakeLedger{}, subs}` over `pgxmock` with `MatchExpectationsInOrder(false)`.
- `guard` is at `:70-82` (5s hang guard). `posRow` (`:84-87`); `pnlRows` (`:263-266`).
- `TestGetPnL_AC5_QuotesUnavailable` (`:268-291`, feature 229) and `TestGetPnL_AC6_BrokerValuedWithoutQuoteFetch`
  (`:293-306`) are the GetPnL tests in this file. Positions are mocked via
  `mock.ExpectQuery(\`FROM portfolio.positions\`).WithArgs(anyArgs(3)...)`.
- `anyArgs` is at `portfolio_fill_errors_test.go:36`, `positionCols` at `:45`, and in-package `fillEvent` at `:24`.
  `fillEvent` is the live-fold shape and stays inline (design.md §6A).
- `fakeLedger` (`watchlist_service_test.go:254-272`): its `QueryEvents` ignores the request (`:269-271`).
  `ctxWithUser` is at `:280-292`, `newFakeStore` at `:37`, `wideCaps` at `:362`.
- `stopLedger` (`portfolio_risk_test.go:143-150`) returns `f.events` regardless of request. It is reviewed and
  unchanged.
- `stubMarketData` (`portfolio_service_test.go:18`). A zero-value `&stubMarketData{}` answers `GetLatestQuotes` with
  no quotes (`:53-63`).
- `LedgerEvent.sequence = 9` is global-monotonic (`packages/proto/ledger/v1/ledger.proto:33`).
  `QueryEventsRequest.time_range = 4` and `from_sequence = 6` (`:64`, `:66`).
- Fake behaviours to mirror:
  - filter-only-when-set (`ledgerServiceImpl.ts:130-141`);
  - recorded_at slice order (`:162`);
  - PageSize 0 → 100 (`:157`);
  - `Unimplemented` for unsupported fields (fails.md:577).
- Producer stream keys are bare order ids (`trading.go:649`, `:1805`). The producer source literal is at
  `trading.go:3667`.
- AC-name convention: `TestGetPnL_AC5_*` (`portfolio_quote_deadline_test.go:268`). 251's tests use the `251`
  qualifier so they do not collide with feature 229's `AC5`/`AC6`.

**TDD**: `red-green required`

**Covers**: `AC-1, AC-2, AC-4, AC-5, AC-6, AC-8, AC-9, AC-11, AC-14, AC-15, AC-16, AC-17, AC-18`

**Instructions**:
1. **`internal/testdata/ledger.go`** (A, design.md §6A). It imports only ledgerv1, commonv1, grpc, status/codes and
   structpb, never `internal/service`.
   - `const TradingSourceService = "xstockstrat-trading"`.
   - `type Ledger struct { ledgerv1.LedgerServiceClient; Events []*ledgerv1.LedgerEvent; OnQuery func(ctx context.Context, req *ledgerv1.QueryEventsRequest) error; calls atomic.Int64 }`
     plus `Calls() int64` and a `Requests()` accessor (mutex-guarded slice of received requests, for the
     zero-lookup and 2-call assertions).
   - `AppendEvent` is a no-op returning `&ledgerv1.AppendEventResponse{}`.
   - `QueryEvents` order:
     1. Increment calls and record the request.
     2. If `req.TimeRange != nil || req.FromSequence != 0`, return `status.Error(codes.Unimplemented, …)`.
     3. If `OnQuery` is non-nil and returns an error, return it.
     4. If `ctx.Err() != nil`, return `status.FromContextError(ctx.Err()).Err()`.
     5. Filter `EventType` / `SourceService` / `StreamKey` only when set.
     6. Keep slice order.
     7. PageSize 0 → 100. Paginate with the fake's own opaque token (an offset string). A malformed token returns
        `codes.InvalidArgument`.
   - Builders: `FilledEvent(seq int64, orderID, userID, symbol, accountID, mode string, qty, price float64, side string) *ledgerv1.LedgerEvent`.
     `side == ""` omits the key. It mirrors the `trading.go:1805-1812` keys with StreamKey = orderID and
     SourceService `TradingSourceService`.
     - `PartialEvent(...)` takes the same arguments with `filled_qty`.
     - `CreatedEvent(seq, orderID, symbol, side string, qty float64)` mirrors `trading.go:649-652`: no `order_id`,
       no `user_id` key.
2. **`internal/service/export_test.go`** (B, design.md §6B), `package service`.
   - Carry a 2-line constraint comment: an in-package `_test.go` must never import `internal/handler` (import
     cycle); `service_test` files use this shim instead.
   - `type WirePosition struct { Symbol, Account string; Qty, Avg, Current float64 }`.
   - `func NewWireTestService(t *testing.T, ledger ledgerv1.LedgerServiceClient, positions ...WirePosition) *PortfolioService`:
     - start from `newQuoteSvc(t, &stubMarketData{}, 0)` and set `svc.ledger = ledger`,
       `svc.watchlists = newFakeStore()`, `svc.wlCfg = wideCaps()`;
     - always register `mock.ExpectQuery(\`FROM portfolio.positions\`).WithArgs(anyArgs(3)...)` returning `posRow`
       rows for `positions`. With none, it returns an empty `positionCols` row set.
   - `var CtxWithUser = ctxWithUser`, `var Guard = guard`, and `var TradingSourceServiceForTest = tradingSourceService`
     (the last fails to compile until Step 7, which is part of the RED).
   - Reviewed-unchanged literals: `portfolio_quote_deadline_test.go:102`, `portfolio_fill_errors_test.go:64`,
     `watchlist_service_test.go:276`, plus `fakeLedger` / `stopLedger` / `fillEvent`.
3. **`getpnl_source_parity_test.go`**: `TestGetPnL251_SourceServiceParity` asserts
   `tradingSourceService == testdata.TradingSourceService == "xstockstrat-trading"`. The comment cites the producer
   at `services/xstockstrat-trading/internal/service/trading.go:3667`; the trading half is Step 4 (fails.md:1700-1712).
4. **Fold tests** in `portfolio_quote_deadline_test.go` (D, design.md §6D). Each builds
   `NewWireTestService(t, &testdata.Ledger{Events: …})`, calls `svc.GetPnL(CtxWithUser(t, "u-1"), req)` under
   `guard`, and is named `TestGetPnL251_AC<n>_…`:
   - **AC-1**: `CreatedEvent` buy/sell siblings plus side-less `FilledEvent` buy 10@100 and sell 10@150 →
     `RealizedPnl == 500`.
   - **AC-2**: buy filled 10@100; sell `PartialEvent` filled_qty 4@150; no sell `order.filled` → 200.
   - **AC-4**: side-less fill, no sibling → `errors.Is(err, ErrFillUnattributable)` and a nil response.
   - **AC-5**: u-1 fills carry `side`; u-2's orphan side-less fill is present → 500, and no recorded request has
     `StreamKey == "o-u2"`.
   - **AC-6**: `OnQuery` errors on the 2nd call while the first page carries a token →
     `errors.Is(err, ErrRealizedUnavailable)`.
   - **AC-8**: three sub-tests, each `ErrRealizedUnavailable`: a repeated token, a repeated event_id across pages,
     and an empty page carrying a token. Each uses an `OnQuery`-free custom `ledgerv1.LedgerServiceClient` stub
     inline (scenario one-off, C-13 exempt).
   - **AC-9** (drain): 501 `FilledEvent`s with `side` and PageSize 500 (`portfolio_service.go:754`). Each fill is
     folded once: 250 buy 1@100 interleaved with 250 sell 1@101, plus one extra buy, so the expected realized is
     exact. The call terminates under `Guard`, and exactly 2 `order.filled` QueryEvents calls are made.
   - **AC-11**: payload-`side` fills, no siblings → 500, and no recorded request has a non-empty `StreamKey`.
   - **AC-14**: acct-1 buy 10@100, acct-2 buy 10@120, acct-1 sell 10@150 → 500 (a symbol-only fold gives 400).
   - **AC-15**: AAPL fills with `account_id` "acct-1" and "" → `ErrFillUnattributable`.
   - **AC-16**, F1: filled buy 10@100 (seq 1), partial-only sell 4@150 (seq 2), filled buy 10@200 (seq 3) → 200.
   - **AC-16**, F2: partial-only A buy 10@100 (seq 1), S sell 4@150 (seq 2), B buy 10@200 (seq 3). Events slice
     order A,B,S, a fresh shim plus fake per iteration, and exactly 200 on all 20 runs. Carry the F2 risk text
     verbatim from design.md §6D as the test comment's constraint (≤ 2 lines, cite design.md:168-171).
   - **AC-17**: sell partial 4@150 then sell filled 10@150 → 500.
   - **AC-18**: paper round trip plus a LIVE sell 10@300, with `GetPnLRequest{TradingMode: TRADING_MODE_PAPER}` →
     500.
5. Existing `TestGetPnL_AC5_QuotesUnavailable` / `TestGetPnL_AC6_*` keep `newQuoteSvc` and `fakeLedger` unchanged
   and must stay green (240 overlap, context.md overlap findings).
6. C-13 verdict: the fill/order builders have ≥ 2 consumers (this step plus Step 8), so they live in `testdata`.
   AC-8's replay stubs are single-consumer scenario one-offs and stay inline.

**Verification**:
```bash
cd services/xstockstrat-portfolio && GOWORK=off go vet ./internal/... ; GOWORK=off go test ./internal/service/ -run 'TestGetPnL251' -race -count=1   # RED: compile (tradingSourceService, ErrFillUnattributable, ErrRealizedUnavailable undefined) then behaviour (realized 0)
GOWORK=off golangci-lint run --modules-download-mode=mod
grep -rn "func FilledEvent\|func PartialEvent\|func CreatedEvent" --include="*.go" internal/   # exactly 1 declaration site each (internal/testdata/ledger.go)
```

---

### Step 7 — service: GetPnL fail-closed drain, side resolution, account-grain sequence-ordered fold

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/portfolio_service.go` — modify

**Reviewers**: `xstockstrat-portfolio` owner — P&L calculation accuracy, position snapshot consistency, concurrent write
safety

**Codebase Evidence**:
- `GetPnL` is at `portfolio_service.go:722-853`.
  - Pass 1 (`:749-790`): the literal `SourceService: "trading"` is at `:753` (`:752` is `EventType`), and the query
    error is silenced with `slog.Warn` + `break` (`:756-759`).
  - User filter `:772`; mode filter `:775-783`; `filledOrderIDs[fill.OrderID] = true` (`:784`); unsigned
    `Qty: fill.Qty` (`:785`).
  - Pass 2 (`:793-835`): literal at `:798`, mode filter `:820-828`, `latestPartials[fill.OrderID] = fill` (`:830`).
  - Partial dedup at `:837-843`, using unsigned `Qty: fill.FilledQty` (`:842`); `pnl.Fold(fills).Realized` (`:845`).
- `orderFillPayload` (`:245-260`) has no `Side`. `ErrQuotesUnavailable` is at `:718`.
- The "nil means default" field precedent is `quoteCfg` (`:50-51`) and `now` (`:64-65`). `positionsMu sync.Mutex`
  is at `:56-58`.
- The ledger client is wired with `middleware.UnaryClientInterceptor` (`portfolio_service.go:124`), so new
  `QueryEvents` calls on the existing edge propagate `x-user-id` / `x-access-scope` / `x-trace-id` (C-03). There is
  no new edge.
- `pnl.Fill.Qty` is signed and `Fold` keys by `Symbol` (`packages/proto/pnl/pnl.go:23-27`, `:48`, `:63`). The
  fold is unchanged; the composite key goes into `Symbol`.
- The side-sign precedent is `offlineFillsFromOrders` (`services/xstockstrat-trading/internal/service/trading.go:876-886`).
  The new helper is deliberately stricter: UNSPECIFIED is unattributable.
- `golang.org/x/sync v0.22.0 // indirect` (`go.mod:34`): no errgroup, so lookups are sequential (F-08, go.mod
  untouched).
- Side-bearing siblings: `order.created` (`trading.go:649-652`) and `order.submitted` (`:665-668`), with
  stream_key = bare order id. A pending-approval order has only `order.created` (`:654-662`).

**TDD**: `red-green required`. GREEN for Step 6.

**Covers**: —

**Instructions**:
1. Add `const tradingSourceService = "xstockstrat-trading"` and use it in both passes. Add the sentinels
   `ErrRealizedUnavailable` (doc: the handler maps it to Unavailable, retryable) and `ErrFillUnattributable` (doc:
   FailedPrecondition, permanent; the ledger is immutable).
2. `orderFillPayload` gains `Side string \`json:"side"\``.
3. Add a method `drainTradingEvents(ctx, eventType string, visit func(ev *ledgerv1.LedgerEvent, fill orderFillPayload)) error`
   to replace both loops. It sends `QueryEvents{EventType, SourceService: tradingSourceService, Page{PageSize: 500, PageToken}}`.
   - On a transport error, a repeated next token, a repeated event_id (seen set) or an empty page that still
     carries a token, return `fmt.Errorf("GetPnL: …: %w", ErrRealizedUnavailable)` after `slog.Error`.
   - Unmarshal failures are skipped, as today. There is no page cap.
4. The visit pipeline runs in order (design.md §2):
   1. decode;
   2. user filter (`:772`);
   3. mode filter (`:775-783`);
   4. dedup (`:784` / `:838-840`, unchanged);
   5. buffer the kept fill with its `ev.GetSequence()`.
   A partial in `latestPartials` stores its own latest sequence.
5. Side resolution runs over the caller's buffered fills only.
   - A payload `side` is used directly.
   - Otherwise call `s.orderSide(ctx, orderID)`. It is sequential over distinct order ids and queries
     `QueryEvents{StreamKey: orderID, EventType: "order.created", SourceService: tradingSourceService, Page{PageSize: 1}}`,
     then `"order.submitted"`, and reads the payload `side`.
   - Cache positive answers only, in a new zero-value-safe field `sideCache map[string]string` guarded by its own
     `sideCacheMu sync.Mutex`, lazily initialised. Never use a package-level cache. Empty answers and transport
     errors are never cached.
   - A lookup transport error returns `ErrRealizedUnavailable`. The first order with no resolvable side returns
     `ErrFillUnattributable`.
   - `signedQty(side string, qty float64) (float64, bool)` accepts only `"ORDER_SIDE_BUY"` (+qty) and
     `"ORDER_SIDE_SELL"` (−qty).
6. Account rule per (normalised mode, symbol) group of the caller's fills:
   - all fills have a non-empty `account_id` → key `mode|account|symbol`;
   - none have one → key `mode||symbol`;
   - mixed → `ErrFillUnattributable`.
7. Sort the kept fills with `sort.SliceStable` by sequence, then build `[]pnl.Fill{Symbol: key, Qty: signed, Price}`
   and `pnl.Fold` it. The unrealized computation (`:724-743`) stays unchanged and still runs first.
8. Do not touch `HydrateStops` (`:530-560`) or `processOrderFill` (live fold, out of scope).

**Verification**:
```bash
cd services/xstockstrat-portfolio && GOWORK=off go test ./internal/service/ -run 'TestGetPnL' -race -count=1 -v   # 251 GREEN + feature-229/240 GetPnL tests green
GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"   # ≥ 40%
GOWORK=off golangci-lint run --modules-download-mode=mod
grep -n 'SourceService: "trading"' internal/service/portfolio_service.go; test $? -eq 1
```
New GetPnL logic is in `service`, which is excluded from COVERPKGS. `internal/testdata` counts toward it (accepted,
design.md §6E).

---

### Step 8 — test: portfolio adapter wire tests and error-mapping tables (RED)

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/portfolio_grpc_wire_test.go` — create
- `services/xstockstrat-portfolio/internal/handler/portfolio_handler_test.go` — modify

**Reviewers**: `xstockstrat-portfolio` owner — P&L calculation accuracy, position snapshot consistency, concurrent write
safety

**Codebase Evidence**:
- Handler and adapter:
  - `PortfolioHandler{svc *service.PortfolioService}` (`internal/handler/portfolio_handler.go:43-46`) and
    `NewPortfolioHandler` (`:49-51`).
  - `GetPnL` checks `callerUserID(ctx) == ""` → InvalidArgument (`:89-91`), then
    `connect.NewError(classifyGetPnLError(err), err)` (`:96`).
  - `GRPCHandler()` (`:242-244`); adapter `GetPnL` → `toGRPCError` (`:276-282`).
  - Adapter `DeleteWatchlist` (`:362-368`) and `EnsureSignalWatchlist` (`:370-376`).
  - `classifyGetPnLError(err error)` (`:425-430`).
  - `toGRPCError` (`:432-447`) maps InvalidArgument/NotFound/PermissionDenied/Unavailable only, so
    FailedPrecondition/DeadlineExceeded/Canceled become `codes.Internal`.
- `TestClassifyGetPnLError` (`internal/handler/portfolio_handler_test.go:39-49`):
  - one-arg calls at `:40` (wrapped ErrQuotesUnavailable → CodeUnavailable) and `:43` (generic → CodeInternal);
  - the `toGRPCError(Unavailable)` assertion at `:46`.
  - It backs durable portfolio @AC-5 (`services/xstockstrat-portfolio/acceptance/fix-book-portfolio-page.feature:6-8`).
  - grep `func TestToGRPCError` finds none.
- `DeleteWatchlist` returns `CodeFailedPrecondition` for a system-managed list (`portfolio_service.go:1921-1933`).
  `EnsureSignalWatchlist` (`:1718-1729`) seeds it via `watchlists.EnsureSystemManaged`; the fake is
  `watchlist_service_test.go:230`.
- Durable platform @AC-7 @feature-127 (`docs/sdd/business-rules/platform.feature:34-41`).
- pgxmock's random select can skip the ledger stage on a pre-done ctx (design.md §6C,
  `pgxmock expectations.go:71-77`), so cases 3 and 4 start from a live ctx.

**TDD**: `red-green required`

**Covers**: `AC-4, AC-6, AC-7` (plus durable portfolio @AC-5 EXTEND and platform @AC-7 @feature-127 PRESERVE)

**Instructions**:
1. `portfolio_grpc_wire_test.go` is `package service_test`. It imports `internal/handler`, `internal/service`
   (shim) and `internal/testdata`. Build `a := handler.NewPortfolioHandler(svc).GRPCHandler()` and call
   `a.GetPnL(ctx, &portfoliov1.GetPnLRequest{})` / `a.DeleteWatchlist` / `a.EnsureSignalWatchlist`. Assert with
   `status.Code(err)`.
   - (1) `TestWire251_AC4_UnresolvedSideFailedPrecondition`: side-less fill, no sibling → `codes.FailedPrecondition`.
   - (2) `TestWire251_AC6_LedgerErrorUnavailable`: `OnQuery` returns a plain error → `codes.Unavailable`.
   - (3) `TestWire251_AC7_CallerCancel`: live ctx; `OnQuery` calls `cancel()` then returns `ctx.Err()` →
     `codes.Canceled`, `Calls() >= 1`.
   - (4) `TestWire251_AC7_CallerDeadline`: 200ms timeout (design.md Open Risks: 50ms under -race is a flake surface),
     `OnQuery` blocks on `<-ctx.Done()`, run under `service.Guard` → `codes.DeadlineExceeded`, `Calls() >= 1`.
   - (5) `TestWire_DeleteSystemManagedWatchlist_F127AC7`: seed via adapter `EnsureSignalWatchlist`, then
     `DeleteWatchlist` → `codes.FailedPrecondition`.
   - (6) `TestWire251_MissingUserIDInvalidArgument`: `context.Background()` → `codes.InvalidArgument`.
   - (7) `TestWire_GetPnLQuoteGap_F229AC5`: `WirePosition{Current: 0}` with the zero-value `stubMarketData` and a
     live ctx → `codes.Unavailable`.
2. `portfolio_handler_test.go`, `TestClassifyGetPnLError`: keep the name.
   - Change `:40` and `:43` to `classifyGetPnLError(context.Background(), …)` with the same expectations; keep `:46`.
   - Add rows: (live ctx, wrapped ErrQuotesUnavailable) → CodeUnavailable; (expired ctx, same error) →
     CodeDeadlineExceeded; (cancelled ctx) → CodeCanceled; (live ctx, wrapped `service.ErrRealizedUnavailable`) →
     CodeUnavailable; (live ctx, wrapped `service.ErrFillUnattributable`) → CodeFailedPrecondition.
   - Add table-driven `TestToGRPCError`: the 4 existing codes, plus FailedPrecondition / DeadlineExceeded /
     Canceled, plus a non-connect error → `codes.Internal`.
3. C-13: the fixtures come from `internal/testdata` (Step 6); there is no second inline copy.

**Verification**:
```bash
cd services/xstockstrat-portfolio && GOWORK=off go test ./internal/... -run 'TestWire|TestClassifyGetPnLError|TestToGRPCError' -race -count=1 -v   # RED: compile (arity) + FailedPrecondition/DeadlineExceeded/Canceled → Internal
GOWORK=off golangci-lint run --modules-download-mode=mod
grep -rn "func FilledEvent" --include="*.go" internal/   # still 1 declaration site
```

---

### Step 9 — service: ctx-first `classifyGetPnLError` and explicit `toGRPCError` codes

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/handler/portfolio_handler.go` — modify

**Reviewers**: `xstockstrat-portfolio` owner — P&L calculation accuracy, position snapshot consistency, concurrent write
safety

**Codebase Evidence**:
- `portfolio_handler.go:96` is the ONLY `classifyGetPnLError` call site. The definition is at `:425-430` and
  `toGRPCError` at `:432-447`.
- Precedent: `services/xstockstrat-trading/internal/handler/trading.go:223-238` (explicit `CodeFailedPrecondition`
  case).
- Behaviour changes, intended per design.md §3:
  - `DeleteWatchlist` on a system-managed list now reaches the wire as FAILED_PRECONDITION (`portfolio_service.go:1933`).
    In the browser it goes 500 → 400 (`services/xstockstrat-ui/src/lib/connectClients.ts:119-124`).
  - A caller whose deadline is ≤ `quote_timeout_ms` now sees DEADLINE_EXCEEDED.

**TDD**: `red-green required`. GREEN for Step 8.

**Covers**: —

**Instructions**:
1. `classifyGetPnLError(ctx context.Context, err error) connect.Code`, with precedence:
   1. `ctx.Err()`: DeadlineExceeded → `CodeDeadlineExceeded`, Canceled → `CodeCanceled`;
   2. `ErrQuotesUnavailable` → `CodeUnavailable`;
   3. `service.ErrRealizedUnavailable` → `CodeUnavailable`;
   4. `service.ErrFillUnattributable` → `CodeFailedPrecondition`;
   5. otherwise `CodeInternal`.
   Update the doc comment and call site `:96` to `classifyGetPnLError(ctx, err)`.
2. `toGRPCError` keeps its `(err error)` signature and adds explicit `CodeFailedPrecondition`,
   `CodeDeadlineExceeded` and `CodeCanceled` cases. There is no numeric pass-through.

**Verification**:
```bash
cd services/xstockstrat-portfolio && GOWORK=off go test ./... -race -count=1   # Step 8 GREEN, all green
GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"   # ≥ 40%
GOWORK=off golangci-lint run --modules-download-mode=mod
grep -n "classifyGetPnLError(" internal/handler/portfolio_handler.go   # definition + one call site, both 2-arg
```
The logic is in the excluded `handler` package; the Step 8 tests are the gate.

---

### Step 10 — test: UI lineage RED (vitest + Playwright), fixtures and mock backend

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/positionLineage.test.ts` — create
- `services/xstockstrat-ui/e2e/trader/position-lineage.spec.ts` — create
- `services/xstockstrat-ui/e2e/fixtures/ledgerEvents.ts` — modify
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify
- `services/xstockstrat-ui/e2e/mock-backend.ts` — modify
- `services/xstockstrat-ui/e2e/trader/positions.spec.ts` — modify
- `services/xstockstrat-ui/e2e/trader/api-smoke.spec.ts` — modify

**Reviewers**: `xstockstrat-ui` owner — trading UI correctness, analytics display accuracy, config mutation safety,
Connect-RPC call safety, environment (`production`/`staging`) scope correctness, no secret values rendered in UI, no
direct DB access (except audit log)

**Codebase Evidence**:
- Hook: `src/hooks/usePositionLineage.ts:16-20` queries `{eventType: 'order.filled', sourceService: 'trading',
  page: {pageSize: 100, pageToken: ''}}`, filters client-side (`:22-29`), and its comment at `:5` says `"trading"`.
  It is called from `src/app/trader/positions/page.tsx:110-114`.
- Page: the empty state "No order.filled events for this position." is at `page.tsx:681-685`; `lineageColumns` at
  `:330`; the table at `:686-692`.
- BFF `queryEvents` (`src/lib/traderBff.ts:118-127`) rewrites only copilot keys. BFF `listOrders` (`:34-40`) pins
  `userId: claims.user_id`.
- The trading repo honours `symbol` / `account_id` / `trading_mode` filters
  (`services/xstockstrat-trading/internal/repository/trading_repo.go:229-268`). `ListOrdersRequest` fields are
  `trading_mode = 6`, `symbol = 7`, `account_id = 10` (`packages/proto/trading/v1/trading.proto:168-182`).
- Mock backend:
  - `queryEvents`' default `order.filled` branch (`e2e/mock-backend.ts:450-470`) has an inline literal with
    `sourceService: 'trading'` (`:456`).
  - `listOrders` (`:311-316`) filters `symbol` only.
- Fixtures and catalog:
  - Canonical home `e2e/fixtures/ledgerEvents.ts` (`LEDGER_EXPORT_EVENTS` `:22`, already `xstockstrat-trading`
    `:26`). `INVENTORY.md:81` lists the `order.filled` branch as still inline; rows `:22-23` are the ledger
    catalog. `e2e/fixtures/orders.ts` has `ORDER_FILLED` `:17`, `ORDERS` `:80`; `TEST_USER_ID` is at
    `e2e/fixtures/users.ts:9`.
  - Auth helper: `addAuthCookie` (used at `e2e/trader/api-smoke.spec.ts:200`).
- Existing lineage specs:
  - `e2e/trader/positions.spec.ts:117-180` intercepts "the lineage query (no streamKey)" (`:129-138`) with an
    inline `sourceService: 'trading'` row (`:147`). After the fix the lineage query carries a `streamKey`, so the
    interception key must change.
  - `e2e/trader/api-smoke.spec.ts:195-215` posts `sourceService: 'trading'` (`:207`).
- vitest scope is `src/**/*.test.ts`, with coverage over `src/lib/**` excluding `*Bff.ts` (`vitest.config.ts`).
  The lineage logic therefore lives in `src/lib/positionLineage.ts` (Step 11) so it is unit-testable.
- `TradingMode` import pattern: `src/hooks/usePortfolio.ts:3`. `CardNotice` is at
  `src/components/shared/CardNotice.tsx:5`.

**TDD**: `red-green required`

**Covers**: `AC-3, AC-18, AC-19, AC-20, AC-21, AC-22`

**Instructions**:
1. **`src/lib/positionLineage.test.ts`** (vitest, RED: the module does not exist yet). It imports
   `{ LINEAGE_MAX_ORDERS, fetchPositionLineage, isForeignFillEvent }` from `./positionLineage`.
   - `fetchPositionLineage` with stub `listOrders` / `queryEvents` functions:
     - (a) it passes `{symbol, accountId, tradingMode}` plus `page.pageSize = LINEAGE_MAX_ORDERS + 1` to
       `listOrders`;
     - (b) it issues one `queryEvents({streamKey: orderId, eventType: 'order.filled', sourceService: 'xstockstrat-trading'})`
       per order, for at most 50 orders, with in-flight ≤ 3 (instrumented stub counter);
     - (c) 51 orders → `truncated: true`, and 50 queried (AC-21);
     - (d) an order with status NEW is still queried and its fill returned (AC-22).
   - `isForeignFillEvent(event, userId)` is true for `order.filled` / `order.partially_filled` whose
     `payload.user_id` ≠ `userId`, and false for other event types (AC-20 unit half).
2. **Fixtures** (C-12). Add to `e2e/fixtures/ledgerEvents.ts`:
   - `LINEAGE_FILL_EVENTS`: u-1 = `TEST_USER_ID` `o-buy` AAPL 10@100 acct `BROKER_ACCOUNT_ALPACA.id` paper; u-2
     `o-other` AAPL 5@120 acct-2; a LIVE u-1 fill; `o-stale`. All have
     `sourceService: 'xstockstrat-trading'` and bare-id `streamKey`.
   - `lineageOtherUserFills(n)`: generates 100 other-user rows for AC-19.
   - Add the matching `LINEAGE_ORDERS` (spreads of `ORDER_FILLED` from `e2e/fixtures/orders.ts`, including
     `o-stale` with status 1 = NEW and the LIVE order with `tradingMode: 2`).
   - Add an `INVENTORY.md` row next to `:22-23`, and update `:81` to say the `order.filled` branch is centralized.
3. **`e2e/mock-backend.ts`**:
   - `listOrders` also filters `req.accountId` and `req.tradingMode` when set, over `ORDERS` plus `LINEAGE_ORDERS`.
   - Replace the inline `order.filled` branch (`:450-470`): with `req.streamKey`, return the `LINEAGE_FILL_EVENTS`
     rows matching it (including u-2's, so the BFF backstop is what drops it). Without a stream key, return
     `lineageOtherUserFills(100)` and `nextPageToken: 'p2'`, so the old platform-wide read misses u-1.
4. **`e2e/trader/position-lineage.spec.ts`** (new), using `addAuthCookie`:
   - AC-3: the AAPL/acct position sheet lists `o-buy` qty 10 @ 100, and no intercepted QueryEvents response body
     contains u-2.
   - AC-18: the paper sheet omits the LIVE fill.
   - AC-19: `o-buy` is listed although the unfiltered page holds 100 other-user events.
   - AC-20: a `page.evaluate` fetch to `/trader/api/xstockstrat.ledger.v1.LedgerService/QueryEvents` with
     `{streamKey: 'o-other', eventType: 'order.filled'}` returns no event with `payload.user_id` u-2.
   - AC-21: `page.route` on ListOrders returns 51 `{...ORDER_FILLED, orderId}` spreads (scenario one-off). The
     truncation notice is visible, and ≤ 50 lineage QueryEvents requests are observed.
   - AC-22: `o-stale` is listed.
5. **`positions.spec.ts:129-138`**: intercept on `body.eventType === 'order.filled'` instead of "no streamKey", and
   take the long-id row from a `{...LINEAGE_FILL_EVENTS[0], …}` spread, not the `:147` literal.
   **`api-smoke.spec.ts:207`**: post `{eventType: 'order.filled', sourceService: 'xstockstrat-trading', streamKey: 'o-buy'}`.
   Assert the join keys as before.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run test:unit -- src/lib/positionLineage.test.ts   # RED (module missing)
pnpm exec playwright test e2e/trader/position-lineage.spec.ts   # RED on AC-3/19/20/21/22 (old hook reads the platform page; BFF unscoped)
pnpm run lint
grep -n "from '../fixtures'\|from './fixtures'\|helpers/auth" e2e/trader/position-lineage.spec.ts e2e/trader/positions.spec.ts e2e/mock-backend.ts
grep -n "LINEAGE_FILL_EVENTS" e2e/fixtures/INVENTORY.md
```

---

### Step 11 — service: user-pinned lineage via ListOrders, BFF backstop and truncation notice

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/positionLineage.ts` — create
- `services/xstockstrat-ui/src/hooks/usePositionLineage.ts` — modify
- `services/xstockstrat-ui/src/lib/traderBff.ts` — modify
- `services/xstockstrat-ui/src/app/trader/positions/page.tsx` — modify

**Reviewers**: `xstockstrat-ui` owner — trading UI correctness, analytics display accuracy, config mutation safety,
Connect-RPC call safety, environment (`production`/`staging`) scope correctness, no secret values rendered in UI, no
direct DB access (except audit log)

**Codebase Evidence**:
- `usePositionLineage.ts:7-32`.
- Browser clients: `ledgerClient` (`src/lib/browserClients/ledgerClient.ts`) and `tradingClient`
  (`src/lib/browserClients/tradingClient.ts:6`). The `ListOrders` call precedent is `src/hooks/useOrders.ts:36-45`.
- BFF `queryEvents` (`traderBff.ts:118-127`) calls `requireSession(ctx)` → `claims.user_id`. The LEDGER-6 empty-caller
  posture means it matches none, never all (recon.md Patterns to REUSE, `ledgerServiceImpl.ts:311`).
- `staleTime` precedent: `src/hooks/useLiveStrategies.ts:51`. A concurrency helper is **Not found**
  (grep `concurren|pLimit|mapLimit` over `src`), so a minimal worker loop goes in `positionLineage.ts`.
- `CardNotice` (`src/components/shared/CardNotice.tsx:5-23`, import precedent
  `src/components/trader/OrderBook.tsx:13`) is the canonical notice primitive (C-17). Page sites are
  `page.tsx:110-114`, `:330`, `:676-692`.

**TDD**: `red-green required`. GREEN for Step 10.

**Covers**: —

**Instructions**:
1. Create `src/lib/positionLineage.ts`.
   - `export const LINEAGE_MAX_ORDERS = 50`.
   - `export async function fetchPositionLineage(deps: { listOrders; queryEvents }, args: { symbol; accountId; mode })`.
     It calls `listOrders({symbol, ...(accountId ? {accountId} : {}), tradingMode: PbTradingMode.PAPER|LIVE, page: {pageSize: LINEAGE_MAX_ORDERS + 1, pageToken: ''}})`
     and takes the first 50 orders. Then it runs `queryEvents({streamKey: o.orderId, eventType: 'order.filled', sourceService: 'xstockstrat-trading', page: {pageSize: 10, pageToken: ''}})`
     at concurrency 3 and returns `{ events, truncated }`.
   - `export function isForeignFillEvent(e, userId: string)`.
2. `usePositionLineage.ts` calls `fetchPositionLineage({listOrders: tradingClient.listOrders, queryEvents: ledgerClient.queryEvents}, …)`
   with `staleTime: 60_000`. Fix the `:5` comment to the 2-line constraint form (no `"trading"`).
3. `traderBff.ts` `queryEvents` (`:118-127`): after `ledgerClient.queryEvents(…)`, return the response with
   `events` filtered by `!isForeignFillEvent(e, claims.user_id)`. Other event types stay unscoped; state this in
   a ≤ 2-line comment.
4. `page.tsx`: read `lineage.data?.events`. When `lineage.data?.truncated`, render
   `<CardNotice>Showing fills for the latest 50 orders only.</CardNotice>` above the table. Update the
   `lineageColumns` element type at `:330`.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run test:coverage   # vitest src/lib threshold ≥ 40%, Step 10 unit GREEN
pnpm exec playwright test e2e/trader/position-lineage.spec.ts e2e/trader/positions.spec.ts e2e/trader/api-smoke.spec.ts   # GREEN
pnpm run lint
grep -rn "sourceService: 'trading'" src e2e; test $? -eq 1
```

---

### Step 12 — docs: teardown reconciliation (stream-key drift, ctx-first wording, page_token, findings)

**Status**: `pending`
**Service**: `docs` (service CLAUDE.md files and module constitutions)
**Files**:
- `services/xstockstrat-portfolio/CLAUDE.md` — modify
- `services/xstockstrat-portfolio/docs/context-constitution.md` — modify
- `services/xstockstrat-portfolio/docs/context-constitution-findings.md` — modify
- `services/xstockstrat-trading/CLAUDE.md` — modify
- `services/xstockstrat-ledger/CLAUDE.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- Portfolio:
  - `services/xstockstrat-portfolio/CLAUDE.md:28` says `ErrQuotesUnavailable` → `classifyGetPnLError` → UNAVAILABLE.
  - The § Ledger Events Consumed `order.filled` row is at `:117` (live consumer only); the
    `order.partially_filled` row is at `:118`.
  - PORTFOLIO-16 is at `services/xstockstrat-portfolio/docs/context-constitution.md:34`.
- Trading: `services/xstockstrat-trading/CLAUDE.md:143-156` documents `order:{order_id}` for `order.*` events, but
  production writes the bare id (`trading.go:649`, `:665`, `:1805`, `:1822`).
  `order_intent.resolved_by_reconciliation` (`:158`) does use the prefix (`trading.go:2223`, `:2247`, `:2278`).
- Ledger: `services/xstockstrat-ledger/CLAUDE.md:34` and `:101` (`order:{order_id}`), and `:26` (QueryEvents).
- Findings candidates (design.md §7): `GetPnL` ignores `req.Range` for realized (`portfolio_service.go:851`
  echoes it only); `HydrateStops` reads page 1 only (`portfolio_service.go:534`); DeleteWatchlist 500 → 400 and
  short-deadline DEADLINE_EXCEEDED are intended.
- Root `CLAUDE.md` § Teardown requires `/context-forge:context-constitution refresh`, or a manual reconciliation
  recorded in the PR body.

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. Portfolio `CLAUDE.md`:
   - `:28`: ctx-first mapping (DEADLINE_EXCEEDED/CANCELED first; UNAVAILABLE for quote gaps and ledger read gaps;
     FAILED_PRECONDITION for unattributable fills).
   - `:117`: add `GetPnL` (query time) as a second `order.filled` consumer, with the `side` resolution order:
     payload, then `order.created`, then `order.submitted`.
   - `:118`: same side rule, plus the account-grain sequence-ordered fold.
2. PORTFOLIO-16 (`context-constitution.md:34`): reflect `classifyGetPnLError(ctx, err)` precedence. Add findings
   entries for the `req.Range`, HydrateStops page-1 and wire-code changes.
3. Trading `CLAUDE.md:143-156`: change the stream-key column for `order.*` rows to the bare `{order_id}`. Keep `:158`.
4. Ledger `CLAUDE.md:34`, `:101`: bare order id for trading order events. Near `:26`, document that
   `QueryEvents.page.page_token` is an opaque keyset cursor and that a malformed token returns INVALID_ARGUMENT.
5. Run `/context-forge:context-constitution refresh` scoped to these files. If unavailable, reconcile by hand and
   record both facts in the PR body (root `CLAUDE.md` § Teardown).

**Verification**:
```bash
grep -n "order:{order_id}" services/xstockstrat-trading/CLAUDE.md services/xstockstrat-ledger/CLAUDE.md   # only order_intent.* rows remain
grep -n "page_token" services/xstockstrat-ledger/CLAUDE.md
grep -n "classifyGetPnLError" services/xstockstrat-portfolio/CLAUDE.md services/xstockstrat-portfolio/docs/context-constitution.md
```

---

### Step 13 — docs: 252 reconciliation (soft merge-order row + 252 context note)

**Status**: `pending`
**Service**: `docs/roadmap/features/`
**Files**:
- `docs/roadmap/features/merge-order.md` — modify
- `docs/roadmap/features/252-fix-identity-ledger-test-suites/context.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- The soft-row precedent is `docs/roadmap/features/merge-order.md:35` (`open-positions-ui` ↔ `orders-management-ui`,
  "soft/rebase dependency"). grep `252|fix-identity-ledger` finds no row today.
- `docs/roadmap/features/252-fix-identity-ledger-test-suites/status.md` = `draft`. 252 owns the ledger runner that
  un-guards `ledgerServiceImpl.test.ts` (design.md §1 B8).

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. Add a row: `fix-getpnl-source-service` | `fix-identity-ledger-test-suites` | soft. Both edit
   `ledgerServiceImpl.test.ts`. Whichever merges second reconciles `makeRow.cursor_us` and the hasMore token
   decode (251 Step 2), and keeps the `queryEvents` delegate (251 Step 1) covered. Resolved: `No`.
2. Append a dated session note to 252's `context.md` stating the same reconciliation duty.

**Verification**:
```bash
grep -n "fix-getpnl-source-service" docs/roadmap/features/merge-order.md docs/roadmap/features/252-fix-identity-ledger-test-suites/context.md
```

---

### Step 14 — docs: ship gate and dev smoke (post-deploy, blocks promotion)

**Status**: `pending`
**Service**: `docs/roadmap/features/251-fix-getpnl-source-service/`
**Files**:
- `docs/roadmap/features/251-fix-getpnl-source-service/context.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- Thresholds: 500ms per query and 5s aggregate (= `ledgerEmitTimeout / 2`,
  `services/xstockstrat-trading/internal/service/trading.go:3657`).
- The ledger pool is direct `:25060`, 2 conns (1 query + 1 LISTEN; root `CLAUDE.md` § Connection Pool Budget), so
  F-06 forbids raising it without a re-check.
- Fail-closed inter-service mTLS (feature 210, `docs/patterns/inter-service-mtls.md`).

**TDD**: `N/A (operational gate; read-only)`

**Covers**: —

**Instructions**:
1. Run this after trading `side` is live on dev and prod, read-only, and record results in context.md. Escalate
   anything over threshold (P-03).
   - (i) Per-type counts of `order.filled` / `order.partially_filled` / `order.created`.
   - (ii) Fill stream keys with no side-bearing sibling.
   - (iii) Mixed user+symbol groups and empty-`account_id` fills; the users/groups that would hit AC-4/AC-15
     (permanent FAILED_PRECONDITION), with a remediation path.
   - (iv) EXPLAIN ANALYZE of the first and a next page (chunk exclusion for the cursor expression; fallback is a
     timestamptz text parameter), one stream-key lookup and the chunk count. Also a cold-cache full GetPnL including
     the platform-wide `order.filled` drain, and AppendEvent latency under concurrent cold GetPnL calls.
2. Dev smoke, which blocks promotion:
   - drain `QueryEvents{sourceService:'xstockstrat-trading'}` at pageSize 50 against a read-only SELECT (equal
     counts, 0 duplicates, 0 missing);
   - `GetPnL` OK for a dev user;
   - one malformed token → INVALID_ARGUMENT on the real gRPC path.
   The access path must satisfy fail-closed mTLS; if none exists, escalate (P-03).

**Verification**:
```bash
grep -n "ship gate\|dev smoke" docs/roadmap/features/251-fix-getpnl-source-service/context.md
```
The (i)-(iv) results are recorded, each within threshold or escalated.

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._

# Implementation Spec: open-positions-ui

**Status**: `pending`
**Created**: 2026-06-11
**Feature**: `docs/roadmap/features/056-open-positions-ui/feature.md`
**Total Steps**: 9
**Feature Branch**: `feature/open-positions-ui`

---

## Execution Summary

The feature is delivered proto-first: Step 1 adds additive `symbol`/`side` filter fields
plus a `PositionSide` enum to `portfolio.proto`, Step 2 regenerates stubs. Steps 3–4 wire the
new filters through the portfolio Go service (repo SQL + service enrichment) with paired tests.
Steps 5–7 build the UI: expose `ListPositions` and `LedgerService.QueryEvents` through the
trader BFF (adding the missing ledger client), add browser typed clients + hooks, then rebuild
the positions page with pagination, filters, a position-detail drill-in, and `order.filled`
fill-lineage. Step 8 wires the new `LEDGER_ENDPOINT` env var into all three deployment files.
Step 9 records deviations. Portfolio and ledger services own no lineage write path — FR-4 is a
read-only join over existing `order.filled` ledger events.

## Step Dependencies

- Step 2 (proto-gen) requires Step 1 (proto): stubs regenerate from the edited `.proto`.
- Step 3 (portfolio service) requires Step 2: uses the regenerated Go `Symbol`/`Side` fields.
- Step 4 (test) covers Step 3 (service).
- Step 5 (BFF) requires Step 2: uses regenerated TS `ListPositions` + existing `LedgerService` stub.
- Step 6 (browser clients/hooks) requires Step 5: calls the BFF methods exposed there.
- Step 7 (positions page) requires Step 6: consumes the new hooks.
- Step 8 (deployment env) requires Step 5: the ledger client added in Step 5 reads `LEDGER_ENDPOINT`.
- Step 9 (docs) is last — records the `trade.filled` → `order.filled` correction and other deviations.

---

### Step 1 — proto: Add `symbol`/`side` filters + `PositionSide` enum to `portfolio.proto`

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/portfolio/v1/portfolio.proto` — modify

**Reviewers**: Proto Reviewer — field number uniqueness, additive-only changes (position filters), `buf lint`/`buf breaking` pass; `xstockstrat-portfolio` (service owner) — P&L calculation accuracy, position snapshot consistency; `xstockstrat-ui` (service owner) — Trading UI correctness, Connect-RPC call safety; `xstockstrat-ledger` (service owner) — `QueryEvents` read correctness for `order.filled` lineage (read-only; no ledger changes)

**Codebase Evidence**:
- Confirmed via Read `packages/proto/portfolio/v1/portfolio.proto:79-85` → `ListPositionsRequest`
  currently has fields `user_id=1`, `page=2`, `trading_mode=3`, `optional account_id=4`. Highest
  field number is 4, so additive filter fields take numbers 5 and 6.
- No `PositionSide`/`POSITION_SIDE` enum exists anywhere in `packages/proto/`
  (`grep -rn "PositionSide\|POSITION_SIDE" packages/proto/` → no match). The existing
  `OrderSide` enum (`packages/proto/trading/v1/trading.proto:50-53`, `ORDER_SIDE_BUY/SELL`) is
  order-execution semantics, not position long/short — do **not** reuse it.
- Every enum requires a `<NAME>_UNSPECIFIED = 0` sentinel (root CLAUDE.md §Proto Contract
  Governance); `TradingMode` at `common/v1/common.proto:49-53` is the reference pattern.

**Instructions**:
1. In `packages/proto/portfolio/v1/portfolio.proto`, add a new enum near `Position` (after the
   `Position` message, before `PortfolioSnapshot`):
   ```proto
   // PositionSide distinguishes a long (qty > 0) from a short (qty < 0) position.
   // Used only as an additive filter on ListPositionsRequest; the Position message itself
   // continues to carry signed qty.
   enum PositionSide {
     POSITION_SIDE_UNSPECIFIED = 0; // no side filter — return both long and short
     POSITION_SIDE_LONG = 1;        // qty > 0
     POSITION_SIDE_SHORT = 2;       // qty < 0
   }
   ```
2. Add two additive fields to `ListPositionsRequest` (after `optional string account_id = 4;`):
   ```proto
   // Additive filters (feature 056). Empty symbol / UNSPECIFIED side = no narrowing.
   string symbol = 5;       // exact-match symbol filter; "" = all symbols
   PositionSide side = 6;   // long/short filter derived from qty sign
   ```
   Do **not** renumber or retype any existing field — additive only.

**Verification**:
- `cd packages/proto && buf lint && buf breaking --against ".git#branch=feature/open-positions-ui"`
  — both must pass (additive enum + additive fields are non-breaking). If the feature branch does
  not yet exist on the remote, run `buf breaking --against ".git#branch=main-dev"`.

---

### Step 2 — proto-gen: Regenerate stubs

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/go/portfolio/v1/` — modify (regenerated)
- `packages/proto/gen/python/portfolio/v1/` — modify (regenerated)
- `packages/proto/gen/ts/portfolio/v1/` — modify (regenerated)

**Reviewers**: Inherited from Step 1 — Proto Reviewer; `xstockstrat-portfolio`; `xstockstrat-ui`; `xstockstrat-ledger`

**Codebase Evidence**:
- `./scripts/buf-gen.sh` is the canonical codegen entrypoint (root CLAUDE.md §Generating Proto
  Stubs: "generates TypeScript, Python, and Go stubs and compiles the TS package").
- Existing generated Go enum shape confirmed at
  `packages/proto/gen/go/trading/v1/trading.pb.go:26-31` (`type OrderSide int32` with
  `OrderSide_ORDER_SIDE_*` constants) — the new `PositionSide` will follow the same shape under
  `gen/go/portfolio/v1/`.

**Instructions**:
1. From repo root run `./scripts/buf-gen.sh`.
2. Commit the regenerated stubs **together with** the Step 1 proto change in the same commit
   (root CLAUDE.md: "Commit proto source + generated stubs together"; `proto-freshness` CI job
   enforces this).

**Verification**:
- `./scripts/buf-gen.sh && git diff --exit-code packages/proto/gen/` — must report no diff after
  regeneration (stubs are in sync with the `.proto`).

---

### Step 3 — service: Apply `symbol`/`side` filters in portfolio `ListPositions`

**Status**: `done`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/repository/portfolio_repo.go` — modify
- `services/xstockstrat-portfolio/internal/service/portfolio_service.go` — modify

**Reviewers**: `xstockstrat-portfolio` (service owner) — P&L calculation accuracy, position snapshot consistency, concurrent write safety

**Codebase Evidence**:
- Service `ListPositions` confirmed at `portfolio_service.go:238-255`. It reads `req.Page`,
  calls `s.repo.ListPositions(ctx, req.UserId, req.TradingMode, pageSize, pageToken, "")` and
  wraps the result in `ListPositionsResponse`. It passes `""` for `accountID` and does **not**
  forward `req.AccountId` — note this when adding new filters (see Instructions).
- Repo `ListPositions` confirmed at `portfolio_repo.go:64-144`. It builds one of four keyset
  SQL variants (mode × accountID), each `SELECT symbol, qty, avg_entry_price, cost_basis,
  opened_at, trading_mode, account_id FROM portfolio.positions WHERE user_id=$1 ...
  ($N='' OR symbol > $N) ORDER BY symbol ASC LIMIT ...`. Pagination is keyset-by-symbol;
  `nextToken` is the symbol of the `pageSize`-th overflow row (`portfolio_repo.go:138-142`).
- **Enrichment gap (key finding):** repo `ListPositions` returns positions with `CurrentPrice`,
  `MarketValue`, `UnrealizedPnl`, `UnrealizedPnlPct` **unset** — only `GetPortfolio`
  (`portfolio_service.go:192-199`) and `GetPosition` (`:224-231`) enrich via
  `s.marketdata.GetLatestQuote`. The P&L-sign filter (FR-2 winners/losers) and FR-3 detail
  fields therefore require service `ListPositions` to enrich each returned position the same way
  before responding. The P&L-sign filter is **not** added to proto/SQL (see Step 5 decision) —
  it is applied client-side per page in the UI over the now-enriched `unrealizedPnl`.
- `side` is derived from `qty` sign (`Position.qty` is signed `double`, `portfolio.proto:35`).

**Instructions**:
1. In `portfolio_repo.go`, extend `ListPositions`'s signature to accept the new filters, e.g.
   `func (r *PortfolioRepo) ListPositions(ctx, userID, mode, pageSize, pageToken, accountID
   string, symbolFilter string, side portfoliov1.PositionSide) (...)`. Add the predicates to
   each of the four SQL variants:
   - symbol filter: when `symbolFilter != ""`, add `AND symbol = $K` (exact match — note this
     coexists with the existing keyset `symbol > $token` predicate used for pagination; an exact
     symbol filter collapses the page to at most one symbol, which is acceptable).
   - side filter: when `side == POSITION_SIDE_LONG` add `AND qty > 0`; when
     `POSITION_SIDE_SHORT` add `AND qty < 0`; `UNSPECIFIED` adds nothing.
   Keep `ORDER BY symbol ASC` and the `pageSize+1` overflow probe unchanged so keyset
   pagination still works.
2. In `portfolio_service.go` `ListPositions` (`:238`), forward the new request fields:
   `s.repo.ListPositions(ctx, req.UserId, req.TradingMode, pageSize, pageToken, req.AccountId,
   req.Symbol, req.Side)`. (This also fixes the pre-existing gap where `req.AccountId` was
   dropped — confirm with the portfolio owner that forwarding account_id here is desired; if a
   separate change is preferred, keep passing `""` and only add symbol/side.)
3. After fetching positions, **enrich each** with current price / market value / unrealized P&L
   by looping and calling `s.marketdata.GetLatestQuote`, mirroring `GetPortfolio` at
   `portfolio_service.go:192-199` exactly (same mid-price `(Ask+Bid)/2`, same
   `MarketValue = price*Qty`, `UnrealizedPnl = MarketValue - CostBasis`,
   `UnrealizedPnlPct = UnrealizedPnl/CostBasis` guarded against zero cost basis). Extract this
   enrichment into a small helper so it can be unit-tested in a measured package (see Step 4).
4. Header propagation: no **new** outbound service is introduced — `s.marketdata` is an existing
   client already used by `GetPortfolio`/`GetPnL`, and propagation is handled by the Go
   interceptor in `services/xstockstrat-portfolio/internal/middleware/propagation.go`
   (confirmed present via `find`). No new propagation wiring required.

**Verification**:
- `grep -n "req.Symbol\|req.Side\|PositionSide" services/xstockstrat-portfolio/internal/service/portfolio_service.go`
  — confirm new fields are forwarded.
- `grep -n "qty > 0\|qty < 0\|symbol = \$" services/xstockstrat-portfolio/internal/repository/portfolio_repo.go`
  — confirm side + symbol predicates present.
- Lint: `cd services/xstockstrat-portfolio && GOWORK=off golangci-lint run --modules-download-mode=mod`

---

### Step 4 — test: portfolio filter + enrichment unit tests

**Status**: `done`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/portfolio_helpers_test.go` — modify

**Reviewers**: `xstockstrat-portfolio` (service owner) — P&L calculation accuracy, position snapshot consistency

**Codebase Evidence**:
- Existing table-driven helper tests live in
  `services/xstockstrat-portfolio/internal/service/portfolio_helpers_test.go` (16 `TestXxx`
  funcs confirmed via `grep -n "func Test"`, e.g. `TestPositionMath_NewPosition:38`,
  `TestRealizedPnL_ClosedLong:173`). These exercise pure helper functions, not the DB.
- **CI coverage exclusion (key finding):** the portfolio CI coverage `coverpkg` list excludes
  `cmd|handler|repository|telemetry|service` packages
  (`.github/workflows/ci.yml:229` →
  `go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)'`). The new SQL
  filter logic lives in `repository` and the forwarding in `service` — **both excluded from
  coverage measurement.** To keep meaningful tests, put the testable logic in a pure helper:
  the side-derivation (qty→PositionSide) and the price-enrichment math should be extracted into
  functions that live in (or are exercised from) a measured package, and unit-tested here.

**Instructions**:
1. Add a pure helper (e.g. `sideOf(qty float64) portfoliov1.PositionSide` and an
   `enrichPosition(p, askPrice, bidPrice)` math helper) and table-driven tests covering:
   - qty > 0 → LONG, qty < 0 → SHORT, qty == 0 → UNSPECIFIED;
   - enrichment math for a winner (positive unrealized P&L) **and** a loser (negative) — this
     also validates the P&L-sign data the UI's winners/losers filter relies on;
   - zero-cost-basis guard (no divide-by-zero in `UnrealizedPnlPct`).
2. Follow the existing table-test style in `portfolio_helpers_test.go`.

**Verification**:
- `cd services/xstockstrat-portfolio && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"` — confirm ≥ 40%.
- Lint (paired with Step 3): `cd services/xstockstrat-portfolio && GOWORK=off golangci-lint run --modules-download-mode=mod`
- Note: the SQL filter + service forwarding land in excluded packages (`repository`, `service`);
  the pure helpers added here are the coverage-measured surface. Integration-level filter
  behavior is exercised by the Step 7 UI E2E smoke (`api-smoke.spec.ts`).

---

### Step 5 — service: Expose `ListPositions` + `LedgerService.QueryEvents` via trader BFF (add ledger client)

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/connectClients.ts` — modify (add ledger client + `LEDGER_ENDPOINT`)
- `services/xstockstrat-ui/src/lib/traderBff.ts` — modify (add `listPositions` + `LedgerService.queryEvents`)
- `docker-compose.yml` — modify (add `LEDGER_ENDPOINT` to `xstockstrat-ui` block)
- `.do/app.dev.yaml` — modify (add `LEDGER_ENDPOINT` to `xstockstrat-ui` block)
- `.do/app.yaml` — modify (add `LEDGER_ENDPOINT` to `xstockstrat-ui` block)

**Reviewers**: `xstockstrat-ui` (service owner) — Trading UI correctness, Connect-RPC call safety, environment/trading-mode scope correctness

**Codebase Evidence**:
- BFF `traderBff.ts` confirmed: the `PortfolioService` router block (`traderBff.ts:79-88`)
  exposes only `getPortfolio` and `listPortfolios` — **`listPositions` is NOT exposed**. The
  current positions page reaches `ListPositions` data indirectly via `getPortfolio().positions`
  (`usePositions` at `src/hooks/usePortfolio.ts:28-40` calls `portfolioClient.getPortfolio`).
- **No ledger client exists (key finding):** `connectClients.ts:1-37` wires trading, portfolio,
  marketdata, notify, identity, analysis, config, ingest, indicators — **no `LedgerService`
  client and no `LEDGER_ENDPOINT`** (`grep -n "Ledger\|LEDGER" connectClients.ts` → no match).
  `traderBff.ts` imports no ledger client either.
- Ledger TS stub is available: `packages/proto/gen/ts/ledger/v1/ledger_connect.ts:15`
  (`export const LedgerService`), with `queryEvents` RPC at `:30-32`
  (`QueryEventsRequest`/`QueryEventsResponse`). The `LedgerEvent.payload` is a Struct
  (`ledger.proto:27`).
- Header propagation pattern already present in the BFF: every method forwards
  `x-user-id`/`x-access-scope`/`x-trace-id` via `backendHeaders(claims, ctx)`
  (`traderBff.ts:24-30`). New ledger calls must reuse `backendHeaders` (Node.js BFF pattern —
  the BFF is the propagation boundary; cf. `docs/patterns/header-propagation.md`).
- `LEDGER_ENDPOINT` env var **absent** from the `xstockstrat-ui` service block in all three
  deployment files (confirmed: docker-compose `xstockstrat-ui` env at lines 444-459 has no
  `LEDGER_ENDPOINT`; app.dev.yaml ui block `:396-427` and app.yaml ui block both lack it — the
  `LEDGER_ENDPOINT` grep hits at app.dev.yaml `:56,89,...` belong to backend service blocks, not
  the UI block at `:387`). The standard value is `xstockstrat-ledger:50057` (root CLAUDE.md
  Service Registry) — already used by other compose services at `docker-compose.yml:173` etc.

**Instructions**:
1. In `connectClients.ts`: import `LedgerService` from
   `@xstockstrat/proto/ledger/v1/ledger_pb`, add
   `const LEDGER_ENDPOINT = process.env.LEDGER_ENDPOINT ?? 'xstockstrat-ledger:50057';` and
   export `ledgerClient = createClient(LedgerService, makeTransport(LEDGER_ENDPOINT));`,
   mirroring the existing client exports at `:29-37`.
2. In `traderBff.ts`: add `listPositions` to the `router.service(PortfolioService, {...})` block
   (`:79`), forwarding `{ ...req, userId: claims.user_id }` with `backendHeaders(claims, ctx)`,
   matching the `getPortfolio` shape. Then import `LedgerService` from
   `@xstockstrat/proto/ledger/v1/ledger_pb` and `ledgerClient` from `@/lib/connectClients`, and
   register a new `router.service(LedgerService, { async queryEvents(req, ctx) { const claims =
   await requireSession(ctx); return ledgerClient.queryEvents(req, { headers:
   backendHeaders(claims, ctx) }); } })` block. The `handlerMap` (`:135`) auto-includes the new
   handlers; no path change needed.
3. Add `LEDGER_ENDPOINT: xstockstrat-ledger:50057` to the `xstockstrat-ui` `environment:` block
   in `docker-compose.yml` (after `PORTFOLIO_ENDPOINT` at line 445), matching the form used at
   `docker-compose.yml:173`.
4. Add to `.do/app.dev.yaml` ui block (after `PORTFOLIO_ENDPOINT` at `:399-400`):
   `- key: LEDGER_ENDPOINT` / `value: ${xstockstrat-ledger.PRIVATE_DOMAIN}:50057`, matching the
   `PRIVATE_DOMAIN` form used at `.do/app.dev.yaml:56-57`. Add the identical entry to the
   `xstockstrat-ui` block in `.do/app.yaml`.

**Verification**:
- `grep -n "ledgerClient\|LEDGER_ENDPOINT\|LedgerService" services/xstockstrat-ui/src/lib/connectClients.ts services/xstockstrat-ui/src/lib/traderBff.ts`
  — confirm client + BFF wiring present.
- `grep -n "listPositions\|queryEvents" services/xstockstrat-ui/src/lib/traderBff.ts` — confirm
  both methods registered.
- `grep -n "LEDGER_ENDPOINT" docker-compose.yml .do/app.dev.yaml .do/app.yaml` — confirm a new
  occurrence now appears inside each `xstockstrat-ui` block.
- Header propagation: confirm both new BFF methods pass `backendHeaders(claims, ctx)` (which
  emits `x-user-id`/`x-access-scope`/`x-trace-id`) —
  `grep -n "backendHeaders" services/xstockstrat-ui/src/lib/traderBff.ts` covers the new calls.
- Lint: `cd services/xstockstrat-ui && pnpm run lint`

---

### Step 6 — service: Browser typed clients + hooks (positions pagination, ledger lineage)

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/browserClients/ledgerClient.ts` — create
- `services/xstockstrat-ui/src/hooks/usePortfolio.ts` — modify (paginated `usePositions` + filters)
- `services/xstockstrat-ui/src/hooks/usePositionLineage.ts` — create (or add to usePortfolio.ts)

**Reviewers**: `xstockstrat-ui` (service owner) — Trading UI correctness, Connect-RPC call safety, environment/trading-mode scope correctness

**Codebase Evidence**:
- Browser typed-client pattern confirmed at
  `services/xstockstrat-ui/src/lib/browserClients/portfolioClient.ts:1-6`:
  `createConnectTransport({ baseUrl: '/trader/api' })` + `createClient(PortfolioService,
  transport)`. Ten such clients exist under `src/lib/browserClients/` (no `ledgerClient.ts` yet —
  confirmed via `find`).
- Hook pattern confirmed at `src/hooks/usePortfolio.ts:28-40` (`usePositions` using
  `@tanstack/react-query` `useQuery` with `refetchInterval: 10_000`). Current `usePositions`
  calls `portfolioClient.getPortfolio` (NOT `listPositions`) and returns `.positions`.
- `QueryEventsRequest` shape (from `ledger.proto:49-56`): `stream_key`, `event_type`,
  `source_service`, `time_range`, `page`, `from_sequence`. For lineage, filter
  `event_type = "order.filled"`, `source_service = "trading"` (see Step 9 deviation: the spec
  said `trade.filled`, but the real emitted type is `order.filled`).

**Instructions**:
1. Create `src/lib/browserClients/ledgerClient.ts` mirroring `portfolioClient.ts`:
   `createClient(LedgerService, createConnectTransport({ baseUrl: '/trader/api' }))`.
2. In `usePortfolio.ts`, replace the `getPortfolio`-based `usePositions` with a
   `ListPositions`-backed paginated hook: call `portfolioClient.listPositions({ tradingMode,
   accountId?, symbol?, side?, page: { pageSize, pageToken } })`, threading `pageToken`
   (`PageResponse.nextPageToken`) and the symbol/side filter args. Keep `refetchInterval:
   10_000`. The P&L-sign (winners/losers) filter is applied client-side over the enriched
   `unrealizedPnl` returned by the now-enriching service `ListPositions` (Step 3).
3. Add a `usePositionLineage(symbol, accountId, mode)` hook that calls
   `ledgerClient.queryEvents({ eventType: 'order.filled', sourceService: 'trading', page: {...}
   })` and filters the returned events client-side to those whose `payload.symbol === symbol`
   and `payload.account_id === accountId` and `payload.trading_mode` matches the selected mode
   (payload fields confirmed in Step 9 evidence). Use `enabled: !!symbol` so it only runs when a
   position is selected.

**Verification**:
- `grep -n "listPositions\|queryEvents\|order.filled" services/xstockstrat-ui/src/hooks/usePortfolio.ts services/xstockstrat-ui/src/hooks/usePositionLineage.ts services/xstockstrat-ui/src/lib/browserClients/ledgerClient.ts`
  — confirm new clients/hooks call the BFF methods.
- Lint: `cd services/xstockstrat-ui && pnpm run lint`

---

### Step 7 — service: Rebuild positions page (pagination, filters, detail + fill lineage)

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/trader/positions/page.tsx` — modify
- `services/xstockstrat-ui/e2e/trader/api-smoke.spec.ts` — modify (add ListPositions/QueryEvents smoke)

**Reviewers**: `xstockstrat-ui` (service owner) — Trading UI correctness, Connect-RPC call safety, environment/trading-mode scope correctness

**Codebase Evidence**:
- Current page `src/app/trader/positions/page.tsx:24-150` is `'use client'`, uses
  `usePositions(mode, selectedAccountId)` (`:28`), `useAccountContext()` (`:25`,
  `src/context/AccountContext.tsx`), renders an unpaginated `<Table>` with no filters
  (`:92-139`) and a mode toggle (`:43-61`). `fmtUsd`/`fmtPct` helpers at `:13-22`.
- E2E smoke pattern confirmed at `services/xstockstrat-ui/e2e/trader/api-smoke.spec.ts`:
  `test.describe('Connect BFF — PortfolioService/GetPortfolio data contract', ...)` at `:90`,
  asserting `body.positions` is an array with `symbol` + numeric `unrealizedPnl` (`:121-138`).

**Instructions**:
1. Rewrite `positions/page.tsx` to use the paginated `usePositions` from Step 6: add filter
   controls (symbol text input, side long/short toggle, account selector — reuse
   `useAccountContext`, P&L-sign winners/losers toggle), Next/Prev page controls driven by
   `nextPageToken`, and keep the existing mode toggle + `fmtUsd`/`fmtPct` helpers.
2. Add a position-detail drill-in (row click → detail panel/route) showing all `Position`
   fields (qty, avg entry, current price, market value, unrealized P&L $/%, cost basis,
   opened-at — all on the enriched `Position` from Step 3). In the detail view, call
   `usePositionLineage` and render the matching `order.filled` events (qty, fill price,
   order_id, occurred_at from each `LedgerEvent`).
3. Add a smoke test to `api-smoke.spec.ts` mirroring the existing GetPortfolio block: assert the
   BFF `PortfolioService/ListPositions` returns a `positions` array, and `LedgerService/
   QueryEvents` returns an `events` array (data-contract level).

**Verification**:
- `grep -n "usePositions\|usePositionLineage\|nextPageToken\|listPositions" services/xstockstrat-ui/src/app/trader/positions/page.tsx`
  — confirm paginated hook + lineage wired.
- E2E: `cd services/xstockstrat-ui && pnpm test:e2e` (no coverage threshold for the UI segment —
  existing Playwright E2E coverage applies; the new `api-smoke.spec.ts` block exercises the new
  BFF data contracts).
- Lint: `cd services/xstockstrat-ui && pnpm run lint`

---

### Step 8 — docs: Update service CLAUDE.md files for new wiring

**Status**: `pending`
**Service**: `docs` (service CLAUDE.md updates)
**Files**:
- `services/xstockstrat-portfolio/CLAUDE.md` — modify (note additive `symbol`/`side`
  `ListPositions` filters)
- `services/xstockstrat-ui` — no dedicated env table to update beyond deployment files (verify)

**Reviewers**: none

**Codebase Evidence**:
- `services/xstockstrat-portfolio/CLAUDE.md:7` documents the paper/live filter set on
  `ListPositions` ("Callers can filter by `trading_mode` on `ListPositions`, ...") — extend this
  to mention the new `symbol` and `side` filters.
- The UI's `LEDGER_ENDPOINT` addition is captured in the deployment files (Step 5); the UI
  CLAUDE.md env section (if any) should list it — verify and update if present.

**Instructions**:
1. In `services/xstockstrat-portfolio/CLAUDE.md`, update the paper/live filter sentence (`:7`)
   to note that `ListPositions` now also accepts additive `symbol` (exact match) and `side`
   (long/short, derived from qty sign) filters.
2. If `services/xstockstrat-ui/CLAUDE.md` enumerates inter-service `*_ENDPOINT` env vars, add
   `LEDGER_ENDPOINT=xstockstrat-ledger:50057`.

**Verification**:
- `grep -n "symbol\|side" services/xstockstrat-portfolio/CLAUDE.md` — confirm filter note added.

---

### Step 9 — docs: Record `trade.filled` → `order.filled` correction + deviations

**Status**: `pending`
**Service**: `docs`
**Files**:
- `docs/roadmap/features/056-open-positions-ui/context.md` — modify (append deviation note)

**Reviewers**: none

**Codebase Evidence**:
- **Product-spec correction (key finding):** FR-4 / Acceptance Criteria 4 / Open Questions all
  say lineage events have `event_type = "trade.filled"`. The **actual** emitted event type is
  `order.filled` (full fill) and `order.partially_filled` (partial), emitted by
  `xstockstrat-trading` with `source_service = "trading"` —
  `services/xstockstrat-trading/internal/service/trading.go:531` (`"order.filled"`) and `:542`
  (`"order.partially_filled"`). There is **no** `trade.filled` event type anywhere
  (`grep -rn "trade.filled" services/` only matches test/spec strings, not an emitter).
- The `order.filled` payload **does carry** the join keys needed for FR-4: `account_id`,
  `user_id`, `symbol`, `qty`, `fill_price`, `trading_mode` — confirmed at
  `trading.go:531-536` and the consumer struct
  `services/xstockstrat-portfolio/internal/service/portfolio_service.go:107-117`
  (`orderFillPayload` with `account_id`, `trading_mode` JSON tags). This resolves the product
  spec's deferred open question ("confirm the fill payload carries account/mode") — **it does**.

**Instructions**:
1. Append a deviation entry to `context.md` recording: (a) lineage uses `order.filled` (+
   `order.partially_filled` for partials), `source_service = "trading"`, not `trade.filled`;
   (b) the payload carries `account_id` + `trading_mode`, so the position↔fill join is
   unambiguous; (c) the portfolio CI coverage exclusion of `repository`/`service` packages, so
   filter logic is validated via extracted pure helpers (Step 4) + UI E2E (Step 7); (d) service
   `ListPositions` now enriches positions with current price / market value / unrealized P&L
   (previously only `GetPortfolio`/`GetPosition` did).

**Verification**:
- `grep -n "order.filled" docs/roadmap/features/056-open-positions-ui/context.md` — confirm the
  correction is recorded.

---

## Deviation Log

### Deviation: Step 2 — codegen via host toolchain (Docker unavailable)
**Spec said**: Run `./scripts/buf-gen.sh` (normally the `Dockerfile.codegen` container per `localenv-setup.sh`).
**Actual**: The runner's Docker daemon is not running, so the codegen toolchain was installed on the host pinned to the CI `proto-freshness` job versions (`.github/workflows/ci.yml`): `buf` v1.47.2, `protoc-gen-go` v1.36.11, `protoc-gen-go-grpc` v1.6.2, `protoc-gen-connect-go` v1.19.2, `grpcio-tools` 1.80.0; the TS plugins (`protoc-gen-es`/`protoc-gen-connect-es`/`protoc-gen-ts_proto`) came from the committed pnpm lockfile. Ran `./scripts/buf-gen.sh` on the host.
**Reason**: No Docker; host toolchain is the sanctioned sequential-mode fallback.
**Disposition**: CI-equivalent fallback. The regen diff was confirmed **limited to `portfolio/v1`** (Go/Python/TS + dist). Host `buf`'s bundled `google/protobuf` descriptors produced an unrelated doc-comment change in `gen/ts/google/protobuf/timestamp.ts`; that drift was reverted so the committed stubs match CI's baseline (which keeps `main-dev`'s `proto-freshness` green).

### Deviation: Step 3 — dynamic SQL predicate builder + account_id fix + sideOf moved to Step 4
**Spec said**: "Add the predicates to each of the four SQL variants"; extract enrichment + (Step 4) a `sideOf` helper.
**Actual**: (a) Replaced the four hardcoded `ListPositions` SQL variants with one equivalent **dynamic predicate builder** (optional `trading_mode`/`account_id`/`symbol` params + static `qty`-sign side filter + the keyset `symbol > pageToken` predicate, `ORDER BY symbol` + `pageSize+1` probe preserved). (b) Service `ListPositions` now forwards `req.AccountId` (the pre-existing drop — **user-approved fix** at execute time) plus `req.Symbol`/`req.Side`, and enriches each position via the new `enrichPosition` helper. The four other `repo.ListPositions` call sites (`GetPortfolio`, `GetPnL`, +2, all in `portfolio_service.go`) were updated to the widened signature with no-filter defaults to keep `go build` green. (c) The `sideOf` helper is added in **Step 4** (with its test) instead of here, so Step 3's stacked PR has no unused-function lint window.
**Reason**: Conditional `symbol`/`side` filters across four positional-param variants combinatorially explode; a builder is correct and maintainable. `sideOf` has no Step-3 production caller (side-filtering is in SQL), so adding it here would fail `golangci-lint unused` until Step 4's test references it.
**Disposition**: in-scope (all edits within Step 3's two `**Files**`; the extra call-site updates are in `portfolio_service.go`). Verified: `go build` + `golangci-lint run` clean.

### Deviation: Step 4 — `sideOf` helper added to `portfolio_service.go` (not just the test file)
**Spec said**: Step 4 `**Files**` is `portfolio_helpers_test.go` only; "Add a pure helper (e.g. `sideOf` …) and table-driven tests".
**Actual**: The `sideOf` helper was added to `services/xstockstrat-portfolio/internal/service/portfolio_service.go` (production), together with its `TestSideOf` + `TestEnrichPosition` tests in `portfolio_helpers_test.go`, in this one step.
**Reason**: A Go helper can't live only in a `_test.go` file and be a "production helper"; and adding it in Step 3 (with no caller yet) failed `golangci-lint unused`. Adding it here, in the same commit as its test, gives every stacked PR an independently lint-green tree.
**Disposition**: in-scope (the paired test step naturally co-locates the tested helper). Verified: `go test` passes (coverage 47.8% ≥ 40%); `golangci-lint run` clean.

### Deviation: Step 7 — e2e mock infra extended + CI-equivalent verification
**Spec said**: Step 7 `**Files**` = `positions/page.tsx` + `e2e/trader/api-smoke.spec.ts`; verify with `pnpm test:e2e`.
**Actual**: (a) Also modified `e2e/mock-backend.ts` (added a `PortfolioService.listPositions` handler + a new `LedgerService.queryEvents` mock on the 9091 trader mock) and `playwright.config.ts` (added `LEDGER_ENDPOINT: 127.0.0.1:9091`) — the new `ListPositions`/`QueryEvents` smoke tests get a 200 only if the mock backend implements those RPCs. (b) The Playwright dev-server harness timed out (>320s cold-compile + mock startup) so behavioral e2e could not complete locally.
**Reason**: The e2e smoke step is meaningless without mock handlers for the RPCs it exercises; the dev-server cold-compile flake is the same one documented in `playwright.config.ts` (CI uses a production build).
**Disposition**: in-scope test-infra + CI-equivalent fallback. The page rewrite, mock, spec, and config are all type-checked by `tsc --noEmit` (the app tsconfig `include` covers `e2e/**/*.ts`) and `pnpm run lint` — both clean. CI's production-bundle e2e run is the authoritative behavioral gate.
</content>
</invoke>

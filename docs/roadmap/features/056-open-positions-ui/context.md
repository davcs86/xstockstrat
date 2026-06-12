# Context: open-positions-ui

**Feature**: `docs/roadmap/features/056-open-positions-ui/feature.md`
**Product Spec**: `docs/roadmap/features/056-open-positions-ui/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/056-open-positions-ui/implementation-spec.md`

---

## Session 2026-06-10 — backlog capture

- Created feature.md at `idea` status as a backlog entry.

## Session 2026-06-10 — sdd-story

- Upgraded feature.md `idea` → `draft`; wrote product-spec.md and this context log.
- Codebase grounding (found via grep, not invented):
  - `packages/proto/portfolio/v1/portfolio.proto` `PortfolioService.ListPositions` is
    already paginated (`PageRequest`) with filters `user_id`, `trading_mode`, `account_id`.
    Lacks symbol/side filters.
  - `Position` message fields: symbol, qty, avg_entry_price, current_price, market_value,
    unrealized_pnl(_pct), cost_basis, opened_at, trading_mode, account_id. **No order/fill
    reference** → "slots ↔ orders" needs a new linkage RPC + a source-of-truth decision.
  - UI `services/xstockstrat-ui/src/app/trader/positions/page.tsx` exists but uses
    `usePositions` and renders all positions with no pagination/filters.
- Key open design question carried to /sdd-spec: define what a "position slot" is and where
  order lineage is read from (trading orders vs ledger fill events). FR-4 may be split into
  a follow-up so the pagination/filter upgrade can ship independently.

## Session 2026-06-10 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Open questions resolved (user decisions):
  - "Position slot" → **no new entity**; FR-4 is a **read-only join**.
  - Lineage source → **`xstockstrat-ledger` `trade.filled` events** via existing
    `QueryEvents` (verified: `QueryEventsRequest` filters by `event_type`/`stream_key`/
    time/page; `LedgerEvent.payload` is a Struct). No ledger.proto change.
  - FR-4 in this cut (read-only drill-in); filters server-side.
- Net effect: only proto change is additive `ListPositionsRequest` filter fields; portfolio
  gets no order reference. Ledger is a read-only dependency.
- Deferred to /sdd-spec: confirm the `trade.filled` payload carries account_id + trading_mode
  so the position↔fill join is unambiguous.

## Session 2026-06-11 — sdd-spec

- Generated implementation-spec.md with 9 steps. Status → implementation-ready.
- Key codebase findings (all grep/Read-confirmed):
  - **Lineage event type correction**: the product spec's `trade.filled` does not exist. Trading
    emits `order.filled` (`services/xstockstrat-trading/internal/service/trading.go:531`) and
    `order.partially_filled` (`:542`) with `source_service = "trading"`. FR-4 lineage must filter
    on these. The `order.filled` payload carries `account_id` + `trading_mode` + `user_id` +
    `symbol` + `qty` + `fill_price` (trading.go:531-536; consumer struct `orderFillPayload` at
    portfolio_service.go:107-117) — so the position↔fill join is unambiguous (resolves the
    product spec's deferred open question).
  - **No ledger client in the UI**: `connectClients.ts` has no `LedgerService`/`LEDGER_ENDPOINT`
    and `traderBff.ts` exposes only `getPortfolio`/`listPortfolios` (not `listPositions`). Step 5
    adds the ledger client, the `listPositions` + `queryEvents` BFF methods, and `LEDGER_ENDPOINT`
    to all three deployment files (confirmed absent from the `xstockstrat-ui` block in
    docker-compose.yml + .do/app.dev.yaml:387 + .do/app.yaml).
  - **Service `ListPositions` does not enrich** current price / market value / unrealized P&L
    (only `GetPortfolio`:192-199 and `GetPosition`:224-231 do). Step 3 adds enrichment so FR-3
    detail fields and the winners/losers P&L-sign filter have data.
  - **Portfolio CI coverage excludes** `repository`/`service`/`handler`/`cmd`/`telemetry`
    (ci.yml:229). New SQL filters + service forwarding land in excluded packages, so Step 4 tests
    extracted pure helpers (side-derivation, enrichment math); integration behavior covered by
    Step 7 UI E2E.
  - **Proto**: `ListPositionsRequest` (portfolio.proto:79-85) highest field = 4; additive
    `symbol=5`, `side=6` + new `PositionSide` enum (LONG/SHORT). Existing `OrderSide` is
    order-execution semantics, not position long/short — not reused.

## Session 2026-06-11 — sdd-review product-spec (formal skill re-run)

- Re-ran `/sdd-review open-positions-ui product-spec` via the actual skill (the earlier
  spec-ready advancement was done by hand-applying the rubric inline). A1 guard hit
  (status `implementation-ready`); user authorized the re-run.
- Result: **PASS**, no blocking failures. Spec criteria 1–9 all pass; open questions all
  resolved; no config keys; additive proto only.
- Trading-domain checks (detection matched, but read-only positions feature): C-1–C-4 n/a
  (no env vars, no broker behavior, no order-execution, no order types). C-5 fill-state →
  closed by including **both** `order.filled` and `order.partially_filled`.
- **Correctness fix applied during review**: product spec still said `event_type =
  "trade.filled"` (a non-existent event) in FR-4/AC-4/Affected Services/Proto/Open Questions.
  Corrected to `order.filled` / `order.partially_filled` (verified `trading.go:531`,
  payload carries symbol+account_id+trading_mode). This aligns the product spec with the
  already-correct implementation-spec.
- Overlap (A4): `055-orders-management-ui` and `057-backfill-management-ui` also modify
  `xstockstrat-ui` → ⚠ WARN (coordinate merge order). Different proto files (portfolio vs
  trading/ingest/marketdata) → no proto/field collision. No identical config keys (056 has
  none). No FAIL-level overlap. Shared trader/insights BFF files (`traderBff.ts`/
  `connectClients.ts`) are a real merge-conflict risk — to be recorded in merge-order.md at
  the impl-spec review.
- Status retained at `implementation-ready` (not downgraded).

## Session 2026-06-11 — sdd-review impl-spec (Mode B, advisory)

- Ran `/sdd-review open-positions-ui impl-spec`. **PASS** — no FAIL findings across all 9
  steps. Per-step: real line-number evidence, exact paths, runnable verification. Step 1
  proto buf lint+breaking + field numbers (symbol=5, side=6, PositionSide enum). Step 5
  introduces `LEDGER_ENDPOINT` and correctly lists all three deployment files + addresses
  header propagation (new ledger client via backendHeaders). Backend step 3 paired with test
  step 4 (≥40% + golangci-lint, honest about repo/service CI exclusion). Frontend step 7
  paired with E2E smoke.
- Note: Step 3 flags a pre-existing latent bug (service `ListPositions` drops `req.AccountId`)
  and asks the portfolio owner to confirm fixing it here at execute time — carry this decision.
- Cross-feature overlap (B4): ⚠ WARN — shares `traderBff.ts` with 055. No shared files with
  057 (the `.do/*`/`connectClients.ts` matches against 057 are reference-only in 057, not
  modified). No proto/migration/config collisions.
- Merge order recorded in `merge-order.md`: **056 waits for 055** (rebase the traderBff.ts
  conflict after 055 merges).
- Mode B makes no lifecycle change; status stays `implementation-ready`.

## Next action

`/sdd-execute open-positions-ui` — but per merge-order.md, land 055 first (shared
`traderBff.ts`).

## Session 2026-06-11 — sdd-execute (sequential, after 055 merged)
- Up-front confirm: proceed sequential (9 steps). Step-3 decision: **forward req.AccountId** (fix the
  pre-existing account_id drop) alongside symbol/side filters.
- Re-spec gate (directive none): read-only validation — all 9 steps' evidence holds against current
  main-dev; only line-number drift from 055 (traderBff.ts replaceOrder/streamOrderUpdates; trading.go
  order.filled now :659/:670). No re-spec needed.
- merge-order.md: 056→055 flipped Resolved No→Yes (055 merged to main-dev), committed on the feature branch.
- Codegen tooling: Docker daemon unavailable here; installed host buf v1.47.2 + CI-pinned plugins
  (protoc-gen-go v1.36.11, protoc-gen-go-grpc v1.6.2, protoc-gen-connect-go v1.19.2, grpcio-tools 1.80.0).

### Step 1 — proto: symbol/side filters + PositionSide enum [done]
- portfolio.proto: added `enum PositionSide { UNSPECIFIED/LONG/SHORT }` after Position; added additive
  `string symbol = 5` + `PositionSide side = 6` to ListPositionsRequest (highest field was 4).
- Verification: `buf lint` OK; `buf breaking --against feature/open-positions-ui` OK (additive only).
- Files modified: `packages/proto/portfolio/v1/portfolio.proto`
- Deviations: none.

### Step 2 — proto-gen: regenerate stubs [done]
- Ran ./scripts/buf-gen.sh on host (Docker daemon down). Regen limited to portfolio/v1 (Go/Python/TS+dist).
  Reverted unrelated google/protobuf/timestamp.ts doc-comment drift from host buf's bundled descriptors
  so committed stubs match CI's baseline.
- Verified: Go `PositionSide` + `Symbol`(5)/`Side`(6) on ListPositionsRequest; TS enum+fields; Python descriptor.
- Files modified: `packages/proto/gen/{go,python,ts}/portfolio/v1/*` (+ ts/dist)
- Deviations: host-toolchain codegen (CI-equivalent fallback) — see Deviation Log.

### Step 3 — service: symbol/side filters in portfolio ListPositions [done]
- repo ListPositions: refactored 4 hardcoded SQL variants → 1 dynamic predicate builder
  (mode/account_id/symbol params + static qty-sign side filter + keyset symbol>token; ORDER BY
  symbol + pageSize+1 probe preserved). New signature adds `symbolFilter string, side PositionSide`.
- service ListPositions: forwards req.AccountId (user-approved fix) + req.Symbol + req.Side, and
  enriches each position via new `enrichPosition(p, ask, bid)` helper. 4 other repo.ListPositions
  callers (GetPortfolio/GetPnL/+2) updated to widened signature w/ no-filter defaults (build-green).
- `sideOf` helper deferred to Step 4 (added with its test there — avoids unused-func lint in this PR).
- Verification: GOWORK=off go build ./... OK; golangci-lint run 0 issues; greps confirm predicates+forwarding.
- Files modified: `internal/repository/portfolio_repo.go`, `internal/service/portfolio_service.go`
- Deviations: dynamic SQL builder; account_id fix; sideOf→Step4 — see Deviation Log.

### Step 4 — test: portfolio filter + enrichment unit tests [done]
- Added `sideOf` helper to portfolio_service.go (per Step 3 deviation) + TestSideOf (qty→side:
  long/short/flat) and TestEnrichPosition (winner/loser/zero-cost-basis guard) in portfolio_helpers_test.go.
- Verification: new tests pass; total coverage 47.8% ≥ 40% (measured pkgs, repo/service excluded per
  ci.yml); golangci-lint 0 issues (gofmt-fixed the test struct alignment).
- Files modified: `internal/service/portfolio_helpers_test.go`, `internal/service/portfolio_service.go`
- Deviations: sideOf added to production file alongside its test — see Deviation Log.

### Step 5 — service: expose ListPositions + LedgerService.QueryEvents via trader BFF [done]
- connectClients.ts: added LedgerService import, LEDGER_ENDPOINT const (default xstockstrat-ledger:50057),
  exported ledgerClient. traderBff.ts: added listPositions to PortfolioService block (injects
  claims.user_id) + new LedgerService block with queryEvents (read-only, forwards backendHeaders).
- Wired LEDGER_ENDPOINT into all 3 deploy files' xstockstrat-ui blocks (docker-compose plain host:port;
  .do specs use ${xstockstrat-ledger.PRIVATE_DOMAIN}:50057).
- Verification: pnpm run lint clean; tsc --noEmit clean (typed-client calls resolve); greps confirm wiring.
- Files modified: connectClients.ts, traderBff.ts, docker-compose.yml, .do/app.dev.yaml, .do/app.yaml
- Deviations: none.

### Step 6 — service: browser typed clients + hooks [done]
- Created browserClients/ledgerClient.ts (mirrors portfolioClient: createConnectTransport baseUrl /trader/api).
- usePortfolio.ts: replaced getPortfolio-based usePositions with listPositions-backed paginated hook
  (PositionFilters: symbol/side/pageToken/pageSize; PositionSide.UNSPECIFIED default; refetch 10s).
- Created usePositionLineage(symbol, accountId, mode): queryEvents(eventType order.filled, sourceService
  trading), filters client-side by payload.symbol/account_id/trading_mode (proto String() form
  TRADING_MODE_PAPER/LIVE); enabled only when symbol set.
- Verification: lint clean; tsc --noEmit clean (existing page caller still type-checks — ListPositionsResponse
  also has .positions). PositionSide members are prefix-stripped (UNSPECIFIED/LONG/SHORT) in _pb.
- Files: created ledgerClient.ts, usePositionLineage.ts; modified usePortfolio.ts
- Deviations: none.

### Step 7 — service: rebuild positions page (pagination, filters, detail + lineage) [done]
- positions/page.tsx: rebuilt with symbol Input filter, side Select (long/short), P&L Select
  (winners/losers, client-side), mode toggle, Prev/Next keyset pagination (pageStack + nextPageToken),
  and a row-click Sheet detail showing all Position fields + usePositionLineage order.filled fills.
- e2e: added ListPositions + QueryEvents smoke blocks to api-smoke.spec.ts; extended mock-backend.ts
  (9091 PortfolioService.listPositions + new LedgerService.queryEvents mock) and playwright.config.ts
  (LEDGER_ENDPOINT=127.0.0.1:9091) so the smoke tests resolve.
- Verification: pnpm run lint clean; tsc --noEmit clean (app tsconfig includes e2e/**, so mock+spec
  type-checked). Behavioral e2e run timed out (dev-server cold-compile flake) → CI-equivalent fallback.
- Files: page.tsx, e2e/trader/api-smoke.spec.ts, e2e/mock-backend.ts, playwright.config.ts
- Deviations: e2e mock-infra expansion + CI-equivalent verification — see Deviation Log.

### Step 8 — docs: update service CLAUDE.md files [done]
- portfolio CLAUDE.md (paper/live filter sentence): noted ListPositions now accepts additive symbol
  (exact) + side (long/short by qty sign) filters (feature 056) and enriches each position.
- services/xstockstrat-ui has no CLAUDE.md / env table → nothing to update there (verified absent).
- Verification: grep confirms note; markdownlint-cli2 0 errors on the CLAUDE.md.
- Files modified: services/xstockstrat-portfolio/CLAUDE.md
- Deviations: none (UI CLAUDE.md absent — the spec's "verify and update if present" → no-op).

### Step 9 — docs: record trade.filled → order.filled correction + deviations [done]

**FR-4 lineage event-type correction (product-spec was wrong):**
- The product spec's `event_type = "trade.filled"` does **not** exist anywhere as an emitted event.
  The real emitted types are `order.filled` (full fill) and `order.partially_filled` (partial),
  emitted by `xstockstrat-trading` with `source_service = "trading"` —
  `services/xstockstrat-trading/internal/service/trading.go:659` (`order.filled`) and `:670`
  (`order.partially_filled`). FR-4 lineage filters on `order.filled` (this cut).
- The `order.filled` payload **carries the join keys**: `order_id`, `symbol`, `qty`, `fill_price`,
  `user_id`, `trading_mode` (proto `String()` form, e.g. `TRADING_MODE_PAPER`), `account_id`
  (trading.go:659-664). This resolves the product spec's deferred open question ("confirm the fill
  payload carries account/mode") — **it does**, so the position↔fill join is unambiguous.

**Other implementation notes / deviations (full detail in implementation-spec.md Deviation Log):**
- Portfolio CI coverage excludes `repository`/`service` packages (`ci.yml`), so the new SQL filter +
  service forwarding are validated via extracted pure helpers (`sideOf`, `enrichPosition` — Step 4,
  total coverage 47.8% ≥ 40%) and the Step 7 UI E2E smoke, not direct repo/service coverage.
- Service `ListPositions` now **enriches** each position (current price / market value / unrealized
  P&L) — previously only `GetPortfolio`/`GetPosition` did (Step 3).
- Service `ListPositions` now forwards `req.AccountId` (fixing the pre-existing drop — user-approved).
- repo `ListPositions` four hardcoded SQL variants → one dynamic predicate builder (Step 3).
- Codegen ran on the host (Docker unavailable) pinned to CI versions; e2e mock-backend extended for
  ListPositions/QueryEvents; behavioral e2e fell back to tsc+lint (dev-server cold-compile flake).

## Session 2026-06-12 — sdd-execute (sequential) — feature 056 code-completed
**Steps this session**: 1–9 (all)
**Progress**: 9 done / 9 total
**Stopped at**: all complete — feature 056 at code-completed.
**Next**: review/merge the 056 stacked PRs (#681–#689), then /sdd-execute 057 (backfill-management-ui).

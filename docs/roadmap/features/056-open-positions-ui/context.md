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

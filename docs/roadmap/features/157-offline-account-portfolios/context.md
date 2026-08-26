# Context: offline-account-portfolios

**Feature**: `docs/roadmap/features/157-offline-account-portfolios/feature.md`
**Product Spec**: `docs/roadmap/features/157-offline-account-portfolios/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/157-offline-account-portfolios/implementation-spec.md`

---

## Session 2026-08-26 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from the user
  story: "Offline account portfolio tracking, same integrations as current account portfolios. Order
  confirmations are editable by UI or MCP."

### Grounding (codebase-discovery, 2 subagents)

- **Accounts** live in `xstockstrat-trading` as `BrokerAccount` (`packages/proto/trading/v1/trading.proto:197`,
  table `trading.broker_accounts` via `migrations/002_broker_accounts.up.sql`). The only account
  discriminator today is the `BrokerType` provider enum (`packages/proto/common/v1/common.proto:68`:
  `ALPACA=1`, `IBKR=2`). `credentials_enc` is `NOT NULL`; `RegisterBrokerAccount` requires
  `credentials_json`; `resolveAccount`/pollers assume a live `broker.Broker` client per account
  (`internal/service/trading.go` broker pool `s.brokers`, `instantiateBrokerLocked:2413`,
  `syncPositions:1731`). **No offline/manual account type exists.**
- **Integrations** = the per-account `broker.Broker` client (`internal/broker/broker.go:66`) driven by
  background pollers (fill/position/balance/credential-health/reconciliation), which emit ledger
  events `order.filled`, `account.positions.synced`, `account.balance.synced`.
- **Portfolio** (`xstockstrat-portfolio`) is ledger-sourced: positions/P&L per `account_id` from
  `ConsumeOrderFills`/`ConsumePositionSyncs`/`ConsumeBalanceSyncs`. Tables `portfolio.positions`
  (account_id since `003_positions_account_id`, default `'alpaca-default'`), `portfolio.account_balances`
  (`004_account_balances`). RPCs `ListPositions`, `ListPortfolios`, `GetPnL`, etc.
- **Orders** (`trading.orders`, `migrations/001_orders_hypertable`): a fill is represented on the Order
  via `filled_qty`/`filled_avg_price` + `status`; fills arrive **async from the broker** (`pollFills`).
  **There is no "order confirmation" concept** — no `ConfirmOrder` RPC, no `CONFIRMED` status, no
  confirmations table. `ReplaceOrder` edits a *working* order's qty/limit/stop/TIF (broker-routed) and
  is not a fill-write. UI order surface already exists: `/trader/orders` (`OrderForm`, `OrdersTable`,
  `EditOrderDialog` → `useReplaceOrder`), BFF `src/lib/traderBff.ts`.
- **MCP agent** (`xstockstrat-agent/app/tools.py`, 28 tools) has **no order-management tool** and **no
  trading gRPC client / `TRADING_ENDPOINT`** — "editable by MCP" requires wiring a trading client +
  new tool into the agent (and the tool-count sync across the six inventory surfaces per the agent
  reviewer focus).

### Design forks deferred to /sdd-design (recorded as Open Questions)

1. Offline as a new `BrokerType` value vs. a separate account-source field.
2. Order-confirmation write as a new `ConfirmOrder`/`SetOrderFill` RPC vs. extending `ReplaceOrder`.
3. Offline position valuation source (marketdata mid-quotes) and how offline equity/cash is seeded
   (`portfolio.account_balances` is normally fed by `account.balance.synced`, never emitted offline).
4. MCP scope: full offline-account CRUD vs. order-confirmation editing only.

### Known traps folded into the spec (from docs/roadmap/ledger/fails.md)

- Dual valuation read paths (`ListPositions` vs `ListPortfolios`/`buildAccountPortfolio`) must both
  handle offline valuation — a prior feature added valuation to only one and they silently disagreed
  (fails.md 2026-08-06, feature 056).
- No unfixed "follow-up" gaps — `add-ikbr-account-support` left a documented gap (missing `user_id` in
  a synced payload) that became a production bug (fails.md 2026-08-05).
- Verify proto fields exist server-side before forwarding them (fails.md 2026-08-05, broker-accounts-ui).

### SDD entry-point compliance

Per root CLAUDE.md "Mandatory Entry Point": running `/sdd-story` → next `/sdd-design quick` before any
code. This task arrived as a plain "implement X, commit and push"; treated as a request for the
capability, not a waiver of the pipeline.

---

## Session 2026-08-26 — sdd-design

- Phase 0 Recon: wrote recon.md (services: trading, portfolio, ui, agent, packages/proto). Key reuse
  patterns: `account.positions.synced` → `ConsumePositionSyncs` absolute self-heal; `enrichPositions`
  mid-quote valuation on both read paths; `useReplaceOrder`/`useInvalidatingMutation` UI mutation;
  `manage_watchlist` ownership-scoped agent tool.
- Phase 1 Grilling: **4 rounds (full debate)**. Chosen approach: offline = `BROKER_TYPE_OFFLINE=3`,
  single `s.brokers` pool with a type-skip flag; offline-only `ConfirmOrder` recomputes absolute
  positions from all confirmed orders and emits `account.positions.synced` **only** (never
  `order.filled`); realized P&L at account grain (`portfolio.offline_account_realized` table) surfaced
  on the per-account card via `Portfolio.realized_pnl`; shorts via the existing signed fold; shared
  `packages/proto/pnl` Fold refactors trading + portfolio onto one implementation.
  Rejected: parallel offline map; incremental `order.filled` fold; signed-delta emission; per-position
  realized; `GetPnL` Pass 3; `deregistered` flag on the sync event; `ReplaceOrder` extension;
  golden-vectors-only; a dedicated set-positions reconcile capability.
- Constitution rules touched: C-04, C-07, C-08, C-09, C-10, C-13, C-14, C-15, C-16, C-03, P-06, F-01,
  F-04, F-07. Floor breaches: none (all 4 rounds APPROVE-blocked only on non-Floor objections, all
  resolved).
- Status: draft → design-approved.

### Operator decisions (this session, via AskUserQuestion)

- Account model = **new `BROKER_TYPE_OFFLINE` enum value**.
- Confirmation API = **new offline-only `ConfirmOrder` RPC**.
- Offline equity = **derived from positions** (marketdata mid-quotes; no `account_balances` row).
- **Realized P&L in v1** and **shorts in v1** (both chosen over the minimal defer options).
- Monthly statement reconciliation = **a Claude task that corrects drift via order edits** using this
  feature's tools (no dedicated set-positions capability). Ultimate goal: a scheduled email-processing
  task (record/confirm orders) + a monthly statement-sync task. **I am building the platform capability
  only** — not setting up the scheduled Routines (operator will wire them after 157 ships).
- Approval = **"fix all review warnings, then approved"** — all round-4 adversary objections folded in.

### C-15 / C-16 sign-off — @AC-7 amended (recorded per C-16)

The absolute-recompute model (operator-chosen at the round-2 gate, "Run another round with the
absolute recompute approach") means offline emits `account.positions.synced`, not `order.filled`.
`@AC-7` was amended accordingly (was "an order.filled ledger event is emitted"; now asserts
`account.positions.synced` + the positions outcome + "no order.filled emitted"). Added scenarios
`@AC-10..@AC-15` (re-edit idempotency, sell-to-close removal, sell-to-open short, realized survives
wipe + shown on card, broker P&L unaffected, deregister purge). `@AC-*` IDs remain append-only.

### Round-4 warnings folded in (all fixed before approval)

1. Shared `pnl` golden/parity tests live in the **consuming service** test modules (no CI job runs
   `go test` in `packages/proto/`); + a governance carve-out note in `packages/proto/CLAUDE.md`.
2. Portfolio's `applyFill`/`realizedDelta`/test refactored onto shared `Fold` **in the same PR** (two
   impls = 056 drift), gated by a characterization test + cross-service golden-vector parity test.
3. `Portfolio.realized_pnl` is **`optional`** (proto3 presence → 0-vs-unset); UI Stat gated on account
   type == OFFLINE.
4. Deregister cleanup via a **dedicated `account.deregistered` event** (not a flag on the sync event).
5. `offline_account_realized` upsert **outside** the `processPositionSync` positions loop, gated
   `RealizedPnl != nil`.
6. Realized populated on **both** `buildAccountPortfolio` (ListPortfolios) **and** `GetPortfolio`
   (separate build path) with a parity assertion.

### Named follow-ups (C-14 — not vague "later")

- `offline-broker-card-realized` — surface realized P&L on **broker** account cards (requires fixing
  `GetPnL` account-blindness). Offline-only realized is expected in v1.
- Offline crash-recovery resync — offline self-heal is confirm-triggered only (no poller); a resync
  path is a possible follow-up if staleness after a mid-confirm crash proves material.

### Grounding verified this session

- `Order` fields 1–21 (`intent_state=21`) → `filled_at = 22` next-free.
- `Portfolio` fields 1–11 → `realized_pnl = 12` next-free.
- `GetPortfolio` (`portfolio_service.go:459`) is a **separate** build path from `buildAccountPortfolio`
  (`:1036`) → realized must be populated in both (parity).
- Migration numbers `trading 008` / `portfolio 012` free on active `origin` branches (spot-scan;
  `/sdd-review` runs the full feature-overlap scan).
- `packages/proto/go.mod` = `github.com/xstockstrat/contracts`, in `go.work`, `replace`d by both
  trading and portfolio `go.mod` → a sibling `pnl/` package resolves under `GOWORK=off` with no new
  wiring; `proto-freshness` only diffs `gen/`.

### Renumber 156 → 157 (2026-08-26)

This feature was scaffolded as `156` before `156-fix-fundamentals-signal-producer` (PR #1014) merged
to `main-dev` and claimed that number. Per `docs/runbooks/feature-workflow.md` § Feature Numbering
(collision → renumber the later one to the next free NNN), the branch was rebased onto the new
`main-dev` and the directory renamed to `157-offline-account-portfolios`. The slug (and thus the git
branch and PR) is unchanged; only the `NNN` prefix and the self-referential path lines in this file,
`implementation-spec.md`, and the `insights.md` ledger entry were updated.

---

## Session 2026-08-26 — sdd-spec

- Generated implementation-spec.md with **15 steps**. Status → `implementation-ready`.
- Consumed recon.md + design.md as authoritative inputs (chosen approach followed; rejected
  alternatives off the table). Every step cites grep-verified `path:line` (C-01).
- Key codebase findings (grounded this session, beyond recon):
  - **Every `s.brokers` site enumerated** in `trading.go` for the offline-skip guard: `LoadBrokerPool`
    (:205/:225), `resolveAccount` sole-account fallback (:269/:281-286), `pollFills` (:1136/:1138-1143),
    `reconcileTick` (:1393/:1394-1399), `syncPositions` (:1731/:1736-1741), `checkCredentialHealth`
    (:2062/:2063-2068), `flattenAndHalt` (:2176-2177), bracket watchdog `checkBracketProtection`
    (:2281), `DeregisterBrokerAccountSvc` delete (:2402-2404), `LoadInflightOrders` (:247, broker-id
    gated). `brokerPoolEntry.brokerType` is the existing discriminant (already read at trading.go:610).
  - **ConfirmOrder guard is order-sourced**: `TradingRepo.GetOrder` (trading_repo.go:104) SELECT already
    lists `user_id` + `broker_type` (:106-109) — no broker call needed to reject broker accounts.
  - **Proto field numbers confirmed free**: `Order.filled_at = 22` (fields 1–21 used), `Portfolio`
    `realized_pnl = 12` (fields 1–11 used, declared `optional` for presence), `BrokerType_OFFLINE = 3`.
  - **Migrations**: trading last `007_broker_accounts_halt_source` → `008`; `credentials_enc BYTEA NOT
    NULL` at 002_broker_accounts.up.sql:8; `trading.orders` has no `filled_at` (001_orders_hypertable).
    Portfolio last `011` → `012` for `offline_account_realized`.
  - **Shared `pnl` package resolves with zero wiring**: both trading & portfolio go.mod:10,41 require
    `github.com/xstockstrat/contracts v0.0.0` + `replace => ../../packages/proto`; contracts module is
    `github.com/xstockstrat/contracts` → sibling `packages/proto/pnl/` is `.../contracts/pnl`.
  - **Portfolio fold to extract**: `realizedDelta` (portfolio_service.go:519) + `applyFill` closure
    (:551-578); `processPositionSync` realized upsert lands after `DeletePositionsNotInSync` (:930),
    gated `RealizedPnl != nil`; dual read paths `buildAccountPortfolio` (:1036) + `GetPortfolio` (:459).
  - **`account.positions.synced` emit shape** to mirror: trading.go:1813-1818 / portfolio
    `positionSyncPayload` :862-883 (add `RealizedPnl *float64`).
  - **Agent** has no trading client: `client.py:19-25` endpoint consts (`TRADING_ENDPOINT` absent),
    per-call channel pattern :293-311; six tool-count surfaces 28→29; env absent from docker-compose.yml
    /.do/app.yaml/.do/app.dev.yaml/agent CLAUDE.md.
- Every `@AC-1..@AC-15` mapped to a covering test step (see § Scenario Coverage in the spec).

## Session 2026-08-26T05:21Z — sdd-review impl-spec (advisory)

- Result: 0 failures, 3 warning classes, 2 notes (advisory — did not block). No Floor (`F-*`) risk;
  F-01 and F-07 explicitly honored. Overlap scan: CLEAN (trading 008 / portfolio 012 next-free; proto
  field numbers BrokerType=3, Order.filled_at=22, Portfolio.realized_pnl=12 all uncontested; no shared
  source path with in-flight features 158/142). This gate had been skipped before execution began;
  run now after steps 1–4 (proto + migrations, all additive) were committed.
- Unresolved ✗ / ⚠ carried into execution:
  - Step 13: agent tool-count baseline is drifted — `app/tools.py` docstring already reads
    "Twenty-nine tools" but only 28 `@server.tool()` decorators exist (pre-existing docstring drift,
    NOT feature 158, which does not touch the agent). At execute time, count actual tools and
    reconcile ALL six inventory surfaces (docstring, decorators, agent CLAUDE.md table, mcp-tools.md,
    test_tools_endpoint.py name-set, GET /api/tools) to the true post-add count. — [ ] unaddressed
  - Step 7: add an explicit "other order types unaffected" note to satisfy the B2b order-type
    exhaustiveness check (offline record path is order-type-agnostic; no broker branch). — [ ] unaddressed
  - Steps 2/6/8/9/13/14: wildcard/dir `Files` entries (`gen/**`, `*_test.go`, `internal/service/*`,
    `tests/test_*.py`) trip the B2 exact-paths criterion; defensible for generated/test output —
    name concrete files where known. — [ ] advisory, low priority
- Overlap findings: none.

## Session 2026-08-26 — sdd-execute (implementation)

- Implemented all 15 steps on branch `claude/features-157-158-impl-ulk0l2` (harness-assigned; the
  designated single branch for features 157+158, per the task's branch requirement — not the
  per-feature `feature/offline-account-portfolios` branch the spec header names).
- Tool-count reconciliation (carried warning from the impl-spec review): the true agent baseline was
  **29** registered tools (the docstring/CLAUDE.md/name-set all said 29; the earlier "28" was a bad
  `@server.tool()` grep that missed one decorator form). Adding `manage_offline_account` → **30**;
  all six inventory surfaces updated to 30. [x] resolved.
- Step 7 order-type note (carried warning): the offline record path is order-type-agnostic (no broker
  branch); documented in `recordOfflineOrder`. [x] resolved.
- E2E note: the Playwright suite's shared `warmup.setup.ts` SSR pre-warm times out on cold start in
  the CI-less sandbox; the offline spec was verified with `--no-deps` (3/3 green). CI runs the full
  suite with a prebuilt bundle.

### Named follow-ups (C-14 — not vague "later")

- **`offline-broker-card-realized`** — surface realized P&L on **broker** account cards too. Requires
  fixing `GetPnL`'s account-blindness (it aggregates across all of a user's accounts rather than
  scoping to one `account_id`). Offline-only realized is the deliberate v1 scope; the offline path
  uses the account-grain `offline_account_realized` table, which broker accounts do not populate.
- **Offline crash-recovery resync** — offline positions self-heal only on a ConfirmOrder recompute
  (there is no poller for offline accounts). A resync path (e.g. a boot-time recompute from confirmed
  orders) is a possible follow-up if staleness after a mid-confirm crash proves material in practice.

## Session 2026-08-26 (CI: feature status automation)

- Promotion PR #1027 merged to main
- Feature promoted and committed: 65aeaa4c5bb7c000dfb4e30d5b788d6c39352234
- Status updated: `code-completed` → `launched`
- Launched date: 2026-08-26

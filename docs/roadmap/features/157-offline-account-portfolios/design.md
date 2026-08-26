# Design: offline-account-portfolios

**Created**: 2026-08-26
**Rounds**: 4 (full debate; termination: approved — "fix all review warnings, then approved")
**Approved by**: user @ 2026-08-26
**Grounded in**: recon.md

---

## Chosen Approach

An **offline account** is a new `common.v1.BrokerType` value `BROKER_TYPE_OFFLINE = 3` (recon.md
"Dependencies"). It is a full account variant that reuses the existing per-`account_id` portfolio
integrations; the only thing it lacks is a broker. Manual **order confirmations** — entered/edited
from the `/trader` UI and a new MCP agent tool — supply the fill information a broker would otherwise
report, and offline positions/P&L flow through the **same** portfolio consumer the broker-sync path
uses.

### Account model & routing (trading)

- Offline accounts register into the **existing** `s.brokers` pool with `client=nil,
  brokerType=OFFLINE` (`brokerPoolEntry.brokerType` already exists — recon.md "Codebase Map"). **Not**
  a parallel map (rejected round 1). Every poller and lookup that ranges/keys `s.brokers` — `pollFills`,
  `checkCredentialHealth`, `syncPositions`, `reconcileTick`, `resolveAccount`'s sole-account fallback,
  `LoadInflightOrders`, bracket watchdog — **skips on `entry.brokerType == BROKER_TYPE_OFFLINE`** so a
  nil broker client is never dereferenced. The impl spec enumerates every `s.brokers` site + its guard
  (no "any other path" — round-2 P-03 fix); the natural guards (`broker_order_id == ""`,
  `ListSubmittedOrders` requires a broker id) are documented but not solely relied upon.
- `RegisterBrokerAccount` gets an offline branch: skip `json.Valid`/`EncryptCredentials`/
  `instantiateBrokerLocked`/credential validation; store `credentials_enc = NULL`.
  `UpdateBrokerAccountCredentials` and credential-health reject/skip OFFLINE.
  `ListBrokerAccounts` maps OFFLINE with `CredentialStatus` UNSPECIFIED (@AC-1).
- **Record path** reuses `PlaceOrder` with an early offline branch (before `resolveAccount`): keep the
  `client_order_id` dedup (feature 101) for idempotent record; **documented deliberate skip** of broker
  submit, sizing (`ComputePositionSize`), brackets, and the halt/trading-state gates (manual
  bookkeeping, no broker touched). Persists a NEW order, empty `broker_order_id`.

### Editable confirmation & absolute recompute (the correctness core)

- New offline-only `rpc ConfirmOrder(ConfirmOrderRequest) returns (Order)`. Guard is **order-sourced**
  (`GetOrder` already selects `broker_type` + `user_id`): reject `FailedPrecondition` if
  `broker_type != OFFLINE` or `user_id != caller` (FR-8/@AC-9). Derive `status` from `filled_qty` vs
  `qty` (server-derived, never client-supplied); persist `filled_qty`/`filled_avg_price`/`filled_at`.
- **`Order` += `google.protobuf.Timestamp filled_at = 22`** (fields 1–21 used; `intent_state=21`).
  Migration persists `orders.filled_at`.
- Because confirmations are **editable**, positions cannot use the incremental, non-idempotent
  `order.filled` fold (`processOrderFill` — double-counts on re-edit, mis-signs sells, and there is no
  broker snapshot to self-heal offline — round-1/2 finding). Instead, `ConfirmOrder` **recomputes the
  account's absolute net positions from ALL its confirmed offline orders** and emits the self-healing
  `account.positions.synced` event that portfolio's `ConsumePositionSyncs` →
  `UpsertPositionFromSync` + `DeletePositionsNotInSync` already applies absolutely
  (`portfolio_service.go:887`). **Invariant (impl-spec must pin): `ConfirmOrder` MUST NOT emit
  `order.filled`** — that is what keeps GetPnL Pass 1/2 and `ConsumeOrderFills` from ever double-folding
  offline (round-3 disjointness proof).
- **Concurrency & safety (round-2 fixes):** a **per-account lock** wraps persist→recompute→emit
  (request-driven confirm lacks the poller's one-goroutine-per-account serialization, so it would
  otherwise lost-update). A **failed recompute query emits nothing** (an empty snapshot would make
  `DeletePositionsNotInSync` wipe the account); only a *successful* empty fold emits `positions:[]`.
  Fold order is **`ORDER BY filled_at ASC, created_at ASC`** (economic order — the BUY/SELL/BUY
  sequence is non-commutative). The emit runs on the **inbound request ctx** (C-03: propagates
  `x-user-id`/`x-trace-id`); payload carries `user_id` (the add-ikbr regression trap) and an
  **environment-derived `trading_mode`** (offline has no `client.IsPaper()`), asserted equal to the
  order-record mode and the `ListPositions` query mode.

### Shorts (signed fold) — reuses existing math

- Net-negative positions are supported: the signed average-cost + flip-through-zero fold already
  exists as `applyFill`/`realizedDelta` (`portfolio_service.go:508-581`). `Position` carries **signed
  qty**; `PositionSide` (LONG/SHORT) is filter-only and already wired; the UI already renders shorts
  (`sideLabel`, Short filter). So shorts need **no proto/UI/migration** — only the recompute allowing
  net-negative + dropping any oversell guard. Unrealized for a short falls out of the signed formula.

### Shared P&L fold — extraction (round-4 fork A → A1)

- The signed fold + realized accumulation moves into **one hand-written, dependency-free (float-math)
  Go package `packages/proto/pnl/`** (`github.com/xstockstrat/contracts/pnl`), exposing
  `Fold(fills) → (positions, realized)` + `realizedDelta`. Both services already `require` that module
  with a local `replace` (verified: `services/xstockstrat-{trading,portfolio}/go.mod:10,41`; `go.work`),
  so import resolves under `GOWORK=off` with **zero** new go.mod/replace/CI wiring, and `proto-freshness`
  only diffs `packages/proto/gen/` so a sibling `pnl/` dir is untouched.
- Trading's `ConfirmOrder` recompute calls `pnl.Fold`. **Portfolio's `applyFill`/`realizedDelta` and the
  test `computeRealizedPnL` are refactored onto the same package in this PR** — leaving two fold
  implementations is the worse option (the 056 dual-source drift trap, recon.md Risks). The refactor is
  guarded by a **characterization test pinning portfolio's current outputs green before the swap** and a
  **cross-service golden-vector parity test**.
- **CI-execution fix (round-4a):** the golden/parity tests live in the **consuming service test modules**
  (portfolio's migrated `computeRealizedPnL` test + a trading test) — there is no CI job that runs
  `go test` inside `packages/proto/`, so a `pnl`-internal test would never execute. A one-line
  **governance carve-out** is added to `packages/proto/CLAUDE.md` noting the module hosts a small
  hand-written `pnl` helper (context-scrubber teardown). Fallback if the proto owner rejects mixing
  non-generated code: a standalone `packages/pnl` module (own `go.mod` + `replace` in both services + a
  CI `go-lint` entry) — see Rejected Alternatives.

### Realized P&L display (round-4 fork B → B1)

- Realized lives at **account grain** in a new table `portfolio.offline_account_realized`
  (`account_id` PK, `user_id`, `trading_mode`, `realized_pnl`; portfolio migration `012`) — **not**
  per-position `realized_accum`, which `DeletePositionsNotInSync` deletes when a position closes
  (round-3 finding). Trading computes cumulative account realized in the same recompute and ships it as
  a **nil-able JSON pointer `realized_pnl`** on the existing (schemaless `Struct`) `account.positions.synced`
  payload — no proto change to the event. Portfolio's `processPositionSync` upserts it **outside the
  positions loop, gated `RealizedPnl != nil`, after `DeletePositionsNotInSync`** (round-4 fix 1) — so a
  flat/full-close recompute still records realized, and broker syncs (pointer always nil) never touch
  the table (disjoint by construction).
- **Consumer surface (C-14):** realized is read account-grain inside **both** `buildAccountPortfolio`
  (`:1036`, serves `ListPortfolios`) **and** `GetPortfolio` (`:459`, a *separate* build path — round-4
  fix f parity) and returned on a new **`optional double realized_pnl = 12`** field on `Portfolio`
  (`optional` for proto3 presence so offline-$0 is distinguishable from broker-unset — round-4 fix d).
  Rendered as a "Realized P&L" `Stat` on `PortfolioPanel.tsx`, **gated on account type == OFFLINE**
  (primary guard against a fake $0 on broker cards), through the existing `ListPortfolios` BFF path.
  Broker-card realized is a **named follow-up feature** (`offline-broker-card-realized`), not v1 (C-14).

### Deregister cleanup (round-4 fix e)

- Deregistering an offline account emits a **dedicated `account.deregistered` lifecycle event** (not a
  `deregistered:true` flag overloaded onto the snapshot event — that multiplexes lifecycle state onto a
  valuation event and muddies the append-only audit). Portfolio consumes it to purge the account's
  positions and `DeleteOfflineRealized`. Blast radius is small (portfolio is the only consumer of the
  offline sync path).

### Consumer surfaces (C-14)

- **UI `/trader`:** `BROKER_TYPE_OFFLINE` in `brokerLabel`, an OFFLINE option in `AddAccountForm` that
  hides the credential fields, the `AccountsModule` broker filter, a `useConfirmOrder` hook (copies
  `useReplaceOrder`) + a confirm control on the existing `orders/[id]` page (no new route → C-10 nav
  untriggered), a BFF `ConfirmOrder` handler (copies `replaceOrder` session-user injection), the
  realized Stat above. Enum-consumer sweep across every exhaustive `switch`/`Record<BrokerType>` with a
  frontend build check in the proto step (round-1 C-10 fix).
- **Agent MCP:** add `TRADING_ENDPOINT` (client.py + `docker-compose.yml` + `.do/app.yaml` +
  `.do/app.dev.yaml` + agent CLAUDE.md), trading gRPC wrappers (copy the portfolio per-call channel
  pattern), and a new ownership-scoped tool (copies `manage_watchlist`) covering **create offline
  account / record order / confirm order**, plus a **read** of the offline account's orders/positions
  so the user's monthly statement-reconciliation task can diff and correct via order edits (the stated
  ultimate goal — reconciliation is a Claude task using these tools, not a platform set-positions path).
  Update all **six** tool-count inventory surfaces (28→29) + the `mcp-tools.md` per-tool block.

## Rejected Alternatives

- **Parallel `s.offlineAccounts` map** — rejected (round 1): duplicates the account-existence source,
  causes the sole-account-fallback collision it flagged against itself, risks divergence across
  `s.brokers`/`s.halted`/`s.orders`. Single pool + type flag reuses the locked enum discriminant.
- **Extend `ReplaceOrder` for fills** — rejected: it is broker-routed and edits only working orders'
  qty/limit/stop/TIF; a fill-write is a different, non-broker operation.
- **Incremental `order.filled` fold for offline positions** — rejected (round 1–3): non-idempotent, so
  editable confirmations double-count / mis-sign sells with no broker snapshot to self-heal.
- **Signed-delta `order.filled` emission** — rejected (round 1): cannot represent an average-price-only
  edit (delta qty = 0), so it fails true editability.
- **Per-position `positions.realized_accum` for offline realized** — rejected (round 3): the row is
  deleted by `DeletePositionsNotInSync` on close, losing realized. Account-grain table survives wipes.
- **Surface realized via `GetPnL` Pass 3** — rejected (round 4): `GetPnL` ignores `req.AccountId`
  (account-blind) and has no non-generated caller; using it either bleeds broker realized into an
  offline card or ships speculative account-filter plumbing. `buildAccountPortfolio` is per-account by
  construction.
- **`deregistered:true` flag on `account.positions.synced`** — rejected (round 4): overloads a
  valuation snapshot with a lifecycle command; a dedicated `account.deregistered` keeps audit semantics
  honest.
- **`pnl` fold copied into trading only (portfolio left as-is)** — rejected (round 4): leaves two fold
  implementations = the 056 drift trap. Full extraction with both services routed through it is the DRY
  fix.
- **Standalone `packages/pnl` module** — deferred as the fallback if the proto owner rejects a
  hand-written helper in the contracts module: cleaner on purity, but adds a new `go.mod` + two
  `replace` directives + a new CI `go-lint` entry for no functional gain given the `replace`/`go-lint`
  trigger already covers `packages/proto/`.
- **Golden-vectors-only, keep 3 fold copies (fork A2)** — rejected (round 4): still triplicates the
  subtle flip-through-zero math and hits the same module boundary; extraction removes the duplication
  the test already flags as a standing risk.
- **Dedicated "set absolute positions from statement" reconcile capability** — rejected (user
  decision): the monthly statement reconciliation is a Claude task that corrects drift via the same
  editable order-confirmation tools; positions stay purely order-derived.

## Open Risks

- [ ] **Crash between `UpsertOrder` commit and emit** leaves the order FILLED but positions stale, and
  offline has no poller to self-heal — state corrects only on the next confirm/re-confirm for that
  account. Accepted for v1: document that offline self-heal is confirm-triggered. Target: trading
  `ConfirmOrder` step (document) — revisit a resync path in a follow-up if needed.
- [ ] **`packages/proto/pnl` governance** — hand-written logic in the contracts module is a concern,
  not a breach; resolved by the carve-out note + service-hosted tests. If the proto owner objects at
  review, fall back to the standalone `packages/pnl` module. Target: shared-fold step.
- [ ] **Broker-card realized asymmetry** — offline cards show realized, broker cards do not in v1.
  Named follow-up `offline-broker-card-realized`. Target: realized-display step (record the follow-up).
- [ ] **`GetPnL` account-blindness** is pre-existing and left untouched (no offline caller). Named
  follow-up if per-account `GetPnL` is ever wanted. Target: none this feature.

## Constitution Rules Touched

- **C-04** — honored: `BROKER_TYPE_OFFLINE = 3` additive with the enum's existing `_UNSPECIFIED=0`;
  `Portfolio.realized_pnl` is `optional` to carry proto3 presence (0-vs-unset).
- **C-09 / F-04** — honored: all proto additions additive; `buf lint`/`buf breaking` + `buf-gen.sh` in
  the proto step; every cited path is grep-verified (no invention).
- **C-07 / F-01** — honored: new numbered migrations only (trading `008`, portfolio `012`); no edit to
  applied `.up.sql`. Verified free on active `origin` branches.
- **C-03** — honored: `ConfirmOrder` recompute/emit runs on the inbound request ctx; the agent→trading
  wrapper forwards `x-user-id` (copies `manage_watchlist` `_metadata`).
- **C-08 / P-06** — honored: each service step pairs a test step; characterization + cross-service
  golden-vector parity tests for the shared fold; RED-before-green.
- **C-10** — honored: (a) enum-consumer sweep across every `BrokerType` switch + frontend build check;
  (b) realized parity across `buildAccountPortfolio` **and** `GetPortfolio` with a parity assertion; the
  offline valuation lands on both `ListPositions` and `ListPortfolios` via the shared `enrichPositions`.
- **C-13** — honored: Go fixtures in `internal/testdata/`; UI fixtures extend `e2e/fixtures/accounts.ts`
  using proto field `id` (the `accountId`-vs-`id` mock trap).
- **C-14** — honored: UI `/trader` + agent tool named and stepped; deferred broker-card realized points
  at a named follow-up.
- **C-15** — honored: `acceptance.feature` amended (`@AC-7` now asserts `account.positions.synced`) and
  extended with realized/shorts/idempotency/deregister scenarios; every FR covered.
- **F-07** — honored: no hardcoded config; no new config keys.

## Business Rules Touched (C-16)

- PRESERVE `@AC-7/@AC-8/@AC-13` (`services/xstockstrat-ui/acceptance/watchlist-opportunity-signal-cues.feature`)
  — offline positions render on the shared `/trader/positions/[symbol]` page; the breadcrumb/firing-cue
  guarantees are not regressed (no edit to that page's breadcrumb/cue logic).
- No existing durable acceptance suite for `xstockstrat-trading`/`xstockstrat-portfolio` yet — this
  feature's scenarios become the first promoted guarantees at launch (C-16 write side).
- **CHANGE (this feature's own scenario, signed off):** `@AC-7` is amended from "an `order.filled`
  ledger event is emitted" to "an `account.positions.synced` event is emitted / the positions outcome
  holds" — required by the locked absolute-recompute model; user sign-off recorded in context.md
  (round-2 gate, "Run another round with the absolute recompute approach").

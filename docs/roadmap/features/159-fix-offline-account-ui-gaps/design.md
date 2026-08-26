# Design: fix-offline-account-ui-gaps

**Created**: 2026-08-26
**Rounds**: 1 (quick) + a root-cause investigation phase + user steering; termination: approved
**Approved by**: user @ 2026-08-26
**Grounded in**: recon.md

---

## Chosen Approach

Three surfaces — `xstockstrat-ui`, `xstockstrat-trading`, `xstockstrat-portfolio`. **No proto,
migration, or config change.** The order-ticket defect is closed at *both* the UI (right affordance)
and the trading layer (authoritative correctness), because recon proved a UI gate alone cannot
guarantee FR-2.

### A. Order ticket — FR-1/FR-2 (UI + trading)

**UI (`OrderForm.tsx` / the `/trader` order-ticket mount).** Derive the selected account and
`isOffline` from `useAccountContext()` (`accounts.find(a => a.id === selectedAccountId)` +
`brokerType === BrokerType.OFFLINE`, the canonical pattern at `accountShared.tsx:282`, identical to
`PortfolioPanel`'s `showRealized` gate `PortfolioPanel.tsx:28`). When `isOffline`, **replace** the
broker BUY/SELL ticket with a **dedicated minimal "Record order" control**: symbol / side / quantity /
optional fill price only — **no order-type, TIF, limit, stop, or trailing-stop inputs**. It submits via
the existing `usePlaceOrder` → `placeOrder` BFF (`usePlaceOrder.ts:7-12`, `traderBff.ts:29-35`) with
the **explicit** offline `account_id`. A dedicated control (not the reused broker form) is required
because broker validation — trailing-stop at `trading.go:359-367` — runs *before* the offline branch
(`:388`), so a reused form with Order Type = Trailing Stop would `InvalidArgument` and never persist
NEW (adversary obj #3). This control ships **only on `/trader`**; the insights `SignalOrderTicket`
mount (`SignalOrderTicket.tsx:19,24`, its own `AccountProvider` defaulting to the first active account,
`AccountContext.tsx:36-40`) is **deliberately excluded** — a signal→order ticket is broker-execution
context — and a test asserts the record affordance does *not* appear there (C-10(a) both-instances).

**Trading guard B — authoritative routing (`PlaceOrder`).** Today `PlaceOrder` routes solely on the
in-memory pool entry's `brokerType` (`resolveAccount` reads only `s.brokers`, `trading.go:285-317,388`)
and never re-reads the persisted account type. Add a read of the **authoritative** persisted type via
`s.accountRepo.GetBrokerAccount(ctx, resolvedAccountID)` (`account_repo.go:47,104-117`) right after
`resolveAccount` (~`:377`), and route to `recordOfflineOrder` when the persisted `broker_type` is
OFFLINE — so a pool/DB divergence (only reachable via out-of-band state, but real) cannot misroute an
offline order to a broker.

**Trading guard A — cancel guard (`CancelOrder`).** `CancelOrder` currently sets
`ORDER_STATUS_CANCELED` **unconditionally** at `trading.go:1079` with no offline / terminal /
empty-`broker_order_id` precondition (the broker cancel above it *is* gated, `:1036`, but the local
transition is not). Add a guard so an **offline order** (persisted `broker_type` OFFLINE and/or empty
`broker_order_id`) cannot be flipped to CANCELED via this path — closing the latent FR-2 violation. The
exact user-facing semantics (reject with `FailedPrecondition` — "offline orders are managed via
ConfirmOrder, not broker-cancel" — vs. an explicit offline-cancel that never routes through the broker
reconcile) is pinned in `/sdd-spec`; default is **reject**.

**Tests (FR-2 correctness — adversary obj #2/#6).** Go tests in trading: `PlaceOrder` on an
OFFLINE-persisted account → `recordOfflineOrder` → `ORDER_STATUS_NEW`, empty `broker_order_id`; and
`CancelOrder` on an offline order → guarded (not CANCELED). These cover the "persisted NEW, never
CANCELED" guarantee that the Playwright mock (hardcoded `placeOrder` → FILLED, `mock-backend.ts:202-208`)
provably cannot. The e2e (`offline-accounts.spec.ts`, @AC-1) asserts the broker ticket is absent and the
Record-order control is present for an offline account — the UI-testable half only.

### B. Portfolio card — FR-3 (UI)

In `PortfolioPanel.tsx` single-account branch, compute `isOffline` (the `showRealized` gate at `:28`
already reads exactly this) and wrap **Cash (`:49-52`), Buying Power (`:53-56`), Day P&L (`:57-61`),
Total P&L (`:62`)** in `!isOffline`. Keep Equity (`:45-48`, offline equity = summed position market
value, `portfolio_service.go:1056`), the positions list + unrealized (`:71-90`), and Realized P&L
(`:63-69`, already gated). Offline card then shows exactly the FR-3 set.

### C. Combined / all-accounts view — FR-4 (portfolio + UI)

Per the user decision, the offline account is **shown in the combined view as a card with only
meaningful fields**, excluded from cash/buying-power aggregates — not merely absent.

**Portfolio (`ListPortfolios` all-accounts branch, `portfolio_service.go:1120-1139`).** Today it
enumerates accounts from `account_balances` only (`ListAccountBalancesByUser`, `portfolio_repo.go:451-457`),
so offline accounts (no balances row) are entirely absent — the `ListPositions`↔`ListPortfolios` C-10(b)
parity divergence (fails 056). Change the enumeration to the **union** of `account_balances` account ids
∪ offline account ids (a new repo read, e.g. `ListOfflineAccountIdsByUser`, sourced from
`portfolio.positions` and/or the `offline_realized` table). `buildAccountPortfolio` already handles
`bal == nil` (Cash/BP/DayPnl → 0, equity → summed position MV, realized from the offline row), so each
offline account builds correctly; the summed cash/BP aggregate naturally excludes them (their values are
0), and offline equity contributes to combined equity (FR-4's "may contribute"). Add a **parity test**:
an offline account surfaces in both `ListPositions` and `ListPortfolios` (C-10(b)).

**UI (combined cards, `PortfolioPanel.tsx:111-148`).** Once the backend includes offline portfolios, the
combined card renders; apply the same `!isOffline` field gating (matching each `Portfolio.account_id`,
field 11, to the accounts list via `useAccountContext`, since `Portfolio` proto carries no offline
marker — recon) so the offline card shows only meaningful fields.

---

## Rejected Alternatives

- **Reuse the full broker `OrderForm` in "record" mode** — rejected: trailing-stop validation runs
  before the offline branch (`trading.go:359-367` vs `:388`) → `InvalidArgument` for an offline
  Trailing-Stop submit; also leaves broker-only inputs (order type, TIF, limit/stop, brackets) shown,
  meaningless for a hand-confirmed offline fill.
- **UI gate only, no trading guard** — rejected: cannot guarantee FR-2. The unconditional
  `CancelOrder:1079` transition and pool-tag-only routing can still CANCEL/misroute an offline order
  (adversary obj #1/#2).
- **Route `PlaceOrder` solely on the in-memory pool tag (status quo)** — rejected: a pool/DB
  `broker_type` divergence would misroute an offline order to a broker; the authoritative read closes it.
- **FR-4 assert-only, offline stays absent from the combined view** — rejected by the user: the offline
  account should be *visible* in combined with meaningful-only fields, and the absence is itself the
  C-10(b) parity defect (fails 056).
- **Bare hide/disable of the broker ticket, defer the record affordance to a follow-up** — rejected by
  the user: build the dedicated in-UI Record-order control now.

## Open Risks

- [ ] The exact staging incident (Hypothesis A — stray `CancelOrder` on a NEW-offline order; vs B —
  routed to a broker via a non-OFFLINE pool tag) is **unconfirmed** (no order-row query tool available).
  Both are code-reachable and both are now guarded, so FR-2 holds regardless. If the operator later
  provides the row (`broker_order_id` empty/set, order `broker_type`), confirm which fired and that the
  guard covers it — to be verified at `/sdd-execute` with the paired Go tests.
- [ ] `CancelOrder` guard semantics (reject vs. explicit offline-cancel) — decide in `/sdd-spec`;
  default reject (`FailedPrecondition`).
- [ ] Trading and portfolio service steps must meet the ≥40% CI coverage threshold — paired Go tests
  planned; verify at execute.

## Constitution Rules Touched

- `C-08` / `P-06` — honored by: each trading + portfolio `service` step gets a paired Go `test` step
  (red-before-green); the UI record-affordance/card gets e2e coverage (@AC-1/2/3).
- `C-10(a)` — honored by: `OrderForm`'s two mount points are both decided — record affordance on
  `/trader`, explicitly excluded on insights `SignalOrderTicket`, with a test asserting the exclusion.
- `C-10(b)` — honored by: the `ListPositions`↔`ListPortfolios` offline parity divergence is closed
  (offline accounts included in the combined enumeration) with a parity test (the fails 056 rule).
- `C-14` — honored by: consumer surface named and reached — `/trader` (Record-order control + portfolio
  card + combined card); insights deliberately excluded with a reason; the agent `record_order` tool is
  unchanged (already the offline write path).
- `C-12` / `C-13` — honored by: reuse `BROKER_ACCOUNT_OFFLINE` / `PORTFOLIO_OFFLINE` fixtures and extend
  `e2e/trader/offline-accounts.spec.ts`; new Go test data via trading/portfolio `internal/testdata`.
- `C-04` / `C-09` (no proto), `C-07` / `F-01` (no migration), `C-05` / `F-07` (no config) — not
  triggered; the fix reuses the existing offline contracts.
- **Floor**: none breached (targets the feature branch; no direct push; no invented paths — all cited).

## Business Rules Touched (C-16)

No durable business-rule suites exist yet for trading/portfolio (feature 157's offline scenarios are
un-promoted — 157 is `code-completed`, not `launched`), so there is nothing to regress. This feature
**EXTENDS** the offline behavior 157 introduced (adds the record affordance, the combined-view offline
card, the authoritative routing + cancel guards). On launch, promote @AC-1/2/3/4 into the trading,
portfolio, and ui durable suites (C-16 write side).

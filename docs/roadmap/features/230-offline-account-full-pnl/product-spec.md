# Product Spec: offline-account-full-pnl

**Created**: 2026-10-19

---

## Problem Statement

Offline (`BROKER_TYPE_OFFLINE`, manually recorded) accounts show only Equity and a since-snapshot
realized P&L. Day P&L is hard-coded to 0, there is no Total P&L or account return %, short positions
report 0% unrealized, commissions cannot be recorded, every snapshot erases realized history, and a
symbol with no live quote marks at 0. A trader cannot judge an offline account's performance the way
they can a broker account's.

## User Story

As a trader who tracks accounts offline (recorded orders + periodic position snapshots), I want the
same P&L picture a broker account gives me — today's P&L, total P&L and return, fees, and realized
P&L both since the last snapshot and over the account's lifetime — so that offline accounts are as
informative as broker accounts.

## Functional Requirements

FR-1. **Day P&L (broker-style)** per offline position and per account, for the current US-equity
trading session (America/New_York session date):
  - shares held from before the session: `(mark − previous_close) × qty_held_overnight`;
  - shares acquired during the session: `(mark − fill_price) × qty_acquired_today`;
  - plus, for sells/covers whose `filled_at` falls in the session, `(fill_price − previous_close) × qty`
    for overnight shares (or `(fill_price − same-session buy price) × qty` for shares bought that
    session) — i.e. the session's change, **not** realized-vs-average-cost.
  `previous_close` is the prior session's daily-bar close from `xstockstrat-marketdata`.
  `day_pnl_pct` = `day_pnl / |previous-session market value of the position|` (0 when that base is 0).

FR-2. **Total P&L + return %** on the offline account: `total_pnl = realized_gross_since_snapshot +
unrealized` (gross of fees; the net figure is FR-3). Account `total_pnl_pct = total_pnl / |open cost
basis|`; position `unrealized_pnl_pct = unrealized / |cost basis|` so that **short positions report a
non-zero, correctly signed %** (today 0%). When open cost basis is 0 (fully flat) the % is 0.

FR-3. **Fees as a separate line.** `ConfirmOrder` accepts an optional per-order total `fees` (≥ 0,
default 0; negative rejected `INVALID_ARGUMENT`). Re-confirming an order replaces its fees along with
the fill (existing replace semantics). Fees are **never** folded into cost basis / avg entry price.
The account exposes `fees_since_snapshot`, `fees_lifetime`, and realized P&L **gross and net** of fees
(`net = gross − fees`) for both the since-snapshot and lifetime scopes.

FR-4. **Realized P&L, two scopes.** Keep the feature-163 since-snapshot realized (a new snapshot resets
it to 0 — 163 AC-14 still holds) **and** add a lifetime realized that is carried across snapshots:
`lifetime = carried_at_last_snapshot + since_snapshot`, where taking a snapshot adds the then-current
since-snapshot realized (and fees) into the carried amount before resetting. Lifetime realized survives
any number of snapshots and is only changed by fills/fee edits within the current snapshot window.

FR-5. **Mark fallback.** When marketdata has no live quote for an offline position's symbol (weekend,
halted, delisted, non-Alpaca), mark it at the latest daily-bar close and flag the position's mark as
stale (mark source = LAST_CLOSE, with the bar's timestamp). A position is never marked at 0 because of a
missing quote; if neither a quote nor any bar exists, the position is flagged unpriced and excluded
from unrealized/day/total sums (it does not zero or fail the account read). Broker-account marks are
unchanged.

FR-6. **Surfaces.** The FR-1..FR-5 figures are rendered on: the `/trader` PortfolioPanel single-account
and combined views, the `/trader/portfolio` Book offline card, the `/trader/positions` list rows and
`/trader/positions/[symbol]` detail (Day P&L per row, correct short %, stale-mark indicator); and
returned by the agent tools `get_positions`/`get_positions_by_account_id` and `manage_offline_account`
(`list_positions` fields; `confirm_order` new optional `fees` argument).

FR-7. **Backfill.** On rollout, existing confirmed offline orders have `fees = 0`; each existing offline
account's lifetime realized is seeded equal to its current since-snapshot realized (carried amount 0).
No reconstruction of pre-snapshot history.

FR-8. **No regression on broker accounts.** Broker (Alpaca/IBKR) account P&L, marks, Day P&L, and
`GetPnL` results are unchanged.

## Out of Scope

- Including offline realized P&L in the `GetPnL` aggregate or `/insights` P&L Patterns
  (`portfolio.position.closed` emission for offline closes).
- A cash / capital-base / deposits ledger for offline accounts (Cash, Buying Power stay hidden).
- Dividends, corporate actions, FIFO / tax lots, options or OCC symbols.
- Per-position realized P&L history or a P&L time series.
- Fees on snapshot baselines (`SnapshotOfflinePositions`).
- Updating the out-of-repo `trade-confirm-ingest` skill (no in-repo owner; noted as a follow-up).

## Affected Services

- `packages/proto` — additive fields on `ConfirmOrderRequest` (trading) and `Portfolio`/`Position`
  (portfolio); possibly on the `account.positions.synced` payload.
- `xstockstrat-trading` — persist per-order fees; offline recompute folds fees and emits since-snapshot
  + lifetime realized/fees; `SnapshotOfflinePositions` carries realized/fees into the lifetime amount.
- `xstockstrat-portfolio` — store lifetime realized + fees; compute broker-style Day P&L, Total P&L,
  return %, short %; last-close mark fallback with stale flag for offline positions.
- `xstockstrat-marketdata` — consumed for previous-session and latest daily-bar close (existing
  `QueryBars`/latest-bar read path expected; confirm in recon — no new vendor calls).
- `xstockstrat-ui` — render the new figures on the four `/trader` surfaces.
- `xstockstrat-agent` — `manage_offline_account confirm_order` `fees` arg; response mapping for new fields.

## Consumer Surface(s)

- [x] **UI** — `xstockstrat-ui` `/trader`: PortfolioPanel (single + combined) shows Day P&L, Total
  P&L/%, Realized (since snapshot / lifetime, gross & net), Fees for offline accounts;
  `/trader/portfolio` Book offline card gains the same summary; `/trader/positions` and
  `/trader/positions/[symbol]` show Day P&L, signed short %, and a stale-mark indicator. All existing
  routes — no new subnav entry (C-10 unaffected).
- [x] **Agent** — `xstockstrat-agent`: `manage_offline_account` (`confirm_order` gains optional `fees`;
  `list_positions` returns day P&L / mark provenance), `get_positions`, `get_positions_by_account_id`
  (new response fields). No new tool (tool count unchanged).
- [ ] **None**

## Proto Contract Changes

Additive only (non-breaking); exact field numbers fixed at `/sdd-spec`:
- `trading.v1.ConfirmOrderRequest` — `optional double fees`.
- `trading.v1.Order` (or the offline order read shape) — `fees` so `get_order`/`list_orders` echo it.
- `portfolio.v1.Portfolio` — `optional double realized_pnl_lifetime`, `optional double fees_since_snapshot`,
  `optional double fees_lifetime`, `total_pnl_pct` (if not already present); existing `realized_pnl`
  keeps since-snapshot gross semantics. Net figures derived (UI/agent) or explicit — decide in design.
- `portfolio.v1.Position` — mark provenance (`MarkSource` enum: `MARK_SOURCE_UNSPECIFIED`, `QUOTE`,
  `LAST_CLOSE`, `BROKER`, `NONE`) + `mark_as_of` timestamp.

## Config Key Changes

- [x] No new config keys (session timezone is a platform constant; revisit in design if a key is needed).

## Database Changes

- `xstockstrat-trading`: new migration — `fees NUMERIC NOT NULL DEFAULT 0` on the offline fill/order
  table (default satisfies FR-7).
- `xstockstrat-portfolio`: new migration — lifetime/carry + fees columns on
  `portfolio.offline_account_realized` (or a sibling table), seeded per FR-7.
- Where the "carried at last snapshot" amount lives (trading baseline row vs portfolio table) is a
  design decision — see Open Questions.

## Feature Workflow Notes

Branch to create: `feature/offline-account-full-pnl` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking proto or config change)
- [ ] 2 service owners + platform lead (breaking proto change)
- [x] DBA review + service owner (schema migration)

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

- [ ] **Operator override of feature 163** — lifetime realized carried across snapshots overrides 163's
  "no carry-forward" decision; 163's since-snapshot reset (AC-14) is preserved, not removed. Sign-off
  recorded in `context.md` (2026-10-19).
- [ ] **Where the carry lives.** Trading owns the fold and the baseline; portfolio owns
  `offline_account_realized`. The carry must be written atomically with the baseline replace under the
  per-account lock (fails.md:2029-2040, the 163 snapshot-lock entry) — design must pick the owner so a crash
  between "carry += since" and "reset since" can neither double-count nor lose realized.
- [ ] **Editing an order confirmed before the current snapshot** — such fills are excluded from
  `FoldFrom` today; should a re-confirm of a pre-snapshot order adjust lifetime realized, be rejected,
  or be silently ignored? (Default proposal: reject with `FAILED_PRECONDITION`.)
- [ ] **Day P&L intraday basis** requires distinguishing overnight vs same-session shares under signed
  average cost, without lots. Proposal: same-session sells consume overnight shares first. Confirm that the fold can
  expose `qty_at_session_open` and the session's sell proceeds.
- [ ] **Previous-close read path** — confirm marketdata exposes a batched latest/previous daily close
  (avoid N per-symbol calls; ledger quote-fanout-batching entry: state the partial-failure aggregate).
- [ ] **Known trap (fails.md 172):** `portfolio.snapshots.equity` is cashless mark-to-market — do not
  reuse it as a basis for any new offline metric without reading its writer.
- [ ] **Known trap (fails.md 157):** an agent tool-arg change must keep all six tool-inventory surfaces
  and `docs/runbooks/mcp-tools.md` in parity; verify against the registered name-set, not a grep.

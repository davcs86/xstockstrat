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

## Definitions

- **Session** — a US-equity regular trading session, keyed by its America/New_York calendar date.
  The **reference session** for a read is the session in progress at read time, or — on a weekend,
  holiday, pre-open or post-close read — the most recently completed session.
- **previous_close** — the daily-bar close of the session immediately before the reference session.
- **Signed quantity** — `q > 0` long / buy, `q < 0` short / sell. All P&L formulas below use signed
  quantities, so one formula covers longs, shorts, sells and covers.
- **Overnight shares** — the signed position at the start of the reference session
  (`q_open`). Shares seeded by a `SnapshotOfflinePositions` baseline whose `as_of` falls inside the
  reference session count as overnight shares (part of `q_open`). **Same-session fills** — confirmed
  fills with `filled_at` inside the reference session.
- **Mark** — the price an offline position is valued at. During a live session: the live mid-quote,
  else the FR-5 fallback. Outside a live session: the reference session's daily close when that bar
  exists (`MARK_SOURCE_LAST_CLOSE`); if it is not yet available (e.g. just after the close), the live
  mid-quote, else the FR-5 fallback. So off-session Day P&L is always "reference-session close vs the
  close before it" whenever that bar exists.

## Functional Requirements

FR-1. **Day P&L (broker-style)** per offline position and per offline account, for the reference
session. Same-session fills that **reduce** the position consume **overnight shares first**; only the
excess (and any fill that increases the position) is treated as same-session shares. With
`q_red` = signed overnight quantity reduced in-session (same sign as `q_open`), `q_ovn = q_open − q_red`
(overnight shares still held), and for each same-session lot `j` that remains held, signed qty `q_j` at
fill price `p_j`; same-session lots closed in-session realize `(exit_fill − p_j) × q_j_closed`:
  - `day_pnl = (mark − previous_close) × q_ovn`
  - `+ Σ_reductions (fill_price − previous_close) × q_red_i`
  - `+ Σ_held_same_session_lots (mark − p_j) × q_j`
  - `+ Σ_closed_same_session_lots (exit_fill − p_j) × q_j_closed`
  (e.g. a cover of an overnight short below the previous close is a gain: `(190 − 200) × (−10) = +100`).
  Day P&L is the session change, **not** realized-vs-average-cost. The overnight-first rule only
  attributes shares between the terms. The position's and account's `day_pnl` totals are the same
  under any consumption order when every overnight term has a `previous_close`; otherwise (missing
  reference prices, below) the overnight-first rule decides the result (AC-40).
  **Missing reference prices:** an overnight term needs `previous_close`. If the symbol has no daily
  bar for the session before the reference session (halted, newly listed, data gap), its overnight
  terms are 0 and excluded from `base`; same-session-lot terms still apply. A `MARK_SOURCE_NONE`
  (unpriced) position contributes nothing to `day_pnl` or `base`.
  Position `day_pnl_pct = day_pnl / base`, where `base = |q_open × previous_close| + Σ|p_j × q_j|`
  over same-session acquisitions; account `day_pnl_pct = Σ day_pnl / Σ base`. Either is 0 when its
  base is 0. Outside a live session the figures are those of the most recently completed session
  (last close vs the close before it), until the next session opens. A symbol fully closed during the
  reference session no longer has a position row, but its reduction and closed-lot terms and its `base`
  are still included in the account `day_pnl` and `day_pnl_pct`.

FR-2. **Total P&L + return %** on the offline account: `total_pnl = realized_gross_lifetime +
unrealized` (gross of fees; lifetime per FR-4, so Total P&L does not drop at a snapshot). Account `total_pnl_pct = total_pnl /
Σ_i |cost_basis_i|` over open priced positions (so a mixed long/short book never nets to a 0
denominator); 0 when that sum is 0 (fully flat). Position `unrealized_pnl_pct = unrealized /
|cost_basis|`, so a short reports a non-zero, correctly signed %. The `|cost_basis|` fix applies
**platform-wide** in portfolio's shared position enrichment (it also corrects order-fill-valued broker
shorts — the one deliberate broker-visible change, carved out of FR-8).

FR-3. **Fees as a separate line.** `ConfirmOrder` accepts an optional per-order **cumulative** total
`fees` (≥ 0, default 0; negative → `INVALID_ARGUMENT`, order unchanged). Every (re-)confirm — full or
partial — replaces the order's fees along with its fill (existing replace semantics); FILLED vs
PARTIALLY_FILLED status derivation is unchanged. A (re-)confirm that **omits** `fees` leaves the order's
recorded fees unchanged (0 if none were ever recorded); only an explicit value, including 0, replaces
them, so a fees-unaware client cannot silently wipe fees. An offline order that has never been
confirmed (status NEW) has no fees value. A NEW order after an un-confirm keeps its last fees and
`filled_at` internally; neither is shown while it is NEW; a never-filled NEW order has no `filled_at`
(design.md §2.3, AC-48). Likewise, re-confirming an **already-confirmed** order without
`filled_at` keeps its stored `filled_at`; only a first confirm defaults it to now, so a fee-only edit
can never move a frozen-window order into the current window (operator decision 2026-10-19). Fees are **never** folded into cost basis or average
entry price. The offline account exposes `fees_since_snapshot`, `fees_lifetime`, and realized P&L **gross and net**
of fees (`net = gross − fees`) for both the since-snapshot and lifetime scopes. Orders read back via
`GetOrder`/`ListOrders` echo `fees`; it is unset (not 0) for broker orders.

FR-4. **Realized P&L, two scopes.** Keep the feature-163 since-snapshot realized (a new snapshot resets
it to 0 — 163 AC-14 still holds) **and** add a lifetime realized carried across snapshots:
`lifetime = carried + since_snapshot`. A new snapshot `S` stores
`carried(S) = carried(pred) + realized/fees of confirmed fills with filled_at in (pred.as_of, S.as_of]`,
folded from `pred`'s baseline (`pred` = the latest other snapshot with an earlier `as_of`; none → all
fills up to `S.as_of`). This is computed atomically with the snapshot write. Fills after `S.as_of` are
not carried; they stay in the new since-snapshot window, so nothing is counted twice. Lifetime is
otherwise changed only by fills and fee edits inside the current snapshot window. Confirms whose fill
falls at or before the effective `as_of` are accepted and ignored, as in feature 163; they change
neither figure. Snapshot rules (operator sign-off 2026-10-19, C-16 narrowing of `@AC-6 @feature-163`):
re-submitting the same id with the same `as_of` replaces its rows and keeps its carry; changing the
`as_of` of a snapshot that is not the latest is rejected `FAILED_PRECONDITION`; a re-submit whose rows
are all rejected commits nothing; an empty position list records a full flatten ("sold everything").

FR-5. **Mark fallback.** When an offline position has no live quote — the symbol is absent from the
quote batch **or the quote batch fails / exceeds its deadline** — it is marked at the latest completed
session's daily-bar close found within the last `portfolio.marketdata.last_close_lookback_days` days,
with `mark_source = MARK_SOURCE_LAST_CLOSE` and `mark_as_of` = that bar's session date. A missing
quote never yields a 0 mark. If neither a quote nor a daily bar inside the lookback exists, the position is
`MARK_SOURCE_NONE` (unpriced): it is still listed (with its quantity) but excluded from the account's
Equity, unrealized, Day P&L and Total P&L sums, and the read succeeds. Broker-synced marks are
unchanged (`MARK_SOURCE_BROKER`). This **changes** the durable rule
`services/xstockstrat-portfolio/acceptance/fix-book-portfolio-page.feature` @AC-1 (feature 229) for
offline positions, and changes `services/xstockstrat-portfolio/acceptance/quote-fanout-batching.feature`
@AC-4 / @AC-1 (feature 178) for offline positions (a missing quote → last close; off-session → session
close; a pre-session quote is ignored). Operator sign-offs recorded in `context.md` (C-16); 229's deadline
bound and 178's single batched `GetLatestQuotes` call still hold, and broker positions are unchanged.

FR-6. **Surfaces.** The FR-1..FR-5 figures are rendered on:
  - `/trader` PortfolioPanel **single-account** view: Day P&L/%, Total P&L/%, Realized since snapshot
    (gross + net), Realized lifetime (gross + net), Fees (since snapshot + lifetime). Cash and Buying
    Power stay hidden.
  - `/trader` PortfolioPanel **combined** view: Day P&L and Total P&L are the sum of each account's own
    figures (offline per this spec, broker per broker); realized/fees rows show the offline-account sum
    labelled as offline-only.
  - `/trader/portfolio` Book offline card: Day P&L and Total P&L beside Equity and position count.
    This supersedes, for these fields, the "shows only … / no Day P&L" wording of the durable UI rules
    `services/xstockstrat-ui/acceptance/fix-offline-account-ui-gaps.feature` @AC-2/@AC-4 (feature 159);
    their "no Cash / Buying Power / broker Day P&L" intent is kept. Sign-off in `context.md` (C-16).
    The durable rule `services/xstockstrat-ui/acceptance/offline-account-portfolios.feature` @AC-13
    (single-account "Realized P&L") is **extended**: that row is relabelled "Realized (since snapshot)"
    beside the new lifetime row.
  - `/trader/positions` rows and `/trader/positions/[symbol]` detail: Day P&L, signed short %, and a
    stale-mark indicator ("Last close YYYY-MM-DD") or an "No price" indicator.
  - Agent: `manage_offline_account` (`confirm_order` gains optional `fees`; `get_order`/`list_orders`
    echo `fees`; `list_positions` returns `day_pnl`, `day_pnl_pct`, `unrealized_pnl_pct`, `mark_source`,
    `mark_as_of`), `get_positions` / `get_positions_by_account_id` (same position fields). No new tool.
    No agent tool reads the account-level `Portfolio`, so account-level figures (Total P&L/%, lifetime
    realized, fee totals, net realized) are UI-only; adding them to the agent is not in this feature.
  - Net realized (`gross − fees`) is derived and shown by the UI; it is not a proto field.

FR-7. **Backfill.** On rollout, existing confirmed (FILLED / PARTIALLY_FILLED) offline orders have
`fees = 0`; NEW offline orders and all broker orders stay unset; each existing offline
account's lifetime realized is seeded equal to its current since-snapshot realized (`carried = 0`,
both fee totals 0). No reconstruction of pre-snapshot history.

FR-8. **No regression on broker accounts or aggregates.** Broker (Alpaca/IBKR) marks, Day P&L, Total
P&L and account figures are unchanged, except two deliberate broker-visible changes: the
platform-wide short-% correction (FR-2), and `GetPortfolio` now populating broker `day_pnl` /
`day_pnl_pct` / `total_pnl` with the existing `ListPortfolios` rule (FR-9). `GetPnL`
is unchanged: offline holdings are still valued only from live quotes there and feature 229 @AC-5
(`UNAVAILABLE` when a needed quote is missing) still holds — the FR-5 fallback does not apply to
`GetPnL`. The persisted `portfolio.snapshots` series is unchanged.

FR-9. **Read-path parity.** Every portfolio read that returns offline positions or an offline account
summary applies the same FR-1/FR-2/FR-5 rules and returns identical values for the same state:
`GetPortfolio`, `GetPosition`, `ListPositions`, and `ListPortfolios` (single-account and
all-accounts). `GetPortfolio` (which today sets no Day/Total P&L for any account) adopts the
`ListPortfolios` per-account rule for **every** account type: broker `day_pnl = equity − last_equity`,
`day_pnl_pct = day_pnl / last_equity`, `total_pnl = Σ unrealized`; offline per FR-1/FR-2. Aggregates
(`GetPortfolio` without `account_id`, the combined panel) are `day_pnl = Σ account day_pnl`,
`day_pnl_pct = Σ day_pnl / Σ prior value` (broker prior value = `last_equity`, offline = its FR-1
`base`), `total_pnl = Σ account total_pnl`. `total_pnl_pct` is set only for an offline account or an
aggregate made only of offline accounts (unset otherwise, never a misleading 0). Covered by a parity
test across these RPCs.

## Out of Scope

- Including offline realized P&L or the FR-5 fallback in the `GetPnL` aggregate or `/insights` P&L
  Patterns (`portfolio.position.closed` emission for offline closes).
- Changing the persisted `portfolio.snapshots` series (cashless mark-to-market; see fails.md 172).
- `StreamPortfolioUpdates`: it pushes user-level `PortfolioSnapshot` messages built from the unchanged
  `portfolio.snapshots` series (FR-8), so it carries no offline P&L in this feature.
- A cash / capital-base / deposits ledger for offline accounts (Cash, Buying Power stay hidden).
- Dividends, corporate actions, FIFO / tax lots, options or OCC symbols.
- Per-position realized P&L history or a P&L time series.
- Fees on snapshot baselines (`SnapshotOfflinePositions`).
- Updating the out-of-repo `trade-confirm-ingest` skill (no in-repo owner; noted as a follow-up).

## Affected Services

- `packages/proto` — additive fields on trading `ConfirmOrderRequest`/`Order` and portfolio
  `Portfolio`/`Position`, plus a new `MarkSource` enum.
- `xstockstrat-trading` — persist per-order fees; offline recompute folds fees and emits since-snapshot
  realized/fees; `SnapshotOfflinePositions` triggers the FR-4 carry; same-session fill data available
  for FR-1.
- `xstockstrat-portfolio` — store lifetime/carried realized + fees; compute Day P&L, Total P&L, return %,
  short %; last-close mark fallback with provenance; read-path parity (FR-9).
- `xstockstrat-marketdata` — `BatchGetBars` serves the latest / previous daily close to portfolio. It
  gains an **opt-in** `allow_partial` request flag. When set, the cold live fetch is detached, budgeted
  from the caller's remaining deadline, and a failure returns the stored (warm) subset instead of
  failing the RPC (feature 229 precedent). Unset (every existing caller, e.g. analysis) → behaviour is
  unchanged. Operator scope decisions 2026-10-19.
- `xstockstrat-ui` — render the new figures on the four `/trader` surfaces.
- `xstockstrat-agent` — `confirm_order` `fees` arg; response mapping for new fields.

## Consumer Surface(s)

- [x] **UI** — `xstockstrat-ui` `/trader`: PortfolioPanel single + combined, `/trader/portfolio` Book
  offline card, `/trader/positions`, `/trader/positions/[symbol]` (details in FR-6). Existing routes
  only — no new subnav entry (C-10(a) unaffected).
- [x] **Agent** — `xstockstrat-agent`: `manage_offline_account`, `get_positions`,
  `get_positions_by_account_id` (details in FR-6). No new tool; tool count unchanged.
- [ ] **None**

## Proto Contract Changes

Additive only (non-breaking). Next free field numbers on trunk (verified 2026-10-19); final numbers
fixed at `/sdd-spec`:
- `trading.v1.ConfirmOrderRequest` (next free 6) — `optional double fees`.
- `trading.v1.Order` (next free 23) — `optional double fees` (unset for broker orders).
- `portfolio.v1.Portfolio` (next free 13) — `optional double total_pnl_pct` (set only per FR-9),
  `optional double realized_pnl_lifetime`,
  `optional double fees_since_snapshot`, `optional double fees_lifetime`. Existing `total_pnl = 8`,
  `day_pnl = 6`, `day_pnl_pct = 7` are populated for offline accounts; existing `optional realized_pnl
  = 12` keeps since-snapshot gross semantics. Net figures are derived by consumers (`gross − fees`).
- `portfolio.v1.Position` (next free 24) — `MarkSource mark_source`, `google.protobuf.Timestamp
  mark_as_of` (distinct from feature 163's `as_of = 22` / `source = 23`). For
  `MARK_SOURCE_LAST_CLOSE`, `mark_as_of` is 00:00 America/New_York of the bar's session date; for
  `MARK_SOURCE_QUOTE`, the quote timestamp; unset for `MARK_SOURCE_BROKER` and `MARK_SOURCE_NONE`.
  UIs render it as a date in America/New_York. Existing `day_pnl = 12`,
  `day_pnl_pct = 13`, `unrealized_pnl_pct = 7` are populated.
- `marketdata.v1.BatchGetBarsRequest` — `bool allow_partial` (next free field 6); opt-in partial results.
- New enum `portfolio.v1.MarkSource`: `MARK_SOURCE_UNSPECIFIED = 0`, `MARK_SOURCE_QUOTE`,
  `MARK_SOURCE_LAST_CLOSE`, `MARK_SOURCE_BROKER`, `MARK_SOURCE_NONE`.

**Ledger payload contract (not proto):** the hand-written JSON payload of `account.positions.synced`
may gain offline fee / since-snapshot fields; it stays additive and backward-compatible with existing
consumers. Exact shape decided in design.

## Config Key Changes

- New key `portfolio.marketdata.last_close_lookback_days` (int, default 21, bounded; global) — how far
  back the FR-5 last-close fallback searches for a daily bar (operator decision, 2026-10-19; follows the
  neighbouring `marketdata.quotes.latest_lookback_hours`). Registered per
  `docs/patterns/config-governance.md`; default declared in `services/xstockstrat-portfolio/CLAUDE.md`.
- The session calendar (America/New_York, regular hours) is a domain constant, not tunable config.

## Database Changes

Two independent migrations (separate schemas, no cross-service run-order dependency; each runs in its
service's normal `scripts/db-migrate.sh` order):

- `services/xstockstrat-trading/migrations/011_offline_fees_snapshot_headers.up.sql` — `ALTER TABLE
  trading.orders ADD COLUMN fees NUMERIC(18,8)` (nullable; confirmed offline orders backfilled to 0 per
  FR-7, NEW offline and broker orders stay NULL; `NUMERIC(18,8)` matches `filled_qty` /
  `filled_avg_price`), plus the new plain table `trading.offline_snapshot_headers` (one row per
  snapshot: `as_of`, frozen `realized_carried` / `fees_carried`) backfilled from the existing baselines
  with a carry of 0 (design.md §2.1, OQ-2 resolved: the carry lives in trading). `.down.sql` — drops the
  headers table, then the `fees` column.
- `services/xstockstrat-portfolio/migrations/017_offline_realized_lifetime_fees.up.sql` — add **four**
  columns to `portfolio.offline_account_realized`: `realized_carried`, `fees_since_snapshot`,
  `fees_carried` (`DOUBLE PRECISION NOT NULL DEFAULT 0`, matching `realized_pnl`) and `recent_fills
  JSONB NOT NULL DEFAULT '[]'`; and backfill `portfolio.positions.source = 1` (ORDERS) for pre-163
  offline positions still at 0, so `source ≠ 0` reliably marks an offline position (design.md §4.1).
  Lifetime is derived (`carried + since_snapshot`), so the FR-7 seed is satisfied by the defaults.
  `.down.sql` — drops the four columns (the source backfill is not undone; `ORDERS` is correct).
- Next free numbers re-checked across all 63 remote branches at `/sdd-spec` (2026-10-20): no branch
  carries trading `011+` or portfolio `017+` (`docs/roadmap/ledger/fails.md:213-224`).

## Feature Workflow Notes

Branch to create: `feature/offline-account-full-pnl` (branch from `main-dev`, after features 229 —
merged — and 215 land; see `context.md`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking proto or config change)
- [ ] 2 service owners + platform lead (breaking proto change)
- [x] DBA review + service owner (schema migration)

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

- [x] **OQ-1 Operator override of feature 163** — resolved: lifetime realized carried across snapshots,
  163 since-snapshot reset preserved. Sign-off in `context.md` (Session 2026-10-19 — sdd-story).
- [x] **OQ-2 Where the carry lives** — **deferred to /sdd-design** (owner: recon/design). Trading owns
  the fold and baseline; portfolio owns `offline_account_realized`. The carry must be applied atomically
  with the baseline replace under the per-account lock (fails.md:2029-2040).
- [x] **OQ-3 Re-confirming an order filled before the current snapshot** — **deferred to /sdd-design**.
  Default proposal: reject with `FAILED_PRECONDITION` (such fills are outside `FoldFrom`).
- [x] **OQ-4 Intraday consumption order** — resolved: reductions consume overnight shares first
  (operator, 2026-10-19); encoded in FR-1.
- [x] **OQ-5 Previous/latest-close read path** — **deferred to /sdd-design**. Candidates exist:
  `BatchGetLatestPrice` → `LatestPrice.prev_close`, `BatchGetBars` for the latest daily close. Must be
  batched and bounded within or beside `portfolio.marketdata.quote_timeout_ms`, with the
  partial-failure aggregate stated (fails.md quote-fanout-batching entry).
- [x] **OQ-6 Where Day P&L is computed** — **deferred to /sdd-design**. The session rolls over with no
  event, so Day P&L must be computed at read time from session-scoped fill data, not emitted once by
  trading; recon to pick the data path.
- [x] **OQ-7 Known traps** — carried into design: fails.md 172 (`portfolio.snapshots.equity` is
  cashless — not used as a basis here, FR-8), fails.md 157 (agent arg change must keep all six
  tool-inventory surfaces and `docs/runbooks/mcp-tools.md` in parity; verify via registered name-set).
- [x] **OQ-8 Design constraints carried forward** (not observable via API, so enforced by unit tests in
  design/spec): offline fees must not enter the broker per-position `fees_accum` path (feature 029)
  and so cannot be double-counted. The FR-5 last-close fetch must fit within the same
  `quote_timeout_ms` + 0.5 s envelope as the quote batch (AC-27), so design states its concurrency and
  partial-failure aggregate. The session calendar (holidays, early closes) source must be named in
  design (F-07 awareness). Once design decides OQ-3, append a scenario for it (IDs append-only).
  Also settle in design: for a broker account `GetPortfolio` reports `day_pnl` from broker equity while
  its `Equity` is summed market value (`ListPortfolios` uses broker equity), so decide whether
  `GetPortfolio` adopts broker equity too. Also decide how its `trading_mode` filter selects the accounts in
  the aggregate.

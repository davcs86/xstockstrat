# Implementation Spec: offline-account-full-pnl

**Status**: `pending`
**Created**: 2026-10-20
**Feature**: `docs/roadmap/features/230-offline-account-full-pnl/feature.md`
**Total Steps**: 28
**Feature Branch**: `feature/offline-account-full-pnl`

---

## Execution Summary

Contracts first, then producers before consumers. The proto additions and regenerated stubs (Steps 1–2)
are needed by every other step. The two independent migrations come next (Steps 3–4). Trading then
persists fees, freezes the snapshot carry and widens its absolute `account.positions.synced` payload
(Steps 5–12). Marketdata gains the opt-in `allow_partial` bars mode (Steps 13–14). Portfolio adds the
market calendar, stores the new payload, and runs the shared read-time valuation (Day P&L, Total P&L,
return %, short %, last-close mark) on every read path (Steps 15–22). The new config key is bounded in
`xstockstrat-config` (Step 23). The two consumer surfaces come last: the Agent (Steps 24–25) and the
`/trader` UI (Steps 26–27). One docs step lands the CLAUDE.md invariants, the config-key log and the
findings (Step 28).

**Evidence base.** Every citation was re-anchored against `origin/main-dev` @ `7c247698` (2026-10-20).
Feature **231** (`fix-after-hours-positions-priced`, code-completed) merged after `/sdd-design` and
changed `portfolio_service.go`, `marketdata_service.go`, `marketdata.proto` (`Quote.mark_price = 8`) and
`configServiceImpl.ts`. Line numbers here are post-231 and replace the design's older ones (for example,
`BatchGetBars` is now `marketdata_service.go:703-812`, not `:654-763`). Trading, UI and agent code did not
change, so the design's citations there still hold.

**Consumer surfaces (C-14).** Both surfaces named in the product spec get their own steps. The
**UI `/trader`** (PortfolioPanel single and combined, the Book offline card, `/trader/positions`,
`/trader/positions/[symbol]`, and the ConfirmFillDialog label) is covered by Steps 26–27. The **Agent**
(`manage_offline_account`, `get_positions`, `get_positions_by_account_id`) is covered by Steps 24–25. No new
route, so C-10(a) nav registration does not apply. No new agent tool, so the tool count is unchanged.

**Blocking design risk resolved (golden bar-date mapping).** I read real staging `marketdata.ohlcv` 1d rows
through the staging `query_bars` MCP tool on 2026-10-20. AAPL bars are stamped at **00:00
America/New_York** of the session date:
- EDT: `2026-10-12T04:00:00Z` … `2026-10-16T04:00:00Z`, `2026-10-19T04:00:00Z`, `2025-10-30T04:00:00Z`,
  `2025-10-31T04:00:00Z`;
- EST: `2026-01-12T05:00:00Z` … `2026-01-16T05:00:00Z`, and across the DST end `2025-11-03T05:00:00Z`,
  `2025-11-04T05:00:00Z`.

`SessionDate(t) = NY date of (t + 6h)` maps every one of these to its session date. Step 16 pins these
exact vectors as the golden test. The same read shows that **today's forming bar is stored during the
session** (`2026-10-19T04:00:00Z` was present at 2026-10-20 read time, `last_refreshed` = that bar). This
confirms that AC-49's live-session exclusion of the reference bar is needed.

### Operator decision D-1 (feature 231 interaction, C-16) — RESOLVED 2026-10-20: default signed off (see context.md)

Feature 231 added a valuation rule (`markOf`, `portfolio_service.go:446-456`): a one-sided quote is
valued at marketdata's `mark_price`, which is the newest stored 1d close within
`marketdata.quotes.mark_close_max_age_hours` (default 168h). The 230 design never saw this. Its mark
selection (§4.5) treats "a mid-quote ≤ 0" as missing and falls back to the bar-derived close with real
provenance. The durable 231 rules are all written about **offline** accounts. With migration 017's
`source` backfill, every offline position goes through the new valuation step in production, so 230
interacts with them:

| Durable rule (`services/xstockstrat-portfolio/acceptance/fix-after-hours-positions-priced.feature`) | Under 230 (default below) |
|---|---|
| `@AC-1 @feature-231`: one-sided quote → `current_price` 16.98 (the stored close) | **Value preserved** (the bar-derived close is the same stored `ohlcv` row), now labelled `MARK_SOURCE_LAST_CLOSE` with its real date |
| `@AC-13 @feature-231`: all five read paths value LYFT at 16.98 | **Preserved**: the four valuation-step reads use the bar close and `GetPnL` keeps `markOf` |
| `@AC-6 @feature-231`: one-sided quote whose close is 200h old → ListPositions `current_price` 0 | **CHANGE for offline positions**: the close is inside the 21-day `last_close_lookback_days`, so it is priced at 5.48 as `LAST_CLOSE`. The `GetPnL` half (UNAVAILABLE) is preserved |
| `@AC-14 @feature-231` row 2: no `mark_price`, one-sided → `current_price` 0 | **CHANGE for offline positions** when a daily bar exists inside the lookback (priced `LAST_CLOSE`); unchanged when none exists |
| `@AC-2/@AC-3/@AC-8/@AC-9 @feature-231` (snapshot and risk) | **Preserved**: `broadcastSnapshot` and `checkRiskLimits` never reach the valuation step (design §4.4) |

**Decision (signed off 2026-10-20; Step 19 is written to it):** for an offline (`source ≠ 0`) position, a quote counts
as a QUOTE mark only when it is **two-sided** (`ask_price > 0 && bid_price > 0`) **and fresh** (time ≥
`Open(ref)`). The QUOTE price is `markOf(q)`, which equals the mid for a two-sided quote. A one-sided
quote is treated as "no live quote" and goes to the FR-5 bar fallback. This keeps FR-5's honest
provenance: a stale close never gets labelled `QUOTE`. It does not need a second close lookup. It extends
the operator's existing FR-5 sign-offs over 229 @AC-1 and 178 @AC-4 to 231 @AC-6 and @AC-14 for offline
positions. Broker and non-offline positions keep 231's `markOf` path unchanged.

The operator signed off this C-16 CHANGE of 231 `@AC-6` and `@AC-14` (row 2) for offline positions on
2026-10-20 (`context.md`, "D-1 decision"). The rejected alternative capped the offline fallback at
`mark_close_max_age_hours`; it would have preserved @AC-6 but narrowed FR-5's operator-chosen 21-day
lookback. At promotion both 231 rules are **rewritten**: the offline-position outcome becomes the
`LAST_CLOSE` mark, while the `GetPnL` and non-offline halves stay as they are. Each rewritten rule carries a
"changed by feature 230" note.

### Scenario Coverage (C-15)

| Scenario | Step(s) | Scenario | Step(s) | Scenario | Step(s) |
|---|---|---|---|---|---|
| AC-1 | 20, 22 | AC-19 | 20 | AC-37 | 10 |
| AC-2 | 20 | AC-20 | 12, 18, 27 | AC-38 | 20, 22 |
| AC-3 | 22 | AC-21 | 10, 12 | AC-39 | 22 |
| AC-4 | 22 | AC-22 | 20 | AC-40 | 20 |
| AC-5 | 20 | AC-23 | 20 | AC-41 | 12, 18 |
| AC-6 | 22 | AC-24 | 20 | AC-42 | 12, 18 |
| AC-7 | 12, 18 | AC-25 | 22 | AC-43 | 12 |
| AC-8 | 10, 12 | AC-26 | 20 | AC-44 | 12 |
| AC-9 | 10 | AC-27 | 20, 22 | AC-45 | 12 |
| AC-10 | 12, 18 | AC-28 | 22 | AC-46 | 12 |
| AC-11 | 12, 18 | AC-29 | 22 | AC-47 | 10, 12 |
| AC-12 | 20 | AC-30 | 27 | AC-48 | 10 |
| AC-13 | 20, 22 | AC-31 | 20, 27 | AC-49 | 20 |
| AC-14 | 27 | AC-32 | 27 | AC-50 | 20 |
| AC-15 | 27 | AC-33 | 25 | AC-51 | 20, 22 |
| AC-16 | 27 | AC-34 | 22 | AC-52 | 22 |
| AC-17 | 25 | AC-35 | 20 | AC-53 | 14 |
| AC-18 | 3, 6, 18 | AC-36 | 20 | AC-54 | 14 |

All 54 scenarios are covered. Some scenarios span services (e.g. AC-41..47: trading freezes the carry,
portfolio derives `realized_pnl_lifetime = carried + since`). For those, each listed step asserts its own
service's half against the scenario's numbers. Proof that is SQL-shape only is called out in the step
(insights 2026-10-14).

## Step Dependencies

- Steps 3–28 require Steps 1–2: every code step compiles against the regenerated stubs.
- Step 5 requires Step 3: the `fees` column must exist before the repo reads or writes it. Step 7
  requires Step 3: `trading.offline_snapshot_headers` must exist.
- Step 9 requires Step 5 (`Order.Fees` round-trips through `UpsertOrder` / `scanOrder`).
- Step 11 requires Steps 7 and 9 (carry callback seam, persisted fees).
- Step 13 is independent of the trading and portfolio steps.
- Step 17 requires Step 4: portfolio stores the four new columns.
- Step 19 requires Steps 13 (`BatchGetBarsRequest.allow_partial` field, via Step 2), 15 (calendar) and
  17 (`GetOfflineStates`). **Step 19 is also gated on operator decision D-1** (see Execution Summary).
- Step 21 requires Step 19 (shared valuation output).
- Step 23 has no code dependency; land it before Step 19 deploys so the new key is bounded from day one.
- Step 24 requires Step 2. Steps 26–27 require Step 2 and use the fixture shapes of Steps 19/21.
- Step 28 runs last (documents the final behaviour).
- Paired tests: Step 6 [test] covers Step 5; Step 8 covers Step 7; Step 10 covers Step 9; Step 12 covers
  Step 11; Step 14 covers Step 13; Step 16 covers Step 15; Step 18 covers Step 17; Step 20 covers Step 19;
  Step 22 covers Step 21; Step 25 covers Step 24; Step 27 covers Step 26. Step 23 (`config`) carries its
  own test rows.
- **Ordering with other features:** land after feature 215 (`block-fundamentals-strategy-on-etf`) and
  rebase (overlap on `app/tools.py`, `docs/runbooks/mcp-tools.md`, `positions/[symbol]/page.tsx`, per
  `context.md` overlap scan). Feature 231 is already on `main-dev`; branch from it.
- **Promotion (C-16) at the integration PR, not a step:**
  - rewrite `fix-book-portfolio-page.feature @AC-1` and `quote-fanout-batching.feature @AC-4` / third
    clause of `@AC-1`, offline only;
  - rewrite the 231 `@AC-6` / `@AC-14` (row 2) offline outcomes per D-1, each with a "changed by feature 230" note;
  - narrow `@AC-6 @feature-163`;
  - update `fix-offline-account-ui-gaps.feature @AC-2/@AC-4` and extend `offline-account-portfolios.feature
    @AC-13`;
  - promote AC-53/AC-54 into the **new** suite `services/xstockstrat-marketdata/acceptance/offline-account-full-pnl.feature`
    (`@feature-230`).
- **Deferred, named follow-up:** none. The out-of-repo `trade-confirm-ingest` skill update stays out of
  scope per the product spec.

---

### Step 1 — proto: Additive fees, P&L, mark-provenance and allow_partial fields

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/trading/v1/trading.proto` — modify
- `packages/proto/portfolio/v1/portfolio.proto` — modify
- `packages/proto/marketdata/v1/marketdata.proto` — modify

**Reviewers**: Proto Reviewer — field number uniqueness, backward compatibility, `buf lint`/`buf breaking`
pass; `xstockstrat-trading` owner — order execution correctness, fill detection; `xstockstrat-portfolio`
owner — P&L calculation accuracy; `xstockstrat-marketdata` owner — OHLCV ingestion integrity

**Codebase Evidence**:
- `trading.proto:158-164`: `ConfirmOrderRequest` ends at `string user_id = 5 [deprecated = true];`, so the
  next free number is 6.
- `trading.proto:46` `message Order {`: the last field is `google.protobuf.Timestamp filled_at = 22;`, so
  the next free number is 23.
- `portfolio.proto:47-63`: `Portfolio` ends with `optional double realized_pnl = 12;`, so the next free
  number is 13. `portfolio.proto:65-111`: `Position` ends with `PositionSource source = 23;`, so the next
  free number is 24.
- `portfolio.proto:124-129`: the `enum PositionSource { POSITION_SOURCE_UNSPECIFIED = 0; … }` pattern
  (C-04 sentinel). `portfolio.proto:7` already imports `google/protobuf/timestamp.proto`.
- `marketdata.proto:327-333`: `BatchGetBarsRequest` ends with `int32 max_bars_per_symbol = 5;`, so the next
  free number is 6. Feature 231 took `Quote.mark_price = 8` (`marketdata.proto:99-101`); that is a
  different message, so there is no collision.
- `grep -rn "reserved"` over the three protos returns no hits (no reserved ranges to avoid).
- Remote-branch scan (fails.md:213): `git ls-tree` over all 63 `origin/*` heads finds no other branch
  adding these numbers (no in-flight feature touches these messages).
- CI skips trading in `buf breaking`: `.github/workflows/ci.yml:135`
  `buf breaking . --against "${AGAINST}" --exclude-path trading/v1/trading.proto`. The qualified
  `subdir=packages/proto` form is required (`scripts/buf-gen.sh:41`;
  `docs/reports/2026-10-19-sdd-spec-buf-breaking-missing-subdir-defect.md`).

**TDD**: `N/A (proto — non-code-bearing)`

**Covers**: —

**Instructions**:
1. `trading.proto` `ConfirmOrderRequest`: add
   `optional double fees = 6; // cumulative total for the order (>= 0); omitted = keep recorded fees`.
2. `trading.proto` `Order`: add
   `optional double fees = 23; // offline orders only; unset for broker orders and while NEW`.
3. `portfolio.proto` `Portfolio`: add `optional double total_pnl_pct = 13;`,
   `optional double realized_pnl_lifetime = 14;`, `optional double fees_since_snapshot = 15;` and
   `optional double fees_lifetime = 16;`. Each gets a one-line constraint comment: offline accounts only;
   `total_pnl_pct` is also set on an all-offline aggregate.
4. `portfolio.proto` `Position`: add `MarkSource mark_source = 24;` and
   `google.protobuf.Timestamp mark_as_of = 25;`. Comment: `mark_as_of` is 00:00 America/New_York of the
   bar's session for `LAST_CLOSE`, the quote time for `QUOTE`, and unset for `BROKER`/`NONE`.
5. `portfolio.proto`: add `enum MarkSource { MARK_SOURCE_UNSPECIFIED = 0; MARK_SOURCE_QUOTE = 1;
   MARK_SOURCE_LAST_CLOSE = 2; MARK_SOURCE_BROKER = 3; MARK_SOURCE_NONE = 4; }` beside `PositionSource`.
6. `marketdata.proto` `BatchGetBarsRequest`: add
   `bool allow_partial = 6; // opt-in: a failed/over-budget cold fetch returns the stored subset`.

**Verification**:
```bash
cd packages/proto && buf lint && \
  buf breaking --against "$(git rev-parse --show-toplevel)/.git#branch=feature/offline-account-full-pnl,subdir=packages/proto" && \
  buf breaking --against "$(git rev-parse --show-toplevel)/.git#branch=feature/offline-account-full-pnl,subdir=packages/proto" --path trading/v1/trading.proto
```
The last command is the manual trading.proto check that CI skips (C-09). All three must exit 0.

---

### Step 2 — proto-gen: Regenerate stubs

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/go/` — modify (generated)
- `packages/proto/gen/python/` — modify (generated)
- `packages/proto/gen/ts/` — modify (generated, incl. `dist/`)

**Reviewers**: Proto Reviewer — field number uniqueness, backward compatibility, `buf lint`/`buf breaking`
pass; `xstockstrat-trading` owner; `xstockstrat-portfolio` owner; `xstockstrat-marketdata` owner (inherited
from Step 1)

**Codebase Evidence**:
- `scripts/buf-gen.sh` generates TS/Python/Go stubs and compiles the TS package (root `CLAUDE.md` §
  Generating Proto Stubs). Services consume Go stubs via
  `replace github.com/xstockstrat/contracts => ../../packages/proto`: `services/xstockstrat-trading/go.mod:41`,
  `services/xstockstrat-portfolio/go.mod:41`, `services/xstockstrat-marketdata/go.mod:43`.
- Toolchain fallback when Docker is unavailable: `docs/runbooks/codegen-toolchain-host-setup.md`.

**TDD**: `N/A (proto-gen — generated output)`

**Covers**: —

**Instructions**:
1. Run `./scripts/buf-gen.sh` from the repo root.
2. Commit the regenerated `packages/proto/gen/**` in this step only.
3. Never hand-edit `gen/`.

**Verification**:
```bash
./scripts/buf-gen.sh && git status --short packages/proto/gen | head && \
  (cd services/xstockstrat-trading && GOWORK=off go build ./...) && \
  (cd services/xstockstrat-portfolio && GOWORK=off go build ./...) && \
  (cd services/xstockstrat-marketdata && GOWORK=off go build ./...)
```
The gen diff must be non-empty, and a second `./scripts/buf-gen.sh` must leave `git diff packages/proto/gen` empty
(the `proto-freshness` gate).

---

### Step 3 — migration: trading 011 — order fees + snapshot headers

**Status**: `done`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/migrations/011_offline_fees_snapshot_headers.up.sql` — create
- `services/xstockstrat-trading/migrations/011_offline_fees_snapshot_headers.down.sql` — create

**Reviewers**: DBA — migration NNN numbering, up+down pair, run order; `xstockstrat-trading` owner —
order execution correctness, fill detection

**Codebase Evidence**:
- `ls services/xstockstrat-trading/migrations/`: the last migration is `010_normalize_tif.{up,down}.sql`, so
  the next is **011**. No `011_*` exists on any of the 63 remote branches.
- `trading.orders` is a hypertable with `PRIMARY KEY (order_id, created_at)`
  (`001_orders_hypertable.up.sql:29-33`). `grep -n compress migrations/*.sql` returns no hits, so the
  `UPDATE` touches no compressed chunks (design §13 assumption confirmed).
  `broker_type SMALLINT` (`003_orders_account_id.up.sql:3`); `BROKER_TYPE_OFFLINE = 3`
  (`packages/proto/common/v1/common.proto:74`). Status strings are `'partially_filled'`/`'filled'`
  (`trading_repo.go:450-467`).
- `offline_position_baselines` shape and index pattern: `009_offline_position_baselines.up.sql:4-15`.
- Precedent for a data `UPDATE` inside a migration: `010_normalize_tif.up.sql:3-4`.

**TDD**: `N/A (migration — non-code-bearing)`

**Covers**: `AC-18` (backfill half: confirmed offline orders get `fees = 0`; broker orders and NEW orders stay `NULL`). Proven by **SQL-shape review only**: there is no migration-run harness, and the repo tests (Step 6) prove the NULL-vs-0 read-back.

**Instructions**:
1. Write `011_…up.sql` exactly as design §2.1. The SQL:
   - `ALTER TABLE trading.orders ADD COLUMN IF NOT EXISTS fees NUMERIC(18,8);`
   - `UPDATE trading.orders SET fees = 0 WHERE broker_type = 3 AND status IN ('partially_filled','filled') AND fees IS NULL;`
   - `CREATE TABLE IF NOT EXISTS trading.offline_snapshot_headers (account_id TEXT NOT NULL,
     client_snapshot_id TEXT NOT NULL, as_of TIMESTAMPTZ NOT NULL, realized_carried NUMERIC(18,8) NOT NULL
     DEFAULT 0, fees_carried NUMERIC(18,8) NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     PRIMARY KEY (account_id, client_snapshot_id));`
   - `CREATE INDEX IF NOT EXISTS idx_offline_snapshot_headers_account_asof ON
     trading.offline_snapshot_headers (account_id, as_of DESC, created_at DESC);`
   - `INSERT INTO trading.offline_snapshot_headers (account_id, client_snapshot_id, as_of, created_at)
     SELECT account_id, client_snapshot_id, max(as_of), max(created_at) FROM
     trading.offline_position_baselines GROUP BY 1,2 ON CONFLICT DO NOTHING;`
2. Add a 2-line header comment (feature 230; plain table, not a hypertable).
3. Write `011_…down.sql`: `DROP TABLE IF EXISTS trading.offline_snapshot_headers;` then
   `ALTER TABLE trading.orders DROP COLUMN IF EXISTS fees;`.

**Verification**:
```bash
ls services/xstockstrat-trading/migrations/011_offline_fees_snapshot_headers.up.sql \
   services/xstockstrat-trading/migrations/011_offline_fees_snapshot_headers.down.sql
```
Then read both files and confirm that every `ADD COLUMN` and `CREATE TABLE` in `.up` has a matching
`DROP` in `.down`. The data backfill needs no inverse because the down migration drops the column. Do not
start a database.

---

### Step 4 — migration: portfolio 017 — lifetime/fees/recent-fills columns + source backfill

**Status**: `done`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/migrations/017_offline_realized_lifetime_fees.up.sql` — create
- `services/xstockstrat-portfolio/migrations/017_offline_realized_lifetime_fees.down.sql` — create

**Reviewers**: DBA — migration NNN numbering, up+down pair, run order; `xstockstrat-portfolio` owner —
P&L calculation accuracy, position snapshot consistency

**Codebase Evidence**:
- `ls services/xstockstrat-portfolio/migrations/`: the last migration is
  `016_account_balance_peak_equity.{up,down}.sql`, so the next is **017**. No `017_*` exists on any remote
  branch.
- `012_offline_account_realized.up.sql:7-13`: `offline_account_realized(account_id PK, user_id,
  trading_mode, realized_pnl DOUBLE PRECISION NOT NULL DEFAULT 0, updated_at)`.
- `portfolio.positions.source` is `INTEGER DEFAULT 0` (migration `013`, per `services/xstockstrat-portfolio/CLAUDE.md`
  § Database). Only the offline recompute sets `source ≠ 0` (`trading.go:1013-1028`). A broker sync decodes
  `source` as 0 (`portfolio_service.go:1000`, `Source int json:"source"`) and writes it via
  `UpsertPositionFromSync` (`portfolio_repo.go:318-337`, `$14`).
- `1 = POSITION_SOURCE_ORDERS` (`portfolio.proto:126`).

**TDD**: `N/A (migration — non-code-bearing)`

**Covers**: —

**Instructions**:
1. Write `017_…up.sql` as design §4.1:
   - `ALTER TABLE portfolio.offline_account_realized ADD COLUMN IF NOT EXISTS realized_carried DOUBLE
     PRECISION NOT NULL DEFAULT 0, ADD COLUMN IF NOT EXISTS fees_since_snapshot DOUBLE PRECISION NOT NULL
     DEFAULT 0, ADD COLUMN IF NOT EXISTS fees_carried DOUBLE PRECISION NOT NULL DEFAULT 0, ADD COLUMN IF NOT
     EXISTS recent_fills JSONB NOT NULL DEFAULT '[]'::jsonb;`
   - `UPDATE portfolio.positions SET source = 1 WHERE source = 0 AND account_id IN (SELECT account_id FROM
     portfolio.offline_account_realized);`
2. Write `017_…down.sql`: drop the four columns (`DROP COLUMN IF EXISTS` ×4). Add a one-line comment that
   the source backfill is intentionally not reverted (`ORDERS` is correct for those rows).

**Verification**:
```bash
ls services/xstockstrat-portfolio/migrations/017_offline_realized_lifetime_fees.up.sql \
   services/xstockstrat-portfolio/migrations/017_offline_realized_lifetime_fees.down.sql
```
Read both files and confirm the four `ADD COLUMN`s map to four `DROP COLUMN`s. No database.

---

### Step 5 — service: trading repo — persist/read `fees`; dedupe confirmed offline orders

**Status**: `done`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/repository/trading_repo.go` — modify
- `services/xstockstrat-trading/internal/testdata/order_rows.go` — modify

**Reviewers**: `xstockstrat-trading` owner — order execution correctness, broker API safety, fill detection

**Codebase Evidence**:
- `UpsertOrder` `trading_repo.go:53-96`:
  - the INSERT column list is at `:64-69` and VALUES `$1…$22` at `:70-76`;
  - `ON CONFLICT (order_id, created_at) DO UPDATE SET` names each column explicitly at `:77-85`;
  - the args are at `:87-94`.
- `nullableFloat` `:476-481` returns nil for 0, so it cannot write an explicit 0 fee (recon R9).
- `intentLateralJoinSQL` const `:100-105` hard-codes `WHERE order_id = trading.orders.order_id`.
- Readers that SELECT the 22 columns and feed `scanOrder`: `GetOrder` `:110-113`, `ListOrders` `:216-219`,
  `ListSubmittedOrders` `:301-304`, `ListConfirmedOfflineOrdersByAccount` `:332-335`.
- `ListConfirmedOfflineOrdersByAccount` `:330-357` has no `DISTINCT ON`; compare `NetFilledQtyBySymbol`
  `:176-180`, `SELECT DISTINCT ON (order_id) … ORDER BY order_id, created_at DESC` (recon R5).
- `scanOrder` `:364-424` scans 22 positional columns (`:377-384`). `filledAt *time.Time` maps NULL to nil
  (`:408-410`).
- `internal/testdata/order_rows.go:9-16` `OrderRowColumns` must stay in lockstep with `scanOrder`.
  `NewOrderRow` is at `:20-28`.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. `UpsertOrder`:
   - append `fees` to the INSERT column list and `$23` to VALUES;
   - add `fees = EXCLUDED.fees` to the `DO UPDATE SET` list;
   - pass `o.Fees` (`*float64`, generated from `optional double`) **directly** as the 23rd arg, so nil
     becomes SQL NULL and 0 stays 0;
   - do **not** route it through `nullableFloat`.
2. Turn the constant into `func intentLateralJoinOn(alias string) string`, whose subquery reads
   `WHERE order_id = <alias>.order_id`. Replace the 3 existing `intentLateralJoinSQL` uses with
   `intentLateralJoinOn("trading.orders")`. Leave `NetFilledQtyBySymbol` untouched (design §2.4).
3. Add `, fees` after `filled_at` (before `li.state`) in the 4 SELECT lists above.
4. Rewrite the `ListConfirmedOfflineOrdersByAccount` FROM as
   `FROM (SELECT DISTINCT ON (order_id) * FROM trading.orders WHERE account_id=$1 ORDER BY order_id,
   created_at DESC) o` + `intentLateralJoinOn("o")`. Then filter with
   `WHERE o.status IN ('partially_filled','filled') AND o.filled_qty > 0` and order with
   `ORDER BY o.filled_at ASC NULLS LAST, o.created_at ASC`. Qualify the selected columns with `o.`.
5. `scanOrder`: scan a `fees *float64` positioned after `filledAt`. Set `o.Fees = fees` (nil stays unset).
6. `testdata/order_rows.go`: insert `"fees"` after `"filled_at"` in `OrderRowColumns`, and `nil` at the same
   position in `NewOrderRow`.

**Verification**: see Step 6.

---

### Step 6 — test: trading repo fees round-trip and dedupe

**Status**: `done`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/repository/trading_repo_test.go` — modify

**Reviewers**: `xstockstrat-trading` owner — order execution correctness, fill detection

**Codebase Evidence**:
- pgxmock harness: `trading_repo_test.go:20-31` (`TestGetOrder_ExercisesIntentLateralJoin`, regex
  `(?s)LEFT JOIN LATERAL.*intent_updated_at.*WHERE order_id = \$1`). The dedupe regex precedent is at
  `:197`. `github.com/pashagolub/pgxmock/v4` is in `go.mod:9`.
- Rows come from `testdata.NewOrderRow` / `OrderRowColumns` (C-13 Go home already exists).

**TDD**: `red-green required`

**Covers**: `AC-18` (repo half: a NULL `fees` column reads back unset; an explicit 0 reads back 0.0)

**Instructions**:
1. Add `TestUpsertOrder_PersistsFeesPresence`. Use `ExpectExec` with
   `(?s)filled_at, fees.*fees\s+= EXCLUDED\.fees`. Assert arg 23 is `nil` for an
   order with `Fees == nil` and `0.0` for `Fees: proto.Float64(0)`. That second case is red against
   `nullableFloat`.
2. Add `TestScanOrder_FeesNullVsZero`. A row with `fees = nil` gives `o.Fees == nil`, and a row with `fees = 1.5`
   gives `*o.Fees == 1.5`. This is the AC-18 broker-unset vs offline-0 split.
3. Add `TestListConfirmedOfflineOrdersByAccount_DistinctOnBeforeFilter`. Match the regex
   `(?s)DISTINCT ON \(order_id\).*WHERE account_id=\$1.*ORDER BY order_id, created_at DESC.*o\.status IN
   \('partially_filled','filled'\).*ORDER BY o\.filled_at ASC NULLS LAST`. Note in the test comment that
   this proof is SQL-shape only (a mock cannot run `DISTINCT ON`).
4. Update the 3 existing SELECT regexes (`GetOrder` `:20`, `ListOrders` `:56`, `ListSubmitted` `:240`) and
   their fixtures for the new `fees` column. There is no existing `ListConfirmedOfflineOrdersByAccount` test;
   instruction 3 adds the first one.
5. C-13: no new domain literal. Reuse `testdata.NewOrderRow`. A single consumer means inline overrides are
   compliant.

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off go test ./internal/repository/... -run 'Fees|DistinctOn|IntentLateral|ListOrders|ListSubmitted' -count=1 && \
  GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && GOWORK=off go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:" && \
  GOWORK=off golangci-lint run --modules-download-mode=mod
```
Confirm the total is ≥ 40%. New logic is in `repository/`, an excluded package, so the threshold does not
measure it. The targeted tests are the proof.

---

### Step 7 — service: trading baseline repo — snapshot headers, carry callback, atomic purge

**Status**: `done`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/repository/offline_baseline_repo.go` — modify
- `services/xstockstrat-trading/internal/service/trading.go` — modify (the `offlineBaselineStore` interface and
  its two call sites, adapted mechanically)
- `services/xstockstrat-trading/internal/service/trading_offline_test.go` — modify (`fakeBaselineStore`
  method signatures only, so the package compiles)

**Reviewers**: `xstockstrat-trading` owner — order execution correctness, fill detection

**Codebase Evidence**:
- `UpsertBaselineSnapshot` `offline_baseline_repo.go:18-47` runs `r.pool.Begin` → `DELETE` same
  `client_snapshot_id` → `INSERT` rows → `Commit`.
- `EffectiveBaselineByAccount` `:49-96` uses `r.db.Query`, which pgxmock can mock. It picks the greatest
  `as_of` with a `max(created_at)` tie-break and drops `qty=0` rows at `:82-84`.
- `DeleteBaselinesByAccount` `:98-104` is a single `r.pool.Exec` with no transaction.
- The interface `offlineBaselineStore` is at `trading.go:49-55`; production wiring is `baselineStore: repo`
  at `trading.go:224`. The test fake `fakeBaselineStore` is at `trading_offline_test.go:100-175`.
- `pnl.Lot{Qty, CostBasis}` is at `packages/proto/pnl/pnl.go:30-34`.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Add these types to `offline_baseline_repo.go`:
   - `type SnapshotHeader struct { ClientSnapshotID string; AsOf time.Time; RealizedCarried, FeesCarried float64; Lots map[string]pnl.Lot }`;
   - `type CarryFunc func(pred *SnapshotHeader, asOf time.Time) (realized, fees float64, err error)`;
   - `var ErrSnapshotAsOfConflict = errors.New("snapshot as_of change not allowed")`.
2. Change `UpsertBaselineSnapshot(ctx, accountID, clientSnapshotID, asOf, rows, carry CarryFunc) error`.
   Everything below runs in **one** transaction:
   1. Run `SELECT client_snapshot_id, as_of, realized_carried, fees_carried, created_at FROM
      trading.offline_snapshot_headers WHERE account_id=$1 FOR UPDATE`.
   2. **Same id, same `as_of`:** keep the stored carry. Do not call `carry`.
   3. **Same id, different `as_of`:** allowed only when this id is the latest header (greatest
      `(as_of, created_at)`) **and** the new `as_of` ≥ every other header's `as_of`. Otherwise return
      `ErrSnapshotAsOfConflict` and write nothing.
   4. **Otherwise (a new id, or an allowed `as_of` change):** `pred` is the header with the greatest
      `(as_of, created_at)` among those with `as_of < S.as_of` and a different id. Load `pred`'s rows from
      `offline_position_baselines` (qty ≠ 0) into `Lots`. Call `carry(pred or nil, asOf)`.
   5. Upsert the header with `INSERT … ON CONFLICT (account_id, client_snapshot_id) DO UPDATE SET as_of,
      realized_carried, fees_carried`.
   6. Run the existing DELETE+INSERT of rows, then commit.
3. `EffectiveBaselineByAccount`:
   - Return the header too. The signature becomes `(hdr SnapshotHeader, ok bool, err error)`, with
     `hdr.Lots` holding the rows.
   - Read the latest header first: `ORDER BY as_of DESC, created_at DESC LIMIT 1`, then that snapshot's
     rows with `qty <> 0`.
   - A header with no rows is a **full flatten** (`ok=true`, empty `Lots`). Today the
     `len(lots)==0 && asOf.IsZero()` test at `:91-93` would report "no baseline" for it.
4. `DeleteBaselinesByAccount`: run one transaction that deletes both `offline_position_baselines` and
   `offline_snapshot_headers` rows for the account (design §2.6, `@AC-18 @feature-163`).
5. Update the `offlineBaselineStore` interface in `trading.go:49-55` to the new two signatures. In the same
   step, adapt both call sites **mechanically** so the `service` package keeps compiling. This avoids F-05:
   otherwise Steps 8 and 10 could never pass `go vet ./...`.
   - `trading.go:949`: `hdr, hasBaseline, err := s.baselineStore.EffectiveBaselineByAccount(ctx, accountID)`
     with `asOf, seedLots := hdr.AsOf, hdr.Lots`. The rest of the function is unchanged.
   - `trading.go:1125`: pass `nil` as the `carry` argument. The repo treats a nil `CarryFunc` as a carry of
     `0, 0`. Step 11 replaces it with the real closure.
6. Adapt `fakeBaselineStore`'s two method signatures (`trading_offline_test.go:135`, `:158`) to compile
   only, with no behaviour change: return `repository.SnapshotHeader{AsOf: f.baselineAsOf, Lots:
   f.baselineLots}`. Step 8 adds the header and carry behaviour.

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off go build ./... && GOWORK=off go vet ./... && \
  GOWORK=off go test ./internal/service/... -run 'Snapshot|OfflineRecompute' -count=1
```
The existing snapshot and recompute tests must stay green after the mechanical adaptation (nil carry is 0).

---

### Step 8 — test: trading baseline repo — header read + fake update

**Status**: `done`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/repository/offline_baseline_repo_test.go` — create
- `services/xstockstrat-trading/internal/service/trading_offline_test.go` — modify (the `fakeBaselineStore` only)

**Reviewers**: `xstockstrat-trading` owner — order execution correctness, fill detection

**Codebase Evidence**:
- `EffectiveBaselineByAccount` reads through `r.db` (`offline_baseline_repo.go:52`), so pgxmock can drive
  it with `repository.NewTradingRepoWithDB(mock)` (`trading_repo.go:40-43`).
- `UpsertBaselineSnapshot` and `DeleteBaselinesByAccount` use `r.pool` (`:21`, `:100`), so they are not
  unit-mockable. Their behaviour is proven at the service level through `fakeBaselineStore`
  (`trading_offline_test.go:100-175`).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. New repo test `TestEffectiveBaseline_HeaderThenRows`:
   - mock the header query `(?s)FROM trading\.offline_snapshot_headers.*ORDER BY as_of DESC, created_at DESC LIMIT 1`
     and the rows query;
   - assert `hdr.RealizedCarried`/`FeesCarried`/`AsOf` and that `qty=0` rows are dropped;
   - a header with zero rows returns `ok=true` with empty `Lots` (full flatten; red against today's
     `ok=false`).
2. Extend `fakeBaselineStore` (its signatures were already adapted in Step 7) so it models the headers and
   the `UpsertBaselineSnapshot` rules from Step 7 step 2:
   - keep the carry on same id + same `as_of`;
   - return `ErrSnapshotAsOfConflict` on a non-latest `as_of` change;
   - pick `pred` excluding its own id;
   - invoke the callback.
3. Note in comments that `UpsertBaselineSnapshot`'s transaction SQL is proven by SQL-shape review only (no
   DB harness).

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off go test ./internal/repository/... -run EffectiveBaseline -count=1 && \
  GOWORK=off go vet ./... && GOWORK=off golangci-lint run --modules-download-mode=mod
```
The service package compiles from Step 7 on, so `go vet ./...` covers it. The full coverage run is in Step 12.

---

### Step 9 — service: trading ConfirmOrder — fees, filled_at rules, NEW-order masking

**Status**: `done`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/service/trading.go` — modify

**Reviewers**: `xstockstrat-trading` owner — order execution correctness, broker API safety, fill detection,
paper-only dev invariant

**Codebase Evidence**:
- `ConfirmOrder` `trading.go:890-943`:
  - validation `:891-896` (`filled_qty must be >= 0` → `codes.InvalidArgument`);
  - order load `:898`, offline gate `:906-908` (`FailedPrecondition`), owner gate `:910-912`, lock
    `:915-917`;
  - replace semantics `:920-922`;
  - `filled_at` defaults to `time.Now()` unconditionally at `:923-927`;
  - upsert `:930`, cache store `s.orders[order.OrderId] = order` `:933-935`, recompute `:938`, return
    `return order, nil` `:942`.
- `deriveOfflineStatus` `:863-872`: `filledQty <= 0 → NEW`.
- `normalizeFilledQty` `:3531-3538`: the response-edge normalizer site where the new helper goes.
- The response sites (design §2.3) are re-verified at HEAD:
  - GetOrder cache clone `:1494-1496`;
  - GetOrder DB `:1498-1503`;
  - ListOrders in-memory clone `:1543-1548`;
  - ListOrders DB `:1552-1554`.
- The live stream path is `SubscribeOrderUpdates` `:351` (broadcasts only). `StreamOrderUpdates` `:1585`
  is dead code (design §2.3; fails.md 2026-10-20 offline-account-full-pnl).
- Broker coverage: `applyBrokerOrderStatus` `:1690` is untouched. Broker orders never reach
  `ConfirmOrder` (the gate at `:906`).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Validation, next to `:894`, **before** the load at `:898`:
   - if `req.Fees != nil` and the value is `< 0`, NaN or ±Inf (`math.IsNaN`, `math.IsInf`), return
     `grpcstatus.Errorf(codes.InvalidArgument, "fees must be >= 0")`;
   - so `INVALID_ARGUMENT` wins over the broker `FAILED_PRECONDITION` (recon R7) and a bad request
     leaves the order unchanged (AC-9).
2. After `order.Status = deriveOfflineStatus(...)` (`:922`), set fees:
   - if `req.Fees != nil`, use `order.Fees = proto.Float64(*req.Fees)`;
   - else if `order.Fees == nil`, use `order.Fees = proto.Float64(0)`;
   - else keep the stored value.
3. Replace `:923-927` with the `filled_at` rule. `isNew := order.Status == ORDER_STATUS_NEW`, then:
   - if `req.FilledAt != nil && !isNew`, use `req.FilledAt`;
   - else if `order.FilledAt != nil`, keep it;
   - else if `!isNew`, use `timestamppb.Now()`;
   - else leave it nil.
4. Add `hideUnconfirmedFill(o *tradingv1.Order)` next to `normalizeFilledQty`, exactly as design §2.3.
   It is OFFLINE + NEW only and clears `Fees` and `FilledAt`. Give it a 1-line constraint comment: call it
   only on a response-owned copy.
5. Call it at the 5 live sites. Each site already holds a clone or a fresh scan:
   - after `normalizeFilledQty(order)` at `:1495` and `:1502`;
   - inside the `for _, o := range mem` loop at `:1546-1548`;
   - inside the DB loop at `:1552-1554`;
   - in ConfirmOrder, replace `return order, nil` (`:942`) with
     `resp := proto.Clone(order).(*tradingv1.Order); hideUnconfirmedFill(resp); return resp, nil`.
   The unmasked `order` stays in `s.orders`.
6. Do not edit `StreamOrderUpdates` (`:1585`); Step 28 logs it as a finding.
7. Broker/type coverage:
   - `ALPACA`/`IBKR` are unaffected (the helper is OFFLINE-gated, and broker orders never enter
     ConfirmOrder);
   - order type handling is unaffected by this step;
   - fill state: `PARTIALLY_FILLED` and `FILLED` both take the cumulative-fees replace in instruction 2,
     and `NEW` (un-confirm) keeps the stored fees and `filled_at`, hidden.

**Verification**: see Step 10.

---

### Step 10 — test: trading ConfirmOrder fees, filled_at preservation and masking

**Status**: `done`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/service/trading_offline_test.go` — modify
- `services/xstockstrat-trading/internal/testdata/offline_history.go` — create

**Reviewers**: `xstockstrat-trading` owner — order execution correctness, fill detection

**Codebase Evidence**:
- `TestConfirmOrder_Validation` `trading_offline_test.go:521` exits before the repo load, so no existing test
  drives ConfirmOrder past `s.repo.GetOrder`. `s.repo` is a concrete `*repository.TradingRepo`
  (`trading.go:114`). The fakeable constructor is `repository.NewTradingRepoWithDB(db dbQuerier)`
  (`trading_repo.go:40-43`), with precedent at `trading_flatten_rejection_test.go:101` and
  `trading_cancel_not_cancelable_test.go:31`.
- `recordingLedger.requestsByType` is defined at `trading_offline_test.go:79` (called at `:608`), and
  `parseSyncedPayload` at `:606-620`. `newSnapshotTestService` (`:543-558`) builds the service with a nil
  `repo`.
- C-13: the AC-43..47 `S1` history (`ord-b1` BUY 100 @150 `2026-10-01T15:00Z`, `ord-s1` SELL 40 @165
  `2026-10-20T15:00Z`, `ord-s2` SELL 20 @155 `2026-11-05T15:00Z`, `S1` as_of `2026-10-31T23:59:59Z` AAPL
  60 @150) has **two** consumers: this step (AC-47) and Step 12 (AC-43..46). It therefore goes in the
  existing Go home `internal/testdata/` (`order_rows.go:1-3` package doc).

**TDD**: `red-green required`

**Covers**: `AC-8, AC-9, AC-21, AC-37, AC-47, AC-48`

**Instructions**:
1. Create `internal/testdata/offline_history.go`:
   - exported builders `S1HistoryOrders() []*tradingv1.Order` and `S1Snapshot() (asOf time.Time, rows …)`;
   - a header comment citing AC-43..47.
   - also export the order ids as constants (`S1BuyID = "ord-b1"`, `S1SellID = "ord-s1"`,
     `S2SellID = "ord-s2"`).
2. Harness: build the service with `newSnapshotTestService`, then set
   `repo: repository.NewTradingRepoWithDB(mock)` with a pgxmock pool. `GetOrder` is an `ExpectQuery`
   returning a `testdata.NewOrderRow` (incl. `fees`); `UpsertOrder` is an `ExpectExec`. For AC-9, call
   `mock.ExpectationsWereMet()` with **no** query expectations to prove `GetOrder` was never called.
3. Add these tests:
   - `TestConfirmOrder_AC9_NegativeFeesRejectedBeforeLoad`: fees −1 → `InvalidArgument` "fees must be
     >= 0". The repo `GetOrder` must not be called and no upsert happens.
   - `TestConfirmOrder_AC8_ReconfirmReplacesFees`: 5.00 → 2.00. The response and the persisted order both
     carry 2.00.
   - `TestConfirmOrder_AC37_OmittedFeesKept`: confirm with fees 2.00, then re-confirm at price 151 with
     fees nil. The fees stay 2.00 and the price is 151.
   - `TestConfirmOrder_AC21_PartialThenFullCumulative`: qty 100; confirm 40 with fees 0.40 →
     PARTIALLY_FILLED; then confirm 100 with fees 1.00 → FILLED, fees 1.00. This is the fill-state
     partial + full case.
   - `TestConfirmOrder_AC47_ReconfirmKeepsFrozenFilledAt`: from `testdata.S1HistoryOrders()`, re-confirm
     `ord-s1` with no `filled_at`. The stored `filled_at` stays `2026-10-20T15:00Z`.
   - `TestConfirmOrder_AC48_UnconfirmHidesFeesAndFilledAt`:
     - confirm with fees 2.00 and `filled_at` `2026-10-19T14:00Z`, then confirm with `filled_qty 0`;
     - the response and `GetOrder` both show NEW with `Fees == nil` and `FilledAt == nil`, while
       `s.orders` keeps both values;
     - a bare re-confirm (qty 10, no fees, no `filled_at`) returns FILLED, fees 2.00, `filled_at`
       `2026-10-19T14:00Z`.
   - `TestConfirmOrder_QtyZeroNeverFilledKeepsNilFilledAt` (design §2.2 step 3): a later `filled_qty>0`
     confirm without `filled_at` gets now.
   - `TestHideUnconfirmedFill_BrokerUntouched`: an ALPACA NEW order keeps `FilledAt`.

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off go test ./internal/service/... -run 'ConfirmOrder|HideUnconfirmed' -race -count=1 && \
  GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && GOWORK=off go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:" && \
  GOWORK=off golangci-lint run --modules-download-mode=mod && \
  test "$(grep -rn '"ord-s1"' --include='*_test.go' internal | grep -v testdata | wc -l)" -eq 0
```
The total must be ≥ 40%. `service/` is excluded, so the targeted tests are the proof. The last check
**fails** if any test outside `internal/testdata` inlines the `ord-s1` literal; tests use `testdata.S1SellID`.

---

### Step 11 — service: trading recompute payload + snapshot carry flow

**Status**: `done`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/service/trading.go` — modify

**Reviewers**: `xstockstrat-trading` owner — order execution correctness, fill detection

**Codebase Evidence**:
- `recomputeAndEmitOfflinePositions` `trading.go:947-1041`:
  - baseline load `:949`, orders `:957`;
  - window filter `o.FilledAt.AsTime().After(asOf)` `:972`;
  - `pnl.FoldFrom` `:977`, `pnl.Fold` `:980`;
  - emit map `:1033-1039` with top-level keys `account_id, user_id, trading_mode, positions,
    realized_pnl`.
- `offlineFillsFromOrders` `:876-886` maps to signed `pnl.Fill`.
- `SnapshotOfflinePositions` `:1046-1157`:
  - row validation `:1076-1106` (`validRows`, `rejected`);
  - lock `:1121-1123`;
  - `UpsertBaselineSnapshot` `:1125`, `baseline_set` emit `:1138-1144`, recompute `:1146`;
  - response `:1151-1156`.
- Deregister calls `DeleteBaselinesByAccount` at `:2927` (signature unchanged).
- `emitLedgerEvent` `:3571` builds the payload via `structpb.NewStruct`, and RFC3339Nano timestamps are
  already used at `:1019`.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Recompute:
   - Use the Step-7 `EffectiveBaselineByAccount` header: `asOf = hdr.AsOf` and `seedLots = hdr.Lots`;
     `hasBaseline = ok`. An empty `Lots` is a full flatten (AC-42).
   - Over the window orders (with a baseline, `filled_at > asOf`; without one, all orders), compute:
     - `feesSince` = Σ `o.GetFees()` (nil counts as 0);
     - `recentFills` = for each window order with `filled_at ≥ now − 10*24h`, in fold order,
       `{"symbol", "qty": signed, "price": filled_avg_price, "filled_at": RFC3339Nano}`.
   - Add these top-level payload keys:
     - `"fees_since_snapshot": feesSince`;
     - `"realized_carried": hdr.RealizedCarried` and `"fees_carried": hdr.FeesCarried` (0 without a
       baseline);
     - `"recent_fills": recentFills` (an `[]interface{}` of maps).
   - Declare `const offlineRecentFillsWindow = 10 * 24 * time.Hour` with a ≤2-line constraint comment
     (covers the longest NYSE gap; payload bound only; design §10).
2. `SnapshotOfflinePositions`:
   - **Every row rejected and the list is non-empty** (`len(req.Positions) > 0 && len(validRows) == 0`):
     return `committed_count 0` with the rejections. Do this **before** taking the lock: no upsert, no
     emit, no recompute (AC-43).
   - An empty `req.Positions` still commits (full flatten, AC-42).
   - Pass a `CarryFunc` closure to `UpsertBaselineSnapshot`. Inside it:
     - load `ListConfirmedOfflineOrdersByAccount` and take the orders whose `filled_at` falls in
       `(pred.AsOf, asOf]`; with no `pred`, take those with `filled_at == nil || ≤ asOf`;
     - return `pred.RealizedCarried + pnl.FoldFrom(pred.Lots, fills).Realized` and
       `pred.FeesCarried + Σ fees` (zeros and `pnl.Fold` when `pred == nil`).
   - Map `repository.ErrSnapshotAsOfConflict` to
     `grpcstatus.Errorf(codes.FailedPrecondition, "cannot change as_of of a snapshot that is not the latest")`.
3. Frozen-window confirms stay accepted and ignored (`@AC-3 @feature-163`). No code change is needed: the
   window filter at `:972` already drops them, and their fees are excluded because `feesSince` uses the
   same filter.
4. Fill handling for broker paths is unaffected by this step. This is offline only: the offline account
   gates are at `:1071` and `:906`.

**Verification**: see Step 12.

---

### Step 12 — test: trading payload, carry and snapshot rules

**Status**: `done`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/service/trading_offline_test.go` — modify

**Reviewers**: `xstockstrat-trading` owner — order execution correctness, fill detection

**Codebase Evidence**:
- Existing snapshot tests to extend or keep green:
  - `TestSnapshotOfflinePositions_AC6_ResubmitReplaces` `:889`, `_AC7_MalformedRowRejected` `:939`,
    `_AC14_RealizedReset` `:1084`, `_AC18_DeregisterPurge` `:1201`, `_Concurrency_AC10` `:1376`;
  - `TestOfflineRecompute_FromConfirmedOrders` `:397`.
- `parseSyncedPayload` `:606-620` is the payload assertion helper (extend its struct with the new keys).
  `recordingLedger.requestsByType` is defined at `:79`.
- Fixture: `testdata.S1HistoryOrders()` / `S1Snapshot()` from Step 10.
- `fakeBaselineStore.confirmedOrders` (`:110`, returned at `:192-197`) is a static slice. ConfirmOrder stores
  the updated order in `s.orders` (`trading.go:933-935`) **before** the recompute (`:938`).

**TDD**: `red-green required`

**Covers**: `AC-7, AC-8, AC-10, AC-11, AC-20, AC-21, AC-41, AC-42, AC-43, AC-44, AC-45, AC-46, AC-47` (trading half)

**Instructions**:
Each test drives the service with `fakeBaselineStore` and asserts the last `account.positions.synced`
payload.
0. Harness for the cases that call ConfirmOrder (AC-7/8/20/21/46/47):
   - set `repo: repository.NewTradingRepoWithDB(mock)` (pgxmock, as in Step 10);
   - add an optional `ordersFn func() []*tradingv1.Order` to `fakeBaselineStore`. When set,
     `ListConfirmedOfflineOrdersByAccount` returns it instead of the static `confirmedOrders`. Wire it to a
     helper that filters `svc.orders` to PARTIALLY_FILLED/FILLED offline orders. The recompute then sees the
     just-confirmed fees and `filled_at` deterministically;
   - snapshot-only cases keep seeding `confirmedOrders` directly.
1. `AC-7`: confirm a BUY of 100 @150 with fees 1.50. Assert `avg_cost` 150, `fees_since_snapshot` 1.50.
2. `AC-20`: a buy with fees 1.50, then a sell of 100 @156 with fees 1.50. Assert `realized_pnl` 600 and
   `fees_since_snapshot` 3.00.
3. `AC-8`/`AC-21`: assert `fees_since_snapshot` follows the replaced cumulative fees (2.00 and 1.00).
4. `AC-41`:
   - with no baseline, there are three fills (Oct 1 buy, Oct 20 sell, Nov 5 sell);
   - snapshot `S1` with as_of `2026-10-31T23:59:59Z` and AAPL 60 @150;
   - the carry callback receives `pred=nil` and folds the Oct 1 and Oct 20 fills, giving
     `realized_carried` 600;
   - the payload has `realized_pnl` 100, `realized_carried` 600 and AAPL qty 40.
5. `AC-42`: buy 100 @150 and sell 100 @156 before the as_of, then an empty `positions` snapshot. The payload
   has no positions, `realized_pnl` 0 and `realized_carried` 600.
6. `AC-10`/`AC-11`:
   - AC-10: `fees_carried` 3.00 and `realized_carried` 600 after the snapshot;
   - AC-11: a second snapshot after the Nov 3 sell of 20 @155 carries 600 + 100 = 700.
7. `AC-43`: an `S2` whose only row has an empty symbol. The response has `committed_count 0` and 1
   rejection. The fake records **zero** upsert calls and **zero** new synced or `baseline_set` events.
8. `AC-44`: with `S2` present, a re-submit of `S1` with a new `as_of` returns `FailedPrecondition` and the
   stored carries are unchanged.
9. `AC-45`: re-submit `S1` (the latest) with as_of `2026-11-10T23:59:59Z` and AAPL 40 @140. Assert:
   - the callback's `pred` excludes `S1` itself, giving a carry of 700;
   - the payload has `realized_pnl` 0 and AAPL avg 140.
10. `AC-46`: a NEW BUY of 10 confirmed with `filled_at` `2026-10-15T15:00Z` and fees 5.00. The confirm
    succeeds, the payload qty stays 40, `realized_pnl` stays 100, and `fees_since_snapshot` and
    `fees_carried` stay 0.
11. `AC-47`: a re-confirm of `ord-s1` with fees 2.00 and no `filled_at` keeps the payload unchanged
    (`fees_carried` 0).
12. `recent_fills`:
    - a fill 11 days old is excluded, a fill 9 days old is included;
    - entries carry signed qty and a `filled_at` RFC3339Nano string;
    - a frozen-window fill is never included.
13. `@AC-6 @feature-163` re-submit with the same id and the same `as_of` keeps the carry (the callback is
    not invoked).

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off go test ./internal/service/... -run 'Snapshot|OfflineRecompute|RecentFills|ConfirmOrder' -race -count=1 && \
  GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && GOWORK=off go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:" && \
  GOWORK=off golangci-lint run --modules-download-mode=mod
```
The total must be ≥ 40%. New logic is in the excluded `service/` package, so the targeted tests are the
proof.

---

### Step 13 — service: marketdata `BatchGetBars` opt-in `allow_partial`

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/service/marketdata_service.go` — modify

**Reviewers**: `xstockstrat-marketdata` owner — OHLCV ingestion integrity, Alpaca feed idempotency

**Codebase Evidence** (post-231 lines):
- `BatchGetBars` `marketdata_service.go:703-812`:
  - the warm read is `s.repo.QueryBarsBatch` `:744-747` (an error fails the RPC);
  - cold detection is at `:751-756`;
  - the singleflight key `fmt.Sprintf("batch:%s:%s:%d:%d", …)` is at `:760`;
  - the closure runs `ms.GetBarsMulti(ctx, …)` `:770` and `s.repo.InsertBars(ctx, bars)` `:778` on the
    **caller** ctx;
  - `if fetchErr != nil { return nil, fetchErr }` is at `:789-791`.
- `s.repo` is the concrete `*repository.MarketDataRepo` (field `:37`, assigned at `:206`). `QueryBarsBatch` uses
  `r.pool.Query` (`marketdata_repo.go:449-472`, `ORDER BY time ASC`), so warm bars cannot be unit-mocked
  today.
- The 231 seam pattern to reuse: the interfaces `quoteStore`/`dailyCloseReader` are at `:117-136`, and
  they are assigned only when `repo != nil` at `:225-230` ("a nil pointer in an interface field defeats the
  nil-seam default").
- The feature-229 detached-budget precedent: `context.WithTimeout(context.WithoutCancel(ctx), …)` at
  `:593` and the WARN on cold-fetch failure at `:621`.
- Strict-path client code: `forwardConnectErr` (`marketdata_handler.go:285-291`) wraps a non-connect error
  as `CodeInternal`, and `toGRPCError` (`:496-516`) maps it to `codes.Internal`.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Add a narrow seam:
   - `type barsBatchStore interface { QueryBarsBatch(ctx, symbols []string, tf string, start, end time.Time,
     max int32) (map[string][]*marketdatav1.Bar, error); InsertBars(ctx, bars []*marketdatav1.Bar) error }`;
   - add the field `barsStore barsBatchStore` beside `quoteStore`, and assign `svc.barsStore = repo` inside
     the existing `if repo != nil` block (`:225-230`);
   - replace `s.repo` with `s.barsStore` in `BatchGetBars` only;
   - test literals with a nil repo still treat every symbol as cold, as today.
   This seam is required to unit-test AC-53/54's warm subset; it follows the 231 precedent (C-18 DRY).
2. Add `const barsPartialMargin = 250 * time.Millisecond` with a constraint comment: reply headroom inside
   the caller's deadline (design §10).
3. Key: append `req.AllowPartial` using `"batch:%s:%s:%d:%d:%t"`.
4. Refactor the closure body into a function of `fctx context.Context`, used for both `GetBarsMulti` and
   `InsertBars`. The **strict** path (flag unset) calls it with the caller `ctx` and keeps
   `return nil, fetchErr`, byte-identical behaviour.
5. **Partial** path (`req.AllowPartial`):
   - if `ctx` has no deadline, `fctx = ctx`;
   - else `budget := time.Until(dl) − barsPartialMargin`:
     - if `budget ≤ 0`, skip the cold fetch with WARN
       `"BatchGetBars: no deadline budget for cold fetch; returning stored bars"` (`cold`);
     - else use `context.WithTimeout(context.WithoutCancel(ctx), budget)`;
   - on `fetchErr`, WARN `"BatchGetBars: cold fetch failed; returning stored bars"` (`cold`,
     `budget_ms`, `error`) and fall through to return the warm subset.
6. A warm read error still fails the RPC, and a symbol with no bars is still omitted.

**Verification**: see Step 14.

---

### Step 14 — test: marketdata `allow_partial`

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/service/marketdata_service_test.go` — modify

**Reviewers**: `xstockstrat-marketdata` owner — OHLCV ingestion integrity

**Codebase Evidence**:
- `fakeBatchBarsSource` `marketdata_service_test.go:1296-1310` returns only seeded bars.
- `TestBatchGetBars_OmitMissingSymbols` `:1182-1215` must stay unchanged.
- The registry wiring pattern is `source.NewRegistry(); reg.Register("alpaca", src)` (`:1146-1147`).

**TDD**: `red-green required`

**Covers**: `AC-53, AC-54`

**Instructions**:
1. Add a test-local `fakeBarsStore` implementing `barsBatchStore`, with AAPL's 3 bars dated 2026-10-14/15/16
   at 04:00Z (C-13: single consumer, inline). Add an erroring source `GetBarsMulti` and a hanging one that
   waits on `<-ctx.Done()`.
2. `TestBatchGetBars_AC53_PartialReturnsWarmOnColdError`: `allow_partial=true` returns only AAPL with 3
   bars and no error.
3. `TestBatchGetBars_AC53_StrictStillErrors`: `allow_partial=false` returns the source error. Through the
   handler adapter it becomes `codes.Internal` and the message carries the fetch error. Assert at the
   **service** level only: the returned error `errors.Is` the source error and is not a Connect error. The
   `INTERNAL` mapping is unchanged handler code (`marketdata_handler.go:285-291`, `:496-516`); cite it in the
   test comment. No handler test file is touched (F-08).
4. `TestBatchGetBars_AC54_PartialBudgetFromDeadline`: a 1000ms ctx deadline and a hanging source → returns
   AAPL 3 bars within 1000ms.
5. `TestBatchGetBars_PartialBelowMarginSkipsSource`: a 200ms deadline means the source is never called.
6. `TestBatchGetBars_PartialAndStrictSeparateFlights`: concurrent strict and partial callers with the same
   symbols produce 2 source calls.
7. `TestBatchGetBars_PartialNoDeadlineUsesCallerCtx`: the source sees the caller ctx, and a cancelled
   caller gets warm bars with nil error.
8. `TestBatchGetBars_PartialWaiterSurvivesLeaderCancel`.

**Verification**:
```bash
cd services/xstockstrat-marketdata && GOWORK=off go test ./internal/service/... -run 'BatchGetBars' -race -count=1 && \
  GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && GOWORK=off go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:" && \
  GOWORK=off golangci-lint run --modules-download-mode=mod
```
The total must be ≥ 40%. The `service/` package is excluded, so the targeted tests are the proof.

---

### Step 15 — service: portfolio `internal/marketsession` calendar

**Status**: `done`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/marketsession/marketsession.go` — create

**Reviewers**: `xstockstrat-portfolio` owner — P&L calculation accuracy

**Codebase Evidence**:
- **Not found**: there is no calendar or America/New_York helper in any service (recon R2). This is new
  code with no existing pattern.
- The bar timestamp convention was verified on staging on 2026-10-20 (Execution Summary): 1d bars are
  stamped 00:00 America/New_York of the session date (04:00Z EDT / 05:00Z EST). The NYSE regular session is
  09:30–16:00 ET, a domain constant (design §10).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Create package `marketsession`:
   - import `_ "time/tzdata"` and load `America/New_York` once;
   - export:
     - `SessionDate(t time.Time) civil date` (as a `time.Time` at NY midnight): the NY date of
       `t.Add(6*time.Hour)`;
     - `DayStart(d)`: 00:00 NY of the date;
     - `Open(d)`: 09:30 NY of the date;
     - `IsTradingDay(d)`: Mon–Fri and not an NYSE holiday;
     - `PrevTradingDay(d)`;
     - `Reference(now) (ref time.Time, live bool)`: the session in progress, or the most recently
       completed session on a weekend, holiday, pre-open or post-close read.
2. Holidays, rule-based with observed days:
   - New Year's (Sat → no observance, Sun → Mon);
   - MLK (3rd Mon Jan), Presidents (3rd Mon Feb), Good Friday (Easter computus), Memorial (last Mon May);
   - Juneteenth (Jun 19 observed), Independence (Jul 4 observed);
   - Labor (1st Mon Sep), Thanksgiving (4th Thu Nov), Christmas (Dec 25 observed).
   Early closes and one-off closures are not modelled (design §12 limitation 3).
3. Add a ≤2-line package comment: a fact of the exchange, not config (F-07 reviewed at the design gate).

**Verification**: see Step 16.

---

### Step 16 — test: calendar + golden bar-date mapping

**Status**: `done`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/marketsession/marketsession_test.go` — create

**Reviewers**: `xstockstrat-portfolio` owner — P&L calculation accuracy

**Codebase Evidence**:
- Golden vectors from the staging `marketdata.ohlcv` AAPL 1d rows (`query_bars`, 2026-10-20):
  - `2026-10-12T04:00:00Z`→2026-10-12 … `2026-10-16T04:00:00Z`→2026-10-16;
  - `2026-10-19T04:00:00Z`→2026-10-19;
  - `2026-01-12T05:00:00Z`→2026-01-12 … `2026-01-16T05:00:00Z`→2026-01-16;
  - `2025-10-31T04:00:00Z`→2025-10-31 and `2025-11-03T05:00:00Z`→2025-11-03 (across the 2025-11-02 DST
    end).
- `internal/marketsession` is **not** in the coverage exclusion regex `(cmd|handler|repository|telemetry|service)`,
  so CI measures it.

**TDD**: `red-green required`

**Covers**: — (enables AC-24, AC-35, AC-49, AC-50 in Step 20)

**Instructions**:
1. `TestSessionDate_GoldenStagingBars`: a table of the 13 vectors above (single consumer, inline).
2. `TestReference`:
   - Mon 2026-10-19 15:00Z → (10-19, live);
   - 2026-10-19 21:00Z → (10-19, off);
   - Sat 2026-10-17 → (10-16, off);
   - Mon 2026-10-19 12:00Z (pre-open) → (10-16, off);
   - 2026-11-26 (Thanksgiving) → (11-25, off);
   - Good Friday 2027-03-26 → (2027-03-25, off).
3. `TestPrevTradingDay`:
   - 10-19 → 10-16;
   - 2026-07-06 → 2026-07-02 (Jul 3 is the observed holiday);
   - 2027-12-27 → 2027-12-23 (Dec 24 observed + weekend).
4. `TestHolidays_2026_2028`: the full holiday list per year.
5. `TestDST`: `Open` on 2026-03-09 is 13:30Z and on 2026-11-02 is 14:30Z.

**Verification**:
```bash
cd services/xstockstrat-portfolio && GOWORK=off go test ./internal/marketsession/... -count=1 -cover && \
  GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && GOWORK=off go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:" && \
  GOWORK=off golangci-lint run --modules-download-mode=mod
```
The total must be ≥ 40%, and `marketsession` coverage should be ≥ 90%. **No Day P&L code (Step 19) may
merge before this step is green** (design blocking risk).

---

### Step 17 — service: portfolio sync consumer + user-scoped offline state

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/portfolio_service.go` — modify
- `services/xstockstrat-portfolio/internal/repository/portfolio_repo.go` — modify

**Reviewers**: `xstockstrat-portfolio` owner — P&L calculation accuracy, position snapshot consistency,
concurrent write safety

**Codebase Evidence**:
- `positionSyncPayload` `portfolio_service.go:990-1016`: `RealizedPnl *float64 json:"realized_pnl"` at
  `:1015` is the broker/offline discriminator.
- `processPositionSync` `:1079-1137`:
  - runs under `positionsMu` `:1096-1097`;
  - `shouldReconcileSyncDeletions` `:1075-1077` (the 206 guard, unchanged);
  - `UpsertOfflineRealized` is called at `:1132-1136`.
- `UpsertOfflineRealized` `portfolio_repo.go:454-464` writes `realized_pnl` only, via `r.pool.Exec`.
- `GetOfflineRealized` `:466-483` is **unscoped**: `WHERE account_id=$1`, no `user_id` (the pre-existing
  leak, design Open Risks). It is called at `portfolio_service.go:605` (GetPortfolio) and `:1257`
  (`buildAccountPortfolio`).
- The `queryRower` mock surface is at `portfolio_repo.go:21-25` (`r.db`), so pgxmock can drive reads.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Extend `positionSyncPayload`:
   - add `RealizedCarried *float64 json:"realized_carried"`, `FeesSinceSnapshot *float64
     json:"fees_since_snapshot"` and `FeesCarried *float64 json:"fees_carried"`;
   - add `RecentFills []RecentFill json:"recent_fills"`, with
     `type RecentFill struct{ Symbol string; Qty, Price float64; FilledAt string }` and JSON tags
     `symbol/qty/price/filled_at`. Define it in `repository` so the repo can marshal it.
2. Repo:
   - Keep `accountID, userID, tradingMode` as positional args (the table needs `user_id`/`trading_mode` NOT
     NULL, `012_offline_account_realized.up.sql:10-11`). Replace only the trailing `realizedPnl float64` arg
     with an `OfflineState` struct `{RealizedPnl, RealizedCarried, FeesSinceSnapshot, FeesCarried float64;
     RecentFills []RecentFill}`. Write all five columns in one
     `INSERT … ON CONFLICT (account_id) DO UPDATE`. `recent_fills` is `json.Marshal` of a non-nil slice,
     so `[]` is stored when absent.
   - The writer must use `r.db.Exec`, not `r.pool.Exec`, so it is mockable. `queryRower` already has
     `Exec` (`:24`).
3. Repo: add `GetOfflineStates(ctx, userID string, accountIDs []string) (map[string]OfflineState, error)`:
   - query `SELECT account_id, realized_pnl, realized_carried, fees_since_snapshot, fees_carried,
     recent_fills FROM portfolio.offline_account_realized WHERE user_id=$1 AND account_id = ANY($2)`;
   - `recent_fills` is scanned as `[]byte` and then `json.Unmarshal`ed;
   - empty `accountIDs` returns an empty map with no query.
   **Keep** `GetOfflineRealized` in this step. Its callers (`portfolio_service.go:605`, `:1257`) and
   `offline_realized_test.go:14,46` still compile. Step 21 moves the callers to `GetOfflineStates` and deletes
   it together with its two tests (avoids an F-05 compile break across Steps 18–20).
4. `processPositionSync`: when `sync.RealizedPnl != nil`, build the `OfflineState`. Absent pointers become
   0 and absent `RecentFills` becomes `[]` (FR-7 / AC-18 for old events replayed from sequence 0).
5. The broker path is untouched: the nil `RealizedPnl` path never writes offline state.

**Verification**: see Step 18.

---

### Step 18 — test: portfolio sync consumer + offline state reads

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/repository/offline_realized_test.go` — modify
- `services/xstockstrat-portfolio/internal/service/portfolio_offline_test.go` — modify

**Reviewers**: `xstockstrat-portfolio` owner — P&L calculation accuracy, concurrent write safety

**Codebase Evidence**:
- `internal/repository/offline_realized_test.go` (62 lines) is the existing pgxmock home for the offline
  realized repo.
- `TestPositionSyncPayload_RealizedPnlDisjointness` `portfolio_offline_test.go:17` and
  `TestShouldReconcileSyncDeletions` `:58` must stay green.

**TDD**: `red-green required`

**Covers**: `AC-7, AC-10, AC-11, AC-18, AC-20, AC-41, AC-42` (portfolio storage half)

**Instructions**:
1. Repo:
   - `TestUpsertOfflineRealized_WritesAllFields`: `ExpectExec` with the 5 values and the JSON `recent_fills`.
   - `TestGetOfflineStates_UserScoped`: the regex requires `WHERE user_id=\$1 AND account_id = ANY\(\$2\)`;
     a row for another user is not returned.
   - `TestGetOfflineStates_EmptyIDsNoQuery`.
2. Service payload parse:
   - `AC-18`: a legacy payload `{realized_pnl: 450}` parses to `RealizedCarried` 0, fees 0 and
     `RecentFills` `[]` (lifetime = 450);
   - `AC-41`: `{realized_pnl:100, realized_carried:600}` gives lifetime 700;
   - `AC-42`: `{positions:[], realized_pnl:0, realized_carried:600}` still purges positions (206 guard) and
     stores carried 600;
   - `AC-7`/`AC-20`: `fees_since_snapshot` 1.50 and 3.00 round-trip;
   - `AC-10`/`AC-11`: `fees_carried` 3.00 and `realized_carried` 700 round-trip.
3. C-13: payload literals are single-consumer (inline).

**Verification**:
```bash
cd services/xstockstrat-portfolio && GOWORK=off go test ./internal/repository/... ./internal/service/... -run 'Offline|PositionSync|Reconcile' -race -count=1 && \
  GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && GOWORK=off go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:" && \
  GOWORK=off golangci-lint run --modules-download-mode=mod
```
The total must be ≥ 40%; the excluded packages are covered by the targeted tests.

---

### Step 19 — service: portfolio shared offline valuation (marks, Day P&L, short %)

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/offline_valuation.go` — create
- `services/xstockstrat-portfolio/internal/service/portfolio_service.go` — modify
- `packages/proto/pnl/pnl.go` — modify (export `QtyEpsilon`)

**Reviewers**: `xstockstrat-portfolio` owner — P&L calculation accuracy, position snapshot consistency

**Gate**: operator decision **D-1** must be recorded in `context.md` before this step executes.

**Codebase Evidence** (post-231):
- `enrichPositions` `portfolio_service.go:440-444` calls `latestQuotesFor` → `applyQuotes` → `enrichRisk`.
- `latestQuotesFor` `:392-408`:
  - `context.WithTimeout(ctx, s.quoteTimeout())` `:397`;
  - WARN "batch latest quotes unavailable" `:401`.
- `quoteTimeout` `:411-420` reads `s.quoteCfg.GetInt("portfolio.marketdata.quote_timeout_ms", 4000)`. The
  `intConfig` interface is at `:1433-1435`, and `quoteCfg` is assigned only when non-nil at `:153-156`.
- `unvaluedSymbols` `:424-438` skips `CurrentPrice > 0` (broker-valued).
- `markOf` `:446-456`: `mark_price`, else the two-sided mid. `applyQuotes` `:460-476`.
- `enrichPosition(p, price)` `:559-566` holds the short-% bug `if p.CostBasis > 0`.
- The marketdata client is built with `grpc.WithChainUnaryInterceptor(middleware.UnaryClientInterceptor)`
  (`:127`), so a new `BatchGetBars` call on `s.marketdata` reuses the header-propagation interceptor (C-03,
  `docs/patterns/header-propagation.md` Go interceptor).
- Paths that must not reach the step:
  - `GetPnL` `:652-659` (its own `latestQuotesFor` + `applyQuotes`);
  - `broadcastSnapshot` `:838` (231: `:843-844`);
  - `checkRiskLimits` `:894` (231: `:904-905`).
- `pnl.go:77,84,89` hold the three `1e-9` literals.
- `Quote.time` (`marketdata.proto:93`) is the quote timestamp used for freshness and `mark_as_of`.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. `pnl.go`: add `const QtyEpsilon = 1e-9` (doc: flat-lot tolerance) and replace the 3 literals.
   Behaviour is identical.
2. `offline_valuation.go`:
   - `lastCloseLookbackDays()` reads `s.quoteCfg.GetInt("portfolio.marketdata.last_close_lookback_days",
     21)`; a value ≤ 0 or a nil `quoteCfg` means 21 (F-07).
   - `fetchMarks(ctx, quoteSyms, barSyms)` runs **two concurrent** fetches, each under
     `context.WithTimeout(ctx, s.quoteTimeout())`:
     - the existing `latestQuotesFor`;
     - `s.marketdata.BatchGetBars` with `Symbols: barSyms`, `Timeframe: "1d"`,
       `Start: DayStart(NYdate(now) − L days)`, `End: now.Truncate(time.Minute)`,
       `MaxBarsPerSymbol: L+1` and `AllowPartial: true`.
     - On a bars error, WARN `"offline last-close bars unavailable"` and use an empty bar map.
   - Bars per symbol are indexed by `marketsession.SessionDate(bar.Time)`.
   - Implement `valueOffline(now, positions, states map[accountID]OfflineState, quotes, bars)` exactly as
     design §4.5:
     - `(ref, live) := marketsession.Reference(now)`; `D0 = DayStart(ref)`;
       `D1 = DayStart(ref + 1 calendar day)`; `P = PrevTradingDay(ref)`.
     - Prices: `pc` = the close of the bar dated `P`; `refClose` = the bar dated `ref`, off-session only;
       `lastClose` = the newest bar before `ref` when live, or at/before `ref` off-session.
     - **QUOTE mark (D-1 default):** a quote counts only if it is two-sided **and**
       `q.Time ≥ Open(ref)`. The price is `markOf(q)`.
     - Mark order: live session → quote → `lastClose` → NONE; off-session → `refClose` → quote →
       `lastClose` → NONE.
     - `mark_as_of`: `DayStart(bar date)` for `LAST_CLOSE`, `q.Time` for `QUOTE`, unset for `NONE`.
     - Per symbol, from the account's `RecentFills`:
       - `after` = Σ qty of fills at or after `D1`;
       - `in` = the fills in `[D0, D1)`;
       - `q_refclose = q_now − after`;
       - `q_open = q_refclose − Σ in.qty`.
     - Walk `in`, starting from overnight shares, with `|x| < pnl.QtyEpsilon` treated as 0. A reduction
       consumes overnight shares first, then same-session lots.
     - The terms are per FR-1. An overnight term without `pc` is 0 and is excluded from `base`. A
       `MARK_SOURCE_NONE` position contributes nothing.
     - Return per-position `{mark, source, markAsOf, dayPnl, dayPnlPct}` and per-account
       `{dayPnl, base}`. The account figures include symbols present only in `RecentFills` (fully closed in
       session, AC-34).
3. Add the shared `markAt(p, price)`, which replaces `enrichPosition`:
   - `CurrentPrice`, `MarketValue = price*qty`, `UnrealizedPnl = MV − CostBasis`;
   - `if CostBasis != 0 { UnrealizedPnlPct = UnrealizedPnl / math.Abs(CostBasis) }`. This is the
     platform-wide short-% fix (FR-2, AC-26). It changes the `:563-565` guard.
   `applyQuotes` calls `markAt` and sets `MarkSource = QUOTE` and `MarkAsOf = q.Time`. In `enrichPositions`
   and `ListPortfolios`, broker-valued positions (`CurrentPrice > 0` from sync) get `BROKER`, and anything
   left unpriced gets `NONE`. Only the label is new for non-offline positions.
4. `enrichPositions(ctx, positions)`:
   - offline candidates are positions with `Source ≠ 0`;
   - with **none**, the call path and calls are exactly as today (0 `GetOfflineStates`, 0 `BatchGetBars`);
   - otherwise:
     - `userID := middleware.FromContext(ctx).UserID`, then one `GetOfflineStates(ctx, userID,
       offlineAccountIDs)`;
     - `fetchMarks` with quote symbols = `unvaluedSymbols(positions)` and bar symbols = the offline symbols
       ∪ recent-fill symbols with `filled_at ≥ D0`;
     - `applyQuotes` for non-offline positions, then `valueOffline` for offline positions, then
       `enrichRisk`.
   - `GetOfflineStates` failure is **non-fatal**: WARN `"offline state unavailable"`, then use an empty map
     (offline positions are still marked; account Day P&L terms from `RecentFills` are 0). Existing 229/231
     tests leave that query unexpected (`portfolio_quote_deadline_test.go:115`), so it must not fail the read.
   - Expose `valueAccounts(ctx, offlineAccountIDs, positions, marks)` returning per-account `{dayPnl, base}`.
     It is driven by the **in-scope offline account IDs**, not by position `Source`, so an offline account with
     no open positions is still valued from its `RecentFills` and lifetime realized (AC-34, AC-6). It
     **reuses** the quote and bar maps that `fetchMarks` already returned for the read; it never issues a
     second quote or bars batch (C-18).
5. Leave `GetPnL`, `broadcastSnapshot` and `checkRiskLimits` untouched. They keep `latestQuotesFor` +
   `applyQuotes` (FR-8; `GetPnL` UNAVAILABLE preserved, 229 @AC-5, 231 @AC-6 GetPnL half).

**Verification**: see Step 20.

---

### Step 20 — test: portfolio valuation (positions)

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/offline_valuation_test.go` — create
- `services/xstockstrat-portfolio/internal/service/portfolio_service_test.go` — modify (the `stubMarketData` gains `BatchGetBars`)
- `services/xstockstrat-portfolio/internal/service/portfolio_helpers_test.go` — modify (`TestEnrichPosition` → `markAt` with the short case)
- `services/xstockstrat-portfolio/internal/testdata/offline_pnl.go` — create

**Reviewers**: `xstockstrat-portfolio` owner — P&L calculation accuracy, position snapshot consistency

**Codebase Evidence**:
- `stubMarketData` `portfolio_service_test.go:16-44` embeds a nil `MarketDataServiceClient`, so any
  un-overridden RPC panics. It has `block`, `quotesErr` and `requested` knobs.
- The pgxmock harness `newQuoteSvc` is at `portfolio_quote_deadline_test.go:93-114`:
  - `posRow(rows, sym, account, qty, avg, current)` `:84-87` hard-codes `source` to `0` (the `0` before the
    final `nil`). Do **not** change it: 229/231 tests depend on it. Instead add a source-aware
    `offlinePosRow(rows, sym, account, qty, avg, source)` helper in `offline_valuation_test.go` (listed);
  - `guard` `:70-82` is the timing helper;
  - `recordWarns` `:60`.
- `anyArgs`/`positionCols` are at `portfolio_fill_errors_test.go:36-49`, and `fakeConfig` at
  `watchlist_service_test.go:244`.
- The C-13 home `internal/testdata/marks.go` exists (feature 231). The 230 scenario prices (AAPL pc 160,
  quote 164/163, TSLA −10 @200, XYZ 22, NEWCO) have two consumers (Steps 20 and 22), so they go in
  `internal/testdata/offline_pnl.go`.
- Existing 231 tests use `posRow` with `source 0`, so they stay on the non-offline path and must remain
  green unchanged (`portfolio_mark_test.go:60-172`).

**TDD**: `red-green required`

**Covers**: `AC-1, AC-2, AC-5, AC-12, AC-13, AC-19, AC-22, AC-23, AC-24, AC-26, AC-27, AC-31, AC-35, AC-36, AC-38, AC-40, AC-49, AC-50, AC-51` (position level; AC-13: ZZZZ marked `MARK_SOURCE_NONE` with `current_price 0`)

**Instructions**:
1. `stubMarketData`:
   - add `BatchGetBars` with `bars map[string][]*Bar`, `barsErr`, `barsBlock` and `barsCalls int`;
   - record `AllowPartial`, so a test can assert it is set.
2. `testdata/offline_pnl.go`: the named constants and bar builders, each stamped at 00:00 NY via
   `marketsession.DayStart`.
3. Valuation tests, with a clock injected through a `now func() time.Time` seam on `valueOffline`:
   - `AC-1`: 400 / 0.0250.
   - `AC-2`: 350.
   - `AC-22`: TSLA 130.
   - `AC-23`: qty 30, 590.
   - `AC-40`: NEWCO 10.
   - `AC-36`: a baseline inside the session → 300.
   - `AC-24`/`AC-31` (Saturday 10-17): AAPL `LAST_CLOSE` 160, day 200; TSLA −10 → day 50, unrealized 200,
     pct +0.10.
   - `AC-35` both rows:
     - the 21:00Z read with a 10-19 bar → `LAST_CLOSE` 162, day 200;
     - without the bar → `QUOTE` 163, day 300.
   - `AC-49`: live, quotes fail, a forming 10-19 bar at 161 → `LAST_CLOSE` 158, `mark_as_of` 10-16, day 0.
   - `AC-50`: a Saturday fill after ref → qty 50, day 200.
   - `AC-51`: bars error → `QUOTE` 164, day 0.
   - `AC-12`: XYZ `LAST_CLOSE` 22, `mark_as_of` 2026-10-16, unrealized 20.
   - `AC-38`: NEWCO day 0, `QUOTE` 50.
   - `AC-5`: a short → pct 0.1000.
   - `AC-26`: a broker-account order-fill short through `applyQuotes` → 0.1000.
   - `AC-19`: a broker-synced position keeps `current_price` 163 and day 120, labelled `BROKER`, with 0
     `BatchGetBars` calls.
   - D-1:
     - an offline position with a one-sided quote that carries a `mark_price` and a stored close →
       `LAST_CLOSE` at the bar close;
     - the same quote on a `source 0` position still uses `markOf` (231 @AC-1 path unchanged).
4. `AC-27` outline:
   - `ListPositions` with `block: true` and a `quote_timeout_ms` of 2500 → returns within 3000ms
     (`guard`), AAPL `LAST_CLOSE` 158;
   - `ListPortfolios` with `quotesErr` is covered in Step 22.
5. Boundary tests:
   - a broker-only `ListPositions`/`GetPosition` makes 0 `GetOfflineStates` queries and 0 `BatchGetBars`
     calls;
   - a `BatchGetBars` request has `AllowPartial=true`, `Timeframe "1d"` and `MaxBarsPerSymbol 22`;
   - with a lookback of 21, setting `fakeConfig` to 5 makes `MaxBarsPerSymbol` 6.
6. `TestEnrichPosition` becomes `TestMarkAt`, adding a short case with pct > 0.

**Verification**:
```bash
cd services/xstockstrat-portfolio && GOWORK=off go test ./internal/service/... -run 'Valuation|MarkAt|AC1_|AC14_|AC13_|AC6_|ListPositions|EnrichPositions' -race -count=1 && \
  (cd ../xstockstrat-trading && GOWORK=off go test ./internal/service/... -run Pnl -count=1) && \
  GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && GOWORK=off go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:" && \
  GOWORK=off golangci-lint run --modules-download-mode=mod && \
  test "$(grep -n 'AddRow(' internal/service/offline_valuation_test.go | grep -c '16[034]\.')" -eq 0
```
The total must be ≥ 40%. The pnl fold tests in both services must stay green (the `QtyEpsilon` refactor).
The last check fails if a scenario price is inlined in the new test's rows instead of coming from
`testdata/offline_pnl.go` (C-13).

---

### Step 21 — service: portfolio account-level P&L on GetPortfolio and ListPortfolios

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/portfolio_service.go` — modify
- `services/xstockstrat-portfolio/internal/repository/portfolio_repo.go` — modify (delete `GetOfflineRealized`)
- `services/xstockstrat-portfolio/internal/repository/offline_realized_test.go` — modify (remove
  `TestGetOfflineRealized_FoundAndMissing` `:14` and `_EmptyAccountID` `:46` in the same step that deletes
  the function, so the package always compiles; Step 18's `GetOfflineStates` tests replace them)

**Reviewers**: `xstockstrat-portfolio` owner — P&L calculation accuracy, position snapshot consistency

**Codebase Evidence**:
- `GetPortfolio` `portfolio_service.go:581-609`:
  - user-scoped `s.repo.ListPositions(ctx, userID, req.TradingMode, …, req.GetAccountId(), …)` `:584`;
  - Equity = Σ MV `:590-593`;
  - unscoped `GetOfflineRealized` `:605-607`;
  - sets no Day/Total P&L.
- `buildAccountPortfolio` `:1231-1261`: `TotalPnl = Σ unrealized` `:1242`; broker
  `DayPnl = Equity − LastEquity` with the pct guard `:1246-1254`.
- `ListPortfolios` `:1265-1347`:
  - the H-3 ownership gate is at `:1276-1282` (unchanged);
  - the single-account path is `:1283-1294` (`enrichPositions`);
  - the all-accounts path has the offline append `:1321-1332` and the union quote batch
    `latestQuotesFor` + `applyQuotes` `:1339-1345`.
- Balance reads: `GetAccountBalance` `portfolio_repo.go:438`, `ListAccountBalancesByUser` `:498`,
  `ListOfflineAccountIdsByUser` `:523`.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Extract `applyAccountPnL(p *Portfolio, positions, bal *AccountBalance, st *OfflineState, acct accountVal)`
   from `buildAccountPortfolio`. Per account:
   - **Broker** (`bal != nil`): the existing rule at `:1246-1254`, with `TotalPnl = Σ unrealized`. Set no
     `total_pnl_pct`.
   - **Offline** (`st != nil`):
     - `Equity`/unrealized sums skip `MARK_SOURCE_NONE` positions (FR-5);
     - `DayPnl = acct.dayPnl` and `DayPnlPct = acct.dayPnl/acct.base` (0 if `base` is 0);
     - `lifetime = st.RealizedCarried + st.RealizedPnl`;
     - `TotalPnl = lifetime + Σ unrealized(priced)`;
     - `TotalPnlPct = proto.Float64(TotalPnl / Σ|CostBasis|(priced))`, 0 when the denominator is 0;
     - `RealizedPnl = proto.Float64(st.RealizedPnl)`, `RealizedPnlLifetime = proto.Float64(lifetime)`;
     - `FeesSinceSnapshot = proto.Float64(st.FeesSinceSnapshot)` and
       `FeesLifetime = proto.Float64(st.FeesCarried + st.FeesSinceSnapshot)`.
2. `buildAccountPortfolio` calls `applyAccountPnL` using the `GetOfflineStates` map, fetched once per read
   (user-scoped). This removes the unscoped `GetOfflineRealized` call at `:1257`. Move the `:605` caller to
   `GetOfflineStates` too, then **delete** `GetOfflineRealized` from `portfolio_repo.go` and its two repo
   tests.
3. `ListPortfolios` all-accounts: replace the `:1339-1345` union `latestQuotesFor`/`applyQuotes` with **one**
   shared valuation call over the union (one quote batch and one bars batch: C-10(b), 178 @AC-1, AC-27).
   Then run `enrichRisk` and `buildAccountPortfolio` per account. The single-account path already goes
   through `enrichPositions` and gets the account values via `valueAccounts`.
4. `GetPortfolio`:
   - Scope:
     - with `account_id`, that account;
     - without it, the user's `ListAccountBalancesByUser` ∪ `ListOfflineAccountIdsByUser` ∪ the account
       ids on the user's positions.
     There is no PermissionDenied. An unowned or brand-new account shows as empty with the account-level
     optionals omitted (AC-52).
   - Iterate the **in-scope account set** (not the position groups), attaching each account's positions
     (possibly none), and run the shared valuation once. A flat offline account with no positions still gets
     its Day P&L from `RecentFills` and its Total P&L from lifetime realized (AC-34, AC-6).
   - **Single account:** `applyAccountPnL` with its balance (`GetAccountBalance` only if the id is in
     the user's `ListAccountBalancesByUser`, which keeps it user-scoped) and its offline state.
   - **Aggregate:**
     - `DayPnl = Σ account day`;
     - `DayPnlPct = Σ day / Σ prior`, where prior is broker `LastEquity` and offline `base`;
     - `TotalPnl = Σ account total`;
     - `TotalPnlPct` is set only when every in-scope account is offline (as `Σ total / Σ |cost|`);
     - realized and fees optionals stay unset;
     - `Equity = Σ MV`, keeping the current `GetPortfolio` equity semantics (design limitation 11);
     - `req.TradingMode` filters positions only.

**Verification**: see Step 22.

---

### Step 22 — test: portfolio account-level figures + FR-9 parity

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/offline_account_pnl_test.go` — create

**Reviewers**: `xstockstrat-portfolio` owner — P&L calculation accuracy, position snapshot consistency,
concurrent write safety

**Codebase Evidence**:
- `expectAllAccounts` `portfolio_quote_deadline_test.go:116-130` (balance + offline id + positions
  queries).
- `TestAC13_ReadPathParity` `portfolio_mark_test.go:130-172` is the 5-path parity template.
- `TestGetPnL_AC5_QuotesUnavailable` `portfolio_quote_deadline_test.go:268` covers the `GetPnL`
  UNAVAILABLE contract.
- Fixtures come from `internal/testdata/offline_pnl.go` (Step 20, second consumer).

**TDD**: `red-green required`

**Covers**: `AC-1, AC-3, AC-4, AC-6, AC-13, AC-25, AC-27, AC-28, AC-29, AC-34, AC-38, AC-39, AC-51, AC-52`

**Instructions**:
1. `AC-3`: account day 380.
2. `AC-34`: AAPL fully closed in session → no position. Assert account day 600 / 0.0375 on **both**
   `GetPortfolio(account_id)` and `ListPortfolios(account_id)` (the flat-account path in Steps 19/21).
3. `AC-38`: account day 400 / 0.0250.
3a. `AC-1` (account level): AAPL-only account, pc 160, quote 164 → account `day_pnl` 400, `day_pnl_pct` 0.0250.
4. `AC-51`: account `day_pnl_pct` 0.
5. `AC-4`: total 1300, pct 0.1238 (lifetime 600 = carried 400 + since 200).
6. `AC-6`: flat account (no positions), lifetime 250 → total 250, pct 0, on both `GetPortfolio` and
   `ListPortfolios`.
6a. `GetOfflineStates` error → the read still succeeds (WARN logged), offline positions are marked, and
   account Day P&L is 0 (non-fatal rule, Step 19).
7. `AC-25`: total 150, pct 0.0750.
8. `AC-13`: ZZZZ listed with qty 5 and `NONE`; total 100, equity 1600.
9. `AC-27` row 2: `ListPortfolios` with `quotesErr` → AAPL `LAST_CLOSE` 158 within 3000ms.
10. `AC-28`: `GetPnL` with an offline ZZZZ, no quote and a bar present returns `ErrQuotesUnavailable`, and
    `stub.barsCalls == 0`.
11. `TestBackgroundPathsMakeNoBarsCalls`: `broadcastSnapshot` and `checkRiskLimits` make 0 `BatchGetBars`
    calls.
12. `AC-29`: across the 6 reads (`GetPortfolio` with/without account, `GetPosition`, `ListPositions`,
    `ListPortfolios` single/all), positions show 163 / 300 / 1300 and accounts show day 300 / total 1300.
13. `AC-39`:
    - alp-1: 120 / 0.0120 / 500, no `total_pnl_pct`;
    - acc-1: 400 / 1400 / 0.0933;
    - aggregate: 520 / 0.0200 / 1900, no `total_pnl_pct`.
14. `AC-52` both rows: u-1 asks for u-2's acc-2 and for its own empty acc-9. The call succeeds, the
    optionals are nil, and equity/day/total are 0. The `GetOfflineStates` mock is asserted to bind
    `user_id = u-1`.
15. 231 regression: the existing `TestAC13_ReadPathParity` (source 0) stays green.

**Verification**:
```bash
cd services/xstockstrat-portfolio && GOWORK=off go test ./internal/service/... -race -count=1 && \
  GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && GOWORK=off go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:" && \
  GOWORK=off golangci-lint run --modules-download-mode=mod
```
The total must be ≥ 40%. The whole portfolio service suite must pass, including all feature 178/229/231
tests.

---

### Step 23 — config: bound `portfolio.marketdata.last_close_lookback_days`

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/grpc/configServiceImpl.ts` — modify
- `services/xstockstrat-config/src/__tests__/setConfigScalarBounds.test.ts` — modify

**Reviewers**: `xstockstrat-config` owner — config key naming (`<service>.<category>.<key>`), WatchConfig
stream stability; `xstockstrat-portfolio` owner — consuming service

**Codebase Evidence**:
- `SCALAR_BOUNDS_REGISTRY` `configServiceImpl.ts:100-144`: the feature-229 row
  `'portfolio.marketdata.quote_timeout_ms': { minValue: 500, maxValue: 8000 }` is at `:136`, and the 231
  rows are at `:140-143`.
- `lookupScalarBounds` `:149-151` tolerates both key-column forms (fails.md 2026-09-16
  readiness-materializer).
- `TIMEOUT_KEY_FORMS` in `setConfigScalarBounds.test.ts:257-278` uses one row per form, e.g. `{ ns:
  'portfolio', key: 'marketdata.quote_timeout_ms', … }` and `{ ns: 'portfolio', key:
  'portfolio.marketdata.quote_timeout_ms', … }` at `:268-269`.
- Seeding waiver precedent (unseeded, consumed-with-default): `docs/patterns/config-governance.md` feature
  229/231 entries.

**TDD**: `N/A (config — non-code-bearing registry entry; its bound test rows run in Verification)`

**Covers**: —

**Instructions**:
1. Add `'portfolio.marketdata.last_close_lookback_days': { minValue: 5, maxValue: 60 },` after the 231 rows,
   with a 1-line comment: feature 230, FR-5 last-close search window, default 21.
2. Add both name-form rows to `TIMEOUT_KEY_FORMS`:
   `{ ns: 'portfolio', key: 'marketdata.last_close_lookback_days', field: 'intVal', min: 5, max: 60 }` and the
   full-dotted form.
3. No seed migration (227 D2 waiver, recorded in Step 28).

**Verification**:
```bash
cd services/xstockstrat-config && pnpm run test:coverage && pnpm run lint
```
The coverage threshold (40%) must pass, and the 4 new `last_close_lookback_days` cases must pass.

---

### Step 24 — service: agent `fees` argument + new response fields

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/tools.py` — modify
- `services/xstockstrat-agent/app/client.py` — modify
- `docs/runbooks/mcp-tools.md` — modify
- `services/xstockstrat-agent/CLAUDE.md` — modify

**Reviewers**: `xstockstrat-agent` owner — MCP tool contract stability (name, parameters, return shape) and
`docs/runbooks/mcp-tools.md` parity; tool-count statements unchanged

**Codebase Evidence**:
- `manage_offline_account` `tools.py:2035-2132`:
  - flat params `:2035-2052` (no `fees`);
  - the docstring says "filled_at is an optional ISO-8601 time (defaults to now)" at `:2066-2067`;
  - `confirm_order` dispatch is at `:2097-2103`.
- `confirm_offline_order` `client.py:2245-2271`:
  - the docstring "filled_at defaults to now when omitted" is at `:2254`;
  - the `ConfirmOrderRequest(...)` build is at `:2259-2263`.
- `list_positions` `client.py:2351-2373` uses `MessageToDict(p, preserving_proto_field_name=True)` at
  `:2371`. The precedent for `always_print_fields_with_no_presence=True` is at `client.py:635-640`.
  `get_positions` (`tools.py:2239`) and `get_positions_by_account_id` (`:2260`) share it.
- `_order_to_dict` `client.py:2166-2168` is a `MessageToDict` pass-through, so `fees` appears automatically
  when set.
- `mcp-tools.md`:
  - `manage_offline_account` § `:1317`, param row `filled_at … (defaults to now)` `:1337`;
  - `get_positions` § `:1421`, with "Fields with zero/default values may be absent" at `:1432-1433`;
  - `get_positions_by_account_id` § `:1440`.
- `services/xstockstrat-agent/CLAUDE.md:83,86-87` are the tool rows (the tool count is unchanged; no new
  tool).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. `tools.py`:
   - add `fees: float | None = None` after `filled_at`, and pass it through in the `confirm_order` branch;
   - the docstring `confirm_order` text becomes:
     - "filled_at defaults to now on first confirm; otherwise keeps the previously recorded time (not
       shown while NEW). Pass filled_at when partial fills land on different sessions.";
     - "fees: cumulative total for the order (>= 0), kept when omitted.";
   - mention that `list_positions` returns `day_pnl`, `day_pnl_pct`, `unrealized_pnl_pct`, `mark_source`
     and `mark_as_of`;
   - in the `get_positions` (`tools.py:2243`) and `get_positions_by_account_id` (`:2266`) docstrings, replace
     "Fields with zero/default values may be absent (proto3 serialization convention)." with "All
     non-optional fields are present, including zeros; optional fields (e.g. `mark_as_of`) are omitted when
     unset." This keeps the docstrings in line with instruction 2 and `mcp-tools.md` (`@AC-6 @feature-197`
     docstring↔runbook parity).
2. `client.py`:
   - `confirm_offline_order(..., filled_at_iso=None, fees: float | None = None)`, setting `req.fees = fees`
     **only** when `fees is not None` (presence); docstring as above;
   - in `list_positions`, add `always_print_fields_with_no_presence=True` to the `MessageToDict` call. This
     knowingly changes `get_positions`/`get_positions_by_account_id` output too: zero-valued fields are now
     present (design §5, accepted).
3. `mcp-tools.md`:
   - add a `fees` param row (float, no, "Cumulative fees for the order (≥ 0); omitted keeps the recorded
     value; negative → `INVALID_ARGUMENT`");
   - reword `filled_at` to the new text;
   - add the response fields to `confirm_order`/`get_order`/`list_orders` (`fees`) and to `list_positions`
     plus both `get_positions*` sections;
   - replace "Fields with zero/default values may be absent" with "all non-optional fields are present,
     including zeros";
   - add `INVALID_ARGUMENT` (negative fees) and `FAILED_PRECONDITION` (non-latest snapshot `as_of` change)
     to Errors.
4. Agent `CLAUDE.md:83`: the row mentions confirm with fees. Do not change the tool count.

**Verification**: see Step 25.

---

### Step 25 — test: agent fees presence + position field parity

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_offline_client.py` — modify
- `services/xstockstrat-agent/tests/test_position_parity.py` — modify

**Reviewers**: `xstockstrat-agent` owner — MCP tool contract stability, `mcp-tools.md` parity

**Codebase Evidence**:
- `test_confirm_offline_order_forwards_user_and_returns_derived_status` `test_offline_client.py:31-70` is
  the stub/capture pattern. `test_list_positions_provenance_passthrough` is at `:281`.
- `test_position_parity.py:13-39` freezes the 23 `Position` fields in `_POSITION_FIELD_SET`, and
  `test_position_field_set_matches_proto_descriptor` is at `:42`.
- `tests/test_tools_endpoint.py:100-106` (`test_every_catalog_tool_has_a_runbook_section`,
  `test_every_tool_count_surface_states_the_catalog_size`) must stay green with the count unchanged
  (fails.md 1921: verify via the registered name-set).

**TDD**: `red-green required`

**Covers**: `AC-17, AC-33`

**Instructions**:
1. `test_confirm_offline_order_fees_presence`:
   - `fees=None` → the captured `req.HasField("fees")` is False;
   - `fees=0.0` → True with value 0.0;
   - `fees=1.25` → 1.25 (AC-17).
2. `test_get_order_and_list_orders_echo_fees`: a stub returns an `Order` with `fees=1.25`, and
   `_order_to_dict` output has `"fees": 1.25` (AC-17/AC-33).
3. `test_list_positions_prints_new_fields`:
   - a stub `Position` with `day_pnl=0`, `unrealized_pnl_pct=0`, `mark_source=MARK_SOURCE_QUOTE` and a set
     `mark_as_of`;
   - the dict contains all five keys, including zeros (AC-33, and AC-17's `get_positions_by_account_id`
     path).
4. `test_position_parity.py`: add `"mark_source"` and `"mark_as_of"` (25 fields); update the comment to "1–25".
5. C-13: stub protos are single-consumer per test (inline).

**Verification**:
```bash
cd services/xstockstrat-agent && uv run pytest --cov=app --cov-fail-under=40 && ruff check . && ruff format --check .
```

---

### Step 26 — service: UI — offline P&L on the four `/trader` surfaces

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/money.ts` — modify
- `services/xstockstrat-ui/src/lib/protoTime.ts` — modify
- `services/xstockstrat-ui/src/lib/portfolioTotals.ts` — create
- `services/xstockstrat-ui/src/components/trader/MarkBadge.tsx` — create
- `services/xstockstrat-ui/src/components/trader/PortfolioPanel.tsx` — modify
- `services/xstockstrat-ui/src/app/trader/portfolio/page.tsx` — modify
- `services/xstockstrat-ui/src/app/trader/positions/page.tsx` — modify
- `services/xstockstrat-ui/src/app/trader/positions/[symbol]/page.tsx` — modify
- `services/xstockstrat-ui/src/components/trader/ConfirmFillDialog.tsx` — modify

**Reviewers**: `xstockstrat-ui` owner — trading UI correctness, analytics display accuracy, Connect-RPC call
safety, C-17 tokens/state primitives

**Scope note (9 files):** kept as one step on purpose. The two new helpers (`portfolioTotals.ts`,
`MarkBadge.tsx`) and the two formatter edits have no consumer outside these four surfaces. Splitting them
into a separate step would leave unused exports with no test to drive them (C-08 pairing, C-18). The
paired Step 27 covers all nine files.

**Codebase Evidence**:
- `fmtSignedUsd` `money.ts:12-16` renders `+`/`''` + `fmtUsd(n)`, so a negative becomes `$-50.00`, contradicting its
  docstring (recon R11). `fmtPct` is at `:18-23` and `pnlClass` at `:25-28`.
- `protoTime.ts:16-19` is `timestampToDate`. `fmtShortDate` at `:23-25` is UTC-only, and there is no NY
  helper.
- `PortfolioPanel.tsx`:
  - `isOffline` `:27`, `showRealized` `:30`;
  - `!isOffline` hides Cash/BP/Day/Total `:51-68`; the inline Day format is `:63`;
  - the "Realized P&L" Stat is `:69-75`;
  - the combined view `:117-161` has per-account cards that hide offline Day P&L (`:144-150`), and no
    summed totals.
- Book `app/trader/portfolio/page.tsx`:
  - the combined `reduce` over `dayPnl`/`totalPnl` is at `:37-46`;
  - the offline card is gated by `!isOffline` at `:200-219` (Day/Total P&L Fields `:205-216`), and the
    Positions Field is at `:220-225`.
- Positions list `app/trader/positions/page.tsx`:
  - Price `:163-168`, Market Value `:183-189`, Today's P/L ($) `:190-198`, Today's P/L (%) `:199-207`;
  - Total P/L ($)/(%) `:208-229`; sheet `:624-634`.
- Detail `positions/[symbol]/page.tsx`: the header price and day `:793-798`, Unrealized % `:819-821`, the
  StatTile Day P&L at `:843-848` and `:893-898`.
- The badge pattern `HaltBadge.tsx:14-28` (`Badge variant="warning"` + Tooltip + `aria-label`, C-17). The
  `warning`/`info` variants are at `ui/badge.tsx:23-24`.
- `ConfirmFillDialog.tsx`: comment `:24` "blank → server defaults to now", label `:92` "Fill time (optional
  — defaults to now)".
- `Stat` `components/shared/Stat.tsx:2-17` takes a string `value`.
- Protobuf-es: an unset `optional` is `undefined` (recon); `markSource` is a numeric enum on the generated
  `Position`.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. `money.ts`: make `fmtSignedUsd` render `-$50.00` (sign before `$`) and `+$100.00`. The docstring stays
   true. Step 28 records the finding.
2. `protoTime.ts`: add `fmtNyDate(ts)` returning `YYYY-MM-DD` in `America/New_York`
   (`toLocaleDateString('en-CA', { timeZone: 'America/New_York' })`), or `undefined` for an unset ts.
3. `lib/portfolioTotals.ts`:
   - `sumPortfolioTotals(portfolios, isOffline: (accountId) => boolean)` returns `{equity, cash,
     buyingPower, dayPnl, totalPnl, realizedSince, realizedLifetime, feesSince, feesLifetime}`;
   - realized and fee sums cover offline accounts only;
   - replace the Book page's inline `reduce` (`:37-46`) with it (DRY).
4. `MarkBadge.tsx`: given a `Position`:
   - `LAST_CLOSE` → `Badge variant="warning"` labelled `Last close ${fmtNyDate(markAsOf)}`;
   - `NONE` → `variant="warning"` "No price";
   - otherwise `null`.
   Add Tooltip + `aria-label` per `HaltBadge` (C-17 tokens only, no new variant).
5. `PortfolioPanel` single view, when `isOffline`, shows:
   - "Day P&L" `${fmtSignedUsd(dayPnl)} (${fmtPct(dayPnlPct)})` and "Total P&L" `${fmtSignedUsd(totalPnl)}
     (${fmtPct(totalPnlPct)})`;
   - "Realized (since snapshot)" with net (`realizedPnl − feesSinceSnapshot`) and "Realized (lifetime)" with
     net (`realizedPnlLifetime − feesLifetime`);
   - "Fees (since snapshot)" and "Fees (lifetime)".
   Each optional row renders only when the field is not `undefined`. Cash and Buying Power stay hidden. The
   broker branch keeps its rows, now using `fmtSignedUsd`/`fmtPct`/`pnlClass` instead of the inline `:63`
   format.
6. `PortfolioPanel` combined view:
   - add a summary block from `sumPortfolioTotals` with "Day P&L" and "Total P&L" summed over all accounts;
   - when any offline account exists, add "Realized (since snapshot)" and "Realized (lifetime)" with the
     caption "Offline accounts only";
   - offline per-account cards now show Day P&L.
7. Book offline card: show "Day P&L" and "Total P&L" for offline cards too. Keep Cash and Buying power gated
   by `!isOffline`.
8. Positions list:
   - the Price cell renders `<MarkBadge>` next to the price;
   - for `markSource === NONE`, Market Value, Today's P/L and Total P/L cells render `—`;
   - the sheet gets the same treatment.
9. Detail page:
   - `<MarkBadge>` sits beside the header price `:793-795`;
   - the existing `fmtPct(position.unrealizedPnlPct)` now shows the signed short % from the backend. No
     change is needed beyond the `fmtSignedUsd` fix;
   - a `LAST_CLOSE` mark never feeds the live-price header beyond the displayed mark plus badge (`@AC-2/@AC-11
     @feature-095`): the badge labels it.
10. `ConfirmFillDialog`:
    - the comment `:24` and label `:92` read "defaults to now on first confirm; otherwise keeps the
      previously recorded time (not shown while NEW)";
    - no fees input (FR-6; PR note: fees come only from the agent).

**Verification**: see Step 27.

---

### Step 27 — test: UI unit + e2e for the offline P&L surfaces

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/money.test.ts` — create
- `services/xstockstrat-ui/src/lib/protoTime.test.ts` — modify
- `services/xstockstrat-ui/src/lib/portfolioTotals.test.ts` — create
- `services/xstockstrat-ui/e2e/fixtures/portfolios.ts` — modify
- `services/xstockstrat-ui/e2e/fixtures/positions.ts` — modify
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify
- `services/xstockstrat-ui/e2e/trader/offline-accounts.spec.ts` — modify
- `services/xstockstrat-ui/e2e/trader/offline-pnl.spec.ts` — create

**Reviewers**: `xstockstrat-ui` owner — trading UI correctness, analytics display accuracy

**Codebase Evidence**:
- vitest: node env, `include: ['src/**/*.test.ts']`, coverage scoped to `src/lib/**` with a 40% lines
  threshold (`vitest.config.*`). `src/lib/protoTime.test.ts` exists.
- Fixtures (C-12):
  - `PORTFOLIO_OFFLINE` `e2e/fixtures/portfolios.ts:41-50` (realizedPnl 97.5) is **not** in `PORTFOLIOS`
    `:53`;
  - `positions.ts` is Alpaca-only (`POSITION_AAPL`, `POSITION_MSFT`, `:14-54`);
  - the `INVENTORY.md` rows are `:16` (Portfolios) and `:39` (Positions).
- `offline-accounts.spec.ts` uses `page.route()` on BFF Connect paths:
  - it asserts `'Realized P&L'` at `:73`, `:98`, `:225`;
  - it asserts `Day P&L` has count 0 at `:230` and `:251`. These must flip.
- `mock-backend.ts` `listPortfolios` `:359-362` returns `PORTFOLIOS`, and `listPositions` `:363-367`
  returns `POSITIONS`.
- Auth helpers live in `e2e/helpers/auth.ts`.
- Per-spec stateful stubs are preferred over shared-mock mutation (insights 2026-10-14
  config-ui-usability).

**TDD**: `red-green required`

**Covers**: `AC-14, AC-15, AC-16, AC-20, AC-30, AC-31, AC-32` (UI half)

**Instructions**:
1. Unit tests:
   - `money.test.ts`: `fmtSignedUsd(-50)` = `-$50.00` (red today), `+$100.00`, `—` for undefined.
   - `protoTime.test.ts`: `fmtNyDate` of `2026-10-16T04:00:00Z` = `2026-10-16`; an EST stamp
     `2026-01-16T05:00:00Z` = `2026-01-16`.
   - `portfolioTotals.test.ts`: AC-30 sums. Offline (300/1300/600/900) plus alp-1 (120/500) gives day 420,
     total 1800, realized since 600 and lifetime 900 (offline only).
2. Fixtures:
   - add `PORTFOLIO_OFFLINE_FULL_PNL`: day 300, total 1300, totalPnlPct 0.1238, realizedPnl 600,
     feesSinceSnapshot 3, realizedPnlLifetime 900, feesLifetime 4.5;
   - add `POSITION_OFFLINE_AAPL` (dayPnl 300, markSource QUOTE), `POSITION_OFFLINE_XYZ` (LAST_CLOSE,
     markAsOf 2026-10-16T04:00:00Z), `POSITION_OFFLINE_ZZZZ` (qty 5, NONE) and `POSITION_OFFLINE_TSLA_SHORT`
     (qty −10, avg 200, current 180, dayPnl 50, unrealizedPnl 200, unrealizedPnlPct 0.10, LAST_CLOSE
     2026-10-16);
   - add the `INVENTORY.md` rows in this step;
   - do not change `PORTFOLIOS`/`POSITIONS` (shared defaults stay immutable).
3. `offline-accounts.spec.ts`:
   - relabel the `'Realized P&L'` assertions to `'Realized (since snapshot)'` (157 @AC-13 EXTEND);
   - flip `:230` and `:251` to expect `Day P&L` **visible** on the offline card (159 @AC-2/@AC-4 CHANGE,
     signed);
   - keep the `Cash`/`Buying Power` count-0 assertions.
4. `offline-pnl.spec.ts` (page.route per test):
   - `AC-14`: the single panel shows "Day P&L" +$300.00, "Total P&L" +$1,300.00 (+12.38%), "Realized (since
     snapshot)" 600.00 net 597.00, "Realized (lifetime)" 900.00 net 895.50, "Fees (since snapshot)" 3.00,
     "Fees (lifetime)" 4.50, and no Cash or Buying Power.
   - `AC-20`: realized 600 net 597.
   - `AC-15`: the Book offline card shows Day P&L and Total P&L beside Equity and the position count.
   - `AC-16`: the AAPL row shows Today's P/L +$300.00; the XYZ row shows "Last close 2026-10-16".
   - `AC-32`: the ZZZZ row shows qty 5 and "No price", with no MV, P&L or Today's P/L figure.
   - `AC-30`: the combined panel shows Day 420.00 and Total 1,800.00, and the realized rows carry "Offline
     accounts only".
   - `AC-31`: `/trader/positions/TSLA` shows Day P&L +$50.00, unrealized +$200.00 (+10.00%) and "Last close
     2026-10-16".
5. Run the C-12 grep in Verification.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run test:coverage && pnpm run lint && \
  pnpm exec playwright test e2e/trader/offline-accounts.spec.ts e2e/trader/offline-pnl.spec.ts e2e/trader/portfolio.spec.ts e2e/trader/positions.spec.ts e2e/trader/position-detail.spec.ts e2e/trader/valuation-parity.spec.ts && \
  grep -n "from '../fixtures'\|helpers/auth" e2e/trader/offline-pnl.spec.ts e2e/trader/offline-accounts.spec.ts && \
  grep -n "PORTFOLIO_OFFLINE_FULL_PNL\|POSITION_OFFLINE_" e2e/fixtures/INVENTORY.md
```
`pnpm run test:coverage` must pass the vitest coverage gate `thresholds.lines: 40` (`vitest.config.ts:29-30`,
scoped to `src/lib/**`), which now includes `money.ts`, `protoTime.ts` and the new `portfolioTotals.ts`.
`scripts/run-e2e.sh` / `Dockerfile.e2e` is the containerized fallback for Playwright.

---

### Step 28 — docs: CLAUDE.md invariants, config-key log, findings

**Status**: `pending`
**Service**: `docs/`, service `CLAUDE.md`s
**Files**:
- `services/xstockstrat-portfolio/CLAUDE.md` — modify
- `services/xstockstrat-trading/CLAUDE.md` — modify
- `services/xstockstrat-marketdata/CLAUDE.md` — modify
- `packages/proto/CLAUDE.md` — modify
- `docs/patterns/config-governance.md` — modify
- `services/xstockstrat-trading/docs/context-constitution-findings.md` — modify
- `services/xstockstrat-portfolio/docs/context-constitution-findings.md` — modify
- `services/xstockstrat-ui/docs/context-constitution-findings.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- Portfolio `CLAUDE.md`:
  - § Config Keys Consumed `:80-100` (the `quote_timeout_ms` row is at `:95`);
  - § Dependencies `:70-78` ("xstockstrat-marketdata | gRPC read | Current prices");
  - § Database `:112-120` (`offline_account_realized` row);
  - § Role `:27-33` (231 valuation paragraph).
- Trading `CLAUDE.md`: § Database `:123-131` (the `offline_position_baselines` row is at `:128`) and § Ledger
  Events Emitted `:136-157` (the `account.positions.synced` row is at `:151`).
- Marketdata `CLAUDE.md`: § Quote retention `:224` and § Config Keys `:48-108`.
- `packages/proto/CLAUDE.md:12-18` is the `pnl/` carve-out.
- `config-governance.md:105` § Per-Feature Registered Keys (newest first; the 231 entry is at the top).
- Root `CLAUDE.md` § Teardown: run the context-forge refresh scoped to these files before pushing.

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. Portfolio `CLAUDE.md`:
   - add the `portfolio.marketdata.last_close_lookback_days` row (int, 21, `[5,60]`, read live, ≤0 → 21,
     unseeded);
   - extend the marketdata dependency reason with "+ `BatchGetBars` (allow_partial) daily closes for offline
     marks/Day P&L";
   - extend the `offline_account_realized` row (migration 017 columns; lifetime = carried + since);
   - add a short "Offline valuation (feature 230)" paragraph:
     - `source ≠ 0` selects the shared valuation in the 4 reads, and `GetPnL`/snapshot/risk never use it;
     - D-1 mark rule;
     - fixed invariants: the NYSE calendar, `SessionDate` +6h, the 1-minute bars coalescing.
2. Trading `CLAUDE.md`:
   - add a `trading.offline_snapshot_headers` row (migration 011, frozen carry) and `orders.fees`;
   - extend the `account.positions.synced` row with the offline-only keys `fees_since_snapshot`,
     `realized_carried`, `fees_carried` and `recent_fills` (10-day window invariant);
   - add the ConfirmOrder fees / `filled_at` preserve / NEW-masking rule in one sentence.
3. Marketdata `CLAUDE.md`: `BatchGetBars allow_partial` (opt-in; strict path unchanged; `barsPartialMargin`
   250ms invariant).
4. `packages/proto/CLAUDE.md`: `pnl.QtyEpsilon` (1e-9), exported, not tuned.
5. `config-governance.md`: a new top entry "feature 230 — offline-account-full-pnl" with the key table row
   and the unseeded waiver.
6. Findings:
   - trading: the dead `TradingService.StreamOrderUpdates` (`trading.go:1585`), whose snapshot loop would
     send shared `s.orders` pointers unmasked;
   - portfolio: the unscoped `GetOfflineRealized` leak (fixed by Step 17);
   - UI: `fmtSignedUsd` sign placement (fixed by Step 26).
7. Run `/context-forge:context-constitution refresh` scoped to the touched files. If the plugin is
   unavailable, do the manual reconciliation and record it in the PR body (root `CLAUDE.md` § Teardown).

**Verification**:
```bash
grep -n "last_close_lookback_days" services/xstockstrat-portfolio/CLAUDE.md docs/patterns/config-governance.md && \
grep -n "offline_snapshot_headers\|recent_fills" services/xstockstrat-trading/CLAUDE.md && \
grep -n "allow_partial" services/xstockstrat-marketdata/CLAUDE.md && \
grep -n "QtyEpsilon" packages/proto/CLAUDE.md && \
grep -n "StreamOrderUpdates" services/xstockstrat-trading/docs/context-constitution-findings.md && \
grep -n "GetOfflineRealized" services/xstockstrat-portfolio/docs/context-constitution-findings.md && \
grep -n "fmtSignedUsd" services/xstockstrat-ui/docs/context-constitution-findings.md
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._

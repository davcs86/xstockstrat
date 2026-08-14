# Product Spec: strategy-user-ownership

**Created**: 2026-08-14

---

## Problem Statement

`analysis.strategies` has no owner (`strategy_id TEXT PRIMARY KEY` — `migrations/001_strategies.up.sql:1-8`,
no `user_id` column). Every strategy is a single, platform-wide shared row: any authenticated user
can register, edit, backtest, or enable-live any `strategy_id`, and the live evaluation loop
(`live_loop.py`) evaluates each live-enabled strategy exactly once, platform-wide, with no per-user
identity. This blocks `132-strategy-symbol-denylist`'s FR-3 (a strategy's symbol universe = its
watchlist/held/signal coverage) from being buildable at all: `ListPositions`/`ListWatchlists` are
single-user-scoped RPCs with no cross-user "list all" variant, so there is no way to compute "this
strategy's relevant watchlist/held symbols" without first deciding *whose* watchlist/held positions
count. The precedent for this exact gap already exists and was previously punted: `analysis.fundsignal.
universe_source`'s own doc comment (`services/xstockstrat-analysis/CLAUDE.md`'s Config Keys table)
states plainly — *"watchlists union pends a global portfolio RPC; falls back to explicit."*

## User Story

As a trader, I want the strategies I register to be mine — evaluated against my own watchlist/held
positions/signals, visible and editable only by me, and backtestable only by me — so that the
platform can resolve "this strategy's symbol universe" unambiguously, and so strategies stop being an
accidental shared, unowned resource.

## Functional Requirements

FR-1. Add `user_id` to `analysis.strategies` (migration `013`) and to `StrategyDefinition`
(`packages/proto/analysis/v1/analysis.proto:249-274`, next free field number `13`, since `132` claims
`12` for `denied_symbols` — coordinate field numbers between the two features at `/sdd-design`/
`/sdd-spec` time, see Open Questions). `user_id` is taken from the propagated `x-user-id` header on
write (`ManageStrategy` REGISTER), never accepted from the request body, mirroring
`docs/patterns/header-propagation.md`'s existing "ownership from header, not wire" convention (e.g.
`portfolio.proto`'s `CreateWatchlistRequest` comment: "user_id is intentionally absent... ownership
is taken from the propagated x-user-id header server-side").

FR-2. `strategy_id` becomes unique **per owner**, not platform-wide: the table's primary key changes
from `(strategy_id)` to `(user_id, strategy_id)` (migration `013`). Every other table and proto
message that references a bare `strategy_id` today must gain a companion `user_id` to stay
unambiguous:
- `analysis.strategy_cooldowns` (`migrations/009`, PK `(strategy_id, symbol)`) → `(user_id,
  strategy_id, symbol)`.
- `analysis.backtest_runs`/`analysis.opportunities`/`analysis.opportunity_actions` — audit each at
  `/sdd-design` time for a bare `strategy_id` column needing a `user_id` companion.
- `portfolio.WatchlistBinding.strategy_id` (`portfolio.proto:176`) — a binding lives inside a
  per-user `Watchlist` message already, so the owning user is contextually implied; `/sdd-design`
  must confirm binding resolution always validates `(watchlist.user_id, strategy_id)` against the
  strategy table's new composite key, not a bare `strategy_id` lookup.
- `trading.Order.strategy_id` (`trading.proto` — confirmed exactly 3 occurrences: `Order.strategy_id`
  line 47, `PlaceOrderRequest.strategy_id` line 91, `ListOrdersRequest.strategy_id` line 129 as a
  filter field) — orders are already user-scoped; `/sdd-design` must confirm order-to-strategy
  resolution validates ownership (`order.user_id == strategy.user_id`), not just a bare string match.
- Live-loop's in-memory `_last_state`/`_last_exit_at` dict keys (`live_loop.py:134`, currently
  `tuple[str, str]` = `(strategy_id, symbol)`) → `(user_id, strategy_id, symbol)`.

FR-3. Every RPC that reads or writes a specific strategy — `ManageStrategy` (UPDATE/DEACTIVATE/
REACTIVATE), `GetStrategy`, `RunBacktest`, `ScoreStrategy`, `SetStrategyLive`, `GetStrategyReport`,
`GetStrategyAnalytics`, `ListBacktests` — resolves the target strategy via `(x-user-id header,
strategy_id)` and rejects with `PERMISSION_DENIED` (not a silent 404/empty-result) if the caller does
not own it. `ListStrategies` returns only the caller's own strategies (a platform-wide "browse other
users' strategies" surface is explicitly out of scope — see Out of Scope). Backtesting is included in
this gate per explicit user decision — this is a stricter model than typical "read-shared,
write-owned" access patterns, so `/sdd-design` must confirm every one of these RPCs' current access
behavior before changing it (no silent gap-filling — C-01).

FR-4. `live_loop.py`'s evaluation model changes from "iterate all live-enabled strategies, no
identity" to "iterate all live-enabled strategies, each already carrying its own `user_id` via
FR-1" — this closes `132`'s cross-user-aggregation gap **without** a new cross-user RPC: for each
strategy, the loop resolves symbol universe = that strategy's *own owner's*
`union(watchlist, held, active-signal)` (`132`'s FR-3), calling `ListPositions(user_id=<owner>)`/
`ListWatchlists` scoped to that owner. **Critical mechanism gap, not resolved here** (see Open
Questions): `ListWatchlists` is scoped by the propagated `x-user-id` **header**, and `live_loop` is a
background asyncio task with no inbound gRPC request to propagate a header from — `/sdd-design` must
determine how a background loop authenticates a portfolio read *on behalf of* a stored owner id
(service-identity/admin-scoped call with an explicit `user_id` parameter, vs. some other mechanism).
`ListPositions` already takes `user_id` as a request field (not header-only), so it may not have the
same gap — confirm per-RPC, don't assume both work the same way.

FR-5. Migration: every existing strategy row has no owner today. Per explicit user decision, all
pre-existing strategies are assigned to **one specific seed/admin user** at migration time. **The
concrete `user_id` value must be supplied by the operator before `/sdd-spec`/`/sdd-execute`** — this
spec does not invent one (Constitution F-04). Record the actual value in `context.md` once provided,
not in this file (avoids the value going stale if it's environment-specific — dev vs. prod may need
different seed users). **Governance for this ownership sentinel (C-10(c))**: the seed user is a real,
existing account (not a reserved/synthetic id like `author="system"`) — `/sdd-design` must confirm
whether it needs any special protection once assigned (e.g. can that account's own
`SetStrategyLive`/`DEACTIVATE` calls on a migrated strategy still fire alerts/backtests normally, or
does bulk pre-existing ownership warrant a distinct code path — for instance to avoid one account's
credential rotation or deactivation silently orphaning every legacy strategy). Not resolved here;
flagged so it isn't silently assumed to need no special handling.

FR-6. `132-strategy-symbol-denylist`'s `denied_symbols` field composes with this feature's ownership
model without conflict — a denied symbol is still evaluated relative to *the owning user's* universe,
minus the deny list. Coordinate proto field numbers between the two features (132 claims field `12`
on `StrategyDefinition` for `denied_symbols`; this feature needs field `13` for `user_id` — confirm
no collision at `/sdd-spec` time for whichever feature lands second).

## Out of Scope

- A "browse/fork other users' strategies" marketplace surface — `ListStrategies` returns only the
  caller's own rows; no cross-user strategy discovery UI.
- Strategy sharing/collaboration (multiple users co-owning one strategy) — single-owner only in V1.
- Retroactively re-attributing historical `backtest_runs`/`opportunities` rows created before this
  feature to the seed user's ownership beyond what FR-5's migration mechanically does — no analytics
  backfill beyond the raw column population.
- Changing `xstockstrat-agent`'s admin-scoped background calls (e.g. the fundamentals signal
  producer's `ManageSignalSource` registration) — those aren't strategy-ownership operations.

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-analysis` — `StrategyDefinition`/`ManageStrategy`/every strategy-scoped RPC (FR-1–4),
  `live_loop.py`'s per-owner evaluation (FR-4), 3+ migrations (FR-2)
- `xstockstrat-trading` — `Order.strategy_id` ownership resolution (FR-2)
- `xstockstrat-portfolio` — `WatchlistBinding.strategy_id` ownership resolution (FR-2)
- `xstockstrat-agent` — `manage_strategy`/`run_backtest`/`set_strategy_live`/`get_strategy`/
  `list_strategies` MCP tools, all now ownership-gated (FR-3); `strat-lab` plugin skill update
  required in the same PR (root CLAUDE.md's same-PR rule)
- `xstockstrat-ui` — strategy list/detail/edit pages must reflect per-user scoping (no other user's
  strategies visible)
- `packages/proto` — `analysis.proto`, `portfolio.proto`, `trading.proto` field additions

## Consumer Surface(s)

- [x] **UI** — `xstockstrat-ui` `/insights` segment: strategy list/detail/edit pages now show only
  the caller's own strategies (a behavior change, not a new page).
- [x] **Agent** — `xstockstrat-agent` MCP tools `manage_strategy`, `run_backtest`, `set_strategy_live`,
  `get_strategy`, `list_strategies` all become ownership-scoped/gated.
- [ ] **None**

## Proto Contract Changes

- [x] New field: `string user_id = 13;` on `analysis.StrategyDefinition` (additive at the proto
  level, but **behaviorally breaking** — existing callers that assumed global strategy visibility
  lose access to strategies they don't own). Per the breaking-change approval gate: **2 service
  owners + platform lead** required, not the 1-owner non-breaking gate — this is a behavior-breaking
  change even though the wire format is additive.
- [ ] Companion `user_id` fields/messages on `portfolio.WatchlistBinding` resolution and
  `trading.Order` strategy references — exact shape (new field vs. resolved server-side from
  existing per-user context) is a `/sdd-design` decision.

## Config Key Changes

- [ ] No new config keys anticipated at story time.

## Database Changes

- [x] Migration `013` (analysis): add `user_id` to `analysis.strategies`, change PK from
  `(strategy_id)` to `(user_id, strategy_id)`, backfill existing rows per FR-5's seed user.
- [x] Migration `014` (analysis): add `user_id` to `analysis.strategy_cooldowns`, change PK from
  `(strategy_id, symbol)` to `(user_id, strategy_id, symbol)`. Sequenced directly after `013` since
  both are this feature's own migrations and must apply together (the cooldown table's rows are only
  meaningful once `013`'s ownership backfill has run) — exact SQL is `/sdd-spec` work, not this spec's.
- [ ] Migration `015`+ (analysis, count TBD at `/sdd-design`): audit `backtest_runs`/`opportunities`/
  `opportunity_actions`/`fundsignal_emitted` for bare `strategy_id` columns needing a `user_id`
  companion — each such column gets its own migration starting at `015`, sequenced after `014`;
  `/sdd-design` determines the exact count once the audit is complete.

## Feature Workflow Notes

Branch to create: `feature/strategy-user-ownership` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [ ] 1 service owner approval (non-breaking proto or config change) — not applicable, this is
  behaviorally breaking
- [x] 2 service owners + platform lead (breaking proto change) — required (FR-2/FR-3's
  access-behavior change, even though the wire additions are additive)
- [x] DBA review + service owner (schema migration) — required (2+ migrations, PK changes)

## Acceptance Criteria

1. Two different users can each register a strategy with `strategy_id="sma_crossover"` without
   collision — composite `(user_id, strategy_id)` uniqueness enforced at the DB level.
2. User A calling `GetStrategy`/`RunBacktest`/`SetStrategyLive` against a `strategy_id` owned by user
   B receives `PERMISSION_DENIED`, not stale/leaked data and not a silent empty result.
3. `ListStrategies` for user A never includes a strategy owned by user B.
4. A live-enabled strategy owned by user A evaluates against user A's own
   `union(watchlist, held, active-signal)` symbols (per 132's FR-3), not a platform-wide or
   different-user's universe — verified by a test with two users holding different, non-overlapping
   symbol sets, confirming each user's strategy only alerts on their own coverage.
5. Every pre-existing strategy row is owned by the FR-5 seed user after migration; no row is left
   with a null/missing owner.
6. `manage_strategy`/`run_backtest`/`set_strategy_live` (agent tools) correctly surface
   `PERMISSION_DENIED` as a tool-level error (not a silent no-op or a generic failure) when the
   authenticated agent session's user doesn't own the target strategy.

## Open Questions

- [ ] **CRITICAL — background-loop identity mechanism, must resolve in `/sdd-design` Phase 0
  Recon.** `live_loop.py` and `fundsignal_loop.py` are asyncio background tasks with no inbound gRPC
  request — `x-user-id` propagation (`docs/patterns/header-propagation.md`) assumes an inbound
  request to propagate *from*. FR-4 requires the live loop to read a *specific owner's*
  positions/watchlists on every cycle. Candidate mechanisms (none chosen): (a) `ListPositions`
  already takes `user_id` as an explicit request field (not header-derived) — may just work
  as-is; (b) `ListWatchlists` is header-scoped only — may need a new admin-scoped variant accepting
  an explicit `user_id`, or a documented exception to the header-propagation convention for
  service-to-service background-loop calls with a legitimate impersonation need. `/sdd-design` must
  read `portfolio`'s actual `ListWatchlists` handler implementation, not just the proto comment,
  before proposing a mechanism.
- [ ] **`132`'s field-number coordination.** `132-strategy-symbol-denylist` claims
  `StrategyDefinition` field `12` (`denied_symbols`); this feature claims field `13` (`user_id`).
  Whichever feature's `/sdd-spec` runs first must re-verify the other hasn't already claimed a
  number, and `merge-order.md` must record the landing order between `132` and `133` explicitly
  (this feature is a hard prerequisite for `132`'s FR-3, per FR-4 above — but 132's FR-1/FR-2/FR-4/
  FR-5/FR-7, the deny-list mechanics themselves, don't strictly need ownership to exist first; only
  the *cross-user-aggregation* piece does — `/sdd-design` should confirm whether 132 can partially
  land before 133, or must wait fully).
- [ ] **Seed user identity (FR-5)** — the concrete `user_id` is a required operator-supplied input,
  not invented by this spec. Must be resolved before `/sdd-execute` runs the migration step.
- [ ] **`trading.Order.strategy_id`'s exact 3 message occurrences** — this spec cites the field
  count from a grep pattern match, not a read of each message; `/sdd-design` must identify each by
  name and confirm which need a `user_id` companion vs. which already have adequate context (e.g. an
  `Order` already carries its own `user_id` elsewhere in the message).
- **Known trap** (`fails.md` 2026-08-05, `023-position-sizing-engine`) — not directly implicated
  (this feature doesn't touch `conviction`/`signal_axis`), but carry the same "verify every claim
  against real code" discipline into `/sdd-design`'s access-control audit (FR-3) — an incorrect
  assumption about which RPCs already enforce ownership vs. which don't would be a real security gap,
  not a cosmetic one.

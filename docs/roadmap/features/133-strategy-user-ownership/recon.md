# Recon: strategy-user-ownership

**Created**: 2026-08-14
**From**: product-spec.md
**Affected services**: xstockstrat-analysis, xstockstrat-trading, xstockstrat-portfolio, xstockstrat-agent, xstockstrat-ui, packages/proto

---

## Objective

Make `analysis.StrategyDefinition` user-owned: `strategy_id` unique per `(user_id, strategy_id)`
rather than platform-wide; every strategy-scoped RPC (including `RunBacktest`) rejects a non-owner
with `PERMISSION_DENIED`; and `live_loop.py` resolves each live strategy's symbol universe against
its own stored owner — closing `132-strategy-symbol-denylist`'s cross-user-aggregation gap without a
new cross-user RPC.

## Codebase Map

- **`xstockstrat-analysis`** (Python)
  - Entry point: `app/main.py` (wires `LiveEvaluationLoop`/`FundamentalsSignalLoop`/servicer at boot)
  - Handler/servicer: `app/handlers/servicer.py` — `RunBacktest:284`, `ScoreStrategy:1231`,
    `ListStrategies:1532`, `GetStrategyReport:1536`, `ListBacktests:1550`, `ManageStrategy:1595`
    (REGISTER `:1607`, UPDATE `:1633`, DEACTIVATE `:1735`, REACTIVATE `:1744`), `GetStrategy:1766`,
    `SetStrategyLive:1803`, `GetStrategyAnalytics:2412`
  - Repositories: `app/repositories/strategies.py` (`StrategiesRepository`, `SELECT * FROM
    analysis.strategies WHERE strategy_id = $1`, no `user_id` anywhere); `app/repositories/
    opportunities.py` (already `user_id`-scoped — the one reuse-ready repo pattern)
  - Live loop: `app/engine/live_loop.py` — `strategy_symbols():37-47`, `_run_cycle`'s SELECT
    `:188-190`, `_last_state`/`_last_exit_at`/`_last_entry_at` dict keys `:134,140,145`
  - Fundsignal loop: `app/engine/fundsignal_loop.py` — `_resolve_universe():203-218`,
    `_ensure_source_registered():338-346` (admin-bit self-injection precedent)
  - Last migration: `012_strategy_cooldowns_last_entry_at.up.sql` (`services/xstockstrat-analysis/
    migrations/`) — next free number **013**
  - Config-read pattern: `self._cfg.get_str/get_int(...)` throughout servicer/loops (see CLAUDE.md
    Config Keys table)
  - `x-user-id` extraction: **no shared helper** — every call site inlines
    `dict(context.invocation_metadata()).get("x-user-id", "")` or a list-comprehension filter
    (11+ occurrences, e.g. `servicer.py:1923,2009,2329-2330,2426`)
  - `_has_admin_scope` (role-only gate, not identity/ownership): `servicer.py:188-202`

- **`xstockstrat-trading`** (Go)
  - Entry point: `cmd/server/main.go:1-60`
  - Handler/servicer: `internal/service/trading.go` — `PlaceOrder:323`, `submitOrder:470`,
    `resolveAccount:269`, `ListOrders:~1008`
  - Repository: `internal/repository/trading_repo.go` — `strategy_id` equality filter `:149`
  - Last migration: `007_broker_accounts_halt_source.up.sql` — `trading.orders.strategy_id` is a
    plain nullable `TEXT`, no FK (`migrations/001_orders_hypertable.up.sql:22,44`)
  - Config-read pattern: standard `WatchConfig` subscription in `cmd/server/main.go`

- **`xstockstrat-portfolio`** (Go)
  - Entry point: `cmd/server/main.go:1-24` (interceptor wired at `:81`)
  - Handler/servicer: `internal/handler/portfolio_handler.go` (`ListPositions:57`,
    `ListWatchlists:149`) → `internal/service/portfolio_service.go` (`ListPositions:481`,
    `ListWatchlists:1258`, `requireUserID:1184-1191`)
  - Header interceptor: `internal/middleware/propagation.go:25-35` (extracts `x-user-id` from
    incoming metadata), `internal/middleware/propagation.go:19-23` (`FromContext`)
  - Last migration: `009_bracket_order_ids.up.sql` — `portfolio.watchlist_symbols.strategy_id`
    already exists (`migrations/008_watchlist_symbol_strategy.up.sql:7-8`); `portfolio.watchlists`
    itself has `user_id TEXT NOT NULL` + `UNIQUE (user_id, name)` (`migrations/007_watchlists.up.sql:6-14`)

- **`xstockstrat-agent`** (Python MCP)
  - Entry point: `app/main.py` — `_authorized:146-175` (OAuth JWT → claims → ASGI scope)
  - Tool registrations: `app/tools.py` — `run_backtest:378`, `manage_strategy:486`,
    `set_strategy_live:797`, `list_strategies:934`, `get_strategy:945`
  - Backend client: `app/client.py` — `_metadata():29-30` (unconditionally `[]`),
    `run_backtest:227`, `manage_strategy:396`, `get_strategy:458`, `list_strategy_definitions:483`,
    `set_strategy_live:849`
  - Identity resolution: `app/auth.py:50` (`validate_bearer_claims`), `app/tools.py:59,77,95,107-122`
    (`_claims_from_context`/`_require_claims`/`_caller_access_scope`/`_caller_user_id`)
  - Error mapping: `app/tools.py:125-136` (`_grpc_error_message`) — applied manually per call site
  - Config-read pattern: n/a (stateless MCP layer)

- **`xstockstrat-ui`** (Next.js)
  - Strategy pages: `src/app/insights/strategies/page.tsx` (list), `[id]/page.tsx` (detail),
    `[id]/edit/page.tsx` (edit)
  - BFF: `src/lib/insightsBff.ts` — `listStrategies:28-34`, `getStrategy:55`,
    `listStrategyDefinitions:56-58` (reference pattern: `listWatchlists:97-103`)
  - Header injection: `src/lib/bffShared.ts` — `backendHeaders:41-47`, `forward:63-72`
  - `src/middleware.ts` — route protection + `x-trace-id` only; does **not** inject `x-user-id`
    itself (confirmed by full read, `:49-54`)
  - Hooks: `src/hooks/useStrategies.ts:17`, `src/hooks/useStrategyDefinitions.ts:20`

## Patterns to REUSE

- **Ownership-from-header, not wire** → reuse the Watchlist/Opportunities convention verbatim:
  `packages/proto/portfolio/v1/portfolio.proto:18-19,193-194` ("ownership is taken from the
  propagated x-user-id header server-side, never from request fields") and
  `packages/proto/analysis/v1/analysis.proto:494-495,521-522` (`ListOpportunitiesRequest`/
  `SetOpportunityActionRequest`, feature 097). FR-1 already commits to this; the design must extend
  it into `StrategyDefinition`/`ManageStrategy` consistently.
- **BFF-side header injection already automatic** → `src/lib/bffShared.ts`'s `backendHeaders()` +
  `forward()` (`:41-47,63-72`) already attach `x-user-id` on every forwarded call from
  `requireSession`'s verified claims — `getStrategy`/`listStrategyDefinitions` need **zero** UI/BFF
  code change once the backend enforces ownership (they already use plain `forward()`).
- **`analysis.opportunities`'s existing `(user_id, ...)` composite-PK shape** →
  `migrations/011_opportunities.up.sql` (`PRIMARY KEY(user_id, opportunity_key)`) is the one
  strategy-adjacent table in this service already correctly per-user-scoped — model the new
  `analysis.strategies` composite PK on this precedent, and reuse `app/repositories/opportunities.py`'s
  repository shape for the new `StrategiesRepository` methods.
- **Background-loop synthetic outbound metadata** → `app/engine/fundsignal_loop.py:338-346`
  (`_ensure_source_registered`) already injects `("x-access-scope", "4")` into its own outbound
  metadata when none is propagated — the same mechanical technique (construct outbound
  `metadata=[("x-user-id", owner_id), ...]` on a per-call basis) is the direct precedent for
  `live_loop.py` resolving a strategy owner's portfolio data. **Caveat**: this exact precedent is
  itself flagged as an **open, unresolved security finding**
  (`services/xstockstrat-analysis/docs/context-constitution-findings.md:15` — "Is a background loop
  self-granting the admin bit the intended trust model?"). The design must treat user-identity
  impersonation as at least as sensitive as the admin-bit case already flagged, not less.
- **gRPC error → tool error mapping** → reuse `app/tools.py:125-136`'s `_grpc_error_message`
  (already maps `PERMISSION_DENIED`/`NOT_FOUND`/`UNAUTHENTICATED`/`INVALID_ARGUMENT`) for the new
  ownership-denial path in all 5 agent tools — no new mapping needed, just apply it where missing.
- **`manage_formula`'s caller-identity-to-body-field pattern** (`app/tools.py:677-681`,
  `_caller_user_id(ctx, "manage_formula")`) exists but is the **wrong** shape to copy for this
  feature — it threads identity as a request body field, which FR-1 explicitly rejects in favor of
  header-derived ownership. Do not reuse this one; note it only to avoid it.

## Dependencies

- **Proto/RPC**: `analysis.proto` `StrategyDefinition` next free field = **12**
  (`132` claims it for `denied_symbols`; confirm at `/sdd-spec` time whichever feature lands second
  — this feature's own product-spec already claims **13** for `user_id`, consistent).
  `ManageStrategyRequest.update_mask` allowed-paths comment: `analysis.proto:298-300`.
  `ListStrategiesRequest.user_id` (field 2, `analysis.proto:221-224`) **already exists but is dead
  code** — `ListStrategies` handler never reads it (`servicer.py:1532-1533`); the UI's `listStrategies`
  BFF handler already populates it (`insightsBff.ts:28-34`, `userId: claims.user_id`), creating a
  live inconsistency the design must resolve explicitly (repurpose this field as the enforced filter
  — a wire-supplied field, contradicting FR-1's header-only stance — vs. ignore/remove it and rely
  purely on the header, requiring a small BFF cleanup to stop sending it).
  `trading.proto`'s `Order`/`PlaceOrderRequest`/`ListOrdersRequest` **already carry `user_id`**
  alongside `strategy_id`: `Order.strategy_id`=15/`Order.user_id`=16 (`trading.proto:32-55`),
  `PlaceOrderRequest.strategy_id`=8/`.user_id`=9 (`:83-111`), `ListOrdersRequest.strategy_id`=2/
  `.user_id`=1 (`:127-141`) — **no new trading proto field needed**, FR-2's trading companion
  requirement is satisfied by existing fields; only a validation check
  (`order.user_id == strategy.user_id`) needs adding.
  `portfolio.proto`'s `ListPositionsRequest.user_id` (field 1, `:132-133`) is an explicit request
  field — trivially callable on behalf of a stored owner. `ListWatchlistsRequest` (`:213-215`) has
  **no `user_id` field at all** — purely header-derived via `requireUserID(ctx)` →
  `middleware.FromContext(ctx).UserID` → the Go interceptor's `x-user-id` metadata read
  (`portfolio_service.go:1184-1191`, `middleware/propagation.go:25-35`).
- **Migration**: next number `013` for `services/xstockstrat-analysis/migrations/`.
  `analysis.strategies` (migration `001`): `strategy_id TEXT PRIMARY KEY`, no `user_id` — needs the
  PK change. `analysis.strategy_cooldowns` (migration `009`): PK `(strategy_id, symbol)`, no
  `user_id` — needs the PK change (migration `014` per product-spec). `analysis.backtest_runs`
  (migration `006`): PK is `backtest_id` (**not** `strategy_id`) with `strategy_id TEXT NOT NULL` as
  an ordinary column — simpler than a PK change, just needs a `user_id` column added (no composite-PK
  migration risk). `analysis.opportunities` (migration `011`) **already has both `user_id` and
  `strategy_id`** — no migration needed, already correct. `analysis.opportunity_actions` (migration
  `010`) has `user_id` but **no `strategy_id` column at all** — remove this table from FR-2's audit
  list, there is nothing to companion. `analysis.fundsignal_emitted` (migration `004`) has **neither
  `user_id` nor `strategy_id`** — strategy-unrelated, remove from FR-2's audit list entirely (the
  product-spec named it speculatively; recon confirms it doesn't apply).
- **Config keys**: none anticipated; confirmed no existing config key governs strategy ownership.
- **Inter-service edges**: `analysis → portfolio` (`ListPositions`/`ListWatchlists`, existing edge,
  `PORTFOLIO_ENDPOINT`) needs a new **per-owner outbound call shape** from `live_loop.py` (currently
  this loop propagates **zero** outbound metadata on any call — confirmed no `metadata=` argument on
  its `GetBars` call, `live_loop.py:220-227` — so whatever mechanism is chosen is wholly new code for
  this loop, not a tweak of an existing propagation path). `trading → analysis`: **does not exist**
  today (confirmed via repo-wide grep — no `GetStrategy`/`AnalysisClient` reference anywhere in
  `xstockstrat-trading`) — if the design wants `PlaceOrder` to validate `strategy_id` ownership
  server-side, this is a **new inter-service edge**, not a change to an existing one; the simpler
  alternative (validate ownership only where the order originates — the agent/UI, or trading trusts
  the caller) must be weighed against adding this edge.
- **New env vars / ports**: none anticipated for backend services. Agent: none — `_metadata()`
  changing shape is a code change, not a new env var.

## Risks / Not-found

- **CRITICAL — agent sends no caller identity today.** `app/client.py:29-30`'s `_metadata()` is
  unconditionally `[]`. Even after `xstockstrat-analysis` starts enforcing `x-user-id`-based
  ownership, **all 5 agent tools would break** (or silently resolve to an empty/rejected identity)
  unless the agent is also changed to forward real `x-user-id` metadata, sourced from
  `_caller_user_id(ctx, ...)` (already exists, used today only for the `manage_formula` body-field
  case). This is a load-bearing prerequisite the product-spec's FR-3 implies but does not name
  explicitly as an agent-side code change.
- **`get_strategy` and `list_strategies` tools have no `ctx: Context` parameter today**
  (`app/tools.py:934,945`) — no access to caller claims at all. Adding ownership-awareness requires a
  signature change before anything else, for these two specifically (the other three already accept
  `ctx`).
- **`run_backtest` has zero exception handling around its gRPC call**
  (`app/tools.py:378-422`, confirmed no `except grpc.aio.AioRpcError`) — a future `PERMISSION_DENIED`
  would propagate unwrapped, failing AC-6 ("correctly surface PERMISSION_DENIED as a tool-level
  error") unless a try/except + `_grpc_error_message` call is added.
- **Background-loop identity impersonation is unprecedented for `x-user-id` specifically** (only the
  admin-bit case exists, and it's itself an open/unresolved finding — see Patterns to REUSE). The
  design must decide: synthetic outbound `x-user-id` header (reuses existing portfolio-side code,
  zero portfolio changes, but extends an already-questioned trust pattern) vs. a new explicit-`user_id`
  admin-scoped RPC variant on `portfolio.ListWatchlists` (new proto surface, new portfolio-side
  authz code, but doesn't stretch the header-impersonation pattern further). Neither is free;
  `/sdd-design` Phase 1 must weigh both against the `context-constitution-findings.md:15` open
  question rather than silently picking one.
- **`ListStrategiesRequest.user_id`'s dead/inconsistent state** (see Dependencies) — a genuine design
  fork the debate must resolve, not just note.
- **`trading.orders.strategy_id` has no FK, and `PlaceOrder` does zero cross-service validation
  today** — adding real ownership enforcement here means either (a) a new `analysis`-dependency edge
  from `trading` (cost: new coupling, new failure mode on order placement if analysis is down), or
  (b) accepting that `trading` stores `strategy_id` as attribution-only and ownership is enforced
  only at the RPCs that read/act on the strategy itself (`analysis`'s own RPCs), never at order-place
  time. `/sdd-design` must pick one explicitly — FR-2's product-spec text ("confirm order-to-strategy
  resolution validates ownership") does not yet commit to which.
- **No second test-user e2e fixture exists anywhere** (`xstockstrat-ui`) — `e2e/fixtures/users.ts`
  has only `TEST_USER_ID`/`TEST_USER_EMAIL`, and `signTestJwt` hardcodes that single user
  (`e2e/helpers/auth.ts:27-38`). AC-2/AC-3/AC-4's cross-user isolation tests need a second identity;
  this is new test infrastructure, not just new test cases — a `xstockstrat-ui` fixtures step should
  budget for it explicitly.
- **`fails.md` 2026-08-05 (`add-ikbr-account-support`)**: a placeholder ownership value
  (`user_id="default"`) failed invisibly in production. Directly bears on FR-5's seed-user migration
  — no code path may fall back to a synthetic/default user_id string if the operator-supplied seed
  value is ever missing at execute time; that must be a hard failure, not a silent default.
- **`insights.md` 2026-08-03 (`097-opportunity-universe-unification`)**: "a background materializer is
  only justified when it can enumerate the full consumer set independently of reads; otherwise
  lazy-on-read + TTL revalidate is the minimal shape." `live_loop.py` is exactly this kind of
  background materializer (it already enumerates the full "live-enabled strategies" set
  independently, so it clears this bar) — but the same insight should prompt the adversary to ask
  whether the *chosen* per-owner-fetch mechanism (loop reaching out per strategy, per cycle) risks the
  same N-way-fanout cost concern already open for `132` (`max_strategies_per_cycle` truncation).
- **Not found**: any FK/CHECK constraint anywhere linking `trading.orders.strategy_id` or
  `portfolio.watchlist_symbols.strategy_id` back to `analysis.strategies` — ownership enforcement
  today (and after this feature, unless explicitly added) is purely application-level, never DB-level
  cross-service.
- **Not found**: any existing IDOR-style e2e test (two distinct signed-in users, cross-user access
  assertion) anywhere in `xstockstrat-ui`'s suite.

## Recommended Scope

Advisory only — `/sdd-spec` decides the real step boundaries:

1. **`analysis` schema + proto**: migration `013` (strategies PK), `014` (strategy_cooldowns PK),
   `015` (backtest_runs `user_id` column, simple add — not a PK change); `StrategyDefinition.user_id`
   field `13`; resolve the `ListStrategiesRequest.user_id` dead-field question.
2. **`analysis` ownership gating**: add a shared `_caller_user_id`-style helper (mirroring
   `app/tools.py:107-122`'s agent-side helper, but for gRPC context) and apply ownership checks to
   the 8 RPCs named in FR-3, replacing/augmenting `_has_admin_scope`'s role-only gate on
   `ManageStrategy`/`SetStrategyLive`.
3. **`analysis` live-loop mechanism**: whichever of the two Risks-section candidates
   `/sdd-design` Phase 1 selects, implemented in `live_loop.py`'s per-strategy iteration.
4. **`trading`**: a validation check using the already-existing `user_id` fields (no new proto field)
   — scope (order-place-time vs. read-time-only) per the Risks section's open fork.
5. **`portfolio`**: only if the design chooses the new-RPC-variant mechanism over header
   impersonation for `ListWatchlists`.
6. **`agent`**: fix `_metadata()` to forward real `x-user-id`; add `ctx: Context` to `get_strategy`/
   `list_strategies`; add exception handling to `run_backtest`; update `strat-lab`'s `backtest` skill
   in the same PR (root CLAUDE.md rule).
7. **`ui`**: likely near-zero code change for `getStrategy`/`listStrategyDefinitions` (already use
   plain `forward()`); reconcile `listStrategies`'s existing `userId` body-field injection per the
   Dependencies-section fork; add a second test-user e2e fixture + cross-user isolation test.
8. **Migration `013`'s seed-user backfill**: blocked on the operator supplying the concrete `user_id`
   (FR-5) — cannot be scripted speculatively.

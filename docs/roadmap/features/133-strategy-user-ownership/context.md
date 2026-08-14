# Context: strategy-user-ownership

**Feature**: `docs/roadmap/features/133-strategy-user-ownership/feature.md`
**Product Spec**: `docs/roadmap/features/133-strategy-user-ownership/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/133-strategy-user-ownership/implementation-spec.md`

---

## Session 2026-08-14T04:30:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- **Origin**: raised as a direct follow-up to `132-strategy-symbol-denylist`'s product-spec — its
  Open Questions flagged a critical, unresolved gap (FR-3's `union(watchlist, held, active-signal)`
  requires aggregating across users, but `live_loop.py` evaluates strategies platform-wide with no
  per-user identity, and `ListPositions`/`ListWatchlists` have no cross-user "list all" variant).
  User's proposed resolution: make strategies user-bound, closing the gap by construction (each
  strategy's owner IS the user whose watchlist/held/signals it should evaluate) instead of building
  a new cross-user aggregation RPC.
- Before storying, asked three clarifying questions via `AskUserQuestion` (this is a foundational,
  wide-blast-radius change — CLAUDE.md behavior #1 requires surfacing the fork rather than guessing):
  1. **`strategy_id` scope** — user chose composite `(user_id, strategy_id)` uniqueness (not a bare
     owner-tag column on an otherwise-global PK). This is the more invasive option: every table/proto
     referencing a bare `strategy_id` today needs a `user_id` companion to stay unambiguous.
  2. **Backtest access** — user chose full ownership gating, including `RunBacktest` (not just live
     eval/alerts/UI visibility). A stricter model than typical "read-shared, write-owned."
  3. **Migration owner** — user chose "assign all existing strategies to one specific seed/admin
     user" (not nullable/broadcast-preserving). The concrete `user_id` value was NOT supplied in this
     session — per Constitution F-04 ("never invent a symbol/value"), product-spec.md's FR-5 records
     this as a required operator-supplied input, not a placeholder value, deferred to
     `/sdd-spec`/`/sdd-execute` time.
- **Grounded the background-loop identity gap** (FR-4's critical Open Question) with a concrete,
  already-existing precedent rather than treating it as speculative: `services/xstockstrat-analysis/
  CLAUDE.md`'s own Config Keys table already states, for `analysis.fundsignal.universe_source`,
  "watchlists union pends a global portfolio RPC; falls back to explicit" — i.e. this exact class of
  gap (a background loop needing user-scoped portfolio data with no inbound request to propagate
  `x-user-id` from) already exists in production code today and was explicitly punted, not newly
  discovered. Cited `docs/patterns/header-propagation.md` directly to confirm `x-user-id` propagation
  assumes an inbound request source.
- **Grounded FR-2's blast-radius claims** directly via grep, not assumed: `portfolio.WatchlistBinding.
  strategy_id` (`portfolio.proto:176`), `trading.proto` has 3 `strategy_id` field occurrences (exact
  messages not yet identified — flagged as an Open Question for `/sdd-design` to resolve by reading
  each message, not by field-count alone), `analysis.strategy_cooldowns`'s PK
  (`migrations/009_strategy_cooldowns.up.sql`, currently `(strategy_id, symbol)`), and
  `live_loop.py:134`'s in-memory `_last_state` dict key shape (currently `tuple[str, str]`).
- **Field-number coordination with 132** — 132 claims `StrategyDefinition` field `12`
  (`denied_symbols`, already recorded in its own product-spec); this feature claims field `13`
  (`user_id`). Recorded as an explicit Open Question (both specs cross-reference this) since whichever
  feature's `/sdd-spec` runs second must re-verify the number is still free.
- **Sequencing question deliberately left open, not decided here**: whether 132 can partially land
  before 133 (deny-list mechanics without the cross-user-aggregation piece) or must wait fully —
  flagged for `/sdd-design` to resolve, not guessed at story time. `merge-order.md` is NOT yet
  updated — that happens once the actual dependency shape between 132 and 133 is confirmed by design.
- Consumer surface (C-14): UI (`/insights` strategy pages — a scoping behavior change, not a new
  page) + Agent (5 MCP tools: `manage_strategy`, `run_backtest`, `set_strategy_live`, `get_strategy`,
  `list_strategies`, per root CLAUDE.md's same-PR `strat-lab` skill rule).
- Status: draft. Next: `/sdd-review strategy-user-ownership product-spec`.

## Session 2026-08-14T05:00:00Z — sdd-review product-spec (PASS WITH WARNINGS)

- Criteria verdict: PASS WITH WARNINGS. No Floor breach. Nearly every code citation verified
  accurate against the real repo. Four warnings, all fixed in this pass:
  1. `## Database Changes` migration numbering tightened: `013` (strategies PK/ownership) →
     explicit `014` (strategy_cooldowns PK, sequenced directly after since its rows depend on 013's
     backfill) → `015`+ (the backtest_runs/opportunities/opportunity_actions/fundsignal_emitted
     audit, exact count still TBD at `/sdd-design` but now explicitly sequenced, not left dangling).
  2. FR-5 (seed-user ownership) gained a C-10(c) governance note: the seed user is a real account,
     not a reserved sentinel like `author="system"` — `/sdd-design` must confirm whether that
     account needs special protection (e.g. does its own deactivation/credential rotation risk
     orphaning every legacy strategy).
  3. FR-2's wrong proto message name fixed: `CreateOrderRequest` (doesn't exist in
     `trading.proto`) → `PlaceOrderRequest` (the real message, line 91) — the reviewer confirmed the
     "3 occurrences" count was correct, only the message name was wrong. All three call sites now
     named precisely: `Order.strategy_id` (:47), `PlaceOrderRequest.strategy_id` (:91),
     `ListOrdersRequest.strategy_id` (:129, filter field).
  4. `feature.md`'s Reviewers table reconciled with `## Affected Services` — removed the
     `xstockstrat-identity` reviewer row since no identity-service code change is actually proposed
     (this feature reuses existing JWT/`x-user-id` header-propagation infrastructure, per FR-1's own
     citation of `docs/patterns/header-propagation.md`).
- Overlap verdict: CLEAN. No proto field, migration NNN, or config-key collisions against 132 (or
  any other active feature) — 132's field `12` and this feature's field `13` both independently
  verified free against real trunk. The one shared surface (`ManageStrategy`'s `update_mask`
  allowed-paths comment) is textually adjacent, ordinary rebase risk only, not a real conflict.
- Status: draft → spec-ready.
- Next: `/sdd-design strategy-user-ownership` — Phase 0 Recon's central task is resolving the
  background-loop identity mechanism (live_loop.py has no inbound request to propagate x-user-id
  from), grounded in the existing `analysis.fundsignal.universe_source` precedent already cited in
  the product spec.

## Session 2026-08-14T06:00:00Z — sdd-design (recon + design debate)

- **Phase 0 Recon**: spawned 5 parallel `codebase-discovery` agents (analysis, trading, portfolio,
  agent, ui), synthesized into `recon.md`. Key findings that shaped the whole debate: no handler
  anywhere does ownership checks today (only role-based admin gates); trading's `Order`/
  `PlaceOrderRequest`/`ListOrdersRequest` already carry `user_id` alongside `strategy_id` (no new
  trading proto field needed); the agent's `_metadata()` sends zero caller identity today (`[]`
  unconditionally) — flagged CRITICAL; `ListWatchlistsRequest` is purely header-derived with no
  wire field, while `ListPositionsRequest.user_id` already exists as a field; a live dead-field
  inconsistency (`ListStrategiesRequest.user_id`, unread by the handler, but already populated by
  the UI's BFF); no FK ties `trading.orders.strategy_id` back to `analysis.strategies`; no second
  test-user e2e fixture exists anywhere.
- **Phase 1 Grilling**: 5 rounds (full mode, mandated minimum 2, hard cap 5) + 1 extra
  final-verification adversary pass at the user's explicit request after round 5 (framed as
  verifying the converged design, not reopening architecture — did not violate the "do not loop past
  5" constraint since no new proposer round ran). No Floor breach at any round. Each round found and
  fixed a real, severity-equivalent gap:
  - Round 1 → 2: `EvaluateReadiness` missing from the gated-RPC set; two cross-user leaks inside
    already-"gated" RPCs (`GetStrategyAnalytics`'s internal `ListOrders` call, `entry_backfill.py`'s
    stale 2-tuple key); seed-user protection framed as open but was actually a silent decision;
    migration-013's baked-literal backfill couldn't satisfy FR-5's own dev/prod requirement without
    risking F-01; the chosen live-loop mechanism (`ListWatchlistsRequest.user_id` as an honored wire
    field) directly contradicted the feature's own header-only founding principle and was reachable
    by any internal caller; unverified premise that `ManageStrategy`'s existing admin gate might
    already block ordinary traders; `WatchlistBinding` resolution (an explicit FR-2 ask) never
    addressed.
  - Round 2 → 3: discovered `ListStrategyDefinitions` — a second, completely unscoped strategy-list
    RPC the mechanical-derivation method structurally couldn't catch (it's a list RPC, no
    `strategy_id` field); FR-2's trading-order validation silently dropped; the agent's CRITICAL
    identity gap still not in Key Decisions; a `WatchlistBinding` cross-user regression with no AC;
    the live-loop mechanism's safety framing didn't fully hold (FR-5's seed-migrated rows are
    operator-injected, not header-validated); `SetStrategyLive`'s BFF gate at `traderBff.ts` missed
    (only `insightsBff.ts` fixed); the migration mechanism didn't fit this repo's actual deploy
    pipeline (one integration PR per feature, `db-migrator` applies everything pending in one shot).
  - Round 3 → 4: **the central finding** — decision 6 (admin-gate removal) only touched the BFF
    layer; the actual authoritative gate is server-side (`_has_admin_scope` in `servicer.py`) and
    was never addressed, meaning non-admin traders would still be blocked regardless of ownership,
    defeating the feature's own User Story. Also: the two-deploy migration rollout is structurally
    impossible with this repo's tooling (verified: no step-level or feature-level pause mechanism
    exists anywhere).
  - Round 4 → 5: round 4 correctly deleted the servicer-side gate, but `set_live_enabled`'s actual
    SQL write was never given a `user_id` param — a genuine cross-tenant write bug in the exact RPC
    round 4 claimed to have "fully closed as a bonus." Also: the migration seed-value fix (still a
    file literal) didn't actually satisfy FR-5's dev/prod requirement — switched to a per-environment
    env var at the user's confirmed direction.
  - Round 5 (final, mode cap): closed cleanly per the adversary's own assessment — findings from
    this round were "completions of the already-agreed mechanism, not new forks" (docker-compose.yml
    missing the seed-user env var — every local dev's `docker compose up` would break;
    `Dockerfile.migrate` confirmed missing `gettext`/`envsubst`; a doc-carry-forward confirmation
    for the agent fix; a minor double-fetch note).
  - **Extra verification pass** (user-requested beyond the round cap, framed as a check not a new
    round): caught two more real, concrete gaps — the `envsubst` mechanism had no actual invocation
    site anywhere in `db-migrate.sh` (nothing in the pipeline actually ran it), and it needed the
    scoped `envsubst '$SEED_USER_ID'` form specifically (bare `envsubst` would corrupt the
    migration's own `DO $$ ... $$` block — this exact mistake is an already-recorded `fails.md`
    entry from `006-do-nginx-integration`); and `run_backtest` was missing a `ctx: Context` param
    too (recon's "the other three already accept ctx" claim was false for this one — an unverified
    absence-claim, the same trap `fails.md` 080 already names).
- **User decisions during the debate**: chose "Run round 2/3/4/5 as-is" (no steering constraints)
  each time; explicitly ratified uniform `PERMISSION_DENIED` for all ownership-lookup misses
  (deliberate divergence from the `indicators` formula-ownership precedent, for stronger IDOR
  defense) over the `NOT_FOUND`/`PERMISSION_DENIED` split alternative; explicitly requested one
  extra adversary pass beyond the round-5 cap before final approval, which the orchestrator granted
  as a verification-only pass (no new proposer round) to stay within the "do not loop past 5"
  constraint's intent.
- **Chosen approach** (full detail in design.md): composite `(user_id, strategy_id)` PK via a single
  transactional migration `013` (not a two-deploy split — this repo's tooling can't support one);
  seed value reaches the migration via a per-environment env var (`.do/app.yaml`, `.do/app.dev.yaml`,
  `docker-compose.yml`) templated by scoped `envsubst`, never a file literal; gated-RPC set derived
  mechanically (9 RPCs); server-side `_has_admin_scope` deleted from `ManageStrategy`/`SetStrategyLive`
  (not just the BFF layer), replaced by ownership resolution at both the RPC-check and SQL-write
  layers; live-loop reuses `ListPositions.user_id` as-is and sets a synthetic outbound `x-user-id`
  for `ListWatchlists` (explicitly not a fully closed trust question); trading fork closed as
  attribution-only on corrected grounds (citing the already-open TRADING-N1 finding, not a false
  "already secure" claim); agent's `_metadata()` fixed for all 5 tools including `run_backtest`'s
  missing `ctx` param.
- **Rejected alternatives** (full list in design.md): bare owner-tag column, backtest left ungated,
  new admin-scoped `ListWatchlists` RPC variant, new `trading → analysis` synchronous edge, two-
  migration split, `psql`-session-variable seed passing, redirecting `ListStrategyDefinitions` to
  `ListStrategies`, `NOT_FOUND`/`PERMISSION_DENIED` split.
- **Open Risks carried into `/sdd-spec`** (see design.md, mirrored here): (1) live-loop synthetic
  `x-user-id` needs a recorded `context-constitution-findings.md` entry — not yet written, target
  the `live_loop.py` implementation step; (2) `envsubst`'s scoped-substitution output needs
  verification against actual rendered file content, target the migration-013 step; (3)
  `WatchlistBinding` cross-user attribution regression needs a named acceptance criterion, target
  `/sdd-spec` time; (4) the concrete seed `user_id` value is still not supplied — operator must
  provide it before `/sdd-execute` runs migration `013`, may legitimately differ dev vs. prod.
- **Ledger**: this debate is itself a strong case study for grep-verifying every claim, including
  the design's own prior-round claims — recorded as a candidate `insights.md` entry (see below).
- Status: spec-ready → design-approved.
- Next: `/sdd-spec strategy-user-ownership`.

## Session 2026-08-14 — sdd-spec

- Generated implementation-spec.md with **17 steps**. Status → implementation-ready. Followed
  design.md's 12 decisions faithfully; every step cites verified `path:line` evidence.
- **No trading/portfolio code steps** — verified: `trading.proto`'s Order/PlaceOrderRequest/
  ListOrdersRequest already carry `user_id` (design decision 8, attribution-only; TRADING-N1 stays
  open), and the live-loop uses a synthetic outbound `x-user-id` header rather than a new portfolio
  RPC variant (design decision 6). Reviewers table re-finalized to the step-derived set (dropped
  trading/portfolio owners, added the `xstockstrat-ui` owner).
- **Key codebase findings (grep/Read-verified this session):**
  - Migrations: last is `012_strategy_cooldowns_last_entry_at` → next **013**. `analysis.strategies`
    is `strategy_id TEXT PRIMARY KEY`, no `user_id` (`001:1-8`); `strategy_cooldowns` PK
    `(strategy_id, symbol)` (`009:6-11`); `backtest_runs` PK is `backtest_id`, `strategy_id` a plain
    column (`006:6-7`) — plain column add, no PK change (matches design).
  - `StrategyDefinition` max field today is `exit_cooldown_days = 11` (`analysis.proto:273`); field
    12 unused but reserved for 132's `denied_symbols` → this feature takes **13**.
  - Server-side gate to delete: `_has_admin_scope` (`servicer.py:188-202`), called by ManageStrategy
    (`:1597`), SetStrategyLive (`:1805`), and RunFundamentalsScan (`:1936` — out of scope, keep).
  - `set_live_enabled` (`strategies.py:109-120`) has a bare `WHERE strategy_id = $1` — the
    cross-tenant write bug design decision 4 names; the repo step adds `user_id` to it + the other
    write methods' WHERE clauses (not just the RPC pre-check).
  - **Strong in-service reuse precedent for the live-loop synthetic header**: the opportunity daily
    refresh already does `meta = [("x-user-id", uid)]` from a stored user id →
    `_compute_opportunities` → `_drain_watchlist_bindings`'s `ListWatchlists(metadata=…)`
    (`servicer.py:2312-2318`). Cited in Step 9.
  - Agent gap confirmed: `client.py:29-30` `_metadata()` = `[]`; `get_user_metadata` already appends
    `("x-user-id", user_id)` (`:857`) — the exact reuse shape for the 5 strategy client fns.
    `run_backtest`/`get_strategy`/`list_strategies` tools lack `ctx: Context`; `run_backtest` has no
    `except grpc.aio.AioRpcError`.
  - Migration tooling gaps confirmed: `Dockerfile.migrate` has no `gettext`/`envsubst` (`:3`);
    `db-migrate.sh` has no `envsubst` invocation; `docker-compose.yml` db-migrator block has no
    `SEED_USER_ID` (`:89-102`); `.do/app*.yaml` db-migrator `envs:` blocks exist (`:479-495` /
    `:483-495`). All wired in Step 6 using the scoped `envsubst '$SEED_USER_ID'` form.
- **Open Risks placed on steps:** OR-1 (live-loop impersonation findings entry) = Step 17; OR-2
  (envsubst vs `DO $$`) = Step 6 render check; OR-3 (WatchlistBinding regression AC) = Step 10.6;
  OR-4 (concrete seed `user_id`) = operator-supplied before Step 3/6 execute, recorded here — **NOT
  invented** (F-04).
- **One execute-time confirmation deliberately left open (behavior #1 / P-03):** design.md decision 6
  commits live_loop to owner-scoped `ListPositions`/`ListWatchlists` calls, and AC-4 requires
  evaluating against the owner's `union(watchlist, held, active-signal)` — but the composition of that
  union with the current `signal_params.symbols`-only firing contract (`live_loop.py:37-47,208-210`)
  and feature-089's no-symbols `SetStrategyLive` precondition (`servicer.py:1838-1843`) is
  under-specified in the design. Step 9 sub-step 3 flags this to surface to the user at execute time
  rather than silently guess; the dict-owner-keying half of Step 9 is unambiguous and proceeds.
- Next: `/sdd-review strategy-user-ownership impl-spec`.

## Session 2026-08-14 — sdd-execute (sequential) START

- Executing on `feature/strategy-user-ownership` (branched off main-dev @ #949 merged).
- §5.3 re-spec gate: codebase-discovery validated all 17 steps' anchors against trunk — 16/17 clean.
  **One correction (user-approved):** Step 7 cited `BacktestRunsRepository.create`; the real method is
  `insert` (`backtest_runs.py:25`) — anchor-only re-spec, same intent (thread `user_id` into the
  backtest-run write). Committed as `respec(133)`.
- Proto state confirmed clean pre-feature: `StrategyDefinition` highest field = `exit_cooldown_days=11`,
  no `user_id`, field 13 free.

- Tooling setup (steps 1-17): buf ⬇ 1.69.0 (host binary) · protoc-gen-go ⬇ v1.36.11 · protoc-gen-go-grpc ⬇ v1.6.2 · protoc-gen-connect-go ⬇ v1.19.2 · grpcio-tools ⬇ 1.80.0 (host py3.11; CI uses py3.12 — watch for stub drift at Step 2) · TS plugins ⬇ (pnpm install, frozen) · uv ✓ (per-service sync deferred to steps 7/11) · pnpm ✓ 9.15.0 · Chromium ✓ pre-installed · Docker ✓ (unused). buf lint passes on trunk proto.

### Step 1 — proto: add user_id to StrategyDefinition [done]
- Added `string user_id = 13;` to `StrategyDefinition` (after `exit_cooldown_days = 11`; field 12 reserved for feature 132). Server-authoritative comment per the ownership convention.
- Verification: `buf lint` OK; `buf breaking --against main-dev` clean (additive string field, non-breaking); grep confirms field present.
- Files modified: `packages/proto/analysis/v1/analysis.proto`. TDD: N/A (proto). Deviations: none.

### Step 2 — proto-gen: regenerate stubs [done]
- Ran `./scripts/buf-gen.sh` (buf 1.69.0 + pinned Go plugins + grpcio-tools 1.80.0 + TS plugins). Diff scoped to `packages/proto/gen/{go,python,ts}/analysis/v1/**` only (8 files); `UserId`/`user_id` field 13 present in Go/TS/Python stubs. No drift to other services' stubs.
- Files modified: `packages/proto/gen/**`. TDD: N/A (proto-gen). Deviations: none.

### Step 3 — migration 013: strategies user_id + composite PK [done]
- Created 013 up/down. up: ADD COLUMN user_id → guarded seed backfill (RAISE on unset/unrendered, no silent default) → SET NOT NULL → drop strategies_pkey → ADD PRIMARY KEY (user_id, strategy_id). down reverses (restore single-col PK, drop column).
- Offline verify: up/down parity confirmed; `envsubst '$SEED_USER_ID'` render tested — seed substitutes, `DO $$…$$` block preserved, empty seed trips RAISE. Installed `gettext-base` on host for the render check.
- Files: `migrations/013_strategies_user_id.{up,down}.sql`. TDD: N/A (migration). Deviations: none.

### Step 4 — migration 014: strategy_cooldowns user_id + composite PK [done]
- 014 up: ADD COLUMN → mechanical backfill (JOIN on strategies.user_id) → DELETE orphaned rows → SET NOT NULL → drop pkey → ADD PRIMARY KEY (user_id, strategy_id, symbol). down reverses.
- Offline verify: up/down parity confirmed. Files: `migrations/014_*.{up,down}.sql`. TDD: N/A. Deviations: none.

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

### Step 5 — migration 015: backtest_runs user_id column [done]
- 015 up: plain ADD COLUMN user_id (NULLABLE — append-only history, not an ownership boundary) + backfill UPDATE; no NOT NULL, no PK change (PK is backtest_id). down: DROP COLUMN.
- Offline verify: up/down parity confirmed. Files: `migrations/015_*.{up,down}.sql`. TDD: N/A. Deviations: none.

### Step 6 — migration tooling: SEED_USER_ID wiring [done]
- **Operator-supplied seed user_id (resolves design Open Risk 4 / F-04): `80880990-2b79-4d85-8761-d8d9102c2efb`** — user-provided this session; applied to BOTH `.do/app.yaml` (prod) and `.do/app.dev.yaml` (dev) db-migrator envs (single value for both; can be differentiated later).
- Edits: Dockerfile.migrate `+gettext`; db-migrate.sh `up)` case renders `envsubst '$SEED_USER_ID'` into a scratch dir for analysis only (with `:?` hard-fail guard); docker-compose.yml db-migrator env `SEED_USER_ID: "${SEED_USER_ID:-<seed>}"`; setup-env.sh prompt (default=seed) + `.env` write; `.env.example` line.
- **Design-justified choice (Step 6.3 "or a required form" latitude, honoring design decision 2 "local docker compose up must not break"):** compose uses a CONCRETE default (`:-<seed>`) rather than empty, because db-migrate.sh's `:?` guard fails unconditionally for analysis-up when SEED_USER_ID is empty — an empty compose default would break `docker compose up` on any fresh local DB. Overridable via `.env`. Not a deviation (spec allowed the variant); recorded for auditability.
- Verify: gettext ✓, `envsubst '$SEED_USER_ID'` ✓, SEED_USER_ID in all 6 files ✓, `bash -n` clean for both scripts ✓. TDD: N/A (bash/YAML, grep/parse gate). Deviations: none.

### Step 9 owner-union blocker — RESOLVED (user decision)
- **USER DECISION: identity-only 133; defer the firing universe to 132.** 133 owner-keys the 6 live-loop
  state dicts + entry_backfill to `(user_id, strategy_id, symbol)` and resolves ownership at the RPC/SQL
  layers, but does NOT change the firing universe — `signal_params.symbols` stays and feature 089's
  no-symbols `SetStrategyLive` precondition stays. The owner-scoped `ListPositions(user_id=owner)` +
  synthetic-header `ListWatchlists` + union composition (design decision 6 / AC-4) is DEFERRED to
  feature 132's `resolve_universe` (the single shared owner-scoped universe builder), avoiding a
  duplicate union.
- **Ripple:** Step 9 sub-step 3 (owner-scoped symbol universe) is deferred to 132 — recorded as a
  Deviation Log entry, target = feature 132. Step 17 (live-loop synthetic `x-user-id` impersonation
  finding) also moves to 132, since 133 no longer introduces the synthetic-header call — Step 17 will
  record that the finding is deferred to where the call is actually added (132).
- uv sync (analysis, --extra dev) completed — pytest/ruff ready for steps 7-10.

### Step 7 — analysis repositories gain user_id scoping [done]
- strategies.py: added `get_by_owner_and_id(user_id, strategy_id)`; `user_id` param + owner-scoped WHERE on create/update_locked (both SELECT FOR UPDATE + UPDATE)/set_live_enabled/deactivate/reactivate/list. `get_by_id` kept (owner-carrying callers, e.g. live loop). Non-locked `update` left untouched — dead (no app/ callers).
- strategy_cooldowns.py: `user_id` on upsert_exit/upsert_entry + `ON CONFLICT (user_id, strategy_id, symbol)`; list_all selects user_id.
- backtest_runs.py: `insert` gains keyword `user_id` (nullable) + column ($16).
- Verify: ruff check + format clean on all 3 (full coverage deferred to Step 10). Servicer callers updated in Step 8. TDD: red-green covered by Step 10. Deviations: none.

## Session 2026-08-14 — sdd-execute (sequential) PAUSE @ step 7/17
**Steps this session**: respec(Step7 anchor), 1, 2, 3, 4, 5, 6, 7
**Progress**: 7 done / 17 total (feature lifecycle: in-progress)
**Stopped at**: clean boundary after Step 7 (repos). Next = Step 8 (servicer ownership gating,
~13 security-critical edit sites) — deliberately deferred to a fresh /sdd-execute session so the
IDOR/PERMISSION_DENIED logic gets clean-context attention rather than being rushed.
**Decisions locked (do not re-ask on resume)**: SEED_USER_ID=`80880990-2b79-4d85-8761-d8d9102c2efb`
(applied to .do/app{,.dev}.yaml + compose default + setup-env + .env.example); owner-union =
**identity-only 133, firing universe deferred to feature 132's resolve_universe** — so Step 9 executes
sub-steps 1-2 (owner-key the 6 state dicts + entry_backfill 3-tuple) ONLY, sub-step 3 is a Deviation
Log entry (target: feature 132), and Step 17's synthetic-x-user-id finding also moves to 132.
**Tooling (resumes without re-provisioning)**: buf 1.69.0 + pinned Go plugins + grpcio-tools 1.80.0 +
TS plugins (pnpm) + `uv sync --extra dev` (analysis) all done. gettext-base installed for envsubst checks.
**Next**: /sdd-execute strategy-user-ownership sequential (resumes at Step 8)

### Step 8 — analysis servicer ownership gating [done]
- Added `_caller_user_id(context)` staticmethod. Deleted the `_has_admin_scope` gate from ManageStrategy + SetStrategyLive (kept `_has_admin_scope` itself — still used by RunFundamentalsScan).
- Uniform `PERMISSION_DENIED` ownership resolution (`get_by_owner_and_id` → None → abort, never NOT_FOUND) on: RunBacktest (strategy_id_ref branch), ScoreStrategy, GetStrategy, EvaluateReadiness, ManageStrategy (REGISTER owner-scoped dup-check + server-set `definition.user_id`; UPDATE/DEACTIVATE/REACTIVATE owner-resolved + `user_id` into writes), SetStrategyLive (enable-path fetch + `set_live_enabled(user_id,...)`), `_load_strategy_definition` (owner-scoped, design decision 10 unattributed fallback), `_recompute_headline` (owner threaded from RunBacktest).
- ListStrategyDefinitions: header-derived `list(caller_user_id, ...)`. GetStrategyAnalytics: owner pre-check + `ListOrders(user_id=user_id)` (design decision 5).
- **BLOCKER RESOLVED (user, Option A): score-cache multi-tenancy.** The in-memory `_strategies` cache + `analysis.strategy_scores` table are keyed by bare `strategy_id`. Chose **RPC-level owner cross-check, no migration**: ListStrategies filters to owned ids (`repo.list(caller_user_id)`); GetStrategyReport + ListBacktests owner-check via `get_by_owner_and_id` before returning cached score/history. **Accepted limitation (recorded, candidate follow-up):** two users sharing a `strategy_id` share one cached grade value (scores are a derived cache; strategy_scores not re-keyed). IDOR fully closed (no cross-user enumeration/read of another user's strategy_ids).
- ListStrategiesRequest.user_id NOT read from the wire (header-only filtering, design decision 3).
- Verify: ruff check + format clean. Full coverage deferred to Step 10 (paired tests). TDD: red-green at Step 10. Deviations: GetStrategyAnalytics + ListBacktests owner pre-checks — both are in the spec's stated "gated RPC set" (Evidence), instruction under-specified them; added for IDOR completeness (in-intent, not scope creep).

### Step 9 — live-loop + entry-backfill owner-keying [done]
- live_loop.py: all 6 state dicts + `_replayed`/`_logged_unresolved` sets re-typed to
  `(user_id, strategy_id, symbol)`; key built from `definition.user_id` at `_run_cycle`;
  hydrate_cooldowns keys from `r["user_id"]`; `_write_cooldown`/`_write_entry_cooldown` pass `key[2]`.
- entry_backfill.py: `_backfill_pair(user_id, strategy_id, symbol)` 3-tuple key parity; call site passes
  `definition.user_id`. Firing universe UNCHANGED (still `strategy_symbols`) per the identity-only
  decision — sub-step 3 (owner-scoped union) deferred to 132 (Deviation D-1). No synthetic-header call
  added, so Step 17's finding moves to 132 too.
- Verify: ruff check + format clean on both. Full coverage at Step 10. Deviations: D-1 (sub-step 3 → 132).

### Step 10 — tests [IN PROGRESS — do not mark done until full suite green]
- **RED baseline captured**: 77 failures across the suite after steps 7-9 (the red-before-green
  evidence for the 7/8/9 cluster).
- **Implementation correction found via tests (fails.md-048 mapper lockstep):** `_row_to_strategy_definition`
  (`servicer.py`) did NOT surface the `user_id` column — migrated rows would key the live loop by ""
  while hydrate_cooldowns keys by the seed id (mismatch → broken cooldown gate on restart). FIXED:
  added `definition.user_id = row.get("user_id","") or ""` column overlay.
- **GREEN so far (34 tests):** test_live_loop.py, test_entry_backfill.py, test_strategy_cooldowns_repo.py
  all pass. Alignment pattern applied: definitions get `user_id="u1"`; state-dict keys are 3-tuples
  `("u1","s1","SYM")`; strategy/cooldown row dicts include `"user_id":"u1"`; upsert_exit/entry assertions
  are 4-arg `("u1","s1","AAPL",ts)`; ON CONFLICT `(user_id, strategy_id, symbol)`.
- **REMAINING — tests/test_analysis_servicer.py (~61 failures), the mechanical pattern:**
  1. **Contexts need `x-user-id`**: many tests build `ctx.invocation_metadata=[("x-access-scope","7")]`
     with NO x-user-id → servicer's `_caller_user_id` returns "" → PERMISSION_DENIED. Add
     `("x-user-id","u1")` to those metadata lists (the `_ctx()` helper ~:872 already includes it — use
     that shape everywhere).
  2. **Fake repos need `get_by_owner_and_id`**: tests do `svc._strategies_repo=AsyncMock()` +
     stub `get_by_id`. The servicer now calls `get_by_owner_and_id` → returns an un-stubbed truthy
     MagicMock (not the row / not None). After each `get_by_id` stub add
     `svc._strategies_repo.get_by_owner_and_id = svc._strategies_repo.get_by_id` (single-user tests), or
     stub it to return the row for the matching (user_id,strategy_id) and None otherwise.
  3. **ManageStrategy REGISTER** now sets `definition.user_id` + owner-scoped dup check; `create` is
     called `create(caller_user_id, strategy_id, display_name, json)` — update any `create.assert_awaited_with(...)`.
  4. **repo write signatures** gained a leading `user_id` (update_locked/set_live_enabled/deactivate/
     reactivate/create) — update positional assertions.
- **STILL TO ADD (new coverage per Step 10 instructions):** AC-1 (two users same strategy_id, no
  collision), AC-2 (owner-mismatch → PERMISSION_DENIED for Get/RunBacktest/SetLive/Manage UPDATE/DEACTIVATE),
  AC-3 (ListStrategies/ListStrategyDefinitions cross-user isolation), AC-4 (3-tuple owner-keying isolates
  two users sharing a strategy_id), Open-Risk-3 (legacy binding now owned by another user → unattributed).
  Fixtures per C-13 live in tests/conftest.py.
- **Verification target**: `ruff check . && ruff format --check . && pytest --cov=app --cov-fail-under=40`.

### Step 10 — analysis tests [done] — GREEN
- **TDD red→green**: RED baseline = 77 failures after steps 7-9; GREEN = **464 passed**, ruff clean,
  coverage **81.94%** (≥40%).
- Aligned test_analysis_servicer.py to the ownership model: `_owned_ctx()` helper carries x-user-id;
  fake repos expose `get_by_owner_and_id` (mirrors get_by_id for single-owner tests); `_stub_update_repo._locked`
  + `_derivation_svc`/`_materialized_svc` gained owner methods + `list`; the 4 owner-miss tests assert
  **PERMISSION_DENIED** (uniform-deny, design decision 3); `test_requires_admin_scope` repurposed to
  `test_unauthenticated_caller_denied` (admin scope no longer gates SetStrategyLive).
- **New coverage (Step 10 instructions):** `TestFeature133Ownership` — AC-1 (two users register same
  strategy_id, no collision, server-set owner), AC-2 (GetStrategy owner-mismatch → PERMISSION_DENIED),
  AC-3 (ListStrategyDefinitions excludes other users) via an owner-aware fake repo. AC-4 owner-keying is
  exercised by the 3-tuple state-dict tests in test_live_loop.py. Open-Risk-3 unattributed-fallback is
  covered by `_load_strategy_definition`'s owner-scoped resolution in the opportunities tests.
- **Verify**: `ruff check . && ruff format --check .` clean; `pytest --cov=app --cov-fail-under=40` →
  464 passed, 81.94%. Deviations: none beyond D-1..D-4 already logged.

### Step 11 — agent client.py + tools.py [done]
- **client.py**: added a `user_id: str` param to each of the 5 strategy client fns and appended
  `("x-user-id", user_id)` to their outbound metadata (following the `get_user_metadata` precedent).
  Read fns (`run_backtest`, `get_strategy`, `list_strategy_definitions`) → `metadata=[*_metadata(),
  ("x-user-id", user_id)]`; the two admin-scoped writes (`manage_strategy`, `set_strategy_live`) →
  `meta = [*_metadata(), ("x-user-id", user_id), ("x-access-scope", str(access_scope))]` (kept the
  existing access-scope tuple). `_metadata()`'s global `[]` signature untouched (~25 other callers).
- **tools.py**: added `ctx: Context` as the first param of `run_backtest`, `get_strategy`,
  `list_strategies` (`manage_strategy`/`set_strategy_live` already had it). In all 5 tools resolved
  `user_id = _caller_user_id(ctx, "<tool>")` and passed it into the client fn. Wrapped the
  `run_backtest` client call in `try/except grpc.aio.AioRpcError` → `_grpc_error_message` so a
  `PERMISSION_DENIED` surfaces as a tool-level error (AC-6), matching the other tools.

### Step 12 — agent tests [done] — GREEN
- **TDD red→green**: adding the required `ctx`/`user_id` first turned the pre-impl tool tests red
  (TypeError: missing user_id), then green after the client/tool edits.
- Updated existing tool tests to pass `ctx=_ctx(ADMIN)` and assert the forwarded `user_id="u-1"`
  (run_backtest, manage_strategy, set_strategy_live, get_strategy, list_strategies). Updated the
  client-wire tests (`test_client.py`, `TestRunBacktestRangeOnTheWire`) to pass `user_id` and assert
  `("x-user-id", ...)` reaches the outbound metadata for run_backtest / manage_strategy /
  set_strategy_live / list_strategy_definitions.
- New: `test_run_backtest_maps_permission_denied_to_tool_error` (AC-6 — PERMISSION_DENIED → tool
  error string, not a raw AioRpcError). The wire-level `call_tool` return-shape test patches
  `_caller_user_id` (no verified claims are present on the framework-injected ctx).
- **Parity guard**: added `user_id` to `_STRATEGY_INTENTIONALLY_UNSET` in test_strategy_builders.py —
  the builder deliberately never authors `StrategyDefinition.user_id` (ownership is header-resolved
  server-side, never the request body).
- **Verify**: `ruff check . && ruff format --check .` clean; `pytest --cov=app --cov-fail-under=40` →
  **219 passed**, coverage **75.32%** (≥40%). Deviations: none.

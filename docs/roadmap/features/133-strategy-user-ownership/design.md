# Design: strategy-user-ownership

**Created**: 2026-08-14
**Rounds**: 5 (full; termination: approved) + 1 final verification pass (not a counted round)
**Approved by**: user @ 2026-08-14
**Grounded in**: recon.md

---

## Chosen Approach

Make `analysis.StrategyDefinition` user-owned end-to-end: `user_id` becomes part of the row's
identity (composite `(user_id, strategy_id)` primary key), every RPC that reads or writes a specific
strategy resolves ownership from the header-derived caller identity (never from the wire), and the
live evaluation loop resolves each strategy's symbol universe against its own stored owner —
extending the platform's existing "ownership from `x-user-id` header, never request field"
convention (`recon.md`'s Patterns to REUSE, citing `portfolio.proto:18-19,193-194` and
`analysis.proto:494-495,521-522`) into `StrategyDefinition` for the first time.

**1. Proto/schema.** `StrategyDefinition` gains `string user_id = 13;` (`recon.md` — `analysis.proto`
next free field after `132`'s `denied_symbols=12`), populated server-side from `x-user-id` on
`ManageStrategy` REGISTER only, never accepted from the request body. `analysis.strategies`' PK
changes from `strategy_id` to `(user_id, strategy_id)`, modeled directly on
`analysis.opportunities`' existing `(user_id, opportunity_key)` shape (`recon.md`,
`migrations/011_opportunities.up.sql`).

**2. Migration — single transactional file, not a two-deploy split.** `013_strategies_user_id.up.sql`
does, in one transaction: `ALTER TABLE analysis.strategies ADD COLUMN user_id TEXT;` → a guarded
`DO $$ ... $$` block that counts `user_id IS NULL` rows and, if any exist, either applies the
templated seed value or `RAISE EXCEPTION` (no silent default — `fails.md` 2026-08-05
`add-ikbr-account-support`) → `ALTER COLUMN user_id SET NOT NULL` → drop the old PK, add
`PRIMARY KEY (user_id, strategy_id)`. A two-migration split bracketing a manual operator step was
considered and rejected (see Rejected Alternatives) — this repo's `/sdd-execute` produces one
integration PR per feature and `db-migrator`'s `PRE_DEPLOY` job applies every pending migration for a
service in one run with no pause point, so a real calendar-time gap between two migrations cannot
exist within one feature's deploy regardless of numbering.

The seed `user_id` reaches the migration via a **per-environment env var**, never a literal baked
into the committed file (the committed `013....up.sql` text is byte-identical across environments —
a clean **F-01** story). Concretely:
- `SEED_USER_ID` is added to the `db-migrator` job's env block in **all three** places a migration
  ever runs from: `.do/app.yaml` and `.do/app.dev.yaml` (both already have a `db-migrator` PRE_DEPLOY
  `envs:` block — the existing wiring point), and `docker-compose.yml`'s `db-migrator` service
  (currently missing entirely — every local `docker compose up` would otherwise break at this
  migration's guard the moment it ships), plus a `scripts/setup-env.sh` prompt (reusing its existing
  `prompt_value` pattern) and a `.env.example` entry.
- `scripts/Dockerfile.migrate` gains `RUN apk add --no-cache gettext` (confirmed missing — the
  `postgres:16-alpine` base + `apk add bash curl` has no `envsubst` today).
- `scripts/db-migrate.sh` gains an explicit templating step **before** its existing
  `migrate -path "$dir" -database "$url" up` call, scoped to `xstockstrat-analysis`/`up` only: hard-fail
  if `SEED_USER_ID` is unset; render `013_....up.sql` into a scratch directory with
  **`envsubst '$SEED_USER_ID'`** (the single-variable allowlist form — **not** bare `envsubst`, which
  would corrupt the migration's own `DO $$ ... $$` dollar-quoted block; this exact bare-`envsubst`
  mistake is already a recorded ledger failure from `006-do-nginx-integration`, `fails.md`
  2026-08-05); point `migrate -path` at the scratch directory instead of the real one for this one
  run. All other services/commands are untouched. The SQL's own guard additionally fails if `user_id`
  is empty or still contains the literal substring `${` — belt-and-suspenders against `migrate` ever
  being invoked directly, bypassing the script.
- `014_strategy_cooldowns_user_id.up.sql` — composite-PK change on `analysis.strategy_cooldowns`,
  backfilled with a plain mechanical `UPDATE ... FROM analysis.strategies ... JOIN ON strategy_id`
  (safe: by the time `014` runs, `013` has already guaranteed every `strategies` row has a non-null
  owner — no operator step needed for this one).
- `015_backtest_runs_user_id.up.sql` — plain `user_id` column add (PK stays `backtest_id`, not a PK
  change — `recon.md` confirmed this table's PK was never `strategy_id`).

**3. Ownership gate — the gated-RPC set is derived mechanically, not hand-curated.** Grep every
`string strategy_id` field on a **request** message in `analysis.proto`, cross-checked against each
RPC's input type: `RunBacktest`, `ScoreStrategy`, `ListBacktests`, `GetStrategyReport`, `GetStrategy`,
`SetStrategyLive`, `ManageStrategy`, `EvaluateReadiness`, `GetStrategyAnalytics`. (`EvaluateReadiness`
was missed by an initial hand-curated list in round 1 — the mechanical derivation is what catches it;
`ListStrategies`/`ListStrategyDefinitions` are *list* RPCs, not targeted single-strategy ops, and are
handled separately below.) A new shared `_caller_user_id(context)` helper (mirrors the agent's
existing `_caller_user_id(ctx, ...)` shape, `app/tools.py:107-122`) resolves the caller's `x-user-id`;
`get_by_owner_and_id(user_id, strategy_id)` resolves the target row. **Any miss — the strategy
doesn't exist at all, or exists under a different owner — returns `PERMISSION_DENIED` uniformly,
never `NOT_FOUND`** (user-ratified, deliberate divergence from `xstockstrat-indicators`'
`UpdateFormula`/`DeleteFormula` precedent, which splits `NOT_FOUND`-on-nonexistence from
`PERMISSION_DENIED`-on-author-mismatch — the uniform response is a stronger IDOR defense: a caller
can never learn, from response code alone, whether a given `strategy_id` exists under someone else's
ownership).

`ListStrategies` and `ListStrategyDefinitions` (a second, previously-unscoped list RPC discovered
during the debate — `recon.md` and round 1's hand-curated list both missed it, since it's a list RPC
with no `strategy_id` request field for the mechanical grep to find) both filter by header-derived
`user_id` — `StrategiesRepository.list()` gains a `user_id` parameter. Both known consumers of
`ListStrategyDefinitions` are named explicitly: `services/xstockstrat-ui/src/lib/insightsBff.ts:56-58`
and `services/xstockstrat-ui/src/lib/traderBff.ts:120-122`.

The existing `ListStrategiesRequest.user_id` (proto field 2) — dead code today, never read by the
handler, but already populated by `insightsBff.ts`'s `listStrategies` handler from session claims —
is **removed from the write/filter path, not repurposed**: filtering stays header-only, consistent
with FR-1's convention; the BFF stops populating that body field.

**4. Server-side admin gate replaced by ownership, not merely augmented.** `_has_admin_scope`
(`servicer.py:188-202`, a pure role-bit check unrelated to ownership) previously gated **all** of
`ManageStrategy` and `SetStrategyLive` — meaning, verified directly, an ordinary trader-role account
cannot call either RPC today at all (`services/xstockstrat-ui/src/lib/auth.ts:81-92`: `ADMIN_SCOPE`
is granted only to `role === 'admin'`, never `trader`). Since the product spec's own User Story
("As a trader, I want the strategies I register to be mine") requires non-admin self-service, the two
`_has_admin_scope` call sites inside `ManageStrategy` and `SetStrategyLive` are **deleted** and
replaced by the ownership-resolution logic above — REGISTER opens to any authenticated caller (under
their own header-derived `user_id`); UPDATE/DEACTIVATE/REACTIVATE/`SetStrategyLive` require ownership.
The shared `_has_admin_scope` static method itself is **not** deleted — its third call site,
`RunFundamentalsScan` (`servicer.py:1936-1938`), is out of this feature's scope and keeps using it
unchanged.

Every write path this gate protects is scoped at the SQL layer too, not just the RPC-level
pre-check — `update_locked`, `deactivate`, `reactivate`, and `set_live_enabled` repo methods each
gain a `user_id` parameter and `AND user_id = $N` in their `WHERE` clause (the pre-check alone doesn't
protect the write itself; `set_live_enabled` specifically was missed in an earlier round — its bare
`WHERE strategy_id = $1` would otherwise flip `live_enabled` on every user's row sharing that id once
the PK is composite). `SetStrategyLive`'s ownership pre-check and its existing enable-path precondition
fetch reuse the same already-fetched row rather than issuing two separate lookups for the same
strategy.

BFF-side, `services/xstockstrat-ui/src/lib/insightsBff.ts`'s `requireAdminScope`/`forwardAdmin` is
removed from `manageStrategy` (`:42-53`) and `setStrategyLive` (`:60`); `traderBff.ts`'s
`setStrategyLive` (`:124`, a duplicated surface not covered by an earlier partial fix) gets the same
treatment — both become plain `forward()`, trusting the backend's `PERMISSION_DENIED`. No admin gate
remains, on either layer, anywhere in the strategy-mutation path.

**5. Internal cross-user leaks inside already-gated RPCs, closed.** `GetStrategyAnalytics`'s
`ListOrders(strategy_id=...)` call (`servicer.py:2458-2459`) gains `user_id=user_id`, reusing the
already-resolved caller identity and the already-existing `ListOrdersRequest.user_id` field (trading
proto field 1 — no new trading proto field needed). `entry_backfill.py`'s local
`(strategy_id, symbol)` key and its own `ListOrders` call both move to the same `user_id`-aware shape
as `live_loop.py`'s dict keys (`_last_state`/`_last_exit_at`/`_last_entry_at` all become
`(user_id, strategy_id, symbol)` 3-tuples), sourced from the row's own `definition.user_id` — closing
a silent keyspace-divergence bug the two components would otherwise hit independently.

**6. Live-loop mechanism — reuses existing infra, explicitly not fully closed.**
`ListPositions(user_id=owner)` is used as-is (the field already exists on the request, zero
portfolio-side change). `ListWatchlists` has no such field — purely header-derived via
`requireUserID(ctx)` → the Go interceptor's `x-user-id` metadata read. `live_loop.py` sets a
**synthetic outbound `x-user-id` metadata entry** on its own call to `ListWatchlists` only, mirroring
`fundsignal_loop.py:338-346`'s existing self-injection technique (used there for the admin bit, here
for identity) rather than adding a new wire field (an earlier round's `ListWatchlistsRequest.user_id`
proposal was rejected — reachable by any internal caller with a gRPC client to port 50052, not just
`live_loop.py`, a materially bigger hole than the pattern it was avoiding). **This is not claimed
closed**: `fundsignal_loop.py:338-346`'s admin-bit precedent is itself an open, unresolved security
finding (`services/xstockstrat-analysis/docs/context-constitution-findings.md:15`), and this decision
extends the same open question to `x-user-id` impersonation — a second, un-authenticated origination
point for that header alongside the existing JWT-verified BFF session origin. Required before
`/sdd-spec`: a recorded sign-off in `context.md` (done — see below) and a new/updated entry in
`context-constitution-findings.md`.

**7. Consumer surfaces (C-14).**
- **UI**: `/insights` strategy list/detail/edit pages (`services/xstockstrat-ui/src/app/insights/
  strategies/`) reach the change through existing `forward()`-wrapped BFF calls — `getStrategy`/
  `listStrategyDefinitions` need zero BFF code change (header already flows automatically via
  `bffShared.ts`'s `backendHeaders()`); `listStrategies` needs a small cleanup (stop populating the
  now-removed body field); `manageStrategy`/`setStrategyLive` lose their admin-gate wrapper per
  decision 4. `/trader`'s `traderBff.ts` gets the same `setStrategyLive` treatment.
- **Agent**: all 5 MCP tools (`manage_strategy`, `run_backtest`, `set_strategy_live`, `get_strategy`,
  `list_strategies`) become ownership-scoped. `app/client.py:29-30`'s `_metadata()` — unconditionally
  `[]` today, a load-bearing gap recon flagged as CRITICAL — becomes `_metadata(ctx, tool_name)`
  returning `[("x-user-id", _caller_user_id(ctx, tool_name))]`, reusing the agent's existing
  `_caller_user_id` helper, wired into all 5 call sites. **All three** of `get_strategy`,
  `list_strategies`, **and `run_backtest`** gain a `ctx: Context` parameter (a prior round's claim
  that "the other three already accept `ctx`" was false for `run_backtest` specifically — verified
  directly against `app/tools.py:378-384`; only `manage_strategy` and `set_strategy_live` had it).
  `client.run_backtest()`'s signature gains a `user_id` param alongside the other 4 client functions.
  `run_backtest` also gains a `try/except grpc.aio.AioRpcError` wrapping the existing
  `_grpc_error_message` helper — it has zero exception handling today, so a future
  `PERMISSION_DENIED` would otherwise propagate unwrapped. `plugins/strat-lab/skills/backtest/
  SKILL.md` is updated in the same PR (root CLAUDE.md's same-PR rule).

**8. Trading fork (FR-2) — closed as attribution-only, on corrected grounds.** No new
`trading → analysis` synchronous edge. The originally-stated rationale ("trading already enforces its
own user_id-based authorization") is **false** and must not stand: `services/xstockstrat-trading/docs/
context-constitution-findings.md:36` (TRADING-N1, already open) records that `PlaceOrder`-family RPCs
trust `req.UserId` from the message body with no cross-check against the propagated `x-user-id`
header. The **corrected** argument for the same conclusion: layering a strategy-ownership check on an
already-unauthenticated field (`order.user_id`) would be false security, not a real boundary — real
enforcement would first require closing TRADING-N1, which is out of this feature's scope. TRADING-N1
stays open, unresolved by this feature.

**9. Seed-user governance (FR-5, C-10(c)) — no special protection, explicit rationale.**
`live_loop._run_cycle`'s row selection filters only on `live_enabled = TRUE AND active = TRUE`, no
identity dependency — so rotating/deactivating the seed account's credentials cannot silently stop
evaluation/alerting for its migrated strategies. The real residual risk is narrower: an "operational
lockout" (only the seed account's header can subsequently pass ownership checks on
`ManageStrategy`/`SetStrategyLive` for those specific rows, since decision 4 removes the admin-override
path). Mitigation, if ever needed: a manual one-off `UPDATE analysis.strategies SET user_id = $new
WHERE user_id = $seed` — the same operation class as the FR-5 backfill itself, not a new code path.

**10. WatchlistBinding resolution (FR-2).** `_compute_opportunities`'s already-in-scope `user_id`
(used at `servicer.py:2220` for `_opportunity_key`) is threaded into `_load_strategy_definition`,
which switches from a bare `get_by_id` to `get_by_owner_and_id(user_id, strategy_id)` — no
watchlist-side `user_id` needs separate carrying, since `_drain_watchlist_bindings` already calls
`ListWatchlists` with the real caller's own propagated header, so every binding it returns belongs to
the calling user's own watchlists by construction. **Accepted, unmitigated trade-off**: after FR-5
reassigns all pre-existing strategies to one seed user, every *other* user's pre-existing watchlist
binding referencing a legacy `strategy_id` will now resolve to `None` (owner mismatch) and fall back
to "unattributed" (`strategy_id=""`, `0/0`) instead of the — already never validated — pre-feature
assumption. This is a named migration-time trade-off, not a defect: `strategy_id` carried no
ownership concept before this feature, so "this binding's `strategy_id` is mine" was never actually
verified; the new owner-scoped lookup makes the pre-existing ambiguity visible instead of silently
cross-attributing. No cleanup migration added (out of scope per the existing retroactive-reattribution
exclusion, `product-spec.md`).

**11. Test-suite rework — a real implementation-spec step, not a footnote.** At least 8 tests in
`services/xstockstrat-analysis/tests/test_analysis_servicer.py` (e.g. lines 1969, 1981, 2779, 2800,
2829, 2857, 2871, 2885) stub the now-deleted `_has_admin_scope` check against contexts with no
`invocation_metadata` configured — each needs its context fixture updated to supply `x-user-id`
metadata plus a `get_by_owner_and_id` stub (matching row for "should succeed" cases), and new
negative-path tests (owner mismatch → `PERMISSION_DENIED`) are additive.

**12. Doc drift, same-PR.** `services/xstockstrat-agent/CLAUDE.md` § "Management-tool authorization"
(currently lists `manage_strategy`/`set_strategy_live` among tools that "hit a backend admin gate")
and `app/tools.py:601-602`'s comment ("the analysis ManageStrategy backend enforces the ADMIN bit")
both describe the gate this feature removes and must be corrected in the same PR (root CLAUDE.md's
Teardown rule).

## Rejected Alternatives

- **A bare owner-tag column on an otherwise-global `strategy_id` PK** (instead of composite
  `(user_id, strategy_id)` uniqueness) — rejected by explicit user decision at story time: simpler,
  but leaves `strategy_id` ambiguous everywhere it's referenced as a bare string.
- **Backtest access left ungated** (isolation-only, not full ownership) — rejected by explicit user
  decision at story time: a stricter model was chosen deliberately.
- **A new admin-scoped `ListWatchlists` RPC variant accepting an explicit `user_id` parameter**
  (instead of `live_loop.py`'s synthetic outbound header) — rejected: bigger implementation footprint
  (new proto surface, new portfolio-side authz code) for a live-loop-only need; the synthetic-header
  approach reuses existing infra and is narrower in blast radius (bounded to accounts that already own
  a live-enabled strategy) even though it extends an already-open trust question rather than closing
  it.
- **A new `trading → analysis` synchronous edge at order-place time** (to validate `strategy_id`
  ownership before accepting an order) — rejected: a hard runtime dependency from order-placement
  (money-moving, critical path) onto `analysis` (non-critical, has its own live loop and heavier
  query surface) is a reliability regression with no compensating benefit, since `order.user_id`
  itself is unauthenticated (TRADING-N1) — the check would be false security, not a real boundary.
- **A two-migration split (`013` nullable add, `014` NOT NULL+PK, bracketing a manual operator
  script)** — rejected: this repo's `/sdd-execute` produces one integration PR per feature and
  `db-migrator` applies all pending migrations for a service in one deploy run with no pause
  point — a genuine calendar-time gap between the two migrations cannot exist within one feature's
  deploy regardless of numbering, so the split protects nothing a single guarded migration doesn't
  already achieve via its hard-fail-on-missing-seed-value guard.
- **Passing `SEED_USER_ID` as a `psql`-style session variable** (`psql -v seed_user_id=...`) instead
  of `envsubst`-templating the file — considered and rejected: `golang-migrate` executes via its own
  driver, not `psql`, so this would mean bypassing `golang-migrate` entirely for this one file,
  reintroducing exactly the special-casing the design otherwise avoids.
- **Redirecting `ListStrategyDefinitions` to `ListStrategies`** instead of scoping it independently —
  rejected: the two RPCs return genuinely different shapes (`StrategyScore` cards vs. full
  `StrategyDefinition` authoring data); the browser cannot reconstruct one from the other.
- **`NOT_FOUND`-vs-`PERMISSION_DENIED` split for ownership misses** (matching the `indicators`
  formula-ownership precedent) — considered, and explicitly decided against by the user: uniform
  `PERMISSION_DENIED` is a stronger IDOR defense (no existence-probing via response code), at the
  cost of a deliberate, documented divergence from that precedent.

## Open Risks

- [ ] **Live-loop synthetic `x-user-id` impersonation is not a closed trust question** — extends the
  already-open `fundsignal_loop.py`'s admin-bit self-injection finding
  (`context-constitution-findings.md:15`) to identity impersonation. Requires a new/updated entry in
  that file before/alongside `/sdd-spec`. Target: the `live_loop.py` implementation step.
- [ ] **`envsubst '$SEED_USER_ID'`'s scoped-substitution behavior against the migration's `DO $$ ...
  $$` block must be verified against the actual rendered file content**, not assumed safe from the
  design alone — the design specifies the single-variable-allowlist form specifically to avoid this,
  but `/sdd-spec`/`/sdd-execute` must confirm the rendered output is correct before this ships.
  Target: the migration-013 implementation step.
- [ ] **Cross-user `WatchlistBinding` attribution regression for pre-existing bindings** (decision 10)
  is an accepted, unmitigated migration-time trade-off — no cleanup migration. Target: recorded as a
  named acceptance criterion at `/sdd-spec` time, not a follow-up feature.
- [ ] **The concrete seed `user_id` value is not yet supplied** (FR-5, Constitution F-04 — this design
  does not invent one). Must be provided by the operator before `/sdd-execute` runs migration `013`,
  and may legitimately differ between dev and prod given the per-environment env-var mechanism.
  Target: before the migration-013 implementation step's execution (not its spec-writing).

## Constitution Rules Touched

- **C-01** (zero-assumption/evidence-cited) — honored: every architectural claim above traces to a
  `recon.md` `path:line` citation or a direct code-verification finding surfaced during the 5-round
  debate (e.g. `run_backtest`'s missing `ctx` param, `set_live_enabled`'s missing `user_id` scoping,
  `docker-compose.yml`'s missing `SEED_USER_ID` — each corrected only after being caught by
  grep-verification, not assumed).
- **C-07** (migration naming/numbering) — honored: `013`/`014`/`015` sequenced against the confirmed
  next-free number (`012` was the last existing file); each renumbering during the debate was
  re-verified against the live directory listing, not assumed stable.
- **C-10(a)** (duplicated surface, every instance updated) — honored: the `SetStrategyLive` admin
  gate's second BFF call site (`traderBff.ts:124`), missed in an earlier round, is now named
  explicitly alongside `insightsBff.ts`'s.
- **C-10(c)** (seeded/shared-resource governance) — honored: the FR-5 seed user's protection question
  is explicitly decided (decision 9), not left implicit; the deliberate `PERMISSION_DENIED`-uniform
  divergence from the `indicators` precedent is likewise recorded as a considered choice, not an
  accidental inconsistency.
- **C-14** (consumer surface named and reached) — honored: both the UI (`/insights`, `/trader`) and
  Agent (5 MCP tools) surfaces are named with concrete per-file changes, not left as "the backing
  service changes, the surface follows automatically" without verification (the agent's `_metadata()`
  gap specifically would have silently broken all 5 tools had it not been named).
- **F-01** (never edit an applied migration) — honored: the per-environment seed value reaches the
  migration via a runtime-templated env var, never a literal edited into the committed file; the
  file's committed text is identical across every environment.
- **F-04** (never invent a file path/symbol/value) — honored: the seed `user_id` itself is never
  invented — FR-5 requires the operator to supply it, recorded as an Open Risk above, not defaulted.
- **F-11** (Floor rejection halts) — no Floor breach was found at any of the 5 rounds or the final
  verification pass; several findings were severity-equivalent in impact (the `set_live_enabled`
  cross-tenant write bug, the migration mechanism's unmet dev/prod requirement) and were resolved as
  concrete fixes before this design was written, not waived.

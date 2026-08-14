# Implementation Spec: strategy-user-ownership

**Status**: `pending`
**Created**: 2026-08-14
**Feature**: `docs/roadmap/features/133-strategy-user-ownership/feature.md`
**Total Steps**: 17
**Feature Branch**: `feature/strategy-user-ownership`

---

## Execution Summary

Follows design.md's Chosen Approach end-to-end. Order: proto field → codegen → three analysis
migrations (strategies PK, strategy_cooldowns PK, backtest_runs column) → the migration-tooling
wiring that lets migration `013` template a per-environment seed user → analysis repos → analysis
servicer ownership gating (delete the server-side admin gate, resolve ownership at RPC + SQL layers)
→ analysis live-loop + entry-backfill owner-keying and the synthetic-header mechanism → analysis
tests → agent tools/client (forward real `x-user-id`, add missing `ctx`, wrap `run_backtest`) →
agent tests → UI BFF de-admin-gating (`/insights` + `/trader` consumer surfaces) → UI cross-user
isolation e2e → same-PR doc corrections + the required `context-constitution-findings.md` entry.

**No `xstockstrat-trading` step** (FR-2 trading companion): recon confirmed `trading.proto`'s
`Order`/`PlaceOrderRequest`/`ListOrdersRequest` already carry `user_id` alongside `strategy_id`
(`recon.md` Dependencies), and design.md decision 8 closes the trading fork as attribution-only —
`order.user_id` is itself unauthenticated (TRADING-N1, still open), so a strategy-ownership check
layered on it would be false security. No trading code changes.

**No `xstockstrat-portfolio` step**: design.md decision 6 rejected the new admin-scoped
`ListWatchlists` RPC variant in favor of a synthetic outbound `x-user-id` header from `live_loop.py`
— zero portfolio-side change (`ListPositionsRequest.user_id` already exists; `ListWatchlists` stays
header-derived).

**Consumer surfaces (C-14).** UI `/insights` strategy pages reach the change through existing
`forward()`-wrapped BFF calls (Step 15 removes the now-wrong admin gates; `getStrategy`/
`listStrategyDefinitions` need no code change — the header already flows via `bffShared.ts`). Agent's
5 MCP tools are covered by Step 13. The one net-new UI behavior (a user never sees another user's
strategies) is proven by the Step 16 cross-user e2e.

## Step Dependencies

- Step 2 (proto-gen) requires Step 1 (proto).
- Steps 3/4/5 (migrations) require Step 2 only in that the seed backfill and the new columns must
  match the proto field — but the SQL itself is independent; author them after the proto is fixed.
- Step 4 (strategy_cooldowns backfill) requires Step 3 (its `UPDATE … FROM analysis.strategies`
  relies on `013` having populated `strategies.user_id`); Step 5 likewise reads `strategies.user_id`.
- Step 6 (migration tooling) must land with/before Step 3 — migration `013`'s guard hard-fails if
  `SEED_USER_ID` is unset, and every local `docker compose up` runs the migrator (design.md
  decision 2). It is offline-verifiable (grep only).
- Step 7 (repos) precedes Step 8 (servicer) — the servicer calls the new
  `get_by_owner_and_id`/`user_id`-scoped repo methods.
- Step 9 (live-loop + entry-backfill) requires Step 3/4 (rows now carry `user_id`) and Step 7.
- Step 10 [test] covers Steps 7/8/9 (analysis service).
- Step 12 [test] covers Steps 11/13-agent? No: Step 12 covers Step 11 (agent).
- Step 14 [test] covers Step 13 (agent) — folded: see Step 12 note. (Agent has one test step, Step 12,
  covering Steps 11.) Step 13 is UI (no coverage threshold; Step 16 e2e covers it).
- Step 16 [test] covers Step 15 (UI BFF).
- **Open Risk carried from design.md — live-loop symbol universe.** design.md decision 6 commits
  `live_loop.py` to resolving each strategy's owner-scoped universe via
  `ListPositions(user_id=owner)` + a synthetic-`x-user-id` `ListWatchlists`, and AC-4 requires the
  loop to evaluate against the owner's own `union(watchlist, held, active-signal)`. The current loop
  reads only `signal_params.symbols` (`live_loop.py:37-47,208-210`) and feature 089's
  `SetStrategyLive` precondition rejects a no-symbols strategy (`servicer.py:1838-1843`). **The exact
  composition of the owner-union with the existing `signal_params.symbols` firing contract is
  under-specified in design.md decision 6** — Step 9's Instructions flag this as an explicit
  execute-time confirmation point (behavior #1 / P-03: surface, don't silently guess). This does not
  block the owner-keying half of Step 9, which is unambiguous.

---

### Step 1 — proto: add `user_id` to `StrategyDefinition`

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/analysis/v1/analysis.proto` — modify

**Reviewers**: Proto Reviewer — field number uniqueness, no breaking change without deprecation, `buf breaking` vs dev trunk; `xstockstrat-analysis` owner — strategy-identity contract

**Codebase Evidence**:
- `message StrategyDefinition` at `analysis.proto:249-274`; highest field today is
  `optional int32 exit_cooldown_days = 11;` (`:273`). Field `12` is unused in trunk (confirmed by
  reading the message) but is **reserved by feature 132 for `denied_symbols`** (design.md decision 1,
  FR-6) — this feature must take `13`.
- Ownership-from-header convention to mirror in the field comment:
  `analysis.proto` `ListOpportunitiesRequest`/`SetOpportunityActionRequest` (`recon.md` cites
  `:494-495,521-522`) and `portfolio.proto:18-19,193-194`.

**TDD**: `N/A (proto)`

**Instructions**:
1. Add, after `optional int32 exit_cooldown_days = 11;` (`analysis.proto:273`), inside
   `StrategyDefinition`:
   ```proto
   // Owning user (feature 133). Server-authoritative: populated from the propagated
   // x-user-id header on ManageStrategy REGISTER, never accepted from the request body
   // (mirrors ListOpportunitiesRequest / portfolio ownership convention). Field 12 is
   // reserved for feature 132's denied_symbols — do not reuse.
   string user_id = 13;
   ```
2. Do **not** touch `ListStrategiesRequest.user_id` (field 2, `analysis.proto:223`) here — its
   removal from the filter path is a handler/BFF change (Steps 8/15), not a proto edit (design.md
   decision 3: "removed from the write/filter path, not repurposed"; the wire field itself stays for
   backward compatibility per the deprecate-don't-delete rule).

**Verification**:
```bash
cd packages/proto && buf lint && buf breaking --against ".git#branch=feature/strategy-user-ownership"
grep -n "string user_id = 13;" packages/proto/analysis/v1/analysis.proto
```
(On the first commit `buf breaking` has no prior ref for the field; the additive `string` field is
non-breaking at the wire level — the behavioral break is documented in feature.md's approval gate.)

---

### Step 2 — proto-gen: regenerate stubs

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/**` — modify (generated; never hand-edit)

**Reviewers**: Proto Reviewer — inherited from Step 1; `xstockstrat-analysis` owner

**Codebase Evidence**:
- Codegen entrypoint: `./scripts/buf-gen.sh` (root `CLAUDE.md` § Generating Proto Stubs). Provision
  the toolchain first if Docker/egress is unavailable (`docs/runbooks/codegen-toolchain-host-setup.md`).

**TDD**: `N/A (proto-gen)`

**Instructions**:
1. Run `./scripts/buf-gen.sh` (generates TS + Python + Go stubs and compiles the TS package).
2. Stage only the regenerated `packages/proto/gen/**` output — no hand edits.

**Verification**:
```bash
./scripts/buf-gen.sh && git diff --stat packages/proto/gen/ | tail -1
# Confirm StrategyDefinition.user_id is present in the Python + TS stubs (do NOT Read gen/ directly —
# rely on the compile + the analysis/agent/UI code using it in later steps to build).
```

---

### Step 3 — migration: `013` add `user_id` to `analysis.strategies`, composite PK

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/migrations/013_strategies_user_id.up.sql` — create
- `services/xstockstrat-analysis/migrations/013_strategies_user_id.down.sql` — create

**Reviewers**: DBA — NNN numbering, up+down pair, PK change safety, seed-backfill guard;
`xstockstrat-analysis` owner — strategy-identity contract

**Codebase Evidence**:
- Last migration is `012_strategy_cooldowns_last_entry_at.up.sql` (confirmed via
  `ls services/xstockstrat-analysis/migrations/`) → next is **013**.
- Current schema: `analysis.strategies` has `strategy_id TEXT PRIMARY KEY` and **no** `user_id`
  (`migrations/001_strategies.up.sql:1-8`); index `idx_strategies_active` on `(active)` (`:10`).
- Composite-PK precedent to model on: `analysis.opportunities` `PRIMARY KEY (user_id, opportunity_key)`
  (design.md decision 1, `migrations/011_opportunities.up.sql`).
- Seed-value mechanism: per-environment env var `${SEED_USER_ID}` templated by scoped `envsubst`
  (Step 6), never a file literal (design.md decision 2, F-01). The bare-`envsubst`-corrupts-`DO $$`
  trap is a recorded fail (`fails.md` 2026-08-05 `do-nginx-integration`) — the guard below is
  belt-and-suspenders against a direct `migrate` bypass.
- No-silent-default rule: `fails.md` 2026-08-05 `add-ikbr-account-support` (`user_id="default"`
  failed invisibly) → the guard must `RAISE EXCEPTION`, never fall back to a sentinel.

**TDD**: `N/A (migration)`

**Instructions**:
1. `.up.sql` — one transactional file, in this order (design.md decision 2):
   ```sql
   ALTER TABLE analysis.strategies ADD COLUMN IF NOT EXISTS user_id TEXT;

   DO $$
   DECLARE
     seed TEXT := '${SEED_USER_ID}';
     missing INT;
   BEGIN
     SELECT count(*) INTO missing FROM analysis.strategies WHERE user_id IS NULL;
     IF missing > 0 THEN
       IF seed IS NULL OR seed = '' OR seed LIKE '%$' || '{%' THEN
         RAISE EXCEPTION 'migration 013: % strategy rows need an owner but SEED_USER_ID is unset/unrendered (got "%")', missing, seed;
       END IF;
       UPDATE analysis.strategies SET user_id = seed WHERE user_id IS NULL;
     END IF;
   END $$;

   ALTER TABLE analysis.strategies ALTER COLUMN user_id SET NOT NULL;
   ALTER TABLE analysis.strategies DROP CONSTRAINT strategies_pkey;
   ALTER TABLE analysis.strategies ADD PRIMARY KEY (user_id, strategy_id);
   ```
   - Note the `seed LIKE '%$' || '{%'` guard catches an un-rendered `${SEED_USER_ID}` literal (a
     direct `migrate` invocation that bypassed the Step-6 `envsubst`). Write the `${` check split so
     the guard text itself is not substituted by `envsubst`.
   - Verify the exact existing PK constraint name before writing `DROP CONSTRAINT` — Postgres names a
     single-column PK `strategies_pkey` by default; confirm at execute time with `\d analysis.strategies`
     in a scratch DB or by reading `001` (which uses inline `PRIMARY KEY`, so the default name applies).
2. `.down.sql` — reverse: drop the composite PK, restore `PRIMARY KEY (strategy_id)`, drop the
   `user_id` column:
   ```sql
   ALTER TABLE analysis.strategies DROP CONSTRAINT strategies_pkey;
   ALTER TABLE analysis.strategies ADD PRIMARY KEY (strategy_id);
   ALTER TABLE analysis.strategies DROP COLUMN IF EXISTS user_id;
   ```
   (A `strategy_id`-only PK is only restorable if no two rows share a `strategy_id` — acceptable for
   a rollback that is undoing the same-deploy migration before duplicates can be created.)

**Verification** (offline, no DB — per spec-template rule):
```bash
ls services/xstockstrat-analysis/migrations/013_strategies_user_id.up.sql \
   services/xstockstrat-analysis/migrations/013_strategies_user_id.down.sql
# Read both: confirm every ADD COLUMN / SET NOT NULL / ADD PRIMARY KEY in .up has an inverse in .down;
# confirm the DO block RAISEs (no silent default) and references ${SEED_USER_ID}.
```

---

### Step 4 — migration: `014` add `user_id` to `analysis.strategy_cooldowns`, composite PK

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/migrations/014_strategy_cooldowns_user_id.up.sql` — create
- `services/xstockstrat-analysis/migrations/014_strategy_cooldowns_user_id.down.sql` — create

**Reviewers**: DBA — NNN numbering, up+down pair, PK change; `xstockstrat-analysis` owner

**Codebase Evidence**:
- `analysis.strategy_cooldowns` today: `PRIMARY KEY (strategy_id, symbol)`, columns `strategy_id`,
  `symbol`, `last_exit_at` (nullable as of `012`), `last_entry_at`
  (`migrations/009_strategy_cooldowns.up.sql:6-11`, `012_strategy_cooldowns_last_entry_at.up.sql:5,16`).
- Backfill is purely mechanical (design.md decision 2): by the time `014` runs, `013` has guaranteed
  every `analysis.strategies` row has a non-null `user_id` — no operator step for this one.

**TDD**: `N/A (migration)`

**Instructions**:
1. `.up.sql`:
   ```sql
   ALTER TABLE analysis.strategy_cooldowns ADD COLUMN IF NOT EXISTS user_id TEXT;
   UPDATE analysis.strategy_cooldowns c
      SET user_id = s.user_id
     FROM analysis.strategies s
    WHERE c.strategy_id = s.strategy_id AND c.user_id IS NULL;
   -- Any cooldown row whose strategy_id no longer resolves is orphaned pre-feature state; delete it
   -- rather than leave a NOT NULL violation (these are live-loop cache rows, safe to drop).
   DELETE FROM analysis.strategy_cooldowns WHERE user_id IS NULL;
   ALTER TABLE analysis.strategy_cooldowns ALTER COLUMN user_id SET NOT NULL;
   ALTER TABLE analysis.strategy_cooldowns DROP CONSTRAINT strategy_cooldowns_pkey;
   ALTER TABLE analysis.strategy_cooldowns ADD PRIMARY KEY (user_id, strategy_id, symbol);
   ```
   Confirm the existing PK name (`strategy_cooldowns_pkey` default, from `009`'s inline
   `PRIMARY KEY (strategy_id, symbol)`) at execute time.
2. `.down.sql`: drop composite PK, restore `PRIMARY KEY (strategy_id, symbol)`, drop `user_id`.

**Verification** (offline):
```bash
ls services/xstockstrat-analysis/migrations/014_strategy_cooldowns_user_id.up.sql \
   services/xstockstrat-analysis/migrations/014_strategy_cooldowns_user_id.down.sql
# Read both: confirm .down reverses .up (PK + column).
```

---

### Step 5 — migration: `015` add `user_id` column to `analysis.backtest_runs`

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/migrations/015_backtest_runs_user_id.up.sql` — create
- `services/xstockstrat-analysis/migrations/015_backtest_runs_user_id.down.sql` — create

**Reviewers**: DBA — NNN numbering, up+down pair, index correctness; `xstockstrat-analysis` owner

**Codebase Evidence**:
- `analysis.backtest_runs` PK is `backtest_id` (**not** `strategy_id`), with `strategy_id TEXT NOT NULL`
  as an ordinary column (`migrations/006_backtest_runs.up.sql:6-7`) — a plain column add, **no** PK
  change (design.md decision 2, `recon.md` Dependencies confirmed this).
- Existing history index: `idx_backtest_runs_strategy_completed (strategy_id, completed_at DESC)`
  (`006:24-25`).
- `recon.md` removed `opportunity_actions` (has `user_id`, no `strategy_id`) and `fundsignal_emitted`
  (has neither) from FR-2's audit — no migration for those; `opportunities` already has both.

**TDD**: `N/A (migration)`

**Instructions**:
1. `.up.sql`:
   ```sql
   ALTER TABLE analysis.backtest_runs ADD COLUMN IF NOT EXISTS user_id TEXT;
   UPDATE analysis.backtest_runs r
      SET user_id = s.user_id
     FROM analysis.strategies s
    WHERE r.strategy_id = s.strategy_id AND r.user_id IS NULL;
   ```
   Leave `user_id` **nullable** — a historical run whose `strategy_id` no longer resolves (or an
   inline/legacy-SMA run that never had a registered strategy) legitimately has no owner, and this
   table's rows are append-only history, not an ownership boundary (out-of-scope per product-spec's
   retroactive-reattribution exclusion). Do **not** add NOT NULL.
2. `.down.sql`: `ALTER TABLE analysis.backtest_runs DROP COLUMN IF EXISTS user_id;`

**Verification** (offline):
```bash
ls services/xstockstrat-analysis/migrations/015_backtest_runs_user_id.up.sql \
   services/xstockstrat-analysis/migrations/015_backtest_runs_user_id.down.sql
# Read both: confirm plain column add + drop, no PK change.
```

---

### Step 6 — service: migration-tooling — seed-user templating + `SEED_USER_ID` wiring

**Status**: `done`
**Service**: `xstockstrat-analysis` (migration tooling — repo-level scripts + deploy specs)
**Files**:
- `scripts/db-migrate.sh` — modify
- `scripts/Dockerfile.migrate` — modify
- `docker-compose.yml` — modify
- `.do/app.dev.yaml` — modify
- `.do/app.yaml` — modify
- `scripts/setup-env.sh` — modify
- `.env.example` — modify

**Reviewers**: DBA — migration run-order/tooling correctness; Platform Lead — cross-service deploy
config parity (`.do/app*.yaml` ↔ `docker-compose.yml`)

**Codebase Evidence**:
- `Dockerfile.migrate` base is `postgres:16-alpine` with only `RUN apk add --no-cache bash curl` —
  **no `gettext`/`envsubst`** today (`scripts/Dockerfile.migrate:3`).
- `db-migrate.sh` applies each service via `migrate -path "$dir" -database "$url" up` inside
  `migrate_service` (`scripts/db-migrate.sh:66-95`); analysis is the last invocation
  (`migrate_service "xstockstrat-analysis" "analysis"`, `:155`). There is **no existing `envsubst`
  invocation** anywhere in the script (design.md extra-verification finding).
- `db-migrator` env block, docker-compose: `environment: <<: *db-url` only
  (`docker-compose.yml:89-102`); the `&db-url` anchor is at `:22-23` (constructs `DATABASE_URL` from
  `POSTGRES_PASSWORD`). **No `SEED_USER_ID`** anywhere — every local `docker compose up` runs the
  migrator, so it must be added here or migration `013` breaks locally (design.md decision 2).
- `db-migrator` PRE_DEPLOY `envs:` blocks already exist: `.do/app.yaml:479-495` and
  `.do/app.dev.yaml:483-495` (each has `- key: DATABASE_URL … value: ${xstockstrat.DATABASE_URL}`).
- `setup-env.sh` has a reusable `prompt_value NAME DEFAULT DESCRIPTION [secret]` helper
  (`scripts/setup-env.sh:66-74`); secrets section around `:139` (`POSTGRES_PASSWORD`), `:188`
  (`JWT_SECRET`).
- `.env.example` sets `POSTGRES_PASSWORD` (`:23`), `JWT_SECRET` (`:35`).

**TDD**: `red-green required` — but this step is bash/YAML with no unit-test home; its gate is the
grep/parse verification below (no coverage threshold applies — see Step 10's note style).

**Instructions**:
1. `scripts/Dockerfile.migrate`: change the apk line to
   `RUN apk add --no-cache bash curl gettext` (adds `envsubst`).
2. `scripts/db-migrate.sh` `migrate_service`, in the `up)` case **only** and scoped to the analysis
   service and the `013` file: before the existing `migrate -path "$dir" -database "$url" up`, when
   `$svc == "xstockstrat-analysis"`, render `013_strategies_user_id.up.sql` into a scratch dir with
   the **single-variable allowlist** form and point `-path` at the scratch dir for that one run:
   ```bash
   # Seed-user templating for feature 133's migration 013 (analysis only).
   if [ "$svc" = "xstockstrat-analysis" ] && [ "$COMMAND" = "up" ]; then
     : "${SEED_USER_ID:?SEED_USER_ID is required to apply analysis migration 013 (strategy ownership backfill)}"
     scratch="$(mktemp -d)"; cp "$dir"/*.sql "$scratch"/
     envsubst '$SEED_USER_ID' < "$dir/013_strategies_user_id.up.sql" > "$scratch/013_strategies_user_id.up.sql"
     dir="$scratch"
   fi
   ```
   - Use `envsubst '$SEED_USER_ID'` (the allowlist form), **never** bare `envsubst` — bare would
     corrupt migration `013`'s own `DO $$ … $$` dollar-quoted block (`fails.md` 2026-08-05
     `do-nginx-integration`). Copy the whole migrations dir into the scratch dir first so
     golang-migrate still sees `.down.sql` and the other `NNN` files unchanged.
   - Verify the rendered output at execute time: `envsubst '$SEED_USER_ID' < …/013_*.up.sql` and
     confirm the `DO $$` block and `$$` terminators survive untouched (design.md Open Risk 2).
3. `docker-compose.yml` `db-migrator` `environment:` block: add
   `SEED_USER_ID: "${SEED_USER_ID:-}"` (or a required form) so a local run passes the value through
   from `.env`.
4. `.do/app.dev.yaml` and `.do/app.yaml` `db-migrator` `envs:` blocks: add a
   `- key: SEED_USER_ID / scope: RUN_TIME / value: <per-env seed>` entry. **Do not invent the value**
   (FR-5, F-04) — leave a placeholder the operator fills, and record the concrete value in
   `context.md`, not here. dev and prod may differ (design.md Open Risk 4).
5. `scripts/setup-env.sh`: add a `prompt_value SEED_USER_ID "" "Existing user id that pre-existing
   strategies are assigned to at migration time (feature 133)."` in the appropriate section, and
   write it into the generated `.env`.
6. `.env.example`: add a commented `SEED_USER_ID=` line documenting it as the migration-013 seed
   owner (operator-supplied; no default).

**Verification**:
```bash
grep -n "gettext" scripts/Dockerfile.migrate
grep -n "envsubst '\$SEED_USER_ID'" scripts/db-migrate.sh
grep -n "SEED_USER_ID" docker-compose.yml .do/app.dev.yaml .do/app.yaml scripts/setup-env.sh .env.example
bash -n scripts/db-migrate.sh   # syntax-check the script
```

---

### Step 7 — service: analysis repositories gain `user_id` scoping

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/repositories/strategies.py` — modify
- `services/xstockstrat-analysis/app/repositories/strategy_cooldowns.py` — modify
- `services/xstockstrat-analysis/app/repositories/backtest_runs.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — backtest reproducibility, concurrent write safety,
ownership scoping at the SQL layer

**Codebase Evidence**:
- `StrategiesRepository` (`strategies.py`): `get_by_id` (`:47-52`, `WHERE strategy_id = $1`),
  `create` (`:33-45`, INSERT of `(strategy_id, display_name, definition_json)`), `update_locked`
  (`:70-107`, `SELECT … FOR UPDATE` + UPDATE both `WHERE strategy_id = $1`), `set_live_enabled`
  (`:109-120`, bare `WHERE strategy_id = $1` — the cross-tenant write bug design.md decision 4
  names), `deactivate` (`:122-132`), `reactivate` (`:134-145`), `list` (`:147-161`, no `user_id`).
- `StrategyCooldownsRepository` (`strategy_cooldowns.py`): `upsert_exit` (`:27-38`), `upsert_entry`
  (`:40-51`), `list_all` (`:53-58`) — all keyed on `(strategy_id, symbol)`, `ON CONFLICT (strategy_id,
  symbol)`.
- `BacktestRunsRepository` (`backtest_runs.py`): `insert` INSERTs `(backtest_id, strategy_id, …)`
  (`:25`; there is **no** `create` method — re-spec 2026-08-14); `list_by_strategy` `WHERE strategy_id = $1` (`:66-74`).

**TDD**: `red-green required` (covered by Step 10)

**Instructions**:
1. `strategies.py`:
   - Add `async def get_by_owner_and_id(self, user_id: str, strategy_id: str) -> dict | None` doing
     `SELECT * FROM analysis.strategies WHERE user_id = $1 AND strategy_id = $2` (the owner-scoped
     twin of `get_by_id`). Keep `get_by_id` for callers that legitimately have no owner context
     (e.g. the live loop reads whole rows that already carry `user_id`), or remove it only if every
     caller is migrated — audit at execute time.
   - `create`: add a `user_id` param and include it in the INSERT column list + `RETURNING *`.
   - `update_locked`, `set_live_enabled`, `deactivate`, `reactivate`: add a `user_id` param and
     `AND user_id = $N` to **both** the `SELECT … FOR UPDATE` and the `UPDATE … WHERE` (design.md
     decision 4 — the RPC pre-check alone does not protect the write; `set_live_enabled` specifically
     must not flip `live_enabled` on every user's row sharing that id once the PK is composite).
   - `list`: add a `user_id` param and `WHERE user_id = $1` (AND'd with the existing
     `active = TRUE` filter when `include_inactive` is false); adjust the `$` placeholders and the
     `COUNT(*)` query accordingly (design.md decision 3 — `ListStrategies`/`ListStrategyDefinitions`
     filter by header-derived `user_id`).
2. `strategy_cooldowns.py`: add a `user_id` param to `upsert_exit`, `upsert_entry`; INSERT it and
   change `ON CONFLICT (strategy_id, symbol)` → `ON CONFLICT (user_id, strategy_id, symbol)`. Change
   `list_all` to also SELECT `user_id`.
3. `backtest_runs.py`: add a `user_id` param to `insert` (the real method name; INSERT the column, nullable OK per Step 5);
   leave `list_by_strategy`'s `strategy_id` filter but confirm its callers pass an owner-scoped id
   (the `ListBacktests` gate in Step 8 already rejects non-owners before this read).

**Verification**: see Step 10 (paired test: coverage + ruff).

---

### Step 8 — service: analysis servicer ownership gating

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — ownership gating on every strategy-scoped RPC incl.
`RunBacktest`, backtest reproducibility, no cross-user leak

**Codebase Evidence**:
- Role-only gate to delete from `ManageStrategy`/`SetStrategyLive`: `_has_admin_scope`
  (`servicer.py:188-202`) — a pure `x-access-scope & 0x04` check, unrelated to ownership. Called at
  `ManageStrategy` (`:1597`), `SetStrategyLive` (`:1805`), and `RunFundamentalsScan` (`:1936` —
  **out of scope, keep unchanged**; the static method itself is NOT deleted, design.md decision 4).
- The gated RPC set (design.md decision 3, mechanically derived): `RunBacktest` (`:284`, strategy
  lookup at `:341` `get_by_id(request.strategy_id_ref)`), `ScoreStrategy` (`:1231`, `get_by_id`
  `:1250`), `ListStrategies` (`:1532`, in-memory only today), `GetStrategyReport` (`:1536`),
  `ListBacktests` (`:1550`, `list_by_strategy` `:1562`), `ManageStrategy` (`:1595`; REGISTER dup
  check `get_by_id` `:1611`, UPDATE pre-fetch `:1662`, REACTIVATE `:1748`, DEACTIVATE `:1736`),
  `GetStrategy` (`:1766`, `get_by_id` `:1770`), `ListStrategyDefinitions` (`:1790`, `repo.list`
  `:1793`), `SetStrategyLive` (`:1803`; enable-path fetch `get_by_id` `:1826`, write
  `set_live_enabled` `:1845`), `EvaluateReadiness` (`:1959`, `get_by_id` `:1971`),
  `GetStrategyAnalytics` (`:2412`; internal `ListOrders` `:2458-2459`).
- Header extraction is inlined everywhere as
  `dict(context.invocation_metadata()).get("x-user-id", "")` (e.g. `:1923`, `:2009`, `:2330`, `:2426`)
  — design.md decision 3 adds a shared `_caller_user_id(context)` helper mirroring the agent's
  `_caller_user_id(ctx, …)` shape (`app/tools.py:107-122`).
- `GetStrategyAnalytics`'s `ListOrders(strategy_id=…)` at `:2458-2459` omits `user_id`; the request
  already has `user_id` in scope (`:2426`) and `ListOrdersRequest.user_id` is trading proto field 1
  (`recon.md`) — add `user_id=user_id` (design.md decision 5).
- WatchlistBinding resolution: `_load_strategy_definition` (`:2244-2258`) does bare
  `get_by_id(strategy_id)`; `_compute_opportunities` already has `user_id` in scope (`:2083`,
  `:2195` call site) — thread it in and switch to `get_by_owner_and_id` (design.md decision 10).
  Accept the documented regression: a pre-existing binding to a legacy `strategy_id` now owned by the
  seed user resolves to `None` for other users (design.md decision 10 / Open Risk 3 — see AC below).

**TDD**: `red-green required` (covered by Step 10)

**Instructions**:
1. Add a module/staticmethod helper `_caller_user_id(context) -> str` returning
   `dict(context.invocation_metadata()).get("x-user-id", "")`; a targeted RPC that resolves an empty
   caller id must `abort(PERMISSION_DENIED, …)` before touching a strategy (an unauthenticated
   caller can never own a row).
2. **Uniform-`PERMISSION_DENIED` ownership resolution** (design.md decision 3, user-ratified): for
   every targeted RPC above, replace the `get_by_id(<id>)` lookup with
   `get_by_owner_and_id(caller_user_id, <id>)` and, on `None`, `abort(PERMISSION_DENIED, "…")` —
   **never** `NOT_FOUND` (a caller must not learn from the code whether the id exists under another
   owner). Apply to: `RunBacktest` (the `strategy_id_ref` branch at `:341` only — the
   `inline_definition` branch references no stored strategy, leave it), `ScoreStrategy`,
   `GetStrategyReport`, `GetStrategy`, `EvaluateReadiness`, `ListBacktests` (resolve ownership before
   the history read), `SetStrategyLive`'s enable-path fetch.
3. `ManageStrategy` (`:1595`): **delete** the `_has_admin_scope` gate (`:1597-1599`). REGISTER opens
   to any authenticated caller — set `definition.user_id = caller_user_id` server-side (never trust
   the wire value), and change the duplicate check (`:1611`) to
   `get_by_owner_and_id(caller_user_id, definition.strategy_id)` so two users can each register the
   same `strategy_id` (AC-1). Pass `caller_user_id` into `create`. For UPDATE/DEACTIVATE/REACTIVATE,
   resolve ownership first (`get_by_owner_and_id`), pass `user_id` into `update_locked`/`deactivate`/
   `reactivate`, and abort `PERMISSION_DENIED` on a non-owned/missing row.
4. `SetStrategyLive` (`:1803`): **delete** the `_has_admin_scope` gate (`:1805-1807`). Resolve
   ownership via `get_by_owner_and_id` (reuse the already-fetched enable-path row rather than a
   second lookup — design.md decision 4), and pass `user_id` into `set_live_enabled`.
5. `ListStrategies` / `ListStrategyDefinitions`: filter by header-derived `user_id`. For
   `ListStrategyDefinitions`, pass `caller_user_id` into `repo.list(...)` (Step 7). For
   `ListStrategies` (`:1532-1534`, currently returns the whole in-memory `_strategies` dict), scope
   the returned scores to the caller's own strategies — audit how `_strategies` is keyed at execute
   time (it may need an owner cross-check against the repo). Do **not** read
   `ListStrategiesRequest.user_id` from the wire (design.md decision 3 — filtering stays header-only).
6. `GetStrategyAnalytics` (`:2412`): add `user_id=user_id` to the `ListOrders` call
   (`:2458-2459`) — reuse the already-resolved `user_id` (`:2426`) (design.md decision 5).
7. `_load_strategy_definition` (`:2244`): add a `user_id` param, thread `_compute_opportunities`'s
   own `user_id` through the call site (`:2195`), and switch the bare `get_by_id` (`:2254`) to
   `get_by_owner_and_id(user_id, strategy_id)` (design.md decision 10).

**Verification**: see Step 10.

---

### Step 9 — service: live-loop + entry-backfill owner-keying and identity mechanism

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/engine/live_loop.py` — modify
- `services/xstockstrat-analysis/app/engine/entry_backfill.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — live/replay parity, per-owner evaluation, no cross-user
alerting

**Codebase Evidence**:
- `live_loop.py` in-memory state dicts are all keyed `tuple[str, str] = (strategy_id, symbol)`:
  `_last_state` (`:134`), `_last_alert_ts` (`:135`), `_last_exit_at` (`:140`), `_last_entry_at`
  (`:145`), `_replayed` (`:146`), `_logged_unresolved` (`:147`). Key built at `:237`
  (`key = (definition.strategy_id, symbol)`) and in `hydrate_cooldowns` (`:162`).
- `_run_cycle` selects `SELECT * FROM analysis.strategies WHERE live_enabled = TRUE AND active = TRUE`
  (`:188-190`); each `row` now carries `user_id` (Step 3) → `_row_to_strategy_definition(dict(row))`
  (`:193`) reads it via the proto field (Step 1). The identity dependency is `definition.user_id`.
- Loop makes **zero** outbound metadata today on `GetBars` (`:220-227`) — the synthetic-header call
  is wholly new for this loop (`recon.md`).
- In-service precedent for the synthetic header: the opportunity daily-refresh pass sets
  `meta = [("x-user-id", uid)]` from a stored user id and passes it to `_compute_opportunities` →
  `_drain_watchlist_bindings`'s `ListWatchlists(metadata=…)` (`servicer.py:2312-2318`,
  `_drain_watchlist_bindings:2273-2280`). The fundsignal self-injection precedent is
  `fundsignal_loop.py:344-346` (`meta.append(("x-access-scope", "4"))`).
- `hydrate_cooldowns` (`:150-169`) reads `r["strategy_id"]`, `r["symbol"]`, `r["last_exit_at"]`,
  `r.get("last_entry_at")` from `cooldowns_repo.list_all()` — now also `r["user_id"]` (Step 7).
- `_write_cooldown`/`_write_entry_cooldown` (`:373-397`) call `upsert_exit`/`upsert_entry` with
  `key[0], key[1]` — become `key[0], key[1], key[2]` (user_id, strategy_id, symbol) after Step 7.
- `entry_backfill.py`: keys `(strategy_id, symbol)` at `:62`, writes `live_loop._last_state[key]`,
  `_last_entry_at[key]`, `_write_entry_cooldown(key, …)` at `:76-78`; iterates the same
  `live_enabled AND active` SELECT (`:57-58`) and `strategy_symbols(definition)` (`:83`). Its
  `ListOrders(strategy_id=…, symbol=…)` (`:67-69`) is owner-implicit via the order's own user_id
  (attribution-only, design.md decision 8) — but the in-memory key must match live_loop's new
  3-tuple shape.

**TDD**: `red-green required` (covered by Step 10)

**Instructions**:
1. **Owner-key all six state dicts** to `tuple[str, str, str] = (user_id, strategy_id, symbol)`.
   Source `user_id` from `definition.user_id` (each `_run_cycle` row carries it). Update:
   `_last_state`, `_last_alert_ts`, `_last_exit_at`, `_last_entry_at`, `_replayed`,
   `_logged_unresolved`, the `key = (…)` construction (`:237`), `hydrate_cooldowns` key (`:162`,
   now `(r["user_id"], r["strategy_id"], r["symbol"])`), and `_write_cooldown`/`_write_entry_cooldown`
   to pass `key[0], key[1], key[2]` into the Step-7 repo methods.
2. **entry_backfill.py**: mirror the 3-tuple key (`key = (definition.user_id, strategy_id, symbol)`
   at `:62,82-84`); pass `definition.user_id` through `_backfill_pair`. Keeps live/backfill keyspace
   parity (design.md decision 5 — otherwise the two components diverge silently).
3. **Owner-scoped symbol universe (FR-4 / AC-4, design.md decision 6)** — resolve each strategy's
   universe against its **own owner**: `ListPositions(user_id=<owner>)` (the field already exists on
   the request, no portfolio change) and `ListWatchlists` with a **synthetic outbound
   `x-user-id` = owner** metadata entry, mirroring `servicer.py:2312-2318`'s existing technique.
   **EXECUTE-TIME CONFIRMATION REQUIRED (behavior #1 / P-03):** design.md decision 6 commits to these
   owner-scoped calls but does not specify how the resolved owner-union composes with the current
   `signal_params.symbols`-only firing contract (`live_loop.py:37-47,208-210`) and feature 089's
   no-symbols `SetStrategyLive` precondition (`servicer.py:1838-1843`). Do **not** silently pick a
   composition — surface the options to the user before implementing this sub-step (owner-union
   *replaces* signal_params.symbols vs. *intersect/augment* vs. this feature only threads identity
   and 132 owns the union). The dict-owner-keying in sub-steps 1–2 is unambiguous and proceeds
   regardless.
4. If a new outbound gRPC call to portfolio is added (sub-step 3), it must still carry the
   `x-access-scope`/`x-trace-id` tuple alongside the synthetic `x-user-id` per header-propagation
   convention (`docs/patterns/header-propagation.md`) — cite the existing propagation shape when
   wiring it.

**Verification**: see Step 10. The header-propagation shape of any new portfolio call must be
grep-confirmed there.

---

### Step 10 — test: analysis service (Steps 7/8/9)

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_analysis_servicer.py` — modify
- `services/xstockstrat-analysis/tests/test_live_loop.py` — modify (if present; else the loop's own test file)
- `services/xstockstrat-analysis/tests/conftest.py` — modify (fixtures)

**Reviewers**: `xstockstrat-analysis` owner — coverage of ownership gating, cross-user isolation

**Codebase Evidence**:
- Existing tests stub the now-deleted gate: `svc._has_admin_scope = lambda …: True` at
  `test_analysis_servicer.py:1969, 1981, 2779, 2800, 2829, 2857, 2871, 2885` — each runs against a
  context with `x-access-scope` metadata but often no `x-user-id`; each needs its context fixture to
  supply `x-user-id` plus a `get_by_owner_and_id` stub returning a matching row for "should succeed"
  cases (design.md decision 11).
- Context fixtures already exist: `_admin_context`-style `ctx.invocation_metadata = MagicMock(...)`
  (`:588-590`, `:3383-3390` `_HEADERS = {"x-user-id": "u1", …}`) — reuse/extend these (C-13: Python
  fixtures live in `tests/conftest.py`).

**TDD**: `red-green required` — author the new negative-path tests to fail against the
pre-implementation tree (they assert `PERMISSION_DENIED` on a non-owned strategy, which today
returns data/NOT_FOUND).

**Instructions**:
1. Update the 8 `_has_admin_scope`-stub tests to the new ownership model: supply `x-user-id` in the
   context and stub `get_by_owner_and_id` (matching row → success).
2. Add negative-path tests (owner mismatch → `PERMISSION_DENIED`, uniform for
   nonexistent-and-other-owner) for `GetStrategy`, `RunBacktest` (strategy_id_ref), `SetStrategyLive`,
   `ManageStrategy` UPDATE/DEACTIVATE (AC-2).
3. Add an AC-1 test: two users register the same `strategy_id` without collision (composite PK).
4. Add an AC-3 test: `ListStrategies`/`ListStrategyDefinitions` for user A never returns user B's row.
5. Add an AC-4 test: a live-loop cycle over two owners with **non-overlapping** symbol sets alerts
   each owner only on their own coverage (per the sub-step-3 mechanism confirmed at execute time);
   at minimum assert the 3-tuple owner-keying isolates state between two users sharing a `strategy_id`.
6. Add a **named acceptance test for design.md Open Risk 3** (WatchlistBinding regression): a
   pre-existing binding to a legacy `strategy_id` now owned by a different user resolves to
   unattributed (`strategy_id=""`, `0/0`) rather than cross-attributing (design.md decision 10).

**Verification**:
```bash
cd services/xstockstrat-analysis && ruff check . && ruff format --check . \
  && pytest --cov=app --cov-fail-under=40
```

---

### Step 11 — service: agent — forward real `x-user-id`, add missing `ctx`, wrap `run_backtest`

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/client.py` — modify
- `services/xstockstrat-agent/app/tools.py` — modify

**Reviewers**: `xstockstrat-agent` owner — MCP tool contract stability, admin-scope forwarding,
`PERMISSION_DENIED` surfaced as a tool-level error

**Codebase Evidence**:
- `client.py:29-30` `_metadata()` returns `[]` unconditionally — the CRITICAL gap (`recon.md`): after
  analysis enforces ownership, all 5 tools break unless the agent forwards a real `x-user-id`.
- The 5 strategy client fns: `run_backtest` (`:227`, `RunBacktest` at `:278`), `manage_strategy`
  (`:396`, uses `meta = [*_metadata(), ("x-access-scope", str(access_scope))]` at `:451`),
  `get_strategy` (`:458`, `metadata=_metadata()` at `:476`), `list_strategy_definitions` (`:483`,
  `:491`), `set_strategy_live` (`:911`, `meta` at `:921`).
- Existing precedent for appending a caller id: `get_user_metadata` uses
  `metadata=[*_metadata(), ("x-user-id", user_id)]` (`client.py:857`) — reuse this exact shape.
- `tools.py`: `_caller_user_id(ctx, tool)` helper (`:109-122`). `run_backtest` (`:380`) has **no**
  `ctx: Context` param (`:380-386`); `get_strategy` (`:947`) and `list_strategies` (`:936`) also have
  **no** `ctx` (recon). `manage_strategy` (`:488-489`) and `set_strategy_live` (`:799-800`) already
  accept `ctx`. `run_backtest` has **no** `except grpc.aio.AioRpcError` (recon) — `_grpc_error_message`
  is the shared mapper (`tools.py:125-136`).
- The stale comment `# … the analysis ManageStrategy backend enforces the ADMIN bit, so a non-admin
  is rejected there.` at `tools.py:604` (design.md decision 12) — corrected in Step 17.

**TDD**: `red-green required` (covered by Step 12)

**Instructions**:
1. `client.py`: add a `user_id: str` parameter to each of the 5 strategy client fns and append
   `("x-user-id", user_id)` to their outbound metadata, following the `get_user_metadata` precedent
   (`:857`) — i.e. `metadata=[*_metadata(), ("x-user-id", user_id)]` for the read fns, and
   `meta = [*_metadata(), ("x-user-id", user_id), ("x-access-scope", str(access_scope))]` for
   `manage_strategy`/`set_strategy_live` (keep the existing access-scope tuple). **Do not** change
   `_metadata()`'s global signature — ~25 other call sites depend on it returning `[]`; the design's
   loose "`_metadata(ctx, tool_name)`" phrasing (decision 7) is realized here as per-fn `user_id`
   params matching the codebase's existing pattern.
2. `tools.py`: add `ctx: Context` as the first param of `run_backtest` (`:380`), `get_strategy`
   (`:947`), `list_strategies` (`:936`). In all 5 tools, resolve
   `user_id = _caller_user_id(ctx, "<tool>")` and pass it into the client fn.
3. `run_backtest` tool: wrap its client call in `try/except grpc.aio.AioRpcError` and map via
   `_grpc_error_message` (matching the other tools) so a `PERMISSION_DENIED` surfaces as a tool-level
   error, not an unwrapped exception (AC-6).

**Verification**: see Step 12.

---

### Step 12 — test: agent (Step 11)

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/` — modify (the tool tests; e.g. `test_tools_endpoint.py` / the
  per-tool test modules)

**Reviewers**: `xstockstrat-agent` owner — tool contract, `PERMISSION_DENIED` mapping

**Codebase Evidence**:
- Agent CI gate: `pytest --cov=app --cov-fail-under=40` + `ruff` (agent `CLAUDE.md` § Running Tests).
- Descriptor-parity / return-shape test precedent: `tests/test_backtest_view.py` (insights.md
  2026-08-02) — assert the tools now forward `x-user-id`.

**TDD**: `red-green required` — assert (against pre-impl tree, red) that each of the 5 tools forwards
`x-user-id` and that `run_backtest` maps `PERMISSION_DENIED` to a tool error (AC-6).

**Instructions**:
1. Add/extend tests asserting each of the 5 strategy tools passes `_caller_user_id(ctx, …)` into its
   client call and that the outbound metadata carries `("x-user-id", <caller>)`.
2. Add a test that `run_backtest` returns a tool-level error string (not a raised
   `AioRpcError`) when the backend replies `PERMISSION_DENIED`.

**Verification**:
```bash
cd services/xstockstrat-agent && ruff check . && ruff format --check . \
  && pytest --cov=app --cov-fail-under=40
```

---

### Step 13 — service: UI BFF — remove admin gates from strategy mutations (`/insights` + `/trader`)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/insightsBff.ts` — modify
- `services/xstockstrat-ui/src/lib/traderBff.ts` — modify

**Reviewers**: `xstockstrat-ui` owner — config/mutation safety, Connect-RPC call safety, no cross-user
data leak (the `forward`/`forwardAdmin`+userId IDOR guard invariant)

**Codebase Evidence**:
- `insightsBff.ts`: `manageStrategy` calls `requireAdminScope(claims)` on mutating ops (`:42-53`);
  `setStrategyLive` is `forwardAdmin(...)` (`:60`); `listStrategies` injects
  `{ ...req, userId: claims.user_id }` (`:28-34`) — the dead wire field design.md decision 3 removes.
  `getStrategy` (`:55`) and `listStrategyDefinitions` (`:56-58`) are already plain `forward()` — **no
  change** (header flows via `backendHeaders`/`bffShared.ts`).
- `traderBff.ts`: `setStrategyLive: forwardAdmin(...)` (`:124`) — the duplicated surface (design.md
  decision 4, C-10(a)).

**TDD**: `red-green required` — covered by the Step 16 e2e (UI has no unit coverage threshold; the
`node-test` vitest layer is scoped to `src/lib/**` — a BFF-router assertion may be added there if a
logic-only unit is natural, else the e2e is the gate).

**Instructions**:
1. `insightsBff.ts`:
   - `manageStrategy`: drop the `requireAdminScope`/`mutating` block (`:44-52`) — become a plain
     `forward((req, opts) => analysisClient.manageStrategy(req, opts))`, trusting the backend's
     `PERMISSION_DENIED` (design.md decision 4). Remove the now-unused `requireAdminScope`/
     `StrategyOperation` imports **only if** no other handler in the file still uses them (grep first).
   - `setStrategyLive`: `forwardAdmin` → `forward` (`:60`).
   - `listStrategies`: stop injecting `userId: claims.user_id` (`:31`) — send `req` as-is; the
     backend filters by the header (design.md decision 3). Keep `backendHeaders(claims, ctx)`.
2. `traderBff.ts`: `setStrategyLive` `forwardAdmin` → `forward` (`:124`); drop the `forwardAdmin`
   import if now unused in the file (grep).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint
grep -n "requireAdminScope\|forwardAdmin\|userId: claims.user_id" src/lib/insightsBff.ts
grep -n "forwardAdmin" src/lib/traderBff.ts
# manageStrategy/setStrategyLive no longer admin-gated; listStrategies no longer injects userId.
```

---

### Step 14 — test: UI second test-user fixture (infrastructure for Step 16)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/fixtures/users.ts` — modify
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify
- `services/xstockstrat-ui/e2e/helpers/auth.ts` — modify

**Reviewers**: `xstockstrat-ui` owner — test-data inventory (C-12)

**Codebase Evidence**:
- `recon.md`: `e2e/fixtures/users.ts` has only `TEST_USER_ID`/`TEST_USER_EMAIL`; `signTestJwt`
  hardcodes that single user (`e2e/helpers/auth.ts:27-38`). AC-2/3/4's cross-user tests need a second
  identity — this is **new test infrastructure**, not just new cases (C-12: a new domain fixture gets
  a module + `INVENTORY.md` row in the same step).

**TDD**: `N/A (test-fixture infrastructure)` — consumed by Step 16's red-green e2e.

**Instructions**:
1. Add a second user fixture (`TEST_USER_B_ID`/`TEST_USER_B_EMAIL`) to `e2e/fixtures/users.ts` and a
   catalog row in `INVENTORY.md`.
2. Generalize `signTestJwt` in `e2e/helpers/auth.ts` to sign for an arbitrary supplied user (keep the
   existing single-arg default for back-compat).

**Verification**:
```bash
grep -n "TEST_USER_B_ID\|TEST_USER_B_EMAIL" services/xstockstrat-ui/e2e/fixtures/users.ts
grep -n "TEST_USER_B" services/xstockstrat-ui/e2e/fixtures/INVENTORY.md
cd services/xstockstrat-ui && pnpm run lint
```

---

### Step 15 — test: UI cross-user strategy isolation e2e (covers Step 13, C-14 `/insights`)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/insights/strategy-ownership.spec.ts` — create
- `services/xstockstrat-ui/e2e/mock-backend.ts` — modify (owner-aware strategy handlers)

**Reviewers**: `xstockstrat-ui` owner — cross-user isolation, mock parity with proto

**Codebase Evidence**:
- Strategy pages: `src/app/insights/strategies/page.tsx` (list), `[id]/page.tsx` (detail),
  `[id]/edit/page.tsx`, `new/page.tsx` (confirmed via `ls`). No existing IDOR-style two-user e2e
  anywhere (`recon.md` Not-found).
- Mock backend: `e2e/mock-backend.ts` — must become owner-aware for `ListStrategyDefinitions`/
  `GetStrategy`/`ManageStrategy`/`SetStrategyLive` so it can return `PERMISSION_DENIED` for a
  non-owner (mirror the backend; C-12 — reuse fixtures from Step 14, not inline literals).

**TDD**: `red-green required` — the spec asserts user B cannot see or mutate user A's strategy; red
against the pre-Step-13 admin-gated tree.

**Instructions**:
1. Author `strategy-ownership.spec.ts`: user A registers/owns a strategy; user B's `/insights`
   strategy list never shows it (AC-3), and B's attempt to open/edit/set-live it surfaces the
   backend `PERMISSION_DENIED` (AC-2/AC-6). Use the Step-14 fixtures + `signTestJwt` for both users.
2. Make `mock-backend.ts` strategy handlers owner-scoped keyed on the propagated `x-user-id`.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm test:e2e -- strategy-ownership
```

---

### Step 16 — docs: strat-lab skill + agent/analysis doc corrections (same-PR)

**Status**: `pending`
**Service**: `docs` / plugins
**Files**:
- `plugins/strat-lab/skills/backtest/SKILL.md` — modify
- `services/xstockstrat-agent/CLAUDE.md` — modify
- `services/xstockstrat-agent/app/tools.py` — modify (comment only)
- `services/xstockstrat-analysis/CLAUDE.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- Root `CLAUDE.md` same-PR rule: a change to `run_backtest`/`manage_strategy`/`set_strategy_live` must
  update the `strat-lab` `backtest` skill in the same PR. The skill's Scope names those tools
  (`plugins/strat-lab/skills/backtest/SKILL.md:15-16`) and its Mutation guard (`:44-48`).
- Agent `CLAUDE.md` § Management-tool authorization lists `manage_strategy`/`set_strategy_live` among
  the tools that "hit a backend admin gate" — now false (design.md decision 12).
- `tools.py:604` comment "the analysis ManageStrategy backend enforces the ADMIN bit" — now false.
- Analysis `CLAUDE.md` describes `ManageStrategy`/`SetStrategyLive` as admin-scoped in several places.

**TDD**: `N/A (docs)`

**Instructions**:
1. `strat-lab` skill: add an ownership note — `manage_strategy`/`set_strategy_live`/`run_backtest`/
   `get_strategy` now operate only on the caller's **own** strategies; a non-owned `strategy_id`
   returns `PERMISSION_DENIED`. Correct any admin-gating language.
2. Agent `CLAUDE.md` § Management-tool authorization: move `manage_strategy`/`set_strategy_live` off
   the "backend admin gate" list; state they are now **ownership-gated** (any authenticated caller
   acts on their own strategies). Correct the `tools.py:604` comment accordingly.
3. Analysis `CLAUDE.md`: update `ManageStrategy`/`SetStrategyLive` descriptions from admin-scoped to
   ownership-scoped; note the composite `(user_id, strategy_id)` PK.
4. Run `/context-scrubber scan` scoped to the touched context files (root `CLAUDE.md` Teardown rule);
   fix grounded findings. If the context-forge plugin is unavailable, say so in the PR body.

**Verification**:
```bash
grep -n "ownership\|PERMISSION_DENIED" plugins/strat-lab/skills/backtest/SKILL.md
grep -n "admin gate\|ADMIN bit" services/xstockstrat-agent/CLAUDE.md services/xstockstrat-agent/app/tools.py
```

---

### Step 17 — docs: record the live-loop `x-user-id` impersonation finding (design.md Open Risk 1)

**Status**: `pending`
**Service**: `docs`
**Files**:
- `services/xstockstrat-analysis/docs/context-constitution-findings.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- Existing open finding this extends: `context-constitution-findings.md:15` — "⚠ security — The
  fundamentals background loop injects `x-access-scope=4` … Is a background loop self-granting the
  admin bit the intended trust model? … `fundsignal_loop.py:346`, `servicer.py:190-202` — status:
  **open**".
- design.md decision 6 / Open Risk 1: the live-loop synthetic `x-user-id` extends this same open
  trust question to identity impersonation — a required, recorded sign-off before this ships.

**TDD**: `N/A (docs)`

**Instructions**:
1. Add an open-question entry: `live_loop.py` sets a synthetic outbound `x-user-id` = a stored
   strategy owner on its `ListWatchlists` call (feature 133), a second un-JWT-verified origination
   point for that header alongside the BFF session origin — extends the existing admin-bit
   self-injection finding to identity impersonation. Cite `live_loop.py` (the new call site) and
   `servicer.py:2312-2318` (the pre-existing in-service precedent). Mark status **open**.

**Verification**:
```bash
grep -n "x-user-id\|live_loop\|feature 133" services/xstockstrat-analysis/docs/context-constitution-findings.md
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._

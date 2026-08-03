# Implementation Spec: opportunity-universe-unification

**Status**: `in-progress`
**Created**: 2026-08-03
**Feature**: `docs/roadmap/features/097-opportunity-universe-unification/feature.md`
**Total Steps**: 19
**Feature Branch**: `feature/opportunity-universe-unification`

---

## Execution Summary

Backend-to-surface, sequenced per the design's Chosen Approach. The proto contract lands first
(portfolio `Watchlist` bindings, analysis `Opportunity` stable-key + provenance, a new
`SetOpportunityAction` RPC), then codegen. Portfolio grows the `(symbol, strategy_id)` binding
(migration 008 + the re-plumbed write path). Analysis gains two migrations (010 `opportunity_actions`,
011 `opportunities`), the config keys, an additive exit-rule trace sibling on the readiness kernel, the
persisted-action repo + RPC, and the core materialization: `ListOpportunities` becomes a pure read over
a lazily-materialized `analysis.opportunities` table (compute-on-read + stale-while-revalidate + daily
refresh), with a real `queue_share` and a signal ranking axis. The signal blend is retired from the
`RunBacktest.strategy_params` scoring path **only** (`StrategyDefinition.signal_params` and the screener
are left untouched — ANALYSIS-3). Finally every consumer surface (C-14) moves in lockstep: the agent
builders gain descriptor-parity tests + doc reconciliation, and the UI gets server-persisted
snooze/dismiss/take, a per-symbol strategy-binding watchlist editor, and a de-blended Strategy wizard.

All eight design Open Risks (OR-A…OR-H) are resolved inline in the steps below (each cited at the point
it is honored).

## Step Dependencies

- Step 2 (proto-gen) requires Step 1 (proto): stubs are generated from the new `.proto`.
- Steps 3–19 require Step 2: every service consumes the regenerated stubs.
- Step 4 (portfolio service) requires Step 3 (migration 008): the write path reads/writes `strategy_id`.
- Step 5 [test] covers Step 4 [service] (portfolio).
- Steps 8, 10, 12, 14 (analysis service) require Step 6 (analysis migrations 010+011) and Step 7 (config keys).
- Step 8 (evaluator exit-rule sibling) is a prerequisite for Step 12 (held candidates are exit-traced).
- Step 10 (`opportunity_actions` repo + RPC) is a prerequisite for Step 12 (the read joins it) and Step 17 (UI snooze).
- Step 9 [test] covers Step 8; Step 11 [test] covers Step 10; Step 13 [test] covers Step 12; Step 15 [test] covers Step 14.
- Step 16 [test/docs] (agent) requires Step 2 (parity tests assert against regenerated descriptors) and Step 14 (docs reflect the retired blend).
- Steps 17–19 (UI) require Step 2 (typed client gains the new fields/RPC); Step 17 also requires Step 10/12 (persisted actions served + filtered).

**Consumer surfaces (C-14).** Product spec names **UI /insights** (Opportunities queue, Watchlist
editor, Strategy wizard) and **Agent** (`manage_strategy`/`screen_symbols` + strat-lab). Both are
covered: UI by Steps 17–19, Agent by Step 16. No route is *added* — the Opportunities page, Watchlist
editor, and Strategy wizard are all already nav-registered (Decide/Discover groups,
`src/components/shared/navGroups.tsx`); Steps 17–19 re-verify reachability per **C-10(a)** rather than
register a new route.

---

### Step 1 — proto: Watchlist bindings, Opportunity stable-key + provenance, SetOpportunityAction RPC

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/portfolio/v1/portfolio.proto` — modify
- `packages/proto/analysis/v1/analysis.proto` — modify

**Reviewers**: Proto Reviewer — field number uniqueness, no breaking change without deprecation, `buf breaking` vs dev trunk; `xstockstrat-portfolio` owner — Watchlist `(symbol, strategy)` binding shape; `xstockstrat-analysis` owner — Opportunity identity/provenance, readiness-kernel reuse

**Codebase Evidence**:
- `portfolio.Watchlist` at `packages/proto/portfolio/v1/portfolio.proto:168` — fields 1–7, `repeated string symbols = 5` (`:173`); next-free field **8** (confirmed by Read).
- CRUD request next-frees (confirmed by Read): `CreateWatchlistRequest:180` (fields 1–3, next-free **4**), `UpdateWatchlistRequest:205` (fields 1–4, next-free **5**), `AddWatchlistSymbolsRequest:220` (fields 1–2, next-free **3**). `RemoveWatchlistSymbolsRequest:228` stays symbol-only.
- `analysis.Opportunity` at `packages/proto/analysis/v1/analysis.proto:437` — fields 1–9, next-free **10** (`valid_until = 9` at `:446`).
- `OpportunityActionTag` at `:419` (ENTER/ADD/REDUCE — the **action tag**, distinct from the new snooze/dismiss/take enum below).
- `PortfolioService` RPC block at `packages/proto/portfolio/v1/portfolio.proto:10–26`; `AnalysisService` RPC block at `packages/proto/analysis/v1/analysis.proto:12–39`.
- Deprecate-don't-delete precedent: `docs/context-constitution.md` (proto invariant) — retain the field number + `[deprecated = true]`, never `reserved`.
- `analysis.proto` already imports `google/protobuf/timestamp.proto` (`:7`) — `snooze_until` reuses it.

**TDD**: `N/A (proto)` — verified by `buf lint`/`buf breaking`; behavior tested in the consuming steps.

**Instructions**:
1. In `portfolio.proto`, add a binding message near `Watchlist`:
   ```proto
   // A (symbol, strategy) binding — a ready-made Universe candidate (feature 097).
   message WatchlistBinding {
     string symbol = 1;
     string strategy_id = 2;  // "" = unbound (kept as a bare watched symbol)
   }
   ```
2. In `message Watchlist` (`:168`): mark the existing field `repeated string symbols = 5 [deprecated = true];` (keep the field, deprecate-don't-delete — it stays readable for old clients per FR-6) and add `repeated WatchlistBinding bindings = 8;` with a comment that `bindings` is the authoritative shape and `symbols` is the deprecated flat mirror.
3. Add `repeated WatchlistBinding bindings` to the write requests: `CreateWatchlistRequest` field **4**, `UpdateWatchlistRequest` field **5**, `AddWatchlistSymbolsRequest` field **3**. Comment that when `bindings` is present it is authoritative; the legacy `symbols` field remains accepted (unbound) for back-compat.
4. In `analysis.proto` `message Opportunity` (`:437`) add:
   ```proto
   string opportunity_key = 10;      // server-authoritative opaque key = user|symbol_norm|strategy_id (feature 097). Client echoes it verbatim to SetOpportunityAction, never derives it.
   repeated string provenance = 11;  // contributing origins for a de-duplicated row (signal source(s) / "position" / "watchlist")
   ```
5. Add the persisted-action enum + RPC surface to `analysis.proto` (name the enum `OpportunityAction` — deliberately distinct from `OpportunityActionTag`):
   ```proto
   // The persisted per-user disposition of a queued opportunity (feature 097). Closed set → enum (C-04).
   enum OpportunityAction {
     OPPORTUNITY_ACTION_UNSPECIFIED = 0;
     OPPORTUNITY_ACTION_SNOOZE = 1;   // hide until snooze_until (bounded)
     OPPORTUNITY_ACTION_DISMISS = 2;  // hide indefinitely
     OPPORTUNITY_ACTION_TAKE = 3;     // user acted on it (feeds queue_share/taken reconciliation)
   }
   message SetOpportunityActionRequest {
     string opportunity_key = 1;                       // the server-issued key, echoed verbatim
     OpportunityAction action = 2;
     google.protobuf.Timestamp snooze_until = 3;       // set only for SNOOZE; a bounded "snooze until"
   }
   message SetOpportunityActionResponse {}
   ```
   Add `rpc SetOpportunityAction(SetOpportunityActionRequest) returns (SetOpportunityActionResponse);` to `AnalysisService` (after `EvaluateReadiness`, `:37`). `user_id` is intentionally absent — taken from the propagated `x-user-id` header server-side (match the `ListOpportunitiesRequest` convention comment at `:482`).
6. Do **not** touch `StrategyDefinition.signal_params = 6` (`:253`) or `ScreenSymbolsRequest.signal_sources = 3`/`signal_weight = 4` (`:381–382`) — the design (§ Chosen Approach / § Rejected Alternatives) confirms the signal-blend retirement is a *code* change to the `RunBacktest.strategy_params` read only, not a proto deprecation (ANALYSIS-3: `signal_params` is the live-loop symbol universe + in the 065 fingerprint).

**Verification**:
```bash
cd packages/proto && buf lint && buf breaking . --against ".git#branch=main-dev,subdir=packages/proto"
```
Both pass — adding fields/messages/RPCs and marking `symbols = 5 [deprecated = true]` (field retained) is non-breaking.

---

### Step 2 — proto-gen: regenerate stubs

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/**` — modify (generated; do not hand-edit)

**Reviewers**: Proto Reviewer — same as Step 1 (inherited); `xstockstrat-portfolio` owner; `xstockstrat-analysis` owner

**Codebase Evidence**:
- Codegen entrypoint: `scripts/buf-gen.sh` (root CLAUDE.md § Generating Proto Stubs); freshness enforced by CI `proto-freshness`.
- Toolchain-on-host fallback: `docs/runbooks/codegen-toolchain-host-setup.md` (when Docker/GitHub-releases egress is blocked).

**TDD**: `N/A (proto-gen)`.

**Instructions**:
1. Run `./scripts/buf-gen.sh` from the repo root. This regenerates Go, Python, and TS stubs and compiles the TS package (`gen/ts/dist/`).
2. Commit the proto source (Step 1) **and** the regenerated stubs together — the same commit boundary CI's `proto-freshness` expects.

**Verification**:
```bash
./scripts/buf-gen.sh && git diff --exit-code packages/proto/gen/
```
Empty diff after generation confirms committed stubs match the protos.

---

### Step 3 — migration: portfolio 008 — watchlist_symbols.strategy_id

**Status**: `done`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/migrations/008_watchlist_symbol_strategy.up.sql` — create
- `services/xstockstrat-portfolio/migrations/008_watchlist_symbol_strategy.down.sql` — create

**Reviewers**: DBA — migration NNN numbering, up+down pair, index correctness; `xstockstrat-portfolio` owner — watchlist binding shape

**Codebase Evidence**:
- Last portfolio migration is `007_watchlists` (confirmed `ls services/xstockstrat-portfolio/migrations/` → next-free **008**). OR-H numbering resolved.
- `portfolio.watchlist_symbols` created at `services/xstockstrat-portfolio/migrations/007_watchlists.up.sql:16–21` — `(watchlist_id, symbol)` PK, columns `watchlist_id`, `symbol`, `added_at`; **no `strategy_id`**.

**TDD**: `N/A (migration)` — offline file inspection only; the real apply/rollback runs in CI/deploy.

**Instructions**:
1. `008_watchlist_symbol_strategy.up.sql`: `ALTER TABLE portfolio.watchlist_symbols ADD COLUMN IF NOT EXISTS strategy_id TEXT NOT NULL DEFAULT '';` (empty string = unbound, matching the proto comment). The `(watchlist_id, symbol)` PK is unchanged — one binding per (list, symbol), per design R (watchlist→strategy cardinality: one strategy per `(watchlist, symbol)`).
2. `008_...down.sql`: `ALTER TABLE portfolio.watchlist_symbols DROP COLUMN IF EXISTS strategy_id;`
3. Header both files with the `-- Migration:` / `-- Service:` comment block matching `007_watchlists.up.sql`.

**Verification**:
```bash
ls services/xstockstrat-portfolio/migrations/008_watchlist_symbol_strategy.up.sql \
   services/xstockstrat-portfolio/migrations/008_watchlist_symbol_strategy.down.sql
# Read both: the .down DROP COLUMN reverses the .up ADD COLUMN by inspection.
```

---

### Step 4 — service: portfolio watchlist binding write/read path

**Status**: `done`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/repository/watchlist_repo.go` — modify
- `services/xstockstrat-portfolio/internal/service/portfolio_service.go` — modify
- `services/xstockstrat-portfolio/internal/handler/portfolio_handler.go` — modify

**Reviewers**: `xstockstrat-portfolio` owner — watchlist binding shape, concurrent write safety, ownership enforcement

**Codebase Evidence**:
- `insertSymbolsTx` at `watchlist_repo.go:248` — `INSERT INTO portfolio.watchlist_symbols (watchlist_id, symbol) …` (`:251`); called by `Create:51`, `Update:145` (after a `DELETE … WHERE watchlist_id` replace at `:142`), `AddSymbols:177`.
- `listSymbols` at `watchlist_repo.go:217` — `SELECT symbol FROM portfolio.watchlist_symbols WHERE watchlist_id = $1 ORDER BY symbol ASC` (no `strategy_id`).
- `scanWatchlist` at `watchlist_repo.go:260`; repo methods return `*portfoliov1.Watchlist`.
- `normalizeSymbols` at `portfolio_service.go:1061` (uppercase/trim/dedup, first-seen order); `requireUserID:1087`, `loadOwned:1097`; `CreateWatchlist:1115` calls `normalizeSymbols(req.GetSymbols())` at `:1123`.
- Handlers `portfolio_handler.go:132–186` map RPC ↔ service.
- **fails.md 2026-07-29 (080) trap**: a bare-`symbols` write must not reset `strategy_id=''`. The re-plumb must carry `(symbol, strategy_id)` pairs through the write path so a `bindings`-aware caller preserves the binding.

**TDD**: `red-green required`.

**Instructions**:
1. Introduce a normalized binding type in the service layer (e.g. `type symbolBinding struct{ Symbol, StrategyID string }`) and a `normalizeBindings([]*portfoliov1.WatchlistBinding) []symbolBinding` mirroring `normalizeSymbols` (uppercase symbol, trim, dedup by symbol first-seen; keep the strategy_id of the first occurrence). Reuse `normalizeSymbols` for the legacy flat path.
2. Request handling for `Create`/`Update`/`AddWatchlistSymbols`: when `req.GetBindings()` is non-empty, use it as authoritative; else fall back to `req.GetSymbols()` mapped to `{symbol, strategy_id:""}` (back-compat). This is the write-path re-plumb the 080 trap requires — a `bindings` write carries the strategy through, and a legacy `symbols` write no longer silently clears it (a `symbols`-only write only touches the symbols it names).
3. Repo: change `insertSymbolsTx` to accept and insert `(watchlist_id, symbol, strategy_id)` triples (`INSERT INTO portfolio.watchlist_symbols (watchlist_id, symbol, strategy_id) …`). Update `Create`/`Update`/`AddSymbols` signatures to pass bindings. `Update`'s `DELETE`+re-insert replace semantics stay, now re-inserting the bindings.
4. `listSymbols` → also select `strategy_id` and populate a new `bindings` slice; keep populating the deprecated flat `symbols` list (the symbol column) so old readers still work. `scanWatchlist` sets both `Symbols` and `Bindings` on the returned `*portfoliov1.Watchlist`.
5. `RemoveWatchlistSymbols` stays symbol-keyed (deletes by symbol regardless of binding).
6. Preserve ownership: all paths keep going through `requireUserID`/`loadOwned` (`:1087`/`:1097`).
7. No new outbound gRPC call is added (header-propagation gate N/A — this is inbound handling only).

**Verification**:
```bash
cd services/xstockstrat-portfolio && GOWORK=off golangci-lint run --modules-download-mode=mod
```
(Coverage/behavioral gate in the paired Step 5.)

---

### Step 5 — test: portfolio watchlist binding round-trip

**Status**: `done`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/watchlist_service_test.go` — modify

**Reviewers**: `xstockstrat-portfolio` owner — binding correctness, concurrent write safety

**Codebase Evidence**:
- Existing watchlist service tests: `services/xstockstrat-portfolio/internal/service/watchlist_service_test.go` (confirmed present); repo test `internal/repository/watchlist_repo_test.go` pattern (adjacent).
- C-13: Go domain fixtures live in `internal/testdata/`; a symbol/strategy literal here is a single test-file consumer → inline is compliant (no second consumer; do not create a fixture home speculatively).

**TDD**: `red-green required` — assert the new binding behavior; red against the pre-Step-4 tree.

**Instructions**:
1. `CreateWatchlist` with `bindings=[{AAPL, strat-x}, {MSFT, ""}]` → `GetWatchlist` returns those bindings and the flat `symbols` mirror `[AAPL, MSFT]`.
2. **080-trap regression**: `AddWatchlistSymbols(bindings=[{AAPL, strat-x}])` then a subsequent `AddWatchlistSymbols(symbols=[MSFT])` (legacy flat) leaves AAPL's `strategy_id` intact (still `strat-x`).
3. `UpdateWatchlist` replace with new bindings replaces the set (old bindings gone, new present).
4. Ownership: a second user's `GetWatchlist` on the first user's list → `PermissionDenied` (unchanged).

**Verification**:
```bash
cd services/xstockstrat-portfolio && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"
```
Confirm ≥ 40%. Note: the watchlist logic lives in `service/`/`repository/` (excluded from CI coverage measurement); the tests are still required (they prove the binding behavior) — record that the threshold is carried by other packages and these tests are integration-level verification.

---

### Step 6 — migration: analysis 010 opportunity_actions + 011 opportunities

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/migrations/010_opportunity_actions.up.sql` — create
- `services/xstockstrat-analysis/migrations/010_opportunity_actions.down.sql` — create
- `services/xstockstrat-analysis/migrations/011_opportunities.up.sql` — create
- `services/xstockstrat-analysis/migrations/011_opportunities.down.sql` — create

**Reviewers**: DBA — NNN numbering, up+down pairs, index correctness; `xstockstrat-analysis` owner — schema shape, no new pool

**Codebase Evidence**:
- Last analysis migration is `009_strategy_cooldowns` (confirmed `ls services/xstockstrat-analysis/migrations/` → next-free **010**). OR-H run order: 010 then 011 (011's daily-refresh reader unions both tables); portfolio 008 is independent. Both reuse the existing asyncpg pool — no new pool (F-06; `main.py:48`).
- Repo/pool pattern to reuse: `app/repositories/backtest_runs.py` (`__init__(self, db_pool)`, `fetchrow`/`fetch`); `main.py:147,155` wire repos from `db_pool`.

**TDD**: `N/A (migration)` — offline file inspection.

**Instructions**:
1. `010_opportunity_actions.up.sql`: create `analysis.opportunity_actions` with `user_id TEXT NOT NULL`, `opportunity_key TEXT NOT NULL`, `action SMALLINT NOT NULL` (stores the `OpportunityAction` enum number), `snooze_until TIMESTAMPTZ NULL`, `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`, `PRIMARY KEY (user_id, opportunity_key)` (design § Persisted actions). `.down`: `DROP TABLE IF EXISTS analysis.opportunity_actions;`
2. `011_opportunities.up.sql`: create `analysis.opportunities` with `user_id TEXT NOT NULL`, `opportunity_key TEXT NOT NULL`, `symbol TEXT NOT NULL`, `strategy_id TEXT NOT NULL DEFAULT ''`, `action SMALLINT NOT NULL` (the `OpportunityActionTag` number), `conviction DOUBLE PRECISION NOT NULL DEFAULT 0`, `readiness_json JSONB NOT NULL DEFAULT '{}'::jsonb` (passing/total + conviction ordinal + per-leaf trace — inline, superseding the rejected separate readiness_cache table), `signal_axis DOUBLE PRECISION NOT NULL DEFAULT 0` (the normalized signal ranking axis for OR-G), `provenance JSONB NOT NULL DEFAULT '[]'::jsonb`, `thesis TEXT NOT NULL DEFAULT ''`, `valid_until TIMESTAMPTZ NOT NULL`, `computed_at TIMESTAMPTZ NOT NULL DEFAULT now()`, `PRIMARY KEY (user_id, opportunity_key)`. Add `CREATE INDEX IF NOT EXISTS idx_opportunities_user_valid ON analysis.opportunities (user_id, valid_until);` for the read filter. `.down`: `DROP TABLE IF EXISTS analysis.opportunities;`
3. Header both up/down with the `-- Migration:` / `-- Service:` block.

**Verification**:
```bash
ls services/xstockstrat-analysis/migrations/010_opportunity_actions.{up,down}.sql \
   services/xstockstrat-analysis/migrations/011_opportunities.{up,down}.sql
# Read all four: each .down DROP reverses its .up CREATE by inspection.
```

---

### Step 7 — config: register analysis.opportunity.* keys + declare defaults

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/CLAUDE.md` — modify (config-key table)
- `docs/patterns/config-governance.md` — modify (Per-Feature Registered Keys log)

**Reviewers**: `xstockstrat-analysis` owner — config key naming (`<service>.<category>.<key>`), defaults declared

**Codebase Evidence**:
- Config key table home: `services/xstockstrat-analysis/CLAUDE.md` § Config Keys Consumed (namespace `analysis`; existing rows e.g. `analysis.screener.max_universe_size`, `analysis.signals.source_weights`).
- Config read helpers: `app/config/watcher.py` — `get_int:68` (`v.int_val or default` — the **zero-trap**), `get_float:84`, `get_str:60`, `get_bool:76` (`v.HasField('bool_val')` — the presence-correct pattern to mirror for `refresh_hour_utc`).
- Config governance rules + Per-Feature Registered Keys log: `docs/patterns/config-governance.md` (root CLAUDE.md § Config Governance Rules).
- `analysis.signals.source_weights` stays the screener's (design § Option 2) — the queue's ranking axis is a **new** scalar `analysis.opportunity.signal_rank_weight`, not a re-purpose.

**TDD**: `N/A (config)` — declaration + doc; the reads are exercised in Step 12's tests.

**Instructions**:
1. Add these rows to the analysis config-key table (all namespace `analysis`, category `opportunity`) — OR-H (declare defaults) + OR-C (label):
   | Key | Type | Default | Description |
   |---|---|---|---|
   | `analysis.opportunity.max_universe_size` | int | `100` | Max candidates traced per compute; watchlist/held rank **above the cut** so a curated symbol is never truncated — only the speculative signal tail is dropped (FR-1). |
   | `analysis.opportunity.valid_window_hours` | int | `24` | `valid_until` = the compute's session date + this window. |
   | `analysis.opportunity.snooze_default_hours` | int | `24` | Default bounded "snooze until" when a SNOOZE carries no explicit timestamp. |
   | `analysis.opportunity.signal_rank_weight` | float | `0.3` | Weight `w ∈ [0,1]` of the independent signal axis in the queue ORDER BY (OR-G); `rank = (1−w)·conviction + w·signal_axis`. |
   | `analysis.opportunity.refresh_hour_utc` | int | `0` | Hour (UTC) of the **configured daily refresh** pass — a wall-clock refresh, **not** market close (holiday/DST/early-close drift is expected; a calendar-aligned refresh is a future feature). Read **presence-aware** (mirror `get_bool`'s `HasField`), never `get_int`, because `0` = midnight is a legitimate value the zero-trap would swallow. |
2. Add the five keys to the **Per-Feature Registered Keys** log in `docs/patterns/config-governance.md` under a `097 opportunity-universe-unification` heading.

**Verification**:
```bash
grep -n "analysis.opportunity" services/xstockstrat-analysis/CLAUDE.md docs/patterns/config-governance.md
```
All five keys appear in both the service table and the registered-keys log.

---

### Step 8 — service: analysis evaluator — additive exit-rule trace sibling

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/services/evaluator.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — readiness-kernel reuse, no change to the frozen backtest/live bool contract

**Codebase Evidence**:
- `evaluate_conditions_traced` at `evaluator.py:171` — traces **entry_rule only** (`entry_rule = json.loads(definition.entry_rule)` at `:202`; `leaves = _iter_leaves(entry_rule)` at `:204`; `_readiness_from_evals` at `:206`). `signals_map` param is reserved/unused (`:176–177`).
- `exit_rule` already loads in the sibling `evaluate` path at `evaluator.py:158` (`exit_rule = json.loads(definition.exit_rule) if definition.exit_rule else None`).
- Rollup helpers reused unchanged: `_iter_leaves:521`, `_eval_leaf_traced:567`, `_readiness_from_evals:612`, `_conviction_ordinal:589` (recon).
- **insights.md 2026-07-08 (083 additive-sibling)**: keep the hot method's return contract frozen; add a sibling/parameter rather than widening the shared bool path.

**TDD**: `red-green required`.

**Instructions**:
1. Add a keyword-only `rule: str = "entry"` parameter to `evaluate_conditions_traced` (`:171`). At the rule-parse point (`:202`), select `definition.entry_rule` when `rule == "entry"` and `definition.exit_rule` when `rule == "exit"`; everything else (component-series assembly `:196–201`, leaf iteration, `_readiness_from_evals`) is unchanged and shared. Default `"entry"` preserves every existing caller (`EvaluateReadiness` at `servicer.py:2002`) byte-for-byte.
2. Do **not** touch `evaluate`/`evaluate_with_series`/`_eval_condition` — the live loop (`app/engine/live_loop.py`) and the frozen backtest conviction depend on their bool contract (docstring `:183–185`).

**Verification**:
```bash
cd services/xstockstrat-analysis && ruff check app/services/evaluator.py && ruff format --check app/services/evaluator.py
```
(Behavioral gate in paired Step 9.)

---

### Step 9 — test: analysis evaluator exit-rule trace

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_evaluator_traced.py` — modify

**Reviewers**: `xstockstrat-analysis` owner

**Codebase Evidence**:
- Existing traced-evaluator tests: `services/xstockstrat-analysis/tests/test_evaluator_traced.py` (confirmed present).
- C-13: Python domain fixtures live in `tests/conftest.py` (`services/xstockstrat-analysis/tests/conftest.py` exists); reuse existing strategy/bar builders there — add a new inline literal only if it has a single consumer.

**TDD**: `red-green required` — asserts the `rule="exit"` path; red against the pre-Step-8 tree (the parameter does not exist).

**Instructions**:
1. Given a definition with distinct `entry_rule` and `exit_rule`, assert `evaluate_conditions_traced(def, bars, sym, rule="exit")` traces the **exit_rule** leaves (different `ref_name`/`fn` set than the entry trace) and `rule="entry"` (default) is unchanged.
2. Empty `exit_rule` → `_empty_readiness` (0/0), matching the entry empty-rule behavior.

**Verification**:
```bash
cd services/xstockstrat-analysis && pytest tests/test_evaluator_traced.py --cov=app --cov-fail-under=40
```

---

### Step 10 — service: analysis opportunity_actions repo + SetOpportunityAction RPC

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/repositories/opportunity_actions.py` — create
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify
- `services/xstockstrat-analysis/app/main.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — persisted-action correctness, shared-pool reuse (F-06)

**Codebase Evidence**:
- Repo/pool pattern to copy: `app/repositories/backtest_runs.py:19` (`__init__(self, db_pool)`, `fetchrow`/`fetch`, `_to_dict`); best-effort write pattern `servicer.py:1449–1472`.
- Repo wiring at boot: `main.py:147` (`StrategiesRepository(db_pool) if db_pool else None`), `:155` (`BacktestRunsRepository`).
- Header extraction pattern (per-method metadata) already in `servicer.py:2021–2027` (`ListOpportunities`) — reuse for the new RPC's `x-user-id`.

**TDD**: `red-green required`.

**Instructions**:
1. Create `OpportunityActionsRepository(db_pool)` reusing the `backtest_runs.py` shape: `upsert(user_id, opportunity_key, action:int, snooze_until)` (`INSERT … ON CONFLICT (user_id, opportunity_key) DO UPDATE`), and `list_for_user(user_id) -> dict[opportunity_key, {action, snooze_until}]` for the read-path join in Step 12.
2. Wire it in `main.py` alongside the other repos (`OpportunityActionsRepository(db_pool) if db_pool else None`) — reuses the existing pool, no new pool (F-06).
3. Implement `SetOpportunityAction` in `servicer.py`: extract `x-user-id` from `context.invocation_metadata()` (as `ListOpportunities` does at `:2021–2027`); reject empty user id / empty `opportunity_key` with `INVALID_ARGUMENT`; for `SNOOZE` with no `snooze_until`, default to `now + analysis.opportunity.snooze_default_hours`; upsert via the repo. Best-effort persistence is **not** appropriate here (the user is told it succeeded) — surface a DB failure as `UNAVAILABLE` rather than swallowing it.

**Verification**:
```bash
cd services/xstockstrat-analysis && ruff check app/repositories/opportunity_actions.py app/handlers/servicer.py app/main.py && ruff format --check app/repositories/opportunity_actions.py
```
(Behavioral gate in paired Step 11.)

---

### Step 11 — test: analysis SetOpportunityAction + actions repo

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_analysis_servicer.py` — modify

**Reviewers**: `xstockstrat-analysis` owner

**Codebase Evidence**:
- Servicer test home: `services/xstockstrat-analysis/tests/test_analysis_servicer.py` (confirmed present); it already mocks repos and drives RPCs.

**TDD**: `red-green required`.

**Instructions**:
1. `SetOpportunityAction(SNOOZE)` with an explicit `snooze_until` upserts that row (assert against a fake repo capturing the call); with no `snooze_until` it defaults to `now + snooze_default_hours`.
2. Missing `x-user-id` → `INVALID_ARGUMENT`; empty `opportunity_key` → `INVALID_ARGUMENT`.
3. DISMISS and TAKE persist their enum numbers.

**Verification**:
```bash
cd services/xstockstrat-analysis && pytest tests/test_analysis_servicer.py --cov=app --cov-fail-under=40
```

---

### Step 12 — service: analysis materialized opportunities — Universe compute, pure-read ListOpportunities, real queue_share

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/repositories/opportunities.py` — create
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify
- `services/xstockstrat-analysis/app/config/watcher.py` — modify
- `services/xstockstrat-analysis/app/main.py` — modify
- `services/xstockstrat-analysis/CLAUDE.md` — modify (Decide-surface RPCs section)

**Reviewers**: `xstockstrat-analysis` owner — Universe union correctness, readiness reuse, no look-ahead, real queue_share, shared-pool (F-06); Platform Lead — no new synchronous inter-service cycle, no new DB pool

**Codebase Evidence**:
- `ListOpportunities` at `servicer.py:2006`; today's Universe = active signals only (`_drain_active_signals:2070`), held only sets the action (`_drain_held_symbols:2096`), `strategy_id=""`/`passing/total=0/0` hardcoded (`:2042–2046`), per-symbol dedup `best[sig.symbol]:2049–2051`, offset pagination `:2057–2064`. These stubs are deleted/replaced by the pure read.
- `_action_for(direction, held)` at `servicer.py:2225` — buy&!held→ENTER, buy&held→ADD, sell&held→REDUCE (reuse for signal-origin action; held+exit-firing → REDUCE).
- `GetStrategyAnalytics.queue_share=0.0` hardcoded at `servicer.py:2183`; `taken` from trading `ListOrders` at `:2165–2172` (kept, reconciled).
- Per-symbol bar fetch: `_fetch_bars_paged` at `servicer.py:639` (`_BAR_PAGE_SIZE=1000` `:91`, `_MAX_DRAIN_PAGES=50` `:104`, `_READINESS_LOOKBACK_DAYS=400` `:102`); readiness kernel `StrategyEvaluator(...).evaluate_conditions_traced` used at `EvaluateReadiness:1993–2002`.
- Portfolio edge: `self._portfolio.ListPositions` (`:2106`) already wired; `ListWatchlists` exists on the same stub (`portfolio.proto:22`) — a **new method on the existing channel**, not a new inter-service edge (design.md:20–21; product-spec Out-of-Scope: per-user `ListWatchlists`, not the global enumeration). Ingest `QuerySignals` already wired (`:2078`).
- Config zero-trap: `watcher.py:68` (`get_int`), presence-correct pattern at `:76,82` (`get_bool`/`HasField`).
- `_row_to_strategy_definition` (`servicer.py:340`) and `StrategiesRepository.get_by_id` for per-candidate strategy load.
- **insights.md 2026-08-03 (097 design)**: lazy-materialize-on-read + `valid_until` + stale-while-revalidate + daily refresh — no standing all-user loop (analysis can't enumerate users: strategies are global).
- **Header propagation (C-03)**: analysis uses Python per-method `metadata=propagation_meta` (`servicer.py:2021–2025` builds the `x-user-id`/`x-access-scope`/`x-trace-id` tuple). Every outbound call in the compute (QuerySignals, ListPositions, **ListWatchlists**, GetBars) must pass `propagation_meta` — the new `ListWatchlists` call reuses this already-propagating pattern.

**TDD**: `red-green required`.

**Instructions**:
1. **`_normalize_symbol` helper** — one function (uppercase/trim) feeding every drain and the key. `opportunity_key = f"{user_id}|{_normalize_symbol(symbol)}|{strategy_id}"` (action is a stored annotation, **not** part of the key — a snooze survives an ENTER→ADD flip). Server-authoritative (client never derives it).
2. **`OpportunitiesRepository(db_pool)`** (copy `backtest_runs.py` shape): `replace_for_user(user_id, rows)` (transactional delete+insert of that user's rows), `read_valid(user_id, min_conviction, snooze/dismiss join)` returning ranked rows, `distinct_user_ids()` (union of `opportunities` ∪ `opportunity_actions` — OR-E known-user set), and `mark_stale_users()`/a per-user `valid_until` check. Reuses the existing pool (F-06). Wire in `main.py`.
3. **Universe compute** (`_compute_opportunities(user_id, propagation_meta)`): build candidates from `active signals (QuerySignals) ∪ held positions (ListPositions) ∪ watchlist (symbol, strategy) bindings (ListWatchlists)`. Rank watchlist+held **above** the `analysis.opportunity.max_universe_size` cut so curated candidates are never truncated (FR-1); drop only the speculative signal tail. For each candidate:
   - **Attribution** (design R, OR resolution): watchlist binding → its `strategy_id`; else **unattributed** (`strategy_id=""`, no trace, 0/0). Held positions have no portfolio strategy attribution, so fabricating one is disallowed (P-03 — no silent guess) → unattributed unless also a watchlist binding.
   - **Readiness**: entry-rule trace for signal/watchlist entry candidates; **exit-rule trace** for held+attributed candidates (`evaluate_conditions_traced(..., rule="exit")` from Step 8) → FR-8. Store passing/total + conviction ordinal + per-leaf trace as `readiness_json`.
   - **Action**: reuse `_action_for` for signal-origin rows; a held symbol whose `exit_rule` fires → REDUCE even with no sell signal (FR-8).
   - **Signal axis (OR-G)**: `signal_axis` = normalized max signal conviction contributing to the row (0.0 when no signal origin). Store it; **do not** fold it into readiness (a signal is counted exactly once — FR-3/AC-4).
   - **Provenance**: collect contributing origins (`source` names / `"position"` / `"watchlist"`) into the `provenance` array; collapse multiple origins for the same `(symbol, strategy, action)` into one row (FR-4/AC-2).
   - **Session date / valid_until (OR-D)**: source "today's session date" from the candidate's last fetched bar (cheapest; the compute already fetches bars) — `valid_until = session_date_end + analysis.opportunity.valid_window_hours`. Document the holiday/crypto mixed-calendar residual.
   - **Cold-read guard (OR-A)**: a per-user in-flight `asyncio.Lock`/set so two tabs don't double-compute; the first-ever (zero-row) read computes **synchronously** (bounded by `max_universe_size`) then serves.
   Persist via `replace_for_user`.
4. **Pure-read `ListOpportunities`** — delete the `_drain_*`/`_action_for`/`0-0`-stub inline build (`:2032–2064`). New body: read `analysis.opportunities` LEFT JOIN `opportunity_actions` for the user where `valid_until > now()` and not (DISMISS, or SNOOZE with `snooze_until > now()`), ORDER BY `rank = (1 - w)·conviction + w·signal_axis DESC` (`w = analysis.opportunity.signal_rank_weight`, clamped [0,1] — OR-G), offset-paginated as today. On a **zero-row cold read**, run the synchronous compute (step 3) then read. On a **stale served row** (`valid_until` passed), serve stale and kick an **async recompute** (stale-while-revalidate). OR-B: `valid_until` catches expired signals but not a just-closed position — accept the bound (revalidated on next read + daily pass); surface `computed_at` so the UI can show "as of".
5. **Daily refresh pass** — an asyncio background task (mirror the fundsignal loop scheduling shape) that at `analysis.opportunity.refresh_hour_utc` recomputes `distinct_user_ids()`. Read `refresh_hour_utc` **presence-aware** (add a `get_int_present`/read `HasField('int_val')` accessor in `watcher.py` mirroring `get_bool:82`) so `0`=midnight is honored (OR-C). Label it a *configured daily refresh*, not "market close". A watchlist-only user who never reads is never materialized (accepted; the live loop owns alerting — OR-E).
6. **Real `queue_share`** in `GetStrategyAnalytics` (`servicer.py:2124`): replace the `0.0` stub (`:2183`) with `attributed rows for this strategy / all attributed rows` over the user's valid opportunities (unattributed rows excluded from the denominator — design § Persisted actions), with a zero guard. Reconcile `taken` (already from `ListOrders`, `:2165–2172`) against queue-derived TAKE actions so the two read consistently (FR-7).
7. Update the analysis CLAUDE.md § Decide-surface RPCs to describe the materialized model, the persisted actions, real `queue_share`, and the entry+exit readiness (replace the "documented deviation: passing/total is 0/0" and "queue_share reserved 0.0" notes).

**Verification**:
```bash
cd services/xstockstrat-analysis && ruff check app/ && ruff format --check app/repositories/opportunities.py app/config/watcher.py
grep -n "propagation_meta" services/xstockstrat-analysis/app/handlers/servicer.py | grep -i "ListWatchlists" || echo "confirm ListWatchlists call passes propagation_meta"
```
(Behavioral gate in paired Step 13; confirm the new `ListWatchlists` outbound call carries `metadata=propagation_meta` — C-03.)

---

### Step 13 — test: analysis materialized ListOpportunities + queue_share + persisted-row parity (OR-F)

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_analysis_servicer.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — Universe union, dedup identity, no look-ahead, queue_share correctness

**Codebase Evidence**:
- Servicer test home `tests/test_analysis_servicer.py` (mocks the ingest/portfolio/trading stubs + repos).
- **OR-F / ledger 2026-08-02 (RC-1) + 056/060**: the `readiness_json`/row shape is now a producer↔reader↔UI contract — extend a descriptor-parity assertion to the materialized-row→`Opportunity` reader (mirror `test_backtest_view.py:157` `covers_every_proto_field`).

**TDD**: `red-green required` — asserts the materialized Universe + real fields; red against the pre-Step-12 tree (which returns `0/0`, `strategy_id=""`, signal-only Universe).

**Instructions**:
1. **AC-1**: a watchlisted symbol under strategy X and a held position each appear as their own row with real `passing/total` (not only signal-sourced symbols).
2. **AC-2**: a signal + a watchlist binding for the same symbol collapse into one row keyed `(user, symbol, strategy)` whose `provenance` lists both.
3. **AC-6/FR-8**: a held position whose attributed strategy's `exit_rule` fires appears as a REDUCE row with real readiness, with no sell signal present.
4. **AC-4/FR-3**: strategy readiness is unchanged by the presence/absence of a signal (the signal only moves `signal_axis`/rank, never `passing/total`).
5. **AC-5/FR-7**: `queue_share` is non-zero for a strategy with queued attributed opportunities and `0.0` when it has none (zero guard); unattributed rows excluded from the denominator.
6. **OR-F parity test**: the row→`Opportunity` mapper's field set equals `analysis_pb2.Opportunity.DESCRIPTOR.fields_by_name` minus an explicit `_INTENTIONALLY_UNSET` set — a newly-added proto field fails until the mapper carries it.
7. **Cold vs stale**: a zero-row user triggers a synchronous compute then serves; a stale row is served and an async recompute kicked (assert the compute is invoked).

**Verification**:
```bash
cd services/xstockstrat-analysis && pytest tests/test_analysis_servicer.py --cov=app --cov-fail-under=40
```

---

### Step 14 — service: retire the signal blend from RunBacktest.strategy_params scoring

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — backtest reproducibility, scoring determinism, ANALYSIS-3 (definition fingerprint untouched)

**Codebase Evidence**:
- `RunBacktest` reads `signal_sources`/`signal_weight`/`technical_weight` from `strategy_params` at `servicer.py:319–322`, normalizes at `:324–328`; QuerySignals gate `if signal_sources and signal_weight > 0:` at `:813`; blend at `scoring.compute_signal_score(...)` `:903–905` + `scoring.combine_score(...)` `:908–914`.
- **Keep** `combine_score`/`compute_signal_score` (`app/services/scoring.py`) and `ScreenSymbolsRequest.signal_sources/signal_weight` for the **screener** (`app/services/screener.py`) — design § Option 2 / § Rejected Alternatives (deleting `combine_score` rejected: shared by the screener + golden test + historical `backtest_runs`).
- **Do NOT touch** `StrategyDefinition.signal_params` (`analysis.proto:253`) — live-loop symbol universe (`live_loop.py:37–46`) + in the 065 fingerprint (`servicer.py:2556`), ANALYSIS-3.

**TDD**: `red-green required`.

**Instructions**:
1. In `RunBacktest`, make the backtest score **technical-only**: stop reading `signal_sources`/`signal_weight` from `strategy_params`; drop the QuerySignals gate (`:811–831`) and the `combine_score` signal blend (`:903–914`) so the per-bar conviction is the technical signal alone (`combined = tech_signal`). `min_conviction`/`technical_weight` handling for the technical path stays.
2. Leave `scoring.compute_signal_score`/`combine_score` in place (unused by RunBacktest now, still used by the screener). Leave `StrategyDefinition.signal_params` reads/writes and the fingerprint (`:2556`) untouched.
3. This is the AC-4 "no signal counted twice" mechanism: a signal now affects only the queue's independent ranking axis (Step 12), never a strategy's internal score.

**Verification**:
```bash
cd services/xstockstrat-analysis && ruff check app/handlers/servicer.py && ruff format --check app/handlers/servicer.py
```
(Behavioral gate in paired Step 15.)

---

### Step 15 — test: backtest scoring is technical-only

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_analysis_servicer.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — scoring determinism

**Codebase Evidence**:
- Existing backtest tests in `tests/test_analysis_servicer.py`; scoring unit tests reference `app/services/scoring.py`.

**TDD**: `red-green required` — red against the pre-Step-14 tree (where signal_weight blends into conviction).

**Instructions**:
1. A `RunBacktest` with `strategy_params` carrying `signal_sources`/`signal_weight` produces the **same** result as one without them (the blend no longer affects the score) — the decisive AC-4 assertion.
2. A signal-weighted `strategy_params` no longer triggers a `QuerySignals` call during the run (assert the ingest stub's `QuerySignals` is not invoked from the RunBacktest path for the blend).
3. The **screener** path (`ScreenSymbols`) still blends (untouched) — a smoke assertion that `scoring.combine_score` remains importable/used there.

**Verification**:
```bash
cd services/xstockstrat-analysis && pytest tests/test_analysis_servicer.py tests/test_screener.py --cov=app --cov-fail-under=40
```

---

### Step 16 — test/docs: agent builder parity tests + strat-lab/mcp-tools reconciliation

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_tools.py` — modify (or a new `tests/test_strategy_builders.py` — create)
- `plugins/strat-lab/skills/backtest/SKILL.md` — modify
- `docs/runbooks/mcp-tools.md` — modify

**Reviewers**: `xstockstrat-agent` owner — MCP tool contract stability + `mcp-tools.md`/`strat-lab` parity

**Codebase Evidence**:
- Unguarded builders (the RC-1 silent-drop trap): `_build_component` at `client.py:291`, `screen_symbols`→`ScreenSymbolsRequest` at `client.py:361–369`, `manage_strategy`→`StrategyDefinition` at `client.py:425–442`. `run_backtest` passes **no** signal params (recon).
- Parity-test template: `services/xstockstrat-agent/tests/test_backtest_view.py:157` (`test_summary_key_set_covers_every_proto_field` — asserts the builder key set == `<Message>.DESCRIPTOR.fields_by_name` minus an explicit `_INTENTIONALLY_UNSET`/dropped set).
- **ledger 2026-08-02 (RC-1)** + the root CLAUDE.md strat-lab same-PR rule (a repo rule, not a Floor ID): a change to `run_backtest`'s scoring behavior must update the strat-lab skill in the **same** PR.
- Doc references: `docs/runbooks/mcp-tools.md:387–389` (`screen_symbols` signal params — **kept**, screener), `:464` (`manage_strategy` `signal_params` — **kept**, live-loop symbols), `:486` (signal_params changes the fingerprint). No **watchlist** MCP tool exists (recon) — no agent binding change for the Watchlist shape.

**TDD**: `red-green required` — the parity tests are red against the current tree only if a proto field is unmapped; write them to pin the *current* field set with an explicit opt-out, so a future field fails closed. Include one deliberately-missing-field assertion to prove the guard has teeth.

**Instructions**:
1. Add three `covers_every_proto_field`-style parity tests (copy the `test_backtest_view.py:157` shape): assert the key sets built by `_build_component` (`StrategyComponent`), `manage_strategy` (`StrategyDefinition`), and `screen_symbols` (`ScreenSymbolsRequest`) each equal their message's `DESCRIPTOR.fields_by_name` minus an explicit intentionally-unset set (e.g. `StrategyDefinition.active`/`warnings` are server-authoritative, `Opportunity`-side fields N/A). This closes the RC-1 drift trap the design flagged.
2. **Reconcile the docs** with Step 14's retired blend: in `plugins/strat-lab/skills/backtest/SKILL.md` and `docs/runbooks/mcp-tools.md`, ensure no text claims that a strategy's `signal_weight`/`signal_sources` in `RunBacktest.strategy_params` blend into the backtest score. State that a strategy's backtest score is **technical-only** (signals became a universe + independent queue ranking axis — feature 097); `screen_symbols`' signal params (`:387–389`) and `manage_strategy`'s `signal_params` (`:464`, the live-loop symbol universe) are unaffected — leave those rows intact.
3. Confirm there is no watchlist MCP tool to update (recon) — state that explicitly in the PR body so the C-14 agent surface is provably covered, not silently skipped.

**Verification**:
```bash
cd services/xstockstrat-agent && ruff check tests/ && pytest tests/ --cov=app --cov-fail-under=40
grep -n "signal_weight\|technical-only\|feature 097" plugins/strat-lab/skills/backtest/SKILL.md docs/runbooks/mcp-tools.md
```

---

### Step 17 — service: UI Opportunities page — server-persisted snooze / dismiss / take

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/insights/opportunities/page.tsx` — modify
- `services/xstockstrat-ui/src/hooks/useOpportunities.ts` — modify
- `services/xstockstrat-ui/e2e/fixtures/opportunities.ts` — modify
- `services/xstockstrat-ui/e2e/mock-backend.ts` — modify
- `services/xstockstrat-ui/e2e/insights/opportunities.spec.ts` — modify
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify

**Reviewers**: `xstockstrat-ui` owner — display correctness, Connect-RPC call safety, exhaustive enum maps

**Codebase Evidence**:
- Transient snooze today: `opportunities/page.tsx:62` (`useState<Set<string>>`), key fn `:81` (`` `${o.symbol}-${o.source}` `` — the source-based key FR-4 replaces), snooze mutator `:117`, card Snooze button `:348`.
- Data hook: `useOpportunities.ts:14` (`analysisClient.listOpportunities`); mutations via `src/hooks/useInvalidatingMutation.ts:13` (canonical "call BFF then invalidate").
- `analysisClient` browser client already exists (`src/lib/browserClients/analysisClient.ts`); the `SetOpportunityAction` method appears on it after Step 2's codegen — the insights BFF registers `AnalysisService` so the new RPC dispatches automatically (`src/lib/insightsBff.ts`).
- Enum maps: `src/lib/opportunityShared.tsx:20` (`OPPORTUNITY_ACTION` over `OpportunityActionTag`). The new `OpportunityAction` enum (SNOOZE/DISMISS/TAKE) drives **action buttons**, not a rendered `Record` map — no new exhaustive map is forced (C-10(a/d): only a new *value* on an already-`Record`-mapped enum breaks `tsc`; this is a new enum with no existing map). Re-verify no exhaustive switch/`Record` over it is introduced.
- Fixtures: `e2e/fixtures/opportunities.ts` (`OPPORTUNITIES`), `INVENTORY.md:21` row; C-12 requires reusing the fixture (extend it with `opportunityKey`/`provenance`), not inline literals.
- **C-10(a)**: the Opportunities page is already nav-registered (Decide group, `navGroups.tsx`) — re-verify reachability, no new registration.

**TDD**: `red-green required` (e2e).

**Instructions**:
1. Replace the transient `snoozed` `Set` state (`:62`) and the `${symbol}-${source}` key (`:81`) with the server flow: the row key is `o.opportunityKey` (stable, FR-4). Add `useSetOpportunityAction` in `useOpportunities.ts` built on `useInvalidatingMutation` (invalidate `['opportunities']`) calling `analysisClient.setOpportunityAction({ opportunityKey, action, snoozeUntil? })`.
2. Wire the card Snooze button (`:348`) to `SetOpportunityAction(SNOOZE)` (bounded snooze — pass a `snoozeUntil` or let the server default). Add Dismiss and Take actions similarly (DISMISS/TAKE). After mutation + invalidate, the server-filtered read drops the row (persisted across reload/devices — AC-3).
3. Extend the `OPPORTUNITIES` fixture (`e2e/fixtures/opportunities.ts`) with `opportunityKey` + `provenance`; add a stateful `setOpportunityAction` handler to `e2e/mock-backend.ts` that filters snoozed/dismissed rows from subsequent `listOpportunities` responses (so the e2e proves persistence across a reload). Update `INVENTORY.md:21`.
4. e2e (`opportunities.spec.ts`): snooze a card → it disappears; reload → still gone (server-persisted). Assert the card renders real `passingConditions/totalConditions` and `strategyId` for an attributed row (they are no longer `0/0`/empty — `page.tsx:311–319,332`).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint && pnpm test:e2e -- opportunities
```

---

### Step 18 — service: UI Watchlist per-symbol strategy-binding editor

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/insights/WatchlistDetail.tsx` — modify
- `services/xstockstrat-ui/src/components/insights/WatchlistReadiness.tsx` — modify
- `services/xstockstrat-ui/src/hooks/useWatchlists.ts` — modify
- `services/xstockstrat-ui/e2e/helpers/watchlistMock.ts` — modify
- `services/xstockstrat-ui/e2e/insights/watchlists.spec.ts` — modify
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify

**Reviewers**: `xstockstrat-ui` owner — watchlist binding UI correctness, readiness display, Connect-RPC call safety

**Codebase Evidence**:
- `WatchlistDetail.tsx:85–98` renders symbol chips from `watchlist.symbols`; add/remove via `useAddWatchlistSymbols`/`useRemoveWatchlistSymbols` (`:8`,`:47`,`:92`). It passes `symbols` to `WatchlistReadiness` (`:114`).
- `WatchlistReadiness.tsx:60` — the transient `useState('')` strategy picker (`:85–96`) evaluating the **whole list** against one strategy. FR-6 replaces this with the persisted **per-symbol** binding. Reuse the pure rollup `src/lib/readinessRollup.ts:34` (recon "Patterns to REUSE").
- `useWatchlists.ts` — `useCreateWatchlist`/`useUpdateWatchlist`/`useAddWatchlistSymbols` build on `useInvalidatingMutation` (`:22`,`:34`,`:56`); they currently send `symbols` only.
- `watchlistMock.ts` — stateful mock, already references feature 097 (`:4`); `INVENTORY.md:23` row.
- Strategy list source: `useStrategyDefinitions` (`WatchlistReadiness.tsx:13,58`).

**TDD**: `red-green required` (e2e).

**Instructions**:
1. Change the watchlist hooks to send `bindings` (`{symbol, strategyId}[]`) instead of/alongside `symbols`: `useAddWatchlistSymbols` and `useUpdateWatchlist`/`useCreateWatchlist` take optional per-symbol `strategyId`. The typed client gains `bindings` after Step 2.
2. In `WatchlistDetail.tsx`, render each symbol chip with an inline strategy `Select` (from `useStrategyDefinitions`) bound to that symbol's persisted `binding.strategyId`; changing it calls the binding mutation (persisted, survives reload — FR-6). The bare-`symbols` add still works (unbound) but the editor lets the user attach a strategy per symbol.
3. In `WatchlistReadiness.tsx`, drop the single `useState('')` whole-list picker in favor of the per-symbol binding (evaluate each symbol against its own bound strategy). Keep the `readinessRollup.ts` reuse and the "in queue" mark (098). Where a symbol is unbound, show it as not-evaluated rather than fabricating a binding.
4. Extend `watchlistMock.ts` to store/return `bindings`; update `watchlists.spec.ts` to set a per-symbol strategy and assert it persists and drives that symbol's readiness. Update `INVENTORY.md:23`.
5. **C-10(a)** re-verify: the Watchlist editor is reached via the Discover group (`navGroups.tsx`) — no new route.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint && pnpm test:e2e -- watchlists
```

---

### Step 19 — service: UI Strategy wizard — remove signal-blend controls, preserve signal_params.symbols

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/insights/StrategyWizard.tsx` — modify
- `services/xstockstrat-ui/e2e/insights/*.spec.ts` — modify (the strategy-wizard spec)

**Reviewers**: `xstockstrat-ui` owner — wizard correctness, no clobbering of `signal_params.symbols`

**Codebase Evidence**:
- Signal-blend controls: `StrategyWizard.tsx` `STEPS` includes `'Signal Params'` (`:21`); the Step-4 blend UI at `:285–345` (signal sources chips `:288–310`, signal/technical weight + min-conviction sliders `:312–339`); signal draft state `:88–92`.
- **The clobber**: `handleSubmit` (`:136`) rebuilds `signalParams` wholesale at `:144–149` from the blend draft only — it carries **no `symbols`**, so an UPDATE overwrites the stored `signal_params` and drops `signal_params.symbols`. Design § Consumer surfaces: remove the blend controls **while preserving `signal_params.symbols`** (merge, not wholesale rewrite) — `signal_params.symbols` is the live-loop symbol universe (ANALYSIS-3).
- `initialSignal = initial?.signalParams` at `:68`; draft seeded from it `:88–92`.

**TDD**: `red-green required` (e2e).

**Instructions**:
1. Remove the Step-4 "Signal Params" blend UI (`:285–345`) and drop `'Signal Params'` from `STEPS` (`:21`) — the wizard no longer exposes signal-weight controls (a strategy's score is technical-only after Step 14).
2. In `handleSubmit`, **preserve** the existing `signal_params` rather than rebuilding it: carry through `initial?.signalParams` unchanged (which retains `symbols`) instead of the wholesale `{ signal_sources, signal_weight, technical_weight, min_conviction }` object at `:144–149`. For a create with no prior `signal_params`, omit the key entirely (don't invent blend fields). This is the "merge, not wholesale rewrite" the design requires — a wizard save must not reset `signal_params.symbols`.
3. Update the strategy-wizard e2e: assert the Signal Params step is gone, and that editing an existing strategy that has `signal_params.symbols` and saving preserves those symbols (the decisive ANALYSIS-3 regression guard).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint && pnpm test:e2e -- strateg
```

---

## Deviation Log

- **Steps 17–19 — all three UI steps done, e2e green (opportunities 6, watchlists 5, strategy-authoring
  17 = 28 relevant specs pass); lint + tsc + vitest clean.** Notable deviations:
  - **Step 17 snooze/dismiss persistence proven via per-page `page.route()` isolation, not the shared
    mock-backend.** Playwright runs `fullyParallel: true`, so a global mutable "hidden" set in
    `mock-backend.ts` would pollute across parallel workers. Mirrored the `watchlistMock.ts` house
    pattern: the spec intercepts `ListOpportunities` + `SetOpportunityAction` per-page (isolated state
    that survives a reload). `mock-backend.ts` still gained a stateless `setOpportunityAction` so a
    call resolves. Trap fixed: Connect-JSON encodes a request enum as its NAME string (not the number)
    and `google.protobuf.Timestamp` as an RFC3339 string (not `{seconds,nanos}`) — the hand-built route
    responses/handlers account for both.
  - **Step 18 readiness is per-symbol via `useQueries`.** The whole-list `useState('')` picker was
    replaced by an inline per-symbol strategy `Select`; symbols group by bound strategy and one
    `EvaluateReadiness` runs per group. Unbound → *not evaluated* (P-03). Re-bind writes the FULL
    binding set via `UpdateWatchlist` (replace) so no other symbol's `strategyId` resets (fails-080).
    Added a defensive de-dupe of the render binding list (unique React keys) after a transient
    duplicate-symbol render corrupted the DOM under rapid rebind+refetch. The 098 readiness e2e was
    rewritten for the per-symbol model (the whole-list picker + "evaluated-against" caption are gone).
  - **Step 19 preserves `signal_params` verbatim.** `handleSubmit` now carries `initial.signalParams`
    through unchanged (holds the live-loop `signal_params.symbols` universe, ANALYSIS-3) instead of the
    wholesale `{signal_sources,…}` rewrite that dropped `symbols`; a create with no prior signal_params
    omits the key. The wizard dropped from 5 steps to 4 (Review is now step 4). The regression-guard
    e2e uses an **underscore** strategy id (`strat_signal_universe`) because the wizard's id validator
    (`[a-z0-9_]+`) rejects hyphens, which would block advancing past Step 1.
  - **`page.route()` isolation is a deliberate deviation from the spec's "modify `mock-backend.ts` with
    a stateful handler" instruction** — documented here rather than shipping a cross-worker pollution
    hazard.
- **Step 16 — no builder code change; the docs had no RunBacktest-blend claim to remove (only a
  claim to add).** The three parity tests pin the *existing, unchanged* `_build_component` /
  `manage_strategy` / `screen_symbols` builders (RC-1 fail-closed guard) — no client.py edit. Used
  the `test_formula_builders.py` capture-the-request+`ListFields()` shape (stronger than a hand
  literal) with `_INTENTIONALLY_UNSET = {active, live_enabled, warnings}` (StrategyDefinition),
  `{evaluation_window}` (ScreenSymbolsRequest), `{}` (StrategyComponent); `test_guard_has_teeth`
  is the teeth assertion. **No RunBacktest signal-blend claim existed** in `mcp-tools.md` or the
  strat-lab SKILL (the signal refs there are all the *kept* `screen_symbols`/`manage_strategy`
  params), so the doc reconcile was purely **additive** — a "backtest score is technical-only
  (feature 097)" note in both, leaving the screener/`signal_params` rows intact. **No watchlist MCP
  tool exists** (recon), so the C-14 agent surface has nothing to rebind — stated in the PR body.
  Agent suite: 198 passed, 76.03%. **Disposition**: parity guards + additive doc reconcile.
- **Steps 14–15 — also removed the now-dead `source_weights` config read in RunBacktest.** Retiring
  the `_backtest_symbol` signal blend left the `analysis.signals.source_weights` read (`RunBacktest`
  top) and its `_backtest_symbol` arg with no consumer, so both were removed to avoid an unused-var
  (ruff F841). The screener keeps its **own** `source_weights` read + `combine_score`/`compute_signal_score`
  use (untouched — design § Option 2). `StrategyDefinition.signal_params` + the 065 fingerprint are
  untouched (ANALYSIS-3). Also updated the six pre-existing `TestTradeStartIndex` calls of
  `_backtest_symbol` to the trimmed signature. **RED** verified by reintroducing a `signal_weight`-gated
  QuerySignals fetch + conviction blend: `test_signal_params_do_not_change_the_score` and
  `test_signal_weighted_run_does_not_query_signals` went red; restore → green. **Disposition**:
  in-scope dead-code removal from making the score technical-only.
- **Steps 12–13 — committed together (one red-green cycle); `main.py` change is only the daily
  loop.** Step 12's `OpportunitiesRepository` is constructed in `AnalysisServicer.__init__` from the
  injected `db_pool` (like every other repo — Step 10's deviation), so the only `main.py` edit was
  wiring the `run_opportunity_refresh_forever()` daily task under the existing `if db_pool` block.
  Step 12 (compute + pure read + queue_share) and Step 13 (its tests) are one behavioral change and
  were committed as a single cycle. **Disposition**: no scope change.
- **Steps 12–13 — replaced the retired feature-083 signal-only `TestListOpportunities`.** The pre-097
  `ListOpportunities` built a signal-only queue with `0/0`/`strategy_id=""`; its four tests asserted
  exactly that and are now obsolete. They were replaced by `TestListOpportunitiesMaterialized` (AC-1/2/4/6,
  ranking, cold-vs-stale, C-03 ListWatchlists propagation), `TestOpportunityRowParity` (OR-F descriptor
  parity + teeth), and queue_share/taken tests on `TestGetStrategyAnalytics`. **RED verified** by
  neutering `_row_to_opportunity`'s readiness to `0/0` (the retired stub): AC-1/AC-6/parity-populate
  went red; restoring → green. **Disposition**: intended replacement of retired behavior.
- **Steps 12–13 — single-file coverage command → CI-equivalent full-suite run** (same substitution as
  Steps 9/11). Ran `pytest --cov=app --cov-fail-under=40` over all of `tests/`: **419 passed, 81.29%**
  ≥ 40%. The `opportunities.py` repo's raw-SQL methods show low line-coverage (29%) because unit tests
  use an in-memory `_FakeOppRepo` (no DB in the suite, same as `strategies.py`); the producer path is
  covered end-to-end through the real `_compute_opportunities`. **Disposition**: CI-equivalent fallback.
- **Step 12 — action model for non-signal candidates (P-03 documented, not a silent guess).** The
  `OpportunityActionTag` enum has no HOLD/MONITOR tag. `_resolve_action_tag` therefore maps a *curated*
  (watchlist/held) candidate with no actionable signal and no firing exit to `ENTER` (not held) or `ADD`
  (held, a monitored holding); a *speculative* signal-only candidate with no actionable signal (e.g. a
  sell with no position) returns `None` and is dropped — preserving the pre-097 "no row" behavior.
  Held+attributed exit-firing → `REDUCE` (FR-8) takes priority. **Disposition**: documented action
  policy within the existing enum; recorded here and in the analysis CLAUDE.md.
- **Step 12 — one session date per compute for `valid_until` (OR-D).** `valid_until` is the newest bar
  fetched across the whole compute + `valid_window_hours` (fallback `now` when no bars are fetched, e.g.
  an all-unattributed Universe). A genuinely stale newest bar (halted symbol) yields an immediately-expired
  row that recomputes on the next read — the accepted OR-B/OR-D residual. **Disposition**: matches the
  design's "compute's session date + window"; residual documented.
- **Step 10 — `app/main.py` needs no change (repo built in the servicer).** The step listed
  `app/main.py`, but repos are constructed inside `AnalysisServicer.__init__` from the injected
  `db_pool` (`self._opportunity_actions_repo = OpportunityActionsRepository(db_pool) if db_pool else
  None`), and `main.py` already passes `db_pool` to the servicer. No `main.py` edit was needed for
  Step 10 (a daily-refresh loop, if any, belongs to Step 12). Staged a subset of the step's Files
  (F-08 permits fewer). Steps 10 (repo+RPC) and 11 (test) committed together (the servicer method and
  its test are one red-green cycle). **Disposition**: no scope change.
- **Step 11 — single-file coverage command → CI-equivalent full-suite run** (same substitution as
  Step 9): `pytest tests/test_analysis_servicer.py --cov=app --cov-fail-under=40` measures the whole
  `app` from one file. Ran `pytest --cov=app --cov-fail-under=40` over all of `tests/`: **407 passed,
  82.68%** ≥ 40%; the new tests pass in isolation (`-k set_opportunity_action` → 5 passed).
  **Disposition**: CI-equivalent fallback.
- **Step 9 — single-file coverage command is unsatisfiable; used the CI-equivalent full-suite run.**
  The step's `**Verification**` runs `pytest tests/test_evaluator_traced.py --cov=app --cov-fail-under=40`
  — measuring coverage of the **entire** `app` package from **one** test file, which can only reach
  ~6% (a single file cannot cover 40% of the whole service). The `40%` gate is a whole-suite threshold
  (analysis CI runs `pytest --cov=app --cov-fail-under=40` over all of `tests/`). Ran that instead:
  **402 passed, 82.79%** ≥ 40%. The new exit tests pass in isolation too (`-k exit_rule` → 2 passed).
  **Disposition**: CI-equivalent fallback — verification intent (suite ≥ 40% with the new behavior)
  satisfied.
- **Steps 4–5 — `portfolio_handler.go` needs no change; committed as one atomic cycle.** The step listed
  `internal/handler/portfolio_handler.go` as a modify file, but both the Connect handlers and the gRPC
  adapter forward `req.Msg`/`req` whole (`portfolio_handler.go:132-186`, `:269-317`), so the new
  `bindings` field passes through with no edit. The handler was not touched (staged a subset of the
  step's Files — F-08 permits fewer). Steps 4 (repo+service) and 5 (test) were committed **together**
  because the `WatchlistStore` interface-signature change requires the matching test-double to compile
  (Step 4 alone leaves the package uncompilable). **Disposition**: no scope change; both steps' Files +
  spec/context staged.
- **Steps 4–5 — SA1019 on the deprecated `symbols` mirror.** Marking `Watchlist.symbols=5
  [deprecated=true]` (Step 1) makes every Go read of the intentionally-retained flat mirror a
  staticcheck SA1019. The mirror is deliberately still populated for old clients (deprecate-don't-delete,
  FR-6), so the 10 legitimate sites carry `//nolint:staticcheck` with an explanation. `golangci-lint
  run` → 0 issues. **Disposition**: expected cost of the deprecation; localized to the two touched Go
  files (no other current Go consumer reads `Watchlist.Symbols`).
- **Step 1 — buf breaking verification command.** The step's `**Verification**` runs
  `cd packages/proto && buf breaking . --against ".git#branch=main-dev,subdir=packages/proto"`, but that
  `.git` resolves cwd-relative to `packages/proto/.git` (nonexistent). Ran the CI-equivalent form instead:
  from repo root, `buf breaking packages/proto --against ".git#branch=main-dev,subdir=packages/proto"`
  after `git branch -f main-dev origin/main-dev` (buf needs a local `main-dev` ref, matching
  `scripts/buf-gen.sh`'s `git show-ref` guard). `buf lint` + `buf breaking` both passed (additive +
  `symbols=5 [deprecated=true]` only). **Disposition**: CI-equivalent fallback — verification intent
  (no breaking change vs dev trunk) unchanged.

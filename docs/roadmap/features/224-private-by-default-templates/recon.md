# Recon: private-by-default-templates

**Created**: 2026-10-06
**From**: product-spec.md
**Affected services**: xstockstrat-indicators, xstockstrat-analysis, xstockstrat-ingest, xstockstrat-agent, xstockstrat-ui (+ xstockstrat-ledger as audit-event receiver; packages/proto)

---

## Objective

Remove "public" from every user-authored object: formulas, strategies, signal sources and ingested
signals become owner-private. The exceptions are the existing `system` objects and the
fundamentals-producer signals, which are owned by `system` and readable by all. Add an admin-curated
template catalog for strategy, formula and signal-source templates. Users instantiate a template into an
independent private snapshot copy, and strategy templates deep-copy the formula templates they
reference. analysis runs formulas strictly as the strategy owner, which retires the PR #1219
`x-internal-caller` bypass. Admins keep only an audited read-only view.

## Codebase Map

- **`xstockstrat-indicators`** (Python)
  - Entry point: `app/main.py:50-63` (pool with `statement_cache_size=0` under `DB_PGBOUNCER` at `:56`; `seed_default_formulas` at `:61`)
  - Servicer: `app/handlers/servicer.py`
    - `_INTERNAL_FORMULA_READERS` `:23`
    - `_FORMULA_MASKABLE_PATHS` incl. `is_public` `:27-38`
    - `_has_admin_scope` `:68-78`
    - `_caller_user_id` (header, then body fallback) `:81-86`
    - `_can_read_formula` `:89-98`
    - `ExecuteFormula` `:129` (authz `:138-144`)
    - `RegisterFormula` `:288-299`: **body `author` wins (D-30 open)**
    - `GetFormula` `:345-359` (fills the cache before authz `:351`)
    - `ListFormulas` `:361-386`
    - `UpdateFormula` `:388` (SYSTEM guard `:398-403`, admin override `:405`)
    - `DeleteFormula` `:493` (SYSTEM guard `:503-508`, admin override `:510`)
    - `_row_to_formula` `:520-549`
  - Repo: `app/services/formulas_repository.py`
    - `create` `:51-85`, `upsert` `:87-136`, `get_by_id` `:138`, `list` `:145-174` (WHERE `:155-158`), `update` `:176`, soft `delete` `:210`
    - **No transactions:** every method uses the pool directly (`:48-49`)
  - Last migration: `006_add_formula_fundamental_inputs`, next `007`
    - `is_public` partial index is **unnamed** (`001_formulas.up.sql:16`)
  - System seed:
    - `app/formulas/fundamentals_value_quality.py:22,27-28` (`IS_PUBLIC=True`)
    - `app/services/seed_formulas.py:21-48`
    - `SYSTEM_AUTHOR` at `app/formulas/__init__.py:5`
  - No ledger client in code. `LEDGER_ENDPOINT` is already wired: `docker-compose.yml:311`, `.do/app*.yaml:214`.

- **`xstockstrat-analysis`** (Python)
  - Entry point and indicators-channel interceptor: `app/main.py:22,73-78` (`app/internal_caller.py:5-16`)
  - **Live-loop evaluator built with empty metadata:** `main.py:148` `StrategyEvaluator(servicer._indicators, ())`
    - The owner is known at `live_loop.py:365` but never reaches indicators.
  - Evaluator: `app/services/evaluator.py:197-209` (`self._meta`); every indicators call uses it:
    - ExecuteFormula `:425,:498`; GetFormula `:549,:576`; ComputeIndicator `:410`
  - Paths already carrying the owner header:
    - backtest (`servicer.py:656-660`, `:1720`)
    - readiness materializer (`:4980`, `:5001`)
    - opportunity refresh (`:4931`)
    - screener (`screener.py:342-348`)
    - write-time `_fetch_formula_outputs` `:537-560` and `_deleted_formula_warnings` `:562-586`
  - Background paths with **no** owner:
    - fundsignal `run_once(metadata=())` (`fundsignal_loop.py:137,159` → `fundamentals_scoring.py:52-58`)
    - pnl consumer (`pnl_pattern_consumer.py:96-111`)
  - Strategy CRUD:
    - `ManageStrategy` `servicer.py:2591`; REGISTER `:2612-2648` (owner from header `:2616`); UPDATE `:2649-2751`
    - Blend guards `:2753-2763`, `:2880-2891` (bare id)
    - **No `strategy_id` format validation** anywhere.
  - Repos: `strategies.py` (`get_by_owner_and_id` `:66`, `update_locked` txn `:93-136`; `get_by_id`/`update` unscoped with no app callers)
  - Bare-`strategy_id` state:
    - `strategy_scores` (PK `strategy_id`, `005:2`; repo upsert `ON CONFLICT (strategy_id)` `strategy_scores.py:42-57`)
    - `backtest_run_symbols` (`007:8-29`; `fetch_eligible` `:70-79`)
    - `backtest_details` (`008:7-16`; retention DELETE `WHERE strategy_id=$1` `backtest_details.py:46-59` **can evict another owner's rows**)
    - `backtest_runs.user_id` nullable (`015`), and **`_persist_backtest_run` never passes `user_id`** (`servicer.py:2393-2415`)
    - In-memory `_strategies`/`_backtests`/`_recompute_locks` (`:416-417,:504`)
    - **`GetBacktest` has no ownership check** (`:2564-2589`)
    - `ListBacktests` reads unscoped after the owner check (`:2558`)
  - Signals:
    - live loop `_drain_signals` QuerySignals with no metadata (`live_loop.py:445-472`)
    - `resolve_fundamentals_universe` (`:137-179`)
    - opportunities `_drain_active_signals`/`_drain_source_weights` (`servicer.py:5180-5219`)
    - attribution reads `order_snapshots.signals` captured unscoped (`pnl_pattern_consumer.py:107-111`)
    - screener `screener.py:316-325`
  - Fundsignal emission:
    - registers a `derived` source with a self-injected admin scope (`fundsignal_loop.py:440-462`, `:448`)
    - IngestSignal with empty metadata (`:479-491`)
    - `x-internal-caller: analysis-fundsignal` is sent only to portfolio (`:289`)
  - Last migration: `025_opportunity_symbol_score`, next `026`
    - `SEED_USER_ID` envsubst is limited to `013` (`scripts/db-migrate.sh:78-88`)

- **`xstockstrat-ingest`** (Python)
  - Servicer: `app/handlers/servicer.py`
    - `_has_admin_scope` `:205-218`; `_propagation_meta` `:221-226`
    - `IngestSignal` `:778` (no authz; shared `_ingest_external_signal` `:800`; slug-only source check `:820-823`; txn `:845`; dedup `ON CONFLICT (source,symbol,direction)` `:866-891`)
    - `QuerySignals` `:976` (no user filter)
    - `ListSignalSources` `:1081`
    - `ManageSignalSource` `:1136`, **admin-only `:1140-1142`**
  - Repo: `app/repositories/signal_sources.py`, every query keyed `WHERE slug=$1`; `list_all_sources` unscoped `:43-57`
  - **mcp_client poller ingests with no identity**
    - It lists all sources globally (`app/engine/mcp_client_loop.py:124-139`, started at `main.py:123-130`).
  - Credentials:
    - `ingest.mcp_credential.<slug>` is a **global** secret key (agent `tools.py:1204,1217`; UI `useSignalSourceMutations.ts:39,47`)
    - Secrets are global-scope only (`config.proto:133-135`)
    - Config grant: `keyPrefixes:['mcp_credential.']` (`config/src/grpc/authz.ts:121`)
  - Tables:
    - `newsletter_signals` is a hypertable, 7-day chunks, `PK (id, ingested_at)`, with **no compression or retention policy** (`001:8-23`)
    - `signal_sources` PK `slug` (`002:6`); source_type CHECK `signal_sources_source_type_check` (`011:10-16`)
    - `signal_dedup_keys` PK `(source,symbol,direction)` (`009:10-19`)
    - No FK references a slug.
  - Last migration: `012_backfill_data_kind`, next `013`
  - Inbound `x-internal-caller` is **never** read in ingest.

- **`xstockstrat-agent`** (Python)
  - Tools are registered via `register_tools` (`app/tools.py:331-335`); `GET /api/tools` is at `main.py:115,231`.
  - `manage_formula` `is_public` (`tools.py:997,1066,1079`); `get_formula` (`:1095`); `list_formulas(author_filter, include_public)` (`:1108`)
  - `manage_signal_source` forwards admin scope (`:1132,1199`); `list_signal_sources` (`:442`); `ingest_signal` (`:549`); `manage_strategy` (`:819`)
  - client.py: `is_public` at `:1070,1088`; `include_public` at `:1122-1124`
  - **Tool count is forty-three** (feature 217's "fifty-two" is stale). Six surfaces state it:
    - `tools.py:4,52`
    - `services/xstockstrat-agent/CLAUDE.md:43,49`
    - `docs/runbooks/mcp-tools.md:3,10,45`
    - the mcp-tools.md per-tool sections
    - `tests/test_tools_endpoint.py:23`
    - `ui/src/lib/copilot.ts:21`

- **`xstockstrat-ui`** (Next.js)
  - **The rendered nav is `NAV_GROUPS`** (`src/components/shared/navGroups.tsx:39`; Formulas `:62`, Signal sources `/config-ui/sources` `:67`, `adminOnly` `:20`). `PLATFORM_SUBNAV` (`PlatformHeader.tsx:69`) is legacy.
  - Nav test: `e2e/nav-reachability.spec.ts:21-60` (hard-coded `GROUPS`)
  - Public UI to remove:
    - `insights/formulas/page.tsx:31,34,41-42,72-78,131-132`
    - `[id]/page.tsx:63`
    - `FormulaWorkspace.tsx:71,110,127,256,304,366-370`
    - `useFormulas.ts:29,51,63,84,96`
    - `StrategyWizard.tsx:110` and `ComponentEditor.tsx:63` (`includePublic:true`)
  - BFF:
    - `forward`/`forwardAdmin`/`requireAdminScope` (`lib/bffShared.ts:47,60,76`)
    - `insightsBff.ts:151-178` (`registerFormula` overrides author `:152-158`)
    - `configUiBff.ts:53-54`
  - Admin detection: `useIsAdmin` (`hooks/useLiveStrategies.ts:60`), `useHeaderIsAdmin` (`PlatformHeader.tsx:46`)
  - Signal sources: `config-ui/sources/page.tsx` + `config-ui/hooks/useSignalSources.ts:5,14`
  - Fixtures: `INVENTORY.md:23-25,76` (`FORMULA_*`, `SIGNAL_SOURCES`)
    - IndicatorsService is **not** in `mock-backend.ts`; specs use `page.route` (`strategy-authoring.spec.ts:20-21`).

## Patterns to REUSE

- Ownership gate on a mutation → reuse the **analysis `ManageStrategy` owner-from-header pattern** (`servicer.py:2594-2597,2616`) and indicators `_caller_user_id`, made header-only for reads.
- Admin bit → `_has_admin_scope` (indicators `:68-78`, ingest `:205-218`); UI `forwardAdmin`/`requireAdminScope` (`bffShared.ts:47,76`).
- Internal-caller grant for writing as `system` → the **portfolio least-privilege `{callerID, rpc}` allow-list** (`portfolio/internal/service/authz.go:15-38`), mirrored in Python. analysis already sends `analysis-fundsignal` (`fundsignal_loop.py:289`).
- Atomic multi-row write → `async with pool.acquire() as conn, conn.transaction():` (ingest `servicer.py:845`, analysis `strategies.py:112`).
- Ledger emit → ingest's best-effort `_emit_backfill_event` (`ingest servicer.py:283-298`) plus the mTLS channel wiring (`ingest/app/main.py:85-89`). indicators reuses its own `app/mtls.py:36,44`.
- Owner-stamped background metadata → readiness materializer `meta=[("x-user-id", owner)]` (`analysis servicer.py:4980`). Live loop, fundsignal and pnl consumer adopt the same pattern.
- Deprecate-don't-delete proto fields → `[deprecated = true]` + `// DEPRECATED:` (`indicators.proto:223`).
- `SEED_USER_ID` migration templating → `scripts/db-migrate.sh:78-88`, the 013 envsubst branch; extend it to the new analysis and ingest files.
- Owner-scoped composite PK + seed guard → `analysis/migrations/013_strategies_user_id.up.sql:11-27`.
- System-object immutability → indicators SYSTEM guards (`:398-403,:503-508`); blend guards (analysis `:2753-2763,:2880-2891`).
- Snapshot payload in JSONB → strategies `definition_json`, formulas `parameters`/`outputs` JSONB.
- UI page plus nav → `NAV_GROUPS` entry, `nav-reachability.spec.ts` row; fixtures from `e2e/fixtures/formulas.ts` / `signalSources.ts` (C-12).
- Test contexts → ingest `tests/conftest.py:15-31` `_ctx` (C-13 home). indicators and analysis have no fixture home; their `_ctx` helpers are duplicated inline, so a second consumer should centralize into `conftest.py`.

## Existing Business Rules (preserve / extend)

**CHANGE: needs operator sign-off recorded in context.md**
- **CHANGE** `@AC-4 @FR-3 @feature-161` "the source create form sets reliability weight at registration time" (`services/xstockstrat-ui/acceptance/surface-signal-weight-decay-config.feature`): FR-13 makes `/config-ui/sources` an admin read-only view, so creation, with its weight field and guidance, moves to `/insights/signal-sources`.
- **CHANGE** `@AC-5 @FR-4 @feature-161` "the inline weight editor shows guidance text" (same file): the inline editor moves to `/insights/signal-sources`.

**EXTEND**
- `@AC-1 @FR-1 @feature-166` (ingest mcp-client): any owner can now register, and the list is owner-scoped.
- `@AC-4 @FR-4 @feature-166` (ingest): the poller ingests as the source owner, and the dedup tuple gains `user_id`.
- `@AC-9 @FR-7 @feature-161` (agent parity): the new `SignalSource.user_id`/origin fields must be surfaced or opted out.
- `@AC-7 @FR-5 @feature-029`, `@AC-9 @FR-1 @FR-5 @feature-029` (attribution): source scope becomes owner plus system.
- `@AC-6 @FR-6 @feature-176` (analysis fan-out): signal ownership is added to the owner scope.

**PRESERVE: load-bearing for the design**
- `@feature-160 @AC-1`, `@feature-168 @AC-1/@AC-6`, `@feature-190 @AC-11`: the `system`-owned "fundamentals" signals must stay visible to every user's analysis paths. The FR-6 exception is load-bearing.
- `@feature-186 @AC-4/@AC-6/@AC-8`: the blend guards must not be weakened, and instantiation must define how they interact with a template that yields the blend id.
- `@feature-042 @AC-1`: the pnl consumer has no caller and must QuerySignals as the order owner, or the snapshot signals go empty.
- `@feature-185 @AC-1`: indicators `NOT_FOUND` for an unreadable formula must not become a permanent "data-unavailable" row in the 300s retry loop.
- `@feature-176 @AC-3`, indicators `@AC-5`: owner checks must not serialize concurrent execution, and every concurrent call carries the owner header.
- `@feature-166 @AC-2/@AC-3`: the bearer is never returned, including on the admin read view and in template payloads. The per-owner slug must still resolve its credential.
- `@feature-127 @AC-1/@AC-3` (platform): the watchlist auto-add on an owned-source ingest, and the dedup no-mutation rule, must hold.
- `@feature-021 @AC-11` (ledger export is own-events only): decide which `user_id` `audit.admin_read` carries.
- `@feature-149 @AC-3/@AC-5`, `@feature-152 @AC-6`, `@feature-149 @AC-3 regression`, `@feature-150/151` round-trips, `@feature-205 @AC-1/2/3/7`, `@feature-156 @AC-6/@AC-8/@AC-9`, `@feature-161 @AC-1/2/3/10`, `@feature-127 @AC-4/@AC-5`, `@feature-173 @AC-2`, `@feature-180 @AC-2`, `@feature-190 @AC-4`, `@feature-210 @AC-5`, `@feature-029 @AC-1/@AC-10`, `@feature-166 @AC-5/@AC-6`: each must hold unchanged. The full list and reasons are in `scenario-recon` (session 2026-10-06).
- **No promoted rule** encodes `is_public`, the formula admin override, the `ManageSignalSource` admin gate, or the `x-internal-caller` bypass. Removing them is C-16-clean; they appear only in the indicators and ingest `CLAUDE.md` (doc teardown).

## Dependencies

- **Proto/RPC:**
  - indicators `FormulaDefinition` max field 14, so new fields go at 15+. `RegisterFormulaRequest` max 10; `ListFormulasRequest` max 4; `UpdateFormulaRequest` max 11.
  - ingest `ExternalSignal` max 10; `SignalSource` max 12; `QuerySignalsRequest` max 5; `ManageSignalSourceRequest` max 5; `ListSignalSourcesRequest` max 1.
  - analysis `StrategyDefinition` max 14 (field 15 is reserved for 217), so 224 uses 16+. `GetBacktestRequest{backtest_id=1}`.
  - `AppendEventRequest.user_id=9` (`ledger.proto:38-51`).
  - Template RPCs are new; where they live is a design decision (OQ-4).
- **Migrations:**
  - next indicators `007`, ingest `013`, analysis `026` (re-derive across remote branches at `/sdd-spec`)
  - `SEED_USER_ID` envsubst must be extended beyond analysis 013 (`db-migrate.sh:78-88`)
- **Config keys:**
  - no new keys
  - read: `analysis.fundsignal.source_slug` (default `fundamentals`), `analysis.fundsignal.scoring_formula_id`, `analysis.engine.fundamentals_blend_strategy_id`
  - the config `GetSecret` grant `mcp_credential.` prefix (`authz.ts:121`) is affected by credential re-keying
- **Inter-service edges:**
  - new: indicators → ledger (AppendEvent for `audit.admin_read`)
  - changed: analysis → indicators (owner header instead of `x-internal-caller`); analysis → ingest (owner header on QuerySignals; `analysis-fundsignal` grant on IngestSignal/ManageSignalSource)
  - possibly: a template service → indicators/ingest/analysis for deep copy (OQ-4)
- **New env vars/ports:** none required. indicators `LEDGER_ENDPOINT` is already present in all three deploy files.

## Risks / Not-found

1. **Live loop and fundsignal formula execution break the moment the bypass is removed**, because they carry no owner identity (`main.py:148`, `fundsignal_loop.py:137`). The owner header has to be threaded first, in the same step or an earlier one, never after.
2. **The live-loop evaluator is a single shared instance with fixed `()` metadata.** Per-strategy owner metadata needs either an evaluator per owner, or metadata passed per call. Watch `@feature-176` concurrency.
3. **mcp_client poller with no identity.** It must ingest as each source's owner (OQ-6).
4. **Credential key collision.** `ingest.mcp_credential.<slug>` is a global secret key, and secrets are global-scope only (`config.proto:133-135`). Per-owner slugs need an owner-namespaced key, for example `mcp_credential.<owner>.<slug>`, plus a config-grant and UI/agent change. Migrating existing secrets is a data step.
5. **Fundamentals source identification (D-4).** It is registered at runtime with `source_type='derived'` by analysis, not by any migration (ingest `006` only widens the CHECK). The migration can match `source_type='derived'`, which is the only producer of derived sources today; that needs verifying in design.
6. **D-1:** `backtest_runs.user_id` is NULL for legacy runs **and for every run since**, because `_persist_backtest_run` never writes it. The backfill has to cover all of them, and the write path must be fixed.
7. **D-2:** `strategy_scores` is keyed by bare `strategy_id` while `strategies` has a composite PK. The backfill join is ambiguous.
8. **D-3:** the `strategy_scores` PK swap is lossy on the way down.
9. **D-5:** `newsletter_signals` is a hypertable with no compression, so `ALTER ADD COLUMN` plus an UPDATE backfill plus `SET NOT NULL` is feasible, but the backfill UPDATE spans every chunk (cost and lock time).
10. **`backtest_details` retention DELETE `WHERE strategy_id=$1`** can evict another owner's rows today, a latent cross-user bug inside FR-10's scope.
11. **`GetBacktest` with no ownership check** is a latent cross-user read inside FR-10's scope.
12. **Blend guard vs template id.** A template whose id (or `_N` suffix) equals the configured blend id becomes a protected blend for that user (`@feature-186`).
13. **Classifying the unreadable formula (`@feature-185 @AC-1`).** Indicators `NOT_FOUND` currently means data-unavailable plus a 300s retry. A deliberate "skipped component" classification is needed.
14. **The pnl consumer** captures snapshot signals unscoped (`pnl_pattern_consumer.py:107-111`). Under per-owner QuerySignals it must run as the order owner (`@feature-042`).
15. **No `strategy_id` format validation exists.** Suffixing (`<id>_2`) could exceed any implicit length limit. Check the DB column type.
16. **The indicators cache is filled before authz** (`:351,:137`). This is harmless, but it is a DoS-free cache-poison vector worth keeping in mind for per-user listing.
17. **Ledger traps:**
    - 2026-08-14/133: verify every "already owner-scoped" claim by reading code (items 6/10/11 above are exactly that class).
    - 2026-08-19/133: `SEED_USER_ID` must be wired at all three run sites with a concrete local default.
    - 2026-07-01/063: system objects stay mutation-protected.
    - 2026-08-05/008: propagate enum/variant changes (source_type CHECK) to every artifact.
18. **Docs drift:** indicators `CLAUDE.md` migration list skips `005`; `nextjs-frontends.md:382` says `'/api'` where the code uses `'/insights/api'`; feature 217 says tool count 52.

**Not found:** template, origin and clone code anywhere; `/insights/signal-sources` and `/insights/templates` routes; a shared ledger-emit helper in analysis; a `strategy_id` validator; a compression policy on `newsletter_signals`; an inbound `x-internal-caller` check in ingest; feature 010's scheduler (draft only); migration numbers on remote branches (subagents had no git access).

## Recommended Scope

Advisory, ordered so that nothing breaks between steps:

1. **Owner identity threading in analysis**, with behavior unchanged:
   - live loop, fundsignal and pnl consumer send the owner (or `system`) `x-user-id` to indicators and ingest;
   - `_persist_backtest_run` writes `user_id`;
   - `GetBacktest` checks ownership;
   - `backtest_details` retention is scoped by owner.

   This is a precondition for every other step.
2. **Analysis owner-dimension migration (026)** for `strategy_scores`/`backtest_run_symbols`/`backtest_details`, with the D-1/D-2/D-3 policy, plus repos and the in-memory maps keyed by `(owner, strategy_id)`.
3. **Indicators visibility:**
   - header-only author (D-30);
   - owner/system-only reads;
   - `ListFormulas` scoping;
   - admin read with audit, and admin mutation removed;
   - `is_public` ignored or deprecated;
   - migration `007` drops the `is_public` index;
   - ledger client.
4. **Remove the bypass** (indicators `_INTERNAL_FORMULA_READERS`, analysis `internal_caller.py` and interceptor), plus classify unreadable formulas.
5. **Ingest ownership:**
   - migration `013` with `user_id` columns, backfill (`SEED_USER_ID`, derived → `system`), PK swaps and refusing downs;
   - owner-scoped RPCs;
   - `system` write grant;
   - mcp poller as the source owner;
   - credential re-keying.
6. **Analysis signal consumers** become owner+system scoped (live loop, universe, opportunities, attribution capture, screener).
7. **Template catalog and instantiation**, per the OQ-4 placement decision; deep copy is atomic.
8. **Proto** changes, sequenced before the steps that consume them.
9. **Agent tools:** drop the public arguments, owner-scope sources, add `list_templates`/`instantiate_template`, and update all six tool-count surfaces (43 → 45).
10. **UI:**
    - remove the public UI;
    - add `/insights/templates`, `/insights/signal-sources` and `/config-ui/templates`;
    - make `/config-ui/sources` read-only;
    - add `NAV_GROUPS` entries and nav tests;
    - re-home the CHANGE rules `@feature-161 @AC-4/@AC-5`.
11. **Docs:** strat-lab skill, mcp-tools.md, the service `CLAUDE.md` files, the `system` ingest convention.

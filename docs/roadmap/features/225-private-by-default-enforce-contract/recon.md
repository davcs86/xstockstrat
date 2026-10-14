# Recon: private-by-default-enforce-contract

**Created**: 2026-10-09
**From**: product-spec.md (spec-ready, run-2 review) + operator decisions in context.md
**Affected services**: xstockstrat-analysis, xstockstrat-indicators, xstockstrat-ingest (UI/agent: no code
change, but both are *callers* — see Risks)

---

## Objective

Feature 224 (release N, now launched) kept headerless tolerance, an `analysis` formula-read bypass in
indicators, a nullable `backtest_runs.user_id`, an ingest N-1 owner-fill trigger and superseded tables so
an N-1 rollback stayed safe. 225 (release N+1) removes them: headerless owner-scoped calls fail
`UNAUTHENTICATED`, the bypass goes, `user_id` becomes NOT NULL, the N-1 objects are dropped by contract
migrations, and indicators stops writing `is_public` (column drop deferred).

## Codebase Map

- **`xstockstrat-analysis`** (Python)
  - Server: `app/main.py:106` `grpc.aio.server()` — **no interceptors**; reflection at `:109-113`; test
    `tests/test_owner_header_guard.py:110 test_main_wires_no_channel_interceptor` (asserts no *channel* interceptor).
  - Caller helper `_caller_user_id` `app/handlers/servicer.py:563-576` (maps `system` → `""`; no inbound
    grant/SAN check exists in analysis). Admin selector `:578-582`.
  - Raw-header readers bypassing the helper: ScreenSymbols `:3463`, ListOpportunities `:4198`,
    SetOpportunityAction `:5686`, GetStrategyAnalytics `:5804`.
  - Headerless today — (a) explicit abort PERMISSION_DENIED: ManageStrategy `:2774-2776`, SetStrategyLive
    `:3053-3055`, ListTemplates `:3182-3183`, InstantiateTemplate `:3299-3301`, ManageTemplate `:3194`,
    GetWatchlistReadiness `:3679-3681`; SetOpportunityAction INVALID_ARGUMENT `:5687-5688`.
    (a′) PERMISSION_DENIED via skipped ownership lookup: ScoreStrategy `:2327-2336`, GetStrategyReport
    `:2677-2689`, ListBacktests `:2714-2726`, GetStrategy `:2992-3004`, EvaluateReadiness `:3520-3528`,
    GetIndicatorSeries `:4066-4076`, GetStrategyAnalytics `:5809-5820`, GetBacktest `:2757-2766`, RunBacktest
    with `strategy_id_ref` `:756-775`. (b) empty/owns-nothing: ListStrategies `:2656-2673`,
    ListStrategyDefinitions `:3028-3035`, GetAttribution `:3966-3968`, ListOpportunities `:4198-4214`.
    (c) not owner-scoped today: RunBacktest inline/legacy (`caller_user_id=""` `:723`, persists NULL owner),
    ScreenSymbols `:3418`, RunFundamentalsScan `:3478` (admin gate), **QueryPnLPatterns `:3909-3926` (no user
    filter — `app/repositories/pnl_pattern_samples.py:35` returns every user's samples)**.
  - backtest_runs: `app/repositories/backtest_runs.py:37,43-44` (`user_id: str | None`); caller
    `_persist_backtest_run` `servicer.py:2513-2562` from RunBacktest `:1165-1175` (`user_id=caller_user_id or None`;
    same for `_persist_symbol_cells :1152`, `_persist_backtest_detail :1179`).
  - strategy_scores: repo uses only `analysis.strategy_scores_v2` (`app/repositories/strategy_scores.py:2..111`);
    bare table only in migrations 005/007/026 + stale docstring `servicer.py:6630`.
  - Migrations: last `026_owner_dimension_templates` (`-- requires-env: SEED_USER_ID` `:1`, guard `:7-14`,
    D-1 `:16-24`, seed fallback `:26-28`, NOT NULL deferred `:4-5`, strategy_scores note `:65-66`) → next **027**.
  - Tests: `tests/conftest.py:33-38 ctx_with(headers)` (no peer-SAN helper); `tests/test_analysis_servicer.py:954`
    (`test_unauthenticated_caller_denied`, PERMISSION_DENIED today); `tests/test_get_attribution.py:305`.
- **`xstockstrat-indicators`** (Python) — `app/handlers/servicer.py`
  - Grants `:27-34` (`_INTERNAL_FORMULA_READERS = {"analysis"}` `:29`, `analysis-fundsignal` `:31`,
    `analysis-template-saga` `:33`, SAN `:34`); `_caller_user_id` body fallback `:97-102`; `_reader` `:105-107`;
    `_internal_grant` `:110-116` (`app/peer_identity.py:6 peer_san_matches`); `_reject_ungranted_system`
    `:118-127` (first call of every owner-scoped RPC); `_can_read_formula` `:129-136` (bypass arm `:136`);
    `_template_owner` `:160-168`. No server interceptor.
  - Headerless: ExecuteFormula saved id → NOT_FOUND unless system/bypass `:232-243`, inline source runs `:246-247`;
    RegisterFormula INVALID_ARGUMENT `:386-393`; GetFormula NOT_FOUND; ListFormulas → system only `:459-472`;
    Update/DeleteFormula body-`user_id` fallback `:500,:605`; ListTemplates already UNAUTHENTICATED `:618-619`;
    Instantiate/ResolveTemplateIntent PERMISSION_DENIED `:677,:733`. Not owner-scoped: ComputeIndicator `:192`,
    ListIndicators `:342`, ListFundamentalMetrics `:353`.
  - `is_public` writes: servicer `:425` (Register), `:578` (Update), `:766` (`_template_copy`); repository
    `app/services/formulas_repository.py` `_INSERT_SQL :47`, `_insert_args :62,:78`, `upsert :132,:145,:153,:167`,
    `update :219,:228,:239`; seed `app/services/seed_formulas.py:40` (`fvq.IS_PUBLIC`,
    `app/formulas/fundamentals_value_quality.py:28`). Reads: `SELECT *` (`:178,:203`), `_row_to_formula`
    `servicer.py:804-826` does **not** map is_public. Tests asserting `kw["is_public"] is False`:
    `tests/test_formulas.py` (12 sites), `tests/test_private_formulas.py:29,36,90,127,137-143,304-309`,
    `tests/test_formula_read_authz.py`, `tests/test_fundamentals_formula.py:174,185`, `tests/test_formula_templates.py`.
  - Test helper `tests/conftest.py:17-29 ctx_with(metadata, peer_sans=())`.
- **`xstockstrat-ingest`** (Python) — `app/handlers/servicer.py`
  - `_SYSTEM_GRANTS :86-92` (`analysis-fundsignal`, `analysis-system-read`, SAN), `_resolve_owner :330-342`
    (None when headerless), `_owner_or_abort :344-349` (chokepoint).
  - Headerless: IngestSignal slug-holder fallback `:977-988` (ambiguous → FAILED_PRECONDITION `:941`);
    QuerySignals unscoped `:1164`; ListSignalSources unscoped; ManageSignalSource admin-bit + slug holder
    `:1369-1392`, register refused `:1343`; ListTemplates allowed; InstantiateTemplate FAILED_PRECONDITION
    `:1598-1600`. Admin-only, not owner-scoped: TriggerBackfill `:368`, CancelBackfill `:848`; no identity:
    GetBackfillStatus `:810`, ListBackfillJobs `:820`, NormalizeRawData `:890`.
  - Dedup on `ingest.signal_dedup_claims` (`:1038-1080`); no app reference to `signal_dedup_keys`/`n1_owner_fill`
    (`tests/test_signal_ownership.py:135` asserts absence).
  - Migration 013: function `:35-52`, trigger `:54-56`, claims `:88-99`, keys→claims seed `:101-112`;
    down `:21-22`. `signal_dedup_keys` created by `009_signal_dedup_keys.up.sql:10,20`. Next **014**.
  - mcp_client: `app/engine/mcp_client_loop.py:103,115-118` (`resolve_secret(key, user_id=owner)`, no global
    fallback); `app/config/watcher.py:146-164` (doc drift: example still `<slug>` `:19,25-27`). Calls
    `_ingest_external_signal(..., owner=owner)` in-process `:125` (not via RPC).
  - Test helper `tests/conftest.py:15-42 _ctx(access_scope, user_id, peer_sans, internal_caller)`.
- **Scripts**: `scripts/migration-rerun.sh` (`count_n1_triggers :14-16`, analysis/ingest pre-render `:40-46`,
  `goto 25 :55`, fixtures `:59`, replay list `:69-70`, trigger stability `:79-84`, assertions `:86-93`,
  `scripts/migration-assertions/{indicators-007,ingest-013,analysis-026,fixtures-pre-224}.sql`);
  `scripts/check-migration-contract.sh:13-27` (+ `.test.sh`); `scripts/render-migrations.sh:23,40-46`;
  `scripts/db-migrate.sh:78-92`; CI `.github/workflows/ci.yml:662-678` (contract gate), aggregate `:774`.

## Patterns to REUSE

- Headerless chokepoints: indicators `_reject_ungranted_system` (`servicer.py:118`), ingest `_owner_or_abort`
  (`:344`), analysis `_caller_user_id` (`:563`) — or, for analysis only, a server interceptor at `main.py:106`.
- UNAUTHENTICATED precedent: indicators ListTemplates `servicer.py:618-619`.
- SAN check: `app/peer_identity.py peer_san_matches` (indicators/ingest) — copy only if analysis needs it.
- D-1 backfill SQL: analysis `026 :16-28` (re-apply verbatim in 027 before NOT NULL).
- Replay-safe contract style + rerun assertions: `scripts/migration-assertions/*.sql`, `to_regclass` guards (026 `:69`, 013 `:101`).
- Test contexts: indicators `ctx_with(metadata, peer_sans)`, ingest `_ctx(...)`, analysis `ctx_with(headers)`.

## Existing Business Rules (preserve / extend)

No promoted rule guarantees headerless tolerance, the `analysis` reader bypass, a nullable
`backtest_runs.user_id` or an `is_public` effect → **no CHANGE**. 39 PRESERVE + 1 EXTEND:

- **PRESERVE** `@AC-5 @FR-3 @feature-224` "analysis cannot execute a formula its strategy owner does not own" (`services/xstockstrat-analysis/acceptance/private-by-default-templates.feature`) — live-loop ExecuteFormula carries the owner x-user-id and no x-internal-caller; FR-2's bypass removal is the enforcement of this.
- **PRESERVE** `@AC-30 @FR-3 @feature-224` "Registering a strategy that references an unreadable formula warns at write time" (`services/xstockstrat-analysis/acceptance/private-by-default-templates.feature`) — the write-time GetFormula must still return a warning (not an error) once the bypass is gone.
- **PRESERVE** `@AC-21 @FR-10 @feature-224` "Same strategy_id for two users does not share scores or backtests" (`services/xstockstrat-analysis/acceptance/private-by-default-templates.feature`) — owner-keyed backtest_runs and scores; FR-3 NOT NULL and the strategy_scores drop must leave this intact.
- **PRESERVE** `@AC-11 @FR-6 @feature-224` "Live loop signal eligibility sees only the owner's signals" (`services/xstockstrat-analysis/acceptance/private-by-default-templates.feature`) — live-loop QuerySignals must stay headered under FR-1.
- **PRESERVE** `@AC-12 @FR-6 @feature-224` "Attribution excludes other users' signals" (`services/xstockstrat-analysis/acceptance/private-by-default-templates.feature`) — owner-scoped signal reads.
- **PRESERVE** `@AC-29 @FR-6 @feature-224` "Opportunity provenance and screener signal filter exclude other users' signals" (`services/xstockstrat-analysis/acceptance/private-by-default-templates.feature`) — owner-scoped signal reads on the compute and screener paths.
- **PRESERVE** `@AC-20 @FR-9 @feature-224` "Strategy id collision on instantiation" (`services/xstockstrat-analysis/acceptance/private-by-default-templates.feature`) — template instantiation.
- **PRESERVE** `@AC-34 @FR-9 @feature-224` "Caller-chosen strategy id on instantiation" (`services/xstockstrat-analysis/acceptance/private-by-default-templates.feature`) — ALREADY_EXISTS before any write.
- **PRESERVE** `@AC-37 @FR-3 @FR-6 @feature-224` "Fundamentals scan fails closed on a non-system scoring formula" (`services/xstockstrat-analysis/acceptance/private-by-default-templates.feature`) — the fundsignal pre-flight GetFormula runs as SAN-bound `system`; it must not be broken by the bypass removal or FR-1.
- **PRESERVE** `@AC-1 @FR-1 @FR-2 @feature-042` "Filling an order captures a snapshot with indicator and signal context" (`services/xstockstrat-analysis/acceptance/order-snapshots-pnl-patterns.feature`) — the pnl consumer's ingest/indicators reads must carry an owner or a grant, or the snapshot silently degrades to empty under FR-1.
- **PRESERVE** `@AC-6 @FR-6 @feature-176` "Parallelized fan-out preserves per-user owner scoping" (`services/xstockstrat-analysis/acceptance/analysis-concurrency-offload.feature`) — every concurrent branch carries the owner user_id; headerless branches would now fail UNAUTHENTICATED.
- **PRESERVE** `@AC-1 @FR-1 @feature-224` "Another user's formulas are invisible even if formerly public" (`services/xstockstrat-indicators/acceptance/private-by-default-templates.feature`) — identified non-owner keeps NOT_FOUND (FR-1).
- **PRESERVE** `@AC-2 @FR-1 @feature-224` "ListFormulas returns only the caller's own and system formulas" (`services/xstockstrat-indicators/acceptance/private-by-default-templates.feature`) — headered listing unchanged.
- **PRESERVE** `@AC-3 @FR-1 @feature-224` "Setting is_public has no effect" (`services/xstockstrat-indicators/acceptance/private-by-default-templates.feature`) — after 225 stops writing and reading the column, the read-back FormulaDefinition must still report is_public false.
- **PRESERVE** `@AC-4 @FR-2 @feature-224` "Body author cannot impersonate another user or the system" (`services/xstockstrat-indicators/acceptance/private-by-default-templates.feature`) — RegisterFormula keeps stamping the header author.
- **PRESERVE** `@AC-16 @FR-8 @feature-224` "Instantiation creates an independent private snapshot" (`services/xstockstrat-indicators/acceptance/private-by-default-templates.feature`) — instantiate path stops writing is_public.
- **PRESERVE** `@AC-17 @FR-8 @feature-224` "Template updates never mutate existing instances" (`services/xstockstrat-indicators/acceptance/private-by-default-templates.feature`) — template-instance path.
- **PRESERVE** `@AC-31 @FR-7 @feature-224` "Retiring a template hides it but leaves instances intact" (`services/xstockstrat-indicators/acceptance/private-by-default-templates.feature`) — template-instance path.
- **PRESERVE** `@AC-22 @FR-11 @feature-224` "Migration preserves data and makes public formulas private" (`services/xstockstrat-indicators/acceptance/private-by-default-templates.feature`) — 225 has no indicators migration; the column stays.
- **PRESERVE** `@AC-28 @FR-13 @feature-224` "Admins can read but not change another user's objects" (`services/xstockstrat-indicators/acceptance/private-by-default-templates.feature`) — the audited admin read path is separate from the removed `analysis` bypass.
- **PRESERVE** `@AC-7 @FR-4 @feature-224` "Users manage their own signal sources without admin scope" (`services/xstockstrat-ingest/acceptance/private-by-default-templates.feature`) — headered owner path.
- **PRESERVE** `@AC-8 @FR-4 @feature-224` "Two users may use the same source slug" (`services/xstockstrat-ingest/acceptance/private-by-default-templates.feature`) — per-owner slugs.
- **PRESERVE** `@AC-9 @FR-5 @feature-224` "Ingested signals belong to the source owner and dedup per owner" (`services/xstockstrat-ingest/acceptance/private-by-default-templates.feature`) — dedup must keep working in signal_dedup_claims after 014 drops signal_dedup_keys.
- **PRESERVE** `@AC-10 @FR-5 @feature-224` "A user cannot ingest into another user's source" (`services/xstockstrat-ingest/acceptance/private-by-default-templates.feature`) — an identified non-owner stays NOT_FOUND, not UNAUTHENTICATED.
- **PRESERVE** `@AC-27 @FR-11 @feature-224` "Global signal data is backfilled to the seed user" (`services/xstockstrat-ingest/acceptance/private-by-default-templates.feature`) — 014 drops only the trigger, function and dedup table.
- **PRESERVE** `@AC-33 @FR-6 @feature-224` "A user cannot write as the system owner" (`services/xstockstrat-ingest/acceptance/private-by-default-templates.feature`) — a headered `system` with no grant stays PERMISSION_DENIED, not UNAUTHENTICATED.
- **PRESERVE** `@AC-1 @FR-1 @feature-166` "Register an MCP client signal source with endpoint and tool" (`services/xstockstrat-ingest/acceptance/mcp-client-signal-source.feature`) — headered REGISTER.
- **PRESERVE** `@AC-3 @FR-2 @FR-3 @feature-166` "Ingest resolves the bearer token via GetSecret and sends it as an Authorization header" (`services/xstockstrat-ingest/acceptance/mcp-client-signal-source.feature`) — per-user GetSecret resolution (FR-6).
- **PRESERVE** `@AC-4 @FR-4 @feature-166` "MCP tool result is parsed into ExternalSignals and ingested" (`services/xstockstrat-ingest/acceptance/mcp-client-signal-source.feature`) — the poller's IngestSignal must carry the source owner under FR-1; the second-cycle dedup must survive the signal_dedup_keys drop.
- **PRESERVE** `@AC-6 @FR-3 @FR-1 @feature-224` "The fundamentals loop still runs the system scoring formula" (`docs/sdd/business-rules/platform.feature`) — the SAN-bound system grant path must survive the bypass removal and FR-1.
- **PRESERVE** `@AC-18 @FR-9 @feature-224` "Strategy template instantiation deep-copies referenced formulas" (`docs/sdd/business-rules/platform.feature`) — the saga uses the `analysis-template-saga` grant, which is distinct from the removed `analysis` reader.
- **PRESERVE** `@AC-19 @FR-9 @feature-224` "A failed deep copy leaves nothing behind" (`docs/sdd/business-rules/platform.feature`) — saga rollback.
- **PRESERVE** `@AC-15 @FR-7 @feature-224` "Catalog starts empty after migration" (`docs/sdd/business-rules/platform.feature`) — unaffected.
- **PRESERVE** `@AC-23 @FR-11 @feature-224` "System special-cases are unchanged" (`docs/sdd/business-rules/platform.feature`) — system formula stays read-only; the blend deactivate refusal is unchanged.
- **PRESERVE** `@AC-26 @FR-6 @feature-224` "System-owned fundamentals signals are visible to every user" (`docs/sdd/business-rules/platform.feature`) — the live-loop system-signal drain (`analysis-system-read` grant) must survive FR-1.
- **PRESERVE** `@AC-32 @FR-12 @feature-224` "Agent docs and strat-lab skill stay in parity with the tool contract" (`docs/sdd/business-rules/platform.feature`) — no doc may reintroduce is_public or include_public.
- **EXTEND** `@AC-35 @FR-14 @feature-224` "Two users with the same mcp_client slug use their own credentials" (`docs/sdd/business-rules/platform.feature`) — 225 `@AC-7` adds the case where a global secret exists alongside and the per-user value still wins.
- **PRESERVE** `@AC-36 @FR-4 @feature-224` "System slugs are reserved in both directions" (`docs/sdd/business-rules/platform.feature`) — unaffected by the headerless removal.
- **PRESERVE** `@AC-2 @FR-1 @FR-2 @feature-210` "A mutually-authenticated peer with a valid platform-issued identity is accepted" (`docs/sdd/business-rules/platform.feature`) — the header trio is honored on the mTLS channel.
- **PRESERVE** `@AC-5 @FR-5 @feature-210` "Header-propagation semantics are unchanged beneath mTLS" (`docs/sdd/business-rules/platform.feature`) — downstream ownership checks see the same values.
## Dependencies

- Proto: none.
- Migrations: analysis **027** (`-- contract-of: services/xstockstrat-analysis/migrations/026_owner_dimension_templates.up.sql`,
  `-- requires-env: SEED_USER_ID`), ingest **014** (`-- contract-of: services/xstockstrat-ingest/migrations/013_signal_ownership_templates.up.sql`).
  Both expand files are on `origin/main` (promotion #1233). indicators: none (008 released).
- Config keys: none. Env: `SEED_USER_ID` already rendered for analysis by `render-migrations.sh`.
- Inter-service: UI BFF + agent → analysis/indicators/ingest (must carry `x-user-id`); analysis → indicators
  (owner via `evaluator.for_owner`, fundsignal `system`+grant, saga grant), analysis → ingest (owner, `analysis-system-read`).

## Risks / Not-found

- **Fail-open→fail-closed (fails.md):** callers that are headerless today and would break under FR-1:
  - **agent** `services/xstockstrat-agent/app/client.py:59-81` sends `x-user-id` only when a caller context is bound
    (stdio / pre-token handshake / tests are headerless) — affects indicators ExecuteFormula/Register/ListFormulas
    `:1017,:1096,:1149`, ingest ListSignalSources/IngestSignal/ManageSignalSource/backfill RPCs `:174,:242,:1250,:1944-1998`.
  - **analysis P&L consumer** `app/engine/pnl_pattern_consumer.py:366` (`meta=() if not owner`) → indicators
    ComputeIndicator (not owner-scoped — unaffected) and ingest `:110` (QuerySignals — owner-scoped → would fail
    UNAUTHENTICATED; degrades `@AC-1 @feature-042` snapshot to empty signals silently).
  - **evaluator default** `propagation_meta=()` `app/services/evaluator.py:200,215` — base evaluator built with `()`
    at `main.py:151`; owner via `for_owner` in the live loop; a headerless inline `RunBacktest` sends headerless
    GetFormula/ExecuteFormula.
  - UI BFF not inspected for every analysis/indicators/ingest call (agent + UI are the only external callers of analysis).
- Precedence (ingest `@AC-33`): `x-user-id: system` without grant stays PERMISSION_DENIED; UNAUTHENTICATED only
  when there is no `x-user-id` at all. analysis currently maps inbound `system` → "" (owns nothing) — FR-1 open point.
- QueryPnLPatterns is cross-user today (no owner filter) — out of 225 scope unless FR-1 is defined to cover it;
  flag for design.
- RunBacktest inline/legacy is headerless-capable and persists NULL owners — after 027 (PRE_DEPLOY) a release-N
  binary's NULL insert fails (best-effort; history row lost) during rollout.
- Indicators ExecuteFormula inline source (`:246-247`) runs headerless today — decide owner-scoped or not.
- Doc changes needed: indicators CLAUDE.md lines 14-37, ingest CLAUDE.md 38-65/140-150, analysis CLAUDE.md
  (headerless behaviour + `_INTERNAL_FORMULA_READERS` mentions); ingest watcher docstring `<slug>` drift.
- `tests/test_owner_header_guard.py:110` asserts no channel interceptor — an analysis *server* interceptor must not trip it.

## Recommended Scope

1. Migrations: analysis 027 (D-1 re-backfill → NOT NULL; drop strategy_scores; raising down) + ingest 014
   (drop trigger/function/signal_dedup_keys; raising down) + migration-rerun.sh/assertions.
2. indicators: remove bypass arm + body-user_id fallback; headerless → UNAUTHENTICATED at the chokepoint;
   stop writing is_public on all 4 write paths (+ seed); tests.
3. ingest: headerless → UNAUTHENTICATED at `_owner_or_abort`/`_resolve_owner` for owner-scoped RPCs;
   remove slug-holder fallback; per-user credential regression test.
4. analysis: headerless → UNAUTHENTICATED (helper or interceptor), RunBacktest owner required; fix the
   P&L consumer / evaluator headerless outbound paths; tests.
5. Callers: agent unbound-context behaviour (refuse locally vs. accept UNAUTHENTICATED); UI BFF audit.
6. Docs: three service CLAUDE.md files + constitution entries; promote scenarios.

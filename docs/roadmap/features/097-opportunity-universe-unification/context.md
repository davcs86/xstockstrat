# Context: opportunity-universe-unification

**Feature**: `docs/roadmap/features/097-opportunity-universe-unification/feature.md`
**Product Spec**: `docs/roadmap/features/097-opportunity-universe-unification/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/097-opportunity-universe-unification/implementation-spec.md`

---

## Session 2026-08-03 — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from the user story.
- **Origin:** a codebase walkthrough of signal/opportunity/watchlist/strategy/indicator/backtest/screener
  relationships surfaced that the Decide queue fragments three symbol-origins and that snooze/strategy
  binding are UI-only transient state.
- **User-committed design decisions (carry into /sdd-design):**
  1. **Option 2** — signals are a universe + independent ranking axis ONLY, never an input to a strategy's
     internal score. `signal_weight`/`signal_sources` retire from the strategy definition (deprecate, don't
     delete); signal↔technical ranking blend moves to the queue composition layer so a signal is counted
     exactly once.
  2. **Watchlists become `(symbol, strategy_id)` bindings** — a strategy per symbol; each binding is a
     ready-made Universe candidate. Delivered via a proto deprecation path, not a hard replace.
- **Confirmed code facts grounding the story:**
  - `evaluator.evaluate_conditions_traced` is already signal-free (`signals_map` param is `# reserved` —
    entry-rule leaves are component refs); readiness needs no signal input.
  - Current `ListOpportunities` (`servicer.py:2006`) hardcodes `strategy_id=""`, `passing/total=0/0`;
    universe = active signals only (`_drain_active_signals`); held only sets the action tag
    (`_drain_held_symbols`).
  - Snooze is `useState<Set<string>>` keyed on `` `${symbol}-${source}` `` (`opportunities/page.tsx:62,81`),
    disagreeing with the backend per-symbol dedup (`best[sig.symbol]`).
  - `GetStrategyAnalytics.queue_share` reserved `0.0`; watchlist proto has no strategy field; the
    watchlist↔strategy join is UI-only (`WatchlistReadiness.tsx` `useState('')`).
- **Governance flags raised in the spec:** breaking-class proto (deprecate-don't-delete for Watchlist +
  signal-blend fields); DBA migrations in portfolio + analysis; no new DB pool (F-06); C-10 shared-consumer
  parity across TS exhaustive enum maps + agent request builders + `strat-lab` skill.
- **Ledger traps noted (Open Questions):** fails.md 056/060 (shipped producer, forgot shared consumer),
  2026-07-21 C-10(a/d) (proto-enum → exhaustive-TS-`Record` coupling), 2026-08-02 MCP/strat-lab F-12
  (tool-doc/skill drift).
- **Open forks for design:** held-position strategy attribution; watchlist→strategy cardinality across
  multiple watchlists; exact queue ranking-axis composition; deprecation horizon.

## Session 2026-08-03 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready. Verdict: **PASS WITH WARNINGS** (no Floor breach, no blockers).
- Ran the two review subagents to completion (criteria + overlap).
- **Warnings (advisory, carried to /sdd-design):**
  - Open Questions (P-03): 5 unresolved design forks — position attribution, watchlist→strategy cardinality across multiple watchlists, signal ranking-axis composition, deprecation horizon, shared-consumer parity trap. Owned by /sdd-design (matches launched-083 precedent of resolving forks in design).
  - DB migration NNN numbering + cross-service run order deferred to /sdd-spec (C-07).
  - Fixed in spec this session: `taken` is already populated from trading `ListOrders`; only `queue_share` is reserved `0.0` (Problem Statement + FR-7 + AC-5 tightened). Cosmetic FR ordering (FR-8/FR-9) and acceptance numbering (`6a`) corrected.
- **Overlap findings:** no proto field-number / migration-NNN / config-key collision with any live feature.
  - Next-free slots confirmed: portfolio migration **008**, analysis migration **010**, `portfolio.Watchlist` field **8**, `analysis.Opportunity` field **10**. `ScreenSymbolsRequest.signal_sources=3`/`signal_weight=4` retain numbers under the deprecation path; `StrategyAnalytics.taken=6`/`queue_share=7` already exist (populate only).
  - 098 (`screener-watchlist-fidelity`, code-completed, UI-only) reworked `WatchlistReadiness.tsx`, `watchlists/page.tsx`, added `readinessRollup.ts` — three **rebase-only** UI-file overlaps, no hard merge-order row required. Design recon MUST re-ground on the post-098 components (spec's "UI-only useState('') join" description is now partly stale). `readinessRollup.ts` is a reuse candidate for FR-2/FR-6/FR-7.
  - 099 (`watchlist-live-quotes`) is idea/backlog-blocked — historical context only.
- Rebased branch onto origin/main-dev (02b22f8, includes 098) before review; pushed.

## Session 2026-08-03 — sdd-design

- Phase 0 Recon: wrote recon.md (services: proto, analysis, portfolio, ui, agent). Key reuse: evaluate_conditions_traced kernel, readinessRollup.ts, best-effort-write repo pattern, covers_every_proto_field parity template. Re-grounded UI on post-098 files.
- Phase 1 Grilling: **5 rounds (full)**. No Floor breach. Chosen approach: **materialized `analysis.opportunities` table (mig 011) + lazy compute-on-read + stale-while-revalidate + daily refresh; ListOpportunities becomes a pure read.** Rejected: standing 60s producer loop (unbounded/starvation/user-invisible), event-push ledger subscription (new gated edge), in-memory memo (restart-fragile), readiness_cache table (superseded by inline readiness_json), wall-clock TTL.
- **User design decisions across rounds:** R1 one sequenced feature + compute-on-read; R2 daily-timeframe simplification (dropped wall-clock TTL); R4 preferred DB-backed over in-memory; R5 **lazy + stale-while-revalidate, no standing loop**.
- **Critical adversary catches (verified against code):** (1) `StrategyDefinition.signal_params` is the live-loop symbol universe (`live_loop.py:37-46`) + in the 065 fingerprint (`servicer.py:2556`) — must NOT be deprecated; retire the blend from `RunBacktest.strategy_params` only, keep `combine_score`+ScreenSymbolsRequest for the screener. (2) `analysis.strategies` has NO owner column — strategies are global; no global user-enumeration RPC → known-user set is lazy-seeded from own tables. (3) watchlist binding must re-plumb the WRITE path (request messages), not just the response, or a bare-`symbols` write resets `strategy_id=''` (fails-080). (4) server-authoritative opaque `opportunity_key` (client echoes, never derives) — RC-1 drift guard.
- **Constitution rules touched:** C-04/C-05/C-07/C-09/C-10/C-13/C-14, P-03, F-01/F-06/F-07, ANALYSIS-3. All honored (see design.md).
- **8 Open Risks (OR-A..OR-H)** carried to /sdd-spec — see design.md § Open Risks (cold-read behavior, stale-while-revalidate position-state invalidation, refresh_hour_utc zero-trap + calendar label, trading-date key source, known-user enumeration, persisted-row→proto parity test, signal_rank_weight formula, migration run-order + config defaults).
- Status: spec-ready → design-approved.

### Open Threads (target: /sdd-spec)
- OR-A cold-read blocking-vs-async + in-flight guard — analysis read step.
- OR-B closed-position invalidation / staleness bound — analysis read step.
- OR-C refresh_hour_utc off get_int zero-trap; label as daily refresh not "market close" — config step.
- OR-D trading-date key source (GetDataCoverage ref symbol) + calendar residual — analysis compute step.
- OR-E known-user enumeration (own tables + lazy seed) — analysis loop step.
- OR-F persisted-row→Opportunity proto parity test — analysis read step.
- OR-G signal_rank_weight composition formula — analysis ranking step.
- OR-H migration NNN run order + analysis CLAUDE.md config defaults — proto/migration steps.

## Session 2026-08-03 — sdd-spec

- Generated implementation-spec.md with **19 steps**. Status → implementation-ready.
- All 8 Open Risks resolved inline in the steps: OR-A synchronous cold compute + per-user in-flight
  guard (Step 12), OR-B accepted staleness bound + `computed_at` "as of" (Step 12), OR-C
  `refresh_hour_utc` presence-aware read (add `HasField('int_val')` accessor mirroring `get_bool`;
  labeled *configured daily refresh*) (Steps 7+12), OR-D session date from the last fetched bar
  (Step 12), OR-E known-user set = `distinct user_id in opportunities ∪ opportunity_actions`
  (Step 12), OR-F persisted-row→`Opportunity` descriptor-parity test (Step 13), OR-G
  `rank = (1−w)·conviction + w·signal_axis` with `w = analysis.opportunity.signal_rank_weight`
  (Steps 7+12), OR-H portfolio mig **008**, analysis mig **010** (actions) + **011** (opportunities),
  run order 010→011 (Step 6).
- Key codebase findings (grounded):
  - Next-free migrations confirmed by `ls`: portfolio **008** (last `007_watchlists`), analysis **010**
    (last `009_strategy_cooldowns`); design uses 010 `opportunity_actions` + 011 `opportunities`.
  - Proto next-frees confirmed by Read: `portfolio.Watchlist` field **8** (`symbols=5` → deprecate-in-place);
    CRUD req binding fields 4/5/3 (Create/Update/Add); `analysis.Opportunity` fields **10/11**
    (`opportunity_key`, `provenance`). New `OpportunityAction` enum (SNOOZE/DISMISS/TAKE) + `SetOpportunityAction`
    RPC — distinct from the existing `OpportunityActionTag`.
  - `ListOpportunities` (`servicer.py:2006`) becomes a pure read: today's `_drain_*`/`_action_for`/`0-0`
    stubs (`:2032–2064`) deleted; `queue_share=0.0` (`:2183`) made real.
  - Evaluator exit-rule sibling: `evaluate_conditions_traced` (`evaluator.py:171`) traces entry-only at
    `:202–206`; add a `rule=` param (exit_rule already loads at `:158`) — additive-sibling (insights 2026-07-08).
  - Signal-blend retirement is confined to `RunBacktest.strategy_params` (`servicer.py:319–328,813,903–914`);
    `StrategyDefinition.signal_params` (live-loop universe + 065 fingerprint, ANALYSIS-3) and the screener's
    `ScreenSymbolsRequest`/`combine_score` are **untouched** — so the *only* proto deprecation is
    `portfolio.Watchlist.symbols=5` (product-spec's signal-field deprecation was overridden by the design).
  - Portfolio write-path re-plumb (repo `insertSymbolsTx:248`/`listSymbols:217`, service `normalizeSymbols:1061`)
    carries `(symbol, strategy_id)` so a bare-`symbols` write can't reset `strategy_id=''` (fails.md-080 trap).
  - UI: transient snooze `${symbol}-${source}` (`opportunities/page.tsx:81`) → stable `opportunityKey`;
    transient `useState('')` list-strategy picker (`WatchlistReadiness.tsx:60`) → persisted per-symbol binding;
    StrategyWizard `handleSubmit` wholesale `signalParams` rewrite (`:144–149`) → merge preserving
    `signal_params.symbols`. Agent: no watchlist tool exists → agent step is parity tests
    (`test_backtest_view.py:157` template) + strat-lab/mcp-tools doc reconciliation (F-12, same PR).

## Session 2026-08-03 — sdd-review impl-spec (advisory)

- Result: **0 failures, 4 warnings, 2 notes** (advisory — did not block). Overlap: CLEAN. No Floor breach. Every sampled path:line/field-number/migration-next-free resolved exactly; all 5 non-frontend service steps test-paired (C-08), migrations up+down correct (C-07), proto deprecation-only + buf breaking (C-09), red-before-green throughout (P-06), StrategyDefinition.signal_params left untouched (ANALYSIS-3).
- Unresolved ⚠ / ℹ carried into execution:
  - Step 5: `-coverpkg` excludes `service/`/`repository/` — the exact packages Step 4 edits; ≥40% is carried by other packages (mirrors real CI scoping, C-08 met in the letter only). [ ] unaddressed — reviewer's eye during execute.
  - Steps 17 & 18: 6 files each (>5) — consider a thinner slice (fixture/mock/inventory edits). [ ] unaddressed.
  - Step 12 cited `(F-04)` for "no portfolio strategy attribution" and Step 16 cited `(F-12)` for the strat-lab same-PR rule — both mis-tags. [x] FIXED (pre-execute): Step 12 → `(P-03 — no silent guess)`; Step 16 → "root CLAUDE.md strat-lab same-PR rule (a repo rule, not a Floor ID)".
  - Step 1: `buf breaking` ran `--against .git#branch=feature/...` (a self-compare that misses the change). [x] FIXED (pre-execute): now `--against .git#branch=main-dev,subdir=packages/proto` (matches the "vs dev trunk" reviewer note + CI convention).
- Overlap findings: no collision. Forward note (not a 097 blocker): feature 095 (draft) plans to append to `analysis.Opportunity`; once 097's fields 10/11 land, 095 must number 12+ — add a `095 → 097` merge-order row when 095 advances to /sdd-spec (052/053 precedent).

## Session 2026-08-03 — sdd-execute (sequential)

- Mode: SEQUENTIAL on `feature/opportunity-universe-unification` (branched from merged main-dev 33ff5dc; PR #860 docs merged first per user). One commit per step, no per-step PRs, integration PR at end. User confirmed proceed.
- Tooling setup (steps 1–19): go1.25 ✓ · golangci-lint ✓ v2.5.0 · protoc-gen-go ⬇ v1.36.11 · protoc-gen-go-grpc ⬇ v1.6.2 · protoc-gen-connect-go ⬇ v1.19.2 · buf ⬇ v1.69.0 (matches CI) · TS proto plugins ⬇ (pnpm) · python3.12 venv ⬇ grpcio-tools==1.80.0/protobuf 6.33.6 (scratchpad/protogen-venv) · uv ✓ · ruff ✓ · node 22 ✓ · pnpm 9.15.0 ✓.

### Step 1 — proto: Watchlist bindings, Opportunity key+provenance, SetOpportunityAction [done]
- portfolio.proto: added `WatchlistBinding{symbol,strategy_id}`; `Watchlist.symbols=5 [deprecated=true]` + `bindings=8`; `bindings` on CreateWatchlistRequest=4/UpdateWatchlistRequest=5/AddWatchlistSymbolsRequest=3. analysis.proto: `Opportunity.opportunity_key=10`/`provenance=11`; `OpportunityAction` enum; `SetOpportunityAction` RPC + req/resp. StrategyDefinition.signal_params + ScreenSymbolsRequest signal fields left untouched (ANALYSIS-3).
- Verified: `buf lint` + `buf breaking` vs main-dev both pass (deprecation-only).
- Files modified: `packages/proto/portfolio/v1/portfolio.proto`, `packages/proto/analysis/v1/analysis.proto`
- Deviations: buf-breaking `.git` path corrected to repo-root form (CI-equivalent) — see Deviation Log.

### Step 2 — proto-gen: regenerate stubs [done]
- Ran `./scripts/buf-gen.sh` (buf 1.69.0 + pinned Go plugins + TS plugins + python3.12/grpcio-tools 1.80.0). Regenerated Go/Python/TS stubs; 20 changed files, all under `analysis/v1` + `portfolio/v1` (diff limited to the two changed services, matching the CI proto-freshness check). Toolchain pinned to CI versions so stubs byte-match.
- Files modified: `packages/proto/gen/**` (generated)
- Deviations: none.

### Step 3 — migration: portfolio 008 watchlist_symbols.strategy_id [done]
- Added `008_watchlist_symbol_strategy.{up,down}.sql`: up ADDs `strategy_id TEXT NOT NULL DEFAULT ''`; down DROPs it. PK `(watchlist_id, symbol)` unchanged (one strategy per (list,symbol)). Verified offline (up/down parity, next-free 008).
- Files modified: `services/xstockstrat-portfolio/migrations/008_watchlist_symbol_strategy.{up,down}.sql`
- Deviations: none.

## Session 2026-08-03 — sdd-execute (sequential) — session end
**Steps this session**: 1, 2, 3 (done)
**Progress**: 3 done / 19 total
**Stopped at**: before Step 4 (portfolio Go binding write-path). Contract + schema foundation complete (proto, regenerated stubs, migration 008). Stopped ahead of the Step 4–5 Go service re-plumb + red-green TDD to give it a focused pass rather than rush it at the end of a long run.
**Toolchain persisted for resume**: buf 1.69.0 + Go plugins in `$HOME/go/bin`; python3.12 grpcio-tools venv at `scratchpad/protogen-venv`; local `main-dev` ref created for `buf breaking`; pnpm workspace installed.
**Next**: /sdd-execute opportunity-universe-unification sequential  (resumes at Step 4)

### Step 4 — service: portfolio watchlist binding write/read path [done]
- Re-plumbed the write path to carry `(symbol, strategy_id)` pairs. `WatchlistStore.Create/Update/AddSymbols` now take `[]*WatchlistBinding`; new `normalizeBindings`/`requestBindings`/`bindingSymbols` helpers (bindings authoritative, legacy `symbols` → unbound fallback). Repo: `insertBindingsTx` (INSERT symbol+strategy_id ON CONFLICT DO NOTHING → existing binding's strategy_id preserved), `listBindings` (populate `Bindings` + flat `Symbols` mirror). `portfolio_handler.go` unchanged (forwards req whole — see Deviation Log).
- Files modified: `internal/repository/watchlist_repo.go`, `internal/service/portfolio_service.go`
- Verified: `golangci-lint run` → 0 issues (after `//nolint:staticcheck` on the deprecated-mirror reads — see Deviation Log).
- Deviations: handler no-change; SA1019 nolint — Deviation Log.

### Step 5 — test: portfolio watchlist binding round-trip [done]
- Updated `fakeWatchlistStore` to the binding signatures (stores `Bindings`, mirrors `Symbols`); added 3 tests: binding create/get round-trip (strategy_id preserved), **fails-080 regression** (legacy flat add doesn't clear a prior binding), update-replaces-bindings. Existing 8 tests still pass.
- **TDD red→green**: temporarily disabled bindings-precedence in `requestBindings` → `TestBindings_{CreateGetRoundTrip,LegacyAddDoesNotClearStrategy,UpdateReplaces}` all FAIL (`no binding for "AAPL" in []`) → restored → all pass. `go test ./internal/service/ -race` ok; coverage total 53.1% ≥ 40%.
- Files modified: `internal/service/watchlist_service_test.go`
- Deviations: committed with Step 4 (atomic interface change) — Deviation Log.

### Step 6 — migration: analysis 010 opportunity_actions + 011 opportunities [done]
- `010_opportunity_actions` (PK (user_id, opportunity_key); action SMALLINT, snooze_until). `011_opportunities` materialized queue (readiness_json/signal_axis/provenance inline; PK (user_id, opportunity_key); idx on (user_id, valid_until)). 010→011 order (011's daily reader unions both). Reuses existing pool (F-06). Offline-verified up/down parity, next-free 010/011.
- Files modified: `services/xstockstrat-analysis/migrations/010_opportunity_actions.{up,down}.sql`, `011_opportunities.{up,down}.sql`
- Deviations: none.

### Step 7 — config: register analysis.opportunity.* keys [done]
- Declared 5 keys (`max_universe_size`, `valid_window_hours`, `snooze_default_hours`, `signal_rank_weight`, `refresh_hour_utc`) in the analysis CLAUDE.md config table + the config-governance Per-Feature Registered Keys log (097 heading). OR-C: refresh_hour_utc documented presence-aware (not get_int) + labeled a daily refresh (not "market close"). OR-G: signal_rank_weight formula recorded. `analysis.signals.source_weights` left as the screener's (not re-purposed).
- Files modified: `services/xstockstrat-analysis/CLAUDE.md`, `docs/patterns/config-governance.md`
- Deviations: none.

### Step 8 — service: analysis evaluator exit-rule trace sibling [done]
- Added keyword-only `rule: str = "entry"` to `evaluate_conditions_traced`; at the parse point it selects `definition.exit_rule` when `rule=="exit"`, else `entry_rule`. Everything else (component-series assembly, leaf iteration, `_readiness_from_evals`) shared/unchanged; default preserves every existing caller. `evaluate`/`evaluate_with_series`/`_eval_condition` bool contract untouched (live loop + frozen backtest).
- Files modified: `app/services/evaluator.py`
- Verified: ruff check + format-check pass.

### Step 9 — test: analysis evaluator exit-rule trace [done]
- Added `test_exit_rule_trace_selects_exit_leaves` (rule="exit" traces the exit_rule's `<` leaf FAIL vs entry's `>` leaf PASS) + `test_empty_exit_rule_is_zero_of_zero`. Existing traced tests unchanged.
- **TDD red→green**: forced `rule_src = entry_rule` (exit selection off) → both exit tests FAIL (`1 == 0`, traced entry) → restored → 2 passed. Full analysis suite 402 passed, 82.79% ≥ 40% (CI-equivalent — see Deviation Log for the single-file coverage-command substitution).
- Files modified: `tests/test_evaluator_traced.py`
- Deviations: Step 9 coverage command (single-file → full-suite) — Deviation Log.

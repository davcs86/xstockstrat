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
  - Step 12 cites `(F-04)` for "no portfolio strategy attribution" and Step 16 cites `(F-12)` for the strat-lab same-PR rule — both are mis-tags (F-04 = "never invent path/symbol"; no F-12 exists — Floor ends at F-11; the rule is a root CLAUDE.md rule). Obligations ARE discharged; label hygiene only. [ ] unaddressed — retag/drop.
  - Step 1: `buf breaking` verification runs `--against .git#branch=feature/...` while the Reviewer note says "vs dev trunk"; equivalent at fork point, reconcile wording. [ ] unaddressed.
- Overlap findings: no collision. Forward note (not a 097 blocker): feature 095 (draft) plans to append to `analysis.Opportunity`; once 097's fields 10/11 land, 095 must number 12+ — add a `095 → 097` merge-order row when 095 advances to /sdd-spec (052/053 precedent).

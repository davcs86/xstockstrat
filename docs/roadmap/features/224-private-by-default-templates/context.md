# Context: private-by-default-templates

**Feature**: `docs/roadmap/features/224-private-by-default-templates/feature.md`
**Product Spec**: `docs/roadmap/features/224-private-by-default-templates/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/224-private-by-default-templates/implementation-spec.md`

---

## Session 2026-10-06T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature (@AC-1..@AC-25), context.md from user story.
- Origin: operator request in the PR #1219 session (2026-10-05), answering residual 3 ("analysis can still
  execute another user's private formula by id"). The operator asked to "make strategies, custom formulas,
  public signals, and everything else private. Remove the concept of public. Instead, create strategies and
  signal templates that, when saved, become private instances."

### Operator decisions (verbatim answers, 2026-10-05, binding for /sdd-design)

1. **Signals:** "Both sources and signals per user." Each user owns their signal sources, which are
   instantiated from source templates, and the signals ingested into them. QuerySignals, live-loop
   signal_eligible, opportunities and attribution see only the owner's signals. Two users following the
   same newsletter each ingest their own copy.
2. **Templates:** "Admin catalog, snapshot copy." Only admins or seeded code author templates; all users
   can read them. Saving one creates an independent private copy that records origin template id and
   version. The UI may show "template updated" but never mutates the copy.
3. **Migration:** "Just make everything private." Public formulas become private to their author. No
   templates are seeded, so the catalog starts empty. System objects (SYSTEM_AUTHOR formulas and the
   fundamentals_macd_blend id convention) stay special-cased as they are today.
4. **References:** "Deep copy, remove bypass." Instantiating a strategy template deep-copies every
   referenced formula template into the user's private formulas and repoints the strategy at the copies.
   analysis runs formulas only as the strategy owner, and the x-internal-caller formula-read bypass from
   PR #1219 is removed.

### Recon digest (Explore agent, 2026-10-05; re-verify in /sdd-design Phase 0)

- **Formula** is the only entity with `is_public`. The UI lists only public formulas by default, because
  `useFormulas` sends `author_filter=''` and `include_public=true` and the SQL then returns no private rows.
  This is a latent UX bug that FR-1 subsumes.
- **Strategies, watchlists, opportunities and backtests** are already owner-scoped. However,
  `analysis.strategy_scores`, `backtest_run_symbols` and `backtest_details` are keyed by bare
  `strategy_id`, and `GetBacktest` performs no ownership check.
- **Signals and sources** have no owner column (`ingest.newsletter_signals`, `signal_sources` PK `slug`,
  `signal_dedup_keys`). `ManageSignalSource` is admin-only; `QuerySignals` has no user filter.
- **Copy features:** no backend clone or template capability exists. The only template-like things are
  the UI-only `FORMULA_TEMPLATES` and the screener presets.
- **PR #1219 dependency:** this feature removes the `_INTERNAL_FORMULA_READERS` / analysis
  `InternalCallerInterceptor` that #1219 adds. #1219 must merge first, or this feature must account for it.

### Open questions carried to /sdd-review and /sdd-design

OQ-1 through OQ-6 in product-spec.md:

- OQ-1: backfill owner for the global signal data.
- OQ-2: the fundamentals signal producer under per-user signals.
- OQ-3: admin reach over private objects.
- OQ-4: template placement.
- OQ-5: template-to-template references.
- OQ-6: owner of the inbound signal channels.

## Session 2026-10-06 — operator answers OQ-1..OQ-3

The operator accepted the recommended answers ("Go with both"):

- **OQ-1:** backfill global signal sources, signals and dedup keys to `SEED_USER_ID`, the feature-133 precedent (FR-11, @AC-27).
- **OQ-2:** the fundamentals producer emits under a `system`-owned source that is readable by all and immutable (FR-6, @AC-26). This is a third system special case, alongside `SYSTEM_AUTHOR` formulas and the blend-strategy id convention.
- **OQ-3:** admins keep a read-only, audited view of other users' objects and lose the update/delete override on formulas (new FR-13, @AC-28).

OQ-4 to OQ-6 remain for /sdd-design.

## Session 2026-10-06 — sdd-review product-spec

- Pass 1: **FAIL**. C-07 had no migration strategy; P-03 had OQ-4/5/6 unchecked. 11 warnings. All were addressed (commit `181fadc`).
- Overlap scan:
  - Proto field collision: feature 217 owns `StrategyDefinition` field 15, so 224 takes 16+.
  - Hard dependency on PR #1219.
  - Migrations and config keys are clean.
  - Merge-order rows added with operator approval: 224 waits for #1219 and for 217.
- Pass 2: **PASS WITH WARNINGS**. Product spec approved. Status: draft → spec-ready.
- Warnings fixed in this session:
  - The indicators `LEDGER_ENDPOINT` is already wired; only a ledger client is new.
  - AC-20 now asserts `mean_reversion_2`.
  - FR-12 and FR-13 reordered.
  - FR-8 names `GetStrategy`/`ListStrategies`/`ListStrategyDefinitions`.
- **Carried to /sdd-design (must resolve, C-07, ledger 2026-08-14/133):**
  - [ ] **D-1 NULL-owner analysis rows.** `backtest_runs.user_id` is deliberately nullable for legacy runs (`analysis/migrations/015_backtest_runs_user_id.up.sql:2-5`). Child rows in `backtest_run_symbols`/`backtest_details` would stay NULL and abort `SET NOT NULL`. Choose an owner for them, such as `SEED_USER_ID` or a `legacy` sentinel, without deleting data (FR-11).
  - [ ] **D-2 Ambiguous `strategy_id` join.** `strategies` has a composite PK `(user_id, strategy_id)` (`013:27`), so backfilling `strategy_scores` by bare `strategy_id` can match several owners. Define a resolution: duplicate the score row per owner, or match through the latest backtest run's owner.
  - [ ] **D-3 Lossy down on the `strategy_scores` PK swap** (`005:2`). Extend the refuse-if-colliding down policy to it.
  - [ ] **D-4 Fundamentals source identification.** The slug comes from config `analysis.fundsignal.source_slug` (default `fundamentals`), which an ingest migration cannot read. Choose: the literal slug, `source_type='derived'` (ingest `006`), or a `SYSTEM_SOURCE_SLUGS` migration variable.
  - [ ] **D-5** `ingest.newsletter_signals` is a TimescaleDB hypertable. The column add, backfill and `NOT NULL` must account for compression and chunks.

## Session 2026-10-06 — renumbered 220 → 224, merged main-dev

- Renumbered `220-private-by-default-templates` to `224-private-by-default-templates` (`git mv` plus self-references in context.md, product-spec.md and merge-order.md). PR #1220 landed on `main-dev` claiming `220-fix-trader-position-fundamentals`, `221`, `222` and `223` while this feature was mid-pipeline on its branch. Per the Feature Numbering collision rule (root CLAUDE.md), the not-yet-executed feature renumbers to `max+1`, re-derived across `main-dev` and all remote `feature/*`/`claude/*` branches. Same procedure as 117→118 (merge-order.md).
- Merged latest `main-dev` (which includes PR #1219, merged as `69c8554`, and #1220).
- **#1219 dependency is now satisfied.** `_INTERNAL_FORMULA_READERS` (indicators) and `app/internal_caller.py` (analysis) exist on this branch for FR-1/FR-3 to remove. The merge-order row is marked resolved.
- The `@AC-*` IDs and FR numbers are unchanged (the IDs are per-feature).

## Session 2026-10-06 — sdd-design Phase 1, round 1 (full mode)

- **Proposer:**
  - per-service template catalogs (indicators/ingest/analysis) with shared `common.v1` `TemplateKind`/`TemplateMeta`/`TemplateOrigin`;
  - FR-9 as an analysis-orchestrated saga (intent row, pending-hidden formula copies in indicators, commit/abort, reconcile);
  - owner threading via a per-owner evaluator before bypass removal;
  - ingest `system` owner via a portfolio-style `{callerID,rpc}` allow-list;
  - D-1..D-5 resolutions;
  - mcp credential re-keyed through a new config secret-write grant.
- **Adversary:** NEEDS WORK, **no Floor breach**. Surviving objections:
  1. **C-16 regression:** `resolve_fundamentals_universe` (`live_loop.py:157-163`) reads signals with no identity, so the blend universe goes dark (`@feature-168/160/190`). It needs a system-only read.
  2. **Slug shadowing:** a user can register the slug `fundamentals`, which poisons the blend and the `{slug: weight}` maps. Reserve system slugs.
  3. **Header precedence:** `_SYSTEM_META` duplicates or drops headers on the manual scan path. Strip the inbound user/scope, keep trace; the grant wins.
  4. **Grant scope:** drop the unused `QuerySignals` grant; bind the `system` write grant to the mTLS peer SAN.
  5. **Rollback safety:** the PK swap and `DROP DEFAULT` break old code on rollback, so use expand-then-contract.
  6. **Unguarded default:** `SEED_USER_ID` DEFAULT has no unrendered-value guard; generalize the envsubst.
  7. **Scoring formula:** verify `analysis.fundsignal.scoring_formula_id` is `SYSTEM_AUTHOR` in staging and prod before bypass removal.
  8. **Missing FR-13 path:** the strategies admin-read path.
  9. **Backtest grades:** an unreadable-formula hold must not feed them; mark and exclude. Evict the indicators cache on abort.
  10. **Saga hardening:** a periodic sweep, a batched transactional copy, owner-checked commit, and a retired-template rule.
  11. **jscpd:** record the duplication rationale.
  12. **Config scope:** the secret-write grant is out of spec scope, needs config-team sign-off, should be narrowed, and should use an opaque credential key.
  13. **CHANGE sign-off:** `@feature-161 @AC-4/@AC-5` needs operator sign-off; register in `NAV_GROUPS` (and `PLATFORM_SUBNAV`).
  14. **Index:** add a `user_id` index on `newsletter_signals`.
  15. **D-1 alternative:** leave legacy NULL-owner runs NULL and unreadable instead of assigning them to `SEED_USER_ID`.
- **Verified:** evaluator GetFormula failures are tolerated (`evaluator.py:554,581`); the `@feature-127` auto-add is agent-side; the evaluator is stateless.
- **Gate:** round 1 < mandated 2, so approval is not offered yet; operator decisions are requested for the next round.

### Operator decisions at the round-1 gate (2026-10-06), binding for round 2+

- **C-16 CHANGE signed off:** `@feature-161 @AC-4/@AC-5` (`services/xstockstrat-ui/acceptance/surface-signal-weight-decay-config.feature`) are re-homed to `/insights/signal-sources`. Their assertions stay the same and only the route changes. `/config-ui/sources` becomes the FR-13 admin read-only view. Signed off by the operator on 2026-10-06.
- **MCP credentials go to per-user secrets in config.** This is an explicit operator override of feature 147's "secret keys (`is_secret`) are global-scope only" invariant (`config.proto:133-135`). Config secrets may now carry a `user_id`.
  - `xstockstrat-config` joins Affected Services.
  - The config-team approval gate applies.
  - Scope reaches `GetSecret` (owner-scoped resolution), `WatchConfig`/`GetConfig`/`ListKeys` redaction (it must hold per user), and the `SetConfig` per-user secret write path.
  - Feature 147's 3-guard pattern stays: encrypt at rest, redact on every edge, decrypt only through `GetSecret` for allow-listed internal callers.
- **Legacy backtest runs whose owner is ambiguous go to `SEED_USER_ID`** (D-1). The owner is resolved when exactly one exists; otherwise the run goes to `SEED_USER_ID`, and `backtest_runs.user_id` is then `SET NOT NULL`. The operator accepts that the seed user receives the history of ambiguous runs.
- **System sources are merged and marked read-only.**
  - `ListSignalSources`/`QuerySignals` return the caller's own rows plus `system` rows, flagged system and immutable.
  - System slugs are reserved: no user may register or own a slug held by `system`.
  - FR-4 is amended accordingly.

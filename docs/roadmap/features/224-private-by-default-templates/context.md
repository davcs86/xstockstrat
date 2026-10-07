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

## Session 2026-10-06 — sdd-design Phase 1, round 2 (full mode)

- **Proposer (round 2):**
  - headerless ingest reads return system rows only;
  - write-as-system grants are bound to the mTLS peer SAN;
  - expand/contract migrations (expand: indicators 007, ingest 013, analysis 026; contract: ingest 014, analysis 027);
  - batched transactional saga copy;
  - hard-delete on abort;
  - pending rows never cached;
  - `DurableSchedule` reconcile;
  - config per-user secrets reuse `config_values.user_id`, with exact-scope `GetSecret` and opaque UUID keys;
  - FR-13 admin read in analysis.
- **Adversary (round 2):** NEEDS WORK, **no Floor breach**. Surviving objections:
  1. **Expand is over-scoped.** Only two N-1 `ON CONFLICT` targets exist: ingest dedup (`servicer.py:871`) and analysis scores (`strategy_scores.py:48`). Keeping the old PKs makes AC-8/9/35 impossible in release N. Fix: swap the `signal_sources` PK in N, and move the two upsert targets into **new owner-keyed tables**, leaving the old tables for N-1. Contract becomes a table drop. D-3 goes away, and D-2 becomes a recompute.
  2. **Headerless system-only reads cause silent data loss.** The pnl snapshot and the live-loop drain are headerless today (`@feature-042/029/176`). Thread all analysis→ingest headers in step 2, make headerless reads fail closed, and allow a SAN-bound `analysis-system-read` grant only.
  3. **Migrations must re-run from 001.** `db-migrate.sh` dirty-state recovery re-runs from 001, so every new up-file must be idempotent on both the expanded and contracted schema. Add a CI chain-twice test.
  4. **Legacy credential refs can exfiltrate the seed bearer** through a user-controlled url. Add a migration-only `credential_scope=LEGACY_GLOBAL` column that no RPC can set and that is cleared on any ref write.
  5. **Bind the config `GetSecret` ingest grant** to peer SAN `xstockstrat-ingest`. Today any mTLS client with `x-internal-caller: ingest` can decrypt secrets, and per-user secrets widen that.
  6. **The bypass-removal runtime gate cannot be satisfied inside the pipeline** (F-03). Verify at design time instead (done, see below). Fundsignal must fail closed on a non-system formula, never fall back to the built-in scorer.
  7. **The contract step has no lifecycle home.** Make it a named follow-up feature, and add a CI `migration-contract-gate` (`-- contract-of:` header, expand file must already be on `origin/main`, never in the same PR).
  8. **A template can create a protected blend.** `InstantiateTemplate` must reject the *configured* blend id, both as the default and as a caller override (`@feature-186`).
  9. **Saga commit vs reconcile race.** Use compare-and-swap intent transitions: PENDING→COMMITTED in the strategy txn; PENDING→ABORTING before an abort.
  10. **Performance.** Fetch the system signal set once per cycle, use owner-only drains, add a `SignalScope` enum on `QuerySignalsRequest`, and index `(user_id, ingested_at DESC)`.
  11. **Who sees `audit.admin_read`** (owner's export vs admin's) is a product decision for the operator, as is the event volume.
  12. **Verify-now items:** done, see below.
  13. **Nav:** `PLATFORM_SUBNAV` is legacy and inert; registering there only satisfies C-10(a)'s wording. Record the rationale.
- **Design-time verifications (2026-10-06, staging, read-only via the staging MCP + repo):**
  - `analysis.fundsignal.scoring_formula_id` = `d1ff5e6b-6d9c-589d-b95e-defd862c702b`, the seeded `SYSTEM_AUTHOR` formula. Removing the bypass is safe on staging. **Prod could not be checked from this session** (staging MCP only), so this is carried as a pre-merge operator check.
  - The staging signal sources have exactly **one** `derived` source, `fundamentals`, so the D-4 "derived ⇒ system" rule is safe on staging. There are **no `mcp_client` sources on staging**, so no legacy credential data exists there.
  - `instance_count: 1` for indicators/ingest/analysis/config in both `.do/app.yaml` and `.do/app.dev.yaml`.

### Operator decisions at the round-2 gate (2026-10-06)

- **Run round 3** and fold in all 13 round-2 objections. Approval was available but deferred.
- **`audit.admin_read` goes on both streams:** one event carrying the owner's `user_id` (stream `user:<owner>`) and one carrying the admin's `user_id` (stream `user:<admin>`). Event volume therefore doubles; the design must state how many events one list call emits.
- **Contract migrations move to a named follow-up feature.** 224 ships expand-only. A separate follow-up feature (number assigned at `/sdd-spec` or story time) runs the contract migrations. It is gated by a `merge-order.md` row plus a new CI `migration-contract-gate` that refuses a contract file until its expand file is on `origin/main`. That satisfies C-14's "named follow-up" form for deferral.

## Session 2026-10-06 — sdd-design Phase 1, round 3 (full mode)

- **Proposer (round 3):**
  - Data: the `signal_sources` PK swaps in N. New owner-keyed tables `ingest.signal_dedup_claims` and `analysis.strategy_scores_v2` (filled by boot recompute). A BEFORE INSERT owner-fill trigger handles N-1 writes. `db-migrate.sh` gains a generalized `-- requires-env` header.
  - Access: headerless reads and writes fail closed, except SAN-bound `analysis-system-read`/`analysis-system-write`. `GetSecret` is exact-scope and SAN-bound. A `credential_scope` trigger resets on edits.
  - Process: idempotent up-files plus a `migration-rerun` CI job. A `migration-contract-gate` CI job.
  - Identity threading moves first; it adds the previously missed `entry_backfill.py:96`.
  - `SignalScope` enum; fundsignal fails closed; template blend guard; saga CAS; audit 1+M events per page, failing closed.
- **Adversary (round 3):** NEEDS WORK, **no Floor breach**. Claims refuted by code read:
  1. **"Release N reads/writes only owner-keyed tables" is false.** `backtest_run_symbols.fetch_eligible` is keyed by `strategy_id`+fingerprint with no owner (`backtest_run_symbols.py:70-76`). Template instances share a fingerprint, so grades pool across users and `@AC-21` fails. The in-memory `_strategies`/`_recompute_locks`/`hydrate_scores`/`ListStrategies` filter are bare-keyed (`servicer.py:504,2272-2278,2489,2498`). Fix: scope the evidence by owner (join `backtest_runs` or add `backtest_run_symbols.user_id`), re-key the maps to `(user_id, strategy_id)`, and seed `scores_v2` in SQL for unambiguous ids, recomputing only the ambiguous pairs with a dedicated bound.
  2. **The N-1-on-N signals trigger leaks.** Assigning "system, else SEED" files Bob's private signals under the seed user on rollback. The N-1 `mark_source_*` calls corrupt every owner's counters. Fix: the trigger resolves the unique holder of the slug, else raises (N-1 fails closed).
  3. **The expand file re-creates triggers on every dirty replay**, even after the contract dropped them. Create them only in the one-shot branch or behind a contract marker, and assert that in the CI rerun.
  4. **The 013-style unrendered guard is conditional** (it raises only when `missing>0`). Files that embed the seed in a function or default need an unconditional guard. The CI rerun must render the files first.
  5. **The `credential_scope` trigger watches `url`**, but `mcp_client` uses `config_json.mcp_endpoint` (`signal_sources.py:226`). Reset on any `config_json` or `credentials_ref` change.
  6. **The reserved `system` identity is not enforced anywhere** (no `x-user-id: system` rejection exists). indicators `RegisterFormula` with header `system` yields a world-readable, undeletable formula. Add one rule across ingest, indicators and analysis: PERMISSION_DENIED without the SAN grant. Identity ids are UUIDs (`identity/001:7`), so there is no collision.
  7. **The `@feature-186` REGISTER guard assumption is false.** Only DEACTIVATE and set-non-live are guarded, and the blend is user-registered rather than seeded. The template guard alone gives no parity. **Operator decision.**
  8. **The rollout is not rollback-safe at the RPC layer.** Identity threading and fail-closed enforcement in the same prod release mean a rolling deploy or an analysis-only rollback sends headerless calls, which darkens the blend and rejects fundsignal (C-16 `@feature-160/168/190`). Fix: two-phase cutover, where ingest accepts headers in release N and enforces in a follow-up release. **Operator decision.**
  9. **Fail-closed audit volume:** 1+M sequential appends against a ledger with `DB_POOL_MAX=1`. Emit zero events for pages with no foreign objects, and make the appends concurrent and bounded.
  10. **Smaller items:**
      - ManageSignalSource has no DELETE (`ingest servicer.py:70-73`), so there is no tombstone.
      - An empty-value secret decrypts as `found:true ''`, so the poller must treat `''` as missing.
      - The reverse slug race (a reconfigured system slug that a user already holds) must fail loudly.
      - The hypertable should use a fast-default `ADD COLUMN`, then `UPDATE` the system slugs, then `DROP DEFAULT`; record the prod row count.
      - Parse SAN as a comma list. `getAuthContext()` exists in grpc-js 1.14.4.
      - Seed `signal_dedup_claims` owner via `signal_id`→`newsletter_signals.user_id`.
      - C-18: make `LEGACY_GLOBAL` conditional on the prod `mcp_client` count, and record the removal of the `_builtin_score` fallback as deliberate.
  - **F-01 note:** keep the hardcoded analysis-013 envsubst branch in `db-migrate.sh`. Adding a header to 013 would edit an applied migration.
- **Verified OK:** N-1 has no `ON CONFLICT` on `signal_sources`; BEFORE ROW triggers are supported on hypertables; exact-scope `GetSecret` does not break marketdata (empty `user_id` → `IS NULL`).

### Operator decisions at the round-3 gate (2026-10-06)

- **Two-phase RPC cutover.**
  - **Release N (feature 224):** ingest, indicators and analysis accept and honor the owner headers but still tolerate headerless calls with today's behavior. The analysis, agent and UI threading ships in N.
  - **Named follow-up feature** ("224 enforce + contract"): this is the same follow-up already approved for the contract migrations. It turns on fail-closed for headerless reads and writes, drops the N-1 owner-fill triggers and old tables, and sets `backtest_runs.user_id` NOT NULL.
- **Blend guard on REGISTER and on templates.** `ManageStrategy` REGISTER and `InstantiateTemplate` both require the ADMIN bit to create the *currently configured* `analysis.engine.fundamentals_blend_strategy_id`; everyone else gets FAILED_PRECONDITION. The operator's admin path keeps working. This closes a pre-existing `@feature-186` gap, classed as EXTEND (a new guard; no existing guarantee is weakened).
- **Run round 4**, folding in the round-3 fixes, then decide.

## Session 2026-10-06 — sdd-design Phase 1, round 4 (full mode)

- **Proposer (round 4):**
  - Release N is expand-only, with an RPC layer that tolerates headerless calls.
  - The named follow-up "224 enforce + contract" does five things:
    - turns on fail-closed;
    - removes the indicators bypass;
    - re-backfills NULL owners, then sets NOT NULL;
    - drops the N-1 triggers and the old tables;
    - refuses down migrations.
  - `x-user-id: system` needs a grant bound to the peer SAN.
  - Analysis threads the owner through; the in-memory maps are re-keyed to `(user_id, strategy_id)`; `backtest_run_symbols.user_id` is added; `strategy_scores_v2` is seeded in SQL for unambiguous ids.
  - Ingest 013 contains:
    - the PK swap;
    - the N-1 owner-fill trigger (it fills the unique slug holder, otherwise it raises);
    - `signal_dedup_claims`;
    - a conditional `credential_scope`.
  - Per-user config secrets.
  - Audit emits 0 or 1+K events per page and fails closed.
  - Tooling: the `db-migrate.sh` header scan and the `migration-rerun` and `migration-contract-gate` CI jobs.
  - Build order for N: steps 0–13.
- **Adversary (round 4):** NEEDS WORK, **no Floor breach**, and no item needs a design change. Amendments:
  1. **Manual `RunFundamentalsScan`:** every fundsignal ingest and indicators call, on both the loop path and the manual path, replaces `x-user-id` with `system`, adds `x-internal-caller: analysis-fundsignal`, and keeps `x-trace-id`.
  2. **AC-36 conflicts with the design.** A user registering a reserved slug gets `ALREADY_EXISTS`. System registering a slug a user already holds keeps `FAILED_PRECONDITION`.
  3. **AC-6 can't be observed.** An empty `scoring_formula_id` uses the built-in scorer and never calls `ExecuteFormula`. AC-6 needs amending, plus a fail-closed scenario.
  4. **`@feature-185`:** a `NOT_FOUND` from an unreadable formula maps to "component skipped + warning" on all six evaluator surfaces, never to the data-unavailable marker.
  5. **Headerless `IngestSignal` in N:** resolve the unique slug holder; zero holders or more than one gives `FAILED_PRECONDITION`. Indicators Update/Delete keep the body `user_id` fallback in N.
  6. **AC-28 branch order:** `ExecuteFormula` on a formula the caller can't read returns `PERMISSION_DENIED` for an admin and `NOT_FOUND` for a non-admin.
  7. **Build order:** swap step 7 (the ingest poller's exact-scope `GetSecret`) with step 8 (config per-user secrets).
  8. **Build order:** the blend-guard helper lands in step 9; step 10 calls it and tests it.
  - **Call sites to list in the spec, each with a test, plus a CI assertion.** Every analysis→ingest call site:
    - `live_loop.py:157`, `live_loop.py:457`
    - `entry_backfill.py:96`
    - `pnl_pattern_consumer.py:378`
    - `servicer.py:5188`, `servicer.py:5212`, `servicer.py:5306`
    - `screener.py:320`
    - `fundsignal_loop.py:450`, `fundsignal_loop.py:479`
  - **Doc drift (verified):** indicators has no ingest caller. The root CLAUDE.md dependency line `xstockstrat-indicators → xstockstrat-ingest` is stale. Fix it at teardown.

### Operator decisions at the round-4 gate (2026-10-06)

- **Run round 5**, the hard cap. After it the only options are approve, accept documented risks, or stop.
- **AC-6 is amended** (same `@AC-6` id, text only). Its Given becomes "`scoring_formula_id` is set to system formula `d1ff…`". A new **AC-37** is added: when the configured scoring formula is not system-owned, the scan emits nothing, raises an ERROR and a notify alert, and does not fall back to the built-in scorer.
- **Audit volume is 1 + K per page** (K = distinct foreign owners). The admin's stream gets one event carrying all the ids; each owner's stream gets one event carrying only that owner's ids. A page that holds only the admin's own objects emits no event.

## Session 2026-10-06 — sdd-design Phase 1, round 5 (full mode, hard cap)

- **Proposer (round 5):** the consolidated final design, with all 8 round-4 amendments verified against the code.
  - **Amendment 5 is corrected:** a headerless `IngestSignal` with **0** slug holders stays `INVALID_ARGUMENT`, which preserves today's behavior (`ingest servicer.py:824-825` → `:792-793`). Only **more than 1** holder returns `FAILED_PRECONDITION`.
  - **New call site:** `servicer.py:3458` (`_resolve_source_names`).
  - **Now owner-scoped in step 3:** `GetStrategyAnalytics list_by_strategy` (`servicer.py:5292`), which was bare-keyed.
  - **Build order:** steps 7 and 8 swapped (config per-user secrets come before the ingest poller); the blend-guard helper is in step 9 and is called by step 10.
- **Adversary (round 5):** **APPROVE-WITH-AMENDMENTS**, no Floor breach (F-01 numbers free: indicators 007, ingest 013, analysis 026). Amendments to fold into design.md:
  - **A. Verifying the peer SAN.**
    - All three Python services pin grpcio 1.80.0.
    - Step 1 adds a spike test on the real mTLS harness (`ingest tests/test_mtls.py:122-160`) that does two things:
      - checks `peer_identity_key()=="x509_subject_alternative_name"` and requires an exact match in `peer_identities()`;
      - fails closed when the transport is non-SSL or the context is a mock.
    - Shared helper per service.
    - Config `hasSecretCallerAuthority` (`authz.ts:129-142`) must also take the call object.
  - **B. Backtest evidence (`C-16` `@feature-065`).**
    - Problem: an all-None evaluator result in a backtest becomes a buffered zero-trade cell, which counts as evidence (`servicer.py:873-877`, `:1059-1061`).
    - Fix: in backtest mode, an unreadable formula **raises** `FormulaExecutionError`, which goes to FORMULA_ERROR and is excluded from evidence (`:912-926`).
    - Only the other five surfaces map NOT_FOUND to "skipped + warning".
    - Test: no `backtest_run_symbols` row is written for the symbol.
  - **C. N-only indicators bypass.** The `x-internal-caller: analysis` reader is bound to the `xstockstrat-analysis` SAN, so it is no longer header-only.
  - **D. CI call-site check.**
    - The AST "passes `metadata=`" check is replaced by a runtime interceptor test: every ingest **and** indicators stub call must carry a non-empty `x-user-id`.
    - Indicators call sites to add:
      - analysis `servicer.py:552,578,1562,2100`
      - `evaluator.py:549,576`
      - `screener.py:342`
      - `fundamentals_scoring.py:52`
  - **E. Status codes, recorded explicitly.**
    - The round-4 amendment 5 reversal (0 holders → `INVALID_ARGUMENT`).
    - A headered call on an unregistered slug changes from `INVALID_ARGUMENT` to `NOT_FOUND` (AC-10). Agent `client.py:240-244` passes errors through.
  - **F. Fundsignal registration (`C-16`).**
    - The `_source_registered` flag is keyed on the slug (`fundsignal_loop.py:83,444` vs `:161`).
    - A headered `NOT_FOUND` on `IngestSignal` as `system` aborts the cycle and raises an ERROR alert.
  - **G. One blend-id accessor (C-18 DRY)** covering all five read sites: `servicer.py:2754,2882,4343`, `live_loop.py:337`, `entry_backfill.py:87`.
  - **H. Reserved slugs and caps (F-07).**
    - "Reserved" means "slug already held by `system` in the DB"; there is no literal list.
    - The audit append concurrency and boot-recompute bounds become documented invariant caps or config keys.
  - **Risks:**
    - Ledger `DB_POOL_MAX=1` serializes the 1+K appends, so set a per-page K ceiling.
    - The step 2–5 window is only test-order sensitive, never deployed: AC-37 tests assert the pre-flight decision.
    - `_formula_outputs` swallows NOT_FOUND (`servicer.py:557-558`), so AC-30's warning must precede the "unknown series" rejection.

### Operator decisions at the round-5 gate (2026-10-06)

- **The design is approved, with round-5 amendments A–H folded into design.md as binding text.**
- **Bounds are fixed invariant caps, not config keys.** The audit append concurrency is 4. The per-page K ceiling equals the max page size. The boot recompute handles 50 pairs per pass. These are named constants with a stated rationale, so the config-team gate does not apply.

## Session 2026-10-06 — sdd-design

- **Phase 0 Recon:** wrote recon.md, covering indicators, ingest, analysis, config, agent and ui. Main reuse patterns: the portfolio `authz.go` x-internal-caller allow-list, and the feature-147 secret 3-guard model.
- **Phase 1 Grilling:** 5 rounds, full mode.
  - **Chosen:** release N is expand-only and header-tolerant, with all owner threading, a SAN-bound `system` identity, owner-keyed tables, per-user config secrets, the template saga, and the 1+K audit. The named follow-up "224 enforce + contract" turns on fail-closed and runs the contract.
  - **Rejected:** a big-bang enforcement release, and keeping the old PKs (full list in design.md).
- **Constitution rules touched:** F-01, F-03, F-06, F-07, F-11, C-07, C-10, C-11, C-14, C-15, C-16, C-18, P-02, P-03. No Floor breaches.
- **acceptance.feature:** AC-6 Given amended, AC-36 extended to cover both directions, AC-37 added.
- **Status:** spec-ready → design-approved.

### Open Threads (from design.md Open Risks)

- **Before the integration PR:** verify the prod `analysis.fundsignal.scoring_formula_id`.
- **/sdd-spec step 6:** the prod `mcp_client` count decides whether `credential_scope` ships.
- **Step 1:** a grpc.aio peer-SAN spike test must pass before steps 5–7.
- **Step 5:**
  - set the audit K ceiling against ledger `DB_POOL_MAX=1`;
  - make the AC-30 warning fire before the "unknown series" rejection.
- **Step 2:** AC-37 tests assert the pre-flight decision, not an indicators denial.
- **At /sdd-spec:** create the follow-up "224 enforce + contract" and add its merge-order row.

## Session 2026-10-06 — AI review of design.md (spec-reviewer + feature-overlap)

- **spec-reviewer:** PASS WITH WARNINGS. No blocker and no Floor breach. All warnings are folded into design.md:
  - `ListBacktests` is now owner-scoped (`servicer.py:2558` → `backtest_runs.py:80-84`). Without this, AC-21 fails.
  - New §5 "Template catalog" settles OQ-4 as per-service. It also covers admin authoring, version bumps, retire, the empty catalog, update-available on every Get/List path, and AC-34.
  - New text for FR-1 list/write behavior, the D-4 system-slug rule, removing the ManageSignalSource admin gate, and the system-source `PERMISSION_DENIED`.
  - The `ComputeIndicator` call sites are added, and `_strategies` is corrected to `:417`.
  - F-03 and C-07 citations are corrected. C-03, C-04, C-09, C-10(c) and C-17 are added.
  - ANALYSIS-2/3 is relabelled as a runtime invariant (not an `@AC-*`).
  - The 50-pair cap is recorded, and "rounds 1–5" is fixed.
  - Step 1 now spikes the grpc-js SAN check as well as grpc.aio.
  - Open risks now have targets.
  - AC-24's wording now matches the `NAV_GROUPS` decision; it is mirrored in `PLATFORM_SUBNAV`.
- **feature-overlap:** CLEAN.
  - The only collision is 217's `StrategyDefinition` field 15, already settled (224 uses 16+).
  - Fixes applied:
    - `merge-order.md` row 72 said the agent tool count was 52. The trunk count is 43, which reaches 45 after 224.
    - Proto field numbers are now given per message in build step 0.
  - New open risk: feature 084's droplet `db-migrator` env needs `SEED_USER_ID`.

## Session 2026-10-07T00:00:00Z — sdd-spec

- Wrote implementation-spec.md: 41 steps, all 37 `@AC-*` scenarios mapped to a step's `**Covers**`. Status design-approved → implementation-ready.
- **Order change from design §12:** each service's migration lands before the code that reads it. Analysis `026` (Step 6) now comes before analysis threading (Step 7), because `_persist_backtest_run` writes `backtest_runs.user_id` and backtest-details retention is scoped by owner. The design's other constraints still hold:
  - analysis threads the owner header before indicators SAN-binds the bypass and the interceptor is removed (Steps 7–17);
  - config per-user secrets ship before the ingest poller (Steps 21 → 23);
  - the blend helper ships before the saga (Steps 25 → 31).
- Key codebase findings:
  - **Migration numbers** are free on every remote branch (git ls-tree scan, 2026-10-07): indicators `007`, ingest `013`, analysis `026`. Feature 217's `StrategyDefinition.sector_param_overrides = 15` is already on trunk, so 224 uses field 16.
  - **Line numbers have moved since design.md** (217 merged). The spec cites the current lines:
    - analysis→ingest calls: `live_loop.py:157,457`, `entry_backfill.py:96`, `pnl_pattern_consumer.py:109` (owner at `:188`, `_compose` at `:357`), `servicer.py:3540,5270,5294,5388`, `screener.py:320`, `fundsignal_loop.py:450,479`;
    - analysis→indicators calls: `evaluator.py:440,455,528,579,606`, `servicer.py:556,582,1325,1335,1628,2180`, `screener.py:293,342,359`, `fundamentals_scoring.py:52`;
    - blend-id reads: `servicer.py:2834,2962,4425`, `live_loop.py:337`, `entry_backfill.py:87`.
  - **`SEED_USER_ID`** is already wired at all three run sites (`docker-compose.yml:103`, `.do/app*.yaml:678/680`, `.env.example:27`). The analysis-013 envsubst branch (`db-migrate.sh:72-89`) stays untouched (F-01). The new `scripts/render-migrations.sh` handles the `-- requires-env:` headers.
  - **CI** has no migration job today. Step 3 adds `migration-rerun` (Timescale service container) and `migration-contract-gate`. The DB-backed AC-15/AC-22/AC-27 assertions run inside `migration-rerun` (Step 33).
  - **Indicators `LEDGER_ENDPOINT`** is already in every deploy file, so Step 14 needs no deploy-file change.
  - **e2e:** no IndicatorsService mock exists. Step 39 adds a minimal one on port 9092 and sets `INDICATORS_ENDPOINT`, so the router-traversing api-smoke checks can run (fails.md 2026-10-05).

### Decisions

- **Spec-level elaborations.** These are not decided in design.md; each is listed in the impl-spec Execution Summary for `/sdd-review impl-spec` to confirm or reject:
  1. FR-13 owner-selector fields: `ListSignalSourcesRequest.owner_user_id=2`, `QuerySignalsRequest.owner_user_id=7`, `GetStrategyRequest.owner_user_id=2`, `ListStrategyDefinitionsRequest.owner_user_id=4`. `ListFormulasRequest.author_filter` is reused as the admin owner selector.
  2. Saga visibility: an internal indicators `ResolveTemplateIntent(intent_id, commit)` un-hides or hard-deletes the pending copies. Intent states run `PENDING→COMMITTED→FINALIZED` or `PENDING→ABORTING→ABORTED`.
  3. Three template RPCs per service, no `GetTemplate` (YAGNI).
  4. `StrategyScore.origin = 8`, for FR-8 parity on `ListStrategies`.
  5. A headerless `ManageSignalSource` REGISTER of a new slug gets `FAILED_PRECONDITION`, since only `analysis-fundsignal` may write as `system`.
  6. Saga sweep constants (`_INTENT_STALE_SECONDS=900`, `_INTENT_SWEEP_SECONDS=300`) are invariant constants, not config keys.
  7. `GetAttribution` filters to the caller-visible own + system source set, which fixes AC-12 for legacy unscoped snapshots.
- **ManageSignalSource has no DELETE verb** (`ingest.proto:191-197`). FR-4 "delete" maps to DEACTIVATE. No new verb is added (C-18).

### Open Threads

- **Step 18 operator gate:** prod `mcp_client` row count. If 0, `credential_scope` is omitted; if > 0, it ships.
- **Step 5 gate:** if the SAN spike fails, Steps 14/19/21 switch to the cert-parsing fallback (record in the Deviation Log).
- **Pre-integration:** verify the prod `analysis.fundsignal.scoring_formula_id` (carried from design).
- **Step 41** creates the follow-up "224 enforce + contract" and its merge-order row before the integration PR.
- **`/sdd-review impl-spec`** must confirm or reject the seven elaborations above.

## Session 2026-10-07 — sdd-review impl-spec (advisory)

- Result: 4 failures, 19 warnings (advisory — did not block). Overlap: CLEAN.
- Operator decisions (2026-10-07): approve tool count 43 → 45 (C-16 CHANGE of @feature-214 @AC-1); extend the round-5 fixed-constant ruling to `_INTENT_STALE_SECONDS`/`_INTENT_SWEEP_SECONDS`; merge-order row 72 marked resolved.
- All seven spec-time decisions ACCEPTED by the reviewer (decision 2 conditional on the Step 31 grant fix; decision 7 legacy-slug attribution edge accepted for pre-feature data).
- Findings carried into execution (all addressed in implementation-spec.md before execution started):
  - Step 19/20/23: `list_all_sources` SELECT lacks `user_id`/`credential_scope` read by `poll_one_source`; Step 19 adds them, Step 20 tests it — [x] addressed in spec
  - Step 27/31/17/32: saga calls to indicators lacked a grant; dedicated SAN-bound `analysis-template-saga` caller id, exact request/sweep metadata, Step 17 exemption, Step 32 assertions, retired/missing formula template → whole saga `NOT_FOUND` — [x] addressed in spec
  - Step 37: exact Files (`configUiIndicatorsClient.ts` create, `configUiBff.ts` IndicatorsService wiring, `indicatorsClient.ts` entry removed); `mcp_client` bearer prompt moved to Step 38 — [x] addressed in spec
  - Step 41: explicit follow-up files, NNN resolved at `/sdd-story` and logged in the Deviation Log, merge-order row pre-reserves analysis 027 / indicators 008 / ingest 014 — [x] addressed in spec
  - Step 1: deprecated `is_public`/`author` in `FormulaTemplate.payload` ignored on instantiate; `ListStrategyDefinitionsRequest.owner_user_id` documented admin-only — [x] addressed in spec
  - Step 2: generated-code directory in Files is the accepted convention — [x] addressed in spec
  - Step 3: ci.yml `scripts/**` filter cite fixed to `:67-68`; `migration-contract-gate` restricted to `pull_request` — [x] addressed in spec
  - Steps 4, 5, 33, 39: explicit coverage lines (Step 5 runs the full ingest suite at `--cov-fail-under=40`) — [x] addressed in spec
  - Step 6: `strategy_scores_v2` seed uses explicit column lists on both sides — [x] addressed in spec
  - Step 7: un-granted `system` in analysis resolves to owner `""`, recorded as a deliberate divergence (also in design.md §2) — [x] addressed in spec
  - Step 8: AC-37 test case for the `RunFundamentalsScan` manual path — [x] addressed in spec
  - Step 9: `audit_admin_read` forwards the trio on the ledger `AppendEvent`; trio grep in Steps 9 and 19 Verification — [x] addressed in spec
  - Step 14: evidence path `app/services/seed_formulas.py`; per-service `admin_audit.py`/`peer_identity.py` rationale (also in design.md Rejected Alternatives) — [x] addressed in spec
  - Step 19: Verification catches every `slug = $N` incl. multi-line SQL and requires an owner predicate; dead `get_active_source` deleted — [x] addressed in spec
  - Step 20: extend the existing `_ctx` builder (`user_id`, `peer_sans`, plus `internal_caller`) instead of a near-duplicate `ctx_with` — [x] addressed in spec
  - Step 29: cite `validate_config_json` (`signal_sources.py:186`, imported `servicer.py:35`) — [x] addressed in spec
  - Step 31: STRATEGY template validation resolves formula-template ids against the indicators `FormulaTemplate` payload (`outputs`, `fundamental_inputs`) via `ListTemplates`, not `GetFormula` — [x] addressed in spec
  - Step 33: partial pass renders via `render-migrations.sh` (+ analysis-013 render) and runs per-service `migrate … goto 6|12|25`; `db-migrate.sh` supports only up/version/force — [x] addressed in spec
  - Step 34: `remove-agent-postgres-mcp.feature:14` 43 → 45; stale agent `CLAUDE.md` and `mcp-tools.md` secret/admin-gate text added — [x] addressed in spec
  - Step 38: insights BFF `setConfig` forces `isSecret: true`/`createKey: true`; Step 39 test case — [x] addressed in spec
  - Step 39: config-ui `ManageTemplate` smoke check moved into `e2e/config-ui/api-smoke.spec.ts` — [x] addressed in spec
  - Step 40: stale ingest `CLAUDE.md` Authorization / global `mcp_credential.<slug>` note and analysis `CLAUDE.md` fundsignal admin-bit / bare-`strategy_id` cache note; Verification grep extended — [x] addressed in spec
- Overlap: 196 shares ingest servicer.py (different handler) and should inventory 224's new deprecated indicators fields; 084 droplet migrator needs SEED_USER_ID; 215/032/039/040 future same-area watch.

## Session 2026-10-07 — sdd-execute sequential (re-spec gate)

- **Re-spec gate:** the read-only validation checked every **Files** path and **Codebase Evidence** citation in all 41 steps. Everything resolves except two spec defects, both fixed with operator approval:
  - **Step 22.** `secretsAndScope.test.ts` contains no global-only rejection test to invert. The step drops that file from its Files and adds instruction 5: a new AC-35 test asserting that a per-user secret write is accepted (RED today, rejected at `configServiceImpl.ts:464-466`).
  - **Step 34.** Its Files list now includes `services/xstockstrat-agent/tests/test_tools_endpoint.py`, which instruction 4 edits.
  - The remaining 1–8 line evidence drift is absorbed by per-step discovery.
- **Operator decisions (2026-10-07):**
  - Proceed with the sequential run.
  - **Step 18 gate:** prod has **zero** `mcp_client` signal sources. Ingest 013 therefore omits `credential_scope=LEGACY_GLOBAL` and its reset trigger.
- **Tooling setup (all 41 steps):**
  - docker 29.6.2 ✓ (dockerd started)
  - go 1.27 ✓
  - uv 0.8.17 ✓; analysis, indicators and ingest venvs on py3.12, agent on py3.13 ⬇ synced
  - node 22 ✓, pnpm 9.15.9 ✓, workspace `pnpm install` ⬇
  - shellcheck 0.11.0 ⬇ (shellcheck-py) and shfmt v3.14.1 ⬇
  - buf ✗ on the host; proto codegen uses the Docker `Dockerfile.codegen` image via `localenv-setup.sh`
  - Playwright chromium ✓ (`/opt/pw-browsers`)

### Step 1 — proto: template types, ownership fields, deprecations, template RPCs [done]
- **common:** adds `TemplateKind`, `TemplateOperation`, `TemplateMeta` and `TemplateOrigin`.
- **indicators:**
  - deprecates `is_public` (FormulaDefinition 8, Register 4, Update 6), Register `author` 6 and List `include_public` 2;
  - adds `FormulaDefinition.origin=15`;
  - adds four template RPCs: `ListTemplates`, `ManageTemplate`, `InstantiateTemplate` and the internal `ResolveTemplateIntent`.
- **ingest:**
  - adds `ExternalSignal.user_id=11`, `SignalSource.user_id=13` and `SignalSource.origin=14`;
  - adds the `SignalScope` enum, plus `QuerySignalsRequest.scope=6` and `owner_user_id=7`, and `ListSignalSourcesRequest.owner_user_id=2`;
  - adds three template RPCs.
- **analysis:** adds `StrategyDefinition.origin=16`, `StrategyScore.origin=8`, `GetStrategyRequest.owner_user_id=2` and `ListStrategyDefinitionsRequest.owner_user_id=4`, plus three template RPCs.
- **config:** adds `GetSecretRequest.user_id=4` and rewrites the `SetConfigRequest.user_id` comment.
- **Verification:** `buf lint` and `buf breaking --against HEAD` both exit 0, run through the `bufbuild/buf:1.72.0` Docker image (the pinned version, since buf isn't on the host).
- **TDD:** N/A (proto).
- **Files modified:** `packages/proto/{common,indicators,ingest,analysis,config}/v1/*.proto`.
- **Deviations:** verification ran buf through Docker instead of a host binary. This is a CI-equivalent fallback at the same pinned version.

### Step 2 — proto-gen: regenerate stubs [done]
- Regenerated the stubs with `./scripts/localenv-setup.sh`, using the version-pinned `Dockerfile.codegen` image.
- 52 generated files changed (Go, Python, TS and TS dist), all within analysis, common, config, indicators and ingest.
- A second run produced the same set, so there is no drift.
- Files modified: `packages/proto/gen/**` (the five touched packages).
- TDD: N/A. Deviations: none. (The script also wrote dev mTLS certs to `certs/`, which is git-ignored and not staged.)

### Step 3 — service: migration tooling [done]
- New scripts:
  - `scripts/render-migrations.sh`: renders `-- requires-env:` headers with an allowlisted `envsubst`; files without the header are copied byte-identical.
  - `scripts/check-migration-contract.sh`.
  - `scripts/migration-rerun.sh`.
- `db-migrate.sh up` renders through `render-migrations.sh` after the unchanged analysis-013 branch.
- `scripts/Dockerfile.migrate` now COPYs the renderer (D-2, operator-approved).
- CI:
  - new `migrations` paths filter;
  - new `migration-rerun` job (TimescaleDB service and the migrator image);
  - new PR-only `migration-contract-gate` job;
  - both jobs added to `ci-gate`.
- TDD with Step 4: RED (both `.test.sh` scripts failed with "missing script") → GREEN (all assertions passed).
- Verification: shellcheck and shfmt clean, the YAML parses, and the gate is PR-only.
- Files modified:
  - `scripts/{render-migrations,check-migration-contract,migration-rerun}.sh`
  - `scripts/db-migrate.sh`
  - `scripts/Dockerfile.migrate`
  - `.github/workflows/ci.yml`
- Deviations: D-2 and D-3. Note: `envsubst` (gettext-base) was installed on the host for local tests; the migrator image and CI runners already ship it.

### Step 4 — test: migration tooling structural tests [done]
- `render-migrations.test.sh` checks five things:
  - (a) the header without its variable set fails and names the variable;
  - (b) the variable is rendered while `$$` blocks and `$1` stay intact;
  - (c) files without the header are byte-identical;
  - (d) `.down.sql` files are copied;
  - (e) `Dockerfile.migrate` COPYs the renderer (guards D-2).
- `check-migration-contract.test.sh` uses a throwaway repo with a fake `origin/main` and checks three cases: (a) passes, and (b) and (c) fail.
- Both tests are wired into the `shell-lint` job.
- AC: — (tooling).
- RED: both failed with "script missing". GREEN: all assertions passed.
- shellcheck and shfmt are clean on the new tests.
- Files: `scripts/{render-migrations,check-migration-contract}.test.sh`, `.github/workflows/ci.yml`.
- Deviations: none.
- Note: the host's shellcheck 0.11 flags a pre-existing SC2329 in `scripts/integration-test.sh`. That is out of scope and untouched, and CI's apt shellcheck predates that check.

### Step 5 — test: peer-SAN spike [done] (GATE PASSED)
- **grpc.aio** (ingest, grpcio 1.80): on the real mTLS harness, `context.peer_identity_key() == "x509_subject_alternative_name"`. `peer_identities()` includes the exact element `b"xstockstrat-analysis"` for the analysis leaf and leaves it out for a different leaf.
- **grpc-js** (config, ^1.14.5): `call.getAuthContext().sslPeerCertificate.subjectaltname` parses as a comma-separated list with `DNS:` prefixes to exactly `["xstockstrat-ingest"]`, and a different leaf yields its own SAN.
- **Outcome:** Steps 14, 19 and 21 use these APIs directly. The design fallback (parsing the cert from `auth_context()`) is **not needed**.
- **Verification:**
  - ingest: 223 passed, coverage 77.28% (≥40); `ruff check` and `ruff format --check` clean.
  - config: 123/123 passed, c8 lines 83.67% (≥40); eslint 0 errors, and no warnings from the new file.
- TDD: N/A (spike).
- Files: `services/xstockstrat-ingest/tests/test_peer_identity_spike.py`, `services/xstockstrat-config/src/__tests__/peerSanSpike.test.ts`.
- Deviations: none.

### Step 6 — migration: analysis `026_owner_dimension_templates` [done]
- **Header and guard:** `-- requires-env: SEED_USER_ID`, plus an unconditional guard that raises if the seed is unset or not rendered.
- **D-1 backfill:** `backtest_runs.user_id` is filled with the strategy's owner when exactly one owner holds that strategy, otherwise with `SEED_USER_ID`. NOT NULL is deferred to the contract feature.
- **Owner columns:** `user_id` is added to `backtest_run_symbols` and `backtest_details`, backfilled from `backtest_runs`, and covered by two owner-leading indexes.
- **`strategy_scores_v2`:** keyed `(user_id, strategy_id)`. It is seeded from `strategy_scores` with explicit column lists for unambiguous ids only, guarded by `to_regclass`.
- **New schema:** `analysis.strategies` gains origin columns. New tables `analysis.strategy_templates` (no seed rows) and `analysis.template_intents` (state CHECK, plus a `(state, updated_at)` index).
- **No triggers.** Every statement is idempotent: `IF NOT EXISTS`, `WHERE … IS NULL`, `ON CONFLICT DO NOTHING`.
- **Down file:** drops the new tables, columns and indexes. It deliberately keeps the `backtest_runs.user_id` backfill, which is additive and harmless to N-1.
- **Verification (offline):**
  - 025 → 026 numbering is correct.
  - Up and down are parity-checked by inspection.
  - Every referenced column was checked against migrations 006, 007, 008 and 015.
  - `render-migrations.sh` renders both `${SEED_USER_ID}` placeholders and leaves the `$$` blocks intact. Rendering without the variable exits 1.
  - The live apply and replay run in CI's `migration-rerun` job.
- TDD: N/A (migration).
- Files: `services/xstockstrat-analysis/migrations/026_owner_dimension_templates.{up,down}.sql`.
- Deviation: the spec named no index for `template_intents`, so it is named `idx_template_intents_state_updated`. `intent_id` has no default, so writers must supply the UUID (Step 31).

### Step 7 — service: analysis identity threading and fundsignal `system` identity [done]
- **Evaluator:** gains `for_owner`. The live loop uses a per-owner evaluator, a once-per-cycle system drain (`SignalScope.SYSTEM`, `analysis-system-read`), and an own-signal drain per owner.
- **Owner on outbound calls:**
  - `entry_backfill` uses the system drain plus a per-owner memo.
  - The pnl consumer sends QuerySignals as the order owner.
  - The fundamentals universe is read in the SYSTEM scope.
- **Fundsignal** (both the scheduled loop and `RunFundamentalsScan`):
  - **Identity:** sends `x-user-id: system` with `x-internal-caller: analysis-fundsignal`; the admin-bit injection is deleted.
  - **Scoring pre-flight:** `GetFormula` must return `author == SYSTEM_AUTHOR` (AC-6/AC-37). The per-symbol built-in fallback is deleted (deliberate C-18 removal).
  - **Registration:** keyed on the slug.
  - **Aborts:** a register `FAILED_PRECONDITION`, or a `NOT_FOUND` on IngestSignal, aborts the cycle with an ERROR alert (`_emit_warning` gains a severity parameter).
- **Servicer:**
  - Adds a `SYSTEM_IDENTITY` constant.
  - An inbound `x-user-id: system` without a grant resolves to `""`, the documented divergence from design §2.
  - Adds the GetAttribution visible-source filter (decision 7).
- **Files:** `app/services/evaluator.py`, `app/engine/{live_loop,entry_backfill,pnl_pattern_consumer,fundsignal_loop}.py`, `app/handlers/servicer.py`. `main.py` needed no change.
- **Deviations:** D-4, D-5.

### Step 8 — test: threading, fundsignal identity, runtime header guard [done]
- **New `tests/test_owner_header_guard.py`:** a runtime stub-level guard requiring every ingest and indicators call to carry a non-empty `x-user-id`. `system` is allowed only with the fundsignal or system-read grant.
- **`conftest.py`:** adds `ctx_with` and `RecordingStub`.
- **Updated tests:**
  - fundsignal: AC-6, AC-36, AC-37 (loop and manual paths), NOT_FOUND abort, slug-keyed registration, no built-in fallback
  - live loop: AC-26, system-scope universe, owner header on `_eval_pair`
  - pnl: owner header on the composer
  - attribution: AC-12 filter, `system` caller owns nothing
- **TDD:**
  - RED: 21 failed, 112 passed. Examples: `QuerySignals sent x-user-id []`, `assert None == 'system'`, `'completed' == 'failed'`, and the built-in fallback mock called once.
  - GREEN: 901 passed, coverage 85.52% (≥40). Ruff check and format are clean.
- **Some guard tests were already green before Step 7.** ListOpportunities, GetAttribution, analytics, screener, the materializer and the backtest prefetch already sent the owner header; their tests pin that behavior against regressions.
- **Files:** `tests/{conftest,test_owner_header_guard,test_fundsignal_loop,test_live_loop,test_pnl_pattern_consumer,test_get_attribution,test_entry_backfill}.py`.
- **Deviations:** D-6 and D-7.
- **Noted, not fixed (pre-existing behavior):** after an IngestSignal NOT_FOUND abort, the triggering symbol's `fundsignal_emitted` claim row remains, as it already did for any failed emit.

### Step 9 — service: analysis owner dimension, `GetBacktest` ownership, strategy admin read [done]
- **Repos** (all owner-scoped):
  - `strategy_scores` reads and writes `strategy_scores_v2`, conflicting on `(user_id, strategy_id)`, and adds `list_unscored_pairs`.
  - `backtest_run_symbols.fetch_eligible` and the `backtest_details` insert and retention.
  - `backtest_runs.list_by_strategy(user_id, …)`.
- **New `app/admin_audit.py`:**
  - Emits 1 + K events: one on the admin's stream and one per foreign owner, or none if the page is all the admin's own objects.
  - At most 4 appends run concurrently, and a page may name at most 100 foreign owners (fixed constants).
  - Forwards only the header trio, and fails closed with `UNAVAILABLE`.
- **Servicer:**
  - In-memory state is keyed `(user_id, strategy_id)`. `RunBacktest` passes the owner to every persist path.
  - `ListStrategies`, `GetStrategyReport`, `ListBacktests` and `GetStrategyAnalytics` read by owner.
  - `GetBacktest` denies any non-owned run, admins included (D-9, operator decision).
  - `GetStrategy` and `ListStrategyDefinitions` honor `owner_user_id` only for an ADMIN caller, and those reads are audited.
  - `_BOOT_RECOMPUTE_MAX_PAIRS = 50`, with `recompute_unscored_pairs()` called after `hydrate_scores` in `main.py`.
- **Files:**
  - `app/repositories/{strategy_scores,backtest_run_symbols,backtest_details,backtest_runs}.py`
  - `app/admin_audit.py`
  - `app/handlers/servicer.py`
  - `app/main.py`
- **Deviations:** D-8, D-9, D-10.

### Step 10 — test: owner-keyed analysis state and strategy admin read [done]
- **New `tests/test_owner_dimension.py`** (22 tests). Covers:
  - AC-21: same strategy id with two owners; ListBacktests, GetBacktest and analytics owner-scoped; admin GetBacktest denied.
  - AC-28: the strategy part.
  - Audit 1 + K, the zero-event case, fail-closed behavior and the header trio.
  - The boot recompute cap.
- Four repo test files are updated for the new SQL and signatures.
- **TDD:**
  - RED: 12 failed in the repo tests (for example `'analysis.strategy_scores_v2' in 'SELECT * FROM analysis.strategy_scores'`, and `fetch_eligible() takes 3 positional arguments`), and the new module failed with `ImportError: admin_audit`. D-9's flipped test was RED before the deny change.
  - GREEN: 924 passed, coverage 85.70% (≥40), ruff check and format clean.
- **Files:** `tests/test_owner_dimension.py`, `tests/test_{strategy_scores,backtest_run_symbols,backtest_details,backtest_runs}_repo.py`, `tests/test_analysis_servicer.py`.
- **Deviation:** D-11.
- **Open (owned by Step 14):** `GetStrategy`'s deleted-formula check still calls indicators as the admin, which is the indicators admin-read work in Step 14.

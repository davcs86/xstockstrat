# Context Log: fix-python-config-stored-zero

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-10-20 (/sdd-triage)

- Bug recorded as defect report `docs/reports/2026-10-19-python-config-zero-trap-defect.md` (Issues disabled):
  Python config getters collapse a stored 0 / "" to the coded default (CF-N10).
- Severity: SEV-2. Environment: dev (main-dev) @ 1302e6d. Config-only fix: no. Routed to SDD path (Track C).
- Created: status.md, feature.md, product-spec.md, acceptance.feature (AC-1 getters, AC-2 zero-cost backtest,
  AC-3 zero signal-rank weight, AC-4 unset → default, AC-5 ingest semaphore clamp kept), context.md.
- Affected services (from report): xstockstrat-analysis, xstockstrat-indicators, xstockstrat-ingest.
- Root cause hypothesis: truthiness `or default` conflates unset with zero; fixed only per key via `*_present`.
- Confirmation evidence (report, confidence high, static; triage re-grep 2026-10-20): `or default` at
  analysis `watcher.py:97,105,134`, indicators `:96,114,130`, ingest `:110,118,144`; `get_bool` uses `HasField`
  in all three; indicators lacks `get_int_present`/`get_float_present`. Call sites `servicer.py:787-788,4615`,
  `live_loop.py:351` confirmed.
- Design risks found at triage (for recon):
  - Deliberate trap call sites besides ingest `watcher.py:185,208`: analysis `servicer.py:790` (0 and absent both
    mean legacy), `:1152`, `:2913` (stored 0 → default 20). A blanket `HasField` switch changes these; each needs an
    explicit clamp or a kept trap.
  - Seeded zero/empty rows change effective value under `HasField` wherever the coded default differs from the
    seed, e.g. `analysis.fundsignal.explicit_symbols` / `scoring_formula_id` (`''`), `fundsignal.min_conviction_to_emit`
    (`0.0`), `opportunity.refresh_hour_utc` / `readiness_materializer.refresh_hour_utc` (`0`). Recon must audit every
    seeded 0/`""` row against its call-site default before switching.
  - Config bounds (`configServiceImpl.ts:115-117`) set `minValue: 1` on keys "where 0 already collapses to the code
    default"; with the trap gone, a stored 0 could become reachable via those keys' existing rows — recheck.
- Overlap: 243-fix-sandbox-seed-keys touches the same indicators `watcher.py` (sandbox getters use `get_int`);
  soft ordering, whichever lands second reconciles.
- Recommended design depth: full → `/sdd-design fix-python-config-zero-trap` (rationale: SEV-2; 3 affected
  services; per-key behaviour change across every Python config read needs a debated clamp policy).
- Development branch: feature/fix-python-config-zero-trap

## Session 2026-10-20 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready. Criteria verdict PASS WITH WARNINGS (0 fails, 0 Floor breaches,
  8 warnings, 2 notes); overlap level WARN.
- Branch note: `feature/fix-python-config-zero-trap` was gone from origin at this session (a prune dry-run lists it
  deleted; the last push was 123c977e). The likely cause is launched-branch cleanup keyed on 173's shared slug. This
  session built on 123c977e (the reviewed revision, kept in the stale local tracking ref) and re-pushed, which
  recreated the branch. Slug rename is still open (NOTE 1 below).
- Warnings (criteria):
  1. FR-3 inventory incomplete (C-15, C-18). Fixed: added rows for `analysis.engine.eval_interval_seconds`,
     `analysis.strategy.max_concurrent_entry_backfill`, `analysis.fundsignal.run_interval_hours`,
     `analysis.engine.fundamentals_blend_strategy_id` and `analysis.fundsignal.source_slug` (string keys included).
     Added a "recon classifies" list: fundsignal budget/max_symbols/valid_days, screener universe/rank_limit,
     snapshot timeouts, backtest.max_range_days, patterns.*.
  2. Scenario shape (C-15). Fixed: AC-6 Given now gives type and stored value. Added rows for chunk keys,
     sandbox.max_concurrent, eval_interval, max_strategies_per_cycle, blend id, default_cooldown_days and
     shrinkage_days. The default_fill_model row now asserts FILL_MODEL_SAME_BAR_CLOSE. AC-5 is restated as the job
     semaphore capacity. AC-8 has a Given for the ADMIN caller and the existing int row (028:87,90).
  3. AC-7/FR-5 vacuous. Fixed: FR-5 restated as an audited fact plus a no-floor-on-zero-default rule. AC-7 is
     reframed as an over-clamping guard (refresh_hour_utc seeded 0 in 027/028). The 008 rows are bare-keyed and not
     healed by 029:28. The AC paragraph now says AC-7 fails when clamping is too broad.
  4. Rollout risk: rows already stored as 0/'' take effect on deploy. Fixed: added a pre-deploy audit bullet to
     Fix Scope (dev, then prod; result recorded here).
  5. Consumer surface (C-14). Fixed: dropped the `/insights` opportunities queue (it always sends an explicit sort),
     added the alert surfaces (`/trader` AlertStream, `/accounts/notifications` inbox and push), and recorded the
     `create_key=true` need for the unseeded FR-4 keys.
  6. Doc-update list incomplete. Fixed: added config-governance.md:252-259,458-461,705,713,721, the extra analysis
     CLAUDE.md rows and ingest CLAUDE.md:127,131. Added a bullet saying the durable 173 suites and config
     opportunity-config-operability @AC-8 are preserved.
  7. Migration NNN collision with 243 (claims 031). Fixed: Fix Scope says to pre-assign the NNN through a
     merge-order.md row if design adds a migration. merge-order.md is not edited (outside feature dir).
  8. Operator sign-off not visible in context.md. Fixed: recorded verbatim below. The spec Root Cause cites it.
  - NOTE 1 (slug shared with launched 173): open; operator rename pending. The branch deletion above is evidence of
    the risk.
  - NOTE 2 (precision): fixed. 027:50,53 is described as mechanism-only, FR-3 states the no-clamp case for
    zero-default keys, and the ingest watcher comment lines were already scheduled.
- Overlap findings (WARN):
  - Config migration 031 is claimed by 243. It becomes a conditional collision only if design adds a migration
    (see warning 7).
  - `indicators.sandbox.max_concurrent` ownership gap. Resolved in FR-6: 244 owns the read clamp for all three
    `indicators.sandbox.*` int keys. 243 owns the timeout_ms/memory_bytes bounds decision. max_concurrent gets no
    bounds row.
  - `services/xstockstrat-indicators/CLAUDE.md:100-103` is rewritten by both 243 and 244; the second to land
    rebases (noted in Fix Scope).
  - File-level rebase only, no field/key/migration collision: `live_loop.py` (242), `screener.py` (245),
    `configServiceImpl.ts` (241).
  - Low-risk: 243 bounds split; the 245 screener deadline; the 246 min_conviction read; agent tools (241, 247).
  - merge-order.md: no row needed now. Add one with a pre-assigned NNN if design adds a config migration.
- Operator decisions:

  OPERATOR DECISIONS (binding, recorded 2026-10-20):
  - Standing authorization: designs run in FULL mode only (no quick designs for automated fixes); the orchestrator auto-approves the design gate once rounds >= 2, no unresolved Floor (F-*) breach remains, no blocking objection remains, and every CHANGE to an existing @AC business rule is covered by an operator decision below.
  - Fix the getters + audit: get_int/get_float/get_str honour a stored 0 / '' via HasField in all three Python watchers; every call site that relies on the trap gets an explicit floor clamp (e.g. ingest semaphore keys, analysis servicer.py ~790/1152/2913); seeded 0/'' rows and config SCALAR_BOUNDS minValue bounds are re-checked in the same feature.
- Next: `/sdd-design fix-python-config-zero-trap` (full).

## Session 2026-10-20 — sdd-review product-spec (re-review)

- Product spec approved again. Status stays `spec-ready` (it was already `spec-ready` from the prior session, so no
  draft → spec-ready flip; a re-review row was added to feature.md). Criteria verdict PASS WITH WARNINGS (0 fails,
  0 Floor breaches, 6 warnings); overlap level WARN.
- Warnings (criteria):
  1. FR-3 inventory incomplete (C-18, P-03). Fixed: moved `analysis.backtest.max_range_days` (`servicer.py:874-875`),
     `analysis.snapshot.indicator_timeout_ms`/`signal_timeout_ms` (`pnl_pattern_consumer.py:364-365`),
     `analysis.screener.max_universe_size` (`screener.py:92-93`), `analysis.opportunity.max_universe_size`
     (`servicer.py:5470`) and `analysis.fundsignal.daily_call_budget`/`max_symbols_per_run`
     (`fundsignal_loop.py:222,181`) into FR-3. `eval_interval_seconds` and `run_interval_hours` were already rows.
     Recon must now write every get_int/get_float/get_str site into recon.md as FR-3 or honour. Each key recon adds
     to FR-3 gets an @AC-6 row. Six @AC-6 rows were added. Still to classify (0 may be legitimate):
     `fundsignal.valid_days`, `screener.default_rank_limit` (0 = uncapped), `patterns.*`.
  2. AC-7 vacuous (FR-5). Already reframed as an over-clamping guard in the prior session. The AC-7 rows include
     `readiness_materializer.refresh_hour_utc`. Added `analysis.fundsignal.explicit_symbols` ("" default,
     `fundsignal_loop.py:308`).
  3. No ingest get_float row (FR-1). Fixed: added `ingest.test.zero_float` to @AC-1 and `ingest.test.unset_float` to
     @AC-4 (ingest `watcher.py:138-144`).
  4. Conditional DB gate had no migration strategy (C-07, F-01). Fixed: Fix Scope now requires a new
     `NNN_*.up.sql` + `.down.sql` in `services/xstockstrat-config/migrations/` (next after 030, verified then). The
     applied 027/028 are never edited. The NNN is pre-assigned with 243 via merge-order.md and recorded in design.md.
  5. Operator sign-off and the durable 173 suites (P-04, P-05, C-16). Already resolved: the sign-off is recorded in
     the prior session's "Operator decisions". Fix Scope lists both 173 suites plus config
     opportunity-config-operability @AC-8 as preserved.
  6. AC well-formedness (advisory). Fixed: the Acceptance Criteria paragraph now says each @AC-1/4/5/6 Example
     `Then` maps to a concrete test assertion at /sdd-spec.
- Overlap findings (WARN):
  - [migration] 031 claimed by 243 (`243-fix-sandbox-seed-keys/product-spec.md:44`). This is a collision only if
    244 design adds a config migration. Trunk tip is `030_marketdata_edgar_snapshot_keys`. Mitigation: pre-assign
    the NNN via merge-order.md (Fix Scope).
  - [file] `services/xstockstrat-indicators/app/config/watcher.py:133-148` (sandbox getters) is shared with 243
    (`:134,138,142-143`). Ownership split recorded in FR-6.
  - [file] `services/xstockstrat-indicators/CLAUDE.md:100-103` is rewritten by both 243 and 244. The second to land
    rebases.
  - [file] `sandbox.py:282,345-346` (memory_bytes guard, max_concurrent) may overlap with 243's RLIMIT_NPROC work.
    Confirm at Mode B.
  - [file] `services/xstockstrat-analysis/app/services/screener.py` has disjoint lines vs 245 (`:115`).
    Rebase only.
  - [file] `services/xstockstrat-analysis/app/engine/live_loop.py:351,815` vs 242 (`:834`), on the same
    alert-emission path. Expect a manual merge.
  - [file] `services/xstockstrat-config/src/grpc/configServiceImpl.ts:100-146` vs 241 (`:388,405-407`). The lines
    are disjoint. Rebase only.
  - No identical config key is declared by two features.
- Operator decisions:

  OPERATOR DECISIONS (binding, recorded 2026-10-20):
  - Standing authorization: designs run in FULL mode only (no quick designs for automated fixes); the orchestrator auto-approves the design gate once rounds >= 2, no unresolved Floor (F-*) breach remains, no blocking objection remains, and every CHANGE to an existing @AC business rule is covered by an operator decision below.
  - Fix the getters + audit: get_int/get_float/get_str honour a stored 0 / '' via HasField in all three Python watchers; every call site that relies on the trap gets an explicit floor clamp (e.g. ingest semaphore keys, analysis servicer.py ~790/1152/2913); seeded 0/'' rows and config SCALAR_BOUNDS minValue bounds are re-checked in the same feature.
- Next: `/sdd-design fix-python-config-zero-trap` (full).

## Session 2026-10-21 — sdd-design

- Branch recovery: `feature/fix-python-config-zero-trap` was absent from origin again.
  - GitHub branch activity records deletions at 2026-10-20T23:30:22Z and 2026-10-21T06:37:16Z.
  - Each came about 9 s after a `ci-validate-feature-status` run on a push to `main` (runs 39515448201 and 39556526187).
  - Cause: the orphan cleanup globs `docs/roadmap/features/*-${slug}/status.md | head -1` (`.github/workflows/ci-validate-feature-status.yml:167`). That glob resolves to launched `173-fix-python-config-zero-trap`, so `:183` deletes 244's live branch.
  - The prior progress was intact at df3206f7 (Phase 0 recon, kept in the stale local tracking ref). This session built on df3206f7 and re-pushed, which recreated the branch.
  - Until the slug is renamed, the branch will be deleted again on the next push to `main`.
- Phase 0 Recon: recon.md written at df3206f7 (services: analysis, indicators, ingest, config). Key reuse patterns:
  - the `get_bool` HasField body (analysis `watcher.py:126`, indicators `:122`, ingest `:136`)
  - the `blend_strategy_id(cfg)` named reader (`servicer.py:353-355`)
- Phase 1 Grilling: 3 rounds (full). Auto-approved under the operator standing authorization: rounds >= 2, no Floor breach, no blocking objection, and no CHANGE to an existing @AC.
  - Chosen approach:
    - The getters take the HasField body; the `*_present` names become aliases.
    - A module-level `int_positive`/`float_positive`/`str_nonempty` clamp sits at every FR-3 read.
    - The exhaustive list of `max(1, …)` read wrappers, plus the two inline `<=0` clamps, are converted to it.
    - `default_cooldown_days(cfg)` and `fundsignal_source_slug(cfg)` become single named readers.
    - Each service gets an AST guard test with these rules:
      - it scans six read names
      - `HONOUR_KEYS` and `FR3_KEYS` are disjoint
      - every key is a literal
      - each key has one default
      - a `ZERO_IS_LEGIT` map
      - every FR-3 key appears as a test literal
    - One description-only config migration, numbered `max(origin/main-dev)+1` at merge.
  - Rejected (full list in design.md § Rejected Alternatives):
    - a watcher-method clamp (MagicMock doubles swallow it)
    - per-site `<=0` blocks (DRY)
    - `SCALAR_BOUNDS minValue` instead of read clamps (bounds apply on write only)
    - an `== 0`-only floor (negatives)
    - a hard 243→244 merge order
    - converting the `retry_seconds` wrappers (156 AC-4 / 158 AC-9)
    - a shared `scripts/` guard
  - Round deltas:
    - r1: module-level clamp and a single numbering rule.
    - r2: the guard now covers the aliases.
    - r3: argument binding; guard rules 5 and 6; the `retry_seconds` ruling; the inline-clamp conversion; the 027/028 mechanism rows folded into the migration.
- Deviation (C-18): at the converted `max(1, …)` sites, a stored negative now resolves to the coded default instead of 1.
  - `test_retention_clamped_to_at_least_one` flips from -5 → 1 to -5 → 20.
  - No @AC pins negatives.
  - product-spec.md FR-3 is amended to match, with a feature.md Status History row.
- Constitution rules touched: C-01, C-02/P-05, C-07, C-08/P-06, C-11, C-14, C-15, C-16, C-18, P-02, P-03, F-01, F-04, F-07, and the DRY guard rail. Floor breaches: none.
- Business rules: every durable @AC is PRESERVE. 244 @AC-6 is EXTEND. 244 @AC-10..AC-12 are new and covered by the operator decision "Fix the getters + audit". No CHANGE.
- Open Threads:
  - [ ] Wire-level zero is unproven at runtime. Target: the @AC-10 test via `ConfigServiceService` (spec config step), plus the dev `signal_rank_weight=0` smoke test (rollout).
  - [ ] The guard's sets freeze a hand classification. Target: `/sdd-spec` emits the `HONOUR_KEYS`/`FR3_KEYS`/`ZERO_IS_LEGIT` table, and the impl-spec review audits it.
  - [ ] Negatives change silently at the converted sites. Target: the analysis clamp step records the test flip.
  - [ ] Stored 0/'' rows and malformed int rows change on deploy. Target: pre-deploy audit on dev, then prod, with the results recorded here.
  - [ ] Type-mismatched unseeded FR-4 rows still fall back. Target: the rollout `value_type` check and the docs step.
  - [ ] Migration renumbering. Target: `/sdd-execute` re-lists `origin/main-dev` before merge and adds the merge-order.md row.
  - [ ] A bare-`MagicMock` cfg return raises `TypeError` at `v > 0`. Target: `/sdd-spec` runs the full suites and lists every double it fixes.
  - [ ] The slug collision with 173 deletes the feature branch on each push to `main`. Target: operator slug rename before `/sdd-spec` pushes.
  - [ ] The `sparkline_bars` description drift (028:100,103) is unlogged. Target: the docs step logs it in `services/xstockstrat-config/docs/context-constitution-findings.md`.
- Status: spec-ready → design-approved.

## Session 2026-10-21 — sdd-spec

- Branch state: `origin/feature/fix-python-config-zero-trap` was present at 459f6531 (the design-approved commit), so
  this session built on it with no recovery needed. The slug rename is still open, so the branch remains exposed
  to the orphan cleanup on the next push to `main` (fails.md:2953).
- Generated implementation-spec.md with 18 steps. Status: design-approved → implementation-ready.
- Order: for each Python service, a getter step, then a clamp step, each with its paired test step (ingest 1-4,
  indicators 5-8, analysis 9-12). Then config comments and tests (13-14), the description migration and its test
  (15-16), docs and teardown (17), and rollout with consumer-surface verification (18).
- acceptance.feature extended (C-15 append-only; design §10):
  - 20 @AC-6 rows: design's 18, plus `read_db_budget_ms` 20000 and `live_enrich_timeout_ms` 3000
    (`servicer.py:339-340`)
  - new @AC-10 @FR-1 (wire zero, SNAPSHOT and DELTA)
  - new @AC-11 @FR-6 (description-only migration)
  - new @AC-12 @FR-1 (`default_rank_limit`, `min_sample_count` honour 0)
- Key codebase findings:
  - Dry run of the design, in a scratch copy outside the repo. The getters were switched and 48 FR-3 call sites
    wrapped in module clamps.
    - Results: ingest 328 passed, indicators 290 passed, analysis 1274 passed and 2 failed. The two failures are
      exactly the design §9 rewrites (`test_analysis_servicer.py:586-594`, `:2527-2541`).
    - No bare-`MagicMock` cfg double needs fixing; this closes the Open Thread "bare-MagicMock cfg return raises
      TypeError".
  - The AST scan of the same tree: 0 unbindable calls, one default per key, and disjoint read/clamp sets.
    - ingest: 6 FR-3, 2 honour
    - indicators: 3 FR-3, 1 honour
    - analysis: 34 FR-3, 36 honour, plus 3 dead-helper reads removed in Step 11
    - The `HONOUR_KEYS`/`FR3_KEYS`/`ZERO_IS_LEGIT` table is emitted in implementation-spec.md § Guard
      classification table for impl-spec review. That addresses the Open Thread "the guard's sets freeze a hand
      classification" (audit pending).
  - The config migration tip on `origin/main-dev` is `030`, and 243 claims `031`. Step 15 numbers the pair
    `max(origin/main-dev)+1` at authoring and re-verifies before merge. The AC-11 test globs by name suffix
    (`*_analysis_zero_trap_descriptions`), so a renumber needs no test edit.
  - RED for the clamp tests (Steps 4, 8, 12) exists only against the getter-switched tree. Under the original trap
    the default already comes back. That is why each service's getter step precedes its clamp step.
  - @AC-8, @AC-10 and @AC-7 are characterization tests: they pass before and after. They are recorded per the
    tdd-gate escape.
- Open Threads update:
  - [x] A bare-`MagicMock` cfg return raises `TypeError` at `v > 0`. Resolved by the dry run: none does.
  - [ ] The guard's sets freeze a hand classification. Target: `/sdd-review impl-spec` audits § Guard classification
    table.
  - [ ] The slug collision with 173 deletes the feature branch on each push to `main`. Target: operator rename,
    still pending. /sdd-execute checks that the branch exists before each session.
  - Unchanged: wire zero (Step 14 @AC-10 plus the Step 18 smoke), negatives (Step 12 retention flip), the stored
    0/'' rows and the deploy audit (Step 18), type-mismatched FR-4 rows (Step 18 and the Step 17 docs), migration
    renumbering (Step 15), and the `sparkline_bars` drift (Step 17).
- Next: `/sdd-review fix-python-config-zero-trap impl-spec`.

## Session 2026-10-21 — sdd-review impl-spec

- MODE B (advisory): criteria verdict PASS WITH WARNINGS (0 FAIL, 10 WARN). Overlap verdict FAIL (243 collisions).
  Lifecycle unchanged: `implementation-ready`.
- Addressed (implementation-spec.md edited after re-verifying each claim):
  - Overlap FAIL, migration `031` vs 243. 243 claims `031`
    (`origin/feature/fix-sandbox-seed-keys:…/implementation-spec.md:168-169`), and the trunk tip is `030`.
    - Step 15 Files are pinned to `032_analysis_zero_trap_descriptions.{up,down}.sql`.
    - The pre-merge re-list sets the pair to `max+1`. That is `031` if 244 merges first, so no gap is left. Any
      renumber is logged per F-09.
    - The § Step Dependencies bullet and the Step 15 merge-order row text were updated.
  - Overlap FAIL, `services/xstockstrat-indicators/tests/test_config_watcher.py` helper. 243 Step 3 (`:298-307,315`)
    keeps `_watcher(key, field, val)` in that file.
    - Step 6 now keeps whichever helper is on the base (name, signature and file) and only delegates its body to
      conftest `snapshot_watcher`.
    - The `ConfigValue` arm is added only for 243's `_watcher`. No hard order: design rejected one, and 243 records
      the overlap as soft at `:56-57`.
  - WARN C-18: the `ConfigValue` pass-through arm was dropped from Step 2, and with it Step 10, which reuses Step 2's
    rules. It is kept only conditionally in Step 6.
  - WARN C-07 `<NNN>` placeholder: fixed under the migration item above.
  - WARN Step 10 AC-3 Order: now binds `_SORT_ORDER_BY[0].replace("$3", "$1::float8")` with one arg. Cited:
    `opportunities.py:35-40,243-246`, `tests/test_opportunities_repo.py:149-164`, fails.md:190.
  - WARN Step 14 mechanics:
    - The `impl: any` cast for the private `reloadNamespace`/`snapshotForSubscriber`/`broadcastToSubscribers`
      (`configServiceImpl.ts:203,245,260`).
    - A 20 ms wait after `watchConfig`, because the subscriber registers in an async `.then`
      (`configServiceImpl.ts:305-309`; `secretsAndScope.test.ts:250-251`).
    - Assertions `writes.length` 1, then 2.
  - WARN Steps 14 and 16 threshold: Verification now states that `test:coverage` enforces `c8 --lines 40`
    (`package.json:13`).
  - WARN Step 18 Verification: added grep commands that key on a `## Session <date> — rollout (dev|prod)` header,
    which Instruction 1 now mandates.
  - WARN Step 17 evidence:
    - Added `config-governance.md:319,688`.
    - Added the analysis and ingest findings preambles (`:5`).
    - `services/xstockstrat-analysis/docs/context-constitution-findings.md` was added to Files.
  - WARN branch hazard: confirmed at `ci-validate-feature-status.yml:160-167,181-183`. The `feature-steps/*` slug
    derivation also maps to 173. § Step Dependencies now makes the slug rename a precondition of `/sdd-execute`.
  - Overlap rebase-only items (240, 241, 242, 245, 246) are noted in § Step Dependencies. No spec change is needed.
  - WARN C-15 (unverifiable append): verified, no edit.
    - On the branch, `acceptance.feature` has @AC-10/@AC-11/@AC-12 (`:151,164,172`), and the @AC-6 Examples hold
      43 rows.
    - `design.md` is present.
    - The design and spec sessions are logged above.
- Still open:
  - [ ] Step size (advisory): Steps 10 (7 files), 11 (8) and 17 (12) exceed 5 files. Splitting Step 11 by module
    (servicer, then engine and services) was not done, because it renumbers steps and the C-15 trace. The operator
    decides at the `/sdd-execute` checkpoint.
  - [x] Slug rename (collision with 173; fails.md:2953). Done 2026-10-21. This is an operator action and is now a precondition of
    `/sdd-execute`. It also covers `feature-steps/*` branches.
  - [ ] merge-order.md row (243 → 244 soft, migration 031/032, test helper). It is written by Step 15 after operator
    confirmation, because this review may edit only the feature dir.
  - [ ] Guard classification table audit: the reviewer raised no objection to `FR3_KEYS`/`HONOUR_KEYS`/`ZERO_IS_LEGIT`.
    The guard's rule 2 is the executable check at Steps 4, 8 and 12.
- Next: operator slug rename, then `/sdd-execute fix-python-config-zero-trap` (rename done 2026-10-21; see the next session).

## Session 2026-10-21 — slug rename

- Operator action: renamed the slug `fix-python-config-zero-trap` → `fix-python-config-stored-zero` (dir `244-fix-python-config-stored-zero`, branch `feature/fix-python-config-stored-zero`).
  The old slug collided with launched `173-fix-python-config-zero-trap`, so the orphan cleanup deleted the old branch on every push to `main`.
- Updated live references: artifact titles, feature.md branch and Next Action, impl-spec paths, branch and merge-order row,
  the source report `ref:`, and 242/243/245 cross-references on main-dev. Historical session entries above keep the old slug.
- References to 173 (its dir and the `fix-python-config-zero-trap.feature` acceptance suites) are unchanged.
- Next: `/sdd-execute fix-python-config-stored-zero`.

## Session 2026-10-28 — re-spec before sdd-execute sequential (sdd-batch-execute)

- Branch setup (§5.3): detached checkout of `origin/feature/fix-python-config-stored-zero`, then `git merge -X ours origin/main-dev`
  (brings in the indicators override-clamp change and `tests/test_execute_formula_override_clamp.py`).
- Re-specced Step bodies (Codebase Evidence / Instructions / Verification only; no scope change):
  - Step 7: indicators `servicer.py` drift. `__init__` :93, semaphore :107, `max_concurrent=` :310. The old `:277-278` `or` read is
    now `_clamp_override(...)` at :282-285 (`_clamp_override` :66-68, `min(override, configured) if override > 0 else configured`).
    The accessor clamp still covers it, because `configured` comes from the accessor. The stale "request `or` is out of scope" note was removed.
    The new override-clamp test's `_cfg()` double (:20-26) bypasses the accessor and should stay green.
  - Step 8: `__init__` :93, semaphore :107, RLIMIT_NPROC path :310.
  - Step 10: the real_pg postgresql install step is `ci.yml:400-404`. `_SORT_ORDER_BY[0]` is the feature-200 windowed symbol roll-up and still
    references only `$3`, so the `$3 → $1::float8` rebind plan holds.
  - Step 12: `_make_loop` is at :45 and `_sched_loop` at :379.
  - Step 15: the 029 no-BEGIN/COMMIT line is :15. 032 still holds (main-dev tip is 030 and 243 claims 031).
  - Step 17: the analysis CLAUDE.md grep was re-run (`:521` added; `:494` no longer matches but is still worth reviewing). Indicators `:100` was rewritten by main-dev and must be kept.
    config-governance.md rule is now :251-258.
  - Step 14: no evidence drift. Tooling note: run `pnpm install` in the config service first, and record the Node version (the host
    has Node 22, while CI pins 24).

## Session 2026-10-28 — sdd-execute sequential (sdd-batch-execute)

- Mode: `/sdd-execute fix-python-config-stored-zero sequential`, run by the sdd-batch-execute workflow in an isolated worktree
  (single writer, P-01). Each step is one commit on `feature/fix-python-config-stored-zero`, with no per-step PRs.
- Up-front confirmation: approved by operator standing authorization (operator chat 2026-10-28, session_01NpS3HShZK6pSnogA7CFo2f:
  'Start executing features 241-276' via batch-execute). Answers recorded:
  - checkpoints are unattended and reported (`report`);
  - C-16 promotion is auto-confirmed unless it changes an existing @AC rule;
  - merge-train is authorized;
  - 255/275 are deferred (not this feature).
- Open advisory from impl-spec review: Steps 10, 11 and 17 exceed 5 files. Under the standing authorization they stay unsplit, so the step numbering and the C-15 trace are unchanged.
- Status: `implementation-ready` → `in-progress`. Next: Step 1.

## Session 2026-10-28 — sdd-execute sequential, Step 1

- Step 1 (service: ingest getters honour a stored zero) done. `services/xstockstrat-ingest/app/config/watcher.py`:
  `get_str`/`get_int`/`get_float` return `v.<x>_val if v.HasField("<x>_val") else default`; the `get_int_present`
  method is replaced by the class alias `get_int_present = get_int` (callers at `dedup_window_hours`/`max_retry_attempts`
  pass `default=` by keyword and still bind). Properties untouched (Step 3 owns them).
- TDD: AC-1 red: 3 ingest rows (`zero_int`/`zero_float`/`zero_string`) returned the default (7/0.5/"x") and the alias
  assertion failed (4 failed, 1 passed) → green: 5 passed. Harness was an uncommitted scratch test (paired test is
  Step 2); logged in the Deviation Log.
- Verification: `grep 'or default'` → no output; `get_int_present = get_int` → 1 hit (`:120`). Full ingest suite
  328 passed (173 alias tests included); ruff check + format clean.
- Tooling: `uv sync --extra dev --frozen` in ingest (no manifest change).
- Next: Step 2.

## Session 2026-10-28 — sdd-execute sequential, Step 2

- Step 2 (test: ingest getter rows for @AC-1 / @AC-4) done. `services/xstockstrat-ingest/tests/conftest.py` gains
  `snapshot_watcher(**values)` (dial-free `ConfigWatcher.__new__`; `bool` → `bool_val` checked before `int` →
  `int_val`, `float` → `float_val`, `str` → `string_val`; lazy imports so `_setup_gen_path()` runs first).
  `test_config_watcher.py`: `_int_watcher` keeps its name and now delegates to `snapshot_watcher` (imported via
  `from tests.conftest import snapshot_watcher`, the existing `_ctx` pattern); new
  `test_getters_honour_stored_zero` (3 @AC-1 rows) and `test_getters_default_when_unset_or_mismatched` (3 @AC-4 rows).
- TDD: AC-1 red (tests run against the pre-Step-1 `watcher.py` from `HEAD~1`, restored after): 3 failed
  (`zero_int` → 7, `zero_float` → 0.5, `zero_string` → "x"), 14 passed → green on the Step-1 tree: 17 passed.
- Verification: `test_config_watcher.py` 17 passed; full ingest suite 334 passed, coverage 81.61% (≥40); ruff check
  + format clean; `snapshot_watcher` defined once (`tests/conftest.py:71`), used only from `test_config_watcher.py`.
- Next: Step 3.

## Session 2026-10-28 — sdd-execute sequential, Step 3

### Step 3 — service: ingest FR-3 clamps, dead sandbox helpers removed [done]
- `app/config/watcher.py` gains module-level `int_positive(cfg, key, default)` (`v if v > 0 else default`).
  `backfill_max_concurrent_jobs`, `backfill_chunk_max_bars`, `backfill_chunk_window_days` and
  `backfill_max_concurrent_chunks` read through it with their literal defaults. The stale `servicer.py:191`/`:519`
  trap comments are now 1-line hazard comments that name the consumer symbol. The dead `sandbox_*` helpers are deleted.
  `retry_on_failure`, `max_retry_attempts` and `dedup_window_hours` are unchanged.
  `app/engine/mcp_client_loop.py` reads timeout and poll interval through `int_positive` (outer `max(…, 1)` dropped);
  docstring now says a stored value ≤ 0 reads as the default. 3 dead-helper tests removed from `test_ingest_servicer.py`.
- TDD: AC-5/AC-6 (ingest) red on the Step-2 tree, via an uncommitted scratch test (8 failed, 3 passed):
  - the properties at 0/-5 returned 0/-5;
  - the timeout was 1.0 (expected 30) and the first poll sleep was 1 (expected 300);
  - `sandbox_timeout_ms` still existed.
  Green: 11 passed. The real tests land in Step 4.
- Verification:
  - `grep sandbox_ app/config/watcher.py` returns no output.
  - `int_positive` has 1 def (`watcher.py:192`) and 6 call sites (4 in `watcher.py`, 2 in the loop), plus the import.
  - `grep "max(" mcp_client_loop.py` returns no output.
  - Full ingest suite: 331 passed (334 minus the 3 deleted tests), coverage 81.52%. ruff check and format are clean.
- Not in this step's Files, left for Step 17:
  - ingest `CLAUDE.md` still says "Clamped to ≥1 at read" for the two `mcp_client` keys, and its header still mentions the `sandbox_*` helpers.
  - `docs/context-constitution-findings.md:27` still mentions the `sandbox_*` helpers.
- Files modified: `services/xstockstrat-ingest/app/config/watcher.py`, `services/xstockstrat-ingest/app/engine/mcp_client_loop.py`, `services/xstockstrat-ingest/tests/test_ingest_servicer.py`
- Deviations: TDD scratch harness and docstring line drift (`:156-158`, not `:157-159`); see the Deviation Log.
- Next: Step 4.

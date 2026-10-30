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

## Session 2026-10-28 — sdd-execute sequential, Step 4

### Step 4 — test: ingest @AC-5 / @AC-6 rows and the read-classification guard [done]
- AC-5: `test_backfill_semaphore_stored_zero_reads_as_default` (`test_ingest_servicer.py`) passes a real
  `snapshot_watcher` (max_concurrent_jobs 0) through the `IngestServicer` constructor and asserts `_backfill_sem._value == 3`.
  AC-6: `test_fr3_properties_read_non_positive_as_default` (`test_config_watcher.py`, chunks/max_bars/window_days at 0,
  jobs at -5); loop rows `test_cycle_request_timeout_stored_zero_reads_as_default` (30.0) and
  `test_poll_interval_stored_zero_reads_as_default` (patched `asyncio.sleep`, first sleep 300) in `test_mcp_client_loop.py`.
  New guard `tests/test_config_read_classification.py`: module-level `collect(app_dir)` AST scan, rules 1-6 as
  separate tests, ingest `FR3_KEYS` (6) / `HONOUR_KEYS` (2) / `ZERO_IS_LEGIT` (2) from the classification table.
- TDD: AC-5/AC-6 red on the Step-2 app tree (`git checkout 62972c4f --` the two app files, restored before green):
  8 failed, 133 passed — sem `_value` 0; properties 0/0/0/-5; timeout 1.0; first sleep 1; guard rule 2 (the reads
  included the FR-3 and dead `indicators.sandbox.*` keys, the clamp set was empty) → green on HEAD: 141 passed.
- Verification: the four step files 141 passed; full ingest suite 344 passed, coverage 82.02% (≥40); ruff check and
  format clean (the guard's regex line was wrapped by `ruff format`); `snapshot_watcher` defined once
  (`tests/conftest.py:71`), imported by `test_config_watcher.py` and `test_ingest_servicer.py`. `.jscpd.json:27`
  ignores `**/tests/**` (confirmed).
- Files modified: `services/xstockstrat-ingest/tests/test_config_watcher.py`, `services/xstockstrat-ingest/tests/test_ingest_servicer.py`, `services/xstockstrat-ingest/tests/test_mcp_client_loop.py`, `services/xstockstrat-ingest/tests/test_config_read_classification.py`
- Deviations: RED via temporary Step-2 app files; `__init__` line drift; guard data shapes. See the Deviation Log.
- Husky pre-commit did not run: there is no `node_modules` in the main worktree to symlink and `core.hooksPath` is
  unset, so no hook ran (same as Steps 1-3; never `--no-verify`).
- Next: Step 5.

## Session 2026-10-28 — sdd-execute sequential, Step 5

- Step 5 (service: indicators getters honour a stored zero) done. `services/xstockstrat-indicators/app/config/watcher.py`:
  `get_str`/`get_int`/`get_float` return `v.<x>_val if v.HasField("<x>_val") else default`; the `get_str_present`
  method (and its docstring) is replaced by the class alias `get_str_present = get_str` (`:98`). Its one caller,
  `sandbox_allowed_imports`, passes `default=` by keyword and still binds. Sandbox accessors untouched (Step 7).
- TDD: AC-1 red: 3 indicators rows (`zero_int`/`zero_float`/`zero_string`) returned the default (7/0.5/"x") and the
  alias assertion failed (4 failed, 1 passed) → green: 5 passed. Harness was an uncommitted scratch test (paired test
  is Step 6); logged in the Deviation Log.
- Verification: `grep 'or default'` → no output; `get_str_present = get_str` → 1 hit (`:98`). Full indicators suite
  294 passed (173 `get_str_present` tests included); ruff check + format clean.
- Tooling: `uv sync --extra dev --frozen` in indicators (no manifest change).
- Husky pre-commit did not run: no `node_modules` in the main worktree to symlink and `core.hooksPath` unset (same as
  Steps 1-4; never `--no-verify`).
- Next: Step 6.

## Session 2026-10-28 — sdd-execute sequential, Step 6

- Step 6 (test: indicators getter rows for @AC-1 / @AC-4) done. `services/xstockstrat-indicators/tests/conftest.py`
  gains `snapshot_watcher(**values)` (same builder as ingest Step 2; typed arms only, bool before int). 243 has not
  landed, so `_str_watcher(key, val)` keeps its name and returns `snapshot_watcher(**{key: val})`; no `ConfigValue`
  arm. New in `test_config_watcher.py`: `test_getters_honour_stored_zero` (zero_int 0/7, zero_float 0.0/0.5,
  zero_string ""/"x") and `test_getters_default_when_unset_or_mismatched` (unset_int `_snapshot=None` → 7,
  mismatched_float `string_val="5"` via `get_float` → 0.5, unset_string absent → "x").
- TDD: AC-1 red on the Step-4 watcher (`git checkout 52b55fee --`, restored before green): 3 failed, 13 passed
  (rows returned 7 / 0.5 / "x") → green on HEAD: 16 passed. The 173 `get_str_present` tests stayed green on both.
- Verification: `tests/test_config_watcher.py` 16 passed; full indicators suite 300 passed, coverage 85.61% (≥50);
  ruff check and format clean.
- Files modified: `services/xstockstrat-indicators/tests/conftest.py`, `services/xstockstrat-indicators/tests/test_config_watcher.py`
- Deviations: RED via temporary Step-4 watcher; @AC-4 rows parametrized over factories. See the Deviation Log.
- Husky pre-commit did not run: no `node_modules` in the main worktree to symlink and `core.hooksPath` unset (same as
  Steps 1-5; never `--no-verify`).
- Next: Step 7.

## Session 2026-10-28 — sdd-execute sequential, Step 7

### Step 7 — service: indicators sandbox accessors clamp a stored zero [done]
- `app/config/watcher.py` gains module-level `int_positive(cfg, key, default)` (`v if v > 0 else default`, same body
  as ingest Step 3). `sandbox_timeout_ms`, `sandbox_memory_bytes` and `sandbox_max_concurrent()` read through it with
  their literal defaults (5000 / `128 * 1024 * 1024` / 4). `servicer.py` builds `asyncio.Semaphore(
  config_watcher.sandbox_max_concurrent())` (the `max(1, …)` is subsumed). `_clamp_override` and
  `sandbox_allowed_imports` (`get_str_present`) are unchanged.
- TDD: AC-6 (indicators) red on the Step-6 tree via an uncommitted scratch test (4 failed, 1 passed):
  `int_positive` missing; accessors at 0/-1 returned 0/-1 (expected 5000); semaphore `_value` 1 (expected 4) →
  green: 5 passed. The real tests land in Step 8.
- Verification: `grep int_positive app/config/watcher.py` → 1 def (`:143`) + 3 calls (`:126`, `:130`, `:140`);
  `grep "max(1" app/handlers/servicer.py` → no output. Full indicators suite 300 passed, coverage 85.61% (≥50);
  ruff check + format clean.
- Not in this step's Files, left for Step 17: indicators `CLAUDE.md` `max_concurrent` row still says the accessor
  has a `max(1, …)` clamp.
- Files modified: `services/xstockstrat-indicators/app/config/watcher.py`, `services/xstockstrat-indicators/app/handlers/servicer.py`
- Deviations: TDD scratch harness; comment wording; `sandbox.py` path citation. See the Deviation Log.
- Husky pre-commit did not run: no `node_modules` in the main worktree to symlink and `core.hooksPath` unset (same as
  Steps 1-6; never `--no-verify`).
- Next: Step 8.

## Session 2026-10-28 — sdd-execute sequential, Step 8

### Step 8 — test: indicators @AC-6 rows and the read-classification guard [done]
- `tests/test_config_watcher.py`: parametrized `test_sandbox_accessors_clamp_stored_non_positive` over a real
  `snapshot_watcher`: `timeout_ms` 0 → 5000, `memory_bytes` 0 and -1 → 134217728, `max_concurrent` 0 → 4.
- `tests/test_execute_formula_concurrency.py`: with `max_concurrent` 0 and `allowed_imports` `""`,
  `IndicatorsServicer(...)._sandbox_sem._value == 4`. A recorder `sandbox.execute_formula` double sees
  `max_concurrent` 4, `timeout_ms` 5000 and `memory_bytes` 134217728 on one `ExecuteFormula`.
- `tests/test_config_read_classification.py` (new): the Step-4 ingest guard with `FR3_KEYS` = the three sandbox int
  keys, `HONOUR_KEYS = {"indicators.sandbox.allowed_imports"}`, `ZERO_IS_LEGIT = {}`. It exposes `collect(app_dir)`.
  The keyword-default `get_str_present` call binds. The `int_positive` body is skipped by name.
- TDD: RED against the Step-6 `app/` (`git checkout e796238a --`, restored before GREEN): 7 failed, 24 passed. The
  failures were guard rule 2, the 4 accessor rows (0 / -1 returned as-is), the semaphore row (`_value` 1 via the old
  `max(1, …)`) and the recorder row (`max_concurrent` 0). GREEN: 31 passed.
- Verification: the full indicators suite gave 312 passed, coverage 85.61% (≥50). `ruff check` and
  `ruff format --check` were clean.
- Files modified: `services/xstockstrat-indicators/tests/test_config_watcher.py`,
  `services/xstockstrat-indicators/tests/test_execute_formula_concurrency.py`,
  `services/xstockstrat-indicators/tests/test_config_read_classification.py` (created)
- Deviations: the TDD evidence method and the RED-tree note. See the Deviation Log.
- Husky pre-commit did not run. The main worktree has no `node_modules` to symlink, and `core.hooksPath` points at a
  missing `.husky/_` (same as Steps 1-7; never `--no-verify`).
- Next: Step 9.

## Session 2026-10-28 — sdd-execute sequential, Step 9

### Step 9 — service: analysis getters honour a stored zero (HasField) [done]
- `services/xstockstrat-analysis/app/config/watcher.py`: `get_str`/`get_int`/`get_float` return
  `v.<x>_val if v.HasField("<x>_val") else default`. The `get_int_present` and `get_float_present` bodies and
  docstrings are replaced by the class aliases `get_int_present = get_int` (`:107`) and
  `get_float_present = get_float` (`:125`). Positional and `default=` callers still bind. The dead sandbox helpers are
  left for Step 11. The FR-4 sites (`servicer.py:787-788`, `:4615`, `:4859`, `live_loop.py:351`) are fixed through
  the getter, with no edit to those files.
- TDD: AC-1 red via an uncommitted scratch test (4 failed, 1 passed). The three analysis rows
  (`zero_int`/`zero_float`/`zero_string`) returned the defaults 7 / 0.5 / "x", and the alias assertion failed.
  Green: 5 passed. The paired test is Step 10.
- Verification: `grep 'or default'` gives no output. `grep '_present = get_'` gives 2 hits (`:107`, `:125`).
  `ruff check` and `ruff format --check` are clean.
- Full analysis suite: 1 failed, 1275 passed (baseline 1276 passed). The one failure is the expected
  `TestConfigWatcherGetters::test_get_float_present_explicit_zero_is_not_trapped`. Its `:594` line asserts the old
  `get_float` zero-trap, and Step 10 rewrites it. The green run is Step 10's Verification.
- Tooling: `uv sync --extra dev --frozen` in analysis (no manifest change).
- Open for Step 17 (outside this step's Files): the analysis `CLAUDE.md` config table still describes intentional
  `get_int`/`get_float` zero-traps. Affected rows: `default_fill_model`, `portfolio_position_weight`,
  `portfolio_max_concurrent`, `shrinkage_days`, `default_cooldown_days` and the `max_concurrent_*` rows.
- Files modified: `services/xstockstrat-analysis/app/config/watcher.py`
- Deviations: TDD scratch harness, and the expected inter-step test failure. See the Deviation Log.
- Husky pre-commit did not run: the main worktree has no `node_modules` to symlink (same as Steps 1-8; never
  `--no-verify`).
- Next: Step 10.

## Session 2026-10-28 — sdd-execute sequential, Step 10

### Step 10 — test: analysis getter rows, FR-4 behaviours and zero-honour sites [done]
- `tests/conftest.py`: `snapshot_watcher(**values)` (typed-arm rules as ingest/indicators; `ConfigWatcher.__new__`
  carrying `endpoint`, `namespace="analysis"`, `_snapshot_event`). Sole definition (C-13); Step 12 is the other consumer.
- `test_analysis_servicer.py`: `:594` now asserts `get_float("k", 24.0) == 0.0` and the comment states the HasField
  contract. New `TestConfigWatcherGetters` rows: @AC-1 (`signal_rank_weight` 0.0, `alert_throttle_seconds` 0,
  `analysis.test.zero_string` ""), @AC-4 (`default_commission_pct` / `alert_throttle_seconds` absent, `unset_string`
  with `_snapshot = None`).
- `test_fill_model.py` (@AC-2): the seam records `commission`/`slippage` 0.0 reaching `_backtest_symbol_evaluated`
  from `RunBacktest`; the effect row fills at close 100 → 110 with `pnl == qty * 10`.
- `test_opportunities_repo.py` (@AC-3): the seam asserts `opps.read` gets weight 0.0; the `real_pg` rows run
  `_SORT_ORDER_BY[0]` (rebound `$1::float8`) over a VALUES subquery: 0.0 → `[AAA, BBB]`, 0.3 → `[BBB, AAA]`.
- `test_live_loop.py` (@AC-9): `_run_cycle` passes throttle 0 to `_eval_pair`; an exit transition 10s after the last
  alert emits `EmitAlert` at throttle 0.
- `test_screener.py` / `test_query_pnl_patterns.py` (@AC-12): `default_rank_limit` 0 returns all 51 results;
  `min_sample_count` 0 reaches `bucket_pnl_factors`.
- TDD: RED against the Step-8 `watcher.py` (`git checkout e2b41e19 --`, restored before GREEN): 9 failed, 28 passed —
  the `:594` row (24.0), the three @AC-1 rows (0.3 / 300 / "x"), AC-2 seam (0.001/0.0005), AC-3 seam (0.3), AC-9 seam
  ([300]), AC-12 screener (50) and patterns ([5]). The effect rows (zero-cost fill, alert at throttle 0, SQL order)
  are green on both trees by design. GREEN: all pass.
- Verification: the six named files gave 533 passed; full analysis suite 1291 passed, coverage 88.36% (≥40);
  `ruff check` and `ruff format --check` clean (one import-sort fix applied); `grep "def snapshot_watcher"` → only
  `tests/conftest.py:54`. The `real_pg` rows ran (not skipped) on the local `local_pg` harness.
- Files modified: `services/xstockstrat-analysis/tests/{conftest.py,test_analysis_servicer.py,test_fill_model.py,
  test_opportunities_repo.py,test_live_loop.py,test_screener.py,test_query_pnl_patterns.py}`
- Deviations: TDD evidence method; test-shape choices (inline `_svc_req`, `s1` id). See the Deviation Log.
- Husky pre-commit did not run: the main worktree has no `node_modules` to symlink (same as Steps 1-9; never
  `--no-verify`).
- Next: Step 11.

## Session 2026-10-28 — sdd-execute sequential, Step 11

### Step 11 — service: analysis FR-3 clamps, named readers, `max(1, …)` and inline-clamp conversion [done]
- `app/config/watcher.py`: module-level `int_positive` / `float_positive` / `str_nonempty` (each calls `cfg.get_*`,
  so `MagicMock` overrides still reach the read); dead `sandbox_*` properties deleted with their 3 tests in
  `tests/test_analysis_servicer.py`.
- Named readers: `default_cooldown_days(cfg)` next to `blend_strategy_id` in `servicer.py` (both RunBacktest cooldown
  sites + `live_loop.py`); `fundsignal_source_slug(cfg)` in `fundsignal_loop.py` (`run_once` + `live_loop.py`'s
  fundamentals universe). `blend_strategy_id` now uses `str_nonempty`. `live_loop` → `fundsignal_loop` import adds no
  cycle (fundsignal_loop imports only `durable_schedule` / `identity` from `app`).
- All 34 analysis FR-3 sites read through a clamp with the same default (F-07). Removed the read-site `max(1, …)`
  wrappers (`__init__` ×5, portfolio_max_concurrent, detail retention, entry_backfill, screener sem, fundsignal
  `run_interval_hours` ×2) and the two inline `<= 0` blocks (`read_db_budget_ms`, `live_enrich_timeout_ms`). Kept:
  the `retry_seconds` wrappers, `empty_recompute_ttl_seconds`, `bucket_pnl_factors` floor, `min_sample_count` honour,
  `readiness_materializer.valid_window_hours` (HONOUR), `default_fill_model` honour read.
- Comments rewritten to state the `>0` clamp (`__init__`, portfolio sizing, retention), the `default_fill_model`
  0 = legacy constraint, and the exit-cooldown "configured 0 is legitimate" constraint (mechanism clause dropped in
  `servicer.py` and `live_loop.py`).
- TDD: RED via an uncommitted scratch test (5 failed: helpers ImportError, semaphore `_value == 1`, named readers
  ImportError, screener sem 1, fundsignal `_tick` 3600). GREEN: 5 passed. Paired test is Step 12.
- Verification: anchored `max(1, …get_int(` grep → no output (spec pattern also prefix-matches the kept
  `get_int_present` retry wrappers — see Deviation Log); helper grep → 45 hits; `sandbox_` in watcher → none; both named
  readers found. `ruff check` / `ruff format --check` clean. Full suite with coverage: 1 failed, 1287 passed, coverage
  88.37%. The one failure is the expected `test_retention_clamped_to_at_least_one` (asserts 1; Step 12 flips it).
- Open for Step 17: analysis `CLAUDE.md` Config Keys rows still describe the `get_int` zero-trap / `max(1, …)` clamp
  (`portfolio_position_weight`, `portfolio_max_concurrent`, `default_fill_model`, `shrinkage_days`,
  `default_cooldown_days`, `series.max_concurrent_components`, the `max_concurrent_*` / `max_worker_threads` rows,
  `readiness_materializer.max_concurrent_bars_fetches`).
- Files modified: `services/xstockstrat-analysis/app/{config/watcher.py,handlers/servicer.py,engine/live_loop.py,
  engine/fundsignal_loop.py,engine/entry_backfill.py,engine/pnl_pattern_consumer.py,services/screener.py}`,
  `services/xstockstrat-analysis/tests/test_analysis_servicer.py`
- Deviations: TDD scratch harness; verification grep prefix-match. See the Deviation Log.
- Husky pre-commit did not run: the main worktree has no `node_modules` to symlink (same as Steps 1-10; never
  `--no-verify`).
- Next: Step 12.

## Session 2026-10-28 — sdd-execute sequential, Step 12

### Step 12 — test: analysis @AC-6 / @AC-7, the guard, and the retention flip [done]
- `tests/test_config_read_classification.py` (new): the Step-4 AST guard with the analysis sets — clamp names
  `int_positive` / `float_positive` / `str_nonempty`, 34 `FR3_KEYS`, 36 `HONOUR_KEYS`, 8-entry `ZERO_IS_LEGIT`;
  `collect(app_dir)` returns per key the set of `(module_dotted_path, default_source)` plus the rule-1 errors.
- `tests/test_config_zero_clamps.py` (new):
  - @AC-6 table: 34 rows `(key, type, effective)` from `acceptance.feature`; each default resolved from `collect()`
    and `eval`'d in its module (covers `_DEFAULT_OPP_*` constants); a `-5` row for `portfolio_max_concurrent`; a
    table-equals-`FR3_KEYS` check.
  - @AC-6 seams on one all-zero real watcher: `AnalysisServicer.__init__` sems/pool (4/2/4/4/2), `blend_strategy_id`
    / `default_cooldown_days` / `fundsignal_source_slug`, `ScreenerEngine._sem` 4, fundsignal disabled `_tick()` 86400,
    `default_fill_model` 0 → `FILL_MODEL_SAME_BAR_CLOSE`.
  - @AC-7: both `refresh_hour_utc` seams return 0; `min_conviction_to_emit` 0.0, `scoring_formula_id` "",
    `explicit_symbols` "" read back as stored; all five keys in `HONOUR_KEYS`, never clamped.
- `tests/test_analysis_servicer.py`: `test_retention_clamped_to_at_least_one` → `test_retention_non_positive_reads_as_default`
  parametrized `-5` / `0`, both asserting `retention == 20`.
- TDD: RED against the Step-10 `app/` (`git checkout e16c0fff --`, restored before GREEN): 43 failed, 19 passed —
  guard rule 2, all 34 table rows (`KeyError` at `collect()`), the -5 row, every seam (sems 1, named readers missing,
  screener 1, `_tick` 3600, RunBacktest aborted by `max_range_days` 0), both retention rows (1). AC-7 rows green on
  both trees by design. GREEN: all pass.
- Verification: the five named files gave 500 passed; full analysis suite 1345 passed, coverage 88.37% (≥40);
  `ruff check` / `ruff format --check` clean; `def snapshot_watcher` only at `tests/conftest.py:54`.
- Files modified: `services/xstockstrat-analysis/tests/{test_config_read_classification.py (new),
  test_config_zero_clamps.py (new), test_analysis_servicer.py}`
- Deviations: TDD evidence method; guard/test shape choices. See the Deviation Log.
- Husky pre-commit did not run: the main worktree has no `node_modules` to symlink (same as Steps 1-11; never
  `--no-verify`).
- Next: Step 13.

## Session 2026-10-28 — sdd-execute sequential, Step 13

### Step 13 — service: config bounds comments match the new getter semantics (FR-6) [done]
- `services/xstockstrat-config/src/grpc/configServiceImpl.ts`, comments only:
  - the `max_concurrent_bars_fetches` block now ends "min 1 — a Python reader clamps ≤ 0 to the default, so 0 is
    never 'unlimited'";
  - the feature-184 block now says lower 0 where 0 is a legitimate value (`refresh_hour_utc` = midnight,
    `signal_rank_weight`), lower 1 where the Python reader clamps ≤ 0 to the default. The PgBouncer-ceiling clause is
    kept on its own line.
  - No `SCALAR_BOUNDS_REGISTRY` entry changed.
- TDD: red N/A (comment-only, per the step's **TDD** field). Step 14 adds the characterization tests; state this
  tdd-gate escape in the PR body.
- Verification: `grep -n "zero-trap\|would collapse"` returned no output; `git diff --stat` shows 4 insertions and 4
  deletions, all comment lines. `prettier --check` / `tsc` could not gate: the config service has no `node_modules`
  here, and prettier warns on the unedited HEAD file as well.
- Files modified: `services/xstockstrat-config/src/grpc/configServiceImpl.ts`
- Deviations: comment layout and evidence harness. See the Deviation Log.
- Next: Step 14.

## Session 2026-10-28 — sdd-execute sequential, Step 14

### Step 14 — test: config bounds still reject 0 (@AC-8) and a zero survives the WatchConfig wire (@AC-10) [done]
- `setConfigScalarBounds.test.ts`: the AC-4 `it` gains `setConfig({ intVal: 0 }, OPP_CONC)` → `INVALID_ARGUMENT`,
  `/\[1, 5\]/`, no INSERT (@AC-8).
- `watchConfigWireZero.test.ts` (new): inline pool with three `analysis.test.zero_*` rows (int `'0'`, float `'0'`,
  string `''`); `reloadNamespace` → `watchConfig(fakeCall)` (env 2, global) → 20 ms wait → `writes.length === 1` →
  `broadcastToSubscribers` → `writes.length === 2`; each payload round-trips through the `watchConfig`
  `responseSerialize`/`responseDeserialize`, and both legs carry `intVal` 0, `floatVal` 0 and `stringVal` '' (@AC-10).
- TDD: red N/A — no behavior change; characterization test added (state this in the PR body). Mutants on the compiled
  `dist/` only (truthiness arms in `toProtoSnapPayload`; OPP_CONC `minValue: 0`) each failed the new tests, then `tsc`
  rebuilt `dist/` from the untouched `src/`. GREEN: 181/181 pass.
- Verification: `pnpm install` (frozen lockfile, no lockfile change); `pnpm run test:coverage` exit 0, 181 pass,
  lines 88.03% (≥40); `pnpm run lint` 0 errors (166 pre-existing `no-explicit-any` warnings); the `OPP_CONC` grep
  shows the `intVal: 0` case at `:221`. Node 22.22.0 (CI pins 24).
- Files modified: `services/xstockstrat-config/src/__tests__/{setConfigScalarBounds.test.ts,watchConfigWireZero.test.ts (new)}`
- Deviations: evidence harness only. See the Deviation Log.
- Husky pre-commit: `pnpm install` created the worktree's root `node_modules`, so the hook runs (never `--no-verify`).
- Next: Step 15.

## Session 2026-10-28 — sdd-execute sequential, Step 15

### Step 15 — migration: description-only correction of the 027/028 zero-trap descriptions [done]
- `services/xstockstrat-config/migrations/032_analysis_zero_trap_descriptions.up.sql`: four
  `UPDATE config.config_values SET description = '<new>' WHERE namespace = 'analysis' AND key = '<full dotted>' AND
  description = '<old>'` statements (no BEGIN/COMMIT, 029 shape). `<old>` was extracted programmatically from the
  027/028 seed rows (each appears exactly twice, staging + production) and `<new>` replaces only the mechanism clause
  named in Instruction 1. `.down.sql` holds the four inverse `UPDATE`s (`<old>` where `description = '<new>'`).
- No `value_data`/`value_type`/`key` change, no INSERT/DELETE, no audit row or `pg_notify`; 027/028 untouched.
- `docs/roadmap/features/merge-order.md`: the Instruction-4 row (244 waits softly for 243; 031/032 renumber rule)
  appended to § Blocking Dependencies after the 230 row.
- TDD: N/A (migration).
- Verification (offline, no DB): both files listed; `origin/main-dev` tip is still `030_marketdata_edgar_snapshot_keys`
  (243's branch holds `031_heal_indicators_sandbox_keys_full_dotted`), so `032` holds; `^UPDATE` count 4; the
  `insert|delete|value_data|value_type` grep returned no output; each `.down` statement inverts one `.up` statement
  (SET/WHERE descriptions swapped, same key).
- Open: 248 `fix-ledger-trimmed-notify-payload` (`implementation-ready`) also pins config `032_` in its spec
  (`032_ledger_stream_resolve_timeout`, no file on its branch yet). Whichever of 244/248 merges second renumbers by
  `max(origin/main-dev)+1` immediately before merge; the 244 merge-order row covers only 243, so a 244 ↔ 248 row is
  still needed (outside this step's Files).
- Files modified: `services/xstockstrat-config/migrations/032_analysis_zero_trap_descriptions.{up,down}.sql` (new),
  `docs/roadmap/features/merge-order.md`
- Deviations: none.
- Next: Step 16.

## Session 2026-10-28 — sdd-execute sequential, Step 16

### Step 16 — test: the description migration is description-only and reversible (@AC-11) [done]
- `services/xstockstrat-config/src/__tests__/zeroTrapDescriptionMigration.test.ts` (new): globs exactly one
  `*_analysis_zero_trap_descriptions.{up,down}.sql` under `path.resolve(__dirname, '../../migrations')`. A quote-aware
  splitter (drops `--` comments, collapses whitespace outside literals) yields statements that must each match the
  anchored description-only `UPDATE` regex. No statement contains INSERT/DELETE/value_data/value_type/`SET key`; 4
  statements per direction, distinct keys, no SET == WHERE; each up WHERE literal (SQL-escaped, incl. `loop''s`)
  appears verbatim in 027/028; down SET/WHERE = up WHERE/SET for the same key. Inline expectations (C-13).
- TDD: AC-11 red: with the 032 pair moved aside (Step 15 already landed) the suite failed "expected exactly one
  *_analysis_zero_trap_descriptions.up.sql, got []" → green: 4/4 pass, full suite 185/185.
- Verification: `pnpm install --frozen-lockfile --filter . --filter "xstockstrat-config..."` (no lockfile change);
  `pnpm run test:coverage` exit 0, 185 pass, lines 88.03% (≥40); `pnpm run lint` 0 errors (166 pre-existing
  `no-explicit-any` warnings, none in the new file); the new file is prettier-clean. Node 22.22.0 (CI pins 24).
- Files modified: `services/xstockstrat-config/src/__tests__/zeroTrapDescriptionMigration.test.ts` (new)
- Deviations: evidence method + test shape only. See the Deviation Log.
- Next: Step 17.

## Session 2026-10-28 — sdd-execute sequential, Step 17

### Step 17 — docs: config-key rows, constitutions, findings, governance; context-forge teardown [done]
- Config-key rows now state shipped behaviour: FR-3 keys "a stored ≤ 0 reads as the default" (`int_positive` /
  `float_positive` / `str_nonempty`), honour and FR-4 keys "a configured `0` is honoured"; `default_fill_model` keeps
  "0 = legacy, stored or absent". The "never `get_*`" and "`get_int` zero-trap" mechanisms are gone from the analysis,
  ingest and indicators `CLAUDE.md` rows and from `config-governance.md`. The governance lower-bound rule is now
  "legitimate 0 → lower 0; reader clamps ≤ 0 → lower 1", and the `signal_rank_weight` zero-trap note is deleted.
- Constitutions: the root PLAT gotcha is rewritten to the HasField + clamp + AST-guard model; CONFIG-11 now follows
  the clamp model and the Node-`getInt` gotcha is reworded; the analysis constitution line 37 is rewritten; INGEST-9
  line hints are re-stamped (`get_str` ~L104, `get_int` ~L112, alias ~L120, `get_bool` ~L122, `get_float` ~L130).
- Findings: CF-N10 is struck through as RESOLVED (feature 244) and has a `## Resolved` row. The ingest and analysis
  dead `sandbox_*` rows are resolved, both preambles now say the zero-trap was resolved by 244, and a config
  `sparkline_bars` drift row is added (028 description and `[1,500]` bounds, no analysis reader).
- TDD: N/A (docs).
- Verification: the `zero-trap` grep over the three CLAUDE.md files, governance, and the root and service
  constitutions returns only the root constitution's refresh-history header (lines 10 and 14). `CF-N10` appears at
  findings `:32` (struck through, RESOLVED) and `:55` (`## Resolved`).
- Teardown: `/context-forge:context-constitution` is unavailable (only `context-scrubber` is listed), so every touched
  context file was re-read by hand against the code. The integration PR body must record both facts (root CLAUDE.md § Teardown).
- Open items (outside this step's Files):
  - `services/xstockstrat-indicators/docs/context-constitution-findings.md:15` still cites
    `Semaphore(max(1, config_watcher.sandbox_max_concurrent()))`. Step 7 removed that `max(1, …)`. Feature 243 also edits the indicators docs.
  - The root findings report index row `2026-10-19-python-config-zero-trap-defect` (sidecar `triaged`) stays until the
    report is resolved at launch.
  - `docs/patterns/config-governance.md:405-407` (the feature-095 log) still describes a live `sparkline_bars` read.
    It is covered by the new config findings row.
- Files modified: `services/xstockstrat-{analysis,ingest,indicators}/CLAUDE.md`, `docs/patterns/config-governance.md`,
  `docs/context-constitution{,-findings}.md`, `services/xstockstrat-{analysis,config,ingest}/docs/context-constitution{,-findings}.md`
- Deviations: scope detail + teardown method only. See the Deviation Log.
- Next: Step 18.

## Session 2026-10-28 — sdd-execute sequential (sdd-batch-execute)

- Up-front confirmation: operator approved the plan by standing authorization (operator chat 2026-10-28,
  session_01NpS3HShZK6pSnogA7CFo2f: "Start executing features 241-276" via batch-execute; unattended checkpoints
  ("report"), C-16 promotion auto-confirmed unless it changes an existing @AC rule, merge-train authorized, 255/275
  deferred; operator-only DB/prod steps: open PR, hold merge).
- Status already `in-progress` (no transition). Branch setup: `git merge -X ours origin/main-dev` into the detached
  checkout of `origin/feature/fix-python-config-stored-zero` (merge 7c21021d).
- Re-spec, Step 18 only (the only pending step), line drift only, no semantic change: agent `list_opportunities`
  is at `tools.py:1527` (was `:1518`), `set_config` def at `:1651` (was `:1642`, now `list_config_keys`'
  `_resolve_scope`), params `:1655-1660`, docstring `:1662`. `configServiceImpl.ts:99`, `:466-469`, `:582`,
  `tools.py:715` and `NamespaceEditor.tsx:71-76` still match; every cited surface file exists.
- Step 18 is an operator-only rollout (DB audit, dev smoke). It needs DB/deploy access, so the operator runs it.
- Next: Step 18 rollout audit (operator), then the integration PR (merge held).

## Session 2026-10-28 — sdd-execute sequential, Step 18 (deferred to operator)

### Step 18 — docs: rollout audit and consumer-surface verification (C-14) [pending — operator]
- Deferred to the operator (P-03). This session has no DB access and no dev deploy, so it cannot run the
  Instruction-1 audit queries or the four Instruction-2 dev smokes. The step **Status** stays `pending`.
- The integration PR merge is held until the operator records the audit row counts and classification (FR-3 /
  honour / malformed), the four smoke outcomes and the restored values in this file under
  `## Session <date> — rollout (dev)`, then `(prod)`, so the step's Verification greps pass. The full list is in the
  implementation-spec Deviation Log.
- Code-side, nothing is pending. Re-checked this session: `configServiceImpl.ts:99` (the bounds comment; the registry
  is at `:100`), `:466-469` (the `create_key` gate), `:582` (`parseInt` → `NaN`), and the `tools.py` `set_config` /
  `run_backtest` / `list_opportunities` symbols. Every cited UI surface file exists.
- Not verified here: Step 15's migration on dev, the FR-5 seed audit, and 243's heal status. All three are
  operator-side.
- TDD: N/A (rollout).
- Next: the operator runs the Step 18 rollout; then open the integration PR and hold the merge.

## Session 2026-10-28 — sdd-batch-execute promotion plan (awaiting operator confirm)

```sdd-batch-promotion-plan
## Promotion plan - fix-python-config-stored-zero (feature 244)

### Verdicts
| @AC | target suite | CREATE/APPEND | verdict | note |
|---|---|---|---|---|
| AC-1 | /home/user/xstockstrat/docs/sdd/business-rules/platform.feature | APPEND | NEW | getter contract spans analysis, indicators and ingest |
| AC-2 | services/xstockstrat-analysis/acceptance/fix-python-config-stored-zero.feature | CREATE | NEW | RunBacktest zero-cost |
| AC-3 | same analysis file | CREATE | NEW | ListOpportunities default sort |
| AC-4 | platform.feature | APPEND | NEW | defaults for unset or mismatched values, three services |
| AC-5 | services/xstockstrat-ingest/acceptance/fix-python-config-stored-zero.feature | CREATE | NEW | ingest backfill semaphore clamp |
| AC-6 | platform.feature | APPEND | NEW | 41 rows across ingest, indicators and analysis, so cross-service. Kept whole to stay verbatim. |
| AC-7 | analysis file | CREATE | NEW | zero-default keys |
| AC-8 | services/xstockstrat-config/acceptance/fix-python-config-stored-zero.feature | CREATE | NEW | SetConfig bound |
| AC-9 | analysis file | CREATE | NEW | live-loop alert throttle |
| AC-10 | config file | CREATE | NEW | WatchConfig wire |
| AC-11 | config file | CREATE | NEW | description-only migration; the seed rows live in the config migrations |
| AC-12 | analysis file | CREATE | NEW | no-limit zero |

### Ready-to-write blocks

--- /home/user/xstockstrat/docs/sdd/business-rules/platform.feature (APPEND) ---
  @AC-1 @FR-1 @regression @feature-244
  Scenario Outline: A stored zero is honoured by the Python config getters
    Given the <service> ConfigWatcher snapshot holds "<key>" as a <type> value <stored>
    When the watcher's <getter> reads "<key>" with default <default>
    Then it returns <stored>

    Examples:
      | service                | key                                     | type   | stored | getter    | default |
      | xstockstrat-analysis   | analysis.opportunity.signal_rank_weight | float  | 0.0    | get_float | 0.3     |
      | xstockstrat-analysis   | analysis.engine.alert_throttle_seconds  | int    | 0      | get_int   | 300     |
      | xstockstrat-analysis   | analysis.test.zero_string               | string | ""     | get_str   | "x"     |
      | xstockstrat-indicators | indicators.test.zero_int                | int    | 0      | get_int   | 7       |
      | xstockstrat-indicators | indicators.test.zero_float              | float  | 0.0    | get_float | 0.5     |
      | xstockstrat-indicators | indicators.test.zero_string             | string | ""     | get_str   | "x"     |
      | xstockstrat-ingest     | ingest.test.zero_int                    | int    | 0      | get_int   | 7       |
      | xstockstrat-ingest     | ingest.test.zero_float                  | float  | 0.0    | get_float | 0.5     |
      | xstockstrat-ingest     | ingest.test.zero_string                 | string | ""     | get_str   | "x"     |

  @AC-4 @FR-2 @regression @feature-244
  Scenario Outline: An unset or mismatched value still resolves to the coded default
    Given the <service> ConfigWatcher <state>
    When the watcher's <getter> reads "<key>" with default <default>
    Then it returns <default>

    Examples:
      | service                | state                                         | getter    | key                                      | default |
      | xstockstrat-analysis   | snapshot has no entry for the key             | get_float | analysis.backtest.default_commission_pct | 0.001   |
      | xstockstrat-analysis   | snapshot has no entry for the key             | get_int   | analysis.engine.alert_throttle_seconds   | 300     |
      | xstockstrat-analysis   | has received no snapshot                      | get_str   | analysis.test.unset_string               | "x"     |
      | xstockstrat-indicators | has received no snapshot                      | get_int   | indicators.test.unset_int                | 7       |
      | xstockstrat-indicators | snapshot holds the key as a string value "5"  | get_float | indicators.test.mismatched_float         | 0.5     |
      | xstockstrat-indicators | snapshot has no entry for the key             | get_str   | indicators.test.unset_string             | "x"     |
      | xstockstrat-ingest     | snapshot has no entry for the key             | get_str   | ingest.test.unset_string                 | "x"     |
      | xstockstrat-ingest     | snapshot holds the key as a float value 2.5   | get_int   | ingest.test.mismatched_int               | 7       |
      | xstockstrat-ingest     | snapshot has no entry for the key             | get_float | ingest.test.unset_float                  | 0.5     |

  @AC-6 @FR-3 @regression @feature-244
  Scenario Outline: A trap-dependent site keeps the coded default for a stored zero
    Given "<key>" is stored as the <type> value <stored>
    When <service> resolves it for <site>
    Then the effective value is <effective>

    Examples:
      | service                | key                                              | type   | stored | site                                  | effective                 |
      | xstockstrat-ingest     | ingest.backfill.max_concurrent_chunks            | int    | 0      | the backfill chunk semaphore capacity | 3                         |
      | xstockstrat-ingest     | ingest.backfill.chunk_max_bars                   | int    | 0      | the chunk planner's bar cap           | 200000                    |
      | xstockstrat-ingest     | ingest.backfill.chunk_window_days                | int    | 0      | the chunk planner's window in days    | 90                        |
      | xstockstrat-ingest     | ingest.mcp_client.poll_interval_seconds          | int    | 0      | the mcp_client poll loop              | 300                       |
      | xstockstrat-indicators | indicators.sandbox.timeout_ms                    | int    | 0      | ExecuteFormula                        | 5000                      |
      | xstockstrat-indicators | indicators.sandbox.memory_bytes                  | int    | 0      | ExecuteFormula                        | 134217728                 |
      | xstockstrat-indicators | indicators.sandbox.max_concurrent                | int    | 0      | the sandbox semaphore capacity        | 4                         |
      | xstockstrat-analysis   | analysis.engine.eval_interval_seconds            | int    | 0      | the live-loop sleep between cycles    | 60                        |
      | xstockstrat-analysis   | analysis.engine.max_strategies_per_cycle         | int    | 0      | the live-loop per-cycle pair budget   | 50                        |
      | xstockstrat-analysis   | analysis.engine.fundamentals_blend_strategy_id   | string | ""     | the blend-governed strategy id        | "fundamentals_macd_blend" |
      | xstockstrat-analysis   | analysis.strategy.default_cooldown_days          | int    | 0      | the default re-entry cooldown in days | 31                        |
      | xstockstrat-analysis   | analysis.scoring.shrinkage_days                  | int    | 0      | the headline-grade shrinkage k        | 250                       |
      | xstockstrat-analysis   | analysis.screener.max_duration_seconds           | int    | 0      | the ScreenSymbols deadline            | 120                       |
      | xstockstrat-analysis   | analysis.backtest.portfolio_position_weight      | float  | 0.0    | portfolio-mode sizing                 | 0.10                      |
      | xstockstrat-analysis   | analysis.backtest.detail_retention_per_strategy  | int    | 0      | backtest-detail retention             | 20                        |
      | xstockstrat-analysis   | analysis.opportunity.max_concurrent_bars_fetches | int    | 0      | the opportunity bars-fetch semaphore  | 2                         |
      | xstockstrat-analysis   | analysis.backtest.default_fill_model             | int    | 0      | a RunBacktest without fill_model      | FILL_MODEL_SAME_BAR_CLOSE |
      | xstockstrat-analysis   | analysis.backtest.max_range_days                 | int    | 0      | the RunBacktest range cap in days     | 730                       |
      | xstockstrat-analysis   | analysis.snapshot.indicator_timeout_ms           | int    | 0      | the snapshot indicator timeout in ms  | 500                       |
      | xstockstrat-analysis   | analysis.screener.max_universe_size              | int    | 0      | the ScreenSymbols universe cap        | 100                       |
      | xstockstrat-analysis   | analysis.opportunity.max_universe_size           | int    | 0      | the opportunity universe cap          | 100                       |
      | xstockstrat-analysis   | analysis.fundsignal.run_interval_hours           | int    | 0      | the fundsignal loop interval in hours | 24                        |
      | xstockstrat-analysis   | analysis.fundsignal.daily_call_budget            | int    | 0      | the fundsignal daily call budget      | 200                       |
      | xstockstrat-ingest     | ingest.mcp_client.request_timeout_seconds        | int    | 0      | the mcp_client per-call timeout       | 30                        |
      | xstockstrat-analysis   | analysis.strategy.max_concurrent_entry_backfill  | int    | 0      | the entry-backfill semaphore          | 4                         |
      | xstockstrat-analysis   | analysis.backtest.portfolio_max_concurrent       | int    | 0      | portfolio-mode max open positions     | 9                         |
      | xstockstrat-analysis   | analysis.series.max_concurrent_components        | int    | 0      | the series component semaphore        | 4                         |
      | xstockstrat-analysis   | analysis.opportunity.max_concurrent_candidates   | int    | 0      | the opportunity candidate semaphore   | 4                         |
      | xstockstrat-analysis   | analysis.compute.max_worker_threads              | int    | 0      | the compute thread pool size          | 4                         |
      | xstockstrat-analysis   | analysis.readiness_materializer.max_concurrent_bars_fetches | int | 0 | the materializer bars semaphore | 2                         |
      | xstockstrat-analysis   | analysis.screener.max_concurrent_formula_evals   | int    | 0      | the screener formula semaphore        | 4                         |
      | xstockstrat-analysis   | analysis.fundsignal.source_slug                  | string | ""     | the fundamentals source slug          | "fundamentals"            |
      | xstockstrat-analysis   | analysis.fundsignal.max_symbols_per_run          | int    | 0      | the fundsignal per-run symbol cap     | 200                       |
      | xstockstrat-analysis   | analysis.fundsignal.valid_days                   | int    | 0      | the fundsignal signal validity days   | 90                        |
      | xstockstrat-analysis   | analysis.snapshot.signal_timeout_ms              | int    | 0      | the snapshot signal timeout in ms     | 500                       |
      | xstockstrat-analysis   | analysis.patterns.indicator_bucket_count         | int    | 0      | the P&L-pattern indicator buckets     | 5                         |
      | xstockstrat-analysis   | analysis.opportunity.max_live_strategies_per_symbol | int | 0      | the per-symbol live attribution cap   | 5                         |
      | xstockstrat-analysis   | analysis.opportunity.max_live_only_symbols_per_compute | int | 0   | the live-only symbol cap per compute  | 20                        |
      | xstockstrat-analysis   | analysis.opportunity.max_live_held_symbols_per_compute | int | 0   | the held-symbol live cap per compute  | 20                        |
      | xstockstrat-analysis   | analysis.opportunity.valid_window_hours          | int    | 0      | the opportunity validity window hours | 24                        |
      | xstockstrat-analysis   | analysis.opportunity.snooze_default_hours        | int    | 0      | the default snooze hours              | 24                        |
      | xstockstrat-analysis   | analysis.opportunity.read_db_budget_ms           | int    | 0      | the ListOpportunities DB read budget  | 20000                     |
      | xstockstrat-analysis   | analysis.opportunity.live_enrich_timeout_ms      | int    | 0      | the live-enrich timeout in ms         | 3000                      |

--- /home/user/xstockstrat/services/xstockstrat-analysis/acceptance/fix-python-config-stored-zero.feature (CREATE) ---
# Promoted from docs/roadmap/features/244-fix-python-config-stored-zero/acceptance.feature at integration
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-244` tag.
# Durable business rules xstockstrat-analysis guarantees for stored-zero config values.

Feature: xstockstrat-analysis - a stored zero is a value, not "unset"
  What xstockstrat-analysis guarantees when an operator stores 0 / 0.0 / "" for a config key.

  @AC-2 @FR-4 @regression @feature-244
  Scenario: A zero-cost backtest is configurable
    Given "analysis.backtest.default_commission_pct" is stored as 0.0
    And "analysis.backtest.default_slippage_pct" is stored as 0.0
    And the snapshot has no "analysis.backtest.default_fill_model" entry, so fills use the same bar's close
    And a RunBacktest whose single trade enters on a bar closing at 100.00 and exits on a bar closing at 110.00
    When RunBacktest runs
    Then the trade's entry_price is 100.00 and its exit_price is 110.00
    And the trade's pnl equals qty * 10.00, with no commission deducted

  @AC-3 @FR-4 @regression @feature-244
  Scenario: A zero signal-rank weight orders the default queue by conviction alone
    Given "analysis.opportunity.signal_rank_weight" is stored as 0.0
    And one user's live opportunities are "AAA" with conviction 0.90 and signal_axis 0.00, and "BBB" with conviction 0.50 and signal_axis 1.00
    When ListOpportunities returns the queue with the default sort
    Then "AAA" is ranked before "BBB"

  @AC-7 @FR-5 @regression @feature-244
  Scenario Outline: A stored zero whose coded default is also zero keeps its effective value
    Given "<key>" holds the <type> value <stored> (<origin>)
    When xstockstrat-analysis reads it for <site>
    Then the effective value is <effective>

    Examples:
      | key                                              | type   | stored | origin              | site                           | effective |
      | analysis.opportunity.refresh_hour_utc            | int    | 0      | seeded by 028:51,54 | the opportunity refresh hour   | 0         |
      | analysis.readiness_materializer.refresh_hour_utc | int    | 0      | seeded by 027:37,40 | the readiness re-warm hour     | 0         |
      | analysis.fundsignal.min_conviction_to_emit       | float  | 0.0    | operator-set        | the fundsignal emit floor      | 0.0       |
      | analysis.fundsignal.scoring_formula_id           | string | ""     | operator-set        | the fundsignal scoring formula | ""        |
      | analysis.fundsignal.explicit_symbols             | string | ""     | operator-set        | the explicit symbol universe   | ""        |

  @AC-9 @FR-4 @regression @feature-244
  Scenario: A zero alert throttle lets a repeat live transition alert
    Given "analysis.engine.alert_throttle_seconds" is stored as 0
    And the live loop emitted an alert for user "u1", strategy "S1" on "AAPL" 10 seconds ago
    When the next live-loop evaluation of that pair yields an ungated exit transition
    Then a second alert is emitted for user "u1", strategy "S1" on "AAPL"

  @AC-12 @FR-1 @regression @feature-244
  Scenario Outline: A key whose zero means "no limit" honours a stored zero
    Given "<key>" is stored as the int value 0
    When xstockstrat-analysis resolves it for <site>
    Then the effective value is 0, so <effect>

    Examples:
      | key                                  | site                         | effect                                  |
      | analysis.screener.default_rank_limit | the ScreenSymbols rank cap   | the result list is not truncated        |
      | analysis.patterns.min_sample_count   | the P&L-pattern sample floor | no bucket is dropped for a small sample |

--- /home/user/xstockstrat/services/xstockstrat-ingest/acceptance/fix-python-config-stored-zero.feature (CREATE) ---
# Promoted from docs/roadmap/features/244-fix-python-config-stored-zero/acceptance.feature at integration
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-244` tag.
# Durable business rule xstockstrat-ingest guarantees for a stored-zero backfill concurrency.

Feature: xstockstrat-ingest - backfill concurrency keeps its zero clamp
  What xstockstrat-ingest guarantees when ingest.backfill.max_concurrent_jobs is stored as 0.

  @AC-5 @FR-3 @regression @feature-244
  Scenario: Ingest's backfill job concurrency keeps its zero clamp
    Given "ingest.backfill.max_concurrent_jobs" is stored as the int value 0
    When the ingest servicer builds its backfill job semaphore
    Then the semaphore admits 3 concurrent jobs

--- /home/user/xstockstrat/services/xstockstrat-config/acceptance/fix-python-config-stored-zero.feature (CREATE) ---
# Promoted from docs/roadmap/features/244-fix-python-config-stored-zero/acceptance.feature at integration
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-244` tag.
# Durable business rules xstockstrat-config guarantees for explicit-zero config values.

Feature: xstockstrat-config - explicit zero values on the write edge and the wire
  What xstockstrat-config guarantees for zero-valued rows: bounds still apply, the WatchConfig wire preserves a zero member, and the corrective migration is description-only.

  @AC-8 @FR-6 @regression @feature-244
  Scenario: SetConfig still rejects 0 for a minValue-1 key read by a Python service
    Given an ADMIN caller
    And "analysis.opportunity.max_concurrent_bars_fetches" exists as an int config row (seeded by 028:87,90)
    When SetConfig writes "analysis.opportunity.max_concurrent_bars_fetches" = 0
    Then it fails with INVALID_ARGUMENT naming the bounds [1, 5]

  @AC-10 @FR-1 @regression @feature-244
  Scenario Outline: An explicit zero survives the WatchConfig wire
    Given config rows hold "<key>" as the <type> value <stored>
    When a WatchConfig <update> payload is serialized and deserialized through ConfigServiceService
    Then the decoded ConfigValue for "<key>" holds its <type> member set to <stored>

    Examples:
      | key                       | type   | stored | update   |
      | analysis.test.zero_int    | int    | 0      | SNAPSHOT |
      | analysis.test.zero_float  | float  | 0.0    | SNAPSHOT |
      | analysis.test.zero_string | string | ""     | SNAPSHOT |
      | analysis.test.zero_int    | int    | 0      | DELTA    |

  @AC-11 @FR-6 @regression @feature-244
  Scenario: The corrective description migration changes descriptions only and reverses cleanly
    Given the 027 and 028 seeded rows whose descriptions name the zero-trap
    When the description-only migration is applied
    Then only the description column of those rows changes, matched on their exact old text
    And no value_data, value_type or key changes and no row is inserted or deleted
    And the down migration restores each old description text exactly

### Notes / ambiguities / conflicts
- Routing: AC-1, AC-4 and AC-6 are placed in platform.feature because the getter contract spans analysis, indicators and ingest, and no single service owns it. The platform.feature @AC-1 and @AC-4 tags are disambiguated by @feature-244, as with the existing @feature-127 and @feature-147 entries.
- AC-11 is attributed to config, because the 027 and 028 seed rows are config rows. AC-11 is a one-time migration property. A human may later judge it unfit as a durable rule, but promotion is verbatim.
- OVERLAP (no write skipped): the 173 suites services/xstockstrat-ingest/acceptance/fix-python-config-zero-trap.feature and services/xstockstrat-indicators/acceptance/fix-python-config-zero-trap.feature use get_int_present or get_str_present for max_retry_attempts, dedup_window_hours and allowed_imports. They assert different keys and outcomes, so the verdict is NEW. A human could consolidate with the new platform AC-1.
- Consistent with, not contradicting: services/xstockstrat-config/acceptance/opportunity-config-operability.feature @AC-8 (feature 184) accepts refresh_hour_utc=0 and signal_rank_weight=0. services/xstockstrat-config/acceptance/readiness-materializer-config-keys.feature and the same file's @AC-4 keep the [1,5] bound on max_concurrent_bars_fetches, which matches 244 AC-8. 244 AC-8 adds the specific 0 rejection, so it is NEW rather than an overlap.
- The ingest CLAUDE.md note that poll_interval_seconds and request_timeout_seconds are "clamped to >=1" is consistent with AC-6 only if a stored 0 resolves to the default (300 and 30). No promoted scenario asserts the old clamp, so there is no conflict.
- The acceptance.feature was read from the local working tree. The caller said origin/feature/..., which I did not diff against.

### Coverage check
- Source scenarios: 12 (AC-1 to AC-12). Planned (NEW+DUP+OVERLAP): 12 (12 NEW, 0 DUP, 0 OVERLAP, 0 CONFLICT). None were skipped.
- Target counts: platform 3, analysis 5, ingest 1, config 3 = 12.
- Target-suite dedup was done only by grepping on config keys and rule themes. The list of services/*/acceptance files was truncated at 100 entries, so a few later-sorted suites may be unchecked. The analysis, ingest and config targets are new files, and the 173 and 184 suites were checked.
```

## Session 2026-10-28 — sdd-execute ALL-DONE PATH (C-16 promotion applied, integration PR)

- Operator confirmed the `sdd-batch-promotion-plan` above by standing authorization (operator chat 2026-10-28,
  session_01NpS3HShZK6pSnogA7CFo2f: 'Start executing features 241-276'; C-16 promotion auto-confirmed). Applied verbatim:
  AC-1/AC-4/AC-6 appended to `docs/sdd/business-rules/platform.feature`; AC-2/3/7/9/12 → new
  `services/xstockstrat-analysis/acceptance/fix-python-config-stored-zero.feature`; AC-5 → new ingest suite;
  AC-8/10/11 → new config suite. 12/12 scenarios promoted, none skipped.
- status.md stays `in-progress`: Step 18 (rollout audit + consumer-surface smokes, C-14) is operator-deferred.
  Integration PR opened against main-dev with an "Operator gates before merge" section; merge held.

## Session 2026-10-29 — rollout (dev)

**Pre-deploy audit (Step 18 Instruction 1), run by the operator's session through the staging agent MCP.** The operator has
no SQL access to the cluster (P-03), so the audit used `get_config` (read-only; environment `staging` = the dev
deployment) per namespace, at global scope and for every user from `list_users` (one user, `80880990-…`).
`get_config` returns each row's typed `value`/`value_type`, which carries what the two SQL queries select.

- Zero/empty audit rows, `analysis`/`indicators`/`ingest`, 3 rows per scope (global and the one user):
  `analysis.opportunity.refresh_hour_utc = 0` (int), `analysis.readiness_materializer.refresh_hour_utc = 0` (int),
  `analysis.fundsignal.explicit_symbols = ""` (string). Classification: all 3 honour (`HONOUR_KEYS`), so the stored
  value takes effect (0 = midnight; `""` unused while `universe_source = watchlists`). FR-3 clamped rows: 0.
- Malformed-int audit rows: 0 (every `value_type=int` row holds an integer).
- FR-5 seed audit after 243's heal: `indicators.sandbox.{timeout_ms,memory_bytes,allowed_imports}` are stored
  full-dotted. No FR-3 key is stored as 0/`""`, so no seeded row changes effective value.
- Pre-existing, not a 244 regression: the per-user row `analysis.fundsignal.min_conviction_to_emit = "0.6"` is
  `value_type=string`. analysis subscribes at global scope (float `0.2`), and a string-typed row resolves to the
  default both before (`float_val or default`) and after (`HasField`) this fix.
- Operator decision 2026-10-29 (own words, session question tool): "Record audit, merge, I smoke". The integration PR
  merges, and the four Instruction-2 smokes plus restores run post-deploy through the staging MCP set_config/
  list_opportunities/run_backtest tools and Tempo, recorded in a follow-up `rollout (dev)` entry. UI-only checks
  are verified through the API and traces, not visually. The prod audit is due before the prod promotion.

## Session 2026-10-29 — rollout (dev), post-deploy smoke

**Step 18 Instruction 2 and 3, run by the operator's session after deploy-dev (main-dev `9b20cb66`) went green.**
The smoke used the staging agent MCP (admin `set_config` at global scope, which is what analysis's `ConfigWatcher`
reads), `list_opportunities`, `run_backtest`, `list_config_keys`, and Tempo. All writes carried an audit `reason`.

| # | Write (global) | Before | Result | Restored to |
|---|---|---|---|---|
| 1 | `analysis.opportunity.signal_rank_weight = 0` | `0.3` (float) | **Pass.** Page 1 (50 rows) went from 15 adjacent-pair violations of the conviction order (sort-0 at w=0 reduces to `MAX(conviction) OVER symbol DESC, symbol ASC, conviction DESC`) to 0. Groups tied at 1.0 now fall back to symbol ASC (AHR, ALL, AXP, BILL…). Pre-fix, the stored 0 read as 0.3. | `0.3` |
| 2 | `analysis.backtest.default_commission_pct = 0`, `default_slippage_pct = 0` (float, `create_key`) | absent (code defaults `0.001` / `0.0005`, `servicer.py:793-794`) | **Pass.** `fundamentals_macd_blend` on MSFT (rolling window, `same_bar_close`) ran as backtest `2d443ce1-…` with 7 trades. All 14 fills equal the bar close, and every trade's `pnl` equals `(exit − entry) × qty` (residual 0), with total return −13.16 %. The contrast run `a134f1f3-…` with the defaults restored fills every entry at exactly 1.0005 × close, charges commission, and returns −14.89 %. | `0.001` / `0.0005` (= code defaults) |
| 3 | `analysis.engine.alert_throttle_seconds = 0` (int, `create_key`) | absent (code default `300`, `live_loop.py:354`) | **Partial.** The key was created as `value_type=int`, and `get_config` read back `0`. A repeat-delivery observation was not possible. Tempo shows one `EmitAlert` span on dev in the last 7 days (agent `emit_alert` tool, none from analysis's live loop), and a repeat on one (strategy, symbol) key inside 300 s needs two live transitions on daily bars. The `0 = no throttle` behaviour is covered by Step 9's unit test. | `300` (= code default) |
| 4 | — (read) `list_config_keys analysis` | — | **Pass.** All four migration-032 descriptions are live (`signal_rank_weight` "0 is honored…", the two `max_concurrent_bars_fetches` and `max_concurrent_candidates` "a stored 0 or negative reads as the default…"), and no row still carries the old zero-trap wording. | — |

- **Restore caveat:** the agent exposes no key deletion, so the three keys created for smokes 2–3 remain as rows
  holding their exact code defaults. Effective behaviour is unchanged from pre-smoke. Deleting them needs SQL (P-03).
- UI-only checks (`/insights` backtest view, `/trader` AlertStream, `/accounts/notifications`, `/config-ui`) were
  verified through the API that backs them, per the operator decision above.
- Outstanding: the prod audit (Instruction 1) before the prod promotion. No prod MCP is available to this session.

## Session 2026-10-30 — Production check waived

- Operator decision 2026-10-30 (own words): "Prod is not running. Staging is enough". The production check owed at `/promote` is **waived**. The staging/dev verification already recorded above is the final rollout verification for this feature.

# Context Log: fix-python-config-zero-trap

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

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

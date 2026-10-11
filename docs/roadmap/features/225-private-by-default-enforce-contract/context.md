# Context: private-by-default-enforce-contract

**Feature**: `docs/roadmap/features/225-private-by-default-enforce-contract/feature.md`
**Product Spec**: `docs/roadmap/features/225-private-by-default-enforce-contract/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/225-private-by-default-enforce-contract/implementation-spec.md`

---

## Session 2026-10-07 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- Created by feature 224 (`private-by-default-templates`) Step 41 as the follow-up that 224's
  `design.md` Open Risks names: "224 enforce + contract". Scope comes from that design.
- NNN 225 = max(existing) + 1. All remote `feature/*` and `claude/*` branches were scanned; the
  highest existing number was 224.
- `merge-order.md` gained a row: 225 waits for 224 to be **launched**. Pre-reserved migration
  numbers: analysis 027, indicators 008, ingest 014.

## Session 2026-10-08 — sdd-review product-spec (run 1: FAIL → spec fixed)

- Run 1 verdict: **FAIL** (no Floor breach). Blockers: FR-4 claimed N-1 triggers in analysis/indicators
  (only ingest 013 has one — `newsletter_signals_n1_owner_fill` + `ingest.n1_owner_fill_signals()`) and
  never named the superseded tables; 5 unchecked Open Questions. Overlap: CLEAN (027/014 next-free;
  textual-only overlap with 196 in ingest `servicer.py` and with 215 in analysis `servicer.py`).
- **Operator decisions (AskUserQuestion, 2026-10-08):**
  - FR-1 headerless status: **`UNAUTHENTICATED`** uniformly (changes analysis `PERMISSION_DENIED` /
    indicators `INVALID_ARGUMENT` / ingest slug-holder fallback for the headerless case).
  - indicators: first chose "drop `is_public` in 008"; then, shown that migrations run PRE_DEPLOY while
    release-N binaries (which still write `is_public`) serve, chose **"stop writes now, drop later"** —
    no indicators migration in 225, `008` released (merge-order.md updated).
- 224 is now `launched` (promotion #1233 merged to `main`) — precondition met.
- `backtest_runs.user_id`: 224's 026 backfilled NULLs (D-1), but release N still tolerates headerless
  inserts, so 027 re-applies D-1 before `SET NOT NULL` (FR-3, needs `SEED_USER_ID`).
- Spec fixes: FR-1/3/4/5/6 rewritten; Database Changes per service; all Open Questions closed or deferred to a
  named phase; acceptance: AC-1 split per service (AC-8/AC-9), AC-2 now headered (isolates FR-2), AC-10
  non-owner, AC-3 backfill, AC-4 names every object, AC-11 is_public writes stopped, AC-12 replay-safe,
  concrete filenames in AC-5/6, AC-7 observable.

## Session 2026-10-08 — sdd-review product-spec (run 2)

- Product spec approved. Status: draft → spec-ready. Verdict: PASS WITH WARNINGS (no blockers, no Floor breach).
- Warnings fixed in place: Affected Services rewritten to match FR-4/FR-6; FR-5 states `migration-rerun.sh`
  replay-list + trigger-count changes (224/225 files only — pre-224 files out of scope); AC-12 rephrased; AC-7
  concrete UUID; AC-11 covers seed upsert + template instantiate; AC-13 ingest down-file refusal; FR-1 wording
  (analysis list RPCs return empty today, mutating RPCs PERMISSION_DENIED).
- Carried to /sdd-design (reviewer NOTEs): (1) a headerless release-N `RunBacktest` history insert fails after
  027 runs PRE_DEPLOY (best-effort insert — history row lost only); (2) FR-1 treatment of an ungranted inbound
  `x-user-id: system` in analysis (`servicer.py:576` maps it to ""); (3) every in-process caller (live loop, pnl
  consumer, fundsignal producer) must be shown to send `x-user-id` or a SAN-bound grant.
- Overlap findings: none (CLEAN).

## Session 2026-10-09 — sdd-design Phase 0 + round 1 + operator gate

- Phase 0 Recon: recon.md written (b82c100e). No promoted rule guarantees any removed allowance → no C-16 CHANGE.
- Round-1 proposal: per-service identity helper first in every owner-scoped RPC (analysis 21 / indicators 10 / ingest 7;
  exempt lists), analysis inbound `system` → PERMISSION_DENIED, bypass + body-user_id fallback + slug-holder fallback
  removed, P&L consumer skips signals() when ownerless, 027 (D-1 + NOT NULL + drop strategy_scores, LOCK), 014 drops,
  migration-rerun goto 26 + post-224 fixture, is_public removed from all write paths, descriptor-walk completeness test.
- **Round-1 adversary: NEEDS WORK, no Floor breach.** (1) raising downs + golang-migrate dirty-before-down → wedged
  dirty-recovery; `psql -f` exit check vacuous without ON_ERROR_STOP → harden test + DBA `migrate force` note;
  (2) fail-open empty-owner defaults remain (`evaluator.for_owner("")`, pnl `()`, tick `uid==""`) and runtime header
  guard misses 5 paths; (3) QueryPnLPatterns cross-user read; (4) 027 must also backfill child rows (026:32-42);
  (5) take ACCESS EXCLUSIVE once + lock_timeout; (6) test churn across all 3 services incl. `IS_PUBLIC` import →
  classification rule; (7) single identity helper per service + orphan removal; (8) AC-11 needs a real-schema proof;
  (9) completeness test: system-without-grant case + EXEMPT equality; (10) extra doc drift sites.
- **Operator decisions (AskUserQuestion 2026-10-09):** QueryPnLPatterns → **fix in 225** (owner-scoped,
  headerless UNAUTHENTICATED, filter via pnl_positions.user_id, no migration; new FR + AC); AC-11 → **real-schema
  check** in migration-rerun (rolled-back txn drops the column, executes the exact repository SQL); **run round 2**.

## Session 2026-10-10 — sdd-design round 2 + operator gate

- Round-2 proposal (decorator gate per owner-scoped RPC, single identity helper per service, fail-closed
  `owner_metadata`, QueryPnLPatterns owner-scoped via pnl_positions semijoin (FR-7), AC-11 real-schema harness via
  awk-extracted SQL in migration-rerun, 027 ACCESS EXCLUSIVE + 2s×20 retry, child backfill, refusal driven via
  `migrate goto` + `force`, completeness test both directions + system-without-grant, test-churn rule, doc list).
- **Round-2 adversary: SOUND, no Floor breach.** Open: (1) failed 027/014 → dirty → next deploy `force 0` replays
  non-idempotent pre-224 files (wedge) — operator decision needed; (2) `@AC-3 @feature-042` QueryPnLPatterns is EXTEND
  (Given gains caller ownership) — reclassify; (3) reset `lock_timeout` after the LOCK; (4) route every background
  owner-metadata site through `owner_metadata` (6 hand-built sites) in a small identity module. Spec notes: decorator
  must `return` after abort; ingest rpc name pinning; QueryPnLPatterns `AND symbol=$1` in subquery; parentless NULL-owner
  child rows window; AC-11 param-count check; SetOpportunityAction INVALID_ARGUMENT→UNAUTHENTICATED (no AC);
  RunFundamentalsScan exemption stated.
- **Operator decisions (AskUserQuestion 2026-10-10):** dirty wedge → **add `db-migrate.sh` guard** (refuse `force 0`
  at/above a contract version; print recovery text) in 225; **run round 3**.

## Session 2026-10-10 — sdd-design (completion)

- Phase 0 Recon: recon.md (analysis/indicators/ingest + platform scripts; 39 PRESERVE / 1 EXTEND, no CHANGE).
- Phase 1 Grilling: **3 rounds** (quick, extended by operator). Chosen: per-service decorator identity gate first in
  every owner-scoped RPC; single fail-closed `app/identity.owner_metadata`; bypass + body/slug-holder fallbacks removed;
  QueryPnLPatterns owner-scoped (FR-7); 027 (D-1 + child backfill + NOT NULL + drop strategy_scores, ACCESS EXCLUSIVE with
  bounded lock_timeout reset after LOCK), 014 (drop trigger/function/signal_dedup_keys), raising downs driven via
  `migrate goto`; `db-migrate.sh` contract-floor dirty guard (FR-8) shipped in the migrator image; is_public stop-writing
  with awk-extracted real-schema proof; descriptor-walk completeness tests. Rejected: analysis server interceptor,
  validating outbound stub wrapper, deferring QueryPnLPatterns, per-site preamble.
- Round-3 adversary SOUND; fixes A (Dockerfile.migrate COPY + no-mount smoke) and B (sweep meta inside try) folded.
- C-16: `@AC-3 @feature-042` (QueryPnLPatterns) is EXTEND — Given gains caller ownership at promotion.
- Constitution touched: C-01, C-03, C-07, C-08, C-10, C-13, C-15, C-16, C-18, P-03, F-01, F-07 (DDL literals, 026 precedent).
  Floor breaches: none.
- Status: spec-ready → design-approved.

## Session 2026-10-10 — sdd-spec

- Wrote implementation-spec.md with 19 steps, and status moved design-approved → implementation-ready. All 19 `@AC-*` are covered (C-15). Consumer surface is None (C-14, a recorded decision). Steps in order:
  - 1–2: the `db-migrate.sh` contract-floor dirty guard (`scripts/migration-dirty-guard.sh`) plus its test;
  - 3–4: analysis `027` and ingest `014` contracts;
  - 5: `migration-rerun.sh` replay, refused downs and guard end to end;
  - 6–7: analysis `app/identity.owner_metadata`;
  - 8–9: analysis `owner_scoped` gate on 22 RPCs;
  - 10–11: QueryPnLPatterns owner filter;
  - 12–13: indicators gate and bypass removal;
  - 14–15: indicators stops writing `is_public`;
  - 16: AC-11 real-schema harness;
  - 17–18: ingest gate;
  - 19: docs, C-16 promotion/EXTENDs, teardown.
- Key codebase findings:
  - **Migration numbers:** last analysis is `026_owner_dimension_templates`, last ingest is `013_signal_ownership_templates`. `027` and `014` are free on all 54 `origin/*` refs (re-verified, as the product spec deferred to this phase).
  - **Branch freshness:** `origin/main-dev` is 1 commit ahead (`80d44449`, feature 196). It edits ingest `servicer.py:252-256`, so ingest servicer lines past `:255` shift by −1 there. Merge main-dev before Step 17.
  - **RPC counts** from the descriptor and `async def` scan: analysis 23 (22 decorated + RunFundamentalsScan), indicators 13 (10 + 3 exempt), ingest 12 (7 + 5 exempt). These match design §1.
  - The indicators `upsert` and `update` SQL are inline today (`formulas_repository.py:144-158`, `:226-234`). Step 14 hoists them to `_UPSERT_SQL` and `_UPDATE_SQL` so the Step 16 awk harness and the Step 15 routing test can reach them.
  - `scripts/migration-assertions/ingest-013.sql` ends in an N-1 trigger probe that cannot pass after `014`. Step 5 removes it, in the same push as Step 4 (see Step Dependencies).
- **Spec-time correction to design.md §2 rows #4–#6 (P-03):**
  - What the design says: the live-loop drains (`_drain_owner_signals`, `_drain_held`, `_drain_watchlist`) sit "under the per-pair try (`live_loop.py:438-445`)".
  - What the code shows: that `try` wraps only `_eval_pair`. The drains run from the record-building loop (`live_loop.py:371-381`), which has no `try`. Only the cycle-level `except` (`:325-328`) would catch a raise there, so one ownerless strategy would abort every owner's cycle.
  - Fix: Step 6 builds `owner_metadata` before each drain's inner `try` and adds a per-row `except ValueError` (log and skip) around the drain block. This realises design Open Risk 4 ("that unit is skipped") rather than changing it. No operator decision was needed, but `/sdd-review impl-spec` should confirm it.
- **AC-17 / `_compose`:** this follows the round-3 `/sdd-spec` note (keep OHLCV, skip indicators and ingest) rather than design §2 row #8's `return None, [], {}, [], True`.
- **Characterization ACs:** AC-5 (Step 2, the existing 224 contract gate), AC-7 (Step 18, FR-6 regression guard) and AC-10 (Step 13) need no production change, so they are green on their first run by design. `/sdd-execute` should record them as such and not treat them as a TDD-gate failure.

## Session 2026-10-11 — sdd-review impl-spec (advisory)

- Result: **PASS WITH WARNINGS**, 0 blockers, no Floor breach. C-15 19/19, C-08 paired, C-07 027/014 next-free.
  Flagged correction CONFIRMED: live-loop drains (`live_loop.py:370-382`) are outside the per-pair try; Step 6's
  per-row `except ValueError: continue` is the right fix (design.md §2 boundary claim was wrong for those sites).
- Warnings — resolution (fixed before execution, step bodies not yet frozen):
  - [x] Step 6 verification grep matched 3-tuples / `k in (...)` filters → narrowed to 2-tuples.
  - [x] Steps 9/11: `test_query_pnl_patterns.py` None-context churn moved into Step 9 (else Step 9's full suite fails after Step 8); Step 11 args assertion is a tuple.
  - [x] Step 17 instruction 5 now also covers `servicer.py:1337` and `:1367-1368` (verification grep).
  - [x] Steps 2/5/16: "Coverage: N/A (scripts/)"; Step 2 cases (a)–(i).
  - [x] **Accepted trade-off:** Steps 9 and 13 keep a `tests/*.py` Files entry — the churned suites are only knowable from
    the red run; each touched file is listed in the step commit and the Deviation Log (F-08 audited per commit).
- Notes carried to execution: Step 6 states `owner_metadata` placement relative to `_drain_*` `_portfolio is None` guards;
  NULL `pnl_pattern_samples.position_id` legacy rows are excluded for every caller (doc line in Step 19); Step 12
  instruction 2 wording; Step 19 teardown fixes outside its 10 files go to the Deviation Log.

## Session 2026-10-11 — sdd-execute (sequential, Steps 1–5)

- Run as an orchestrated sequential execution of Steps 1–5 on `feature/private-by-default-enforce-contract`
  (operator-authorized autonomous run, relayed by the orchestrator); one commit per step, no per-step PR.
- TOOLING: shellcheck, shfmt (`/root/go/bin`), python3+yaml available. No database started (HARD CONSTRAINT):
  migration steps are verified offline and the authoritative `migration-rerun` run is CI's.

### Step 1 — contract-floor dirty guard for `db-migrate.sh` (FR-8) [done]
- Created `scripts/migration-dirty-guard.sh` (exit 0 allow / 1 usage / 2 fail-closed parse or foreign target /
  3 refuse with `force <n-1>` recovery text, `$DATABASE_URL` printed as a literal); `db-migrate.sh` up-path now
  calls it before `force 0` (false "re-running is safe" comment replaced by the 2-line constraint); migrator image
  COPYs it; CI: `migrations` filter (+guard, +indicators `formulas_repository.py`), structural-test append,
  no-mount image smoke step.
- TDD: red — `bash scripts/migration-dirty-guard.test.sh` (Step 2's test, written first) →
  `ASSERT FAIL: scripts/migration-dirty-guard.sh missing or not executable` (exit 1); green → `all assertions passed`.
- Verification: shellcheck + `shfmt -d -i 2` clean; greps hit db-migrate.sh/Dockerfile.migrate/ci.yml; false comment
  gone; ci.yml parses.
- Files modified: `scripts/migration-dirty-guard.sh`, `scripts/db-migrate.sh`, `scripts/Dockerfile.migrate`,
  `.github/workflows/ci.yml`
- Deviations: none (shfmt places the `;;` of the design §6 block on its own line — formatting only).

### Step 2 — dirty-guard structural tests + AC-5 contract-gate case [done]
- Created `scripts/migration-dirty-guard.test.sh` (cases (a)–(i), no DB; AC-18 refusal text/exit 3, AC-19 below-floor
  and no-contract allow); added case (d) to `check-migration-contract.test.sh` with a stderr-capturing `run_check_err`.
- TDD: AC-18/AC-19 red (pre-Step-1) `ASSERT FAIL: scripts/migration-dirty-guard.sh missing or not executable` →
  green `migration-dirty-guard.test.sh: all assertions passed`. AC-5 case (d) is a characterization of the existing
  224 gate — green on first run by design; proven to execute by a mutant (expected filename swapped → `ASSERT FAIL: (d)`).
- Verification: shellcheck + shfmt clean; both suites pass. Coverage: N/A (`scripts/`).
- Files modified: `scripts/migration-dirty-guard.test.sh`, `scripts/check-migration-contract.test.sh`
- Deviations: none.

### Step 3 — analysis `027_contract_owner_dimension` [done]
- Created the 027 up (contract-of 026 on line 1, requires-env SEED_USER_ID, seed guard, ACCESS EXCLUSIVE lock with
  2s×20 bounded retry and `lock_timeout` restore, D-1 + seed backfill, child-row backfills, `SET NOT NULL`, drop
  `analysis.strategy_scores`) and the unconditionally-raising down.
- TDD: N/A (migration — proven by Step 5's CI rerun).
- Verification: offline (ls, header greps, SET NOT NULL / DROP / lock_timeout greps, down "irreversible contract");
  027 free on all `origin/*` refs; 026 is on `origin/main` (contract gate precondition).
- Files modified: `services/xstockstrat-analysis/migrations/027_contract_owner_dimension.{up,down}.sql`
- Deviations: offline migration check substituted for the live apply (Deviation Log).

### Step 4 — ingest `014_contract_signal_ownership` [done]
- Created the 014 up (contract-of 013 on line 1; drops trigger `newsletter_signals_n1_owner_fill`, function
  `ingest.n1_owner_fill_signals()`, table `ingest.signal_dedup_keys`, all `IF EXISTS`) and the raising down.
- TDD: N/A (migration — proven by Step 5's CI rerun). App has no reference to either object (grep → none).
- Verification: offline (ls, line-1 header, `grep -c "IF EXISTS"` = 3, down "irreversible contract").
- Files modified: `services/xstockstrat-ingest/migrations/014_contract_signal_ownership.{up,down}.sql`
- Deviations: offline migration check substituted for the live apply (Deviation Log). The CI `migration-rerun` job
  is red on this commit alone until Step 5 removes the `ingest-013.sql` N-1 probe (expected — no PR opened yet).

### Step 5 — `migration-rerun.sh` contract replay, refused downs, dirty-guard e2e + assertions [done]
- `migration-rerun.sh`: pass 0b (analysis `goto 26` from the captured render + `fixtures-post-224.sql`); replay list
  adds 014/027; trigger count must be 0 before and after replay; new pass 3 (`refuse_down` / `guard_blocks` helpers):
  ingest `goto 13` refused + dirty + AC-13 `signal_dedup_keys` still absent + `db-migrate.sh up` refused with
  `force 12` + still dirty + `force 12`; analysis `goto 26` refused + dirty + AC-6 `user_id` NOT NULL + `up` refused with
  `force 25` + still dirty + `force 25`; final `db-migrate.sh up` clean at ingest 14 / analysis 27; assertion loop runs
  after. New `fixtures-post-224.sql`, `analysis-027.sql` (AC-3 backfill incl. children, AC-4 drop + NOT NULL insert
  probe), `ingest-014.sql` (AC-4 trigger/function/table absent); N-1 probe removed from `ingest-013.sql`.
- TDD: red/green need a database — not run locally (HARD CONSTRAINT). Offline: shellcheck/shfmt/`bash -n` clean;
  libpg_query parses all new/edited SQL; guard refusal/allow matrix checked against the real dirs. Authoritative
  red→green is CI `migration-rerun` on the integration PR (Deviation Log).
- Files modified: `scripts/migration-rerun.sh`, `scripts/migration-assertions/{fixtures-post-224,analysis-027,ingest-014}.sql`
  (new), `scripts/migration-assertions/ingest-013.sql`
- Deviations: offline substitution for the DB-backed red/green and CI run (Deviation Log).

## Session 2026-10-11 — sdd-execute (Steps 1–5)
**Steps this session**: 1, 2, 3, 4, 5
**Progress**: 5 done / 19 total
**Stopped at**: Step 5 (scope of this run)
**Next**: /sdd-execute private-by-default-enforce-contract sequential (Step 6) — and watch CI `migration-rerun` on the
integration PR: it is the first live proof of Steps 3–5.

## Operator authorization record (orchestrator, 2026-10-11)

- 2026-10-08 AskUserQuestion answers (verbatim): execution mode **"Fully autonomous"** — "Treat this message as the
  confirmation for everything; only stop on genuine blockers"; 225 sequencing **"Build now, hold PR"** — run
  review → design → spec → execute on this branch, do NOT open the integration PR into main-dev until the operator
  confirms 224 is launched and stable. (224 reached `main` via promotion #1233 on 2026-10-08.)

## Session 2026-10-11 — sdd-execute (sequential, Steps 6–11)

- Orchestrated sequential run (operator authorization record above). Python env: `uv sync --extra dev`; baseline
  full suite 964 passed, ruff clean.

### Step 6 — analysis `app/identity.py` — one fail-closed owner-metadata builder [done]
- New `app/identity.py` (`SYSTEM_IDENTITY`, `owner_metadata` raising `ValueError` on `""`/`system`); servicer re-exports
  `SYSTEM_IDENTITY` via import; fundsignal_loop/live_loop import it from `app.identity`. All 8 owner sites routed:
  sweep meta built inside the per-intent `try` (advance still runs), opportunity tick meta inside the per-user `try`
  (stale 2-line comment removed), materializer, the three live-loop drains (`_drain_held`/`_drain_watchlist` build
  `meta` after the `_portfolio is None` guard and before the pagination loop — outside its `try`), a per-row
  `except ValueError: continue` around the `_run_cycle` drain block, `for_owner`, and `_compose` (ownerless: OHLCV kept,
  indicators/signals skipped, degraded).
- TDD (paired with Step 7): red on the pre-Step-6 tree — 13 failed / 14 passed in `test_identity.py` +
  `test_owner_header_guard.py` (`No module named 'app.identity'`; AST check listed the 8 hand-built tuples;
  `QuerySignals sent x-user-id ['']`; sweep `'FINALIZED' == 'COMMITTED'`; materializer owners `['', 'bob']`) →
  green 27 passed; full suite 977 passed, coverage 85.93%.
- Verification: 2-tuple grep → no output; `owner_metadata` present in all four files; ruff check + format clean.
- Files modified: `app/identity.py` (new), `app/handlers/servicer.py`, `app/engine/live_loop.py`,
  `app/engine/fundsignal_loop.py`, `app/engine/pnl_pattern_consumer.py`, `app/services/evaluator.py`
- Deviations: none. (`_compose` builds `meta = owner_metadata(owner) if owner else ()` once and returns early when
  ownerless — same behaviour as the instructions.)

### Step 7 — `owner_metadata`, single-builder static check, background-path containment, AC-17 [done]
- `tests/test_identity.py` (raise/return, AST single-builder check allowing only `app/identity.py` and
  `SYSTEM_IDENTITY`, no `app` imports in `app.identity`); `tests/test_owner_header_guard.py` adds the opportunity tick
  (`["bob",""]` + advance), template sweep (anon intent left `COMMITTED`, bob `FINALIZED`, advance
  `_INTENT_SWEEP_SECONDS`), materializer (`""` raises; tick still warms bob), the three drains (`ValueError`, zero stub
  calls), `_run_cycle` skipping the ownerless row, `for_owner("")`, and
  `test_ac17_ownerless_order_event_issues_no_owner_scoped_call`.
- AC-17 red: the ownerless order event called ingest `QuerySignals` with `x-user-id ''` → green: zero ingest/indicators
  calls, snapshot inserted, `analysis.snapshot.degraded` emitted. Red/green counts recorded under Step 6 (13 failed →
  27 passed; full suite 977 passed, 85.93%).
- Fixture reuse (C-13): `_row`, `ORDER_PAYLOAD`, `make_event`/`make_consumer`, `_materializer_svc`/`_live_row`/
  `_due_schedule`, and the template `FakeIntents`/`_intent`/`_schedule`/`_svc` are imported from their homes. The
  template helpers are imported inside the one test that uses them, because `test_strategy_templates.py` imports
  `test_owner_header_guard.py` at module load (a top-level import is circular). The sweep test asserts the saga grant
  with the existing `_assert_indicators_headers(..., path="template-saga")`.
- Files modified: `tests/test_identity.py` (new), `tests/test_owner_header_guard.py`
- Deviations: none.

### Step 8 — analysis inbound identity gate (`owner_scoped`) on 22 RPCs [done]
- Module-level `_CallerRejected` + `owner_scoped` decorator (explicit `return None` after a non-raising abort);
  `_caller_user_id` raises UNAUTHENTICATED (no/empty `x-user-id`) or PERMISSION_DENIED (`system`), docstring cut to a
  2-line constraint. 22 RPCs decorated, `RunFundamentalsScan` exempt. Raw `x-user-id` readers (ScreenSymbols,
  ListOpportunities, SetOpportunityAction — `INVALID_ARGUMENT "missing user identity"` branch deleted,
  GetStrategyAnalytics) route through `_caller_user_id`. Orphan headerless branches deleted (RunBacktest ref lookup,
  the three `user_id=caller_user_id or None`, ScoreStrategy, GetStrategyReport, ListBacktests, ManageStrategy,
  GetStrategy, SetStrategyLive, ListTemplates, ManageTemplate `not caller_user_id or`, InstantiateTemplate,
  EvaluateReadiness, GetWatchlistReadiness, GetAttribution `not caller or`, GetIndicatorSeries, GetStrategyAnalytics).
  GetBacktest's `if not owner or owner != caller_user_id` kept. `backtest_runs.py` comment reworded, `user_id: str`
  (keyword-only, no default). `_row_to_score` docstring names `strategy_scores_v2`.
- TDD (paired with Step 9): red — `test_owner_scoped_completeness.py` written first: 43 failed / 5 passed on the
  pre-Step-8 tree (descriptor walk found no `__owner_scoped__`; bodies entered → `AttributeError`; headerless
  ListStrategies/SetOpportunityAction got PERMISSION_DENIED/INVALID_ARGUMENT; the 5 passes were `system` cases that
  already hit an early PERMISSION_DENIED) → green 48 passed after Step 8.
- Verification: AST check `22 decorated, exempt: {'RunFundamentalsScan'}`; `invocation_metadata()).get("x-user-id"`
  only inside `_caller_user_id`; ruff check + format clean.
- Files modified: `app/handlers/servicer.py`, `app/repositories/backtest_runs.py`
- Deviations: none.

### Step 9 — analysis gate completeness + AC-8, AC-16, SetOpportunityAction, test churn [done]
- `tests/conftest.py` gains `OWNER_HEADERS`/`OTHER_HEADERS`. New `tests/test_owner_scoped_completeness.py`: descriptor
  walk `{undecorated} == EXEMPT`; per-method headerless → UNAUTHENTICATED and `system` → PERMISSION_DENIED with a
  non-raising abort awaited once, on a bare `AnalysisServicer.__new__` instance (any attribute a body touches raises,
  so "body not entered" is enforced); `test_ac8_headerless_list_strategies_unauthenticated`,
  `test_ac16_ungranted_system_permission_denied`, SetOpportunityAction headerless → UNAUTHENTICATED.
- AC-8 red: headerless ListStrategies got PERMISSION_DENIED/empty → green UNAUTHENTICATED. AC-16 red: `system` owned
  nothing (no abort) → green PERMISSION_DENIED. Completeness 43 failed → 48 passed.
- Churn RED (full suite on the Step 8 tree, before any test fix): **19 failed, 1006 passed** — test_analysis_servicer 12,
  test_backtest_runs_repo 4, test_get_attribution 1, test_query_pnl_patterns 2. Classified and fixed (Deviation Log);
  no test deleted; renamed under rule (i): `test_set_opportunity_action_missing_user_invalid` →
  `..._missing_user_unauthenticated`, `test_inbound_system_identity_owns_nothing` →
  `test_inbound_system_identity_permission_denied`.
- GREEN: full suite 1025 passed, coverage 86.13%; ruff clean; `OWNER_HEADERS` consumers import from conftest.
- Files modified: `tests/conftest.py`, `tests/test_owner_scoped_completeness.py` (new), `tests/test_analysis_servicer.py`,
  `tests/test_query_pnl_patterns.py`, `tests/test_get_attribution.py`, `tests/test_backtest_runs_repo.py`
- Deviations: churned-file list + the `test_backtest_runs_repo.py` signature churn (Deviation Log).

### Step 10 — QueryPnLPatterns owner filter (FR-7) [done]
- `PnLPatternSamplesRepository.query` takes required keyword-only `user_id` and appends the owner semijoin
  `position_id IN (SELECT position_id FROM analysis.pnl_positions WHERE user_id = $N AND symbol = $1)` after the
  optional filters (`$N` = `len(args)`). `QueryPnLPatterns` passes `user_id=self._caller_user_id(context)`; docstring
  now "Owner-scoped DB-only read (FR-7)".
- TDD (paired with Step 11): red — 4 failed / 4 passed in `test_query_pnl_patterns.py` (`query() got an unexpected
  keyword argument 'user_id'`; the servicer did not pass `user_id`) → green 8 passed; full suite 1029 passed, 86.39%.
- Verification: both greps hit; ruff clean.
- Files modified: `app/repositories/pnl_pattern_samples.py`, `app/handlers/servicer.py`
- Deviations: none.

### Step 11 — QueryPnLPatterns AC-14, AC-15 [done]
- `_FakeSamplesRepo` stores `(owner, row)` pairs, filters on `user_id`, records each call's owner. New: repository
  recording-DB tests (`$2` predicate, `args == ("AAPL", "u-1")`; with strategy + both timestamps → `$5`, `args` end in
  `"u-1"`), `test_ac14_query_pnl_patterns_returns_only_callers_samples` (u-1 `sig:uw` ×5 vs u-2 `sig:uw` ×6 +
  `sig:newsletter-b` ×5 → only `("sig:uw", 5)`), `test_ac15_headerless_query_pnl_patterns_unauthenticated`.
- AC-14 red: `PnLPatternSamplesRepository.query() got an unexpected keyword argument 'user_id'` / the fake was called
  without `user_id` → green. AC-15 is green on its first run: Step 8's gate already rejects headerless calls before
  the body, so it is a characterization test here (the repo is asserted never called).
- Verification: file 8 passed; full suite 1029 passed, 86.39%; ruff clean; `from tests.conftest` present.
- Files modified: `tests/test_query_pnl_patterns.py`
- Deviations: none.

## Session 2026-10-11 — sdd-execute (Steps 6–11)
**Steps this session**: 6, 7, 8, 9, 10, 11
**Progress**: 11 done / 19 total
**Stopped at**: Step 11 (scope of this run)
**Next**: /sdd-execute private-by-default-enforce-contract sequential (Step 12 — indicators gate)

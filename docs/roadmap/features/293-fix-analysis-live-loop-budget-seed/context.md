# Context Log: fix-analysis-live-loop-budget-seed

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-04 (/sdd-triage)

- Bug reported via defect report `docs/reports/2026-11-04-analysis-live-loop-chronic-budget-overflow-defect.md` (Issues disabled)
- Severity: SEV-3; routed to Track B (config-only) first. The operator asked for BOTH the config write and the durable fix.
- Track B applied on staging: `set_config analysis.engine.max_strategies_per_cycle = 200 (int, create_key=true)`; propagation verified in Loki (`max_strategies_per_cycle=200`, 200/690 pairs in 23.6s, rotation ~4 cycles). Value 200 was chosen by the assistant (operator gave no number) — revisit.
- This feature is the durable fix: seed migration + steady-state WARN handling.
- Recommended design depth: full -> `/sdd-design fix-analysis-live-loop-budget-seed` (rationale: DB/config-service migration is an escalate signal; analysis + config = 2 services)
- Number 293 reserved via scripts/sdd-allocate-feature-number.sh; 292 was reserved earlier and not used (burned).
- Development branch: feature/fix-analysis-live-loop-budget-seed

---

## Session 2026-11-04 — sdd-review product-spec (verdict FAIL → spec revised)

- First review: FAIL, 5 blockers (no FR-N; migration strategy unstated; AC-1 contradiction — `DO NOTHING` cannot give the runtime-created staging row a description/default because `SetConfig create_key=true` inserts only `namespace, key, value_type, value_data, …` (`configServiceImpl.ts:633-646`); acceptance malformed; no Consumer Surface(s)). Overlap: no duplicate key; migration-number reservation (035 = 291, 037 on 281's branch — verified on `origin/feature/signal-watchlist-expiry-pruning`); same-region edit with 294 in `live_loop.py`.
- Revised product-spec + acceptance: FR-1..FR-6 (seed int 50 for staging+production; metadata backfill that never touches `value_data`; `SetConfig` bounds min 1 / max chosen in design from cycle duration vs the 60 s interval; wiring-baseline entry removal at `scripts/config-wiring.json:84-89`; overflow WARN once per (pair count, budget) state change with the INFO summary and counter unchanged; rollback removes only rows still holding the seeded 50); migration number intentionally NOT hard-coded (next free, higher than every claimed number, re-verified before merge; merge-order row added); approvals named; existing tests that will change identified (`test_live_loop.py:759-780`, `:783-808`); PRESERVE `platform.feature:496`; Consumer Surface(s) stated (config-ui / `list_config_keys` / `set_config` generic, no code change). Decisions made by the assistant, for operator sign-off: the rollback rule (FR-6), bounds minimum 1, and the staging 200 (assistant-chosen) to be confirmed or re-set.
- Status stays `draft` until the revised spec is re-reviewed.

---

## Session 2026-11-04 — sdd-review product-spec (second pass; approved)

- Second pass: PASS WITH WARNINGS (0 blockers). All 7 warnings addressed in this session: (W1) the seed is now `INSERT … ON CONFLICT … DO NOTHING` + a guarded metadata-only `UPDATE … COALESCE(NULLIF(col,''), …)` — verified against `scripts/check-config-wiring.mjs` `applyInsert` (accepts only no-`ON CONFLICT` or `DO NOTHING`; `DO UPDATE` exits 2 "shape not understood"), precedent 244's `032_analysis_zero_trap_descriptions.up.sql`; audit trigger verified value-only (`017_…:69`), no `pg_notify` from migrations; (W2) FR-3 carries a candidate maximum of 400 (≈0.12 s/pair vs the 60 s interval) with AC-6 for the maximum — an ASSISTANT-CHOSEN candidate for `/sdd-design` to confirm; (W3) only `test_live_loop.py:783-808` changes, `:759-780` is PRESERVE; (W4) FR-5 state is (over budget?, budget), not the pair count — drift no longer re-warns; volume target ≤ 1 WARN per episode+budget; state cleared on falling under budget and per live-loop instance; (W5) down migration limited to global rows (`user_id IS NULL`), metadata backfill not reverted, per-user override case in AC-7; (W6) merge-order row added for 293 ↔ 281; (W7) AC-2/AC-4 numbers made explicit, AC-9 removed (duplicate of `platform.feature:496` / `test_config_zero_clamps.py:34`; no test cited it yet) — the rule is PRESERVEd in the product spec.
- Overlap scan (warn-level only): `live_loop.py` region shared with 294; migration numbering vs 291 (035) and 281 (037) → merge-order rows.
- Recommended design depth: full (config-service DB migration + 2 services). Status: draft → spec-ready.
- Decisions made by the assistant for operator sign-off: rollback rule (FR-6), bounds minimum 1 and candidate maximum 400, the state definition for FR-5, and that staging's 200 (assistant-chosen) is confirmed or re-set by the operator.

---

## Session 2026-11-04/05 — loop round 1 (fixes)

- Round-1 review: PASS WITH WARNINGS, 0 blockers; 3 fixable warnings fixed. **Correction to my own earlier statement** (FR-3 rationale): a cycle that outlasts the interval is NOT skipped — `run_forever` awaits each cycle inline after `sleep(interval)` and the `_lock.locked()` skip is dead code (verified, `live_loop.py:336-345`), so the effective period is interval + cycle duration (≈ 84 s at 200 pairs, ≈ 108 s at 400). The candidate maximum 400 stays an assistant-chosen candidate for `/sdd-design`, now framed as a signal-freshness trade-off. AC-2 gains an explicit trigger ("and the next cycle runs") and a zero-live-pairs step (count 4); FR-5 clears the state on a zero-pair cycle (early returns at `:435-441`) and its volume wording is "one WARN per (episode, budget, process lifetime)"; AC-8 names the migration-file argument; the verification route for AC-3/4/7 is recorded as a design/spec decision.

## Session 2026-11-05 — loop round 3 (product-spec)
- Added @AC-9 (operator-written metadata never overwritten; C-15 coverage of the FR-2 sub-clause), value_type-unchanged assertion on AC-3, FR-3 timing flagged as extrapolated lower bounds, docs bullet carries bounds + test cases.

## Session 2026-11-05 — sdd-design round 1 (recon.md written; proposer + adversary run; user gate)
- Recon: recon.md written (same documented tree-stamp deviation as 289). Correction recorded: a real-Postgres harness for config migrations exists (`scripts/migration-rerun.sh` + `scripts/migration-assertions/config-031.sql`), contrary to product-spec § Out of Scope.
- Round-1 adversary verdict: NEEDS WORK, no Floor breach. Findings: the 400 maximum's pool rationale is wrong (pairs are evaluated serially, `live_loop.py:467-479`) and 400 < 690 live pairs, so the overflow state could never be cleared by config; the seeded description embeds drifting facts (ledger 2026-11-04 fix-python-config-stored-zero); sibling `analysis.engine.eval_interval_seconds` has the same read-unseeded defect (`scripts/config-wiring.json:78-83`); migration 038 is a C-07 deviation that serializes a SEV-3 fix behind 281/291; assertion fixtures should exercise per-column COALESCE and audit rows.
- **USER DECISIONS (explicit, AskUserQuestion, 2026-11-05):**
  1. SetConfig maximum = **typo-guard 1000** (`[1,1000]`, matching `analysis.opportunity.max_universe_size`), rationale = cycle duration vs the 30-min heartbeat alert, not the marketdata pool.
  2. **Seed `analysis.engine.eval_interval_seconds` in the same migration** (widens 293's scope; its bounds/default/description and baseline-entry removal are decided in round 2 and the product-spec/acceptance are amended after design approval — operator-approved scope change).
  3. **Split**: the live-loop WARN latch ships as an independent step/PR (no migration dependency); the seed/bounds step merges after 281 and 291.

## Session 2026-11-05 — sdd-design round 2 gate (user decisions)
- Round-2 adversary: NEEDS WORK, no Floor breach (wiring checker, audit triggers, assertion harness, latch verified). Open items: interval bounds were the proposer's choice; down-migration AND/OR precedence fixture hole; embedded-NNN list incomplete / F-09; hard 281 dependency is the wrong remedy; interval description drift clause; no BEGIN/COMMIT in up/down; accepted latch behaviours; `alert_throttle_seconds` omission; `@AC-6 @feature-278` reader/test cite.
- **USER DECISIONS (explicit, AskUserQuestion):** (1) `analysis.engine.eval_interval_seconds` bounds = **[30, 600]** (registry comment names alert uid `xstk-analysis-no-scoring` and the joint condition interval + cycle < 1800 s with the budget key). (2) Ordering = **soft, rebase-only, renumber at merge** (merge-order rows for 293↔281/291 become soft; whichever of 281/291/293 merges next takes last+1 from `origin/main-dev`; later ones renumber and log a Deviation Log entry). (3) Gate: **run another round (round 3)** before approving.

## Session 2026-11-05 — sdd-design round 3 approved (COMPLETION)
- Phase 0 Recon: recon.md (services: analysis, config; key reuse: 028/032/033 seed+metadata-UPDATE patterns, the existing real-Postgres `migration-rerun.sh` harness, `_fund_unavailable`-style in-memory latch).
- Phase 1 Grilling: 3 rounds (full), approved by the user at the round-3 gate. Chosen approach: two PRs — (1) one nullable-int overflow-WARN latch in `LiveEvaluationLoop`; (2) one migration seeding both live-loop keys (INSERT DO NOTHING + two guarded metadata UPDATEs, guarded down), registry bounds budget `[1,1000]` / interval `[30,600]`, both baseline entries removed, real-Postgres assertion, soft renumber-at-merge. Rejected: max 400, interval `[1,900]`, minimum-only bound, budget-only seed, hard 281/291 dependency, DO UPDATE seed, tuple/time-window latch, "recovered" log (full list in design.md).
- Constitution rules touched: C-07 (recorded spec-time deviation → renumber at merge), C-11, C-14, C-15, C-16 (no durable CHANGE), C-18, F-01, F-04, F-06, F-07, F-09, P-03. Floor breaches: none in any round.
- Operator decisions recorded above (round 1: max 1000 / seed both keys / split; round 2: interval `[30,600]`, soft ordering; round 3: approve). Product-spec/acceptance amended in this session (FR-1..4/6, Fix Scope, Approvals, Out of Scope; AC-6/7/8 edited, AC-10..12 appended). `merge-order.md` rows 97/98 rewritten soft (both directions); pointer appended to 291's `context.md`.
- Corrections: recon's "291 docs only" was wrong (291 ships `035`); product-spec's "no real-Postgres harness" claim was wrong.
- Open Threads: staging `200` + pre-apply `value_type` check (operator); re-verify anchors after 291/294 rebases at `/sdd-spec`; follow the NNN old-number grep after any renumber.
- Status: spec-ready → design-approved.

## Session 2026-11-05 — sdd-spec

- Generated implementation-spec.md with 7 steps (PR-1 = Steps 1-2 latch + test; PR-2 = Steps 3-7 migration+baseline, bounds + test, real-Postgres assertion, docs). Status design-approved → implementation-ready.
- Tree: ccr-e5badadb-vrersi@6e607ec4, origin/main-dev +31 docs-only commits ahead (behind 0; `git diff --name-only origin/main-dev HEAD` outside `docs/` is empty). Same documented tree-freshness deviation as recon.md: the 289-293 spec artifacts exist only on this branch. No `codebase-discovery` subagents spawned (recon.md covers the map); anchors re-verified by direct grep/Read.
- Key codebase findings:
  - `origin/main-dev` config migrations end at `034`; only `037` (feature 281) exists on any remote feature branch; 291's `035` is spec-only. NNN stays a placeholder (spec-time `038`; renumber to max(origin/main-dev)+1 at merge, both directions).
  - Anchors re-verified at HEAD: `live_loop.py` `__init__ :275`, `_logged_unresolved :314`, budget read `:359`, `if not records :435`, overflow block `:445-462`; `SCALAR_BOUNDS_REGISTRY :103-149`; `setConfigScalarBounds.test.ts` `TIMEOUT_KEY_FORMS :266`, loop `:291`; `config-wiring.json` entries `:78-89`; analysis `CLAUDE.md :528-529`; `test_live_loop.py` `warns[1]` at `:803-804`.
  - Step 6 (SQL assertion) verification is offline by design (`ls`/`grep`); the real replay is the CI `migration-rerun` job (spec-template: no DB in step verification). AC-8 is mapped to Step 3 because its verification is the wiring checker itself.
- Open for /sdd-execute first gate (P-03): how PR-1 reaches `main-dev` independently of the single development branch (separate integration PR after Step 2) — not guessed in the spec.

## Session 2026-11-05 — sdd-review impl-spec loop round 1 (fixes)
- Review: PASS WITH WARNINGS + 1 gate-class finding. Fixed: reader-step/snapshot-built tests for BOTH keys (`@AC-6 @FR-3 @feature-278`: `run_forever :337`, `_run_cycle :359`; two characterisation tests in Step 2), merge-order row references, `int_positive` anchor `watcher.py:142-144`, Step 5 RED claim narrowed to the rejection cases, Step 6 coverage N/A + a real `environment` check, embedded-NNN list extended (sites 10-11), Step 7 verification rewritten, Step 6 fixtures aligned with AC-7 (user-2 75, user-3 50, ledger 50).
- Round 2 (impl-spec): `_one_iteration` now returns its sleep calls (interval reader test asserts `calls[0] == value`); the budget reader test is parametrised `(50, 40)` and stubs `_eval_pair` so it discriminates a read from a default; Step 6 pins the fixture INSERT column-list line shape for the `grep -A2` environment check.
- Round 3 (impl-spec): garbled sentence in the interval reader test fixed (explicit asyncio/parametrize decorators, `with pytest.raises(_StopLoop)`); Evidence now states `_one_iteration` currently returns None and its 3 callers ignore the return value. Round-3 review otherwise found no defects (mechanics, arithmetic, fixtures, harness verified).

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

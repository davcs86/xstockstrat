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

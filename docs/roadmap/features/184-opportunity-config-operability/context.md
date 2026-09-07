# Context: opportunity-config-operability

**Feature**: `docs/roadmap/features/184-opportunity-config-operability/feature.md`
**Product Spec**: `docs/roadmap/features/184-opportunity-config-operability/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/184-opportunity-config-operability/implementation-spec.md`

---

## Session 2026-09-07 — sdd-story

- Created from the opportunities-queue audit (this session), which compared the opportunities
  generator/materializer against the watchlists philosophy (features 180/181/182). This feature is the
  **config-operability** half — the direct feature-182 parallel.
- Audit finding (dim G1): the analysis code reads 15 `analysis.opportunity.*` keys; **0 are seeded**
  (invisible no-seed pattern) and **0 are bounded** — including footguns `refresh_hour_utc` (unclamped)
  and `max_concurrent_bars_fetches` (feature-141 SEV-2 lever). Confirmed via grep of migrations +
  configServiceImpl.ts SCALAR_BOUNDS_REGISTRY (only decay/stale + the feature-182 materializer keys).
- Scope: register at code defaults (no behavior change) + bounds on the numeric footguns; reuse
  feature-182's `lookupScalarBounds()` two-operand helper + migration template. FR-6 (refresh
  kill-switch, audit G6) carried as a design option.
- Sibling feature: **185 opportunity-compute-robustness** (the compute-correctness half — sentinel +
  dedicated sem + non-blocking cold read). Kept separate so config-only (184) can ship low-risk while
  185 has its own design debate.
- Numbering: 182 merged + launched, 183 (mcp-user-profile-roles) already exists on main-dev, so this is
  184 (185 is the sibling). Branch: `claude/opportunity-queue-philosophy` off origin/main-dev (operator
  granted the push OK; PR #1106's branch was left to the merged 182).
- Known trap carried: full-dotted `key` column + getter-matching `value_type` or silent orphan
  (migration-026/182 scar); several opportunity keys use the `get_int`/`get_float` zero-trap so a min≥1
  bound makes "0" intentionally unreachable — document per key.

## Session 2026-09-07 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- First criteria pass FAILED on one blocker (C-15 / criterion 8): FR-6 (refresh kill-switch) was a
  numbered functional requirement with no covering @AC-* scenario AND simultaneously open question #3
  ("include it or not") — a spec cannot both mandate a requirement and ask whether to do it.
- Fix (Behavior 1 / C-11 — surface the fork, defer to design): demoted the kill-switch out of the
  numbered FR list into a "Design option" note + the "Refresh kill-switch" Open Question. Committed
  requirements are now FR-1..FR-5 only, each with @AC coverage (FR-1→AC-1/2/3, FR-2→AC-4/5, FR-3→AC-1,
  FR-4→AC-6, FR-5→AC-7). Reconciled the Affected Services / Proto / Config Key Changes cross-refs and
  fixed the kill-switch key name to C-05 3-segment (`analysis.opportunity.refresh_enabled`).
- Re-review: PASS, 0 blockers, 0 warnings.
- Warnings: none.
- Overlap findings: CLEAN — no other active feature seeds/registers any analysis.opportunity.* key;
  next-free config seed migration is 028 (182 took 027 off the merge-order pre-assignment note, which
  only reached 026); feature 185's FR-3 semaphore key
  (analysis.opportunity.materializer_max_concurrent_bars_fetches) is a declared dependency on THIS
  feature's mechanism, distinct from 184's interactive max_concurrent_bars_fetches — not a duplicate.
- Advisory note carried to /sdd-spec: spec cites getters "in servicer.py"; resolved path is
  services/xstockstrat-analysis/app/handlers/servicer.py (use full path in impl-spec, C-01).

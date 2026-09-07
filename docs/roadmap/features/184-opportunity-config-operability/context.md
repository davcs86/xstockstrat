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

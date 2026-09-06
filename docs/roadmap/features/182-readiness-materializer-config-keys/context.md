# Context: readiness-materializer-config-keys

**Feature**: `docs/roadmap/features/182-readiness-materializer-config-keys/feature.md`
**Product Spec**: `docs/roadmap/features/182-readiness-materializer-config-keys/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/182-readiness-materializer-config-keys/implementation-spec.md`

---

## Session 2026-09-06 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- Origin: follow-up to feature 181. Operator could not enable the feature-180 readiness materializer
  because `analysis.readiness_materializer.*` keys are unregistered (no-seed pattern) and config-ui
  only edits registered keys; global `SetConfig create_key=true` requires admin scope (the MCP session
  used lacked it). Chosen path (operator decision): register the keys via a seed migration so config-ui
  can show/toggle them.
- Scope decision: seed at CURRENT code defaults (enabled=false) → registration is a no-behavior-change
  governance change; enabling is a later operator config-ui toggle.
- Known trap carried in (migration 026 scar): the `key` column must be the FULL dotted reader string
  and `value_type` must match the getter, or the row is a silent orphan. Mirror
  `026_analysis_engine_blend_keys` exactly (columns, per-env global rows, ON CONFLICT DO NOTHING).
- Branch note: harness-designated branch is `claude/watchlist-stock-list-perf-o3qoqb` (its prior PR is
  merged); this follow-up will restart that branch from origin/main-dev and open a NEW PR to main-dev,
  rather than a `feature/<slug>` branch, per the standing harness branch constraint.

## Session 2026-09-06 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- First pass FAILed on criterion 9 (unchecked Open Questions) + an advisory getter-typing warning;
  fixed both (commit 672747e): resolved all three Open Questions to [x]; corrected FR-1 to record the
  exact getter per key — notably `analysis.readiness_materializer.max_concurrent_bars_fetches` is read
  via `get_int` (zero-trap, servicer.py:454), NOT `get_int_present`; seed `int`/`2` is safe because it
  equals the code default. Re-review: PASS, 0 warnings.
- Overlap findings: none (migration 027 free; four keys only read — not seeded — by features 180/181;
  advisory 180→182 logical ordering, no blocking merge-order row).
- Warnings carried to design: when writing 027, a future operator setting
  `max_concurrent_bars_fetches=0` would have `get_int` collapse it back to `2` — do NOT seed `0`.

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

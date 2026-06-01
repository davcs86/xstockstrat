# Context: config-ui-weight-validation

**Feature**: `docs/roadmap/features/016-config-ui-weight-validation/feature.md`
**Product Spec**: `docs/roadmap/features/016-config-ui-weight-validation/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/016-config-ui-weight-validation/implementation-spec.md`

---

## Session 2026-05-23 — idea capture

- Feature directory created as deferred follow-up from `007-signal-source-weighting`.
- During 007 implementation, operator noted that the config-ui weight editor accepts any string
  value; bounds are only enforced server-side (analysis service clamps at read time, FR-5 of 007).
- Scope decision: keep 007 focused on the analysis service; weight validation deferred here.
- Preliminary notes: Option A (client-side key detection, no backend changes) vs. Option B
  (proto `validation` field, requires config service + proto changes). Option A noted as
  sufficient unless multiple keys need format-specific validation.

## Session 2026-06-01T00:00:00Z — sdd-story

- Created product-spec.md and context.md; updated feature.md from idea → draft.
- Updated affected service reference to note the 045 sequencing question: the implementation
  target is `xstockstrat-config-ui` before 045 lands or `xstockstrat-ui` after.
- Three open questions captured for the review gate:
  - Option A vs. Option B validation approach
  - Key detection heuristic (if Option A: suffix pattern, key path prefix, or JSON shape)
  - Sequencing vs. 045 (before = targets config-ui; after = targets xstockstrat-ui)

## Session 2026-06-01T00:01:00Z — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- All 3 open questions resolved at review gate:
  - Validation approach: Option B — proto-declared `ValidationRule` message and optional
    `validation` field on `ConfigKey`. More principled than key-name heuristics; future keys
    automatically get enforcement. Requires non-breaking proto addition + config service update.
  - Key detection heuristic: N/A — Option B chosen; config service declares `value_type` per
    key, no pattern matching needed in the UI.
  - Sequencing vs 045: after 045 — implementation targets `xstockstrat-ui` (consolidated
    frontend); must wait for 045 to land.
- Proto scope updated: `ValidationRule` message with `value_type` enum, `min_value`,
  `max_value`; optional `validation` field on `ConfigKey`. Non-breaking addition.
- Affected services updated: `packages/proto`, `xstockstrat-config`, `xstockstrat-ui`.
- Approval gates updated: proto reviewer required; 1 service owner (non-breaking addition).

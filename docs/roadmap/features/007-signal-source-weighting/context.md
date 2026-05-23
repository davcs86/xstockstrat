# Context: signal-source-weighting

**Feature**: `docs/roadmap/features/007-signal-source-weighting/feature.md`
**Product Spec**: `docs/roadmap/features/007-signal-source-weighting/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/007-signal-source-weighting/implementation-spec.md`

---

## Session 2026-05-16T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- Origin: audit of analysis service signal aggregation revealed all sources are weighted equally regardless of reliability.
- No proto changes required; weights delivered via existing config WatchConfig stream.

## Session 2026-05-23T00:00:00Z — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Warnings:
  - C-3 trading mode: spec does not explicitly state paper-safety (advisory; analysis feeds backtests only, no order execution)
  - Overlap: 009-agent-mcp-server also modifies `xstockstrat-analysis` — coordinate merge order to avoid conflicts in servicer.py
- Open question resolved: weights bounded to [0.0, 1.0], clamped at read time; FR-5 and AC-3 updated accordingly
- Backlog idea 016-config-ui-weight-validation created for deferred client-side validation

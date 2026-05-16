# Context: signal-source-weighting

**Feature**: `docs/roadmap/features/007-signal-source-weighting/feature.md`
**Product Spec**: `docs/roadmap/features/007-signal-source-weighting/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/007-signal-source-weighting/implementation-spec.md`

---

## Session 2026-05-16T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- Origin: audit of analysis service signal aggregation revealed all sources are weighted equally regardless of reliability.
- No proto changes required; weights delivered via existing config WatchConfig stream.

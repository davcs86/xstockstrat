# Context: token-utilization-optimization

**Feature**: `docs/roadmap/features/049-token-utilization-optimization/feature.md`
**Product Spec**: `docs/roadmap/features/049-token-utilization-optimization/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/049-token-utilization-optimization/implementation-spec.md`

---

## Session 2026-06-05T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- Story captured from conversation: split `docs/roadmap/features/` into `active/`, `launched/`, `demoted/` subdirs; update SDD skill globs to scope to `active/` only; add STATUS.md cache to `/sdd-status`.
- Key decision: `context.md` files in `launched/` features are preserved intact — they contain historically valuable decision logs. Token savings come from the subdirectory split (not loading launched/demoted by default), not from file pruning.
- Key decision: `rolled-back` status goes in `active/` (not `launched/`) since those features may be re-attempted.
- Open question flagged in product-spec: whether STATUS.md cache should include launched/demoted summary counts in its header even on default (non-`--all`) runs.

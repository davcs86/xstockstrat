# Context: watchlist-management

**Feature**: `docs/roadmap/features/058-watchlist-management/feature.md`
**Product Spec**: `docs/roadmap/features/058-watchlist-management/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/058-watchlist-management/implementation-spec.md`

---

## Session 2026-06-26 — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md.
- Feature 1 of 6 in the screener initiative (058 watchlist → 059 fundamentals-data → 060 screener →
  061 agent-tool → 062 fundamentals-signal-producer → 063 fundamentals-scoring-model).
- **Numbering note**: assigned `058` = max-existing(`057`)+1. The repo has duplicate numbers `020`
  and `052`, so the sdd-story count-based formula would have produced `059` and orphaned `058`; the
  number was assigned by max+1 instead to keep clean sequential numbering and match the design labels.
- Derived from a read-only screener gap-analysis exploration + multi-session design. Key decisions:
  watchlists mode-agnostic, hard-delete + ledger audit, owned by portfolio, universe resolved at the
  UI/agent layer (the screener RPC takes explicit symbols — decouples 058 from 060 at the RPC level).

## Session 2026-06-26 — sdd-review product-spec

- Product spec reviewed (spec-reviewer + feature-overlap subagents). Status: draft → spec-ready.
- Blocker found and fixed: proposed migration `006_watchlists` collided with the already-applied
  `006_positions_day_pnl`; trunk migrations run 000–006. Renumbered to `007_watchlists` and corrected
  the stale "migrations 000–005" claim in Problem Statement to "000–006".
- Warnings: none.
- Overlap findings: no feature-vs-feature collisions with siblings 059–063 (disjoint protos, configs,
  migration dirs). The one feature-vs-trunk migration collision was resolved by the renumber (no
  merge-order row needed). Shared `xstockstrat-ui` insights parent dir with 060 is distinct files.

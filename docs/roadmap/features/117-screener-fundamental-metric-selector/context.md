# Context: screener-fundamental-metric-selector

**Feature**: `docs/roadmap/features/117-screener-fundamental-metric-selector/feature.md`
**Product Spec**: `docs/roadmap/features/117-screener-fundamental-metric-selector/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/117-screener-fundamental-metric-selector/implementation-spec.md`

---

## Session 2026-08-07T00:00:00Z — sdd-story

- Origin: user request (screenshot of the live Screener page) — "Make this fundamentals field a
  selector." — plus a separate, non-code "Audit the website" ask handled outside the SDD pipeline
  (see repo-wide audit notes, not tracked under this feature).
- Codebase discovery (subagent) confirmed: the Fundamental metric field is a free-text `<Input>`
  (`page.tsx:242-248`); the Technical indicator field is already a real `<select>` driven by the
  static `BUILTIN_INDICATORS` catalog (`strategyCatalog.ts`); the backend already has a closed,
  validated set of 11 fundamental field names (`_FUNDAMENTAL_FIELDS`,
  `services/xstockstrat-analysis/app/services/screener.py:31-44`) used only for post-scan
  validation; no RPC exposes this list to the frontend.
- Created feature.md (status: draft), product-spec.md, context.md from user story.

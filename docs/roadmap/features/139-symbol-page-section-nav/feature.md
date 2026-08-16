# Feature: symbol-page-section-nav

**Development Branch**: `feature/symbol-page-section-nav`
**Created**: 2026-08-15
**Last Updated**: 2026-08-15

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-15 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-08-16 | `draft` → `spec-ready` | /sdd-review | Product spec approved (PASS WITH WARNINGS, 0 blockers, no Floor breach). Warnings: 4 Open Questions are legitimate /sdd-design deferrals; stale `PLATFORM_SUBNAV` term (live model is `NAV_GROUPS`). Overlap: soft/dependency only (deps 125 + 143 both already merged to main-dev); no FAIL-class collision. Spec assumptions verified accurate post-143. |
| 2026-08-16 | `spec-ready` → `design-approved` | /sdd-design | Design debated (2 rounds, full) and approved; recon.md + design.md written. Chose sticky segmented anchor-nav (`ToggleGroup type="single"` + `scrollIntoView` + `IntersectionObserver` scroll-spy, all sections mounted, hash deep-link preserving `?strategy=`) over Tabs/Accordion (which break `position-detail.spec.ts` + FR-7). R2 fixes: `aria-label="Symbol navigation"` (avoids getByRole substring collision), nav placed after `<h1>`. No Floor breach. |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Recon](recon.md) — grounded codebase dossier (Phase 0)
- [Design](design.md) — debated, approved architecture (Phase 1)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec symbol-page-section-nav`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Group the many stacked sections of the unified Symbol page (`/trader/positions/[symbol]`, feature 125)
into a same-page navigation pattern (tabs, sticky segmented section-nav, or anchored jump-links —
decided at `/sdd-design`) so a trader can move between logical section groups without scrolling the
whole page, on desktop and mobile.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-ui` (service owner) | Trading UI correctness, analytics display accuracy, Connect-RPC call safety, environment scope correctness, no secret values rendered in UI, no direct DB access |

## Next Action

`/sdd-spec symbol-page-section-nav` — generate the implementation spec from the approved design

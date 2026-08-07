# Feature: screener-fundamental-metric-selector

**Lifecycle Status**: `implementation-ready`
**Development Branch**: `feature/screener-fundamental-metric-selector`
**Created**: 2026-08-07
**Last Updated**: 2026-08-07

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-07 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-08-07 | `draft` → `spec-ready` | /sdd-review | Product spec approved (1 warning: FR-5 wording corrected re: `extra_metrics` union; overlap scan clean) |
| 2026-08-07 | `spec-ready` → `design-approved` | /sdd-design | Design debated (1 round, quick) and approved; recon.md + design.md written. No Floor breach — adversary's robustness/scope objections (doc-comment update, order-independent default, explicit e2e option-count/default assertions, aria-label collision note) folded directly into the Chosen Approach. |
| 2026-08-07 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 3 steps (strategyCatalog.ts catalog, page.tsx select conversion, screener.spec.ts e2e coverage). |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Recon](recon.md) — grounded codebase dossier
- [Design](design.md) — debated, approved architecture
- [Implementation Spec](implementation-spec.md)
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Replace the Screener page's free-text "Fundamental" metric-name field with a select dropdown
populated from the closed set of fundamental metric names the backend already validates against,
matching the existing select-driven pattern used for the Technical indicator field on the same page.

## Reviewers

| Role | Review Focus |
|---|---|
| `xstockstrat-ui` (service owner) | Trading UI correctness, analytics display accuracy, Connect-RPC call safety, no secret values rendered in UI |

## Next Action

`/sdd-review screener-fundamental-metric-selector impl-spec` — validate implementation spec, then `/sdd-execute screener-fundamental-metric-selector`

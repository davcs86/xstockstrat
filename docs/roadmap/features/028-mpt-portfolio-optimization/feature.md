# Feature: mpt-portfolio-optimization

**Lifecycle Status**: `demoted/canceled`
**Development Branch**: _none — demoted before implementation_
**Created**: 2026-05-26
**Last Updated**: 2026-05-26
**Archived**: 2026-08-05

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-05-26 | `idea` → `demoted/canceled` | brainstorming | Demoted at idea stage — see rationale in product-spec.md |
| 2026-08-05 | `demoted/canceled` | /sdd-archiver | Archived: synthesis → context.md + Ledger insights(1)/fails(1); pruned 1 specs |

---

## Artifacts

- Product Spec — pruned by /sdd-archiver 2026-08-05; see [Context Log](context.md) Archive Synthesis
- [Context Log](context.md) — decision log

---

## Summary

Apply Markowitz mean-variance optimization (Modern Portfolio Theory) to compute the theoretically optimal portfolio weights across open and candidate positions, replacing or supplementing the position sizing engine with a mathematically rigorous allocation model.

## Demotion Rationale (short)

Mean-variance optimization requires a reliable expected returns estimate — which does not exist — and breaks down numerically in small-sample regimes. It produces wildly different "optimal" portfolios from small input changes and fails exactly when diversification is most needed (correlated crashes). The position sizing engine (feature 023) provides the same practical benefit (risk-per-trade capping, concentration limits) without the false precision.

## Next Action

_None — feature is demoted. Do not implement._

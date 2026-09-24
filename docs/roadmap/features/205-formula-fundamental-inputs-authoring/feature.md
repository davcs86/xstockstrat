# Feature: formula-fundamental-inputs-authoring

**Development Branch**: `feature/formula-fundamental-inputs-authoring`
**Created**: 2026-09-24
**Last Updated**: 2026-09-24

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-09-24 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-09-24 | `draft` → `spec-ready` | /sdd-review | Product spec approved (warnings, no blockers); merge-order 205→201 recorded |
| 2026-09-24 | `spec-ready` → `design-approved` | /sdd-design | Design debated (3 rounds, full) and approved; recon.md + design.md written |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Recon Dossier](recon.md) — Phase 0 grounded codebase map (sdd-design)
- [Design](design.md) — debated, approved architecture (sdd-design, 3 rounds)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec <slug>`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Expose the fundamentals-formula capability (feature 201's `fundamental_inputs` /
`FundamentalMetric`) to formula **authoring** on both the MCP and the UI: let an author
declare a formula's fundamental inputs, see the declared inputs on read, discover the available
fundamental-metric catalog, and test a fundamentals-scoring formula with real (symbol-prefilled,
editable) fundamentals values — via the agent formula tools and the `/insights` FormulaEditor.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-indicators` owner | Formula engine, `fundamental_inputs` persistence/round-trip, `ExecuteFormula` input contract, catalog exposure |
| `xstockstrat-agent` owner | `manage_formula`/`test_formula`/`get_formula`/`list_formulas` tool surface, hand-written proto request builders (F-3/F-10 drift) |
| `xstockstrat-ui` owner | `/insights` FormulaEditor/FormulaWorkspace fundamental-input picker + test harness, no-hardcoded-color, Connect-JSON enum NAME-strings |
| `xstockstrat-marketdata` owner | `GetFundamentalsMulti` snapshot read for symbol-prefill test data (consumed, likely unchanged) |
| Proto Reviewer | Only if design adds a catalog RPC or new request fields (else no proto change — the field exists from 201) |

## Next Action

`/sdd-spec formula-fundamental-inputs-authoring` — generate the implementation spec from the approved design

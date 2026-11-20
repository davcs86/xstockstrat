# Feature: fix-mcp-deadline-budget

**Type**: bug
**Development Branch**: `feature/fix-mcp-deadline-budget`
**GitHub Issue**: none (Issues disabled) — reports: docs/reports/2026-10-29-agent-extract-tools-no-mcp-cap-defect.md, docs/reports/2026-10-29-agent-list-opportunities-over-mcp-timeout-defect.md, docs/reports/2026-10-19-cross-hop-deadline-bounds-unenforced-defect.md
**Severity**: SEV-2
**Created**: 2026-11-10
**Last Updated**: 2026-11-20

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-10 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from 3 defect report(s) (clustered triage) |
| 2026-11-10 | `draft` → `spec-ready` | /sdd-review | Product spec approved (4 warnings) |
| 2026-11-20 | `spec-ready` → `design-approved` | /sdd-design | Design debated (3 rounds, full) and approved; recon.md + debate.md + design.md written |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — grounded codebase dossier
- [Debate Register](debate.md) — settled decisions, locked rejected alternatives, objections
- [Design](design.md) — approved approach, rejected alternatives, open risks
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-mcp-deadline-budget`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Deadline budgets are not enforced end to end: `extract_*` tools and `list_opportunities` can outrun the MCP
client's 60 s timeout, and `SetConfig` bounds each timeout key independently so cross-hop ordering (PLAT-13) can
be inverted by two individually valid writes.

## Next Action

`/sdd-spec fix-mcp-deadline-budget` — generate implementation spec from the approved design

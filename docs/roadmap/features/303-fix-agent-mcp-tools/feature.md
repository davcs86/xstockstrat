# Feature: fix-agent-mcp-tools

**Type**: bug
**Development Branch**: `feature/fix-agent-mcp-tools`
**Defect Report**: `docs/reports/2026-11-07-agent-mcp-tool-error-details-masked-defect.md` (GitHub Issues disabled; PR #1470)
**Severity**: SEV-3
**Created**: 2026-11-07
**Last Updated**: 2026-11-07

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-07 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from defect report `docs/reports/2026-11-07-agent-mcp-tool-error-details-masked-defect.md` |
| 2026-11-07 | `draft` → `design-approved` | /sdd-design | Design debated (5 rounds, full; quick upgraded to full after 5 CHANGE business rules) and approved; recon.md + design.md written; C-16 sign-off recorded |
| 2026-11-07 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 9 steps (4 atomic units); 67 test-assertion flips measured in a scratch copy |
| 2026-11-07 | `implementation-ready` → `in-progress` | /sdd-execute | Steps 1+2 (mapper `CODE: body` + mapper tests/drift guard/CI filter) executed as one atomic unit |
| 2026-11-09 | `in-progress` → `code-completed` | /sdd-execute | All 9 steps done (step PRs #1473, #1474, #1480–#1482 merged into the feature branch); final integration PR opened |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description, fix scope and FR-1..FR-4
- [Recon](recon.md) — grounded codebase dossier
- [Design](design.md) — approved design (5 rounds)
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Implementation Spec](implementation-spec.md) — 9 numbered steps with codebase evidence
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Every xstockstrat-agent MCP tool raises `RuntimeError`/`ValueError`/`PermissionError` for anticipated backend refusals; the `mcp` SDK treats those as crashes and returns only `Error executing tool <name>`, so callers never see the gRPC code or message (first seen on `set_config` `FAILED_PRECONDITION`).

## Reviewers

| Reviewer | Focus |
|---|---|
| xstockstrat-agent owner | MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity; no secret values in tool output |

## Next Action

`/sdd-review fix-agent-mcp-tools impl-spec` — validate implementation spec, then `/sdd-execute fix-agent-mcp-tools`

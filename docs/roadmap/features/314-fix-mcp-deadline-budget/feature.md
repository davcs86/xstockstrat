# Feature: fix-mcp-deadline-budget

**Type**: bug
**Development Branch**: `feature/fix-mcp-deadline-budget`
**GitHub Issue**: none (Issues disabled) — reports: docs/reports/2026-10-29-agent-extract-tools-no-mcp-cap-defect.md, docs/reports/2026-10-29-agent-list-opportunities-over-mcp-timeout-defect.md, docs/reports/2026-10-19-cross-hop-deadline-bounds-unenforced-defect.md
**Severity**: SEV-2
**Created**: 2026-11-10
**Last Updated**: 2026-11-27
**Committed to main**: 5eeca9c8d00bc549c14dcd852862574d806b0fd2
**Launched date**: 2026-11-27

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-10 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from 3 defect report(s) (clustered triage) |
| 2026-11-10 | `draft` → `spec-ready` | /sdd-review | Product spec approved (4 warnings) |
| 2026-11-20 | `spec-ready` → `design-approved` | /sdd-design | Design debated (3 rounds, full) and approved; recon.md + debate.md + design.md written |
| 2026-11-20 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 9 steps |
| 2026-11-26 | `implementation-ready` → `in-progress` | /sdd-execute | → in-progress (sdd-batch-execute setup); steps 3,1,2,5,7,8 re-spec'd (migration renumbered 056 → 057) |
| 2026-11-27 | `in-progress` → `code-completed` | /sdd-execute | Steps 1–8 done; Step 9 skipped (operator decision B: operator-run after deploy, sign-off "unenumerated"); `check-config-wiring --final` exit 0 |

| 2026-11-27 | `code-completed` → `launched` | CI workflow | Promoted via PR #1633; committed 5eeca9c8d00bc549c14dcd852862574d806b0fd2 |
---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — grounded codebase dossier
- [Debate Register](debate.md) — settled decisions, locked rejected alternatives, objections
- [Design](design.md) — approved approach, rejected alternatives, open risks
- [Implementation Spec](implementation-spec.md) — 9 numbered steps with codebase evidence
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Deadline budgets are not enforced end to end: `extract_*` tools and `list_opportunities` can outrun the MCP
client's 60 s timeout, and `SetConfig` bounds each timeout key independently so cross-hop ordering (PLAT-13) can
be inverted by two individually valid writes.

## Reviewers

Snapshot from `docs/runbooks/reviewer-registry.md`, taken by `/sdd-spec` on 2026-11-20.

| Reviewer | Focus | Steps |
|---|---|---|
| xstockstrat-config owner | Config key naming (`<service>.<category>.<key>`), environment (`production`/`staging`) / global-per-user scoping, WatchConfig stream stability | 1, 2, 3, 4, 9 |
| DBA | Migration NNN numbering (no gaps, no conflicts), up+down pair present, run-order compliance with `scripts/db-migrate.sh` | 3 |
| xstockstrat-agent owner | MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity; no secret values in tool output | 5, 6, 7 |

Step 8 (docs) has no reviewer.

## Next Action

`/sdd-review fix-mcp-deadline-budget impl-spec` — validate implementation spec, then `/sdd-execute fix-mcp-deadline-budget`

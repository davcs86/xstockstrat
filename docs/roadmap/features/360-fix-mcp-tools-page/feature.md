# Feature: fix-mcp-tools-page

**Type**: bug
**Development Branch**: `feature/fix-mcp-tools-page`
**GitHub Issue**: none (Issues disabled) — report `docs/reports/2026-11-19-mcp-tools-page-empty-on-homelab-defect.md`
**Severity**: SEV-3
**Created**: 2026-11-19
**Last Updated**: 2026-11-19

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-19 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from report `docs/reports/2026-11-19-mcp-tools-page-empty-on-homelab-defect.md` |
| 2026-11-19 | `draft` → `design-approved` | /sdd-design | Design debated (4 rounds, quick upgraded by the operator) and approved; recon.md + debate.md + design.md written |
| 2026-11-19 | `design-approved` (unchanged) | /sdd-design | Design reopened by the operator and re-approved (run 2: 2 rounds, full): internal gRPC catalog endpoint on agent port 50061, public `/api/tools` removed; recon.md + debate.md + design.md rewritten |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — grounded codebase dossier
- [Debate Register](debate.md) — decisions, rejected alternatives, objections
- [Design](design.md) — approved approach
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-mcp-tools-page`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

`/accounts/mcp-tools` is empty on homelab because the UI BFF fetches the agent's tool catalog through
the public URL. The fix moves the catalog to an internal-only gRPC endpoint on the agent (port 50061,
mTLS, UI certificate only), removes the public unauthenticated `GET /api/tools`, and has the BFF call
the new endpoint.

## Next Action

`/sdd-spec fix-mcp-tools-page` — generate implementation spec from the approved design

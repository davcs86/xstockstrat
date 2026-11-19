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
| 2026-11-19 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 8 steps |
| 2026-11-19 | `implementation-ready` (unchanged) | /sdd-spec | Re-run: implementation spec revised for the impl-spec review findings (1 failure, 6 warnings closed); still 8 steps |
| 2026-11-19 | `implementation-ready` (unchanged) | /sdd-spec | Spec re-shaped to 15 steps (four atomic units) so no hand-written step lists more than five files; content and order unchanged |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — grounded codebase dossier
- [Debate Register](debate.md) — decisions, rejected alternatives, objections
- [Design](design.md) — approved approach
- [Implementation Spec](implementation-spec.md) — 15 steps (four atomic units)
- [Context Log](context.md) — session history, decisions, deviations

---

## Reviewers

_Canonical snapshot from `/sdd-spec` (2026-11-19, re-run the same day — roles unchanged): the distinct
`**Reviewers**` across all 15 steps of implementation-spec.md, per docs/runbooks/reviewer-registry.md.
Stable unless `/sdd-spec` re-runs._

| Role | Review Focus |
|---|---|
| Proto Reviewer | Field number uniqueness per message, `buf lint` and `buf breaking` pass (new package `agent/v1`, additive) |
| `packages/proto` owner | Naming conventions, backward compatibility |
| `xstockstrat-agent` owner | MCP tool contract stability (name, parameters, return shape), tool-count statements in sync, OAuth 2.1 edge-auth correctness and statelessness (`instance_count > 1` stays safe), no secret values in the catalog |
| `xstockstrat-ui` owner | Connect-RPC call safety, no secret values rendered in UI |
| Platform Lead | Port uniqueness (agent gRPC 50061), service registry consistency, inter-service dependency graph correctness |

---

## Summary

`/accounts/mcp-tools` is empty on homelab because the UI BFF fetches the agent's tool catalog through
the public URL. The fix moves the catalog to an internal-only gRPC endpoint on the agent (port 50061,
mTLS, UI certificate only), removes the public unauthenticated `GET /api/tools`, and has the BFF call
the new endpoint.

## Next Action

`/sdd-review fix-mcp-tools-page impl-spec` — validate implementation spec, then `/sdd-execute fix-mcp-tools-page`

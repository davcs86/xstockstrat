# Feature: mcp-user-profile-roles

**Development Branch**: `feature/mcp-user-profile-roles`
**Created**: 2026-09-06
**Last Updated**: 2026-09-06

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-09-06 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-09-06 | `draft` → `design-approved` | /sdd-design | Design debated (4 rounds, quick mode extended by operator) and approved; recon.md + design.md written |
| 2026-09-06 | `design-approved` (unchanged) | /sdd-review | Product-spec review PASS (advisory re-run at design-approved); OQ-1/OQ-2 reconciled to design decisions; overlap CLEAN |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Recon Dossier](recon.md) — grounded codebase map + patterns to reuse (Phase 0)
- [Design](design.md) — debated, approved architecture (Phase 1)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec mcp-user-profile-roles`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

New admin-gated MCP agent tools to manage users (create, list, get, set roles,
activate/deactivate, reset password) and to view/edit any user's profile metadata — the last of
which requires new admin cross-user identity RPCs, since today's `GetUserMetadata`/`UpdateUserMetadata`
are self-only.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Proto Reviewer | Field number uniqueness, additive (non-breaking) RPC additions, `buf lint`/`buf breaking` pass, deprecation-free |
| `xstockstrat-identity` (service owner) | JWT/role integrity, admin `x-access-scope` gating, atomic last-admin guard, no plaintext secrets |
| `xstockstrat-agent` (service owner) | MCP tool contract stability, `docs/runbooks/mcp-tools.md` parity, tool-count sync across all six inventory surfaces, admin `x-access-scope` forwarded only by management tools, no secret/PII leakage in tool output |
| Security | Admin-scope gating correctness, identity derived only from verified OAuth claims (never a tool param), least-privilege on new RPCs |

## Next Action

`/sdd-spec mcp-user-profile-roles` — generate implementation spec from the approved design

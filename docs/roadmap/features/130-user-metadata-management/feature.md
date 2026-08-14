# Feature: user-metadata-management

**Lifecycle Status**: `in-progress`
**Development Branch**: `feature/user-metadata-management`
**Created**: 2026-08-14
**Last Updated**: 2026-08-14

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-14 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-08-14 | `draft` → `design-approved` | /sdd-design | 3-round quick grilling; user-approved design |
| 2026-08-14 | `design-approved` → `implementation-ready` | /sdd-spec | 13-step implementation spec generated |
| 2026-08-14 | `implementation-ready` → `in-progress` | /sdd-execute | Step 1 (proto) completed |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Recon](recon.md) — codebase dossier (Phase 0)
- [Design](design.md) — debated architecture (Phase 1, 3 rounds quick)
- [Implementation Spec](implementation-spec.md) — 13 numbered steps with codebase evidence
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Add user profile metadata (email, phone, display name) to the identity service, with a self-management UI page under /config-ui and MCP agent tools for reading and setting metadata. Admins can manage their own profile only in this phase.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Service owner: `xstockstrat-identity` | JWT expiry and rotation, API key scoping, secret store integration (never plaintext secrets in config) |
| Service owner: `xstockstrat-ui` | Trading UI correctness, analytics display accuracy, config mutation safety, Connect-RPC call safety, environment scope correctness, no secret values rendered in UI, no direct DB access (except audit log) |
| Service owner: `xstockstrat-agent` | MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity; tool-count statements kept in sync across all six inventory surfaces; OAuth 2.1 edge-auth correctness and statelessness; admin `x-access-scope` forwarded only by the management tools; no secret values in tool output |
| Proto Reviewer | Field number uniqueness, backward compatibility, `buf lint`/`buf breaking` pass |
| DBA | Migration NNN numbering, up+down pair present, index correctness |

## Next Action

`/sdd-review user-metadata-management impl-spec` — advisory review, then `/sdd-execute user-metadata-management`

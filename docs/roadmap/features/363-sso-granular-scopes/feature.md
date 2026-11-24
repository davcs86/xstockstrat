# Feature: sso-granular-scopes

**Development Branch**: `feature/sso-granular-scopes`
**Created**: 2026-11-24
**Last Updated**: 2026-11-24

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-24 | `idea` → `draft` | /sdd-story | Product spec generated |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec sso-granular-scopes`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Follow-up to 345 (Authelia SSO): xstockstrat enforces a granular scope catalog on every MCP tool, MCP clients get
read-only access by default while the web session keeps full role-based access, and an app-side Scope Picker lets a
user widen or narrow what each MCP client may do on their account.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-agent` owner | MCP tool contract stability and `docs/runbooks/mcp-tools.md` parity; OAuth 2.1 edge-auth correctness and statelessness (`instance_count > 1` must stay safe); admin `x-access-scope` forwarded only by the management tools |
| `xstockstrat-identity` owner | JWT expiry and rotation, API key scoping, secret store integration (never plaintext secrets in config) |
| `xstockstrat-ui` owner | Config mutation safety, Connect-RPC call safety, environment (`production`/`staging`) scope correctness, no secret values rendered in UI |
| Proto Reviewer | Additive-only `identity.proto` change, `buf lint` + `buf breaking` against the dev trunk |
| DBA | Migration NNN numbering, up+down pair, run order per `scripts/db-migrate.sh` |

## Next Action

`/sdd-review sso-granular-scopes product-spec` — AI review of product spec before running /sdd-spec. Blocked on 345
(`authelia-sso`) shipping; see `product-spec.md` § Open Questions.

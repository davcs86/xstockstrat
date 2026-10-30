# Feature: third-party-sso-oidc

**Development Branch**: `feature/third-party-sso-oidc`
**Created**: 2026-10-30
**Last Updated**: 2026-10-30

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-30 | `idea` → `draft` | /sdd-story | Product spec generated |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec third-party-sso-oidc`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Add OpenID Connect (authorization-code + PKCE) single sign-on so users can authenticate through a third-party IdP such as Authentik, on the `xstockstrat-ui` login, the MCP agent's OAuth consent step, with an operator page in config-ui to configure and test the IdP. Password login is retained.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-identity` owner | JWT expiry and rotation, secret store integration (never plaintext secrets in config) |
| `xstockstrat-ui` owner | Connect-RPC call safety, no secret values rendered in UI, environment scope correctness |
| `xstockstrat-agent` owner | OAuth 2.1 edge-auth correctness and statelessness (`instance_count > 1` safe); no secret values in tool output |
| `xstockstrat-config` owner | Config key naming, secret encryption + redaction, scoping |
| Security | Secrets encrypted at rest, redacted at read edges, `GetSecret` allow-list; JWT claims minimal |
| Proto Reviewer | Field number uniqueness, backward compatibility, `buf lint`/`buf breaking` |
| DBA | Migration NNN numbering, up+down pair, index correctness (identity-link table) |

## Next Action

`/sdd-review third-party-sso-oidc product-spec` — AI review of product spec before running /sdd-spec

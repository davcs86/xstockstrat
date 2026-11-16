# Feature: authelia-sso

**Development Branch**: `feature/authelia-sso`
**Created**: 2026-11-15
**Last Updated**: 2026-11-15

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-15 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-11-15 | `draft` → `spec-ready` | /sdd-review | Product spec approved (0 warnings, after 4 passes) |
| 2026-11-15 | `spec-ready` → `draft` | owner | FR-14 added: backwards compatible with DigitalOcean until cutover; re-review required |
| 2026-11-15 | `draft` → `spec-ready` | /sdd-review | Product spec re-approved after FR-14 (0 warnings, after 6 passes) |
| 2026-11-16 | `spec-ready` → `design-approved` | /sdd-design | Design debated (9 rounds, full) and approved; recon.md + debate.md + design.md written. Spec amended during design; `/sdd-review product-spec` re-run required |
| 2026-11-16 | `design-approved` (unchanged) | /sdd-review | Product spec re-approved after design-round amendments (0 warnings, after 3 passes); config seed renumbered 050 → 051 |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Recon](recon.md) — grounded codebase dossier
- [Debate Register](debate.md) — D-1..D-93, R-1..R-22, O-1..O-84
- [Design](design.md) — approved architecture
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec authelia-sso`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

xstockstrat (prod and staging, web UI and MCP agent) authenticates through the homelab's Authelia (OIDC, the only
token issuer) instead of its own password login and OAuth server, while `identity.users` and per-environment roles stay
authoritative. MCP tokens can be narrowed by OAuth scope; password login survives only behind a rollback flag.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Security | JWT claims minimal, auth scope correctness, secrets as encrypted `is_secret` config rows resolved via `GetSecret`, never env vars |
| Proto Reviewer | Field number uniqueness, additive-only `identity.proto` change, `buf lint` + `buf breaking` against `main-dev` |
| DBA | identity migration `007` up+down pair, FK and uniqueness on `external_identities`, run order in `scripts/db-migrate.sh` |
| `xstockstrat-identity` owner | JWT expiry and rotation, secret store integration (never plaintext secrets in config) |
| `xstockstrat-agent` owner | OAuth 2.1 edge-auth correctness and statelessness (`instance_count > 1` safe), MCP tool contract stability, `docs/runbooks/mcp-tools.md` parity |
| `xstockstrat-ui` owner | Connect-RPC call safety, environment scope correctness, no secret values rendered in UI |
| `xstockstrat-config` owner | Key naming `<service>.<category>.<key>`, environment scoping, secret encryption + redaction |
| Platform Lead | Cross-repo dependency on `davcs86/homelab-edge` (Authelia, Caddy routes) and deploy config parity |

## Next Action

Run the Authelia v4.39.28 spike: items (a)–(e), the RS256 ID-token algorithm, the end_session / portal `rd` / GET `/logout` behaviour, the auth-code lifespan, and whether the discovery issuer has a trailing slash (design.md § Open Risks). Then run `/sdd-spec authelia-sso` to generate the implementation spec from the approved design.

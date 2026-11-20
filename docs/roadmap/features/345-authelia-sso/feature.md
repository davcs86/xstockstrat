# Feature: authelia-sso

**Development Branch**: `feature/authelia-sso`
**Created**: 2026-11-15
**Last Updated**: 2026-11-16

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
| 2026-11-16 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 40 steps |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Recon](recon.md) — grounded codebase dossier
- [Debate Register](debate.md) — D-1..D-93, R-1..R-22, O-1..O-84
- [Design](design.md) — approved architecture
- [Implementation Spec](implementation-spec.md)
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

xstockstrat (prod and staging, web UI and MCP agent) authenticates through the homelab's Authelia (OIDC, the only
token issuer) instead of its own password login and OAuth server, while `identity.users` and per-environment roles stay
authoritative. MCP tokens can be narrowed by OAuth scope; password login survives only behind a rollback flag.

## Reviewers

_Canonical snapshot from `/sdd-spec` (2026-11-16): the distinct `**Reviewers**` across all 40 steps of
implementation-spec.md, per docs/runbooks/reviewer-registry.md. Stable unless `/sdd-spec` re-runs._

| Role | Review Focus |
|---|---|
| Proto Reviewer | Field number uniqueness per message, additive-only `identity.proto` change, `buf lint` + `buf breaking` against the dev trunk |
| `packages/proto` owner | Backward compatibility (no field removal or type change), naming conventions |
| DBA | Migration NNN numbering, up+down pair, index correctness, run order per `scripts/db-migrate.sh` (identity `007`, config `053`; renumbered 050→051→052→053, D-94/D-99/D-100) |
| `xstockstrat-identity` owner | JWT expiry and rotation, secret store integration (never plaintext secrets in config) |
| `xstockstrat-config` owner | Key naming, environment (`production`/`staging`) scoping, secret encryption + redaction |
| `xstockstrat-agent` owner | OAuth 2.1 edge-auth correctness and statelessness (`instance_count > 1` safe), MCP tool contract stability, admin `x-access-scope` forwarded only by management tools |
| `xstockstrat-ui` owner | Connect-RPC call safety, environment scope correctness, no secret values rendered in UI, trading UI correctness |
| Security | JWT claims minimal, auth scope correctness, secrets decryptable only via `GetSecret` behind the `x-internal-caller` + SAN allow-list |
| Platform Lead | Inter-service dependency graph (agent → config `ui` stream), CI gate parity (`identity-db-test`), deploy config parity (`APP_URL`) |

## Next Action

`/sdd-review authelia-sso impl-spec` — validate implementation spec, then `/sdd-execute authelia-sso`

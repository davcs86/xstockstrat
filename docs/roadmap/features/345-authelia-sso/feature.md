# Feature: authelia-sso

**Development Branch**: `feature/authelia-sso`
**Created**: 2026-11-15
**Last Updated**: 2026-11-27

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
| 2026-11-24 | `implementation-ready` → `draft` | owner | Re-spec against homelab-edge `2026-11-23-authelia-sso-respec.md`: `auth.mode` (local/both/oidc), explicit Link SSO, no email linking or SSO-created users; full SDD re-run (review → design → spec) required |
| 2026-11-24 | `draft` → `spec-ready` | /sdd-review | Product spec approved after the 2026-11-24 re-spec (1 accepted warning, AC-28; 3 passes) |
| 2026-11-24 | `spec-ready` → `design-approved` | /sdd-design | Design re-debated (rounds 10–13, full) and approved; recon.md + debate.md + design.md rewritten |
| 2026-11-24 | `design-approved` (unchanged) | /sdd-review | Product spec re-approved after the design-round amendments (pass 2; 1 cosmetic warning fixed); merge-order row for config `056` vs 314/317/321 |
| 2026-11-24 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec regenerated after the re-spec with 58 steps (supersedes the 2026-11-16 52-step spec) |
| 2026-11-27 | `implementation-ready` (unchanged) | owner | Owner decisions: no tokens on stale keys (D-138 via P-6, AC-79; Steps 19, 20, 24, 54 amended before execution) and no Claude Code clients on the homelab (Step 54 runbook) |
| 2026-11-27 | `implementation-ready` (unchanged) | owner | Spike S17: Link requests send `prompt=login` + `max_age=1`, not `max_age=0` (D-139 via P-7; AC-65 text, same ID; Steps 32, 33, 43, 53, 54 amended before execution); cutover gate 2 proven on the spike |
| 2026-11-27 | `implementation-ready` (unchanged) | owner | Specs re-grounded on `main-dev@187e9f8` (docs only): config seed `056` → `060`, Tree header, shifted line citations; `merge-order.md` 345 rows resolved |
| 2026-11-27 | `implementation-ready` (unchanged) | /sdd-execute | Sequential re-spec gate on `main-dev@4edfa94` (owner: targeted re-spec): Step 10 gains `revokeToken.test.ts` (8th inline config mock, added by 319); citation-only fixes in Steps 11, 13, 27, 31, 32, 46, 47, 52, 55 |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Recon](recon.md) — grounded codebase dossier
- [Debate Register](debate.md) — D-1..D-139, R-1..R-30, O-1..O-127, P-1..P-7 (35 decisions superseded 2026-11-24; D-2/D-31/D-37 narrowed by D-138 and D-119's `max_age=0` by D-139, 2026-11-27)
- [Design](design.md) — approved architecture
- [Implementation Spec](implementation-spec.md)
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

xstockstrat (prod and staging, web UI and MCP agent) can authenticate through the homelab's Authelia (OIDC) per
deployment, while keeping its own password login for every user and its built-in OAuth server in `local`/`both`;
`identity.users` and per-environment roles stay authoritative. MCP tokens can be narrowed by OAuth scope. Amended 2026-11-24: one key `identity/auth.mode` (`local` |
`both` | `oidc`) per deployment, explicit "Link SSO", every user keeps a local password, DigitalOcean stays `local`.

## Reviewers

_Canonical snapshot from `/sdd-spec` (2026-11-24): the distinct `**Reviewers**` across all 58 steps of
implementation-spec.md, per docs/runbooks/reviewer-registry.md. Stable unless `/sdd-spec` re-runs._

| Role | Review Focus |
|---|---|
| Proto Reviewer | Field number uniqueness per message, additive-only `identity.proto` change (four RPCs), `buf lint` + `buf breaking` against the dev trunk |
| `packages/proto` owner | Backward compatibility (no field removal or type change), naming conventions |
| DBA | Migration NNN numbering, up+down pair, index correctness, run order per `scripts/db-migrate.sh` (identity `007`, config `060` taken at execute) |
| `xstockstrat-identity` owner | JWT expiry and rotation, secret store integration (never plaintext secrets in config) |
| `xstockstrat-config` owner | Key naming, environment (`production`/`staging`) scoping, secret encryption + redaction |
| `xstockstrat-agent` owner | OAuth 2.1 edge-auth correctness and statelessness (`instance_count > 1` safe), MCP tool contract stability, admin `x-access-scope` forwarded only by management tools |
| `xstockstrat-ui` owner | Connect-RPC call safety, environment scope correctness, no secret values rendered in UI, trading UI correctness |
| Security | JWT claims minimal, auth scope correctness, secrets decryptable only via `GetSecret` behind the `x-internal-caller` + SAN allow-list |
| Platform Lead | Inter-service dependency graph (agent → config `identity` stream), CI gate parity (UI `typecheck`, vector-file filters), deploy config parity (`APP_URL`) |

## Next Action

`/sdd-execute authelia-sso` — the advisory `/sdd-review impl-spec` ran 2026-11-24 (`3392050`); first clear the ⚠ items
still open in `context.md` (Session 2026-11-24 — sdd-review impl-spec). The 24 h stale-key sign-off is closed: the
owner removed the window on 2026-11-27 (D-138).
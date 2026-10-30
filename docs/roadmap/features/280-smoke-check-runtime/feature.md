# Feature: smoke-check-runtime

**Development Branch**: `claude/smoke-test-deployment-0f1z5j` (operator constraint: PR #1359 into `main-dev`; no `feature/` branch is created for this feature)
**Created**: 2026-10-30
**Last Updated**: 2026-10-30

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-30 | `idea` → `draft` | /sdd-story | Product spec generated from the approved brainstorm design |
| 2026-10-30 | `draft` → `spec-ready` | /sdd-review | Product spec approved (6 advisory warnings); first pass failed on Open Questions, fixed |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec smoke-check-runtime`_
- [Context Log](context.md) — session history, decisions, deviations
- Design input: `docs/superpowers/specs/2026-10-29-staging-smoke-checks-design.md` (approved); evidence: `docs/reports/2026-10-30-smoke-verification-needs.md`; draft plan: `docs/superpowers/plans/2026-10-29-staging-smoke-checks.md`

---

## Summary

A staging-only `xstockstrat-smoke` service runs a catalog of named checks after each staging deploy on homelab and DO dev (phase 1: read-only DB and RPC reads; phase 2: owner-scoped writes as a dedicated non-admin smoke user) and records every attempt as a committed JSON file on a `smoke-results` branch, tied to the deployed SHA, for the next feature part to read.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md. Snapshot finalized at /sdd-spec time.)_

| Role | Review Focus |
|---|---|
| Platform Lead | Port uniqueness (9110), service registry consistency, inter-service dependency graph, recorded gRPC-only HTTP exception |
| DBA | Read-only DB role provisioning; config migrations 034/035 numbering with up+down pairs |
| Proto Reviewer | Field/option safety of `idempotency_level = NO_SIDE_EFFECTS` annotations across all ten service protos; `buf lint` and `buf breaking` pass |
| Security | Cross-service read access, `GetSecret`-backed auth key, PAT scope and rotation, scoped-write allowlist and kill switch |
| `xstockstrat-config` owner | Key naming, secret encryption + redaction, `SECRET_CALLER_ALLOWLIST` grant with `peerSan` |
| `xstockstrat-agent` owner | MCP tool contract stability, `docs/runbooks/mcp-tools.md` parity, tool-count surfaces, admin-gated tool, no secret values in output |
| Owners of annotated protos (`trading`, `portfolio`, `marketdata`, `indicators`, `ingest`, `analysis`, `ledger`, `identity`, `notify`) | Which of their RPCs are pure reads; which owner-scoped writes may be allowlisted |

## Next Action

`/sdd-design smoke-check-runtime quick` — recon + one adversarial round (Constitution C-11), then `/sdd-spec`

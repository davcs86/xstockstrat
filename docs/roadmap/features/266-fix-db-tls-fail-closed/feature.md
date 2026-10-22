# Feature: fix-db-tls-fail-closed

**Type**: bug
**Development Branch**: `feature/fix-db-tls-fail-closed`
**GitHub Issue**: none (Issues disabled). Defect report: `docs/reports/2026-10-21-db-tls-fail-closed-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-21
**Last Updated**: 2026-10-22

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-21 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from `docs/reports/2026-10-21-db-tls-fail-closed-defect.md` (debt-radar D-32) |
| 2026-10-21 | `draft` → `spec-ready` | /sdd-review | Product spec approved (7 warnings; overlap WARN with 242/248/241) |
| 2026-10-22 | `spec-ready` → `design-approved` | /sdd-design | Design debated (2 rounds, full) and approved; recon.md + design.md written |

---

## Reviewers

Snapshot from `docs/runbooks/reviewer-registry.md` at /sdd-triage time (2026-10-21). `/sdd-spec` overwrites it with per-step assignments.

| Reviewer | Focus | Steps |
|---|---|---|
| `xstockstrat-ledger` owner | Boot behaviour of the query pool and the dedicated LISTEN connection (`EventNotifier`) under the new TLS gate | TBD (/sdd-spec) |
| `xstockstrat-config` owner | Boot ordering beside `CONFIG_SECRETS_ENCRYPTION_KEY` fail-fast; DB channel carries secret ciphertext | TBD (/sdd-spec) |
| `xstockstrat-identity` owner | DB channel carries password and refresh-token hashes | TBD (/sdd-spec) |
| `xstockstrat-notify` owner | Boot behaviour, no regression of alert delivery | TBD (/sdd-spec) |
| `xstockstrat-ui` owner | Config-ui audit route DB access (the only sanctioned UI DB use); `.do` env wiring for the UI component | TBD (/sdd-spec) |
| Security | Fail-closed TLS verification in deployed environments; CA material handled as public bootstrap env (like `MTLS_CA_CERT`) | All steps |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — grounded codebase dossier (Phase 0)
- [Design](design.md) — approved design: chosen approach, rejected alternatives, open risks
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-db-tls-fail-closed`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Four Node services and the UI audit route set `rejectUnauthorized: !!caCert`, so a missing `DATABASE_CA_CERT`
silently downgrades to unverified TLS; the UI component has no `DATABASE_CA_CERT` in either `.do` spec, so its
audit route already connects unverified in both deployed environments.

## Next Action

`/sdd-spec fix-db-tls-fail-closed` — generate implementation spec from the approved design

# Feature: fix-db-tls-fail-closed

**Type**: bug
**Development Branch**: `feature/fix-db-tls-fail-closed`
**GitHub Issue**: none (Issues disabled). Defect report: `docs/reports/2026-10-21-db-tls-fail-closed-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-21
**Last Updated**: 2026-10-21

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-21 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from `docs/reports/2026-10-21-db-tls-fail-closed-defect.md` (debt-radar D-32) |

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
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-db-tls-fail-closed`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Four Node services and the UI audit route set `rejectUnauthorized: !!caCert`, so a missing `DATABASE_CA_CERT`
silently downgrades to unverified TLS; the UI component has no `DATABASE_CA_CERT` in either `.do` spec, so its
audit route already connects unverified in both deployed environments.

## Next Action

`/sdd-design fix-db-tls-fail-closed` — recommended design depth: full (5 affected services, security, deploy spec change); see context.md

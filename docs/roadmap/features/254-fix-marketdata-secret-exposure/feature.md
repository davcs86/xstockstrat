# Feature: fix-marketdata-secret-exposure

**Type**: bug
**Development Branch**: `feature/fix-marketdata-secret-exposure`
**GitHub Issue**: none (Issues disabled). Defect report: `docs/reports/2026-10-21-marketdata-secret-exposure-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-21
**Last Updated**: 2026-10-21

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-21 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from `docs/reports/2026-10-21-marketdata-secret-exposure-defect.md` (debt-radar D-39, D-40) |

---

## Reviewers

Snapshot from `docs/runbooks/reviewer-registry.md` at /sdd-triage time (2026-10-21). `/sdd-spec` overwrites it with per-step assignments.

| Reviewer | Focus | Steps |
|---|---|---|
| `xstockstrat-marketdata` owner | Vendor client error handling (D-39); the marketdata leaf SAN the D-40 grant will bind to | TBD (/sdd-spec) |
| `xstockstrat-config` owner | Secret encryption + redaction, `GetSecret` allow-list (D-40) | TBD (/sdd-spec) |
| Security | Secrets decryptable only via `GetSecret` gated by the `x-internal-caller` allow-list; no plaintext secret in errors or logs | All steps |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-marketdata-secret-exposure`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

FMP/Finnhub transport errors wrap a `*url.Error` whose message carries the vendor API key (D-39). Config's
`marketdata` `GetSecret` grant has no `peerSan`, so any mTLS peer can decrypt all four vendor credentials by
sending `x-internal-caller: marketdata` (D-40).

## Next Action

`/sdd-design fix-marketdata-secret-exposure` — recommended design depth: full (2 affected services, security); see context.md

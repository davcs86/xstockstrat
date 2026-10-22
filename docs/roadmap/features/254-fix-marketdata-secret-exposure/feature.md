# Feature: fix-marketdata-secret-exposure

**Type**: bug
**Development Branch**: `feature/fix-marketdata-secret-exposure`
**GitHub Issue**: none (Issues disabled). Defect report: `docs/reports/2026-10-21-marketdata-secret-exposure-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-21
**Last Updated**: 2026-10-22

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-21 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from `docs/reports/2026-10-21-marketdata-secret-exposure-defect.md` (debt-radar D-39, D-40) |
| 2026-10-21 | `draft` → `spec-ready` | /sdd-review | Product spec approved (5 warnings; 5 WARN-level file overlaps, no FAIL) |
| 2026-10-22 | `spec-ready` → `design-approved` | /sdd-design | Design debated (2 rounds, full) and approved; recon.md + design.md written. Operator signed off the config @AC-4 CHANGE (header → header+SAN) and folded the `build request: %w` sites into Step 1 |

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
- [Recon](recon.md) — grounded codebase dossier (Phase 0)
- [Design](design.md) — approved design: chosen approach, rejected alternatives, open risks (Phase 1)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-marketdata-secret-exposure`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

FMP/Finnhub transport errors wrap a `*url.Error` whose message carries the vendor API key (D-39). Config's
`marketdata` `GetSecret` grant has no `peerSan`, so any mTLS peer can decrypt all four vendor credentials by
sending `x-internal-caller: marketdata` (D-40).

## Next Action

`/sdd-spec fix-marketdata-secret-exposure` — generate implementation spec from the approved design

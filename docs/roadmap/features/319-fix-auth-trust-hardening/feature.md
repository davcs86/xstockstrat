# Feature: fix-auth-trust-hardening

**Type**: bug
**Development Branch**: `feature/fix-auth-trust-hardening`
**GitHub Issue**: none (Issues disabled) — reports: docs/reports/2026-10-20-config-setconfig-internal-caller-no-peersan-defect.md, docs/reports/2026-10-19-identity-revoketoken-unverified-decode-defect.md, docs/reports/2026-10-29-agent-dcr-fail-closed-defect.md
**Severity**: SEV-2
**Created**: 2026-11-10
**Last Updated**: 2026-11-20

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-10 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from 3 defect report(s) (clustered triage) |
| 2026-11-10 | `draft` → `spec-ready` | /sdd-review | Product spec approved (4 warnings) |
| 2026-11-20 | `spec-ready` → `design-approved` | /sdd-design | Design debated (3 rounds, full) and approved; recon.md + debate.md + design.md written |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — grounded codebase dossier
- [Debate Register](debate.md) — settled decisions, rejected alternatives, objections
- [Design](design.md) — approved approach, rejected alternatives, open risks
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-auth-trust-hardening`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Three auth edges trust input they should verify: config's `SetConfig` internal-caller grant trusts the
`x-internal-caller` header with no mTLS peer SAN, identity's `RevokeToken` acts on an unverified JWT decode, and
the agent's OAuth DCR fails open (registration enabled, empty redirect allowlist) when config stalls.

## Next Action

`/sdd-spec fix-auth-trust-hardening` — generate implementation spec from the approved design

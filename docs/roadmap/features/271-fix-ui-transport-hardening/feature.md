# Feature: fix-ui-transport-hardening

**Type**: bug
**Development Branch**: `feature/fix-ui-transport-hardening`
**GitHub Issue**: none (Issues disabled). Defect report: `docs/reports/2026-10-21-ui-transport-hardening-defect.md`
**Severity**: SEV-3
**Created**: 2026-10-21
**Last Updated**: 2026-10-22

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-21 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from `docs/reports/2026-10-21-ui-transport-hardening-defect.md` (debt-radar D-37, D-38) |
| 2026-10-21 | `draft` → `spec-ready` | /sdd-review | Product spec approved (5 warnings) |
| 2026-10-22 | `spec-ready` → `design-approved` | /sdd-design | Design debated (2 rounds, full) and approved; recon.md + design.md written |

---

## Reviewers

Snapshot from `docs/runbooks/reviewer-registry.md` at /sdd-triage time (2026-10-21). `/sdd-spec` overwrites it with per-step assignments.

| Reviewer | Focus | Steps |
|---|---|---|
| `xstockstrat-ui` owner | Connect-RPC call safety, trading UI correctness, environment scope correctness | TBD (/sdd-spec) |
| Security | Identity, auth scope | D-38 matcher change widens the unauthenticated surface to health routes only; confirm no other path is exempted |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — grounded codebase dossier (Phase 0)
- [Design](design.md) — approved design: chosen approach, rejected alternatives, open risks
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-ui-transport-hardening`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

The UI's server-side gRPC transport has no default deadline, so a hung backend (notably identity during
middleware `refreshSession`) hangs requests (D-37); the middleware matcher exempts only non-existent
root-level health paths, so the eight segment health routes require auth (D-38).

## Next Action

`/sdd-spec fix-ui-transport-hardening` — generate implementation spec from the approved design (run the mandatory Grafana p99 gate on the provisional D rows first; see design.md item 7)

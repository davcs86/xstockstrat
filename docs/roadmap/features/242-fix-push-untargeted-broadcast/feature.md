# Feature: fix-push-untargeted-broadcast

**Type**: bug
**Development Branch**: `feature/fix-push-untargeted-broadcast`
**GitHub Issue**: none (Issues disabled). Defect report: `docs/reports/2026-10-19-notify-untargeted-push-broadcasts-all-users-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-20
**Last Updated**: 2026-10-21

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-20 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from `docs/reports/2026-10-19-notify-untargeted-push-broadcasts-all-users-defect.md` |
| 2026-10-20 | `draft` → `spec-ready` | /sdd-review | Product spec approved (5 warnings; overlap WARN ×3) |
| 2026-10-20 | `spec-ready` (unchanged) | /sdd-review | Product spec re-review: PASS WITH WARNINGS (6 warnings, 4 notes; no Floor breach); overlap WARN ×4 (215 same-function, 244, 240, 251), no FAIL. Low-cost warnings fixed in product-spec.md + acceptance.feature |
| 2026-10-21 | `spec-ready` → `design-approved` | /sdd-design | Design debated (5 rounds, full) and approved under operator standing authorization; recon.md + design.md written |

---

## Reviewers

Provisional snapshot from `docs/runbooks/reviewer-registry.md` at /sdd-triage time (2026-10-20). `/sdd-spec` overwrites it with per-step assignments.

| Reviewer | Focus |
|---|---|
| `xstockstrat-notify` owner | Stream delivery guarantees, backpressure handling, alert deduplication |
| `xstockstrat-portfolio` owner | P&L calculation accuracy, position snapshot consistency, concurrent write safety |
| `xstockstrat-analysis` owner | Backtest reproducibility, strategy scoring determinism, no look-ahead bias |
| Security | Cross-user data exposure: OS-level notifications must not carry one user's content to another user's devices |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — Phase 0 grounded codebase dossier
- [Design](design.md) — debated, approved design (live SAN-gated identity `ListAdminUserIds` lookup)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-push-untargeted-broadcast`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

An alert emitted with an empty `target_user_id` is Web-Pushed to every row of `notify.push_subscriptions`, so
per-user content (portfolio risk breaches, owner-scoped strategy triggers) reaches every user's devices.
Changes feature 165 FR-3 broadcast semantics for the push channel.

## Next Action

`/sdd-spec fix-push-untargeted-broadcast` — generate implementation spec from the approved design

# Feature: fix-push-untargeted-broadcast

**Type**: bug
**Development Branch**: `feature/fix-push-untargeted-broadcast`
**GitHub Issue**: none (Issues disabled). Defect report: `docs/reports/2026-10-19-notify-untargeted-push-broadcasts-all-users-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-20
**Last Updated**: 2026-10-20

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-20 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from `docs/reports/2026-10-19-notify-untargeted-push-broadcasts-all-users-defect.md` |

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
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-push-untargeted-broadcast`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

An alert emitted with an empty `target_user_id` is Web-Pushed to every row of `notify.push_subscriptions`, so
per-user content (portfolio risk breaches, owner-scoped strategy triggers) reaches every user's devices.
Changes feature 165 FR-3 broadcast semantics for the push channel.

## Next Action

`/sdd-design fix-push-untargeted-broadcast` — recommended design depth (full) from triage; see context.md

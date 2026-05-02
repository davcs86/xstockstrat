# Feature: add-ikbr-account-support

**Lifecycle Status**: `in-progress`
**Development Branch**: `feature/add-ikbr-account-support`
**Created**: 2026-05-02
**Last Updated**: 2026-05-02T(sdd-spec)

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-05-02 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-05-02 | `draft` → `spec-ready` | /sdd-story | All open questions resolved |
| 2026-05-02 | `spec-ready` → `draft` | user clarification | Scope revised: multi-account model replaces single-broker-switch |
| 2026-05-02 | `draft` (revision 2) | user follow-ups | Encrypted credential storage + IBKR position sync added |
| 2026-05-02 | `draft` → `spec-ready` | spec-ready audit | Five blocking gaps resolved; all open questions closed |
| 2026-05-02 | `spec-ready` → `implementation-ready` | /sdd-spec | Implementation spec generated with 18 steps |
| 2026-05-02 | `implementation-ready` → `in-progress` | /sdd-execute | Steps 1–2 in progress |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — 18 steps; generated 2026-05-02
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Register multiple broker accounts (Alpaca and/or IBKR) via API with credentials stored AES-256-GCM encrypted in the DB — no env var changes needed to add accounts. Orders route to a specific account via `account_id`. Portfolio tracks positions per account. IBKR positions are periodically reconciled against broker truth via a sync poller. Dev enforces paper-only across all registered accounts.

## Next Action

`/sdd-execute add-ikbr-account-support` — begin executing the 18-step implementation spec

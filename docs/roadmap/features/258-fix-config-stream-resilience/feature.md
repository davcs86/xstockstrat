# Feature: fix-config-stream-resilience

**Type**: bug
**Development Branch**: `feature/fix-config-stream-resilience`
**GitHub Issue**: none (Issues disabled). Defect report: `docs/reports/2026-10-21-config-stream-resilience-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-21
**Last Updated**: 2026-10-21

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-21 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from `docs/reports/2026-10-21-config-stream-resilience-defect.md` (debt-radar D-05, D-06, D-35, D-58) |

---

## Reviewers

Snapshot from `docs/runbooks/reviewer-registry.md` at /sdd-triage time (2026-10-21). `/sdd-spec` overwrites it with per-step assignments.

| Reviewer | Focus | Steps |
|---|---|---|
| `xstockstrat-config` owner | WatchConfig stream stability, environment / global-per-user scoping, secret redaction on every broadcast | TBD (/sdd-spec) |
| `xstockstrat-ledger` owner | Append-only invariant, event ordering | TBD (/sdd-spec) — `appendEvent` idempotent-path `pool.connect` only |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-config-stream-resilience`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Config's LISTEN client has no error/end handling or reconnect (silent platform-wide config freeze), config
`getConfig`/`setConfig` and ledger `appendEvent` await the DB outside `try` (hung RPCs), and `WatchConfig`
registration and broadcast drop or never register subscribers on error without ending their call (stale streams
that never reconnect).

## Next Action

`/sdd-design fix-config-stream-resilience` — recommended design depth: full (2 affected services); see context.md

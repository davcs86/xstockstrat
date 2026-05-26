# Feature: notify-external-fanout

**Lifecycle Status**: `draft`
**Development Branch**: `feature/notify-external-fanout`
**Created**: 2026-05-26
**Last Updated**: 2026-05-26

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-05-26 | `idea` → `draft` | /sdd-story | Product spec generated |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec notify-external-fanout`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Adds HTTP fanout to the notify service so that platform alerts are delivered to Slack and/or email (SendGrid) in addition to the existing Connect-RPC stream, ensuring traders receive time-sensitive signal and fill notifications even when not viewing the UI.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-notify` owner | Stream delivery guarantees, backpressure handling, alert deduplication |
| `xstockstrat-config` owner | Config key naming (`<service>.<category>.<key>`), environment/trading_mode scoping, WatchConfig stream stability |

## Next Action

`/sdd-review notify-external-fanout product-spec` — AI review of product spec before running /sdd-spec

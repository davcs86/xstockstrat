# Feature: notify-external-fanout

**Development Branch**: `feature/notify-external-fanout`
**Created**: 2026-05-26
**Last Updated**: 2026-05-26

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-05-26 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-08-19 | `draft` → `spec-ready` | /sdd-review | Product spec approved after fixing 3 blockers. **Scope reduction accepted by feature owner** (sign-off in context.md): the two vendor credentials (SendGrid key, Slack webhook URL) move from config keys to `type: SECRET` env vars per config governance (feature 076), so credential rotation now requires a redeploy rather than a live config push. Also added the Consumer Surface section and resolved both open questions (credential storage → env var; dedup store → in-memory V1). |

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

`/sdd-design notify-external-fanout` — ground and debate the design (fanout client, in-memory dedup, credential env-var wiring)

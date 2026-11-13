# Feature: notify-commsgun-channel

**Development Branch**: `feature/notify-commsgun-channel`
**Created**: 2026-11-13
**Last Updated**: 2026-11-13

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-13 | `idea` → `draft` | /sdd-story | Product spec generated |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec notify-commsgun-channel`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Adds the homelab `commsgun` email hub (tailnet-only, Resend-backed) as a second email provider for
`xstockstrat-notify`'s external fanout, beside SendGrid. The provider is chosen live from config
(`auto` / `commsgun` / `sendgrid`); commsgun sends go through a durable outbox with retries, and `auto` falls
back to SendGrid once the outbox gives up or when commsgun is not configured.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-notify` owner | Stream delivery guarantees, backpressure handling, alert deduplication |
| `xstockstrat-config` owner | Config key naming (`<service>.<category>.<key>`), environment / global-per-user scoping, secret encryption + redaction, WatchConfig stream stability |
| `xstockstrat-ui` owner | Config mutation safety, no secret values rendered in UI |
| DBA | Migration NNN numbering, up+down pair present, index correctness, run-order compliance with `scripts/db-migrate.sh` |
| Security | Secret encrypted at rest, redacted at every read edge, decryptable only via `GetSecret` gated by the `x-internal-caller` allow-list; new credential wiring follows `docs/patterns/config-governance.md` Rule 6 |

## Next Action

`/sdd-review notify-commsgun-channel product-spec` — AI review of product spec before running /sdd-spec

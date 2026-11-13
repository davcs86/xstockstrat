# Feature: notify-commsgun-channel

**Development Branch**: `feature/notify-commsgun-channel`
**Created**: 2026-11-13
**Last Updated**: 2026-11-13

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-13 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-11-13 | `draft` → `spec-ready` | /sdd-review | Product spec approved (1 warning) |
| 2026-11-13 | `spec-ready` → `design-approved` | /sdd-design | Design debated (5 rounds, full) and approved; recon.md + debate.md + design.md written |
| 2026-11-13 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 22 steps |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Recon](recon.md) — grounded codebase dossier
- [Debate Register](debate.md) — settled decisions, rejected alternatives, objections
- [Design](design.md) — approved architecture
- [Implementation Spec](implementation-spec.md) — 22 numbered steps with codebase evidence
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Adds the homelab `commsgun` email hub (tailnet-only, Resend-backed) as a second email provider for
`xstockstrat-notify`'s external fanout, beside SendGrid. The provider is chosen live from config
(`auto` / `commsgun` / `sendgrid`); commsgun sends go through a durable outbox with retries, and `auto` falls
back to SendGrid once the outbox gives up or when commsgun is not configured.

## Reviewers

_(Snapshot finalized by /sdd-spec on 2026-11-13 from docs/runbooks/reviewer-registry.md and the
per-step `**Reviewers**` lines. Re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-notify` owner | Stream delivery guarantees, backpressure handling, alert deduplication |
| `xstockstrat-config` owner | Config key naming (`<service>.<category>.<key>`), environment / global-per-user scoping, secret encryption + redaction, WatchConfig stream stability |
| `xstockstrat-ui` owner | Config mutation safety, no secret values rendered in UI |
| `xstockstrat-indicators` owner | The hand-copied `SECRET_KEYS` mirror in `app/maintenance/config_inventory.py` stays in sync with the config allow-list (Steps 3–4) |
| DBA | Migration NNN numbering, up+down pair present, CHECK and index correctness, run-order compliance with `scripts/db-migrate.sh` |
| Security | Secret encrypted at rest, redacted at every read edge, decryptable only via `GetSecret` gated by the `x-internal-caller` allow-list and the peer SAN; no key, recipient, subject, body or URL in a log, alert or stored error; new credential wiring follows `docs/patterns/config-governance.md` Rule 6 |

## Next Action

`/sdd-review notify-commsgun-channel impl-spec` — validate implementation spec, then `/sdd-execute notify-commsgun-channel`

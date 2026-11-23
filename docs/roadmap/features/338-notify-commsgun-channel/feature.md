# Feature: notify-commsgun-channel

**Development Branch**: `feature/notify-commsgun-channel`
**Created**: 2026-11-13
**Last Updated**: 2026-11-13
**Committed to main**: 6936191e738e267c5507f042b22bc3e785fe9419
**Launched date**: 2026-11-15
**Archived**: 2026-11-18

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-13 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-11-13 | `draft` → `spec-ready` | /sdd-review | Product spec approved (1 warning) |
| 2026-11-13 | `spec-ready` → `design-approved` | /sdd-design | Design debated (5 rounds, full) and approved; recon.md + debate.md + design.md written |
| 2026-11-13 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 22 steps |
| 2026-11-13 | `implementation-ready` → `in-progress` | /sdd-execute | Steps 1+2 done (sequential mode on the session branch) |
| 2026-11-13 | `in-progress` → `code-completed` | /sdd-execute | All 22 steps done (sequential mode); integration PR #1537 |

| 2026-11-15 | `code-completed` → `launched` | CI workflow | Promoted via PR #1546; committed 6936191e738e267c5507f042b22bc3e785fe9419 |
| 2026-11-18 | `launched` | /sdd-archiver | Archived: synthesis → context.md + Ledger insights(4)/fails(1); pruned 5 specs |
---

## Artifacts

- Product Spec — pruned by /sdd-archiver; see [Context Log](context.md) Archive Synthesis
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15); promoted to services/xstockstrat-config/acceptance/notify-commsgun-channel.feature, services/xstockstrat-notify/acceptance/notify-commsgun-channel.feature, services/xstockstrat-ui/acceptance/notify-commsgun-channel.feature (C-16)
- Recon — pruned by /sdd-archiver; see [Context Log](context.md) Archive Synthesis
- Debate Register — pruned by /sdd-archiver; see [Context Log](context.md) Archive Synthesis
- Design — pruned by /sdd-archiver; see [Context Log](context.md) Archive Synthesis
- Implementation Spec — pruned by /sdd-archiver; see [Context Log](context.md) Archive Synthesis
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

Merge PR #1537 into `main-dev` when CI passes and reviewers approve; then the first homelab staging deploy check listed in `context.md` § Open Threads.

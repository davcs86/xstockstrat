# Feature: pwa-notifications

**Development Branch**: `feature/pwa-notifications`
**Created**: 2026-08-29
**Last Updated**: 2026-08-29

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-29 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-08-29 | `draft` → `design-approved` | /sdd-design | Design debated (2 rounds, quick upgraded to full) and approved; recon.md + design.md written |
| 2026-08-29 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 12 steps |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Recon](recon.md) — grounded codebase dossier (sdd-design Phase 0)
- [Design](design.md) — debated, approved architecture (sdd-design Phase 1)
- [Implementation Spec](implementation-spec.md) — 12 numbered steps with codebase evidence (sdd-spec)
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Turn `xstockstrat-ui` into an installable PWA (web app manifest + service worker + icons) and add a
true Web Push channel so installed users receive OS-level notifications for alerts even when the app
or browser is closed — delivered by a new best-effort push fanout channel in `xstockstrat-notify`,
gated on VAPID keys the same way Slack/SendGrid fanout is gated on its credentials.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-notify` (service owner) | Stream delivery guarantees, backpressure handling, alert deduplication; best-effort side-channel isolation (never blocks `EmitAlert`); dead-subscription pruning on 404/410 |
| `xstockstrat-ui` (service owner) | Trading UI correctness, Connect-RPC/BFF call safety, no secret values rendered in UI (VAPID **public** key only in browser), environment scope correctness |
| `xstockstrat-config` (service owner) | Config key naming (`notify.push.*`), config-service migration for the seed (not notify's own migrations) |
| Proto Reviewer | Additive-only RPCs/messages, field-number uniqueness, `buf breaking` passes against dev trunk |
| DBA | `notify` schema migration for `push_subscriptions` — NNN numbering, up+down pair |
| Security | VAPID private key wired as a `type: SECRET` env var through the full deploy pipeline (never a config row); push subscription endpoints scoped per authenticated user |
| Platform Lead | No new service/port; deploy-pipeline secret wiring completeness |

## Next Action

`/sdd-review pwa-notifications impl-spec` — validate implementation spec, then `/sdd-execute pwa-notifications`

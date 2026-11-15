# Product Spec: alert-detail-page

**Created**: 2026-11-15

---

## Problem Statement

There is no view of a single alert. The Notifications list and the header drawer show only severity, category, title and body; the alert's source service, context fields and correlation ID are never shown, and nothing can link to one alert. Backfill-failure alerts also carry a raw stringified gRPC exception as their body.

## User Story

As a trader, I want to open any alert on its own page and see all of its details, so that I can understand what happened and share or return to it.

## Functional Requirements

FR-1. Each alert has a dedicated page at a stable URL containing its alert ID.
FR-2. The page shows the alert's severity, category, source service, created time, title, full body, read state, correlation ID, and every context field.
FR-3. A user can open only alerts visible to them (targeted at them, or broadcast); any other alert ID shows "Alert not found".
FR-4. Each row in the Notifications list and in the header Alerts drawer links to that alert's page.
FR-5. Opening the page marks the alert read for that user.
FR-6. Activating a push notification opens that alert's page.
FR-7. A backfill-failure alert's body states the failure in plain language (status and message); the raw exception text is kept only in the alert's context.

## Out of Scope

- Alert search, filtering or pagination changes on the Notifications list
- Acknowledge/resolve workflow changes
- Rewriting alert bodies emitted by services other than ingest's backfill path
- An agent tool for reading alerts

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-notify` — get-one-alert RPC with per-user visibility
- `xstockstrat-ui` — alert page, links from list and drawer, push deep link, BFF handler
- `xstockstrat-ingest` — backfill-failure alert body

## Consumer Surface(s)

_Constitution **C-14**._

- [x] **UI** — `xstockstrat-ui`: new page under `/accounts/notifications/<alert_id>` (child of the existing Notifications route, reached from list rows, drawer rows and push); links added to the Notifications list and the header Alerts drawer
- [ ] **Agent**
- [ ] **None**

## Proto Contract Changes

- New RPC `notify.v1.NotifyService/GetAlert` (request: `alert_id`; response: `Alert`) — additive, non-breaking
- No change to `message Alert` expected (it already carries `source_service`, `context`, `correlation_id`, `read`, `read_at`); confirm in design

## Config Key Changes

- [x] No new config keys

## Database Changes

- [ ] No schema changes — expected (alerts and reads are already persisted); confirm in design

## Feature Workflow Notes

Branch to create: `feature/alert-detail-page` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking proto or config change)
- [ ] 2 service owners + platform lead (breaking proto change)
- [ ] DBA review + service owner (schema migration)

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

- [ ] FR-5 (auto mark-read on open) is my proposal, not an operator decision — confirm before design approval.
- [ ] FR-6 depends on what the push payload carries today (alert ID / URL); design must check the service worker and notify's push fan-out.
- [ ] Whether the page belongs under `/accounts/notifications/` or the trader segment, and whether a child route needs a `PLATFORM_SUBNAV` entry (C-10).
- [ ] FR-7: which error fields are safe to show (gRPC status code + details) and whether the job row / ledger event keep the raw string.
- [ ] Dependency: 339-fix-symbol-page-alerts-ui changes the same drawer (`AlertStream.tsx`); order 339 first or record it in merge-order.md.
- Known trap (ledger, `strategy-creation-flow`): BFF dispatch can collapse backend errors to a generic "HTTP 400" — verify NOT_FOUND from `GetAlert` reaches the page as "Alert not found".

# Product Spec: notify-external-fanout

**Created**: 2026-05-26

---

## Problem Statement

The notify service currently delivers alerts exclusively to Connect-RPC streaming clients (the three Next.js frontends). Signals fire and fills confirm during market hours (9:30am–4pm ET); if the trader is not actively watching the UI, these events are missed. There is no fallback delivery channel.

## User Story

As a trader, I want platform alerts to be sent to my Slack workspace and/or email so that I never miss a signal fire or fill confirmation when I'm away from the trading UI.

## Functional Requirements

FR-1. When the notify service emits an alert whose confidence score meets or exceeds a configurable threshold, it must also POST to a Slack incoming webhook URL (if configured).
FR-2. When the notify service emits an alert whose confidence score meets or exceeds a configurable threshold, it must also send an email via SendGrid (if configured).
FR-3. Each fanout channel (Slack, email) is independently optional — configuring one does not require the other.
FR-4. Channels are enabled/disabled and configured via config service keys, with no service redeploy required.
FR-5. Alert payload delivered to external channels must include: symbol, signal source, confidence score, recommended action, and timestamp (ISO 8601).
FR-6. Fanout failures (Slack webhook down, SendGrid API error) must be logged but must not affect the primary Connect-RPC alert stream.
FR-7. Alert deduplication: an alert already delivered within the last N seconds (configurable) must not be re-sent to external channels on reconnect or replay.

## Out of Scope

- Push notifications (mobile/browser) — separate feature
- PagerDuty or SMS channels — can be added as a follow-on
- Per-alert-type channel routing (all alert types use the same fanout config in V1)
- Alert history UI or delivery receipts in the trader frontend

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-notify` — primary change: HTTP fanout clients added to alert emission path
- `xstockstrat-config` — new config keys registered for Slack URL, SendGrid credentials, threshold, dedup window

## Proto Contract Changes

- [ ] No proto changes required

## Config Key Changes

- `notify.fanout.slack_webhook_url` — Slack incoming webhook URL (empty = disabled)
- `notify.fanout.sendgrid_api_key` — SendGrid API key (secret key, use `secret.*` prefix → `notify.fanout.secret.sendgrid_api_key`)
- `notify.fanout.sendgrid_from_email` — sender address for outbound email
- `notify.fanout.sendgrid_to_email` — recipient address
- `notify.fanout.min_confidence_threshold` — float 0.0–1.0; alerts below this are not fanned out (default: 0.7)
- `notify.fanout.dedup_window_seconds` — integer; suppress re-delivery of the same alert within this window (default: 300)

## Database Changes

- [ ] No schema changes

## Feature Workflow Notes

Branch to create: `feature/notify-external-fanout` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking config change, no proto changes)
- [ ] 2 service owners + platform lead (breaking proto change) — not applicable
- [ ] DBA review + service owner (schema migration) — not applicable

## Acceptance Criteria

1. Configuring `notify.fanout.slack_webhook_url` via the config service causes the next alert above the threshold to appear in the target Slack channel within 5 seconds.
2. Configuring SendGrid keys causes the next qualifying alert to arrive as an email with all required fields (symbol, source, confidence, action, timestamp).
3. Clearing both config keys disables fanout with no restart; existing Connect-RPC stream continues unaffected.
4. A simulated Slack webhook timeout does not delay or drop the Connect-RPC alert delivery.
5. The same alert fired twice within `dedup_window_seconds` is delivered to external channels only once.
6. All fanout errors are logged at WARN level with the alert ID and channel name.

## Open Questions

- [ ] Should `sendgrid_api_key` be stored as a `secret.*` config key (encrypted at rest in config service) or injected as an env var? Prefer secret config key to allow runtime rotation without redeploy.
- [ ] Should the dedup window use an in-memory map (lost on restart) or a Redis/DB-backed store? In-memory is sufficient for V1 given low alert volume.

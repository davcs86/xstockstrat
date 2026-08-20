# Product Spec: notify-external-fanout

**Created**: 2026-05-26

---

## Problem Statement

The notify service currently delivers alerts exclusively to Connect-RPC streaming clients (the three Next.js frontends). Signals fire and fills confirm during market hours (9:30am–4pm ET); if the trader is not actively watching the UI, these events are missed. There is no fallback delivery channel.

## User Story

As a trader, I want platform alerts to be sent to my Slack workspace and/or email so that I never miss a signal fire or fill confirmation when I'm away from the trading UI.

## Functional Requirements

FR-1. When the notify service emits an alert that passes the **fanout gate**, it must also POST to a Slack incoming webhook URL (if configured). The gate is **hybrid**: the alert's `severity` must meet or exceed a configurable ordinal floor (`notify.fanout.min_severity`, default `2` = `WARNING`), AND — only when the alert carries a conviction/readiness value in its `context` (set today solely by the analysis live-loop) — that value must also meet or exceed `notify.fanout.min_confidence_threshold`. When no conviction value is present, the severity floor alone decides (the gate does not fail closed); a non-numeric conviction falls back to severity-only.
FR-2. Under the same hybrid fanout gate as FR-1, the notify service must also send an email via SendGrid (if configured).
FR-3. Each fanout channel (Slack, email) is independently optional — configuring one does not require the other.
FR-4. **Non-credential** channel settings (confidence threshold, dedup window, sender/recipient email addresses) are configured via config service keys and take effect at runtime with no service redeploy. The **vendor credentials** — the Slack incoming webhook URL and the SendGrid API key — are delivered as `type: SECRET` env vars (per root CLAUDE.md § Config Governance: a vendor API credential is never a config key — the `secret.*` mechanism was reversed by feature 076). A channel is **enabled iff its credential env var is set and non-empty**; rotating a credential therefore requires a redeploy (the standard vendor-credential lifecycle), while enabling/disabling and tuning a channel's non-credential behavior stays runtime-config-driven.
FR-5. Alert payload delivered to external channels must include: symbol (when present in `context`), signal source (`source_service`), severity, conviction/readiness (when present in `context`), the alert title/body (recommended action), and timestamp (ISO 8601, from `created_at`). No field is claimed that producers do not set (there is no first-class numeric "confidence" on the Alert proto — the payload carries `severity` plus `conviction` when the analysis loop supplied it).
FR-6. Fanout failures (Slack webhook down, SendGrid API error) must be logged but must not affect the primary Connect-RPC alert stream.
FR-7. Alert deduplication: an alert already delivered within the last N seconds (configurable) must not be re-sent to external channels on reconnect or replay.

## Out of Scope

- Push notifications (mobile/browser) — separate feature
- PagerDuty or SMS channels — can be added as a follow-on
- Per-alert-type channel routing (all alert types use the same fanout config in V1)
- Alert history UI or delivery receipts in the trader frontend

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-notify` — primary change: HTTP fanout clients added to alert emission path; reads the Slack/SendGrid credential env vars and the `notify.fanout.*` config keys
- `xstockstrat-config` — new **non-credential** config keys registered (threshold, dedup window, sender/recipient email); the two vendor credentials are NOT config keys (see Env Var Changes)

## Consumer Surface(s)

- [ ] **UI** — none. The `notify.fanout.*` config keys surface in the existing `/config-ui` segment (which already renders whatever config keys exist — no new page/route/control), and the fanout targets are external Slack/SendGrid endpoints, not a platform UI.
- [ ] **Agent** — none (no MCP tool added or changed).
- [x] **None / platform-internal** — backend behavior change only: alerts newly fan out to external Slack/email side-channels. Operators manage the non-credential knobs through the existing config-ui surface and set the credential secrets through the deploy pipeline.

## Proto Contract Changes

- [ ] No proto changes required

## Config Key Changes

Runtime, non-credential settings only (served via `WatchConfig`):

- `notify.fanout.sendgrid_from_email` — sender address for outbound email
- `notify.fanout.sendgrid_to_email` — recipient address
- `notify.fanout.min_severity` — integer `0`–`4` mapping to the `AlertSeverity` enum (`UNSPECIFIED`=0 … `WARNING`=2 … `CRITICAL`=4); alerts whose severity ordinal is below this are not fanned out (default: `2` = `WARNING`). **Consequence:** at the default, `INFO`-severity fill confirmations are excluded — an operator who wants fills fanned out lowers this to `1`. Clamped to `[0,4]` at read.
- `notify.fanout.min_confidence_threshold` — float 0.0–1.0; the **analysis readiness-ordinal floor** (fraction of passing entry-condition leaves — NOT a probability), applied only when the alert's `context` carries a conviction/readiness value; alerts with a present-but-below value are not fanned out (default: 0.7). Alerts with no conviction value are governed by `min_severity` alone.
- `notify.fanout.dedup_window_seconds` — integer; suppress re-delivery of the same alert within this window (default: 300)

> The two vendor credentials that were originally drafted as config keys
> (`notify.fanout.slack_webhook_url`, `notify.fanout.sendgrid_api_key`) have been **removed from
> config** and moved to `type: SECRET` env vars (see Env Var Changes). This is required by config
> governance (a vendor credential is never a config key; the `secret.*` prefix was reversed by
> feature 076) and was accepted as a scope reduction by the feature owner on 2026-08-19 — see
> context.md. Consequence: credential rotation now requires a redeploy rather than a live config push.

## Env Var Changes

Two `type: SECRET` env vars, wired through the deploy pipeline per
`docs/runbooks/add-data-source.md` § "Wiring a New Vendor Credential Through Deploy" (the same
mechanism used for every other vendor credential). Both live on the `xstockstrat-notify` service
block in `docker-compose.yml`, `.do/app.yaml`, and `.do/app.dev.yaml`:

- `SLACK_WEBHOOK_URL` (`type: SECRET`) — Slack incoming webhook URL. Unset/empty ⇒ the Slack channel is disabled.
- `SENDGRID_API_KEY` (`type: SECRET`) — SendGrid API key. Unset/empty ⇒ the email channel is disabled.

> **Implemented (feature 020, Step 6):** both credentials are wired through the **full** eight-file
> pipeline surface — `docker-compose.yml`, `.do/app.yaml`, `.do/app.dev.yaml`, the four deploy
> workflows (`deploy.yml`/`deploy-dev.yml`/`deploy-prod.yml`/`prod-up.yml`), and
> `scripts/do-inject-prod-secrets.py` — not just the three `.do`/compose specs (the
> config-governance feature-129 defect of wiring "only 3 of 8" is avoided).

## Database Changes

- [ ] No schema changes

## Feature Workflow Notes

Branch to create: `feature/notify-external-fanout` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking config change, no proto changes)
- [ ] 2 service owners + platform lead (breaking proto change) — not applicable
- [ ] DBA review + service owner (schema migration) — not applicable

## Acceptance Criteria

The acceptance scenarios are the single source of acceptance truth and live as Gherkin in
[`acceptance.feature`](acceptance.feature) (Constitution **C-15**): `@AC-1..@AC-9`, each tagged with
the `@FR-*` it exercises and traced to a test step at `/sdd-spec`. They cover the hybrid fanout gate
(severity floor, conviction floor when present, severity-only when conviction is absent), Slack/email
delivery with all required fields, credential-driven enable/disable with live config knobs,
stream-isolation under a webhook timeout, dedup within the window, and WARN-level error logging.

## Open Questions

- [x] **Credential storage — RESOLVED (2026-08-19, feature owner sign-off):** `SENDGRID_API_KEY` and `SLACK_WEBHOOK_URL` are `type: SECRET` env vars, NOT config keys. Config governance forbids a vendor credential as a config key (the `secret.*` mechanism was reversed by feature 076), so the "runtime rotation without redeploy" preference is not attainable for these credentials. This is a deliberate, signed-off scope reduction (credential rotation → redeploy); see context.md and the Env Var Changes / FR-4 sections.
- [x] **Dedup store — RESOLVED:** in-memory map for V1 (lost on restart), sufficient given low alert volume. This keeps the "No schema changes" DB claim valid. A Redis/DB-backed store is an explicit follow-on if dedup must survive restarts.

# Debate Register: notify-commsgun-channel

**State**: in-debate
**Mode**: full
**Rounds run**: 1

## Rounds

| Round | Date | Run by | +D | +R | O closed | +O | Petitions | Progress |
|---|---|---|---|---|---|---|---|---|
| 1 | 2026-11-13 | /sdd-design | 9 | 4 | 0 | 10 | 0 | yes |

## Settled Decisions

<!-- Status: settled → superseded by D-m (only after a user-approved REOPEN) -->
| ID | Round | Decision | Evidence | Status |
|---|---|---|---|---|
| D-1 | 1 | Dedicated table `notify.email_outbox` + new `CommsgunWorker` modelled on `WebhookWorker`; `WebhookWorker` and `webhook_deliveries` unchanged except exporting `networkErrorClass` | `services/xstockstrat-notify/src/fanout/webhookWorker.ts:40`, `:54`, `:66-281`; `migrations/004_webhook_deliveries.up.sql:5-21` | settled |
| D-2 | 1 | A row stores the rendered subject, text and recipient frozen at insert, keyed `alert_id UNIQUE`; each attempt serialises the same body in fixed key order with `Idempotency-Key: alert:<alert_id>`; app key and URL are never stored | product-spec FR-5, FR-9, FR-11 | settled |
| D-3 | 1 | One pure `renderEmail(payload)` extracted from `sendSendgrid` is the single renderer for both providers | `services/xstockstrat-notify/src/fanout/fanout.ts:160-205` | settled |
| D-4 | 1 | Provider selection and the outbox insert live in the email branch of `FanoutDispatcher.dispatch`, after the unchanged gates, dedup and Slack; an alert with category `commsgun` skips the email branch entirely (the only exclusion point) | `fanout.ts:62-92`, `:109-114`; `src/grpc/notifyServiceImpl.ts:72`, `:139-151` | settled |
| D-5 | 1 | Fallback is at-most-once: one terminal `UPDATE … WHERE state='pending'` decides the fallback; side effects run only when `rowCount = 1`; no send-then-update | SendGrid has no idempotency key; `webhookWorker.ts:249-254` | settled |
| D-6 | 1 | Secret resolver is its own module with its own `ConfigServiceClient` (`x-internal-caller: notify`, deadline, injectable client); `configWatcher.ts` is not edited; `found=false` and boot-time errors mean "not configured", a later failed refresh keeps the last good value | `src/services/adminDirectory.ts:30-51`; `src/services/configWatcher.ts:1-4` | settled |
| D-7 | 1 | Retry classes: 2xx delivered (body not parsed); 429, 5xx, timeout, network error retried; 401/403/409/413/422, any other status and 3xx permanent; `last_error` holds a class string only | product-spec FR-6, FR-11; `webhookWorker.ts:14`, `:211` | settled |
| D-8 | 1 | Config side: one seed migration (8 plain keys × 2 environments, `commsgun.app_id` seeded per environment, plus a value-less secret row per environment), exact-key SAN-pinned `notify` grant, mirrors and docs updated, `config-wiring-stored.json` regenerated | `services/xstockstrat-config/migrations/048_webhook_fanout_callback_keys.up.sql:4-43`, `017_config_secrets_and_scoping.up.sql:106-121`; `src/grpc/authz.ts:136-149`; product-spec FR-12 | settled |
| D-9 | 1 | Consumer-surface proof is two-part: CI `config-wiring-stored` applies the real migration; a Playwright spec on extended `CONFIG_KEY_FIXTURES` proves list, `[secret]`, save and reload | `.github/workflows/ci.yml:1248-1293`; `services/xstockstrat-ui/e2e/fixtures/configKeys.ts:55`, `:175` | settled |

## Rejected Alternatives (locked)

<!-- Status: locked → reopened @ round N (user, context.md <ISO>) -->
| ID | Round | Alternative | Why rejected | Status |
|---|---|---|---|---|
| R-1 | 1 | Generalise `notify.webhook_deliveries` / `WebhookWorker` to carry email rows | Changes a documented contract and its requeue SQL (notify `CLAUDE.md` § Outbound webhooks; `004:12`); recipient/fallback columns do not belong there; would put 334's `@AC-9`..`@AC-14` at risk (C-16) | locked |
| R-2 | 1 | Extract a shared retry-worker base class from `WebhookWorker` | Rewrites a launched worker and its tests to save ~30 lines of tick code (C-18 YAGNI); revisit only if `jscpd` flags the duplication | locked |
| R-3 | 1 | Store only the alert id and re-render per attempt | Body would depend on live config and the alerts row, breaking FR-5 byte-identical retries | locked |
| R-4 | 1 | `fallback_pending` state with send-then-update (at-least-once fallback) | A crash between the SendGrid POST and the update duplicates the email; SendGrid has no idempotency key; violates FR-1 "at most one" | locked |

## Objections

<!-- Status: open → closed @ round N (<how>) | waived @ round N (user) | reopened @ round N (user) -->
| ID | Round | Objection | Blocking | Status |
|---|---|---|---|---|
| O-1 | 1 | Refreshing the secret on every watcher `'update'` fires every ~10 s (config re-sends on each liveness tick: `services/xstockstrat-config/src/grpc/configServiceImpl.ts:197`, `:283-298`; `configWatcher.ts:97-107`). Fix: refresh only when the snapshot `version` changes, and on the next update after a failed resolve (P-03, ledger 140) | yes | open |
| O-2 | 1 | `commsgun` mode while unconfigured: dispatch records only a `disabled` metric and the worker skips rows forever — silent loss, never escalates; the spec does not define this case and the proposal guessed (P-03, ledger 140, FR-8). Needs an operator decision | yes | open |
| O-3 | 1 | Pending rows drained to SendGrid after a mode/config change end with no escalation and are indistinguishable from a commsgun failure that fell back; contradicts FR-8 as written and needs an operator decision plus an explicit end reason (P-03, FR-7/FR-8) | yes | open |
| O-4 | 1 | A failed outbox INSERT is lost silently (dedup already consumed, `fanout.ts:88-92`, catch `:115-117`). Fix: in `auto` fall through to SendGrid; otherwise a distinct `commsgun`/`error` outcome | no | open |
| O-5 | 1 | Crash after the terminal UPDATE leaves `fallback='sendgrid'` with no email and no alert. Fix: raise the escalation alert before the SendGrid POST; record `fallback_sent_at` after it | no | open |
| O-6 | 1 | Terminal rows keep recipient, subject and body forever (product-spec § Database Changes: nothing beyond what delivery needs). Fix: blank them in the terminal UPDATE; the worker renders the fallback from the row it already holds | no | open |
| O-7 | 1 | New 86400 s `Retry-After` cap constant (near F-07, C-18). Fix: clamp `Retry-After` to `commsgun.backoff_max_seconds` | no | open |
| O-8 | 1 | Optional `commsgun?` ctor arg lets a missed wire-up fail silently, and the worker depending on `FanoutDispatcher` for SendGrid creates a two-way surface (C-18). Fix: extract a small `SendgridSender` used by both; make the commsgun dependency required and update the five call sites | no | open |
| O-9 | 1 | `EmitAlert` is ungated, so any producer sending category `commsgun` opts out of email. Fix: exclude only when `sourceService` is also `xstockstrat-notify`, or document the category as reserved | no | open |
| O-10 | 1 | FR-12 (operator steer, mid-round): the design must show per-environment resolution of app id and app key end to end (environment passed to `GetSecret`, per-environment seed) | no | open |

## Reopen Petitions

<!-- Verdict: dropped (evidence not new — already on record at <ID>) | pending user | user reopened | user declined -->
| ID | Round | Target | New evidence | Verdict |
|---|---|---|---|---|

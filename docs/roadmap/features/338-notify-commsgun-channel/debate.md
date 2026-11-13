# Debate Register: notify-commsgun-channel

**State**: in-debate
**Mode**: full
**Rounds run**: 2

## Rounds

| Round | Date | Run by | +D | +R | O closed | +O | Petitions | Progress |
|---|---|---|---|---|---|---|---|---|
| 1 | 2026-11-13 | /sdd-design | 9 | 4 | 0 | 10 | 0 | yes |
| 2 | 2026-11-13 | /sdd-design | 14 | 1 | 9 | 9 | 0 | yes |

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
| D-10 | 2 | Configuration predicates in one module `src/fanout/emailProvider.ts`: `commsgunBase` = enqueue URL, app id and recipient all non-empty. `auto` is *ready* only with `commsgunBase` and a resolved key; `commsgun` mode queues on `commsgunBase` alone and checks the key per attempt (a missing key is a retryable attempt, class `no_app_key`) | context.md round-1 gate steers; product-spec FR-3 | settled |
| D-11 | 2 | Secret state is three-valued — `key` / `absent` (resolved, `found=false`) / `unknown` (never resolved successfully). Dispatch treats `unknown` as not ready (AC-19); the worker skips its tick on `unknown` in `auto` — no attempt and no reroute — so a transient boot `GetSecret` error cannot drain the outbox. A later failed refresh keeps the last resolved state | D-6; acceptance AC-6; `services/xstockstrat-config/src/grpc/configServiceImpl.ts:643-657` | settled |
| D-12 | 2 | Secret refresh is version-gated: resolve when the snapshot `version` differs from the last successfully resolved one, or after a failed resolve; an update arriving mid-resolve sets a dirty flag and triggers exactly one follow-up resolve; `lastVersion` is stored only after success | `configServiceImpl.ts:197`, `:205-214`, `:283-298`; `services/xstockstrat-notify/src/services/configWatcher.ts:97-107` | settled |
| D-13 | 2 | Table: states `pending` / `delivered` / `undelivered` / `rerouted`; `fallback` ∈ `none`,`sendgrid` set on the two non-delivered terminal states; recipient, subject and body are NULLed by every terminal UPDATE and a CHECK enforces "content present iff pending"; `fallback_sent_at` (diagnostic, set only after SendGrid answers `sent`) and `escalated_at` (set after the alert is raised) | product-spec § Database Changes; D-2 | settled |
| D-14 | 2 | Worker route is read once per tick: `attempt` (mode `commsgun`, or `auto` ready), `reroute_deliberate` (mode `sendgrid`), `reroute_lost` (`auto`, base lost or key `absent`), `hold` (`auto`, key `unknown`). Reroute ends rows `rerouted` and sends once via SendGrid if enabled; rows drain at the worker's normal concurrency and take the in-flight claim. A row reaching its terminal step while the mode is `sendgrid` takes the deliberate-reroute path | context.md round-1 gate steers; `services/xstockstrat-notify/src/fanout/webhookWorker.ts:13`, `:61` | settled |
| D-15 | 2 | Order after the terminal UPDATE (only when `rowCount = 1`): metric → WARN log → escalation alert → set `escalated_at` → SendGrid once → set `fallback_sent_at`. Each tick first re-raises the alert for terminal rows that should have escalated and have `escalated_at IS NULL` (alerts are at-least-once; email stays at-most-once, D-5) | `webhookWorker.ts:257-281`; `src/grpc/notifyServiceImpl.ts:72-73` | settled |
| D-16 | 2 | Alerts: every `undelivered` row escalates (operator decision); `reroute_lost` and "pinned to `commsgun` without `commsgunBase`" raise one alert per incident via two in-memory latches on the worker (cleared when the condition ends; not persisted) | context.md round-1 gate steers | settled |
| D-17 | 2 | `Retry-After` is honoured and clamped to `commsgun.backoff_max_seconds`: delay = `min(max(backoff, Retry-After), backoff_max_seconds)`; no new constant | product-spec FR-6; F-07 | settled |
| D-18 | 2 | Modules: `emailRender.ts`, `sendgridSender.ts` (`SendgridSender`: today's SendGrid POST unchanged), `emailProvider.ts`, `commsgunClient.ts`, `commsgunWorker.ts` (owns `enqueue`, `noteUnconfigured`, latches), `services/commsgunSecret.ts`. `FanoutDispatcher(config, sendgrid, commsgun)` — all required; the five call sites are updated in the same atomic steps | `src/index.ts:42`; `src/__tests__/fanout.test.ts:33`; `src/__tests__/notifyServiceImpl.test.ts:345`, `:396`; `src/__tests__/deliveryChannelsLog.test.ts:46` | settled |
| D-19 | 2 | A failed outbox insert: in `auto`, metric `enqueue_error` + WARN, then SendGrid once; in `commsgun` mode metric + WARN only (an alert would fail on the same DB) | `src/fanout/fanout.ts:88-92`, `:115-117`; `notifyServiceImpl.ts:82` | settled |
| D-20 | 2 | Telemetry: channel `commsgun`; outcomes `queued`, `enqueue_error`, `unconfigured`, `no_app_key`, `rerouted`, and the existing `dead` for an undelivered row; per-attempt `sent` / `http_error` / `timeout` / `error`. Logs carry alert id, outbox id, attempts and error class only | `src/telemetry.ts:358-372` | settled |
| D-21 | 2 | Startup delivery-channels log derives `commsgun` from the worker route at boot (`attempt` = enabled); the pinned `index.ts` line and expected strings in `deliveryChannelsLog.test.ts` are updated in the same step | `src/__tests__/deliveryChannelsLog.test.ts:61-62`, `:71-73` | settled |
| D-22 | 2 | Per-environment resolution (FR-12): `GetSecret` is called with the environment mapped exactly as the watcher maps it; `app_id` comes from the environment-scoped watcher and is seeded per environment; a test pins the environment argument | `configWatcher.ts:81-90`; `packages/proto/config/v1/config.proto:110-120` | settled |
| D-23 | 2 | Runbook rule for key rotation: set the new key in config first, then retire the old one on the edge — a 401 is permanent and escalates every row sent in between | D-7 | settled |

## Rejected Alternatives (locked)

<!-- Status: locked → reopened @ round N (user, context.md <ISO>) -->
| ID | Round | Alternative | Why rejected | Status |
|---|---|---|---|---|
| R-1 | 1 | Generalise `notify.webhook_deliveries` / `WebhookWorker` to carry email rows | Changes a documented contract and its requeue SQL (notify `CLAUDE.md` § Outbound webhooks; `004:12`); recipient/fallback columns do not belong there; would put 334's `@AC-9`..`@AC-14` at risk (C-16) | locked |
| R-2 | 1 | Extract a shared retry-worker base class from `WebhookWorker` | Rewrites a launched worker and its tests to save ~30 lines of tick code (C-18 YAGNI); revisit only if `jscpd` flags the duplication | locked |
| R-3 | 1 | Store only the alert id and re-render per attempt | Body would depend on live config and the alerts row, breaking FR-5 byte-identical retries | locked |
| R-4 | 1 | `fallback_pending` state with send-then-update (at-least-once fallback) | A crash between the SendGrid POST and the update duplicates the email; SendGrid has no idempotency key; violates FR-1 "at most one" | locked |
| R-5 | 2 | Two-valued secret state (key or empty), with a boot `GetSecret` error meaning "not configured" for the worker too | One transient config outage at restart would reroute every pending row to SendGrid and break AC-6 / FR-4 (ledger 140) | locked |

## Objections

<!-- Status: open → closed @ round N (<how>) | waived @ round N (user) | reopened @ round N (user) -->
| ID | Round | Objection | Blocking | Status |
|---|---|---|---|---|
| O-1 | 1 | Refreshing the secret on every watcher `'update'` fires every ~10 s (config re-sends on each liveness tick: `services/xstockstrat-config/src/grpc/configServiceImpl.ts:197`, `:283-298`; `configWatcher.ts:97-107`). Fix: refresh only when the snapshot `version` changes, and on the next update after a failed resolve (P-03, ledger 140) | yes | closed @ round 2 (D-12) |
| O-2 | 1 | `commsgun` mode while unconfigured: dispatch records only a `disabled` metric and the worker skips rows forever — silent loss, never escalates; the spec does not define this case and the proposal guessed (P-03, ledger 140, FR-8). Needs an operator decision | yes | closed @ round 2 (operator steer; D-10, D-16) |
| O-3 | 1 | Pending rows drained to SendGrid after a mode/config change end with no escalation and are indistinguishable from a commsgun failure that fell back; contradicts FR-8 as written and needs an operator decision plus an explicit end reason (P-03, FR-7/FR-8) | yes | closed @ round 2 (operator steer; D-13, D-14, D-16) |
| O-4 | 1 | A failed outbox INSERT is lost silently (dedup already consumed, `fanout.ts:88-92`, catch `:115-117`). Fix: in `auto` fall through to SendGrid; otherwise a distinct `commsgun`/`error` outcome | no | closed @ round 2 (D-19) |
| O-5 | 1 | Crash after the terminal UPDATE leaves `fallback='sendgrid'` with no email and no alert. Fix: raise the escalation alert before the SendGrid POST; record `fallback_sent_at` after it | no | closed @ round 2 (D-15) |
| O-6 | 1 | Terminal rows keep recipient, subject and body forever (product-spec § Database Changes: nothing beyond what delivery needs). Fix: blank them in the terminal UPDATE; the worker renders the fallback from the row it already holds | no | closed @ round 2 (D-13) |
| O-7 | 1 | New 86400 s `Retry-After` cap constant (near F-07, C-18). Fix: clamp `Retry-After` to `commsgun.backoff_max_seconds` | no | closed @ round 2 (D-17) |
| O-8 | 1 | Optional `commsgun?` ctor arg lets a missed wire-up fail silently, and the worker depending on `FanoutDispatcher` for SendGrid creates a two-way surface (C-18). Fix: extract a small `SendgridSender` used by both; make the commsgun dependency required and update the five call sites | no | closed @ round 2 (D-18) |
| O-9 | 1 | `EmitAlert` is ungated, so any producer sending category `commsgun` opts out of email. Fix: exclude only when `sourceService` is also `xstockstrat-notify`, or document the category as reserved | no | open |
| O-10 | 1 | FR-12 (operator steer, mid-round): the design must show per-environment resolution of app id and app key end to end (environment passed to `GetSecret`, per-environment seed) | no | closed @ round 2 (D-22) |
| O-11 | 2 | A boot-time `GetSecret` error mapped to "not configured" makes the worker reroute the whole outbox (P-03, ledger 140, FR-4, AC-6) | yes | closed @ round 2 (D-11, R-5) |
| O-12 | 2 | Single-flight refresh can drop a rotation that arrives mid-resolve, leaving a stale key and permanent 401s (FR-9, AC-15) | no | closed @ round 2 (D-12) |
| O-13 | 2 | Deliberate switch to `sendgrid` while SendGrid is not enabled: rows end `rerouted` / `none` with no alert — silent loss not covered by the steer (P-03, ledger 140). Needs an operator decision | no | open |
| O-14 | 2 | A crash between the terminal UPDATE and the alert persist loses the escalation; `fallback_sent_at` has no reader (C-18) | no | closed @ round 2 (D-15; `fallback_sent_at` kept as diagnostic, D-13) |
| O-15 | 2 | A row in flight across a switch to `sendgrid` would end `undelivered` with an alert while a pending row is rerouted (FR-7) | no | closed @ round 2 (D-14) |
| O-16 | 2 | Startup log "ready at boot" contradicts behaviour in `commsgun` mode with a missing key (AC-17) | no | closed @ round 2 (D-21) |
| O-17 | 2 | New `undelivered` outcome duplicates the existing `dead` (C-18 DRY) | no | closed @ round 2 (D-20) |
| O-18 | 2 | Rotating the key on the edge before config yields permanent 401s | no | closed @ round 2 (D-23) |
| O-19 | 2 | In-memory incident latches alert once per incident (and once per boot) with no periodic repeat — possibly too quiet for a long-lived misconfiguration (ledger 140). Needs an operator decision | no | open |

## Reopen Petitions

<!-- Verdict: dropped (evidence not new — already on record at <ID>) | pending user | user reopened | user declined -->
| ID | Round | Target | New evidence | Verdict |
|---|---|---|---|---|

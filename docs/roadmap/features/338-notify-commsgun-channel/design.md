# Design: notify-commsgun-channel

**Created**: 2026-11-13
**Rounds**: 5 (full; termination: approved)
**Approved by**: user @ 2026-11-13
**Grounded in**: recon.md
**Debate register**: debate.md

---

## Chosen Approach

Decision IDs refer to `debate.md`; code citations are the ones recorded in `recon.md` § Codebase Map. Paths
are relative to `services/xstockstrat-notify/` unless they name another service.

**Shape.** commsgun becomes a second email provider behind the existing fanout gates. Provider selection and
the queueing decision live in the email branch of `FanoutDispatcher.dispatch` (`src/fanout/fanout.ts:109-114`),
after the unchanged severity / conviction / dedup gates and Slack (D-4). Delivery to commsgun is asynchronous
through a dedicated table `notify.email_outbox` and a new `CommsgunWorker` modelled on `WebhookWorker`
(`src/fanout/webhookWorker.ts:66-281`); `WebhookWorker` and `notify.webhook_deliveries` are untouched apart
from exporting `networkErrorClass` (D-1).

**Modules (D-18).** `src/fanout/emailRender.ts` (`renderEmail`, lifted from `fanout.ts:160-205`, the single
renderer for both providers, D-3); `src/fanout/sendgridSender.ts` (`SendgridSender`: today's SendGrid POST
unchanged, 3 s timeout kept); `src/fanout/emailProvider.ts` (mode mapping, `commsgunBase`, route);
`src/fanout/commsgunClient.ts` (request build, timeout, status classification); `src/fanout/commsgunWorker.ts`
(enqueue, tick, sweep, incidents, awaited stop); `src/services/commsgunSecret.ts` (key resolution).
`FanoutDispatcher(config, sendgrid, commsgun)` takes all three as required arguments; the five construction
sites (`src/index.ts:42`, `src/__tests__/fanout.test.ts:33`, `src/__tests__/notifyServiceImpl.test.ts:345`,
`:396`, `src/__tests__/deliveryChannelsLog.test.ts:46`) change in the same atomic steps.

**Readiness (D-10, D-11, D-41, D-42).** `commsgunBase` = enqueue URL, app id and recipient all non-empty. The
key state is three-valued: `key`, `absent` (resolved, `found = false`), `unknown` (never resolved). Mode values
other than `commsgun` / `sendgrid` read as `auto` everywhere.

| Dispatch (email branch) | Action |
|---|---|
| alert category `commsgun` | no email (D-26) |
| `sendgrid` | SendGrid if enabled, as today |
| `auto`, base set and key resolved | insert outbox row (`queued`) |
| `auto`, otherwise | SendGrid as today |
| `commsgun`, base set | insert outbox row, whatever the key state |
| `commsgun`, base not set | no row; `unconfigured` outcome |

A failed insert: in `auto`, `enqueue_error` + WARN, then SendGrid once; in `commsgun` mode metric + WARN only (D-19).

**Row (D-2, D-34).** One row per alert (`alert_id` UNIQUE, `INSERT … ON CONFLICT DO NOTHING`). It stores the
rendered subject, text and recipient frozen at insert; each attempt serialises the same body in fixed key
order with `Idempotency-Key: alert:<alert_id>`. The app key and URL are never stored. States `pending`,
`delivered`, `undelivered`, `rerouted`; `fallback` ∈ `none`, `sendgrid`; `reroute_reason` ∈ `deliberate`,
`lost_config`; `escalated_at`, `fallback_sent_at`. Every terminal UPDATE NULLs recipient, subject and text, and
a CHECK enforces "content present iff pending". Partial indexes: pending by `next_attempt_at`; rows that need
an alert and have none (D-43).

**Worker tick (D-27, D-36).** Re-raise sweep → route (read once) → incidents → `hold` returns → select due
rows, claim in memory, per-row work on single statements (never holding the pooled connection across HTTP).

| Route | When | Per due row |
|---|---|---|
| `attempt` | mode `commsgun`; or `auto` with base set and key resolved | POST; 2xx → `delivered`; retry class → backoff; permanent or exhausted → terminal step |
| `hold` | `auto`, base set, key `unknown` | nothing (D-11, D-38) |
| `reroute_lost` | `auto`, base unset or key `absent` | `rerouted` / `lost_config`, SendGrid once if enabled |
| `reroute_deliberate` | mode `sendgrid` | `rerouted` / `deliberate`, SendGrid once if enabled |

Retry classes (D-7, D-17, D-30): 429, 5xx, timeout and network error retry with
delay = min(max(backoff, Retry-After), `commsgun.backoff_max_seconds`); 401 / 403 / 409 / 413 / 422, any other
status and 3xx are permanent; `no_app_key`, `secret_unresolved` and `no_endpoint` make no POST and count as
retryable attempts in `commsgun` mode. `last_error` holds a class string only.

**Terminal step (D-5, D-39).** One `UPDATE … WHERE state = 'pending'` decides the outcome; side effects run
only when `rowCount = 1`. `undelivered`: metric (`dead`) → WARN → escalation alert → `escalated_at` → SendGrid
once if the mode is `auto` and SendGrid is enabled → `fallback_sent_at`. `rerouted`: metric → WARN → SendGrid
once if enabled → `fallback_sent_at`; its alert comes from the next sweep. A row reaching its terminal step
while the mode is `sendgrid` takes the deliberate-reroute path (D-14). Email is at-most-once; alerts are
at-least-once.

**Alerts (D-28, D-35, D-36, D-40).** All are raised through the injected `emitInternalAlert` callback
(`src/grpc/notifyServiceImpl.ts:72`), WARNING, category `commsgun`, source `xstockstrat-notify`. "Requires an
alert and has none" = `escalated_at IS NULL AND (state = 'undelivered' OR (state = 'rerouted' AND
(reroute_reason = 'lost_config' OR fallback_sent_at IS NULL)))`. `undelivered` rows get one alert each;
`rerouted` rows are grouped by reason into one alert carrying counts by fallback, unconfirmed sends and rows
still pending, then stamped in bulk. Stamping happens only after the alert persist resolves. Standing
incidents — pinned to `commsgun` without the base (I1), and stalled key in `auto` with the base set (I4: key
`absent`, or `unknown` after two consecutive failed resolves, naming the cause) — repeat every 24 hours (a
fixed worker constant) while they last; drain incidents alert once per drain. Latches are in memory.

**Secret (D-6, D-12, D-22, D-32).** `commsgunSecret.ts` owns its own `ConfigServiceClient` in the shape of
`src/services/adminDirectory.ts:30-51` (mTLS credentials, `x-internal-caller: notify`, deadline, injectable
client); `configWatcher.ts` is not edited (three byte-identical copies). `GetSecret` is called with the
environment mapped as the watcher maps it (`src/services/configWatcher.ts:81-82`). First resolve is awaited at
boot; afterwards it resolves only when the snapshot `version` differs from the last successfully resolved one
or after a failed resolve, with a dirty flag for an update that arrives mid-resolve. A failed refresh keeps the
last resolved state.

**Shutdown (D-29, D-37).** The worker keeps the `if (stopped) return` guard, so an aborted POST performs no
UPDATE and consumes no attempt. `stop()` aborts commsgun POSTs, lets a terminal step finish, and returns a
promise that both shutdown paths in `src/index.ts:62-71` await (capped by the existing 5 s timer) before `pool.end()`.

**Config side (D-8).** One `xstockstrat-config` seed migration (shape of
`migrations/048_webhook_fanout_callback_keys.up.sql:4-43`): the eight plain keys per environment, with
`commsgun.app_id` seeded `xstockstrat` (production) and `xstockstrat-staging` (staging), and a value-less
secret row per environment for `commsgun.app_key` (the `017:106-121` pattern). Grant
`{ callerID: 'notify', namespace: 'notify', keys: ['commsgun.app_key'], peerSan: 'xstockstrat-notify' }` in
`src/grpc/authz.ts:136-149`, with the mirrors and docs listed in `recon.md` § Dependencies, and
`scripts/config-wiring-stored.json` regenerated. The grant deploys before notify (D-33).

**Telemetry and logs (D-20, D-21).** Channel `commsgun`; outcomes `queued`, `enqueue_error`, `unconfigured`,
`no_app_key`, `rerouted`, the existing `dead`, and per-attempt `sent` / `http_error` / `timeout` / `error`
(`src/telemetry.ts:358-372`). Logs carry alert id, outbox id, attempts and error class only. The startup
delivery-channels line lists `commsgun` as enabled when the worker's route at boot is `attempt`
(`src/fanout/deliveryChannels.ts:5-25`; pinned test `src/__tests__/deliveryChannelsLog.test.ts:61-62`, `:71-73`).

**Consumer surface (C-14, D-9).** `/config-ui`, existing generic editor, no UI code change: the seed makes all
nine keys listable (the editor shows only stored rows, `services/xstockstrat-ui/src/app/config-ui/[namespace]/NamespaceEditor.tsx:251`),
and the secret row is set through the existing secret edit path (`:98`, `:132`, `:308`). Proof is two-part: CI
`config-wiring-stored` applies the real migration; a Playwright spec on extended `CONFIG_KEY_FIXTURES`
(`services/xstockstrat-ui/e2e/fixtures/configKeys.ts:55`) covers list, `[secret]`, save and reload.

**Operating rules for the docs step (D-23, D-31).** Rotate a key in config first, then retire it on the edge;
change `app_id` / `to_email` only with an empty outbox (the worker WARNs once when `app_id` changes with rows
pending); clearing the enqueue URL under `auto` drains the queue through SendGrid; category `commsgun` is
reserved; one notify instance.

## Rejected Alternatives

- `R-1` Generalise `notify.webhook_deliveries` / `WebhookWorker` to carry email rows — rejected because it changes a documented contract and its requeue SQL and puts feature 334's `@AC-9`..`@AC-14` at risk.
- `R-2` Extract a shared retry-worker base class from `WebhookWorker` — rejected because it rewrites a launched worker and its tests to save about 30 lines; revisit only if the duplication check flags it.
- `R-3` Store only the alert id and re-render per attempt — rejected because the body would depend on live config and the alerts row, breaking byte-identical retries (FR-5).
- `R-4` `fallback_pending` state with send-then-update (at-least-once fallback) — rejected because a crash between the SendGrid POST and the update duplicates the email and SendGrid has no idempotency key.
- `R-5` Two-valued secret state, a boot `GetSecret` error meaning "not configured" for the worker too — rejected because one transient config outage at restart would reroute every pending row to SendGrid.

## Open Risks

- [ ] Tailnet name resolution and certificate trust from the notify container are inferred from `homelab-edge` (`--accept-dns=true`, split-horizon record, ACME wildcard), not observed — to be verified at first homelab staging deploy with one lookup and one enqueue from the container.
- [ ] `src/telemetry.ts` is also modified by in-progress feature 337 — merge-order check at `/sdd-review impl-spec` and at the integration PR.
- [ ] Incident latches are in memory: a restart can repeat a drain alert or the first standing-incident alert once — accepted (alerts are at-least-once); stated in the notify docs step.
- [ ] No age cap on held rows, no retention of terminal rows, single instance only — out of scope by decision (product-spec § Out of Scope); stated in the notify docs step.

## Constitution Rules Touched

- `C-05` — honored by: nine namespace-relative keys seeded by one config migration, each with a named reader; the secret row seeded value-less.
- `C-07` / `F-01` — honored by: new numbered migration pairs in notify and config, numbers taken at execute time; no applied migration edited.
- `C-08` / `P-06` / `C-15` — honored by: every service step paired with tests; AC-1..AC-42 each mapped to a test file or CI job; red before green at execute.
- `C-10` / `C-14` — honored by: `/config-ui` named as the surface; all nine keys seeded so the editor lists them; allow-list mirrors and docs updated with the grant.
- `C-12` / `C-13` — honored by: UI spec extends `CONFIG_KEY_FIXTURES` and `INVENTORY.md`; `scriptedPool` moves to `src/__tests__/fixtures/` when the second worker test consumes it.
- `C-16` — honored by: see Business Rules Touched; no CHANGE.
- `C-18` — honored by: dedicated worker instead of a generalised base; no new config key beyond the nine; 24 h repeat limited to the two standing incidents; `dead` outcome reused.
- `F-06` — honored by: the worker shares notify's single pooled connection with single statements; `DB_POOL_MAX` unchanged.
- `F-07` — honored by: every tunable is a config key; the only fixed values are worker timings alongside the existing tick constant (tick, incident repeat, `GetSecret` deadline), as `WebhookWorker` and `adminDirectory` already do.
- `P-03` — honored by: each case the spec left undefined was decided by the operator at a gate and recorded in `context.md`.

## Business Rules Touched (C-16)

- PRESERVE `@AC-2` "A qualifying alert is delivered as an email carrying every required field" (`services/xstockstrat-notify/acceptance/notify-external-fanout.feature`) — not regressed by: `SendgridSender` sends today's POST unchanged, with the shared renderer lifted from the same code.
- PRESERVE `@AC-3` "With no credentials set, nothing fans out and runtime knobs still take effect live" (same) — not regressed by: `auto` without the commsgun base behaves exactly as today; all new keys are read live.
- PRESERVE `@AC-4` "A Slack webhook timeout does not delay or drop the primary stream" (same) — not regressed by: the outbox insert runs in the existing post-callback microtask; delivery is in the worker.
- PRESERVE `@AC-5` "The same alert fired twice within the dedup window fans out only once" (same) — not regressed by: dedup still precedes the insert; `alert_id` is UNIQUE.
- PRESERVE `@AC-1`, `@AC-7`, `@AC-8`, `@AC-9` (same) — not regressed by: gates and Slack untouched.
- EXTEND `@AC-6` "A fanout channel error is logged at WARN with the alert id and channel name" (same) — new case added: channel `commsgun`, class-only error.
- EXTEND `@AC-49` "Notify logs its enabled delivery channels once at startup" (`services/xstockstrat-notify/acceptance/signal-map-instrumentation.feature`) — new case added: `commsgun` in the list.
- PRESERVE `@AC-31` "Notify counts gated deliveries before any channel" (same) — not regressed by: closed-set labels only.
- PRESERVE `@AC-9`..`@AC-14` (`services/xstockstrat-notify/acceptance/webhook-fanout-callback.feature`) — not regressed by: `WebhookWorker` and its table unchanged; the `webhook` dead-letter alert is still emailed (exclusion keys on category `commsgun`).
- PRESERVE `@AC-5`, `@AC-7` (`services/xstockstrat-notify/acceptance/pwa-notifications.feature`) — not regressed by: push path untouched; escalation alerts reach it like any alert.
- EXTEND `@AC-4` "An allow-listed internal caller resolves a secret via GetSecret" (`services/xstockstrat-config/acceptance/config-secrets-and-scoping.feature`) — new case added: the exact-key, SAN-pinned `notify` grant.
- PRESERVE `@AC-1`, `@AC-1b`, `@AC-2`, `@AC-3`, `@AC-5`, `@AC-16` (same) and `@AC-3`, `@AC-4`, `@AC-6` (`services/xstockstrat-config/acceptance/fix-marketdata-secret-exposure.feature`) — not regressed by: no change to encryption, redaction or the gate; `found = false` is handled as "not configured".
- PRESERVE `@AC-1` (`services/xstockstrat-config/acceptance/fix-config-keys-contract.feature`), `@AC-7` (`services/xstockstrat-config/acceptance/config-ui-usability.feature`), `@AC-25`, `@AC-26` (`services/xstockstrat-config/acceptance/signal-map-instrumentation.feature`) — not regressed by: relative stored keys; secret rows expose no value; no value in logs.
- PRESERVE platform rules `@AC-19` / `@AC-13` @feature-295, `@AC-2` / `@AC-3` @feature-278, `@AC-36` @feature-279, `@AC-8` @feature-337 (`docs/sdd/business-rules/platform.feature`) — not regressed by: every key seeded and read; pool size unchanged; telemetry allowlist tests unedited (new label values, no new label keys).

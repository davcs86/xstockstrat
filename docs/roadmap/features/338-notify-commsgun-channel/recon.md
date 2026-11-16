# Recon: notify-commsgun-channel

**Created**: 2026-11-13
**From**: product-spec.md
**Tree**: ccr-2d98935d-na9x6j@49443b9 (= origin/main-dev@dc6c6de + this feature's docs commits)
**Affected services**: xstockstrat-notify, xstockstrat-config, xstockstrat-ui (config-ui surface)

---

## Objective

Add the homelab `commsgun` hub (tailnet-only HTTPS enqueue API) as a second fanout email provider in
`xstockstrat-notify`, selected live by `notify.fanout.email_provider` (`auto` | `commsgun` | `sendgrid`).
commsgun sends go through a durable outbox with retries; `auto` falls back to SendGrid when the outbox gives
up; the app key is an encrypted config secret resolved via `GetSecret`; an undelivered row raises one
in-process WARNING alert that is excluded from email.

## Codebase Map

Paths are relative to the service directory unless they start with `services/`, `scripts/`, `docs/` or `packages/`.

- **`xstockstrat-notify`** (Node 24 + TypeScript)
  - Entry point: `src/index.ts` — boot order config watcher `:28-29` → pg `Pool` max 1 `:32-39` →
    `new FanoutDispatcher(configWatcher)` `:42` → `WebPushDispatcher` `:43` → `NotifyServiceImpl` `:44` →
    delivery-channels log `:45` → `new WebhookWorker(pool, configWatcher, (a) => notifyImpl.emitInternalAlert(a))`
    `:46`, started in the `bindAsync` callback `:58`; shutdown `:62-71`.
  - Handler: `src/grpc/notifyServiceImpl.ts` — `emitAlert` `:49` (`persistAndBroadcast` `:57`, callback `:59`,
    `dispatchSideChannels` `:64`); `emitInternalAlert` `:72`; `persistAndBroadcast` `:78`; `dispatchSideChannels`
    `:139-151` (two `queueMicrotask` sites: fanout `:141`, web push `:146`).
  - Email path: `src/fanout/fanout.ts` — `FanoutDispatcher` `:42`, ctor `(config: ConfigWatcher)` `:47`, env
    creds read once `:48-49`, `enabledChannels()` `:53`, `dispatch(alert)` `:58`; gates `:62` (severity), `:73`
    (conviction), `:82-92` (dedup, **in-memory** `Map` `:45`, key set before any send); payload `:96-106`; Slack
    then email branch `:109-114`; `sendSendgrid` `:160-205` (3 s timeout `:14`; subject `[<severity>] <title>`).
  - Worker template: `src/fanout/webhookWorker.ts` — ctor `(pool: Pick<Pool,'query'>, config, emitAlert)`
    `:66-72`; `start`/`stop` `:74`/`:81`; `TICK_MS` 5000 `:12`; `MAX_IN_FLIGHT` 4 `:13`; in-memory claim `:61`;
    select-due `:94-103`; delivered `:204`; retry `:233`; `markDead` `:249`; `backoffDelaySeconds` `:40`;
    `RETRYABLE_STATUSES` `:14` (+5xx `:211`); live config reads `:120-138`; `networkErrorClass` `:54`;
    dead-letter alert `:258-281` (metric and log first, then `emitAlert` in try/catch). No `Retry-After` handling.
  - Last migration: `004_webhook_deliveries.up.sql` (`migrations/`), columns `:5-21`, partial index on
    `next_attempt_at WHERE state = 'pending'`.
  - Config-read pattern: `src/services/configWatcher.ts` — `getString` `:203`, `getInt` `:209`, `getFloat` `:216`,
    `getBool` `:222`; private stub `:48`, built `:67-70`; emits `'update'` on every data message `:107`;
    environment mapping `:81-82`. **Byte-identical in ledger/identity/notify** (header `:1-4`,
    `scripts/check-watcher-copies.py`).
  - gRPC client template: `src/services/adminDirectory.ts:30-36` (client + mTLS), `:42-51` (`grpc.Metadata`,
    deadline, injectable client); `src/mtls.ts:28` `clientCredentials()`, `:35` `targetOverride()`.
  - Telemetry: `src/telemetry.ts` — `DeliveryChannel` `:358`, `DeliveryOutcome` `:359-372`, `KEY_*` `:354-356`,
    `notify.delivery` counter `:377`, `recordDelivery(channel, outcome)` `:386`.
  - Startup log: `src/fanout/deliveryChannels.ts:5-25`.
  - Tests: `pnpm test` = `tsc && node --test dist/__tests__/*.test.js` (tests are compiled: a signature break
    fails the build). Fixtures `src/__tests__/fixtures/`: `stubFetch.ts` (`{status, headers, body}`, `{throws}`,
    `{hang}`; `headers.get` works), `fakeConfig.ts`, `collectingReader.ts`. `webhookWorker.test.ts`:
    `scriptedPool` `:117`, logger capture `:57-64`, `mock.timers` `:320`, `settle()` `:84`, direct `worker.tick()`.

- **`xstockstrat-config`** (Node + TypeScript)
  - Allow-list: `src/grpc/authz.ts` — `SecretCallerGrant` `:125-134`, `SECRET_CALLER_ALLOWLIST` `:136-149`
    (marketdata exact keys, ingest prefix, both `peerSan`-pinned), `hasSecretCallerAuthority` `:172-187`,
    `SECRET_SCOPE_ERROR` (PERMISSION_DENIED) `:190`, `secretDenialReason` `:205`.
  - `GetSecret`: `src/grpc/configServiceImpl.ts:615-664`; query `:637-641`; row absent or NULL/empty
    `value_encrypted` → `{value:'', found:false}` `:643-647`; decrypt failure → code 13 `:652-657`. Proto:
    `packages/proto/config/v1/config.proto:35`, `:110-120` (`namespace`, `key`, `environment`, `user_id` →
    `value`, `found`).
  - `SetConfig`: unregistered key → NOT_FOUND unless `createKey` `:792-797`; `is_secret` row-authoritative
    `:803-808`; `pg_notify('config_changed', …)` on every write incl. secrets `:841-843`; snapshot
    `contentVersion` `:205-214` hashes each secret's `updated_at`, so a rotation changes the DELTA `version`.
  - Last migration: `048_webhook_fanout_callback_keys.up.sql` (seed shape `:4-43`: one row per key per
    environment, `ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING`, actor
    `system:config-migration-feature-<slug>`; down `:4-13` deletes only rows still holding the seeded value).
  - Value-less secret seed precedent: `migrations/017_config_secrets_and_scoping.up.sql:106-121`
    (`value_data='[redacted]'`, `is_secret=TRUE`, `value_encrypted` omitted, `default_value=''`). No CHECK ties
    `is_secret` to `value_encrypted`.
  - Tests pinning the gate: `src/__tests__/secretCallerAuthz.test.ts` (sweep `:97-111`, reason set `:132-135`),
    `src/__tests__/secretsAndScope.test.ts:68-169` (real mTLS server, minted leaves).

- **`xstockstrat-ui`** (Next.js, `/config-ui`)
  - Key list comes only from stored rows: `src/app/config-ui/hooks/useConfigKeys.ts:19`,
    `src/app/config-ui/[namespace]/NamespaceEditor.tsx:251`; server `ListKeys`
    `services/xstockstrat-config/src/grpc/configServiceImpl.ts:858-865`.
  - The editor never sends `createKey` (`NamespaceEditor.tsx:274-282`) and cannot mark a key secret.
  - A stored secret row renders `[secret]` `:132`, edits blank as `type=password` `:98`, `:308`.
  - Always writes `stringVal` `:278`; no enum validation for strings; descriptions come from the row `:70`.
  - `notify` already in `KNOWN_NAMESPACES`: `src/lib/configNamespaces.ts:13`.
  - BFF: `src/lib/configUiBff.ts:34` (`listKeys`, session), `:35-57` (`setConfig`, admin scope).
  - e2e runs against an in-process mock (`e2e/mock-backend.ts:1490-1508`, `playwright.config.ts:159`), never a
    migrated DB. Fixtures: `e2e/fixtures/configKeys.ts:55` (`CONFIG_KEY_FIXTURES`), `:175`
    (`CONFIG_KEY_STUB_ROWS`); precedent spec `e2e/config-ui/secret-editing.spec.ts:5-6`.

## Patterns to REUSE

- Outbox worker (tick, in-memory claim, single-statement queries on the one pooled connection, backoff, live
  config with `> 0` guards, dead-letter alert after metric + log) → `WebhookWorker`
  (`src/fanout/webhookWorker.ts:66-281`), `backoffDelaySeconds` `:40`, `networkErrorClass` `:54`.
- Outbox DDL → `migrations/004_webhook_deliveries.up.sql:5-21` (states CHECK, attempts, `next_attempt_at`,
  `last_error`, partial pending index, `IF NOT EXISTS`).
- In-process alert → `NotifyServiceImpl.emitInternalAlert` (`src/grpc/notifyServiceImpl.ts:72`), injected as a
  callback exactly as for `WebhookWorker` (`src/index.ts:46`).
- `GetSecret` client → `adminDirectory.ts:30-51` shape (own client, mTLS creds, `grpc.Metadata`, deadline,
  injectable client for tests); a new module, **not** `configWatcher.ts` (three byte-identical copies).
- Secret refresh on rotation → marketdata `newLiveSecrets`/`bindRefresh`
  (`services/xstockstrat-marketdata/cmd/server/main.go:76`, `:314-346`): resolve at boot, soft-degrade to
  "unset", re-resolve on any config update. notify's watcher already emits `'update'` (`configWatcher.ts:107`).
- Soft-degrade on `found=false` → ingest `mcp_client_loop.py:134-148`.
- Plain-key seed + down → config `048_webhook_fanout_callback_keys.{up,down}.sql`; secret seed → `017:106-121`.
- SendGrid send, unchanged → `FanoutDispatcher.sendSendgrid` (`src/fanout/fanout.ts:160-205`); subject/body
  rendering there is the one renderer both providers should share.
- Test fixtures → `stubFetch`, `fakeConfig`, `collectingReader`, `scriptedPool` (`webhookWorker.test.ts:117`);
  a second consumer of `scriptedPool` forces it into `src/__tests__/fixtures/` (C-13).
- config-ui e2e → extend `CONFIG_KEY_FIXTURES` / `CONFIG_KEY_STUB_ROWS` and `INVENTORY.md` (C-12); model on
  `secret-editing.spec.ts`.

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-1` "A WARNING alert is fanned out to Slack when the webhook is configured"
  (`services/xstockstrat-notify/acceptance/notify-external-fanout.feature`) — Slack unchanged; still receives the escalation alert.
- **PRESERVE** `@AC-2` "A qualifying alert is delivered as an email carrying every required field" (same) — `sendgrid` mode and the fallback keep this exact POST and body.
- **PRESERVE** `@AC-3` "With no credentials set, nothing fans out and runtime knobs still take effect live" (same) — `auto` without commsgun must equal today.
- **PRESERVE** `@AC-4` "A Slack webhook timeout does not delay or drop the primary stream" (same) — the outbox must never delay `StreamAlerts`.
- **PRESERVE** `@AC-5` "The same alert fired twice within the dedup window fans out only once" (same) — dedup precedes the outbox insert.
- **EXTEND** `@AC-6` "A fanout channel error is logged at WARN with the alert id and channel name" (same) — adds channel `commsgun`.
- **PRESERVE** `@AC-7`, `@AC-8`, `@AC-9` (same) — severity / conviction gates unchanged.
- **EXTEND** `@AC-49` "Notify logs its enabled delivery channels once at startup"
  (`services/xstockstrat-notify/acceptance/signal-map-instrumentation.feature`) — list gains `commsgun`.
- **PRESERVE** `@AC-31` "Notify counts gated deliveries before any channel" (same) — closed-set labels only.
- **PRESERVE** `@AC-5`, `@AC-7` (`services/xstockstrat-notify/acceptance/pwa-notifications.feature`).
- **PRESERVE** `@AC-9`..`@AC-14` (`services/xstockstrat-notify/acceptance/webhook-fanout-callback.feature`) — webhook
  retry/backoff/restart rules and the `webhook` dead-letter alert, which must still be emailed.
- **PRESERVE** `@AC-1`, `@AC-1b`, `@AC-2`, `@AC-3`, `@AC-5`, `@AC-16`
  (`services/xstockstrat-config/acceptance/config-secrets-and-scoping.feature`) — encryption, redaction, fail-closed, `found=false`.
- **EXTEND** `@AC-4` "An allow-listed internal caller resolves a secret via GetSecret" (same) — adds the `notify` grant.
- **PRESERVE** `@AC-3`, `@AC-4`, `@AC-6` (`services/xstockstrat-config/acceptance/fix-marketdata-secret-exposure.feature`) — SAN-pinned grants.
- **PRESERVE** `@AC-1` (`services/xstockstrat-config/acceptance/fix-config-keys-contract.feature`) — stored keys namespace-relative.
- **PRESERVE** `@AC-7` (`services/xstockstrat-config/acceptance/config-ui-usability.feature`) — secret rows expose no value.
- **PRESERVE** `@AC-25`, `@AC-26` (`services/xstockstrat-config/acceptance/signal-map-instrumentation.feature`), `@AC-7`
  (`.../otel-metrics-logs-export.feature`) — no secret in logs or OTLP.
- **PRESERVE** platform rules (`docs/sdd/business-rules/platform.feature`): `@AC-19`/`@AC-13` @feature-295 and
  `@AC-2`/`@AC-3` @feature-278 (config-wiring gate), `@AC-27` @feature-295, `@AC-2` @feature-304, `@AC-36`
  @feature-279 (notify `DB_POOL_MAX`), `@AC-1..5` @feature-266, `@AC-8` @feature-337 (telemetry allowlist tests unedited).
- No CHANGE identified.

## Dependencies

- Proto/RPC: none changed. Consumes `ConfigService.GetSecret` (`packages/proto/config/v1/config.proto:35`, `:110-120`).
- Migration: next notify number after `004`; next config number after `048` — taken at execute time, not pinned.
- Config keys (new, namespace `notify`): `fanout.email_provider`, `commsgun.enqueue_url`, `commsgun.app_id`,
  `commsgun.app_key` (secret), `commsgun.to_email`, `commsgun.max_attempts`, `commsgun.backoff_base_seconds`,
  `commsgun.backoff_max_seconds`, `commsgun.request_timeout_seconds`.
- Config wiring gates: CI `config-wiring` and `config-wiring-stored` (`.github/workflows/ci.yml:1222-1293`);
  `scripts/config-wiring-stored.json` is **regenerated** by `scripts/config-wiring-stored.py` on a scratch
  Postgres; secret rows sit in a separate set and are never joined as seeds
  (`scripts/check-config-wiring.mjs:253-260`, `:620-622`). `scripts/config-heal/catalog.tsv` is frozen (no change).
- Inter-service edges: notify → config `GetSecret` (new call on an existing edge); notify → commsgun HTTPS
  (new external edge; root `CLAUDE.md` § Inter-Service Dependencies and notify `CLAUDE.md` § Dependencies).
- Allow-list mirrors and docs that enumerate grants: `services/xstockstrat-indicators/app/maintenance/config_inventory.py:34-42`
  (hand-copied), `services/xstockstrat-config/CLAUDE.md:43`, `services/xstockstrat-config/docs/context-constitution.md:34`, `:51`,
  `docs/patterns/config-governance.md:23-25` and the registered-keys log `:144-164` (newest first),
  `docs/patterns/inter-service-mtls.md:56-66`.
- New env vars / ports: none. notify blocks (`docker-compose.yml:217-258`, `deploy/homelab/compose.yml:104-126`,
  `.do/app.yaml:497+`, `.do/app.dev.yaml:494+`) need no change.
- Tailnet path (outside this repo, `davcs86/homelab-edge`, read-only): `comms.<magicdns_base_domain>` is a
  headscale extra record pointing at the edge (`roles/tailscale/tasks/main.yml:77-90`,
  `inventories/prod/group_vars/all/main.yml:83`); app VMs join with `--accept-dns=true`
  (`roles/tailnet_host/tasks/tailscale.yml:52`); the edge serves `*.<magicdns_base_domain>` with the ACME
  wildcard certificate (`roles/stack/templates/Caddyfile.j2:340-341`, enqueue handler `:366-372`);
  `policy/policy.hujson:39`, `:46` grant both xstockstrat tags → `tag:edge` tcp:443.
  `deploy/homelab/compose.yml` has no `dns:`, `extra_hosts:` or `networks:`.

## Risks / Not-found

- **Spec correction required (C-10/C-14):** config-ui shows only stored rows and cannot create a key, so
  `commsgun.app_key` must be **seeded as a value-less secret row** (the 017 pattern) or it can never be set from
  config-ui. The product spec's "no seeded value" stands; "absent row" does not.
- **Dedup is in-memory and consumed before any send** (`fanout.ts:45`, `:92`): the outbox insert must happen
  after the gates in `dispatch`, and an outbox row is the only durable record — a crash between gate and insert
  loses that email (same as today's best-effort send).
- **In-process alerts go through `FanoutDispatcher`** (`notifyServiceImpl.ts:72`, `:139-151`): the FR-8 email
  exclusion has to be in the dispatcher's email branch; Slack/push stay.
- **`enabledChannels()` checks credentials only** (`fanout.ts:53`), and
  `src/__tests__/deliveryChannelsLog.test.ts:61-62`, `:71-73` pins both the enabled/disabled strings and the
  literal `index.ts` call text — the startup-log change must update that test in the same step.
- **Break radius of a `FanoutDispatcher` ctor change:** `src/index.ts:42`, `src/__tests__/fanout.test.ts:33`,
  `src/__tests__/notifyServiceImpl.test.ts:345`, `:396`, `src/__tests__/deliveryChannelsLog.test.ts:46` (tests compile with the build).
- **Rotation has no per-key event:** only a namespace DELTA with a changed `version`; re-resolving on every
  watcher `'update'` is the available mechanism.
- **Outbox claim is in-memory:** a second notify instance would double-send, as for webhooks; commsgun's
  `Idempotency-Key` makes a duplicate enqueue a no-op (200 `duplicate`), which the webhook path does not have.
- **`secretCallerAuthz.test.ts` sweep** already lists `notify` as an unknown caller (`:97-111`); the new grant
  needs that sweep extended, not just a new case.
- **Overlap:** `src/telemetry.ts` is also modified by in-progress 337-metrics-host-provider-label.
- Not found: any Node `GetSecret` caller; any `Retry-After` handling in notify; a `getBool` or `GetSecret`
  fake in notify fixtures; any migration seeding a secret outside `marketdata`; notify metric names in
  `scripts/check-otel-produced-signals.py`; proof that a compose-network container on the app VM resolves the
  tailnet name (evidence is the runbook statement and `--accept-dns=true`, not an observed lookup) — verify at
  deploy with one `getent`/`curl` from the notify container; whether a non-default `acme_ca_url` is in use on
  the edge (a staging CA would not be trusted by Node).
- Ledger traps: sustained silent fallback (feature 140); pinned migration numbers (feature 020); credential as a
  plain row (076/147); a lazily-imported test that asserts nothing (feature 092/074).

## Recommended Scope

1. config: seed migration (8 plain keys + value-less secret row) with down; regenerate `config-wiring-stored.json`.
2. config: `notify` grant in `SECRET_CALLER_ALLOWLIST` + tests + the allow-list mirrors and docs.
3. notify: outbox migration.
4. notify: `GetSecret` resolver module (boot resolve, refresh on watcher update, soft-degrade) + tests.
5. notify: commsgun client (request build, timeout, status classification, `Retry-After`) + tests.
6. notify: outbox worker (claim, retry, terminal states, fallback hook, escalation alert) + tests.
7. notify: `FanoutDispatcher` provider selection, outbox insert, `commsgun`-category exclusion, exported
   SendGrid send for fallback + tests; wiring in `index.ts`, startup log, telemetry outcomes.
8. ui: config-ui fixtures + e2e for the `notify` keys and the secret row.
9. docs: notify/config `CLAUDE.md`, config-governance log, inter-service-mtls, root dependency graph, durable
   acceptance promotion at launch.

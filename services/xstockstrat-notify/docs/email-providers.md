# xstockstrat-notify — Email providers (feature 338)

How notify chooses between SendGrid and the homelab commsgun hub for alert email, and how the commsgun
outbox behaves. Summary in `CLAUDE.md` § Email providers; operator rules in `operations.md`.

A qualifying alert produces at most one email, through SendGrid or
through the homelab commsgun hub. `src/fanout/emailProvider.ts` holds the rules; `src/fanout/emailRender.ts`
renders the one subject and text both providers send; `src/fanout/sendgridSender.ts` is the SendGrid POST.

- **Base and readiness.** The *base* is `commsgun.enqueue_url`, `commsgun.app_id` and `commsgun.to_email`,
  all non-empty. The app key has three states (`src/services/commsgunSecret.ts`): `key`, `absent`
  (resolved, not set) and `unknown` (no resolve has succeeded yet). A failed refresh keeps the last
  resolved state.
- **Dispatch** (email branch of `FanoutDispatcher`, after the gates, dedup and Slack):

  | Mode | Condition | Action |
  |---|---|---|
  | any | alert category `commsgun` | no email |
  | `sendgrid` | — | SendGrid, if enabled |
  | `auto` | base set and key resolved | one row in `notify.email_outbox` |
  | `auto` | otherwise | SendGrid, if enabled |
  | `commsgun` | base set | one outbox row, whatever the key state |
  | `commsgun` | base not set | nothing sent or queued (`unconfigured`) |

  A failed insert is logged and counted (`enqueue_error`); in `auto` the email then goes through SendGrid
  once, in `commsgun` mode it is not sent.
- **Outbox** (`notify.email_outbox`, migration `005`): one row per alert (`alert_id` UNIQUE). States
  `pending` / `delivered` / `undelivered` / `rerouted`; `fallback` (`none` / `sendgrid`) on the last two;
  `reroute_reason` (`deliberate` / `lost_config`) on `rerouted`. The rendered recipient, subject and text
  exist only while the row is `pending`: every terminal UPDATE sets them to NULL (a CHECK enforces it). The
  key and the URL are never stored.
- **Worker** (`src/fanout/commsgunWorker.ts`, `CommsgunWorker`): started once the gRPC server is bound;
  every 5 s, at most 4 in flight. Each tick: alert sweep → route → incidents → due rows.

  | Route | When | Pending rows |
  |---|---|---|
  | `attempt` | mode `commsgun`; or `auto` with the base set and the key resolved | POSTed to commsgun |
  | `hold` | `auto`, base set, key `unknown` | left untouched, however old, until the key resolves |
  | `reroute_lost` | `auto`, base not set or key `absent` | end `rerouted` / `lost_config` |
  | `reroute_deliberate` | mode `sendgrid` | end `rerouted` / `deliberate` |

- **Attempt**: POST `{channel:"email", to:[recipient], subject, text}` with `X-Commsgun-App`,
  `Authorization: Bearer <key>`, `Idempotency-Key: alert:<alert_id>` and `redirect: 'manual'`; every retry
  of a row is byte-identical. 2xx → `delivered`. 429, 5xx, a timeout or a network error → retried with the
  backoff above. 401, 403, 409, 413, 422, a redirect or any other status → the row ends at once. With no
  URL or app id (`no_endpoint`), an unset key (`no_app_key`) or a key never resolved (`secret_unresolved`)
  no request is made and the attempt counts as a retry.
- **End of a row.** One guarded UPDATE decides the outcome; its side effects run only for the row it
  changed. `undelivered`: alert first, then — only in `auto` with SendGrid enabled — SendGrid once.
  `rerouted`: SendGrid once if enabled, no commsgun request. A row whose attempts run out while the mode
  is `sendgrid` is rerouted, not ended `undelivered`. Email is **at most once**: a crash between the
  UPDATE and the send loses that email and never repeats it.
- **Alerts** (WARNING, category `commsgun`, source `xstockstrat-notify`; ids, counts, key names and error
  classes only). They are derived from the table, so they are **at least once**: `escalated_at` marks a
  row whose alert was stored, and every tick re-raises for rows that need one and have none. Each
  `undelivered` row gets its own alert. Rerouted rows get one alert per drain — always for `lost_config`,
  and for `deliberate` only when an email was dropped or its SendGrid send was not confirmed. Two standing
  conditions alert when they start and again every 24 hours: mode `commsgun` without the base, and `auto`
  with the base set while the key is unset or could not be read on two consecutive tries.
- **Shutdown**: an in-flight commsgun POST is aborted and its row stays `pending` with the attempt not
  counted; a row already past its terminal UPDATE finishes before the pool closes.

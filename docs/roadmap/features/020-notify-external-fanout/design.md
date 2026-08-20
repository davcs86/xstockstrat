# Design: notify-external-fanout

**Created**: 2026-08-19
**Rounds**: 2 (full; termination: approved)
**Approved by**: user @ 2026-08-19 (hybrid gate + WARNING=2 default)
**Grounded in**: recon.md

---

## Chosen Approach

Add a single best-effort fanout module `services/xstockstrat-notify/src/fanout/fanout.ts` exporting a
`FanoutDispatcher` class, constructed once in `src/index.ts` (alongside the existing impl
construction, `index.ts:44`) and injected into `NotifyServiceImpl` exactly as `this.config` already
is (`notifyServiceImpl.ts:23`). At construction it reads the two `type: SECRET` env vars once
(`SLACK_WEBHOOK_URL`, `SENDGRID_API_KEY`) for enable-iff-set, and owns a bounded in-memory dedup
`Map<string, number>`.

**Hook point & isolation (FR-6 / AC-4).** `emitAlert` completes its DB insert and in-process
subscriber fan-out (`notifyServiceImpl.ts:82-93`) and calls back with success (`:95`). Fanout is
dispatched **after** the success callback returns — deferred via `queueMicrotask(() => void
this.fanout.dispatch(alert).catch((e) => log.warn('fanout dispatch rejected', {alertId, error:
e.message})))`. Deferring past the callback ensures the synchronous prefix of `dispatch` (gate read,
Map sweep, dedup insert, payload build) can never throw into `emitAlert`'s own `try/catch` and turn
an already-succeeded emit into an RPC error (round-2 adversary O-ordering). The **entire** `dispatch`
body is additionally wrapped in one outer `try/catch` that only WARN-logs, and the floating promise
carries a `.catch` — both unhandled-rejection surfaces are guarded so nothing can crash the notify
process or delay the stream write.

**Gate — hybrid severity-primary + conviction floor when present (user decision).** `req.severity`
is a ts-proto string enum; reuse the existing `alertSeverityToNumber(req.severity)` helper already
called at `notifyServiceImpl.ts:53` (confirmed import at `:3`; not an invent — F-04 clear). Fan out
only when `sevNum >= config.getInt('notify.fanout.min_severity', 2)` (default **2 = WARNING**;
enum `ALERT_SEVERITY_UNSPECIFIED=0..CRITICAL=4`, `notify.proto:43-47`). When the severity gate
passes AND `context.conviction` is present (only the analysis live-loop sets it, as a **flat** Struct
key `conviction`, `live_loop.py:567-575`), additionally require `Number(conviction) >=
config.getFloat('notify.fanout.min_confidence_threshold', 0.7)`; when conviction is **absent**
(trading/ingest/marketdata/portfolio alerts carry no such key), the severity gate alone decides — do
NOT fail-closed. A non-numeric/`NaN` conviction falls back to severity-only (round-2 O-NaN).

**Config keys (5; seeded via config migration 017).** `notify.fanout.min_severity` (int, default 2 —
NEW; the reinterpreted meaning of the fanout gate's primary axis), `notify.fanout.min_confidence_threshold`
(float, default 0.7 — reinterpreted as the analysis **readiness-ordinal** floor, NOT a probability;
renamed in description per ledger-023 caveat), `notify.fanout.dedup_window_seconds` (int, 300),
`notify.fanout.sendgrid_from_email` (string), `notify.fanout.sendgrid_to_email` (string). Each
`value_type` matches its getter (int→getInt, float→getFloat, string→getString) to avoid the
value_type/oneof silent-default trap (`configServiceImpl.ts:462-467`; ledger 2026-08-06). Seed shape
copies the multi-key `015_marketdata_finnhub.up.sql:22-30` (dev+prod rows, `trading_mode='all'`,
`ON CONFLICT … DO NOTHING`). `min_severity` is clamped to `[0,4]` at read and its 0–4↔severity map is
documented in the key description (config-ui renders the raw int — C-14 operator legibility).

**Credentials (SECRET env vars).** `SLACK_WEBHOOK_URL`, `SENDGRID_API_KEY` added to the notify block
in `docker-compose.yml` (`:203`), `.do/app.yaml`, `.do/app.dev.yaml` (confirmed absent from all
three — recon Dependencies); compose references them from `.env` so enable-iff-set works. A channel
is enabled iff its credential env var is non-empty (Slack iff `SLACK_WEBHOOK_URL`; SendGrid iff
`SENDGRID_API_KEY` AND both `sendgrid_from_email`/`sendgrid_to_email` populated). Rotation = redeploy
(the accepted scope reduction, FR-4). An explicit 3-file parity verification is a spec step (C-10).

**Dedup (FR-7 / AC-5) — content hash.** key = `sha256(category | source_service | title | body)`,
plus `symbol | trigger_type | strategy_id` appended when present in `context` (analysis). Title/body
are **included** (round-2 correction): for the gate-passing producers, title/body is the only
identity a context-less trading alert carries, and none embed a wall-clock, so a content hash dedups
a byte-identical re-fire (AC-5 / FR-7 "reconnect/replay") without collapsing genuinely distinct
alerts (two different reconciliation/approval/fill alerts, or two strategies on one symbol). Each
dispatch first **sweeps the whole Map** deleting entries older than `dedup_window_seconds` (bounds
growth — not prune-on-access-only), then checks/inserts; a hit within the window suppresses both
channels.

**Fanout payload (FR-5).** `symbol ← context.symbol` when present (blank/omit otherwise); `source ←
source_service` (first-class, `notify.proto:33`); `severity` (first-class); `conviction` when
present; `timestamp ← created_at` as ISO 8601 (`notifyServiceImpl.ts:39`); plus `title`/`body`. No
field is claimed that producers don't set (round-1 O3).

**HTTP.** Node 22 global `fetch` (no new dependency), each send bounded by an `AbortController` with a
module constant `FANOUT_HTTP_TIMEOUT_MS = 3000` (inside AC-1's 5 s). Kept a constant, not a 6th
config key (over-config for a fixed value with no operational need). Slack = incoming-webhook POST
`{text/blocks}`; SendGrid = v3 `POST /v3/mail/send` with `Authorization: Bearer`.

**Consumer surface (C-14).** Platform-internal: the fanout targets external Slack/SendGrid; the five
`notify.fanout.*` keys surface in the existing `/config-ui` generic key view (no new UI code —
`useConfigKeys.ts:22-26`). No proto change; no new inter-service gRPC edge (C-03 header propagation
N/A — outbound HTTP is external).

## Rejected Alternatives

- Gate on `context.confidence` fail-closed (original spec) — rejected: **no producer writes it**, so the feature ships 100% inert (round-1 O1; C-01/P-03; ledger 080/023/081).
- Gate on `context.conviction` alone — rejected: only analysis sets it, so every other alert would never fan out; and it's an ordinal, not a probability (ledger 023).
- Add a first-class `confidence`/`symbol`/`action` field to the Alert proto + populate in every emitter — rejected for this feature: proto change (C-09, 2-owner) + edits to all five emitters is materially larger scope than the hybrid gate; revisit if a true numeric confidence becomes a platform need.
- Dedup key excluding title/body (round-1 proposal) — rejected: collapses distinct context-less trading alerts (CRITICAL reconciliation/approval/fill) to one key within the window (round-2 O1).
- Dedup on `alertId` — rejected: `alertId` is a fresh uuid per `emitAlert` call (`notifyServiceImpl.ts:38`), so a genuine re-fire never collides.
- Fire-and-forget hooked before the success callback — rejected: dispatch's synchronous prefix can throw an RPC error onto an already-succeeded emit (round-2 O-ordering).
- `min_confidence_threshold` as a config knob left named/described as "confidence" — rejected: it gates an ordinal; description reworded to "minimum readiness (fraction of passing entry-condition leaves)" (ledger 023).
- Redis/DB-backed dedup store — rejected for V1: in-memory Map is sufficient at this alert volume (product spec), keeps "no schema change" true.

## Open Risks

- [ ] **min_severity default = WARNING (2) excludes INFO fill confirmations by default**, though the user story headlines "never miss a fill confirmation." Accepted by user at the round-2 gate: operator lowers `notify.fanout.min_severity` to 1 to capture fills. Document this prominently in the notify CLAUDE.md key description and the product-spec — to be addressed at the config-seed/docs step.
- [ ] **Struct key names are pinned to `live_loop.py:567-575`'s flat keys** (`conviction`/`symbol`/`trigger_type`/`strategy_id`). If a future emitter writes conviction under a different key, the floor silently won't fire — add a red-before-green test asserting the flat-Struct read against `req.context`'s plain-object decode — to be addressed at the fanout-wiring test step.
- [ ] **SECRET env-var deploy parity across 3 files** is a shared-surface change (C-10) — must carry an explicit parity verification — to be addressed at the deploy-wiring step.
- [ ] **FR-1/FR-2/FR-5 product-spec wording** still says "confidence score"; must be reworded to the hybrid severity+readiness model and the 5th config key registered — to be addressed before/at `/sdd-spec` (a product-spec touch-up).

## Constitution Rules Touched

- `C-01` / `P-03` — honored: the confidence-gate fork was grounded against every emitter and escalated to the user, not guessed; the inert-feature design was rejected.
- `C-04` — honored: gate reuses the existing `AlertSeverity` enum (zero-value UNSPECIFIED present); no new enum.
- `C-05` — honored: all 5 keys are `<service>.<category>.<key>`, value_type matches getter, defaults declared in notify CLAUDE.md; the new `min_severity` key registered in product-spec + CLAUDE.md.
- `C-07` — honored: config seed is migration `017_notify_fanout` (`.up`/`.down`), next free number.
- `C-10` — honored: the 2 SECRET env vars land in all 3 deploy files with a parity verification step; the shared config-ui surface needs no code (generic renderer).
- `C-14` — honored: named platform-internal with a stated reason; operator surface is the existing config-ui.
- `F-04` — honored: `alertSeverityToNumber` confirmed to exist (`notifyServiceImpl.ts:3`); no invented symbol/path.
- `F-07` — honored: all tunables read from `WatchConfig`; the one hardcoded value (HTTP timeout) is a code constant, not a config value in disguise, and is justified in-design.
- `C-08` / `P-06` — honored: fanout module + emit-wiring each get a paired red-before-green test (gate/dedup/isolation/NaN-fallback), notify CI threshold 40.

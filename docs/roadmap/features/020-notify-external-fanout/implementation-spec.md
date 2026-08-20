# Implementation Spec: notify-external-fanout

**Status**: `pending`
**Created**: 2026-08-20
**Feature**: `docs/roadmap/features/020-notify-external-fanout/feature.md`
**Total Steps**: 7
**Feature Branch**: `feature/notify-external-fanout`

---

## Execution Summary

Fanout is a best-effort side-channel bolted onto `xstockstrat-notify`'s existing `emitAlert` path;
no proto change, no notify migration. Order: seed the five `notify.fanout.*` config keys first
(Step 1, config migration 017) so the reader has values; build the standalone `FanoutDispatcher`
module (Step 2) + its unit test (Step 3) in isolation; then wire it into `emitAlert` after the
success callback (Step 4) + the wiring/isolation test (Step 5); wire the two `type: SECRET`
credential env vars through the **full** deploy pipeline (Step 6); finish with docs + context-scrubber
(Step 7). Steps 2–5 are pure Node/TS logic tested with a stubbed global `fetch`; no live HTTP, DB, or
container is started in any verification.

**Consumer surface (C-14).** The product spec marks this **None / platform-internal** — the fanout
targets external Slack/SendGrid, and the five `notify.fanout.*` keys surface through the existing
`/config-ui` generic key renderer with no new UI code (`recon.md` → `useConfigKeys.ts:22-26`). No
`xstockstrat-ui` or `xstockstrat-agent` step is required; this was a decision, not an omission.

**Deploy-wiring scope note (C-10).** `design.md` § Credentials names only three deploy files
(`docker-compose.yml`, `.do/app.yaml`, `.do/app.dev.yaml`). The product spec's *Env Var Changes*
section binds the credentials to the **full** checklist in `docs/runbooks/add-data-source.md`
§ "Wiring a New Vendor Credential Through Deploy" — ten files, of which `config.go` (row 1) is
Go-only and does not apply to this Node service (the env read lives in the Step 2 module instead).
`docs/patterns/config-governance.md:60` records feature 129 shipping a credential into "only 3 of the
8 required files" as a defect that needed a follow-up PR. Step 6 therefore wires **all** applicable
pipeline files, not just the three. This completes design.md's wording; it does not change its
architecture.

## Scenario Coverage (C-15)

- **AC-1** (WARNING → Slack + primary stream intact) → Step 5
- **AC-2** (email carries every required field) → Step 3
- **AC-3** (no creds → nothing fans out; min_severity change live) → Step 3 (enable-iff-set) + Step 5 (live config read)
- **AC-4** (Slack timeout does not delay/drop primary stream) → Step 5
- **AC-5** (same alert twice in window → one POST) → Step 3 (dedup unit) + Step 5 (end-to-end)
- **AC-6** (channel error logged WARN with alert id + channel; no RPC error) → Step 3 + Step 5
- **AC-7** (below severity floor → no POST) → Step 3
- **AC-8** (conviction below floor → no POST) → Step 3
- **AC-9** (conviction-less gated by severity alone → POST) → Step 3

## Step Dependencies

- Step 3 (test) covers Step 2 (service) — fanout module + its unit test are a red-green pair.
- Step 5 (test) covers Step 4 (service) — emit-wiring + its unit test are a red-green pair.
- Step 4 requires Step 2: `emitAlert` constructs/injects and calls the `FanoutDispatcher` built in Step 2.
- Step 2 requires Step 1 only semantically (the module reads keys seeded in Step 1); code-wise the
  module compiles independently — Step 1 may land first or in parallel.
- Step 6 (deploy credentials) is independent of 2–5 but must land before the feature is exercised in
  dev/prod; no code dependency.
- Step 7 (docs) is last — it documents the keys (Step 1), env vars (Step 6), and the
  min_severity=WARNING caveat; run `/context-scrubber scan` here.

---

### Step 1 — migration: seed the five `notify.fanout.*` config keys (config migration 017)

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/migrations/017_notify_fanout.up.sql` — create
- `services/xstockstrat-config/migrations/017_notify_fanout.down.sql` — create

**Reviewers**: DBA — migration NNN numbering (no gaps), up+down pair present, run-order compliance; xstockstrat-config owner — config key naming (`<service>.<category>.<key>`), environment/trading_mode scoping, value_type↔getter match

**Codebase Evidence**:
- Last config migration is `016_deprecate_analysis_signal_source_weights_desc.{up,down}.sql`
  (`ls services/xstockstrat-config/migrations/`) → next free `NNN` = **017** (recon.md confirms).
- Seed shape to copy: `services/xstockstrat-config/migrations/015_marketdata_finnhub.up.sql:24-30` —
  `INSERT INTO config.config_values (namespace, key, value_type, value_data, description,
  default_value, consuming_service, environment, trading_mode, is_secret) VALUES (...) ON CONFLICT
  (namespace, key, environment, trading_mode) DO NOTHING;` — one `dev` row + one `production` row per
  key, `trading_mode='all'`, `is_secret=FALSE`.
- Down shape: `015_marketdata_finnhub.down.sql` — `DELETE FROM config.config_values WHERE namespace =
  'notify' AND key IN (...)`.
- Reader getters that pin each `value_type`: `services/xstockstrat-notify/src/services/configWatcher.ts`
  — `getInt` (`:88`, `intVal`), `getFloat` (`:93`, `floatVal`), `getString` (`:83`, `stringVal`). A
  `value_type` that mismatches its getter silently returns the default (ledger 2026-08-06 / migration
  016 value_type-immutability trap; `configServiceImpl.ts` oneof serve-time mapping).

**TDD**: `N/A (migration — offline up/down inspection)`

**Covers**: `—`

**Instructions**:
1. Create `017_notify_fanout.up.sql`. Insert **two rows** (`environment='dev'` and
   `environment='production'`) for each of the five keys below, `namespace='notify'`,
   `consuming_service='xstockstrat-notify'`, `trading_mode='all'`, `is_secret=FALSE`, matching the
   `015` VALUES layout. The `key` column carries the FULL dotted string the notify service reads
   (no namespace prefix added at serve time — see the `015` header comment). Set `value_data` =
   `default_value` for each:

   | key | value_type | default | getter | description (put in `description` + `default_value`) |
   |---|---|---|---|---|
   | `notify.fanout.min_severity` | `int` | `2` | `getInt` | Primary fanout gate: minimum `AlertSeverity` ordinal to fan out (0=UNSPECIFIED,1=INFO,2=WARNING,3=ERROR,4=CRITICAL). Clamped to [0,4] at read. **Default 2 (WARNING) excludes INFO fill confirmations — lower to 1 to fan out fills.** |
   | `notify.fanout.min_confidence_threshold` | `float` | `0.7` | `getFloat` | Minimum analysis **readiness ordinal** (fraction of passing entry-condition leaves — NOT a probability); applied only when the alert's `context.conviction` is present. Conviction-less alerts are gated by `min_severity` alone. |
   | `notify.fanout.dedup_window_seconds` | `int` | `300` | `getInt` | Suppress re-delivery of a byte-identical alert within this many seconds. |
   | `notify.fanout.sendgrid_from_email` | `string` | `''` (empty) | `getString` | Sender address for outbound fanout email. |
   | `notify.fanout.sendgrid_to_email` | `string` | `''` (empty) | `getString` | Recipient address for outbound fanout email. |

   For the two email string keys seed empty-string `value_data`/`default_value` (email is disabled
   until both are populated AND `SENDGRID_API_KEY` is set — Step 4 gate).
2. Create `017_notify_fanout.down.sql` — `DELETE FROM config.config_values WHERE namespace = 'notify'
   AND key IN ('notify.fanout.min_severity','notify.fanout.min_confidence_threshold',
   'notify.fanout.dedup_window_seconds','notify.fanout.sendgrid_from_email',
   'notify.fanout.sendgrid_to_email');`
3. Do **not** seed `SLACK_WEBHOOK_URL`/`SENDGRID_API_KEY` here — they are `type: SECRET` env vars
   (Step 6), never config rows (config governance / feature 076; mirrors the `015` no-credential-row
   note).

**Verification**:
```bash
ls services/xstockstrat-config/migrations/017_notify_fanout.up.sql \
   services/xstockstrat-config/migrations/017_notify_fanout.down.sql
```
Then read both: confirm every `INSERT ... VALUES` row in `.up.sql` (10 rows = 5 keys × 2 envs) has a
matching key in the `.down.sql` `DELETE ... IN (...)` list, each `value_type` matches the getter in
the table above, and no credential key is present. Offline only — do **not** start a database.

---

### Step 2 — service: `FanoutDispatcher` module (Slack + SendGrid senders, gate, dedup)

**Status**: `pending`
**Service**: `xstockstrat-notify`
**Files**:
- `services/xstockstrat-notify/src/fanout/fanout.ts` — create

**Reviewers**: xstockstrat-notify owner — alert deduplication, stream delivery guarantees (fanout must not affect the primary stream)

**Codebase Evidence**:
- Config getters to reuse: `src/services/configWatcher.ts` `getInt` (`:88`), `getFloat` (`:93`),
  `getString` (`:83`). `ConfigWatcher` is already injected into `NotifyServiceImpl`
  (`src/grpc/notifyServiceImpl.ts:23`).
- Severity→ordinal helper already imported and used in the impl:
  `alertSeverityToNumber` from `@xstockstrat/proto/notify/v1/notify`
  (`notifyServiceImpl.ts:3`, used at `:53`). Enum ordinals: UNSPECIFIED=0, INFO=1, WARNING=2,
  ERROR=3, CRITICAL=4 (design.md § Gate; recon.md).
- Logger pattern: `import { getLogger } from '../services/logger'` then `getLogger('notify:fanout')`
  (mirrors `notifyServiceImpl.ts:5,7`).
- Conviction source is a **flat** Struct key `conviction` set only by the analysis live loop:
  `services/xstockstrat-analysis/app/engine/live_loop.py` `_emit_alert` — `ctx.update({strategy_id,
  symbol, trigger_type, conviction: float(...)})`. Trading/ingest/marketdata/portfolio emitters set
  no such key (recon.md Dependencies; design.md § Gate).
- Node 22 global `fetch` is available (no new dependency — recon.md § Patterns to REUSE). This is the
  service's first outbound HTTP call.

**TDD**: `red-green required`

**Covers**: `—`

**Instructions**:
1. Export a `FanoutDispatcher` class. Constructor takes the injected `ConfigWatcher` (typed as the
   existing `ConfigWatcher` import). In the constructor, read the two credential env vars **once**:
   `this.slackWebhookUrl = process.env.SLACK_WEBHOOK_URL?.trim() || ''` and
   `this.sendgridApiKey = process.env.SENDGRID_API_KEY?.trim() || ''`. Initialize
   `this.dedup = new Map<string, number>()`.
2. Module constant `const FANOUT_HTTP_TIMEOUT_MS = 3000;` (design.md — a fixed code constant inside
   AC-1's 5 s, deliberately not a 6th config key; F-07 honored — it is not a tunable in disguise).
3. Expose `async dispatch(alert): Promise<void>` where `alert` is the camelCase object built in
   `emitAlert` (fields: `alertId`, `severity` [string enum], `category`, `title`, `body`,
   `sourceService`, `context`, `createdAt` [Date]). Wrap the **entire** body in one
   `try { ... } catch (e) { log.warn('fanout dispatch error', { alertId, error: e.message }); }` so
   nothing throws out of `dispatch` (FR-6/AC-4). Inside:
   a. **Gate.** `sevNum = alertSeverityToNumber(alert.severity)`;
      `minSev = clamp(config.getInt('notify.fanout.min_severity', 2), 0, 4)`. If `sevNum < minSev`
      return (no fanout). Then read `conviction = alert.context?.conviction`; if `conviction` is
      present and `Number.isFinite(Number(conviction))`, require
      `Number(conviction) >= config.getFloat('notify.fanout.min_confidence_threshold', 0.7)` — return
      if below. If `conviction` is absent or non-numeric/`NaN`, do **not** fail closed — severity gate
      alone decides (design.md § Gate; AC-9). Read the config getters **inside** `dispatch` on every
      call so a live `min_severity` change takes effect with no restart (AC-3).
   b. **Dedup.** Compute `key = sha256(category | sourceService | title | body)` using node
      `crypto.createHash('sha256')`, appending `| symbol | trigger_type | strategy_id` for each of
      those present in `alert.context` (design.md § Dedup — content hash includes title/body). First
      **sweep** the whole `this.dedup` Map deleting entries whose stored timestamp is older than
      `config.getInt('notify.fanout.dedup_window_seconds', 300)` seconds ago (bounds growth — not
      prune-on-access-only). Then if `key` is still present, return (suppress both channels, AC-5);
      else `this.dedup.set(key, Date.now())` and continue.
   c. **Payload (FR-5).** Build a plain object: `symbol` ← `alert.context?.symbol` when present (omit
      otherwise), `source` ← `alert.sourceService`, `severity` ← `alert.severity`, `conviction` when
      present, `title`, `body`, `timestamp` ← `new Date(alert.createdAt).toISOString()`. Claim no
      field a producer does not set.
   d. **Send, per enabled channel, each isolated.** `if (this.slackWebhookUrl) await
      this.sendSlack(payload, alert.alertId)`; `if (this.sendgridApiKey && from && to) await
      this.sendSendgrid(payload, alert.alertId)` where `from = config.getString(
      'notify.fanout.sendgrid_from_email')` and `to = config.getString('notify.fanout.sendgrid_to_email')`
      (SendGrid enabled iff API key AND both addresses non-empty — design.md § Credentials). Each
      `sendX` wraps its `fetch` in its own `try/catch` that on failure logs
      `log.warn('fanout channel error', { alertId, channel: 'slack'|'sendgrid', error })` (AC-6) and
      returns — one channel's failure never blocks the other.
4. `private async sendSlack(payload, alertId)`: `POST this.slackWebhookUrl` with
   `{ text: <human summary built from payload> }` (Slack incoming-webhook shape), `Content-Type:
   application/json`, bounded by `AbortController` + `setTimeout(FANOUT_HTTP_TIMEOUT_MS)`
   (clear the timeout in `finally`).
5. `private async sendSendgrid(payload, alertId)`: `POST https://api.sendgrid.com/v3/mail/send` with
   `Authorization: Bearer ${this.sendgridApiKey}`, `Content-Type: application/json`, v3 body
   (`personalizations[0].to = [{ email: to }]`, `from.email = from`, `subject`, `content[0]` =
   `text/plain` including symbol, source, severity, conviction, title/body, timestamp — the AC-2
   required fields), same `AbortController` timeout.
6. Keep the module free of DB/gRPC imports — it depends only on `ConfigWatcher`, the logger, the proto
   severity helper, and node `crypto`.

**Verification**: covered by Step 3's `pnpm run test:coverage` + lint (red-green pair). Standalone
build check: `cd services/xstockstrat-notify && pnpm run build` — `tsc` compiles the new module clean.

---

### Step 3 — test: `FanoutDispatcher` unit tests (gate, dedup, payload, enable-iff-set, error logging)

**Status**: `pending`
**Service**: `xstockstrat-notify`
**Files**:
- `services/xstockstrat-notify/src/__tests__/fanout.test.ts` — create

**Reviewers**: xstockstrat-notify owner — alert deduplication, stream delivery guarantees

**Codebase Evidence**:
- Test harness convention: `import { describe, it } from 'node:test'; import assert from
  'node:assert/strict';` compiled-first (`tsc && node --test dist/__tests__/*.test.js`), with a hard
  "import succeeded" assertion — `src/__tests__/notifyServiceImpl.test.ts:1-40`.
- Coverage runner: `package.json` `test:coverage` = `tsc && c8 --reporter=text --reporter=lcov --lines
  40 node --test dist/__tests__/*.test.js` (threshold 40, matches CI).
- Lint: `package.json` `lint` = `eslint src --ext .ts` (config `.eslintrc.json`).
- A `ConfigWatcher` can be faked inline as `{ getInt: (_k,d)=>..., getFloat:..., getString:... }`
  cast `as any` (mirrors `notifyServiceImpl.test.ts` `makeImpl(... {} as any)` at `:47`). Single
  consumer → inline fake is C-13-compliant; no `src/__tests__/fixtures/` home needed.

**TDD**: `red-green required` — every assertion targets Step 2 behavior and fails against the
pre-Step-2 tree (module does not yet exist).

**Covers**: `AC-2, AC-3, AC-5, AC-6, AC-7, AC-8, AC-9`

**Instructions**:
1. Stub outbound HTTP by replacing `globalThis.fetch` with a recording fake in each test (capture URL,
   headers, body; restore after). No real network.
2. Cases (each with a fake `ConfigWatcher` returning the values the scenario states):
   - **AC-7**: `min_severity=2`, credential set (stub `process.env.SLACK_WEBHOOK_URL` for the
     instance), INFO-severity alert (`ALERT_SEVERITY_INFO`) → **zero** `fetch` calls.
   - **AC-8**: `min_severity=2`, `min_confidence_threshold=0.7`, Slack set, WARNING alert with
     `context.conviction=0.55` → **zero** `fetch` calls.
   - **AC-9**: `min_severity=2`, `min_confidence_threshold=0.7`, Slack set, WARNING alert from
     `sourceService='trading'` with **no** `conviction` key → Slack `fetch` **called once** (severity
     alone gates; no fail-closed).
   - **AC-2**: `SENDGRID_API_KEY` set + `sendgrid_from_email`/`sendgrid_to_email` populated, WARNING
     alert (`sourceService='analysis'`, `context.conviction=0.82`, `context.symbol='AAPL'`,
     `createdAt=2026-08-20T14:31:00Z`) → a POST to `https://api.sendgrid.com/v3/mail/send`; assert the
     serialized body contains `AAPL`, `analysis`, the WARNING severity string, `0.82`, the title/body,
     and `2026-08-20T14:31:00Z`.
   - **AC-3 (enable-iff-set)**: neither `SLACK_WEBHOOK_URL` nor `SENDGRID_API_KEY` set → CRITICAL
     alert → **zero** `fetch` calls.
   - **AC-5 (dedup)**: `dedup_window_seconds=300`, Slack set; call `dispatch` twice with a
     byte-identical WARNING AAPL alert → Slack `fetch` called **exactly once**.
   - **AC-6 (error logging)**: Slack set, `fetch` stub returns HTTP 500 (or throws); alert
     id `alert-abc123`, WARNING → `dispatch` resolves without throwing, and a WARN log line names the
     alert id and channel `slack`. Assert via a captured logger spy (inject/monkeypatch the module
     logger, or assert `dispatch` does not reject and the 500 path was taken).
3. Also assert SendGrid stays disabled when the API key is set but `sendgrid_to_email` is empty
   (guards the "both addresses required" half of the gate).

**Verification**:
```bash
cd services/xstockstrat-notify && pnpm run lint && pnpm run test:coverage
```
Confirm all new cases pass and the c8 `--lines 40` threshold holds. Run once against the pre-Step-2
tree to confirm RED (module import fails / behavior absent), then GREEN after Step 2.

---

### Step 4 — service: wire `FanoutDispatcher` into `emitAlert` (post-callback, non-blocking)

**Status**: `pending`
**Service**: `xstockstrat-notify`
**Files**:
- `services/xstockstrat-notify/src/index.ts` — modify
- `services/xstockstrat-notify/src/grpc/notifyServiceImpl.ts` — modify

**Reviewers**: xstockstrat-notify owner — stream delivery guarantees, backpressure handling, alert deduplication

**Codebase Evidence**:
- Construction site: `src/index.ts:44` — `const notifyImpl = new NotifyServiceImpl(pool,
  configWatcher);` (build the `FanoutDispatcher` here and inject it).
- Impl constructor: `notifyServiceImpl.ts:21-24` — `constructor(private readonly pool: Pool, private
  readonly config: ConfigWatcher) {}` (add a third `private readonly fanout: FanoutDispatcher` param).
- Hook point: `emitAlert` builds the fan-out `alert` object at `notifyServiceImpl.ts:67-80`, runs the
  in-process subscriber loop at `:83-92`, logs at `:93`, and calls back success at `:95-98`. The
  existing F-10 title/body guard is at `:35-37`; the DB insert at `:42-64`.
- `now` (ISO source for the payload timestamp) is `new Date()` at `:39`; `alertId = uuidv4()` at `:38`.

**TDD**: `red-green required`

**Covers**: `—`

**Instructions**:
1. In `src/index.ts`, after building `pool` and before/at `:44`, construct
   `const fanout = new FanoutDispatcher(configWatcher);` (import from `./fanout/fanout`) and pass it as
   the third arg: `new NotifyServiceImpl(pool, configWatcher, fanout);`.
2. In `notifyServiceImpl.ts`, add the `fanout` constructor param (typed `FanoutDispatcher`, imported
   from `../fanout/fanout`).
3. In `emitAlert`, **after** the success `callback(null, { alertId, createdAt: now })` at `:95-98`
   returns (i.e. as the last statement of the `try` block, after the callback call), dispatch fanout
   deferred and non-blocking:
   ```ts
   queueMicrotask(() =>
     void this.fanout.dispatch(alert).catch((e) =>
       log.warn('fanout dispatch rejected', { alertId, error: e.message })));
   ```
   `queueMicrotask` guarantees `dispatch`'s synchronous prefix (gate read, Map sweep, payload build)
   runs **after** `emitAlert` has already reported success, so it can never turn a succeeded emit into
   an RPC error (design.md § Hook point; the round-2 O-ordering fix). The floating promise's `.catch`
   plus the module's own full-body try/catch (Step 2) guard both unhandled-rejection surfaces.
4. Do **not** move fanout into the `catch` branch and do **not** await it — the primary stream write
   (`:83-92`) and the RPC callback must be entirely independent of fanout latency (FR-6/AC-4).
5. Reuse the `alert` object already built at `:67-80` (it carries `severity` string, `context`,
   `sourceService`, `createdAt`) — do not rebuild it.

**Verification**: covered by Step 5's coverage run + lint. Standalone: `cd services/xstockstrat-notify
&& pnpm run build` compiles.

---

### Step 5 — test: `emitAlert` fanout wiring — isolation, dedup end-to-end, flat-Struct conviction read

**Status**: `pending`
**Service**: `xstockstrat-notify`
**Files**:
- `services/xstockstrat-notify/src/__tests__/notifyServiceImpl.test.ts` — modify

**Reviewers**: xstockstrat-notify owner — stream delivery guarantees, alert deduplication

**Codebase Evidence**:
- Existing helpers to reuse: `makePool` (`notifyServiceImpl.test.ts:38`), `makeImpl` (`:47`) which
  constructs `new NotifyServiceImpl(pool as any, {} as any)`. Extend `makeImpl` to accept and inject a
  fake/real `FanoutDispatcher` (third arg) so the wiring is exercised.
- `emitAlert` success contract already asserted by the feature-092 metadata-less test (the suite must
  stay green) — the new cases add fanout behavior without changing the existing EmitAlert contract.
- The fan-out `alert.context` is the decoded `req.context` plain object; the flat `conviction`/`symbol`
  keys the analysis loop sets (`live_loop.py` `_emit_alert`) must be read as `alert.context.conviction`
  (design.md Open Risk — pin the flat-Struct read with a test).

**TDD**: `red-green required` — asserts Step 4 wiring; fails before Step 4 (no fanout dispatched).

**Covers**: `AC-1, AC-3, AC-4, AC-5, AC-6`

**Instructions**:
1. Build a fake `FanoutDispatcher` whose `dispatch` records the alerts it receives (and can be made to
   hang or reject on demand), OR inject a real `FanoutDispatcher` with `globalThis.fetch` stubbed —
   choose one and keep it inline (single consumer, C-13 inline OK).
2. Cases:
   - **AC-1**: WARNING AAPL alert with `SLACK_WEBHOOK_URL` set (real dispatcher + fetch stub) →
     `dispatch` invoked with the alert AND the in-process subscriber (register one via `streamAlerts`,
     as existing tests do) still receives the same alert via `sub.call.write`. Assert both.
   - **AC-4 (isolation)**: make the fanout path hang (dispatcher `dispatch` returns a never-resolving
     promise, or fetch stub never resolves) → `emitAlert`'s `callback` is still invoked with success
     **synchronously/promptly** and the subscriber still received its write, with no added latency and
     the alert not dropped. (Because dispatch is `queueMicrotask`-deferred and un-awaited, the callback
     fires regardless.)
   - **AC-3**: with no credentials set on the dispatcher, `emitAlert` still succeeds and the subscriber
     still receives the alert; assert no outbound `fetch`. Assert the gate reads `config.getInt` live
     (change the fake config's `min_severity` return between two emits and observe the second alert's
     fanout decision flips) to demonstrate no-restart config effect.
   - **AC-5 (end-to-end dedup)**: emit two byte-identical WARNING AAPL alerts through `emitAlert` with
     Slack configured → exactly one outbound Slack `fetch`.
   - **AC-6**: fanout channel returns HTTP 500 → `emitAlert` returns success to the RPC caller (no
     error propagates) and a WARN log names the alert id + `slack`.
   - **Flat-Struct conviction read** (design Open Risk): emit a WARNING alert whose `context` =
     `{ strategy_id, symbol:'AAPL', trigger_type, conviction:0.82 }` and one with `conviction:0.55`
     under `min_confidence_threshold=0.7` → the first fans out, the second does not — proving the read
     is `context.conviction` (flat), not a nested/aliased key.
3. Keep every existing case in the file green (feature-092 contract, `matchesSubscriber`, `rowToAlert`).

**Verification**:
```bash
cd services/xstockstrat-notify && pnpm run lint && pnpm run test:coverage
```
All cases pass, c8 `--lines 40` holds. RED before Step 4, GREEN after.

---

### Step 6 — service: wire `SLACK_WEBHOOK_URL` + `SENDGRID_API_KEY` (`type: SECRET`) through the deploy pipeline

**Status**: `pending`
**Service**: `xstockstrat-notify`
**Files**:
- `docker-compose.yml` — modify
- `.do/app.dev.yaml` — modify
- `.do/app.yaml` — modify
- `.github/workflows/deploy.yml` — modify
- `.github/workflows/deploy-dev.yml` — modify
- `.github/workflows/deploy-prod.yml` — modify
- `.github/workflows/prod-up.yml` — modify
- `scripts/do-inject-prod-secrets.py` — modify

**Reviewers**: Security — a vendor credential is a `type: SECRET` deploy-pipeline env var, never a
`secret.*` config key; new credential wiring follows the full `add-data-source.md` § "Wiring a New
Vendor Credential Through Deploy" checklist; xstockstrat-notify owner

**Codebase Evidence**:
- Both vars confirmed **absent** from all three deploy files:
  `grep -n "SLACK_WEBHOOK_URL\|SENDGRID_API_KEY" docker-compose.yml .do/app.yaml .do/app.dev.yaml` →
  no match.
- Notify `environment:` block in `docker-compose.yml:211-220` (keys `GRPC_PORT`, `CONFIG_ENDPOINT`,
  `LEDGER_ENDPOINT`, `WAIT_FOR`, `SERVICE_NAME`, `DB_POOL_MAX`, `OTEL_EXPORTER_OTLP_ENDPOINT`).
- Notify `envs:` block in `.do/app.yaml:373-399` and `.do/app.dev.yaml:377-...` (`- name:
  xstockstrat-notify`).
- Optional-credential precedent (mirror exactly, swapping FINNHUB→each new var):
  `deploy.yml:41-44` (`on.workflow_call.secrets` optional entry), `:64` (env in "Substitute app spec
  placeholders" step), `:94-96` (`content.replace('YOUR_DEV_FINNHUB_API_KEY', ...)` /
  `YOUR_PROD_...`); `deploy-dev.yml:54` (`FINNHUB_API_KEY: ${{ secrets.DEV_FINNHUB_API_KEY }}`);
  `deploy-prod.yml:53` (`${{ secrets.PROD_FINNHUB_API_KEY }}`); `prod-up.yml:50`;
  `scripts/do-inject-prod-secrets.py:49-51` (`OPTIONAL_PLACEHOLDER_KEYS` tuples).
- Checklist authority: `docs/runbooks/add-data-source.md` § "Wiring a New Vendor Credential Through
  Deploy" (rows 2–8); row 1 (`config.go`) is Go-only — N/A here (the Node env read is Step 2). Row 9
  (digitalocean.md) + row 10 (notify CLAUDE.md) are in Step 7.

**TDD**: `N/A (deploy config — no coverage-testable logic; the enable-iff-set read is tested in Step 3.
Verification is cross-file parity grep, mirroring migration offline verification)`

**Covers**: `—`

**Instructions**:
1. `docker-compose.yml` notify `environment:` block (`:211-220`): add
   `SLACK_WEBHOOK_URL: ${SLACK_WEBHOOK_URL:-}` and `SENDGRID_API_KEY: ${SENDGRID_API_KEY:-}` (empty
   default so an unset var is a valid disabled state — the optional-credential idiom).
2. `.do/app.dev.yaml` notify `envs:` block: append two entries, each
   `- key: SLACK_WEBHOOK_URL` / `scope: RUN_TIME` / `value: YOUR_DEV_SLACK_WEBHOOK_URL` /
   `type: SECRET`, and the `SENDGRID_API_KEY` counterpart with `value: YOUR_DEV_SENDGRID_API_KEY`.
3. `.do/app.yaml` notify `envs:` block: same two entries with `value: YOUR_PROD_SLACK_WEBHOOK_URL` /
   `YOUR_PROD_SENDGRID_API_KEY`.
4. `deploy.yml`: add `SLACK_WEBHOOK_URL:` and `SENDGRID_API_KEY:` under
   `on.workflow_call.secrets` (`required: false`, mirror the FINNHUB comment); add both to the
   `env:` of the "Substitute app spec placeholders" step; add the four `content.replace(...)` lines
   (`YOUR_DEV_SLACK_WEBHOOK_URL`/`YOUR_PROD_SLACK_WEBHOOK_URL`, `YOUR_DEV_SENDGRID_API_KEY`/
   `YOUR_PROD_SENDGRID_API_KEY`) beside the FINNHUB pair.
5. `deploy-dev.yml`: under the `deploy` job `secrets:`, add
   `SLACK_WEBHOOK_URL: ${{ secrets.DEV_SLACK_WEBHOOK_URL }}` and
   `SENDGRID_API_KEY: ${{ secrets.DEV_SENDGRID_API_KEY }}`.
6. `deploy-prod.yml`: add the `PROD_`-prefixed counterparts.
7. `prod-up.yml`: add both `PROD_`-prefixed entries to the "Render app spec with secrets" `env:` block.
8. `scripts/do-inject-prod-secrets.py`: add
   `("YOUR_PROD_SLACK_WEBHOOK_URL", "SLACK_WEBHOOK_URL")` and
   `("YOUR_PROD_SENDGRID_API_KEY", "SENDGRID_API_KEY")` to `OPTIONAL_PLACEHOLDER_KEYS` (both optional —
   empty key is a valid non-fatal disabled state).

**Verification**:
```bash
# Both vars present in all three deploy specs (compose + dev + prod):
grep -n "SLACK_WEBHOOK_URL\|SENDGRID_API_KEY" docker-compose.yml .do/app.dev.yaml .do/app.yaml
# Placeholders present in the workflow + injection surfaces:
grep -rn "YOUR_\(DEV\|PROD\)_SLACK_WEBHOOK_URL\|YOUR_\(DEV\|PROD\)_SENDGRID_API_KEY" \
  .github/workflows/deploy.yml scripts/do-inject-prod-secrets.py
grep -n "SLACK_WEBHOOK_URL\|SENDGRID_API_KEY" \
  .github/workflows/deploy.yml .github/workflows/deploy-dev.yml \
  .github/workflows/deploy-prod.yml .github/workflows/prod-up.yml
```
Confirm each var appears once per notify block/secrets list with the correct dev/prod value, and no
credential leaked into a `config.config_values` row (Step 1) or the notify `CLAUDE.md` Config Keys
table (Step 7). Parity across the three deploy specs is the C-10 check (ledger: DO↔compose parity).

---

### Step 7 — docs: notify CLAUDE.md, config-governance log, digitalocean secrets, product-spec note; context-scrubber

**Status**: `pending`
**Service**: `docs`
**Files**:
- `services/xstockstrat-notify/CLAUDE.md` — modify
- `docs/patterns/config-governance.md` — modify
- `docs/setup/digitalocean.md` — modify
- `docs/roadmap/features/020-notify-external-fanout/product-spec.md` — modify

**Reviewers**: none (docs)

**Codebase Evidence**:
- Notify `## Config Keys Consumed` table: `services/xstockstrat-notify/CLAUDE.md` (namespace `notify`,
  existing rows `notify.stream.max_subscribers`, `notify.alert.retention_days`,
  `notify.alert.max_body_bytes`). `## Environment Variables` block lists current env vars.
- Registered-keys log: `docs/patterns/config-governance.md:76` `## Per-Feature Registered Keys`;
  per-feature section pattern at `:123` (`### feature 129 — ...`), rows at `:133-137`.
- DigitalOcean secrets prose: `docs/setup/digitalocean.md:325-329` (FMP/FINNHUB "Secrets to set"
  subsections) and the GitHub Actions secrets table rows at `:455-458`.

**TDD**: `N/A (docs)`

**Covers**: `—`

**Instructions**:
1. `services/xstockstrat-notify/CLAUDE.md`:
   - Add the five `notify.fanout.*` keys to `## Config Keys Consumed` (key, type, default, description),
     matching the Step 1 table. Call out prominently in the `min_severity` row that **default 2
     (WARNING) excludes INFO fill confirmations** — an operator lowers it to `1` to fan out fills
     (design.md Open Risk).
   - Add `SLACK_WEBHOOK_URL` and `SENDGRID_API_KEY` to `## Environment Variables` as `type: SECRET`
     vendor credentials, noting: unset/empty ⇒ that channel is disabled; rotation requires redeploy
     (not a live config push); a short integration narrative (Slack incoming webhook + SendGrid v3
     mail send; best-effort, never affects the primary stream).
2. `docs/patterns/config-governance.md`: add a `### feature 020 — notify-external-fanout
   (xstockstrat-notify)` section under `## Per-Feature Registered Keys` with a five-row table for the
   `notify.fanout.*` keys (mirror the feature-129 block).
3. `docs/setup/digitalocean.md`: add a "Secrets to set" prose subsection for `SLACK_WEBHOOK_URL` /
   `SENDGRID_API_KEY` (mirror the FINNHUB subsection; note both optional — fanout is off until set) and
   the corresponding GitHub Actions secrets table rows
   (`DEV_SLACK_WEBHOOK_URL`/`PROD_SLACK_WEBHOOK_URL`, `DEV_SENDGRID_API_KEY`/`PROD_SENDGRID_API_KEY`).
4. `product-spec.md`: the FR-1/FR-2/FR-5 wording already reflects the hybrid severity+conviction gate
   and lists all five config keys (verified — the design-phase "reword" open thread is satisfied). Add
   one line under FR-4 / Env Var Changes cross-referencing the completed full-pipeline credential
   wiring (the 8-file surface, not 3) so the doc matches Step 6.
5. Run `/context-scrubber scan` scoped to the files this feature changed (this step's docs + the notify
   CLAUDE.md behavior change), and fix any grounded findings before pushing (root CLAUDE.md § Teardown).
   If the context-forge plugin is unavailable in the session, say so in the PR body rather than
   skipping silently.

**Verification**:
```bash
grep -n "notify.fanout" services/xstockstrat-notify/CLAUDE.md docs/patterns/config-governance.md
grep -n "SLACK_WEBHOOK_URL\|SENDGRID_API_KEY" services/xstockstrat-notify/CLAUDE.md docs/setup/digitalocean.md
```
Confirm all five keys appear in the notify CLAUDE.md Config Keys table and the config-governance log,
both credentials appear in the notify Environment Variables section and the digitalocean secrets
section, and the `min_severity`=WARNING-excludes-INFO caveat is present.

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._

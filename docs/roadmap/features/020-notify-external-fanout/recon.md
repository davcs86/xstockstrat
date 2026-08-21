# Recon: notify-external-fanout

**Created**: 2026-08-19
**From**: product-spec.md
**Affected services**: xstockstrat-notify, xstockstrat-config

---

## Objective

Add best-effort HTTP fanout (Slack incoming webhook + SendGrid email) to `xstockstrat-notify`'s
alert emission path, gated on a per-alert confidence threshold, with in-memory dedup, so a trader
receives time-sensitive alerts off-UI. Fanout must never affect the primary in-process alert stream.
Credentials are `type: SECRET` env vars; non-credential knobs are `notify.fanout.*` config keys.

## Codebase Map

- **`xstockstrat-notify`** (Node.js/TypeScript, gRPC 50059)
  - Entry point / startup wiring: `services/xstockstrat-notify/src/index.ts:14-44` (`ConfigWatcher('notify')` at `:18`, `waitForSnapshot(90_000)` at `:19`, impl construction at `:44`)
  - Handler/servicer: `NotifyServiceImpl.emitAlert` — `src/grpc/notifyServiceImpl.ts:30`; in-process fan-out loop to subscribers at `:82-93` (**the hook point** for best-effort HTTP fanout — after DB insert, alongside the stream write); `streamAlerts` server-stream at `:110`
  - Alert field origins on `call.request`: `severity, category, title, body, sourceService, targetUserId, context, tags, correlationId` — `notifyServiceImpl.ts:53-60`; `alertId = uuidv4()` `:38`; `now = new Date()` `:39`
  - Last migration: `001_notify_alerts.up.sql` (`services/xstockstrat-notify/migrations/`) — **no new notify migration needed** (in-memory dedup, no persisted fanout state)
  - Config-read pattern: typed getters `getFloat/getInt/getBool/getString` — `src/services/configWatcher.ts:83-100`; `this.config` injected but currently **unused** by emit logic — fanout is its first reader
  - Env reads today: `src/index.ts` (`GRPC_PORT`, `CONFIG_ENDPOINT`, `DATABASE_URL`, `DB_POOL_MAX`); `src/telemetry.ts` (`OTEL_*`, `APPLICATION_ENV`, `TRADING_MODE`)
  - Tests: `src/__tests__/notifyServiceImpl.test.ts` (only test file; compile-first `tsc && node --test`, inline `makePool/makeImpl/makeAlert` helpers `:38-62`); CI coverage threshold **40** (`.github/workflows/ci.yml:557-558`)
- **`xstockstrat-config`** (Node.js/TypeScript, gRPC 50060)
  - Seed pattern: `INSERT INTO config.config_values (...) ON CONFLICT (namespace,key,environment,trading_mode) DO NOTHING` — template `migrations/015_marketdata_finnhub.up.sql:22-30`; minimal single-float example `migrations/004_agent_config.up.sql:5-14`
  - Last migration: **016** (`016_deprecate_analysis_signal_source_weights_desc.up.sql`) → **next free = 017**
  - `value_type` domain: `CHECK (value_type IN ('string','int','float','bool','json'))` — `migrations/001_config_tables.up.sql:10`; serve-time oneof mapping `src/grpc/configServiceImpl.ts:462-467`
  - Generic key rendering lives in `xstockstrat-ui` (`src/app/config-ui/hooks/useConfigKeys.ts:22-26`, `[namespace]/NamespaceEditor.tsx`) — **no config-service code change** needed to surface `notify.fanout.*`

## Patterns to REUSE

- Reading `notify.fanout.*` config → reuse `ConfigWatcher.getFloat/getInt` (`configWatcher.ts:93,88`); `this.config` is already injected into `NotifyServiceImpl` (`notifyServiceImpl.ts:23`) — no new wiring.
- Seeding the four keys → reuse the `015_marketdata_finnhub.up.sql` multi-key seed shape (dev + production rows, `trading_mode='all'`) as migration **017**; match `value_type` to the reader's getter exactly (`float`→`getFloat`, `int`→`getInt`) to avoid the value_type/oneof-mismatch trap (ledger 2026-08-06 / migration 016 warning).
- SECRET credential wiring → reuse the vendor-credential-as-SECRET-env-var precedent already used by `015_marketdata_finnhub` (FMP/Finnhub) and documented in `docs/runbooks/add-data-source.md` § "Wiring a New Vendor Credential Through Deploy".
- Outbound HTTP → Node 22 global `fetch`/`undici` (no new dependency); this is the service's first outbound HTTP call.
- Best-effort side-effect that must not fail the primary path → mirror the agent's existing auto-alert `try/except` best-effort pattern in spirit (surface-don't-swallow: log at WARN with alert id + channel, never throw into the stream loop).

## Dependencies

- Proto/RPC: **no proto change** to `notify.proto`. **Critical finding:** `Alert`/`EmitAlertRequest` (`packages/proto/notify/v1/notify.proto:42,50`) has **no first-class `symbol`, `confidence`/`score`, or `recommended action` fields** — the only carriers are `context` (`google.protobuf.Struct`, field 7, `:57`) and `tags` (field 8, `:58`). FR-1/FR-2's confidence-threshold gate and FR-5's required payload fields must be sourced from `context`/`tags`.
- Migration: `xstockstrat-config` next number **017** (config seed for the 4 keys). `xstockstrat-notify`: none.
- Config keys (new): `notify.fanout.sendgrid_from_email` (string), `notify.fanout.sendgrid_to_email` (string), `notify.fanout.min_confidence_threshold` (float, 0.7), `notify.fanout.dedup_window_seconds` (int, 300).
- Inter-service edges: none new (fanout is outbound HTTP to external Slack/SendGrid, not internal gRPC — C-03 header propagation N/A).
- New env vars: `SLACK_WEBHOOK_URL`, `SENDGRID_API_KEY` (`type: SECRET`) — **confirmed absent** from `docker-compose.yml` (notify block at `:203`), `.do/app.yaml`, `.do/app.dev.yaml`; must be added to the notify block in all three.

## Risks / Not-found

- **Confidence source (design fork).** No `confidence` field exists on the alert proto. Where does the gate read the score — from `context["confidence"]` in the Struct? What if a given alert has no confidence in `context` (fail-open = fan out, or fail-closed = skip)? Must be decided in the debate, not guessed (P-03). Same for symbol/action in the FR-5 payload.
- **In-memory dedup semantics.** Dedup key (alert id? symbol+category? content hash?) and the window store are net-new; the map is lost on restart (accepted, in-memory V1 per spec). The dedup key choice determines whether "the same alert fired twice" (AC-5) is actually caught.
- **First outbound HTTP call in the service** — no existing timeout/retry/error pattern to copy; the design owns the timeout and the isolation guarantee (fanout timeout must not delay the stream write — AC-4).
- **SECRET env-var deploy parity** — the two vars must land in all three deploy files (ledger: DO↔compose parity traps, C-1 style). Enable-iff-set semantics.
- **value_type immutability trap** (ledger 2026-08-06, migration 016): declare the config keys' value_type to exactly match the reader's getter; a `float` key read with `getInt` silently returns the default.
- Not-found: no first-class proto fields for symbol/confidence/action; no existing outbound HTTP client; no existing dedup logic; no `notify.*` config keys today; no `src/__tests__/fixtures/` home (C-13: inline mocks fine until a 2nd consumer).

## Recommended Scope

Advisory step boundaries (input to grilling / `/sdd-spec`, not binding):
1. Config seed migration **017** for the four `notify.fanout.*` keys (+ paired verification).
2. `xstockstrat-notify`: a small fanout module (Slack + SendGrid HTTP senders, enable-iff-credential-set, timeout-bounded) + its unit test.
3. Wire the fanout call into `emitAlert`'s post-insert path: confidence gate (from `context`), in-memory dedup, best-effort/non-blocking dispatch + WARN logging + its unit test (red-before-green on the isolation + dedup + threshold behavior).
4. Deploy wiring: add `SLACK_WEBHOOK_URL` / `SENDGRID_API_KEY` (`type: SECRET`) to the notify block in `docker-compose.yml`, `.do/app.yaml`, `.do/app.dev.yaml`; update `services/xstockstrat-notify/CLAUDE.md` (Config Keys Consumed + Environment Variables).

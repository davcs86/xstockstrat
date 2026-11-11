# Implementation Spec: webhook-fanout-callback

**Status**: `pending`
**Created**: 2026-11-11
**Feature**: `docs/roadmap/features/334-webhook-fanout-callback/feature.md`
**Total Steps**: 22
**Feature Branch**: `feature/webhook-fanout-callback`

---

Paths: `notify/`, `ingest/`, `agent/`, `config/` abbreviate `services/xstockstrat-<name>/`. Every
`path:line` below was read on the tree `feature/webhook-fanout-callback@2529de1 ≡
origin/feature/webhook-fanout-callback` (contains `origin/main-dev@f99f667`). `recon.md` was written on
`main-dev@0481498`; the only drift in the affected paths since then is the telemetry modules (the
`Loop` enum is now at `ingest/app/telemetry.py:337`, the delivery unions at
`notify/src/telemetry.ts:319-332`).

## Execution Summary

Contracts first (Steps 1–2: both protos and their stubs, one commit), then storage (Step 3 config seed
and stored set, Step 4 notify table), then notify from the inside out (Steps 5–6 URL rule, 7–8
`FanoutWebhook` accept, 9–10 delivery worker), then ingest (Step 11 columns, 12–13 repository, 14–15
trigger-time validation, 16–17 hand-off loop), then one CI-run SQL assertion for the new statements
(Step 18), then the Agent consumer surface with its tool docs (Steps 19–21, one commit), and last the
backend docs (Step 22). Notify comes before ingest because ingest's two calls need the RPC semantics to
exist; the Agent comes after ingest because it pins an ingest error string.

**Consumer surface (C-14).** The product spec names one surface, the Agent tool `trigger_backfill`. It
is landed by Steps 19–21. UI: none, by decision in the product spec (backfills triggered from the UI
carry no callback).

**Two decisions taken here that the reviewer should check** (both recorded in `context.md`):

1. **Design open risk O-9 is upgraded, not confirmed.** `design.md` asks every SQL-adding step to run
   its statements against a scratch Postgres in the step's Verification. `/sdd-execute` forbids
   starting a database to verify a step and would replace such a Verification with an offline check
   (`.claude/skills/sdd-execute/SKILL.md:311-317`), so the mitigation would disappear without notice.
   `design.md` leaves O-9 "to be confirmed or upgraded at `/sdd-spec`". Step 18 therefore adds one SQL
   assertion file that the existing CI job `migration-rerun` runs against a migrated TimescaleDB
   (`scripts/migration-rerun.sh:768-780`). Step Verifications stay offline.
2. **The config seed (Step 3) is not in one atomic unit with its readers.** `step-constraints.md` §C
   pairs a seed with its reader, but six keys are read at three sites in two services (Steps 5, 9, 16),
   design D-15 fixes one migration, and a unit is capped at four steps. Each step still passes its own
   Verification alone: the step-time wiring check reports a missing leg as `PENDING`
   (`scripts/check-config-wiring.mjs:887-898`). `--final` runs in Step 17, after the last reader, and
   again in Step 22.

## Scenario Coverage (C-15)

| Scenario | Step(s) | Scenario | Step(s) | Scenario | Step(s) |
|---|---|---|---|---|---|
| AC-1 | 15, 17 | AC-11 | 10 | AC-21 | 13, 17 |
| AC-2 | 13, 15, 20 | AC-12 | 10 | AC-22 | 20 |
| AC-3 | 8, 15, 20 | AC-13 | 10 | AC-23 | 6, 8 |
| AC-4 | 6, 8, 15 | AC-14 | 10 | AC-24 | 8 |
| AC-5 | 6, 8 | AC-15 | 10 | AC-25 | 17 |
| AC-6 | 8 | AC-16 | 10 | AC-26 | 15, 20 |
| AC-7 | 8 | AC-17 | 17 | AC-27 | 8 |
| AC-8 | 10 | AC-18 | 17 | AC-28 | 8, 15 |
| AC-9 | 10 | AC-19 | 17 | AC-29 | 13, 17 |
| AC-10 | 10 | AC-20 | 17 | AC-30 | 17 |

AC-3 and AC-4 are proven in two halves (notify rejects; ingest maps the rejection and creates no job),
as `debate.md` O-12 requires. Step 18 re-proves AC-2, AC-7, AC-21 and AC-29 against real Postgres in CI.

## Step Dependencies

- Steps 1+2 land together: a `.proto` edit and its stubs (`step-constraints.md` §C row 2; CI
  `proto-freshness`, `.github/workflows/ci.yml:252`). No descriptor-parity guard covers
  `TriggerBackfillRequest` or any notify message (grep `covers_every_proto_field` / `fields_by_name`
  over `services/` finds only other messages).
- Step 2 needs the codegen toolchain, which is absent here (`which buf` finds nothing; Docker daemon
  unreachable). Provision it per `docs/runbooks/codegen-toolchain-host-setup.md` and pass its § 5
  empty-diff check **before** Step 1's edit.
- Step 3 needs a reachable Postgres 16 plus `psql` and `migrate` on `PATH` to **generate**
  `scripts/config-wiring-stored.json` (`scripts/config-wiring-stored.sh:2`). Found on 2026-11-11:
  `/usr/bin/psql`; a stopped cluster (`pg_lsclusters` → `16 main 5432 down`); no `migrate` on `PATH`
  (pinned `4.17.1`, `scripts/Dockerfile.migrate:6`). This is artifact generation, like `buf-gen.sh`,
  not verification. If no Postgres can be reached the step is blocked (P-03); the JSON is never written
  by hand.
- Steps 5+6, 7+8, 9+10 each land together: notify's `tsc` compiles the tests (`notify/tsconfig.json`
  `include: ["src/**/*"]`; `notify/package.json` `"test": "tsc && node --test …"`), so a test that
  imports a symbol the service step creates cannot fail for a behavioral reason alone (§C row 3).
- Step 7 requires Step 5 (the handler calls the allowlist helper) and Step 2 (generated request type).
- Step 9 requires Steps 4, 5 and 7 (table, rule, the row the handler writes).
- Step 13 [test] covers Step 12 [service]; no unit — Step 12 keeps every existing test green
  (`ingest/tests/test_backfill_jobs.py:14-28` asserts substrings only).
- Steps 14+15 land together: Step 14 makes four existing `MagicMock` requests take the validation path
  (`ingest/tests/test_ingest_servicer.py:301,330,385,1961` — an unset `req.callback_url` is truthy).
- Steps 16+17 land together: Step 16 adds a config read that `test_config_read_classification` rejects
  until `FR3_KEYS` lists it (`ingest/tests/test_config_read_classification.py:24-33`), and Step 17
  imports the module Step 16 creates.
- Step 16 requires Steps 12 and 14; Step 14 requires Steps 2 and 12.
- Step 18 requires Steps 4, 7, 9, 11 and 12 (it copies their final statements).
- Steps 19+20+21 land together: the `strat-lab` rule puts the skill change in the same PR as the tool
  change (root `CLAUDE.md` Context Guide; `docs/patterns/strat-lab-plugin.md`), and Step 20's AC-22
  parity test reads the Step 21 docs.
- Step 19 requires Step 14: it allow-lists the exact detail string Step 14 defines.
- **Volatile at merge** (ledger 2026-08-06, 2026-08-26): config `048` races features 330 / 280 / 299;
  `scripts/config-wiring-stored.json` stores the migration file name and a hash of the migration set
  (`scripts/config-wiring-stored.sh:16-24`), so a renumber or any other feature's config migration
  means regenerating it. Ingest `015` is pinned in `scripts/migration-rerun.sh` (Step 11).
  `notify/src/grpc/notifyServiceImpl.ts` is shared with 312 / 316; agent `tools.py` / `client.py` with
  314 / 319 / 322 / 328 / 331 / 299. Re-derive and rebase at the integration PR.
- C-16 promotion of this feature's `@AC-*` scenarios into the notify / ingest / agent suites (and the
  EXTEND cases listed in `design.md`) happens at the integration PR, not in a step.
- Deferred, outside this feature: the staging end-to-end against the live listener (upstream plan step
  S7), including the check that every environment's ingest certificate carries the SAN
  `xstockstrat-ingest`.

---

### Step 1 — proto: `callback_url` on `TriggerBackfillRequest`, `FanoutWebhook` on `NotifyService`

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/ingest/v1/ingest.proto` — modify
- `packages/proto/notify/v1/notify.proto` — modify

**Reviewers**: Proto Reviewer — field number uniqueness per message, no breaking change, `buf lint` / `buf breaking` pass; `packages/proto` owner — field number uniqueness, backward compatibility, naming; `xstockstrat-ingest` owner — idempotent ingestion; `xstockstrat-notify` owner — delivery guarantees

**Codebase Evidence**:
- `packages/proto/ingest/v1/ingest.proto:78-87` — `TriggerBackfillRequest` uses fields 1–7 (`data_kind = 7` at `:86`); 8 is free. `BackfillJob` (`:33-50`) is not touched (design D-16).
- `packages/proto/notify/v1/notify.proto:12-36` — `service NotifyService`; last RPC `UnregisterPushSubscription` at `:35`. `google/protobuf/struct.proto` is already imported (`:8`). Empty-response precedent `message MarkAlertReadResponse {}` (`:117`). Last message ends at `:140`.
- `packages/proto/buf.yaml:6-12` — lint `STANDARD` without `RPC_RESPONSE_STANDARD_NAME`; `RPC_REQUEST_STANDARD_NAME` applies, so the request is `FanoutWebhookRequest`.
- Not found anywhere in the repo: `callback_url`, `FanoutWebhook`, `validate_only`.

**Lands with**: `Step 2`

**TDD**: `N/A (proto)`

**Covers**: —

**Instructions**:
1. `ingest.proto`: after `:86` add `string callback_url = 8;` with a one-line comment: optional; empty = no callback; must be https and on notify's origin allowlist.
2. `notify.proto`: after `:35`, inside the service, add
   `rpc FanoutWebhook(FanoutWebhookRequest) returns (FanoutWebhookResponse);` with a comment stating:
   internal callers only (mTLS peer SAN), at-least-once delivery, `validate_only` checks the URL and
   stores nothing.
3. `notify.proto`: after `:140` add
   `message FanoutWebhookRequest { string callback_url = 1; string event_name = 2; google.protobuf.Struct payload = 3; string idempotency_key = 4; bool validate_only = 5; }`
   and `message FanoutWebhookResponse {}`.
4. No enum is added (C-04: there is no closed value set on the wire). No `user_id` field (platform rule `@AC-9 @feature-196`).

**Verification**:
```bash
cd packages/proto && buf lint && buf breaking --against "../../.git#branch=feature/webhook-fanout-callback,subdir=packages/proto"
```

---

### Step 2 — proto-gen: regenerate Go / Python / TypeScript stubs

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/go/ingest/v1/**` — modify (generated)
- `packages/proto/gen/go/notify/v1/**` — modify (generated)
- `packages/proto/gen/python/ingest/v1/**` — modify (generated)
- `packages/proto/gen/python/notify/v1/**` — modify (generated)
- `packages/proto/gen/ts/ingest/v1/**`, `packages/proto/gen/ts/dist/ingest/v1/**` — modify (generated)
- `packages/proto/gen/ts/notify/v1/**`, `packages/proto/gen/ts/dist/notify/v1/**` — modify (generated)

**Reviewers**: Proto Reviewer — field number uniqueness per message, no breaking change, `buf lint` / `buf breaking` pass; `packages/proto` owner — field number uniqueness, backward compatibility, naming; `xstockstrat-ingest` owner — idempotent ingestion; `xstockstrat-notify` owner — delivery guarantees

**Codebase Evidence**:
- `scripts/buf-gen.sh` exists (lint → breaking → generate → compile the TS package). Stubs are committed and checked by CI `proto-freshness` (`.github/workflows/ci.yml:252`).
- Toolchain is absent in this sandbox (`which buf` → not found). Host setup and the pre-edit empty-diff gate: `docs/runbooks/codegen-toolchain-host-setup.md` § 5 (`:103-128`). Pins: root `CLAUDE.md` § Language Versions (buf 1.72.0).
- Go fakes of `NotifyServiceClient` embed the interface, so a new RPC does not break them: `services/xstockstrat-trading/internal/service/trading_bracket_test.go:177`, `trading_resume_account_test.go:354`, `services/xstockstrat-marketdata/internal/service/marketdata_service_test.go:325`.
- Notify registers its implementation through an untyped cast (`notify/src/index.ts:47`), so it still compiles before Step 7 adds the handler.

**Lands with**: `Step 1`

**TDD**: `N/A (proto-gen)`

**Covers**: —

**Instructions**:
1. Before Step 1's edit: run `./scripts/buf-gen.sh` and confirm `git diff --stat packages/proto/gen/` is empty (runbook § 5). A non-empty diff is a toolchain mismatch; fix the toolchain, do not commit the noise.
2. After Step 1's edit: run `./scripts/buf-gen.sh`. Stage only the generated files under the `ingest/v1` and `notify/v1` subtrees listed above. Any other changed generated file is toolchain drift (ledger insight 2026-08-26): stop and resolve it rather than committing or reverting by guess.

**Verification**:
```bash
./scripts/buf-gen.sh
git diff --name-only packages/proto/gen/ | grep -v -E '/(ingest|notify)/v1/' | wc -l   # expect 0
for s in trading portfolio marketdata; do (cd services/xstockstrat-$s && GOWORK=off go vet ./...) || exit 1; done
cd services/xstockstrat-notify && pnpm run test
cd ../xstockstrat-ingest && uv run pytest -q
cd ../xstockstrat-agent && uv run pytest -q
```

---

### Step 3 — migration: seed the six config keys and regenerate the stored set

**Status**: `done`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/migrations/048_webhook_fanout_callback_keys.up.sql` — create
- `services/xstockstrat-config/migrations/048_webhook_fanout_callback_keys.down.sql` — create
- `scripts/config-wiring-stored.json` — modify (generated by `scripts/config-wiring-stored.sh`)

**Reviewers**: DBA — NNN numbering, up+down pair, run-order compliance with `scripts/db-migrate.sh`; `xstockstrat-config` owner — key naming, environment scoping, WatchConfig stream stability

**Codebase Evidence**:
- Last config migration: `047_config_alias_removal_rows` (`ls config/migrations`). Next is `048`.
- Seed template: `config/migrations/043_analysis_live_loop_keys.up.sql:8-23` — column list `(namespace, key, value_type, value_data, description, default_value, consuming_service, updated_by, environment, user_id)`, one row per environment, `ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING`. Down template: `043_analysis_live_loop_keys.down.sql` (deletes only rows this migration wrote and nobody rewrote).
- Stored keys must be relative: `config/migrations/045_config_keys_relative_check.up.sql:128-129` (`CHECK (left(key, length(namespace) + 1) <> namespace || '.')`). 043 itself predates this and uses the prefixed form — copy its shape, not its keys.
- Number-free actor sentinel `system:config-migration-feature-<slug>`: `docs/patterns/config-governance.md:142`.
- Empty-string seed precedent: `notify` / `fanout.sendgrid_from_email`, `value_type` `string`, `default_value` `''` (`scripts/config-wiring-stored.json`, file `018_notify_fanout.up.sql`).
- The wiring checker reads seeds only from `scripts/config-wiring-stored.json` (`scripts/check-config-wiring.mjs:219,248`); `--final` fails `STALE-STORED` when its `inputs_sha256` no longer matches the migration set (`:713-716`). CI job `config-wiring-stored` regenerates it and diffs (`.github/workflows/ci.yml:1247`).
- No key named `webhook.*` or `backfill.webhook_sweep_interval_seconds` exists in the stored set.

**TDD**: `N/A (migration)`

**Covers**: —

**Instructions**:
1. `048_…up.sql`: one `INSERT … ON CONFLICT … DO NOTHING` with 12 rows (6 keys × `staging`, `production`), `user_id` `NULL`, `updated_by` `'system:config-migration-feature-webhook-fanout-callback'`. `value_data` equals `default_value`. Every row has a non-empty `description` and `consuming_service`.

   | namespace | key | value_type | value / default | consuming_service |
   |---|---|---|---|---|
   | `notify` | `webhook.allowed_origins` | `string` | `''` | `xstockstrat-notify` |
   | `notify` | `webhook.max_attempts` | `int` | `8` | `xstockstrat-notify` |
   | `notify` | `webhook.backoff_base_seconds` | `int` | `30` | `xstockstrat-notify` |
   | `notify` | `webhook.backoff_max_seconds` | `int` | `3600` | `xstockstrat-notify` |
   | `notify` | `webhook.request_timeout_seconds` | `int` | `10` | `xstockstrat-notify` |
   | `ingest` | `backfill.webhook_sweep_interval_seconds` | `int` | `60` | `xstockstrat-ingest` |

   Descriptions say what the key controls and what changing it does (allowlist: comma-separated `host[:port]`, missing port = 443, empty rejects every callback URL). No metadata-backfill `UPDATE` (the keys are new; 043 needed one only for runtime-created rows) and no bounds-registry row (D-15).
2. `048_…down.sql`: delete only global `staging` / `production` rows of these six keys that still carry the sentinel in `updated_by` and the seeded `value_data` (the 043 down shape).
3. Regenerate the stored set: `DATABASE_URL=<scratch postgres> bash scripts/config-wiring-stored.sh`. Commit the result unedited. See Step Dependencies for the precondition and the blocked path.
4. Do not add a `findings` entry to `scripts/config-wiring.json` (ledger 2026-11-10: a seeded-and-read key produces no finding, so an entry would be `STALE`).

**Verification**:
```bash
ls services/xstockstrat-config/migrations/048_*.up.sql services/xstockstrat-config/migrations/048_*.down.sql
# read both: 12 rows, relative keys, sentinel actor; the down deletes exactly what the up inserts
node scripts/check-config-wiring.mjs --declared-migration services/xstockstrat-config/migrations/048_webhook_fanout_callback_keys.up.sql
#   exit 0; one "PENDING: …:seeded-unread" line per key, six in all (readers land in Steps 5, 9, 16)
test "$(node scripts/check-config-wiring.mjs --final | grep -c STALE-STORED)" = 0
node --test scripts/config-wiring.test.mjs
```

---

### Step 4 — migration: `notify.webhook_deliveries`

**Status**: `done`
**Service**: `xstockstrat-notify`
**Files**:
- `services/xstockstrat-notify/migrations/004_webhook_deliveries.up.sql` — create
- `services/xstockstrat-notify/migrations/004_webhook_deliveries.down.sql` — create

**Reviewers**: DBA — NNN numbering, up+down pair, index correctness, run-order compliance with `scripts/db-migrate.sh`; `xstockstrat-notify` owner — delivery guarantees

**Codebase Evidence**:
- Last notify migration: `003_alert_reads` (`ls notify/migrations`). Next is `004`.
- DDL template: `notify/migrations/002_push_subscriptions.up.sql:9-19` (`CREATE TABLE IF NOT EXISTS notify.…`, `UUID PRIMARY KEY DEFAULT gen_random_uuid()`, `TEXT NOT NULL UNIQUE`, `CREATE INDEX IF NOT EXISTS`); down `002_push_subscriptions.down.sql` (`DROP TABLE IF EXISTS`).
- Run order config → … → notify → ingest: `scripts/db-migrate.sh:151-177`.

**TDD**: `N/A (migration)`

**Covers**: —

**Instructions**:
1. Up: `CREATE TABLE IF NOT EXISTS notify.webhook_deliveries` with `delivery_id UUID PRIMARY KEY DEFAULT gen_random_uuid()`, `idempotency_key TEXT NOT NULL UNIQUE`, `callback_url TEXT NOT NULL`, `event_name TEXT NOT NULL`, `payload JSONB NOT NULL`, `source_service TEXT NOT NULL`, `state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','delivered','dead'))`, `attempts INT NOT NULL DEFAULT 0`, `next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`, `last_error TEXT`, `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`, `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`.
2. Up: `CREATE INDEX IF NOT EXISTS … ON notify.webhook_deliveries (next_attempt_at) WHERE state = 'pending'`.
3. Down: `DROP TABLE IF EXISTS notify.webhook_deliveries` (the index goes with it). No claim column, no second index (R-9, C-18).

**Verification**:
```bash
ls services/xstockstrat-notify/migrations/004_*.up.sql services/xstockstrat-notify/migrations/004_*.down.sql
# read both: the down drops the one table the up creates
```

---

### Step 5 — service: callback URL rule and allowlist helper (notify)

**Status**: `done`
**Service**: `xstockstrat-notify`
**Files**:
- `services/xstockstrat-notify/src/fanout/webhookUrlRule.ts` — create
- `scripts/config-wiring.json` — modify (one `registry.receivers` entry)

**Reviewers**: `xstockstrat-notify` owner — delivery guarantees; Security — SSRF control: https-only + origin allowlist enforced at one point (notify)

**Codebase Evidence**:
- **Not found** — no URL validation exists in `notify/src/`; this module is new. Outbound channels live in `notify/src/fanout/` (`fanout.ts`, `webPush.ts`, `deliveryChannels.ts`).
- Live config read with a literal default: `this.config.getInt('fanout.min_severity', 2)` (`notify/src/fanout/fanout.ts:62`); `getString(key, def = '')` (`notify/src/services/configWatcher.ts:203`). No JSON getter exists and none is added (R-6).
- Wiring attribution is per `"<file>:<receiver>"`: `scripts/check-config-wiring.mjs:546-547`; existing notify entries `scripts/config-wiring.json:121-122` (`…/fanout.ts:this.config`, `…/webPush.ts:this.config`); a bare-parameter receiver precedent `services/xstockstrat-ledger/src/services/eventRowResolver.ts:config`. An unregistered reader file fails the step-time check as `unattributed` (`:690,895`).
- Rate-limited log precedent (at most once per 60 s): `notify/src/fanout/webPush.ts` `reportAdminLookupError`.
- Config contract (C-05): namespace `notify`, key `webhook.allowed_origins`, `value_type` `string`, code default `''`, reader `notify/src/fanout/webhookUrlRule.ts:checkCallbackUrlAgainstConfig`, seed `config/migrations/048_webhook_fanout_callback_keys.up.sql` (Step 3), read live on every call through the `WatchConfig` snapshot.

**Lands with**: `Step 6`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Export a pure `parseAllowedOrigins(raw: string)` returning the set of canonical origins and a count of malformed entries. Entries are comma-separated and trimmed; an optional leading `https://` is stripped; each is parsed with WHATWG `URL` as `https://<entry>`; it must carry no userinfo, path (other than `/`), query or fragment; canonical form is `hostname:(port || 443)`. An empty or malformed entry never matches.
2. Export a pure `checkCallbackUrl(raw: string, allowedOriginsRaw: string)` returning `{ ok: true, href, origin }` or `{ ok: false, reason }`, where `reason` is one of a closed set of short class strings (too long, bad characters, unparseable, scheme, userinfo, trailing dot, origin not allowed). Checks, in order: length ≤ 2048; no ASCII whitespace or control character anywhere in the raw string (checked **before** parsing — WHATWG parsing strips them); parses; `protocol === 'https:'`; `username` and `password` empty; hostname has no trailing dot; `hostname:(port || 443)` is in the canonical set by **exact** equality. `href` is the re-serialized `href` of that same parse; `origin` is the canonical `host:port`.
3. Export `checkCallbackUrlAgainstConfig(config, raw)`: reads `config.getString('webhook.allowed_origins', '')` (string literal key, so the wiring check can join it), calls `checkCallbackUrl`, and logs one WARN with the malformed-entry count at most once per 60 s. This is the only reader of the key; Steps 7 and 9 go through it.
4. Never include the URL in a returned reason or a log line.
5. `scripts/config-wiring.json` → `registry.receivers`: add `"services/xstockstrat-notify/src/fanout/webhookUrlRule.ts:config": "notify"` (the receiver text must equal the parameter name used at the call site).

**Verification**:
```bash
node scripts/check-config-wiring.mjs --keys notify.webhook.allowed_origins   # silent, exit 0
node --test scripts/config-wiring.test.mjs
# behavior, lint and coverage: Step 6's Verification (one unit)
```

---

### Step 6 — test: URL rule (security matrix)

**Status**: `done`
**Service**: `xstockstrat-notify`
**Files**:
- `services/xstockstrat-notify/src/__tests__/webhookUrlRule.test.ts` — create

**Reviewers**: `xstockstrat-notify` owner — delivery guarantees; Security — SSRF control: every failure class of the guard has a negative test

**Codebase Evidence**:
- Harness: compiled-first, static import, hard "import succeeded" assertion — `notify/src/__tests__/fanout.test.ts:10-21`; run by `notify/package.json` `"test"` / `"test:coverage"`.
- Ledger 207 (2026-10-07): a security guard needs a test that fails on a simulated regression, and one negative test per failure class.
- C-13: the config stub here is a scenario one-off (`{ getString: () => '…' }`, same shape as `notify/src/__tests__/webPush.test.ts:115-116`). `fakeConfig` (`fanout.test.ts:27-33`) keeps its single consumer until Step 10 moves it.

**Lands with**: `Step 5`

**TDD**: `red-green required`

**Covers**: `AC-4, AC-5, AC-23`

**Instructions**:
1. With allowlist `webhooks.ts.example.net:8443`, assert every AC-5 row is rejected: `http://…:8443/hooks`, `https://webhooks.ts.example.net/hooks` (port 443), `…:9443/hooks`, `https://user@…:8443/hooks`, `https://evil.example.org:8443/hooks`, `https://webhooks.ts.example.net.evil.org:8443/h`, `https://webhooks.ts.example.net:8443@evil.org/h`, `ftp://…`, `not-a-url`.
2. AC-23: `HTTPS://WEBHOOKS.TS.EXAMPLE.NET:8443/hooks` is accepted and `origin` is the lower-case form.
3. AC-4: with allowlist `''` an otherwise valid URL is rejected.
4. Further cases (design test strategy): default vs explicit 443 on both the URL and the entry; an IDN host; a trailing-dot host; an IPv6 literal; a backslash before `@` (the verdict's host is the allowlisted origin or the URL is rejected — never another host); leading / embedded whitespace and a control character; a 2049-character URL; allowlist entries that are scheme-prefixed, malformed, empty, or carry a path.
5. **Tests MUST** include a suffix case (`…example.net.evil.org`), a prefix case (`evil-webhooks.ts.example.net`) and a substring case, each of which passes only under exact origin equality.
6. Weakened-rule run (ledger 207): temporarily change the origin comparison to `endsWith` / `includes`, run the suite, confirm it fails, restore. Record the failing output in the PR body and `context.md`.
7. `checkCallbackUrlAgainstConfig`: reads the key live (two calls with a changed stub value give two verdicts).

**Verification**:
```bash
cd services/xstockstrat-notify && pnpm run lint && pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40
grep -n "__tests__/fixtures" src/__tests__/webhookUrlRule.test.ts ; # C-13: none expected — one-off stub, single consumer
```

---

### Step 7 — service: `fanoutWebhook` accept handler (notify)

**Status**: `done`
**Service**: `xstockstrat-notify`
**Files**:
- `services/xstockstrat-notify/src/grpc/notifyServiceImpl.ts` — modify

**Reviewers**: `xstockstrat-notify` owner — delivery guarantees, alert deduplication; Security — caller gate on the verified peer SAN; rule enforced before the row is stored

**Codebase Evidence**:
- `notify/src/grpc/notifyServiceImpl.ts:20-31` — `class NotifyServiceImpl`, constructor `(pool, config, fanout, webPush)`; unchanged by this step, so every existing `makeImpl` call site compiles (`notify/src/__tests__/notifyServiceImpl.test.ts:51-54`).
- Handlers are found by name through an untyped cast (`notify/src/index.ts:47`): a missing or misnamed method compiles and answers `UNIMPLEMENTED` at run time.
- Error style is bare numeric codes: `callback({ code: 3, … })` (`:39`), `callback({ code: 13, … })` (`:120`). ts-proto request fields are camelCase and a `Struct` arrives as a plain object (`req.context`, `:60`).
- **Not found** — no caller gate of any kind in `notify/src/`. Peer-SAN precedents to copy: `services/xstockstrat-identity/src/grpc/adminDirectory.ts:6,12-25` (SAN-only, header-blind) and `services/xstockstrat-config/src/grpc/authz.ts:158-165`. Notify's server already requires a client certificate (`notify/src/mtls.ts:24`, `createSsl(ca, …, true)`).
- `EmitAlert` stays ungated; pinned by `notify/src/__tests__/notifyServiceImpl.test.ts:232`.
- Ledger 202: a validation goes before the idempotency claim.

**Lands with**: `Step 8`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
Add `async fanoutWebhook(call, callback)` to `NotifyServiceImpl`, plus a module constant allow-list `['xstockstrat-ingest']` and a local `peerDnsSans(call)` (copy of the identity helper; services share no code). Order — every check precedes the insert:
1. **Caller gate.** Read DNS SANs from `call.getAuthContext?.()?.sslPeerCertificate?.subjectaltname`. No SAN on the allow-list → `callback({ code: 7, … })`. No header is read (R-4). Keep the matched SAN.
2. **URL rule.** `checkCallbackUrlAgainstConfig(this.config, req.callbackUrl)` (Step 5). Failure → code 3, message `callback_url rejected: <reason>`; the URL is not echoed.
3. `req.validateOnly` → `callback(null, {})`. Nothing is written; `eventName`, `payload`, `idempotencyKey` are not looked at.
4. **Field validation.** `eventName` and `idempotencyKey` non-empty and ≤ 256 characters; `Buffer.byteLength(JSON.stringify(req.payload ?? {}))` ≤ 65536. Failure → code 3.
5. One `this.pool.query`: `INSERT INTO notify.webhook_deliveries (idempotency_key, callback_url, event_name, payload, source_service) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (idempotency_key) DO NOTHING`, `payload` as a JSON string, `source_service` = the matched SAN. A thrown query → `log.error` (no URL) and code 13; nothing is acknowledged.
6. `callback(null, {})` — also for a repeated key.

**Verification**:
```bash
grep -n "async fanoutWebhook" services/xstockstrat-notify/src/grpc/notifyServiceImpl.ts
# behavior, lint and coverage: Step 8's Verification (one unit)
```

---

### Step 8 — test: `fanoutWebhook` handler

**Status**: `done`
**Service**: `xstockstrat-notify`
**Files**:
- `services/xstockstrat-notify/src/__tests__/notifyServiceImpl.test.ts` — modify

**Reviewers**: `xstockstrat-notify` owner — delivery guarantees, alert deduplication; Security — gate and rule negatives

**Codebase Evidence**:
- Reuse `capturingPool` (`notify/src/__tests__/notifyServiceImpl.test.ts:455-466`, records `{sql, params}`) and `makePool(rows, throws)` (`:42-49`) from this same file — same-file reuse, no new fixture.
- Calls are plain objects: `impl.emitAlert({ request }, cb)` (`:333-335`); add `getAuthContext: () => ({ sslPeerCertificate: { subjectaltname: 'DNS:xstockstrat-ingest' } })`.
- `makeImpl` passes `{}` as config (`:53`); the new cases build the impl with a one-off `{ getString: () => 'webhooks.ts.example.net:8443' }`.

**Lands with**: `Step 7`

**TDD**: `red-green required`

**Covers**: `AC-3, AC-4, AC-5, AC-6, AC-7, AC-23, AC-24, AC-27, AC-28`

**Instructions**:
1. Method exists: `typeof (impl as any).fanoutWebhook === 'function'` (guards the untyped cast).
2. AC-27 and gate negatives: no `getAuthContext`; a SAN of `xstockstrat-agent`; an `x-internal-caller: ingest` header with the wrong SAN → code 7 and **zero** pool queries.
3. AC-5 / AC-3 / AC-4 (notify half): one disallowed URL, and an allowed-looking URL with allowlist `''` → code 3, zero pool queries, and the message does not contain the URL.
4. AC-6: a valid request → success; exactly one query, an `INSERT INTO notify.webhook_deliveries` with `ON CONFLICT (idempotency_key) DO NOTHING`, params carrying the key, the URL, the event name, the JSON payload and `xstockstrat-ingest`.
5. AC-7: the same request twice → both succeed; both statements are the conflict-safe insert (row uniqueness itself is asserted in Step 18).
6. AC-23: the upper-case URL of the scenario succeeds.
7. AC-24: a pool whose `query` throws → a non-OK code (13); the callback is called exactly once with an error.
8. AC-28: `validateOnly: true` with empty `eventName` / `idempotencyKey` → success and zero queries; the same call with a disallowed URL → code 3.
9. Field validation: empty `eventName`, a 257-character key, a payload over 64 KiB → code 3, zero queries.
10. The existing ungated-`EmitAlert` case (`:232`) is not edited and stays green.

**Verification**:
```bash
cd services/xstockstrat-notify && pnpm run lint && pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40
grep -n "__tests__/fixtures" src/__tests__/notifyServiceImpl.test.ts ; # C-13: unchanged import set; no new domain literal with a second consumer
```

---

### Step 9 — service: delivery worker, dead-letter alert, wiring (notify)

**Status**: `done`
**Service**: `xstockstrat-notify`
**Files**:
- `services/xstockstrat-notify/src/fanout/webhookWorker.ts` — create
- `services/xstockstrat-notify/src/grpc/notifyServiceImpl.ts` — modify (extract two functions from `emitAlert`)
- `services/xstockstrat-notify/src/telemetry.ts` — modify (`DeliveryChannel`, `DeliveryOutcome`)
- `services/xstockstrat-notify/src/index.ts` — modify (start / stop)
- `scripts/config-wiring.json` — modify (one `registry.receivers` entry)

**Reviewers**: `xstockstrat-notify` owner — delivery guarantees, backpressure handling, alert deduplication; Security — rule re-checked before every request, redirects never followed, URL never logged

**Codebase Evidence**:
- **Not found** — notify has no background loop and no stop hook (`notify/CLAUDE.md` § Observability: "No tick loops"). The worker is new.
- Boot and shutdown: `notify/src/index.ts:49-57` (`bindAsync`, `grpcServer.start()` at `:54`), `:59-67` (`shutdown`; `pool.end()` at `:66`, forced path at `:62-65`). Boot order is load-bearing (NOTIFY-9) and `log.info('delivery channels', …)` at `:44` is pinned verbatim (`notify/src/__tests__/deliveryChannelsLog.test.ts:69-74`) — leave both alone.
- Single DB connection: `max: parseInt(process.env.DB_POOL_MAX ?? '1', 10)` (`index.ts:35`). "Reuse the injected pool — no new pool (F-06)" (`notify/src/fanout/webPush.ts:108`); statements are single `this.pool.query` calls.
- POST with a hard timeout: `notify/src/fanout/fanout.ts:130-158` (`AbortController` + `setTimeout`, `clearTimeout` in `finally`, `error?.name === 'AbortError'` → timeout at `:153`). No `redirect:` option is set anywhere today (fetch default is `follow`).
- `emitAlert` (`notifyServiceImpl.ts:34-122`): insert `:45-65`, alert object `:68-81`, stream broadcast `:83-95`, success callback `:98-101`, two `queueMicrotask` side-channel dispatches `:105-117`. `webPush.dispatch(alert, md?)` accepts a missing metadata (`webPush.ts:89`).
- Environment mapping: `appEnv === 'production' ? … PRODUCTION : … STAGING` (`notify/src/services/configWatcher.ts:81-82`).
- Telemetry: `DeliveryChannel` (`notify/src/telemetry.ts:319`), `DeliveryOutcome` (`:320-332`), `recordDelivery` (`:346`). No test or catalog enumerates the channel values (grep `admin_lookup_error` finds only `fanout.ts`, `webPush.ts`, `telemetry.ts`, `notify/CLAUDE.md`, a findings report); the allowlist test checks label **keys** (`notify/src/__tests__/telemetryAllowlist.test.ts:9-13,84-95`).
- `clamp` is already declared twice (`fanout.ts:16`, `webPush.ts:23`); do not add a third.
- Header propagation (step-constraints §B): this step adds no outbound gRPC call. The POST is external HTTPS and carries no platform header.
- Config contract (C-05), all namespace `notify`, `value_type` `int`, seed Step 3, read live per use from the `WatchConfig` snapshot, reader `notify/src/fanout/webhookWorker.ts:WebhookWorker`: `webhook.max_attempts` (8), `webhook.backoff_base_seconds` (30), `webhook.backoff_max_seconds` (3600), `webhook.request_timeout_seconds` (10, clamped to 1–60). A stored value ≤ 0 reads as the default.

**Lands with**: `Step 10`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. **Extraction** in `notifyServiceImpl.ts` (pure; behavior of `emitAlert` unchanged): move `:41-96` (ids, insert, alert object, broadcast, the `Alert emitted` log) into a method that returns the alert, and `:105-117` into a method that queues the two side-channel dispatches. `emitAlert` becomes validate → first method → `callback` → second method, keeping callback-before-side-channels. Add one public method the worker calls: first method, then second method with no metadata.
2. **`WebhookWorker`** (`webhookWorker.ts`), constructor `(pool, config, emitAlert)` where `emitAlert` is a function taking the alert fields. Code constants (D-8 fixes that they are constants, not their values — proposed): tick period 5000 ms, at most 4 attempts in flight.
   - `start()`: `setInterval` (unref'd) calling `tick()`. `stop()`: clears the timer and aborts in-flight requests; their rows stay `pending`.
   - `tick()`: skip if a tick is running. One `pool.query` selecting `state = 'pending' AND next_attempt_at <= NOW()` rows whose `delivery_id` is not in the in-flight set, `ORDER BY next_attempt_at`, limited to the free slots. For each row: add to the in-flight set and start `attempt(row)` **without awaiting**, with its own `.catch` and a `finally` that removes it from the set. `tick()` has its own `try/catch`. Nothing is logged per tick.
   - `attempt(row)`: (a) `checkCallbackUrlAgainstConfig(this.config, row.callback_url)`; failure → dead with `last_error` `url rejected: <reason>`, **no request**, attempts not incremented. (b) `fetch(verdict.href, { method: 'POST', redirect: 'manual', signal, headers: { 'Content-Type': 'application/json', 'Idempotency-Key': row.idempotency_key }, body })` with body `{ event_name, payload: { source_service, environment, occurred_at, data } }` — `data` = the stored payload, `occurred_at` = `created_at` as RFC 3339, `environment` = `'production'` when `APPLICATION_ENV === 'production'`, else `'staging'`. Timeout = `request_timeout_seconds` (positive-or-default, then `Math.min(60, Math.max(1, v))`). Cancel the response body; never read it.
   - Outcome, each recorded by **one** statement guarded `WHERE delivery_id = $1 AND state = 'pending'`, `updated_at = NOW()`: 2xx → `delivered`, `attempts + 1`. 408 / 429 / 5xx / network error / timeout → `attempts + 1`; `dead` when the new count ≥ `max_attempts`, else `pending` with `next_attempt_at = NOW() + make_interval(secs => $n)`. 3xx, an opaque redirect, any other 4xx → `dead`, `attempts + 1`. An unexpected throw inside an attempt records a retry best-effort.
   - Export a pure `backoffDelaySeconds(attemptNumber, base, max)` = `min(base · 2^(attemptNumber − 1), max)`; the statement receives its result as the `secs` parameter (the timestamp is still computed by the database clock).
   - `last_error` is a class string only: `http <status>`, `timeout`, `network: <code>`, `redirect not followed`, `url rejected: <reason>`. Never a body, never the URL.
   - Dead-letter, only when the dead statement changed a row (`rowCount` 1): `recordDelivery('webhook', 'dead')` and `log.error` (event name, origin, idempotency key — no URL) **first**, then `emitAlert` with severity WARNING, category `webhook`, `sourceService` `xstockstrat-notify`, no target, title `Webhook delivery dead: <event_name> → <origin>`, body carrying the idempotency key, the attempt count and `last_error`. A failing alert is caught and logged.
   - Config keys are read with string-literal keys through `this.config.getInt(...)`.
3. **Telemetry**: add `'webhook'` to `DeliveryChannel` and `'dead'` to `DeliveryOutcome`. Record `sent` on 2xx and `http_error` / `timeout` / `error` on a retried attempt (existing values).
4. **`index.ts`**: construct the worker after `notifyImpl` (`:43`), passing a closure over the new public method. Call `start()` inside the `bindAsync` callback after `grpcServer.start()` (`:54`). In `shutdown`, call `stop()` first, so it precedes `pool.end()` (`:66`) and the forced exit (`:63-64`). Do not touch `:44`.
5. `scripts/config-wiring.json` → `registry.receivers`: add `"services/xstockstrat-notify/src/fanout/webhookWorker.ts:this.config": "notify"`.

**Verification**:
```bash
node scripts/check-config-wiring.mjs --keys notify.webhook.max_attempts,notify.webhook.backoff_base_seconds,notify.webhook.backoff_max_seconds,notify.webhook.request_timeout_seconds   # silent, exit 0
grep -n "pool.connect\|BEGIN" services/xstockstrat-notify/src/fanout/webhookWorker.ts ; # expect no match (F-06)
grep -c "log.info('delivery channels', describeDeliveryChannels(fanout, webPush));" services/xstockstrat-notify/src/index.ts ; # expect 1
# behavior, lint and coverage: Step 10's Verification (one unit)
```

---

### Step 10 — test: delivery worker

**Status**: `done`
**Service**: `xstockstrat-notify`
**Files**:
- `services/xstockstrat-notify/src/__tests__/webhookWorker.test.ts` — create
- `services/xstockstrat-notify/src/__tests__/fixtures/stubFetch.ts` — create
- `services/xstockstrat-notify/src/__tests__/fixtures/fakeConfig.ts` — create
- `services/xstockstrat-notify/src/__tests__/fanout.test.ts` — modify (import the two fixtures; delete the local copies)
- `services/xstockstrat-notify/src/__tests__/notifyServiceImpl.test.ts` — modify (import `stubFetch`; delete the local copy)

**Reviewers**: `xstockstrat-notify` owner — delivery guarantees, backpressure handling, alert deduplication; Security — redirect and re-check negatives

**Codebase Evidence**:
- `stubFetch` is declared twice already (`notify/src/__tests__/fanout.test.ts:40-48`, `notifyServiceImpl.test.ts:340-348`); `fakeConfig` once (`fanout.test.ts:27-33`). The worker suite is the next consumer of both, so they move to the fixture home `notify/src/__tests__/fixtures/` (holds only `collectingReader.ts` today) — C-13, `debate.md` O-11.
- Metric assertions: `install`, `points`, `counterValue` from `notify/src/__tests__/fixtures/collectingReader.ts` (used at `fanout.test.ts:14`, `notifyServiceImpl.test.ts:25`).
- Source-order assertion precedent for `index.ts`: `notify/src/__tests__/deliveryChannelsLog.test.ts:69-74`.
- The existing emit / fanout / push suites in `notifyServiceImpl.test.ts` (`:178-470`, `:552-595`, `:711-741`) are the characterization tests for the Step 9 extraction; they are not edited beyond the import.

**Lands with**: `Step 9`

**TDD**: `red-green required`

**Covers**: `AC-8, AC-9, AC-10, AC-11, AC-12, AC-13, AC-14, AC-15, AC-16`

**Instructions**:
1. Fixtures: `stubFetch` gains a per-call responder (status, a thrown network error, an `AbortError`, a 302 with `Location`), keeping the `stubFetch(status)` call shape the two existing suites use. `fakeConfig` moves unchanged. Repoint both existing suites.
2. A scripted pool fake local to this file: returns configured rows for the due-select and records every `{sql, params}`; it exposes no `connect`.
3. AC-8: target 201 → one POST to the stored URL with `Content-Type: application/json` and `Idempotency-Key`; body has `event_name`, `payload.source_service` `xstockstrat-ingest`, `payload.environment` `staging`, an RFC 3339 `payload.occurred_at` equal to the row's `created_at`, `payload.data.job_id` / `.status`; a recursive walk finds no `user_id` key; the delivered statement runs; `notify.delivery{channel=webhook,outcome=sent}` is 1 (the `@AC-31 @feature-294` extension).
4. AC-9 (408, 429, 500, 503, refused connection, timeout): the retry statement runs with attempts incremented and a positive `secs` parameter; the row is not dead.
5. AC-10 (400, 404, 413, 422): the dead statement runs; one WARNING alert whose title names `ingest.backfill.completed` and `webhooks.ts.example.net:8443`.
6. AC-11: `max_attempts` 3, a row with 2 attempts, 503 → dead with 3 attempts and one alert.
7. AC-12: `backoffDelaySeconds` with base 30, max 120 gives 30, 60, 120, 120 for attempts 1–4; the retry statement's `secs` parameter equals it.
8. AC-13: row A's fetch never settles until aborted, row B answers 201; after one `tick()` B is delivered while A is still in flight; then A times out → pending, 1 attempt.
9. AC-14: a **new** worker over a pool that already returns a pending row delivers it; no handler call is involved.
10. AC-15: allowlist changed to `''` → fetch is **not** called; the row is dead; one WARNING alert.
11. AC-16: 302 with `Location: https://evil.example.org/hooks`. **Tests MUST** assert the request was sent with `redirect: 'manual'`, that fetch ran exactly once, and that the row is dead.
12. Two dead rows produce alerts with different bodies (platform rule 020 `@AC-5`: identical alerts are deduplicated).
13. No `BEGIN` statement and no `pool.connect` call across the suite.
14. A pool whose `query` rejects inside an attempt raises no `unhandledRejection` (listen on `process` for the test).
15. The URL string appears in no `last_error` parameter, alert title/body, or captured log line.
16. `stop()` aborts an in-flight request and no outcome statement marks its row.
17. `src/index.ts` source order: the worker's `start()` comes after `grpcServer.start()` and its `stop()` before `pool.end()`.
18. Record in `context.md` that the dead-letter metric and ERROR log precede the alert (design open risk "a dead-letter alert whose insert fails is lost"), with the test that fails the alert and still sees both.

**Verification**:
```bash
cd services/xstockstrat-notify && pnpm run lint && pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40
grep -n "__tests__/fixtures\|fixtures/" src/__tests__/webhookWorker.test.ts src/__tests__/fanout.test.ts src/__tests__/notifyServiceImpl.test.ts
grep -c "^function stubFetch\|^function fakeConfig" src/__tests__/*.test.ts | grep -v ":0" ; # expect no line (C-13: no inline copy left)
```

---

### Step 11 — migration: `callback_url` and hand-off markers on `ingest.backfill_jobs`

**Status**: `done`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/migrations/015_backfill_webhook_callback.up.sql` — create
- `services/xstockstrat-ingest/migrations/015_backfill_webhook_callback.down.sql` — create
- `scripts/migration-rerun.sh` — modify (one literal)

**Reviewers**: DBA — NNN numbering, up+down pair, run-order compliance with `scripts/db-migrate.sh`; `xstockstrat-ingest` owner — idempotent ingestion

**Codebase Evidence**:
- Last ingest migration: `014_contract_signal_ownership` (`ls ingest/migrations`). Next is `015`.
- Additive-column template: `ingest/migrations/012_backfill_data_kind.up.sql` (`ALTER TABLE ingest.backfill_jobs ADD COLUMN IF NOT EXISTS …`) and its down (`DROP COLUMN IF EXISTS`).
- `backfill_jobs_status_idx` already exists (`ingest/migrations/003_backfill_jobs.up.sql:22`); no new index (D-12, C-18).
- **Break radius not in `recon.md`:** `scripts/migration-rerun.sh:760` asserts `ingest:14` as the clean end state of the CI job `migration-rerun` (`.github/workflows/ci.yml:894`). With `015` present the recovery `db-migrate.sh up` at `:759` ends at 15 and the job fails. The same job runs `015.down` (`refuse_down ingest 13 014` at `:743` does `goto 13` from the tip) and then re-applies `015.up`, so both files must be re-runnable.

**TDD**: `N/A (migration)`

**Covers**: —

**Instructions**:
1. Up: `ALTER TABLE ingest.backfill_jobs ADD COLUMN IF NOT EXISTS callback_url text, ADD COLUMN IF NOT EXISTS webhook_enqueued_at timestamptz, ADD COLUMN IF NOT EXISTS webhook_rejected_at timestamptz;` — all nullable, no default.
2. Down: `DROP COLUMN IF EXISTS` for the three columns.
3. `scripts/migration-rerun.sh:760`: change `ingest:14` to `ingest:15`. Nothing else in the script changes (`:150` `goto 12` and `:743` describe the feature-224/225 states and stay).

**Verification**:
```bash
ls services/xstockstrat-ingest/migrations/015_*.up.sql services/xstockstrat-ingest/migrations/015_*.down.sql
# read both: three ADD COLUMN IF NOT EXISTS ↔ three DROP COLUMN IF EXISTS
grep -n "for want in ingest:15 analysis:27" scripts/migration-rerun.sh
bash -n scripts/migration-rerun.sh
# the replay itself is proven by CI job migration-rerun on the first PR that carries this step
```

---

### Step 12 — service: backfill-job repository functions (ingest)

**Status**: `pending`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/app/repositories/backfill_jobs.py` — modify

**Reviewers**: `xstockstrat-ingest` owner — idempotent ingestion

**Codebase Evidence**:
- `ingest/app/repositories/backfill_jobs.py:29-56` — `insert_job` (keyword-only args, static SQL, seven columns). Only production caller: `ingest/app/handlers/servicer.py:437`.
- `:13-26` `_UPDATABLE_COLUMNS` and `:59-77` `update_job` — the dynamic `SET` path (INGEST-2). Not extended.
- `:80-85` `get_job` is `SELECT *`, so new columns reach `job_row_to_proto` (`servicer.py:291-321`), which reads named keys only — `BackfillJob` stays unchanged (D-16).
- The module is proto-free; status ints are passed in (`:123-144` `reconcile_interrupted`, INGEST-1).
- **Not found** — no query for "terminal with an unset marker".

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. `insert_job`: add keyword `callback_url: str | None = None`; add the column and `$8` to the static INSERT. Existing callers are unaffected.
2. Add `list_webhook_handoff_candidates(db_pool, *, terminal_statuses: list[int], limit: int) -> list[dict]`: static SQL selecting rows with `callback_url IS NOT NULL AND status = ANY($1::smallint[]) AND webhook_enqueued_at IS NULL AND webhook_rejected_at IS NULL`, `ORDER BY completed_at, created_at`, `LIMIT $2`.
3. Add `mark_webhook_enqueued(db_pool, job_id) -> bool` and `mark_webhook_rejected(db_pool, job_id) -> bool`: static `UPDATE … SET <marker> = NOW() WHERE job_id = $1::uuid AND webhook_enqueued_at IS NULL AND webhook_rejected_at IS NULL`; return whether a row changed.
4. Do not add the new columns to `_UPDATABLE_COLUMNS`; do not import `ingest_pb2`.

**Verification**:
```bash
cd services/xstockstrat-ingest && ruff check . && ruff format --check . && uv run pytest -q tests/test_backfill_jobs.py
grep -n "ingest_pb2" app/repositories/backfill_jobs.py ; # expect no match (INGEST-1)
```

---

### Step 13 — test: backfill-job repository functions

**Status**: `pending`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/tests/test_backfill_jobs.py` — modify
- `services/xstockstrat-ingest/tests/_helpers.py` — modify (`job_row`)

**Reviewers**: `xstockstrat-ingest` owner — idempotent ingestion

**Codebase Evidence**:
- Pattern: `pool = AsyncMock()`, then assert on `pool.execute.await_args.args` / `pool.fetch.await_args.args` (`ingest/tests/test_backfill_jobs.py:14-28`, `:83-96`).
- `ingest/tests/_helpers.py:62-89` — `job_row` holds exactly the 16 DDL columns ("Do not add a key the database cannot produce"); consumers: `test_ingest_servicer.py`, `test_cancel_backfill.py`, `test_ingest_telemetry.py`. Migration `015` (Step 11) makes it 19.

**TDD**: `red-green required`

**Covers**: `AC-2, AC-21, AC-29`

**Instructions**:
1. `job_row`: add `callback_url: None`, `webhook_enqueued_at: None`, `webhook_rejected_at: None`; update the docstring count to 19 and name migration 015.
2. `insert_job` with a `callback_url` binds it as the eighth value and the SQL names the column (AC-2); without it the bound value is `None`.
3. `list_webhook_handoff_candidates`: the SQL contains each of the four predicates and the ordering; the status list and limit are bound (AC-21: no callback / not terminal; AC-29: a set marker excludes the row).
4. Both marker functions: the SQL carries both `IS NULL` guards; the return value follows the driver's `UPDATE 1` / `UPDATE 0` status.
5. C-13: `job_row` is the canonical helper in `tests/_helpers.py` and already has several consumers; no new inline row literal is added.

**Verification**:
```bash
cd services/xstockstrat-ingest && ruff check . && ruff format --check . && uv run pytest --cov=app --cov-fail-under=40
grep -n "job_row\|from tests._helpers" tests/test_backfill_jobs.py
```

---

### Step 14 — service: trigger-time validation of `callback_url` (ingest)

**Status**: `pending`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/app/handlers/servicer.py` — modify

**Reviewers**: `xstockstrat-ingest` owner — idempotent ingestion; Security — fail closed; notify stays the single enforcement point

**Codebase Evidence**:
- `ingest/app/handlers/servicer.py:406-459` — `TriggerBackfill`: db check `:407-409`, admin gate `:412-414`, `job_id` `:415`, `propagation_meta` `:416`, timeframe `INVALID_ARGUMENT` `:431-436`, `insert_job` `:437-446`, queued event `:447-454`, `create_task` `:455`.
- `self._notify` is `None` without a channel (`:336`).
- Header propagation (step-constraints §B): Python per-method `metadata`. `_propagation_meta` (`:362-367`) returns the `x-user-id` / `x-access-scope` / `x-trace-id` trio and is already passed as `metadata=propagation_meta` to notify (`:500`).
- `context.abort` raises in production and in the test fake (`ingest/tests/conftest.py:44`), so it must not sit inside the `try` that classifies the RPC error.

**Lands with**: `Step 15`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Add a module constant with the fixed detail, exactly: `"callback_url could not be validated; no job was created"`. Step 19 allow-lists this string in the agent.
2. In `TriggerBackfill`, between `:436` and `:437`, when `request.callback_url` is non-empty: if `self._notify is None` the verdict is `UNAVAILABLE` + the constant. Otherwise call `self._notify.FanoutWebhook(notify_pb2.FanoutWebhookRequest(callback_url=request.callback_url, validate_only=True), metadata=propagation_meta, timeout=5)` (5 s is a code constant). Classify inside `try/except`, abort **after** it:
   - OK → continue.
   - `INVALID_ARGUMENT` → `INVALID_ARGUMENT` with notify's detail (it carries a reason, never the URL).
   - `PERMISSION_DENIED` → `log.error` and `FAILED_PRECONDITION` with a fixed message naming a notify caller-gate misconfiguration.
   - any other gRPC code, a timeout, or any other exception → `UNAVAILABLE` + the constant.
3. In every non-OK case return before `insert_job`: no row, no ledger event, no task.
4. Pass `callback_url=request.callback_url or None` to `insert_job` (Step 12).
5. A request without `callback_url` makes no notify call (FR-2).

**Verification**:
```bash
grep -n "FanoutWebhook" -A6 services/xstockstrat-ingest/app/handlers/servicer.py | grep -n "metadata=propagation_meta"
grep -c '"callback_url could not be validated; no job was created"' services/xstockstrat-ingest/app/handlers/servicer.py ; # expect 1
# behavior, lint and coverage: Step 15's Verification (one unit)
```

---

### Step 15 — test: `TriggerBackfill` with `callback_url`

**Status**: `pending`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/tests/test_ingest_servicer.py` — modify

**Reviewers**: `xstockstrat-ingest` owner — idempotent ingestion; Security — fail-closed negatives

**Codebase Evidence**:
- `ingest/tests/test_ingest_servicer.py:297-416` — `TestTriggerBackfill`; requests are `MagicMock()` at `:301`, `:330`, `:353`, `:366`, `:385`, `:402`, and `:1961` (`TestFundamentalsBackfill`). The ones that reach `insert_job` (`:301`, `:330`, `:385`, `:1961`) need `req.callback_url = ""`.
- Fixtures: `make_servicer` (`:34-66`), `_ctx` (`ingest/tests/conftest.py:17-45`; `"4"` = admin; metadata is the trio), `rpc_error(code, details)` (`ingest/tests/_helpers.py:92-94`).
- `svc._notify` is replaced per test (`:489-490`).

**Lands with**: `Step 14`

**TDD**: `red-green required`

**Covers**: `AC-1, AC-2, AC-3, AC-4, AC-26, AC-28`

**Instructions**:
1. Set `req.callback_url = ""` on the four existing requests listed above; change nothing else in them.
2. AC-1: no `callback_url`, `svc._notify` a mock → `FanoutWebhook` is never awaited; `insert_job` receives `callback_url=None`; status `QUEUED`.
3. AC-2 / AC-28: an allowed URL → `FanoutWebhook` awaited once with `validate_only=True`, the URL, `metadata` equal to the context trio and `timeout=5`; `insert_job` receives the URL; a `job_id` is returned.
4. AC-3 / AC-4 (ingest half): `FanoutWebhook` raises `rpc_error(INVALID_ARGUMENT, "callback_url rejected: origin not allowed")` → abort `INVALID_ARGUMENT` with that detail; `insert_job` not awaited; `create_task` not called.
5. AC-26: `FanoutWebhook` raises `UNAVAILABLE`; again with `DEADLINE_EXCEEDED`; again with `svc._notify = None` → abort `UNAVAILABLE` with exactly the fixed detail; no insert, no task.
6. `PERMISSION_DENIED` → abort `FAILED_PRECONDITION`; an ERROR record is logged; no insert.
7. Order: a non-admin context with a `callback_url` aborts `PERMISSION_DENIED` and never calls notify; a non-`1d` timeframe aborts `INVALID_ARGUMENT` and never calls notify.
8. C-13: the request mocks are per-test scenario objects, as today; no domain literal gains a second consumer.

**Verification**:
```bash
cd services/xstockstrat-ingest && ruff check . && ruff format --check . && uv run pytest --cov=app --cov-fail-under=40
grep -n "from tests.conftest\|from tests._helpers" tests/test_ingest_servicer.py
```

---

### Step 16 — service: hand-off loop, wake-up, config reader (ingest)

**Status**: `pending`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/app/engine/webhook_handoff_loop.py` — create
- `services/xstockstrat-ingest/app/handlers/servicer.py` — modify (wake-up event; five sites)
- `services/xstockstrat-ingest/app/config/watcher.py` — modify (one property)
- `services/xstockstrat-ingest/app/telemetry.py` — modify (`Loop` member)
- `services/xstockstrat-ingest/app/main.py` — modify (start the loop)

**Reviewers**: `xstockstrat-ingest` owner — idempotent ingestion

**Codebase Evidence**:
- Loop shape to copy: `ingest/app/engine/mcp_client_loop.py:184-223` (`run_one_cycle`, extracted for tests, ends with `log_tick_ok`) and `:226-238` (interval re-read each iteration, wait first, cycle errors caught and logged, never exits).
- Terminal-status write sites (the `update_job` awaits): T1 `servicer.py:539-545` (FAILED), T2 `:575-582` (COMPLETED / PARTIAL), T3 `:650-657` (COMPLETED), T4 `:700-708` (FAILED / PARTIAL / COMPLETED; also reached by T7 `_resume_job` `:776`), T5 `:939-944` (CANCELED). T6 is the bulk reconcile `ingest/app/repositories/backfill_jobs.py:136-143`, called at `ingest/app/main.py:71-77`; it has no servicer and is covered by the interval tick.
- Servicer state is set in `__init__` (`servicer.py:325-343`).
- `ingest/app/main.py:119-120` `resume_incomplete_jobs()`; `:122-130` the non-fatal `create_task` pattern for a loop.
- Config helpers: `ingest/app/config/watcher.py:109-135` (`backfill_*` properties) and `int_positive` (`:143-146`). The receiver `…/app/config/watcher.py:int_positive` is already registered to `ingest` (`scripts/config-wiring.json:108`), so a property here needs no registry entry.
- `Loop` is a closed `StrEnum` (`ingest/app/telemetry.py:337-340`, one member); every `log_tick_ok` argument must be a `Loop.<MEMBER>` attribute and the enum holds at most 8 (`ingest/tests/test_telemetry_allowlist.py:149-156`).
- Background metadata precedent: `meta = (("x-trace-id", str(uuid.uuid4())),)` (`servicer.py:762`). Best-effort alert shape: `_emit_backfill_alert` (`servicer.py:478-503`).
- Header propagation (step-constraints §B): the loop's `FanoutWebhook` and `EmitAlert` calls have no inbound request, so there is no trio to forward; they carry a minted `x-trace-id` only (D-14; recorded in the ingest constitution in Step 22). No `x-user-id: system` is sent.
- Config contract (C-05): namespace `ingest`, key `backfill.webhook_sweep_interval_seconds`, `value_type` `int`, code default `60`, reader `ingest/app/config/watcher.py:ConfigWatcher.backfill_webhook_sweep_interval_seconds`, seed Step 3, re-read on every loop iteration from the `WatchConfig` snapshot; a stored ≤ 0 reads as 60.

**Lands with**: `Step 17`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. `watcher.py`: after `:135` add property `backfill_webhook_sweep_interval_seconds` returning `int_positive(self, "backfill.webhook_sweep_interval_seconds", 60)`.
2. `telemetry.py`: add `WEBHOOK_HANDOFF = "webhook_handoff"` to `Loop`.
3. `servicer.py`: create `self._webhook_wake = asyncio.Event()` in `__init__`; call `self._webhook_wake.set()` immediately after the terminal `update_job` await at T1, T2, T3, T4 and T5. No notify call is added on any of these paths.
4. `webhook_handoff_loop.py`:
   - Code constants: batch size (proposed 50), gRPC timeout 5 s.
   - `run_one_cycle(servicer)`: return if `servicer._db` or `servicer._notify` is `None`. Fetch candidates with `backfill_jobs.list_webhook_handoff_candidates` for the four terminal statuses (COMPLETED, PARTIAL, FAILED, CANCELED), oldest first. For each row build the payload from **row columns only**, with exactly these keys: `job_id`, `status` (enum name without `BACKFILL_STATUS_`), `data_kind`, `symbols`, `bars_processed`, `failed_symbols`, `started_at`, `completed_at` (ISO 8601 strings, or null). No `error` key. Event name: `ingest.backfill.completed` for COMPLETED and PARTIAL, `ingest.backfill.failed` for FAILED, `ingest.backfill.canceled` for CANCELED. Key: `backfill:<job_id>:<STATUS>`. Call `servicer._notify.FanoutWebhook(...)` with `metadata=(("x-trace-id", <new uuid>),)` and the timeout.
     - OK → `mark_webhook_enqueued`.
     - `INVALID_ARGUMENT` → `mark_webhook_rejected` **first**; then, if it changed a row, one best-effort `EmitAlert` (WARNING, category `backfill`, title naming the job, body with notify's reason and no URL, tag `job_id:<id>`), wrapped in its own `try/except`.
     - any other code or exception → end the cycle: `log.error` for `PERMISSION_DENIED`, `log.warning` otherwise.
     - If the cycle did not end early, `log_tick_ok(log, Loop.WEBHOOK_HANDOFF, <ms>, state="idle" if no candidates else None)`.
   - `run_webhook_handoff_loop(servicer, cfg_watcher)`: `while True`: read the interval from the property; wait for `servicer._webhook_wake` with the interval as timeout; clear the event; run one cycle inside `try/except Exception` that logs and continues. The wait comes **before** the first cycle (open risk O-17).
5. `main.py`: after `:120`, start the loop with `asyncio.create_task(...)` inside a non-fatal `try/except`, as `:122-130` does.

**Verification**:
```bash
grep -n "_webhook_wake.set()" services/xstockstrat-ingest/app/handlers/servicer.py | wc -l ; # expect 5
grep -n "ingest_pb2" services/xstockstrat-ingest/app/repositories/backfill_jobs.py ; # expect no match
# behavior, lint, coverage and the final wiring check: Step 17's Verification (one unit)
```

---

### Step 17 — test: hand-off loop

**Status**: `pending`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/tests/test_webhook_handoff_loop.py` — create
- `services/xstockstrat-ingest/tests/test_config_read_classification.py` — modify (`FR3_KEYS`)
- `services/xstockstrat-ingest/tests/test_config_watcher.py` — modify (reader test)
- `services/xstockstrat-ingest/tests/test_ingest_servicer.py` — modify (wake-up at T1–T4)
- `services/xstockstrat-ingest/tests/test_cancel_backfill.py` — modify (wake-up at T5)

**Reviewers**: `xstockstrat-ingest` owner — idempotent ingestion

**Codebase Evidence**:
- Loop test pattern: `ingest/tests/test_mcp_client_loop.py:153-170` (patch the wait, raise a stop exception, assert the interval) and `:140-150` (drive `run_one_cycle` directly).
- Fixtures: `job_row` (`ingest/tests/_helpers.py:62`, now with the three new keys), `rpc_error` (`:92-94`), `snapshot_watcher` (`ingest/tests/conftest.py:71-99`, a dial-free real `ConfigWatcher`), `make_servicer` (`test_ingest_servicer.py:34-66`), `patch_chunk_repo` (`:447-464`).
- `FR3_KEYS` (`ingest/tests/test_config_read_classification.py:24-33`) must list every clamped read; the key matches `_ZERO_SENSITIVE` (`:47-49`).
- Existing terminal-path tests to extend: `TestRunBackfill` (`test_ingest_servicer.py:467+`), `test_cancel_running_job_transitions_to_canceled` (`test_cancel_backfill.py:39-54`).
- Platform rules: `@AC-6 @feature-244` (a stored 0 clamps to the default), `@AC-2/@AC-3 @feature-278` (a reader test whose stored value differs from the default).

**Lands with**: `Step 16`

**TDD**: `red-green required`

**Covers**: `AC-1, AC-17, AC-18, AC-19, AC-20, AC-21, AC-25, AC-29, AC-30`

**Instructions**:
1. AC-17 (four statuses): a candidate row per status → `FanoutWebhook` awaited with the mapped `event_name`, key `backfill:job-1:<STATUS>`, payload `job_id` and `status`; `mark_webhook_enqueued` awaited after the call returns. The same four tests assert the terminal write path made **no** `FanoutWebhook` call and set `_webhook_wake` (below).
2. AC-18: `FanoutWebhook` raises `UNAVAILABLE` → no marker function is awaited; the cycle ends; the job's terminal `update_job` and ledger event in the existing `TestRunBackfill` cases are unchanged.
3. AC-19: first cycle fails `UNAVAILABLE`, second succeeds → one marker write; a third cycle with no candidates makes no call.
4. AC-20: `INVALID_ARGUMENT` → `mark_webhook_rejected` awaited before `EmitAlert`; exactly one WARNING alert whose title names the job and whose body has no URL; `mark_webhook_enqueued` not awaited; a second cycle with no candidates makes no call. A raising `EmitAlert` does not fail the cycle.
5. AC-21 / AC-29 / AC-1: with no candidates returned, no `FanoutWebhook` call; assert the status list passed to the repository is exactly the four terminal values.
6. AC-25: a FAILED row with `error="interrupted by restart"` and a `callback_url` → `ingest.backfill.failed`, key `backfill:job-6:FAILED`, reached with the event never set (interval path).
7. AC-30: a FAILED row with `error="internal: peer ipv4:10.0.0.7:50053"` → the payload's key set equals the eight names; no `error` key; the error text appears nowhere in the request.
8. A non-OK, non-`INVALID_ARGUMENT` code on the first of two rows → the second is not attempted. `PERMISSION_DENIED` logs at ERROR.
9. Loop: with the event unset and a stubbed wait that times out, the cycle runs only after the wait (wait-first, O-17); a set event runs a cycle without waiting for the interval; the event is cleared before the cycle.
10. Config: `snapshot_watcher(**{"backfill.webhook_sweep_interval_seconds": 0})` reads 60; a stored 45 reads 45. Add the key to `FR3_KEYS`.
11. Wake-up (C-10), one assertion per write site: T1 (runner exception), T2 (fundamentals), T3 (empty plan), T4 (`_finalize_backfill`, also through `_resume_job`) and T5 (`CancelBackfill`) each leave `svc._webhook_wake.is_set()` true.
12. `main.py` source order: the loop is started after `resume_incomplete_jobs()` (O-17).
13. C-13: rows come from `job_row`; no new inline job literal with a second consumer.

**Verification**:
```bash
cd services/xstockstrat-ingest && ruff check . && ruff format --check . && uv run pytest --cov=app --cov-fail-under=40
grep -n "from tests._helpers\|from tests.conftest" tests/test_webhook_handoff_loop.py
cd ../.. && node scripts/check-config-wiring.mjs --declared-from docs/roadmap/features/334-webhook-fanout-callback/product-spec.md   # silent, exit 0
node scripts/check-config-wiring.mjs --final   # exit 0; no line for a webhook key (all six keys seeded and read)
```

---

### Step 18 — migration: CI assertion for the new SQL (design open risk O-9)

**Status**: `pending`
**Service**: `scripts/` (xstockstrat-notify, xstockstrat-ingest)
**Files**:
- `scripts/migration-assertions/webhook-fanout-callback.sql` — create

**Reviewers**: DBA — index correctness, statements valid against the migrated schema; `xstockstrat-notify` owner — delivery guarantees; `xstockstrat-ingest` owner — idempotent ingestion

**Codebase Evidence**:
- CI job `migration-rerun` (`.github/workflows/ci.yml:894`) runs `scripts/migration-rerun.sh` against a fresh TimescaleDB; after all migrations are applied it runs every `scripts/migration-assertions/*.sql` except `fixtures-*` and pre-contract `config-NNN` files (`scripts/migration-rerun.sh:768-780`) through `psql -v ON_ERROR_STOP=1 -f` (`run_assertion`, `:204-208`). A new file needs no harness change. The path filter `scripts/migration-assertions/**` triggers the job (`ci.yml:94`).
- File shape: `DO $$ … RAISE EXCEPTION … END $$;` blocks (`scripts/migration-assertions/ingest-014.sql`). A number-free name survives a merge-time renumber.
- Ledger 2026-11-10 (296): a harness change never run against a real database cost one CI cycle per defect — budget the iterations.
- `/sdd-execute` forbids starting a database to verify a step (`.claude/skills/sdd-execute/SKILL.md:311-317`); this file is run by CI only.

**TDD**: `N/A (migration — SQL assertion executed only by CI job migration-rerun)`

**Covers**: —

**Instructions**:
Write one file, wrapped in `BEGIN; … ROLLBACK;`, that leaves no row behind. Copy each statement from its source as shipped (Steps 7, 9, 12) using `PREPARE` / `EXECUTE` so the `$n` shape is kept. Assert with `RAISE EXCEPTION`:
1. Notify accept (Step 7): the insert run twice with one key leaves exactly one row, in state `pending`, attempts 0 (AC-6, AC-7).
2. `state = 'bogus'` is refused by the CHECK.
3. The partial index on `(next_attempt_at) WHERE state = 'pending'` exists.
4. Worker statements (Step 9): the due-select returns the row and omits it when its id is in the in-flight parameter; the retry statement increments attempts and moves `next_attempt_at` forward by the bound seconds; the delivered and dead statements change one `pending` row and zero rows once the row is no longer `pending`.
5. Ingest (Step 12): the insert stores `callback_url` with both markers NULL (AC-2); the candidate select returns a terminal row with a callback, and returns nothing for a RUNNING row, a row without a callback, and a row with either marker set (AC-21, AC-29); each marker update changes one row, then zero.
6. First line: a comment naming the feature, the scenarios, and "run by migration-rerun.sh after all migrations".

If `DATABASE_URL` already points at the scratch Postgres used in Step 3, also run `scripts/db-migrate.sh up` and this file against it before pushing. Do not start a database for this step. Budget two CI iterations.

Residual risk, to record in `context.md`: the statements are copies, so the source and this file can drift; the unit tests of Steps 8, 10 and 13 pin the statement text on the source side.

**Verification**:
```bash
ls scripts/migration-assertions/webhook-fanout-callback.sql
grep -c "^PREPARE\|RAISE EXCEPTION" scripts/migration-assertions/webhook-fanout-callback.sql
# by inspection: each PREPARE body equals the statement in notifyServiceImpl.ts / webhookWorker.ts / backfill_jobs.py
# proof: CI job "Migration rerun (idempotent replay)" green on the first PR that carries this step
```

---

### Step 19 — service: `trigger_backfill` gains `callback_url` (agent)

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/tools.py` — modify
- `services/xstockstrat-agent/app/client.py` — modify

**Reviewers**: `xstockstrat-agent` owner — MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity

**Codebase Evidence**:
- Tool: `agent/app/tools.py:1542-1586` — signature `:1543-1552`, docstring `:1553-1570` ("Ingest performs NO synchronous input validation — it queues unconditionally", `:1568-1569`), client call `:1573-1582`, error mapping `:1583-1586` (`write=True`).
- Error mapper: `_PASS_THROUGH_CODES` includes `INVALID_ARGUMENT` and `FAILED_PRECONDITION` (`:226-237`); an `UNAVAILABLE` detail passes only when it is in `pass_messages` (`:275`), otherwise the caller sees "upstream unavailable; outcome unknown, verify before retrying" (`:278-279`). Existing sets: `_SCORE_UNAVAILABLE_PASS`, `_OFFLINE_UNAVAILABLE_PASS` (`:240-241`), pinned against backend sources by `agent/tests/test_tool_errors.py:178-189`.
- Client: `agent/app/client.py:2063-2137` — docstring `:2073-2082` (same "queues unconditionally" claim), request build `:2114-2121`, metadata `:2133`, call with `_LONG_RPC_TIMEOUT_S` (45 s, `:45`) at `:2136`.
- Header propagation (step-constraints §B): no new outbound call; the existing `TriggerBackfill` call and its `_metadata(...)` are reused. Ingest's added 5 s validate call sits inside the 45 s deadline (`@AC-5/@AC-10 @feature-273`).
- Tool count stays 45 (`agent/tests/test_tools_endpoint.py:14`); no tool is added.

**Lands with**: `Step 20, Step 21`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. `client.py`: add parameter `callback_url: str = ""`; after the request is built (`:2121`), set `req.callback_url = callback_url` only when non-empty. Correct the docstring: ingest validates a non-empty `callback_url` synchronously (https + allowlisted origin, decided by notify) and creates no job when it is rejected or cannot be validated; everything else still queues unconditionally.
2. `tools.py`: add `callback_url: str = ""` to the tool signature and pass it through. Next to `:240-241` add `_BACKFILL_UNAVAILABLE_PASS = frozenset({"callback_url could not be validated; no job was created"})` (the Step 14 string) and pass `pass_messages=_BACKFILL_UNAVAILABLE_PASS` at `:1584-1585`.
3. `tools.py` docstring: document `callback_url` (optional; https; origin must be on the operator allowlist; the job's terminal event is POSTed there at least once; an invalid URL is an immediate `INVALID_ARGUMENT`, a validation outage an immediate `UNAVAILABLE` with no job created) and correct the "NO synchronous input validation" sentence.
4. Do not echo `callback_url` in the tool's return value (D-16).

**Verification**:
```bash
grep -n "callback_url" services/xstockstrat-agent/app/tools.py services/xstockstrat-agent/app/client.py
# behavior, lint and coverage: Step 20's Verification (one unit)
```

---

### Step 20 — test: `trigger_backfill` `callback_url` and docs parity (agent)

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_client.py` — modify
- `services/xstockstrat-agent/tests/test_tools.py` — modify
- `services/xstockstrat-agent/tests/test_tool_errors.py` — modify
- `services/xstockstrat-agent/tests/test_tools_endpoint.py` — modify

**Reviewers**: `xstockstrat-agent` owner — MCP tool contract stability and `docs/runbooks/mcp-tools.md` parity

**Codebase Evidence**:
- `agent/tests/test_client.py:493-644` — `TestTriggerBackfillClient` (stub capture pattern at `:503-522`).
- `agent/tests/test_tools.py:1638-1666` — `TestTriggerBackfillTool` (`_tool_fn`, `_ctx(ADMIN)`, `_rpc_error`).
- `agent/tests/test_tool_errors.py:22-24,178-189` — backend-string pin reading other services' sources through `_ROOT`.
- `agent/tests/test_tools_endpoint.py:91-97` — runbook / skill parity pattern; `:125-136` — the catalog schema assertion for `trigger_backfill` (`symbols` only).

**Lands with**: `Step 19, Step 21`

**TDD**: `red-green required`

**Covers**: `AC-2, AC-3, AC-22, AC-26`

**Instructions**:
1. Client: a `callback_url` argument reaches `TriggerBackfillRequest.callback_url`; without it the field is empty (AC-2: the call still returns `job_id`).
2. Tool: the argument is forwarded as `callback_url=` to `client.trigger_backfill`; default `""`.
3. AC-3: an `INVALID_ARGUMENT` with detail `callback_url rejected: origin not allowed` surfaces as a `ToolError` carrying that detail.
4. AC-26: an `UNAVAILABLE` with the fixed detail surfaces as `UNAVAILABLE: callback_url could not be validated; no job was created` and does **not** contain "outcome unknown"; an `UNAVAILABLE` with any other detail still gets the generic write tail.
5. `test_unavailable_pass_strings_match_backend_sources`: assert the quoted fixed string is present in `services/xstockstrat-ingest/app/handlers/servicer.py` and that `tools._BACKFILL_UNAVAILABLE_PASS` equals the one-element set.
6. Catalog: `"callback_url"` is in `trigger_backfill`'s `inputSchema.properties`.
7. AC-22: `docs/runbooks/mcp-tools.md` (its `trigger_backfill` section) and `plugins/strat-lab/skills/backtest/reference/backfill.md` each name `callback_url` and state `https` and the allowlist; `plugins/strat-lab/skills/backtest/SKILL.md` names `callback_url`.
8. C-13: literals are per-test scenario values; no fixture home is created.

**Verification**:
```bash
cd services/xstockstrat-agent && ruff check . && ruff format --check . && uv run pytest --cov=app --cov-fail-under=40
grep -n "conftest\|def .*fixture" tests/test_tools.py tests/test_client.py | head -5
```

---

### Step 21 — docs: tool reference and the `strat-lab` skill

**Status**: `pending`
**Service**: `docs/runbooks/`, `plugins/strat-lab/`, `xstockstrat-agent`
**Files**:
- `docs/runbooks/mcp-tools.md` — modify
- `docs/runbooks/historical-backfill.md` — modify
- `services/xstockstrat-agent/CLAUDE.md` — modify
- `plugins/strat-lab/skills/backtest/reference/backfill.md` — modify
- `plugins/strat-lab/skills/backtest/SKILL.md` — modify
- `plugins/strat-lab/.claude-plugin/plugin.json` — modify
- `plugins/strat-lab/.cursor-plugin/plugin.json` — modify

**Reviewers**: none

**Codebase Evidence**:
- `docs/runbooks/mcp-tools.md:959-991` — `trigger_backfill` section: parameter table `:968-975`, errors `:983-989` ("**No synchronous error** — ingest queues unconditionally", `:988`).
- `docs/runbooks/historical-backfill.md:103-122` — "Via MCP tool" example.
- `services/xstockstrat-agent/CLAUDE.md:65` — tool-table row.
- `plugins/strat-lab/skills/backtest/reference/backfill.md:12-20` — steps 2–3 (trigger, then "Wait by polling"); `plugins/strat-lab/skills/backtest/SKILL.md:205-212` — Phase 1.
- Both manifests are at `"version": "0.4.0"` (line 4 of each) and must stay byte-identical (`docs/patterns/strat-lab-plugin.md:52-55`). Validator: `plugins/strat-lab/scripts/validate.py` (not in CI).

**Lands with**: `Step 19, Step 20`

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. `mcp-tools.md`: add the `callback_url` row (optional; https; origin on the operator allowlist `notify.webhook.allowed_origins`; terminal event POSTed at least once with an `Idempotency-Key`; not returned by `get_backfill_status`). Errors table: add the `INVALID_ARGUMENT` (URL rejected, no job) and `UNAVAILABLE` (could not be validated, no job) rows and narrow the "No synchronous error" row to symbols / provider failures. Show the POST body shape from product-spec FR-10.
2. `historical-backfill.md`: add `callback_url` to the MCP example and one sentence that polling `get_backfill_status` is then optional.
3. Agent `CLAUDE.md:65`: mention the optional `callback_url`.
4. `reference/backfill.md` and `SKILL.md`: `callback_url` as the alternative to polling, the https + allowlist rule, the two immediate errors, and that polling stays the fallback when no listener is available. Quote any frontmatter value that contains `: `.
5. Bump both `plugin.json` versions to `0.5.0`.

**Verification**:
```bash
python3 plugins/strat-lab/scripts/validate.py --self-test && python3 plugins/strat-lab/scripts/validate.py
grep -n '"version"' plugins/strat-lab/.claude-plugin/plugin.json plugins/strat-lab/.cursor-plugin/plugin.json
grep -c "callback_url" docs/runbooks/mcp-tools.md plugins/strat-lab/skills/backtest/reference/backfill.md plugins/strat-lab/skills/backtest/SKILL.md
```

---

### Step 22 — docs: notify, ingest, config and platform references

**Status**: `pending`
**Service**: `docs/`, `xstockstrat-notify`, `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-notify/CLAUDE.md` — modify
- `services/xstockstrat-notify/docs/context-constitution.md` — modify
- `services/xstockstrat-ingest/CLAUDE.md` — modify
- `services/xstockstrat-ingest/docs/context-constitution.md` — modify
- `docs/patterns/config-governance.md` — modify
- `docs/patterns/database.md` — modify
- `docs/patterns/inter-service-mtls.md` — modify
- `CLAUDE.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `services/xstockstrat-notify/CLAUDE.md`: RPC list `:24-27`, Authorization `:43-55`, Dependencies `:62-68`, Config Keys Consumed `:70-81`, Observability `:110-116` ("No `loop tick ok` (no tick loops)"; instrument label sets).
- `services/xstockstrat-notify/docs/context-constitution.md`: rules `NOTIFY-1`, `NOTIFY-3` … `NOTIFY-9` (`:16-23`); next free ID is `NOTIFY-10`.
- `services/xstockstrat-ingest/CLAUDE.md`: Dependencies `:58-66`, Database `:68-106` (`backfill_jobs` at `:91-100`), Config Keys Consumed `:108-126`, Observability `:157-162` (loop list at `:161`).
- `services/xstockstrat-ingest/docs/context-constitution.md`: `INGEST-1` … `INGEST-11` (`:20-30`); next free ID is `INGEST-12`.
- `docs/patterns/config-governance.md:144-148` — Per-Feature Registered Keys, newest first.
- `docs/patterns/database.md:16-20` — plain tables are named in prose below the hypertable map.
- `docs/patterns/inter-service-mtls.md:55-66` — the list of SAN-gated grants (not in `design.md`'s doc list; it enumerates every such grant, so the new one belongs there — C-10).
- Root `CLAUDE.md:223` (notify pool row, "alert history only") and `:312-313` (dependency block).

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. Notify `CLAUDE.md`: add `FanoutWebhook` to the RPC list; a short Authorization paragraph (SAN-only gate, allow-list `xstockstrat-ingest`, `EmitAlert` still ungated); the five `webhook.*` rows; Observability (channel `webhook`, outcome `dead`, the worker has no per-tick log); the `webhook_deliveries` table and migration `004`; Dependencies (outbound HTTPS to allowlisted origins); and one SQL line to requeue dead rows after an allowlist mistake (design open risk).
2. Notify constitution: one new rule `NOTIFY-10` — the in-memory in-flight set is the claim and assumes one instance; the worker never holds the DB connection across HTTP; the URL rule runs on accept and before every attempt.
3. Ingest `CLAUDE.md`: the three `backfill_jobs` columns and migration `015`; the config key row; the `webhook_handoff` loop in Observability; notify dependency reason.
4. Ingest constitution: one new rule `INGEST-12` — one hand-off path, started after `resume_incomplete_jobs` and waiting first; once per job; payload from the row only, no `error`; background calls carry a minted `x-trace-id` only (C-03 note).
5. `config-governance.md`: a `feature 334` entry at the top of the log with the six keys (namespace, relative key, type, default, reader), the seed migration slug, and "no `scripts/config-wiring.json` baseline entry".
6. `database.md`: one sentence naming `notify.webhook_deliveries` as a plain table.
7. `inter-service-mtls.md`: add notify `FanoutWebhook` ← `xstockstrat-ingest` (SAN is the only check).
8. Root `CLAUDE.md`: pool-table note for notify (alert history and the webhook delivery queue; pool max unchanged at 1) and a dependency line `xstockstrat-notify → external HTTPS (allowlisted webhook origins)`.
9. Comments-vs-docs rule (root `CLAUDE.md` § How to Act #5): mechanism and history go here, not into code comments.

**Verification**:
```bash
node scripts/check-config-wiring.mjs --doc-check
node scripts/check-config-wiring.mjs --final
python3 scripts/check-otel-produced-signals.py
grep -n "FanoutWebhook" services/xstockstrat-notify/CLAUDE.md docs/patterns/inter-service-mtls.md
grep -n "NOTIFY-10" services/xstockstrat-notify/docs/context-constitution.md
grep -n "INGEST-12" services/xstockstrat-ingest/docs/context-constitution.md
```

---

## Deviation Log

### Deviation: Step 1 — `buf breaking` baseline
**Spec said**: `cd packages/proto && buf lint && buf breaking --against "../../.git#branch=feature/webhook-fanout-callback,subdir=packages/proto"`
**Actual**: `buf lint && buf breaking . --against "../../.git#branch=origin/main-dev,subdir=packages/proto" --exclude-path trading/v1/trading.proto` (the form of CI job `proto-lint`, `.github/workflows/ci.yml:250`). Both exit 0; the same check without `--exclude-path` also exits 0.
**Reason**: `/sdd-review impl-spec` warning (C-09): against the feature branch the check compares the change with itself once committed. The baseline is the dev trunk.
**Disposition**: review warning applied; stricter than the step body.

### Deviation: Steps 1+2 — codegen toolchain runs in the `Dockerfile.codegen` image
**Spec said**: "Provision it per `docs/runbooks/codegen-toolchain-host-setup.md`" (Step Dependencies) and `./scripts/buf-gen.sh` (Step 2 Verification), i.e. a host-installed toolchain.
**Actual**: `buf` and `./scripts/buf-gen.sh` ran inside the version-pinned image built from `Dockerfile.codegen` (`docker build --secret id=proxy_ca,src=/root/.ccr/ca-bundle.crt -t xstockstrat-codegen -f Dockerfile.codegen .`, then `docker run --rm -v "$PWD:/workspace" -w /workspace xstockstrat-codegen ./scripts/buf-gen.sh`). Nothing was installed on the host except `pnpm install --frozen-lockfile` (the image has no `typescript`; `tsc` comes from the workspace). The pre-edit run gave an empty `git diff --stat packages/proto/gen/`.
**Reason**: `.claude/skills/sdd-execute/reference/tooling-setup.md` prefers the Docker path; the daemon starts in this sandbox (`dockerd` as root), so the host fallback was not needed.
**Disposition**: CI-equivalent fallback (same pins as CI job `proto-freshness`: buf 1.72.0, `protoc-gen-go` v1.36.11, `protoc-gen-go-grpc` v1.6.2, `protoc-gen-connect-go` v1.19.2, `grpcio-tools` 1.80.0).

### Deviation: Step 3 — temporary `seeded-unread` baseline entries
**Spec said**: "Do not add a `findings` entry to `scripts/config-wiring.json`" (instruction 4), and the Verification `node --test scripts/config-wiring.test.mjs`.
**Actual**: Step 3 adds six `findings` entries to `scripts/config-wiring.json` (`kind: "seeded-unread"`, owner `feature 334 webhook-fanout-callback`), one per new key. Each reader step removes the entries its readers satisfy, in the same commit: Step 5 removes `notify/webhook.allowed_origins`, Step 9 the four notify worker keys, Step 16 the ingest key. `scripts/config-wiring.json` therefore joins the staged files of Steps 3, 9 and 16 (it is already in Step 5's).
**Reason**: between the seed and its last reader the whole-tree `node scripts/check-config-wiring.mjs --final` exits 1 with one `seeded-unread` line per unread key, and two tests of `scripts/config-wiring.test.mjs` (`baseline 1 @AC-7`, `dead 3 @AC-8`) assert that exit code — 73 pass / 2 fail without the entries. Only the step-time check reports the missing leg as `PENDING`. No ordering within the four-step unit cap avoids it (a reader before its seed fails as `read-unseeded`). An entry left after its reader lands fails `--final` as `STALE` (`scripts/check-config-wiring.mjs:709`), so the removals cannot be forgotten.
**Disposition**: temporary baseline entries removed at Steps 5, 9, 16 — final tree unchanged; decided by the orchestrator under the owner's standing authorization.

### Deviation: Step 3 — stored set generated against a scratch database, script run on the host
**Spec said**: "Regenerate the stored set: `DATABASE_URL=<scratch postgres> bash scripts/config-wiring-stored.sh`"; `/sdd-execute` forbids starting a database in a step. CI job `config-wiring-stored` runs the script inside the `xstockstrat-migrate-ci` image (`scripts/Dockerfile.migrate`).
**Actual**: a short-lived container of the CI job's Postgres image (`timescale/timescaledb:latest-pg16`, CI's user / database) was started for the generation and removed afterwards. The script ran on the host with host `psql` 16 and the `migrate` v4.17.1 release binary (the `scripts/Dockerfile.migrate` pin), not inside the CI migrate image (its base-image pull was rate-limited). With the 048 files moved aside the script reproduced the committed JSON byte-for-byte, so the host run is equivalent. The up → down → up pair was applied once on the same container (388 rows → 400 → 388 → 400; 12 sentinel rows → 0 → 12).
**Reason**: the stored set can only be produced by applying the config migrations to a Postgres; CI fails without a fresh copy.
**Disposition**: artifact generation against a scratch database — orchestrator decision recorded in context.md.

### Deviation: Step 10 — config-reader tests added (review warning)
**Spec said**: Step 10 instructions 1–18 (no test for the ≤ 0 fallback of the four int keys, the timeout clamp, or a read through the real watcher).
**Actual**: `webhookWorker.test.ts` adds a `WebhookWorker config readers` block: stored `0` and a negative value read as the default for `webhook.max_attempts` (8), `webhook.backoff_base_seconds` (30), `webhook.backoff_max_seconds` (3600) and `webhook.request_timeout_seconds` (10); the timeout is clamped to 1–60 s (1, 45, 60, 61, 86400); and one test drives the worker through a real `ConfigWatcher` fed a snapshot whose five values all differ from the code defaults, then a second snapshot that empties the allowlist.
**Reason**: `/sdd-review impl-spec` warning (C-05, platform `@AC-6 @feature-244`, `@AC-2 @feature-304`).
**Disposition**: review warning applied; tests only, no behavior beyond the step body.

### Deviation: Step 9 — origin shown for a row the URL rule rejects at delivery
**Spec said**: dead-letter title `Webhook delivery dead: <event_name> → <origin>`; a URL-rule failure at delivery marks the row dead. `checkCallbackUrlAgainstConfig` returns no origin on a rejection.
**Actual**: for that one case the worker derives `hostname:port` (port default 443) from the stored URL with a local `displayOrigin` — never path, query or userinfo — and uses `unparseable origin` if the URL does not parse. Every other outcome uses the verdict's `origin`. Two `last_error` classes beyond the step's list: `network: error` when a fetch failure carries no error code, and `internal error` for the best-effort retry after an unexpected throw.
**Reason**: the title needs an origin and the rule module (Step 5 file, not in this step's Files) exports none for a rejected URL. A stored row passed the rule at accept time, so its host was operator-allowlisted then.
**Disposition**: within the step's intent; no URL exposure (covered by the leak test).


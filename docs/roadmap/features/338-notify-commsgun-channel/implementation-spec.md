# Implementation Spec: notify-commsgun-channel

**Status**: `pending`
**Created**: 2026-11-13
**Feature**: `docs/roadmap/features/338-notify-commsgun-channel/feature.md`
**Total Steps**: 22
**Feature Branch**: `feature/notify-commsgun-channel`

---

Paths: `notify/`, `config/`, `ui/`, `indicators/` abbreviate `services/xstockstrat-<name>/`. Every
`path:line` below was read on the tree `ccr-2d98935d-na9x6j@cbe3f5d ≡ origin/ccr-2d98935d-na9x6j (merged
origin/main-dev@52f6d5a)`. `recon.md` was written on `@49443b9`; the only commits since then are docs of
feature 335, so its citations still resolve. `feature/notify-commsgun-channel` does not exist on `origin`
yet. Symbols marked **new** do not exist today and are created by the step that names them.

## Execution Summary

Config side first (Steps 1–4: the seed with its shape test, then the `GetSecret` grant with its gate tests),
because the grant must be deployed before notify (D-33). Then notify from the leaves inward: the outbox table
(Step 5), the shared renderer and SendGrid sender lifted out of `FanoutDispatcher` with no behavior change
(6–7), the secret resolver (8–9), the mode / readiness predicates (10–11), the HTTP client (12–13), the
worker in two halves — attempt, retry, terminal step, hold and shutdown (14–15), then reroutes, the alert
sweep and the incidents (16–17) — and last the only step that changes runtime behavior: provider selection in
the dispatcher with the `index.ts` wiring and the startup log (18–19). Nothing constructs the worker before
Step 18, so every earlier commit leaves notify behaving as today. Step 20 adds one SQL assertion that CI runs
against real Postgres, Step 21 proves the consumer surface, Step 22 updates the docs.

**Consumer surface (C-14).** The product spec names one surface, `/config-ui`. No UI source changes, by
design decision D-9: the generic editor lists only stored rows (`ui/src/app/config-ui/[namespace]/NamespaceEditor.tsx:251`),
so Step 1's seed is what makes the nine keys reachable, and Step 21 proves list, secret masking, save and
reload. Agent: no tool change, by decision in the product spec.

**No new env var, port or proto.** `docker-compose.yml:217-258`, `deploy/homelab/compose.yml`, `.do/app.yaml`
and `.do/app.dev.yaml` are not edited (`recon.md` § Dependencies).

**Decisions taken here that the reviewer should check** (all recorded in `context.md`):

1. **Reader homes.** The product spec lists planned reader files "confirmed by `/sdd-spec`". Following D-10
   and D-42 (one module owns the mode mapping and the base predicate), the literal reads of
   `fanout.email_provider`, `commsgun.enqueue_url`, `commsgun.app_id` and `commsgun.to_email` live in
   `notify/src/fanout/emailProvider.ts`, not in `fanout.ts` / `commsgunClient.ts`. One reader site per key
   also keeps `readers-disagree` out of the wiring check (`scripts/check-config-wiring.mjs:643-644`).
2. **Error-class spelling.** The design fixes a closed set of class strings (D-7, D-30) and AC-13 fixes
   `5xx`; the HTTP members are spelled here: `401`, `403`, `409`, `413`, `422`, `429`, `5xx`, `3xx`, `4xx`
   (any other 4xx), `other`. The rest: `timeout`, `network: <CODE>` (the existing `networkErrorClass`),
   `no_app_key`, `secret_unresolved`, `no_endpoint`, `internal`.
3. **Metric outcome of the three no-POST attempts.** D-20 lists the outcome `no_app_key` only. Decided by the
   operator before execution (context.md 2026-11-13): each class has its own outcome — `no_app_key`,
   `secret_unresolved`, `no_endpoint`; none is folded into `error`.
4. **`noteUnconfigured` is not built.** D-18 lists it; D-36 (later) makes the tick's condition the trigger of
   incident I1 and leaves dispatch with the `unconfigured` metric only. D-36 is followed.
5. **`FanoutDispatcher`'s constructor changes once, in Step 18.** Step 6 lifts the SendGrid code but lets the
   dispatcher build its own `SendgridSender`, so the five construction sites are edited a single time.
6. **A CI SQL assertion is added (Step 20).** The worker tests use a scripted pool, which cannot show that
   the worker's statements satisfy the table's CHECK constraints. One file under
   `scripts/migration-assertions/` is run by the existing `migration-rerun` job, as feature 334 did
   (`scripts/migration-assertions/webhook-fanout-callback.sql`). Step Verifications stay offline.
7. **Temporary `seeded-unread` baseline entries.** Between the seed (Step 1) and its last reader (Step 14)
   `--final` reports the unread keys, and two tests of `scripts/config-wiring.test.mjs` (`:609-612`,
   `:970-981`) assert that `--final` exits 0 on the real tree. Step 1 adds eight owned entries to
   `scripts/config-wiring.json`; Steps 10, 12 and 14 remove them with the readers (334's Deviation Log,
   "Step 3 — temporary `seeded-unread` baseline entries"). The final tree carries none.
8. **AC-16 wording.** The scenario says the secret is listed "with value `[redacted]`". That is the wire
   value (`ListKeys`, proved in Step 4). The page renders a secret row as `[secret]`
   (`NamespaceEditor.tsx:132`), which is what Step 21 asserts.

## Scenario Coverage (C-15)

| Scenario | Step(s) | Scenario | Step(s) | Scenario | Step(s) |
|---|---|---|---|---|---|
| AC-1 | 7, 19 | AC-15 | 9, 15 | AC-29 | 17 |
| AC-2 | 19 | AC-16 | 2, 21 | AC-30 | 17 |
| AC-3 | 11, 15, 19 | AC-17 | 19 | AC-31 | 17 |
| AC-4 | 13, 15, 19 | AC-18 | 15, 19 | AC-32 | 15 |
| AC-5 | 19 | AC-19 | 11, 19 | AC-33 | 9, 15, 19 |
| AC-6 | 15 | AC-20 | 13, 15 | AC-34 | 9, 17 |
| AC-7 | 13, 15 | AC-21 | 13, 15 | AC-35 | 17 |
| AC-8 | 13, 15 | AC-22 | 7, 15 | AC-36 | 15, 19 |
| AC-9 | 13, 15 | AC-23 | 19 | AC-37 | 15 |
| AC-10 | 15 | AC-24 | 2, 9, 15 | AC-38 | 15 |
| AC-11 | 15 | AC-25 | 15, 19 | AC-39 | 15 |
| AC-12 | 15 | AC-26 | 17, 19 | AC-40 | 19 |
| AC-13 | 15, 19 | AC-27 | 17 | AC-41 | 9 |
| AC-14 | 4 | AC-28 | 17 | AC-42 | 11, 17 |

Step 20 re-proves the row-state halves of AC-4, AC-6, AC-9, AC-12, AC-27, AC-30 and AC-31 against real
Postgres in CI. AC-16 and AC-24 start "Given a database migrated to the latest config migration": Step 2
checks the migration text, and CI job `config-wiring-stored` applies the real migration
(`.github/workflows/ci.yml:1248-1293`).

## Step Dependencies

- Steps 1+2 land together: Step 2's test reads the migration files Step 1 creates, so its RED must be
  captured before they exist (P-06; ledger 2026-11-04, 278: a covering test precedes or joins its step).
- Step 1 needs a reachable Postgres 16 plus `psql` and `migrate` on `PATH` to **generate**
  `scripts/config-wiring-stored.json` (`scripts/config-wiring-stored.py:5`). Found on 2026-11-13:
  `/usr/bin/psql`; a stopped cluster (`pg_lsclusters` → `16 main 5432 down`); no `migrate` on `PATH`
  (pin: `scripts/Dockerfile.migrate`); `docker` CLI present, daemon not running. This is artifact generation,
  not verification. If no Postgres can be reached the step is blocked (P-03); the JSON is never written by hand.
- Steps 3+4 land together: the grant makes `config/src/__tests__/secretCallerAuthz.test.ts:132-135` fail
  (`notify` stops being an unknown caller), and `config`'s `tsc` compiles the tests
  (`config/tsconfig.json:14`, `config/package.json:12`) — `step-constraints.md` §C row 1.
- Steps 6+7, 8+9, 10+11, 12+13, 14+15, 16+17, 18+19 each land together: `notify`'s `tsc` compiles the tests
  (`notify/tsconfig.json` `include: ["src/**/*"]`; `notify/package.json` `"test": "tsc && node --test …"`),
  so a test that imports a symbol its service step creates cannot fail for a behavioral reason alone
  (§C row 3). In these units, capture RED with the new module present as exported signatures only, so the
  failure is an assertion and not a compile error. Step 18 also changes a constructor whose five call sites
  include four tests (§C row 1).
- Step 8 requires Step 3 only at deploy time (D-33: the grant ships before notify); its tests use a fake client.
- Step 10 requires Step 8 (`CommsgunKeyState`). Step 14 requires Steps 5, 6, 8, 10 and 12. Step 16 requires
  Step 14. Step 18 requires Steps 6, 8, 10, 14 and 16. Step 20 requires Steps 5, 14 and 16 (it copies their
  final statements). Step 21 requires nothing but is placed after the backend so one PR shows both.
- The seed (Step 1) is not in one unit with its readers (Steps 10, 12, 14): one migration is fixed by D-8,
  the readers are three modules, and a unit is capped at four steps. Each step passes its own Verification
  alone: the step-time wiring check reports a missing leg as `PENDING`
  (`scripts/check-config-wiring.mjs:887-898`), and decision 7 above keeps `--final` green in between.
- **Volatile at merge** (ledger 2026-08-26; fails 2026-11-10, 293): config `049` and notify `005` are the
  next free numbers on this tree and are re-derived at execute time and again at the integration PR (the
  product spec does not pin them). Spec-ready `330-fix-live-enrich-ttl-seed` also seeds config keys. A
  renumber, or any other feature's config migration, means regenerating `scripts/config-wiring-stored.json`
  (it stores the file name and a hash of the migration set). The seed's actor sentinel and the test's
  `findOne` lookup are number-free. Re-run the overlap scan for `(namespace, key)` strings after every
  `main-dev` merge. `notify/src/grpc/notifyServiceImpl.ts` is shared with spec-ready 312 / 316 (not edited
  here); `notify/src/telemetry.ts` already contains 337's change (`ee78a66`, #1531), so that open risk of
  `design.md` is closed on this tree.
- C-16 promotion of this feature's `@AC-*` scenarios into the notify / config suites, and the three EXTEND
  cases listed in `design.md`, happens at the integration PR from the branch-tip `acceptance.feature`, not
  in a step.
- Deferred, outside this feature's steps (design open risk 1): tailnet name resolution and certificate
  trust from the notify container are verified at the first homelab staging deploy with one lookup and one
  enqueue from the container. Step 22 writes that check into the notify docs.

---

### Step 1 — migration: seed the nine `notify` keys and regenerate the stored set

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/migrations/049_notify_commsgun_channel_keys.up.sql` — create
- `services/xstockstrat-config/migrations/049_notify_commsgun_channel_keys.down.sql` — create
- `scripts/config-wiring-stored.json` — modify (generated by `scripts/config-wiring-stored.py`)
- `scripts/config-wiring.json` — modify (eight temporary `findings` entries)

**Reviewers**: DBA — NNN numbering, up+down pair, run-order compliance with `scripts/db-migrate.sh`; `xstockstrat-config` owner — key naming, environment scoping, secret encryption + redaction; Security — secret row seeded without a value, never a plain row

**Codebase Evidence**:
- Last config migration: `048_webhook_fanout_callback_keys` (`ls config/migrations`). Next is `049`.
- Plain-key seed template: `config/migrations/048_webhook_fanout_callback_keys.up.sql:4-43` — column list `(namespace, key, value_type, value_data, description, default_value, consuming_service, updated_by, environment, user_id)`, one row per environment, `ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING`, actor `system:config-migration-feature-<slug>`. Down template: `048_…down.sql:4-13` (sentinel **and** seeded `value_data`; "the outer parentheses are load-bearing").
- Value-less secret seed: `config/migrations/017_config_secrets_and_scoping.up.sql:106-121` — `value_data = '[redacted]'`, `is_secret = TRUE`, `value_encrypted` omitted, `default_value = ''`. `GetSecret` answers such a row `found = false` (`config/src/grpc/configServiceImpl.ts:642-648`).
- The checker's migration model accepts any literal column list, reads `is_secret` as a boolean literal and requires `ON CONFLICT … DO NOTHING` (`scripts/check-config-wiring.mjs:129-158`); secret rows are kept apart and never joined as seeds (`:253-261`).
- The checker reads seeds only from `scripts/config-wiring-stored.json` (`:219`); `--final` fails `STALE-STORED` when `inputs_sha256` no longer matches (`:713-716`). CI job `config-wiring-stored` regenerates and diffs it (`.github/workflows/ci.yml:1248-1293`).
- A seeded row must carry `description` and `consuming_service` (`metadata-missing`, `scripts/check-config-wiring.mjs:645`).
- Baseline entry shape: `scripts/config-wiring.json` → `findings[0]` (`namespace`, `key`, `kind`, `owner`); owner pattern `^(defect|feature) .+` (`scripts/check-config-wiring.mjs:170`).
- "Seed values must equal the code default" is a recorded config gotcha with two listed exceptions (`config/docs/context-constitution.md:35`). `commsgun.app_id` is a third, by operator decision (FR-12, D-8).
- No key named `fanout.email_provider` or `commsgun.*` exists in the stored set (`grep -c commsgun scripts/config-wiring-stored.json` → 0).

**Lands with**: `Step 2`

**TDD**: `N/A (migration)`

**Covers**: —

**Instructions**:
1. `049_…up.sql`, statement 1: one `INSERT … ON CONFLICT … DO NOTHING` in the 048 column list with 16 rows (8 keys × `staging`, `production`), `user_id` `NULL`, `updated_by` `'system:config-migration-feature-notify-commsgun-channel'`, `consuming_service` `'xstockstrat-notify'`, a non-empty `description` on every row.

   | key (namespace `notify`) | value_type | value_data | default_value |
   |---|---|---|---|
   | `fanout.email_provider` | `string` | `auto` | `auto` |
   | `commsgun.enqueue_url` | `string` | `''` | `''` |
   | `commsgun.app_id` | `string` | `xstockstrat-staging` (staging), `xstockstrat` (production) | `''` |
   | `commsgun.to_email` | `string` | `''` | `''` |
   | `commsgun.max_attempts` | `int` | `8` | `8` |
   | `commsgun.backoff_base_seconds` | `int` | `30` | `30` |
   | `commsgun.backoff_max_seconds` | `int` | `3600` | `3600` |
   | `commsgun.request_timeout_seconds` | `int` | `10` | `10` |

   Descriptions say what the key controls and what changing it does (`fanout.email_provider`: the three values and that anything else reads as `auto`; `commsgun.enqueue_url`: full HTTPS URL, empty means not configured; `commsgun.request_timeout_seconds`: clamped to 1–60).
2. Statement 2: one `INSERT … ON CONFLICT … DO NOTHING` with 2 rows for `commsgun.app_key` (staging, production) in the 017 column list plus `updated_by`: `value_type` `'string'`, `value_data` `'[redacted]'`, `is_secret` `TRUE`, `default_value` `''`, the same sentinel, no `value_encrypted`.
3. `049_…down.sql`: delete only global `staging` / `production` rows that still carry the sentinel in `updated_by` and, for the plain keys, the seeded `value_data` (per environment for `commsgun.app_id`); for `commsgun.app_key` only rows with `is_secret` and `value_encrypted IS NULL` — a secret the operator has set is never deleted.
4. Regenerate the stored set: `DATABASE_URL=<scratch postgres> python3 scripts/config-wiring-stored.py`. Commit the result unedited. See Step Dependencies for the precondition and the blocked path.
5. `scripts/config-wiring.json` → `findings`: add one entry per plain key, `{"namespace": "notify", "key": "<key>", "kind": "seeded-unread", "owner": "feature 338 notify-commsgun-channel"}` (eight entries; none for the secret).

**Verification**:
```bash
ls services/xstockstrat-config/migrations/049_*.up.sql services/xstockstrat-config/migrations/049_*.down.sql
# read both: 16 + 2 rows, relative keys, sentinel actor; the down deletes exactly what the up inserts
node scripts/check-config-wiring.mjs --declared-from docs/roadmap/features/338-notify-commsgun-channel/product-spec.md \
  --declared-migration services/xstockstrat-config/migrations/049_notify_commsgun_channel_keys.up.sql
#   exit 0; one "PENDING: …:seeded-unread" line per plain key, eight in all
node scripts/check-config-wiring.mjs --final      # exit 0, no STALE-STORED, no STALE
node --test scripts/config-wiring.test.mjs
```

---

### Step 2 — test: seed migration shape

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/__tests__/notifyCommsgunSeedMigration.test.ts` — create

**Reviewers**: `xstockstrat-config` owner — key naming, environment scoping, secret encryption + redaction

**Codebase Evidence**:
- Static migration tests are an existing pattern: `config/src/__tests__/barIngestBackoffSeedMigration.test.ts:1-60` (loads `<migration>.up.sql` / `.down.sql`, asserts the VALUES tuples).
- Helper `config/src/__tests__/migrationSql.ts`: `findOne(suffix, 'up' | 'down')` `:8-16` finds a migration by name suffix (number-free), `splitStatements` `:19-52` drops comments and splits outside literals.
- C-13: the migration text is the only data; no fixture literal gets a second consumer.

**Lands with**: `Step 1`

**TDD**: `red-green required`

**Covers**: `AC-16, AC-24`

**Instructions**:
Load the pair with `findOne('notify_commsgun_channel_keys', …)` and `splitStatements`. Assert:
1. The up holds exactly two `INSERT INTO config.config_values` statements and nothing else; both end `ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING`.
2. AC-16: `fanout.email_provider` is seeded as `'auto'` for `staging` and for `production`; each of the eight plain keys has exactly one row per environment, `user_id` `NULL`, the sentinel actor, a non-empty description, `consuming_service` `'xstockstrat-notify'`; no key starts with `notify.`.
3. AC-16: `commsgun.app_key` has one row per environment with `is_secret` `TRUE`, `value_data` `'[redacted]'`, and the statement's column list does not contain `value_encrypted`.
4. AC-24: `commsgun.app_id` is `'xstockstrat'` in the `production` row and `'xstockstrat-staging'` in the `staging` row.
5. The down is one `DELETE` restricted to the sentinel actor and `user_id IS NULL`; its `commsgun.app_key` arm requires `value_encrypted IS NULL`; it names all nine keys.

RED: with Step 1's files absent, `findOne` fails ("expected exactly one …").

**Verification**:
```bash
cd services/xstockstrat-config && pnpm run lint && pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40
grep -n "migrationSql" src/__tests__/notifyCommsgunSeedMigration.test.ts   # uses the shared helper
```

---

### Step 3 — service: `notify` grant in `SECRET_CALLER_ALLOWLIST` and its mirror

**Status**: `pending`
**Service**: `xstockstrat-config` (mirror in `xstockstrat-indicators`)
**Files**:
- `services/xstockstrat-config/src/grpc/authz.ts` — modify
- `services/xstockstrat-indicators/app/maintenance/config_inventory.py` — modify

**Reviewers**: `xstockstrat-config` owner — secret encryption + redaction, `GetSecret` gate; Security — exact-key, SAN-pinned grant; plaintext only through `GetSecret`; `xstockstrat-indicators` owner — hand-copied mirror kept in sync

**Codebase Evidence**:
- `SecretCallerGrant` `config/src/grpc/authz.ts:125-134`; `SECRET_CALLER_ALLOWLIST` `:136-149` (two grants, both with `peerSan`); `hasSecretCallerAuthority` `:172-187`; `SECRET_SCOPE_ERROR` (PERMISSION_DENIED) `:190-193`; `secretDenialReason` `:205`.
- `GetSecret` handler: gate `config/src/grpc/configServiceImpl.ts:622-633`, exact-scope query `:637-641`, `found = false` `:642-648`.
- notify's leaf carries DNS SAN `xstockstrat-notify`: identity already authorizes notify by that SAN (`docs/patterns/inter-service-mtls.md:61-63`).
- Mirror: `indicators/app/maintenance/config_inventory.py:34-42` — "Copied from … `SECRET_CALLER_ALLOWLIST` (relative keys); keep in sync with it"; used by `_catalog_secret` `:72-76`.
- Header propagation (§B): no outbound call is added in this step.

**Lands with**: `Step 4`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. `authz.ts`: append to `SECRET_CALLER_ALLOWLIST` the grant `{ callerID: 'notify', namespace: 'notify', keys: ['commsgun.app_key'], peerSan: 'xstockstrat-notify' }`. No change to the gate functions.
2. `config_inventory.py`: add `("notify", "commsgun.app_key")` to `SECRET_KEYS`.

**Verification**:
```bash
grep -n "callerID: 'notify'" -A 4 services/xstockstrat-config/src/grpc/authz.ts   # exact key + peerSan
grep -n '"notify", "commsgun.app_key"' services/xstockstrat-indicators/app/maintenance/config_inventory.py
# behavior, lint and coverage: Step 4's Verification (one unit)
```

---

### Step 4 — test: `GetSecret` gate and redaction for the notify secret

**Status**: `pending`
**Service**: `xstockstrat-config` (one case in `xstockstrat-indicators`)
**Files**:
- `services/xstockstrat-config/src/__tests__/secretCallerAuthz.test.ts` — modify
- `services/xstockstrat-config/src/__tests__/secretsAndScope.test.ts` — modify
- `services/xstockstrat-indicators/tests/test_config_inventory.py` — modify

**Reviewers**: `xstockstrat-config` owner — secret encryption + redaction; Security — negatives of the gate; `xstockstrat-indicators` owner — inventory classification

**Codebase Evidence**:
- Parity sweep: `config/src/__tests__/secretCallerAuthz.test.ts:95-136` — `callers` `:97` already lists `'notify'` as the unknown caller; `seen` must equal the five reasons `:132-135`. After Step 3 `notify` has a grant, so `unknown_caller` is reached only if another unknown caller is added.
- Real-mTLS suite: `config/src/__tests__/secretsAndScope.test.ts:68-169` — CA and leaves minted with `mintLeaf` `:80-82`, one client per leaf `:94-97`, `getSecretAs` `:100-104`, allow / deny cases `:111-148`.
- Redaction cases: `:218-250` (`GetConfig` `:228`, `ListKeys` `:237`), `WatchConfig` `:265-290`.
- Indicators: probe constants `indicators/tests/test_config_inventory.py:17-19`, `ROWS` `:44-53`, `PROBES` `:54`; `test_plaintext_twin_of_secret_is_secret_class` `:177-192` is the shape for a catalog-classified row.
- C-13: `SECRET_ROW` (`secretsAndScope.test.ts:219-222`) has one consuming block; a notify row declared beside it stays local to that block. No second consumer is created.

**Lands with**: `Step 3`

**TDD**: `red-green required`

**Covers**: `AC-14`

**Instructions**:
1. `secretCallerAuthz.test.ts`: extend the sweep — `callers` gains `'analysis'` (the unknown caller from now on), `namespaces` gains `'notify'`, `keys` gains `'commsgun.app_key'`, `sans` gains `'DNS:xstockstrat-notify'`; the `seen` assertion keeps all five reasons. Add direct cases: notify + its SAN + `notify` / `commsgun.app_key` → `true`; notify with another SAN, a near-miss SAN or no SAN → `false`; notify for `notify` / `fanout.email_provider` → `false`; `analysis` for the notify key → `false`.
2. `secretsAndScope.test.ts`, `GetSecret allow-list + failure modes`: mint a `xstockstrat-notify` leaf and client. AC-14: with ciphertext of `k-0123456789abcdef0123456789abcdef`, caller `notify` over the notify peer gets `found = true` and that value; caller `analysis` for the same key gets `PERMISSION_DENIED` and no response; caller `notify` over the marketdata peer gets `PERMISSION_DENIED`.
3. Same file, redaction block: a `notify` / `commsgun.app_key` secret row reads `[redacted]` through `GetConfig`, `ListKeys` and the `WatchConfig` snapshot.
4. `test_config_inventory.py`: add a plaintext (non-`is_secret`) `notify` / `commsgun.app_key` row to `ROWS` with its own probe constant, and that constant to `PROBES`. One new case, in the shape of `:177-183`: the row is reported with `is_secret` false, `secret_class` true and `value_sha256` `None`, and no probe reaches the output. No existing case counts `ROWS` (`:126` counts hits per key).

RED: before Step 3, case 1's notify-allowed assertion and case 2's `found = true` fail.

**Verification**:
```bash
cd services/xstockstrat-config && pnpm run lint && pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40
cd ../xstockstrat-indicators && uv run ruff check . && uv run ruff format --check . && uv run pytest tests/test_config_inventory.py
```

---

### Step 5 — migration: `notify.email_outbox`

**Status**: `pending`
**Service**: `xstockstrat-notify`
**Files**:
- `services/xstockstrat-notify/migrations/005_email_outbox.up.sql` — create
- `services/xstockstrat-notify/migrations/005_email_outbox.down.sql` — create

**Reviewers**: DBA — NNN numbering, up+down pair, index correctness, run-order compliance with `scripts/db-migrate.sh`; `xstockstrat-notify` owner — delivery guarantees

**Codebase Evidence**:
- Last notify migration: `004_webhook_deliveries` (`ls notify/migrations`). Next is `005`.
- DDL template: `notify/migrations/004_webhook_deliveries.up.sql:5-21` (`CREATE TABLE IF NOT EXISTS notify.…`, `UUID PRIMARY KEY DEFAULT gen_random_uuid()`, state CHECK, `attempts`, `next_attempt_at`, `last_error`, partial pending index); down `004_…down.sql:4` (`DROP TABLE IF EXISTS`).
- `notify.alerts.alert_id` is `UUID` (`notify/migrations/001_notify_alerts.up.sql:7`); no table in the schema declares a foreign key to it.
- Run order config → … → notify: `scripts/db-migrate.sh:170`. The config seed and this table are independent (product spec § Database Changes).
- Shape fixed by D-34, D-35, D-43 (`debate.md`).

**TDD**: `N/A (migration)`

**Covers**: —

**Instructions**:
1. Up: `CREATE TABLE IF NOT EXISTS notify.email_outbox` with `outbox_id UUID PRIMARY KEY DEFAULT gen_random_uuid()`, `alert_id UUID NOT NULL UNIQUE`, `recipient TEXT`, `subject TEXT`, `text_body TEXT`, `state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','delivered','undelivered','rerouted'))`, `fallback TEXT CHECK (fallback IN ('none','sendgrid'))`, `reroute_reason TEXT CHECK (reroute_reason IN ('deliberate','lost_config'))`, `attempts INT NOT NULL DEFAULT 0 CHECK (attempts >= 0)`, `next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`, `last_error TEXT`, `escalated_at TIMESTAMPTZ`, `fallback_sent_at TIMESTAMPTZ`, `created_at` / `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`.
2. Table CHECKs: content present iff pending — `(state = 'pending' AND recipient IS NOT NULL AND subject IS NOT NULL AND text_body IS NOT NULL) OR (state <> 'pending' AND recipient IS NULL AND subject IS NULL AND text_body IS NULL)`; `fallback` set iff `state IN ('undelivered','rerouted')`; `reroute_reason` set iff `state = 'rerouted'`; `escalated_at` only on `undelivered` / `rerouted`; `fallback_sent_at` only with `fallback = 'sendgrid'`.
3. Indexes (`IF NOT EXISTS`): `(next_attempt_at) WHERE state = 'pending'`; `(outbox_id) WHERE escalated_at IS NULL AND (state = 'undelivered' OR (state = 'rerouted' AND (reroute_reason = 'lost_config' OR fallback_sent_at IS NULL)))` — exactly D-35's predicate.
4. Down: `DROP TABLE IF EXISTS notify.email_outbox`. No app key, URL or app id column; no foreign key; no claim column (R-1, C-18).

**Verification**:
```bash
ls services/xstockstrat-notify/migrations/005_*.up.sql services/xstockstrat-notify/migrations/005_*.down.sql
# read both: the down drops the one table the up creates; the second index predicate equals D-35 word for word
```

---

### Step 6 — service: shared email renderer and `SendgridSender` (no behavior change)

**Status**: `pending`
**Service**: `xstockstrat-notify`
**Files**:
- `services/xstockstrat-notify/src/fanout/emailRender.ts` — create
- `services/xstockstrat-notify/src/fanout/sendgridSender.ts` — create
- `services/xstockstrat-notify/src/fanout/fanout.ts` — modify
- `scripts/config-wiring.json` — modify (one `registry.receivers` entry)

**Reviewers**: `xstockstrat-notify` owner — delivery guarantees, alert deduplication

**Codebase Evidence**:
- Today's SendGrid path: `notify/src/fanout/fanout.ts:160-205` — body lines `:169-178`, subject `:188`, POST `:179-192`, outcomes and WARN `:193-201`; timeout constant `FANOUT_HTTP_TIMEOUT_MS = 3000` `:14` (also used by Slack `:132`); credential read once `:49`; live `from` / `to` reads and the enable test `:110-114`; `enabledChannels()` `:53-55`.
- `FanoutPayload` is a private interface (`fanout.ts:32-40`).
- **Not found** — `emailRender.ts` and `sendgridSender.ts` do not exist (`ls notify/src/fanout`).
- Receivers: `scripts/config-wiring.json` → `registry.receivers` has `…/fanout/fanout.ts:this.config` → `notify`; a config read in a file with no receiver entry is `unattributed` and gates at step time (`scripts/check-config-wiring.mjs:691`, `:887-898`).
- Existing suites that characterize this path and are **not** edited here: `notify/src/__tests__/fanout.test.ts:97-196`, `notifyServiceImpl.test.ts:341-440`, `deliveryChannelsLog.test.ts:27-67`.
- Durable rules preserved: 020 `@AC-2`, `@AC-3`, `@AC-6` (`notify/acceptance/notify-external-fanout.feature`).
- Header propagation (§B): no gRPC call is added.

**Lands with**: `Step 7`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. `emailRender.ts` (**new**): move and export `FanoutPayload`; export `renderEmail(payload): { subject: string; text: string }` — `subject` is `fanout.ts:188` unchanged, `text` is `fanout.ts:169-178` joined with `\n`. Pure, no config, no I/O.
2. `sendgridSender.ts` (**new**): export `FANOUT_HTTP_TIMEOUT_MS` (the one declaration; `fanout.ts` imports it for Slack) and class `SendgridSender` with constructor `(config)` reading `SENDGRID_API_KEY` once, `hasCredential(): boolean`, `enabled(): boolean` (credential and both `fanout.sendgrid_*_email` keys non-empty, read live with string-literal keys through `this.config.getString`), and `send(email: { subject; text }, alertId): Promise<boolean>` — today's POST, headers, body shape, 3 s abort, `recordDelivery('sendgrid', …)` outcomes and WARN text, returning `true` only on a 2xx. It never throws.
3. `fanout.ts`: delete `sendSendgrid` and the `sendgridApiKey` field; the constructor signature stays `(config)` and builds `new SendgridSender(config)`; the email branch `:110-114` becomes `if (this.sendgrid.enabled()) await this.sendgrid.send(renderEmail(payload), alert.alertId)`; `enabledChannels()` returns `sendgrid: this.sendgrid.hasCredential()`.
4. `scripts/config-wiring.json` → `registry.receivers`: add `"services/xstockstrat-notify/src/fanout/sendgridSender.ts:this.config": "notify"`.

**Verification**:
```bash
node scripts/check-config-wiring.mjs --keys notify.fanout.sendgrid_from_email,notify.fanout.sendgrid_to_email   # silent, exit 0
grep -c "api.sendgrid.com" services/xstockstrat-notify/src/fanout/fanout.ts          # expect 0
grep -c "FANOUT_HTTP_TIMEOUT_MS = " services/xstockstrat-notify/src/fanout/*.ts | grep -v ":0"   # exactly one file
git diff --stat -- services/xstockstrat-notify/src/__tests__/fanout.test.ts services/xstockstrat-notify/src/__tests__/notifyServiceImpl.test.ts   # empty
# behavior, lint and coverage: Step 7's Verification (one unit)
```

---

### Step 7 — test: renderer and `SendgridSender`

**Status**: `pending`
**Service**: `xstockstrat-notify`
**Files**:
- `services/xstockstrat-notify/src/__tests__/sendgridSender.test.ts` — create

**Reviewers**: `xstockstrat-notify` owner — delivery guarantees

**Codebase Evidence**:
- Fixtures: `stubFetch` (`notify/src/__tests__/fixtures/stubFetch.ts:31-78`: `{status}`, `{throws}`, `{hang}`), `fakeConfig` (`fixtures/fakeConfig.ts:3-9`), metric helpers `install` / `points` / `counterValue` (`fixtures/collectingReader.ts:14-52`).
- Env handling pattern for a constructor-read credential: `notify/src/__tests__/fanout.test.ts:28-38`.
- Compile-first harness with a hard import assertion: `fanout.test.ts:18-23` (ledger 092 / 074).
- C-13: the tests use the shared fixtures; the alert payload literal has one consumer here.

**Lands with**: `Step 6`

**TDD**: `red-green required` — a refactor: record "red N/A — no behavior change; characterization test added" for the unchanged suites, and capture RED → GREEN for this new file against signature-only modules.

**Covers**: `AC-1, AC-22` (sender half only: one mail-send request with today's body; no request without the credential — the mode halves are Steps 15 and 19)

**Instructions**:
1. `renderEmail`: subject is `[<severity>] <title>`; the text carries the Symbol, Source, Severity, Conviction, Timestamp lines, a blank line, title and body, with `(n/a)` for a missing symbol or conviction (020 `@AC-2`).
2. `send` on 202: exactly one POST to `https://api.sendgrid.com/v3/mail/send` with `Authorization: Bearer <key>`, `personalizations[0].to[0].email` = the configured `to`, `from.email` = the configured `from`, the rendered subject and text; returns `true`; `notify.delivery{channel="sendgrid", outcome="sent"}` is 1.
3. `send` on 500 returns `false` and records `http_error`; a hang returns `false` after the 3 s abort and records `timeout` (`mock.timers`); a thrown network error returns `false` and records `error`. Each logs one WARN with the alert id and channel, and no recipient, subject or key.
4. `enabled()` is `false` without `SENDGRID_API_KEY`, and `false` when either address key is empty; a later change of an address key is seen without a new instance. `hasCredential()` ignores the address keys.

**Verification**:
```bash
cd services/xstockstrat-notify && pnpm run lint && pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40
grep -n "fixtures/" src/__tests__/sendgridSender.test.ts
```

---

### Step 8 — service: commsgun app-key resolver

**Status**: `pending`
**Service**: `xstockstrat-notify`
**Files**:
- `services/xstockstrat-notify/src/services/commsgunSecret.ts` — create

**Reviewers**: `xstockstrat-notify` owner — delivery guarantees; Security — key resolved only through `GetSecret`, never logged, never an env var

**Codebase Evidence**:
- **Not found** — no Node service calls `GetSecret` today (`recon.md` § Risks). The module is new.
- Client template: `notify/src/services/adminDirectory.ts` — fixed deadline constant `:9` (`ADMIN_LOOKUP_DEADLINE_MS = 2000`, "a fixed mechanism constant, not a config key (F-07)"), injectable client and construction with `mtls.clientCredentials()` / `mtls.targetOverride(…)` `:30-36`, `grpc.Metadata` + `{ deadline }` + callback `:42-53`. `notify/src/mtls.ts:28`, `:35`.
- RPC: `GetSecret(GetSecretRequest{namespace, key, environment, user_id}) → {value, found}` (`packages/proto/config/v1/config.proto:35`, `:110-120`).
- Environment mapping to copy: `notify/src/services/configWatcher.ts:81-82` (`production` → `ENVIRONMENT_PRODUCTION`, anything else → `ENVIRONMENT_STAGING`).
- Watcher surface: emits `'update'` with the snapshot on every data message `configWatcher.ts:107`; `getSnapshot()` `:228`. `configWatcher.ts` is byte-identical in three services (`:1-4`) and is **not** edited.
- The config service re-sends each subscriber's last payload on every liveness tick, so `'update'` is not "something changed" (ledger insight 2026-11-13, 338; D-12).
- Header propagation (§B): this is a new outbound gRPC call, but it has no inbound request — it runs at boot and on a config update — so there is no `x-user-id` / `x-access-scope` / `x-trace-id` to forward (root `CLAUDE.md` § Header Propagation Convention applies to per-request calls; the watcher's own `WatchConfig` call sends none, `configWatcher.ts:84-91`). It sends `x-internal-caller: notify`, which the grant requires (Step 3).
- Config contract (C-05): namespace `notify`, key `commsgun.app_key`, secret, no code default (`found = false` means not configured), reader `notify/src/services/commsgunSecret.ts:resolveCommsgunAppKey`, seed Step 1, live mechanism: re-resolved through `GetSecret` when the watcher snapshot `version` changes.

**Lands with**: `Step 9`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Export `type CommsgunKeyState = { kind: 'key'; value: string } | { kind: 'absent' } | { kind: 'unknown' }` and a fixed `COMMSGUN_SECRET_DEADLINE_MS` (proposed 2000, as `adminDirectory.ts:9`; F-07 fixed mechanism constant).
2. Export `resolveCommsgunAppKey(client): Promise<{ found: boolean; value: string }>`: one `getSecret({ namespace: 'notify', key: 'commsgun.app_key', environment, userId: '' }, metadata, { deadline }, cb)` with `x-internal-caller: notify` and the environment mapped as in `configWatcher.ts:81-82`.
3. Export `createCommsgunSecret(watcher, endpoint = process.env.CONFIG_ENDPOINT ?? 'xstockstrat-config:50060', client?)` returning `{ start(): Promise<void>; stop(): void; state(): CommsgunKeyState; failures(): { count: number; statusClass: string } }`. Without an injected client it builds a `ConfigServiceClient` with `mtls.clientCredentials()` and `mtls.targetOverride('xstockstrat-config')`.
4. State rules (D-11, D-12, D-32): initial `unknown`. A successful resolve sets `key` or `absent` (`found = false` or an empty value), stores the snapshot version it was started for, and zeroes the failure count. A failed resolve keeps the last resolved state, increments the count and records the gRPC status name (`UNAVAILABLE`, `PERMISSION_DENIED`, …; `UNKNOWN` when there is no code).
5. Triggers: `start()` awaits one resolve and never rejects. On each watcher `'update'`: if a resolve is running, set a dirty flag; otherwise resolve only when the snapshot `version` differs from the last successfully resolved one or the last resolve failed. When a resolve ends with the dirty flag set, run exactly one follow-up. `stop()` removes the listener.
6. Logs: status name and `found` only. The value never reaches a log, an error string or a thrown error.

**Verification**:
```bash
grep -n "x-internal-caller" services/xstockstrat-notify/src/services/commsgunSecret.ts      # sent on the call
grep -n "process.env" services/xstockstrat-notify/src/services/commsgunSecret.ts             # only CONFIG_ENDPOINT and APPLICATION_ENV
git diff --stat -- services/xstockstrat-notify/src/services/configWatcher.ts                 # empty
python3 scripts/check-watcher-copies.py
# behavior, lint and coverage: Step 9's Verification (one unit)
```

---

### Step 9 — test: app-key resolver

**Status**: `pending`
**Service**: `xstockstrat-notify`
**Files**:
- `services/xstockstrat-notify/src/__tests__/commsgunSecret.test.ts` — create

**Reviewers**: `xstockstrat-notify` owner — delivery guarantees; Security — no value in any log

**Codebase Evidence**:
- Injected-client tests for the sibling module: `notify/src/__tests__/adminDirectory.test.ts` (fake client recording metadata and deadline).
- A fake watcher needs only `on` / `off` / `getSnapshot`; `EventEmitter` is enough (`configWatcher.ts:47` extends it).
- Logger capture by replacing `getLogger` before the module loads: `notify/src/__tests__/webhookWorker.test.ts:28-37`, `:57-64`.
- C-13: the key literals are scenario one-offs taken from `acceptance.feature`; one consumer.

**Lands with**: `Step 8`

**TDD**: `red-green required`

**Covers**: `AC-15, AC-24, AC-33, AC-34, AC-41` (resolver half; worker halves in Steps 15 and 17)

**Instructions**:
1. Request shape: namespace `notify`, key `commsgun.app_key`, empty `userId`, metadata `x-internal-caller: notify`, a deadline within the constant.
2. AC-24: `APPLICATION_ENV=production` sends `ENVIRONMENT_PRODUCTION`; `staging`, `development` and unset send `ENVIRONMENT_STAGING`. The client answers each environment with a different key and the state holds the one for the running environment.
3. `found = true` → `key`; `found = false` → `absent`; an empty value with `found = true` → `absent`.
4. AC-33 / D-11: a first resolve failing with `UNAVAILABLE` leaves `unknown`, `failures()` = `{1, 'UNAVAILABLE'}`; the next update resolves again and a success gives `key` with the count back to 0.
5. AC-34: two consecutive `PERMISSION_DENIED` failures give `failures()` = `{2, 'PERMISSION_DENIED'}` and state `unknown`.
6. A failed refresh after a resolved key keeps the key.
7. AC-41: resolved at version `7`; three updates at `7` make no call; one update at `8` makes one — two calls in total.
8. AC-15: an update at a new version whose answer is a different key replaces the state.
9. Dirty flag: an update arriving while a resolve is pending causes exactly one follow-up call, and a rotation delivered in that window is the final state (O-12).
10. No captured log line and no rejection text contains the key value.

**Verification**:
```bash
cd services/xstockstrat-notify && pnpm run lint && pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40
```

---

### Step 10 — service: provider mode, base and route predicates

**Status**: `pending`
**Service**: `xstockstrat-notify`
**Files**:
- `services/xstockstrat-notify/src/fanout/emailProvider.ts` — create
- `scripts/config-wiring.json` — modify (one receiver entry; remove four temporary entries)

**Reviewers**: `xstockstrat-notify` owner — delivery guarantees

**Codebase Evidence**:
- **Not found** — no provider selection exists; the email branch is unconditional SendGrid (`notify/src/fanout/fanout.ts:110-114`).
- Pure-function config reader with a `config` parameter, attributed by a receiver entry: `notify/src/fanout/webhookUrlRule.ts` (`"…/fanout/webhookUrlRule.ts:config": "notify"` in `scripts/config-wiring.json`).
- Getter shape: `getString(key, def = '')` (`notify/src/services/configWatcher.ts:203-207`).
- Tables to implement: `design.md` § Readiness (dispatch) and § Worker tick (route); D-41, D-42.
- Config contract (C-05), namespace `notify`, `value_type` `string`, seed Step 1, read live per call from the `WatchConfig` snapshot, reader `notify/src/fanout/emailProvider.ts`: `fanout.email_provider` (code default `auto`; `emailMode`), `commsgun.enqueue_url`, `commsgun.app_id`, `commsgun.to_email` (code default `''`; `commsgunSettings`).

**Lands with**: `Step 11`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
All functions are pure; the reader parameter is named `config`; keys are string literals.
1. `emailMode(config): 'auto' | 'commsgun' | 'sendgrid'` — `getString('fanout.email_provider', 'auto')`; any value other than `commsgun` / `sendgrid` is `auto`.
2. `commsgunSettings(config): { url; appId; to; baseSet }` — the three keys trimmed; `baseSet` is true when all three are non-empty.
3. `dispatchAction(mode, baseSet, keyKind): 'sendgrid' | 'queue' | 'unconfigured'` — `sendgrid` → `sendgrid`; `auto` → `queue` only with `baseSet` and key `key`, else `sendgrid`; `commsgun` → `queue` with `baseSet`, else `unconfigured`.
4. `workerRoute(mode, baseSet, keyKind): 'attempt' | 'hold' | 'reroute_lost' | 'reroute_deliberate'` — `commsgun` → `attempt`; `sendgrid` → `reroute_deliberate`; `auto` without `baseSet` → `reroute_lost` whatever the key (D-41); `auto` with `baseSet`: `key` → `attempt`, `absent` → `reroute_lost`, `unknown` → `hold`.
5. `scripts/config-wiring.json`: add receiver `"services/xstockstrat-notify/src/fanout/emailProvider.ts:config": "notify"`; remove the Step 1 entries for `fanout.email_provider`, `commsgun.enqueue_url`, `commsgun.app_id`, `commsgun.to_email`.

**Verification**:
```bash
node scripts/check-config-wiring.mjs --keys notify.fanout.email_provider,notify.commsgun.enqueue_url,notify.commsgun.app_id,notify.commsgun.to_email   # silent, exit 0
node scripts/check-config-wiring.mjs --final      # exit 0 (four entries left, all still produced)
# behavior, lint and coverage: Step 11's Verification (one unit)
```

---

### Step 11 — test: provider predicates

**Status**: `pending`
**Service**: `xstockstrat-notify`
**Files**:
- `services/xstockstrat-notify/src/__tests__/emailProvider.test.ts` — create

**Reviewers**: `xstockstrat-notify` owner — delivery guarantees

**Codebase Evidence**:
- `fakeConfig({ str })` returns a stored string or the passed default (`notify/src/__tests__/fixtures/fakeConfig.ts:7`).
- Table-driven pure-function suite precedent: `notify/src/__tests__/webhookUrlRule.test.ts`.

**Lands with**: `Step 10`

**TDD**: `red-green required`

**Covers**: `AC-3, AC-19, AC-42` (predicate half)

**Instructions**:
1. AC-3: `mailgun`, `''`, `AUTO` and an absent key all map to `auto`; `commsgun` and `sendgrid` map to themselves.
2. `commsgunSettings`: whitespace-only values count as empty; `baseSet` is false when any one of the three is empty (AC-19 rows 1–2 plus the URL case of AC-2).
3. `dispatchAction`: the full 3 × 2 × 3 table against `design.md` § Readiness, including AC-19 rows 3–4 (`auto`, base set, key `absent` or `unknown` → `sendgrid`) and `commsgun` + base + any key → `queue`.
4. `workerRoute`: the full table, including AC-42 (`auto`, no base, key `unknown` → `reroute_lost`, never `hold`) and an unrecognised stored mode giving the `auto` routes (D-42).

**Verification**:
```bash
cd services/xstockstrat-notify && pnpm run lint && pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40
```

---

### Step 12 — service: commsgun HTTP client

**Status**: `pending`
**Service**: `xstockstrat-notify`
**Files**:
- `services/xstockstrat-notify/src/fanout/commsgunClient.ts` — create
- `services/xstockstrat-notify/src/fanout/webhookWorker.ts` — modify (export one function)
- `scripts/config-wiring.json` — modify (one receiver entry; remove one temporary entry)

**Reviewers**: `xstockstrat-notify` owner — delivery guarantees, backpressure handling; Security — key only in the `Authorization` header, URL and key never in an error class

**Codebase Evidence**:
- POST with a hard timeout, body cancelled and never read, error text discarded: `notify/src/fanout/webhookWorker.ts:178-201` (`redirect: 'manual'` `:185`; "The error text may quote the URL: only its class is kept" `:195`).
- `networkErrorClass` `webhookWorker.ts:54-57` is module-private; D-1 allows exporting it. `backoffDelaySeconds` is already exported `:40`.
- Timeout reader shape to mirror: `webhookWorker.ts:135-138` (positive-or-default, then clamp 1–60, × 1000).
- **Not found** — no `Retry-After` handling in notify (`grep -rn "Retry-After" notify/src` → no match).
- Enqueue contract (frozen, `davcs86/commsgun`, read-only): `README.md:40-41` (429 and 503 carry `Retry-After`); `Retry-After` is integer seconds ≥ 1 (`docs/superpowers/plans/2026-11-13-commsgun-api.md:233`); a repeat with the same `Idempotency-Key` returns the original result with `duplicate: true` (`api/internal/enqueue/handler.go:190`).
- Header propagation (§B): external HTTPS, no gRPC call, no platform header.
- Config contract (C-05): namespace `notify`, key `commsgun.request_timeout_seconds`, `int`, code default `10`, a stored ≤ 0 reads as the default, clamped to `[1,60]`, seed Step 1, read live per request, reader `notify/src/fanout/commsgunClient.ts:CommsgunClient`.

**Lands with**: `Step 13`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. `webhookWorker.ts`: add `export` to `networkErrorClass`. Nothing else in that file changes.
2. `commsgunBody(row: { recipient; subject; text }): string` — `JSON.stringify` of an object literal with exactly the keys `channel` (`'email'`), `to` (`[recipient]`), `subject`, `text`, in that order. No `from`.
3. `classifyStatus(status)` — 2xx → delivered; `429` and 5xx → retry; everything else, including 3xx and status 0, → permanent. Error class per Execution Summary decision 2.
4. `parseRetryAfter(value: string | null): number | null` — a non-negative decimal integer of seconds; anything else is `null`.
5. Class `CommsgunClient`, constructor `(config)`, method `send({ url, appId, key, alertId, body }, controller: AbortController)` returning `{ kind: 'delivered' } | { kind: 'retry'; errorClass; outcome: 'http_error' | 'timeout' | 'error'; retryAfterSeconds: number | null } | { kind: 'permanent'; errorClass }`. It POSTs with `redirect: 'manual'`, headers `Content-Type: application/json`, `X-Commsgun-App: <appId>`, `Authorization: Bearer <key>`, `Idempotency-Key: alert:<alertId>`, and aborts the given controller after the configured timeout. The response body is cancelled, never read. An `AbortError` is `retry` / `timeout`; any other throw is `retry` / `networkErrorClass(error)` / `error`. It never throws and never puts the URL, the key or an error message into its result.
6. `scripts/config-wiring.json`: add receiver `"services/xstockstrat-notify/src/fanout/commsgunClient.ts:this.config": "notify"`; remove the Step 1 entry for `commsgun.request_timeout_seconds`.

**Verification**:
```bash
node scripts/check-config-wiring.mjs --keys notify.commsgun.request_timeout_seconds   # silent, exit 0
node scripts/check-config-wiring.mjs --final                                          # exit 0
git diff -- services/xstockstrat-notify/src/fanout/webhookWorker.ts | grep "^[+-]" | grep -v "^+++\|^---"   # one removed, one added line
# behavior, lint and coverage: Step 13's Verification (one unit)
```

---

### Step 13 — test: commsgun HTTP client

**Status**: `pending`
**Service**: `xstockstrat-notify`
**Files**:
- `services/xstockstrat-notify/src/__tests__/commsgunClient.test.ts` — create

**Reviewers**: `xstockstrat-notify` owner — delivery guarantees; Security — negatives (no key or URL in a result)

**Codebase Evidence**:
- `stubFetch` replies: `{status, headers, body}` with `headers.get` lower-casing the name `notify/src/__tests__/fixtures/stubFetch.ts:57`, `{throws}`, `{hang}` `:42-48`; `networkError(code)` `:27-29`; `bodyReads()` / `bodyCancels()` `:73-74`.
- Timeout tests under `mock.timers`: `notify/src/__tests__/webhookWorker.test.ts:319-331`.
- The existing webhook suite stays green unedited after the `export` (it imports `WebhookWorker` and `backoffDelaySeconds` only, `webhookWorker.test.ts:61`).

**Lands with**: `Step 12`

**TDD**: `red-green required`

**Covers**: `AC-4, AC-7, AC-8, AC-9, AC-20, AC-21` (request and classification half)

**Instructions**:
1. AC-4: a 202 gives `delivered`; the one POST goes to the given URL with `X-Commsgun-App: xstockstrat-staging`, `Authorization: Bearer <key>`, an `Idempotency-Key`, and a JSON body whose `channel` is `email` and `to` is `["ops@example.com"]`; the body has exactly four keys and no `from`.
2. AC-7: two `send` calls for the same row produce equal `Idempotency-Key` headers (`alert:<alertId>`) and byte-identical bodies.
3. AC-8: 200 with body `{"duplicate": true}` is `delivered`, and the body is never read (`bodyReads()` is 0, `bodyCancels()` is 1).
4. AC-9: 429 with `Retry-After: 120` is `retry`, class `429`, `retryAfterSeconds` 120; 503 without the header is `retry`, class `5xx`, `null`. `parseRetryAfter` rejects a date, a negative, a decimal and an empty value.
5. 401, 403, 409, 413, 422 are `permanent` with their own class; 404 is `permanent` / `4xx`; 302 and an opaque redirect are `permanent` / `3xx`; `redirect` is `manual` and fetch ran once.
6. AC-20: with `commsgun.request_timeout_seconds` 1 a hanging reply is `retry` / `timeout` after 1000 ms. The key is clamped: 0 and a negative read as 10 s, 86400 as 60 s.
7. AC-21: a thrown `networkError('ECONNRESET')` is `retry` / `network: ECONNRESET` / outcome `error`.
8. No result field contains the URL or the key, on every outcome above.

**Verification**:
```bash
cd services/xstockstrat-notify && pnpm run lint && pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40
```

---

### Step 14 — service: `CommsgunWorker` — enqueue, attempt, retry, terminal step, hold, shutdown

**Status**: `pending`
**Service**: `xstockstrat-notify`
**Files**:
- `services/xstockstrat-notify/src/fanout/commsgunWorker.ts` — create
- `services/xstockstrat-notify/src/telemetry.ts` — modify (`DeliveryChannel`, `DeliveryOutcome`)
- `scripts/config-wiring.json` — modify (one receiver entry; remove three temporary entries)

**Reviewers**: `xstockstrat-notify` owner — delivery guarantees, backpressure handling, alert deduplication; Security — no recipient, subject, body, key or URL in a log, alert or `last_error`

**Codebase Evidence**:
- Worker template: `notify/src/fanout/webhookWorker.ts` — constants `TICK_MS` / `MAX_IN_FLIGHT` `:12-13`; in-memory claim `:61`; constructor on `Pick<Pool, 'query'>`, single statements only `:66-72`; `start` `:74-78`; `stop` aborting in-flight requests `:81-86`; `tick` with the one-tick guard, free-slot limit, due-select excluding in-flight ids, un-awaited attempts with `.catch` / `.finally` `:88-118`; live `> 0`-guarded readers `:120-133`; `if (this.stopped) return` after an aborted request `:144`, `:194`; guarded UPDATEs `WHERE … AND state = 'pending'` `:204-209`, `:233-239`; terminal UPDATE then `rowCount !== 1` return, metric and log before the alert in its own try/catch `:248-281`.
- Alert callback: `NotifyServiceImpl.emitInternalAlert(req)` `notify/src/grpc/notifyServiceImpl.ts:72-76` (rejects if the insert fails); alert shape `WebhookDeadLetterAlert` `webhookWorker.ts:16-22`; `AlertSeverity.ALERT_SEVERITY_WARNING` `:268`.
- Telemetry: `DeliveryChannel` `notify/src/telemetry.ts:358`, `DeliveryOutcome` `:359-372` (has `sent`, `http_error`, `timeout`, `error`, `dead`), `recordDelivery` `:386`. The allowlist test checks label keys, not values (`notify/src/__tests__/telemetryAllowlist.test.ts:9-13`, `:84-95`) and is not edited (platform `@AC-8 @feature-337`).
- Single DB connection: `max: parseInt(process.env.DB_POOL_MAX ?? '1', 10)` (`notify/src/index.ts:36`); F-06.
- Inputs from earlier steps: table (Step 5), `SendgridSender` (Step 6), `CommsgunKeyState` (Step 8), `emailMode` / `commsgunSettings` / `workerRoute` (Step 10), `CommsgunClient` (Step 12).
- Header propagation (§B): no gRPC call is added.
- Config contract (C-05), namespace `notify`, `value_type` `int`, seed Step 1, read live per attempt, reader `notify/src/fanout/commsgunWorker.ts:CommsgunWorker`: `commsgun.max_attempts` (8), `commsgun.backoff_base_seconds` (30), `commsgun.backoff_max_seconds` (3600). A stored ≤ 0 reads as the default.

**Lands with**: `Step 15`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. **Telemetry**: add `'commsgun'` to `DeliveryChannel` and `'queued' | 'enqueue_error' | 'unconfigured' | 'no_app_key' | 'secret_unresolved' | 'no_endpoint' | 'rerouted'` to `DeliveryOutcome`.
2. **Class** `CommsgunWorker`, constructor `(pool: Pick<Pool, 'query'>, config, deps: { secret; client; sendgrid }, emitAlert)` — `deps` typed as `Pick<…>` of exactly the methods used. Own constants beside each other: tick 5000 ms, at most 4 in flight (the values of `webhookWorker.ts:12-13`; no shared base class, R-2).
3. `route()` = `workerRoute(emailMode(config), commsgunSettings(config).baseSet, secret.state().kind)`; `keyKind()` = `secret.state().kind`.
4. `enqueue({ alertId, recipient, subject, text }): Promise<void>` — one `INSERT INTO notify.email_outbox (alert_id, recipient, subject, text_body) VALUES ($1,$2,$3,$4) ON CONFLICT (alert_id) DO NOTHING`. It rejects when the statement fails (the caller decides, Step 18). It remembers the app id read at that moment.
5. `start()` / `tick()` as the template. `tick()` reads the route once: `hold` returns; `attempt` selects due rows (`state = 'pending' AND next_attempt_at <= NOW()`, not in the in-flight set, `ORDER BY next_attempt_at`, limited to the free slots), claims each and runs it un-awaited. The two reroute routes do nothing in this step (Step 16). Nothing is logged per tick.
6. **Attempt** (no pooled connection held across the request):
   - URL or app id empty → class `no_endpoint`; key `absent` → `no_app_key`; key `unknown` → `secret_unresolved`. No POST; each is handled as a retry (outcome per Execution Summary decision 3).
   - Otherwise `client.send(…)` with the row's stored recipient, subject and text, the current app id and key. If the worker has been stopped when it returns, return at once: no UPDATE, no metric.
   - `delivered` → one UPDATE to `delivered`, `attempts + 1`, `last_error = NULL`, content columns `NULL`; `recordDelivery('commsgun', 'sent')`.
   - `retry` → record its outcome; if `attempts + 1 >= max_attempts` go to the terminal step, else one UPDATE `attempts + 1`, `last_error = <class>`, `next_attempt_at = NOW() + make_interval(secs => $n)` with `n = min(max(backoffDelaySeconds(attempts + 1, base, max), retryAfterSeconds ?? 0), max)`.
   - `permanent` → record `http_error`, then the terminal step.
   - An unexpected throw records a retry best-effort with class `internal` (`webhookWorker.ts:143-156`).
7. **App-id change** (D-31): when a tick in route `attempt` selects at least one row and the current app id differs from a remembered non-empty one, log one WARN that contains neither id, then remember the new id.
8. **Terminal step** (D-5, D-39). Re-read the mode. `fallback` = `sendgrid` when the mode is `auto` and `sendgrid.enabled()`, else `none`. One `UPDATE … SET state = 'undelivered', fallback = $2, attempts = attempts + $3, last_error = $4, recipient = NULL, subject = NULL, text_body = NULL, updated_at = NOW() WHERE outbox_id = $1 AND state = 'pending'`; when `rowCount !== 1` stop. Then, each in its own try/catch and in this order: `recordDelivery('commsgun', 'dead')` → WARN (`alertId`, `outboxId`, `attempts`, `errorClass`) → `emitAlert` (WARNING, category `commsgun`, source `xstockstrat-notify`, title and body naming the originating alert id and the error class) → on success stamp `escalated_at` → if `fallback = 'sendgrid'`, `sendgrid.send` once with the subject and text held in memory → when it returns `true`, stamp `fallback_sent_at`. A failed alert does not stop the fallback; its row keeps `escalated_at` NULL for Step 16's sweep.
9. **`stop(): Promise<void>`** (D-29, D-37): mark stopped, clear the timer, abort only the controllers of commsgun POSTs, and resolve when every terminal step already past its UPDATE has finished.
10. Logs carry alert id, outbox id, attempts and error class only. Config keys are read with string-literal keys through `this.config.getInt(...)`.
11. `scripts/config-wiring.json`: add receiver `"services/xstockstrat-notify/src/fanout/commsgunWorker.ts:this.config": "notify"`; remove the last three Step 1 entries.

**Verification**:
```bash
node scripts/check-config-wiring.mjs --keys notify.commsgun.max_attempts,notify.commsgun.backoff_base_seconds,notify.commsgun.backoff_max_seconds   # silent, exit 0
node scripts/check-config-wiring.mjs --final                                   # exit 0
grep -c '"owner": "feature 338' scripts/config-wiring.json                     # expect 0
grep -n "pool.connect\|BEGIN" services/xstockstrat-notify/src/fanout/commsgunWorker.ts ; # expect no match (F-06)
git diff --stat -- services/xstockstrat-notify/src/__tests__/telemetryAllowlist.test.ts   # empty
# behavior, lint and coverage: Step 15's Verification (one unit)
```

---

### Step 15 — test: worker attempts, retries, terminal step, hold, shutdown

**Status**: `pending`
**Service**: `xstockstrat-notify`
**Files**:
- `services/xstockstrat-notify/src/__tests__/commsgunWorker.test.ts` — create
- `services/xstockstrat-notify/src/__tests__/fixtures/scriptedPool.ts` — create
- `services/xstockstrat-notify/src/__tests__/webhookWorker.test.ts` — modify (import the fixture; delete the local copies)

**Reviewers**: `xstockstrat-notify` owner — delivery guarantees, backpressure handling, alert deduplication; Security — leak negatives

**Codebase Evidence**:
- `scriptedPool`, `PoolCall`, `PoolOpts` are local to `notify/src/__tests__/webhookWorker.test.ts:102-151`, `alertRecorder` `:153-162`, `settle` `:84-86`. This suite is their second consumer, so they move to the fixture home `notify/src/__tests__/fixtures/` (C-13; `design.md` § Constitution Rules Touched). `.jscpd.json` ignores `**/__tests__/**`, so the reason is C-13 / C-18, not the duplication hook (fails 2026-11-04, 254).
- The webhook suite's use of the fake: every SELECT is the due-select keyed on `delivery_id` `:125-131`; helpers `selects` / `updates` / `delivered` / `dead` / `retried` / `connects` `:141-150`. They must keep working unchanged for its 40-odd cases.
- Logger capture and lazy module import: `webhookWorker.test.ts:28-37`, `:57-64`. Direct `worker.tick()` plus `settle()`: `:175-183`. `mock.timers`: `:320`, `:399`.
- Metric assertions: `counterValue(reader, 'notify.delivery', …)` (`fixtures/collectingReader.ts:43-52`).

**Lands with**: `Step 14`

**TDD**: `red-green required`

**Covers**: `AC-3, AC-4, AC-6, AC-7, AC-8, AC-9, AC-10, AC-11, AC-12, AC-13, AC-15, AC-18, AC-20, AC-21, AC-22, AC-24, AC-25, AC-32, AC-33, AC-36, AC-37, AC-38, AC-39`

**Instructions**:
1. **Fixture**: move `PoolCall`, `PoolOpts`, `scriptedPool`, `alertRecorder` and `settle` to `fixtures/scriptedPool.ts`. Parametrise the fake by id column and table, and let a caller script the rows of further SELECTs by statement pattern, so the webhook suite's calls and helper names stay as they are. Repoint `webhookWorker.test.ts`; no assertion in it changes.
2. Fakes local to this file: a secret (`state()` / `failures()` settable), a client recording `send` arguments and replaying scripted results, a sender (`enabled()` settable, `send` recorded, result settable). Outbox rows use the alert ids and addresses of `acceptance.feature`.
3. AC-4 / AC-6 / AC-8: one due row, client `delivered` → the delivered statement with that id, content columns set to NULL in the statement, `sent` is 1, no sender call. A newly constructed worker over a pool that already returns a pending row does the same (restart).
4. AC-7 / AC-20 / AC-21: `retry` then `delivered` across two ticks → two `send` calls with the same alert id and body; the retry statement increments attempts with a positive `secs`; the outcomes `http_error`, `timeout`, `error` are each recorded for their case.
5. AC-9 / AC-37: `retryAfterSeconds` 120 with base 30, max 3600 → `secs` ≥ 120; with `commsgun.backoff_max_seconds` 60 → `secs` = 60. Backoff alone gives 30, 60, 120 for attempts 1–3.
6. AC-10 / AC-32: `auto`, `permanent` / `401` → one `send`; the terminal statement carries `fallback = 'sendgrid'`; the recorded order is alert → `escalated_at` stamp → sender `send` → `fallback_sent_at` stamp; exactly one sender call.
7. AC-11: `commsgun.max_attempts` 3, a row with 2 attempts, `retry` → terminal with 3 attempts and one sender call; a row with 1 attempt still retries.
8. AC-12: mode `commsgun`, exhausted → `fallback = 'none'`, no sender call, the statement NULLs recipient, subject and text.
9. AC-13: `5xx` at the last attempt → one WARN naming the alert id and `5xx`; `notify.delivery{channel="commsgun", outcome="dead"}` is 1; one alert with category `commsgun`, severity WARNING, source `xstockstrat-notify`, whose text names the alert id and `5xx`.
10. AC-22: `auto` with the sender disabled → `fallback = 'none'`, no sender call, one alert.
11. A failing `emitAlert` leaves no `escalated_at` stamp, still sends the fallback once, and nothing escapes the worker. A sender returning `false` leaves no `fallback_sent_at` stamp.
12. No side effect when the terminal statement changed no row (`updateRowCount: 0`).
13. AC-25 / AC-38: mode `commsgun` — key `absent` → no `send`, retry with `last_error` `no_app_key`; key `unknown` → `secret_unresolved`; app id empty → `no_endpoint`. With `max_attempts` 2 and a row at 1 attempt, `no_app_key` ends `undelivered`.
14. AC-33: `auto`, base set, key `unknown` → three ticks issue no due-select and no `send`; after the secret turns `key`, the next tick delivers the row.
15. AC-3: an unrecognised stored mode with base and key attempts and delivers (no reroute statement).
16. AC-15 / AC-24: the `key` and `appId` passed to `send` are the secret's current value and the configured app id at attempt time; after the secret changes, the next `send` carries the new key.
17. AC-39: after an enqueue under one app id, a changed app id produces exactly one WARN over two ticks; the WARN contains neither id; `send` receives the new app id and the row's original recipient.
18. AC-36: with a hanging `send`, `stop()` aborts its controller; afterwards no UPDATE is issued for that row and no metric is recorded. `stop()` awaits a terminal step already past its UPDATE (the sender call completes before the promise resolves).
19. AC-18: across a `503` then `422` run for an alert titled `AAPL breakout`, no captured log line, alert text or `last_error` parameter contains `ops@example.com`, `AAPL breakout`, the key or the enqueue URL.
20. Isolation: single `pool.query` statements only (`connects()` is 0, no `BEGIN`); at most 4 in flight; one tick at a time; a rejecting `pool.query` inside an attempt raises no `unhandledRejection`.
21. Config readers: each of the three keys reads its default for 0 and a negative; one case drives the worker through a real `ConfigWatcher` snapshot whose values differ from the defaults (shape of `webhookWorker.test.ts:763-817`).

**Verification**:
```bash
cd services/xstockstrat-notify && pnpm run lint && pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40
grep -n "fixtures/scriptedPool" src/__tests__/commsgunWorker.test.ts src/__tests__/webhookWorker.test.ts
grep -c "^function scriptedPool\|^function alertRecorder" src/__tests__/*.test.ts | grep -v ":0" ; # expect no line (C-13)
```

---

### Step 16 — service: reroutes, alert sweep and incidents

**Status**: `pending`
**Service**: `xstockstrat-notify`
**Files**:
- `services/xstockstrat-notify/src/fanout/commsgunWorker.ts` — modify

**Reviewers**: `xstockstrat-notify` owner — delivery guarantees, alert deduplication; Security — alerts carry counts, key names and error classes only

**Codebase Evidence**:
- The file and its tick are Step 14's. Tick order to implement: `design.md` § Worker tick ("Re-raise sweep → route (read once) → incidents → `hold` returns → select due rows …"; D-27).
- Sweep predicate: D-35, identical to Step 5's second index.
- Incidents I1–I4 and latch rules: D-36, D-40; stalled key: D-33; counts in the reroute alert: D-35.
- Ledger trap this step exists for: a silent fallback must escalate (fails 2026-08-19, 140; product spec Known trap 1).
- "Select by persisted state, build from the row" for an at-least-once follow-up (ledger insight 2026-11-11, 334).
- Config contract: no new key. The 24-hour repeat is a fixed constant beside the tick interval (D-40; F-07 as recorded in `design.md` § Constitution Rules Touched).

**Lands with**: `Step 17`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. **Reroute** (`reroute_deliberate`, `reroute_lost`): select due pending rows as in `attempt`, claim each, and per row run one `UPDATE … SET state = 'rerouted', reroute_reason = $2, fallback = $3, last_error = NULL, recipient = NULL, subject = NULL, text_body = NULL, updated_at = NOW() WHERE outbox_id = $1 AND state = 'pending'` with `fallback` = `sendgrid` when `sendgrid.enabled()`, else `none`. Only when `rowCount = 1`: `recordDelivery('commsgun', 'rerouted')` → WARN → `sendgrid.send` once if the fallback is `sendgrid` → stamp `fallback_sent_at` when it returns `true`. No POST to commsgun, no alert here (D-39).
2. **Terminal step under mode `sendgrid`** (D-14): a row reaching Step 14's terminal step while the re-read mode is `sendgrid` takes path 1 with reason `deliberate` instead of ending `undelivered`.
3. **Sweep**, first thing in every tick: select rows matching D-35's predicate, excluding in-flight ids.
   - `undelivered` rows: one alert each (the Step 14 text), then stamp that row's `escalated_at`.
   - `rerouted` rows, grouped by reason: if the reason's drain latch is not set, raise one alert carrying the row count by `fallback`, the number of unconfirmed sends (`fallback = 'sendgrid'` with no `fallback_sent_at`) and the number of rows still pending; set the latch; then stamp all selected rows of that reason in one UPDATE. With the latch already set, stamp without a new alert. A `deliberate` group whose every row is confirmed never matches the predicate, so it raises nothing.
   - Stamping and latch-setting happen only after the alert persist resolves. The sweep never sends an email.
4. **Incidents**, after the route read: clear the `lost_config` latch when the route is not `reroute_lost`, the `deliberate` latch when it is not `reroute_deliberate`.
   - I1: mode `commsgun` and base not set → one alert when it starts and one more each 24 hours while it lasts.
   - I4: mode `auto`, base set, and key `absent`, or key `unknown` with `failures().count >= 2` → one alert naming the cause (`absent` or the status class), repeating each 24 hours. Silent without the base.
   - Both end, and their timers reset, when the condition is false.
5. Every alert: WARNING, category `commsgun`, source `xstockstrat-notify`; counts, key **names** and error classes only — no recipient, URL, app id or key value. Each alert emit has its own try/catch; a failed emit sets no latch and no timer.

**Verification**:
```bash
grep -n "pool.connect\|BEGIN" services/xstockstrat-notify/src/fanout/commsgunWorker.ts ; # expect no match (F-06)
grep -c "getInt\|getString" services/xstockstrat-notify/src/fanout/commsgunWorker.ts     # unchanged from Step 14 (no new key)
node scripts/check-config-wiring.mjs --final                                              # exit 0
# behavior, lint and coverage: Step 17's Verification (one unit)
```

---

### Step 17 — test: reroutes, alert sweep and incidents

**Status**: `pending`
**Service**: `xstockstrat-notify`
**Files**:
- `services/xstockstrat-notify/src/__tests__/commsgunWorker.test.ts` — modify

**Reviewers**: `xstockstrat-notify` owner — delivery guarantees, alert deduplication

**Codebase Evidence**:
- Harness and fakes: Step 15 (`fixtures/scriptedPool.ts`, the secret / client / sender fakes).
- Clock control: `mock.timers.enable({ apis: [...] })` and `mock.timers.tick(ms)` (`notify/src/__tests__/webhookWorker.test.ts:320-329`); `afterEach` resets timers `:69-76`. Add `'Date'` to the mocked APIs for the 24-hour cases.
- Two alerts with identical text are deduplicated by fanout (020 `@AC-5`); bodies differ by counts, as `webhookWorker.test.ts:487-498` checks for dead letters.

**Lands with**: `Step 16`

**TDD**: `red-green required`

**Covers**: `AC-26, AC-27, AC-28, AC-29, AC-30, AC-31, AC-34, AC-35, AC-42`

**Instructions**:
1. AC-27: mode `sendgrid`, two pending rows, sender enabled and confirming → over two ticks: no client `send`, two sender calls, both reroute statements with reason `deliberate` and fallback `sendgrid`, two `fallback_sent_at` stamps, `rerouted` is 2, **no** alert.
2. AC-28: same with the sender disabled → fallback `none`, no sender call; over three ticks exactly one alert whose text reports 2 dropped rows; both rows stamped.
3. AC-29: mode `auto`, base unset → reason `lost_config`, two sender calls, exactly one alert over three ticks reporting 2 rows with fallback `sendgrid`.
4. AC-42: `auto`, base unset, key `unknown` with two failures → reroute as in 3 (no hold), exactly one alert (I4 silent without the base).
5. AC-30: a new worker whose sweep returns one `rerouted` / `deliberate` / `sendgrid` row with no `fallback_sent_at` → no sender call, one alert reporting 1 unconfirmed fallback, the row stamped.
6. AC-31: a new worker whose sweep returns one `undelivered` row with `escalated_at` NULL → one alert naming that row's alert id, the row stamped, no sender call.
7. Sweep details: rows in flight are excluded from the sweep select; a failing alert emit stamps nothing and sets no latch; with the latch set a second batch is stamped without a second alert; after the route leaves and re-enters the reroute route a new drain alerts again; the alert of a drain larger than one batch reports the rows still pending (O-26).
8. Terminal step under mode `sendgrid`: a row exhausting its attempts ends `rerouted` / `deliberate`, not `undelivered`.
9. AC-26: mode `commsgun`, base unset → the first tick raises one alert; further ticks within 24 hours raise none; after 24 hours one more (two in total). The condition ending and starting again alerts again.
10. AC-34: `auto` with the base set — key `absent` → 1 alert; `unknown` with one `UNAVAILABLE` failure → 0; `unknown` with two `PERMISSION_DENIED` failures → 1 whose text contains `PERMISSION_DENIED`; base unset with either key state → 0. No alert text contains a key value.
11. AC-35: the stalled-key alert repeats once after 24 hours.
12. FR-15: `auto`, base set, key `absent`, pending rows → both the `lost_config` drain alert and the stalled-key alert are raised, with different text.

**Verification**:
```bash
cd services/xstockstrat-notify && pnpm run lint && pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40
```

---

### Step 18 — service: provider selection in `FanoutDispatcher`, wiring, startup log

**Status**: `pending`
**Service**: `xstockstrat-notify`
**Files**:
- `services/xstockstrat-notify/src/fanout/fanout.ts` — modify
- `services/xstockstrat-notify/src/fanout/deliveryChannels.ts` — modify
- `services/xstockstrat-notify/src/index.ts` — modify

**Reviewers**: `xstockstrat-notify` owner — stream delivery guarantees, backpressure handling, alert deduplication; Security — channel names only in the startup log

**Codebase Evidence**:
- Dispatch: gates `notify/src/fanout/fanout.ts:60-92` (unchanged), payload `:95-106`, Slack `:109`, email branch `:110-114` (after Step 6: `sendgrid.enabled()` / `send`), outer catch `:115-118`.
- In-process alerts pass through the same dispatcher (`notify/src/grpc/notifyServiceImpl.ts:72-75`, `:139-151`), so the category exclusion belongs in the email branch (D-4, D-26). Dispatch runs in a microtask after the RPC callback (`:59-64`, `:141-145`).
- Constructor break radius (all five sites): `notify/src/index.ts:42`, `notify/src/__tests__/fanout.test.ts:33`, `notifyServiceImpl.test.ts:345`, `:396`, `deliveryChannelsLog.test.ts:46`.
- Startup log: `describeDeliveryChannels` `notify/src/fanout/deliveryChannels.ts:5-25` reads `fanout.enabledChannels()` `:9`; the `index.ts` call text `log.info('delivery channels', describeDeliveryChannels(fanout, webPush));` (`index.ts:45`) is pinned verbatim (`deliveryChannelsLog.test.ts:69-74`).
- Boot and shutdown: `notify/src/index.ts:28-46`, `:51-60`, `:62-71`. Pinned by tests: boot order (NOTIFY-9, `notify/docs/context-constitution.md`; `notify/src/__tests__/dbTlsBoot.test.ts:38` spawns `dist/index.js`); `webhookWorker.start()` after `grpcServer.start()`, `webhookWorker.stop()` before `pool.end()` and before `grpcServer.forceShutdown()`, one `new Pool(` (`notify/src/__tests__/webhookWorker.test.ts:879-895`).
- Durable rules: 020 `@AC-4` (never delay the stream), `@AC-5` (dedup precedes the insert), 294 `@AC-49` (startup line).
- Config contract (C-05): no new read site — mode, base and recipient come from Step 10's functions.
- Header propagation (§B): no gRPC call is added here (the resolver's call is Step 8).

**Lands with**: `Step 19`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. `fanout.ts`: constructor `(config, sendgrid, commsgun)`, all required; `commsgun` typed as `Pick<CommsgunWorker, …>` of exactly the methods called. Remove the internal `new SendgridSender`.
2. Email branch, after Slack, replacing `:110-114`:
   - alert category `commsgun` → no email (Slack above has already run).
   - otherwise render once and take `dispatchAction(emailMode(config), settings.baseSet, commsgun.keyKind())`:
     - `sendgrid` → `if (sendgrid.enabled()) await sendgrid.send(email, alertId)`.
     - `queue` → `await commsgun.enqueue({ alertId, recipient: settings.to, ...email })`, then `recordDelivery('commsgun', 'queued')`. If it rejects: `recordDelivery('commsgun', 'enqueue_error')`, one WARN (alert id and channel only), and in mode `auto` the `sendgrid` action once; in mode `commsgun` nothing more.
     - `unconfigured` → `recordDelivery('commsgun', 'unconfigured')`.
3. `enabledChannels()` returns `{ slack, sendgrid, commsgun }` with `commsgun: this.commsgun.route() === 'attempt'`.
4. `deliveryChannels.ts`: add `['commsgun', commsgun]` to the list after `sendgrid`.
5. `index.ts`, after the pool probe (`:39-40`) and in this order (D-27): `new SendgridSender(configWatcher)` → `createCommsgunSecret(configWatcher, configEndpoint)` and `await` its `start()` → `new CommsgunClient(configWatcher)` → `new CommsgunWorker(pool, configWatcher, { secret, client, sendgrid }, (alert) => notifyImpl.emitInternalAlert(alert))` → `new FanoutDispatcher(configWatcher, sendgrid, commsgunWorker)`. Lines `:43-46` keep their order and the pinned line `:45` its text. Start the commsgun worker inside the `bindAsync` callback after `webhookWorker.start()`.
6. `shutdown` (D-29, D-37): after `webhookWorker.stop()`, take `const commsgunStopped = commsgunWorker.stop()` and stop the secret. The `tryShutdown` callback awaits `flush` and `commsgunStopped` before `pool.end()`; the 5 s timer path awaits `commsgunStopped` after `forceShutdown()` before `process.exit(0)`.

**Verification**:
```bash
grep -c "log.info('delivery channels', describeDeliveryChannels(fanout, webPush));" services/xstockstrat-notify/src/index.ts ; # expect 1
grep -n "new FanoutDispatcher(" services/xstockstrat-notify/src/index.ts services/xstockstrat-notify/src/__tests__/*.ts   # five sites, three arguments each
grep -c "new Pool(" services/xstockstrat-notify/src/index.ts ; # expect 1 (F-06)
node scripts/check-config-wiring.mjs --final ; # exit 0
# behavior, lint and coverage: Step 19's Verification (one unit)
```

---

### Step 19 — test: provider selection, wiring, startup log

**Status**: `pending`
**Service**: `xstockstrat-notify`
**Files**:
- `services/xstockstrat-notify/src/__tests__/fixtures/fakeCommsgun.ts` — create
- `services/xstockstrat-notify/src/__tests__/fanout.test.ts` — modify
- `services/xstockstrat-notify/src/__tests__/notifyServiceImpl.test.ts` — modify
- `services/xstockstrat-notify/src/__tests__/deliveryChannelsLog.test.ts` — modify

**Reviewers**: `xstockstrat-notify` owner — stream delivery guarantees, alert deduplication; Security — leak negatives in the startup line

**Codebase Evidence**:
- `makeDispatcher` and its env handling `notify/src/__tests__/fanout.test.ts:28-38`; `makeAlert` `:40-52`; existing channel / dedup / error / telemetry blocks `:97-196`.
- `notifyServiceImpl.test.ts`: `fanoutCfg` `:99-110`, `realSlackFanout` `:342-348`, direct construction `:396`, `registerSubscriber` `:321`, `emitAndFlush` `:332-339`, `noopWebPush` `:63`.
- Startup-line test: construction `notify/src/__tests__/deliveryChannelsLog.test.ts:45-49`, expected strings `:61-62`, leak loop `:63-66`, source pin `:69-74`.
- Index source-order assertions precedent: `notify/src/__tests__/webhookWorker.test.ts:879-895`.
- C-13 / C-18: all three suites need a stand-in for the dispatcher's third argument (`enqueue` / `keyKind` / `route`), so it is one export in the fixture home, `notify/src/__tests__/fixtures/fakeCommsgun.ts` (**new**), beside `fakeConfig.ts`.

**Lands with**: `Step 18`

**TDD**: `red-green required`

**Covers**: `AC-1, AC-2, AC-3, AC-4, AC-5, AC-13, AC-17, AC-18, AC-19, AC-23, AC-25, AC-26, AC-33, AC-36, AC-40`

**Instructions**:
1. `fixtures/fakeCommsgun.ts`: one factory returning a recording stand-in with settable `keyKind()` / `route()` and an `enqueue` that resolves, rejects or never settles on request. Update the four test construction sites to the three-argument constructor (a real `SendgridSender` under the test's env, the fake commsgun). Every existing case stays and passes.
2. `fanout.test.ts`, new block "email provider":
   - AC-1: `sendgrid` with commsgun configured → one SendGrid POST, `enqueue` not called.
   - AC-2 / AC-19: `auto` with the URL empty, the app id empty, the recipient empty, key `absent`, key `unknown` → one SendGrid POST each, `enqueue` not called.
   - AC-3 / AC-4: `mailgun` and `auto`, base set, key resolved → `enqueue` called once with the alert id, the configured recipient and the rendered subject and text; no SendGrid POST; `queued` is 1.
   - AC-25: `commsgun`, base set, key `absent` → `enqueue` called, no SendGrid POST.
   - AC-26: `commsgun`, URL empty, three alerts → no `enqueue`, no SendGrid POST, `unconfigured` is 3.
   - AC-33: `auto`, base set, key `unknown` → the alert goes through SendGrid.
   - AC-23: an alert with category `commsgun` under each of the three modes → no SendGrid POST, no `enqueue`; Slack still receives it.
   - AC-40: `enqueue` rejecting — `auto` → `enqueue_error` is 1, one WARN, one SendGrid POST; `commsgun` → `enqueue_error` is 1, one WARN, no SendGrid POST. `dispatch` resolves in both.
   - Dedup precedes the insert: the same alert twice enqueues once (020 `@AC-5`).
   - AC-18: no captured log line of these cases contains the recipient, the title, the key or the URL.
3. `notifyServiceImpl.test.ts`:
   - AC-5: with an `enqueue` that never settles, `EmitAlert` calls back with success and a registered subscriber has the alert before `enqueue` settles.
   - AC-13: `emitInternalAlert` with category `commsgun` persists one alert, a subscriber receives it, and neither a SendGrid POST nor `enqueue` happens for it.
4. `deliveryChannelsLog.test.ts`:
   - Existing case: `disabled` becomes `sendgrid,commsgun` (list order slack, sendgrid, commsgun, push); `enabled` stays `slack,push`.
   - AC-17, three cases through the real `workerRoute`: `auto` + base + key resolved → `commsgun` enabled; `auto` + base + key `unknown` → disabled; `commsgun` + base + key `absent` → enabled. The dump contains neither the enqueue URL nor the key.
   - Source order in `index.ts`: the commsgun worker is constructed on `pool` and `configWatcher`; its `start()` comes after `grpcServer.start()`; `commsgunWorker.stop()` comes before `pool.end()`; `pool.end()` is preceded by an await of the stop promise (AC-36); the secret's `start()` is awaited before the dispatcher is constructed and after `pool.query('SELECT 1')` (NOTIFY-9).

**Verification**:
```bash
cd services/xstockstrat-notify && pnpm run lint && pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40
grep -n "fixtures/fakeCommsgun" src/__tests__/fanout.test.ts src/__tests__/notifyServiceImpl.test.ts src/__tests__/deliveryChannelsLog.test.ts   # all three
node --test dist/__tests__/webhookWorker.test.js dist/__tests__/dbTlsBoot.test.js   # index.ts pins and boot order still green
```

---

### Step 20 — migration: CI assertion for the outbox SQL

**Status**: `pending`
**Service**: `scripts/` (xstockstrat-notify)
**Files**:
- `scripts/migration-assertions/notify-commsgun-channel.sql` — create

**Reviewers**: DBA — CHECK and index correctness, statements valid against the migrated schema; `xstockstrat-notify` owner — delivery guarantees

**Codebase Evidence**:
- CI job `migration-rerun` (`.github/workflows/ci.yml:898-934`) runs `scripts/migration-rerun.py`; after all migrations it runs every `scripts/migration-assertions/*.sql` except `fixtures-*` and pre-contract `config-NNN` files (`scripts/migration-rerun.py:566-576`) through `psql -f` (`run_assertion`, `:579-593`). A new file needs no harness change; the path filter `scripts/migration-assertions/**` triggers the job (`ci.yml:95`).
- File shape to copy: `scripts/migration-assertions/webhook-fanout-callback.sql` — `BEGIN;`, `PREPARE` copies of the shipped statements, `EXECUTE`, `DO $$ … RAISE EXCEPTION … $$`, a first-line comment naming the feature and "run by migration-rerun.py after all migrations". A number-free name survives a renumber.
- `/sdd-execute` never starts a database to verify a step (`.claude/skills/sdd-execute/SKILL.md:311-317`); this file is run by CI only.
- Ledger: a harness file never run against a real database cost one CI cycle per defect (fails 2026-11-10, 296) — budget two iterations. A later migration that deletes rows breaks a "still kept" assertion (fails 2026-11-10, 306) — assert on rows this file inserts, inside a transaction it rolls back.

**TDD**: `N/A (migration — SQL assertion executed only by CI job migration-rerun)`

**Covers**: —

**Instructions**:
One file, `BEGIN; … ROLLBACK;`, leaving no row behind. Copy each statement from `commsgunWorker.ts` as shipped (Steps 14 and 16) with `PREPARE` / `EXECUTE`. Assert with `RAISE EXCEPTION`:
1. Enqueue run twice with one `alert_id` leaves exactly one row, `pending`, 0 attempts, content present.
2. The due-select returns the row and omits it when its id is in the in-flight parameter; the retry statement increments attempts and moves `next_attempt_at` forward by the bound seconds.
3. The delivered, undelivered and rerouted statements each change one `pending` row, leave recipient, subject and text NULL, and change zero rows when run again.
4. The `escalated_at` and `fallback_sent_at` stamps succeed on the rows they are meant for.
5. Each CHECK refuses its violation: a terminal state with content left in place; a pending row without a subject; `fallback` on a `delivered` row; `undelivered` without `fallback`; `reroute_reason` on a non-rerouted row; `rerouted` without a reason; `escalated_at` on a `pending` row; `fallback_sent_at` with `fallback = 'none'`; negative `attempts`; `state = 'bogus'`.
6. The sweep select returns an unescalated `undelivered` row, a `lost_config` row, and a `deliberate` row with no `fallback_sent_at`; it omits a confirmed `deliberate` row and any stamped row. The bulk stamp marks exactly the ids passed.
7. Both partial indexes exist (`pg_indexes`).

Do not start a database for this step. If `DATABASE_URL` already points at the scratch Postgres of Step 1, also run `scripts/db-migrate.sh up` and this file against it before pushing.

Residual risk, to record in `context.md`: the statements are copies and can drift from the source; Steps 15 and 17 pin the statement text on the source side.

**Verification**:
```bash
ls scripts/migration-assertions/notify-commsgun-channel.sql
grep -c "^PREPARE\|RAISE EXCEPTION" scripts/migration-assertions/notify-commsgun-channel.sql
# by inspection: each PREPARE body equals the statement in commsgunWorker.ts
# proof: CI job "Migration rerun (idempotent replay)" green on the first PR that carries this step
```

---

### Step 21 — test: `/config-ui` lists, masks and saves the new keys

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/fixtures/configKeys.ts` — modify
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify
- `services/xstockstrat-ui/e2e/config-ui/notify-commsgun-keys.spec.ts` — create

**Reviewers**: `xstockstrat-ui` owner — config mutation safety, no secret values rendered in UI

**Codebase Evidence**:
- No UI source changes (D-9): the editor lists stored rows only (`ui/src/app/config-ui/[namespace]/NamespaceEditor.tsx:251`), renders a secret row as `[secret]` `:132`, edits it blank as `type=password` `:98`, `:308`, and always writes `stringVal` `:274-282`. `notify` is a known namespace (`ui/src/lib/configNamespaces.ts:13`).
- Fixtures (C-12): `CONFIG_KEY_FIXTURES` `ui/e2e/fixtures/configKeys.ts:55-148` — rows carry no namespace, so every namespace page lists them as `<namespace>.<key>`; secret-row shape `:85-95` (`isSecret: true`, `defaultValue: '[secret]'`). Catalog row: `ui/e2e/fixtures/INVENTORY.md:53`.
- Mock backend: `ListKeys` spreads the fixtures and overlays `configValueOverrides`, which `SetConfig` writes by bare key (`ui/e2e/mock-backend.ts:1496-1512`). It is one singleton for the whole parallel run, so a spec must own the key whose value it asserts (`ui/e2e/config-ui/value-persists-after-save.spec.ts:20-26`). No spec asserts the fixture count (`api-smoke.spec.ts:79` checks `> 0`).
- Spec patterns: secret row `ui/e2e/config-ui/secret-editing.spec.ts:21-42`; save then reload `value-persists-after-save.spec.ts:61-82`. Auth helper `addAdminCookie` (`ui/e2e/helpers/auth.ts:88`).
- Test commands: single spec host-native, never `playwright install` (`.claude/skills/sdd-execute/reference/tooling-setup.md:31`); lint `next lint` (`ui/package.json:10`).

**TDD**: `red-green required`

**Covers**: `AC-16` (page half; the seed half is Step 2)

**Instructions**:
1. `configKeys.ts`: append two rows to `CONFIG_KEY_FIXTURES` — `fanout.email_provider` (`defaultValue: 'auto'`, `isSecret: false`, `consumingService: 'xstockstrat-notify'`, the description of the seed) and `commsgun.app_key` (`isSecret: true`, `defaultValue: '[secret]'`, `consumingService: 'xstockstrat-notify'`). No inline literal in the spec.
2. `INVENTORY.md`: extend the `CONFIG_KEY_FIXTURES` row with the two keys, this feature and the new consumer spec.
3. `notify-commsgun-keys.spec.ts`, on `/config-ui/notify?env=staging` as admin:
   - the row `notify.fanout.email_provider` shows `auto`;
   - the row `notify.commsgun.app_key` shows `[secret]` and never a value; its editor opens blank with `type=password`;
   - editing `notify.fanout.email_provider` to `sendgrid` and saving shows `sendgrid`, and the value is still shown after `page.reload()`.
4. RED: before the fixture rows exist the first locator finds no row.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint
pnpm exec playwright test e2e/config-ui/notify-commsgun-keys.spec.ts e2e/config-ui/secret-editing.spec.ts e2e/config-ui/api-smoke.spec.ts
grep -n "helpers/auth\|fixtures" e2e/config-ui/notify-commsgun-keys.spec.ts            # auth helper; no inline row literal
grep -n "commsgun.app_key\|fanout.email_provider" e2e/fixtures/configKeys.ts e2e/fixtures/INVENTORY.md
```

---

### Step 22 — docs: notify, config and platform references

**Status**: `pending`
**Service**: `docs/`, `services/xstockstrat-notify`, `services/xstockstrat-config`
**Files**:
- `services/xstockstrat-notify/CLAUDE.md` — modify
- `services/xstockstrat-notify/docs/context-constitution.md` — modify
- `services/xstockstrat-config/CLAUDE.md` — modify
- `services/xstockstrat-config/docs/context-constitution.md` — modify
- `docs/patterns/config-governance.md` — modify
- `docs/patterns/inter-service-mtls.md` — modify
- `CLAUDE.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- notify `CLAUDE.md`: § Dependencies table, § Config Keys Consumed table, the "External alert fanout (feature 020)" and "Outbound webhooks" paragraphs, § Observability (instrument list with channel and outcome values; load-bearing logs).
- notify constitution: rules end at `NOTIFY-10` (`notify/docs/context-constitution.md`); NOTIFY-3 names "the five `fanout.*` keys"; Pointers row "DB pool cap 1 (light DB use — alert history and the webhook delivery queue)".
- Grant enumerations: `config/CLAUDE.md:43` ("grants: `marketdata` → … and `ingest` → …"); `config/docs/context-constitution.md:34` ("It now holds **two** grants"), `:51`; `docs/patterns/config-governance.md:24-26`; `docs/patterns/inter-service-mtls.md:58-69` (SAN-gated grants list).
- Seed-equals-default gotcha with its listed exceptions: `config/docs/context-constitution.md:35`.
- Registered-keys log, newest first: `docs/patterns/config-governance.md:144-150` (334's entry is the shape).
- Root: pool table `CLAUDE.md:223` ("Light DB use (alert history and the webhook delivery queue)"); dependency graph `:313-314`.
- Doc gate: `node scripts/check-config-wiring.mjs --doc-check` scans these files for banned phrases (`scripts/check-config-wiring.mjs:856-885`).
- Ledger: a PR that adds an outbound dependency or a grant updates the service `CLAUDE.md` in the same PR (fails 2026-11-10, CLAUDE.md drift batch).
- Operating rules owed by this step: `design.md` § Operating rules; `context.md` § Open Threads (third item).

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. notify `CLAUDE.md`:
   - Dependencies: `xstockstrat-config` gains `GetSecret` (commsgun app key); a row for commsgun (external HTTPS `POST`, tailnet-only enqueue URL); PostgreSQL mentions the email outbox.
   - Config Keys Consumed: the eight plain keys with type, default and the ≤ 0 / clamp rules, and `commsgun.app_key` as a secret resolved through `GetSecret`.
   - A new paragraph "Email providers": the three modes; base and readiness; the dispatch and route tables; the outbox states, `fallback` and `reroute_reason`; retry classes and the `Retry-After` cap; at-most-once email and at-least-once alerts; the four incidents and the 24-hour repeat of the two standing ones; hold; shutdown.
   - Operating rules: rotate the key in config first, then retire it on the edge; change `app_id` / `to_email` only with an empty outbox; clearing the enqueue URL under `auto` drains the queue through SendGrid; category `commsgun` is reserved for notify and never emailed; one notify instance; incident latches are in memory, so a restart can repeat one drain alert or one first standing alert; no age cap on held rows and no retention of terminal rows; first homelab deploy check — one name lookup and one enqueue from the notify container.
   - Observability: channel `commsgun` and its outcomes; the WARN lines of Steps 14, 16 and 18; the startup line lists `commsgun`.
2. notify constitution: one rule `NOTIFY-11` — the outbox claim is in memory (one instance), single statements on the one pooled connection, the terminal UPDATE decides the fallback before any send, and category `commsgun` skips email. NOTIFY-3's key list and the Pointers pool row are brought in line.
3. config `CLAUDE.md:43` and constitution `:34`, `:51`: three grants; the third is `notify` → exact key `commsgun.app_key`, `peerSan: 'xstockstrat-notify'`. Constitution `:35`: record the `commsgun.app_id` seed as an exception to "seed equals code default" (per-environment app id, operator decision FR-12; without URL and recipient it changes nothing).
4. `config-governance.md`: the notify grant in the `peerSan` sentence (`:24-26`); a new newest-first log entry for feature 338 listing the nine keys, readers, defaults, the seed migration by name, the value-less secret row and its down rule, and "no `scripts/config-wiring.json` baseline entry remains".
5. `inter-service-mtls.md`: add config `GetSecret` ← `xstockstrat-notify` to the SAN-gated grants list.
6. Root `CLAUDE.md`: pool table note → "alert history, the webhook delivery queue and the email outbox" (pool max stays 1); dependency graph gains `xstockstrat-notify → xstockstrat-config (GetSecret, commsgun app key)` and the external HTTPS line names the commsgun enqueue URL beside webhook origins.
7. Re-read every touched doc against the code before committing. Comments and doc lines state what the tree does now.

**Verification**:
```bash
node scripts/check-config-wiring.mjs --doc-check      # exit 0
node scripts/check-config-wiring.mjs --final          # exit 0
grep -n "commsgun" services/xstockstrat-notify/CLAUDE.md services/xstockstrat-config/CLAUDE.md docs/patterns/config-governance.md docs/patterns/inter-service-mtls.md CLAUDE.md | wc -l   # > 0 in each file
grep -n "two\*\* grants\|holds \*\*two" services/xstockstrat-config/docs/context-constitution.md ; # expect no match
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._

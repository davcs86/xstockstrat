# Context: notify-commsgun-channel

**Feature**: `docs/roadmap/features/338-notify-commsgun-channel/feature.md`
**Product Spec**: `docs/roadmap/features/338-notify-commsgun-channel/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/338-notify-commsgun-channel/implementation-spec.md`

---

## Session 2026-11-13 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- Operator decisions taken before the spec was written (asked, not assumed):
  - Provider selection: one config key, `auto` | `commsgun` | `sendgrid`, default `auto`; exactly one email per alert.
  - Failure handling: durable outbox with retries for commsgun; SendGrid fallback only after the outbox gives up, and only in `auto`.
  - Credential: commsgun app key is an encrypted config secret resolved via `GetSecret`; URL and app id are plain config keys. No env var.
  - Channels: email only. SMS is out of scope until commsgun has an SMS provider.
- Verified outside this repo (no change needed there): `davcs86/homelab-edge` already has commsgun apps
  `xstockstrat` and `xstockstrat-staging` with app keys in SOPS, and `policy/policy.hujson` grants
  `tag:xstockstrat` and `tag:xstockstrat-staging` → `tag:edge` tcp:443. Enqueue contract:
  `docs/runbooks/commsgun.md` there.
  - Recipient: new `notify.commsgun.to_email`; no sender key (`from` omitted, commsgun default sender).
  - Escalation: one in-process WARNING alert (category `commsgun`) per undelivered row, hard-excluded from email fanout, plus WARN log and counter.
  - Session scope: run the pipeline through implementation in this session, pausing only at the mandatory gates.

## Session 2026-11-13 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready. (First pass FAILED criteria 6 and 9; fixed and re-reviewed.)
- Tree: `ccr-2d98935d-na9x6j` = `origin/main-dev` + this feature's docs commits (artifacts are not on `main-dev` until PR #1537 merges, so the tree was not switched).
- Warnings: tailnet name resolution from the notify container and the value-less secret seed row under C-05 are unverified — recon tasks for `/sdd-design`.
- Overlap findings: WARN `services/xstockstrat-notify/src/telemetry.ts` also modified by in-progress 337-metrics-host-provider-label; low-risk `src/grpc/notifyServiceImpl.ts` vs spec-ready 312-fix-read-path-owner-trust. No config-key, migration-number or proto collision.
- Demoted-duplicate check: none of the demoted features concerns notify email delivery; not a re-attempt.
- Recommended design depth: full (two services, schema migration, new secret + GetSecret grant, two deferred design forks).

## Session 2026-11-13 — operator steer (during sdd-design round 1)

- Operator: commsgun must use a **separate subscriber app per environment**. Recorded as FR-12 / AC-24: `production` → app `xstockstrat`, `staging` → `xstockstrat-staging`; `commsgun.app_id` is seeded per environment and `commsgun.app_key` is a per-environment secret row. Both apps already exist in `davcs86/homelab-edge` (`commsgun_apps`, `commsgun_app_key_xstockstrat`, `commsgun_app_key_xstockstrat_staging`).

## Session 2026-11-13 — sdd-design round 1 gate (operator steers)

- Mode pinned to `commsgun` while not fully configured: **queue and escalate**. With URL, app id and recipient set, the email is queued and a missing app key is a failed (retryable) attempt, so the row reaches undelivered and escalates. With any of those three unset, no row is queued and one rate-limited WARNING alert (category `commsgun`) is raised instead. Never treated as `auto`.
- Pending rows after a switch to `sendgrid`, or after `auto` loses its commsgun configuration: **reroute now** — end each due row with a distinct `rerouted` reason and send once through SendGrid if enabled. A deliberate switch to `sendgrid` raises no alert; a reroute caused by lost configuration under `auto` raises one WARNING alert per incident, not per row.
- Fallback guarantee: **at most one email**. Mark the row ended and raise the escalation alert first, then try SendGrid once.

## Session 2026-11-13 — sdd-design round 2 gate (operator steers)

- Deliberate switch to `sendgrid` while SendGrid is not enabled: pending rows end `rerouted` with no email and **one WARNING alert per incident** says pending emails were dropped.
- Incident alerts (pinned-unconfigured, lost-configuration reroute, the case above) **repeat every 24 hours** while the condition lasts.
- O-9 **waived**: the email exclusion keys on category `commsgun` alone; the category is documented as reserved.
- Gate outcome: **run another round** (not approved after round 2).

## Session 2026-11-13 — sdd-design round 3 gate (operator steers)

- Stalled-secret incident **confirmed** (D-33): in `auto` with URL, app id and recipient set, alert (24 h repeat) when the key is unset or could not be resolved on two consecutive tries, naming the error class. Silent where commsgun is not set up.
- Gate outcome: **run another round** (not approved after round 3).

## Session 2026-11-13 — sdd-design round 4 gate (operator steers)

- **Reopened D-15** (petition P-1): alert-before-SendGrid holds for `undelivered` rows only; `rerouted` rows send first and their summary alert follows on the next sweep. Recorded as D-39.
- **Reopened D-25** (petition P-2): the 24-hour repeat applies to the two standing incidents (pinned-unconfigured, stalled key) only; reroute drains alert once per drain. Recorded as D-40.
- Gate outcome: **run the final round** (round 5).

## Session 2026-11-13 — sdd-design

- Phase 0 Recon: wrote recon.md (services: notify, config, ui config-ui; key reuse patterns: `WebhookWorker` as the outbox worker template, `adminDirectory` client shape for `GetSecret`, config seed shapes 048 / 017).
- Phase 1 Grilling: 5 rounds (full). Chosen approach: dedicated `notify.email_outbox` + `CommsgunWorker`, selection in the dispatcher's email branch, three-valued version-gated secret, at-most-once SendGrid fallback, table-derived at-least-once alerts. Rejected: generalising the webhook queue, shared worker base, re-render per attempt, at-least-once fallback, two-valued secret (R-1..R-5).
- Product spec and acceptance scenarios were brought in line with the debate: FR-3/7/8 rewritten, FR-13..FR-20 added, AC-12/17/22 amended, AC-25..AC-42 added.
- Constitution rules touched: C-05, C-07, C-08, C-10, C-12, C-13, C-14, C-15, C-16, C-18, F-01, F-06, F-07, P-03, P-06. Floor breaches: none.
- Final gate: **approved** by the operator after round 5 (adversary verdict: sound, no blocking issues).
- Status: spec-ready → design-approved.

## Session 2026-11-13T20:08Z — sdd-spec

- Generated implementation-spec.md with 22 steps. Status → implementation-ready.
- Tree: `ccr-2d98935d-na9x6j@cbe3f5d ≡ origin/ccr-2d98935d-na9x6j (merged origin/main-dev@52f6d5a)`. `feature/notify-commsgun-channel` is not on `origin`, so the tree was not switched; `origin/main-dev` (4 commits, docs of feature 335 only) was merged in and pushed before any evidence was read.
- Key codebase findings:
  - Next free numbers on this tree: config `049`, notify `005` (re-derived at execute and at the integration PR; the product spec does not pin them).
  - The wiring check gates a config read in a file with no `registry.receivers` entry (`unattributed`), and two tests of `scripts/config-wiring.test.mjs` (`:609-612`, `:970-981`) require `--final` to exit 0 on the real tree. So each new reader file adds its receiver, and Step 1 adds eight temporary `seeded-unread` entries that Steps 10, 12 and 14 remove (feature 334 hit this as a deviation).
  - `scripts/config-wiring-stored.json` can only be generated against a Postgres with `psql` and `migrate`; here the cluster is down, `migrate` is not on `PATH` and the Docker daemon is not running. Step 1 is blocked without one (the JSON is never hand-written).
  - `config/src/__tests__/secretCallerAuthz.test.ts:97` uses `notify` as its unknown caller, so the grant turns that sweep red; the grant and its tests are one unit and the sweep gains `analysis` as the unknown caller.
  - `notify/src/index.ts:45` and the `webhookWorker.start()` / `stop()` positions are pinned by tests; Step 18 keeps line 45's text by extending `enabledChannels()` instead of the call.
  - `notify/src/telemetry.ts` already contains feature 337's change (`ee78a66`, #1531).
- Decisions taken at spec time (also listed in the spec's Execution Summary for `/sdd-review impl-spec`):
  - Literal reads of `fanout.email_provider`, `commsgun.enqueue_url`, `commsgun.app_id`, `commsgun.to_email` live in `src/fanout/emailProvider.ts` (D-10, D-42), not in the reader files the product spec planned.
  - HTTP error classes are spelled `401`, `403`, `409`, `413`, `422`, `429`, `5xx`, `3xx`, `4xx`, `other` (AC-13 fixes `5xx`; the design fixes only "a closed set").
  - The no-POST attempts `secret_unresolved` and `no_endpoint` are recorded under the existing metric outcome `error`; `no_app_key` under its own outcome (D-20 names only that one). Open for review.
  - `noteUnconfigured` (D-18) is not built; D-36 governs.
  - `FanoutDispatcher` builds its own `SendgridSender` in Step 6 and takes `(config, sendgrid, commsgun)` only from Step 18, so the five construction sites change once.
  - Step 20 adds a CI SQL assertion for the outbox statements and CHECKs (not asked for by `design.md`; precedent: 334 Step 18).
  - `commsgun.app_id` is seeded with `default_value` `''` and a per-environment `value_data`; Step 22 records it as an exception to the config "seed equals code default" gotcha.
  - AC-16's "value `[redacted]`" is proved on the wire in Step 4; the page assertion in Step 21 is the rendered `[secret]`.

## Open Threads

- [ ] Tailnet name resolution and certificate trust from the notify container — verify at first homelab staging deploy (one lookup and one enqueue from the container).
- [x] `services/xstockstrat-notify/src/telemetry.ts` overlap with feature 337 — 337's notify change is already in `main-dev` (`ee78a66`, #1531) and in this tree; nothing left to order.
- [ ] Docs step (Step 22) must state: reserved category `commsgun`, single instance, in-memory incident latches, key-rotation order, change `app_id` / `to_email` only with an empty outbox, clearing the enqueue URL under `auto` drains the queue.
- [ ] `/sdd-review impl-spec`: confirm the metric outcome for `secret_unresolved` / `no_endpoint` attempts and the error-class spelling (spec Execution Summary, decisions 2 and 3).
- [ ] Step 1 needs a scratch Postgres with `psql` and `migrate` to regenerate `scripts/config-wiring-stored.json`; none is running in this sandbox.
- [ ] Config `049` / notify `005` are volatile until merge (spec-ready 330 also seeds config keys); regenerate the stored set after any renumber.

## Session 2026-11-13 — sdd-review impl-spec (advisory)

- Result: 0 failures, 7 warnings (advisory — did not block). Tree: `ccr-2d98935d-na9x6j@82f296d` (origin/main-dev@52f6d5a merged).
- Unresolved ✗ / ⚠ carried into execution:
  - Step 1: regenerating `scripts/config-wiring-stored.json` needs a running Postgres 16 and `migrate`; the sandbox cluster is down and `migrate` is not installed (P-03) — [ ] unaddressed
  - Steps 2 / 4 / 10–11 / 13: config-key tests use migration text or `fakeConfig`, not a snapshot built from the seeded values, for `fanout.email_provider`, `commsgun.enqueue_url`, `commsgun.app_id`, `commsgun.to_email`, `commsgun.request_timeout_seconds` (C-05) — [ ] unaddressed
  - Steps 12 / 13: error class `other` is listed but produced by no step; status 0 and an opaque redirect have no stated class — [ ] unaddressed
  - Steps 12–15: metric outcome for `secret_unresolved` / `no_endpoint` attempts is a register gap (D-20 names only `no_app_key`); the spec maps them to `error` — operator confirmation pending — [ ] unaddressed
  - Step 16: verification `grep -c … # unchanged from Step 14` has no recorded baseline — [ ] unaddressed
  - Step 20: CI-only SQL assertion typed as "migration", an addition beyond the register (334 precedent); proof is a green CI job (C-18) — [ ] unaddressed
  - Steps 4 / 21: no explicit coverage threshold on the indicators pytest line and the Playwright step — [ ] unaddressed
  - Docs touch-ups: annotate that D-36 governs over D-18's `noteUnconfigured`; reword AC-16 so `[redacted]` is the wire value and the page shows `[secret]` — [ ] unaddressed
- Overlap findings: none blocking. Config `049` and notify `005` are unclaimed; `src/telemetry.ts` shared with in-progress 337 (its change is already on trunk); spec-ready 330 also seeds config keys (renumber risk).

## Session 2026-11-13 — pre-execute operator decisions

- **Branch (deviation from the SDD per-step-PR flow, operator-approved):** implementation runs sequentially as one commit per step on `ccr-2d98935d-na9x6j`; PR #1537 into `main-dev` carries the whole change. No `feature/notify-commsgun-channel` or step branches are created.
- **Metric outcomes (closes the D-20 gap):** `secret_unresolved` and `no_endpoint` are their own `DeliveryOutcome` values beside `no_app_key`; they are not folded into `error`.
- **Sandbox:** operator approved starting the local Postgres 16 cluster, installing golang-migrate with `go install`, and `pnpm install` for the affected services.

## Session 2026-11-13 — sdd-execute (sequential)

- Mode entry and the feature plan were confirmed by the operator. Tooling: Node v22.23.4 is installed (the repo pins 24; both suites pass on 22 — notify 259 tests, config 352 — CI runs 24), pnpm 9.15.9, `migrate` v4.17.1, local Postgres 16 for stored-set generation only.

### Step 1 — migration: seed the nine `notify` keys and regenerate the stored set [done]
- Unit 1+2. Wrote config migration `049_notify_commsgun_channel_keys` (16 plain rows + 2 value-less secret rows; down deletes only untouched seeded rows and never a secret that has been set), regenerated `scripts/config-wiring-stored.json` unedited, added eight temporary `seeded-unread` baseline entries.
- Files modified: `services/xstockstrat-config/migrations/049_notify_commsgun_channel_keys.up.sql`, `.down.sql`, `scripts/config-wiring-stored.json`, `scripts/config-wiring.json`
- Verification: step-time wiring check exit 0 with eight `PENDING … seeded-unread` lines; `--final` exit 0; `scripts/config-wiring.test.mjs` 75/75. TDD: N/A (migration).
- Deviations: local Postgres started for generation (Deviation Log).

### Step 2 — test: seed migration shape [done]
- Unit 1+2. `notifyCommsgunSeedMigration.test.ts` parses the migration with the shared `migrationSql` helper.
- AC-16 / AC-24 red: 5/5 failed with "expected exactly one *notify_commsgun_channel_keys.up.sql, got []" → green: 5/5 passed; config suite 357/357, lines 92.21 %, lint 0 errors.
- Files modified: `services/xstockstrat-config/src/__tests__/notifyCommsgunSeedMigration.test.ts`
- Deviations: none

### Step 3 — service: `notify` grant in `SECRET_CALLER_ALLOWLIST` and its mirror [done]
- Unit 3+4. Added the exact-key, SAN-pinned grant `notify` → `notify` / `commsgun.app_key` (`peerSan: xstockstrat-notify`) and the same key to the indicators inventory mirror.
- Files modified: `services/xstockstrat-config/src/grpc/authz.ts`, `services/xstockstrat-indicators/app/maintenance/config_inventory.py`
- Deviations: none

### Step 4 — test: `GetSecret` gate and redaction for the notify secret [done]
- Unit 3+4. Sweep extended (`analysis` is the unknown caller now; notify namespace, key and SAN added; all five denial reasons still reached); four direct gate cases; three real-mTLS cases with a minted `xstockstrat-notify` leaf; one redaction case over `GetConfig` / `ListKeys` / `WatchConfig`; one indicators inventory case.
- AC-14 red: "authorizes notify for notify / commsgun.app_key over its own SAN" and "notify resolves its commsgun app key over its own mTLS peer" failed (2 of 29), and the indicators case failed with the plaintext probe reaching the output → green: config 365/365 (lines 92.24 %, lint 0 errors), indicators `test_config_inventory.py` 9/9, ruff clean. The redaction case passed before the grant too (redaction does not depend on it): characterization.
- Files modified: `services/xstockstrat-config/src/__tests__/secretCallerAuthz.test.ts`, `services/xstockstrat-config/src/__tests__/secretsAndScope.test.ts`, `services/xstockstrat-indicators/tests/test_config_inventory.py`
- Deviations: none

### Step 5 — migration: `notify.email_outbox` [done]
- Wrote notify migration `005_email_outbox` (next free number after `004`): the table, five named CHECK constraints (content iff pending, fallback iff undelivered/rerouted, reason iff rerouted, `escalated_at` only on terminal non-delivered rows, `fallback_sent_at` only with `fallback = 'sendgrid'`), the pending index and the needs-alert partial index whose predicate is D-35's. The down drops the one table.
- Verification (offline): both files exist with number 005; the down reverses the up. In addition the up was parsed once inside a rolled-back transaction on the already-running local Postgres (no state kept); the real apply runs in CI. TDD: N/A (migration).
- Files modified: `services/xstockstrat-notify/migrations/005_email_outbox.up.sql`, `services/xstockstrat-notify/migrations/005_email_outbox.down.sql`
- Deviations: none

### Step 6 — service: shared email renderer and `SendgridSender` (no behavior change) [done]
- Unit 6+7. Lifted the SendGrid POST out of `FanoutDispatcher` into `SendgridSender` and the subject/body rendering into `renderEmail`; the dispatcher builds its own sender (constructor unchanged) and Slack imports the one `FANOUT_HTTP_TIMEOUT_MS`. Registered the new config receiver.
- Files modified: `services/xstockstrat-notify/src/fanout/emailRender.ts`, `services/xstockstrat-notify/src/fanout/sendgridSender.ts`, `services/xstockstrat-notify/src/fanout/fanout.ts`, `scripts/config-wiring.json`
- Deviations: none

### Step 7 — test: renderer and `SendgridSender` [done]
- Unit 6+7. New `sendgridSender.test.ts` (10 cases) on the shared fixtures.
- AC-1 / AC-22 (sender half) red: 8 of 10 failed on assertions against signature-only modules (empty subject, `send` returning false, `enabled()` false) → green: 10/10. Unchanged suites: red N/A — no behavior change; `fanout.test.ts` and `notifyServiceImpl.test.ts` are unedited and pass. notify suite 269/269, lines 89.42 %, lint 0 errors; wiring `--keys` check silent, `--final` exit 0.
- Files modified: `services/xstockstrat-notify/src/__tests__/sendgridSender.test.ts`
- Deviations: none

### Step 8 — service: commsgun app-key resolver [done]
- Unit 8+9. New `services/commsgunSecret.ts`: `resolveCommsgunAppKey` (one `GetSecret` for `notify` / `commsgun.app_key`, environment mapped as the watcher maps it, `x-internal-caller: notify`, 2 s deadline) and `createCommsgunSecret` (three-valued state, version-gated refresh, retry after a failed resolve, follow-up resolve for updates that land mid-resolve, failure count and gRPC status name). `configWatcher.ts` is untouched; `check-watcher-copies.py` passes.
- Files modified: `services/xstockstrat-notify/src/services/commsgunSecret.ts`
- Deviations: the follow-up after a mid-resolve update loops while further updates keep arriving, instead of running exactly once — one burst still causes exactly one follow-up (Step 9 case), and an update landing during the follow-up is not left stale.

### Step 9 — test: app-key resolver [done]
- Unit 8+9. `commsgunSecret.test.ts`, 17 cases with a fake client and a fake watcher.
- AC-15 / AC-24 / AC-33 / AC-34 / AC-41 (resolver half) red: 15 of 17 failed on assertions against the signature-only module → green: 17/17. notify suite 286/286, lines 89.1 %, lint 0 errors.
- Files modified: `services/xstockstrat-notify/src/__tests__/commsgunSecret.test.ts`
- Deviations: none

### Step 10 — service: provider mode, base and route predicates [done]
- Unit 10+11. New `fanout/emailProvider.ts`: `emailMode`, `commsgunSettings`, `dispatchAction`, `workerRoute` (pure). Wiring: receiver entry added; the four temporary `seeded-unread` entries for `fanout.email_provider`, `commsgun.enqueue_url`, `commsgun.app_id`, `commsgun.to_email` removed (four remain for Steps 12 and 14).
- Files modified: `services/xstockstrat-notify/src/fanout/emailProvider.ts`, `scripts/config-wiring.json`
- Deviations: none

### Step 11 — test: provider predicates [done]
- Unit 10+11. `emailProvider.test.ts`: both full 18-row tables, mode mapping, base predicate.
- AC-3 / AC-19 / AC-42 (predicate half) red: 6 of 8 failed on assertions against the signature-only module → green: 8/8. notify suite 294/294, lines 89.3 % (`emailProvider.js` 100 %), lint 0 errors; wiring `--keys` silent, `--final` exit 0.
- Files modified: `services/xstockstrat-notify/src/__tests__/emailProvider.test.ts`
- Deviations: none
- Review warning (config-key tests use `fakeConfig`): still open for these four keys — a `ConfigWatcher`-snapshot case is added with the worker in Step 15.

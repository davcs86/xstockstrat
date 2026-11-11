# Context: webhook-fanout-callback

**Feature**: `docs/roadmap/features/334-webhook-fanout-callback/feature.md`
**Product Spec**: `docs/roadmap/features/334-webhook-fanout-callback/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/334-webhook-fanout-callback/implementation-spec.md`

---

## Session 2026-11-11 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- Number 334 reserved through `scripts/sdd-allocate-feature-number.py` (`sdd/feature-cursor`).
- **Origin of the request.** Publisher side of the three-repo `webhooks-mcp` project. Input is section 8
  of the owner-approved design `docs/superpowers/specs/2026-11-11-webhooks-mcp-design.md` in the public
  repo `davcs86/webhooks-mcp` (read at commit `ad7e0ec`), plus section 7 of
  `docs/superpowers/plans/2026-11-11-orchestration.md` there (brief, expected step order, S7 check).
- **Owner authorizations for this feature (relayed in the session task, 2026-11-11):** the
  `feature/webhook-fanout-callback` branch, SDD step branches, and the feature-cursor reservation push;
  "start the full implementation" is the operator confirmation for in-scope SDD steps. The integration
  PR targets `main-dev` and is **not** merged by this session. The staging end-to-end (upstream S7) is
  **not** run until this session is told the listener is live.
- **Fixed by the owner — stop and report instead of changing:** RPC name `FanoutWebhook`; the wire
  format (product-spec FR-10 / upstream 8.3); delivery lives in notify; no ledger tail and no
  notify → ledger dependency.
- **Left to `/sdd-design`:** how `trigger_backfill` rejects a disallowed URL up front; whether
  `FanoutWebhook` needs an `x-internal-caller` allow-list.
- **Story-level readings of the upstream design, to be confirmed or overturned in design:**
  - Event names for FAILED / CANCELED hand-offs are written in AC-17 as `ingest.backfill.failed` /
    `ingest.backfill.canceled`. The upstream design only fixes that PARTIAL uses
    `ingest.backfill.completed`; recon must confirm the names ingest's existing ledger events use.
  - Redirects are never followed (AC-16) — the reading of "allowlist enforced on every delivery".
  - A hand-off notify rejects with `INVALID_ARGUMENT` at job end stops being retried and raises a
    WARNING (AC-20) — the upstream design says only "the publisher must not retry it".
  - Config key names in the product spec are proposals.

## Session 2026-11-11 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready. Tree: `main-dev` @ `0481498` (= `origin/main-dev`).
- Reviewer verdict PASS WITH WARNINGS, no Floor breach. Folded into the spec before the gate: FR-4 now
  matches AC-20; FR-3 requires every terminal path to hand off (C-10) and names the failed / canceled
  event names (confirmed in `services/xstockstrat-ingest/app/handlers/servicer.py`); proposed code
  defaults for all keys; migration run order; AC-5 extra negatives, AC-23 (case), AC-24 (persist before
  ack); open questions 3 and 4 ticked.
- Warnings carried to design / spec:
  - C-05: reader `path:symbol` and seed migration number are fixed at `/sdd-spec`.
  - FR-6 "internal only" has no negative scenario until design settles the `x-internal-caller` question.
  - C-03: identity / headers on the sweep-initiated call.
  - Notify single DB connection must not be held across an HTTP call.
  - C-09: pin the `callback_url` field number at `/sdd-spec` (trunk max on `TriggerBackfillRequest` is 7).
- Overlap findings: no FAIL. WARN: `notifyServiceImpl.ts` shared with 312 and 316 (rebase-only);
  config seed migration number races 330 / 280 / 299 (trunk tip 047 — re-derive at merge); agent
  `tools.py` / `client.py` shared with 314 / 319 / 322 / 328 / 331 / 299 (textual). Trunk tips: notify
  migrations 003, ingest migrations 014.
- Recommended design depth: full (proto change, DB migrations, 4 affected services, warning-level
  overlap). **The owner's brief for this feature specifies `/sdd-design quick`** — the architecture was
  already debated and approved upstream (design sections 4, 5, 8), so the remaining debate is the two
  delegated points. Running `quick`; the post-Recon escalation gate still applies.

## Session 2026-11-11 — sdd-design (Phase 0 Recon)

- Tree: `main-dev@0481498 ≡ origin/main-dev` (working branch `feature/webhook-fanout-callback`, same tree
  plus this feature's docs). Wrote recon.md from four `codebase-discovery` digests + `scenario-recon`.
- C-16: no CHANGE verdict on any existing `@AC-*` rule (all PRESERVE / EXTEND).
- Post-Recon escalation: the rubric's escalate signals fire (proto change, migrations, 4 services).
  **Kept `quick`** — the owner's brief for this feature names `/sdd-design quick` with those facts
  already known (upstream design section 8 lists the proto changes, config keys and migrations), and
  the owner's "start the full implementation" is the confirmation for in-scope SDD steps. Not re-asked.
- Recon facts that reshape the design: notify has one pooled DB connection, no background loop, no
  caller gate, no JSON config getter (watcher file is byte-identical across three services); ingest has
  seven terminal-write sites in five paths with no shared helper, T6 (restart reconcile) emits nothing,
  and T6 → T7 can yield two terminal statuses for one job.

## Session 2026-11-11 — sdd-design

- Phase 0 Recon: wrote recon.md (services: notify, ingest, agent, config, proto; key reuse patterns:
  `fanout.ts` fetch + AbortController shape, `mcp_client_loop` loop shape, identity's SAN-only gate).
- Phase 1 Grilling: 1 round (quick). Chosen approach: SAN-gated `FanoutWebhook` with a `validate_only`
  mode for trigger-time rejection (fail closed); `notify.webhook_deliveries` table + single-connection
  delivery worker; ingest hands off once per job from one sweep loop that every terminal write wakes.
  Rejected: second allowlist parser in ingest, separate validate RPC, fail-open, `x-internal-caller`,
  JSON getter, inline hand-off at seven sites, per-status re-hand-off, persisted claim column.
- Constitution rules touched: C-03, C-04, C-05, C-07, C-08, C-09, C-10, C-13, C-14, C-15, C-16, C-18,
  F-01, F-06, F-07, P-06. Floor breaches: none (adversary verified F-04, F-06, F-07).
- **P-04 gate.** Not re-prompted: the owner's "start the full implementation" (relayed in the session
  task) is the confirmation for in-scope SDD steps, the two points settled here (up-front rejection,
  caller gate) were delegated to this design by the owner, and no owner-fixed item changed (RPC name,
  wire format, delivery in notify, no ledger tail). Both blocking objections were closed by synthesis:
  O-2 by keeping the approved "call at terminal state + sweep retries" behaviour (terminal writes wake
  the one hand-off loop; default interval stays 60 s), O-1 by once-per-job hand-off.
- **Decisions the owner should see** (within delegated latitude; reported in the PR):
  - `FanoutWebhookRequest` has a fifth field, `validate_only` (upstream 8.2 lists four and allows "a
    validate-only call").
  - `trigger_backfill` with a `callback_url` fails closed (`UNAVAILABLE`, no job) when notify is down.
  - Allowlist is a comma-separated string (`host[:port]`), not JSON.
  - A job is published once; the outbound `data` has no `error` field (it can carry internal gRPC
    debug text) — the agent reads the error through `get_backfill_status`.
  - `occurred_at` is notify's accept time; the job's `completed_at` is inside `data`.
- Scenario changes: AC-4 / AC-15 / Background use the string allowlist; AC-14, AC-17, AC-20 reworded;
  AC-25 … AC-30 appended. Product spec aligned (FR-2, FR-3, FR-6, proto, keys, DB, open questions).
- Status: spec-ready → design-approved.

### Open Threads (from design.md Open Risks)

- [ ] O-9 — run every new SQL statement against a migrated scratch Postgres in the step's verification
  (notify table + worker statements; ingest repo functions; config seed). Target: the migration and
  repository steps.
- [ ] O-17 — hand-off loop must start after `resume_incomplete_jobs()` and wait before its first
  cycle. Target: ingest hand-off step.
- [ ] Dead-letter alert insert failure: `dead` metric + ERROR log first. Target: notify worker step.
- [ ] Requeue SQL line for dead rows in notify `CLAUDE.md`. Target: notify docs step.
- [ ] Ingest certificate SAN `xstockstrat-ingest` in every environment. Target: staging end-to-end (S7).
- [ ] Provision the codegen toolchain (buf 1.72.0, Go plugins, grpcio-tools 1.80.0). Target: proto step.
- [ ] Re-derive migration numbers and rebase shared files at merge (312 / 316 / 330 / 280 / 299 / agent
  features). Target: integration PR.

## Session 2026-11-11T20:29Z — sdd-spec

- Generated implementation-spec.md with 22 steps. Status → implementation-ready.
- Tree: `feature/webhook-fanout-callback@2529de1 ≡ origin/feature/webhook-fanout-callback` (contains
  `origin/main-dev@f99f667`). `recon.md` was written on `main-dev@0481498`; the only drift in the
  affected paths is the telemetry modules (`Loop` enum now `ingest/app/telemetry.py:337`; delivery
  unions `notify/src/telemetry.ts:319-332`). All other recon citations were re-read and hold.
- Discovery was done inline (no `codebase-discovery` subagent was available in this session);
  `recon.md` evidence was reused and every cited line re-read on the tree above.
- Key codebase findings:
  - Migration numbers on this tree: config `048`, notify `004`, ingest `015` (config `048` races
    330 / 280 / 299 — re-derive at merge).
  - **Not in recon:** `scripts/migration-rerun.sh:760` pins `ingest:14` as the clean end state of the
    CI job `migration-rerun`. Ingest migration `015` breaks it, so Step 11 changes the literal to
    `ingest:15`. The same job runs `015.down` and re-applies `015.up`, so both must be re-runnable.
  - **Not in recon:** `scripts/config-wiring-stored.json` is the checker's only source of seeded keys
    and stores the migration file name plus a hash of the whole migration set
    (`scripts/config-wiring-stored.sh:16-24`). It can only be produced by applying the migrations to a
    scratch Postgres (`psql` + `migrate`). Found here: `psql` present, a stopped Postgres 16 cluster,
    no `migrate`, Docker daemon unreachable.
  - Wiring registration is a `registry.receivers` entry per reader **file** (`"<file>:<receiver>"`),
    not a `findings` entry. Notify needs two (URL rule, worker). Ingest needs none: the interval key is
    read by a new `ConfigWatcher` property in `app/config/watcher.py`, whose `int_positive` receiver is
    already registered (`scripts/config-wiring.json:108`).
  - Notify's `tsc` compiles the tests, so each notify service step lands with its test step. No
    channel-value list exists in notify's telemetry tests (they check label keys only), so adding
    `'webhook'` / `'dead'` needs no allowlist-test edit — the worker test asserts the new sample.
  - `stubFetch` is already declared in two notify test files; `fakeConfig` in one. Both move to
    `src/__tests__/fixtures/` in the worker test step (Step 10), as `design.md` says.
  - Four existing `TriggerBackfill` tests build `MagicMock` requests that reach `insert_job`
    (`tests/test_ingest_servicer.py:301,330,385,1961`); each needs `callback_url = ""` in Step 15.
  - The agent pins every allow-listed `UNAVAILABLE` detail against the backend source
    (`agent/tests/test_tool_errors.py:178-189`). The fixed string is
    `callback_url could not be validated; no job was created` (defined in ingest Step 14,
    allow-listed in agent Step 19).
- **Decisions taken at spec time (for the owner and `/sdd-review impl-spec`):**
  - **O-9 upgraded, not confirmed.** `design.md` / `debate.md` O-9 ask each SQL-adding step to run its
    statements against a scratch Postgres in the step's Verification. `/sdd-execute` forbids starting
    a database to verify a step and would substitute an offline check, silently dropping the
    mitigation. `design.md` leaves O-9 "to be confirmed or upgraded at `/sdd-spec`", so Step 18 adds
    `scripts/migration-assertions/webhook-fanout-callback.sql`, run by the existing CI job
    `migration-rerun` with no harness change. Step Verifications stay offline. Residual risk: the
    assertion holds copies of the statements.
  - **Seed not in one unit with its readers.** Six keys, three reader sites, one migration (D-15) and
    a four-step unit cap. Step 3 stands alone (step-time check reports `PENDING`); `--final` runs in
    Step 17 after the last reader and again in Step 22.
  - **Step 3 needs a scratch Postgres to generate the stored set.** This is artifact generation, not
    verification; if none is reachable the step is blocked rather than the JSON hand-written. Needs the
    owner's awareness because `/sdd-execute` also says "never install a database".
  - AC-12 is unit-testable: the worker exports a pure `backoffDelaySeconds` and binds its result as the
    `secs` parameter; the timestamp is still computed by the database (`NOW() + make_interval`).
  - Worker constants proposed, not fixed by D-8: tick 5000 ms, 4 attempts in flight; hand-off batch 50.
    A URL-rule failure at delivery marks the row dead without incrementing `attempts`.
  - `docs/patterns/inter-service-mtls.md` is added to the docs step (it lists every SAN-gated grant);
    it is not in `design.md`'s doc list.
  - `strat-lab` plugin version `0.4.0` → `0.5.0` in both manifests.

### Open Threads (status after /sdd-spec)

- [ ] O-9 — now Step 18 (CI assertion); proven only when `migration-rerun` is green on a PR.
- [ ] O-17 — Step 16 (wait-first loop, started after `resume_incomplete_jobs`) and Step 17 items 9, 12.
- [ ] Dead-letter alert insert failure — Step 9 (metric + ERROR log first), Step 10 item 18.
- [ ] Requeue SQL line for dead rows — Step 22 item 1.
- [ ] Ingest certificate SAN in every environment — staging end-to-end (S7), outside this feature.
- [ ] Codegen toolchain — precondition of Step 2. Scratch Postgres + `migrate` — precondition of Step 3.
- [ ] Re-derive migration numbers, regenerate the stored set and rebase shared files at merge.

## Session 2026-11-11 — sdd-review impl-spec (advisory)

- Tree: `feature/webhook-fanout-callback@1dba3d6 ≡ origin`, `origin/main-dev` merged.
- Result: 0 failures, 12 warnings (advisory — did not block). No Floor risk. D-1 … D-16 all implemented,
  no R-1 … R-9 reintroduced, AC-1 … AC-30 covered, every design "Tests MUST" clause traced to a step.
- Unresolved ⚠ carried into execution:
  - Step 1: `buf breaking` baseline must be `main-dev`, not the feature branch (C-09) — [x] applied at Step 1
  - Step 10: add tests for the ≤ 0 fallback of `webhook.max_attempts`, `webhook.backoff_base_seconds`,
    `webhook.backoff_max_seconds`, `webhook.request_timeout_seconds` and for the 1–60 timeout clamp;
    one reader test through the real `ConfigWatcher` snapshot (C-05, platform `@AC-6 @feature-244`,
    `@AC-2 @feature-304`) — [x] applied at Step 10
  - Step 12: red-green label but its tests are Step 13 — write the Step 13 tests first to obtain the
    RED (P-06 / C-08) — [x] applied at Steps 12+13
  - Steps 12, 13, 15, 17, 20: run lint as `uv run ruff …`, not bare `ruff` — [x] applied from Steps 12+13 on (ingest); agent Step 20 follows the same rule
  - Steps 5+6, 7+8, 9+10: `Lands with` folds have no compile trigger; kept because they force a
    red-first test — accepted, no action.
  - Step 3: seed not grouped with its readers; the step-time wiring check reports `PENDING`
    (`scripts/check-config-wiring.mjs:886-898`), `--final` runs at Steps 17 and 22 — accepted.
  - Steps 21, 22: 7 and 8 doc files — accepted.
  - Step 18: SQL assertion file, proven only by CI job `migration-rerun`; copies can drift — accepted.
- Overlap findings: config migration `048` is also named "next free" by 322 and 330 (spec-ready; 321
  unnumbered) — whichever merges second renumbers and regenerates `scripts/config-wiring-stored.json`
  (prose note added to `merge-order.md`, non-blocking). File overlaps, rebase-only:
  `notifyServiceImpl.ts` (316 in the `emitAlert` body, 312), ingest `servicer.py` (313, 309), agent
  `tools.py` (328, 314, 327) / `client.py` (314, 319, 322), notify `telemetry.ts` (332). No clash on
  proto field 8, the `FanoutWebhook` RPC, notify 004, ingest 015 or any config key.

## Session 2026-11-11 — sdd-execute (sequential)

- Mode entry (§5.1b), up-front confirm (§5.4) and checkpoint gates (§5.5b): not re-prompted. The owner's
  "start the full implementation" (relayed in the session task) is the operator confirmation for
  in-scope SDD steps; checkpoint reports are still printed and recorded, and a real blocker (a change
  to an owner-fixed item, a Commandment override, or anything outside scope) still stops the run.
- Re-spec gate (§5.3): directive none. The spec was generated on this branch's tree one docs-only
  commit ago (`2529de1` → `1dba3d6`); no code moved, so no step was re-spec'd.
- Loaded authoritative spec from `origin/feature/webhook-fanout-callback`. `origin/main-dev` is merged.
- **Step 3 database decision.** `scripts/config-wiring-stored.json` can only be produced by applying
  the config migrations to a Postgres (`scripts/config-wiring-stored.sh`). That is artifact
  generation (like `buf-gen.sh`), not step verification, and CI job `config-wiring-stored` fails
  without it. Decision: run it against a short-lived local scratch Postgres for that one generation,
  then stop it; step Verifications themselves stay offline. Logged as a deviation at Step 3.
- Execution is delegated one atomic unit at a time to a worker agent on the shared tree; the
  orchestrator checks each unit's commits and test output before the next unit starts.
- The four `[ ] unaddressed` impl-spec review warnings are applied as deviations at Steps 1, 10, 12/13
  and the Python steps.
- Tooling setup (steps 1–2): go1.27 ✓ · pnpm ✓ 9.15.9 · uv ✓ · python3.13 ✓ · docker daemon ⬇ started (`dockerd`) · codegen image `xstockstrat-codegen` ⬇ built from `Dockerfile.codegen` (buf 1.72.0, protoc-gen-go v1.36.11, protoc-gen-go-grpc v1.6.2, protoc-gen-connect-go v1.19.2, grpcio-tools 1.80.0, node 24.20.0) · workspace `node_modules` ⬇ (`pnpm install --frozen-lockfile`) · host `buf` ✗ (not needed — Docker path). Baseline `buf-gen.sh` on the untouched tree: empty `git diff --stat packages/proto/gen/`. Local `main-dev` fast-forwarded to `origin/main-dev@f99f667` (runbook § 5) so `buf-gen.sh` runs its breaking check.

### Step 1 — proto: `callback_url` on `TriggerBackfillRequest`, `FanoutWebhook` on `NotifyService` [done]
- Unit 1+2. Added `string callback_url = 8` to `TriggerBackfillRequest`; added `rpc FanoutWebhook(FanoutWebhookRequest) returns (FanoutWebhookResponse)` to `NotifyService` with `FanoutWebhookRequest { callback_url = 1; event_name = 2; google.protobuf.Struct payload = 3; idempotency_key = 4; bool validate_only = 5; }` and an empty `FanoutWebhookResponse`.
- Files modified: `packages/proto/ingest/v1/ingest.proto`, `packages/proto/notify/v1/notify.proto`
- TDD: N/A (proto)
- Deviations: `buf breaking` run against `origin/main-dev` in CI's form instead of the feature branch (review warning) — detail in Deviation Log.

### Step 2 — proto-gen: regenerate Go / Python / TypeScript stubs [done]
- Unit 1+2. Regenerated the stubs with `./scripts/buf-gen.sh` inside the `Dockerfile.codegen` image. The diff under `packages/proto/gen/` is 20 files, all under `ingest/v1` or `notify/v1` (Go, Python, TS source and `dist/`); nothing else changed.
- Files modified: `packages/proto/gen/go/{ingest,notify}/v1/**`, `packages/proto/gen/python/{ingest,notify}/v1/**`, `packages/proto/gen/ts/{ingest,notify}/v1/**`, `packages/proto/gen/ts/dist/{ingest,notify}/v1/**`
- TDD: N/A (proto-gen). Verification: `go vet` (trading, portfolio, marketdata) exit 0; notify `pnpm run test` 148 pass / 0 fail; ingest `uv run pytest -q` 415 passed; agent `uv run pytest -q` 744 passed.
- Deviations: codegen ran in the Docker codegen image, not a host-installed toolchain (CI-equivalent) — detail in Deviation Log.
- Re-run codegen in this session: `docker run --rm --platform linux/amd64 -v "$PWD:/workspace" -w /workspace xstockstrat-codegen ./scripts/buf-gen.sh` from the repo root (start `dockerd` first if `docker info` fails). Open thread "Provision the codegen toolchain" is closed by this.

- **Decision (orchestrator, Step 3 blocker).** The seed makes whole-tree `check-config-wiring.mjs --final` (and two tests of `scripts/config-wiring.test.mjs`) fail as `seeded-unread` until the last reader lands (Step 16). Chosen: six temporary `findings` baseline entries in `scripts/config-wiring.json` (owner `feature 334 webhook-fanout-callback`), removed by the reader steps in the same commit as the reader — Step 5 `notify/webhook.allowed_origins`; Step 9 the four notify worker keys; Step 16 the ingest key. A leftover entry fails `--final` as `STALE`. After Step 16 the baseline holds no feature-334 entry. Detail in the Deviation Log.

### Step 3 — migration: seed the six config keys and regenerate the stored set [done]
- Added config migration `048_webhook_fanout_callback_keys` (12 rows: 6 relative keys × staging / production, global, actor `system:config-migration-feature-webhook-fanout-callback`; the down deletes only those rows while they still carry the sentinel and the seeded value) and regenerated `scripts/config-wiring-stored.json` (12 new rows, new `inputs_sha256`, committed unedited). Trunk config tip re-checked: still 047.
- Files modified: `services/xstockstrat-config/migrations/048_webhook_fanout_callback_keys.up.sql`, `services/xstockstrat-config/migrations/048_webhook_fanout_callback_keys.down.sql`, `scripts/config-wiring-stored.json`, `scripts/config-wiring.json`
- TDD: N/A (migration). Verification: step-time wiring check exit 0 with six `PENDING … seeded-unread` lines; `--final` exit 0, no `STALE-STORED`; `node --test scripts/config-wiring.test.mjs` 75 pass / 0 fail.
- Stored set generated on a scratch Postgres (CI image `timescale/timescaledb:latest-pg16`, removed afterwards; script on the host with `migrate` v4.17.1). The up → down → up pair was applied there once: 388 → 400 → 388 → 400 rows.
- Deviations: temporary `seeded-unread` baseline entries; scratch database for generation, script run on the host — detail in Deviation Log.

### Step 4 — migration: `notify.webhook_deliveries` [done]
- Added notify migration `004_webhook_deliveries`: the table (columns and `state` CHECK per `design.md`) and the partial index `idx_webhook_deliveries_pending` on `(next_attempt_at) WHERE state = 'pending'`; the down drops the table.
- Files modified: `services/xstockstrat-notify/migrations/004_webhook_deliveries.up.sql`, `services/xstockstrat-notify/migrations/004_webhook_deliveries.down.sql`
- TDD: N/A (migration). Verified offline: both files exist as `004` (notify tip was `003` on this branch and on `origin/main-dev`); the down drops the one table the up creates and the index goes with it. Not applied to any database — first live apply is CI (`migration-rerun`, and the Step 18 assertion).
- Deviations: none

### Step 5 — service: callback URL rule and allowlist helper (notify) [done]
- Unit 5+6. New module `services/xstockstrat-notify/src/fanout/webhookUrlRule.ts`: pure `parseAllowedOrigins(raw)` → `{ origins: Set<string>, malformed: number }`, pure `checkCallbackUrl(raw, allowedOriginsRaw)` → `CallbackUrlVerdict` (`{ ok: true, href, origin }` | `{ ok: false, reason }`), and `checkCallbackUrlAgainstConfig(config, raw)` — the only reader of `webhook.allowed_origins` (live `config.getString('webhook.allowed_origins', '')`, WARN with the malformed-entry count at most once per 60 s). `reason` is the closed type `CallbackUrlRejection`: `too_long`, `bad_characters`, `unparseable`, `scheme`, `userinfo`, `trailing_dot`, `origin_not_allowed`. No reason or log line carries the URL.
- Registered the reader file in `scripts/config-wiring.json` `registry.receivers` and removed the temporary `notify/webhook.allowed_origins` baseline entry in the same commit. Observed: with the reader present and the entry left in place, `check-config-wiring.mjs --final` exits 1 with `STALE: config-wiring.json:notify/webhook.allowed_origins:seeded-unread`; with the entry removed it exits 0. So Steps 9 and 16 must remove their entries in the commit that adds the reader.
- Rule details worth knowing downstream: an allowlist entry may end in `/` (not a path); an entry containing `?`, `#`, a backslash, whitespace, userinfo, a path, a non-`https://` scheme prefix or an upper-case `HTTPS://` prefix is malformed and matches nothing; a `*.host` entry is a literal host, not a wildcard, so it matches no real host; an IP literal passes only if that exact literal and port are listed. A URL with a backslash is judged by the host the WHATWG parser lands on, and the returned `href` is that same parse — deliver to `href`, never to the raw string.
- Files modified: `services/xstockstrat-notify/src/fanout/webhookUrlRule.ts`, `scripts/config-wiring.json`
- TDD: one cycle with Step 6 (below).
- Deviations: none beyond the Step 3 baseline-entry removal already logged.

### Step 6 — test: URL rule (security matrix) [done]
- Unit 5+6. `services/xstockstrat-notify/src/__tests__/webhookUrlRule.test.ts`, 44 tests: every AC-5 row with its reason class, AC-4, AC-23, exact-equality cases (suffix, prefix, substring, port digits, origin inside path / query / fragment), default vs explicit 443 on URL and entry, IDN / punycode and a look-alike host, trailing dot, IPv6 and IPv4 literals, backslash, userinfo, whitespace and control characters, 2048 / 2049 characters, reasons never containing the URL, allowlist entries (scheme-prefixed, empty, malformed, path-carrying, wildcard-looking), and the live read of `checkCallbackUrlAgainstConfig`. The config stub is a scenario one-off (`{ getString }`); no fixture import (C-13 — `fakeConfig` keeps its single consumer until Step 10).
- Files modified: `services/xstockstrat-notify/src/__tests__/webhookUrlRule.test.ts`
- TDD: RED `pnpm exec tsc && node --test dist/__tests__/webhookUrlRule.test.js` against a fail-open stub of the three exports (the module must exist for `tsc`) → `# pass 2 # fail 42`, e.g. `not ok 1 - rejects http://webhooks.ts.example.net:8443/hooks` / `expected rejection, accepted for origin`; GREEN same command → `# tests 44 # pass 44 # fail 0`; `pnpm run test:coverage` → 192 pass / 0 fail, `webhookUrlRule.js` 100 % lines, all files 86.16 %.
- Weakened-rule runs (ledger 207). The exact comparison `origins.has(origin)` was temporarily replaced, the suite run, and the real rule restored (file compared byte-for-byte with the saved copy, suite GREEN again). Every weakening failed:
  - `origin.endsWith(o)` → `prefix: another label glued in front of the allowlisted host`
  - `origin.startsWith(o)` → `port: a longer or shorter port that shares digits with the allowlisted one`
  - `origin.includes(o)` → the `prefix` and `port` tests
  - `o.includes(origin)` → the `substring: a parent domain of the allowlisted host, and a host that contains it`, `port` and `a wildcard-looking or path-carrying entry does not widen the match` tests
  - host-only `startsWith` (ports equal) → `rejects https://webhooks.ts.example.net.evil.org:8443/h`, `suffix: the allowlisted host followed by another domain`, `IPv6 literal: rejected unless that exact literal and port are allowlisted`
  - host-only `endsWith` → the `prefix` and `IPv6 literal` tests
  - host-only `includes` → the AC-5 suffix row and the `suffix`, `prefix`, `substring`, `IPv6 literal` tests
- Deviations: none

- CI note (orchestrator, 2026-11-11 ~20:56 UTC): GitHub Actions outage — runs stuck in queued; steps are verified with the local checks named in each step entry.

### Step 7 — service: `fanoutWebhook` accept handler (notify) [done]
- Unit 7+8. Added `NotifyServiceImpl.fanoutWebhook`: peer-SAN gate (module constant `FANOUT_WEBHOOK_PEER_SANS = ['xstockstrat-ingest']`, local `peerDnsSans`, exact match, no header read; code 7) → `checkCallbackUrlAgainstConfig` (code 3, message `callback_url rejected: <reason>`) → `validateOnly` returns `{}` and writes nothing → `eventName` / `idempotencyKey` non-empty and ≤ 256 characters, serialized payload ≤ 65536 bytes (code 3) → one conflict-safe insert with the matched SAN as `source_service` → `{}`. A failing insert logs ERROR (error message and origin only) and answers code 13 with the fixed message `webhook delivery could not be stored`. The stored `callback_url` is the request string as received; the worker re-parses it and delivers to the verdict's `href`.
- Files modified: `services/xstockstrat-notify/src/grpc/notifyServiceImpl.ts`
- TDD: one cycle with Step 8 (below).
- Deviations: none

### Step 8 — test: `fanoutWebhook` handler [done]
- Unit 7+8. 15 cases in a new `describe('fanoutWebhook (feature 334)')` block: method on the prototype; AC-27 (no auth context, SAN `xstockstrat-agent`, `x-internal-caller` header with the wrong SAN, look-alike SANs) → 7 and zero queries; AC-5 / AC-3 / AC-4 → 3, zero queries, URL not echoed; AC-6 (exact SQL shape and params); AC-7; AC-23; AC-24 (code 13, callback once, no response); AC-28 (empty `eventName` / key → OK, zero queries; bad URL and wrong peer still refused); field validation at and over each limit (payload measured in bytes). Same-file helpers `capturingPool` / `makePool` reused; no fixture import added. The pinned ungated-`EmitAlert` case is untouched and green.
- Files modified: `services/xstockstrat-notify/src/__tests__/notifyServiceImpl.test.ts`
- TDD: RED `pnpm exec tsc && node --test dist/__tests__/notifyServiceImpl.test.js` → `# tests 61 # pass 46 # fail 15`, e.g. `not ok 2 - @AC-27: a caller with no auth context is refused with code 7 and nothing is queried` / `impl.fanoutWebhook is not a function`; GREEN same command → `# tests 61 # pass 61 # fail 0`; `pnpm run test:coverage` → 207 pass / 0 fail, all files 86.61 % lines, `notifyServiceImpl.js` 94.06 %; `pnpm run lint` 0 errors; `c8 check-coverage --lines 40` exit 0.
- Deviations: none

### Step 9 — service: delivery worker, dead-letter alert, wiring (notify) [done]
- Unit 9+10. New `services/xstockstrat-notify/src/fanout/webhookWorker.ts`: `WebhookWorker(pool, config, emitAlert)` with `start()` (unref'd 5000 ms interval), `stop()` (clears the timer, aborts in-flight requests, records nothing for them) and `tick()` (one at a time, own catch, no per-tick log); exported pure `backoffDelaySeconds(attemptNumber, base, max)` and the `WebhookDeadLetterAlert` type. At most 4 attempts in flight; the in-flight map is the claim; every statement is a single `pool.query`. Statements: due-select (`state = 'pending' AND next_attempt_at <= NOW() AND NOT (delivery_id = ANY($1::uuid[])) ORDER BY next_attempt_at LIMIT $2`), delivered, retry (`attempts = attempts + 1, next_attempt_at = NOW() + make_interval(secs => $2), last_error = $3`), dead (`attempts = attempts + $2, last_error = $3`) — the three updates guarded `WHERE delivery_id = $1 AND state = 'pending'`. These are the statements Step 18's assertion file must copy.
- `notifyServiceImpl.ts`: pure extraction of `emitAlert` into private `persistAndBroadcast(req)` (insert, alert object, stream broadcast, `Alert emitted` log; returns the alert) and private `dispatchSideChannels(alert, md?)` (the two `queueMicrotask` dispatches). `emitAlert` is validate → `persistAndBroadcast` → `callback` → `dispatchSideChannels`. New public `emitInternalAlert(req)` = `persistAndBroadcast` then `dispatchSideChannels` with no metadata; it rejects if the insert fails. The existing emit / fanout / push suites pass unedited (only the `stubFetch` import moved).
- `telemetry.ts`: `DeliveryChannel` gains `'webhook'`, `DeliveryOutcome` gains `'dead'`. No test enumerates the value sets (the allowlist test checks label keys), so no telemetry test changed. `index.ts`: worker built after the pinned `delivery channels` line, `webhookWorker.start()` after `grpcServer.start()`, `webhookWorker.stop()` first in `shutdown`.
- `scripts/config-wiring.json`: added the `webhookWorker.ts:this.config` receiver and removed the four temporary `seeded-unread` baseline entries (`notify/webhook.max_attempts`, `.backoff_base_seconds`, `.backoff_max_seconds`, `.request_timeout_seconds`) in the same commit, as the Step 3 deviation requires. Only the ingest entry remains (Step 16).
- Dead-letter order (design open risk "a dead-letter alert whose insert fails is lost"; Step 10 item 18): only when the dead statement reports `rowCount === 1`, `recordDelivery('webhook', 'dead')` and `log.error('webhook delivery dead', { eventName, origin, idempotencyKey, attempts, lastError })` run first, then the alert; a failing alert is caught and logged at ERROR. Pinned by `the dead metric and the ERROR log are recorded before the alert, and survive a failing alert` (the alert callback reads the metric and the log before it throws) and `a failing alert insert is logged at ERROR and does not escape the worker`.
- Files modified: `services/xstockstrat-notify/src/fanout/webhookWorker.ts`, `services/xstockstrat-notify/src/grpc/notifyServiceImpl.ts`, `services/xstockstrat-notify/src/telemetry.ts`, `services/xstockstrat-notify/src/index.ts`, `scripts/config-wiring.json`
- TDD: one cycle with Step 10 (below). Verification: `check-config-wiring.mjs --keys notify.webhook.max_attempts,…` silent exit 0; `--final` exit 0; `node --test scripts/config-wiring.test.mjs` 75 pass / 0 fail; `grep "pool.connect\|BEGIN" webhookWorker.ts` no match; the pinned `delivery channels` line count 1; `scripts/check-watcher-copies.py` exit 0.
- Deviations: display origin for a row rejected at delivery, two extra `last_error` classes — detail in Deviation Log.

### Step 10 — test: delivery worker [done]
- Unit 9+10. `src/__tests__/webhookWorker.test.ts`, 48 tests: AC-8 (exact body string, headers, RFC 3339 `occurred_at` = `created_at`, recursive no-`user_id`, `sent` metric), AC-9 (408 / 429 / 500 / 503 / refused connection / timeout), AC-10 (400 / 404 / 413 / 422 → dead + one WARNING alert naming event and origin), AC-11, AC-12 (pure function and the statement's `secs`: 30 / 60 / 120 / 120), AC-13, AC-14, AC-15 (no fetch; allowlist read per attempt), AC-16 (`redirect: 'manual'`, one fetch, dead; opaque redirect and 301 / 307 / 308), 200-with-duplicate and 201 both delivered with the body cancelled and never read, distinct bodies for two dead rows, no alert when the dead statement changes no row, no `pool.connect` / transaction, 4-slot cap, one tick at a time, failing select contained, no `unhandledRejection`, best-effort retry after an unexpected throw, `stop()`, timer start / stop with no per-tick log, the URL-leak sweep over 13 outcomes (statement params, alerts, every log call), `emitInternalAlert` end to end, and the `index.ts` source order.
- The logger, the config client and the mTLS credentials are replaced before the modules under test load (the `configWatcher.test.ts` seam), so every log call is captured and a real `ConfigWatcher` can be fed snapshots.
- Fixtures (C-13): `src/__tests__/fixtures/stubFetch.ts` (`stubFetch(statusOrResponder)` → `{ calls, bodyReads(), bodyCancels(), restore }`, replies `{ status, headers?, type?, body? }` | `{ throws }` | `{ hang: true }`; helpers `abortError()`, `networkError(code, message?)`) and `fixtures/fakeConfig.ts` (`fakeConfig`, type `Cfg`, moved unchanged). `fanout.test.ts` and `notifyServiceImpl.test.ts` import them; no inline copy is left.
- Files modified: `services/xstockstrat-notify/src/__tests__/webhookWorker.test.ts`, `services/xstockstrat-notify/src/__tests__/fixtures/stubFetch.ts`, `services/xstockstrat-notify/src/__tests__/fixtures/fakeConfig.ts`, `services/xstockstrat-notify/src/__tests__/fanout.test.ts`, `services/xstockstrat-notify/src/__tests__/notifyServiceImpl.test.ts`
- TDD: RED `pnpm exec tsc && node --test dist/__tests__/webhookWorker.test.js` against a no-op stub of the worker and a throwing stub of `emitInternalAlert` (both must exist for `tsc`) → `# tests 48 # pass 2 # fail 46`, e.g. `not ok 1 - @AC-8: a 201 marks the row delivered and the request matches the wire format exactly`; GREEN same command → `# tests 48 # pass 48 # fail 0`; `pnpm run test:coverage` → 255 pass / 0 fail, all files 88.66 % lines, `webhookWorker.js` 99.14 %, `notifyServiceImpl.js` 94.27 %; `pnpm run lint` 0 errors; `c8 check-coverage --lines 40` exit 0.
- Deviations: config-reader tests added (review warning: ≤ 0 fallback of the four int keys, 1–60 clamp, real `ConfigWatcher` snapshot) — detail in Deviation Log.


### Step 11 — migration: `callback_url` and hand-off markers on `ingest.backfill_jobs` [done]
- Added ingest migration `015_backfill_webhook_callback`: three nullable columns on `ingest.backfill_jobs` (`callback_url text`, `webhook_enqueued_at timestamptz`, `webhook_rejected_at timestamptz`), no default, no index; the down drops the three. `scripts/migration-rerun.sh:760` now expects `ingest:15` as the clean end state.
- Files modified: `services/xstockstrat-ingest/migrations/015_backfill_webhook_callback.up.sql`, `services/xstockstrat-ingest/migrations/015_backfill_webhook_callback.down.sql`, `scripts/migration-rerun.sh`
- TDD: N/A (migration). Verified offline: both files exist as `015` (ingest tip is `014` on this branch and on `origin/main-dev`); three `ADD COLUMN IF NOT EXISTS` ↔ three `DROP COLUMN IF EXISTS`, so both directions are re-runnable; `grep -n "for want in ingest:15 analysis:27" scripts/migration-rerun.sh` → line 760; `bash -n scripts/migration-rerun.sh` exit 0. Not applied to any database — the replay is proven only by CI job `migration-rerun`.
- Deviations: none

### Step 12 — service: backfill-job repository functions (ingest) [done]
- Unit 12+13. `insert_job` gains keyword `callback_url: str | None = None` (eighth column / `$8` of the static INSERT). New static-SQL functions: `list_webhook_handoff_candidates(db_pool, *, terminal_statuses, limit)` (`callback_url IS NOT NULL AND status = ANY($1::smallint[]) AND webhook_enqueued_at IS NULL AND webhook_rejected_at IS NULL ORDER BY completed_at, created_at LIMIT $2`), `mark_webhook_enqueued(db_pool, job_id) -> bool` and `mark_webhook_rejected(db_pool, job_id) -> bool` (`UPDATE … SET <marker> = NOW() WHERE job_id = $1::uuid AND webhook_enqueued_at IS NULL AND webhook_rejected_at IS NULL`; True only on the driver status `UPDATE 1`). `_UPDATABLE_COLUMNS` untouched; no `ingest_pb2` import. These are the statements Step 18 copies.
- Files modified: `services/xstockstrat-ingest/app/repositories/backfill_jobs.py`
- TDD: one cycle with Step 13 (below).
- Deviations: tests written first (Step 13) and both steps in one commit; lint run as `uv run ruff …` (review warnings) — detail in Deviation Log.

### Step 13 — test: backfill-job repository functions [done]
- Unit 12+13. `tests/_helpers.py` `job_row` now has the 19 DDL columns (`callback_url`, `webhook_enqueued_at`, `webhook_rejected_at` default `None`). `tests/test_backfill_jobs.py` adds 6 tests: `insert_job` binds the URL as the eighth value and names the column (AC-2), binds `None` without it; the candidate select carries the four predicates (no `OR`), the ordering, and binds the status list and limit (AC-21, AC-29); both marker updates carry both `IS NULL` guards, never touch `status`, and return True / False for `UPDATE 1` / `UPDATE 0`; the three new columns are not in `_UPDATABLE_COLUMNS`.
- Files modified: `services/xstockstrat-ingest/tests/test_backfill_jobs.py`, `services/xstockstrat-ingest/tests/_helpers.py`
- TDD: RED `uv run pytest -q tests/test_backfill_jobs.py` → `5 failed, 8 passed`, e.g. `AttributeError: module 'app.repositories.backfill_jobs' has no attribute 'mark_webhook_rejected'`; GREEN same command → `13 passed`; `uv run pytest --cov=app --cov-report=term-missing --cov-fail-under=40` → `421 passed`, total 85.28 %; `uv run ruff check . && uv run ruff format --check .` exit 0; `grep ingest_pb2 app/repositories/backfill_jobs.py` no match.
- Deviations: as Step 12.

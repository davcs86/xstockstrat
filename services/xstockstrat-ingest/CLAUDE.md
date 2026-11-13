# xstockstrat-ingest — CLAUDE.md

<!-- context-forge:constitution-pointer:start -->
> **Constitution:** non-obvious local invariants (proto-free repos, allow-listed dynamic SQL, `page_token`-as-int-offset, `QuerySignals` producer semantics) live in [`docs/context-constitution.md`](docs/context-constitution.md); defects (restart re-drives already-finalized chunked backfill jobs) in [`docs/context-constitution-findings.md`](docs/context-constitution-findings.md). Inherits the root [`PLAT-*` constitution](../../docs/context-constitution.md).
<!-- context-forge:constitution-pointer:end -->

## Role

Python gRPC service that orchestrates historical data backfills, normalises raw data payloads, and **persists newsletter/external signals** to TimescaleDB. Does **not** call Alpaca directly — delegates all market data fetching to xstockstrat-marketdata. Publishes job lifecycle events to xstockstrat-ledger.

As of Phase 3, ingest owns a database schema (`ingest`) and is no longer stateless — it persists newsletter signals to the `ingest.newsletter_signals` hypertable for consumption by analysis (`QuerySignals`; indicators makes no ingest calls).

## Docker Build Pattern

Python pattern — see `docs/patterns/docker-build.md` for single-stage `uv` builds, `--frozen --no-dev` flags, and proto namespace package setup.

## Ports

**Authorization.** `TriggerBackfill` (the provider-quota-spending op) and `CancelBackfill` are
**admin-gated** — they abort `PERMISSION_DENIED` ("admin scope required")
unless the propagated `x-access-scope` carries the ADMIN bit (`0x04`), via the shared
`IngestServicer._has_admin_scope`. `ManageSignalSource` is **owner-gated** (feature 224,
§ Ownership below). (`TriggerBackfill`'s gate was added by feature 092 — F-11; before
that it queued paid jobs for any caller.) **Feature 143**: `TriggerBackfill` also rejects any
timeframe other than `1d` (`INVALID_ARGUMENT`), independent of the admin gate — only daily bars are
servable platform-wide, so a `15m`/`1h` job is refused before it is persisted or spends provider
quota. Its chunk-runner retry loop also treats a permanent `INVALID_ARGUMENT` from marketdata's
own `1d`-only gate as non-retryable (no 2s/4s/8s backoff on a request that can never succeed).

### Ownership (feature 224)

Signal sources and signals are **private to their owner** (`user_id`, from the `x-user-id` header via
`_resolve_owner`). `signal_sources` is keyed `(user_id, slug)`, so two owners may hold the same slug.

- **Reserved `system` owner.** `user_id='system'` holds the platform's sources (the `derived`
  fundamentals producer). An inbound `x-user-id: system` is honoured only with an `x-internal-caller`
  grant covering the RPC **and** an mTLS peer SAN of `xstockstrat-analysis` (`_SYSTEM_GRANTS`,
  `peer_san_matches`), else `PERMISSION_DENIED`: `analysis-fundsignal` → `ManageSignalSource`,
  `IngestSignal` (the only path that writes `system` rows); `analysis-system-read` → `QuerySignals`,
  `ListSignalSources`.
- **Reserved slugs (C-10(c)).** A slug already held by `system` is reserved — no literal list. A user
  REGISTER of it → `ALREADY_EXISTS`; a `system` REGISTER of a user-held slug → `FAILED_PRECONDITION`.
  Update/(de|re)activate of a `system` source by anyone else → `PERMISSION_DENIED`; a foreign user's
  slug is `NOT_FOUND` (indistinguishable from missing), and no caller — admin included — writes another
  owner's source.
- **Reads.** `ListSignalSources` and `QuerySignals` return own + `system` rows. `QuerySignals`
  narrows with `SignalScope` (`UNSPECIFIED` = own + system, `OWN`, `SYSTEM`). An ADMIN may name
  another owner via `owner_user_id` (read-only), which emits `audit.admin_read` to ledger and fails
  closed `UNAVAILABLE` if the audit append fails (`app/admin_audit.py`).
- **Dedup is per owner** — claims live in `ingest.signal_dedup_claims`, keyed
  `(user_id, source, symbol, direction)`.
- **Identity gate.** A call with no `x-user-id` to an owner-scoped RPC (all but the backfill RPCs and
  `NormalizeRawData`) → `UNAUTHENTICATED` (feature 225 `owner_scoped`), before the body runs.
- **Templates.** `ListTemplates` / `ManageTemplate` (ADMIN only) / `InstantiateTemplate` over
  `ingest.source_templates`; an instance is an independent private copy carrying
  `origin_template_id`/`origin_template_version`.

## Dependencies

| Dependency | Type | Reason |
|---|---|---|
| xstockstrat-config | gRPC WatchConfig | Live config at startup |
| xstockstrat-marketdata | gRPC write | Trigger Alpaca backfill jobs |
| xstockstrat-ledger | gRPC write | Publish backfill and signal lifecycle events |
| xstockstrat-notify | gRPC write | Alert on backfill failures; `FanoutWebhook` to validate a `callback_url` at trigger time and to hand off a finished job's webhook |
| TimescaleDB | asyncpg pool | Persist newsletter signals to `ingest.newsletter_signals` |

## Database

- Schema: `ingest`
- Table: `ingest.newsletter_signals` — TimescaleDB hypertable (7-day chunks by `ingested_at`)
- Migration: `migrations/001_newsletter_signals.up.sql`
- Table `ingest.signal_sources` — source registry; **migration `008_signal_source_health`** (feature
  083) adds `health`/`last_seen_at`/`last_error`/`signals_fed`. `IngestSignal` bumps
  `last_seen_at`+`signals_fed` (best-effort) on a fresh signal, or `last_seen_at` only (via
  `touch_source_last_seen`) on a dedup hit; `ListSignalSources` derives LIVE/STALE/DOWN health on
  read from `last_seen_at` freshness (`signal_sources.derive_health_status`).
- Table `ingest.signal_dedup_claims` — plain (non-hypertable) side table,
  `PRIMARY KEY (user_id, source, symbol, direction)` (migration `013`, feature 224); `IngestSignal`
  atomically claims a row per submission (`INSERT ... ON CONFLICT ... DO UPDATE ... WHERE claimed_at <
  NOW() - dedup_window_hours OR conviction/valid_until differ ... RETURNING signal_id`) inside its
  first explicit asyncpg transaction. A claim miss (`WHERE` false) means the submission is a
  duplicate; the response carries `deduplicated=true` and the existing `signal_id`. Its owner-less
  predecessor `signal_dedup_keys` (migration `009`, feature 111) was dropped by migration `014`.
- Migration `013_signal_ownership_templates` (feature 224, `-- requires-env: SEED_USER_ID`): adds
  `user_id` to `signal_sources` (PK → `(user_id, slug)`) and `newsletter_signals` (index
  `(user_id, ingested_at DESC)`) — `derived` sources and their signals go to `system`, every other legacy
  row to `SEED_USER_ID`; creates `signal_dedup_claims` (seeded from `signal_dedup_keys`) and
  `source_templates`; adds the `origin_template_*` columns. Its N-1 trigger/function were dropped by
  `014` (feature 225, `-- contract-of` `013`; its down raises).
- Migration `016_seed_source_templates` (feature 335, data only): 4 `created_by = 'system'` source
  templates, and the `system` / `derived` `fundamentals` source inserted only when no owner holds that
  slug (an existing row is never modified); its down never touches `signal_sources`. System templates
  are read-only — `ManageTemplate` refuses UPDATE / RETIRE (`PERMISSION_DENIED`) and
  `TemplateMeta.read_only` reports it; a catalog change ships as a new version-guarded migration, never a
  `DELETE`. The two SEC templates carry a placeholder User-Agent contact each user must replace.
- Table: `ingest.backfill_jobs` — durable backfill job state (plain table, **not** a hypertable);
  replaces the former in-memory `self._jobs` dict. Persists status, progress (`bars_processed` /
  `bars_total`), `failed_symbols`, and timestamps so jobs survive a restart. On startup the servicer
  reconciles every job left `RUNNING`/`QUEUED` by a previous process to `FAILED` ("interrupted by
  restart"), then `resume_incomplete_jobs` re-drives each job that still has `PENDING`/`FAILED` chunks,
  skipping a job whose persisted status is `CANCELED` (feature 261). A job canceled while `QUEUED`
  never starts: it is not flipped to `RUNNING` once a backfill slot frees. Chunk-plan progress is tracked by the `chunks_total` /
  `chunks_completed` columns (added in migration 005 — feature 054 shipped the proto fields and the
  servicer writes but originally omitted the backing columns, which left jobs stuck in `queued`).
- Migration: `migrations/003_backfill_jobs.up.sql`, `migrations/005_add_backfill_job_chunk_counts.up.sql`
- Backfill completion webhook — migration `015_backfill_webhook_callback` adds three nullable columns to
  `ingest.backfill_jobs`: `callback_url`, `webhook_enqueued_at`, `webhook_rejected_at`.
  - **Trigger.** A non-empty `TriggerBackfillRequest.callback_url` is judged by notify
    (`FanoutWebhook` with `validate_only`) before the job row is written. A refused URL →
    `INVALID_ARGUMENT` with notify's reason; notify refusing ingest as a caller → `FAILED_PRECONDITION`;
    notify unreachable or any other failure → `UNAVAILABLE` ("no job was created"). In all three no
    job exists. The URL is stored on the row and is not a field of the `BackfillJob` message.
  - **Hand-off.** `app/engine/webhook_handoff_loop.py` is the only path that sends a job to notify. It
    starts after `resume_incomplete_jobs()`, waits before its first cycle, and then runs whenever a
    terminal status write wakes it and at least every `backfill.webhook_sweep_interval_seconds`. A
    cycle takes terminal jobs (`COMPLETED`, `PARTIAL`, `FAILED`, `CANCELED`) that have a
    `callback_url` and neither marker, oldest first, and calls `FanoutWebhook` with idempotency key
    `backfill:<job_id>:<STATUS>` and event `ingest.backfill.completed` (`COMPLETED` and `PARTIAL`),
    `ingest.backfill.failed` or `ingest.backfill.canceled`. The payload is built from row columns
    (`job_id`, `status`, `data_kind`, `symbols`, `bars_processed`, `failed_symbols`, `started_at`,
    `completed_at`) and never carries the job's `error`.
  - **Once per job.** Accepted → `webhook_enqueued_at`; delivery and retries are then notify's.
    Refused URL (`INVALID_ARGUMENT`) → `webhook_rejected_at` and one WARNING alert (category
    `backfill`). Any other failure sets no marker and ends the cycle; the job is retried on the next one.
- Table: `ingest.backfill_chunks` — per-chunk progress for resumable/chunked backfills (feature 054);
  FK to `ingest.backfill_jobs(job_id)` (cascade). A job is planned into time/symbol chunks
  (`chunk_window_days` × `chunk_max_bars`); chunks run in parallel (`max_concurrent_chunks`) and on
  restart any PENDING/FAILED chunks are re-driven (idempotent marketdata upsert makes re-fetch safe).
  `fill_mode=GAPS_ONLY` plans only the ranges marketdata's `GetDataCoverage` reports missing.
- Migration: `migrations/004_add_backfill_chunks.up.sql`

## Config Keys Consumed

> **Rule (C-05, CONFIG-9):** the stored key is namespace-relative; the FQN is display-only; every read key is seeded
> by a config migration.

Namespace: `ingest`. Keys are listed and read as namespace-relative (`backfill.max_concurrent_jobs`); logs and
errors may print the FQN `ingest.<key>`.

| Key | Type | Default | Description |
|---|---|---|---|
| `backfill.max_concurrent_jobs` | int | `3` | Max parallel backfill jobs. A stored ≤ 0 reads as the default |
| `backfill.retry_on_failure` | bool | `true` | Auto-retry failed jobs |
| `backfill.max_retry_attempts` | int | `3` | Max retry attempts for transient backfill failures. A configured `0` (no retries) is honoured (feature 173) |
| `backfill.chunk_max_bars` | int | `200000` | Max estimated bars per backfill chunk (planner cap, feature 054). A stored ≤ 0 reads as the default |
| `backfill.chunk_window_days` | int | `90` | Time-window size (days) the chunk planner splits a range into. A stored ≤ 0 reads as the default |
| `backfill.max_concurrent_chunks` | int | `3` | Max chunks of one job fetched in parallel. A stored ≤ 0 reads as the default |
| `backfill.webhook_sweep_interval_seconds` | int | `60` | Longest wait between two webhook hand-off cycles; a terminal status write also wakes the loop, so this bounds how soon a failed hand-off is retried. A stored ≤ 0 reads as the default. Seed migration `048_webhook_fanout_callback_keys` |
| `signals.dedup_window_hours` | int | `24` | Window within which a matching (source, symbol, direction, conviction, valid_until) signal is treated as a duplicate of the owner's existing `ingest.signal_dedup_claims` claim (feature 111; per owner since feature 224). A configured `0` is honoured: it disables the dedup window (feature 173) |
| `mcp_client.poll_interval_seconds` | int | `300` | Server-side MCP query loop cadence for `mcp_client` sources (feature 166). A stored ≤ 0 reads as the default (a settable 0 cannot busy-loop). Seed migration `025_ingest_mcp_client_keys` |
| `mcp_client.request_timeout_seconds` | int | `30` | Per-call outbound MCP request timeout for `mcp_client` sources (feature 166). A stored ≤ 0 reads as the default. Seed migration `025_ingest_mcp_client_keys` |

> **`mcp_client` bearer secret (feature 166; per-user since feature 224).** An `mcp_client` source
> references an encrypted bearer at an opaque per-user key `ingest.mcp_credential.<uuid>`
> (`is_secret=true`, `user_id` = the source owner — never the slug, **not** a seeded default). It is
> written secret-first as the caller's own row via `SetConfig(is_secret=true, create_key=true,
> user_id=<caller>)` (agent `manage_signal_source`/`instantiate_template`, or the `/insights` BFF) and
> resolved by the poller via `GetSecret(user_id=<source owner>)` — exact scope, no global fallback —
> with `x-internal-caller: ingest` under config's `keyPrefixes: ['mcp_credential.']` grant, which is
> bound to the mTLS peer SAN `xstockstrat-ingest`. A missing or empty bearer marks the source
> "bearer not configured". It is never in `config_json` and never returned by any read edge.

## Ledger Events Emitted

| Event Type | Trigger |
|---|---|
| `ingest.backfill.queued` | Job created |
| `ingest.backfill.running` | Job started |
| `ingest.backfill.completed` | Job done |
| `ingest.backfill.failed` | Job error |
| `ingest.signal.ingested` | Newsletter signal persisted |
| `audit.admin_read` | An ADMIN read another owner's sources/signals (feature 224; 1 event on the admin's stream + 1 per foreign owner) |

## Running Tests

```bash
uv sync --extra dev   # install deps (including dev) from uv.lock
uv run pytest         # run all tests
uv run pytest --cov=app --cov-fail-under=40  # with coverage
```

## Observability (feature 294-signal-map-instrumentation)

The throttles, N, windows and caps below are code constants, not config keys; loop cadences are defaults, and several are config keys (see Config Keys Consumed). Label values are closed sets; the service's telemetry allowlist test fails on any identifier or secret label.

- INFO `loop tick ok` carries `loop`, `duration_ms` and optional `state` (no `state` = work was done); a tick writes no record when every item that reached its fallible call failed. Written by `mcp_client` (300 s; `idle` when there are no mcp_client sources) and `webhook_handoff` (60 s or on a terminal backfill write; `idle` when no job awaits hand-off; no record when a hand-off failed for a reason other than a refused URL). A "bearer not configured" source counts as attempted, not failed.
- Instruments: `ingest.source.poll{outcome ok|no_bearer|config_error|all_items_failed|error}`, `ingest.source.poll.duration`, `ingest.signal.dropped{stage=extract, reason non_object|bad_symbol_direction|bad_conviction}`, `ingest.signal.outcome{path mcp_poll|rpc, outcome ingested|deduplicated|rejected|error}`, `ingest.backfill.jobs{outcome=failed}`, `template.instantiate{service, outcome}`.
- Load-bearing logs: WARN `mcp_client loop: source %s bearer not configured` (slug); ERROR `_resume_job failed`; ERROR `webhook hand-off for job %s refused by notify's caller gate`; extractor drop logs carry the slug and the item truncated to 200 characters (`_LOG_ITEM_CHARS`).

## Environment Variables

> **Inter-service mTLS (feature 210):** this service also requires `MTLS_CERT` / `MTLS_KEY` / `MTLS_CA_CERT` — boot-time PEM strings (its own leaf, private key, and the platform CA). The gRPC server binds mutual TLS and every outbound gRPC dial presents the leaf; **fail-closed** — the service refuses to start if any is absent. `MTLS_KEY` is a `SECRET` in `.do/app*.yaml`. Contract → `docs/patterns/inter-service-mtls.md`; rollout → `docs/runbooks/inter-service-mtls-rollout.md`.

```text
GRPC_PORT=50055
CONFIG_ENDPOINT=xstockstrat-config:50060
MARKETDATA_ENDPOINT=xstockstrat-marketdata:50053
LEDGER_ENDPOINT=xstockstrat-ledger:50057
NOTIFY_ENDPOINT=xstockstrat-notify:50059
APPLICATION_ENV=development         # development | production
TRADING_MODE=paper                     # paper | live
```

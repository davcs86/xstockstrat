# xstockstrat-ingest — CLAUDE.md

<!-- context-forge:constitution-pointer:start -->
> **Constitution:** non-obvious local invariants (proto-free repos, allow-listed dynamic SQL, `page_token`-as-int-offset, `QuerySignals` producer semantics) live in [`docs/context-constitution.md`](docs/context-constitution.md); defects (9 dead config keys, unimplemented dedup, dead indicators-only `sandbox_*` helpers) in [`docs/context-constitution-findings.md`](docs/context-constitution-findings.md). Inherits the root [`PLAT-*` constitution](../../docs/context-constitution.md).
<!-- context-forge:constitution-pointer:end -->

## Role

Python gRPC service that orchestrates historical data backfills, normalises raw data payloads, and **persists newsletter/external signals** to TimescaleDB. Does **not** call Alpaca directly — delegates all market data fetching to xstockstrat-marketdata. Publishes job lifecycle events to xstockstrat-ledger.

As of Phase 3, ingest owns a database schema (`ingest`) and is no longer stateless — it persists newsletter signals to the `ingest.newsletter_signals` hypertable for consumption by analysis (`QuerySignals`; indicators makes no ingest calls).

## Language

Python 3.13 (asyncio, grpc.aio)

## Docker Build Pattern

Python pattern — see `docs/patterns/docker-build.md` for single-stage `uv` builds, `--frozen --no-dev` flags, and proto namespace package setup.

## Ports

| Protocol | Port | Purpose |
|---|---|---|
| gRPC | `50055` | Internal service-to-service (protobuf) |

This service is **gRPC-only** (`app/main.py` runs a single `grpc.aio` server). The MCP agent
ingests signals via the `IngestSignal` gRPC RPC. The former HTTP/Connect-RPC server on `8055`
(and its `/webhooks/{trigger-backfill,backfill-status,ingest-signal}` handlers) was removed.

**Authorization.** `TriggerBackfill` (the provider-quota-spending op) and `CancelBackfill` are
**admin-gated** — they abort `PERMISSION_DENIED` ("admin scope required")
unless the propagated `x-access-scope` carries the ADMIN bit (`0x04`), via the shared
`IngestServicer._has_admin_scope`. `ManageSignalSource` is **owner-gated** for headered callers
(feature 224, § Ownership below); only the headerless release-N path keeps the ADMIN-bit check. (`TriggerBackfill`'s gate was added by feature 092 — F-11; before
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
- **Headerless tolerance (release N only; the follow-up "224 enforce + contract" removes it).** A call
  with no `x-user-id`: `IngestSignal` and non-REGISTER `ManageSignalSource` resolve the slug's unique
  holder (0 holders → `INVALID_ARGUMENT` / `NOT_FOUND`, >1 → `FAILED_PRECONDITION`); `ManageSignalSource`
  still needs the ADMIN bit and never REGISTERs; `QuerySignals`/`ListSignalSources` stay unscoped.
- **Templates.** `ListTemplates` / `ManageTemplate` (ADMIN only) / `InstantiateTemplate` over
  `ingest.source_templates`; an instance is an independent private copy carrying
  `origin_template_id`/`origin_template_version`.

## Dependencies

| Dependency | Type | Reason |
|---|---|---|
| xstockstrat-config | gRPC WatchConfig | Live config at startup |
| xstockstrat-marketdata | gRPC write | Trigger Alpaca backfill jobs |
| xstockstrat-ledger | gRPC write | Publish backfill and signal lifecycle events |
| xstockstrat-notify | gRPC write | Alert on backfill failures |
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
- Table `ingest.signal_dedup_keys` — plain (non-hypertable) side table,
  `PRIMARY KEY (source, symbol, direction)`; `IngestSignal` atomically claims a row per submission
  (`INSERT ... ON CONFLICT ... DO UPDATE ... WHERE claimed_at < NOW() - dedup_window_hours OR
  conviction/valid_until differ ... RETURNING signal_id`) inside its first explicit asyncpg
  transaction. A claim miss (`WHERE` false) means the submission is a duplicate; the response
  carries `deduplicated=true` and the existing `signal_id`. Migration:
  `migrations/009_signal_dedup_keys.up.sql` (feature 111). **Feature 224:** release N claims in the
  owner-keyed `ingest.signal_dedup_claims` (`PRIMARY KEY (user_id, source, symbol, direction)`, same
  `ON CONFLICT … WHERE` shape) instead; `signal_dedup_keys` is kept only for N-1 and dropped by the
  follow-up contract.
- Migration `013_signal_ownership_templates` (feature 224, `-- requires-env: SEED_USER_ID`): adds
  `user_id` to `signal_sources` (PK → `(user_id, slug)`) and `newsletter_signals` (index
  `(user_id, ingested_at DESC)`) — `derived` sources and their signals go to `system`, every other legacy
  row to `SEED_USER_ID`; creates `signal_dedup_claims` (seeded from `signal_dedup_keys`) and
  `source_templates`; adds the `origin_template_*` columns. An N-1 BEFORE INSERT trigger on
  `newsletter_signals` fills a missing `user_id` with the slug's unique holder, else raises.
- Table: `ingest.backfill_jobs` — durable backfill job state (plain table, **not** a hypertable);
  replaces the former in-memory `self._jobs` dict. Persists status, progress (`bars_processed` /
  `bars_total`), `failed_symbols`, and timestamps so jobs survive a restart. On startup the servicer
  reconciles any job left `RUNNING`/`QUEUED` by a previous process to `FAILED` ("interrupted by
  restart", FR-3 — no automatic resume). Chunk-plan progress is tracked by the `chunks_total` /
  `chunks_completed` columns (added in migration 005 — feature 054 shipped the proto fields and the
  servicer writes but originally omitted the backing columns, which left jobs stuck in `queued`).
- Migration: `migrations/003_backfill_jobs.up.sql`, `migrations/005_add_backfill_job_chunk_counts.up.sql`
- Table: `ingest.backfill_chunks` — per-chunk progress for resumable/chunked backfills (feature 054);
  FK to `ingest.backfill_jobs(job_id)` (cascade). A job is planned into time/symbol chunks
  (`chunk_window_days` × `chunk_max_bars`); chunks run in parallel (`max_concurrent_chunks`) and on
  restart any PENDING/FAILED chunks are re-driven (idempotent marketdata upsert makes re-fetch safe).
  `fill_mode=GAPS_ONLY` plans only the ranges marketdata's `GetDataCoverage` reports missing.
- Migration: `migrations/004_add_backfill_chunks.up.sql`

## Config Keys Consumed

Namespace: `ingest`

| Key | Type | Default | Description |
|---|---|---|---|
| `ingest.backfill.max_concurrent_jobs` | int | `3` | Max parallel backfill jobs |
| `ingest.backfill.default_timeframe` | string | `1d` | **Documented, not yet wired** — the servicer hardcodes `"1d"` rather than reading this key |
| `ingest.backfill.retry_on_failure` | bool | `true` | Auto-retry failed jobs |
| `ingest.backfill.max_retry_attempts` | int | `3` | Max retry attempts for transient backfill failures. Read via `get_int_present` (never `get_int`): a configured `0` = no retries is honored (feature 173) |
| `ingest.backfill.chunk_max_bars` | int | `200000` | Max estimated bars per backfill chunk (planner cap, feature 054) |
| `ingest.backfill.chunk_window_days` | int | `90` | Time-window size (days) the chunk planner splits a range into |
| `ingest.backfill.max_concurrent_chunks` | int | `3` | Max chunks of one job fetched in parallel |
| `ingest.signals.dedup_window_hours` | int | `24` | Window within which a matching (source, symbol, direction, conviction, valid_until) signal is treated as a duplicate of the owner's existing `ingest.signal_dedup_claims` claim (feature 111; per owner since feature 224). Read via `get_int_present` (never `get_int`): a configured `0` disables the dedup window (feature 173) |
| `ingest.mcp_client.poll_interval_seconds` | int | `300` | Server-side MCP query loop cadence for `mcp_client` sources (feature 166). Clamped to ≥1 at read (a settable 0 cannot busy-loop). Seed migration `025_ingest_mcp_client_keys` |
| `ingest.mcp_client.request_timeout_seconds` | int | `30` | Per-call outbound MCP request timeout for `mcp_client` sources (feature 166). Clamped to ≥1 at read. Seed migration `025_ingest_mcp_client_keys` |

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

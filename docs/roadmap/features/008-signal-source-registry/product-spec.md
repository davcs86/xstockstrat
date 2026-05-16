# Product Spec: signal-source-registry

**Created**: 2026-05-16

---

## Problem Statement

The `source` field on `ExternalSignal` is a free-form string with no validation or registry. Different callers can use `"goldman"`, `"goldman_sachs"`, or `"Goldman Sachs"` for the same source, resulting in silent data fragmentation: the analysis service filters by exact string match, so mismatched slugs silently produce zero signal results during backtesting. There is also no way for the AI agent or analysis service to discover what sources exist at runtime, and no standard interface for extracting signals from different source types (email bodies, attachments, linked URLs, websites).

## User Story

As a platform operator, I want a centralized source registry that defines every valid signal source, its type, and its extractor, so that signal ingestion is consistent, discoverable, and extensible without code fragmentation.

## Functional Requirements

FR-1. The ingest service must maintain an `ingest.signal_sources` DB table with columns: `slug` (TEXT PRIMARY KEY, lowercase underscore-separated), `display_name` (TEXT), `source_type` (TEXT, constrained to valid enum values), `extractor_module` (TEXT, Python dotted module path), `credentials_ref` (TEXT NULLABLE, references a `secret.*` config key), `active` (BOOLEAN DEFAULT TRUE), `config_json` (JSONB NULLABLE, source-specific config), `created_at` (TIMESTAMPTZ).

FR-2. `source_type` must be constrained to exactly five values: `simple_email`, `email_attachment`, `linked_email`, `simple_website`, `authenticated_website`.

FR-3. The `IngestSignal` RPC must validate that the incoming `source` slug exists in `ingest.signal_sources` with `active = TRUE`. Unknown or inactive slugs must be rejected with `INVALID_ARGUMENT`.

FR-4. A new `ListSignalSources` RPC must be added to the ingest proto, returning all active sources with their slug, display_name, source_type, and extractor_module. Credentials and config_json must not be returned.

FR-5. A `BaseExtractor` abstract class must be defined at `services/xstockstrat-ingest/app/extractors/base.py` with a single async method `extract(raw: RawInput) -> list[dict]`, where `RawInput` is a union type covering the five source types:
  - `SimpleEmailInput(body_text: str, body_html: str)`
  - `EmailAttachmentInput(body_text: str, body_html: str, attachments: list[bytes])`
  - `LinkedEmailInput(body_text: str, body_html: str, urls: list[str])`
  - `SimpleWebsiteInput(url: str, html: str)`
  - `AuthenticatedWebsiteInput(url: str, html: str, credentials: dict)`

FR-6. Each registered source must have a corresponding extractor module at `services/xstockstrat-ingest/app/extractors/<slug>.py` implementing `BaseExtractor`. The module path stored in `extractor_module` must be importable at runtime.

FR-7. For authenticated sources, credentials must only be stored as a reference to a `secret.*` config key (e.g. `secret.ingest.sources.unusual_whales.api_key`). The registry row must never store credential values. The extractor retrieves the credential value from the config service at extraction time.

FR-8. A `ManageSignalSource` RPC (or equivalent admin endpoint) must allow registering, updating, and deactivating sources. Deactivation sets `active = FALSE`; rows are never deleted.

FR-9. The ingest service's existing `QuerySignals` RPC must be unaffected — it continues to filter by slug string match. The registry enforces slug canonicality at write time (IngestSignal), not at read time.

## Out of Scope

- Automatic extraction scheduling or polling of sources (belongs in the agent feature).
- Built-in extractor implementations beyond a reference example — each source's extractor is owned by the team adding that source.
- UI for managing sources (config-ui is out of scope for this feature).
- Signal deduplication logic (separate concern).
- Any changes to the analysis service — it already uses source slugs correctly; the registry fixes the ingestion side.

## Affected Services

- `xstockstrat-ingest` — new DB table, new RPC (`ListSignalSources`, `ManageSignalSource`), updated `IngestSignal` validation, new `extractors/` package
- `packages/proto` — new messages and RPCs in `ingest/v1/ingest.proto`

## Proto Contract Changes

New RPCs in `IngestService`:
- `ListSignalSources(ListSignalSourcesRequest) returns (ListSignalSourcesResponse)`
- `ManageSignalSource(ManageSignalSourceRequest) returns (ManageSignalSourceResponse)`

New messages:
- `SignalSource { slug, display_name, source_type, extractor_module, active }`
- `ListSignalSourcesRequest { bool include_inactive = 1 }`
- `ListSignalSourcesResponse { repeated SignalSource sources = 1 }`
- `ManageSignalSourceRequest { SignalSource source, string operation = 2 }` (operation: `register` | `update` | `deactivate`)
- `ManageSignalSourceResponse { SignalSource source }`

All additions are non-breaking (new RPCs and messages only).

## Config Key Changes

No new platform config keys. Authenticated source credentials are referenced via existing `secret.*` convention, e.g.:
- `secret.ingest.sources.<slug>.api_key`
- `secret.ingest.sources.<slug>.cookie`

These keys are resolved from the secret store by the extractor at runtime; they are not new config keys to be registered here.

## Database Changes

New table in `xstockstrat-ingest` service:

```sql
-- NNN_add_signal_sources_registry.up.sql
CREATE TABLE IF NOT EXISTS ingest.signal_sources (
    slug            TEXT PRIMARY KEY,
    display_name    TEXT NOT NULL,
    source_type     TEXT NOT NULL CHECK (source_type IN (
                        'simple_email', 'email_attachment', 'linked_email',
                        'simple_website', 'authenticated_website')),
    extractor_module TEXT NOT NULL,
    credentials_ref TEXT,
    active          BOOLEAN NOT NULL DEFAULT TRUE,
    config_json     JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS signal_sources_active_idx ON ingest.signal_sources (active);
```

Down migration: `DROP TABLE IF EXISTS ingest.signal_sources;`

## Feature Workflow Notes

Branch to create: `feature/signal-source-registry` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking proto additions)
- [ ] 2 service owners + platform lead (breaking proto change) — not applicable
- [x] DBA review + service owner (schema migration — new table)

## Acceptance Criteria

1. `IngestSignal` with an unknown `source` slug returns `INVALID_ARGUMENT`; with a known active slug it succeeds as before.
2. `IngestSignal` with a known but `active = FALSE` slug returns `INVALID_ARGUMENT`.
3. `ListSignalSources` returns all active sources; credentials and config_json are absent from the response.
4. `ManageSignalSource(operation="register")` inserts a new source row; a second call with the same slug updates it.
5. `ManageSignalSource(operation="deactivate")` sets `active = FALSE`; the row is not deleted.
6. A source with `source_type = "authenticated_website"` and `credentials_ref = NULL` is rejected at registration time.
7. `BaseExtractor` is importable and each registered source's `extractor_module` can be dynamically imported without error.
8. A reference extractor (e.g. `extractors.example_simple_email`) is included and covered by unit tests.
9. Migration applies cleanly via `./scripts/db-migrate.sh` with no dirty state.

## Open Questions

- [ ] Should `ManageSignalSource` require a specific auth scope (e.g. admin API key) or is it open like other n8n webhooks?
- [ ] Should `config_json` schema be validated per source_type (e.g. `simple_website` must include `url_pattern`) or left freeform JSONB?
- [ ] What is the seeding strategy for initial sources — migration seed data, or a separate admin call at bootstrap time?

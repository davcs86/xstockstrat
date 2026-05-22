# Product Spec: signal-source-registry

**Created**: 2026-05-16

---

## Problem Statement

The `source` field on `ExternalSignal` is a free-form string with no validation or registry. Different callers can use `"goldman"`, `"goldman_sachs"`, or `"Goldman Sachs"` for the same source, resulting in silent data fragmentation: the analysis service filters by exact string match, so mismatched slugs silently produce zero signal results during backtesting. There is also no way for the AI agent or analysis service to discover what sources exist at runtime, and no standard interface for extracting signals from different source types (email bodies, attachments, linked URLs, websites).

## User Story

As a platform operator, I want a centralized source registry that defines every valid signal source, its type, and its extractor, so that signal ingestion is consistent, discoverable, and extensible without code fragmentation.

## Functional Requirements

FR-1. The ingest service must maintain an `ingest.signal_sources` DB table with columns: `slug` (TEXT PRIMARY KEY, lowercase underscore-separated), `display_name` (TEXT), `source_type` (TEXT, constrained to valid enum values), `extractor_module` (TEXT, Python dotted module path), `credentials_ref` (TEXT NULLABLE, references a `secret.*` config key), `active` (BOOLEAN DEFAULT TRUE), `config_json` (JSONB NULLABLE, source-specific config), `created_at` (TIMESTAMPTZ).

FR-2. `source_type` must be constrained to exactly eight values: `simple_email`, `email_attachment`, `linked_email`, `simple_website`, `authenticated_website`, `mediated_email`, `mediated_email_with_attachment`, `mediated_email_with_linked_url`. The `mediated_*` types designate sources whose content extraction is performed by the agent MCP service via Claude — they bypass the programmatic Python extractor pipeline in the ingest service entirely.

FR-3. The `IngestSignal` RPC must validate that the incoming `source` slug exists in `ingest.signal_sources` with `active = TRUE`. Unknown or inactive slugs must be rejected with `INVALID_ARGUMENT`.

FR-4. A new `ListSignalSources` RPC must be added to the ingest proto, returning all sources (active and inactive) with their slug, display_name, source_type, extractor_module, active flag, and config_json. `credentials_ref` must never be returned — the response includes a boolean `has_credentials` field instead.

FR-5. A `BaseExtractor` abstract class must be defined at `services/xstockstrat-ingest/app/extractors/base.py` with a single async method `extract(raw: RawInput) -> list[dict]`, where `RawInput` is a union type covering the five source types:
  - `SimpleEmailInput(body_text: str, body_html: str)`
  - `EmailAttachmentInput(body_text: str, body_html: str, attachments: list[bytes])`
  - `LinkedEmailInput(body_text: str, body_html: str, urls: list[str])`
  - `SimpleWebsiteInput(url: str, html: str)`
  - `AuthenticatedWebsiteInput(url: str, html: str, credentials: dict)`

FR-6. Each registered source must have a corresponding extractor module at `services/xstockstrat-ingest/app/extractors/<slug>.py` implementing `BaseExtractor`. The module path stored in `extractor_module` must be importable at runtime. Sources with `source_type` of `mediated_email_with_attachment` or `mediated_email_with_linked_url` are exempt from implementing a meaningful extractor — their `extractor_module` must be set to `app.extractors.noop`, a provided no-op extractor that returns an empty list. These sources are processed by the agent MCP service via Claude; the ingest service never invokes their extractor directly.

FR-7. For authenticated sources, credentials must only be stored as a reference to a `secret.*` config key (e.g. `secret.ingest.sources.unusual_whales.api_key`). The registry row must never store credential values. The extractor retrieves the credential value from the config service at extraction time.

FR-8. A `ManageSignalSource` RPC (or equivalent admin endpoint) must allow registering, updating, and deactivating sources. Deactivation sets `active = FALSE`; rows are never deleted.

FR-9. The ingest service's existing `QuerySignals` RPC must be unaffected — it continues to filter by slug string match. The registry enforces slug canonicality at write time (IngestSignal), not at read time.

FR-10. `config_json` must be validated per `source_type` at registration and update time. Required fields per type:
  - `simple_email`: `{ sender_patterns: string[], subject_patterns: string[] }` (at least one of each required)
  - `email_attachment`: `{ sender_patterns: string[], subject_patterns: string[], attachment_mime_types: string[] }`
  - `linked_email`: `{ sender_patterns: string[], subject_patterns: string[], url_patterns: string[] }`
  - `simple_website`: `{ url: string, scrape_selector: string }`
  - `authenticated_website`: `{ url: string, scrape_selector: string }` (credentials_ref also required for this type per FR-6)
  - `mediated_email`: `{ sender_patterns: string[], subject_patterns: string[] }` (credentials_ref not applicable — body is read directly by Claude)
  - `mediated_email_with_attachment`: `{ sender_patterns: string[], subject_patterns: string[], attachment_mime_types: string[] }` (credentials_ref optional — provided when attachment is password-protected)
  - `mediated_email_with_linked_url`: `{ sender_patterns: string[], subject_patterns: string[], url_patterns: string[] }` (credentials_ref optional — provided when linked URL requires authentication)

FR-11. A Sources management page must be added to `xstockstrat-config-ui` (port 3002) at route `/sources`. It must:
  - List all registered sources (active and inactive) with slug, display_name, source_type, and active status
  - Allow toggling a source active/inactive via a single enable/disable action
  - Allow editing source parameters in a structured form (see FR-12)
  - Allow registering a new source via a creation form
  - Show a weight field per source populated from `analysis.signals.source_weights` config key (read-only placeholder until signal-source-weighting feature 007 ships)

FR-12. The source edit form must render fields dynamically based on `source_type`:
  - **All types**: display_name, active toggle
  - **simple_email / email_attachment / linked_email / mediated_email / mediated_email_with_attachment / mediated_email_with_linked_url**: sender_patterns (multi-value text input), subject_patterns (multi-value text input)
  - **email_attachment / mediated_email_with_attachment**: additional attachment_mime_types field (multi-value)
  - **linked_email / mediated_email_with_linked_url**: additional url_patterns field (multi-value)
  - **simple_website / authenticated_website**: url field, scrape_selector field
  - **authenticated_website**: credentials_ref field (text input for the `secret.*` key name); a "configured" badge is shown if `has_credentials = true` in the response — the actual value is never displayed
  - **mediated_email / mediated_email_with_attachment / mediated_email_with_linked_url**: a "Claude-mediated" badge distinguishing these from programmatic extraction types
  - **mediated_email_with_attachment / mediated_email_with_linked_url**: optional credentials_ref field (same badge behaviour as authenticated_website)
  - **All types**: extractor_module field (text input, read-only after registration to prevent accidental breaks); the UI may optionally render the extractor source file content as a read-only code view — not a hard requirement

FR-13. The Sources UI must call `ManageSignalSource` (via Connect-RPC HTTP on port 8055) for all write operations. All writes require a valid admin API key (see FR-14).

FR-14. `ManageSignalSource` must require an admin-scoped API key in the `Authorization` header. The identity service issues admin keys; the ingest service validates the scope via the identity service's `ValidateToken` RPC before processing the request.

FR-15. The weight field in the Sources UI (FR-11) must be wired to read the `analysis.signals.source_weights` JSON config key from the config service. If the key is absent or the source slug is not in the map, it displays `1.0` (default). The field is read-only in this feature; editing weights is deferred to signal-source-weighting (007).

## Out of Scope

- Automatic extraction scheduling or polling of sources (belongs in the agent feature).
- Built-in extractor implementations beyond a reference example — each source's extractor is owned by the team adding that source.
- Signal deduplication logic (separate concern).
- Any changes to the analysis service — it already uses source slugs correctly; the registry fixes the ingestion side.
- Editing source weights from the UI (read-only display only; full weight editing belongs to signal-source-weighting feature 007).

## Affected Services

- `xstockstrat-ingest` — new DB table, new RPCs (`ListSignalSources`, `ManageSignalSource`), updated `IngestSignal` validation, new `extractors/` package, admin auth check via identity service
- `xstockstrat-config-ui` — new `/sources` page with source list, edit form, enable/disable toggle, weight display
- `packages/proto` — new messages and RPCs in `ingest/v1/ingest.proto`

## Proto Contract Changes

New RPCs in `IngestService`:
- `ListSignalSources(ListSignalSourcesRequest) returns (ListSignalSourcesResponse)`
- `ManageSignalSource(ManageSignalSourceRequest) returns (ManageSignalSourceResponse)`

New messages:
- `SignalSource { slug, display_name, source_type, extractor_module, active, has_credentials, google.protobuf.Struct config_json }`
- `ListSignalSourcesRequest { bool include_inactive = 1 }`
- `ListSignalSourcesResponse { repeated SignalSource sources = 1 }`
- `ManageSignalSourceRequest { SignalSource source, string credentials_ref, string operation }` (operation: `register` | `update` | `deactivate`; credentials_ref only used on register/update)
- `ManageSignalSourceResponse { SignalSource source }`

`credentials_ref` is present only on the request (write path) — it is never included in `SignalSource` response messages. `has_credentials` (bool) is the read-side indicator.

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
                        'simple_website', 'authenticated_website',
                        'mediated_email', 'mediated_email_with_attachment',
                        'mediated_email_with_linked_url')),
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
- [x] 1 service owner approval (non-breaking proto additions, config-ui page)
- [ ] 2 service owners + platform lead (breaking proto change) — not applicable
- [x] DBA review + service owner (schema migration — new table)
- [x] Security review — ManageSignalSource admin auth scope, credentials_ref never in responses

## Acceptance Criteria

1. `IngestSignal` with an unknown `source` slug returns `INVALID_ARGUMENT`; with a known active slug it succeeds as before.
2. `IngestSignal` with a known but `active = FALSE` slug returns `INVALID_ARGUMENT`.
3. `ListSignalSources` returns `has_credentials = true/false` per source; `credentials_ref` value is absent from all responses.
4. `ManageSignalSource(operation="register")` inserts a new source row; a second call with the same slug updates it.
5. `ManageSignalSource(operation="deactivate")` sets `active = FALSE`; the row is not deleted.
6. A source with `source_type = "authenticated_website"` and no `credentials_ref` is rejected with `INVALID_ARGUMENT` at registration time.
7. `ManageSignalSource` with a missing or non-admin `Authorization` header returns `UNAUTHENTICATED`.
8. `ManageSignalSource` with invalid `config_json` for the given `source_type` (e.g. `simple_email` missing `sender_patterns`) returns `INVALID_ARGUMENT`.
9. `BaseExtractor` is importable and each registered source's `extractor_module` can be dynamically imported without error.
10. A reference extractor (e.g. `extractors.example_simple_email`) is included and covered by unit tests.
11. Migration applies cleanly via `./scripts/db-migrate.sh` with no dirty state.
12. The `/sources` page in config-ui lists all sources, renders the correct form fields per source_type, and the enable/disable toggle calls `ManageSignalSource` and reflects the updated state.
13. The credentials_ref field in the edit form submits the value to `ManageSignalSource` but the field is cleared on load (never pre-populated from the response).
14. The weight field in the Sources UI shows the value from `analysis.signals.source_weights` for that slug, defaulting to `1.0` if absent, and is non-editable.

## Open Questions

- [x] What is the seeding strategy for initial sources — migration seed data, or a bootstrap admin call via the UI? **RESOLVED**: No seeding strategy required. Sources are registered on-demand by operators via the `/sources` page in config-ui after deployment. The migration is purely structural.
- [x] How should Claude-mediated sources be distinguished from programmatic extraction sources in the type system? **RESOLVED**: Two new source types — `mediated_email_with_attachment` and `mediated_email_with_linked_url` — are added to the CHECK constraint. These types signal to the agent service that content extraction is performed by Claude via the MCP path. Their `extractor_module` is set to `app.extractors.noop`; the ingest service never invokes it directly.

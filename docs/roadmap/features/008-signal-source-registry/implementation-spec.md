# Implementation Spec: signal-source-registry

**Status**: `in-progress`
**Created**: 2026-05-21
**Updated**: 2026-05-22
**Feature**: `docs/roadmap/features/008-signal-source-registry/feature.md`
**Total Steps**: 12
**Feature Branch**: `feature/signal-source-registry`

---

## Execution Summary

Steps execute in this order: proto changes first (Step 1), then proto-gen (Step 2), then the ingest DB migration (Step 3), then the ingest service changes split into four logical groups — the source registry layer (Step 4), extractor base + noop + reference example (Step 5), updated IngestSignal + new RPCs in the servicer (Step 6), and HTTP/Connect-RPC wiring for the two new RPCs (Step 7) — followed by tests for the ingest service (Step 8), then the config-ui API route (Step 9), config-ui Sources page (Step 10), a config-ui E2E test step (Step 11), and a noop extractor test step (Step 12) covering FR-6. The proto-gen step must follow the proto step. All ingest service steps depend on the proto-gen step completing (generated stubs must exist). The config-ui steps depend on the proto step only for the new message types that appear in the Connect-RPC call shape.

## Step Dependencies

- Step 2 requires Step 1: proto stubs must be generated from the updated proto before any service code can import the new message types.
- Step 4 requires Step 3: the registry module reads from `ingest.signal_sources` — the table must exist before service code that queries it is exercised in tests.
- Step 6 requires Steps 4 and 5: the updated `IngestSignal`, `ListSignalSources`, and `ManageSignalSource` handlers import from `app/repositories/signal_sources.py` (Step 4) and `app/extractors/base.py` (Step 5).
- Step 7 requires Step 6: HTTP routes reference servicer methods added in Step 6.
- Step 8 requires Steps 4–7: test coverage spans all new service code.
- Steps 9 and 10 require Step 1: the config-ui calls `ManageSignalSource` and `ListSignalSources` RPCs; their message shapes must be defined.
- Step 11 requires Steps 9 and 10: E2E tests exercise the finished API route and page.
- Step 12 requires Step 5: noop extractor tests cover the module created in Step 5.

---

### Step 1 — proto: Add ListSignalSources and ManageSignalSource to ingest proto

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/ingest/v1/ingest.proto` — modify

**Reviewers**: Proto Reviewer — field number uniqueness, no breaking changes without deprecation, `buf lint` passes; `xstockstrat-ingest` owner — signal normalization correctness, idempotent ingestion, newsletter source schema stability

**Codebase Evidence**:
- Confirmed via Read of `packages/proto/ingest/v1/ingest.proto`: existing service block has 6 RPCs ending at `QuerySignals` (L18). `QuerySignalsResponse` uses field numbers 1–2 (L102–105). `ExternalSignal` uses field numbers 1–9 (L79–89). New `SignalSource` message uses its own namespace starting at 1 — no conflict.
- `google/protobuf/struct.proto` import pattern confirmed in `packages/proto/config/v1/config.proto` L8 and `packages/proto/analysis/v1/analysis.proto` L8 — safe to add to ingest proto.
- Current imports in `packages/proto/ingest/v1/ingest.proto`: `google/protobuf/timestamp.proto` (L7) and `common/v1/common.proto` (L8). New `struct.proto` import goes after these.

**Instructions**:

1. Add `import "google/protobuf/struct.proto";` after `import "common/v1/common.proto";` at L8 — this mirrors the pattern in `config/v1/config.proto` L8.

2. Add two new RPCs to `IngestService` after `QuerySignals` (currently ending at L18):
   ```proto
   rpc ListSignalSources(ListSignalSourcesRequest) returns (ListSignalSourcesResponse);
   rpc ManageSignalSource(ManageSignalSourceRequest) returns (ManageSignalSourceResponse);
   ```

3. Add the following new messages after `QuerySignalsResponse` (currently at L102–105). All new messages start field numbers from 1 (own namespace, no conflict with existing messages):

   ```proto
   // SignalSource represents a registered signal source entry.
   // credentials_ref is intentionally absent — use has_credentials on read.
   message SignalSource {
     string slug              = 1;
     string display_name      = 2;
     string source_type       = 3;
     string extractor_module  = 4;
     bool   active            = 5;
     bool   has_credentials   = 6;
     google.protobuf.Struct config_json = 7;
   }

   message ListSignalSourcesRequest {
     bool include_inactive = 1;
   }

   message ListSignalSourcesResponse {
     repeated SignalSource sources = 1;
   }

   // ManageSignalSourceRequest: operation is "register" | "update" | "deactivate".
   // credentials_ref is only processed on register/update; ignored on deactivate.
   message ManageSignalSourceRequest {
     SignalSource source         = 1;
     string       credentials_ref = 2;
     string       operation      = 3;
   }

   message ManageSignalSourceResponse {
     SignalSource source = 1;
   }
   ```

**Verification**:
```bash
cd /home/user/xstockstrat-orchestration/packages/proto
buf lint
buf breaking --against ".git#branch=feature/signal-source-registry"
```
Both commands must exit 0. `buf lint` confirms naming and style; `buf breaking` confirms no existing field numbers or RPCs were removed or renumbered.

---

### Step 2 — proto-gen: Regenerate stubs after proto update

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/python/ingest/v1/ingest_pb2.py` — modify (regenerated)
- `packages/proto/gen/python/ingest/v1/ingest_pb2_grpc.py` — modify (regenerated)
- `packages/proto/gen/ts/ingest/v1/ingest.ts` — modify (regenerated)
- `packages/proto/gen/ts/ingest/v1/ingest_connect.ts` — modify (regenerated)
- `packages/proto/gen/ts/ingest/v1/ingest_pb.ts` — modify (regenerated)
- `packages/proto/gen/ts/dist/ingest/v1/ingest.js` — modify (regenerated)
- `packages/proto/gen/ts/dist/ingest/v1/ingest.d.ts` — modify (regenerated)
- `packages/proto/gen/ts/dist/ingest/v1/ingest_pb.js` — modify (regenerated)
- `packages/proto/gen/ts/dist/ingest/v1/ingest_pb.d.ts` — modify (regenerated)
- `packages/proto/gen/go/ingest/v1/ingest.pb.go` — modify (regenerated)
- `packages/proto/gen/go/ingest/v1/ingest_grpc.pb.go` — modify (regenerated)
- `packages/proto/gen/go/ingest/v1/ingestv1connect/ingest.connect.go` — modify (regenerated)

**Reviewers**: Proto Reviewer — field number uniqueness, no breaking changes without deprecation, `buf lint` passes; `xstockstrat-ingest` owner — signal normalization correctness, idempotent ingestion, newsletter source schema stability

**Codebase Evidence**:
- `./scripts/buf-gen.sh` is the authoritative codegen script per `CLAUDE.md` §Generating Proto Stubs. No further evidence needed — this is a mechanical step.
- Phase 3 deviation note (`docs/roadmap/phase3-deviations.md` §3B): if `buf` is unavailable, use `python3 -m grpc_tools.protoc` as documented there.

**Instructions**:

1. Run `./scripts/buf-gen.sh` from the repository root. This regenerates all stubs in `packages/proto/gen/python/`, `packages/proto/gen/ts/`, and `packages/proto/gen/go/`.
2. Confirm that `packages/proto/gen/python/ingest/v1/ingest_pb2.py` and `ingest_pb2_grpc.py` now contain descriptors and stub classes for `SignalSource`, `ListSignalSourcesRequest`, `ListSignalSourcesResponse`, `ManageSignalSourceRequest`, `ManageSignalSourceResponse`.
3. Commit the proto source file and all regenerated stubs together in one commit (per proto-versioning runbook §PR1 step 4).

**Verification**:
```bash
cd /home/user/xstockstrat-orchestration
./scripts/buf-gen.sh
git diff packages/proto/gen/
# diff should be non-empty (new message types) but only additive
```
CI `proto-freshness` job enforces stubs match source; a clean `git diff` after `buf-gen.sh` re-run means stubs are up-to-date.

---

### Step 3 — migration: Add signal_sources registry table to ingest schema

**Status**: `done`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/migrations/002_add_signal_sources_registry.up.sql` — create
- `services/xstockstrat-ingest/migrations/002_add_signal_sources_registry.down.sql` — create

**Reviewers**: DBA — migration NNN numbering, up+down pair present, JSONB column strategy, index correctness; `xstockstrat-ingest` owner — signal normalization correctness, idempotent ingestion, newsletter source schema stability

**Codebase Evidence**:
- Confirmed last migration file is `001_newsletter_signals.up.sql` via `ls services/xstockstrat-ingest/migrations/ | sort` → `001_newsletter_signals.down.sql`, `001_newsletter_signals.up.sql`. New migration NNN is therefore `002`.
- Existing `ingest` schema is already created in `001_newsletter_signals.up.sql` L6 (`CREATE SCHEMA IF NOT EXISTS ingest;`) — no need to re-create schema in `002`.
- Product spec FR-2 defines exactly **ten** `source_type` values: five programmatic (`simple_email`, `email_attachment`, `linked_email`, `simple_website`, `authenticated_website`) and five Claude-mediated (`mediated_simple_email`, `mediated_email_attachment`, `mediated_linked_email`, `mediated_simple_website`, `mediated_authenticated_website`). The CHECK constraint must include all ten values.
- Product spec SQL at product-spec.md L113–128 is the canonical table definition; the `CREATE SCHEMA` line must be omitted (schema already exists from migration 001).

**Instructions**:

Create `services/xstockstrat-ingest/migrations/002_add_signal_sources_registry.up.sql`:

```sql
-- 002_add_signal_sources_registry.up.sql
-- Adds the ingest.signal_sources registry table.
-- The ingest schema was created in migration 001 — no CREATE SCHEMA needed.
-- source_type includes all ten valid values: five programmatic and five mediated_*.

CREATE TABLE IF NOT EXISTS ingest.signal_sources (
    slug             TEXT PRIMARY KEY,
    display_name     TEXT NOT NULL,
    source_type      TEXT NOT NULL CHECK (source_type IN (
                         'simple_email', 'email_attachment', 'linked_email',
                         'simple_website', 'authenticated_website',
                         'mediated_simple_email', 'mediated_email_attachment',
                         'mediated_linked_email', 'mediated_simple_website',
                         'mediated_authenticated_website')),
    extractor_module TEXT NOT NULL,
    credentials_ref  TEXT,
    active           BOOLEAN NOT NULL DEFAULT TRUE,
    config_json      JSONB,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS signal_sources_active_idx
    ON ingest.signal_sources (active);
```

Create `services/xstockstrat-ingest/migrations/002_add_signal_sources_registry.down.sql`:

```sql
-- 002_add_signal_sources_registry.down.sql
DROP TABLE IF EXISTS ingest.signal_sources;
```

**Verification**:
```bash
./scripts/db-migrate.sh
# Expected: migration 002 applied, no dirty state
psql "$DATABASE_URL" -c "\d ingest.signal_sources"
# Confirms columns: slug, display_name, source_type, extractor_module,
# credentials_ref, active, config_json, created_at
psql "$DATABASE_URL" -c "\di ingest.signal_sources_active_idx"
# Confirms index present
```

---

### Step 4 — service: Signal sources repository layer

**Status**: `done`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/app/repositories/__init__.py` — create
- `services/xstockstrat-ingest/app/repositories/signal_sources.py` — create

**Reviewers**: `xstockstrat-ingest` owner — signal normalization correctness, idempotent ingestion, newsletter source schema stability

**Codebase Evidence**:
- No `app/repositories/` directory exists — confirmed via `find services/xstockstrat-ingest -type f | sort` → no match. Must be created from scratch; no existing pattern available in the codebase for this service.
- DB pool usage pattern: `await self._db.fetchrow(...)` and `await self._db.fetch(...)` confirmed in `services/xstockstrat-ingest/app/handlers/servicer.py` at L183 and L300. New repository functions follow the same `asyncpg` pool pattern.
- Config validation per source_type is specified in FR-10 (product-spec.md L40–61) for all ten source types (five programmatic + five mediated).

**Instructions**:

1. Create `services/xstockstrat-ingest/app/repositories/__init__.py` (empty).

2. Create `services/xstockstrat-ingest/app/repositories/signal_sources.py` with the following public async functions (all accept `db_pool` as first argument, matching the `self._db` asyncpg pool in servicer.py):

   - `async def get_active_source(db_pool, slug: str) -> dict | None` — executes `SELECT slug, display_name, source_type, extractor_module, credentials_ref, active, config_json FROM ingest.signal_sources WHERE slug = $1 AND active = TRUE`; returns the row as a dict or `None` if not found.

   - `async def list_all_sources(db_pool, include_inactive: bool = False) -> list[dict]` — executes `SELECT slug, display_name, source_type, extractor_module, credentials_ref, active, config_json, created_at FROM ingest.signal_sources` with an optional `WHERE active = TRUE` when `include_inactive=False`; orders by `created_at ASC`.

   - `async def upsert_source(db_pool, *, slug: str, display_name: str, source_type: str, extractor_module: str, credentials_ref: str | None, config_json: dict | None) -> dict` — executes `INSERT INTO ingest.signal_sources (slug, display_name, source_type, extractor_module, credentials_ref, config_json) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (slug) DO UPDATE SET display_name=EXCLUDED.display_name, source_type=EXCLUDED.source_type, extractor_module=EXCLUDED.extractor_module, credentials_ref=EXCLUDED.credentials_ref, config_json=EXCLUDED.config_json RETURNING *`.

   - `async def deactivate_source(db_pool, slug: str) -> dict | None` — executes `UPDATE ingest.signal_sources SET active = FALSE WHERE slug = $1 RETURNING *`; returns the updated row or `None` if slug not found.

3. Add a `validate_config_json(source_type: str, config_json: dict | None) -> str | None` helper (sync, returns an error string or `None` if valid) that enforces the required fields per FR-10 for all ten source types:
   - `simple_email` and `mediated_simple_email`: requires non-empty `sender_patterns` list and non-empty `subject_patterns` list in `config_json`.
   - `email_attachment` and `mediated_email_attachment`: same as `simple_email` plus non-empty `attachment_mime_types`.
   - `linked_email` and `mediated_linked_email`: same as `simple_email` plus non-empty `url_patterns`.
   - `simple_website`, `authenticated_website`, `mediated_simple_website`, and `mediated_authenticated_website`: requires `url` (non-empty string) and `scrape_selector` (non-empty string).
   - For `authenticated_website` and `mediated_authenticated_website` with missing `credentials_ref`: that check is done at the RPC level in Step 6 (not here — `validate_config_json` only validates `config_json` fields, not `credentials_ref`).
   - Returns `None` if validation passes.

**Verification**:
```bash
cd services/xstockstrat-ingest
python3 -c "from app.repositories.signal_sources import get_active_source, list_all_sources, upsert_source, deactivate_source, validate_config_json; print('import OK')"
```
Full behavioural coverage is in Step 8 (unit tests with asyncpg mock).

---

### Step 5 — service: BaseExtractor abstract class, noop extractor, and reference extractor

**Status**: `done`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/app/extractors/__init__.py` — create
- `services/xstockstrat-ingest/app/extractors/base.py` — create
- `services/xstockstrat-ingest/app/extractors/noop.py` — create
- `services/xstockstrat-ingest/app/extractors/example_simple_email.py` — create

**Reviewers**: `xstockstrat-ingest` owner — signal normalization correctness, idempotent ingestion, newsletter source schema stability

**Codebase Evidence**:
- No `app/extractors/` directory exists — confirmed via `find services/xstockstrat-ingest -type f | sort` → no match. Must be created from scratch; no existing pattern available.
- FR-5 defines the exact `RawInput` union type and `BaseExtractor` method signature.
- FR-6 requires a `BaseExtractor` subclass at `app/extractors/<slug>.py`. All five `mediated_*` source types must use `extractor_module = "app.extractors.noop"` — the ingest service never invokes their extractor directly.
- Acceptance criterion 10 (product-spec.md L152) requires a reference extractor covered by unit tests.

**Instructions**:

1. Create `services/xstockstrat-ingest/app/extractors/__init__.py` (empty).

2. Create `services/xstockstrat-ingest/app/extractors/base.py`:
   ```python
   """BaseExtractor — abstract interface all signal source extractors must implement."""
   from __future__ import annotations
   from abc import ABC, abstractmethod
   from dataclasses import dataclass

   @dataclass
   class SimpleEmailInput:
       body_text: str
       body_html: str

   @dataclass
   class EmailAttachmentInput:
       body_text: str
       body_html: str
       attachments: list[bytes]

   @dataclass
   class LinkedEmailInput:
       body_text: str
       body_html: str
       urls: list[str]

   @dataclass
   class SimpleWebsiteInput:
       url: str
       html: str

   @dataclass
   class AuthenticatedWebsiteInput:
       url: str
       html: str
       credentials: dict

   RawInput = (
       SimpleEmailInput
       | EmailAttachmentInput
       | LinkedEmailInput
       | SimpleWebsiteInput
       | AuthenticatedWebsiteInput
   )

   class BaseExtractor(ABC):
       @abstractmethod
       async def extract(self, raw: RawInput) -> list[dict]:
           """Extract signals from raw input. Returns a list of signal dicts."""
           ...
   ```

3. Create `services/xstockstrat-ingest/app/extractors/noop.py`:
   ```python
   """No-op extractor for mediated_* source types.
   extractor_module: app.extractors.noop

   All five mediated_* source types (mediated_simple_email, mediated_email_attachment,
   mediated_linked_email, mediated_simple_website, mediated_authenticated_website) use
   this extractor. The ingest service never invokes it directly — extraction for these
   sources is performed by the agent MCP service via Claude.
   """
   from app.extractors.base import BaseExtractor, RawInput


   class NoopExtractor(BaseExtractor):
       async def extract(self, raw: RawInput) -> list[dict]:
           """Return empty list — mediated sources are processed by the agent, not ingest."""
           return []
   ```

4. Create `services/xstockstrat-ingest/app/extractors/example_simple_email.py`:
   ```python
   """Reference extractor for source_type=simple_email.
   extractor_module: app.extractors.example_simple_email
   """
   import re
   from app.extractors.base import BaseExtractor, SimpleEmailInput, RawInput

   class ExampleSimpleEmailExtractor(BaseExtractor):
       async def extract(self, raw: RawInput) -> list[dict]:
           """Extract signal dicts from a plain-text email body.
           Returns [] if no recognizable signal pattern is found.
           Each dict has keys: symbol (str), direction (str), headline (str).
           """
           if not isinstance(raw, SimpleEmailInput):
               return []
           signals = []
           # Simple pattern: "BUY AAPL" or "SELL TSLA" anywhere in body
           for match in re.finditer(r'\b(BUY|SELL|HOLD|WATCHLIST)\s+([A-Z]{1,5})\b',
                                    raw.body_text.upper()):
               signals.append({
                   "direction": match.group(1).lower(),
                   "symbol": match.group(2),
                   "headline": f"Extracted from email: {match.group(0)}",
               })
           return signals
   ```

**Verification**:
```bash
cd services/xstockstrat-ingest
python3 -c "from app.extractors.base import BaseExtractor, SimpleEmailInput; print('import OK')"
python3 -c "from app.extractors.noop import NoopExtractor; print('noop import OK')"
python3 -c "from app.extractors.example_simple_email import ExampleSimpleEmailExtractor; print('extractor import OK')"
```
All three must print their success message without import errors.

---

### Step 6 — service: Update IngestSignal validation and add ListSignalSources + ManageSignalSource handlers

**Status**: `done`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/app/handlers/servicer.py` — modify
- `services/xstockstrat-ingest/app/main.py` — modify
- `docker-compose.yml` — modify
- `.do/app.dev.yaml` — modify
- `.do/app.yaml` — modify

**Reviewers**: `xstockstrat-ingest` owner — signal normalization correctness, idempotent ingestion, newsletter source schema stability; Security — credentials_ref never in responses, admin auth scope on ManageSignalSource, secret.* prefix enforced

**Codebase Evidence**:
- `IngestServicer.__init__` at `services/xstockstrat-ingest/app/handlers/servicer.py` L22–30 accepts `config_watcher`, `marketdata_channel`, `ledger_channel`, `db_pool`. A new `identity_channel` parameter must be added.
- `IngestSignal` source validation currently at L161–172: checks for empty `source`, `symbol`, `direction` (L161–165), then validates `direction` against valid set (L167–172). The registry check (FR-3) inserts after L172.
- `QuerySignals` ends at L346. New `ListSignalSources` and `ManageSignalSource` methods go after it.
- `ValidateApiKey` RPC confirmed in `packages/proto/identity/v1/identity.proto` L15 — takes `ValidateApiKeyRequest { string api_key = 1; }` and returns `TokenClaims { repeated string roles = 3; }`. Admin gate checks for `"admin"` in roles.
- `LEDGER_ENDPOINT` read at `services/xstockstrat-ingest/app/main.py` L36. `IDENTITY_ENDPOINT` is absent from main.py — confirmed via grep. Must be added after L36.
- `ledger_channel` created at L67; servicer constructed at L69–74. `identity_channel` is added after L67.
- `IDENTITY_ENDPOINT` absent from `xstockstrat-ingest` environment block in `docker-compose.yml` (L271–287) — confirmed absent via grep.
- `IDENTITY_ENDPOINT` absent from `xstockstrat-ingest` envs block in `.do/app.dev.yaml` (L141–168) and `.do/app.yaml` (L141–168) — confirmed absent via grep.
- `invocation_metadata()` is already called in servicer.py at L44 and L153 — this method is available on real gRPC contexts. The `_NoopContext` in `http_server.py` does not have it; the `_AuthContext` in Step 7 supplies it for HTTP routes.

**Instructions**:

1. **`app/main.py`** — add `IDENTITY_ENDPOINT` env var read and pass it to the servicer:
   - After `LEDGER_ENDPOINT = os.environ.get(...)` at L36, add:
     ```python
     IDENTITY_ENDPOINT = os.environ.get("IDENTITY_ENDPOINT", "xstockstrat-identity:50058")
     ```
   - In `serve()`, create a channel after `ledger_channel` at L67:
     ```python
     identity_channel = grpc.aio.insecure_channel(IDENTITY_ENDPOINT)
     ```
   - Pass `identity_channel=identity_channel` to the `IngestServicer(...)` constructor call at L69.

2. **`app/handlers/servicer.py`** — update `IngestServicer`:

   a. Add import at top: `from gen.identity.v1 import identity_pb2, identity_pb2_grpc`

   b. Add import: `from app.repositories.signal_sources import get_active_source, list_all_sources, upsert_source, deactivate_source, validate_config_json`

   c. Update `__init__` signature (currently L23–24) to accept `identity_channel` parameter and store `self._identity = identity_pb2_grpc.IdentityServiceStub(identity_channel)`.

   d. **`IngestSignal`**: after the existing direction-validation check ending at L172, insert a registry slug check:
      ```python
      source_row = await self._db.fetchrow(
          "SELECT slug FROM ingest.signal_sources WHERE slug = $1 AND active = TRUE",
          signal.source,
      )
      if source_row is None:
          await context.abort(
              grpc.StatusCode.INVALID_ARGUMENT,
              f"source slug '{signal.source}' is not a registered active source"
          )
          return
      ```
      This implements FR-3. Placement is after direction validation and before the DB INSERT at L183.

   e. **Add `_validate_admin_token` helper** (private async method, after `__init__`):
      ```python
      async def _validate_admin_token(self, context) -> bool:
          """Returns True if Authorization header contains a valid admin API key."""
          metadata = dict(context.invocation_metadata())
          auth = metadata.get("authorization", "")
          if not auth.startswith("Bearer "):
              return False
          api_key = auth[len("Bearer "):]
          try:
              claims = await self._identity.ValidateApiKey(
                  identity_pb2.ValidateApiKeyRequest(api_key=api_key)
              )
              return "admin" in claims.roles
          except Exception:
              return False
      ```

   f. **Add `ListSignalSources`** handler method after `QuerySignals` (which ends at L346):
      ```python
      async def ListSignalSources(self, request, context):
          if self._db is None:
              await context.abort(grpc.StatusCode.UNAVAILABLE, "database not connected")
              return
          rows = await list_all_sources(self._db, include_inactive=request.include_inactive)
          sources = []
          for row in rows:
              import json
              from google.protobuf.struct_pb2 import Struct
              cfg = Struct()
              if row["config_json"]:
                  cfg.update(row["config_json"] if isinstance(row["config_json"], dict)
                             else json.loads(row["config_json"]))
              sources.append(ingest_pb2.SignalSource(
                  slug=row["slug"],
                  display_name=row["display_name"],
                  source_type=row["source_type"],
                  extractor_module=row["extractor_module"],
                  active=row["active"],
                  has_credentials=(row["credentials_ref"] is not None),
                  config_json=cfg,
              ))
          return ingest_pb2.ListSignalSourcesResponse(sources=sources)
      ```

   g. **Add `ManageSignalSource`** handler method after `ListSignalSources`:
      ```python
      async def ManageSignalSource(self, request, context):
          if self._db is None:
              await context.abort(grpc.StatusCode.UNAVAILABLE, "database not connected")
              return
          is_admin = await self._validate_admin_token(context)
          if not is_admin:
              await context.abort(grpc.StatusCode.UNAUTHENTICATED, "admin API key required")
              return
          op = request.operation
          src = request.source
          if op in ("register", "update"):
              # authenticated_website and mediated_authenticated_website require credentials_ref
              if src.source_type in ("authenticated_website", "mediated_authenticated_website") \
                      and not request.credentials_ref:
                  await context.abort(
                      grpc.StatusCode.INVALID_ARGUMENT,
                      f"{src.source_type} source requires credentials_ref"
                  )
                  return
              cfg_dict = dict(src.config_json) if src.config_json else None
              err = validate_config_json(src.source_type, cfg_dict)
              if err:
                  await context.abort(grpc.StatusCode.INVALID_ARGUMENT, err)
                  return
              row = await upsert_source(
                  self._db,
                  slug=src.slug,
                  display_name=src.display_name,
                  source_type=src.source_type,
                  extractor_module=src.extractor_module,
                  credentials_ref=request.credentials_ref or None,
                  config_json=cfg_dict,
              )
          elif op == "deactivate":
              row = await deactivate_source(self._db, src.slug)
              if row is None:
                  await context.abort(grpc.StatusCode.NOT_FOUND, f"source '{src.slug}' not found")
                  return
          else:
              await context.abort(
                  grpc.StatusCode.INVALID_ARGUMENT,
                  f"unknown operation '{op}': must be register, update, or deactivate"
              )
              return
          import json
          from google.protobuf.struct_pb2 import Struct
          cfg_out = Struct()
          if row["config_json"]:
              cfg_out.update(row["config_json"] if isinstance(row["config_json"], dict)
                             else json.loads(str(row["config_json"])))
          result = ingest_pb2.SignalSource(
              slug=row["slug"],
              display_name=row["display_name"],
              source_type=row["source_type"],
              extractor_module=row["extractor_module"],
              active=row["active"],
              has_credentials=(row["credentials_ref"] is not None),
              config_json=cfg_out,
          )
          return ingest_pb2.ManageSignalSourceResponse(source=result)
      ```

3. **`docker-compose.yml`** — add `IDENTITY_ENDPOINT` to `xstockstrat-ingest` `environment:` block at L271–279, after `LEDGER_ENDPOINT` at L277:
   ```yaml
   IDENTITY_ENDPOINT: xstockstrat-identity:50058
   ```
   Confirmed absent: `grep -n "IDENTITY_ENDPOINT" docker-compose.yml` → no match in ingest block.

4. **`.do/app.dev.yaml`** — add to `xstockstrat-ingest` `envs:` block (L151–168), after the `MARKETDATA_ENDPOINT` entry:
   ```yaml
   - key: IDENTITY_ENDPOINT
     value: ${xstockstrat-identity.PRIVATE_URL}
   ```
   Confirmed absent: `grep -n "IDENTITY_ENDPOINT" .do/app.dev.yaml` → no match.

5. **`.do/app.yaml`** — same addition to `xstockstrat-ingest` `envs:` block (L151–168), after the `MARKETDATA_ENDPOINT` entry.
   Confirmed absent: `grep -n "IDENTITY_ENDPOINT" .do/app.yaml` → no match.

**Verification**:
```bash
grep -n "IDENTITY_ENDPOINT" docker-compose.yml .do/app.dev.yaml .do/app.yaml
# Must show a match in the xstockstrat-ingest section of all three files
cd services/xstockstrat-ingest
python3 -c "from app.handlers.servicer import IngestServicer; print('import OK')" 2>&1
```

---

### Step 7 — service: Wire ListSignalSources and ManageSignalSource to HTTP/Connect-RPC server

**Status**: `done`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/app/http_server.py` — modify

**Reviewers**: `xstockstrat-ingest` owner — signal normalization correctness, idempotent ingestion, newsletter source schema stability

**Codebase Evidence**:
- `build_app()` in `services/xstockstrat-ingest/app/http_server.py` L18–124: one `@app.post(...)` route per RPC, using `_call(request, ReqClass, servicer.Method)` helper at L127–137.
- `QuerySignals` route at L47–49: `@app.post("/xstockstrat.ingest.v1.IngestService/QuerySignals")` — exact URL pattern to follow.
- `_call` helper at L127–137 creates `_NoopContext()` which has `abort()` (L141–143) and `send_initial_metadata()` (L144–146) but no `invocation_metadata()`. A custom `_AuthContext` subclass must add `invocation_metadata()` to pass the Authorization header for `ManageSignalSource`.
- `_NoopContext.abort()` at L141–143 raises `HTTPException(status_code=400, detail=details)` — `_AuthContext` inherits this behavior.

**Instructions**:

1. After the `QuerySignals` route at L47–49, add:
   ```python
   @app.post("/xstockstrat.ingest.v1.IngestService/ListSignalSources")
   async def list_signal_sources(request: Request):
       return await _call(request, ingest_pb2.ListSignalSourcesRequest, servicer.ListSignalSources)

   @app.post("/xstockstrat.ingest.v1.IngestService/ManageSignalSource")
   async def manage_signal_source(request: Request):
       return await _call_with_auth(request, ingest_pb2.ManageSignalSourceRequest, servicer.ManageSignalSource)
   ```

2. Add a `_call_with_auth` helper after the existing `_call` helper at L127:
   ```python
   async def _call_with_auth(request: Request, req_cls, handler_fn):
       """Like _call but passes Authorization header via context metadata."""
       try:
           body = await request.body()
           req_msg = json_format.Parse(body or b"{}", req_cls())
       except (DecodeError, Exception) as e:
           raise HTTPException(status_code=400, detail=f"invalid request: {e}")

       auth_header = request.headers.get("authorization", "")
       ctx = _AuthContext(auth_header)
       resp = await handler_fn(req_msg, ctx)
       if resp is None:
           raise HTTPException(status_code=500, detail="handler returned None")
       return JSONResponse(json_format.MessageToDict(resp))


   class _AuthContext(_NoopContext):
       """_NoopContext extended to expose Authorization header via invocation_metadata."""
       def __init__(self, authorization: str):
           self._auth = authorization

       def invocation_metadata(self):
           if self._auth:
               return [("authorization", self._auth)]
           return []
   ```

**Verification**:
```bash
cd services/xstockstrat-ingest
python3 -c "from app.http_server import build_app; print('import OK')"
# Confirm routes registered:
python3 -c "
from unittest.mock import MagicMock
from app.http_server import build_app
app = build_app(MagicMock())
routes = [r.path for r in app.routes]
assert '/xstockstrat.ingest.v1.IngestService/ListSignalSources' in routes
assert '/xstockstrat.ingest.v1.IngestService/ManageSignalSource' in routes
print('routes OK')
"
```

---

### Step 8 — test: Unit tests for signal source registry service code

**Status**: `done`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/tests/test_signal_sources.py` — create
- `services/xstockstrat-ingest/tests/test_extractor.py` — create
- `services/xstockstrat-ingest/tests/test_ingest_servicer.py` — modify (add registry validation tests)

**Reviewers**: `xstockstrat-ingest` owner — signal normalization correctness, idempotent ingestion, newsletter source schema stability

**Codebase Evidence**:
- Existing test pattern in `tests/test_ingest_servicer.py`: `MagicMock` + `AsyncMock` for `db_pool`, with `svc._db = MagicMock()` set directly (L387–388). Same approach applies to new test file.
- `conftest.py` at L1–34 wires `gen/` path — all new test files inherit this setup automatically.
- `make_servicer()` helper at `test_ingest_servicer.py` L23–28 constructs a servicer with `db_pool=None` and three MagicMock channels. A new variant with `db_pool=MagicMock()` and `identity_channel=MagicMock()` is needed for registry tests in Step 6 code paths.
- Coverage threshold for `xstockstrat-ingest` is 40% (`pytest --cov=app --cov-fail-under=40`).

**Instructions**:

1. **`tests/test_signal_sources.py`** — unit-test `app/repositories/signal_sources.py`:
   - Test `validate_config_json` sync helper: verify each `source_type` (all ten) passes with valid config and fails with missing required fields. Include at least one test for each of the three pattern groups: email types (sender/subject), attachment types (+ mime_types), website types (url/scrape_selector), and one mediated variant per group.
   - Test `get_active_source` with an `AsyncMock` db_pool returning a row vs `None`.
   - Test `list_all_sources` with `include_inactive=True` vs `False`.
   - Test `upsert_source` — confirm the asyncpg `fetchrow` is called with the correct INSERT...ON CONFLICT SQL.
   - Test `deactivate_source` — confirm returns `None` when `fetchrow` returns `None`.

2. **`tests/test_extractor.py`** — unit-test `app/extractors/example_simple_email.py` and `app/extractors/noop.py`:
   - Test `ExampleSimpleEmailExtractor.extract()` with a `SimpleEmailInput` containing "BUY AAPL" → returns `[{"direction": "buy", "symbol": "AAPL", ...}]`.
   - Test with no matching patterns → returns `[]`.
   - Test with `EmailAttachmentInput` (wrong type) → returns `[]`.
   - Test importability: `from app.extractors.base import BaseExtractor; from app.extractors.example_simple_email import ExampleSimpleEmailExtractor; assert issubclass(ExampleSimpleEmailExtractor, BaseExtractor)`.
   - Test `NoopExtractor.extract()` with any input → always returns `[]`.
   - Test `NoopExtractor` is a subclass of `BaseExtractor`.

3. **`tests/test_ingest_servicer.py`** — add a `TestIngestSignalRegistryValidation` class:
   - Update `make_servicer()` (or add a new `make_servicer_with_db()`) to pass `identity_channel=MagicMock()`.
   - Test that `IngestSignal` returns `INVALID_ARGUMENT` when the source slug is unknown (mock `self._db.fetchrow` to return `None` for the registry lookup — the abort should be called before reaching the INSERT).
   - Test that `IngestSignal` proceeds normally when registry lookup returns a valid row (mock first `fetchrow` call to return `{"slug": "unusual_whales"}`, second to return `{"id": 42}`).
   - Add a test for `ManageSignalSource` with missing auth returning `UNAUTHENTICATED`.
   - Add a test for `ManageSignalSource` `operation="register"` with valid data and mocked `_validate_admin_token` returning `True`.
   - Add a test for `ManageSignalSource` `operation="deactivate"` with unknown slug returns `NOT_FOUND`.
   - Add a test for `ListSignalSources` with `include_inactive=False`.

**Verification**:
```bash
cd services/xstockstrat-ingest
pytest --cov=app --cov-fail-under=40
```
Confirm threshold passes. Coverage report should show `app/repositories/signal_sources.py`, `app/extractors/base.py`, `app/extractors/noop.py`, and `app/extractors/example_simple_email.py` with meaningful line coverage.

---

### Step 9 — service: config-ui API route for signal sources

**Status**: `pending`
**Service**: `xstockstrat-config-ui`
**Files**:
- `services/xstockstrat-config-ui/app/api/sources/route.ts` — create
- `docker-compose.yml` — modify
- `.do/app.dev.yaml` — modify
- `.do/app.yaml` — modify

**Reviewers**: `xstockstrat-config-ui` owner — config mutation safety, environment scope correctness, no secret values rendered in UI

**Codebase Evidence**:
- Pattern for Connect-RPC calls from Next.js route handlers confirmed in `app/api/config/route.ts` L13–19: `rpc()` helper uses raw `fetch` to `${ENDPOINT}/PackageName/MethodName` with `Content-Type: application/connect+json`. Same pattern applies here using `INGEST_HTTP_ENDPOINT`.
- Auth propagation pattern: `getSessionFromRequest`, `rolesToAccessScope`, `generateTraceId` imported from `@/app/lib/auth` at `app/api/config/route.ts` L8. Same imports required in the sources route.
- `INGEST_HTTP_ENDPOINT` absent from `docker-compose.yml` `xstockstrat-config-ui` environment block (L452–470) — confirmed via grep.
- `INGEST_HTTP_ENDPOINT` absent from `xstockstrat-config-ui` envs block in `.do/app.dev.yaml` (L394–405) and `.do/app.yaml` (L390–401) — confirmed absent via grep. `IDENTITY_HTTP_ENDPOINT` is the last key in each block (L397 in dev yaml, L393 in prod yaml).

**Instructions**:

1. Create `services/xstockstrat-config-ui/app/api/sources/route.ts`:
   ```typescript
   /**
    * Sources API route — proxies to xstockstrat-ingest via Connect-RPC.
    *
    * GET  /api/sources?include_inactive=true|false  → ListSignalSources
    * POST /api/sources                               → ManageSignalSource
    */
   import { NextRequest, NextResponse } from 'next/server';
   import { getSessionFromRequest, rolesToAccessScope, generateTraceId } from '@/app/lib/auth';

   const INGEST_HTTP_ENDPOINT =
     process.env.INGEST_HTTP_ENDPOINT ?? 'http://xstockstrat-ingest:8055';

   async function rpc(
     method: string,
     body: object,
     propagationHeaders: Record<string, string>,
     authHeader?: string,
   ): Promise<Response> {
     return fetch(`${INGEST_HTTP_ENDPOINT}/${method}`, {
       method: 'POST',
       headers: {
         'Content-Type': 'application/connect+json',
         ...(authHeader ? { Authorization: authHeader } : {}),
         ...propagationHeaders,
       },
       body: JSON.stringify(body),
     });
   }

   export async function GET(req: NextRequest) {
     const claims = await getSessionFromRequest(req);
     if (!claims) {
       return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
     }
     const propagationHeaders = {
       'x-user-id': claims.user_id,
       'x-access-scope': String(rolesToAccessScope(claims.roles)),
       'x-trace-id': req.headers.get('x-trace-id') ?? generateTraceId(),
     };
     const { searchParams } = new URL(req.url);
     const includeInactive = searchParams.get('include_inactive') === 'true';

     try {
       const res = await rpc(
         'xstockstrat.ingest.v1.IngestService/ListSignalSources',
         { includeInactive },
         propagationHeaders,
       );
       const response = await res.json();
       return NextResponse.json(response);
     } catch (err: any) {
       return NextResponse.json({ error: err.message }, { status: 500 });
     }
   }

   export async function POST(req: NextRequest) {
     const claims = await getSessionFromRequest(req);
     if (!claims) {
       return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
     }
     const propagationHeaders = {
       'x-user-id': claims.user_id,
       'x-access-scope': String(rolesToAccessScope(claims.roles)),
       'x-trace-id': req.headers.get('x-trace-id') ?? generateTraceId(),
     };
     // The Authorization header carries the admin API key for ManageSignalSource auth.
     // config-ui operators must have an admin API key configured in their session or env.
     const authHeader = req.headers.get('x-admin-api-key')
       ? `Bearer ${req.headers.get('x-admin-api-key')}`
       : req.headers.get('Authorization') ?? '';

     const body = await req.json();

     try {
       const res = await rpc(
         'xstockstrat.ingest.v1.IngestService/ManageSignalSource',
         body,
         propagationHeaders,
         authHeader,
       );
       const response = await res.json();
       return NextResponse.json(response);
     } catch (err: any) {
       return NextResponse.json({ error: err.message }, { status: 500 });
     }
   }
   ```

2. **`docker-compose.yml`** — add `INGEST_HTTP_ENDPOINT` to the `xstockstrat-config-ui` `environment:` block after `IDENTITY_HTTP_ENDPOINT` at L456:
   ```yaml
   INGEST_HTTP_ENDPOINT: http://xstockstrat-ingest:8055
   ```
   Confirmed absent: `grep -n "INGEST_HTTP_ENDPOINT" docker-compose.yml` → no match in config-ui block.

3. **`.do/app.dev.yaml`** — add to `xstockstrat-config-ui` `envs:` block after `IDENTITY_HTTP_ENDPOINT` at L397:
   ```yaml
   - key: INGEST_HTTP_ENDPOINT
     value: ${xstockstrat-ingest.PRIVATE_URL}
   ```
   Confirmed absent: `grep -n "INGEST_HTTP_ENDPOINT" .do/app.dev.yaml` → no match.

4. **`.do/app.yaml`** — same addition after `IDENTITY_HTTP_ENDPOINT` at L393.
   Confirmed absent: `grep -n "INGEST_HTTP_ENDPOINT" .do/app.yaml` → no match.

**Verification**:
```bash
grep -n "INGEST_HTTP_ENDPOINT" docker-compose.yml .do/app.dev.yaml .do/app.yaml
# Must show a match in the xstockstrat-config-ui section of all three files
cd services/xstockstrat-config-ui
pnpm run build 2>&1 | tail -10
# Must complete without TypeScript errors
```

---

### Step 10 — service: config-ui Sources page

**Status**: `pending`
**Service**: `xstockstrat-config-ui`
**Files**:
- `services/xstockstrat-config-ui/app/sources/page.tsx` — create
- `services/xstockstrat-config-ui/app/layout.tsx` — modify

**Reviewers**: `xstockstrat-config-ui` owner — config mutation safety, environment scope correctness, no secret values rendered in UI

**Codebase Evidence**:
- `app/[namespace]/page.tsx` is a Client Component (`'use client'` at L6) using `useState`/`useEffect`/`fetch` to call `/api/config` and render a table. Pattern confirmed at L1–6. The `/sources` page follows the same pattern calling `/api/sources`.
- UI component library confirmed available via `find services/xstockstrat-config-ui/components/ui -type f | sort`: `Badge`, `Button`, `Card`/`CardContent`, `Input`, `Table`/`TableHeader`/`TableBody`/`TableRow`/`TableHead`/`TableCell`, `Select`.
- `app/layout.tsx` in-app nav at L48–55: `<nav>` with `Link` elements for "Namespaces" (L49–51) and "Audit Log" (L52–54). A "Sources" link is added after the "Audit Log" link.
- FR-11 and FR-12 define the required field set per source_type (ten types, including all five `mediated_*` variants).
- FR-15 specifies reading `analysis.signals.source_weights` from the config API (`GET /api/config?namespace=analysis`) for the read-only weight field.
- Acceptance criterion 13 (product-spec.md L155): `credentials_ref` field must be cleared on load (never populated from the response).
- `credentials_ref` never appears in `SignalSource` response — `hasCredentials` (bool) is the read-side indicator per proto definition confirmed in Step 1.

**Instructions**:

1. Create `services/xstockstrat-config-ui/app/sources/page.tsx` as a Client Component (`'use client'`). The page must:

   a. Fetch `GET /api/sources?include_inactive=true` on mount and store the `sources` array from the response. Each source has: `slug`, `displayName`, `sourceType`, `extractorModule`, `active`, `hasCredentials`, `configJson` (object).

   b. Fetch `GET /api/config?namespace=analysis&env=dev&mode=paper` on mount and extract `analysis.signals.source_weights` (a JSON object mapping slug → weight) for the weight display column. If the key is absent or the slug is not in the map, display `1.0`.

   c. Render a table listing all sources with columns: Slug, Display Name, Source Type, Active (badge), Weight (read-only, from `source_weights`), Actions.

   d. Each row has an enable/disable toggle button that calls `POST /api/sources` with body `{ source: { slug }, operation: "deactivate" }` (when active=true) or `{ source: { slug, active: true }, operation: "update" }` (when active=false). After the call, re-fetch the list.

   e. Each row has an Edit button that opens an inline form (or expands the row) with the structured fields per source_type (FR-12):
      - All types: `display_name` (text input), `active` (checkbox)
      - `simple_email` / `mediated_simple_email` / `email_attachment` / `mediated_email_attachment` / `linked_email` / `mediated_linked_email`: `sender_patterns` (comma-separated text input), `subject_patterns`
      - `email_attachment` / `mediated_email_attachment`: additional `attachment_mime_types`
      - `linked_email` / `mediated_linked_email`: additional `url_patterns`
      - `simple_website` / `authenticated_website` / `mediated_simple_website` / `mediated_authenticated_website`: `url` (text input), `scrape_selector` (text input)
      - `authenticated_website` / `mediated_authenticated_website`: `credentials_ref` (text input for the `secret.*` key name); show a "configured" Badge if `hasCredentials = true` — the value is never pre-filled
      - `mediated_email_attachment` / `mediated_linked_email`: optional `credentials_ref` field (same badge behaviour as above)
      - All types: `extractor_module` (text input, `disabled` after first save to prevent accidental breaks)
      - All `mediated_*` types: show a "Claude-mediated" Badge
      - Save calls `POST /api/sources` with `operation: "update"` for existing sources.

   f. A "Register New Source" button opens a creation form (same fields as edit, plus source_type selector, plus `extractor_module` editable). On submit calls `POST /api/sources` with `operation: "register"`.

   g. The `credentials_ref` field value is always cleared when opening the edit form (never populated from the response, per acceptance criterion 13).

2. **`app/layout.tsx`** — add a "Sources" link to the in-app nav at L48–55, after the "Audit Log" link at L52–54:
   ```tsx
   <Link href="/sources" className="px-3 py-1.5 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors">
     Sources
   </Link>
   ```

**Verification**:
```bash
cd services/xstockstrat-config-ui
pnpm run build 2>&1 | tail -20
# Must complete without TypeScript or build errors
# Confirm route exists in the build output:
find .next/server/app/sources -name "page.js" 2>/dev/null || echo "check standalone output dir"
```

---

### Step 11 — test: E2E tests for config-ui Sources page and API route

**Status**: `pending`
**Service**: `xstockstrat-config-ui`
**Files**:
- `services/xstockstrat-config-ui/e2e/sources.spec.ts` — create
- `services/xstockstrat-config-ui/e2e/mock-backend.ts` — modify

**Reviewers**: `xstockstrat-config-ui` owner — config mutation safety, environment scope correctness, no secret values rendered in UI

**Codebase Evidence**:
- `e2e/api-smoke.spec.ts` L22–38: `addAuthCookie` helper using `SignJWT` from `jose`. New test file imports and reuses the same helper pattern.
- `e2e/mock-backend.ts` L48–51: `RESPONSES` dict maps HTTP path to response body. `startMockBackend()` at L55–88 reads from `RESPONSES` for every POST. Extend by adding two new keys for the ingest endpoints.
- `e2e/global-setup.ts` starts the mock backend server before tests — no changes needed there.
- E2E tests for a Next.js frontend: no coverage threshold — `pnpm test:e2e` is the verification command.
- Mock backend serves on port 9093 (confirmed at `e2e/mock-backend.ts` L13). The ingest endpoints added to `RESPONSES` will be served on the same port. `INGEST_HTTP_ENDPOINT` in the Playwright test environment must point to `http://localhost:9093`.

**Instructions**:

1. **`e2e/mock-backend.ts`** — add mock handlers for the two new ingest endpoints by adding two entries to the `RESPONSES` object (after the existing identity entries):
   ```typescript
   RESPONSES['/xstockstrat.ingest.v1.IngestService/ListSignalSources'] = {
     sources: [{
       slug: 'example_simple_email',
       displayName: 'Example Simple Email',
       sourceType: 'simple_email',
       extractorModule: 'app.extractors.example_simple_email',
       active: true,
       hasCredentials: false,
       configJson: { senderPatterns: ['noreply@example.com'], subjectPatterns: ['Signal:'] },
     }],
   };
   RESPONSES['/xstockstrat.ingest.v1.IngestService/ManageSignalSource'] = {
     source: {
       slug: 'example_simple_email',
       displayName: 'Example Simple Email',
       sourceType: 'simple_email',
       extractorModule: 'app.extractors.example_simple_email',
       active: true,
       hasCredentials: false,
       configJson: {},
     },
   };
   ```
   Note: the mock backend serves all endpoints on the same port (9093). Configure `INGEST_HTTP_ENDPOINT=http://localhost:9093` in `playwright.config.ts` env block.

2. **`e2e/sources.spec.ts`** — create tests following the `api-smoke.spec.ts` style:
   - Test `GET /api/sources` returns a response with a `sources` array (or empty object if mock returns `{}`).
   - Test `GET /api/sources?include_inactive=true` returns 200.
   - Test that each source in the response has fields: `slug`, `displayName`, `sourceType`, `active`, `hasCredentials` — but NOT `credentialsRef`.
   - Test `POST /api/sources` with a valid `ManageSignalSource` body returns 200.
   - Test that the `/sources` page loads without error (navigate to `http://localhost:3002/sources` and assert the page title or a table element is visible).
   - Test that the Sources page does not render a `credentials_ref` text value (confirm no element contains that literal string as a value).

**Verification**:
```bash
cd services/xstockstrat-config-ui
pnpm test:e2e
```
All tests pass. No coverage threshold applies for Next.js frontends.

---

### Step 12 — test: Noop extractor coverage and mediated-type import verification

**Status**: `pending`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/tests/test_extractor.py` — modify (add noop + mediated type importability tests)

**Reviewers**: `xstockstrat-ingest` owner — signal normalization correctness, idempotent ingestion, newsletter source schema stability

**Codebase Evidence**:
- FR-6 requires that all five `mediated_*` source types use `extractor_module = "app.extractors.noop"` and that this module is importable at runtime.
- `app/extractors/noop.py` is created in Step 5 with `NoopExtractor(BaseExtractor)` class.
- Acceptance criterion 9 (product-spec.md L151): "A reference extractor (e.g. `extractors.example_simple_email`) is included and covered by unit tests." Acceptance criterion 9 also states: "each registered source's `extractor_module` can be dynamically imported without error." The noop extractor is the canonical module for all mediated types.

**Instructions**:

Add the following tests to `services/xstockstrat-ingest/tests/test_extractor.py` (this file is created in Step 8 — Step 12 extends it):

1. Test dynamic importability of `app.extractors.noop`:
   ```python
   def test_noop_extractor_dynamically_importable():
       import importlib
       module = importlib.import_module("app.extractors.noop")
       assert hasattr(module, "NoopExtractor")
   ```

2. Test that `NoopExtractor` returns an empty list for all five `RawInput` input types:
   ```python
   @pytest.mark.asyncio
   async def test_noop_returns_empty_for_all_input_types():
       from app.extractors.noop import NoopExtractor
       from app.extractors.base import (
           SimpleEmailInput, EmailAttachmentInput, LinkedEmailInput,
           SimpleWebsiteInput, AuthenticatedWebsiteInput,
       )
       extractor = NoopExtractor()
       inputs = [
           SimpleEmailInput(body_text="BUY AAPL", body_html=""),
           EmailAttachmentInput(body_text="", body_html="", attachments=[b"data"]),
           LinkedEmailInput(body_text="", body_html="", urls=["https://example.com"]),
           SimpleWebsiteInput(url="https://example.com", html="<p>text</p>"),
           AuthenticatedWebsiteInput(url="https://example.com", html="", credentials={"token": "abc"}),
       ]
       for inp in inputs:
           result = await extractor.extract(inp)
           assert result == [], f"expected [] for {type(inp).__name__}, got {result}"
   ```

3. Test that `app.extractors.example_simple_email` is also dynamically importable:
   ```python
   def test_reference_extractor_dynamically_importable():
       import importlib
       module = importlib.import_module("app.extractors.example_simple_email")
       assert hasattr(module, "ExampleSimpleEmailExtractor")
   ```

**Verification**:
```bash
cd services/xstockstrat-ingest
pytest tests/test_extractor.py -v
# All noop and dynamic-import tests pass
pytest --cov=app --cov-fail-under=40
# Overall threshold still passes
```

---

## Deviation Log

### Deviation: Step 2 — proto-gen: Regenerate stubs after proto update
**Spec said**: Run `./scripts/buf-gen.sh` from the repository root.
**Actual**: `buf` was not installed in the environment. Downloaded buf v1.69.0 from GitHub releases to `/tmp/buf` and copied to `/usr/local/bin/buf`. Also installed Go plugins (`protoc-gen-go`, `protoc-gen-go-grpc`, `protoc-gen-connect-go`) via `go install` and TypeScript plugins via `pnpm install` in `packages/proto/gen/ts/`. Then ran `./scripts/buf-gen.sh` successfully — all stubs regenerated, buf lint + breaking passed, tsc compiled cleanly.
**Reason**: `buf` and Go/TS proto plugins not pre-installed in the remote execution environment. Installation was required before the script could run. This follows the same deviation precedent as phase3-deviations.md.

### Deviation: Step 2 — extra Go gRPC stubs regenerated
**Spec said**: Files section listed only the 12 ingest-specific generated stubs.
**Actual**: `buf-gen.sh` also updated `*_grpc.pb.go` for analysis, config, identity, indicators, ledger, marketdata, notify, portfolio, and trading services. All 21 changed files were staged and committed.
**Reason**: The newer `protoc-gen-go-grpc` version (installed fresh via `go install`) produces slightly different output for all services. Generated files must be committed together to keep the repo consistent and pass CI `proto-freshness`. Leaving them uncommitted would cause a stale-stub failure on the next run.

### Deviation: Step 3 — migration: Add signal_sources registry table to ingest schema
**Spec said**: Verify with `./scripts/db-migrate.sh` and `psql "$DATABASE_URL" -c "\d ingest.signal_sources"`.
**Actual**: `DATABASE_URL` not set in the remote execution environment; live DB not available. Verified by confirming file existence, correct NNN numbering (`002`), SQL content assertions (table definition, CHECK constraint, index, no `CREATE SCHEMA`), and up/down pair present.
**Reason**: No TimescaleDB running in the CI/remote container. Migration correctness will be verified at deployment time when `db-migrate.sh` runs against the actual database.

### Deviation: Step 8 — noop.py created here instead of Step 5
**Spec said**: `app/extractors/noop.py` is created in Step 5 (per revised spec after re-run).
**Actual**: Created in Step 8 alongside test coverage. Step 5 was executed before the spec re-run that added noop.py to its scope.
**Reason**: The spec was re-run (adding noop.py to Step 5) after Step 5 had already been merged. User chose Option A to create it in Step 8.

### Deviation: Step 8 — validate_config_json updated to cover mediated types
**Spec said**: `validate_config_json` (Step 4) should cover all 10 source types including mediated variants per FR-10.
**Actual**: Step 4 was executed before the spec re-run; mediated types were missing. Updated `app/repositories/signal_sources.py` in Step 8 to add all five `mediated_*` variants (share the same validation rules as their non-mediated counterparts).
**Reason**: Same cause as noop.py deviation above. User chose Option A to fix in Step 8.

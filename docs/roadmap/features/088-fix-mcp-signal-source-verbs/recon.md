# Recon: fix-mcp-signal-source-verbs

**Created**: 2026-08-02
**From**: product-spec.md
**Affected services**: xstockstrat-ingest (Python), xstockstrat-agent (Python); +xstockstrat-analysis (producer, minimal — see Risks)

---

## Objective

Split `manage_signal_source`'s register/update/deactivate from one blind full-replace upsert into
honest verbs: register → `ALREADY_EXISTS` on conflict; update → `NOT_FOUND` + AIP-161 field-mask merge
(no wipe, `credentials_ref` preserved); update decoupled from reactivation (a separate reactivate
verb); close the `mediated_authenticated_website` credential gap; add slug format validation. Mirrors
feature-070 `ManageStrategy`. Findings F-6.

## Codebase Map

- **`xstockstrat-ingest`** (Python) — CI ≥40
  - Servicer `ManageSignalSource` — `app/handlers/servicer.py:912-976`: string dispatch `op=request.operation`
    (`:919`), `register`/`update` share one branch (`:921`), `deactivate` (`:945`, NOT_FOUND if missing `:948`),
    else INVALID_ARGUMENT (`:951-954`). Admin gate `:916-918`. **credentials_ref check only for
    `authenticated_website`** (`:922-927`) — `mediated_authenticated_website` escapes it. config validated
    `:930-934`. register/update → `upsert_source(... active=src.active)` `:935-944`.
  - Repo `app/repositories/signal_sources.py`: `upsert_source` `:93-113` = `INSERT ... ON CONFLICT (slug)
    DO UPDATE SET <all cols> = EXCLUDED.*` (full replace, blanks omitted, forces active); `deactivate_source`
    `:116-121`; `validate_config_json` `:124-168` (no slug check).
  - Proto `packages/proto/ingest/v1/ingest.proto`: `ManageSignalSourceRequest` `:169-173`
    (`SignalSource source=1; string credentials_ref=2; string operation=3;` — **no update_mask, no op enum**);
    `ManageSignalSourceResponse` `:175-177`; `SignalSource` `:135-149` (slug=1…signals_fed=11; credentials_ref
    NOT on the message). Only enum is `SourceHealthStatus` `:152-157`.
  - Table `ingest.signal_sources` (PK `slug`) `migrations/002_add_signal_sources_registry.up.sql:5-16`;
    source_type CHECK extended by `007_signal_source_type_mediated`. **Highest migration: 008 → next 009**
    (only needed if a slug CHECK is added at DB level — likely servicer-side instead).
  - No slug format validation anywhere (only `IngestSignal` existence lookup `:674-682`).
  - Tests `tests/test_signal_sources.py`, `tests/test_source_health.py`; conftest `tests/conftest.py`.
- **`xstockstrat-agent`** (Python)
  - Client `manage_signal_source` — `app/client.py:490-533`: `active=source.get("active", True)` (`:507`),
    builds SignalSource + `ManageSignalSourceRequest(source, operation)` (`:515`), `_admin_metadata()`,
    strips credentials_ref from the response.
  - Tool `app/tools.py:579-618`: flat-arg builder (`:604-610`), forwards `operation` verbatim; docstring
    `:593-601` already documents the destructive-upsert quirk.
- **`xstockstrat-analysis`** (producer) — `app/engine/fundsignal_loop.py:337-362` `_ensure_source_registered`:
  `operation="register"`, `source_type="derived"`, guarded by `self._source_registered` flag, wrapped in
  `try/except → log.warning` (treats already-registered as non-fatal).

## Patterns to REUSE

- **AIP-161 partial merge + honest verbs** → mirror analysis `ManageStrategy`: `StrategyOperation` enum
  `analysis.proto:258-263`; `ManageStrategyRequest` (`operation=1, definition=2, FieldMask update_mask=3`)
  `:265-282`; servicer mask handling `servicer.py:1564-1608` (HasField, column-authoritative reject,
  unknown-path reject, NOT_FOUND on update-unknown); `_MASKABLE_PATHS` `:2334`, `_merge` `:2347-2361`.
- **update_mask derivation on the agent tool (None-sentinel)** → mirror the manage_formula/manage_strategy
  tool mechanic (None-defaults → derived mask), so an omitted field is preserved not wiped.

## Dependencies

- Proto/RPC: add `google.protobuf.FieldMask update_mask = 4` to `ManageSignalSourceRequest` (additive).
  Keep `operation` a string but formalize the accepted set to include `reactivate` (a new value). (An
  operation *enum* would be a larger, non-additive-friendly change; the string set + validation is the
  minimal honest fix and matches the current contract shape.)
- Migration: none required if slug validation is servicer-side (regex). (No DB CHANGE — behavior only.)
- Config keys: none.
- Inter-service edges: none new. The analysis producer already calls ingest `ManageSignalSource`.

## Risks / Not-found

- **Strict register breaks the producer's idempotent re-register (design fork).** With register →
  `ALREADY_EXISTS`, `fundsignal_loop._ensure_source_registered` gets ALREADY_EXISTS on every restart; its
  `try/except → log.warning` swallows it (non-fatal) but may not set `self._source_registered`, causing a
  per-cycle re-attempt + warning. Minimal fix: the producer treats ALREADY_EXISTS as "already registered"
  (sets the flag). Brings analysis into scope for a ~2-line change. Resolve in grilling.
- `## Not found`: no `SignalSourceOperation` enum; no `update_mask` on the ingest contract; no slug format
  validation anywhere; no `ALREADY_EXISTS`/`NOT_FOUND` split for signal sources today.
- Ledger 2026-08-02 (RC-2): the feature-070 partial-merge fix never propagated here — this is that
  propagation. Same-PR docs (mcp-tools.md manage_signal_source; agent docstring).

## Recommended Scope

1. proto: `ManageSignalSourceRequest.update_mask=4`; buf gen. 2. ingest: split servicer verbs
   (register strict/ALREADY_EXISTS, update NOT_FOUND+mask-merge, new reactivate, deactivate unchanged),
   repo `get/insert/update_masked/reactivate`, close mediated_authenticated_website gap, slug regex.
   3. ingest tests. 4. analysis producer ALREADY_EXISTS-tolerance. 5. agent client+tool (None-sentinel
   mask, reactivate, no forced active) + tests + catalog unchanged (same tool). 6. docs.

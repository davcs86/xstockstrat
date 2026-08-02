# Implementation Spec: fix-mcp-signal-source-verbs

**Status**: `pending`
**Created**: 2026-08-02
**Feature**: `docs/roadmap/features/088-fix-mcp-signal-source-verbs/feature.md`
**Total Steps**: 11
**Feature Branch**: `feature/fix-mcp-signal-source-verbs`

---

## Execution Summary

Proto-first (additive `update_mask` + `SignalSourceOperation` enum on `ManageSignalSourceRequest`),
codegen, then ingest servicer/repo verb split + tests, analysis producer ALREADY_EXISTS tolerance +
test, agent client/tool enum+mask + tests, config-ui sources page mask derivation + reactivate + e2e,
then same-PR docs. No migration (servicer-side behavior only), no new pool, no config keys.

## Step Dependencies

- Step 2 (proto-gen) requires Step 1. Steps 3/5/7/9 require Step 2's stubs.
- Each `test` step follows its `service` step (C-08).

---

### Step 1 — proto: update_mask + SignalSourceOperation enum

**Status**: `done`
**Service**: `packages/proto`
**Files**: `packages/proto/ingest/v1/ingest.proto` — modify

**Reviewers**: Proto Reviewer — field/enum uniqueness, no breaking change; `xstockstrat-ingest` owner

**Codebase Evidence**:
- `ManageSignalSourceRequest` fields 1-3, no mask/enum — `ingest.proto:169-173` (recon)
- Existing enum pattern `SourceHealthStatus` — `ingest.proto:152-157` (recon)

**TDD**: `N/A (proto)`

**Instructions**:
1. Add enum `SignalSourceOperation { SIGNAL_SOURCE_OPERATION_UNSPECIFIED=0; ..._REGISTER=1; ..._UPDATE=2;
   ..._REACTIVATE=3; ..._DEACTIVATE=4; }`.
2. On `ManageSignalSourceRequest`: `google.protobuf.FieldMask update_mask = 4;` and
   `SignalSourceOperation operation_enum = 5;`. Mark `string operation = 3` deprecated (comment: kept
   for back-compat; servicer prefers `operation_enum` when set). Add the field_mask import if absent.
3. Re-verify 4/5 next-free vs remote refs (ledger 081).

**Verification**: `cd packages/proto && buf lint && buf breaking --against '.git#ref=origin/main-dev,subdir=packages/proto'` — pass (additive).

---

### Step 2 — proto-gen: regenerate stubs

**Status**: `done`
**Service**: `packages/proto`
**Files**: `packages/proto/gen/**` — modify (generated)
**Reviewers**: _inherited from Step 1_
**TDD**: `N/A (proto-gen)`
**Instructions**: `./scripts/buf-gen.sh`; stage only `packages/proto/gen/`.
**Verification**: new enum/fields present in stubs; re-run leaves empty `git diff packages/proto/gen/`.

---

### Step 3 — service: ingest verb split (register/update/reactivate/deactivate)

**Status**: `done`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/app/handlers/servicer.py` — modify
- `services/xstockstrat-ingest/app/repositories/signal_sources.py` — modify

**Reviewers**: `xstockstrat-ingest` owner — signal-source registry correctness; DBA — query correctness

**Codebase Evidence**:
- `ManageSignalSource` string dispatch + shared register/update branch + auth gate + credential check
  (authenticated_website only) + `upsert_source(... active=src.active)` — `servicer.py:912-976` (recon)
- Repo `upsert_source` full-replace ON CONFLICT — `signal_sources.py:93-113`; `deactivate_source`
  `:116-121`; `validate_config_json` `:124-168` (recon)
- Mirror: analysis `ManageStrategy` mask handling `servicer.py:1564-1608`, `_MASKABLE_PATHS` `:2334` (recon)

**TDD**: `red-green required`

**Instructions**:
1. Resolve verb: `op = operation_enum if != UNSPECIFIED else map(request.operation string)`; unknown → INVALID_ARGUMENT.
2. Repo: add `get_source(slug)`; `insert_source(...)` (plain INSERT; `UniqueViolationError` → servicer maps
   ALREADY_EXISTS); `update_source(slug, **merged)`; `reactivate_source(slug)`. Retire `upsert_source`.
3. Servicer verbs:
   - register → `get_source` exists → `ALREADY_EXISTS`; validate; `insert_source` (active=True).
   - update → `get_source` missing → `NOT_FOUND`; merge only `update_mask` paths onto the stored row.
     `_SS_MASKABLE = {display_name, source_type, extractor_module, config_json, credentials_ref}`;
     `credentials_ref` virtual (masked → apply request value, ""=clear; absent → preserve stored).
     `_SS_COLUMN_AUTH = {slug, active}` → masked → INVALID_ARGUMENT. Unknown path → INVALID_ARGUMENT.
     `active` untouched. maskless → full replace (back-compat).
   - reactivate → `reactivate_source`; NOT_FOUND if missing.
   - deactivate → unchanged.
4. Credential-required check on the **merged** row's source_type, covering `authenticated_website`
   **and** `mediated_authenticated_website`; run on both masked and maskless branches. `validate_config_json`
   on the merged source_type/config_json.

**Verification**: covered by Step 4.

---

### Step 4 — test: ingest verbs

**Status**: `done`
**Service**: `xstockstrat-ingest`
**Files**: `services/xstockstrat-ingest/tests/test_signal_sources.py` — modify
**Reviewers**: `xstockstrat-ingest` owner — test adequacy
**Codebase Evidence**: existing tests + AsyncMock pool — `tests/test_signal_sources.py`, `tests/conftest.py` (recon)
**TDD**: `red-green required`

**Instructions** (RED before Step 3):
1. register on existing slug → `ALREADY_EXISTS`.
2. update on unknown slug → `NOT_FOUND`.
3. update with `update_mask=["display_name"]` preserves `credentials_ref`/source_type/config_json.
4. update masking `active` or `slug` → `INVALID_ARGUMENT`.
5. update masking `credentials_ref` with "" clears it; omitting it preserves the stored ref.
6. update to `mediated_authenticated_website` without a merged credential → `INVALID_ARGUMENT` (gap closed).
7. reactivate sets active=True; reactivate unknown → NOT_FOUND.
8. enum `operation_enum` preferred over string; string still maps (back-compat).

**Verification**: `cd services/xstockstrat-ingest && ruff check app tests && pytest --cov=app --cov-fail-under=40`.

---

### Step 5 — service: analysis producer ALREADY_EXISTS tolerance

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**: `services/xstockstrat-analysis/app/engine/fundsignal_loop.py` — modify
**Reviewers**: `xstockstrat-analysis` owner — producer robustness
**Codebase Evidence**: `_ensure_source_registered` register + `try/except → log.warning` — `fundsignal_loop.py:337-362` (recon)
**TDD**: `red-green required`

**Instructions**:
1. Send `operation_enum=REGISTER`.
2. Narrow the `except`: on `AioRpcError` with `code()==ALREADY_EXISTS` → treat as registered (set
   `self._source_registered=True`, no warning spam); re-raise/log other errors (no blanket swallow).

**Verification**: covered by Step 6.

---

### Step 6 — test: analysis producer tolerance

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**: `services/xstockstrat-analysis/tests/test_fundsignal_loop.py` — modify (or the producer's test home)
**Reviewers**: `xstockstrat-analysis` owner
**TDD**: `red-green required`
**Instructions**: ManageSignalSource raising `ALREADY_EXISTS` → producer sets `_source_registered`, does
not raise; a different code (e.g. UNAVAILABLE) is not swallowed.
**Verification**: `cd services/xstockstrat-analysis && ruff check app tests && pytest --cov=app --cov-fail-under=40`.

---

### Step 7 — service: agent client + tool

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**: `services/xstockstrat-agent/app/client.py` — modify; `services/xstockstrat-agent/app/tools.py` — modify
**Reviewers**: `xstockstrat-agent` owner — MCP contract stability, return shape
**Codebase Evidence**: client `manage_signal_source` (`active=True` forced) `client.py:490-533`; tool `tools.py:579-618` (recon)
**TDD**: `red-green required`

**Instructions**:
1. Client: map the string `operation` (register/update/reactivate/deactivate) → `operation_enum`; stop
   forcing `active=True`; on update set `update_mask` from a caller-supplied mask list; keep stripping
   credentials_ref from the response.
2. Tool: keep the string `operation` param (add `reactivate`); None-sentinel the update fields and derive
   `update_mask` (mirror manage_formula 086); `credentials_ref` joins the mask only when supplied.
   Update the docstring (honest verbs, ALREADY_EXISTS/NOT_FOUND, partial update, decoupled reactivate).

**Verification**: covered by Step 8.

---

### Step 8 — test: agent client/tool + descriptor-parity

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**: `services/xstockstrat-agent/tests/test_client.py`, `tests/test_tools.py`, `tests/test_signal_source_builder.py` (create)
**Reviewers**: `xstockstrat-agent` owner
**TDD**: `red-green required`
**Instructions**:
1. Descriptor-parity over the `ManageSignalSourceRequest` builder (mirror test_backtest_view): builder
   field set ∪ justified opt-outs == message fields.
2. Client maps operation→enum; no forced active; update sets the mask.
3. Tool: update derives mask (omitted field preserved); reactivate sends REACTIVATE; register/deactivate map.
**Verification**: `cd services/xstockstrat-agent && ruff check app tests && pytest`.

---

### Step 9 — service: config-ui sources page mask + reactivate (R2 scope fix)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**: `services/xstockstrat-ui/src/app/config-ui/sources/page.tsx` — modify
**Reviewers**: `xstockstrat-ui` owner — config mutation safety, no secret rendered
**Codebase Evidence**: `handleSave` maskless update `sources/page.tsx:205-225`; `handleToggle` `:195-206` (R2 adversary)
**TDD**: `red-green required` (Playwright)
**Instructions**:
1. `handleSave` update path: build `updateMask` = [display_name, source_type, extractor_module,
   config_json] always, plus `credentials_ref` only when `form.credentialsRef` is truthy. So an edit
   without a new secret preserves the stored `credentials_ref`.
2. `handleToggle` reactivation: send `operation:'reactivate'` (not update+active) so a disabled source is
   reactivated via the honest verb.

**Verification**: covered by Step 10.

---

### Step 10 — test: config-ui e2e

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**: `services/xstockstrat-ui/e2e/config-ui/signal-sources.spec.ts` (modify or create); fixtures + `INVENTORY.md` if a new domain object is needed
**Reviewers**: `xstockstrat-ui` owner
**TDD**: `red-green required`
**Instructions**: editing an `authenticated_website` source's display-name without a secret sends an
`update_mask` that excludes `credentials_ref` (assert the outbound request); the toggle sends `reactivate`.
**Verification**: `cd services/xstockstrat-ui && pnpm test:e2e -- config-ui/signal-sources.spec.ts`.

---

### Step 11 — docs: same-PR MCP surface sync

**Status**: `pending`
**Service**: `docs` + `xstockstrat-agent`
**Files**: `docs/runbooks/mcp-tools.md` — modify; `services/xstockstrat-agent/app/tools.py` docstring (in Step 7)
**Reviewers**: none (docs)
**Codebase Evidence**: `manage_signal_source` runbook section documents the destructive upsert (recon)
**TDD**: `N/A (docs)`
**Instructions**: update the `manage_signal_source` runbook rows — honest verbs, ALREADY_EXISTS/NOT_FOUND,
partial update, decoupled reactivate, closed credential gap. (Not in strat-lab, so no skill change.)
**Verification**: doc read; `/context-scrubber scan` if available.

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._

# Design: fix-mcp-signal-source-verbs

**Created**: 2026-08-02
**Rounds**: 2 (full; termination: approved after adversary fixes)
**Grounded in**: recon.md

---

## Chosen Approach

Split the blind upsert into honest AIP-161 verbs, mirroring feature-070 `ManageStrategy`, but
handling the two fields that live on the *request* (not the `SignalSource` resource) explicitly.

### 1. Proto (additive) — `packages/proto/ingest/v1/ingest.proto`
- `ManageSignalSourceRequest` (`:169-173`) gains:
  - `google.protobuf.FieldMask update_mask = 4;` (AIP-161, update only).
  - `SignalSourceOperation operation_enum = 5;` — a **new enum** (C-04): `_UNSPECIFIED=0`, `REGISTER=1`,
    `UPDATE=2`, `REACTIVATE=3`, `DEACTIVATE=4`. The string `operation = 3` is kept for back-compat and
    marked deprecated; the servicer prefers the enum when set (`!= UNSPECIFIED`), else maps the string.
    (Retyping field 3 would break `buf breaking` — C-09 — so a new field is the additive, C-04-honest fix.)
- No `SignalSource` message change (`credentials_ref` stays off the resource, on the request).

### 2. ingest servicer `ManageSignalSource` (`app/handlers/servicer.py:912-976`)
- Resolve the verb: `op = operation_enum if set else map(string)`; unknown → INVALID_ARGUMENT.
- **register** — strict: `get_source(slug)` exists → `ALREADY_EXISTS`; else validate + `insert_source`.
- **update** — `get_source(slug)` missing → `NOT_FOUND`; else **merge**: overlay only `update_mask` paths
  onto the stored row. `_MASKABLE_PATHS = {display_name, source_type, extractor_module, config_json,
  credentials_ref}`; `credentials_ref` is a **virtual mask path** (masked → apply `request.credentials_ref`,
  empty string = clear; absent → preserve the stored ref). `_COLUMN_AUTHORITATIVE_PATHS = {slug, active}` →
  masking either aborts `INVALID_ARGUMENT` (lifecycle is reactivate/deactivate only — decouples RC-6).
  Unknown mask path → INVALID_ARGUMENT. Validate the **merged** row: `validate_config_json(merged.source_type,
  merged.config_json)`, and the credential-required check on the **post-merge** source_type + post-merge
  credential state. `active` is never touched by update.
- **reactivate** — new verb: `reactivate_source(slug)` sets `active=TRUE`; NOT_FOUND if missing.
- **deactivate** — unchanged (NOT_FOUND if missing).
- **Credential gap closed**: the required check covers `authenticated_website` **and**
  `mediated_authenticated_website`.
- Maskless update (no `update_mask`) → **full replace** for back-compat (the UI/other clients that send a
  full payload), byte-for-byte with today — mirrors ManageStrategy's maskless path.

### 3. ingest repo (`app/repositories/signal_sources.py`)
- Add `get_source(slug)`; `insert_source(...)` (plain INSERT; on `UniqueViolationError` the servicer maps
  to ALREADY_EXISTS); `update_source(slug, **merged_columns)` (writes the merged row incl. explicit
  credentials_ref/NULL); `reactivate_source(slug)`. Keep `deactivate_source`. Retire `upsert_source`
  (all callers move to the split verbs) — or keep it unused? Retire it (no caller remains).

### 4. analysis producer (`app/engine/fundsignal_loop.py:337-362`)
- Strict register means `_ensure_source_registered` gets `ALREADY_EXISTS` on every restart. Change the
  `except` to inspect `AioRpcError.code() == StatusCode.ALREADY_EXISTS` → treat as already-registered
  (set `self._source_registered=True`), while still logging/failing other errors (do NOT blanket-swallow).
  Send the enum `REGISTER`. Paired analysis test (C-08).

### 5. agent client + tool (`app/client.py:490-533`, `app/tools.py:579-618`)
- The MCP tool keeps a **string** `operation` param (natural for the model): register/update/reactivate/
  deactivate. The client maps it to `operation_enum`. Stop forcing `active=True`. On update, derive
  `update_mask` from None-sentinel params (mirror manage_formula 086), so an omitted field is preserved.
  `credentials_ref` is a tool param; when supplied on update it joins the mask. Strip `credentials_ref`
  from responses (already done). Descriptor-parity test over the request builder (RC-1 antidote).

### 6. same-PR docs
- `docs/runbooks/mcp-tools.md` `manage_signal_source` section + the tool docstring: the honest verbs,
  ALREADY_EXISTS/NOT_FOUND, partial update, decoupled reactivate, the closed credential gap. `manage_signal_source`
  is **not** in the strat-lab skill (root CLAUDE.md lists only run_backtest/manage_strategy/trigger_backfill/
  set_strategy_live), so no skill change.

## Rejected Alternatives

- **Keep `operation` a string + waive C-04** — rejected: a Commandment waiver needs explicit user sign-off;
  the additive enum field pays the debt with no waiver and matches ManageStrategy.
- **`credentials_ref` presence-by-non-empty-string** — rejected: can set but never *clear*, re-introducing
  the omit-vs-clear ambiguity that is the current bug. The virtual mask path both sets and clears unambiguously.
- **`active` maskable-but-preserved-when-omitted** — rejected: a caller could still toggle active through
  `update` by listing it, re-coupling reactivation (RC-6). Column-authoritative rejection is the mirror's contract.
- **Idempotent internal `register_if_absent` path for the producer** — rejected: adds proto surface for one
  internal caller; strict-register-for-all + coded ALREADY_EXISTS tolerance is the single honest contract.
- **Slug format validation** — rejected/deferred: not in the acceptance criteria (scope-creep, How-to-Act #3);
  guessing a regex risks rejecting an already-registered operator slug (ledger 080 absence-claim trap).

## Open Risks

- [ ] Maskless update stays full-replace for non-agent callers; the agent tool always sends a mask on
  update (derived), so the MCP surface never wipes. Documented in the docstring. Target: agent step.
- [ ] Field/enum numbers (`update_mask=4`, `operation_enum=5`) verified next-free on `ManageSignalSourceRequest`;
  re-verify against remote refs at /sdd-spec (ledger 081). Target: proto step.

## Constitution Rules Touched

- `C-04` — new `SignalSourceOperation` enum with `_UNSPECIFIED=0` for the closed verb set (honored, not waived).
- `C-08`/`P-06` — every service step (ingest, analysis producer, agent) gets a paired RED-first test.
- `C-09` — additive proto (`buf lint`+`breaking`); `./scripts/buf-gen.sh`.
- `C-10` — descriptor-parity test on the agent request builder + same-PR docstring/mcp-tools.md.
- `F-01`/`F-06`/`F-07` — no migration, no new pool, no config values.

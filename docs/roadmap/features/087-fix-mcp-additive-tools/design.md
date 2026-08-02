# Design: fix-mcp-additive-tools

**Created**: 2026-08-02
**Rounds**: 1 (quick; termination: approved)
**Grounded in**: recon.md

---

## Chosen Approach

Agent-only, additive. Five thin surfaces, no proto/backend/migration change.

1. **`test_formula` tool** + `client.execute_formula(formula_source, input_data=None, input_params=None,
   parameters=None, timeout_ms_override=0)`. Calls `ExecuteFormula` with **inline `formula_source`**
   (never `formula_id`), read-only (`_metadata()`, no admin scope — it registers nothing). Projects the
   full `ExecuteFormulaResponse` via `MessageToDict(preserving_proto_field_name=True,
   always_print_fields_with_no_presence=True)` so `success`/`output`/`stdout`/`stderr`/`error`/
   `exit_reason`/`parameter_errors`/`execution_ms` all reach the caller (int64 `execution_ms`/
   `memory_used_bytes` stay JSON strings — the documented int64 contract).
2. **`cancel_backfill(job_id)` tool** + `client.cancel_backfill(job_id)`. Mirrors `trigger_backfill`:
   admin-scoped (`_admin_metadata()`), returns `{"job": MessageToDict(BackfillJob, snake_case,
   print-zero)}` (same envelope shape as `get_backfill_status`).
3. **`list_strategies` tool** wrapping the existing unused `client.list_strategy_definitions`; returns
   `{"strategies": [...]}`.
4. **`list_signal_sources` health passthrough**: extend the client's manual projection with
   `health` (enum name via `SourceHealthStatus.Name`), `last_seen_at` (RFC3339 or `None`),
   `last_error` (str), `signals_fed` (int). The tool passes these through (it already strips
   `has_credentials`/`credentials`).
5. **`emit_alert` extra fields**: add `context: dict|None` (→ `google.protobuf.Struct`),
   `tags: list[str]|None`, `correlation_id: str=""` to the client fn + tool.

**Descriptor-parity guard**: a test over the `list_signal_sources` client projection asserts its key
set ∪ `_INTENTIONALLY_DROPPED == SignalSource.DESCRIPTOR.fields_by_name`, with
`_INTENTIONALLY_DROPPED = {extractor_module, active}` — `extractor_module` is superseded by the
agent-derived `extractor_tool`, `active` is the `include_inactive` request filter, not a surfaced
per-row field. Each opt-out justified inline so the test isn't a rubber stamp.

Catalog 19→22 (test_formula, cancel_backfill, list_strategies). Same-PR `docs/runbooks/mcp-tools.md`
sections + tool-count bump.

## Rejected Alternatives

- **`test_formula` accepting a `formula_id`** — rejected: `get_formula`/`manage_formula` already cover
  saved formulas; the value here is the *inline unsaved-source* dry-run (F-10), so the tool takes source.
- **`cancel_backfill` read-only (no admin scope)** — rejected: `CancelBackfill` is admin-gated
  server-side (report F-11) and it mutates a paid job; it must carry the admin scope like `trigger_backfill`.
- **Parity test on the tool output instead of the client projection** — rejected: the tool intentionally
  strips `has_credentials`, so the invariant "no SignalSource field silently dropped" belongs on the
  client projection (the mapping layer), with the credential strip a separate, tested tool concern.

## Open Risks

- [ ] `SourceHealthStatus` enum name vs int in the projection — chose the **name** (stable, human-readable
  for the model). If a consumer needs the int, revisit. Target: client step.

## Constitution Rules Touched

- `C-01`/`F-04` — every claim cites recon `path:line`.
- `C-08`/`P-06` — each new client/tool surface gets a paired RED-first test; agent CI ≥40.
- `C-10` — descriptor-parity test on the projection + same-PR mcp-tools.md/tool-count sync across surfaces.
- `C-04` — no new enum; `health` projected as an existing enum's name.
- `F-06`/`F-07` — no new pool, no config values.

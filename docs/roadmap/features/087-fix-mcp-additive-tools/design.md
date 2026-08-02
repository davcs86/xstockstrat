# Design: fix-mcp-additive-tools

**Created**: 2026-08-02
**Rounds**: 1 (quick; termination: approved with adversary fixes folded in)
**Grounded in**: recon.md

---

## Chosen Approach

Agent-only, additive. Five thin surfaces, no proto/backend/migration change.

1. **`test_formula` tool** + `client.execute_formula(formula_source, input_data=None, input_params=None,
   parameters=None, timeout_ms_override=0)`. Calls `ExecuteFormula` with **inline `formula_source`**
   (never `formula_id`), read-only (`_metadata()`, no admin scope — it registers nothing). Projects the
   full `ExecuteFormulaResponse` via `MessageToDict(preserving_proto_field_name=True,
   always_print_fields_with_no_presence=True)`.
   **Non-finite guard (adversary, ledger 2026-07-21):** a dry-run of unvalidated source commonly emits
   `NaN`/`Inf` in `output` (div-by-zero, warm-up, `log`≤0). The sandbox path does NOT scrub these
   (`indicators/app/services/sandbox.py`), so `MessageToDict` on the response Struct raises
   `ValueError: Fail to serialize NaN`. Before projecting, scrub non-finite numbers in the `output`
   Struct to `None` (mirror the 067 evaluator antidote); additionally wrap the projection in
   `try/except ValueError` → a structured `{"success": false, "error": "<detail>"}` so the tool never
   500s on the exact input it exists to debug.
2. **`cancel_backfill(job_id)` tool** + `client.cancel_backfill(job_id)`. Mirrors `trigger_backfill`:
   admin-scoped (`_admin_metadata()`), returns `{"job": MessageToDict(BackfillJob, snake_case,
   print-zero)}` (same envelope shape as `get_backfill_status`).
3. **`list_strategies` tool** wrapping the existing unused `client.list_strategy_definitions`; returns
   `{"strategies": [...]}`. **Casing (adversary):** change `list_strategy_definitions` to
   `MessageToDict(d, preserving_proto_field_name=True)` so it emits **snake_case** matching
   `get_strategy`, avoiding a third inconsistent casing across the list→get→manage loop (report F-7).
4. **`list_signal_sources` health passthrough**: extend the client's manual projection with `active`
   (bool — **surfaced, not dropped:** the companion to the `include_inactive` filter, and a field the
   triage report lists as a silent drop), `health` (enum name via `SourceHealthStatus.Name`),
   `last_seen_at` (RFC3339 only when `HasField("last_seen_at")`, else `None` — a never-fed source must
   not report the epoch), `last_error` (str), `signals_fed` (int). The tool passes these through (it
   already strips `has_credentials`/`credentials`).
5. **`emit_alert` extra fields**: add `context: dict|None` (→ `google.protobuf.Struct`),
   `tags: list[str]|None`, `correlation_id: str=""` to the client fn + tool.

**Descriptor-parity guard**: a test over the `list_signal_sources` client projection asserts its key
set ∪ `_INTENTIONALLY_DROPPED == SignalSource.DESCRIPTOR.fields_by_name`, with
`_INTENTIONALLY_DROPPED = {extractor_module}` only — `extractor_module` is genuinely superseded by the
agent-derived `extractor_tool` (`_EXTRACTOR_TOOL_MAP`). `active` is now surfaced (adversary), so it is
NOT in the opt-out set. Justified inline so the test isn't a rubber stamp.

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
- [ ] `signals_fed` (int64) is a JSON **number** in this manual projection, diverging from the
  int64-as-JSON-string contract that `run_backtest`/`get_backfill_status` follow via `MessageToDict`.
  Acceptable under this tool's existing manual-projection pattern; documented in the docstring +
  `mcp-tools.md` so a model doesn't assume the string contract. Target: docs step.
- [ ] `test_formula` non-finite handling verified by a RED test (a formula returning `NaN`) that fails
  on an unguarded `MessageToDict` and passes after the scrub+wrap. Target: test step.

## Constitution Rules Touched

- `C-01`/`F-04` — every claim cites recon `path:line`.
- `C-08`/`P-06` — each new client/tool surface gets a paired RED-first test; agent CI ≥40.
- `C-10` — descriptor-parity test on the projection + same-PR mcp-tools.md/tool-count sync across surfaces.
- `C-04` — no new enum; `health` projected as an existing enum's name.
- `F-06`/`F-07` — no new pool, no config values.

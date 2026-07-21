# Design: fix-custom-formula-allnone

**Created**: 2026-07-21
**Rounds**: 1 (quick; termination: approved — debate revisions incorporated, no Floor breach)
**Approved by**: user @ 2026-07-21 (approval via "continue from where you left off" after the interactive gate was declined; recorded in context.md)
**Grounded in**: recon.md

---

## Chosen Approach

Decode-side fix in **xstockstrat-analysis** only; no proto/migration/config/env changes
(`recon.md` § Dependencies). Two behavioral parts, both scoped to the shared strategy evaluator and
proven on **both** of its consuming paths (backtest + live loop).

### 1. Fix the Struct decode in `_compute_component` (the root cause)

`services/xstockstrat-analysis/app/services/evaluator.py:185-191` currently does
`output = dict(resp.output)` then keeps a value only `if isinstance(raw, (list, tuple))`. A protobuf
`ListValue` (how `Struct.update()` marshals a native list on the indicators side —
`recon.md` § Root Cause 1, `xstockstrat-indicators/app/handlers/servicer.py:171-176`) fails that
check, so every series output is dropped and `value` falls back to `[None] * n`.

Replace the `dict()` + `isinstance` gate with a recursive unwrap via
`google.protobuf.json_format.MessageToDict(resp.output, preserving_proto_field_name=True)` — the same
stdlib helper already used for the inbound `input_data` on the indicators side
(`recon.md` § Patterns to REUSE; `xstockstrat-indicators/app/handlers/servicer.py:126`). `MessageToDict`
turns a `ListValue`→native `list`, so a per-bar series decodes to real numbers.

**Harden the decoded series (adversary objections C-01/P-03):** formula outputs are **not** guaranteed
to be length-`n` with JSON-`null` gaps. A numpy/pandas rolling formula returns a `NaN` warm-up head
(`json.dumps(float('nan'))` emits the `NaN` token → decodes to `float('nan')`, *not* `None`), and a
tail-stripped formula returns a **short** list. The decode must therefore:

- **Normalize `NaN`/`Inf`→`None`** so warm-up gaps read as `None` (matching the builtin series shape
  from `align_indicator_points`, `evaluator.py:195-209`), not as `float('nan')` that silently poisons
  `_eval_condition`.
- **Reconcile length against `n`**: reuse the existing `align_indicator_points`
  (`evaluator.py:195-209`) to place a short series at the correct trailing bars; on an
  unreconcilable/over-length mismatch, treat it as a formula failure (part 2) rather than silently
  indexing the wrong bar via `series[i]` (`servicer.py:788`). This is the guard against turning a
  visible 0-trades bug into a silent wrong-signal bug.
- **Preserve the scalar path** already exercised implicitly, without adding new semantics — see
  Rejected Alternatives re: scalar-broadcast.

### 2. Surface a genuine formula failure as per-symbol degradation (AC-3) — not a whole-run abort

`evaluator.py:180-182` swallows `resp.success == false` into an all-`None` series. Correct the
*visibility*, not by aborting: the servicer already degrades per-symbol and completes the run — the
`except _InsufficientData` branch at `servicer.py:352-370` logs and skips one symbol, and the broad
`except Exception` at `servicer.py:374` does `log.warning(... skipping); continue` (adversary factual
correction — the proposer's "abort" reading was wrong; a whole-run `abort(INTERNAL)` would be a
**regression** that destroys sibling-symbol evidence cells, feature 065 `servicer.py:331-348`, and
`INTERNAL` is the wrong status for a caller/config error).

So: on `resp.success == false`, raise a small local `FormulaExecutionError` (net-new local exception,
carrying `resp.error`) from `_compute_component`, and **handle it at every consuming path**:

- **Backtest** (`_backtest_symbol_evaluated`, `servicer.py:741`): catch per symbol, mirror the
  `_InsufficientData` branch — loud `log.warning` with `resp.error`, skip the symbol, surface it
  through the existing structured per-symbol channel (the same one used for insufficient-data/coverage
  gaps) so the failure is distinct from a legitimate 0-trade. The multi-symbol run still completes.
- **Live loop** (`evaluate()` → `live_loop.py:119` `_eval_pair`): catch there too and degrade-with-log
  (today an all-`None` series already yields steady-state / no alert; the explicit catch preserves that
  while making it visible). **This is the C-10 requirement** — the shared `_compute_component` is
  consumed by both paths, so both are updated and tested (the 056 ledger fail is "second path left
  behind").

### 3. Tests (paired, red-before-green — C-08 / P-06)

Regression home is `tests/test_strategy_evaluator.py` (reuse the `Struct`-mock pattern at `:360-362`,
which already builds a `ListValue` but never asserts the decoded series is non-`None` —
`recon.md` § Codebase Map). Cases:

- List-valued output decodes to a non-`None` numeric series equal to the input (the red test that fails
  today).
- `NaN`/warm-up head → leading `None`s (not `float('nan')`).
- Short list → tail-aligned to the correct bars.
- Empty `ListValue` and over-length/mismatch → treated as failure, not misaligned.
- `resp.success == false` → `FormulaExecutionError`; **backtest** path skips the symbol and the run
  completes with the other symbols intact.
- **Live-loop** path with a failing formula → degrades (no unhandled raise), asserted at the
  `_eval_pair`/live-loop seam.

Keep analysis coverage ≥40% (`services/xstockstrat-analysis/CLAUDE.md:253`).

## Rejected Alternatives

- **Whole-run `abort(INTERNAL)` on formula failure** — rejected: regresses the service's existing
  partial-success contract (destroys sibling-symbol evidence cells, feature 065), and `INTERNAL` is the
  wrong gRPC status for a caller/config error (would mask `resp.error` behind a generic 500).
- **Keep `dict(resp.output)` and just widen the `isinstance` to include `ListValue`** — rejected:
  brittle (leaks the proto type into business logic, still needs manual per-element unwrap and
  NaN/length handling); `MessageToDict` does the recursive conversion in one stdlib call already used
  elsewhere.
- **Assume outputs are always full-length-`n` with embedded `None` (no realignment)** — rejected: the
  sandbox `json.dumps`es arbitrary user output (`xstockstrat-indicators/app/services/sandbox.py:167-168`)
  with no length enforcement; a short/`NaN` series placed without `align_indicator_points` lands at the
  wrong bars → silently wrong entry/exit signals (worse than the visible bug being fixed).
- **Scalar-broadcast `{"value": 1}` → `[1.0] * n`** — deferred out of scope: an undeclared new semantic
  not required by the reported list-output bug. Spec-time check: confirm whether a "trivial constant
  formula" (product-spec) actually returns a scalar; only then, and only if required, add broadcast with
  its own requirement + test.

## Open Risks

- [ ] **Length-reconciliation policy** (tail-align vs. treat-as-failure for each mismatch shape) —
  finalize the exact rule and the `align_indicator_points` reuse at `/sdd-spec`; needs the precise
  `align_indicator_points` contract (`evaluator.py:195-209`). Target: service step.
- [ ] **No dedicated `NO_TRADE_REASON_*` for formula failure** — recon did not find one; the per-symbol
  surface reuses the existing insufficient-data/structured channel rather than a new enum value (avoids a
  proto change, C-04/F-04). Confirm the exact channel/field at `/sdd-spec`. Target: service step.
- [ ] **Live-loop degradation shape** — confirm `_eval_pair` (`live_loop.py:119`) has no existing
  try/except and decide log-and-continue vs. emit-a-health-signal. Target: service step + live-loop test.

## Constitution Rules Touched

- **C-08 / P-06** — honored by: the service step is paired with a red-before-green test step covering
  decode, NaN, length, and both consuming-path failure behaviors; coverage stays ≥40%.
- **C-10 (b/parity across shared paths)** — honored by: the failure-surfacing change to the shared
  `_compute_component` is applied *and tested* on **both** the backtest and live-loop consumers, not
  just backtest (directly addresses the 056 `fails.md` trap).
- **P-03 (no silent deviation)** — honored by: the decode raises/surfaces on unreconcilable output
  instead of silently misaligning; formula failures are logged with `resp.error` and surfaced, not
  swallowed.
- **C-04 / F-04 (no invented enum/symbol)** — honored by: no new proto enum value is invented; failure
  is surfaced through an existing structured channel. Any proto need is escalated at `/sdd-spec`, not
  guessed.
- **F-07 (no hardcoded config)** — honored by: no config values introduced; behavior is code-level
  graceful degradation consistent with existing `_InsufficientData` handling.

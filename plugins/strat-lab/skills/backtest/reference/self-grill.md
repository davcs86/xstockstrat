# Reference — Phase 4.5: self-grill (adversarial pass)

Before reporting, interrogate your own result as a skeptic would. Each item below is a way backtest
conclusions have actually been wrong. For every one, either point to evidence you already have or
**re-run the backtest to settle it** — a check you cannot answer is not a caveat to write, it is a
tool call to make. Report only what survives.

## The checklist

1. **Did a mutation silently break the strategy?** After *every* `manage_strategy` call, did you run
   a backtest and confirm non-zero trades with populated indicators? `manage_strategy update` is
   replace-semantics — a partial update wipes components and yields 0 trades /
   `NO_TRADE_REASON_ENTRY_NEVER_TRUE` / null indicators. If any result in your set is 0-trade, prove
   it is a real no-signal outcome and not a wiped definition.

2. **Is the stored config what you assume?** Fingerprint it: do the per-symbol trade counts match
   the config you think is live (e.g. the oracle's counts for that parameter value)? A mismatch
   means the definition is not what you think — stop and re-check before interpreting returns.

3. **Sequential vs independent — did you mix them?** Per-symbol returns quoted as an independent
   basket must come from **single-symbol** runs, not from one multi-symbol call (which compounds
   capital). If you aggregated a multi-symbol result as if independent, redo it.

4. **Is an oracle "mismatch" actually the window artifact — and only that?** If results differ from
   the oracle, confirm the divergence is confined to a warm-up-boundary trade and that indicator
   values still match to ~1e-9 on every bar where they are defined. If the difference is anywhere
   else, it is a real discrepancy, not the rolling window — investigate it.

5. **Is a reconstructed formula verified to the digit?** If you rebuilt any indicator, did you match
   the oracle's per-bar values exactly (right std ddof; `NaN`/`inf`→`None`; int-cast params)? An
   "approximately right" formula is a wrong result.

6. **Did you hide a bad status?** Scan every result for `status` ≠ `OK`, `INSUFFICIENT_DATA`,
   `FORMULA_ERROR`, empty `bars`, or a `no_trade_reason` you did not explain. A symbol that silently
   returned nothing must not be averaged in as a 0.

7. **Does the aggregate hide the scatter?** If you are reporting a basket number, does the per-symbol
   picture agree with it, or is one symbol (or a different best-parameter per symbol) driving it?
   Report the scatter; do not let the mean launder it.

8. **Are you overclaiming generalization?** Out-of-sample on new *symbols* is cross-sectional only —
   it is not out-of-sample in *time* (the window is fixed). Do not state temporal robustness you did
   not test.

9. **Did you leave staging changed?** If you mutated any strategy for a sweep, is it restored to its
   original definition, and is `live_enabled` back to its original value? Verify with a final
   backtest, not from memory.

## Outcome

Write the report only after this pass. State, in one line, that the result was grilled and what (if
anything) remains an explicit caveat. If a check forced a re-run that changed a number, the changed
number is the result — not the one you started with.

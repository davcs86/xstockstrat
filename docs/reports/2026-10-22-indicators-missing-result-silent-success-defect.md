# Defect: A formula that never assigns `result` still returns success with empty output

**Recorded**: 2026-10-22 (identified in feature 268 design; filed 2026-10-29)
**Severity**: SEV-2
**Impact type**: wrong-indicator-output
**Environment**: dev (main-dev) @ b7866493; still present on `feature/fix-indicators-formula-correctness` @ 5c237b4f after its D-10 fix
**Affected service(s)**: xstockstrat-indicators
**Config-only fix possible**: no
**Source**: feature 268 (`fix-indicators-formula-correctness`) `design.md` § Open Risks ("The 'never assigns result' gap stays a silent success"); recon.md "D-10 unassigned `result`". Out of scope for feature 268.

## Observed

A formula that runs to completion without assigning `result` returns `success=true, output={}`. The
child wrapper defaults a missing `result` to `{}` and always prints a parseable `__OUTPUT__:` marker,
so the parent finds a valid marker on a zero exit code and reports success. Feature 268's new
no-output checks ("formula produced no output", "formula output could not be parsed") never fire for
this case, because the marker is present and parses.

## Expected

Undecided; triage decides. The choice is whether a formula that never assigns `result` should fail
(as the feature 268 no-output cases now do) or keep succeeding with `{}` as documented behavior.

## Reproduction

1. `ExecuteFormula` with inline `formula_source` `x = 1` (no `result` assignment), empty `input_data`.
2. Observe `success=true`, `output={}`, `exit_reason` success, no error.

## Evidence

`services/xstockstrat-indicators/app/services/sandbox.py:311`
> _output = _formula_globals.get('result', {{}})

`services/xstockstrat-indicators/app/services/sandbox.py:312` (feature branch; main-dev has the same line without the leading `\\n`)
> print("\\n__OUTPUT__:" + json.dumps(_output if isinstance(_output, dict) else {{"value": _output}}))

## Root cause hypothesis

The wrapper's `.get('result', {{}})` default turns "no result assigned" into a valid empty output, so
the parent cannot tell it apart from a formula that deliberately returned `{}`.

## Confidence

high

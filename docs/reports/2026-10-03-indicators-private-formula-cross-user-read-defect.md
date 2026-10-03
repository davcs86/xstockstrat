# Defect: Any user can read and execute another user's private formula

**Recorded**: 2026-10-03
**Severity**: SEV-2
**Impact type**: authorization-bypass
**Environment**: production (main)
**Affected service(s)**: xstockstrat-indicators, xstockstrat-agent, xstockstrat-ui
**Config-only fix possible**: no

## Observed

In the indicators servicer, `GetFormula` and `ExecuteFormula` load a formula by id and return or run
it. Neither checks `author` against the caller's `x-user-id`, and neither checks `is_public`.
`ListFormulas` honours a caller-supplied `author_filter`, so a caller can enumerate another user's
formulas, including private ones. Only `UpdateFormula` and `DeleteFormula` compare
`row["author"] != caller_user_id`.

Both edges forward these calls unmodified:

- The MCP agent's `list_formulas(author_filter=…)` and `get_formula(formula_id)` tools.
- The insights BFF's `getFormula`, `listFormulas` and `executeFormula`, which are plain `forward(...)`.
  Only `registerFormula` overrides `author` with the session user.

Any signed-in user can therefore read the source of, and execute, another user's private formula.

Execution of soft-deleted formulas is out of scope here. It is by design (`formulas_repository.py:206`;
feature 086).

## Expected

Reads and executions of a non-public formula are allowed only for its author, for `SYSTEM_AUTHOR`
formulas, or for an internal service caller such as analysis running a strategy's formula. A list
with `author_filter` set to another user returns only that user's public formulas.

## Reproduction

1. User A registers a private formula (`is_public=false`).
2. User B calls MCP `list_formulas(author_filter="<A's user id>")`, then `get_formula(<id>)`.
3. B receives A's formula source. `ExecuteFormula` with that id also succeeds.

## Evidence

`services/xstockstrat-indicators/app/handlers/servicer.py:113-127` (ExecuteFormula)
> row = await self._repo.get_by_id(request.formula_id)
> ...
> source = formula.source

`services/xstockstrat-indicators/app/handlers/servicer.py:327-339` (GetFormula)
> row = await self._repo.get_by_id(...)
> ...
> return formula

`services/xstockstrat-indicators/app/handlers/servicer.py:341-353` (ListFormulas)
> author_filter=request.author_filter

`services/xstockstrat-ui/src/lib/insightsBff.ts:160-166`
> getFormula: forward(...)
> listFormulas: forward(...)
> executeFormula: forward(...)

## Root cause hypothesis

The ownership checks were added on the write paths only. Fix: an owner-or-public-or-system predicate
in the read and execute paths, keyed on `x-user-id`. Internal callers must keep their access, for
example by trusting `x-internal-caller` from analysis under mTLS.

## Confidence

high

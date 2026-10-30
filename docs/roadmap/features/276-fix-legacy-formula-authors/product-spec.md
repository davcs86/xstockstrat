# Product Spec: fix-legacy-formula-authors

**Type**: bug
**GitHub Issue**: none (Issues disabled). Defect report: `docs/reports/2026-10-22-indicators-legacy-username-formula-authors-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-22

---

## Problem Statement

**Observed.** On staging, six custom formulas created on 2026-07-20 store `author = "davcs86"` (a legacy username) instead of the owner's user id `80880990-2b79-4d85-8761-d8d9102c2efb`: `67139be6-27ff-4e03-b57f-a5398e7ea9a6` (Momentum Quality (Clenow)), `31bb8ea6-0f3e-4cf7-8844-ec8294cebf85` (Bollinger Squeeze Percentile), `7f595658-2a7f-4ddb-a83a-5fc3d625472d` (Volatility Trailing Stop Direction), `60c5b411-a7b7-4b5c-beb5-fdcb12ec83d1` (Kaufman Efficiency Ratio), `127e7b0d-ab8e-461a-af7b-da3bb9739204` (Mean-Reversion Z-Score) and `4a82bce9-db58-4efb-b2ae-37a90889e255` (probe_test_formula). `list_formulas` for the owner omits them; they appear only with the admin selector `author_filter="davcs86"`. Indicators' read guard (`_can_read_formula`, a bool check) fails for the owner, so `GetFormula` and `ExecuteFormula` answer NOT_FOUND to a non-admin owner (an admin caller of `ExecuteFormula` gets PERMISSION_DENIED), and strategies that use them (for example `squeeze_breakout_trend`, which uses `31bb8ea6…` and `7f595658…`) fail formula evaluation.

**Expected.** Every formula's `author` is the owning user id. The owner can list, read and execute their formulas, and strategies that reference them evaluate normally.

## Reproduction Steps

1. On staging, as the owner, call `list_formulas()`: the six formulas above are absent.
2. As admin, call `list_formulas(author_filter="davcs86")`: all six are returned with `author: "davcs86"`.
3. `run_backtest` on a strategy referencing `31bb8ea6…` evaluates no symbols (since feature 275 lands, it reports a non-OK status with a warning).

## Root Cause Hypothesis

Rows created before formula ownership moved from username to user id were never backfilled. The production row count is **unknown**: production has not been checked, and the six staging ids are a floor, not a bound (OQ-2).

## Functional Requirements

- **FR-1.** Every formula whose `author` is a legacy username that maps to exactly one known user has its `author` rewritten to that user's id. Testable condition: for the owner, `GetFormula` and `ExecuteFormula` succeed (no NOT_FOUND) and `ListFormulas` includes the formula.
- **FR-2.** Detection is not limited to the six staging ids: the fix finds every formula row whose `author` is neither a user id nor the reserved system author, in every environment it runs against, including soft-deleted rows.
- **FR-3.** A legacy author that maps to no user, or to more than one, is left unchanged and reported (formula id and author value) rather than guessed or deleted. The fix never assigns a formula to a user it cannot identify.
- **FR-4.** The fix is idempotent: a re-run changes nothing and reports zero legacy authors remaining. Formulas already owned by a user id or the system author are never modified.
- **FR-5.** The fix reports, per run, the count rewritten, the count left unmappable and the count already clean, so production can be verified before and after the change. The operator can see the production count without mutating data (dry-run or read-only report).
- **FR-6.** The read-guard semantics (`_can_read_formula`: owner or system author only) are unchanged; ownership is corrected, access is not loosened.
- **FR-7.** C-10(c): the rewrite mutates shared rows, so the design must state who may run it and how it is protected from a concurrent formula write (an owner registering or updating a formula during the rewrite must not be lost or overwritten). Rows with the reserved system author are never touched.

## Affected Services

xstockstrat-indicators (formula store and read guard). The username-to-user-id mapping source is not in indicators (no identity dependency today); see OQ-1.

## Consumer Surface(s)

The owner-visible consequence is that formulas reappear for their owner, so C-14 applies:

- **Agent tools:** `list_formulas` (owner's list now includes the repaired formulas; the admin `author_filter` no longer needs the legacy username), `get_formula`, `test_formula`, and `run_backtest` / `manage_strategy` for strategies that reference those formulas (they evaluate instead of failing formula evaluation). The `strat-lab` plugin's `backtest` skill is unaffected unless a quirk it documents changes (check at spec time; carried as a deferred check into `/sdd-spec`).
- **UI:** the `/insights` and `/trader` formula pickers read the same RPC; no UI code change is expected (confirm at spec time).

## Fix Scope

- No proto changes anticipated. If design picks an admin RPC, that is an additive proto change and the additive-change gate (`buf lint` + `buf breaking`, `./scripts/buf-gen.sh`) applies.
- No config key changes anticipated.
- Database: the fix is a data rewrite of `indicators.formulas.author`. Whether it ships as a migration (indicators tip is `007`; next free is `008` and must be re-derived at spec time), a one-off script or an admin RPC is a design decision. If a migration, it needs `NNN_description.up.sql` plus `.down.sql` and the DBA gate; the down migration needs a defined meaning for a data rewrite (for example a documented no-op), decided in design. A migration cannot call identity, so the mapping source (OQ-1) constrains this choice. C-10(c): the rewrite mutates shared rows, so the design names who may run it and how it is protected from concurrent formula writes.
- Overlap: `servicer.py` is also touched by features 268 and 275 (rebase-only risk); this feature must not edit the read guard (FR-6).

## Open Questions

- **OQ-1.** What is the username-to-user-id mapping source (identity `ListUsers`/`GetUser`, a table copy, or an operator-supplied map), and which service owns the lookup? Design decides; it gates FR-1 and FR-3, so design must resolve it (C-11) before spec.
- **OQ-2.** Do production rows carry legacy authors, and which usernames? Unknown; the design must not assume the staging set. Checking is read-only and part of verification, not speccing.
- **OQ-3.** What is the disposition of unmappable authors (FR-3) beyond report-and-leave: operator-supplied mapping, or a follow-up? Design decides.
- **OQ-4.** Is a guard needed so new rows can never be written with a non-user-id author? Out of scope unless design finds a live write path still doing so.

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on dev.

## Out of Scope

- Changing read-guard semantics or the admin `author_filter` behavior
- Running any production or staging data change during speccing
- The silent skip and false OK status in backtests (feature 275, which owns the reporting; this feature removes the cause)

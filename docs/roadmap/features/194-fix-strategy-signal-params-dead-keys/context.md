# Context Log: fix-strategy-signal-params-dead-keys

## 2026-09-19 — triage + fix (single session)

**Triage.** Defect 1 of `docs/reports/2026-09-18-deprecated-fields-in-rpc-contracts-defect.md`.
SEV-3 contract-hygiene, Track C. Verified `signal_params` is a `google.protobuf.Struct`
(`analysis.proto:325`) and the four blend keys have no reader (report's inventory re-checked).

**Design fork — discovered constraint flips the recommendation.** The report's Q1 offered strip on
write / read / both / backfill. During implementation I found `_definition_fingerprint` hashes the
**stored** `definition_json` (only display_name/active/live_enabled excluded), and the masked-UPDATE
path persists JSON built via `_row_to_strategy_definition` (`servicer.py` `_apply`). Therefore:
- A backfill or an unconditional write-side strip would re-key every affected row's `definition_json`
  → change its fingerprint → drop its accumulated evidence grade (ANALYSIS-3). Real cost for a SEV-3
  cosmetic issue.
- **Read-side strip** cleans every observable edge (get_strategy/ListStrategyDefinitions/config-ui/
  agent) with ZERO fingerprint churn (fingerprint never derives from the served proto).

So the recommendation shifted from the report's "strip on write + backfill" to **read-side default
strip + churn-free request strip on write**. This is a HOW change within the approved WHAT (fix
R1-D1); the observable outcome (clean payloads) matches intent and the alternative is strictly worse
(grade churn). Recorded here per the "surface tradeoffs / no silent guess" rule.

**Implementation.**
- `_DEAD_SIGNAL_PARAM_KEYS` + `_strip_dead_signal_params(definition)` (in-place, keeps
  symbols/target/stop).
- `_row_to_strategy_definition(row, *, strip_dead_signal_params=True)` strips by default. The ONE
  persist-building call (masked-UPDATE merge, `_apply`) passes `False` so a rename of an existing
  dirty row does not re-key its JSON / churn its fingerprint.
- `ManageStrategy` strips the request definition once (after `_normalize_source_symbols`) so REGISTER
  and signal_params-touching UPDATEs are born clean.

**Consumers preserved.** Only the 4 blend keys are stripped; `strategy_symbols` (symbols), the
readiness target/stop reader, and resolve_universe (`denied_symbols`/`signal_eligible`) are untouched.

**Tests.** read strips blend keys / keeps load-bearing; opt-out preserves for persist;
rename-of-dirty-row fingerprint unchanged (the safety property); GetStrategy end-to-end response
clean. All green; full analysis suite 773 passed; ruff clean.

**Files:** `services/xstockstrat-analysis/app/handlers/servicer.py`,
`tests/test_analysis_servicer.py`.

## Session 2026-09-24 (CI: feature status automation)

- Promotion PR #1169 merged to main
- Feature promoted and committed: dd622bdc2e5b922df8dcabc6f7475b8b395a8ed3
- Status updated: `code-completed` → `launched`
- Launched date: 2026-09-24

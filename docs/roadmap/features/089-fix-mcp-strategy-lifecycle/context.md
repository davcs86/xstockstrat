# Context: fix-mcp-strategy-lifecycle  (archived 2026-08-06)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-06 — /sdd-archiver

**What**: Strategy lifecycle went from dishonest to honest: duplicate `register` now returns `ALREADY_EXISTS` instead of a raw `INTERNAL` crash, a `REACTIVATE` op was added so deactivation is no longer permanent, and `set_strategy_live` now gates *enable* on `active=TRUE` + non-empty `signal_params.symbols` (returning `FAILED_PRECONDITION`), while *disable* stays unconditionally allowed. The live-loop consumer predicate itself was deliberately left untouched — the fix is entirely on the input side (design.md:1-11,44-46).
**Why (irrecoverable rationale)**: `FAILED_PRECONDITION` was picked over a `SetStrategyLiveResponse.warnings` proto field specifically because the acceptance criteria demanded a *hard* rejection of inert-enable, and `FAILED_PRECONDITION` needed zero proto change (design.md:68-69). `REACTIVATE` was made an explicit verb (not a register-upsert) to mirror feature 088's `ManageSignalSource` pattern and keep `register` strict (design.md:11,66-67).
**Rejected alternatives**:
- Register upsert-on-inactive — lost: overloads register, keeps it non-strict (design.md:66-67).
- `SetStrategyLiveResponse.warnings` — lost: AC required hard rejection, not a soft warning (design.md:68-69).
- `get_by_id` pre-check alone on register (no violation catch) — lost: TOCTOU-vulnerable; shipped uses both pre-check + `UniqueViolationError` catch (design.md:70-71).
- Bare `active=TRUE` flip for reactivate (no re-validation) — lost: would pass preconditions but error every live cycle if the definition references a deleted formula, violating AC-4 (design.md:74-76).
- Auto-clear `live_enabled` on deactivate — out of scope; enable-time precondition already makes the inert case unreachable going forward (design.md:77-78).
**Scars & gotchas**: None recorded — context.md has no execute-phase `## Session` entry; it jumps straight from design-approved (2026-08-02) to CI promotion (context.md:25-39). Implementation-spec's Deviation Log is empty (implementation-spec.md:108-110): all 7 steps landed exactly as designed, no red-flags surfaced in review.
**Permanent deviations**: recon.md originally recommended **replicating** the live-loop's `_symbols_for` logic inside `SetStrategyLive` (recon.md:36) -> the design-debate adversary round overrode this to **extract a shared module-level `strategy_symbols()` helper** instead -> because two copies of the firing-predicate contract would drift under C-10 (design.md:21-25). This is real: recon and design disagree, and only the debate log explains why the shared-helper approach won.
**Cross-feature signal**: Features 086/087/088/089 all touch the same agent surface (`client.py`, `tools.py`, `mcp-tools.md`, strat-lab skill) — required explicit merge-order reconciliation (context.md:30).
**Deferred follow-ons**: none (open risk about pre-existing inert-live strategies was explicitly accepted, not deferred — design.md:82-84).
**Ledger entries written**: insights.md (2), fails.md (1) — see the 2026-08-06 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: - Candidate for `xstockstrat-analysis` service docs: the live-loop firing-symbol contract has exactly one source of truth, `strategy_symbols()` in `app/engine/live_loop.py`, shared by both the live loop and `SetStrategyLive`'s precondition check — do not reimplement it at a new call site (design.md:21-25).
**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at f871138.

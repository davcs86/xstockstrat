# Context: fix-mcp-additive-tools  (archived 2026-08-06)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-06 — /sdd-archiver

**What**: Five backend capabilities that already existed over gRPC (`ExecuteFormula` inline dry-run, `CancelBackfill`, `ListStrategyDefinitions`, `SignalSource` health fields, `EmitAlertRequest` extras) got thin, additive MCP surfaces in `xstockstrat-agent` with zero backend/proto change — closing report F-10 from the 2026-08-01 MCP-alignment triage (context.md:9-21).
**Why (irrecoverable rationale)**: The fixes were scoped tightly to "reachable-but-unsurfaced" RPCs to keep this a same-PR, no-approval-chain change (product-spec.md:49-51); `get_formula`/`list_formulas` reads were deliberately split into sibling feature 086 so they'd pair with the `manage_formula` update fix rather than bloat this one (product-spec.md:67-68). For `list_signal_sources`, `SourceHealthStatus` is projected as the enum **name**, not the int, because it's "stable, human-readable for the model" — an explicit tradeoff flagged as an open risk, not a settled fact: "if a consumer needs the int, revisit" (design.md:62-63). This forward-looking caveat is unrecoverable from shipped code/docs (`docs/runbooks/mcp-tools.md:109-110` states the choice but not the rationale or the revisit trigger).
**Rejected alternatives**:
- `test_formula` accepting a `formula_id` — lost because `get_formula`/`manage_formula` already cover saved formulas; the value is specifically the *inline unsaved-source* dry-run (design.md:52-53).
- `cancel_backfill` as read-only (no admin scope) — lost because `CancelBackfill` is server-side admin-gated and mutates a paid job (design.md:54-55).
- Descriptor-parity test on tool output instead of the client projection — lost because the tool intentionally strips `has_credentials`; the "no field silently dropped" invariant belongs on the mapping layer, not the tool (design.md:56-58).
- Opting `active` out of the `list_signal_sources` parity test alongside `extractor_module` — lost: adversary called this dishonest (silently dropping a field the report flagged), so `active` was surfaced instead and the opt-out set shrank to `{extractor_module}` only (design.md:33-37,43-45; context.md:27).
**Scars & gotchas**:
- `ExecuteFormula`'s sandbox path (`indicators/app/services/sandbox.py`) does not scrub non-finite values, so an unvalidated inline dry-run commonly returns `NaN`/`Inf` in `output`, and `MessageToDict` raises `ValueError` on it — a *new* code path hitting the same P-03 class already ledgered from 2026-07-21, discovered here specifically because dry-run-on-unvalidated-source is the one call site where non-finite output is expected, not exceptional (design.md:19-24).
- `signals_fed` (int64) is emitted as a JSON **number** in this manual projection, diverging from the int64-as-JSON-string contract `run_backtest`/`get_backfill_status` follow via standard `MessageToDict` — accepted as consistent with this tool's pre-existing manual-projection pattern, but flagged so a model doesn't assume the string contract (design.md:64-67).
- Branching from `main-dev` meant this branch's baseline was pre-086; both 086 and 087 edit the same tool catalog + tool-count strings, producing an expected small merge reconciliation (context.md:31).
**Permanent deviations**: none — adversary fixes were folded into the design before implementation; no shipped/design divergence found in context.md.
**Cross-feature signal**: - Multiple SDD features spawned from one triage report (086, 087, 091, 092, 093) land in parallel and several touch the same shared counters (agent tool catalog count, `mcp-tools.md`/`CLAUDE.md` tool-count strings) — expect and plan for merge-order reconciliation rather than treating it as a bug (context.md:31; insights.md 2026-08-02 entries for 086/091/092/093 confirm this is a recurring shape across the batch).
**Deferred follow-ons**:
- `get_formula`/`list_formulas` reads — routed to feature 086 (formula-lifecycle), already launched per ledger.
- `SourceHealthStatus` enum-name-vs-int choice in the `list_signal_sources` projection — revisit if any consumer needs the raw int (design.md:62-63).
**Ledger entries written**: insights.md (2), fails.md (0) — see the 2026-08-06 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: - none
**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at f871138.

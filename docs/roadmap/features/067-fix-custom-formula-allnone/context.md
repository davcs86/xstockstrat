# Context: fix-custom-formula-allnone  (archived 2026-08-06)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-06 — /sdd-archiver

**What**: Custom-formula backtest components silently decoded to all-`None` because `Struct.update()` marshals lists into protobuf `ListValue`, which `isinstance(raw,(list,tuple))` rejects. Shipped fix: `MessageToDict` decode + `FormulaExecutionError` raise, a new `NO_TRADE_REASON_FORMULA_ERROR` enum surfaced per-symbol, an all-failed-run status guard, and a mandatory UI map-key + e2e proof (feature.md:50-53, design.md:10-20).
**Why (irrecoverable rationale)**: Option A (visible enum) beat silent log-and-skip because AC-3 required an *operator/UI-visible* reason (product-spec.md:87) — a log line doesn't satisfy that literally (context.md:61-62). Custom-formula outputs were deliberately **not** tail-aligned like builtin ones because arbitrary user formulas don't guarantee the builtin contiguous-warm-up-head invariant — silent misalignment was judged worse than a visible raise (context.md:57).
**Rejected alternatives**:
- Whole-run `abort(INTERNAL)` — destroys feature-065 sibling partial-success evidence, wrong gRPC status (design.md:135-136).
- Tail-align short lists via `align_indicator_points` — imports a builtin-only invariant onto arbitrary formulas (design.md:137-139).
- Refactor `align_indicator_points` into a shared `_tail_align` — not rejected for tail-aligning itself, but because the two paths diverge in failure semantics (`align_indicator_points` truncates on `len>n`; formulas raise), so merging was wrong on the merits and would add hot-path blast radius (design.md:140-142).
- Synthesize full bars (empty indicators) for the failed symbol (round-3 runner-up) — rejected because the UI no-trade banner is bars-independent, so `bars=[]` renders the reason correctly without synthesized bars (design.md:143-145).
- In-band failure sentinel from `_compute_component` — rejected because it would widen the feature-064-frozen `evaluate_with_series` return contract; both consumers already isolate failures per-unit, so raising was sufficiently contained (design.md:146-147).
- Shared `decode_formula_output()` helper across 3 consumers — rejected as unneeded DRY for a bug fix; `screener` already correct, `fundamentals` scalar-safe (design.md:148-150).
- Dedicated `BACKTEST_STATUS_FORMULA_ERROR` — folding into existing `INSUFFICIENT_DATA` gate was minimal-correct (design.md:151-152).
**Scars & gotchas**:
- `MessageToDict` (protobuf 6.33.x) raises `ValueError` on NaN/Inf — had to wrap in try/except and treat NaN/Inf as out-of-contract → `FORMULA_ERROR` (implementation-spec.md D-1, fails.md:56 [DUP]).
- Existing feature-064 test faked the bug via `success=False`; had to be rewritten to a legit all-null response since `success=False` now raises (implementation-spec.md D-2).
- Playwright e2e for `xstockstrat-ui` exceeds sandbox wall-clock against `webServer`-managed `next build && next start`; pre-building + `pnpm start` + `reuseExistingServer` got a real pass (15.0m) (context.md:139-141).
**Permanent deviations**: none — Option A shipped as designed (context.md:112-129).
**Cross-feature signal**: Appending a proto enum value is never backend-only when an exhaustive `Record<Enum,string>` consumes it in TS — same "shipped producer, forgot shared consumer" shape as 056/060 fails (fails.md:52-54 [DUP]). Also: feature-064 froze `evaluate_with_series`'s return contract, invisible from reading current code, which constrained this fix's failure-signaling design to raising rather than widening the return shape (design.md:146-147).
**Deferred follow-ons**:
- Scalar-broadcast (`{"value":1}`→`[v]*n`) intentionally deferred — no formula in the wild needs it yet (design.md:153-155).
- `resp.error` stays log-only (F-04); a UI-visible error string would need a new proto field (design.md:161-164).
**Ledger entries written**: insights.md (3), fails.md (0) — see the 2026-08-06 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: - none (C-10 findings already captured as ledger entries above; the feature-064-frozen `evaluate_with_series` contract is feature-scoped design rationale, not a standalone platform invariant beyond what fails.md already covers).
**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at f871138.

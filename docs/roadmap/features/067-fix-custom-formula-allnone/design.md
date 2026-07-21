# Design: fix-custom-formula-allnone

**Created**: 2026-07-21
**Rounds**: 3 (quick, extended at user request; termination: approved — Option A, no Floor breach)
**Approved by**: user @ 2026-07-21 (chose Option A "leaning" at the round-2 gate; approved the round-3 synthesis via "continue"; recorded in context.md per P-04)
**Grounded in**: recon.md

---

## Chosen Approach (Option A — AC-3 satisfied literally via a visible `no_trade_reason`)

Root cause (recon.md § Root Cause, confirmed end-to-end): `xstockstrat-indicators` `ExecuteFormula`
marshals a native list output into a protobuf `ListValue` inside the response `Struct`
(`app/handlers/servicer.py:171-176`); `xstockstrat-analysis` `_compute_component` gates decoded values
on `isinstance(raw, (list, tuple))` (`evaluator.py:185-191`), which a `ListValue` fails → all-`None`
series → empty diagnostics `indicators: {}` → `NO_TRADE_REASON_ENTRY_NEVER_TRUE`.

The fix decodes correctly, raises a genuine failure instead of masquerading as all-`None`, and surfaces
that failure to the operator as a distinct, UI-visible `no_trade_reason`. Scope: **`xstockstrat-analysis`
+ a proto enum value + the shared UI diagnostics renderer.**

### 1. Proto — new distinct reason (C-04 / C-09)

Append `NO_TRADE_REASON_FORMULA_ERROR = 4` to the `NoTradeReason` enum
(`packages/proto/analysis/v1/analysis.proto:97-102`; `4` is the next free number — highest existing is
`NO_TRADE_REASON_INSUFFICIENT_CAPITAL = 3`; the `NO_TRADE_REASON_UNSPECIFIED = 0` zero-value already
exists, C-04 satisfied). Appending an enum value is non-breaking for `buf breaking`. Regenerate all
stubs with `./scripts/buf-gen.sh` (C-09) — changed dirs `packages/proto/gen/{go,python,ts}/analysis/v1/`
(+ compiled `gen/ts/dist/`). Per the feature-064/066 ledger insight, verify a clean pre-edit regen
reproduces the committed stubs byte-for-byte **before** editing the `.proto`.

### 2. Evaluator — decode + raise (`app/services/evaluator.py`)

Replace `dict(resp.output)` + the `isinstance(raw, (list, tuple))` gate (`evaluator.py:185-191`) with a
recursive `google.protobuf.json_format.MessageToDict(resp.output)` decode — the exact in-service
canonical, comment-annotated for the `ListValue` trap, at
`app/services/screener.py:259-261`. Normalize `NaN`/`Inf`→`None`. For `COMPONENT_KIND_CUSTOM_FORMULA`,
require the decoded series `len == n`; on any mismatch (`len<n`, `len>n`, empty) **raise** a new local
`FormulaExecutionError(comp.formula_id, resp.error)`. Also replace the `resp.success == false` swallow
(`evaluator.py:180-182`) with the same raise. `align_indicator_points` (`evaluator.py:195-217`) is
**left untouched** — it serves the builtin path only, and (unlike the formula policy) truncates on
`len>n`, so the two are deliberately not merged. An all-`None`/all-`NaN` series with `len == n` passes
through (a legitimate all-warm-up series → existing `NO_TRADE_REASON_ENTIRE_RANGE_WARMUP`).

Custom-formula length policy (per decoded key):

| Shape | Rule |
|---|---|
| scalar (non-list) | dropped (unchanged); scalar-broadcast stays deferred (see Rejected) |
| list `len == n` | normalize `NaN`/`Inf`→`None`, keep |
| list `0 < len < n` | **raise** (do NOT tail-align — the contiguous-warm-up-head invariant holds for builtins, not arbitrary user formulas) |
| list `len > n` | **raise** |
| empty list | **raise** |
| all-`None`/all-`NaN`, `len == n` | pass through (legit warm-up) |

### 3. Servicer — surface per-symbol + fix the all-failed status (`app/handlers/servicer.py`)

`_compute_component` raises out of `evaluate_with_series` (`servicer.py:773`) → out of
`_backtest_symbol_evaluated` (no local try) → into the RunBacktest per-symbol loop. Add an
`except FormulaExecutionError as fe:` branch **between** the `_InsufficientData` handler
(`servicer.py:352`) and the broad `except Exception` (`servicer.py:374`):

- `log.warning(... fe.error)` (the indicators error string — surfaced via log only; see F-04 note).
- Append `SymbolDiagnostics(symbol=symbol, bars=[], no_trade_reason=NO_TRADE_REASON_FORMULA_ERROR,
  bars_total=0, warmup_bars=0)` to `all_diagnostics` — the failed symbol now appears in
  `result.diagnostics` carrying a distinct reason, not silently dropped. Stamp the reason **directly**
  (bypass `_classify_no_trade_reason` at `servicer.py:1477-1484`, which only sees trades/warmup/n and
  would misclassify as `ENTRY_NEVER_TRUE`; the raising symbol never reaches `_finalize_symbol_diagnostics`,
  so exactly one site sets `FORMULA_ERROR` — assert this invariant with a comment + test).
- Increment a `formula_errors` counter; `continue`. Siblings keep their evidence cells
  (`servicer.py:336-348`, feature 065).

**All-failed-run guard (feature-053 regression — round-3 finding):** the status gate at
`servicer.py:400-403` flips to `INSUFFICIENT_DATA` only when `coverage_gaps` is truthy. A single-symbol
(or all-symbols-failed) run leaves `coverage_gaps`/`all_trades` empty and `len(daily_equity) <= 1`, so it
would report `BACKTEST_STATUS_OK` and persist a **spurious per-run score** (`servicer.py:422,436`
`_persist_backtest_run`) — the "fabricated flat-equity success" feature 053 explicitly removed
(`xstockstrat-analysis/CLAUDE.md`). Extend the gate to
`not all_trades and len(daily_equity) <= 1 and (coverage_gaps or formula_errors)` → `INSUFFICIENT_DATA`
(records run history with 0 score / empty rating). A **partial** multi-symbol run where some sibling
traded correctly stays `OK`.

### 4. UI — the shared diagnostics renderer (C-10, mandatory in this feature)

`services/xstockstrat-ui/.../BacktestDiagnostics.tsx:18-25` declares
`const NO_TRADE_MESSAGE: Record<NoTradeReason, string>` — an **exhaustive** record over the enum. Once
`buf-gen` adds `NoTradeReason.FORMULA_ERROR = 4`, that record is missing key `4` and `tsc`/`pnpm build`
**fails** — so the UI change is not optional, it ships here. Add
`[NoTradeReason.FORMULA_ERROR]: '<formula failed to execute>'` (final copy at spec/impl time). The
no-trade banner (`:96`, `NO_TRADE_MESSAGE[sd.noTradeReason] ?? ''`) is **bars-independent**, so the
`bars=[]`/`bars_total=0` entry renders the reason correctly without synthesizing bars. Add an e2e test
asserting the `data-testid="no-trade-reason"` banner renders for a `FORMULA_ERROR` symbol
(C-10 reachability/parity proof, directly answering the 056/060 ledger fails).

### 5. Live loop — no change

`NoTradeReason`/`SymbolDiagnostics` exist only on `BacktestResult`; the live loop emits alerts and has no
equivalent reason surface. Its broad `except Exception` at `live_loop.py:85-93` already catches
`FormulaExecutionError` (a plain `Exception` subclass) and logs-and-continues — the raise is contained
today with no new safety code. Prove it with a test (failing formula in the live path → loop continues,
`_last_state` untouched), per C-10.

### 6. Sibling `ExecuteFormula` decode sites — verified, left as-is (P-03)

There are three `ExecuteFormula.output` consumers; the decode *mechanic* is uniform after this fix, and
the *failure policy* legitimately differs per consumer (recorded here, not left to omission):
- `_compute_component` (the fix) — raises → `FORMULA_ERROR`.
- `screener.py:257-261` — already decodes via `MessageToDict`; returns `None` on `success==false`
  (criterion absent, blend continues). Left as-is.
- `fundamentals_scoring.py:67` — `dict(resp.output)` then `float(out.get("value"/...))`, a **scalar**
  consumer. `dict(Struct)` leaves scalars as native floats (only nested lists become `ListValue`), so
  the bug does **not** bite it; an out-of-contract list output would raise `TypeError` loudly, not
  silently degrade. **Verified no second-path bug — no change needed.**

### 7. Steps & tests (C-08 / P-06, red-green)

1. **Proto step** — append enum; `buf lint` + `buf breaking` + `./scripts/buf-gen.sh`; commit regen stubs.
2. **Service step (evaluator)** — decode/raise. Tests: list output → non-`None` series == input (RED
   today, `test_strategy_evaluator.py:354`); `NaN` head → leading `None`s; `len<n`/`len>n`/empty → raises;
   `success==false` → raises; scalar `{"value":1}` → dropped (documents deferred broadcast).
3. **Service step (servicer)** — `except FormulaExecutionError` branch + status-gate extension. Tests:
   multi-symbol run where symbol A fails, B succeeds → A's `SymbolDiagnostics.no_trade_reason ==
   NO_TRADE_REASON_FORMULA_ERROR`, B keeps its evidence cell, `status == OK`; **all-failed run → status ==
   INSUFFICIENT_DATA and no persisted score**; invariant test that `_classify_no_trade_reason` never
   produces `FORMULA_ERROR`.
4. **UI step** — `NO_TRADE_MESSAGE` map key + e2e banner-render test for a `FORMULA_ERROR` symbol.
5. **Service step (live loop)** — confirm-only + test (failing formula → loop logs-and-continues).
6. Coverage: analysis ≥40% (`services/xstockstrat-analysis/CLAUDE.md`); UI e2e per existing Playwright setup.

## Rejected Alternatives

- **Option B — log-and-skip, no proto** — rejected by the user (round-2 gate): stops the all-`None`
  masquerade but leaves no operator/UI-visible reason, satisfying only the second half of AC-3
  (`product-spec.md:87`). Option A was chosen for the literal "visible `no_trade_reason`."
- **Whole-run `abort(INTERNAL)` on failure** (round-1 proposal) — rejected: regresses partial-success
  (destroys feature-065 sibling evidence, `servicer.py:336-348`), wrong gRPC status, masks `resp.error`.
- **Tail-align a short custom-formula list via `align_indicator_points`** (round-2 proposal) — rejected:
  imports the builtin contiguous-warm-up-head invariant that arbitrary user formulas don't guarantee →
  silent bar-misalignment (worse than the visible bug). Custom formulas require `len==n` and raise.
- **Refactor `align_indicator_points` to a shared `_tail_align`** (round-2 proposal) — rejected: the two
  paths diverge (`align_indicator_points` truncates on `len>n`; formulas raise), so merging is wrong on
  the merits and adds hot-path blast radius.
- **Synthesize full bars (empty indicators) for the failed symbol** (round-3 proposer runner-up) —
  rejected: the UI banner is bars-independent, so `bars=[]` renders fine once the map key exists; keep
  the simple loop-level catch.
- **In-band failure sentinel from `_compute_component`** — rejected: would widen the 064-frozen
  `evaluate_with_series` return contract; both consumers already isolate per-unit, so raising is contained.
- **Shared `decode_formula_output()` helper across all three consumers** — rejected for a bug fix:
  rounds 1–2 settled "no new helper"; `screener` is already correct and `fundamentals` is scalar-safe, so
  per-consumer decode + documented divergence is acceptable (not a DRY/C-10 violation).
- **Dedicated `BACKTEST_STATUS_FORMULA_ERROR`** — rejected: a second proto enum + another UI status branch;
  folding the all-failed run into the existing `INSUFFICIENT_DATA` gate is the minimal correct move.
- **Scalar-broadcast `{"value":1}` → `[1.0]*n`** — deferred (confirmed safe): the two reported formulas
  emit per-bar lists (repro `{"value":[1.0 for _ in data["close"]]}`, `product-spec.md:23`), so the
  `ListValue` decode closes AC-1/AC-2 without broadcast.

## Open Risks

- [ ] **Final UI copy** for `NO_TRADE_MESSAGE[FORMULA_ERROR]` and the exact e2e `data-testid` seam —
  confirm the renderer's existing testid convention at `/sdd-spec`. Target: UI step.
- [ ] **`resp.error` not machine-readable** — surfaced via `log.warning` only; `SymbolDiagnostics`/
  `BacktestResult` have no string error field (`analysis.proto:56-71,123-129`) and F-04 forbids inventing
  one. If product later wants the error text UI-visible, that is a separate proto field addition, out of
  scope. Target: noted, not this feature.
- [ ] **Status-gate predicate exact form** — the `formula_errors` counter + the `:400-403` boolean must be
  written to preserve the partial-success case (some sibling traded → OK). Target: servicer step.

## Constitution Rules Touched

- **C-04** — honored: `NO_TRADE_REASON_FORMULA_ERROR` appended to a closed enum that already has its
  `_UNSPECIFIED = 0` zero-value; no string used where an enum belongs.
- **C-09** — honored: proto step runs `buf lint` + `buf breaking` (append is non-breaking) and
  `./scripts/buf-gen.sh`; regen stubs committed; toolchain verified against committed stubs first.
- **C-08 / P-06** — honored: every service/proto/UI step is paired with red-before-green tests, incl. the
  UI e2e banner proof and the all-failed-status test; analysis coverage stays ≥40%.
- **C-10** — honored: the new enum's **two** shared consumers are updated and proven — the UI renderer
  (`BacktestDiagnostics.tsx`, else the frontend build breaks) with an e2e reachability test, and the
  status/scoring path (all-failed guard) — directly closing the 056/060 "forgot the shared consumer" fails.
- **P-03** — honored: the `fundamentals_scoring` and screener decode sites were *verified now* (not
  deferred), and the divergent per-consumer failure semantics are recorded here rather than by omission.
- **F-04** — honored: no invented proto field for `resp.error`; it is surfaced via log only.
- **F-07** — honored: no config values introduced.
- **Floor status:** no unresolved `F-*` breach across all three rounds.

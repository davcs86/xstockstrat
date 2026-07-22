# Context Log: fix-custom-formula-allnone

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-07-21 (/sdd-triage)

- Bug found during a staging backfill + strategy re-validation session (no GitHub issue — see deviation below).
- Severity: SEV-2 — fully breaks 2 of 5 registered strategies (`range_mean_reversion`, `squeeze_breakout_trend`), but on the staging/paper (dev) environment only, with no production or live-trading risk.
- Routed to SDD path (Track C). Per triage routing, SEV-2 on a dev/local environment → Track C.
- Created: feature.md, product-spec.md, context.md.
- Affected services (from evidence): `xstockstrat-analysis` (primary — evaluator result decoding / backtest diagnostics); `xstockstrat-indicators` (secondary — `ExecuteFormula` response shape, likely read-only reference).
- Root cause hypothesis: custom-formula components decode to an all-`None` series and are filtered out of the diagnostics `indicators` map. Leading candidate: `resp.output` (proto `Struct`) yields `ListValue`, not Python `list`/`tuple`, so the `isinstance(raw, (list, tuple))` filter at `evaluator.py:197-200` drops every output and `value` defaults to `[None] * n`. Also `evaluator.py:190` silently swallows `resp.success == false`.
- Recommended design depth: **quick** → `/sdd-design fix-custom-formula-allnone quick` (rationale: SEV-2 with a non-trivial, still-to-verify root-cause hypothesis; single primary service, no proto/migration/config → below the "full" threshold, above "skip").
- Development branch (for the eventual fix): `feature/fix-custom-formula-allnone`.

### Deviations from the /sdd-triage skill

- **No GitHub issue number.** GitHub Issues are **disabled** on `davcs86/xstockstrat` (the create API returns `410 Issues has been disabled`). The triage skill's `gh issue view` step (T-1) and the issue-derived slug (`fix-<issue-number>-...`) were adapted: the bug was captured directly from staging backtest evidence, and the slug omits the issue number (`fix-custom-formula-allnone`). No GitHub-issue-close step (Track C step 6) will apply.
- **Feature number.** Assigned `065` = `max(existing NNN)=064` + 1, per the CLAUDE.md numbering rule. (Note: a pre-existing collision exists at `064` — `064-backtest-debug-info` and `064-persist-strategy-scores` — left untouched; not this bug's concern.)

### Reproduction evidence (staging, 2026-07-21)

Backfill `dfa23008-59c6-48d7-9a2b-2d019c8dbd43` completed (AAPL/MSFT/NVDA, 1d, from 2025-01-01, gaps_only; 786/826 bars, no failed symbols), giving ~499/500/386 bars/symbol. Backtests then run:

| Strategy | Trades | no_trade_reason | indicators map |
|---|---|---|---|
| golden_cross_conviction (builtin) | 16 | — | populated |
| quality_dip_buyer (builtin) | 10 | — | populated (`sma200` numeric) |
| fundamentals_macd_blend (builtin) | 61 | — | populated |
| range_mean_reversion (custom) | 0 | ENTRY_NEVER_TRUE | `{}` (empty) |
| squeeze_breakout_trend (custom) | 0 | ENTRY_NEVER_TRUE | `{}` (empty) |

Only the two custom-formula strategies exhibit the empty-`indicators` bug; builtin strategies on the same data trade fine.

---

## Session 2026-07-21 — sdd-design (quick)

- **Renumbered `065` → `067`.** The triage-time `065` collided with two features already on `main-dev` (`065-cross-stock-score-derivation`, `065-second-market-data-vendor`) — my triage ran on a branch that predated them. Per the feature-numbering rule (renumber the later colliding one to the next free NNN; true max was `066`), `git mv`'d the dir to `067-fix-custom-formula-allnone`. Files key off the slug, not the number, so no internal refs changed. User approved the renumber.
- **Phase 0 Recon**: wrote `recon.md`. Services surveyed: `xstockstrat-analysis` (fix site), `xstockstrat-indicators` (read-only reference). Root cause **confirmed end-to-end** — indicators marshals list outputs into proto `ListValue` inside the response `Struct` (`indicators/servicer.py:171-176`); analysis `_compute_component` gates decoded values on `isinstance(raw, (list, tuple))` (`evaluator.py:185-191`), which `ListValue` fails → all-`None` series → present-only comprehension drops it (`servicer.py:785-789`) → `ENTRY_NEVER_TRUE`. Product-spec line numbers were stale; recon corrected them. Key reuse pattern: stdlib `MessageToDict` (already used for inbound `input_data`).
- **Phase 1 Grilling**: 1 round (quick). Proposer proposed `MessageToDict` decode + a whole-run abort for failures. Adversary (**NEEDS WORK**, no Floor breach) landed three grounded objections: (1) outputs are not guaranteed full-length-`n` — `NaN` warm-up heads / short lists need normalize+align or a visible-bug becomes a silent bar-misalignment bug; (2) **C-10 / 056 fail** — `_compute_component` is shared by backtest *and* the live loop (`live_loop.py:119`), so failure-surfacing must be handled+tested on both paths; (3) factual correction — `servicer.py:374` already `log.warning + continue` (per-symbol degrade), so the proposed `abort(INTERNAL)` is a **regression** (nukes feature-065 sibling evidence) and the wrong gRPC status.
- **Chosen approach** (design.md): hardened `MessageToDict` decode (NaN→None + length-reconcile via existing `align_indicator_points`); AC-3 via **per-symbol degradation** (mirror `except _InsufficientData`, no whole-run abort) surfaced on **both** backtest + live-loop paths; scalar-broadcast **deferred** (undeclared semantic). Rejected: whole-run abort, `isinstance`-widening, assume-full-length, scalar-broadcast.
- **Constitution rules touched**: C-08/P-06 (paired red-green test incl. both consuming paths), C-10 (both shared paths updated+tested), P-03 (raise/surface instead of silent misalign), C-04/F-04 (no invented enum — failure via existing structured channel), F-07 (no config values). Floor breaches: none.
- **Approval note (P-04)**: the interactive gate (`AskUserQuestion`) was declined; the user then said "continue from where you left off," which I recorded as approval of the recommended option (approve with the debate's revisions baked in). Status: `draft` → `design-approved`.
- **Open threads** (carried from design.md § Open Risks, target `/sdd-spec`): (a) exact length-reconciliation policy (tail-align vs treat-as-failure per mismatch shape) + `align_indicator_points` contract; (b) confirm the existing structured channel/field used to surface a skipped symbol (no dedicated `NO_TRADE_REASON_*` found — avoid a proto change); (c) live-loop degradation shape at `_eval_pair` (log-and-continue vs health signal) + its test.
- Next: `/sdd-spec fix-custom-formula-allnone`.

---

## Session 2026-07-21 — sdd-design re-opened (rounds 2–3, → Option A)

The round-1 approval was recorded via "continue"; the user then asked to **run another round**, so the debate re-opened (rounds 2 and 3). Lifecycle stays `design-approved`; `design.md` was rewritten to the final Option A design.

- **Round 2** (proposer + adversary). Proposer resolved the three round-1 open threads with grounded contract reads; adversary returned **NEEDS WORK** (no Floor breach) with code-verified findings, all folded in:
  - Custom-formula outputs are **not** guaranteed length-`n` → do **not** tail-align (imports a builtin-only warm-up-head invariant); require `len==n` and raise on any mismatch.
  - **Drop** the `align_indicator_points` refactor — the two paths diverge (`align` truncates on `len>n`, formulas raise), so merging is wrong on the merits and adds hot-path blast radius. Leave `align_indicator_points` untouched.
  - **Scalar risk resolved now** (not deferred): the two reported formulas emit per-bar lists (repro `{"value":[1.0 for _ in data["close"]]}`, `product-spec.md:23`), so `ListValue` decode closes AC-1/AC-2; scalar-broadcast deferral is safe.
  - Canonical decode reuse is `app/services/screener.py:259-261` (already `MessageToDict`, with a `ListValue`-trap comment) — better reference than the indicators-inbound one.
  - **AC-3 fork surfaced (P-03/P-04):** `product-spec.md:87` requires a *visible* `no_trade_reason`; log-and-skip leaves nothing operator/UI-visible. This went to the user as a gate.
- **User decision @ round-2 gate:** "Run another round leaning towards **Option A**" (add a distinct proto `no_trade_reason` for formula failure).
- **Round 3** (Option A). Proposer specified: append `NO_TRADE_REASON_FORMULA_ERROR = 4` to `NoTradeReason` (`analysis.proto:97-102`, next free number, non-breaking); evaluator decode/raise; servicer `except FormulaExecutionError` stamps a `SymbolDiagnostics(no_trade_reason=FORMULA_ERROR, bars=[])`; live loop unchanged. Adversary returned **NEEDS WORK** (no Floor breach) with two code-verified misses, both folded in:
  - **C-10 — the proto enum breaks the UI build.** `BacktestDiagnostics.tsx:18-25` is an **exhaustive** `Record<NoTradeReason,string>`; regenerating the stub with the new value makes `pnpm build` fail until `[NoTradeReason.FORMULA_ERROR]` is added. So the UI map + an e2e banner test ship **in this feature**. (The banner is bars-independent, so `bars=[]` renders fine — the proposer's "synthesize full bars" runner-up is unnecessary.)
  - **Feature-053 regression — all-failed run masquerades as OK+scored.** The `except → continue` doesn't touch `coverage_gaps`, so a single-symbol/all-failed run stays `BACKTEST_STATUS_OK` and persists a spurious per-run score (`servicer.py:400-403,422,436`). Fix: track a `formula_errors` count and extend the status gate → `INSUFFICIENT_DATA` for a no-usable-evidence run; partial multi-symbol runs stay OK.
  - **P-03 — fundamentals decode verified now:** `fundamentals_scoring.py:67` is a **scalar** `dict()` consumer, not bitten by the `ListValue` bug (out-of-contract list would raise `TypeError` loudly). No change needed; recorded, not deferred.
- **Chosen approach = Option A** (design.md): proto enum + evaluator `MessageToDict` decode & `len==n`-else-raise + servicer `FORMULA_ERROR` surfacing & all-failed status guard + mandatory `BacktestDiagnostics.tsx` map & e2e + live-loop confirm-only + siblings recorded. **Scope grew to `xstockstrat-analysis` + `packages/proto` + `xstockstrat-ui`** (updated `product-spec.md` Fix Scope accordingly).
- **Constitution touched**: C-04 (enum + zero-value), C-09 (buf lint/breaking/gen), C-08/P-06 (paired red-green incl. UI e2e + all-failed-status test), **C-10** (both shared consumers — UI renderer + status/scoring path — updated & tested, closing the 056/060 fails), P-03 (fundamentals/screener verified now, divergence recorded), F-04 (no invented error field — `resp.error` via log only), F-07 (no config). Floor breaches: none across all 3 rounds.
- **Approval note (P-04):** the round-3 gate (`AskUserQuestion`) was declined; the user's "continue from where you left off" was recorded as approval of the recommended option (approve Option A with round-3 fixes baked in).
- **Open threads** (design.md § Open Risks, target `/sdd-spec`): final UI copy + e2e `data-testid` seam; exact `formula_errors` status-gate predicate (must preserve partial-success); `resp.error` intentionally not machine-readable (F-04) — a UI-visible error string would be a separate proto field, out of scope.
- Next: `/sdd-spec fix-custom-formula-allnone`.

---

## Session 2026-07-21 — sdd-spec

- Generated implementation-spec.md with **9 steps** (proto → proto-gen → evaluator service+test →
  servicer service+test → UI service+e2e → live-loop confirm-only test). Status
  `design-approved` → `implementation-ready`. Consumed recon.md + design.md (Option A) as authoritative.
- Key codebase findings (all verified this session, line numbers current):
  - **Proto**: `NoTradeReason` enum at `packages/proto/analysis/v1/analysis.proto:97-102`; highest
    existing value `NO_TRADE_REASON_INSUFFICIENT_CAPITAL = 3`, next free = **4**; `_UNSPECIFIED = 0`
    already present (C-04 ok). `SymbolDiagnostics.no_trade_reason` is field 3 (`:123-129`).
  - **Evaluator bug sites** `app/services/evaluator.py`: swallow-1 `if not resp.success: return {"value":[None]*n}` at **180-182**; swallow-2 `dict(resp.output)` + `isinstance(raw,(list,tuple))` gate at **185-191**. `align_indicator_points` (builtin-only) at **195-217** — left untouched. Imports (`:13-20`) have `Struct` but NOT `MessageToDict`.
  - **Canonical decode to reuse**: `app/services/screener.py:259-261` already uses
    `MessageToDict(resp.output)` with a `ListValue`-trap comment (`screener.py:24` imports it). Better
    reference than the indicators-inbound one.
  - **`FormulaExecutionError`**: net-new (grep found none). Define in `evaluator.py` (mirror
    `_InsufficientData` at `servicer.py:55-66`); servicer already imports from `app.services.evaluator`
    (`servicer.py:39-43`) so adding it to that block catches it.
  - **Servicer**: RunBacktest per-symbol loop `try` at `servicer.py:303`; handlers `except _InsufficientData` (352-370), `grpc.RpcError` (371-373), `Exception` (374-376) — new `except FormulaExecutionError` goes before the broad Exception. `_backtest_symbol_evaluated` calls `evaluate_with_series` with no local try (`:773`) → raise propagates. Accumulators init `:291-300` (add `formula_errors`). Status gate `:400-403`; OK-only cell/score persist `:422-443`. `_classify_no_trade_reason` `:1477-1484`; `_finalize_symbol_diagnostics` `:1487-1501` (only other `SymbolDiagnostics` ctor).
  - **UI (C-10 hard-couple)**: `services/xstockstrat-ui/src/components/insights/BacktestDiagnostics.tsx:18-25` — exhaustive `Record<NoTradeReason,string>`; regenerated stub breaks `pnpm build` until the `FORMULA_ERROR` key is added. Banner is bars-independent (`:86`, `:96-103`, `data-testid="no-trade-reason"`), so `bars:[]` renders. Mock-backend `runBacktest` diagnostics branch pattern at `e2e/mock-backend.ts:442-489`; existing e2e banner test at `e2e/insights/backtest-coverage.spec.ts:32-43`.
  - **Live loop**: `app/engine/live_loop.py:85-93` already `except Exception → log+continue` — no code change (confirm-only test in `tests/test_live_loop.py`).
  - **Fundamentals** `app/services/fundamentals_scoring.py:61-72` — scalar `dict(resp.output)` consumer; not bitten by the `ListValue` bug (P-03 verified now, no change).
  - Last analysis migration is `007_backtest_run_symbols` — no migration needed.
- Open threads carried to /sdd-execute: final UI copy for `NO_TRADE_MESSAGE[FORMULA_ERROR]`; exact
  `formula_errors` status-gate predicate must preserve partial-success (some sibling traded → OK);
  `resp.error` intentionally log-only (F-04, no invented proto field).
- Next: `/sdd-review fix-custom-formula-allnone impl-spec`.

---

## Session 2026-07-21 — sdd-execute (sequential, single-PR)

Executed all 9 steps end-to-end in `sequential` mode; per the user's explicit instruction the work
was committed to the harness branch `claude/feature-067-sequence-mode-20vup4` and pushed as **one
integration PR** (not stacked per-step PRs). Toolchain: Docker/buf absent → provisioned the codegen
toolchain on the host pinned to the CI `proto-freshness` versions (buf 1.69.0, protoc-gen-go v1.36.11,
protoc-gen-go-grpc v1.6.2, protoc-gen-connect-go v1.19.2, grpcio-tools 1.80.0, TS plugins from the
lockfile) and validated an **empty** pre-edit stub diff before touching the `.proto`.

### Steps
- **Step 1–2 (proto + gen)** [done]: appended `NO_TRADE_REASON_FORMULA_ERROR = 4`; `buf lint` + `buf
  breaking` (non-breaking) pass; `./scripts/buf-gen.sh` regenerated stubs — diff limited to
  `analysis/v1` + `gen/ts/dist/`; `FORMULA_ERROR = 4` present in Go/Python/TS.
- **Step 3–4 (evaluator + test)** [done]: `MessageToDict` decode + `FormulaExecutionError` +
  length-policy (len==n else raise). Red captured (`[None]*n` != closes) → green. 10 decode tests.
- **Step 5–6 (servicer + test)** [done]: `except FormulaExecutionError` stamps a direct
  `SymbolDiagnostics(no_trade_reason=FORMULA_ERROR, bars=[])`, `formula_errors` counter, status gate
  extended to `not all_trades and len(daily_equity)<=1 and (coverage_gaps or formula_errors)`. Red →
  green; partial run stays OK+keeps sibling cell, all-failed run → INSUFFICIENT_DATA + score=None,
  classify-invariant holds. Full analysis suite 236 passed, coverage 79%.
- **Step 7–8 (UI + e2e)** [done]: added the `[NoTradeReason.FORMULA_ERROR]` key to the exhaustive
  `NO_TRADE_MESSAGE` record + a `strat-formula-error-001` mock-backend branch + a Playwright banner test.
  C-10 build-coupling proven: RED `tsc` `TS2741` without the key → GREEN with it; `pnpm lint` + `pnpm
  build` clean. e2e run fell back to CI-equivalent (tsc+lint+build) — Playwright webServer exceeds the
  sandbox wall-clock (Deviation D-3); the test mirrors the adjacent `strat-diag-001` banner test.
- **Step 9 (live loop)** [done]: confirm-only — added a test proving the loop's broad `except Exception`
  absorbs `FormulaExecutionError` (continues, `_last_state` untouched, sibling still alerts). No code change.

### Deviations (full detail in implementation-spec.md § Deviation Log)
- **D-1**: `MessageToDict` (protobuf 6.33.x) refuses NaN/Inf number_values — the canonical decode both
  screener and this fix use. Realistic warm-up is `null`/`None` (decodes cleanly); a genuinely NaN/Inf
  output is out-of-contract and now surfaces as a visible `FORMULA_ERROR` (wrapped `try/except
  ValueError → raise`), honoring P-03. Design table's "all-NaN passes through" corrected to null-based.
- **D-2**: existing `test_formula_warmup_uses_declared_not_observed` used `success=False` to fake an
  all-None series (the bug). Now `success=False` raises; test switched to a legitimate all-null
  `success=True` series, intent + assertions preserved.
- **D-3**: UI e2e is very slow in the sandbox (webServer aborts in-band on the wall-clock limit) but
  **passes** when run against a pre-built `pnpm start` server — the formula-error banner test reported
  `1 passed (15.0m)`. CI-equivalent checks (tsc red→green, lint, build) captured as corroboration; CI's
  `frontend-e2e` job runs it in normal time.

Files modified: `packages/proto/analysis/v1/analysis.proto` (+ regenerated `gen/{go,python,ts}` +
`gen/ts/dist`), `services/xstockstrat-analysis/app/services/evaluator.py`,
`services/xstockstrat-analysis/app/handlers/servicer.py`, `.../tests/test_strategy_evaluator.py`,
`.../tests/test_analysis_servicer.py`, `.../tests/test_live_loop.py`,
`services/xstockstrat-ui/src/components/insights/BacktestDiagnostics.tsx`,
`services/xstockstrat-ui/e2e/mock-backend.ts`,
`services/xstockstrat-ui/e2e/insights/backtest-coverage.spec.ts`.

## Session 2026-07-21 (CI: feature status automation)

- Promotion PR #767 merged to main
- Feature promoted and committed: 52adaa26702553f9d51f3cf458479a9b7729f930
- Status updated: `code-completed` → `launched`
- Launched date: 2026-07-21

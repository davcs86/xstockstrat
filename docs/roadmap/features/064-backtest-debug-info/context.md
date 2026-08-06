# Context: backtest-debug-info  (archived 2026-08-06)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-06 — /sdd-archiver

**What**: `RunBacktest` now always returns per-bar diagnostics (OHLCV, indicator/component series,
warm-up flags, action, conviction, no-trade reason) for every symbol, gated by a 2-year range cap
that applies to ALL `RunBacktest` callers, not just the diagnostics consumers — the cap exists
because diagnostics are always-included (no opt-in flag). A `warmup_period` field was bolted onto
custom formulas so the new warm-up definition could generalize beyond built-in indicators.

**Why (irrecoverable rationale)**: The warm-up definition went through three resolutions in one day
before landing: Option B (rule-referenced union) → re-opened by the user to Option C (declared
lookback, forcing the custom-formula scope addition) → refined at design time into a **hybrid**
(observe built-ins' actual series-resolution index, declare formulas' lookback via `GetFormula`)
because a pure declared-constant map for built-ins creates a bug class: `SMA(P)` resolves at index
`P-1`, so a `period`-constant disagrees with the real leading-gap by exactly one and mislabels a
resolved bar as warm-up. Separately, whether the agent's `run_backtest` tool should include
diagnostics flipped from "omit to stay lean" to "include, so the agent can suggest strategy/indicator
fixes from per-bar data" — a deliberate reversal that later features 071/072 had to build around
(see Cross-feature signal).

**Rejected alternatives**:
- Pure declared `_INDICATOR_WARMUP` constant map for built-ins — lost because it disagrees by one
  index with actual series resolution, producing false warm-up flags.
- Observe-series-resolution for everything (including custom formulas) — lost because custom-formula
  series can resolve irregularly or emit early garbage; only a *declared* lookback is trustworthy.
- `return_series` kwarg on `evaluate()` — lost because it would have broken feature-048's live-loop
  docstring frozen-signature pledge; a sibling `evaluate_with_series()` was chosen instead.
- `react-window` for the UI table — lost because it forces its own list container, abandoning the
  shared shadcn `Table` markup that `@tanstack/react-virtual`'s headless model was chosen to
  preserve. **This rationale did not survive into the shipped code** — see Permanent deviations.
- Splitting the custom-formula `warmup_period` slice into its own feature — lost because analysis
  compile-depends on the new proto field, so proto+indicators must land before analysis regardless.
- Reading `action` from `decisions[i]` instead of capturing it inline at the trade-loop branch —
  rejected because a decision-entry bar that doesn't fill (or a hold-while-long bar) would mislabel
  vs the actual `TradeRecord`; action must be captured at the branch. A future refactor
  "simplifying" the diagnostic builder/trade loop to read `action` from `decisions[i]` would silently
  reintroduce a mislabeling bug, with no comment in shipped code explaining why that shortcut was
  rejected.
- Widening `evaluate_with_series` to also return formula warmup — rejected; `GetFormula` is instead
  fetched once-per-run and cached by `formula_id`, avoiding N×M round-trips without further widening
  the evaluator contract.

**Scars & gotchas**:
- Confirmed a latent `bar.timestamp` vs `bar.time` bug: six call sites in `analysis` `servicer.py`
  read a proto attribute (`bar.timestamp`) that does not exist on the real `marketdata_pb2.Bar` (the
  real field is `time`) — every prior test passed because bars were `MagicMock`, which silently
  returns a truthy attribute for any name instead of raising `AttributeError`. Only surfaced because
  this feature mandated real `Bar` fixtures for a diagnostics test. Fixing it also silently corrected
  pre-existing `TradeRecord` entry/exit times that had been wrong all along.
- Toolchain provisioning on host: `buf` via `go install` (GitHub-releases egress blocked); had to
  bump `protoc-gen-go-grpc` to v1.6.2, one patch ahead of `Dockerfile.codegen`'s v1.6.1 pin —
  validated via an empty diff on regenerating unmodified protos before touching any `.proto`.
- `protobuf` 6.33.6 renamed the `MessageToDict` kwarg `including_default_value_fields` →
  `always_print_fields_with_no_presence`.
- No Docker/Postgres/Playwright-browsers on the execute host — migration verified via a throwaway
  `postgres:16` container, UI verified via `tsc --noEmit` + `next lint` with the e2e test committed
  for CI to actually run.

**Permanent deviations**: design said the UI diagnostics table would use `@tanstack/react-virtual`'s
headless `useVirtualizer` specifically *to keep the shared shadcn `<Table>` markup* (the stated
reason for rejecting `react-window`, which "forces a div-grid") → shipped a **virtualized div-grid
anyway**, because row virtualization needs absolute positioning that native `<table>` layout can't
support regardless of which virtualization library drives it — the incompatibility is with native
table layout itself, not `react-window` specifically. The semantic header/cell roles and an a11y
row-count were preserved by hand instead.

**Cross-feature signal**: 064 established the pattern that the agent's `client.run_backtest` returns
the **full** `MessageToDict` result (diagnostics included) rather than a trimmed projection. Later
features 071 (`run_backtest` input range) and 072 (`run_backtest` output — summary-inline vs
attachment split) both had to build around that full-dict return; 072 kept `client.run_backtest`
returning the full dict and did its splitting one layer up in `tools.py` specifically so 064's
`test_run_backtest_projects_full_result_with_diagnostics` test stayed valid.

**Deferred follow-ons**: `NO_TRADE_REASON_INSUFFICIENT_CAPITAL` stays defined in the enum but is
deliberately **not emitted this version** — a user-locked scope cut. A future feature implementing
capital-insufficiency detection in backtests should know this enum value already exists, unwired, by
design — it does not need to be added, only wired up.

**Note on the "round cap" question**: this feature's design debate ran exactly 2 rounds (full mode's
*floor*, not the 5-round ceiling), terminated by user approval — not a forced cap. No
forced-termination reasoning exists to capture for this feature.

**Ledger entries written**: insights.md (1), fails.md (1) — see the 2026-08-06 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: none.
**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at
`fe278020abe1e4b0c128a7a2207fd46596d8a9e8`.

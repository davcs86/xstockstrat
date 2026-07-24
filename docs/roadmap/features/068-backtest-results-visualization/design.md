# Design: backtest-results-visualization

**Created**: 2026-07-21
**Rounds**: 1 (quick; termination: approved)
**Approved by**: user @ 2026-07-21 (standing authorization — the initiating instruction directed the
full SDD pipeline through implementation in this autonomous session; recorded per P-04 in context.md)
**Grounded in**: recon.md

---

## Chosen Approach

**Persistence (analysis).** After the existing summary insert (`servicer.py:472-478` →
`_persist_backtest_run` `:1147-1180`), an OK-gated, best-effort `_persist_backtest_detail`
serializes the fully-assembled result (`result.SerializeToString()`) into a new
`analysis.backtest_details` table via a new `BacktestDetailsRepository` mirroring
`app/repositories/backtest_runs.py:25-77` on the **shared pool** (`app/main.py:47-49`).
Migration `008_backtest_details` (up **and** down):

```sql
backtest_id  TEXT PRIMARY KEY REFERENCES analysis.backtest_runs(backtest_id),
strategy_id  TEXT NOT NULL,
completed_at TIMESTAMPTZ NOT NULL,   -- stamped explicitly from result.completed_at; no DEFAULT
result_pb    BYTEA NOT NULL
-- index (strategy_id, completed_at DESC)  [precedent: 006_backtest_runs]
```

The FK makes detail-exists ⇒ summary-exists structural (C-10(b) existence parity): if the summary
insert failed, the detail insert fails inside the same try/except→warning wrapper. `completed_at`
is bound from `result.completed_at` so eviction order and `ListBacktests` order rest on the same
value. Eviction runs in the repo immediately after `INSERT … ON CONFLICT (backtest_id) DO NOTHING`:
`DELETE … WHERE strategy_id=$1 AND backtest_id NOT IN (SELECT backtest_id … ORDER BY completed_at
DESC LIMIT $N)`, with `N = max(1, get_int("analysis.backtest.detail_retention_per_strategy", 20))`
(clamp guards the negative-value silent-swallow failure; the `get_int` zero-trap — 0 reads as
default — is documented with the key). INSUFFICIENT runs get no detail row (permanent FR-6 state;
mirrors the OK-only gate at `servicer.py:451-459`).

**Proto (additive only).** `rpc GetBacktest(GetBacktestRequest) returns (BacktestResult)`;
`GetBacktestRequest { string backtest_id = 1 }`; `BacktestResult.initial_capital = 15` (double,
set from the **effective** engine seed — the 100k default path at `servicer.py:293-294` — not the
raw request field); `BarDiagnostic.equity = 15` (double, per-bar portfolio value the engine already
computes and discards — `servicer.py:643,653,662,737-738` and `:833-837,886,910-911`; wired through
the single shared builder `_build_bar_diagnostic` `:1471-1494` at both call sites). Field numbers
verified free (recon: highest = 14 in both messages). No enum changes → the exhaustive TS `Record`
maps in `BacktestDiagnostics.tsx:9-27` are untouched; the proto step still pairs a frontend build
check per the 2026-07-21 ledger trap.

**GetBacktest handler (analysis) — DB-only read path.** `SELECT result_pb` by `backtest_id` →
`BacktestResult.FromString(...)` → return; no row → `NOT_FOUND` ("no detailed data for this run" —
the single state for legacy, evicted, and INSUFFICIENT runs). **No in-memory `self._backtests`
read**: memory-first was rejected (see Rejected Alternatives) because the dict is written
unconditionally for both statuses (`servicer.py:437-439`), is keyed by strategy_id as well
(collision), and never evicts — DB-only gives one restart-invariant semantics (AC-1) with a single
indexed row read. No outbound calls in the handler → no header propagation needed; no admin gate
(read parity with `ListBacktests`, forwarded openly at `insightsBff.ts:39`).

**UI (insights, in-page — no new route/nav; C-10(a) not triggered).** Past Runs rows
(`page.tsx:429-471`) become clickable → `selectedRunId` state; new `useBacktestDetail(backtestId)`
hook (NOT_FOUND-aware retry modeled on `useStrategyReport` `useStrategies.ts:26-34`; query key
`['analysis-backtest-detail', backtestId]`) calls `analysisClient.getBacktest` through a one-line
`getBacktest: forward(...)` registration in `insightsBff.ts:36-39`. The result-selection seam
(`page.tsx:103`) extends to `selectedDetail ?? backtestResult ?? report?.latestBacktest`, and
`useRunBacktest`'s existing `onSuccess` (`page.tsx:95-98`) **also clears `selectedRunId`** so a
fresh run is never shadowed by a stale selection (e2e-asserted). Metrics grid, `BacktestDiagnostics`
(unchanged, `BacktestDiagnostics.tsx:51`), and the chart all render through this one path (AC-5).
Opening a row with no detail (legacy/evicted/INSUFFICIENT) renders the explicit
"no detailed data for this run" empty state only — the row's summary metrics remain visible in the
Past Runs table itself, so no second metrics-grid feed is created (decision recorded; FR-6).

**Equity chart.** The trade-ordinal chart and the `form.initial_capital` derivation
(`page.tsx:109-116,364-398`) are replaced by one `EquityCurveChart` component; all data derivation
lives in `src/lib/equityCurve.ts` (vitest-covered — coverage is scoped to `src/lib/**`,
`vitest.config.ts:8-28`). Curve = one **time-aligned line per symbol** from `diagnostics[].bars[]`
(`timestamp` + new `equity`) — never the run-level concatenation (`servicer.py:354` compounds
symbols sequentially and is not time-aligned). **Multi-symbol default rendering is per-symbol
normalized % return** (each line indexed to its own first bar's equity) because absolute-dollar
offsets encode iteration order, not information; absolute dollars render only for single-symbol
runs. Trade entry/exit markers come from `trades[].entry_time/exit_time`
(`analysis.proto:80-81`) with y resolved by **nearest-bar lookup within one bar interval**
(exact-match would silently drop the forced-close trade patched at `servicer.py:762-763`);
tooltips show symbol/side/qty/entry/exit/P&L (FR-4). If a result has no per-bar equity, the chart
area shows an explicit no-curve-data state — there is **no** trades-cumulative fallback (a
near-dead second derivation path; AC-5). A new `src/lib/protoTime.ts` consolidates the 7×-inlined
proto-Timestamp→Date conversions (DRY guard rail; unit-testable).

**Config.** `analysis.backtest.detail_retention_per_strategy` (int, default 20) read at insert
time via the `get_int` call-site pattern (`servicer.py:269`); declared in
`services/xstockstrat-analysis/CLAUDE.md` § config table (with the zero-trap note) and the root
CLAUDE.md recently-added-keys table (C-05). Docs step is in scope.

**Testing (C-08/P-06).**
- analysis: `tests/test_backtest_details_repo.py` (AsyncMock-pool SQL/binds incl. eviction DELETE
  + clamp); servicer additions via `make_servicer()` (`tests/test_analysis_servicer.py:25-33`):
  OK persists detail / INSUFFICIENT doesn't; diagnostics carry equity; effective initial_capital;
  `GetBacktest` DB hit / NOT_FOUND; **AC-4 parity test** asserting the seven `ListBacktests`
  metrics equal the deserialized detail's fields.
- UI unit: `src/lib/equityCurve.test.ts` (per-symbol series, normalization, marker nearest-bar
  lookup incl. forced-close, no-equity guard), `src/lib/protoTime.test.ts`.
- E2E (`e2e/insights/backtest-coverage.spec.ts` + `e2e/mock-backend.ts:396-398,529,554`): open
  `bt-hist-2` → metrics + time-axis chart + marker testids; `bt-hist-1` → NOT_FOUND empty state
  (AC-3); fresh-run-clears-selection assertion; one shared fixture object feeds both
  `listBacktests` and `getBacktest` mocks (structural parity).

## Rejected Alternatives

- **Memory-first `GetBacktest` (`self._backtests` then DB)** — rejected: dict stores INSUFFICIENT
  results unconditionally (`servicer.py:437`), holds colliding strategy_id keys (`:439`), and
  never evicts — three restart-dependent semantics carve-outs to save ~1ms per open.
- **JSONB payload** — rejected: `MessageToDict` raises on NaN/Inf (ledger 2026-07-21) and
  `profit_factor` is legitimately `inf` on no-loss runs; BYTEA serialized proto round-trips
  exactly what the fresh run returned.
- **Normalized rows (per-trade/per-bar tables)** — rejected: pure read-back payload no query
  inspects; row mapping code both ways for zero benefit given the double size bound
  (≤504 bars/symbol × ≤20 runs/strategy).
- **Free-standing detail table (no FK)** — rejected: an orphan detail (summary insert failed)
  would silently occupy a retention slot and evict a real listed run (C-10(b)).
- **Route `/insights/strategies/[id]/runs/[backtestId]`** — rejected: triggers C-10(a)
  nav-reachability burden with no FR requiring deep links; in-page state suffices.
- **Trades-cumulative equity fallback** — rejected: near-dead second derivation path (every
  persisted detail has per-bar equity); renders garbage when `initialCapital` unset (AC-5).
- **Run-level aggregate portfolio curve** — rejected as impossible-honestly: the engine compounds
  symbols sequentially (`servicer.py:293-334`); no true portfolio-equity-at-t exists. Recorded so
  future features don't re-litigate.
- **Summary-sourced metrics grid for no-detail rows** — rejected: creates a second metrics render
  path (AC-5); the Past Runs row already displays the summary metrics.

## Open Risks

- [ ] BYTEA couples storage to proto wire compatibility: a future renumber/retype of
      `BacktestResult`/`BarDiagnostic` fields would corrupt old blobs silently. Guarded by
      `buf breaking` on every PR (C-09); note added to the proto step — address at proto step.
- [ ] Eviction and insert are two statements without a transaction (repo pattern has none today);
      a crash between them leaves ≤1 extra row until the next insert evicts it — accepted;
      re-check at the analysis service step.
- [ ] `BacktestRunSummary` has no "has detail" flag — the UI discovers a legacy/evicted row only
      on open (NOT_FOUND). Acceptable UX per FR-6; revisit only if users report confusion —
      address post-launch if ever.

## Constitution Rules Touched

- `C-01` — honored: every claim above cites recon.md `path:line` evidence.
- `C-04` — honored: no new enums; new fields are doubles. No closed value set introduced.
- `C-05` — honored: key named `analysis.backtest.detail_retention_per_strategy`, default 20
  declared in service CLAUDE.md + root CLAUDE.md; read via ConfigWatcher, never hardcoded.
- `C-07` — honored: migration `008_backtest_details.up.sql` + `.down.sql`, next after 007.
- `C-08`/`P-06` — honored: paired test steps for analysis and UI; red-before-green at execute.
- `C-09` — honored: proto step runs `buf lint` + `buf breaking` + `./scripts/buf-gen.sh`;
  paired frontend build check.
- `C-10(a)` — honored: in-page state, no new route; nav untouched (detail page already reachable
  from `/insights/strategies` list).
- `C-10(b)` — honored: FK couples detail⇒summary existence; AC-4 value-parity test; single
  `completed_at` source of truth; DB-only read path removes memory/DB divergence.
- `F-01` — honored: new migration only; 001–007 untouched.
- `F-06` — honored: detail repo reuses the existing shared pool (`DB_POOL_MAX=2`); budget
  table unchanged.
- `F-07` — honored: retention limit comes from the config service, clamped, never hardcoded.
- `P-03` — honored: the no-detail-row UX narrowing (empty state only) is surfaced as a recorded
  decision, not silently assumed; adversary objection 12c noted in context.md.

# Design: fix-indicator-pane-warmup

**Created**: 2026-11-15
**Rounds**: 5 (full; termination: approved)
**Approved by**: user @ 2026-11-15 (design gate, round 5, verbatim "Agreed")
**Grounded in**: recon.md
**Debate register**: debate.md

---

## Chosen Approach

Citation note: `recon.md:N` points at the dossier line that carries the code `path:line`. Citations
given as a bare code `path:line` were added during the debate (register evidence cells) and are not
in recon.md; the mediator re-verified only the items listed under "Mediator checks" in the round-5
entry of `context.md`. `/sdd-spec` re-greps every one (C-01).

**Root cause (operator decision, D-1).** The missing warm-up prefix is in the UI request, not the
analysis series builder. The page fetches exactly 200 bars and sends those same closes to
`GetIndicatorSeries`, which computes only on what it is given (recon.md:19-34). No compute change is
needed for FR-1.

**Terms.** W = bars drawn (`CHART_WINDOW_BARS = 200`). D = bars fetched (the history depth).
P = a component's first-value bars. H = bars the page actually got back.

### 1. Proto — one additive field (D-2, D-7)

- `int32 first_value_bars = 5` on `ComponentSeries` (next free field, recon.md:139-142).
- The field comment states: bars of history the component needs for its first value; one value per
  component (a multi-series component uses its earliest series); 0 means no warm-up or unknown, and
  the UI never shows "Not enough history" for 0 (fail-open).
- The request comment at `analysis.proto:806-808` (recon.md:30-32) is rewritten: the page sends the
  drawn window plus a history prefix; the server still never re-fetches the evaluated symbol's bars.
- No request field and no server-side trim.

### 2. Analysis — declare P, compute nothing new (D-7, D-8, D-9, D-17)

- A `first_value_bars(...)` helper in `app/services/warmup.py` beside `builtin_lookback_bars`
  (recon.md:100-104), computed directly: SMA/BB = period, RSI/ATR = period + 1, STOCH = period,
  EMA/MACD = 1, VWAP = 0.
- `source_symbol`, FUNDAMENTAL and fundamentals-only custom formulas report 0. Other custom formulas
  report `warmup_period + 1` when declared, else 0 (basis: `indicators.proto:174`).
- Formula `warmup_period` comes through an optional `warmups` out-param on `_formula_fundamentals`,
  from its existing `GetFormula` call (`servicer.py:1914-1947`). No second pass.
- The handler sets the field where it builds each `ComponentSeries` (recon.md:73-74).
- A pytest pin holds `first_value_bars + _CROSSOVER_LOOKBACK == builtin_lookback_bars` for
  SMA/BB/RSI/ATR.

### 3. Config — D is one seeded key (D-18, D-29, D-30)

- Key `chart.indicator_history_bars`, namespace `ui`, global scope, int, default 200.
- One config seed migration `NNN_ui_chart_history_bars` (050 as of round 5; the number is resolved
  at execute time). It seeds the staging and production rows at 200 with `ON CONFLICT … DO NOTHING`,
  following `services/xstockstrat-config/migrations/023_ui_performance_keys.up.sql:17-32`.
- Write bound `minValue: 200, maxValue: 1000` in `SCALAR_BOUNDS_REGISTRY`
  (`services/xstockstrat-config/src/grpc/configServiceImpl.ts:114`). 1000 is the operator's
  signed-off ceiling; going above it needs a new design pass.
- The key description (migration and the UI `CLAUDE.md` config table) says DigitalOcean must stay at
  200 and that a raise needs the runbook lock gate first.
- Environment scoping is not used: both deployments run `staging` and differ only in which config
  database they read.
- This is the one key and one migration the amended product-spec allows (operator sanction,
  context.md "product-spec amendment" session).

### 4. UI — read D, fetch D, draw W (D-3, D-4, D-10, D-14, D-19)

- D is read one-shot through `traderConfigClient.getConfig({ namespace: 'ui' })`
  (`src/lib/traderConfigClient.ts:7-8`, forward at `src/lib/traderBff.ts:168-169`). No new route and
  no `WatchConfig`. The read uses a short timeout and `staleTime: Infinity`.
- A pure `readHistoryBars` in `src/lib/indicatorChart.ts` falls back to `DEFAULT_HISTORY_BARS = 200`
  on absence, wrong type, error or timeout, and clamps to
  [`CHART_WINDOW_BARS`, `MAX_HISTORY_BARS = 1000`].
- `loadBars` (recon.md:43) waits for the config read to settle, then requests `pageSize: D` with no
  `range.start` — the newest-page read (recon.md:107-108, recon.md:192-194).
- The candlestick draws the last W bars. All D closes and times go to `GetIndicatorSeries`.
- One slice seam: `IndicatorSection` (recon.md:50) calls a pure `windowIndicatorSeries` in
  `src/lib/indicatorChart.ts`. It takes times and H from the response, tail-slices every series to W
  (recon.md:167-170), and returns the windowed components, the windowed times and the set of
  insufficient-history components together. It receives the clamped D actually sent, so
  `historyExhausted = series.times.length < D`.
- The query key (recon.md:52-53) adds the last bar's time as a string.
- Gap rendering reuses `toLineData` unchanged (recon.md:92-94).

### 5. UI — "Not enough history" pane (D-6, D-11, D-12)

- The state fires for a component only when the bars page came back short (history exhausted),
  there is no error, and P > H. A full page degrades to leading gaps instead.
- It is a non-error, non-chart pane gated through `isChartable` (recon.md:56-57, recon.md:97-99),
  rendered with `Eyebrow` + `EmptyState`, testid `indicator-panel-insufficient`. Other components in
  the set render normally.

### 6. Marketdata — lock-budget breach counter (operator decision; D-16, D-22)

- Counter `marketdata.ohlcv.out_of_memory_errors`, label `op` in
  {`bars`, `recent_bars`, `bars_batch`, `insert_bars`}. It counts SQLSTATE 53200.
- One `observeLockBreach(ctx, op, err) error` passthrough in
  `internal/repository/marketdata_repo.go` wraps every returned error in `QueryBars`,
  `QueryRecentBars`, `QueryBarsBatch` and `InsertBars`, including the `rows.Err()` path.
- The marketdata `CLAUDE.md` § Observability records that an increment on `marketdata.ohlcv` is read
  as lock-table exhaustion and that any other out-of-memory cause also counts.

### 7. Per-deployment depth and the lock budget (operator decisions; D-20, D-24, D-25)

| Deployment | D | Implicit window (recon.md:85-86) | Locks per scan | Budget | Result |
|---|---|---|---|---|---|
| DigitalOcean (shared DB) | 200 | 600 days | at most 2,400 | 9,600 at 4 scans of 25,600 | unchanged from today |
| Homelab (own DB) | 1000 | 3000 days | at most 404 (101 thirty-day chunks × 4) | 28,280 at c = 70 of 71,680 | passes |

- Homelab budget: `max_locks_per_transaction` 1024 × (`max_connections` 70 + 0 prepared) = 71,680
  (`homelab-edge` `roles/db_host/defaults/main.yml:12-13`).
- 1-day chunks on the homelab are possible only after a restore from a DigitalOcean dump. They fail
  the inequality and escalate to the operator.
- **What a DigitalOcean user sees at D = 200:** the same bars as today. On a full page, SMA200 is
  still a single dot with no notice (operator: "200 bars for DO is fine"). AC-2 and AC-4 hold on
  both deployments. AC-1 and AC-3 hold only where D ≥ W + P − 1, which is the homelab at 1000.

### 8. Homelab launch — runbook section "Homelab deep indicator history" (D-26, D-27, D-28)

Added to `docs/runbooks/ohlcv-lock-budget-tuning.md`. A deploy alone seeds 200 on the homelab, where
the defect was reported, so the fix arrives there only through these steps.

Preconditions (read-only):

- `homelab-edge` `verify` is green after PR #79 is applied; it asserts
  `max_locks_per_transaction` = 1024 (`roles/db_host/tasks/verify.yml:20-30`). The runbook names
  this path.
- One `psql` read over SSH per `docs/runbooks/operator-db-access.md`: `SHOW max_connections;`,
  `SHOW max_prepared_transactions;` and the chunk-width query. Expected 70 / 0 / 30-day chunks.
- `list_config_keys ui` shows `chart.indicator_history_bars` (the seed migration is applied).
- A differing value means recompute. A failure escalates to the operator; do not silently ship 200.

Launch steps, in order:

1. `set_config` namespace `ui`, key `chart.indicator_history_bars`, value 1000 through the homelab
   MCP, with `create_key` false and an admin session; then `get_config`. A NOT_FOUND means the
   migration is missing; do not create the key by hand.
2. Reload the LYFT symbol page (an open tab keeps 200) and confirm an SMA200 line draws.
3. Observation, not a pass/fail load test: after loading several deep-history symbol pages, check
   that `marketdata.ohlcv.out_of_memory_errors{op="recent_bars"}` shows no increase or is absent.
   Positive control: `GetBars` spans or `marketdata.db.pool.empty_acquire_wait` show the reads ran.

Only the homelab `staging` row is set.

### 9. Tests

- pytest: `first_value_bars` per family, the 0 cases, the pin in section 2; handler cases in
  `TestGetIndicatorSeries` (recon.md:115-117).
- Go: 53200 injected through `rows.Err()` counts; another error does not.
- vitest (recon.md:109-110): AC-1..AC-4 with D and W passed explicitly (W = 190 and 100, AC-1 and
  AC-3 at D = 1000); a stale-cache alignment case; `readHistoryBars` for absent, wrong type, below
  W, above 1000 and valid 1000; a D = 200 full page gives leading gaps and no FR-2.
- e2e (recon.md:111-114): fixtures mock the `ui` config read at 1000 for the AC-1 path and leave it
  absent for the default path, with INVENTORY rows; assert the outbound `pageSize` equals the
  resolved D.
- Config: a bounds test for the registry entry; the reader entry in `scripts/config-wiring.json`
  (and `scripts/config-wiring-stored.json` if the checker requires it).
- `acceptance.feature` AC-1 and AC-3 preconditions gain "with the configured history depth of 1000
  bars".

### Build order and consumer surface

Proto → analysis → marketdata counter → config migration and bounds → UI reader and seam → pane →
e2e → runbook and `CLAUDE.md` updates → homelab launch.

Consumer surface (C-14): the `/trader` symbol page → Overview indicator panes in `xstockstrat-ui`.
No Agent tool calls `GetIndicatorSeries` (recon.md:149-151). `/trader` now reads the `ui` config
namespace; the UI `CLAUDE.md` records this.

## Rejected Alternatives

- `R-1` UI-side lookback table, or sizing the fetch from client strategy params — rejected because
  it duplicates `warmup.py`, and a formula's `warmup_period` is known only to analysis.
- `R-2` Widened `range.start` on `GetBars` — rejected because it returns the oldest page.
- `R-3` Server-side prefix fetch in `GetIndicatorSeries` — rejected because it reverses feature
  125's "no server re-fetch" contract.
- `R-4` Request field `window_bars` with a server-side trim — rejected because it adds a second
  proto field for a slice one UI seam can do.
- `R-5` Converged P (3p+1) for EMA/MACD as the FR-2 threshold — rejected because it contradicts the
  spec's first-value P and hides lines that render today.
- `R-6` Slice seam in the `useIndicatorSeries` `select` — rejected because the hook would need page
  knowledge.
- `R-7` `CardNotice` for the insufficient-history pane — rejected because it nests a Card inside
  the Indicators Card.
- `R-8` Slicing response series against the page's `times` prop — rejected because a stale cached
  series misaligns the panes by one bar per new bar.
- `R-10` Server-guided escalation (small first D, one refetch) — rejected because it needs
  sticky-depth state and a single fixed D was accepted.
- `R-11` A `marketdata.ohlcv.scan_window_days` histogram — rejected because the operator asked for
  a breach counter and the histogram is not needed.
- `R-12` Write bound `maxValue: 5000` — rejected because one config edit could exceed the operator's
  sign-off on the shared DigitalOcean cluster.
- `R-13` A homelab-only env var or build arg carrying D — rejected because it keeps a
  per-deployment value outside the config service.
- `R-14` Environment scoping to separate DigitalOcean from the homelab — rejected because both run
  `APPLICATION_ENV` staging.
- `R-15` Timeframe-aware slack in `defaultBarLookback` — rejected because it changes a shared helper
  for every implicit-window caller and is not needed at either depth.
- `R-16` Branching on the `HOST_PROVIDER` env — rejected because it puts a per-deployment value in
  source and turns an OTel resource attribute into behaviour.
- `R-17` A readiness cycle as the launch check for the counter — rejected because readiness uses the
  fixed 400-day window and an absent lazily-bound series cannot be told from a flat one.
- `R-18` A "raise `max_locks_per_transaction` to 512" fallback — rejected because 1024 is already
  the asserted homelab value; a lower live value means recompute and escalate.
- `R-19` A runbook procedure for a later homelab production deployment — rejected because the
  operator stated there are no production instances.

`R-9` (shrinking D below 1000) is not locked: the operator reopened it (P-3), and 200 is now the
default with 1000 as the ceiling.

## Open Risks

- [ ] The homelab pass rests on homelab-edge PR #79 being applied (merged, not applied). On stock
  settings the budget is 4,480 and passes only at 11 or fewer concurrent scans — checked at the
  homelab launch step (runbook precondition).
- [ ] 30-day chunks on the homelab are assumed until the chunk query runs; a DB restored from a
  DigitalOcean dump would block the raise — homelab launch step.
- [ ] The fix reaches the homelab only after a manual `set_config`; if the launch steps are skipped
  the homelab keeps the single dot — homelab launch step.
- [ ] DigitalOcean users still see SMA200 as a single dot on a full 200-bar page, with no notice —
  operator-accepted; no step.
- [ ] The 1000 bound cannot tell deployments apart; an admin could set 1000 on DigitalOcean. Guarded
  only by the key description, the runbook and the counter — config migration step and runbook step.
- [ ] Other workloads on the homelab Postgres share the lock table; their per-backend lock use was
  not measured — observed at launch step 3.
- [ ] `max_connections` and `max_prepared_transactions` are not asserted by homelab-edge `verify`;
  only the runbook's `psql` read observes them — runbook step.
- [ ] The runbook depends on a playbook in a second repo; a rename there silently breaks the
  precondition — runbook step names the path.
- [ ] A 53200 from another cause also increments the counter, and the counter detects a breach
  without preventing one — marketdata counter step (documented in its `CLAUDE.md`).
- [ ] The config-wiring checker's requirements for the new reader and the seeded row are unread
  (O-29) — `/sdd-spec` reads `scripts/config-wiring.test.mjs` before writing either entry.
- [ ] The migration number may collide with a peer feature in this batch (O-30) — re-checked at the
  config migration step.
- [ ] Launch step 1's preconditions and the `psql` read were adopted by the mediator but not
  confirmed by the proposer (O-31, O-32) — runbook step.
- [ ] The product-spec was amended after approval without re-review, and the owner + config-team
  approval for the new key is still to be obtained — before the config migration step merges.
- [ ] The config read adds a round trip before the first bars request; analysis compute and the
  polled payload grow with D on the homelab; marketdata pool hold time grows there too (signal
  `marketdata.db.pool.empty_acquire_wait`) — observed at launch step 3.
- [ ] Accepted residuals: VWAP anchor drift from sending D closes; a transient false "Not enough
  history" from a short live marketdata page; a `source_symbol` benchmark with too little history of
  its own never shows the state — no step.
- [ ] Most `path:line` citations carried from rounds 2–4 were not re-verified by the mediator —
  `/sdd-spec` re-greps all of them.

## Constitution Rules Touched

- `P-02` — honored by: the mediator passed only synthesized state between proposer and adversary in
  all five rounds.
- `P-03` — honored by: the spec/design conflict over the config key was escalated to the operator,
  not worked around; unread items stay listed as open risks.
- `P-04` — honored by: the product-spec amendment and this approval each have a `feature.md` Status
  History row and a `context.md` entry.
- `C-01` — honored by: `/sdd-spec` re-greps every citation; this document marks which are unverified.
- `C-03` — honored by: no new outbound backend call; the UI config read uses the existing BFF
  forward and its header handling.
- `C-05` — honored by: the key is namespace-relative (`chart.indicator_history_bars` under `ui`) and
  seeded by a config migration.
- `C-07` — honored by: `NNN_ui_chart_history_bars.up.sql` + `.down.sql`, NNN = last config
  migration + 1 at execute time.
- `C-08` — honored by: paired pytest, Go and config bounds tests for each service step.
- `C-12`, `C-13` — honored by: new e2e fixtures live in `e2e/fixtures/` with INVENTORY rows.
- `C-15` — honored by: AC-1..AC-4 each map to vitest and e2e cases; AC-1 and AC-3 name the
  configured depth.
- `C-16` — honored by: see the next section; the one at-risk rule has operator sign-off.
- `C-17` — honored by: the new pane uses `Eyebrow` + `EmptyState` and token colours.
- `C-18` — honored by: one field, one key, one counter, one pure helper per concern; no escalation
  refetch, no histogram, no production runbook prose.
- `F-06` — honored: no new pool or connection; the lock budget is computed per deployment and
  DigitalOcean is unchanged.
- `F-07` — honored: D is a seeded config key, read through `GetConfig` with a fallback constant
  equal to the seeded default; W stays a UI layout constant.
- `PLAT-N1` — honored by: the counter and the config read are best-effort; a failed config read
  degrades to 200 and never blocks the candlestick.

Floor breaches: none.

## Business Rules Touched (C-16)

- EXTEND `@AC-1` "A 200-period average renders across the whole charted window"
  (`acceptance.feature`) — new case added: the precondition names the configured history depth of
  1000 bars; the per-deployment depth is the operator decision of 2026-11-15, round 3.
- EXTEND `@AC-2` "An indicator without enough history says so instead of drawing a dot" — new case
  added: the state fires only on a short page.
- EXTEND `@AC-3` "History equal to the lookback yields a value on the last charted bar only" — new
  case added: the precondition names the configured history depth of 1000 bars; same operator
  decision as AC-1.
- EXTEND `@AC-4` "Only the indicator lacking history reports it; the others still render" — new
  case added: per-component state from `first_value_bars`.
- PRESERVE `@AC-4` "A sparkline warm-up gap renders as null, never NaN"
  (`services/xstockstrat-ui/acceptance/opportunity-live-market-enrichment.feature`) — not regressed
  by: `toLineData` is reused unchanged; no NaN or fabricated 0.
- PRESERVE `platform.feature` rule that `GetBars` does not add a symbol to the marketdata warm set
  (`docs/sdd/business-rules/platform.feature`) — not regressed by: only `pageSize` changes.
- PRESERVE `@AC-1` "A 400-day bars query over the ohlcv hypertable locks few enough chunks to
  succeed" (`services/xstockstrat-marketdata/acceptance/fix-ohlcv-chunk-lock-oom.feature`, feature
  153) — not regressed on DigitalOcean, which stays at 200. **PRESERVE-at-risk** on any deployment
  that runs the 1000-bar depth; signed off by user @ 2026-11-15, design gate round 3 (context.md).

No CHANGE lines.

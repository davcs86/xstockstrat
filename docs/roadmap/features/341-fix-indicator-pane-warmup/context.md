# Context Log: fix-indicator-pane-warmup

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-15 (/sdd-triage)

- Bug reported via defect report `docs/reports/2026-11-15-indicator-panel-sma200-single-point-defect.md`: Long-lookback indicator pane renders a single point
- Source: operator report from staging (homelab) on 2026-11-15, with screenshots; root causes from read-only recon the same day
- Severity: SEV-3
- Routed to SDD path (Track C)
- Created: feature.md, product-spec.md, acceptance.feature (regression scenario), context.md
- Affected services (from report): `xstockstrat-ui`, `xstockstrat-analysis` (candidate — series builder)
- Root cause hypothesis: see product-spec.md § Root Cause Hypothesis
- Recommended design depth: full → `/sdd-design fix-indicator-pane-warmup` (rationale: two candidate services (xstockstrat-ui consumer surface + xstockstrat-analysis series builder) and root cause under investigation — the ≥2-services escalate signal)
- Development branch: feature/fix-indicator-pane-warmup

## Session 2026-11-15 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Result: PASS WITH WARNINGS (0 fails, 4 warnings, 0 floor breaches).
- Warnings:
  - Definition of P (FR-1): "bars needed to produce the first value" is 1 for indicators that emit
    from their first bar (EMA, MACD, VWAP; `services/xstockstrat-analysis/docs/warmup.md`), while the
    platform treats their convergence as 3× period, and custom formulas declare a separate
    `warmup_period`. Design must state which P applies. Recorded in product-spec.md under
    Functional Requirements; all four scenarios use SMA, where P is unambiguous.
  - Root cause is not traced (report confidence low). Accepted for a bug spec by operator decision.
    Recon must record its finding (UI request vs analysis series builder) here before any fix is
    designed.
  - Coverage depth: scenarios use daily SMA only. No scenario covers a multi-output or
    custom-formula indicator, or a non-daily timeframe. Recorded in product-spec.md as a
    design-time item.
  - "Not enough history" is the only user-facing copy. The spec says it is shown per pane; whether
    that means per indicator inside a combined pane is to be firmed up at design.
- Overlap findings: CLEAN (no config-key, proto field-number or migration collision). Low-risk
  shared context, to re-check at impl-spec overlap time:
  - Peer 342-chart-series-palette (`draft`) touches the same indicator chart and legend on the
    symbol page. If both edit `src/lib/indicatorChart.ts` or
    `src/components/trader/IndicatorPanels.tsx`, expect a textual merge conflict; add a soft
    rebase-order row to `merge-order.md` at that point. No entry is required now.
  - If FR-1 lands in the analysis `GetIndicatorSeries` builder, `app/handlers/servicer.py` is shared
    with 308-fix-analysis-per-symbol-isolation and 330-fix-live-enrich-ttl-seed (disjoint line
    ranges; rebase only).
  - Peers 339, 340, 343, 344: same route family at most; no indicator-pane, proto, migration or
    config overlap.
- Recommended design depth: full (two affected services; root cause not traced).

### OPERATOR DECISIONS (binding, recorded 2026-11-15)

- Root cause is not traced; recon must determine whether the missing warm-up prefix is in the UI request or the analysis series builder before any fix is designed.

## Session 2026-11-15 — sdd-batch design gate (round 2)

`/sdd-design fix-indicator-pane-warmup` (full) is halted at its approval gate after round 2 (gate
policy: halt). design.md is not written and status.md is unchanged (`spec-ready`). The register is
in `debate.md` (D-1..D-13, R-1..R-8, O-1..O-17).

### Open Threads

- **Approach (Option B, D-1..D-13).** Root cause is the UI request: the page sends only the 200
  drawn closes, so analysis has no warm-up prefix. Fix shape: one additive proto field
  `first_value_bars = 5` on `ComponentSeries`, filled by a new analysis helper beside
  `builtin_lookback_bars`; the page requests a larger newest-page `GetBars` (`HISTORY_BARS`, D),
  draws only the last `CHART_WINDOW_BARS = 200` (W), and slices series, times and the insufficient
  set together in one pure `windowIndicatorSeries` called from `IndicatorSection`. A component
  shows "Not enough history" (`Eyebrow` + `EmptyState`) only when there is no error, P > H and the
  bars page came back short. No compute change, no migration, no config key.
- **Strongest open objection (O-12, blocking).** The value of D is not settled. D = 1000 widens
  every implicit `GetBars` window from 600 to 3000 calendar days on each page load and 300 s poll,
  and widens the staleness/DB-miss Alpaca refetch and upsert to match. Nobody has computed the
  ohlcv AC-1 chunk-lock inequality (`docs/runbooks/ohlcv-lock-budget-tuning.md`) for it. If it
  fails, the choice is a smaller D (e.g. W + 300) or server-guided escalation; the catalog's
  largest first-value P decides.
- **Second blocking objection (O-1).** `windowIndicatorSeries` must take `times` and H from the
  response, not the page's `times` prop, and the last bar's time must join the query key;
  otherwise a stale cached series shifts one bar per new bar. Still to state: how
  `historyExhausted` is paired with the same request.
- **Open, non-blocking.** O-4 (escalation, contingent on O-12), O-7 (multi-series P in the proto
  comment), O-8 (stale-cache vitest), O-13 (pytest pin on `first_valid_index + 1`), O-14 (STOCH
  P = period, proposer to confirm), O-15..O-17 (records for design.md).
- **Floor status.** No Floor breach and no register violation found in either round. No reopen
  petition filed.
- **Uncovered @AC changes.** AC-1, AC-2, AC-3 and AC-4 are EXTEND, none covered by an operator
  decision, so each needs operator sign-off at the gate. Two durable rules are PRESERVE
  (`opportunity-live-market-enrichment @AC-4`; the `platform.feature` GetBars warm-set rule).
- **Not verified.** The mediator did not re-check the `path:line` citations against the tree, and
  feature 125's context.md has not been re-read.
- The relayed operator answers (Q2/Q3) concern other features and the batch flow; they change
  nothing here.

```sdd-batch-design-state
{
  "round": 2,
  "synth": {
    "approach": "Round 2 synthesis: Option B stands (D-1..D-6). The proposal's answers to O-2, O-3, O-5, O-6, O-9, O-10 and O-11 are adopted. Two blocking items remain: the size of D against the ohlcv lock budget (new), and the slice seam's source of `times` (O-1). The mediator did not re-verify any path:line citation; all are carried from the proposal and adversary. Paths are relative to `/home/user/xstockstrat/.claude/worktrees/wf_6bb8993c-4e6-61/`.\n\n**Root cause (operator decision).** The missing warm-up prefix is in the UI request, not the analysis series builder (D-1). No compute change is needed.\n\n**1. Proto (additive).**\n- Add `int32 first_value_bars = 5;` to `ComponentSeries` (`packages/proto/analysis/v1/analysis.proto:819-827`).\n- The field comment must state:\n  - It is the bars of history the component needs to produce its first value.\n  - There is one value per component. For a multi-series component it is the earliest series' first-value bar (see the STOCH item below).\n  - 0 means no warm-up or unknown, and the UI never shows insufficient history for it (fail-open).\n- Rewrite the request comment at `analysis.proto:806-808`: the page sends the drawn window plus a history prefix, and the server still never re-fetches the evaluated symbol's bars.\n- Run `buf lint`, `buf breaking` and `./scripts/buf-gen.sh`.\n\n**2. Analysis.**\n- Add `first_value_bars(comp, formula_warmups, formula_fund_map) -> int` in `services/xstockstrat-analysis/app/services/warmup.py`, beside `builtin_lookback_bars` (`:70`).\n  - `source_symbol`, FUNDAMENTAL, or a custom formula with a `formula_fund_map` hit: 0.\n  - Other custom formula: `declared + 1 if declared else 0`, the same expression as `warmup.py:153`. design.md cites `packages/proto/indicators/v1/indicators.proto:174` as the semantic basis.\n  - EMA/MACD: 1 (`warmup.py:12-17`).\n  - VWAP: 0.\n  - SMA/BB: `period`. RSI/ATR: `period + 1`.\n  - STOCH: synthesis adopts the earliest series (`k`, valid from index `period - 1`, so P = `period`), not `period + 2`. With `period + 2`, an exhausted page with H in [period, period + 1] would hide a `k` line that has values. Proposer to confirm.\n- The helper may delegate to `builtin_lookback_bars`, but that function means \"first usable\" and includes `_CROSSOVER_LOOKBACK` (`warmup.py:58-59`, `:71`). So either compute `first_valid_index + 1` directly, or add a pytest pinning `first_value_bars == first_valid_index + 1` per family (SMA, BB, RSI, ATR, STOCH) and name the dependency in the helper's 2-line comment.\n- Formula `warmup_period`: add an optional out-param `warmups: dict | None = None` to `_formula_fundamentals` (`services/xstockstrat-analysis/app/handlers/servicer.py:1914-1947`), filled from the `GetFormula` response it already fetches (`:1934`). It follows the existing `failures` out-param pattern (`:1915`, `:1941-1942`). There is no second pass.\n- `GetIndicatorSeries` passes `warmups=` at `servicer.py:4548` and sets `first_value_bars=` on the success `ComponentSeries` (`:4621-4625`). The error branch (`:4629-4632`) leaves it 0.\n- Compute, `times=request.times` and the \"no server re-fetch\" contract are unchanged.\n\n**3. UI data.**\n- In `services/xstockstrat-ui/src/app/trader/positions/[symbol]/page.tsx`, add named constants `HISTORY_BARS` (D) and `CHART_WINDOW_BARS = 200` (W) beside the literal at `:256`.\n- **The value of D is not settled.** The proposal's 1000 is not accepted until the lock-budget objection is answered (section 6).\n- `loadBars` requests `pageSize: HISTORY_BARS` with no `range.start` (D-3) and stores `historyExhausted: res.bars.length < HISTORY_BARS`.\n- The candlestick draws `mapBars(withTime.slice(-CHART_WINDOW_BARS))` (replaces `page.tsx:269`).\n- There is no escalation refetch in the current approach.\n\n**4. Single slice seam (correction to the proposal).**\n- The seam is `IndicatorSection` (`page.tsx:1324-1353`). Inside `useMemo` it calls one pure function in `services/xstockstrat-ui/src/lib/indicatorChart.ts`:\n  `windowIndicatorSeries({ components, times, windowBars, historyExhausted }) -> { components, times, insufficient }`.\n- `times` must come from the response (`series.times`, which echoes `request.times` at `servicer.py:4634-4636`), not from the page's `times` prop. H is taken from the same response. This way values, axis and H come from one request.\n- The proposal's version slices cached values against the page's newer `times`. On a full page `closes.length` is constant, so the query key (`services/xstockstrat-ui/src/hooks/useIndicatorSeries.ts:16`) never refreshes and every pane point shifts one bar per new bar.\n- Also add the last bar's time to the query key so a new bar triggers a refetch (fails.md 2026-09-16). This brings the \"pre-existing, out of scope\" stale-key item into scope, because the proposal's alignment claim depends on it.\n- Still open for the proposer: `historyExhausted` comes from the bars load while the series comes from an older cached request. State how the two are paired, for example by deriving exhaustion from the response `times.length < HISTORY_BARS`.\n- A component is insufficient only when `!error && firstValueBars > H && historyExhausted`.\n- `IndicatorPanels` receives only the windowed components and times plus `insufficient`.\n\n**5. UI state.**\n- `isChartable(c, insufficient)` (`services/xstockstrat-ui/src/components/trader/IndicatorPanels.tsx:19-21`) excludes insufficient components.\n- The render map (`IndicatorPanels.tsx:170-185`) gets a third branch: `Eyebrow` plus `EmptyState` (`services/xstockstrat-ui/src/components/shared/EmptyState.tsx:7`), title \"Not enough history\", description \"Needs {P} bars; {H} available.\", testid `indicator-panel-insufficient`.\n- `EmptyState` is used instead of `CardNotice`, which would nest a Card inside the Indicators Card (`page.tsx:1358`).\n\n**6. D sizing (blocking, unresolved).**\n- `defaultBarLookback` is `pageSize x interval x 3` (`services/xstockstrat-marketdata/internal/service/marketdata_service.go:467-477`). D = 1000 widens the implicit read from 600 to 3000 calendar days on every page load and every 300 s poll (`page.tsx:340`).\n- It also widens the staleness/DB-miss Alpaca refetch and upsert to the same window (`marketdata_service.go:350`, `:409`, `:417`).\n- design.md must compute the AC-1 lock inequality from `docs/runbooks/ohlcv-lock-budget-tuning.md:41-52` (1-day chunks at `:118-121`) for the chosen D.\n- If the inequality fails, choose one of:\n  - A smaller D, for example W + 300 = 500. Cost: the \"P > D - W + 1 shows unexplained leading gaps\" hole widens.\n  - Server-guided escalation (see the open objections).\n- The catalog check for the largest first-value P decides between them.\n\n**7. Recorded in design.md as accepted.**\n- VWAP anchor drift (O-5).\n- Transient false FR-2 from a short live page (O-10).\n- Why D is not an F-07 config value (O-11).\n- `source_symbol` fail-open: a benchmark with too little history of its own never shows FR-2.\n- Analysis compute per request grows with D.\n\n**8. Tests.**\n- pytest (`services/xstockstrat-analysis/tests/test_warmup.py`, `tests/test_analysis_servicer.py:7057`):\n  - EMA/MACD = 1, SMA200 = 200, RSI14 = 15.\n  - STOCH per the earliest-series rule.\n  - Formula `warmup_period` 9 gives 10.\n  - Fundamentals-only formula, `source_symbol` and the error component give 0.\n  - The `first_valid_index + 1` pin per family.\n- vitest (`services/xstockstrat-ui/src/lib/indicatorChart.test.ts`):\n  - W = 190 (AC-1 H = 400, AC-3 H = 200).\n  - W = 100 (AC-4 H = 150 with SMA200 + SMA20).\n  - AC-2 H = 150.\n  - Values-to-times alignment.\n  - A full page never produces FR-2.\n  - A stale-cache case: the response `times` differ from the page's bars.\n- e2e (`services/xstockstrat-ui/e2e/trader/position-detail.spec.ts:482-530`, `e2e/mock-backend.ts:1417`, `e2e/fixtures/indicatorSeries.ts`):\n  - W = 200 with 400/200/150-bar fixtures and INVENTORY rows.\n  - Assert the outbound `pageSize` equals `HISTORY_BARS`.\n  - Wait for `.tv-lightweight-charts` before asserting.\n\n**Build order.** Proto + buf-gen; analysis helper, out-param, servicer wiring and pytest; `windowIndicatorSeries`, the `loadBars` D/W change, the query key and vitest; the `IndicatorPanels` insufficient branch; e2e fixtures + INVENTORY.\n\n**Touchpoints.** One additive proto field. No migration and no config key. The service edges are unchanged.",
    "open_objections": [
      {
        "text": "NEW (P-03/perf, F-06-adjacent): `HISTORY_BARS = 1000` widens every implicit `GetBars` window from 600 to 3000 calendar days (`marketdata_service.go:467-477`, `:310`, `:327`) on every page load and 300 s poll, and widens the staleness/DB-miss Alpaca refetch and upsert to the same window (`:350`, `:409`, `:417`). design.md must compute the AC-1 chunk-lock inequality (`docs/runbooks/ohlcv-lock-budget-tuning.md:41-52`, `:118-121`) for D, or size D to the need (e.g. W + 300), and record the trade-off against the 'P > D - W + 1 shows unexplained gaps' risk. This is the feature 141/153 SEV-2 class.",
        "blocking": true
      },
      {
        "text": "O-1 (still open): the seam slices response series against the page's `times` prop. On a full page `closes.length` is constant, so the query key (`useIndicatorSeries.ts:16`) keeps a stale response and the values shift against newer times. `windowIndicatorSeries` must take `times` and H from the response (`series.times`, `servicer.py:4634-4636`). The last bar's time should join the query key. The proposer must state how `historyExhausted` is paired with the same request, and add a stale-cache alignment vitest.",
        "blocking": true
      },
      {
        "text": "O-4 (still open, now contingent): 'FR-2 only on a short page, no escalation' is accepted as the current approach. It can close only once the D-sizing objection resolves without escalation. If the lock-budget check forces a small first-load D, server-guided escalation (one refetch when the page is full and `max(first_value_bars) > H - W + 1`) returns and needs the sticky-depth design O-4 asked for.",
        "blocking": false
      },
      {
        "text": "O-7 (still open): the proto field comment must also say how P is chosen for a multi-series component (earliest series' first-value bar). The three comment rewrites (`analysis.proto:806-808`, `useIndicatorSeries.ts:6-7`, `page.tsx:132-133`) are accepted.",
        "blocking": false
      },
      {
        "text": "O-8 (still open): the test plan is accepted but must add the stale-cache alignment case (response `times` differ from the page's bars).",
        "blocking": false
      },
      {
        "text": "NEW (C-18): `first_value_bars` equals first-valid-index + 1 only because `_CROSSOVER_LOOKBACK` is 1 (`warmup.py:58-59`, `:71`). Add a pytest pinning `first_value_bars == first_valid_index + 1` per family (SMA, BB, RSI, ATR, STOCH) and name the dependency in the helper comment, or compute it directly.",
        "blocking": false
      },
      {
        "text": "NEW: STOCH P = period + 2 overstates FR-2. `k` is valid from index `period - 1` (`warmup.py:93`), so an exhausted page with H in [period, period + 1] would hide a `k` line that has values. Define P as the earliest series' first-value bar. The synthesis adopts this; the proposer must confirm.",
        "blocking": false
      },
      {
        "text": "NEW (P-03/perf): analysis compute per request grows with D. Every `ComputeIndicator`/`ExecuteFormula` call gets D closes (`servicer.py:4575`), and benchmark components fetch a longer range (`servicer.py:2044-2048`). Record the accepted cost in design.md.",
        "blocking": false
      },
      {
        "text": "NEW: `source_symbol` components report 0, so a benchmark with too little history of its own never shows FR-2. Record this as an accepted residual in design.md.",
        "blocking": false
      },
      {
        "text": "NEW: formula semantics should cite `packages/proto/indicators/v1/indicators.proto:174` ('bars of warm-up before this formula's outputs are valid') in design.md as the basis for P = `warmup_period + 1`, instead of listing it as unverified.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "AC-1",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-2",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-3",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-4",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "opportunity-live-market-enrichment @AC-4",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "platform.feature GetBars warm-set rule",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "UI-side lookback table, or sizing D from client strategy params (R-1). It duplicates `warmup.py`, and formula `warmup_period` is known only to analysis.",
      "Widened `range.start` on `GetBars` (R-2). It returns the oldest page.",
      "Server-side prefix fetch for the evaluated symbol (R-3). It reverses feature 125's 'no server re-fetch' contract and needs an operator decision.",
      "Request field `window_bars` with a server-side trim (R-4). It would also be the only way to mitigate VWAP anchor drift, so the drift is accepted instead.",
      "Converged P (3p+1) for EMA/MACD as the FR-2 threshold. It contradicts the spec's first-value definition, hides lines that render today, and would need operator sign-off. Both sides now agree on first-value P.",
      "Slice seam in the `useIndicatorSeries` `select`. `historyExhausted` and W live in the page, so the hook would need page knowledge. The adversary agrees, provided the `IndicatorSection` seam reads `series.times`.",
      "`CardNotice` for the 'Not enough history' pane. It wraps its own `Card` (`CardNotice.tsx:13`) and would nest inside the Indicators `Card` (`page.tsx:1358`). `EmptyState` is used.",
      "Slicing response series against the page's `times` prop (the proposal's r2 seam). Values and axis come from different requests whenever the cached series is stale.",
      "Not rejected, held as runner-up: server-guided escalation (small first-load D, one refetch sized from the server's `first_value_bars`). It is not R-1, but it reintroduces sticky-depth state. It is adopted only if the lock-budget check fails for a single fixed D.",
      "Not rejected, held as an option: a smaller fixed D (e.g. W + 300). It bounds the lock and Alpaca cost but widens the unexplained-gaps hole. It wins if the catalog has no first-value P above about 300."
    ],
    "open_risks": [
      "The value of D is unresolved. D = 1000 has not been checked against the ohlcv AC-1 chunk-lock invariant, and the staleness refetch would upsert about 2000 rows across old 1-day chunks roughly once a day per symbol.",
      "Nobody has checked the catalog for a first-value P above D - W + 1 (801 at D = 1000, 301 at D = 500). Such a component shows leading gaps with no notice on a full page, because FR-2 is suppressed and there is no escalation.",
      "`historyExhausted` (from the bars load) and the series response (possibly cached) can come from different loads unless exhaustion is derived from the response.",
      "Adding the last bar's time to the query key changes refetch frequency. Confirm it does not refetch on every 300 s poll when the last bar is unchanged.",
      "`mapBars` was not read by the proposer. It is assumed to accept a sliced `withTime` array.",
      "A short live page from the marketdata staleness or DB-miss refetch can produce one transient false 'Not enough history' (accepted residual).",
      "Displayed VWAP values change because the anchor moves from 200 bars back to D bars back (accepted).",
      "A benchmark (`source_symbol`) with too little history of its own never shows FR-2 (fail-open, to be recorded).",
      "Analysis compute and the polled payload grow in proportion to D.",
      "`first_value_bars` delegating to `builtin_lookback_bars` drifts silently if `_CROSSOVER_LOOKBACK` or the convergence logic changes, unless the pytest pin is added.",
      "Feature 125's context.md has not been re-read, so its recorded contract constraints may be incomplete here.",
      "The mediator did not re-verify the path:line citations against the tree; they are carried from the proposal and adversary."
    ],
    "constitution_rules_touched": [
      "P-02",
      "P-03",
      "C-01",
      "C-03",
      "C-08",
      "C-12",
      "C-13",
      "C-15",
      "C-16",
      "C-17",
      "C-18",
      "F-06",
      "F-07"
    ],
    "rationale": "The proposal honours D-1..D-6, revives no R-1..R-4 variant and files no reopen petition. The adversary found no Floor breach and no register violation.\n\n**Answered and closed.** The proposal concretely answers O-2, O-3, O-5, O-6, O-9, O-10 and O-11, and the adversary's closure guidance agrees:\n- O-2: first-value P, with the field named `first_value_bars`.\n- O-3: fundamentals-only formulas report 0, with a pytest case.\n- O-5: VWAP drift accepted, since mitigation would need the locked R-4.\n- O-6: out-param on the existing `GetFormula`.\n- O-9: `EmptyState`.\n- O-10, O-11: recorded in design.md.\n\n**Still open.**\n- **O-1 (blocking).** The seam is in the right place, but it slices cached response values against the page's newer `times`. On a full page the query key never changes, so the alignment claim fails. The fix is cheap and in scope, and the synthesis adopts it: take `times` and H from the response, and add the last bar's time to the query key.\n- **D sizing (new, blocking).** The 5x wider implicit `GetBars` window was not checked against the ohlcv lock budget. This is the incident class fails.md records for features 141/153. The value of D is therefore unsettled; D-3 and D-5 fix only its form (a named page-size constant), not its number.\n- **O-4.** Open and contingent, because the lock-budget outcome may bring escalation back.\n- **O-7, O-8.** Each needs one small addition.\n\n**Operator decision.** It is honoured: the root cause was located (D-1) before the fix shape. The relayed user request (Q2/Q3) concerns other features and the batch flow, so it changes nothing here.",
    "register_delta": {
      "new_decisions": [
        {
          "text": "P is first-value bars (first valid index + 1), in a field named `first_value_bars`. EMA/MACD = 1 and VWAP = 0. Converged sizing stays backtest-only.",
          "evidence": "`warmup.py:12-17`, `:84`, `:89`, `:111`; the spec defines P as bars to the first value. The adversary said O-2 can close."
        },
        {
          "text": "`source_symbol`, FUNDAMENTAL and fundamentals-only custom formulas (`formula_fund_map` hit) report 0. Other custom formulas report `declared + 1 if declared else 0`.",
          "evidence": "`servicer.py:4576-4604`; `warmup.py:153`; `indicators.proto:174`. The adversary said O-3 can close."
        },
        {
          "text": "Formula `warmup_period` is read through an optional `warmups` out-param on `_formula_fundamentals`, from its existing `GetFormula` call. There is no second pass.",
          "evidence": "`servicer.py:1914-1947` (the `failures` out-param pattern at `:1915`, `:1941-1942`). The adversary said O-6 can close."
        },
        {
          "text": "The single slice seam is `IndicatorSection`, calling a pure `windowIndicatorSeries` in `src/lib/indicatorChart.ts` that returns windowed components, times and the insufficient set together. It is not in the hook's `select`. The candlestick draws the same last W bars.",
          "evidence": "`page.tsx:1324-1353`, `:261-270`; `IndicatorPanels.tsx:65`, `:101`. The adversary agreed with rejecting the hook seam."
        },
        {
          "text": "FR-2 fires only when the bars page came back short (history exhausted), there is no error, and P > H. A full page degrades to leading gaps.",
          "evidence": "`page.tsx:261`; `marketdata_repo.go:181-183`. The adversary did not contest it."
        },
        {
          "text": "The 'Not enough history' pane renders through `Eyebrow` + `EmptyState` with testid `indicator-panel-insufficient`.",
          "evidence": "`EmptyState.tsx:7`; `CardNotice.tsx:13` would nest inside the Card at `page.tsx:1358`. The adversary said O-9 can close."
        },
        {
          "text": "VWAP anchor drift and the transient false FR-2 from a short live page are accepted residuals, recorded in design.md.",
          "evidence": "`warmup.py:108-111` (mitigation would need the locked R-4); `marketdata_service.go:417-427`. The adversary said O-5 and O-10 can close as recorded."
        }
      ],
      "new_rejected": [
        {
          "text": "Converged P (3p+1) for EMA/MACD as the FR-2 threshold, with or without UI head-masking.",
          "why": "It contradicts the spec's first-value definition of P and hides lines that render today. Both sides agreed on first-value P."
        },
        {
          "text": "Slice seam in the `useIndicatorSeries` `select`.",
          "why": "`historyExhausted` and W live in the page, so the hook would need page knowledge. The adversary concurred."
        },
        {
          "text": "`CardNotice` for the insufficient-history pane.",
          "why": "It wraps its own `Card` and would nest inside the Indicators `Card`."
        },
        {
          "text": "Slicing response series against the page's `times` prop.",
          "why": "Values and axis come from different requests when the cached series is stale, so the panes misalign by one bar per new bar."
        }
      ],
      "new_objections": [
        {
          "text": "D sizing against the lock budget: `HISTORY_BARS = 1000` makes the implicit `GetBars` window 3000 days (`marketdata_service.go:467-477`) and widens the staleness refetch and upsert. design.md must compute the AC-1 chunk-lock inequality (`docs/runbooks/ohlcv-lock-budget-tuning.md:41-52`) for D, or shrink D (e.g. W + 300), and record the trade-off against unexplained leading gaps.",
          "blocking": true
        },
        {
          "text": "Pin `first_value_bars == first_valid_index + 1` per family in pytest and name the `_CROSSOVER_LOOKBACK` dependency (`warmup.py:58-59`, `:71`), or compute it directly (C-18).",
          "blocking": false
        },
        {
          "text": "STOCH P must be the earliest series' first-value bar (`k`, P = period), not period + 2, so FR-2 never hides a `k` line that has values (`warmup.py:93`).",
          "blocking": false
        },
        {
          "text": "Record in design.md the accepted growth in analysis compute per request (D closes per component call, `servicer.py:4575`, `:2044-2048`).",
          "blocking": false
        },
        {
          "text": "Record in design.md the `source_symbol` fail-open residual: a benchmark with too little history of its own never shows FR-2.",
          "blocking": false
        },
        {
          "text": "Cite `indicators.proto:174` in design.md as the basis for formula P = `warmup_period + 1`, instead of listing it as unverified.",
          "blocking": false
        }
      ],
      "closed_objections": [
        {
          "id": "O-2",
          "how": "First-value P adopted: EMA/MACD = 1, VWAP = 0, field named `first_value_bars`. No head-masking and no operator sign-off needed."
        },
        {
          "id": "O-3",
          "how": "Fundamentals-only formulas, FUNDAMENTAL and `source_symbol` report 0, with a pytest case."
        },
        {
          "id": "O-5",
          "how": "VWAP anchor drift accepted and recorded in design.md. Mitigation would need the locked R-4."
        },
        {
          "id": "O-6",
          "how": "`warmup_period` comes from an optional `warmups` out-param on `_formula_fundamentals`, using the existing `GetFormula`. No second pass."
        },
        {
          "id": "O-9",
          "how": "Rendered through `EmptyState` with a new testid. `CardNotice` rejected because of the nested Card."
        },
        {
          "id": "O-10",
          "how": "The transient false FR-2 from a short live page is recorded as an accepted residual in design.md."
        },
        {
          "id": "O-11",
          "how": "design.md records that D and W are UI page-size literals beside the existing `pageSize: 200`, not F-07 config values."
        }
      ],
      "reopen_petitions": [],
      "reopened": []
    }
  },
  "floor_breaches": []
}
```

## Session 2026-11-15 — sdd-batch design gate (round 3)

`/sdd-design fix-indicator-pane-warmup` (full) is halted at its approval gate after round 3 (gate
policy: halt). design.md is not written and status.md is unchanged. The register is in `debate.md`
(D-1..D-17, R-1..R-11, O-1..O-22).

### Open Threads

- **Approach (Option B, D-1..D-17).** Unchanged in shape, and the UI seam and the analysis side
  are now agreed by both sides. The page requests one fixed newest-page `GetBars` of
  `HISTORY_BARS = 1000` (D, operator ruling) and draws the last `CHART_WINDOW_BARS = 200` (W).
  `windowIndicatorSeries` takes times, H and exhaustion from the one series response, and the
  last bar's time joins the query key as a string. Analysis computes `first_value_bars` directly
  (STOCH = period) with a pytest drift pin. New this round: marketdata gains one OTel counter for
  ohlcv SQLSTATE 53200 errors at the repository error seam (operator ruling), which makes
  xstockstrat-marketdata an affected service. No migration, no config key.
- **Strongest open objection (O-12, blocking).** The AC-1 chunk-lock inequality fails for D = 1000
  at cross-environment saturation. One scan over the 3000-day window takes 8,050–11,680 locks
  against a budget of 25,600; two scans in one environment pass narrowly (16,100–23,360); four
  scans (2 environments × marketdata pool 2 on the shared DO cluster) take 32,200–46,720. The
  staleness/DB-miss refetch also upserts about 2,000 rows in one transaction (about 8k locks),
  which the proposal did not count. The gate verdict must read "exceeds the budget at saturation;
  accepted with the counter as monitor", and only if the operator confirms after seeing these
  numbers. The counter detects a breach after the fact; it does not prevent one.
- **Second blocking objection (O-18, C-16).** D = 1000 puts marketdata `@AC-1` (feature 153,
  `fix-ohlcv-chunk-lock-oom.feature:11-15`) at risk, and recon never scanned the marketdata suite.
  The operator's D = 1000 ruling does not name this rule, so it is not treated as covered.
- **Two facts needed from the operator.** A read-only `timescaledb_information.chunks` count of
  `marketdata.ohlcv` chunks older than the 004 cutover (the 2,010–2,920 figure is an estimate),
  and whether staging still shares the DO cluster or runs on the homelab.
- **Open, non-blocking.** O-19 (the counter must wrap every returned error including `rows.Err()`
  and `InsertBars`; adopted in the synthesis, proposer to confirm; must be fixed before spec),
  O-20 (53200 is `out_of_memory`, so name the instrument for what it counts or document the
  assumption), O-21 (two residuals to record in design.md), O-22 (the 3× slack in
  `defaultBarLookback` is the real lock multiplier; say whether a timeframe-aware slack is offered
  as the O-12 mitigation).
- **Closed this round.** O-1, O-4, O-7, O-8, O-13, O-14, O-15, O-16, O-17.
- **Floor status.** No Floor breach and no register violation in any round. No reopen petition
  filed.
- **Uncovered @AC changes.** AC-1, AC-2, AC-3 and AC-4 are EXTEND, none covered by an operator
  decision, so each needs operator sign-off at the gate. Three durable rules are PRESERVE:
  `opportunity-live-market-enrichment @AC-4`, the `platform.feature` GetBars warm-set rule, and
  marketdata `fix-ohlcv-chunk-lock-oom @AC-1`, which is PRESERVE at risk (O-18).
- **Operator rulings applied.** "Expand the fetches. Add a metric to monitor lock budget
  breaches." (relayed 2026-11-15) keeps D = 1000 and adds the counter. The homelab-headroom
  remark was made about a different feature and is not applied here.
- **Not verified.** The mediator did not re-check the `path:line` citations against the tree.
  Nobody has checked the catalog for a first-value P above 801, whether marketdata's pgx errors
  reach the repo unwrapped enough for `errors.As`, or `mapBars` on a sliced array. Feature 125's
  context.md has not been re-read.

```sdd-batch-design-state
{
  "round": 3,
  "synth": {
    "approach": "Round 3 synthesis: Option B stands (D-1..D-13). The UI seam and the analysis side are now agreed by both sides. D = 1000 is kept per the operator ruling. Two blocking items remain, both on the marketdata side of the D = 1000 path: the lock arithmetic is incomplete and fails at cross-environment saturation, and an existing marketdata `@AC-1` (feature 153) is put at risk without being named. The mediator did not re-verify any path:line citation; all are carried from the proposal and adversary. Paths are relative to the feature worktree.\n\n**Root cause (operator decision).** The missing warm-up prefix is in the UI request, not the analysis series builder (D-1). No compute change is needed.\n\n**1. Proto (additive).**\n- Add `int32 first_value_bars = 5;` to `ComponentSeries` (`packages/proto/analysis/v1/analysis.proto:819-827`).\n- The field comment states:\n  - It is the bars needed for the component's first value.\n  - There is one value per component; for a multi-series component it is the earliest series' first-value bar.\n  - 0 means none or unknown, and the UI then never shows insufficient history (fail-open).\n- Rewrite `analysis.proto:806-808`: the page sends the drawn window plus a history prefix, and the server still never re-fetches.\n- Run `buf lint`, `buf breaking` and `./scripts/buf-gen.sh`.\n\n**2. Analysis.**\n- Add `first_value_bars(...)` in `services/xstockstrat-analysis/app/services/warmup.py`, beside `builtin_lookback_bars` (`:70`). It computes the value directly and does not delegate:\n  - SMA/BB = `period`\n  - RSI/ATR = `period + 1`\n  - STOCH = `period` (earliest series is `k`, `warmup.py:93`)\n  - EMA/MACD = 1, VWAP = 0\n  - `source_symbol`, FUNDAMENTAL, and formulas with a `formula_fund_map` hit = 0\n  - other formulas = `declared + 1 if declared else 0` (basis: `packages/proto/indicators/v1/indicators.proto:174`)\n- A pytest drift pin asserts `first_value_bars + _CROSSOVER_LOOKBACK == builtin_lookback_bars` for SMA/BB/RSI/ATR (`warmup.py:58-59`, `:71`). The helper comment names that dependency.\n- Formula `warmup_period` comes through the optional `warmups` out-param on `_formula_fundamentals` (`services/xstockstrat-analysis/app/handlers/servicer.py:1914-1947`), per D-9.\n- `GetIndicatorSeries` sets `first_value_bars` on the success `ComponentSeries` (`servicer.py:4621-4625`); the error branch leaves it 0.\n\n**3. UI data.**\n- Export `HISTORY_BARS = 1000` (D) and `CHART_WINDOW_BARS = 200` (W) from `services/xstockstrat-ui/src/lib/indicatorChart.ts`.\n- `loadBars` requests `pageSize: HISTORY_BARS` with no `range.start` (`src/app/trader/positions/[symbol]/page.tsx:252-257`, D-3).\n- The candlestick draws `mapBars(withTime.slice(-CHART_WINDOW_BARS))` (replaces `page.tsx:269`).\n- `barSeries` still carries all D closes and times to the RPC.\n- The page does not store `historyExhausted`. There is no escalation refetch.\n\n**4. Single slice seam (O-1 fix adopted).**\n- `IndicatorSection` (`page.tsx:1324-1353`) calls, inside `useMemo`:\n  `windowIndicatorSeries({ components: series.components, times: series.times, windowBars: CHART_WINDOW_BARS, requestedBars: HISTORY_BARS }) -> { components, times, insufficient, historyBars }`.\n- Everything is derived from the one response:\n  - `H = series.times.length` (the response echoes `request.times`, `servicer.py:4634-4636`)\n  - `historyExhausted = H < requestedBars`\n  - `insufficient = { c | !c.error && c.firstValueBars > H && historyExhausted }`\n  - every series and `times` are tail-sliced to W\n- `IndicatorPanels` receives the windowed `times`, not the page's `times` prop (`page.tsx:1350`).\n- The query key becomes `['indicator-series', strategyId, symbol, closes.length, String(lastTime?.seconds ?? '')]` (`src/hooks/useIndicatorSeries.ts:16`). `String(...)` is required because the Timestamp `seconds` is a bigint and a raw bigint breaks React Query key hashing. An unchanged last bar keeps the key, so a 300 s poll does not refetch.\n- Rewrite the comments at `useIndicatorSeries.ts:6-7` and `page.tsx:132-133`.\n\n**5. UI state.**\n- `isChartable(c, insufficient)` (`src/components/trader/IndicatorPanels.tsx:19-21`) excludes insufficient components.\n- A third render branch uses `Eyebrow` + `EmptyState`: title \"Not enough history\", description \"Needs {P} bars; {H} available.\", testid `indicator-panel-insufficient` (D-12).\n\n**6. Lock-budget metric (operator ruling; sites corrected per the adversary).**\n- Add one counter with a closed `op` label in `services/xstockstrat-marketdata/internal/telemetry/otel.go`, beside `backfillSymbols` (`:367-372`, `:403-405`). It is built on the existing lazily-bound, nil-safe `NewCounter` (`:184-205`), so it adds no init path and cannot block startup.\n- In `internal/repository/marketdata_repo.go`, one passthrough `observeLockBreach(ctx, op, err) error` classifies `*pgconn.PgError` with Code `53200`. It wraps every returned error, not only the `Query` return, because pgx v5 delivers most server errors through `rows.Err()` (surfacing from `scanBars`, `:171-173`):\n  - `QueryBars`: `:119-121`, `:125-128`, op `bars`\n  - `QueryRecentBars`: `:190-192`, `:195-198`, op `recent_bars`\n  - `QueryBarsBatch`: `:487-489`, `:492-494`, op `bars_batch`\n  - `InsertBars`: `:63-95`, op `insert_bars`\n- The Go test follows the manual-reader harness (`internal/finnhub/finnhub_client_test.go:312-333`). It injects the 53200 through `rows.Err()` as well as the `Query` return, and checks that another error does not count.\n- Naming: 53200 is `out_of_memory`, and lock-table exhaustion is only one cause (fails.md:3060). Either name the instrument for what it counts (e.g. `marketdata.ohlcv.out_of_memory_errors`) or keep `marketdata.ohlcv.lock_budget_breaches` and document the assumption in the marketdata `CLAUDE.md` § Observability. The proposer picks one.\n- Update the marketdata `CLAUDE.md` § Observability list in the same step.\n- This step makes xstockstrat-marketdata an affected service; the product-spec and recon must say so.\n\n**7. AC-1 chunk-lock inequality for D = 1000 (corrected; to be presented at the gate).**\n- Window: `defaultBarLookback` = 1000 × 1d × 3 = 3000 days (`services/xstockstrat-marketdata/internal/service/marketdata_service.go:467-477`).\n- Per scan: 8,050 locks (trading-day chunks, about 2,010) to 11,680 locks (every calendar day, about 2,920), on the pre-004 1-day chunks.\n- Budget: 1024 × 25 = 25,600 (`docs/runbooks/ohlcv-lock-budget-tuning.md:63`).\n- One scan passes. Two scans in one environment (marketdata pool = 2) total 16,100–23,360 and pass narrowly.\n- The lock table is cluster-wide and the DO cluster hosts staging and production (runbook `:88-89`). Worst case is 2 environments × 2 connections = 4 scans: 32,200–46,720. That exceeds 25,600.\n- Write path, uncounted in the proposal: the staleness/DB-miss refetch (`marketdata_service.go:337-350`) live-fetches the 3000-day window and `InsertBars` upserts row by row in one transaction (`marketdata_repo.go:63-95`). That is about 2,000 rows and roughly 8k RowExclusive locks held across about 2,000 round-trips, once per symbol per day when the newest bar is over 24 h old. Today it is about 400 rows.\n- Today at D = 200: 600 days, at most 2,400 locks per scan.\n- Verdict to present: the inequality fails at cross-environment saturation. It is accepted only with the counter as monitor, and only if the operator confirms after seeing these numbers.\n- Two facts are needed from the operator:\n  - a read-only `timescaledb_information.chunks` count of `marketdata.ohlcv` chunks older than the 004 cutover, to replace the 2,010–2,920 estimate\n  - whether staging still shares the DO cluster or runs on the homelab\n- The operator's homelab-headroom remark was made about a different feature and is not applied here.\n\n**8. Recorded in design.md as accepted residuals.**\n- VWAP anchor drift and the transient false FR-2 from a short live page (D-13).\n- Bars dropped for a missing `time` (`page.tsx:261`) can make a full page look short and cause a false FR-2.\n- Analysis compute per request grows with D (`servicer.py:4575`, `:2044-2048`).\n- `source_symbol` fail-open: a benchmark with too little history never shows FR-2.\n- Planning over about 2,000 chunks adds hold time on marketdata's 2-connection pool, which the quote paths share. `marketdata.db.pool.empty_acquire_wait` is the existing signal to watch.\n- The pre-004 1-day chunks leave the read window around 2034 instead of 2028, so runbook Piece A carries this path long-term (runbook `:118-122`).\n- A stale cached series trails the candlestick by at most one right-edge bar until the refetch lands.\n\n**9. Tests.**\n- pytest: `tests/test_warmup.py` covers every family value, STOCH = period, the drift pin, formula 9 → 10, and 0 for fundamentals-only formulas and `source_symbol`. `TestGetIndicatorSeries` (`tests/test_analysis_servicer.py:7057`) covers field population and error → 0.\n- vitest (`src/lib/indicatorChart.test.ts`):\n  - AC-1 (W 190, H 400), AC-3 (W 190, H 200), AC-2 (H 150), AC-4 (W 100, H 150, SMA200 + SMA20)\n  - a full page never produces FR-2\n  - the stale-cache case: response `times` lag the page's bars by one, output values stay index-aligned with output `times`, and H and exhaustion come from the response\n- Go: the 53200 counter test described in section 6.\n- e2e (`e2e/trader/position-detail.spec.ts:482-530`): W = 200 fixtures at 400/200/150 bars with INVENTORY rows. Assert outbound `pageSize == HISTORY_BARS` after waiting for `.tv-lightweight-charts`.\n\n**Build order.**\n1. Proto and buf-gen.\n2. Analysis helper, out-param, wiring and pytest.\n3. Marketdata counter and Go test.\n4. UI constants, `loadBars`, seam and query key, with vitest.\n5. `IndicatorPanels` insufficient branch.\n6. e2e and INVENTORY.\n\n**Touchpoints.** One additive proto field. No migration and no config key. Service edges are unchanged; marketdata gains one OTel counter and serves 1000-bar pages.",
    "open_objections": [
      {
        "text": "O-12 (still open): the proposal's inequality is incomplete. It must be recomputed in design.md with (a) the real concurrency bound: marketdata pool 2 per environment × 2 environments on the shared single-node DO cluster (`ohlcv-lock-budget-tuning.md:88-89`) = 4 scans, 32,200–46,720 locks against 25,600; (b) the `InsertBars` write term from the staleness/DB-miss refetch (`marketdata_service.go:337-350`, `marketdata_repo.go:63-95`), about 2,000 rows and 8k RowExclusive locks held across about 2,000 round-trips; (c) a measured pre-004 chunk count from a read-only `timescaledb_information.chunks` query; (d) whether staging shares the DO cluster. The gate verdict must read 'exceeds the budget at saturation; accepted with the counter as monitor', not 'marginal'. The operator steer requires the numbers at the gate when the inequality fails.",
        "blocking": true
      },
      {
        "text": "O-18 (new, C-16): D = 1000 puts marketdata `@AC-1` 'A 400-day bars query over the ohlcv hypertable locks few enough chunks to succeed' (`services/xstockstrat-marketdata/acceptance/fix-ohlcv-chunk-lock-oom.feature:11-15`, feature 153) at risk, and recon never scanned the marketdata suite. Add xstockstrat-marketdata to Affected Services in the product-spec and recon, list this rule as PRESERVE-at-risk (or CHANGE with operator sign-off recorded in `context.md`), and state the residual in design.md. The operator's D = 1000 ruling does not name this rule.",
        "blocking": true
      },
      {
        "text": "O-19 (new, C-08; must be fixed before spec): the breach counter as proposed hooks only the `Query` error return. pgx v5 delivers most server errors through `rows.Err()` (`marketdata_repo.go:171-173`), the cited `:100` and `:464` are function signatures, and `InsertBars` (`:63-95`) is uninstrumented. Use one `observeLockBreach(ctx, op, err) error` passthrough on every returned error in the three reads and in `InsertBars`, with a Go test that injects 53200 through `rows.Err()`. The synthesis adopts this; the proposer must confirm.",
        "blocking": false
      },
      {
        "text": "O-20 (new): SQLSTATE 53200 is `out_of_memory`, and lock-table exhaustion is only one cause (fails.md:3060 records a 53200 misclassification). Name the instrument for what it counts, or document in the marketdata `CLAUDE.md` § Observability that the label assumes the lock-table cause per the runbook.",
        "blocking": false
      },
      {
        "text": "O-21 (new): record two residuals in design.md. First, planning over about 2,000 chunks adds hold time on marketdata's 2-connection pool, shared with the latency-budgeted quote paths; name `marketdata.db.pool.empty_acquire_wait` as the signal to watch. Second, the pre-004 1-day chunks leave the read window around 2034 instead of 2028, so runbook Piece A carries this path long-term (`ohlcv-lock-budget-tuning.md:118-122`).",
        "blocking": false
      },
      {
        "text": "O-22 (new): the 3× slack in `defaultBarLookback` (`marketdata_service.go:467-477`) is the real lock multiplier; 1000 daily bars need about 1,450 calendar days, not 3,000. The proposal leaves it untouched. State in design.md whether a timeframe-aware slack is offered to the operator as the mitigation for O-12, or why it is out of scope.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "AC-1",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-2",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-3",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-4",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "opportunity-live-market-enrichment @AC-4",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "platform.feature GetBars warm-set rule",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "marketdata fix-ohlcv-chunk-lock-oom @AC-1 (feature 153) — PRESERVE at risk, see O-18",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "R-1 to R-8 stand unchanged (UI lookback table, widened `range.start`, server-side prefix fetch, `window_bars` request field, converged P, hook `select` seam, `CardNotice`, slicing against the page's `times`).",
      "Shrinking D (e.g. W + 300 = 500). The operator ruled to keep the larger page (D = 1000) rather than size D down.",
      "Server-guided escalation (small first-load D, one refetch sized from `first_value_bars`). It was the runner-up only if a single fixed D was not accepted; the operator accepted D = 1000, and escalation would bring back sticky-depth state.",
      "A `marketdata.ohlcv.scan_window_days` histogram as a leading signal. The operator asked for a breach counter, and both sides agreed the histogram is not needed (C-18).",
      "Recording the breach counter in the `GetBars` handler instead of the repository. One repo seam covers GetBars, its re-read (`marketdata_service.go:429`), BatchGetBars and InsertBars.",
      "`first_value_bars` delegating to `builtin_lookback_bars`. STOCH cannot delegate (period + 2 vs period), so the value is computed directly and pinned by pytest.",
      "Not rejected, held for the gate: timeframe-aware slack in `defaultBarLookback` (e.g. ×1.6 for `1d`), keeping D = 1000. It roughly halves the window and locks, but changes a shared helper for every implicit-window `GetBars` caller and is beyond this fix unless the operator accepts it as the O-12 mitigation.",
      "Not rejected, not adopted: a narrower staleness refetch window (fetch only since the newest stored bar). It removes the 8k-lock write transaction, but touches the MARKETDATA-3 fallback contract and `truncateBars` semantics, a larger blast radius than this fix."
    ],
    "open_risks": [
      "Lock budget: at D = 1000 the AC-1 inequality fails at cross-environment saturation on the shared DO cluster (4 scans, 32,200–46,720 locks against 25,600). The counter detects a breach after the fact; it does not prevent one.",
      "The staleness/DB-miss refetch upserts about 2,000 rows in one transaction over old 1-day chunks, holding about 8k locks far longer than a read, once per symbol per day after weekends and holidays.",
      "The pre-004 chunk count (2,010–2,920) is an estimate. Nobody has run the read-only chunk count.",
      "It is not known whether staging still shares the DO cluster or runs on the homelab. The homelab's `max_connections` and `max_locks_per_transaction` are not in recon.",
      "Marketdata `@AC-1` (feature 153) is at risk under concurrency and has not been shown to the operator by name.",
      "Nobody has checked the catalog for a first-value P above D - W + 1 = 801. Such a component shows leading gaps with no notice on a full page.",
      "Whether marketdata's pgx v5 errors reach the repo wrapped so that `errors.As` to `*pgconn.PgError` works was not grepped.",
      "A 53200 from a cause other than lock-table exhaustion would be counted as a lock-budget breach unless the instrument is renamed or the assumption is documented.",
      "Longer planning time per `GetBars` holds one of marketdata's 2 pool connections longer and can delay the quote paths.",
      "Bars dropped for a missing `time` can make a full page look short and cause a false 'Not enough history'.",
      "The forming daily bar's indicator value refreshes only when a new bar arrives or the query goes stale.",
      "`mapBars` was still not read; it is assumed to accept a sliced array.",
      "Analysis compute and the polled payload grow in proportion to D.",
      "Feature 125's context.md has not been re-read.",
      "The mediator did not re-verify the path:line citations against the tree."
    ],
    "constitution_rules_touched": [
      "P-02",
      "P-03",
      "C-01",
      "C-03",
      "C-08",
      "C-12",
      "C-13",
      "C-15",
      "C-16",
      "C-17",
      "C-18",
      "F-06",
      "F-07",
      "PLAT-N1"
    ],
    "rationale": "The proposal honours D-1..D-13, revives no R-1..R-8 variant and files no reopen petition. The adversary found no Floor breach and no register violation. The operator steer reopens nothing.\n\n**Closed this round.** The adversary's closure guidance agrees on all nine:\n- O-1: times, H and exhaustion come from one response; the last bar's time joins the query key as a string; a stale-cache vitest is added.\n- O-4: one fixed depth, no escalation, now that the operator has fixed D = 1000.\n- O-7, O-8: the multi-series wording and the stale-cache case are added.\n- O-13, O-14: direct compute with a drift pin; STOCH = period.\n- O-15, O-16, O-17: recorded in design.md.\n\n**Still open.**\n- **O-12 (blocking).** The operator kept D = 1000 but asked for the inequality to be computed and, if it fails, shown at the gate. The proposal's arithmetic omits the pool-and-shared-cluster concurrency bound and the `InsertBars` write path. With them, the inequality fails at saturation, so the proposal's 'marginal' verdict cannot go to the gate as written. The proposal has not answered this, so it stays open.\n- **O-18 (blocking, new).** The change now touches marketdata and multiplies the lock cost of every symbol-page `GetBars` by about 5, which bears on feature 153's `@AC-1`. The operator ruling sanctions D = 1000 but does not name that rule, so it is not marked as covered by an operator decision.\n- **O-19 to O-22 (non-blocking, new).** The counter's hook sites, the 53200 naming, two residuals and the lookback slack. The synthesis adopts the O-19 fix in the approach, but the proposer has not yet confirmed it.\n\n**Operator decisions.** Both are honoured: the root cause was located (D-1) before the fix, D = 1000 is kept, and the breach metric is added on the existing lazily-bound counter so OTel cannot block startup. The relayed user request's item 9 is the same ruling. Its homelab remark belongs to item 3, a different feature, and is not used here.",
    "register_delta": {
      "new_decisions": [
        {
          "text": "`windowIndicatorSeries` takes `times` and H from the response and derives `historyExhausted` from `series.times.length < HISTORY_BARS`. `IndicatorPanels` receives the windowed response times. The query key adds the last bar's time as `String(seconds)`. The page stores no `historyExhausted`.",
          "evidence": "Operator steer for round 3; `servicer.py:4634-4636`, `page.tsx:1350`, `useIndicatorSeries.ts:16`. The adversary said O-1 can close."
        },
        {
          "text": "`HISTORY_BARS = 1000` (D) and `CHART_WINDOW_BARS = 200` (W) are exported from `src/lib/indicatorChart.ts`. D is one fixed depth with no escalation refetch.",
          "evidence": "Operator ruling 2026-11-15 (expand the fetches, keep D = 1000); `page.tsx:256`. The adversary said O-4 can close."
        },
        {
          "text": "Marketdata gains one OTel counter for ohlcv SQLSTATE 53200 errors with a closed `op` label, built on the existing lazily-bound `NewCounter` and recorded at the repository error seam. Its exact hook sites and name are open under O-19 and O-20.",
          "evidence": "Operator ruling 2026-11-15 (add a metric to monitor lock-budget breaches); `otel.go:184-205`, `:367-372`; `marketdata_repo.go:180-192`."
        },
        {
          "text": "`first_value_bars` is computed directly (SMA/BB = period, RSI/ATR = period + 1, STOCH = period), with a pytest pin `first_value_bars + _CROSSOVER_LOOKBACK == builtin_lookback_bars` for SMA/BB/RSI/ATR.",
          "evidence": "`warmup.py:58-59`, `:71`, `:93`. The adversary said O-13 and O-14 can close."
        }
      ],
      "new_rejected": [
        {
          "text": "Shrinking D below 1000 (e.g. W + 300).",
          "why": "The operator ruled to keep the larger history page rather than size D down."
        },
        {
          "text": "Server-guided escalation: a small first-load D with one refetch sized from the server's `first_value_bars`.",
          "why": "It was held only in case a single fixed D was not accepted. The operator accepted D = 1000, and escalation needs sticky-depth state."
        },
        {
          "text": "A `marketdata.ohlcv.scan_window_days` histogram as a leading lock-budget signal.",
          "why": "The operator asked for a breach counter; both sides agreed the histogram is not needed (C-18)."
        }
      ],
      "new_objections": [
        {
          "text": "C-16: D = 1000 puts marketdata `@AC-1` (`services/xstockstrat-marketdata/acceptance/fix-ohlcv-chunk-lock-oom.feature:11-15`, feature 153) at risk. Add xstockstrat-marketdata to Affected Services in the product-spec and recon, list the rule as PRESERVE-at-risk or CHANGE with operator sign-off in `context.md`, and state the residual in design.md.",
          "blocking": true
        },
        {
          "text": "C-08: the breach counter must wrap every returned error in `QueryBars` (`marketdata_repo.go:119-121`, `:125-128`), `QueryRecentBars` (`:190-192`, `:195-198`), `QueryBarsBatch` (`:487-489`, `:492-494`) and `InsertBars` (`:63-95`) through one `observeLockBreach(ctx, op, err) error` passthrough, because pgx v5 delivers most server errors through `rows.Err()`. The Go test must inject 53200 through `rows.Err()`. Must be fixed before spec.",
          "blocking": false
        },
        {
          "text": "SQLSTATE 53200 is `out_of_memory`, not only lock-table exhaustion (fails.md:3060). Name the instrument for what it counts, or document the lock-table assumption in the marketdata `CLAUDE.md` § Observability.",
          "blocking": false
        },
        {
          "text": "Record in design.md the added pool hold time on marketdata's 2-connection pool (signal: `marketdata.db.pool.empty_acquire_wait`) and that the pre-004 1-day chunks stay in the read window until about 2034 (`ohlcv-lock-budget-tuning.md:118-122`).",
          "blocking": false
        },
        {
          "text": "The 3× slack in `defaultBarLookback` (`marketdata_service.go:467-477`) is the real lock multiplier. State in design.md whether a timeframe-aware slack is offered to the operator as the O-12 mitigation, or why it is out of scope.",
          "blocking": false
        }
      ],
      "closed_objections": [
        {
          "id": "O-1",
          "how": "`windowIndicatorSeries` takes times, H and exhaustion from the one response; the last bar's time joins the query key as a string; a stale-cache alignment vitest is added."
        },
        {
          "id": "O-4",
          "how": "FR-2 fires only on a short page. D is one fixed depth (1000, operator ruling) and there is no escalation refetch."
        },
        {
          "id": "O-7",
          "how": "The field comment states the meaning of 0, that the value is per component, and that a multi-series component uses its earliest series. The three stale comments are rewritten."
        },
        {
          "id": "O-8",
          "how": "W is a parameter; vitest covers AC-1..AC-4 at W = 190 and 100 plus the stale-cache case; e2e uses W = 200 fixtures with INVENTORY rows."
        },
        {
          "id": "O-13",
          "how": "`first_value_bars` is computed directly, with a pytest pin against `builtin_lookback_bars` and the `_CROSSOVER_LOOKBACK` dependency named in the helper comment."
        },
        {
          "id": "O-14",
          "how": "STOCH P = period, the earliest series' (`k`) first-value bar."
        },
        {
          "id": "O-15",
          "how": "The growth in analysis compute per request with D is recorded in design.md as accepted."
        },
        {
          "id": "O-16",
          "how": "The `source_symbol` fail-open residual is recorded in design.md."
        },
        {
          "id": "O-17",
          "how": "design.md cites `indicators.proto:174` as the basis for formula P = `warmup_period + 1`."
        }
      ],
      "reopen_petitions": [],
      "reopened": []
    }
  },
  "floor_breaches": []
}
```

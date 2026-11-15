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

## Session 2026-11-15 — sdd-batch design gate (round 4)

`/sdd-design fix-indicator-pane-warmup` (full) is halted at its approval gate after round 4 (gate
policy: halt). design.md is not written and status.md is unchanged. The register is in `debate.md`
(D-1..D-24, R-1..R-15, O-1..O-29, P-1..P-3).

### Open Threads

- **Approach (D-1..D-4, D-6..D-14, D-16, D-17 stand; D-18..D-24 new).** The only change this
  round is where the history depth D comes from. D becomes the global `ui`-namespace config key
  `chart.indicator_history_bars` (int, default 200), seeded for staging and production by config
  migration `050_ui_chart_history_bars` and write-bounded to [200, 1000]. DigitalOcean stays at
  200; the homelab is raised to 1000 by `set_config`. The UI reads it one-shot through
  `traderConfigClient.getConfig({ namespace: 'ui' })` and a pure `readHistoryBars` that falls
  back to 200 on absence, wrong type, error or timeout and clamps to
  [`CHART_WINDOW_BARS`, `MAX_HISTORY_BARS` = 1000]. `CHART_WINDOW_BARS = 200` (W), the proto
  field, the analysis helper, the UI seam and the insufficient-history pane are unchanged from
  round 3. The breach counter is now named `marketdata.ohlcv.out_of_memory_errors` and wraps
  every returned error in the three reads and `InsertBars` (D-22). xstockstrat-marketdata and
  xstockstrat-config join Affected Services (D-23).
- **Strongest open objection (O-23, blocking, P-04/P-03).** The product-spec says "no new or
  changed config key" and "no migration" in Fix Scope and again in Out of Scope. The seeded key
  and migration 050 contradict both, and no recorded decision amends the product-spec. Before
  approval the product-spec Fix Scope and Out of Scope must be amended, the operator's sanction
  for the key and the migration recorded here, and the new-config-key approval (owner + config
  team) noted. Otherwise the product-spec goes back for re-review.
- **What each deployment gets (D-20).** On DigitalOcean at D = 200 a full page never shows 'Not
  enough history', so SMA200 is still a single dot, with no notice. AC-2 and AC-4 hold on both
  deployments. AC-1 and AC-3 hold only where D ≥ W + P − 1, which today means the homelab at
  1000. This is recorded as an operator-accepted residual ("200 bars for DO is fine").
- **The fix reaches the homelab only through three launch steps (D-21, O-25).** Migration 050
  seeds 200 on the homelab too, where the defect was reported, so a deploy alone ships no fix.
  The steps go in a new section of `docs/runbooks/ohlcv-lock-budget-tuning.md`: a read-only lock
  gate (`SHOW` of three settings plus a chunk-width query; `mlpt ≥ 404` at 30-day chunks), then
  `set_config` to 1000, then a LYFT SMA200 smoke test. A failed gate, or 1-day chunks, escalates
  to the operator.
- **Lock budget of record (D-24, closes O-12).** DigitalOcean at 200 is unchanged from today: at
  most 2,400 locks per scan and 9,600 at 4 scans against 25,600. The homelab at 1000 on 30-day
  chunks needs at most 404 per scan. If an admin set 1000 on DigitalOcean, 4 scans would need
  32,200–46,720 against 25,600; the bound allows that edit and only the key description, the
  runbook and the counter guard against it.
- **Question for the operator (O-26).** The relayed request says "Use the mcp to read the
  values." No connected tool can read the homelab DB settings: the homelab MCP has config tools
  only, and Grafana Cloud has no SQL datasource and no `pg_settings_*` metrics. The design falls
  back to `psql` in the runbook step. The operator can accept `psql` or name the tool they meant.
  The MCP did confirm that the homelab `ui` namespace holds only the two `performance.*` keys.
- **Trade-off the adversary asked the operator to see.** Branching on the existing
  `HOST_PROVIDER` env (`homelab ? 1000 : 200`) needs no migration, no config read and no manual
  `set_config`, and DigitalOcean could never be raised by accident. It was not adopted because it
  turns an OTel resource attribute into behaviour and keeps a per-deployment value in source.
- **Open, non-blocking.** O-24 (design.md must carry `maxValue: 1000`, not the proposal's 5000;
  the proposer has not confirmed), O-25 (launch steps, above), O-26 (above), O-27 (the runbook
  must say only the homelab `staging` row is set; a later homelab production starts at 200),
  O-28 (short timeout and `staleTime: Infinity` on the config read; pass the clamped D), O-29
  (`scripts/config-wiring.json` entry, UI `CLAUDE.md` update, reword AC-1 and AC-3 so the
  precondition names the configured depth).
- **Closed this round.** O-12, O-18, O-19, O-20, O-21, O-22.
- **Floor status.** No Floor breach and no register violation in any round.
- **Reopen petitions (P-1..P-3, verdict pending user).** D-5, D-15 and R-9 are marked reopened
  on the operator steer. The steer names only D-5; D-15 (the `HISTORY_BARS = 1000` half) and R-9
  rest on the same ruling and need the operator's confirmation at the gate.
- **Uncovered @AC changes.** AC-2 and AC-4 are EXTEND and not covered by an operator decision, so
  each needs sign-off at the gate. AC-1 and AC-3 are EXTEND and covered by the 200/1000 ruling.
  Feature 153 `@AC-1` is PRESERVE on DigitalOcean and PRESERVE-at-risk wherever 1000 runs, with
  operator sign-off. `opportunity-live-market-enrichment @AC-4` and the `platform.feature`
  GetBars warm-set rule are PRESERVE.
- **Operator rulings on record (relayed 2026-11-15).** "DO staging and production share a common
  managed DB. The staging homelab instance is associated with a homelab DB." "200 bars for DO is
  fine. I insist in 1000bars for homelab." "Use the mcp to read the values." The synthesis also
  relies on an operator sign-off for feature 153 `@AC-1` at risk. Which numbered item of the
  relayed request sanctions the config-key mechanism is not certain, and none is assumed (O-23).
- **Not verified.** The mediator did not re-check the `path:line` citations against the tree.
  The homelab's `max_locks_per_transaction`, `max_connections`, `max_prepared_transactions` and
  chunk widths are unknown. Nobody has checked whether the `scripts/config-wiring.json` checker
  accepts the new UI reader site.

```sdd-batch-design-state
{
  "round": 4,
  "synth": {
    "approach": "Round 4 synthesis. D-1..D-4, D-6..D-14, D-16 and D-17 stand. The only change is where the history depth D comes from: it becomes a per-deployment config value, default 200, raised to 1000 on the homelab. The mediator did not re-verify the path:line citations; they are carried from the proposal and the adversary. Paths are relative to the feature worktree.\n\n**Mediator checks this round (read-only).**\n- The homelab MCP `get_config` for namespace `ui` returns only the two `performance.*` keys, environment `staging`. So the homelab config service is reachable and the new key does not exist yet.\n- No connected tool can read the homelab DB settings. The homelab MCP has config tools but no SQL or `SHOW` tool. Grafana Cloud has no SQL datasource and no `pg_settings_*` metrics. `max_locks_per_transaction`, `max_connections` and the chunk widths therefore stay a runbook step.\n\n**1. Proto, analysis, UI seam, UI state (unchanged from round 3).**\n- `int32 first_value_bars = 5` on `ComponentSeries` (`packages/proto/analysis/v1/analysis.proto:819-827`), with the comment and the rewrite of `:806-808`.\n- `first_value_bars(...)` in `services/xstockstrat-analysis/app/services/warmup.py` beside `:70`, computed directly, with the pytest pin (D-17).\n- The `warmups` out-param on `_formula_fundamentals` (`app/handlers/servicer.py:1914-1947`, D-9); the field is set at `servicer.py:4621-4625`.\n- `windowIndicatorSeries` in `services/xstockstrat-ui/src/lib/indicatorChart.ts`, called from `IndicatorSection` (`src/app/trader/positions/[symbol]/page.tsx:1324-1353`), per D-10 and D-14.\n- The insufficient-history pane through `Eyebrow` + `EmptyState`, testid `indicator-panel-insufficient` (D-12).\n- `CHART_WINDOW_BARS = 200` (W) stays an exported constant.\n\n**2. D as a seeded config key (replaces D-5 and the `HISTORY_BARS = 1000` half of D-15).**\n- Key: `chart.indicator_history_bars`, namespace `ui`, global scope, type int, default 200.\n- Seed: config migration `050_ui_chart_history_bars` (up and down), with staging and production rows at 200 and `ON CONFLICT … DO NOTHING`, so a re-run never overwrites the homelab value. Shape copied from `services/xstockstrat-config/migrations/023_ui_performance_keys.up.sql:17-32`. The last config migration is 049.\n- Write bound in `SCALAR_BOUNDS_REGISTRY` (`services/xstockstrat-config/src/grpc/configServiceImpl.ts:114`): **`minValue: 200, maxValue: 1000`**. This corrects the proposal's 5000.\n  - 1000 is the largest depth the operator signed off for feature 153 `@AC-1` (\"on any deployment that runs the 1000-bar depth\").\n  - A higher bound would let one config edit exceed that sign-off on the shared DigitalOcean cluster.\n  - Going above 1000 needs a new design pass.\n- The key description (migration and the UI `CLAUDE.md` Config Keys Consumed row) states that DigitalOcean must stay at 200 and that raising it needs the runbook lock gate first.\n- Environment scoping is not used. Both deployments run `staging`; they differ in which config database they read.\n\n**3. How the UI reads D.**\n- One-shot `traderConfigClient.getConfig({ namespace: 'ui' })` (`src/lib/traderConfigClient.ts:7-8`), through the existing forward at `src/lib/traderBff.ts:168-169`. No new route, no cross-segment client, no `WatchConfig`.\n- A pure `readHistoryBars(values)` in `src/lib/indicatorChart.ts`:\n  - oneof-presence check, as in `src/lib/performanceMetrics.ts:192-195`;\n  - falls back to `DEFAULT_HISTORY_BARS = 200` when the key is absent, the wrong type, or the call errors or times out;\n  - clamps to `[CHART_WINDOW_BARS, MAX_HISTORY_BARS]`, where `MAX_HISTORY_BARS = 1000` is one exported constant, not a bare literal.\n- The config read uses a short timeout (the existing `{ timeoutMs }` option style) and `staleTime: Infinity`. A slow config service must not block the candlestick; it degrades to 200.\n- The bars effect (`page.tsx:331-334`) waits for the config query to settle, requests `pageSize: D` with no `range.start` (D-3), and has D in its deps. The 300 s poll (`:338-342`) reuses the same D.\n- `windowIndicatorSeries` receives `requestedBars` = the clamped D actually sent as `pageSize`, so `historyExhausted = series.times.length < D` (D-14) stays correct.\n\n**4. What a DigitalOcean user sees at D = 200, W = 200.**\n- The same bars as today, with no prefix.\n- On a full 200-bar page, D-11 forbids the 'Not enough history' state. A component with first-value P > 1 renders with leading gaps: values on the last 201 − P bars only. **SMA200 on DigitalOcean is still a single dot, with no notice.**\n- 'Not enough history' appears only when the page comes back short and P > H. Example: a symbol with 150 stored bars shows it for SMA200 while SMA20 still draws.\n- AC-2 and AC-4 hold on both deployments. AC-1 and AC-3 hold only where D ≥ W + P − 1, which means the homelab at 1000. design.md records this as an operator-accepted residual (\"200 bars for DO is fine\").\n\n**5. Launch on the homelab (the defect was reported there: `docs/reports/2026-11-15-indicator-panel-sma200-single-point-defect.md:6`).**\nA deploy alone seeds 200 on the homelab too, so it ships no fix. The spec carries three ordered, verifiable launch steps, recorded as a new section \"Homelab deep indicator history\" in `docs/runbooks/ohlcv-lock-budget-tuning.md` (there is no dedicated homelab runbook):\n1. Read-only gate, by `psql` per `operator-db-access.md`, since no MCP can read these:\n   - `SHOW max_locks_per_transaction; SHOW max_connections; SHOW max_prepared_transactions;`\n   - `SELECT count(*), min(range_end - range_start), max(range_end - range_start) FROM timescaledb_information.chunks WHERE hypertable_schema='marketdata' AND hypertable_name='ohlcv';`\n   - Compute `L_scan = ceil(3000 / chunk_days) × 4` and `budget = mlpt × (mc + mpt)`. Require `L_scan × c ≤ budget` with `c = mc` as the conservative bound. With 30-day chunks this reduces to `mlpt ≥ 404`. If it fails on `mlpt` alone, raise `max_locks_per_transaction` to 512 (a restart) and re-run the SHOW.\n   - If the chunk query shows 1-day chunks, stop and escalate to the operator. Do not silently ship 200.\n2. `set_config` namespace `ui`, key `chart.indicator_history_bars`, value 1000 through the homelab MCP, then `get_config` to confirm.\n3. Smoke test: the LYFT symbol page draws an SMA200 line, and `marketdata.ohlcv.out_of_memory_errors` does not increment over one readiness cycle.\nThe runbook also states that only the `staging` row is set today. A later homelab production deployment starts at 200 and needs the same three steps for its own row.\n\n**6. Lock arithmetic, recomputed for both deployments (answers O-12).**\nUses 4 relations per chunk (`ohlcv-lock-budget-tuning.md:20-24`, `:46-53`) and the implicit window D × 1d × 3 (`services/xstockstrat-marketdata/internal/service/marketdata_service.go:465-477`). Locks are per relation, so the write term is distinct chunks × 4, not rows; this corrects round 3's 8k figure.\n- **DigitalOcean, D = 200, unchanged from today.**\n  - Window 600 days: about 3 post-004 30-day chunks plus 357 (trading days) to 517 (calendar days) 1-day chunks.\n  - 1,440–2,080 locks per scan; 2,400 as an upper bound.\n  - Saturation: 2 environments × 2 marketdata connections = 4 scans, at most 9,600 locks against 1024 × 25 = 25,600 (`:63`). Passes.\n  - Write term (staleness refetch, `marketdata_service.go:337-350` into `InsertBars`, `internal/repository/marketdata_repo.go:63-95`): about 400 rows, at most 2,400 locks. Same as today.\n- **Homelab, D = 1000, own cluster, 30-day chunks if the deploy was fresh.**\n  - Window 3000 days: at most 101 chunks, at most 404 locks per scan. The write term is the same 404 for about 2,000 rows.\n  - At stock settings (64 × 100 = 6,400) that allows 15 concurrent scans. Staging plus a later production on the same cluster is 4. Passes.\n  - If the chunks are 1-day wide, one scan needs about 12,000 locks and the gate in section 5 blocks the raise.\n- **DigitalOcean if an admin raised the key to 1000** (allowed by the bound, forbidden by the runbook): round 3's figure applies, 32,200–46,720 locks at 4 scans against 25,600. It fails. This is the signed-off at-risk case, and the counter is the monitor.\n\n**7. Breach counter (D-16; answers O-19 and O-20).**\n- Instrument: `marketdata.ohlcv.out_of_memory_errors`, label `op` in {`bars`, `recent_bars`, `bars_batch`, `insert_bars`}. It is named for what it counts (SQLSTATE 53200). It stays in marketdata; feature 343 depends on it.\n- The marketdata `CLAUDE.md` § Observability states the assumption: on `marketdata.ohlcv` an increment is read as lock-table exhaustion per the runbook, and any other out-of-memory cause also counts.\n- One passthrough `observeLockBreach(ctx, op, err) error` in `internal/repository/marketdata_repo.go` wraps every returned error, including the `rows.Err()` path through `scanBars` (`:171-173`):\n  - `QueryBars`: `:119-121`, `:125-128`\n  - `QueryRecentBars`: `:190-192`, `:195-198`\n  - `QueryBarsBatch`: `:487-489`, `:492-494`\n  - `InsertBars`: `:67-69`, `:91-92`, `:95`\n- It classifies with `errors.As` to `*pgconn.PgError`, Code `53200`. The Go test injects 53200 through `rows.Err()` and checks that another error does not count.\n\n**8. Business-rule record (answers O-18).**\n- xstockstrat-marketdata and xstockstrat-config are added to Affected Services in the product-spec and recon.\n- Feature 153 `@AC-1` (`services/xstockstrat-marketdata/acceptance/fix-ohlcv-chunk-lock-oom.feature:11-15`) is PRESERVE on DigitalOcean at 200 and PRESERVE-at-risk wherever 1000 runs.\n- The operator sign-off (2026-11-15, round 3) is written to `context.md`, together with the reopen of D-5, D-15 and R-9.\n\n**9. Residuals recorded in design.md.**\n- The round-3 list stands: VWAP drift, transient false FR-2, analysis compute growing with D, `source_symbol` fail-open, the stale-cache one-bar lag.\n- DigitalOcean still shows the single dot (section 4).\n- Pool hold time on marketdata's 2-connection pool matters on the homelab only; the signal is `marketdata.db.pool.empty_acquire_wait`.\n- The pre-004 1-day chunks: unchanged on DigitalOcean, because D is not raised there.\n- Timeframe-aware slack in `defaultBarLookback` is out of scope: at 200 it is today's behaviour, and on the homelab 30-day chunks cap the cost at 101 chunks.\n- The counter detects a breach; it does not prevent one.\n\n**10. Tests.**\n- pytest and Go: as in round 3.\n- vitest (`src/lib/indicatorChart.test.ts`):\n  - the AC cases pass D explicitly (AC-1 and AC-3 at D = 1000);\n  - `readHistoryBars`: absent key, wrong type, below W, above 1000, valid 1000;\n  - a D = 200 full page gives leading gaps and no FR-2.\n- e2e: fixtures mock the `ui` config read at 1000 for the AC-1 path and leave it absent for the default path, with INVENTORY rows. Assert the outbound `pageSize` equals the resolved D.\n- Config: bounds test for the new registry entry; `scripts/config-wiring.json` gains the reader entry.\n\n**Build order.**\n1. Proto and buf-gen.\n2. Analysis helper and pytest.\n3. Marketdata counter and Go test.\n4. Config migration 050 and the bounds entry.\n5. UI reader, bars effect, seam and vitest.\n6. Insufficient-history pane.\n7. e2e and INVENTORY.\n8. Runbook section and `CLAUDE.md` updates.\n9. Homelab launch steps.\n\n**Touchpoints.** One additive proto field; one config migration; one new config key; one new marketdata counter. The UI gains a `/trader` read of the `ui` namespace (previously only `/insights` read it).",
    "open_objections": [
      {
        "text": "Product-spec scope (P-04/P-03): the product-spec says 'no new or changed config key' and 'no migration' in Fix Scope and again in Out of Scope. The seeded key and migration 050 contradict both. The operator ruled that the depth is per-deployment and the steer names a seeded key as an example, but no recorded decision amends the product-spec. Before approval, the orchestrator must amend the product-spec Fix Scope and Out of Scope, record the operator's sanction in `context.md` (citing the ruling it relies on), and note the approval-flow requirement for a new config key (owner + config team). Otherwise the product-spec needs re-review.",
        "blocking": true
      },
      {
        "text": "Write bound (C-16): the proposal's `maxValue: 5000` would let one config edit on DigitalOcean widen the implicit window to as much as 15,000 days over 1-day chunks, beyond the operator's sign-off for feature 153 `@AC-1`. The synthesis sets `maxValue: 1000` and one exported `MAX_HISTORY_BARS = 1000` for the reader clamp. The proposer has not confirmed; design.md must carry 1000, not 5000.",
        "blocking": false
      },
      {
        "text": "Launch (C-15): migration 050 seeds 200 on the homelab, where the defect was reported (`docs/reports/2026-11-15-indicator-panel-sma200-single-point-defect.md:6`), so a deploy alone ships no fix. The spec must carry the three ordered launch steps (runbook lock gate, `set_config` to 1000, LYFT SMA200 smoke test) and the rule that a failed gate escalates to the operator. The synthesis adopts this; the proposer must confirm.",
        "blocking": false
      },
      {
        "text": "Reading the homelab DB values: the relayed request says to use the MCP to read the values, but no connected tool can. The homelab MCP has only config tools; Grafana Cloud has no SQL datasource and no `pg_settings_*` metrics (checked this round). The design falls back to `psql` in the runbook step. State this at the gate so the operator can either accept `psql` or name the tool they meant. The MCP is still used for `set_config` and the `get_config` confirmation.",
        "blocking": false
      },
      {
        "text": "Homelab production: migration 050 seeds a production row at 200, so a later homelab production deployment reverts to the single dot. The runbook section must say that only the `staging` row is set today and that production needs the same gate and `set_config`.",
        "blocking": false
      },
      {
        "text": "Config read on the chart path: waiting for `GetConfig` adds a serial round trip before the candlestick draws. Use a short timeout, `staleTime: Infinity`, and the fallback to 200 on timeout as well as on error. Pass the clamped D actually sent as `pageSize` into `windowIndicatorSeries`, not the raw config value.",
        "blocking": false
      },
      {
        "text": "Docs and tooling: add the reader entry to `scripts/config-wiring.json` after reading the checker (`scripts/config-wiring.test.mjs`); update `services/xstockstrat-ui/CLAUDE.md` to say `traderBff.ts:166-170` also forwards the `ui` namespace and that `/trader` now reads it; reword `acceptance.feature` AC-1 and AC-3 so their precondition names the configured depth (C-15).",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "AC-1",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "AC-2",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-3",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
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
        "ac_id": "marketdata fix-ohlcv-chunk-lock-oom @AC-1 (feature 153) — PRESERVE on DigitalOcean at 200; PRESERVE-at-risk wherever 1000 runs (operator signed off 2026-11-15)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": true
      }
    ],
    "rejected_alternatives": [
      "R-1 to R-8, R-10 and R-11 stand unchanged.",
      "R-9 (shrinking D below 1000) is reopened by the operator ruling: the default is now 200 and 1000 is the ceiling.",
      "D as a UI constant (`HISTORY_BARS = 1000` everywhere, D-5 and D-15). The operator ruled 200 on DigitalOcean and 1000 on the homelab, so one constant cannot serve both.",
      "Environment scoping to separate the two deployments. Both run `APPLICATION_ENV` staging, so the environment cannot tell them apart.",
      "A new homelab-only env var or build arg. It puts a per-deployment value outside the config service, against root config governance, and needs deploy-file edits on both platforms.",
      "Write bound `maxValue: 5000` (the `GetBars` page cap). It lets a config edit exceed the operator's sign-off on the shared DigitalOcean cluster; 1000 is the signed-off ceiling.",
      "Reading the key through `insightsConfigClient`. The page is in the `/trader` segment and the trader forward already passes any namespace.",
      "Timeframe-aware slack in `defaultBarLookback`. At 200 the slack is today's behaviour and on the homelab 30-day chunks cap the cost; it would change a shared helper for every implicit-window caller.",
      "Not rejected, held for the gate: branching on the existing `HOST_PROVIDER` env (`homelab ? 1000 : 200`). It needs no migration, no config read and no manual `set_config`, and DigitalOcean could never be raised by accident. It loses on governance: it turns an OTel resource attribute into behaviour and keeps a per-deployment value in source. The adversary asked that the operator see this trade-off.",
      "Not adopted: a full-page notice on DigitalOcean ('needs P bars, showing D'). It would need a reopen of D-11, and the defect was reported on the homelab, where 1000 makes it moot."
    ],
    "open_risks": [
      "The fix reaches the homelab only after a manual `set_config`. If the launch steps are skipped, the homelab keeps the single dot.",
      "DigitalOcean users still see SMA200 as a single dot on a full 200-bar page, with no notice.",
      "The bound of 1000 cannot tell deployments apart. An admin could set 1000 on DigitalOcean through config-ui or the agent `set_config` tool. At 4 concurrent scans that needs 32,200–46,720 locks against 25,600. Only the key description, the runbook and the counter guard against it.",
      "The homelab's `max_locks_per_transaction`, `max_connections` and `max_prepared_transactions` are unknown, and no connected tool can read them.",
      "The homelab's 30-day chunks rest on the operator's fresh-deploy statement. If the chunks are 1-day wide, one scan needs about 12,000 locks and the raise is blocked.",
      "The lock table is shared with every other transaction on the cluster. The inequality counts only ohlcv scans.",
      "A 53200 from a cause other than lock-table exhaustion also increments the counter.",
      "Feature 343's `backfill.max_concurrent_jobs` homelab pattern is not written into its docs; the design follows the steer's description of it.",
      "Whether the `scripts/config-wiring.json` checker accepts the new UI reader site was not checked.",
      "The config read adds a round trip before the first bars request.",
      "Bars dropped for a missing `time` can make a full page look short and cause a false 'Not enough history'.",
      "Analysis compute and the polled payload grow with D on the homelab.",
      "Which numbered item of the relayed request sanctions the config-key mechanism is not certain; the mediator did not assume one.",
      "The mediator did not re-verify the path:line citations against the tree."
    ],
    "constitution_rules_touched": [
      "P-02",
      "P-03",
      "P-04",
      "C-01",
      "C-03",
      "C-05",
      "C-07",
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
    "rationale": "**Register.** The proposal keeps D-1..D-4, D-6..D-14, D-16 and D-17, and the adversary found no violation and no Floor breach.\n- The operator steer reopens D-5 by name.\n- The recorded operator decision also says it \"supersedes the earlier 'D = 1000 everywhere'\". That ruling is the whole evidence for D-15's `HISTORY_BARS = 1000` and the whole reason for R-9. I therefore list D-15 and R-9 as operator-reopened too.\n- The steer itself names only D-5, so the orchestrator should confirm D-15 and R-9 when it writes `context.md`. The proposer's three petitions are recorded with new evidence, and the adversary judged all three valid.\n- `CHART_WINDOW_BARS = 200` from D-15 stands.\n\n**Closed this round.** The adversary agreed each can close.\n- O-12: the inequality is recomputed for both deployments, including the write term and the concurrency bound.\n- O-18: marketdata is added, the rule is PRESERVE-at-risk where 1000 runs, and the operator has signed off. Writing the sign-off to `context.md` is the orchestrator's step.\n- O-19: one passthrough covers every error return, `InsertBars` and `rows.Err()`.\n- O-20: the instrument is named `out_of_memory_errors` and the assumption is documented.\n- O-21: both residuals are recorded.\n- O-22: the slack is out of scope, with the reason.\n\n**Corrections to the proposal.**\n- The write bound is 1000, not 5000. The operator's sign-off covers \"any deployment that runs the 1000-bar depth\", so 1000 is the largest value a config edit may reach without a new design pass.\n- The proposal's \"strongest risk\" was misframed. The defect was reported on the homelab, so the real gap is that a deploy alone does not deliver the fix there. The launch steps close it.\n- The config read gets a timeout and a fail-safe to 200, so it cannot block the chart.\n\n**Still blocking.** One item: the product-spec forbids a config key and a migration, and no recorded decision amends it. The steer's example points at a seeded key, which makes the mechanism likely acceptable, but the amendment and its sanction must be written down before approval.\n\n**Operator decisions.**\n- Root cause was located before the fix (D-1).\n- The breach metric is added and kept in marketdata.\n- The depth is 200 by default and 1000 on the homelab.\n- Feature 153 `@AC-1` is PRESERVE-at-risk where 1000 runs.\n- \"200 bars for DO is fine\" is what sanctions AC-1 and AC-3 holding only on the homelab.\n\n**MCP check.** The relayed request asks to use the MCP to read the values. I tried: the homelab MCP reads config only, and Grafana Cloud has no SQL datasource and no Postgres settings metrics. The database values therefore stay a `psql` runbook step, and that is flagged for the gate.",
    "register_delta": {
      "new_decisions": [
        {
          "text": "D is the global `ui`-namespace config key `chart.indicator_history_bars` (int, default 200), seeded for staging and production by config migration `050_ui_chart_history_bars` with `ON CONFLICT … DO NOTHING`, write-bounded to [200, 1000]. The homelab sets 1000 through `set_config`; DigitalOcean stays at 200. Environment scoping is not used. Supersedes D-5 and the `HISTORY_BARS = 1000` half of D-15; `CHART_WINDOW_BARS = 200` stands.",
          "evidence": "Operator ruling 2026-11-15, round 3 (200 on DigitalOcean, 1000 on the homelab; supersedes 'D = 1000 everywhere'); `migrations/023_ui_performance_keys.up.sql:17-32`; `configServiceImpl.ts:114`. The adversary required the 1000 ceiling. Subject to the open product-spec amendment objection."
        },
        {
          "text": "The UI reads D one-shot through `traderConfigClient.getConfig({ namespace: 'ui' })` and a pure `readHistoryBars` in `src/lib/indicatorChart.ts` that falls back to `DEFAULT_HISTORY_BARS = 200` on absence, wrong type, error or timeout and clamps to [`CHART_WINDOW_BARS`, `MAX_HISTORY_BARS` = 1000]. The clamped D is the `pageSize` sent and the `requestedBars` given to `windowIndicatorSeries`.",
          "evidence": "`traderConfigClient.ts:7-8`, `traderBff.ts:168-169`, `performanceMetrics.ts:14-16`, `:192-195`. The adversary found no F-07 breach in a one-shot `GetConfig`."
        },
        {
          "text": "At D = 200 a full page never shows 'Not enough history' (D-11 unchanged); long-warm-up components render with leading gaps, so SMA200 on DigitalOcean stays a single dot. AC-1 and AC-3 hold only where D ≥ W + P − 1. Recorded in design.md as an operator-accepted residual.",
          "evidence": "Operator ruling 2026-11-15 ('200 bars for DO is fine'); D-11. The adversary did not petition D-11."
        },
        {
          "text": "The homelab raise to 1000 is a launch step in a new section of `docs/runbooks/ohlcv-lock-budget-tuning.md`: a read-only `SHOW` of `max_locks_per_transaction`, `max_connections` and `max_prepared_transactions` plus a chunk-width query, the lock inequality computed with them (`mlpt ≥ 404` at 30-day chunks), then `set_config`, then a LYFT SMA200 smoke test. A failed gate escalates to the operator.",
          "evidence": "Operator steer for round 4; `ohlcv-lock-budget-tuning.md:41-53`, `:77-96`; defect report `:6` (homelab). No connected tool can read the DB values (checked this round)."
        },
        {
          "text": "The breach counter is `marketdata.ohlcv.out_of_memory_errors` with `op` in {bars, recent_bars, bars_batch, insert_bars}. One `observeLockBreach(ctx, op, err) error` passthrough wraps every returned error in `QueryBars`, `QueryRecentBars`, `QueryBarsBatch` and `InsertBars`, including `rows.Err()`. The lock-table reading of 53200 is documented in the marketdata `CLAUDE.md` § Observability. The counter stays in marketdata.",
          "evidence": "`marketdata_repo.go:13`, `:67-69`, `:91-95`, `:119-128`, `:171-173`, `:190-198`, `:487-494`; fails.md:3060; operator steer (feature 343 depends on it). The adversary said O-19 and O-20 can close."
        },
        {
          "text": "Feature 153 `@AC-1` is PRESERVE on DigitalOcean at 200 and PRESERVE-at-risk wherever 1000 runs. xstockstrat-marketdata and xstockstrat-config join Affected Services. The operator sign-off is written to `context.md`.",
          "evidence": "Operator sign-off 2026-11-15, round 3; `services/xstockstrat-marketdata/acceptance/fix-ohlcv-chunk-lock-oom.feature:11-15`."
        },
        {
          "text": "Lock budget of record: DigitalOcean at 200 needs at most 2,400 locks per scan and 9,600 at 4 scans against 25,600 (unchanged from today). The homelab at 1000 with 30-day chunks needs at most 404 per scan. The write term is distinct chunks × 4, not rows.",
          "evidence": "`ohlcv-lock-budget-tuning.md:20-24`, `:46-53`, `:63`; `marketdata_service.go:465-477`, `:337-350`. The adversary said O-12 can close."
        }
      ],
      "new_rejected": [
        {
          "text": "Write bound `maxValue: 5000` (the `GetBars` page cap) on `chart.indicator_history_bars`.",
          "why": "It lets one config edit exceed the operator's sign-off for feature 153 `@AC-1` on the shared DigitalOcean cluster. 1000 is the signed-off ceiling."
        },
        {
          "text": "A new homelab-only env var or build arg carrying D.",
          "why": "It keeps a per-deployment value outside the config service, against root config governance, and needs deploy-file edits on both platforms."
        },
        {
          "text": "Environment scoping (staging vs production rows) to separate DigitalOcean from the homelab.",
          "why": "Both deployments run `APPLICATION_ENV` staging, so the environment cannot tell them apart."
        },
        {
          "text": "Timeframe-aware slack in `defaultBarLookback` as part of this fix.",
          "why": "At 200 the slack is today's behaviour; on the homelab 30-day chunks cap the cost at 101 chunks. It would change a shared helper for every implicit-window caller."
        }
      ],
      "new_objections": [
        {
          "text": "P-04/P-03: the product-spec's Fix Scope and Out of Scope forbid a config key and a migration. Amend both, record the operator's sanction for the seeded key and migration 050 in `context.md`, and note the new-config-key approval (owner + config team), or send the product-spec back for re-review.",
          "blocking": true
        },
        {
          "text": "C-16: design.md must carry `maxValue: 1000` and one exported `MAX_HISTORY_BARS = 1000` for the reader clamp, not the proposal's 5000. Adopted in the synthesis; the proposer has not confirmed.",
          "blocking": false
        },
        {
          "text": "C-15: the spec must carry the three ordered homelab launch steps (runbook lock gate, `set_config` to 1000, LYFT SMA200 smoke test) and the rule that a failed gate escalates to the operator, because a deploy alone seeds 200 where the defect was reported.",
          "blocking": false
        },
        {
          "text": "P-03: the relayed request says to read the values through the MCP, but no connected tool can read the homelab DB settings. State at the gate that the runbook uses `psql`, so the operator can accept that or name another tool.",
          "blocking": false
        },
        {
          "text": "The runbook section must say that only the homelab `staging` row is set, and that a later homelab production deployment starts at 200 and needs the same gate and `set_config`.",
          "blocking": false
        },
        {
          "text": "The config read must use a short timeout, `staleTime: Infinity` and the fallback to 200 on timeout, and `windowIndicatorSeries` must receive the clamped D actually sent as `pageSize`.",
          "blocking": false
        },
        {
          "text": "Add the reader entry to `scripts/config-wiring.json` after reading the checker; update the UI `CLAUDE.md` to name `traderBff.ts:166-170` as a `ui`-namespace forward and record that `/trader` now reads `ui`; reword `acceptance.feature` AC-1 and AC-3 so the precondition names the configured depth.",
          "blocking": false
        }
      ],
      "closed_objections": [
        {
          "id": "O-12",
          "how": "Recomputed for both deployments with the concurrency bound and the write term: DigitalOcean at 200 is unchanged and passes (at most 9,600 of 25,600); the homelab at 1000 needs at most 404 locks per scan on 30-day chunks, gated by the runbook SHOW and chunk query."
        },
        {
          "id": "O-18",
          "how": "xstockstrat-marketdata is added to Affected Services; feature 153 `@AC-1` is PRESERVE on DigitalOcean and PRESERVE-at-risk where 1000 runs; the operator signed off (2026-11-15) and the sign-off goes to `context.md`. The write bound is capped at the signed-off 1000."
        },
        {
          "id": "O-19",
          "how": "One `observeLockBreach` passthrough wraps every returned error in the three reads and `InsertBars`, including `rows.Err()`; the Go test injects 53200 through `rows.Err()`."
        },
        {
          "id": "O-20",
          "how": "The instrument is named `marketdata.ohlcv.out_of_memory_errors`, and the lock-table assumption is documented in the marketdata `CLAUDE.md` § Observability."
        },
        {
          "id": "O-21",
          "how": "Both residuals are recorded in design.md: pool hold time (homelab only, signal `marketdata.db.pool.empty_acquire_wait`) and the pre-004 chunks, unchanged on DigitalOcean because D is not raised there."
        },
        {
          "id": "O-22",
          "how": "design.md states that a timeframe-aware slack is out of scope, with the reason."
        }
      ],
      "reopen_petitions": [
        {
          "target": "D-5",
          "evidence": "Proposer: the operator ruling of 2026-11-15, round 3 (shared DigitalOcean DB so 200; the homelab has its own DB so 1000) postdates D-5 and makes D a per-deployment value. The operator steer reopens D-5 by name.",
          "is_new": true
        },
        {
          "target": "D-15",
          "evidence": "Proposer: the same operator ruling supersedes 'D = 1000 everywhere', which is D-15's only evidence for `HISTORY_BARS = 1000`. `CHART_WINDOW_BARS = 200` stays. The adversary judged the evidence new.",
          "is_new": true
        },
        {
          "target": "R-9",
          "evidence": "Proposer: R-9 was locked on the superseded 'keep 1000' ruling; 200 on DigitalOcean is now the operator's own ruling. The adversary judged it valid for DigitalOcean only; the homelab stays at 1000.",
          "is_new": true
        }
      ],
      "reopened": [
        "D-5",
        "D-15",
        "R-9"
      ]
    }
  },
  "floor_breaches": []
}
```

## Session 2026-11-15 — sdd-batch design gate (round 5)

`/sdd-design fix-indicator-pane-warmup` (full) is halted at its approval gate after round 5 (gate
policy: halt). design.md is not written and status.md is unchanged. The register is in `debate.md`
(D-1..D-30, R-1..R-19, O-1..O-32, P-1..P-3).

Operator input relayed for this round, verbatim (2026-11-15): "1. Approved", "2. Confirmed",
"3. Sign-off the change, amend it", "4. There are no production instances. Staging is enough."

### Open Threads

- **Approach (round 4 stands; D-25..D-30 new).** The additive `first_value_bars = 5` proto field,
  the analysis helper, the `windowIndicatorSeries` seam, the `EmptyState` pane, the breach counter
  and the config key `chart.indicator_history_bars` (default 200, bounds [200, 1000], one-shot
  read with fallback to 200) are unchanged. Three things change:
  - **Homelab lock inequality, computed (D-25).** The values come from the homelab-edge repo, not
    a discovery step: `max_locks_per_transaction` 1024 and `max_connections` 70
    (`roles/db_host/defaults/main.yml:12-13`), `max_prepared_transactions` stock 0. Budget =
    1024 x (70 + 0) = 71,680 slots. At D = 1000 on 30-day chunks a scan needs at most 404 locks,
    28,280 at c = 70. It passes. 1-day chunks (only after a restore from a DigitalOcean dump) fail
    and escalate to the operator. The "raise mlpt to 512" fallback is dropped.
  - **Runbook section "Homelab deep indicator history" (D-26, D-27, D-28).** Read-only
    preconditions: homelab-edge `verify` green after PR #79 is applied (it asserts
    `max_locks_per_transaction` only), one `psql` read of `max_connections`,
    `max_prepared_transactions` and chunk width, and `list_config_keys ui` showing the key. Then
    three ordered steps: `set_config` to 1000 through the homelab MCP with `create_key` false and
    an admin session, then `get_config`; reload the LYFT symbol page and confirm an SMA200 line;
    observe after several deep-history symbol-page loads that
    `marketdata.ohlcv.out_of_memory_errors{op="recent_bars"}` shows no increase, with `GetBars`
    spans as the positive control. Only the homelab `staging` row is set; no homelab-production
    procedure is written.
  - **Product-spec amendment text agreed (D-29).** Fix Scope allows exactly one new key
    `ui.chart.indicator_history_bars` and exactly one config seed migration
    `NNN_ui_chart_history_bars`; Out of Scope excludes any other key or migration; Affected
    Services gain xstockstrat-marketdata and xstockstrat-config.
  - The migration number is resolved at execute time, 050 as of this round (D-30).
- **Strongest open objection (O-23, blocking, P-04/P-03).** The operator sanctioned the amendment
  ("Sign-off the change, amend it") and the text is agreed, but it is not yet written. O-23 closes
  when the product-spec Fix Scope and Out of Scope are edited, this file records the sanction, the
  reopens, the feature 153 sign-off and the approval-flow note (a new config key needs owner +
  config team, `docs/runbooks/approval-flow.md`), and `feature.md` gains a Status History row.
  Design approval is held until then. This session entry does not make those edits.
- **Open, non-blocking.** O-29 (the config-wiring checker is unread, so the
  `scripts/config-wiring-stored.json` row is an assumption; a spec task). O-30 (renumber the
  migration if a peer feature takes 050). O-31 (launch step 1 preconditions in the runbook; the
  proposer has not confirmed). O-32 (the runbook keeps one `psql` read and must cite the
  homelab-edge playbook path it depends on).
- **Closed this round.** O-24, O-25, O-26, O-27, O-28.
- **Register.** D-5, D-15 and R-9 are operator-reopened. P-1..P-3 still read "pending user" in
  `debate.md`; the synthesis resolves them as "user reopened" when the amendment record is
  written.
- **Floor status.** No Floor breach. The adversary found the proposal sound with no register
  violation.
- **Uncovered `@AC` changes.** AC-2 and AC-4 are EXTEND with no operator decision covering them.
  AC-1 and AC-3 are EXTEND and covered (their preconditions become "with the configured history
  depth of 1000 bars"). Feature 153 `@AC-1` is PRESERVE on DigitalOcean and PRESERVE-at-risk
  where 1000 runs, signed off 2026-11-15. `opportunity-live-market-enrichment @AC-4` and the
  `platform.feature` GetBars warm-set rule are PRESERVE.
- **Main risks.** The homelab pass rests on homelab-edge PR #79 being applied (merged, not
  applied; on stock mlpt 64 the budget is 4,480). The 30-day chunk width is unconfirmed until the
  chunk query runs. The fix reaches the homelab only after the manual `set_config`. DigitalOcean
  users still see SMA200 as a single dot (operator-accepted). Most path:line citations carried
  from round 4 were not re-verified.

```sdd-batch-design-state
{
  "round": 5,
  "synth": {
    "approach": "Round 5 synthesis. The round-4 synthesis stands whole (sections 1-4 and 7-10: additive `first_value_bars = 5`, the analysis helper, the `windowIndicatorSeries` seam, the `EmptyState` pane, the breach counter, config key `chart.indicator_history_bars` default 200 bounded [200, 1000], `MAX_HISTORY_BARS = 1000`, short-timeout one-shot config read with fallback to 200). Three things change, plus adversary corrections the mediator adopts.\n\n**Mediator checks this round (read-only, in the trees).**\n- `/home/user/homelab-edge/roles/db_host/defaults/main.yml:12-13`: `max_connections: 70`, `max_locks_per_transaction: 1024`. `max_prepared_transactions` is not set there (stock 0).\n- `/home/user/homelab-edge/roles/db_host/tasks/verify.yml:20-30` reads live `current_setting('max_locks_per_transaction')` and fails on mismatch. It does not read `max_connections`.\n- `/home/user/homelab-edge/inventories/prod/group_vars/all/main.yml:156`: `db_pgbouncer_pool_size: 10` per database.\n- `/home/user/xstockstrat/docs/runbooks/ohlcv-lock-budget-tuning.md:17`, `:48`: the formula is `mlpt x (max_connections + max_prepared_transactions)`; `:27` readiness uses a fixed 400-day window.\n- Last config migration in the tree is `049_notify_commsgun_channel_keys`.\n- `/home/user/xstockstrat/scripts/config-wiring-stored.json` exists and `/home/user/xstockstrat/scripts/config-wiring.test.mjs:15` reads it; the exact entry shape is still unread (spec task).\n- `/home/user/xstockstrat/services/xstockstrat-agent/app/tools.py:1895-1902`: `set_config` refuses an unregistered key with NOT_FOUND unless `create_key=true`.\n- Other path:line citations are carried from the proposal and adversary, not re-verified.\n\n**1. Homelab lock inequality of record (computed, replaces D-21's \"SHOW then compute\").**\n- Budget = 1024 x (70 + 0) = 71,680 lock slots.\n- D = 1000 gives a 3000-day implicit window (`marketdata_service.go:467-477`). With 30-day chunks: at most 101 chunks x 4 relations = 404 locks per scan; the write term is the same 404.\n- At the worst-case concurrency c = max_connections = 70: 28,280 of 71,680. Passes, with at least 43,400 slots left. 404 is also below mlpt, so no scan borrows from the shared table.\n- The runbook states one failure path for chunk width, not a three-bound table: 1-day chunks appear only if the homelab DB was restored from a DigitalOcean dump (fresh deploy with migration 004 before first insert gives 30-day chunks, including for backfilled old data). 1-day chunks need 8,280-12,000 locks per scan, fail at c = 70, and escalate to the operator.\n- The \"raise mlpt to 512\" fallback is dropped. 1024 is the asserted value; if a live value differs, recompute with it, do not tune.\n\n**2. Runbook section \"Homelab deep indicator history\" in `docs/runbooks/ohlcv-lock-budget-tuning.md`.**\nValues of record cite the homelab-edge paths above, not \"the operator's reading of PR #79\".\nPreconditions (read-only; needed because homelab-edge PR #79 is merged but not yet applied):\n- homelab-edge `verify` green after PR #79 is applied (covers `max_locks_per_transaction` = 1024, `roles/db_host/tasks/verify.yml:20-30`).\n- One `psql` read per `docs/runbooks/operator-db-access.md`: `SHOW max_connections;`, `SHOW max_prepared_transactions;` and the existing chunk-width query. Expected 70 / 0 / 30-day chunks.\n- Migration 050 is applied on the homelab staging DB: `list_config_keys ui` shows `chart.indicator_history_bars`.\n- Any differing value: recompute. Any failure: escalate to the operator; do not silently ship 200.\nLaunch steps, in order:\n1. `set_config` namespace `ui`, key `chart.indicator_history_bars`, value 1000 through the homelab MCP, with `create_key` left false and an admin session (the write is global); then `get_config` to confirm. A NOT_FOUND means migration 050 is missing; do not create the key by hand.\n2. Smoke test: reload the LYFT symbol page (the config read is `staleTime: Infinity`, so an open tab keeps 200) and confirm an SMA200 line draws.\n3. Observation, not a pass/fail load test: load LYFT plus a few deep-history symbol pages at D = 1000, ideally in parallel tabs. Then check `increase(marketdata.ohlcv.out_of_memory_errors{op=\"recent_bars\"})` over that window is zero or the series is absent (the counter is lazily bound). Positive control: marketdata `GetBars` spans or `marketdata.db.pool.empty_acquire_wait` show the reads happened. A readiness cycle is not the check, because readiness uses the fixed 400-day window and never runs the 3000-day scan.\nOne line on scope: only the homelab `staging` row is set. The homelab-production prose is dropped (operator: \"There are no production instances. Staging is enough.\"). Migration 050 still seeds both environment rows at 200, matching `migrations/023_ui_performance_keys.up.sql:17-32`.\n\n**3. Product-spec amendment (operator sanction, verbatim: \"Sign-off the change, amend it\").**\n- Fix Scope, Config: \"exactly one new key, `ui.chart.indicator_history_bars` (int, default 200, bounds [200, 1000])\".\n- Fix Scope, Database: \"exactly one config seed migration in `services/xstockstrat-config/migrations/` (`NNN_ui_chart_history_bars`, 050 as of this round); no service-schema migration\".\n- Out of Scope: \"any database migration or config key beyond the one key and its seed migration in Fix Scope\".\n- Affected Services gain xstockstrat-marketdata and xstockstrat-config.\n- `context.md` records: the verbatim sanction and date; the operator reopen of D-5, D-15 and R-9 (P-1..P-3 verdict \"user reopened\"); the feature 153 `@AC-1` PRESERVE-at-risk sign-off; the approval-flow note that a new config key needs owner + config team (`docs/runbooks/approval-flow.md`).\n- `feature.md` gains a `## Status History` row for the amendment (P-04 phase-gate event). Re-review only if the operator asks.\n\n**4. Spec-level corrections adopted.**\n- Migration number: the spec step re-checks the last config migration at execute time and renumbers if a peer feature in this batch took 050; the number is not fixed in the spec.\n- Config wiring: the spec reads `scripts/config-wiring.test.mjs` and adds the reader entry to `scripts/config-wiring.json` and, if the checker requires it, the seeded row to `scripts/config-wiring-stored.json`.\n- UI `CLAUDE.md` notes `traderBff.ts:166-170` as a `ui`-namespace forward and that `/trader` now reads `ui`. `acceptance.feature` AC-1 and AC-3 preconditions read \"with the configured history depth of 1000 bars\".\n- The gate statement: the homelab DB values now come from the homelab-edge repo; `psql` is used only for the single live read above; the MCP is used for `set_config`, `get_config` and `list_config_keys`.\n\n**Build order** is unchanged from round 4 (proto, analysis, marketdata counter, config migration and bounds, UI reader and seam, pane, e2e, runbook and docs, homelab launch).\n\n**Touchpoints.** One additive proto field; one config seed migration; one new config key; one new marketdata counter.",
    "open_objections": [
      {
        "text": "O-23 (P-04/P-03): the operator sanctioned the amendment ('Sign-off the change, amend it') and the amendment text is agreed. It closes when the orchestrator writes it: the product-spec Fix Scope and Out of Scope edits, the `context.md` entry with the verbatim sanction and the approval-flow note (owner + config team), and a `feature.md` Status History row. Until those are written, design approval is held.",
        "blocking": true
      },
      {
        "text": "O-29 (spec task): the proposer has still not read `scripts/config-wiring.test.mjs`. `scripts/config-wiring-stored.json` exists and the checker reads it, but whether the seeded key needs a row there, and its shape, is unconfirmed. The spec must read the checker before writing either entry; it must also carry the UI `CLAUDE.md` note and the AC-1/AC-3 rewording.",
        "blocking": false
      },
      {
        "text": "Migration number: 050 is free in the tree today, but three peer features in this batch could add a config seed and golang-migrate fails on a duplicate version. The spec step must re-check the last config migration at execute time and renumber, and the product-spec amendment should name the migration by slug with 050 as the current number.",
        "blocking": false
      },
      {
        "text": "Launch step 1 preconditions must be in the runbook: migration 050 applied on the homelab staging DB (`list_config_keys ui` shows the key), `create_key` stays false, the write needs an admin session, and the smoke test reloads the page because the config read is `staleTime: Infinity`. Adopted in the synthesis; the proposer has not confirmed.",
        "blocking": false
      },
      {
        "text": "homelab-edge `verify` asserts `max_locks_per_transaction` only. `max_connections` = 70 and `max_prepared_transactions` = 0 are set or defaulted in source but not asserted live, so the one `psql` read stays in the runbook. The runbook now cites a second repo's playbook; it must name the path so the coupling is visible.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "AC-1",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "AC-2",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-3",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
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
        "ac_id": "marketdata fix-ohlcv-chunk-lock-oom @AC-1 (feature 153) — PRESERVE on DigitalOcean at 200; PRESERVE-at-risk wherever 1000 runs (operator signed off 2026-11-15)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": true
      }
    ],
    "rejected_alternatives": [
      "R-1 to R-8 and R-10 to R-15 stand unchanged. R-9 is operator-reopened: the default is 200 and 1000 is the ceiling.",
      "Branching on `HOST_PROVIDER` (`homelab ? 1000 : 200`), the proposer's runner-up. It needs no migration and no manual `set_config`, but it puts a per-deployment value in source against config governance, the same reasoning that locked R-13. The adversary agreed; it is now rejected, not held for the gate.",
      "A readiness cycle as the launch check for the breach counter. Readiness uses the fixed 400-day window and never runs the 3000-day scan, and an absent lazily-bound series cannot be told from a flat one.",
      "A three-`SHOW` `psql` discovery step as the homelab gate. The values are set in homelab-edge source and `verify` already asserts `max_locks_per_transaction` live; one `psql` read covers the rest.",
      "The 'raise `max_locks_per_transaction` to 512' fallback. 1024 is already the asserted homelab value; a lower live value means recompute and escalate, not tune.",
      "Runbook prose for a later homelab production deployment. The operator stated there are no production instances and staging is enough.",
      "A three-bound concurrency table (c = 4, 20, 70) for 1-day chunks in the runbook. The gate certifies only at c = max_connections, and 1-day chunks escalate whatever the bound.",
      "A fixed migration number 050 in the spec. Peer features in this batch may take it; the number is resolved at execute time."
    ],
    "open_risks": [
      "The homelab pass rests on homelab-edge PR #79 being applied. It is merged but not applied; on stock mlpt 64 with 70 connections the budget is 4,480 and 30-day chunks pass only at c of 11 or fewer.",
      "The 30-day chunk width on the homelab rests on the fresh-deploy statement until the chunk query runs. A DB restored from a DigitalOcean dump would have 1-day chunks and block the raise.",
      "The fix reaches the homelab only after a manual `set_config`. If the launch steps are skipped, the homelab keeps the single dot.",
      "DigitalOcean users still see SMA200 as a single dot on a full 200-bar page, with no notice (operator-accepted).",
      "The bound of 1000 cannot tell deployments apart. An admin could set 1000 on DigitalOcean; only the key description, the runbook and the counter guard against it.",
      "Other workloads on the homelab Postgres share the lock table. They are bounded by max_connections but their per-backend lock use was not measured.",
      "`max_connections` and `max_prepared_transactions` are not asserted by homelab-edge `verify`; only the runbook's `psql` read observes them.",
      "The runbook depends on a playbook in a second repo (homelab-edge `verify`); a rename there silently breaks the precondition.",
      "A 53200 from a cause other than lock-table exhaustion also increments the counter. The counter detects a breach; it does not prevent one.",
      "The config-wiring checker's requirements for the new reader and the seeded row are unread.",
      "The migration number may collide with a peer feature in this batch.",
      "The product-spec is amended after approval without re-review; the operator sanctioned this, but the config-team approval for the new key is still to be obtained.",
      "The config read adds a round trip before the first bars request; analysis compute and polled payload grow with D on the homelab.",
      "Most path:line citations in sections carried from round 4 were not re-verified by the mediator."
    ],
    "constitution_rules_touched": [
      "P-02",
      "P-03",
      "P-04",
      "C-01",
      "C-03",
      "C-05",
      "C-07",
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
    "rationale": "**Verdict.** The adversary found the proposal SOUND with no Floor breach and no register violation. I checked the homelab values in the homelab-edge tree and the arithmetic holds: 1024 x 70 = 71,680 slots against 28,280 at the worst-case bound.\n\n**Register.**\n- The approach rests on D-1 to D-4, D-6 to D-14, D-16 to D-20 and D-22 to D-24.\n- D-21 is refined, not contradicted: the gate is still a runbook step before `set_config`, but the inequality is now computed from operator-supplied values and the live read is a precondition. The operator steer directs this.\n- D-5, D-15 and R-9 are reopened by the operator steer by name. The register already marks them \"reopened @ round 4 (operator steer)\", and the relayed request (\"Approved\", \"Confirmed\") is consistent. P-1 to P-3 resolve as \"user reopened\" when the orchestrator writes `context.md`. No new petition from either side.\n- The `HOST_PROVIDER` runner-up is close to the locked R-13 and loses on the same reasoning, so it is recorded as rejected.\n\n**Closed this round.**\n- O-24: the proposer confirmed 1000.\n- O-25: the three ordered steps and the escalation rule are carried, with step 3 corrected to exercise the symbol-page path.\n- O-26: the values come from the homelab-edge repo; `psql` is one live read.\n- O-27: reduced to one line, per the operator's \"no production instances\".\n- O-28: the proposer confirmed.\n\n**Still open.**\n- O-23 stays blocking until the amendment and its record are written. The sanction itself is given: item 3 of the relayed request is the operator's own words.\n- O-29 stays open, non-blocking: the checker is unread, so the stored-JSON entry is still an assumption.\n\n**Corrections to the proposal.**\n- Launch step 3 checked a path D does not touch. It is now an observation after symbol-page loads, with a positive control.\n- The precondition reuses homelab-edge `verify` for mlpt. I found `verify` does not assert `max_connections`, so the `psql` read keeps it.\n- Step 1 states that migration 050 must be applied and `create_key` stays false.\n- The homelab-production prose and the 512 fallback are dropped.\n- The migration number is resolved at execute time.\n\n**Operator decisions honoured.** Root cause located first (D-1); breach metric added; 200 by default and 1000 on the homelab; feature 153 `@AC-1` PRESERVE-at-risk where 1000 runs; one new key and its seed migration sanctioned.",
    "register_delta": {
      "new_decisions": [
        {
          "text": "Homelab lock budget of record, refining D-21 and D-24: 1024 x (70 + 0) = 71,680 slots. At D = 1000 on 30-day chunks a scan needs at most 404 locks, 28,280 at c = max_connections = 70. The gate certifies only at c = max_connections. 1-day chunks (possible only after a restore from a DigitalOcean dump) fail and escalate to the operator. The 'raise mlpt to 512' fallback is dropped; a differing live value means recompute, not tune.",
          "evidence": "Operator steer for round 5; `/home/user/homelab-edge/roles/db_host/defaults/main.yml:12-13`; `/home/user/homelab-edge/inventories/prod/group_vars/all/main.yml:156`; `docs/runbooks/ohlcv-lock-budget-tuning.md:17`, `:48`; `marketdata_service.go:467-477`. The adversary checked the numbers and concurred."
        },
        {
          "text": "The runbook gate is a read-only precondition, not a discovery step: homelab-edge `verify` green after PR #79 is applied (covers `max_locks_per_transaction`), one `psql` read of `max_connections`, `max_prepared_transactions` and chunk width, and `list_config_keys ui` showing the key (migration applied). The runbook cites the homelab-edge paths as the values of record.",
          "evidence": "Operator steer for round 5 (keep a read-only verification, PR merged but not applied); `/home/user/homelab-edge/roles/db_host/tasks/verify.yml:20-30` asserts mlpt only (mediator check); `docs/runbooks/operator-db-access.md`. Adversary proposal, adopted."
        },
        {
          "text": "Homelab launch steps, in order: (1) `set_config ui chart.indicator_history_bars 1000` through the homelab MCP with `create_key` false and an admin session, then `get_config`; (2) reload the LYFT symbol page and confirm an SMA200 line; (3) an observation after several deep-history symbol-page loads that `marketdata.ohlcv.out_of_memory_errors{op=\"recent_bars\"}` shows zero increase or is absent, with `GetBars` spans or `marketdata.db.pool.empty_acquire_wait` as the positive control. Step 3 is not a pass/fail load test and not a readiness cycle.",
          "evidence": "`services/xstockstrat-agent/app/tools.py:1895-1902` (NOT_FOUND on an unregistered key); `ohlcv-lock-budget-tuning.md:26-27`, `:43-44`; D-16 (lazy binding); `deploy/homelab/compose.yml:7`. Adversary objection, adopted."
        },
        {
          "text": "Only the homelab `staging` row is set to 1000, stated in one runbook line. No homelab-production procedure is written. The seed migration still seeds both environment rows at 200.",
          "evidence": "Operator, relayed request 2026-11-15: 'There are no production instances. Staging is enough.'; `migrations/023_ui_performance_keys.up.sql:17-32`."
        },
        {
          "text": "The product-spec is amended under the operator sanction: Fix Scope allows exactly one new key `ui.chart.indicator_history_bars` (int, default 200, bounds [200, 1000]) and exactly one config seed migration `NNN_ui_chart_history_bars`; Out of Scope excludes any other migration or key. `context.md` records the verbatim sanction, the reopens, the feature 153 sign-off and the owner + config team approval note; `feature.md` gains a Status History row. No re-review unless the operator asks.",
          "evidence": "Operator, design gate round 4 and relayed request 2026-11-15, verbatim: 'Sign-off the change, amend it'; `docs/runbooks/approval-flow.md`. The adversary judged the text correct and in scope."
        },
        {
          "text": "The config seed migration number is resolved at execute time: the spec step re-checks the last config migration and renumbers if 050 is taken. 050 is the number as of round 5.",
          "evidence": "Last migration in the tree is `049_notify_commsgun_channel_keys` (mediator check); three peer features in this batch may add config seeds; golang-migrate fails on a duplicate version."
        }
      ],
      "new_rejected": [
        {
          "text": "Branching on the `HOST_PROVIDER` env (`homelab ? 1000 : 200`) to carry D.",
          "why": "It puts a per-deployment value in source against root config governance and turns an OTel resource attribute into behaviour; same reasoning as the locked R-13. Both sides agreed."
        },
        {
          "text": "A readiness cycle as the launch check for the breach counter.",
          "why": "Readiness uses the fixed 400-day window, so it never runs the 3000-day scan D changes, and an absent lazily-bound series cannot be told from a flat one."
        },
        {
          "text": "A 'raise `max_locks_per_transaction` to 512' fallback in the homelab gate.",
          "why": "1024 is already the value asserted by homelab-edge; a lower live value means the host is not in the expected state, so recompute and escalate."
        },
        {
          "text": "A runbook procedure for a later homelab production deployment.",
          "why": "The operator stated there are no production instances and staging is enough (YAGNI, C-18)."
        }
      ],
      "new_objections": [
        {
          "text": "The spec must resolve the config seed migration number at execute time and renumber if a peer feature took 050; the product-spec amendment names the migration by slug.",
          "blocking": false
        },
        {
          "text": "The runbook must state launch step 1's preconditions: migration applied (`list_config_keys ui`), `create_key` false, admin session, and a page reload before the smoke test. Adopted in the synthesis; the proposer has not confirmed.",
          "blocking": false
        },
        {
          "text": "homelab-edge `verify` asserts only `max_locks_per_transaction`; the runbook keeps one `psql` read for `max_connections` and `max_prepared_transactions` and must cite the homelab-edge playbook path it depends on.",
          "blocking": false
        }
      ],
      "closed_objections": [
        {
          "id": "O-24",
          "how": "The proposer confirmed `maxValue: 1000` and one exported `MAX_HISTORY_BARS = 1000`."
        },
        {
          "id": "O-25",
          "how": "The runbook carries the precondition and three ordered launch steps with escalation on a failed gate; step 3 is corrected to observe the symbol-page path with a positive control."
        },
        {
          "id": "O-26",
          "how": "The operator supplied the values from the homelab-edge repo; homelab-edge `verify` covers mlpt and `psql` is one read-only check, stated at the gate. The MCP is used for the config calls."
        },
        {
          "id": "O-27",
          "how": "Reduced to one runbook line that only the homelab `staging` row is set; the production prose is dropped per the operator ('There are no production instances. Staging is enough.')."
        },
        {
          "id": "O-28",
          "how": "The proposer confirmed the short timeout, `staleTime: Infinity`, fallback to 200 on timeout or error, and the clamped D passed as `requestedBars`."
        }
      ],
      "reopen_petitions": [],
      "reopened": [
        "D-5",
        "D-15",
        "R-9"
      ]
    }
  },
  "floor_breaches": []
}
```

# Context: block-fundamentals-strategy-on-etf  (archived 2026-11-10)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-11-10 — /sdd-archiver

**What**: The ask was "don't run a fundamentals strategy on an ETF". What shipped guards the root cause instead: *a strategy that reads fundamentals gets zero executable epochs for its declared metrics on this symbol*. That covers ETFs, non-SEC filers and un-backfilled symbols alike. Enforcement:
- Backtest refuses the symbol (NoTradeReason 5, no evidence cell).
- The live loop denies entry, with one WARN and one alert when a pair enters the unavailable state.
- Opportunities show a non-actionable skip row.
- Grade derivation excludes refused cells, without deleting them.

ETF-ness is only a best-effort label, from FMP `isEtf` via the cache-only `GetEtfFlags`. The feature also fixed a latent bug: the PIT loaders read only the first page of 50 periods.

On staging, refusal worked first time. The ETF label took three verification sessions to appear, and the cause was an expired FMP key (HTTP 401), not code.

**Why (irrecoverable rationale)**:
- **Origin.** The feature came out of the feature-211 @AC-5 rollout audit. There, SCHD produced a SILENT no-trade that looked like a genuine no-signal, which is why the operator wanted code enforcement rather than documentation.
- **Derivation can only err toward KEEPING a cell.** It judges calendar days, which are a superset of the trading days the backtest evaluated. So it can wrongly keep a cell, but can never wrongly drop one the backtest accepted.
- **UNAVAILABLE ranks first in precedence.** "Available if any channel is" would hide an empty required channel (round 1).
- **No ETF detector.** Every detection option failed recon:
  - Alpaca `class` is `us_equity` for ETFs too.
  - Finnhub `profile2` has no type field. The operator first picked "(b) vendor type==ETF" on that false premise.
  - FMP `isEtf` existed in the vendor payload but was never decoded.

  The operator re-chose "Hybrid: enforce on unavailable fundamentals, use FMP isEtf only to label". Enforcing on absence also works with classification off, which is the staging default.
- **Availability means "the evaluator would execute ≥1 epoch"**, computed by the same helper as `_fundamentals_formula_series`. Two narrower rules were rejected:
  - A copied six-metric `hasCoreMetrics` list gives false refusals on dividend-yield-only rows, false availability on market-cap-only rows, and drifts across languages.
  - Excluding quote-derived metrics would silently regress the `@AC-8 @feature-201` partial-row rule.
- **Error-distinct states: UNKNOWN / DISABLED / NOT_ASSESSED.** Analysis used to collapse fetch error, absence and gate-off into `[]`/`None`, so a guard on `[]` would refuse equities during any marketdata blip.
  - UNKNOWN is never a refusal.
  - DISABLED exists so that a source-disabled FailedPrecondition does not mean "perpetually unavailable" plus 300 s retries.
  - NOT_ASSESSED exists so that a bars outage or an empty window is never read as UNAVAILABLE.
- **Deny entry, never skip evaluation.** Skipping evaluation would suppress exits (live `_apply_transition`, the held-position REDUCE row). The opportunity skip applies only to `rule == "entry"`.
- **Failure keying.** `failures` is keyed by `(channel, symbol)` and lives as long as the cache. Keying by symbol alone let a fundamentals outage taint the same symbol's non-fundamentals rows; without the cache lifetime, failures were lost on cache hits.
- **Alert on state change only, not per cycle.** This avoids a WARN flood. Re-alerting after a restart is deliberate, because persisting the state would need a table (YAGNI).
- **Derivation-time exclusion overrides feature 065**, which decided that zero-trade cells count. It is legitimate only through the operator decision of 2026-10-10.
- **C-16 CHANGE sign-offs (2026-10-09).** The `@AC-8 @feature-201` note becomes refuse/deny instead of silently holding. `@AC-2 @feature-185` is rescoped to "symbols with fundamentals available".

**Rejected alternatives**:
- A docs-only guardrail — rejected 2026-09-27; the operator chose code enforcement.
- Rejecting the whole run — lost to per-symbol refusal, which fits the per-symbol backtest diagnostics shape.
- Reusing an existing INSUFFICIENT_DATA-style reason — lost to a new `NoTradeReason` value, which "is clearer for audit" despite the proto change.
- An on-demand `GetEtfStatus` RPC (one FMP fetch per call) — no deadline, an unbounded concurrent map and a widened `sectorSource`. Replaced by the cache-only `GetEtfFlags`, a bounded background fill and its own interface (round 2, G).
- Vendor `type=="ETF"` detection (Finnhub profile2): the field does not exist.
- A maintained ETF symbol set: not chosen. No reason is recorded beyond the operator choosing the hybrid.
- Blocking at `set_strategy_live`: a strategy definition has no symbol list. Shipped as eval-time enforcement plus docstring text instead.
- A copied core-metric list, or excluding quote-derived metrics: see Why.
- A per-bar guard: breaks `@AC-4 @feature-198` / `@AC-2 @feature-201`, where early bars hold until a later filing. Availability is judged per symbol over the window.
- Write-time DELETE of refused 0-trade cells: the round-3 proposer silently substituted it for the operator's choice, and it was reverted. It is destructive, deletes traded evidence, and leaves a legacy residual until a re-run.
- A refusal-marker column (migration 028) or a persisted `is_etf` (migration 010): schema changes the spec excluded, needing DBA review. Derivation exclusion gives the same result.
- Exempting traded cells from exclusion (`total_trades=0` only): rejected to honour the operator's literal "refused symbols dropped". It is the runner-up if OR-branch evidence should be kept.
- `enrichmentUnderCap` for the label fill: it can spend 100% of the shared FMP budget and starve the guard's own snapshot fetches. Hence the 80% headroom gate.
- A config key for the ETF TTL: owner plus config-team approval for a cosmetic label, when ETF status is effectively immutable. A fixed F-07 constant was used instead.
- A documented gap for the Signal-detail badge (it read only the first 50 queue rows): would need C-14 sign-off and a follow-up. The `ListOpportunitiesRequest.symbol` filter was the smaller fix.
- `GetFundamentalsMultiResponse.unavailable_symbols`: the single-symbol RPC already distinguishes absence from outage.

**Scars & gotchas**:
- **The design inverted the Finnhub error.** It wrapped `finnhub_client.go` "no fundamentals" as `ErrNoFundamentals`, but that path is reached ONLY on an outage: Multi `continue`s past every `fetchOne` error. Following the design would have turned default-provider outages into NotFound (absence), an FR-8 violation. Caught at impl-spec review; pinned by `finnhub_client_test.go:228-238`.
- **`BudgetSnapshot` cap 0 is not "uncapped".** The "cap <= 0 = uncapped" comment holds only for a nil-`Limits` client. Production always wires `Limits`, so cap 0 means zero budget, and the filler gates on `cap > 0` explicitly.
- **Quota ripple from the single-symbol switch.** Single-symbol `GetFundamentals` returns `RESOURCE_EXHAUSTED` for an uncached symbol, where Multi just omitted it. After the switch this reads as UNKNOWN, so the opportunity row is stamped "unavailable" and enters the 300 s retry.
- **Edgar Multi used to abort the whole batch.** With vendors off, edgar-mode `GetFundamentalsMulti` aborted on the first un-producible symbol; it now omits that symbol. The blend-universe resolver, the screener and `fundsignal_loop` therefore all receive partial lists.
- **The heal path never wrote `action`.** Forcing UNSPECIFIED before the `_resolve_action_tag` drop would resurrect dropped speculative-sell rows. The order is resolve, drop on None, then force.
- **The pager stall check is strict `(period_end, fiscal_period)` monotonicity, not token equality.** `parseHistCursor` falls back to page 1 on a bad token.
- **The boot recompute blocked live-loop startup.** It was awaited inline. It now runs off the startup path as a background task (via `supervision.spawn` since feature 259).
- **A swallowed GetFormula error bypassed the guard.** The `GetFormula` `RpcError` was swallowed and `[]` cached, so a formula-only fundamentals strategy read NOT_REQUIRED and skipped the guard. Fixed by recording `("formula", fid)` → UNKNOWN (design round-4 fix 1).
- **Verification route.** DO `apps-get-logs` returns only a URL with a token in it, which the session may not fetch. Grafana Loki `{service_name="marketdata"} |= "etf flag fill"` works. A SUCCESSFUL ETF fill logs nothing at Info, so the absence of failure records after a key fix means success.
- **Three descriptor-parity guards go red the moment the proto fields land**, so Steps 2-6 had to land together.
- **Mutual exclusion is untestable.** The `not fund_skip` term in `sym_unavailable` cannot be forced by a test, because there is no `await` between `assess` and the stamp.
- **Feature 225's merge broke a hand-built header.** 225's `test_single_owner_header_builder` failed on 215's `[("x-user-id", user_id)]`; switched to `owner_metadata(user_id)` (servicer.py:2908).
- **Refused-only runs rendered a blank UI.** `BacktestDiagnostics` was hidden for INSUFFICIENT_DATA. The operator chose option A and widened scope to `insights/strategies/[id]/page.tsx`.
- **The ETF-label hunt took three staging sessions.**
  - The 2026-10-15 hypotheses (quota-seed over-count closing the 80% gate, a Debug-only fill error, an empty profile) were all invisible at Info level. The over-count was real, and was later fixed by feature 255.
  - Once feature 230 added Info records, Loki showed `etf flag fill failed … class: http_401` on every run, from an expired or rejected FMP key.
  - The first `GetEtfFlags` after every restart is UNSPECIFIED by design, so a single post-deploy run can never prove the label.
- **Two post-deploy checks were unreachable as written.** `StrategyScore.evidence_symbols` is an `int32` count, and no MCP tool exposed `ScoreStrategy`. Launch waited for feature 283 (expose-score-strategy-mcp, `excluded_symbols` trailer).
- **The "technical strategy on SCHD evaluates normally" check exposed an unrelated defect.** `servicer.py` silently dropped symbols on any RPC error while reporting OK (feature 275). A `squeeze_breakout_trend` formula `PERMISSION_DENIED` seen 2026-11-02 stopped reproducing by 2026-11-04. It is likely the admin-formula-refusal class (strategy owner ≠ formula author) filed 2026-11-04 and fixed by feature 289, but that is unconfirmed.
- **AAPL never traded on staging.** The fscore composite stays at 0.333-0.393, below the 0.5 entry. This is strategy calibration, not the guard.

**Permanent deviations**:
- **Finnhub absence.** Design: Finnhub "no fundamentals" wraps `ErrNoFundamentals`. Shipped: Finnhub `GetFundamentals` calls `fetchOne` directly and never returns `ErrNoFundamentals`; only FMP wraps it. Because: that Finnhub path is reached only on an outage.
- **Interactive concurrency.** Design: interactive recomputes `gather` with no semaphore. Shipped: a fresh local `asyncio.Semaphore(_INTERACTIVE_DERIVATION_CONCURRENCY=4)` (servicer.py:314, 2805). Because: impl review wanted a bound without priority inversion.
- **Derivation headers.** Design: derivation `meta` is owner-only, plus `x-trace-id` on interactive triggers. Shipped: interactive triggers forward the full `_PROPAGATED_HEADERS` trio, while boot stays owner-only via `owner_metadata`. Because: C-03, and 225's single owner-header builder.
- **Derivation read path.** Design: `_fetch_and_aggregate` filters after `fetch_eligible`. Shipped: a new `fetch_all_for_fingerprint` (no `DISTINCT ON`, shared `_ELIGIBILITY_ORDER`) that filters before dedup. Because: post-dedup filtering loses a symbol's other eligible window.
- **Meaning of `excluded`.** It names only symbols with NO surviving cell. Naming a symbol that still contributes to the grade would be false.
- **Backtest DISABLED.** The design's backtest DISABLED state and its `@AC-9` backtest clause were dropped, because `GetHistoricalFundamentals` has no gate and the state is unreachable.
- **ETF label on live.** The live loop never calls `GetEtfFlags` (YAGNI).
- **NOT_ETF badge.** NOT_ETF renders the same "Fundamentals unavailable" text as UNSPECIFIED, to match the literal `@AC-4`.
- **UNKNOWN-only runs.** They report INSUFFICIENT_DATA but do not trigger a grade recompute.
- **Readiness parity.** It is behavioural for EvaluateReadiness and GetIndicatorSeries, but only structural (`inspect.getsource` pins no `failures=`) for the watchlist compute and the materializer. Their harnesses were outside Step 14's Files.
- **UI render gate.** `page.tsx` renders `BacktestDiagnostics` for INSUFFICIENT_DATA when any diagnostic has a non-UNSPECIFIED `noTradeReason`. This was operator option A, an F-08 exception; option B (a sentinel status 1) was declined.
- **Measurement timing.** The ">50-period symbols" measurement was planned before merge and done after: count 0, max 40.

**Cross-feature signal**:
- **Absence vs outage keeps recurring as a class.** Earlier cases: null read as zero, the pagination truncation, and 230's silent filler. A guard that turns "no data" into an action is only as good as the upstream layers that keep absence distinct from error.
- **215's post-deploy verification forced other features into existence**:
  - 230 (ETF fill visibility);
  - 275 (silent symbol skip reported as OK);
  - 283 (ScoreStrategy MCP exposure; launch gate "215 ↔ 283" in merge-order);
  - 255 (FMP quota seed filtered by source).
- **Cold-cache labels mislead verification.** A best-effort label behind a cold in-process cache is unset on the first read after every deploy.

**Deferred follow-ons**:
- **Promote `@AC-4`.** It is not yet in a durable suite. Add an e2e or `opportunityShared` vitest asserting that a skip row with gap UNSPECIFIED/NOT_ETF renders "Fundamentals unavailable" without "(ETF)", then promote it to `docs/sdd/business-rules/platform.feature`.
- **Re-audit `docs/patterns/ui-ux-governance.md` §8.** The `market/[symbol]` route reference is stale, and it says "two files" where there are now about 40.
- **Production grade cleanup.** Legacy-grade cleanup happens only when a trigger runs. Run `ScoreStrategy` for `fundamentals_macd_blend` on PROD after deploy; only staging is recorded as done.
- **Grade availability now depends on marketdata.**
  - A PIT outage at recompute time freezes the grade.
  - ManageStrategy UPDATE pops the in-memory grade before recomputing. After an UNKNOWN, `ListStrategies` therefore shows NO grade until the next successful trigger or a reboot hydrate.
  - Exclusion is only as correct as the paged PIT read is complete: an OK-but-truncated response would silently (though reversibly) drop a legitimate symbol from the grade.
- **Documented, unowned limits**:
  - Strategies that use fundamentals only in an exit or an OR branch are still denied entry, refused and excluded.
  - Backtest uses the PIT channel (EDGAR-only) while live uses the vendor snapshot, so the two can disagree.
  - Fingerprint blind spot: editing a formula's `fundamental_inputs` leaves old cells eligible.
  - A backfill re-admits stale 0-trade cells until a re-run.
  - The `/insights/watchlists` readiness 0/N gap remains.
  - While `analysis.backtest.fundamentals.enabled` is off, a trigger re-includes refused cells.
- **`squeeze_breakout_trend` PERMISSION_DENIED (2026-11-02).** Likely the feature-289 admin-formula-refusal class (unconfirmed).
- **`fundamentals_macd_blend` never enters on AAPL** (fscore 0.33-0.39 < 0.5). This is strategy calibration, out of scope.

**Ledger entries written**: insights.md (3), fails.md (3) — see the 2026-11-10 entries.

**Runtime-invariant recommendations (→ /context-constitution)**:
- **MARKETDATA-\***: fundamentals absence, outage and disable are encoded as follows (this mapping is currently stated only in marketdata CLAUDE.md):
  - edgar no-snapshot → NotFound on the single-symbol RPC, omitted in Multi;
  - FMP no-data → `ErrNoFundamentals` → NotFound;
  - Finnhub failure → Unavailable, never absence;
  - global disable → FailedPrecondition;
  - single-symbol uncached-over-quota → RESOURCE_EXHAUSTED.
- **MARKETDATA-\***: `GetEtfFlags` is cache-only and in-process. The first read after a deploy is unset, and callers must never treat unset as NOT_ETF.
- **ANALYSIS-\***: guard enforcement on live surfaces applies to entries only. The opportunity markers `"unavailable"` and `"fundamentals_unavailable"` are mutually exclusive. Verify against ANALYSIS-3 to avoid duplication.

**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at 2d91b5671335fcce267679b50caa494440205f51.

## Retained verbatim records

Operator decisions and C-16 sign-offs copied verbatim from the pre-archive session log, because durable suites and later features cite "<NNN> context.md" as their provenance. Headings are demoted one level.

### Session 2026-10-08 — sdd-design (quick) — operator decisions (recorded as they happen, P-05)

- **Detection fork (product-spec Open Question 1) — operator decision, two AskUserQuestion rounds:**
  1. First answer: "(b) vendor type==ETF" (Finnhub `/stock/profile2` type field).
  2. Recon then showed (b) is **not implementable as written**: Finnhub `profile2` carries no type/ETF
     field (the client parses only `currency`, `internal/finnhub/finnhub_client.go:239-241`), and no
     ETF flag exists anywhere in the platform (FMP `/stable/profile` returns `isEtf` but `fmpProfile`
     decodes only beta/currency/sector, `internal/fmp/fmp_client.go:354-359`; Alpaca `class` is
     `us_equity` for ETFs). Re-asked with that evidence → **"Hybrid: unavailable + FMP isEtf"**:
     **enforce** on "no producible fundamentals for this symbol" (catches ETFs, non-SEC filers and
     un-backfilled symbols; works with classification off), and parse FMP `isEtf` into marketdata only
     to **label** the reason (ETF vs no-filings).
  - Staging facts behind the choice (`get_config marketdata`, 2026-10-08): `marketdata.fmp.enabled=true`,
    `marketdata.fmp.metrics=core,extended`, `marketdata.fundamentals.provider=finnhub`,
    `marketdata.fundamentals.snapshot_source=edgar`; `marketdata.classification.enabled` is **unset**
    (default false), so the classification refresh does not run in staging today.
- Execution mode: fully autonomous (operator, 2026-10-08) — gates are reported, not waited on,
  except genuine forks like the one above.

#### Operator decision (2026-10-14): Step 24 option A — render refusal for INSUFFICIENT_DATA

- The operator chose option A for the Step 24 blocker, so Step 24 scope expands to `services/xstockstrat-ui/src/app/insights/strategies/[id]/page.tsx`. This is the F-08 exception, recorded here and in the Deviation Log.
- Required behavior:
  - An INSUFFICIENT_DATA result whose diagnostics carry a refusal/no-trade reason renders the Step 23 `no-trade-reason` surface.
  - The coverage-gap card is unchanged, and no new abstraction is added.
  - The e2e sentinel stays `status: 2`; the operator explicitly declined option B, which would set it to 1.

_From: Session 2026-10-08/09 — sdd-design Phase 1, round 1 (quick) + operator gate_

  - **C-16 sign-off: both CHANGEs approved** — (1) `@AC-8 @feature-201` note: a symbol with no fundamentals is
    refused / denied entry with a reason instead of silently holding; (2) `@AC-2 @feature-185` rescoped to
    "symbols with fundamentals available" (ETF/no-filings becomes the skip row for fundamentals strategies).

_From: Session 2026-10-10 — sdd-design (completion)_

- Constitution touched: C-04, C-08, C-10, C-13, C-14, C-15, C-16 (two CHANGEs signed off 2026-10-09; ANALYSIS-3 EXTEND
  via H decision), C-17, C-18, P-03, F-04, F-07 (fixed TTL constant justified in design). Floor breaches: none.

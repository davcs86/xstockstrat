# Context: block-fundamentals-strategy-on-etf

**Feature**: `docs/roadmap/features/215-block-fundamentals-strategy-on-etf/feature.md`
**Product Spec**: `docs/roadmap/features/215-block-fundamentals-strategy-on-etf/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/215-block-fundamentals-strategy-on-etf/implementation-spec.md`

---

## Session 2026-09-27 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from the user
  story ("no strategy that requires fundamentals run against an ETF").
- **Origin:** surfaced during the feature-211 @AC-5 rollout audit. Live staging run confirmed the
  behavior: `trigger_backfill(["SCHD"], data_kind=fundamentals)` returned `PARTIAL` with
  `failed_symbols: ["SCHD"]`; `query_fundamentals("SCHD", historical)` returned `periods: []`; and
  under `snapshot_source=edgar`, `query_fundamentals("SCHD", snapshot)` fell back to `source:
  "finnhub"` with all EDGAR-derived metrics (market_cap/pe/pb/roe/debt_to_equity/dividend_yield)
  missing. So `fundamentals_macd_blend`'s `fscore.composite > 0.5` gate can never evaluate true on
  SCHD → a silent no-trade that reads like a real no-signal.
- **User decision:** "Enforce it (SDD feature)" (AskUserQuestion) — a documented-only guardrail was
  offered but the operator chose code enforcement, so this goes through the full SDD pipeline rather
  than a docs note.
- **Key open design fork recorded in product-spec Open Questions:** Alpaca `asset_class` is
  `us_equity` for both stocks and ETFs, so "detect ETF via ListAssets assetClass" is not directly
  implementable. Options: (a) guard on fundamentals-unavailability (root cause), (b) vendor
  `type=="ETF"` profile field, (c) maintained ETF set.
- **Operator decision on the fork:** explicitly **left to `/sdd-design`** — the operator declined to
  pre-select an approach (briefly indicated (b), then reverted to "leave the design to decide"). The
  product spec's Open Question therefore states the options with **no recommendation**, so the
  proposer/adversary debate chooses unbiased.
- Reviewer snapshot (registry): analysis (backtest determinism / no look-ahead), marketdata
  (asset-class / fundamentals-availability source of truth), ui+agent (reason surfaced truthfully).
- Ledger trap noted (fails.md 2026-08-13, feature 129): verify the fundamental-operand detector
  against the real strategy/formula shapes and prove the guard on a real ETF run (SCHD), not stubs.

## Session 2026-09-27 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready. Verdict: PASS WITH WARNINGS (no blockers, no Floor breach).
- Warnings:
  1. Open Questions carry 5 unchecked `- [ ]` items — legitimate design forks (ETF-detection a/b/c, enforcement granularity, live-enable point, reason channel, fails.md-129 detector trap). Deferred to `/sdd-design`; MUST close before `design-approved`. Not fixed here (checking them would be a silent guess the operator declined).
  2. **Fixed:** the spec cited `opportunityShared.tsx` as the `no_trade_reason` render-map home; that map does not exist there — the reason renders in `services/xstockstrat-ui/src/components/insights/BacktestDiagnostics.tsx`. Corrected the Consumer-Surface UI bullet and the proto note; also pinned the additive enum value at `analysis.proto:189` (`NoTradeReason` 0–4, next-free `= 5`).
- Overlap findings: CLEAN — no config-key / proto-number / migration collision. At most one additive `NoTradeReason` enum value (`= 5`, uncontested); soft/rebase-only shared-file overlap on `analysis.proto` (084/032 add RPC+message, not enum members) and `xstockstrat-agent/app/tools.py` (214 rewrites tool-count surfaces; 215 adds no tool). Re-run overlap at impl-spec (Mode B) to reconfirm next-free enum + exact-line agent/analysis overlaps if 196/214 still in-flight.
- Per operator instruction this session: **stop at spec-ready** (do not proceed to /sdd-design).

## Session 2026-10-08 — sdd-design (quick) — operator decisions (recorded as they happen, P-05)

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

## Session 2026-10-08/09 — sdd-design Phase 1, round 1 (quick) + operator gate

- Phase 0 Recon: recon.md written (commit ffec9b76). Key fact: analysis collapses fetch error / absence / gate-off
  into `[]`/`None` — the guard needs an error-distinct signal.
- Staging truth (query_fundamentals 2026-10-08): SCHD and SPY snapshots are finnhub rows with
  missing_metrics = market_cap, pe_ratio, pb_ratio, dividend_yield, eps, roe, debt_to_equity.
- **Round-1 proposal**: pure `app/services/fundamentals_guard.py` (requires_fundamentals; Availability
  NOT_REQUIRED/AVAILABLE/UNAVAILABLE/UNKNOWN; `failed` set on the 4 loaders), new marketdata `GetEtfStatus`
  RPC (FMP `isEtf`, on demand, TTL cache, no migration), `NO_TRADE_REASON_FUNDAMENTALS_UNAVAILABLE = 5` +
  `FundamentalsGap` label, backtest refusal via FormulaExecutionError-style path, live sentinel, opportunity
  informational skip row, FR-4 eval-time.
- **Round-1 adversary: NEEDS WORK, no Floor breach.** Objections carried into round 2:
  1. Availability must test the metrics the strategy actually reads (formula_fund_map ∪ 198 operand metrics),
     not a copied `hasCoreMetrics` six-list (false refusal on dividend_yield-only rows; false availability on
     market_cap-only rows; cross-language drift) — C-16 `@AC-8 @feature-201`, C-18.
  2. `fetch_failed` is keyed by symbol → a fundamentals outage taints non-fundamentals rows on the same
     symbol; key per (symbol, strategy) / row-local.
  3. Skip-before-eval suppresses exits (live `_apply_transition`, opportunities held-exit REDUCE trace) →
     **deny entry** instead (live `deny_entry=`; opportunities skip only `rule == "entry"`).
  4. Edgar-only/vendors-off `FailedPrecondition` reads as UNKNOWN (silent hold survives) → classify by status
     code; absence ≠ outage (fails.md:2479).
  5. "AVAILABLE if any channel" hides an empty required channel → UNAVAILABLE if any required channel is.
  6. Backtest UNKNOWN still silent → add a run warning.
  7. Live auditability/@AC-5 + set_strategy_live surface; @AC-4 wording is an operator question.
  8. C-16 CHANGE sign-offs must be recorded.
  9. Guard scope inconsistent across readiness writers (`:4682` vs `:3589/:3858/:5538`) → one rule, list every site,
     per-surface positive tests (fails.md:2737).
  10. Label over-built: single cache in marketdata, `optional bool is_etf`, negative-cache empty profiles,
      persist `isEtf` via `source.Fundamentals` when profile already fetched.
  11. Live WARN flood → log on state change. 12. Label nondeterminism → document best-effort / omit when unknown.
- **Operator decisions at the round-1 gate (AskUserQuestion, 2026-10-09):**
  - Opportunities: **non-actionable skip row** (action UNSPECIFIED, NULL composite, `fundamentals_gap` set,
    badge); held positions keep exit/REDUCE rows. `@AC-4` text to be amended to "no actionable row".
  - Live: **deny entry + one WARNING alert via notify and one WARN log on state change** (not per cycle);
    `set_strategy_live` docstring-only (eval-time enforcement).
  - **C-16 sign-off: both CHANGEs approved** — (1) `@AC-8 @feature-201` note: a symbol with no fundamentals is
    refused / denied entry with a reason instead of silently holding; (2) `@AC-2 @feature-185` rescoped to
    "symbols with fundamentals available" (ETF/no-filings becomes the skip row for fundamentals strategies).
  - **Run round 2** before approval.

## Session 2026-10-09 — sdd-design Phase 1, round 2 + operator gate

- Round-2 proposal (file kept at /tmp during session; summary): evaluator-reads-metric availability per channel,
  UNAVAILABLE > UNKNOWN, marketdata edgar per-symbol FailedPrecondition → NotFound/omit, deny-entry live + opps
  entry-only skip row, live state-change WARN + EmitAlert, readiness/series surfaces unguarded by rule,
  `GetEtfFlags` (optional bool, single fmp.Client cache, negative caching), proto: NoTradeReason=5,
  `FundamentalsGap`, SymbolDiagnostics.fundamentals_gap=6, Opportunity.fundamentals_unavailable=23 /
  fundamentals_gap=24 (adversary verified free).
- Verified: seeded fscore FUNDAMENTAL_INPUTS = PE, PB, DIVIDEND_YIELD, ROE, DEBT_TO_EQUITY, EPS
  (`services/xstockstrat-indicators/app/formulas/fundamentals_value_quality.py`); none quote-derived.
- **Round-2 adversary: NEEDS WORK, no Floor breach.** All round-1 objections resolved except as follows; new:
  A `_QUOTE_DERIVED` exclusion regresses `@AC-8 @feature-201` partial-row rule (unsigned) → availability = "evaluator
  would execute ≥1 epoch", one helper shared with `_fundamentals_formula_series`;
  B `failed` lost on per-pass cache hits → key `(channel, symbol)` with cache lifetime;
  C heal path never rewrites `action` (`repositories/opportunities.py:132-142`) and forcing UNSPECIFIED before the
  `_resolve_action_tag` drop resurrects dropped rows;
  D global FailedPrecondition (source disabled) → perpetual data_unavailable + 300s retry → new DISABLED state;
  E "available ever" counts filings after the backtest window → only filings before the last evaluated bar;
  F Signal-detail / watchlist-readiness show contradictory 0/N → badge from queue row, document watchlist gap;
  G GetEtfFlags no deadline, unbounded concurrent map, widened `sectorSource` → cache-only + background fill,
  mutex/size bound, own interface;
  H old 0-trade ETF evidence cells keep feeding the derived grade;
  I marketdata FailedPrecondition→NotFound needs an FR + scenario + doc update;
  J minor: import predicates from guard module directly; keep transition-alert exception semantics; exit-only
  fundamentals strategies are denied entry (document).
- **Operator decisions (AskUserQuestion 2026-10-09):** run **round 3** (do not approve yet); objection H →
  **exclude at derivation** (grade derivation skips symbols the guard refuses for that strategy).

## Session 2026-10-09/10 — sdd-design round 3 + operator gate

- Round-3 proposal resolved A–G, I, J (adversary-verified); H was silently replaced by a write-time DELETE of stale
  0-trade cells — **reverted**: operator re-confirmed **derivation-time exclusion** (grade recompute runs the guard per
  evidence symbol over each cell's window; refused symbols dropped; UNKNOWN keeps the old grade; non-destructive).
- **Round-3 adversary: NEEDS WORK, no Floor breach.** Remaining: (1) H divergence (now resolved above);
  (2) both PIT loaders read only page 1 (50 periods, `servicer.py:1641-1652`, `live_loop.py:626-632`,
  `marketdata_service.go:1736`) → newest filings lost → false UNAVAILABLE; drain pages with a bounded shared helper,
  page-cap hit = UNKNOWN; C-16 EXTEND of @feature-198/201 results for >50-period symbols;
  (3) empty bar window / bars outage misread as UNAVAILABLE → "not assessed"; skip and `unavailable` rows mutually
  exclusive; (4) ETF-label background fill can starve the shared FMP budget → fill only below 80% of cap, long fixed TTL;
  (5) backtest DISABLED unreachable (GetHistoricalFundamentals has no gate) → drop backtest branch + @AC-9 backtest clause;
  (6) Signal-detail badge reads only first 50 queue rows → known gap or symbol filter.
  Spec notes: FMP single-symbol no-data → NotFound; held exit UNAVAILABLE heals as today; fingerprint blind spot on
  formula input edits; restart re-alerts; NULL range_end legacy cells; @AC-10 wording; recon @AC-7 @feature-211 wording.
- **Operator decisions (AskUserQuestion 2026-10-10):** H = **derivation-time exclusion**; **run round 4**.

## Session 2026-10-10 — sdd-design (completion)

- Phase 0 Recon: recon.md (services: analysis, marketdata, ui, agent; reuse: FormulaExecutionError diagnostics path,
  `deny_entry`, provenance-marker→proto flag, `fetchProfile` + shared FMP budget).
- Phase 1 Grilling: **4 rounds** (quick, extended by the operator at each gate). Chosen approach: pure
  `fundamentals_guard` module with evaluator-shared "would execute" availability, error-distinct states
  (NOT_REQUIRED/NOT_ASSESSED/AVAILABLE/UNAVAILABLE/UNKNOWN/DISABLED), backtest refusal (NoTradeReason 5),
  live deny-entry + state-change alert, opportunity skip row + `ListOpportunitiesRequest.symbol`, derivation-time
  evidence exclusion (filter-before-dedup), paginated PIT loaders, marketdata absence → NotFound/omit,
  cache-only `GetEtfFlags` label. Rejected: per-bar guard, copied core-metric list, quote-metric exclusion,
  write-time cell DELETE, persisted `is_etf` (migration 010), refusal flag migration 028.
- Round-4 adversary SOUND; 3 fixes folded at approval (formula-level outage = UNKNOWN on derivation;
  filter-before-dedup; no background semaphore on interactive recomputes + PIT timeout + boot recompute off the
  live-loop startup path).
- Constitution touched: C-04, C-08, C-10, C-13, C-14, C-15, C-16 (two CHANGEs signed off 2026-10-09; ANALYSIS-3 EXTEND
  via H decision), C-17, C-18, P-03, F-04, F-07 (fixed TTL constant justified in design). Floor breaches: none.
- Product spec amended: FR-2/3/4 rewritten, FR-7..FR-11 added, proto list, Open Questions closed;
  acceptance @AC-4/@AC-6 amended, @AC-7..@AC-15 added.
- Status: spec-ready → design-approved.

## Session 2026-10-10 — sdd-spec

- Wrote implementation-spec.md with 26 steps. Status: design-approved → implementation-ready.
- Key codebase findings:
  - **Rebase first.** Feature 196 (#1237, `80d44449`) is on main-dev but not on this branch, and it moves `marketdata_service.go` by about 12 lines. The spec cites main-dev line numbers for that file.
  - **Three descriptor-parity guards go red** as soon as the proto fields are added: analysis `test_analysis_servicer.py:6066`, agent `test_opportunity_projection.py:52`, agent `test_backtest_view.py:210`. So Steps 2–6 must land together; Steps 3 and 5 carry the fields.
  - **Heal never writes `action`.** `replace_symbols` (`repositories/opportunities.py:113-163`) has no action column. Step 3 adds `action = COALESCE($11::int, action)`.
  - **New structural marker.** `"fundamentals_unavailable"` joins `_PROVENANCE_STRUCTURAL_MARKERS` (`opportunities.py:26`) and the floor exemption (`:250`). The gap label rides `readiness_json`, with no column.
  - **Opportunity fetch failures are keyed by symbol.** `_compute_opportunities` keys `fetch_failed` by symbol (`servicer.py:5104`). A fundamentals UNKNOWN is therefore row-local (`fund_unknown`), never added to `fetch_failed`.
  - **Recompute needs a new repo method.** It reads every cell through a new `fetch_all_for_fingerprint`, which shares `_ELIGIBILITY_ORDER` with `fetch_eligible`. That is how filter-before-dedup is done.
  - **Boot recompute currently blocks startup.** It is awaited inline before the live loop is created (`main.py:134-162`). Step 17 moves it to `create_task`.
  - **`s.fmpBudget` is only set through `SetClassification`,** which `main.go:152` always calls. The ETF fill uses a new `etfFlagSource` interface and `SetEtfFlagSource`. The UI BFF forwards `ListOpportunitiesRequest` unchanged, so the `symbol` filter needs no BFF change.
  - **Edgar-mode `GetFundamentalsMulti` change.** Today it returns FailedPrecondition for the whole batch on the first un-producible symbol when vendors are off (`marketdata_service.go:1337-1340`, `1537-1540`). After Step 7 it omits that symbol instead. The blend-universe resolver, the screener and `fundsignal_loop` all receive the partial list; this is within the approved FR-7 extend.

## Decisions (sdd-spec, 2026-10-10)

- **Gap label carrier.** `Opportunity.fundamentals_gap` is persisted in `readiness_json["fundamentals_gap"]`. That follows the `target_price` JSONB precedent, so no migration is needed.
- **Status gate.** A backtest run with only fundamentals UNKNOWN symbols also reports INSUFFICIENT_DATA, alongside `fund_refusals`.
- **Recompute trigger.** The grade recompute runs on `status == OK or fund_refusals > 0`, so an all-UNKNOWN run does not trigger one.
- **NOT_ETF badge text.** NOT_ETF renders "Fundamentals unavailable", the same as UNSPECIFIED, to match the literal `@AC-4` text.
- **No ETF label on live.** The live loop does not call `GetEtfFlags`, because the design asks for no label there (YAGNI).
- **Fixed-invariant constants.** `etfFlagCacheMax`/`etfFlagQueueCap`, and `_FUND_PAGE_TIMEOUT_SECONDS` = 10, are fixed invariants under the same F-07 justification as `etfFlagTTL`.

## Open Threads

- `/sdd-review block-fundamentals-strategy-on-etf impl-spec`.
- Step 26: measure the >50-period symbols on staging before the integration PR merges.

## Session 2026-10-11 — sdd-review impl-spec (advisory)

- Verdict: **FAIL**, with no Floor breach. There was one literal-criterion blocker plus advisory warnings. All of them are resolved below by editing step bodies before execution. Every citation was re-verified by grep/read in this worktree, and the `marketdata_service.go` lines against `git show origin/main-dev:…`.
- [x] **BLOCKER — Step 26 had no runnable Verification.** Added bash `grep`s on this file for three things: the `## Session … — staging verification` heading, a `>50 periods: <N>` line, and the recorded SCHD reason-5 / `fundamentals_unavailable: true` results. Also stated "no coverage threshold applies (environment verification; red/green in Steps 16/18/22/24)".
- [x] **Steps 8/10, Go coverage.** `go list`/`go test` now run with `GOWORK=off` (the template's unexported shell var did not reach `go test`). Added the `awk '/^total:/{…; exit ($3+0<40)}'` ≥40% assertion, sanity-checked on sample output.
- [x] **Step 2, directory-only Files.** Replaced it with the per-language tracked stub files for analysis and marketdata under `packages/proto/gen/{go,python,ts,ts/dist}`, plus the expected-unchanged list. Verification now fails on any other `gen/` change.
- [x] **F-08 file lists.**
  - Step 18 gains `tests/test_owner_dimension.py` and `tests/test_analysis_servicer.py`.
  - Step 22 gains `tests/test_analysis_servicer.py` and `tests/test_opportunities_latency.py`.
  - Step 25 teardown: drift fixes outside the step's Files go to the Deviation Log.
  - Step 25 Verification adds `uv run pytest tests/test_tools_endpoint.py tests/test_list_correlation_parity.py -q` (agent).
- [x] **Step 15, approval fix 1 "generally".** `fund_failures` is created before the formula-map build (`servicer.py:838-851`). `failures=` is threaded through `_prefetch_formula_warmups` → `_declared_formula_warmup`, whose `except grpc.RpcError` (L2254) records `("formula", fid)` when `fund_map` is passed, and through `_formula_fundamentals`. A backtest `GetFormula` outage now reads UNKNOWN, not FORMULA_ERROR, with the gate on. Paired test: Step 16(i), on both prefixed and unprefixed runs.
- [x] **Step 17, interactive concurrency bound.** Added the fixed invariant `_INTERACTIVE_DERIVATION_CONCURRENCY = 4`. When `sem is None` it backs a fresh local `asyncio.Semaphore`, never the materializer sem. Step 18 pins a peak in-flight count of 4 over 10 symbols.
- [x] **Step 17, C-03.** Chose **forwarding**: interactive recompute triggers (RunBacktest, ScoreStrategy, ManageStrategy UPDATE) pass the inbound `_PROPAGATED_HEADERS` trio (`servicer.py:303`), which includes `x-access-scope`. This supersedes the design's "owner + trace" note. Boot stays owner-only (`servicer.py:5474` precedent). Step 18 pins the trio.
- [x] **Step 21, mutual exclusion.** `sym_unavailable = evaluated and not fund_skip and (sym in fetch_failed or fund_unknown)`. This guards against a sibling candidate's concurrent `fetch_failed.add` (`servicer.py:5238-5247`, read at L5280). Step 22 has the matching case.
- [x] **Steps 13/14/22/25, snapshot quota ripple.** Named in Step 13.6: single-symbol `GetFundamentals` → `resolveFundamentals` returns `RESOURCE_EXHAUSTED` for an uncached symbol (main-dev L1430-1434), where Multi omitted it (L1376-1382). With Step 13.6 that now reads UNKNOWN, so the row is stamped `"unavailable"` and goes through the 300s retry. Step 14 and Step 22 have cases for it, and Step 25 adds a line to the analysis `CLAUDE.md`.
- [x] **Step 8, finnhub client test.** It surfaced a **design factual error**. `finnhub_client.go:56` ("no fundamentals") is reached **only on an outage**: `GetFundamentals` delegates to `GetFundamentalsMulti`, which `continue`s on any `fetchOne` error (L71-75). A decoded symbol always yields a row. Wrapping it as `ErrNoFundamentals` would have turned Finnhub outages into NotFound/absence, an FR-8 violation on the default provider.
  - Step 7 now makes Finnhub `GetFundamentals` call `fetchOne` directly and return its error unwrapped (it never returns `ErrNoFundamentals`). The FMP wrap is unchanged: FMP returns quote errors and omits only true absences.
  - Step 8 adds `TestGetFundamentals_OutageIsNotAbsence` in `internal/finnhub/finnhub_client_test.go` (503/429 → not `ErrNoFundamentals`; empty 200 → nil-field row) and a service case: an unwrapped vendor error gives `CodeUnavailable`.
  - Step 8 Covers now includes AC-8. The Step 25 marketdata doc text says the same.
- [x] **Step 16(d), page cap.** Added (h): a never-ending `next_page_token` through `RunBacktest` gives an UNKNOWN warning, is never refused, and writes no cell. Step 16 now Covers AC-12. The Scenario Coverage table was re-synced: AC-8 adds Step 8; AC-12 adds Step 16, and Step 20, which already covered it but was missing from the table.
- [x] **Step 23, C-10.** One note that `CopilotRail.tsx` (~L36-46) and `WatchlistDetail.tsx` (~L90-92) are intentionally unchanged. The `symbol = ''` default keeps CopilotRail's shared page-1 cache key.
- [x] **`marketdata_service.go` anchors.** Confirmed the citations are origin/main-dev numbers (+12 vs this branch). Step Dependencies now says to locate by symbol at execute time. Step 7 and Step 13 citations name their enclosing symbol.
- [x] **`atQuotaAlertThreshold` with cap ≤ 0.** From code: `BudgetSnapshot`'s "cap <= 0 = uncapped" comment holds only for a nil-`Limits` client. Production always wires `Limits` (`cmd/server/main.go:242-245`), and `reserve()` then refuses every call at cap 0. So 0 means zero budget. The Step 9 filler now gates `cap > 0` explicitly, and Step 10(c) adds a `{0,0}` case.
- Also corrected in passing (C-01): Step 18's helper is `_eligible_cell` (`tests/test_analysis_servicer.py:87`), not `_cell`.

## Session 2026-10-11 — sdd-execute (sequential, autonomous, Steps 1–6)

- Branch synced with `origin/main-dev` first (merge `94aca733`, which brings feature 196 `80d44449`); no conflicts.
- Mode: operator-authorized fully autonomous sequential run, scoped to Steps 1–6 (they land together, since the new proto fields turn three parity guards red until Steps 3 and 5).

### Step 1 — proto: Additive analysis + marketdata contract [done]
- Added `NO_TRADE_REASON_FUNDAMENTALS_UNAVAILABLE = 5`, the `FundamentalsGap` enum, `SymbolDiagnostics.fundamentals_gap = 6`, `Opportunity.fundamentals_unavailable = 23` / `fundamentals_gap = 24`, and `ListOpportunitiesRequest.symbol = 6`. Also added the `GetEtfFlags` RPC and the `GetEtfFlagsRequest` / `EtfFlag` / `GetEtfFlagsResponse` messages. `buf lint` and `buf breaking` both pass. TDD: N/A.
- Files modified: `packages/proto/analysis/v1/analysis.proto`, `packages/proto/marketdata/v1/marketdata.proto`
- Deviations: the Verification `buf breaking` input path was fixed (see Deviation Log).

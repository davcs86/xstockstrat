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

### Step 2 — proto-gen: Regenerate stubs [done]
- Regenerated the Go, Python and TS stubs via the Docker codegen image, then compiled `gen/ts/dist` on the host with lockfile-pinned `tsc`. `git status` shows only the 20 analysis/marketdata stub files listed in Step 2. TDD: N/A.
- Files modified: `packages/proto/gen/{go,python,ts,ts/dist}/{analysis,marketdata}/v1/*` (the Step 2 list)
- Deviations: the TS compile ran on the host after a frozen-lockfile install (see Deviation Log).
- Not done: the coordinator asked to cherry-pick CI fix `4705cc4f` (`claude/ci-golangci-goinstall`, `install-mode: goinstall`). The session permission classifier denied the `git cherry-pick` ("Modify Shared Resources"), so the commit is **not** on this branch. Operator action is needed.

### Step 3 — service: Opportunity row contract + repository [done]
- `"fundamentals_unavailable"` joined `_PROVENANCE_STRUCTURAL_MARKERS` and the `read()` floor exemption. `read()` gained `symbol` (`$9`, empty = all), and `replace_symbols` gained `action = COALESCE($11::int, action)`. `ListOpportunities` normalizes `request.symbol` once and forwards it to both reads, and `_row_to_opportunity` maps `fundamentals_unavailable` (marker) and `fundamentals_gap` (from `readiness_json`).
- TDD (paired with Step 4): RED 8 failed, 353 passed (`TypeError: read() got an unexpected keyword argument 'symbol'`, the marker/floor/COALESCE asserts, and `IndexError` at bind 11). GREEN: 361 passed; full suite 971 passed at 85.81% coverage; ruff clean.
- Files modified: `services/xstockstrat-analysis/app/handlers/servicer.py`, `services/xstockstrat-analysis/app/repositories/opportunities.py`
- Deviations: none
- Not done: the coordinator's updated CI-fix request (cherry-pick `4705cc4f` + `ff8fe0dc`, golangci-lint v2.14.0) was not attempted again, because the classifier had already denied `git cherry-pick` this session. Operator action is needed.

### Step 4 — test: Row contract + repository [done]
- Parity guard `_MAPPED` gained `fundamentals_unavailable` / `fundamentals_gap`, and `test_mapper_populates_all_fields` asserts both. Six repo tests were added: `$9` symbol bind and default `""`, floor exemption, structural marker plus `_primary_source`, heal action bound at position 11, no-action-key binds `None`, and the skip-row round-trip. Also added the servicer test `test_symbol_filter_normalized_into_both_reads`: `" schd "` → `"SCHD"` on both the fresh and the stale read.
- AC-13 red: COALESCE/bind-11 asserts failed → green: passed. AC-15 red: `KeyError: 'symbol'` / `TypeError` → green: passed. The suite ran 971 cases (coverage 85.81%). C-13: the literals are single-consumer and inline.
- Files modified: `services/xstockstrat-analysis/tests/test_opportunities_repo.py`, `services/xstockstrat-analysis/tests/test_analysis_servicer.py`
- Deviations: the fake repo `read` accepts `symbol=` (see Deviation Log).

### Step 5 — service: Agent projections + tool docstrings [done]
- `_SYMBOL_KEYS` gained `fundamentals_gap`. `_opportunity_to_dict` projects `fundamentals_unavailable` and the `FundamentalsGap` name. Docstrings updated, text only: `run_backtest` (refusal, reason 5 + gap, INSUFFICIENT_DATA, outage → warning), `list_opportunities` (skip-row fields) and `set_strategy_live` (not checked at enable; eval-time deny-entry, WARN + alert on state change).
- TDD (paired with Step 6): RED 4 failed (two descriptor-parity guards missing `fundamentals_gap` / `fundamentals_unavailable`, plus `KeyError` in the new projection/summary tests). GREEN: 21 passed; full agent suite 498 passed at 80.36% coverage; ruff clean.
- Files modified: `services/xstockstrat-agent/app/backtest_view.py`, `services/xstockstrat-agent/app/client.py`, `services/xstockstrat-agent/app/tools.py`
- Deviations: none

### Step 6 — test: Agent projections [done]
- `_full_opportunity` carries the two new fields. Added `test_fundamentals_skip_row_projection` (AC-4: marker + `FUNDAMENTALS_GAP_ETF`, action UNSPECIFIED, no `composite_score`) and `test_summary_keeps_fundamentals_refusal_inline` (AC-2: reason 5 + gap stay inline).
- AC-2 red: `KeyError 'fundamentals_gap'` → green: passed. AC-4 red: `KeyError 'fundamentals_unavailable'` → green: passed. The parity guards also went red → green. C-13: single-consumer inline literals.
- Files modified: `services/xstockstrat-agent/tests/test_opportunity_projection.py`, `services/xstockstrat-agent/tests/test_backtest_view.py`
- Deviations: the fixture gained a `fundamentals_gap` key (see Deviation Log).

## Session 2026-10-11 — sdd-execute (Steps 1–6 checkpoint)
**Steps this session**: 1, 2, 3, 4, 5, 6
**Progress**: 6 done / 26 total
**Stopped at**: Step 6 (scope of this run, the Steps 2–6 contract group; three parity guards are green again)
**Next**: /sdd-execute block-fundamentals-strategy-on-etf sequential (Step 7, marketdata)
**Open item**: the CI fix cherry-pick (`4705cc4f` + `ff8fe0dc` from `claude/ci-golangci-goinstall`) is still not on this branch, because `git cherry-pick` was denied by the session permission classifier. It is needed before the marketdata Go steps can get green CI lint.

## Session 2026-10-11 — sdd-execute (sequential, autonomous, Steps 7–16)

- Mode: coordinator-delegated autonomous run of Steps 7–16, one commit per step on `feature/block-fundamentals-strategy-on-etf`. PR #1239 (golangci-lint v2.14.0 CI fix) not yet on `origin/main-dev` at start, so Go lint is verified locally with the v2.14.0 binary; CI Go lint stays red until #1239 lands (known, not this feature's).

### Step 7 — service: Marketdata absence encoding + shared 80% threshold [done]
- Added `source.ErrNoFundamentals`; FMP single-symbol empty result wraps it; Finnhub `GetFundamentals` now calls `fetchOne` directly (outage errors unwrapped, never absence). `resolveFundamentals` maps the sentinel to NotFound; `getEdgarSnapshot` vendor-off branch returns NotFound (`errNoEdgarSnapshot`); edgar `GetFundamentalsMulti` omits NotFound symbols and still aborts on kill switch / quota / outage. `atQuotaAlertThreshold` extracted as the single 80% home.
- TDD (paired with Step 8): RED 1 = build failure (`undefined: source.ErrNoFundamentals`, `atQuotaAlertThreshold`); RED 2 after adding only the declarations = behavioral: Multi `failed_precondition: no edgar snapshot for SCHD…`, vendor absence `unavailable` (want not_found), FMP `err … want errors.Is(ErrNoFundamentals)`, Finnhub 503 error did not name `/stock/metric`. GREEN: targeted tests ok (service/fmp/finnhub, `-race`); full module `go test ./... -race` ok; coverage 70.9% (≥40%); golangci-lint v2.14.0 0 issues; gofmt clean.
- Files modified: `services/xstockstrat-marketdata/internal/source/source.go`, `internal/fmp/fmp_client.go`, `internal/finnhub/finnhub_client.go`, `internal/service/marketdata_service.go`
- Deviations: none

### Step 8 — test: Marketdata absence encoding [done]
- Added service tests (feature215): edgar no-snapshot → Multi omits SCHD / single NotFound (AC-7); vendor `ErrNoFundamentals` → NotFound in vendor mode and edgar fallback, omitted from Multi; unwrapped vendor error → Unavailable on single and aborts Multi (AC-8); kill switch → FailedPrecondition on both RPCs; quota exhausted → ResourceExhausted single + Multi abort; `atQuotaAlertThreshold` table. FMP empty quote → `errors.Is(ErrNoFundamentals)`; Finnhub `TestGetFundamentals_OutageIsNotAbsence` (503/429 not absence, names `/stock/metric`; empty 200 → nil-field row).
- AC-7 red: Multi `failed_precondition` for SCHD → green. AC-8 red: vendor absence `unavailable`, Finnhub 503 → "no fundamentals for" → green. Existing quota/HTTPError guards stay green. Coverage 70.9%; golangci-lint v2.14.0 0 issues. C-13: `"SCHD"` in one test file.
- Files modified: `services/xstockstrat-marketdata/internal/service/marketdata_service_test.go`, `internal/fmp/fmp_client_test.go`, `internal/finnhub/finnhub_client_test.go`
- Deviations: `fakeHistRepo.latestBy`; client tests use `VOO` (see Deviation Log).

### Step 9 — service: Cache-only `GetEtfFlags` + headroom-gated background fill [done]
- FMP `fmpProfile.IsEtf` + `FetchIsEtf`. New `internal/service/etf_flags.go`: `etfFlagSource`, fixed invariants (`etfFlagTTL` 30d, `etfFlagCacheMax` 10000, `etfFlagQueueCap` 256), `etfFlagState` (mutex, entries, pending, queue, injectable `now`); `GetEtfFlags` is cache-only (miss/expired → unset + non-blocking deduped enqueue); `StartEtfFlagFiller` → `fillEtfFlag`, gated by `etfFillAllowed` (fmp enabled, budget wired, `cap > 0`, `!atQuotaAlertThreshold`), errors not cached, nil negative-cached, oldest-evicted at the bound. Handler connect + gRPC adapter methods; `main.go` wires `SetEtfFlagSource(fmpClient)` + `go svc.StartEtfFlagFiller(ctx)`.
- TDD (paired with Step 10): RED = build failure (`svc.GetEtfFlags undefined`, `svc.etf undefined`, `undefined: etfFlagQueueCap`, `FetchIsEtf` undefined). GREEN: 9 Etf tests + 5 headroom subcases + FMP decode pass under `-race`; full module ok; coverage 71.0%; golangci-lint v2.14.0 0 issues. Mutation check: forcing the gate open fails the 80%-cap and cap-0 cases.
- Files modified: `services/xstockstrat-marketdata/internal/fmp/fmp_client.go`, `internal/service/etf_flags.go` (new), `internal/service/marketdata_service.go`, `internal/handler/marketdata_handler.go`, `cmd/server/main.go`
- Deviations: none (the per-symbol `fillEtfFlag` / `etfFillAllowed` helpers are the loop body of `StartEtfFlagFiller`, split out so tests drive one fill deterministically).

### Step 10 — test: `GetEtfFlags` + fill [done]
- `etf_flags_test.go` (new, inline counting `fakeEtfSource`): (a) miss unset / 0 source calls / one deduped enqueue; (b) full queue drops without blocking and leaves no stale pending; (c) `@AC-14` filler skips at 80/100, 0/0, fmp disabled, no budget, fetches at 79/100; (d) served <30d with no re-fetch, re-queued after TTL; (e) empty profile negative-cached; (f) source error not cached and re-queued; (g) oldest evicted at `etfFlagCacheMax`; (h) concurrent readers + running filler under `-race`, filler stops on cancel. `fmp_gateway_test.go`: `FetchIsEtf` decodes true/false and `[]` → (nil, nil).
- AC-14 red: build failure (symbols undefined) → green: all pass. Coverage 71.0%; lint 0 issues.
- Files modified: `services/xstockstrat-marketdata/internal/service/etf_flags_test.go` (new), `internal/fmp/fmp_gateway_test.go`
- Deviations: none

### Step 11 — service: Pure `fundamentals_guard` module + shared evaluator helper [done]
- `evaluator.py`: module-level `fundamental_component_inputs` (data keys + as-of series, `([], {})` when empty) and `component_would_execute`; `_fundamentals_formula_series` now calls the former (epoch loop unchanged). New `app/services/fundamentals_guard.py`: `Availability` (6 states), the two predicates moved verbatim, `requires_fundamentals`, `epoch_eval_dates`, `assess` (gate → required components → NOT_ASSESSED → per-component channel/failure/would-execute → precedence UNAVAILABLE > UNKNOWN > DISABLED > AVAILABLE). `failures` is a mapping `("pit"|"snap", symbol) → state`, `("formula", fid) → state`. servicer/live_loop import the predicates from the guard.
- TDD (paired with Step 12): RED `ImportError: cannot import name 'component_would_execute' from 'app.services.evaluator'`. GREEN: guard + operand tests 38 passed; full suite 1003 passed, coverage 85.94%; ruff check + format clean.
- Files modified: `services/xstockstrat-analysis/app/services/fundamentals_guard.py` (new), `app/services/evaluator.py`, `app/handlers/servicer.py`, `app/engine/live_loop.py`
- Deviations: guard names imported where first used; import check with the conftest gen shim (see Deviation Log).

### Step 12 — test: Guard + evaluator parity [done]
- New `tests/test_fundamentals_guard.py`: predicates on the real shapes (blend = fscore with the seeded `FUNDAMENTAL_INPUTS` + MACD → True; squeeze builtins → False; operand-only → True); states (SCHD empty → UNAVAILABLE; beta-only row vs {BETA, PE} → AVAILABLE; first filing on/after last eval date → UNAVAILABLE; empty eval dates / bars_failed → NOT_ASSESSED; gate off and technical-on-SCHD → NOT_REQUIRED; formula failure on an empty map → UNKNOWN; pit failure state; operand metric); precedence matrix; snapshot-vs-PIT channel choice; parity of `component_would_execute` vs ≥1 awaited `ExecuteFormula` over 6 period sets; `epoch_eval_dates` vs brute-force calendar days over 6 filing dates.
- AC-1/AC-3/AC-10 red: ImportError (helpers absent) → green: 38 passed (guard + operand). Full suite 1003 passed, 85.94%.
- C-13: SCHD/AAPL period literals inline (single consumer; Step 16 centralizes them).
- Files modified: `services/xstockstrat-analysis/tests/test_fundamentals_guard.py` (new)
- Deviations: none

### Step 13 — service: Bounded PIT pager + error-distinct loaders [done]
- servicer: `_FUND_PAGE_SIZE = 200`, `_MAX_FUND_PAGES = 8`, `_FUND_PAGE_TIMEOUT_SECONDS = 10`, `_FundamentalsPageError`; `_fundamental_periods(periods)` with the 1-line `_fundamental_periods_from_response` wrapper; module-level `_fetch_historical_fundamentals_paged` (strict `(period_end, fiscal_period)` advance of each page's first period, empty token = EOF, cap/stall raise). `_load_fundamentals(…, failures=None)` pages and records `("pit", sym) → UNKNOWN` unless NOT_FOUND; both snapshot loaders now call single-symbol `GetFundamentals` (NOT_FOUND → absent, FAILED_PRECONDITION → DISABLED, else incl. RESOURCE_EXHAUSTED → UNKNOWN); `_formula_fundamentals` / `declared_formula_fundamentals` record `("formula", fid) → UNKNOWN`. live_loop loaders page with `metadata=()` and share the servicer helpers. EvaluateReadiness / watchlist compute / GetIndicatorSeries / materializer pass no `failures`.
- TDD (paired with Step 14): RED `ImportError: cannot import name '_FUND_PAGE_SIZE' from 'app.handlers.servicer'`. GREEN after Step 14's re-pointing: full suite 1027 passed, coverage 86.78%; ruff clean. Note: this commit alone leaves two feature-200 live tests stubbing `GetFundamentalsMulti` red until Step 14's commit re-points them (paired-step ordering).
- Files modified: `services/xstockstrat-analysis/app/handlers/servicer.py`, `app/engine/live_loop.py`, `app/services/evaluator.py`
- Deviations: shared failure/lowering helpers + dropped unused imports (see Deviation Log).

### Step 14 — test: Pager, loaders, readiness parity [done]
- New `tests/test_fundamentals_pit_pager.py`: `@AC-12` 3-page drain (dividend only on page 3 → AVAILABLE; page 1 alone → UNAVAILABLE), page size 200 / timeout / metadata / token sequence; empty token EOF; repeated first period raises; never-ending token raises after `_MAX_FUND_PAGES`. Loaders: servicer + live UNAVAILABLE RpcError and page error → `("pit","AAPL") = UNKNOWN`, cache hit keeps the failure, NOT_FOUND → no failure; live pages with `metadata=()`. Snapshot mapping (servicer + live): NOT_FOUND → none, FAILED_PRECONDITION → DISABLED (`@AC-9`), UNAVAILABLE and RESOURCE_EXHAUSTED → UNKNOWN (`@AC-8`, the Multi → single ripple), never a `"pit"` key; row lowering + single-symbol request + metadata. Formula map: servicer and evaluator record `("formula","divf")`.
- `test_fundamentals_formula_servicer.py`: `_multi_resp` → `_snapshot_resp` (`GetFundamentalsResponse`), live stubs re-pointed to `GetFundamentals`. `test_analysis_servicer.py`: `TestUnguardedReadinessParity_feature215`.
- AC-8/AC-9/AC-12 red: ImportError (pager absent), then the two feature-200 live tests red on the Multi → single switch → green. Step 14 suite run 426 passed; full suite 1027 passed, 86.78%; ruff clean.
- Files modified: `services/xstockstrat-analysis/tests/test_fundamentals_pit_pager.py` (new), `tests/test_fundamentals_formula_servicer.py`, `tests/test_analysis_servicer.py`
- Deviations: `test_live_loop.py` unchanged; partial structural parity (see Deviation Log).

### Step 15 — service: Backtest refusal (FR-2) [done]
- `_FundamentalsUnavailable` / `_FundamentalsUnknown` (carry `symbol`). `_backtest_symbol_evaluated(…, fund_cache, fund_failures)` loads PIT through the run cache/failures and runs `assess` over the in-window bar dates: UNAVAILABLE → refusal, UNKNOWN → unknown (no DISABLED on backtest). `RunBacktest`: run-level `fund_cache`, `fund_failures` (created before the formula-map build), `fund_refusals`, `fund_unknown`, `refused_diags`; `_prefetch_formula_warmups` / `_declared_formula_warmup` take `failures=` and record `("formula", fid) → UNKNOWN` only when building `fund_map`; `_formula_fundamentals(…, failures=fund_failures)` on the unprefixed branch. Refusal: WARN naming symbol + strategy + `NO_TRADE_REASON_FUNDAMENTALS_UNAVAILABLE`, reason-5 diagnostic, no cell. Unknown: WARN, `fundamentals fetch failed for <sym> — rerun` run warning, no cell. Status gate adds `fund_refusals or fund_unknown`. `_fundamentals_gap_labels` makes one `GetEtfFlags` call with the inbound `propagation_meta` (C-03), unset/true/false → UNSPECIFIED/ETF/NOT_ETF, any error → `{}`. `fund_cache`/`fund_failures` exist for Step 17's recompute hand-off.
- TDD (paired with Step 16): RED (behavioral) 8 failed, 3 passed: SCHD diagnostics `NO_TRADE_REASON_ENTRY_NEVER_TRUE` (want 5 — the original silent no-trade), `'fundamentals fetch failed for SCHD — rerun' in []`, formula outage no warnings. GREEN: 43 passed (backtest guard + guard); full suite 1038 passed, coverage 86.90%; ruff clean.
- Files modified: `services/xstockstrat-analysis/app/handlers/servicer.py`
- Deviations: none

### Step 16 — test: Backtest refusal [done]
- C-13: `tests/conftest.py` gains `fund_period`, `SCHD_PIT_PERIODS = []` and `AAPL_PIT_PERIODS` (three 2024 quarterly filings with all six fscore metrics); `test_fundamentals_guard.py` re-imports them (one declaration). New `tests/test_backtest_fundamentals_guard.py` (real evaluator, real `Bar` times, gate on unless stated): (a) `@AC-2/@AC-5` SCHD → reason 5 + `FUNDAMENTALS_GAP_ETF`, INSUFFICIENT_DATA, no SCHD cell, WARN with SCHD + strategy + "fundamentals unavailable", GetEtfFlags carries the inbound trio; (b) AAPL traded + cell, SCHD refused, OK; (c) `@AC-3` squeeze on SCHD untouched with no PIT call, blend on AAPL not refused; (d) `@AC-8` UNAVAILABLE → rerun warning, no reason 5, no cell; (e) `@AC-10` filing on the last bar → refused; (f) GetEtfFlags error → reason 5 + UNSPECIFIED; (g) gate off → ENTRY_NEVER_TRUE; (h) `@AC-12` endless token → rerun warning, exactly `_MAX_FUND_PAGES` calls, no cell; (i) GetFormula outage, prefixed and unprefixed → rerun warning per symbol, no reason 5, no FORMULA_ERROR, no cell; gate off → FORMULA_ERROR kept.
- AC-2/3/5/8/10/12 red: see Step 15 (8 failed) → green: 43 passed. Full suite 1038 passed, 86.90%; ruff clean; C-13 check: 1 `AAPL_PIT_PERIODS = ` declaration.
- Files modified: `services/xstockstrat-analysis/tests/test_backtest_fundamentals_guard.py` (new), `tests/conftest.py`, `tests/test_fundamentals_guard.py`
- Deviations: SMA technical leg; prefixed range start; operand-miss reads `beta` (see Deviation Log).

## Session 2026-10-11 — sdd-execute (Steps 7–16 checkpoint)
**Steps this session**: 7, 8, 9, 10, 11, 12, 13, 14, 15, 16
**Progress**: 16 done / 26 total
**Stopped at**: Step 16 (scope of this run; marketdata absence + ETF label and the analysis guard core + backtest refusal are in)
**Next**: /sdd-execute block-fundamentals-strategy-on-etf sequential (Step 17, derivation-time evidence exclusion)
**Open item**: PR #1239 (golangci-lint v2.14.0 CI fix) is still not on `origin/main-dev`, so CI Go lint on this branch stays red; local v2.14.0 lint is clean for every marketdata step. Merge `origin/main-dev` once it lands.

## Session 2026-10-11 — sdd-execute (sequential, autonomous, Steps 17–26)

- Mode: coordinator-delegated autonomous run of Steps 17–26, one commit per step on `feature/block-fundamentals-strategy-on-etf`. PR #1239 (golangci-lint v2.14.0 CI fix) was not on `origin/main-dev` at the start; checked again at each step boundary.

### Step 17 — service: Derivation-time evidence exclusion (H) [done]
- Repo: `_ELIGIBILITY_ORDER` hoisted (the `fetch_eligible` SQL is byte-identical) and `fetch_all_for_fingerprint` added (no `DISTINCT ON`, same order). Servicer: `_GradeInputsUnknown`, `_INTERACTIVE_DERIVATION_CONCURRENCY = 4`, `_exclude_refused_cells` (one `_formula_fundamentals` per call, PIT gathered once per distinct symbol under `sem` or a fresh local `Semaphore(4)`, per-cell window `range_start|date.min .. range_end|completed_at`, UNKNOWN raises, UNAVAILABLE drops with an INFO line, first surviving cell per symbol). `_fetch_and_aggregate` keeps today's `fetch_eligible` path when the gate is off or there is no FUNDAMENTAL/CUSTOM_FORMULA component; `meta` defaults to owner-only. Triggers: RunBacktest on `OK or fund_refusals > 0` with the run cache/failures + inbound trio and a `fundamentals availability unknown — grade unchanged` warning; ScoreStrategy forwards the trio, aborts UNAVAILABLE on UNKNOWN and NOT_FOUND naming the excluded symbols; UPDATE forwards the trio; boot shares one cache set per pass under `_readiness_materializer_bars_sem`. `main.py` runs the boot recompute via `create_task`. No `DELETE` added.
- TDD (paired with Step 18): RED 1 = collection `ImportError` (`_INTERACTIVE_DERIVATION_CONCURRENCY`, `_ELIGIBILITY_ORDER`). RED 2 after adding only those declarations: 16 failed, 3 passed (e.g. SCHD still counted, `fetch_all_for_fingerprint` never awaited, the refused-only run never recomputed, peak in-flight 10 instead of 4, generic RunBacktest warning). GREEN: Step 18 suites 377 passed; full suite 1058 passed, coverage 86.95%; ruff check + format clean.
- Files modified: `services/xstockstrat-analysis/app/handlers/servicer.py`, `app/repositories/backtest_run_symbols.py`, `app/main.py`
- Deviations: `excluded` = symbols left with no surviving cell (see Deviation Log).

### Step 18 — test: Derivation exclusion [done]
- New `tests/test_grade_fundamentals_exclusion.py` (real guard + pager over `_proto_page` stubs, conftest `AAPL_PIT_PERIODS`/`SCHD_PIT_PERIODS`): `@AC-11` AAPL counted, both SCHD cells excluded (INFO line), repo spy shows only `fetch_all_for_fingerprint` (no insert/delete); NULL `range_end` → `completed_at` (kept at 2024-06-01, excluded at 2024-05-01); all-excluded clears the grade and ScoreStrategy NOT_FOUND names SCHD; refused-only RunBacktest awaits the recompute with the run cache + inbound trio + no sem; the run cache is reused (1 PIT call total); PIT outage → `_GradeInputsUnknown`, ScoreStrategy UNAVAILABLE with the exact message; RunBacktest / UPDATE / boot keep the grade and warn; GetFormula outage → UNKNOWN, nothing persisted; a run-level failure freezes the grade; filter-before-dedup keeps the lower-ranked eligible window; boot shares the cache (2 PIT calls, 1 GetFormula over 2 pairs) and takes the background sem with owner-only meta; interactive 10-symbol recompute peaks at 4 in flight, never takes the background sem, forwards the trio on PIT + GetFormula; concurrent RunBacktest + ScoreStrategy under the lock; non-fundamentals strategy byte-identical with zero marketdata/indicators calls; gate off keeps `fetch_eligible`; `@AC-12` 60-period page + AAPL page drained (2 calls), not excluded. Repo: `fetch_all_for_fingerprint` SQL has no `DISTINCT ON` and shares `_ELIGIBILITY_ORDER` with `fetch_eligible`.
- AC-11/AC-12 red: see Step 17 (16 failed) → green: 25 passed (new file + repo); Step 18 Verification suites 377 passed; full suite 1058 passed, 86.95%; ruff clean.
- Files modified: `services/xstockstrat-analysis/tests/test_grade_fundamentals_exclusion.py` (new), `tests/test_backtest_run_symbols_repo.py`
- Deviations: none (`test_owner_dimension.py` and `test_analysis_servicer.py` needed no change: the new kwargs are keyword-only, so `c.args` stays `(user, strategy)`).

### Step 19 — service: Live deny-entry + state-change WARN/alert (FR-4) [done]
- `__init__` gains `_fund_unavailable` (in-memory; a restart re-alerts at most once per unavailable pair). `_eval_pair` builds a per-call `failures` dict for `_load_fundamentals`, `declared_formula_fundamentals` and `_load_fundamentals_snapshot`, computes `key` before evaluation and runs `assess` over the bar dates. UNAVAILABLE → `deny_entry = True`; on entering the state the key is added first, then one WARN (`… entry denied — NO_TRADE_REASON_FUNDAMENTALS_UNAVAILABLE (fundamentals unavailable)`) and one `_emit_fundamentals_unavailable_alert` (WARNING, category `strategy`, title `Strategy <id>: fundamentals unavailable for <sym>`, `strategy_id:` tag) inside `try/except`. AVAILABLE / NOT_REQUIRED discard the key; UNKNOWN / DISABLED / NOT_ASSESSED change nothing. The exit branch and `_replay_state` are untouched.
- TDD (paired with Step 20): RED 8 failed, 2 passed — SCHD entered (`_last_state … True is False`), 0 fundamentals alerts (want 1), `AttributeError: … '_fund_unavailable'`. GREEN: `test_live_loop.py` 62 passed; full suite 1068 passed, coverage 87.00%; ruff clean.
- Files modified: `services/xstockstrat-analysis/app/engine/live_loop.py`
- Deviations: none

### Step 20 — test: Live deny-entry [done]
- `tests/test_live_loop.py` gains `TestLiveLoopFundamentalsDenyEntry_feature215` (gate on, blend = fscore formula with the seeded `FUNDAMENTAL_INPUTS`, live snapshot channel): `@AC-6/@AC-5` three SCHD cycles (snapshot NotFound) with entry true → no entry, exactly one WARN naming SCHD + strategy + `NO_TRADE_REASON_FUNDAMENTALS_UNAVAILABLE`, exactly one WARNING alert (title/category/tag pinned); held exit still fires; recover (AAPL-shaped snapshot) then relapse → second alert; a raising `EmitAlert` is not retried next cycle; `@AC-9` snapshot FAILED_PRECONDITION (DISABLED) and UNAVAILABLE (UNKNOWN) → no fundamentals alert, no state, entry not denied; PIT UNAVAILABLE on a `pe_ratio` operand (UNKNOWN) → no alert; empty bars → `_EVAL_NO_BARS`, no alert; AAPL with fundamentals → normal entry alert; `@AC-12` a 2-page PIT history (60 empty periods + `AAPL_PIT_PERIODS`) is fully loaded (2 calls, all periods fed to the evaluator) and a `dividend_yield` operand enters.
- AC-5/AC-6/AC-9/AC-12 red: see Step 19 (8 failed) → green: 62 passed; full suite 1068 passed, 87.00%; ruff clean. C-13: `AAPL_PIT_PERIODS` / `fund_period` from `tests/conftest.py`; SCHD needs no PIT fixture here (the blend reads the live snapshot channel, stubbed NotFound).
- Files modified: `services/xstockstrat-analysis/tests/test_live_loop.py`
- Deviations: none

### Step 21 — service: Opportunity skip row + heal (FR-3) [done]
- `_compute_opportunities`: per-pass `fund_failures` + one gate read; `_row_for` passes `failures=` to all three loaders and runs `assess` (bars dates, `bars_failed = sym in fetch_failed or not bars`) before evaluation. Entry + UNAVAILABLE → `fund_skip` (no evaluation, empty readiness); UNKNOWN on either rule → row-local `fund_unknown` (no evaluation); everything else evaluates as today. The action resolves as today (speculative-sell drop kept), then a skip forces UNSPECIFIED + `"fundamentals_unavailable"`. `sym_unavailable = evaluated and not fund_skip and (sym in fetch_failed or fund_unknown)`; conviction, signal axis and composite are zeroed for `sym_unavailable or fund_skip`. After the gather, one `_fundamentals_gap_labels` call labels the skip rows (`readiness_json["fundamentals_gap"]`, only when non-zero).
- `_retry_unavailable_symbols`: per-call `heal_failures`; after a good bars fetch the same `assess` runs. Entry + UNAVAILABLE → heal row with `"action": 0`, `"unavailable"` swapped for `"fundamentals_unavailable"`, zeroed axes, NULL composite, empty readiness + label, `_healed` (fresh window), never staged into the readiness cache. UNKNOWN stays `still_unavailable`. Everything else heals as today (no `"action"` key, so COALESCE keeps the stored action). Healed skip rows are labelled with one call before `replace_symbols`.
- TDD (paired with Step 22): RED 6 failed, 6 passed (`'fundamentals_unavailable' in ['watchlist']`, SCHD action ENTER not UNSPECIFIED, the outage rows not stamped `"unavailable"`, `KeyError: 'action'` on the heal). GREEN: Step 22 suites 346 passed; full suite 1080 passed, coverage 87.22%; ruff clean.
- Files modified: `services/xstockstrat-analysis/app/handlers/servicer.py`
- Deviations: shared label helper; heal evaluation re-indented under the UNKNOWN branch (see Deviation Log).

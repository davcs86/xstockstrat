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

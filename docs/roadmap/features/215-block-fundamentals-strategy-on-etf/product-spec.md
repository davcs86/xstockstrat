# Product Spec: block-fundamentals-strategy-on-etf

**Created**: 2026-09-27

---

## Problem Statement

A strategy gated on fundamentals (e.g. `fundamentals_macd_blend`, whose entry rule requires
`fscore.composite > 0.5`) run against an **ETF** silently produces a misleading result. ETFs have no
SEC-EDGAR company fundamentals (feature 211 sources fundamentals from company XBRL only), so the
fundamentals operand has no inputs and the gate never evaluates true — the run looks like a
legitimate "no trade" / empty opportunity set rather than an explicit "this strategy cannot be
evaluated on this asset." Traders and the opportunity engine can't tell a real no-signal from an
un-evaluable one.

## User Story

As a strategy author / the opportunity engine, I want a fundamentals-gated strategy to be **refused
or skipped with an explicit, auditable reason** when applied to an ETF, so that I never mistake an
un-evaluable asset for a genuine no-trade signal.

## Functional Requirements

FR-1. **Define "requires fundamentals" precisely.** A strategy requires fundamentals when any of its
components is a fundamental operand — the seeded `fscore` custom formula, or any
`COMPONENT_KIND_CUSTOM_FORMULA` whose formula declares `fundamental_inputs` (feature 201), or a
component that reads a `fundamental` metric. The detector must be a single shared predicate reused by
every guarded path (no per-path re-derivation).

FR-2. **Backtest path.** When a fundamentals-requiring strategy is backtested against an ETF, that
symbol is refused/skipped with an explicit, auditable reason (an enumerated `no_trade_reason` such as
`NO_TRADE_REASON_FUNDAMENTALS_UNAVAILABLE`, or a validation error when the whole run is ineligible) —
never a silent `total_trades: 0` that reads like a real no-signal.

FR-3. **Opportunity / screener path.** A fundamentals-requiring strategy does not emit or evaluate
opportunities for ETF symbols; ETFs are excluded from that strategy's universe with an auditable skip
reason, not dropped silently.

FR-4. **Live-enable path.** Enabling a fundamentals-requiring strategy whose target universe is
ETF-only (or applying it live to an ETF) is surfaced as a guardrail condition rather than silently
running with no inputs. (Exact enforcement point — enable-time vs eval-time — is a design question,
see Open Questions.)

FR-5. **No false positives.** Non-ETF equities (common stock with EDGAR fundamentals) are entirely
unaffected — same results as today. A strategy with **no** fundamental operand is unaffected on ETFs
too (it may legitimately trade ETFs on price/indicator rules).

FR-6. **Auditable.** Each refusal/skip is observable (enumerated reason on the response and/or a
WARN/INFO log line naming the symbol, the strategy, and "fundamentals unavailable — ETF"), so the
condition can be confirmed after the fact — mirroring the feature-211 fail-closed/audit posture.

## Out of Scope

- Providing ETF-level fundamentals from a non-EDGAR source (a separate capability, not this guardrail).
- Changing how non-fundamentals strategies treat ETFs.
- Any change to the EDGAR ingestion / feature-211 fundamentals derivation itself.

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-analysis` — owns backtest, strategy definitions, and opportunity/screener evaluation; the guardrail predicate + enforcement lives here.
- `xstockstrat-marketdata` — candidate source of truth for "is this symbol an ETF" (asset metadata) and/or the fundamentals-availability signal.
- `xstockstrat-ui` / `xstockstrat-agent` — surfaces the refusal/skip reason on the backtest and opportunity consumer surfaces (see Consumer Surface(s)).

## Consumer Surface(s)

_Constitution **C-14**._

- [x] **Agent** — `xstockstrat-agent` MCP tool(s): `run_backtest` (the enumerated `no_trade_reason` / validation error must surface in its summary), and `set_strategy_live` (guardrail on live-enable). Possibly `list_opportunities` (ETFs absent for a fundamentals-gated strategy, with reason).
- [x] **UI** — `xstockstrat-ui` `/insights`: the backtest result view and the opportunities/Decide queue must render the refusal/skip reason (not a blank/zero result). The backtest `no_trade_reason` is rendered in `services/xstockstrat-ui/src/components/insights/BacktestDiagnostics.tsx` (not `opportunityShared.tsx` — that file holds the `OpportunityActionTag`/`ConditionState`/`PositionRiskFlag`/`SourceHealthStatus`/`HaltSource` maps but **no `NoTradeReason` map**); design/spec confirms whether an opportunity skip-reason needs its own render path.
- [ ] **None**

## Proto Contract Changes

- [ ] No proto changes required
- OR (likely): a new enumerated `no_trade_reason` value (e.g. `NO_TRADE_REASON_FUNDAMENTALS_UNAVAILABLE`) on the backtest diagnostics message, and/or an opportunity skip-reason. **Additive enum value → non-breaking** (confirmed against `packages/proto/analysis/v1/analysis.proto:189` — `NoTradeReason` currently 0–4, next-free `= 5`), but must carry the `_UNSPECIFIED = 0` discipline and a matching UI render update in `BacktestDiagnostics.tsx` (the actual `no_trade_reason` render site). Confirm during design.

## Config Key Changes

- [x] No new config keys _(likely — the guardrail is unconditional. A kill-switch gate is a design option, see Open Questions.)_

## Database Changes

- [x] No schema changes

## Feature Workflow Notes

Branch to create: `feature/block-fundamentals-strategy-on-etf` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (if the additive `no_trade_reason` enum value is the only proto change — non-breaking)
- [ ] 2 service owners + platform lead (breaking proto change) — not expected
- [ ] DBA review + service owner (schema migration) — none

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

- [ ] **ETF detection is the crux (design fork).** Alpaca's `asset_class` is `us_equity` for **both**
  common stock and ETFs — `ListAssets.assetClass` does **not** distinguish them, so the story's
  "detect ETF via asset class" may not be directly implementable. Options to weigh in `/sdd-design`:
  (a) treat **"no producible EDGAR fundamentals"** as the guard condition (directly detectable, and
  the true root cause — but it also catches un-backfilled or non-SEC-filer stocks, so it may need to
  pair with "CIK known but fund-history empty"); (b) use a vendor profile `type == "ETF"` field
  (Finnhub `/stock/profile2`); (c) a maintained ETF symbol set / asset attribute. **No approach is
  pre-selected — `/sdd-design` decides** among (a)/(b)/(c) (or another) via its proposer/adversary
  debate; the spec states the options without a recommendation (operator declined to pre-lock, this
  session).
- [ ] **Enforcement granularity:** per-symbol skip-with-reason within a mixed stock+ETF universe
  (preferred — matches the backtest diagnostics shape) vs. whole-run rejection.
- [ ] **Live-enable point:** block at `set_strategy_live` (needs the target universe then) vs. at
  eval-time per symbol. A strategy definition carries no symbol list, so enable-time may have nothing
  to check — likely eval-time is the enforceable point.
- [ ] **Reason channel:** new `no_trade_reason` enum value vs. reuse of an existing
  `INSUFFICIENT_DATA`-style reason. A distinct value is clearer for audit but is a proto change.
- [ ] **Known trap (ledger fails.md 2026-08-13, feature 129):** verify the fundamental-operand
  detector against the **real** strategy/formula shapes (fscore formula id, `fundamental_inputs`),
  not an assumed interface — and prove the guard on a real ETF run (SCHD), not only unit stubs.

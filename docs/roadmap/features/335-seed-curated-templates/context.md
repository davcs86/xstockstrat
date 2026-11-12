# Context: seed-curated-templates

**Feature**: `docs/roadmap/features/335-seed-curated-templates/feature.md`
**Product Spec**: `docs/roadmap/features/335-seed-curated-templates/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/335-seed-curated-templates/implementation-spec.md`

---

## Session 2026-11-12 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- Source of truth for the seed payloads: the operator's private instances in the `xstockstrat-staging`
  app, read on 2026-11-12 via the agent MCP tools `list_formulas`, `list_strategies(include_inactive=true)`
  and `list_signal_sources`. All three template catalogs were empty at that time.
- Operator decisions (2026-11-12, asked before the story was written):
  - Delivery = seed migrations, chosen over payload files for config-ui and over a new MCP
    `manage_template` tool. Operator's rationale: "Low risk, as they are templates and don't execute
    anything."
  - Formulas = curated, de-duplicated set of 7 (skip probes and near-duplicate z-score/ER variants).
  - Signal sources = all 5 verbatim, including the derived `fundamentals` source and the SEC
    `request_headers` User-Agent as stored.
  - Strategies = all non-junk strategies, not only the 3 `live_enabled` ones.
- Not yet decided — carried as product-spec Open Questions OQ-4..OQ-7.

## Session 2026-11-12 — sdd-story (operator follow-up decisions)

- **Parity requirement added by the operator** ("Verify the parity afterwards") → FR-9, AC-13/AC-14.
- **OQ-1 sign-off (C-16 CHANGE, Commandment-level override recorded here):** operator approved amending
  `platform.feature` `@AC-15 @feature-224` "Catalog starts empty after migration". Seeds land in every
  environment, production included.
- **OQ-2:** operator rule — "Keep the live version, if none, try to find the one with better
  fittings/results to decide which version to drop." None of the range-mean-reversion family is
  `live_enabled`. Comparison backtest in staging, identical inputs (AAPL, MSFT, NVDA, AMZN, GOOGL, JPM,
  XOM, KO; 2024-07-01..2026-06-30; `sizing_mode=portfolio`, `fill_model=next_bar_open`, $100k):

  | strategy | trades | total return | profit factor | Sharpe | max DD | backtest_id |
  |---|---|---|---|---|---|---|
  | `range_mean_reversion` (v1) | 1 | +0.09% | n/a (1 win) | 0.14 | 0.5% | `be9c7bae-8bdf-473a-a853-d90b52b03b56` |
  | `range_mean_reversion_v2` | 60 | +0.15% | 1.016 | 0.04 | 6.0% | `9f6d5467-cd92-4b9b-99e5-a7afed6f5779` |
  | `range_mean_reversion_v3` | 80 | -0.65% | 0.949 | -0.08 | 4.9% | `ede35765-2e1a-4a19-92c6-ca19db22fcd0` |

  Decision: keep **v2** (best return and profit factor on a usable sample), drop v3 (negative) and v1
  (one trade in two years — its entry almost never fires, so it is no evidence). The margin is thin and
  rests on one window and one megacap basket; this ranks the three, it does not validate v2. Consequence:
  `rolling_zscore_v2` + `kaufman_efficiency_ratio_v2` join the formula set (9), `zscore_close_20` +
  `kaufman_er_close_10` stay out. The 730-day span cap rejected the first attempt (2024-01-01 start).
  These three runs persisted backtest evidence rows in staging.
- **OQ-3:** operator — "Skip from templates BUT add the migrator to seed the fundamentals sources,
  otherwise is missing." → FR-8. Grounding: no ingest migration seeds it today; the row is created at
  runtime by analysis `fundsignal_loop._ensure_source_registered`. A non-system caller can never
  register the slug (`_register_conflict`, AC-36).

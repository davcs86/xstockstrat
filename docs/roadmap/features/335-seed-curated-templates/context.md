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

## Session 2026-11-12 — sdd-review product-spec

- First pass FAILED: criterion 9 (OQ-4..OQ-7 and two known traps unchecked) and criterion 10 (C-10(c),
  no governance for seeded shared rows). Fixed in the spec: FR-6 reworded (insert-if-absent; down deletes
  only untouched `system` rows; never the `fundamentals` source), FR-10 (identity + mutation semantics),
  FR-11 (composite pinned to the code module), AC-16..AC-21.
- Decided without asking the operator (defaults; reversible until the migrations ship): `created_by =
  'system'`, `template_id = tpl-<slug>`, seeded templates are admin-editable/retirable and never
  reverted by a later migration.
- Second pass: product spec approved. Status: draft → spec-ready. Tree: b2cade0 + working changes,
  0 commits behind origin/main-dev.
- Warnings: SEC User-Agent contact email seeded verbatim into every environment (operator decision).
- Overlap findings: none blocking. 334 `webhook-fanout-callback` owns ingest `015` (already on
  main-dev); 335 takes `016`. 318 `fix-migration-tooling-safety` (spec-ready) touches dirty-recovery
  replay — re-check before execute.
- Recommended design depth: full (DB migrations, 3 affected services, C-16 CHANGE of `@AC-15`).

## Session 2026-11-12 — sdd-design (in progress)

- Phase 0 Recon: wrote recon.md (indicators, analysis, ingest, migration tooling; 1 CHANGE / 1 EXTEND / 26 PRESERVE business rules).
- Phase 1 round 1 (full mode): register in debate.md — D-1..D-12 settled, R-1..R-3 locked, O-1/5/8/9/10/11/12/14 open. No Floor breach.
- Staging config read 2026-11-12: `analysis.fundsignal.source_slug = fundamentals`, `analysis.engine.fundamentals_blend_strategy_id = fundamentals_macd_blend`, `fundsignal.enabled = true`.
- Round-1 gate, operator answers (verbatim):
  - Parity proof → "Hash export + behaviour check": operator runs a read-only staging SELECT (md5 of formula source/parameters; slug, extractor_module, config_json of sources), output committed and compared by the checker before merge; after staging deploy each strategy template is instantiated and its backtest must match the original's numbers, as a gate before promotion to `main`.
  - C-10(c) protection → "Protect referenced formulas" (operator declined the unprotected waiver). This supersedes the story-phase default in FR-10 ("ordinary catalog content, any admin may UPDATE/RETIRE") and brings a servicer change into scope.
  - Blend id → free text: "fundamentals_macd_blend and referenced formulas are system special cases to preserve integrity. If a template references any formula, create a separate formula template. Duplication is acceptable in this case."
- Clarification round (operator, verbatim):
  - Formula layout → "Only the blend's formula is separate": the Fundamentals Composite gets its own template row, not linked to the system formula `d1ff5e6b-…`; all other strategy templates share the standalone formula templates.
  - Protection scope → "All seeded system templates": every `created_by='system'` template row (formula, strategy, source) is read-only through `ManageTemplate` (UPDATE and RETIRE refused); changes ship only by migration. **Supersedes FR-7/FR-10's "any admin may UPDATE or RETIRE" and AC-8/AC-10/AC-16/AC-17 as written at story time.** Brings a servicer guard in all three services into scope (the feature is no longer data-only).
  - Blend → "fundamentals_macd_blend is seeded as a system strategy, not a template, like its formulas, except when a template references them. In that case, create the formula and the template without linking them."
  - Follow-up after being told no system-owned strategies exist → "right, do not create system strategies/formulas. Assign it to the user created by the migrator (admin@localhost). AND create the templates for the other users."
  - Orchestrator's reading, to be confirmed at the approval gate: (1) the blend strategy itself is seeded as a real strategy owned by the migrator's seed admin (`SEED_USER_ID`), referencing the existing system formula; (2) the blend strategy template and the composite formula template are still seeded for everyone else; (3) no new `system`-owned strategy or formula row is created. Not yet decided by the operator: whether the seeded blend strategy starts active/live, and the template's default `strategy_id` given the reserved-id guard.

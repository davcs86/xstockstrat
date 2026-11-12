# Product Spec: seed-curated-templates

**Created**: 2026-11-12

---

## Problem Statement

The template catalog introduced by feature 224 is empty in every environment: formulas, strategies and
signal sources are private to their owner, and the only authoring path is the admin-gated
`ManageTemplate` RPC behind config-ui. The platform's vetted formulas, strategies and sources exist only
as one operator's private staging instances, so no other user can start from them.

## User Story

As a platform admin, I want the curated staging formulas, signal sources and non-junk strategies seeded
as templates by migration, so that every environment has a starting catalog users copy with
`instantiate_template`.

## Functional Requirements

FR-1. A seed migration in `xstockstrat-indicators` inserts 9 formula templates into
`indicators.formula_templates`, each payload carrying the staging formula's `source`, `parameters`,
`outputs`, `warmupPeriod` and `fundamentalInputs` unchanged: Volatility Trailing Stop Direction,
Bollinger Squeeze Percentile, Fundamentals Value+Quality Composite (v1), SMA Trend Slope (fractional),
Momentum Quality (Clenow), Kaufman Efficiency Ratio, Mean-Reversion Z-Score, plus `rolling_zscore_v2`
and `kaufman_efficiency_ratio_v2` (the two formulas `range_mean_reversion_v2` depends on — see
`context.md` 2026-11-12 backtest decision).

FR-2. A seed migration in `xstockstrat-analysis` inserts one strategy template per non-junk staging
strategy into `analysis.strategy_templates`. Seeded set (14): `dip_buyer_vol_stop`,
`squeeze_breakout_trend`, `fundamentals_macd_blend` (the three `live_enabled` ones),
`dip_buyer_vol_stop_m25`, `dip_buyer_vol_stop_m35`, `dip_buyer_regime_filtered`,
`dip_buyer_market_regime_voo`, `squeeze_macd_mq`, `squeeze_mq_confirmed`, `zscore_trend_filtered`,
`clenow_momentum_regime`, `range_mean_reversion_v2`, `quality_dip_buyer`, `golden_cross_conviction`.
Excluded as junk: `zz_fscore_probe`, `dbg_regime_voo_inverted`, `diag_formula_probe`, `jjjjjjj`, `bbbb`,
`aaaa`, `rsi20`. Excluded as superseded versions of the range-mean-reversion family (none is live; v2
had the best backtest): `range_mean_reversion`, `range_mean_reversion_v3`.

FR-3. Every custom-formula component of a seeded strategy template references a formula **template** id
seeded by FR-1 (the `StrategyTemplate.payload` contract), so instantiating the strategy deep-copies its
formulas.

FR-4. No seeded strategy template carries `active` or `live_enabled`; an instantiated copy is inactive
and non-live.

FR-5. A seed migration in `xstockstrat-ingest` inserts 4 source templates into
`ingest.source_templates` with `source_type`, `display_name`, `extractor_module`, `reliability_weight`
and `config_json` as stored in staging: `sec_edgar_8k`, `sec_edgar_form4`, `prnewswire_releases`,
`robinhood_snacks`. The derived `fundamentals` source is **not** a template (its slug is system-reserved,
so a copy can never be instantiated or fed).

FR-6. Each of the three seed migrations is idempotent (safe under `db-migrate.sh` dirty-recovery replay
from 001), never overwrites or un-retires a row that already exists under the same `template_id`
(insert-if-absent only), and has a `.down.sql` that deletes only the seeded `template_id`s that are still
at `version = 1`, not retired, and `created_by = 'system'`. The ingest down never deletes the
`fundamentals` signal source (signals reference it and the producer may have created it at runtime).

FR-7. Seeded templates behave as admin-authored ones: listed by `ListTemplates`, editable and retirable
through `ManageTemplate`, copyable through `InstantiateTemplate`.

FR-8. The same ingest migration seeds the `system`-owned `derived` signal source `fundamentals`
("Fundamentals Signal Producer", empty config, weight 1.0) into `ingest.signal_sources` when absent, so
it exists before the analysis fundamentals producer first runs. It never modifies an existing row and
coexists with the producer's runtime `_ensure_source_registered`.

FR-9. Parity is verified after the seeds are applied: every seeded template payload is compared
field-by-field with its staging source instance (formula `source`/`parameters`/`outputs`/`warmupPeriod`/
`fundamentalInputs`; strategy `components`/`entry_rule`/`exit_rule`/`cooldown_days`/`exit_cooldown_days`/
`signal_params`; source `source_type`/`display_name`/`extractor_module`/`reliability_weight`/
`config_json`). The only permitted differences are an explicit allowlist: formula ids rewritten to
formula template ids, `active`/`live_enabled` cleared, and owner/timestamp/id fields. Any other
difference fails the check.

FR-10. Seeded template identity and governance (C-10(c)): every seeded row has `created_by = 'system'`
(the existing reserved platform identity, `SYSTEM_AUTHOR`/`SYSTEM_OWNER`) and a `template_id` of the form
`tpl-<slug>` — formulas a snake_case slug of the name (e.g. `tpl-volatility_trailing_stop`), strategies
`tpl-<strategy_id>`, sources `tpl-<slug>`. A seeded template is ordinary catalog content, not a protected
resource: any admin may UPDATE or RETIRE it (FR-7), and no later migration may revert an admin's edit or
retirement — a future catalog change ships as a new migration that touches only rows still at the
version it expects. The seeded system `fundamentals` source keeps its existing protection (system-held
slug is read-only to every non-system caller).

FR-11. The seeded "Fundamentals Value+Quality Composite (v1)" template payload stays identical to the
code-defined system formula (`services/xstockstrat-indicators/app/formulas/fundamentals_value_quality.py`):
a test fails when the template's `source`, `parameters`, `outputs` or `fundamentalInputs` differ from
that module, so the two cannot drift silently.

## Out of Scope

- An MCP `manage_template` authoring tool (feature-gap NC-D).
- Any proto, RPC, servicer or UI change.
- Mutating the operator's existing staging instances (no back-fill of `origin_template_id`).
- Templating the junk/probe formulas and strategies, or the formulas only the dropped
  `range_mean_reversion_v3` uses (`zscore_close_20`, `kaufman_er_close_10`).

## Affected Services

- `xstockstrat-indicators` — seed migration into `indicators.formula_templates`
- `xstockstrat-analysis` — seed migration into `analysis.strategy_templates`
- `xstockstrat-ingest` — seed migration into `ingest.source_templates` and the system `fundamentals`
  row in `ingest.signal_sources`

## Consumer Surface(s)

- [x] **UI** — `xstockstrat-ui` `/config-ui` and `/insights` template views: no code change; the
  existing template lists render the seeded rows.
- [x] **Agent** — `xstockstrat-agent` MCP tools `list_templates` and `instantiate_template`: no code
  change; they return and copy the seeded rows.
- [ ] **None**

## Proto Contract Changes

- [x] No proto changes required

## Config Key Changes

- [x] No new config keys

## Database Changes

Data-only (no DDL). One new numbered up/down pair per service: `services/xstockstrat-indicators/migrations/008_*`,
`services/xstockstrat-analysis/migrations/028_*`, `services/xstockstrat-ingest/migrations/016_*`. These
are max+1 on `main-dev` at 2026-11-12 (007 / 027 / 015 are the trunk tips; no in-flight feature claims
008 / 028 / 016 per the `/sdd-review` overlap scan). `/sdd-design` and `/sdd-execute` re-derive them from
the union of origin refs and take max+1 at merge if a peer lands first.

Parity snapshot: the staging instances read on 2026-11-12 are committed as a JSON fixture (path fixed at
design) and are the reference for FR-9.

## Feature Workflow Notes

Branch to create: `feature/seed-curated-templates` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [ ] 1 service owner approval (non-breaking proto or config change)
- [ ] 2 service owners + platform lead (breaking proto change)
- [x] DBA review + service owner (schema migration)

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

- [x] **OQ-1 — resolved 2026-11-12 (operator sign-off).** This feature reverses the durable rule
  `platform.feature` `@AC-15 @feature-224` "Catalog starts empty after migration"; that scenario is
  amended by this feature (C-16 CHANGE), and the "No seed rows (AC-15)" comments in migrations
  007/026/013 stay untouched (applied migrations are never edited).
- [x] **OQ-2 — resolved 2026-11-12.** Operator rule: keep the live version, else the better-performing
  one. None of the three is live; on the comparison backtest v2 won, so v2 and its two formulas are
  seeded and v1/v3 dropped (numbers in `context.md`).
- [x] **OQ-3 — resolved 2026-11-12.** `fundamentals` is not a template; FR-8 seeds the system source
  itself instead.
- [x] **OQ-4 — resolved 2026-11-12 (operator).** Sources are seeded verbatim, including the SEC
  `request_headers` User-Agent contact as stored; the operator chose "verbatim" with the email
  consequence stated in the question.
- [x] **OQ-5 — resolved.** `created_by = 'system'` (FR-10): no env dependency (indicators migrations
  have no `SEED_USER_ID`), and it marks the rows as platform-seeded for the down migration.
- [x] **OQ-6 — resolved.** `tpl-<slug>` (FR-10).
- [x] **OQ-7 — resolved.** A strategy template can only reference formula *templates*
  (`InstantiateTemplate` copies each `formula_id` through indicators), so the composite must be a
  template; FR-11 pins it to the code module.
- [x] **Known trap (ledger fails 2026-07-01, 063, C-10(c)) — resolved** by FR-10 / FR-6.
- [x] **Known trap (ledger fails 2026-08-06, `migration`) — resolved** under Database Changes.
- Note for design (not blocking): `fundamentals_macd_blend` is the configured blend id
  (`analysis.engine.fundamentals_blend_strategy_id`); `_require_admin_for_blend_id` refuses a non-admin
  instantiating it under its default id, so a non-admin must pass another `strategy_id`.

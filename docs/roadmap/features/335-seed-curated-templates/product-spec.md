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

FR-6. Each seed migration is idempotent (safe under `db-migrate.sh` dirty-recovery replay from 001),
never overwrites a template an admin already authored under the same `template_id`, and has a `.down.sql`
that removes only the rows it seeded.

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

Data-only (no DDL). One new numbered up/down pair per service — next free at story time:
`services/xstockstrat-indicators/migrations/008_*`, `services/xstockstrat-analysis/migrations/028_*`,
`services/xstockstrat-ingest/migrations/016_*` (re-check against every origin ref at design time —
ledger fails 2026-08-06 `migration`).

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
- [ ] **OQ-4 — operator email in a committed migration.** "Verbatim" puts the SEC `User-Agent` contact
  email into the repo and into every instance in every environment, production included.
- [ ] **OQ-5 — `created_by` value.** `system` sentinel vs the `SEED_USER_ID` env used by 026/013.
- [ ] **OQ-6 — `template_id` scheme** (e.g. `tpl-<slug>`), immutable once shipped.
- [ ] **OQ-7 — Fundamentals Value+Quality Composite** is seeded from code as the `system` formula
  (`app/formulas/fundamentals_value_quality.py`); the template must not drift from it (single source,
  DRY) and C-10(c) protection applies.
- [ ] **Known trap (ledger fails 2026-07-01, 063, C-10(c))** — a seeded/shared resource needs explicit
  mutation semantics: is a seeded template freely editable/retirable by any admin, and does a later seed
  migration respect an admin's edit or retirement?
- [ ] **Known trap (ledger fails 2026-08-06, `migration`)** — migration NNN must be derived from the
  union of every origin ref, not this branch's `ls`.

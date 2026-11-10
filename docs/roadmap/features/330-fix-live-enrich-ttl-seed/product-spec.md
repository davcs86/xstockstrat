# Product Spec: fix-live-enrich-ttl-seed

**Type**: bug
**GitHub Issue**: none (Issues disabled) — reports: docs/reports/2026-10-19-live-enrich-ttl-seed-below-poll-defect.md
**Severity**: SEV-3
**Created**: 2026-11-10

---

## Problem Statement

### Seeded live-enrich memo TTL (10s) is below the UI poll (15s), so the memo never hits

- **Observed**: migration `028` seeds `analysis.opportunity.live_enrich_ttl_seconds = 10` for staging
  and production, claiming each row equals the current code default. The analysis code default is now
  `20` (chosen to exceed the poll per feature-191 `@AC-9`). The UI re-polls `ListOpportunities` every
  15s, so with the seeded row applied every warm re-read finds the memo expired and refetches live
  quotes — the feature-177 memo is a no-op.
- **Expected**: the effective TTL exceeds the 15s poll interval (e.g. the code default 20).
- Report: [docs/reports/2026-10-19-live-enrich-ttl-seed-below-poll-defect.md](../../../reports/2026-10-19-live-enrich-ttl-seed-below-poll-defect.md)

## Reproduction Steps

1. Read `services/xstockstrat-config/migrations/028_analysis_opportunity_keys.up.sql:111-116` (seeded `'10'`).
2. Read the analysis code default (`20`) and `services/xstockstrat-ui/src/hooks/useOpportunities.ts:49` (`15_000`).
3. With the seed applied, poll `ListOpportunities` at 15s; every poll issues `BatchGetLatestPrice`.

## Root Cause Hypothesis

The code default was raised after 028 was written; no follow-up migration updated the seeded rows.
Current sites:
- `services/xstockstrat-config/migrations/028_analysis_opportunity_keys.up.sql:111,114` (staging + production rows, `'10'`)
- `services/xstockstrat-analysis/app/handlers/servicer.py:4819` — reads the namespace-relative key
  `opportunity.live_enrich_ttl_seconds` (default `20`); stored keys became namespace-relative in
  migration 044 (feature 296)
- `services/xstockstrat-config/migrations/041_heal_config_keys_to_reader_catalog.up.sql:79` catalogs the
  key's code default as `'20'`; its default-sync leaves `value_data` unchanged (`:515-516`), so the
  stored `'10'` may still be live — confirm per environment in recon.

## Affected Services

- xstockstrat-config (the fix: a new config migration)
- xstockstrat-analysis (reader; no code change expected)
- xstockstrat-ui (15s poller; no code change expected)

## Fix Scope

- Proto changes anticipated: **no** — a stored config value changes; no contract change.
- DB migrations anticipated: **yes** — a new numbered config data migration in `services/xstockstrat-config/migrations/` rewrites the seeded value; 028 is applied and must not be edited. The report's `SetConfig` alternative is not the fix: since feature 296 every read key's value is seeded by a config migration, not a manual `SetConfig`.
- Config key changes anticipated: **yes (value only)** — the existing key `opportunity.live_enrich_ttl_seconds` (namespace `analysis`) changes value in staging and production; no key is added, renamed or removed.
  Key contract (C-05): namespace `analysis`; stored key `opportunity.live_enrich_ttl_seconds`
  (namespace-relative — the migration must not use the `analysis.`-prefixed form 028 used); `value_type`
  `int`; code default `20`; reader `services/xstockstrat-analysis/app/handlers/servicer.py:4819`
  (`get_int_present`); live mechanism: `WatchConfig` snapshot, read per `ListOpportunities` request, no
  restart. This feature also owns correcting the row's stale "live-quote/sparkline memo" description
  (feature 322 defers it here — one owner per seed row).
- Migration shape: next free config NNN at `/sdd-spec` (048 today; 321 and 322 also add config migrations
  — take numbers in merge order), `.up.sql` + `.down.sql`; the down restores `'10'` on the rows the up
  changed. Approval: DBA + config owner.

## Open Questions

Deferred to `/sdd-design`; AC-1 (rows still at the seeded `'10'`) holds under either answer.

1. Overwrite policy: rewrite only rows still holding the seeded `'10'` (preserving any operator-set
   value), or every global row for the key? Per-user override rows in or out?

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev.

## Out of Scope

- Changing the UI poll interval or the analysis code default
- Refactoring unrelated to the bug

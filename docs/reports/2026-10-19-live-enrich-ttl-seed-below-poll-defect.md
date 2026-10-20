# Defect: Seeded live-enrich memo TTL (10s) is below the UI poll (15s), so the memo never hits

**Recorded**: 2026-10-19
**Severity**: SEV-3
**Impact type**: cache-ineffective
**Environment**: dev (main-dev) @ 1302e6d
**Affected service(s)**: xstockstrat-config, xstockstrat-analysis, xstockstrat-ui
**Config-only fix possible**: yes
**Source**: `docs/context-constitution-findings.md` § Latent bugs row "The seeded live-enrich memo TTL never hits" (flagged by feature 227)

## Observed
Migration `028` seeds `analysis.opportunity.live_enrich_ttl_seconds = 10` for staging and production,
claiming each row equals the current code default. The analysis code default is now `20` (chosen to
exceed the poll per feature-191 `@AC-9`). The UI re-polls `ListOpportunities` every 15s, so with the
seeded row applied, every warm re-read finds the memo expired and refetches live quotes — the
feature-177 memo is a no-op.

## Expected
The effective TTL exceeds the 15s poll interval (e.g. the code default 20).

## Reproduction
1. Read `028_analysis_opportunity_keys.up.sql:111-116` (seeded `'10'`).
2. Read `servicer.py:4700` (default `20`) and `useOpportunities.ts:49` (`15_000`).
3. With the seed applied, poll `ListOpportunities` at 15s; every poll issues `BatchGetLatestPrice`.

## Evidence
`services/xstockstrat-config/migrations/028_analysis_opportunity_keys.up.sql:111`
> ('analysis', 'analysis.opportunity.live_enrich_ttl_seconds', 'int', '10',

`services/xstockstrat-config/migrations/028_analysis_opportunity_keys.up.sql:9`
> -- Each row is seeded at its CURRENT code default, so applying this migration is a NO-runtime-behavior

`services/xstockstrat-analysis/app/handlers/servicer.py:4700`
> ttl = self._cfg.get_int_present("analysis.opportunity.live_enrich_ttl_seconds", 20)

`services/xstockstrat-ui/src/hooks/useOpportunities.ts:49`
> refetchInterval: 15_000,

## Root cause hypothesis
The code default was raised after 028 was written; no follow-up migration or `SetConfig` updated the
seeded rows. Fix: `SetConfig` the key to 20 in both environments (or add a new migration).

## Confidence
high

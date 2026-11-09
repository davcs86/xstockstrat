# Defect: Server-side opportunity sparkline removed but acceptance, proto field and agent projection remain

**Recorded**: 2026-10-19
**Severity**: SEV-3
**Impact type**: doc-drift
**Environment**: dev (main-dev) @ 1302e6d
**Affected service(s)**: xstockstrat-analysis, xstockstrat-agent, xstockstrat-config, packages/proto
**Config-only fix possible**: no
**Source**: `docs/context-constitution-findings.md` § Documentation that lies row "feature-191 acceptance (`@AC-8`)"

## Observed
Live enrichment (`_enrich_opportunities_live`) now calls only `BatchGetLatestPrice`; the UI fetches
its own sparkline bars. Residue of the old server-side sparkline:
- Durable acceptance `@AC-8` still requires "BatchGetBars once for all 30 symbols (sparkline)".
- `Opportunity.sparkline` (field 17) is never populated anywhere in `app/` of analysis.
- The agent still projects `o.sparkline` into its tool output (always empty).
- `analysis.opportunity.sparkline_bars` is documented as inert (no reader) yet seeded and bounded.
- Migration 028's description of the live-enrich TTL key still says "live-quote/sparkline memo".

## Expected
Drop the `BatchGetBars` step from `@AC-8`; deprecate `Opportunity.sparkline` (keep the field number);
remove the dead agent projection; retire or annotate the inert key.

## Reproduction
1. Read `services/xstockstrat-analysis/acceptance/opportunities-latency-fix.feature:24`.
2. `grep -n sparkline services/xstockstrat-analysis/app -r` → no matches.
3. Read `services/xstockstrat-agent/app/client.py:816-817`.

## Evidence
`services/xstockstrat-analysis/acceptance/opportunities-latency-fix.feature:24`
> And it calls BatchGetBars once for all 30 symbols (sparkline)

`services/xstockstrat-analysis/app/handlers/servicer.py:4736`
> self._marketdata.BatchGetLatestPrice(

`packages/proto/analysis/v1/analysis.proto:625`
> repeated SparklinePoint sparkline = 17;

`services/xstockstrat-agent/app/client.py:816-817`
> if o.sparkline:
> d["sparkline"] = [p.close if p.HasField("close") else None for p in o.sparkline]

`services/xstockstrat-analysis/CLAUDE.md:528`
> | `analysis.opportunity.sparkline_bars` | int | `20` | **Inert — no reader in `app/`.**

`services/xstockstrat-config/migrations/028_analysis_opportunity_keys.up.sql:112`
> 'Short TTL for the success-only per-symbol live-quote/sparkline memo (feature 177). Read via get_int_present (0 = memo disabled -> always fetch). Seeded unbounded.',

## Root cause hypothesis
The sparkline moved client-side (flagged by feature 227) without a sweep of the durable acceptance
suite, proto, agent projection and config metadata.

## Confidence
high

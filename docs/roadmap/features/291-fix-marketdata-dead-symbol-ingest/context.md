# Context Log: fix-marketdata-dead-symbol-ingest

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-04 (/sdd-triage)

- Bug reported via defect report `docs/reports/2026-11-04-marketdata-bar-ingest-dead-symbols-refetched-defect.md` (Issues disabled): marketdata re-ingests symbols that never return bars, every cycle, indefinitely
- Severity: SEV-3
- Routed to SDD path (Track C); environment recorded as dev (main-dev), Grafana label `staging`
- Created: feature.md, product-spec.md, acceptance.feature (regression scenario), status.md, context.md
- Affected services (from report): xstockstrat-marketdata
- Root cause hypothesis: Under investigation. The warm set has no eviction for symbols without data and the feature 282 OTC filter does not cover these. LXP and PSKY look like live listings, so the vendor/feed cause (IEX coverage, renamed tickers) must be established in recon. May also feed analysis live_loop 'had no 1d bars' WARNs.
- Recommended design depth: quick -> `/sdd-design fix-marketdata-dead-symbol-ingest quick` (rationale: SEV-3 single service, but root cause is under investigation (rubric: quick))
- Development branch: feature/fix-marketdata-dead-symbol-ingest
- Number 291 reserved via scripts/sdd-allocate-feature-number.sh (triage authorized by the operator, 2026-11-04)

# Context Log: fix-retired-surface-proto-cleanup

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-10 (/sdd-triage)

- Bugs reported via defect reports (Issues disabled):
  - docs/reports/2026-10-19-trading-mode-axis-retained-defect.md — Retired trading_mode axis still plumbed through watchers, marketdata and service docs (SEV-3)
  - docs/reports/2026-10-19-opportunity-sparkline-removal-residue-defect.md — Server-side opportunity sparkline removed but acceptance, proto field and agent projection remain (SEV-3)
  - docs/reports/2026-10-19-proto-contract-hygiene-defect.md — Proto contract hygiene drift (SEV-3)
- Cluster rationale: all three are residue of retired or drifting contract surfaces; they share one proto edit + buf breaking pass and one config-seed cleanup migration.
- Severity: SEV-3
- Routed to SDD path (Track C)
- Created: feature.md, product-spec.md, acceptance.feature (regression scenarios @AC-1..3), context.md
- Affected services (from reports): packages/proto, analysis, indicators, ingest, trading, portfolio, marketdata, config, identity, ledger, notify, agent
- Root cause hypotheses: incomplete sweeps after features 147 and 227; no proto cleanup pass
- Recommended design depth: full → `/sdd-design fix-retired-surface-proto-cleanup` (rationale: proto change + config-seed migration + ≥2 affected services incl. xstockstrat-agent)
- Development branch: feature/fix-retired-surface-proto-cleanup

## Session 2026-11-10 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Warnings: bug-template conventions (no FR-N/@FR tags); retired-key contracts (namespace-relative stored keys, migration shape) deferred; Q6 needs operator C-16 sign-off before /sdd-spec; first review FAILed crit 5 (fixed: classification table, breaking items out of scope); overlap FAIL with 330 resolved (330 owns the 028 TTL row)
- Overlap findings: WARN: indicators.proto with 310, trading.proto with 312, config.proto with 328; config migration NNN with 321/330; trading.broker.paper coordination with 321
- Recommended design depth: full (proto (non-breaking) + config migration; many services)
- Tree: ccr-500a9eb9-nvk45x (origin/main-dev 0fecb24d + triage/docs commits; no feature branch yet)

# Context Log: fix-live-enrich-ttl-seed

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-10 (/sdd-triage)

- Bug reported via defect report (Issues disabled; clustered triage):
  - docs/reports/2026-10-19-live-enrich-ttl-seed-below-poll-defect.md — Seeded live-enrich memo TTL (10s) is below the UI poll (15s), so the memo never hits (SEV-3)
- Cluster rationale: single-report feature — one stale seeded config value.
- Severity: SEV-3
- Routing: report says "Config-only fix possible: yes" (Track B), **converted to Track C by operator decision 2026-11-10** — since feature 296 a key's value is seeded by a config migration, not a manual `SetConfig`, so the fix is a new numbered config migration (028 is applied and never edited).
- Created: status.md, feature.md, product-spec.md, acceptance.feature (AC-1..AC-2), context.md; stamped the report sidecar `triaged`
- Affected services (from report): xstockstrat-config, xstockstrat-analysis, xstockstrat-ui
- Root cause hypothesis: analysis code default raised to 20 after 028 seeded 10; no follow-up migration. Migration 041 synced `default_value` but leaves `value_data` unchanged — confirm stored value per environment in recon.
- Open questions: overwrite policy for rows not at the seeded value (product-spec § Open Questions)
- Recommended design depth: full → `/sdd-design fix-live-enrich-ttl-seed` (rationale: SEV-3, but a DB (config data) migration and ≥2 affected services — rubric escalate signals)
- Development branch: feature/fix-live-enrich-ttl-seed

## Session 2026-11-10 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Warnings: bug-template conventions (no FR-N/@FR tags); overwrite policy deferred (AC-1 holds either way); first review FAILed crit 6 (fixed: full key contract); overlap FAIL with 322 resolved (330 owns the row)
- Overlap findings: WARN: config migration NNN with 321/322
- Recommended design depth: full (config migration; analysis + ui)
- Tree: ccr-500a9eb9-nvk45x (origin/main-dev 0fecb24d + triage/docs commits; no feature branch yet)

# Context Log: fix-analysis-evidence-dry

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-10 (/sdd-triage)

- Bug reported via defect reports (Issues disabled; clustered triage):
  - docs/reports/2026-10-19-analysis-fingerprint-ignores-formula-version-defect.md — Evidence fingerprint ignores referenced formula content (SEV-3)
  - docs/reports/2026-10-19-analysis-live-gate-sql-duplicated-defect.md — Entry-backfill re-types the live-enabled gate SQL instead of importing it (SEV-3)
- Cluster rationale: both are analysis single-source-of-truth gaps on the strategy evidence/live path (ANALYSIS-3 fingerprint input, ANALYSIS-7 live gate).
- Severity: SEV-3 (highest across reports)
- Routed to SDD path (Track C)
- Created: status.md, feature.md, product-spec.md, acceptance.feature (AC-1..AC-2), context.md; stamped both report sidecars `triaged`
- Affected services (from reports): xstockstrat-analysis, xstockstrat-indicators
- Root cause hypothesis: formula content lives in indicators, outside the hashed `definition_json`; gate literal duplicated, likely to dodge an import cycle via `servicer.py`
- Open questions: invalidate vs re-fingerprint; one-time fingerprint shift on rollout (product-spec § Open Questions)
- Recommended design depth: full → `/sdd-design fix-analysis-evidence-dry` (rationale: SEV-3, but ≥2 affected services — analysis + indicators — rubric escalate signal)
- Development branch: feature/fix-analysis-evidence-dry

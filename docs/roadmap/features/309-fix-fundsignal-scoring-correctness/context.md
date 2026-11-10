# Context Log: fix-fundsignal-scoring-correctness

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-10 (/sdd-triage)

- Bug reported via defect reports (Issues disabled; clustered triage):
  - `docs/reports/2026-10-21-analysis-fundsignal-formula-partial-row-wire-zero-defect.md` — formula-path producer scores absent metrics as 0.0 (SEV-2)
  - `docs/reports/2026-10-21-analysis-fundsignal-small-cross-section-quantile-defect.md` — lone scored symbol always labelled "buy" (SEV-2)
  - `docs/reports/2026-10-21-analysis-zero-conviction-read-as-neutral-defect.md` — conviction 0.0 read back as neutral 0.5 by the scorer (SEV-2)
  - `docs/reports/2026-10-21-ingest-fundsignal-fabricated-signals-not-retracted-defect.md` — fabricated 0.5 fundamentals signals already stored are never retracted (SEV-2; dev + production)
- Cluster rationale: all four are residuals of feature 246's fundamentals-signal correctness work (proto3 zero-vs-absent and degenerate scoring), sharing the producer → ingest → scorer pipeline.
- Severity: SEV-2 (all four)
- Routed to SDD path (Track C); prod-impacting SEV-2 (report 4) routed to C by operator decision 2026-11-10
- Created: status.md, feature.md, product-spec.md, acceptance.feature (4 regression scenarios), context.md; report sidecars stamped `triaged`
- Affected services (from reports): xstockstrat-analysis, xstockstrat-ingest, xstockstrat-indicators
- Root cause hypothesis: proto3 doubles lack presence (0.0 = absent); direction quantile has no floor; 246 had no retraction path
- Recommended design depth: full → `/sdd-design fix-fundsignal-scoring-correctness` (rationale: ≥2 services, a data migration/one-off SQL, possible proto presence change, durable @AC-8 @feature-201 change needing C-16 sign-off)
- Development branch: feature/fix-fundsignal-scoring-correctness

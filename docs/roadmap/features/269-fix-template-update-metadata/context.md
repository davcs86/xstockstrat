# Context Log: fix-template-update-metadata

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-10-21 (/sdd-triage)

- Bug recorded as defect report `docs/reports/2026-10-21-template-update-metadata-defect.md` (Issues disabled).
- Source: repo-surveyor debt-radar scan `docs/repo-surveyor/debt-radar-findings.md` @ 4535695, finding D-41
  (including its RETIRE and empty-id CREATE divergences).
- Severity: SEV-2. Impact type: template-update-silently-ignored. Environment: dev (main-dev) @ a053b0e. Config-only: no.
- Routed to SDD path (Track C).
- Created: status.md, feature.md, product-spec.md, acceptance.feature (AC-1..3), context.md.
- Affected services: xstockstrat-indicators, xstockstrat-analysis, xstockstrat-ingest (fix sites); xstockstrat-ui
  read-only evidence.
- Root cause hypothesis: three per-service template repositories with no shared contract (debt-radar D-20 family).
- Re-verification on main-dev @ a053b0e: D-41 and both divergences reproduce in code. Line drift: indicators
  `ManageTemplate` update call `servicer.py:644-645` → `:652`; empty-id reject `:627` → `:633-635`; repository
  `formula_templates_repository.py:50-63` → `:50-62` (retire COALESCE `:68`); analysis `strategy_templates.py:54-66`
  unchanged (retire COALESCE `:72`; handler update `servicer.py:3581`, empty-id reject `:3544-3552`); ingest
  `source_templates.py:50-75` unchanged (update `:56`, retire overwrite `:71`), uuid mint `servicer.py:1540` unchanged.
  Extra divergence found during re-verification: indicators' retire does not set `updated_at`; analysis and ingest do.
- UI evidence: `/config-ui/templates` (`page.tsx:153-158`, `:382`) sends `name`/`description` on UPDATE.
- **Overlaps:** none in-flight among 240–253. Launched 224-private-by-default-templates and
  225-private-by-default-enforce-contract last touched these repositories/handlers (context only; no conflict).
  Sibling batch features 254–266/272–273 (created concurrently) claim no template finding; 266-fix-db-tls-fail-closed
  carries D-20 (shared-infra copies), the family this defect belongs to — coordinate only if design extracts a shared
  template repository.
- Recommended design depth: full → `/sdd-design fix-template-update-metadata` (rationale: affected services ≥ 2 —
  three fix sites). First design decision (per the surveyor's routing note): is template metadata mutable? Then: does
  a metadata-only UPDATE bump `version`; which RETIRE and empty-id CREATE semantics win.
- Operator decisions (2026-10-21): grouped by service+theme from the debt-radar scan; Track C for all SEV-2 (precedent #1264); batch launched via /sdd-batch with designGate halt.
- Development branch: feature/fix-template-update-metadata

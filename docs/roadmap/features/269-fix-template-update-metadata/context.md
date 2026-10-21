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

## Session 2026-10-21 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready. Criteria verdict: PASS WITH WARNINGS (no fails, no floor breaches).
- Warnings:
  - Criterion 8 / C-15: @AC-2 asserts an observable `updated_at`. **Resolved**: `TemplateMeta.updated_at` exists
    (`packages/proto/common/v1/common.proto` field 8), and FR-4 now cites it. Still open for `/sdd-design` and
    `/sdd-spec`: @AC-1/@AC-2 need controlled time (clock injection or a stubbed `NOW()`) so the
    2026-10-21T10:00:00Z/11:00:00Z assertions are deterministic.
  - FR-3/FR-4: does a second RETIRE reach the SQL? **Resolved**: none of the three retire `UPDATE`s filters on
    `retired_at` (`formula_templates_repository.py` retire, `strategy_templates.py:68-75`, `source_templates.py:67-75`).
    The handlers (indicators `servicer.py:653-660`, analysis `servicer.py:3554`, ingest `servicer.py:1522-1523`)
    return NOT_FOUND only when no row exists. FR-3 now says the second RETIRE succeeds and that no service may add a
    `retired_at IS NULL` filter.
  - Criterion 11 / C-14: the UI line cites `page.tsx:153-158`, `:382` and `:479` were not re-checked by the reviewer
    (description in the payload was confirmed at `page.tsx:157`, `:173`). Re-verify them in recon.
  - Criterion 8 (minor): "smoke-tested on dev" in Acceptance Criteria is boilerplate and not testable. Left as is.
- Overlap findings (WARN, file-level only; no config, proto or migration collisions):
  - `services/xstockstrat-indicators/app/handlers/servicer.py`: also modified by 244-fix-python-config-stored-zero
    (implementation-ready).
  - `services/xstockstrat-analysis/app/handlers/servicer.py`: also modified by 244-fix-python-config-stored-zero and
    245-fix-screener-symbol-isolation (both implementation-ready). This carries merge-conflict risk. The router
    decides the coordination line in `merge-order.md`; there is no entry for 244, 245, 268 or 269 today.
  - `services/xstockstrat-ingest/app/handlers/servicer.py`: 246-fix-fundsignal-neutral-score cites it as a reference
    only. This is a possible overlap, not a confirmed edit.
  - Thematic only: 268-fix-indicators-formula-correctness (indicators template surface), 259-fix-python-loop-supervision
    (`run_template_intent_sweep_forever` lives in analysis), and 241-fix-config-audit-author-spoof (agent and UI files
    this feature does not touch).
- OPERATOR DECISIONS (binding, recorded 2026-10-21):
  - Grouped by service+theme from the 2026-10-20 debt-radar scan; Track C.
  - Scope is D-41 including its RETIRE/CREATE divergences.
- Next: `/sdd-design fix-template-update-metadata` (full depth).

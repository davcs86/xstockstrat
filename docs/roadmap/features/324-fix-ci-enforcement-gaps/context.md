# Context Log: fix-ci-enforcement-gaps

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-10 (/sdd-triage)

- Bugs reported via defect reports (Issues disabled):
  - docs/reports/2026-10-28-node-leaf-c8-check-coverage-unenforced-defect.md — Node-leaf c8 `--lines 40` is declared but never enforced (SEV-3)
  - docs/reports/2026-10-29-scripts-ruff-lint-gap-defect.md — scripts/ Python fails ruff lint and format, and no CI job checks it (SEV-2)
- Cluster rationale: both are CI gates declared but not enforced; one ci.yml change set closes both.
- Severity: SEV-2 (highest; R2)
- Routed to SDD path (Track C); SEV-2 routed to C by operator decision 2026-11-10
- Created: feature.md, product-spec.md, acceptance.feature (regression scenarios @AC-1..2), context.md
- Affected services (from reports): config, ledger, identity, notify, scripts/, .github/workflows/ci.yml
- Root cause hypothesis: copied scripts without `--check-coverage`; ruff CI scoped to services only (a narrow two-SOPS-script ruff step now exists)
- Recommended design depth: full → `/sdd-design fix-ci-enforcement-gaps` (rationale: SEV-2 + ≥2 affected services — four Node leaves plus scripts/)
- Development branch: feature/fix-ci-enforcement-gaps

## Session 2026-11-10 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Warnings: bug-template conventions (no FR-N/@FR tags; no Consumer Surface section); OQ1 depends on measured current coverage; OQ2 scripts/tests in CI is a scope fork
- Overlap findings: WARN: ci.yml with 297/298/318; ledger/notify package.json with 323
- Recommended design depth: full (four Node leaves + scripts/ + ci.yml)
- Tree: ccr-500a9eb9-nvk45x (origin/main-dev 0fecb24d + triage/docs commits; no feature branch yet)

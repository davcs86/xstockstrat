# Context Log: fix-sandbox-result-contract

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-10 (/sdd-triage)

- Bug reported via defect reports (Issues disabled; clustered triage):
  - `docs/reports/2026-10-19-sandbox-exit-reason-stderr-substring-defect.md` — sandbox exit reason classified by stderr substring match (SEV-3)
  - `docs/reports/2026-10-19-sandbox-memory-used-bytes-always-zero-defect.md` — SandboxResult.memory_used_bytes always zero (SEV-3)
  - `docs/reports/2026-10-22-indicators-missing-result-silent-success-defect.md` — formula that never assigns result returns success with empty output (SEV-2)
- Cluster rationale: all three are the sandbox child-wrapper → parent result contract in `app/services/sandbox.py`; a structural child report fixes classification, measurement and missing-result together.
- Severity: SEV-2 (highest of the cluster)
- Routed to SDD path (Track C)
- Created: status.md, feature.md, product-spec.md, acceptance.feature (3 regression scenarios), context.md; report sidecars stamped `triaged`
- Affected services (from reports): xstockstrat-indicators (consumer surfaces: xstockstrat-ui formula test, xstockstrat-agent test_formula)
- Root cause hypothesis: forgeable stderr substrings; memory accounting never implemented; `.get('result', {})` default
- Recommended design depth: full → `/sdd-design fix-sandbox-result-contract` (rationale: SEV-2 plus a live proto-deprecation option for memory_used_bytes and a formula-contract decision (Open Question 1); consumer surfaces read the result)
- Development branch: feature/fix-sandbox-result-contract

## Session 2026-11-10 (/sdd-review product-spec — operator decisions)

- First review FAILed criterion 8: AC-2/AC-3 had either/or Thens hinging on OQ1/OQ2.
- Operator decided: missing `result` → `success=false` with an error naming `result`; explicit
  `result = {}` still succeeds; `memory_used_bytes` is measured (no proto change).
- AC-2/AC-3 rewritten to single outcomes; AC-4 added for the explicit-empty-result case.

## Session 2026-11-10 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Warnings: bug-template conventions (no FR-N/@FR tags); re-reviewed after operator decisions (missing result fails; memory measured); OQ3 structural exit-reason signal deferred to design; first review FAILed crit 8
- Overlap findings: WARN: indicators.proto file shared with 322 (different messages); indicators shared with 309/327
- Recommended design depth: full (indicators + ui/agent consumers; contract change)
- Tree: ccr-500a9eb9-nvk45x (origin/main-dev 0fecb24d + triage/docs commits; no feature branch yet)

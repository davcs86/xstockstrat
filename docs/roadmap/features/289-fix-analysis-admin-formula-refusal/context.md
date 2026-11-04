# Context Log: fix-analysis-admin-formula-refusal

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-04 (/sdd-triage)

- Bug reported via defect report `docs/reports/2026-11-04-analysis-admin-formula-refusal-misclassified-defect.md` (Issues disabled): analysis treats indicators' admin-formula refusal as an outage / unhandled error
- Severity: SEV-2
- Routed to SDD path (Track C); environment recorded as dev (main-dev), Grafana label `staging`
- Created: feature.md, product-spec.md, acceptance.feature (regression scenario), status.md, context.md
- Affected services (from report): xstockstrat-analysis (consumer surfaces: xstockstrat-ui opportunities/readiness pages, xstockstrat-agent list_opportunities)
- Root cause hypothesis: Feature 275 added `raise_unreadable` handling only on the backtest evaluator; the opportunities and readiness paths use the default evaluator plus a broad `except grpc.RpcError` (`servicer.py:~5787`, `evaluator.py:226-273`). Lead: staging `fundsignal.scoring_formula_id` (d1ff5e6b-...) is the formula in the `EvaluateReadiness` FormulaExecutionError timeouts; check its owner vs the caller identity.
- Recommended design depth: full -> `/sdd-design fix-analysis-admin-formula-refusal` (rationale: SEV-2 plus named consumer surfaces (ui, agent) count as >=2 services (rubric escalate signal))
- Development branch: feature/fix-analysis-admin-formula-refusal
- Number 289 reserved via scripts/sdd-allocate-feature-number.sh (triage authorized by the operator, 2026-11-04)

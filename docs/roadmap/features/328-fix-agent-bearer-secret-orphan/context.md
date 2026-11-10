# Context Log: fix-agent-bearer-secret-orphan

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-10 (/sdd-triage)

- Bug reported via defect report (Issues disabled; clustered triage):
  - docs/reports/2026-10-19-agent-bearer-secret-orphan-on-failed-register-defect.md — Signal-source bearer secret is orphaned when the source register fails (SEV-3)
- Cluster rationale: single-report feature — the secret-first orphan spans the agent tool paths and the config-ui hook, one fix decision.
- Severity: SEV-3
- Routed to SDD path (Track C)
- Created: status.md, feature.md, product-spec.md, acceptance.feature (AC-1..AC-3), context.md; stamped the report sidecar `triaged`
- Affected services (from report): xstockstrat-agent, xstockstrat-config, xstockstrat-ingest, xstockstrat-ui
- Root cause hypothesis: deliberate secret-first ordering (feature 224) with no compensating delete; `config.proto` has no delete RPC
- Open questions: maintainer ruling — compensating delete (new config RPC) vs accept + sweep; sweep home (product-spec § Open Questions)
- Recommended design depth: full → `/sdd-design fix-agent-bearer-secret-orphan` (rationale: SEV-3, but 4 affected services, a possible proto change (new config RPC), and a secret-handling security posture)
- Development branch: feature/fix-agent-bearer-secret-orphan

## Session 2026-11-10 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Warnings: bug-template conventions (no FR-N/@FR tags; no Consumer Surface section); conditional config RPC must be flagged additive + authz rule; sweep migration strategy deferred; OQ1 maintainer ruling gates acceptance — resolve first in /sdd-design
- Overlap findings: WARN: agent tools.py with 314; config.proto with 322
- Recommended design depth: full (4 services; conditional new config RPC (additive proto))
- Tree: ccr-500a9eb9-nvk45x (origin/main-dev 0fecb24d + triage/docs commits; no feature branch yet)

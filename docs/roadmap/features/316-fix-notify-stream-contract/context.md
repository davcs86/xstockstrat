# Context Log: fix-notify-stream-contract

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-10 (/sdd-triage)

- Bug reported via defect reports (clustered triage):
  - docs/reports/2026-10-19-notify-severities-type-runtime-mismatch-defect.md (SEV-3)
  - docs/reports/2026-10-19-notify-stream-ignores-backpressure-defect.md (SEV-3)
- Cluster rationale: both are defects in the same StreamAlerts fan-out path (`emitAlert` / `matchesSubscriber` in
  notifyServiceImpl.ts) and share one test surface.
- Severity: SEV-3 (highest of cluster)
- Routed to SDD path (Track C)
- Created: status.md, feature.md, product-spec.md, acceptance.feature (2 regression scenarios), context.md
- Affected services (from reports): xstockstrat-notify
- Root cause hypothesis: hand-typed numeric severities predating stringEnums; fan-out discards write()'s false return.
- Recommended design depth: quick → `/sdd-design fix-notify-stream-contract quick` (rationale: SEV-3, single service, no proto/migration,
  but a config change is possible — threshold key / max_subscribers enforcement — so not skip)
- Development branch: feature/fix-notify-stream-contract

## Session 2026-11-10 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Warnings: bug-template conventions (no FR-N/@FR tags; no Consumer Surface section); backpressure threshold key contract deferred; AC-2 threshold not concrete and Then allows two policies
- Overlap findings: WARN: xstockstrat-notify shared with 312, 323, 324
- Recommended design depth: full (overlap with 312/323/324 on notify)
- Tree: ccr-500a9eb9-nvk45x (origin/main-dev 0fecb24d + triage/docs commits; no feature branch yet)

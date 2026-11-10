# Context Log: fix-grpc-status-mapping

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-10 (/sdd-triage)

- Bug reported via defect reports (Issues disabled; clustered triage):
  - docs/reports/2026-10-19-marketdata-togrpcerror-collapses-codes-defect.md — marketdata toGRPCError maps only six codes; everything else becomes INTERNAL (SEV-3)
  - docs/reports/2026-10-19-portfolio-watchlist-duplicate-returns-internal-defect.md — CreateWatchlist returns INTERNAL on a duplicate watchlist name (SEV-3)
- Cluster rationale: both are Go-service error boundaries collapsing distinct error classes into gRPC INTERNAL; the shared fix is faithful status-code classification.
- Severity: SEV-3 (highest across reports)
- Routed to SDD path (Track C)
- Created: status.md, feature.md, product-spec.md, acceptance.feature (AC-1..AC-4), context.md; stamped both report sidecars `triaged`
- Affected services (from reports): xstockstrat-marketdata, xstockstrat-portfolio; consumers xstockstrat-ui, xstockstrat-agent
- Root cause hypothesis: blanket `Internal` default in marketdata `toGRPCError` plus raw-returning RPCs; no SQLSTATE 23505 classification in portfolio
- Recommended design depth: full → `/sdd-design fix-grpc-status-mapping` (rationale: SEV-3, but ≥2 affected services plus named consumer surfaces — rubric escalate signal)
- Development branch: feature/fix-grpc-status-mapping

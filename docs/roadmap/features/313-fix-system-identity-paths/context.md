# Context Log: fix-system-identity-paths

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-10 (/sdd-triage)

- Bug reported via defect reports (Issues disabled; clustered triage):
  - `docs/reports/2026-10-19-ingest-mcp-loop-ledger-events-ownerless-defect.md` — mcp_client loop ledger events stored with a NULL owner (SEV-3)
  - `docs/reports/2026-10-19-analysis-pnl-compose-system-owner-raises-defect.md` — P&L snapshot compose can raise ValueError for a system-owned order event (SEV-3)
- Cluster rationale: both are owner-identity gaps on paths with no real inbound caller (server-initiated loop, system owner), where the header-based identity contract (PLAT-11 / feature 225) has no value to propagate.
- Severity: SEV-3 (both)
- Routed to SDD path (Track C)
- Created: status.md, feature.md, product-spec.md, acceptance.feature (2 regression scenarios), context.md; report sidecars stamped `triaged`
- Affected services (from reports): xstockstrat-ingest, xstockstrat-analysis, xstockstrat-ledger
- Root cause hypothesis: ledger owner arrives only via propagated header; feature-225 owner_metadata raise sits ahead of FR-6 degrade blocks. Drift noted: pnl consumer now retries + parks ValueError (poison) instead of cursor-skipping.
- Recommended design depth: full → `/sdd-design fix-system-identity-paths` (rationale: ≥2 affected services; otherwise SEV-3 with clear root causes)
- Development branch: feature/fix-system-identity-paths

## Session 2026-11-10 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Warnings: bug-template conventions (no FR-N/@FR tags; no Consumer Surface section); open questions not explicitly deferred; no consumer-surface statement for owner-visible ExportEvents change
- Overlap findings: WARN: ingest mcp_client area shared with 328; analysis shared with 308/309/327
- Recommended design depth: full (ingest + analysis + ledger)
- Tree: ccr-500a9eb9-nvk45x (origin/main-dev 0fecb24d + triage/docs commits; no feature branch yet)

# Context Log: fix-a-filtered-listopportunities

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-25 (/sdd-triage)

- Bug reported via defect report `docs/reports/2026-11-25-analysis-filtered-empty-opportunity-read-kicks-full-recompute-defect.md` (GitHub Issues disabled): a filtered ListOpportunities read with no matches kicks a full recompute
- Severity: SEV-3
- Routed to SDD path (Track C)
- Created: feature.md, product-spec.md, acceptance.feature (regression scenarios), context.md
- Affected services (from report): xstockstrat-analysis
- Root cause hypothesis: the no-rows branch tests the filtered fresh read and sets kick_full unconditionally (servicer.py:4765-4788)
- Recommended design depth: skip → `/sdd-spec fix-a-filtered-listopportunities` (rationale: SEV-3, single service, no proto/migration/config, clear root cause)
- Development branch: feature/fix-a-filtered-listopportunities
- Note: the behavior was used deliberately on 2026-11-25 as a no-DB lever to force a homelab queue recompute (`list_opportunities(min_conviction=1.01)`); the fix removes that lever, so a manual-recompute path should be considered at /sdd-spec (none exists today — no refresh/invalidate RPC).

# Context Log: fix-portfolio-signal-expiry-backfill

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-17 (/sdd-triage)

- Bug reported via defect report `docs/reports/2026-11-17-portfolio-signal-expiry-backfill-mark-ingest-race-defect.md` (PR #1570; Issues disabled).
- Severity: SEV-3, confirmed by the operator at the `/sdd-qa defect` P-04 gate (lowered from the initially proposed rating).
- Routed to SDD path (Track C).
- Created: feature.md, product-spec.md, acceptance.feature (regression scenario), context.md.
- Affected services (from report): xstockstrat-portfolio.
- Root cause hypothesis: the backfill APPLY mark (`backfillMarkSQL`) runs as a READ COMMITTED autocommit statement without the parent watchlist row lock. The add path's update-only `mergeSignalExpirySQL` is a no-op when it runs before the mark row commits, so a due `signal_id NULL` row survives next to a live signal. The same shape is suspected, not observed, for `backfillSeedSQL`.
- Recommended design depth: skip → `/sdd-spec fix-portfolio-signal-expiry-backfill` (rubric: SEV-3, single service, no proto/migration/config, clear root cause).
- **Operator directive (2026-11-17), overrides the rubric:** run this fix through the `/sdd-batch` workflow, which always runs the full design debate. The design gate is `halt` (operator approves design.md), then `/sdd-batch-execute` (sequential) after the operator's mode-entry confirmation.
- Development branch: feature/fix-portfolio-signal-expiry-backfill.

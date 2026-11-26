# Context Log: fix-gapsonly-backfill-is

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-25 (/sdd-triage)

- Bug reported via defect report `docs/reports/2026-11-25-gaps-only-backfill-blind-to-interior-holes-defect.md` (GitHub Issues disabled): GAPS_ONLY backfill is blind to interior holes and reports COMPLETED
- Severity: SEV-2
- Routed to SDD path (Track C) — operator chose SEV-2 / dev over a production hotfix (strategies fail closed on a missing SMA200; FULL backfill is a working manual remediation)
- Created: feature.md, product-spec.md, acceptance.feature (regression scenario), context.md
- Affected services (from report): xstockstrat-marketdata, xstockstrat-ingest
- Root cause hypothesis: GetCoverage returns only (earliest, latest, count); ComputeGaps derives head/tail gaps only (timeframe.go:82-99)
- Recommended design depth: full → `/sdd-design fix-gapsonly-backfill-is` (rationale: ≥2 affected services plus GAPS_ONLY consumer surfaces in ui/agent — escalate-to-full signal)
- Development branch: feature/fix-gapsonly-backfill-is
- Remediation already applied out-of-band on homelab staging (2026-11-25): FULL + overwrite backfill of all 381 watchlist symbols, 2025-11-20..2026-11-25; sma200-UNSPECIFIED queue rows fell 27 → 8 (the remaining 8 have no vendor data).

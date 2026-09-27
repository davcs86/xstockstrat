# Context Log: fix-historical-fundamentals-price-join

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-09-27 (/sdd-triage)

- Bug reported via defect report `docs/reports/2026-09-27-fundamentals-backfill-not-rederived-defect.md`
  (GitHub Issues are disabled on this repo — recorded as a file by `/sdd-qa defect`, so there is no
  issue number/URL; report path used where the issue link would go, and the Track A/B close steps are
  skipped).
- Title: historical fundamentals price-join is never re-derived, so bars that arrive after a
  fundamentals backfill leave price-derived metrics permanently missing.
- Severity: SEV-3 (single SEV token in report; sanity check passed).
- Config-only: no (impact type `missing-fundamentals-metrics`, not `config-propagation`) → not Track B.
- Routed to SDD path (Track C): SEV-3 → Track C per T-4.
- Created: status.md (`draft`), feature.md, product-spec.md, acceptance.feature (two regression
  scenarios), context.md.
- Affected services (from report): xstockstrat-marketdata (root — insert-only historical-fundamentals
  write `ON CONFLICT DO NOTHING` + one-shot inline price-join in `backfillOneSymbol`); xstockstrat-ingest
  (backfill orchestration ordering).
- Root cause hypothesis (high confidence, from report): `InsertHistoricalFundamentals`' `DO NOTHING`
  conflict clause is insert-only and `trigger_backfill`'s `overwrite` flag is not plumbed to the
  fundamentals path, so a period computed once with no price bars can never be re-derived; the
  price-join being a one-shot at insert time makes ingestion order load-bearing.
- **Recommended design depth: full** → `/sdd-design fix-historical-fundamentals-price-join`.
  Rationale: affected services ≥ 2 (marketdata + ingest) per C-0, and there is a genuine cross-service
  design fork — write-time idempotent upsert vs. plumbing `overwrite` through to the fundamentals path
  vs. reordering backfill orchestration (bars-before-fundamentals) vs. read-time re-derivation. Worth a
  full adversarial debate rather than a single round.
- Numbering: allocated NNN=216 using the authoritative `max(existing NNN) + 1` rule (true max was 215).
  Did NOT use the Track C `count+1` shell snippet — the feature-dir set contains duplicate NNN prefixes
  (058, 064, 065, 097, 111, 140, 149, 153 ×2; 169 ×3), so `count` (221) is unreliable and would have
  mis-allocated 222.
- Development branch: feature/fix-historical-fundamentals-price-join.

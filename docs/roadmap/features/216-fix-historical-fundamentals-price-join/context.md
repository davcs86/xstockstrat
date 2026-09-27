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

## Session 2026-09-27 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Criteria pass (spec-reviewer): initially FAILED on criterion 9 — the three `## Fix Scope`
  checkboxes were left in raw template state. Fixed by resolving all three to `[x]` ("none":
  SQL/orchestration change, price columns already in the fundamentals_history INSERT
  `marketdata_repo.go:604-608`, `overwrite` is a TriggerBackfill request param not a config key, no
  `.proto` edits), mirroring peer feature 213. Re-verified → PASS.
- All four cited evidence lines confirmed exact by the reviewer (`marketdata_repo.go:610`/`:593`,
  `marketdata_service.go:1794`/`:1762`); affected-service claims grounded against the registry.
- Warnings (folded into product-spec `### Design constraints`, binding on /sdd-design):
  1. **C-16** — the `ON CONFLICT ... DO NOTHING` at `marketdata_repo.go:610` is deliberate (`:593-595`):
     it preserves feature-198 `@AC-1`/`@AC-2` (as-reported filing, earliest `filed_date`;
     `docs/roadmap/features/198-historical-fundamentals-backtest/acceptance.feature:11,18`). The fix
     must re-derive ONLY price-join metrics and must NOT clobber as-reported fields or earliest
     `filed_date` — a blanket whole-row `DO UPDATE` would regress feature 198. Column-scoped upsert OR
     read-time projection both satisfy this.
  2. **Two price-join lanes** — historical (`backfillOneSymbol`, the buggy one) vs live EDGAR-snapshot
     (re-derives every call, unaffected). Fix must keep derivation-convention parity across both.
  3. Acceptance scenarios omit `@FR-<n>` tags — informational only (no FR-N in a bug spec; matches
     peers 194/213/153/156). No action.
- Overlap findings (feature-overlap): NO FAIL-level collisions. No config keys / proto fields /
  migrations introduced. Only soft, disjoint-region same-file edits with `196-proto-deprecated-field-
  removal-program` in `marketdata_repo.go` (`:596-610` vs `:144`) and `ingest servicer.py`
  (`_run_backfill`/`_execute_fundamentals_backfill` vs `job_row_to_proto`) — rebase-only, no
  merge-order entry required. Low-risk theme-only share with 215 (ETF/fundamentals, enforcement in
  analysis, not this path).
- Next: `/sdd-design fix-historical-fundamentals-price-join` (full/deep) — recon + multi-round
  adversarial debate, honoring the two Design constraints above.

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

## Session 2026-09-27 — sdd-design

- Phase 0 Recon: wrote recon.md. Affected services: marketdata (root cause), ingest (orchestration —
  found NOT needed), agent (consumer surface — no change). Key reuse patterns: InsertBars column-scoped
  upsert shape, CloseAt price-at-filing, UpsertDividends/SumDividendsInWindow, fakeHistRepo211 harness.
  Recon corrected the report: `overwrite` reaches NOTHING in marketdata today (BackfillFundamentals
  never reads it; bars are unconditionally upserted) — the report's "overwrite governs the bars fetch"
  is imprecise. No migration (price columns exist, mig 005; next NNN 007), no proto, no config, no agent
  change. Bars table is `marketdata.ohlcv` (not `marketdata.bars`).
- Phase 1 Grilling: **5 rounds (full/deep — user asked for max depth; 11 proposer/adversary passes)**.
  - Chosen approach: marketdata-only write-path recovery. New rows → InsertHistoricalFundamentals
    DO NOTHING (unchanged; derivePriceMetrics runs first so new+bars derives). Existing rows →
    GetHistoricalPriceState (carries stored currency) → unified per-column merge over the 5 price
    columns (default `existing ?? derived`; overwrite `derived ?? existing`; monotonic, never
    value→nil) → dumb Go-merged UpdateHistoricalPriceJoin (SET 5 cols, WHERE triple PK). Recovery keys
    on the STORED earliest filed_date (look-ahead impossible). priceJoin split into accumulateTTM
    (always) + derivePriceMetrics (when deriving). Dividend fail-closed via window-coverage guard
    (windowStart.Before(divFetchStart)). Currency-mismatch fail-closed (native pe/pb only when
    state.Currency == p.Currency). Write-only-if-changed (idempotent).
  - Rejected: single ON CONFLICT DO UPDATE COALESCE upsert (SQL merge untestable — fails.md:722/757/
    727-729; can't set-null per column); read-time projection (breaks stored-PIT @AC-4); incoming-
    filed_date-equality guard (drift-fragile; period_end mitigation unsound — reintroduces look-ahead);
    widen dividend fetch to 10y (5× cost); dividendAuthoritative value→nil to clear fabricated 0 (wipes
    legit yields — abandoned); recovering debt_to_equity (as-reported, out of scope); ingest bars-before-
    fundamentals ordering (caller-sequencing, can't recover existing rows — out of scope).
  - Debate value: caught (a) a latent **fabricated-0 dividend_yield** bug the naive fix would amplify
    (fetch window 2y vs periods 10y) → fixed by the coverage guard on both paths; (b) the untestable-SQL
    merge → moved merge into Go; (c) the filed_date-drift fragility → keyed recovery on stored filed_date;
    (d) write-amplification/PIT drift → genuine fill-if-null; (e) the overwrite dividend-wipe → unified
    merge; (f) the pre-211 currency fabrication → currency-mismatch fail-closed; (g) a C-15 coverage gap
    on the signed-off overwrite val→val' capability → added @AC-4.
- **C-16 sign-off (recorded here, per C-16 + P-04):** the user explicitly signed off at the design gate
  (2026-09-27) on the CHANGE that **`overwrite=true` may overwrite the 5 DERIVED price columns**
  (`price`, `market_cap`, `pe_ratio`, `pb_ratio`, `dividend_yield`) of an existing `fundamentals_history`
  row — a deliberate operator override of the strict reading of feature-198 `@AC-2` ("no earlier period
  row overwritten by a later fetch"), scoped to those 5 derived columns only. As-reported fields
  (currency, eps, roe, debt_to_equity, beta, year_high/low, extra_metrics) and the earliest `filed_date`
  are NEVER overwritten (structural: fixed 5-column SET + triple-PK WHERE). Default (`overwrite=false`)
  stays fill-if-null and preserves feature-198 fully. The user was offered "leave overwrite unwired
  (recommended)" and chose "wire overwrite → force-recompute".
- Constitution rules touched: C-01, C-08, C-14, C-15, C-16, C-18, P-04, P-06, F-01/F-04/F-06/F-07
  (all honored — see design.md). Floor breaches: none.
- Acceptance: added @AC-3 (default fill-if-null), @AC-4 (overwrite val→val' refresh), @AC-5 (overwrite
  never nulls a pre-existing dividend_yield). @AC-1/@AC-2 unchanged.
- Open threads (from design.md Open Risks, target /sdd-spec):
  - [ ] Adjusted-close drift under overwrite (adjustment=all) legitimately rewrites historical price
    columns after a corporate action — document as operator-visible; idempotency holds only when
    adjusted OHLCV + EDGAR facts are byte-stable.
  - [ ] EDGAR fiscal_period relabel between insert and re-run → Found=false → recovery no-ops for that
    period (label-agnostic matching out of scope).
  - [ ] Pre-211 non-USD rows (currency wrongly "USD") won't recover native pe/pb until their as-reported
    currency is corrected (now fail-closed, not fabricated) — covered by test (f).
- C-16 promotion debt: feature-198's guarantees are launched but un-promoted to a durable suite; recorded,
  non-blocking (scenario-promoter at a later pass).
- Status: spec-ready → design-approved.
- Next: `/sdd-spec fix-historical-fundamentals-price-join`.

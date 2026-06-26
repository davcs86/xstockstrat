# Context: fundamentals-data-source

**Feature**: `docs/roadmap/features/059-fundamentals-data-source/feature.md`
**Product Spec**: `docs/roadmap/features/059-fundamentals-data-source/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/059-fundamentals-data-source/implementation-spec.md`

---

## Session 2026-06-26 — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md. Feature 2 of 6.
- **Single FMP chokepoint**: 060 (screener) and 062 (producer) read fundamentals ONLY via this
  service's cached `GetFundamentals*` RPC, so the 250/day budget is enforced in exactly one place.
- Design evidence: `BackfillBarsRequest` has no `source` field (verified) → a dedicated fundamentals
  RPC is required, not source-routing. The FMP `DataSourceClient` interface is OHLCV-shaped → a
  separate `FundamentalsSource` interface is used instead. No existing caching layer in marketdata →
  cache built from scratch as a DB table (the repo's DB-as-cache idiom).
- User decisions (this session): metric set = Core + extended ratios; license = Personal/paper, start
  on free Basic; commercial use later ⇒ revisit FMP plan. FMP free Basic confirmed: 250 calls/day, EOD
  historical, profile + reference, batch `quote` supported.

## Session 2026-06-26 — sdd-review product-spec

- Product spec reviewed (spec-reviewer + feature-overlap subagents). Status: draft → spec-ready.
- Verdict: PASS / overlap CLEAN. All code-checkable claims verified: marketdata migrations run 000–001
  so `002_fundamentals` is next free; `BackfillBarsRequest` has no `source` field; config keys follow
  `<service>.<category>.<key>` with correct `secret.*` prefix on the API key; DB pool budget unchanged.
- Warning (non-blocking): OQ-059-a-impl — exact FMP endpoint paths (`/stable/quote`, `/stable/ratios-ttm`,
  `/stable/profile`) and canonical field mapping remain deferred to /sdd-spec. Reviewer judged this a
  correctly-scoped implementation detail (the product-level metric-set decision OQ-059-a is resolved),
  NOT a product-spec gap. Gate passes; resolve the endpoint paths during /sdd-spec.
- Overlap findings: none. `marketdata.fmp.*` / `secret.marketdata.fmp.api_key` keys, the `002_fundamentals`
  migration, and the new `Fundamentals` message/RPCs are uniquely owned by 059. Siblings 060/062/063 are
  documented downstream consumers of the cached RPC (the single FMP chokepoint), not co-definers.

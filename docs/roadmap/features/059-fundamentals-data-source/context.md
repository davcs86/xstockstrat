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

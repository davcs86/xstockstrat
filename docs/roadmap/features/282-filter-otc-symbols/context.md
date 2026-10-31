# Context: filter-otc-symbols

**Feature**: `docs/roadmap/features/282-filter-otc-symbols/feature.md`
**Product Spec**: `docs/roadmap/features/282-filter-otc-symbols/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/282-filter-otc-symbols/implementation-spec.md`

---

## Session 2026-10-31T06:56:55Z — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- Origin: staging Loki logs (`live_loop: N/50 evaluated (strategy,symbol) pairs had no 1d bars`, sample CRTD/DNB/FORL/BOSSY) found while reviewing PR #1384; the requester attributes the gaps to OTC listings. Premise unverified; first Open Question in product-spec.md.
- Grounding: `common.v1.Asset.exchange` exists and marketdata `ListAssets` fills it from Alpaca; `marketdata.alpaca.feed` defaults to `iex`; `GetBars` calls `markWarm` and live-fetches on a DB miss (`marketdata_service.go`).

## Session 2026-10-31T06:59:10Z — renumber

- Renumbered 280 → 282: 280 was claimed concurrently by `280-third-party-sso-oidc` and `280-smoke-check-runtime`, and 281 by `281-signal-watchlist-expiry-pruning` (docs/runbooks/feature-workflow.md § Feature Numbering). Branch name uses the slug and is unchanged.

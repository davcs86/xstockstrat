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

## Session 2026-11-01 — sdd-story refinement

- Premise check (FMP search + Webull instruments): CRTD, BOSSY, FORL are OTC/pink/expert-market; DNB is a delisted/reused NYSE ticker, not OTC (out of scope; candidate negative-cache follow-up). Alpaca `ListAssets` exchange not yet verified.
- Operator decisions: refuse only OTC symbols with warnings, accept the rest; leave existing OTC data, optional UI mark/new field; always filter (feed-agnostic); enforce in analysis live loop. Open for design: reconcile live-loop enforcement with FR-3; mark vs. new proto field.

## Session 2026-11-01 — design decisions (2)

- Enforcement stays in marketdata (FR-3); no live-loop change. No UI mark / new field; one-time staging cleanup via FMP + Webull MCP audit instead (operator action, results logged here). Block widened to delisted/non-tradable (AC-7 added). Open: Alpaca fields defining delisted/non-tradable.

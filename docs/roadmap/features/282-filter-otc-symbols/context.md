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

## Session 2026-11-01 — staging watchlist cleanup (operator action)

- Audited 307 unique staging watchlist symbols (FMP + Webull MCPs, read-only). Removed 13 from the system-managed "Signals" watchlist via `manage_watchlist_symbols remove`, on the operator's explicit approval: OTC/delisted CRTD, BOSSY, FORL, CERO, DNB; Webull non-tradable/liquidate-only but FMP-listed GCTK, ELAB, YYAI, LPSN, NATH, SLP, WEAV, RIV. FORL and CERO bindings (`dip_buyer_vol_stop`) went with them.
- Kept: 14 reused tickers with a live major-exchange row (ATCH, BETR, BNY, BTLN, COGT, FIGR, IBTA, SHPH, SNOW, STI, TRIN, VG, WLTH, WOOF); AXIA, EVTV, LRHC, PSKY (no Webull row, FMP major exchange).
- Caveat: the 8 non-tradable-only removals are unverified against Alpaca `status`/`tradable`; the signal pipeline may re-add any of the 13 until this feature ships.

## Session 2026-11-01 — sdd-review product-spec

- spec-reviewer: PASS WITH WARNINGS, no blockers, no Floor breach; feature-overlap: WARN only (marketdata.proto and xstockstrat-marketdata shared with 215/255; 275 error semantics).
- Spec fixes applied: stale "out-of-scope" wording, ingest removed from Affected Services (agent calls EnsureSignalWatchlist), kill-switch candidate dropped (conflicts with "always filter"), FR-5 clarified, Trading Domain note, AC-8 (all write paths) and AC-9 (GetBars fail-open) added.
- Open for operator: criterion 9 (Alpaca `status`/`tradable` fields) is unchecked and was deferred to /sdd-design recon only by instruction in the review prompt; status NOT advanced pending operator OK.
- Carry into design: enumerate /trader add controls; AC-7 is compound; non-tradable-only vs inactive-only; refusal reason as enum (C-04); add merge-order row if impl-spec edits marketdata_service.go after 215/255.

## Session 2026-11-01 — open question resolved

- Delisted/non-tradable signal: derived from existing code, not new proto fields — `ListAssets` already filters `status=active` and `tradable=true`; unservable = absent from that set or `exchange=="OTC"`. Side effect: unknown/mistyped tickers are also refused; empty/failed set load must fail open. Live-credential value check for the 5 known symbols deferred to /sdd-design recon.

## Session 2026-11-01 — design steer (operator)

- Operator clarified: "leave existing data" only removes the need for a migration/cleanup in code; it must not shape the feature. Round-1 proposal's "classify only newly-added symbols / protect stored unservable entries" (loadOwned capture, `stored` param) is therefore NOT a requirement. Open for the gate: a uniform filter on every submitted symbol means a name-only agent update (read-modify-write, replace-all) would refuse and drop any already-stored unservable symbol, reporting it — a narrowing of `@AC-5 @feature-148` that needs explicit sign-off if the design takes it.

## Session 2026-11-01 — sdd-design round 1 gate (operator answers)

- C-16 sign-off (explicit, operator): CHANGE `@AC-5 @feature-148` (name-only agent/replace-all update now refuses and drops already-stored unservable symbols, refusal reported) and CHANGE `@AC-1 @feature-127` platform rule (a watchlist-direction signal for an unservable symbol is not added). Both promoted at launch with a servable-symbol qualifier.
- Gate scope (operator): warm/live-fetch gate sits at the `GetBars` warm site only; quote, price and `BatchGetBars` paths keep warming so held positions stay priced.
- Round 1 adversary: no Floor breach; adopted: us_equity-only asset load, uppercase/trim in classify, classify inside `warmMu`, last-good-set retained on failed refresh (only never-loaded fails open), capped backoff, config governance (seed/waiver, config-team approval), `watchlist_refused` on ingest_signal, bindings not deprecated `Symbols`, pre-RPC size bound.
- Operator chose another round (round 2) before approval.

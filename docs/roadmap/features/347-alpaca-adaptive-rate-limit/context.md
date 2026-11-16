# Context: alpaca-adaptive-rate-limit

**Feature**: `docs/roadmap/features/347-alpaca-adaptive-rate-limit/feature.md`
**Product Spec**: `docs/roadmap/features/347-alpaca-adaptive-rate-limit/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/347-alpaca-adaptive-rate-limit/implementation-spec.md`

---

## Session 2026-11-16T00:55Z — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- Operator request: "Use adaptive rate limit for marketdata calls to Alpaca", spec =
  <https://docs.alpaca.markets/us/docs/broker-api-rate-limits>, "vendor-specific change".
- Operator decisions (asked and answered this session):
  1. The cited page is Broker API-scoped; apply its header/backoff contract to the Alpaca hosts we call,
     **and also cover `xstockstrat-trading`** (scope widened beyond marketdata by the operator).
  2. `marketdata.backfill.rate_limit_rps` stays as a ceiling over the adaptive rate.
  3. On 429: retry inside the client until the request context is done.
  4. Tunables: one kill-switch key per service only; thresholds and backoff are fixed in code.
- Assumptions recorded (not yet confirmed by the operator): REST only, no WebSocket; limiter state per
  host and per process, in memory; no proto, DB or consumer-surface change; kill switches default `true`.
- Data host verified (operator-supplied <https://docs.alpaca.markets/us/reference/stockbars>): all three
  `X-RateLimit-*` headers on 200/400/429, per-minute window, `Reset` in Unix epoch seconds.
- Operator decisions, second round: (5) both kill switches seed `true`; (6) order mutations retry on 429,
  bounded by the order-intent staleness threshold (`order_intent.go`: `max(broker.timeout_ms, IBKRRequestTimeout)` × `stale_multiplier`, 30s at defaults); (7) no quota reservation for
  interactive reads, they fail fast in an exhausted window.
- Unverified: that the Trading API hosts return `X-RateLimit-*` headers. Recon item.

## Session 2026-11-16T01:40Z — sdd-review product-spec

- Tree: ccr-47ce6aaf-i0ffis ≡ origin/main-dev@9f88562 plus this feature's docs-only commits. Deviation
  from `docs/sdd/tree-freshness.md`: the harness pins this session to the `ccr-*` branch, so the tree was
  not switched to `main-dev`; `origin/main-dev` is an ancestor of HEAD.
- First pass FAILED (config-key contract incomplete, three unchecked open questions, no paper-vs-live
  statement). Spec fixed: FR-8 reworded to the real staleness threshold, FR-10 added, Config Key Changes
  rewritten with readers / migration 050 / live mechanism, AC-15..AC-18 added. Second pass PASSED.
- Product spec approved. Status: draft → spec-ready.
- Warnings:
  - AC-7's bound ("no more than 10 of 15 in the first second" at 5 rps) is loose; tighten at design.
  - `services/xstockstrat-marketdata/CLAUDE.md` calls `backfill.rate_limit_rps` startup-read, but
    `main.go` reads it per request; the doc is corrected in this feature.
  - Config migration 050 is also named by features 341 and 343; the later merger renumbers and
    regenerates `scripts/config-wiring-stored.json`.
  - FR-2/FR-3 constants are fixed in code; design records why they are not config keys (F-07 adjacency).
- Overlap findings (WARN only, no FAIL):
  - `services/xstockstrat-marketdata/internal/alpaca/client.go` is also edited by 322
    (`fix-retired-surface-proto-cleanup`, `Paper` plumbing) and 323 (`fix-orphaned-code`, `AlpacaAsset`
    removal). Separate hunks; merge-conflict risk only.
  - `trading.broker.*` namespace shared with 321 (`fix-trading-config-plumbing`); different keys.
- Trading API hosts: rate-limit headers are not documented (`reference/postorder`); FR-5 covers it.
- Recommended design depth: full (two services, order-mutation path, overlap findings).

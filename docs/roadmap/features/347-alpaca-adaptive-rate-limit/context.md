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
  bounded by `broker.timeout_ms` × `order_intent.stale_multiplier`; (7) no quota reservation for
  interactive reads, they fail fast in an exhausted window.
- Unverified: that the Trading API hosts return `X-RateLimit-*` headers. Recon item.

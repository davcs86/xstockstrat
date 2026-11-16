# Product Spec: alpaca-adaptive-rate-limit

**Created**: 2026-11-16

---

## Problem Statement

The platform paces its Alpaca REST calls with a static guess. `xstockstrat-marketdata` waits on a token
bucket sized by `marketdata.backfill.rate_limit_rps` (default 200 rps) and never reads the rate-limit
headers Alpaca returns; `xstockstrat-trading` has no pacing at all. In both services an HTTP 429 is
returned to the caller as a plain error with no wait and no retry, so a backfill, the bar ingester or an
order call fails as soon as the account's real quota is exceeded, and the next call is sent straight into
the same exhausted window.

Vendor spec (operator-supplied): <https://docs.alpaca.markets/us/docs/broker-api-rate-limits>. That page
documents the Broker API host, which neither service calls. The operator decided (2026-11-16) to apply its
header and backoff contract to the Alpaca hosts these two services do call. What it specifies:

- Every response carries `X-RateLimit-Limit` (requests allowed in the window), `X-RateLimit-Remaining`
  (requests left) and `X-RateLimit-Reset` (Unix seconds when the window resets).
- An exhausted window answers HTTP 429.
- Clients should slow down before `Remaining` reaches zero; on 429 they should not retry before `Reset`,
  then back off exponentially (1s, 2s, 4s, 8s, capped) with random jitter.
- No fixed limit numbers are published, and `Retry-After` is not mentioned.

## User Story

As a platform operator, I want the Alpaca clients to pace themselves from Alpaca's own rate-limit
headers and to wait out a 429 instead of failing, so that backfills, bar ingestion, quote reads and order
calls keep working at whatever quota the account's plan actually has, without me tuning a static rate.

## Functional Requirements

FR-1. **Header tracking.** Each Alpaca REST client records `X-RateLimit-Limit`, `X-RateLimit-Remaining`
and `X-RateLimit-Reset` from every response, success or failure. State is kept separately per Alpaca host
and per credential, because each has its own quota window.

FR-2. **Pre-emptive pacing.** When the recorded `Remaining` for a host is 0 and its `Reset` is in the
future, the next request to that host is not sent before `Reset`. While `Remaining` is low, requests are
spread over the time left in the window instead of being sent as a burst. The low-water threshold and the
spreading rule are fixed in code (design decides the values).

FR-3. **429 retry.** A 429 response is retried inside the client: wait until `X-RateLimit-Reset` (when
present and in the future), otherwise back off exponentially from 1s doubling to a fixed cap, with random
jitter in both cases. Retries stop when the request context is done; the caller then gets an error that
identifies the rate limit. A retried request is sent with the same method, URL and body.

FR-4. **Static ceiling kept (marketdata).** `marketdata.backfill.rate_limit_rps` stays as a ceiling: the
effective rate is the lower of the static limit and what the headers allow. A value of `0` still disables
only the static ceiling.

FR-5. **Degrade without headers.** A response with missing or unparseable rate-limit headers changes no
adaptive state and causes no error. With no usable header state the client behaves as it does today
(marketdata: static limiter only; trading: unpaced), except that FR-3 still applies to a 429.

FR-6. **Kill switch.** One live-read bool key per service turns the adaptive behavior (FR-1 to FR-3) off
without a deploy. With the switch off the client behaves exactly as before this feature.

FR-7. **Vendor scope.** Only the Alpaca REST clients change: `internal/alpaca` in marketdata and the
Alpaca adapter in `internal/broker` in trading. FMP, Finnhub, EDGAR, IBKR and the Alpaca WebSocket stream
are unchanged.

FR-8. **Order safety (trading).** A retried order mutation (submit, replace, cancel) must never create a
second order or a second cancel/replace effect, and the total time one broker call can take, retries
included, must stay inside the bound the order-intent staleness check already assumes
(`trading.broker.timeout_ms` × `trading.order_intent.stale_multiplier`).

FR-9. **Observability.** Time spent waiting for a rate-limit reset and each 429 retry are visible in the
existing vendor-request telemetry (marketdata `marketdata.vendor.requests` outcomes `http_429` /
`throttle`), and one WARN log per throttled window names the host and the wait. Trading gets the
equivalent signal (design decides the instrument).

## Out of Scope

- The Alpaca WebSocket stream (no request-rate headers apply to it).
- Other vendors' limiters (FMP, Finnhub, EDGAR) and the IBKR adapter.
- Coordinating limiter state across replicas or across the two services. Each process adapts on its own
  from the account-wide numbers Alpaca returns.
- Persisting limiter state across restarts.
- Removing or renaming `marketdata.backfill.rate_limit_rps`.
- Calling the Broker API (`broker-api.alpaca.markets`).

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-marketdata` — Alpaca REST client chokepoint `internal/alpaca/client.go#do` (MARKETDATA-4) gains header tracking, pacing and 429 retry.
- `xstockstrat-trading` — Alpaca broker adapter `internal/broker/alpaca.go#do` gains the same behavior, with the FR-8 order-safety bound.
- `xstockstrat-config` — config migration seeding the two kill-switch keys.

## Consumer Surface(s)

_Constitution **C-14**._

- [ ] **UI** — none
- [ ] **Agent** — none
- [x] **None** — internal/platform-only. The change is in how two backend services call an external
  vendor; no RPC, response field or tool contract changes. Operators reach the kill switch through the
  existing generic config surfaces (`/config-ui`, agent `set_config`), which need no change.

## Proto Contract Changes

- [x] No proto changes required

## Config Key Changes

Two new keys, both live-read bools with an explicit `true` code default (a missing key must not read as
disabled), seeded for staging and production by one new `xstockstrat-config` migration. Reader symbols are
fixed at `/sdd-spec`.

- `marketdata.alpaca.adaptive_rate_limit_enabled` — namespace `marketdata`, key
  `alpaca.adaptive_rate_limit_enabled`, `value_type` bool, code default `true`, read per request by the
  marketdata Alpaca client settings in `services/xstockstrat-marketdata/cmd/server/main.go:main`.
- `trading.broker.adaptive_rate_limit_enabled` — namespace `trading`, key
  `broker.adaptive_rate_limit_enabled`, `value_type` bool, code default `true`, read per request by the
  trading Alpaca adapter in `services/xstockstrat-trading/internal/broker/alpaca.go`.

Existing key with changed meaning: `marketdata.backfill.rate_limit_rps` becomes a ceiling over the
adaptive rate (FR-4); its type, default and bounds are unchanged, its description is updated.

## Database Changes

- [x] No schema changes (the config seed above is a config-data migration, not a schema change)

## Feature Workflow Notes

Branch to create: `feature/alpaca-adaptive-rate-limit` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking proto or config change)
- [ ] 2 service owners + platform lead (breaking proto change)
- [ ] DBA review + service owner (schema migration)

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

- [x] **Does the data host send these headers?** Yes. The Market Data API reference for
  `GET /v2/stocks/bars` (<https://docs.alpaca.markets/us/reference/stockbars>, host
  `data.alpaca.markets`) declares all three headers on the 200, 400 and 429 responses: `X-RateLimit-Limit`
  "Request limit per minute", `X-RateLimit-Remaining` "Request limit per minute remaining",
  `X-RateLimit-Reset` "The UNIX epoch when the remaining quota changes". The window is one minute. The
  spec lists none on 401, 403 or 500, which FR-5 already covers.
- [ ] **Does the Trading API host send them?** Still unverified for `paper-api.alpaca.markets` /
  `api.alpaca.markets` (marketdata `/v2/assets`, every trading call). Recon must confirm from the Trading
  API reference or real responses. If it does not, FR-5 makes the feature a 429-retry-only change there.
- [ ] **Kill-switch default.** Spec says `true` (on) for both services. Confirm, or seed trading `false`
  and enable it after marketdata has run in staging.
- [ ] **Order mutations and 429 retry (FR-8).** A 429 means Alpaca did not process the request, and
  submits carry a `client_order_id`, so a retry is expected to be safe. Design must prove it against the
  order-intent seam and choose the total retry budget for trading. `trading.go` already has callers that
  retry through that seam (`flattenAndHalt`).
- [ ] **Shared code.** The two services are separate Go modules (CI runs `GOWORK=off`). Design must choose
  between one shared limiter package and two copies, under the DRY guard rail.
- [ ] **Per-credential state in trading.** Broker clients are built per account; accounts sharing one
  Alpaca key share one quota. Design decides whether limiter state is keyed by client or by key.
- [ ] **Interactive deadlines (marketdata).** Quote and price RPCs run on about 2.5s budgets, so a wait
  for `Reset` will usually exceed them and the call fails as today. Confirm this is acceptable, or decide
  whether background loops should yield quota to interactive reads.

**Known traps (Ledger `fails.md`):**

- "A caller retrying through an idempotent/dedup seam must check the returned outcome" (fails.md ~L2627,
  `flattenAndHalt`) — applies to FR-8.
- "When copying a reconnect or retry loop from a reference, copy its failure boundaries too" (fails.md
  ~L3317) — applies to FR-3.
- "A request path shipped with no deadline at any hop" (fails.md ~L3180) — FR-3 must be bounded by the
  request context on every path.
- "Recon must inspect concrete broker implementations, not just the interface" (fails.md ~L1312).

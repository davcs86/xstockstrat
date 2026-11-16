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

FR-2. **Pre-emptive pacing.** When the recorded `Remaining` for a host and credential is 0 and its
`Reset` is in the future, the next request to that host is not sent before `Reset` (a recorded `Reset` is
capped at one 60-second window, so a single hold never exceeds one window). While `Remaining` is low,
requests are spread over the time left in the window instead of being sent as a burst. A spread slot
later than the caller's latest acceptable send time is not waited for: the request is sent at once while
the window still has local quota, and it uses one unit of that quota. The low-water threshold and the
spreading rule are fixed in code (§ Fixed Invariants); a `Remaining` of 4 with a `Limit` of 200 is low
(AC-3). When a hold cannot end before the caller's latest acceptable send time, trading refuses the
request at once and marketdata waits until the request context is done. A pre-emptive wait that ends
early returns the same "rate limited" error as FR-3, and the request is not sent.

FR-3. **429 retry.** A 429 response is retried inside the client. The client waits until
`X-RateLimit-Reset` when it parses and is in the future, capped at one 60-second window, whatever the
other two headers hold. Otherwise it backs off from 1 s, doubling, to an 8 s cap. Random jitter is added
in both cases and is only ever added, never subtracted, so a retry is never sent before the capped
`Reset` wait or before the backoff step. A retried request is sent with the same method, URL and body.
Only a 429 is retried; an attempt that times out or fails in any other way is returned at once. In
marketdata, retries stop when the request context is done; a context with no deadline also stops after a
fixed total of 90 seconds. In trading, a retry is started only when its wait plus one full
`trading.broker.timeout_ms` attempt ends no later than the call's end (FR-8); otherwise the call is
refused at once. When a wait is refused or ends early, or retries stop, the caller gets an error whose
message contains "rate limited" and the Alpaca host name; an attempt that times out returns its timeout
error. In trading the "rate limited" error is a definite outcome and is never a context error.

FR-4. **Static ceiling kept (marketdata).** `marketdata.backfill.rate_limit_rps` stays as a ceiling: the
effective rate is the lower of the static limit and what the headers allow. A value of `0` still disables
only the static ceiling.

FR-5. **Degrade without headers.** A response where any of the three rate-limit headers is missing or
unparseable is ignored for pacing: it changes no adaptive state and causes no error. With no usable header state the client behaves as it does today
(marketdata: static limiter only; trading: unpaced), except that FR-3 still applies to a 429.

FR-6. **Kill switch.** One live-read bool key per service turns the adaptive behavior (FR-1 to FR-3) off
without a deploy. With the switch off the client behaves exactly as before this feature.

FR-7. **Vendor scope.** Only the Alpaca REST clients change: `internal/alpaca` in marketdata and the
Alpaca adapter in `internal/broker` in trading. FMP, Finnhub, EDGAR, IBKR and the Alpaca WebSocket stream
are unchanged.

FR-8. **Order safety (trading).** A retried order mutation (submit, replace, cancel) must never create a
second order or a second cancel/replace effect. Each broker call, waits and retries included, ends
within B = max(T, S − 2T), where T is the live `trading.broker.timeout_ms` and S is the order-intent
staleness threshold computed by `services/xstockstrat-trading/internal/service/order_intent.go`
(`max(trading.broker.timeout_ms, IBKRRequestTimeout)` × `trading.order_intent.stale_multiplier`,
multiplier floor 1.5): 20 s at defaults. With a caller deadline, the call ends by whichever comes first.
Order mutations run detached from caller cancellation, bounded by the same end, so a sent attempt always
completes or times out. An attempt that times out stays an uncertain outcome. A rate-limit refusal means
the broker did not process the request:
- a submit is recorded REJECTED with `order.broker_rejected`, and its error contains "rate limited";
- a cancel or replace returns `Unavailable` and leaves the order unchanged; its intent is released so
  that an identical retry really retries, and when the intent cannot be released it reads UNKNOWN and
  the reply does not invite a retry;
- a rate-limited emergency-flatten submit halts the account at once, and the flatten retries continue.

A cancel's intent is finalized before its bracket-leg cancels are sent. Order types, fill detection and
the order status lifecycle are not changed.

FR-9. **Observability.** No new instrument, label key or outcome value is added. In marketdata every
attempt records one `marketdata.vendor.requests` point: a 429 is outcome `http_429`, and each retry is
its own point. A rate-limit wait that completes records nothing extra. A wait that ends early records one
point with no duration: outcome `ctx` when the request context ended it (deadline or cancellation), and
outcome `throttle` when the client refused or bounded the wait while the request context was still live
(the static ceiling, or the 90-second bound of a call with no deadline). One WARN log per throttled
window per host names the host and the wait. Trading emits the same WARN log (host and wait) and no
metric.

FR-10. **Paper and live behave the same.** The behavior is mode-agnostic: the same code path serves the
paper host (`paper-api.alpaca.markets`) and the live host (`api.alpaca.markets`), with limiter state kept
per host (FR-1). It adds no order-placing call of its own, so it is paper-safe to test; staging exercises
it against the paper host only.

FR-11. **Loop bounds.** Background loops never stall on a rate-limit wait. In marketdata, the Alpaca calls
of one warm-quote or bar-ingest cycle run under a deadline equal to that loop's live interval. Once the
deadline has passed, no further fetch starts in that cycle, and every symbol not fetched counts as a
fetch error: never as "no bars", and never toward a dead-symbol hold. Quote-cache and bar writes keep the
loop's own context. In trading, on every account served by the Alpaca client (every non-IBKR account),
each fill-poller `GetOrder`, the `CancelOrder` re-read after a "not cancelable" answer, and each
bracket-leg cancel is bounded by one `trading.broker.timeout_ms`, so it never waits or retries; a
throttled leg cancel is logged like any other leg failure. IBKR calls are unchanged (FR-7). These bounds
and the cancel ordering apply whether or not the kill switch is on.

## Fixed Invariants (not config keys)

These values are constants in code: window 60 s; reset slack 5 s; low-water when `Remaining × 10 < Limit`;
spreading `slot = max(now, nextSlot)`, `nextSlot = slot + (Reset − slot) / Remaining`, with local
`Remaining` decremented per reservation and `nextSlot` never moving backwards; a hold of
`min(Reset − now, 60 s)`; a 429 retry wait of `min(Reset − now, 60 s)` whenever `Reset` parses and is in
the future, with no range filter (the 65 s rule applies to pacing state only), otherwise backoff; a
recorded `Reset` usable for pacing only when all three headers parse and it lies no more than 65 s
ahead; within one `Reset`, `Remaining = min(observed, local)`; backoff 1 s doubling, capped at 8 s;
jitter add-only, uniform in [0, 500 ms), applied only to a non-zero adaptive wait; a zero adaptive wait
is never fit-tested and is sent at once (marketdata's static limiter still applies); marketdata's 90 s
total for a call with no deadline and 1 s minimum attempt allowance; trading's call budget
`max(T, S − 2T)` (FR-8); loop fetch bounds of one interval (marketdata) and one
`trading.broker.timeout_ms` (trading, every non-IBKR account).

Reasons: the operator chose a kill switch as the only new tunable (2026-11-16); the backoff shape is the
vendor's published guidance, not a deployment preference; the adaptive rate itself comes from Alpaca's
headers at run time, so there is no per-environment number to set; the trading budget is derived from
two existing live keys; and the two live controls an operator needs already exist as config (the kill
switch per service, and the static ceiling `marketdata.backfill.rate_limit_rps`). This follows the
existing "fixed invariants, operator-approved" precedent in `services/xstockstrat-marketdata/CLAUDE.md`
(asset-set refresher, quote retention). The values are listed in each service's `CLAUDE.md`.

## Out of Scope

- The Alpaca WebSocket stream (no request-rate headers apply to it).
- Other vendors' limiters (FMP, Finnhub, EDGAR) and the IBKR adapter.
- Coordinating limiter state across replicas or across the two services. Each process adapts on its own
  from the account-wide numbers Alpaca returns.
- Persisting limiter state across restarts.
- Removing or renaming `marketdata.backfill.rate_limit_rps`.
- Calling the Broker API (`broker-api.alpaca.markets`).
- Reserving quota for interactive reads. In an exhausted window a marketdata quote or price fetch now
  holds for its request budget (2.5 s) before returning, where a 429 used to fail at once.
- Changing the outcome of a rate-limited submit: it stays REJECTED with `order.broker_rejected`, and a
  caller reusing the same `client_order_id` replays it (documented in the trading `CLAUDE.md`).
- Spreading calls whose deadline is shorter than the spread interval (interactive reads; trading's fill
  poller, `reconcileTick`, `syncPositions`). They skip spreading under FR-2 and are held (marketdata) or
  refused (trading) only when `Remaining` is 0.
- The pre-existing `ReplaceOrder` defect (intent inserted before `validateTIF`), filed separately.

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-marketdata` — Alpaca REST client chokepoint `internal/alpaca/client.go#do` (MARKETDATA-4) gains header tracking, pacing and 429 retry; the warm-quote and bar-ingest loops bound their Alpaca calls by the loop interval (FR-11).
- `xstockstrat-trading` — Alpaca broker adapter `internal/broker/alpaca.go#do` gains the same behavior within the FR-8 budget. `internal/service` handles the rate-limit outcome for cancel, replace and flatten, and bounds the fill poller, the not-cancelable re-read and the bracket-leg cancels (FR-11). One new order-intent repository method releases a PENDING intent.
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

Two new keys. Both are bools with an explicit `true` code default (a missing key must not read as
disabled). Live mechanism for both: the service's `WatchConfig`-backed watcher, read with
`GetBool(key, true)` on every Alpaca request, so a `SetConfig` takes effect on the next call with no
restart. Both are seeded `true` as global rows for staging and production by one new `xstockstrat-config`
migration pair, `051_alpaca_adaptive_rate_limit_keys.up.sql` / `.down.sql` (051 is the next free number on `main-dev` since
feature 341 landed `050_ui_chart_history_bars`; features 343 and 330 still name 050 on their branches; the rule is recorded in `docs/roadmap/features/merge-order.md`
§ "Config seed number and Alpaca client overlap: 347 ↔ 341, 343, 330, 322, 323 (2026-11-16,
non-blocking)": the number is re-derived at execute and at the
integration PR, and the later merger regenerates `scripts/config-wiring-stored.json`).

- `marketdata.alpaca.adaptive_rate_limit_enabled` — namespace `marketdata`, stored key
  `alpaca.adaptive_rate_limit_enabled`, `value_type` bool, code default `true`. Reader:
  `services/xstockstrat-marketdata/cmd/server/main.go:main` (the `alpaca.NewLiveClient` settings closure,
  which the client calls on every request, alongside `backfill.rate_limit_rps`).
- `trading.broker.adaptive_rate_limit_enabled` — namespace `trading`, stored key
  `broker.adaptive_rate_limit_enabled`, `value_type` bool, code default `true`. Reader: a per-request
  func on `broker.ClientConfig`, built in `services/xstockstrat-trading/internal/service/trading.go:(*TradingService).instantiateBrokerLocked` next
  to the existing `Timeout: func() ... brokerCallTimeout(s.cfgW)` at the `broker.NewClient` call.

Existing key with changed meaning: `marketdata.backfill.rate_limit_rps` becomes a ceiling over the
adaptive rate (FR-4). Its type, default and bounds are unchanged. The same migration 051 updates its
seeded description. `services/xstockstrat-marketdata/CLAUDE.md` already states the key is read live per
request (stale "read at startup" wording corrected 2026-11-16); its row gains the ceiling wording when FR-4 lands.

The defaults of both new keys are declared in the marketdata and trading `CLAUDE.md` config tables.

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
- [x] **Does the Trading API host send them?** Not documented: the Trading API reference for
  `POST /v2/orders` (<https://docs.alpaca.markets/us/reference/postorder>, hosts
  `paper-api.alpaca.markets` / `api.alpaca.markets`) lists no rate-limit headers and no 429 response. The
  feature does not depend on the answer: where the headers are absent FR-5 applies and only the 429 retry
  (FR-3) is active on that host. Recon records what a real paper-host response returns.
- [x] **Kill-switch default.** Operator (2026-11-16): both keys seed `true`.
- [x] **Order mutations and 429 retry (FR-8).** Operator (2026-11-16): submit, replace and cancel are
  retried on 429 like every other broker call, bounded by the intent-staleness bound. Design must still
  prove the retry against the order-intent seam; `trading.go` already has callers that retry through that
  seam (`flattenAndHalt`).
- [x] **Shared code** — handed to `/sdd-design`, not a product question. The two services are separate Go
  modules (CI runs `GOWORK=off`); design chooses between one shared limiter package and two copies, under
  the DRY guard rail. Either choice satisfies every FR here.
- [x] **Per-credential state in trading** — handed to `/sdd-design`. FR-1 already requires state per host
  and per credential; design chooses the keying (per account client or per API key), since broker clients
  are built per account and accounts sharing one Alpaca key share one quota.
- [x] **Fixed constants** — handed to `/sdd-design`: record why the FR-2 threshold and the FR-3 backoff
  base and cap are code constants and not config keys (operator decision 4: kill switch only).
- [x] **Interactive deadlines (marketdata).** Operator (2026-11-16): accepted. All callers share the
  quota first-come; quote and price RPCs on about 2.5s budgets fail fast in an exhausted window, as today.
  Reserving quota for interactive reads is out of scope.

**Known traps (Ledger `fails.md`):**

- "A caller retrying through an idempotent/dedup seam must check the returned outcome" (fails.md ~L2627,
  `flattenAndHalt`) — applies to FR-8.
- "When copying a reconnect or retry loop from a reference, copy its failure boundaries too" (fails.md
  ~L3317) — applies to FR-3.
- "A request path shipped with no deadline at any hop" (fails.md ~L3180) — FR-3 must be bounded by the
  request context on every path.
- "Recon must inspect concrete broker implementations, not just the interface" (fails.md ~L1312).

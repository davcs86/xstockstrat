# Design: alpaca-adaptive-rate-limit

**Created**: 2026-11-16
**Rounds**: 5 (full; termination: approved — the operator waived the 5-round cap and set "adversary verdict sound" as the stop condition, met at round 5)
**Approved by**: user @ 2026-11-16
**Grounded in**: recon.md
**Debate register**: debate.md (D-1..D-30, R-1..R-17; D-21 is superseded by D-26)

Paths are relative to the named service directory unless they start with `services/`, `scripts/` or
`docs/`. `recon.md` carries the `path:line` evidence for every existing symbol named here.

---

## Chosen Approach

Consumer surface: none (internal). The change lives behind the two existing Alpaca REST chokepoints and
in the trading service code around them; operators reach the kill switches through the existing generic
config surfaces.

### 1. Shared pacing core `internal/alpacapace` (D-1, D-3, D-4, D-5, D-15, D-19, D-22, D-28)

A pure package (no I/O, sleep or logging; one mutex for its own state), copied **byte-identical** with
its `pace_test.go` into `services/xstockstrat-marketdata/internal/alpacapace/` and
`services/xstockstrat-trading/internal/alpacapace/`. Drift is blocked by a new group in
`scripts/check-watcher-copies.py`, a `.jscpd.json` ignore and an exemption in
`docs/patterns/dry-guard-rail.md`. `pace_test.go` is the only test home of core arithmetic.

```go
const (
    Window        = 60 * time.Second       // a hold never exceeds it
    ResetSlack    = 5 * time.Second        // pacing state accepts Reset iff now < Reset <= now+Window+ResetSlack
    LowWaterRatio = 10                     // low when remaining*LowWaterRatio < limit
    BackoffBase   = time.Second
    BackoffCap    = 8 * time.Second
    MaxJitter     = 500 * time.Millisecond // add-only, [0, MaxJitter)
)
type Key struct{ host string; cred uint64 }           // cred = maphash of the API key, process-random seed
type Headers struct{ Limit, Remaining int; Reset time.Time }
type Reservation struct{ Wait time.Duration; Fits bool }
func ParseHeaders(h http.Header) (Headers, bool)      // all three parse, Limit>0, Remaining>=0, Reset>0
func ParseReset(h http.Header) (time.Time, bool)      // Reset alone (429 path)
func NewPacer() *Pacer
func (p *Pacer) Key(host, apiKey string) Key          // "" is valid; no key material is stored
func (p *Pacer) Observe(k Key, h Headers, now time.Time)
func (p *Pacer) Reserve(k Key, now, latest time.Time, jitter time.Duration) Reservation
func (p *Pacer) WarnOnce(k Key, now, until time.Time) bool
func RetryWait(attempt int, now, reset time.Time, jitter time.Duration) time.Duration
```

Rules:

- `Observe` changes state only when all three headers parse and `Reset` is within one window plus slack;
  a recorded `Reset` is clamped to `now + Window`; within one `Reset`, `remaining = min(observed, local)`;
  state is replaced only when `Reset` advances; `nextSlot` never moves backwards; expired windows are
  pruned.
- `Reserve` (r = local remaining, L = limit, R = reset, ns = next slot):

  | State | Wait | Fits | State change |
  |---|---|---|---|
  | No state, or R ≤ now | 0 | true | none |
  | r·10 ≥ L | 0 | true | r-- |
  | Low-water, slot = max(now, ns) = now | 0 | true | ns = now + (R−now)/r; r-- |
  | Low-water, now < slot ≤ latest | slot − now + jitter | true | ns = slot + (R−slot)/r; r-- |
  | Low-water, slot > latest, r > 0 (skip) | 0 | true | r--; ns unchanged |
  | r == 0, hold = min(R−now, Window), now + hold ≤ latest | hold + jitter | true | nothing reserved |
  | r == 0, now + hold > latest | hold + jitter | false | nothing reserved |

- **A zero adaptive wait is never fit-tested and is always sent**; only a hold or a 429 wait can fail to
  fit. This is in the core's contract and pinned by a `pace_test.go` case and a client test.
- `RetryWait`: `min(Reset − now, Window) + jitter` whenever `Reset` parses and is in the future (no range
  filter on the 429 path); otherwise `min(BackoffBase << (attempt−1), BackoffCap) + jitter`.
- Jitter is drawn by each client from an unexported `jitter` func (test seam) and passed in; it applies
  only to a non-zero adaptive wait.

### 2. Marketdata client — `internal/alpaca/client.go#do` (D-2, D-6, D-8, D-9, D-14, D-16)

With `cfg.AdaptiveRateLimit` false the code path is exactly today's. With it true, `do` runs an attempt
loop: `Reserve` → existing static `limiter.Wait` (unchanged; nil when rps ≤ 0) → send `req.Clone` →
`Observe` → record the vendor outcome → on a 429 drain and close the body and retry. Only a 429 is
retried.

- Deadline D: the request deadline; with none, `start + 90 s` measured on the `now` seam, with waits
  **and attempts** under the bounded context and the cancel released when the response body is closed.
- `latest = D − jitter − minAttempt` (`minAttempt` = 1 s, a constant in this file).
- Marketdata **waits** rather than failing fast: a wait that cannot fit runs until the request context is
  done.
- New fields: `Settings.AdaptiveRateLimit` and `ClientConfig.AdaptiveRateLimit` (positive sense, zero
  value = pre-feature behavior), copied in `conf()`, read in the `cmd/server/main.go` settings closure as
  `cfgWatcher.GetBool("alpaca.adaptive_rate_limit_enabled", true)`.
- Seams: unexported `now`, `sleep(ctx, d)`, `jitter` fields set through a new in-package
  `export_test.go`. Contexts are derived from durations measured on the `now` seam, never from a seam
  timestamp.
- Logging: `slog.WarnContext`, once per throttled window per host (`WarnOnce`), naming host and wait.

| Situation | With deadline | Without deadline | Sent? |
|---|---|---|---|
| No header state / above low-water | wait 0 → static → send; 1 point + duration | same, under the 90 s bound | yes |
| Low-water, slot fits | sleep(slot − now + jitter) → send | same | yes |
| Low-water, slot does not fit | send at once, uses one unit of quota | same | yes |
| Hold fits | sleep(hold + jitter) → send | same | yes |
| Hold does not fit | sleep until the context is done → "rate limited" + host, wrapping the context error; 1 point recorded `ctx`, no duration | sleep until start + 90 s → error; 1 point `throttle`, no duration | no |
| 429, Reset parses and is in the future, fits | point `http_429`; sleep(min(Reset − now, 60 s) + jitter); resend | same | again |
| 429, same, does not fit | point `http_429`, then as "hold does not fit" | point `http_429`, then `throttle` at 90 s | no further |
| 429 without Reset | backoff 1/2/4/8/8… s + jitter, same fit handling | same | depends |
| Attempt times out | error as today, no retry; point `ctx` + duration | point `transport` + duration | once |
| Caller cancels during a wait | "rate limited" + host wrapping `context.Canceled`; 1 point `ctx` | same | no |
| Static ceiling cannot fit | "rate limited" + host wrapping the limiter error; point `throttle` | n/a | no |
| Kill switch off | today's `do`: one attempt, raw 429 → "alpaca <op> 429: …" | same | once |

The "`ctx` wins" precedence of `RecordVendorRequest` is unchanged: a refusal point is passed as
`throttle` on the caller's context and reads `ctx` when that context has ended.

### 3. Marketdata loops — `internal/service/marketdata_service.go` (D-26)

`StartWarmQuotePoller` and `StartBarIngestPoller` create `fetchCtx := WithTimeout(ctx, interval)` from
the live interval they already re-read, and pass it alongside the loop context:
`warmQuotesOnce(ctx, fetchCtx, symbols)`, `ingestRecentBars(ctx, fetchCtx)`,
`ingestRecentBarsForTimeframe(ctx, fetchCtx, …)`. Only the Alpaca calls use `fetchCtx`
(`GetLatestQuotesMulti`, `GetLatestQuote`, `GetBarsMulti`, `GetBars`); `cacheQuote`, `InsertBars`, logs
and the tick record keep the loop context. A guard at the top of each per-symbol fallback loop (and on a
later timeframe's multi fetch) starts no fetch once `fetchCtx` has expired; skipped symbols count as
errors (`out.errored`), never as empty. The signature changes touch 11 test call sites (recon).

### 4. Trading client — `internal/broker/alpaca.go#do` (D-2, D-7, D-12, D-13, D-14, D-17, D-28)

- New sentinel `broker.ErrRateLimited` in `internal/broker/broker.go`; the returned error wraps only it,
  contains "rate limited" and the host, and is never a context error or `ErrInvalidCredentials`.
- New field `ClientConfig.RateLimitBudget func() time.Duration` (nil or ≤ 0 = kill switch off = today's
  code exactly). It is wired in `instantiateBrokerLocked` next to `Timeout` as
  `func() time.Duration { return rateLimitBudget(s.cfgW.GetBool("broker.adaptive_rate_limit_enabled", true), brokerCallTimeout(s.cfgW), staleThreshold(s.cfgW)) }`,
  where the pure `rateLimitBudget(enabled bool, t, stale time.Duration)` lives next to
  `computeStaleThreshold` in `internal/service/order_intent.go` and returns 0 when disabled, else
  `max(t, stale − 2t)`.

  | T | multiplier | S | B |
  |---|---|---|---|
  | 5 s | 3.0 | 30 s | 20 s |
  | 5 s | 1.5 | 15 s | 5 s (single attempt) |
  | 10 s | 1.5 | 15 s | 10 s (single attempt) |
  | 1 s | 3.0 | 30 s | 28 s |

- Call end `C = min(caller deadline, start + B)`; `latest = C − T − jitter`. Trading **fails fast**: a
  non-zero wait is started only if `now + wait + T ≤ C` (inclusive); otherwise `ErrRateLimited` at once.
- A request whose method is not GET is a mutation (POST, PATCH, DELETE are exactly submit, replace,
  cancel): its loop runs on `context.WithoutCancel(req.Context())` with deadline C, so a sent attempt
  always completes or times out. A read keeps the caller's context.
- Each attempt runs under `WithTimeout(loopCtx, min(T, C − now()))`. A drained 429 body releases only
  that attempt; the returned body's `cancelOnClose` releases both. A retry uses `req.Clone` and calls
  `GetBody` only when non-nil (pattern: `internal/broker/ibkr_session.go`).
- State: one `Pacer` per `Client`, keyed by host and key fingerprint. No cross-client registry. Trading
  does not add `golang.org/x/time`.
- Seams and logging as in marketdata (`export_test.go` is new). No metric.

| Situation | Read | Mutation | Sent? |
|---|---|---|---|
| No header state / above low-water | send at once | send at once | yes |
| Low-water, slot fits | wait on the caller's context, send | wait on the loop context, send | yes |
| Low-water, slot does not fit | send at once | send at once | yes |
| Hold fits | wait hold + jitter, send; WARN | same | yes |
| Hold does not fit | `ErrRateLimited` at once; WARN | same | no |
| 429, Reset parses and is in the future, `now + wait + T ≤ C` | drain, wait, resend | same | again |
| 429, same, does not fit | `ErrRateLimited` at once | same (definite) | no further |
| 429 without Reset | backoff + jitter, same fit rule | same | depends |
| Attempt times out | timeout error unwrapped | same; stays "uncertain" | once |
| Caller cancels during a wait | `ErrRateLimited` | no effect | read: no |
| Caller cancels during an attempt | `context.Canceled`, as today | no effect | yes |
| Kill switch off (nil func or ≤ 0) | today's code | same | once |

A call bounded by one T (fill poller, re-read, leg cancels, `reconcileTick`, `syncPositions`) therefore
makes exactly its zero-wait first attempt and never waits or retries.

### 5. Trading service — `internal/service/trading.go` (D-11, D-18, D-20, D-23, D-25, D-27, D-28)

- **Classification.** `isUncertainBrokerOutcome` is unchanged: `ErrRateLimited` is definite, a timeout
  stays uncertain. A rate-limited submit is REJECTED with `order.broker_rejected` (error text carries
  "rate limited"); the stored REJECTED replays for a reused `client_order_id` (documented).
- **Flatten.** In the `flattenAndHalt` loop, right after `submitOrder`,
  `errors.Is(err, broker.ErrRateLimited)` calls `haltAccount` (idempotent) and the loop continues,
  re-minting ids as today. The account stays halted after a later successful flatten.
- **Cancel and replace.** `prevIntent` is captured just before the in-memory PENDING mark. On
  `ErrRateLimited` both call one helper, `refuseRateLimitedMutation(ctx, op, order, intentID, prevIntent, cause)`,
  before any local state write. It calls the new repository method
  `ReleasePendingIntent(ctx, intentID) (released bool, err error)` —
  `DELETE FROM trading.order_intents WHERE intent_id = $1 AND state = PENDING RETURNING intent_id` — on a
  context detached from caller cancellation, logs one WARN (`order_id`, `broker_order_id`, `intent_id`,
  `released`, `error`), emits no ledger event, and returns `codes.Unavailable`:
  - released → in-memory intent state restored to `prevIntent`; "…refused by the broker rate limit; the
    order is unchanged"; an identical retry inserts a fresh intent;
  - not released (DB error, or the sweeper already reclaimed the row) → in-memory intent state UNKNOWN;
    "…its <op> intent could not be released; verify with the broker before retrying".
- **Cancel reorder.** In `CancelOrder` the CANCELED write, persist and `finalizeCancelIntent` move ahead
  of the bracket-leg block; `order.canceled` and the broadcast stay last.
- **Per-call timeout helper.** `alpacaCallContext(ctx, entry)` returns `WithTimeout(ctx, brokerCallTimeout)`
  unless `entry.brokerType` is IBKR (then `ctx` unchanged). Callers: the fill poller's `GetOrder`, the
  `reconcileNotCancelable` re-read, and each bracket-leg cancel. It does not depend on the kill switch.
- **Worst case at defaults.** `CancelOrder` ≤ 35 s (parent ≤ 20 s, re-read ≤ 5 s, two legs ≤ 10 s); the
  cancel intent's lifetime ≤ 25 s, under the 30 s threshold.
- **Test fakes.** `fakeReconciliationOrderIntentRepo` gains the method to compile; `memIntentRepo` gains a
  real map-backed one.

### 6. Config — `services/xstockstrat-config` (D-10)

Migration `<NNN>_alpaca_adaptive_rate_limit_keys.{up,down}.sql` (052 since features 341 and 343 landed 050 and 051 on `main-dev`; re-derived at execute): four
global rows (two keys × staging, production), `value_type 'bool'`, value `'true'`,
`updated_by 'system:config-migration-feature-alpaca-adaptive-rate-limit'`, `ON CONFLICT … DO NOTHING`;
the `backfill.rate_limit_rps` description UPDATE guarded on the exact old text. Down deletes only
untouched global seed rows and swaps the description back guarded on the new text. Plus a per-migration
test, regenerated `scripts/config-wiring-stored.json` and a registered-keys log entry.

### 7. Build order

| Step | Kind | Files | Covers | Docs |
|---|---|---|---|---|
| S1 | service, lands with S2 | both `internal/alpacapace/pace.go`; `scripts/check-watcher-copies.py`; `.jscpd.json` | core | `docs/patterns/dry-guard-rail.md` |
| S2 | test | both `internal/alpacapace/pace_test.go`; `scripts/tests/test_check_watcher_copies.py` | core arithmetic behind AC-1, 3, 5, 13, 19, 24; zero wait always sends; jitter-boundary slot; Observe ordering; Reset clamp | — |
| S3 | service | marketdata `internal/alpaca/client.go`; `cmd/server/main.go` | — | `services/xstockstrat-marketdata/CLAUDE.md`; `services/xstockstrat-marketdata/docs/context-constitution.md` (MARKETDATA-4); `services/xstockstrat-marketdata/docs/alpaca-integration.md` |
| S4 | test | `internal/alpaca/export_test.go` (new), `client_test.go`; `internal/fmp/fmp_client_test.go` | AC-1–9, 11, 14, 19, 21, 22, 24 | — |
| S5 | service, lands with S6 | `internal/service/marketdata_service.go` | — | `services/xstockstrat-marketdata/docs/alpaca-integration.md` |
| S6 | test | `marketdata_service_test.go`, `bar_hold_test.go` | AC-32, AC-33 | — |
| S7 | service | trading `internal/broker/broker.go`, `internal/broker/alpaca.go`; `rateLimitBudget` in `internal/service/order_intent.go`; wiring in `internal/service/trading.go` | — | `services/xstockstrat-trading/CLAUDE.md` |
| S8 | test | `internal/broker/export_test.go` (new), `alpaca_test.go` | AC-10, 13, 15, 16, 17, 18, 20, 23; client side of AC-12 and AC-27 | — |
| S9 | service, lands with S10 | `internal/repository/order_intent_repo.go`; `internal/service/trading.go` | — | `services/xstockstrat-trading/CLAUDE.md`; `services/xstockstrat-trading/docs/context-constitution.md`; `services/xstockstrat-trading/docs/reconciliation.md` |
| S10 | test | new `internal/service/trading_rate_limit_test.go`; `trading_flatten_rejection_test.go`; `trading_cancel_not_cancelable_test.go`; `trading_reconciliation_test.go` | AC-12 (one intent), AC-13 (budget table), AC-25–31, 34, 35, 36 | — |
| S11 | config | config migration pair; `scripts/config-wiring-stored.json` | — | `docs/patterns/config-governance.md`; `docs/roadmap/features/merge-order.md` if the number moves |
| S12 | test | `services/xstockstrat-config/src/__tests__/alpacaAdaptiveRateLimitSeedMigration.test.ts` | AC-37 | — |

Test notes for `/sdd-spec`:

- Guards that pass on today's code by design: AC-2, AC-7, AC-20, AC-24, AC-36 (AC-36 is red once S7/S8
  have landed). Every other scenario fails today. AC-13 row 1 relies on the inclusive fit rule.
- Trading service tests seed config with `config.MustSnapshotWatcher("trading", …)`, build a real
  `broker.NewClient` against an HTTP test server with `Timeout` and `RateLimitBudget` from the same
  closures as `instantiateBrokerLocked`, and put it in `s.brokers` (AC-25–28, 34–36). Intent state is
  asserted through `memIntentRepo`; stored writes through `ctxCapturingDB`. Harnesses: `auditSvc`
  (`trading_order_state_audit_test.go`), `newFlattenHarness` with a recording wrapper around the real
  client (AC-28; about 1.5 s of real retry delay).
- AC-32 and AC-33 drive one cycle of the Start loop with a 200 ms interval; the fake source answers only
  its first multi call as the scenario says, later calls block until their context is done; requests are
  counted per fetch context.
- `ReleasePendingIntent` has no repository-level test home (`NewOrderIntentRepo` takes a concrete pool);
  its SQL is checked by review.
- AC-37's new description text is fixed in the implementation spec.

## Rejected Alternatives

- `R-1` A new shared Go module for the limiter — needs `replace` directives, Docker build-context changes and `GOWORK=off` handling; the repo already governs byte-identical copies with a CI hash check.
- `R-2` A trading registry sharing limiter state across clients with the same credential — global mutable state for an edge case.
- `R-3` Trading retries 429s only, no pacing — FR-1 and FR-2 cover every Alpaca client; FR-5 already degrades safely.
- `R-4` Fail-fast refusal in marketdata — declined by the user; marketdata waits to the request deadline.
- `R-5` Anchor the mutation deadline at the intent seam — the user chose the smaller budget instead.
- `R-6` Budget `max(T, S − T)` — only a 5 s margin before the sweeper can reclaim a running intent.
- `R-7` Classify a post-send caller cancellation as "uncertain", or leave the gap — the user chose to detach mutations from caller cancellation.
- `R-8` `flattenAndHalt` halts and stops retrying, or skips in-client retry, or no change — a halt does not close the position.
- `R-9` Refuse a caller that cannot wait for its spread slot — interactive reads would fail when quota is merely low.
- `R-10` Leave rate-limited cancel and replace unchanged and file a defect — the user chose to fix both here.
- `R-11` An IBKR-inclusive `brokerCallFloor` timeout in the fill poller, or accepting the stalls — changes IBKR behavior (FR-7).
- `R-12` Store a marked Rejected intent that the classifier re-arms — larger than a guarded DELETE; a missed marker brings back the stale replay.
- `R-13` An attempt nonce in the cancel/replace intent id — breaks TRADING-6.
- `R-14` Keep the cancel/replace intent row after a rate-limit refusal — an identical retry would be refused, then blocked as unknown.
- `R-15` The interval deadline on the whole marketdata cycle including DB writes — false `loop tick ok` or a rolled-back bar batch.
- `R-16` Bracket-leg cancels use the full retry budget — `CancelOrder` could take about 60 s for a cancel that already succeeded.
- `R-17` Detect the Alpaca client by `== BROKER_TYPE_ALPACA` or by type assertion — leaves an UNSPECIFIED-type account unbounded; a fake would skip the bound.

## Open Risks

- [ ] Trading's pollers and reconciler run on a one-timeout deadline, so they always skip spreading; the largest steady consumer of the trading quota is never spread — recorded; S8 unit test that such a call sends exactly one attempt.
- [ ] Clamp row (T 10 s, multiplier 1.5): mutation budget plus the not-cancelable re-read is 20 s against a 15 s threshold (the read is unbounded today) — documented in the trading `CLAUDE.md` at S9; budget table test at S10.
- [ ] T 1 s, multiplier 3.0 leaves a 1 s margin — same S10 table.
- [ ] Trading API rate-limit headers are undocumented; on those hosts only the 429 retry may be active — FR-5 degradation tested at S8; a real paper-host response recorded at the integration PR.
- [ ] Pre-existing defect, not fixed here: `ReplaceOrder` inserts its intent before `validateTIF` — defect report filed at `/sdd-spec`.
- [ ] Config migration number: 341 took 050 and 343 took 051 on `main-dev`, so this feature uses 052; 330 may still claim the next number — re-derived at S11 and at the integration PR; `scripts/config-wiring-stored.json` regenerated.
- [ ] In an exhausted window a marketdata quote or price fetch holds for its 2.5 s budget before returning the warm subset (a 429 used to fail at once) — recorded in context.md; bounds verified at S4 (AC-6, AC-21).
- [ ] Under a hold, each watchdog tick still produces REJECTED flatten orders, as a raw 429 does today — documented at S9.
- [ ] `ReleasePendingIntent` is the first delete path on `trading.order_intents` and has no DB-level test — reviewed at S9; the rule is written into the trading `CLAUDE.md` and service constitution.
- [ ] A caller whose own deadline is shorter than a retry wait plus one attempt gets a permanent REJECTED submit (as a raw 429 does today) — documented at S9.

## Constitution Rules Touched

- `C-01` / `F-04` — honored by: every existing symbol is cited from recon; new files are marked new.
- `C-05` / `F-07` — honored by: both keys namespace-relative, seeded, declared in each service's `CLAUDE.md`; constants are operator-approved fixed invariants; live controls stay config.
- `C-07` / `F-01` — honored by: a new config migration with a re-derived number; no applied file edited.
- `C-08` / `C-15` / `P-06` — honored by: paired test steps cover AC-1..AC-37; guards are labelled; IDs append-only.
- `C-10` — honored by: both Alpaca clients change; the copies are gated by `check-watcher-copies`.
- `C-13` — honored by: fixtures stay inline while they have one consumer.
- `C-14` — honored by: consumer surface "None", unchanged.
- `C-16` — honored by: no existing rule is changed (see below).
- `C-18` — honored by: one helper per concern, no new layer; recorded trade-off: the trading copy of the core carries host/key machinery it barely uses.
- `F-06` — honored by: no pool change; no connection is held while sleeping.
- `P-03` / `P-04` — honored by: every departure from approved text went through a user gate (D-11..D-14, D-19, D-20, D-25..D-27; the round-cap override) and is recorded in context.md.

## Business Rules Touched (C-16)

- EXTEND `@AC-13 @feature-294` "Vendor requests are counted by bounded outcome without leaking the FMP key" (`services/xstockstrat-marketdata/acceptance/signal-map-instrumentation.feature`) — new case added: vendor `alpaca` points `http_429`, `throttle`, `ctx`; no new key.
- EXTEND `@AC-14 @feature-295` (`services/xstockstrat-config/acceptance/fix-config-keys-drift.feature`) and `@AC-27 @feature-282` (`services/xstockstrat-config/acceptance/filter-otc-symbols.feature`) — new case added: two seeded bool keys.
- PRESERVE `@AC-8 @feature-229`, `@AC-54 @feature-240`, `@AC-14 @feature-282` (marketdata time bounds) — not regressed by: every marketdata wait ends at the request context.
- PRESERVE `@AC-3 @feature-229`, `@AC-3 @feature-178`, `@AC-3 @feature-227`, `@AC-53 @feature-240`, `@AC-10 @feature-282` — not regressed by: retries stay inside the one fetch; errors stay INTERNAL; the asset refresher keeps its own backoff.
- PRESERVE `@AC-5 @feature-291` — not regressed by: skipped and rate-limited symbols are errors, never empty.
- PRESERVE `@AC-6 @feature-294`, `@AC-14 @feature-294`, `@AC-45 @feature-294`, `@AC-5 @feature-294`, platform `@AC-41 @feature-294` — not regressed by: failed ticks write no record; outcome sets and label keys are unchanged.
- PRESERVE `@AC-1`, `@AC-2`, `@AC-3`, `@AC-4`, `@AC-6`, `@AC-8`, `@AC-9 @feature-267` (`services/xstockstrat-trading/acceptance/fix-trading-order-state-audit.feature`) — not regressed by: timeouts stay uncertain; one CANCELED write; a broker call ends within the budget (except the recorded clamp row).
- PRESERVE `@AC-16`, `@AC-17`, `@AC-12`, `@AC-32 @feature-295`, `@AC-7 @feature-147`, `@AC-3` / `@AC-1 @feature-304` — not regressed by: fingerprint-only keying, live timeout on every attempt, seeded relative keys, live ceiling.
- PRESERVE `@AC-4`, `@AC-7`, `@AC-9 @feature-293`, `@AC-1 @feature-296`, `@AC-2 @feature-306`, platform `@AC-3 @feature-278`, platform `@AC-19 @feature-295` — not regressed by: a replay-safe, guarded seed with relative keys and matching bool type.

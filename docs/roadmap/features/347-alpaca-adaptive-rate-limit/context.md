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

## Session 2026-11-16T02:30Z — sdd-review product-spec (warning loop, operator-requested)

- Operator asked to loop the review until every warning was addressed. Passes 3 to 5; pass 5 returned
  PASS with no warnings and no blockers. Status unchanged (`spec-ready`).
- Spec changes: FR-2 pins "Remaining 4 of 200 is low" and the cut-short-wait error; FR-3 adds
  add-only jitter, "Reset is used whenever it parses", and a fixed total-wait bound for callers with no
  deadline (60 to 300 s marketdata; below the FR-8 threshold in trading); FR-5 ignores a response when
  any of the three headers is unusable; FR-9 adds no instrument and maps a cut-short wait to `throttle`;
  new § Fixed Invariants records why the pacing constants are not config keys.
- Scenarios: AC-7, AC-8, AC-9, AC-12, AC-13 tightened; AC-19 (no-deadline bound), AC-20 (per-credential
  state), AC-21 (throttle outcome), AC-22 (rps 0) added. 22 scenarios.
- Shared files touched: `docs/roadmap/features/merge-order.md` gained a non-blocking 347 section (config
  seed 050 shared with 341/343/330; `alpaca/client.go` overlap with 322/323).
  `services/xstockstrat-marketdata/CLAUDE.md` row for `backfill.rate_limit_rps` corrected from "read at
  startup" to live per request (matches `cmd/server/main.go`).
- Correction: the order-retry bound is 30 s at defaults, not the 15 s first quoted to the operator
  (`IBKRRequestTimeout` is 10 s and enters the `max`).

## Session 2026-11-16T03:40Z — sdd-design (gate log)

- Phase 0 Recon: wrote recon.md (marketdata, trading, config; 40 existing business rules, none CHANGE).
- Trading API reference pages (`/v2/orders`, `/v2/account`, overview) document no rate-limit headers
  and no 429; only the Market Data reference does.
- Phase 1 round 1 done; register in debate.md (D-1..D-10 settled, R-1..R-3 locked, O-2/O-4/O-5/O-6/
  O-9/O-11 open). No Floor breach, no C-16 regression found.
- Round 1 gate, operator steers (2026-11-16): (8) trading fails fast on a wait that cannot fit;
  **marketdata keeps waiting to the request deadline** (fail-fast declined there); (9) a rate-limited
  `flattenAndHalt` submit halts the account first, then keeps retrying the flatten; (10) order mutations
  run detached from caller cancellation, still time-bounded; (11) trading retry budget is
  `max(T, S − 2T)` (20 s at defaults). Recorded as D-11..D-14, R-4..R-8 in debate.md.
- Round 2 done (D-15..D-18; O-14..O-24). Round 2 gate, operator steers: (12) accept the spread-skip
  rule (FR-2 amended); (13) fix rate-limited cancel (return Unavailable, no local CANCELED) and replace
  (no stored Rejected intent) in this feature; (14) bound the loops: per-cycle deadline in marketdata's
  warm-quote and bar-ingest loops, Alpaca-only per-call timeout in the fill poller; (15) run round 3.
  D-19..D-21, R-9..R-11.
- D-14 supersedes operator decision 7 for marketdata: in an exhausted window a detached quote or price
  fetch now holds for its full budget (2.5 s) before returning the warm subset, where a 429 used to fail
  in milliseconds. Time bounds are unchanged.
- Round 3 done (D-22..D-24; O-25..O-35). Round 3 gate, operator steers: (16) **approved** one new
  repository method `ReleasePendingIntent` (guarded DELETE of a PENDING intent row after a rate-limit
  refusal) — the first delete path on `trading.order_intents`; (17) the marketdata cycle deadline bounds
  only the Alpaca calls, DB writes keep the loop context (D-26 supersedes D-21); (18) bracket-leg
  cancels are bounded by `broker.timeout_ms`, no retry; (19) run round 4. D-25..D-27, R-14..R-16.
- To file at spec/execute (pre-existing, not fixed here): `ReplaceOrder` inserts its intent before
  `validateTIF`, so a TIF validation failure leaves the intent PENDING then UNKNOWN.
- Round 4 done (D-28, D-29, R-17; O-36..O-41 closed). Round 4 gate, operator steer (2026-11-16):
  "keep rounds until adversary verdict is sound. I sign off to override the rounds cap." The debate may
  run past the 5-round cap of `/sdd-design` full mode; rounds continue until the adversary returns a
  verdict with no blocking objection. Override recorded per P-04; the Floor rule (F-11) is untouched.
- Round 5 done: adversary verdict SOUND (no Floor breach, no blocking objection, no register violation,
  no C-16 regression). D-30, O-42. The operator's stop condition for the debate is met.

## Session 2026-11-16T05:40Z — sdd-design

- Phase 0 Recon: wrote recon.md (services: marketdata, trading, config; key reuse patterns: the single
  `do` chokepoint in each Alpaca client; the byte-identical-copy governance of `check-watcher-copies`).
- Phase 1 Grilling: 5 rounds (full; the operator waived the round cap and set "adversary verdict sound"
  as the stop condition; met at round 5). Chosen approach: a pure pacing core copied into both services
  behind each `do`; marketdata waits to the request deadline, trading fails fast inside a budget of
  `max(T, S − 2T)`; order mutations detached from caller cancellation; rate-limited cancel/replace
  release their intent; loops and per-call reads bounded. Rejected: a shared Go module, a cross-client
  credential registry, anchoring the deadline at the intent seam (R-1..R-17 in debate.md).
- Operator approved the design at the round 5 gate (2026-11-16).
- Product spec and acceptance.feature amended as approved: FR-2, FR-3, FR-8, FR-9 reworded; FR-11 added;
  fixed invariants listed; AC-2, 3, 7, 13, 17, 19, 20, 21 corrected; AC-23..AC-37 added (37 scenarios).
- Business rules (C-16): no existing rule changed; three extended (294 @AC-13, 295 @AC-14, 282 @AC-27).
- Constitution rules touched: C-01, C-05, C-07, C-08, C-10, C-13, C-14, C-15, C-16, C-18, P-03, P-04,
  P-06, F-01, F-04, F-06, F-07. Floor breaches: none.
- Status: spec-ready → design-approved.

### Open Threads (from design.md Open Risks)

- [ ] Trading pollers and reconciler always skip spreading — unit test at S8.
- [ ] Clamp row (T 10 s, ×1.5): budget plus re-read 20 s > threshold 15 s; T 1 s, ×3.0 leaves 1 s —
  budget table test at S10, documented at S9.
- [ ] Trading API rate-limit headers undocumented — FR-5 test at S8; real paper-host response recorded
  at the integration PR.
- [ ] File the pre-existing `ReplaceOrder` defect (intent inserted before `validateTIF`) at `/sdd-spec`.
- [ ] Config migration number re-derived at S11 and at the integration PR; regenerate
  `scripts/config-wiring-stored.json`.
- [ ] `ReleasePendingIntent` has no DB-level test — reviewed at S9; rule written into trading docs.
- [ ] AC-37's new `backfill.rate_limit_rps` description text is fixed in the implementation spec.

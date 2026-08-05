# Context: broker-state-reconciliation

**Feature**: `docs/roadmap/features/102-broker-state-reconciliation/feature.md`
**Product Spec**: `docs/roadmap/features/102-broker-state-reconciliation/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/102-broker-state-reconciliation/implementation-spec.md`

---

## Session 2026-08-04T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from an external live-capital
  safety risk review. P0 item 5 ("broker-versus-platform reconciliation").
- Depends on 101 (exactly-once-order-intent) for the `UNKNOWN`-state contract it reconciles against.
  Feeds 100 (account-trading-halt-and-kill-switch) as an automatic halt trigger on unsafe mismatches,
  and 108 (trading-safety-dashboard-slos) as a status/age metric source.

## Session 2026-08-04T01:00:00Z — feasibility re-check (demoted)

- The user pushed back on the initial mechanical translation of the review into features and asked
  for an actual feasibility/realism analysis against this repo. That analysis found: (1)
  `xstockstrat-analysis`'s live loop only calls `EmitAlert`, never `PlaceOrder`
  (`services/xstockstrat-analysis/app/engine/` — grep confirmed zero non-test hits); feature
  `048-live-strategy-alert-engine`'s own spec is explicit that it is alert-only, human-acts-on-it. The
  MCP agent (`services/xstockstrat-agent/app/tools.py`) has no order-placement tool. The **only**
  caller of `TradingService.PlaceOrder` in the repo is the human-driven trader UI
  (`services/xstockstrat-ui/src/lib/traderBff.ts:28`). (2) There is no automated/unattended
  order-placement path today for broker state to silently drift out from under.
- Demoted to `demoted/canceled`. Today, a human reviewing the trader UI against the broker's own
  dashboard before/after every manual order is the de facto reconciliation — thin, but real, and
  proportionate to a single-operator project. Revisit this feature if/when an automated
  strategy-to-order execution path is actually approved as a feature (which would reintroduce the
  unattended-drift risk this feature addresses), or if manual review is found insufficient in
  practice.

## Session 2026-08-04T02:00:00Z — user review (revived, rescoped)

- The user pushed back on demoting this specific feature: "102 sounded good even for a solo
  maintainer." Re-examined with that framing: the full continuous-engine-plus-dashboard version
  really was disproportionate, but a **much cheaper version is genuinely low-cost even solo** — a
  periodic ticker inside `xstockstrat-trading` itself (the only service holding broker credentials),
  reusing its existing `alpaca.go`/`ibkr.go` clients, writing to the existing ledger `AppendEvent` RPC
  instead of a new table, and alerting via the existing `xstockstrat-notify` `EmitAlert`. No new
  service, no new dashboard, no new database table.
- Revived to `draft` and rewrote `product-spec.md` around that lighter design. Kept the dependency on
  `101` (rescoped) — this feature is exactly where `101`'s deferred "who resolves an `UNKNOWN` order
  intent" question gets answered.
- General lesson for next time: "protects a capability that doesn't exist yet" was the right objection
  to most of the demoted items (102's original scope included), but it over-applied here — the *cheap*
  version of a control can still be worth building now even when the *expensive* version should wait.
  Re-scope before demoting, not just demote.

## Session 2026-08-05T00:00:00Z — sdd-review product-spec (2 rounds)

- Round 1 FAIL: C-5 trading-domain blocker — FR-2's mismatch taxonomy never distinguished a routine
  `ORDER_STATUS_PARTIALLY_FILLED` order from a genuine quantity-discrepancy mismatch, risking a false
  `REDUCE_ONLY` halt on every ordinary partial fill (directly counter to the feature's own "self-heal
  benign cases" goal). Fixed: FR-2 now states a partial fill is not itself a mismatch — only a
  post-propagation-delay quantity disagreement counts.
- Round 2: **PASS WITH WARNINGS** (4 advisory: state both `BrokerType`s explicitly in scope, define
  the "unprotected/impossible" bucket, state how `ORDER_STATUS_FILLED` interacts with the open-orders
  comparison, add a `## Dependencies` section). Fixed the `## Dependencies` section (100, 101) and
  folded the remaining three into Open Questions in the same pass. Status: `draft` → `spec-ready`.

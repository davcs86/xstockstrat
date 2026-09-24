# Context: order-time-in-force-enum

**Feature**: `docs/roadmap/features/202-order-time-in-force-enum/feature.md`
**Product Spec**: `docs/roadmap/features/202-order-time-in-force-enum/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/202-order-time-in-force-enum/implementation-spec.md`

---

## Session 2026-09-24 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from the
  user request "add to the roadmap: order timing".
- **Scope clarified with the operator** (AskUserQuestion, this session): "order timing" resolved to
  **time-in-force enum + per-broker validation**, explicitly *not* scheduled/deferred orders,
  timing telemetry, or auto-cancel/expiration (recorded in `## Out of Scope`).
- Grounding facts from recon this session:
  - `Order.time_in_force` is proto field 12, currently `string`; the Place Order form sends it and
    the Alpaca/IBKR adapters read it (`services/xstockstrat-trading/internal/broker/{alpaca,ibkr}.go`,
    `internal/service/trading.go`, `internal/repository/trading_repo.go`). No platform-side validation exists today.
  - Existing `OrderType` enum already follows the `<NAME>_UNSPECIFIED = 0` convention — mirror it.
- **Open design fork left for `/sdd-design`:** field 12 string→enum in place is wire-breaking
  (breaking-proto gate); an additive new-field-plus-deprecation is non-breaking. Not decided at story time.
- **Known trap flagged (ledger fails.md:81–83 / F-C-10 and fails.md:677–679):** proto enum changes are
  never backend-only — exhaustive TS `Record<Enum,…>`/switch consumers must change in the same PR and
  the UI must send NAME-string enums over Connect-JSON. Carried into `## Open Questions`.
- Depth this session: **story only** (operator chose it) — stops at `spec-ready`; `/sdd-design quick`
  not run yet.

## Session 2026-09-24T00:00:00Z — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready (criteria: PASS WITH WARNINGS, no blockers; overlap: CLEAN).
- Warnings (all advisory, to resolve at /sdd-design — none block the gate):
  - Open Questions (criterion 9): 4 unchecked design-forks — field strategy (breaking vs additive),
    exact variant set, per-broker support-matrix location, F-C-10 TS-consumer trap. Intended
    product-spec→design handoff (P-03), not a completeness gap.
  - C-2: OFFLINE `BrokerType` (common.proto:74) TIF semantics not addressed; per-broker matrix
    names only Alpaca/IBKR.
  - C-3: paper-vs-live equivalence / paper-safety not stated (validation is edge-side, mode-agnostic).
  - C-4: "existing order types unaffected" not stated; scenarios cover ~one order type. Real brokers
    couple TIF to order type (e.g. OPG/CLS validity).
  - C-5: "fill handling unaffected" not stated; ReplaceOrder is allowed on NEW/PARTIALLY_FILLED.
- Code-checkable claims verified: `Order.time_in_force = 12` (trading.proto:58), `PlaceOrderRequest
  .time_in_force = 7` (:108), `ReplaceOrderRequest.time_in_force = 5` (:188) all currently string →
  in-place conversion is wire-breaking, as the spec states. Service names match the registry.
- Overlap: CLEAN. 196 (proto-deprecated-field-removal) shares the trading proto module but makes no
  .proto change and touches disjoint fields (user_id/is_paper). 188/199 share /trader UI but not the
  Place/Replace Order form. No trading proto field-number claim in flight. Re-scan at Mode B once the
  field strategy + new field number are chosen.

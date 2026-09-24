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

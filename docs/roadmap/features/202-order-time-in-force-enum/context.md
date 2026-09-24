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

## Session 2026-09-24 — sdd-design

- Phase 0 Recon: wrote recon.md (services: xstockstrat-trading, xstockstrat-ui, packages/proto; key reuse patterns: OrderType enum at trading.proto:81-88, typeStr()/parseType() at trading_repo.go:378-391, Record<Enum, EnumRender> at opportunityShared.tsx:28-70).
- Phase 1 Grilling: 5 rounds (full, terminated at cap). Chosen approach: in-place string-to-enum conversion (wire-breaking) with UNSPECIFIED always rejected, `tif_validation.go` + `tif.go`, migration 010 to normalize historical strings. Rejected: additive field strategy (no old callers), UNSPECIFIED→DAY fallback (user: "Remove unspecified"), config-driven TIF matrix (deployment-time-fixed set).
- User constraints binding across rounds: R2 — "Remove unspecified. There are no old callers to care about" (in-place, UNSPECIFIED always rejected). R4 — "Edit order must not use unspecified, include it in scope" (EditOrderDialog always sends concrete TIF). Clarification — "I meant it must have a value, not undefined" (pre-fill from order's current TIF, always concrete enum, never `undefined`/absent).
- Key adversary catches incorporated: R4 — order-intent hash breakage (transient FailedPrecondition during deploy, documented as deploy note), missing testdata site, ReplaceOrder nil-guard, TIF_LABEL UNSPECIFIED entry, buildBrokerRequest defense-in-depth, EditOrderDialog encoding. R5 — missing validateTIF in ReplaceOrder, `:2594` type mismatch (enum not string), ReplaceOrder intent hash undocumented, PlaceOrder breaks existing test fixtures, corollary of #1. All specification-completeness, no Floor breaches.
- Constitution rules touched: C-01, C-04, C-10, C-14, C-16, F-04, F-11. Floor breaches: none.
- Status: spec-ready → design-approved.

## Session 2026-09-24 — sdd-spec

- Generated `implementation-spec.md` with 9 steps:
  1. Proto: define `TimeInForce` enum, convert fields 12/7/5 in place (wire-breaking)
  2. Proto-gen: `./scripts/buf-gen.sh`
  3. Migration 010: normalize historical TIF strings (lowercase, alias mapping, NULL→`'day'`)
  4. Service: `tif_validation.go` (validateTIF, tifToWireString, allowedTIFs matrix) + `tif.go`
     (tifStr/parseTif) + `trading.go`/`trading_repo.go` handler and repo changes
  5. Test: TIF unit tests (tif_validation_test.go, tif_test.go) + order_intent_test.go fixture fix;
     covers AC-1, AC-2, AC-3, AC-4
  6. UI: orderShared.tsx TIF_LABEL, OrderForm.tsx TIF Select, EditOrderDialog.tsx enum select,
     order detail page rendering
  7. E2E: fixture numeric enum conversion, spec inline string→enum updates; covers AC-5
  8. Docs: cross-service build verification + deploy note (order-intent hash transient breakage)
  9. CI: temporary `buf breaking --exclude-path` workaround for the intentional wire-breaking change
- Scenario coverage: AC-1/AC-2/AC-3/AC-4 → Step 5; AC-5 → Step 7
- Trading-domain constraints applied: broker coverage (Alpaca/IBKR/OFFLINE all addressed),
  `broker.OrderRequest` stays string (enum-to-wire boundary is `tifToWireString` in service layer),
  hardcoded `"day"` sites at `:2594`, `:3182`, `:3224` converted, `order_intent_test.go` fixtures
  updated to avoid zero-value UNSPECIFIED rejection
- Cross-cutting constraints applied: lint/format gate verification steps, test-data inventory C-12/C-13
  (single-consumer fixtures stay inline, INVENTORY.md catalog updated)
- Key design decisions carried from design.md: UNSPECIFIED always rejected (user constraint),
  EditOrderDialog always sends concrete TIF (user constraint), column stays TEXT with Go-layer
  validation (no CHECK), config-driven matrix rejected (hardcoded constants)
- Status: design-approved → implementation-ready.

## Session 2026-09-24 — sdd-design R6 (uncapped grilling)

- User overrode the 5-round hard cap to continue grilling until SOUND verdict (feature 203 already
  got SOUND at R3; 202 was the only one that hit the cap without it).
- R6 proposer confirmed all R1–R5 fixes incorporated. R6 adversary returned **SOUND** — no Floor
  breaches, no blocking objections, 3 advisory (non-blocking) items:
  1. **Offline carve-out** — `trading.go:409` offline early-return precedes `validateTIF` (~`:425`).
     Documented as intentional: offline path skips all broker-interaction gates, TIF is metadata
     never sent to a broker, UI always sends a concrete value. Design records the carve-out
     explicitly and notes the alternative (move `validateTIF` before offline return) if a universal
     schema invariant is preferred.
  2. **`page.tsx:170` explicit callout** — already in Change-Site Inventory; the `Field` component
     (`:231`) declares `value: string`, so the enum-to-string type mismatch is compiler-enforced
     by `tsc`. Added explicit note in design.md UI section (a).
  3. **`mock-backend.ts:244-252`** — `placeOrder` mock handler returns no `timeInForce`, defaults
     to `0` (UNSPECIFIED) after the enum change. New TIF-specific E2E scenarios must return a
     concrete TIF value. Added as design.md UI section (f).
- All 3 advisory items incorporated into design.md. Rounds updated from 5 to 6 in design.md header,
  feature.md Status History, and Constitution Rules Touched citations.

# Recon: wire-signal-confidence-to-position-sizing

**Created**: 2026-08-31
**From**: product-spec.md
**Affected services**: xstockstrat-analysis, xstockstrat-ui, xstockstrat-ingest (read-only), xstockstrat-trading (consumer, no change expected)

---

## Objective

Make feature 023's dead `PlaceOrderRequest.confidence` wire capability reachable by a real caller:
thread the true per-signal `ExternalSignal.conviction` (0.0–1.0) to the live signal-detail order
ticket, kept strictly separate from the `Opportunity.conviction` ordinal ("NOT a probability"), and
give that ticket — and only that ticket — a scoped blank-qty affordance that routes into 023's
`qty <= 0` auto-sizing path. The plain `/trader` order forms are unchanged.

## Codebase Map

- **`xstockstrat-analysis`** (Python)
  - Opportunity assembly: `_compute_opportunities` — `services/xstockstrat-analysis/app/handlers/servicer.py`
    - candidate dict init incl. `signal_axis`/`_best_sig_conv`: `servicer.py:3129-3140` (`"_best_sig_conv": -1.0`)
    - signal fetch (existing edge): `QuerySignals` at `servicer.py:3580-3590`
    - per-signal fold: `raw_conviction = sig.conviction` (`:3228`); `source_weight` (`:3231`); `effective_conviction = raw_conviction * source_weight * decay_multiplier` (`:3251`)
    - **two distinct reducers, already present:** `c["signal_axis"] = max(c["signal_axis"], effective_conviction)` — decayed/weighted (`:3274`); `c["_best_sig_conv"] = max(raw sig.conviction)` — **raw**, used for thesis/direction (`:3275-3276`)
    - speculative-tail rank uses raw max too: `-max(sig.conviction for sig in signals_by_symbol[sym])` (`:3207`)
  - Materialized queue read: `OpportunitiesRepository` — `services/xstockstrat-analysis/app/repositories/opportunities.py`; persisted columns incl. `conviction`, `signal_axis`, `readiness_json`, `provenance` (`opportunities.py:97-99`); rank `ORDER BY ((1-$3)*o.conviction + $3*o.signal_axis)` (`opportunities.py:114`)
  - `Opportunity` proto message max field today: `muted = 12` — `packages/proto/analysis/v1/analysis.proto:542-555`; `conviction = 3` doc-commented "deterministic ordinal … NOT a probability" (`:539-546`)
- **`xstockstrat-ui`** (Next.js)
  - Live signal-detail page (unified, feature 125): `services/xstockstrat-ui/src/app/trader/positions/[symbol]/page.tsx`
    - already fetches the queue: `useOpportunities(0)` → `symbolOpportunities` filter (`page.tsx:185-189`)
    - renders the order ticket: `<OrderForm mode={mode} initialSymbol={symbol} allowOfflineRecord={false} />` (`page.tsx:342`)
  - Order form: `services/xstockstrat-ui/src/components/trader/OrderForm.tsx` — qty `<Input … required>` (`:206-214`), `qty: parseFloat(qty)` (`:108`), `usePlaceOrder` (`:96`); scoped-behavior precedent = the explicit `allowOfflineRecord` prop (`:52-60`), deliberately NOT keyed on `initialSymbol` (`:47-51`)
  - Plain forms (must stay unchanged): `/trader` `src/app/trader/page.tsx:32` and `/trader/orders` `src/app/trader/orders/page.tsx:51` — both `<OrderForm mode={mode} />`
  - Place-order hook: `src/hooks/usePlaceOrder.ts` (thin wrapper over `tradingClient.placeOrder`)
  - `insights/market/[symbol]/page.tsx` — **redirect-only stub** (feature 125) → `/trader/positions/${symbol}`
- **`xstockstrat-ingest`** (Python) — source only
  - `ExternalSignal.conviction = 4` "0.0 – 1.0 confidence (0.0 if not provided by source)" — `packages/proto/ingest/v1/ingest.proto:106-110`; read by analysis via `QuerySignals` (no change)
- **`xstockstrat-trading`** (Go) — consumer only (023, launched)
  - `PlaceOrderRequest.confidence = 16` (`optional double`), "Unset → 1.0; explicit 0.0 → size to zero; out-of-range → InvalidArgument" — `packages/proto/trading/v1/trading.proto:121-123`
  - auto-size gate: `needSizing := req.Qty <= 0` (`trading.go:457`); reads confidence + range-guards it: `confidence := 1.0; if req.Confidence != nil {…}; if confidence < 0.0 || confidence > 1.0 { InvalidArgument }` (`trading.go:483-489`); `ComputePositionSize(…, confidence)` (`:490`); `dollarRiskBudget := equity * maxRiskPct * confidence` (`:3165`). No change needed.

## Patterns to REUSE

- **Max-raw-conviction reducer** → reuse the existing `c["_best_sig_conv"]` accumulator (`servicer.py:3140,3275-3276`) — the platform's already-established "the raw conviction for this symbol" value (max over the symbol's active signals), computed in the same pass as `signal_axis`. Do **not** invent a second per-symbol reducer (avoids the C-10(b) multi-signal trap, `fails.md` 2026-07-01/056).
- **Additive `Opportunity` enrichment read by the same page** → mirror feature 095's fields 13-18 pattern (explicit-presence `optional`, omit-not-fabricate when absent). The signal-detail page already reads `Opportunity` for the symbol (`page.tsx:185-189`) — the new field is free to consume, no new fetch/RPC/edge.
- **Scoped per-mount behavior via an explicit prop** → mirror `OrderForm`'s `allowOfflineRecord` prop (`OrderForm.tsx:52-60`), NOT `initialSymbol` (which the `/trader` symbol page also passes, `page.tsx:342`).
- **Frontend fixtures (C-12/C-13)** → `services/xstockstrat-ui/e2e/fixtures/` + `INVENTORY.md`; opportunity/order fixtures already exist for the Signal-detail e2e (`e2e/trader/…`, `e2e/mock-backend.ts`). Extend, don't inline.

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-1..@AC-13` "Watchlist & Opportunities signal cues" (`services/xstockstrat-ui/acceptance/watchlist-opportunity-signal-cues.feature`, feature 155) — 110 adds a field + a ticket affordance; it must not alter cue coding, the ordinal-conviction render ("N/M conditions"/strength bars), or the queue.
- **PRESERVE** `@AC-8` "Signal-sourced entries render a provenance badge" (`services/xstockstrat-ui/acceptance/consolidate-watchlist-signal.feature`, feature 127).
- **PRESERVE** opportunity-queue ranking/muted guarantees (analysis features 097/131/132/134) — the new field is post-ranking, does not enter `ORDER BY` (`opportunities.py:114`).
- No durable **position-sizing** acceptance suite exists in `services/xstockstrat-trading/acceptance/` (023's scenarios were not promoted / were archived) — the `qty<=0`+confidence contract is guarded only by trading's own unit tests; 110 adds no trading code, so nothing to preserve there beyond the proto contract.

## Dependencies

- **Proto/RPC**: additive field on `analysis.Opportunity` (`packages/proto/analysis/v1/analysis.proto`). Current max `muted = 12`; **feature 095 (design-approved) pre-assigns fields 13-18** (`live_price=13`, `change_pct=14`, `target_price=15`, `stop_price=16`, `sparkline=17`, `conditions=18` — confirmed in `095/design.md:47-52`). **→ 110's field lands at 19.** No `ingest`/`trading` proto change. `buf breaking` is additive-clean either way but 095 must land first (per-branch `buf breaking` can't see the other's uncommitted claim — `merge-order.md` row: **110 blocked by 095**).
- **Migration**: only if the value needs a new `analysis.opportunities` column. Preferred: ride existing JSONB (mirror how `muted`/provenance are carried, feature 132) → **no migration, no DBA gate**. A new column is the fallback (DBA + service-owner gate, C-07). Resolve at `/sdd-spec`.
- **Config keys**: none.
- **Inter-service edges**: none new. analysis→ingest `QuerySignals` already exists (`servicer.py:3580`); ui→analysis `ListOpportunities` already consumed by the page.
- **New env vars / ports**: none.

## Risks / Not-found

- **SPEC-vs-CODE DISCREPANCY (must resolve in design):** product-spec FR-2/FR-3 name
  `services/xstockstrat-ui/src/components/insights/SignalOrderTicket.tsx` as the surface, but that
  component is **orphaned** — referenced only by comments (`OrderForm.tsx:71`,
  `e2e/trader/offline-accounts.spec.ts:265`), imported by no page. Feature 125 superseded the
  insights signal-detail route (`insights/market/[symbol]` is now a redirect stub) and the **live**
  signal-detail order ticket is `OrderForm` rendered at `trader/positions/[symbol]/page.tsx:342`.
  Wiring `SignalOrderTicket.tsx` would ship a C-14 miss (backend wired, real consumer stale — the
  exact 056/060 failure). The real consumer surface is the `page.tsx:342` render site.
- **NaN-qty trap:** `parseFloat('')` = `NaN`, and Go's `NaN <= 0` is **false** (`trading.go:457`) — a
  blank qty sent as `NaN` would NOT trigger auto-sizing and would reach the broker as a NaN qty. Any
  blank-qty affordance must coerce blank → `0` so `req.Qty <= 0` reliably fires (AC-3).
- **Conviction-vs-ordinal-vs-signal_axis (THREE semantics, `fails.md` 2026-08-05/023 & 028):**
  `Opportunity.conviction=3` = ordinal (NOT a probability); `signal_axis` = decayed × source-weighted
  max (`servicer.py:3251,3274`); `ExternalSignal.conviction` = the raw 0.0–1.0 confidence. Only the
  **raw** value (`_best_sig_conv`) is correct for sizing — `signal_axis` is a wrong-but-plausible
  third candidate (already decayed/weighted, not the 0.0–1.0 the AC scenarios assert).
- **Absent-confidence footgun:** a held/watchlist-only or off-queue symbol has no signal → the field
  is unset. Offering blank-qty then would silently default confidence to 1.0 (full risk) — 023's own
  rejected footgun. The affordance must be gated on a present, finite, in-[0,1] confidence.
- **Range/validity (`fails`/`insights` 094):** `ExternalSignal.conviction` is DB-guarded 0.0–1.0 at
  ingest and re-validated at `trading.go:487`. UI should still only attach a `Number.isFinite`,
  in-[0,1] value (belt-and-suspenders).

## Recommended Scope

Advisory (input to grilling + `/sdd-spec`):
1. **proto** — add `optional double signal_confidence = 19;` to `analysis.Opportunity` (name TBD at gate); `buf-gen`.
2. **analysis** — surface `_best_sig_conv` (max raw conviction; unset when no signal) onto the returned `Opportunity`; carry through materialize→read (JSONB-ride preferred, no migration).
3. **ui/OrderForm** — add a scoped prop (e.g. `signalConfidence?: number`) enabling: qty optional + blank→0, attach `confidence`, helper affordance; gated on a finite in-[0,1] value.
4. **ui/signal-detail render site** — pass the matched `Opportunity.signal_confidence` into `OrderForm` at `trader/positions/[symbol]/page.tsx:342`; decide the fate of the orphaned `SignalOrderTicket.tsx`.
5. **tests** — analysis unit (max-raw selection, unset-when-absent), Playwright e2e on the signal-detail page (blank→auto-size, explicit-qty override, plain-form unchanged).

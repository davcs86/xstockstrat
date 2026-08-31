# Context: opportunity-live-market-enrichment

**Feature**: `docs/roadmap/features/095-opportunity-live-market-enrichment/feature.md`
**Product Spec**: `docs/roadmap/features/095-opportunity-live-market-enrichment/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/095-opportunity-live-market-enrichment/implementation-spec.md` _(not yet generated)_

---

## Session 2026-08-02 — sdd-story

- Created `feature.md` (status: `draft`), `product-spec.md`, and this `context.md` from a follow-up
  story: fill the backend gaps **and** the UI for the Nocturne handoff extras that feature 083
  intentionally left un-faked.
- **Origin.** During the 083 fidelity pass that raised the single Opportunity (Signal detail) and
  single Position detail pages, several handoff elements were omitted because **no current RPC returns
  them** and 083's no-fabrication rule forbids synthesizing them: live price/change, price sparkline,
  per-condition value chips on the queue, target/stop chart overlays, and R:R + share sizing on the
  ticket. This feature is the backlog item to close those gaps (backend RPC/proto + the UI that
  consumes them). See 083 `context.md` § "No-fabrication constraint honored" and the two-detail-page PR.
- **Scope framing.** Additive-only backend (new `Opportunity`/`SymbolReadiness` proto fields sourced
  from marketdata quotes/bars; no schema change) + the UI wiring on `insights/opportunities` and
  `insights/market/[symbol]`. Streaming price push, ranking-math changes, and broker bracket/OCO
  orders are explicitly out of scope.

### Governance inputs read at story boot

- **reviewer-registry.md** — affected owners: `xstockstrat-analysis` (aggregation + no-look-ahead),
  `xstockstrat-marketdata` (quote/bars read), `xstockstrat-ui` (consumer), `packages/proto` (additive
  fields) + Platform Lead (edge) + Proto Reviewer; portfolio/indicators FYI. Snapshot provisional —
  finalized at `/sdd-spec`.
- **fails.md traps surfaced** (to design out, per P-05):
  - **056 → C-10(b):** live price/change appears on both the queue card and the Signal-detail header —
    it must be surfaced by the *same* field from the *one* marketdata source, with a cross-surface
    parity test (FR-7 / AC-2). Do not enrich one read path only.
  - **067 → C-10(a/d):** appending a proto **enum** value hard-couples to the exhaustive TS
    `Record<Enum,…>` maps in `opportunityShared.tsx`. This feature adds **fields**, not enum values, so
    it should not fire — but if a new enum sneaks in, update the map in the same PR. Captured in the
    Proto section.
  - **067 → P-03:** `MessageToDict` rejects `NaN`/`Inf` in a `Struct`; model sparkline warm-up/absent
    points as `null`, not `NaN`. Captured in Open Questions.
  - **080/082 → absence-claim:** the "analysis→marketdata edge / latest-quote RPC already exists"
    claim must be grep-verified end-to-end (BFF route + browser client + mock), not from advertised
    proto alone, at the design gate. Captured in Open Questions.
  - **analysis owner review focus → no look-ahead:** folding a live quote into the Decide surface must
    not leak future data into conviction/readiness (AC-7); hot backtest path stays frozen.

### Next

- `/sdd-review opportunity-live-market-enrichment product-spec` (product-spec gate), then
  `/sdd-design opportunity-live-market-enrichment` (recon should resolve the Open Questions:
  target/stop source, existing latest-quote read, per-condition chip source, sizing location,
  sparkline payload shape).

## Session 2026-08-31 — sdd-story (in-place regenerate)

- Regenerated `product-spec.md` to the current template (sections reordered; added an explicit
  `## Consumer Surface(s)` C-14 block naming the Decide / Signal-detail / order-ticket surfaces) and
  authored `acceptance.feature` (14 `@AC-*` scenarios, every FR-1..FR-7 covered by ≥1 `@FR-*` tag).
  Feature **number 095 kept** — no new directory, no renumber; status stays `draft`.
- **All 083 scope preserved.** This remains the follow-on that fills the backend gaps + the UI for
  the Nocturne handoff extras feature 083 deliberately left un-faked; the inherited **no-fabrication
  rule** (FR-6) is enforced as concrete graceful-degradation scenarios (quote unavailable → price
  omitted not synthesized; sparkline gap → `null` not `NaN`; absent target/stop → no line, not a zero
  line; off-queue symbol → symbol+price-only header).
- **Ledger traps folded into Open Questions as one-line "Known trap" notes:** latest-quote RPC
  existence is an absence claim, grep-verify end-to-end (fails 080/082); sparkline gaps as `null` not
  `NaN` because `MessageToDict` rejects non-finite (fails 067 / P-03); same-field cross-surface price
  parity with a parity test (fails 056 / C-10(b)); no-look-ahead when folding the live quote into
  ranking (analysis owner focus, AC-14).
- **Next:** `/sdd-review opportunity-live-market-enrichment product-spec`, then `/sdd-design`.

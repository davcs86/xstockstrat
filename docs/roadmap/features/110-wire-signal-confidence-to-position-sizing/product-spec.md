# Product Spec: wire-signal-confidence-to-position-sizing

**Created**: 2026-08-05

---

## Problem Statement

Feature 023 (position-sizing-engine, now `launched`) added an `optional double confidence = 16`
field to `PlaceOrderRequest` so FR-2's confidence-scaling formula (`quantity = floor((equity ×
max_risk_pct × confidence) / (atr_multiplier × ATR))`) can size a position down for a lower-conviction
signal. But 023's own design debate (round 5) found no real caller can populate that field today: the
trader UI's manual order form has no signal-confidence concept, the agent has no order-placement tool,
and the one UI value already visible near an order ticket — `Opportunity.conviction` — is explicitly
documented in its own proto comment as "a deterministic ordinal... **NOT a probability**", making it a
plausible-looking but semantically wrong stand-in for "signal confidence". Without this feature,
`confidence` is dead wire capability: it defaults to `1.0` (full risk) on every auto-sized order
regardless of actual signal quality, silently defeating the P0 live-capital-safety review's stated
intent for 023's FR-2. This feature makes 023's `confidence` field reachable by a real caller by
threading the true `ExternalSignal.conviction` through to the signal-detail order ticket.

## User Story

As a trader viewing a signal's detail page, I want the position-sizing engine to size my auto-sized
order using that signal's real confidence score, so that a lower-conviction signal results in a
smaller position and a higher-conviction one in a larger position, matching the platform's stated
risk-scaling promise.

## Functional Requirements

FR-1. `ExternalSignal.conviction` (`packages/proto/ingest/v1/ingest.proto:110`, "0.0–1.0 confidence",
DB-validated range) is threaded from `xstockstrat-ingest` through to wherever the signal-order-ticket
UI can read it — either as a distinct field alongside `xstockstrat-analysis`'s existing
`Opportunity.conviction` ordinal (not blended into it — the two must stay separately readable) or via
a direct read path. Exact mechanism (new `Opportunity` field vs. a separate signal-detail RPC) is a
design decision, not resolved here.

FR-2. The **live** order ticket — `OrderForm` as mounted on the unified symbol page
(`services/xstockstrat-ui/src/app/trader/positions/[symbol]/page.tsx:342`, feature 125) — gains a
scoped blank-qty affordance driven by a new `signalConfidence` prop: when a finite in-[0,1] confidence
is supplied, the qty field drops `required`, a blank qty is coerced to `0` on submit (NOT
`parseFloat('')` = `NaN`), and the real signal confidence is attached, triggering 023's `qty <= 0`
auto-sizing path. (The product-spec originally named `SignalOrderTicket.tsx`; that component is
orphaned dead code superseded by feature 125 — retargeted here, and deleted in-scope per FR-6.)

FR-3. The plain `/trader` (`trader/page.tsx`) and `/trader/orders` (`trader/orders/page.tsx`) order
forms are explicitly **not** changed by this feature — they mount the **same** `OrderForm` component
**without** the `signalConfidence` prop, so their qty field stays required, exactly as 023 shipped
them (023's own design rejected a global blank-qty change specifically because it would silently
default confidence to `1.0` on the manual form with no UI affordance explaining why). Scoping is by
the explicit prop (mirroring the existing `allowOfflineRecord` precedent, `OrderForm.tsx:52-60`),
**never** keyed on `initialSymbol` — which the `/trader` symbol page also passes.

FR-4. When a trader submits from the symbol-page ticket with qty populated (override mode), the real
confidence value may still be sent but is not consumed by the backend (023's `PlaceOrder` only reads
`confidence` when `qty <= 0`) — no behavior change for explicit-qty orders from this surface either.

FR-5. `## Consumer Surface(s)` names the **real** live `PlaceOrder` caller this feature touches — the
`/trader` unified symbol page's `OrderForm` (`trader/positions/[symbol]/page.tsx:342`) — closing the
C-14 gap 023's design round 5 identified (the product-spec that shipped 023 named only the plain
`/trader` entry forms; the symbol-page ticket is a distinct live `PlaceOrder` caller that 023's own UI
change never touched). The originally-named `SignalOrderTicket` was feature 083's version of this
ticket; feature 125 superseded it with the symbol-page mount and orphaned the old component (FR-6).

FR-6. **Delete the orphaned `SignalOrderTicket.tsx` and its route stub, in-scope for this feature's
PR.** `services/xstockstrat-ui/src/components/insights/SignalOrderTicket.tsx` is dead code — feature
125 unified the signal-detail ticket onto the symbol page and left this component imported by **no**
page (verified: zero importers; the only remaining source reference is a stale doc-comment at
`OrderForm.tsx:71`). Its former route `services/xstockstrat-ui/src/app/insights/market/[symbol]/page.tsx`
is now a redirect-only stub (→ `/trader/positions/[symbol]`, feature 125). Remove both files and the
stale comment reference in 110's PR. The e2e specs that assert the old redirect
(`e2e/nav-reachability.spec.ts:122`, `e2e/trader/offline-accounts.spec.ts:266` — both `page.goto('/insights/market/AAPL')`)
must be updated in the same PR, since the route ceases to exist.

## Out of Scope

- Any change to the plain `/trader` or `/trader/orders` order forms (FR-3) — deliberately excluded per
  023's design debate's safety finding.
- An agent MCP order-placement tool that could also supply confidence — no such tool exists yet
  (`services/xstockstrat-agent/app/tools.py`); wiring one is a separate, larger feature.
- Changing `Opportunity.conviction`'s existing meaning or its `signal_axis` blend formula
  (`services/xstockstrat-analysis/app/repositories/opportunities.py:114`) — that ordinal keeps serving
  its existing UI purpose (strength bars, "N/M conditions") unchanged; this feature adds a parallel,
  distinct confidence value, it does not repurpose the existing one.

## Affected Services

Exact service names from CLAUDE.md Service Registry:

- `xstockstrat-analysis` — threads `ExternalSignal.conviction` through to a UI-reachable field (FR-1)
- `xstockstrat-ui` — `OrderForm` scoped `signalConfidence` blank-qty affordance on the unified symbol
  page (FR-2, FR-3); delete the orphaned `SignalOrderTicket.tsx` + its `insights/market/[symbol]`
  redirect stub (FR-6)
- `xstockstrat-ingest` — source of `ExternalSignal.conviction`; read-only for this feature, confirm at `/sdd-design`
- `xstockstrat-trading` — consumer only (023 already built the `confidence`-reading logic); confirm no change needed here at `/sdd-design`

**Paper-safe (Constitution C-3):** the confidence-sizing behavior is identical under paper and live and is fully paper-testable — feature 023 owns execution; this feature only populates the `confidence` field.

## Consumer Surface(s)

_Constitution **C-14**._

- [x] **UI** — `/trader` segment: the unified symbol page's `OrderForm`
  (`services/xstockstrat-ui/src/app/trader/positions/[symbol]/page.tsx:342`) gains a scoped blank-qty
  + real-confidence submission path via a `signalConfidence` prop (FR-2). The plain `/trader` and
  `/trader/orders` entry forms mount the same component **without** the prop and are explicitly
  unchanged (FR-3). The orphaned `SignalOrderTicket.tsx` (feature 083's superseded version of this
  ticket) and its `insights/market/[symbol]` redirect stub are deleted in-scope (FR-6).
- [ ] **Agent** — no order-placement tool exists today; out of scope (see Out of Scope).
- [ ] **None**

## Proto Contract Changes

- [ ] No proto changes required
- OR: FR-1 requires a new additive field on `Opportunity`
  (`packages/proto/analysis/v1/analysis.proto`) to carry the real confidence value distinctly from the
  existing ordinal `conviction = 3` field. Resolved at `/sdd-design`:
  **`optional double signal_confidence = 19;`** — additive/non-breaking, the next free number after
  feature 095's 13-18 enrichment block (see the coordination note below; verified against the current
  tree where `Opportunity` maxes at `muted = 12`). Named `signal_confidence` (not `confidence`) to
  stay disambiguated from the `conviction = 3` ordinal and the decayed `signal_axis`. (A separate
  targeted read RPC was the rejected alternative — see `design.md`.)
- **Field-number coordination with feature 095 (`opportunity-live-market-enrichment`).** The
  `analysis.Opportunity` message currently maxes at `muted = 12`; feature 095 pre-assigns its
  live-market enrichment block at fields **13+** (`live_price`, `change_pct`, `target_price`,
  `stop_price`, `risk_reward`, `suggested_qty`, and a sparkline series — all appended after the current
  max). 110's additive `confidence` field must therefore take the **next free field number AFTER 095's
  enrichment block**, not field `13`. Per `docs/roadmap/features/merge-order.md`, **110 is blocked by
  095** for this reason; the exact number is re-derived from the actually-merged tree at
  `/sdd-design`/`/sdd-spec`. Additive/non-breaking either way (`buf breaking` must pass).

## Config Key Changes

- [ ] No new config keys

## Database Changes

- [ ] No schema changes

Confirm at `/sdd-design` — depends on whether `xstockstrat-analysis`'s opportunity computation must
persist the threaded value or can compute it live from the existing `ExternalSignal` read.

## Feature Workflow Notes

Branch to create: `feature/wire-signal-confidence-to-position-sizing` (branch from `main-dev`).

Approval gates required (per `docs/runbooks/feature-workflow.md`):

- [ ] 1 service owner approval (non-breaking proto or config change) — likely applies (additive proto
  field), confirm at `/sdd-design`
- [ ] 2 service owners + platform lead (breaking proto change) — not expected; the proto gate here is
  the **non-breaking** additive path (`buf breaking` must pass)
- [ ] DBA review + service owner (schema migration) — not expected

**Dependency (satisfied):** feature 023 (position-sizing-engine) is `launched`, so the
`PlaceOrderRequest.confidence` field and its `qty <= 0` auto-sizing path already exist in production.
The hard dependency this feature was created around is met — no merge-order blocker remains on 023.

## Acceptance Criteria

Acceptance scenarios are maintained in `acceptance.feature` (Gherkin `@AC-*`), the single source of
acceptance truth (Constitution **C-15**). Each functional requirement above is covered by at least one
`@AC-*` scenario tagged with its `@FR-*`.

## Open Questions

None — moved to Design-Phase Decisions (owned by /sdd-design) and Design Guardrails below.

## Design-Phase Decisions (owned by /sdd-design)

Genuine design-mechanism decisions correctly deferred to `/sdd-design`:

- Whether the real confidence value is a new additive field on `Opportunity`, or is fetched via a
  separate, more targeted RPC (e.g. a small `GetExternalSignal`-shaped read) rather than widening the
  already-large `Opportunity` message.
- Which single signal's conviction (or which aggregation of multiple signals' conviction) the order
  ticket shows/uses when more than one `ExternalSignal` exists for the symbol —
  `ExternalSignal.conviction` is per-source and an opportunity can aggregate multiple signals.
- The exact blank-qty affordance UX on the signal ticket (helper text, a toggle, etc.), following
  023's design.md `allowBlankQty` prop pattern as a starting point and keeping the affordance scoped
  so it cannot leak into the plain `/trader` form (FR-3). Confirm the backend auto-sizing trigger is
  exactly `qty <= 0` (`ComputePositionSize` is 023's sole source of quantity) so a blank ticket qty
  reliably routes into the scaling formula and a populated one does not.

## Design Guardrails

Known traps `/sdd-design` must not re-hit:

- **Conviction-vs-ordinal trap (do not repeat).** `fails.md` 2026-08-05 (023-position-sizing-engine)
  and 2026-08-05 (028-mpt-portfolio-optimization): `Opportunity.conviction` is a deterministic ordinal
  documented "**NOT a probability**"; `ExternalSignal.conviction` is the 0.0–1.0 confidence. They share
  a name and a range but not a meaning — read each candidate field's **doc comment**, not just its name
  and range, before wiring it into a sizing input, and keep the two values separately readable (FR-1).
  The design must state, in prose, which value feeds `confidence` and why the ordinal does not.
- **Multi-signal aggregation trap.** `fails.md` 2026-07-01 (056-open-positions-ui, **C-10(b)**) —
  don't let the chosen per-symbol conviction become a second, silently-diverging notion of "the" signal
  for a symbol; and `fails.md` 2026-07-27/2026-07-29 (072/074/081) — verify the producer's *actual*
  aggregation behavior by reading `xstockstrat-analysis`'s opportunity-ranking code before assuming one
  signal maps 1:1 to an opportunity.
- **Range/validity of the threaded value.** `ExternalSignal.conviction` is guarded to `0.0–1.0` at the
  producer (inverted-range guard, `fails`/`insights` 094); confirm nothing downstream re-derives or
  coerces it so a NaN/out-of-range value cannot reach `confidence`.

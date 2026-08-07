# Product Spec: wire-signal-confidence-to-position-sizing

**Created**: 2026-08-05

---

## Problem Statement

Feature 023 (position-sizing-engine) adds an `optional double confidence = 16` field to
`PlaceOrderRequest` so that FR-2's confidence-scaling formula (`quantity = floor((equity ×
max_risk_pct × confidence) / (atr_multiplier × ATR))`) can size a position down for a lower-
conviction signal. But 023's own design debate (round 5) found no real caller can populate that
field today: the trader UI's manual order form has no signal-confidence concept, the agent has no
order-placement tool, and the one UI value that *is* already visible near an order ticket —
`Opportunity.conviction` — is explicitly documented in its own proto comment as "a deterministic
ordinal... **NOT a probability**," making it a plausible-looking but semantically wrong stand-in for
"signal confidence." Without this feature, `confidence` ships as dead wire capability, defaulting to
`1.0` (full risk) on every auto-sized order regardless of actual signal quality — silently defeating
the P0 live-capital-safety review's stated intent for FR-2.

## User Story

As a trader viewing a signal's detail page, I want the position-sizing engine to size my auto-sized
order using that signal's real confidence score, so that a lower-conviction signal results in a
smaller position and a higher-conviction one in a larger position, matching the platform's stated
risk-scaling promise.

## Functional Requirements

FR-1. `ExternalSignal.conviction` (`packages/proto/ingest/v1/ingest.proto:110`, "0.0–1.0 confidence",
DB-validated range) is threaded from `xstockstrat-ingest` through to wherever the signal-order-ticket
UI can read it — either as a distinct field alongside `xstockstrat-analysis`'s existing `Opportunity.conviction`
ordinal (not blended into it — the two must stay separately readable) or via a direct read path.
Exact mechanism (new `Opportunity` field vs. a separate signal-detail RPC) is a design decision, not
resolved here.

FR-2. `SignalOrderTicket` (`services/xstockstrat-ui/src/components/insights/SignalOrderTicket.tsx`)
gains a scoped blank-qty affordance — distinct from the plain `/trader` order form, which keeps its
required-qty behavior unchanged — that lets a trader submit an order with quantity omitted and the
real signal confidence attached, triggering 023's auto-sizing path.

FR-3. The plain `/trader` and `/trader/orders` order forms are explicitly **not** changed by this
feature — their qty field stays required, exactly as 023 shipped them (023's own design rejected a
global blank-qty change specifically because it would silently default confidence to `1.0` on the
manual form with no UI affordance explaining why).

FR-4. When a trader submits from the signal ticket with qty populated (override mode), the real
confidence value may still be sent but is not consumed by the backend (023's `PlaceOrder` only reads
`confidence` when `qty <= 0`) — no behavior change for explicit-qty orders from this surface either.

FR-5. Add `## Consumer Surface(s)` naming `/insights` (the signal-detail order-ticket flow) explicitly,
closing the C-14 gap 023's design round 5 identified (the product-spec that shipped 023 named only
`/trader`, but `SignalOrderTicket` — added by feature 083 — is a second live `PlaceOrder` caller
that 023's own UI change never touched).

## Out of Scope

- Any change to the plain `/trader` or `/trader/orders` order forms (FR-3) — deliberately excluded per
  023's design debate's safety finding.
- An agent MCP order-placement tool that could also supply confidence — no such tool exists yet
  (`services/xstockstrat-agent/app/tools.py`); wiring one is a separate, larger feature.
- Changing `Opportunity.conviction`'s existing meaning or its `signal_axis` blend formula
  (`services/xstockstrat-analysis/app/repositories/opportunities.py:112`) — that ordinal keeps
  serving its existing UI purpose (strength bars, "N/M conditions") unchanged; this feature adds a
  parallel, distinct confidence value, it does not repurpose the existing one.

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-analysis` — threads `ExternalSignal.conviction` through to a UI-reachable field (FR-1)
- `xstockstrat-ui` — `SignalOrderTicket`/`OrderForm` scoped blank-qty affordance (FR-2, FR-3)
- `xstockstrat-ingest` — source of `ExternalSignal.conviction`; likely read-only for this feature, confirm at `/sdd-design`
- `xstockstrat-trading` — consumer only (023 already built the `confidence`-reading logic); confirm no change needed here at `/sdd-design`

## Consumer Surface(s)

_Constitution **C-14**._

- [x] **UI** — `/insights` segment: the signal-detail page's `SignalOrderTicket` gains a scoped
  blank-qty + real-confidence submission path (FR-2). The plain `/trader` segment is explicitly
  unchanged (FR-3).
- [ ] **Agent** — no order-placement tool exists today; out of scope (see Out of Scope).
- [ ] **None**

## Proto Contract Changes

- [ ] No proto changes required
- OR: FR-1 likely requires a new field on `Opportunity` (`packages/proto/analysis/v1/analysis.proto`)
  to carry the real confidence value distinctly from the existing ordinal `conviction` field — exact
  field number and shape resolved at `/sdd-design`.

## Config Key Changes

- [x] No new config keys

## Database Changes

- [x] No schema changes expected — confirm at `/sdd-design` (depends on whether `xstockstrat-analysis`'s
  opportunity computation needs to persist the threaded value or can compute it live from the existing
  `ExternalSignal` read)

## Feature Workflow Notes

Branch to create: `feature/wire-signal-confidence-to-position-sizing` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [ ] 1 service owner approval (non-breaking proto or config change) — likely applies (additive proto
  field), confirm at `/sdd-design`
- [ ] 2 service owners + platform lead (breaking proto change) — not expected
- [ ] DBA review + service owner (schema migration) — not expected

## Acceptance Criteria

1. A signal with a high `ExternalSignal.conviction` (e.g. 0.9) and a signal with a low one (e.g. 0.3)
   produce visibly different auto-sized quantities for the same symbol/equity/ATR, via the signal
   ticket's blank-qty flow.
2. The plain `/trader` and `/trader/orders` order forms' qty field remains required — unchanged
   behavior, verified by a regression test.
3. Submitting from the signal ticket with an explicit qty (override mode) places the order at that
   exact quantity, confidence value sent but not consumed.
4. `Opportunity.conviction`'s existing value and rendering (strength bars, "N/M conditions") are
   unchanged by this feature.

## Open Questions

- [ ] Should the real confidence value be a new field on `Opportunity`, or should the signal ticket
  fetch it via a separate, more targeted RPC (e.g. a small `GetExternalSignal`-shaped read) rather than
  widening the already-large `Opportunity` message? **Decide at `/sdd-design`.**
- [ ] `ExternalSignal.conviction` is per-source; an opportunity can aggregate multiple signals — which
  signal's (or which aggregation of) conviction does the order ticket show/use when more than one
  signal exists for the symbol? **Decide at `/sdd-design`.** Known trap: `fails.md` 2026-07-01
  (056-open-positions-ui, C-10(b)) — don't let this become a second, silently-diverging notion of
  "the" signal for a symbol; and `fails.md` 2026-07-27/2026-07-29 entries (072/074/081) — verify the
  producer's actual aggregation behavior by reading `xstockstrat-analysis`'s opportunity-ranking code
  before assuming a single signal maps 1:1 to an opportunity.
- [ ] Exact blank-qty affordance UX on the signal ticket (helper text, a toggle, etc.) — **decide at
  `/sdd-design`**, following 023's design.md's `allowBlankQty` prop pattern as a starting point.

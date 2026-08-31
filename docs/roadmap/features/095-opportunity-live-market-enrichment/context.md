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

## Session 2026-08-31 — sdd-review fixes (product-spec)

`/sdd-review product-spec` returned **FAIL (criterion 9)** with warnings. Applied the review fixes
(docs-only, feature 095 dir; number/slug/status `draft` unchanged):

- **Target/stop source (blocker #1, resolved inline in FR-4).** `target_price`/`stop_price` come from
  the opportunity's **originating signal / strategy definition** where present; when **absent they are
  omitted** (no overlay line), never derived or fabricated. No ATR derivation — `xstockstrat-indicators`
  is **out of scope**.
- **R:R + suggested-sizing location (blocker #2, resolved inline in FR-5).** Both are computed
  **client-side in the UI** from already-available values (live price, target, stop, buying power).
  Dropped the `risk_reward` and `suggested_qty` proto fields — **no server fields** carry them.
- **Live price data shape (W2).** The existing `GetLatestQuote`/`Quote` returns **bid/ask only** (no
  last-trade, no prior close), yet the scenarios need a latest **trade** price + **prior close**
  (change% is from prior close). Added an **additive, non-breaking** `xstockstrat-marketdata` change
  (additive `Quote` fields at 8+ or a small latest-trade read RPC — shape at `/sdd-design`) to the
  Proto section and Affected Services.
- **Proto field pre-assignment (W, coordinate with 110).** Pre-assigned a **contiguous `Opportunity`
  enrichment block starting at field 13**: `live_price=13`, `change_pct=14`, `target_price=15`,
  `stop_price=16`, sparkline=17, optional per-condition live-value carrier=18. Note added: **feature
  110 appends its confidence field AFTER this block (next free field, 19+); see merge-order.md (110
  blocked by 095)**. `SymbolReadiness` additive after field 5.
- **AC-14 traceability (W3).** Added a dedicated **FR-8 (no-look-ahead invariant)** and **re-tagged
  AC-14 from `@FR-1` to `@FR-8`** so the no-look-ahead scenario traces to the requirement it actually
  guards. FR-1..FR-7 keep full coverage; FR-1 still covered by AC-1/AC-2/AC-13.
- **Open Questions reorganization (criterion 9).** After resolving the two scope questions inline,
  `## Open Questions` now reads **"None — resolved inline or moved below"** (no unchecked `- [ ]`). The
  latest-quote data-shape decision (now answered by the additive marketdata change) plus the remaining
  mechanism/shape choices (per-condition chip fold-in, sparkline payload shape, SymbolReadiness reuse)
  moved to a new **`## Design-Phase Decisions (owned by /sdd-design)`** section; the three known traps
  (analysis→marketdata edge verify; sparkline `null`-not-`NaN`; cross-surface price parity) moved to a
  new **`## Design Guardrails`** section.
- **Config unchanged in intent:** `analysis.opportunity.sparkline_bars` stays env-overridable (F-07);
  firmed from "possible" to confirmed-in-scope now that the sparkline is `Opportunity` field 17.
- **Next:** re-run `/sdd-review opportunity-live-market-enrichment product-spec` to clear the gate,
  then `/sdd-design`.

## Session 2026-08-31 — sdd-review product-spec (approved)

- Product spec approved: `draft` → `spec-ready`. All `/sdd-review` blockers and warnings were addressed (see the sdd-review-fixes session above).
- NOTE: the confirming re-review pass was interrupted by a session usage/rate limit; fixes were applied against each reviewer's explicit findings. For 021 specifically, the orchestrator manually caught and fixed a residual field-name error (`service_origin` → `source_service`; the ledger `Event` has no `user_id` field). A quick re-review can re-confirm on resume.

## Session 2026-08-31 — sdd-design

- Phase 0 Recon: wrote `recon.md` (services: analysis, marketdata, xstockstrat-ui, packages/proto). Key reuse patterns: read-time enrichment in `ListOpportunities` (`servicer.py:2992-2995`); the `IndicatorValue`/`optional double` null-safe idiom (`servicer.py:2919-2924`); `ConditionEval` verbatim; `SymbolPriceChart`/`priceLinesRef` for overlays.
- Phase 1 Grilling: 2 rounds (full). **Chosen approach:** enrich at READ time (post-ranking, post-`_row_to_opportunity`) so FR-8/AC-14 hold by construction; marketdata gets a small dedicated additive **`GetLatestPrice`** RPC (`optional last_price` + `optional prev_close`), NOT fields on `Quote`; `Opportunity` block **13-18 all explicit-presence**, field 18 = `repeated ConditionEval` from the already-computed trace (queue-card chips), 17 = `SparklinePoint{optional double close}` (gaps as unset, P-03); target/stop from `StrategyDefinition.signal_params.{target,stop}` where present (omit otherwise); R:R + sizing client-side (no server field); `SymbolReadiness` unchanged (Signal-detail header reuses `Opportunity` → same-field parity). **Rejected:** fields on `Quote` (cache-hit fabricated 0 + warm-poller bloat); `repeated double` sparkline (can't model a gap); compute-time enrichment (stale queue → not "live"); `SymbolReadiness` price fields (breaks C-10(b) same-field parity).
- **Absence-claim finding (fails 023/080/082):** target/stop has NO producer today — `ExternalSignal` and `StrategyDefinition` carry no numeric target/stop; fields 15/16 ship as plumbing fed from `signal_params.{target,stop}` (agent-writable) and render nothing until a **named follow-up** authoring feature. Operator confirm required. Also confirmed the Signal-detail surface is `trader/positions/[symbol]` (feature 125), not the `insights/market/[symbol]` redirect stub the spec names.
- Constitution rules touched: C-04, C-10(a/d — does NOT fire), C-10(b), C-14, C-15/C-16, C-03, C-09, C-17, F-04, F-07, P-03, P-06. **Floor breaches: none** (the F-04 target/stop-producer gap is surfaced as an Open Risk, not invented).
- Additive confirmation: `Opportunity` 13-18 and the marketdata `GetLatestPrice` RPC are additive/non-breaking (`buf breaking` green); field numbers 13-18 honored so feature 110 lands at 19+ (merge-order intact).
- Status: `spec-ready` → design-approved **pending** the two operator-confirm items (target/stop producer decision; read-pressure batching). `recon.md` + `design.md` written; `status.md` NOT flipped by this subagent.

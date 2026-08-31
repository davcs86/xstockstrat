# Context: wire-signal-confidence-to-position-sizing

**Feature**: `docs/roadmap/features/110-wire-signal-confidence-to-position-sizing/feature.md`
**Product Spec**: `docs/roadmap/features/110-wire-signal-confidence-to-position-sizing/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/110-wire-signal-confidence-to-position-sizing/implementation-spec.md`

---

## Session 2026-08-05T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md.
- This is a **named C-14 follow-up** from `023-position-sizing-engine`'s design debate (round 5):
  023's design added `PlaceOrderRequest.confidence` but the user explicitly decided to drop all UI
  wiring from 023's own scope (round-5 gate decision: "Drop UI wiring this round, ship backend-only")
  after the design-adversary found (a) `/insights` was an unnamed C-14 surface, (b) `Opportunity.conviction`
  is documented as "NOT a probability" — a semantic mismatch with what `confidence` needs — and
  (c) a global blank-qty UI change would silently max-risk-auto-size orders on the plain `/trader` form.
  This feature exists specifically so that deferral is a **named follow-up**, not a vague "later" (the
  only C-14-compliant form of deferral).
- Hard dependency: `023-position-sizing-engine` must reach at least `design-approved` (its `confidence`
  field must exist) before this feature's `/sdd-design` can proceed meaningfully — recorded as an
  Open Question in product-spec.md, not yet a formal `merge-order.md` entry (added once this feature
  reaches `spec-ready`/`implementation-ready`).

## Session 2026-08-31 — sdd-story (in-place regenerate)

- Regenerated `product-spec.md` to the current C-14/C-15 template (kept feature number 110, status
  stays `draft`); moved the inlined acceptance list into a new `acceptance.feature` with 8 `@AC-*`
  scenarios covering all of FR-1..FR-5 (every FR tagged; conviction-vs-ordinal separation and the
  scoped blank-qty `/insights`-only affordance are explicit scenarios).
- Preserved all prior scope: additive `analysis.Opportunity` field (or targeted read RPC — resolved at
  `/sdd-design`), no config keys, no schema change; `/trader` forms explicitly unchanged (FR-3).
- **023 dependency is now satisfied** — feature 023 (position-sizing-engine) is `launched`, so
  `PlaceOrderRequest.confidence` and its `qty <= 0` auto-sizing path already exist; no merge-order
  blocker remains on 023.
- Note: the regeneration subagent lost its connection before writing this block; the orchestrator
  appended it and verified `product-spec.md` / `acceptance.feature` / `feature.md` were written correctly.

## Session 2026-08-31 — sdd-review fixes (product-spec)

Applied the PASS-WITH-WARNINGS product-spec review fixes (status stays `draft`; no number/slug change):

- **AC-8 reframed to an observable runtime behavior.** It previously asserted product-spec document
  content ("When it is reviewed for C-14 completeness…"), which can't trace to a RED test. Now it
  asserts the runtime outcome — the `/insights` `SignalOrderTicket` sends a `PlaceOrder` request that
  routes into 023's auto-sizing path (`qty <= 0` + real confidence) while the plain `/trader` form's
  blank-qty submit sends **no** `PlaceOrder` and is rejected with "quantity required" (never
  auto-sizes). `@AC-8`/`@FR-5` tags preserved; only `acceptance.feature`'s AC-8 was touched.
- **Open Questions reorganized.** The five `- [ ]` items were split into two new plain-bullet sections:
  `## Design-Phase Decisions (owned by /sdd-design)` (additive-field-vs-targeted-RPC, multi-signal
  conviction selection, blank-qty affordance UX) and `## Design Guardrails` (the conviction-vs-ordinal
  trap, the multi-signal aggregation trap, and range/validity of the threaded value). `## Open
  Questions` now reads "None — moved to Design-Phase Decisions / Design Guardrails below." No unchecked
  genuine-unknown `- [ ]` remains under `## Open Questions`.
- **Paper-safe note (Constitution C-3).** Added a line under Affected Services: confidence-sizing
  behavior is identical under paper and live and is fully paper-testable — 023 owns execution, this
  feature only populates the `confidence` field.
- **Citation fix.** Out-of-Scope `signal_axis` blend-formula reference corrected
  `opportunities.py:112` → `:114` (verified against the current file — the `ORDER BY ((1 - $3) *
  o.conviction + $3 * o.signal_axis)` line is 114).
- **Proto field coordination with 095.** Added a Proto Contract Changes note: `analysis.Opportunity`
  currently maxes at `muted = 12`; feature 095 pre-assigns its enrichment block at fields 13+, so 110's
  additive `confidence` field must take the next free number **after** 095's block (not 13). Recorded
  as **110 blocked by 095** per `merge-order.md`; exact number re-derived at `/sdd-design`/`/sdd-spec`.
  Additive/non-breaking.

All FRs, `@FR-*`/`@AC-*` tags, and FR→AC coverage preserved.

## Session 2026-08-31 — sdd-review product-spec (approved)

- Product spec approved: `draft` → `spec-ready`. All `/sdd-review` blockers and warnings were addressed (see the sdd-review-fixes session above).
- NOTE: the confirming re-review pass was interrupted by a session usage/rate limit; fixes were applied against each reviewer's explicit findings. For 021 specifically, the orchestrator manually caught and fixed a residual field-name error (`service_origin` → `source_service`; the ledger `Event` has no `user_id` field). A quick re-review can re-confirm on resume.

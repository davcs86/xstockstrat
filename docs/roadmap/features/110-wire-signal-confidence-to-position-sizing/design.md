# Design: wire-signal-confidence-to-position-sizing

**Created**: 2026-08-31
**Rounds**: 2 (full; termination: approved — the two operator confirmations are now resolved below)
**Approved by**: operator @ 2026-08-31 — OR-1 (delete the orphan in-scope) and OR-2 (field name
`signal_confidence`) confirmed; OR-3/OR-4 remain for `/sdd-spec`
**Grounded in**: recon.md

---

## Chosen Approach

Thread the **raw per-signal `ExternalSignal.conviction`** to the live signal-detail order ticket via a
**new additive field on `analysis.Opportunity`**, and give **only** that ticket a scoped blank-qty
affordance that routes into feature 023's `qty <= 0` auto-sizing path. Four moving parts:

**1. Proto — new additive field at 19 (post-095).** Add `optional double signal_confidence = 19;` to
`analysis.Opportunity` (`analysis.proto:542-555`; current max `muted = 12`, feature 095 pre-assigns
13-18 per `095/design.md:47-52`, so **19 is the next free number** — confirmed against the merge-order
row "110 blocked by 095"). Explicit-presence `optional` (mirrors 095's 13/14/15/16) so "no signal for
this symbol" is a genuine unset, never a fabricated 0.0 (P-03). **Named `signal_confidence`, not
`confidence`** — deliberately distinct from both the sibling ordinal `conviction = 3` ("NOT a
probability", `analysis.proto:539-546`) and the decayed `signal_axis`, so no future reader repeats the
2026-08-05/023 name-collision trap. Additive → `buf breaking` clean; 095 lands first (per-branch
`buf breaking` can't see 095's uncommitted 13-18).

**2. Analysis — populate it from the existing max-raw-conviction reducer.** `_compute_opportunities`
already tracks `c["_best_sig_conv"]` = **max raw `sig.conviction`** across the symbol's active signals
(`servicer.py:3140,3275-3276`), used today for thesis/direction — the platform's already-established
"the raw conviction for this symbol". Surface **that value** onto the returned `Opportunity`
(`_best_sig_conv >= 0` → set `signal_confidence`; the `-1.0` sentinel / no-signal → leave unset). This
is the **multi-signal selection rule: max raw conviction among the symbol's active signals**, reusing
the reducer the queue already computes so no second, silently-diverging notion of "the signal" is
created (C-10(b); `fails.md` 2026-07-01/056). Explicitly **not** `signal_axis` (decayed × source-
weighted, `servicer.py:3251,3274`) and **not** the `conviction=3` ordinal. Persistence across the
materialize→read round trip rides existing JSONB (mirror feature 132's `muted`/provenance carry) to
avoid a migration; a nullable `analysis.opportunities` column is the fallback if `/sdd-spec` finds the
JSONB path impractical (that fallback re-opens the C-07 + DBA gate).

**3. UI `OrderForm` — a scoped confidence/blank-qty prop.** Add an explicit prop
(`signalConfidence?: number`) to `OrderForm` (`OrderForm.tsx`). When it is a **finite value in
[0,1]**: (a) the qty `<Input>` drops `required`; (b) a blank qty is coerced to `0` on submit (NOT
`parseFloat('')` = `NaN` — Go's `NaN <= 0` is false, so NaN would bypass sizing and reach the broker,
recon Risk "NaN-qty"); (c) `confidence: signalConfidence` is attached to the `placeOrder` request; (d)
a helper affordance ("Leave quantity blank to auto-size at NN% confidence") explains the behavior.
When the prop is **absent or not finite-in-[0,1]**, `OrderForm` is byte-identical to today — qty stays
`required`, no `confidence` sent. Scoping is by this explicit prop, mirroring the existing
`allowOfflineRecord` precedent (`OrderForm.tsx:52-60`), **never** keyed on `initialSymbol` (which the
`/trader` symbol page also passes). This keeps the plain `/trader` (`trader/page.tsx:32`) and
`/trader/orders` (`trader/orders/page.tsx:51`) `<OrderForm mode={mode} />` mounts unchanged (FR-3,
AC-5/AC-6).

**4. Consumer surface (C-14) — the live signal-detail render site.** The real, user-reachable ticket
is `OrderForm` at `trader/positions/[symbol]/page.tsx:342`, on a page that **already** reads the
symbol's `Opportunity` (`useOpportunities(0)` → `symbolOpportunities`, `page.tsx:185-189`). Pass the
matched opportunity's `signal_confidence` (finite in-[0,1], else undefined) into the new prop there.
The affordance appears only when a real signal confidence is present — a held/watchlist-only or
off-queue symbol (no signal) shows the ordinary required-qty ticket, never a silent full-risk
auto-size (023's own rejected footgun).

**5. Delete the orphan in-scope (operator-confirmed, OR-1).** The product-spec-named
`SignalOrderTicket.tsx` (`services/xstockstrat-ui/src/components/insights/SignalOrderTicket.tsx`) is
**orphaned dead code** — feature 125 superseded it; verified imported by **no** page (the only
remaining source reference is a stale doc-comment at `OrderForm.tsx:71`). Its former route
`insights/market/[symbol]/page.tsx` is now a **redirect-only stub** (→ `/trader/positions/[symbol]`).
Per the 2026-08-31 operator decision, **both files are removed** in this feature's PR (FR-6/AC-9),
along with the stale `OrderForm.tsx:71` comment. The redirect is currently e2e-asserted
(`e2e/nav-reachability.spec.ts:122`, `e2e/trader/offline-accounts.spec.ts:266`), so those two specs
are updated in the same PR (see OR-1).

**Ingest** (source) and **trading** (023's consumer at `trading.go:457-490`) need **no code change** —
confirmed at recon. Net code footprint: proto (1 field), analysis (surface one already-computed
value), UI (`OrderForm` prop + one render-site wiring, plus deleting the orphan + stub + updating its
two e2e specs). Deliberately minimal (behavior #2).

## Rejected Alternatives

- **Wire `Opportunity.conviction` (the ordinal) as confidence** — rejected: doc-commented "NOT a
  probability" (`analysis.proto:539-546`); the exact 2026-08-05/023 & /028 trap. Name+range match, meaning does not.
- **Wire `signal_axis` as confidence** — rejected: it is `raw × source_weight × decay_multiplier`
  (`servicer.py:3251`), a decayed/weighted third semantic, not the 0.0–1.0 the AC scenarios assert
  (AC-2/AC-3/AC-4 use raw values verbatim). A subtler instance of the same name/plausibility trap.
- **A targeted read RPC (e.g. `GetSignalConfidence`)** instead of an `Opportunity` field — rejected:
  a new edge + a second source for "the signal" (C-10(b)); the signal-detail page already fetches the
  `Opportunity`, so a field is zero-new-fetch and reuses 095's established enrichment pattern.
- **Reuse the product-spec-named `SignalOrderTicket.tsx`** — rejected: orphaned since feature 125;
  modifying it reaches no user (a C-14 miss — the 056/060 failure shape). Wire the live render site,
  and delete the orphan + its redirect stub in-scope (OR-1, FR-6).
- **Scope the affordance on `initialSymbol`** — rejected: the `/trader` positions symbol page passes
  `initialSymbol` too (`page.tsx:342`), so it cannot distinguish the signal-detail mount; would leak
  blank-qty into a non-signal ticket (FR-3 breach). Use an explicit prop.
- **Blank-qty as a global `OrderForm` default** — rejected by 023's own design + FR-3: silently
  max-risk auto-sizes the plain manual form with no explaining affordance.
- **New `analysis.opportunities` column (migration) as the default** — deferred to fallback: prefer
  the no-migration JSONB carry (feature-132 precedent) to avoid the C-07 + DBA gate for one scalar.

## Open Risks

- [x] **OR-1 (RESOLVED — operator confirmed 2026-08-31: delete in-scope).** Design wires the **live**
  surface (`OrderForm` @ `trader/positions/[symbol]/page.tsx:342`), not the product-spec-named orphan.
  The dead `SignalOrderTicket.tsx` (zero importers — verified; only a stale `OrderForm.tsx:71`
  doc-comment remains) **and** its redirect-only route stub `insights/market/[symbol]/page.tsx`
  (→ `/trader/positions/[symbol]`) are **removed in this feature's PR** (FR-6/AC-9), along with the
  stale comment. **Test coupling handled in the same PR:** the redirect is currently e2e-asserted —
  `e2e/nav-reachability.spec.ts:122` and `e2e/trader/offline-accounts.spec.ts:266` both
  `page.goto('/insights/market/AAPL')`; both are updated when the route is deleted so the suite stays
  green. Old `/insights/market/[symbol]` deep links will 404 after removal — acceptable per the
  operator decision (feature 125 already reduced the route to a stub, and no live nav links there).
- [x] **OR-2 (RESOLVED — operator confirmed 2026-08-31: `signal_confidence`).** Field name
  `signal_confidence` (not `confidence`) for disambiguation from the `conviction=3` ordinal and the
  decayed `signal_axis`; field number **19** (next free after 095's 13-18; verified `Opportunity`
  maxes at `muted = 12`). Re-verify next-free from the merged tree at the proto step (see OR-4).
- [ ] **OR-3 — persistence mechanism (JSONB-ride vs new column).** Prefer JSONB (no migration);
  `/sdd-spec` verifies the materialize→read carry is feasible without a column. If a column is needed,
  the C-07 migration + DBA gate re-open. To be resolved at `/sdd-spec` / the analysis step.
- [ ] **OR-4 — 095 must land first.** 110 re-derives the next-free `Opportunity` field number from the
  merged tree at `/sdd-spec` (expected 19); if 095's block grows, 110 takes next-free after it. Both
  run in one `/sdd-execute … sequential` cohort (merge-order). To be verified at `/sdd-spec`.

## Constitution Rules Touched

- `C-01` / `F-04` — every `path:line` in recon/design is grep-verified; no invented symbol. Honored.
- `C-04` — no new enum (a `double` field); existing `_UNSPECIFIED` enums untouched. Honored.
- `C-09` / `P-06` — additive proto field 19: `buf lint` + `buf breaking` green; run `./scripts/buf-gen.sh`; red-before-green on the analysis + e2e steps. Honored.
- `C-10(b)` — no second divergent "the signal" notion: reuses the existing `_best_sig_conv` reducer (`servicer.py:3275`). Honored.
- `C-14` — names and reaches the **real** consumer surface (`trader/positions/[symbol]/page.tsx:342`), not the orphaned component; the orphan (`SignalOrderTicket.tsx`) **and** its redirect stub are deleted in-scope (FR-6) so no dead second surface lingers to be mistaken for a live one; plain `/trader` entry forms explicitly unchanged (FR-3). Honored.
- `C-15` / `C-16` — every FR-1..**FR-6** covered by ≥1 `@AC-*` (FR-6 → **AC-9**, the orphan-removal scenario); existing opportunity/cue guarantees (`watchlist-opportunity-signal-cues.feature`, `consolidate-watchlist-signal.feature`) preserved (post-ranking field, no cue/ordinal change; deleting orphaned dead code regresses no live behavior). Honored.
- `C-17` — the affordance uses existing `ui/*` primitives (`Input`/helper text) + design-role tokens, no hardcoded color, unique accessible name. Honored at the UI step.
- `C-07` / `F-01` — no migration on the preferred path (JSONB-ride); the column fallback would add a **new** numbered migration only (never edits an applied one). Honored.
- `F-07` — no hardcoded config value; no new config key introduced. Honored.
- `P-03` — absent confidence modeled as explicit-presence unset (not `NaN`/`0`); blank qty coerced to a real `0`; UI attaches only a finite in-[0,1] value; backend re-guards `[0,1]` → InvalidArgument (`trading.go:487`). Honored.

**Floor status:** no unresolved `F-*` breach. `F-04`, `F-07`, `F-01` all honored on the chosen path.

## Business Rules Touched (C-16)

- PRESERVE `@AC-1..@AC-13` "Watchlist & Opportunities signal cues" (`services/xstockstrat-ui/acceptance/watchlist-opportunity-signal-cues.feature`) — not regressed: adds a field + a ticket affordance; cue coding, ordinal render, and the queue are untouched.
- PRESERVE `@AC-8` "Signal-sourced entries render a provenance badge" (`services/xstockstrat-ui/acceptance/consolidate-watchlist-signal.feature`) — not regressed.
- PRESERVE opportunity-queue ranking/muted guarantees (analysis 097/131/132/134) — the new field is post-ranking, absent from `ORDER BY` (`opportunities.py:114`).
- EXTEND — net-new behavior (per-signal confidence on the ticket + scoped blank-qty auto-size); promoted into a durable suite at launch (C-16). Deleting the orphaned `SignalOrderTicket.tsx` + its redirect stub (FR-6) removes only dead code reachable by no live surface, so it regresses no business rule; the two e2e specs that asserted the old redirect are updated in the same PR. No existing rule is **changed**, so no sign-off required on that axis.

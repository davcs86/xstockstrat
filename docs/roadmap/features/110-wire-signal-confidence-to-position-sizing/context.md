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

## Session 2026-08-31 — sdd-design

- Phase 0 Recon: wrote `recon.md` (services: analysis, ui; ingest read-only; trading unchanged). Key
  reuse patterns: the existing max-raw-conviction reducer `c["_best_sig_conv"]`
  (`servicer.py:3140,3275-3276`); feature 095's additive-`Opportunity` enrichment pattern (explicit-
  presence, omit-not-fabricate); `OrderForm`'s `allowOfflineRecord`-style explicit scoped prop.
- **Confirmed field number:** `analysis.Opportunity` max today is `muted = 12`; feature 095
  (design-approved) pre-assigns 13-18 (`095/design.md:47-52`), so **110's additive field lands at 19**
  (`signal_confidence`). Re-derive next-free from the merged tree at `/sdd-spec` (095 lands first;
  merge-order "110 blocked by 095").
- Phase 1 Grilling: 2 rounds (full). **Chosen approach:** new `optional double signal_confidence = 19`
  on `Opportunity`, populated from the raw max-conviction reducer (multi-signal rule = max raw
  `ExternalSignal.conviction` among the symbol's active signals), consumed by the **live** signal-detail
  ticket (`OrderForm` @ `trader/positions/[symbol]/page.tsx:342`) via a scoped `signalConfidence` prop
  that enables blank-qty→0 + attaches `confidence`, gated on a finite in-[0,1] value; plain `/trader`
  forms unchanged. **Rejected:** the ordinal `conviction=3` and the decayed `signal_axis` as the source
  (conviction-vs-ordinal-vs-signal_axis trap, `fails.md` 2026-08-05); a targeted read RPC (C-10(b)
  second source); wiring the orphaned `SignalOrderTicket.tsx` (C-14 miss — feature 125 superseded it).
- **Recon discrepancy flagged:** product-spec FR-2/FR-3 name `SignalOrderTicket.tsx`, which is orphaned
  dead code (imported by no page; `insights/market/[symbol]` is a redirect stub since feature 125). The
  real consumer surface is `OrderForm` at `trader/positions/[symbol]/page.tsx:342` — design retargets
  there (C-14).
- **NaN-qty guard:** blank qty must be coerced to `0` (not `parseFloat('')`=`NaN`; Go's `NaN<=0` is
  false, so NaN would bypass `qty<=0` sizing and reach the broker).
- Constitution rules touched: C-01/F-04, C-04, C-09/P-06, C-10(b), C-14, C-15/C-16, C-17, C-07/F-01,
  F-07, P-03. Floor breaches: none (all honored on the chosen no-migration path).
- **Open operator confirms:** OR-1 (delete the orphaned `SignalOrderTicket.tsx` in-scope, or leave it?),
  OR-2 (field name `signal_confidence` vs `confidence`), OR-3 (JSONB-ride vs new column — `/sdd-spec`),
  OR-4 (095 lands first; re-derive field 19 from merged tree).
- Status: `spec-ready` → design-approved (status flip left to the orchestrator; this subagent did not
  modify `status.md`).

## Session 2026-08-31 — design revision (operator decision: retarget + delete orphan in-scope)

Confirmed operator decision applied to `product-spec.md`, `acceptance.feature`, and `design.md`
(no code, no `status.md` change). Two prongs:

- **(1) Retarget the affordance to the live surface.** The blank-qty + signal-confidence affordance
  targets `OrderForm` as mounted on feature 125's unified symbol page
  (`services/xstockstrat-ui/src/app/trader/positions/[symbol]/page.tsx:342`), via a scoped
  `signalConfidence` prop (finite-in-[0,1] gate → drops `required`, coerces blank qty to `0` — NOT
  `NaN` — attaches `confidence`, enabling 023's `qty<=0` auto-sizing). The plain `/trader`
  (`trader/page.tsx`) and `/trader/orders` (`trader/orders/page.tsx`) entry forms mount the same
  component **without** the prop and are unchanged (FR-3); scoping is by prop presence, mirroring the
  `allowOfflineRecord` precedent, never keyed on `initialSymbol`. Proto field unchanged from design:
  additive `optional double signal_confidence = 19;` on `analysis.Opportunity` (next free after 095's
  13-18; verified current max is `muted = 12`, `analysis.proto:554`), populated from the existing
  max-raw-`ExternalSignal.conviction` reducer — kept separate from the `conviction = 3` ordinal and
  `signal_axis`.

- **(2) Delete the orphan in-scope (OR-1 resolved).** Verified `SignalOrderTicket.tsx`
  (`services/xstockstrat-ui/src/components/insights/SignalOrderTicket.tsx`) has **zero importers** —
  a repo-wide grep for `import ... SignalOrderTicket` returns none; the only source references are its
  own definition and a stale doc-comment at `OrderForm.tsx:71`. Its former route
  `insights/market/[symbol]/page.tsx` is a **redirect-only stub** (→ `/trader/positions/${symbol}`,
  feature 125), with no live `<Link>`/navigation pointing at it. Both are deleted in 110's PR
  (new FR-6 / AC-9). **Test coupling flagged:** the redirect is currently e2e-asserted at
  `e2e/nav-reachability.spec.ts:122` and `e2e/trader/offline-accounts.spec.ts:266` (both
  `page.goto('/insights/market/AAPL')`) — those two specs must be updated in the same PR when the route
  is removed. Old `/insights/market/[symbol]` deep links will 404 after removal (acceptable per the
  operator decision).

- **OR-2 resolved:** field name `signal_confidence` (not `confidence`), number 19. OR-3 (JSONB-ride vs
  new column) and OR-4 (re-derive next-free field from the merged tree; 095 lands first) remain for
  `/sdd-spec`.

- **Artifacts touched:** `product-spec.md` (FR-2/FR-3/FR-4/FR-5 retargeted to the symbol-page
  `OrderForm`; new FR-6; `## Consumer Surface(s)` → `/trader` symbol page; Affected Services + Proto
  Contract Changes updated to the confirmed field 19 / `signal_confidence`); `acceptance.feature`
  (AC-1..AC-8 retargeted off `SignalOrderTicket`/`/insights` onto the symbol-page `OrderForm`; new
  AC-9 @FR-6 asserts the orphan + stub are gone and nothing imports the component; all @AC/@FR tags +
  FR→AC coverage preserved); `design.md` (Chosen Approach part 5 = in-scope deletion; header/Rejected/
  net-footprint/OR-1/OR-2/C-14/C-15-C-16/Business-Rules updated). **Note:** `merge-order.md` line 66
  still says 095 and 110 "both edit `SignalOrderTicket.tsx` (same-file, rebase-only)" — that note is
  now stale for 110 (110 deletes the file); left untouched here (out of this task's scope), flag for
  `/sdd-spec`/merge-order maintenance. If 095 also modifies that file, 110's deletion supersedes it in
  the sequential cohort (delete wins), but re-verify at execute time.

## Session 2026-08-31 — sdd-spec

- Generated implementation-spec.md with 8 steps. Status → `implementation-ready`.
- Key codebase findings (all grep/Read-verified against the current tree):
  - **Proto (OR-4):** `analysis.Opportunity` currently maxes at `bool muted = 12`
    (`packages/proto/analysis/v1/analysis.proto:554`) — feature 095's 13-18 are NOT yet in the tree
    (095 is `implementation-ready`, unmerged). Spec adds `optional double signal_confidence = 19` but
    Step 1 must re-derive next-free from the merged tree in the sequential cohort (095 lands first;
    `merge-order.md:66`). `signal_confidence`/`signalConfidence` exists nowhere yet.
  - **Persistence (OR-3 → RESOLVED: JSONB-ride, NO migration/DBA gate.)** `analysis.opportunities` has
    no `signal_confidence` column; the max-raw value rides the existing `readiness_json` JSONB
    (`repositories/opportunities.py:56-57,97-98,24-32`) exactly as feature 132's `muted` rides
    `provenance`. Populate at the candidate row-build (`servicer.py:3392-3404`, stash into the
    per-candidate `readiness` dict when `c["_best_sig_conv"] >= 0.0` — the reducer at `:3140,3275-3276`)
    and carry in `_row_to_opportunity` (`:3860-3876`) as explicit-presence. A top-level row key would be
    silently dropped by `replace_for_user`'s fixed INSERT column list — must go through `readiness_json`.
  - **Analysis RED:** `TestOpportunityRowParity` (`tests/test_analysis_servicer.py:4847-4877`) enumerates
    every `Opportunity` field in `_MAPPED` (incl. `muted`; `signal_axis` deliberately absent — it is a
    row key, not a proto field). Adding field 19 fails `test_mapper_covers_every_proto_field` until
    `_MAPPED` gains `signal_confidence` and the mapper carries it — the natural red-before-green.
  - **UI OrderForm:** scoped `signalConfidence?: number` prop mirrors the `allowOfflineRecord` precedent
    (`OrderForm.tsx:52`, NOT keyed on `initialSymbol`); qty `required` at `:206-214`; submit
    `qty: parseFloat(qty)` at `:108`; must coerce blank→0 (Go's `NaN <= 0` is false, `trading.go:457`).
    Render site `page.tsx:342` already has `symbolOpportunities` (`:185-189`) — zero new fetch.
  - **Orphan deletion (FR-6/AC-9):** `SignalOrderTicket.tsx` has zero importers (only a stale
    `OrderForm.tsx:71` comment + a comment in `offline-accounts.spec.ts:265`); `insights/market/[symbol]/page.tsx`
    is a redirect-only stub. Two e2e specs `goto` the stub and are updated in the same step:
    `nav-reachability.spec.ts:117-126` (redirect test removed — sibling `:95-115` already covers the live
    route) and `offline-accounts.spec.ts:257-274` (@AC-1 retargeted `/insights/market/AAPL` → `/trader/positions/AAPL`).
    `mobile-overflow.spec.ts:14` / `position-detail.spec.ts:294` are comment-only (untouched).
  - **UI fixtures (C-12):** the AC scenarios' symbol `CAPR` already exists as two `OPPORTUNITIES` rows
    (`e2e/fixtures/opportunities.ts`, `INVENTORY.md:25`) — extend with `signalConfidence`, no inline
    literal. `mock-backend.ts` `placeOrder` (`:193-209`) captures each request by `clientOrderId` — the
    assertion seam for qty≤0 + confidence.
  - **No config key, no ingest/trading code change** (trading `confidence` sizing at `trading.go:483-490,3165`
    is 023's launched contract). merge-order.md:66 already reflects 110's deletion + e2e updates (no
    change needed there).
- Reviewers snapshot finalized in feature.md: Proto Reviewer, xstockstrat-analysis owner, xstockstrat-ui owner.

## Session 2026-08-31 — sdd-review impl-spec (advisory)

- Result: 7 OK / 1 warning / 0 fail. No Floor risk. Field 19 derivation confirmed (095 owns 13-18); orphan delete grep-confirmed safe (zero importers); NaN-qty trap grounded (Go NaN<=0 is false -> blank must coerce to real 0); descriptor-parity guard coordination with 095 confirmed; all AC-1..9 covered.
- Unresolved ⚠ carried into execution:
  - Step 7: the verification `! grep -rn "insights/market" e2e/nav-reachability.spec.ts` over-matches a SURVIVING comment at `nav-reachability.spec.ts:101` (in the preserved sibling test), so the `&&` chain fails even after a correct implementation. Narrow the guard to `! grep -rn "goto('/insights/market" ...` (or reword the :101 comment). — [ ] unaddressed
  - Cross-cutting NOTE: 110 Step 4 adds `signal_confidence` onto 095's already-expanded 18-entry `_MAPPED` set (both co-edit servicer.py `_row_to_opportunity` + the parity `_MAPPED`); 110 runs SECOND, so it rebases onto 095's set (additive, low risk). — [ ] note only
  - Step 2 gen wildcard / Step 8 directory-in-Files (filename pinned in Verification) — accepted conventions. — [ ] note only
- Overlap findings: batch scan CLEAN; 095<110 on analysis servicer.py + parity test + OrderForm (merge-order.md).

## Session 2026-09-01 — sdd-execute (Stage 2, all 8 steps → code-completed)

Executed all 8 steps on `feature/wire-signal-confidence-to-position-sizing` (red-before-green on
every code step). Status → `code-completed`. Commits (4):

- `steps 1-2` — additive `optional double signal_confidence = 19` on `Opportunity` (the next free
  number after feature 095's 13-18 — this branch is stacked on 095). buf lint green; stubs regenerated.
- `steps 3-4` — analysis populates it from the existing max-raw reducer `c["_best_sig_conv"]` into the
  per-candidate `readiness_json` (JSONB-ride, no column/migration), carried by `_row_to_opportunity` as
  explicit-presence (unset when the symbol had no active signal, never a fabricated 0.0). Kept distinct
  from the ordinal `conviction` and the decayed `signal_axis`; post-ranking. RED-first parity guard
  (field 19 absent from `_MAPPED`) → GREEN; `TestSignalConfidence` covers the mapper (present/absent →
  HasField) + the producer (two signals raw 0.30/0.90 → max 0.90). Suite 644 passed.
- `steps 5-8` — UI: a scoped `OrderForm` `signalConfidence?: number` prop (mirrors `allowOfflineRecord`,
  not keyed on `initialSymbol`) that makes qty optional, coerces a blank/NaN qty to a real 0 (never NaN —
  Go's `NaN<=0` is false), and attaches `PlaceOrder.confidence` (023 auto-size); the `/trader/positions/
  [symbol]` render site derives a finite in-[0,1] `signalConfidence` from `symbolOpportunities` (per-symbol);
  the plain `/trader` + `/trader/orders` forms are byte-identical (FR-3). Deleted the orphaned
  `SignalOrderTicket.tsx` (zero importers) + the `/insights/market/[symbol]` redirect stub; removed the
  nav-reachability redirect test and retargeted offline-accounts @AC-1 to the live surface (AC-9).
  `signal-confidence-ticket.spec.ts` — 6 e2e (AC-2/3/4/5/6/7/8): blank→0+confidence, raw-not-ordinal,
  explicit override, distinct-per-symbol, plain-form required. CAPR fixture gains `signalConfidence` +
  INVENTORY note.

**Honored impl-review `[ ] unaddressed` fix:** Step 7's AC-9 verification grep was narrowed from
`insights/market` (which over-matched a surviving comment) to `goto('/insights/market` (real
navigations only); also confirmed nothing references `SignalOrderTicket` after the delete.

**Stacked-branch note:** 110 is a genuine dependent of 095 — its proto field 19 follows 095's 13-18,
and its symbol-page `signalConfidence` derivation sits alongside 095's `headerOpp`. It was rebased onto
095 twice this session as the base moved: first when 095 re-rooted for its PR, then again when 029
merged into main-dev and 095 rebased onto the new main-dev. When 095 squash-merges, 110 rebases onto
the new main-dev (dropping 095's now-squashed commits).

C-16 acceptance-suite promotion (110 `@AC-*`) is deferred to `/promote` at launch.

## Session 2026-09-01 (CI: feature status automation)

- Promotion PR #1065 merged to main
- Feature promoted and committed: c086afc839f905c4f72b24d75e824e22d61af0b2
- Status updated: `code-completed` → `launched`
- Launched date: 2026-09-01

# Context: unified-symbol-page

**Feature**: `docs/roadmap/features/125-unified-symbol-page/feature.md`
**Product Spec**: `docs/roadmap/features/125-unified-symbol-page/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/125-unified-symbol-page/implementation-spec.md`

---

## Session 2026-08-10T00:00:00Z — sdd-story

- Origin: user asked to "reshape" feature 096 (`position-and-order-detail-pages`) into one unified
  per-symbol page covering positions, orders, a trade widget, opportunity/conviction, per-strategy
  indicator convictions, fundamentals (watchlist symbols), screening tools (non-watchlist symbols),
  backtesting (past + new runs), backfill info, and any other useful missing data.
- **Discovery before writing anything**: checking out `feature/position-and-order-detail-pages` to
  continue 096 in place found it 95 commits behind `main-dev`, and merging conflicted because 096's
  own code (`4a10ceb`) duplicates what already shipped to `main-dev` via **PR #855** (`7f6f65e`,
  2026-08-02) — the same day 096's implementation spec was written. `feature.md`/
  `implementation-spec.md` were never updated past `implementation-ready`/all-`pending`, so 096 has
  actually been **launched in production since PR #875 promoted it to `main` on 2026-08-06**
  (`c1d1882`) while its tracking docs said otherwise for over a week. Root cause: the 2026-08-02
  session implemented all 6 steps directly and merged via one integration PR, but never flipped the
  spec's step statuses or feature.md status before merging, so CI's
  `ci-validate-feature-status.yml` — which only auto-promotes features already at `code-completed`
  at promotion time — silently skipped it.
- **User decisions** (via AskUserQuestion):
  1. Correct 096's tracking docs to `launched` (retroactively, no code change) before starting this
     feature. Done in a separate commit on `claude/status-096-bcrm9e` — see
     `docs/roadmap/features/096-position-and-order-detail-pages/context.md` § Session 2026-08-10.
  2. This feature stays **read-only against whatever exists today** — it does not wait on or absorb
     feature 095 (`opportunity-live-market-enrichment`, still `draft`) or feature 099
     (`watchlist-live-quotes`, parked at `idea`, no streaming-quote data source exists yet). Richer
     conviction/target/R:R fields and live LAST/CHG stay those features' scope, explicitly deferred
     in FR-5/FR-12/Out-of-Scope.
- **Recon before drafting FRs** (delegated to an `Explore` subagent, read-only, scoped to
  `xstockstrat-ui` + `packages/proto`): found the consolidation target is actually **three** existing
  per-symbol/per-order surfaces, not two — `/trader/positions/[symbol]` + `/trader/orders/[id]`
  (096) *and* `/insights/market/[symbol]` (feature 083's Signal-detail page, which already shows
  conviction, per-strategy readiness via `SignalReadiness`/`EvaluateReadiness`, and an embedded
  trade widget via `SignalOrderTicket` wrapping the reusable `OrderForm`). Also found: fundamentals
  (062/063, launched) has **zero UI display** anywhere despite the backend existing — Screener only
  uses it as scoring criteria; Screener itself is list-only with no per-symbol view; backtests are
  strategy-scoped only, no symbol filter exists; backfill status already has a global page with a
  client-side symbol filter (`/insights/backfills`) that's directly reusable; watchlist membership
  (`Watchlist.bindings[]`, portfolio.proto) has no existing "is symbol X on any watchlist" lookup.
  Full dossier folded into product-spec.md's FRs and Open Questions.
- **Numbered 125** — computed as `max(local NNN) + 1` (124) and cross-checked against every remote
  branch's tip tree (not just local — see `fails.md` 2026-07-29/081 lesson on the historical
  020/052 collisions), which also topped out at 124. No collision.
- **Left for `/sdd-design`**: the segment-placement fork (`/trader` vs `/insights` vs neither, since
  the three source pages split across both), the fate of the three source pages (remove/redirect/
  keep), the backtest-to-symbol mapping mechanism, and the fundamentals/screening-tools BFF design —
  all flagged explicitly in product-spec.md's Open Questions rather than decided here, per this
  repo's "don't assume, surface tradeoffs" rule.
- Artifacts written: feature.md, product-spec.md, this context.md. No recon.md/design.md yet
  (written by `/sdd-design`).

**Next**: `/sdd-review unified-symbol-page product-spec`, then `/sdd-design unified-symbol-page`.

---

## Session 2026-08-10T01:00:00Z — segment-placement decision + sdd-review product-spec

- **User resolved the segment-placement Open Question**: the unified page lives under `/trader`
  (not `/insights`), and `/insights/market/[symbol]` most likely redirects to it. Folded into
  FR-1, Consumer Surface(s), and Open Questions in product-spec.md — the placement fork is closed;
  only the exact final route and redirect mechanics for the three source pages remain for
  `/sdd-design`. One direct consequence noted: `/trader` already provides `AccountProvider`, so the
  trade widget (FR-4) no longer needs 083's own-wrapper pattern — it can consume the ambient
  provider directly.
- Ran `/sdd-review unified-symbol-page product-spec` (spec-reviewer + feature-overlap subagents).
  **Result: PASS WITH WARNINGS**, no blocking overlap. Status: draft → spec-ready.
  - Criteria pass: every named RPC/component/route/proto field verified against the codebase; all
    core criteria, C-10(a)/(b), and C-14 satisfied. Two advisory warnings, both addressed inline in
    product-spec.md: (1) trading-domain C-5 — added an explicit sentence to FR-3 that fill-status
    handling is unmodified/reused verbatim from 096; (2) Open Questions criterion — gained a lead-in
    directing `/sdd-design` to close all six remaining items explicitly (not just the ones that come
    up naturally), matching the established "defer genuine architecture forks to design" pattern
    also used by peer spec 095.
  - Overlap pass: no proto/config-key/migration collisions with any feature. Two **advisory**
    file-level heads-ups: `OrderForm.tsx` (FR-4) and `PlatformHeader.tsx` (FR-13) are both mid-edit
    on the in-flight, not-yet-merged shadcn-migration PRs #912 (`121`) and #913 (`122`, stacked on
    120/121). Not a blocker — no line citations exist yet to go stale — but folded into the Open
    Questions lead-in so `/sdd-design`'s recon re-checks current `main-dev` state (and whether
    #912/#913 have merged by then) before citing any line numbers. Overlap agent recommended
    deferring any `merge-order.md` entry until `/sdd-design` produces concrete file/line citations —
    not added now.
  - Warnings: fill-status clarity (FR-3), Open Questions closure directive (addressed above).
  - Overlap findings: `OrderForm.tsx`/`PlatformHeader.tsx` advisory heads-up (addressed above); no
    blocking collisions.

---

## Session 2026-08-10T02:00:00Z — sdd-design (full, 5 rounds — hard cap)

- **Phase 0 Recon**: spawned 6 `codebase-discovery` subagents in parallel (`xstockstrat-ui`,
  `xstockstrat-analysis`, `xstockstrat-portfolio`, `xstockstrat-ingest`, `xstockstrat-trading`, plus
  a follow-up `xstockstrat-marketdata` pass once the UI recon surfaced `GetFundamentals` as a second
  candidate fundamentals RPC). Wrote `recon.md`. Key finds: **corrected two wrong RPC citations**
  from the product spec (FR-7 named `RunFundamentalsScan`, which is admin-gated and side-effecting —
  real RPC is `GetFundamentals` on `xstockstrat-marketdata`; FR-10 named `GetBackfillStatus`, a
  single-job lookup — real RPC is `ListBackfillJobs`, which already has a server-side `symbol`
  filter); confirmed a **live, unguarded bug-class trap** in `ScreenSymbols` (single-symbol universe
  collapses all criteria to a content-free 0.5, matching `fails.md` 2026-08-08); found a
  **pre-existing latent bug** in `GetPosition` (ignores `account_id`, unlike `ListPositions`) that
  predates this feature but is directly load-bearing for FR-14's parity requirement. Added
  `xstockstrat-marketdata` to Affected Services. Folded all corrections into product-spec.md
  immediately (FR-7, FR-10, Affected Services, Proto Contract Changes) rather than waiting for the
  debate.
- **Phase 1 Grilling**: 5 rounds (full mode, hit the hard cap). No Floor breach in any round.
  Round-by-round: **R1** proposed extending `/trader/positions/[symbol]` in place; adversary found
  the FR-8 "reuse gap/threshold" mitigation was **factually wrong** (no such field exists;
  `criterion_scores` is the same broken normalization one field over) plus a duplicated mobile nav
  special-case (`BottomTabBar.tsx`), a BFF-ownership contradiction, and a dropped `?strategy=`
  thread. **R2** fixed those with real additive `ScreenResult` proto fields, both nav surfaces, an
  explicit `?strategy=`-then-binding precedence, and an explicit `GetPosition` fix commitment;
  adversary found the "`listBacktests` is dual-registered" precedent cited to justify BFF choices
  was **also factually wrong** (verified: it isn't), plus a missed repoint of the highest-traffic
  caller and a DRY miss reinventing NotFound handling. **R3** struck the false citation and
  discovered (verified, not assumed) that the entire "dual-register in `traderBff.ts`" question
  could be sidestepped — the existing cross-segment `/insights/api`-bound browser clients are
  same-origin-safe (confirmed against `bffShared.ts`/`auth.ts`/`.do/app.yaml`) and already used this
  way in production (`useWatchlists`); only `GetFundamentals` genuinely needs a new registration.
  **R4**'s adversary caught the most consequential finding of the debate: the inherited
  all-or-nothing position gate (096's original pattern) would make this feature's own headline
  sections (Opportunity/Readiness/Fundamentals/Screening/Backtests/Backfill) **unreachable for
  unheld symbols** — exactly the audience they exist to serve. Fixed with an explicit page-structure
  redesign (sections gate independently of position). **R5** (final, hard cap) closed remaining
  mechanical gaps (hoist Orders & fills and the price chart out of the position gate; reconcile
  Backtests' strategy source with the order-derived `owningStrategy` already shown elsewhere on the
  page; correct product-spec.md's Proto Contract Changes omission) — but its own adversary found the
  R3 "only `GetFundamentals` needs registration" claim was **itself false** (7+ RPCs genuinely
  unregistered) and a pre-existing render-order bug (`GetPosition`'s `NotFound` hits the error
  banner before the intended `EmptyState`, for what would be the *common* case on this page).
- **User gate at R5 (round cap reached)**: user resolved the BFF question directly — **formally
  adopt cross-segment client reuse** as a sanctioned, documented exception (not dual-registration),
  requiring a `services/xstockstrat-ui/CLAUDE.md` amendment in the same PR as the code that relies
  on it. The render-order fix was folded in as a mechanical, already-decided part of the design
  (reorder two JSX conditions + reuse the canonical `isNotFoundError` helper). Initially closed the
  debate on this basis without a 6th round, on the reasoning that the round cap is a skill-level
  hard constraint rather than a user-overridable Commandment.
- **Design.md written and approved** — Chosen Approach, Rejected Alternatives (7 named), Open Risks
  (5), and Constitution Rules Touched (C-01, C-08, C-09, C-10(a), C-10(b), C-12, C-14, F-04, F-11 —
  all honored, no breach). Committed/pushed (commit `362ca9e`).
- **Explicit user override of the round cap (recorded per P-03 — no silent deviation).** The user
  directly and repeatedly asked to override the 5-round hard cap ("override limit to 7 rounds," then
  "do override it") after the design was already approved and pushed. Distinguished from a
  Constitution Floor (`F-*`) item, which is genuinely non-overridable (F-11) — this is a
  skill-authored process/convergence mechanism (`.claude/skills/sdd-design/reference/grilling-
  protocol.md` § "hard cap 5"), not a Floor rule, and the override asks for *more* scrutiny, not
  less, so honoring it carries no correctness/safety risk the way overriding an actual Floor item
  would. Proceeding to round 6 (and further, up to the user's stated 7-round ceiling, only if round
  6 surfaces something requiring it) as a genuine additional adversarial pass over the final,
  already-approved design.md — not a symbolic continuation.
- **product-spec.md corrected in lockstep** (same session, not deferred): FR-9/AC-6 reworded with
  the resolved strategy-precedence and explicit narrower-coverage statement; Proto Contract Changes
  corrected to name the `ScreenResult` additive fields (previously omitted under a blanket "no proto
  changes" claim — caught by the R4/R5 adversary); Feature Workflow Notes' approval-gate checkbox
  updated to include `xstockstrat-analysis` proto sign-off; all remaining Open Questions checked off
  with their design.md resolutions.
- Status: `spec-ready` → `design-approved`.

## Session 2026-08-10T03:00:00Z — sdd-design rounds 6–7 (user-overridden round cap)

- After design.md was written, approved, committed (`362ca9e`), and pushed, the user directly and
  repeatedly asked to exceed the design skill's normal 5-round hard cap ("override limit to 7
  rounds," then "do override it"). Honored: the round cap is a skill-authored process/convergence
  mechanism (`.claude/skills/sdd-design/reference/grilling-protocol.md` § "hard cap 5"), not a
  Constitution Floor (`F-*`) item — Floor rules are genuinely non-overridable (F-11), but this isn't
  one, and the override asked for *more* scrutiny, not less, so honoring it carried no
  correctness/safety risk.
- **Round 6 justified the override immediately.** A full proposer→adversary cycle restated the
  entire approved design, with the proposer specifically expanding the two items round 5 had
  resolved without a full adversarial cycle (the cross-segment BFF decision's exact `CLAUDE.md`
  amendment text, and the render-order fix's page-wide "no other section has this hazard" sweep).
  Round 6's adversary independently re-verified everything rather than trusting the restatement, and
  found the sweep's central claim was **false**: `EvaluateReadiness` has a real, live `NOT_FOUND`
  path (a stale/bookmarked `?strategy=` param reaching `SignalReadiness`), and the reused-as-is
  component's current error handling has *no* NotFound-vs-generic distinction at all — strictly
  worse than the position page's pre-fix state. Also found: `usePosition`'s `refetchInterval` would
  poll a confirmed-NotFound position forever (the round-5 retry-suppression fix only stopped
  in-attempt retries, not the outer loop); the `services/xstockstrat-ui/CLAUDE.md` amendment had no
  cross-reference from the canonical `nextjs-frontends.md` doc that states the rule it excepts
  (itself already a recorded, unfixed `fails.md` staleness gap); and a minor ingress-routing
  precision issue in the amendment's own justification text.
- **Round 7 (final, the user's stated ceiling) closed all five findings**: `useReadiness`/
  `SignalReadiness` get the identical `isNotFoundError` treatment as `usePosition`; Backtests section
  scope clarified as history-list-only (no `GetBacktest`/detail view — that stays exclusively on
  `/insights/strategies/[id]`); `usePosition`'s `refetchInterval` gated off on confirmed NotFound;
  a `nextjs-frontends.md` cross-reference footnote specified; the ingress-routing text reworded for
  precision.
- **Round 7's adversary still found two real, code-verified gaps** (no Floor breach): (1)
  `e2e/insights/signal-detail.spec.ts` mostly asserts on `insights/market/[symbol]`'s own page-shell
  markup — which this design deletes — so "re-run existing coverage" for the `SignalReadiness` fix
  is insufficient; it needs relocation/rewrite against the new route, not a re-run. (2) The new
  NotFound branch needs its own paired test (mirroring `backtest-coverage.spec.ts`'s
  `run-detail-empty` pattern), not just old-coverage re-run. Given this was the final round available
  (user's explicit 7-round ceiling, no round 8), the adversary itself recommended — and the
  orchestrator followed — closing these as **named Open Risks with target steps** in design.md
  rather than requiring further debate, satisfying P-03 (no silent deviation) since `/sdd-spec` will
  read them as concrete step-level obligations, not lose them.
- **design.md updated in place** (not re-approved from scratch — the round 5 approval stands; rounds
  6–7 amended and strengthened it): header updated to 7 rounds with the override rationale; Chosen
  Approach gained the `useReadiness`/`SignalReadiness` fix, the Backtests-scope clarification, the
  `refetchInterval` fix, the verbatim `CLAUDE.md` amendment text + its placement, and the
  `nextjs-frontends.md` cross-reference + orchestrator decision to fix its adjacent stale text in the
  same edit; Rejected Alternatives gained the recon.md origin citation for the dual-registration
  option; Open Risks gained three new items (spec relocation, paired NotFound test, stale-text
  co-fix) and closed the already-resolved FR-9 item; Constitution Rules Touched updated (C-01 now
  cites three caught-and-corrected false claims, not two; F-11 updated to 7 rounds).
- No further product-spec.md changes needed this session — rounds 6–7 only affected design.md-level
  implementation detail, not FRs/ACs.

## Open Threads (from design.md Open Risks — target steps TBD at /sdd-spec)

- [ ] Opportunity-selection tie-breaking for a symbol with multiple watchlist-relevant `Opportunity`
  rows (different strategies) — not fully specified; resolve at the Opportunity-section step or
  confirm "first match" is acceptable.
- [ ] Chart-hoist caption/meta-line refactor touches ~6 `position.`-reading references that must
  ALL move to the top-level `avg`/`stop`/`hasStop` locals — needs an explicit step-level checklist
  item in implementation-spec.md, not just a design-level note.
- [ ] `services/xstockstrat-ui/CLAUDE.md`'s cross-segment-client-reuse exception must be written in
  the same step/PR as the first code that relies on it, or the exception has no recorded
  justification for a future reader.
- [ ] Always-fully-rendered composite page (7+ sections firing RPCs on every visit) — performance/UX
  risk named but not stress-tested in the design debate; flag as a pre-launch QA check.
- [ ] `e2e/insights/signal-detail.spec.ts` needs relocation/rewrite (not a re-run) against
  `/trader/positions/[symbol]` once `insights/market/[symbol]/page.tsx` is deleted — most of its
  assertions target page-shell markup that won't exist at the new URL in the same form.
- [ ] `SignalReadiness`'s new NotFound branch needs a dedicated paired test (mirroring
  `backtest-coverage.spec.ts`'s `run-detail-empty` pattern), not just a re-run of pre-existing
  coverage.
- [ ] `nextjs-frontends.md`'s cross-reference footnote must land alongside a fix to the adjacent,
  already-recorded stale "two BFF files"/nginx text (`fails.md` 2026-08-05) in the same edit, plus
  the root-`CLAUDE.md`-mandated `/context-scrubber scan` since that file is being touched.

**Next**: `/sdd-spec unified-symbol-page`.

---

## Session 2026-08-10T04:00:00Z — sdd-spec

- Generated `implementation-spec.md` with **26 steps**, consuming `recon.md` + `design.md` per the
  Step 1.5 flow (both present — no fresh discovery subagents spawned; re-verified every recon/design
  citation myself by direct `Read`/`grep` against the live tree instead, per design.md's explicit
  staleness-recheck directive for `PlatformHeader.tsx`/`OrderForm.tsx`). Status:
  `design-approved` → `implementation-ready`.
- **Re-verification result: no drift found.** Every recon.md/design.md `path:line` citation checked
  (`PlatformHeader.tsx:106-107`, `BottomTabBar.tsx:18-20`, `OrderForm.tsx:41-48`, `traderBff.ts:103-106`,
  `insightsBff.ts:85-91`, `portfolio_service.go:462-469`/`portfolio_repo.go:61-92`,
  `screener.py:388-475`, `analysis.proto` `ScreenResult`/`ListBacktestsRequest`/`BacktestRunSummary`,
  `marketdata_handler.go:159-183`, `ingest servicer.py:585-621`, `useOpportunities.ts:45-51`,
  `useStrategies.ts:22-67`, `scoreDisplay.ts:36-38`, `usePortfolio.ts:65-83`, `CLAUDE.md:59-68`,
  `nextjs-frontends.md:280-298`, `app/page.tsx`, `CardNotice.tsx`, `INVENTORY.md`, `mock-backend.ts`,
  `position-detail.spec.ts`, `signal-detail.spec.ts`, `backtest-coverage.spec.ts:191-198`,
  `nav-reachability.spec.ts`, `valuation-parity.spec.ts`) matched the live file exactly — the
  shadcn-migration PRs #912/#913 flagged as unmerged-and-risky at `/sdd-review` time had, by this
  session, already landed cleanly with no citation breakage.
- **One new finding beyond recon/design** (folded into Step 14's Codebase Evidence, not silently
  assumed): `GetFundamentals`'s "no data for this symbol" case does **not** surface as gRPC
  `NotFound` the way every other section's error handling on this page assumes. Traced through
  `fmp_client.go:63-72` (a plain Go error, "fmp: no fundamentals for %q") →
  `marketdata_service.go`'s `resolveFundamentals` (wraps as `CodeUnavailable`) — plus two other
  possible codes (`CodeFailedPrecondition` when FMP is disabled, `CodeResourceExhausted` under quota
  exhaustion with no cached row). FR-7's "show that explicitly" therefore must treat **any** error as
  the no-data case, not special-case `NotFound` via `isNotFoundError` like every other section does —
  written explicitly into Step 14's Instructions so this isn't silently copy-pasted wrong from the
  `SignalReadiness`/`usePosition` pattern.
- **Two `useBackfillJobs`/`useScreenSymbols` findings that simplified the spec** versus recon's
  original Recommended Scope: both hooks already call their cross-segment browser clients
  (`insightsIngestClient`/`analysisClient`) directly — recon's step-8/step-6 language ("new BFF
  registration... `listBackfillJobs`") predates design.md's round-5 cross-segment-reuse decision and
  is superseded by it. Steps 20-21 (Backfill) and 16-17 (Screening) need **zero** new `traderBff.ts`
  registrations; only Step 14 (Fundamentals, `GetFundamentals`) is genuinely new BFF wiring, exactly
  as design.md's Chosen Approach states.
- **Exact enumeration completed** for design.md's Open Risk "chart-hoist caption/meta-line refactor
  is an enumerable, must-not-miss diff (~6 `position.`-reading references)": confirmed **6** in the
  price-chart `Card` (lines 299, 300, 301, 321, 325, 330) plus a **7th** in a different Card (Orders &
  fills' `CardTitle`, line 340, `position.symbol` → the page-level `symbol` local) — all 7 named
  explicitly in Step 8's Instructions so none can be missed silently.
- **One spec-level structural addition not explicit in design.md**, flagged as such rather than
  silently invented: a minimal top-level symbol heading (Step 8, point 5) is needed once the
  position-specific header stays gated but other sections mount unconditionally — otherwise an
  unheld symbol's page has no visible title at all. Design.md's own Open Risks entry explicitly
  deferred this exact class of mechanical decision to spec time ("flagged as a step-level checklist
  item... not a further design decision"), so this is filled in per that instruction, not a departure
  from it.
- **Reviewers table finalized** in `feature.md` — deduplicated across all 26 steps per
  `docs/runbooks/reviewer-registry.md`'s governance matrix; unchanged in substance from the
  design-approved snapshot, reworded to cite exact step numbers.

**Next**: `/sdd-review unified-symbol-page impl-spec`.

---

## Session 2026-08-10T04:00:00Z — sdd-review impl-spec (advisory)

- Result: 0 blockers, 3 warnings (advisory — did not block; no Floor risk). 23/26 steps clean on
  first pass. Overlap: **CLEAN** — no other feature is currently `implementation-ready`/
  `in-progress`; the shadcn-migration PRs (#912/#913/#914) flagged as in-flight during the
  product-spec review have since merged to `main-dev`, and this spec's own citations already match
  current trunk (confirmed independently by both the criteria and overlap subagents).
- All 3 warnings were the same shape — a step deferred a proto field-name confirmation to execute
  time despite the field being directly greppable at spec-write time (minor **C-01** softness,
  correctly hedged per **P-03**, not a fabrication). **Resolved immediately, not left `[ ]
  unaddressed`** — all 26 steps are still `pending` (execution hasn't started), so per F-09's own
  scope ("step bodies are immutable **during execution**") editing Instructions now is in-bounds,
  not a violation:
  - [x] Step 12: `useWatchlists()`'s membership field confirmed as `bindings[]` (authoritative,
    `portfolio.proto:190`) with the deprecated flat `symbols[]` (`portfolio.proto:186`) only as a
    fallback for pre-097 legacy records — Instructions rewritten to state this precisely instead of
    "verify at execute time."
  - [x] Step 18: `RunBacktestRequest`'s exact field shape confirmed (`strategy_id_ref`/`symbols`/
    `initial_capital`/`range`, `analysis.proto:44-53`) and matched against the proven call shape
    already live at `insights/strategies/[id]/page.tsx:96-102`, including that page's own default
    range/capital seed to reuse rather than inventing new defaults.
  - [x] Step 20: `BackfillJob.range` (a single job-wide `TimeRange`, `ingest.proto:27-43`) and
    `TimeRange{start,end}` (`common.proto:42-45`) confirmed — Instructions now name the exact
    reduction fields (`status`-filtered `min(range.start)`/`max(range.end)`) instead of a vague
    "confirm field names at execute time."
- Overlap findings: none. (Noted in passing, out of scope for this session: features 121/123's
  `feature.md` still read `code-completed` even though their code is verifiably already merged to
  `main-dev` — a stale-status gap worth a future `/sdd-status` refresh, not this feature's to fix.)

**Next**: `/sdd-execute unified-symbol-page`.

---

## Session 2026-08-10T00:00:00Z — post-`main-dev`-merge citation refresh (manual, in lieu of `/sdd-spec`)

- **Trigger**: after the impl-spec review pass above, this branch had drifted from `main-dev` —
  feature 124 (`shadcn-table-actions-responsive`, a different, larger shadcn migration) merged in
  the interim. User said "fix the merge conflicts." Fetched and merged `origin/main-dev`; one real
  conflict (`docs/roadmap/ledger/insights.md`, append-only — resolved by keeping both features'
  entries in chronological order, this feature's 2026-08-10 entry after 124's 2026-08-09 one).
- Feature 124's diff rewrote several `xstockstrat-ui` files this feature's `design.md`/
  `implementation-spec.md` cite by exact line number — flagged proactively before the user asked.
  Offered two options: (1) trust `/sdd-execute`'s own per-step discovery to catch drift at run
  time, or (2) re-run `/sdd-spec` now to refresh every citation up front. **User chose (2).**
- Two attempts to have the forked `/sdd-spec` skill actually perform this re-verification both
  failed — each time it read `context.md`, saw the feature already `implementation-ready`, and
  declined ("nothing to do"), even with an explicit instruction on the second attempt. Abandoned
  re-invoking the skill; did the citation-freshness sweep directly in the main session instead: a
  `codebase-discovery` subagent reported drift across the 12 `xstockstrat-ui` files feature 124
  touched, then every citation in `implementation-spec.md` referencing those files (plus, for due
  diligence, every citation in the backend-only Steps 1-6, confirmed untouched by 124's UI-only
  diff, and Step 7's doc citations, also confirmed unchanged) was re-verified against the current
  tree and fixed with `Edit`, cross-checking Card/section boundaries via direct file reads where
  the subagent's report didn't give exact ranges.
- **Steps repaired** (mechanical line-shift only, unless noted): 8, 10, 11, 12, 18 (one more
  citation — `owningStrategy`'s `useMemo`, `page.tsx:61-67` → `62-68` — caught in this session's
  own final sweep, not the earlier pass), 22, 23, 25, 26.
- **Steps with a real precondition/methodology break, not just renumbering**:
  - Step 8: the old "Exposure" back-`Link` the Instructions assumed no longer exists — feature 124
    (FR-10b) replaced it with a `<PageBreadcrumb>` component. Instructions rewritten to build the
    new symbol heading below `PageBreadcrumb`, not modify a link that isn't there.
  - Step 24: the `getByLabel('Breadcrumb')` locator the Instructions assumed no longer exists —
    feature 124 (FR-10a) removed the shared `PlatformHeader`-level `Breadcrumb` landmark entirely
    and moved the reachability proof onto `aria-current="page"` on the `Primary`/`Section` nav
    links (`nav-reachability.spec.ts`'s own docblock records this). Instructions rewritten to use
    the `aria-current` mechanism for the new `/trader/positions/AAPL` route assertion, and to note
    explicitly that a direct `page.goto` is required (no nav-menu link exists for a dynamic route).
- **Confirmed unaffected, no change needed**: Step 9 (`mock-backend.ts:231-234`,
  `OrderForm.tsx:55-65` — both re-verified via direct grep, exact match). Steps 1-6 (proto/
  `screener.py`/`portfolio_service.go`/`portfolio_repo.go` — backend-only, outside feature 124's
  UI-only diff; every cited line re-verified by grep, exact match, including the
  `portfolio_repo_test.go` existence check Step 6 flagged as unconfirmed — it exists). Step 7
  (`services/xstockstrat-ui/CLAUDE.md` lines 59/68, `docs/patterns/nextjs-frontends.md` lines
  3/12-17/282-287/291-298 — all re-verified by grep, exact match). Steps 13-21's own Codebase
  Evidence cite functions/proto fields, not `page.tsx` line ranges (their one `page.tsx` line
  citation, Step 18's `owningStrategy`, is listed above under repaired steps).
- All 26 steps now re-verified against the post-feature-124 `main-dev` tip. No further staleness
  found in this sweep.
- Overlap findings: none new.

**Next**: `/sdd-execute unified-symbol-page` — pending explicit user confirmation to proceed (the
"2" instruction that triggered this session was scoped to the citation refresh, not to launching
execution).

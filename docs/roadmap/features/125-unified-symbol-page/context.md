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

---

## Session 2026-08-15T00:00:00Z — scope amendment (new request absorbed)

- **Trigger**: a fresh task arrived ("UI change. Add charts for the selected strategy in the Symbol
  page.") — root `CLAUDE.md`'s Mandatory Entry Point rule requires `/sdd-story` for any new
  capability. Ran `/sdd-story`'s discovery steps (NNN allocation, governance/ledger reads) and found
  this feature (125) already owns "the Symbol page" (design-approved, implementation-ready, 26
  steps, none executed yet — `in-progress` never started).
- **Genuine fork surfaced to the user** (not guessed): (1) which page counts as "the Symbol page"
  given 125's unified page hasn't shipped — today's codebase still has two separate pages
  (`/trader/positions/[symbol]`, `/insights/market/[symbol]`); (2) what "chart for the selected
  strategy" should actually show (backtest equity curve / price chart with signal markers /
  indicator overlay panels — the last being flagged up front as needing a new-to-the-UI RPC surface,
  `ComputeIndicator`/`ExecuteFormula`, and therefore the largest of the three options).
- **User's answers**: (1) *"absorb this request into the 125 feature, start the process to
  implement it"* — do not create a new sibling feature (135 was the next-available NNN, computed but
  never written to disk — no directory was created, no number consumed). (2) **Indicator overlay
  panels** — the largest, most architecturally novel of the three options.
- **Action taken this session**: amended `product-spec.md` FR-6 (added the indicator-overlay-panel
  requirement, evidenced against `StrategyComponent`/`StrategyDefinition.components`
  (`analysis.proto:241-246`) and the existing-but-never-UI-called `ComputeIndicator`/`ExecuteFormula`
  RPCs on `xstockstrat-indicators`), Out of Scope (a *general-purpose* indicator viewer stays out;
  strategy-scoped overlay panels are now in), Affected Services (`xstockstrat-indicators` is no
  longer "not directly called"), Acceptance Criteria (new AC-4a), and Open Questions (new item
  naming the real unresolved architecture questions: `ComputeIndicator`'s input-series sourcing,
  whether `ExecuteFormula`'s response shape — designed for one-shot sandboxed execution — even
  returns a chartable per-bar series for custom-formula components, and multi-panel layout against
  `lightweight-charts@^4.2.0`'s single-pane sanctioned-exception precedent
  (`useCandlestickChart.ts`)). Logged the amendment in `feature.md` Status History without
  re-gating lifecycle status (still `implementation-ready` — the other 25 approved steps and their
  design rationale are untouched; only FR-6's design is re-opened).
- **Not yet done, by design**: no design debate has run on the new FR-6 scope yet — deliberately
  left to `/sdd-design unified-symbol-page quick`, scoped to just the new Open Questions item, as
  the very next action, before `/sdd-spec` writes any implementation steps for it.

**Next**: `/sdd-design unified-symbol-page quick` — debate FR-6's indicator-overlay-panel
architecture, then `/sdd-spec unified-symbol-page` to add implementation steps, then resume
`/sdd-execute unified-symbol-page` (all 27 steps, starting from Step 1 — none executed yet).

---

## Session 2026-08-15 — sdd-design (FR-6 addendum)

- **Phase 0 Recon**: appended an FR-6 addendum to recon.md (services: `xstockstrat-indicators`,
  `xstockstrat-analysis`, `xstockstrat-ui`). Key reuse patterns found: `StrategyEvaluator._compute_component`/
  `align_indicator_points` (`evaluator.py:215-317`) is the ONLY proven `StrategyComponent → aligned
  per-bar series` path, but it's reachable today only via `RunBacktest`'s heavyweight diagnostics or
  the last-bar-only `EvaluateReadiness` trace — no lightweight standalone read exists. `ComputeIndicator`/
  `ExecuteFormula` are stateless whole-series compute (caller supplies closes). `useCandlestickChart.ts`
  has no multi-pane infra; `FormulaRunResult.tsx` is the in-repo stacked-`recharts` precedent.
- **Phase 1 Grilling**: 3 rounds, full mode (user escalated from `quick` to full after round 1).
  - Round 1: new `GetIndicatorSeries` RPC (dedicated). Adversary: no Floor breach, but flagged a
    C-10(b) overlay-vs-readiness parity gap, missing per-component fault isolation, a semaphore-reuse
    overclaim (screener's is per-request), and an inert Suspense mitigation.
  - Round 2: proposer REVERSED to "widen `EvaluateReadiness`" (the series dict is already computed
    there; parity by construction). Adversary VERIFIED that claim true — but found the disqualifier:
    `evaluate_conditions_traced` is shared with launched feature 097's `ListOpportunities` exit trace
    (`servicer.py:2207`), so adding fault-isolation there silently changes held-position exit-signal
    semantics.
  - Round 3 (user chose "converge on dedicated RPC"): back to a dedicated `GetIndicatorSeries`, now
    with all fixes. Final adversary VERIFIED `_compute_component` needs only closes (so client-supplied
    closes is faithful, not a regression — high/low/volume are already unavailable in every existing
    path), and that the `None` warm-up/gap representation is real (→ `DoubleValue` unset, no `0.0`).
    Two must-fix items folded in: the parity test must be evaluator-level (not cross-RPC — the two
    RPCs fetch different bar windows, making a cross-RPC assertion flaky for path-dependent
    indicators), and the semaphore needs the `max(1, …)` clamp both siblings use. Orchestrator
    grounded and corrected the bar-source decision mid-round: the candlestick fetches by `pageSize`
    count, not a `TimeRange` (`positions/[symbol]/page.tsx:84-91`), so option (b) "reuse the
    TimeRange" was impossible — corrected to client-supplied closes+times (option a).
- **Chosen approach**: new additive `AnalysisService.GetIndicatorSeries(strategy_id, symbol, closes[],
  times[])` reusing `_compute_component` in its own isolated handler loop; `DoubleValue` null-safe
  series; per-component fault isolation; process-lifetime singleton semaphore
  `analysis.series.max_concurrent_components` (default 4); stacked `recharts` panels via the
  already-sanctioned cross-segment `analysisClient`; evaluator-level parity test.
- **Rejected**: widen `EvaluateReadiness` (shared-method blast radius onto launched 097); UI-direct
  indicator orchestration (TS logic duplication + unthrottled sandbox); server re-fetch from a
  `TimeRange` (false premise — candlestick uses `pageSize`); `RunBacktest` diagnostics reuse
  (side-effecting full simulation per page view); `repeated double` with NaN/0.0 sentinel (fabricates
  data, AC-4a violation).
- **Constitution rules touched**: C-01, C-05, C-08/P-06, C-09, C-10(b), C-14. Floor breaches: none in
  any of the 3 rounds.
- **New Open Risks** (carried to design.md): uncapped `StrategyDefinition.components` fan-out (panel
  count uncapped though concurrency is semaphore-bounded); `/sdd-spec` must confirm the `Bar`
  timestamp attribute name (`marketdata.proto:46` says `time`; `evaluator.py:105` docstring says
  `timestamp`); paired tests for fault isolation + `None→unset DoubleValue` mapping beyond parity.
- **Status**: unchanged at `implementation-ready` (feature was already past `design-approved`; design.md
  amended with an addendum, not re-gated). product-spec.md FR-6/Affected Services/Proto/Config/AC-4a
  corrected in lockstep. `/sdd-spec` must be re-run to add the FR-6 implementation steps.

**Next**: `/sdd-spec unified-symbol-page` (add FR-6 steps: proto + buf-gen predecessor, analysis
service + paired tests, UI overlay-panel component + wiring), then `/sdd-review impl-spec`, then
`/sdd-execute`.

## Session 2026-08-15 — sdd-spec (FR-6 re-spec)

- Extended implementation-spec.md from 26 → **33 steps**, adding the FR-6 indicator-overlay-panel
  block (Steps 27-33). No existing step (1-26) was renumbered or altered — the FR-6 steps are appended
  and wired into the existing dependency graph via new `## Step Dependencies` lines.
- New steps: **27** proto (`GetIndicatorSeries` RPC + `GetIndicatorSeriesRequest`/`Response`/
  `ComponentSeries`/`NamedSeries` + `google/protobuf/wrappers.proto` import), **28** proto-gen, **29**
  config (`analysis.series.max_concurrent_components` — CLAUDE.md row + config-governance
  registered-keys entry, C-05), **30** analysis handler, **31** paired Python tests, **32** UI overlay
  panels, **33** UI e2e + `indicatorSeries.ts` fixture.
- Key codebase findings (re-verified fresh against the live tree, C-01):
  - **Design Open Risk resolved**: `Bar` timestamp field is `time`, not `.timestamp` —
    `packages/proto/marketdata/v1/marketdata.proto:46` (`google.protobuf.Timestamp time = 2`). The UI
    reads `bar.time` to populate the request `times`.
  - `analysis.proto`: `service AnalysisService` spans lines 12-42 (last RPC `GetStrategyAnalytics`
    @41 — new RPC appends after it); imports @7-10 lack `wrappers.proto`; `StrategyComponent` @241-247,
    `StrategyDefinition.components` @252; `ComponentKind` enum reused for `ComponentSeries.kind`.
  - `servicer.py`: `EvaluateReadiness` handler @1959 is the exact skeleton the new handler reuses
    (propagation_meta @1963-1967, `_strategies_repo is None`→UNAVAILABLE @1968-1970, `get_by_id`→None
    →NOT_FOUND @1971-1976, `_row_to_strategy_definition` @1977, `StrategyEvaluator(self._indicators,
    propagation_meta)` @1978); `__init__` @117 (self._cfg @129, _indicators @131, _strategies_repo
    @150) hosts the new singleton `self._component_series_sem`.
  - `evaluator.py`: `_compute_component` @215 (consumes only closes — verified), `align_indicator_points`
    @295, `_finite_or_none` @39, `FormulaExecutionError` @27, `evaluate_conditions_traced` @171 (the
    shared method the handler must NOT touch — 097's `ListOpportunities` exit trace).
  - `screener.py:84-85` semaphore pattern mirrored for the config key
    (`max(1, cfg.get_int("analysis.screener.max_concurrent_formula_evals", 4))`).
  - UI: `useGetStrategy` @`hooks/useStrategyDefinitions.ts:25` (via `analysisClient`, cross-segment);
    stacked-panels precedent `FormulaRunResult.tsx` (recharts `LineChart`+`ChartContainer`); bars
    fetched+discarded at `page.tsx:86-96` (new state needed to retain closes+times — design confirmed);
    analysis test homes `test_strategy_evaluator.py` (parity) + `test_analysis_servicer.py`
    (fault-isolation/null-mapping).
- Status stays `implementation-ready` (spec extended, not re-gated).

**Next**: `/sdd-review unified-symbol-page impl-spec` (validate the 33-step spec), then `/sdd-execute
unified-symbol-page`.

---

## Session 2026-08-15 — sdd-review impl-spec (advisory, FR-6 steps 27-33)

- Result: **0 failures, 3 advisory notes** (advisory — did not block). Scope: the new FR-6 block
  (Steps 27-33); Steps 1-26 were reviewed in the prior 2026-08-10 pass and not re-litigated.
- Criteria pass (spec-reviewer): **PASS WITH WARNINGS.** Every cited anchor in 27-33 verified to
  exist (`servicer.py:1959`/`:117`, `evaluator.py` `_compute_component`/`_finite_or_none`/
  `align_indicator_points`, `screener.py:84-85` semaphore, `marketdata.proto:46` `Bar.time`,
  `useStrategyDefinitions.ts:25` `useGetStrategy`, `FormulaRunResult.tsx` recharts, `analysis.proto`
  `ComponentKind`/`StrategyComponent`, `config-governance.md` registered-keys format). C-01/C-03/
  C-05/C-08/C-09/C-12/C-13/C-14/P-06 all satisfied; **no Floor (F-*) risk.**
- Advisory notes (cleared / accepted before execution, 2026-08-15):
  - [x] Step 30: `except (FormulaExecutionError, Exception)` redundancy — **CLEARED**: spec Step 30
    tightened to `except Exception as e:` with an explanatory comment (edit made pre-execution while
    all steps still `pending`, in-bounds per F-09's during-execution scope).
  - [x] Step 31: evaluator-level parity test (test 1) is an invariant guard, not the P-06 RED proof —
    **CLEARED**: spec Step 31's TDD note now states explicitly that the RED gate rests on tests 2-3
    (handler fault-isolation + null→unset-`DoubleValue`) and that test 1 is expected green pre-Step-30.
  - [x] Step 30: `DoubleValue` generated-symbol alias — **ACCEPTED as an execute-time confirmation
    (cannot be cleared earlier by nature)**: the alias does not exist until Step 28's `buf-gen` runs.
    The spec already flags it (F-04). `/sdd-execute` MUST grep the regenerated stub for the real alias
    before writing Step 30's encoding line — same pattern as the approved Steps 1→3 (`criterion_raw_values`
    cited before Step 2 regenerates). Carried into execution as an accepted, spec-flagged confirmation,
    not an unresolved warning.
- Overlap pass (feature-overlap): **COLLISIONS FOUND, but ALL soft/rebase — zero FAIL-class.** No
  shared proto field number within any one message (`ScreenResult` `12`/`13` free — highest on trunk
  is `held=11`; `GetIndicatorSeries`/`ComponentSeries`/`NamedSeries` are net-new; 132/133 touch
  `StrategyDefinition`/`Opportunity`, disjoint), no duplicate config key (`analysis.series.*` is a
  brand-new namespace, absent from `config-governance.md`), no migration (125 adds none). Soft
  same-file overlaps flagged for rebase awareness: `analysis.proto`, `servicer.py` (125's new
  handler is structurally disjoint from the 131-134/022 cohort's `_compute_opportunities` region),
  and `e2e/mock-backend.ts` (vs 133). **No merge-order hard row required** — every overlap is the
  soft/rebase class the merge-order file says to omit; whichever of 125/131-134/133 lands second
  mechanically rebases.

**Next**: `/sdd-execute unified-symbol-page` — FR-6 begins at Step 27 (all 33 steps still `pending`;
none executed). `/sdd-execute` must announce the three `[ ] unaddressed` advisory notes above at
each checkpoint (C-02/P-03).

---

## Session 2026-08-15 — sdd-execute (sequential, full feature)

- Mode: SEQUENTIAL, full feature (user: "full feature, sequential, one commit per step, one final
  integration PR"). Executing on `claude/strategy-charts-symbol-page-itodkw` (harness-pinned; the SDD
  `feature/unified-symbol-page` branch does not exist on origin). Integration PR = the existing #958
  (→ main-dev), which accumulates the step commits.
- Re-spec gate (§5.3): merged `origin/main-dev` clean (brought in the 131-134 cohort's migrations/
  fixtures); pushed. Per-step Phase-1 discovery validates each step's evidence against the updated
  tree (directive = none → any mismatch is a §5.7 blocker).
- Tooling setup (all steps): go1.25 ✓ · golangci-lint 2.5.0 ✓ · python3.11+uv0.8.17 ✓ · ruff0.15.8 ✓
  · node22+pnpm9.15.0 ✓ (workspace installed) · buf1.72.0 ⬇ · protoc-gen-go@1.36.11 /
  protoc-gen-go-grpc@1.6.2 / protoc-gen-connect-go@1.19.2 ⬇ · grpcio-tools==1.80.0 ⬇ · TS plugins ✓
  (pnpm). **Codegen validated: `./scripts/buf-gen.sh` reproduces committed stubs byte-for-byte
  (empty `git diff packages/proto/gen/`)** before any proto edit — per the ledger toolchain-validation
  lesson. Docker present but unused (host codegen works).

### Step 1 — proto: additive `ScreenResult` fields [done]
- Added `map<string, double> criterion_raw_values = 12` and `map<string, bool> criterion_passed = 13`
  after `bool held = 11;` in `ScreenResult`. `buf lint` ✓; `buf breaking` against main-dev ✓
  (additive-only, no breaking diff). Anchors shifted (ScreenResult 369-385 → 388-404 from the main-dev
  merge) but field content/numbers unchanged — benign line-shift, no re-spec needed.
- Files modified: `packages/proto/analysis/v1/analysis.proto`
- Deviations: the step's Verification `buf breaking --against ".git#branch=main-dev"` resolves `.git`
  relative to cwd (`packages/proto/.git`, which doesn't exist) and needs a local `main-dev` ref; ran
  the CI-equivalent `buf breaking --against "<repo-root>/.git#branch=main-dev,subdir=packages/proto"`
  after `git branch -f main-dev origin/main-dev`. Same check, correct path — CI-equivalent fallback.

### ⚠ Binding execution constraint (user, 2026-08-15) — shadcn-first UI
- **Hard requirement**: avoid custom components; use primitive or composite **shadcn** components as
  much as possible. Applies to every UI step (8-26, 32-33).
- **Already consistent with the design**: Step 32's indicator panels use the shadcn chart composite
  (`ChartContainer`/`ChartTooltipContent` from `@/components/ui/chart`, the same `FormulaRunResult.tsx`
  uses) + shadcn `Card`; the design already *rejected* hand-rolled lightweight-charts panes. This
  constraint reinforces that choice.
- **Execution rule for UI steps**: compose feature UI from shadcn primitives/composites (`Card`,
  `ChartContainer`, `ChartTooltip*`, `ChartLegend*`, `Badge`, `Table`, `Skeleton`, `Tabs`, etc.);
  if a needed primitive is absent from `src/components/ui/`, add it via `npx shadcn@latest add <name>`
  (per service CLAUDE.md § Styling) rather than hand-rolling. Feature components (e.g. `IndicatorPanels`)
  stay thin compositions of those. Sole allowed non-shadcn UI: the pre-existing candlestick chart
  (`useCandlestickChart`/`lightweight-charts`) — a documented sanctioned exception (no shadcn/recharts
  candlestick geometry), not introduced by this feature.

### Step 2 — proto-gen: regenerate stubs [done]
- Ran `./scripts/buf-gen.sh`; diff confined to `packages/proto/gen/{go,python,ts}/analysis/v1/` —
  new `criterionRawValues`/`criterionPassed` (map) fields on `ScreenResult` across all three
  languages. Second run produced no further change (idempotent). No other message touched.
- Files modified: `packages/proto/gen/{go,python,ts}/analysis/v1/` (generated)
- Deviations: none.

### Step 3 — service (xstockstrat-analysis): wire `criterion_raw_values`/`criterion_passed` [done]
- `_build_result` now populates `criterion_raw_values`/`criterion_passed` from the same
  `row["raws"]`/`row["passes"]` dicts, only for evaluated criteria (mirrors `criterion_scores`'
  skip contract); both passed into the `ScreenResult(...)` constructor. No new computation.
- TDD: red → green. red: `criterion_raw_values["f_pass"] == 0.0` (empty map) vs expected 0.8 →
  FAILED; green: `test_single_symbol_criterion_raw_values_and_passed` PASSED, ruff clean.
- Files modified: `services/xstockstrat-analysis/app/services/screener.py`
- Deviations: none.

### Step 4 — test (xstockstrat-analysis): single-symbol raw/passed fields [done]
- Added `test_single_symbol_criterion_raw_values_and_passed` to `tests/test_screener.py`: a
  single-symbol scan with pass/fail/skip criteria asserting `criterion_raw_values` = real reading,
  `criterion_scores` = collapsed 0.5 (the motivating contrast), `criterion_passed` = comparator
  result, and a skipped criterion absent from both maps.
- TDD: red (pre-Step-3: raw==0.0 vs 0.8) → green (post-Step-3: PASSED). Full suite: 515 passed,
  83.32% coverage.
- Files modified: `services/xstockstrat-analysis/tests/test_screener.py`
- Deviations: Step 4's Verification `pytest tests/test_screener.py --cov=app --cov-fail-under=40`
  measures app-wide coverage over a single test file (6.86% — unreachable by design). Ran the
  CI-equivalent full suite `uv run pytest --cov=app --cov-fail-under=40` (83.32%, matches CI's
  full-suite gate). **Disposition**: CI-equivalent fallback.

### ⚠ Binding execution instructions for the UI block (user, 2026-08-15)
- **Before starting the UI steps (7/8 onward): rebase onto `main-dev`** (pull latest, rebase/merge)
  so the UI work builds on current trunk.
- **Use the repo's new shadcn skill** when doing the UI steps (in addition to the shadcn-first
  constraint already recorded above). Locate the skill (plugin/skill in the repo) at that point and
  drive the shadcn component work through it.
- Both apply from Step 7/8 (first UI/docs steps) through Steps 32-33.

### Step 5 — service (xstockstrat-portfolio): fix `GetPosition` `account_id` passthrough [done]
- `PortfolioRepo.GetPosition` gained an `accountID` param + a conditional `AND account_id=$4`
  predicate (mirrors `ListPositions`); `portfolio_service.go:463` now passes `req.GetAccountId()`.
  Added a minimal `queryRower` interface + `db` field so the query is testable via pgxmock (Pool()
  still returns the concrete `*pgxpool.Pool` for sibling-repo reuse). golangci-lint: 0 issues.
- TDD: covered by Step 6's paired pgxmock test (red→green).
- Files modified: `internal/repository/portfolio_repo.go`, `internal/service/portfolio_service.go`
- **Deviation D-1 (in-scope, spec missed a caller — resolved by explicit user decision)**: the
  signature change surfaced a SECOND caller the spec didn't cite — `portfolio_service.go:257`, the
  order-fill avg-entry lookup, which upserts under `fill.AccountId` at :278. I first surfaced this
  as a fork (pass `""` to preserve behavior vs. scope to `fill.AccountId`). **User decided
  (2026-08-15): scope it to the account** — line 257 now passes `fill.AccountId`, fixing the
  write-path twin of the FR-14 read-path bug (a multi-account user's fill would otherwise compute
  avg-entry from the wrong account's position). Behavior-safe: when `fill.AccountId` is empty the
  predicate is skipped (identical to prior behavior); existing service/fill tests still pass
  (repository + service suites green, no regression). No longer a deferred latent defect — fixed
  in-scope under user sign-off.

### Step 6 — test (xstockstrat-portfolio): multi-account `GetPosition` regression [done]
- `TestGetPosition_ScopesToRequestedAccount` (pgxmock): requests the non-most-recent account,
  asserts the emitted SQL carries `account_id=$4` + the bound account arg, and that the requested
  account's row (qty/account_id) is returned. Added `github.com/pashagolub/pgxmock/v4` as the test
  dependency (user-chosen approach — no DB-integration harness exists and CI has no postgres).
- TDD: red (predicate neutralized → SQL lacks `account_id=$4` → pgxmock "could not match actual sql"
  → FAILED) → green (fix in place → PASS). Full suite: all packages `ok`, 55.9% coverage (≥40%).
- Files modified: `internal/repository/portfolio_repo_test.go`; `go.mod`/`go.sum` (pgxmock dep —
  F-08 lockfile exception, staged with the test that uses it).
- Deviations: **Disposition CI-equivalent fallback** — Step 6's `go test ./internal/repository/...`
  would need a live DB for the specced "seed two rows" approach, which CI lacks; used pgxmock
  (user-approved) to exercise the query offline. A benign `covdata` sandbox-toolchain warning
  appears on the no-test middleware pkg under `-race -coverpkg` but all packages pass and coverage
  computes.

### UI-block prep (2026-08-15) — rebase + shadcn skill (per user)
- Synced latest `origin/main-dev` (was 1 commit ahead) into the branch — clean merge; pushed. That
  commit **added the new shadcn skill** to the repo (`.claude/skills/shadcn` → `.agents/skills/shadcn/`).
- shadcn skill located and available; will invoke it for the UI component steps (8-26, 32-33) to
  drive `npx shadcn@latest` (project context, docs, add) and honor its critical rules (semantic
  colors, `gap`/`size-*`, full Card composition, `Chart` composite for recharts, `Skeleton`/`Badge`/
  `Alert`/`Empty` over custom markup). Step 7 is docs-only — no shadcn.

### Step 7 — docs: cross-segment client-reuse exception + nextjs-frontends.md correction [done]
- Added the feature-125 cross-segment-client sanctioned-exception bullet to
  `services/xstockstrat-ui/CLAUDE.md` (after the ChartPanel bullet). Rewrote `nextjs-frontends.md`
  §10: "two BFF files" → "one BFF file per segment" (`{trader,insights,configUi}Bff.ts` +
  `bffShared.ts`), corrected the "#1 BFF footgun" block (no basePath in the consolidated app → key
  the handler map on the FULL segment prefix `prefix + h.requestPath`, cite `bffShared.ts:105-119`),
  dropped the stale nginx claim, and added the cross-reference footnote to the exception.
- Verify: exception present (1), "one BFF file per segment" (1), "two BFF files" (0). ✓
- Files modified: `services/xstockstrat-ui/CLAUDE.md`, `docs/patterns/nextjs-frontends.md`
- **Deviation (recorded, not skipped)**: the mandated Teardown `/context-scrubber scan` could not run
  — the context-forge/context-scrubber plugin is **not available in this session** (only `strat-lab`
  is installed). Per root CLAUDE.md § Teardown, recording it here and in the PR body rather than
  skipping silently. The two edited files were self-reviewed against the spec's exact required text.

### Step 8 — service (xstockstrat-ui): page-structure refactor [done]
- `trader/positions/[symbol]/page.tsx` restructured so the price chart, Orders & fills, and a new
  Trade widget (`OrderForm`) render **independent of position** (top-level, for any symbol);
  extracted `SymbolPriceChart` + `SymbolOrdersCard` thin components reading page-level
  `avg/stop/last/hasStop`/`orders`/`working` locals (no `position.` reads). Added an always-on
  `<h1>{symbol}</h1>` heading below the breadcrumb; position-not-found now shows a compact inline
  `CardNotice` (not a page takeover). Render-order fix: a NotFound error routes to the notice, only
  a genuine error shows the error paragraph (`genuineError = error && !isNotFoundError`). `PositionBody`
  trimmed to header + stat tiles + sidebar (chart/orders removed; unused props dropped).
  `usePosition` (usePortfolio.ts) gained the NotFound-aware `retry` + `refetchInterval` guards
  (mirrors useStrategies.ts). All UI composed from shadcn primitives (Card/Badge/Skeleton/Table/
  Tabs/CardNotice) per the shadcn-first constraint — no new custom components beyond thin page-local
  compositions.
- Verify: `pnpm exec tsc --noEmit` clean; `pnpm lint` clean (only a pre-existing unrelated warning).
- TDD: paired e2e is Step 9. **Behavioral red-green deferred to CI** — the Playwright suite needs a
  240s Next.js build the sandbox can't reliably run (ledger: sandbox dev compiler too slow);
  verified structurally via tsc + lint (CI-equivalent). **Disposition**: CI-equivalent fallback.
- Files modified: `src/app/trader/positions/[symbol]/page.tsx`, `src/hooks/usePortfolio.ts`
- Deviations: e2e→CI fallback (above), applies to all UI `test` steps this session.

### Step 9 — test (xstockstrat-ui): unheld-symbol section rendering + render-order fix [done]
- Added two e2e tests to `position-detail.spec.ts` (unheld symbol ZZZZ renders chart/orders/trade +
  no Risk&exit sidebar; NotFound shows the notice, not the error paragraph). Changed
  `mock-backend.ts` `getPosition` to throw `Code.NotFound` for a symbol absent from the fixtures
  (mirrors the real RPC; the old `positionForSymbol` fell back to AAPL).
- **E2E RUN FOR REAL** (per user — the sandbox CAN run Playwright with a prod build):
  `NEXT_DISABLE_STANDALONE=1 pnpm build` then `CI=true E2E_PREBUILT=1 PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/opt/pw-browsers/chromium pnpm exec playwright test <spec> --project=chromium --workers=1`.
  (Dev-mode `next dev` is too slow — first-route compile exceeds the 10s test timeout; a prod build
  pre-compiles routes so tests run in ~1s each.)
- TDD red→green **behaviorally verified**: the two new tests were RED (CardNotice never rendered),
  which surfaced a **real bug in Step 8's page.tsx** — `positionNotFound` required `!error`, but a
  NotFound is an *error* state, so the notice never showed and neither did the error paragraph
  (nothing rendered for unheld symbols). Fixed: `genuineError = Boolean(error) && !isNotFoundError(error)`,
  `positionNotFound = !isLoading && !genuineError && !position?.symbol`, `error?.message` null-safety.
  After the fix: **all 6 tests pass (8.6s)**, including the 3 pre-existing held-position tests (so the
  Step 8 refactor didn't regress them).
- Files modified: `e2e/trader/position-detail.spec.ts`, `e2e/mock-backend.ts`, and
  `src/app/trader/positions/[symbol]/page.tsx` (the Step-8 fix the paired e2e caught — folded here
  rather than force-pushing an amend to the already-pushed Step 8 commit; the green-making change
  travels with the test that caught it, per the insights-ledger 072 pairing pattern).

### Step 10 — service (xstockstrat-ui): useReadiness/SignalReadiness NotFound handling [done]
- `useReadiness` (useOpportunities.ts) now mirrors `useBacktestDetail`: NotFound-aware `retry` guard +
  returns `isNotFound`. `SignalReadiness.tsx` branches on `isNotFound` before the generic error,
  rendering "This strategy no longer exists — pick another." (kept a `<p>` to match the sibling
  error/empty branches' idiom — consistent with the existing ternary chain).
- Verify: tsc clean, lint clean. TDD: paired e2e is Step 11.
- Files modified: `src/hooks/useOpportunities.ts`, `src/components/insights/SignalReadiness.tsx`

### Step 11 — test (xstockstrat-ui): SignalReadiness NotFound paired test [done]
- Mock `evaluateReadiness` throws `Code.NotFound` for sentinel `strat-notfound-readiness-01`
  (registered in `INVENTORY.md` Recurring-sentinel table, C-12). Added the NotFound test.
- **Deviation (ordering)**: the spec placed this test in `position-detail.spec.ts`, but
  `SignalReadiness` is not mounted on the positions page until Step 12 — so the red-green there is
  unreachable now. Put it in `e2e/insights/signal-detail.spec.ts` instead, the component's **current
  live mount** (`/insights/market/AAPL?strategy=strat-notfound-readiness-01`), giving a real
  runnable red-green for Step 10's shared-component fix. The positions-page assertion for this
  message lands when Step 25 relocates signal-detail coverage onto the unified page.
- E2E: **built + ran** — 5 passed (my new test green; it + the pre-existing @41 flaked once on
  cold-start then passed on retry — a run-level timing artifact, CI tolerates via retries, not a
  logic issue). Message renders on NotFound; generic error absent.
- Files modified: `e2e/mock-backend.ts`, `e2e/insights/signal-detail.spec.ts`, `e2e/fixtures/INVENTORY.md`

### Step 12 — service (xstockstrat-ui): watchlist gating + Opportunity/Readiness [done]
- Positions page gained `isSymbolWatchlisted`/`boundStrategyId` (scan `useWatchlists()` bindings,
  legacy `symbols[]` fallback) and the FR-11 gate: watchlisted → `OpportunitySection` (conviction as
  a deterministic ordinal + N/M conditions, action `EnumBadge`, thesis/source/strategy/expiry; no-data
  `CardNotice` when no matching Opportunity) + `<SignalReadiness>` in Suspense; non-watchlisted → null
  for now (Screening arrives Step 16); loading → Skeleton (no wrong-side flash). Opportunity tie-break
  replicates insights/market's `matches.find(o=>o.strategyId===boundStrategyId) ?? matches[0]`. All
  shadcn primitives (Card/Badge/Skeleton).
- Verify: tsc clean (fixed a `0n` bigint-literal → truthy check, matching the reference), lint clean.
- Files modified: `src/app/trader/positions/[symbol]/page.tsx`

### Step 13 — test (xstockstrat-ui): watchlist-conditional gating [done]
- Added a default empty `listWatchlists` to the mock (the page now calls it; specs override per-test).
  Two e2e: watchlisted AAPL (via `page.route` override on `ListWatchlists`) → Opportunity + "Why this
  fired" render; non-watchlisted → both absent.
- **Deviation (ordering)**: the spec's non-watchlisted assertion checks the Screening section, which
  doesn't exist until Step 16 — so I assert the testable-now half (Opportunity/Readiness ABSENT); the
  Screening-renders assertion lands in Step 17. Route pattern uses the full connect service name
  (`xstockstrat.portfolio.v1.PortfolioService/ListWatchlists`).
- E2E: **built + ran — all 8 pass (9.2s), no flakiness.**
- Files modified: `e2e/mock-backend.ts`, `e2e/trader/position-detail.spec.ts`

### Step 14 — service (xstockstrat-ui): Fundamentals section [done]
- Added `getFundamentals` to `traderBff.ts`'s MarketDataService block (the one genuinely new BFF
  registration — read-only, ungated). New `useFundamentals(symbol)` hook (`retry: false` — a no-data
  symbol errors, never NotFound). New `FundamentalsSection` in the watchlisted branch: metric grid
  (market cap/PE/PB/div yield/EPS/beta/ROE/D-E) via shadcn Card + `<dl>`, `stale` Badge, and an
  explicit no-data state surfacing the provider error message (treats ANY error as no-data per the
  step's corrected finding — Unavailable/FailedPrecondition/ResourceExhausted, not NotFound).
  New `e2e/fixtures/fundamentals.ts` (`FUNDAMENTALS_AAPL`) + barrel + INVENTORY row (C-12).
- Verify: tsc + lint clean; `getFundamentals` present in traderBff.
- Files: `src/lib/traderBff.ts`, `src/app/trader/positions/[symbol]/page.tsx`,
  `src/hooks/useFundamentals.ts` (new), `e2e/fixtures/{fundamentals.ts,index.ts}`, `INVENTORY.md`

### Step 15 — test (xstockstrat-ui): Fundamentals section e2e [done]
- Mock `getFundamentals`: `FUNDAMENTALS_AAPL` for AAPL, `Code.Unavailable` otherwise (matches the
  real no-data contract). Two e2e (watchlisted AAPL → metrics incl. P/E 31.40; watchlisted MSFT →
  explicit "No fundamentals data for MSFT"). Extracted a `watchlist(page, symbol)` helper (DRY — also
  adopted by Step 13's test). Fixed a strict-mode locator (heading role, not `getByText('Fundamentals')`
  which also matched "Loading fundamentals…").
- E2E: **built + ran — all 10 pass (11.1s).**
- Files: `e2e/mock-backend.ts`, `e2e/trader/position-detail.spec.ts`

### Step 16 — service (xstockstrat-ui): single-symbol Screening section [done]
- New `src/components/trader/SymbolScreening.tsx` (`{ symbol }`) — a minimal ad hoc criteria builder
  reusing the full Screener's `newCriterion`/`buildCriterion` shape (kind/metric/comparator/threshold,
  TECHNICAL_INDICATOR→`component` vs FUNDAMENTAL→`metricName` branch) but scoped to `[symbol]`. Runs
  `useScreenSymbols().mutate(...)` (cross-segment `analysisClient`, Step 7 exception). Displays ONLY
  the per-criterion `criterionRawValues`/`criterionPassed` maps (ref_name-keyed) + the client-echoed
  threshold — **never** the universe-collapsed composite rank readings (grep guard clean). Skipped
  criterion (absent from maps) → em-dash; INSUFFICIENT_DATA → explicit Badge+message with the gap.
- **shadcn-first (hard req)**: composed entirely from Card/Badge/Button/Input/Select/Table + shared
  Eyebrow — unlike the reference Screener page's raw `<select>`, all three pickers are shadcn `Select`.
  Pass/Fail use the app-specific `buy`/`sell` Badge variants.
- Mounted in `page.tsx`'s FR-11 non-watchlisted branch (Step 12's `isSymbolWatchlisted` gate,
  inverted — previously `: null`).
- Extended `e2e/fixtures/screenResults.ts` with `criterionDetailRow(symbol, raw, passed, refName='c1')`
  (carries `criterionRawValues`/`criterionPassed`, leaves score/criterionScores at proto defaults);
  updated the INVENTORY "Screener results" row description (same module, not a new file).
- **DRY guard rail (pre-commit) caught two clones** between the new component and the launched
  `insights/screener/page.tsx` (the comparator/kind option lists + the add/remove/update criteria
  trio). Resolved the correct way — extracted a shared `src/lib/screenCriteria.ts` (`CriterionRow`,
  `COMPARATOR_LABELS`, `KIND_OPTIONS`, `comparatorGlyph`, `newCriterion`, `useCriteriaList` hook,
  `buildScreenCriterion`) and refactored **both** the screener page and `SymbolScreening` to consume
  it. jscpd now reports 0 clones. Re-verified the launched Screener with its own e2e (21/21 green) so
  the refactor of a shipped page is regression-free.
- Verify: tsc clean (full project), lint clean, grep guard `criterion_scores|\.score\b` → no hits,
  `check-duplication.sh` → 0 clones.
- Files: `src/lib/screenCriteria.ts` (new), `src/components/trader/SymbolScreening.tsx` (new),
  `src/app/insights/screener/page.tsx` (refactored onto the shared module),
  `src/app/trader/positions/[symbol]/page.tsx`, `e2e/fixtures/screenResults.ts`,
  `e2e/fixtures/INVENTORY.md`

### Step 17 — test (xstockstrat-ui): Screening section e2e [done]
- Mock `screenSymbols`: added a `req.symbols.length === 1` branch returning `criterionDetailRow(sym,
  42.5, true)` (ref_name `c1` = SymbolScreening's default first criterion); the multi-symbol ranked
  path is untouched. Imported `criterionDetailRow` directly from `./fixtures/screenResults` (that
  module is not in the `./fixtures` barrel — the build caught the missing barrel export).
- E2E: non-watchlisted AAPL → Screening section renders, default criterion runs, row shows raw `42.50`
  + a `Pass` badge; asserts no "Score" text anywhere in the section (composite score never surfaced).
  Scoped the Pass badge locator to `symbol-screen-row` (strict-mode: "Pass" also the column header).
- E2E: **built + ran — position-detail 11/11 + screener 21/21 = 30/30 pass (27.8s).**
- Files: `e2e/mock-backend.ts`, `e2e/trader/position-detail.spec.ts`

### Checkpoint (after Step 16/17) — 17/33 steps done
- Steps 12–17 (Opportunity/Readiness gating, Fundamentals, single-symbol Screening) + their e2e all
  green. Backend prereqs (1–6), shared-component fixes (8–11), and docs (7) done earlier. Next:
  Steps 18–21 (Backtests + Backfill sections), then 22–26 (page retirement/nav/cross-cutting proofs),
  then the FR-6 indicator-overlay-panel block (27–33).

### Step 18 — service (xstockstrat-ui): Backtests section [done]
- New local `BacktestsSection` in `page.tsx`, mounted unconditionally (always-on, FR-9) after the
  watchlist split. Resolves `strategyId = boundStrategyId || owningStrategy` (Step 12's binding, else
  Step 8's orders-derived owner). Calls `useBacktestHistory(strategyId || undefined)` and
  **client-side filters** `runs` to `r.symbols.includes(symbol)` (the accepted narrower coverage).
  History-list only (When/Return/Sharpe/Trades) — no embedded per-run detail, no `GetBacktest` call.
  "Run backtest" → `useRunBacktest().mutate({ strategyIdRef, symbols:[symbol], initialCapital:100000,
  range: 2024 })` (fixed default window/capital matching the reference runner), invalidates
  `['analysis-backtests', strategyId]` on success. No-resolvable-strategy → explicit no-data card
  (no run button). shadcn Card/Button/Table.
- Verify: tsc clean, lint clean.
- Files: `src/app/trader/positions/[symbol]/page.tsx`

### Step 19 — test (xstockstrat-ui): Backtests section e2e [done]
- **No mock change needed** — the existing `listBacktests` already returns an AAPL run (bt-hist-2)
  + an MSFT run (bt-hist-1) for `strat-history-001`, and `runBacktest` returns a valid (non-thrown)
  result for it. Generalized the `watchlist(page, symbol, strategyId='strat-live-001')` helper to
  bind an explicit strategy (backward-compatible default).
- E2E: (1) AAPL bound to strat-history-001 → Backtests table shows exactly 1 row (the AAPL run at
  15.00%), the MSFT-only run (-3.00%) excluded — proves the client-side symbols filter; Run backtest
  completes without error. (2) ZZZZ (no binding, no orders) → "No strategy resolves for ZZZZ" state.
- E2E: **built + ran — position-detail 13/13 pass (13.6s).**
- Files: `e2e/trader/position-detail.spec.ts`

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
- [ ] FR-9's narrower backtest-coverage wording — already corrected in product-spec.md this session;
  no further action needed unless `/sdd-spec` finds the wording insufficient.
- [ ] Always-fully-rendered composite page (7+ sections firing RPCs on every visit) — performance/UX
  risk named but not stress-tested in the design debate; flag as a pre-launch QA check.

**Next**: `/sdd-spec unified-symbol-page`.

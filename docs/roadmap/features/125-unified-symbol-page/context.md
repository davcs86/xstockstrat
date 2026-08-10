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

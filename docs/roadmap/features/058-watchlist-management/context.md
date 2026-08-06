# Context: watchlist-management  (archived 2026-08-06)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-06 — /sdd-archiver

**What**: Shipped as designed — `xstockstrat-portfolio` owns watchlist CRUD (7 additive RPCs), mode-agnostic (no `trading_mode`), hard-delete + ledger audit, new insights `/insights/watchlists` page. All 10 implementation-spec steps landed with zero scope changes; only an unplanned WKT regen ride-along.
**Why (irrecoverable rationale)**: Mode-agnostic because "a screening universe is mode-independent; positions are mode-scoped because fills are" — deliberate asymmetry vs. `portfolio.positions` (product-spec.md Resolved Decisions OQ-058-a, now deleted). Owned by portfolio (not identity) because it "already scopes everything by `user_id` and is the screener's natural neighbor; identity stays auth-only" (OQ-058-b/c). Hard delete chosen because the append-only ledger *is* the audit trail — no tombstone needed.
**Rejected alternatives**:
- Count-based feature numbering — lost because repo has duplicate `020`/`052`, which would have produced `059` and orphaned `058`; used `max+1` instead (context.md 2026-06-26).
- Per-step PRs for execute — lost in favor of one integration PR for the whole feature branch (context.md 2026-06-29).
**Scars & gotchas**:
- `buf-gen.sh` regen (CI-pinned plugin versions) rewrote unrelated `gen/ts/google/protobuf/timestamp.{ts,d.ts}` (WKT comment refresh) — committed anyway because `proto-freshness` CI regenerates with the same buf and would flag them stale otherwise (implementation-spec.md Deviation Log; context.md 2026-06-29 Step 2).
- CLAUDE.md's "TradingRepo.Pool()" accessor note does **not** generalize — `PortfolioRepo`'s pool was unexported with no `Pool()` accessor and one had to be added (context.md 2026-06-27 sdd-spec findings).
- This feature introduced portfolio's **first** `PermissionDenied`/`connect.CodePermissionDenied` path — `toGRPCError` switch had no prior case for it (context.md 2026-06-27).
- Local Playwright E2E hit a chromium/chrome-headless-shell mismatch (image only has chromium-1194); worked around with an uncommitted throwaway config override (context.md 2026-06-29 Step 9).

**Permanent deviations**: none.
**Permanent deviations**: none
**Cross-feature signal**: - Config-migration number `006` was pre-claimed across three sibling features in the screener initiative (058=006, 059=007, 062=008) at design-review time and recorded in merge-order.md, because golang-migrate applies numerically — reactive per-PR collision resolution wouldn't have worked (context.md 2026-06-27 impl-spec review).
**Deferred follow-ons**:
- Add `trading_mode` scoping later only if a concrete need appears (product-spec Resolved Decisions, now deleted).
- Sharing watchlists between users and auto-population from signals — explicitly out of scope, left for a future feature.
**Ledger entries written**: insights.md (2), fails.md (1) — see the 2026-08-06 entries.
**Runtime-invariant recommendations (→ /context-constitution)**:
- PORTFOLIO-* candidate: `PortfolioRepo.pool` was unexported with no accessor prior to this feature; portfolio's CLAUDE.md pool-accessor guidance should not be assumed to match trading's. Route to `services/xstockstrat-portfolio/docs`.
- PORTFOLIO-* candidate: `toGRPCError`'s adapter switch had no `PermissionDenied` mapping before this feature — now the first precedent for ownership-check errors in portfolio.
**Pruned artifacts**: product-spec.md, implementation-spec.md — last present at f871138.

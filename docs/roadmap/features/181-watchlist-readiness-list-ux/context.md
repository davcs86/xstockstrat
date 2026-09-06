# Context: watchlist-readiness-list-ux

**Feature**: `docs/roadmap/features/181-watchlist-readiness-list-ux/feature.md`
**Product Spec**: `docs/roadmap/features/181-watchlist-readiness-list-ux/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/181-watchlist-readiness-list-ux/implementation-spec.md`

---

## Session 2026-09-06 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- Origin: operator UI follow-up to feature 180. Two consumer-surface problems on
  `/insights/watchlists`: (1) N+1 readiness fan-out leaves the list blank-until-all with no per-row
  loading indicator — wants the read path to optionally decorate readiness + a per-row loading state;
  (2) no pagination — a long watchlist renders/fans out every symbol at once.
- **Core design fork carried to /sdd-design (FR-4):** where the readiness decoration lives, without a
  cycle. analysis→portfolio already exists, so portfolio must NOT call analysis. Options: (A)
  analysis-side batch/paginated readiness RPC, (B) optional readiness field on a response, (C)
  ui BFF server-side aggregation. Plus a progressive-stream vs one-shot decision.
- Prior art: feature 180 (materializer + FAST cache — makes warm decoration cheap), 177 (cache), 176
  (concurrency).
- Ledger traps surfaced into Open Questions: every new BFF gRPC call needs an e2e mock
  (fails.md:1281, 1317 proto3 flattened-oneof shape); update every BFF call site (fails.md:1138); BFF
  error passthrough must not collapse to HTTP 400 (fails.md:552); Option B on an agent-projected
  message trips the descriptor-parity test (fails.md:1151); nav reachability C-10 (fails.md:71 — N/A
  here, existing page).
- Consumer surface (C-14): UI `/insights` (`/insights/watchlists`) — existing page, no new nav route.
- Branch note: PR #1102 (feature 180) merged; per the merged-PR rule the designated branch
  `claude/watchlist-stock-list-perf-o3qoqb` was restarted from the updated `main-dev` (180 present)
  before filing this feature.

## Session 2026-09-06 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Criteria: PASS WITH WARNINGS (spec-reviewer), no blockers, no Floor breach. All cited UI files
  exist; /insights/watchlists confirmed in PLATFORM_SUBNAV (existing page, no nav debt).
- 3 advisory warnings — ALL FIXED this session before moving on:
  1. C-17 (new loading/error states + pagination not bound to canonical primitives) → added FR-7 +
     @AC-6 requiring the shared C-17 skeleton/query-state/empty primitives + a11y baseline
     (aria-busy/role=status, keyboard-operable labeled pagination).
  2. @AC-5 Then was an architectural invariant → firmed to concrete checkable assertions (portfolio
     declares no AnalysisService client/stub; root CLAUDE.md dep graph gains no portfolio→analysis edge).
  3. Open Questions mixed genuine design forks with "known traps" → reclassified: 3 forks stay as
     /sdd-design inputs; the 4 BFF/proto traps moved to a "Known Traps & Constraints" section.
- Overlap: CLEAN — no shared config key / proto field / migration NNN; no merge-order row needed
  (180/177/176 already in main-dev). Surfaced constraint (added to spec): the useQueries rewrite must
  PRESERVE 177's staleTime:30_000 cadence + 180's warm-cache FAST path (WatchlistReadiness.tsx:186-200).
  Conditional 032↔181 analysis.proto overlap (if 181 picks Option A) is rebase-only — recheck at Mode B.

## Session 2026-09-06 — sdd-design (recon + 2-round debate)

- **Phase 0 Recon** written to `recon.md` (codebase map, patterns to reuse, C-16 existing business
  rules, risks R1-R5, decoration-owner options A/B/C).
- **Phase 1 grilling — Round 1.** Proposer chose Option A with **client-supplied `(symbol, strategy_id)`
  pairs**. Adversary NEEDS WORK — decisive **IDOR** (fails.md:1153): a client-supplied `strategy_id`
  lets a caller request readiness for a non-owned strategy and leak `SymbolReadiness.conditions` rule
  internals. Recommended Option C or the `watchlist_id` runner-up.
- **Operator steering (reshaped the design).** Chose the runner-up but decoupled the cycle: the watchlist
  stock-list RPC **decorates from cache**, fans out a background refresh for not-fresh entries, and
  returns a **pending** state so clients poll; **payload bounded to cached data**. → IDOR closed
  structurally by keying on `watchlist_id` (server derives pairs from the owner's own watchlist).
- **Round 2.** Proposer grounded the cache-first `GetWatchlistReadiness(watchlist_id, page)` design;
  adversary NEEDS WORK with two decisive objections + conditions:
  - **Obj 1 (BLOCKER-sev).** `valid_until`-only inline freshness drops the authoritative `bar_epoch`
    conjunct of `is_readiness_row_fresh` (`readiness.py:16-28`); the `stale_after < 86400` bound caps
    bar-staleness at one bar but does not eliminate it — a stale `RESOLVED` verdict with no self-heal
    path (a C-16 @AC-2 regression + product-spec out-of-scope violation).
  - **Obj 7 (BLOCKER-sev).** Offset paging drifts (skip/dup on concurrent rebind) vs the cited keyset
    precedent.
  - Obj 3/4/5/6: two row-list sources (keep `['watchlists']` for management/in-queue/provenance), kick
    dedupe via guard-set not blocking lock, N+1-kill contingent on the 180 materializer, @AC-6 preserved
    by the separate query key.
- **Operator forks resolved at the gate (AskUserQuestion):**
  1. **Inline freshness = Probe-gate (keep @AC-2)** — gate `RESOLVED` on the full `is_readiness_row_fresh`
     predicate via one cheap `GetDataCoverage` probe per distinct page symbol (still cache-only compute:
     no bars fetch, no re-eval). Rejected pure-cache (window-only) — would have needed C-16 CHANGE sign-off.
  2. **PENDING resolution = Poll the new RPC** — pending rows resolve by re-fetching the page-bounded
     `GetWatchlistReadiness`, not the old per-strategy `EvaluateReadiness`. Overrides the initial "poll the
     old endpoint" steering (which re-introduced the N+1 + double-computed with the kick).
- **All engineering-only conditions settled with safe defaults** (not operator forks): keyset paging;
  retain `['watchlists']` for the management surface + layer `['watchlistReadiness']` only for the verdict
  column; guard-set kick dedupe; document the materializer-contingent N+1 win (R-B).
- `design.md` written; status `spec-ready` → `design-approved`. Open risks R-A..R-D carried to /sdd-spec.
- Branch: work continues on `claude/watchlist-stock-list-perf-o3qoqb` (PR into main-dev).

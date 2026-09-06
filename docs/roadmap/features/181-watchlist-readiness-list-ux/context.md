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

# Context: fundsignal-watchlist-universe

**Feature**: `docs/roadmap/features/154-fundsignal-watchlist-universe/feature.md`
**Product Spec**: `docs/roadmap/features/154-fundsignal-watchlist-universe/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/154-fundsignal-watchlist-universe/implementation-spec.md`

---

## Session 2026-08-24 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from the operator
  story: implement feature 062's deferred FR-3 (global cross-user watchlist union) so the fundamentals
  producer's `analysis.fundsignal.universe_source=watchlists`/`both` stops silently falling back to the
  `explicit_symbols` CSV.
- **Origin:** grew out of a config session where the composite scoring formula
  (`analysis.fundsignal.scoring_formula_id = d1ff5e6b-6d9c-589d-b95e-defd862c702b`) was set in **staging**
  and the producer's `enabled=true` was found effectively inert because `_resolve_universe` returns the
  (empty) explicit CSV for the `watchlists` source. The operator asked to implement the watchlists
  universe as originally proposed.
- **Grounding read:** feature 062 `context.md` archive synthesis — _"Global watchlist union via a new 058
  RPC — deferred; 058's ListWatchlists is user-scoped … shipped code fell back to explicit"_ and deferred
  follow-on _"A true global-union watchlist RPC in 058 would let the producer drop its explicit fallback."_
- **Current code anchor:** `services/xstockstrat-analysis/app/engine/fundsignal_loop.py:203-218`
  (`_resolve_universe` — `watchlists`/`both` both `return explicit`).
- **Relevant existing surface:** `packages/proto/portfolio/v1/portfolio.proto` PortfolioService already
  has user-scoped `ListWatchlists` and the feature-127 `EnsureSignalWatchlist` / `Watchlist.system_managed`
  "Signals" list. The analysis→portfolio edge (`PORTFOLIO_ENDPOINT`) already exists (added by feature 062).
- **Open forks recorded for /sdd-design** (product-spec § Open Questions): (1) all watchlists vs. only the
  system-managed "Signals" list; (2) enumeration returns bare symbols vs. `(symbol,strategy)` bindings;
  (3) admin `x-access-scope` bit vs. `x-internal-caller` allow-list for authz; (4) unbounded-union
  ordering/truncation fairness under the existing cap.
- **Known traps flagged** (from ledger): harness-branch (`claude/fundamentals-signal-config-0jdfed`)
  vs. feature dev branch divergence (fails.md 082) — must reconcile before /sdd-execute; absence-claim
  greps (fails.md 080).
- **Feature-numbering collision HIT and corrected (2026-08-24):** originally allocated `153`, verified
  free on the local tree + a `git ls-remote` name-grep — but that grep missed sibling branches that had
  a `153-*` dir without a matching branch name. The operator flagged the collision. A proper all-remote
  `git ls-tree docs/roadmap/features/` scan then found `153` taken twice (`153-fix-ohlcv-chunk-lock-oom`
  on `claude/do-logs-shared-memory-0o994w`, and this feature). Renumbered **153 → 154** (next free across
  all remotes) per the docs/runbooks/feature-workflow.md renumber-the-later-run rule. This is the exact
  fails.md 2026-07-29/081 trap: the numbering scan must `git ls-tree` every remote branch's feature dir,
  not grep branch names.

- **Fork resolved (operator, 2026-08-24):** universe = **all watchlists across all users**, not only the
  system-managed "Signals" lists (Open Question #1 closed in product-spec). Enumeration spans all
  watchlist rows regardless of `system_managed`.

## Session 2026-08-24 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Criteria verdict: PASS WITH WARNINGS. Warnings (advisory, all deferred to /sdd-design):
  - Open Question: enumeration shape — bare symbols vs `(symbol, strategy)` bindings.
  - Open Question: access-control mechanism — admin `x-access-scope` bit vs `x-internal-caller` allow-list.
  - Open Question: unbounded-union ordering/truncation fairness under the existing cap.
- Overlap findings: none (CLEAN). No other in-flight feature touches `portfolio.proto`, adds a
  `PortfolioService` RPC, or edits `fundsignal_loop.py`. Feature 142 is thematically adjacent
  (fundamentals) but concretely disjoint (marketdata `UpsertFundamentals`). No merge-order entry needed.

## Next

`/sdd-design fundsignal-watchlist-universe` (full mode — operator requested).

## Session 2026-08-24 — sdd-design (full mode, 4 rounds)

- recon.md + design.md written; status spec-ready → design-approved.
- **Chosen approach:** additive `ListAllWatchlistSymbols` portfolio RPC (empty req, `repeated string symbols`),
  `SELECT DISTINCT symbol FROM portfolio.watchlist_symbols ORDER BY symbol` (no migration), gated by a new
  Go `x-internal-caller` allow-list (`internal/service/authz.go`, grant `analysis-fundsignal`); analysis
  `_resolve_universe` rewrite consuming it.
- **Round decisions (operator-gated each round):**
  - R1 — authz = `x-internal-caller` allow-list, NOT the admin `x-access-scope` bit (PR #994; feature-092
    self-asserted-admin removal; analysis "self-granted admin scope" recorded defect).
  - R2 — Go gate reads `metadata.FromIncomingContext(ctx)` (NOT `connect.Request.Header()`, which the
    grpc adapter fabricates empty); analysis APPENDS metadata (`list(metadata)+[(hdr,caller)]`) to keep
    the manual-RPC path's `x-trace-id` (C-03); named the 5 fail-closed gate tests + a new incoming-metadata ctx builder.
  - R3 — kept `{callerID, rpc}` grant (config least-privilege precedent); DISTINCT is sub-ms unindexed
    (no migration); truncation uses a stateless rotating offset so no user is permanently starved.
  - R4 — **operator directive:** truncation applies ONLY when FMP is the active provider
    (`marketdata.fundamentals.provider == "fmp"`, read boot-frozen via a NEW second
    `ConfigWatcher(namespace="marketdata")` — WatchConfig is per-namespace); non-FMP = full union, no
    `max_symbols` cut, full coverage across cycles via existing deferral (NOT `budget=len`, which would
    hide Finnhub rate-limit drops under a false `completed`). Unknown provider → conservative capped path,
    no provider literal baked in (drift-guard, fails 2026-08-13).
- **New requirement FR-7** (FMP-gated truncation) + **new scenarios AC-8** (both+outage→CSV), **AC-9**
  (non-FMP full union). AC-6 conditioned on FMP-active.
- **Governance:** analysis→marketdata cross-namespace WatchConfig subscription is unprecedented — to be
  recorded as a config-governance note + a new `PORTFOLIO-*` invariant (first cross-user per-user-data read).
- **Numbering:** feature is **154** (renumbered from 153 by the harness after the `153-fix-ohlcv-chunk-lock-oom`
  collision). A stray untracked `153-fundsignal-watchlist-universe/` (a duplicate recon/design written before
  the renumber was noticed) was removed; design.md moved onto 154.
- **Branch:** work rides the harness branch `claude/fundamentals-signal-config-0jdfed` (harness mandate),
  PRs target `main-dev`; the `feature/…` dev-branch name in feature.md is nominal (fails-082 divergence, accepted).

## Next

`/sdd-spec fundsignal-watchlist-universe` — implementation spec.

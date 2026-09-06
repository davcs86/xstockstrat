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

### Round 3 (operator-requested) — close Obj 3-7

Ran a third proposer→adversary round to convert the engineering-only conditions (Obj 3-7) from
"settled by default" into code-verified, testable design decisions. Adversary verdict: **all CLOSED /
CLOSED-WITH-CONDITION, no Floor breach, no blocker.** design.md + recon.md tightened accordingly.

- **Obj 3 (two row sources) — CLOSED.** Keep `['watchlists']` as the row source; the readiness Row carries
  no affordance field. Affordance provenance verified in code (in-queue ← `useOpportunities`; provenance ←
  `binding.source`; system-managed ← `watchlist.systemManaged`; cues/blocking/firing ← the verdict; jump
  href ← `binding.strategyId`). **Dropped the redundant `source` Row field** (was field 3). Verdict cells
  keyed by `(symbol, strategy_id)` (composite — more correct than today's `symbol`-only key when a symbol
  binds multiple strategies). R-D resolved (verified, not deferred).
- **Obj 4 (kick dedupe) — CLOSED w/ condition.** Guard-set per `(owner, strategy_id, symbol)`
  (`self._readiness_kicking`), materializer bars sem (`servicer.py:443`) not the interactive one, idempotent
  upsert. **NEW R-E (highest priority):** cache-read-only + probe-gate introduces an **infinite-PENDING**
  trap (coverage OK but bars-fetch persistently fails → `bar_epoch=0 >= latest>0` False forever) — must
  bound to `PENDING`→`UNKNOWN` after N polls (FR-5/@AC-2). **NEW R-F:** materializer-sem reuse couples
  `max_concurrent_bars_fetches` to on-read kicks — document it.
- **Obj 5 (contingent N+1) — CLOSED w/ condition.** Verified the 24h vs 30s stamp sites differ
  (`servicer.py:3923` vs `:2825`); the kick stamps 24h so a warmed page stays RESOLVED (probe-gate still
  busts on new bar → not a staleness hole). **R-B SPLIT:** FR-1 + FR-2 unconditional; FR-6 (FAST *first*
  render) contingent on the 180 loop (default off) — document the prerequisite, do NOT flip the default.
- **Obj 6 (@AC-6) — CLOSED w/ condition.** Verified `WATCHLISTS_KEY=['watchlists']` single+bulk no-invalidate
  patch (`useWatchlists.ts:7,140-155,180-192`) untouched by the disjoint readiness key. **NEW gap folded
  into client behavior:** five existing `['watchlists']` invalidators (create/update/delete/add/remove) don't
  refresh the readiness key → a just-added symbol renders with no readiness entry; "hasPending" must be
  computed from the *rendered* (binding⋈readiness) rows, else the new row hangs on Skeleton.
- **Obj 7 (keyset) — CLOSED + citation fix.** Verified `ListOpportunities` is **offset**
  (`servicer.py:3148-3155`), NOT the keyset precedent; corrected the citation in design.md **and**
  recon.md:34 → **`ListPositions`** (`portfolio_repo.go:155-166`). Composite `(symbol, strategy_id)` cursor
  = opaque base64 in `common.PageRequest.page_token` (a `string`, `common.proto:12`); a net-new lexicographic
  extension of the single-column ListPositions keyset. Keyset bounds compute+response, not the portfolio read.
- **Also corrected:** design.md step 1 anchors `GetWatchlist` to a new method on the existing `self._portfolio`
  stub (RPC `portfolio.proto:22`), not the `ListWatchlists` drain line — no new edge (F-06 clean).
- All conditions are /sdd-spec obligations (R-A..R-F); no new operator fork. design.md at 3-round state.

### Round 4 (operator-requested) — mechanize the infinite-PENDING trap (R-E) + polish

Ran a fourth proposer→adversary round to convert R-E (and R-A/R-F residuals) from deferred conditions
into concrete, code-verified mechanisms.

- **Proposer:** R-E solvable with a *stateless* server predicate over existing `readiness_cache` columns —
  no schema change. Distinguish data-unavailable (→UNKNOWN) from not-yet-recomputed (→PENDING) via
  `computed_at` recency + `bar_epoch < lbe`.
- **Adversary — STILL-OPEN (the recency predicate is defective):** it **misfires** on the normal
  new-bar-at-close case — a row computed seconds before a daily bar closes is *recent* and *trails* the new
  `lbe`, so the recency predicate would paint a healthy not-yet-recomputed row as UNKNOWN (an error state)
  and suppress its legitimate refresh for ≤5 min once/day (a C-16 @AC-2 / feature-177 regression). Also
  proved `bar_epoch == 0` is insufficient: the benchmark is loaded once per request independent of each
  symbol's primary fetch (`servicer.py:2768-2770`), so a benchmark-present strategy whose primary bars fail
  writes `bar_epoch = benchmark_epoch > 0` — the trap stays open for benchmark strategies. Conclusion: only
  an explicit failure marker written by `compute_readiness_row` is correct. Adversary also flagged a
  **recovery gap** (client polled only while PENDING + UNKNOWN terminal + no kick → UNKNOWN never recovers
  without remount).
- **OPERATOR DECISION (AskUserQuestion):** chose **"Sentinel in shared compute"** — `compute_readiness_row`
  stamps `bar_epoch = -1` on a primary-bars-fetch exception; classifier maps `bar_epoch < 0 → UNKNOWN`.
  **Explicitly accepted the scope deviation:** this edits the compute path SHARED by the interactive
  `EvaluateReadiness` handler and the feature-180 materializer, so it is a (more-correct) behavior change to
  shipped features 177/180 — exceeding 181's "presentation + read-shape only" scope. **This is a recorded
  operator override of that scope boundary (C-11 Commandment / P-03 no-silent-deviation).** Rejected the
  bounded-transient (ships a false UNKNOWN) and the new `bars_ok` column (breaks F-06 no-schema).
- **Verified facts (this session):** `readiness_cache.bar_epoch` is `BIGINT NOT NULL` with no non-negative
  constraint (`migrations/022_readiness_cache.up.sql:14`) → `-1` sentinel is schema-safe. The durable
  readiness suite is `readiness-caching-poll-discipline.feature` (exists in analysis + ui acceptance) —
  the R-A regression home; `platform.feature` DOES exist (cross-cutting suite) so recon.md:55's reference
  to it stands (the adversary's "platform.feature missing" claim was wrong).
- **Recovery mechanism folded in:** UNKNOWN rows are re-kicked, **rate-limited** by a `computed_at` cooldown
  (`now - computed_at > _READINESS_UNKNOWN_RETRY_SECONDS`, 300s module constant — stateless, no config key)
  so a persistently-down source retries ≤ once/5min; the client keeps polling while any rendered row is
  **PENDING OR UNKNOWN**, so recovery is observed without a manual reload.
- **Constants pinned:** poll interval 30_000ms (UI const, matches 177), page size 25 (UI const),
  `_READINESS_UNKNOWN_RETRY_SECONDS` 300 (module const beside `_READINESS_LOOKBACK_DAYS`). None are config keys.
- **R-F:** reuse the materializer bars-sem for on-read kicks (no new config key); document the coupling in
  `analysis/CLAUDE.md` (a /sdd-spec obligation).
- design.md updated to 4-round state (classifier rewritten, sentinel + recovery in step 5, two rejected
  discriminators added, R-A/R-E resolved). **New /sdd-spec obligation:** RED-test the sentinel write + the
  four-way classifier, and re-verify feature-177 @AC-2 in the same PR (shared-compute change).

### Round 5 (operator-requested) — final holistic coherence pass

Ran a fifth adversary pass over the COMPLETE design.md end-to-end. **Verdict: APPROVE — approvable as
written, no required design.md edit.** Confirmed: (a) the four-way state machine
(`bar_epoch<0→UNKNOWN / fresh→RESOLVED / else→PENDING`) is described identically in every section — no
leftover "stale/missing→PENDING" binary, no "poll only while PENDING" phrasing; (b) the `-1` sentinel
blast radius is complete — one writer (`readiness.py:82`), three readers all via the `is_readiness_row_fresh`
`>=` predicate (decorated classifier checks `<0` first; interactive FAST gate → SLOW recompute, its response
built from `readiness_json` not `bar_epoch` so unchanged; materializer skip-fresh → recompute), no
sort/arithmetic/metric consumes `bar_epoch`; (c) no pair can get permanently stuck; (d) a successful-EMPTY
fetch (distinct from the exception path) is NOT stranded — probe window (10d) ⊂ fetch window (400d), so
empty fetch ⇒ `lbe=0` ⇒ RESOLVED best-effort, so the sentinel correctly targets only the exception path;
(e) every FR-1..7 / @AC-1..6 still maps, dropping `source` orphans nothing, `GetWatchlist` is a pre-existing
RPC (F-06 clean). No Floor breach; no ledger repeat.
- **One optional polish folded in:** R-E's re-verification obligation now names feature-177 **@AC-1** as well
  as @AC-2 — the shared-compute edit changes only the *failure* stamp, so /sdd-spec must assert the
  happy-path FAST skip for *successful* symbols is unchanged, not just the bar-bust. (The stale Round-2
  Operator-Decisions phrasing was left as-is per the adversary — it is the historical decision ledger,
  superseded by the authoritative current client spec.)
- Design is settled at 5 rounds (full-mode cap). Ready for /sdd-spec.

## Session 2026-09-06 — sdd-spec

- Generated implementation-spec.md with 12 steps. Status → implementation-ready.
- Reused recon.md's grounded Codebase Map + design.md as authoritative inputs; re-verified every
  load-bearing citation against the live tree (proto, servicer, readiness compute, cache, UI
  component/hook/BFF, e2e mock homes, migration, buf lint config) before writing steps.
- Step order: proto (1) → codegen (2) → shared-compute `-1` sentinel + test (3–4, the R-E fix that
  touches shipped 177/180 — operator-approved scope deviation) → new `GetWatchlistReadiness` handler
  + test (5–6) → UI hook/component/BFF/mock (7–10) → UI e2e (11) → docs (12).
- Scenario coverage (C-15): AC-1/AC-2/AC-6 → Step 11 (UI e2e); AC-3/AC-4 → Step 11 + Step 6 (backend
  FAST serve + keyset paging); AC-5 (no cycle) → Step 6 (structural grep + handler edge assertion).
- Key codebase findings:
  - **Grounded correction to design.md's enum shorthand:** `buf.yaml` uses `STANDARD` lint (no
    `ENUM_VALUE_PREFIX` exception) and every existing enum prefixes its values
    (`CONDITION_STATE_*`, `READINESS_RULE_*`). The design's `RESOLVED=1` shorthand would fail
    `buf lint` (C-09) — the spec writes `READINESS_STATE_UNSPECIFIED/RESOLVED/PENDING/UNKNOWN`.
  - `AnalysisService` block `analysis.proto:12-53`; last RPC `GetAttribution` `:52`; readiness
    messages at `:595-649`; `common.PageRequest{page_size=1,page_token=2}` / `PageResponse` at
    `common.proto:10-16`. New RPC + messages are additive (non-breaking).
  - `EvaluateReadiness` handler (`servicer.py:2727+`) is the exact template for the new handler:
    `_caller_user_id` (`:492`/`:2746`), `get_by_owner_and_id` (`strategies.py:66`),
    `_definition_fingerprint` (`:4706`), `GetDataCoverage` probe loop (`:2835-2850`,
    `_READINESS_COVERAGE_PROBE_DAYS=10` `:258`), `read_many`/`is_readiness_row_fresh`/
    `_symbol_readiness_from_json`/`compute_readiness_row`. Kick template `_kick_opportunity_recompute`
    (`:3291-3308`); materializer bars-sem `self._readiness_materializer_bars_sem` (`:443`).
  - Watchlist read: existing analysis→portfolio stub `self._portfolio` (`:389-390`);
    `GetWatchlist` RPC `portfolio.proto:22`, `GetWatchlistRequest{watchlist_id=1}` →
    `GetWatchlistResponse{watchlist=1}` (`:264-269`), `Watchlist.bindings=8` /
    `WatchlistBinding{symbol=1,strategy_id=2,source=3}` (`:220-239`). No new edge (FR-4/AC-5).
  - R-E sentinel is schema-safe: `readiness_cache.bar_epoch BIGINT NOT NULL`, no non-negative
    constraint (`migrations/022_readiness_cache.up.sql:14`) → **no migration** (F-06). The exception
    path is at `readiness.py:65-68`; `bar_epoch` fold at `:82`. Successful-empty fetch is a distinct
    path and must stay `>= 0`.
  - UI: N+1 fan-out to remove is `WatchlistReadiness.tsx:193-203` (`useQueries` +
    `analysisClient.evaluateReadiness`, `staleTime:30_000`). New hook uses disjoint key
    `['watchlistReadiness',...]` (never `['watchlists']`, protecting feature-167 @AC-6 cache patch at
    `useWatchlists.ts:140-192`). Pagination stack precedent `usePortfolio.ts:33,46-56` +
    `trader/positions/page.tsx:47-54`. C-17 primitives all exist (`Skeleton`/`QueryStateMessages`/
    `EmptyState`). BFF forward goes in `insightsBff.ts:55` region; single site (trader/config BFFs
    carry no watchlist RPCs). e2e mock homes: `mock-backend.ts` (`evaluateReadiness` `:821`,
    `listWatchlists` `:351`) + `watchlistMock.ts:33,75`; flattened proto3-JSON camelCase, no oneof.

### Decisions
- Enum values written buf-lint-compliant (`READINESS_STATE_*` prefix), overriding design.md's shorthand.
- No `xstockstrat-portfolio` reviewer / no portfolio step — watchlist read uses the existing edge.
- No migration and no config key (page size 25, poll 30s, UNKNOWN retry 300s are UI/module constants).

### Open Threads (carried to /sdd-execute)
- R-A: durable C-16 scenario added to analysis `readiness-caching-poll-discipline.feature` in Step 6;
  flag feature-180 FAST/bar_epoch guarantee for promotion in the same edit.
- R-B: FR-6 warm-FAST-first-render is contingent on `analysis.readiness_materializer.enabled`
  (default OFF) — Step 12 documents the prerequisite; do NOT flip the default.
- R-E/R-F: shared-compute `-1` sentinel changes shipped 177/180 (operator-approved); Step 4 re-verifies
  feature-177 @AC-1 (success FAST skip) and @AC-2 (bar bust). R-F semaphore coupling documented in Step 12.

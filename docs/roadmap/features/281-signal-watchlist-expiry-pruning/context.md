# Context: signal-watchlist-expiry-pruning

**Feature**: `docs/roadmap/features/281-signal-watchlist-expiry-pruning/feature.md`
**Product Spec**: `docs/roadmap/features/281-signal-watchlist-expiry-pruning/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/281-signal-watchlist-expiry-pruning/implementation-spec.md`

---

## Session 2026-10-31 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- Operator instruction: Recon (`/sdd-design` Phase 0) must CONFIRM that expired signals persist on the signal watchlist against the code before any design is proposed (AC-1 / FR-1).
- Grounding read at story time (not recon): `ExternalSignal.valid_until` exists (`packages/proto/ingest/v1/ingest.proto:129`); `WatchlistEntrySource` MANUAL/SIGNAL and `WatchlistBinding.source` exist (`packages/proto/portfolio/v1/portfolio.proto:236-248`, feature 127). "Signal watchlist" is interpreted as feature 127's per-user system-managed watchlist.
- **Renumbered 280 → 281** (feature-workflow.md § Collision resolution): `origin/claude/smoke-test-deployment-0f1z5j` already carries `280-smoke-check-runtime` (not on `main-dev` yet, so invisible to the local max+1 scan). Slug unchanged; no branch rename needed. Directory was untracked, so a plain `mv` + path-line fix sufficed.
- Operator decisions (AskUserQuestion): proceed to recon from `draft` (spec not yet /sdd-review'd); target = **both** the portfolio system watchlist (source=SIGNAL entries) **and** other signal-derived lists (analysis opportunities / ingest signal rows) — recon covers all; design decides scope.
- Working branch is the harness-assigned `ccr-bba734e2-l1lr60`, not `feature/signal-watchlist-expiry-pruning`.

## Session 2026-10-31 — sdd-design Phase 0 (Recon)

- Wrote recon.md (services: portfolio, ingest, agent, analysis, ui; 6 parallel discovery runs incl. scenario-recon for C-16).
- **FR-1 / AC-1 premise verdict**: CONFIRMED for the portfolio signal watchlist — no expiry/prune/sweep code anywhere (portfolio `watchlist_repo.go`/`portfolio_service.go`, agent `app/`, ingest `app/`). Stronger finding: a SIGNAL entry has no link to its signal(s) (`watchlist_symbols` = watchlist_id, symbol, strategy_id, source, added_at; agent add passes neither `valid_until` nor `signal_id`) so it is *structurally* unprunable today.
- REFUTED for analysis opportunities: `ListOpportunities` already excludes `valid_until <= now()` (`opportunities.py:226`); ingest signal rows are filtered at query time by design. Operator's "both" scope therefore collapses to portfolio-only behavior; opportunities/ingest are out of scope unless the design needs them as a data source.
- Key design forks carried to Phase 1: R1 link+trigger (no portfolio<->ingest edge exists), R2 renewal (add skipped on dedup; first-writer-wins), R3 which signals count (direction filter), R6 source integrity, R7/R8 cross-user authz + multi-instance.
- C-16: no CHANGE found; soft spot = platform `@AC-7` (do not lock/hide manual remove on SIGNAL rows).

## Session 2026-10-31 — sdd-design Phase 1 round 1 (quick) — user decisions

Round 1: proposer = side-table `portfolio.watchlist_signal_expiry` stamped by the agent's add (new optional `AddWatchlistSymbolsRequest.signal_provenance=4`), pruned by an in-process portfolio goroutine; adversary verdict NEEDS WORK, **no Floor breach**. Accepted fixes: lock `watchlists` first in id order (per-watchlist tx) to avoid prune-vs-add/Update deadlock; create an expiry row only when the binding was newly inserted by this tx (or a row already exists) so legacy open-ended entries are not falsely pruned; per-row `x-user-id` on the ledger append so the audit event is owner-visible (C-03); require exactly one SIGNAL binding with provenance; tick also deletes orphan expiry rows; document `instance_count: 1`, disabled-mode re-check cadence, and the dedup-claim dependency.

**Explicit user sign-offs (AskUserQuestion, 2026-10-31):**
- **FR-2/FR-3/AC-3 scope narrowed** to *agent-recorded watchlist-direction signals* (signals ingested outside the agent path, and buy/sell signals, do not keep an entry alive). Accompanied by a **separate one-shot operator backfill** (DBA-reviewed, reads ingest data, seeds expiry rows for existing SIGNAL entries) to clear the existing stale backlog. Rejected: analysis sweeper (new ingest system grant weakens features 224/225).
- **Strategy-bound SIGNAL entries are pruned like any other.**
- **Silent removal accepted** (ledger event is the only audit; no UI code change, list refreshes on refocus/remount/mutation) and **add-then-prune accepted** for an already-expired signal (feature 127 `@AC-1` add path is NOT changed).
- Gate: **run another round** (round 2) — not yet approved.

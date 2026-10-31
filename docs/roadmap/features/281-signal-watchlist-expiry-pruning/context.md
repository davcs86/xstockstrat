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

## Session 2026-10-31 — sdd-design Phase 1 round 2 — user decisions

Round 2: proposer added never-waiting `SKIP LOCKED` per-watchlist prune (found `UpdateBinding`/`UpdateBindings` lock in reverse order, watchlist_repo.go:337/347, 371/402), insert-count-aware add path, Go operator backfill (REPORT/APPLY), real-DB concurrency tests T1-T4 + `portfolio-db-test` CI job. Adversary verdict NEEDS WORK, **no Floor breach**; round-1 objections verified closed in code.

Folded in without a decision: overwrite (not merge) a leftover expiry row when the binding is freshly inserted; FR-2/FR-3 reworded to "agent-recorded watchlist signals since the entry was last added" and FR-7 says the backfill counts every watchlist-direction row the owner has; AC-2/AC-4 reworded, AC-12 corrected (replace-all preserves client-sent `source`), rename-preserves-SIGNAL test, T4 mirrors repo lock order + reverse interleaving; backfill digest dropped (REPORT/APPLY share code; APPLY refuses if `seed_expired` grew); unused partial index dropped, `FOR NO KEY UPDATE` on parent; `portfolio-db-test` wired into the aggregate CI gate; tick **Agent** in Consumer Surface(s).

**Explicit user sign-offs (AskUserQuestion, 2026-10-31):**
- **Version skew:** a provenance-less SIGNAL add on a tracked entry **untracks** it (deletes its expiry row; re-running the idempotent backfill re-seeds), so deploy order does not matter; **and the pause switch is restored** (`portfolio.watchlist.signal_prune_interval_seconds` bounds `[0,86400]`, `0` = skip the prune and re-check every 300s).
- **Failed renewal add accepted as a residual risk** (early prune at the old expiry until the next non-deduplicated ingest); no agent retry added.
- **Backfill REPORT also lists `untracked_no_signal` SIGNAL entries** (user, symbol) for manual removal; no automatic deletion.
- Gate: **run a third round** — not yet approved.

## Session 2026-10-31 — user amendment during round 3 (supersedes the two round-2 answers it touches)

User replied to the two open questions the round-2 proposer raised: **(1) "Remove them"**, **(2) "Yes"**. Interpreted as:
1. **Backfill removes `untracked_no_signal` SIGNAL entries** (SIGNAL bindings on system lists with no matching `direction='watchlist'` signal row for the owner) instead of only listing them. Supersedes "REPORT lists them, no auto-delete". Safeguard to carry into design: removal is an explicit APPLY step (not implicit), its count is shown in REPORT first and must be passed back (`--expect-untracked N`) so the DBA approves the exact blast radius; each removal still emits the owner-visible ledger event.
2. **Cutting the "interval 0 = disabled" kill switch is acceptable.** Supersedes "restore pause switch". Config key bounds return to `[60,86400]` with `<=0` reading as the default (300); **untrack-on-provenance-less-add stays** (it is what makes version skew self-safe without a switch).
- Round-3 proposer was launched before this amendment; its output is reconciled with these two deltas before the adversary pass. Gate remains: not yet approved.

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

## Session 2026-10-31 — sdd-design Phase 1 round 3 — user decisions

Round 3: proposer finalized the design (untrack restricted to SIGNAL-sourced adds, overwrite-on-fresh-insert vs update-only merge, `NewPool` export, T0-T7 tests, FR-1..FR-7 / AC-1..AC-14 drafts). Adversary verdict NEEDS WORK, **no Floor breach**. Folded in without a decision: backfill CLI never deletes bindings itself — it MARKS approved untracked entries by upserting an expiry row (`valid_until = now()`, `signal_id` NULL, new `reason` smallint enum UNSPECIFIED/EXPIRED/UNTRACKED_NO_SIGNAL per C-04) and the in-service prune deletes them (single deleter, no CLI ledger/mTLS access, no `UpdateBinding` deadlock) emitting a distinct `portfolio.watchlist.signal_entry_removed_untracked` {user_id, watchlist_id, symbol, strategy_id, reason}; `strategy_id` added to the `signal_entry_expired` payload (ledger-rebuildable removals); runbook documents `TRUNCATE portfolio.watchlist_signal_expiry` as the immediate emergency stop (every restart runs a tick; raising the interval is not a pause) with portfolio rollback as second line; interval bounds `[60,86400]`, `<=0` reads 300, `1..59` clamps to 60 (dual-form test rows); REPORT lists each row to be removed `(owner, watchlist_id, symbol, strategy_id)`; T7 fixtures `" aapl"`/`"AAPL"` and a legacy-owner row; FR-3 "never pruned" scoped to the recurring prune; AC-1..AC-7 frozen, AC-8..AC-17 written fresh.

**Explicit user sign-offs (AskUserQuestion, 2026-10-31):**
- **Untracked removal scope: "Remove strictly as amended"** — the backfill removes every SIGNAL entry with no `direction='watchlist'` signal row under the owner's OWN user id, **knowingly accepting the adversary's warning** that pre-feature-224 signal rows were reassigned to `SEED_USER_ID` (ingest migration `013_signal_ownership_templates.up.sql:70`) so real users' entries can appear untracked while their signal is still live (this contradicts FR-3 for those users). Rejected options: legacy-owner match that never removes (adversary-recommended) and list-only. Mitigation kept inside the choice: REPORT must print per-owner counts and flag owners that have zero signal rows under any owner id, and removal remains bounded by `--expect-untracked N` with the exact rows listed for the DBA.
- **No pin-on-add:** a MANUAL add of an existing SIGNAL entry stays first-writer-wins (no change to feature 127); recorded as residual risk.
- Gate: **run a fourth round** — not yet approved.

## Session 2026-10-31 — sdd-design (COMPLETION)

- Phase 0 Recon: wrote recon.md (services: portfolio, ingest, agent, analysis, ui; Premise Verdict: confirmed for the portfolio signal watchlist, refuted for opportunities, by-design for ingest rows; key reuse patterns: `RemoveSymbols` idempotent delete shape, ingest/analysis background-loop precedents, operator-CLI REPORT/APPLY pattern from `legacy-formula-authors.md`).
- Phase 1 Grilling: 4 rounds (quick mode, user-extended; hard cap 5 not reached). Chosen approach: agent stamps `signal_provenance` on the add → portfolio side table `watchlist_signal_expiry` → in-process never-waiting `SKIP LOCKED` prune loop; one-shot `portfolio backfill-signal-expiry` subcommand marks/seeds the backlog (CLI never deletes bindings). Rejected: analysis sweeper / portfolio→ingest edge / lazy prune / expiry column on bindings / FK cascade / blocking prune / CLI deleting bindings / `reason` column / pause switch / pin-on-add / mark grace / legacy-owner match (user declined) / list-only REPORT.
- Constitution rules touched: C-03, C-04, C-05, C-07, C-08, C-09, C-10, C-12/13, C-14, C-15, C-16, C-18, F-01, F-02, F-04, F-06, F-07, P-03. Floor breaches: none in any of the 4 adversary rounds.
- Round 4 adversary fixes folded at the gate (user chose "Approve design"): APPLY statements recompute from ingest at statement time and skip rows whose class changed (closes the ingest+agent-add race); `--legacy-owner` required in both modes, no env fallback (portfolio runtime has no `SEED_USER_ID`); runbook invokes the subcommand from a workstation (distroless image has no shell); ledger owner via request `user_id` (+ `x-trace-id` metadata); provenance only with a dated `valid_until` (open-ended ⇒ no provenance ⇒ untrack); UI e2e asserts the existing `No symbols` line (no `EmptyState` change); `lock_timeout=500ms` instead of a 2 s wall clock; AC-14 split into SetConfig rows vs clamp rows; AC-17 requires a live rescuing signal; new AC-18 for provenance validation.
- User sign-offs recorded in prior sections: FR-2/FR-3 narrowed; backfill; strategy-bound pruned; silent UI; add-then-prune; failed renewal accepted; untrack-on-add; pause switch cut; strict untracked removal incl. the pre-224 `SEED_USER_ID` risk; no pin-on-add. Gate-4 answer: **no mark grace period**.
- Product spec + acceptance.feature rewritten to match design.md (FR-1..FR-7, AC-1..AC-18; AC-1..AC-7 IDs kept, Given/Then reworded pre-implementation only).
- Status: draft → design-approved. Skipped `/sdd-review product-spec` by operator choice (draft gate, round 0).

## Open Threads (carry into /sdd-spec; each with target step)

- [ ] Strict untracked removal deletes live pre-224 legacy-owner entries; REPORT flags `NO_OWN_SIGNALS`/`legacy_live`; undo = manual re-add — runbook + backfill step (S10/S14).
- [ ] No grace period; APPLY → tick ≤300 s irreversible; emergency stop = `DELETE … WHERE signal_id IS NULL` / `TRUNCATE`, human must act within one interval — runbook (S14).
- [ ] Failed/deduplicated renewal add ⇒ early prune until next non-deduplicated ingest — agent step + docs (S12/S14).
- [ ] Signals outside the agent path / buy-sell signals never keep an entry alive — docs (S14).
- [ ] MANUAL add does not pin; replace-all re-stamping MANUAL makes an entry permanently immune — `mcp-tools.md` sentence (S14).
- [ ] Add-then-prune of an already-expired signal — docs (S14).
- [ ] Ledger event lost on crash after commit; pasted REPORT is the record for backfill removals — portfolio step (S6/S7).
- [ ] Verify at /sdd-spec: `ingest.newsletter_signals.id` is BIGINT; `Timestamp` import in portfolio.proto; `ledger` owner semantics for request `user_id`; `.do/app*.yaml` portfolio block for any env the subcommand needs; `docs/runbooks/CLAUDE.md` index row; agent test location.
- [ ] Re-verify migration number `018` (portfolio) and proto field `4` are still free on `main-dev` at /sdd-spec time; feature numbers may collide again with unmerged branches.

## Session 2026-10-31 — sdd-spec

- Generated implementation-spec.md with 21 steps (1 proto, 1 proto-gen, 1 migration, 8 portfolio service/test pairs + CI harness, 1 config + test, 1 agent + test, 1 UI e2e, 1 docs, 1 premise-evidence check). Status → implementation-ready. Every AC-1..AC-18 is covered by ≥1 step (map in the spec's `## Scenario Coverage`).
- Key codebase findings (all grounded this session; design/recon wording corrected, no design change):
  - `insertBindingsTx` (`watchlist_repo.go:494-504`) returns only `error`; the "inserted-symbol set" in design § 3 is the NEW shape Step 5 introduces.
  - `migration-rerun` pass 1 applies `018` via `db-migrate.sh up`, but pass 2 replays only a fixed 224/225 file list — `018` is not replayed; idempotency is by construction, `migration-rerun.sh` stays untouched.
  - Prune step 3 must `DELETE` only the symbols its `SELECT … FOR UPDATE SKIP LOCKED` actually locked; deleting over the full due set would block on a row held by `UpdateBinding` (`watchlist_repo.go:337`) and break "never waits" / AC-12.
  - No Go real-DB harness exists (`dbtest`/`go:build` grep over portfolio/trading/marketdata: none); Step 4 creates it from scratch from the `ledger-db-test` CI shape (`ci.yml:711-768`). DB tests run only in the new `portfolio-db-test` job; locally RED for a DB test is a compile failure.
  - Migration `018` and proto field `4` are free on all remote branches; `ingest.newsletter_signals.id` is `BIGSERIAL`; ledger honours request `user_id` over `x-user-id` metadata (`ledgerServiceImpl.ts:77-78`); `.do/app*.yaml`/compose need no change (no new env/port).
  - New portfolio logic lands only in coverage-excluded packages (`repository`, `service`, `cmd`), so the 40% Go threshold is held by not touching measured packages.
- Unverified at spec time (carried into the runbook preflight, Step 20): the portfolio DB role can `SELECT` from `ingest.newsletter_signals`; any `signal_sources` FK/NOT NULL on `ingest.newsletter_signals` fixtures (re-grep ingest 013/014 in Steps 10/16).
- Teardown owed at execute time: Step 20 touches context files; run `/context-forge:context-constitution refresh` or record the manual reconciliation in the PR body.

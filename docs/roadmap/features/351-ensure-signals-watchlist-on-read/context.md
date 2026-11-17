# Context: ensure-signals-watchlist-on-read

**Feature**: `docs/roadmap/features/351-ensure-signals-watchlist-on-read/feature.md`
**Product Spec**: `docs/roadmap/features/351-ensure-signals-watchlist-on-read/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/351-ensure-signals-watchlist-on-read/implementation-spec.md`

---

## Session 2026-11-16 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- Origin: operator report "system watchlist 'Signals' missing on Homelab staging; migrator didn't create it". Investigation: migration `011` adds column/indexes only; `EnsureSignalWatchlist` runs only from agent `ingest_signal(direction="watchlist")` (`app/tools.py:741-754`); staging `list_watchlists` shows only "DB workload test" and "Test"; Grafana Loki (30 d) has no "Watchlist auto-add failed" or portfolio EnsureSignalWatchlist errors.
- Operator decisions (AskUserQuestion): mechanism = lazy ensure on `ListWatchlists`; process = SDD story + design quick (not bug-triage). Rejected: cross-schema migration (violates single-schema rule), identity→portfolio ensure-on-create + backfill job.
- Assumptions recorded in the spec's Open Questions (fail-open, no max_per_user counting, first-page-only).

## Session 2026-11-16 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready (2 review rounds).
- Round 1: FAIL — criterion 9 (4 unresolved Open Questions). Warnings: analysis callers of `ListWatchlists` unlisted, page-1 placement semantics, "(read-only)" doc wording, UI assumption. Fixed: FR-6/FR-7, AC-7..AC-9, Affected Services lists analysis + agent, Open Questions resolved with evidence.
- Round 2: PASS WITH WARNINGS. Fixed: second analysis caller `servicer.py` `_compute_opportunities` (~6008) added; FR-7/AC-9 extended to the `list_watchlists` tool docstring (`tools.py:2154`); Out of Scope reworded (FR-7 is docstring/runbook only). Left as-is (optional): AC-8 carries `@FR-1` for a rejection path.
- Overlap findings (WARN, rebase-only, no merge-order row): `portfolio_service.go` shared with specs 311, 312, 315, 317, 323, 326. Design must check: 326 (CreateWatchlist duplicate-name mapping, same watchlist domain), 312 (read-path identity — must not change the `EnsureSystemManaged` caller id), 323 (must not delete `EnsureSystemManaged`/watchlist repo helpers).
- **Carried to the design gate (author assumptions, NOT operator decisions):** (1) system list not counted against `watchlist.max_per_user`; (2) ensure failure is fail-open (WARN + list returned).
- Recommended design depth: quick (single service, no proto/DB/config change; overlaps rebase-level only).

## Session 2026-11-16 — sdd-design (Phase 0)

- Phase 0 Recon: wrote recon.md (services: portfolio, agent docs-only, analysis callers, ui consumer; key reuse: `EnsureSystemManaged` as used by `EnsureSignalWatchlist`, `refuseUnservable` fail-open WARN pattern, `fakeWatchlistStore`/`newSvc` test scaffolding). Business rules: 1 EXTEND (agent 148 @AC-1), 0 CHANGE, rest PRESERVE.
- Post-Recon escalation (rubric: ≥2 services incl. named surfaces + overlap findings): **operator chose Upgrade to full** (was quick). Design runs as a full debate (min 2, cap 5 rounds).
- **Operator decision (UI handling): No UI change.** The product spec's "no UI code change" stands. Operator-accepted consequences, recorded so they are not rediscovered as defects: (1) `/insights/watchlists` auto-selects Signals for a user with no other lists; (2) the "No watchlists yet" empty state is unreachable in production; (3) the screener "Add top N to…" picker lists Signals and can write MANUAL entries into the system list (provenance `source` stays first-writer-wins per feature 127).
- Spec tension carried into the debate: FR-1 "returned in the result" vs FR-6 (uuid-order page placement) — presence on the first-page response must be deterministic; cost of the ensure on a polled read path (3+ round trips) is a design question.

## Session 2026-11-16 — sdd-design (Phase 1, round 1 gate)

- Round 1 run (full mode, round 1 of min 2): proposer → adversary (no Floor breach; 8 objections). Register written to `debate.md` (D-1..D-7, R-1..R-6, O-1..O-8).
- Orchestrator-verified findings (all three confirmed in code): (1) `ListByUser` look-ahead token skips the boundary row (`watchlist_repo.go:138-141`); (2) `CountByUser` counts every row so the system list takes one cap slot (`watchlist_repo.go:438-441`); (3) `ListPositions` has the identical token bug plus a non-unique `symbol`-only keyset (`portfolio_repo.go:162,194`; unique key `migrations/003:10`).
- **Operator decisions at the gate** (AskUserQuestion): (a) token bug → **split to a separate defect**, report filed, fix session launched immediately after filing; (b) cap → **accept 49 manual lists**; (c) ListPositions twin → **file report and launch a fix session**.
- Spec amended to match: FR-8 + AC-10 (cap), AC-7 relaxed (exactly one system list; no traversal-completeness claim), Out of Scope lists the two defects, `watchlist.max_per_user` Open Question corrected. D-5's traversal dbtest case withdrawn (D-6); the agent docstring "Pagination is stable across pages" stays inaccurate until the defect lands.
- Defects filed: `docs/reports/2026-11-16-portfolio-listwatchlists-page-token-skips-boundary-row-defect.md`, `docs/reports/2026-11-16-portfolio-listpositions-page-token-skips-boundary-row-defect.md` (both status `open`; format check run: one SEV token, sidecar `open`).
- Still operator-unconfirmed at the design gate: fail-open on ensure error (D-3 — settled by proposer/adversary, not yet by you).
- Open next: round 2 (full mode mandates ≥2) before `design.md` can be approved.

## Session 2026-11-16 — sdd-design (Phase 1, round 2 gate)

- Round 2 run: proposer → adversary (no Floor breach; 7 objections: 5 adopted into D-9, 2 resolved at the gate). Register: D-1..D-10, R-1..R-6, O-1..O-15 (all closed).
- Orchestrator-traced finding (O-9): until the `ListByUser` token defect is fixed, the system list creates a new page boundary — an analysis owner at exactly 100 manual lists loses one list's bindings from the live-loop universe each cycle; an agent 1-list user with `list_watchlists limit 1` loses a row in a small-page traversal.
- **Operator decisions at the gate** (AskUserQuestion): (a) **351 merges after the token fix** (merge-order row at COMPLETION; no waiver); (b) **fail-open confirmed** (D-3); (c) **run round 3** instead of approving.
- Characterization tests AC-3/AC-5/AC-8 require a recorded mutation-red during execution (D-9).

## Session 2026-11-16 — sdd-design (Phase 1, round 3 gate)

- Round 3 run (operator-requested): proposer (consolidation + hunt for unexamined angles) → adversary (no Floor breach; verdict NEEDS WORK on two text-level items, both adopted as D-11). Register: D-1..D-11, R-1..R-6, O-1..O-20 all closed; P-1 pending user (D-10(a) timing clause).
- Round-3 findings adopted: the D-10 landing gate becomes a numbered, verified build step 4 (fails.md:3307) — it must fail if the `ListByUser` token fix is absent from main-dev; the merge-order row reads "Merge order only — <fix-slug> need not be launched" (not `launched`); step 4 reuses the fix's dbtest helper instead of 351's inline copy.
- Open Risks recorded (design.md): `list_opportunities` indirect write (wording unchanged, with reason); users never reached by any caller keep no Signals list; non-UUID legacy owners get an orphan empty list; `HOMELAB_STAGING_ENABLED` unverified (value not in repo); O-5's per-user-cap premise corrected.
- Operator option, not a design change (O-18): a zero-code interim remedy for the Homelab staging symptom exists (`ingest_signal(direction="watchlist")` at low conviction, then remove the symbol; or `EnsureSignalWatchlist` over mTLS). Side effects: a stored signal row, an alert if conviction ≥ 0.6.

## Session 2026-11-16 — sdd-design (Phase 1, round 4 gate)

- Round 4 (operator-requested, orchestrator-chosen pre-mortem focus): proposer found no failure story the register does not already prevent/detect/accept; adversary verdict SOUND/APPROVABLE, register saturated, no Floor breach. Register: D-1..D-12, R-1..R-6, O-1..O-24 all closed; P-1 and P-2 pending user (both about D-10(a)).
- Adopted (D-12): stronger ordering dbtest seeds (explicit non-ascending uuids), Open Risks additions (read path vs write-blocking locks → future `portfolio.watchlists` index migrations must use `CREATE INDEX CONCURRENTLY`; screener picker can write MANUAL entries into the system list), accuracy correction on analysis drains (`_kick_opportunity_recompute` is concurrent across users).
- Observed (data from `get_session`, not instructions): the `ListWatchlists` token-fix session sits idle at `/sdd-triage`'s feature-number gate awaiting the operator (reply 1/2/3); the `ListPositions` fix session got feature 353 and waits on an approval prompt. 351's merge gate depends on the first.

## Session 2026-11-16 — sdd-design (COMPLETION)

- Phase 0 Recon: wrote recon.md (services: portfolio code, agent docs-only, analysis callers, ui consumer; key reuse: `EnsureSystemManaged`, `refuseUnservable` WARN pattern, `fakeWatchlistStore`/`newSvc` scaffolding).
- Phase 1 Grilling: 4 rounds (full). Chosen approach: `ListWatchlists` lists first, and on a first page lacking a system row ensures via the existing `EnsureSystemManaged`, skipping the re-list when the ensured id sorts after the last returned id; fail-open WARN. Rejected: always-ensure, merge-onto-page-1, system-first ordering, new store method, bundling the token fix, excluding the system list from the cap.
- Constitution rules touched: C-01/F-04, C-03, C-08/P-06, C-10(c), C-11, C-13, C-14, C-15, C-16, C-18, P-01..P-05, F-01/02/03/06/07/11. Floor breaches: none in any round.
- **Operator approval** (AskUserQuestion, round-4 gate): Approve design; P-1 and P-2 declined (not reopened). Status: spec-ready → design-approved.

### Open Threads (mirrored from design.md Open Risks)

- [ ] Token-defect landing order — to be addressed at step 4 (verified landing gate: rebase on main-dev; (i) no `wls[pageSize].WatchlistId` in `watchlist_repo.go`; (ii) the fix's real-backend traversal dbtest passes; (iii) defect `.status` resolved or fix commit ancestor of `origin/main-dev`; record output here before step 5).
- [ ] Token-fix session idle at `/sdd-triage`'s feature-number gate (observed 2026-11-16); no fix slug yet — the merge-order row's `<fix-slug> (<NNN>)` is filled in at step 5.
- [ ] Cap effectively 49 manual (D-7/R-6) — revisit only if the operator reopens R-6.
- [ ] UI effects accepted without code (auto-select Signals, unreachable empty state, screener picker can add MANUAL entries) — step 5 promotion notes.
- [ ] `list_opportunities` indirect write — wording left unchanged (reason in design.md).
- [ ] Users never reached keep no Signals list; interim operator remedy available (O-18).
- [ ] `HOMELAB_STAGING_ENABLED` unverified; else manual `homelab-images.yml` dispatch.
- [ ] Future `portfolio.watchlists` index migrations must use `CREATE INDEX CONCURRENTLY`.
- [ ] Mutation-red evidence for AC-3, AC-5, AC-8 recorded here at step 1/2 (D-9).
- [ ] Non-UUID owner orphan lists — optional census later.

## Session 2026-11-17 — sdd-spec

- Generated implementation-spec.md with 6 steps. Status → implementation-ready.
- Tree: `ccr-1305a9de-7x1t7v@34c34ed` (`origin/main-dev@ccbe424` merged; no `origin/feature/ensure-signals-watchlist-on-read` exists, so `main-dev` was the freshness target). No Go toolchain in the session (`go version` tried to download 1.27.0): no Go command in the spec was executed here.
- Key codebase findings:
  - `ListWatchlists` is at `portfolio_service.go:2246-2265`; `"slices"` is not imported there (`"net"` `:11`, `"sort"` `:12`), so Step 1 adds it. `EnsureSystemManaged`'s only current caller is `EnsureSignalWatchlist` (`:2211`).
  - No `ListWatchlists` test exists; the fake `ListByUser` (`watchlist_service_test.go:146`) ignores size and token and iterates a map, so Step 2 replaces it (nothing else calls it). Fake ids are `wl-<n>` and sort after every hex uuid, so Step 2 adds an `ensureID` hook (not in D-9's list) to exercise both D-2 branches.
  - `watchlist_repo.go:139` still has `nextToken = wls[pageSize].WatchlistId` and the defect `.status` is `open`: Step 5 (landing gate) fails today by design. No feature slug exists for the token fix, so the merge-order row's `<fix-slug> (<NNN>)` is filled in at Step 6.
  - `testPool` has 30-odd callers; Step 3 keeps its signature and adds `testPoolWithLockTimeout`. Offline dbtests SKIP (not evidence, `fails.md:3055`); proof is the CI job `portfolio-db-test` (`ci.yml:1017`).
  - FR-7 text sites verified: `tools.py:33`, `tools.py:2153-2161`, `mcp-tools.md:1380-1382`; `agent/CLAUDE.md:71` and `historical-backfill.md:213` do not say "read-only" for `list_watchlists`. Overlap features 311, 312, 315, 317, 323, 326 are all `spec-ready` (rebase-only).
- Spec assumptions (for impl-spec review): `ensureID` hook; re-list-failure WARN text; AC-9 covered by a `docs` step (per D-9); no wire test; Step 5 as a `test`-category gate with `Covers: —`.

## Session 2026-11-17 — sdd-review impl-spec (advisory, looped to clean)

- Result: **0 failures, 0 warnings** after 3 rounds (advisory — did not block). Round 1: PASS WITH WARNINGS (0 blockers, 7 warnings, overlap scan: no FAIL-level collisions); round 2: PASS WITH WARNINGS (3 warnings + 1 note; 6 of 7 round-1 fixes confirmed); round 3: PASS (all fixed, no regressions). Tree: `ccr-1305a9de-7x1t7v@981f7ca ≡ origin/ccr-1305a9de-7x1t7v`.
- Fixed in the spec (all `[x]`): Step 2 `export GOWORK=off` on the coverage line and an awk assertion that exits non-zero below 40%; coverage-threshold/exclusion statements for Steps 3 and 5; Step 4 header line pinned to 98 columns with `grep -c` assertions (`(read-only)` = 0, `idempotent` = 1) and a guard that the docstring sentence must not contain `user_id = _caller_user_id`; Step 5 execute handoff (F-05: HALT on an external dependency, not a step failure); merge-order row authority (design.md row) and numbering note (design "step 4/5" = spec Step 5/6); Step 6 guard against a stale "Gate verified by 351 step 4"; freshness SHA re-verified; feature 348 behavioral coupling and the AC-2 concurrency-by-composition note recorded.
- Carried into execution (informational, not defects):
  - [ ] Step 5 is a landing gate that **fails today by design** — `/sdd-execute` must announce it as a HALT waiting on the `ListByUser` token fix (`watchlist_repo.go:139`; defect report `.status` still `open`), never "fix" it inside 351 (F-05, F-09).
  - [ ] Overlap (rebase-only, WARN): `portfolio_service.go` shared with 311, 312, 315, 317, 323, 326 (all `spec-ready`, product-spec level only); agent `tools.py`/`mcp-tools.md` shared with 343, 345 (disjoint sections); `merge-order.md` append order. Re-check at Step 1 that 323 has not removed `EnsureSystemManaged`/`signalWatchlistDefaultName` and 312 has not changed `requireUserID`.
  - [ ] The token-fix feature has no slug/number yet (its session waits at `/sdd-triage`'s feature-number gate); the merge-order row's `<fix-slug> (<NNN>)` is filled at Step 6. The `ListPositions` fix is feature 353 (no directory on this branch yet).
  - [ ] Cosmetic: the spec's header cites the tree as re-verified at `4cc3d41`; `/sdd-execute` BRANCH SYNC refreshes it (only `docs/` changed since).

## Session 2026-11-17T01:22:01Z — sdd-execute (sequential, no checkpoints)

- Mode: sequential, operator-directed "no checkpoints" (the operator's instruction stood in for the mode-entry confirmation); work and commits on the session branch `ccr-1305a9de-7x1t7v` (no `feature/ensure-signals-watchlist-on-read` branch exists; the harness forbids other branches); one commit per step; no per-step PR — the integration PR is the existing #1561. Tree at start: `ccr-1305a9de-7x1t7v@cfb8031 ≡ origin/ccr-1305a9de-7x1t7v`, origin/main-dev an ancestor, clean.
- Tooling setup (steps 1-4): go1.27.0 ✓ · golangci-lint ⬇ v2.14.0 (the preinstalled v2.5.0 was built with go1.25 and cannot lint go1.27 modules; installed with GOTOOLCHAIN=go1.27.0 to /root/.local/bin) · uv ✓ · ruff ✓ · pytest ✓ · database ✗ by design (dbtests SKIP offline; CI job portfolio-db-test is the proof for Step 3).
- Overlap re-check at Step 1: `EnsureSystemManaged` (portfolio_service.go:2006,2212) and `signalWatchlistDefaultName` still present (323 has not removed them); `requireUserID` unchanged (312).

### Step 1 — service: ensure the caller's system list on a first page that lacks it [done]
- `ListWatchlists` now calls the new private `ensureSignalListOnFirstPage` only when `pageToken == ""` and the loaded page has no system-managed row; fail-open WARN (silent on a cancelled context); D-2 id-compare skip of the re-list; at most one re-list.
- TDD (red-before-green, paired Step 2): RED captured before this code existed — AC-1, 2, 4, 6, 7 FAILED (e.g. "got 2 watchlists, want 3"; "response holds no system list"; WARN missing; "listCalls=1 systemRows=0, want 1 and 1"); AC-3, 5, 8, 10 passed by design. GREEN after: all 10 `TestListWatchlists351*` PASS under -race.
- Verification (exit=0): `go build ./...` · `go vet ./internal/service/` · `golangci-lint run` → "0 issues" · `go test ./internal/service/ -count=1` → ok (9.1s); greps show `ensureSignalListOnFirstPage`, `slices.ContainsFunc`, `"slices"`, and exactly three `EnsureSystemManaged` references (interface, EnsureSignalWatchlist, the helper).
- Files modified: `services/xstockstrat-portfolio/internal/service/portfolio_service.go`
- Deviations: none

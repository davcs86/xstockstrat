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

## Session 2026-10-31 — sdd-review impl-spec (advisory) — converged after 11 passes

- Result: **0 failures, 0 warnings** at pass 11 (advisory gate; did not block). Pass 1 returned 0 failures / 5 warnings (+ overlap scan 0 FAIL / 4 WARN); passes 2-10 each re-reviewed the whole spec adversarially and surfaced progressively smaller runnability defects, all fixed in `implementation-spec.md` (a pre-execution edit — F-09 step-body immutability applies only once `/sdd-execute` starts).
- Findings addressed (all `[x]`):
  - [x] W1 Steps 15/16 — refusal/bound logic moved into exported `repository.RunBackfill` (`BackfillOptions`, `BackfillResult`, `ErrBackfillRefused`); `backfill.go` is a thin `runBackfillSignalExpiry`; the unenforceable cross-process "legacy-owner differs from REPORT" refusal dropped (spec-time correction 6).
  - [x] W2 Step 4 TDD wording; W3 Step 2 generated-glob note; W5 Step 17 `ValueError` guard; W7 Step 20 split → Steps 20 (service/pattern/constitution docs) and 21 (runbook, runbooks index, `mcp-tools.md`, `ci-overview.md`, portfolio link, teardown); premise check now Step 22 (22 steps total).
  - [x] N1-N13 runbook/grep naming, stale evidence bullets, `Merged` field and shared-merge claim removed (backfill inserts only rows lacking an expiry row), step-number/anchor drift.
  - [x] N14-N22 `buf breaking` CI form, malformed/vacuous no-op checks, wrong cwd after `cd`, coverage gate scoped to the full suite, named tests, `pruneOnce` defined in Step 11, runbook link moved to Step 21 so `check-context-map.sh` passes at Step 20.
  - [x] N23-N31 `docs/patterns/ci-overview.md` row for `portfolio-db-test`, real exit-code assertions (Step 15 refusal text, Step 17 tool-count guard, Step 19 Playwright invocation), per-section `expires` check, `GOWORK=off` on `go list`.
  - [x] N32-N38 test-existence + pass-count assertions on every test step (mandated `TestAddPath_*`/`TestPrune_*`/`TestBackfill_*` and named pytest functions), `$?`-based assertions, guards diffed against the merge base, POSIX `cksum` instead of `sha256sum`, ERE instead of GNU BRE `\|`.
- Overlap findings (feature-overlap, 0 FAIL, 4 WARN, rebase-level only):
  - [ ] `.github/workflows/ci.yml` `ci-gate` block (Step 4) is also edited by `278-enforce-config-key-wiring` — textual conflict likely, job names differ.
  - [ ] `docs/patterns/config-governance.md` (Step 20) is also edited by 278, 243, 255 — append-only, rebase-only.
  - [ ] `services/xstockstrat-agent/app/{tools,client}.py` + `docs/runbooks/mcp-tools.md` (Steps 17, 21) vs 215/275 — disjoint regions; re-grep anchors at execute time (273, launched, already changed `ingest_signal`).
  - [ ] **Policy interaction with 278 — needs an operator decision only if 278 lands first:** the deliberately unseeded prune-interval key is a `read-unseeded` finding for 278's shrink-only ratchet; Step 13 Instructions 3 stops and escalates (seeding is a design change → `/sdd-design`); baselining it is NOT allowed. A `merge-order.md` row `281 after 278` is recommended if both are queued (not written here: no FAIL-level overlap).
- Carried into execution (announce at each checkpoint): the four overlap items above (`[ ]`), the Open Threads from the design session, and the spec-time unverified items (portfolio role `SELECT` on `ingest.newsletter_signals` → runbook preflight; ingest 013/014 fixture constraints → re-grep in Steps 10/16).

## Session 2026-10-31 — merge order (operator-requested)

- Added `docs/roadmap/features/merge-order.md` row: `signal-watchlist-expiry-pruning` (281) must wait for `enforce-config-key-wiring` (278) (Resolved: No). Reason: 278's shrink-only `read-unseeded` ratchet vs this feature's deliberately unseeded key (Step 13 Instructions 3 escalates); shared `ci-gate` block and `config-governance.md` (rebase-only). Escape hatch recorded in the row: 281 may merge first only after the operator records an exemption ruling here.
- Closes the overlap item "policy interaction with 278" as *tracked* (the operator decision still falls to Step 13 at execute time if 278 has landed).

## Session 2026-11-02 — sdd-design amendment (quick), round 1 — operator decisions

- **Trigger:** 278 merged (`631028eb`). Its shrink-only `config-wiring` baseline makes the 227-D2 unseeded waiver fail CI. **Operator decision: seed the key via a config migration; no baseline entry.** Recon amendment appended to `recon.md`.
- **Round-1 synthesis:**
  - Config migration `035_portfolio_signal_prune_interval` lands **inside Step 11** with the reader. Seeding in Step 13 or a separate step was rejected because it leaves `read-unseeded` commits.
  - A Step 14 migration parse test guards `value_type 'int'`, 2 env rows, `user_id` NULL, value within `[60,86400]`, and the down scope. 278's check ignores `value_type`, and the seed equals the default (ledger fails.md:2333).
  - Step 11 verifies with `--final --json` and zero findings for this key. The step-time run is a form-mismatch guard only (`PENDING` never fails, `check-config-wiring.mjs:706`).
  - Idempotence holds by `ON CONFLICT … DO NOTHING`. CI never re-runs 035 (`migration-rerun.sh` replays only the 224/225 list).
  - Governance: config team plus DBA review for 035. Advisory `/sdd-review impl-spec` re-run on the changed steps.
  - New `@AC-19`; AC-14 unchanged.
  - **Config migration number 035 is reserved here**, re-checked at Step 11 and at the integration-PR gate.
- **Operator decision (2026-11-02):** the 035 down migration deletes **global rows only** (`user_id IS NULL`), never per-user overrides it did not create. This deviates from the 033 precedent on purpose. Then run another round.

## Session 2026-11-02 — sdd-design amendment, round 2 — synthesis (operator: another round)

- **Proposer refinements:**
  - Exact 035 SQL: the down's header carries the constraint only (rule 5).
  - Step 14 extracts zeroTrap's `findOne`/`splitStatements` into `src/__tests__/migrationSql.ts` (`mtlsTestPki.ts` precedent) and adds 5 anchored-regex parse cases in `signalPruneIntervalSeedMigration.test.ts`.
  - Step 13 drops its 278 branching.
  - Product-spec `:56` must not backtick `config.config_values` (it would match `DECLARED_KEY_RE`).
- **Adversary (NEEDS WORK, no Floor breach), folded in:**
  - `--final` exit code 2 (035 parse failure) is a Step 11 failure.
  - A finding counts as a key hit if its `file` is the 035 file or the reader file (`unmodelled-rewrite` / `dynamic-read` don't name the key).
  - Unrelated `STALE`/`STALE-IN-PART` lines are judged against a `--final` baseline taken at the merge-base.
  - Go const: double quotes, no trailing comment on the line, `const (` blocks with `)` at column 0 (`goConsts` `:477`).
  - The 035 collision check runs `git fetch --prune origin '+refs/heads/*:refs/remotes/origin/*'` first, excludes our own 035 file, and is bash 3.2 safe.
  - One recorded RED for the parse cases (move the 035 pair aside), kept in context/PR only.
  - `@AC-19` Then becomes static and precise: the down's only statement is limited to global rows of this key. The test full-matches the DELETE.
  - "Reopen Step 11" means a Deviation Log entry plus a fix step, never a body edit (F-09).
  - Step 14 Files list zeroTrap and `migrationSql.ts`; zeroTrap's 4 tests still pass.

## Session 2026-11-02 — sdd-design amendment (COMPLETION)

- **Approved** by the operator after 3 quick rounds. Round-3 adversary verdict: **SOUND**, no Floor breach (`F-01`: 035 is a new file, 034 is the highest on main-dev; `F-07`: the bounds constants only clamp).
- **Round-3 fixes folded in (all approved):**
  1. The 035 collision check (Step 11 Verification block 2) is re-run immediately before the 281 integration PR merges into `main-dev`, after the final rebase, with its output recorded here (Step 11 Instruction 9 + merge-time note); `merge-order.md` 282-after-281 row now states the hard migration ordering (282's 036/037 after 281's 035).
  2. Step 11 block 4 extracts the merge-base tree with `git archive "$MB" | tar -x` (no registered worktree; trap is `rm -rf "$T"` only).
  3. Step 11 Go const wording made consistent (Instruction 1 defers to Instruction 7's column-0 one-line or `const (` block forms; a trailing `//` comment is tolerated by the checker but rule 5 keeps none).
  4. Step 14 pins `migrationSql.ts` to `services/xstockstrat-config/src/__tests__/migrationSql.ts`, outside the `*.test.ts` glob, a test-only helper importing `node:assert`.
  5. Step 14 Verification runs exactly `pnpm run build && node --test --test-reporter=tap dist/__tests__/zeroTrapDescriptionMigration.test.js dist/__tests__/signalPruneIntervalSeedMigration.test.js` for `# pass 9` / `# fail 0`; the 5 new cases are plain `it()` (no skip/todo).
- **Artifacts changed:** `implementation-spec.md` (Execution Summary, merge hazards, Scenario Coverage `AC-19 → 14`, Step Dependencies, Steps 11-14, Step 20), `product-spec.md` (Affected Services, Config Key Changes, governance checkbox), `design.md` (seed wording + `## Amendment 2026-11-02` section), `acceptance.feature` (`@AC-19`), `feature.md` (Status History), `recon.md` (Amendment), `context.md`, `docs/roadmap/features/merge-order.md` (282←281 row; 281←278 row Resolved: Yes).
- **Config migration `035` is reserved** for `035_portfolio_signal_prune_interval`.
- **Follow-up (not built, C-18):** a platform CI check that every new migration NNN is above the base branch's max.
- **Next:** advisory `/sdd-review signal-watchlist-expiry-pruning impl-spec` on Steps 11-14 and 20, then `/sdd-execute signal-watchlist-expiry-pruning`. Step 11 must merge `origin/main-dev` ≥ `631028eb` first.

## Session 2026-11-02 — sdd-review impl-spec (advisory, scoped to Steps 11-14, 20)

- **Verdict: PASS WITH WARNINGS** (no blockers). All warnings were addressed by surgical text edits to `implementation-spec.md`, with no new steps and no renumbering.
- **W1 (Step 12, AC-14 read half):** added `TestSignalPrune_IntervalReadsConfig`, which drives `pruneInterval()` through `fakeConfig{vals: {signalPruneIntervalKey: 0|30|90000}}` and expects 300s/60s/86400s, alongside the pure `TestClampPruneInterval` table. Updated Covers. The Verification guards are now `-ge 7` (test count and `--- PASS`) plus a named grep for the new test.
- **W2 (Step 14 recorded RED):** the output is captured to `RED_OUT` and must contain `expected exactly one` and `^# fail 5$`; a non-zero rc alone no longer counts. Added a note that the trailing `git status --porcelain migrations/` check assumes the 035 pair is already committed (Step 11).
- **W3 (Step 14 Verification):** replaced `^# pass 9$` with `# fail 0` plus an awk `# pass N` ≥ 9 check (bash 3.2 safe). Replaced the `grep -c … -ge 3` with fixed-string greps for both `TIMEOUT_KEY_FORMS` rows and an exact-count grep for the explicit 0-rejection case. Instruction 4 now pins that case's `it(...)` title so the grep has a stable target.
- **W4 (Step 20 Verification):** one `&&` chain, so any miss fails the block. Added greps for:
  - the `database.md` sentence (`portfolio.watchlist_signal_expiry`)
  - `watchlist_signal_expiry` and `backfill-signal-expiry` in the portfolio `CLAUDE.md`
  - `035_portfolio_signal_prune_interval` in the portfolio `CLAUDE.md` and in config-governance
  - the feature-281 entry heading
  - the amended `PORTFOLIO-7` row (`insertBindingTx` + `ExpiryIntent`)
  - the feature-278 note

  Instruction 4 now asks for the literal phrase `feature 278 interaction`. Instruction 4 does not write the table name into config-governance, so `watchlist_signal_expiry` is grepped in the portfolio `CLAUDE.md` only.
- **W5 (Step 12):** `TestSignalPrune_LedgerErrorIsBestEffort` must force a non-`Unavailable` error (e.g. `codes.Internal`), because `emitEvent` retries `codes.Unavailable` 4× with backoff (`portfolio_service.go:1159-1175`). This is cited in Codebase Evidence and Instruction 2.
- **W6 (noted, no edit):** Step 16 does **not** cover AC-13; it covers AC-15/16/17. AC-13 maps to Step 12 (Scenario Coverage), and its repo-level half (the pruned entry's `StrategyID == "strat-9"`) is fed by Step 10 Instruction 2. That mapping is sufficient, so this is left as a note.
- **W7 (citation drift):** Step 12 now cites `fakeConfig` → `watchlist_service_test.go:244-251` and `wideCaps` → `:362`. Step 20 cites the feature-240 entry → `config-governance.md:141-150`, which is correct on this branch. On the feature-278 branch it sits at `:172-181`, a rebase-only shift.

## Session 2026-11-02 — sdd-execute pre-execution re-spec (sdd-batch-execute)

- Setup: merged `origin/main-dev` into the feature branch (`e82c2f0a`); `631028eb` (278) is now an ancestor. One conflict in `docs/roadmap/features/merge-order.md`, resolved by hand: the 281←278 row keeps the branch side; main-dev's new 243←278 soft row is kept. `ledger-guard --fix`: clean.
- Re-spec (`implementation-spec.md`, commit `9ea2c6e3`). Step bodies Instructions/Evidence/Files/Verification only:
  - Steps 4, 17, 18, 20, 21: line anchors re-aligned after the merge; content unchanged. `ci-gate` `needs:` now includes `config-wiring`.
  - Step 10: verified that no ingest migration adds an FK on `ingest.newsletter_signals`, so no `signal_sources` fixture row is needed. Closes the spec-time unverified item for Steps 10/16.
  - Step 11: all 278 checker anchors and service evidence still match. **BLOCKING:** Verification block 2 (035 collision) fails. `origin/claude/smoke-test-deployment-0f1z5j` carries config `035_smoke_rpc_user_id` and `036_smoke_writes_enabled`; `origin/main-dev` tops out at `034`. Per Instruction 9, **Step 11 waits for an operator ruling** (renumber 281's seed, or ignore that non-feature `claude/*` branch). Feature 282's planned 036/037 are affected too; 282 not touched.

## Session 2026-11-02 — sdd-execute sequential (sdd-batch-execute)

- **Up-front confirmation:** the operator approved the sequential plan before the batch started (one commit per step on `feature/signal-watchlist-expiry-pruning`, no per-step PRs, one integration PR at the end). Status `implementation-ready` → `in-progress`.
- Runs the operator-approved seed amendment (design.md `## Amendment 2026-11-02`, `e01736e2` + `be90c5a9`). Config migration 035 lands in Step 11 with its reader. No `scripts/config-wiring.json` entry.
- **Open at the checkpoint:** the Step 11 035 collision ruling (previous session). The overlap items and Open Threads above carry forward.

### Step 1 — proto (2026-11-02)

- Added `message WatchlistSignalProvenance { int64 signal_id = 1; google.protobuf.Timestamp valid_until = 2; }` before `AddWatchlistSymbolsRequest`, and `signal_provenance = 4` on that request (`packages/proto/portfolio/v1/portfolio.proto`). `WatchlistBinding`, enums and existing field numbers untouched; no new import.
- TDD: N/A (proto contract). Verification: `buf lint` OK and `buf breaking` vs `origin/main-dev` (`1ea1c19c`) rc=0, buf 1.72.0 in the `xstockstrat-codegen` image. The baseline was a `git archive` tarball, not the `.git` ref (Deviation Log, CI-equivalent fallback).
- Spec citation drift (no effect): the comment-convention anchor is `:346`, not `:347`. The CI buf commands are at `ci.yml:146-166`, not `:139-155`.
- Next: Step 2 (regenerate stubs via the Docker codegen image).

### Step 2 — proto-gen (2026-11-02)

- Ran `./scripts/buf-gen.sh` inside the pinned `xstockstrat-codegen` image (rebuilt from the current `Dockerfile.codegen`, cached). Changed: `gen/go/portfolio/v1/portfolio.pb.go`, `gen/python/portfolio/v1/portfolio_pb2.py`, `gen/ts/portfolio/v1/{portfolio.ts,portfolio_pb.ts}` and `gen/ts/dist/portfolio/v1/{portfolio,portfolio_pb}.{js,d.ts}` (8 files, +582/-199). Nothing outside `portfolio/v1`; no `_grpc`/`_connect` change (no RPC added).
- TDD: N/A (generated code). Verification: the second run was a no-op (identical `git status --porcelain` + `git diff` cksum `3205474957`).
- Worktree gotchas: the `tsc` stage needs the worktree's own `pnpm install --frozen-lockfile` (a symlinked root `node_modules` does not reach `gen/ts/node_modules` or the container mount). The script's built-in `buf breaking` skips silently in the container (the worktree `.git` pointer is outside the mount); Step 1's explicit `buf breaking` vs `origin/main-dev` is the gate.
- Next: Step 3 (migration `018_watchlist_signal_expiry`).

### Step 3 — migration (2026-11-02)

- Created `services/xstockstrat-portfolio/migrations/018_watchlist_signal_expiry.{up,down}.sql`: the design § 1 DDL verbatim (`CREATE TABLE IF NOT EXISTS portfolio.watchlist_signal_expiry`, PK `(watchlist_id, symbol)`, FK to `portfolio.watchlists` `ON DELETE CASCADE`, `signal_id BIGINT` nullable = backfill "untracked" marker; `watchlist_signal_expiry_valid_until_idx`). Down is `DROP TABLE IF EXISTS` (index drops with it). No ALTER of any existing table; no applied migration touched (F-01).
- `018` still free: no portfolio `018_*` in the tree, and `git log --remotes=origin -- 'services/xstockstrat-portfolio/migrations/018_*'` is empty.
- TDD: N/A (migration). Verification: offline only (`ls` of both files + read-through; 0 `ALTER` lines). No database started. The real-DB apply is proven by Step 4's `portfolio-db-test` CI job.
- Discovery note (no effect): `011_*` uses plain `ADD COLUMN`. The idempotent style the spec cites is in `017_*` (and `007_*`), and that is the style followed here.
- Next: Step 4 (real-Postgres harness + `portfolio-db-test` CI job).

### Step 4 — real-Postgres harness + CI job (2026-11-02)

- Created `internal/repository/dbtest_helpers_test.go` (`//go:build dbtest`). `testPool` reads `PORTFOLIO_DB_TEST_URL`. When it is unset, the test skips, but `CI=true` makes it fail instead (analysis `real_pg` precedent, `tests/conftest.py:435-439`). The pool sets `lock_timeout=500ms`, and cleanup deletes `portfolio.watchlists` rows `LIKE 'it-281-%'` (cascade). Seed and read helpers: `seedWatchlist`, `seedBinding`, `seedExpiry`/`insertExpiry`, `bindingSource`, `expiryRow`, `testUserID`.
- Created `signal_expiry_schema_dbtest_test.go`. `TestSignalExpirySchema` checks that a NULL `signal_id` is accepted, that a duplicate `(watchlist_id, symbol)` gives `23505`, and that deleting the watchlist cascades to both the expiry rows and the binding. Every helper is used, because `unused` lints the dbtest files once `build-tags: [dbtest]` is set.
- `.golangci.yml`: `run.build-tags: [dbtest]`. `ci.yml`: new `portfolio-db-test` job after `ledger-db-test`. It uses the same TimescaleDB service and migrator image, `setup-go@v7` with Go 1.27, and runs `go test -tags dbtest -race -count=1 ./internal/repository/...` with `GOWORK=off`, `CI=true` and `PORTFOLIO_DB_TEST_URL`. The job is added to `ci-gate` `needs:` and to the summary echo. No pnpm/proto build step is needed: the Go stubs are checked in.
- TDD: N/A (test infrastructure). Offline RED: `no tests to run` before the files existed. Offline GREEN: `go vet -tags dbtest` OK, GO-LINT `0 issues`, skip without the URL and fail under `CI=true`. The untagged `go test ./internal/repository/...` still passes. The real-DB run happens in CI (Deviation Log).
- Next: Step 5 (repository add path).

### Step 5 — repository add path [done] (2026-11-02)

- `watchlist_repo.go` now has the repo-local `SignalProvenance` / `ExpiryIntent` and `const mergeSignalExpirySQL`. `insertBindingsTx` is split into a per-row `insertBindingTx` (`RowsAffected()==1`) and a loop that returns `map[string]bool` of fresh inserts. `Create` and `Update` discard the map; the SQL is unchanged.
- `AddSymbols(ctx, id, bindings, intent)` runs touch (parent lock), then insert, then `applyExpiryIntentTx`, in one tx. A fresh insert plus provenance upserts the row (overwrite). An existing binding plus provenance reads `source`; SIGNAL runs the update-only merge, MANUAL or no row writes nothing. `UntrackSymbols` runs `DELETE … symbol = ANY($2)`. `WatchlistStore.AddSymbols` and the fake take the intent. The call site passes `repository.ExpiryIntent{}`, so the service is unchanged until Step 7.
- Files modified: `services/xstockstrat-portfolio/internal/repository/watchlist_repo.go`, `services/xstockstrat-portfolio/internal/service/portfolio_service.go`, `services/xstockstrat-portfolio/internal/service/watchlist_service_test.go`.
- TDD: RED came from an uncommitted dbtest compile probe (`go vet -tags dbtest ./internal/repository/` → `undefined: ExpiryIntent`). GREEN: the same probe vets clean, and then the probe was deleted. The behavioral RED/GREEN for AC-3/8/9/11/17 is Step 6 in CI `portfolio-db-test`.
- Verification: `go build ./...`, `go vet ./...` and `go vet -tags dbtest ./...` all pass. GO-LINT reports `0 issues`. The untagged `go test ./internal/repository/... ./internal/service/...` passes. No database was started.
- Deviations: RED probe plus the `applyExpiryIntentTx` helper (Deviation Log).
- Next: Step 6 (add-path DB tests).


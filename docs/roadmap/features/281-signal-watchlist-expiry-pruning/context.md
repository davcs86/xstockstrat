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

### Step 6 — add-path DB tests [done] (2026-11-02)

- Created `internal/repository/watchlist_signal_expiry_add_dbtest_test.go` (`//go:build dbtest`) with 7 `TestAddPath_*` functions. `FreshInsertOverwrites`: fresh stamp, and an orphan row is overwritten to an earlier date, which proves it is not merged. `MergeTrackedSignal` (AC-3/AC-8, table-driven): a later renewal 102 advances the row, and an earlier signal keeps (2026-11-01, 101). `UntrackedStaysUntracked`. `RescueMarkedRow` (AC-17): live 110, and past 111 holds 2026-10-15. `ManualBindingNotTracked`. `Untrack` (AC-9/AC-11): a provenance-less SIGNAL add deletes the row; an UNSPECIFIED add keeps it; a MANUAL add of SIGNAL META leaves `source=2` and the row unchanged. `ReplaceAllKeepsExpiry` (T6): a rename keeps the rows, and a MANUAL re-stamp leaves an orphan row.
- Files modified: `services/xstockstrat-portfolio/internal/repository/watchlist_signal_expiry_add_dbtest_test.go`.
- TDD: AC-3/8/9/11/17. RED: with `watchlist_repo.go` temporarily restored from `d088d1e2`, `go vet -tags dbtest ./internal/repository/` failed with `undefined: ExpiryIntent`; the file was then restored. GREEN (offline): `go vet -tags dbtest ./...` OK, GO-LINT `0 issues`, the `TestAddPath_` count is 7, and the tests skip locally and fail under `CI=true` without the URL. GO-COVER total is 68.6%. The behavioral run is CI `portfolio-db-test`, and no database was started.
- Deviations: compile-RED approach and DB run deferred to CI (Deviation Log).
- Next: Step 7 (`AddWatchlistSymbols` provenance validation and intent mapping).

### Step 7 — `AddWatchlistSymbols` provenance validation and intent mapping [done] (2026-11-02)

- Added the unexported pure helper `expiryIntentFor(req, existing, add)` beside `requestBindings` in `portfolio_service.go`. With provenance it requires a system-managed list, exactly one normalized binding that is SIGNAL, `signal_id > 0` and `valid_until.seconds > 0` (otherwise `InvalidArgument`), and returns `{Provenance{SignalID, ValidUntil.AsTime()}, Symbol: add[0].Symbol}`. Without provenance it returns `{UntrackSymbols: <SIGNAL symbols in add>}`, which is empty for MANUAL, UNSPECIFIED and flat adds. `AddWatchlistSymbols` calls it right after `requestBindings`, before the cap check and before any write (AC-18), and passes the intent to `s.watchlists.AddSymbols` instead of the zero value. `normalizeBindings`, `requestBindings` and `applyDefaultStrategy` are untouched.
- Files modified: `services/xstockstrat-portfolio/internal/service/portfolio_service.go`.
- TDD: AC-18 red: an uncommitted probe (manual list + one SIGNAL binding + provenance `{101, 2026-11-01}`) failed with `err = <nil>, want InvalidArgument`. Green: the same probe passed after the change, and then it was deleted. The full AC-18 table and the intent assertions are Step 8.
- Verification: `go build ./...` OK. `go test ./internal/service/ -run 'AddWatchlistSymbols|ExpiryIntent'` → `ok`. `go vet ./...` and `go vet -tags dbtest ./...` OK. The full `go test ./...` passes. GO-LINT reports `0 issues`. No database was started.
- Deviations: RED came from an uncommitted probe because Step 8's test file is outside this step's Files (Deviation Log).
- Next: Step 8 (service unit tests for provenance validation and intent mapping).

### Step 8 — provenance validation and intent mapping tests [done] (2026-11-02)

- `fakeWatchlistStore.AddSymbols` now records the last `ExpiryIntent` (`lastIntent`) and a call count (`addSymbolsCnt`). Dedupe is unchanged. Three new tests:
  - `TestAddWatchlistSymbols_ProvenanceValidation` is a table of the five AC-18 rejections. Each row asserts `InvalidArgument`, zero `AddSymbols` calls and no stored binding.
  - `TestAddWatchlistSymbols_ProvenanceTracksIntent`: the intent carries `Provenance{101, 2026-11-30}` and the normalized `Symbol` `AAPL`.
  - `TestAddWatchlistSymbols_NoProvenanceIntent`: a SIGNAL add untracks `[AAPL]`; MANUAL and flat-symbols adds carry an empty intent.
- Files modified: `services/xstockstrat-portfolio/internal/service/watchlist_service_test.go`.
- TDD: AC-18 red: with `portfolio_service.go` temporarily restored to pre-Step-7 (`c625dd5b`), all five rejection rows failed with `err = <nil>, want InvalidArgument`. In the same run the tracking test failed with `Provenance = nil` and the SIGNAL untrack case failed with `UntrackSymbols = [], want [AAPL]`. Green: all passed after the file was restored from HEAD.
- Verification: the step command passed with 4 top-level `--- PASS`. GO-LINT reports `0 issues`. GO-COVER total is 68.6%. No database was started.
- Deviations: the RED method, and `SignalSourceSkipsDefault` needed no body change (Deviation Log).
- Next: Step 9 (repository prune tick `PruneExpiredSignalEntries`).

### Step 9 — repository prune tick `PruneExpiredSignalEntries` [done] (2026-11-02)

- Created `internal/repository/signal_expiry_repo.go`: `PrunedEntry`, `PruneResult` and `(*WatchlistRepo).PruneExpiredSignalEntries`. It enumerates due lists with `SELECT DISTINCT watchlist_id … valid_until <= now()`, then runs one short tx per list. Parent `FOR NO KEY UPDATE SKIP LOCKED` (no row → `SkippedLists`). Due expiry rows D `FOR UPDATE SKIP LOCKED`. SIGNAL bindings in D `FOR UPDATE SKIP LOCKED` → L. `DELETE … ANY(L) RETURNING symbol, strategy_id` → R. Expiry rows of R plus expired orphans (no SIGNAL binding) are deleted. The parent is touched only when R is non-empty. The tx commits on every non-skipped list. `PrunedEntry` rows come only from R, joined to D (`SignalID` nil for an untracked mark). A per-list error is recorded and the loop continues; the first error is returned with the committed removals. DB `now()` is the only clock; no `lock_timeout` in the statements; no events from the repo.
- `WatchlistStore` gains `PruneExpiredSignalEntries`; its comment states that committed removals come back even with `err != nil`, which Step 11 relies on. The fake returns the configurable `pruneResult`.
- Files modified: `services/xstockstrat-portfolio/internal/repository/signal_expiry_repo.go`, `services/xstockstrat-portfolio/internal/service/portfolio_service.go`, `services/xstockstrat-portfolio/internal/service/watchlist_service_test.go`.
- TDD: RED came from uncommitted probes. `go vet -tags dbtest ./internal/repository/` → `r.PruneExpiredSignalEntries undefined (type *WatchlistRepo has no field or method PruneExpiredSignalEntries)`. The service probe build failed with `undefined: repository.PruneResult` / `WatchlistStore has no field or method PruneExpiredSignalEntries`. GREEN: the repo probe vets clean and the service probe passes (`--- PASS`); both probes were then deleted. The behavioral RED/GREEN is Step 10 in CI `portfolio-db-test`.
- Verification: `go build ./...`, `go vet ./...` and `go vet -tags dbtest ./...` pass. GO-LINT reports `0 issues` after `gofmt` on the new file. The full untagged `go test ./...` passes. No database was started.
- Deviations: RED probes, commit on every non-skipped list, the `Lists` meaning, and small helpers (Deviation Log).
- Next: Step 10 (prune tick DB tests).

### Step 10 — prune tick DB tests [done] (2026-11-02)

- Created `internal/repository/signal_expiry_prune_dbtest_test.go` (`//go:build dbtest`) with 9 `TestPrune_*` functions: `ExpiredOnlySignalRemoves` (AC-2, list survives), `MergedRowRetainsThenRemoves` (AC-3, two `AddSymbols` merges then expire → `SignalID` 102), `UntrackedEntrySurvives` (AC-4, 3 ticks), `ManualOrphanSweptEntryKept` (AC-5), `SecondTickIsNoop` (AC-6), `RenewalEventNamesSignal102` (AC-8), `StrategyBoundRemovedLikeAny` (`strat-9`), `IngestSignalsDoNotKeepAlive` (AC-10, a live `buy` + an `mcp_client` `watchlist` row; no FK, `user_id` supplied), `ConcurrencyNeverWaits` (AC-12 a/b/c subtests). `valid_until` is set relative to DB `now()`; every `PrunedEntry` field is asserted against the pre-tick row. The `UpdateBinding` SQL-order dependency is a test comment.
- Files modified: `services/xstockstrat-portfolio/internal/repository/signal_expiry_prune_dbtest_test.go`.
- TDD: RED: the new file compiled against a `git archive` of `814956b8` (pre-Step-9) → `undefined: PrunedEntry`. GREEN (offline): `go vet -tags dbtest ./...` OK, GO-LINT `0 issues`, `TestPrune_` count 9, tests skip without the URL, GO-COVER total 68.6%. Behavioral run is CI `portfolio-db-test`; no database was started.
- Deviations: RED method, per-list filtering of the global tick, deterministic AC-12(b) via `pg_stat_activity` polling (Deviation Log).
- Next: Step 11 (prune loop, events, interval clamp, startup wiring, config migration 035).

## Session 2026-11-02 — re-spec: seed migration 035 → 037 (operator)

- **Collision:** feature 280 `smoke-check-runtime` (open PR #1359, branch `origin/claude/smoke-test-deployment-0f1z5j`) already holds config migrations `035_smoke_rpc_user_id` and `036_smoke_writes_enabled`. `origin/main-dev` still tops out at `034_retire_portfolio_snapshot_interval`. Step 11 Verification block 2 failed on it, so Step 11 halted before writing anything.
- **Decision (operator, 2026-11-02):** 280 keeps 035/036. 281's seed becomes `037_portfolio_signal_prune_interval`, and feature 282's seeds become 038/039. golang-migrate has no out-of-order guard, so 281's integration PR merges only after 280's (#1359) is on `main-dev`. If 280 renumbers, 281 re-checks with the operator.
- **Files changed (docs only, uncommitted):** `implementation-spec.md` (every 035 for this seed → 037; Step 11 Codebase Evidence collision bullet marked resolved; Instruction 9 adds the pre-merge assertion that #1359 is merged; Verification block 2 checks 037, flags any other NNN ≥ 37 on `main-dev`, greps `/037_` on every origin ref, and checks that 280's 035/036 seeds sort below ours: WARN when absent from both `origin/main-dev` and the 280 branch, STOP with `MERGE_TIME=1` unless they are on `origin/main-dev`; Steps 14 and 20 numbers/names only), `design.md`, `product-spec.md`, `acceptance.feature` (`@AC-19` Given renamed: a pre-implementation wording fix, ID kept), `recon.md` (appended note under the Amendment), `feature.md` (Status History row), `docs/roadmap/features/merge-order.md` (new 281 ← 280 row; 282 ← 281 row renumbered to 038/039 and 037).
- **F-09:** Steps 1-10 are untouched. Step 11's body was edited because Step 11 had not executed (it halted at the blocker with nothing committed). This is the re-spec gate before relaunch, not a post-execution rewrite.

## Session 2026-11-02 — sdd-execute sequential (resume at Step 11)

### Step 11 — prune loop, owner-visible events, interval clamp, startup wiring [done] (2026-11-02)

- Created `internal/service/signal_prune.go`:
  - Constants: a column-0 `const signalPruneIntervalKey = "portfolio.watchlist.signal_prune_interval_seconds"` and a `const (` block holding default 300, min 60 and max 86400.
  - `clampPruneInterval`: `<=0` → 300s, `1..59` → 60s, `>86400` → 86400s.
  - `pruneInterval()` calls `s.wlCfg.GetInt(signalPruneIntervalKey, defaultPruneIntervalSec)` directly, with no wrapper, and re-reads it every iteration.
  - `PruneExpiredSignalEntries(ctx)` runs one tick at startup, then a `select` on `ctx.Done()` / `time.After(s.pruneInterval())`.
  - `pruneOnce(ctx)` builds a single `tickCtx` with a fresh outgoing `x-trace-id`. The repo call and every emit share it.
  - On a repo error it WARNs and still emits for `res.Removed`, because the Step 9 contract returns committed removals even when `err != nil`.
  - Each removal produces one `emitEventAs(tickCtx, e.UserID, …)` with stream key `watchlist:<id>`:
    - `signal_entry_expired` carries `{user_id, watchlist_id, symbol, strategy_id, signal_id, valid_until RFC3339 UTC}`.
    - `signal_entry_removed_untracked` carries `{user_id, watchlist_id, symbol, strategy_id}`.
  - Each tick ends with one `InfoContext` line: `lists`, `skipped`, `removed`.
- `portfolio_service.go`: `emitEvent` now delegates to the new `emitEventAs(ctx, ownerUserID, …)`, which keeps the retry and idempotency body unchanged and sets `AppendEventRequest.UserId = ownerUserID`. An empty owner keeps the old behavior, because the proto zero value lets ledger fall back to metadata. `cmd/server/main.go` gains `go svc.PruneExpiredSignalEntries(ctx)` right after `go svc.HydrateStops(ctx)`.
- Config migration `037_portfolio_signal_prune_interval.{up,down}.sql`: design amendment A SQL verbatim. It is in the same commit as the reader, as Instruction 8 requires. No `scripts/config-wiring.json` edit.
- Files modified: `services/xstockstrat-portfolio/internal/service/signal_prune.go`, `services/xstockstrat-portfolio/internal/service/portfolio_service.go`, `services/xstockstrat-portfolio/cmd/server/main.go`, `services/xstockstrat-config/migrations/037_portfolio_signal_prune_interval.up.sql`, `services/xstockstrat-config/migrations/037_portfolio_signal_prune_interval.down.sql`.
- TDD:
  - RED: an uncommitted probe failed with `undefined: clampPruneInterval` / `signalPruneIntervalKey`, `s.pruneInterval undefined` and `s.pruneOnce undefined`.
  - GREEN: the probe passed (clamp rows, `pruneInterval()` 30 → 60s, one tick → 2 appends) and was then deleted.
  - The full behavioral table is Step 12.
- Verification:
  - Block 1: build, vet and the three greps all pass, and `go vet -tags dbtest ./...` is OK.
  - Block 2, pre-write (pair line left out): `037` is free on every origin ref, `origin/main-dev` tops out at `034`, and 280's 035/036 are 2/2 on `origin/claude/smoke-test-deployment-0f1z5j` and 0/2 on main-dev, so no WARN. Block 2, post-write: the pair is present and the result is unchanged.
  - Block 3: rc 0.
  - Block 4: `key hits 0, introduced 0, pre-existing 0` (stored 182 vs base 180 = the two new rows), so there are no ESCALATE lines. Negative control: with `signal_prune.go` moved aside, `--final` reports `037…:portfolio/portfolio.watchlist.signal_prune_interval_seconds:seeded-unread`. The file was then restored.
  - GO-LINT: `0 issues`. Full `go test ./...` passes. No database was started.
- Collision-check record (Instruction 9): pre-write and post-write runs above. Still owed: a re-run before opening the integration PR, and a `MERGE_TIME=1` run after the final rebase, immediately before merge. The second requires PR #1359 (280) on `main-dev`.
- Deviations: RED probe, and blocks 2 and 4 run as split plain commands (sandbox) (Deviation Log).
- Next: Step 12 (prune loop service unit tests).

### Step 12 — prune loop events, interval clamp and no-op tick (service unit tests) [done] (2026-11-02)

- Created `internal/service/signal_prune_test.go` with 7 tests, each driving one tick via `s.pruneOnce(ctx)` (never the sleeping loop):
  - `TestClampPruneInterval`: `0`/`-5` → 300s, `1`/`30`/`59`/`60` → 60s, `86400`/`90000` → 86400s (AC-14 read half).
  - `TestSignalPrune_ExpiredEventPayload`: subtests `expired` (`signal_id 101`, AC-7/AC-13) and `renewed` (`signal_id 102`, AC-8). Each asserts exactly one `portfolio.watchlist.signal_entry_expired`, `UserId == "user-1"`, stream key `watchlist:wl-1`, a non-empty `x-trace-id` in outgoing metadata, and payload `user_id`/`watchlist_id`/`symbol`/`strategy_id "strat-9"`/`valid_until "2026-10-01T00:00:00Z"`.
  - `TestSignalPrune_UntrackedEventPayload`: ORCL with nil `SignalID` → one `…signal_entry_removed_untracked`, same owner/stream/trace/payload checks, no `signal_id`/`valid_until` keys (AC-13).
  - `TestSignalPrune_LedgerErrorIsBestEffort`: `codes.Internal` ledger error on every emit → still 2 `AppendEvent` calls for 2 removals.
  - `TestSignalPrune_NoopTickEmitsNothing`: empty `PruneResult` → 0 calls (AC-6).
  - `TestSignalPrune_IntervalDefaultsWhenUnset` (unset key → 300s) and `TestSignalPrune_IntervalReadsConfig` (`fakeConfig` `0`/`30`/`90000` → 300s/60s/86400s through `pruneInterval()`).
- `watchlist_service_test.go`: `fakeLedger` gains `reqs []*ledgerv1.AppendEventRequest` and `outMD []metadata.MD`; `AppendEvent` records the request and `metadata.FromOutgoingContext(ctx)`. Existing behavior (`calls`, `err`) unchanged.
- Files modified: `services/xstockstrat-portfolio/internal/service/signal_prune_test.go`, `services/xstockstrat-portfolio/internal/service/watchlist_service_test.go`.
- TDD: AC-13 red: build failed `ledger.reqs undefined` / `ledger.outMD undefined` → green: 7 `--- PASS`, `ok internal/service`.
- Verification: the step one-liner → `VERIFY_RC=0`; GO-LINT `0 issues`; GO-COVER full `go test ./...` passes, total 68.6% (≥ 40%; new code in excluded `service/`). No database was started.
- Deviations: RED source (Step 11 already landed) and the Verification run from a script file (Deviation Log).
- Next: Step 13 (config `SCALAR_BOUNDS_REGISTRY` entry).

### Step 13 — config: `SCALAR_BOUNDS_REGISTRY` entry for the prune interval [done] (2026-11-02)

- `configServiceImpl.ts`: after the feature-240 row, a one-line constraint comment and `'portfolio.watchlist.signal_prune_interval_seconds': { minValue: 60, maxValue: 86400 }`. `lookupScalarBounds` resolves both key-column forms (bare full-dotted key, or `${namespace}.${key}`), so this one entry covers both. No migration, no env change, no `scripts/config-wiring.json` edit.
- Files modified: `services/xstockstrat-config/src/grpc/configServiceImpl.ts`.
- TDD: N/A (config category). The write-side bounds behavior is proven by Step 14's `TIMEOUT_KEY_FORMS` rows.
- Verification: grep hit at `:150`; `pnpm run lint` 0 errors (234 pre-existing warnings); `tsc --noEmit` clean. `check-config-wiring.mjs --declared-from …/product-spec.md` rc 0 with no findings. `--final` rc 0; its only `REPORTED` line is the pre-existing `trading.fill_poller.interval_ms` baseline, so Step 11 is not reopened.
- Deviations: the Verification ran from a script file because of the sandbox (Deviation Log).
- Next: Step 14 (config bounds rows + the 037 seed parse test, AC-14/AC-19).

### Step 14 — config bounds rows for the prune interval and the 037 seed parse test (AC-14/AC-19) [done] (2026-11-02)

- `setConfigScalarBounds.test.ts`: two `TIMEOUT_KEY_FORMS` rows (`watchlist.signal_prune_interval_seconds` and `portfolio.watchlist.signal_prune_interval_seconds`, `intVal`, `[60, 86400]`). The generated loop covers 60/86400 accepted and 59/86401 rejected. An explicit case covers the full-dotted form `= 0`: rejected `INVALID_ARGUMENT`, `[60, 86400]` text, no INSERT.
- New `src/__tests__/migrationSql.ts` (test-only, outside the `*.test.js` glob) exports `MIGRATIONS_DIR`, `findOne(suffix, ext)` and `splitStatements`, moved verbatim from zeroTrap. Only change: `suffix` is now a parameter. `zeroTrapDescriptionMigration.test.ts` imports them and drops its local copies; its 4 tests are unchanged and pass.
- New `signalPruneIntervalSeedMigration.test.ts` has 5 plain `it()` cases. They check: up is one statement that full-matches the two-row global `INSERT … ON CONFLICT … DO NOTHING`; namespace, key, `int` and `xstockstrat-portfolio`; environments `['production','staging']`; `value_data = default_value = '300'`, inside `[60,86400]`; and down deep-equals the single global-row DELETE.
- Files modified: the four Step 14 **Files**.
- TDD: AC-19 red (037 pair moved to the scratchpad): rc 1, `# fail 5`, `expected exactly one` (pair restored, `migrations/` clean). Bounds red (Step 13 registry line temporarily removed): 3 rejection cases failed (restored). Green: two-file run `# pass 9 / # fail 0`.
- Verification: greps OK; lint 0 errors (234 pre-existing warnings); `test:coverage` 272 pass / 0 fail, 90.61% lines; `c8 check-coverage --lines 40` rc 0. `setConfigScalarBounds.test.ts` fails `prettier --check`, but so does the base file (pre-existing), so it was left alone (surgical diff). No database was started.
- Deviations: split plain commands (sandbox); bounds RED by a temporary Step 13 revert (Deviation Log).
- Next: Step 15 (`portfolio backfill-signal-expiry` operator subcommand).

### Step 15 — `portfolio backfill-signal-expiry` operator subcommand (REPORT / APPLY) [done] (2026-11-02)

- `cmd/server/main.go`: a `backfill-signal-expiry` dispatch right after the `healthcheck` branch, before telemetry, config and mTLS.
- `cmd/server/backfill.go`, `runBackfillSignalExpiry(args) int`:
  - Parses `--mode` (default `report`), `--legacy-owner`, `--expect-untracked` and `--expect-seed-expired`. An expect-* pointer is set only when that flag was given (`fs.Visit`), so an unset bound stays nil.
  - Prints the spec's exact refusal on stderr and returns 2 when `DATABASE_URL` is empty. Otherwise it prints `target host=… db=…` from `pgxpool.ParseConfig` before anything else.
  - Opens the pool via `NewPortfolioRepo` + `Pool()` (no new `NewPool`) and calls `RunBackfill`.
  - Exit codes: 3 on `ErrBackfillRefused`, 1 on any other error, 2 on usage errors.
- `internal/repository/signal_expiry_backfill.go`:
  - Exports `BackfillOptions`, `BackfillResult` (with `Report` = everything written to `out`), `ErrBackfillRefused`, `RunBackfill`, and the `BackfillModeReport`/`BackfillModeApply` constants.
  - Refuses before any DB access when the mode is unknown, the legacy owner is empty (both modes), or an APPLY bound is nil.
  - Classification is one read-only `REPEATABLE READ` transaction over SIGNAL (`source = 2`) bindings on `system_managed` lists that have no expiry row. Each binding's own watchlist-direction rows are matched with `upper(btrim(n.symbol)) = s.symbol` and `lower(n.direction) = 'watchlist'`:
    - any open-ended row → skipped;
    - dated rows → seed, using `max(valid_until)` and that row's `id` (ties go to the higher `id`), with `seed_expired` meaning `<= now()`;
    - no rows → untracked, which gets marked.
  - `legacy_rows` and `legacy_live` come from rows under `--legacy-owner`. They are informational only.
  - REPORT prints the header (legacy owner, read-only), SEED rows, UNTRACKED rows, `with_live_legacy_signal`, the PER-OWNER table (with the `NO_OWN_SIGNALS` flag), TOTALS, and the `NEXT:` APPLY command.
  - APPLY prints its header and the live counts, then refuses (nothing written) if live untracked > N or seed_expired > M. Otherwise it runs one autocommit `INSERT … SELECT … ON CONFLICT DO NOTHING` per row in `(watchlist_id, symbol)` order:
    - the seed recomputes the latest dated own row and requires that no open-ended row exists;
    - the mark writes `(now(), NULL)` and requires that no own row exists;
    - 0 rows affected counts as `changed since REPORT`.
  - It never deletes a binding, takes no `FOR UPDATE`, and makes no ledger or gRPC call.
- Files modified: `services/xstockstrat-portfolio/cmd/server/main.go`, `services/xstockstrat-portfolio/cmd/server/backfill.go`, `services/xstockstrat-portfolio/internal/repository/signal_expiry_backfill.go`.
- TDD: RED came from uncommitted probes: `undefined: BackfillResult` (dbtest vet) and `undefined: runBackfillSignalExpiry` (cmd/server test build). GREEN: both probes passed (refused on an empty legacy owner; rc 2 plus the refusal text) and were deleted. The behavioral tests are Step 16.
- Verification:
  - `go build ./...`, `go vet ./...` and `go vet -tags dbtest ./...` all pass.
  - The offline refusal check gives rc 1 (`go run` maps the child's exit status 2), and the output includes `DATABASE_URL is required`.
  - GO-LINT: `0 issues`.
  - Full `go test ./...` passes.
  - The step-time `check-config-wiring.mjs` gate returns rc 0.
  - No database was started.
- Deviations: RED probes; exit-code/output-format choices (Deviation Log).
- Next: Step 16 (backfill DB tests).

### Step 16 — backfill DB tests [done] (2026-11-02)

- Created `internal/repository/signal_expiry_backfill_dbtest_test.go` (`//go:build dbtest`), which drives `RunBackfill` directly and has 9 `TestBackfill_*` functions:
  - `ReportIsReadOnly`: the expiry row count is unchanged and the result shows zero writes.
  - `BoundsRefuseBeforeWrite`: untracked or seed_expired bound exceeded → `ErrBackfillRefused`, nothing written.
  - `LegacyOwnerRequired`: an empty or blank owner is refused in both modes, and APPLY with a nil bound is refused.
  - `SeedsFromOwnerRows` (AC-15): the `" aapl"` live row beats an older `"AAPL"` row. REPORT has the exact `SEED` line and APPLY writes `(valid_until, id)`.
  - `StrictUntrackedRemoval` (AC-16): REPORT has the `UNTRACKED … strat-3 1 Y` and `NO_OWN_SIGNALS` lines. A `live - 1` bound refuses with zero writes. APPLY marks `(now, NULL)`, and the tick returns a `PrunedEntry` with nil `SignalID` and `strat-3`.
  - `MarkedEntryRescued` (AC-17): a live 110 renewal keeps the entry, and a past 111 renewal is removed with `SignalID` 111.
  - `OpenEndedStaysUntracked`: the entry is not listed and gets no row, and the tick keeps it.
  - `Idempotent`: the second APPLY writes nothing.
  - `IngestInterleavingSkipsChanged` (T4): 10 concurrent APPLY versus ingest+renewal races. The entry is never left due or removed.
- Files modified: `services/xstockstrat-portfolio/internal/repository/signal_expiry_backfill_dbtest_test.go`.
- TDD: RED compiled the file against a `git archive` of `5f5a755a` (pre-Step-15) → `undefined: BackfillResult`. GREEN (offline):
  - `go vet -tags dbtest ./...` passes and GO-LINT reports `0 issues`.
  - The `TestBackfill_` count is 9.
  - The tests skip without `PORTFOLIO_DB_TEST_URL`.
  - GO-COVER total is 68.6%.
  - The behavioral run is CI `portfolio-db-test`. No database was started.
- Deviations: bounds come from a live REPORT because the classifier is global; dates and ids are DB-relative; AC-16 uses a per-test legacy owner; AC-17 is split into two subtests; T4 runs as a race; the RED method (Deviation Log).
- Next: Step 17 (agent sends signal provenance on the `direction="watchlist"` auto-add).

### Step 17 — agent sends signal provenance on the `direction="watchlist"` auto-add [done] (2026-11-02)

- `client.add_watchlist_symbol(user_id, watchlist_id, symbol, signal_id=None, valid_until=None)` builds `WatchlistSignalProvenance(signal_id, valid_until)` only when `signal_id` is truthy and `valid_until` parses (`_iso_to_timestamp`, `ValueError` caught) to seconds > 0; otherwise `signal_provenance` is unset, so portfolio untracks the entry. Binding, metadata and timeout are unchanged.
- `tools.py` `ingest_signal` auto-add passes `result.get("signal_id")` and the tool's `valid_until`. The gate and the best-effort `except`/WARN are unchanged. The `ingest_signal` SIDE EFFECT docstring gains the expiry sentence, and `get_watchlist` gains the pruned-set sentence. No tool added; tool count stays forty-five.
- Files modified: `services/xstockstrat-agent/app/client.py`, `services/xstockstrat-agent/app/tools.py`.
- TDD: RED from an uncommitted probe → `TypeError: … unexpected keyword argument 'signal_id'`; GREEN probe passed, then deleted.
- Verification: the tool-count grep passes (diffed against merge base `1ea1c19c`); `ruff check` and `ruff format --check` pass; `check-config-wiring.mjs` rc 0. PY-VERIFY coverage 84.22%, 641 passed / 1 failed. The failure is `test_watchlist_direction_adds_symbol` asserting the pre-feature call shape; Step 18 updates it in place.
- Deviations: probe RED; PY-VERIFY fully green only after Step 18 (Deviation Log).
- Next: Step 18 (agent provenance tests).

### Step 18 — agent provenance tests (client request builder + tool path) [done] (2026-11-02)

- `tests/test_watchlist_client.py`: `_send_signal_add` / `_assert_signal_binding` helpers, plus `test_add_watchlist_symbol_sends_provenance` (signal 102, `valid_until.seconds` = 2026-12-01T00:00:00Z), `test_add_watchlist_symbol_omits_provenance_when_undated` (parametrized: open-ended, no signal_id, empty string) and `test_add_watchlist_symbol_unparseable_valid_until_still_adds`. Each asserts the request is still sent with the SIGNAL binding and exactly one `x-user-id`.
- `tests/test_ingest_signal_watchlist.py`: `test_watchlist_direction_adds_symbol` updated in place to `("u-2", "wl-sys", "NVDA", 1, None)`. New `_ingest_watchlist` helper, plus `test_ingest_signal_passes_signal_id_and_valid_until`, `test_ingest_signal_open_ended_passes_no_valid_until` and `test_add_invalid_argument_is_swallowed` (WARN logged, ingest result returned). The doc-parity test now also asserts the docstring mentions expiry. The gate tests are unchanged.
- Files modified: `services/xstockstrat-agent/tests/test_watchlist_client.py`, `services/xstockstrat-agent/tests/test_ingest_signal_watchlist.py`.
- TDD: RED against the pre-Step-17 app files (temporarily restored from `b889a6e8`) → 9 failed / 17 passed. GREEN → 26 passed.
- Verification: ruff check/format pass; mandated test-name count >= 6; targeted pytest 26 passed; PY-VERIFY full suite 650 passed, coverage 84.49%.
- Deviations: RED method; the swallow test is a regression guard and passes pre-Step-17 (Deviation Log).
- Next: Step 19 (UI e2e — an emptied system-managed list renders and cannot be deleted).

### Step 19 — UI e2e: an emptied system-managed list renders and cannot be deleted [done] (2026-11-02)

- `e2e/insights/watchlists.spec.ts`: new test `system-managed watchlist emptied by expiry pruning: renders "No symbols", no delete affordance (AC-2)`, placed right after the feature-127 system-managed test.
  - Seed: `wl-sys` (`systemManaged: true`, `bindings: []`, `symbols: []`) through the existing `mockWatchlists`.
  - Assertions: `No symbols` is visible, `Delete Signals` has count 0, Rename is visible, and the add-symbols input is enabled.
- No UI code change. No new fixture, so INVENTORY.md is unchanged.
- Files modified: `services/xstockstrat-ui/e2e/insights/watchlists.spec.ts`.
- TDD: N/A (frontend e2e regression guard over existing behavior).
- Verification:
  - The local `pnpm test:e2e … -g "emptied by expiry pruning"` run timed out twice in the dev-server warmup setup (10 s).
  - Re-running with `CI=1` (production build) gave 2 passed.
  - The grep finds the test at line 373.
- Deviations: verification ran under `CI=1` (Deviation Log).
- Next: Step 20 (docs: service, pattern and constitution documentation).

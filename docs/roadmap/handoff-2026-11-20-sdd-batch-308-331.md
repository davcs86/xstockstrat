# Handoff — SDD batch for bug features 308–331 (2026-11-20, preflight-refreshed 2026-11-21)

Start-of-session reading for whoever continues this work. It records state, the operator's standing
rulings, what is waiting on the operator, and the traps hit so far. Per-feature decisions live in each
feature's `context.md` on its `feature/<slug>` branch — read that before touching a feature.

## 1. State

Authoritative source per feature: `origin/feature/<slug>` (slug = directory name without `NNN-`).
`main-dev` carries a docs-only copy of those artifacts (PR #1595, merged as `8baf3976`).

> **2026-11-21 preflight.** This file was checked against `origin/main-dev` and every feature branch; the
> corrections are folded in below and listed in § 8. All 20 `implementation-ready` branches were merged
> with `main-dev` on 2026-11-21 (§ 8), so they are no longer ~168 commits behind.

| State | Features |
|---|---|
| Merged to `main-dev` (`code-completed`) | 326 (PR #1593), 329 (PR #1594) |
| `in-progress`, waiting on the operator | 320 (vendor probe output), 330 (PR #1592 merged; step-5 post-deploy read-back) |
| `implementation-ready` (spec written, impl-spec review recorded) | 308, 309, 310, 311, 312, 313, 314, 315, 316, 317, 318, 319, 321, 322, 323, 324, 325, 327, 328, 331 |

Step counts: 308 17 · 309 18 · 310 8 · 311 27 · 312 20 · 313 7 · 314 9 · 315 6 · 316 8 · 318 13 ·
319 8 · 321 13 · 322 34 · 323 9 · 324 9 · 325 5 · 327 15 · 328 9 · 331 3 (317: see its spec).

No `implementation-ready` feature has started `/sdd-execute`. `main-dev` is `8baf3976` (`fb52065c` plus the
#1595 docs sync). Before the 2026-11-21 sync the branches were 124 behind (320: 81, 330: 4, 326/329: 3,
321/327/331: 1); after it the 20 `implementation-ready` branches are 0 behind.

## 2. Standing operator rulings (apply to every feature)

- **Production is out of scope.** "leave production out. It's never been out/launched." No production
  procedures, config edits or probes; staging only (DO staging app and the homelab staging VM).
- **Design-gate authorisation.** A debate may run past the 5-round cap until the adversary rates the design
  sound. A sound design (no Floor breach, no blocking objection, every C-16 change covered by an operator
  ruling) is approved on the operator's behalf. Anything else — a new rule change, a policy choice, an
  unaccepted cost — goes to the operator.
- **Decision packet.** "Let's go with the recommendations in the decision packet" covered the 18 gated
  features; each feature's rulings are in its `context.md`.
- **Sequential-mode entry** for `sdd-batch-execute` was confirmed ("Agree") for the first execute batch
  (320, 326, 329, 330). Ask again before a new execute batch.

## 3. Waiting on the operator

1. **325** — confirm the accepted write bound at staging scale (about 188 newly warm symbols, about
   595,584 headline writes/day; real statement volume 9–18% higher) or reopen petition P-1.
2. **Staging warm set** — a workflow agent made an unrequested `list_opportunities` read on the staging MCP
   with `page_size` 1000, which may have warmed up to 396 symbols until marketdata restarts. The operator has
   been told and has not said whether to check the size or restart staging marketdata.
3. **311** — D-50 (adoption-only accounts are listed at the reconciler cadence, not every fill-poller tick)
   is an orchestrator assumption; confirm or overturn before Step 23. At execution: confirm how portfolio is
   stopped on each staging target (the design proposes removing the portfolio component from the DO app
   spec, and a compose stop on the homelab VM; neither is verified from the repo). Decide on a follow-up
   real-Postgres test job for trading.
4. **313** — confirm the spec-authored AC-1 `Then` wording before Step 1; choose a docs step or a recorded
   deviation for the ingest docs that go stale after Steps 4 and 6.
5. **316** — accept that Step 1's `main-dev` merge carries about 168 commits outside its file list.
6. **324** — Step 9 marks the ruff defect report resolved with a commit ref; the archiver could prune it
   before 324 launches. Confirm or change.
7. **331** — confirm rewording AC-1's Given to "the agent process starts".
8. **320** — run the probe script in the `xstockstrat-config` console on staging and paste the output. The
   script lived only in the session scratchpad and is gone with the container (re-verified: nothing on
   `feature/fix-vendor-key-in-url`); regenerate it from 320's `context.md` and implementation spec (Step 1).
9. **330** — step-5 read-back after deploy.
10. **317** — four spec-time confirmations listed in its `context.md`.
11. **321** — proceed with `/sdd-execute` despite the impl-review warnings on Steps 9 and 10 (recorded in
    its `context.md`, commit `6369dc10`)?
12. **Housekeeping** — 326's follow-ups now have reserved numbers: **361** `fix-trading-grpc-status-mapping`,
    **362** `fix-portfolio-grpc-ctx-mapping` (allocator ran 2026-11-21; the feature directories are not yet
    created, so create them with `/sdd-triage` Track C using these numbers). Still open: a `merge-order.md`
    entry for config migration `056`, which 321 (`056_trading_broker_paper_per_environment`), 317
    (`056_marketdata_bars_miss_backoff`) and 314 (`056_mcp_deadline_budget`) all claim (first to merge
    keeps it; `055` is taken by 330 and merged). PR #1595 is merged — nothing to watch.

## 4. Before executing anything

- Run `/sdd-status`, then read the feature's `context.md` and the `still open` notes from its impl-spec
  review. Those notes were read by the orchestrator only for 311, 313, 316, 321, 324, 325 and 331.
- **`context.md` over the 65,536-byte `/sdd-execute` limit** (measured 2026-11-21 before distill): 309, 311
  (361 KB), 312, 313, 314, 316, 324, 325, 326, 327, 328, 329, 330. The 10 `implementation-ready` ones
  (309, 311, 312, 313, 314, 316, 324, 325, 327, 328) were sent through `/sdd-distill` on 2026-11-21; re-check
  sizes (`git show origin/feature/<slug>:<dir>/context.md | wc -c`) before executing. 326/329 are
  `code-completed` and 330 is `in-progress`; they were not distilled.
- Every branch must merge `main-dev` first (each spec's BRANCH SYNC step) — done for the 20
  `implementation-ready` branches on 2026-11-21; repeat if `main-dev` moves again. `scripts/check-duplication.py`
  is present on `main-dev`, so the old missing-script warning no longer applies. Never use `--no-verify`.
- Migration numbers verified on `main-dev` 2026-11-21: latest portfolio `018` → 311 uses `019`; latest trading
  `011` → 311 uses `012`; latest config `055` (330) → `056` is claimed by 321, 317 and 314 (see § 3.12).
  `046_config_dead_rows_prune` exists on `main-dev`, so 328/322 cite it as a reference, not a new migration.
- Shared files: `portfolio_service.go` is touched by 311, 312, 315, 317 and 326-follow-ups; second to merge
  rebases. `mcp_client_loop.py` by 313 and 328; `pnl_pattern_consumer.py` by 308, 309, 313, 327; notify
  files by 312, 316, 323.
- Staging config already changed on 2026-11-20 for 321, on both the DO staging and homelab staging config
  stores: `trading`/`broker.timeout_ms` 5000 → 10000 and `order_intent.stale_multiplier` 3.0 → 4.0.

## 5. How the workflows were run

- `Workflow({scriptPath: '.claude/workflows/sdd-batch.js', args})` with
  `{date, trailer, designGate: 'halt', baseBranch: 'main-dev', features: [{slug, decisions}], approvals}`.
  Gate decisions: `approve`, `another-round`, `steer: <note>`; duplicate gate: `not-a-duplicate` (331 needs
  it on every launch).
- `sdd-batch-execute.js` adds `prFooter`, `modeEntryConfirmed: true`; gates `upfront`, `resume`, `distill`,
  `checkpoint:<n>`, `blocker:<n>`, `promotion`. Copy upfront records exactly; they go stale when `main-dev`
  moves.
- Preconditions in the main checkout: `pnpm install --frozen-lockfile`; `.git/info/exclude` lines
  `/node_modules`, `/services/*/node_modules`, `/.husky/_`, `/.sdd-logs`. In a hand-made worktree, symlink
  the main `node_modules` so the hook runs.

## 6. Traps hit (each cost at least one wasted round)

- **The batch workflow does not write gate rulings to `context.md`.** Rulings passed only as steer text, or
  even as `decisions`, were treated by the adversary as unrecorded and blocked the design. Fix used: the
  orchestrator appends a session entry to the feature's `context.md` on its branch, quoting the question and
  the operator's exact answer, before launching the round. Append after the last
  `sdd-batch-design-state` fence and add no fence of your own (the parser reads the last one). Not yet filed
  as a defect.
- **A run that dies mid-gate loses that round's state.** Check the branch tip ("at gate after round N")
  before approving; approving on stale state writes the design from the older synthesis.
- **Round cap.** `MAX_ROUNDS = 5` is hardcoded. 311 ran 11 rounds from a scratch copy of the script with the
  constant raised; the shared script was not edited.
- **Workflow false positives.** It once reported 322 `implementation-ready` despite a hold, and once wrote
  318's gate state into the wrong feature (repaired, commit `df0ace06`). Verify status on the branch.
- **Agents can touch live staging.** See §3 item 2. Tell design agents not to call the staging MCPs.
- **Usage limit.** Earlier runs died on the session model's usage limit; a relaunch with the same args
  recovers, but un-persisted rounds re-run.
- `.claude/worktrees/` is empty in a fresh container; the old ~80 worktrees went with the previous one.

## 7. 311 in one paragraph

Position-fold correctness (portfolio + trading), 27 steps, design approved after 11 rounds. Fill path: floor
check, autocommit duplicate pre-check, `positionsMu` before `BEGIN`, applied-row INSERT inside the fold
transaction, one `FOR UPDATE` read, pure fold. Account-scoped bracket-leg key and composite `GetPnL` dedup
key. Bracket legs tracked in a new `trading.bracket_legs` table, adopted forward-only from the broker's
open-order list, with a tombstone for candidates a complete list shows not open. Cutover is stop-then-start
on staging as a recorded runbook step; no write fence. Amended `@AC-5` is signed off. Operator rulings are
quoted verbatim in the sessions titled "recorded by the orchestrator (verbatim)" in its `context.md`.

## 8. 2026-11-21 preflight log

Stale in the 2026-11-20 text, corrected above: `main-dev` tip; "~168 behind" (was 124); PR #1595 "watch and
merge" (already merged); `046_config_dead_rows_prune` "unverified" (it exists); config `056` context (330
took `055`); `/sdd-distill` list (13 oversize contexts, not 5); missing `check-duplication.py` (present);
~80 worktrees (none).

Actions taken: allocator reserved 361/362; `main-dev` merged into all 20 `implementation-ready` branches
(17 clean; 314, 315 and 316 hit append-only ledger conflicts in `docs/roadmap/ledger/{insights,fails}.md`,
resolved as a union of both sides); 10 oversized `context.md` files sent through `/sdd-distill`.

Distill results (bytes before → after; limit 65,536): 309 72,335→48,792 · 311 361,096→62,591 · 312 66,392→45,274 ·
313 98,195→40,486 · 314 75,253→53,257 · 316 118,771→58,998 · 324 79,963→38,967 · 325 112,121→44,962 ·
327 73,936→50,614 · 328 74,753→52,484. Each file keeps exactly one `sdd-batch-design-state` fence (the last,
byte-identical to the original; checked by script on `origin`).

Caveats on the distills:
- **Self-verified.** The distill agents had no subagent tool, so the `context-distiller` plan and the
  adversarial verify were done by the same agent (script + manual read), not an independent pass. Rerun a
  real verify if you want one.
- **311 headroom is 2,945 bytes.** The next sessions pushed past 65,536 will need another `/sdd-distill`
  (the round-2..10 fences are gone; the 26 KB round-11 fence, the 2 recent sessions and 4 verbatim operator
  ruling sessions are the ~44 KB floor).
- **Stale `context.md:N` cites.** 311's and 316's `design.md`, `debate.md` and `implementation-spec.md` cite
  the old `context.md` line numbers. 316's spike session moved by a constant offset (new = old − 335; banner
  at the top of its `context.md`); 311's cited passages are the kept verbatim ruling sessions (marker at the
  top of its `context.md`). Those artifacts were not edited.
- **325:** its distilled header says P-1 was "declined by the operator"; the session log says "treated as
  declined" after "I accept the bound" (the `debate.md` row read "pending user"). Treat P-1 as unconfirmed
  (§ 3.1).

Verified unchanged: statuses, step counts, `MAX_ROUNDS = 5`, 326/329/330's merged PRs (#1592–#1594),
326's follow-ups were not previously filed.

## 9. Operator questions (drafted from § 3; each needs the answer quoted verbatim into the feature's `context.md`)

Drafted from this handoff's text, not from re-reading each `context.md`; read the feature's `context.md`
before asking. Per § 6, record the operator's exact answer in `context.md` before any gate relaunch.

| § 3 | Feature | Question | Needed before |
|---|---|---|---|
| 1 | 325 | Accept the write bound at staging scale (~188 newly warm symbols, ~595,584 headline writes/day; real statement volume 9–18% higher), or reopen petition P-1? | execute |
| 2 | — | Was the staging marketdata warm set (up to 396 symbols after the unrequested `list_opportunities` with `page_size` 1000) checked, or is a staging marketdata restart wanted? | 325 execute / 317 probes |
| 3a | 311 | Confirm or overturn D-50 (adoption-only accounts listed at the reconciler cadence, not every fill-poller tick). | Step 23 |
| 3b | 311 | How is portfolio stopped on each staging target (DO: drop the component from the app spec; homelab: compose stop)? Neither is verified from the repo. | cutover |
| 3c | 311 | Add a follow-up real-Postgres test job for trading? | execute |
| 4a | 313 | Confirm the spec-authored AC-1 `Then` wording. | Step 1 |
| 4b | 313 | Docs step or recorded deviation for the ingest docs that go stale after Steps 4 and 6? | execute |
| 5 | 316 | With the branch now synced, Step 1's `main-dev` merge no longer carries ~168 outside commits — confirm the residual (re-measure) is acceptable. | Step 1 |
| 6 | 324 | Step 9 marks the ruff defect report resolved with a commit ref; the archiver could prune it first. Keep, or reorder? | Step 9 |
| 7 | 331 | Reword AC-1's Given to "the agent process starts"? | execute |
| 8 | 320 | Run the regenerated probe script in the `xstockstrat-config` console on staging and paste the output. | Step 1 follow-on |
| 9 | 330 | Step-5 post-deploy read-back on staging. | close-out |
| 10 | 317 | Answer the four spec-time confirmations listed in its `context.md`. | execute |
| 11 | 321 | Proceed with `/sdd-execute` despite the impl-review warnings on Steps 9 and 10 (`context.md`, commit `6369dc10`)? | execute |

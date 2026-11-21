# Handoff — SDD batch for bug features 308–331 (2026-11-20)

Start-of-session reading for whoever continues this work. It records state, the operator's standing
rulings, what is waiting on the operator, and the traps hit so far. Per-feature decisions live in each
feature's `context.md` on its `feature/<slug>` branch — read that before touching a feature.

## 1. State

Authoritative source per feature: `origin/feature/<slug>` (slug = directory name without `NNN-`).
This branch (`ccr-aa8f70c6-to2txh`, PR #1595) carries a docs-only copy of those artifacts as of this date.

| State | Features |
|---|---|
| Merged to `main-dev` (`code-completed`) | 326 (PR #1593), 329 (PR #1594) |
| `in-progress`, waiting on the operator | 320 (vendor probe output), 330 (PR #1592 merged; step-5 post-deploy read-back) |
| `implementation-ready` (spec written, impl-spec review recorded) | 308, 309, 310, 311, 312, 313, 314, 315, 316, 317, 318, 319, 321, 322, 323, 324, 325, 327, 328, 331 |

Step counts: 308 17 · 309 18 · 310 8 · 311 27 · 312 20 · 313 7 · 314 9 · 315 6 · 316 8 · 318 13 ·
319 8 · 321 13 · 322 34 · 323 9 · 324 9 · 325 5 · 327 15 · 328 9 · 331 3 (317: see its spec).

No `implementation-ready` feature has started `/sdd-execute`. `main-dev` was at `fb52065c` all day; every
feature branch is about 168 commits behind it.

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
   script lived only in the session scratchpad and is gone with the container; regenerate it from 320's
   `context.md` and implementation spec (Step 1).
9. **330** — step-5 read-back after deploy.
10. **317** — four spec-time confirmations listed in its `context.md`.
11. **321** — proceed with `/sdd-execute` despite the impl-review warnings on Steps 9 and 10 (recorded in
    its `context.md`, commit `6369dc10`)?
12. **Housekeeping** — file 326's two follow-ups (`fix-trading-grpc-status-mapping`,
    `fix-portfolio-grpc-ctx-mapping`) through the allocator; a `merge-order.md` entry for config migration
    `056`, which 321, 317 and 314 all claim (first to merge keeps it); whether to watch and merge PR #1595.

## 4. Before executing anything

- Run `/sdd-status`, then read the feature's `context.md` and the `still open` notes from its impl-spec
  review. Those notes were read by the orchestrator only for 311, 313, 316, 321, 324, 325 and 331.
- **311** needs `/sdd-distill fix-position-fold-correctness` first: its `context.md` is far over the
  65,536-byte `/sdd-execute` limit. 316, 324, 325 and 326-style long contexts may need the same; check size.
- Every branch must merge `main-dev` first (each spec's BRANCH SYNC step). Until then the pre-commit hook
  prints a missing `scripts/check-duplication.py`; commits still pass. Never use `--no-verify`.
- Re-check migration numbers after the sync: portfolio `019` and trading `012` (311), config `056`
  (321/317/314), and whether 328 and 322's citation of `046_config_dead_rows_prune` is a reference or a new
  migration (unverified).
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
- About 80 worktrees sit under `.claude/worktrees/`; prune when no run is active.

## 7. 311 in one paragraph

Position-fold correctness (portfolio + trading), 27 steps, design approved after 11 rounds. Fill path: floor
check, autocommit duplicate pre-check, `positionsMu` before `BEGIN`, applied-row INSERT inside the fold
transaction, one `FOR UPDATE` read, pure fold. Account-scoped bracket-leg key and composite `GetPnL` dedup
key. Bracket legs tracked in a new `trading.bracket_legs` table, adopted forward-only from the broker's
open-order list, with a tombstone for candidates a complete list shows not open. Cutover is stop-then-start
on staging as a recorded runbook step; no write fence. Amended `@AC-5` is signed off. Operator rulings are
quoted verbatim in the sessions titled "recorded by the orchestrator (verbatim)" in its `context.md`.

> Distilled 2026-11-15 by /sdd-distill. Full pre-distill session prose is in git history (before this commit).

# Context: backtest-inline-backfill

**Feature**: `docs/roadmap/features/343-backtest-inline-backfill/feature.md`
**Product Spec**: `docs/roadmap/features/343-backtest-inline-backfill/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/343-backtest-inline-backfill/implementation-spec.md`

---

## Decisions

Binding register: `debate.md` (State `approved`; D-1…D-28 settled, D-5 superseded by D-8 and D-21 by D-22; R-1…R-15 locked; O-1…O-31 closed, O-32 and O-33 still `open`; P-1 and P-2 `user reopened`). Chosen approach: `design.md` § Chosen Approach. Steps and § Assumptions made at /sdd-spec (1–12): `implementation-spec.md`. The lines below are what those files do not carry, plus a one-line index.

**Operator rulings (all 2026-11-15; quotes are verbatim)**

- sdd-story: backfill the **missing range only**; after completion show a **re-run action** (no automatic re-run); **try to open the action to everyone**; if that requires a lot of changes, **replace the section with strategy scores only, default "not enough data", no actions at all**. Interpretation (the story author's, not operator words): "Yes to the rerun action" answered a recommendation of inline progress + a "data ready, re-run" state over automatic re-run and was read as accepting that; "the section" in the fallback was read as the Backtests card on the symbol page.
- Recorded verbatim at sdd-review product-spec:

  OPERATOR DECISIONS (binding, recorded 2026-11-15):
  - Backfill only the missing range reported by the backtest, not full history.
  - After the backfill completes show a re-run action; do not re-run automatically.
  - Try to open the backfill action to every authenticated user. If that requires a lot of changes, replace the section with strategy scores only, defaulting to 'not enough data' with no actions at all.
  - The operator set the fallback but not the threshold for 'a lot of changes': the design must present the cost of opening the trigger to non-admins at the design gate rather than choose silently.

- Design gate, applied in round 3: tier **T1** chosen and the FR-7 fallback declined; the request range is widened (G-2 → D-8, amends FR-2/@AC-2 and the first decision above); the insights strategy button is opened to non-admins (G-3 → D-10); the request-count exposure is accepted and answered by raising `backfill.max_concurrent_jobs`, not by a per-user cap.
- Design gate, applied in round 4: concurrency option **B**; the insights Backfills create form stays admin-only; the lock-breach counter belongs to feature 341; 200 bars on DigitalOcean and 1000 bars on the homelab; config values are read over the MCP (relayed item 5, "Use the mcp to read the values"); the lowest-friction handling on ALREADY_EXISTS.
- Relayed with round 5: "1. Approved", "2. Confirmed", "3. Sign-off the change, amend it", "4. There are no production instances. Staging is enough." Only item 4 was applied as a decision (D-24, homelab config steps target staging only); the questions items 1–3 answer were not in that step's input, so none was mapped to a register row.
- Design gate approval (round 5), verbatim "Agreed": the round-5 design is approved, including the petitioned D-21 reopen. The lock-setting raise step becomes a read-only check, and the computed inequality is the stop (this answers O-32: only a failed lock inequality stops the homelab rollout).
- Relayed with the sdd-design / sdd-spec / impl-review runs: "1. Agreed", "2. Ok, agreed.", "3. I plan to do psql over ssh if possible.", "4. Confirmed", "5. Yes, fix the primitives. Use the switch component from Shadcn.", "6. Sounds good". The questions were not in those steps' input and the batch covers four features, so items 1, 2, 4 and 6 are mapped to nothing; item 3 is read as the access route for the runbook's Postgres read (spec Assumption 2); item 5 is not about this feature.
- Relayed in round 3 and left unmapped: item 6 "Accept it, option A" (not assumed to answer the concurrency option, because the request numbers answers across six features; the operator later chose option B), item 7 "update all pages" and item 9 "Expand the fetches. Add a metric…" (answered in round 4 by D-15/D-16: `insights/backfills/page.tsx` stays admin-only, the counter is feature 341's), item 10 (per-row and clear-all buttons; read as another feature's).
- Execute directives ("Use MCP tools if possible in 341 and 343.", "max_locks_per_transaction assume what homelab-edge has", "max_connections are now love."): kept verbatim in the last session below. They supersede Step 16's `SHOW max_locks_per_transaction` read and the "PR #79 merged but not applied" precondition.

**Design (index; text is in `design.md` / `debate.md`)**

- FR-6, not FR-7: a tier-T1 self-serve envelope on ingest `TriggerBackfill` with eight conditions (D-11) and first-failed-condition denial tokens (D-18, D-25); admin behaviour unchanged; no proto change, no ingest schema migration.
- Self-serve-only per-symbol de-dup in one transaction under `pg_advisory_xact_lock`, ALREADY_EXISTS without the other job's id (D-9, D-19, R-4); card copy "A backfill for {symbol} is already queued or running. Try again when it finishes.", button stays enabled, no link or polling (D-20, D-27).
- Symbol card requests `gap.start` through the backtest window end under GAPS_ONLY (D-8), keeps its own `jobId` in local state, manual re-run only (D-2), "No vendor data for {range}" on a same-gap second insufficient result (D-7), two PARTIAL copy branches (D-12).
- Insights strategy button opened to non-admins with the exact gap; non-admins send GAPS_ONLY, admins keep FULL (D-10, R-5). `insights/backfills/page.tsx` stays admin-only and unchanged (D-15). No lock-breach counter here; the merge waits on feature 341 (D-16).
- New key `ingest` / `backfill.self_serve_max_range_days`, default and seed 730 (D-17); `backfill.max_concurrent_jobs` keeps default and seed 3 (D-14, option B). Homelab staging only is set to 8 jobs and 1830 days by a runbook subsection in `docs/runbooks/config-rollout.md` after a lock-inequality check (D-22, D-23, D-24, D-26). No lock-parameter raise in this feature; nothing in homelab-edge is edited.
- Rejected (R-1…R-15), chiefly: deleting the gate outright, automatic re-run, the FR-7 fallback, any lock-parameter raise in this feature.
- Constitution rules touched: C-05, C-08, C-10, C-11, C-12, C-13, C-14, C-15, C-16, C-18, F-07, P-02, P-03, P-06, PLAT-4, PLAT-N1. Floor breaches: none in any round. Adversary verdicts: NEEDS WORK (rounds 3, 4), SOUND (round 5).

**Process decisions and deviations (only recorded here)**

- @AC-7 and @AC-8 were mutually exclusive; the losing scenario is struck, not renumbered. At /sdd-spec @AC-8 was commented out with its ID reserved, @AC-2 amended (D-8), @AC-9 examples rewritten (D-12), @AC-10…@AC-16 appended.
- sdd-review product-spec (PASS WITH WARNINGS, 8 warnings, no fails) resolved in-session: @AC-9 added as a Scenario Outline (PARTIAL and CANCELED) on the FR-6 branch; FR-5 now reads "with the job's error when one is reported" (a canceled job may carry none); the C-14 Agent box left unchecked with the reason stated (ticked at /sdd-spec); a per-user backfill limit key, if added, carries the full config-key contract (C-05, F-07); the persona named ("the trader"). @AC-2 and @AC-5 assert a request rather than what the card shows and were left as written on purpose (the range is the point of FR-2).
- The ingest `TriggerBackfill` admin gate was added deliberately in feature 092 to protect vendor quota (`services/xstockstrat-ingest/tests/test_ingest_servicer.py:362-384`); opening it is the quota exposure the tier decision costs.
- sdd-design `debate.md` edits: State `in-debate` → `approved`; P-1 and P-2 `pending user` → `user reopened`; no row added or reworded. Deviation from the batch step's wording, which said to mark pending petitions `user declined`: both reopens were accepted by the operator (P-1 by the round-3 widening decision, D-8; P-2 by the round-5 approval, D-22), so `user declined` would misstate the record. During rounds 4 and 5 the P-1 cell was left `pending user` because those rounds gave no verdict row for it.
- O-32 and O-33 keep status `open` in `debate.md` because the step supplied no status line for them; O-32 is answered by the round-5 approval (above), O-33 is not (see Open Threads).
- No ledger line was written in any session: the token drift trap is already in `fails.md` (lines 308 and 1516, cited by D-25) and /sdd-spec surfaced no new pattern or trap.
- /sdd-spec: 16 steps; atomic units are Steps 2+3+4 (config key: seed, reader and tests), 5+6 (ingest gate), 10+11 (UI helper), 12+13 (card and e2e), each on one surface. The drift guard is one JSON file read by three test suites (ingest, UI vitest, agent parity) at `services/xstockstrat-ingest/tests/fixtures/self_serve_denial.json`.
- /sdd-spec discovery ran on `feature/backtest-inline-backfill@42f5e7b2e`; `origin/main-dev@d1c97273b` was 4 commits ahead and not merged (none changes a cited code file); `/sdd-execute` BRANCH SYNC merges it.
- /sdd-spec findings that correct the design record: `backfill_jobs.has_active_job` does not exist (`debate.md` D-9 cites `backfill_jobs.py:111`, which is the `= ANY(symbols)` predicate in `list_jobs`); Step 5 creates it, and `insert_job` only calls `db_pool.execute`, so a connection can be passed with no signature change. `make_servicer` (`tests/test_ingest_servicer.py:34-62`) builds `cfg` as a `MagicMock`, so the new config attribute must be set as a real int there, and a new `int_positive` read turns `tests/test_config_read_classification.py` red until the key is in `FR3_KEYS`.
- /sdd-spec findings that close design-time unknowns: `bars_total` is written when the chunk plan is made (ingest `servicer.py:715-716`), so a QUEUED job has none (the zero-denominator case, @AC-14); the PARTIAL and all-chunks-failed FAILED terminal writes carry no `error` (`:739-752`), hence chunk-count copy (@AC-9, @AC-16). The e2e sentinel `strat-insufficient-001` returns a gap equal to the requested window and no `timeframe` or `requestedRange` (`e2e/mock-backend.ts:1073-1097`); Step 13 fixes it with `prefixGapRange`; no `getBackfillStatus` mock exists. The BFF `forward` rethrows the backend `ConnectError` unchanged (`src/lib/bffShared.ts:77-91`) and the agent passes both codes through (`app/tools.py:225-236`), so the denial detail and `ALREADY_EXISTS` reach the caller. Marketdata pool metrics are `marketdata.db.pool.empty_acquire_count` and `marketdata.db.pool.empty_acquire_wait` (`internal/telemetry/otel.go:478-479`); feature 341's counter is `marketdata.ohlcv.out_of_memory_errors` (on its branch only).
- The batch task text named the directory with a doubled path (`docs/roadmap/features/docs/roadmap/features/343-…`); it was read as this directory.
- Homelab values read over the MCP on 2026-11-15 (round-4 synthesis): ingest `backfill.max_concurrent_jobs` 3, `backfill.max_concurrent_chunks` 3, `backfill.chunk_window_days` 90; analysis `readiness_materializer.max_concurrent_bars_fetches` 2, `opportunity.max_concurrent_bars_fetches` 2, `opportunity.max_concurrent_candidates` 4, `backtest.portfolio_max_concurrent` 9, `strategy.max_concurrent_entry_backfill` 4, `backtest.max_range_days` 730.
- Accepted risks (operator or design, no step): one user can queue one in-envelope job per symbol and fill every slot; an admin multi-symbol job blocks self-serve for its symbols for its whole duration (D-20); `jobId`, "Data ready" and the last-filled gap are local state and are lost on reload (D-2); a strategy whose warmup prefix exceeds the span cap is denied self-serve backfill; a refused trigger is also reported by the global mutation-error fallback because `useTriggerBackfill` has no `meta.errorHandled` (left as is, spec Assumption 10).

## Open Threads

- [ ] O-33: the `343@AC-9` rewrite was made on the strength of the round-5 design approval; no operator decision names the scenario on its own, and none of the relayed numbered answers was read as this sign-off — operator, `/sdd-execute` checkpoint.
- [x] Step 7 edits the durable suite `docs/sdd/business-rules/platform.feature` (an Examples row on `244@AC-6`) before launch, where C-16 normally promotes at launch; accepted by the operator ("Expand it", read as EXTEND) and landed in Step 7.
- [ ] The feature 343 registered-keys entry in `docs/patterns/config-governance.md` points at `docs/runbooks/config-rollout.md` for the homelab `backfill.max_concurrent_jobs` = 8; that subsection is written by Step 16.
- [ ] Step 8 touches 6 files (code, two docs, two `strat-lab` skill files) and stays one step unless the operator wants code and docs split (`docs/patterns/strat-lab-plugin.md` requires the skill change in the same PR; Step 9's parity test reads all of them) — `/sdd-execute` checkpoint.
- [ ] Config migration number `050` is also held by 341 (`050_ui_chart_history_bars`) and 330 (`050_analysis_live_enrich_ttl_reseed`) on their branches (trunk tip is `049`); 343 merges after 341 and renumbers — re-derive at Step 2 and at the integration PR.
- [x] Step 2 regenerated `scripts/config-wiring-stored.json` against the operator-provided scratch Postgres (Option B). A renumber at the integration PR means regenerating it again.
- [x] `docs/roadmap/features/merge-order.md` 343 → 341 row exists (`:127`, #1545); Step 1 added 343's remaining shared files to the cohort section. The integration PR still waits for 341.
- [ ] Peer file overlap, rebase-only: `trader/positions/[symbol]/page.tsx` (339, 341); `e2e/trader/position-detail.spec.ts` (asserts /Backfill coverage panel/ at `:337`), `insights/strategies/[id]/page.tsx`, `e2e/insights/backtest-coverage.spec.ts` (341; this last pair is not in the spec's peer-overlap list); ingest `servicer.py`, `tests/test_ingest_servicer.py`, `e2e/mock-backend.ts`, `e2e/fixtures/INVENTORY.md` (344); `docs/patterns/config-governance.md`, `docs/runbooks/config-rollout.md` (append order) — integration PR.
- [ ] Runbook (Step 16) reads after the operator directives: `max_locks_per_transaction` = 1024 and `max_connections` = 70 are taken from `homelab-edge` (the second on the orchestrator's reading of "now love" as "live", not verified against the host); whether `max_prepared_transactions` still needs its specified read (psql over ssh, DB-owner DSN as fallback) is not ruled — `/sdd-execute` checkpoint, Step 16.
- [ ] The S ≤ 2 lock bound fails if marketdata gets `DB_POOL_MAX` or more replicas; confirm one replica with `DB_POOL_MAX` unset — runbook step 2 (Step 16).
- [ ] Admin GAPS_ONLY ranges are uncapped, so `L_stmt_max` is the longest admin range the operator accepts — runbook step 3 (Step 16).
- [ ] Pre-004 one-day ohlcv chunks would raise L for old ranges; the homelab is asserted to be a fresh deploy, not verified — runbook step 2 (Step 16).
- [ ] Eight jobs move contention onto marketdata's 2 connections and can slow interactive `GetBars` — runbook step 5 (Step 16).
- [ ] A rebuilt homelab database reverts to 3 and 730 until the checklist is re-run — runbook checklist line (Step 16).
- [ ] Whether a `strat-lab` skill text change needs a `plugin.json` version bump: no rule found; the spec assumes none (Assumption 11) — Step 8.
- [ ] `xstockstrat-ingest` is shared with `344-alert-detail-page` (backfill-failure alert body vs `TriggerBackfill` authorization) — re-check at the integration PR.

## Files Modified

Outside the feature directory:

- `docs/roadmap/features/merge-order.md` — Step 1: one sentence in the "Symbol-page cohort: 339-344" section.
- `services/xstockstrat-config/migrations/050_ingest_backfill_self_serve_keys.{up,down}.sql`, `scripts/config-wiring-stored.json` — Step 2 (seed and regenerated stored set).
- `services/xstockstrat-ingest/app/config/watcher.py` — Step 3 (`backfill_self_serve_max_range_days`).
- `services/xstockstrat-ingest/tests/test_config_watcher.py`, `tests/test_config_read_classification.py` — Step 4.
- `services/xstockstrat-ingest/app/handlers/servicer.py`, `app/repositories/backfill_jobs.py` — Step 5 (envelope, denial tokens, `_insert_self_serve_job`, `has_active_job`).
- `services/xstockstrat-ingest/tests/fixtures/self_serve_denial.json`, `tests/conftest.py`, `tests/test_ingest_servicer.py`, `tests/test_backfill_jobs.py` — Step 6.
- `services/xstockstrat-ingest/CLAUDE.md`, `services/xstockstrat-ingest/docs/context-constitution-findings.md`, `docs/patterns/config-governance.md`, `docs/sdd/business-rules/platform.feature` — Step 7 (gate wording, key row, registered-keys entry, `244@AC-6` row).
- `services/xstockstrat-agent/app/tools.py`, `app/client.py`, `services/xstockstrat-agent/CLAUDE.md`, `docs/runbooks/mcp-tools.md`, `plugins/strat-lab/skills/backtest/SKILL.md`, `plugins/strat-lab/skills/backtest/reference/backfill.md` — Step 8 (self-serve envelope wording for `trigger_backfill`).

Feature-directory artifacts:

- `docs/roadmap/features/343-backtest-inline-backfill/feature.md` — created at sdd-story; Summary restated to the D-8 range and Reviewers snapshot gained agent, config and DBA at sdd-spec.
- `docs/roadmap/features/343-backtest-inline-backfill/product-spec.md` — created at sdd-story; review fixes (FR-5 wording, Agent box reason, config-key contract line, persona); at sdd-spec FR-2 amended, FR-7 marked not taken, Agent and insights surfaces ticked, new config key recorded, `xstockstrat-config` and `xstockstrat-agent` added to Affected Services.
- `docs/roadmap/features/343-backtest-inline-backfill/acceptance.feature` — created at sdd-story; @AC-9 added at review; at sdd-spec @AC-2 amended, @AC-9 examples rewritten, @AC-8 struck (ID reserved), @AC-10…@AC-16 appended.
- `docs/roadmap/features/343-backtest-inline-backfill/recon.md`, `design.md` — written at sdd-design.
- `docs/roadmap/features/343-backtest-inline-backfill/debate.md` — register through round 5; State → `approved`, P-1/P-2 → `user reopened` at sdd-design.
- `docs/roadmap/features/343-backtest-inline-backfill/implementation-spec.md` — 16 steps at sdd-spec; edited at sdd-review impl-spec (Step 11 `test:coverage` verification, Step 9 agent CI filter, Step 5 Instruction 7, the `config-wiring.test.mjs` claim corrected).
- `docs/roadmap/features/343-backtest-inline-backfill/status.md` — draft → spec-ready → design-approved → implementation-ready.

## Superseded Sessions

- 2026-11-15 — sdd-story: created feature.md (draft), product-spec.md, acceptance.feature, context.md from an operator report (staging, homelab, with screenshots) and same-day read-only recon; operator decisions and their interpretation are in the header.
  Recon facts: `page.tsx:1226-1240` (insufficient-data callout), `:1405-1415` (panel trigger: no range, BARS, 1Day, admin-only UI), `hooks/useBacktest.ts:19-23` (`useTriggerBackfill`), `insightsBff.ts:86-88` (BFF `forward`, no admin gate), ingest `servicer.py:417-425` (`admin scope required`), analysis `servicer.py:1578` (gap = prefix start → window start).
- 2026-11-15 — sdd-review product-spec: approved, draft → spec-ready (PASS WITH WARNINGS, 8 warnings; fixes in the header); recommended design depth full (2 affected services; warning-level overlap). Carried to design and since settled: FR-6 vs FR-7 is the operator's pick at the gate (C-11); "No proto changes" unchecked pending a named FR-7 score source; `coverage_gaps` exists at `packages/proto/analysis/v1/analysis.proto:136`.
  Overlap (WARN, file-level, no config/proto/migration collision; peers 339–342 and 344 all `draft` then): `page.tsx` with 339 (Research tab Fundamentals card vs Analysis → Backtests card, disjoint regions, second merger rebases); ingest with 344; `xstockstrat-ui` with 341, 342, 344 (different surfaces). `merge-order.md` rows for 052/053/054 cover `ingest.backfill_jobs` and `BackfillJob` field numbers; this feature adds no proto field and no ingest migration.
- 2026-11-15 — sdd-batch design gate (round 2): full debate halted at its approval gate (policy: halt); `design.md` not written, status unchanged. Register then: D-1…D-7 settled, R-1…R-3 locked, O-1…O-9 closed, O-10…O-18 open. Round-2 best was tier T1 with the card requesting exactly the reported `gap` (D-5, later superseded by D-8); gate questions were the tier (T0 / T1 recommended / T1+ / T1-L / T2 / FR-7; T1+ and T1-L uncosted, O-17), G-2 (widen the range) and G-3 (insights button to GAPS_ONLY).
  Strongest objection O-12 (blocking, C-15/C-14): switching the insights button (`insights/strategies/[id]/page.tsx:541-547`) to GAPS_ONLY was an unsanctioned change with no @AC; the synthesis kept it FULL through a shared `gapToBackfillRequest(gap, {fillMode})`. Also blocking: O-10 (no `user_id` in the `ingest.backfill.queued` payload; ledger already stamps the owner from `x-user-id` metadata; add a metadata test), O-11 (PARTIAL occurs with zero failed chunks at `servicer.py:739-740`, so two copy branches).
  Risks then: request-count flooding under T1 (global `backfill.max_concurrent_jobs`, default 3, the only bound); a definition-path re-run can return OK with zero trades unless G-2 is sanctioned; the 730 default is coupled to analysis `backtest.max_range_days` by documentation only. The relayed Q2/Q3 of that batch concerned the alert page and the batch kickoff and reopened nothing here. Resume block (superseded by round 3's):
_(Superseded `sdd-batch-design-state` block for this round dropped by /sdd-distill under operator sanction, 2026-11-15; it is in git history before the distill commit.)_
- 2026-11-15 — sdd-batch design gate (round 3): halted after round 3; status unchanged. Register then: D-8…D-13 settled, D-5 reopened by operator steer and superseded by D-8, R-4…R-6 locked, O-10…O-18 closed, O-19…O-25 open, P-1 on D-5 pending user. Operator rulings (header) added de-dup (D-9), the widened range (D-8), the opened insights button (D-10), two PARTIAL branches (D-12) and the concurrency raise (D-13: option A a new seeded default of 6 everywhere; option B keep 3 and set 8 on the homelab through `SetConfig`).
  Strongest objection O-19 (blocking, C-11/P-03): the lock-budget arithmetic used the DigitalOcean figure (1024 × 25 = 25,600, `docs/runbooks/ohlcv-lock-budget-tuning.md:59-63`) while option B targets the homelab, where nothing under `deploy/` sets `max_locks_per_transaction` or `max_connections` (possibly the stock 64 per connection); the invariant must count all concurrent bars scans and use 30-day chunks. Also blocking: O-20 (the requested lock-breach metric not designed; no service handles SQLSTATE 53200), O-21 (`insights/backfills/page.tsx` unchanged against "update all pages").
  Non-blocking: O-22 (the 1096 span-cap default was justified by the wrong coupling; the gap length comes from the strategy warmup, not `backtest.max_range_days`), O-23 (one denial message misreports seven of eight conditions), O-24 (de-dup transaction vs `insert_job` taking a pool; emit-after-commit), O-25 (admin multi-symbol job blocks self-serve; no job to follow on ALREADY_EXISTS). Resume block (supersedes round 2's):
_(Superseded `sdd-batch-design-state` block for this round dropped by /sdd-distill under operator sanction, 2026-11-15; it is in git history before the distill commit.)_
- 2026-11-15 — sdd-batch design gate (round 4): halted after round 4; status unchanged. Register then: D-14…D-21 settled, R-7…R-11 locked, O-20…O-25 closed, O-19 still open, O-26…O-31 open. Operator answers (header) fixed option B (D-14), denial tokens (D-18), the one-connection de-dup transaction with emit and spawn after commit (D-19), the ALREADY_EXISTS copy (D-20), span cap 730 with span = `prefix_calendar_days(max warmup bars)` + the 366-day card window (666 days at 200 bars, 1825 at 1000 bars → homelab 1830, D-17), and scope (D-15, D-16).
  D-21's runbook then included raising `max_locks_per_transaction` to 1024 and restarting Postgres before setting 8; superseded in round 5 by D-22 (read-only check). O-19 narrowed: the proposal's worked lock example used S = 25 where backfill alone is 24 and applied L = 248 to every scanner class; the corrected per-class sum was about 6,584 (384 backfill writes + 4,216 full-span readers + 1,984 gap-planning scans), above a stock 64 × 100 = 6,400.
  Also blocking then: O-26 (C-11; config inputs and the write/read-back go over the homelab MCP, only the three Postgres `SHOW` parameters need the DB-owner DSN). Non-blocking: O-27 (untyped token wire contract), O-28 (wording), O-29 (provisioning checklist with the reverted symptom), O-30 (no de-dup assertion across admin and self-serve), O-31 (whether the 1000-bar homelab requirement is this feature's, and whether `backtest.max_range_days` = 730 caps a 1000-bar warmup prefix). Resume block:
_(Superseded `sdd-batch-design-state` block for this round dropped by /sdd-distill under operator sanction, 2026-11-15; it is in git history before the distill commit.)_
- 2026-11-15 — sdd-batch design gate (round 5): halted after round 5; status unchanged. Register then: D-22…D-28 settled, R-12…R-15 locked, O-19 and O-26…O-31 closed, O-32 and O-33 open, P-2 pending user, D-21 superseded by D-22. Lock budget (D-23): capacity is cluster-wide, `max_locks_per_transaction × (max_connections + max_prepared_transactions)` = 1024 × (70 + 0) = 71,680 once homelab-edge PR #79 is applied; the binding bound is `marketdata connections × replicas × L_stmt_max × databases` with marketdata's pool capped at 2 (`pool.go:14,23`; `DB_POOL_MAX` forbidden on pooled homelab services, `render-assert.jq:49`); L = (⌈span ÷ 30⌉ + 1) × 4, largest statement the analysis bar fetch (2,555 days, L = 348, bound 1,392) or an uncapped admin GAPS_ONLY scan (L = 1,000 → 4,000); the unbounded per-class sum is 6,200 per database.
  Runbook (D-22, D-24, D-26): a homelab subsection in `docs/runbooks/config-rollout.md` next to `:293-297`, staging only: `get_config` reads, read-only `SHOW` of the three parameters (expected 1024, 70, 0), compute the inequality and stop only if it fails (a mismatch is reported as "PR #79 not applied"), `set_config` 8 and 1830 with read-back, watch 341's 53200 counter and marketdata pool-wait for one readiness cycle; reverted symptom is the "limit of 730 days" denial on a 1000-bar warmup and at most 3 jobs running. Later narrowed by the execute directives (last session below).
  Other closes: D-25 (one frozen 8-token tuple and `_self_serve_denial_detail(token, max_days=None)` next to `_has_admin_scope`, `servicer.py:357`; literals in `src/lib/backtestBackfill.ts`; one shared JSON fixture), D-27/D-28 (de-dup asserted only between two self-serve requests, the admin row asserts QUEUED only; this feature owns 1830 because it owns the key; analysis `backtest.max_range_days` is checked against `request.range` only, `servicer.py:928-935`, and does not cap the warmup prefix). O-32 had two safe readings of "runbook precondition" (resolved by the approval, header); O-33 open (header). Resume block:
```sdd-batch-design-state
{
  "round": 5,
  "synth": {
    "approach": "Round 5 best approach: the round-4 design stands in shape (tier T1 envelope with first-failed-condition tokens, self-serve de-dup in one transaction, widened symbol-card range, insights strategy button opened, span cap default and seed 730, concurrency option B). This round changes only the lock-budget statement, the homelab runbook, the token drift guard and three small copy, test and scope points. I checked the adversary's code claims in the working tree and they hold.\n\n**Lock budget (O-19)**\n- Capacity is cluster-wide: `max_locks_per_transaction × (max_connections + max_prepared_transactions)` = 1024 × (70 + 0) = 71,680 once homelab-edge PR #79 is applied.\n- Gap planning does scan the full requested span.\n  - Under GAPS_ONLY, `_plan_work_ranges` passes `request.range` unchanged to marketdata `GetDataCoverage` (`services/xstockstrat-ingest/app/handlers/servicer.py:654-661`).\n  - That runs one `SELECT MIN, MAX, COUNT … WHERE time >= $3 AND time <= $4` (`services/xstockstrat-marketdata/internal/repository/marketdata_repo.go:228-232`).\n  - It runs once per job, before the job's chunks are planned and written (`servicer.py:683`), so planning and chunk writes of one job never overlap.\n- Binding concurrency bound: only marketdata queries `marketdata.ohlcv`, and its pool is capped at 2 connections (`services/xstockstrat-marketdata/internal/repository/pool.go:14,23`). `DB_POOL_MAX` is forbidden on pooled homelab services (`deploy/homelab/render-assert.jq:49`). So S ≤ 2 × marketdata replicas per database.\n- Backstop bound: PgBouncer `pool_size` = 10 per database (operator value). It applies only if the marketdata pool is ever raised.\n- Per-statement L = (⌈span ÷ 30⌉ + 1) × 4. The self-serve cap (1830 days, L = 248) is not the largest statement:\n  - Analysis bar fetch on the homelab: 730-day window plus up to 1825 days of prefix = 2,555 days, L = 348.\n  - Admin GAPS_ONLY coverage scans have no range cap at ingest.\n- Stated bound: `marketdata conns × replicas × L_stmt_max × databases`. At L = 348: 2 × 348 × 2 = 1,392. At L = 1,000: 4,000. Both fit 71,680, and both also fit the pre-PR-#79 budget (64 × 60 = 3,840 only at the L = 348 figure).\n- Unbounded per-class sum, for reference: 17 full-span readers × 248 + 8 jobs × max(248, 3 × 16) = 6,200 per database.\n- No lock-parameter raise is part of this feature.\n\n**Homelab runbook (O-26, O-29)** — new homelab subsection in `docs/runbooks/config-rollout.md`, next to `:293-297`. Config steps target the homelab staging environment only (user: no production instance exists).\n1. Over the homelab staging MCP, `get_config` for ingest `backfill.max_concurrent_jobs`, `backfill.max_concurrent_chunks`, `backfill.chunk_window_days` and the six analysis keys from round 4.\n2. Read-only against the live host over the DB-owner DSN (`docs/runbooks/operator-db-access.md`): `SHOW max_locks_per_transaction`, `SHOW max_connections`, `SHOW max_prepared_transactions`. Expected after PR #79: 1024, 70, 0. Record what is read.\n   - No PgBouncer `SHOW DATABASES`: no access route is named, and `pool_size` is not the binding bound. Cite the operator value 10.\n   - Confirm marketdata runs one replica with `DB_POOL_MAX` unset (`deploy/homelab/compose.yml:128`, `render-assert.jq:49`).\n3. Compute `marketdata conns × replicas × L_stmt_max × databases ≤ mlpt × (mc + mpt)` from the values just read, with L_stmt_max from the longest admin range the operator accepts. Stop if it fails. A value that differs from the expected ones is reported as \"PR #79 not applied\" and does not stop the rollout while the inequality holds.\n4. Over the homelab staging MCP: `set_config ingest backfill.max_concurrent_jobs=8` and `set_config ingest backfill.self_serve_max_range_days=1830`, then `get_config` to read both back.\n5. For one readiness cycle, watch feature 341's 53200 counter and marketdata's `marketdata.db.pool.empty_acquire_wait` and acquired-equals-max (24 chunk writes now contend for 2 connections with interactive `GetBars`).\n- Provisioning-checklist lines in the same subsection:\n  - Re-run step 4 after a database rebuild.\n  - Apply the same two values per environment when a homelab production app is first deployed.\n  - Reverted symptom: the span-denial copy (\"limit of 730 days\") appears on a 1000-bar warmup, and at most 3 jobs run while others stay QUEUED.\n- This feature edits nothing in homelab-edge.\n\n**Denial tokens (O-27)**\n- Ingest: one frozen tuple of the 8 tokens next to `_has_admin_scope` (`servicer.py:357`) and one formatter `_self_serve_denial_detail(token, max_days=None)`.\n- UI: `src/lib/backtestBackfill.ts` holds the prefix and token literals. `triggerErrorMessage` maps `range_too_long` to the span copy and every other or unknown token to the generic copy. No raw token reaches a trader.\n- Drift guard: one checked-in JSON fixture listing the 8 tokens and the detail format, loaded by both the ingest table test and the UI vitest. Its path is chosen at /sdd-spec under the C-13 fixture homes. Two independently pinned literal sets are not adopted, because each test would only check its own side.\n\n**Copy, tests, scope (O-28, O-30, O-31)**\n- ALREADY_EXISTS copy: \"A backfill for {symbol} is already queued or running. Try again when it finishes.\" Same wording in the @AC and its vitest case.\n- De-dup is asserted only between two self-serve requests (a duplicate row and a race row). The admin row asserts QUEUED only. No row pairs an admin job with a self-serve job.\n- This feature owns the homelab value 1830 because it owns the key. Producing 1000-bar warmups is not this feature's work.\n- Analysis `backtest.max_range_days` is checked against `request.range` only (`services/xstockstrat-analysis/app/handlers/servicer.py:928-935`), so it does not cap the warmup prefix.\n\n**Unchanged from round 4**\n- Ingest gate, predicate, de-dup transaction, admin path, no proto change, no ingest schema migration.\n- Config seed migration `050_ingest_backfill_self_serve_keys` (number re-checked at /sdd-spec).\n- UI card, insights strategy button, PARTIAL copy, D-7 memory.\n- Dependency on feature 341 with a merge-order row.\n- Docs list (agent `tools.py`, `mcp-tools.md`, strat-lab reference, key tables, `platform.feature` row).",
    "open_objections": [
      {
        "text": "Stop condition for the homelab rollout: the synthesis makes the computed lock inequality the hard stop and treats a mismatch with the PR #79 values (1024 / 70 / 0) as a reported finding. The operator steer says the Postgres parameters are \"verified … as a runbook precondition\", which can also be read as \"stop until PR #79 is applied\". Confirm the reading at the design gate; both are safe.",
        "blocking": false
      },
      {
        "text": "343@AC-9 is still a CHANGE with no operator decision that names it. Relayed item 3 (\"Sign-off the change, amend it\") may be that sign-off or may refer to amending D-21; the question numbering is not in this step's input. Confirm at the gate.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "343@AC-1",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "343@AC-2",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "343@AC-3",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "343@AC-4",
        "kind": "PRESERVE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "343@AC-5",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "343@AC-6",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "343@AC-7",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "343@AC-8",
        "kind": "PRESERVE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "343@AC-9",
        "kind": "CHANGE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "270@AC-4",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "244@AC-6",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "244@AC-5",
        "kind": "PRESERVE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "198@AC-7",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "198@AC-6",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "334@AC-1",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "334@AC-26",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "Raising the homelab `max_locks_per_transaction` as a step of this feature: the operator's homelab-edge PR #79 already sets 1024, and the corrected bound fits without it.",
      "Bounding lock use by PgBouncer `pool_size × L_max` as the primary bound: marketdata's 2-connection pool is tighter and code-enforced; the PgBouncer bound stays as a backstop only.",
      "Using L = 248 (the self-serve span cap) as the largest statement: analysis fetches reach 348 and admin coverage scans are uncapped.",
      "A PgBouncer `SHOW DATABASES` read in the runbook: it needs an admin or stats login the design does not name, and the value is not binding.",
      "A hard stop on `max_locks_per_transaction < 1024`: it ties the rollout to another repo's apply when the computed inequality already passes on the stock value.",
      "Two independently pinned token literal sets (ingest test and UI vitest) as the drift guard: each test checks only its own side, so a rename on one side passes CI.",
      "A token list generated from a single file into both languages: more mechanism than one UI consumer needs; a shared test fixture gives the same guard without codegen.",
      "Recording the token set only as a constitution contract entry: it documents the coupling but does not fail CI on drift.",
      "Editing homelab-edge's `deploy-compose-app.md` for the checklist: that is the owner's repo; the checklist lives in this repo's `config-rollout.md`.",
      "Applying the two homelab values to the homelab production environment now: no production instance exists; a checklist line covers the day it is deployed."
    ],
    "open_risks": [
      "Homelab-edge PR #79 is merged but not applied. The live Postgres values are unread until runbook step 2.",
      "The S ≤ 2 bound fails if marketdata gets `DB_POOL_MAX` or more replicas; the runbook re-checks both.",
      "Admin GAPS_ONLY ranges are uncapped, so L_stmt_max is whatever admin range the operator accepts.",
      "Pre-004 one-day ohlcv chunks would raise L for old ranges; the homelab is asserted to be a fresh deploy, not verified.",
      "Raising to 8 jobs moves contention onto marketdata's 2 connections and can slow interactive `GetBars`; step 5 watches the pool metrics.",
      "The marketdata pool metric names come from the adversary's citation of the marketdata CLAUDE.md; I did not open that file.",
      "Feature 341's 53200 counter lives on its branch; this feature's merge waits on it.",
      "A rebuilt homelab database reverts to 3 and 730 until the checklist is re-run.",
      "The shared token fixture is read across two service trees; its home and loading path are set at /sdd-spec.",
      "Config migration number 050 may collide with a peer feature; re-check at /sdd-spec.",
      "Peer features 339 (same `page.tsx`), 341 and 344 (ingest) can conflict at merge; re-run the C-16 scan at /sdd-spec.",
      "One user can still queue one in-envelope job per symbol and fill every slot (accepted by the operator).",
      "An admin multi-symbol job blocks self-serve for its symbols for its whole duration (accepted).",
      "Whether `bars_total` is set during a run is unverified; \"Backfilling…\" without a denominator is the fallback copy.",
      "The `GetBackfillStatus` e2e mock does not exist yet.",
      "`jobId`, \"Data ready\" and the last-filled gap are local state and are lost on reload (accepted under D-2).",
      "@AC-9 exists only on the feature branch until the branches are synced."
    ],
    "constitution_rules_touched": [
      "C-05",
      "C-08",
      "C-10",
      "C-11",
      "C-12",
      "C-13",
      "C-14",
      "C-15",
      "C-16",
      "C-18",
      "F-07",
      "P-02",
      "P-03",
      "P-06",
      "PLAT-4",
      "PLAT-N1"
    ],
    "rationale": "No Floor breach. The adversary's verdict is SOUND, and no blocking objection remains. Seven objections close, and the adversary's non-blocking fixes are folded into the approach.\n\n**Verified this round (working tree)**\n- `pool.go:14,23`: marketdata's pool defaults to 2 connections.\n- `render-assert.jq:49`: a pooled homelab service may not set its pool size.\n- Only `marketdata_repo.go` and `marketdata_service.go` query `marketdata.ohlcv`.\n- `servicer.py:654-661` and `marketdata_repo.go:228-232`: GAPS_ONLY planning scans the full requested range, once per job, before the chunks.\n- Analysis `servicer.py:928-935`: `backtest.max_range_days` is checked against `request.range` only.\n\n**Closed**\n- O-19: the per-class sum is stated (6,200), planning is confirmed to scan the full span, and the bound is corrected to marketdata's pool with PgBouncer as backstop.\n- O-26: config reads and the write and read-back go over the homelab staging MCP; the three Postgres parameters are read-only SHOWs.\n- O-27: one ingest constant and formatter, a shared JSON fixture for both tests, no raw token shown.\n- O-28, O-29, O-30, O-31: adopted as proposed, with the production-instance checklist line added.\n\n**Register**\n- D-21 step 4 (\"raise to 1024 first\") is contradicted by this round's operator steer (\"no lock-setting raise is needed before the cap raise\"). I record D-21 as reopened by the steer and superseded by a new decision. The proposer's petition is recorded with new evidence (PR #79 values).\n- R-11 is honoured: the rollout is not gated on the stock lock value; the stop is the computed inequality on live values.\n- D-14, D-16, D-17, D-18 and R-10 are honoured. The shared fixture is test data, not `ErrorInfo` plumbing or codegen.\n- P-1 (D-5) is already resolved by D-8; the orchestrator should mark it \"user reopened\".\n\n**Operator steer versus adversary**\n- The steer asks to bound S by the PgBouncer pool where scans are pooled. I keep that bound as a backstop and lead with the tighter marketdata bound.\n- The steer's \"runbook precondition\" wording is ambiguous on whether a non-applied PR #79 stops the rollout. I chose the inequality as the stop and raised it for gate confirmation.\n\n**Business rules**\n- No row changes from round 4. 343@AC-9 stays uncovered because I cannot tie relayed item 3 to it from this step's input.",
    "register_delta": {
      "new_decisions": [
        {
          "text": "Supersedes D-21. The homelab raise is a runbook sequence with no lock-parameter change: config inputs over the homelab staging MCP; `max_locks_per_transaction`, `max_connections` and `max_prepared_transactions` by read-only SHOW on the live host; the lock inequality computed from those values as the stop condition; then `set_config` (8 and 1830) and read-back; then observation.",
          "evidence": "Operator steer round 5 (PR #79: 1024 / 70 / 0, no raise needed; O-26 split); proposal round 5; adversary supports the D-21 reopen."
        },
        {
          "text": "The lock bound is `marketdata connections × replicas × L_stmt_max × databases` against the cluster-wide `mlpt × (mc + mpt)`. PgBouncer `pool_size` (10 per database) is a backstop. GAPS_ONLY gap planning scans the full requested span once per job, before chunk writes.",
          "evidence": "services/xstockstrat-marketdata/internal/repository/pool.go:14,23; deploy/homelab/render-assert.jq:49; ingest servicer.py:654-661,683; marketdata_repo.go:228-232; operator values."
        },
        {
          "text": "The homelab config steps target the staging environment only. A checklist line applies the same two values per environment when a homelab production app is first deployed.",
          "evidence": "Relayed user item 4 (\"There are no production instances. Staging is enough.\"); adversary round 5."
        },
        {
          "text": "The denial tokens are one frozen tuple and one formatter in ingest and literals in `src/lib/backtestBackfill.ts`. One checked-in JSON fixture of the tokens and detail format is loaded by both the ingest table test and the UI vitest. `range_too_long` maps to the span copy; any other or unknown token maps to the generic copy.",
          "evidence": "servicer.py:357,423-424; docs/roadmap/ledger/fails.md:308,1516 (adversary round 5); D-18."
        },
        {
          "text": "The homelab provisioning checklist and reverted symptom live in the homelab subsection of `docs/runbooks/config-rollout.md`. Observation after the raise covers feature 341's 53200 counter and marketdata's pool-wait metrics.",
          "evidence": "docs/runbooks/config-rollout.md:293-297; proposal round 5; adversary round 5 (pool contention)."
        },
        {
          "text": "The ALREADY_EXISTS copy is \"A backfill for {symbol} is already queued or running. Try again when it finishes.\" De-dup tests cover self-serve pairs only.",
          "evidence": "D-9 (QUEUED and RUNNING); proposal round 5; uncontested by the adversary."
        },
        {
          "text": "This feature owns the homelab value 1830 for its own key. Analysis `backtest.max_range_days` does not cap the warmup prefix.",
          "evidence": "services/xstockstrat-analysis/app/handlers/servicer.py:928-935; adversary confirms in round 5."
        }
      ],
      "new_rejected": [
        {
          "text": "Raising the homelab `max_locks_per_transaction` as a step of this feature.",
          "why": "PR #79 in the operator's homelab-edge repo already sets 1024, and the corrected bound fits without it."
        },
        {
          "text": "Two independently pinned token literal sets as the drift guard.",
          "why": "Each test checks only its own side, so a rename on one side passes CI."
        },
        {
          "text": "A PgBouncer `SHOW DATABASES` read in the runbook.",
          "why": "No access route is named, and `pool_size` is not the binding bound."
        },
        {
          "text": "A hard stop on `max_locks_per_transaction` below 1024.",
          "why": "The computed inequality passes without it, and the gate would wait on another repo's apply."
        }
      ],
      "new_objections": [
        {
          "text": "Confirm at the gate whether a host that does not yet show the PR #79 values stops the homelab rollout, or only a failed lock inequality does.",
          "blocking": false
        },
        {
          "text": "Confirm at the gate that the 343@AC-9 change is signed off; relayed item 3 cannot be tied to it from the synthesis input.",
          "blocking": false
        }
      ],
      "closed_objections": [
        {
          "id": "O-19",
          "how": "Per-class sum stated (6,200 per database); gap planning confirmed to scan the full span once per job; the bound is corrected to marketdata's 2-connection pool with PgBouncer as backstop, against 1024 × 70."
        },
        {
          "id": "O-26",
          "how": "Config reads and the write and read-back go over the homelab staging MCP; the three Postgres parameters are read-only SHOWs on the live host as a precondition."
        },
        {
          "id": "O-27",
          "how": "One ingest constant and formatter, UI literals, a shared JSON fixture loaded by both tests, and generic copy for any non-span token."
        },
        {
          "id": "O-28",
          "how": "The copy and the @AC say \"already queued or running\"."
        },
        {
          "id": "O-29",
          "how": "Checklist lines and the reverted symptom go in the homelab subsection of `config-rollout.md`, including a line for a future production deploy."
        },
        {
          "id": "O-30",
          "how": "De-dup is asserted only between self-serve requests; the admin row asserts QUEUED only."
        },
        {
          "id": "O-31",
          "how": "The 1830 value is this feature's because it owns the key; `backtest.max_range_days` is checked against `request.range` only and does not cap the prefix."
        }
      ],
      "reopen_petitions": [
        {
          "target": "D-21",
          "evidence": "Proposer, step 4 only: homelab-edge PR #79 and its db-host verify task assert `max_locks_per_transaction` = 1024, so the raise step becomes a read-only check. The adversary supports it and asks that the stop be the computed inequality.",
          "is_new": true
        }
      ],
      "reopened": [
        "D-21"
      ]
    }
  },
  "floor_breaches": []
}
```
- 2026-11-15 — sdd-design: Phase 0 wrote recon.md (services: xstockstrat-ui, xstockstrat-ingest, plus xstockstrat-agent and the `strat-lab` plugin for the docs; reuse patterns: the insights strategy page gap → backfill request, `useTriggerBackfill` + `useBackfillStatus(jobId)`); Phase 1 ran 5 rounds (full); spec-ready → design-approved on the operator's "Agreed".
  The `debate.md` edits, the `user declined` deviation, the O-32/O-33 status note, the relayed six answers and the no-ledger note are in the header. `343@AC-9` CHANGE sign-off (C-16): the approval covers the design that contains the rewrite (D-12), but no operator decision names the scenario, so /sdd-spec was to confirm before editing it (it edited on that basis; still open as O-33).
  Its open threads were either closed at /sdd-spec (metric names, fixture home, `bars_total`, e2e mock, `acceptance.feature` / `feature.md` / product-spec edits) or carried into the header's Open Threads.
- 2026-11-15 — sdd-spec: generated implementation-spec.md with 16 steps; design-approved → implementation-ready; also edited `acceptance.feature`, `product-spec.md`, `feature.md` as `design.md` directs (see Files Modified). Tree, findings, step grouping and the unmapped relayed items are in the header; the 12 assumptions are in `implementation-spec.md` § Assumptions made at /sdd-spec.
  Copy written at spec because the design gave no text: the generic denial sentence and the @AC-16 failure sentence. `has_active_job` matches any data kind; the admin request on the insights button stays without `fillMode`; `useTriggerBackfill` is unchanged; no `strat-lab` version bump. `merge-order.md` was not edited (outside the feature directory); the row is Step 1.

## Session 2026-11-15 — sdd-review impl-spec (advisory)

- Result: 0 failures, 7 warnings on criteria (PASS WITH WARNINGS, no floor breach); overlap FAIL-level on the config migration number (advisory — did not block). Lifecycle unchanged (`implementation-ready`).
- Run as a batch step that was told to fix the spec, so `implementation-spec.md` was edited here (the skill's Mode B normally leaves it untouched). Each edit was re-checked against the tree first.
- Addressed in `implementation-spec.md`:
  - [x] Step 11: verification now runs `pnpm run test:coverage` and names the threshold (`src/lib/**` lines, functions and statements ≥ 40%, `services/xstockstrat-ui/vitest.config.ts:29-33`; `package.json:19`). `test:unit` checks no threshold.
  - [x] Agent CI filter gap: Step 9 now adds `services/xstockstrat-ingest/tests/fixtures/self_serve_denial.json` to the `xstockstrat-agent` filter (`.github/workflows/ci.yml:59`), with a grep check. Assumption 4 and Step Dependencies ("Step 9 requires Step 6") updated.
  - [x] Step 5 Instruction 7: the executor records the insert shape kept, and the suite result for each shape, in the Deviation Log.
  - [x] Spec claim corrected (found while checking the filter finding): `scripts/config-wiring.test.mjs` does **not** parse the per-service filter lines. `ciFilterGlobs` (`:663-674`) reads only block-list filters and is called for `config-wiring` alone. So the review's "extend the `node --test scripts/config-wiring.test.mjs` check" has nothing to extend; the filter checks in Steps 9 and 11 are greps, and the `node --test` line stays as a regression run only.
- Unresolved ⚠ carried into execution:
  - Step 8: touches 6 files (code, two docs, two `strat-lab` skill files); the reviewer suggests splitting code from docs — [ ] unaddressed. Kept as one step: `docs/patterns/strat-lab-plugin.md` requires the skill change in the same PR and Step 9's parity test reads all of them.
  - Step 7: edits the durable suite `docs/sdd/business-rules/platform.feature` (an Examples row on `244@AC-6`) before launch, where C-16 normally promotes at launch — [ ] unaddressed. Needs the owner to accept a pre-launch EXTEND; the precedent is the FQN rows at `:495-498`.
  - Assumption 1: `343@AC-9` was rewritten while O-33 is still `open` in `debate.md` — [ ] unaddressed. Needs the operator's confirmation at the gate. This run's relayed operator note carried six numbered answers ("1. Agreed", "2. Ok, agreed.", "4. Confirmed", "6. Sounds good", …) with no questions attached, so none of them was read as this sign-off.
  - Step 2: generating `scripts/config-wiring-stored.json` needs a reachable Postgres (blocked without one, P-03) — [ ] unaddressed (environment, not a spec defect).
- Overlap findings:
  - [migration, FAIL-level] config migration `050` is also claimed by 341 (`050_ui_chart_history_bars`) and 330 (`050_analysis_live_enrich_ttl_reseed`) on their branches (not readable from this checkout; trunk tip is `049`) — [ ] unaddressed until Step 2 and the integration PR re-derive the number. Already in the spec (Step 2 Instruction 1, "Volatile at merge"); 343 merges after 341 and renumbers.
  - [dependency] 343 waits for 341 (`marketdata.ohlcv.out_of_memory_errors`); `merge-order.md` has no 341 or 343 row — [ ] unaddressed until Step 1 lands the row (that file is outside this session's write scope).
  - [file, WARN, rebase-only] `trader/positions/[symbol]/page.tsx` (339, 341); `e2e/trader/position-detail.spec.ts`, `insights/strategies/[id]/page.tsx`, `e2e/insights/backtest-coverage.spec.ts` (341); ingest `servicer.py`, `tests/test_ingest_servicer.py`, `e2e/mock-backend.ts`, `e2e/fixtures/INVENTORY.md` (344); `docs/patterns/config-governance.md`, `docs/runbooks/config-rollout.md` (append order). `e2e/insights/backtest-coverage.spec.ts` ↔ 341 is new in this scan and is not in the spec's peer-overlap list.
  - [config] `ingest` / `backfill.self_serve_max_range_days`: no collision.
- Relayed operator items: "3. I plan to do psql over ssh if possible" matches Assumption 2 (already applied). "5. Yes, fix the primitives. Use the switch component from Shadcn." is not about this feature.

### Open Threads

- Operator at the `/sdd-execute` checkpoint: confirm the `343@AC-9` rewrite (O-33) and the pre-launch edit to `platform.feature` (Step 7).
- Step 8 stays one step unless the operator wants code and docs split.
- Config migration number `050`: re-derive at Step 2 and at the integration PR; renumber after 341.
- Step 2 needs a reachable Postgres.
- `merge-order.md` row for 341 → 343 lands in Step 1.

---

## Session 2026-11-15 — operator directive for execute (orchestrator)

- **Operator, verbatim (2026-11-15): "Use MCP tools if possible in 341 and 343."** Given after the
  orchestrator reported that one step regenerates `scripts/config-wiring-stored.json` against a
  reachable Postgres and that the rollout reads Postgres parameters.
- **Binding for `/sdd-execute` and the rollout runbook:** every live read or write that an MCP tool
  can do goes through the MCP (`get_config`, `set_config`, `list_config_keys`, `get_backfill_status`,
  `trigger_backfill` on `xstockstrat_homelab_staging` / `xstockstrat_staging`), not `psql`.
- **What no connected MCP tool can do (orchestrator finding, not operator words):** (a) read
  Postgres server parameters (`SHOW max_locks_per_transaction` etc.) — the agent MCP has no SQL
  tool; the homelab values are in `homelab-edge` `roles/db_host/defaults/main.yml` and its `verify`
  task asserts the lock setting; (b) regenerate `scripts/config-wiring-stored.json`, which needs a
  scratch Postgres with the migration set applied, not a live database. Those two stay as specified
  unless the operator rules otherwise at the execute checkpoint.

- **Operator, verbatim (2026-11-15): "max_locks_per_transaction assume what homelab-edge has".**
  Supersedes item (a) above for that parameter: the rollout takes `max_locks_per_transaction` = 1024
  from `homelab-edge` `roles/db_host/defaults/main.yml` (asserted by its `verify` task) and does
  not read it live with `psql`. Step 16's read-only `SHOW max_locks_per_transaction` precondition
  is dropped at execute; the lock inequality is computed with 1024.
- **Orchestrator assumption (not operator words):** the ruling names only
  `max_locks_per_transaction`. `max_connections` (70 after homelab-edge PR #79 is applied to the
  host, 60 before) and `max_prepared_transactions` keep their specified read unless the operator
  extends the ruling.
- **Operator, verbatim (2026-11-15): "max_connections are now love."** Orchestrator reading (the
  operator's word is taken as a typo for "live"): homelab-edge PR #79 is applied to the DB host, so
  `max_connections` = 70 and the PgBouncer pool = 10 per database are the running values. The
  rollout takes `max_connections` = 70 from `homelab-edge` as well; the "PR merged but not yet
  applied" precondition is dropped. Not verified by the orchestrator against the live host.

## Session 2026-11-15 — /sdd-distill
- Distilled 10 sessions → header + Superseded Sessions; kept 2 verbatim.
- context.md 1373 → 437 lines. Original prose preserved in git history.
- **Operator sanction (2026-11-15), deviation from the skill's preserve-every-`sdd-batch-*`-block rule:** asked
  "How should I write them?" with the option "Keep only the last state block", the operator chose it. The 3
  superseded per-round `sdd-batch-design-state` block(s) are dropped; the last one is kept byte-for-byte (the only one
  any workflow reads, `.claude/workflows/sdd-batch.js:191`). Other `sdd-batch-*` blocks are untouched.
- The loss check was a self-check by the planning agent (no separate `context-distiller` verifier was available).

## Session 2026-11-15 — sdd-execute sequential (sdd-batch-execute)
- Up-front confirmation: the operator approved the plan with this record (binding, verbatim):
  `{"mainDev":"9f88562296464b43465d0376b40cefafe93f0743","dev":"396b54e0c8adf870537e65360f75761c3b84289b","specHash":"2c1b6a9598927a51bd4aeb655ee103bf9aaa23e7","directive":"conditional","pending":[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16],"mismatches":[{"n":1,...},{"n":8,...}]}`
  (the full mismatch details are the first body line of the respec commit below).
- Operator answers relayed with the run, verbatim: "1. Yes / 2. No, add it to the scope / 3. Yes".
- Merged `origin/main-dev@9f8856229` into the feature branch (`cf9f49aff`); the resolver and `ledger-guard` were clean.
- Tooling detection (steps 1-16): Python 3.13.18 ✓ · uv 0.11.32 ✓ · ruff ✓ · Node v24.22.1 ✓ · pnpm 9.15.9 ✓ ·
  vitest/playwright/tsc ✓ (linked main-checkout `node_modules`) · Chromium in `/opt/pw-browsers` ✓ · docker ✓.
- Re-spec commits (`respec(backtest-inline-backfill)` on `git log --first-parent origin/main-dev..HEAD`):
  - `41dc2fba4` respec(backtest-inline-backfill): align steps 1,8 with current codebase. Step 1: the 343 row
    (`merge-order.md:127`) and the "Symbol-page cohort: 339-344" section (`:403-411`) already exist (#1545), so the
    step adds no row and appends one sentence naming 343's remaining shared files to that section. Step 8: the
    `backfill.md` admin/scope grep evidence corrected to "no match".
- Assumption (re-spec): of the two options the mismatch named (amend the existing entries or mark Step 1
  satisfied), amend was chosen, because the existing section does not list the 341 insights-page/e2e overlap or the
  344 ingest/mock/inventory overlap that this spec's Step Dependencies records.
```sdd-batch-setup
{"mainDev":"9f88562296464b43465d0376b40cefafe93f0743","date":"2026-11-15"}
```

### Step 1 — docs: merge-order row for feature 341 [done]
- Added no table row (the 343 row at `merge-order.md:127` stays); appended one sentence to the "Symbol-page cohort: 339-344" section naming 343's other shared files with 341 (insights strategy page, `position-detail.spec.ts`) and 344 (ingest `servicer.py`, `test_ingest_servicer.py`, `mock-backend.ts`, `INVENTORY.md`). TDD: N/A (docs). Verification: `grep -c` → `1`, `grep -n` → `409:` (inside the section), `exit=0`.
- Files modified: `docs/roadmap/features/merge-order.md`
- Deviations: none (the Verification fence ends in a `#` comment, so the run script put the closing `)` on its own line; the fence text was run unchanged).

### Step 2 — migration: seed `ingest` / `backfill.self_serve_max_range_days` [done]
- Atomic unit 2+3+4. Created config migration `050_ingest_backfill_self_serve_keys` (re-derived: `049` is the tip on the branch and on `origin/main-dev`): two global rows (staging, production), value and default 730, actor `system:config-migration-feature-backtest-inline-backfill`; the down deletes only those rows with `value_data = '730'`. Regenerated `scripts/config-wiring-stored.json` against the operator-provided scratch Postgres at `127.0.0.1:5432` (operator Option B; generator exit 0, +2 rows, new `inputs_sha256`). TDD: N/A (migration). Verification (`v-2`): exit=0, `grep -c` → `2`, `--final` reports only the two pre-existing `readers-disagree` lines (analysis, trading), `node --test` 75 pass, 0 fail. Wiring gate step-time with `--declared-from` and `--declared-migration` (`v-8`): exit=0, no findings.
- Files modified: `services/xstockstrat-config/migrations/050_ingest_backfill_self_serve_keys.up.sql`, `services/xstockstrat-config/migrations/050_ingest_backfill_self_serve_keys.down.sql`, `scripts/config-wiring-stored.json`
- Deviations: none for the migration; the regeneration used the operator's scratch server (Deviation Log).

### Step 3 — service: ingest reader `backfill_self_serve_max_range_days` [done]
- Atomic unit 2+3+4. Added the property after `backfill_webhook_sweep_interval_seconds`, returning `int_positive(self, "backfill.self_serve_max_range_days", 730)`. RED and GREEN are recorded under Step 4. Verification (`v-3`): exit=0, `All checks passed!`, `57 files already formatted`, the read is at `watcher.py:143`.
- Files modified: `services/xstockstrat-ingest/app/config/watcher.py`
- Deviations: none

### Step 4 — test: reader default, clamp and read classification [done]
- Atomic unit 2+3+4. Added two clamp rows (stored 0 and -1 → 730), a new test (stored 1830 → 1830, absent → 730) and the key in `FR3_KEYS`. RED (`v-1`, property stubbed to return 0): `4 failed, 35 passed`; the failures were `assert 0 == 730` (×2), `assert 0 == 1830` and `FR3_KEYS entries no longer clamped`. GREEN: `v-5` `39 passed`; `v-6` `506 passed`, `Required test coverage of 40% reached. Total coverage: 86.61%`; `v-7` `--final` plus `node --test` 75 pass, exit=0. C-13: the key string is the only literal, in each file's own table.
- Files modified: `services/xstockstrat-ingest/tests/test_config_watcher.py`, `services/xstockstrat-ingest/tests/test_config_read_classification.py`
- Deviations: Verification run per line from the repo root, because the fence's chained `cd` fails as one subshell (`v-4`, exit 1). No command changed (Deviation Log).

### Step 5 — service: self-serve envelope and per-symbol de-dup on `TriggerBackfill` [done]
- Atomic unit 5+6. The `TriggerBackfill` admin gate now accepts a non-admin request inside the eight-condition envelope. A request outside it is denied `PERMISSION_DENIED` with `_self_serve_denial_detail` of the first failed token. The tuple `_SELF_SERVE_DENIAL_TOKENS` and `_self_serve_denial` sit next to `_has_admin_scope`. A self-serve insert runs in one transaction (`pg_advisory_xact_lock` on `backfill:<symbol>`, then `has_active_job`, then `insert_job(conn, …)`) through the private helper `_insert_self_serve_job`. A hit aborts `ALREADY_EXISTS` ("a backfill for {symbol} is already queued or running", no job id) after the block exits. The admin path is unchanged. Emit and spawn stay after the commit, and the payload has no `user_id`. RED and GREEN are recorded under Step 6. Verification (`v-4`, exit=0): `All checks passed!`, `57 files already formatted`; `_has_admin_scope(context)` count `5`; `metadata=propagation_meta` still at `:588` (the queued event); `"multi_symbol"` on one line (`:375`); `admin scope required` only at `:1040` and `:1688` (outside `TriggerBackfill`). Wiring gate, step-time `--declared-from` (`v-8`): exit=0, no findings.
- Files modified: `services/xstockstrat-ingest/app/handlers/servicer.py`, `services/xstockstrat-ingest/app/repositories/backfill_jobs.py`
- Deviations: insert shape B (helper) kept, and both shapes passed `156 passed` (`v-2`, `v-3`). `"range_too_long"` appears twice, per Instruction 3. Both are in the Deviation Log.

### Step 6 — test: envelope table, de-dup, shared denial fixture [done]
- Atomic unit 5+6. Created `tests/fixtures/self_serve_denial.json`, loaded by the session fixture `self_serve_denial_contract` in `conftest.py`. `make_servicer` gained `self_serve_max_range_days=730`. New class `TestTriggerBackfillSelfServe` builds every request as a real `TriggerBackfillRequest`. Rows: contract pin; 10 denial rows (AC-15), with the 731-day row carrying ` (max 730 days)` (AC-12); a coverage check that every contract token has a row; first-failure order; base and 730-day accepted (AC-7, lock, `has_active_job` and insert on the transaction connection); queued-event metadata (D-11, PLAT-4); admin QUEUED only (D-27); duplicate `ALREADY_EXISTS` with no UUID (AC-11); a race under a real `asyncio.Lock` fake, where exactly one request is QUEUED; insert raises, then no event and no spawn. Rewrote `test_permission_denied_without_admin_scope` (`fill_mode` token) and `test_validation_runs_after_the_admin_gate` (`callback_url` token, 334@AC-26 kept). Added `has_active_job` bind-parameter tests. RED (`v-1`, Step 5 symbols as stubs): `22 failed, 149 passed`. Failures: `'admin scope required' != 'self-serve backfill denied: <token>'` for every denial row, `assert () == ('multi_symbo…` for the contract, `PERMISSION_DENIED == ALREADY_EXISTS` for the duplicate, `Exception: aborted` for the accepted rows, `assert 0 == 1` for the race, and `Expected fetchrow to have been awaited once` for the repo. GREEN: `v-6` `171 passed`; `v-7` `528 passed`, `Required test coverage of 40% reached. Total coverage: 86.78%` (`backfill_jobs.py` 100%, `servicer.py` 87%). `v-5` greps: the contract comes from `conftest` (`self_serve_denial_contract` usages), `"multi_symbol"` in tests → `0`, and the first three `MagicMock()` lines are `make_servicer`'s cfg and channels, so no self-serve row uses one. C-13: the token contract is in one JSON file with two consumers (this suite and Step 11's vitest); the request literals stay inline (one consumer).
- Files modified: `services/xstockstrat-ingest/tests/fixtures/self_serve_denial.json`, `services/xstockstrat-ingest/tests/conftest.py`, `services/xstockstrat-ingest/tests/test_ingest_servicer.py`, `services/xstockstrat-ingest/tests/test_backfill_jobs.py`
- Deviations: Verification run per line for the two `pytest` lines, because the fence's chained `cd` fails as one subshell (`v-5`). No command changed (Deviation Log). Tooling: the ingest `uv sync --extra dev` venv resolved Python 3.12.3 (as in Steps 2-4); ruff 0.16.9 from the host.

## Session 2026-11-15 — operator standing authorization and checkpoint answers (orchestrator)

- **Standing authorization for checkpoints — operator, verbatim (2026-11-15): "Proceed, do not stop at
  checkpoints unless it's necessary".** Given in answer to "Proceed past the checkpoints?". The run uses
  `checkpoints: 'report'` from here on; this entry is its `authorizationRef`. It does not waive blockers,
  failed verifications, Floor breaches, uncovered `@AC` CHANGE lines or any decision that is the
  operator's — those still halt.
- **Scratch Postgres for stored-set generation (orchestrator tooling, not an operator ruling):** a
  Postgres 16 the main session controls listens on 127.0.0.1:5432. `DATABASE_URL` is not exported into
  agent shells; prefix the generator: `DATABASE_URL='postgres://postgres@127.0.0.1:5432/postgres?sslmode=disable'
  python3 scripts/config-wiring-stored.py`. Do not start, stop or delete the server; if it is
  unreachable, stop and report.
- **Checkpoint 5 — "Yes"** (proceed).
- **`343@AC-9` rewrite (O-33) — "Confirm".** Asked: the status-message scenario was rewritten to match
  what the server returns (two different "partial" messages) without an explicit sign-off — confirm?
  Confirmed; O-33 is closed.
- **Step 7 pre-launch edit to `platform.feature` (`244@AC-6` row) — operator, verbatim: "Expand it".**
  Asked: Step 7 adds one row to an existing durable acceptance rule for the new config key, which
  normally happens at launch, so it needs acceptance to do it now. **Orchestrator reading (not operator
  words): "expand" is taken as "extend", i.e. the pre-launch EXTEND is accepted.** The reading was
  stated back to the operator; if the operator corrects it, this line is superseded.

## Session 2026-11-15 — sdd-execute sequential (sdd-batch-execute), Step 7

### Step 7 — docs: ingest gate wording, key table, registered-keys log, business-rule row [done]
- Ingest `CLAUDE.md` § Authorization: `CancelBackfill` stays admin-gated ("admin scope required"); `TriggerBackfill` is admin or the self-serve envelope, with the eight conditions and tokens in first-failure order, the detail format, the per-symbol `ALREADY_EXISTS` de-dup and an unchanged admin path. Added the `backfill.self_serve_max_range_days` key-table row (seed `050_ingest_backfill_self_serve_keys`), reworded findings `:39` (status stays open), added the feature 343 registered-keys entry above 338, and the `244@AC-6` Examples row (pre-launch EXTEND accepted by the operator, "Expand it"). TDD: N/A (docs). Verification (`.sdd-logs/v-1.log`, exit=0): the key at `CLAUDE.md:33,152`, `config-governance.md:163`, `platform.feature:498`; `admin scope required` only at `CLAUDE.md:17` (`CancelBackfill`); `--final` reports only the two pre-existing `readers-disagree` lines (analysis, trading). Wiring gate step-time `--declared-from` (`v-2`): exit=0, no findings.
- Files modified: `services/xstockstrat-ingest/CLAUDE.md`, `services/xstockstrat-ingest/docs/context-constitution-findings.md`, `docs/patterns/config-governance.md`, `docs/sdd/business-rules/platform.feature`
- Deviations: the `platform.feature` site cell overflows its column by 4 characters (the `effective` cell is padded shorter so the row length matches); the `config-rollout.md` reference resolves only once Step 16 lands (Deviation Log).

## Session 2026-11-15 — sdd-execute sequential (sdd-batch-execute), Step 8

Tooling setup (step 8): uv ✓ · Python 3.13.18 ✓ (agent venv, `uv sync --extra dev`) · ruff ✓ 0.16.9 (host) · pytest ✓ (venv) · node ✓.

### Step 8 — service: Agent `trigger_backfill` wording, runbook and `strat-lab` skill [done]
- The `trigger_backfill` module-header line, tool docstring (the MCP tool description) and client docstring no longer say "admin-scoped": an admin may request anything, any other caller only the self-serve envelope (seven parameter rules, the `backfill.self_serve_max_range_days` limit, the eight `self-serve backfill denied: <token>` tokens, `ALREADY_EXISTS` for an in-flight symbol); the false "queues unconditionally" sentence is replaced. Parameters, the 50-symbol cap, scope forwarding and return shape are unchanged. Agent `CLAUDE.md` takes `trigger_backfill` out of the "non-admin is rejected" sentence; `mcp-tools.md` gains the envelope list, two Errors rows, the `fill_mode` note and a corrected `cancel_backfill` contrast; the `strat-lab` skill and `reference/backfill.md` state the non-admin call shape, the `range_too_long` and `ALREADY_EXISTS` handling, and that `callback_url` is admin-only. No `plugin.json` bump (Assumption 11).
- TDD (AC-7 Agent surface, via Step 9 Instruction 1's parity assertions in an uncommitted scratch test): red `v-1` exit=1 — `AssertionError: mcp-tools.md § trigger_backfill` (`'self-serve backfill denied'` not in the section) → green `v-2` `1 passed`, exit=0. Verification: `v-3` ruff `All checks passed!`, `75 files already formatted`; per line from the repo root `v-4` no `admin-scoped` + `trigger_backfill` match (exit=1, expected), `v-5` `1593:        access_scope = _caller_access_scope(ctx, "trigger_backfill")`, `v-6` `145 passed`, exit=0. Wiring gate step-time `--declared-from` (`v-7`): exit=0, no findings.
- Files modified: `services/xstockstrat-agent/app/tools.py`, `services/xstockstrat-agent/app/client.py`, `services/xstockstrat-agent/CLAUDE.md`, `docs/runbooks/mcp-tools.md`, `plugins/strat-lab/skills/backtest/SKILL.md`, `plugins/strat-lab/skills/backtest/reference/backfill.md`
- Deviations: RED/GREEN via a scratch copy of Step 9's parity test (Step 9's files are outside this step); Verification run per line because of the fence's chained `cd` (Deviation Log).
- Not changed, noted: the `client.py` `trigger_backfill` docstring body still says "Everything else queues unconditionally"; Instruction 1 names only its first line, so the body was left as is — open for Step 9 or a follow-up.

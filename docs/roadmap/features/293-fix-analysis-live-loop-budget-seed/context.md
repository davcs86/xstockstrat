# Context: fix-analysis-live-loop-budget-seed  (archived 2026-11-10)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-11-10 — /sdd-archiver

**What**: The analysis live loop logged a steady-state overflow WARN on every cycle, because about 690 live (strategy, symbol) pairs ran against an unseeded per-cycle budget of 50. The fix shipped in two independent PRs:
- PR-1 (#1457) added an in-memory latch. The WARN now fires once per (over-budget episode, effective budget, process lifetime), and the truncation counter still increments every cycle.
- PR-2 added migration `043`, `SetConfig` bounds and a real-Postgres assertion. By the time it merged, feature 295's heal migration `041` already seeded both keys. On a real DB, `043` therefore reduces to an idempotent guard seed plus a metadata backfill: "041 seeds, 043 guards + backfills".

**Why (irrecoverable rationale)**:
- **Budget max 1000.** It is a typo guard, not a capacity limit. Pairs are evaluated serially, so the budget bounds cycle *duration*, not concurrency; the earlier "2-slot marketdata pool" rationale was wrong. It matches `analysis.opportunity.max_universe_size` (operator, 2026-11-05 round-1 gate).
- **Interval bounds `[30,600]`.** The real constraint is interval + cycle duration < 1800 s. The `xstk-analysis-no-scoring` alert counts `cycle complete` heartbeats over 30 min, and a heartbeat is logged only after a successful cycle.
  - The minimum is 30 because each iteration does a full strategies SELECT, a signal drain and per-owner RPCs, with no per-RPC timeout. A value of 1 is the likeliest minutes-for-seconds typo (an operator types `1` meaning one minute).
  - The per-pair cost (0.05 s at 50 pairs → 0.12 s at 200) is extrapolated (operator, 2026-11-05 round-2 gate).
- **A long cycle is never skipped.** `run_forever` awaits each cycle inline after `sleep(interval)`, and the `_lock.locked()` skip is dead code. The effective period is interval + cycle duration, about 84 s at 200 pairs.
- **Staging budget = 200.** The assistant picked it during Track B; the operator confirmed it 2026-11-07.
  - It exists ONLY as a runtime row. A staging DB rebuilt from migrations reverts to 50, because neither 041 nor 043 seeds 200.
  - The pre-apply `value_type` check was accepted from an MCP `get_config` read-back on staging only. Nothing records a production check; this is likely moot, since 041 seeds `int` rows.
- **`alert_throttle_seconds` was left out of scope at design time.** The operator widened scope to `eval_interval_seconds` only, and the baseline entry was then owned by 278. Since then, 295's `041` seeds it (default 300), so no follow-on remains.
- **Budget minimum is 1.** `int_positive` silently turns a stored 0 or negative value into 50, so `min 1` turns a silent misread into a write-time rejection. The read-side guarantee (`platform.feature`) remains for legacy stored zeros.
- **Seeded descriptions state only the operator-visible effect.** Config-ui renders bounds from `scalarBounds`.
- **The metadata UPDATE never sets `updated_by`.** The runtime author of the value stays attributed.

**Rejected alternatives**:
- Budget max 400: below today's ~690 pairs, so the overflow state could never be cleared via config. Its pool rationale was also wrong.
- Interval `[1,900]`: 1 is the unit-typo case, and 900 leaves no headroom against the 30-min heartbeat alert.
- Minimum-only bound: a typo like 50000 gives ~100-min cycles that trip the heartbeat alert, and the guard is cheap.
- Seeding only the budget key: leaves the sibling `eval_interval_seconds` defect unowned.
- Hard merge dependency on 281/291: serialises a SEV-3 fix. Replaced by a soft renumber-at-merge rule.
- `DO UPDATE` upsert seed: the config-wiring checker exits 2 ("shape not understood").
- Separate migrations per key: doubles the ordering hazard.
- Latch state as a tuple or a pair count: the extra field adds nothing, and a pair-count state re-warns on drift.
- Time-window throttle: adds a new knob and still re-warns in steady state.
- "Recovered" INFO line: YAGNI. The per-cycle INFO line and the counter already carry the state.
- Static SQL-text test: cannot observe triggers, audit rows or AND/OR precedence.
- Removing the dead `_lock` skip: out of scope, and it would break `TestLiveLoopHeartbeat`.
- Down-guard on the `updated_by` sentinel: first rejected as one more literal to sync, later reversed (see Permanent deviations).

**Scars & gotchas**:
- **The down's precedence parentheses are load-bearing.** Without the outer parentheses, AND binds before OR and the DELETE removes per-user or other-namespace rows holding `'60'`.
  - The fixtures include ledger-namespace rows that reuse the key strings, an `alert_throttle_seconds` row holding `'60'`, and a staging interval holding `'50'`. Together they catch a `key IN (…) AND value IN (…)` mis-write.
- **Assertion fixtures must set `environment` explicitly.** The column default `'dev'` violates `config_values_environment_check`.
  - Assertions run after the whole migration chain, so fixtures first delete the seeded rows.
  - After `041` landed, they must also delete `alert_throttle_seconds` before inserting it.
- **The AC-4 idempotency diff cannot see a spurious re-UPDATE,** because `NOW()` is constant inside a transaction. Idempotency rests only on the WHERE guard.
- **The metadata UPDATE moves `updated_at` but writes no audit row.** The trigger audits `value_data` only, so staging can show the operator as last editor at the migration timestamp. Accepted.
- **Accepted latch behaviours.**
  - Every crossing between under and over budget re-warns, including a transient pair drop from the per-strategy drain `ValueError` skip.
  - Recovery is silent, and a restart re-warns once.
  - These were acceptable partly because no alert or dashboard depends on the overflow WARN.
  - A cycle that raises before the overflow check leaves the latch unchanged.
  - Later cycles no longer log their window start. It equals the previous INFO line's `cursor now at`.
- **Migration number churn.** The spec-time number was 038, pinned to 043 by operator order (282 → 295 → 291 → 293).
  - The re-spec gate fired twice because max+1 ≠ 043.
  - The operator approved writing 043 early, with a mandatory re-check at merge. It landed as max+1 over 291's 042, so no renumber was needed.
- **The husky pre-commit hook never ran here.** There was no root `node_modules`, and `core.hooksPath` pointed at a missing dir. See fails.md feature-301 entry.

**Permanent deviations**:
- **Down guard.**
  - Design: guard on value only; guarding on the `updated_by` sentinel was rejected.
  - Shipped: `043_analysis_live_loop_keys.down.sql:11` also requires `updated_by = 'system:config-migration-043'`.
  - Because: 295's `041` merged first and seeds both keys at 50/60, so a value-only down would delete 041's rows on rollback. `SetConfig` overwrites `updated_by`, so operator writes stay safe too.
  - Decision: operator, 2026-11-07 ("Keep, narrow down"). Added `@AC-13` and a fourth assertion block.
- **Role of 043.**
  - Design: 043 seeds both keys.
  - Shipped: on real DBs, 043's INSERT is a no-op and its real effect is the metadata backfill.
  - Because: 041 already seeds them.
- **Test sequence.**
  - Design: AC-2 cumulative WARN sequence 1,1,2,3,4.
  - Shipped: 1/1/2/2/3/3/4, matching the test.
  - This is a test-detail refinement, not a behaviour change.
- **Reader helper.**
  - Design: `_one_iteration` in `test_live_loop.py` returned None.
  - Shipped: it returns its sleep calls. Its three callers ignore the value.

**Cross-feature signal**:
- Two in-flight features (293, 295) independently seeded the same config rows.
- 293's overlap scans checked only migration numbering and recorded "no duplicate key". The double seed surfaced only when PR-2 merged `origin/main-dev`.
- At that point the designed rollback would have deleted the other feature's rows.
- Root-cause class: the key was introduced consumed-with-default, under feature 227's unseeded-tuning-key waiver. Once the fleet outgrew 50 it became operationally necessary.
  - Being unseeded forced `create_key=true`, because the feature-091 existence gate refuses a plain `SetConfig` with NOT_FOUND.
  - `create_key=true` makes metadata-less rows (NULL description/default/consumer) that migrations cannot see. That is why 043 backfills metadata.
- This is the same family as the feature-305 fails entry (a dependency merged mid-design changed the durable set). The new twist is an ownership collision on the same rows.

**Deferred follow-ons**:
- `merge-order.md` row for 291/293 still says "insert above the feature 249 entry". It has been stale since 281 landed.
- Downstream capacity (indicators/marketdata/Alpaca) at budgets above 50 is unverified. Both the staging 200 and the 1000 ceiling were set without load evidence; check before raising production.
- Re-check the `[30,600]` interval ceiling against `xstk-analysis-no-scoring` if cycle durations grow.
- The production budget value is still an operator decision; production runs the seeded 50.
- Pre-existing and out of scope: snapshot-built `_run_cycle` tests log `QuerySignals failed: bad argument type`. It comes from the best-effort signal drain against the `AsyncMock` ingest stub.

**Ledger entries written**: insights.md (2), fails.md (1) — see the 2026-11-10 entries. The existing 2026-11-05 reuse entry is a duplicate and was skipped.

**Runtime-invariant recommendations (→ /context-constitution)**:
- ANALYSIS-*: the live loop's `_lock.locked()` skip is dead code. The effective period is interval + cycle duration, and `TestLiveLoopHeartbeat` guards the current shape.
- ANALYSIS-*: live-loop pair evaluation is serial, so `max_strategies_per_cycle` scales cycle duration, not concurrency or pool use.
- CONFIG-*/PLAT-*: a `config.config_values` fixture INSERT must set `environment`, because the default `'dev'` violates the check constraint. `migration-assertions/*.sql` run after the full chain, so fixtures first delete rows that later migrations seed.
- CONFIG-*: a metadata-only UPDATE on `config_values` moves `updated_at` but writes no `config_audit` row.

**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at 2d91b5671335fcce267679b50caa494440205f51. Defect report `docs/reports/2026-11-04-analysis-live-loop-chronic-budget-overflow-defect.md` (pruned 2026-11-10; `git show 2d91b567:docs/reports/2026-11-04-analysis-live-loop-chronic-budget-overflow-defect.md`) (+ `.status`) was pruned in the same run.

## Retained verbatim records

Operator decisions and C-16 sign-offs copied verbatim from the pre-archive session log, because durable suites and later features cite "<NNN> context.md" as their provenance. Headings are demoted one level.

### Session 2026-11-05 — sdd-design round 2 gate (user decisions)
- Round-2 adversary: NEEDS WORK, no Floor breach (wiring checker, audit triggers, assertion harness, latch verified). Open items: interval bounds were the proposer's choice; down-migration AND/OR precedence fixture hole; embedded-NNN list incomplete / F-09; hard 281 dependency is the wrong remedy; interval description drift clause; no BEGIN/COMMIT in up/down; accepted latch behaviours; `alert_throttle_seconds` omission; `@AC-6 @feature-278` reader/test cite.
- **USER DECISIONS (explicit, AskUserQuestion):** (1) `analysis.engine.eval_interval_seconds` bounds = **[30, 600]** (registry comment names alert uid `xstk-analysis-no-scoring` and the joint condition interval + cycle < 1800 s with the budget key). (2) Ordering = **soft, rebase-only, renumber at merge** (merge-order rows for 293↔281/291 become soft; whichever of 281/291/293 merges next takes last+1 from `origin/main-dev`; later ones renumber and log a Deviation Log entry). (3) Gate: **run another round (round 3)** before approving.

### Session 2026-11-07 — operator decisions before PR-2

- **PR-1 merged** as #1457 (`f9fda6dc`, the live-loop overflow-WARN latch, Step 1); Steps 1–7 are done.
- **Staging value confirmed (operator davcs86, 2026-11-07):** keep `analysis.engine.max_strategies_per_cycle` = 200
  in staging (the Track B value). 043 seeds 50 only where no row exists, so staging keeps 200.
- **Pre-apply `value_type` check:** satisfied by the 2026-11-07 staging read-back through the agent MCP
  (`get_config analysis`): `analysis.engine.max_strategies_per_cycle` = 200 `int`,
  `analysis.engine.eval_interval_seconds` = 60 `int`. Operator accepted this as the pre-apply check.
- **Merge order:** PR-2 (migration `043`) waits for 291's `042` to merge; 282 and 295 are merged. Re-check
  max(`origin/main-dev` config migration)+1 = `043` at land.

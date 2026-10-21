# Design: fix-python-config-stored-zero

**Created**: 2026-10-21
**Rounds**: 3 (full; termination: approved — auto-approved under operator standing authorization 2026-10-21)
**Approved by**: orchestrator under the operator standing authorization (context.md, "Operator decisions") @ 2026-10-21
**Grounded in**: recon.md

---

## Chosen Approach

**1. Getters (FR-1/FR-2).**
- `get_int`, `get_float` and `get_str` in all three watchers take the `HasField` body of `get_bool`.
  - Trapped sites: recon.md:28-29, 46-47, 63-64.
  - `get_bool` body: analysis `watcher.py:126`, indicators `:122`, ingest `:136` (recon.md:161-167).
- The None-snapshot and missing-key guards stay. They already satisfy FR-2 / @AC-4 (recon.md:167-168).
- `get_int_present`, `get_float_present` and `get_str_present` become one-line class aliases (`get_int_present = get_int`, …).
  - Sites: analysis `watcher.py:118,147`, ingest `:128`, indicators `:106` (recon.md:31-33, 163-165).
  - The 32 alias call sites, the cfg mocks and the feature-173 suite wording stay unchanged (recon.md:313-318). The count is 36 grep hits minus 4 `def` lines.

**2. Clamp helpers (FR-3).**
- Each watcher module gets a module-level `int_positive(cfg, key, default)`: `v = cfg.get_int(key, default); return v if v > 0 else default`.
- Analysis also gets `float_positive`, for `backtest.portfolio_position_weight` (recon.md:107), and `str_nonempty`, for `engine.fundamentals_blend_strategy_id` and `fundsignal.source_slug` (recon.md:105-106).
- Each helper calls `cfg.get_*`, so the existing MagicMock `side_effect` overrides still reach the read (recon.md:319-327). This includes `test_analysis_servicer.py:762-768`, the test behind feature-186 @AC-8 (recon.md:255).
- The default literal stays the single existing argument at each read. No new constant is added (DRY; recon.md:173-176).
- The floor is `> 0`, not `== 0`. `sleep(-n)`, `Semaphore(-1)` and a negative `memory_bytes` (`sandbox.py:282`, recon.md:42) are all hazards.

**3. Placement per service.**
- **Ingest.**
  - The properties at `watcher.py:187,200,204,210` call `int_positive(self, …)`: `max_concurrent_jobs`, `chunk_max_bars`, `chunk_window_days` and `max_concurrent_chunks` (recon.md:151-153).
  - `mcp_client_loop.py:133-138,162-167` call `int_positive(cfg, …)` with the named defaults from `:30-31` (recon.md:60-61, 154).
  - `max_retry_attempts`, `dedup_window_hours` and `retry_on_failure` stay unclamped (recon.md:155-156; feature-173 ingest @AC-1/2/3).
- **Indicators.**
  - The clamp sits inside `sandbox_timeout_ms`, `sandbox_memory_bytes` and `sandbox_max_concurrent()` (`watcher.py:134,138,148`; recon.md:140-142).
  - This covers the unclamped `servicer.py:303` → `sandbox.py:346` `RLIMIT_NPROC` path (recon.md:328-330) without a third copy of the defaults (recon.md:180-181).
  - `allowed_imports` stays `get_str_present` and is honoured (recon.md:143).
- **Analysis.**
  - Every recon FR-3 row is clamped (recon.md:101-117).
  - The recon "design" rows resolve to FR-3, with these effective defaults:

    | Key | Default | Source |
    |---|---|---|
    | `fundsignal.valid_days` | 90 | recon.md:130 |
    | `patterns.indicator_bucket_count` | 5 | recon.md:129 |
    | `opportunity.max_live_strategies_per_symbol` | 5 | recon.md:131 |
    | `opportunity.max_live_held_symbols_per_compute` | 20 | recon.md:131 |
    | `opportunity.max_live_only_symbols_per_compute` | 20 | recon.md:131 |
    | `opportunity.valid_window_hours` | 24 | recon.md:132 |
    | `opportunity.snooze_default_hours` | 24 | recon.md:133 |

  - `screener.default_rank_limit` (0 = uncapped) and `patterns.min_sample_count` (0 = keep all buckets) are honoured (recon.md:127-128).
  - Correction to recon.md:132: on the `servicer.py:4873` path, `readiness_valid_until` floors at 1 h (`services/readiness.py:35`), so 0 does not expire immediately there. The clamp to 24 stays for the `:5510` path and for consistency.
- **FR-4 reads need no edit.** `servicer.py:787-788,4615,4859` and `live_loop.py:351` are fixed by the getter switch alone (recon.md:98-100).
  - The feature-215 once-per-state-entry alert is gated by state before the throttle check (`live_loop.py:716-729` vs `:813-821`). This resolves recon.md:346-349: throttle 0 cannot double it.
- **Honour rows need no clamp.** `default_fill_model` (default 0) and the other rows at recon.md:118-126 stay unclamped (FR-5).
- **Dead sandbox helpers are removed**, together with their test-only references:
  - analysis `watcher.py:150-162` (refs `tests/test_analysis_servicer.py:598-606`; recon.md:34-35)
  - ingest `watcher.py:166-180` (refs `tests/test_ingest_servicer.py:1125-1137`; recon.md:68, 157)

**4. `max(1, …)` read-site wrappers are replaced by the clamp.**
- The exhaustive list:
  - `servicer.py:538,543,549,556,585,1158,2914`
  - `entry_backfill.py:57`
  - `screener.py:85`
  - `fundsignal_loop.py:137-138,148-151`
  - `mcp_client_loop.py:133-138,162-167`
  - indicators `servicer.py:102`, now covered by the accessor
- At each of these sites `int_positive(...)` replaces the wrapper (recon.md:103-104, 108-109, 154). `max(1, int_positive(...))` would be dead code.
- The present-aware `retry_seconds` wrappers stay exactly as they are: `fundsignal_loop.py:143` (keyword `default=300`), `:154` (positional `300`), and `servicer.py:5890,6066` (recon.md:134). A stored 0 there still gives 1 s, which preserves feature-156 @AC-4 and feature-158 @AC-9 (recon.md:252-253) and keeps the `028:64,67` description true.
- Consumer-side floors stay, because they are a separate contract: `readiness.py:35`, `bucket_pnl_factors` `servicer.py:387` (recon.md:129) and `backfill_chunks.py:51-52` (recon.md:58-59).
- **Deviation from FR-3 as approved (C-18):** at the converted sites, a stored negative now gives the default, not 1. The pinned test `test_retention_clamped_to_at_least_one` (`test_analysis_servicer.py:2527-2541`) flips from -5 → 1 to -5 → 20. product-spec.md FR-3 is amended to match.

**5. Inline clamps are converted.**
- `servicer.py:4545-4549` (`read_db_budget_ms`) and `:4701-4705` (`live_enrich_timeout_ms`) are `v <= 0 → _DEFAULT_*` today (recon.md:119, 174).
- Both become `int_positive(...)` and move to `FR3_KEYS`. Behaviour is identical, and only one clamp idiom remains.

**6. Single named readers for multi-module keys.** These follow the `blend_strategy_id(cfg)` pattern (`servicer.py:353-355`; recon.md:105).
- `default_cooldown_days(cfg)` lives in `servicer.py`.
  - Readers: `servicer.py:1167,2130` and `live_loop.py:748` (recon.md:112).
  - `live_loop.py:38` already imports from `app.handlers.servicer`.
- `fundsignal_source_slug(cfg)` lives in `fundsignal_loop.py`.
  - Readers: `fundsignal_loop.py:171` and `live_loop.py:162` (recon.md:106).
  - There is no import cycle: `fundsignal_loop` imports only `durable_schedule`/`identity` (`:30-31`), and `main.py:180` imports it lazily.
- `valid_window_hours` (`servicer.py:4873,5510`) and `signal_rank_weight` (`:4615,4859`) keep both readers inline in one file. Guard rule 4 catches default drift for them.

**7. Guard test.** Each Python service gets one `tests/test_config_read_classification.py`, which AST-scans `app/**/*.py`.
- Calls it collects:
  - **Read names:** `get_int`, `get_float`, `get_str` and the three `*_present` aliases, on any receiver.
  - **Clamp names:** `int_positive` in all three services, plus `float_positive` and `str_nonempty` in analysis. The clamp `def` bodies themselves are skipped.
- Argument binding:
  - Reads bind `args[0]`/`args[1]` or `key=`/`default=`. Clamps bind `args[1]`/`args[2]` or the keywords.
  - A missing default resolves to the signature default.
  - An unbindable call fails the test. This covers `fundsignal_loop.py:137,143,149,162` and indicators `watcher.py:143`.
- Rules:
  1. The key is a string constant.
  2. The set of read keys equals `HONOUR_KEYS` exactly, and the set of clamp keys equals `FR3_KEYS` exactly. Both directions count.
  3. `HONOUR_KEYS` and `FR3_KEYS` are disjoint.
  4. Each key has one distinct default across all its readers, compared with `ast.unparse` after binding.
  5. An `HONOUR_KEYS` member matching `max_concurrent|timeout|interval|budget|max_universe|_per_cycle|_ms$|_seconds$` needs an entry in `ZERO_IS_LEGIT = {key: reason}`. Examples: `alert_throttle_seconds`, `retry_seconds`, `startup_jitter_seconds`, `max_retry_attempts`, `dedup_window_hours`, `live_enrich_ttl_seconds`.
  6. Every `FR3_KEYS` member appears as a literal in at least one non-guard test file.
- `get_bool` is out of scope.
- The guard is a tripwire, not proof. Runtime proof is the AC-6 real-snapshot rows (fails.md:2660).
- The set contents come from recon.md:94-157 plus the resolutions above. `/sdd-spec` emits them as an explicit table.

**8. Comments.**
- Each hazard comment names a symbol, never a line number, for example `# >0: Semaphore(0) deadlocks IngestServicer._backfill_sem`. This fixes the stale `:191`/`:519` cites at ingest `watcher.py:185-186,208-209` (recon.md:342-343).
- The `default_fill_model` comment (`servicer.py:789-790`) is rewritten, not deleted, to say 0 = legacy whether stored or absent (recon.md:212-213; fails.md:1877).

**9. Tests.**
- Real-snapshot fixtures (recon.md:182-187):
  - analysis `_StubWatcher` (`test_analysis_servicer.py:483-490`)
  - ingest `_int_watcher` (`test_config_watcher.py:50`)
  - indicators `_str_watcher` (`test_config_watcher.py:51-56`), extended with int and float arms
- AC-5 constructs `IngestServicer(w, MagicMock(), MagicMock(), db_pool=None)` with a real watcher. `_backfill_sem` is built in `__init__` (`servicer.py:323`), so assigning `svc._cfg = w` afterwards cannot observe it (recon.md:188-189).
- Loop doubles: recon.md:192-198. Indicators semaphore assertion: recon.md:190-191.
- Tests rewritten on purpose:
  - the trap-pinning test `test_analysis_servicer.py:587-594` (recon.md:344-345)
  - `test_retention_clamped_to_at_least_one` (`:2527-2541`)
- `/sdd-spec` runs the full analysis, ingest and indicators suites and lists every cfg double it fixes. Analysis has about 113 `MagicMock` stubs, and a bare-`MagicMock` return trips `v > 0` (fails.md:1395).

**10. Acceptance (C-15).** `acceptance.feature` holds AC-1..AC-9 (`:7-128`). `/sdd-spec` adds the following.
- 18 @AC-6 rows, giving the effective value at a stored 0 / `""`:

  | Key | Effective value |
  |---|---|
  | `strategy.max_concurrent_entry_backfill` | 4 |
  | `backtest.portfolio_max_concurrent` | 9 |
  | `series.max_concurrent_components` | 4 |
  | `opportunity.max_concurrent_candidates` | 4 |
  | `compute.max_worker_threads` | 4 |
  | `readiness_materializer.max_concurrent_bars_fetches` | 2 |
  | `screener.max_concurrent_formula_evals` | 4 |
  | `fundsignal.source_slug` (`""`) | `"fundamentals"` |
  | `fundsignal.max_symbols_per_run` | 200 |
  | `fundsignal.valid_days` | 90 |
  | `snapshot.signal_timeout_ms` | 500 |
  | `patterns.indicator_bucket_count` | 5 |
  | `opportunity.max_live_strategies_per_symbol` | 5 |
  | `opportunity.max_live_only_symbols_per_compute` | 20 |
  | `opportunity.max_live_held_symbols_per_compute` | 20 |
  | `opportunity.valid_window_hours` | 24 |
  | `opportunity.snooze_default_hours` | 24 |
  | `ingest.mcp_client.request_timeout_seconds` | 30 |

  Rows for `read_db_budget_ms` and `live_enrich_timeout_ms` are added as well (guard rule 6).
- @AC-10 @FR-1: an explicit zero survives the `WatchConfig` wire. The test encodes through `ConfigServiceService`, not a hand-built encode. `toProtoSnapPayload` covers both SNAPSHOT and DELTA (recon.md:72-73, 302-307).
- @AC-11 @FR-6: the description-only migration changes no value, and the down migration restores the old text. This is distinct from the existing @AC-8 @FR-6.
- @AC-12 @FR-1: `default_rank_limit` and `min_sample_count` honour a stored 0.

**11. Config service (FR-6).**
- No `SCALAR_BOUNDS_REGISTRY` change and no new keys. Every `minValue: 1` and `minValue: 0` row is kept (recon.md:291-292).
- Correct the comments at `configServiceImpl.ts:109-117`.
- @AC-8 adds an `OPP_CONC = 0` rejection case, modelled on `setConfigScalarBounds.test.ts:173-195` (recon.md:199-202).

**12. Migration.** One new description-only pair in `services/xstockstrat-config/migrations/` (recon.md:277-285).
- It uses the `029_heal_config_keys_full_dotted.up.sql` shape (recon.md:203-206).
- Every `UPDATE` has the form `… SET description = <new> WHERE namespace = … AND key = <full dotted> AND description = <exact old text>`. The down migration reverses each one.
- Rows covered:
  - `028:46,49` (`signal_rank_weight`, "0 is not honored")
  - `027:50,53` ("get_int zero-trap collapses it")
  - `028:88,91,94,97` ("get_int, max(1,...)")
- It changes no value, so feature-184 @AC-2/@AC-3 hold. No audit row is written, no DELTA is broadcast, and 027/028 are never edited (F-01).
- `028:100,103` (`sparkline_bars`) is excluded because it has no analysis reader (recon.md:377). That drift is logged in `services/xstockstrat-config/docs/context-constitution-findings.md`.
- Numbering: there is no hard 243/244 ordering. Immediately before merge, `/sdd-execute` re-lists `origin/main-dev` and numbers the pair `max+1` (the tip is `030`, recon.md:76-77). A new `merge-order.md` row records the rule.

**13. Rollout.** Before each deploy (dev, then prod), run these checks and record the results in context.md:
- audit the stored `0`/`''` rows in the three namespaces (recon.md:331-333)
- run the malformed-int query `value_type='int' AND value_data !~ '^-?[0-9]+$'` (`parseInt` → NaN → a present 0, `configServiceImpl.ts:582`)
- confirm `value_type=float` for commission/slippage and `int` for `alert_throttle_seconds`
- re-run the FR-5 seed audit after 243's heal (recon.md:334-341; `001:62-63` and `002:61-62` seed no zeros)

Then run the dev smoke test: set `signal_rank_weight=0` and check the `list_opportunities` order.

**14. Consumer surfaces (C-14).** The changes reach users through pass-through only, with no consumer code change (recon.md:410-413):
- agent `run_backtest` (FR-4 zero-cost) and `list_opportunities` (zero rank weight)
- agent `set_config`, which needs `create_key=true` for the unseeded FR-4 keys (recon.md:288-290)
- the `/insights` backtest view
- the `/trader` AlertStream and the `/accounts/notifications` inbox (throttle 0)
- the `/config-ui` key descriptions, via the §12 migration

**15. Docs and teardown.**
- Files to update (recon.md:361-369):
  - analysis `CLAUDE.md` rows that say "use `get_*_present`, never `get_*`" or "`get_int` zero-trap"
  - ingest `CLAUDE.md:124,127,130-133`
  - indicators `CLAUDE.md:100-103`
  - the `config-governance.md` Fix Scope lines
  - the three `context-constitution.md` entries
- Close the dead-helpers defect in `services/xstockstrat-ingest/docs/context-constitution-findings.md`.
- Run the context-forge refresh.

## Rejected Alternatives

- **Watcher-method clamp (`get_int_positive` etc.).** Rejected because un-spec'd `MagicMock` doubles swallow the new attribute and cut off per-test overrides, including the test behind feature-186 @AC-8.
- **Per-site `if v <= 0: v = _DEFAULT` blocks.** Rejected because that means about 40 sites, each needing a new constant or a repeated literal (DRY guard rail). The two existing inline blocks are converted for the same reason.
- **Deleting the `*_present` aliases and repointing 32 reads.** Rejected as churn with no behaviour gain, now that the guard scans the aliases.
- **Converting every cfg double to `MagicMock(spec=ConfigWatcher)`.** Rejected because it touches about 20 test files, and every override would still need retargeting.
- **Per-key `SCALAR_BOUNDS` `minValue: 1` instead of read clamps.** Rejected because bounds apply only on write (`configServiceImpl.ts:99`), and FR-6 and feature-184 @AC-4/@AC-8 forbid changing them.
- **A floor that clamps only `== 0`.** Rejected because negatives still busy-loop or raise (`sleep(-n)`, `Semaphore(-1)`, a negative `memory_bytes`).
- **No corrective migration.** Rejected because `/config-ui` would keep telling operators that 0 is ignored (028:46) or collapses (027:50).
- **Hard merge order (243 strictly before 244).** Rejected because it couples two independent features. Renumbering to `max(origin/main-dev)+1` before merge gives the same C-07 safety.
- **Keeping the read-site `max(1, …)` wrappers with a constraint comment.** Rejected because negative handling would then differ from site to site.
- **`max(1, int_positive(...))`.** Rejected because the outer `max` is dead code: `int_positive` never returns ≤ 0 for a positive default.
- **Converting the present-aware `retry_seconds` wrappers to `int_positive`.** Rejected because a stored 0 would change from 1 s to 300 s, against recon.md:134, feature-156 @AC-4, feature-158 @AC-9 and the 028:64,67 description.
- **Putting `default_cooldown_days` in `app/services/cooldown.py`.** Rejected because that module promises no DB/gRPC/proto imports (`cooldown.py:3`), and `int_positive` lives in a watcher module.
- **One shared guard script under `scripts/`.** Rejected because it moves the check out of each service's CI job. The three per-service copies trip no jscpd hook anyway, since `**/tests/**` is ignored (`.jscpd.json:27`).
- **A whole-snapshot runtime sweep instead of the AST guard.** Rejected because the analysis fixtures are heavy. Guard rule 6 ties the guard to the runtime rows instead.

## Open Risks

- [ ] **Wire-level zero is unproven at runtime.** If the ts-proto encoder dropped a zero-valued oneof member, `HasField` would read "unset" and FR-4 would stay broken while the Python unit tests pass. To be addressed at: the @AC-10 test, which encodes through `ConfigServiceService` (`/sdd-spec` config step), and the dev `signal_rank_weight=0` smoke test (rollout).
- [ ] **The guard's sets are only as correct as the classification they freeze.** A hazard key that has a single reader and whose name misses the rule-5 regex can still be pinned in `HONOUR_KEYS` by mistake. To be addressed at: `/sdd-spec`, which emits `HONOUR_KEYS`/`FR3_KEYS`/`ZERO_IS_LEGIT` as an explicit table, and impl-spec review, which audits each entry.
- [ ] **Negatives change behaviour silently.** At the converted `max(1, …)` sites, a negative now gives the default, not 1, and no @AC pins this. To be addressed at: the record in the C-18 deviation, the FR-3 amendment and the `test_retention_clamped_to_at_least_one` flip (analysis clamp step).
- [ ] **Stored data changes on deploy.** Rows already stored as 0/`''`, and malformed int rows (NaN → a present 0), change behaviour when this deploys. Recon had no DB access. To be addressed at: the pre-deploy audit on dev, then prod, with results recorded in context.md (rollout).
- [ ] **Type-mismatched FR-4 rows still fall back.** An unseeded FR-4 row with the wrong type (an `int_val` read by `get_float`) still resolves to the default under FR-2. To be addressed at: the rollout `value_type` check, and the agent `set_config` guidance in the docs step.
- [ ] **Migration renumbering depends on a re-list.** If `/sdd-execute` skips re-listing `origin/main-dev` before merge, golang-migrate silently skips a lower-numbered pair. To be addressed at: the migration step's pre-merge check and the `merge-order.md` row.
- [ ] **Bare-`MagicMock` cfg returns raise `TypeError` at `v > 0`.** To be addressed at: `/sdd-spec`, which runs the full suites and lists every double it fixes.
- [x] **The feature branch keeps being deleted.** Resolved 2026-10-21: renamed to `fix-python-config-stored-zero`. The slug collides with launched feature 173, so the orphan cleanup deletes `feature/fix-python-config-zero-trap` on every push to `main`. The glob at `.github/workflows/ci-validate-feature-status.yml:167` resolves to 173's `status.md`, and the delete happens at `:183`. To be addressed at: the operator slug rename, which must happen before `/sdd-spec` pushes.

## Constitution Rules Touched

- `C-01` — honoured. Each claim cites recon.md or a path:line verified in round 3. Two prior claims were corrected: the alias count is 32, and the on-disk acceptance holds AC-1..AC-9. Code comments name symbols, not lines.
- `C-02` / `P-05` — honoured. This design.md and the context.md `/sdd-design` session entry are written in the same step as approval.
- `C-07` — honoured. One numbering rule applies: re-list `origin/main-dev` before merge and number the pair `max+1`, recorded in a `merge-order.md` row.
- `C-08` / `P-06` — honoured. The module-level clamp keeps the MagicMock overrides reaching their reads. The pinned tests at `:587-594` and `:2527-2541` are rewritten on purpose and listed.
- `C-11` — honoured. Full mode, 3 rounds (minimum 2), no blocking objection, no Floor breach and no CHANGE to an existing @AC.
- `C-14` — honoured. The consumer surfaces are named in §14 (pass-through).
- `C-15` — honoured. AC-1..AC-9 are kept. `/sdd-spec` adds the AC-6 rows and AC-10..AC-12.
- `C-16` — honoured. Every durable rule is PRESERVE (below).
- `C-18` — honoured. The negatives deviation, the retention-test flip and the FR-3 amendment are recorded in context.md, product-spec.md and feature.md.
- `P-02` — honoured. Only the mediator synthesis reached the downstream rounds. The rulings on `retry_seconds`, argument binding, guard rules 5/6 and the inline-clamp conversion are binding.
- `P-03` — honoured. Every round-3 objection was answered or adopted.
- `F-01` — honoured. 027/028 are untouched, and a new description-only pair is added.
- `F-04` — honoured. The new symbols (`int_positive`, `float_positive`, `str_nonempty`, `default_cooldown_days`, `fundsignal_source_slug` and the guard file) are additions this design makes.
- `F-07` — honoured. No new literals: each default stays the single existing argument, and guard rule 4 enforces one default per key.
- DRY guard rail — honoured. The getters are aliased, one clamp idiom is used, and the multi-module keys have single named readers.

## Business Rules Touched (C-16)

No CHANGE to any existing @AC rule. The operator decision "Fix the getters + audit" (context.md, Operator decisions, 2026-10-20) covers this feature's own EXTENDs.

Durable suites:
- PRESERVE `@AC-1 @FR-2 @feature-173` "A stored max_retry_attempts of 0 makes zero retry attempts, not the default 3" (`services/xstockstrat-ingest/acceptance/fix-python-config-zero-trap.feature`). Not regressed: the key stays an unclamped alias read in `HONOUR_KEYS` (recon.md:229).
- PRESERVE `@AC-2 @FR-2 @feature-173` "A stored dedup_window_hours of 0 disables the dedup window, not the default 24" (same file). Not regressed: it stays unclamped (recon.md:230).
- PRESERVE `@AC-3 @FR-1 @FR-3 @feature-173` "The present-aware accessor honors a present zero and still defaults when unset" (same file). Not regressed: `get_int_present` is kept as an alias, so the wording stays true (recon.md:231).
- PRESERVE `@AC-4 @FR-2 @FR-3 @feature-173` "An empty allowed_imports denies all sandbox imports…" (`services/xstockstrat-indicators/acceptance/fix-python-config-zero-trap.feature`). Not regressed: `allowed_imports` is not clamped (recon.md:232).
- PRESERVE `@AC-1/@AC-2/@AC-3/@AC-4/@AC-5/@AC-8 @feature-184` (`services/xstockstrat-config/acceptance/opportunity-config-operability.feature`). Not regressed: no bound changes, and the migration changes descriptions only (recon.md:233-238).
- PRESERVE `@AC-2/@AC-4/@AC-8/@AC-9 @feature-182` (`services/xstockstrat-config/acceptance/readiness-materializer-config-keys.feature`). Not regressed: 027 is never edited, no bounds are added and the clamps sit at the read (recon.md:239-242).
- PRESERVE `@AC-7/@AC-11/@AC-12 @feature-161` (`surface-signal-weight-decay-config.feature`). Not regressed: the reader is already present-aware and the bounds are unchanged (recon.md:243-244).
- PRESERVE `@AC-4/@AC-9/@AC-10 @feature-151` (`services/xstockstrat-analysis/acceptance/backtest-next-bar-fill.feature`). Not regressed: the `default_fill_model` change is comment-only (recon.md:245-246).
- `@AC-1/@AC-2 @feature-151` (same file): recon.md:247 proposed EXTEND with a stored-slippage-0 case. The debate carries that case as 244 @AC-2. The promotion target is settled at launch (C-16).
- PRESERVE `@AC-3/@AC-6/@AC-7 @feature-150` (`backtest-portfolio-sizing.feature`). Not regressed: `portfolio_position_weight` 0 → 0.10 and `default_cooldown_days` 0 → 31 through `float_positive` and `default_cooldown_days(cfg)` (recon.md:248-250).
- PRESERVE `@AC-1/@AC-2/@AC-4/@AC-7 @feature-156` (`fix-fundamentals-signal-producer.feature`). Not regressed: `run_interval_hours` 0 → 24, and the `retry_seconds`/jitter present-aware wrappers are kept unchanged per the mediator ruling (recon.md:251-252).
- PRESERVE `@AC-7/@AC-8/@AC-9 @feature-158` (`durable-loop-scheduler.feature`). Not regressed: the `retry_seconds` wrappers at `servicer.py:5890,6066` and `refresh_hour_utc` 0 are untouched (recon.md:253).
- PRESERVE `@AC-4/@AC-5 @feature-168` and `@AC-4/@AC-6/@AC-8 @feature-186` (blend strategy). Not regressed: `blend_strategy_id` reads through `str_nonempty`, which calls `cfg.get_str`, so the `test_analysis_servicer.py:762-768` override still reaches the read (recon.md:254-255).
- PRESERVE `@AC-3/@AC-6/@AC-9 @feature-154` (`fundsignal-watchlist-universe.feature`). Not regressed: `explicit_symbols` `""` is honoured and `max_symbols_per_run` 0 → 200 (recon.md:256-257).
- PRESERVE `@AC-10 @feature-190` "Conviction sort is the default ordering" (`opportunities-server-side-filters.feature`). Not regressed: a stored 0 rank weight still equals the CONVICTION order (recon.md:258).
- PRESERVE `@AC-1/@AC-2 @feature-176` (analysis) and `@AC-5 @feature-176` (indicators). Not regressed: the concurrency keys clamp to their defaults, never `Semaphore(0)` (recon.md:259, 263).
- PRESERVE `@AC-4 @feature-180` (recon.md:260), `@AC-3/@AC-6 @feature-042 @feature-225` and `@AC-14 @feature-225`. Not regressed: `snapshot.*_timeout_ms` 0 → 500, and `min_sample_count` is honoured as before (recon.md:261-262).
- PRESERVE `@AC-3/@AC-5/@AC-6 @feature-209` and `@AC-2/@AC-3/@AC-5 @feature-228` (indicators sandbox). Not regressed: the accessor clamp covers `servicer.py:303`/`RLIMIT_NPROC`, and the sandbox still receives `memory_bytes` directly (recon.md:264-265).
- PRESERVE `@AC-3/@AC-5 @feature-166` (`mcp-client-signal-source.feature`). Not regressed: the poll and timeout clamps go to 30/300 (recon.md:266).
- PRESERVE `@AC-6`, `@AC-35` and `@AC-36 @feature-224` (`docs/sdd/business-rules/platform.feature`). Not regressed: `scoring_formula_id` `""` is honoured and `source_slug` `""` → `fundamentals` through `fundsignal_source_slug(cfg)` (recon.md:267-269).
- PRESERVE `@AC-8/@AC-9 @feature-215` (`block-fundamentals-strategy-on-etf.feature`). Not regressed: the fundamentals-unavailable alert is state-gated before the throttle (`live_loop.py:716-729` vs `:813-821`).
- PRESERVE `xstockstrat-ui` `fix-copilotrail-duplicate-rpc.feature:14` (default sort). Not regressed: the UI always sends an explicit sort.

This feature's own scenarios (`acceptance.feature`):
- PRESERVE `@AC-1`, `@AC-2`, `@AC-3`, `@AC-4`, `@AC-5`, `@AC-7`, `@AC-8` and `@AC-9`. They are implemented as written.
- EXTEND `@AC-6 @FR-3`: the 18 rows plus the `read_db_budget_ms`/`live_enrich_timeout_ms` rows (§10). Covered by the operator decision "Fix the getters + audit".
- EXTEND, new `@AC-10 @FR-1` (wire zero), `@AC-11 @FR-6` (description migration) and `@AC-12 @FR-1` (honour sites take 0). Covered by the same operator decision.

## Rounds

- **Round 1** — full mode. Blocking objections:
  - The watcher-method clamp breaks un-spec'd MagicMock overrides.
  - Migration `032` is not last+1 (243 claims `031`).
  - Round 1 cannot be approved under the standing authorization.

  Non-blocking objections: the C-15 acceptance gap, the retention-test flip, the AC-5 construction pattern, the guard test, the constraint comments, the alias docs, the FR-4 type mismatch, and the `pg_notify` assumption.
- **Round 2** — the proposer adopted the module-level clamp and the mediator's single numbering rule. One new blocking objection: the guard ignored the `*_present` aliases. Non-blocking objections: the negatives deviation, single readers for multi-module keys, line-number comments, the malformed-int audit, the `readiness.py:35` correction, and folding 027 into the migration.
- **Round 3** — the r2 blocker was closed: the guard now scans six names, uses two disjoint sets, requires literal keys and checks default drift. The mediator adopted:
  - the exhaustive `max(1, …)` list (`retry_seconds` kept)
  - positional/keyword argument binding
  - guard rules 5 and 6
  - the inline-clamp conversion
  - the FR-3 amendment
  - the `sparkline_bars` findings entry

  P-05 persistence was downgraded to a gate condition and is discharged by this file and the context.md entry.
- **Termination:** auto-approved under the operator's standing authorization on 2026-10-21. Rounds 3 ≥ 2, no Floor breach, no blocking objection, and every EXTEND is covered by an operator decision.

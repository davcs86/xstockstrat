# Design: fix-fundsignal-emit-accounting

**Created**: 2026-10-22
**Rounds**: 2 (full; termination: approved)
**Approved by**: user @ 2026-10-22 (operator design gate r2: "APPROVED as synthesized"; Floor clear)
**Grounded in**: recon.md

---

## Chosen Approach

Scope is D-43 and D-57 only (Track C, SEV-2). The whole fix lives in `xstockstrat-analysis`:
`services/xstockstrat-analysis/app/engine/fundsignal_loop.py` and `tests/test_fundsignal_loop.py`.
There is no migration, no ingest code change, and the only wire edit is a proto comment. OQ-1 is
resolved as "NULL `signal_id` = in-flight claim, released on failure". OQ-2 is resolved as "a
date-anchored `valid_until` for non-force runs". The Fix Scope migration box is resolved as **no
migration**.

**Consumer surfaces (C-14).** The Agent tool `run_fundamentals_scan` (`services/xstockstrat-agent/app/tools.py:1412`)
and the UI page `config-ui/fundamentals-scan/page.tsx:101,106` show `summary.status` and `deferredCount` as they
arrive (recon.md:76-79). They need no code change and pick up the new `"partial"` value and the corrected counts
automatically. Only their docs change (step 7).

### 1. D-57 / FR-4: failed fetch chunks are reported (@AC-4, @AC-6)

- `_paced_fetch` (`:381-407`, recon.md:46-48) adds each failed chunk's symbols to a `failed` list inside its
  existing per-chunk `except` (`:401-402`). It returns `(fetched, deferred, failed, calls)`.
- `run_once` passes `deferred_count = len(deferred) + len(failed)` to both `_finish` (`:286-293`) and
  `_abort_cycle` (`:270-278`) (recon.md:41-43). `symbols_processed` still counts only fetched symbols.
- Status is chosen in this order:
  - `"partial"` if any chunk failed;
  - else `"budget_deferred"` if any symbols were deferred;
  - else `"completed"`.

  The status column has no CHECK constraint (`migrations/003_fundsignal_runs.up.sql:9`, recon.md:57-58), so
  `"partial"` needs no migration.
- One `_emit_warning` (`:281-285`) names the failed-chunk count, the budget cutoff, or both. `_finish`,
  `_abort_cycle` and `_emit_warning` keep their signatures.

### 2. D-43 / FR-1, FR-3: release the claim on any non-confirmed exit (@AC-1, @AC-3, @AC-5)

- **Claim INSERT unchanged.** The claim INSERT (`:242-256`, recon.md:36-37) keeps
  `ON CONFLICT (symbol, source, as_of_date) DO NOTHING`. It is the in-flight fence against the manual
  `RunFundamentalsScan` (`servicer.py:3812`/`:3832`, recon.md:23), which does not take `self._lock`.
- **Release on any unconfirmed exit.** After a successful claim, set `confirmed = False` and wrap the emit and
  confirm in `try/finally`. The `finally` issues the release only when `not confirmed`. The release covers:
  - `_emit_signal` returning `None` (`:547-548`);
  - `_SystemWriteRejected`;
  - any other exception;
  - `CancelledError`.

  The success path makes no extra DB round-trip (C-18).
- **Release SQL.** It mirrors the force DELETE shape at `:210-216` (recon.md:32):
  `DELETE FROM analysis.fundsignal_emitted WHERE symbol=$1 AND source=$2 AND as_of_date=$3 AND signal_id IS NULL AND run_id=$4::uuid`.
- **Release error handling.** The release runs inside an inner `try/except Exception` that logs and swallows.
  - It never catches `BaseException`, so the original `_SystemWriteRejected` or `CancelledError` still propagates.
  - `_SystemWriteRejected` still reaches the existing `except` at `:270`. The abort flow and the confirmed rows
    @AC-5 keeps are unchanged.
- **Confirm UPDATE.** The confirm UPDATE (`:260-268`, recon.md:38-39) gains `AND run_id=$5::uuid AND signal_id IS NULL`,
  the same predicate as the release. A stale run can then never overwrite a concurrent force run's re-claim, or a
  row that is already confirmed.
- `confirmed = True` is set once the UPDATE has executed, whether or not it matched a row.

### 3. D-43 / FR-2: count accepted signals only (@AC-2)

- `emitted += 1` moves inside the `if signal_id` branch, after the confirm UPDATE has executed. Today it is
  unconditional at `:269` (recon.md:38-39). The count does not depend on whether the UPDATE matched a row.
- A `deduplicated=true` response that carries a `signal_id` counts as accepted (trap `fails.md:2627-2640`,
  recon.md:195-197).
- If the UPDATE raises after ingest accepted the signal, the `finally` releases the claim and the exception
  propagates as it does today. The next non-force run re-emits with the date anchor, ingest deduplicates, and that
  run confirms.

### 4. Direction stability across retries

- **One query for skip set and prior scores.** `_already_emitted` (`:373-379`, recon.md:44-45) becomes one query,
  `SELECT symbol, score ... WHERE source=$1 AND as_of_date=$2`, which returns `{symbol: score}`. The skip predicate
  at `:218-219` (recon.md:33) is unchanged: every existing row, NULL or confirmed, is still skipped.
- **Recon's narrowing is rejected.** Recon recommended narrowing the skip to `signal_id IS NOT NULL`
  (recon.md:105, :180, :238). That is **rejected** (see Rejected Alternatives).
- **Day-wide cuts.** `_map_directions` (`:470-485`) gains an optional `reference_scores` argument.
  - Cuts are computed over `prior.values() ∪ scores.values()`, but directions are mapped only for `scores`.
  - This is required for FR-1: on a one-symbol retry universe, `_quantile` gives `buy_cut == sell_cut`, so the
    symbol always comes out `"buy"` (recon.md:193-194). Direction is part of ingest's conflict key.
- **Force runs.** These are unaffected: `prior` is empty because their rows are deleted first (`:210-216`).

### 5. `valid_until` anchor depends on the run mode (OQ-2)

- `_emit_signal` (`:520-525`, recon.md:50-52) gains a `valid_anchor: datetime` argument and sets
  `valid_until = valid_anchor + timedelta(days=valid_days)`. `valid_from` stays `now`.
- `run_once` computes the anchor once, next to `as_of_date` (`:172`, recon.md:31):
  - `force=True` → `datetime.now(UTC)`. This is today's behaviour, so "force re-emits"
    (`services/xstockstrat-analysis/CLAUDE.md:123`) stays true.
  - `force=False` → `datetime.combine(as_of_date, time.min, UTC)`. This matches the contract already documented at
    `services/xstockstrat-analysis/CLAUDE.md:512` ("`valid_until` = run date + this"), so it corrects drift rather
    than changing behaviour.
- Add one inline constraint comment of at most 2 lines at the anchor computation, warning against unifying the two
  modes.
- **Effect.** A non-force retry after a lost-but-committed response sends the same `valid_until`. Ingest's dedup
  claim (`ingest servicer.py:1039-1084`, recon.md:62-72) then absorbs it as long as conviction is unchanged and
  `ingest.signals.dedup_window_hours > 0`.

### 6. Tests

These reuse the existing helpers `_identity_loop`, `_rpc_error`, `_make_loop` and the 120-symbol/50-chunk shape
(`test_fundsignal_loop.py:45,526,532,157`, recon.md:83-92). The table fake is an inline dict-backed
`fundsignal_emitted` fake, kept inline because it has a single consumer (C-13).

- Cover @AC-1..@AC-10.
- Add one `local_pg` real-SQL test (`tests/conftest.py:368`, recon.md:94-95): claim → failed emit → release →
  re-claim → confirm, including the run_id-scoped confirm (C-08).
- Add a crash-orphan recovery test: a NULL row with a foreign `run_id` is skipped for the rest of the day, then
  recovered by `force=true` and by the next `as_of_date` (`fails.md:2689-2691`).

### 7. Proto and docs

- **Proto.** Add `"partial"` to the comment at `packages/proto/analysis/v1/analysis.proto:564` (recon.md:73-74).
  This is a comment-only edit with no breaking-proto gate. Then re-run `./scripts/buf-gen.sh` (C-09,
  proto-freshness).
- **`services/xstockstrat-analysis/CLAUDE.md:122-123`:**
  - add the `partial` state;
  - replace the stale "ingest does **not** dedup" sentence (recon.md:171);
  - document the NULL-claim/release semantics;
  - document the force vs non-force anchor;
  - document the crash-orphan carve-out.

  The `:512` `valid_days` row is already correct.
- **`docs/runbooks/mcp-tools.md:845`:** add `partial`.
- The context teardown audit is owed before the PR.

### 8. C-03 and the operator trace directive

- **Scan path.** `RunFundamentalsScan` keeps passing `sys_meta` (`:175-178`), which carries the inbound
  `x-trace-id`.
- **Loop path.** The loop calls `run_once(metadata=())` (`:147`). It has no originating request, so the operator
  directive allows it to mint its own context. **It carries no `x-trace-id` today, and this is recorded as
  deliberate.**
- **Optional trace id.** Deriving an `x-trace-id` from `run_id` on loop runs is optional, and only if peer
  `259-fix-python-loop-supervision` is not already doing it. Coordinate this at /sdd-spec; it is not added by
  default.
- The release DELETE and confirm UPDATE are local DB writes and add no new outbound edge.

### New acceptance scenarios (append to `acceptance.feature` at /sdd-spec)

@AC-1..@AC-6 already exist on `origin/feature/fix-fundsignal-emit-accounting`. The new scenarios are numbered
@AC-7..@AC-10:

- **@AC-7.** Confirmed same-day rows are skipped and `GetFundamentalsMulti` is called zero times. This covers the
  uncovered guarantee in recon.md:148.
- **@AC-8.** A non-force retry after a lost-but-committed response sends an identical date-anchored `valid_until`
  and the same direction. A `deduplicated=true` response counts toward `signals_emitted`.
  - The description must state that this holds **only** when `ingest.signals.dedup_window_hours > 0` and
    conviction is unchanged.
  - A marketdata cache refresh changes conviction and defeats the dedup.
- **@AC-9.** A one-symbol retry keeps the day's cross-sectional direction: a sell stays a sell.
  - The description notes that the `budget_deferred` resume uses the same day-wide cuts.
  - It also notes the boundary-flip approximation.
- **@AC-10 (mandatory).** `force=true` still sends a `now`-anchored `valid_until` and re-emits fresh. This pins the
  anchor asymmetry so that the C-16 guard catches any later attempt to unify the two modes.

### Merge order

`246-fix-fundsignal-neutral-score` merges first, then 260 rebases onto the shared `run_once` lines. Add the
`merge-order.md` row at /sdd-spec.

### Operator-visible scope effects (recorded EXTEND)

The reference-score cut in step 4 has side effects that D-43/D-57 do not name. Each is accepted as a recorded
EXTEND, because FR-1 is not correct without it:

1. The `budget_deferred` resume now uses day-wide cuts instead of cuts over its own small universe.
2. Non-force `override_symbols` manual scans now use full-day cuts: a 3-symbol override is cut against the whole
   day's scores.
3. Edge case: if `scoring_formula_id` changes mid-day, the reference set mixes scores from two formulas.

## Rejected Alternatives

- **Date-anchor `valid_until` for force runs too (r1 step 5).** Rejected: a same-day force re-emit would become a
  dedup no-op at ingest. That contradicts `analysis CLAUDE.md:123` and would need operator sign-off outside the
  D-43/D-57 scope.
- **Move idempotency into ingest** (an `idempotency_key`, or `as_of_date` in the dedup key). Rejected: it turns
  ingest `@AC-9/@feature-224`, `@AC-4/@feature-166` and `@AC-2/@feature-173` into CHANGE, and needs a proto field
  plus a migration. That is too much rework for a SEV-2.
- **Release in an unconditional `finally`** (proposer r2 as written). Rejected: it costs one no-op DELETE
  round-trip per symbol through PgBouncer even on success (C-18). The `confirmed`-flag `finally` replaces it.
- **Release only in explicit `except` branches** (adversary r2 literal fix). Rejected: it misses `CancelledError`
  unless it catches `BaseException`.
- **Confirm UPDATE scoped by `run_id` only (r1).** Rejected: in narrow races a stale run could still overwrite a
  confirmed row. Adding `signal_id IS NULL` costs nothing.
- **Re-claim NULL rows with `ON CONFLICT DO UPDATE ... WHERE signal_id IS NULL`.** Rejected: the manual
  `RunFundamentalsScan` does not take `self._lock` (`servicer.py:3832` vs `fundsignal_loop.py:139-145`), so
  concurrent runs could steal each other's in-flight claims and double-emit.
- **Retry with the direction stored on the claim row.** Rejected: the release deletes the row, so keeping a
  failed-state row would need a new column and migration 028.
- **Narrow `_already_emitted` to `signal_id IS NOT NULL`** (recon.md:105/:180/:238, proposer r1). Rejected:
  - it breaks the in-flight DO-NOTHING fence;
  - it breaks the zero-cache-call guarantee;
  - it spends `GetFundamentalsMulti` budget on rows that DO NOTHING skips anyway.

  /sdd-spec must not re-introduce it.
- **Add a claim-state or claim-timestamp column (migration 028) for stale-claim takeover.** Rejected: it brings in
  the DBA/migration gate and a risk of batch-wide NNN renumbering, all for a crash-only edge case.
- **Map directions over the retry universe only.** Rejected: a one-symbol universe collapses the cuts and always
  gives `"buy"` (`:479`, `:631`). Since direction is in ingest's conflict key, that produces a contradictory
  sell+buy pair.

## Open Risks

- [ ] **Anchor unification.** A future change may "unify" the two anchor modes. Moving force runs to the date
  anchor would silently turn force re-emits into dedup no-ops.
  - Mitigation: mandatory @AC-10 plus the 2-line constraint comment.
  - Addressed at: the /sdd-spec anchor step and its test step.
- [ ] **Boundary direction flips on retry.** A retry's direction can flip at the cut boundary when
  `min_conviction_to_emit > 0` or some symbols failed scoring, because the reference set read from
  `fundsignal_emitted` is not the first run's full set. A flip lands as a second ingest row in the other
  direction.
  - Accepted; written into the @AC-9 description.
  - Addressed at: the /sdd-spec acceptance step.
- [ ] **Dedup defeated.** A mid-day marketdata cache refresh, or `ingest.signals.dedup_window_hours=0`, defeats the
  @AC-8 dedup and produces a duplicate row.
  - Accepted; stated as conditions in @AC-8.
  - Addressed at: the /sdd-spec acceptance step.
- [ ] **Lost force response.** If a force run's response is lost and a non-force retry follows the same day, the
  retry sends a different `valid_until` (date anchor instead of now anchor) and can create one duplicate row.
  - Rare; accepted.
  - Addressed at: docs (step 7).
- [ ] **Shorter non-force validity.** Non-force signals become valid for up to about 24h less
  (`as_of_date` 00:00 UTC + `valid_days`, instead of now + `valid_days`). This matches `CLAUDE.md:512`.
  - Addressed at: docs (step 7).
- [ ] **Crash-orphan carve-out.** A hard crash (SIGKILL/OOM) between claim and confirm, or a release DELETE that
  fails, leaves a NULL row.
  - The symbol is then skipped for the rest of the day (`:218-219`, DO NOTHING `:247`).
  - It is recovered on the next `as_of_date` or by `force=true` (`:211-215`).
  - Addressed at: the crash-orphan recovery test (step 6) and analysis CLAUDE.md (step 7).
- [ ] **Short chunks still drop symbols.** FR-4 covers only chunks that raise. A chunk that succeeds but returns
  fewer fundamentals than requested still drops symbols silently (recon.md:198-200).
  - Deferred to peer `255-fix-marketdata-fundamentals-cache`.
  - Addressed at: 255's design.
- [ ] **Merge conflict with 246.** 246 and 260 both edit the shared `run_once` lines.
  - 246 lands first and 260 rebases.
  - Addressed at: the /sdd-spec `merge-order.md` row.
- [ ] **Fake drift.** The dict-backed fake can drift from the real `ON CONFLICT` and the
  `run_id`/`signal_id`-filtered SQL.
  - Mitigation: the one `local_pg` test.
  - Addressed at: the test step (step 6).
- [ ] **Unverified ingest claims.** Two ingest properties rest only on the adversary's reading and must be
  re-confirmed before the acceptance step:
  - the dedup conflict key is `(user_id, source, symbol, direction)` and excludes `valid_from`
    (`servicer.py:1045`);
  - the signal insert and the dedup claim commit in one transaction (`:1017`).

  Addressed at: /sdd-spec re-verification.
- [ ] **Loop-path trace id.** Minting an `x-trace-id` from `run_id` for loop runs is optional. Coordinate with peer
  259 so it is not done twice.
  - Addressed at: /sdd-spec.

## Constitution Rules Touched

- `C-03` — honored by: request-derived emits on the `RunFundamentalsScan` path keep the inbound `sys_meta`
  (`x-trace-id`). The loop path has no originating request and mints its own context, as the operator directive
  (2026-10-21) allows. That trace-id-less path is recorded as deliberate, not as a gap.
- `C-08` — honored by: a real-SQL `local_pg` test of claim → release → re-claim → run_id-scoped confirm, alongside
  the fake-backed unit tests.
- `C-11` — honored by: a full 2-round debate, operator approval at the design gate, and Floor clear.
- `C-13` — honored by: reusing the existing test helpers. The `fundsignal_emitted` fake stays inline because it has
  a single consumer.
- `C-15` — honored by: new @AC-7..@AC-10 added to `acceptance.feature`, so every FR and every design guarantee has a
  scenario.
- `C-16` — honored by: the business-rule ledger below (PRESERVE/EXTEND only, no CHANGE). @AC-10 pins the anchor
  asymmetry.
- `C-18` — honored by: zero extra DB round-trips on the success path (the `confirmed` flag), and no new query per
  symbol, since `_already_emitted` is widened in place.
- `P-02` — honored by: the proposer and adversary were mediated each round through synthesis.
- `P-03` — honored by: every architectural claim is grounded in a recon.md citation or a re-verified code line.
- `PLAT-N1` — honored by: the release DELETE is best-effort (log and swallow `Exception`, never `BaseException`)
  and never masks the original error.
- Floor (F-*) — no breaches.

## Business Rules Touched (C-16)

No CHANGE lines. Every 260-local scenario falls under the binding operator decision "Scope is D-43, D-57"
(context.md, 2026-10-21) and the r2 gate approval (2026-10-22).

- EXTEND `@AC-1` (260) "failed emit retried same day" — new case: release-on-unconfirmed-exit, with day-wide
  direction cuts. Covered by the operator decision (scope D-43/D-57).
- EXTEND `@AC-2` (260) "signals_emitted counts accepted only" — new case: a `deduplicated=true` response with a
  `signal_id` counts. Covered by the operator decision.
- EXTEND `@AC-3` (260) "abort leaves no orphan claim" — new case: the `finally` release covers
  `_SystemWriteRejected` and `CancelledError`. Covered by the operator decision.
- EXTEND `@AC-4` (260) "failed chunk reported as partial" — new case: failed chunks are counted in
  `deferred_count`. Covered by the operator decision.
- EXTEND `@AC-5` (260) "abort keeps confirmed rows" — new case: the confirm is scoped by `run_id` and
  `signal_id IS NULL`. Covered by the operator decision.
- EXTEND `@AC-6` (260) "partial beats budget_deferred" — new case: the single combined warning. Covered by the
  operator decision.
- PRESERVE `@AC-7` (new) "confirmed same-day rows skipped, zero GetFundamentalsMulti calls" — new coverage for the
  existing `services/xstockstrat-analysis/CLAUDE.md:123` guarantee (recon.md:148). Not regressed, because the skip
  predicate is unchanged.
- EXTEND `@AC-8` (new) "non-force lost-response retry is deduplicated" — date-anchored `valid_until`. Conditional
  on `dedup_window_hours > 0` and unchanged conviction. Restores the documented `CLAUDE.md:512` contract, and falls
  inside the approved design.
- EXTEND `@AC-9` (new) "retry keeps the day-wide cross-sectional direction" — this includes the `budget_deferred`
  resume and non-force `override_symbols` effects recorded above. Accepted as an EXTEND at the r2 gate.
- PRESERVE `@AC-10` (new, mandatory) "force=true keeps a now-anchored valid_until and re-emits fresh" — pins
  today's force behaviour.
- EXTEND `@AC-26` "System-owned fundamentals signals are visible to every user"
  (`docs/sdd/business-rules/platform.feature`) — retried emits are still system-owned. Their cross-sectional
  direction is now computed against the day-wide reference set.
- PRESERVE `@AC-9` / `@feature-224` "Ingested signals belong to the source owner and dedup per owner"
  (`services/xstockstrat-ingest/acceptance/private-by-default-templates.feature`) — not regressed: there is no
  ingest change.
- PRESERVE `@AC-4` / `@feature-166` "MCP tool result is parsed into ExternalSignals and ingested"
  (`services/xstockstrat-ingest/acceptance/mcp-client-signal-source.feature`) — not regressed: there is no ingest
  change.
- PRESERVE `@AC-2` / `@feature-173` "A stored dedup_window_hours of 0 disables the dedup window"
  (`services/xstockstrat-ingest/acceptance/fix-python-config-zero-trap.feature`) — not regressed. @AC-8 explicitly
  does not promise dedup at window 0.
- PRESERVE `@AC-6` "A manual scan does not contaminate the scheduled cadence"
  (`services/xstockstrat-analysis/acceptance/fix-fundamentals-signal-producer.feature`) — `blocked_until_ms` is not
  touched, including on `"partial"` (recon.md:134).
- PRESERVE `@AC-3`, `@AC-4`, `@AC-5`, `@AC-9` (`@feature-154`)
  (`services/xstockstrat-analysis/acceptance/fundsignal-watchlist-universe.feature`) — the failed-chunk bucket
  changes only reporting, not universe membership (recon.md:142).

## Rounds

- **Round 1 (full).** The proposer kept the DO-NOTHING fence, narrowed `_already_emitted`, and date-anchored
  `valid_until` for every mode. The adversary blocked on two points:
  - one-symbol retry direction collapse, fixed with the reference-score cut;
  - a force-run dedup no-op that would need operator sign-off.
- **Round 2 (full).** The proposer moved to a mode-dependent anchor, which removed the sign-off blocker. The
  adversary returned SOUND, with no Floor breach. Its refinements were adopted:
  - the `run_id` + `signal_id IS NULL` confirm;
  - the `confirmed`-flag release;
  - mandatory @AC-10;
  - conditional @AC-8 wording.
- **Termination:** approved. The operator approved at the r2 design gate (2026-10-22). The remaining objections
  (all non-blocking) are recorded above as Open Risks, scope effects, and /sdd-spec re-verification duties.

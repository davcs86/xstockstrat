# Context Log: fix-fundsignal-emit-accounting

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-10-21 (/sdd-triage)

- Bug recorded as defect report `docs/reports/2026-10-21-fundsignal-emit-accounting-defect.md` (Issues disabled);
  sidecar `triaged` / `ref: feature:260-fix-fundsignal-emit-accounting`.
- Source: repo-surveyor debt-radar scan `docs/repo-surveyor/debt-radar-findings.md` @ 4535695, findings D-43, D-57.
- Severity: SEV-2 (group). Impact type: silent-signal-loss. Environment: dev (main-dev) @ a053b0e. Config-only: no.
- Operator decisions (2026-10-21): grouped by service+theme from the debt-radar scan; Track C for all SEV-2 (precedent #1264); batch launched via /sdd-batch with designGate halt.
- Routed to SDD path (Track C).
- Created: status.md, feature.md, product-spec.md, acceptance.feature (AC-1..4), context.md.
- Affected services: xstockstrat-analysis (fix site), xstockstrat-ingest (dedup semantics for the retry trade-off).
- Root cause hypothesis: one `fundsignal_emitted` row means both "claimed" and "emitted"; `_paced_fetch` has no bucket
  for failed chunks.
- Re-verification on a053b0e: both D-ids reproduce by reading.
  - D-43: claim insert `fundsignal_loop.py:242-256` (scan `:243-256`); emit/update/`emitted += 1` `:257-269`
    (scan `:269`); `_emit_signal` swallow `:541-548` (unchanged); abort `:270-278`.
  - D-57: `_paced_fetch` `:394-407` (scan `:394-406`); status `:280` (unchanged).
- Finding added at triage (D-43 trade-off): ingest dedup (`services/xstockstrat-ingest/app/handlers/servicer.py:1039-1066`)
  overwrites rather than deduplicates when `valid_until` differs, and `_emit_signal` derives `valid_until` from `now`
  (`fundsignal_loop.py:520-525`). So a retry after a lost-but-committed response is not deduplicated by ingest today.
  Design must pick: a deterministic `valid_until` per `as_of_date`, an ingest-side idempotency key, or accept the rare
  double row.
- **Overlaps / merge order:**
  - `246-fix-fundsignal-neutral-score` (implementation-ready) modifies `fundsignal_loop.py` (scoring and the `run_once`
    path; its spec cites the claim insert args `:243-254` and `min_conviction_to_emit` `:229`) and
    `tests/test_fundsignal_loop.py` (`_fund`, `_emitted_inserts` helpers). Same file and same test helpers as this
    feature. **Merge 246 first, then rebase 260**; add a row to `merge-order.md` at /sdd-spec.
  - `244-fix-python-config-stored-zero` (implementation-ready) touches `fundsignal_loop.py:143,154` (`retry_seconds`);
    line-disjoint, rebase only.
  - `242-fix-push-untargeted-broadcast` leaves `fundsignal_loop._emit_warning` untouched (its spec says "Do not touch
    `fundsignal_loop.py`"); D-57 may call `_emit_warning` for failed chunks — keep it untargeted (`@AC-6 @feature-224`).
  - `245-fix-screener-symbol-isolation` cites `fundsignal_loop.py` only as reference.
  - `259-fix-python-loop-supervision` (D-07) edits `run_forever`/`_tick` in the same file; disjoint lines.
- Recommended design depth: full → `/sdd-design fix-fundsignal-emit-accounting` (rationale: 2 affected services, the
  C-0 full trigger). Ingest is likely read-only, so the operator may downgrade to
  `/sdd-design fix-fundsignal-emit-accounting quick`; keep full if design moves idempotency into ingest or adds a
  migration.
- Development branch: feature/fix-fundsignal-emit-accounting

## Session 2026-10-21 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready. Criteria verdict: PASS WITH WARNINGS (no fails, no floor breaches).
- OPERATOR DECISIONS (binding, recorded 2026-10-21):
  - Grouped by service+theme from the 2026-10-20 debt-radar scan; Track C.
  - Scope is D-43, D-57.
- Warnings:
  - C9: Fix Scope `- [ ] Database migration: open, see OQ-1` and OQ-1/OQ-2 are unresolved, deferred to /sdd-design. Design
    must resolve them and tick or remove the box before the impl-spec gate.
  - C7: the migration is conditional on OQ-1 option two. Latest analysis migration is `027_contract_owner_dimension`,
    so the next is 028 or higher; re-derive across all in-flight batch branches (259 may add a table) before fixing it.
  - C8: FR-4 tie-break ('partial' wins over 'budget_deferred') had no scenario. **Resolved this session**: added
    `@AC-6` (120 symbols, budget 2, first chunk fails → `partial`, deferred 70, symbols_processed 50).
  - C8: AC-4's `symbols_processed` 10 was unspecified. **Resolved this session**: FR-4 now states `symbols_processed`
    counts only fetched symbols.
  - C8 (optional): no scenario for a same-day rerun retrying a failed chunk's symbols; FR-4 does not require it. Left open.
  - C5: **Resolved this session**: Fix Scope now states the `FundamentalsScanSummary.status` comment edit needs no
    breaking-proto approval gate, and that `./scripts/buf-gen.sh` must be re-run for `proto-freshness`.
  - OQ-2: the AC for the chosen idempotency behavior is added at design; the impl-spec review must confirm it exists.
- Overlap findings (level WARN, no FAIL):
  - Same-function collision with `246-fix-fundsignal-neutral-score` (implementation-ready) in `run_once` claim/skip/emit
    rows (`fundsignal_loop.py`). Recommend a non-blocking merge-order row (Resolved: No), 246 first, 260 rebases onto
    246's skip logic; /sdd-design confirms the order.
  - Same file, disjoint regions (rebase-only): 259 `fix-python-loop-supervision` (`run_forever`/`_tick`), 244
    `fix-python-config-stored-zero` (config read sites), 215 `block-fundamentals-strategy-on-etf` (`analysis.proto`,
    different messages, no field-number overlap).
  - Migration: conditional only (OQ-1 option two vs 259's possible parked-events table); neither claims an NNN yet —
    re-derive at /sdd-spec.
  - Context: analysis `servicer.py` touched by peers 262/272/270/245 in disjoint regions; ingest `servicer.py:1039-1066`
    only if design moves idempotency there (244 edits `:323,749`, disjoint); 255 `fix-marketdata-fundamentals-cache`
    may change `GetFundamentalsMulti` partial semantics D-57 relies on — re-check at 255's design.
  - merge-order.md has no entry pairing 260 with 246/259/244.
- Next: `/sdd-design fix-fundsignal-emit-accounting`.

## Session 2026-10-22 — sdd-batch design state recovered (round 2)

- The batch run that produced round 2 was cut off by the session usage limit before its gate writer persisted the debate state. This block is the round-2 synthesis restored verbatim from the run journal (`synth:fix-fundsignal-emit-accounting:r2`), so the next /sdd-batch run resumes from it instead of redoing the debate.

```sdd-batch-design-state
{
  "round": 2,
  "synth": {
    "approach": "Round-2 synthesis for 260 (D-43, D-57; Track C). The fix stays in analysis only: no migration, no ingest code change, and the only wire edit is a proto comment. All code changes are in services/xstockstrat-analysis/app/engine/fundsignal_loop.py and tests/test_fundsignal_loop.py. The round-1 design is kept in full except step 5, which is replaced by the proposer's r2 mode-dependent anchor. The adversary's r2 refinements are adopted as listed below.\n\n1. D-57, FR-4 (@AC-4, @AC-6). Step 1, independent of the rest.\n   - `_paced_fetch` (:381-406) collects each failed chunk's symbols into a `failed` list inside its existing per-chunk `except` (:401-402), and returns `(fetched, deferred, failed, calls)`.\n   - `run_once` sets `deferred_count = len(deferred) + len(failed)` for both `_finish` (:287-294) and `_abort_cycle` (:270-278).\n   - Status is `\"partial\"` if `failed`, else `\"budget_deferred\"` if `deferred`, else `\"completed\"`. The status column has no CHECK constraint (migrations/003:9).\n   - The single `_emit_warning` (:281-285) names the failed-chunk count and/or the budget cutoff.\n   - `_finish`, `_abort_cycle` and `_emit_warning` keep their signatures.\n\n2. D-43, FR-1 and FR-3 (@AC-1, @AC-3, @AC-5). Step 2.\n   - The claim INSERT at :243-256 is unchanged, `ON CONFLICT DO NOTHING` included. It is the in-flight fence against the lock-less manual `RunFundamentalsScan` (servicer.py:3832).\n   - After a successful claim, set `confirmed = False` and wrap emit and confirm in `try/finally`. The `finally` issues the release only when `not confirmed`.\n   - This answers the adversary's C-18 point: the success path makes zero extra round-trips. It still covers a `None` return, `_SystemWriteRejected`, any other exception and `CancelledError`.\n   - Release SQL: `DELETE FROM analysis.fundsignal_emitted WHERE symbol=$1 AND source=$2 AND as_of_date=$3 AND signal_id IS NULL AND run_id=$4::uuid`. This copies the force DELETE shape at :211-215.\n   - The release runs inside an inner `try/except Exception` that logs and swallows. It never catches `BaseException`, so the original `_SystemWriteRejected` or `CancelledError` still propagates. `_SystemWriteRejected` still reaches `except` at :270, so the abort flow and @AC-5's confirmed rows are unchanged.\n   - Confirm UPDATE (:261-268). Adversary r2 fix adopted: add `AND run_id=$5::uuid AND signal_id IS NULL`, matching the release predicate. A loop run can then never write onto a concurrent force run's re-claim.\n   - Set `confirmed = True` after the UPDATE executes, whether or not it matched a row.\n\n3. D-43, FR-2 (@AC-2). Count `emitted += 1` only when ingest returned a `signal_id`, and only after the confirm UPDATE has executed (it currently sits at :269, outside the `if`).\n   - The count does not depend on whether the UPDATE matched a row.\n   - A `deduplicated=true` response that carries a `signal_id` counts (fails.md:2627-2640).\n   - If the UPDATE raises after ingest accepted the signal, the `finally` releases the claim and the exception propagates as today. The next non-force run re-emits with the date anchor, ingest deduplicates, and the run confirms.\n\n4. Direction stability. This is the r1 blocking fix, kept.\n   - `_already_emitted` (:373-379) is widened to one query: `SELECT symbol, score ... WHERE source=$1 AND as_of_date=$2`, returning `{symbol: score}`.\n   - The skip predicate at :218-219 is unchanged, so every existing row (NULL or confirmed) is still skipped. Recon's `signal_id IS NOT NULL` narrowing is explicitly rejected in design.md because it would break the DO-NOTHING fence and the zero-cache-call guarantee.\n   - `_map_directions` (:470-485) gains optional `reference_scores`. Cuts are computed over `prior.values() \u222a scores.values()`, and directions are mapped only for `scores`.\n   - Force runs are unaffected: `prior` is empty because rows are deleted first (:210-216).\n\n5. The `valid_until` anchor depends on the run mode. This is the r2 change and it removes the r1 blocking sign-off.\n   - `_emit_signal` (:520-525) gains `valid_anchor: datetime` and sets `valid_until = valid_anchor + timedelta(days=valid_days)`. `valid_from` stays `now`.\n   - `run_once` computes the anchor once, next to `as_of_date` (:172):\n     - `force=True`: `datetime.now(UTC)`. This is today's behaviour, so analysis CLAUDE.md:123's \"force re-emits\" stays true.\n     - `force=False`: `datetime.combine(as_of_date, time.min, UTC)`. This matches the already-documented contract at analysis CLAUDE.md:512, \"`valid_until` = run date + this\", so the non-force change is a drift correction.\n   - Add one inline constraint comment of at most 2 lines at the anchor computation.\n\n6. Tests (step 4). They reuse `_identity_loop`, `_rpc_error`, `_make_loop` and the 120-symbol/50-chunk shape (test_fundsignal_loop.py:45,526,532,157), with an inline dict-backed `fundsignal_emitted` fake (C-13, single consumer).\n   - Cover @AC-1..@AC-10.\n   - Add one `local_pg` real-SQL test (conftest.py:368): claim \u2192 failed emit \u2192 release \u2192 re-claim \u2192 confirm, including the run_id-scoped confirm (C-08).\n   - Add a crash-orphan recovery test: a NULL row with a foreign `run_id` is skipped the same day and recovered by `force=true` and by the next `as_of_date` (fails.md:2689-2691).\n\n7. Proto and docs (step 5).\n   - Comment-only edit adding `\"partial\"` at packages/proto/analysis/v1/analysis.proto:564, then run `./scripts/buf-gen.sh`.\n   - services/xstockstrat-analysis/CLAUDE.md:122-123:\n     - add the `partial` state;\n     - replace the stale \"ingest does **not** dedup\" sentence;\n     - add the NULL-claim/release semantics, the force vs non-force anchor, and the crash-orphan carve-out.\n     - The :512 `valid_days` row is already correct.\n   - docs/runbooks/mcp-tools.md:845: add `partial`.\n   - The teardown context audit is owed.\n\n8. C-03 and the operator trace directive.\n   - The `RunFundamentalsScan` path keeps `sys_meta` (:175-178), which carries the inbound `x-trace-id`.\n   - The loop path calls `run_once(metadata=())` (:147) and has no originating request, so it may mint its own context. Record in design.md that it carries no trace id today.\n   - Optional: derive an `x-trace-id` from `run_id` on loop runs, only if peer fix-python-loop-supervision is not already doing so. Coordinate at /sdd-spec rather than adding it here by default.\n   - Release and confirm are local DB writes and add no new edge.\n\nNew @AC numbering. Verified on origin/feature/fix-fundsignal-emit-accounting: AC-1..AC-6 exist (AC-5 = abort keeps confirmed rows, AC-6 = partial beats budget). The r1 synthesis numbering was wrong. The new scenarios are:\n- **@AC-7:** confirmed same-day rows are skipped and `GetFundamentalsMulti` is called zero times.\n- **@AC-8:** a non-force retry after a lost-but-committed response sends the identical `valid_until` and direction. The `deduplicated=true` response counts toward `signals_emitted`. The description must state that this holds only when `ingest.signals.dedup_window_hours > 0` and conviction is unchanged (marketdata cache refresh).\n- **@AC-9:** a one-symbol retry keeps the day's cross-sectional direction (sell stays sell). The description notes that the budget_deferred resume uses the same day-wide cuts, plus the boundary-flip approximation.\n- **@AC-10 (mandatory, per adversary r2):** `force=true` still sends a `now`-anchored `valid_until`. This pins the anchor asymmetry so the C-16 guard catches an \"unification\".\n\nMerge order: 246 merges first, then 260 rebases onto the shared `run_once` lines. Add the merge-order.md row at /sdd-spec.",
    "open_objections": [
      {
        "text": "Record the scope effects of the reference-score cut as operator-visible changes in design.md and context.md. Neither is covered by D-43/D-57 or by any @AC. (1) The budget_deferred resume now gets day-wide cuts instead of small-universe cuts. (2) Non-force `override_symbols` manual scans now get full-day cuts, so a 3-symbol override is cut against the whole day. Also record the edge case where `scoring_formula_id` changes mid-day and the reference set mixes scores from two formulas. The change is required for FR-1 correctness: with a single value, `_quantile` makes buy_cut == sell_cut, so the symbol always gets \"buy\" (:474-481). The recommendation is to accept it as a recorded EXTEND.",
        "blocking": false
      },
      {
        "text": "The @AC-8 description must make the dedup guarantee conditional, so C-16 does not promote an absolute promise. It holds only while `ingest.signals.dedup_window_hours > 0`: at 0, the WHERE at ingest servicer.py:1050-1051 is always true. It also requires conviction to be unchanged between attempts, because a marketdata 24h cache refresh changes it and the row is overwritten (:1052-1053).",
        "blocking": false
      },
      {
        "text": "Record the crash-orphan carve-out in design.md and cover it with the recovery test. If the process dies by SIGKILL or OOM between claim and confirm, or the release DELETE itself fails, a NULL row is left. That symbol is skipped for the rest of the day by the unchanged predicate (:218-219) and DO NOTHING (:247). It is recovered on the next as_of_date or by force=true (:211-215).",
        "blocking": false
      },
      {
        "text": "Record that the loop path deliberately carries no x-trace-id: `run_once(metadata=())` at :147 has no originating request, which the operator directive allows. This keeps it from being read as a C-03 gap. Minting a trace id from run_id is optional, and only if peer fix-python-loop-supervision does not already do it.",
        "blocking": false
      },
      {
        "text": "design.md must state that recon's narrowing of `_already_emitted` to `signal_id IS NOT NULL` was rejected, and why: it breaks the in-flight DO-NOTHING fence and the zero-cache-call guarantee. Otherwise /sdd-spec may re-introduce it.",
        "blocking": false
      },
      {
        "text": "Assumption still to re-verify at /sdd-spec. Per the adversary, ingest's dedup conflict key is (user_id, source, symbol, direction), it excludes valid_from (servicer.py:1045), and the signal insert and dedup claim commit in one transaction (:1017). The proposer did not re-read these this round, and @AC-8's correctness depends on them.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "@AC-1 (260: failed emit retried same day)",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-2 (260: signals_emitted counts accepted only)",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-3 (260: abort leaves no orphan claim)",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-4 (260: failed chunk reported as partial)",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-5 (260: abort keeps confirmed rows)",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-6 (260: partial beats budget_deferred)",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-7 (new: confirmed same-day rows skipped, zero GetFundamentalsMulti calls)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-8 (new: non-force lost-response retry sends date-anchored valid_until and dedups; conditional on dedup window > 0 and unchanged conviction)",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-9 (new: one-symbol retry / budget_deferred resume keeps day-wide cross-sectional direction)",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-10 (new, mandatory: force=true keeps now-anchored valid_until and fresh re-emit)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-26 (fundsignal cross-sectional direction)",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-9/@feature-224 (ingest system write grant)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-4/@feature-166 (ingest)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-2/@feature-173 (ingest per-owner dedup, incl. window=0)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "Date-anchor `valid_until` for force runs too (the r1 step 5). Simpler, with no asymmetry. Lost because a same-day force re-emit would dedup into a no-op at ingest, which contradicts analysis CLAUDE.md:123 and would need operator sign-off outside the D-43/D-57 scope. The mode-dependent anchor gets lost-response idempotency without that cost.",
      "Move idempotency into ingest (idempotency_key, or as_of_date in the dedup key). It is exact regardless of conviction drift. Lost because it turns ingest @AC-9/@feature-224, @AC-4/@feature-166 and @AC-2/@feature-173 into CHANGE and needs a proto field plus a migration, which is too much rework for SEV-2 under the low-rework directive.",
      "Release in an unconditional `finally` (proposer r2 as written). It costs one no-op DELETE round-trip per symbol through PgBouncer even on success. It was replaced by a `confirmed` flag, so the release runs only on non-confirmed exits; that keeps cancellation coverage at zero cost on success (C-18).",
      "Release only in explicit `except` branches (adversary r2 literal fix). It misses `CancelledError` unless `BaseException` is caught. The `confirmed`-flag `finally` covers every exit with the same zero-cost success path.",
      "A confirm UPDATE scoped by run_id only (r1). It still lets a stale run overwrite a confirmed row in narrow races. Adding `signal_id IS NULL` matches the release predicate at no cost.",
      "Re-claim NULL rows via `ON CONFLICT DO UPDATE ... WHERE signal_id IS NULL`. It would recover crash orphans the same day. Lost because the manual RunFundamentalsScan does not take self._lock (servicer.py:3832 vs fundsignal_loop.py:139-145), so concurrent runs could steal in-flight claims and double-emit.",
      "Retry with the direction stored on the claim row instead of recomputing cuts. Lost because the release deletes the row; keeping a failed-state row needs a new column and migration 028.",
      "Narrow `_already_emitted` to `signal_id IS NOT NULL` (recon / proposer r1). Lost because it breaks the in-flight fence and the zero-cache-call guarantee, and spends GetFundamentalsMulti budget on rows DO NOTHING skips anyway.",
      "Add a claim-state or claim-timestamp column (migration 028) for stale-claim takeover. Lost because it brings the DBA/migration gate and batch-wide NNN renumbering risk for a crash-only edge case.",
      "Map directions over the retry universe only. Lost because a one-symbol universe collapses the cuts and always yields 'buy' (:479, :631), producing a contradictory sell+buy pair, since direction is in ingest's conflict key."
    ],
    "open_risks": [
      "A future reader 'unifies' the two anchor modes; switching force to the date anchor would silently turn force re-emits into dedup no-ops. Mitigated by mandatory @AC-10 plus a 2-line constraint comment.",
      "Boundary direction flips on a retry when min_conviction_to_emit > 0 or some symbols failed scoring, because the reference distribution from fundsignal_emitted is not the first run's full set. A flip lands as a second ingest row in the other direction. Accepted, and written into @AC-9's description.",
      "A mid-day marketdata cache refresh, or `ingest.signals.dedup_window_hours=0`, defeats @AC-8 dedup and produces a duplicate row. Accepted, and stated as conditions in @AC-8.",
      "If a force run's response is lost and a non-force retry follows the same day, the retry sends a different `valid_until` (date anchor instead of now anchor) and can create one duplicate row. Rare; accepted.",
      "Non-force signal validity shrinks by up to about 24h (as_of_date 00:00 UTC + valid_days instead of now + valid_days). This matches the documented contract at CLAUDE.md:512.",
      "A release DELETE that fails, or a hard crash, degrades the symbol to the crash-orphan path: no same-day retry, recovered next day or by force.",
      "FR-4 covers only chunks that raised. A chunk that succeeds but returns fewer fundamentals than requested still drops symbols silently; that is deferred to peer fix-marketdata-fundamentals-cache.",
      "Merge conflict with 246 on the shared run_once lines. 246 lands first and 260 rebases.",
      "The dict-backed fake can drift from the real ON CONFLICT and run_id/signal_id-filtered SQL. Mitigated by the one local_pg test.",
      "Ingest dedup-key and same-transaction claims (servicer.py:1017, :1045) rest on the adversary's verification only and must be re-confirmed at /sdd-spec."
    ],
    "constitution_rules_touched": [
      "C-03",
      "C-08",
      "C-11",
      "C-13",
      "C-15",
      "C-16",
      "C-18",
      "P-02",
      "P-03",
      "PLAT-N1"
    ],
    "rationale": "The single r1 blocker was the operator sign-off for force-run dedup. The proposer's r2 mode-dependent anchor removes it:\n- `force=True` keeps `now + valid_days` byte-for-byte, so CLAUDE.md:123 stays true.\n- `force=False` uses `as_of_date` 00:00 UTC. That fixes the timestamp-derived idempotency scar (fails.md:2118-2122) and restores the contract already documented at CLAUDE.md:512 (\"run date + this\").\n\nI verified the anchor site (fundsignal_loop.py:520-525), the unscoped confirm UPDATE and misplaced `emitted += 1` (:261-269), and the CLAUDE.md lines against the code. I also confirmed on origin/feature/fix-fundsignal-emit-accounting that @AC-1..@AC-6 already exist. That makes the proposer's renumbering (new @AC-7..@AC-10) correct and the r1 synthesis numbering wrong.\n\nThe adversary returned SOUND with no Floor breach. Its refinements are adopted because each is a few lines and lowers risk, in line with \"preserve as much as you can while having low rework\":\n- the confirm UPDATE is scoped by `run_id` and `signal_id IS NULL`;\n- release happens only on non-confirmed exits, through a `confirmed` flag. This beats both the always-on `finally` (wasted round-trips) and except-only release (misses `CancelledError`);\n- @AC-10 is mandatory, to pin the asymmetry;\n- @AC-8 carries the conditional wording.\n\nEverything else from r1 is preserved unchanged: the DO-NOTHING fence, the reference-score cut, the `partial` status with failed chunks counted, no migration, and no ingest change.\n\nThe remaining objections are documentation and recording duties: scope EXTEND effects, crash-orphan carve-out, loop-path trace id, and the rejected narrowing. They also include one assumption to re-verify at /sdd-spec. None of these must be resolved before approval, so nothing is blocking."
  },
  "floor_breaches": []
}
```

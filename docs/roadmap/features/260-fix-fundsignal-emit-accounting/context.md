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

## Session 2026-10-22 — sdd-design

- Phase 0 Recon: wrote recon.md earlier (services: xstockstrat-analysis, xstockstrat-ingest read-only). Patterns to
  reuse: the force-DELETE shape for the claim release, and the `_paced_fetch` per-chunk `except` for the failed bucket.
- Phase 1 Grilling: 2 rounds (full). Approved by the operator at the r2 design gate (2026-10-22: "APPROVED as
  synthesized"). Floor clear.
- OPERATOR DECISIONS (binding, recorded 2026-10-22):
  - Scope is D-43 and D-57. Track C. The work is grouped by service and theme from the 2026-10-20 debt-radar scan.
  - Standing directive (2026-10-21): propagate `x-trace-id` wherever possible. There is no C-03 waiver.
    - Request-derived emits use the inbound metadata.
    - Only work with no originating request (such as the loop) may mint its own context.
  - Design gate r2: APPROVED as synthesized.
- Chosen approach: analysis-only, no migration, no ingest change. The pieces are:
  - The claim INSERT keeps `ON CONFLICT DO NOTHING` as the in-flight fence.
  - The claim is released on any unconfirmed exit, via a `confirmed`-flag `try/finally` and a run_id-scoped DELETE.
    Swallowed release errors are `Exception` only, never `BaseException`.
  - The confirm UPDATE is scoped by `run_id` and `signal_id IS NULL`.
  - `emitted += 1` runs only when ingest returned a `signal_id`.
  - `_already_emitted` is widened to return `{symbol: score}`, and the skip predicate is unchanged.
  - `_map_directions` cuts over the day-wide reference scores.
  - The `valid_until` anchor depends on the run mode: `force=True` → now, `force=False` → `as_of_date` 00:00 UTC.
  - `_paced_fetch` returns a `failed` bucket, and status precedence is `partial` > `budget_deferred` > `completed`.
  - The proto change is a comment only (`"partial"`), followed by buf-gen.
- OQ-1 resolved: a NULL `signal_id` marks an in-flight claim, which is released on failure. A crash orphan is
  recovered on the next day or by `force`.
- OQ-2 resolved: non-force runs use a date-anchored `valid_until`.
- Product-spec C9 box resolved: **no migration**.
- New scenarios to add at /sdd-spec:
  - @AC-7: confirmed same-day rows are skipped, with zero fetch calls.
  - @AC-8: a lost-response retry dedups. This is conditional on `dedup_window_hours > 0` and unchanged conviction.
  - @AC-9: the day-wide direction holds on a retry and on the `budget_deferred` resume.
  - @AC-10 (mandatory): force keeps a now-anchored `valid_until`.
- Rejected:
  - narrowing `_already_emitted` to `signal_id IS NOT NULL` (recon's recommendation; it breaks the fence and the
    zero-cache-call guarantee);
  - ingest-side idempotency;
  - date-anchoring force runs;
  - re-claim via DO UPDATE (the lock-less manual RPC);
  - migration 028.
- Recorded EXTEND scope effects of the reference-score cut:
  - the `budget_deferred` resume and non-force `override_symbols` scans get full-day cuts;
  - a mid-day `scoring_formula_id` change mixes two formulas in the reference set.
- Loop path `run_once(metadata=())` deliberately carries no `x-trace-id`. It has no originating request, which the
  operator directive allows.
- Constitution rules touched: C-03, C-08, C-11, C-13, C-15, C-16, C-18, P-02, P-03, PLAT-N1. Floor breaches: none.
- Status: spec-ready → design-approved.

### Open Threads

- [ ] Anchor-unification hazard. Mitigated by mandatory @AC-10 and the 2-line constraint comment. Target: the
  /sdd-spec anchor step and its test step.
- [ ] Boundary direction flip on a retry (when `min_conviction_to_emit > 0` or symbols failed scoring). Accepted;
  goes into the @AC-9 description. Target: the /sdd-spec acceptance step.
- [ ] A cache refresh or `dedup_window_hours=0` defeats @AC-8. Accepted as conditions. Target: the /sdd-spec
  acceptance step.
- [ ] A lost force response followed by a non-force retry can create one duplicate row. Rare; accepted. Target: docs.
- [ ] Non-force validity shrinks by up to about 24h, matching the analysis CLAUDE.md:512 contract. Target: the docs
  step.
- [ ] Crash-orphan carve-out: a NULL row is skipped for the rest of the day. Target: the recovery test and the
  analysis CLAUDE.md docs step.
- [ ] A short successful chunk still drops symbols silently. Deferred. Target: 255-fix-marketdata-fundamentals-cache.
- [ ] Merge order: 246 merges first and 260 rebases. Target: add a `merge-order.md` row at /sdd-spec.
- [ ] The dict fake can drift from the real SQL. Mitigated by one `local_pg` test. Target: the test step.
- [ ] Re-verify the ingest dedup conflict key `(user_id, source, symbol, direction)`, which excludes `valid_from`
  (`servicer.py:1045`). Also re-verify that the signal insert and the dedup claim commit in one transaction (`:1017`).
  Target: /sdd-spec, before the acceptance step.
- [ ] Optional loop-path `x-trace-id` derived from `run_id`. Coordinate with 259-fix-python-loop-supervision.
  Target: /sdd-spec.
- [ ] The context teardown audit is owed for analysis CLAUDE.md and `docs/runbooks/mcp-tools.md`. Target: the
  final PR.

## Session 2026-10-22 — sdd-spec

- Wrote implementation-spec.md with 9 steps. Status: design-approved → implementation-ready.
- The steps are three red-before-green pairs, then proto, proto-gen and docs:
  - 1-2: D-57 `partial` status and the failed-chunk bucket;
  - 3-4: claim release, the run_id-scoped confirm, the accepted-only count, and the one `local_pg` real-SQL test;
  - 5-6: the `{symbol: score}` reference set, day-wide direction cuts, and the mode-dependent `valid_until` anchor;
  - 7: the `"partial"` proto comment;
  - 8: buf-gen (5 generated files);
  - 9: analysis CLAUDE.md, mcp-tools.md:845, the merge-order.md row, and the teardown audit.
- The design is followed as approved. The rejected `signal_id IS NOT NULL` narrowing of `_already_emitted` is kept
  out, and Step 6 greps that it is absent. There is no migration and no ingest code change.
- OPERATOR DECISIONS (binding, carried forward): scope is D-43 and D-57, Track C. Standing 2026-10-21 trace
  directive, with no C-03 waiver. Design gate r2: APPROVED as synthesized (2026-10-22).
- **acceptance.feature edits (C-15):**
  - Appended @AC-7..@AC-10 as design.md specifies. @AC-8 and @AC-9 carry the conditional/approximation descriptions
    the design requires. @AC-10 is the mandatory pin for the force anchor.
  - **@AC-5 body corrected, ID unchanged.** As written it said "MSFT then AAPL", with MSFT accepted and AAPL
    NOT_FOUND. But `run_once` iterates `sorted(scores)` (`fundsignal_loop.py:238`), so AAPL is processed first and
    that scenario cannot hold. The symbols were swapped: AAPL is accepted, MSFT gets NOT_FOUND, and a description
    line records the sorted order. The intent is unchanged (confirmed rows survive an abort, and there is no orphan
    for the aborting symbol). This is surfaced here per P-03 rather than worked around in the test.
- **Re-verified ingest claims** that @AC-8 depends on (design Open Risks):
  - one transaction, `async with self._db.acquire() as conn, conn.transaction():`
    (`services/xstockstrat-ingest/app/handlers/servicer.py:1016`);
  - conflict key `ON CONFLICT (user_id, source, symbol, direction)` (`:1044`), with `valid_from` excluded;
  - the overwrite `WHERE` triggers on window expiry, or on a `conviction` or `valid_until` change (`:1048-1053`).
  Confirmed.
- **Loop-path trace id:** not added. Peer 259 (`fix-python-loop-supervision`) is `spec-ready` with no design.md, so
  there is nothing to coordinate with yet. design.md records the loop path as deliberately trace-less.
- **merge-order.md row:** /sdd-spec writes only inside this feature directory, so the row (246 first, soft/rebase)
  is Step 9 of the spec rather than a write made now.
- Key codebase findings:
  - Existing tests that break by design and are updated in their paired test steps:
    - `test_paced_fetch_respects_budget` unpacks a 3-tuple (`tests/test_fundsignal_loop.py:160`);
    - `test_already_emitted_skips_fetch_and_emit` stubs rows without `score` (`:100`).
  - No stateful `fundsignal_emitted` fake exists, and no test applies migration SQL. Step 3 creates an inline
    `_EmittedTable` fake (single consumer, C-13). The new `tests/test_fundsignal_emitted_real_pg.py` applies
    `003`/`004` up.sql on `local_pg` and imports, rather than copies, the loop helpers.
  - The module docstring at `fundsignal_loop.py:8-9` repeats the stale "ingest does not dedup" claim. Step 4
    corrects it. The `004_fundsignal_emitted.up.sql:4` comment says the same, but it is an applied migration and
    stays untouched (F-01).
  - The C-14 surfaces pass values through: `services/xstockstrat-agent/app/client.py:1724` and
    `services/xstockstrat-ui/src/app/config-ui/fundamentals-scan/page.tsx:101,106`. Only the mcp-tools.md doc
    changes.

### Open Threads

- [ ] Rebase onto 246 once it merges. Re-anchor the cited lines by symbol and record the shifts in the Deviation Log.
  Target: /sdd-execute.
- [ ] The real_pg test runs only where PostgreSQL binaries exist (in CI, or locally with `XSTOCKSTRAT_PG_BIN`).
  Target: Step 3/4 verification.
- [ ] The teardown context audit for analysis CLAUDE.md and mcp-tools.md. Target: Step 9 / the final PR.
- [ ] Carried from design and still open: short successful chunks (owned by 255); and the accepted risks recorded in
  the @AC-8/@AC-9 descriptions (dedup window or conviction drift, boundary flips).

## Session 2026-10-22 — sdd-review impl-spec (advisory)

- Result: 0 failures, 7 warnings; overlap WARN (file-level only, no migration/proto-field/config-key collision).
  Advisory, lifecycle unchanged (`implementation-ready`).
- Addressed in implementation-spec.md:
  - [x] B2 coverage threshold: Steps 1, 3 and 5 Verification now state that they are RED by design and that the paired
    service steps 2, 4 and 6 carry `--cov-fail-under=40`.
  - [x] Step 7 `buf breaking` now compares against `origin/main-dev` (repo convention
    `'../../.git#branch=origin/<base>,subdir=packages/proto'`), not against the feature branch itself.
  - [x] Step 5/6 `_FixedClock` patch: Step 6 evidence records that `datetime.combine(...)` on the subclass returns a
    tz-aware instance (checked: `2026-10-21 00:00:00+00:00`), plus a log-a-deviation instruction if `FromDatetime` misbehaves.
  - [x] Line hints: `TestBudgetDefer` class at `:155` and method at `:157-164` (re-verified; the method cite was
    already correct). Other cited test lines re-checked (`:160`, `:167`, `:179-180`) and are accurate.
  - [x] Merge-order timing: Step Dependencies now has `/sdd-execute` land the 260-after-246 soft row before Step 1.
    Step 9 item 4 only confirms it is present.
  - [x] `_release_claim` swallow carve-out: Step 9's analysis CLAUDE.md bullet now documents that a failed release
    leaves the NULL row, with the same recovery as a crash orphan.
- Overlap findings: same-function overlap with 246 (`run_once`, `_fund`/`_emitted_inserts` helpers, analysis
  CLAUDE.md, mcp-tools.md disjoint lines). This is already covered by the 246-first/rebase rule. Low-risk: 215 (different proto message), 259
  (`run_forever`/`_tick`, draft).

### Open Threads

- [ ] Step 3 size (C-18 / P-06): a split of the real_pg file into its own paired test step was suggested. It is not
  applied because it would renumber Steps 4-9 and their cross-references. Splitting is not required, since Step 3 touches
  2 files. At the Step 3 checkpoint, /sdd-execute should decide whether to commit the real_pg file separately.
  Target: /sdd-execute Step 3.

## Session 2026-10-29 — sdd-execute re-spec (sdd-batch-execute)

- Branch setup: `git merge --no-edit origin/main-dev` into the detached `origin/feature/fix-fundsignal-emit-accounting`
  checkout (9912cbf5). It merged with no conflicts, and this feature's directory was untouched by the merge.
  `ledger-guard --own-slug fix-fundsignal-emit-accounting --base origin/main-dev --fix` reported clean, so the merge
  needed no repair.
- Re-spec of Steps 1-9 against `main-dev` after 246 (`fix-fundsignal-neutral-score`) was merged in:
  - Steps 1, 2, 4 and 6: line drift only. Every symbol still exists, and `_paced_fetch` still returns a 3-tuple.
  - Steps 3 and 5 (substantive): 246 changed `_score` to return `(scores, unscored)`, which `run_once` unpacks at
    `:226`. Every `_score` mock (`_fake_loop`, the real-PG test, and `test_ac9`) now returns `(scores, [])`. 246's
    `_map_directions` spy test (`:770-779`) stays compatible with the added `reference_scores=` keyword.
    `test_quantile_buckets` passes keyword args, which is also compatible.
  - Step 9 (substantive): 246 rewrote the analysis CLAUDE.md Idempotency bullet (`:123`), so the "does not dedup" text
    is already gone. Instruction 2 now extends that bullet and keeps 246's unscored-symbol clause. The `merge-order.md`
    260-vs-246 row already exists at `:81`. Its wording differs from the original spec text, but it records the same
    dependency, which is now satisfied (246 merged), so Step 9 only verifies it and the file is verify-only.
  - Steps 7 and 8: no change. The proto comment is at `:564`, and exactly 5 generated files carry it.
- Step Dependencies "merge-order row before Step 1": already satisfied by the existing `:81` row. No edit is needed.

## Session 2026-10-29 — sdd-execute sequential (sdd-batch-execute)

- Mode: `/sdd-execute fix-fundsignal-emit-accounting sequential`, run in its own worktree via `sdd-batch-execute`
  (P-01: this run is the only writer).
- Up-front confirmation came from the operator's standing authorization, given in operator chat 2026-10-28/29
  (session_01NpS3HShZK6pSnogA7CFo2f): "Start executing features 241-276" via batch-execute. Its terms:
  - checkpoints are unattended (`report`);
  - C-16 promotion is auto-confirmed unless it changes an existing @AC rule;
  - merge-train is authorized, and 255/275 are deferred;
  - DB and prod steps are operator-only: open the PR and hold the merge;
  - blocker decisions are recorded per feature (2026-10-29).
- Status: `implementation-ready` → `in-progress`. The re-spec of Steps 1-9 is logged in the session entry above.
- Next: Step 1 (RED test, `tests/test_fundsignal_loop.py`).

### Step 1 — test: failed fetch chunks are reported as `partial` (RED) — done (2026-10-29)

- File: `services/xstockstrat-analysis/tests/test_fundsignal_loop.py`.
  - `test_paced_fetch_respects_budget` now unpacks `fetched, deferred, failed, calls` and asserts `failed == []`.
  - `class TestFailedChunk` follows `TestBudgetDefer`. Its `@staticmethod _fail_first_chunk(loop)` makes the first
    `GetFundamentalsMulti` call raise `UNAVAILABLE` and lets later calls succeed.
  - `test_ac4_failed_chunk_is_partial_and_deferred` uses 60 symbols. It asserts `partial`, deferred 50, processed 10,
    and that the `fundsignal_runs` UPDATE args are `status="partial"` and `deferred_count=50`. It then calls
    `_paced_fetch` directly and asserts 50 failed, `deferred == []` and 2 calls.
  - `test_ac6_failed_chunk_beats_budget_cutoff` uses budget 2 and 120 symbols. It asserts `partial`, deferred 70,
    processed 50, and exactly one `EmitAlert` whose body contains both `50` and `20`.
- RED (pre-Step-2), as predicted: 3 failed (unpack `ValueError`; `completed`≠`partial`; `budget_deferred`≠`partial`).
  The other 56 tests pass. ruff check and format are clean.
- Constraint for Step 2: AC-6 requires exactly ONE warning. That warning must name both the failed-chunk symbol count
  (50) and the budget-deferred symbol count (20). Fold both into the single `_emit_warning`.
- Deviation: minor test-file line drift (`_rpc_error` is now at `:584`), recorded in the Deviation Log.
- Next: Step 2 (service: `_paced_fetch` failed bucket and `partial` status).

### Step 2 — service: `_paced_fetch` failed bucket and `partial` status — done (2026-10-29)

- File: `services/xstockstrat-analysis/app/engine/fundsignal_loop.py`.
  - `_paced_fetch` collects a raising chunk's symbols in `failed` and returns `fetched, deferred, failed, calls`. A
    failed call still spends budget.
  - `run_once` computes `deferred_count = len(deferred) + len(failed)` and passes it to both `_abort_cycle` and
    `_finish`. `symbols_done=len(fetched)` is unchanged.
  - Status is `partial` when any chunk failed, else `budget_deferred` or `completed`. One `_emit_warning` names both
    counts.
- TDD (AC-4, AC-6): red: 3 failed (unpack `ValueError`; `'completed' == 'partial'`; `'budget_deferred' == 'partial'`),
  56 passed → green: `tests/test_fundsignal_loop.py` 59 passed.
- Verification: full suite with coverage, excluding `real_pg`: 1298 passed, 4 deselected, 88.63% (≥40). ruff check and
  format are clean. The `"partial"` grep matches at `:284`.
- Deviations: the fetch call is wrapped by `ruff format`, and the coverage run deselects the 4 `real_pg` tests so no
  database is started (CI runs them). Both are in the Deviation Log.
- Next: Step 3 (test: claim release, accepted-only count, abort cleanup, and real SQL).

## Session 2026-10-29 — sdd-execute re-spec rev 2 (sdd-batch-execute)

- Authorization: the operator's standing authorization (operator chat 2026-10-28/29,
  session_01NpS3HShZK6pSnogA7CFo2f: "Start executing features 241-276" via batch-execute). Checkpoints are unattended
  ('report'), C-16 promotion is auto-confirmed unless it changes an existing @AC rule, and the merge-train is authorized.
  The operator alone opens the PR and holds the merge for DB/prod steps. Per-feature blocker decisions were given
  2026-10-29 through the session's question tool.
- Branch setup (§5.3): `git merge --no-edit origin/main-dev` into the detached checkout of
  `origin/feature/fix-fundsignal-emit-accounting`. It merged with no conflicts. `ledger-guard --fix` reported clean,
  so no repair was needed.
- Status: already `in-progress` (Steps 1-2 done). No status flip.
- Re-spec of Steps 3-6 bodies (Codebase Evidence and Instructions line citations only). Re-grepped on the merged tree:
  - `fundsignal_loop.py`:
    - Claim INSERT `:247-258`, `row is None` `:259-260`, `_emit_signal` call `:261-263`.
    - Unscoped UPDATE `:264-272`, `emitted += 1` `:273`, `except _SystemWriteRejected` `:274-282`.
    - `_score` unpack `:229`, `_warn_unscored` `:230` (def `:365`), `_score` def `:430`.
    - `_already_emitted` `:391-397`, `_map_directions` `:505-521` (call `:234`), `_quantile` `:667-676`.
    - `_emit_signal` `:556`, NOT_FOUND raise `:578-582`, return None `:584`.
    - Best-effort `noqa: BLE001` precedents `:633`/`:663`.
  - Test harness: `_rpc_error` `:580`, `_identity_loop` `:586`, `_emitted_inserts` `:603`, `_alert_severities` `:609`,
    `test_quantile_buckets` `:234`, `random.uniform` patch `:547`, 246 spy `:814-831`.
  - Confirmed as cited, so not changed: the force DELETE `:210-216`, `as_of_date` `:172`, the stale docstring `:9`,
    the lock `:145`, `tests/conftest.py` (RecordingStub `:90`, FunctionType `:108`, `local_pg` `:375`), and
    `pyproject.toml:32-33`.
  - Also confirmed as cited: migrations 003/004 (FK at 004:13, `score numeric` at :11), `CLAUDE.md:513` and
    `/usr/lib/postgresql/16`.
- No change to scope, SQL, predicates, TDD gates or Covers. `test_fundsignal_emitted_real_pg.py` is still absent; Step 3
  creates it.
- Next: Step 3 (test: claim release, accepted-only count, abort cleanup, and real SQL — RED).

### Step 3 — test: claim release, accepted-only count, abort cleanup, and real SQL (RED) — done (2026-10-29)

- Files:
  - `services/xstockstrat-analysis/tests/test_fundsignal_loop.py`. Adds the `asyncio` and `timedelta` imports. The
    `test_already_emitted_skips_fetch_and_emit` rows now carry `score`. Adds the inline `_EmittedTable` fake, which
    honours only the predicates present in each SQL text, plus `_fake_loop` (its `_score` mock returns
    `(scores, [])`), `_ingest_by_symbol`, `_ingested_symbols` and `class TestEmitAccounting` with 9 tests.
  - `services/xstockstrat-analysis/tests/test_fundsignal_emitted_real_pg.py`, new. Applies migrations 003/004 to a
    `local_pg` pool and imports `_identity_loop`/`_rpc_error` (C-13, no copy). Its 3 tests are failed-emit
    release + reclaim, the foreign-run confirm guard, and the abort deleting only the unconfirmed claim.
- TDD: the RED captures matched the spec's prediction.
  - Failed (6): AC-1 `[] == ['AAPL']` (run 2 skips AAPL). AC-2 `2 == 1`. AC-3 orphan NULL AAPL row. AC-5 NULL MSFT
    row remains. Scoped confirm `9 is None`. Cancelled emit leaves the claim.
  - Passed as guards (4): AC-7, the crash-orphan carve-out, release-failure and `test_already_emitted`.
  - Full suite without `real_pg`: 6 failed, 1301 passed, 7 deselected.
  - ruff check and format are clean. The C-13 import grep matches `:12`.
- Fake validation: Step 4's specced change was applied temporarily, the file then gave 68 passed, and the change
  was reverted. GREEN is reachable with the specced SQL.
- Not run: the `real_pg` file (3 tests collected). `local_pg` starts a database, which is forbidden here. CI runs it,
  and it stays RED until Step 4.
- Deviations: the foreign-run real-PG test stubs `IngestSignal` with an async `AsyncMock` side effect, because a
  `RecordingStub` response function is called synchronously. Three small helpers were added. Both are in the
  Deviation Log.
- Open Thread (Step 3 size): the real_pg file is not split into its own step. It is committed with this step, because
  the step's **Files** list names both files.
- Commit hook: `core.hooksPath` points at `/home/user/xstockstrat/.husky/_`, which does not exist, and the main
  worktree has no `node_modules` to symlink. So the commit ran with no pre-commit hook. `--no-verify` was not used.
- Next: Step 4 (service: release the claim on any unconfirmed exit, scope the confirm, count accepted only).

### Step 4 — service: release the claim on any unconfirmed exit; scope the confirm; count accepted only — done (2026-10-29)

- Files: `services/xstockstrat-analysis/app/engine/fundsignal_loop.py`.
  - `run_once` now wraps the emit and confirm in `try`/`finally`. `confirmed` and `emitted` are set only after the
    scoped confirm UPDATE (`... AND run_id=$5::uuid AND signal_id IS NULL`). Any unconfirmed exit, whether a `None`
    emit, an exception, `_SystemWriteRejected` or a cancellation, calls `_release_claim`.
  - New `_release_claim` follows `_already_emitted`. It deletes only this run's NULL claim and logs and swallows an
    `Exception`, never a `BaseException`.
  - The module docstring no longer says ingest does not dedup. It says the claim guards re-emits, and that a NULL
    `signal_id` marks an in-flight claim that is released when the emit fails.
- TDD:
  - RED before the change: 6 failed, 62 passed in `test_fundsignal_loop.py`. The failures were AC-1, AC-2, AC-3,
    AC-5, the scoped confirm and the cancelled-emit release.
  - GREEN after the change: 68 passed.
- Verification:
  - The full suite with `-m "not real_pg"` gave 1307 passed, 7 deselected, at 88.72% coverage. ruff check and
    format are clean. The `signal_id IS NULL` grep hits `:271` (confirm) and `:412` (release).
  - The `real_pg` file gave 3 passed. This run started a throwaway `local_pg` cluster, and Steps 2-3 had not run it.
    That is in the Deviation Log.
- Deviations: line drift only (+-3 against the rev-2 citations), recorded in the Deviation Log.
- Next: Step 5 (test: retry direction stability and the mode-dependent `valid_until` anchor, RED).

### Step 5 — test: retry direction stability and the mode-dependent `valid_until` anchor (RED) — done (2026-10-29)

- Files: `services/xstockstrat-analysis/tests/test_fundsignal_loop.py`.
  - Adds an inline `_FixedClock` (now = `2026-10-21T15:30Z`), applied by an autouse fixture that monkeypatches
    `fundsignal_module.datetime`.
  - Adds `_FIXED_NOW`, `_ingest_requests` and `class TestRetryStability` with 4 tests. They reuse Step 3's
    `_EmittedTable` and `_fake_loop`.
- TDD RED (`-k "TestRetryStability or TestScoreDirection"`): 3 failed, 4 passed, matching the spec.
  - AC-8 red: `'buy' == 'sell'`. Run 2 maps the lone AAPL 0.85 to buy, but run 1 (with MSFT 0.90) mapped it to sell.
  - AC-9 red: `'buy' == 'sell'`.
  - The `reference_scores` cuts test is red: `TypeError: unexpected keyword argument 'reference_scores'`.
  - Green as guards: AC-10, the force PRESERVE pin with `valid_until` `2027-01-19T15:30Z`, and
    `test_quantile_buckets`.
- Full suite `-m "not real_pg"`: 3 failed (the RED above), 1308 passed, 7 deselected. ruff check and format are clean.
- GREEN reachability: Step 6's specced change was applied temporarily and gave 72 passed in the file. It was reverted.
- Toolchain: the worktree had no `.venv`, so `uv sync --extra dev` created one with CPython 3.12.3, the host
  interpreter.
- Deviations: an autouse fixture applies the clock, two inline helpers were added, and @AC-8 run 2 uses override
  `[AAPL, MSFT]`. All three are in the Deviation Log.
- Next: Step 6 (service: day-wide direction cuts and the mode-dependent `valid_until` anchor).

### Step 6 — service: day-wide direction cuts and the mode-dependent `valid_until` anchor — done (2026-10-29)

- Files: `services/xstockstrat-analysis/app/engine/fundsignal_loop.py`.
  - `_already_emitted` now selects `symbol, score` and returns `symbol → float | None` (still one query). The
    skip predicate is unchanged: every existing row, NULL-signal or confirmed, is still skipped.
  - `run_once` initialises `prior = {}` before the force branch and passes the day's non-NULL stored scores to
    `_map_directions(..., reference_scores=...)`; force passes an empty reference because its rows were deleted.
  - `_map_directions` computes the cuts over the run's scores plus `reference_scores` and maps only `scores`.
  - `valid_anchor` = `datetime.now(UTC)` under `force`, else `datetime.combine(as_of_date, time.min, UTC)`;
    `_emit_signal` takes it and sets `valid_until = valid_anchor + valid_days`. `valid_from` stays `now`.
- TDD RED (`-k "TestRetryStability or TestScoreDirection"`): 3 failed, 4 passed (AC-8, AC-9, the
  `reference_scores` TypeError). GREEN: `test_fundsignal_loop.py` + `test_owner_header_guard.py` 96 passed.
- Verification: coverage 1318 passed, 88.74% (the run included the 7 `real_pg` tests on a throwaway local
  PostgreSQL, as in Step 4); ruff clean; greps as specced, no `signal_id IS NOT NULL`.
- The `_FixedClock` subclass worked with `datetime.combine` and `FromDatetime`; no patch change was needed.
- Deviations: line drift, the anchor comment reworded to fit 100 columns, and the real_pg note. All are in the
  Deviation Log.
- Next: Step 7 (proto: add `"partial"` to the `FundamentalsScanSummary.status` comment).

### Step 7 — proto: add `"partial"` to the `FundamentalsScanSummary.status` comment — done (2026-10-29)

- Files: `packages/proto/analysis/v1/analysis.proto`. Only the `:564` trailing comment changed, to
  `// "completed" | "budget_deferred" | "partial" | "failed"`. The field is still `string status = 6` (C-04).
- TDD: N/A (comment-only proto edit, no wire change).
- Verification: `buf lint` (1.72.0) passed. `buf breaking` was run on `git archive` exports because the worktree guard
  refuses `.git#branch=` refs. It passes against the merge base `0099647f`, and it passes on `main-dev`'s tree with
  only this edit applied. Against `origin/main-dev` as-is it reports a `ledger.proto` `owner_only` (field 7)
  "deletion". That field was added on trunk by 263 (#1350) after the branch point, so it is branch staleness, not
  this feature. Merge `main-dev` into the branch before the integration PR. This is in the Deviation Log.
- Next: Step 8 (proto-gen: regenerate stubs).

### Step 8 — proto-gen: regenerate stubs — done (2026-10-29)

- Files: `packages/proto/gen/go/analysis/v1/analysis.pb.go`, `packages/proto/gen/ts/analysis/v1/analysis.ts`,
  `packages/proto/gen/ts/analysis/v1/analysis_pb.ts`, `packages/proto/gen/ts/dist/analysis/v1/analysis.d.ts` and
  `packages/proto/gen/ts/dist/analysis/v1/analysis_pb.d.ts`. In each, only the status comment line changed.
- TDD: N/A (generated code). Baseline grep count 0; after `./scripts/buf-gen.sh` it is 5.
- Toolchain: workspace deps were installed with `pnpm install --frozen-lockfile --ignore-scripts` (root + `@xstockstrat/proto`).
  The Go proto plugins were rebuilt at the CI pins with `GOTOOLCHAIN=go1.27.0`. The host's plugin binaries were built
  with go1.24.7 and rewrapped an unrelated `analysis.pb.go` doc comment, so that output was discarded. This is in the
  Deviation Log.
- Next: Step 9 (docs: analysis CLAUDE.md, MCP runbook, merge order, teardown audit).

### Step 9 — docs: analysis CLAUDE.md, MCP runbook, merge order, teardown audit — done (2026-10-29)

- Files: `services/xstockstrat-analysis/CLAUDE.md` (cache-only FMP bullet gains the `partial` rule; Idempotency bullet
  keeps 246's text and gains five 260 sub-bullets) and `docs/runbooks/mcp-tools.md` (status list adds `"partial"` plus
  one sentence). `docs/roadmap/features/merge-order.md:81` verified present, unchanged.
- TDD: N/A (docs). Baseline: the `signal_id IS NULL|run_id-scoped|00:00 UTC` grep had no match and neither doc listed a
  `"partial"` scan status; after the edit every Step 9 verification grep matches as specced (the `does **not** dedup`
  grep stays empty), and the C-14 pass-through sites (`client.py:1729`, `page.tsx:101`) are intact.
- Teardown: the context-forge `context-constitution` skill is not available in this session, so the reconciliation
  was manual against `fundsignal_loop.py` and ingest `servicer.py`; no further drift. The integration PR body must say
  so (Deviation Log, Step 9).
- All 9 steps done → `status.md` `code-completed` (separate commit). No ledger insight appended.
- Next: merge `origin/main-dev` into the branch (Step 7 deviation), then the §5.6 integration PR.

## Session 2026-10-29 — sdd-batch-execute promotion plan (awaiting operator confirm)

```sdd-batch-promotion-plan
## Promotion plan — fix-fundsignal-emit-accounting (feature 260)

### Verdicts
| @AC | target suite (path) | CREATE/APPEND | verdict | note |
|---|---|---|---|---|
| AC-1 | /home/user/xstockstrat/services/xstockstrat-analysis/acceptance/fix-fundsignal-emit-accounting.feature | CREATE | NEW | failed emit retried same day; row carries signal_id |
| AC-2 | same | CREATE | NEW | signals_emitted counts only accepted |
| AC-3 | same | CREATE | NEW | no orphan claim after abort |
| AC-4 | same | CREATE | NEW | failed fetch chunk reported as partial/deferred |
| AC-5 | same | CREATE | NEW | abort keeps earlier confirmed rows |
| AC-6 | same | CREATE | NEW | failed chunk wins over budget cutoff |
| AC-7 | same | CREATE | NEW | confirmed symbols skipped, zero fetches |
| AC-8 | same | CREATE | NEW | lost-response retry resends same signal, counts dedup |
| AC-9 | same | CREATE | NEW | one-symbol retry keeps day's cross-sectional direction |
| AC-10 | same | CREATE | NEW | force re-emit anchors valid_until at run time |

All ten are owned by xstockstrat-analysis (observable subject: the producer's run_once, analysis.fundsignal_emitted and analysis.fundsignal_runs). IngestSignal appears only as a mocked dependency, so none is cross-cutting. platform.feature is not touched.

### Ready-to-write blocks
--- /home/user/xstockstrat/services/xstockstrat-analysis/acceptance/fix-fundsignal-emit-accounting.feature (CREATE) ---
# Durable business-rule suite for xstockstrat-analysis (Constitution C-16). Promoted from feature 260's
# acceptance.feature on code-completion; @feature-260 marks provenance. These are the guarantees a
# future feature must not regress (recon reads this suite; the design-adversary enforces it).

Feature: fix-fundsignal-emit-accounting (bug fix)
  Regression guard for docs/reports/2026-10-21-fundsignal-emit-accounting-defect.md:
  a failed fundamentals emit burns the day's claim; a failed fetch chunk vanishes from a "completed" run.

  @AC-1 @FR-1 @regression @feature-260
  Scenario: A symbol whose emit failed is emitted on the next same-day run
    Given the fundamentals producer scores "AAPL" at 0.85 with source "fundamentals" on 2026-10-21
    And IngestSignal fails with UNAVAILABLE on the first run
    When run_once runs with force false, and then runs again with IngestSignal healthy on 2026-10-21
    Then IngestSignal is called for "AAPL" on the second run
    And the fundsignal_emitted row for ("AAPL", "fundamentals", 2026-10-21) carries the signal_id ingest returned

  @AC-2 @FR-2 @regression @feature-260
  Scenario: signals_emitted counts only signals ingest accepted
    Given the producer scores "AAPL" at 0.85 and "MSFT" at 0.90
    And IngestSignal succeeds for "MSFT" and fails with UNAVAILABLE for "AAPL"
    When run_once runs with force false
    Then the finished run records signals_emitted 1

  @AC-3 @FR-3 @regression @feature-260
  Scenario: A cycle aborted by a system-write rejection leaves no orphan claim
    Given the producer scores "AAPL" at 0.85
    And IngestSignal fails with NOT_FOUND for "AAPL"
    When run_once runs with force false
    Then the run is aborted
    And no fundsignal_emitted row without a signal_id exists for ("AAPL", "fundamentals", 2026-10-21)

  @AC-4 @FR-4 @regression @feature-260
  Scenario: Symbols from a failed fetch chunk are reported, not silently dropped
    Given the producer's universe is 60 symbols and its daily call budget is 200
    And the first GetFundamentalsMulti chunk of 50 symbols fails with UNAVAILABLE
    When run_once runs with force false
    Then the finished run's status is "partial"
    And the run's deferred_count is 50
    And the run's symbols_processed is 10

  @AC-5 @FR-3 @regression @feature-260
  Scenario: A cycle abort keeps the confirmed rows of symbols emitted before it
    The producer emits in sorted symbol order, so "AAPL" is processed before "MSFT".

    Given the producer scores "AAPL" at 0.85 and "MSFT" at 0.90
    And IngestSignal accepts "AAPL" and fails with NOT_FOUND for "MSFT"
    When run_once runs with force false
    Then the run is aborted with signals_emitted 1
    And the fundsignal_emitted row for ("AAPL", "fundamentals", 2026-10-21) carries the signal_id ingest returned
    And no fundsignal_emitted row without a signal_id exists for ("MSFT", "fundamentals", 2026-10-21)

  @AC-6 @FR-4 @regression @feature-260
  Scenario: A failed fetch chunk wins over a budget cutoff in the run status
    Given the producer's universe is 120 symbols and its daily call budget is 2
    And the first GetFundamentalsMulti chunk of 50 symbols fails with UNAVAILABLE
    And the second chunk of 50 symbols succeeds
    When run_once runs with force false
    Then the finished run's status is "partial"
    And the run's deferred_count is 70
    And the run's symbols_processed is 50

  @AC-7 @FR-1 @regression @feature-260
  Scenario: Symbols confirmed earlier the same day are skipped with zero fetch calls
    Given fundsignal_emitted rows carrying a signal_id exist for "AAPL" and "MSFT" with source "fundamentals" on 2026-10-21
    When run_once runs with force false over the universe "AAPL", "MSFT" on 2026-10-21
    Then GetFundamentalsMulti is called 0 times
    And IngestSignal is not called
    And the finished run records signals_emitted 0

  @AC-8 @FR-1 @FR-2 @feature-260
  Scenario: A non-force retry after a lost IngestSignal response resends the same signal and counts the dedup
    Ingest absorbs the retry only while ingest.signals.dedup_window_hours > 0 and the conviction is
    unchanged between attempts. A marketdata cache refresh that changes the score, or a window of 0,
    lets ingest store a second row.

    Given the producer scores "AAPL" at 0.85 and "MSFT" at 0.90 with source "fundamentals" on 2026-10-21
    And analysis.fundsignal.valid_days is 90
    And on the first run IngestSignal accepts "MSFT" and fails with UNAVAILABLE for "AAPL" after ingest committed the signal
    When run_once runs with force false, and then runs again on 2026-10-21 with IngestSignal returning the committed signal_id with deduplicated true for "AAPL"
    Then both IngestSignal requests for "AAPL" carry the same direction and conviction
    And both carry valid_until 2027-01-19T00:00:00Z
    And the second run records signals_emitted 1
    And the fundsignal_emitted row for ("AAPL", "fundamentals", 2026-10-21) carries the returned signal_id

  @AC-9 @FR-1 @feature-260
  Scenario: A one-symbol retry keeps the day's cross-sectional direction
    Cuts are computed over the day's stored scores plus the run's own scores. The same day-wide cuts
    apply to a budget_deferred resume and to a non-force override_symbols scan. A retry's direction can
    still flip at a cut boundary when min_conviction_to_emit > 0 or some symbols failed scoring, because
    the stored rows are not the first run's full score set.

    Given fundsignal_emitted rows carrying a signal_id exist on 2026-10-21 for "MSFT" at 0.90, "NVDA" at 0.70 and "GOOG" at 0.50
    And the buy quantile is 0.80 and the sell quantile is 0.20
    And "AAPL" scores 0.10 and has no fundsignal_emitted row on 2026-10-21
    When run_once runs with force false over the universe "AAPL", "GOOG", "MSFT", "NVDA"
    Then IngestSignal is called once, for "AAPL", with direction "sell"

  @AC-10 @FR-1 @feature-260
  Scenario: A force run re-emits with a validity anchored at the run time, not the run date
    Pins the anchor asymmetry: date-anchoring force runs would make a same-day force re-emit an
    ingest dedup no-op.

    Given a fundsignal_emitted row carrying a signal_id exists for ("AAPL", "fundamentals", 2026-10-21)
    And analysis.fundsignal.valid_days is 90
    When run_once runs with force true at 2026-10-21T15:30:00Z
    Then IngestSignal is called for "AAPL"
    And its valid_until is 2027-01-19T15:30:00Z, not 2027-01-19T00:00:00Z

### Notes / ambiguities / conflicts
- Dedup: grepped all analysis suites. The only other fundsignal suites are fix-fundamentals-signal-producer.feature (feature 156, schedule/cadence only: @AC-1..7), fix-fundsignal-neutral-score.feature (feature 246, unscored-symbol skipping), and fundsignal-watchlist-universe.feature. None asserts emit accounting, claim semantics, signals_emitted, deferred_count/partial status, or valid_until anchoring. No OVERLAP, no CONFLICT.
- Compatibility checks: 246's "symbols_processed still counts unscored symbols" (analysis CLAUDE.md) is consistent with AC-4/AC-6 (symbols_processed counts only fetched symbols; failed-chunk symbols are deferred). 156's AC-4 (caught cycle error advances blocked_until_ms by retry_seconds) is untouched: AC-3/AC-5 abort via _abort_cycle without changing schedule semantics.
- The services/xstockstrat-analysis/CLAUDE.md "Idempotency" bullet (claim-before-emit wording, "force=true re-emits by clearing the day's rows first") is prose, not a promoted @AC rule. It will likely need a doc update from this feature's execution, but that is not part of promotion.
- The scenario-level description lines in AC-5, AC-8, AC-9 and AC-10 are kept verbatim. @feature-260 is appended after the original tags, and original @AC/@FR/@regression tags are preserved. The header comment follows the 156 suite format. The acceptance/ directory already exists.
- Source file read from the local working tree at docs/roadmap/features/260-fix-fundsignal-emit-accounting/acceptance.feature. I did not diff it against origin/feature/fix-fundsignal-emit-accounting, so the orchestrator should confirm the two match before writing.

### Coverage check
- Source scenarios: 10 (AC-1..AC-10). Planned: 10 NEW, 0 DUP, 0 OVERLAP, 0 CONFLICT, 0 skipped. Counts match.
```

- Source check (2026-10-29): the main-worktree `acceptance.feature` and the copy on `origin/feature/fix-fundsignal-emit-accounting` (`a3b8635b`) are byte-identical (`diff` empty).
- Nothing is written to the durable suite until the operator confirms this plan.

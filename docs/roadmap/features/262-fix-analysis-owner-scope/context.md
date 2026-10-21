# Context Log: fix-analysis-owner-scope

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-10-21 (/sdd-triage)

- Bug recorded as defect report `docs/reports/2026-10-21-analysis-owner-scope-defect.md` (Issues disabled);
  sidecar `triaged` / `ref: feature:262-fix-analysis-owner-scope`.
- Source: repo-surveyor debt-radar scan `docs/repo-surveyor/debt-radar-findings.md` @ 4535695, findings D-44, D-55, D-60.
- Severity: SEV-2 (group; D-44 is the tenant finding). Impact type: cross-tenant-state-leak. Environment: dev
  (main-dev) @ a053b0e. Config-only: no.
- Operator decisions (2026-10-21): grouped by service+theme from the debt-radar scan; Track C for all SEV-2 (precedent #1264); batch launched via /sdd-batch with designGate halt.
- Routed to SDD path (Track C).
- Created: status.md, feature.md, product-spec.md, acceptance.feature (AC-1..4), context.md.
- Affected services: xstockstrat-analysis (fix site), xstockstrat-trading (`ListOrders` semantics, read-only).
- Root cause hypothesis: pre-133 "strategy_id implies owner" assumption plus trading's fail-open empty `user_id`
  (D-44); the live loop's `ValueError` guard not mirrored (D-55); leftover owner-agnostic repo methods (D-60).
- Re-verification on a053b0e: all three D-ids reproduce by reading; no line drift.
  - D-44: `entry_backfill.py:64-65` comment, `:71-73` call (unchanged); sibling `servicer.py:6316` (unchanged).
    Trading confirmed fail-open: `trading.go:1587` passes `req.UserId` to `trading_repo.go:229-231`, which adds no
    predicate when it is empty.
  - D-55: docstring `:52`, fetch `:59` (unchanged), drains `:103-108` (unchanged); also `:90`
    (`_resolve_fundamentals_universe`) and `:94` (`_drain_system_signals`) unguarded. `owner_metadata` in
    `app/identity.py:6-10`; live-loop guard `live_loop.py:393` (unchanged). Per-pair tasks are already safe
    (`gather(..., return_exceptions=True)`, `:122`).
  - D-60: `strategies.py:89` / `:110` (unchanged); 0 app callers; 30 stale `_strategies_repo.get_by_id` test
    references across `test_analysis_servicer.py` and `test_readiness_opportunities_source_symbol.py` (scan said ~15).
- **Related, not absorbed:** `docs/reports/2026-10-19-trading-listorders-body-user-id-filter-defect.md` (status `open`)
  — trading should scope non-admin `ListOrders` to `x-user-id`. Ordering hazard: if trading ships header scoping
  first, today's backfill call (no metadata) would get an empty or denied result, so it would fail closed rather than
  leak. This feature must send both the body `user_id` and `owner_metadata(user_id)` so it is correct under either
  trading behaviour.
- **Overlaps:**
  - `244-fix-python-config-stored-zero` (implementation-ready) modifies `entry_backfill.py:56-58`
    (`max_concurrent_entry_backfill` clamp). Same file, adjacent lines; rebase after 244, record in `merge-order.md`
    at /sdd-spec.
  - `259-fix-python-loop-supervision` (D-07) owns the unretained-task fix at `main.py:174`; reuse its helper rather
    than adding a second one.
  - No feature in 240–253 touches `repositories/strategies.py` `get_by_id`/`update`.
- Recommended design depth: full → `/sdd-design fix-analysis-owner-scope` (rationale: 2 affected services and a tenant
  isolation fix — the C-0 full trigger). Trading is read-only, so the operator may downgrade to
  `/sdd-design fix-analysis-owner-scope quick`. Design fork for D-60: delete both methods vs keep `get_by_id` for a
  documented internal use.
- Development branch: feature/fix-analysis-owner-scope

## Session 2026-10-21 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready. Criteria: PASS WITH WARNINGS (0 fails, 0 floor breaches).
  Overlap: WARN (file-level only; no config-key, proto field or migration collision).
- OPERATOR DECISIONS (binding, recorded 2026-10-21):
  - Grouped by service+theme from the 2026-10-20 debt-radar scan; Track C.
  - Scope is D-44, D-55, D-60; the trading-side ListOrders report stays separate.
- Warnings:
  - C-15 / criterion 8: AC-3 covered only the `ValueError` (system-owned row) case of FR-3. **Resolved**: added
    `@AC-8` (non-`ValueError` drain failure: a portfolio RPC error from owner `u-b`'s held-symbols drain).
  - Criterion 8: AC-3's skipped strategy had no id. **Resolved**: named `"s-sys"`; the Then now asserts a warning
    naming strategy `"s-sys"` and owner `"system"`.
  - Criterion 2 / FR-4: "run_once never raises" leaves `entry_backfill.py:90` (`live_loop._resolve_fundamentals_universe`,
    the blend-universe resolve) uncovered by any FR/AC; `:100` (`_row_to_strategy_definition`) and `:112`
    (`resolve_universe`) are arguably within FR-3's "preparing one owner". **Open for /sdd-design**: decide whether
    `:90` failure degrades to an empty blend universe (state it in FR-4 + add an AC) or is scoped out.
  - Criterion 2 / FR-1: per-pair isolation of an `owner_metadata` failure inside `_backfill_pair` was unstated.
    **Resolved**: FR-1 now states a failure affects only that `(strategy, symbol)` pair (pairs are gathered with
    `return_exceptions=True`, `:122`).
  - Trading-domain (advisory): no scenario uses a `PARTIALLY_FILLED` order, so the C-5 "unchanged" claim is untested.
    Left for /sdd-spec to cover in an existing `_infer_open_entry_time` test if cheap.
- Overlap findings:
  - `services/xstockstrat-analysis/app/engine/entry_backfill.py` vs `244-fix-python-config-stored-zero`
    (implementation-ready; `:56-58` clamp). Line-disjoint, rebase-only; 244 merges first (recorded plan).
  - `entry_backfill.py` + `app/main.py:174` (unretained task) vs `259-fix-python-loop-supervision` (draft). Ownership of
    the supervised-loop helper is an unresolved fork between the two specs; 259 context.md:37-38 says 259 owns it and
    262 reuses it. /sdd-design must settle this (262's FR-3/FR-4 are in-function guards and do not need the helper).
  - `services/xstockstrat-analysis/tests/test_analysis_servicer.py` (FR-6 retarget of 30 stale `get_by_id` mocks) vs
    `215-block-fundamentals-strategy-on-etf` (in-progress), `244`, `245-fix-screener-symbol-isolation`
    (implementation-ready). Highest-churn overlap; expect rebase conflicts in mock setup — sequence after 215.
  - `tests/test_readiness_opportunities_source_symbol.py` (FR-6, `:61`, `:189`): no peer touches it.
  - Context only: xstockstrat-trading is read-only here (`trading_repo.go` not edited; 267/241/242 touch
    `trading.go`). Shared analysis service dir with 215, 242, 244, 245, 246, 259, 272 — disjoint files.
  - merge-order.md has no 262 entry; no FAIL-level overlap, so none required. Optional soft rows for /sdd-spec:
    262 after 244 (`entry_backfill.py`); 262 coordinated with 259 (`main.py:174`).
- Next: `/sdd-design fix-analysis-owner-scope`.

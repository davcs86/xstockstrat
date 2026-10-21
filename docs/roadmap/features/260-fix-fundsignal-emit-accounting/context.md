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

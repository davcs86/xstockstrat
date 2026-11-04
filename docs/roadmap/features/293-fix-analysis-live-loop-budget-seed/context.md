# Context Log: fix-analysis-live-loop-budget-seed

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-04 (/sdd-triage)

- Bug reported via defect report `docs/reports/2026-11-04-analysis-live-loop-chronic-budget-overflow-defect.md` (Issues disabled)
- Severity: SEV-3; routed to Track B (config-only) first. The operator asked for BOTH the config write and the durable fix.
- Track B applied on staging: `set_config analysis.engine.max_strategies_per_cycle = 200 (int, create_key=true)`; propagation verified in Loki (`max_strategies_per_cycle=200`, 200/690 pairs in 23.6s, rotation ~4 cycles). Value 200 was chosen by the assistant (operator gave no number) — revisit.
- This feature is the durable fix: seed migration + steady-state WARN handling.
- Recommended design depth: full -> `/sdd-design fix-analysis-live-loop-budget-seed` (rationale: DB/config-service migration is an escalate signal; analysis + config = 2 services)
- Number 293 reserved via scripts/sdd-allocate-feature-number.sh; 292 was reserved earlier and not used (burned).
- Development branch: feature/fix-analysis-live-loop-budget-seed

---

## Session 2026-11-04 — sdd-review product-spec (verdict FAIL → spec revised)

- First review: FAIL, 5 blockers (no FR-N; migration strategy unstated; AC-1 contradiction — `DO NOTHING` cannot give the runtime-created staging row a description/default because `SetConfig create_key=true` inserts only `namespace, key, value_type, value_data, …` (`configServiceImpl.ts:633-646`); acceptance malformed; no Consumer Surface(s)). Overlap: no duplicate key; migration-number reservation (035 = 291, 037 on 281's branch — verified on `origin/feature/signal-watchlist-expiry-pruning`); same-region edit with 294 in `live_loop.py`.
- Revised product-spec + acceptance: FR-1..FR-6 (seed int 50 for staging+production; metadata backfill that never touches `value_data`; `SetConfig` bounds min 1 / max chosen in design from cycle duration vs the 60 s interval; wiring-baseline entry removal at `scripts/config-wiring.json:84-89`; overflow WARN once per (pair count, budget) state change with the INFO summary and counter unchanged; rollback removes only rows still holding the seeded 50); migration number intentionally NOT hard-coded (next free, higher than every claimed number, re-verified before merge; merge-order row added); approvals named; existing tests that will change identified (`test_live_loop.py:759-780`, `:783-808`); PRESERVE `platform.feature:496`; Consumer Surface(s) stated (config-ui / `list_config_keys` / `set_config` generic, no code change). Decisions made by the assistant, for operator sign-off: the rollback rule (FR-6), bounds minimum 1, and the staging 200 (assistant-chosen) to be confirmed or re-set.
- Status stays `draft` until the revised spec is re-reviewed.

---

## Session 2026-11-04 — sdd-review product-spec (second pass; approved)

- Second pass: PASS WITH WARNINGS (0 blockers). All 7 warnings addressed in this session: (W1) the seed is now `INSERT … ON CONFLICT … DO NOTHING` + a guarded metadata-only `UPDATE … COALESCE(NULLIF(col,''), …)` — verified against `scripts/check-config-wiring.mjs` `applyInsert` (accepts only no-`ON CONFLICT` or `DO NOTHING`; `DO UPDATE` exits 2 "shape not understood"), precedent 244's `032_analysis_zero_trap_descriptions.up.sql`; audit trigger verified value-only (`017_…:69`), no `pg_notify` from migrations; (W2) FR-3 carries a candidate maximum of 400 (≈0.12 s/pair vs the 60 s interval) with AC-6 for the maximum — an ASSISTANT-CHOSEN candidate for `/sdd-design` to confirm; (W3) only `test_live_loop.py:783-808` changes, `:759-780` is PRESERVE; (W4) FR-5 state is (over budget?, budget), not the pair count — drift no longer re-warns; volume target ≤ 1 WARN per episode+budget; state cleared on falling under budget and per live-loop instance; (W5) down migration limited to global rows (`user_id IS NULL`), metadata backfill not reverted, per-user override case in AC-7; (W6) merge-order row added for 293 ↔ 281; (W7) AC-2/AC-4 numbers made explicit, AC-9 removed (duplicate of `platform.feature:496` / `test_config_zero_clamps.py:34`; no test cited it yet) — the rule is PRESERVEd in the product spec.
- Overlap scan (warn-level only): `live_loop.py` region shared with 294; migration numbering vs 291 (035) and 281 (037) → merge-order rows.
- Recommended design depth: full (config-service DB migration + 2 services). Status: draft → spec-ready.
- Decisions made by the assistant for operator sign-off: rollback rule (FR-6), bounds minimum 1 and candidate maximum 400, the state definition for FR-5, and that staging's 200 (assistant-chosen) is confirmed or re-set by the operator.

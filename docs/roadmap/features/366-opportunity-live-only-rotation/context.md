# Context: opportunity-live-only-rotation

**Feature**: `docs/roadmap/features/366-opportunity-live-only-rotation/feature.md`
**Product Spec**: `docs/roadmap/features/366-opportunity-live-only-rotation/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/366-opportunity-live-only-rotation/implementation-spec.md`

---

## Session 2026-11-26 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- Origin: staging vs homelab staging opportunity comparison (2026-11-25/26). AAPL on homelab got only its watchlist-bound dip_buyer_vol_stop row; squeeze_breakout_trend / fundamentals_macd_blend rows went only to the top 20 live-only symbols (exactly 20 symbols / 40 rows from a ~350 pool).
- OPERATOR DECISIONS (2026-11-26, verbatim choices from the question dialog):
  - Semantics: "Rotate across passes" — each compute evaluates the next chunk of max_live_only_symbols_per_compute symbols from a persisted cursor (chosen over "All chunks, one pass" and "All chunks, budgeted").
  - Scope: "Live-only cap only" — max_live_held_symbols_per_compute out of scope.
  - Process: "SDD: story + design full".
- C-16 CHANGE: this reverses feature 131's rejection of cross-pass carried state for the live-only cap (131 context.md:12) and changes 131's AC-8 rule (live-only cap = truncation). 131's scenarios were archived without promotion to a durable suite, so the rule lives only in 131 context.md and services/xstockstrat-analysis/CLAUDE.md (key table). Operator sign-off is the "Rotate across passes" decision above; design must restate it.
- Raised for design (product-spec Open Questions): coverage latency ≈ ceil(P/N) daily computes (~18 days for P≈350, N=20); carried-row valid_until semantics; rotation order under churn; persistence shape vs replace_for_user; reuse of live_loop's scheduler; no behavioral test pins the current cap.

## Session 2026-11-26 — cursor store decision

- OPERATOR DECISION: "yes, use postgres" — rotation cursor persists in Postgres, not Redis. Rationale given: no Redis anywhere in the stack (compose, .do, deploy, service deps); cursor must commit in the same transaction as the queue rows (a split write skips or repeats a chunk, breaking FR-2/FR-6); state is one value per user per ~daily compute; FR-5 restart-survival is free in Postgres; Redis would add a new service in both environments, mTLS wiring (feature 210) and a new failure mode. Preferred shape: cursor column on analysis.opportunity_compute_state (migration 023). Redis does not address the coverage-latency question (cadence-bound, not store-bound).

## Session 2026-11-26 — sdd-review product-spec (round 1: FAIL → revised)

- Tree: c166919 (feature/opportunity-live-only-rotation == origin, main-dev merged).
- Demoted-duplicate check: operator answered "No" — not a re-attempt.
- spec-reviewer round 1: FAIL — criterion 7 (migration strategy unstated, contradictory checkbox), criterion 8 (AC-5 non-observable; AC-2/AC-6 "evaluated" wording; FR-6 removals and FR-7 caps unpinned), criterion 9 (7 open questions unchecked). No Floor breach.
- feature-overlap: no FAIL-level collision. WARN: same function/file as in-flight 308-fix-analysis-per-symbol-isolation (`_compute_opportunities`, `opportunities.py`; 308 debate.md R-4 locks "never drop held/watchlist/muted rows on a failure path") and 330-fix-live-enrich-ttl-seed (`_compute_opportunities` bars request). Spec's "migration 023" was the existing table's creator, not the new migration's number (next free analysis NNN ≥ 030). 364/365 live on PR #1605's branch, not in this checkout.
- OPERATOR DECISIONS (question dialog, verbatim choices):
  - Coverage latency: "Bound the cycle" → FR-2/FR-2a; new key `analysis.opportunity.live_only_cycle_max_days` (int, default 3, bounds [1,30]). The 3-day value is the default the option proposed; a config key, not a literal, per the no-hardcoded-values rule. Per-compute limit wins over the cycle bound, with a recorded shortfall (FR-2a) — orchestrator-stated default, open to operator correction at the design gate.
  - Carried-row freshness: "Keep own age, max age" → FR-8 (row keeps its own computed_at/valid_until; dropped after one full cycle). Existing per-row `valid_until` ("expires" label) carries it — no proto change; an explicit per-row "as of" cue is a design decision.
  - Remaining open questions: "Yes, defer to design" — rotation order, persistence shape vs replace_for_user, C-16 CHANGE restatement, live_loop scheduler reuse, test gap, 308/330 overlap. /sdd-design must resolve each.
- Revisions: product-spec FR-2/FR-2a/FR-3/FR-8, Config Key Changes (new key contract + meaning change of max_live_only_symbols_per_compute), Database Changes (additive ALTER, NNN ≥ 030 re-derived at /sdd-spec, up/down, db-migrate), Consumer Surface UI note; acceptance.feature AC-2/AC-3/AC-5/AC-6 reworded to observable row outcomes, AC-8..AC-12 appended (IDs append-only; AC-1..AC-7 keep their original subjects).

## Session 2026-11-26 — sdd-review product-spec (round 2)

- Product spec approved. Status: draft → spec-ready. Tree: 96a77f2.
- Warnings (carry into /sdd-design):
  - Pin the FR-8 age boundary (`>` vs `>=` at exactly one cycle) so a carried row cannot vanish just before its re-evaluation lands; add a scenario. Cover FR-2a × FR-8 (oversized pool: carried rows aging out when the cycle cannot complete).
  - Update `docs/patterns/config-governance.md:538` and `services/xstockstrat-analysis/CLAUDE.md:274` (cap → chunk-limit meaning); line 538 also says `get_int` but the reader uses `int_positive` — correct it.
  - Confirm AC-9's held-attribution semantics against `servicer.py` at /sdd-spec.
  - Resolve every DEFERRED item; treat 308 debate.md R-4 ("never drop held/watchlist/muted rows on a failure path") as a hard constraint on the carried-row merge.
- Overlap findings: WARN only — 308 (same function + opportunities.py), 330 (same function). No FAIL-level overlap; no merge-order write required.
- Recommended design depth: full (operator choice; also escalated by the schema migration).

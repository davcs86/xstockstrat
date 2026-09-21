# Recon: symbol-opportunity-ranking

**Created**: 2026-09-20
**From**: product-spec.md
**Affected services**: xstockstrat-analysis, packages/proto, xstockstrat-ui, xstockstrat-agent, xstockstrat-config

---

## Objective

A single comparable symbol-level `symbol_score` that rolls up a symbol's opportunity rows via a
diminishing-returns sum of `(feature-199 composite_score × strategy_weight)`, where
`strategy_weight = feature-065 derived-grade weight × operator per-strategy override`, so a trader can
rank *which symbol to trade*. Exposed as a new opt-in sort on the `/insights` queue and to the MCP
agent. **Layers on feature 199** (consumes `composite_score`).

## Codebase Map

- **`xstockstrat-analysis`** (Python)
  - Opportunity compute (roll-up site): `_compute_opportunities` — `app/handlers/servicer.py:3861`; candidates keyed `(symbol, strategy_id)` — `servicer.py:3962`; persisted via `_replace_and_stamp_compute_state` → `replace_for_user` (whole-user delete+bulk insert) — `servicer.py:3599`, `opportunities.py:68`
  - Read/sort: `ListOpportunities` pure read forwarding `request.sort` — `servicer.py:3378,3416`; `_SORT_ORDER_BY` (0 blended / 1 CONVICTION / 2 EXPIRY), each `… OVER (PARTITION BY o.symbol) … , o.opportunity_key ASC` — `opportunities.py:33,35`
  - Strategy grade (strategy_weight input): `_grade()` A–F — `servicer.py:5174`; `_score_from_metrics`/`_aggregate_cells` — `servicer.py:5145,5187`; **batch in-memory cache** `self._strategies[strategy_id] = _row_to_score(...)` loaded at boot by `hydrate_scores()` — `servicer.py:2260`; `_row_to_score` carries `overall_score`/`rating`/`provisional`/`evidence_*` — `servicer.py:5407`; cache table `analysis.strategy_scores` (migration 005, PK strategy_id) via `StrategyScoresRepository.get_by_id/.list` — `app/repositories/strategy_scores.py:32-88`
  - Owner scoping: cache is **global, keyed by bare `strategy_id`** (no user column); per-user gating = intersect with owner's ids, as `ListStrategies` does — `servicer.py:2273`
  - `strategy_id` on the row: INSERT col — `opportunities.py:82`; SELECT — `opportunities.py:179`; proto `Opportunity.strategy_id = 7` — `analysis.proto:565`; `opportunity_key = user|symbol_norm|strategy_id` — `analysis.proto:568`
  - Config read: `get_float_present` — `app/config/watcher.py:132` (use site `servicer.py:3885`)
  - Migration tip on this branch: **`023_opportunity_compute_state`** (CLAUDE.md's 024–028 are drift, absent on disk); 199 reserves `024` → 200 = **`025`** if persisted
- **`packages/proto`**: `OpportunitySort { UNSPECIFIED=0; CONVICTION=1; EXPIRY=2; }` — `analysis.proto:541`; `ListOpportunitiesRequest.sort = 5` — `analysis.proto:642`; `Opportunity` message, next free field **21** *after* 199's `composite_score=21* — see Risks* — `analysis.proto:558-593`
- **`xstockstrat-ui`** (Next.js): queue is **server-sorted, client-grouped** (Map insertion order over pre-sorted rows) — `src/app/insights/opportunities/page.tsx:157-167`; sort `Select` (Conviction/Expiry only) — `page.tsx:258-266`; `SortKey` union (add the option here) — `page.tsx:51`; UI→enum map — `page.tsx:99-100`; request threading — `src/hooks/useOpportunities.ts:27,30`; BFF transparent forward — `src/lib/insightsBff.ts:54`; no `Record<OpportunitySort,…>` exhaustive map exists (no tsc break) — `src/lib/opportunityShared.tsx`
- **`xstockstrat-agent`** (Python): `_opportunity_to_dict` explicit projection — `app/client.py:747-799`; `list_opportunities` does NOT set `sort` today — `client.py:802-833`; descriptor-parity guard — `tests/test_opportunity_projection.py:50`; tool wrapper — `app/tools.py:1229`

## Patterns to REUSE

- Roll-up compute site → **reuse `_compute_opportunities`'s candidates dict** (`servicer.py:3962`): after all `(symbol, strategy_id)` candidates for a symbol are known, compute `symbol_score` once per symbol and stamp it on each row dict. No new fetch/RPC (reuses already-drained rows — PRESERVE latency `@AC-6..9/191`).
- Strategy grade → **reuse `self._strategies` in-memory cache** (`servicer.py:2260`) + the owner-intersect scoping (`servicer.py:2273`). No per-strategy DB call. `provisional`/absent handled from the `StrategyScore` proto.
- Sort → **reuse the `_SORT_ORDER_BY` branch pattern** (`opportunities.py:33`): add branch `3` ordering by `MAX(o.symbol_score) OVER (PARTITION BY o.symbol) DESC, o.symbol ASC, o.opportunity_key ASC` — keeps grouping/contiguity (`@AC-8/9`).
- Persist → **reuse `replace_for_user`** write path + best-effort try/except; `symbol_score` is one added INSERT column (same value repeated across a symbol group).
- Config → **reuse `get_float_present`** for the saturation param + grade-weight map + overrides.
- UI → **reuse the server-order render** (no client re-sort, `@AC-15`) + `scoreColor` for display; add one `SortKey`/enum option.
- Agent → **extend `_opportunity_to_dict`** + descriptor-parity test + `mcp-tools.md` in the same PR.
- Per-opportunity quality input → **feature-199 `composite_score`** (not-yet-landed dependency).
- Cardinal guard → **extend feature-199's `ANALYSIS-10` invariant** to `symbol_score`.

## Existing Business Rules (preserve / extend)

- **PRESERVE (CHANGE risk — needs sign-off if flipped)** `@AC-10 @feature-190` "Conviction sort is the default" (`services/xstockstrat-analysis/acceptance/opportunities-server-side-filters.feature`) — `UNSPECIFIED==CONVICTION`; `symbol_score` must be an **opt-in** sort value, default stays conviction. Making it default is a CHANGE requiring sign-off.
- **PRESERVE** `@AC-15 @feature-190` (UI) "client does not re-sort" — `symbol_score` ordering computed **server-side**; SymbolGroupCard renders server order verbatim.
- **EXTEND** `@AC-8 @feature-190` — new sort value must keep symbol grouping. **PRESERVE** `@AC-9` — a symbol's rows stay contiguous. **PRESERVE** `@AC-13` — pagination traverses the sorted result stably.
- **EXTEND** `@AC-14 @feature-190` (UI) — the sort toggle refetches in place, no client transform.
- **PRESERVE** `@AC-1/@AC-2/@AC-3 @feature-190` — per-opportunity min-conviction floor + muted/data-unavailable survival unchanged (symbol_score is an ordering axis, not a floor).
- **PRESERVE** `@AC-1/@AC-6 @feature-176` — deterministic + rank-order-stable under concurrent fan-out; per-user owner scoping (no cross-user strategy attribution).
- **PRESERVE** `@AC-6..9 @feature-191` + `@AC-1 @feature-191` (UI 30s deadline) — reuse already-drained rows, no new per-symbol RPC, stay in the bars-fetch bound + deadline.
- **PRESERVE** `@AC-14 @feature-095` — no live-quote look-ahead into the ranking (built from composite_score×strategy_weight only).
- **PRESERVE** `@AC-1/@AC-2 @feature-185` — unavailable sentinel ≠ evaluated 0/N; quiet 0/N rows contribute their real composite_score. **PRESERVE** `@AC-3 @feature-185` (UI) — unavailable cue preserved under the new ordering.
- **EXTEND** `@AC-10 @feature-185` (agent) — descriptor-parity guard must cover any new `symbol_score` field. **PRESERVE** `@AC-15 @feature-095` (agent) — omit-not-fabricate projection contract.
- **EXTEND** `@AC-9 @feature-155` (UI mobile) — reorder symbol groups, keep grouping-by-symbol. **PRESERVE** `@AC-10 @feature-155` — keep per-signal strategy/source/expiry tags.
- **PRESERVE** `@AC-5 @feature-150` / `@AC-3 @feature-149` — feature-065 grade derivation is a **read-only** input to strategy_weight; must not be altered.
- No promoted `@AC-*` exists for feature-199 `composite_score` or the feature-190 rank blend as standalone durable rules — do not invent one; the nearest determinism guarantees are the feature-065 grade scenarios.

## Dependencies

- **Hard dependency: feature 199** — consumes `Opportunity.composite_score` (not yet in proto/code; 199 is `implementation-ready`). 200 must merge after 199; re-derive proto field + migration NNN from the merged tree (blocking row in merge-order.md).
- Proto/RPC: additive `OPPORTUNITY_SORT_SYMBOL_SCORE = 3` on `OpportunitySort` (`analysis.proto:541`) + a `symbol_score` surface (per-row field on `Opportunity`, next-free after 199's 21, or a symbol-group message — design decides). Non-breaking; regen `gen/`.
- Migration: **`025`** (after 199's `024`) if `symbol_score` is persisted; nullable column on `analysis.opportunities`.
- Config keys (new, `analysis`): saturation param (`analysis.opportunity.symbol_score_saturation` or similar), grade→weight map (`analysis.scoring.strategy_grade_weight_*`), per-strategy operator override — **override key shape is an Open Question** (4-segment dynamic key vs one structured value; no 4-segment precedent).
- Inter-service edges: none new (grade already in-memory; composite already on the row post-199).

## Risks / Not-found

- **`composite_score` not landed** (feature 199 `implementation-ready`, not executed) — the roll-up's per-row input does not yet exist in proto/code. 200 cannot execute before 199 merges (merge-order).
- **Diminishing-returns sum is not a SQL window aggregate** — it is a rank-dependent ordered fold; Postgres `MAX/SUM OVER (PARTITION BY symbol)` cannot express it. → compute `symbol_score` **app-side** in `_compute_opportunities` and **persist** it per-row, then sort by `MAX(symbol_score) OVER (PARTITION BY symbol)`. (Read-time computation would need a new post-`read()` grouping pass that does not exist today.)
- **Default-sort CHANGE risk (`@AC-10 @feature-190`)** — keep `symbol_score` opt-in; making it the default needs user sign-off. Surface at the gate.
- **Cardinal guard (`fails.md:313`/`:418`)** — `symbol_score` is another ranking ordinal (composite ordinals × grade weights); must never become a cardinal sizing/alert input. Extend feature-199's `ANALYSIS-10` invariant + a proto doc-comment.
- **Grade scoping** — the score cache is global by bare `strategy_id`; the roll-up must gate per-user (owner-intersect) so it never weights by another user's strategy grade.
- **Provisional/absent grade → neutral fallback weight** (FR-4/FR-7), never 0 (would zero a legitimate opportunity from an unproven strategy). Fallback value is an Open Question.
- **Override key shape** (C-05) — 4-segment dynamic key has no precedent; design decides dynamic-key vs structured value.
- Soft same-file rebase overlap with 199/187/193/188 on `servicer.py`, `opportunities.py`, `page.tsx`, agent `client.py`.

## Recommended Scope

Advisory (grilling + `/sdd-spec` refine): (1) proto `OPPORTUNITY_SORT_SYMBOL_SCORE=3` + `symbol_score` surface + regen; (2) migration `025` nullable `symbol_score` column; (3) config keys (saturation + grade-weight map + override); (4) analysis roll-up pure-function (diminishing-returns sum over a symbol's `composite_score×strategy_weight`, grade from `self._strategies` owner-scoped, provisional fallback) wired into `_compute_opportunities` + persisted + the new sort branch + unit tests; (5) agent projection + parity + docs; (6) UI sort option (server-driven) + display + fixtures; (7) UI e2e. **Gate-0 for the debate:** the diminishing-returns function shape (worked against the two mandatory examples), the grade→weight map + provisional fallback, and the override key shape.

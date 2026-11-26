# Product Spec: opportunity-live-only-rotation

**Created**: 2026-11-26

---

## Problem Statement

`_compute_opportunities` (step 2b, `services/xstockstrat-analysis/app/handlers/servicer.py`
~5532-5555) gives live-strategy rows to only the top `opportunity.max_live_only_symbols_per_compute`
(default 20) non-held, live-covered signal symbols, ranked by signal conviction. Every other symbol in
the pool is permanently excluded while the ranking holds. On homelab staging the pool is ~350 symbols,
the compute produced exactly 20 symbols / 40 rows (20 `fundamentals_macd_blend`, 20
`squeeze_breakout_trend`), and AAPL — watchlisted, with an active fundamentals signal, covered by both
strategies — never gets those rows.

## User Story

As a trader, I want every non-held signal symbol that a live strategy covers to eventually get that
strategy's opportunity row, so that symbols outside the top 20 by signal conviction (e.g. AAPL on
homelab staging) are not permanently excluded from the Decide queue.

## Functional Requirements

FR-1. Each opportunity compute evaluates at most `opportunity.max_live_only_symbols_per_compute`
live-only symbols (per-compute cost bound unchanged), taken as the **next chunk** of the user's
live-only pool after the chunk the previous compute evaluated.

FR-2. With an unchanged pool of P symbols and chunk size N, every symbol in the pool receives its
live-strategy rows within ceil(P / N) consecutive computes.

FR-3. Live-only rows produced by an earlier chunk stay in the queue across later computes (they are not
removed by a later compute's replace) until the symbol is evaluated again in its next turn or leaves
the pool.

FR-4. When a symbol leaves the live-only pool (its signal expires, it becomes held, it loses live
coverage, or it is deny-listed for that strategy), its carried live-only rows are removed by the next
compute.

FR-5. The rotation position is per user and survives a service restart or redeploy.

FR-6. The rotation order is deterministic and fair under pool churn: a symbol that joins the pool is
evaluated within one full cycle, and pool additions/removals never cause an existing member to be
skipped for more than one full cycle.

FR-7. Watchlist-bound rows, held rows, `opportunity.max_live_held_symbols_per_compute`, and
`opportunity.max_live_strategies_per_symbol` behave exactly as today.

## Out of Scope

- `opportunity.max_live_held_symbols_per_compute` (held-symbol live attribution) — operator decision
  2026-11-26.
- Event-driven queue invalidation on watchlist / position / signal change (separate capability).
- Changing `opportunity.max_universe_size` or the watchlist/held ranking above the cut.
- The filtered-empty recompute defect (feature 365).

## Affected Services

- `xstockstrat-analysis` — opportunity compute step 2b, queue persistence (`replace_for_user`), rotation
  state.

## Consumer Surface(s)

_Constitution **C-14**._

- [x] **UI** — `xstockstrat-ui` `/insights/opportunities` and `/trader/positions/[symbol]`: no code
  change; additional live-attributed rows surface through the existing queue views.
- [x] **Agent** — `xstockstrat-agent` MCP tool `list_opportunities`: no response-mapping change; the
  additional rows appear in its existing output.
- [ ] **None**

## Proto Contract Changes

- [x] No proto changes required

## Config Key Changes

- [ ] No new config keys — to be confirmed at design: the chunk size reuses
  `analysis.opportunity.max_live_only_symbols_per_compute`; its meaning changes from "cap" to "chunk
  size" (description/default review, C-05).

## Database Changes

- [ ] No schema changes
- The persisted rotation cursor (FR-5) lives in **Postgres** (operator decision 2026-11-26; Redis
  rejected — not in the stack, and the cursor must commit atomically with the queue rows it produced).
  Preferred shape for design to confirm or reject: a cursor column on the existing per-user
  `analysis.opportunity_compute_state` (migration `023`), written in the same transaction as the
  compute's queue replace. A new analysis migration → DBA review + service owner.

## Feature Workflow Notes

Branch to create: `feature/opportunity-live-only-rotation` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking proto or config change)
- [ ] 2 service owners + platform lead (breaking proto change)
- [x] DBA review + service owner (schema migration) — cursor column in the `analysis` schema

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

- [ ] **Coverage latency (blocking for design).** Computes run about once a day (daily refresh at
  `opportunity.refresh_hour_utc` plus stale-read revalidation when `valid_until` lapses). With P≈350
  and N=20, a full cycle takes ~18 computes ≈ 18 days, and a just-evaluated row's trace is up to 18
  days old by its next turn. Is that acceptable, or must design pair rotation with a larger chunk, more
  frequent computes, or a staleness bound on carried rows?
- [ ] **Carried-row freshness.** `valid_until` is uniform per compute (`servicer.py` ~5955-5963); a
  carried row would either inherit the new compute's `valid_until` (claiming a freshness its trace does
  not have) or keep its own (making the queue's validity mixed). Which, and how is it shown to the user?
- [ ] **Rotation order.** Stable order (e.g. normalized symbol) vs. conviction order recomputed each
  pass — conviction order changes between passes and can starve or repeat symbols (FR-6).
- [ ] **Persistence shape.** Merge carried rows into `replace_for_user`'s DELETE+INSERT, or split the
  live-only rows into a separately-replaced subset.
- [ ] **Known trap (C-16 CHANGE).** Feature 131 rejected cross-pass hysteresis because
  `replace_for_user` is a stateless DELETE+INSERT and carried state "for a ~daily cosmetic risk violates
  the write-minimum bias" (`131-live-strategy-opportunity-attribution/context.md:12`). This feature
  deliberately reverses that for the live-only cap (operator decision 2026-11-26); design must state the
  CHANGE explicitly and keep the per-compute bound that 131's caps exist for (`context.md:23` — curated
  rows bypass `max_universe_size`, so every curated-injecting path needs its own per-request cap).
- [ ] **Known trap (ledger).** `docs/roadmap/ledger/insights.md` 2026-08-03 records that `live_loop`'s
  cap "truncates rather than round-robins" while `docs/opportunities.md` describes the live loop as a
  fair-share rotating scheduler — recon must establish which is current and whether its rotation can be
  reused rather than re-invented. `fails.md` (2026-08 coverage_gaps): compute any diagnostic from the
  full pool before chunking.
- [ ] **Test gap.** No behavioral test pins the current cap (only `tests/test_config_read_classification.py`
  and `tests/test_config_zero_clamps.py` reference the key); the rotation needs its own RED tests.

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

FR-2. With an unchanged pool, every symbol in the pool receives its live-strategy rows within
`analysis.opportunity.live_only_cycle_max_days` (default 3) calendar days, without any single compute
evaluating more than the per-compute limit. The mechanism (chunk sizing, extra rotation passes,
rotating on stale-read recomputes) is a design decision.

FR-2a. When the pool is too large to cover within the cycle bound at the per-compute limit, the
per-compute limit wins: the compute stays bounded and records the shortfall (an observable metric /
log naming the user, pool size and projected cycle length) instead of exceeding the limit.

FR-3. Live-only rows produced by an earlier chunk stay in the queue across later computes (they are not
removed by a later compute's replace) until the symbol is evaluated again in its next turn, leaves
the pool, or exceeds the carried-row age limit (FR-8).

FR-4. When a symbol leaves the live-only pool (its signal expires, it becomes held, it loses live
coverage, or it is deny-listed for that strategy), its carried live-only rows are removed by the next
compute.

FR-5. The rotation position is per user and survives a service restart or redeploy.

FR-6. The rotation order is deterministic and fair under pool churn: a symbol that joins the pool is
evaluated within one full cycle, and pool additions/removals never cause an existing member to be
skipped for more than one full cycle.

FR-7. Watchlist-bound rows, held rows, `opportunity.max_live_held_symbols_per_compute`, and
`opportunity.max_live_strategies_per_symbol` behave exactly as today.

FR-8. A carried live-only row keeps the `computed_at` and `valid_until` of the compute that produced
it (it never inherits a later compute's freshness), and is removed once it is older than one full
cycle (`analysis.opportunity.live_only_cycle_max_days`). The queue's per-row `valid_until` is therefore
mixed; the existing per-row "expires" label shows each row's own value.

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

- [x] **UI** — `xstockstrat-ui` `/insights/opportunities` and `/trader/positions/[symbol]`: additional
  live-attributed rows surface through the existing queue views; a carried row's own age shows through
  the existing per-row "expires" label (`Opportunity.valid_until`,
  `src/app/insights/opportunities/page.tsx:86,537`). Whether carried rows also need an explicit "as of"
  cue (which would add a per-row `computed_at` proto field and a UI change) is a design decision.
- [x] **Agent** — `xstockstrat-agent` MCP tool `list_opportunities`: no response-mapping change; the
  additional rows appear in its existing output.
- [ ] **None**

## Proto Contract Changes

- [x] No proto changes required

## Config Key Changes

- `analysis.opportunity.live_only_cycle_max_days` — new. Namespace `analysis`, stored key
  `opportunity.live_only_cycle_max_days`, `value_type` int, code default `3`, bounds `[1,30]`
  (config-service `SCALAR_BOUNDS_REGISTRY`). Reader: `services/xstockstrat-analysis/app/handlers/servicer.py`
  `_compute_opportunities` via `int_positive`, read once per compute pass. Seed: a new
  `xstockstrat-config` migration (next free config NNN, derived at `/sdd-spec`). Live mechanism:
  WatchConfig. Bounds both the full-rotation time (FR-2) and the carried-row age limit (FR-8).
- `analysis.opportunity.max_live_only_symbols_per_compute` — existing (config migration `028`,
  reader `servicer.py:5543`), unchanged key, default and bounds; its meaning changes from "cap
  (truncate)" to "per-compute chunk limit" — the description in `services/xstockstrat-analysis/CLAUDE.md:274`
  and `docs/patterns/config-governance.md:538` is updated in this feature (C-05). Not to be confused
  with analysis migration `028_seed_strategy_templates`.

## Database Changes

- [ ] ~~No schema changes~~ — one additive analysis migration.
- The persisted rotation cursor (FR-5) lives in **Postgres** (operator decision 2026-11-26; Redis
  rejected — not in the stack, and the cursor must commit atomically with the queue rows it produced).
- Strategy: a new `services/xstockstrat-analysis/migrations/NNN_<name>.up.sql` + `.down.sql`, with NNN
  the next free analysis number (`030` or higher on today's trunk; re-derived from the merged tree at
  `/sdd-spec`). Preferred shape for design to confirm or reject: `ALTER TABLE
  analysis.opportunity_compute_state ADD COLUMN` (nullable, additive; the table was created by migration
  `023`), written in the same transaction as the compute's queue replace. Down migration drops the
  column. Runs in the normal analysis order via `scripts/db-migrate.sh`. DBA review + service owner.

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

- [x] **Coverage latency** — RESOLVED 2026-11-26 (operator: "Bound the cycle"): FR-2 / FR-2a, key
  `analysis.opportunity.live_only_cycle_max_days` (default 3). Mechanism deferred to design.
- [x] **Carried-row freshness** — RESOLVED 2026-11-26 (operator: "Keep own age, max age"): FR-8.
- [x] **Rotation order.** DEFERRED to `/sdd-design` (operator decision 2026-11-26, context.md) — Stable order (e.g. normalized symbol) vs. conviction order recomputed each
  pass — conviction order changes between passes and can starve or repeat symbols (FR-6).
- [x] **Persistence shape.** DEFERRED to `/sdd-design` (operator decision 2026-11-26, context.md) — Merge carried rows into `replace_for_user`'s DELETE+INSERT, or split the
  live-only rows into a separately-replaced subset.
- [x] **Known trap (C-16 CHANGE).** DEFERRED to `/sdd-design` (operator decision 2026-11-26, context.md) — Feature 131 rejected cross-pass hysteresis because
  `replace_for_user` is a stateless DELETE+INSERT and carried state "for a ~daily cosmetic risk violates
  the write-minimum bias" (`131-live-strategy-opportunity-attribution/context.md:12`). This feature
  deliberately reverses that for the live-only cap (operator decision 2026-11-26); design must state the
  CHANGE explicitly and keep the per-compute bound that 131's caps exist for (`context.md:23` — curated
  rows bypass `max_universe_size`, so every curated-injecting path needs its own per-request cap).
- [x] **Known trap (ledger).** DEFERRED to `/sdd-design` (operator decision 2026-11-26, context.md) — `docs/roadmap/ledger/insights.md` 2026-08-03 records that `live_loop`'s
  cap "truncates rather than round-robins" while `docs/opportunities.md` describes the live loop as a
  fair-share rotating scheduler — recon must establish which is current and whether its rotation can be
  reused rather than re-invented. `fails.md` (2026-08 coverage_gaps): compute any diagnostic from the
  full pool before chunking.
- [x] **Test gap.** DEFERRED to `/sdd-design` (operator decision 2026-11-26, context.md) — No behavioral test pins the current cap (only `tests/test_config_read_classification.py`
  and `tests/test_config_zero_clamps.py` reference the key); the rotation needs its own RED tests.
- [x] **Overlap (sdd-review 2026-11-26).** Same function/file as in-flight `308-fix-analysis-per-symbol-isolation`
  (`_compute_opportunities`, `app/repositories/opportunities.py`; 308 `debate.md` R-4 locks "never drop
  held/watchlist/muted rows on a failure path") and `330-fix-live-enrich-ttl-seed` (`_compute_opportunities`
  bars request). DEFERRED to `/sdd-design` recon: the carried-row merge must respect 308 R-4; 366 rebases
  after 308.

# Product Spec: fundsignal-watchlist-universe

**Created**: 2026-08-24

---

## Problem Statement

The fundamentals signal producer (`xstockstrat-analysis`, `app/engine/fundsignal_loop.py`) advertises
three universe sources — `watchlists | explicit | both` — but only `explicit` works. The `watchlists`
and `both` branches were deferred at feature 062's launch and **silently fall back to the
`analysis.fundsignal.explicit_symbols` CSV**, because portfolio's `ListWatchlists` RPC is user-scoped
with no cross-user enumeration endpoint (062 archive synthesis: _"Global watchlist union via a new 058
RPC — deferred … A true global-union watchlist RPC in 058 would let the producer drop its explicit
fallback."_). An operator who sets `universe_source=watchlists` therefore gets an **empty universe and
zero emitted signals** unless they also hand-maintain the explicit CSV — the exact toil the watchlists
source was meant to remove.

## User Story

As a platform operator, I want the fundamentals producer's `watchlists` universe source to score the
real union of symbols across all users' watchlists, so that the daily producer covers what users are
actually watching without me maintaining an `explicit_symbols` CSV.

## Functional Requirements

FR-1. **Cross-user watchlist enumeration (portfolio).** Add a portfolio RPC that returns the
**distinct union of watchlist symbols across all users** (not scoped to a single caller's `x-user-id`).
It is a read-only enumeration intended for the internal producer.

FR-2. **Access control.** The new enumeration RPC exposes every user's watched symbols, so it MUST be
restricted — callable only by an admin scope bit **or** an allow-listed internal caller — and MUST NOT
be an open read like `GetConfig`/`WatchConfig`. A non-privileged caller receives `PERMISSION_DENIED`.

FR-3. **Producer consumes it (`watchlists`).** When `analysis.fundsignal.universe_source=watchlists`,
`fundsignal_loop._resolve_universe` returns the enumerated cross-user union (uppercased, trimmed,
de-duplicated by the existing `_dedup`), instead of the `explicit_symbols` fallback.

FR-4. **Producer consumes it (`both`).** When `universe_source=both`, the universe is the enumerated
union **∪** the parsed `explicit_symbols` CSV, de-duplicated. `explicit` remains explicit-CSV-only,
byte-for-byte unchanged.

FR-5. **Preserve the fetch/score/emit pipeline.** The resolved universe still flows through the paced,
budget-bounded `GetFundamentalsMulti` fetch, scoring, and idempotent emit unchanged — this feature
changes only how the raw symbol list is *sourced* (and, per FR-7, when the `max_symbols` cap applies),
never how it is fetched, scored, or emitted.

FR-6. **Graceful degradation.** A portfolio enumeration failure (RPC error, portfolio outage) MUST NOT
crash the producer cycle: it degrades to an empty universe (`watchlists`) or the explicit CSV (`both`)
and logs, consistent with the loop's existing "never let one bad cycle kill the loop" posture
(`run_forever` try/except).

FR-7. **FMP-gated `max_symbols` truncation (operator directive, 2026-08-24).** The
`analysis.fundsignal.max_symbols_per_run` truncation exists solely to protect FMP's free-tier daily
request budget. It therefore applies **only when FMP is the active fundamentals provider**
(`marketdata.fundamentals.provider == "fmp"`, read boot-frozen); in that case the cut uses a stateless
rotating offset so no user is permanently starved, and the dropped count is logged (computed from the
full pre-cap union). When the active provider is **not** FMP, the whole cross-user union is processed
with **no `max_symbols` truncation** — full coverage across cycles via the existing paced budget +
deferred-resume, nothing permanently dropped. An unknown/absent provider value selects the conservative
capped path without baking in a provider literal.

## Out of Scope

- Any change to how signals are **scored** (the composite-formula vs built-in choice is already
  operator-config via `analysis.fundsignal.scoring_formula_id`) or **emitted**.
- Per-user or per-environment universe partitioning of the producer (the producer is a single global
  loop; this feature unions across users, it does not run per-user).
- A UI to browse the enumerated universe.
- Earnings-calendar-driven `valid_until` (separate deferred 062 follow-on).

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-portfolio` (Go) — owns watchlists; gains the cross-user enumeration RPC + query.
- `xstockstrat-analysis` (Python) — `fundsignal_loop._resolve_universe` consumes the new RPC.
- `packages/proto` — new RPC + request/response messages on `portfolio.v1`.

## Consumer Surface(s)

_Constitution **C-14**._

- [ ] **UI** — no new UI. (`analysis.fundsignal.universe_source` is already an editable config key in
  `/config-ui`; this feature makes its existing `watchlists`/`both` values functional, adding no field
  or control.)
- [ ] **Agent** — no new/changed MCP tool.
- [x] **None** — internal/platform-only. The producer is a background loop; the signals it emits already
  reach users through the existing ingest → backtest-weighting / Opportunities-queue / alert surfaces
  built by feature 062. This feature changes only the producer's *input* (which symbols it scans), so
  no consumer-facing surface changes. The operator-visible effect (setting `universe_source=watchlists`
  now yields signals) is observed through those already-shipped surfaces.

## Proto Contract Changes

- [ ] No proto changes required
- **New (additive, non-breaking):** one RPC on `xstockstrat.portfolio.v1.PortfolioService` returning the
  distinct cross-user watchlist-symbol union, plus its request/response messages. Working name
  `ListAllWatchlistSymbols` (final name/shape settled in `/sdd-design`). New field numbers only; no
  removals or type changes. `buf breaking` must pass.

## Config Key Changes

- [x] No new config keys. `analysis.fundsignal.universe_source` and `analysis.fundsignal.explicit_symbols`
  already exist (feature 062); their **behavior** changes, their registration does not.

## Database Changes

- [x] No schema changes. The RPC reads existing portfolio watchlist tables via a new `DISTINCT symbol`
  query; no new table, column, or migration.

## Feature Workflow Notes

Branch to create: `feature/fundsignal-watchlist-universe` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking proto + service change) — portfolio & analysis owners
- [ ] 2 service owners + platform lead (breaking proto change) — N/A (additive)
- [ ] DBA review + service owner (schema migration) — N/A (no migration)
- [x] Security review — the new RPC returns cross-user data; authz gate must be verified (FR-2)

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

- [x] **RESOLVED (operator, 2026-08-24): all watchlists across all users**, not only the system-managed
  "Signals" list. This is the literal 062 FR-3 intent — the union of every symbol on every user's
  watchlists (any list they created). The narrower system-managed-"Signals"-only option (feature 127
  `Watchlist.system_managed`) was considered and declined. FR-1's enumeration therefore spans all
  watchlist rows regardless of `system_managed`.
- [x] **RESOLVED (design R2): bare symbols.** The RPC returns a distinct `repeated string symbols`
  (`SELECT DISTINCT symbol …`), collapsing `(symbol, strategy)` bindings and the legacy flat list. See design.md.
- [x] **RESOLVED (operator, design R1): `x-internal-caller` allow-list**, not the admin `x-access-scope`
  bit. The admin bit is the wrong trust boundary for a cross-user read (PR #994; feature-092-removed
  self-asserted-admin pattern). Grant `{callerID: "analysis-fundsignal", rpc: "ListAllWatchlistSymbols"}`. See design.md.
- [x] **RESOLVED (operator, design R3+R4): FMP-gated truncation + rotating offset.** The `max_symbols`
  cut applies only when FMP is the active provider, and then uses a stateless rotating offset so no user
  is permanently starved; non-FMP takes the full union (FR-7). See design.md.

### Known traps (from the Ledger)

- **Feature numbering across remotes** (fails.md 2026-07-29/081): **collision hit** — `153` was taken on
  a sibling branch (`153-fix-ohlcv-chunk-lock-oom`) that a `git ls-remote` name-grep missed; a proper
  all-remote `git ls-tree docs/roadmap/features/` scan caught it and this feature was renumbered
  **153 → 154**. Lesson reinforced: scan every remote branch's feature dir, not branch names.
- **Harness branch vs. feature dev branch divergence** (fails.md 2026-07-30/082): this session is on the
  harness branch `claude/fundamentals-signal-config-0jdfed`, not `feature/fundsignal-watchlist-universe`.
  Reconcile the branch before `/sdd-execute` writes code, per that entry.
- **Absence-claim greps** (fails.md 080): the "silently falls back to explicit" claim is grep-anchored to
  `fundsignal_loop.py:211-218`; `/sdd-design` must re-verify no other caller of `_resolve_universe`
  exists before changing its contract.

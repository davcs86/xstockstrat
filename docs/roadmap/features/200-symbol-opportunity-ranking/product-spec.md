# Product Spec: symbol-opportunity-ranking

**Created**: 2026-09-20

---

## Problem Statement

A trader deciding *which symbol to trade* must compare symbols, but the platform ranks only individual
opportunities — and the current queue sort partitions by symbol with **MAX** (`opportunities.py:35`),
so a symbol is ranked by its single best opportunity. That makes a lone strong opportunity outrank a
symbol corroborated by several moderate ones, and it ignores which strategy produced each opportunity.
This feature adds a single comparable **symbol-level** score that rewards corroboration (breadth) and
strategy quality, so symbols can be ranked head-to-head.

## User Story

As a trader, I want one comparable symbol-level score that consolidates all of a symbol's
opportunities, so that I can rank which symbol to trade across the whole opportunity queue rather than
eyeballing individual opportunities.

## Functional Requirements

FR-1. **Symbol-level roll-up.** Produce one `symbol_score` per (user, symbol) that aggregates that
symbol's opportunity rows. It **consumes feature-199's per-opportunity `composite_score`** as the
per-opportunity quality input — this feature is the roll-up layer, not a re-computation of
per-opportunity quality.

FR-2. **Breadth / corroboration via diminishing-returns sum.** `symbol_score` is a
**diminishing-returns sum** over the symbol's opportunities of `(composite_score × strategy_weight)`:
each additional opportunity adds with saturation, so more corroborating opportunities raise the symbol,
but N weak opportunities do not run away past a genuinely strong pair. It is **not** a MAX over the
symbol's opportunities (that is the current sort's behavior this feature exists to replace for symbol
comparison). **Mandatory ordering:** a symbol with 2 opportunities at conviction 0.80 + full readiness
ranks strictly **above** a symbol with 1 opportunity at conviction 1.00.

FR-3. **Strategy weighting = derived grade × operator override.** Each opportunity's contribution is
weighted by its strategy's derived quality grade (feature-065 `StrategyScore` A–F, mapped to a numeric
weight), multiplied by an explicit **operator per-strategy config override** (default override = 1.0).
**Mandatory ordering:** a symbol whose opportunity set includes the `fundamental_macd_blend` strategy
ranks strictly **above** a symbol with the same count of opportunities none of which is
`fundamental_macd_blend`, when `fundamental_macd_blend` carries a higher effective strategy weight.

FR-4. **Missing/degenerate inputs degrade gracefully.** An opportunity whose `composite_score` is NULL
(feature-199 "not computed" / data-unavailable) contributes nothing to the sum (it is not treated as 0
quality that drags the symbol down; it is simply absent from the roll-up). A symbol with no
score-eligible opportunities has no `symbol_score` (NULL / omitted), distinct from a computed low
score. A strategy with only a provisional/absent grade (feature-065 evidence floor) uses a defined
neutral fallback weight, not 0.

FR-5. **Rankable consumer surface.** The `/insights` opportunities queue can be ordered by
`symbol_score` (the `SymbolGroupCard` grouping ordered by the symbol roll-up), and the score is exposed
so the MCP agent can compare symbols. Determinism: for a fixed opportunity set + config, `symbol_score`
is reproducible.

## Out of Scope

- Changing the **per-opportunity** `composite_score` math (owned by feature 199).
- Removing or re-deriving the existing per-opportunity `conviction`/`signal_axis` axes or the
  feature-190 per-opportunity `rank` blend / `signal_rank_weight` (preserved unless explicitly changed
  with sign-off).
- Auto-trading / order placement off the ranking — this is a ranking/display surface only.
- A cross-user global symbol leaderboard (scores are per-user, mirroring the opportunity universe).

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-analysis` — owns the opportunity write/read path; computes/rolls up `symbol_score`.
- `packages/proto` — additive surface for `symbol_score` (field on a symbol-group message or an
  `Opportunity`/response addition — design to decide).
- `xstockstrat-ui` — `/insights` queue ordering by symbol roll-up.
- `xstockstrat-agent` — expose `symbol_score` for symbol comparison via `list_opportunities` (or a
  symbol-level projection).
- `xstockstrat-config` — new config keys (saturation parameter, per-strategy overrides, grade→weight map).

## Consumer Surface(s)

_Constitution **C-14**._

- [x] **UI** — `xstockstrat-ui` `/insights` opportunities queue: the `SymbolGroupCard` grouping is
  orderable by `symbol_score` (a new sort option and/or the default symbol ordering), with the score
  displayed per symbol-group header. Already in `PLATFORM_SUBNAV` (existing route; no new nav entry).
- [x] **Agent** — `xstockstrat-agent`: `list_opportunities` (or a symbol-compare projection) surfaces
  `symbol_score` so the agent can rank symbols; `docs/runbooks/mcp-tools.md` parity + the descriptor-
  parity test if the field lands on `Opportunity`.
- [ ] **None**

## Proto Contract Changes

- [ ] Additive, non-breaking. Exact shape at design: a `symbol_score` on a symbol-group message, or an
  additive field on `Opportunity` (repeated per row, same value within a symbol group), or a new
  symbol-ranking response. `buf breaking` must pass; regen + commit `gen/`.

## Config Key Changes

- [ ] New keys under `analysis` (finalized at design; follow the `analysis.scoring.shrinkage_days`
  precedent, `get_float_present`):
  - `analysis.opportunity.symbol_score_saturation` (or similar) — the diminishing-returns saturation
    parameter (FR-2).
  - `analysis.scoring.strategy_grade_weight_*` — the A–F→numeric weight map (FR-3).
  - `analysis.scoring.strategy_weight_override.<strategy_id>` (or a structured override key) — the
    operator per-strategy override (FR-3). **Naming/shape is an Open Question** (per-strategy dynamic
    keys vs a single structured value).

## Database Changes

- [ ] Possibly one new nullable column (persisted `symbol_score`) on `analysis.opportunities` **or** a
  query-time computation with no schema change — **design decides** (FR-1/FR-5). If persisted, a new
  numbered migration in `services/xstockstrat-analysis/migrations/` (`ls migrations/` and reserve the
  next-free NNN at design time — do not guess; disk tip was `023`, and feature 199 reserves `024`, so
  this feature must reserve the next after 199 lands or coordinate via merge-order).

## Feature Workflow Notes

Branch to create: `feature/symbol-opportunity-ranking` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking proto or config change) — `xstockstrat-analysis` + Proto Reviewer
- [ ] 2 service owners + platform lead (breaking proto change) — N/A (additive only)
- [x] DBA review + service owner (schema migration) — **only if** `symbol_score` is persisted

**Merge-order dependency:** depends on **feature 199 (opportunity-composite-score)** — this feature
consumes `Opportunity.composite_score`. 199 is `implementation-ready` (both are pre-merge). 200 must not
merge before 199, and shares the analysis opportunity path (soft rebase overlap with 199, plus in-flight
187/193/188). Recorded as a blocking row in `docs/roadmap/features/merge-order.md`.

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

- [ ] **Known trap (ledger `fails.md:313`/`:418`).** `symbol_score` is another ranking ordinal (built
  from `composite_score` ordinals × grade weights) — it must **not** become a cardinal sizing/alert
  input. Carry feature-199's cardinal-guard invariant forward to `symbol_score` (proto comment +
  `ANALYSIS-*` invariant).
- [ ] **Diminishing-returns function shape (FR-2).** Which saturating form — e.g. `Σ wᵢ·sᵢ·γ^(rank_i)`
  (geometric decay by descending contribution), a capped/soft-max, or `1 − Π(1 − wᵢ·sᵢ)` (noisy-OR)?
  Each satisfies "2 moderate > 1 strong" differently and saturates differently. **Design must pick and
  show worked numbers for the two mandatory examples.**
- [ ] **Grade→weight map + provisional fallback (FR-3).** The A–F→numeric mapping, and the neutral
  weight for a strategy whose grade is provisional/absent (feature-065 evidence floor). Must not be 0
  (that would zero out a legitimate opportunity from an unproven strategy).
- [ ] **Operator override key shape (FR-3 / C-05).** Per-strategy dynamic config keys
  (`...override.<strategy_id>`) vs one structured JSON value — governance + config-ui implications.
- [ ] **Persist vs compute-on-read (FR-1/FR-5).** Persisted `symbol_score` column (enables server-side
  ORDER BY + a leaderboard, needs a migration + heal/refresh parity) vs query-time roll-up (no schema,
  but the sort must then be expressible server-side to preserve the "client does not re-sort"
  guarantee, `@AC-15 @feature-190`).
- [ ] **Sort integration (C-16).** Does `symbol_score` become a **new** `OpportunitySort` option
  (preserving the existing conviction/expiry sorts), or the new default symbol ordering? Changing the
  default would be a CHANGE to `@AC-10 @feature-190` (conviction-sort default) requiring sign-off.
- [ ] **Strategy_id ↔ user scoping.** Strategies are per-user (composite PK); the grade lookup and
  override must resolve within the requesting user's scope (anti-IDOR, analysis ownership rule).

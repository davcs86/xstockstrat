# Product Spec: opportunity-composite-score

**Created**: 2026-09-20

---

## Problem Statement

An opportunity for a symbol currently exposes two deliberately-orthogonal ranking axes — `conviction`
(readiness ordinal) and `signal_axis` (decayed signal strength) — plus latent fundamentals and
technical evidence, none of which is combined into a single number a trader can rank on at a glance.
Users must mentally fuse separate axes to compare opportunities. This feature adds one consolidated,
persisted 0–1 composite score per opportunity, without collapsing the underlying axes (which stay
independently queryable, per the never-fold invariant FR-3 established by features 083/097).

## User Story

As a trader, I want each opportunity to carry a single consolidated 0–1 composite score that fuses
its readiness, signal strength, fundamentals, and technical evidence, so that I can rank and compare
opportunities at a glance without manually combining separate axes.

## Functional Requirements

FR-1. **Persist a per-opportunity composite.** Compute a single 0–1 composite score for each
opportunity row (`user × symbol_norm × strategy_id`) and persist it on `analysis.opportunities`,
in addition to — never in place of — the existing `conviction` and `signal_axis` columns. The
existing axes remain independently queryable (FR-3 / never-fold invariant is preserved).

FR-2. **Breadth-aware empirical-Bayes fusion.** The composite is
`composite = (Σ wᵢ·sᵢ + k·prior) / (Σ wᵢ + k)`, where `prior = 0.5` (neutral), `k` is a configurable
shrinkage pseudo-count, each `sᵢ` is a **normalized** evidence sub-score in [0,1], and `wᵢ` is that
evidence type's presence/confidence weight. Reuses the feature-065 empirical-Bayes precedent
(`services/xstockstrat-analysis/docs/scoring.md`, invariants ANALYSIS-2/ANALYSIS-3) and generalizes
the feature-190 query-time blend (`rank = (1−w)·conviction + w·signal_axis`) into a persisted,
multi-evidence composite.

FR-3. **Absent evidence contributes zero weight, never a zero score.** When an evidence type is
unavailable (e.g. FMP-gated fundamentals missing, or no active signals for the symbol), it
contributes `wᵢ = 0` to both numerator and denominator — it does **not** contribute `sᵢ = 0`. Missing
evidence therefore shrinks the composite toward the neutral 0.5 prior, never toward 0. This honors the
platform's NULL-vs-zero sentinel discipline (a missing value is not a low value).

FR-4. **Direction-scoped with disagreement discounting.** The composite measures conviction *within*
the opportunity's declared `direction` (`buy`/`sell`/`hold`/`watchlist`). Evidence that agrees with
that direction raises the magnitude; evidence contradicting it discounts the magnitude. The composite
is a magnitude in the declared direction, not a signed number and not direction-agnostic.

FR-5. **Evidence set (v1) = the two axes present at the opportunity write path.** _(Changed from the
original "all four types" by explicit user sign-off, 2026-09-20 — see `context.md`; `/sdd-design`
recon proved fundamentals and technical are not distinct axes in this path.)_ The v1 fusion inputs are
exactly: readiness (`conviction`) and decayed directional signal strength (derived from the same
signals `signal_axis` maxes). **Fundamentals is excluded as a distinct axis** — it re-enters
generically as `ExternalSignal`s feeding the signal evidence, so a separate fundamentals term would
double-count. **Technical is excluded** — it is screener/backtest-only, behind the deliberate
`_compute_opportunities` boundary, and pulling it in would add per-symbol RPC cost. The readiness
sub-score uses the identity map (the ordinal is used directly as its `[0,1]` sub-score); the signal
sub-score is direction-scoped multiplicative attenuation. The fusion function is written to accept N
weighted `(sᵢ, wᵢ)` pairs so it remains extensible if a future feature adds a genuinely distinct axis.

FR-6. **Determinism.** For a fixed opportunity input set (same evidence values, same config), the
composite is deterministic and reproducible (analysis service review focus: scoring determinism, no
look-ahead bias). Recompute on the refresh path yields the same value.

FR-7. **Surface the composite.** Expose the composite on the `Opportunity` proto message (additive
field) so it reaches the `/insights` opportunities queue, the `/trader` per-symbol page, and the
`list_opportunities` MCP tool response. Rendered as a 0–1 scalar (3-decimal), colored via the
existing `scoreColor` convention; no A–F grade band.

## Out of Scope

- Any **symbol-level** roll-up that consolidates a symbol's multiple per-strategy opportunity rows
  into one number (this feature is per-opportunity fusion across evidence types, not across
  strategies). That symbol-level ranking is **feature 199 (symbol-opportunity-ranking)**, which
  consumes this feature's `composite_score` as its per-opportunity input (operator sign-off 2026-09-20;
  see `docs/roadmap/features/199-symbol-opportunity-ranking/`).
- Overriding or removing the never-fold invariant — `conviction` and `signal_axis` stay as
  first-class, separately-queryable columns.
- Changing the existing `rank` sort blend (feature 190) or `signal_rank_weight` semantics.
- An A–F letter-grade band for the composite (deferred; representation is 0–1 scalar only).
- New signal sources, new indicators, or backtest-path scoring changes.

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-analysis` — owns `_compute_opportunities` (the refresh write path), the
  `app/repositories/opportunities.py` persistence, and the fusion math (new pure functions alongside
  `app/services/scoring.py`).
- `packages/proto` — additive field on the `Opportunity` message (`analysis/v1/analysis.proto`).
- `xstockstrat-ui` — `/insights` opportunities queue and `/trader` per-symbol page render the new
  field.
- `xstockstrat-agent` — `list_opportunities` tool maps the new field into its response.
- `xstockstrat-config` — new config keys under `analysis.scoring.*`.

## Consumer Surface(s)

_Constitution **C-14**._

- [x] **UI** — `xstockstrat-ui` segments: `/insights` (opportunities queue — the `SymbolGroupCard`
  opportunity rows gain a composite-score display) **and** `/trader` (per-symbol page header
  `trader/positions/[symbol]`). Reachable per **C-10** (both routes already registered in
  `PLATFORM_SUBNAV`; this adds a field to an existing rendered surface, not a new route).
- [x] **Agent** — `xstockstrat-agent` MCP tool: `list_opportunities` (new field in the returned
  opportunity shape; `docs/runbooks/mcp-tools.md` parity + the six tool-inventory surfaces must stay
  consistent if the return shape is documented there).
- [ ] **None**

Both UI surfaces are in-scope for v1 (the score is useless if computed but never shown). The agent
surface follows automatically from the additive proto field but must have its response mapping and
docs updated in the same feature.

## Proto Contract Changes

- [x] Additive, non-breaking change: one new field on the `Opportunity` message in
  `packages/proto/analysis/v1/analysis.proto` (a `double` composite score in [0,1]). Field number to
  be the next free number in that message — confirmed at `/sdd-spec` time by reading the message, not
  guessed. No field removals, no type changes → `buf breaking` passes. Regenerate stubs via
  `./scripts/buf-gen.sh`, commit `packages/proto/gen/`.

## Config Key Changes

- [x] New keys under the `analysis` namespace (following the `analysis.scoring.shrinkage_days`
  precedent — see `insights.md:146`). Proposed (exact set finalized at design):
  - `analysis.scoring.composite_shrinkage_k` — float, the empirical-Bayes pseudo-count `k` (FR-2).
  - `analysis.scoring.composite_weight_readiness` — float, weight `wᵢ` for the readiness sub-score.
  - `analysis.scoring.composite_weight_signal` — float, weight for the signal-strength sub-score.
  - `analysis.scoring.composite_weight_fundamentals` — float, weight for the fundamentals sub-score.
  - `analysis.scoring.composite_weight_technical` — float, weight for the technical sub-score.
  - All read via the present-aware getter (`get_float_present`) so a configured `0` is honored as a
    legitimate "disable this evidence type," not a zero-config trap.

## Database Changes

- [x] One new numbered migration in `services/xstockstrat-analysis/migrations/` adding a nullable
  composite-score column to the `analysis.opportunities` table (up + down pair). NNN continues from
  the last number in that directory — **`ls migrations/` and reserve the next-free number at design
  time** (ledger `fails.md:561,611`; do not guess). NULL is the honest "not yet computed" state
  (distinct from a computed neutral 0.5).

## Feature Workflow Notes

Branch to create: `feature/opportunity-composite-score` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking proto or config change) — `xstockstrat-analysis` owner + Proto Reviewer
- [ ] 2 service owners + platform lead (breaking proto change) — N/A (additive only)
- [x] DBA review + service owner (schema migration) — `analysis` migration

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

- [ ] **Known trap (ledger `fails.md:313`, feature 023) — the central design risk.** The shrinkage
  formula treats every `sᵢ` as living on one commensurable [0,1] scale where 0.5 = neutral, but
  `Opportunity.conviction` is documented as *"a deterministic ordinal (passing/total leaves +
  normalized worst-distance-to-threshold), **NOT a probability**"* — whereas `ExternalSignal.conviction`
  (the basis of `signal_axis`) genuinely is a 0–1 confidence. Blending an ordinal and a probability
  as if commensurable is exactly the semantic mismatch feature 023 was caught making. **Design must
  define an explicit, defensible normalization map for each evidence sub-score onto the fusion scale**
  and justify why the readiness ordinal can be treated as commensurable (or transformed to be). The
  design-adversary round must attack this directly.
- [ ] **Related (ledger `fails.md:418`, `insights.md:671`).** The composite is an ordinal ranking
  aid, not a cardinal probability of profit or an expected-return estimate. Confirm no downstream
  consumer (position sizing, alerting) will treat it as cardinal. Should the proto field comment
  state this explicitly (as `conviction`'s does) to pre-empt the next convenience-wiring?
- [ ] **Direction-scoping mechanics (FR-4).** How exactly does "contradicting evidence discounts
  magnitude" compute? Options include a signed contribution folded to magnitude, or a per-evidence
  agreement multiplier. Reuse of the existing `scoring.py` direction/threshold transforms
  (`compute_signal_score`, `buy_threshold`) is preferred over a new normalization
  (`insights.md:1135`). Design to decide.
- [ ] **Refresh-path integration (ledger `insights.md:543`, feature 097).** The opportunity write
  path is lazy-materialize-on-read + `valid_until` + stale-while-revalidate + daily refresh, not a
  standing loop. Confirm the composite is computed at the same materialization point as `signal_axis`
  (`_compute_opportunities`) and persisted in the same write, with the same best-effort try/except
  semantics (`insights.md:973`, `hydrate_scores`).
- [ ] **Weight normalization / degenerate case.** If every evidence type is absent (`Σ wᵢ = 0`), the
  formula returns exactly the prior (0.5) — but should such a row instead persist NULL (no evidence at
  all) to distinguish "computed neutral" from "nothing to compute"? Define the boundary.
- [ ] **Config default values.** Initial `k`, and the four per-evidence weights — what defaults? A
  behavior threshold has historically churned through storage choices (`insights.md`, feature on alert
  cutoff); pick config-service-backed defaults up front and document them in the analysis `CLAUDE.md`.
- [ ] **UI/proto coupling (ledger `fails.md:81`).** The new field is a `double`, not an enum, so it
  avoids the exhaustive-`Record` TS build break — but confirm the UI render + agent response mapping
  ship in the same PR as the proto regen (C-14).

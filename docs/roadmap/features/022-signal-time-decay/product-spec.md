# Product Spec: signal-time-decay

**Created**: 2026-05-26
**Retargeted**: 2026-08-13 (see `context.md` — original premise invalidated by feature 097)

---

## Problem Statement

The Opportunities queue (`ListOpportunities`, feature 097) ranks candidates partly by `signal_axis`
(`_compute_opportunities`, `services/xstockstrat-analysis/app/handlers/servicer.py:2163`, currently
`c["signal_axis"] = max(c["signal_axis"], sig.conviction)`) — and, per feature
`130-signal-source-reliability-weight`, is gaining a per-source `reliability_weight` multiplier on
that same expression. Neither weights nor the underlying `sig.conviction` account for signal age: a
buy signal extracted from a newsletter 72 hours ago carries identical ranking weight to one
extracted 30 minutes ago. Markets reprice information quickly; a stale signal ranking equally with a
fresh one actively misleads the queue's ordering.

**Retargeting note**: this spec was originally written 2026-05-26 against "the analysis service
scoring loop" — the backtest/live signal-confidence blend (`combine_score`/`compute_signal_score`
as invoked from `RunBacktest`). That blend was **retired** by feature 097
(`services/xstockstrat-analysis/app/handlers/servicer.py:326-331`: "a signal is no longer an input
to a strategy's internal score; it is a universe + independent queue ranking axis") before this
spec was ever implemented. A 2026-08-13 `/sdd-review` pass caught the stale premise (FR-1 targeted
dead code, FR-4 assumed a data field that was never wired, and the Consumer Surface citation chain
was code-false) and this spec was rewritten in place to target the surface that actually still
exists: `Opportunity.signal_axis`. `compute_signal_score`/`combine_score` do still exist and are
still live — but only inside `ScreenSymbols` (`services/xstockstrat-analysis/app/services/screener.py:235,456`)
— which this feature deliberately does not touch (see Out of Scope).

## User Story

As a platform operator, I want a signal's contribution to the Opportunities queue's `signal_axis`
ranking to decay exponentially with age, so the queue naturally deprioritizes stale signals and
reacts more strongly to recent intelligence.

## Functional Requirements

FR-1. `_compute_opportunities` must apply an exponential decay multiplier to each signal's
contribution to `signal_axis` (`servicer.py:2163`): `effective_conviction = sig.conviction ×
exp(-λ × age_hours)` where `λ = ln(2) / half_life_hours`, folded into the existing `max(...)`
expression. **Coordination with `130-signal-source-reliability-weight`**: both features multiply
into this exact expression — 130 adds a `× source_weight` term. Whichever feature lands second
rebases the expression to include both terms (`sig.conviction × source_weight × exp(-λ ×
age_hours)`); this is recorded as a same-expression coordination row in
`docs/roadmap/features/merge-order.md`, not re-litigated here.
FR-2. The decay half-life must be configurable via a config key
(`analysis.scoring.signal_decay_half_life_hours`, float, default: 24.0) with no restart required.
FR-3. A half-life of 0 or negative must disable decay (multiplier = 1.0) to allow rollback without
config key removal.
FR-4. Signal age is computed as `now_utc - signal.ingested_at`. **This requires a proto + ingest
change that did not exist when this spec was first drafted**: `ExternalSignal`
(`packages/proto/ingest/v1/ingest.proto:106-116`) has no `ingested_at` field today, even though the
underlying `ingest.newsletter_signals` table already has an `ingested_at` column
(`services/xstockstrat-ingest/migrations/001_newsletter_signals.up.sql:10`) — `QuerySignals`'s SQL
and response construction (`services/xstockstrat-ingest/app/handlers/servicer.py:956-989`) never
select or set it. This feature adds `google.protobuf.Timestamp ingested_at = 10;` to
`ExternalSignal` (next free field number after `tags = 9`), selects the existing column in
`QuerySignals`'s SQL, and populates it on the constructed message — no new migration needed, only
exposure of an already-stored value.
FR-5. Consistency within one compute pass: read `now_utc` **once**, at the start of
`_compute_opportunities`, into a local variable, and use that same instant for every signal's
`age_hours` in that pass — never a fresh `datetime.now(UTC)` call per signal. **This is a new local
variable, not `session_end_seconds`**: `session_end_seconds` (`servicer.py:2179-2185`, only
populated starting the later per-candidate bar-fetch loop, `servicer.py:2184` initializes it to `0`)
is a *bars-derived* running max used solely to compute `valid_until` (`servicer.py:2235-2241`) — it
does not exist yet at FR-1's write-site (`:2163`, inside the earlier signals-merge loop,
`servicer.py:2152-2166`, which runs before any bars are fetched) and is conceptually the wrong clock
regardless (market-bar time, not wall-clock signal-ingestion time). A prior draft of this FR
incorrectly conflated the two — caught by `/sdd-review` round 3 (see `context.md`). (The original
2026-05-26 draft's *backtest-window* determinism requirement doesn't apply here either — this
feature never touches the backtest engine; the Opportunities queue has no backtest-replay concept.)
FR-6. The effective (post-decay) contribution must be logged at DEBUG level per signal, inside
`_compute_opportunities`, to aid tuning.

## Out of Scope

- Per-source-type decay rates (one global half-life in V1; per-source rates are a V2 extension)
- Decay applied in the indicators formula engine (only in `_compute_opportunities`)
- Decay applied inside the Screener's `compute_signal_score`/`combine_score` path
  (`ScreenSymbols`/`screener.py`) — that surface still blends signals today, but this feature scopes
  to the Opportunities queue only; a future feature can extend decay there if wanted
- Reintroducing any signal-confidence blend into the backtest/live scoring loop — feature 097
  deliberately retired that blend (Option 2: a signal is a ranking axis, never a score input); this
  feature does not reverse that decision
- UI visualization of decayed vs. raw confidence
- A maximum age floor that drops ancient signals entirely (resolved — see Open Questions: not
  needed in V1, since FR-1's exponential decay already asymptotically approaches zero without a
  special-cased cutoff)

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-analysis` — `_compute_opportunities` `signal_axis` decay (`servicer.py:2163`)
- `xstockstrat-ingest` — expose `ingested_at` on `ExternalSignal`/`QuerySignals` (FR-4)
- `xstockstrat-config` — new config key registration
- `packages/proto` — new `ExternalSignal.ingested_at` field

## Consumer Surface(s)

- [x] **UI** — `xstockstrat-ui` `/insights` Opportunities page: no new page or control — the
  existing queue ordering (`signal_axis`-driven ranking, already rendered via `ListOpportunities`)
  reflects decayed contributions once this ships: a signal loses ranking weight as it ages instead
  of staying flat until its `valid_until` cutoff.
- [ ] **Agent** — no MCP tool surfaces `signal_axis` computation or signal decay directly; none
  added.
- [ ] **None**

## Proto Contract Changes

- [x] New field: `google.protobuf.Timestamp ingested_at = 10;` on `ingest.ExternalSignal`
  (additive, non-breaking — 1 service owner + Proto Reviewer per the non-breaking-proto approval
  gate).

## Config Key Changes

- `analysis.scoring.signal_decay_half_life_hours` — float; half-life in hours for exponential confidence decay (default: 24.0; set to 0 to disable)

## Database Changes

- [ ] No schema changes — `ingest.newsletter_signals.ingested_at` already exists (migration `001`);
  FR-4 only exposes it through `QuerySignals`, no new column or migration.

## Feature Workflow Notes

Branch to create: `feature/signal-time-decay` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking proto + config + analysis/ingest logic change)
- [ ] 2 service owners + platform lead (breaking proto change) — not applicable (additive field)
- [ ] DBA review + service owner (schema migration) — not applicable

## Acceptance Criteria

1. A signal ingested 48 hours ago with a 24-hour half-life contributes half the `signal_axis`
   weight of an otherwise-identical signal ingested now (all else — including any 130
   `reliability_weight`, if already landed — held equal).
2. Setting `signal_decay_half_life_hours` to 0 via the config service (no restart) immediately
   disables decay — `signal_axis` matches pre-feature behavior.
3. Within a single `_compute_opportunities` compute pass, every candidate's decay is computed
   against the same once-read `now_utc` local variable (FR-5) — not independent per-candidate
   `datetime.now(UTC)` calls, and not `session_end_seconds` (a distinct, bars-derived variable used
   only for `valid_until`).
4. DEBUG logs show `raw_conviction`, `age_hours`, `decay_multiplier`, and `effective_conviction`
   per signal (plus `source_weight` once 130 lands and the expression carries it).
5. Analysis service unit tests cover: decay at t=0 (multiplier=1.0), at t=half_life
   (multiplier≈0.5), at t=3×half_life (multiplier≈0.125), and disabled decay (half_life ≤ 0).
6. `QuerySignals` responses include a populated `ingested_at` for every signal, confirming FR-4's
   proto/ingest-servicer change is wired end-to-end (not just declared on the message).

## Open Questions

- [x] Should the decay reference time be `ingested_at` or the source newsletter's publication
  timestamp? **Resolved**: `ingested_at`, per FR-4 — it's platform-controlled and immune to
  newsletter timestamp manipulation. This was already the spec's own committed requirement (FR-4);
  the question is closed, not deferred.
- [x] Should a maximum age floor (e.g. signals older than 7 days get multiplier=0 and are dropped
  entirely) be added in V1? **Resolved: no.** FR-1's exponential decay is already
  self-limiting — at 3×half-life the multiplier is ≈0.125, at 7×half-life ≈0.008 — so a signal's
  practical influence vanishes on its own without a special-cased hard cutoff, consistent with this
  spec's existing V1-minimalism (single global half-life, no per-source rates). A DB-query-pruning
  floor is a distinct performance optimization, not a correctness requirement; if signal-table
  volume later makes an unbounded age range a real query cost, that is a named follow-up to raise
  against the ingest signal-retention story, not blocking scope here.
- **Known trap, carried forward as a guardrail** (not an open checklist item — `fails.md`
  2026-08-05, `023-position-sizing-engine`): `signal_axis` and `Opportunity`'s own `conviction`
  field are different things (`signal_axis` is a cardinal 0–1 confidence derived from
  `ExternalSignal.conviction`; `Opportunity.conviction` is a deterministic readiness *ordinal*,
  never a probability, per its own proto comment) — this feature only touches `signal_axis`, never
  `conviction`. `/sdd-design` must state it re-confirmed this distinction, not skip the check.

# Product Spec: opportunity-compute-robustness

**Created**: 2026-09-07

---

## Problem Statement

The opportunities compute (`_compute_opportunities` in `xstockstrat-analysis`) diverges from the
readiness philosophy in two correctness/isolation respects the audit found:
1. **No data-unavailable sentinel.** A per-symbol bars-fetch failure caches `[]` and degrades the row
   to `_empty_readiness` (`0/0`, `app/services/evaluator.py:775`) — **indistinguishable from "evaluated, nothing
   passing."** A data-down symbol shows as a misleading quiet/`N-away` row rather than a terminal
   "unavailable" state. This is the same class as the readiness infinite-PENDING trap feature 181
   fixed with the `bar_epoch=-1` → UNKNOWN sentinel; here it surfaces as a *misleading verdict* instead.
2. **No background/interactive isolation.** The compute's bars-fetch fan-out shares `_bars_fetch_sem`
   (`servicer.py:412`) with the interactive read-time `_enrich_opportunities_live` — a heavy cold/daily
   recompute can starve an interactive read. The readiness materializer got its **own** semaphore for
   exactly this reason (feature-176/180 priority-inversion guard, `servicer.py:451`); the opportunity
   compute never got that split.

## User Story

As a **trader using the Decide queue**, I want a symbol whose data is unavailable to show as an
explicit "unavailable" state (not a misleadingly-quiet row), and I want the queue's interactive reads
to stay responsive while a background recompute runs — so the queue is trustworthy and snappy.

## Functional Requirements

FR-1. `_compute_opportunities` distinguishes **data-unavailable** (a bars/indicator fetch failure) from
**evaluated-but-not-passing** (`0/0`). A data-unavailable candidate is marked with a terminal sentinel
(the readiness analogue of `bar_epoch=-1` → UNKNOWN) carried through materialization to `ListOpportunities`,
so the consumer can tell the two apart. Representation (a new `Opportunity` enum/flag vs reusing an
existing field) is a design decision — additive/non-breaking, with a zero-value sentinel if an enum (C-04).

FR-2. The opportunities queue UI renders the data-unavailable state as an explicit "unavailable" cue via
the shared C-17 primitives (not a `0/0` "quiet" row and not a bare `<p>`), consistent with the watchlist
readiness UNKNOWN cell.

FR-3. The `_compute_opportunities` bars-fetch fan-out runs on a **background** semaphore, separate from
the interactive read path (`_enrich_opportunities_live` + `EvaluateReadiness`), so a background recompute
cannot starve an interactive read. **It reuses the existing `_readiness_materializer_bars_sem`** (the
feature-176/180/181 background bucket) rather than minting a third independent bars-fetch semaphore —
which keeps the aggregate marketdata concurrency bounded by one `[1,5]` key and cannot re-open the
feature-141 SEV-2 (three independent `[1,5]` sems would sum to 15 > the marketdata pool ceiling of 5).
**No new config key and no config migration** (design decision, 2026-09-07 — supersedes the story's
"new key via feature 184" note).

FR-5. **Surgical read-time recovery.** On a `ListOpportunities` fresh read, if any served row is
`data_unavailable` and older than a ~300s cooldown (the feature-181 `_READINESS_UNKNOWN_RETRY_SECONDS`
model), a background task re-fetches + re-evaluates **only those symbols** (a bounded per-symbol
footprint, NOT a full-universe recompute — the scalable choice under a marketdata outage) and heals their
rows **UPDATE-in-place** (never resurrecting a row a full compute would have dropped). It restores **both**
ranking axes (re-drains signals for `signal_axis`), re-stamps `computed_at` unconditionally (so the 300s
cooldown holds even when still-down), and is guarded/deduped so concurrent reads don't stack kicks. The
recovery is a **generic reusable helper** designed for later adoption by the fundsignal loop (feature 186,
a named follow-up) — wired in 185 **only** into opportunities. **Because a watchlist×strategy entry-rule
readiness is a subset of the opportunity compute**, when the helper re-evaluates a recovered symbol it
also upserts the fresh readiness rows for that subset into `analysis.readiness_cache` (reusing the
compute's existing `_readiness_cache_repo.upsert_many`, **success-only** — a still-down symbol stays
uncached), so the `/insights/watchlists` overlay heals in lockstep. This EXTENDS the compute's existing
readiness-cache write to the recovered subset; it does **not** change the readiness materializer loop or
the readiness read path (features 180/181/182 stay PRESERVE).

FR-6. **Agent consumer surface (C-14).** The `data_unavailable` field is projected in the
`xstockstrat-agent` `list_opportunities` tool (`_opportunity_to_dict`), and an `Opportunity`
descriptor-parity test is added (there is none today — the projection already silently drifts, omitting
`valid_until`/`signal_confidence`); those two drifted fields are back-filled so the new parity test passes
with no silent allow-list. The FR-4 `computing` pending signal and the terminal compute-failed state are
surfaced to the agent (a one-shot, non-polling consumer) so a cold/failed queue is not reported as a
silently-empty one.

FR-4. _(audit G4 — committed by operator, 2026-09-07.)_ The **cold** (never-materialized)
`ListOpportunities` read is **non-blocking**: instead of computing synchronously under the per-user lock
(`_materialize_opportunities`), it returns an empty page + a "computing" pending signal, kicks a
background recompute (`_kick_opportunity_recompute`), and lets the client poll — mirroring the
feature-181 cold readiness path. A cold user has no cached rows to show anyway, so the synchronous wait
buys nothing; making it non-blocking keeps the first read snappy and removes the per-user-lock stall.
The pending signal is a response-level flag **provably distinct from a legitimately-empty universe**
(empty-universe → empty **without** the flag, preserving @AC-4's no-recompute-per-poll; cold → empty
**with** it). A **terminal compute-failed** state is required so a persistently-failing recompute renders
an error rather than an infinite "computing" spinner (the synchronous path surfaced the error to the RPC;
the async path must not lose that). Design settles the exact signal shape + `@AC-6`.

## Out of Scope

- Config registration/bounds of the `analysis.opportunity.*` keys — **feature 184
  (opportunity-config-operability)**. FR-3 no longer adds a config key (it reuses the existing
  materializer sem — design decision), so this feature registers **no** new config key.
- Keyset pagination of `ListOpportunities` (audit G5) — a separate, lower-priority efficiency change;
  fold in only if design finds it cheap alongside FR-1. (185 does add one bounded ORDER BY tiebreak —
  `opportunity_key ASC` — to make offset paging deterministic under the surgical partial-replace; a pure
  tiebreak, not a ranking change.)
- Generalizing the FR-5 surgical-recovery helper to the **fundamentals-signal (fundsignal) loop** —
  **feature 186 (named follow-up)**, its own SDD pipeline. 185 builds the helper generic but wires it only
  into opportunities.
- Any change to the watchlist readiness **materializer loop or read path** (features 180/181/182) — stays
  PRESERVE. (Note: FR-5 does upsert `analysis.readiness_cache` for a recovered symbol subset — but that is
  the opportunity compute's **existing** write extended to the healed subset, success-only, not a change to
  the readiness loop/read path.)

## Affected Services

- `xstockstrat-analysis` — `_compute_opportunities` sentinel (FR-1), `_materialize_opportunities` +
  `opportunities` repo carry-through, the compute fan-out routed onto `_readiness_materializer_bars_sem`
  (FR-3), the non-blocking cold-read + `computing`/failed states (FR-4), and the surgical read-time
  recovery helper incl. the readiness-cache subset upsert (FR-5).
- `packages/proto` — additive `bool data_unavailable = 20` on `Opportunity` **and** `bool computing = 3`
  (+ a terminal-failed marker) on `ListOpportunitiesResponse` (`analysis.proto`), non-breaking.
- `xstockstrat-ui` — render the unavailable state on the `/insights/opportunities` queue (FR-2) + the
  cold `computing` / failed states (FR-4).
- `xstockstrat-agent` — project `data_unavailable` + `computing`/failed in `list_opportunities`; add the
  `Opportunity` descriptor-parity test (FR-6, C-14).

## Consumer Surface(s)

_Constitution **C-14**._

- [x] **UI** — `xstockstrat-ui` `/insights/opportunities` (the Decide queue): a symbol with unavailable
  data renders an explicit "unavailable" cue instead of a `0/0` quiet row; a cold queue renders a
  "computing" state and a persistently-failed compute an error state (FR-4).
- [x] **Agent** — `list_opportunities` MCP tool: the hand-projection (`_opportunity_to_dict`) does **not**
  surface a new field automatically (no parity test today), so FR-6 explicitly projects `data_unavailable`
  + the `computing`/failed states and adds the `Opportunity` descriptor-parity test (C-14, mandatory —
  the agent is a one-shot non-polling consumer).
- [ ] **None**.

## Proto Contract Changes

- [x] Two **additive**, non-breaking fields (design-confirmed): `bool data_unavailable = 20` on
  `Opportunity` (a binary flag mirroring the `muted = 12` precedent — a bool, not an enum, so C-04's
  zero-value rule does not apply), and `bool computing = 3` on `ListOpportunitiesResponse` (+ a terminal
  compute-failed marker). Runs the proto governance gate (`docs/runbooks/proto-versioning.md`) +
  `./scripts/buf-gen.sh` (all three stubs) + `buf breaking`.

## Config Key Changes

- **None.** FR-3 reuses the existing `_readiness_materializer_bars_sem` (design decision) — no new config
  key, no config migration. The FR-5 300s retry cooldown is a module constant mirroring
  `_READINESS_UNKNOWN_RETRY_SECONDS` (a code tuning constant precedent, not a WatchConfig value).

## Database Changes

- [x] No schema change — the `data_unavailable` sentinel rides the existing `analysis.opportunities`
  `provenance` JSONB (derived at read like `muted`), and the FR-5 recovery reuses the existing
  `analysis.readiness_cache` upsert. No new migration.

## Feature Workflow Notes

Branch: harness `claude/*` off `main-dev`, PR to `main-dev`. Approval gates: analysis service owner;
**+2 owners + platform lead only if the proto change is breaking** (it should be additive → 1 owner).
`./scripts/buf-gen.sh` + `buf breaking` run in CI if proto changes.

## Acceptance Criteria

See `acceptance.feature` (`@AC-*`) — single source of acceptance truth (C-15).

## Open Questions

- [ ] **Sentinel representation (the core design fork):** a new `Opportunity` enum/flag, or reuse an
  existing field (e.g. a provenance marker like feature-131's `muted`, which survives the JSONB
  round-trip with no migration)? Affects proto + C-16 (changes what a `0/0` row means to consumers).
- [ ] **C-16 impact:** does marking data-unavailable rows change any existing `@AC-*` guarantee about the
  opportunities queue (e.g. rollup counts, "quiet" classification)? scenario-recon at design will surface
  which guarantees PRESERVE/EXTEND/CHANGE.
- [x] **Cold-read non-blocking (audit G4):** RESOLVED — committed as **FR-4** by operator (2026-09-07).
  Cold `ListOpportunities` returns empty + a "computing" pending signal + kicks a recompute, non-blocking.
  Remaining sub-decision for design: the exact pending-signal shape (a response flag vs empty + a
  recompute-in-progress marker) and its `@AC-6` wording.
- [ ] **Agent consumer surface (C-14):** does the new data-unavailable state need an explicit
  `list_opportunities` MCP-tool mapping in `xstockstrat-agent` (a new proto field does NOT surface through
  the agent automatically), or is it internal-only with a stated reason? Design MUST commit to an explicit
  agent-mapping step or a documented internal-only justification (not a vague "design confirms").
- [ ] **FR-3 sem key ownership + naming:** define/register/bound the new semaphore key here or depend on
  feature 184's mechanism (184 is now code-completed on the shared branch) — and pick the C-05 shape:
  `analysis.opportunity.materializer_max_concurrent_bars_fetches` vs. the sibling
  `analysis.readiness_materializer.*` category shape. (merge-order + naming decision.)
- [ ] **Sentinel retry semantics:** like readiness's UNKNOWN 300s cooldown, should a data-unavailable
  opportunity re-attempt on a cadence, or wait for the next scheduled recompute? (avoid both a hot retry
  loop and a stuck-forever row.)

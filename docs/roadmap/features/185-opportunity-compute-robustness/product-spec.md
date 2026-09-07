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

FR-3. The opportunity compute/materializer bars-fetch fan-out uses a **dedicated background semaphore**,
separate from the interactive read path (`_enrich_opportunities_live`), so a background recompute cannot
starve an interactive read — mirroring the readiness materializer's own-semaphore split (feature 176/180).
The new bound is a config key (governed under feature 184's config-operability work: registered + bounded).

FR-4. _(audit G4 — committed by operator, 2026-09-07.)_ The **cold** (never-materialized)
`ListOpportunities` read is **non-blocking**: instead of computing synchronously under the per-user lock
(`_materialize_opportunities`), it returns an empty page + a "computing" pending signal, kicks a
background recompute (`_kick_opportunity_recompute`), and lets the client poll — mirroring the
feature-181 cold readiness path. A cold user has no cached rows to show anyway, so the synchronous wait
buys nothing; making it non-blocking keeps the first read snappy and removes the per-user-lock stall.
Design settles the exact pending signal (a response flag / empty + a recompute-in-progress marker) and
its own `@AC-*`.

## Out of Scope

- Config registration/bounds of the `analysis.opportunity.*` keys — **feature 184
  (opportunity-config-operability)** (this feature's FR-3 new semaphore key is *registered/bounded there*,
  or here if 184 has already merged — sequencing decided at design).
- Keyset pagination of `ListOpportunities` (audit G5) — a separate, lower-priority efficiency change;
  fold in only if design finds it cheap alongside FR-1.
- Any change to the watchlist readiness paths (features 180/181/182) — already aligned.

## Affected Services

- `xstockstrat-analysis` — `_compute_opportunities` sentinel (FR-1), `_materialize_opportunities` +
  `opportunities` repo carry-through, a dedicated background semaphore (FR-3), and the non-blocking
  cold-read branch of `ListOpportunities` (FR-4).
- `packages/proto` — likely a **new additive field** on `Opportunity` (`analysis.proto`) for the
  data-unavailable state (design confirms; if an existing field can carry it, no proto change).
- `xstockstrat-ui` — render the unavailable state on the `/insights/opportunities` queue (FR-2).

## Consumer Surface(s)

_Constitution **C-14**._

- [x] **UI** — `xstockstrat-ui` `/insights/opportunities` (the Decide queue): a symbol with unavailable
  data renders an explicit "unavailable" cue instead of a `0/0` quiet row.
- [ ] **Agent** — `list_opportunities` MCP tool response gains the state passively if a proto field is
  added (no new tool); design confirms whether the agent mapping needs a touch.
- [ ] **None**.

## Proto Contract Changes

- [ ] No proto changes required, **OR**
- [x] (likely) an **additive** field on `Opportunity` in `packages/proto/analysis/v1/analysis.proto`
  for the data-unavailable state — non-breaking, zero-value sentinel if an enum. Runs the proto
  governance gate (`docs/runbooks/proto-versioning.md`) + `./scripts/buf-gen.sh`. Design confirms.

## Config Key Changes

- FR-3 adds one bound-worthy key for the dedicated background semaphore
  (e.g. `analysis.opportunity.materializer_max_concurrent_bars_fetches`, default matching marketdata's
  pool). Registered + bounded under the feature-184 config-operability mechanism.

## Database Changes

- [ ] No schema change expected — the sentinel rides existing `analysis.opportunities` JSONB/columns
  (like feature 131's `muted` provenance marker), confirmed at design. No new migration if so.

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

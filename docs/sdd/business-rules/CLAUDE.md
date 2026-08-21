# docs/sdd/business-rules/ — Business-Rule Suites (Gherkin)

Durable, behavior-level memory of what the platform **already guarantees** — the behavioral sibling
of `docs/context-constitution.md`'s structural invariants (`PLAT-*` / `<MODULE>-*`). Read by
`/sdd-design` recon (Phase 0) to give the designer fast context on existing rules, and enforced as a
regression guard by the design-adversary. Binding rules: Constitution **C-15** (scenarios trace to
tests) and **C-16** (business-rule regression guard) in `docs/sdd/constitution.md`.

## Where rules live

| Scope | Location |
|---|---|
| One service | `services/xstockstrat-<svc>/acceptance/*.feature` (co-located, like fixture homes) |
| Cross-cutting (spans services / platform-wide) | `docs/sdd/business-rules/platform.feature` (this dir) |

Per-service directories are created **lazily** — a service gets an `acceptance/` dir the first time a
launched feature promotes a scenario into it, not ahead of demand.

## Lifecycle of a scenario

1. **Pending** — authored per feature in `docs/roadmap/features/<NNN-slug>/acceptance.feature`
   (`/sdd-story`), reviewed (`/sdd-review`, **C-15**), and traced to test steps (`/sdd-spec`).
2. **Canonical** — on launch/integration the scenarios are **promoted** (deduped) into the affected
   services' suites. Promotion is planned by the read-only **`scenario-promoter`** subagent
   (`.claude/agents/scenario-promoter.md`) — it maps each `@AC-*` to its owning suite (per-service or
   cross-cutting `platform.feature`), dedups, and returns ready-to-write blocks with `@feature-<NNN>`
   provenance tags; the invoking skill writes them (single-writer). Three invocation points, in order
   of precedence: `/sdd-execute` at integration (primary), the `/promote` backstop (P7.5), and
   `/sdd-archiver` Phase 4c (a final backfill before a launched feature's specs are pruned).
   `/sdd-archiver` also curates these suites; it never deletes or rewrites a promoted scenario.

## Scenario conventions

- Each `Scenario:` has a stable `@AC-<n>` tag and at least one `@FR-<n>` tag linking it to the
  Functional Requirement it exercises. IDs are **append-only** within a feature (test steps cite them).
- **Concrete example values only** — `252 days`, `"insufficient history"`, never "a valid window."
- `Then` clauses are **observable outcomes** (a returned value, a persisted row, a rendered element,
  an emitted event/alert), never implementation steps.
- On promotion, prefix a promoted scenario's tags with its source so provenance survives, e.g.
  `@AC-1 @FR-2 @feature-032` (source feature slug/number).

## What an agent needs to know

- **Recon reads, never guesses.** `/sdd-design` Phase 0 spawns the read-only **`scenario-recon`**
  subagent (`.claude/agents/scenario-recon.md`, the read-side mirror of `scenario-promoter`) to load
  the affected services' suites (+ this `platform.feature`), filter to the `@AC-*` guarantees the
  feature could touch, and classify each PRESERVE / EXTEND / CHANGE; the orchestrator folds that
  digest into `recon.md` → `## Existing Business Rules`, and the design-adversary blocks a design that
  breaks an existing `@AC-*` (**C-16**). Promotion (`scenario-promoter`) writes rules *in*;
  recon (`scenario-recon`) reads them *out* — one pair, opposite directions.
- **Never hand-author a rule here to "document" behavior** — a rule enters only by promotion from a
  feature's reviewed `acceptance.feature`, so every guarantee is traceable to the feature that made it.

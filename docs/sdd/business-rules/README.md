# Business-Rule Suites (Gherkin)

Durable, behavior-level memory of what the platform **already guarantees** — the behavioral sibling
of `docs/context-constitution.md`'s *structural* invariants (`PLAT-*` / `<MODULE>-*`). Read by
`/sdd-design` recon (Phase 0) to give the designer fast context on existing rules, and enforced as a
regression guard by the design-adversary (Constitution **C-16**).

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
   services' suites here (`/sdd-execute` integration PR, `/promote` backstop). `/sdd-archiver` curates
   these suites; it never deletes them.

## Scenario conventions

- Each `Scenario:` has a stable `@AC-<n>` tag and at least one `@FR-<n>` tag linking it to the
  Functional Requirement it exercises. IDs are **append-only** within a feature (test steps cite them).
- **Concrete example values only** — `252 days`, `"insufficient history"`, never "a valid window."
- `Then` clauses are **observable outcomes** (a returned value, a persisted row, a rendered element,
  an emitted event/alert), never implementation steps.
- On promotion, prefix a promoted scenario's tags with its source so provenance survives, e.g.
  `@AC-1 @FR-2 @feature-032` (source feature slug/number).

The binding rules are Constitution **C-15** (scenarios trace to tests) and **C-16** (business-rule
regression guard) in `docs/sdd/constitution.md`.

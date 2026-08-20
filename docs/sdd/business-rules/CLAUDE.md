# docs/sdd/business-rules/ — Business-Rule Suites (Gherkin)

Durable, behavior-level memory of what the platform **already guarantees** — the behavioral sibling
of `docs/context-constitution.md`'s structural invariants. Binding rules: Constitution **C-15**
(scenarios trace to tests) and **C-16** (regression guard) in `docs/sdd/constitution.md`.

| File | Purpose |
|---|---|
| `README.md` | The convention — where rules live, the pending→canonical lifecycle, scenario tag/format rules. Read this first. |
| `platform.feature` | Cross-cutting `@AC-*` rules (span >1 service). Single-service rules live in `services/xstockstrat-<svc>/acceptance/*.feature`, not here. |

## What an agent needs to know

- **Recon reads, never guesses.** `/sdd-design` Phase 0 loads the affected services' suites (+ this
  `platform.feature`) into `recon.md` → `## Existing Business Rules`; the design-adversary blocks a
  design that breaks an existing `@AC-*` (**C-16**).
- **Promotion is at launch**, not here-and-now: a feature's `acceptance.feature` scenarios are
  appended (deduped, `@feature-<NNN>` provenance) into the per-service suites by `/sdd-execute`'s
  integration PR. `/sdd-archiver` curates these suites; it **never deletes** a business rule.
- **Never hand-author a rule here to "document" behavior** — a rule enters only by promotion from a
  feature's reviewed `acceptance.feature`, so every guarantee is traceable to the feature that made it.

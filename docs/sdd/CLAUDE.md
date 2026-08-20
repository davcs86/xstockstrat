# docs/sdd/ — SDD Governance

Repo-wide governance for the Spec-Driven Development pipeline. Sibling to
`docs/patterns/context-engineering.md` (which covers *how* the AI tooling curates context); this
directory covers the *binding rules* that tooling must honor.

| File | Purpose | Read when |
|---|---|---|
| `constitution.md` | The binding rules of the SDD pipeline — Commandments (`C-*`), Process & Chain-of-Command principles (`P-*`), and the non-overridable Floor (`F-*`). Cited by ID from `/sdd-review`, `/sdd-design`, and `/sdd-execute`. | Authoring or reviewing any SDD artifact; resolving "is this allowed?" during spec/design/execute |
| `business-rules/` | Durable, behavior-level business-rule suites (Gherkin) — the behavioral sibling of `docs/context-constitution.md`. `platform.feature` holds cross-cutting rules; per-service rules live in `services/xstockstrat-<svc>/acceptance/*.feature`. Read by recon; enforced by **C-16**. See `business-rules/CLAUDE.md`. | Checking or promoting existing business rules during recon/design |

The Constitution consolidates rules that also appear, in context, in the root `CLAUDE.md`, each
skill's HARD CONSTRAINTS, and `docs/patterns/`. Those remain the operational homes; the Constitution
is the single ID'd index so gates can cite a violation precisely.

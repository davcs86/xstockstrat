# Product Spec: enforce-config-key-wiring

**Created**: 2026-10-23

---

## Problem Statement

A config key can ship as a silent no-op: it is seeded and shown in config-ui, but the service reads a different string, so editing it changes nothing and raises no error. Feature 277's recon found this at scale (5 `ingest` and 13 `analysis` keys seeded without the namespace prefix but read with it, plus seeds with no reader and read keys never seeded), and no step of the execution/validation loop would have caught any of it. The people hurt are operators who tune a knob that is not connected, and the next feature author who trusts a green test run.

## User Story

As a platform maintainer, I want the execution/validation loop and CI to prove that every config key a feature plans is actually read by code under the stored key, so that a seeded key cannot be inert or a read key unseeded.

## Functional Requirements

FR-1. A wiring check lists, from the config migrations and the service code, every config key by its stored form and its read form, and reports each of: a key seeded but read by no code, a key read by code but never seeded, and a key whose stored form differs from the string the reader looks up.
FR-2. The `/sdd-execute` validation of any step that adds or changes a config key (a `config` step, or a migration that inserts into `config.config_values`) runs the check and does not mark the step done while it reports a finding for a key that feature declared.
FR-3. The `/sdd-review impl-spec` criteria require, for every config key in the product spec's `Config Key Changes`, a step that names its reader (file and symbol) and a test that builds a config snapshot from the seeded key and asserts the real reader returns the seeded value.
FR-4. CI runs the check on every pull request and fails on a finding that is not in a tracked baseline; each baseline entry names the defect or feature that owns it, so existing debt (the 277 findings) does not block new work but cannot grow silently.

## Out of Scope

- Fixing the existing mismatched keys: the operator closed the defect report `docs/reports/2026-10-22-ingest-seeded-config-keys-never-read-defect.md` as `wont-fix` when demoting 277. The findings stay recorded in 277's `context.md` and become the CI baseline here.
- Changing the config service, its snapshot key shape, or the readers' lookup behavior.
- Runtime enforcement (a service refusing to start on an unread key).

## Affected Services

No runtime service. Touches repo tooling and process only:
- `scripts/` — the check
- `.github/workflows/ci.yml` — the CI job
- `.claude/skills/sdd-execute`, `.claude/skills/sdd-review` — the validation loop and review criteria
- config docs (`docs/patterns/config-governance.md`) — the rule the check enforces

## Consumer Surface(s)

- [ ] **UI**
- [ ] **Agent**
- [x] **None** — internal repo tooling and process; it has no end-user surface. Its consumers are authors and reviewers running `/sdd-execute`, `/sdd-review` and CI.

## Proto Contract Changes

- [x] No proto changes required

## Config Key Changes

- [x] No new config keys

## Database Changes

- [x] No schema changes

## Feature Workflow Notes

Branch to create: `feature/enforce-config-key-wiring` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [ ] 1 service owner approval (non-breaking proto or config change)
- [ ] 2 service owners + platform lead (breaking proto change)
- [ ] DBA review + service owner (schema migration)

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution **C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

- [ ] Where does the check live and how does it find readers across Go, Python and TypeScript (literal extraction from getter calls vs a per-service registry)? Literal extraction misses keys built at runtime; the design must say how those are handled.
- [ ] Is the stored form defined by the migration `key` column alone, or by the live snapshot (`values[row.key]`)? 277 showed the two conventions coexist (full dotted for newer seeds, namespace-stripped for older ones); the check must state which it treats as authoritative.
- [ ] Baseline or fix-first: CI gating with a baseline of the 18 known 277 keys, or wait until they are fixed? FR-4 assumes a baseline; confirm at design.
- [ ] Interaction with in-flight work: feature 243 (indicators.sandbox.* heal), 244 (moves reader literals into helpers; the check must survive that refactor) and 261.
- [ ] Known traps (ledger): the stored key must be read back against the reader string, not just counted (`fails.md:2335`), and a heal must snapshot first (`fails.md:2970-2978`); an earlier literal-string audit missed config reads outside the touched code (`fails.md:1040`).

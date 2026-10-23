# Product Spec: enforce-config-key-wiring

**Created**: 2026-10-23

---

## Problem Statement

A config key can ship as a silent no-op: it is seeded and shown in config-ui, but the service reads a different string, so editing it changes nothing and raises no error. Feature 277's recon found this at scale (5 `ingest` and 13 `analysis` keys seeded without the namespace prefix but read with it, plus seeds with no reader and read keys never seeded), and no step of the execution/validation loop would have caught any of it. The people hurt are operators who tune a knob that is not connected, and the next feature author who trusts a green test run.

## User Story

As a platform maintainer, I want the execution/validation loop and CI to prove that every config key a feature plans is actually read by code under the stored key, so that a seeded key cannot be inert or a read key unseeded.

## Functional Requirements

FR-1. A wiring check lists, from the config migrations and the service code, every config key by its stored form and its read form, and reports each of: a key seeded but read by no code, a key read by code but never seeded, and a key whose stored form differs from the string the reader looks up, and a read whose key is built at runtime and cannot be resolved (`dynamic-read`).
FR-2. The `/sdd-execute` validation of any step that adds or changes a config key (a `config` step, or a migration that inserts into `config.config_values`) runs the check and does not mark the step done while it reports a finding for a key that feature declared.
FR-3. The `/sdd-review impl-spec` criteria require, for every config key in the product spec's `Config Key Changes`, a step that names its reader (file and symbol) and a test that builds a config snapshot from the seeded key and asserts the real reader returns the seeded value.
FR-4. CI runs the check on every pull request and fails on a finding that is not in a tracked baseline; each baseline entry names the defect or feature that owns it, so existing debt (the 277 findings) does not block new work but cannot grow silently.

## Out of Scope

- Fixing the existing mismatched keys: the operator closed the defect report `docs/reports/2026-10-22-ingest-seeded-config-keys-never-read-defect.md` as `wont-fix` when demoting 277. The findings stay recorded in 277's `context.md` and become the CI baseline here (see Open Questions for its exact contents).
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

All five are resolved or explicitly deferred below; the decisions are also recorded in `context.md`.

- [x] **Check location and reader discovery** — Resolved as a requirement, mechanism deferred to `/sdd-design`. The check is a script under `scripts/` and must cover Go, Python and TypeScript readers and survive feature 244's move of reader literals into helpers. Keys built at runtime (non-literal getter arguments) are never silently skipped: each is reported as a finding of kind `dynamic-read` unless a baseline entry or an explicit in-code annotation names the key set it can produce. Design chooses literal extraction vs a per-service registry within that constraint.
- [x] **Authoritative stored form** — Resolved: the stored form is the string the live snapshot serves, `values[row.key]`, and the migration `key` column is its source (namespace-prefixed or not as the row stores it). The reader string must equal that stored key verbatim; the check never normalizes a bare key into a dotted one, so a bare seed read dotted is a `form-mismatch` (@AC-1).
- [x] **Baseline or fix-first** — Resolved: baseline (FR-4). Feature 277 was demoted and its defect report closed `wont-fix`, so nothing fixes the existing findings. The baseline is every finding the first check run produces, reconciled against feature 277's recorded sweep: the 5 `ingest` and 13 `analysis` form mismatches (18), the dead seeds `analysis` `backtest.max_duration_seconds` and `ledger` `stream.notify_enabled`, the unseeded `ingest.backfill.max_concurrent_jobs` and `ingest.backfill.retry_on_failure`, and `indicators.sandbox.*` (owned by feature 243). Each entry names 277, 278 or 243 as owner. Design records the exact final count.
- [x] **In-flight work (243, 244, 261)** — Deferred to `/sdd-design` with the constraint stated here: the check must tolerate 244's reader refactor, treat 243's `indicators.sandbox.*` entries as baseline owned by 243 until it lands, and not depend on 261's key (`ingest.mcp_client.request_timeout_seconds`) being healed. Merge-order is design's call.
- [x] **Known traps (ledger)** — Adopted as acceptance constraints: the stored key is read back against the reader string, not just counted (`fails.md:2335`, @AC-1); the check is read-only and never heals or rewrites a seed, so the snapshot-first heal trap (`fails.md:2970-2978`) does not apply; reads outside the touched code are covered because the check scans every service, not the diff (`fails.md:1040`).

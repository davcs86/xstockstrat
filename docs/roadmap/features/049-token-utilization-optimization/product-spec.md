# Product Spec: token-utilization-optimization

**Created**: 2026-06-05

---

## Problem Statement

The `docs/roadmap/features/` directory currently holds 48+ feature directories in a single flat list. Every SDD skill invocation (`/sdd-status`, `/sdd-spec`, `/sdd-execute`, `/sdd-review`) globs all directories, loading metadata from launched and demoted features that have no bearing on active work. As the backlog grows the per-session token cost of these scans scales linearly with total feature count rather than active-backlog count.

## User Story

As a developer using the SDD workflow, I want SDD skills to only scan features that are actively in-flight by default, so that per-session token cost stays proportional to the current active backlog and not the total historical backlog.

## Functional Requirements

FR-1. The `docs/roadmap/features/` directory is reorganized into three subdirectories: `active/`, `launched/`, and `demoted/`.

FR-2. `active/` contains all features whose lifecycle status is one of: `idea`, `draft`, `spec-ready`, `implementation-ready`, `in-progress`, `code-completed`, `rolled-back`.

FR-3. `launched/` contains all features whose lifecycle status is `launched`.

FR-4. `demoted/` contains all features whose lifecycle status is `demoted/canceled`.

FR-5. All existing files within each feature directory (`feature.md`, `product-spec.md`, `implementation-spec.md`, `context.md`) are preserved intact — no files are deleted or truncated.

FR-6. All SDD skill files (`.claude/skills/sdd-*.md` and related) that glob `docs/roadmap/features/*/` are updated to glob `docs/roadmap/features/active/*/` by default.

FR-7. `/sdd-status` defaults to scanning `active/` only. Passing `--all` scans all three subdirs and renders a combined table grouped by queue.

FR-8. `/sdd-status` writes a `docs/roadmap/features/STATUS.md` cache file after each run. On subsequent runs, if `STATUS.md` is newer than all `feature.md` files in `active/`, it reads the cache and skips the full glob. The cache is invalidated (ignored) if any `feature.md` in `active/` is newer than `STATUS.md`.

FR-9. When a feature transitions to `launched` (via the CI `ci-validate-feature-status.yml` workflow) or to `demoted/canceled` (manually or via `/sdd-triage`), the feature directory is moved from `active/` to the corresponding queue subdirectory automatically or with a documented manual step.

FR-10. The root `CLAUDE.md` Feature Roadmap section, `docs/roadmap/features/CLAUDE.md`, and any other documentation that references the flat `features/NNN-slug` path pattern is updated to reflect the new `features/active/NNN-slug`, `features/launched/NNN-slug`, and `features/demoted/NNN-slug` path structure.

FR-11. The `merge-order.md`, `FEATURE-TEMPLATE.md`, and `CLAUDE.md` shared files remain at `docs/roadmap/features/` (not moved into a subdir).

FR-12. The `FEATURE-TEMPLATE.md` and `features/CLAUDE.md` NNN auto-assignment command is updated to count across all three subdirs so sequence numbers remain globally unique.

## Out of Scope

- Changing the content or format of any `feature.md`, `product-spec.md`, `implementation-spec.md`, or `context.md` file — only paths change.
- Changing the SDD lifecycle statuses themselves.
- Automated tooling to move features between queues on every status change (FR-9 covers the two terminal transitions; mid-lifecycle moves remain in `active/`).
- Changing how `merge-order.md` references features (slugs are unchanged; only the directory prefix changes).

## Affected Services

No runtime services are affected. Changes are confined to:
- `docs/roadmap/features/` — directory restructure and file moves
- `.claude/skills/` — SDD skill glob pattern updates
- `docs/roadmap/features/CLAUDE.md` — index update
- `docs/runbooks/feature-workflow.md` — path reference update
- Root `CLAUDE.md` — Feature Roadmap section path references
- `.github/workflows/ci-validate-feature-status.yml` — post-promotion path update

## Proto Contract Changes

- [x] No proto changes required

## Config Key Changes

- [x] No new config keys

## Database Changes

- [x] No schema changes

## Feature Workflow Notes

Branch to create: `feature/token-utilization-optimization` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking; docs + tooling only)
- [ ] 2 service owners + platform lead (breaking proto change) — not applicable
- [ ] DBA review + service owner (schema migration) — not applicable

## Acceptance Criteria

1. `ls docs/roadmap/features/` shows only `active/`, `launched/`, `demoted/`, `CLAUDE.md`, `FEATURE-TEMPLATE.md`, and `merge-order.md` — no bare `NNN-slug` dirs.
2. `/sdd-status` (no args) produces a correct table listing only features in `active/` without errors.
3. `/sdd-status --all` produces a combined table covering all three queues.
4. `STATUS.md` is written after `/sdd-status` runs and is read on the next call when no `feature.md` has changed.
5. All `context.md` files in `launched/` are intact and accessible.
6. `/sdd-spec token-utilization-optimization` resolves paths correctly under the new structure.
7. The CI `ci-validate-feature-status.yml` workflow successfully moves a feature from `active/` to `launched/` on a promotion merge.
8. NNN sequence numbers remain globally unique across all three subdirs (the next `/sdd-story` call produces NNN = 050 or higher, not a collision).

## Open Questions

- [ ] Should `rolled-back` features live in `active/` or `launched/`? (Current draft: `active/`, since they may be re-attempted.)
- [ ] Should the STATUS.md cache include `launched/` and `demoted/` counts in a summary header even when `--all` is not passed?

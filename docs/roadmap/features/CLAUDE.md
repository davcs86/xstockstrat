# docs/roadmap/features/ — Feature Implementations

Each subdirectory tracks one feature from user story through implementation and deployment.

---

## Feature Lifecycle Statuses

| Status | Meaning |
|---|---|
| `idea` | Story captured, no spec yet |
| `draft` | Product spec written, pending review |
| `spec-ready` | Product spec approved, ready to plan |
| `implementation-ready` | Implementation spec generated |
| `in-progress` | Execution started |
| `code-completed` | All steps done, awaiting deploy |
| `launched` | Live in production |
| `rolled-back` | Deployed but reverted |
| `demoted/canceled` | Not going forward |

## Bug Lifecycle Statuses

Bug fixes created by `/sdd-triage` use the same status values as features. The `**Type**: bug`
field in `feature.md` distinguishes them from features in `/sdd-status` output and the `/promote`
CHANGELOG.

Additional fields present in bug `feature.md` files:

| Field | Values | Description |
|---|---|---|
| `**Type**` | `bug` | Marks this as a bug fix (absent or `feature` = standard feature) |
| `**Severity**` | `SEV-1`, `SEV-2`, `SEV-3` | Bug severity from triage |
| `**GitHub Issue**` | URL | Link to the originating GitHub issue |

---

## Files in Each Feature Directory

| File | Created by | Purpose |
|---|---|---|
| `feature.md` | `/sdd-story` or `/sdd-triage` | Lifecycle status, links to all artifacts — **check this first** |
| `product-spec.md` | `/sdd-story` or `/sdd-triage` | Requirements or bug description and fix scope |
| `implementation-spec.md` | `/sdd-spec` | Numbered steps with exact file/symbol references and statuses |
| `context.md` | All skills | Append-only session log — **ALWAYS read before touching feature files** |

---

## Key Rule

Never edit files related to a feature without first reading its `context.md`.
Prior sessions document deviations and decisions that are not visible in the code itself.

Run `/sdd-status` for a live summary of all features.

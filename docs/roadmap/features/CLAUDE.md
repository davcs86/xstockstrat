# docs/roadmap/features/ — Feature Implementations

Each subdirectory tracks one feature from user story through implementation and deployment.

---

## Lifecycle Statuses

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

---

## Files in Each Feature Directory

| File | Created by | Purpose |
|---|---|---|
| `feature.md` | `/sdd-story` | Lifecycle status, links to all artifacts — **check this first** |
| `product-spec.md` | `/sdd-story` | Requirements, affected services, governance gates |
| `implementation-spec.md` | `/sdd-spec` | Numbered steps with exact file/symbol references and statuses |
| `context.md` | All skills | Append-only session log — **ALWAYS read before touching feature files** |

---

## Key Rule

Never edit files related to a feature without first reading its `context.md`.
Prior sessions document deviations and decisions that are not visible in the code itself.

Run `/sdd-status` for a live summary of all features.

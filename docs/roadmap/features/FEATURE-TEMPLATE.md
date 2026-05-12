# Feature Template: [Feature Name]

This is a template for creating new feature tracking documents. Copy to `NNN-<slug>/feature.md`.

---

## Minimal Header (all features must have)

```markdown
# Feature: <slug>

**Lifecycle Status**: `<status>`
**Development Branch**: `feature/<slug>`
**Created**: YYYY-MM-DD
**Last Updated**: YYYY-MM-DD

---
```

## Optional Tracking Fields (auto-populated by CI)

Once a feature is promoted to production:

```markdown
**Committed to main**: <commit-sha>
**Launched date**: YYYY-MM-DD
```

- **Committed to main**: The commit SHA when this feature was first merged to the `main` branch (production). Set automatically by `ci-validate-feature-status.yml` workflow.
- **Launched date**: The date the feature reached `launched` status. Set automatically by the CI workflow.

These fields make feature status **auditable** — you can always trace back to the exact commit and date a feature went live.

---

## Status History

```markdown
## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| YYYY-MM-DD | `idea` → `draft` | /sdd-story | Product spec generated |
| YYYY-MM-DD | `draft` → `spec-ready` | /sdd-review | Spec approved |
| ... | ... | ... | ... |
| YYYY-MM-DD | `code-completed` → `launched` | CI workflow | Promoted to main; committed SHA-HASH |
```

**Key rule**: When a promotion PR merges to `main`, the CI workflow **automatically** adds a status history entry like:

```
| YYYY-MM-DD | `code-completed` → `launched` | CI workflow | Promoted via PR #NNN; committed <commit-sha> |
```

You do not need to manually add this entry.

---

## Artifacts Section

```markdown
## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — numbered steps
- [Context Log](context.md) — session history, decisions, deviations
```

---

## Summary

One or two sentences describing what the feature does.

---

## Reviewers (optional, snapshot at implementation-ready)

```markdown
## Reviewers

_(Snapshot finalized by /sdd-spec on YYYY-MM-DD. Re-run /sdd-spec if registry changes.)_

| Role | Review Focus |
|---|---|
| ... | ... |
```

---

## Next Action

Brief description of what's needed next, or "— launched in production" if done.

---

## Lifecycle Statuses Reference

| Status | Meaning | Auto-updated by |
|---|---|---|
| `idea` | Captured, no spec yet | — (manual) |
| `draft` | Product spec written | /sdd-story |
| `spec-ready` | Product spec approved | /sdd-review |
| `implementation-ready` | Implementation spec ready | /sdd-spec |
| `in-progress` | Execution started | /sdd-execute |
| `code-completed` | All steps done | /sdd-execute |
| `launched` | Live in production | CI workflow (on promotion PR merge) |
| `rolled-back` | Deployed but reverted | — (manual) |
| `demoted/canceled` | Not going forward | — (manual) |

---

## Key Rule: Always Read context.md

Before touching any feature files, **always read the `context.md` first**. It contains:
- Critical decisions from prior sessions
- Deviations from the spec
- Known issues and workarounds
- Why things were done a certain way

This information is **not visible in the code** and is essential for avoiding rework.

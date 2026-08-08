# Feature: shadcn-migration-low-confidence

**Lifecycle Status**: `draft`
**Development Branch**: `feature/shadcn-migration-low-confidence`
**Created**: 2026-08-08
**Last Updated**: 2026-08-08

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-08 | `idea` → `draft` | /sdd-story | Product spec generated |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec shadcn-migration-low-confidence`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Evaluate the 4 low-confidence occurrences the shadcn/ui gap audit found — two one-line inline
success/error messages loosely shaped like `Alert`, and two manually-wired forms loosely shaped like
shadcn's `Form` (react-hook-form + zod) recipe — and migrate only where doing so doesn't add
disproportionate weight (new dependencies, more code) for what each call site actually needs.

## Reviewers

| Role | Review Focus |
|---|---|
| `xstockstrat-ui` service owner | Trading UI correctness, analytics display accuracy, config mutation safety, Connect-RPC call safety, environment scope correctness, no secret values rendered in UI, no direct DB access (except audit log) |

## Next Action

`/sdd-review shadcn-migration-low-confidence product-spec` — AI review of product spec before running /sdd-spec

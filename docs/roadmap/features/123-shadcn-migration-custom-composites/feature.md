# Feature: shadcn-migration-custom-composites

**Lifecycle Status**: `draft`
**Development Branch**: `feature/shadcn-migration-custom-composites`
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
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec shadcn-migration-custom-composites`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Fourth and final backlog feature from "The Component Ledger" shadcn/ui gap audit: close out the
Combobox finding (already resolved by `119-shadcn-ui-migration` — verification only), consolidate the
app's three independent charting approaches onto the official shadcn `Chart` primitive where the shape
fits, extract a shared shadcn-primitive-based composite for the app's three repeatable-row editors
(`OutputEditor`, `ParameterEditor`, `RuleEditor`'s condition builder), and adopt the shadcn
`Questionnaire` primitive for `StrategyWizard`'s step shell.

## Reviewers

| Role | Review Focus |
|---|---|
| `xstockstrat-ui` service owner | Trading UI correctness, analytics display accuracy, config mutation safety, Connect-RPC call safety, environment scope correctness, no secret values rendered in UI, no direct DB access (except audit log) |

## Next Action

`/sdd-review shadcn-migration-custom-composites product-spec` — AI review of product spec before running /sdd-spec

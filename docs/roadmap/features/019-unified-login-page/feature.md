# Feature: unified-login-page

**Lifecycle Status**: `idea`
**Development Branch**: `feature/unified-login-page`
**Created**: 2026-05-25
**Last Updated**: 2026-05-25

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-05-25 | `idea` | manual | Captured as follow-up to 018-agent-mcp-oauth |

---

## Artifacts

- [Product Spec](product-spec.md) — preliminary idea capture (not yet reviewed)
- [Implementation Spec](implementation-spec.md) — _not yet generated_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Replaces the four separate login forms added across the platform (three Next.js frontends + the minimal identity `/login` from feature 018) with a single server-rendered login page hosted in `xstockstrat-identity`. All frontends and OAuth flows redirect here for authentication. Eliminates duplicate login logic and provides a consistent operator experience.

## Reviewers

_(Populated at /sdd-spec time)_

## Next Action

`/sdd-story unified-login-page <story text>` — promote to `draft` when ready to spec

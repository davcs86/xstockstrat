# Feature: remove-n8n-references

**Lifecycle Status**: `implementation-ready`
**Development Branch**: `feature/remove-n8n-references`
**Created**: 2026-05-16
**Last Updated**: 2026-05-18

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-05-16 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-05-18 | `draft` → `implementation-ready` | /sdd-spec | Implementation spec generated with 16 steps |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — 16 steps, generated 2026-05-18
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Remove all n8n references from the codebase and documentation — renaming webhook handler files/directories, changing URL paths from `/webhooks/n8n/<action>` to `/webhooks/<action>`, deleting the unused `packages/n8n/` directory, and updating all docs. Endpoint functionality is unchanged; only naming and paths change.

## Reviewers

_(Snapshot finalized at /sdd-spec time 2026-05-18. Re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-config` owner | Config mutation safety, no broken route registrations after rename |
| `xstockstrat-ledger` owner | Append-only invariant unaffected; webhook path change doesn't break event emission |
| `xstockstrat-notify` owner | Stream delivery unaffected; no broken alert webhook paths |
| `xstockstrat-identity` owner | Auth webhook path change doesn't break token validation flows |
| `xstockstrat-trading` owner | Order execution correctness unaffected; no broken handler references |
| `xstockstrat-indicators` owner | No side-effects from webhook rename; formula execution unaffected |
| `xstockstrat-analysis` owner | Backtest endpoint path change consistent with other services |
| `xstockstrat-ingest` owner | Signal ingestion unaffected; webhook path change propagated correctly |

## Next Action

`/sdd-review remove-n8n-references impl-spec` — validate implementation spec, then `/sdd-execute remove-n8n-references`

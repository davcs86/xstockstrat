# Feature: remove-n8n-references

**Lifecycle Status**: `draft`
**Development Branch**: `feature/remove-n8n-references`
**Created**: 2026-05-16
**Last Updated**: 2026-05-16

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-05-16 | `idea` → `draft` | /sdd-story | Product spec generated |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec remove-n8n-references`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Remove all n8n references from the codebase and documentation — renaming webhook handler files/directories, changing URL paths from `/webhooks/n8n/<action>` to `/webhooks/<action>`, deleting the unused `packages/n8n/` directory, and updating all docs. Endpoint functionality is unchanged; only naming and paths change.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-config` owner | Config mutation safety, no broken route registrations after rename |
| `xstockstrat-ledger` owner | Append-only invariant unaffected; webhook path change doesn't break event emission |
| `xstockstrat-notify` owner | Stream delivery unaffected; no broken alert webhook paths |
| `xstockstrat-identity` owner | Auth webhook path change doesn't break token validation flows |
| `xstockstrat-trading` owner | Order execution correctness unaffected; no broken n8n.go handler references |
| `xstockstrat-indicators` owner | No side-effects from webhook rename; formula execution unaffected |
| `xstockstrat-analysis` owner | Backtest endpoint path change consistent with other services |
| `xstockstrat-ingest` owner | Signal ingestion unaffected; webhook path change propagated correctly |

## Next Action

`/sdd-review remove-n8n-references product-spec` — AI review of product spec before running /sdd-spec

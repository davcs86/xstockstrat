# Feature: fix-listkeys-wire-encoding

**Type**: bug
**Development Branch**: `feature/fix-listkeys-wire-encoding` (this run: `claude/feature-073-mcp-config`)
**GitHub Issue**: n/a — GitHub Issues are disabled on `davcs86/xstockstrat`
**Severity**: SEV-2
**Created**: 2026-07-29
**Last Updated**: 2026-07-29
**Archived**: 2026-08-19

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-07-29 | `bug-reported` → `code-completed` | direct fix | Surfaced by the 073 re-review, confirmed by executing a real gRPC call. Same defect class feature 075 fixed for `ConfigSnapshot` and missed for `ListKeysResponse`. |
| 2026-08-19 | `launched` | /sdd-archiver | Archived: synthesis → context.md + Ledger insights(1)/fails(1); pruned 1 spec |

---

## Artifacts

- [Product Spec](product-spec.md)
- [Context Log](context.md)

---

## Reviewers

| Step Category | Reviewer Roles |
|---|---|
| `service` — xstockstrat-config | Service owner — `ListKeys` response encoding |
| `service` — xstockstrat-ui (config-ui) | Service owner — the secret-edit guard this restores |
| Security | Required — the inert guard let a secret key be edited in `/config-ui` |

## Summary

`ConfigService.ListKeys` built its response with **snake_case** field names and **numeric** enums,
but ts-proto encodes **camelCase** and (`stringEnums=true`) string enum constants. So
`ConfigKeyMeta.encode()` read `undefined` for `default_value`, `is_secret`, `consuming_service`,
`trading_mode` and `validation`, and wrote proto defaults instead. Over the wire, **every key**
arrived with `isSecret=false`, empty `defaultValue`/`consumingService`, and `UNRECOGNIZED` enums.

The security-relevant consequence: `/config-ui` gates its "cannot edit this key" behavior on
`k.isSecret` from `ListKeys` — so **that guard has never worked**, and secret-flagged keys were
editable in the UI.

## Next Action

Merge with the 073 branch PR. No operator action required.

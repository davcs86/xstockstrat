# Feature: fix-config-scope-resolution

**Type**: bug
**Lifecycle Status**: `code-completed`
**Development Branch**: `feature/fix-config-scope-resolution` (this run: `claude/feature-073-mcp-config`)
**GitHub Issue**: n/a — GitHub Issues are disabled on `davcs86/xstockstrat`
**Severity**: SEV-1
**Created**: 2026-07-29
**Last Updated**: 2026-07-29

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-07-29 | `bug-reported` → `code-completed` | direct fix | Predicted by the 073 design-adversary, then confirmed by executing a real gRPC call. Partially logged already (`trading_mode` half) in the service findings doc; the `environment` half and the read-path impact were not known. |

---

## Artifacts

- [Product Spec](product-spec.md)
- [Context Log](context.md)

---

## Reviewers

| Step Category | Reviewer Roles |
|---|---|
| `service` — xstockstrat-config | Service owner — env/mode scoping is this service's core contract |
| Security | Required — production and dev config were silently merged into one bucket |
| Platform lead | Every service's startup config is affected |

## Summary

`ConfigService` resolved **every** request to the `('dev', 'all')` scope, whatever the caller asked
for. Two independent decoding bugs in the same two helpers:

- `resolveEnv` looked the request's `environment` up in a **numeric** map, but ts-proto
  (`stringEnums=true`) delivers the string constant `'ENVIRONMENT_PRODUCTION'` — no match, so `'dev'`.
- `resolveMode` read `call.request.trading_mode`, but ts-proto delivers `tradingMode` — always
  `undefined`, so `'all'`.

Both helpers back **all four** RPCs (`WatchConfig`, `GetConfig`, `SetConfig`, `ListKeys`), so:

1. **Production config rows were unreachable over the RPC.** Migration `007` seeds `production` rows;
   nothing could ever read them.
2. **Every service received dev config at startup**, regardless of the `environment` it passed to
   `WatchConfig` — including in production.
3. **`SetConfig` wrote dev rows when told production**, so a production rollout appeared to succeed
   and changed nothing.

## Next Action

Merge with PR #806. **Operational check before relying on this**: production config rows have never
been served, so whatever is running in production today has been using the `dev` values. Diff
`config.config_values` between `environment='dev'` and `'production'` before deploying, because this
fix will change what every service reads.

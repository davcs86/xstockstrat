# Product Spec: fix-config-audit-author-spoof

**Type**: bug
**GitHub Issue**: none. Defect report: `docs/reports/2026-10-19-config-audit-author-caller-spoofable-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-20

---

## Problem Statement

**Observed.** `SetConfig` authorizes on the propagated `x-user-id` / `x-access-scope`. The global gate is at
`services/xstockstrat-config/src/grpc/configServiceImpl.ts:386` and the per-user owner branch is at `:394`.
The write, however, is attributed to `call.request.author || userIdFrom(call.metadata)` (`:410`), so the
verified `x-user-id` is used only when `author` is empty. `author` is persisted as `updated_by` (INSERT
params at `:513`). The audit triggers then copy it into `config.config_audit.changed_by`
(`migrations/017_config_secrets_and_scoping.up.sql:66-91`). The MCP `set_config` tool exposes `author` as a
free-text parameter and forwards it unchanged (`services/xstockstrat-agent/app/tools.py:1694`). An admin, or a
user writing their own per-user row, can therefore attribute any change to another person, including a
`platform.trading_state` or secret write. The UI BFFs are not affected because they stamp
`author: claims.user_id` (`services/xstockstrat-ui/src/lib/configUiBff.ts:53`, `insightsBff.ts:179`).

**Expected (operator decision 2026-10-20, context.md).** Attribution (`updated_by` / `changed_by`) comes only
from verified identity:
- a human write takes the propagated `x-user-id`;
- an automated write takes the `callerID` of the `x-internal-caller` grant that actually authorized it.
  `hasInternalCallerAuthority` (`services/xstockstrat-config/src/grpc/authz.ts:82-96`) must return true; an
  unauthorized header is not verified identity.

`SetConfigRequest.author` is ignored. A write with no verified identity is rejected with `INVALID_ARGUMENT`,
even when it passes the authz gate and carries a free-text `author`. Today the global gate accepts an admin
write with no `x-user-id` (`:386`) and attributes it to `author` (`:410`).

**Open for /sdd-design:** which identity wins when both `x-user-id` and an authorized `x-internal-caller` are
present. The operator decision lists `x-user-id` first.

## Reproduction Steps

1. As any admin MCP session, call `set_config` with `author="someone-else@example.com"`, any reason, and a global key.
2. Query `config.config_audit` for that key.
3. `changed_by` is `someone-else@example.com`, not the session's user id.

## Root Cause Hypothesis

`author` predates header propagation and stayed the primary attribution source. The authz gate moved to the
verified headers (feature 074, PR #994), but attribution never followed. `MISSING_AUTHOR_ERROR`
(`configServiceImpl.ts:411-414`) is still keyed on the free-text field.

## Affected Services

- **xstockstrat-config.** Attribution source in `SetConfig` (`configServiceImpl.ts:410-414`, `:513`). Tests that
  pin the old attribution: `src/__tests__/internalCallerSetConfig.test.ts:73`, which sends
  `author: 'system:reconciliation-poller'`.
- **xstockstrat-agent.**
  - `set_config` tool `author` parameter: `tools.py:1648,1663,1694`, forwarded through `client.set_config`
    (`app/client.py:2094,2100,2142`).
  - `_write_source_bearer` (`tools.py:341-360`, `author=tool` at `:353`), whose two callers are
    `instantiate_template` (`tools.py:1222`) and `manage_signal_source` (`tools.py:1309`).
- **xstockstrat-trading.** The reconciliation poller's `escalateSystemic` SetConfig
  (`services/xstockstrat-trading/internal/service/trading.go:2168-2176`) sends
  `Author: "system:reconciliation-poller"` (`:2176`) under `x-internal-caller: trading-reconciliation-poller`.
  - Per the operator decision, its attribution moves to the `x-internal-caller` identity, and that `Author`
    becomes inert.
  - The field becomes `[deprecated = true]`, which staticcheck (`services/xstockstrat-trading/.golangci.yml:7`)
    is likely to flag on use (SA1019).
  - Design decides whether to remove `:2176` and the assertion at `trading_reconciliation_test.go:789-790`.
- **xstockstrat-ui.** The BFFs already send the verified id (`configUiBff.ts:53`, `insightsBff.ts:179`). Once
  the field is deprecated, those `author` sends are inert, and design decides whether to drop them (C-10).

## Fix Scope

- [x] **Proto, non-breaking.** Mark `SetConfigRequest.author` (`packages/proto/config/v1/config.proto:126`,
  field 4) `[deprecated = true]`, keeping its name and number. Precedent: `trading_mode` at `config.proto:129`.
  - This adds an option, not a removal or renumber (`docs/runbooks/proto-versioning.md:5-15`), so
    `buf breaking` passes.
  - Approval route: Proto Reviewer + `packages/proto` owner (feature.md § Reviewers). The breaking-proto route
    (2 owners + platform lead, root `CLAUDE.md` § Approval Flow) does not apply.
  - Repurposing the field is rejected by the operator decision.
  - Verification per C-09: `buf lint`, `buf breaking`, `./scripts/buf-gen.sh`.
- [x] **No DB migration.** `author` is ignored, not stored in a separate non-authoritative column (operator
  decision). The audit trigger functions (`017_config_secrets_and_scoping.up.sql:66-91`) keep copying
  `NEW.updated_by` into `changed_by` unchanged. This removes the conditional `031` clash with feature 243.
- [x] No config key changes anticipated.
- [x] **Docs.** Every fix option changes the following:
  - `services/xstockstrat-config/CLAUDE.md`:
    - invariant #5 (`:40`, the `author`-or-`x-user-id` `INVALID_ARGUMENT` rule);
    - invariant #7 (`:55`, which mentions free-text `author`);
    - `## Webhooks` (`:97`, "an attributable author").
  - `docs/patterns/config-governance.md` § Author-sentinel conventions (`:93-103`):
    - the `system:reconciliation-poller` row (`:103`) is retired as a `changed_by` value, per the operator
      decision;
    - the `system` row is the indicators `Formula.author` and is unaffected.
  - `docs/runbooks/mcp-tools.md` § `set_config` (`:1096`) changes whenever the tool's `author` parameter or its
    semantics change.
- [ ] **Agent tool contract (design fork).** The agent stops sending a free-text `author` (operator decision).
  Design decides whether the `set_config` `author` parameter is removed, or kept as accepted-but-ignored for
  MCP contract stability.

## Consumer Surface(s)

- **Agent MCP `set_config`.** `author` stops being authoritative. Attribution becomes the OAuth caller's
  `x-user-id`. It is a tool contract change if the parameter is removed.
- **Agent MCP `manage_signal_source` and `instantiate_template`.** Both write the source bearer secret through
  `_write_source_bearer` (`tools.py:353`). Its `changed_by` changes from the tool name to the caller's
  `x-user-id`.
- **`/config-ui` audit view** (`services/xstockstrat-ui/src/app/config-ui/api/audit/route.ts`). It shows the
  verified identity, and for the reconciliation poller it shows `trading-reconciliation-poller` instead of
  `system:reconciliation-poller`.

## Acceptance Criteria

See `acceptance.feature` for the regression scenarios that must fail on the buggy behavior and pass after the
fix (Constitution **C-15**):
- AC-1: a human write;
- AC-2: an internal-caller write;
- AC-3: no verified identity → rejected.

Also, existing tests pass and the affected services are smoke-tested on dev.

No durable business-rule suite pins `author` / `changed_by` (no hits in `services/*/acceptance/*.feature`), so
no C-16 change sign-off is needed.

## Out of Scope

- Rewriting historical `config.config_audit.changed_by` rows already attributed from free text
- Changes to the SetConfig authz gate itself (scope rules unchanged)
- `caller_identity` persistence of an unauthorized `x-internal-caller` header (`configServiceImpl.ts:405`)
- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix

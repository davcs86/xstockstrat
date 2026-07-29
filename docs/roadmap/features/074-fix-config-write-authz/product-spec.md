# Product Spec: fix-config-write-authz

**Type**: bug
**GitHub Issue**: n/a — GitHub Issues are disabled on `davcs86/xstockstrat`
**Severity**: SEV-1
**Created**: 2026-07-28

---

## Problem Statement

**Observed:** `xstockstrat-config`'s `ConfigService.SetConfig` gRPC RPC performs no authorization
check of any kind — it reads no metadata/headers before applying a write
(`services/xstockstrat-config/src/grpc/configServiceImpl.ts`, `setConfig` method — confirmed
present on `origin/main`, i.e. production, not just `main-dev`). `xstockstrat-ui`'s config-ui BFF
calls this same RPC with only a session check, no admin-scope check
(`services/xstockstrat-ui/src/lib/configUiBff.ts`, `setConfig` handler: `requireSession(ctx)`
only, no `requireAdminScope` — also confirmed present on `origin/main`).

Net effect: any authenticated `/config-ui` user, regardless of role (`viewer`/`trader`/`admin`),
can currently write any config key in any namespace, including:
- `platform.maintenance_mode` — halt all trading platform-wide
- `trading.approval.*` thresholds — raise the approval-required notional/quantity arbitrarily,
  bypassing the order-approval flow (`docs/runbooks/approval-flow.md`)
- Any other operational flag or threshold across every service

This matches the bug-triage SEV-1 indicator "Order approval flow is bypassed or stuck" — the bug
makes that bypass directly reachable by any signed-in user, not just admins, though it has not
been observed exploited.

**Expected:** `SetConfig` rejects the write (`PERMISSION_DENIED`) unless the caller's
`x-access-scope` carries the `ADMIN` bit (`0x04`), matching the platform's existing bitmask
convention (`docs/patterns/header-propagation.md:24-26`) and the pattern already implemented
elsewhere (`rolesToAccessScope`, `services/xstockstrat-ui/src/lib/auth.ts:65-76`).

## Reproduction Steps

1. Log into `/config-ui` as any user with role `trader` or `viewer` (not `admin`).
2. Submit a change to any non-secret config key (e.g.
   `trading.approval.require_above_notional`) through the config-ui editor, or call the
   `SetConfig` Connect-RPC/gRPC endpoint directly with a valid session but no admin role.
3. Observe the write succeeds and propagates live via `WatchConfig` — no `PERMISSION_DENIED`,
   despite the caller lacking the `ADMIN` scope bit.

## Root Cause Hypothesis

`SetConfig`/`GetConfig`/`ListKeys` were implemented without any role-check gate from the start.
Unlike other admin-sensitive RPCs on the platform, no `requireAdminScope`-equivalent check was
ever added on the `xstockstrat-config` side, and the UI's BFF layer only enforces "is this a valid
session" (`requireSession`) rather than "does this session have the right role"
(`requireAdminScope`, which exists and is used elsewhere in the same BFF family per
`docs/patterns/header-propagation.md`).

## Affected Services

- `xstockstrat-config` — `SetConfig` RPC needs an `ADMIN`-scope authorization check
  (`services/xstockstrat-config/src/grpc/configServiceImpl.ts:251-273`)
- `xstockstrat-ui` — config-ui BFF's `setConfig` handler needs `requireAdminScope`, not just
  `requireSession` (`services/xstockstrat-ui/src/lib/configUiBff.ts:14-22`)

## Fix Scope

- [x] No proto changes anticipated — `x-access-scope` is an existing header convention, not a
  proto field
- [x] No database migrations anticipated
- [x] No config key changes anticipated — this is an authorization check, not a new config value

(Update after investigation — remove or replace each item as needed)

## Acceptance Criteria

- [ ] `SetConfig`, called without the `ADMIN` scope bit, is rejected with `PERMISSION_DENIED`
- [ ] `SetConfig`, called with the `ADMIN` scope bit, succeeds unchanged (no regression for
  legitimate admin writes, including existing `manage_signal_source`/`manage_strategy`-style
  callers that already forward admin scope)
- [ ] config-ui's `setConfig` BFF handler rejects a non-admin session's write attempt before it
  ever reaches the backend RPC (defense in depth, not solely relying on the backend check)
- [ ] Existing config-rollout procedures (`docs/runbooks/config-rollout.md`) continue to work for
  an actual admin caller — reproduce Step 2's `SetConfig` example end-to-end post-fix
- [ ] Affected service(s) smoke-tested on dev environment

## Out of Scope

- Feature 073 (`mcp-config-management`)'s new MCP tools (`get_config`/`list_config_keys`/
  `set_config`) — that feature's FR-7 already anticipated this exact fix and should build on top
  of it once merged, not duplicate it. See context.md for the cross-feature note.
- Adding real secret-store resolution for `secret.*` values — unrelated to this authorization gap
  (see feature 073's product-spec "Known trap" — same caveat applies here).
- Refactoring unrelated to the bug.
- Performance improvements unrelated to the fix.

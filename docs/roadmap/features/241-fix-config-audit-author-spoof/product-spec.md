# Product Spec: fix-config-audit-author-spoof

**Type**: bug
**GitHub Issue**: none. Defect report: `docs/reports/2026-10-19-config-audit-author-caller-spoofable-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-20

---

## Problem Statement

**Observed.** `SetConfig` authorizes on the propagated `x-user-id` / `x-access-scope`
(`services/xstockstrat-config/src/grpc/configServiceImpl.ts:388`), but attributes the write to
`call.request.author || userIdFrom(call.metadata)` (`:404`); the verified `x-user-id` is used only when
`author` is empty. `author` is persisted as `updated_by` (`:507`) and the audit triggers copy it into
`config.config_audit.changed_by`. The MCP `set_config` tool exposes `author` as a free-text parameter and
forwards it unchanged (`services/xstockstrat-agent/app/tools.py:1694`). An admin, or a user writing their own
per-user row, can therefore attribute any change, including a `platform.trading_state` or secret write, to
another person. The UI BFFs are not affected: they stamp `author: claims.user_id`
(`services/xstockstrat-ui/src/lib/configUiBff.ts:53`, `insightsBff.ts:179`).

**Expected.** The authoritative attribution (`updated_by` / `changed_by`) comes from the verified `x-user-id`,
falling back to `x-internal-caller` for automated writers. A free-text `author` is either rejected or stored in a
separate, non-authoritative field.

## Reproduction Steps

1. As any admin MCP session, call `set_config` with `author="someone-else@example.com"`, any reason, and a global key.
2. Query `config.config_audit` for that key.
3. `changed_by` is `someone-else@example.com`, not the session's user id.

## Root Cause Hypothesis

`author` predates header propagation and stayed the primary attribution source. The authz gate moved to the
verified headers (feature 074, PR #994), but attribution never followed. `MISSING_AUTHOR_ERROR`
(`configServiceImpl.ts:405-407`) is still keyed on the free-text field.

## Affected Services

- xstockstrat-config (attribution source in `SetConfig`)
- xstockstrat-agent (`set_config` tool `author` parameter, `tools.py:1648,1663,1694`; also `tools.py:353` passes `author=tool`)
- Consumer impact only, likely no code change: xstockstrat-trading reconciliation poller writes
  `Author: "system:reconciliation-poller"` under `x-internal-caller: trading-reconciliation-poller`
  (`services/xstockstrat-trading/internal/service/trading.go:2086-2094`); xstockstrat-ui BFFs already compliant.

## Fix Scope

- [ ] Proto change possible: deprecate or repurpose `SetConfigRequest.author` (`packages/proto/config/v1/config.proto:126`, field 4) — design fork; deprecate-don't-delete (C-09)
- [ ] DB migration possible: only if the free-text author is kept in a separate non-authoritative column — design fork
- [x] No config key changes anticipated
- [ ] Docs: `docs/patterns/config-governance.md` § Author-sentinel conventions (`system:<process>` sentinels are free-text `author` values today); `services/xstockstrat-config/CLAUDE.md` invariant #5 (`author` / `x-user-id` rule); `docs/runbooks/mcp-tools.md` if the tool parameter changes

## Consumer Surface(s)

- agent MCP `set_config` (and `manage_signal_source`, which writes via `tools.py:353`): `author` stops being authoritative; tool contract change if the parameter is removed or made optional
- `/config-ui` audit view (`services/xstockstrat-ui/src/app/config-ui/api/audit/route.ts`): shows the verified identity

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev.

## Out of Scope

- Rewriting historical `config.config_audit.changed_by` rows already attributed from free text
- Changes to the SetConfig authz gate itself (scope rules unchanged)
- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix

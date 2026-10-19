# Defect: SetConfig audit author is caller-supplied free text, not the verified identity

**Recorded**: 2026-10-19
**Severity**: SEV-2
**Impact type**: audit-attribution-spoofing
**Environment**: dev (main-dev) @ 1302e6d
**Affected service(s)**: xstockstrat-config, xstockstrat-agent
**Config-only fix possible**: no
**Source**: cross-module review of `services/xstockstrat-config/docs/context-constitution.md` CONFIG-6 / Gotchas (`caller_identity` vs free-text `author`) and the agent `set_config` tool

## Observed
`SetConfig` authorizes on the propagated `x-user-id` / `x-access-scope`, but records
`call.request.author` (any string) as `updated_by`. The authenticated `x-user-id` is used only when
`author` is empty. The audit triggers copy `updated_by` into `config.config_audit.changed_by`, so the
audit trail names whoever the caller typed. The MCP agent's `set_config` tool exposes `author` as a
free-text model/user parameter and passes it straight through. An admin, or a user writing their own
per-user row, can therefore attribute a change (including a `platform.trading_state` or secret write)
to another person. The UI BFFs are unaffected because they stamp `author: claims.user_id`.

## Expected
`author` / `updated_by` comes from the verified `x-user-id`, falling back to `x-internal-caller` for
automated writers. Any free-text author is either rejected or stored in a separate non-authoritative field.

## Reproduction
1. As any admin MCP session, call `set_config` with `author="someone-else@example.com"`, plus any reason and global key.
2. Query `config.config_audit` for that key.
3. `changed_by` is `someone-else@example.com`, not the session's user id.

## Evidence
`services/xstockstrat-config/src/grpc/configServiceImpl.ts:388`
> `    } else if (!callerUserId || callerUserId !== userId) {`

`services/xstockstrat-config/src/grpc/configServiceImpl.ts:404`
> `    const author = call.request.author || userIdFrom(call.metadata);`

`services/xstockstrat-config/src/grpc/configServiceImpl.ts:507`
> `        [namespace, key, inferValueType(value), valueData, valueEncrypted, isSecret, author, reason, env, userIdParam, callerIdentity]`

`services/xstockstrat-agent/app/tools.py:1694`
> `                author=author,`

`services/xstockstrat-ui/src/lib/configUiBff.ts:53` (the BFF does the right thing)
> `      { ...req, environment, author: claims.user_id },`

## Root cause hypothesis
`author` predates header propagation and was kept as the primary attribution source. The authz gate
moved to the verified headers (feature 074, PR #994), but attribution never followed.

## Confidence
high

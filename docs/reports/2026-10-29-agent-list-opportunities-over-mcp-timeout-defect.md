# Defect: Agent `list_opportunities` worst case (68 s) exceeds the MCP client's 60 s timeout

**Recorded**: 2026-10-29
**Severity**: SEV-2
**Impact type**: mcp-budget-exceeded
**Environment**: dev (feature/fix-agent-client-deadlines)
**Affected service(s)**: xstockstrat-agent, xstockstrat-config
**Config-only fix possible**: no
**Source**: feature 273 (`docs/roadmap/features/273-fix-agent-client-deadlines/design.md` § Open Risks, R4). Feature
273 bounded every other agent → backend call under the MCP budget and left `list_opportunities` as an accepted
out-of-scope exception.

## Observed

A `list_opportunities` call can spend up to 68 s before it returns: the inbound `ValidateToken` auth call (10 s,
`client._RPC_TIMEOUT_S`), the `opportunities.read_timeout_seconds` policy read (3 s, `_POLICY_READ_TIMEOUT_S`), and
the analysis `ListOpportunities` deadline, which an operator may set as high as the SetConfig ceiling of 55 s.
10 + 3 + 55 = 68 s, above the MCP client's 60 s request timeout, so the client gives up before the tool can return
its "upstream did not respond within Ns" message.

## Expected

The worst case of auth + policy read + `ListOpportunities` deadline stays under 60 s, so the tool always answers
before the MCP client times out. Suggested fix: lower the `agent.opportunities.read_timeout_seconds` SetConfig
ceiling (for example to 45, so 10 + 3 + 45 = 58 s), keeping the floor above analysis's own worst case.

## Reproduction

1. `set_config agent opportunities.read_timeout_seconds 55` (accepted: the bound is `[30,55]`).
2. Make analysis `ListOpportunities` stall (accept the connection, never answer) and identity answer
   `ValidateToken` slowly, close to its 10 s deadline.
3. Call `list_opportunities` over MCP. Observed: the MCP client times out at 60 s. Expected: the tool returns its
   deadline-exceeded message first.

## Evidence

`services/xstockstrat-config/src/grpc/configServiceImpl.ts:133`
> 'agent.opportunities.read_timeout_seconds': { minValue: 30, maxValue: 55 },

`services/xstockstrat-agent/app/tools.py:1642-1645`
> timeout_s = await asyncio.wait_for(
>     _agent_policy("opportunities.read_timeout_seconds", 40.0, float),
>     _POLICY_READ_TIMEOUT_S,
> )

`services/xstockstrat-agent/app/auth.py:46`
> timeout=client._RPC_TIMEOUT_S,

`services/xstockstrat-agent/CLAUDE.md:208` (the ceiling was sized as "+ 3s under the MCP client's 60s", without the
auth call)
> SetConfig-bounded `[30,55]` (floor above analysis's own worst case, ceiling + 3s under the MCP client's 60s).

## Root cause hypothesis

Feature 227 sized the 55 s ceiling against the policy read alone; feature 273 bounded the auth call at 10 s, which
the ceiling does not account for.

## Confidence

high (static arithmetic over the cited constants and bound)

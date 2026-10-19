# Defect: Agent silently starts stdio transport when MCP_TRANSPORT is unset or mistyped

**Recorded**: 2026-10-19
**Severity**: SEV-3
**Impact type**: silent-misstart
**Environment**: dev (main-dev) @ 1302e6d
**Affected service(s)**: xstockstrat-agent
**Config-only fix possible**: yes
**Source**: `services/xstockstrat-agent/docs/context-constitution-findings.md` § Latent bugs, `MCP_TRANSPORT` row

## Observed
`resolve_transport()` defaults to `stdio`, and any unrecognized value (e.g. `htp`) also falls through
to stdio — it only logs a warning. The whole deployed service (port 9000, OAuth, Streamable HTTP)
assumes `http`. Nothing listens on 9000 in that case, and the only liveness probe is a TCP check in
docker-compose; `.do/app*.yaml` define no `health_check` for the agent, so the mis-start is silent.
The fall-through is a deliberate AC (feature 079 AC-4); the gap is the lack of any loud failure.

## Expected
A deployed agent either fails fast on an unrecognized value or is guaranteed to run `http`
(deploy specs already set `MCP_TRANSPORT=http`; a health check would catch drift).

## Reproduction
1. Start the agent container with `MCP_TRANSPORT=htp`.
2. Observe the warning "is not recognized; falling back to stdio" and no listener on :9000.
3. Note no DO health check exists to mark the component unhealthy.

## Evidence
`services/xstockstrat-agent/app/main.py:52`
> `    raw = os.environ.get("MCP_TRANSPORT", "stdio")`

`services/xstockstrat-agent/app/main.py:62`
> `        log.warning("MCP_TRANSPORT=%r is not recognized; falling back to stdio", raw)`

`services/xstockstrat-agent/app/main.py:254`
> `    asyncio.run(_run_http() if resolve_transport() == "http" else _run_stdio())`

`docker-compose.yml:581`
> `      test: ["CMD", "bash", "-c", "echo > /dev/tcp/localhost/9000"]`

## Root cause hypothesis
Default chosen for local stdio use; any value other than `http` routes to `_run_stdio()`, and no
HTTP health check exists in the DO app specs to surface the wrong transport. Config-only mitigation:
keep `MCP_TRANSPORT=http` set in every deploy spec (already true) and add a `health_check` block.

## Confidence
high

# Defect: MCP Tools page shows no tools on homelab deployments

**Recorded**: 2026-11-19
**Severity**: SEV-3
**Impact type**: empty-page
**Environment**: homelab staging @ 5142fc5
**Affected service(s)**: xstockstrat-ui
**Config-only fix possible**: no
**Source**: operator report, 2026-11-19 (pasted into the triage session)

## Observed

On the homelab staging deployment `/accounts/mcp-tools` lists no tools.
`GET /accounts/api/mcp-tools` answers `{ "tools": [], "reachable": false }` with HTTP 200.

## Expected

A logged-in user sees the agent's tool catalog. The browser calls the authenticated UI BFF route,
and the BFF fetches the catalog from the agent over the deployment's internal network (compose
network on homelab and local, the App Platform internal network on DigitalOcean) — never through
the public hostname.

`GET https://<public host>/agent/api/tools` from the internet keeps returning 404, and the OAuth
discovery URLs and the connector URL shown to users do not change.

## Reproduction

1. Log in to the homelab staging UI.
2. Open `/accounts/mcp-tools`.
3. Observe an empty list; the BFF response is `{ "tools": [], "reachable": false }`.

## Evidence

`services/xstockstrat-ui/src/app/accounts/api/mcp-tools/route.ts:17`
> const base = process.env.AGENT_PUBLIC_URL;

`services/xstockstrat-ui/src/app/accounts/api/mcp-tools/route.ts:21`
> const res = await fetch(`${base}/api/tools`, { cache: 'no-store' });

`deploy/homelab/compose.yml:284` (UI block)
> AGENT_PUBLIC_URL: ${APP_URL}/agent

Reported by the operator, not re-measured in this session: the homelab edge proxy answers 404 for
`/agent/api/tools` to internet clients, and inside the UI container the public hostname resolves
to the edge's public IP (measured 2026-11-19 on the staging VM).

## Root cause hypothesis

The BFF fetches the catalog through `AGENT_PUBLIC_URL`. On homelab that is the public hostname, so
the UI's own request reaches the edge as an internet client and gets the 404 the edge serves for the
unauthenticated `/agent/api/tools`; the route swallows it as `reachable: false`.
`/accounts/api/agent-health` is unaffected because it fetches the public OAuth discovery document.

## Confidence

high

# Product Spec: fix-mcp-tools-page

**Type**: bug
**GitHub Issue**: none (Issues disabled) — report `docs/reports/2026-11-19-mcp-tools-page-empty-on-homelab-defect.md`
**Severity**: SEV-3
**Created**: 2026-11-19

---

## Problem Statement

On homelab staging `/accounts/mcp-tools` lists no tools; `GET /accounts/api/mcp-tools` answers
`{ "tools": [], "reachable": false }` with HTTP 200.

Expected: the browser calls the authenticated UI BFF route, and the BFF fetches the catalog from the
agent over the deployment's internal network (compose network on homelab and local, the App Platform
internal network on DigitalOcean) — never through the public hostname. Logged-in users see the
agent's tools.

## Reproduction Steps

1. Log in to the homelab staging UI.
2. Open `/accounts/mcp-tools`.
3. Observe an empty list; the BFF response is `{ "tools": [], "reachable": false }`.

## Root Cause Hypothesis

`services/xstockstrat-ui/src/app/accounts/api/mcp-tools/route.ts` fetches
`${AGENT_PUBLIC_URL}/api/tools`. `deploy/homelab/compose.yml` sets the UI's `AGENT_PUBLIC_URL` to
`${APP_URL}/agent`, so the UI's own request reaches the edge proxy as an internet client and gets the
404 the edge serves for the unauthenticated `/agent/api/tools`. The route swallows the failure.

## Affected Services

- xstockstrat-agent — new internal-only gRPC catalog endpoint (port 50061, mTLS, UI certificate only);
  public `GET /api/tools` removed
- xstockstrat-ui — BFF route calls the new RPC
- `packages/proto` — new package `agent/v1`
- Deployment specs: `deploy/homelab/compose.yml`, `docker-compose.yml`, `.do/app.yaml`, `.do/app.dev.yaml`

## Consumer Surface(s)

- UI: `/accounts/mcp-tools` page (xstockstrat-ui, `/accounts` segment)
- Agent MCP tools: none change (the catalog lists them; no tool behavior changes)

## Fix Scope

- [ ] Proto change: **yes** — new package `agent/v1` (additive)
- [x] No database migrations anticipated
- [x] No config key changes anticipated (no `WatchConfig` key; one new UI runtime env var)

Operator decisions (2026-11-19, binding on design/spec; run 2 supersedes run 1 where they differ):

1. The UI's BFF is always the only entry point for the UI's client side.
2. The catalog leaves the agent's public HTTP surface: the unauthenticated `GET /api/tools` on port
   9000 is **removed**.
3. The agent serves the catalog on a new internal-only port **50061**, **gRPC over the platform
   mTLS**, accepting only the `xstockstrat-ui` certificate.
4. UI runtime env var **`AGENT_ENDPOINT`** — gRPC `host:port` like every other `<SERVICE>_ENDPOINT`;
   set in every deployment spec; no fallback to `AGENT_PUBLIC_URL`.
5. `AGENT_PUBLIC_URL` keeps its other uses unchanged (connector URL, OAuth metadata, oauth-login
   callback check, agent-health probe).
6. Superseded (run 1): "no agent code change", plain-HTTP `AGENT_ENDPOINT` to port 9000.

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev.

Deployment acceptance (from the report, verified on homelab staging after deploy):

- `/accounts/mcp-tools` lists the agent's tools.
- `GET https://<public host>/agent/api/tools` no longer returns the catalog on any deployment
  (homelab edge 404 as before; DigitalOcean no longer serves it).
- Port 50061 is not reachable from outside the deployment's internal network.
- No change to the OAuth discovery URLs or the connector URL shown to users.

## Out of Scope

- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
- Any change to the MCP transport, OAuth flow or tool behavior on the agent's public port 9000 beyond
  removing `GET /api/tools`.

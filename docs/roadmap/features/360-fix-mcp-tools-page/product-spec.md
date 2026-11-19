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

- xstockstrat-ui (BFF route)
- Deployment specs that give the UI its environment: `deploy/homelab/compose.yml`,
  `docker-compose.yml`, `.do/app.yaml`, `.do/app.dev.yaml`
- xstockstrat-agent: no code change (it already serves `GET /api/tools`)

## Fix Scope

- [x] No proto changes anticipated
- [x] No database migrations anticipated
- [x] No config key changes anticipated (no `WatchConfig` key; one new UI runtime env var)

Operator decisions (2026-11-19, binding on design/spec):

1. New UI runtime env var **`AGENT_ENDPOINT`** — `host:port`, no scheme (`xstockstrat-agent:9000`),
   following the root CLAUDE.md `<SERVICE>_ENDPOINT` rule; the route builds the `http://` URL. The
   report's suggested `AGENT_INTERNAL_URL` is rejected (no `_URL` suffix on connection vars).
2. **Set everywhere, no fallback** — the var is added to homelab compose, local docker-compose and
   both DO specs; when unset the route answers `reachable: false`. It never falls back to
   `AGENT_PUBLIC_URL`.
3. Call chain: browser → authenticated UI BFF → agent over the internal network (DO or homelab).
4. `AGENT_PUBLIC_URL` keeps its remaining uses unchanged: connector URL on `/accounts`, OAuth
   metadata, the `/auth/oauth-login` callback check, the `agent-health` discovery probe.

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev.

Deployment acceptance (from the report, verified on homelab staging after deploy):

- `/accounts/mcp-tools` lists the agent's tools.
- `GET https://<public host>/agent/api/tools` from the internet still returns 404.
- No change to the OAuth discovery URLs or the connector URL shown to users.

## Out of Scope

- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
- Whether the agent should require a credential on `GET /api/tools` or stop serving it on the
  externally published port — stays the open item in
  `services/xstockstrat-agent/docs/context-constitution-findings.md` (found 2026-11-04), to be decided
  once the UI no longer needs the public path.

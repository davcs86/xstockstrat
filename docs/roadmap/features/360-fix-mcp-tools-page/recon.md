# Recon: fix-mcp-tools-page

**Created**: 2026-11-19
**From**: product-spec.md
**Tree**: ccr-a72ccc3e-9kr7yq@37f8463 (= origin/main-dev@5142fc5 + 2 docs-only commits)
**Affected services**: xstockstrat-ui (code); xstockstrat-agent (callee, no change); deployment specs

---

## Objective

`/accounts/mcp-tools` is empty on homelab because the UI BFF fetches the agent's tool catalog through
`AGENT_PUBLIC_URL`, which the homelab edge answers with 404. The BFF must fetch it from the agent over
the deployment's internal network via a new UI runtime env var `AGENT_ENDPOINT` (`host:port`), set in
every deployment spec, with no fallback to the public URL. The browser only ever calls the UI BFF.

## Codebase Map

- **`xstockstrat-ui`** (Next.js)
  - Route to change: `src/app/accounts/api/mcp-tools/route.ts:17` (`process.env.AGENT_PUBLIC_URL`),
    `:21` (`fetch(\`${base}/api/tools\`, { cache: 'no-store' })`), `:14-15` (401 without session),
    `:30` (`withBffMetrics('accounts', '/accounts/api/mcp-tools', getHandler)`)
  - Client page: `src/app/accounts/mcp-tools/page.tsx:69` (`apiFetch('/accounts/api/mcp-tools')`),
    `:105-110` (`reachable === false` → "The agent is unreachable — tool list unavailable.")
  - Other `AGENT_PUBLIC_URL` reads (must not change): `src/app/accounts/api/agent-health/route.ts:11`,
    `src/app/accounts/layout.tsx:19`, `src/app/api/oauth/authorization-server/route.ts:9`,
    `src/app/api/oauth/protected-resource/route.ts:9`, `src/app/auth/oauth-login/page.tsx:15`
  - BFF-only check: every client `fetch` in `src/` targets a relative BFF path
    (`authorized-apps/page.tsx:80,97,113`, `profile/page.tsx:36,71`, `mcp-tools/page.tsx:69`);
    `agentUrl` is used for display/clipboard only (`authorized-apps/page.tsx:162,213`,
    `mcp-tools/page.tsx:98`). No browser code calls the agent.
  - `withBffMetrics` — `src/lib/bffMetrics.ts:76`; `getSessionFromRequest` — `src/lib/auth.ts:38`
  - Vitest: `vitest.config.ts:20` (`include: ['src/**/*.test.ts']`), `:25` (coverage `src/lib/**`)
  - Env doc: `services/xstockstrat-ui/CLAUDE.md:216-217`
- **`xstockstrat-agent`** (Python, no change)
  - Route: `app/main.py:263` (`Route("/api/tools", endpoint=list_tools_metadata, methods=["GET"])`),
    handler `:124`, response `{"tools":[{name,description,inputSchema}]}` `:132-142`, unauthenticated `:127`
  - No path prefix in the app (`main.py:74` "stripped to / by ingress"); no Host validation on this
    route (`:146-150` disables DNS-rebinding only for the MCP mount; no TrustedHost/CORS middleware)
  - Bind: `main.py:276` (`host="0.0.0.0"`, plain HTTP), port `:67-70` (`MCP_HTTP_PORT`, default 9000)
  - Tests: `tests/test_tools_endpoint.py:24-27`
  - Docs: `docs/oauth.md:27`; open item `docs/context-constitution-findings.md:48`
- **Deployment specs**
  - Homelab `deploy/homelab/compose.yml`: UI block `:266-298`, `*_ENDPOINT` `:273-282`,
    `AGENT_PUBLIC_URL: ${APP_URL}/agent` `:284`, UI `depends_on` analysis only `:296-298`; agent block
    `:300-330`, `MCP_HTTP_PORT: "9000"` `:319`, ports `:323-324`; default compose network
  - Local `docker-compose.yml`: UI `*_ENDPOINT` `:503-512` (comment `:502` "gRPC endpoints"),
    `AGENT_PUBLIC_URL: http://xstockstrat-agent:9000` `:517-520`; agent block `:547-593`
  - DO `.do/app.yaml`: ingress `:12-23` (`/agent` → agent, `/` → UI), agent `:336` `http_port: 9000`
    `:342`, UI block `:607-667`, `*_ENDPOINT` `:630-649` in the form
    `${xstockstrat-identity.PRIVATE_DOMAIN}:50058` (`:638-639`), `AGENT_PUBLIC_URL` `:652-653`
  - DO `.do/app.dev.yaml`: agent `:338` `http_port: 9000` `:344`, UI `http_port` `:610`,
    UI `AGENT_PUBLIC_URL` `:649-650`
  - Naming rule: root `CLAUDE.md:178` (`<SERVICE>_ENDPOINT` | `host:port` | gRPC connections)

## Patterns to REUSE

- Route-handler unit test → `src/app/config-ui/api/audit/route.test.ts` (`vi.mock('@/lib/auth')` `:5`,
  `new NextRequest(...)` `:25`, `await import('./route')` `:31`, `vi.resetModules()`/`vi.stubEnv` `:40-44`)
- `*_ENDPOINT` as `host:port` with the caller adding the scheme → `src/lib/connectClients.ts:17-26,55`
- Unset env ⇒ degrade to an empty 200 → current `mcp-tools/route.ts:18`
- Playwright env block for a dead agent port → `playwright.config.ts:147-168`
- MCP tool fixture → `SAMPLE_TOOLS` in `e2e/accounts/mcp-tools.spec.ts:12-30`
  (`e2e/fixtures/INVENTORY.md:108`); a second consumer forces centralization (C-12/C-13)
- DO internal address form → `${<component>.PRIVATE_DOMAIN}:<port>` (`.do/app.yaml:638-639`)

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-3 @feature-271` "Segment health routes are reachable without a session" (`services/xstockstrat-ui/acceptance/fix-ui-transport-hardening.feature`) — `/accounts/api/agent-health` stays 401 without a session and stays on `AGENT_PUBLIC_URL`.
- **PRESERVE** `@AC-4 @feature-271` "Non-health segment routes still require a session" (same file) — session gate unchanged.
- **PRESERVE** `@AC-25 @feature-224` "Agent tools expose templates and drop public arguments" (`services/xstockstrat-agent/acceptance/private-by-default-templates.feature`) — catalog shape unchanged.
- **PRESERVE** `@AC-1 @feature-214` "The xstockstrat-agent MCP advertises no db_ tool" (`services/xstockstrat-agent/acceptance/remove-agent-postgres-mcp.feature`) — the UI does not alter the catalog.
- **PRESERVE** `@AC-6 @feature-283` "The tool count is unchanged and its surfaces agree" (`docs/sdd/business-rules/platform.feature`).
- **PRESERVE** `@AC-3 @feature-279` "Only the UI and the agent publish ports, and every long-running service is health-checked" (`docs/sdd/business-rules/platform.feature`) — no new published port (also asserted by `deploy/homelab/render-assert.jq:54`).
- No existing rule covers the mcp-tools page/route or the `AGENT_PUBLIC_URL` uses; this feature's `@AC-1..3` extend the UI suite on promotion. No CHANGE rules.

## Dependencies

- Proto/RPC: none
- Migration: none
- Config keys: none
- Inter-service edges: xstockstrat-ui → xstockstrat-agent, plain HTTP `GET /api/tools` over the internal
  network (edge exists today via the public URL; not in the root CLAUDE.md dependency tree)
- New env vars / ports: `AGENT_ENDPOINT` — absent from `docker-compose.yml`, `deploy/homelab/compose.yml`,
  `.do/app.dev.yaml`, `.do/app.yaml`, `playwright.config.ts`. No new port.

## Risks / Not-found

- **DO internal address unproven in this repo**: nothing references `${xstockstrat-agent.PRIVATE_DOMAIN}`
  today, and no doc here states that an `http_port` component answers on `PRIVATE_DOMAIN:<http_port>`.
  First exercised on deploy.
- **Homelab edge config is not in this repo** (external `homelab-edge`); the 404 rule and the
  public-IP resolution are the operator's measurement, not re-measured here.
- **Naming-table conflict**: root `CLAUDE.md:178` and `docker-compose.yml:502` describe `_ENDPOINT` as
  gRPC; `AGENT_ENDPOINT` is the first plain-HTTP `host:port` var.
- **No mock HTTP agent in e2e** (`e2e/mock-backend.ts` has no `/api/tools`); the e2e spec stubs the BFF,
  so the real handler is untested today. No mocked-`fetch` precedent in `src/**/*.test.ts`.
- **No timeout on the server `fetch`** (`mcp-tools/route.ts:21`, `agent-health/route.ts:15`) — pre-existing.
- **Startup order**: the UI does not `depends_on` the agent in either compose file; an early request
  gets `reachable: false` until the agent is up (same as today).
- **Local compose**: the UI's `AGENT_PUBLIC_URL` is the internal address (`docker-compose.yml:520`), so
  the connector URL shown locally is not browser-reachable — pre-existing.
- No env-key parity check exists across the four specs; a missed spec fails silently as `reachable: false`.
- Ledger: `fails.md:1553` — wire a new env var into every run site in the same step;
  `insights.md:835` — a runtime-only env var must be read at request time, never baked at build.

## Recommended Scope

1. `test` — `src/app/accounts/api/mcp-tools/route.test.ts` covering `@AC-1..3` (red first).
2. `service` — `route.ts` reads `AGENT_ENDPOINT`, fetches `http://${AGENT_ENDPOINT}/api/tools`.
3. `infra` — `AGENT_ENDPOINT` in the four deployment specs and `playwright.config.ts`.
4. `docs` — root `CLAUDE.md` naming table + dependency tree, `services/xstockstrat-ui/CLAUDE.md` env list,
   `docs/runbooks/mcp-tools.md`.

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

---

# Recon addendum — run 2 (2026-11-19)

**Tree**: ccr-a72ccc3e-9kr7yq@826e421 (= origin/main-dev@5142fc5 + docs-only commits)
**Steer (D-19)**: the catalog moves to an internal-only gRPC port 50061 on the agent (platform mTLS,
`xstockstrat-ui` certificate only); the public `GET /api/tools` is removed; the UI BFF calls the new
RPC. Affected services are now xstockstrat-agent, xstockstrat-ui, `packages/proto`, deployment specs.
Where this addendum and the sections above disagree, the addendum wins.

## Codebase Map (delta)

- **`xstockstrat-agent`** (Python) — no gRPC server today
  - Catalog source: `app/main.py:124-142` (`await server.list_tools()` → `name`, `description or ""`,
    `input_schema`); route to delete `:263`; docstring `:127-130`
  - Lifecycle: one process (`supervisord.conf` `[program:app-main]`), one asyncio loop (`main.py:286`);
    HTTP lifespan `:237-248` (starts config watchers); `_run_http` `:270-278`; stdio path `:86-96`
    never builds the HTTP app; `MCP_TRANSPORT` defaults to stdio (`:51`)
  - `app/mtls.py`: client only — `_load()` `:20` (lazy, fail-closed), `channel_credentials()` `:31`,
    `secure_channel()` `:62`; no `server_credentials`
  - `app/telemetry.py:6-8,111,151`: client instrumentation only; no server interceptors
  - Stubs: `Dockerfile:8-12` copies `packages/proto/gen/python` → `/app/gen`; imports are lazy in
    `app/client.py` (`:154,195`), module-top in `app/auth.py:13`
  - Deps (`pyproject.toml`): `grpcio>=1.80.0`, `protobuf>=5.26.0`; no `grpcio-reflection`
  - `Dockerfile:19` `EXPOSE 9000`
  - Tests on `/api/tools`: `tests/test_tools_endpoint.py` (`_TOOL_COUNT = 45` `:15`; GETs `:26,82,168,184`;
    `test_list_tools_does_not_require_auth` `:181`), `test_account_tools.py:49`, `test_user_tools.py:53`,
    `test_watchlist_tools.py:55`; comment only at `test_config_tools.py:488`. Coverage ≥40
    (`.github/workflows/ci.yml:476-478`)
  - Docs: `docs/oauth.md:27`, `docs/context-constitution.md:5` ("the only backend that speaks HTTP"),
    `docs/context-constitution-findings.md:48`, `CLAUDE.md` (role/env sections)
- **`packages/proto`** — no `agent/` package
  - Layout `<svc>/v1/<svc>.proto`; header form `config/v1/config.proto:1-5`
    (`package xstockstrat.config.v1`, `go_package ".../gen/go/config/v1;configv1"`); smallest file
    `ledger/v1/ledger.proto`; JSON as `google.protobuf.Struct` (`notify.proto:55`, `config.proto:66`,
    `ledger.proto:31`, `ingest.proto:180`)
  - `buf.yaml:7-12` lint STANDARD with three exceptions; `buf.gen.yaml` Go + TS; Python via
    `scripts/buf-gen.sh:58-71` (auto-discovers every `.proto`, no per-package registration); TS
    exports are a wildcard (`packages/proto/gen/ts/package.json:5-7`)
  - CI: `ci.yml:233-253` lint/breaking, `:255-313` `proto-freshness` (regenerated `gen/` must be
    committed). Reviewers: `docs/runbooks/reviewer-registry.md:35,46-47`
- **`xstockstrat-ui`** (delta)
  - `src/lib/connectClients.ts`: endpoint constants with defaults `:17-26`; `loadMtls` `:31-39`;
    `makeTransport(endpoint, targetService)` `:49-60` (`https://`, server name pinned to the service
    name); default unary timeout `:72`; client exports `:85-124`; `connectCodeToHttp` `:127`
  - Call-shape template: `src/app/accounts/api/authorized-apps/route.ts:4-6,15-19,30-35,62`;
    headers via `src/lib/restBackendHeaders.ts:9-15`
  - A plain `accounts/api/**/route.ts` needs no allowlist registration
  - Mocks: vitest `vi.mock('@/lib/connectClients', …)` (`src/lib/identity.test.ts:10-12`); Playwright
    `e2e/mock-backend.ts:124-126,250-255,383,817` (mTLS http2 mock servers per port),
    `playwright.config.ts:147-160,178-180`
- **Deployment (delta)**
  - DO: backends declare `internal_ports` (`.do/app.yaml:53-54`; header `:11`); the agent block
    `:336-389` has `http_port: 9000` only (`:342`), MTLS envs `:349-358`; ingress routes by component
    and path (`:12-23`)
  - Homelab: backends publish nothing and use no `expose:`; agent healthcheck is a TCP probe on 9000
    (`deploy/homelab/compose.yml:325-327`); `render-assert.jq:54` pins published ports to agent=9000,
    ui=3000; `:43` requires PEM `MTLS_*` on every app
  - Local: Python backend precedent `docker-compose.yml:334-369` (ingest publishes its gRPC port to
    the host — the agent must not); agent block `:547-593`
  - mTLS leaves: `scripts/gen-dev-certs.sh:28-31,49-54` — every service incl. the agent gets
    SAN = service name and `serverAuth, clientAuth`; DO and homelab mint from the same list
    (`docs/patterns/inter-service-mtls.md:13,104-114`)

## Patterns to REUSE (delta)

- Python mTLS gRPC server → `services/xstockstrat-ingest/app/main.py:104-115` (server, secure port),
  `app/mtls.py:28-33` (`server_credentials`, `require_client_auth=True`), shutdown `main.py:142-152`,
  interceptors `app/telemetry.py:219`
- Peer-certificate authorization → `services/xstockstrat-ingest/app/peer_identity.py`
  (`peer_san_matches`, fail-closed) used at `app/handlers/servicer.py:126,493-497`
  (`PERMISSION_DENIED`); documented list `docs/patterns/inter-service-mtls.md:52-74`
- Real-handshake mTLS tests → `services/xstockstrat-ingest/tests/test_mtls.py:117-167`,
  `tests/test_peer_identity_spike.py:50-83`
- UI BFF → backend gRPC call → `authorized-apps/route.ts` (above)

## Existing Business Rules (delta)

- **CHANGE** `@AC-25 @FR-12 @feature-224` "Agent tools expose templates and drop public arguments" (`services/xstockstrat-agent/acceptance/private-by-default-templates.feature:7-12`) — its Given reads "the agent MCP tool catalog at GET /api/tools"; re-pointed to the new catalog RPC. **Signed off by the operator 2026-11-19 (context.md).**
- **CHANGE (wording)** `@AC-6 @FR-4 @feature-283` "The tool count is unchanged and its surfaces agree" (`docs/sdd/business-rules/platform.feature:795-798`) — lists "the /api/tools catalog" among the count surfaces; the count (45) is preserved, the surface name changes. **Needs operator sign-off at the gate.**
- **PRESERVE** `@AC-3 @FR-2 @feature-279` "Only the UI and the agent publish ports…" (`platform.feature:1086-1091`) — 50061 is not published.
- **PRESERVE** platform mTLS scenarios (`platform.feature:222,235`) — the new server enforces mTLS like every other gRPC server.
- The run-1 PRESERVE rules for `@feature-271` and `@AC-1 @feature-214` still hold.

## Dependencies (delta)

- Proto/RPC: new package `xstockstrat.agent.v1` (new service, new messages) — not a breaking change
- New env vars / ports: `AGENT_ENDPOINT` on the UI (gRPC `host:port`); agent gRPC port 50061
  (free; 50051–50060 taken) — absent from all four specs and `playwright.config.ts`
- Inter-service edge: xstockstrat-ui → xstockstrat-agent (gRPC, mTLS, UI certificate only)
- Python deps: none required if reflection is not added

## Risks / Not-found (delta)

- **No DO component has both `http_port` and `internal_ports`**; the agent would be the first. Unverified
  against DO's app-spec schema — if DO rejects it, the dev deploy fails loudly.
- **`AGENT_ENDPOINT` unset semantics**: the ten existing endpoint constants default to the compose
  service name (`connectClients.ts:17-26`), while D-1 says unset ⇒ `reachable: false`. To settle.
- **stdio mode**: the gRPC server has no HTTP lifespan to hang on; decide whether it runs only when
  `MCP_TRANSPORT=http`.
- **OTel**: the agent has no server-side telemetry; `scripts/check-otel-produced-signals.py` Part 4
  checks `rpc_server_duration_*` selectors — its effect on a new Python gRPC server was not traced.
- **Codegen toolchain**: `scripts/buf-gen.sh` needs buf, three Go plugins, TS plugins and
  `grpcio-tools` on the execute host (Docker `Dockerfile.codegen` or
  `docs/runbooks/codegen-toolchain-host-setup.md`); `proto-freshness` fails on uncommitted `gen/`.
- **Playwright**: the UI pins the server name to `xstockstrat-agent`; whether the e2e `devCerts()` mock
  certificate carries that name was not inspected.
- Agent healthcheck covers 9000 only; a dead gRPC listener would not mark the container unhealthy.
- `services/xstockstrat-agent/tests/conftest.py` and AGENT-3..7 were not read.
- Run-1 items made moot: the plain-HTTP naming exception, the mTLS scoped exception, R-4 (fetch
  timeout — the gRPC client has a default deadline, `connectClients.ts:72`).

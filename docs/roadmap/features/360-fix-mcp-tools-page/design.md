# Design: fix-mcp-tools-page

**Created**: 2026-11-19
**Rounds**: 6 (run 1: rounds 1–4, quick, approved then reopened by the operator; run 2: rounds 5–6, full; termination: approved)
**Approved by**: user @ 2026-11-19T19:13Z
**Grounded in**: recon.md (run-2 addendum wins over earlier sections)
**Debate register**: debate.md

---

## Chosen Approach

**Call chain (D-19).** The browser calls only the authenticated UI BFF route
`GET /accounts/api/mcp-tools`. The BFF calls the agent's new internal gRPC endpoint over the platform
mTLS. The agent stops serving the catalog on its public HTTP port. Consumer surface: the
`/accounts/mcp-tools` page in `xstockstrat-ui`; no MCP tool changes behavior.

**Contract (D-20).** New `packages/proto/agent/v1/agent.proto` — `package xstockstrat.agent.v1`,
`service AgentService { rpc ListTools(ListToolsRequest) returns (ListToolsResponse); }`,
`McpTool { name, description, google.protobuf.Struct input_schema }` (Struct per
`notify.proto:55`, `ledger.proto:31`). Additive; stubs regenerated with `scripts/buf-gen.sh`.

**Agent server (D-21, D-22).** New `app/catalog_service.py`: a servicer over the existing
`mcp_server.list_tools()` source (`app/main.py:124-142`) that first checks the verified peer
certificate name equals `xstockstrat-ui` (`peer_identity.py`, copied from ingest) and otherwise
aborts with `PERMISSION_DENIED`. `app/mtls.py` gains `server_credentials()` with
`require_client_auth=True` (ingest `app/mtls.py:28-33`). `_run_http` (`main.py:270-278`) builds one
`MCPServer`, shares it with the HTTP app and the servicer, and starts gRPC on `[::]:${GRPC_PORT}`
(default `50061`) **before** uvicorn — missing `MTLS_*` stops the process before port 9000 listens,
and the existing TCP healthcheck on 9000 implies 50061 is bound. No gRPC server in stdio mode; no
reflection; shutdown is best-effort. `list_tools_metadata` and its `/api/tools` route
(`main.py:124-143,263`) are deleted; an unauthenticated request there then gets 401 from
`handle_mcp` (`:164-190`).

**Agent telemetry (D-30, D-37).** gRPC server instrumentation and the span-derived
`rpc.server.duration` processor, following ingest (`app/telemetry.py:17-152,234`); bucket list
defined once in `app/telemetry.py` and imported by `app/tool_metrics.py`.

**UI (D-23).** `src/lib/connectClients.ts` gains `AGENT_ENDPOINT` (no default host) and
`agentClient` — a client over `makeTransport(AGENT_ENDPOINT, 'xstockstrat-agent')` (`:46-60`), or
`null` when unset. The route: session → 401; no client → `{ tools: [], reachable: false }`;
`agentClient.listTools({}, { headers })` mapped to `{ name, description, inputSchema }` with
`reachable: true`; any error → `{ tools: [], reachable: false }`. No fallback to
`AGENT_PUBLIC_URL`, whose other uses are untouched.

**Deployment (D-25).**

| Spec | Agent | UI `AGENT_ENDPOINT` |
|---|---|---|
| `docker-compose.yml`, `deploy/homelab/compose.yml` | `GRPC_PORT: "50061"`; nothing published | `xstockstrat-agent:50061` |
| `.do/app.yaml`, `.do/app.dev.yaml` | `GRPC_PORT` env; `internal_ports: [50061]` beside `http_port: 9000` | `${xstockstrat-agent.PRIVATE_DOMAIN}:50061` |
| `services/xstockstrat-ui/playwright.config.ts` | — | `127.0.0.1:9094` (dead port; no mock agent) |

Guards: `deploy/homelab/render-assert.jq` label `agent-endpoint` (UI value must equal
`xstockstrat-agent:<agent GRPC_PORT>`), exercised by mutations in `scripts/homelab-render.test.sh`;
a fail-closed predicate in `services/xstockstrat-ui/src/lib/dbTlsPlatformGuard.test.ts` for both DO
specs (agent `GRPC_PORT` set and listed in `internal_ports`, UI value matching), baseline first then
four mutations. `render-assert.jq:54` already fails if 50061 is ever published.

**Tests.**

- UI route test (D-32) and `connectClients.test.ts` cases (D-33) cover `@AC-1..3` and the
  "unset ⇒ unavailable" rule; `SAMPLE_TOOLS` moves to `e2e/fixtures/mcpTools.ts` (D-5).
- Agent (D-24, D-34): `@AC-4` (401 on the old route), `@AC-5` real-handshake cases with pinned
  status codes including a foreign-CA certificate carrying the UI name, `@AC-6` full catalog, a
  `_run_http` fail-closed test; catalog tests that used `/api/tools` move to a shared helper.
  Red is captured against a behaviour-free skeleton inside the atomic unit, never an import error.
- `peer_identity.py` parity guard across ingest, indicators and agent (D-31, D-35), with the two
  sibling paths added to the agent CI filter (`.github/workflows/ci.yml:59`).

**Docs (D-27).** Root `CLAUDE.md` (agent gRPC port, dependency edge; no naming exception); agent
`CLAUDE.md`, `docs/oauth.md:27`, `docs/context-constitution.md:5,39`, findings `:48` closed, the
now-false comments in `app/mtls.py:1-9`, `app/telemetry.py:6-8`, `app/tool_metrics.py:1`; UI
`CLAUDE.md` (the BFF-only sentence widened to "backends or the agent" — the durable home of the
operator's rule); `docs/runbooks/mcp-tools.md`; `docs/runbooks/reviewer-registry.md:24`;
`docs/patterns/inter-service-mtls.md` peer-certificate list; `docs/patterns/observability.md:19-20`;
remaining stale `GET /api/tools` mentions. The PR text states that a local agent without dev
certificates no longer starts.

**Step shape for `/sdd-spec` (D-28, D-12, D-17).** (1) `proto` lands with (2) `proto-gen`;
(3) agent `test` lands with (4) agent `service`; (5) UI `test` lands with (6) UI `service`;
(7) `test` — guards first, then the four specs, Playwright and the CI filter line; (8) `docs`.
Reviewers: Proto Reviewer plus agent and UI owners for the proto steps; Platform Lead for the new
port. One squash reaches `main-dev`.

**DigitalOcean gates (D-26, D-29, D-36).** Before the feature PR merges, the operator renders the
dev spec and runs `doctl apps spec validate` on it (server-side, not `--schema-only`; subcommand
confirmed with `--help`, fallback `doctl apps propose`), recording command and exit status in
`context.md`. After merge, the DO dev-app page check is a hard gate before `main-dev` → `main`.
If either fails: revert the single squash on `main-dev` and return to the operator.

**Homelab acceptance (D-8).** After the staging deploy: logged-in BFF returns `reachable: true`
with tools; `/agent/api/tools` no longer returns a catalog; connector URL and OAuth discovery
unchanged.

## Rejected Alternatives

- `R-2` Fall back to the public URL / public URL on DO only — contradicts the operator's steer.
- `R-5` Warn log on catalog failure — operator chose docs only.
- `R-7` Literal-only pins in the spec guards — fail a coordinated port move.
- `R-8` Shared YAML helper module for the DO guard — refactor outside this bug.
- `R-9` JSON string instead of `Struct` for the input schema — breaks repo precedent.
- `R-10` Start gRPC inside the Starlette lifespan — every HTTP-app test would need real PKI.
- `R-11` Default host for `AGENT_ENDPOINT` — makes "unset ⇒ unavailable" impossible.
- `R-12` Capture the agent red through the generated servicer base class — tests generated code.
- `R-13` Copy the cancel-status interceptor into the agent — recorded as a gap instead.
- Moot after the reopen (run-1 HTTP design): `R-1`, `R-3`, `R-4`, `R-6`.

## Open Risks

- [ ] DigitalOcean has never been given a component with both `http_port` and `internal_ports` in
  this repo; the page works on DO today, and there is no technical fallback inside the operator's
  steer — addressed by D-36 (pre-merge), D-26 (post-merge gate, revert rule).
- [ ] `doctl apps spec validate` is unconfirmed from the repo — operator confirms at D-36.
- [ ] Homelab edge behaviour is the operator's measurement — confirmed at D-8.
- [ ] A cancelled or expired `ListTools` call records status 0 in `rpc.server.duration` — logged
  in the agent findings file at the docs step.
- [ ] The skeleton-first red is a reading of the TDD gate, not a documented shape — if impl-spec
  review rejects it, record a deviation; process finding to add the shape to `tdd-gate.md`.
- [ ] During a rolling deploy the page briefly shows "agent unreachable" on DO.
- [ ] Track C template emits no `@FR-N` tags; `@AC-3..6` are untagged — resolve before C-16
  promotion (process finding).
- [ ] `getter` module mock and `Struct` → plain object in the UI are unexecuted assumptions —
  proven at the UI test step; fallback is `vi.doMock` + dynamic import.

## Constitution Rules Touched

- `C-01`/`F-04` — honored by: anchors verified by both subagents across six rounds.
- `C-03`/PLAT-4 — honored by: the BFF sends the platform headers on the new call.
- `C-04` — honored by: no closed value set in the new proto, so no enum.
- `C-08`/`P-06` — honored by: paired test/service units with behavioural reds (D-32..D-35).
- `C-09` — honored by: `buf lint`, `buf breaking`, regenerated stubs in the proto unit.
- `C-10` — honored by: every run site set in one step, two guards, stale mentions swept.
- `C-12`/`C-13` — honored by: `SAMPLE_TOOLS` and the agent catalog helper centralized.
- `C-14` — honored by: consumer surface named and reached (UI page).
- `C-15` — honored by: `@AC-1..6` each traced to a test; FR-tag gap recorded as an open risk.
- `C-16` — honored by: two CHANGE rules signed off (below).
- `C-18` — honored by: reuse of ingest patterns; copies recorded with a parity guard; R-8..R-13.
- `F-06`/`F-07` — honored by: no DB use; `GRPC_PORT`/`AGENT_ENDPOINT` are boot-time env vars.
- `F-08` — honored by: every staged file, incl. generated trees, listed per step (D-28).
- `P-04` — honored by: six recorded gates and the operator's steer in `context.md`.

## Business Rules Touched (C-16)

- CHANGE `@AC-25 @feature-224` "Agent tools expose templates and drop public arguments" (`services/xstockstrat-agent/acceptance/private-by-default-templates.feature`) — Given re-pointed to the internal catalog RPC; signed off by user @ 2026-11-19 (context.md, run 2).
- CHANGE `@AC-6 @feature-283` "The tool count is unchanged and its surfaces agree" (`docs/sdd/business-rules/platform.feature`) — surface name reworded, count 45 unchanged; signed off by user @ 2026-11-19 (context.md, gate 5).
- PRESERVE `@AC-3 @feature-279` "Only the UI and the agent publish ports…" — not regressed by: 50061 is never published.
- PRESERVE `@AC-3`/`@AC-4 @feature-271` (UI session gates) — not regressed by: session gate first; agent-health untouched.
- PRESERVE `@AC-1 @feature-214` (no `db_` tool) — not regressed by: catalog content unchanged.
- PRESERVE `@AC-19 @feature-294` (agent, missing mTLS still answers 401) — holds at unit level only now that boot fails closed.
- EXTEND platform `@AC-4 @feature-210` (mTLS fail-closed) — the agent now fails at boot like every gRPC server.

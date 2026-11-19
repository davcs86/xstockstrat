# Debate Register: fix-mcp-tools-page

**State**: in-debate
**Mode**: quick
**Rounds run**: 1 (round numbers continue across runs; the mode's 2–5 / 1 bounds count this run only)

## Rounds

| Round | Date | Run by | +D | +R | O closed | +O | Petitions | Progress |
|---|---|---|---|---|---|---|---|---|
| 1 | 2026-11-19 | /sdd-design | 10 | 5 | 7 | 7 | 0 | yes |

## Settled Decisions

<!-- Status: settled → superseded by D-m (only after a user-approved REOPEN) -->
| ID | Round | Decision | Evidence | Status |
|---|---|---|---|---|
| D-1 | 1 | Operator constraints (pre-debate, binding): env var `AGENT_ENDPOINT` as `host:port`; set in every deployment spec; unset ⇒ `{tools: [], reachable: false}` with no fallback to `AGENT_PUBLIC_URL`; the browser only ever calls the UI BFF and the BFF calls the agent on the internal network; other `AGENT_PUBLIC_URL` uses unchanged; no agent code change | `context.md` session 2026-11-19 | settled |
| D-2 | 1 | Route reads `process.env.AGENT_ENDPOINT` inline inside the handler (request time) and fetches `http://${AGENT_ENDPOINT}/api/tools`; session gate stays ahead of the env read; degrade paths and `withBffMetrics` unchanged; no helper | `services/xstockstrat-ui/src/app/accounts/api/mcp-tools/route.ts:14-30`; `insights.md:835` | settled |
| D-3 | 1 | Values: `xstockstrat-agent:9000` in `deploy/homelab/compose.yml` and `docker-compose.yml`; `${xstockstrat-agent.PRIVATE_DOMAIN}:9000` in `.do/app.yaml` and `.do/app.dev.yaml`; `127.0.0.1:9099` (dead port) in `playwright.config.ts`. Each line sits next to `AGENT_PUBLIC_URL`, outside the "gRPC endpoints" block | `deploy/homelab/compose.yml:284,300,319`; `docker-compose.yml:502,520`; `.do/app.yaml:638-639,652-653`; `playwright.config.ts:168`; `fails.md:1553` | settled |
| D-4 | 1 | Tests: new Vitest `src/app/accounts/api/mcp-tools/route.test.ts` on the audit-route precedent, `fetch` stubbed via `vi.stubGlobal`. `@AC-1` asserts the response body `{tools: SAMPLE_TOOLS, reachable: true}` and exactly one call, to the internal URL; `@AC-2` unsets `AGENT_ENDPOINT` explicitly and uses a `fetch` mock that throws when called; `@AC-3` session null → 401, no fetch. `afterEach` adds `vi.unstubAllGlobals()` | `src/app/config-ui/api/audit/route.test.ts:5,25,31,40-50`; `vitest.config.ts:20`; `acceptance.feature:11` | settled |
| D-5 | 1 | `SAMPLE_TOOLS` moves to `e2e/fixtures/mcpTools.ts`, imported by the e2e spec and the route test; `INVENTORY.md:108` updated (second consumer, C-12/C-13) | `e2e/accounts/mcp-tools.spec.ts:12-30`; `src/lib/backtestBackfill.test.ts:6` | settled |
| D-6 | 1 | Docs in the same change: root `CLAUDE.md` naming table row **and** the Rules bullet below it (one named plain-HTTP exception: `AGENT_ENDPOINT`, caller adds `http://`); root dependency tree gains `xstockstrat-ui → xstockstrat-agent (HTTP GET /api/tools, internal network)`; `services/xstockstrat-ui/CLAUDE.md` env list (new line stating "host:port, no scheme"; narrowed `AGENT_PUBLIC_URL` line; `*_ENDPOINT` count line); `docs/runbooks/mcp-tools.md`; one scoped-exception line in `docs/patterns/inter-service-mtls.md` (plain HTTP, unauthenticated catalog metadata only, not a precedent) | root `CLAUDE.md:178`; `services/xstockstrat-ui/CLAUDE.md:216-217`; `docs/patterns/inter-service-mtls.md:3,26` | settled |
| D-7 | 1 | DigitalOcean: ship `${xstockstrat-agent.PRIVATE_DOMAIN}:9000` without touching the agent component. The DO dev-app check (`/accounts/mcp-tools` lists tools) is a gate before `main-dev` → `main` promotion, evidence in `context.md`. Pre-decided remediation if it fails: add `internal_ports: [9000]` to the agent component in both DO specs (ask the operator if DO rejects the duplicate of `http_port`) | `.do/app.yaml:342`; `.do/app.dev.yaml:11,344` | settled |
| D-9 | 1 | Homelab render guard (user, gate 1): `deploy/homelab/render-assert.jq` projects the UI's `AGENT_ENDPOINT` and fails unless it equals `xstockstrat-agent:9000`; its test fixture/script is updated with it | `deploy/homelab/render-assert.jq:23-25,54`; `scripts/homelab-render-check.sh:21` | settled |
| D-10 | 1 | Malformed values (user, gate 1): documentation only — "host:port, no scheme" on the UI `CLAUDE.md` env line and beside the var in the specs; the catch path is not changed | `services/xstockstrat-ui/CLAUDE.md:216-217` | settled |
| D-8 | 1 | Homelab acceptance by the operator after the staging deploy, evidence in `context.md`: logged-in BFF returns `reachable: true` with tools; external `GET /agent/api/tools` still 404; connector URL and OAuth discovery unchanged | `product-spec.md` § Acceptance Criteria | settled |

## Rejected Alternatives (locked)

<!-- Status: locked → reopened @ round N (user, context.md <ISO>) -->
| ID | Round | Alternative | Why rejected | Status |
|---|---|---|---|---|
| R-1 | 1 | Add `internal_ports: [9000]` to the DO agent component up front | Speculative if `http_port` already answers on the private domain, and DO may reject a duplicate of `http_port`; kept as D-7's pre-decided remediation | locked |
| R-2 | 1 | Keep the public URL on DO, use `AGENT_ENDPOINT` only on homelab (or fall back when unset) | Contradicts D-1 (set everywhere, no fallback); two code paths; DO keeps hairpinning through public ingress | locked |
| R-3 | 1 | Shared HTTP base-URL helper for the agent | One HTTP consumer; `connectClients.ts:17-26,55` builds gRPC transports (C-18 YAGNI) | locked |
| R-5 | 1 | Server-side warn log when the catalog fetch throws or returns non-OK | User chose docs only at gate 1 (D-10); scope growth beyond the bug | locked |
| R-4 | 1 | Add a fetch timeout in this fix | Pre-existing gap shared with `agent-health/route.ts:15`; a new constant outside the bug's scope; logged to `services/xstockstrat-ui/docs/context-constitution-findings.md` instead | locked |

## Objections

<!-- Status: open → closed @ round N (<how>) | waived @ round N (user) | reopened @ round N (user) -->
| ID | Round | Objection | Blocking | Status |
|---|---|---|---|---|
| O-1 | 1 | DO goes from a working public path to an unproven private address; a failure is a silent production regression, not a "safe" state (P-03) | no | closed @ round 1 (D-7: promotion gate + pre-decided remediation) |
| O-2 | 1 | The `@AC-1` test asserted only fetch URLs, not the scenario's response body; stubbed `fetch` would leak without `vi.unstubAllGlobals()` (C-15) | no | closed @ round 1 (D-4) |
| O-3 | 1 | `@AC-2` must unset the variable explicitly and make an unexpected fetch fail loudly (P-06, `fails.md:1556-1558`) | no | closed @ round 1 (D-4) |
| O-4 | 1 | Nothing mechanical stops a spec from losing the variable again; `deploy/homelab/render-assert.jq` could assert the UI's `AGENT_ENDPOINT` (C-10, `fails.md:1553`) | no | closed @ round 1 (user: add the guard, D-9) |
| O-5 | 1 | Editing only the naming-table cell leaves the Rules bullet and the UI `*_ENDPOINT` count line contradicting it (C-18) | no | closed @ round 1 (D-6) |
| O-6 | 1 | First plaintext inter-service hop is unrecorded against the mTLS contract (`inter-service-mtls.md:26`) | no | closed @ round 1 (D-6 scoped-exception line) |
| O-7 | 1 | A malformed value (e.g. with a scheme) fails silently as `reachable: false`; optional warn log on the catch path (P-03) | no | closed @ round 1 (user: docs only, D-10; warn log locked as R-5) |

## Reopen Petitions

<!-- Verdict: dropped (evidence not new — already on record at <ID>) | pending user | user reopened | user declined -->
| ID | Round | Target | New evidence | Verdict |
|---|---|---|---|---|

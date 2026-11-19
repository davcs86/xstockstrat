# Debate Register: fix-mcp-tools-page

**State**: in-debate
**Mode**: quick
**Rounds run**: 3 (round numbers continue across runs; the mode's 2–5 / 1 bounds count this run only)

## Rounds

| Round | Date | Run by | +D | +R | O closed | +O | Petitions | Progress |
|---|---|---|---|---|---|---|---|---|
| 1 | 2026-11-19 | /sdd-design | 10 | 5 | 7 | 7 | 0 | yes |
| 2 | 2026-11-19 | /sdd-design | 4 | 1 | 6 | 7 | 1 | yes |
| 3 | 2026-11-19 | /sdd-design | 1 | 2 | 6 | 5 | 0 | yes |

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
| D-11 | 2 | Test detail, additive to D-4 (its throwing mock stays): every scenario also asserts on the mock — `@AC-2`/`@AC-3` `not.toHaveBeenCalled()`, `@AC-1` exactly one call to `http://xstockstrat-agent:9000/api/tools` — because the route's bare `catch` swallows a throw. `getSessionFromRequest` is a hoisted `vi.fn()` defaulting to a session and reset in `beforeEach`; `AGENT_PUBLIC_URL` is stubbed in every case; `@AC-1` stubs `AGENT_ENDPOINT` explicitly and keys the mock by URL (public → 404, internal → the fixture). `@AC-3` is a characterization test, stated as "red N/A" | `route.ts:25`; `audit/route.test.ts:5-8`; `fails.md:1556-1558`; `.claude/skills/sdd-execute/reference/tdd-gate.md:55-58` | settled |
| D-12 | 2 | Step shape for `/sdd-spec`: the route test and the route change land as one atomic unit (`**Lands with**`), so no step PR is red on its own; the infra step holds its own red→green (jq guard and test lines first, then the value in the four specs and Playwright); docs last | `.claude/skills/sdd-spec/reference/step-constraints.md` §C | settled |
| D-13 | 2 | The route's header comment is rewritten with the change (≤2 lines): catalog comes from `AGENT_ENDPOINT` on the internal network; unset or any failure ⇒ `{tools: [], reachable: false}`; never `AGENT_PUBLIC_URL` | `route.ts:11-12` | settled |
| D-14 | 2 | D-6 additions: `services/xstockstrat-ui/CLAUDE.md` Dependencies intro (`:138`, "over gRPC") gains the internal-HTTP agent catalog; the BFF-only sentence (`:17-18`) is widened to "backends or the agent" and is the single durable home for the operator's BFF-only rule; D-9's guard is exercised by one rendered-value assertion and two mutations (var deleted; var set with a scheme) in `scripts/homelab-render.test.sh` | `services/xstockstrat-ui/CLAUDE.md:17-18,138`; `scripts/homelab-render.test.sh:56,92,180-189`; `deploy/homelab/render-assert.jq:23,53` | settled |
| D-15 | 3 | DO-side guard (reopened O-4): a new `describe` in the existing `services/xstockstrat-ui/src/lib/dbTlsPlatformGuard.test.ts`, reusing its file-local `ROOT`/`readSpec`/`Env`/`Component`, with ONE file-local predicate `agentEndpointDrift(spec)` returning `null` or a reason. It compares the UI component's `AGENT_ENDPOINT` to `${xstockstrat-agent.PRIVATE_DOMAIN}:<agent http_port>` read from the agent's `services:` entry, and fails closed when the agent or its `http_port` is missing. Positive test: `null` on `.do/app.yaml` and `.do/app.dev.yaml`. Mutation test on a clone: baseline `null` first, then non-null after each of (a) env deleted, (b) value with a scheme, (c) agent `http_port` changed. No literal port pin. File header rewritten (≤2 lines) to cover the agent endpoint; `describe` named without an `AC-n` prefix; file not renamed. The file is in the infra step's `**Files**`; real red = positive test failing before the specs gain the value; mutation rows are "red N/A — guard self-check". `docker-compose.yml` is not guarded: local-dev only, not deployed, a regression there shows as an empty catalog; homelab is covered by D-9/D-14. No `@AC-*` addition. CI already runs it on DO-spec-only changes | `dbTlsPlatformGuard.test.ts:1-2,9,47-48,62-64,88,92-98`; `.do/app.yaml:336,342,607,652`; `.do/app.dev.yaml:338,344,604,649`; `.github/workflows/ci.yml:64,746,754,771-773,796` | settled |

## Rejected Alternatives (locked)

<!-- Status: locked → reopened @ round N (user, context.md <ISO>) -->
| ID | Round | Alternative | Why rejected | Status |
|---|---|---|---|---|
| R-1 | 1 | Add `internal_ports: [9000]` to the DO agent component up front | Speculative if `http_port` already answers on the private domain, and DO may reject a duplicate of `http_port`; kept as D-7's pre-decided remediation | locked |
| R-2 | 1 | Keep the public URL on DO, use `AGENT_ENDPOINT` only on homelab (or fall back when unset) | Contradicts D-1 (set everywhere, no fallback); two code paths; DO keeps hairpinning through public ingress | locked |
| R-3 | 1 | Shared HTTP base-URL helper for the agent | One HTTP consumer; `connectClients.ts:17-26,55` builds gRPC transports (C-18 YAGNI) | locked |
| R-5 | 1 | Server-side warn log when the catalog fetch throws or returns non-OK | User chose docs only at gate 1 (D-10); scope growth beyond the bug | locked |
| R-6 | 2 | Pre-merge probe of the agent's private address from the running DO dev UI console | User chose the post-merge check only at gate 2 (D-7) | locked |
| R-7 | 3 | DO guard as a literal-only pin (`...:9000` and `http_port == 9000`) | Fails a legitimate coordinated port move and tests a different predicate than its own mutation rows (C-18, P-06) | locked |
| R-8 | 3 | Extract the YAML helpers into a shared module plus a separate `agentEndpointPlatformGuard.test.ts` | Refactors a file this bug does not own for ~25 lines; revisit when a third unrelated spec guard appears (C-18 YAGNI) | locked |
| R-4 | 1 | Add a fetch timeout in this fix | Pre-existing gap shared with `agent-health/route.ts:15`; a new constant outside the bug's scope; logged to `services/xstockstrat-ui/docs/context-constitution-findings.md` instead | locked |

## Objections

<!-- Status: open → closed @ round N (<how>) | waived @ round N (user) | reopened @ round N (user) -->
| ID | Round | Objection | Blocking | Status |
|---|---|---|---|---|
| O-1 | 1 | DO goes from a working public path to an unproven private address; a failure is a silent production regression, not a "safe" state (P-03) | no | closed @ round 1 (D-7: promotion gate + pre-decided remediation) |
| O-2 | 1 | The `@AC-1` test asserted only fetch URLs, not the scenario's response body; stubbed `fetch` would leak without `vi.unstubAllGlobals()` (C-15) | no | closed @ round 1 (D-4) |
| O-3 | 1 | `@AC-2` must unset the variable explicitly and make an unexpected fetch fail loudly (P-06, `fails.md:1556-1558`) | no | closed @ round 1 (D-4) |
| O-4 | 1 | Nothing mechanical stops a spec from losing the variable again; `deploy/homelab/render-assert.jq` could assert the UI's `AGENT_ENDPOINT` (C-10, `fails.md:1553`) | no | closed @ round 3 (homelab D-9/D-14 + DO D-15; reopened @ round 2 by user via P-1) |
| O-5 | 1 | Editing only the naming-table cell leaves the Rules bullet and the UI `*_ENDPOINT` count line contradicting it (C-18) | no | closed @ round 1 (D-6) |
| O-6 | 1 | First plaintext inter-service hop is unrecorded against the mTLS contract (`inter-service-mtls.md:26`) | no | closed @ round 1 (D-6 scoped-exception line) |
| O-7 | 1 | A malformed value (e.g. with a scheme) fails silently as `reachable: false`; optional warn log on the catch path (P-03) | no | closed @ round 1 (user: docs only, D-10; warn log locked as R-5) |
| O-8 | 2 | Round-2 proposal replaced D-4's throwing mock without a petition (register, P-03) | no | closed @ round 2 (D-11 is additive; D-4 stands) |
| O-9 | 2 | Session mock under-specified: a `null` session in `@AC-3` could leak into later tests; `@AC-1` never stated its `AGENT_ENDPOINT` stub (C-15, P-06) | no | closed @ round 2 (D-11) |
| O-10 | 2 | `@AC-3` has no red; the TDD gate needs "red N/A — characterization test" stated (P-06) | no | closed @ round 2 (D-11) |
| O-11 | 2 | A test-only first step lands red on its own step PR (C-08, step-constraints §C) | no | closed @ round 2 (D-12) |
| O-12 | 2 | The route's own comment would still say "public" (root CLAUDE.md How to Act #5) | no | closed @ round 2 (D-13) |
| O-13 | 2 | UI `CLAUDE.md:138` still says the UI consumes services "over gRPC" only; BFF-only sentence anchor is `:17-18` (C-18, C-01) | no | closed @ round 2 (D-14) |
| O-14 | 2 | The manual post-merge DO gate is reactive: a failure is found only once `main-dev` carries the change, and `/promote` has no feature-specific prompt. A pre-merge probe from the running DO dev UI container (`wget http://<agent private domain>:9000/api/tools`) would turn it into a confirmation (P-03) | no | waived @ round 2 (user: post-merge check only; D-7 stands, pre-merge probe locked as R-6) |
| O-15 | 3 | DO guard's mutation rows used a different predicate than the positive test and had no baseline, so they could pass vacuously (P-06, C-08) | yes | closed @ round 3 (D-15: one predicate, baseline first, fail-closed) |
| O-16 | 3 | Literal `http_port == 9000` pin contradicts the "derived" expectation (C-18) | no | closed @ round 3 (D-15: derived only; R-7) |
| O-17 | 3 | New describe makes the file header/name partly inaccurate (C-18) | no | closed @ round 3 (D-15: header rewritten, describe named, no rename) |
| O-18 | 3 | Stated reason for excluding `docker-compose.yml` was wrong: a bad value degrades silently, it does not fail on first run (P-03) | no | closed @ round 3 (D-15 records the accurate reason) |
| O-19 | 3 | "red N/A" for the mutation rows is valid only with a baseline assertion (P-06) | no | closed @ round 3 (D-15) |

## Reopen Petitions

<!-- Verdict: dropped (evidence not new — already on record at <ID>) | pending user | user reopened | user declined -->
| ID | Round | Target | New evidence | Verdict |
|---|---|---|---|---|
| P-1 | 2 | O-4 | `services/xstockstrat-ui/src/lib/dbTlsPlatformGuard.test.ts:87-98` already parses both DO specs inside the UI Vitest suite, so a DO-side `AGENT_ENDPOINT` presence guard needs no new harness (O-4/D-9 cited only the homelab jq check) | user reopened |

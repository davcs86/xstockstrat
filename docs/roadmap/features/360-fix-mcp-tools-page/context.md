# Context Log: fix-mcp-tools-page

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-19 (/sdd-triage)

- Bug reported via operator report (Issues disabled), recorded as `docs/reports/2026-11-19-mcp-tools-page-empty-on-homelab-defect.md`:
  MCP Tools page shows no tools on homelab deployments
- Severity: SEV-3 (operator-chosen; the report carried none)
- Routed to SDD path (Track C)
- Created: feature.md, product-spec.md, acceptance.feature (regression scenario), context.md
- Affected services (from report): xstockstrat-ui, plus the four deployment specs that set its env
- Root cause hypothesis: BFF fetches `${AGENT_PUBLIC_URL}/api/tools`; on homelab the public edge 404s it
- Recommended design depth: quick → `/sdd-design fix-mcp-tools-page quick` (rationale: SEV-3 and one code
  service would allow skip, but the fix adds a runtime env var across four deployment specs and the
  DO internal agent address is unverified — treated as the rubric's "config change is mentioned")
- Development branch: feature/fix-mcp-tools-page
- Operator decisions (AskUserQuestion, this session): env var name `AGENT_ENDPOINT` (`host:port`, not
  the report's `AGENT_INTERNAL_URL`); set in every deployment spec with **no** fallback to
  `AGENT_PUBLIC_URL`; call chain browser → authenticated BFF → agent over the internal network
- Open for design: the root CLAUDE.md convention table describes `_ENDPOINT` as gRPC `host:port`;
  `AGENT_ENDPOINT` is plain HTTP — the table needs a note. DO internal hostname/port for the agent
  component cannot be verified before deploy. Local `docker-compose.yml` sets the UI's
  `AGENT_PUBLIC_URL` to the internal address today (so the connector URL shown locally is internal) —
  pre-existing, not part of this fix unless design says otherwise.
- Agent-side question (`GET /api/tools` unauthenticated) left open in the agent findings file
- Operator constraint (2026-11-19, stated twice, "always"): the UI's BFF is the **only** entry point
  for calls from the UI's client side. Browser code never calls the agent (or any backend) directly;
  the authenticated BFF calls the agent inside the DO / homelab network. Recon must confirm no
  client-side code reaches the agent today.

## Session 2026-11-19 — sdd-design (in progress)

- Entered at status `draft` (Track C, `/sdd-review` skipped) on the operator's explicit choice of
  "Design quick, then stop".
- Tree: design ran on `ccr-a72ccc3e-9kr7yq` (= `origin/main-dev@5142fc5` + docs-only commits) because
  the feature directory is not on `main-dev` yet and this session may push only to that branch;
  `feature/fix-mcp-tools-page` does not exist on origin.
- Phase 0 Recon: wrote recon.md (xstockstrat-ui, xstockstrat-agent, four deployment specs). No
  post-recon escalation signal; no CHANGE business rule.
- Round 1 gate (operator): **Run another round**; O-4 → add the homelab render guard (D-9); O-7 →
  docs only, no warn log (D-10, R-5). Mode upgraded from 1 round to 2 at the operator's request.
- Round 2 gate (operator): **Run another round**; O-14 waived — DO is verified post-merge only (D-7
  stands; pre-merge probe locked as R-6); petition P-1 accepted — **O-4 reopened** to add a DO-side
  `AGENT_ENDPOINT` guard in the UI Vitest suite (round 3 designs it).
- Round 3 gate (operator): **Run another round** (no open objection; round 4 is a whole-design
  consistency pass over D-1..D-15).
- Round 4 gate (operator, 2026-11-19T15:45Z): **Approve this design**.

## Session 2026-11-19T15:45Z — sdd-design

- Phase 0 Recon: wrote recon.md (services: xstockstrat-ui, xstockstrat-agent as callee, four
  deployment specs; key reuse patterns: audit-route Vitest harness, `dbTlsPlatformGuard` spec parsing,
  homelab render oracle).
- Phase 1 Grilling: 4 rounds (quick, extended by the operator at gates 1–3). Chosen approach: BFF
  fetches `http://${AGENT_ENDPOINT}/api/tools` on the internal network, value in every spec, no
  fallback, guarded on homelab (jq oracle) and DO (Vitest spec check). Rejected: R-1..R-8 (debate.md).
- Constitution rules touched: C-01, C-08, C-10, C-12/C-13, C-15, C-16, C-18, F-04, F-07, F-08, P-04,
  P-06. Floor breaches: none.
- Status: draft → design-approved.

## Open Threads

- DO private address unproven → D-7 manual gate before `main-dev` → `main` promotion (after step 3
  deploys); remediation `internal_ports: [9000]`.
- Homelab acceptance evidence (D-8) → after merge and staging deploy.
- Fetch-timeout finding → written at step 4 (docs).
- `@FR-N` tag gap (Track C template vs C-15; `@AC-3` untagged) → resolve before C-16 promotion.
- Agent `GET /api/tools` auth → out of scope; agent findings file `:48`.
- Branch: the feature directory currently lives on `ccr-a72ccc3e-9kr7yq` (PR #1588 → `main-dev`);
  `feature/fix-mcp-tools-page` is created from `main-dev` after that PR merges.

## Session 2026-11-19 — sdd-design run 2 (in progress)

- Operator reopened the approved design (status was `design-approved`; re-run confirmed by choosing
  "Reopen feature 360"). Steer, recorded as D-19:
  - move the catalog out of the public `/agent` route: **remove** the unauthenticated
    `GET /api/tools` on the agent's port 9000;
  - add an internal-only port **50061** on the agent, **gRPC over mTLS**, accepting only the
    `xstockstrat-ui` peer certificate; new proto package `agent/v1`;
  - the UI BFF calls the new port and endpoint.
- **C-16 sign-off (operator, 2026-11-19)**: the existing rule `@AC-25 @feature-224` "Agent tools expose
  templates and drop public arguments" (which reads the catalog via `GET /api/tools`) may be CHANGED
  to read it through the new endpoint.
- Reopened by the operator: D-1 (no-agent-change part), D-2, D-3, D-6, D-7, D-9, D-13, D-14, D-15,
  D-16. Still standing: D-4/D-5/D-11 (route-test approach), D-8, D-10, D-12, D-17, D-18, R-1..R-8
  where still applicable.
- Mode: full (proto change + two services are escalate signals). Scope now includes
  xstockstrat-agent and `packages/proto`.
- Round 5 gate (operator): petitions P-2/P-3 accepted — **D-4 and D-11 reopened** (UI tests mock the
  gRPC client; safeguards kept); petition P-4 accepted — **operator-run `doctl` schema check of the
  rendered DO dev spec before merge** (D-29; the R-6 network probe stays locked); server telemetry on
  the agent (D-30) and a `peer_identity.py` parity guard (D-31) added.
- **C-16 sign-off (operator, 2026-11-19)**: `@AC-6 @FR-4 @feature-283` "The tool count is unchanged
  and its surfaces agree" (`docs/sdd/business-rules/platform.feature:795-798`) may be reworded from
  "the /api/tools catalog" to the new internal catalog RPC; the count (45) is unchanged.
- Open for round 6 (blocking): O-32, O-34 (UI test design), O-35 (red for `@AC-5`/`@AC-6`); O-33.
- Round 6 gate (operator, 2026-11-19T19:13Z): **Approve this design**.

## Session 2026-11-19T19:13Z — sdd-design (run 2)

- Phase 0 Recon: run-2 addendum in recon.md (services: xstockstrat-agent, xstockstrat-ui,
  packages/proto, four deployment specs; key reuse patterns: ingest mTLS server +
  `peer_identity.py`, UI `makeTransport`, homelab render oracle).
- Phase 1 Grilling: 2 rounds (full; rounds 5–6). Chosen approach: `AgentService.ListTools` on agent
  port 50061 over mTLS (UI certificate only), public `/api/tools` removed, BFF calls it via
  `AGENT_ENDPOINT` with no fallback. Rejected: R-9..R-13 (plus run-1 R-2, R-5, R-7, R-8).
- Constitution rules touched: C-01, C-03, C-04, C-08, C-09, C-10, C-12/C-13, C-14, C-15, C-16, C-18,
  F-04, F-06, F-07, F-08, P-04, P-06. Floor breaches: none.
- Status: design-approved (unchanged).

## Open Threads (run 2 — replaces the run-1 list above)

- Operator pre-merge DO schema check (D-36) → before the feature PR merges; record in this file.
- DO dev-app page check (D-26) → after merge, hard gate before `main-dev` → `main`; on failure
  revert the squash.
- Homelab acceptance evidence (D-8) → after the staging deploy.
- Cancel-status telemetry gap → agent findings file at the docs step.
- Skeleton-first red: process finding for `tdd-gate.md`; deviation if impl-spec review rejects it.
- `@FR-N` tag gap (`@AC-3..6` untagged) → resolve before C-16 promotion.
- Branch: the feature directory lives on `ccr-a72ccc3e-9kr7yq` (PR #1588 → `main-dev`);
  `feature/fix-mcp-tools-page` is created from `main-dev` after that PR merges.

## Session 2026-11-19T19:36Z — sdd-spec

- Generated implementation-spec.md with 8 steps. Status → implementation-ready.
- Tree: spec evidence read on `ccr-a72ccc3e-9kr7yq@6916759` (= `origin/main-dev@5142fc5` + docs-only
  commits). The tree-freshness rule names `main-dev` as TARGET while `feature/fix-mcp-tools-page`
  does not exist on origin; the checkout was not switched because the feature directory is only on
  this branch (same call as the sdd-design sessions above). No working-tree changes at boot.
- Discovery ran inline (no `codebase-discovery` subagent available in this session); recon.md
  anchors were re-read on the stamped tree.
- Step shape: 1 `proto` + 2 `proto-gen` (unit); 3 agent `test` + 4 agent `service` (unit); 5 UI
  `test` + 6 UI `service` (unit); 7 `test` (guards, then the four specs, Playwright, CI filter);
  8 `docs`. `@AC-1..3` → Step 5; `@AC-4..6` → Step 3.
- Key codebase findings:
  - `packages/proto/gen/ts/dist/` is committed and holds no `_connect` output
    (`gen/ts/tsconfig.json` excludes `**/*_connect.ts`); the UI imports `AgentService` from
    `@xstockstrat/proto/agent/v1/agent_pb`. Nothing but `scripts/check-otel-produced-signals.py:200`
    enumerates proto packages.
  - `deploy/homelab/render-assert.jq:23-25` projects only named env keys, so the `agent-endpoint`
    check needs `AGENT_ENDPOINT` and `GRPC_PORT` added to the projection.
  - `services/xstockstrat-ui/tsconfig.json` includes `**/*.ts`, so `tsc --noEmit` compiles tests —
    the reason Steps 5+6 are one unit.
  - Residual `api/tools` grep at spec time: 20 hits in 15 files outside `docs/roadmap` and
    `docs/reports`; expected survivors after Step 8 are listed in that step.
  - `buf`, `sops`, `shellcheck`, `shfmt` and `doctl` are not installed on this host; Steps 1 and 7
    carry a tool preflight.
- Spec-level choices not fixed by design.md (for impl-spec review):
  - `build_catalog_server` returns `(server, bound_port)`; D-21 says "returning the bound port",
    but the caller also needs the server handle to start and stop it.
  - Names `CatalogServicer`, `resolve_grpc_port()` and the conftest helper `catalog_tools()`.
  - The D-34 skeleton also carries a no-op `_make_rpc_duration_processor`, so the ported telemetry
    tests go red on behaviour, not on an import error.
  - DO guard mutations: UI env deleted; UI value with a scheme; agent `GRPC_PORT` env deleted; port
    removed from `internal_ports` (D-25 says "four mutations" without listing them).
  - Now-false comments are fixed in the step that owns the file (agent `app/*` in Step 4,
    `copilot.ts` in Step 6, test comments in Steps 3 and 5) rather than in the docs step.
  - `agent_pki` in the agent `tests/test_mtls.py` is re-expressed through new `_ca`/`_leaf` helpers
    (second consumer of the openssl recipe).

## Open Threads (after sdd-spec — adds to the run-2 list above)

- `345-authelia-sso` (`implementation-ready`) cites the agent route table at `app/main.py:250-267`;
  Step 4 removes a line there → whichever merges second re-anchors by symbol; raise at
  `/sdd-review fix-mcp-tools-page impl-spec` (feature-overlap).
- Feature branch: `feature/fix-mcp-tools-page` still does not exist; Step 1's `buf breaking`
  command needs it as a local ref.

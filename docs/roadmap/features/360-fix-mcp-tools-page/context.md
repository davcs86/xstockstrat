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

## Session 2026-11-19T19:45Z — sdd-review impl-spec (advisory)

- Tree: ccr-a72ccc3e-9kr7yq@618640d (= origin/main-dev@5142fc5 + docs-only commits for 360).
- Result: 1 failure, 8 warnings (advisory — did not block). No Floor (`F-*`) risk. All six `@AC`
  scenarios map to a test step; design fidelity confirmed for D-19..D-37.
- Unresolved ✗ / ⚠ carried into execution:
  - Step 6: ✗ Verification contradicts Instruction 2 — the rewritten route comment must say "never
    `AGENT_PUBLIC_URL`" while the grep for `AGENT_PUBLIC_URL` expects no output (F-05) — [x] addressed in implementation-spec.md (sdd-spec re-run 2026-11-19T19:56Z)
  - Step 4: ⚠ `grep -n … app/` lacks `-r`, so it passes vacuously (P-06) — [x] addressed in implementation-spec.md (sdd-spec re-run 2026-11-19T19:56Z)
  - Step 2: ⚠ `packages/proto/gen/**` is a literal wildcard in `**Files**`; add unexpected files by
    exact path (F-08) — [x] addressed in implementation-spec.md (sdd-spec re-run 2026-11-19T19:56Z)
  - Step 1: ⚠ `buf breaking` baseline names `feature/fix-mcp-tools-page`, which does not exist yet;
    use `main-dev` or create the branch first (C-09) — [x] addressed in implementation-spec.md (sdd-spec re-run 2026-11-19T19:56Z)
  - Step 3: ⚠ state that the D-34 skeleton is a working-tree stage, not committed under Step 3, and
    that `app/peer_identity.py` is absent during the red (F-08) — [x] addressed in implementation-spec.md (sdd-spec re-run 2026-11-19T19:56Z)
  - Step 5: ⚠ record the `vi.doMock` + dynamic-import fallback for the getter-mock assumption — [x] addressed in implementation-spec.md (sdd-spec re-run 2026-11-19T19:56Z)
  - Step 7: ⚠ the CI-filter check is only a YAML parse; grep for the two added paths (C-10) — [x] addressed in implementation-spec.md (sdd-spec re-run 2026-11-19T19:56Z)
  - Steps 3, 7, 8: ⚠ more than 5 files each (accepted shape; noted) — [x] addressed (spec revisions 2–5; review round 4 clean)
- Overlap findings (no FAIL-level; no merge-order row required):
  - `345-authelia-sso` (implementation-ready): same route table in
    `services/xstockstrat-agent/app/main.py` — whichever merges second re-anchors by symbol.
  - `337-metrics-host-provider-label` (in-progress): `services/xstockstrat-agent/app/telemetry.py`
    (different functions), `docs/patterns/observability.md`, `docs/sdd/business-rules/platform.feature`
    — rebase-only.
  - `.github/workflows/ci.yml` path filters: adjacent lines with 345 — rebase-only.
  - 323 and 331 (spec-ready) also touch agent `main.py`; re-scan when they reach implementation-ready.

## Session 2026-11-19T19:56Z — sdd-spec (re-run)

- Re-ran `/sdd-spec` on an existing spec (status was already `implementation-ready`; design.md
  unchanged since the first run). Revised implementation-spec.md in place — still 8 steps, same
  step shape, same atomic units, same `**Covers**` mapping. Status → implementation-ready (unchanged).
- Tree: `ccr-a72ccc3e-9kr7yq@4fdea96 ≡ origin/ccr-a72ccc3e-9kr7yq` (= `origin/main-dev@5142fc5` +
  docs-only commits; 0 behind `origin/main-dev`). Same call as the earlier sessions: TARGET would be
  `main-dev`, but the feature directory is only on this branch, so the checkout was not switched.
  No working-tree changes at boot. Discovery ran inline (no `codebase-discovery` subagent in this
  session); every anchor in the spec was re-read on this tree and matched.
- Changes, each closing an item of the 19:45Z impl-spec review (checkboxes flipped in that entry):
  - Step 6 (✗): the Verification grep now matches `process.env.AGENT_PUBLIC_URL` (a read), so the
    header comment may name the variable; the "five readers unchanged" check is now a grep for the
    five reads plus `git diff --quiet HEAD` on those five files.
  - Step 4: `grep -rn` on `app/`.
  - Step 2: the `packages/proto/gen/**` wildcard is replaced by the twelve committed
    well-known-type paths (TypeScript only); any other changed path is a stop-and-deviate.
  - Step 1: a `git rev-parse --verify` guard for the `buf breaking` baseline branch; stop if it is
    missing, never substitute another baseline.
  - Step 3: the D-34 skeleton is stated as an uncommitted working-tree stage whose files are in
    Step 4's `**Files**`; `app/peer_identity.py` is absent during the red.
  - Step 5: `vi.doMock` + dynamic import recorded as an allowed fallback; "`fetch` not called" is
    stated as a call-count assertion (`fails.md:4231-4234`).
  - Step 7: grep that the agent CI filter line carries both `peer_identity.py` paths.
- Not changed: the "more than 5 files" warning for Steps 3, 7, 8 — the shape is fixed by D-28; the
  reason is now stated in § Execution Summary. Its checkbox stays `[ ] unaddressed` for the operator.
- Added to § Step Dependencies: the 337 and 345 rebase-only overlaps from the review, and the
  feature-branch note below.
- Key codebase findings (this run):
  - `process.env.AGENT_PUBLIC_URL` has six read sites in the UI today (this route plus five); the
    bare name also appears in comments and `src/lib/oauthCallback*.ts`, so a bare-name grep cannot
    prove "readers unchanged".
  - Committed well-known-type output exists for TypeScript only (twelve files under
    `packages/proto/gen/ts/{,dist/}google/protobuf/`); Go and Python have none.
  - `/sdd-execute` BRANCH SYNC creates `feature/fix-mcp-tools-page` from `main-dev`
    (`templates/branch-sync.md` step 3), so the `buf breaking` baseline exists locally before Step 1.
  - `packages/otel/produced-signals.tsv` names one producer file per language for
    `rpc.server.duration`; the agent becoming a producer needs no registry row.
  - Host tools: `buf`, `sops`, `shellcheck`, `shfmt`, `doctl` are still not installed here; `jq`,
    `yq`, `docker` are.

## Open Threads (after the sdd-spec re-run — adds to the lists above)

- BRANCH SYNC branches from `main-dev`, so the feature directory must reach `main-dev` (PR #1588)
  before `/sdd-execute` starts.
- The impl-spec review predates this revision → re-run `/sdd-review fix-mcp-tools-page impl-spec`.

## Session 2026-11-19T20:02Z — sdd-spec revision 3 (step re-shape)

- Operator instruction: loop the impl-spec review until every warning is addressed.
- The ">5 files" warnings are cleared by splitting, not by exception: the spec now has 15 steps.
  Old → new: 1→1, 2→2, 3→3+4 (catalog tests) and 6 (telemetry tests), 4→5 (catalog server) and
  7 (telemetry), 5→8, 6→9, 7→10 (homelab + local compose) and 11 (DO + Playwright + CI filter),
  8→12 (root/shared docs), 13 (agent docs), 14 (UI docs), 15 (two business rules).
- Atomic units: 1+2, 3+4+5, 6+7, 8+9. Steps 10 and 11 each hold their own guard-first red→green.
- Design relation: D-28's step shape is advisory for `/sdd-spec`; order, content and the
  red-before-green rules are unchanged. Step 2 (generated stubs) keeps more than five files and
  states why it cannot be split.
- Step numbers in the earlier advisory review block above refer to the 8-step spec.

## Session 2026-11-19T20:10Z — sdd-review impl-spec loop (advisory), rounds 2–4

- Operator instruction: loop the review until every warning is addressed. Tree at the final round:
  ccr-a72ccc3e-9kr7yq@d0cf431 (= origin/main-dev@5142fc5 + docs-only commits for 360).
- Round 1 (8-step spec): 1 failure, 8 warnings → spec revision 2 (seven fixes) and revision 3
  (re-shape to 15 steps so no hand-written step lists more than five files).
- Round 2 (15 steps): 0 failures, 3 warnings (route literal in a test docstring; `conftest.py`
  line anchors drifting after Step 3; an uncheckable "never under ports:" claim) plus incomplete
  cross-feature notes → fixed (revision 4).
- Round 3: 0 failures, 2 warnings (PyYAML undeclared for two check commands;
  `resolve_grpc_port()` default untested) → fixed (revision 5: `uv run --with pyyaml`; three
  port-resolver cases in `tests/test_transport_config.py`, stub added to the skeleton). Overlap
  scan: no unaddressed item; no merge-order row required.
- Round 4: **0 failures, 0 warnings.** No Floor risk.
- Unresolved ✗ / ⚠ carried into execution: none.
- Accepted, design-backed exceptions (not warnings): Step 2 lists more than five files (generated
  stubs cannot be split); Steps 5 and 9 introduce a port / env var whose deployment files live in
  Steps 10 and 11 (guard-first red→green).
- Overlap findings (WARN-level, rebase only, all recorded in the spec's § Step Dependencies):
  345-authelia-sso, 337-metrics-host-provider-label, 357-fix-portfolio-internal-position.
- Note for execution: Step 15's "20 hits in 15 files" is a spec-time count; the three named
  survivors are the check.
- Round 4 did not re-read design.md, debate.md or acceptance.feature (round 3 did, against
  D-19..D-37 and each @AC); the round-3-to-4 change touched only Steps 3, 10 and 11.

## Session 2026-11-19 — sdd-execute (sequential, no checkpoints)

- Operator directive (chat, 2026-11-19): "merged, start execution in sequence mode, no checkpoints".
  Taken as the mode-entry and up-front confirmations; checkpoint reports are printed without a gate.
  Pushing `feature/fix-mcp-tools-page` authorized by the same directive.
- Tree: `feature/fix-mcp-tools-page` created from `main-dev@7439fba` (PR #1588 merged).
- Tooling setup (steps 1–15): uv ✓ 0.11 · ruff ✓ · python 3.13 ✓ · pnpm ✓ 9.15.9 · node v22.23.5
  (table says 24 — used as-is) · go 1.27 ✓ · docker ✓ (daemon started) · jq ✓ · openssl ✓ ·
  buf ✗ and Go codegen plugins ✗ → Docker codegen image (CI-equivalent) · shellcheck ✗ · shfmt ✗ ·
  sops ✗ · mikefarah yq ✗ (host `yq` is a different tool) → decided per step at Steps 10/11 ·
  doctl ✗ (operator gate only, not a step tool).
- Re-spec gate: branch is `main-dev` itself, so anchors equal the spec's (no re-spec).

### Step 1 — proto: Add package agent/v1 with AgentService.ListTools [done]
- Created `packages/proto/agent/v1/agent.proto` (unit with Step 2). Toolchain preflight on the
  untouched tree: empty `git diff packages/proto/gen/`. `buf lint` and `buf breaking` (against the
  local feature branch) pass; `check-otel-produced-signals.py` exit 0. TDD: N/A (proto contract).
- Files modified: `packages/proto/agent/v1/agent.proto`
- Deviations: Deviation 1 (buf ran inside the codegen image).

### Step 2 — proto-gen: Regenerate stubs for agent/v1 [done]
- Generated the fourteen `agent/v1` stub files (unit with Step 1); no well-known-type file changed;
  a second generation leaves `git diff --exit-code packages/proto/gen/` empty. TDD: N/A (generated).
- Files modified: the fourteen `packages/proto/gen/{go,python,ts,ts/dist}/agent/v1/**` paths in the
  step's `**Files**`.
- Deviations: Deviation 1.

# Context: sysadmin-db-write-role

**Feature**: `docs/roadmap/features/193-sysadmin-db-write-role/feature.md`
**Product Spec**: `docs/roadmap/features/193-sysadmin-db-write-role/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/193-sysadmin-db-write-role/implementation-spec.md`

---

## Session 2026-09-17 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from the user
  story. Feature number 193 (max existing 192 + 1).
- **Origin:** security-audit finding H-5 / DT-2 (`docs/reports/2026-09-16-trading-system-security-audit.md`).
  Operator chose the "systems-admin role" alternative over plain agent read-only, to preserve
  feature 169's FR-2 write capability behind a privilege no consumer can obtain.
- **Design intent recorded (to be debated in /sdd-design, full mode):** new SYSADMIN scope bit
  (`0x10`) mirrored in agent `app/scopes.py` + UI `src/lib/auth.ts`; a `sysadmin` role STRING mapped
  to that bit but deliberately kept OUT of the closed proto `Role` enum so consumer RPCs cannot
  express it; `manage-users.py` (direct DB write) the sole assignment path; `db_execute_sql` gates
  writes on SYSADMIN, reads stay at ADMIN (`0x04`).
- **No proto / migration / config-key changes** — a design strength (avoids the fails.md 2026-08-06
  C-10(a/d) enum-consumer trap entirely). Governance: 1 service owner + Security review focus.
- **Ledger traps noted in product-spec Open Questions:** fails.md 2026-08-06 (proto-enum append is
  never backend-only) and fails.md 2026-08-05 (never forward a blanket admin `x-access-scope` from an
  unauthenticated-for-admin entry point — derive the bit from verified JWT roles only).
- Open design questions captured: keep postgres-mcp `--unrestricted` vs restrict; superset vs
  orthogonal sysadmin; write/read classification (extend `_is_destructive`, gate INSERT too);
  enum-display gap in list_users/get_user; fate of the `confirm` flag.
- Next: `/sdd-review sysadmin-db-write-role product-spec`, then `/sdd-design sysadmin-db-write-role`
  (full mode, operator-requested).

## Session 2026-09-17 — sdd-review product-spec

- Product spec approved. Status: `draft` → `spec-ready`. Verdict: **PASS WITH WARNINGS** (0 blockers).
- First pass FAILed on two blockers, both fixed before this PASS:
  - **C-15 acceptance coverage** — FR-5/FR-6 had no covering scenario. Fixed: added `@AC-10`
    (FR-5 superset) and `@AC-11` (FR-6 auditable-via-script).
  - **Criterion 9 open questions** — 6 items were `- [ ]`. Fixed: all resolved to `- [x]`
    provisional decisions (each an explicit input to full `/sdd-design`, overturnable with rationale).
- **Warnings carried into `/sdd-design` (must be resolved/acknowledged there — P-03 no-silent-deviation):**
  - [ ] **C-10 / C-04 mirror enumeration** — FR-4's "no drift between mirrors" names only
    `app/scopes.py` (agent) + `src/lib/auth.ts` (UI), but the scope bitmap is ALSO
    defined/checked in `services/xstockstrat-config/src/grpc/authz.ts` (`ADMIN_SCOPE = 0x04`) and
    the Python servicers' `_has_admin_scope` (per `services/xstockstrat-agent/app/scopes.py:4-6`).
    Design MUST explicitly confirm whether those sites need the SYSADMIN bit or are correctly out
    of scope (the write-gate is tool-layer in the agent, so backend ADMIN-checkers may legitimately
    not need it) — so the "every site / no drift" parity claim is complete.
  - [ ] **AC-8 / AC-11 firm-up (NOTE-level)** — AC-8 uses "any write statement" (vs concrete SQL in
    siblings); AC-11's 2nd `Then` ("no admin surface presents … as non-privileged") is qualitative.
    Neither weakens the gate; pin exact values at `/sdd-spec` / test-design time.
- Overlap findings: only a rebase-only same-file overlap with feature 187 in `agent/app/tools.py`
  (no merge-order entry needed); no config-key / proto-field / migration-NNN collisions.
- Next: `/sdd-design sysadmin-db-write-role` (FULL mode, operator-requested).

## Session 2026-09-17 — sdd-design (Phase 0 recon + Phase 1 round 1, then OPERATOR PIVOT)

- **Phase 0 Recon** (full mode): wrote `recon.md` from 5 read-only discovery passes (agent, identity +
  manage-users.py, ui, config cross-repo scope-mirror enumeration, scenario-recon C-16 guard). Committed
  `dea933d`. Key grounded facts: exactly 2 roles→bitmap DERIVE sites; superset would leave every `& 0x04`
  CHECK site admitting sysadmin unchanged; no migration/config-key/proto-enum change; the ADMIN→SYSADMIN
  write move CHANGES launched `@AC-12`/`@AC-13` (feature 169); last-admin guard keyed on the `admin` role
  STRING vs a bit-superset is a correctness fork.
- **Phase 1 Round 1** debate ran (proposer + adversary, mediated). Proposer: 5-layer design (SYSADMIN=0x10
  in the 2 derivers, superset; `db_execute_sql` read-allowlist gate on `& 0x10`; `manage-users.py VALID_ROLES
  += sysadmin`; additive `bool is_sysadmin = 6` on `User`; drop `confirm`). Adversary verdict NEEDS WORK
  (no Floor breach): the load-bearing residual is that a **read-SHAPED statement can still perform writes via
  side-effect functions** (`SELECT dblink_exec('INSERT …')`, `nextval`, `pg_terminate_backend`) — parses as
  pure read nodes, so a tool-layer classifier structurally cannot catch it; an admin-only injected session
  keeps that narrow write vector. Also flagged: last-admin-guard string-vs-bit inconsistency; drop-`confirm`
  as unnecessary API churn.

- **>>> OPERATOR PIVOT (this session, authoritative WHAT change) <<<**
  At the round-1 gate the operator steered away from the in-ACL SYSADMIN-bit approach entirely:
  > "Separate the MCPs. Xstockstrat keeps trader/admin. Psql MCP is purely a system admin tool, with the
  > existing manual user setup but independent from xstockstrat auth login and ACL."
  Follow-up decisions (via design-gate clarification):
  1. **Move ALL `db_*` tools out** of `xstockstrat-agent` (all 9 + the postgres-mcp co-process) into a
     standalone **psql MCP** service → the prompt-injectable xstockstrat-agent has ZERO direct SQL access.
     This closes H-5 at the trust boundary (no route to SQL) rather than in a syntactic classifier, and
     resolves the round-1 read-shaped-write residual by construction.
  2. **Auth mechanism = deferred to the psql-MCP server library's capabilities** — the operator was unsure;
     the design MUST ground the auth model in what the actual library (postgres-mcp / crystaldba) supports,
     independent of xstockstrat's OAuth/JWT + access-scope ACL.
  3. **Separate authenticated endpoint** — its own path/port on the DO ingress, gated solely by its own
     credential (not the xstockstrat login).
- **Consequence (spec re-baseline required):** the sysadmin-role/`0x10`-bit/superset/`is_sysadmin`-field
  design (product-spec FR-1/FR-4/FR-5/FR-6) is **superseded**; the `@AC-12`/`@AC-13` ADMIN→SYSADMIN sign-off
  question is mooted (operator marked it "superseded"). The `sysadmin` scope bit no longer exists in this
  direction. Feature number 193 + branch `feature/sysadmin-db-write-role` retained (number immutable; slug
  kept as a broad "lock down privileged DB access" label though the mechanism changed).
- **Plan:** (a) targeted recon addendum on the psql-MCP extraction — library transport/auth capabilities
  (item the auth choice hinges on), deployment topology (docker-compose / supervisord / Dockerfile /
  `.do/app*.yaml` routing), and the feature-169 acceptance scenarios affected (tool-count invariant + the
  `db_*` scenarios that move); (b) re-baseline `product-spec.md` + `acceptance.feature` to the new WHAT;
  (c) re-run `/sdd-review product-spec`; (d) resume the FULL design debate against the new spec.
- This is the operator's explicit authority over the feature's WHAT (recorded here per C-11 / C-16 —
  the launched feature-169 `db_*` scenarios that this pivot changes/relocates are re-baselined with
  operator sign-off, not silently altered).

### Recon addendum — psql-MCP extraction (grounded)

- **postgres-mcp is `postgres-mcp` v0.3.0** (crystaldba), launched by supervisord as a co-process:
  `postgres-mcp --unrestricted --transport sse --port $POSTGRES_MCP_PORT` (`supervisord.conf:15`),
  localhost-bound (no `--host`), reached over an **unauthenticated** SSE channel
  `http://localhost:{port}/sse` (`postgres_mcp_client.py:26-43`).
- **The 9 `db_*` tools** are thin `@server.tool()` wrappers over `postgres_mcp_client.call_tool(...)`,
  admin-gated `& 0x04`, at `app/tools.py:1955-2077`.
- **Tool-count invariant is 49** (the feature-169 acceptance snapshot of 42 is stale). Removing 9 → **40**.
  CI-enforced surfaces: `services/xstockstrat-ui/src/lib/copilot.ts:20` (`COPILOT_MCP_TOOL_COUNT`),
  `services/xstockstrat-agent/tests/test_tools_endpoint.py:23-73` (exact name frozenset, db_* at `:64-72`),
  `app/tools.py:4,45-53` docstring, `services/xstockstrat-agent/CLAUDE.md:43,88-96`,
  `docs/runbooks/mcp-tools.md:3,37`, and the stale `acceptance/agent-postgres-mcp.feature:43-46`.
- **DB credential:** `POSTGRES_MCP_DATABASE_URI` env (docker-compose:552, `.do/app.yaml:310-312`,
  `.do/app.dev.yaml:307-309`), the DML-only `xstockstrat_agent` role (SELECT/INSERT/UPDATE/DELETE, no DDL)
  provisioned by `scripts/db-migrate.sh:178-200`. Pool budget: 1 direct connection (root `CLAUDE.md:238`;
  `test_deployment_env_vars.py:64` freezes direct-backend total = 9).
- **Deployment:** single agent container, supervisord runs both the MCP server (`mcp` SDK, Streamable HTTP
  :9000, OAuth 2.1 aud-bound JWT — reusable framework in `main.py`/`auth.py`/`oauth_server.py`) and the
  postgres-mcp co-process. DO: agent from a prebuilt GHCR image, `http_port 9000`, ingress `/agent`→agent,
  `/`→ui (`.do/app.yaml:10-21,254-315`). A separate endpoint = a NEW DO component with its own `http_port`
  + a distinct ingress `prefix` rule.
- **>>> LIBRARY-AUTH FINDING (resolves the operator's deferred auth question) <<<**
  Context7 (`/crystaldba/postgres-mcp`) confirms postgres-mcp's entire CLI is `--access-mode
  {unrestricted,restricted}` + `--transport {stdio,sse,streamable-http}` + host/port flags — and **NO
  authentication flag** of any kind. Its isolation model is network binding, not auth. Therefore a
  "separate AUTHENTICATED endpoint" **cannot be postgres-mcp exposed directly**; it must be **fronted by
  an auth layer** — a thin auth-proxy MCP (reuse the agent's `mcp`-SDK server shape with an INDEPENDENT
  out-of-band credential, NOT the xstockstrat OAuth/JWT flow) forwarding to a localhost postgres-mcp
  co-process. This is a grounded design constraint the debate will build on.
- **Feature identity:** keeping number 193 + branch `feature/sysadmin-db-write-role` (number immutable;
  slug retained as a broad "lock down privileged DB access" label though the mechanism changed to the
  MCP split).

### Alternative-library research (operator-requested) — feeds the design debate

- **pgEdge Postgres MCP (`pgedge/pgedge-postgres-mcp`)** has **native HTTP Bearer-token auth** built in
  (`PGEDGE_HTTP_ENABLED`/`PGEDGE_AUTH_ENABLED`/`PGEDGE_AUTH_TOKEN_FILE`; `POST /mcp/v1` requires
  `Authorization: Bearer <token>` → 401; `/health` open). The **token file IS the "manual user setup"** —
  operator-provisioned tokens, independent of xstockstrat identity/JWT/ACL. Directly satisfies FR-3/FR-4
  with no custom auth code. (Context7 `/pgedge/pgedge-postgres-mcp`.)
- **crystaldba postgres-mcp v0.3.0 has NO native auth** (confirmed) — isolation is network-binding only.
- Three grounded candidate architectures for the debate:
  - **A. crystaldba postgres-mcp + thin auth-proxy MCP** (reuse the agent's `mcp`-SDK shape, static token):
    most new code; keeps today's exact 9 tools + Python stack.
  - **B. pgEdge postgres-mcp (native Bearer auth)**: least code (config only); BUT different server
    (Go binary, `PGEDGE_*`, likely different tool set + "read-only protection" posture) → **write-support
    + tool-parity MUST be verified** by the proposer before adopting.
  - **C. crystaldba postgres-mcp + generic auth gateway** (oauth2-proxy / MCP gateway sidecar): no MCP
    code, adds gateway infra.
  - MCP remote-auth standard is OAuth 2.1+PKCE (Mar-2025 spec), but static API-key/Bearer is the
    sanctioned pattern for internal machine-to-machine tooling — which this psql MCP is. FR-3 is written
    library-agnostically, so all three fit the spec without further rewrite.

### Session 2026-09-17 — sdd-review product-spec (re-baselined spec) — PASS

- Verdict: **PASS WITH WARNINGS** (0 blockers, no Floor breach). Status `draft` → `spec-ready`.
- Criteria: all code-checkable claims verified against the repo (9 `db_*` names + location; 49→40 count;
  postgres-mcp no-auth launch; unauthenticated localhost SSE client; DML-only role; all 6 FRs covered).
- Advisory folded in: C-16 reconciliation now enumerates feature-169 **`@AC-9`** (tool count 42→40 +
  `db_` prefix) by ID, alongside `@AC-12`/`@AC-13` (removed) and `@AC-4` (relocated).
- **Overlap (WARN-only, no FAIL-level):**
  - [ ] **187-opportunities-pagination-drain** (`in-progress`) — same-file `tools.py` + `mcp-tools.md`,
    **disjoint functions → rebase-only**. 187 lands first; 193 rebases its `db_*` removals onto it.
  - [ ] **084-droplet-compose-deploy** (`spec-ready`) — `docker-compose.yml` + ingress: 084 restructures
    dev deployment around Caddy blue/green; **more than a trivial rebase**. Whichever lands second must
    reconcile the new `xstockstrat-psql-mcp` component + its ingress route into the other's topology.
    **Carry into `/sdd-design`** (deployment-topology decision) and revisit for a merge-order entry once
    both have impl-specs.
- Next: `/sdd-design sysadmin-db-write-role` (full) — debate the three candidate architectures above.

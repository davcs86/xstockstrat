# Context: sysadmin-db-write-role

**Feature**: `docs/roadmap/features/212-sysadmin-db-write-role/feature.md`
**Product Spec**: `docs/roadmap/features/212-sysadmin-db-write-role/product-spec.md`
**Implementation Spec**: _none — feature was demoted/canceled before `/sdd-spec` ran_

---

> **Import & renumber provenance (2026-09-26).** This demoted/canceled feature lived only on the
> `feature/sysadmin-db-write-role` branch and was never merged to `main-dev`. It was imported to
> `main-dev` via `/sdd-sync` to preserve the rejected-architecture record, and **renumbered 193 → 212**
> to resolve a directory-number collision with the launched `193-fix-blend-queue-fundamentals-universe`.
> The source branch was deleted after import. **Caveat:** the historical narrative below refers to this
> feature as "193" (its design-time number) and cross-references other features by the numbers in effect
> on the branch (e.g. `084 → 193`, `@feature-193`, "feature 211 = remove-agent-postgres-mcp"); those are
> preserved as-written and may not match current `main-dev` numbering. The canonical number is now **212**.

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

### Session 2026-09-17 — sdd-design Phase 1 (resumed, psql-MCP-split) — Round 1

- **Round 1** debate ran (proposer + adversary, mediated) against the re-baselined spec.
- Proposer: **Option A** — new `services/xstockstrat-psql-mcp/` = the agent's `mcp`-SDK Streamable-HTTP
  scaffold (`main.py:63-66,124-128`) with the OAuth gate swapped for a static-bearer check, fronting a
  localhost postgres-mcp co-process; native tool names, db_ prefix + confirm dropped; new DO component +
  `/psql` ingress; DML-only role kept; tool count 49→40. Chose A over C (native MCP protocol fidelity,
  one owned boundary, avoids re-adding a reverse-proxy container post-nginx). Flagged its own risk:
  nine hand-registered passthrough tools drift vs a transparent proxy.
- Adversary verdict **NEEDS WORK** (no Floor breach; F-07/F-06/F-01 explicitly cleared). Headline: the
  drafted mechanism (public `/psql` + SINGLE static bearer + `--unrestricted` + no confirm) trades H-5's
  injection vector for an internet-facing-static-secret vector (leaked token → arbitrary writes/DoS on
  prod). Plus: single token has no per-actor attribution/rotation; no audit trail; nine wrappers drift
  (transparent proxy is less code + zero drift); **C-16 disposition omitted 6 of 13 launched
  @feature-169 scenarios** (@AC-1/2/3/8/10/11); dropping @AC-12/@AC-13 conflates the mooted security
  gate with a still-valid human fat-finger net; `test_deployment_env_vars.py` becomes vacuously green;
  C-05 env-secret rationale must be recorded. Ledger: fails.md 2026-08-05 COMPLIED (no scope
  forwarding — credit); insights 092 argues for per-operator (not shared) credentials.

- **>>> OPERATOR DECISIONS at the Round-1 gate <<<**
  1. **Reachability = PUBLIC authenticated endpoint** (own `/psql` ingress route), consistent with the
     earlier pick — adopted WITH mandatory compensating controls and this **recorded accepted-risk
     sign-off**: the operator accepts that a public arbitrary-SQL-write endpoint's credential is the
     internet-facing boundary, mitigated by per-operator tokens + rate-limiting + TLS + full audit
     logging + ≥256-bit generated tokens + no-token-in-logs. (C-18 "recorded trade-off = compliance".)
  2. **Credential model = PER-OPERATOR TOKEN FILE** — multiple provisioned tokens, each mapped to an
     operator identity for the audit log; per-operator revocation/rotation. (Borrows the pgEdge
     token-file auth model, decoupled from its rejected tool model; satisfies insights 092.)
- **Folded into Round 2 as decided refinements (no fork):** transparent MCP proxy (not 9 hand-registered
  wrappers); per-statement audit logging (statement + operator + source IP + timestamp); full per-ID
  C-16 disposition of all 13 @feature-169 scenarios (relocate w/ @feature-169 provenance into a new
  xstockstrat-psql-mcp suite; delete removed ones citing this sign-off); keep a lightweight fat-finger
  write-confirmation on destructive DML (explicitly NON-security); relocate/re-author the feature-169
  env-var tests; record the C-05 env-secret rationale + the fails.md-2026-08-05 compliance; ≥256-bit
  token + rate-limiting + no-token-in-logs; add an operator runbook; coordinate the `/psql` route with
  feature 084's Caddy topology (merge-order once both have impl-specs).

## Session 2026-09-17 — sdd-design (Phase 1 Round 2 + DESIGN APPROVED)

- **Round 2** consolidated the design; **Round-2 adversary verdict NEEDS WORK (no Floor breach)** — its
  objections were coverage-completeness + accepted-risk hardening, not architectural. Resolved before
  approval: SDK transparent-proxy capability CONFIRMED viable (Context7 `/modelcontextprotocol/python-sdk`
  — low-level `Server` `on_list_tools`/`on_call_tool` constructor handlers return tools with explicit
  name/description/inputSchema → zero-drift proxy, no per-tool hand-shaping fallback needed); the
  compensating-controls coverage gap closed by adding **FR-7/FR-8 + @AC-11..@AC-14**; **@AC-8 re-authored
  credential-only** (public endpoint ⇒ a network route exists; the per-operator credential is the
  boundary); durable non-optional audit sink adopted over stdout/OTEL-gated; C-05 env-secret rationale
  and fails.md-2026-08-05 compliance recorded in design.md.
- **>>> DESIGN APPROVED at the Round-2 gate <<<** — operator chose "**Approve, but WAIVE the IP
  allowlist**": accept a **public arbitrary-origin `/psql`** endpoint with the per-operator token as the
  sole internet-facing boundary (recorded accepted-risk), mitigated by FR-7 (per-operator tokens +
  durable audit + DML-only role) + FR-8 (rate-limiting/429 lockout + TLS + no-token-in-logs). The
  trusted-IP allowlist is recorded as an available future hardening, not adopted.
- **Chosen approach:** standalone `services/xstockstrat-psql-mcp/` = the agent's `mcp`-SDK
  Streamable-HTTP scaffold with the OAuth gate replaced by a per-operator-token gate + a transparent
  low-level-Server proxy over a localhost `postgres-mcp` co-process; native tool names; `execute_sql`
  keeps a non-security fat-finger confirm; new DO component + public `/psql` ingress; DML-only role kept;
  agent stripped of all 9 db_* tools + postgres-mcp (tool count 49→40). No proto/config/migration change.
- **Rejected:** in-ACL SYSADMIN bit (can't close read-shaped side-effect writes); Option C gateway
  (net-new proxy container, boundary in 3rd-party config); Option B pgEdge (read-only query_database +
  NL/RAG tools + LLM dep — fails tool-parity); 9 hand-wrappers (vendor drift); single shared token
  (no attribution); mandatory IP allowlist (operator-waived); stdout/OTEL-only audit (can silently no-op).
- **Open risks carried to /sdd-spec (design.md Open Risks):** [ ] public-endpoint accepted-risk mitigated
  by FR-8; [ ] rate-limiter topology (client-IP behind ingress + instance_count=1); [ ] durable audit-sink
  choice; [ ] token revocation RTO in the runbook; [ ] feature-084 deployment coordination (merge-order
  084→193, 187→193).
- Constitution rules touched: C-05/C-08/C-10/C-14/C-15/C-16/C-18; F-01/F-02/F-03/F-06/F-07 all honored.
  No Floor breach.
- Status: `spec-ready` → `design-approved`. Next: `/sdd-spec sysadmin-db-write-role`.

## Session 2026-09-17 — sdd-review product-spec (re-validation of the FR-7/FR-8 augmentation)

- Operator-requested AI review of the spec augmented AFTER design approval (FR-7/FR-8, @AC-11..@AC-14,
  @AC-8 re-authored). Verdict: **PASS WITH WARNINGS** (0 blockers, no Floor breach). Treated as a
  **re-validation** — status left at `design-approved` (not regressed to `spec-ready`).
- Every FR (incl. FR-7/FR-8) has ≥1 well-formed covering scenario; all Open Questions `[x]`; all
  re-verified code-checkable claims hold (9 db_* names + tools.py; 49→40 via copilot.ts + test frozenset;
  postgres-mcp 0.3.0 pin `uv.lock:1399`; DML-only role `db-migrate.sh:193`, no DDL; no proto/config/
  migration deltas; C-16 all 13 feature-169 scenarios enumerated in design.md).
- Advisory fixed: **FR-4** reworded — dropped the stale "no network route" clause (contradicted by the
  waived-allowlist public endpoint) → now "no psql-MCP credential; the credential it does not hold is
  the boundary," coherent with @AC-8/FR-8. Also corrected the Open-Question @AC attribution (`@AC-8` =
  db_ prefix, `@AC-9` = tool count 42).
- Overlap: not re-scanned — the augmentation added no new files/config-keys/protos/migrations, so the
  prior verdict stands (187 rebase on tools.py/mcp-tools.md; 084 deployment coordination on /psql+Caddy).
- Next: `/sdd-spec sysadmin-db-write-role`.

## Session 2026-09-25 — operator topology amendment (post-approval, design unchanged in mechanism)

- Operator directed a deployment-topology change at the /sdd-spec juncture. Decisions:
  1. **No new DO App Platform service/component.** The psql MCP is an **isolated `supervisord`-managed
     container** (own process group + postgres-mcp co-process + isolated env).
  2. **Deploy on the feature-084 droplet topology**, run **on-demand via `docker start/stop`** — the
     operator brings it up for a DB-admin session and stops it after (FR-9); **no idle attack surface**.
  3. **Internal-only** — no public ingress route; reached out-of-band (SSH / port-forward tunnel).
  4. **Retain per-operator token + audit** (FR-7) as defense-in-depth + attribution.
- **Grounded finding (why droplet, not App Platform):** DO App Platform cannot scale a component to
  zero (`instance_count` min = 1; verified via docs), and its "Scale-to-Zero / Inactivity Sleep" is
  request-driven for ingress services — neither gives operator-controlled on/off for a no-ingress
  worker (only a spec-edit + `doctl apps update` redeploy would). The droplet's `docker start/stop`
  gives true ephemeral on/off. So the earlier "public `/psql` endpoint + waived IP-allowlist" decision
  is **superseded/moot** (no public route at all).
- **This SUPERSEDES** prior turns' decisions: (a) "new standalone DO service" → isolated droplet
  container; (b) "public authenticated `/psql` endpoint" → internal-only out-of-band. The **core
  mechanism is unchanged** and already debated across 2 rounds (thin auth-proxy MCP + transparent
  low-level-`Server` proxy over localhost postgres-mcp + per-operator token file + durable audit +
  DML-only role + agent stripped to 40 tools).
- **Process note:** treated as an operator-directed deployment amendment to the approved design (not a
  re-debate) — the change is strictly toward MORE isolation (internal-only + ephemeral). Residual risks
  recorded (not silent) in `design.md` Open Risks: same-droplet docker-network route **while running**
  (token-gated + ephemeral), on/off operational discipline (idle auto-stop as a follow-up), rate-limiter
  single-instance/client-IP, durable audit sink, revocation RTO (now a `docker restart`), and the **hard
  084 dependency**. Amended `product-spec.md` (FR-2/FR-4/FR-6/FR-8 + new FR-9, Affected Services, Open
  Questions), `acceptance.feature` (@AC-4/@AC-8/@AC-13 reworded + new @AC-15 ephemerality), `design.md`
  (Chosen Approach + Rejected Alternatives + Open Risks + amendment header), `recon.md` deployment note.
  Status stays `design-approved`. Next: `/sdd-spec` — must ground the compose block against 084.

## Session 2026-09-25 — merge main-dev + tool-count correction (49→40 ⇒ 52→43)

- Per operator ("merge latest main-dev, then re-review the amended design"): merged `origin/main-dev`
  (46 commits — promotions + features 200–206) into `feature/sysadmin-db-write-role` (merge commit
  `0886486`). Only conflict was the append-only `docs/roadmap/ledger/insights.md` tail — resolved
  keeping both (my 2026-09-17 entry first, then main-dev's 09-19…09-24 entries).
- **Tool-count drift caught by merging first (the point of the sequence):** the agent's advertised tool
  count on the merged tree is now **52** (`copilot.ts:21`, `tools.py:4` "Fifty-two", `mcp-tools.md`
  "fifty-two") — up from 49 pre-merge (features like 204 `query_bars`/`query_fundamentals` added tools).
  The 9 `db_*` tools are still present, so the post-removal target is **52 − 9 = 43**, not 40. Updated
  the live artifacts (product-spec FR-1 + Affected Services + @AC-9 note; acceptance @AC-1/@AC-2;
  design.md; recon.md; feature.md reviewers) from `49→40` to `52→43`. Historical context.md session
  entries left as-is (append-only log). `/sdd-spec`/`/sdd-execute` must **re-derive the exact count
  against main-dev at execute-time** (insights 2026-09-23 — reserved ids/counts move as siblings merge).
- **084 hard dependency check:** feature 084 (`droplet-compose-deploy`) is still `spec-ready` on the
  merged tree — not yet implemented — so 193's deployment steps remain blocked-on-084 (as designed).
- Next: re-run `/sdd-review product-spec` on the amended + merged spec.

## Session 2026-09-25 — sdd-review product-spec (amended + merged) — PASS

- Verdict: **PASS WITH WARNINGS** (0 blockers, no Floor breach). Re-validation — status left at
  `design-approved` (not regressed). Both passes run against the freshly-merged main-dev tree.
- **Criteria (spec-reviewer):** all code-checkable claims verified on the merged tree — **tool count
  52→43 correct** (`copilot.ts:21`=52, `tools.py:4` "Fifty-two", `test_tools_endpoint.py` lists 52 incl.
  the 9 db_* still live; no residual 49/40), DML-only role `db-migrate.sh:191-199` (no DDL grant),
  postgres-mcp `uv.lock`=0.3.0, **084 = spec-ready** (dependency legitimate), C-16 disposition matches
  the actual 13-scenario `agent-postgres-mcp.feature`. Every FR (incl. FR-9) covered by a well-formed
  `@AC-*`. Advisory: @AC-13 rate-limit was qualitative → firmed up ("configured threshold/window; exact
  values pinned at /sdd-spec/config"). Informational: full per-@AC C-16 reconciliation correctly lives
  in design.md.
- **Overlap (feature-overlap):** COLLISIONS FOUND, none FAIL-level (193 has no config/proto/migration
  deltas). **084 → 193 is a hard deployment dependency** → **added a blocking row to `merge-order.md`**
  (slug-qualified). 187 → 193 is rebase-only (soft note folded into that row). Low-risk shared context
  with 196/188/189 (disjoint); tool-count surfaces are 193-exclusive.
- **merge-order.md:68 disambiguation:** the spec-reviewer flagged a "stale 193" at row 68; I verified
  against the file — that bare `193` is inside the `200→199` row's reason describing an
  `_compute_opportunities`/`list_opportunities` cohort, i.e. the **launched `193-fix-blend`** (NNN
  collision), NOT this feature. Left untouched (correct); noted the disambiguation in the new row.
- Status stays `design-approved`. Outstanding operator choice unchanged: run `/sdd-spec` now (code
  steps speccable; deploy steps blocked-on-084) vs hold until 084 lands.

## Session 2026-09-26 — DEMOTED (operator swerve: eliminate, don't separate)

- **Status: `design-approved` → `demoted/canceled`.** Operator directive: "remove all postgres MCP,
  they are inherently insecure." That invalidates this feature's core premise. This feature's
  chosen design privilege-separated the DB tooling into a standalone `xstockstrat-psql-mcp` that is
  **itself a transparent proxy over a localhost postgres-mcp** (crystaldba `postgres-mcp` 0.3.0).
  Hardening a wrapper around a dependency now judged inherently insecure is the wrong posture —
  **the surface is eliminated instead.**
- **Superseded by:**
  - **feature 211 (`remove-agent-postgres-mcp`)** — removes the 9 `db_*` tools + the postgres-mcp
    co-process from `xstockstrat-agent` outright (tool count 52→43), **no replacement service**, no
    per-operator token, no audit sink, no transparent proxy, **no 084 dependency**. Operators run
    admin SQL out-of-band (direct `psql`/DB client via SSH/doctl/bastion), documented in a runbook.
  - **feature 208 (`psql-db-role-grant-hardening`)** — rescoped from "least-privilege grants for the
    psql-MCP's role + protect its audit sink" to **teardown of the now-orphaned `xstockstrat_agent`
    DB role** (postgres-mcp was its only consumer) + an audit that no remaining role can write
    integrity-critical tables (ledger/identity/config).
- **Disposition of this branch:** no PR was ever opened for `feature/sysadmin-db-write-role` (SDD flow
  stopped at `design-approved`, pre-`/sdd-spec`). The branch is **not merged to `main-dev`**; its
  design.md/recon.md are retained on-branch as rejected-alternative memory. The generalizable lesson
  ("when a fronted dependency is inherently insecure, eliminate the surface rather than building a
  hardened wrapper — attack-surface minimization / YAGNI over privilege-separation scaffolding") is
  distilled into the Ledger on the security-audit branch so it survives on `main-dev` without merging
  this branch.
- **Moot artifacts:** the `084 → 193` hard merge-order row is voided (annotated in `merge-order.md`);
  the 084 hard dependency is gone with the container.

# Context: remove-agent-postgres-mcp  (archived 2026-10-14)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-10-14 — /sdd-archiver

**What**: Removed the whole DB-over-MCP surface from `xstockstrat-agent`: the nine `db_*` tools, the postgres-mcp co-process and SSE client, deploy wiring, three direct Python deps (`httpx2`, `postgres-mcp`, `sqlglot`), the agent's connection-pool budget row (direct total 9→8) and a dead role-provisioning block in `db-migrate.sh`. Tool count 52→43. No replacement SQL-over-MCP surface; admin SQL moved to the out-of-band runbook `docs/runbooks/operator-db-access.md`. Shipped as one sequential integration PR (#1199), promoted in #1205 (launched 2026-10-01). Supersedes demoted 212; closes security-audit H-5/DT-2 by elimination.

**Why (irrecoverable rationale)**:
- The operator judged postgres-mcp inherently insecure across both the crystaldba and pgEdge families, so hardening a wrapper (212's design) was rejected in favour of eliminating the surface.
- No `xstockstrat_agent` role ever existed in a live DB: `db-migrate.sh` created it only if `POSTGRES_MCP_AGENT_PASSWORD` was set, and it never was (`[skip]` path always ran). So feature 208 (drop/revoke the role) was demoted as unnecessary, deleting the provisioning code was the whole DB-side teardown, and there is no 084 dependency. FR-3's wording "remove the agent's direct DB connection" is misleading: recon found NO direct DB pool/connection code in the agent's `app/` — only the co-process used the role, and not even that in practice.
- The 13 feature-169 scenarios were a recorded C-16 CHANGE; the operator's 2026-09-26 directive is the sign-off. Standing operator authorizations that lived only in session prose: "always address advisory-review warnings before moving forward", and "all the way to code + PRs" (covering sequential-mode entry).

**Rejected alternatives**:
- Hardened standalone psql-MCP / proxy over postgres-mcp (212) — dependency judged inherently insecure.
- Invert the 13 feature-169 scenarios in place — 13 awkward "does-not-exist" scenarios duplicating 214's own @AC set (C-18) and a durable file named for a capability that no longer exists; delete-and-promote chosen.
- Leave `sqlglot`/`httpx2` installed — lost as dead deps (but see the `httpx2` deviation).
- Atomic single-commit deploy edit — superseded by caller-first ordering; per-step PRs — rejected for one cohesive removal with coupled invariants (count mirrors, deploy pipeline), so one integration PR in sequential mode.

**Scars & gotchas**:
- Teardown-only discovery: `docs/patterns/database.md` § "Application-Level Postgres Roles" still documented the removed role and the `POSTGRES_MCP_DATABASE_URI` secret; no spec step listed it, only the teardown grep found it (whole section removed — that role was its only entry).
- The old feature-169 `@AC-9` asserted a stale total of 42 vs the live 52; the executable name-set guard in `test_tools_endpoint.py` is the real guard, and the tool-count guarantee has no durable Gherkin home (only `@AC-1`, `@AC-2`, `@AC-6` were promoted; `@AC-3/4/5` deliberately not).
- Under-enumerated removal sites: the product-spec review found six (`postgres_mcp_client.py`, supervisord block, three deploy workflows, three extra tests), recon two more test files; a wrong cite (`deploy.yml:14` is the `secrets:` block header; the input decl is `:67-72`) was caught at spec time. The word "postgres" legitimately survives in the runbook, the removal record and git history, so removal is verified by symbols ceasing to exist (name-set equality, deleted file, failed import, `bash -n`), never `! grep postgres`.
- Deploy pipeline: `POSTGRES_MCP_AGENT_PASSWORD` traverses caller pass-through → reusable-workflow input → env injection → a Python `.replace()` into app-spec placeholders. Caller-first removal is safe because the input is `required: false` and callers pass secrets by name, not `secrets: inherit`. GitHub repo secrets `DEV_/PROD_POSTGRES_MCP_AGENT_PASSWORD` cannot be deleted by code — an operator must remove them out-of-band (harmless if left). Negative confirmations from the trace: `scripts/do-inject-prod-secrets.py`, `prod-up.yml`, `docs/setup/digitalocean.md`, `docs/*/infra-cost-reduction.md` carry no postgres-mcp reference. Latent feature-169 gap: the `.do/app.yaml` placeholder `YOUR_PROD_POSTGRES_MCP_AGENT_PASSWORD` was never wired into `do-inject-prod-secrets.py`; removal cleans it up.
- Test treatment: `test_dep_smoke.py` import tests had to be deleted (a bare `import` fails at collection once the dep leaves); `test_supervisord_conf.py` inverted to one absence assert; the inverted budget assertion must match the row text `xstockstrat-agent (postgres-mcp)`, not a bare service name (root `CLAUDE.md` still names `xstockstrat-agent` elsewhere). Two lockstep update sets (C-10): tool-count surfaces (`copilot.ts`, agent `CLAUDE.md`, `mcp-tools.md`, `tools.py` docstring, name-set test) and connection-budget surfaces (root `CLAUDE.md` row, direct total 9→8, effective ~14→~13, `test_deployment_env_vars.py`). Impl-spec review caught a step-order bug (covering test before the budget edit it covers → swapped Steps 8↔9) and missing `--cov-fail-under=40` gates on Steps 4/6 (coverage was 79.56%).
- Numbering: created as 211, PR stranded when #1185 merged only its first commit, a sibling took 211 → renumbered to 214 with cross-refs repointed. Two test-file deletions were committed under Step 1 (staged with `git rm`) — granularity only, squash collapses it.

**Permanent deviations**:
- design: `httpx2` is a sole-use orphan and uninstalls (so `test_httpx2_importable` would fail at collection) → shipped: `httpx2` stays installed and in `uv.lock` as a transitive dependency of `mcp>=2.0.0` (`uv tree --invert`); the direct declaration was removed and the test deleted because "we no longer own the declaration", not "it fails". `uv lock` also pruned postgres-mcp's transitive deps (typer, tzdata, urllib3, yarl). The distinct `httpx` is kept.
- scope named no `docs/patterns/database.md` edit → shipped: whole "Application-Level Postgres Roles" section removed (teardown outranks step scope).
- design: promote @AC-1/@AC-2/@AC-6 into `services/xstockstrat-agent/acceptance/` → shipped as `remove-agent-postgres-mcp.feature` (`@feature-214`) with feature 169's suite deleted; the "archiver never deletes" C-16 clause was read as scoped to `/sdd-archiver`, not a deliberate capability removal with recorded sign-off.

**Cross-feature signal**: the 169 → 193 → 212 → 214 arc (add embedded SQL tool → privilege-separated proxy → dependency judged untrustworthy → eliminate; `insights.md` 2026-09-27). Sibling security follow-ons 207 (`extract_*` SSRF), 209 (sandbox OS isolation), 210 (mTLS) are independent. Soft rebase overlaps with 187 and 217 (`tools.py`, `mcp-tools.md`, agent `CLAUDE.md`, disjoint regions) and 084.

**Deferred follow-ons**: operator out-of-band deletion of the `DEV_/PROD_POSTGRES_MCP_AGENT_PASSWORD` repo secrets; a broader "no DB role can write integrity-critical tables" grant audit (separate standalone feature if wanted); no replacement DB tooling planned; candidate to fold the cross-branch max rule into `docs/runbooks/feature-workflow.md` § Feature Numbering (`fails.md:2386`).

**Ledger entries written**: insights.md (1), fails.md (2) — see the 2026-10-14 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: optional PLAT-*: the agent exposes no SQL-executing MCP tool, co-process or DB credential (already enforced by the promoted feature and the name-set test); `httpx2` is a transitive dependency of `mcp` in the agent — do not treat it as removable.
**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at 09ec8d9a.

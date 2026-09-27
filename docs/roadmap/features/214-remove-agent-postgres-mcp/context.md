# Context: remove-agent-postgres-mcp

**Feature**: `docs/roadmap/features/214-remove-agent-postgres-mcp/feature.md`
**Product Spec**: `docs/roadmap/features/214-remove-agent-postgres-mcp/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/214-remove-agent-postgres-mcp/implementation-spec.md`

---

## Session 2026-09-26 — sdd-story (supersedes demoted feature 212 / formerly 193)

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from operator
  directive: **"remove all postgres MCP, they are inherently insecure."**
- **Supersedes feature 212 (`sysadmin-db-write-role`, demoted; originally numbered 193).** 212's
  chosen design privilege-separated the DB tooling into a standalone `xstockstrat-psql-mcp` that was
  itself a transparent proxy over postgres-mcp. The operator judged postgres-mcp (crystaldba **and**
  pgEdge families) inherently insecure, so hardening a wrapper around it is rejected — the surface is
  **eliminated**. This closes H-5 / DT-2 by removal rather than separation.
- **Scope = pure removal**, drawn from the "extract-out" half of 212's design minus the "build a new
  home" half:
  - Remove the 9 `db_*` tools + postgres-mcp co-process from `xstockstrat-agent`; tool count 52 → 43.
  - Remove `postgres-mcp` from `pyproject.toml`/`uv.lock`; remove `POSTGRES_MCP_*` wiring and the
    co-process from the container / docker-compose / `.do/app*.yaml`.
  - Remove the agent's direct DB connection + its connection-pool budget row in root CLAUDE.md.
  - **No replacement SQL-over-MCP surface.** Out-of-band `psql` via SSH/doctl/bastion, documented in
    a runbook (FR-4).
- **C-16 CHANGE sign-off (P-05):** removal **changes** feature 169's 13 promoted `agent-postgres-mcp`
  business-rule scenarios. Operator's 2026-09-26 directive is the recorded sign-off; the 13 scenarios
  are removed/inverted in the same PR.
- **Feature 208 demoted (2026-09-27):** originally 208 was to drop/revoke the orphaned
  `xstockstrat_agent` role. But that role was only **conditionally** provisioned by
  `scripts/db-migrate.sh:169-203` (feature 169), gated on `POSTGRES_MCP_AGENT_PASSWORD` — a password
  never set in the live environments, so the `[skip]` path always ran and the role was **never
  created**. There is no live-DB role to drop, so 208 is unnecessary and demoted. This feature (214)
  absorbs the only real cleanup: **deleting the dead provisioning block** (and its
  `POSTGRES_MCP_AGENT_PASSWORD` gate) from `db-migrate.sh` as part of removing all postgres-mcp wiring
  (FR-3). No `214 → 208` ordering remains.
- **No 084 dependency** — the demoted 212's on-demand droplet container is gone; this is a removal
  with no new service and no deployment substrate need.
- Baseline facts to re-derive at recon/execute: `copilot.ts` `COPILOT_MCP_TOOL_COUNT` (was 52),
  `app/tools.py` docstring ("Fifty-two tools"), the 9 `db_*` names, `postgres-mcp==0.3.0` in `uv.lock`,
  and the `agent-postgres-mcp.feature` 13-scenario count. Open forks in product-spec § Open Questions.
- **Ledger:** the generalizable lesson ("when a fronted dependency is inherently insecure, eliminate
  the surface rather than build/maintain a hardened wrapper — attack-surface minimization / YAGNI over
  privilege-separation scaffolding") is appended to `docs/roadmap/ledger/insights.md`.

## Session 2026-09-27 — renumbered 211 → 214 (NNN collision)

- **This feature was created as 211** in the security-audit session but its PR was stranded: the
  Phase D backlog PR (#1185) merged only its first commit (207–210), so this feature's commit never
  reached `main-dev`. In the interim, other sessions merged `211-edgar-fundamentals-enrichment` to
  `main-dev`/`main` (now `implementation-ready` and promoted), taking the number **211**.
- Per `docs/runbooks/feature-workflow.md` § Feature Numbering, the racing loser renumbers to the next
  free NNN. Global `max(existing NNN)` across all origin branches was **213**, so this feature moved to
  **214**. Slug (`remove-agent-postgres-mcp`) and content are unchanged; every self/cross reference was
  repointed (211 → 214; the superseded separation feature 193 → its imported/demoted number 212).
- Lesson recorded (see `fails.md` entry this date): compute the next NNN as `max` across **all origin
  branches**, not just the local working tree — an in-flight sibling on another branch can claim the
  number before your PR merges.

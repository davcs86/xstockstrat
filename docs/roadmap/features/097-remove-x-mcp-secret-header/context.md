# Context: remove-x-mcp-secret-header

**Feature**: `docs/roadmap/features/097-remove-x-mcp-secret-header/feature.md`
**Product Spec**: `docs/roadmap/features/097-remove-x-mcp-secret-header/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/097-remove-x-mcp-secret-header/implementation-spec.md`

---

## Session 2026-08-02T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- Requester instruction: run the full SDD pipeline to completion and land as **one PR**, no
  intermediate per-step PRs — use `/sdd-execute ... sequential` at execute time.
- Codebase-discovery agent confirmed: no receiving service enforces `x-mcp-secret` in current
  source (matches root CLAUDE.md's own claim); `docs/runbooks/mcp-tools.md` and
  `docs/setup/digitalocean.md` both contain stale claims of active downstream enforcement — drift
  to correct in this feature.
- **Critical finding surfaced during recon (not a silent guess — flagging per CLAUDE.md behavior
  #1):** `MCP_AGENT_SECRET` is dual-purposed. Besides the `x-mcp-secret` header, it's independently
  used as the HMAC signing key for the agent's stateless OAuth `txn` blob
  (`services/xstockstrat-agent/app/oauth_server.py::_sign_txn`/`_verify_txn`), documented as
  invariant `AGENT-6` in `services/xstockstrat-agent/docs/context-constitution.md`. The env var
  itself must NOT be deleted — only the header-emission code and the receiving-side infra plumbing
  that served no purpose. Locked into product-spec FR-2/FR-3 and Out of Scope.
- **Branch deviation (explicit, not silent):** this session's harness assignment requires
  developing and pushing on `claude/remove-x-mcp-secret-header-icog9j` and landing a single PR
  from that branch to `main-dev` — it does not permit creating/pushing a separate
  `feature/remove-x-mcp-secret-header` branch. Root CLAUDE.md's normal SDD convention
  (`feature/<slug>` branch, integration PR from there) is followed in every other respect (one
  commit per step, single integration PR, no intermediate PRs) except the branch name itself. All
  SDD artifacts in this directory are authored and committed on
  `claude/remove-x-mcp-secret-header-icog9j`. `feature.md`'s `Development Branch` field reflects
  this.

## Session 2026-08-02T00:10:00Z — sdd-review product-spec

- Criteria review (spec-reviewer): **PASS WITH WARNINGS**. One warning: FR-3/FR-4 omitted
  `.env.example` and `scripts/setup-env.sh` from the doc-correction scope, even though both carry
  the same stale "x-mcp-secret downstream enforcement" narrative (`.env.example:38,40`;
  `scripts/setup-env.sh:197-225`) — meaning Acceptance Criterion 1 (`grep -rn "x-mcp-secret"` →
  zero hits) would not have passed as originally scoped. **Fixed**: FR-4 now names both files and
  requires rewriting (not just softening) their header-enforcement prose while keeping the
  `MCP_AGENT_SECRET` prompt/wiring itself (still needed for OAuth signing).
- Overlap scan (feature-overlap): **WARN-only, no FAIL-level blockers** (no proto/config-key/schema
  changes in this feature, so no hard-collision path applies). Three same-resource WARN overlaps
  found, all textual/rebase-risk, none requiring a merge-order.md block per this repo's own
  precedent for similar shared-surface features:
  - `services/xstockstrat-agent/app/client.py` vs `085-mcp-python-sdk-v2-upgrade` (code-completed)
    — disjoint line ranges (`_metadata()` at :28 vs `set_config`/`list_config_keys` edits at
    :888-925).
  - `docs/runbooks/mcp-tools.md` vs `094-fix-mcp-server-input-validation` (code-completed) —
    different sections of the same doc.
  - `.do/app.dev.yaml` `MCP_AGENT_SECRET` block vs `084-droplet-compose-deploy` (spec-ready, not
    yet implemented) — **highest-risk of the three**: 084's FR-5 also touches
    `MCP_AGENT_SECRET`'s provisioning mechanism in the same file. 097 only changes *which service
    blocks* carry the var (drops notify/ingest/analysis, keeps agent); 084 changes *how* it's
    provisioned. No logic conflict today since 084 hasn't landed, but flag for a rebase check at
    `/sdd-spec` time and note in `merge-order.md` once this feature reaches
    `implementation-ready`, per the reviewing agent's recommendation.
- Status: draft → spec-ready.

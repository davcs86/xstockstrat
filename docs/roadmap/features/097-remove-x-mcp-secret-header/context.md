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

## Session 2026-08-02T00:20:00Z — sdd-design (quick, 1 round)

- **Phase 0 Recon**: spawned 4 parallel `codebase-discovery` agents (agent, notify, ingest,
  analysis) → wrote `recon.md`. Key findings beyond the story-time recon: `auth.py::_metadata()`
  has **two** call sites (`validate_bearer_jwt` AND `validate_bearer_claims`, not just the former);
  `test_client.py` has exactly 6 `x-mcp-secret` assertion sites; `test_auth.py` exists (an earlier
  sub-agent had missed it) and needs no changes since it never asserts on `_metadata()`'s output;
  `AGENT-4`/`AGENT-6` in `docs/context-constitution.md` already cite stale evidence line numbers
  independent of this feature, corrected in the same edit rather than propagated forward.
- **Phase 1 Grilling**: 1 round (quick mode). Proposer gave a 3-step subtraction plan (agent code +
  test / infra env trim / doc reconciliation). Adversary found no Floor breach but 5 real gaps:
  (1) Step 3 omitted `.env.example`/`scripts/setup-env.sh` despite FR-4 already naming them —
  synthesis fix: carried into design explicitly. (2) `docs/launch-pdfs/product-features.md:186` —
  a **live, uncorrected** claim ("Platform services trust this header...") in launch/marketing
  collateral, never surveyed by recon or named in product-spec — added to FR-4/product-spec scope;
  its rendered PDF is regenerated via `scripts/build-launch-pdfs.py` (verified the `markdown`/
  `weasyprint` toolchain installs cleanly in this session's environment via `pip install`).
  (3) `docs/reports/2026-08-01-mcp-tools-alignment-triage.md:57` — a genuine historical survivor
  (describes a proposed-and-never-built RPC gate) that AC-1's original exemption wording didn't
  cover — widened the exemption set to `docs/roadmap/features/*/`, `docs/roadmap/ledger/`, and
  `docs/reports/` explicitly, replacing the vaguer original wording. (4) Step 2 (infra env-var
  trim) claimed "existing CI coverage" as verification, but no CI job boots `docker-compose.yml` at
  all (confirmed zero `docker compose` references in `.github/workflows/ci.yml`) — made the manual
  `docker compose up`/`ps` smoke check a mandatory, actually-executed verification step, not
  aspirational. (5) The "leave `auth.py`'s orphaned `MCP_AGENT_SECRET` read in place" judgment call
  was applied asymmetrically — `client.py:22`'s copy becomes equally orphaned; resolved by treating
  both symmetrically (leave both, documented as a deliberate minimalism trade-off — see design.md
  Rejected Alternatives).
- **Gate**: no `AskUserQuestion` was raised for this round. All 5 objections had a single clear,
  non-ambiguous engineering fix (not a genuine architecture fork), and the user's original task
  instruction explicitly said to "run the SDD process until completion in one PR" — treated as
  standing authorization to resolve non-forking design-quality gaps autonomously rather than pause
  the pipeline on every non-blocking adversarial finding. This is recorded here per Constitution
  P-03/P-04 so the decision is auditable, not silent.
- Updated `product-spec.md`: FR-4 now names `docs/launch-pdfs/product-features.md`; AC-1 split into
  a hard-zero check (`services/xstockstrat-agent/app/`) + a reviewed repo-wide check with an
  explicit historical-survivor exemption set; AC-4 now mandates the executed smoke check; Feature
  Workflow Notes / Open Questions updated to match the branch deviation and the symmetric-orphan
  decision.
- Constitution rules touched: C-01, C-08, C-10, C-14, P-03, F-02/F-03, F-04 (all honored — see
  `design.md` § Constitution Rules Touched). No Floor breach at any point.
- Status: spec-ready → design-approved.

## Open Threads (mirrored from design.md § Open Risks)

- [ ] `docs/runbooks/mcp-tools.md`'s inline "sends `x-mcp-secret`" clauses beyond `:241,388,707`
  may not be exhaustive — re-grep at `/sdd-spec` time before finalizing step 3's instructions.
- [ ] `docs/launch-pdfs/product-features.pdf` regeneration needs `markdown`/`weasyprint` — installed
  successfully in this session's environment; re-verify availability at execute time and record an
  explicit deferral note here if it's ever unavailable (never a silent skip).
- [ ] `.do/app.yaml`'s `MCP_AGENT_SECRET` notify/ingest/analysis block is also touched by
  `084-droplet-compose-deploy` (`spec-ready`, not yet implemented) — rebase-risk only, watch at
  `/sdd-spec` time.

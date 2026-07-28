# Context Log: fix-config-write-authz

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-07-28 (/sdd-triage)

- Bug surfaced via code recon while resolving open questions on feature 073
  (`mcp-config-management`) — not via a GitHub issue (no exploit report, no incident).
- Severity: SEV-1 — matches the bug-triage indicator "Order approval flow is bypassed or stuck":
  any authenticated user of any role can write `trading.approval.*` or
  `platform.maintenance_mode` today, with zero backend authorization.
- Confirmed present on `origin/main` (production), not just `main-dev`:
  - `services/xstockstrat-config/src/grpc/configServiceImpl.ts` `setConfig` — no metadata/header
    check at all.
  - `services/xstockstrat-ui/src/lib/configUiBff.ts` `setConfig` handler — `requireSession` only,
    no `requireAdminScope`.
- Routed to SDD path (Track C), **adapted in two ways from the skill default**:
  1. **No GitHub issue.** GitHub Issues are disabled on `davcs86/xstockstrat` (`POST /issues` →
     `410 Issues has been disabled`) — same adaptation as feature 067
     (`docs/roadmap/features/067-fix-custom-formula-allnone/context.md`). Bug captured directly
     from code recon; slug omits an issue number.
  2. **Routing deviates from the pure SEV-1 → Track A (Hotfix) mapping.** Per
     `docs/runbooks/bug-triage.md`, SEV-1 confirmed on production `main` normally routes to Track A
     (branch from `main`, PR directly to `main`, platform-lead approval, back-merge to
     `main-dev`). Asked the user explicitly (two-question `AskUserQuestion`, given this session is
     scoped to a designated branch — `claude/xstockstrat-paper-trading-cxyi76` → `main-dev` — per
     harness instructions, and a direct-to-`main` branch/PR would deviate from that without prior
     authorization):
     - **Maintenance mode**: user chose **skip** — not currently exploited (found via recon, no
       evidence of misuse); halting all trading over a latent, unconfirmed-exploited gap was judged
       disproportionate.
     - **Branch routing**: user chose **route through main-dev instead** of the pure hotfix-to-main
       flow. Severity classification (SEV-1) is unchanged — only the branch/merge path is adapted.
       This is captured here as a bug (Track C shape: feature.md/product-spec.md/context.md), not
       logged to `docs/runbooks/hotfix-log.md` (which is specifically the Track A/hotfix-to-main
       register — using it here would misrepresent the actual merge path taken).
- Created: feature.md, product-spec.md, context.md.
- Affected services: `xstockstrat-config` (primary — missing RPC-level check),
  `xstockstrat-ui` (secondary — missing BFF-level check, same underlying RPC).
- Root cause hypothesis: `SetConfig`/`GetConfig`/`ListKeys` were built without any authorization
  gate from the start; no `requireAdminScope`-equivalent check was ever added, unlike other
  admin-sensitive RPCs on the platform.
- Recommended design depth: **full** → `/sdd-design fix-config-write-authz` (rationale: crosses
  the "affected services ≥ 2" full-design threshold per `docs/runbooks/bug-triage.md` § C-0, and
  the exact shape of the `ADMIN`-scope check — backend-only vs. backend+BFF defense-in-depth,
  whether `GetConfig`/`ListKeys` also need gating — is worth a short debate, not an
  implementation default).
- Development branch: `feature/fix-config-write-authz` (to be created off `main-dev` when
  implementation starts — not yet created; triage stops here per the skill's own gate, awaiting
  the human to trigger `/sdd-design`).

### Cross-feature note (relationship to feature 073)

Feature 073 (`mcp-config-management`, `docs/roadmap/features/073-mcp-config-management/`) already
scoped this exact authorization gap as its FR-7, discovered independently while resolving that
feature's own open questions (same session, immediately prior). This bug fix should land **first**
and feature 073's FR-7 should then be updated at its `/sdd-design`/`/sdd-spec` time to say "already
implemented by 074 — verify, don't reimplement" rather than duplicating the `ADMIN`-scope check.
Not yet cross-referenced back into feature 073's own files — do that at feature 073's next design
session, since this bug's actual fix shape isn't decided yet (still `draft`, pending
`/sdd-design`).

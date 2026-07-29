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

## Session 2026-07-29 — /sdd-review product-spec

- **Verdict: PASS WITH WARNINGS** (0 blockers, 5 warnings). Status: `draft` → `spec-ready`.
- Criteria pass confirmed every code-grounded claim in the spec resolves against the repo
  (`configServiceImpl.ts:251-274` has no authz branch; `configUiBff.ts:16-22` is `requireSession`
  only while `requireAdminScope` exists at `bffShared.ts:50` and is used by
  `insightsBff.ts:51`; `x-access-scope & 0x04` is the documented convention; no proto change
  needed — `SetConfigRequest` fields 1-7 carry no identity field).
- **Warnings carried into design (not fixed in the product spec):**
  1. **Incomplete `SetConfig` caller inventory** — the spec names 2 call paths but there are 4.
     Missing: `services/xstockstrat-ui/e2e/config-ui/api-smoke.spec.ts:120,134` (both call the
     SetConfig BFF on the *no-roles* `addAuthCookie` and assert 200 — they flip to denied), and
     `scripts/integration-test.sh:493-497` / `:520-524` (SetConfig with no identity headers,
     suppressed by `|| true`, so CI stays green while the maintenance-mode scenario silently
     becomes a no-op and its downstream assertion at `:513-518` fails for the wrong reason).
  2. **AC #4 is unsatisfiable as written** — it requires reproducing `config-rollout.md` Step 2
     end-to-end post-fix, but that example (`config-rollout.md:76-91`) sends *no* metadata, so it
     must be denied after the fix. The sibling Connect-RPC example (`:93-104`) is additionally
     already stale (posts to removed port 8060). Runbook must be updated as part of the fix.
  3. Acceptance criteria are unnumbered — no `FR-N` ids for the impl spec to cite per step.
  4. `GetConfig`/`ListKeys` named in the root cause but silently dropped from scope — make the
     exclusion explicit.
  5. Cosmetic: cited range `configServiceImpl.ts:251-273` is one line short (actual 251-274);
     template boilerplate left at product-spec line 68.
- **Two design-phase notes from the reviewer:**
  - No Node backend service performs an admin-bit check today — grep finds no `& 0x04` under
    `services/xstockstrat-{config,ledger,identity,notify}`. The only backend precedent is Python
    (`_has_admin_scope`, `xstockstrat-{analysis,indicators}/app/handlers/servicer.py`). This fix
    creates the Node-side precedent → argues for a shared helper, not an inline check.
  - `services/xstockstrat-config/src/middleware/propagation.ts` exists and reads `x-access-scope`
    at line 17 but is **orphaned** — nothing under `src/` imports it, and it parses `req.headers`
    (Connect-RPC-era HTTP shape), not grpc-js `call.metadata`. Do not assume it is wired.
- **Overlap scan: collisions found, none FAIL-level (no config-key/proto/migration collision).**
  - `configServiceImpl.ts` `setConfig` — 074 and 073's FR-7 both add the same ADMIN gate to the
    same method. 073 is still `draft` with no impl spec, so this dissolves by editing 073's FR-7
    to "already implemented by 074 — verify, don't reimplement" (the plan already recorded in this
    file's Cross-feature note). Doing that instead of a merge-order row, since both features are
    being implemented in sequence on one branch this run.
  - `configUiBff.ts` — awareness only; 073 declares `/config-ui` out of scope, so 074 owns it.
  - **Scope divergence to settle in design:** 073 assumes `GetConfig`/`ListKeys` stay ungated
    (073 product-spec:185). If 074's design gates the read RPCs, 073's `get_config`/
    `list_config_keys` tools inherit a constraint their spec assumes away.
  - Additional trunk-side blast radius the overlap agent found: `e2e/mock-backend.ts` stubs
    `SetConfig`, and `src/app/config-ui/hooks/useSetConfig.ts` drives it from the browser.

### Deviation — branch routing (harness constraint)

This run was invoked with a harness-designated branch (`claude/runs-073-074-sdd-6wtwal` → PR into
`main-dev`) and explicit instructions to develop and push only there. The SDD default
(`feature/fix-config-write-authz` + per-step `feature-steps/*` PRs) is therefore not used for this
run; 074 and 073 land as one PR on the designated branch. Severity classification (SEV-1) and the
already-recorded main-dev routing decision are unchanged.

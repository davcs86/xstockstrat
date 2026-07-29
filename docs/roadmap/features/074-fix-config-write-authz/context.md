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

## Session 2026-07-29 — /sdd-design (Phase 0 + Phase 1 rounds 1-2)

### VERIFIED DEFECT — `xstockstrat-config`'s unit test suite executes nothing

Surfaced by the design-adversary (objection O2), then confirmed by direct execution in this session
with dependencies installed. This is not a hypothesis; each step below was run.

`pnpm --filter xstockstrat-config test` reports **"7 tests, 7 pass, 0 skipped"** while executing
**zero assertions**. Both test files guard their import with `if (!X) return;` (a *passing* early
return), and both imports fail:

- `src/__tests__/configServiceImpl.test.ts:17` imports `'../grpc/configServiceImpl.js'` →
  `ERR_MODULE_NOT_FOUND` (no such file; the source is `.ts`).
- Changing the specifier to `.ts` does **not** help: →
  `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX: TypeScript parameter property is not supported in strip-only
  mode`, caused by `configServiceImpl.ts:94` `constructor(private readonly pool: Pool) {}`.
- Removing the parameter property surfaces a **third** blocker: Node reparses these files as ESM
  ("module syntax detected"), and the module graph uses extensionless relative imports
  (`import { getLogger } from '../services/logger'`) → `ERR_MODULE_NOT_FOUND`.
- `src/__tests__/configWatcher.test.ts:26` has the identical `.js`-specifier + skip-guard shape.

Executed against **compiled** output (`npx tsc` → `dist/`), where imports resolve, the truth appears:

- `node --test dist/__tests__/configServiceImpl.test.js` → **1 of 2 tests FAILS**:
  `assert.strictEqual(k.validation.value_type, 1)` gets `'VALUE_TYPE_FLOAT_MAP'`. The *test* is
  stale — `packages/proto/buf.gen.yaml` sets `stringEnums=true`, so the value is a string, not `1`.
  The impl is fine.
- `node --test dist/__tests__/configWatcher.test.js` → **HANGS** (killed at 45s, exit 143). Its
  first case constructs `new ConfigWatcher('localhost:1', 'test')`, whose constructor dials a real
  gRPC channel and retries forever.

**Why this blocks 074 specifically:** C-08 requires a paired test for the new security gate. Written
in the existing house style, that test would silently skip and report PASS — shipping a SEV-1
authorization gate whose test proves nothing. That is exactly the failure mode `fails.md`
(2026-07-27, feature 072) was written to stop: a consumer-contract demonstration offered as
producer-contract evidence.

### Design debate — round 1

Proposer: gate in a new `src/grpc/authz.ts`, called inline at the top of `setConfig`; named
`status.PERMISSION_DENIED`; reads left open; BFF `requireAdminScope`; delete dead `propagation.ts`.
Adversary verdict **NEEDS WORK** — no Floor breach, 11 objections. Strongest: (O1) the proposed
"real `grpc.Metadata` in a hand-built `call`" mitigation proves the consumer contract, not the
producer contract — direct `fails.md` hit; (O3) `author` stays caller-controlled, so the fix turns a
forgeable audit trail into an *authorized-looking* forgeable one; (O4) deleting `propagation.ts` is
1-of-4 creep that makes two findings rows half-true.

### Design debate — round 2 (three corrections that changed the answer)

1. **The feature-049 "author" precedent as documented is drift.** `header-propagation.md:36-37`
   says the author is "required, defaults to propagated `x-user-id`". The code says the opposite
   ordering: `services/xstockstrat-indicators/app/handlers/servicer.py:207-220` is
   `if request.author: author = request.author` — the request field **wins**, `x-user-id` is the
   fallback, abort only if both are empty. So the platform precedent is a *presence* guarantee, not
   an *authenticity* one. Requiring `x-user-id` would exceed precedent, not match it.
2. **Requiring `x-user-id` would break AGENT-4 and pre-break feature 073.**
   `services/xstockstrat-agent/app/client.py:24-32` forwards only `x-mcp-secret` + a hardcoded
   scope and deliberately does **not** send `x-user-id` (codified as invariant AGENT-4).
3. **`docs/runbooks/config-rollout.md:87` already sends `author="platform-team"`** — the objection
   assumed it did not, so the author change costs zero incremental file edits.

Verified independently this session: `manageSignalSource` is already gated at
`services/xstockstrat-ingest/app/handlers/servicer.py:859-861`; both in-network self-elevators are
real (`agent/app/client.py:32` hardcodes scope `7`, `analysis/.../fundsignal_loop.py:345` injects
`4`); prod exposure is bounded (`.do/app.yaml` uses `internal_ports` with no route for config)
while `docker-compose.yml` does publish `50060:50060` locally; `xstockstrat-config/.eslintrc.json`
has no `no-restricted-syntax` rules while the UI's bans both `x-access-scope` and `0x04`.

## Session 2026-07-29 — /sdd-spec + /sdd-execute (all 7 steps)

Design approved (2 rounds, no Floor breach) → implementation-spec.md (7 steps) → executed.

### What shipped

- `services/xstockstrat-config/src/grpc/authz.ts` (new) — `ADMIN_SCOPE`, header constants,
  `hasAdminAccessScope`, `userIdFrom`, and the two denial errors. Named `hasAdminAccessScope` to
  avoid colliding with the UI's `hasAdminScope(roles)`.
- `setConfig` gate as the **first statement**, so a denied call reaches neither the INSERT nor
  `pg_notify`. `author` resolves `request.author` → `x-user-id` → `INVALID_ARGUMENT`.
- BFF `requireAdminScope` in `configUiBff.ts`; two e2e cases moved to `addAdminCookie`, one
  non-admin denial case added.
- eslint DRY rails mirrored into `xstockstrat-config` (it had none).
- Runbook, service CLAUDE.md, `header-propagation.md`, and both findings docs updated.

### Verification actually run (not asserted)

| Gate | Result |
|---|---|
| config unit suite | 20/20 pass, terminates cleanly (was: 7 "passing" while executing nothing) |
| config red-before-green | 4 failures with the gate reverted → 20/20 with it |
| config coverage | 51.7% lines vs 40 threshold; `authz.ts` 100% |
| config lint / tsc | 0 errors (30 pre-existing `any` warnings) |
| ui lint / tsc | clean |
| config-ui e2e | 11/11 pass |
| ui red-before-green | denial case fails with the BFF gate reverted → 11/11 with it |
| `bash -n scripts/integration-test.sh` | OK |

**The loopback suite retired the design's biggest risk.** It dials a real `grpc.Server` over a real
socket with real `Metadata`, so its passing is direct evidence that grpc-js delivers `Metadata` at
`call.metadata` — the assumption whose failure would have denied *every* admin write. That is now
verified, not assumed.

### Deviations (full detail in implementation-spec.md § Deviation Log)

1. Step 1 needed all three blockers fixed, not one — resolved by running tests against compiled
   output rather than churning the service source.
2. The new eslint rails flagged the dead `propagation.ts`; it is exempted (not deleted, not edited)
   to keep the pending 4-service cleanup a single change.
3. Playwright's pinned browser was missing from the image and `global-setup.ts` ignores the
   executable-path override — installed the pinned build; no repo change.
4. Step 6 added a `post_raw_admin` helper rather than duplicating the curl invocation twice.

### OUTSTANDING — AC #4 and AC #5 are not satisfied

Both need a live dev `xstockstrat-config:50060`, which this session cannot reach. Before this is
marked `launched`, someone must run the amended `config-rollout.md` Step 2 snippet against dev with
admin metadata, confirm a non-admin call is rejected, and paste the returned `version` here. The
in-repo evidence is strong but it is not the dev smoke test the ACs ask for.

### Open threads carried forward (from design.md § Open Risks)

- In-network self-elevation is **not** closed and stays owned by
  `docs/context-constitution-findings.md:37` — closing this bug does not answer it.
- `author` is a presence guarantee, not an authenticity one.
- `e2e/mock-backend.ts` models no backend admin gate (now logged in the UI findings doc).
- `integration-test.sh`'s over-broad assertion and stale `CONFIG_URL` — commented, not fixed.
- Non-admin config-ui users still see a live Edit/Save affordance (now logged in the UI findings doc).
- Dead `propagation.ts` survives in all 4 Node services, deliberately.

## Session 2026-07-29 (CI: feature status automation)

- Promotion PR #812 merged to main
- Feature promoted and committed: 0eae638104744992c61c8a1ac4bd8cbaac10862b
- Status updated: `code-completed` → `launched`
- Launched date: 2026-07-29

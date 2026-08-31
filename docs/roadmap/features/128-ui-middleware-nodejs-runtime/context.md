# Context: ui-middleware-nodejs-runtime

**Feature**: `docs/roadmap/features/128-ui-middleware-nodejs-runtime/feature.md`
**Product Spec**: `docs/roadmap/features/128-ui-middleware-nodejs-runtime/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/128-ui-middleware-nodejs-runtime/implementation-spec.md`

---

## Session 2026-08-11 — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- Origin: follow-up to PR #925 (`docs/reports/2026-08-11-ui-middleware-self-refresh-tls-defect.md`),
  which fixed a production TLS defect in `middleware.ts`'s self-referential `/api/auth/refresh` call
  with a minimal loopback-URL workaround. During that session's writeup, the user asked whether
  middleware should have called `xstockstrat-identity` directly instead — the answer is yes,
  architecturally, but it requires Next.js 15.5's stable Node.js-runtime middleware (this repo is on
  15.5.21), which removes the long-standing Edge-only constraint that made the self-fetch pattern
  necessary in the first place. The user chose to leave the hotfix as-is and open this as a proper
  follow-up feature rather than bundle it into the hotfix PR.
- Confirmed via Context7/nextjs.org docs (not from memory) that Node.js middleware runtime
  stabilized in Next.js 15.5.0 (experimental since 15.2.0), syntax
  `export const config = { runtime: 'nodejs' }`, and that both Node.js server and Docker container
  deploys are supported platforms — relevant since this repo self-hosts via Docker/standalone
  output, not Vercel.
- Surfaced the directly-relevant Ledger entry as a Known Trap in product-spec.md Open Questions:
  `docs/roadmap/ledger/insights.md` 2026-08-05 (`wire-fe-auth`) records "`middleware.ts` and other
  Edge-runtime code must never import modules that pull in `@connectrpc/connect-node`" — this
  feature's premise is that the Node.js runtime option lifts that constraint, which the design phase
  must verify rather than assume.
- **Feature numbering collision, caught before push**: computed `NNN` from the local working tree
  (`max=126` → allocated `127`), but `origin/main-dev` had already merged `127-consolidate-watchlist-signal`
  (PR #926) between this session's start and the branch-creation step — the exact race condition
  `docs/roadmap/ledger/fails.md` 2026-07-29 (`081-qa-capability`) and 2026-08-05 (`080-...`) document
  ("the numbering scan must cover all remote branches, not the checkout"). Caught here because
  `git checkout -b feature/ui-middleware-nodejs-runtime origin/main-dev` surfaced the collision
  directly (both `127-*` dirs existed side by side). Renumbered `127` → `128` via `mv` (files were
  still untracked, so `git mv` wasn't applicable) + updated `context.md`'s three self-referential
  path lines; `feature.md`/`product-spec.md` had no self-referential `NNN` paths to fix.

## Session 2026-08-31 — sdd-story (in-place regenerate)

- Regenerated `product-spec.md` to the current template (in place, **kept number 128** — no new
  directory, status stays `draft`). Sections reordered/normalized; all seven FRs (FR-1..FR-7) and
  the full scope preserved verbatim — this remains an internal auth-transport refactor of
  `xstockstrat-ui`'s `middleware.ts` only, Consumer Surface = **None**, no proto/config/DB changes.
- Authored `acceptance.feature` (7 scenarios, `@AC-1`..`@AC-7`), moving the previously-inlined
  Acceptance Criteria list out of `product-spec.md`; the spec's `## Acceptance Criteria` is now a
  C-15 pointer only. Since observable behavior is unchanged, scenarios assert preserved behavior
  (in-process refresh, redirect-to-login, unchanged cookie attributes) plus structural outcomes
  (Node.js runtime, removed `buildInternalRefreshUrl`/matcher exclusion, corrected docs). Every FR
  is covered by ≥1 scenario.
- **Carried the connect-node/Edge trap into Open Questions as a design-VERIFY item**: the
  `insights.md` 2026-08-05 `wire-fe-auth` entry (`insights.md:777-780`) forbids Edge-runtime code
  importing `@connectrpc/connect-node`. The Ledger is append-only, so this feature does not edit it;
  the design phase must *verify* (not assume) that Next.js 15.5's Node.js middleware runtime lifts
  that constraint under this repo's Docker `output: 'standalone'` build, via a real build where
  `middleware.ts` transitively imports the Node-only transport.
- Updated `feature.md`: added the `acceptance.feature` artifact link, bumped `**Last Updated**` to
  2026-08-31, appended the regeneration row to Status History.

## Session 2026-08-31 — sdd-review fixes (product-spec)

`/sdd-review ui-middleware-nodejs-runtime product-spec` returned **FAIL** (criterion 9) plus two
warnings; applied fixes (docs-only, still `draft`, number/slug unchanged):

- **BLOCKER (criterion 9 — Open Questions).** The four `- [ ]` items under `## Open Questions` were
  phrased as work the design phase "must verify", which read as unresolved acceptance gates on the
  spec. They are genuine feasibility investigations design owns, not spec gates — so rather than
  tick them, reframed them into a new **non-gated** `## Design-Phase Investigation (owned by
  /sdd-design Phase 0)` section as plain bullets, and left `## Open Questions` as "None — moved to
  Design-Phase Investigation below." The load-bearing bullet is called out explicitly: whether the
  Node.js middleware runtime actually lifts the Edge-bundling constraint on `@connectrpc/connect-node`
  under this repo's `output: 'standalone'` Docker build — grounded now in the two concrete artifacts
  that encode the old constraint (`next.config.js` lists `@connectrpc/connect-node` in
  `serverExternalPackages` for route handlers only; `src/lib/identity.ts` carries a "NEVER import
  from middleware.ts" header). FR-7's dangling "(see Open Questions)" pointer updated to
  "(see Design-Phase Investigation)". No unchecked genuine-unknown `- [ ]` remains under
  `## Open Questions`.
- **WARNING — wrong doc path.** FR-6, AC-7, and `## Affected Services` cited
  `services/xstockstrat-ui/docs/patterns/frontend-auth.md`, which does not exist. Verified the real
  file is at repo root `docs/patterns/frontend-auth.md` (the quoted rule "Only `lib/auth.ts` may be
  imported from `middleware.ts`" is at line 58). Corrected every reference; the sibling
  `services/xstockstrat-ui/CLAUDE.md` reference was already correct and left as-is (Affected Services
  now splits the root doc onto its own bullet so it is not misread as service-relative).
- **WARNING — AC-2 observable pairing.** Kept AC-2's structural assertions (calls `refreshSession()`,
  no outbound `fetch()` to `/api/auth/refresh`) and paired them with browser-observable checks: the
  browser receives one updated `Set-Cookie` on that same response, and no `/api/auth/refresh` network
  request is observed during the near-expiry refresh.
- Preserved all seven FRs, the Consumer Surface = **None** justification, and all `@AC-*` tags /
  FR coverage. Only `product-spec.md`, `acceptance.feature`, and this `context.md` changed.

## Session 2026-08-31 — sdd-review product-spec (approved)

- Product spec approved: `draft` → `spec-ready`. All `/sdd-review` blockers and warnings were addressed (see the sdd-review-fixes session above).
- NOTE: the confirming re-review pass was interrupted by a session usage/rate limit; fixes were applied against each reviewer's explicit findings. For 021 specifically, the orchestrator manually caught and fixed a residual field-name error (`service_origin` → `source_service`; the ledger `Event` has no `user_id` field). A quick re-review can re-confirm on resume.

## Session 2026-08-31 — sdd-design (FULL)

- Wrote `recon.md` + `design.md` (grounded recon + 2-round adversarial debate). Chosen approach:
  flip `src/middleware.ts` to `runtime: 'nodejs'`, call `refreshSession()` in-process, set/clear
  cookies on the `NextResponse`, remove `buildInternalRefreshUrl()` + the self-`fetch()`.
- **Feasibility verdict (load-bearing item):** Node middleware runtime lifts the Edge-bundling
  constraint IN PRINCIPLE — Next 15.5.0 stabilized `config.runtime='nodejs'` (Context7
  `/vercel/next.js`; pinned `^15.5.21` at `package.json:48`), and moving off Edge removes the exact
  documented `Module not found: node:http` failure (`frontend-auth.md:35`). RESIDUAL and NOT
  doc-provable: whether `serverExternalPackages`/`.nft.json` covers the Node-runtime middleware chunk
  under `output:'standalone'`. Must be proven by a real `docker build` (feature `@AC-6`); a failure
  blocks the feature (F-04/P-03). `insights.md:777-780` treated as a hypothesis to disprove, not a given.
- **DECISION FOR OPERATOR (deviation from FR-5/AC-5):** the `api/auth/refresh` matcher exclusion must
  be **KEPT**, not removed. FR-5's premise "browsers never call it directly today" is factually stale —
  `src/lib/authRedirect.ts:40` is a live browser caller (feature-153). Removing the exclusion would let
  middleware redirect the browser's expired-token refresh POST to `/auth/login`, regressing the durable
  guarantees `@AC-5`/`@AC-6` in `services/xstockstrat-ui/acceptance/ui-auth-improvements.feature` (C-16).
  `@AC-*` are append-only (C-15), so the spec owner must correct FR-5 + AC-5's third clause. Not yet
  signed off — flagged as Open Risk 2 in `design.md`.
- `app/api/auth/refresh/route.ts` is **KEPT** (not redundant — authRedirect.ts still calls it).
- Noted FR-3 wording caveat: today's middleware discards `refreshRes` (`middleware.ts:39-49`) and does
  not forward the rotated `Set-Cookie`; the new in-process design does — a strict improvement, so
  "observably identical" is slightly imprecise (Open Risk 3).
- No Floor breach; status advisory-flip to `design-approved` is pending the orchestrator's gate and the
  two operator confirmations above.

## Session 2026-08-31 — design correction (FR-5 / AC-5)

- The full-mode design's adversarial pass found the regenerated FR-5/AC-5 were stale: they removed the `/api/auth/refresh` matcher exclusion, but that route still has a live non-middleware caller (`src/lib/authRedirect.ts:40`), so removing the exclusion would regress feature 153's `@AC-5`/`@AC-6` (C-16). Corrected FR-5 + AC-5 to KEEP the matcher exclusion and retain the route; only `buildInternalRefreshUrl()` + the middleware self-fetch are removed.
- Feasibility is doc-supported (Node middleware stable in Next 15.5) but the `output:'standalone'` bundling of `@connectrpc/connect-node` in the Node middleware chunk MUST be proven by a real `docker build` (AC-6); a build failure blocks the feature (F-04/P-03).

## Session 2026-08-31 — sdd-spec

- Generated `implementation-spec.md` with **4 steps**. Status → implementation-ready. Followed
  `design.md`'s Chosen Approach exactly (Node runtime + in-process `refreshSession()`; KEEP matcher
  exclusion + `api/auth/refresh` route per corrected FR-5).
- Step map: **1 [service]** middleware.ts + auth.ts + identity.ts (runtime flip, in-process refresh,
  delete `buildInternalRefreshUrl`, keep matcher exclusion w/ rewritten rationale, correct stale
  in-file comments) → **2 [test]** vitest unit tests (covers AC-1..AC-5, red-before-green) →
  **3 [test]** standalone-build feasibility gate (covers AC-6, load-bearing F-04/P-03) →
  **4 [docs]** frontend-auth.md + service CLAUDE.md (covers AC-7). Every `@AC-*` covered.
- Key codebase findings surfaced during discovery:
  - **`buildInternalRefreshUrl` has an existing test** — `src/lib/auth.test.ts:24-42` (`describe`)
    + import `:2` + the `ORIGINAL_PORT`/`afterEach` PORT harness `:17-22`. Deleting the function
    forces removing that block (and `afterEach` from the vitest import) or the suite won't compile —
    folded into Step 2. Not called out in recon; caught by a repo-wide `grep buildInternalRefreshUrl`.
  - **In-file doc-drift beyond FR-6's two docs:** `auth.ts:42-44` ("must not be reachable from
    middleware … Edge runtime") and `identity.ts:1-6` ("NEVER import from middleware.ts … breaks the
    Edge runtime bundle") become actively false once middleware imports identity. Corrected in Step 1
    (files already in scope), not the docs step.
  - `refreshSession` (`identity.ts:11-24`) returns `{accessToken,refreshToken,claims}|null`;
    `setSessionCookies`/`clearSessionCookies` (`auth.ts:62-91`) and the `req.cookies.get('refresh_token')`
    read pattern (`route.ts:6`) are the mandatory reuse targets.
  - `serverExternalPackages` (`next.config.js:8-14`) already lists `@connectrpc/connect-node` for
    route handlers; middleware-chunk coverage under `output:'standalone'` is the residual, build-only
    provable risk — Step 3 may touch `next.config.js` only if the build fails.
- Reviewers (deduped): **xstockstrat-ui service owner** (Steps 1-3); **none** (Step 4, docs).

## Session 2026-08-31 — sdd-review impl-spec (advisory)

- Result: 0 failures, 1 warning, 5 notes. No Floor risk. All path:line grounded; corrected FR-5 matcher-keep justified by a real live caller (authRedirect.ts:40); buildInternalRefreshUrl removal enforced structurally; standalone-build feasibility gate (AC-6) is real and blocks on failure (F-04/P-03); docs step uses repo-root paths.
- Unresolved ⚠ carried into execution:
  - Step 1/Step 2: frontend E2E coverage not pinned — the FR-3 fix (near-expiry middleware path now ACTUALLY rotates the browser cookie, previously discarded) is subtly NEW browser-observable behavior. Add a note pinning `e2e/auth.spec.ts` as the E2E guard (stays green) or extend it to cover the rotated near-expiry cookie path. — [ ] unaddressed
  - Notes (no fix): refresh RPC carries no x-trace-id (parity with existing route.ts, not a C-03 regression); prefer signed-JWT stub over vi.mock('@/lib/auth') in Step 2 so AC-3/AC-4 assert real cookie helpers; Step 3 build-gate coverage N/A (carried by Step 2); CLAUDE.md line numbers unverified (content present). — [ ] notes
- Overlap findings: batch scan CLEAN; 128 is isolated (middleware/auth transport only).

## Session 2026-08-31 — sdd-execute (sequential)

Executed on `feature/ui-middleware-nodejs-runtime`, branched off clean `main-dev` (Stage-1 planning
PR #1051 already merged). Per operator direction the run is unattended (auto-proceed through
checkpoints; pause only on real blockers).

- **Tooling setup (steps 1–4):** node v22.22.2 (CI uses Node 24 — CI is authoritative for the
  build; local build/tests unaffected) · pnpm ✓ 9.15.9 · vitest ✓ 3.2.7 (via pnpm) · next ✓ ^15.5.21 ·
  docker ✗ (unavailable in sandbox) → AC-6 standalone gate uses the spec's offline `pnpm run build`
  fallback; the authoritative container-refresh proof runs in CI.

### Step 1 — service: Node.js-runtime middleware + in-process refresh; delete buildInternalRefreshUrl [done]
- Flipped `src/middleware.ts` `config` to `runtime: 'nodejs'` (kept `matcher` byte-for-byte incl. the
  `api/auth/refresh` exclusion, rationale comment rewritten to cite the live browser caller
  `authRedirect.ts:40`). Replaced the near-expiry `fetch(buildInternalRefreshUrl())` loopback with an
  in-process `refreshSession(req.cookies.get('refresh_token')?.value)` call: on success builds the
  trace-ID `NextResponse.next` then `setSessionCookies(response, …)`; on null/absent redirects to
  `/auth/login` with `clearSessionCookies`. Deleted `buildInternalRefreshUrl()` + JSDoc from
  `src/lib/auth.ts` and dropped its import from middleware; corrected the stale Edge-only comments in
  `auth.ts:42-44` and the `identity.ts:1-6` header.
- TDD (P-06): AC-1/AC-2/AC-3/AC-4 **red** (config.runtime undefined; refreshSession not called / fetch
  was called; no rotated Set-Cookie; 200 not 307) against the pre-change tree → **green** after Step 1
  (`vitest run src/middleware.test.ts src/lib/auth.test.ts`: 11 passed). Grep verifications all pass:
  `runtime: 'nodejs'` present; `buildInternalRefreshUrl` no matches; `fetch(` no matches in middleware;
  `api/auth/refresh` still excluded. `pnpm run lint` clean (only pre-existing warnings in untouched files).
- Files modified: `services/xstockstrat-ui/src/middleware.ts`, `services/xstockstrat-ui/src/lib/auth.ts`,
  `services/xstockstrat-ui/src/lib/identity.ts`
- Deviations: none

### Step 2 — test: vitest unit tests for the Node-runtime middleware [done]
- `middleware.test.ts`: added `@AC-1` (config.runtime === 'nodejs' + matcher still declared) and an
  `@AC-2/@AC-3/@AC-4` describe that drives `middleware(req)` on the near-expiry path — signs a real
  near-expiry JWT (via `JWT_SECRET`, so `getSessionFromRequest` and the real `setSessionCookies`/
  `clearSessionCookies` run), mocks only `@/lib/identity` `refreshSession`, spies `globalThis.fetch`,
  asserts refreshSession called with the refresh_token, no self-fetch, rotated `Set-Cookie` with
  unchanged attributes, and the null-refresh redirect+clear path. Rewrote the `api/auth/refresh`
  matcher test description to cite the live browser caller. `auth.test.ts`: dropped the
  `buildInternalRefreshUrl` import + describe block + the `ORIGINAL_PORT`/`afterEach` PORT harness.
- TDD (P-06): 4 assertions **red** against pre-Step-1 tree → **green** after (11 passed). Full suite
  `pnpm run test:coverage`: 131 passed; `src/lib/auth.ts` 76.56% (> 40% floor). `pnpm run lint` clean.
  `grep buildInternalRefreshUrl src/lib/auth.test.ts` → no matches.
- Files modified: `services/xstockstrat-ui/src/middleware.test.ts`, `services/xstockstrat-ui/src/lib/auth.test.ts`
- Deviations: none

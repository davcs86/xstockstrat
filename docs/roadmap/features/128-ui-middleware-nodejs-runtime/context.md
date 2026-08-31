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

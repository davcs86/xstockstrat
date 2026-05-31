# Context: upgrade-nextjs15

**Feature**: `docs/roadmap/features/041-upgrade-nextjs15/feature.md`
**Product Spec**: `docs/roadmap/features/041-upgrade-nextjs15/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/041-upgrade-nextjs15/implementation-spec.md`

---

## Session 2026-05-30T00:00:00Z — sdd-story

- Wrote product-spec.md from the existing `idea`-state feature.md backlog entry (created
  2026-05-27 after the DO deploy-failure investigation). Status: `idea` → `draft`.
- Part of a 4-feature spec batch (033, 041, 045, 044), each delivered as an independent PR off
  `main-dev`. Open questions deliberately left open for the `/sdd-review product-spec` gate.
- Grounded against current `main-dev`:
  - `xstockstrat-insights` and `xstockstrat-config-ui`: `next` `^14.2.3`, `react` `^18.3.1`,
    `eslint-config-next` `^14.2.35`, OTel `@opentelemetry/sdk-node` + `exporter-trace-otlp-http`
    at `^0.218.0`.
  - `xstockstrat-trader`: `next` `^15.5.15` (the realignment target).
- Open questions raised for review: exact v15 pin policy, React 18-vs-19 (and Radix/charting
  gating), whether the pnpm-workspace standalone-path workaround can be removed on v15, OTel
  package compatibility, and sequencing against features 045 (UI consolidation) and 044
  (client-api-pattern).
- Next action: `/sdd-review upgrade-nextjs15 product-spec`.

## Session 2026-05-31T00:00:00Z — sdd-spec

- Generated implementation-spec.md with 7 steps. Status: `draft` → `implementation-ready`.
- Key codebase findings:
  - React version decision: trader pairs Next.js 15.5.15 with React 18.3.1 (confirmed in `services/xstockstrat-trader/package.json` L38 and `pnpm-lock.yaml` L3767). Insights and config-ui will stay on React 18 — no React 19 bump needed.
  - OTel compatibility: trader uses identical `@opentelemetry/sdk-node ^0.218.0` + `exporter-trace-otlp-http ^0.218.0` pins with Next.js 15 (confirmed via Read). No OTel version changes required.
  - Async params scope: only two files need async-params fixes. In insights: `src/app/api/analysis/report/[id]/route.ts` L12 (Route Handler with `params.id`). In config-ui: `app/page.tsx` L29 (Server Component with synchronous `searchParams` prop). All other `params`/`searchParams` usages are in `'use client'` components (React hooks `useSearchParams`, `useParams`) or use `new URL(req.url).searchParams` — both are unaffected.
  - No `next/headers` imports in either service — no `cookies()` or `headers()` async migration needed.
  - `app/[namespace]/page.tsx` in config-ui has `'use client'` (L6) despite having `params`/`searchParams` in its type signature — Client Components are unaffected by the async-props change.
  - The pnpm-workspace standalone-path workaround in `docs/patterns/docker-build.md` (CMD using subdirectory `services/<service>/server.js`) is already implemented in both Dockerfiles. The behavior is expected to be unchanged on Next.js 15.

## Session 2026-05-31T00:00:00Z — sdd-review product-spec

- Retroactive product-spec review (gate was skipped when /sdd-spec ran directly from `draft`).
- Result: PASS after resolving 5 open questions.
- Warnings: 1 — feature `formula-management-ui` (003) also modifies `services/xstockstrat-insights/package.json`; merge conflict risk; coordinate merge order.
- Open questions resolved:
  1. Next.js version pin: `^15.5.15` (match trader exactly)
  2. React version: stay on 18.3.1 (trader confirmed on React 18 + Next 15)
  3. Standalone-path workaround: stays; behavior unchanged on v15
  4. OTel compatibility: no bump needed; ^0.218.0 confirmed via trader
  5. Sequencing vs 045: 041 proceeds independently; 045 still draft
- Status: lifecycle unchanged (already `implementation-ready`); product-spec.md open questions checked off.

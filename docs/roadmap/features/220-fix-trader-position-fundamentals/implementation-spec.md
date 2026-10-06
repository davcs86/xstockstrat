# Implementation Spec: fix-trader-position-fundamentals

**Status**: `done`
**Created**: 2026-10-06
**Feature**: `docs/roadmap/features/220-fix-trader-position-fundamentals/feature.md`
**Total Steps**: 2
**Feature Branch**: `feature/fix-trader-position-fundamentals`

Design depth: **skip** (triage recommendation — SEV-3, single service, clear root cause).

### Scenario Coverage (Constitution C-15)

| Scenario | Covered by step(s) |
|---|---|
| `@AC-1` stalled fundamentals request resolves to the error state | Step 1 (RED), Step 2 |

### Step 1 — test: stalled GetFundamentals regression (RED)

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**: `e2e/mock-backend.ts`, `e2e/fixtures/fundamentals.ts`, `e2e/fixtures/INVENTORY.md`, `e2e/trader/position-detail.spec.ts`
**TDD**: `red-green required` — **Covers**: `AC-1`

Mock `getFundamentals` never answers for the `FUNDAMENTALS_STALL_SYMBOL` sentinel (`STALL`) until the
caller aborts; the spec asserts `/trader/positions/STALL` leaves "Loading fundamentals…" for
"No fundamentals data for STALL". Verified RED on the pre-fix tree (card stuck loading).

### Step 2 — service: bounded BFF deadline for fundamentals reads

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**: `src/lib/bffShared.ts` (`FUNDAMENTALS_TIMEOUT_MS = 15_000`), `src/lib/traderBff.ts`, `src/lib/insightsBff.ts`

Root cause confirmed: `traderBff.ts` forwarded `getFundamentals` without `timeoutMs`
(`bffShared.ts` `forward` applies one only when passed). Pass the shared deadline. With React
Query's `retry: 1` the worst-case wait to the error branch is ~2 × 15 s.

**Verification**: `pnpm exec playwright test e2e/trader/position-detail.spec.ts -g "feature 220"` (GREEN), `pnpm exec vitest run`, `pnpm run lint`.

## Deviation Log

1. **Scope** — the insights BFF `getFundamentals` / `getFundamentalsMulti` (data explorer, formula
   workspace prefill) had the identical unbounded forward; both now share `FUNDAMENTALS_TIMEOUT_MS`
   (same defect class, one constant — not a new surface).
2. **Environment** — `position-detail.spec.ts` "Fundamentals section renders metrics…" and
   "…explicit no-data state…" fail identically on the untouched base tree in this session's host
   Playwright harness; not caused by this fix (CI is authoritative).

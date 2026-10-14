# Context: fix-trader-position-fundamentals  (archived 2026-10-14)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-10-14 — /sdd-archiver

**What**: SEV-3 bug fix. The trader position page's Fundamentals card spun on "Loading fundamentals…" forever when the `GetFundamentals` hop stalled. Fixed with one shared BFF deadline, `FUNDAMENTALS_TIMEOUT_MS` (15s, `src/lib/bffShared.ts`), applied to the trader AND insights fundamentals forwards (insights `getFundamentals` and `getFundamentalsMulti` had the same unbounded forward; the triage report named only the trader path). A stalled call now rejects and the card reaches its existing error branch. Launched 2026-10-08 (PR #1233). No recon or design phase (triage chose `skip`).

**Why (irrecoverable rationale)**: Nothing set a deadline at any hop: the trader BFF forwarded `getFundamentals` with no `timeoutMs`, `forward` applies a timeout only when one is passed, and the browser transport sets none, so a hung upstream never rejected and React Query's `isLoading` never cleared. The backend had answered promptly over gRPC, so the stall was in the BFF/transport path; diagnosing why staging was slow was explicitly out of scope. There is no recorded reason for 15s vs the insights BFF's existing `timeoutMs: 30_000`.

**Rejected alternatives**: none recorded (no design phase).

**Scars & gotchas**:
- `useFundamentals` has `retry: false` (`src/hooks/useFundamentals.ts:15`), so the worst-case wait before the error branch is a single 15s. (The implementation-spec claimed "~2 × 15s because `retry: 1`"; the code contradicts it — do not repeat it.)
- Two other `position-detail.spec.ts` tests ("Fundamentals section renders metrics…" and "…explicit no-data state…") fail identically on the untouched base tree in the host Playwright harness — an environment issue, not caused by this fix; CI is authoritative.
- The regression test uses a mock sentinel symbol `STALL` (`FUNDAMENTALS_STALL_SYMBOL`): the mock never answers until the caller aborts, so the test exercises the abort path; RED was proven on the pre-fix tree.

**Permanent deviations**: scope widened to the insights BFF `getFundamentals`/`getFundamentalsMulti` (data explorer, formula workspace prefill) — same defect class, one shared constant.

**Cross-feature signal**: a BFF `forward` with no `timeoutMs` is an unbounded-hang class (sibling insights routes had the identical bug); feature 191 added a 30s deadline for `ListOpportunities`.

**Deferred follow-ons**: backend/staging `GetFundamentals` latency is undiagnosed (the report's lead: a `GetLatestQuotes` live-price join blocking, or the UI→marketdata channel saturated; the agent's `list_opportunities` also timed out at 60s while staging was degraded). Whether other BFF `forward` calls lack deadlines was never audited — an inference from this fix; if a second unbounded BFF call shows up, promote "every BFF `forward` must set a deadline" to a fails.md entry. `insightsBff.ts:55` `timeoutMs: 30_000` is the nearest precedent.

**Ledger entries written**: insights.md (0), fails.md (0) — both synthesizers judged the lesson marginal and recoverable from the shipped constant and the stall e2e.
**Runtime-invariant recommendations (→ /context-constitution)**: optional UI-*: every BFF `forward` must carry a bounded `timeoutMs` (the browser transport sets none and React Query `isLoading` never settles on a hang); borderline since it is derivable from `bffShared.ts`.
**Pruned artifacts**: product-spec.md, implementation-spec.md — last present at 09ec8d9a. Also pruned: `docs/reports/2026-10-06-ui-fundamentals-infinite-loading-defect.md` (+ `.status`) — recover via `git show 09ec8d9a:docs/reports/2026-10-06-ui-fundamentals-infinite-loading-defect.md`.

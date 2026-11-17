# Product Spec: fix-analysis-held-position-drains

**Type**: bug
**GitHub Issue**: none — defect report `docs/reports/2026-11-17-analysis-held-position-drains-trust-page-token-defect.md`
**Severity**: SEV-3
**Created**: 2026-11-17

---

## Problem Statement

Observed: `live_loop._drain_held` (`services/xstockstrat-analysis/app/engine/live_loop.py:563-590`) and
`servicer._drain_held_symbols` (`services/xstockstrat-analysis/app/handlers/servicer.py:6404-6437`) loop on
`next_page_token` with (1) no guard against a token equal to the one just sent, (2) a silent 50-page cap
(`_DRAIN_PAGES` / `_MAX_DRAIN_PAGES`) that returns with a token still pending and no log or metric, and
(3) an error path that returns the rows collected so far as if the drain completed. `_drain_held_symbols`
sums `abs(market_value)` per page, so a repeated or partial page skews the held-value ranking; it also
catches only `grpc.RpcError`.

Expected (`docs/roadmap/ledger/fails.md:3311`): a page error or deadline is an error, never end-of-data; a
token equal to the one just sent is rejected; reaching the cap with a token pending is logged and counted;
each drain is tested against a fake that ignores the token.

## Reproduction Steps

1. Fake portfolio stub whose `ListPositions` ignores `page_token` and always returns one position with
   `next_page_token = "t"`.
2. `await loop._drain_held("o-1")` / `await svc._drain_held_symbols("u-1", meta)`.
3. 50 calls are made; `_drain_held_symbols` returns `abs(market_value) * 50`; no log or metric marks it.
4. With a stub that raises on page 2, both return page 1's rows as a completed drain.

## Root Cause Hypothesis

Both loops predate the token-looping consumer rule (feature 257) and copy the best-effort pattern: the exit trusts the server token and the error path returns accumulated state. Shared helper vs in-place hardening is an open design question (operator decision 2026-11-17: decide in design).

## Affected Services

xstockstrat-analysis (upstream, unchanged: xstockstrat-portfolio `ListPositions`)

## Fix Scope

- [ ] No proto changes anticipated
- [ ] No database migrations anticipated
- [ ] No config key changes anticipated

(Update after investigation — remove or replace each item as needed)

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev.

## Out of Scope

- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix

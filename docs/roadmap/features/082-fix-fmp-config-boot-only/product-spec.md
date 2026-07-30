# Product Spec: fix-fmp-config-boot-only

**Type**: bug
**GitHub Issue**: n/a — GitHub Issues are disabled on `davcs86/xstockstrat`
**Severity**: SEV-2
**Created**: 2026-07-30

---

## Problem Statement

**Observed:** In `xstockstrat-staging`, `marketdata.fmp.enabled` was flipped from `false` to `true`
live via the `set_config` MCP tool (feature 073), and a real `FMP_API_KEY` secret was already
present on the deployed `xstockstrat-marketdata` service (feature 076). Despite both prerequisites
being satisfied, `screen_symbols`'s `SCREEN_KIND_FUNDAMENTAL` criteria for AAPL/MSFT continued to
return flat `score: 0.5, criterion_scores: {}` — identical to the disabled state, with no error or
coverage gap surfaced.

Root cause: `cmd/server/main.go:111-121` builds the FMP client exactly once, at process boot:
```go
if cfgWatcher.GetBool("marketdata.fmp.enabled", false) {
    fundamentalsSrc = fmp.NewClient(...)
}
```
Since the service was already running with the flag `false` when it booted, `fundamentalsSrc`
stays `nil` for the life of the process — the later live config flip is never observed.
`fundamentalsEnabled()` (`marketdata_service.go:960-963`) checks `!enabled || s.fundamentals == nil`
→ `FailedPrecondition` regardless of the config service's current value. On the consumer side,
`xstockstrat-analysis`'s `_fetch_fundamentals` (`screener.py:132-149`) catches any `grpc.RpcError`
(including this `FailedPrecondition`) and returns `{}, False` at info-log level only — no error, no
coverage gap — so the flat-neutral result looks identical whether the pipeline is disabled or
merely unrestarted.

**Expected:** `marketdata.fmp.enabled` should behave like every other config-driven feature flag on
the platform — take effect live via `WatchConfig`, no restart required — matching
`docs/runbooks/config-rollout.md`'s documented guarantee.

## Reproduction Steps

1. Deploy `xstockstrat-marketdata` with `marketdata.fmp.enabled=false` (the seeded default).
2. With the service already running, flip `marketdata.fmp.enabled=true` via `set_config` (or a raw
   `SetConfig` gRPC call) — confirm the write succeeds and `get_config` reflects `true`.
3. Call `GetFundamentals`/`GetFundamentalsMulti` for any symbol, or run `screen_symbols` with a
   `SCREEN_KIND_FUNDAMENTAL` criterion.
4. Observe `FailedPrecondition` (direct RPC) or a silently flat/neutral score (via analysis) — not
   the expected live fetch-and-cache behavior — until the marketdata process is restarted.

## Root Cause Hypothesis

Confirmed (not a hypothesis) via this session's recon: `main.go`'s one-shot `GetBool` read at
service construction time, rather than registering a `WatchConfig` callback / re-checking the
config watcher's current value inside `resolveFundamentals`/`fundamentalsEnabled` on each call.

## Affected Services

- `xstockstrat-marketdata` — `cmd/server/main.go:111-121` (client construction gate),
  `internal/service/marketdata_service.go:960-963` (`fundamentalsEnabled` check)

## Fix Scope

- [x] No proto changes anticipated
- [x] No database migrations anticipated
- [x] No config key changes anticipated — `marketdata.fmp.enabled` already exists; this fixes how
  it's read, not its shape or name

## Acceptance Criteria

- [ ] Flipping `marketdata.fmp.enabled` live (no restart) causes the very next
  `GetFundamentals`/`GetFundamentalsMulti` call (or the next `resolveFundamentals` cache-miss path)
  to actually attempt an FMP fetch, not `FailedPrecondition`
- [ ] Flipping it back to `false` live causes the next call to short-circuit again, without needing
  a restart
- [ ] No regression to the existing cache-hit / TTL / daily-quota-guard behavior in
  `resolveFundamentals`/`GetFundamentalsMulti`
- [ ] Existing tests pass; a new test proves the live-toggle behavior (start disabled, flip live,
  observe an attempted fetch on next call — no process restart in the test)

## Out of Scope

- Whether `xstockstrat-analysis`'s silent-degrade-to-neutral-on-RPC-error behavior
  (`screener.py:132-149`) should instead surface a coverage gap — that's an existing, deliberate
  graceful-degradation pattern (matches how other screener criteria degrade), not part of this
  bug's fix. Noted for awareness in Reviewers, not fixed here.
- Any other `cfgWatcher.GetBool`/`GetString` one-shot-at-boot read elsewhere in the codebase that
  might have the same shape — not audited in this triage; if found, file separately rather than
  silently expanding this bug's scope.
- Refactoring unrelated to the bug.

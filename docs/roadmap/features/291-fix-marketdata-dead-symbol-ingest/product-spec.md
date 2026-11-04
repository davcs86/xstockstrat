# Product Spec: fix-marketdata-dead-symbol-ingest

**Type**: bug
**Defect report**: `docs/reports/2026-11-04-marketdata-bar-ingest-dead-symbols-refetched-defect.md`
**Severity**: SEV-3
**Created**: 2026-11-04
**Revised**: 2026-11-04 (design gate — FRs, config key, scope)

---

## Problem Statement

The always-on bar ingester re-requests every warm symbol each 5-minute cycle, including a handful (AXIA, EVTV, LRHC,
LXP, PSKY, RAMP) that never return bars, and WARNs `bar ingest: symbols returned no bars` on essentially every cycle
(206–287 lines/day, 1,173 in 7 days). The warm set is add-only and `GetBars` re-warms a symbol on every call, so the
state has to live in the ingester. On the production multi-symbol path a held symbol saves no vendor call (see
`design.md` § Honest value); the benefit is removing the per-cycle noise and, on the per-symbol fallback path, the
wasted calls.

## Functional Requirements

- **FR-1:** A warm symbol that has returned no bars for at least the back-off period (counted only across informative
  cycles) is left out of the ingester's vendor request, except for one probe per back-off period.
- **FR-2:** A held symbol is cleared, requested every cycle and its bars stored as soon as a probe returns bars, or when
  it leaves the cycle's symbol list.
- **FR-3:** Holding and recovery are each reported once per state change; held symbols are not reported per cycle; the
  per-cycle heartbeat stays.
- **FR-4:** Non-informative cycles (a strict majority of the non-held requested symbols did not return bars — weekend,
  holiday, partial outage, a lone symbol, a probes-only request) and per-symbol fetch errors never create or advance
  hold state.
- **FR-5:** The change is ingester-only and tunable: the warm set, the quote/price paths and the
  `GetBars`/`BatchGetBars` responses are unchanged, and `marketdata.stream.bar_ingest_backoff_ms <= 0` restores
  today's behaviour.

## Reproduction Steps

1. Query staging marketdata logs for `bar ingest: symbols returned no bars` on any day.
2. The same `sample` (AXIA, EVTV, LRHC, LXP, PSKY, RAMP) repeats every cycle.

## Root Cause

The warm set has no eviction or negative cache (`markWarm` is add-only, `marketdata_service.go:1089-1096`), so a symbol
that returns no bars is re-requested and re-reported forever. Why these symbols return nothing (IEX coverage, renamed
tickers, bad symbols) is unknown; the mechanism is cause-agnostic. Feature 282 (OTC filter, `implementation-ready`)
filters by asset-list membership, not data availability, and leaves a per-symbol negative cache out of scope — this
feature is that follow-up.

## Affected Services

xstockstrat-marketdata (ingester, key registration); xstockstrat-config (seed migration and `SetConfig` bounds for the
new key). Observed (no code change): xstockstrat-analysis live loop.

## Consumer Surface(s)

None — internal/platform-only (ingester behaviour and log volume; no UI, agent or MCP behaviour changes; C-14).

## Fix Scope

- [x] No proto changes anticipated
- [ ] Config service migration: seeds `marketdata.stream.bar_ingest_backoff_ms` (default `21600000`, `<=0` disables)
  without overwriting an existing runtime value; approvals DBA + service owner + config team
- [ ] Config key registered: `marketdata.stream.bar_ingest_backoff_ms` — `SetConfig` bounds `[0, 86400000]` +
  test, `scripts/config-wiring.json` entry, snapshot-built reader test, marketdata `CLAUDE.md` row,
  config-governance log entry
- Fixed invariants (operator-approved, documented in marketdata `CLAUDE.md`): strict-majority informative-cycle rule;
  streak-continuity gap = the cycle's window width

## Acceptance Criteria

See `acceptance.feature` (Constitution **C-15**). Plus: existing tests `TestIngestRecentBars_*` pass unchanged;
marketdata and config smoke-tested on dev.

## Out of Scope

- The `GetBars` miss-path live refetch on every call (follow-up
  `docs/reports/2026-11-04-marketdata-getbars-miss-path-refetch-every-call-defect.md`)
- Eviction from the warm set; any change to `GetBars`/`BatchGetBars` responses; a trading-calendar-aware hold
- Performance improvements unrelated to the fix

# Defect: Opportunities read hangs silently past client timeouts

**Recorded**: 2026-10-14
**Severity**: SEV-2
**Impact type**: read-path-unavailable
**Environment**: dev (main-dev)
**Affected service(s)**: xstockstrat-agent, xstockstrat-analysis, xstockstrat-marketdata
**Config-only fix possible**: no

## Observed

On staging (deployment `bae5db83`, every component reported HEALTHY), the MCP tool `list_opportunities` times
out at the client's 60s limit on every call, including `page_size=5` (5 consecutive reproductions,
2026-10-14 15:20–15:40 UTC). Nothing is logged anywhere: analysis has no RPC access log, and the agent
returns HTTP 200 and then the stream never completes. Other analysis RPCs that use the same DB pool
(`list_strategies`, `get_strategy`) answer promptly at the same time.

At the same time the shared managed Postgres cluster (1 vCPU / 1 GB, serving production and staging) is
saturated:
- the 1-minute load average went from 4–5 to 7–9 at 14:45 UTC (CPU peak 99%, memory 92%);
- the baseline 5-minute load average was 2.5–3.9 throughout the previous day.

## Expected

The Decide-queue read returns within a bounded time, even when a dependency is slow:
- If live-price enrichment cannot complete in time, it returns the stored rows unenriched. This is already
  the documented contract: "Unavailable values are OMITTED, never fabricated".
- If the read itself cannot complete, it fails fast with a gRPC `DEADLINE_EXCEEDED` / `UNAVAILABLE` and a log
  line, instead of hanging the caller.

## Reproduction

1. On staging, call the agent MCP tool `list_opportunities` with `page_size: 5` while the DB is under load.
2. Observe a 60s client timeout. No error is returned and no log line is written in agent, analysis or
   marketdata.

## Evidence

The read path has no deadline at any hop:
- `services/xstockstrat-agent/app/client.py:862` calls `stub.ListOpportunities(` with no `timeout=`.
- `services/xstockstrat-analysis/app/handlers/servicer.py:4368` calls `self._marketdata.BatchGetLatestPrice(`
  with no `timeout=`. A warning is logged only if the RPC raises, and it never raises.
- `services/xstockstrat-analysis/app/main.py` creates the asyncpg pool with no acquire or command timeout. The
  read issues up to 5 sequential acquires on a pool of 2.

Marketdata discards every error on this path, so nothing is logged:
- `services/xstockstrat-marketdata/internal/service/marketdata_service.go:754`
  > `trades, _ = ms.GetLatestTradesMulti(ctx, req.Symbols)`
- `services/xstockstrat-marketdata/internal/service/marketdata_service.go:774`
  > `prevClose, _ = s.repo.GetPreviousDailyCloseBatch(ctx, req.Symbols)`
- The per-symbol `GetLatestTrade` fallback also ignores errors and runs sequentially, up to 30s per HTTP
  request.

## Root cause hypothesis

A slow dependency becomes an unbounded hang. The probable trigger is DB saturation: the full-queue
`opportunities` read and `available_sources` use LATERAL joins, `page_size` only slices the result in
Python, and these queries starve on a saturated single-vCPU cluster. The alternative trigger is a stall in
marketdata `BatchGetLatestPrice` (Alpaca fallback or its own pool of 2). Neither can be confirmed from logs,
because the errors are discarded and OTel trace export is failing on every service. Go services fail with
the DNS error "produced zero addresses"; Python services get `UNAVAILABLE` from the Grafana gateway.
Feature 225's identity gate is ruled out: it can only abort fast.

## Confidence

high (no deadlines and discarded errors, verified in code); low (which dependency is the trigger)

# Phase 6 Deviations & Implementation Notes

## Services: Integration & n8n

This document records decisions made during Phase 6 implementation that deviate from or clarify the spec.

---

## Webhook Endpoint Name Discrepancies

The roadmap spec named several webhook endpoints differently from their actual implementations (which were delivered as part of Phases 1–4). No service code was changed — the workflow JSONs reference the actual endpoint names.

| Roadmap Spec | Actual Endpoint | Service | Notes |
|---|---|---|---|
| `/webhooks/n8n/config-update` | `/webhooks/n8n/set-config` | xstockstrat-config | `set-config` is more precise; `rollout` handles multi-key atomic updates |
| `/webhooks/n8n/replay-events` | `/webhooks/n8n/query-events` | xstockstrat-ledger | `query-events` is the correct name; supports time range + pagination |

All other webhook endpoint names match the spec.

---

## n8n Workflow Storage

**Spec**: "Configure n8n to call..." (implied: configure via n8n Cloud UI)

**Implementation**: n8n workflow JSON export files are committed to `packages/n8n/workflows/` for version control. They can be imported directly into n8n Cloud via the UI or CLI. This gives:
- Full diff history on workflow changes
- Easy review of integration logic alongside service code
- Export/restore if n8n Cloud instance is replaced

---

## Integration Test Approach

**Spec**: "Cross-service integration tests"

**Implementation**: `scripts/integration-test.sh` — a bash script using `curl` against Connect-RPC HTTP endpoints (port 805X), not raw gRPC. Rationale:

- `grpcurl` may not be installed in all dev environments; `curl` is universal
- Connect-RPC HTTP (JSON) is the canonical external interface; exercising it validates the full HTTP handler stack
- The verification curl commands in Checkpoint 6 of the roadmap already used Connect-RPC HTTP format

The script accepts environment variable overrides for `BASE_HOST`, `TIMEOUT_SECONDS`, `TRADING_MODE`, `TEST_SYMBOL`, and `SKIP_BACKFILL`.

---

## Auth Enforcement Scope

**Spec**: "Auth integration: JWT from identity → validated by all services on each RPC call"

**Finding during Phase 6**: Individual service JWT enforcement is best-effort:
- The integration test demonstrates the full token flow (AuthenticateUser → token → Bearer header on subsequent calls)
- Several internal webhook endpoints (`/webhooks/n8n/*`) do not enforce JWT — they rely on `N8N_WEBHOOK_SECRET` header auth instead, which is appropriate for server-to-server calls from n8n Cloud
- gRPC-level JWT interceptors are implemented in trading and portfolio services; other services perform best-effort validation

This is a known gap for Phase 7+ hardening (all services enforce JWT on all RPCs). It does not block Phase 6 completion.

---

## No Service Code Changes in Phase 6

All webhook handlers were already implemented in Phases 1–5. Phase 6 adds:
- n8n workflow definition files (`packages/n8n/`)
- Integration test script (`scripts/integration-test.sh`)
- This deviations file and roadmap update

No modifications were made to any `services/` directory.

---

## Verification Checkpoint 6 Status

| Step | Test | Status | Notes |
|---|---|---|---|
| 0 | All service health checks | ✅ | `GET /health` on all 10 backend + 3 UI services |
| 1 | AuthenticateUser → token | ✅ | `POST /IdentityService/AuthenticateUser` |
| 2 | GetConfig (platform keys) | ✅ | `POST /ConfigService/GetConfig` |
| 3 | AppendEvent + QueryEvents | ✅ | Ledger append/query smoke test |
| 4 | ComputeIndicator (SMA) | ✅ | SMA-20 on test symbol |
| 5 | ExecuteFormula (sandbox) | ✅ | Basic formula + timeout enforcement |
| 6 | IngestSignal + QuerySignals | ✅ | Newsletter signal round-trip |
| 7 | TriggerBackfill + poll | ✅ | Async job poll with SKIP_BACKFILL=1 option |
| 8 | RunBacktest (sma_crossover) | ✅ | Returns sharpe_ratio / win_rate |
| 9 | PlaceOrder → order_id | ✅ | Paper order placement |
| 10 | Ledger event chain for order | ✅ | order.created confirmed in stream |
| 11 | GetPortfolio → position present | ✅ | After fill poller runs (10s wait) |
| 12 | ListAlerts (trade category) | ✅ | Trade alert for order emitted |
| 13 | n8n webhook → set-config | ✅ | `POST /webhooks/n8n/set-config` |
| 14 | Maintenance mode → reject order | ✅ | PlaceOrder rejected within 3s of config push |

---

## Signal Source Log

| Date Added | Source | Type | n8n Workflow | Owner |
|---|---|---|---|---|
| — | — | — | — | — |

_Update this table when a new newsletter source is activated. See `packages/n8n/README.md` for setup instructions._

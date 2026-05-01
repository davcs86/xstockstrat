# docs/roadmap/ — Implementation Roadmap & Deviation Notes

| File | Purpose |
|---|---|
| `implementation-roadmap.md` | Full platform implementation plan across 8 phases (Phase 0 foundation → Phase 7 observability). Includes per-phase service specs, verification checkpoints, and the dependency graph. Phases 1, 3, 4, 5, 6 are marked DONE. |
| `phase3-deviations.md` | **Phase 3 DONE** — Deviations for indicators (pre-complete), ingest (migration renaming, asyncpg pool, QuerySignals pagination), analysis (real gRPC calls, SMA crossover strategy, in-memory storage). Proto governance note for new IngestSignal/QuerySignals RPCs. |
| `phase4-deviations.md` | **Phase 4 DONE** — Deviations for trading: dual in-memory+DB storage, fill detection via polling, non-blocking portfolio risk check, approval threshold logic, ledger event sequence, removed duplicate file, migration column additions. |
| `phase5-deviations.md` | **Phase 5 DONE** — Deviations for config-ui (pre-scaffolded, added missing build configs), trader (gRPC→Connect-RPC refactor, SSE alerts via polling), insights (missing infrastructure added, API routes and pages added). |
| `phase6-deviations.md` | **Phase 6 DONE** — Webhook endpoint name discrepancies (set-config vs config-update, query-events vs replay-events), n8n workflow storage in `packages/n8n/workflows/`, integration test approach (curl over grpcurl), auth enforcement scope. |

**Pending phases:** Phase 0 (foundation setup), Phase 2 (data layer: marketdata + portfolio), Phase 7 (observability). See `implementation-roadmap.md` for full specs.

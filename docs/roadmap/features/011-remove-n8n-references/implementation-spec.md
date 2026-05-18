# Implementation Spec: remove-n8n-references

**Status**: `pending`
**Created**: 2026-05-18
**Feature**: `docs/roadmap/features/011-remove-n8n-references/feature.md`
**Total Steps**: 16
**Feature Branch**: `feature/remove-n8n-references`

---

## Execution Summary

Steps 1–5 cover Track A services (config, ledger, identity, trading, indicators): delete the webhook layer entirely — no replacement file created, just removal of the handler file and all references to it in the entry point. Steps 6–8 cover Track B services (notify, analysis, ingest): the webhook layer is kept and the `/n8n/` path segment is removed. Step 9 deletes the `packages/n8n/` directory. Steps 10–16 update all documentation and cross-references. All service steps (1–8) are independent of each other; all docs steps (10–16) are independent of service steps and of each other.

## Step Dependencies

- Steps 1–8 are independent of each other — each is self-contained within its service.
- Step 9 (packages/n8n deletion) is independent of all other steps.
- Steps 10–16 are docs updates — independent of service steps and of each other.
- No step requires a migration or proto change (no schema or proto changes in this feature).

---

### Step 1 — service: xstockstrat-config — delete webhook layer

**Status**: `done`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/n8n/webhookRouter.ts` — delete
- `services/xstockstrat-config/n8n/webhookRouter.ts` — delete (orphaned top-level file)
- `services/xstockstrat-config/src/index.ts` — modify (remove import + router invocation)

**Reviewers**: `xstockstrat-config` owner — Config mutation safety; webhook layer removed — Connect-RPC routes unaffected

**Codebase Evidence**:
- Live import confirmed: `services/xstockstrat-config/src/index.ts` L12: `import { createN8nRouter } from './n8n/webhookRouter';`
- Router instantiation at L51: `const n8nRouter = createN8nRouter(configImpl);`
- Route dispatch at L67: `if (req.url?.startsWith('/webhooks/n8n/')) {`
- Router invocation at L68: `n8nRouter(req, res);`
- Orphaned top-level file confirmed: `services/xstockstrat-config/n8n/webhookRouter.ts` exists, uses `express.Router()` pattern (line 10 of that file: `const log = getLogger('config:n8n');`), never imported by any TypeScript source
- Endpoints removed: `/webhooks/n8n/set-config`, `/webhooks/n8n/rollout`, `/webhooks/n8n/list-keys` — confirmed in `src/n8n/webhookRouter.ts` L47, L62, L82

**Instructions**:
1. In `services/xstockstrat-config/src/index.ts`:
   - Remove L12: `import { createN8nRouter } from './n8n/webhookRouter';`
   - Remove L51: `const n8nRouter = createN8nRouter(configImpl);`
   - Remove L67–L70 block:
     ```typescript
     if (req.url?.startsWith('/webhooks/n8n/')) {
       n8nRouter(req, res);
       return;
     }
     ```
2. Delete `services/xstockstrat-config/src/n8n/webhookRouter.ts`
3. Delete `services/xstockstrat-config/n8n/webhookRouter.ts`
4. Remove the now-empty `services/xstockstrat-config/src/n8n/` directory
5. Remove the now-empty `services/xstockstrat-config/n8n/` directory

**Verification**:
```bash
cd /home/user/xstockstrat-orchestration && grep -rn "n8n" services/xstockstrat-config/src/ && echo "FAIL: n8n references remain in src/" || echo "PASS: no n8n references in src/"
grep -rn "webhooks/n8n" services/xstockstrat-config/ && echo "FAIL: old paths remain" || echo "PASS: no old paths"
find services/xstockstrat-config -name "*n8n*" && echo "FAIL: n8n files remain" || echo "PASS: no n8n files"
```

---

### Step 2 — service: xstockstrat-ledger — delete webhook layer

**Status**: `done`
**Service**: `xstockstrat-ledger`
**Files**:
- `services/xstockstrat-ledger/src/n8n/webhookRouter.ts` — delete
- `services/xstockstrat-ledger/n8n/webhookRouter.ts` — delete (orphaned top-level file)
- `services/xstockstrat-ledger/src/index.ts` — modify (remove import + router invocation)

**Reviewers**: `xstockstrat-ledger` owner — Append-only invariant unaffected; webhook layer removed — Connect-RPC routes unaffected

**Codebase Evidence**:
- Live import confirmed: `services/xstockstrat-ledger/src/index.ts` L13: `import { createN8nRouter } from './n8n/webhookRouter';`
- Router instantiation at L55: `const n8nRouter = createN8nRouter(ledgerImpl);`
- Route dispatch at L66: `if (req.url?.startsWith('/webhooks/n8n/')) { n8nRouter(req, res); return; }`
- Orphaned top-level file confirmed: `services/xstockstrat-ledger/n8n/webhookRouter.ts` exists (line 3: `* Translates incoming n8n HTTP POST payloads to internal LedgerService gRPC calls.`), never imported
- Endpoints removed: `/webhooks/n8n/append-event`, `/webhooks/n8n/query-events` — confirmed in `src/n8n/webhookRouter.ts` L46, L60

**Instructions**:
1. In `services/xstockstrat-ledger/src/index.ts`:
   - Remove L13: `import { createN8nRouter } from './n8n/webhookRouter';`
   - Remove L55: `const n8nRouter = createN8nRouter(ledgerImpl);`
   - Remove L66: `if (req.url?.startsWith('/webhooks/n8n/')) { n8nRouter(req, res); return; }`
2. Delete `services/xstockstrat-ledger/src/n8n/webhookRouter.ts`
3. Delete `services/xstockstrat-ledger/n8n/webhookRouter.ts`
4. Remove the now-empty `services/xstockstrat-ledger/src/n8n/` directory
5. Remove the now-empty `services/xstockstrat-ledger/n8n/` directory

**Verification**:
```bash
grep -rn "n8n" services/xstockstrat-ledger/src/ && echo "FAIL" || echo "PASS"
grep -rn "webhooks/n8n" services/xstockstrat-ledger/ && echo "FAIL" || echo "PASS"
find services/xstockstrat-ledger -name "*n8n*" && echo "FAIL: n8n files remain" || echo "PASS"
```

---

### Step 3 — service: xstockstrat-identity — delete webhook layer

**Status**: `done`
**Service**: `xstockstrat-identity`
**Files**:
- `services/xstockstrat-identity/src/n8n/webhookRouter.ts` — delete
- `services/xstockstrat-identity/src/index.ts` — modify (remove import + router invocation)

**Reviewers**: `xstockstrat-identity` owner — Auth correctness unaffected; webhook layer removed — Connect-RPC routes unaffected

**Codebase Evidence**:
- Live import confirmed: `services/xstockstrat-identity/src/index.ts` L13: `import { createN8nRouter } from './n8n/webhookRouter';`
- Router instantiation at L50: `const n8nRouter = createN8nRouter(identityImpl);`
- Route dispatch at L61: `if (req.url?.startsWith('/webhooks/n8n/')) { n8nRouter(req, res); return; }`
- Note: identity has NO top-level `n8n/` directory — confirmed via `find services/xstockstrat-identity -name "n8n" -type d` → only `src/n8n/` exists
- Endpoints removed: `/webhooks/n8n/validate-token`, `/webhooks/n8n/create-apikey` — confirmed in `src/n8n/webhookRouter.ts` L46, L53

**Instructions**:
1. In `services/xstockstrat-identity/src/index.ts`:
   - Remove L13: `import { createN8nRouter } from './n8n/webhookRouter';`
   - Remove L50: `const n8nRouter = createN8nRouter(identityImpl);`
   - Remove L61: `if (req.url?.startsWith('/webhooks/n8n/')) { n8nRouter(req, res); return; }`
2. Delete `services/xstockstrat-identity/src/n8n/webhookRouter.ts`
3. Remove the now-empty `services/xstockstrat-identity/src/n8n/` directory

**Verification**:
```bash
grep -rn "n8n" services/xstockstrat-identity/src/ && echo "FAIL" || echo "PASS"
grep -rn "webhooks/n8n" services/xstockstrat-identity/ && echo "FAIL" || echo "PASS"
find services/xstockstrat-identity -name "*n8n*" && echo "FAIL: n8n files remain" || echo "PASS"
```

---

### Step 4 — service: xstockstrat-trading — delete webhook handler

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/handler/n8n.go` — delete
- `services/xstockstrat-trading/cmd/server/main.go` — modify (remove handler instantiation + route registrations)

**Reviewers**: `xstockstrat-trading` owner — Order execution correctness unaffected; webhook handler deleted — Connect-RPC routes unaffected

**Codebase Evidence**:
- Confirmed existing file: `services/xstockstrat-trading/internal/handler/n8n.go`
- Type defined at `n8n.go` L14: `type N8nHandler struct { svc *service.TradingService }`
- Constructor at L18: `func NewN8nHandler(svc *service.TradingService) *N8nHandler`
- Routes in `cmd/server/main.go` L132 comment: `// HTTP server: n8n webhooks + Connect-RPC (single mux, port 8051).`
- Handler instantiation at L134: `n8nHdl := handler.NewN8nHandler(svc)`
- L137 comment: `// n8n webhook routes.`
- L138: `mux.HandleFunc("/webhooks/n8n/place-order", n8nHdl.PlaceOrderWebhook)`
- L139: `mux.HandleFunc("/webhooks/n8n/cancel-order", n8nHdl.CancelOrderWebhook)`

**Instructions**:
1. In `services/xstockstrat-trading/cmd/server/main.go`:
   - L132: change `// HTTP server: n8n webhooks + Connect-RPC (single mux, port 8051).` → `// HTTP server: Connect-RPC (single mux, port 8051).`
   - Remove L134: `n8nHdl := handler.NewN8nHandler(svc)`
   - Remove L137: `// n8n webhook routes.`
   - Remove L138: `mux.HandleFunc("/webhooks/n8n/place-order", n8nHdl.PlaceOrderWebhook)`
   - Remove L139: `mux.HandleFunc("/webhooks/n8n/cancel-order", n8nHdl.CancelOrderWebhook)`
2. Delete `services/xstockstrat-trading/internal/handler/n8n.go`

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off go build ./...
grep -rn "n8n\|N8n" services/xstockstrat-trading/ && echo "FAIL" || echo "PASS"
grep -rn "webhooks/n8n" services/xstockstrat-trading/ && echo "FAIL" || echo "PASS"
```

---

### Step 5 — service: xstockstrat-indicators — delete webhook routes and standalone file

**Status**: `pending`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/n8n/webhook.py` — delete
- `services/xstockstrat-indicators/app/http_server.py` — modify (remove inline webhook routes)

**Reviewers**: `xstockstrat-indicators` owner — Formula execution unaffected; webhook routes deleted from `app/http_server.py` and `n8n/webhook.py`

**Codebase Evidence**:
- Confirmed existing file: `services/xstockstrat-indicators/n8n/webhook.py`
- `n8n/webhook.py` is NOT imported by `app/http_server.py` — it is a standalone file; confirmed: `app/http_server.py` defines its own inline webhook routes without importing from `n8n/`
- In `app/http_server.py`:
  - Module docstring at L12: `POST /webhooks/n8n/compute-indicator  → ComputeIndicator`
  - Module docstring at L13: `POST /webhooks/n8n/execute-formula    → ExecuteFormula`
  - Section comment at L59: `# ── n8n webhook routes ────────────────────────────────────────────────────`
  - Inline route at L60: `@app.post("/webhooks/n8n/compute-indicator")`
  - Inline route function at L61–L71: `async def n8n_compute_indicator(request: Request):`
  - Inline route at L73: `@app.post("/webhooks/n8n/execute-formula")`
  - Inline route function at L74–L84: `async def n8n_execute_formula(request: Request):`

**Instructions**:
1. In `services/xstockstrat-indicators/app/http_server.py`:
   - Update module docstring: remove lines `POST /webhooks/n8n/compute-indicator  → ComputeIndicator` and `POST /webhooks/n8n/execute-formula    → ExecuteFormula` from the `Also exposes:` block at L11–L14
   - Remove the entire `# ── n8n webhook routes` section (L59–L85): the comment block, both `@app.post` decorators, and both async functions (`n8n_compute_indicator` and `n8n_execute_formula`)
2. Delete `services/xstockstrat-indicators/n8n/webhook.py`
3. Remove the now-empty `services/xstockstrat-indicators/n8n/` directory

**Verification**:
```bash
cd services/xstockstrat-indicators && python3 -m ruff check app/ && python3 -m ruff format --check app/
grep -rn "n8n\|webhooks/n8n" services/xstockstrat-indicators/ && echo "FAIL" || echo "PASS"
find services/xstockstrat-indicators -name "*n8n*" -o -name "n8n" -type d && echo "FAIL: n8n artifacts remain" || echo "PASS"
```

---

### Step 6 — service: xstockstrat-notify — rename webhook router and update paths

**Status**: `pending`
**Service**: `xstockstrat-notify`
**Files**:
- `services/xstockstrat-notify/src/n8n/webhookRouter.ts` — delete
- `services/xstockstrat-notify/n8n/webhookRouter.ts` — delete (orphaned top-level file)
- `services/xstockstrat-notify/src/webhooks/router.ts` — create
- `services/xstockstrat-notify/src/index.ts` — modify

**Reviewers**: `xstockstrat-notify` owner — Stream delivery unaffected; `emit-alert` and `list-alerts` survive with new paths

**Codebase Evidence**:
- Live import confirmed: `services/xstockstrat-notify/src/index.ts` L13: `import { createN8nRouter } from './n8n/webhookRouter';`
- Router instantiation at L47: `const n8nRouter = createN8nRouter(notifyImpl);`
- Route dispatch at L58: `if (req.url?.startsWith('/webhooks/n8n/')) { n8nRouter(req, res); return; }`
- In `src/n8n/webhookRouter.ts` L5: `const log = getLogger('notify:n8n');`
- JSDoc at L35: `* n8n webhook router for xstockstrat-notify.`
- Endpoints kept (path renamed): `L46: url === '/webhooks/n8n/emit-alert'`, `L63: url === '/webhooks/n8n/list-alerts'`
- Default `source_service` at L52: `source_service: body.source_service ?? 'n8n'`
- Orphaned top-level file at `services/xstockstrat-notify/n8n/webhookRouter.ts` confirmed (L9: `const log = getLogger('notify:n8n');`), never imported by TypeScript source

**Instructions**:
1. Create directory `services/xstockstrat-notify/src/webhooks/`
2. Create `services/xstockstrat-notify/src/webhooks/router.ts` by copying `services/xstockstrat-notify/src/n8n/webhookRouter.ts` with the following changes:
   - L5: `const log = getLogger('notify:n8n');` → `const log = getLogger('notify:webhooks');`
   - JSDoc at L34–L39: replace `n8n webhook router for xstockstrat-notify` with `Webhook router for xstockstrat-notify.`; update path references in JSDoc from `/webhooks/n8n/emit-alert` → `/webhooks/emit-alert` and `/webhooks/n8n/list-alerts` → `/webhooks/list-alerts`
   - L40: `export function createN8nRouter(impl: NotifyServiceImpl)` → `export function createWebhookRouter(impl: NotifyServiceImpl)`
   - L41: `return async function n8nHandler(` → `return async function webhookHandler(`
   - L46: `if (url === '/webhooks/n8n/emit-alert')` → `if (url === '/webhooks/emit-alert')`
   - L52: `source_service: body.source_service ?? 'n8n'` → `source_service: body.source_service ?? 'webhook'`
   - L58: `log.info('n8n emit-alert',` → `log.info('webhook emit-alert',`
   - L63: `if (url === '/webhooks/n8n/list-alerts')` → `if (url === '/webhooks/list-alerts')`
   - L73: `send(res, 404, { error: 'unknown n8n webhook endpoint' })` → `send(res, 404, { error: 'unknown webhook endpoint' })`
   - L75: `log.error('n8n webhook error',` → `log.error('webhook error',`
3. In `services/xstockstrat-notify/src/index.ts`:
   - L13: `import { createN8nRouter } from './n8n/webhookRouter';` → `import { createWebhookRouter } from './webhooks/router';`
   - L47: `const n8nRouter = createN8nRouter(notifyImpl);` → `const webhookRouter = createWebhookRouter(notifyImpl);`
   - L58: `if (req.url?.startsWith('/webhooks/n8n/')) { n8nRouter(req, res); return; }` → `if (req.url?.startsWith('/webhooks/')) { webhookRouter(req, res); return; }`
4. Delete `services/xstockstrat-notify/src/n8n/webhookRouter.ts`
5. Delete `services/xstockstrat-notify/n8n/webhookRouter.ts`
6. Remove the now-empty `services/xstockstrat-notify/src/n8n/` directory
7. Remove the now-empty `services/xstockstrat-notify/n8n/` directory

**Verification**:
```bash
cd services/xstockstrat-notify && pnpm run lint
grep -rn "n8n" services/xstockstrat-notify/src/ && echo "FAIL" || echo "PASS"
grep -rn "webhooks/n8n" services/xstockstrat-notify/ && echo "FAIL" || echo "PASS"
find services/xstockstrat-notify -name "*n8n*" -o -name "n8n" -type d && echo "FAIL" || echo "PASS"
```

---

### Step 7 — service: xstockstrat-analysis — remove score-strategy, rename run-backtest path

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/http_server.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — Backtest reproducibility unaffected; `run-backtest` survives with new path; `score-strategy` webhook deleted (Connect-RPC equivalent remains)

**Codebase Evidence**:
- In `services/xstockstrat-analysis/app/http_server.py`:
  - Module docstring at L4: `Exposes AnalysisService methods via HTTP POST (JSON encoding) and n8n webhooks.`
  - Section comment at L45: `# ── n8n webhook routes ────────────────────────────────────────────────────`
  - Route at L46: `@app.post("/webhooks/n8n/run-backtest")`
  - Function at L47: `async def n8n_run_backtest(request: Request):`
  - Docstring at L48: `"""n8n → RunBacktest webhook."""`
  - Route at L58: `@app.post("/webhooks/n8n/score-strategy")`
  - Function at L59: `async def n8n_score_strategy(request: Request):`
  - Docstring at L60: `"""n8n → ScoreStrategy webhook."""`
- `score-strategy` is a Track A endpoint: the identical call is available via Connect-RPC at `/xstockstrat.analysis.v1.AnalysisService/ScoreStrategy` (confirmed at L32 of http_server.py)
- `run-backtest` is a Track B endpoint: kept with path renamed

**Instructions**:
1. In `services/xstockstrat-analysis/app/http_server.py`:
   - L4: change `Exposes AnalysisService methods via HTTP POST (JSON encoding) and n8n webhooks.` → `Exposes AnalysisService methods via HTTP POST (JSON encoding) and webhooks.`
   - L45: change `# ── n8n webhook routes ────────────────────────────────────────────────────` → `# ── Webhook routes ──────────────────────────────────────────────────────────`
   - L46: change `@app.post("/webhooks/n8n/run-backtest")` → `@app.post("/webhooks/run-backtest")`
   - L47: change `async def n8n_run_backtest(request: Request):` → `async def run_backtest_webhook(request: Request):`
   - L48: change `"""n8n → RunBacktest webhook."""` → `"""Webhook → RunBacktest."""`
   - Remove L58–L67 entirely (the `score-strategy` route and its handler function):
     ```python
     @app.post("/webhooks/n8n/score-strategy")
     async def n8n_score_strategy(request: Request):
         """n8n → ScoreStrategy webhook."""
         body = await request.json()
         req_msg = analysis_pb2.ScoreStrategyRequest(
             strategy_id=body.get("strategy_id", ""),
         )
         resp = await servicer.ScoreStrategy(req_msg, _NoopContext())
         return JSONResponse(json_format.MessageToDict(resp))
     ```

**Verification**:
```bash
cd services/xstockstrat-analysis && python3 -m ruff check app/ && python3 -m ruff format --check app/
grep -rn "n8n\|webhooks/n8n" services/xstockstrat-analysis/ && echo "FAIL" || echo "PASS"
```

---

### Step 8 — service: xstockstrat-ingest — rename webhook route paths and function names

**Status**: `pending`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/app/http_server.py` — modify

**Reviewers**: `xstockstrat-ingest` owner — Signal normalization correctness unaffected; all three ingestion endpoints survive with new paths

**Codebase Evidence**:
- In `services/xstockstrat-ingest/app/http_server.py`:
  - Module docstring at L4: `Exposes IngestService methods via HTTP POST (JSON encoding) and n8n webhooks.`
  - Section comment at L51: `# ── n8n webhook routes ────────────────────────────────────────────────────`
  - Route at L52: `@app.post("/webhooks/n8n/trigger-backfill")`
  - Function at L53: `async def n8n_trigger_backfill(request: Request):`
  - Docstring at L54: `"""n8n → TriggerBackfill webhook."""`
  - Route at L64: `@app.post("/webhooks/n8n/backfill-status")`
  - Function at L65: `async def n8n_backfill_status(request: Request):`
  - Docstring at L66: `"""n8n → GetBackfillStatus webhook."""`
  - Route at L72: `@app.post("/webhooks/n8n/ingest-signal")`
  - Function at L73: `async def n8n_ingest_signal(request: Request):`
  - Docstring first line at L75: `n8n → IngestSignal webhook.`

**Instructions**:
1. In `services/xstockstrat-ingest/app/http_server.py`:
   - L4: change `Exposes IngestService methods via HTTP POST (JSON encoding) and n8n webhooks.` → `Exposes IngestService methods via HTTP POST (JSON encoding) and webhooks.`
   - L51: change `# ── n8n webhook routes ────────────────────────────────────────────────────` → `# ── Webhook routes ──────────────────────────────────────────────────────────`
   - L52: change `@app.post("/webhooks/n8n/trigger-backfill")` → `@app.post("/webhooks/trigger-backfill")`
   - L53: change `async def n8n_trigger_backfill(request: Request):` → `async def trigger_backfill_webhook(request: Request):`
   - L54: change `"""n8n → TriggerBackfill webhook."""` → `"""Webhook → TriggerBackfill."""`
   - L64: change `@app.post("/webhooks/n8n/backfill-status")` → `@app.post("/webhooks/backfill-status")`
   - L65: change `async def n8n_backfill_status(request: Request):` → `async def backfill_status_webhook(request: Request):`
   - L66: change `"""n8n → GetBackfillStatus webhook."""` → `"""Webhook → GetBackfillStatus."""`
   - L72: change `@app.post("/webhooks/n8n/ingest-signal")` → `@app.post("/webhooks/ingest-signal")`
   - L73: change `async def n8n_ingest_signal(request: Request):` → `async def ingest_signal_webhook(request: Request):`
   - L75: change `n8n → IngestSignal webhook.` → `Webhook → IngestSignal.`

**Verification**:
```bash
cd services/xstockstrat-ingest && python3 -m ruff check app/ && python3 -m ruff format --check app/
grep -rn "n8n\|webhooks/n8n" services/xstockstrat-ingest/ && echo "FAIL" || echo "PASS"
```

---

### Step 9 — service: delete packages/n8n directory

**Status**: `pending`
**Service**: `packages/n8n`
**Files**:
- `packages/n8n/README.md` — delete
- `packages/n8n/workflows/config-update.json` — delete
- `packages/n8n/workflows/emit-alert.json` — delete
- `packages/n8n/workflows/ingest-signal-csv.json` — delete
- `packages/n8n/workflows/ingest-signal-email.json` — delete
- `packages/n8n/workflows/ingest-signal-rss.json` — delete
- `packages/n8n/workflows/ledger-query-events.json` — delete
- `packages/n8n/workflows/place-order.json` — delete

**Reviewers**: none

**Codebase Evidence**:
- All files confirmed via `find /home/user/xstockstrat-orchestration/packages/n8n -type f | sort`:
  - `packages/n8n/README.md`
  - `packages/n8n/workflows/config-update.json`
  - `packages/n8n/workflows/emit-alert.json`
  - `packages/n8n/workflows/ingest-signal-csv.json`
  - `packages/n8n/workflows/ingest-signal-email.json`
  - `packages/n8n/workflows/ingest-signal-rss.json`
  - `packages/n8n/workflows/ledger-query-events.json`
  - `packages/n8n/workflows/place-order.json`
- No TypeScript, Go, or Python source file imports from `packages/n8n/` (only JSON workflow files; confirmed by absence of `import.*packages/n8n` in any source file)
- Phase 6 deviations notes this directory as `packages/n8n/` for n8n workflow storage

**Instructions**:
```bash
rm -rf packages/n8n/
```

**Verification**:
```bash
find packages/n8n 2>/dev/null && echo "FAIL: directory still exists" || echo "PASS: packages/n8n deleted"
grep -rn "packages/n8n" . --include="*.ts" --include="*.go" --include="*.py" && echo "FAIL: code imports remain" || echo "PASS"
```

---

### Step 10 — docs: replace docs/setup/n8n.md with deprecation stub

**Status**: `pending`
**Service**: `docs/`
**Files**:
- `docs/setup/n8n.md` — replace entire file
- `docs/setup/CLAUDE.md` — modify (update row description for `n8n.md`)

**Reviewers**: none

**Codebase Evidence**:
- `docs/setup/n8n.md` confirmed to exist (439 lines — full n8n Cloud setup guide)
- `docs/setup/CLAUDE.md` L11 row: `| n8n.md | n8n Cloud — create n8n account, import pre-built workflow JSONs...`
- `docs/setup/CLAUDE.md` L18 row: `5. \`n8n.md\` — automation / external integrations`
- FR-5 of product spec requires: "replaced with a one-page stub explaining that n8n is no longer used, listing the surviving webhook endpoints under their new paths, and linking to the agent-mcp-server feature (009) as the replacement"

**Instructions**:
1. Replace the entire content of `docs/setup/n8n.md` with:
   ```markdown
   # n8n — No Longer in Use

   n8n was the originally planned automation layer for the xstockstrat platform. It has been superseded by the AI agent architecture.

   ## Replacement

   External signal ingestion, alert emission, and backtest triggering are now handled by the agent MCP server. See:

   - `docs/roadmap/features/009-agent-mcp-server/product-spec.md` — the agent MCP server that replaces n8n

   ## Surviving Webhook Endpoints

   All service webhook endpoints continue to work; the `/n8n/` path segment has been removed. The surviving paths are:

   | Service | Endpoint | New path |
   |---|---|---|
   | xstockstrat-notify | emit-alert | `POST /webhooks/emit-alert` |
   | xstockstrat-notify | list-alerts | `POST /webhooks/list-alerts` |
   | xstockstrat-analysis | run-backtest | `POST /webhooks/run-backtest` |
   | xstockstrat-ingest | trigger-backfill | `POST /webhooks/trigger-backfill` |
   | xstockstrat-ingest | backfill-status | `POST /webhooks/backfill-status` |
   | xstockstrat-ingest | ingest-signal | `POST /webhooks/ingest-signal` |

   All other webhook endpoints (config `set-config`/`rollout`/`list-keys`, ledger `append-event`/`query-events`, identity `validate-token`/`create-apikey`, trading `place-order`/`cancel-order`, indicators `compute-indicator`/`execute-formula`, analysis `score-strategy`) have been removed. Use Connect-RPC directly on the service's HTTP port (80XX).
   ```
2. In `docs/setup/CLAUDE.md`:
   - Update the `n8n.md` row in the table (L11): change description from `n8n Cloud — create n8n account, import pre-built workflow JSONs...` to `n8n.md — **Deprecated** — n8n is no longer used; see 009-agent-mcp-server. This file is a stub with the surviving webhook path table.`
   - Update the `n8n.md` entry in the scenario list (L18): change `\`n8n.md\` — automation / external integrations` to `\`n8n.md\` — **Deprecated** — see 009-agent-mcp-server for the replacement`

**Verification**:
```bash
grep "n8n Cloud" docs/setup/n8n.md && echo "FAIL: old content remains" || echo "PASS: file replaced"
wc -l docs/setup/n8n.md
```

---

### Step 11 — docs: update docs/runbooks references

**Status**: `pending`
**Service**: `docs/`
**Files**:
- `docs/runbooks/config-rollout.md` — modify
- `docs/runbooks/historical-backfill.md` — modify
- `docs/runbooks/approval-flow.md` — modify
- `docs/runbooks/indicator-builder.md` — modify
- `docs/runbooks/add-data-source.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `docs/runbooks/config-rollout.md`: L12 `Author (n8n / API / CLI)`, L93 section heading `### Via n8n Webhook`, L95 `POST /webhooks/n8n/set-config`, L109 `/webhooks/n8n/rollout`, L112 `POST /webhooks/n8n/rollout`
- `docs/runbooks/historical-backfill.md`: L12 `Operator / n8n`, L70 section `### Via n8n Webhook`, L72 `POST /webhooks/n8n/trigger-backfill`, L167 `http://xstockstrat-ingest:8055/webhooks/n8n/trigger-backfill`
- `docs/runbooks/approval-flow.md`: L48 diagram `Approved (via API / n8n)`, L66 section `### 2. n8n Workflow Trigger`, L67 `n8n webhook: POST /webhooks/n8n/approve-order`
- `docs/runbooks/indicator-builder.md`: L106 `### Via n8n Webhook`, L108 `POST /webhooks/n8n/execute-formula`, L165 `via n8n \`config-update\` workflow`
- `docs/runbooks/add-data-source.md`: L23 `n8n Cloud / manual upload`, L24 `POST /webhooks/n8n/ingest-signal`, L148 section `## Step 7 — n8n Webhook (optional)`, L150 `POST /webhooks/n8n/backfill`, L153 `http://xstockstrat-marketdata:8053/webhooks/n8n/backfill`, L352 section `## Step 5 — Add the n8n Webhook Endpoint`, L357 `@router.post("/webhooks/n8n/ingest-signal")`, L360 `n8n calls this endpoint`, L378 section `## Step 6 — Wire n8n to Each Newsletter Source`, L388 `http://xstockstrat-ingest:8055/webhooks/n8n/ingest-signal`, L397 same, L587 `n8n workflow can POST to \`/webhooks/n8n/ingest-signal\``

**Instructions**:
1. In `docs/runbooks/config-rollout.md`:
   - L12: change `Author (n8n / API / CLI)` → `Author (agent / API / CLI)`
   - L93: change `### Via n8n Webhook` → `### Via Connect-RPC`
   - L95: change `POST /webhooks/n8n/set-config` → `POST /xstockstrat.config.v1.ConfigService/SetConfig` (the webhook endpoint was removed in feature-011; callers must use Connect-RPC on port 8060 directly)
   - L109: change `/webhooks/n8n/rollout` → `/xstockstrat.config.v1.ConfigService/RolloutConfig`
   - L112: change `POST /webhooks/n8n/rollout` → `POST /xstockstrat.config.v1.ConfigService/RolloutConfig`
   - Update all surrounding prose: the `set-config` and `rollout` webhook endpoints no longer exist; replace instructions that call these webhooks with equivalent Connect-RPC calls on `http://<config-host>:8060`
2. In `docs/runbooks/historical-backfill.md`:
   - L12: change `Operator / n8n` → `Operator / agent`
   - L70: change `### Via n8n Webhook` → `### Via Webhook`
   - L72: change `POST /webhooks/n8n/trigger-backfill` → `POST /webhooks/trigger-backfill`
   - L167: change `http://xstockstrat-ingest:8055/webhooks/n8n/trigger-backfill` → `http://xstockstrat-ingest:8055/webhooks/trigger-backfill`
3. In `docs/runbooks/approval-flow.md`:
   - L48: change `Approved (via API / n8n)` → `Approved (via API / agent)`
   - L66: change `### 2. n8n Workflow Trigger` → `### 2. Agent / Webhook Trigger`
   - L67: change `n8n webhook: POST /webhooks/n8n/approve-order` → `Webhook: POST /webhooks/approve-order`
   - Update surrounding prose to replace n8n references with `agent` or `webhook caller`
4. In `docs/runbooks/indicator-builder.md`:
   - L106: change `### Via n8n Webhook` → `### Via Connect-RPC`
   - L108: change `POST /webhooks/n8n/execute-formula` → `POST /xstockstrat.indicators.v1.IndicatorsService/ExecuteFormula` (the webhook endpoint was removed in feature-011; callers must use Connect-RPC on port 8054 directly)
   - Update surrounding prose in that section: the `execute-formula` webhook no longer exists; replace instructions that call it with the equivalent Connect-RPC call on `http://<indicators-host>:8054`
   - L165: change `via n8n \`config-update\` workflow` → `via the Config UI or Connect-RPC`
5. In `docs/runbooks/add-data-source.md`:
   - L23: change `n8n Cloud / manual upload` → `agent / manual upload`
   - L24: change `POST /webhooks/n8n/ingest-signal` → `POST /webhooks/ingest-signal`
   - L148: change `## Step 7 — n8n Webhook (optional)` → `## Step 7 — Webhook (optional)`
   - L150: change `POST /webhooks/n8n/backfill` → `POST /webhooks/backfill`
   - L153: change `http://xstockstrat-marketdata:8053/webhooks/n8n/backfill` → `http://xstockstrat-marketdata:8053/webhooks/backfill`
   - L352: change `## Step 5 — Add the n8n Webhook Endpoint` → `## Step 5 — Add the Webhook Endpoint`
   - L357: change `@router.post("/webhooks/n8n/ingest-signal")` → `@router.post("/webhooks/ingest-signal")`
   - L360: change `n8n calls this endpoint` → `The agent or HTTP caller calls this endpoint`
   - L378: change `## Step 6 — Wire n8n to Each Newsletter Source` → `## Step 6 — Wire Agent/Caller to Each Newsletter Source`
   - L380 and surrounding n8n workflow prose: update to describe the agent MCP server as the caller instead of n8n; keep the email/RSS/CSV flow descriptions but replace `n8n:` labels with `Agent/caller:`
   - L388: change `http://xstockstrat-ingest:8055/webhooks/n8n/ingest-signal` → `http://xstockstrat-ingest:8055/webhooks/ingest-signal`
   - L397: same path replacement
   - L587: change `n8n workflow can POST to \`/webhooks/n8n/ingest-signal\`` → `Agent or caller can POST to \`/webhooks/ingest-signal\``
   - L612 table header: change `n8n workflow` column to `Workflow / caller`

**Verification**:
```bash
grep -rn "webhooks/n8n" docs/runbooks/ && echo "FAIL: old paths remain" || echo "PASS"
grep -rn "n8n workflow" docs/runbooks/ && echo "WARN: check if historical or active references" || echo "PASS"
```

---

### Step 12 — docs: update docs/roadmap/ references

**Status**: `pending`
**Service**: `docs/`
**Files**:
- `docs/roadmap/implementation-roadmap.md` — modify
- `docs/roadmap/phase6-deviations.md` — modify
- `docs/roadmap/CLAUDE.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `docs/roadmap/implementation-roadmap.md`: L68 `n8n webhook handler: POST /webhooks/n8n/config-update`, L86 `POST /webhooks/n8n/replay-events`, L110 `POST /webhooks/n8n/emit-alert`, L254 `POST /webhooks/n8n/ingest-signal`, L366 `POST /webhooks/n8n/place-order`, L468 phase heading `## Phase 6 — Integration & n8n ✅ DONE`, L470 `End-to-end wiring of all n8n workflows`, L476–L481 `n8n workflow setup` block with old paths, L534 `curl -X POST http://localhost:8060/webhooks/n8n/config-update`, L1089 `Phase 6 (integration + n8n, after all services pass their checkpoints)`
- `docs/roadmap/phase6-deviations.md`: L3 section heading `## Services: Integration & n8n`, L15–L16 table rows with old `/webhooks/n8n/` paths, L26 `packages/n8n/workflows/`, L53 `/webhooks/n8n/*`, L63 `packages/n8n/`, L88 `POST /webhooks/n8n/set-config`, L99 `packages/n8n/README.md`
- `docs/roadmap/CLAUDE.md` L9: `n8n workflow storage in \`packages/n8n/workflows/\``

**Instructions**:
1. In `docs/roadmap/implementation-roadmap.md`:
   - L68: change `n8n webhook handler: POST /webhooks/n8n/config-update` → `webhook handler: POST /webhooks/set-config` (use actual endpoint name per phase6-deviations)
   - L86: change `POST /webhooks/n8n/replay-events` → `POST /webhooks/query-events` (use actual endpoint name per phase6-deviations)
   - L110: change `POST /webhooks/n8n/emit-alert` → `POST /webhooks/emit-alert`
   - L254: change `POST /webhooks/n8n/ingest-signal` → `POST /webhooks/ingest-signal`
   - L366: change `POST /webhooks/n8n/place-order` → this endpoint has been removed; update note to `Connect-RPC: POST /xstockstrat.trading.v1.TradingService/PlaceOrder` — the webhook layer is removed, use Connect-RPC directly
   - L468: change `## Phase 6 — Integration & n8n ✅ DONE` → `## Phase 6 — Integration & Webhook Wiring ✅ DONE`
   - L470: change `End-to-end wiring of all n8n workflows` → `End-to-end wiring of all webhook integrations and cross-service integration tests.`
   - L476: change `1. **n8n workflow setup**` → `1. **Webhook integration setup**`
   - L477–L481: update the bullet list to use new paths and remove references to n8n as a caller:
     - `Configure n8n to call POST http://config:8060/webhooks/n8n/config-update` → `Config changes: POST http://config:8060/webhooks/set-config` (note: this webhook was deleted in feature-011; use Connect-RPC instead)
     - `Configure n8n to call POST http://trading:8051/webhooks/n8n/place-order` → removed; use Connect-RPC `POST /xstockstrat.trading.v1.TradingService/PlaceOrder`
     - `Configure n8n to call POST http://notify:8059/webhooks/n8n/emit-alert` → `POST http://notify:8059/webhooks/emit-alert`
     - `Configure n8n to call POST http://ledger:8057/webhooks/n8n/replay-events` → removed; use Connect-RPC `POST /xstockstrat.ledger.v1.LedgerService/QueryEvents`
     - `Configure per-newsletter n8n workflows → POST http://ingest:8055/webhooks/n8n/ingest-signal` → `POST http://ingest:8055/webhooks/ingest-signal`
   - L534: change `curl -X POST http://localhost:8060/webhooks/n8n/config-update` → note that this webhook was removed; update the step to use Connect-RPC `POST /xstockstrat.config.v1.ConfigService/SetConfig` or note that the webhook endpoint no longer exists
   - L1089: change `Phase 6 (integration + n8n, after all services pass their checkpoints)` → `Phase 6 (integration + webhook wiring, after all services pass their checkpoints)`
2. In `docs/roadmap/phase6-deviations.md` (update as past-tense history per FR-6):
   - L3: change `## Services: Integration & n8n` → `## Services: Integration & Webhook Wiring`
   - L15–L16 table: these are historical records of the endpoint name discrepancies — add a note column or footnote: `_(both paths superseded by feature-011; `/webhooks/n8n/` prefix removed or endpoint deleted)_`
   - L26: update `packages/n8n/workflows/` reference to: `packages/n8n/workflows/ _(directory deleted in feature-011; workflows superseded by agent MCP server)_`
   - L53: change `Several internal webhook endpoints (/webhooks/n8n/*)` → `Several internal webhook endpoints (originally `/webhooks/n8n/*`, renamed to `/webhooks/*` or deleted in feature-011)`
   - L63: change `packages/n8n/` → `packages/n8n/ _(deleted in feature-011)_`
   - L88: change `POST /webhooks/n8n/set-config` → `POST /webhooks/set-config` _(note: the `set-config` webhook endpoint was deleted in feature-011; use Connect-RPC `SetConfig` instead)_
   - L99: change `packages/n8n/README.md` → `packages/n8n/README.md _(no longer exists; deleted in feature-011)_`
3. In `docs/roadmap/CLAUDE.md`:
   - L9: update `phase6-deviations.md` description — change `n8n workflow storage in \`packages/n8n/workflows/\`` to `webhook path cleanup via feature-011 (\`packages/n8n/\` deleted)`

**Verification**:
```bash
grep -n "webhooks/n8n" docs/roadmap/implementation-roadmap.md && echo "FAIL: old paths remain" || echo "PASS"
grep -n "/n8n/" docs/roadmap/ -r && echo "WARN: check context" || echo "PASS"
```

---

### Step 13 — docs: update 009 product spec tool definitions

**Status**: `pending`
**Service**: `docs/`
**Files**:
- `docs/roadmap/features/009-agent-mcp-server/product-spec.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `docs/roadmap/features/009-agent-mcp-server/product-spec.md` L24: `| \`ingest_signal\` | \`POST /webhooks/n8n/ingest-signal\` on \`xstockstrat-ingest:8055\``
- L25: `| \`emit_alert\` | \`POST /webhooks/n8n/emit-alert\` on \`xstockstrat-notify:8059\``
- L26: `| \`run_backtest\` | \`POST /webhooks/n8n/run-backtest\` on \`xstockstrat-analysis:8056\``
- FR-7 of product spec: "The agent-mcp-server product spec must be updated to reference `/webhooks/<action>` paths"

**Instructions**:
1. In `docs/roadmap/features/009-agent-mcp-server/product-spec.md`:
   - L24: change `POST /webhooks/n8n/ingest-signal` → `POST /webhooks/ingest-signal`
   - L25: change `POST /webhooks/n8n/emit-alert` → `POST /webhooks/emit-alert`
   - L26: change `POST /webhooks/n8n/run-backtest` → `POST /webhooks/run-backtest`

**Verification**:
```bash
grep "webhooks/n8n" docs/roadmap/features/009-agent-mcp-server/product-spec.md && echo "FAIL" || echo "PASS"
```

---

### Step 14 — docs: update root CLAUDE.md and docs/setup/alpaca.md

**Status**: `pending`
**Service**: `docs/`
**Files**:
- `CLAUDE.md` — modify
- `docs/setup/alpaca.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- Root `CLAUDE.md`:
  - L137: `Config changes flow via n8n → config webhook handler → config service → WatchConfig stream → all subscribers.`
  - L183: `## n8n Cloud Integration`
  - L185: `Each service exposes HTTP webhook handlers (under /webhooks/n8n/) on the HTTP port (80XX) alongside the Connect-RPC routes. n8n workflows trigger on external events`
  - L189: `n8n Cloud → POST /webhooks/n8n/<action> → service webhook handler → internal gRPC client → target service`
  - L192: `Connect-RPC is also directly callable from n8n via HTTP POST to the service's Connect-RPC endpoint`
  - L194: `n8n workflow files are stored in packages/n8n/workflows/. See docs/setup/n8n.md for import instructions.`
  - L471: `| Phase 6 | Integration & n8n wiring | **DONE** |`
  - L518: `| n8n workflow files | \`packages/n8n/workflows/\` |`
- `docs/setup/alpaca.md`:
  - L186: `curl -X POST http://localhost:8053/webhooks/n8n/backfill`
  - L212: `curl -X POST http://localhost:8051/webhooks/n8n/place-order`
  - L234: `curl -X POST http://localhost:8053/webhooks/n8n/subscribe`
  - L251: `curl -X POST http://localhost:8053/webhooks/n8n/backfill`
  - L165: `via n8n \`config-update\` workflow` — also present

**Instructions**:
1. In root `CLAUDE.md`:
   - L137: change `Config changes flow via n8n → config webhook handler → config service → WatchConfig stream → all subscribers.` → `Config changes flow via agent or webhook caller → config webhook handler → config service → WatchConfig stream → all subscribers.`
   - L183: change `## n8n Cloud Integration` → `## Webhook Integration`
   - L185: change `Each service exposes HTTP webhook handlers (under /webhooks/n8n/) on the HTTP port (80XX) alongside the Connect-RPC routes. n8n workflows trigger on external events (alerts, schedule, external APIs) and call these handlers.` → `Selected services expose HTTP webhook handlers (under /webhooks/) on the HTTP port (80XX) alongside the Connect-RPC routes. The agent MCP server (009) and other callers trigger these handlers for signal ingestion, alert emission, and backtest triggering.`
   - L189: change the pattern comment `n8n Cloud → POST /webhooks/n8n/<action> → service webhook handler → internal gRPC client → target service` → `Agent / Caller → POST /webhooks/<action> → service webhook handler → internal gRPC client → target service`
   - L192: change `Connect-RPC is also directly callable from n8n via HTTP POST to the service's Connect-RPC endpoint (port 80XX), using JSON or protobuf encoding.` → `Connect-RPC is directly callable from the agent or any HTTP client via POST to the service's Connect-RPC endpoint (port 80XX), using JSON or protobuf encoding.`
   - L194: remove the line `n8n workflow files are stored in \`packages/n8n/workflows/\`. See \`docs/setup/n8n.md\` for import instructions.` (the directory is deleted in Step 9)
   - L471: change `Integration & n8n wiring` → `Integration & webhook wiring`
   - L518: remove the row `| n8n workflow files | \`packages/n8n/workflows/\` |`
2. In `docs/setup/alpaca.md`:
   - L165: change `via n8n \`config-update\` workflow` → `via the Config UI or webhook caller`
   - L186: change `http://localhost:8053/webhooks/n8n/backfill` → `http://localhost:8053/webhooks/backfill`
   - L212: change `http://localhost:8051/webhooks/n8n/place-order` — note: `place-order` webhook has been removed; update comment or curl example to use Connect-RPC: `http://localhost:8051/xstockstrat.trading.v1.TradingService/PlaceOrder`
   - L234: change `http://localhost:8053/webhooks/n8n/subscribe` → `http://localhost:8053/webhooks/subscribe`
   - L251: change `http://localhost:8053/webhooks/n8n/backfill` → `http://localhost:8053/webhooks/backfill`

**Verification**:
```bash
grep "webhooks/n8n" CLAUDE.md && echo "FAIL" || echo "PASS"
grep "packages/n8n" CLAUDE.md && echo "FAIL" || echo "PASS"
grep "webhooks/n8n" docs/setup/alpaca.md && echo "FAIL" || echo "PASS"
grep "n8n Cloud Integration" CLAUDE.md && echo "FAIL: section heading not updated" || echo "PASS"
```

---

### Step 15 — service: update scripts/integration-test.sh

**Status**: `pending`
**Service**: `scripts/`
**Files**:
- `scripts/integration-test.sh` — modify

**Reviewers**: none

**Codebase Evidence**:
- `scripts/integration-test.sh` L399: `section_12_n8n_webhook() {`
- L401: `log "SECTION 12 — n8n webhook: config set-config"`
- L405: `"${CONFIG_URL}/webhooks/n8n/set-config" \`
- L416: `ok "n8n webhook set-config — accepted"`
- L418: `fail "n8n webhook set-config — unexpected response"`
- L423: `post_raw "${CONFIG_URL}/webhooks/n8n/set-config" \`
- L439: `"${CONFIG_URL}/webhooks/n8n/set-config"` (maintenance mode test)
- L470: `"${CONFIG_URL}/webhooks/n8n/set-config"` (maintenance mode reset)
- L504: `section_12_n8n_webhook` call in `main()`

**Instructions**:
1. In `scripts/integration-test.sh`:
   - Delete the entire `section_12_n8n_webhook()` function body (L399–L503): the config webhook endpoint (`/webhooks/n8n/set-config`) was deleted in feature-011 Track A; there is no `/webhooks/set-config` to call. Renaming the URL would cause every CI run to fail with 404.
   - Remove the `section_12_n8n_webhook` call at L504 in `main()`
   - Do NOT add a replacement Connect-RPC test — adding new integration test coverage is out of scope for this feature.

**Verification**:
```bash
grep -n "n8n\|webhooks/n8n" scripts/integration-test.sh && echo "FAIL: n8n references remain" || echo "PASS"
bash -n scripts/integration-test.sh && echo "PASS: syntax ok" || echo "FAIL: syntax error"
```

---

### Step 16 — docs: update service CLAUDE.md files

**Status**: `pending`
**Service**: multiple
**Files**:
- `services/xstockstrat-config/CLAUDE.md` — modify
- `services/xstockstrat-ledger/CLAUDE.md` — modify
- `services/xstockstrat-notify/CLAUDE.md` — modify
- `services/xstockstrat-identity/CLAUDE.md` — modify
- `services/xstockstrat-trading/CLAUDE.md` — modify
- `services/xstockstrat-indicators/CLAUDE.md` — modify
- `services/xstockstrat-analysis/CLAUDE.md` — modify
- `services/xstockstrat-ingest/CLAUDE.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- Each service CLAUDE.md has an `## n8n Webhooks` section (confirmed in all 8 services):
  - config: section `## n8n Webhooks` with endpoints `set-config`, `list-keys`, `rollout` using old paths
  - ledger: section `## n8n Webhooks` with endpoints `query-events`, `append-event` using old paths
  - notify: section `## n8n Webhooks` with endpoints `emit-alert`, `list-alerts` using old paths
  - identity: section `## n8n Webhooks` with endpoints `validate-token`, `create-apikey` using old paths
  - trading: section `## n8n Webhooks` with endpoints `place-order`, `cancel-order` using old paths
  - indicators: section `## n8n Webhooks` with endpoints `compute-indicator`, `execute-formula` using old paths
  - analysis: section `## n8n Webhooks` with endpoints `run-backtest`, `score-strategy` using old paths
  - ingest: section `## n8n Webhooks` with endpoints `trigger-backfill`, `backfill-status`, `ingest-signal` using old paths
- Port table descriptions referencing `n8n webhooks`: confirmed in ledger (`HTTP (Connect-RPC) | 8057 | Connect-RPC + n8n webhooks`), notify (`8059 | Connect-RPC + n8n webhooks`), identity (`8058 | Connect-RPC + n8n webhooks`), trading (`8051 | Connect-RPC + n8n webhooks`), indicators (`8054 | Connect-RPC + n8n webhooks`)
- config CLAUDE.md has `## Config Governance` note: `All config changes via n8n must comply...`
- indicators CLAUDE.md `## Connect-RPC` section: `Callers (n8n, frontends) use HTTP 8054`

**Instructions**:
For Track A services (config, ledger, identity, trading, indicators) — webhook layer was deleted:
1. **config**: Replace `## n8n Webhooks` section with `## Webhooks` section note: `_Webhook layer removed in feature-011. Use Connect-RPC directly on port 8060 for config mutations: POST /xstockstrat.config.v1.ConfigService/SetConfig._` Update port table: `Connect-RPC + n8n webhooks` → `Connect-RPC`. Update `## Config Governance` note: `All config changes via n8n must comply...` → `All config changes via webhook must comply...`
2. **ledger**: Replace `## n8n Webhooks` section with note: `_Webhook layer removed in feature-011. Use Connect-RPC directly on port 8057._` Update port table: `Connect-RPC + n8n webhooks` → `Connect-RPC`
3. **identity**: Replace `## n8n Webhooks` section with note: `_Webhook layer removed in feature-011. Use Connect-RPC directly on port 8058._` Update port table: `Connect-RPC + n8n webhooks` → `Connect-RPC`
4. **trading**: Replace `## n8n Webhooks` section with note: `_Webhook layer removed in feature-011. Use Connect-RPC directly on port 8051._` Update port table: `Connect-RPC + n8n webhooks` → `Connect-RPC`. Update `## Connect-RPC` section: `Callers (frontends, n8n) use HTTP 8051` → `Callers (frontends, agent) use HTTP 8051`
5. **indicators**: Replace `## n8n Webhooks` section with note: `_Webhook layer removed in feature-011. Use Connect-RPC directly on port 8054._` Update port table: `Connect-RPC + n8n webhooks` → `Connect-RPC`. Update `## Connect-RPC` section: `Callers (n8n, frontends) use HTTP 8054` → `Callers (frontends, agent) use HTTP 8054`

For Track B services (notify, analysis, ingest) — webhook paths renamed:
6. **notify**: Rename `## n8n Webhooks` → `## Webhooks`. Update endpoint paths: `/webhooks/n8n/emit-alert` → `/webhooks/emit-alert`, `/webhooks/n8n/list-alerts` → `/webhooks/list-alerts`. Update port table: `Connect-RPC + n8n webhooks` → `Connect-RPC + webhooks`. Update `## Connect-RPC` section: `Callers (n8n, frontends) use HTTP 8059` → `Callers (frontends, agent) use HTTP 8059`
7. **analysis**: Rename `## n8n Webhooks` → `## Webhooks`. Update surviving endpoint: `/webhooks/n8n/run-backtest` → `/webhooks/run-backtest`. Remove the `score-strategy` row (that webhook was deleted). Update port table if it references `n8n webhooks`: `Connect-RPC + n8n webhooks` → `Connect-RPC + webhooks`. Update `## Connect-RPC` section: `Callers (n8n, frontends) use HTTP 8056` → `Callers (frontends, agent) use HTTP 8056`
8. **ingest**: Rename `## n8n Webhooks` → `## Webhooks`. Update all three endpoint paths: remove `/n8n/` segment from `trigger-backfill`, `backfill-status`, `ingest-signal`. Update port table: `Connect-RPC + n8n webhooks` → `Connect-RPC + webhooks`. Update `## Connect-RPC` section: `Callers (n8n, frontends) use HTTP 8055` → `Callers (frontends, agent) use HTTP 8055`

**Verification**:
```bash
grep -rn "n8n Webhooks\|webhooks/n8n\|Connect-RPC + n8n" services/*/CLAUDE.md && echo "FAIL" || echo "PASS"
grep -rn "Callers (n8n" services/*/CLAUDE.md && echo "FAIL" || echo "PASS"
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._

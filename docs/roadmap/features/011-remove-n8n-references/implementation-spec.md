# Implementation Spec: remove-n8n-references

**Status**: `pending`
**Created**: 2026-05-18
**Feature**: `docs/roadmap/features/011-remove-n8n-references/feature.md`
**Total Steps**: 16
**Feature Branch**: `feature/remove-n8n-references`

---

## Execution Summary

Steps 1–8 rename webhook handler files and update route paths in each affected service (Node.js services first, then Go, then Python). Step 9 deletes the `packages/n8n/` directory. Steps 10–14 update documentation files. Steps 15–16 update the integration test script and service CLAUDE.md files. All steps are independent by service; Steps 10–14 are docs-only and carry no functional risk.

Notable discovery: four Node.js services (config, ledger, notify, identity) each have **two** n8n webhook router files — one at the top-level `<service>/n8n/webhookRouter.ts` (orphaned, unused) and one at `<service>/src/n8n/webhookRouter.ts` (the live implementation imported by `src/index.ts`). Both must be deleted; only `src/webhooks/router.ts` is created.

## Step Dependencies

- Step 1 (config) through Step 8 (ingest) are independent of each other — each is self-contained within its service.
- Steps 10–16 (docs + integration test + CLAUDE.md) are independent of Steps 1–9 and of each other.
- No step depends on any migration or proto change (FR: no schema or proto changes).

---

### Step 1 — service: xstockstrat-config webhook rename

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/n8n/webhookRouter.ts` — delete
- `services/xstockstrat-config/n8n/webhookRouter.ts` — delete (orphaned file; not imported by any TypeScript source)
- `services/xstockstrat-config/src/webhooks/router.ts` — create (new location)
- `services/xstockstrat-config/src/index.ts` — modify

**Reviewers**: `xstockstrat-config` owner — Config mutation safety, no broken route registrations after rename

**Codebase Evidence**:
- Confirmed live file: `grep -n "from './n8n/webhookRouter'" services/xstockstrat-config/src/index.ts` → L12: `import { createN8nRouter } from './n8n/webhookRouter';`
- Confirmed orphaned file: `services/xstockstrat-config/n8n/webhookRouter.ts` exists but is never imported (uses `express.Router()`, a different pattern from the `src/n8n/` version which uses raw `http.IncomingMessage`)
- Route check pattern in index.ts L67: `if (req.url?.startsWith('/webhooks/n8n/')) {`
- createN8nRouter called at L51: `const n8nRouter = createN8nRouter(configImpl);`
- Existing route handler log tag at `src/n8n/webhookRouter.ts` L5: `const log = getLogger('config:n8n');`
- Endpoints served: `/webhooks/n8n/set-config` (L47), `/webhooks/n8n/rollout` (L62), `/webhooks/n8n/list-keys` (L82) — confirmed in `src/n8n/webhookRouter.ts`

**Instructions**:
1. Create directory `services/xstockstrat-config/src/webhooks/` and create `router.ts` by copying `services/xstockstrat-config/src/n8n/webhookRouter.ts` with the following changes:
   - Change log tag from `'config:n8n'` to `'config:webhooks'`
   - Remove the JSDoc comment block that says "n8n webhook router" — replace with "Webhook router for xstockstrat-config."
   - Change the `send(res, 404, { error: 'unknown n8n webhook endpoint' })` message to `{ error: 'unknown webhook endpoint' }`
   - Replace all three URL checks:
     - `'/webhooks/n8n/set-config'` → `'/webhooks/set-config'`
     - `'/webhooks/n8n/rollout'` → `'/webhooks/rollout'`
     - `'/webhooks/n8n/list-keys'` → `'/webhooks/list-keys'`
   - In the set-config handler body, change `author: body.author ?? 'n8n'` → `author: body.author ?? 'webhook'`
   - In the rollout handler body, change `reason: body.reason ?? 'n8n webhook'` → `reason: body.reason ?? 'webhook'`
   - In the rollout log: `log.info('n8n set-config', ...)` → `log.info('webhook set-config', ...)`
   - In the rollout log: `log.info('n8n rollout', ...)` → `log.info('webhook rollout', ...)`
   - Export function rename: `createN8nRouter` → `createWebhookRouter`
   - Rename internal function `n8nHandler` → `webhookHandler`
2. In `services/xstockstrat-config/src/index.ts`:
   - Change L12: `import { createN8nRouter } from './n8n/webhookRouter';` → `import { createWebhookRouter } from './webhooks/router';`
   - Change L51: `const n8nRouter = createN8nRouter(configImpl);` → `const webhookRouter = createWebhookRouter(configImpl);`
   - Change L67: `if (req.url?.startsWith('/webhooks/n8n/')) {` → `if (req.url?.startsWith('/webhooks/') && !req.url?.startsWith('/webhooks/n8n/')) {`
     **Note**: The correct logic is: route any URL starting with `/webhooks/` that is NOT a Connect-RPC route. Since Connect-RPC routes are `/{package}.{Service}/{Method}`, the simplest correct check is `req.url?.startsWith('/webhooks/')`.
     Replace L67 with: `if (req.url?.startsWith('/webhooks/')) {`
   - Change L68 (the router invocation): `n8nRouter(req, res);` → `webhookRouter(req, res);`
3. Delete `services/xstockstrat-config/src/n8n/webhookRouter.ts`
4. Delete `services/xstockstrat-config/n8n/webhookRouter.ts` (orphaned top-level file)
5. Remove the now-empty `services/xstockstrat-config/src/n8n/` directory
6. Remove the now-empty `services/xstockstrat-config/n8n/` directory

**Verification**:
```bash
cd services/xstockstrat-config && GOWORK=off pnpm run lint
grep -rn "n8n" services/xstockstrat-config/src/ && echo "FAIL: n8n references remain" || echo "PASS: no n8n references in src/"
grep -rn "webhooks/n8n" services/xstockstrat-config/ && echo "FAIL: old paths remain" || echo "PASS: no old paths"
```

---

### Step 2 — service: xstockstrat-ledger webhook rename

**Status**: `pending`
**Service**: `xstockstrat-ledger`
**Files**:
- `services/xstockstrat-ledger/src/n8n/webhookRouter.ts` — delete
- `services/xstockstrat-ledger/n8n/webhookRouter.ts` — delete (orphaned top-level file; uses express.Router(), different implementation from src/n8n/ version)
- `services/xstockstrat-ledger/src/webhooks/router.ts` — create
- `services/xstockstrat-ledger/src/index.ts` — modify

**Reviewers**: `xstockstrat-ledger` owner — Append-only invariant unaffected; webhook path change doesn't break event emission

**Codebase Evidence**:
- Confirmed live import at `services/xstockstrat-ledger/src/index.ts` L13: `import { createN8nRouter } from './n8n/webhookRouter';`
- Route prefix check at L66: `if (req.url?.startsWith('/webhooks/n8n/')) { n8nRouter(req, res); return; }`
- Router created at L55: `const n8nRouter = createN8nRouter(ledgerImpl);`
- Endpoints served: `/webhooks/n8n/append-event` (L46), `/webhooks/n8n/query-events` (L60) — confirmed in `src/n8n/webhookRouter.ts`
- Log tag at L5: `const log = getLogger('ledger:n8n');`
- source_service default in append-event: `source_service: body.source_service ?? 'n8n'` at `src/n8n/webhookRouter.ts` L49

**Instructions**:
1. Create `services/xstockstrat-ledger/src/webhooks/router.ts` by copying `services/xstockstrat-ledger/src/n8n/webhookRouter.ts` with:
   - Log tag: `'ledger:n8n'` → `'ledger:webhooks'`
   - JSDoc: replace "n8n webhook router" → "Webhook router for xstockstrat-ledger."
   - URL checks:
     - `'/webhooks/n8n/append-event'` → `'/webhooks/append-event'`
     - `'/webhooks/n8n/query-events'` → `'/webhooks/query-events'`
   - Default source: `body.source_service ?? 'n8n'` → `body.source_service ?? 'webhook'`
   - Log calls: `'n8n append-event'` → `'webhook append-event'`, `'n8n webhook error'` → `'webhook error'`
   - 404 message: `'unknown n8n webhook endpoint'` → `'unknown webhook endpoint'`
   - Export rename: `createN8nRouter` → `createWebhookRouter`, `n8nHandler` → `webhookHandler`
2. In `services/xstockstrat-ledger/src/index.ts`:
   - L13: `import { createN8nRouter } from './n8n/webhookRouter';` → `import { createWebhookRouter } from './webhooks/router';`
   - L55: `const n8nRouter = createN8nRouter(ledgerImpl);` → `const webhookRouter = createWebhookRouter(ledgerImpl);`
   - L66: `if (req.url?.startsWith('/webhooks/n8n/')) { n8nRouter(req, res); return; }` → `if (req.url?.startsWith('/webhooks/')) { webhookRouter(req, res); return; }`
3. Delete `services/xstockstrat-ledger/src/n8n/webhookRouter.ts`, remove `services/xstockstrat-ledger/src/n8n/` directory
4. Delete `services/xstockstrat-ledger/n8n/webhookRouter.ts`, remove `services/xstockstrat-ledger/n8n/` directory

**Verification**:
```bash
cd services/xstockstrat-ledger && pnpm run lint
grep -rn "n8n" services/xstockstrat-ledger/src/ && echo "FAIL" || echo "PASS"
grep -rn "webhooks/n8n" services/xstockstrat-ledger/ && echo "FAIL" || echo "PASS"
```

---

### Step 3 — service: xstockstrat-notify webhook rename

**Status**: `pending`
**Service**: `xstockstrat-notify`
**Files**:
- `services/xstockstrat-notify/src/n8n/webhookRouter.ts` — delete
- `services/xstockstrat-notify/n8n/webhookRouter.ts` — delete (orphaned top-level file; uses express.Router() pattern)
- `services/xstockstrat-notify/src/webhooks/router.ts` — create
- `services/xstockstrat-notify/src/index.ts` — modify

**Reviewers**: `xstockstrat-notify` owner — Stream delivery unaffected; no broken alert webhook paths

**Codebase Evidence**:
- Confirmed live import at `services/xstockstrat-notify/src/index.ts` L13: `import { createN8nRouter } from './n8n/webhookRouter';`
- Route prefix check at L58: `if (req.url?.startsWith('/webhooks/n8n/')) { n8nRouter(req, res); return; }`
- Router created at L47: `const n8nRouter = createN8nRouter(notifyImpl);`
- Endpoints served: `/webhooks/n8n/emit-alert` (L46), `/webhooks/n8n/list-alerts` (L63) — confirmed in `src/n8n/webhookRouter.ts`
- Log tag: `'notify:n8n'` at `src/n8n/webhookRouter.ts` L5
- Default source: `source_service: body.source_service ?? 'n8n'` at L52

**Instructions**:
1. Create `services/xstockstrat-notify/src/webhooks/router.ts` by copying `services/xstockstrat-notify/src/n8n/webhookRouter.ts` with:
   - Log tag: `'notify:n8n'` → `'notify:webhooks'`
   - URL checks: `'/webhooks/n8n/emit-alert'` → `'/webhooks/emit-alert'`, `'/webhooks/n8n/list-alerts'` → `'/webhooks/list-alerts'`
   - Default source: `body.source_service ?? 'n8n'` → `body.source_service ?? 'webhook'`
   - Log call: `'n8n emit-alert'` → `'webhook emit-alert'`
   - 404 message: `'unknown n8n webhook endpoint'` → `'unknown webhook endpoint'`
   - Export rename: `createN8nRouter` → `createWebhookRouter`, `n8nHandler` → `webhookHandler`
2. In `services/xstockstrat-notify/src/index.ts`:
   - L13: `import { createN8nRouter } from './n8n/webhookRouter';` → `import { createWebhookRouter } from './webhooks/router';`
   - L47: `const n8nRouter = createN8nRouter(notifyImpl);` → `const webhookRouter = createWebhookRouter(notifyImpl);`
   - L58: `if (req.url?.startsWith('/webhooks/n8n/')) { n8nRouter(req, res); return; }` → `if (req.url?.startsWith('/webhooks/')) { webhookRouter(req, res); return; }`
3. Delete `services/xstockstrat-notify/src/n8n/webhookRouter.ts`, remove `services/xstockstrat-notify/src/n8n/` directory
4. Delete `services/xstockstrat-notify/n8n/webhookRouter.ts`, remove `services/xstockstrat-notify/n8n/` directory

**Verification**:
```bash
cd services/xstockstrat-notify && pnpm run lint
grep -rn "n8n" services/xstockstrat-notify/src/ && echo "FAIL" || echo "PASS"
grep -rn "webhooks/n8n" services/xstockstrat-notify/ && echo "FAIL" || echo "PASS"
```

---

### Step 4 — service: xstockstrat-identity webhook rename

**Status**: `pending`
**Service**: `xstockstrat-identity`
**Files**:
- `services/xstockstrat-identity/src/n8n/webhookRouter.ts` — delete
- `services/xstockstrat-identity/src/webhooks/router.ts` — create
- `services/xstockstrat-identity/src/index.ts` — modify

**Reviewers**: `xstockstrat-identity` owner — Auth webhook path change doesn't break token validation flows

**Codebase Evidence**:
- Confirmed live import at `services/xstockstrat-identity/src/index.ts` L13: `import { createN8nRouter } from './n8n/webhookRouter';`
- Route prefix check at L61: `if (req.url?.startsWith('/webhooks/n8n/')) { n8nRouter(req, res); return; }`
- Router created at L50: `const n8nRouter = createN8nRouter(identityImpl);`
- Endpoints served: `/webhooks/n8n/validate-token` (L46), `/webhooks/n8n/create-apikey` (L53) — confirmed in `src/n8n/webhookRouter.ts`
- Log tag: `'identity:n8n'` at `src/n8n/webhookRouter.ts` L5
- Note: identity has NO top-level `n8n/` directory (confirmed via `find` — only `src/n8n/` exists)

**Instructions**:
1. Create `services/xstockstrat-identity/src/webhooks/router.ts` by copying `services/xstockstrat-identity/src/n8n/webhookRouter.ts` with:
   - Log tag: `'identity:n8n'` → `'identity:webhooks'`
   - URL checks: `'/webhooks/n8n/validate-token'` → `'/webhooks/validate-token'`, `'/webhooks/n8n/create-apikey'` → `'/webhooks/create-apikey'`
   - Log call: `'n8n validate-token'` → `'webhook validate-token'`
   - Log call: `'n8n create-apikey'` → `'webhook create-apikey'`
   - 404 message: `'unknown n8n webhook endpoint'` → `'unknown webhook endpoint'`
   - Export rename: `createN8nRouter` → `createWebhookRouter`, `n8nHandler` → `webhookHandler`
2. In `services/xstockstrat-identity/src/index.ts`:
   - L13: `import { createN8nRouter } from './n8n/webhookRouter';` → `import { createWebhookRouter } from './webhooks/router';`
   - L50: `const n8nRouter = createN8nRouter(identityImpl);` → `const webhookRouter = createWebhookRouter(identityImpl);`
   - L61: `if (req.url?.startsWith('/webhooks/n8n/')) { n8nRouter(req, res); return; }` → `if (req.url?.startsWith('/webhooks/')) { webhookRouter(req, res); return; }`
3. Delete `services/xstockstrat-identity/src/n8n/webhookRouter.ts`, remove `services/xstockstrat-identity/src/n8n/` directory

**Verification**:
```bash
cd services/xstockstrat-identity && pnpm run lint
grep -rn "n8n" services/xstockstrat-identity/src/ && echo "FAIL" || echo "PASS"
grep -rn "webhooks/n8n" services/xstockstrat-identity/ && echo "FAIL" || echo "PASS"
```

---

### Step 5 — service: xstockstrat-trading handler rename

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/handler/n8n.go` — delete
- `services/xstockstrat-trading/internal/handler/webhook.go` — create
- `services/xstockstrat-trading/cmd/server/main.go` — modify

**Reviewers**: `xstockstrat-trading` owner — Order execution correctness unaffected; no broken n8n.go handler references

**Codebase Evidence**:
- Confirmed existing file: `services/xstockstrat-trading/internal/handler/n8n.go`
- Type defined: `type N8nHandler struct { svc *service.TradingService }` at `n8n.go` L14
- Constructor: `func NewN8nHandler(svc *service.TradingService) *N8nHandler` at L18
- Methods: `PlaceOrderWebhook` at L24 (registered as `"/webhooks/n8n/place-order"`), `CancelOrderWebhook` at L76 (registered as `"/webhooks/n8n/cancel-order"`)
- Route registration in `cmd/server/main.go` L134: `n8nHdl := handler.NewN8nHandler(svc)`
- Routes at L138: `mux.HandleFunc("/webhooks/n8n/place-order", n8nHdl.PlaceOrderWebhook)`
- Routes at L139: `mux.HandleFunc("/webhooks/n8n/cancel-order", n8nHdl.CancelOrderWebhook)`
- Error logs inside handler: `slog.Error("n8n place-order failed", ...)` at n8n.go L61
- Package declaration at n8n.go L1: `package handler`

**Instructions**:
1. Create `services/xstockstrat-trading/internal/handler/webhook.go` by copying `services/xstockstrat-trading/internal/handler/n8n.go` with:
   - Struct rename: `N8nHandler` → `WebhookHandler`
   - Constructor rename: `NewN8nHandler` → `NewWebhookHandler`
   - Comment on struct: `// N8nHandler translates incoming n8n webhook payloads...` → `// WebhookHandler translates incoming webhook payloads to internal gRPC calls.`
   - Method comment: `// PlaceOrderWebhook handles n8n → place order` → `// PlaceOrderWebhook handles webhook → place order`
   - Method comment: `// POST /webhooks/n8n/place-order` → `// POST /webhooks/place-order`
   - Method comment: `// CancelOrderWebhook handles n8n → cancel order` → `// CancelOrderWebhook handles webhook → cancel order`
   - Method comment: `// POST /webhooks/n8n/cancel-order` → `// POST /webhooks/cancel-order`
   - Log call: `slog.Error("n8n place-order failed", ...)` → `slog.Error("webhook place-order failed", ...)`
2. In `services/xstockstrat-trading/cmd/server/main.go`:
   - L132 comment: `// HTTP server: n8n webhooks + Connect-RPC (single mux, port 8051).` → `// HTTP server: webhooks + Connect-RPC (single mux, port 8051).`
   - L134: `n8nHdl := handler.NewN8nHandler(svc)` → `webhookHdl := handler.NewWebhookHandler(svc)`
   - L137 comment: `// n8n webhook routes.` → `// Webhook routes.`
   - L138: `mux.HandleFunc("/webhooks/n8n/place-order", n8nHdl.PlaceOrderWebhook)` → `mux.HandleFunc("/webhooks/place-order", webhookHdl.PlaceOrderWebhook)`
   - L139: `mux.HandleFunc("/webhooks/n8n/cancel-order", n8nHdl.CancelOrderWebhook)` → `mux.HandleFunc("/webhooks/cancel-order", webhookHdl.CancelOrderWebhook)`
3. Delete `services/xstockstrat-trading/internal/handler/n8n.go`

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off go build ./...
grep -rn "n8n" services/xstockstrat-trading/ && echo "FAIL" || echo "PASS"
grep -rn "webhooks/n8n" services/xstockstrat-trading/ && echo "FAIL" || echo "PASS"
```

---

### Step 6 — service: xstockstrat-indicators webhook rename

**Status**: `pending`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/n8n/webhook.py` — delete
- `services/xstockstrat-indicators/app/webhooks/__init__.py` — create (empty)
- `services/xstockstrat-indicators/app/webhooks/router.py` — create
- `services/xstockstrat-indicators/app/http_server.py` — modify

**Reviewers**: `xstockstrat-indicators` owner — No side-effects from webhook rename; formula execution unaffected

**Codebase Evidence**:
- Confirmed existing file: `services/xstockstrat-indicators/n8n/webhook.py`
- n8n/webhook.py uses `router = APIRouter(prefix="/webhooks/n8n")` at L16
- Routes defined: `@router.post("/compute-indicator")` (L43) → full path `/webhooks/n8n/compute-indicator`, `@router.post("/execute-formula")` (L68) → `/webhooks/n8n/execute-formula`
- `n8n/webhook.py` is NOT imported by `app/http_server.py` — it is standalone. Confirmed: `app/http_server.py` defines the webhook routes inline (not by including n8n/webhook.py)
- In `app/http_server.py`, n8n webhook routes defined inline: `@app.post("/webhooks/n8n/compute-indicator")` at L60, `@app.post("/webhooks/n8n/execute-formula")` at L73
- File header docstring references both routes: `POST /webhooks/n8n/compute-indicator` at L12, `POST /webhooks/n8n/execute-formula` at L13
- `app/webhooks/` directory does NOT yet exist (confirmed via `find`)

**Instructions**:
1. Create `services/xstockstrat-indicators/app/webhooks/__init__.py` (empty file)
2. Create `services/xstockstrat-indicators/app/webhooks/router.py` by adapting `services/xstockstrat-indicators/n8n/webhook.py` with:
   - Update module docstring: change "n8n webhook handler" → "Webhook handler for xstockstrat-indicators."
   - Change `router = APIRouter(prefix="/webhooks/n8n")` → `router = APIRouter(prefix="/webhooks")`
   - Update function docstrings: `n8n → compute a built-in indicator` → `webhook → compute a built-in indicator`, `n8n → execute a custom sandboxed formula` → `webhook → execute a custom sandboxed formula`
   - No route path changes needed (the `APIRouter(prefix=...)` change handles the path)
3. In `services/xstockstrat-indicators/app/http_server.py`:
   - Update the module docstring at L12–L13: change `POST /webhooks/n8n/compute-indicator` → `POST /webhooks/compute-indicator`, `POST /webhooks/n8n/execute-formula` → `POST /webhooks/execute-formula`
   - Change `@app.post("/webhooks/n8n/compute-indicator")` at L60 → `@app.post("/webhooks/compute-indicator")`
   - Change the function docstring at L61: `"""n8n → ComputeIndicator webhook."""` → `"""webhook → ComputeIndicator."""`
   - Change `@app.post("/webhooks/n8n/execute-formula")` at L73 → `@app.post("/webhooks/execute-formula")`
   - Change the function docstring at L74: `"""n8n → ExecuteFormula webhook."""` → `"""webhook → ExecuteFormula."""`
4. Delete `services/xstockstrat-indicators/n8n/webhook.py`
5. Remove the now-empty `services/xstockstrat-indicators/n8n/` directory

**Verification**:
```bash
cd services/xstockstrat-indicators && python3 -m ruff check app/ && python3 -m ruff format --check app/
grep -rn "n8n" services/xstockstrat-indicators/ && echo "FAIL" || echo "PASS"
grep -rn "webhooks/n8n" services/xstockstrat-indicators/ && echo "FAIL" || echo "PASS"
```

---

### Step 7 — service: xstockstrat-analysis route path update

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/http_server.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — Backtest reproducibility unaffected; endpoint path change consistent with other services

**Codebase Evidence**:
- Confirmed routes in `services/xstockstrat-analysis/app/http_server.py`:
  - `@app.post("/webhooks/n8n/run-backtest")` at L46
  - `@app.post("/webhooks/n8n/score-strategy")` at L57
- Route functions: `n8n_run_backtest` at L46, `n8n_score_strategy` at L57
- Module docstring at L1–L4 references "n8n webhooks" in the file header comment L4: `# Also exposes: ... n8n webhook routes`
- No separate n8n/ directory — routes are inline in http_server.py (confirmed via `find`)

**Instructions**:
1. In `services/xstockstrat-analysis/app/http_server.py`:
   - Update module docstring section heading at L45 comment: `# ── n8n webhook routes ──` → `# ── Webhook routes ──`
   - Change `@app.post("/webhooks/n8n/run-backtest")` at L46 → `@app.post("/webhooks/run-backtest")`
   - Rename function: `async def n8n_run_backtest(request: Request):` → `async def run_backtest_webhook(request: Request):`
   - Change function docstring: `"""n8n → RunBacktest webhook."""` → `"""Webhook → RunBacktest."""`
   - Change `@app.post("/webhooks/n8n/score-strategy")` at L57 → `@app.post("/webhooks/score-strategy")`
   - Rename function: `async def n8n_score_strategy(request: Request):` → `async def score_strategy_webhook(request: Request):`
   - Change function docstring: `"""n8n → ScoreStrategy webhook."""` → `"""Webhook → ScoreStrategy."""`

**Verification**:
```bash
cd services/xstockstrat-analysis && python3 -m ruff check app/ && python3 -m ruff format --check app/
grep -rn "n8n" services/xstockstrat-analysis/ && echo "FAIL" || echo "PASS"
grep -rn "webhooks/n8n" services/xstockstrat-analysis/ && echo "FAIL" || echo "PASS"
```

---

### Step 8 — service: xstockstrat-ingest route path update

**Status**: `pending`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/app/http_server.py` — modify

**Reviewers**: `xstockstrat-ingest` owner — Signal normalization correctness unaffected; webhook path change propagated correctly

**Codebase Evidence**:
- Confirmed routes in `services/xstockstrat-ingest/app/http_server.py`:
  - `@app.post("/webhooks/n8n/trigger-backfill")` at L52
  - `@app.post("/webhooks/n8n/backfill-status")` at L63
  - `@app.post("/webhooks/n8n/ingest-signal")` at L72
- Route functions: `n8n_trigger_backfill` at L52, `n8n_backfill_status` at L63, `n8n_ingest_signal` at L72
- Module docstring at L4: `# Also exposes: ... n8n webhook routes`
- Section comment at L51: `# ── n8n webhook routes ──`

**Instructions**:
1. In `services/xstockstrat-ingest/app/http_server.py`:
   - Update section heading at L51: `# ── n8n webhook routes ──` → `# ── Webhook routes ──`
   - Change `@app.post("/webhooks/n8n/trigger-backfill")` at L52 → `@app.post("/webhooks/trigger-backfill")`
   - Rename function: `async def n8n_trigger_backfill(request: Request):` → `async def trigger_backfill_webhook(request: Request):`
   - Change docstring: `"""n8n → TriggerBackfill webhook."""` → `"""Webhook → TriggerBackfill."""`
   - Change `@app.post("/webhooks/n8n/backfill-status")` at L63 → `@app.post("/webhooks/backfill-status")`
   - Rename function: `async def n8n_backfill_status(request: Request):` → `async def backfill_status_webhook(request: Request):`
   - Change docstring: `"""n8n → GetBackfillStatus webhook."""` → `"""Webhook → GetBackfillStatus."""`
   - Change `@app.post("/webhooks/n8n/ingest-signal")` at L72 → `@app.post("/webhooks/ingest-signal")`
   - Rename function: `async def n8n_ingest_signal(request: Request):` → `async def ingest_signal_webhook(request: Request):`
   - Change docstring first line: `"""\n        n8n → IngestSignal webhook.` → `"""\n        Webhook → IngestSignal.`

**Verification**:
```bash
cd services/xstockstrat-ingest && python3 -m ruff check app/ && python3 -m ruff format --check app/
grep -rn "n8n" services/xstockstrat-ingest/ && echo "FAIL" || echo "PASS"
grep -rn "webhooks/n8n" services/xstockstrat-ingest/ && echo "FAIL" || echo "PASS"
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

**Reviewers**: none (docs/cleanup step — no reviewers required by governance matrix)

**Codebase Evidence**:
- Confirmed all files via `find /home/user/xstockstrat-orchestration/packages/n8n -type f | sort`:
  - `packages/n8n/README.md`
  - `packages/n8n/workflows/config-update.json`
  - `packages/n8n/workflows/emit-alert.json`
  - `packages/n8n/workflows/ingest-signal-csv.json`
  - `packages/n8n/workflows/ingest-signal-email.json`
  - `packages/n8n/workflows/ingest-signal-rss.json`
  - `packages/n8n/workflows/ledger-query-events.json`
  - `packages/n8n/workflows/place-order.json`
- No service imports from `packages/n8n/` (confirmed via grep — it contains only JSON workflow files)
- Phase 6 deviations confirmed: "n8n workflow definition files (`packages/n8n/`)" — this is the directory referenced

**Instructions**:
```bash
rm -rf packages/n8n/
```
Confirm no other files reference `packages/n8n/` as a module import (already confirmed: it is JSON workflow files only).

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
- `docs/setup/CLAUDE.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `docs/setup/n8n.md` confirmed at 439 lines — full n8n Cloud setup guide
- `docs/setup/CLAUDE.md` L13: row for `n8n.md` with description `n8n Cloud — create n8n account, import pre-built workflow JSONs...`
- FR-5 of product spec: replace with "a one-page stub explaining that n8n is no longer used and linking to the agent-mcp-server feature (009) as the replacement"

**Instructions**:
1. Replace the entire content of `docs/setup/n8n.md` with:
   ```markdown
   # n8n — No Longer in Use

   n8n was the originally planned automation layer for the xstockstrat platform. It has been superseded by the AI agent architecture.

   ## Replacement

   External signal ingestion, alert emission, and backtest triggering are now handled by the MCP server agent service. See:

   - `docs/roadmap/features/009-agent-mcp-server/product-spec.md` — the agent MCP server that replaces n8n

   ## Webhook Endpoints

   All service webhook endpoints continue to work; the `/n8n/` path segment has been removed. The new paths are:

   | Service | Old path (removed) | New path |
   |---|---|---|
   | xstockstrat-config | `/webhooks/n8n/set-config` | `/webhooks/set-config` |
   | xstockstrat-config | `/webhooks/n8n/rollout` | `/webhooks/rollout` |
   | xstockstrat-config | `/webhooks/n8n/list-keys` | `/webhooks/list-keys` |
   | xstockstrat-trading | `/webhooks/n8n/place-order` | `/webhooks/place-order` |
   | xstockstrat-trading | `/webhooks/n8n/cancel-order` | `/webhooks/cancel-order` |
   | xstockstrat-ledger | `/webhooks/n8n/append-event` | `/webhooks/append-event` |
   | xstockstrat-ledger | `/webhooks/n8n/query-events` | `/webhooks/query-events` |
   | xstockstrat-notify | `/webhooks/n8n/emit-alert` | `/webhooks/emit-alert` |
   | xstockstrat-notify | `/webhooks/n8n/list-alerts` | `/webhooks/list-alerts` |
   | xstockstrat-identity | `/webhooks/n8n/validate-token` | `/webhooks/validate-token` |
   | xstockstrat-identity | `/webhooks/n8n/create-apikey` | `/webhooks/create-apikey` |
   | xstockstrat-indicators | `/webhooks/n8n/compute-indicator` | `/webhooks/compute-indicator` |
   | xstockstrat-indicators | `/webhooks/n8n/execute-formula` | `/webhooks/execute-formula` |
   | xstockstrat-analysis | `/webhooks/n8n/run-backtest` | `/webhooks/run-backtest` |
   | xstockstrat-analysis | `/webhooks/n8n/score-strategy` | `/webhooks/score-strategy` |
   | xstockstrat-ingest | `/webhooks/n8n/trigger-backfill` | `/webhooks/trigger-backfill` |
   | xstockstrat-ingest | `/webhooks/n8n/backfill-status` | `/webhooks/backfill-status` |
   | xstockstrat-ingest | `/webhooks/n8n/ingest-signal` | `/webhooks/ingest-signal` |
   ```
2. In `docs/setup/CLAUDE.md`, update the `n8n.md` row description from the current setup guide description to: `n8n.md — **Deprecated** — n8n is no longer used; see 009-agent-mcp-server. This file is a stub with a path migration table.`

**Verification**:
```bash
grep -c "n8n" docs/setup/n8n.md && echo "check: should only be historical mentions in the path table"
grep "n8n Cloud" docs/setup/n8n.md && echo "FAIL: old content remains" || echo "PASS: file replaced"
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
- `docs/runbooks/config-rollout.md` L95: `POST /webhooks/n8n/set-config`, L109: `the /webhooks/n8n/rollout endpoint`, L112: `POST /webhooks/n8n/rollout`
- `docs/runbooks/historical-backfill.md` L72: `POST /webhooks/n8n/trigger-backfill`, L167: `curl -X POST http://xstockstrat-ingest:8055/webhooks/n8n/trigger-backfill`
- `docs/runbooks/approval-flow.md` L67: `n8n webhook: POST /webhooks/n8n/approve-order` (note: `approve-order` endpoint does not exist in the codebase — this is a speculative future reference), L66 section heading: `### 2. n8n Workflow Trigger`
- `docs/runbooks/indicator-builder.md` L106 section: `### Via n8n Webhook`, L108: `POST /webhooks/n8n/execute-formula`
- `docs/runbooks/add-data-source.md` L24: `POST /webhooks/n8n/ingest-signal`, L150: `POST /webhooks/n8n/backfill`, L153: `POST http://xstockstrat-marketdata:8053/webhooks/n8n/backfill`, L357: `@router.post("/webhooks/n8n/ingest-signal")`, L388: `POST http://xstockstrat-ingest:8055/webhooks/n8n/ingest-signal`, L397: same, L587: `n8n workflow can POST to /webhooks/n8n/ingest-signal`

**Instructions**:
1. In `docs/runbooks/config-rollout.md`:
   - Replace all occurrences of `/webhooks/n8n/set-config` → `/webhooks/set-config`
   - Replace all occurrences of `/webhooks/n8n/rollout` → `/webhooks/rollout`
   - Replace text `n8n webhook` or `n8n` as a tool name with `webhook` or the agent/orchestrator where contextually appropriate
2. In `docs/runbooks/historical-backfill.md`:
   - Replace `POST /webhooks/n8n/trigger-backfill` → `POST /webhooks/trigger-backfill`
   - Replace `http://xstockstrat-ingest:8055/webhooks/n8n/trigger-backfill` → `http://xstockstrat-ingest:8055/webhooks/trigger-backfill`
   - Replace any `n8n` tool references (e.g., `n8n Cloud / manual upload`) with `agent / manual upload`
   - Update section heading `### Via n8n Webhook` → `### Via Webhook`
3. In `docs/runbooks/approval-flow.md`:
   - L66 heading: `### 2. n8n Workflow Trigger` → `### 2. Agent / Webhook Trigger`
   - L67: `n8n webhook: POST /webhooks/n8n/approve-order` → `Webhook: POST /webhooks/approve-order`
   - Update surrounding prose that describes n8n as the approval mechanism to reference the agent / webhook caller pattern instead
4. In `docs/runbooks/indicator-builder.md`:
   - Section heading `### Via n8n Webhook` → `### Via Webhook`
   - `POST /webhooks/n8n/execute-formula` → `POST /webhooks/execute-formula`
5. In `docs/runbooks/add-data-source.md`:
   - Replace all instances of `/webhooks/n8n/ingest-signal` → `/webhooks/ingest-signal`
   - Replace `POST /webhooks/n8n/backfill` → `POST /webhooks/backfill` (L150)
   - Replace `POST http://xstockstrat-marketdata:8053/webhooks/n8n/backfill` → `POST http://xstockstrat-marketdata:8053/webhooks/backfill`
   - Replace `@router.post("/webhooks/n8n/ingest-signal")` example code at L357 → `@router.post("/webhooks/ingest-signal")`
   - Replace checklist item at L587 with new path
   - Replace `n8n workflow can POST to` with `agent or caller can POST to`
   - In "Step 6 — Wire n8n to Each Newsletter Source" heading: update to "Step 6 — Wire Agent/Caller to Each Newsletter Source" and update n8n-specific prose to use neutral "HTTP caller" or "agent" language

**Verification**:
```bash
grep -rn "webhooks/n8n" docs/runbooks/ && echo "FAIL: old paths remain" || echo "PASS"
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
- `docs/roadmap/implementation-roadmap.md` L68: `n8n webhook handler: POST /webhooks/n8n/config-update → internal SetConfig gRPC`, L86: `POST /webhooks/n8n/replay-events`, L110: `POST /webhooks/n8n/emit-alert`, L254: `POST /webhooks/n8n/ingest-signal`, L366: `POST /webhooks/n8n/place-order`, L477–L481: block of n8n configuration instructions with old paths, L534: `curl -X POST http://localhost:8060/webhooks/n8n/config-update`
- `docs/roadmap/phase6-deviations.md` L15–L16: table with old `/webhooks/n8n/` paths as actual endpoints, L26: references `packages/n8n/workflows/`, L53: mentions `/webhooks/n8n/*`, L63: lists `packages/n8n/` as Phase 6 addition, L88: `POST /webhooks/n8n/set-config`, L99: `packages/n8n/README.md`
- `docs/roadmap/CLAUDE.md` L9: "n8n workflow storage in `packages/n8n/workflows/`"

**Instructions**:
1. In `docs/roadmap/implementation-roadmap.md`:
   - Replace webhook path references in Phase 1–4 implementation notes:
     - `/webhooks/n8n/config-update` → `/webhooks/set-config` (the actual endpoint per phase6-deviations)
     - `/webhooks/n8n/replay-events` → `/webhooks/query-events` (the actual endpoint per phase6-deviations)
     - `/webhooks/n8n/emit-alert` → `/webhooks/emit-alert`
     - `/webhooks/n8n/ingest-signal` → `/webhooks/ingest-signal`
     - `/webhooks/n8n/place-order` → `/webhooks/place-order`
   - Update L477–L481 block: replace `n8n` tool references with "agent MCP server (009)" and update all paths
   - Update L534 curl example: `/webhooks/n8n/config-update` → `/webhooks/set-config`
   - Update Phase 6 heading from "Integration & n8n wiring" to "Integration & webhook wiring" in the implementation roadmap phase table
2. In `docs/roadmap/phase6-deviations.md` (update as past-tense history per FR-6):
   - L15–L16 table: update to show both old (historical roadmap spec) and new (post-feature-011) paths — add a note that the `/n8n/` segment was removed by feature 011
   - L26: update `packages/n8n/workflows/` reference to note that this directory was deleted in feature 011
   - L53: update `/webhooks/n8n/*` reference to past tense with note
   - L63: update `packages/n8n/` reference to note it was deleted in feature 011
   - L88: `POST /webhooks/n8n/set-config` → `POST /webhooks/set-config` (update verification checkpoint to new path)
   - L99: update `packages/n8n/README.md` reference to note it no longer exists
3. In `docs/roadmap/CLAUDE.md`:
   - L9: update description of `phase6-deviations.md` to remove "n8n workflow storage in `packages/n8n/workflows/`" — replace with "webhook path cleanup via feature-011"

**Verification**:
```bash
grep -n "webhooks/n8n" docs/roadmap/implementation-roadmap.md && echo "FAIL: old paths remain" || echo "PASS"
grep -n "packages/n8n" docs/roadmap/phase6-deviations.md | grep -v "deleted\|removed\|historical" && echo "WARN: check context" || echo "PASS"
```

---

### Step 13 — docs: update 009 product spec tool definitions

**Status**: `pending`
**Service**: `docs/`
**Files**:
- `docs/roadmap/features/009-agent-mcp-server/product-spec.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `docs/roadmap/features/009-agent-mcp-server/product-spec.md` L24: `POST /webhooks/n8n/ingest-signal`
- L25: `POST /webhooks/n8n/emit-alert`
- L26: `POST /webhooks/n8n/run-backtest`
- FR-7 of product spec: "The agent-mcp-server product spec must be updated to reference `/webhooks/<action>` paths instead of `/webhooks/n8n/<action>`"

**Instructions**:
1. In `docs/roadmap/features/009-agent-mcp-server/product-spec.md`:
   - L24: `POST /webhooks/n8n/ingest-signal on xstockstrat-ingest:8055` → `POST /webhooks/ingest-signal on xstockstrat-ingest:8055`
   - L25: `POST /webhooks/n8n/emit-alert on xstockstrat-notify:8059` → `POST /webhooks/emit-alert on xstockstrat-notify:8059`
   - L26: `POST /webhooks/n8n/run-backtest on xstockstrat-analysis:8056` → `POST /webhooks/run-backtest on xstockstrat-analysis:8056`
   - Also update FR-6 which references `N8N_WEBHOOK_SECRET` env var: keep the env var name as-is (renaming env vars is out of scope per FR-9 notes and doesn't affect functionality) — but update the path reference if FR-6 prose uses `/webhooks/n8n/`

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
- Root `CLAUDE.md` L137: `Config changes flow via n8n → config webhook handler...`
- L183: `## n8n Cloud Integration` section header
- L185: `Each service exposes HTTP webhook handlers (under /webhooks/n8n/)...`
- L189: `n8n Cloud → POST /webhooks/n8n/<action>...`
- L192: `Connect-RPC is also directly callable from n8n...`
- L194: `n8n workflow files are stored in packages/n8n/workflows/...`
- L471: phase table row: `Phase 6 | Integration & n8n wiring | DONE`
- L518: Key File Paths row: `n8n workflow files | packages/n8n/workflows/`
- `docs/setup/alpaca.md` L186: `curl -X POST http://localhost:8053/webhooks/n8n/backfill`
- L212: `curl -X POST http://localhost:8051/webhooks/n8n/place-order`
- L234: `curl -X POST http://localhost:8053/webhooks/n8n/subscribe`
- L251: `curl -X POST http://localhost:8053/webhooks/n8n/backfill`

**Instructions**:
1. In root `CLAUDE.md`:
   - L137: Change `Config changes flow via n8n → config webhook handler → config service → WatchConfig stream → all subscribers.` → `Config changes flow via agent/webhook caller → config webhook handler → config service → WatchConfig stream → all subscribers.`
   - L183 section heading: `## n8n Cloud Integration` → `## Webhook Integration`
   - L185: Remove the `/webhooks/n8n/` prefix reference — change to `Each service exposes HTTP webhook handlers (under /webhooks/) on the HTTP port (80XX) alongside the Connect-RPC routes. The agent MCP server (009) and other callers trigger these handlers.`
   - L189: change the pattern diagram from `n8n Cloud → POST /webhooks/n8n/<action>` to `Agent / Caller → POST /webhooks/<action>`
   - L192: change `Connect-RPC is also directly callable from n8n` to `Connect-RPC is directly callable from the agent or any HTTP client`
   - L194: Remove the line about `n8n workflow files are stored in packages/n8n/workflows/` entirely (the directory is deleted in Step 9)
   - L471: Phase table row: `Integration & n8n wiring` → `Integration & webhook wiring`
   - L518: Key File Paths row: remove the `n8n workflow files | packages/n8n/workflows/` row (no longer exists)
2. In `docs/setup/alpaca.md`:
   - L186: `http://localhost:8053/webhooks/n8n/backfill` → `http://localhost:8053/webhooks/backfill`
   - L212: `http://localhost:8051/webhooks/n8n/place-order` → `http://localhost:8051/webhooks/place-order`
   - L234: `http://localhost:8053/webhooks/n8n/subscribe` → `http://localhost:8053/webhooks/subscribe`
   - L251: `http://localhost:8053/webhooks/n8n/backfill` → `http://localhost:8053/webhooks/backfill`

**Verification**:
```bash
grep "webhooks/n8n" CLAUDE.md && echo "FAIL" || echo "PASS"
grep "webhooks/n8n" docs/setup/alpaca.md && echo "FAIL" || echo "PASS"
grep "packages/n8n" CLAUDE.md && echo "FAIL" || echo "PASS"
```

---

### Step 15 — service: update scripts/integration-test.sh

**Status**: `pending`
**Service**: `scripts/`
**Files**:
- `scripts/integration-test.sh` — modify

**Reviewers**: none

**Codebase Evidence**:
- `scripts/integration-test.sh` L399: `section_12_n8n_webhook()` function name
- L401: `log "SECTION 12 — n8n webhook: config set-config"`
- L405: `"${CONFIG_URL}/webhooks/n8n/set-config"`
- L416: `ok "n8n webhook set-config — accepted"`
- L418: `fail "n8n webhook set-config — unexpected response"`
- L423: `post_raw "${CONFIG_URL}/webhooks/n8n/set-config"`
- L439: `"${CONFIG_URL}/webhooks/n8n/set-config"` (maintenance mode test)
- L470: `"${CONFIG_URL}/webhooks/n8n/set-config"` (maintenance mode reset)
- L504: `section_12_n8n_webhook` call in `main()`

**Instructions**:
1. In `scripts/integration-test.sh`:
   - L399: rename function `section_12_n8n_webhook()` → `section_12_webhook()`
   - L401: `log "SECTION 12 — n8n webhook: config set-config"` → `log "SECTION 12 — webhook: config set-config"`
   - L405, L423, L439, L470: replace all instances of `${CONFIG_URL}/webhooks/n8n/set-config` → `${CONFIG_URL}/webhooks/set-config`
   - L416: `ok "n8n webhook set-config — accepted"` → `ok "webhook set-config — accepted"`
   - L418: `fail "n8n webhook set-config — unexpected response"` → `fail "webhook set-config — unexpected response"`
   - L504: `section_12_n8n_webhook` → `section_12_webhook`
   - Update `log "  Reset platform.log_level to 'info'"` context note at L426 if it references n8n

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
- Each service CLAUDE.md has an `## n8n Webhooks` section with a table of endpoints using the old `/webhooks/n8n/<action>` paths. Confirmed in: config, ledger, notify, identity, trading, indicators, analysis, ingest service CLAUDE.md files.
- The section heading is `## n8n Webhooks` in all cases.
- Additionally, port tables in ledger (L12), notify (L9), identity (L9), trading (L13), indicators (L11) reference "n8n webhooks" in the HTTP port Purpose column.

**Instructions**:
For each of the 8 service CLAUDE.md files:
1. Rename section heading `## n8n Webhooks` → `## Webhooks`
2. Update all endpoint paths in the table — remove `/n8n/` segment from each path:
   - config: `set-config`, `list-keys`, `rollout`
   - ledger: `append-event`, `query-events`
   - notify: `emit-alert`, `list-alerts`
   - identity: `validate-token`, `create-apikey`
   - trading: `place-order`, `cancel-order`
   - indicators: `compute-indicator`, `execute-formula`
   - analysis: `run-backtest`, `score-strategy`
   - ingest: `trigger-backfill`, `backfill-status`, `ingest-signal`
3. Update the Ports table's HTTP port Purpose column: change `Connect-RPC + n8n webhooks` → `Connect-RPC + webhooks`
4. In config CLAUDE.md: remove the `## Config Governance` note "All config changes via n8n must comply..." → "All config changes via webhook must comply..."
5. In indicators CLAUDE.md: update the `## Connect-RPC` section reference to `n8n` → `external callers`

**Verification**:
```bash
grep -rn "n8n Webhooks\|n8n webhooks\|webhooks/n8n" services/*/CLAUDE.md && echo "FAIL" || echo "PASS"
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._

# sdd-spec — per-service discovery checklist

This is the discovery recipe for **one affected service**. In `/sdd-spec` Step 3 you hand
this checklist to a `codebase-discovery` subagent (one per affected service, in parallel)
and collect the returned digests as `**Codebase Evidence**` for the steps that touch that
service. Every item the agent reports must carry a `path:line` citation — that is what
satisfies the zero-assumption rule.

## Base survey (every affected service)

a. Read `services/<name>/CLAUDE.md`.
b. `find services/<name> -type f | sort` — real file inventory.
c. Read the main entry point:
   - Go: `services/<name>/cmd/server/main.go`
   - Python: `services/<name>/app/main.py`
   - Node.js: `services/<name>/src/index.ts`
d. Read the handler/servicer file (existing RPC implementations):
   - Go: grep `func.*Server` or `func.*Handler`
   - Python: `services/<name>/app/handlers/servicer.py`
   - Node.js: grep `export.*function` / `router\.(get|post|put)`
e. `grep -rn "func \|def \|export function\|export const\|register\|handler\|servicer" services/<name>/`
   — locate real symbols with line numbers.
f. `ls services/<name>/migrations/ 2>/dev/null | sort` — find the last `NNN` migration number.
g. `grep -rn "GetConfig\|WatchConfig\|config\." services/<name>/` — find config-key read patterns.
h. Deployment-file env-var audit. Record current wiring and detect missing entries:
   ```bash
   grep -n "<service-name>" docker-compose.yml .do/app.dev.yaml .do/app.yaml
   ```
   For each new env var the feature introduces, confirm it is **absent** from all three:
   ```bash
   grep -n "NEW_VAR_NAME" docker-compose.yml .do/app.dev.yaml .do/app.yaml
   ```
   Report **absent** (must add in the step's `**Files**` + `**Instructions**`) or **present**
   (no change). New ports must also be absent from the `ports:` block in `docker-compose.yml`
   and from port entries in the app specs.

## Frontend survey (only if `xstockstrat-ui` is in Affected Services)

Frontend test steps must reuse the test-data inventory (`docs/patterns/test-data-inventory.md`,
Constitution **C-12**) instead of declaring inline mock literals.

**For a non-frontend service, Constitution C-13 applies instead** and the check is different: it is
not "does an inventory exist" but "would this step create a **second** consumer of the same domain
literal?" One consumer is compliant inline. Two forces the literal into that service's canonical home
(Python `tests/conftest.py`, Go `internal/testdata/`, Node `src/__tests__/fixtures/`). Do not survey
for a home that does not exist — most services have none, and none should be created speculatively.

i. Read `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md`. For each domain entity the
   feature's UI touches (accounts, portfolios, strategies, formulas, user identity, …),
   report the existing fixture symbol + module the test steps must import — or report
   "**not found** — new fixture required in `e2e/fixtures/` + catalog row" when the domain
   is missing or listed under "Not yet centralized".
j. `grep -rn "addAuthCookie\|addAdminCookie\|addCookieWithRoles" services/xstockstrat-ui/e2e/helpers/auth.ts`
   — cite the canonical auth helpers; new specs never re-implement JWT signing.

## Trading-domain survey (only if trading-domain-relevant)

Run this extra survey when any of these is true: `xstockstrat-trading` or
`xstockstrat-portfolio` is in Affected Services, or the product spec mentions IBKR, Alpaca,
broker, order type, order status, fill, or `TRADING_MODE`. Record every match in the
relevant step's `**Codebase Evidence**`:

```bash
# Where paper/live gating is implemented today:
grep -rn "TRADING_MODE\|TradingMode\|trading_mode\|PAPER\|LIVE" services/<name>/
# How broker dispatch is currently handled:
grep -rn "BrokerType\|broker_type\|ALPACA\|IBKR\|AlpacaClient\|IBKRClient\|BrokerInterface" services/<name>/
# Which OrderType values are currently processed:
grep -rn "OrderType\|order_type\|ORDER_TYPE_MARKET\|ORDER_TYPE_LIMIT\|ORDER_TYPE_STOP\|ORDER_TYPE_TRAILING" services/<name>/
# Where fill state is currently tracked:
grep -rn "OrderStatus\|order_status\|PARTIALLY_FILLED\|FILLED\|filled_qty\|filled_avg_price" services/<name>/
```

If a survey returns no matches, the digest must note "**not found** — pattern not yet
present in this service". These findings feed the constraints in `reference/step-constraints.md`.

## Proto search (only if proto changes required)

- Read `packages/proto/<service>/v1/<service>.proto` for each affected service.
- Read existing stubs in `packages/proto/gen/go/`, `gen/python/`, `gen/ts/` to understand
  the generated-code shape. Report existing field numbers (new fields must not reuse them).

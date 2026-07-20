# sdd-spec — step constraints

Apply these when writing each step in Step 6. Load this file only when the feature is
trading-domain-relevant (for §A) or whenever you write a `service` step (for §B).

## A. Trading-domain step constraints

Apply when the product spec is trading-domain-relevant (detected in the trading-domain
survey in `reference/discovery-checklist.md`). A step is "affected" when the survey
produced matches relevant to that step's scope.

| Domain | If step touches… | Required in **Instructions** | Required in **Verification** |
|---|---|---|---|
| **Docker Compose ↔ DO value parity** | `TRADING_MODE` or any env var with environment-specific values | State the exact value per deployment target: `TRADING_MODE: paper` in `docker-compose.yml` and `.do/app.dev.yaml`; `TRADING_MODE: live` in `.do/app.yaml` | `grep TRADING_MODE docker-compose.yml .do/app.dev.yaml .do/app.yaml` — confirm correct values in all three |
| **Broker coverage** | `BrokerType`, Alpaca client, IBKR client, or order routing | Either handle all `BrokerType` values (ALPACA=1, IBKR=2) in this step — or add an explicit note: "`IBKR`/`ALPACA`: out of scope for this step — handled by Step N" or "other broker unaffected" | If handling both brokers: verify both dispatch paths are exercised in the test step |
| **Trading mode gate** | Order placement, `PlaceOrder` RPC, or order submission logic | Include a `TRADING_MODE` check in Instructions — paper mode must not submit real orders; describe the conditional or the existing gate being reused (cite the survey hit) | `grep -n "TRADING_MODE\|TradingMode\|paper\|PAPER" <modified-file>` — confirm gate is present |
| **Order type coverage** | `OrderType` enum, order creation, order dispatch, or routing | Enumerate which of the 5 `OrderType` values this step handles: MARKET, LIMIT, STOP, STOP_LIMIT, TRAILING_STOP — or state "order type handling unaffected by this step" | If adding type handling: confirm each named type is covered in the updated code |
| **Fill state completeness** | `OrderStatus`, order fill callbacks, fill processing, or status updates | Address both `PARTIALLY_FILLED` and `FILLED` states in Instructions — describe how each is handled or propagated — or state "fill handling unaffected by this step" | Include a partial-fill test case alongside the full-fill (happy-path) case |

## B. Cross-cutting code-quality constraints (every `service` step)

These apply to **every** `service` step regardless of domain. They mirror conventions CI
already enforces — wiring them into each step's `**Verification**` surfaces failures during
`/sdd-execute` Phase 3 instead of after a per-step PR is pushed.

| Concern | Trigger | Required in **Instructions** / **Codebase Evidence** | Required in **Verification** |
|---|---|---|---|
| **Lint/format gate** | Any `service` step that creates or modifies a source file | — | Include the service's lint command (table below) in addition to the behavioral/coverage check |
| **Header propagation** | Step adds a **new outbound gRPC call** to another backend service (e.g. a new client stub call, `grpc.Dial`/`NewClient`, or a new RPC invocation on an existing client) | Cite the service's existing propagation mechanism from `docs/patterns/header-propagation.md`, confirmed via grep: Go interceptor, Python per-method `metadata`, or Node.js AsyncLocalStorage. The new call must forward `x-user-id`, `x-access-scope`, `x-trace-id`. If the call reuses an already-propagating client/interceptor, say so and cite it. | `grep -n` confirming the new call path carries the three headers (or reuses the propagating client/interceptor) |

**Lint command table** (run from repo root; matches `.github/workflows/ci.yml`):

| Language / services | Lint command |
|---|---|
| Go — `xstockstrat-trading`, `xstockstrat-portfolio`, `xstockstrat-marketdata` | `cd services/<name> && GOWORK=off golangci-lint run --modules-download-mode=mod` |
| Python — `xstockstrat-indicators`, `xstockstrat-ingest`, `xstockstrat-analysis`, `xstockstrat-agent` | `cd services/<name> && ruff check . && ruff format --check .` |
| Node.js — `xstockstrat-ledger`, `xstockstrat-identity`, `xstockstrat-notify`, `xstockstrat-config` | `cd services/<name> && pnpm run lint` |
| Next.js — `xstockstrat-trader`, `xstockstrat-insights`, `xstockstrat-config-ui` | `cd services/<name> && pnpm run lint` |

The lint command may live in the paired `test` step's `**Verification**` (alongside the
coverage command) rather than the `service` step — either placement satisfies the gate, as
long as one of the two paired steps runs it.

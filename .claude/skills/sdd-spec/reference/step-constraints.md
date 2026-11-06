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
| **Test-data inventory (C-12)** | Step adds or modifies `xstockstrat-ui` tests (Playwright spec, `mock-backend.ts` handler, or vitest unit test using domain objects) | Name the inventory fixtures the step reuses/extends, citing the frontend-survey digest (`services/xstockstrat-ui/e2e/fixtures/INVENTORY.md`); a new domain object gets a fixture module + catalog row in the same step, never an inline literal. Scenario one-offs (error payloads, `{ ...FIXTURE, override }` spreads, reserved sentinels) are exempt — say so. | `grep -n "from '../fixtures'\|from './fixtures'\|helpers/auth" <touched spec/mock files>` — confirm imports; confirm `INVENTORY.md` updated when a fixture was added/changed |
| **Test data, non-frontend (C-13)** | Step adds or modifies tests in a **non-`xstockstrat-ui`** service using mocked/dummy domain data | State whether the domain literal has a **second consumer** after this step. One consumer → inline is compliant; say so explicitly. Two or more → it moves to the service's canonical home (Python `tests/conftest.py`, Go `internal/testdata/`, Node `src/__tests__/fixtures/`) in the same step. Never create a home speculatively. | Per language, confirm no **second** inline copy was introduced: Python `grep -n "def .*fixture\|from .conftest\|conftest" <touched tests>`; Go `grep -rn "<literal symbol>" --include="*_test.go" <service>` shows ≤1 declaration site; Node `grep -n "__tests__/fixtures" <touched tests>`. A single-consumer inline literal passes — record that verdict rather than leaving the column blank |

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

## C. Green at every commit — atomic units (`**Lands with**`)

`/sdd-execute` commits one step at a time and F-05 forbids committing before that step's own
`**Verification**` passes. So **every step must be able to pass its own Verification on a tree that
contains only the steps before it.** When a step cannot, it and the step(s) that repair it are one
**atomic unit**: declare it with `**Lands with**` (template: `reference/spec-template.md`) instead of
leaving the executor to discover it as a blocker. Grep the call sites during discovery — do not infer.

| Trigger (the step…) | Required companion in the same unit |
|---|---|
| changes a signature, constructor, return shape or required argument in a package whose build or typecheck compiles tests (Node `tsc` with tests in `tsconfig.json`; any Go package with `_test.go`) | every caller and test call-site edit; fold the next `test` step in |
| edits a `.proto` | the `proto-gen` step, plus every descriptor-parity guard or hand-mapped field list the new fields turn red (grep `_MAPPED`, `*_covers_every_proto_field`) |
| adds a test that references a symbol a later step creates | the step that creates the symbol (otherwise the RED is a compile failure, not a behavior failure) |
| deletes a referenced resource | the step that repoints its references |
| seeds a config key (migration) | the reader step and its wiring test (`scripts/check-config-wiring.mjs`) |
| renames a symbol imported across modules | every importer |

Rules:
- Members must be **adjacent** step numbers and stay on **one consumer surface** (backend / ui /
  agent). A unit that must cross surfaces is a spec defect — split at the surface seam or note it in
  `## Step Dependencies` with the reason.
- Prefer the smallest unit. The default `service` → `test` pairing is **not** a unit by itself: it
  needs `**Lands with**` only when a trigger above applies.
- Cap a unit at 4 steps; larger means the design needs a seam — raise it instead of widening the unit.
- Each member keeps its own `**Files**`, `**TDD**` and `**Covers**`, so traceability stays per step.

# sdd-review — impl-spec review criteria (Mode B)

These are the per-step criteria a `spec-reviewer` subagent applies to an implementation spec.
The agent reads this file, reads `implementation-spec.md`, verifies code-checkable claims, and
returns a per-step verdict. **Mode B is advisory — it never changes lifecycle state.**

**Tag findings with the Constitution.** Where a step finding maps to a binding rule in
`docs/sdd/constitution.md`, cite the ID — e.g. `C-01` (evidence-cited), `C-07`/`F-01` (migration
naming / immutability), `C-08`/`P-06` (test pairing / red-before-green), `C-09` (proto verification).
Even in advisory mode, surface any Floor (`F-*`) risk prominently.

## B2. Per-step quality check

For each numbered step, apply:

| Criterion | FAIL condition |
|---|---|
| `**Codebase Evidence**` populated | Field is empty, says "TBD", or contains only placeholder text |
| `**Files**` has exact paths | Any path contains a wildcard, "somewhere in", or is a directory rather than a file |
| `**Instructions**` reference real symbols | Any symbol in Instructions is not confirmed in Codebase Evidence |
| `**Verification**` is runnable | Field is empty or describes a manual check with no bash command |
| Migration steps: NNN naming | Migration file name does not match `NNN_description.up.sql` pattern |
| Migration steps: down file | `.down.sql` counterpart not listed in `**Files**` |
| Proto steps: buf commands | `buf lint` and `buf breaking` not included in `**Verification**` |
| Proto steps: field numbers stated | Field numbers not specified for new fields |
| `service` steps: deployment files | A `service` step whose `**Instructions**` introduce a new environment variable or port does not list all three of `docker-compose.yml`, `.do/app.dev.yaml`, `.do/app.yaml` in `**Files**` |
| `test` steps: threshold explicit | A `test` step's `**Verification**` is absent, is prose-only with no bash command, or does not state the specific coverage threshold (`--cov-fail-under=N` for Python/Node, or `≥ N%` assertion for Go) |
| `service` steps: lint gate | A `service` step that creates/modifies source has no lint command (`golangci-lint run` for Go, `ruff check`/`ruff format --check` for Python, `pnpm run lint` for Node/Next) in its own or its paired `test` step's `**Verification**` |
| Outbound gRPC: header propagation | A step adds a new outbound gRPC call to another backend service (Instructions mention a new client stub call, `grpc.Dial`/`NewClient`, or a new RPC on an existing client) but neither `**Codebase Evidence**` nor `**Instructions**` addresses forwarding `x-user-id` / `x-access-scope` / `x-trace-id` |
| Integration completeness (`C-10`) | A step adds a new UI page/route but no step registers it in the shared nav (`PLATFORM_SUBNAV` in `PlatformHeader.tsx`) with a reachability test; OR a step changes how an authoritative-sourced value (broker mark-to-market) is read on one RPC path with no companion step/note bringing every other path that surfaces it to parity (e.g. `ListPositions` ↔ `ListPortfolios`) plus a parity test; OR a step seeds/depends on a shared resource other services use without a mutation-protection guard (RPC + read-only UI) |

WARN (advisory):
- `**Instructions**` are verbose but complete
- Step touches many files (>5) — consider splitting

## B2b. Trading-domain consistency checks (per step)

For each step, detect trading-domain relevance by checking the concatenation of its **Title**,
**Files**, **Instructions**, **Codebase Evidence**, **Verification** for:

```bash
grep -iEq 'IBKR|Alpaca|broker|OrderType|OrderStatus|partial.?fill|TRADING_MODE|paper|live|xstockstrat-trading|xstockstrat-portfolio|trading\.proto|common\.proto|broker_type|order_type|order_status|filled_qty|PlaceOrder|BrokerAccount'
```

If non-trading: skip for that step. Otherwise apply (all advisory — Mode B never blocks):

| Check | Detection trigger | FAIL condition |
|---|---|---|
| **Docker Compose ↔ DO value parity** | Step mentions env var, TRADING_MODE, port, `docker-compose`, or `.do/app` | Step adds/changes an env var in one deployment file without addressing all three; OR sets `TRADING_MODE` to the same value in both dev and prod (must be `paper` in compose+dev, `live` in prod); OR adds env vars to `docker-compose.yml` without a corresponding instruction for `.do/` files or vice versa |
| **Broker symmetry** | Step mentions IBKR, Alpaca, BrokerType, or broker-specific client code | Step implements logic for one BrokerType but has no companion step or note confirming the other supported broker is handled elsewhere or explicitly out of scope |
| **Trading mode gate** | Step mentions order execution, PlaceOrder, trade routing, or broker client calls | Step modifies order placement/routing but Instructions do not reference a `TRADING_MODE` check or conditional gating |
| **Order type exhaustiveness** | Step mentions OrderType or a specific type name (MARKET, LIMIT, STOP, STOP_LIMIT, TRAILING_STOP) | Step adds/changes order type handling but does not enumerate which of the five types are covered, or does not state "other types unaffected" |
| **Fill state completeness** | Step mentions order status, fill, PARTIALLY_FILLED, filled_qty, or fill processing | Step modifies order status handling but Codebase Evidence/Instructions do not reference both `PARTIALLY_FILLED` and `FILLED`; OR Verification only tests the full-fill scenario |

## B3. Step ordering validation

- FAIL if any `service` step depends on a `migration` step that appears later in the spec.
- FAIL if any `service` step depends on a `proto-gen` step that appears later.
- WARN if `## Step Dependencies` is empty but steps clearly have ordering constraints.
- FAIL if any `service` step for a non-frontend service (`xstockstrat-trader`,
  `xstockstrat-insights`, `xstockstrat-config-ui` are frontends — all others are not) has no
  corresponding `test` step (neither immediately following nor referenced in `## Step
  Dependencies`). Message: "Step N [service: <title>] for `<service>` has no paired `test`
  step. CI enforces a coverage threshold for this service — add a `test` step with a runnable
  coverage verification command."
- WARN if any `service` step for a frontend service has no Playwright E2E step and no note
  confirming existing E2E coverage applies.

## Verdict the agent returns

A per-step ✓/⚠/✗ table plus a summary count, in this shape:

```
Step 1 [proto: Add BrokerAccount message]
  ✓ Codebase Evidence populated
  ✗ Proto steps: field numbers not stated for new fields
Step N [service: xstockstrat-trading — Order status handler]
  ⚠ Fill state completeness — Verification tests FILLED case only; add a partial-fill scenario
  ✗ Order type exhaustiveness — handles MARKET/LIMIT but not STOP, STOP_LIMIT, TRAILING_STOP
Summary: 2 failures, 1 warning.
```

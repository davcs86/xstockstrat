# sdd-review — product-spec review criteria (Mode A)

These are the criteria a `spec-reviewer` subagent applies to a product spec. The agent reads
this file itself, reads the spec, verifies code-checkable claims, and returns a structured
verdict. Keeping the tables here (not in the router) means the orchestrator never loads them
— it receives only the verdict.

For each criterion assign ✓ PASS / ⚠ WARN / ✗ FAIL. **WARN is advisory. FAIL blocks lifecycle
advancement.**

**Tag findings with the Constitution.** Where a finding maps to a binding rule in
`docs/sdd/constitution.md`, cite the ID (e.g. `C-05` for config-key naming, `C-04` for enums). A
finding that maps to a **Floor** rule (`F-*`) is a ✗ FAIL by definition — a Floor breach cannot pass
the gate (**F-11**).

## A3. Core criteria

| # | Criterion | FAIL condition |
|---|---|---|
| 1 | **Problem Statement** | Vague, no persona named, or generic ("improve performance") |
| 2 | **Functional Requirements** | Not numbered, or any requirement is non-testable / ambiguous |
| 3 | **Out of Scope** | Section missing or has no explicit exclusion |
| 4 | **Affected Services** | Any service name does not exactly match the CLAUDE.md Service Registry |
| 5 | **Proto changes** | Proto changes listed but approval gate (additive vs. breaking) not flagged |
| 6 | **Config keys** | Any config key listed that does not follow `<service>.<category>.<key>` format |
| 7 | **DB changes** | Schema changes described but migration strategy (NNN naming, up+down, run order) not stated |
| 8 | **Acceptance Criteria** | Missing or not verifiable (no observable outcome stated) |
| 9 | **Open Questions** | Any `- [ ]` items remain unchecked and unresolved |

WARN (advisory, does not block):
- `## Out of Scope` has items but they seem insufficiently explicit
- Acceptance criteria exist but are qualitative rather than quantitative

## A3b. Trading-domain consistency checks

First detect whether the spec is trading-domain-relevant:

```bash
grep -iEq 'IBKR|Alpaca|broker|order.?type|order.?status|partial.?fill|TRADING_MODE|paper.?trad|live.?trad|xstockstrat-trading|xstockstrat-portfolio|filled_qty|BrokerType|OrderType|OrderStatus' "$PRODUCT_SPEC"
```

If no matches: report `Trading domain checks: skipped (non-trading feature).` and skip this
section. If matches found, apply all five. For each, run the detection grep to confirm the
sub-domain is touched, then verify the spec addresses the concern.

| # | Criterion | Detection grep | FAIL condition | WARN condition |
|---|---|---|---|---|
| C-1 | **Docker Compose ↔ DO value parity** | `grep -iE 'env.?var\|TRADING_MODE\|environment.?variable\|new.*port\|new.*service' "$PRODUCT_SPEC"` | Spec introduces a new env var, port, or service but does not explicitly state the expected value for each deployment target (local/compose, DO dev, DO prod), or does not note that all three deployment files need updating | Spec states env var changes but omits that `TRADING_MODE` must be `paper` in compose+dev and `live` in prod |
| C-2 | **Broker/Ledger provider coverage** | `grep -iE 'IBKR\|Alpaca\|broker\|BrokerType\|credential\|account.*management\|order.*routing' "$PRODUCT_SPEC"` | Spec modifies broker behavior (order routing, account management, credential storage) but does not explicitly state which `BrokerType` values are in scope (`ALPACA`, `IBKR`) and which are out of scope | Spec adds broker logic for one provider without a note that the other provider is unaffected |
| C-3 | **Trading mode (Paper vs Live)** | `grep -iE 'order.*execut\|PlaceOrder\|trade.*execut\|order.*routing\|TRADING_MODE' "$PRODUCT_SPEC"` | Spec changes order execution behavior but does not address how the feature behaves differently under `TRADING_MODE=paper` vs `TRADING_MODE=live` | Spec does not state whether the feature is paper-safe (testable in dev/compose without live market access) |
| C-4 | **Order type coverage** | `grep -iE 'order.?type\|OrderType\|MARKET\|LIMIT\|STOP\|TRAILING_STOP' "$PRODUCT_SPEC"` | Spec introduces or modifies order type handling but does not enumerate which of the five `OrderType` values are supported (MARKET, LIMIT, STOP, STOP_LIMIT, TRAILING_STOP), or does not state "existing order types unaffected" | Acceptance criteria test only one order type without confirming others are unaffected |
| C-5 | **Partial vs full fill handling** | `grep -iE 'fill\|PARTIALLY_FILLED\|filled_qty\|order.*status\|OrderStatus' "$PRODUCT_SPEC"` | Spec introduces or modifies order status lifecycle handling but does not explicitly address both `ORDER_STATUS_PARTIALLY_FILLED` and `ORDER_STATUS_FILLED`, or does not state "fill handling unaffected" | Acceptance criteria cover only the full-fill (happy-path) scenario |

FAILs in C-1 through C-5 block lifecycle advancement (same weight as A3 failures). WARNs are advisory.

## Verdict the agent returns

The agent returns a per-criterion ✓/⚠/✗ table plus an overall `PASS` / `PASS WITH WARNINGS` /
`FAIL`, in the structure below. The router uses the overall verdict to drive the A6 lifecycle
write — it does not re-derive the criteria.

```
Spec Criteria:
  ✓ Problem Statement — specific, persona named
  ✗ Config keys — key `trading.orders.retries` missing service-category-key format
  ...
Trading Domain Checks (trading feature: yes|skipped):
  ✗ Order type coverage — modifies OrderType handling but does not enumerate STOP, STOP_LIMIT, TRAILING_STOP
  ...
Overall: FAIL (1 spec failure, 1 trading-domain failure)
```

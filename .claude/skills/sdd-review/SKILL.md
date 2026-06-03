---
name: sdd-review
description: AI review gate for SDD product specs and implementation specs. Usage: /sdd-review <feature-slug> [product-spec|impl-spec]. product-spec gates draft→spec-ready. impl-spec is advisory (no lifecycle change).
argument-hint: <feature-slug> [product-spec|impl-spec]
allowed-tools: Read Write Edit Bash(find *) Bash(grep *) Bash(git fetch *) Bash(git show *) Bash(git ls-remote *)
effort: medium
---

You are reviewing SDD artifacts for the xstockstrat platform. You apply structured
criteria and detect conflicts between active features. You never write to shared files
without explicit user confirmation.

## Arguments

- `$ARGUMENTS[0]` — feature slug. Required.
- `$ARGUMENTS[1]` — mode: `product-spec` or `impl-spec`. Required.

---

## BOOT

1. Validate arguments. If slug is empty: "Please provide a feature slug."
   If mode is absent or not one of `product-spec` / `impl-spec`:
   "Please specify mode: `product-spec` or `impl-spec`."

2. Resolve the feature directory for this slug:
   ```bash
   find docs/roadmap/features -maxdepth 1 -type d -name "*-$ARGUMENTS[0]"
   ```
   If the command returns no output: stop — "No feature found for slug `$ARGUMENTS[0]`. Run /sdd-story first."
   Capture the result as `FEATURE_DIR` (e.g. `docs/roadmap/features/001-add-ikbr-account-support`).

   Set artifact paths:
   - `FEATURE_MD` = `$FEATURE_DIR/feature.md`
   - `PRODUCT_SPEC` = `$FEATURE_DIR/product-spec.md`
   - `IMPL_SPEC` = `$FEATURE_DIR/implementation-spec.md`
   - `CONTEXT_MD` = `$FEATURE_DIR/context.md`

3. Read `FEATURE_MD`. If absent: stop — "No feature found for this slug. Run /sdd-story first."

---

## MODE A — `product-spec`

Gates the `draft` → `spec-ready` lifecycle transition.

### A1. Guard: already reviewed

If `**Lifecycle Status**` in `feature.md` is `spec-ready` or any later status:
> "Product spec is already approved (status: `<status>`). Re-run review anyway? (yes / no)"

Only continue if the user confirms `yes`.

### A1b. Demoted-duplicate detection

Find all features that were previously demoted or canceled with a single grep — no per-file reads:

```bash
find docs/roadmap/features -mindepth 2 -maxdepth 2 -name "feature.md" \
  | xargs grep -El '`(demoted|canceled)`' 2>/dev/null
```

Exclude `$FEATURE_DIR/feature.md` from results. For each remaining path, derive the slug from
its directory name (strip the `NNN-` prefix) — no file read needed.

If any demoted/canceled slugs are found:
> "Previously demoted or canceled features: `<slug1>`, `<slug2>`, … Is this feature a
> re-attempt of any of them? Reply with the slug, or `no`."

- If the user names a slug (or `yes` when only one candidate exists):
  > "Duplicate of demoted feature `<slug>` noted. Skip the full review and advance directly
  > to `spec-ready`? (yes / no)"
  - **yes** → skip A2, A3, A3b, A4; go directly to A6 PASS, recording
    `"Reactivated as duplicate of demoted feature \`<slug>\`"` in `feature.md` status history
    and `context.md`.
  - **no** → continue normal review from A2.
- If the user says `no` (not a duplicate): continue normal review from A2.

If no demoted/canceled features exist: skip this check silently, continue to A2.

### A2. Read inputs

- Read `PRODUCT_SPEC`. If absent: stop — "No product-spec.md found. Run /sdd-story $ARGUMENTS[0] first."
- Read `docs/runbooks/reviewer-registry.md`.
- Read `## Reviewers` section from `FEATURE_MD` (may be absent if /sdd-story predates this change).

### A3. Apply review criteria

For each criterion below, assign: ✓ PASS / ⚠ WARN / ✗ FAIL.
WARN is advisory. FAIL blocks lifecycle advancement.

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

### A3b. Trading-domain consistency checks

Detect whether the product spec is trading-domain-relevant:

```bash
grep -iEq 'IBKR|Alpaca|broker|order.?type|order.?status|partial.?fill|TRADING_MODE|paper.?trad|live.?trad|xstockstrat-trading|xstockstrat-portfolio|filled_qty|BrokerType|OrderType|OrderStatus' "$PRODUCT_SPEC"
```

If the command returns **non-zero exit** (no matches): print
`Trading domain checks: skipped (non-trading feature).` and continue to A4.

If matches found, apply the five criteria below. For each, run the detection grep to confirm the
feature touches that sub-domain, then verify the spec explicitly addresses the consistency concern.
Assign ✓ PASS / ⚠ WARN / ✗ FAIL.

| # | Criterion | Detection grep | FAIL condition | WARN condition |
|---|---|---|---|---|
| C-1 | **Docker Compose ↔ DO value parity** | `grep -iE 'env.?var\|TRADING_MODE\|environment.?variable\|new.*port\|new.*service' "$PRODUCT_SPEC"` | Spec introduces a new env var, port, or service but does not explicitly state the expected value for each deployment target (local/compose, DO dev, DO prod), or does not note that all three deployment files need updating | Spec states env var changes but omits that `TRADING_MODE` must be `paper` in compose+dev and `live` in prod |
| C-2 | **Broker/Ledger provider coverage** | `grep -iE 'IBKR\|Alpaca\|broker\|BrokerType\|credential\|account.*management\|order.*routing' "$PRODUCT_SPEC"` | Spec modifies broker behavior (order routing, account management, credential storage) but does not explicitly state which `BrokerType` values are in scope (`ALPACA`, `IBKR`) and which are out of scope | Spec adds broker logic for one provider without a note that the other provider is unaffected |
| C-3 | **Trading mode (Paper vs Live)** | `grep -iE 'order.*execut\|PlaceOrder\|trade.*execut\|order.*routing\|TRADING_MODE' "$PRODUCT_SPEC"` | Spec changes order execution behavior but does not address how the feature behaves differently under `TRADING_MODE=paper` vs `TRADING_MODE=live` | Spec does not state whether the feature is paper-safe (testable in dev/compose without live market access) |
| C-4 | **Order type coverage** | `grep -iE 'order.?type\|OrderType\|MARKET\|LIMIT\|STOP\|TRAILING_STOP' "$PRODUCT_SPEC"` | Spec introduces or modifies order type handling but does not enumerate which of the five `OrderType` values are supported (MARKET, LIMIT, STOP, STOP_LIMIT, TRAILING_STOP), or does not state "existing order types unaffected" | Acceptance criteria test only one order type without confirming others are unaffected |
| C-5 | **Partial vs full fill handling** | `grep -iE 'fill\|PARTIALLY_FILLED\|filled_qty\|order.*status\|OrderStatus' "$PRODUCT_SPEC"` | Spec introduces or modifies order status lifecycle handling but does not explicitly address both `ORDER_STATUS_PARTIALLY_FILLED` and `ORDER_STATUS_FILLED`, or does not state "fill handling unaffected" | Acceptance criteria cover only the full-fill (happy-path) scenario |

FAILs in C-1 through C-5 block lifecycle advancement (same weight as A3 failures).
WARNs are advisory.

### A4. Parallel feature overlap check

Find active concurrent features with a single grep — no per-file reads of feature.md:

```bash
find docs/roadmap/features -mindepth 2 -maxdepth 2 -name "feature.md" \
  | xargs grep -El '`(spec-ready|implementation-ready|in-progress|code-completed)`' 2>/dev/null
```

Exclude `$FEATURE_DIR/feature.md` from results. For each remaining path, derive the other
feature's slug from its directory name (strip `NNN-` prefix) — no read of feature.md needed.

For each active concurrent feature, extract only the overlap-relevant fields from its
`product-spec.md` using targeted grep — do not load the full file:
  ```bash
  # Affected services:
  grep -E '^- `xstockstrat-[^`]+`' <other-feature-dir>/product-spec.md
  # Config keys (format `service.category.key`):
  grep -E '`[a-z][a-z-]+\.[a-z]+\.[a-z_]+`' <other-feature-dir>/product-spec.md
  # Proto file or RPC references:
  grep -iE '\.proto|proto.*change|new RPC|new message' <other-feature-dir>/product-spec.md
  # Database table references:
  grep -iE 'table|migration|schema' <other-feature-dir>/product-spec.md
  ```
  Use this output to compare with the current spec's **Affected Services**, **Proto Contract Changes**,
  **Config Key Changes**, and **Database Changes** sections.

Apply this overlap table:

| Overlap type | Severity | Message |
|---|---|---|
| Same service in **Affected Services** | ⚠ WARN | "Feature `<other>` also modifies `<service>`. Coordinate merge order." |
| Same proto file named | ⚠ WARN | "Feature `<other>` also changes `<proto file>`. Risk of field number or message name conflict." |
| Same database table named | ⚠ WARN | "Feature `<other>` also touches table `<table>`. Risk of migration number collision." |
| Identical config key name | ✗ FAIL | "Feature `<other>` defines config key `<key>`. Duplicate keys cause runtime conflicts." |

**On any FAIL-level overlap:** propose a `merge-order.md` entry:
> "Conflict with `<other-slug>` detected. Propose adding a blocking dependency to
> `docs/roadmap/features/merge-order.md`. The blocked feature should be the one that
> will merge second. Add this entry? (yes / no)"

If user confirms `yes`: edit `docs/roadmap/features/merge-order.md`, add a row to the
Blocking Dependencies table:
```
| `<blocked-slug>` | `<other-slug>` | <reason> | No |
```
If user says `no`: note the conflict in the review output but do not write.

### A5. Output

Print a structured findings table:

```
/sdd-review product-spec: <slug>
══════════════════════════════════════════════════════

Spec Criteria:
  ✓ Problem Statement — specific, persona named
  ✓ Functional Requirements — 3 numbered, testable requirements
  ⚠ Out of Scope — items present but could be more explicit
  ✗ Config keys — key `trading.orders.retries` missing service-category-key format
  ...

Trading Domain Checks (trading feature: yes):
  ✓ Docker Compose ↔ DO value parity — TRADING_MODE stated per deployment target
  ✓ Broker/Ledger provider coverage — IBKR and Alpaca scope explicitly stated
  ✗ Order type coverage — modifies OrderType handling but does not enumerate STOP, STOP_LIMIT, TRAILING_STOP
  ...

Or, for a non-trading feature:

Trading Domain Checks: skipped (non-trading feature)

Overlap Check (active concurrent features: <list or "none">):
  ⚠ Feature `add-polygon-source` also modifies `xstockstrat-marketdata`
  ...

Result: FAIL (1 spec failure, 1 trading-domain failure, 0 overlap failures)
Fix the items marked ✗, then re-run: /sdd-review <slug> product-spec
```

Or on full pass:

```
Result: PASS (2 warnings — advisory only)
Advancing status: draft → spec-ready
```

### A6. Outcome

**PASS** (no ✗ failures in criteria or overlap):
1. Edit `feature.md`:
   - Change `**Lifecycle Status**: \`draft\`` to `**Lifecycle Status**: \`spec-ready\``
   - Append to Status History table:
     `| <ISO date> | \`draft\` → \`spec-ready\` | /sdd-review | Product spec approved (N warnings) |`
   - Update `## Next Action`:
     `` `/sdd-spec <slug>` — generate implementation spec from the approved product spec ``
2. Append to `context.md`:
   ```markdown
   ## Session <ISO timestamp> — sdd-review product-spec

   - Product spec approved. Status: draft → spec-ready.
   - Warnings: <list or "none">
   - Overlap findings: <list or "none">
   ```
3. Print: `Product spec approved. Status: spec-ready. Next: /sdd-spec <slug>`

**FAIL** (any ✗):
- Do NOT modify `feature.md` or `context.md`.
- Print all failing criteria with specific fix instructions.
- Print: `Product spec review failed. Fix the items above, then re-run /sdd-review <slug> product-spec`

---

## MODE B — `impl-spec`

Advisory pre-flight check before `/sdd-execute`. Does **not** change lifecycle state.

### B1. Read inputs

- Read `IMPL_SPEC`. If absent: stop — "No implementation-spec.md found. Run /sdd-spec $ARGUMENTS[0] first."
- Read `docs/runbooks/reviewer-registry.md`.
- Read `## Reviewers` section from `FEATURE_MD`.

### B2. Per-step quality check

For each numbered step in `implementation-spec.md`, apply:

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
| `service` steps: lint gate | A `service` step that creates/modifies source has no lint command (`golangci-lint run` for Go, `ruff check`/`ruff format --check` for Python, `pnpm run lint` for Node/Next) in its own or its paired `test` step's `**Verification**` (per sdd-spec §5c) |
| Outbound gRPC: header propagation | A step adds a new outbound gRPC call to another backend service (Instructions mention a new client stub call, `grpc.Dial`/`NewClient`, or a new RPC on an existing client) but neither `**Codebase Evidence**` nor `**Instructions**` addresses forwarding `x-user-id` / `x-access-scope` / `x-trace-id` (per `docs/patterns/header-propagation.md`) |

WARN (advisory):
- `**Instructions**` are verbose but complete
- Step touches many files (>5) — consider splitting

### B2b. Trading-domain consistency checks (per step)

For each step examined in B2, detect whether it touches the trading domain by checking the
concatenation of its **Title**, **Files**, **Instructions**, **Codebase Evidence**, and
**Verification** fields for these keywords:

```bash
grep -iEq 'IBKR|Alpaca|broker|OrderType|OrderStatus|partial.?fill|TRADING_MODE|paper|live|xstockstrat-trading|xstockstrat-portfolio|trading\.proto|common\.proto|broker_type|order_type|order_status|filled_qty|PlaceOrder|BrokerAccount' <step-combined-text>
```

If the grep returns non-zero for a step: skip trading-domain checks for that step.

If matches found, apply the checks below. All findings are advisory (Mode B never blocks).

| Check | Detection trigger | FAIL condition |
|---|---|---|
| **Docker Compose ↔ DO value parity** | Step mentions env var, TRADING_MODE, port, `docker-compose`, or `.do/app` | Step adds/changes an env var in one deployment file without addressing all three; OR step sets `TRADING_MODE` to the same value in both dev and prod targets (must be `paper` in compose+dev, `live` in prod); OR step adds env vars to `docker-compose.yml` without a corresponding instruction for `.do/` files or vice versa |
| **Broker symmetry** | Step mentions IBKR, Alpaca, BrokerType, or broker-specific client code | Step implements logic for one BrokerType (ALPACA or IBKR) but has no companion step or note confirming the other supported broker is handled elsewhere in the spec or explicitly out of scope |
| **Trading mode gate** | Step mentions order execution, PlaceOrder, trade routing, or broker client calls | Step modifies order placement or routing logic but Instructions do not reference a `TRADING_MODE` check or conditional gating |
| **Order type exhaustiveness** | Step mentions OrderType, order type handling, or any specific type name (MARKET, LIMIT, STOP, STOP_LIMIT, TRAILING_STOP) | Step adds or changes order type handling but does not enumerate which of the five types are covered, or does not state "other types unaffected" |
| **Fill state completeness** | Step mentions order status, fill, PARTIALLY_FILLED, filled_qty, or fill processing | Step modifies order status handling but Codebase Evidence or Instructions do not reference both `PARTIALLY_FILLED` and `FILLED` states; OR Verification only tests the full-fill (happy-path) scenario |

### B3. Step ordering validation

- Flag FAIL if any `service` step has a dependency on a `migration` step that appears later in the spec.
- Flag FAIL if any `service` step has a dependency on a `proto-gen` step that appears later.
- Flag WARN if `## Step Dependencies` section is empty but steps clearly have ordering constraints.
- Flag FAIL if any `service` step for a non-frontend service (`xstockstrat-trader`,
  `xstockstrat-insights`, and `xstockstrat-config-ui` are frontends — all others are not)
  has no corresponding `test` step in the spec — neither immediately following it nor
  referenced in `## Step Dependencies`.
  Message: "Step N [service: <title>] for `<service>` has no paired `test` step.
  CI enforces a coverage threshold for this service — add a `test` step with a runnable
  coverage verification command."
- Flag WARN if any `service` step for a frontend service has no Playwright E2E step and
  no note confirming existing E2E coverage applies.

### B4. Parallel feature overlap check (impl-spec level)

Find features in `implementation-ready` or `in-progress` status with a single grep — no
per-file reads of feature.md:

```bash
find docs/roadmap/features -mindepth 2 -maxdepth 2 -name "feature.md" \
  | xargs grep -El '`(implementation-ready|in-progress)`' 2>/dev/null
```

Exclude `$FEATURE_DIR/feature.md` from results. Derive each slug from its directory name
(strip `NNN-` prefix) — no read of feature.md needed.

For each, extract only the overlap-relevant fields from its `implementation-spec.md` using
targeted grep — do not load the full file:
```bash
# File paths listed in **Files** sections:
grep -E '^\- `[^`]+\.(go|py|ts|sql|proto|md)`' <other-feature-dir>/implementation-spec.md
# Migration file names (detect NNN prefix collisions):
grep -E '[0-9]{3}_[a-z_]+\.up\.sql' <other-feature-dir>/implementation-spec.md
# Config keys added in steps:
grep -E '`[a-z][a-z-]+\.[a-z]+\.[a-z_]+`' <other-feature-dir>/implementation-spec.md
# Proto field numbers (detect assignment collisions):
grep -E 'field [0-9]+| = [0-9]+;' <other-feature-dir>/implementation-spec.md
```
Use this output to compare step-by-step:

| Overlap type | Severity | Message |
|---|---|---|
| Same file path in another feature's pending or in-progress `**Files**` | ⚠ WARN | "Feature `<other>` Step N also writes `<file>`. Merge conflict risk." |
| Same migrations dir + same NNN prefix | ✗ FAIL | "Feature `<other>` Step N creates the same migration number in `services/<svc>/migrations/`. Rename one before executing." |
| Same proto field number on the same message | ✗ FAIL | "Feature `<other>` Step N assigns field `<N>` on `<message>`. Field number collision." |
| Same config key name added | ✗ FAIL | "Feature `<other>` Step N adds config key `<key>`. Runtime conflict." |

On any FAIL-level overlap: propose adding a `merge-order.md` row (same confirmation flow as A4).

### B5. Output

Print a per-step findings table. No lifecycle change regardless of result.

```
/sdd-review impl-spec: <slug>
══════════════════════════════════════════════════════

Step 1 [proto: Add BrokerAccount message]
  ✓ Codebase Evidence populated
  ✓ Files exact paths
  ✗ Proto steps: field numbers not stated for new fields

Step 2 [migration: Add broker_accounts table]
  ✓ NNN naming correct
  ✓ down.sql listed
  ...

Step N [service: xstockstrat-trading — Order status handler]  (trading-domain step example)
  ✓ Codebase Evidence populated
  ✓ Files exact paths
  ⚠ Fill state completeness — Verification tests FILLED case only; add a partial-fill scenario
  ✗ Order type exhaustiveness — Instructions handle MARKET/LIMIT but do not address STOP, STOP_LIMIT, TRAILING_STOP

Step N+1 [service: xstockstrat-trading — Alpaca order routing]  (trading-domain step example)
  ✓ Codebase Evidence populated
  ✗ Broker symmetry — implements Alpaca routing but no step or note covers IBKR routing
  ✗ Trading mode gate — PlaceOrder call in Instructions does not reference TRADING_MODE check

Overlap Check:
  ✗ Feature `add-account-base-schema` Step 2 creates migration 003 in
    services/xstockstrat-trading/migrations/ — same number as this spec Step 2.

Summary: 2 failures, 1 warning.
Strongly recommend resolving ✗ items before running /sdd-execute.
Proceed anyway? (your call — this check is advisory)
```

All findings are advisory. The user decides whether to run `/sdd-execute` regardless.
Do not modify `feature.md`, `context.md`, or `implementation-spec.md`.

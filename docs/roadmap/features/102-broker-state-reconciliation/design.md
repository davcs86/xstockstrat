# Design: broker-state-reconciliation

**Created**: 2026-08-06
**From**: product-spec.md + recon.md
**Debate**: full mode, 3 rounds

---

## Chosen Approach

### Ticker placement

A new `StartReconciliationPoller` in `xstockstrat-trading`, mirroring `StartFillPoller`'s/
`StartPositionSyncPoller`'s exact ticker+`ctx.Done()`+live-config-reread shape
(`services/xstockstrat-trading/internal/service/trading.go:629-650,766-809`), wired at startup
alongside the other three (`cmd/server/main.go:106,108,110`). This is genuinely distinct from the
existing pollers — bidirectional compare-and-classify with safety side-effects (halt, alert, 101-intent
resolution), not a one-way pull/push — not folded in.

### Broker-side bulk order listing (closes AC-1's original gap)

**Externally verified during this design's debate** (not merely asserted): both brokers really do
support bulk order listing, contradicting round 1's initial "no bulk list-orders exists" premise, which
was checked only against the internal `Broker` interface, never the real REST APIs.

- **Alpaca**: `GET /v2/orders` is a real, documented endpoint (Alpaca's public API docs), defaulting to
  open orders, with `status`/`limit`/`symbols` filters. `alpaca.go` currently implements submit/cancel/
  replace/single-`GetOrder` only — not this bulk call.
- **IBKR**: `ibkr.go`'s existing `GetOrder` (`internal/broker/ibkr.go:254-286`) already calls a bulk
  endpoint (`GET /iserver/account/orders`) and parses a `{"orders": [...]}` array, then discards
  everything but the first entry matching an `orderId` query filter. Dropping that filter and returning
  the full array is nearly free reuse of the same endpoint/parsing shape.

`Broker.ListOrders(ctx) ([]BrokerOrder, error)` is added to the shared interface
(`internal/broker/broker.go:57-76`). **IBKR's call must additionally pass an explicit
`accountId=c.ibkrAccountID` query param** — `GetOrder` today relies on `orderId` alone to implicitly
scope its result, and a bulk call with no `orderId` has nothing else scoping it under a Client Portal
session that can span multiple sub-accounts. **Open Risk**: whether IBKR's real API supports an
`accountId` filter on this endpoint is unverified in this repo — `/sdd-spec` must confirm against
IBKR's docs and write a test asserting `ListOrders` results are actually scoped to the configured
account, not merely trust the endpoint (a distinct risk from the client-order-id field-name risk below).

With `ListOrders` real, the detection loop calls it once per broker account per tick and diffs the
returned broker order IDs against trading's own known order IDs (`s.orders`, `s.repo`) — a broker order
ID with no matching platform record is a genuine "unknown broker order" finding, **detected within one
tick whether or not it has filled yet**, making AC-1 literally true rather than "true once filled." This
also shrinks the poller's per-tick cost from round 1's O(open-orders) serial `GetOrder` calls to O(1)
bulk calls per account — a strict reduction, not a new load concern.

### Mismatch classification (FR-2)

- **Propagation-delay**: any order-status or position-quantity difference discovered within
  `grace_ticks` (new config, default 1 — i.e. must persist across 2 consecutive ticks) of the platform's
  own record's last update. **No ledger event is written for this class at all** — it's not "found," per
  FR-2's own explicit carve-out that `ORDER_STATUS_PARTIALLY_FILLED` is routine. Self-heal (FR-3) for
  this class means literally no action, no event — `pollFills`/`syncPositions` converge it on their own
  normal cadence; reconciliation's only role is to not escalate before the grace window elapses.
- **Quantity discrepancy**: after the grace window, broker's remaining quantity (`Qty - FilledQty`)
  disagrees with the platform's recorded remaining quantity on a **known** order, or a broker position
  quantity disagrees with `portfolio.ListPositions`' record on a **known** symbol/account.
- **Unknown broker order**: now detected directly (see above) — a broker order ID absent from trading's
  own records, whether still open or filled.
- **Missing broker order**: a **known** order whose broker lookup (via `ListOrders`'s diff, or a
  fallback single-order `GetOrder`) returns not-found or an unexpected terminal state the platform never
  recorded.
- **Unprotected/impossible** (resolving product-spec's Open Question concretely): broker/portfolio state
  unattributable to *any* platform-known account/symbol/order/intent at all — e.g. a position under a
  broker account not present in `trading.broker_accounts` — **or** reconciliation itself cannot
  establish trust in broker truth broadly (broker/portfolio calls erroring across a threshold share of
  accounts in one tick). This is the bucket that triggers the rare platform-wide escalation (below); an
  ordinary single-account finding never does.
- **`ORDER_STATUS_FILLED` interaction** (resolving product-spec's other Open Question): a fully-filled
  order drops out of the open-order loop and is caught only via the position-side quantity-discrepancy
  bucket, if at all — stated explicitly, not left implicit.

### Halt-routing (FR-4) — split by axis, per user-approved amendment to AC-3/FR-4

Round 1's adversary found that 030's per-account halt (`trading.broker_accounts.halted`/`halted_at`/
`halt_reason`, planned, unimplemented) and this feature's own proposed mechanism are the **same axis**
— automated, per-account circuit breakers — not orthogonal to each other, contradicting 030's own
`design.md`, which explicitly says future features "must not reinvent or attempt to unify 030's
per-account schema." Reusing rather than duplicating is the correct read of that guidance.

- **Ordinary, per-account findings** (quantity-discrepancy, unknown-broker-order, missing-broker-order,
  and an account-scoped unprotected/impossible finding) halt via **030's** mechanism: this feature adds
  a `HaltSource` discriminator (see Proto below) and writes `halted=true, halt_source=RECONCILIATION` to
  the same `trading.broker_accounts` row 030 owns — an in-process DB write within `xstockstrat-trading`
  itself, no `SetConfig`/authz surface needed for the common case.
- **Rare, genuinely systemic findings** (reconciliation cannot establish trust in broker truth broadly)
  escalate to **100's** platform-wide `platform.trading_state` via a new internal-caller authz mechanism
  (below) — this is the resolution of product-spec's "unprotected/impossible state" Open Question, and
  the amended reading of FR-4/AC-3's "via the rescoped 100" language: 100's gate is reserved for this
  rare case, not every ordinary finding. **User-approved override recorded in context.md 2026-08-06.**

### Internal-caller authz for `platform.trading_state` (closes 100's own Open Risk #3)

100's `design.md` confirmed `SetConfig` is unconditionally ADMIN-scope-gated with no internal-caller
bypass and named 102 as needing to build one. Round 1 initially tried to dodge this wall entirely
(bypassed, not solved); round 2 tried reusing `x-access-scope`'s user-role bitmap for a service
self-assertion, which the adversary correctly rejected — that header has only ever carried a value
*forwarded* from a real human-authenticating entry point, never *self-originated* by a service, and the
check was per-(namespace,key) not per-caller-identity, meaning any code path in trading's binary could
construct it.

**Resolved: a new, structurally separate internal-caller channel** — not an extension of
`x-access-scope`.

```ts
// services/xstockstrat-config/src/grpc/authz.ts — additive, alongside hasAdminAccessScope
export const HEADER_INTERNAL_CALLER = 'x-internal-caller';

const INTERNAL_CALLER_ALLOWLIST: ReadonlyArray<{
  callerID: string; namespace: string; key: string;
  allowedTargetValues: ReadonlyArray<string>;  // direction-restricted — see fix below
}> = [
  {
    callerID: 'trading-reconciliation-poller', namespace: 'platform', key: 'trading_state',
    allowedTargetValues: ['REDUCE_ONLY', 'HALTED'],  // never 'ACTIVE' — escalation only
  },
];

export function hasInternalCallerAuthority(
  md: Metadata | undefined, callerID: string, namespace: string, key: string, targetValue: string,
): boolean {
  if (!callerID) return false;
  if (first(md, HEADER_INTERNAL_CALLER) !== callerID) return false;
  return INTERNAL_CALLER_ALLOWLIST.some(
    (e) => e.callerID === callerID && e.namespace === namespace && e.key === key
        && e.allowedTargetValues.includes(targetValue),
  );
}
```

`setConfig`'s gate (`services/xstockstrat-config/src/grpc/configServiceImpl.ts:286-300`) becomes:

```ts
const internalCaller = first(call.metadata, HEADER_INTERNAL_CALLER);
const authorized =
  hasAdminAccessScope(call.metadata) ||
  (internalCaller && hasInternalCallerAuthority(call.metadata, internalCaller, call.request.namespace, call.request.key, call.request.value));
if (!authorized) { callback(ADMIN_SCOPE_ERROR); return; }
```

**Additive, not a replacement** — `hasAdminAccessScope`/`x-access-scope`+`ADMIN_SCOPE` is untouched;
humans via config-ui are unaffected.

**Round 3's final fix (direction restriction), folded in directly — no round 4 needed.** Round 2's
version of this check authorized the caller for *any* value on the allow-listed key, which meant a
buggy trading code path (or any internal-network process that discovered the literal string) could
write `platform.trading_state = ACTIVE`, silently clearing an operator's legitimate `HALTED` — the
single most dangerous direction for a live-capital kill switch, and the opposite of what this
escalation path exists for. The `allowedTargetValues` field above closes this: the internal-caller path
can only ever move the state *toward* restriction (`→REDUCE_ONLY`, `→HALTED`), never back toward
`ACTIVE`. **Open Risk carried to `/sdd-spec`**: a negative test asserting an internal-caller write of
`ACTIVE` is rejected must exist before this ships.

**Trust model, stated explicitly (not glossed over):** this does not cryptographically bind "this call
really came from trading's reconciliation poller" — it trusts network position, the same model every
other backend RPC on this platform uses (`docs/patterns/header-propagation.md`: "Authentication/
authorization happens once, at the entry point; internal backend services do not re-authenticate"), and
`xstockstrat-config`'s gRPC port is confirmed internal-network-only (`.do/app.yaml` `internal_ports`
only, no external `routes:` entry; `docker-compose.yml`'s Docker-bridge-only hostname). This is a real,
deliberate trade-off, not an oversight: cryptographic caller verification (mTLS/SPIFFE) exists nowhere
on this platform today, and the platform has actively *removed* a shared-secret outbound header before
(feature 097's `x-mcp-secret`) — demanding crypto-verified identity here alone would be inconsistent
with platform precedent and disproportionate scope for this feature. The genuine, meaningful containment
win over round 2's rejected alternative (reusing `ADMIN_SCOPE`, which would grant write access to
*every* config key) is the `{caller, namespace, key, value-direction}` allow-list narrowing this to
exactly one escalation-only write, not a general capability.

**Attribution and structural audit trail.** `xstockstrat-trading` sets `x-internal-caller:
trading-reconciliation-poller` on its outbound `SetConfig` call (a genuinely new `trading → config`
edge — trading currently only has a `WatchConfig` client, reusing the already-configured
`CONFIG_ENDPOINT`, no new env var). `SetConfigRequest.author = "system:reconciliation-poller"`,
registered as a documented author-sentinel convention (`docs/patterns/config-governance.md`, new
"Author-sentinel conventions" subsection — per Constitution C-10(c) and the exact lesson `fails.md`
2026-07-01 logged for an undocumented `author="system"` precedent; this subsection also retroactively
documents indicators' pre-existing sentinel).

**Round 3's second final fix, folded in directly.** A free-text `author` convention alone is not
structurally adequate for incident review — nothing distinguishes "an operator clicked Save" from "the
reconciliation poller escalated" except a string an investigator must know to grep for. `caller_identity
TEXT` is added as a new column on **both** `config.config_values` and `config.config_audit` (a new
`xstockstrat-config` migration — number contested, see Migrations below), with both audit-trigger
functions (`audit_config_change`, `001_config_tables.up.sql:37-47`; `audit_config_insert`,
`010_config_audit_insert_trigger.up.sql:17-24`) updated to copy it through their **explicit named
column lists** (verified directly: neither trigger does a `NEW.*` passthrough — both build their
`INSERT INTO config.config_audit` from a named column list, so this is a real, necessary edit to both
function bodies, not an automatic passthrough).

**Critical completeness fix, also folded in directly**: round 3's initial description only updated the
schema and the trigger functions — it never updated `setConfig`'s own write path
(`configServiceImpl.ts:338-346`, an `INSERT ... ON CONFLICT (...) DO UPDATE SET value_data=...,
updated_by=..., update_reason=..., updated_at=NOW()`). Since `platform.trading_state` is pre-seeded by
100's migration, every runtime `SetConfig` call against it takes the `DO UPDATE` branch — if that
`SET` clause doesn't include `caller_identity = EXCLUDED.caller_identity`, the column stays `NULL`
forever regardless of how many internal-caller writes land, and the entire audit-trail goal silently
fails to materialize. **The design requires**: a new bound parameter populated from
`first(call.metadata, 'x-internal-caller')` (empty → `NULL`), added to **both** the `INSERT` column list
**and** the `ON CONFLICT DO UPDATE SET` clause. This is the exact class of "correct schema/trigger
reasoning, unverified write-path completion" the ledger already warns about for safety-gate write paths.

**Open Risk**: the new `trading → config` edge should carry a fresh `x-trace-id` for audit correlation
given this call's blast radius — named for `/sdd-spec`, not designed in detail here.

### `HaltSource` — real proto enum, not a deferred string

Unlike 100's `platform.trading_state` (a legacy-string-shaped field forcing a genuine C-04 deferral),
`halt_source` is a brand-new, greenfield field on `BrokerAccount` for a closed, deployment-time-defined
value set — no legacy-string excuse to defer against. Mirrors `CredentialStatus`'s exact shape
(`trading.proto:158-165`, migration `004_broker_accounts_credential_status.up.sql:3-7` — proto enum →
`SMALLINT` column with a documented mapping comment):

```proto
enum HaltSource {
  HALT_SOURCE_UNSPECIFIED = 0;
  HALT_SOURCE_BRACKET_PROTECTION = 1;  // 030
  HALT_SOURCE_RECONCILIATION = 2;       // 102
}
```

### Proto — `BrokerAccount` field claim (pre-assignment required)

Real committed highest field on `BrokerAccount` today is `credential_checked_at=8`
(`trading.proto:168-180`), so fields **9-12** are genuinely next-available:

```proto
bool halted = 9;
google.protobuf.Timestamp halted_at = 10;
string halt_reason = 11;
HaltSource halt_source = 12;
```

surfaced via the existing `ListBrokerAccounts` RPC, no new RPC needed. **030's own `design.md` never
proposed exposing its halt columns via proto at all (DB-only)** — meaning 030 could independently claim
these same field numbers at its own future `/sdd-spec` pass. This must be pre-assigned in
`merge-order.md` (new row, following the exact `merge-order.md:44` precedent) before either feature's
`/sdd-spec` locks in numbers — advisory-only enforcement (the same soft enforcement the 030/101
migration-number precedent already relies on), not mechanically guaranteed, but the established
convention on this platform.

`Order`'s field numbering is unaffected — no reconciliation-status field needed there or on `Position`;
the UI surface (below) reads recency/mismatch state via the ledger, not a new proto field.

### Ledger events and stream key

`emitLedgerEvent` (`trading.go:1426-1439`), stream key **`account:{account_id}`** — corrected from
product-spec's original ungrounded `reconciliation:{account}` guess to the codebase's real, existing
account-scoped stream-key convention (`account.positions.synced`/`account.balance.synced`,
`trading.go:898,914`). Event types: `reconciliation.mismatch_found` for every non-propagation-delay
finding (payload: `mismatch_class`, `order_id`/`symbol` if applicable, expected vs. broker values,
`tick_at`); `order_intent.resolved_by_reconciliation` / `order_intent.confirmed_lost` for FR-6.
`xstockstrat-notify.EmitAlert` is called via the same shape as `emitApprovalAlert`/`emitFillAlert`
(`trading.go:1441-~1470`) — no change needed to notify itself, product-spec's claim confirmed correct.

### FR-6 — resolving 101's `UNKNOWN` intents

Each tick, per account, query `trading.order_intents` (101's planned schema) for `state = Unknown`.
For each: **first check for an existing `order_intent.late_response_conflict` ledger event** (101's own
already-captured broker-response-arrived-late payload, cheaper and more precise than a fresh broker
round-trip since it captures the response that existed at reclaim time). Only if absent, fall back to
scanning the tick's `ListOrders` result by the intent's derived broker client-order-id
(`"xss-"+intentID`). **Resolution branches, spelled out precisely (round 3's fix)**:

- Broker confirms acceptance (found in a non-terminal-rejected state, or the ledger event shows
  success) → CAS `UPDATE order_intents SET state=Completed WHERE intent_id=$1 AND state=Unknown`.
- Broker confirms rejection → CAS to `Rejected`.
- **Genuinely inconclusive** (neither found in `ListOrders` nor a ledger event, no broker-side record
  either way) → **no write this tick** — a deliberate no-write branch, not a third resolved state,
  since writing an unconfirmed guess would violate FR-3's "never silently correct" discipline. Retried
  next tick.

This CAS is distinct from 101's own `finalizeIntentSQL` (which only fires from `Pending`) — 101's own
`design.md` explicitly defers this exact write-back to 102 ("until demoted feature 102's automated
reconciliation eventually lands"), so this is the anticipated third writer, not an unplanned one.

**Open Risk, named explicitly (not silently accepted)**: the "genuinely inconclusive, retry next tick"
branch has no cap — an order truly lost with no broker record and no ledger event could retry forever
with no terminal resolution. This is **not a live-capital risk** (the account is already halted via
030's mechanism on first detection and stays halted independent of retry outcome), but the operator
experience needs a distinguishing signal between "still checking" and "checked N times, a human must
intervene" — named for `/sdd-spec`, mirroring how 101 named its own accepted `late_response_conflict`
limitation rather than leaving it implicit.

**Open Risk**: `ListOrders`' bulk response shape may carry fewer fields than a single-order `GetOrder`
response (list endpoints commonly return a subset) — if insufficient to populate `first_response`/
`latest_response` adequately, FR-6's resolution path should call `GetOrder(brokerOrderID)` for the
specific matched order once identified via the bulk scan, rather than write a truncated payload.
Confirm against real Alpaca/IBKR response shapes at `/sdd-spec`.

### `xstockstrat-portfolio`'s `GetPosition` scoping gap — routed around, no fix needed

Both FR-1's position comparison and any exposure-direction check use `ListPositions(account_id)`
(confirmed to honor `account_id` correctly), never `GetPosition` (confirmed to silently drop
`account_id` today) — avoiding an unrelated portfolio bugfix as scope creep, consistent with "touch
only what the task requires."

### UI (Consumer Surface, AC-5)

"Last reconciled: Xs ago" + a mismatch marker on `/trader/positions`
(`src/app/trader/positions/page.tsx:107-125`), reusing `formatLastRun` (`src/lib/formatLastRun.ts:8-17`,
deliberately tick-free, already used for the Insights screener's "last run" label) and a
`CredentialStatusBadge`-style renders-nothing-when-healthy pattern. Reads via the existing
`LedgerService.QueryEvents` RPC (already exposed through the trader BFF's `queryEvents` handler),
filtered by `stream_key="account:{account_id}"` and the `reconciliation.`/`order_intent.` event-type
prefixes — **no proto change needed for the UI surface**, avoiding the field-numbering question there
entirely. **Per the amended AC-5**: the badge derives **one** coherent restriction display across
whichever mechanism is currently active — platform-wide `trading_state` (100, rare) checked first, else
per-account `halted`/`halt_reason`/`halt_source` (030 or 102, ordinary) — not multiple independent
badges an operator must reconcile by eye.

### Config keys

`trading.reconciliation.interval_ms` (float, default `60000`) — corrected to the `_ms` convention
`trading.fill_poller.interval_ms`/`trading.position_sync.interval_ms` actually use, not product-spec's
original `_seconds` guess. `trading.reconciliation.grace_ticks` (int, default `1`).

### Migrations

- `xstockstrat-trading`: new migration adding `halted`/`halted_at`/`halt_reason`/`halt_source` to
  `trading.broker_accounts` — this ALTER is shared ground with 030 (whose own design already plans the
  first three columns without the discriminator); exact number contested against 030's `005` and 101's
  `006` (both already pre-assigned in `merge-order.md:44`) — provisionally `007`, must be re-verified
  via `ls services/xstockstrat-trading/migrations/` at `/sdd-spec`/`/sdd-execute` per C-07, and a
  `merge-order.md` pre-assignment row added now (`030 → 005`, `101 → 006`, `102 → 007`, pending
  confirmation none of the three have landed yet).
- `xstockstrat-config`: new migration adding `caller_identity TEXT` to `config.config_values` and
  `config.config_audit`. Number contested against the next-available in that service's migrations
  directory — must be verified at `/sdd-spec`, not guessed from this design.

**Product-spec's Database Changes checkbox amended** (2026-08-06, already reflected in product-spec.md)
from "No schema changes" to "DB migration," with the DBA-review approval gate flipped from unchecked to
checked — the same correction pattern feature 100 already made for itself.

### Poller load (confirmed to shrink, not worsen)

Per tick, per account: 1 bulk `ListOrders` call (was O(open-orders) `GetOrder` calls in round 1), 1
`ListPositions` portfolio call (already-dialed client, no new plumbing), plus DB/ledger writes bounded
by mismatches actually found (typically 0). A 5th ticker on trading's 2-connection pool (`fill`,
`position-sync`, `credential-health`, 101's planned sweep, 102's reconciliation) remains a monitoring
note, like 101's own equivalent Open Risk, not a new blocker.

---

## Rejected Alternatives

- **A brand-new, parallel trading-local halt mechanism, avoiding both 030's and 100's infrastructure
  entirely** (round 1's original proposal) — rejected: doesn't satisfy FR-4's literal "via the rescoped
  100 kill switch" text at all, invents a third persisted-state axis when 030 already owns the exact
  same automated-per-account-circuit-breaker concern, and would need its own coordination-free migration
  that still collides with 030's/101's numbering.
- **Reusing `x-access-scope`'s user-role bitmap for a service self-assertion** (round 2's `SYSTEM_SCOPE`
  as an `ADMIN_SCOPE`-sibling bit) — rejected in round 3: breaks the platform's only-ever-forwarded,
  never-self-originated invariant for that specific header, and the per-(namespace,key) check (not
  per-caller-identity) meant any code path in trading's binary could construct it. Replaced with a
  structurally separate `x-internal-caller` channel plus a caller-identity allow-list.
  Cryptographic caller verification (mTLS/SPIFFE) was also considered and rejected as inconsistent with
  platform precedent (no service anywhere on this platform verifies caller identity cryptographically
  today) and disproportionate scope for this feature.
- **Escalating ALL ordinary per-account findings to 100's platform-wide gate** (a literal reading of
  the original FR-4 wording) — rejected via the user-approved AC-3/FR-4 amendment: conflates an
  account-specific finding with a platform-wide emergency, and would make every routine reconciliation
  finding (which should be common relative to genuinely systemic failures) trigger the highest-severity,
  authz-gated escalation path — disproportionate and operationally noisy.
- **Deferring platform-wide escalation entirely out of v1** (the user's non-chosen alternative at the
  round-2 gate) — a real, simpler option that was explicitly offered and explicitly not chosen; recorded
  here because it was a genuine fork, not silently dismissed.
- **Folding `caller_identity` into the existing free-text `author`/`reason` columns instead of a new
  structural column** — rejected: a convention-only distinction is exactly the shape `fails.md`
  2026-07-01 already logged as insufficient for incident review; a real column with a `WHERE
  caller_identity IS NOT NULL` filter is structurally guaranteed, not dependent on an investigator
  knowing the right string to grep for.
- **A single unbounded-authority internal-caller check (any value, not direction-restricted)** — rejected
  in round 3's final fix: would let a bug or a compromised internal caller silently un-halt the platform,
  the single most dangerous direction for this exact mechanism.

---

## Open Risks

_Carry each into `context.md` § Open Threads with a target step at `/sdd-spec` time._

1. **IBKR `ListOrders`' `accountId` scoping** — unverified against IBKR's real API docs whether an
   explicit `accountId` filter is supported on the bulk-orders endpoint; must be verified and tested
   (a negative test proving cross-account contamination doesn't occur) before this ships.
2. **Broker client-order-id JSON field name for IBKR's list response** — Alpaca's documented order
   schema includes `client_order_id`; IBKR's currently-parsed struct doesn't, and whether IBKR's real API
   returns one under a different key is unverified — blocks FR-6's IBKR scan path until confirmed.
3. **`ListOrders`' response-shape adequacy for `first_response`/`latest_response`** — may be thinner than
   a single-order `GetOrder` response; if so, FR-6 falls back to a per-matched-order `GetOrder` call —
   confirm against real response shapes at `/sdd-spec`.
4. **Negative test for the internal-caller direction restriction** — an internal-caller write of
   `ACTIVE` must be proven rejected before this ships; this is the single highest-stakes test in the
   feature.
5. **`caller_identity` write-path completeness** — the `INSERT`/`ON CONFLICT DO UPDATE SET` bound
   parameter addition in `configServiceImpl.ts` must actually land, not just the schema/trigger changes,
   or the audit-trail goal silently fails to materialize (round 3's own finding).
6. **`x-trace-id` on the new `trading → config` edge** — named for audit correlation given this call's
   blast radius, not designed in detail here.
7. **Unbounded "genuinely inconclusive" retry for a truly-lost order intent** — not a live-capital risk
   (account stays halted via 030 regardless), but needs an operator-facing "checked N times, human must
   intervene" signal distinct from "still checking," per `/sdd-spec`.
8. **`BrokerAccount` field 9-12 pre-assignment** — advisory-only enforcement (same soft mechanism as the
   030/101 migration-number precedent); a `merge-order.md` row must be added before either 030 or 102
   locks in a proto claim on this message.
9. **Migration numbers for both new migrations** (`xstockstrat-trading`'s ALTER, `xstockstrat-config`'s
   `caller_identity` addition) — provisional, must be re-verified via `ls migrations/` at `/sdd-spec`/
   `/sdd-execute` per C-07, not trusted from this design.
10. **`author="system:reconciliation-poller"` governance documentation** — must land in
    `docs/patterns/config-governance.md`'s new "Author-sentinel conventions" subsection in the same PR,
    per C-10(c), not as a bare code convention.
11. **3-way unimplemented-dependency fan-in** (100, 101, 030 all `design-approved`, none implemented) —
    this feature's design is planned against three planned contracts simultaneously, the largest fan-in
    of any feature in this program; if any of the three's real implementation diverges from its
    `design.md`, this design's split-halt/authz mechanism is the piece most likely to need rework.
12. **Feature 096/orders-view file overlap** — carried forward from 101's own equivalent note; 102's UI
    step touches `/trader/positions`, a different file from 101's `/trader/orders`, so likely no
    conflict, but confirm at `/sdd-spec`.

---

## Constitution Rules Touched

- **C-01** — every claim in this design was verified against real code or an external source (Alpaca's
  public API docs, `.do/app.yaml`/`docker-compose.yml`'s actual port exposure, `config_tables.up.sql`'s
  actual trigger function bodies) before being relied on; round 1's initially-false "no bulk order-list
  exists" premise was caught and corrected specifically because it was checked only against an internal
  abstraction, never the real external API.
- **C-04** — `HaltSource` uses a real proto enum with an `_UNSPECIFIED=0` sentinel, deliberately not
  deferred like 100's legacy-string-shaped `trading_state`, since this field has no legacy precedent
  forcing that trade-off.
- **C-05** — `trading.reconciliation.*` keys follow the `<service>.<category>.<key>` format; no new
  `xstockstrat-config`-side config key is introduced (the `caller_identity` addition is a schema/audit
  change, not a config key).
- **C-07** — every migration number in this design is stated as provisional and flagged for a
  `merge-order.md` pre-assignment plus a live `ls migrations/` re-check at `/sdd-spec`, not guessed and
  locked in here.
- **C-08** — no code changes shipped in this design phase; test requirements (the direction-restriction
  negative test, the IBKR account-scoping test) are named explicitly as Open Risks for `/sdd-spec` to
  turn into concrete test steps.
- **C-10(a)** — the halt-split avoids a second, parallel per-handler mechanism by reusing 030's existing
  axis rather than duplicating it.
- **C-10(b)** — FR-1's parity concern (orders vs. positions) is resolved by keeping the reconciliation
  status entirely in ledger events, not a proto field on either `Order` or `Position` — avoiding the
  exact "added to only one side" trap `fails.md` 2026-07-01 already logged, by not adding it to either.
- **C-10(c)** — the `"system:reconciliation-poller"` author sentinel is registered as a documented
  governance convention (Open Risk #10), not left as an undocumented ad hoc string, per the exact rule
  `fails.md` 2026-07-01 produced.
- **C-11** — this design followed the full recon → grilling pipeline; two genuine forks (the halt-split's
  AC-3/FR-4 wording amendment, and the SYSTEM_SCOPE implementation shape) were routed to the user via
  `AskUserQuestion` rather than silently resolved.
- **C-14** — the AC-3/FR-4 amendment is a recorded, user-approved override (context.md, 2026-08-06), not
  a silent scope reinterpretation.
- **P-01/P-02** — honored throughout; proposer and adversary subagents never exchanged raw output
  directly across all 3 rounds.
- **P-03** — every objection either resolved with a concrete fix or explicitly recorded as a named Open
  Risk with an owner-step; the two Commandment-level round-2 objections were escalated to the user
  rather than silently decided.
- **P-04** — every round's synthesis was presented via `AskUserQuestion` before proceeding.
- **F-11** — no `F-*` Floor breach was found or claimed at any point across all 3 rounds; the debate was
  driven by correctness/security-adjacent objections (P-03/C-01/C-11-class), and the adversary explicitly
  confirmed no Floor item in `docs/sdd/constitution.md` addresses authz self-assertion directly — a gap
  in the constitution's coverage, not proof the design is unsafe, and one this feature's own trust-model
  discussion should inform if that gap is ever closed by a future Constitution update.

---

## Rounds

**3 rounds, full mode** (within the standard 2-5 range — no extension needed, unlike 101). Round 1
found the proposed halt mechanism didn't actually use 100's kill switch at all, and that "no bulk
broker order-list exists" was an unverified claim checked only against the internal Go interface —
resolved by the orchestrator externally verifying both brokers' real REST APIs before round 2, and by
routing the halt-mechanism fork to the user (who directed "add a SYSTEM scope for this kind of
automated changes"). Round 2 built that mechanism but reused the wrong trust primitive
(`x-access-scope`'s user-role bitmap) and silently redefined AC-3/FR-4's wording without sign-off —
both routed back to the user, who approved a structurally separate internal-caller channel plus the
AC-3/FR-4 wording amendment. Round 3's final adversary pass found two concrete, mechanical gaps (the
missing write-direction restriction on the internal-caller escalation, and the `caller_identity`
column never actually wired into `setConfig`'s write path) and explicitly recommended folding both in
directly rather than requiring a 4th round — the orchestrator did so, consistent with 101's own
round-7 resolution pattern once no further genuine disagreement remained. Termination reason: round 3
verdict was NEEDS WORK, but both remaining objections were characterized as one/two-line, mechanical
additions to an already-approved mechanism, not reasons to reopen architecture.

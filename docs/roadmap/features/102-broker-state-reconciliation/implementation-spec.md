# Implementation Spec: broker-state-reconciliation

**Status**: `pending`
**Created**: 2026-08-06
**Feature**: `docs/roadmap/features/102-broker-state-reconciliation/feature.md`
**Total Steps**: 25
**Feature Branch**: `feature/broker-state-reconciliation`

---

## Execution Summary

This feature is the fifth and last in the `100 → 101 → 023 → 030 → 102` build order
(`docs/roadmap/features/merge-order.md`), and at spec time **all four upstream dependencies are
`implementation-ready` but have zero landed code** — confirmed by `recon.md`'s direct grep of
`main.go`/`trading.go`/`trading.proto` and re-confirmed here (no `StartOrderIntentSweeper`, no
`intent_state`, no `halted` column, no `platform.trading_state` reference anywhere in the current
tree). Every step below that depends on 100/101/030 code cites that feature's own
`implementation-spec.md` (a real, existing document) as the **planned** contract, explicitly flagged
"not yet landed — re-verify via grep immediately before this step executes" per the `082`/2026-07-30
ledger lesson ("implementation-spec citations go stale between spec-generation and execute").

Execution order: (1) the proto contract (`HaltSource` + `BrokerAccount` fields 9-12) and its codegen,
so every later Go/TS step compiles against real generated types; (2) `xstockstrat-config`'s
internal-caller authz channel and `caller_identity` audit column, built and tested standalone before
anything calls it; (3) the broker-client `ListOrders` addition (Alpaca + IBKR), tested standalone;
(4) the `config.Watcher` outbound `SetConfig` passthrough; (5) the halt-source plumbing that extends
030's planned `UpdateHaltStatus`/`haltAccount`; (6) the reconciliation poller itself (classification,
self-heal, ordinary per-account halt); (7) the systemic escalation path (calls into step 2's authz
channel); (8) FR-6's `UNKNOWN`-intent resolution (calls into step 3's `ListOrders` and 101's planned
`order_intents` schema); (9) docs; (10) the `/trader/positions` UI surface (Constitution **C-14**).

**Two genuine findings beyond `design.md`, surfaced here (Constitution P-03 — no silent guessing):**

1. **IBKR never sends a client/customer order tag on `SubmitOrder` today** — `broker.OrderRequest`
   has a `ClientOrderID` field (`internal/broker/broker.go:94-96`) and Alpaca's `SubmitOrder` forwards
   it (`alpaca.go:106,113`), but IBKR's `SubmitOrder` (`ibkr.go:116-156`) builds its request `body`
   map with no `ClientOrderID`/`cOID` key at all — confirmed by direct grep, zero hits for
   `client_order_id`/`ClientOrderID`/`cOID` anywhere in `ibkr.go`. This means `design.md`'s Open
   Risk #2 ("IBKR's list response may not carry a client-order-id under a known key") is actually
   deeper: even if the field name were known, IBKR never populates it, because the platform's own
   *request* never sends one. FR-6's broker-side `ListOrders`-scan-by-`client_order_id` fallback can
   therefore only ever match **Alpaca** orders. Step 21 states this explicitly and scopes IBKR's
   `UNKNOWN`-intent resolution to the `order_intent.late_response_conflict` ledger-event path only
   (no broker-side fallback) — extending IBKR's `SubmitOrder` to forward a customer tag is out of
   scope for this feature (a new, unplanned change to the order-placement hot path, not named in
   `design.md`) and is named as a follow-up, not silently absorbed.
2. **`LedgerService.QueryEvents.event_type` is a single exact-match filter, not a prefix filter**
   (`packages/proto/ledger/v1/ledger.proto:56`: `string event_type = 2; // optional filter`). The
   UI cannot ask the backend for "every `reconciliation.*`/`order_intent.*` event" in one filtered
   RPC call as `design.md`'s UI section implies; Step 24 fetches by `stream_key` alone (which the RPC
   does support as an exact filter) and filters the returned events client-side by event-type prefix,
   mirroring `usePositionLineage.ts`'s existing client-side-filter shape.

## Step Dependencies

- Step 2 requires Step 1 (proto-gen runs after the `.proto` edit).
- Steps 4-8 (xstockstrat-config authz + migration + write-path) have no dependency on Steps 1-2 or
  9-16 — they are the internal-caller channel Step 20's trading-side call consumes. Sequenced early
  so Step 20 has something real to call.
- Step 5 [test] covers Step 4. Step 8 [test] covers Steps 6-7.
- Steps 10-11 require Step 9 (the `Broker.ListOrders` interface method must exist before either
  client implements it). Step 12 [test] covers Steps 9-11.
- Step 14 [test] covers Step 13.
- Step 15 requires Step 1/2 (the `HaltSource` proto type) and **030's planned** `BrokerAccountRecord`/
  `AccountRepository.UpdateHaltStatus`/`haltAccount`/`flattenAndHalt` (`030-stop-loss-bracket-orders`
  implementation-spec.md Step 11, currently unimplemented — re-verify at execute time per the
  Execution Summary). Step 16 [test] covers Step 15.
- Step 18 requires Steps 3 (migration), 9-11 (`ListOrders`), and 15 (halt-source plumbing). Step 19
  [test] covers Step 18.
- Step 20 requires Step 13 (`Watcher.SetConfig` passthrough) and Steps 4-8 (the internal-caller
  channel it calls). Step 21 [test] covers Step 20.
- Step 22 requires Step 18 (the tick loop it hooks into), Step 11 (Alpaca's `ListOrders` for the
  broker-side scan fallback), and **101's planned** `trading.order_intents` schema/`IntentState`
  enum (`101-exactly-once-order-intent` implementation-spec.md Steps 1-3, currently unimplemented).
  Step 23 [test] covers Step 22.
- Step 24 (UI, Constitution **C-14**'s named `/trader` consumer surface) requires Step 18 (the ledger
  events it reads) and Step 15 (the `halted`/`halt_source` fields it reads via `ListBrokerAccounts`).
  Step 25 [test] covers Step 24.
- Step 26 [docs] is written last so it can cite the final field numbers/migration numbers actually
  used by Steps 1/3/6.

---

### Step 1 — proto: `HaltSource` enum + `BrokerAccount` fields 9-12

**Status**: `pending`
**Service**: `packages/proto`
**Files**:
- `packages/proto/trading/v1/trading.proto` — modify

**Reviewers**: Proto Reviewer — field number uniqueness, backward compatibility; `xstockstrat-trading`
owner — order execution correctness, broker API safety

**Codebase Evidence**:
- `CredentialStatus` enum + its `BrokerAccount` field precedent: `trading.proto:158-165` (enum,
  `_UNSPECIFIED=0` sentinel) and `:167-180` (`message BrokerAccount { ... credential_status = 7;
  credential_checked_at = 8; }`) — real committed highest field on `BrokerAccount` is
  `credential_checked_at = 8`, confirmed via direct read; fields **9-12 are genuinely next-available**.
- `design.md` § "`HaltSource` — real proto enum, not a deferred string" and § "Proto —
  `BrokerAccount` field claim (pre-assignment required)" — exact enum values and field
  numbers/types to add.
- `merge-order.md:47` records this exact field range as contested against `030` (which never claims
  a proto surface — its `implementation-spec.md` Step 2 is DB-only). This step is what resolves that
  contested row (see Step 26).

**TDD**: `N/A (proto — no code-bearing logic)`

**Instructions**:
1. In `packages/proto/trading/v1/trading.proto`, immediately after the `CredentialStatus` enum
   (ends `:165`) and before `message BrokerAccount {` (`:167`), add:
   ```proto
   // HaltSource distinguishes which automated mechanism halted an account — 030's
   // bracket-protection flatten failure vs. 102's broker-state-reconciliation mismatch — so an
   // operator (and the /trader UI) can tell which one fired without guessing from halt_reason's
   // free text alone.
   enum HaltSource {
     HALT_SOURCE_UNSPECIFIED = 0;
     HALT_SOURCE_BRACKET_PROTECTION = 1;  // 030
     HALT_SOURCE_RECONCILIATION = 2;       // 102
   }
   ```
2. Add four new fields to `message BrokerAccount` (after `credential_checked_at = 8;`, before the
   closing `}` at `:180`):
   ```proto
   // halted / halted_at / halt_reason / halt_source (feature 030 + 102): whether this account is
   // currently halted by an automated safety mechanism, when, why, and which mechanism. False/unset
   // means no automated halt is in effect; an operator may still have separately deactivated the
   // account (is_active).
   bool halted = 9;
   google.protobuf.Timestamp halted_at = 10;
   string halt_reason = 11;
   HaltSource halt_source = 12;
   ```
3. Do not touch `Order` or `Position` — `design.md` confirms no reconciliation-status field is
   needed on either (the UI surface reads via ledger events, not a proto field; see Step 24).

**Verification**:
```bash
cd packages/proto && buf lint
buf breaking --against ".git#branch=main-dev"
grep -n "HaltSource\|halted\|halt_reason\|halt_source" trading/v1/trading.proto
# Confirm fields 9-12 land on BrokerAccount only, HaltSource has a _UNSPECIFIED=0 sentinel (C-04),
# and buf breaking passes (pure additions, no renumbering).
```

---

### Step 2 — proto-gen: regenerate stubs

**Status**: `pending`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/go/trading/v1/` — regenerate (do not hand-edit)
- `packages/proto/gen/python/trading/v1/` — regenerate (do not hand-edit)
- `packages/proto/gen/ts/trading/v1/` — regenerate (do not hand-edit)

**Reviewers**: Proto Reviewer — inherited from Step 1

**Codebase Evidence**:
- Root `CLAUDE.md` § Generating Proto Stubs: `./scripts/buf-gen.sh` generates TS/Python/Go stubs and
  compiles the TS package.

**TDD**: `N/A (proto-gen — generated code)`

**Instructions**:
1. Run `./scripts/buf-gen.sh` from repo root.
2. Confirm the diff touches only `packages/proto/gen/**` and no hand-written file.

**Verification**:
```bash
./scripts/buf-gen.sh
git status --porcelain packages/proto/gen/ | grep -q . && echo "stubs regenerated" || echo "NO DIFF — investigate"
GOWORK=off go build ./... # from packages/proto/gen/go — confirm HaltSource/new fields compile
```

---

### Step 3 — migration: `xstockstrat-trading` `halt_source` column

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/migrations/007_broker_accounts_halt_source.up.sql` — create
- `services/xstockstrat-trading/migrations/007_broker_accounts_halt_source.down.sql` — create

**Reviewers**: DBA — migration NNN numbering, up+down pair present; `xstockstrat-trading` owner

**Codebase Evidence**:
- Current last migration on disk: `004_broker_accounts_credential_status.up.sql` (confirmed via
  `ls services/xstockstrat-trading/migrations/`).
- `merge-order.md:44` pre-assigns `030 → 005_broker_accounts_halted`, `101 → 006_order_intents`,
  `102 → 007_broker_accounts_halt_source` — this step claims `007`. **Both `005` and `006` are
  planned, not yet landed** (`030`/`101` implementation-spec.md, both `implementation-ready`) — per
  **C-07**, re-run `ls services/xstockstrat-trading/migrations/` immediately before this step
  executes to confirm `006` is still the last file on disk and `007` is still free; if the build
  order was not followed and `005`/`006` are absent, this step cannot proceed (block and escalate,
  per **P-03** — do not renumber around a missing dependency).
- `030-stop-loss-bracket-orders` implementation-spec.md:101-112 — `005_broker_accounts_halted.up.sql`
  plans `ALTER TABLE trading.broker_accounts ADD COLUMN IF NOT EXISTS halted BOOLEAN NOT NULL DEFAULT
  FALSE, ADD COLUMN IF NOT EXISTS halted_at TIMESTAMPTZ, ADD COLUMN IF NOT EXISTS halt_reason TEXT;`
  — this step's `ALTER` extends the same table with the fourth column.
- `004_broker_accounts_credential_status.up.sql` (existing, landed) is the closest real precedent for
  an `ALTER TABLE trading.broker_accounts ADD COLUMN` shape on this exact table.

**TDD**: `N/A (migration)`

**Instructions**:
1. Create `007_broker_accounts_halt_source.up.sql`:
   ```sql
   -- Migration: 007_broker_accounts_halt_source.sql
   -- Service: xstockstrat-trading
   -- Feature 102 (broker-state-reconciliation): adds the halt_source discriminator on top of
   -- feature 030's halted/halted_at/halt_reason columns (005_broker_accounts_halted.up.sql), so an
   -- operator can tell which automated mechanism (030's bracket-protection flatten failure, or
   -- 102's reconciliation mismatch) triggered a given halt. Maps to the HaltSource proto enum:
   -- 0=UNSPECIFIED, 1=BRACKET_PROTECTION, 2=RECONCILIATION.
   ALTER TABLE trading.broker_accounts
       ADD COLUMN IF NOT EXISTS halt_source SMALLINT NOT NULL DEFAULT 0;
   ```
2. Create `007_broker_accounts_halt_source.down.sql`:
   ```sql
   ALTER TABLE trading.broker_accounts
       DROP COLUMN IF EXISTS halt_source;
   ```

**Verification**:
```bash
ls services/xstockstrat-trading/migrations/007_broker_accounts_halt_source.up.sql \
   services/xstockstrat-trading/migrations/007_broker_accounts_halt_source.down.sql
```
Read both files: confirm the `.down.sql` drops exactly the column the `.up.sql` adds. Do not start a
database or run `migrate` (offline check per `reference/spec-template.md`).

---

### Step 4 — service: `xstockstrat-config` internal-caller authz channel

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/grpc/authz.ts` — modify

**Reviewers**: `xstockstrat-config` owner — config key naming, WatchConfig stream stability;
Security — no secrets in config service state, auth scope correctness

**Codebase Evidence**:
- Full current file read: `authz.ts:1-60` — `ADMIN_SCOPE = 0x04`, `HEADER_ACCESS_SCOPE`,
  `hasAdminAccessScope(md)`, `first(md, key)` helper, `ADMIN_SCOPE_ERROR` (all confirmed real, exact
  shapes to mirror).
- `design.md` § "Internal-caller authz for `platform.trading_state`" gives the exact code to add:
  `HEADER_INTERNAL_CALLER`, `INTERNAL_CALLER_ALLOWLIST` (with the round-3 direction-restriction fix —
  `allowedTargetValues` never includes `'ACTIVE'`), `hasInternalCallerAuthority`.
- **insights.md 2026-08-06** ("broker-state-reconciliation — design"): this must be a *structurally
  separate* metadata channel, never an extension of `x-access-scope`'s human-role bitmap — the
  ledger entry this feature itself produced.

**TDD**: `red-green required`

**Instructions**:
1. In `services/xstockstrat-config/src/grpc/authz.ts`, after `ADMIN_SCOPE_ERROR` (ends `:52`), add:
   ```ts
   /**
    * Internal-caller channel for a background/automated process to write a normally
    * human-operator-gated key without extending x-access-scope's user-role bitmap (which only ever
    * carries a value *forwarded* from a real authenticated human — see docs/patterns/
    * header-propagation.md). Structurally separate: a distinct metadata field, a hardcoded
    * {callerID, namespace, key, allowedTargetValues} allow-list, and — critically — a
    * direction restriction so a caller can only ever move a value *toward* restriction, never
    * back toward an unrestricted state (feature 102).
    */
   export const HEADER_INTERNAL_CALLER = 'x-internal-caller';

   interface InternalCallerGrant {
     callerID: string;
     namespace: string;
     key: string;
     /** The only values this caller may write to (namespace, key) — never the unrestricted value. */
     allowedTargetValues: ReadonlyArray<string>;
   }

   const INTERNAL_CALLER_ALLOWLIST: ReadonlyArray<InternalCallerGrant> = [
     {
       callerID: 'trading-reconciliation-poller',
       namespace: 'platform',
       key: 'trading_state',
       allowedTargetValues: ['REDUCE_ONLY', 'HALTED'], // never 'ACTIVE' — escalation only
     },
   ];

   /**
    * True when the propagated internal-caller identity is allow-listed to write targetValue at
    * (namespace, key). Fails closed: an absent header, an unlisted callerID, or a targetValue
    * outside that caller's allowed set all return false.
    */
   export function hasInternalCallerAuthority(
     md: Metadata | undefined,
     namespace: string,
     key: string,
     targetValue: string,
   ): boolean {
     const callerID = first(md, HEADER_INTERNAL_CALLER);
     if (!callerID) return false;
     return INTERNAL_CALLER_ALLOWLIST.some(
       (grant) =>
         grant.callerID === callerID &&
         grant.namespace === namespace &&
         grant.key === key &&
         grant.allowedTargetValues.includes(targetValue),
     );
   }
   ```
2. Do not modify `hasAdminAccessScope`, `ADMIN_SCOPE`, or `ADMIN_SCOPE_ERROR` — additive only, per
   `design.md`: "Additive, not a replacement — humans via config-ui are unaffected."

**Verification**:
```bash
cd services/xstockstrat-config && pnpm run lint
grep -n "HEADER_INTERNAL_CALLER\|hasInternalCallerAuthority\|INTERNAL_CALLER_ALLOWLIST" src/grpc/authz.ts
```

---

### Step 5 — test: internal-caller authz unit tests (direction-restriction negative test)

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/__tests__/internalCallerAuthz.test.ts` — create

**Reviewers**: `xstockstrat-config` owner; Security — auth scope correctness

**Codebase Evidence**:
- `design.md` Open Risk #4: "a negative test asserting an internal-caller write of `ACTIVE` is
  rejected must exist before this ships" — named explicitly as "the single highest-stakes test in
  the feature."
- Existing Node test-file style precedent in this service: `src/__tests__/setConfigAuthz.test.ts`
  (plain `node:test`/`node:assert` unit style — confirmed real via the earlier `100`
  implementation-spec citation of this same file).

**TDD**: `red-green required` (paired with Step 4 — fails against the pre-Step-4 tree since
`hasInternalCallerAuthority` does not exist yet)

**Instructions**:
Create `services/xstockstrat-config/src/__tests__/internalCallerAuthz.test.ts` importing
`hasInternalCallerAuthority`/`HEADER_INTERNAL_CALLER` from `../grpc/authz.js` (this repo's Node ESM
convention — confirm the exact relative import extension against a sibling test file in the same
directory before writing). Build a minimal `Metadata`-like fake carrying `.get(key)` returning
`[value]` or `[]` (mirror whatever fake `setConfigAuthz.test.ts` already uses for `Metadata`, per
C-13's "reuse the canonical fixture home" rule — a single-consumer inline fake is compliant if none
exists to reuse). Cases:
1. `hasInternalCallerAuthority(mdWith('trading-reconciliation-poller'), 'platform', 'trading_state',
   'HALTED')` → `true`.
2. Same caller, `targetValue: 'REDUCE_ONLY'` → `true`.
3. **`hasInternalCallerAuthority(mdWith('trading-reconciliation-poller'), 'platform', 'trading_state',
   'ACTIVE')` → `false`** — the direction-restriction test named in Open Risk #4.
4. `hasInternalCallerAuthority(mdWith('some-other-caller'), 'platform', 'trading_state', 'HALTED')` →
   `false` — an unlisted caller ID is rejected even for an otherwise-allowed value.
5. `hasInternalCallerAuthority(mdWith('trading-reconciliation-poller'), 'platform', 'log_level',
   'HALTED')` → `false` — the allow-list is scoped to `(namespace,key)`, not just `callerID`.
6. `hasInternalCallerAuthority(undefined, 'platform', 'trading_state', 'HALTED')` → `false` — absent
   metadata fails closed.

**Verification**:
```bash
cd services/xstockstrat-config && pnpm run lint && pnpm run test:coverage
# Confirm all 6 cases pass and the service's 40% coverage threshold still passes overall.
```

---

### Step 6 — migration: `xstockstrat-config` `caller_identity` audit column

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/migrations/013_config_caller_identity.up.sql` — create
- `services/xstockstrat-config/migrations/013_config_caller_identity.down.sql` — create

**Reviewers**: DBA; `xstockstrat-config` owner

**Codebase Evidence**:
- Current last migration on disk: `010_config_audit_insert_trigger.up.sql` (confirmed via
  `ls services/xstockstrat-config/migrations/`).
- **insights.md 2026-08-06** (100-account-trading-halt-and-kill-switch) confirms `100` claims
  `011_platform_trading_state`, and `023` was renumbered to `012_trading_risk_sizing` in the same
  migrations directory (both `implementation-ready`, unimplemented). This step claims **`013`** as
  the next number after both. Per **C-07**, re-run `ls services/xstockstrat-config/migrations/`
  immediately before this step executes — if `100`'s `011` and `023`'s `012` are not both present on
  disk yet, the build order (`100 → 101 → 023 → 030 → 102`) was not followed; block and escalate
  rather than silently renumbering.
- `config.config_values`'s live schema: `001_config_tables.up.sql:6-21` (base table, no
  `environment`/`trading_mode` yet) evolved by `002_config_environment.up.sql:5-13` (adds
  `environment`/`trading_mode` columns) — this step's `ALTER` targets the table as it exists **after**
  `002`, i.e. the real current live shape.
- `config.config_audit`'s live schema: `001_config_tables.up.sql:26-35` evolved by
  `002_config_environment.up.sql:26-28` (adds `environment`/`trading_mode`).
- The **live** `audit_config_change()` function is `002_config_environment.up.sql:29-37`'s
  `CREATE OR REPLACE` (it superseded `001`'s original definition of the same function name) — this
  step's `CREATE OR REPLACE` must be written against `002`'s version, not `001`'s stale one.
- `audit_config_insert()` (the `AFTER INSERT` trigger, feature 091): full read of
  `010_config_audit_insert_trigger.up.sql` — `INSERT INTO config.config_audit (namespace, key,
  old_value, new_value, changed_by, reason, environment, trading_mode) VALUES (...)`.
- `design.md` § "Round 3's second final fix" — both trigger functions build their `INSERT` from an
  **explicit named column list**, confirmed by direct read (no `NEW.*`/`SELECT *` passthrough in
  either), so both genuinely need editing (not an automatic propagation).

**TDD**: `N/A (migration)`

**Instructions**:
1. Create `013_config_caller_identity.up.sql`:
   ```sql
   -- Migration: 013_config_caller_identity.sql
   -- Service: xstockstrat-config
   -- Feature 102 (broker-state-reconciliation): a free-text author/reason alone can't distinguish
   -- "an operator clicked Save" from "the reconciliation poller escalated" for incident review
   -- (fails.md 2026-07-01) — a structural column an investigator can WHERE-filter on, not one they
   -- must know to grep for. Populated only for an internal-caller SetConfig write
   -- (x-internal-caller metadata); NULL for every ordinary human/admin write.
   ALTER TABLE config.config_values
       ADD COLUMN IF NOT EXISTS caller_identity TEXT;

   ALTER TABLE config.config_audit
       ADD COLUMN IF NOT EXISTS caller_identity TEXT;

   -- Re-define both trigger functions (matching their real current definitions —
   -- audit_config_change from 002_config_environment.up.sql:29-37, audit_config_insert from
   -- 010_config_audit_insert_trigger.up.sql) to copy the new column through their existing named
   -- column lists.
   CREATE OR REPLACE FUNCTION config.audit_config_change()
   RETURNS trigger LANGUAGE plpgsql AS $$
   BEGIN
       IF OLD.value_data IS DISTINCT FROM NEW.value_data THEN
           INSERT INTO config.config_audit
               (namespace, key, old_value, new_value, changed_by, reason, environment, trading_mode, caller_identity)
           VALUES
               (NEW.namespace, NEW.key, OLD.value_data, NEW.value_data, NEW.updated_by, NEW.update_reason,
                NEW.environment, NEW.trading_mode, NEW.caller_identity);
       END IF;
       NEW.updated_at = NOW();
       RETURN NEW;
   END;
   $$;

   CREATE OR REPLACE FUNCTION config.audit_config_insert()
   RETURNS trigger LANGUAGE plpgsql AS $$
   BEGIN
       INSERT INTO config.config_audit
           (namespace, key, old_value, new_value, changed_by, reason, environment, trading_mode, caller_identity)
       VALUES
           (NEW.namespace, NEW.key, NULL, NEW.value_data, NEW.updated_by, NEW.update_reason,
            NEW.environment, NEW.trading_mode, NEW.caller_identity);
       RETURN NEW;
   END;
   $$;
   ```
2. Create `013_config_caller_identity.down.sql`:
   ```sql
   CREATE OR REPLACE FUNCTION config.audit_config_change()
   RETURNS trigger LANGUAGE plpgsql AS $$
   BEGIN
       IF OLD.value_data IS DISTINCT FROM NEW.value_data THEN
           INSERT INTO config.config_audit (namespace, key, old_value, new_value, changed_by, reason, environment, trading_mode)
           VALUES (NEW.namespace, NEW.key, OLD.value_data, NEW.value_data, NEW.updated_by, NEW.update_reason, NEW.environment, NEW.trading_mode);
       END IF;
       NEW.updated_at = NOW();
       RETURN NEW;
   END;
   $$;

   CREATE OR REPLACE FUNCTION config.audit_config_insert()
   RETURNS trigger LANGUAGE plpgsql AS $$
   BEGIN
       INSERT INTO config.config_audit (namespace, key, old_value, new_value, changed_by, reason, environment, trading_mode)
       VALUES (NEW.namespace, NEW.key, NULL, NEW.value_data, NEW.updated_by, NEW.update_reason, NEW.environment, NEW.trading_mode);
       RETURN NEW;
   END;
   $$;

   ALTER TABLE config.config_audit DROP COLUMN IF EXISTS caller_identity;
   ALTER TABLE config.config_values DROP COLUMN IF EXISTS caller_identity;
   ```

**Verification**:
```bash
ls services/xstockstrat-config/migrations/013_config_caller_identity.up.sql \
   services/xstockstrat-config/migrations/013_config_caller_identity.down.sql
```
Read both files: confirm the `.down.sql` restores both trigger functions to their pre-`013` bodies
(matching `002_config_environment.up.sql`'s and `010_config_audit_insert_trigger.up.sql`'s real text)
and drops both new columns. Offline check only — no live database.

---

### Step 7 — service: wire internal-caller authz + `caller_identity` into `setConfig`

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/grpc/configServiceImpl.ts` — modify

**Reviewers**: `xstockstrat-config` owner; Security

**Codebase Evidence**:
- Full current `setConfig` read: `configServiceImpl.ts:286-353` — admin gate (`:293-300`) →
  destructure `{ namespace, key, value, reason }` (`:302`) → author resolution (`:306-313`) →
  existence gate (`:315-335`) → `INSERT ... ON CONFLICT ... DO UPDATE` (`:337-347`). **These exact
  line numbers are pre-Step-100/Step-102 state** — `100`'s own implementation-spec.md Step 3 plans to
  insert a `platform.trading_state` literal-validation block "after the author-resolution block （ends
  `:313`) and before the existence-gate SELECT (starts `:315`)", which will shift every line number
  below by roughly 18 lines once `100` lands. Re-grep this file's real current line numbers
  immediately before this step executes (per the Execution Summary's re-verify note) rather than
  trusting the citations here verbatim.
- The admin-gate replacement shape (`design.md` § "Internal-caller authz..."):
  ```ts
  const internalCaller = first(call.metadata, HEADER_INTERNAL_CALLER);
  const authorized =
    hasAdminAccessScope(call.metadata) ||
    (internalCaller && hasInternalCallerAuthority(call.metadata, call.request.namespace, call.request.key, /* target value */ raw));
  if (!authorized) { callback(ADMIN_SCOPE_ERROR); return; }
  ```
  Note this repo's real `hasAdminAccessScope`/`ADMIN_SCOPE_ERROR` import already exists at the top of
  `configServiceImpl.ts` (confirmed via the Step-4 evidence above); `hasInternalCallerAuthority`/
  `HEADER_INTERNAL_CALLER` need a new import from `./authz.js` alongside them.
- **Critical completeness fix named explicitly in `design.md`**: the `INSERT`/`ON CONFLICT DO UPDATE
  SET` statement (`:337-347`) must bind a `caller_identity` parameter in **both** the column list and
  the `SET` clause — `platform.trading_state` is pre-seeded by `100`'s migration, so every runtime
  `SetConfig` call against it takes the `DO UPDATE` branch, and an omission here leaves the column
  `NULL` forever regardless of Step 6's schema/trigger work (the exact `fails.md` 2026-08-06 entry
  this feature itself produced).
- `author` resolution precedent (`:311-313`, current) already distinguishes an explicit author from
  the propagated caller id — the internal-caller path uses the documented sentinel
  `"system:reconciliation-poller"` as its `SetConfigRequest.author`, per Step 26's governance doc.

**TDD**: `red-green required`

**Instructions**:
1. Import `HEADER_INTERNAL_CALLER, hasInternalCallerAuthority` alongside the existing
   `hasAdminAccessScope, ADMIN_SCOPE_ERROR` import from `./authz.js`.
2. Re-locate the real current admin-gate block (may have shifted per the Codebase Evidence's Step-100
   note) and extend the authorization check:
   ```ts
   const rawValue = call.request?.value?.string_val ?? call.request?.value?.stringVal ?? '';
   const internalCallerAuthorized = hasInternalCallerAuthority(
     call.metadata, call.request?.namespace, call.request?.key, rawValue,
   );
   if (!hasAdminAccessScope(call.metadata) && !internalCallerAuthorized) {
     log.warn('SetConfig denied — caller lacks admin scope and internal-caller authority', {
       namespace: call.request?.namespace,
       key: call.request?.key,
     });
     callback(ADMIN_SCOPE_ERROR);
     return;
   }
   ```
   Placed at the exact position the existing single-check `if (!hasAdminAccessScope(...))` block
   occupies today — first, before any destructure or DB work (preserving the file's own documented
   invariant, see the comment immediately above the current admin gate).
3. Resolve a `callerIdentity` value: `const callerIdentity = first(call.metadata, HEADER_INTERNAL_CALLER) || null;`
   (empty string → `NULL`, matching Step 6's `TEXT` column with no `NOT NULL` constraint).
4. Add `callerIdentity` as a new bound parameter to the existing `INSERT` statement's column list
   **and** its `ON CONFLICT DO UPDATE SET` clause:
   ```ts
   await this.pool.query(
     `INSERT INTO config.config_values (namespace, key, value_type, value_data, updated_by, update_reason, environment, trading_mode, caller_identity)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (namespace, key, environment, trading_mode) DO UPDATE
        SET value_data = EXCLUDED.value_data,
            updated_by = EXCLUDED.updated_by,
            update_reason = EXCLUDED.update_reason,
            caller_identity = EXCLUDED.caller_identity,
            updated_at = NOW()`,
     [namespace, key, inferValueType(value), extractValueData(value), author, reason, env, mode, callerIdentity]
   );
   ```
   This is the exact write path `design.md`'s round-3 adversary found missing — do not stop at the
   schema/trigger work from Step 6.
5. Do not modify the existence-gate `SELECT` or `createKey` logic — orthogonal to this change.

**Verification**:
```bash
cd services/xstockstrat-config && pnpm run lint
grep -n "HEADER_INTERNAL_CALLER\|hasInternalCallerAuthority\|caller_identity\|callerIdentity" src/grpc/configServiceImpl.ts
# Confirm: (a) the authorization check now accepts an admin OR an internal-caller-authorized write;
# (b) callerIdentity is bound in both the INSERT column list and the ON CONFLICT SET clause.
```

---

### Step 8 — test: internal-caller `SetConfig` loopback (accept/reject + `caller_identity` persisted)

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/__tests__/internalCallerSetConfig.test.ts` — create

**Reviewers**: `xstockstrat-config` owner; Security

**Codebase Evidence**:
- Loopback gRPC harness template: `setConfigAuthz.test.ts:76-230` (`grpc.Server` +
  `createConfigServiceDefinition()` + `ConfigServiceImpl` + a recording pool stub) — the established
  no-real-database pattern for testing `setConfig` end-to-end, per `100`'s own Step 4 citation of the
  same file.
- **`design.md` Open Risk #4** (again): "a negative test asserting an internal-caller write of
  `ACTIVE` is rejected must exist before this ships" — this is the *end-to-end* (RPC-level) instance
  of the unit-level test Step 5 already wrote; both are required (Step 5 tests the pure function,
  this step tests it wired into the real RPC handler).

**TDD**: `red-green required` (paired with Step 7 — fails against the pre-Step-7 tree)

**Instructions**:
Create `internalCallerSetConfig.test.ts` following `setConfigAuthz.test.ts`'s exact loopback harness
(same recording-pool stub returning a row for the existence-`SELECT` so the write reaches the
`INSERT`). Cases, all against `namespace: 'platform', key: 'trading_state'` with **no**
`x-access-scope` admin bit set (proving the internal-caller path is genuinely independent of admin
scope, not a fallback that still needs it):
1. Metadata `x-internal-caller: trading-reconciliation-poller`, value `REDUCE_ONLY` → `err === null`;
   assert the recorded `INSERT` params include `caller_identity = 'trading-reconciliation-poller'`.
2. Same caller, value `HALTED` → succeeds.
3. **Same caller, value `ACTIVE`** → `err.code === grpc.status.PERMISSION_DENIED`, **and** assert zero
   `INSERT` ran (mirrors `setConfigAuthz.test.ts`'s zero-INSERT assertion pattern) — proves the
   direction restriction blocks the write before any DB call, not just that the RPC returns an error.
4. Metadata `x-internal-caller: some-unlisted-caller`, value `HALTED` → `PERMISSION_DENIED`, zero
   `INSERT`.
5. No `x-internal-caller` metadata and no admin scope, value `HALTED` → `PERMISSION_DENIED` (the
   pre-existing admin-gate behavior, unaffected).
6. An ordinary **admin**-scoped write (existing `ADMIN_SCOPE` bit, no `x-internal-caller` header) to a
   different key (e.g. `platform.log_level`) → succeeds, and assert the recorded `INSERT` params show
   `caller_identity = null` — proves a normal human write leaves the new column unset, not populated
   with a stale/wrong value.

**Verification**:
```bash
cd services/xstockstrat-config && pnpm run lint && pnpm run test:coverage
# Confirm all 6 cases pass and the 40% coverage threshold still passes overall.
```

---

### Step 9 — service: `Broker.ListOrders` interface + `BrokerOrder.ClientOrderID`

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/broker/broker.go` — modify

**Reviewers**: `xstockstrat-trading` owner — order execution correctness, broker API safety

**Codebase Evidence**:
- Full current `Broker` interface read: `broker.go:57-76` (`SubmitOrder`, `CancelOrder`,
  `ReplaceOrder`, `GetOrder`, `GetPositions`, `GetAccount`, `IsPaper`, `ValidateCredentials` — no
  bulk order-list method today, confirmed).
- Full current `BrokerOrder` struct read: `broker.go:16-21` (`BrokerOrderID, Status, FilledQty,
  FilledAvgPrice` — no `ClientOrderID` field today).
- `design.md` § "Broker-side bulk order listing" — externally verified both Alpaca (`GET /v2/orders`)
  and IBKR (`GET /iserver/account/orders`, already the endpoint `ibkr.go:254-286`'s `GetOrder` calls
  and filters to one match) support bulk listing. `Broker.ListOrders(ctx) ([]BrokerOrder, error)` is
  the interface addition.
- **This step's own finding** (Execution Summary #1): IBKR's `SubmitOrder` (`ibkr.go:116-156`) never
  sends a client-order tag — `ClientOrderID` on `BrokerOrder` will only ever be populated for Alpaca
  results (Step 11 leaves it empty for IBKR, not fabricated).

**TDD**: `red-green required`

**Instructions**:
1. In `BrokerOrder` (`broker.go:16-21`), add a new field:
   ```go
   // ClientOrderID is the broker's echo of the client-supplied order nonce, when the broker
   // supports/returns one. Populated for Alpaca (its API always echoes client_order_id); left empty
   // for IBKR, which is never sent a customer-order tag on submission (feature 102 — see
   // implementation-spec.md's Execution Summary for the confirmed gap).
   ClientOrderID string
   ```
2. In the `Broker` interface (`broker.go:57-76`), add after `GetOrder`:
   ```go
   // ListOrders returns every order currently known to the broker for this account (feature 102 —
   // broker-state-reconciliation). Unlike GetOrder, this is a single bulk call, not a per-order
   // fetch — it is the detection primitive that makes "an order placed directly through the
   // broker's own dashboard" detectable within one reconciliation tick regardless of fill state.
   ListOrders(ctx context.Context) ([]BrokerOrder, error)
   ```

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off go build ./... 2>&1 | grep -i "does not implement" || echo "compiles (or Alpaca/IBKR not yet updated — expected until Steps 10-11 land)"
grep -n "ListOrders\|ClientOrderID" internal/broker/broker.go
```

---

### Step 10 — service: Alpaca `ListOrders`

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/broker/alpaca.go` — modify

**Reviewers**: `xstockstrat-trading` owner

**Codebase Evidence**:
- Direct template: `GetOrder` (`alpaca.go:267-305`) — `http.NewRequestWithContext` → `c.setAuthHeaders`
  → `c.httpClient.Do` → read body → `json.Unmarshal(respBody, &alpacaResp)` into the existing
  `AlpacaOrder` struct (`alpaca.go:76-91`, already has `ClientOrderID string
  \`json:"client_order_id"\`` — no new struct needed, reuse verbatim).
- `design.md`: `GET /v2/orders`, defaulting to open orders, with `status`/`limit`/`symbols` filters.

**TDD**: `red-green required`

**Instructions**:
1. Add, near `GetOrder` (after it, before `GetPositions` at `alpaca.go:308`):
   ```go
   // ListOrders fetches every order currently known to Alpaca for this account via
   // GET /v2/orders (feature 102). status=all so a just-filled or just-canceled order (which
   // dropped out of the default open-only view) is still detectable within one reconciliation
   // tick; limit=500 matches this platform's other bulk-list pagination ceiling
   // (marketdata's GetBars default page size).
   func (c *Client) ListOrders(ctx context.Context) ([]BrokerOrder, error) {
       endpoint := fmt.Sprintf("%s/v2/orders?status=all&limit=500", c.baseURL())
       httpReq, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
       if err != nil {
           return nil, fmt.Errorf("create request: %w", err)
       }
       c.setAuthHeaders(httpReq)

       resp, err := c.httpClient.Do(httpReq)
       if err != nil {
           return nil, fmt.Errorf("list orders: %w", err)
       }
       defer resp.Body.Close() //nolint:errcheck

       respBody, err := io.ReadAll(resp.Body)
       if err != nil {
           return nil, fmt.Errorf("read response: %w", err)
       }
       if resp.StatusCode != http.StatusOK {
           return nil, fmt.Errorf("alpaca list orders error (status %d): %s", resp.StatusCode, string(respBody))
       }

       var alpacaOrders []AlpacaOrder
       if err := json.Unmarshal(respBody, &alpacaOrders); err != nil {
           return nil, fmt.Errorf("decode list orders response: %w", err)
       }
       orders := make([]BrokerOrder, 0, len(alpacaOrders))
       for _, o := range alpacaOrders {
           var filledAvgPrice float64
           if o.FilledAvgPrice != "" {
               filledAvgPrice, _ = strconv.ParseFloat(o.FilledAvgPrice, 64)
           }
           var filledQty float64
           if o.FilledQty != "" {
               filledQty, _ = strconv.ParseFloat(o.FilledQty, 64)
           }
           orders = append(orders, BrokerOrder{
               BrokerOrderID: o.ID, ClientOrderID: o.ClientOrderID, Status: o.Status,
               FilledQty: filledQty, FilledAvgPrice: filledAvgPrice,
           })
       }
       return orders, nil
   }
   ```
2. No new imports — `fmt`, `http`, `io`, `json`, `strconv` are all already imported in this file
   (used by `GetOrder`/`SubmitOrder`).

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off golangci-lint run --modules-download-mode=mod ./internal/broker/...
GOWORK=off go build ./...
```

---

### Step 11 — service: IBKR `ListOrders` (account-scoped)

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/broker/ibkr.go` — modify

**Reviewers**: `xstockstrat-trading` owner

**Codebase Evidence**:
- Direct template: `GetOrder` (`ibkr.go:254-286`) — calls `GET {baseURL}/iserver/account/orders`
  (**no `accountId` param today**), parses `{"orders": [{orderId, status, avgPrice,
  filledQuantity}]}`, then filters to the single entry matching the `orderId` query param it set.
  `ListOrders` drops that `orderId` filter/query-param and returns the full array.
- `design.md` § "Broker-side bulk order listing": "IBKR's call must additionally pass an explicit
  `accountId=c.ibkrAccountID` query param — `GetOrder` today relies on `orderId` alone to implicitly
  scope its result, and a bulk call with no `orderId` has nothing else scoping it under a Client
  Portal session that can span multiple sub-accounts." **Open Risk (design.md #1, carried forward
  unresolved)**: whether IBKR's real API actually supports an `accountId` filter on this endpoint is
  unverified in this repo — Step 12's negative test proves the *code* passes the param; it cannot
  prove the *broker* honors it without a real IBKR sandbox call, which is out of scope for an offline
  spec/test. Flag this explicitly in the PR description, do not claim it as proven.
- `c.ibkrAccountID` field: used identically by `GetPositions` (`ibkr.go` — `fmt.Sprintf("%s/portfolio/%s/positions/0", c.baseURL, c.ibkrAccountID)`), confirming the field name/access pattern.
- IBKR's response struct has no client-order-id field today (confirmed by direct read of the
  anonymous `result.Orders` struct in `GetOrder`, `ibkr.go:275-280`) — and per this step's own
  Execution Summary finding, IBKR's `SubmitOrder` never sends one in the first place, so there is
  nothing to parse even if the field name were known. `ListOrders` leaves `ClientOrderID` as its
  zero value (`""`) for every IBKR result — do not guess a field name.

**TDD**: `red-green required`

**Instructions**:
1. Add, near `GetOrder` (after it, before `GetPositions`):
   ```go
   // ListOrders fetches every order currently known to IBKR for this account via
   // GET /iserver/account/orders?accountId={id} (feature 102). Reuses GetOrder's exact endpoint
   // and response shape, minus the single-order orderId filter — an explicit accountId query
   // param is required here (GetOrder relies on orderId alone to implicitly scope its single
   // result; a bulk call has nothing else scoping it under a Client Portal session that can span
   // multiple sub-accounts). ClientOrderID is deliberately left unpopulated: IBKR's SubmitOrder
   // (see SubmitOrder above) never sends a customer-order tag, so there is nothing for the broker
   // to echo back here.
   func (c *IBKRClient) ListOrders(ctx context.Context) ([]BrokerOrder, error) {
       endpoint := fmt.Sprintf("%s/iserver/account/orders", c.baseURL)
       httpReq, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
       if err != nil {
           return nil, fmt.Errorf("ibkr ListOrders: build request: %w", err)
       }
       q := httpReq.URL.Query()
       q.Set("accountId", c.ibkrAccountID)
       httpReq.URL.RawQuery = q.Encode()
       httpReq.Header.Set("Authorization", c.signRequest(http.MethodGet, endpoint))

       resp, err := c.httpClient.Do(httpReq)
       if err != nil {
           return nil, fmt.Errorf("ibkr ListOrders: http: %w", err)
       }
       defer resp.Body.Close() //nolint:errcheck

       respBody, _ := io.ReadAll(resp.Body)
       if resp.StatusCode != http.StatusOK {
           return nil, fmt.Errorf("ibkr ListOrders: status %d: %s", resp.StatusCode, respBody)
       }

       var result struct {
           Orders []struct {
               OrderID   string  `json:"orderId"`
               Status    string  `json:"status"`
               AvgPrice  float64 `json:"avgPrice"`
               FilledQty float64 `json:"filledQuantity"`
           } `json:"orders"`
       }
       if err := json.Unmarshal(respBody, &result); err != nil {
           return nil, fmt.Errorf("ibkr ListOrders: parse response: %w", err)
       }
       orders := make([]BrokerOrder, 0, len(result.Orders))
       for _, o := range result.Orders {
           orders = append(orders, BrokerOrder{
               BrokerOrderID: o.OrderID, Status: o.Status, FilledQty: o.FilledQty, FilledAvgPrice: o.AvgPrice,
           })
       }
       return orders, nil
   }
   ```
2. No new imports — `fmt`, `http`, `io`, `json` already imported in this file.

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off golangci-lint run --modules-download-mode=mod ./internal/broker/...
GOWORK=off go build ./...
```
Trading-domain constraint (broker coverage): both `BrokerType` values (`ALPACA`, `IBKR`) are handled
in Steps 10-11 — no third broker exists in this codebase.

---

### Step 12 — test: `ListOrders` unit tests (Alpaca + IBKR, incl. account-scoping)

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/broker/alpaca_test.go` — modify or create
- `services/xstockstrat-trading/internal/broker/ibkr_test.go` — modify or create

**Reviewers**: `xstockstrat-trading` owner

**Codebase Evidence**:
- `internal/broker` is **not** in the Go coverage-exclusion regex
  (`/(cmd|handler|repository|telemetry|service)(/|$)`) — this package's coverage counts toward the
  40% threshold, unlike the `internal/service` steps later in this spec.
- Existing broker test files (`alpaca_test.go`/`ibkr_test.go` if present — confirm via
  `find services/xstockstrat-trading/internal/broker -name '*_test.go'` at execute time; if absent,
  create following this service's `httptest.NewServer`-based mocking convention used elsewhere in the
  broker package, per `docs/patterns/test-data-inventory.md` **C-13**'s "no home exists yet, expected
  for a service with one test file" allowance).

**TDD**: `red-green required` (paired with Steps 9-11 — fails against the pre-Step-9 tree since
`ListOrders` does not exist)

**Instructions**:
Using `httptest.NewServer` (this package's established fake-broker-HTTP-server pattern — confirm the
exact helper name via `grep -rn "httptest.NewServer" internal/broker/` at execute time and reuse it
rather than hand-rolling a new one):
1. `TestAlpacaListOrders_ParsesMultipleStatuses` — fake server returns a JSON array of 3 `AlpacaOrder`
   objects (one `filled`, one `new`, one `partially_filled`) at `GET /v2/orders`; assert
   `ListOrders` returns 3 `BrokerOrder`s with `ClientOrderID` populated from each fixture's
   `client_order_id`.
2. `TestAlpacaListOrders_QueryParams` — assert the fake server observed `status=all&limit=500` (or
   equivalent parsed query values) on the request.
3. `TestAlpacaListOrders_HTTPError` — fake server returns 500; assert `ListOrders` returns a non-nil
   error and an empty/nil slice.
4. `TestIBKRListOrders_AccountScoping` — fake server asserts the incoming request's `accountId` query
   parameter equals the configured `ibkrAccountID` fixture value (the negative-scoping proof
   `design.md`'s Open Risk #1 names — this proves the **code** sends the param; the docstring/PR
   description must still note the broker-side honoring is unverified, per Step 11's own evidence).
5. `TestIBKRListOrders_ParsesMultipleOrders` — fake server returns a JSON `{"orders": [...]}` array of
   2+ entries; assert `ListOrders` returns all of them (not just the first, proving the single-match
   filter from `GetOrder` was genuinely dropped, not accidentally left in).
6. `TestIBKRListOrders_ClientOrderIDAlwaysEmpty` — assert every returned `BrokerOrder.ClientOrderID`
   is `""`, documenting (not silently assuming) the confirmed gap from Steps 9/11's Codebase Evidence.

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"
# Confirm ≥ 40%.
cd services/xstockstrat-trading && GOWORK=off golangci-lint run --modules-download-mode=mod
```

---

### Step 13 — service: `config.Watcher` outbound `SetConfig` passthrough

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/config/config.go` — modify

**Reviewers**: `xstockstrat-trading` owner

**Codebase Evidence**:
- Full current `Watcher` struct + `NewWatcher` read: `config.go:63-87` — `client
  configv1.ConfigServiceClient` is an **unexported** field; `TradingService` has no existing way to
  call `SetConfig` through its `s.cfgW *config.Watcher` reference (`trading.go:59`).
- `configv1.ConfigServiceClient` (the generated stub) already exposes a `SetConfig` method (same
  service definition `WatchConfig` comes from) — no new proto/codegen needed, this step only adds a
  Go-level passthrough.
- `design.md`: "a genuinely new `trading → config` edge — trading currently only has a `WatchConfig`
  client, reusing the already-configured `CONFIG_ENDPOINT`, no new env var" — confirmed:
  `CONFIG_ENDPOINT` is already present in `docker-compose.yml` (11 service blocks, including
  trading's) and `internal/config/config.go:35`.
- **Open Risk (design.md #6)**: "the new `trading → config` edge should carry a fresh `x-trace-id` for
  audit correlation given this call's blast radius" — addressed in this step via `metadata.AppendToOutgoingContext`.

**TDD**: `red-green required`

**Instructions**:
1. Add near the end of `config.go` (after `WaitForSnapshot`), a new exported method on `*Watcher`:
   ```go
   // SetConfig forwards to xstockstrat-config's SetConfig RPC, attaching the x-internal-caller
   // metadata header the receiving service's internal-caller authz channel checks (feature 102 —
   // see docs/roadmap/features/102-broker-state-reconciliation/design.md § "Internal-caller authz").
   // callerID identifies the automated caller (e.g. "trading-reconciliation-poller"); a fresh
   // x-trace-id is minted per call for audit correlation, since this is a distinct outbound edge
   // from the WatchConfig stream every other call on w.client uses.
   func (w *Watcher) SetConfig(ctx context.Context, callerID string, req *configv1.SetConfigRequest) (*configv1.SetConfigResponse, error) {
       md := metadata.Pairs(
           "x-internal-caller", callerID,
           "x-trace-id", uuid.NewString(),
       )
       outCtx := metadata.NewOutgoingContext(ctx, md)
       return w.client.SetConfig(outCtx, req)
   }
   ```
2. Add the two new imports this needs: `"google.golang.org/grpc/metadata"` and
   `"github.com/google/uuid"` (the latter already a module dependency — confirmed used elsewhere in
   this service, `trading.go:12`).

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off golangci-lint run --modules-download-mode=mod ./internal/config/...
GOWORK=off go build ./...
grep -n "func (w \*Watcher) SetConfig" internal/config/config.go
```
Header propagation constraint: this is a new outbound gRPC call to another backend service — it
carries `x-internal-caller` (the platform-internal authorization channel this feature adds) and a
fresh `x-trace-id`; `x-user-id`/`x-access-scope` are deliberately **not** forwarded (there is no
inbound human request to forward them from — this is a background poller's own outbound call, exactly
the scenario `docs/patterns/header-propagation.md`'s entry-point-only auth model describes).

---

### Step 14 — test: `Watcher.SetConfig` passthrough

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/config/config_test.go` — modify or create

**Reviewers**: `xstockstrat-trading` owner

**Codebase Evidence**:
- `internal/config` is **not** in the Go coverage-exclusion regex — counts toward the 40% threshold.
- `configv1.ConfigServiceClient` is an interface (generated by grpc-go) — fakeable directly with a
  hand-rolled struct implementing just `SetConfig` (and stub-panicking every other method), the same
  narrow-interface-fake technique `030`'s own test plan uses for `AccountRepository`
  (`030-stop-loss-bracket-orders/implementation-spec.md:884`, "fakes `AccountRepository.UpdateHaltStatus`").

**TDD**: `red-green required` (paired with Step 13)

**Instructions**:
1. `TestWatcher_SetConfig_AttachesMetadata` — construct a `Watcher{client: fakeClient}` (bypassing
   `NewWatcher`'s real dial — set the unexported `client` field directly since the test lives in
   package `config`), where `fakeClient.SetConfig` captures the incoming `ctx`'s outgoing metadata via
   `metadata.FromOutgoingContext(ctx)`. Assert `x-internal-caller` equals the `callerID` argument and
   `x-trace-id` is present and non-empty.
2. `TestWatcher_SetConfig_ReturnsUnderlyingError` — `fakeClient.SetConfig` returns an error; assert
   `Watcher.SetConfig` propagates it unwrapped (a thin passthrough, no swallowing).

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"
cd services/xstockstrat-trading && GOWORK=off golangci-lint run --modules-download-mode=mod
```

---

### Step 15 — service: halt-source plumbing (extends 030's planned halt mechanism)

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/repository/account_repo.go` — modify
- `services/xstockstrat-trading/internal/service/trading.go` — modify

**Reviewers**: `xstockstrat-trading` owner

**Codebase Evidence**:
- **Real, current state** (before `030` lands): `AccountRepository` interface (`account_repo.go:35-45`)
  has no `UpdateHaltStatus` method; `BrokerAccountRecord` (`account_repo.go:18-32`) has no `Halted`
  field; `scanBrokerAccount` (`account_repo.go:154-166`) scans 11 columns, none halt-related;
  `recordToProtoAccount` (`trading.go:1172-1186`) maps only `Id/DisplayName/BrokerType/IsPaper/UserId/
  IsActive/CredentialStatus/CredentialCheckedAt` — no halt fields on the outgoing proto at all.
- **030's planned additions** (`030-stop-loss-bracket-orders` implementation-spec.md, not yet landed
  — re-verify at execute time per the Execution Summary): `UpdateHaltStatus(ctx, id string, halted
  bool, reason string, haltedAt *time.Time) error` on the interface (lines 176-186 of that spec);
  `BrokerAccountRecord.Halted/HaltedAt/HaltReason` fields; `scanBrokerAccount`/the three `SELECT`s
  extended to include them (line 190 of that spec); `TradingService.halted map[string]bool` +
  `haltedMu sync.Mutex` + `isAccountHalted(accountID string) bool` + `haltAccount(ctx, accountID,
  reason string)` (lines 814-822 of that spec) — the latter calling `s.accountRepo.UpdateHaltStatus`
  with the dual-write ordering `insights.md` 2026-08-06 (030 design) documents: set the in-memory
  flag first, release the mutex, **then** the bounded DB write, never rolling back the flag on DB
  failure. `030`'s sole call site is `flattenAndHalt` (`s.haltAccount(ctx, bracket.AccountID,
  fmt.Sprintf("flatten failed after protection window expiry: order %s", bracket.OrderID))`, line 850
  of that spec).
- This step's job: extend every one of the above with the `halt_source` discriminator this feature's
  Step 1/3 proto/migration added, and update `030`'s one call site so it's explicit about which
  source it is.

**TDD**: `red-green required`

**Instructions**:
1. In `account_repo.go`, extend `BrokerAccountRecord` (once `030` has landed its `Halted`/`HaltedAt`/
   `HaltReason` fields) with `HaltSource int32 // matches trading.v1.HaltSource: 0=UNSPECIFIED,
   1=BRACKET_PROTECTION, 2=RECONCILIATION`.
2. Extend the `AccountRepository` interface's `UpdateHaltStatus` signature (030's landed shape) to add
   a fifth parameter:
   ```go
   UpdateHaltStatus(ctx context.Context, id string, halted bool, reason string, haltedAt *time.Time, haltSource int32) error
   ```
   Update its `pgAccountRepo` implementation's `UPDATE trading.broker_accounts SET halted = $2,
   halt_reason = $3, halted_at = $4` (030's landed SQL) to add `, halt_source = $5` and the new bound
   parameter.
3. Extend `scanBrokerAccount`'s `SELECT`/`Scan` column lists (030's landed three-query extension) to
   also select/scan `halt_source`.
4. In `trading.go`, extend `haltAccount` (030's landed method) to accept a `haltSource int32`
   parameter, threading it through to `s.accountRepo.UpdateHaltStatus(...)`. Update `030`'s one call
   site (`flattenAndHalt`) to pass `int32(tradingv1.HaltSource_HALT_SOURCE_BRACKET_PROTECTION)`
   explicitly — this is the only existing caller once `030` lands, and it must not silently default to
   `HALT_SOURCE_UNSPECIFIED`.
5. In `recordToProtoAccount` (`trading.go:1172-1186`), add the four new fields to the constructed
   `tradingv1.BrokerAccount`:
   ```go
   acct.Halted = r.Halted
   acct.HaltReason = r.HaltReason
   acct.HaltSource = tradingv1.HaltSource(r.HaltSource)
   if r.HaltedAt != nil {
       acct.HaltedAt = timestamppb.New(*r.HaltedAt)
   }
   ```
   This is the first time any of `030`'s halt columns reach the wire (`030`'s own `design.md` is
   DB-only and never proposed proto exposure) — required for Step 24's UI surface (**C-14**).

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off golangci-lint run --modules-download-mode=mod
GOWORK=off go build ./...
grep -n "HaltSource\|haltSource" internal/repository/account_repo.go internal/service/trading.go
```

---

### Step 16 — test: halt-source plumbing

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/service/trading_reconciliation_test.go` — create

**Reviewers**: `xstockstrat-trading` owner

**Codebase Evidence**:
- `internal/service` **is** in the coverage-exclusion regex — no coverage percentage applies here
  (matching Step 12's exclusion note for `101`'s own equivalent poller tests), but a red-green test
  is still required per **C-08**.
- `recordToProtoAccount` (`trading.go:1172-1186`) is a pure function over a `*repository.
  BrokerAccountRecord` — directly unit-testable with no DB, mirroring `030`'s own hand-rolled-fake
  technique.

**TDD**: `red-green required` (paired with Step 15)

**Instructions**:
1. `TestRecordToProtoAccount_MapsHaltFields` — build a `BrokerAccountRecord` with `Halted: true,
   HaltReason: "reconciliation mismatch", HaltSource: 2, HaltedAt: &someTime`; assert the returned
   `tradingv1.BrokerAccount`'s `Halted/HaltReason/HaltSource/HaltedAt` all match.
2. `TestRecordToProtoAccount_UnhaltedLeavesHaltSourceUnspecified` — a record with `Halted: false,
   HaltSource: 0`; assert the proto's `HaltSource == tradingv1.HaltSource_HALT_SOURCE_UNSPECIFIED`
   and `HaltedAt == nil` (nil-time not converted to a zero-value Timestamp).

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off go test ./internal/service/... -race -count=1
cd services/xstockstrat-trading && GOWORK=off golangci-lint run --modules-download-mode=mod
```
New logic is in the coverage-excluded `internal/service` package — no coverage percentage applies;
`go test ... -race` passing is the verification bar (per `reference/spec-template.md`'s excluded-
package note).

---

### Step 17 — service: `StartReconciliationPoller` + mismatch classification + self-heal + ordinary halt

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/service/trading.go` — modify
- `services/xstockstrat-trading/cmd/server/main.go` — modify

**Reviewers**: `xstockstrat-trading` owner

**Codebase Evidence**:
- Direct ticker template: `StartFillPoller` (`trading.go:629-650`) — `time.NewTicker` +
  `select{case <-ctx.Done(): return; case <-ticker.C: ...; live-reread config; ticker.Reset}`.
- Direct account-enumeration template: `syncPositions` (`trading.go:816-848`) — snapshot
  `s.brokers` under `s.brokersMu.RLock()`, skip accounts where `credentialsKnownInvalid(credStatus[accountID])`
  (`trading.go:1207-1209`).
- Direct compare/skip-on-no-op/never-blind-overwrite template: `pollFills` (`trading.go:684-712`) —
  compare `newStatus` to `order.Status`, `continue` on no-op, never overwrite on an unrecognized
  status.
- `emitLedgerEvent(ctx, eventType, streamKey, payload)`: `trading.go:1426-1439`. Account-scoped stream
  key precedent: `fmt.Sprintf("account:%s", accountID)` (`trading.go:898,914`, `syncAccountPositions`).
- `s.orders map[string]*tradingv1.Order` (in-memory, `trading.go:74`) + `s.repo` (DB-persisted) — the
  platform's own order records to diff against `ListOrders`' broker-side result.
- `s.portfolio portfoliov1.PortfolioServiceClient` (`trading.go:69`), already dialed
  (`trading.go:111-114`) and called non-blocking with a bounded timeout in `checkPortfolioRisk`
  (`trading.go:1288-1330`) — extend with a `ListPositions` call for position-side comparison. Use
  `ListPositions(account_id=...)`, **never** `GetPosition` — `100`'s own recon confirmed `GetPosition`
  silently drops its `account_id` request field at the service layer
  (`services/xstockstrat-portfolio/internal/service/portfolio_service.go:462-466`,
  `internal/repository/portfolio_repo.go:61` has no `accountID` parameter at all), while
  `ListPositions` honors it correctly (`portfolio_repo.go:90-92`) — `design.md` explicitly routes
  around this gap rather than fixing it (out of scope).
- Config-read idiom: `s.cfgW.GetFloat(key, def)` / `GetInt` (`internal/config/config.go:172-180`,
  never errors, returns default on miss).
- `haltAccount(ctx, accountID, reason string, haltSource int32)` — this feature's own Step 15
  extension of `030`'s planned method.
- `design.md` § "Mismatch classification (FR-2)" for the exact bucket definitions (propagation-delay,
  quantity-discrepancy, unknown-broker-order, missing-broker-order, unprotected/impossible) and §
  "Halt-routing (FR-4)" for the ordinary-vs-systemic split.
- FR-2 (product-spec.md): a `PARTIALLY_FILLED` order is **not itself** a mismatch — only a
  post-grace-window quantity disagreement is.

**TDD**: `red-green required`

**Instructions**:
1. Add two new config keys, read via the existing `Watcher.GetFloat`/`GetInt` idiom:
   `trading.reconciliation.interval_ms` (float, default `60000`) and
   `trading.reconciliation.grace_ticks` (int, default `1`).
2. Add `StartReconciliationPoller(ctx context.Context)`, mirroring `StartFillPoller`'s exact
   ticker+`ctx.Done()`+live-config-reread shape (`trading.go:629-650`), calling `s.reconcileTick(ctx)`
   each tick and reading `trading.reconciliation.interval_ms` for the live interval.
3. Add `reconcileTick(ctx context.Context)`: snapshot `s.brokers` under `s.brokersMu.RLock()` (mirror
   `syncPositions`'s snapshot pattern), skip accounts where `credentialsKnownInvalid(...)`. Per
   account:
   a. Call `entry.client.ListOrders(ctx)` (bounded by `s.brokerCallTimeout()`, the existing helper —
      `trading.go:930-937`). On error, count toward the systemic-escalation threshold (Instruction 6);
      `continue` to the next account.
   b. Diff the returned `[]broker.BrokerOrder` against `s.orders` (snapshot under `s.mu.Lock()`,
      mirror `pollFills`'s candidate-collection pattern, `trading.go:663-676`) filtered to this
      account (`order.AccountId == accountID`):
      - A broker order ID with no matching platform record → **unknown broker order** finding
        (regardless of fill state — this is what makes AC-1 literally true per `design.md`).
      - A **known** order whose remaining quantity (`Qty - FilledQty` on both sides) disagrees →
        candidate **quantity discrepancy**, subject to the grace window (next sub-step).
      - A **known** platform order absent from the broker's result → **missing broker order**
        finding.
   c. Grace window: track each candidate mismatch's first-observed tick (an in-memory
      `map[string]int` keyed by `accountID+":"+orderID`, cleared once resolved or escalated — a new
      field on `TradingService`, guarded by its own mutex, mirroring `credSkipLoggedAt`'s
      single-goroutine-no-lock-needed shape since `reconcileTick` runs on one poller goroutine only).
      A candidate seen for fewer than `1 + grace_ticks` consecutive ticks is **not yet a finding** —
      no ledger event, no halt (FR-2's explicit "not itself a mismatch" carve-out for routine
      propagation delay). Once past the grace window, it becomes a real finding.
   d. For each real finding (quantity-discrepancy / unknown-broker-order / missing-broker-order):
      emit `reconciliation.mismatch_found` via `s.emitLedgerEvent(ctx, "reconciliation.mismatch_found",
      fmt.Sprintf("account:%s", accountID), map[string]interface{}{"mismatch_class": "...",
      "order_id": ..., "expected": ..., "broker_reported": ..., "tick_at": time.Now()})` (stream key
      matches the existing `account:{account_id}` convention — corrected from product-spec's
      ungrounded `reconciliation:{account}` guess per `recon.md`), then call
      `s.haltAccount(ctx, accountID, "<class>: <detail>", int32(tradingv1.HaltSource_HALT_SOURCE_RECONCILIATION))`
      (Step 15's extension) — this is the **ordinary, per-account** halt path (FR-4's amended
      routing), reusing `030`'s mechanism, no `SetConfig`/authz call for this common case. Also emit
      the existing `EmitAlert` shape (`emitApprovalAlert`'s call pattern, `trading.go:1441-1454`),
      category `"reconciliation"`.
   e. Position-side comparison: call `s.portfolio.ListPositions(ctx, &portfoliov1.
      ListPositionsRequest{AccountId: accountID, TradingMode: ...})` bounded by the same broker-call
      timeout pattern `checkPortfolioRisk` uses; diff each broker `BrokerPosition.Quantity` against the
      matching platform position's quantity (grace-windowed identically to the order-side check,
      sharing the same tracking map keyed `accountID+":pos:"+symbol`). A disagreement past the grace
      window is a **quantity discrepancy** finding, same emit/halt path as 3d. This is where a fully
      `ORDER_STATUS_FILLED` order's effect is caught, per `design.md`'s explicit statement that a
      filled order drops out of the open-order loop and is only caught here, if at all.
   f. **Unprotected/impossible** bucket: a broker position/order under an account ID not present in
      `s.brokers` at all is unattributable — log a WARN (there is no platform account to halt) and
      count it toward the systemic-escalation threshold, per `design.md`'s resolution of this Open
      Question.
4. Do not write anything for the propagation-delay (within-grace-window) class — `design.md`: "no
   ledger event is written for this class at all... self-heal means literally no action, no event."
5. Wire `go svc.StartReconciliationPoller(ctx)` into `cmd/server/main.go`, alongside the existing
   `go svc.StartFillPoller(ctx)` / `StartPositionSyncPoller(ctx)` / `StartCredentialHealthPoller(ctx)`
   (`main.go:106,108,110`).
6. Systemic-escalation threshold tracking (feeds Step 20, not implemented in this step): accumulate a
   per-tick count of accounts that errored on `ListOrders`/`ListPositions` or produced an
   unprotected/impossible finding; Step 20 reads this count. Define it as an exported-from-package
   field or return value `reconcileTick` exposes — do not hardcode the escalation call inline here
   (kept as a separate step/commit per the `072`/2026-07-27 ledger lesson on carrying only the
   minimum coupling between adjacent steps).

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off golangci-lint run --modules-download-mode=mod
GOWORK=off go build ./...
grep -n "StartReconciliationPoller\|reconcileTick\|trading.reconciliation" internal/service/trading.go cmd/server/main.go
```
Trading-domain constraints: (fill state) both `PARTIALLY_FILLED` (never itself a mismatch, per FR-2)
and `FILLED` (caught only via the position-side check, per Instruction 3e) are explicitly addressed.
(Broker coverage) both `BrokerType` values are covered — `ListOrders` is called on `entry.client`
regardless of which broker implementation is behind it, no broker-specific branch in the poller.

---

### Step 18 — test: reconciliation classification + halt-write pure-logic tests

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/service/trading_reconciliation_test.go` — modify (created in
  Step 16)

**Reviewers**: `xstockstrat-trading` owner

**Codebase Evidence**:
- `internal/service` is coverage-excluded — no percentage threshold, `go test -race` passing is the
  bar (same note as Step 16).
- Table-test precedent for pure classification logic: `trading_helpers_test.go:10-37`
  (`TestAlpacaStatusToProto`).
- **C-13**: this test will be the reconciliation domain's own fixtures (broker snapshots, order/
  position pairs) — a single consumer at this point (one test file); compliant inline, no
  `internal/testdata/` home needed yet per C-13's materialization rule.

**TDD**: `red-green required` (paired with Step 17 — fails against the pre-Step-17 tree)

**Instructions**:
1. `TestReconcileTick_UnknownBrokerOrder_DetectedRegardlessOfFillState` — a broker `ListOrders` result
   containing an order ID absent from `s.orders`, in both `filled` and `new` status; assert both
   produce an "unknown broker order" finding (proves AC-1's "detected within one tick whether or not
   it has filled yet").
2. `TestReconcileTick_PartialFillWithinGraceWindow_NoFindingNoHalt` — a known order whose broker
   remaining-qty differs from the platform's, observed for the first time this tick (within
   `grace_ticks`); assert **zero** ledger emit and **zero** halt call — this is the FR-2/product-spec
   round-1-review regression this feature exists to prevent (a routine partial fill must never trigger
   a false halt).
3. `TestReconcileTick_QuantityDiscrepancy_PastGraceWindow_HaltsAndEmits` — the same mismatch observed
   across `1 + grace_ticks` consecutive ticks; assert a `reconciliation.mismatch_found` ledger event
   is emitted with `mismatch_class: "quantity_discrepancy"` and `haltAccount` is called with
   `HaltSource_HALT_SOURCE_RECONCILIATION`.
4. `TestReconcileTick_MissingBrokerOrder_HaltsAndEmits` — a known open platform order absent from the
   broker's `ListOrders` result (past grace window); assert the "missing broker order" finding.
5. `TestReconcileTick_PositionQuantityDiscrepancy_CaughtViaPositionSide` — a `FILLED` order (already
   dropped from the open-order comparison) whose resulting position quantity disagrees with
   `ListPositions`' broker-reported quantity; assert this is caught via the position-side check, not
   silently dropped (proves the product-spec Open Question's resolution is actually implemented, not
   just documented).
6. `TestReconcileTick_UnprotectedAccount_NoHalt_CountsTowardSystemic` — a broker position under an
   account ID absent from `s.brokers`; assert no `haltAccount` call (there is nothing to halt) and the
   systemic-escalation counter increments.
7. `TestReconcileTick_ListOrdersError_SkipsAccount_CountsTowardSystemic` — a fake `Broker.ListOrders`
   returning an error; assert the account is skipped without a crash and the error counts toward the
   systemic threshold.

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off go test ./internal/service/... -race -count=1
cd services/xstockstrat-trading && GOWORK=off golangci-lint run --modules-download-mode=mod
```
New logic is in the coverage-excluded `internal/service` package — no coverage percentage applies;
`go test ... -race` passing is the verification bar.

---

### Step 19 — service: systemic escalation via `platform.trading_state`

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/service/trading.go` — modify

**Reviewers**: `xstockstrat-trading` owner; Security — auth scope correctness of the outbound
internal-caller call

**Codebase Evidence**:
- `design.md` § "Halt-routing (FR-4)": "Rare, genuinely systemic findings... escalate to 100's
  platform-wide `platform.trading_state` via a new internal-caller authz mechanism" — mapped to
  `REDUCE_ONLY` (not `HALTED`, "unless severe").
- Step 13's `Watcher.SetConfig(ctx, callerID string, req *configv1.SetConfigRequest)` passthrough —
  this step is its first real caller.
- Step 17 Instruction 6's per-tick systemic-count return value/field — this step's trigger input.
- Steps 4-8's internal-caller channel: `callerID = "trading-reconciliation-poller"` (the exact literal
  in `authz.ts`'s `INTERNAL_CALLER_ALLOWLIST`), `allowedTargetValues: ['REDUCE_ONLY', 'HALTED']`.
- `100`'s **planned** (not yet landed) `configServiceImpl.ts` write-time literal validation for
  `platform.trading_state` (`ACTIVE`/`REDUCE_ONLY`/`HALTED` only) — this step's `SetConfigRequest`
  must send one of those exact literals as `value.string_val`.

**TDD**: `red-green required`

**Instructions**:
1. Define a threshold config key `trading.reconciliation.systemic_threshold_pct` (float, default
   `0.5` — half or more of registered accounts erroring/unprotected in one tick), read via
   `s.cfgW.GetFloat`.
2. In `reconcileTick` (Step 17), after the per-account loop, if the systemic-count / total-account-
   count for the tick meets or exceeds the threshold, call:
   ```go
   _, err := s.cfgW.SetConfig(ctx, "trading-reconciliation-poller", &configv1.SetConfigRequest{
       Namespace: "platform", Key: "trading_state",
       Value:  &configv1.ConfigValue{Value: &configv1.ConfigValue_StringVal{StringVal: "REDUCE_ONLY"}},
       Reason: fmt.Sprintf("reconciliation: %d/%d accounts unreachable/unprotected this tick", systemicCount, totalAccounts),
       Author: "system:reconciliation-poller",
   })
   if err != nil {
       slog.Warn("systemic escalation SetConfig failed", "error", err)
   }
   ```
   (Confirm the exact generated `ConfigValue`/`SetConfigRequest` Go field names against
   `packages/proto/gen/go/config/v1/` at execute time — do not guess field casing.)
3. Emit a CRITICAL `EmitAlert` (`emitApprovalAlert`'s call shape, `trading.go:1441-1454`), category
   `"reconciliation"`, alongside the escalation — an operator must be paged, not just have a config
   value silently change.
4. Do not call this for an ordinary per-account finding — Step 17's per-account halt path
   (`haltAccount`) is the routing for everything except this rare systemic bucket, per the
   user-approved FR-4/AC-3 amendment.

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off golangci-lint run --modules-download-mode=mod
GOWORK=off go build ./...
grep -n "SetConfig\|trading-reconciliation-poller\|systemic_threshold" internal/service/trading.go
```
Header propagation constraint: this outbound call reuses `s.cfgW.SetConfig` (Step 13), which already
carries `x-internal-caller`/`x-trace-id` — confirmed via the `grep -n` above rather than re-verified
per-call-site.

---

### Step 20 — test: systemic escalation

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/service/trading_reconciliation_test.go` — modify

**Reviewers**: `xstockstrat-trading` owner

**Codebase Evidence**:
- `internal/service` coverage-excluded — same note as Steps 16/18.
- Fakeable `configv1.ConfigServiceClient` — Step 14's same narrow-interface-fake technique.

**TDD**: `red-green required` (paired with Step 19)

**Instructions**:
1. `TestReconcileTick_SystemicThresholdCrossed_EscalatesToReduceOnly` — a tick where
   `ListOrders`/`ListPositions` error on ≥ half the registered accounts; assert `SetConfig` is called
   with `namespace="platform", key="trading_state", value="REDUCE_ONLY"`,
   `author="system:reconciliation-poller"`.
2. `TestReconcileTick_BelowThreshold_NoEscalation` — a tick with only one account's ordinary
   per-account finding (below the systemic threshold); assert `SetConfig` is **not** called (proves
   the ordinary/systemic split, not "every finding escalates").

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off go test ./internal/service/... -race -count=1
cd services/xstockstrat-trading && GOWORK=off golangci-lint run --modules-download-mode=mod
```

---

### Step 21 — service: FR-6 — resolve 101's `UNKNOWN` order intents

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/service/trading.go` — modify

**Reviewers**: `xstockstrat-trading` owner

**Codebase Evidence**:
- **101's planned schema** (`101-exactly-once-order-intent` implementation-spec.md:175-197, not yet
  landed — re-verify at execute time): `trading.order_intents(intent_id UUID PK, order_id UUID,
  request_hash TEXT, state SMALLINT, broker_account_id UUID NOT NULL, first_response JSONB,
  latest_response JSONB, created_at, updated_at)`; `IntentState` integer constants
  (`IntentStateUnspecified=0, IntentStatePending=1, IntentStateCompleted=2, IntentStateRejected=3,
  IntentStateUnknown=4`, that spec's Step 9 Instruction 5 — same file's lines 427-431).
- **101's planned sweep emits `order_intent.reclaimed_unknown`** with stream key
  `fmt.Sprintf("order:%s", rec.OrderID)` (that spec's Step 9 Instruction 6, lines 594-597) — the
  `order:{order_id}` convention (`CLAUDE.md`'s Ledger Events Emitted table), distinct from this
  feature's own `account:{account_id}` events.
- **Genuine gap found in 101's own spec, not resolved here** (flagged per **P-03** — no silent
  guessing): `design.md`'s FR-6 plan assumes an `order_intent.late_response_conflict` ledger event is
  emitted whenever a late broker response arrives after an intent was already reclaimed to
  `UNKNOWN` (101's `design.md` § "Late-broker-response race" names this event explicitly). Direct
  grep of `101`'s own `implementation-spec.md` for `late_response_conflict` finds it named only in
  forward-reference/dependency notes (`implementation-spec.md:55`) — **no step's Instructions
  actually emit it** (confirmed: no `FinalizeIntent`/CAS-failure branch in that spec calls
  `emitLedgerEvent` with this event type). This step's Instruction 2 below states the required
  fallback rather than assuming the event exists.
- 101's `IntentState_INTENT_STATE_UNKNOWN` on `Order.intent_state` (proto field 21, that spec's Step
  1) — `s.orders`/`s.repo` already carry `*tradingv1.Order`, so filtering by `IntentState ==
  tradingv1.IntentState_INTENT_STATE_UNKNOWN` needs no new query shape once that field lands.
- This feature's own `ListOrders` (Steps 10-11) result, already fetched once per account per tick in
  `reconcileTick` (Step 17) — FR-6 reuses that **same** call, not a second broker round-trip
  (`design.md`: "the same tick").
- **This step's own finding** (Execution Summary #1): IBKR's `ListOrders` (Step 11) never populates
  `ClientOrderID` (IBKR's `SubmitOrder` never sends one) — the broker-side scan-by-client-order-id
  fallback below is **Alpaca-only**.

**TDD**: `red-green required`

**Instructions**:
1. In `reconcileTick` (Step 17), after the per-account order/position diff, per account: query
   `trading.order_intents` (via a new narrow repo method, e.g.
   `s.orderIntentRepo.ListUnknownForAccount(ctx, accountID)` — confirm the exact repository type 101
   lands, `OrderIntentRepository` per that spec's Step 9, at execute time) for rows with
   `state = IntentStateUnknown`.
2. For each `UNKNOWN` intent:
   a. **First**, query the ledger for an `order_intent.late_response_conflict` event at stream key
      `fmt.Sprintf("order:%s", intent.OrderID)` via the existing `LedgerServiceClient` the trading
      service already holds (`s.ledger`, `trading.go:65`) — if `101` has actually landed an emit site
      for this event (confirm via grep at execute time per the Codebase Evidence gap above; if it has
      not, this branch can never match and Instruction 2b is the only live path — **do not silently
      assume the event exists**, log a one-time WARN if a full sweep finds zero
      `late_response_conflict` events ever recorded, as a signal the upstream gap needs fixing in
      101, not 102).
      - If found: read the event's payload for the real broker outcome; CAS-update the intent row
        (`UPDATE trading.order_intents SET state=$1, latest_response=$2, updated_at=now() WHERE
        intent_id=$3 AND state=$4(Unknown)`) to `IntentStateCompleted` or `IntentStateRejected` per
        the payload's recorded outcome. Emit `order_intent.resolved_by_reconciliation` via
        `emitLedgerEvent`, stream key `order:{order_id}` (matching 101's own event's stream-key
        convention for this order-scoped concern, not `account:{account_id}`).
   b. **Fallback** (no `late_response_conflict` event found), **Alpaca accounts only** (per the
      Codebase Evidence's IBKR finding — for an IBKR account, skip straight to Instruction 2c): scan
      this tick's already-fetched `ListOrders` result for a `BrokerOrder.ClientOrderID` matching the
      intent's derived nonce (`"xss-" + intent.IntentID`, per 101's `design.md`'s client-order-id
      derivation). If found in a non-terminal-rejected state or a filled/accepted state: CAS the
      intent to `IntentStateCompleted`; if found in a broker-rejected state: CAS to
      `IntentStateRejected`. Emit `order_intent.resolved_by_reconciliation` identically to 2a.
   c. **Genuinely inconclusive** (no ledger event, no broker-side match — or an IBKR account, where
      2b cannot run at all): **no write this tick** — do not guess an outcome (`design.md`: "writing
      an unconfirmed guess would violate FR-3's 'never silently correct' discipline"). Retried next
      tick. Track a per-intent attempt counter (in-memory, cleared on resolution) so a future step can
      surface "checked N times, human must intervene" — `design.md`'s named Open Risk #7, out of
      scope to fully resolve in this pass; this step only avoids making it worse by not writing a
      guess.
3. This function must not itself gate on `IntentState` existing on `tradingv1.Order` at compile time
   for accounts where `101` has not yet landed — but since the build order requires `101` before
   `102`, this is a real compile-time dependency, not a runtime guard; if `101`'s `intent_state` field
   or `order_intents` table do not exist when this step executes, block and escalate (per the
   Execution Summary's re-verify note), do not stub around it.

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off golangci-lint run --modules-download-mode=mod
GOWORK=off go build ./...
grep -n "IntentStateUnknown\|late_response_conflict\|resolved_by_reconciliation" internal/service/trading.go
```

---

### Step 22 — test: FR-6 `UNKNOWN`-intent resolution

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/service/trading_reconciliation_test.go` — modify

**Reviewers**: `xstockstrat-trading` owner

**Codebase Evidence**:
- `internal/service` coverage-excluded — same note as prior test steps in this spec.
- Fakeable `OrderIntentRepository`/`LedgerServiceClient` — narrow-interface-fake technique reused
  again (this spec's 3rd use, following Steps 14/20 — a jscpd-DRY check across the three fakes is
  worth a look at execute time per the pre-commit hook, though each fakes a different interface).

**TDD**: `red-green required` (paired with Step 21)

**Instructions**:
1. `TestReconcileTick_UnknownIntent_ResolvedViaLateResponseConflictEvent` — a fake ledger returning a
   `late_response_conflict` event at `order:{order_id}` with a "completed" payload; assert the intent
   CAS-updates to `IntentStateCompleted` and `order_intent.resolved_by_reconciliation` is emitted.
2. `TestReconcileTick_UnknownIntent_ResolvedViaAlpacaListOrdersFallback` — no ledger event, but this
   tick's Alpaca `ListOrders` result contains a matching `ClientOrderID`; assert the CAS resolution.
3. `TestReconcileTick_UnknownIntent_IBKR_NeverUsesFallback` — an IBKR account's `UNKNOWN` intent with
   no ledger event; assert **no** write occurs (proves the IBKR-scoping restriction from Step 21's
   Instruction 2b is actually enforced, not just documented).
4. `TestReconcileTick_UnknownIntent_GenuinelyInconclusive_NoWrite` — an Alpaca account, no ledger
   event, no `ListOrders` match; assert zero DB write and zero ledger emit (proves FR-3's "never
   silently correct" discipline for the third branch).

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off go test ./internal/service/... -race -count=1
cd services/xstockstrat-trading && GOWORK=off golangci-lint run --modules-download-mode=mod
```

---

### Step 23 — docs: config-governance, CLAUDE.md updates, merge-order.md field-claim

**Status**: `pending`
**Service**: `docs/`
**Files**:
- `docs/patterns/config-governance.md` — modify
- `services/xstockstrat-config/CLAUDE.md` — modify
- `services/xstockstrat-trading/CLAUDE.md` — modify
- `docs/roadmap/features/merge-order.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `docs/patterns/config-governance.md` confirmed to have no "Author-sentinel conventions" section
  today (`grep` for `author=`/`Author-sentinel` returns nothing) — genuinely new, per `design.md`'s
  plan (Open Risk #10, Constitution **C-10(c)**).
- **fails.md 2026-07-01** (`063-fundamentals-scoring-model`): the `author="system"` sentinel (still
  live today, `services/xstockstrat-indicators/app/formulas/fundamentals_value_quality.py`,
  `AUTHOR = "system"`) was introduced ad hoc with no governance entry — `design.md` requires this new
  section to retroactively document it alongside this feature's own `"system:reconciliation-poller"`.
- `services/xstockstrat-trading/CLAUDE.md`'s existing Config Keys Consumed table (confirmed real,
  read in full above) and Ledger Events Emitted table — both need new rows.
- `services/xstockstrat-config/CLAUDE.md` — read at execute time for its current structure (not yet
  read in this spec pass); add the `HEADER_INTERNAL_CALLER`/internal-caller mechanism and the
  `caller_identity` column to whichever section documents `authz.ts`/the config schema.
- `merge-order.md:47` — the contested `BrokerAccount` field 9-12 row this feature's Step 1 resolves.

**TDD**: `N/A (docs)`

**Instructions**:
1. In `docs/patterns/config-governance.md`, add a new "## Author-sentinel conventions" section (after
   "## Registering a new config key"):
   ```markdown
   ## Author-sentinel conventions

   A `SetConfigRequest.author` (or equivalent write-attribution field) written by an automated
   process, not a human operator, uses a `system:<process>` sentinel so an investigator can
   distinguish "an operator clicked Save" from "an automated process wrote this" in the audit log —
   without this convention, both look identical (fails.md 2026-07-01).

   | Sentinel | Service | Writer |
   |---|---|---|
   | `system` | `xstockstrat-indicators` | The seeded fundamentals-scoring formula
     (`app/formulas/fundamentals_value_quality.py`), documented here retroactively per feature 102 |
   | `system:reconciliation-poller` | `xstockstrat-trading` → `xstockstrat-config` | The
     broker-state-reconciliation poller's rare systemic escalation of `platform.trading_state`
     (feature 102) — paired with the structural `x-internal-caller`/`caller_identity` mechanism
     (see `services/xstockstrat-config/CLAUDE.md`), not a free-text convention alone |
   ```
2. In `services/xstockstrat-trading/CLAUDE.md`'s Config Keys Consumed table, add:
   ```
   | `trading.reconciliation.interval_ms` | float | `60000` | Interval for the broker-state-reconciliation poller (`reconcileTick`). Read live on every cycle. |
   | `trading.reconciliation.grace_ticks` | int | `1` | Consecutive ticks a mismatch must persist before it's a real finding (not a benign propagation delay). |
   | `trading.reconciliation.systemic_threshold_pct` | float | `0.5` | Share of accounts erroring/unprotected in one tick that escalates to `platform.trading_state=REDUCE_ONLY`. |
   ```
   And add to its Ledger Events Emitted table:
   ```
   | `reconciliation.mismatch_found` | `account:{account_id}` | Non-propagation-delay mismatch found by the reconciliation poller |
   | `order_intent.resolved_by_reconciliation` | `order:{order_id}` | A `101` `UNKNOWN` order intent resolved against broker truth by the reconciliation poller |
   ```
   Add a "Broker State Reconciliation" prose section (mirroring the existing "Order Status
   Reconciliation" section's structure) describing the ordinary-per-account-halt vs. rare-systemic-
   escalation split, citing `HaltSource` and the grace-window/self-heal behavior.
3. Read `services/xstockstrat-config/CLAUDE.md` in full at execute time; add a section documenting
   `HEADER_INTERNAL_CALLER`/`hasInternalCallerAuthority`/`INTERNAL_CALLER_ALLOWLIST` (the internal-
   caller authz channel, additive to the existing admin-scope gate) and the `caller_identity` audit
   column, following whatever heading convention that file already uses for `authz.ts`/schema
   documentation.
4. In `docs/roadmap/features/merge-order.md`, update row 47 (the contested `BrokerAccount` field 9-12
   claim) to record that this feature's `/sdd-spec` claimed fields 9-12 (Step 1) — resolving the row
   from "whichever feature's `/sdd-spec` runs first should claim" to a stated fact.

**Verification**:
```bash
grep -n "Author-sentinel conventions\|system:reconciliation-poller" docs/patterns/config-governance.md
grep -n "trading.reconciliation" services/xstockstrat-trading/CLAUDE.md
grep -n "HEADER_INTERNAL_CALLER\|caller_identity" services/xstockstrat-config/CLAUDE.md
grep -n "BrokerAccount.*9-12\|field 9\|field 12" docs/roadmap/features/merge-order.md
```

---

### Step 24 — service (UI): `/trader/positions` reconciliation status + halt display

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/hooks/useReconciliationStatus.ts` — create
- `services/xstockstrat-ui/src/app/trader/positions/page.tsx` — modify

**Reviewers**: `xstockstrat-ui` owner — trading UI correctness, no direct DB access

**Codebase Evidence**:
- **C-14 consumer surface**: product-spec.md's `## Consumer Surface(s)` names `/trader`
  (`positions/page.tsx`) explicitly — this step lands it.
- Direct hook template: `usePositionLineage.ts` (full file read above) — `useQuery` +
  `ledgerClient.queryEvents({...})` + client-side `.filter(...)` over the response, the established
  shape for a ledger-backed UI read on this exact page.
- **This feature's own finding** (Execution Summary #2): `QueryEventsRequest.event_type` is an
  exact-match filter (`ledger.proto:56`), not a prefix filter — fetch by `streamKey: 'account:' +
  accountId` alone (an exact match the RPC does support) and filter the returned events client-side
  by `e.eventType.startsWith('reconciliation.') || e.eventType.startsWith('order_intent.')`, mirroring
  `usePositionLineage`'s existing client-side-filter pattern rather than relying on server-side
  filtering that doesn't exist for this shape.
- `formatLastRun(then: Date, now: number): string` (`src/lib/formatLastRun.ts:8-17`) — deliberately
  tick-free (feature 098) — reuse directly for "last reconciled: Xs ago".
- `CredentialStatusBadge.tsx` (full file read above) — the renders-nothing-when-healthy `switch`
  pattern to mirror for the mismatch/halt marker.
- Step 15's `recordToProtoAccount` change means `ListBrokerAccounts` (already called on this segment,
  confirmed via the trader BFF's existing `TradingService` router registration) now returns
  `halted`/`halted_at`/`halt_reason`/`halt_source` on each `BrokerAccount` — no new RPC/BFF route
  needed, only a new field read on an existing response.
- **Amended AC-5** (product-spec.md, `design.md` § UI): "the badge derives **one** coherent
  restriction display across whichever mechanism is currently active — platform-wide `trading_state`
  (100, rare) checked first, else per-account `halted`/`halt_reason`/`halt_source` (030 or 102,
  ordinary) — not multiple independent badges." `platform.trading_state` is read the same way any
  other config value reaches this page today — confirm the exact existing config-read path (a
  `configClient`/`GetConfig` call, or a value already threaded through another query) at execute time;
  if none currently reaches `/trader`, add the minimal read (a `configClient.getConfig({namespace:
  'platform', key: 'trading_state'})` call through the trader BFF's existing `ConfigService` router
  registration, if one exists — confirm via `grep -n "router.service(ConfigService" services/xstockstrat-ui/src/lib/traderBff.ts` at execute time).
- Test-data inventory (**C-12**): `BROKER_ACCOUNTS` fixture already exists
  (`e2e/fixtures/accounts.ts`, per `INVENTORY.md:14`) — extend it (or a scenario-local override,
  `{ ...BROKER_ACCOUNT_ALPACA, halted: true, haltSource: HaltSource.RECONCILIATION }`) rather than a
  fresh inline literal, per C-12's spread-override exemption.

**TDD**: `red-green required`

**Instructions**:
1. Create `useReconciliationStatus.ts`:
   ```ts
   import { useQuery } from '@tanstack/react-query';
   import type { JsonObject } from '@bufbuild/protobuf';
   import { ledgerClient } from '@/lib/browserClients/ledgerClient';

   // useReconciliationStatus reads the most recent reconciliation.*/order_intent.* ledger events for
   // an account (feature 102). QueryEventsRequest.event_type is an exact-match filter, not a prefix
   // filter (ledger.proto:56) — fetch by stream_key alone and filter client-side, mirroring
   // usePositionLineage's existing shape.
   export function useReconciliationStatus(accountId: string | null) {
     return useQuery({
       queryKey: ['reconciliation-status', accountId],
       enabled: !!accountId,
       queryFn: async () => {
         const resp = await ledgerClient.queryEvents({
           streamKey: `account:${accountId}`,
           page: { pageSize: 50, pageToken: '' },
         });
         const relevant = resp.events.filter(
           (e) => e.eventType.startsWith('reconciliation.') || e.eventType.startsWith('order_intent.'),
         );
         const mostRecentMismatch = relevant.find((e) => e.eventType === 'reconciliation.mismatch_found');
         const lastTick = relevant[0]; // events return most-recent-first, per existing QueryEvents convention
         return {
           lastReconciledAt: lastTick ? new Date(Number((lastTick.payload as JsonObject)?.tick_at ?? 0)) : null,
           hasUnresolvedMismatch: !!mostRecentMismatch,
         };
       },
       refetchInterval: 10_000,
     });
   }
   ```
   (Confirm `QueryEventsResponse.events`' actual ordering — most-recent-first vs. oldest-first — via
   `packages/proto/ledger/v1/ledger.proto` and the real handler at execute time; adjust `.find`/index
   accordingly rather than assuming.)
2. In `positions/page.tsx`, import `useReconciliationStatus`, `formatLastRun`, and read
   `halted/haltReason/haltSource` off the already-fetched `BrokerAccount` (via whatever hook already
   supplies the account list to this page — confirm at execute time, likely `useAccountContext` per
   the existing import at `page.tsx:6`).
3. In the header block (`page.tsx:107-125`, the "Exposure" `h1` + description), add a small status
   line: `formatLastRun(lastReconciledAt, Date.now())` when present, styled subtly (mirrors
   `CredentialStatusBadge`'s "renders nothing for the healthy case" principle — render nothing when
   `!hasUnresolvedMismatch && !halted`).
4. Derive **one** coherent restriction display (amended AC-5): if `platform.trading_state` reads
   `REDUCE_ONLY`/`HALTED`, show that (platform-wide, checked first); else if the selected account's
   `halted` is true, show `halt_reason` with a badge distinguishing `halt_source` (`Bracket
   protection` vs. `Reconciliation`) via a small `Record<HaltSource, string>` render map (mirroring
   `opportunityShared.tsx`'s exhaustive-map pattern, per Constitution **C-04**/**C-10(a)**'s
   enum-render-map discipline) — never both badges simultaneously.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint
grep -n "useReconciliationStatus\|formatLastRun\|halted\|haltSource" src/app/trader/positions/page.tsx
```

---

### Step 25 — test (UI e2e): reconciliation status + halt display

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/mock-backend.ts` — modify
- `services/xstockstrat-ui/e2e/trader/positions-reconciliation.spec.ts` — create

**Reviewers**: `xstockstrat-ui` owner

**Codebase Evidence**:
- Direct mock-branch template: `mock-backend.ts`'s `LedgerService.queryEvents` handler (`:213-240`,
  full read above) — a `req.streamKey?.startsWith('copilot:')` conditional branch precedent for
  adding a `req.streamKey?.startsWith('account:')` branch alongside it.
- `INVENTORY.md:14` — `BROKER_ACCOUNTS`/`BROKER_ACCOUNT_ALPACA` fixtures (`e2e/fixtures/accounts.ts`),
  already consumed by `e2e/trader/{orders,order-form,account-selector}.spec.ts`'s `listBrokerAccounts`
  mock — this spec becomes a further consumer; a `{ ...BROKER_ACCOUNT_ALPACA, halted: true, haltSource:
  ... }` spread-override is a scenario one-off (C-12 exemption), not a new fixture module.
- `formatLastRun`'s rendered text shape (`"last run Xm ago"` / `"last run just now"`) — assert against
  this exact string family, adapted to whatever literal wording Step 24 actually renders.

**TDD**: `red-green required` (paired with Step 24 — fails against the pre-Step-24 tree)

**Instructions**:
1. In `mock-backend.ts`'s existing `LedgerService.queryEvents` handler, add a branch before the final
   `order.filled` fallback:
   ```ts
   if (req.streamKey?.startsWith('account:')) {
     return {
       events: [
         {
           eventId: 'evt-reconciliation-001',
           eventType: 'reconciliation.mismatch_found',
           streamKey: req.streamKey,
           sourceService: 'xstockstrat-trading',
           payload: { mismatch_class: 'quantity_discrepancy', tick_at: Date.now() },
           sequence: 1n,
         },
       ],
       page: { nextPageToken: '' },
     };
   }
   ```
2. Create `positions-reconciliation.spec.ts`:
   - `test('shows last-reconciled recency when healthy')` — override `queryEvents` for this test to
     return no mismatch events; navigate to `/trader/positions`; assert the "last run Xs/Xm ago" text
     is visible and no mismatch/halt badge is shown.
   - `test('shows an unresolved-mismatch marker when the last tick found one')` — use the
     mock-backend's default mismatch-event branch (Instruction 1); assert a visible marker.
   - `test('shows the halt reason and source when an account is halted')` — mock
     `listBrokerAccounts` to return `{ ...BROKER_ACCOUNT_ALPACA, halted: true, haltReason: 'quantity
     discrepancy: ...', haltSource: HaltSource.RECONCILIATION }`; assert the halt reason text and a
     "Reconciliation" (not "Bracket protection") source label render.
   - `test('platform-wide REDUCE_ONLY takes precedence over a per-account halt badge')` — mock both a
     halted account AND `platform.trading_state=REDUCE_ONLY`; assert only the platform-wide message
     renders, not both (amended AC-5's "one coherent display" requirement).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint
cd services/xstockstrat-ui && pnpm test:e2e -- positions-reconciliation
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._

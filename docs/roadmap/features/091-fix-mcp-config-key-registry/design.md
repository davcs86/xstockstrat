# Design: fix-mcp-config-key-registry

**Created**: 2026-08-02
**Rounds**: 2 (full) — proposer/adversary each round, mediated
**Grounded in**: recon.md

## Chosen Approach

**Single-table, server-authoritative.** No new registry table — the Round-1 `config.config_registry`
proposal was rejected (it duplicated `is_secret`/metadata onto a second table that no read path
consults → dead + drift/leak risk). "Registered ≙ a matching value row exists." Four coordinated
changes:

### 1. config migration `010` — audit key creation (two-trigger split)
The existing `config_value_audit` trigger is `BEFORE UPDATE` only (`migrations/001_config_tables.up.sql:49-51`),
which is exactly why key *creation* writes no audit row (`docs/context-constitution-findings.md:22`).
`010` **leaves the `BEFORE UPDATE` trigger untouched** and **adds a dedicated `AFTER INSERT` trigger**
(`config_value_audit_insert`) backed by a small new `config.audit_config_insert()` that writes one
audit row (`old_value=NULL`, `new_value=NEW.value_data`, `changed_by=NEW.updated_by`,
`reason=NEW.update_reason`, env/mode).
- **Why AFTER INSERT, not a widened `BEFORE INSERT OR UPDATE` (adversary R2 #1):** `setConfig` uses
  `INSERT … ON CONFLICT DO UPDATE` (`configServiceImpl.ts:316-325`). A single widened trigger would
  **double-fire** on the update path — the `BEFORE INSERT` arm fires for every proposed row (writing
  a phantom `old_value=NULL` "creation" row even on a no-op re-write) *and* the `BEFORE UPDATE` arm
  fires. `AFTER INSERT` fires **only for rows actually inserted** (the conflict/update path does not
  fire it), so a real creation is audited once and an update keeps its single existing-trigger row.
- **A dedicated insert-audit function** (not reusing `audit_config_change()`) avoids any coupling to
  the BEFORE trigger's `NEW` mutation / no-op-suppression logic; the update path stays byte-for-byte
  unchanged.
- Ships as `010`, never an edit to `001`/`002` (**F-01**). `.down.sql` drops the new trigger +
  function. Idempotent (`DROP … IF EXISTS`, `CREATE OR REPLACE FUNCTION`).
- Correction to the R1 claim (adversary R2 #2, **C-01**): `002:33-43` redefined the *function*
  `audit_config_change()`, not the trigger; the trigger was created once at `001:49-51` and is still
  `BEFORE UPDATE`. `010` does not touch it.

### 2. config `setConfig` — existence gate (mode-EXACT) before the upsert
After the admin-scope (`configServiceImpl.ts:293-300`) and author (`:309-313`) checks and before the
upsert, run: `SELECT 1 FROM config.config_values WHERE namespace=$1 AND key=$2 AND environment=$3 AND
trading_mode=$4 LIMIT 1` (on the same resolved env/mode the upsert's `ON CONFLICT (ns,key,env,mode)`
targets). `rowCount === 0 && !request.create_key` → `callback({code:5, message:'config key not
registered: <ns>.<key>'})` (NOT_FOUND). Else → the existing upsert (now audited on insert) +
`pg_notify` (`:326-328`).
- **Mode-EXACT, not mode-broadening (adversary R2 ruling):** an earlier variant used
  `(trading_mode=$4 OR trading_mode='all')` to mirror the read predicate. Rejected — the read paths
  (`reloadNamespace :186-189`, `listKeys :346-347`) load `(mode OR 'all')` with **no `ORDER BY` /
  precedence**, so letting a `paper` write "find" an `all` row and then INSERT a new mode-exact
  `paper` row manufactures the one `(all + paper)` collision the seed data never contains → the
  effective value flips nondeterministically on the next reload (an AC-1 regression, the silent-
  divergence class this feature exists to prevent). Mode-exact makes a per-mode override of an
  `all`-registered key return NOT_FOUND unless `create_key=true` — forcing explicit acknowledgment.
- `create_key` is enforced **server-side** (config-ui also calls `SetConfig`); the agent only
  forwards it.

### 3. proto + agent wiring
- Additive `SetConfigRequest.create_key = 8` (bool) after `trading_mode = 7` (`config.proto:88-96`);
  `./scripts/buf-gen.sh`; `buf lint` + `buf breaking` (additive → passes, **C-09**).
- Agent `set_config` tool (`tools.py:786-796`) gains `create_key: bool = False`, forwarded through
  `client.set_config` (`client.py:916-962`) onto the request. The agent adds **no** client-side
  existence refusal (server authoritative; keeps the empty-`keys` mocks meaningful). The existing
  `_grpc_error_message(e, not_found="config key not found")` (`tools.py:872`) already surfaces code 5
  → no agent error-map change. A **descriptor-parity test** over
  `config_pb2.SetConfigRequest.DESCRIPTOR.fields_by_name` (pattern `test_backtest_view.py:157`) pins
  `create_key` so the builder can't silently drop it (RC-1, `fails.md` 2026-08-02).

### 4. reads unchanged; AC-4 intact
`getConfig`/`watchConfig`/`listKeys` keep empty-return (boot safety for get/watch; `ListKeys`
empty-return kept on UX grounds — it is an admin/config-ui read, not a boot path). `is_secret` stays
solely on `config_values`. The agent's two-prong secret refusal (`tools.py:822-827` name-prefix +
`ListKeys` `is_secret`) is untouched, and a new `create_key` row defaults `is_secret=FALSE`, so
`create_key` cannot mint an unflagged secret (**AC-4**).

## AC coverage
- **AC-1** (unregistered refused unless `create_key`): mode-exact existence gate → NOT_FOUND.
- **AC-2** (NOT_FOUND reachable where appropriate): the admin-gated write path now returns code 5;
  get/watch/listKeys stay open by design (boot safety / UX).
- **AC-3**: audit half **met** (dedicated `AFTER INSERT` audit, one row with author+value); "registered
  but unset as a distinct persisted state" **reinterpreted** as "registered ≙ has a value row +
  audit-on-insert" — see Open Risks.
- **AC-4** (secret refusal unchanged): untouched.

## Rejected Alternatives
- **New `config.config_registry` table (R1)** — duplicates `is_secret`/`value_type`/`description` that
  only `config_values` read paths consult; dead columns + two-write drift/leak surface; larger diff.
- **Nullable `value_data` (Alt B)** — would satisfy AC-3 literally but ripples the NULL filter into
  three read paths (`getConfig`/`listKeys`/`buildConfigValue`) for a state no reader observes.
- **Single widened `BEFORE INSERT OR UPDATE` trigger** — double-fires on `ON CONFLICT DO UPDATE`
  (phantom creation rows, corrupts the audit log).
- **Mode-broadening existence SELECT** — nondeterministic read-shadow; would require adding
  precedence `ORDER BY` to all read paths (out of scope).
- **Agent client-side existence refusal** — breaks the empty-`keys` mocks and leaves config-ui
  ungated; server-authoritative is correct.

## Open Risks
- **AC-3 reinterpretation (product decision, design-gate resolution).** "Registered but unset" is not
  a distinct persisted state under this design. The adversary confirmed (R1 §4) it is invisible to
  every reader — `ListKeys`/`GetConfig` read value rows; defaults are call-site, not DB
  `default_value` — so it buys nothing operationally. Resolved here as "registered ≙ has a value row";
  the audit half of AC-3 is fully met. Recorded for audit in context.md; revisit only if a future
  feature needs a value-less registered key (→ Alt B nullable `value_data`). Target: product-spec AC-3
  note.
- **Governance narrowing (intended, verify-only).** Post-fix the only key-creation paths are migration
  seeds + agent `set_config(create_key=true)`; config-ui (`[namespace]/page.tsx:73-93`, edits only
  ListKeys-enumerated keys) can no longer mint orphan keys via typo. This enforces the "new keys
  require a PR" governance rule — desirable, but state it, don't ship it silently. Target: spec verify
  step.
- **074 zero-assertion trap.** Config tests run against compiled `dist/` (`package.json:12`); a suite
  can pass with zero assertions. New config tests must prove a red in the compiled suite (mirror
  `listKeysWire.test.ts`), non-zero assertions. Target: every config test step.
- **Concurrency (accepted).** Two `create_key=true` racers both pass the existence SELECT (TOCTOU);
  the value upsert's `ON CONFLICT DO UPDATE` makes the loser an UPDATE — no spurious INTERNAL. No lock
  needed.

## Constitution Rules Touched
- **F-01** — new migration `010`; never edit `001`/`002` (audit trigger added, not modified).
- **F-06** — existence SELECT + reuse `this.pool`; no new pool (config stays `DB_POOL_MAX ?? 2`).
- **F-07/F-04** — no hardcoded config values; no invented paths.
- **C-09** — additive `create_key = 8`; `buf lint`/`buf breaking`/`buf-gen`.
- **C-08/P-06** — paired RED-first tests, config in the compiled suite (074 trap).
- **C-01** — corrected the "002 redefined the trigger" claim (it redefined the function).
- **C-10** — same-PR docs across every surface: `set_config` docstring (its "blind upsert / silently
  CREATES orphan / audit on UPDATE only" warnings become false), `docs/runbooks/mcp-tools.md`
  (+ now-reachable NOT_FOUND row), agent `CLAUDE.md` tool table, config `CLAUDE.md` change-flow +
  `context-constitution-findings.md:22` (resolve the audit-on-UPDATE-only defect). strat-lab skill
  does not cover `set_config` (verify-only).
- **C-11/P-03** — AC-3 reinterpretation surfaced as an explicit escalation, not a silent guess.

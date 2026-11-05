# Product Spec: fix-config-keys-contract

**Type**: bug
**GitHub Issue**: n/a. Defect report `docs/reports/2026-11-04-config-key-drift-and-subscription-gaps-defect.md`
**Severity**: SEV-2
**Created**: 2026-11-04
**Depends on**: feature 295 `fix-config-keys-drift` merged to `main-dev`, plus one full staging release (295 decision 23). See merge-order.md.

---

## Problem Statement

After 295, every read key is seeded in its reader's exact spelling and the config server is
form-tolerant, with a dormant alias. The stored `key` column still mixes two spellings: the
namespace-prefixed form (`marketdata` / `marketdata.backfill.batch_size`) and the relative form
(`marketdata` / `alpaca.api_key`). The operator chose the namespace-relative form as canonical
(295 decision 1). This feature performs the cutover and makes the convention structural, so the drift
class cannot recur.

## Affected Services

xstockstrat-config (rename + CHECK migrations, `SetConfig`/`create_key`/`GetSecret` validation, alias
activation), plus the 11 consuming services whose getter literals, tests and fixtures are rewritten
(FR-2): xstockstrat-trading, xstockstrat-portfolio, xstockstrat-marketdata, xstockstrat-indicators,
xstockstrat-ingest, xstockstrat-analysis, xstockstrat-ledger, xstockstrat-identity,
xstockstrat-notify, xstockstrat-agent, xstockstrat-ui (config-ui segment). Also repo tooling:
`scripts/check-config-wiring.mjs`, `scripts/config-wiring.json`, `scripts/migration-rerun.sh`.

## Functional Requirements

- **FR-1: Canonical namespace-relative key, enforced.**
  - The stored `key` never begins with `<namespace>.`. A DB CHECK enforces it.
  - `SetConfig`, `create_key` and `GetSecret` reject a prefixed key with `INVALID_ARGUMENT`.
  - Exception: an allow-listed internal-caller grant is canonicalised with a WARN, because the
    previous image's reconciliation poller still sends `platform.trading_state` during rollout. The
    follow-up feature removes the exception.
- **FR-2: Every consumer addresses keys relative to its subscribed namespace.** All getter literals
  are rewritten in all 11 consuming services, along with their tests and fixtures.
- **FR-3: Rename migration.**
  - The migration is data-driven from 295's inventory and gate catalog.
  - It declares `-- contract-of:` the marker migration delivered by 295. 295's implementation spec
    renumbered it to `040_config_markers` (heal `041_heal_config_keys_to_reader_catalog`); the
    final number is recorded by 295 Step 38 and re-read at design time.
  - It renames every prefixed row to relative in every scope, including per-user scopes. Where twins
    exist, the twin the code reads wins.
  - Order: snapshot first, write the migration's own audit rows, then `pg_notify` per
    (namespace, environment).
  - In the same transaction it inserts marker row `('relative_keys_v1', now(),
    'system:config-migration-<NNN>')` into `config.config_markers` and sends
    `pg_notify('config_changed','{"marker":"relative_keys_v1"}')`. This activates 295's dormant
    alias, whose servers read the marker in the same statement as the rows (295 design.md §4).
  - Inputs from 295:
    - the 296-owned `seeded-unread` baseline entries in `scripts/config-wiring.json`;
    - the `twin-secret-class`, `twin-kept-unsigned` and `per-user-unread` rows of 295's heal
      report table (`config.config_heal_report_041` at the planned numbering);
    - heal rows identified by 295's heal `updated_by` (`system:config-migration-041` at the planned
      numbering).
- **FR-4: Zero-downtime rollout and rollback.**
  - During rollout, and after a rollback to 295's images without running the down migration, a
    previous-image consumer reading a prefixed key resolves the stored value through the activated
    alias.
  - Rolling back past 295 is forbidden, and `docs/runbooks/config-rollout.md` documents this.
- **FR-5: Gate relative mode.** `scripts/check-config-wiring.mjs` run with `--final` enforces the
  relative form: a prefixed read or a prefixed seed is a finding and the exit code is non-zero.
- **FR-6: config-ui and agent display the FQN** `<namespace>.<key>` and write relative keys.
- **FR-7: Final documentation.** C-05 (this feature amends its `<service>.<category>.<key>` wording
  to the namespace-relative stored form; the FQN is display-only), CONFIG-9, `config-governance.md`
  and the service CLAUDE.md config tables state the relative convention, and the 295 transition
  note is removed.
- **FR-8: Named follow-up.** A follow-up feature directory exists (created via `/sdd-story`) whose
  product spec removes the alias, the write tolerance and the internal-caller exception, declares
  `Depends on` this feature, and sets its earliest start to one release after this one.
- **FR-9: Dead-row deletion, gated on evidence (295 decision 15).**
  - A non-secret row with no reader in any spelling is deleted only when (a) the extended gate finds
    no static reader **and** (b) at least one full staging release window of 295's runtime read-key logs (no production DB exists, 295 decision 24)
    shows no read of that `(namespace, key)` in any service.
  - Each row is also in the operator-signed allowlist, gets a snapshot row and its own audit row
    first, and the migration is replay-safe.
  - **Evidence rule** (295 design.md §5): over the whole staging release window, there must be zero
    `config.read_key` hits in either spelling, **and** every `(service, ns)` subscriber of that
    namespace must have logged `config.read_coverage` in every 6 h window. Namespaces with a UI
    reader are never proven dead.
  - **Close-out:** each baseline entry is removed as its row is deleted, so the baseline ends empty.

## Consumer Surface(s)

- `/config-ui`: keys display as FQN, and the save path sends the relative key.
- Agent `get_config` / `list_config_keys` / `set_config`: FQN display, relative keys.
- Operators: a prefixed key is refused with a clear message.

## Proto Contract Changes

- None expected. `BrokerType` (ALPACA, IBKR) and all broker, order and paper/live behavior are unaffected:
  the Alpaca/Finnhub credential keys change only in stored spelling, never in value or type.

## Config Key Changes

- Every prefixed key is renamed to relative. Values, types and descriptions are unchanged.
- New contract key table: a design-phase deliverable, generated from the gate (none exists yet).
- C-05's `<service>.<category>.<key>` is amended to the namespace-relative stored form (FR-7).

## Database Changes

- Config migrations numbered max+1 after 295's chain, re-checked at spec time (config's tree today
  ends at `037`; `035`/`036` are PR #1359, `038`/`039` feature 282, `040`/`041` feature 295, and
  feature 291 also claims `035`). Each ships as an up+down pair; the rename's down is a refuse-down:
  - a rename (contract-of 295's marker migration);
  - a CHECK migration. It re-runs the idempotent strip in the same transaction before
    `ADD CONSTRAINT`, so a prefixed `create_key` arriving from a previous-image server in the gap
    cannot leave PRE_DEPLOY dirty.
- Replay and refuse-down entries are added to `scripts/migration-rerun.sh`.
- No applied migration is edited (F-01).

## Acceptance Criteria

See `acceptance.feature`.

## Out of Scope

- The alias and tolerance removal (FR-8 follow-up).
- Everything delivered by 295.

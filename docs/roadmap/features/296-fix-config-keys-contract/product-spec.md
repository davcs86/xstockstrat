# Product Spec: fix-config-keys-contract

**Type**: bug
**GitHub Issue**: n/a. Defect report `docs/reports/2026-11-04-config-key-drift-and-subscription-gaps-defect.md`
**Severity**: SEV-2
**Created**: 2026-11-04
**Depends on**: feature 295 `fix-config-keys-drift` (`launched`). See merge-order.md.

---

## Problem Statement

After 295, every read key is seeded in its reader's exact spelling and the config server is
form-tolerant, with a dormant alias. The stored `key` column still mixes two spellings: the
namespace-prefixed form (`marketdata` / `marketdata.backfill.batch_size`) and the relative form
(`marketdata` / `alpaca.api_key`). The operator chose the namespace-relative form as canonical
(295 decision 1). This feature performs the cutover and makes the convention structural, so the drift
class cannot recur.

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
  - The migration is data-driven from 295's inventory and gate catalog, and declares
    `-- contract-of:` on 295's seed migration.
  - It renames every prefixed row to relative in every scope, including per-user scopes. Where twins
    exist, the twin the code reads wins.
  - Order: snapshot first, write the migration's own audit rows, then `pg_notify` per
    (namespace, environment). It writes the marker that activates 295's alias.
- **FR-4: Zero-downtime rollout and rollback.**
  - During rollout, and after a rollback to 295's images without running the down migration, a
    previous-image consumer reading a prefixed key resolves the stored value through the activated
    alias.
  - Rolling back past 295 is forbidden, and `docs/runbooks/config-rollout.md` documents this.
- **FR-5: Gate relative mode.** `scripts/check-config-wiring.mjs` enforces the relative form: a
  prefixed read or a prefixed seed is a finding.
- **FR-6: config-ui and agent display the FQN** `<namespace>.<key>` and write relative keys.
- **FR-7: Final documentation.** C-05, CONFIG-9, `config-governance.md` and the service CLAUDE.md
  tables state the relative convention, and the 295 transition note is removed.
- **FR-8: Named follow-up.** Create the feature that removes the alias, the write tolerance and the
  internal-caller exception at least one release after this one.

## Consumer Surface(s)

- `/config-ui`: keys display as FQN, and the save path sends the relative key.
- Agent `get_config` / `list_config_keys` / `set_config`: FQN display, relative keys.
- Operators: a prefixed key is refused with a clear message.

## Proto Contract Changes

- None expected.

## Config Key Changes

- Every prefixed key is renamed to relative. Values, types and descriptions are unchanged.
- New contract key table: generated from the gate.

## Database Changes

- Config migrations after 295's, with numbers re-checked at spec time:
  - a rename (contract-of 295's seed migration);
  - a CHECK migration. It re-runs the idempotent strip in the same transaction before
    `ADD CONSTRAINT`, so a prefixed `create_key` arriving from a previous-image server in the gap
    cannot leave PRE_DEPLOY dirty.
- Replay and refuse-down entries are added to `scripts/migration-rerun.sh`.

## Acceptance Criteria

See `acceptance.feature`.

## Out of Scope

- The alias and tolerance removal (FR-8 follow-up).
- Everything delivered by 295.

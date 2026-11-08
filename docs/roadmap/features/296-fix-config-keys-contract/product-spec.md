# Product Spec: fix-config-keys-contract

**Type**: bug
**GitHub Issue**: n/a. Defect report `docs/reports/2026-11-04-config-key-drift-and-subscription-gaps-defect.md`
**Severity**: SEV-2
**Created**: 2026-11-04
**Depends on**: feature 295 `fix-config-keys-drift` merged to `main-dev`, plus one full staging release (295 decision 23, to be confirmed in context.md before the integration PR merges); **and** migration `040_config_markers` present on `origin/main` (the `migration-contract-gate` precondition). **Git precondition satisfied 2026-11-07**: promotion #1472 carried `040`, `041` and `043` to `origin/main` and 295 is `launched`. See merge-order.md.
**Followed by** (created from this feature's design, 2026-11-07): 304 consumer literal rewrite (FR-2), 305 dead-row deletion (FR-9), 306 alias removal (FR-8). Numbers are reserved by `/sdd-story`.

> **Amended at design approval (2026-11-07, operator-signed — context.md rounds 2–5).** This feature is the **contract PR** of a four-feature split. FR-2 and FR-9 moved out (see *Retired requirements*); FR-3 and FR-5 were amended (signed allowlist instead of a catalog-driven selection; a `prefixed-read` gate kind instead of a "prefixed seed" kind); FR-7 now covers the contract documents only. `/sdd-review product-spec` must run again before `/sdd-spec`.

---

## Problem Statement

After 295, every read key is seeded in its reader's exact spelling and the config server is
form-tolerant, with a dormant alias. The stored `key` column still mixes two spellings: the
namespace-prefixed form (`marketdata` / `marketdata.backfill.batch_size`) and the relative form
(`marketdata` / `alpaca.api_key`). The operator chose the namespace-relative form as canonical
(295 decision 1). This feature performs the **contract**: it renames every stored row, activates the
alias, enforces the convention structurally (CHECK + write rejection + gate), and makes the display
and documents state the new rule. The consumer literal rewrite follows in 304.

## Affected Services

xstockstrat-config (rename + CHECK migrations, `SetConfig`/`create_key`/`GetSecret` validation, alias
activation, poller exception); xstockstrat-ui (config-ui FQN display + relative save path);
xstockstrat-agent (`list_config_keys`/`get_config` FQN display + `set_config` docs). Repo tooling:
`scripts/check-config-wiring.mjs`, `scripts/config-wiring.json`, `scripts/config-wiring-stored.json`,
`scripts/migration-rerun.sh`, `scripts/migration-assertions/`, `scripts/config-heal/`. The other
consuming services (trading, portfolio, marketdata, indicators, ingest, analysis, ledger, identity,
notify, plus the agent's and ui's own config **reads**) are rewritten in 304; they keep working
unchanged after this feature because the activated alias serves both spellings.

## Functional Requirements

- **FR-1: Canonical namespace-relative key, enforced.**
  - The stored `key` never begins with `<namespace>.`. A DB CHECK (`config_values_key_relative_check`) enforces it.
  - `SetConfig`, `create_key` (the `createKey` flag of `SetConfig`) and `GetSecret` reject a prefixed key with `INVALID_ARGUMENT`, before any authz check.
  - Exception (`SetConfig` only, grant `trading-reconciliation-poller` only, global scope, no `createKey`; `create_key` and `GetSecret` get no exception): the internal-caller grant is canonicalised with a WARN, because the previous image's reconciliation poller still sends `platform.trading_state` during rollout. The follow-up 306 removes the exception.
  - The CHECK migration resolves rows that arrived in the rollout gap: a prefixed row next to a relative row of the same scope is a *gap twin*; the **newest write wins** (a migration-authored prefixed row — `updated_by` NULL or `system:%` — always loses), the winner is renamed onto the relative key keeping its `updated_at`, and a gap twin where exactly one member is a secret makes the migration raise.
- **FR-3: Rename migration.**
  - It renames every prefixed row to relative in every scope, including per-user scopes, keeping `updated_at`, `updated_by` and `value_encrypted`, and writes its own audit rows (the row-level audit trigger is disabled inside the migration transaction).
  - It declares `-- contract-of:` the marker migration delivered by 295 (`040_config_markers`). Its number is assigned at merge (max+1); it is **not adjacent** to 040.
  - **Twins** (both spellings in one scope) are resolved only from a hand-signed allowlist (`allow_296`, operator may sign either direction per tuple) matched per twin on (loser spelling, value hash). A twin with no attached tuple, a stale signature, an ambiguous signature, a secret-class member, a secret per-user parking candidate (`secret-parked-candidate`), an oracle mismatch, or a doubly-prefixed key makes the migration raise before any write, naming namespace/key/environment only (one line per violation, fixed precedence). A signed tuple attached to no twin is reported (`unmatched-signed-tuple`), never raised.
  - **Per-user rows stored in a spelling nobody reads** are snapshotted, audited, removed from `config_values` and reported (`per-user-parked`), so 295 `@AC-5` ("not silently applied") holds in spirit; a two-way oracle against `config.config_heal_report_041` (any 041 run) guards the selection.
  - Order: snapshot first, write the migration's own audit rows, set the marker, then `pg_notify` per (namespace, environment).
  - In the same transaction it inserts marker row `('relative_keys_v1', now(), 'system:config-migration-<NNN>')` (columns `name, set_at, set_by`) into `config.config_markers` and sends `pg_notify('config_changed','{"marker":"relative_keys_v1"}')`. This activates 295's dormant alias, whose servers read the marker in the same statement as the rows (295 design.md §4).
  - Recovery never edits the migration: every raise is cleared by a data repair, then `migrate force <n−1>` + `db-migrate.sh up`. A rolled-back rehearsal of the exact file on staging, taken immediately before merge, plus a CI test pinning `sha256(file)` to the recorded sign-off, keep the file fixed.
- **FR-4: Zero-downtime rollout and rollback.**
  - During rollout, and after a rollback to 295's images without running the down migration, a previous-image consumer reading a prefixed key resolves the stored value through the activated alias.
  - Rolling back past 295 is forbidden, and `docs/runbooks/config-rollout.md` documents this, together with the per-platform failure and recovery path (DigitalOcean PRE_DEPLOY and homelab compose).
- **FR-5: Gate relative mode.** `scripts/check-config-wiring.mjs` run with `--final` reports a read of the prefixed spelling of a seeded relative key as a `prefixed-read` finding (one per namespace/key), owned by 304 in a generated, shrink-only baseline; a new prefixed read is a blocking finding, and the exit code is non-zero. The inverse direction (prefixed seed, relative read) stays a `form-mismatch`. There is no "prefixed seed" kind: the CHECK plus the real `migrate up` in `config-wiring-stored` already fail one. Emptying the baseline and removing the kind are 304's close-out.
- **FR-6: config-ui and agent display the FQN** `<namespace>.<key>` and write relative keys. The server's `ListKeys` returns the stored relative key; clients compose the FQN.
- **FR-7: Contract documents.** C-05 (this feature amends its `<service>.<category>.<key>` wording to the namespace-relative stored form; the FQN is display-only), CONFIG-8/CONFIG-9, PLAT-14, `config-governance.md`, root `CLAUDE.md`, the config service `CLAUDE.md`, `docs/runbooks/config-rollout.md`, `docs/runbooks/mcp-tools.md`, and the SDD authoring documents — including `.claude/skills/sdd-review/reference/product-spec-criteria.md` criterion 6, `.claude/skills/sdd-spec/reference/spec-template.md`, `.claude/agents/spec-reviewer.md`, `.claude/skills/sdd-story/SKILL.md` and `.claude/agents/codebase-discovery.md`, so the review gate stops demanding the old wording in the same change — state the relative convention, with the caveat that readers may still use the prefixed spelling via the alias until 304's baseline is empty. The 295 transition note in the consuming services' `CLAUDE.md` banners is removed by 304.
- **FR-8: Named follow-up.** A follow-up feature directory (306, created via `/sdd-story` at design approval) exists whose product spec removes the alias, the write tolerance, the poller exception and its WARN, the agent alias filter and the gate's alt/`form-mismatch` path; it declares `Depends on` this feature and on 304, and sets its earliest start to one staging release after 304 launches, with zero `SetConfig canonicalised internal-caller key` WARNs over that release.

### Retired requirements (moved out at design approval; IDs are never reused)

- **FR-2 (consumer literal rewrite)** → feature 304 `config-keys-relative-consumers`.
- **FR-9 (evidence-gated dead-row deletion)** → feature 305 `config-dead-rows-prune` (cap of 5 signed tuples: `ledger/stream.notify_enabled`, `analysis/opportunity.sparkline_bars`, `marketdata/alpaca.paper`). `platform/log_level` (UI reader) and `trading/risk.daily_loss_limit` (documented future key) are re-owned to 306.

## Consumer Surface(s)

- `/config-ui`: keys display as FQN, and the save path sends the relative key.
- Agent `get_config` / `list_config_keys` / `set_config`: FQN display, relative keys.
- Operators: a prefixed key is refused with a clear message.

## Proto Contract Changes

- None expected. `BrokerType` (ALPACA, IBKR) and all broker, order and paper/live behavior are unaffected:
  the Alpaca/Finnhub credential keys change only in stored spelling, never in value or type.

## Config Key Changes

- Every prefixed key is renamed to relative. Values, types and descriptions are unchanged.
- The contract key table is the generated `scripts/config-wiring-stored.json` (regenerated by the `config-wiring-stored` CI job), not a hand-maintained document.
- C-05's `<service>.<category>.<key>` is amended to the namespace-relative stored form (FR-7).

## Database Changes

- Two config migrations numbered max+1 at merge (config's tree ends at `043` today), each an up+down pair:
  - **R** — the rename (`contract-of` 040); its down is a refuse-down (`irreversible contract`);
  - **R+1** — the CHECK migration; it first resolves any gap rows, then `ADD CONSTRAINT`; its down drops the constraint.
- New tables `config.config_values_premigration_296` (snapshot) and `config.config_keys_report_296` (never holds a value).
- Replay and refuse-down entries are added to `scripts/migration-rerun.sh`. The dirty-guard floor for config becomes 40 because `scripts/migration-dirty-guard.sh` (`:22-43`) derives a service's floor from the lowest `-- contract-of:` target found in its `migrations/*.up.sql` headers; R's header names `040_config_markers`, so no guard code changes.
- No applied migration is edited (F-01). No migration for FR-9 (feature 305).

## Acceptance Criteria

See `acceptance.feature`. Retired scenario IDs (AC-2, AC-7, AC-13, AC-14) are kept there as comments and are never reused.

## Out of Scope

- The consumer literal rewrite, service banners/tables, the strat-lab skill literal and the empty-baseline close-out (feature 304).
- Dead-row deletion (feature 305).
- The alias and tolerance removal (feature 306).
- Everything delivered by 295.

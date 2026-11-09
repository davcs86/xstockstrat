# Product Spec: config-dead-rows-prune

**Created**: 2026-11-07
**Type**: feature (slice C of feature 296 `fix-config-keys-contract`)
**Depends on**: feature 296 merged to `main-dev` — **merge order only; 296 need not be `launched`**. The tuples name relative keys, and this feature's config migration number is greater than 296's two. Independent of feature 304 (they commute; the only overlap is text in `scripts/config-wiring.json`). See `docs/roadmap/features/merge-order.md`.

---

## Problem Statement

Four config rows (across two keys) were seeded but are never read by any service: `analysis` / `opportunity.sparkline_bars` and `marketdata` / `alpaca.paper` (each in staging and production). The wiring gate carries them as `seeded-unread` baseline entries owned by this feature. `ledger` / `stream.notify_enabled` (also unread) is **kept**: durable scenarios 295 @AC-15 and 304 @AC-12 assert it stays, and the operator declined to change them (2026-11-09); deleting it is a product decision, like `trading` / `risk.daily_loss_limit`. They may only be deleted with static evidence (no reader in the code) **and** runtime evidence (zero `config.read_key` hits in either spelling over a full staging release, with every subscriber's `config.read_coverage` logged), because the static extractor has known blind spots.

## User Story

As a platform operator, I want provably dead config rows removed with a snapshot and an audit trail, so that `/config-ui` and the gate baseline stop carrying keys nobody reads, without risking a live key.

## Functional Requirements

FR-1. A config migration (number assigned at merge, max+1; not pre-reserved) deletes the signed dead rows: it snapshots them into `config.config_values_premigration_296`, deletes global rows (`user_id IS NULL`, `NOT is_secret`) using the inlined signed allowlist `(namespace, key, environment, value_sha256)` matched on the sha256 of `value_data`, writes one audit row per deleted row (`changed_at = clock_timestamp()`), then `pg_notify`s each touched (namespace, environment). The snapshot is the DELETE's `RETURNING` image inside one statement; per-user rows of the signed keys are probed, never deleted. It is replay-safe (a replay deletes nothing) and its down re-inserts from the snapshot `ON CONFLICT DO NOTHING`.
FR-2. A signed tuple that matches no row (value changed, or row already absent) is **reported** in `config.config_keys_report_296` as `unmatched-signed-tuple` and never raised; the row is left in place (the safe direction). The migration has no data-dependent RAISE, so recovery never edits the merged migration (F-01).
FR-3. A small pure function `deadRowVerdict({ns,key}, evidence, receivers)` in `scripts/check-config-wiring.mjs` returns `dead` or `kept:<reason>`. The third argument is the `(service, ns, class)` subscriber set frozen in the committed evidence (derived from `registry.receivers` at sign-off and proved equal to it then, so the permanent FR-4 test cannot go red on an unrelated PR), not the live registry. A row is kept if any of: a `config.read_key` hit after normalising each logged key to `(ns, key with a leading "<ns>." stripped)`; any `(service, ns)` subscriber from `registry.receivers` (service taken from the `services/<svc>/` path) missing a `config.read_coverage` entry in any 6 h bin of the window; a `services/xstockstrat-ui/` receiver on the namespace; a list-receiver subscriber on the namespace (fail safe, no crediting).
FR-4. The evidence is committed as `scripts/config-heal/dead-row-evidence.tsv`, exported by the operator from staging Loki over one full staging release of 295's logs as aggregated metric queries (per-`(service, ns)` `count_over_time` over 6 h bins for `config.read_coverage`, one instant read-hit query returning every key of the signed namespaces in both spellings, a superset of the 2 signed keys; Loki bins are left-open `(t-6h, t]`) and carrying the frozen subscriber rows, limited to receivers on the signed namespaces; the loader enforces a positive control per `(service, ns)` pair for watch/list subscribers, `ui` exempt: the distinct canonical read-hit keys must be at least the `keys=N` of that pair's last coverage line in the window; `scripts/config-heal/signoff.md` gains a section recording the LogQL text, the window, the evidence file sha256, the signed block sha256 and the operator. A test asserts every tuple of the signed block `scripts/config-heal/dead-rows-signed.sql` is judged `dead` against the committed evidence and that the migration contains the block verbatim.
FR-5. Baseline close-out: the two `seeded-unread` entries for the deleted keys (`analysis` / `opportunity.sparkline_bars`, `marketdata` / `alpaca.paper`) are removed from `scripts/config-wiring.json`, `scripts/config-wiring-stored.json` is regenerated, the migration is added to `scripts/migration-rerun.sh`'s replay list, and `scripts/migration-assertions/config-<NNN>.sql` asserts the rows are gone, snapshotted and audited.
FR-6. Remove the spent feature-296 sign-off tool `services/xstockstrat-indicators/app/maintenance/config_allow296.py` and `services/xstockstrat-indicators/tests/test_config_allow296.py` (valid only before the rename migration `044_config_keys_relative` reached `main-dev`, which it has), its `config_allow296` paragraph in `services/xstockstrat-indicators/CLAUDE.md` § Maintenance, and mark the tool removed in `docs/runbooks/config-rollout.md` § R sign-off and rehearsal. `app.maintenance.legacy_authors` stays. No runtime, proto, config or migration change; feature 296's own artifacts are historical and untouched. Operator-assigned to this feature (carried from feature 304's gap).
FR-7. Stale references to the deleted keys leave in the same PR: the two service `CLAUDE.md` rows (`analysis` `opportunity.sparkline_bars`, `marketdata` `alpaca.paper`). The ledger durable scenarios (295 @AC-15, 304 @AC-12) and the ledger `CLAUDE.md` row stay as they are: `stream.notify_enabled` is kept. The `'analysis.opportunity.sparkline_bars'` validation-bounds entry in `services/xstockstrat-config/src/grpc/configServiceImpl.ts` is dispositioned at design (remove vs keep; it must not be a reader that contradicts FR-3).

## Out of Scope

- `platform` / `log_level` (a UI reader exists, so it can never be proven dead) and `trading` / `risk.daily_loss_limit` (a documented future key; deletion is a product decision): both are re-owned to feature 306.
- `ledger` / `stream.notify_enabled`: kept (see Problem Statement); it remains a `seeded-unread` baseline entry whose owner is decided at the design gate. `services/xstockstrat-ledger/acceptance/*.feature` is untouched.
- `trading.broker.paper` (owned by its own defect).
- Deleting or altering `app.maintenance.legacy_authors`; any change to order execution, ALPACA/IBKR credentials or the environment-derived paper/live mode (deleting `marketdata` / `alpaca.paper` changes no trading mode; nothing reads it).
- The rename/CHECK migrations (296), consumer literal rewrite (304), alias removal (306).

## Affected Services

- `xstockstrat-config` — one data migration; rows in `config.config_values`
- `xstockstrat-indicators` — FR-6 only: delete the obsolete `config_allow296` maintenance tool and its test (no runtime, dependency or `uv.lock` change)
- Doc rows only (FR-7): `xstockstrat-analysis`, `xstockstrat-marketdata` `CLAUDE.md`
- Tooling: `scripts/check-config-wiring.mjs`, `scripts/config-wiring.json`, `scripts/config-wiring-stored.json`, `scripts/migration-rerun.sh`, `scripts/migration-assertions/`, `scripts/config-heal/`

## Consumer Surface(s)

- [x] **UI** — `/config-ui`: the deleted rows disappear from the `analysis` and `marketdata` namespace editors (no new page; C-10 n/a).
- [x] **Agent** — `list_config_keys` no longer returns the deleted keys.
- [ ] **None**

## Proto Contract Changes

- [x] No proto changes required

## Config Key Changes

- [x] No new config keys. Two existing keys are deleted: `analysis` / `opportunity.sparkline_bars`, `marketdata` / `alpaca.paper` (both non-secret, no reader; value types from the seed migrations 028 and 001/002: `marketdata` `alpaca.paper` bool, `analysis` `opportunity.sparkline_bars` int, code default n/a). `ledger` / `stream.notify_enabled` stays.

## Database Changes

- One config migration (up+down), numbered max+1 at merge (trunk max is 045, so 046 or later; 280 and 306 also draw from this range — whichever merges first takes the lowest, the others re-derive), and it is the only migration this feature adds; reuses the 296 tables `config_values_premigration_296` and `config_keys_report_296`. The rename/CHECK migrations are feature 296's.

## Feature Workflow Notes

Branch to create: `feature/config-dead-rows-prune` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (config change)
- [x] DBA review + service owner (schema migration)

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`). It carries the scenarios moved from 296 (its retired AC-7, AC-13, AC-14) as AC-1, AC-3, AC-4 here. Each `FR-N` above is covered by ≥1 tagged scenario.

## Resolved Decisions

- **Evidence window**: from the first staging deploy carrying 295's cores through the export date, one full staging release. FR-3's normalisation (strip a leading `<ns>.`) covers the prefixed→relative flip from 304 mid-window; AC-5 pins it. The Loki export is an operator action and gates execute, not design.
- **`marketdata` / `alpaca.paper`** qualifies only if the evidence judges both tuples (staging, production) `dead`; otherwise FR-2/FR-3 keep it. Total signed tuples: 4 (cap 5, operator decision in 296 `context.md`; the ledger tuple was dropped 2026-11-09).
- **Test-blast-radius trap** (`fails.md`, 295): the implementation spec must list in a step's **Files** every test and fixture touching `deadRowVerdict`, the `config-wiring.test.mjs` baseline tests and the `seeded-unread` `membership()` owner filter.
- **Ordering**: 305 and 304 commute (rebase-only on `scripts/config-wiring.json`); 305↔306 share the gate files and a migration number — a `merge-order.md` row is proposed to the operator, not written here.

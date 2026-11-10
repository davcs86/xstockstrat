# Product Spec: config-keys-alias-removal

**Created**: 2026-11-07
**Type**: feature (slice D of feature 296 `fix-config-keys-contract`; the FR-8 follow-up)
**Depends on**: feature 296 `fix-config-keys-contract` **and** feature 304 `config-keys-relative-consumers`, both `launched`. **Earliest start**: one staging release after 304 launches, with zero `SetConfig canonicalised internal-caller key` WARN lines over that release (the evidence is recorded in `context.md`). See `docs/roadmap/features/merge-order.md`.

---

## Problem Statement

Features 295 and 296 left four pieces of transitional compatibility so that previous-image consumers kept working during the rollout: a legacy spelling alias that serves each key under both spellings (`MARKER_ACTIVE_SQL`, `withLegacyAliases`, the marker resync), a `SetConfig` write-time spelling tolerance (the `key IN ($2,$3)` probes, the ambiguous-spelling `FAILED_PRECONDITION`), a canonicalisation exception for the trading reconciliation poller, and consumer-side filters. Once every reader and writer uses the relative key (feature 304) they are dead code that doubles every snapshot and can hide drift.

## User Story

As a platform engineer, I want the compatibility layer removed after a full release without regressions, so that the config server serves one spelling and the contract is structural.

## Functional Requirements

FR-1. The config server stops serving the legacy spelling: `withLegacyAliases`, the alias branch of `MARKER_ACTIVE_SQL`, and the marker-triggered `resyncAll` are removed; WatchConfig snapshots, deltas and `GetConfig` carry only stored (relative) keys. The `config_markers` table and the `relative_keys_v1` row stay (history), but no code reads them (a grep of the services for `relative_keys_v1` and `MARKER_ACTIVE_SQL` finds nothing outside migrations).
FR-2. `SetConfig` loses the write-time spelling tolerance (including the ambiguity message at `configServiceImpl.ts:854` that feature 296 rewrites): the `key IN ($2,$3)` / `altSpelling` probes become exact `key = $1`, the ambiguous-spelling `FAILED_PRECONDITION` branch and `writeKey` selection are removed, `hasInternalCallerAuthority` compares keys with exact equality, and the server `canonical()` helper is removed where no longer used.
FR-3. The poller canonicalisation exception and its WARN are removed: the trading reconciliation poller sends `platform` / `trading_state` (verified in trading's code before this feature starts), a prefixed key from it gets `INVALID_ARGUMENT`, and the grant is re-keyed to the relative spelling. The removal starts only after zero `SetConfig canonicalised internal-caller key` WARN lines are recorded over one full staging release after 304 launches (@AC-7).
FR-4. The agent `get_config` filter that drops alias entries starting with `${ns}.` is removed (the server no longer emits them); `docs/runbooks/mcp-tools.md` stays in parity.
FR-5. The gate's alt/`form-mismatch` path is removed (`alt`, `partnerOf`, the `form-mismatch` kind and baseline kind), as is any transitional wording left in the contract documents (`docs/patterns/config-governance.md`, `services/xstockstrat-config/CLAUDE.md`, `docs/runbooks/mcp-tools.md`, and the `risk.daily_loss_limit` row in `services/xstockstrat-trading/CLAUDE.md`; feature 304 already removed the "readers may still use the prefixed spelling via the alias" sentence).
FR-6. The three baseline entries owned by this feature are settled by the operator decision of 2026-11-10 (recorded in `context.md`): the rows `platform` / `log_level`, `trading` / `risk.daily_loss_limit` and `ledger` / `stream.notify_enabled` (re-owned from feature 305) are **deleted** by a global, non-secret data migration (snapshot, audit and a reversible down, in the style of feature 305; evidence of no reader is re-verified at design). Their `seeded-unread` baseline entries (owner `feature 306`) are removed. Deleting `stream.notify_enabled` is a C-16 CHANGE of durable scenarios 295 @AC-15 and 304 @AC-12: those scenario edits need a fresh, exact operator sign-off before any step touches them, and the `platform` / `log_level` UI surface is handled at design. Merge order: feature 305 (merged) precedes this feature.

## Out of Scope

- The rename/CHECK migrations (296), consumer literal rewrite (304), evidence-gated dead-row deletion (305).
- Removing the `config_markers` table.

## Affected Services

- `xstockstrat-config` — `configServiceImpl.ts` (`MARKER_ACTIVE_SQL` `:204`, `withLegacyAliases` `:222`, its uses `:509,:980`, `resyncAll` `:409`, write tolerance `altSpelling` `:815` and the ambiguity branch `:854`), `authz.ts`
- `xstockstrat-trading` — poller `SetConfig` key (already relative at `trading.go:2270-2277` since 304; only test constants and the `risk.daily_loss_limit` row in `CLAUDE.md` change)
- `xstockstrat-agent` — `get_config` filter (`app/tools.py:1833-1838`), `mcp-tools.md`
- Tooling: `scripts/check-config-wiring.mjs`, `scripts/config-wiring.json`, `scripts/config-wiring.test.mjs`

## Consumer Surface(s)

- [x] **Agent** — `get_config` response shape (alias filter removed); `list_config_keys` unchanged.
- [ ] **UI** — none for the alias removal (config-ui displays the FQN composed from the relative key; the trader banner read is relative). FR-6 deletes `platform` / `log_level`, so any UI surface that lists or reads that row is checked at design.
- [ ] **None**

## Proto Contract Changes

- [x] No proto changes required

## Config Key Changes

- [x] No new config keys. FR-6 deletes three rows via a config data migration named by slug (its number is the next free config number at merge; 047 as of 2026-11-10, shared with feature 280).

## Database Changes

- [x] No schema changes. One reversible data migration (`NNN_config_alias_removal_rows.up.sql`/`.down.sql`, `NNN` = next free config number at merge, runs after 046) deletes the three FR-6 rows with a snapshot, audit rows and a restoring down.

## Feature Workflow Notes

Branch to create: `feature/config-keys-alias-removal` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (config/behavior change) — config, trading, agent owners

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution **C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

- [x] FR-6 decided (operator, 2026-11-10): delete all three rows. Remaining at design: the `platform` / `log_level` UI surface, and the exact C-16 sign-off for the 295 @AC-15 / 304 @AC-12 edits.
- [x] Known trap (`fails.md`, 295 and 305 blast radius): `/sdd-spec` lists every test that sets the marker row, relies on `withLegacyAliases`, or asserts the ambiguous `FAILED_PRECONDITION` (`setConfigSpelling`, `dormantAlias`, `contentVersion`, `changeFeedLiveness` fakes, and the `form-mismatch` fixtures in `scripts/config-wiring.test.mjs`) in a step's **Files**.
- [x] The zero-WARN evidence is pulled at /sdd-design (LogQL query and window over one full staging release after 304 launches) and recorded in `context.md`; @AC-7 asserts the record.

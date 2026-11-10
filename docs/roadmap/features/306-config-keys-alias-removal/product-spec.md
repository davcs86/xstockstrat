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

FR-1. The config server stops serving the legacy spelling: `withLegacyAliases`, the alias branch of `MARKER_ACTIVE_SQL`, and the marker-triggered `resyncAll` are removed; WatchConfig snapshots, deltas and `GetConfig` carry only stored (relative) keys. The `config_markers` table and the `relative_keys_v1` row stay (history), but nothing reads them.
FR-2. `SetConfig` loses the write-time spelling tolerance (including the ambiguity message at `configServiceImpl.ts:813-815` that feature 296 rewrites): the `key IN ($2,$3)` / `altSpelling` probes become exact `key = $1`, the ambiguous-spelling `FAILED_PRECONDITION` branch and `writeKey` selection are removed, `hasInternalCallerAuthority` compares keys with exact equality, and the server `canonical()` helper is removed where no longer used.
FR-3. The poller canonicalisation exception and its WARN are removed: the trading reconciliation poller sends `platform` / `trading_state` (verified in trading's code before this feature starts), a prefixed key from it gets `INVALID_ARGUMENT`, and the grant is re-keyed to the relative spelling.
FR-4. The agent `get_config` filter that drops alias entries starting with `${ns}.` is removed (the server no longer emits them); `docs/runbooks/mcp-tools.md` stays in parity.
FR-5. The gate's alt/`form-mismatch` path is removed (`alt`, `partnerOf`, the `form-mismatch` kind and baseline kind), as is the transitional wording in the contract documents ("readers may still use the prefixed spelling via the alias until …" is already gone with feature 304).
FR-6. The three baseline entries owned by this feature are settled by an explicit decision recorded here and in `context.md`: `platform` / `log_level` (a UI reader exists; either add the reader or delete the row), `trading` / `risk.daily_loss_limit` (a documented future key; either implement/read it or delete the row as a product decision) and `ledger` / `stream.notify_enabled` (a documented future key, re-owned from feature 305 on 2026-11-09 because durable scenarios 295 @AC-15 and 304 @AC-12 assert it stays; either implement/read it or delete the row as a product decision — a delete is a C-16 CHANGE of those two scenarios and needs operator sign-off; fix the `(owner feature 305)` parenthetical in `services/xstockstrat-ledger/acceptance/config-keys-relative-consumers.feature` if feature 305 has not already). Their `seeded-unread` baseline entries (owner `feature 306`) are removed. Merge order: feature 305 merges before this feature's FR-6 closes.

## Out of Scope

- The rename/CHECK migrations (296), consumer literal rewrite (304), evidence-gated dead-row deletion (305).
- Removing the `config_markers` table.

## Affected Services

- `xstockstrat-config` — `configServiceImpl.ts` (alias `:195-221,501`, write tolerance `:774-818`), `authz.ts`
- `xstockstrat-trading` — poller `SetConfig` key (`trading.go:2263-2272` after 304) and test constants
- `xstockstrat-agent` — `get_config` filter, `mcp-tools.md`
- Tooling: `scripts/check-config-wiring.mjs`, `scripts/config-wiring.json`, `scripts/config-wiring.test.mjs`

## Consumer Surface(s)

- [x] **Agent** — `get_config` response shape (alias filter removed); `list_config_keys` unchanged.
- [ ] **UI** — none: config-ui already displays the FQN composed from the relative key (296); the trader banner read is relative (304).
- [ ] **None**

## Proto Contract Changes

- [x] No proto changes required

## Config Key Changes

- [x] No new config keys. Rows decided under FR-6 may be deleted by a config migration (number assigned at merge).

## Database Changes

- [x] No schema changes. (A data migration only if FR-6 chooses deletion.)

## Feature Workflow Notes

Branch to create: `feature/config-keys-alias-removal` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (config/behavior change) — config, trading, agent owners

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution **C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

- [ ] FR-6: for `platform` / `log_level`, `trading` / `risk.daily_loss_limit` and `ledger` / `stream.notify_enabled`, choose add-reader vs delete (product decision; operator); `ledger` / `stream.notify_enabled` joins them (re-owned from 305).
- [ ] Known trap (`fails.md`, 295 blast radius): list every test that sets the marker row, relies on `withLegacyAliases`, or asserts the ambiguous `FAILED_PRECONDITION` (`setConfigSpelling`, `dormantAlias`, `contentVersion`, `changeFeedLiveness` fakes) in a step's **Files**.
- [ ] How the "zero WARNs over a staging release" evidence is pulled (LogQL query and window) and recorded.

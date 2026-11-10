# Recon: config-keys-alias-removal

**Created**: 2026-11-10
**From**: product-spec.md
**Tree**: feature/config-keys-alias-removal@cce1aa3 (merged with origin/main-dev 44ce639)
**Affected services**: xstockstrat-config, xstockstrat-trading, xstockstrat-agent, xstockstrat-ledger (rows/scenarios only), xstockstrat-ui (e2e fixtures only), repo tooling (`scripts/`)

---

## Objective

Remove the 295/296 transitional spelling-alias layer (served aliases, write-time spelling tolerance, the poller canonicalisation exception, the agent filter, the gate's `form-mismatch` path) and delete the three seeded-unread rows 306 owns (`platform/log_level`, `trading/risk.daily_loss_limit`, `ledger/stream.notify_enabled`) through one reversible data migration. 304 is `launched` (2026-11-09 promotion); the WARN-free staging release evidence is still owed at execute.

## Codebase Map

- **`xstockstrat-config`** (Node) — all in `src/grpc/configServiceImpl.ts` and `src/grpc/authz.ts`
  - Alias: `MARKER_ACTIVE_SQL` `:204-205` (interpolated at `:452` reloadAll, `:472` reloadNamespace, `:497` overlay); `withLegacyAliases` `:222-229` (calls `altSpelling` `:225`; used `:509` resolveOverlayValues, `:980` buildGlobalSnapshot; `markerActive` plumbing `:493,:506,:987`); `contentVersion` `:210-219`.
  - `resyncAll` `:409-418` is called at `:365` (**reconnect path, feature 258 — not marker-only**) and `:433` (marker branch of `onNotification`, `:432-437`, fed by `044_config_keys_relative.up.sql:252` `pg_notify` marker payload). Only the `:433` branch is removable.
  - SetConfig: prefixed rejection `prefixedKeyRejection` `:187-193` (stays; uses `canonical`); poller exception `:693-721` (comment `:696`, condition `:698-706`, rewrite `:707-709`, WARN `:710`, reject `:717-719`); `canonical` also at `:183` (scalar bounds), `:751` (denial log), `:786` (trading_state enum guard); `hasInternalCallerAuthority` `:731-736`; probes `altSpelling` `:815`, `key IN ($2,$3)` `:819-823` and the per-user global probe `:827-834` (still needed, becomes `key = $2`); ambiguity branch `:841-857` (message `:854`); `writeKey` `:859` used at `:909,:912`.
  - `authz.ts`: `INTERNAL_CALLER_ALLOWLIST` `:84-93` (grant `key: 'platform.trading_state'` at `:90` → `'trading_state'`; comment `:88-89`), `canonical` `:96-99`, `altSpelling` `:102-105`, `hasInternalCallerAuthority` `:111-126` (`:123` canonical equality → `===`).
  - Migrations: last `046_config_dead_rows_prune`; next **047** (shared with 280). `config_markers` created `040_config_markers.up.sql:2-6`; `relative_keys_v1` written `044:244-245`, notify `044:252`; `dead_rows_305` written `046:53-55`.
  - Tests relying on the alias/marker: `src/__tests__/dormantAlias.test.ts` (fake `:58`, alias assertions `:109-113`, marker-writer tests `:138-154`), `setConfigSpelling.test.ts` (`:204` poller canonicalised+WARN, `:227` direction restriction, `:320`/`:335` ambiguity), `internalCallerSetConfig.test.ts` (`:102` WARN, 9 poller hits), `internalCallerAuthz.test.ts` (11 hits, `:82`), `contentVersion.test.ts:47` and `changeFeedLiveness.test.ts:66` (marker fakes; the latter also covers reconnect), `relativeKeysMigration.test.ts:11` (contract-of 040; unchanged).
- **`xstockstrat-trading`** (Go) — poller already relative: `internal/service/trading.go:2270-2277` (`platform`/`trading_state`, caller `trading-reconciliation-poller`); tests relative (`trading_reconciliation_test.go:786-787`, `internal/config/config_test.go:598-600`); the only prefixed literals are deliberate negative fixtures (`config_test.go:665-669`). `risk.daily_loss_limit` is read by no code; only `CLAUDE.md:99` and `docs/context-constitution-findings.md:43,57`.
- **`xstockstrat-agent`** (Python) — alias filter `app/tools.py:1833-1838` (secret redaction `:1829-1832` stays); tests `tests/test_config_tools.py:535-550` (drop), `:552-567` (lone prefixed kept — drop/repurpose), docstring `:511-513`; `docs/runbooks/mcp-tools.md` already has no alias text (`:1181-1183`, `:1221`).
- **`xstockstrat-ui`** — no `src/` reader of `platform/log_level` (only `src/lib/configFqn.test.ts:17`, a string-composition example); config-ui lists `ListKeys` output, so a deleted row simply disappears. e2e fixtures own a mock `log_level` row (`e2e/fixtures/configKeys.ts:30-31,57-65`, `e2e/mock-backend.ts:1481-1501`); five specs use it; none reads the real DB row. No UI reference to the other two keys.
- **Tooling**: `scripts/check-config-wiring.mjs` — `BASELINE_KINDS` `:169`, `validateState` `:176-203`, `join()` `:579-659` (`alt`/`partnerOf` `:606-607`, seed loop `:611-621` with `form-mismatch` push `:618-620`, `secretIds` `:623`, `both` `:638`, `:642`), `findingLine` `:661-666`, `namesOf` `:696`, `membership()` `:723-740` (owner regex `/^feature (305|306)\b/`), `DOC_BANNED` `:866`; `canonical` `:671` must stay (`deadRowVerdict` `:825-826`). `scripts/config-wiring.json:5-23` three `feature 306` seeded-unread entries (`broker.paper` read-unseeded `:24-29` is not 306's). `scripts/config-wiring.test.mjs` form-mismatch fixtures `:158-165,232-276,287-309,592-625`, gate 7 `:561-579`, `dead 3` `:946-956` (asserts the ledger entry owner is `feature 306`). `scripts/migration-rerun.sh` (`cfg_top` `:96-102` auto-adapts; 305 slug glob `:79-95`; pass 2d `:484-557`; the `relative_keys_v1` notify listener `:436-445,:671-677` and marker check `:302` stay valid because 044 emits that NOTIFY). `scripts/migration-assertions/config-046.sql:68-80` AC-10 asserts `ledger/stream.notify_enabled` is KEPT — fails once 306 deletes it. Stored set: `scripts/config-wiring-stored.json` (`inputs_sha256` `:4720`), generator `scripts/config-wiring-stored.sh`.

## Patterns to REUSE

- Row-deletion migration → reuse 305's `046_config_dead_rows_prune.{up,down}.sql` (latch marker CTE, `signed` VALUES block, `d` DELETE…RETURNING, `snap`, `aud`, `rep`, `mk`, `nt`; down via the marker's report rows). Actor sentinel `system:config-migration-feature-<slug>` (number-free).
- Migration proof → `scripts/migration-rerun.sh` slug-glob discovery and pass 2d pattern; `scripts/migration-assertions/config-NNN.sql` scoped to the current marker's `set_at`.
- Sha pin → `src/__tests__/deadRowsMigration.test.ts` / `relativeKeysMigration.test.ts` and `scripts/config-heal/signoff.md` sections.
- Baseline/gate → `scripts/config-wiring.json` ratchet, `--final`, `--doc-check`; regenerate stored set with `scripts/config-wiring-stored.sh`.
- Exact-equality grant → plain `grant.key === key` in `authz.ts:123`.

## Existing Business Rules (preserve / extend)

Digest from scenario-recon (read in full for config/ledger/trading/agent/ui core suites and the relevant ranges of `platform.feature`):

- **CHANGE** 295 `@AC-15` (`services/xstockstrat-ledger/acceptance/fix-config-keys-drift.feature:8-14`) — asserts `ledger/stream.notify_enabled` "still exists". Drop the Given and first Then, keep read-key recording (requires user sign-off recorded in `context.md`).
- **CHANGE** 304 `@AC-12` (`services/xstockstrat-ledger/acceptance/config-keys-relative-consumers.feature:7-17`) — last Then and bound-test (c) comment assert the row is kept; delete both (requires user sign-off).
- **CHANGE (not named in the spec)** 296 `@AC-3`, `@AC-4`, `@AC-5` (`services/xstockstrat-config/acceptance/fix-config-keys-contract.feature`) — assert alias service and poller canonicalisation+WARN; handle with dated read-notes (requires sign-off).
- **CHANGE (not named)** 295 `@AC-34` (`.../fix-config-keys-drift.feature:141-151`, ambiguity `FAILED_PRECONDITION`) plus the line-11/13 read-notes (requires sign-off).
- **CHANGE (not named)** 241 `@AC-2` (`.../fix-config-audit-author-spoof.feature:25-31`) and 294 `@AC-54` (`.../signal-map-instrumentation.feature:30-35`) — both write the prefixed `platform.trading_state` as the poller and pass today only via the exception; after FR-3 the prefixed key is `INVALID_ARGUMENT` before any grant logic, so the key literal must read `trading_state` (read-note; files say do-not-edit).
- **CHANGE (not named)** `docs/sdd/business-rules/platform.feature`: 278 `@AC-1` (`:797-802`, "form-mismatch"), 296 `@AC-24` first Then (`:1597`), 278 `@AC-7` Given "18 form mismatches" (`:842`), 295 `@AC-19` read-note (`:1440`, "owned by features 305 and 306").
- **EXTEND** 296 `@AC-1` — prefixed `SetConfig` is `INVALID_ARGUMENT`; 306 adds "no row is written" and the rejection must survive removal of `canonical()`.
- **PRESERVE** 295 `@AC-2` (stored-only snapshot), `@AC-21`/`@AC-26` (reconnect resync and no-op reload — only the marker-triggered `resyncAll` may go), `@AC-25`/`@AC-35` (grant match, bounds), 296 `@AC-8` (marker row stays), 304 `@AC-1`/`@AC-2`/`@AC-7`/`@AC-9`/`@AC-10`/`@AC-11`/`@AC-13`/`@AC-14` (`broker.paper` entry survives; `--doc-check` stays green), 296 `@AC-6`/`@AC-10`/`@AC-22`/`@AC-23`/`@AC-24` Thens 2-3 (secret and prefix-catalog exclusions must survive removal of `alt`), 305 `@AC-1`/`@AC-2`/`@AC-6` (config suite; re-verify down cannot re-insert 306's rows if the premigration snapshot table is shared), 305 `@AC-3`/`@AC-4`/`@AC-5` (`deadRowVerdict` keeps `canonical`), 278 `@AC-2`/`@AC-5`/`@AC-8` (fixture strings), 303 `@AC-1` (mocked ambiguity text only), 263 owner-scope, 258 stream resilience, 219 config-ui usability, 147 secrets.
- `log_level` and `risk.daily_loss_limit` appear in no `.feature` file; only `stream.notify_enabled` is asserted.

## Dependencies

- Proto/RPC: none.
- Migration: next number `047` for `services/xstockstrat-config/migrations/` (contended with 280; first to merge takes it).
- Config keys: no new; deletes `platform/log_level` (string; production `warn`, staging `info`), `trading/risk.daily_loss_limit` (float; production `0.01`, staging `0.02`), `ledger/stream.notify_enabled` (bool `true`; the stored baseline lists only a staging row — production presence is **unverified**). All global, non-secret per the seeds (001/002, healed by 017/041).
- Inter-service edges: unchanged. Poller → config `SetConfig` keeps the grant (`trading_state`, `REDUCE_ONLY`/`HALTED` only).
- New env vars / ports: none.

## Risks / Not-found

- **12 further CHANGE scenarios** beyond the two the spec names (list above): per C-16 they need operator sign-off or the underlying behaviour change must be dropped. Edit mechanism precedent (296/304): dated read-notes, not rewrites; the two ledger scenarios get real edits.
- `resyncAll` is shared with the reconnect path (`:365`); removing it wholesale regresses 295 @AC-21/@AC-26.
- `scripts/migration-assertions/config-046.sql:68-80` (AC-10 kept-key) **breaks** when 306 deletes `ledger/stream.notify_enabled`: `migration-rerun.sh` runs `config-N.sql` for N ≥ R in the final sweep (`:660-668`, R = 44) after every migration, so 046's assertion sees the post-047 state; it must change in the same atomic unit as the migration. **Verified (corrected from the first recon draft):** `migration-rerun.sh:671-677` (AC-8 marker notification) does NOT break — the `{"marker":"relative_keys_v1"}` NOTIFY is emitted by applied migration 044 (`044_config_keys_relative.up.sql:252`, untouched per F-01), not by server code; `:302` (marker count 0 after a raised R) is likewise unaffected. `config-041.sql:93-100` (notify_enabled exists) runs at the pre-R stage (N=41 < R) before 047, so it is unaffected.
- `alt` is used beyond `form-mismatch` (`check-config-wiring.mjs:623,638,642` secrets/prefix catalog); removal must keep 296 @AC-24 Thens 2-3 and 304 @AC-10.
- Premigration snapshot table `config_values_premigration_296` is shared with 296 R and 305; a 306 down must select only its own rows (`snapshot_at`/report `run_at` scoping), and 305's down must not re-insert 306's rows.
- FR-1's "grep finds no reader outside migrations" is false as stated: `scripts/migration-rerun.sh`, `scripts/migration-assertions/config-044.sql`, docs and acceptance files contain the strings.
- Not found: production `ledger/stream.notify_enabled` row; the WARN-free Loki evidence (execute precondition); any alias wording in `services/xstockstrat-config/CLAUDE.md` or `docs/runbooks/mcp-tools.md` (those FR-5 edits may be empty); a `config-047.sql` assertion or 306 pass in `migration-rerun.sh` (to be created).
- `fails.md` traps: 295 test-blast-radius (fakes of marker/alias), 305 `dormantAlias` marker-writer test (a new `config_markers` writer must not break "exactly one `relative_keys_v1` writer"), 296 offline-verification-only SQL (rely on CI `migration-rerun`/`config-wiring-stored`).

## Recommended Scope

1. Deletion migration 047 (slug `config_alias_removal_rows`) + `migration-rerun.sh` pass + `config-047.sql` + remove baseline entries + stored-set regen + gate/test updates (`dead 3`, `config-046.sql` AC-10) as ONE atomic unit.
2. Config server: remove alias, tolerance, exception, `resyncAll` marker branch, grant re-key; test fakes/cases updated.
3. Gate: remove `alt`/`partnerOf`/`form-mismatch` and its fixtures/tests.
4. Agent filter + tests; trading/ledger CLAUDE.md rows; docs (`config-governance.md`, `config-rollout.md`, findings files).
5. Acceptance read-notes/edits after the C-16 sign-off.

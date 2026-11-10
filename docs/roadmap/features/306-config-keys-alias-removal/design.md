# Design: config-keys-alias-removal

**Created**: 2026-11-10
**Rounds**: 3 (full; termination: approved)
**Approved by**: user (davcs86) @ 2026-11-10 (AskUserQuestion, "Approve this design")
**Grounded in**: recon.md (+ `scripts/` design scratch folded below)

---

## Chosen Approach

Five units, ordered. Unit B is the only atomic multi-file unit.

**Step 0 — @AC-7 evidence (operator/Grafana, not code; blocks Unit A).** `context.md` records: (a) a LogQL zero-count of `SetConfig canonicalised internal-caller key` on `deployment_environment="staging"` and the production equivalent over one full staging release (first staging deploy carrying 304's trading image to the next); (b) a positive-control count > 0 on the same selector and window; (c) `git merge-base --is-ancestor <304 trading merge sha> <deployed trading sha>` exits 0 for staging and production (the zero-WARN result alone is weak: the WARN fires only inside `escalateSystemic`, `trading.go:2253-2277`). 304 is `launched` (status.md on main-dev).

**Unit A — config server** (`services/xstockstrat-config/src/grpc/configServiceImpl.ts`, `authz.ts`; recon Codebase Map). Remove `MARKER_ACTIVE_SQL` (`:204-205`) and its uses (`:452,:472,:497`), `withLegacyAliases` (`:222-229`), the `markerActive` plumbing (`:493,:506,:509,:980,:987`), **only the marker branch** of `onNotification` (`:432-437`; the payload then falls to the no-namespace guard `:439`), the poller exception (`:693-721` collapses to prefixed → `INVALID_ARGUMENT`), `altSpelling` (`:815`, `authz.ts:101-105`), the ambiguity branch (`:841-857`) and `writeKey` (`:859`, uses `:909,:912` become `key`). **Keep `resyncAll`** (`:365`, reconnect; 295 @AC-21/@AC-26). Probes keep `SELECT key, is_secret FROM config.config_values` (eight test fakes route on that text) and change only the WHERE: exact `key = $2 AND environment = $3 AND COALESCE(user_id,'') = COALESCE($4,'')` with `[ns,key,env,userIdParam]`; global `... AND user_id IS NULL` with `[ns,key,env]`. `canonical` call sites: `:183` → `${namespace}.${key}`; `:751,:786` → `key === 'trading_state'`; `authz.ts` grant key `'trading_state'` (`:90`), `grant.key === key` (`:123`); `canonical` stays exported **only** for `prefixedKeyRejection` (`:187-193`), which keeps 296 @AC-1 (EXTEND: no row is written, including a double-prefixed key). Tests red first: `dormantAlias` inverted (marker cases kept, marker-writer scan `:138-154` kept), `setConfigSpelling` (`:204,:227` → INVALID_ARGUMENT / relative succeeds; `:320,:335` deleted; fake `:41-56`), `internalCallerSetConfig`, `internalCallerAuthz` (exact equality), `contentVersion.test.ts:47`, `changeFeedLiveness.test.ts:66`, `perUserSecrets.test.ts:73-96` (answer the new probes; throw on any unrecognised `config_values` SELECT).

**Unit C — gate** (`scripts/check-config-wiring.mjs`). Delete `alt`/`partnerOf`; add `rel`/`relId` next to `nk`; seed loop keeps the relSeed hoist and the suppression: a relative seed read only by the prefixed spelling emits `prefixed-read` only (never `seeded-unread`/`read-unseeded`); secrets/`excluded`/`catalogIds`/`flaggedIds` and the lookups `seeded.get(id) ?? seeded.get(rid)`, `catalogIds.has(relId(...))`, `flaggedIds.has(relId(...))` normalise **both** sides; the prefix-catalog branch compares raw keys; `BASELINE_KINDS` loses `form-mismatch`; `findingLine`/`namesOf` lose the branch; `canonical` stays (`deadRowVerdict`, `membership`); `membership()` untouched. Tests (`config-wiring.test.mjs`): join 1 → seeded-unread + prefixed-read + read-unseeded (3 sorted lines, exit 1); join 9 @AC-6 → seeded-unread for `ledger/ledger.export.enabled`, the two prefixed-reads, `reader_c.ts:export.enabled:read-unseeded`, `REPORTED …prod_only:read-unseeded:staging`, negative `:242` kept; @AC-22 scoped to `export.max_window_days`; @AC-24/304 @AC-10 unchanged; new pure `join 11` (relative seed + prefixed reader → exactly `['prefixed-read']`); `validateState` rejects `form-mismatch`; remove the `form-mismatch` baseline entries at `:247,:270`; `baseline 2` kind list; source assertion that the file has no `form-mismatch`/`partnerOf`/`alt(`.

**Unit D — agent** (`services/xstockstrat-agent/app/tools.py:1833-1838` filter removed, redaction `:1829-1832` kept; `tests/test_config_tools.py:535-567`; docstring `:511-513`; `docs/runbooks/mcp-tools.md` parity check). Reaches the Agent consumer surface: `get_config` returns the server's values unfiltered.

**Unit B — migration + baseline (atomic; operator rehearsal gate).** `<NNN>_config_alias_removal_rows.{up,down}.sql` (next free number at merge; 047 today, shared with 280; named by slug only in docs/tests): one data-modifying CTE in 046's shape (`046_config_dead_rows_prune.up.sql:5-61`): latch marker `alias_removal_rows_306`; `target` = the three `(namespace,key)` pairs; delete `user_id IS NULL AND NOT is_secret` rows in every environment (predicate, no sha — operator decision); snapshot into `config_values_premigration_296`; audit as `system:config-migration-feature-306` (`new_value` NULL); report action `alias-removal-row-deleted` per deleted row plus `alias-removal-out-of-scope` for target rows that are per-user or secret, **gated on `latch.open`** (never `unmatched-signed-tuple`, which `config-044.sql:145` counts globally); marker; per-(ns,env) notify. Bound ≤ 6 rows (`CHECK (environment IN ('staging','production'))`, `017:41`, plus the unique index, `017:101-102`); committed data selects 5 (notify_enabled staging only). Down mirrors `046…down.sql:4-24` filtered on its own marker and action (305's down joins only `dead-row-deleted`, so neither down resurrects the other's rows). Harness: slug-glob discovery and a 306 pass in `scripts/migration-rerun.sh` modelled on `:79-95,:484-557` (replay no-op fingerprint, down restores exactly the rows and clears the marker, rolled-back per-user sub-test, re-up; copy pass 2d's `d_rest` hash); assertion file `scripts/migration-assertions/config-alias-removal-rows.sql` (slug-named, not digit-led — the final sweep runs it once, `:657-669`), every count scoped to the current marker's `set_at`; narrow `config-046.sql:68-80` AC-10 (drop the existence half, keep "never audited by 305"); remove the three `scripts/config-wiring.json:6-23` entries; regenerate `config-wiring-stored.json` (`scripts/config-wiring-stored.sh`); `dead 3` → zero 306 entries and `--final` exit 0; `baseline 3` drops the 305/306 exemption; sha-pin test `aliasRemovalRowsMigration.test.ts` (pattern `deadRowsMigration.test.ts`) that also parses a `# Feature 306 — alias-removal row deletion` section appended **after** 305's in `scripts/config-heal/signoff.md` (production and staging rehearsal counts, 0 ≤ n ≤ 3, bound to the sha). Verification: local node gate/server tests, then CI `migration-rerun` and `config-wiring-stored` green on the **draft** integration PR (the execute host may lack Postgres, F-05); the PR stays draft until the signoff section exists. Must merge after 305 (merged).

**Unit E — docs and C-16 (signed).** Real edits: `services/xstockstrat-ledger/acceptance/fix-config-keys-drift.feature:8-14` (295 @AC-15) and `config-keys-relative-consumers.feature:7-17` (304 @AC-12). Amend existing 296 read-notes (`config/acceptance/fix-config-keys-drift.feature:11,13`; `platform.feature:1440,1570-1571` extended to name 278 @AC-7 `:842` and 296 @AC-24 Then 1 `:1601`); new notes: `fix-config-keys-contract.feature` header (296 @AC-3/4/5), `config-dead-rows-prune.feature` (305 @AC-1 scoped CHANGE), dated comment lines directly under the provenance headers of `fix-config-audit-author-spoof.feature` (241 @AC-2: the quoted `platform.trading_state` is the display FQN, request key `trading_state`) and `signal-map-instrumentation.feature` (294 @AC-54: a real CHANGE, request key `trading_state`), and 295 @AC-25. Docs: config `CLAUDE.md` invariant 7, trading `CLAUDE.md:99`, ledger `CLAUDE.md` row, the findings files, `docs/patterns/config-governance.md` (`:42`, `:77`, `:161`), `docs/context-constitution.md:52` (PLAT-14), `docs/runbooks/config-rollout.md` (rollback asymmetry), merge-order row naming `dormantAlias.test.ts` and the NNN owner. `--doc-check` stays green.

## Rejected Alternatives

- Signed-sha allowlist (305 style) — rejected: the operator chose "delete regardless"; a changed production value would become an unmatched leftover 306 can never close. Cost accepted: 305 @AC-1 becomes a signed scoped CHANGE.
- Remove `resyncAll` wholesale — rejected: it is the reconnect path (`:365`); regresses 295 @AC-21/@AC-26.
- Change the probe select list to `SELECT is_secret …` — rejected: eight fakes route on `SELECT key, is_secret`; keep the column, change only the WHERE.
- Emit `seeded-unread` for a relative seed read only prefixed — rejected: double-reports a read row as a deletion candidate and changes 296 @AC-6/@AC-22.
- Drop the prefixed-seed fixture class — rejected: forces re-stamping and leaves 296 @AC-24 Then 1 unpinned.
- `config-047.sql` number-named assertion — rejected: collides with 280 after a renumber; slug-named file runs once in the final sweep.
- Narrow `membership()`/gate 7 — rejected: dormant after 306, untouched code (CLAUDE.md rule 3).
- Delete per-user rows too — rejected: FR-6 says global, non-secret; they are kept and reported.

## Open Risks

- [ ] Rollback asymmetry: consumer images older than 304 against the 306 config server read prefixed keys as code defaults and a pre-304 poller gets `INVALID_ARGUMENT` (WARN only, `trading.go:2278-2285`, while the CRITICAL alert still says REDUCE_ONLY was applied); rolling the config image back to pre-306 is safe, running the migration down without reverting code leaves the gate red — record in `docs/runbooks/config-rollout.md` (Unit E) and re-check evidence (c) before any consumer rollback.
- [ ] Production row counts for the three keys are unknown (`ledger/stream.notify_enabled` may be absent); the DO-dev/production rehearsal fills `signoff.md` before the sha pin (Unit B).
- [ ] Unit B is proven only by CI `migration-rerun` final sweep (recon Risks); any other assertion expecting the rows would show red only on the draft PR.
- [ ] `contentVersion` changes once at deploy (alias keys leave the hash): one full-namespace DELTA per subscriber (accepted).
- [ ] Config migration number contention with 280 (first to merge takes it; rename touches files + `inputs_sha256`).
- [ ] The Loki `service_name` label for config and retention over one release are unconfirmed (Step 0).

## Constitution Rules Touched

- `C-16` — honored by: the operator's signed batch (context.md, verbatim), real edits only for the two ledger scenarios, amendments over new layers.
- `C-15` — honored by: every 306 `@AC` bound to a red-first test (join 11 for @AC-5); @AC-5/@AC-6/@AC-7 reworded as recorded spec amendments.
- `F-01` — honored by: 044/045/046 untouched; only a new migration and an assertion file change.
- `F-05` — honored by: Unit B's Verification is CI green on the draft PR; commit gates on local node tests.
- `F-04` — honored by: every anchor path:line from recon/discovery.
- `C-07` — honored by: next free number at merge; slug-glob discovery.
- `C-05` — honored by: relative-only contract becomes structural.
- `C-18` — honored by: one `rel`/`relId` helper replaces `alt`; one `startsWith` check replaces `canonical` in authz; no new abstraction.
- `P-03` — honored by: Step 0 evidence gates Unit A; unknown production counts are rehearsal-gated, not assumed.
- `P-06` — honored by: red-first tests per unit.

## Business Rules Touched (C-16)

- CHANGE 295 `@AC-15`, 304 `@AC-12` (ledger suites) — signed off by user @ 2026-11-10 (context.md).
- CHANGE 296 `@AC-3`, `@AC-4`, `@AC-5`; 295 `@AC-34` (+lines 11/13); 241 `@AC-2`; 294 `@AC-54`; 295 `@AC-25`; `platform.feature` 278 `@AC-1`, 278 `@AC-7`, 296 `@AC-24` Then 1, 295 `@AC-19`; 305 `@AC-1` (scoped) — signed off 2026-11-10 (read-notes).
- EXTEND 296 `@AC-1` — prefixed `SetConfig` is `INVALID_ARGUMENT` and writes no row (also double-prefixed).
- PRESERVE 295 `@AC-2`, `@AC-21`, `@AC-26`, `@AC-25` grant/bounds, `@AC-35`; 296 `@AC-6`, `@AC-8`, `@AC-10`, `@AC-22`–`@AC-24`; 304 `@AC-1`, `@AC-2`, `@AC-7`, `@AC-9`, `@AC-10`, `@AC-11`, `@AC-13`, `@AC-14`; 305 `@AC-2`–`@AC-6`; 278 `@AC-2`, `@AC-5`, `@AC-8`; 303 `@AC-1`; 263, 258, 219, 147 — not regressed by: the pinned gate finding sets, the kept `resyncAll`, the kept `prefixedKeyRejection`, and the CI final sweep.

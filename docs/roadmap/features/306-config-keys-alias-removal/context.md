# Context: config-keys-alias-removal  (archived 2026-11-10)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-11-10 — /sdd-archiver

**What**: This was the last slice (D) of the four-way split of 296. It removed the 295/296 transitional spelling layer:
- the served alias;
- the marker resync;
- write-time spelling tolerance;
- the trading-poller canonicalisation exception;
- the agent `get_config` filter;
- the gate's `form-mismatch` kind.

It also deleted the three seeded-unread rows that only 306 could close: `platform/log_level`, `trading/risk.daily_loss_limit`, and `ledger/stream.notify_enabled` (handed over from 305). The deletion is one predicate-delete migration, with a rolled-back rehearsal and a pinned sha. Trading needed no code change, because 304 had already made the poller send the relative key.

**Why (irrecoverable rationale)**:
- **The rows are deleted, not kept as documented future keys.** Operator (davcs86, 2026-11-10, AskUserQuestion): FR-6 = delete all three rows. The keys were 306's, not 305's, because 296 had framed `log_level` as having a UI reader that could never be proven dead (recon later found no real reader; see Scars), and `risk.daily_loss_limit` was a "documented future key" (a product decision). Deleting both reversed that framing. For `stream.notify_enabled` this deliberately overrode 305, which had declined to delete it, so 305 could never close that entry.
- **No sha allowlist.** The operator chose "delete regardless". With a 305-style allowlist, a drifted production value would become an unmatched leftover that 306 could never close. Accepted cost: 305 @AC-1 became a signed, scoped CHANGE.
- **Step 0 evidence record (@AC-7):**
  - Datasource `grafanacloud-logs`, selector `{deployment_environment="staging", service_name="config"}`.
  - Window: 20 h, 2026-11-09T10:10Z → 2026-11-10T06:10Z (the operator-confirmed reading of "full staging release").
  - `|= "SetConfig canonicalised internal-caller key"` → 0. Case-insensitive `canonicalis` over config and trading → 0.
  - Positive control `|= "GetSecret served"` → 28900.
  - `git merge-base --is-ancestor 79abf13 44ce639` exited 0 (79abf13 = the 304 trading merge; 44ce639 = the staging trading image).
  - At 44ce639, `trading.go:2270-2277` sends `platform`/`trading_state`.
  - Production N/A (no instance or stream). The poller logs nothing when healthy.
- **Evidence needed more than a zero count.** The WARN fires only inside a systemic escalation, so a zero count of it proves little. The weight was carried by:
  - deployed-image ancestry from the 304 merge;
  - the poller code at that sha sending the relative key.
- **No staged rollout, because rollback is asymmetric.** Rolling the config image back to pre-306 is safe. Pre-304 consumers are the unsafe direction: they read prefixed keys and fall back to code defaults. The mechanics are in `docs/runbooks/config-rollout.md`.
- **A one-time full-namespace DELTA at deploy was accepted.** The alias keys leave the `contentVersion` hash, so every subscriber receives one full-namespace DELTA when 306 deploys. This is recorded nowhere else.

**Rejected alternatives**:
- **Signed-sha allowlist (305 style):** lost to "delete regardless". A drifted value would be an unclosable leftover.
- **Removing `resyncAll` wholesale:** it is also the reconnect path (feature 258), so removing it would regress 295 @AC-21/@AC-26. Only the marker branch of `onNotification` was removed.
- **Changing the SetConfig probe to `SELECT is_secret …`:** eight test fakes route on the literal `SELECT key, is_secret FROM config.config_values` and read `params[1]` as the key. The select list and parameter position were frozen; only the WHERE changed.
- **Gate emitting `seeded-unread` for a relative seed read only via its prefixed spelling:** it would double-report a deletion candidate and change 296 @AC-6/@AC-22. Such a seed emits `prefixed-read` only.
- **Dropping the prefixed-seed fixture class:** it would force re-stamping fixtures and leave 296 @AC-24 Then 1 unpinned.
- **A number-named assertion file `config-047.sql`:** it collides with 280 after a renumber. A slug-named file (`scripts/migration-assertions/config-alias-removal-rows.sql`) is not matched by `config-[0-9]*`, and runs exactly once, in the final sweep.
- **Narrowing `membership()` / gate 7 now:** it is dormant after 306 and its code was untouched. This reverses an earlier note that the cleanup "fits this feature".
- **Also deleting per-user or secret target rows:** FR-6 covers global non-secret rows only. Others are kept, and are reported as `alias-removal-out-of-scope` only while the latch is open.
- **Reusing the report action `unmatched-signed-tuple`:** `config-044.sql` counts that action globally, so 306 needed its own actions (`alias-removal-row-deleted` / `-out-of-scope`).

**Scars & gotchas**:
- **The node test reporter writes test titles into the stdout the tests capture.** A test asserting "no `/canonicalis/i` log line" matched its own title, so test titles and messages avoid the word. Earlier, the spec had required asserting on a regex rather than the literal log string, so that the negative Verification grep over `src/` stays empty.
- **Validation runs before authz.** A prefixed key is now `INVALID_ARGUMENT` before any grant logic. Two durable scenarios that quoted `platform.trading_state` had passed only through the compat exception:
  - 294 @AC-54 (`setConfigAuthz.test.ts`, expecting `PERMISSION_DENIED`);
  - 241 @AC-2.
  
  Recon caught the scenarios, which were in the signed C-16 batch. What design missed, and `/sdd-spec` caught, was the unit test `setConfigAuthz.test.ts` (294 @AC-54 PERMISSION_DENIED).
- **Fakes that fall through to `{rows: []}` hide query changes.**
  - `perUserSecrets.test.ts`'s fake did not match the setConfig probes and silently answered "no rows". It was fixed to answer the new probes and to throw on any unrecognised `config_values` SQL.
  - `setConfigSpelling`'s fake was made to throw on `key IN`, so the old probe goes RED.
- **A new config migration forces stored-set regeneration in the same commit.** `inputs_sha256` hashes every file under `services/xstockstrat-config/migrations`. So the migration, the stored-set regen and the baseline removal had to be one atomic unit. `config-wiring-stored.json` round-trips byte-exact through `JSON.stringify(…, null, 4) + '\n'`, which allowed an offline regeneration that CI then confirmed.
- **The migration-rerun final sweep runs every ≥R / slug-named assertion against the post-latest state.** 305's `config-046.sql` AC-10 ("notify_enabled still kept") would go red after 047, so its existence half was dropped and the audit-never half kept.
- **Recon's first draft wrongly flagged `migration-rerun.sh` as breaking.** The `relative_keys_v1` NOTIFY is emitted by applied migration 044, not by server code.
- **Accepted consequence in the gate.** After `alt` was removed, a prefixed-stored row read by its relative spelling loses its type/default checks. It is still reported, not silent, and the case is fixture-only, because the 045 CHECK forbids prefixed stored keys.
- **Migration SQL was verified offline only before CI.** `pglast` (the PostgreSQL grammar) parsed each file as a single statement. The first real run was CI `migration-rerun` on the draft PR.
- **`platform/log_level` has no UI reader.** `xstockstrat-ui/src` has no reader (`configFqn.test.ts` is only a string example), and config-ui renders `ListKeys`, so the deleted row simply disappears. The five e2e specs use a MOCK `log_level` row (`e2e/fixtures/configKeys.ts`, `e2e/mock-backend.ts`), deliberately kept; it is not the DB row.
- **Spec claims that were empty in reality.** The trading "test constants" change and the `mcp-tools.md` parity edit were Not found, so they were not done.

**Permanent deviations**:
- **Step 0 evidence.**
  - Design: zero-count, positive control and ancestry for staging and production.
  - Shipped: staging only; production N/A.
  - Because: no production instance exists. DO lists only `xstockstrat-staging`, and Loki has no production stream.
- **Rehearsal scope.**
  - Design: production and staging rehearsal counts.
  - Shipped: "production" and "staging" are the two `environment` values inside the DO dev DB (the 305 precedent).
- **Rehearsal runs.**
  - Spec: two rolled-back runs.
  - Shipped: one run.
  - Accepted because CI `migration-rerun` replays the file repeatedly.
- **Test list.**
  - Design: the test list omitted `setConfigAuthz.test.ts`.
  - Shipped: the test was re-keyed to `trading_state`, keeping PERMISSION_DENIED and the denial log.
- **@AC-5 wording.**
  - Original: "an ordinary unseeded read".
  - Shipped: `prefixed-read`, per the design's `join 11`.
- **`membership()` cleanup.**
  - Earlier note: the 305-branch cleanup fits 306.
  - Shipped: `membership()` and its regex untouched, as dormant code.

**Cross-feature signal**:
- **Compat exceptions hide the durable rules that depend on them.** Removing one surfaced about 12 durable scenarios (241, 278, 294, 295, 296, 305) that passed only because of it, beyond the two the product spec named. Each needed a signed C-16 CHANGE or a read-note. The operator approved them in one batch at the design gate.
- **Each slice of the 295→296→304→305→306 chain had to rewrite earlier slices' assertion files and scenarios.** A slice that deletes data inherits every "still kept" assertion its predecessors wrote: config-046.sql AC-10, and ledger 295 @AC-15 / 304 @AC-12.
- **Ownership was handed over through a baseline owner string,** `feature 305` → `feature 306`. That let a downstream slice close an entry its predecessor had deliberately kept.

**Deferred follow-ons**:
- **Dormant regex.** `membership()`'s `/^feature (305|306)\b/` regex in `scripts/check-config-wiring.mjs` returns `[]` and is exercised only by the gate 7 fixture. A later cleanup could remove it.
- **306 owns 047 (merged).** Feature 280 takes the next free config number, and the pinned sha `52939ec4…` is permanent (F-01).
- **History left in place.** The `config_markers` table and the `relative_keys_v1` row stay as history with no reader. The `dormantAlias.test.ts` "exactly one `relative_keys_v1` writer" check still stands.
- **`risk.daily_loss_limit`'s intended halt was never implemented,** and the key and row are now gone (trading findings file).
- **@AC-6 and @AC-7 were not promoted** to the durable suites, because they are one-time scenarios.

**Ledger entries written**: insights.md (2), fails.md (3) — see the 2026-11-10 entries.

**Runtime-invariant recommendations (→ /context-constitution)**:
- **CONFIG — validation order.** `SetConfig` rejects a prefixed key with `INVALID_ARGUMENT` before any authz or grant logic, for every caller. Check that CONFIG-8/9 state this ordering explicitly.
- **PLAT — stored-set regen.** `config-wiring-stored.json`'s `inputs_sha256` hashes every config migration file, so any new config migration needs a stored-set regen in the same commit.
- **PLAT — final-sweep assertions.** The `migration-rerun.sh` final sweep evaluates every slug-named and ≥R assertion against the final state, so assertions must hold after every later migration.
- **CONFIG — probe text contract.** The probe text `SELECT key, is_secret FROM config.config_values`, with `params[1]` = key, is a de facto contract with eight test fakes.

**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at 2d91b5671335fcce267679b50caa494440205f51.

## Retained verbatim records

Operator decisions and C-16 sign-offs copied verbatim from the pre-archive session log, because durable suites and later features cite "<NNN> context.md" as their provenance. Headings are demoted one level.

### Session 2026-11-10 — operator decisions at /sdd-review product-spec (first pass FAIL, fixes applied)

- First `/sdd-review product-spec` pass: FAIL on criterion 9 (3 open questions) and criterion 8 (@AC-5 malformed). No lifecycle change.
- Operator decisions (AskUserQuestion, davcs86, 2026-11-10): FR-6 = **delete all three rows** (`platform`/`log_level`, `trading`/`risk.daily_loss_limit`, `ledger`/`stream.notify_enabled`). Deleting `stream.notify_enabled` is a C-16 CHANGE of 295 @AC-15 and 304 @AC-12: the operator chose delete, but the exact scenario edits still need a fresh sign-off before any step touches those scenarios. `platform`/`log_level` has a UI surface to check at design.
- Spec fixes applied: @AC-5/@AC-1/@AC-2 rewritten as observable outcomes, @AC-6 extended, FR-3 now owns the WARN-free evidence (@AC-7), FR-1/FR-5 made testable, anchors refreshed, deletion-migration strategy stated (next free config number, 047 as of today, shared with 280), the done ledger-parenthetical task dropped, open questions closed or moved to design.
- Overlap note (feature-overlap): merge-order row 305/306/280 does not yet name `dormantAlias.test.ts` or the `047` owner; not edited (operator decision pending).

### Session 2026-11-10 — sdd-design: C-16 batch sign-off (operator, verbatim) and gate decisions

- **C-16 batch sign-off** (AskUserQuestion at the design gate, operator davcs86, 2026-11-10). Question: "Do you sign off on ALL of these changes to durable scenarios, recorded verbatim with your handle/date in context.md? REAL EDITS: 295 @AC-15 and 304 @AC-12 (drop the 'stream.notify_enabled still exists/kept' Given/Then; read-key recording stays). DATED READ-NOTES (scenario text untouched): 296 @AC-3/@AC-4/@AC-5 (alias retired), 295 @AC-34 (+amend the existing line-11/13 notes with a feature-306 clause), 241 @AC-2 and 294 @AC-54 and 295 @AC-25 (request key becomes 'trading_state'; these files say do-not-edit, so the note is a hand edit you are authorising), platform.feature 278 @AC-1, 278 @AC-7, 296 @AC-24 Then 1, 295 @AC-19 (:1440), and 305 @AC-1 scoped CHANGE (306 deletes three operator-decided rows by key, without read-evidence/sha)." **Answer: "Sign off on all (Recommended)".**
- Same gate, second question (design approval): the operator chose **"Run another round"** (no steering note). Round 3 follows; design.md is not yet written; status stays `spec-ready`.
- Operator decision earlier (2026-11-10): predicate delete (no sha) with 305 @AC-1 handled as the scoped CHANGE above; FR-6 = delete all three rows.
- Round 1 and 2 adversary: no Floor breach. Resolved so far: 305 @AC-1 (sign-off), read-notes for 241/294/295 @AC-25, @AC-5/@AC-6 rewording, evidence = zero-count + positive control + trading image ancestry, rel() both sides, real-data dry-run (5 rows on dev/fresh DB, <=6 by index), slug-named assertion file. Open from round 2 (carried into round 3): seed-loop expression at check-config-wiring.mjs:611-621 must keep 296 @AC-6/@AC-22 semantics; unit B size and its offline verification (F-05 residual: CI on the draft PR is the proof); fake `perUserSecrets.test.ts:73-94` fixed rather than production SQL; report global-secret rows as out-of-scope.

_From: Session 2026-11-09 — cross-feature note from 305 design (docs-only)_

- Operator decision recorded in `305-config-dead-rows-prune/context.md` (design gate, AskUserQuestion, davcs86, 2026-11-09): the `seeded-unread` baseline entry `ledger` / `stream.notify_enabled` is **re-owned from feature 305 to this feature**. 305 keeps the row (the operator declined the C-16 CHANGE of 295 @AC-15 / 304 @AC-12), so 305 can never close the entry.

_From: Session 2026-11-09 — cross-feature note from 305 design (docs-only)_

- Ordering: 305 merges before FR-6 closes here (otherwise 305's AC-8/AC-10 "still present / still exists" would go red). A delete of this row is a C-16 CHANGE of 295 @AC-15 and 304 @AC-12 and needs fresh operator sign-off. `membership()`'s `/^feature (305|306)\b/` regex and the baseline-3 `/^feature (305|306)$/` exemption already cover 306; once 305 has no entries the `305` branch is live only through the gate-7 fixture — a cleanup that fits this feature (it edits the same files).

_From: Session 2026-11-10 — sdd-review product-spec (second pass)_

- Recommended design depth: full (3 services, reversible data migration, C-16 CHANGE, shared gate files).

_From: Session 2026-11-10 — sdd-design (approved)_

- Phase 1 Grilling: 3 rounds (full). Chosen approach: five units (Step0 evidence; A server; C gate; D agent; B predicate-delete migration + baseline, atomic, CI-verified; E docs + signed C-16). Rejected: sha allowlist, wholesale `resyncAll` removal, `SELECT is_secret` probes, seeded-unread for prefixed-only reads.

_From: Session 2026-11-10 — sdd-design (approved)_

- Operator approval at the gate: AskUserQuestion "Approve this design" (davcs86, 2026-11-10); C-16 batch sign-off recorded above.

_From: Step 12 — Signed C-16 scenario edits and read-notes [done]_

- Applied exactly the batch signed 2026-11-10 (davcs86; verbatim in "sdd-design: C-16 batch sign-off" above). Real edits: ledger 295 @AC-15 (Given and "still exists" Then dropped, retitled "Ledger records the runtime reads of its config keys"; the feature narrative line now reads "recorded for each key the service reads") and 304 @AC-12 (kept-row Then and the bound-test (c) comment dropped). Dated read-notes: config `fix-config-keys-drift.feature` (amended the existing `:11` poller note, 295 @AC-25 exact grant key, and `:13` @AC-34 now says the probe and ambiguity branch were removed), `fix-config-keys-contract.feature` header (296 @AC-3/4/5 retired; consumers older than 304 are not a supported rollback target), `config-dead-rows-prune.feature` (305 @AC-1 scoped CHANGE), `fix-config-audit-author-spoof.feature` (241 @AC-2 display FQN), `signal-map-instrumentation.feature` (294 @AC-54), and `platform.feature` (295 @AC-19 `:1440` extended; one block under the 296 pre-approved-CHANGE list for 278 @AC-1, 278 @AC-7, 296 @AC-24 Then 1, 295 @AC-25).

_From: Step 12 — Signed C-16 scenario edits and read-notes [done]_

- PRESERVE scenarios untouched (no scenario text outside the two ledger scenarios changed). Verification: `! grep -E "still exists|still kept"` on the two ledger files clean; the `feature 306, operator-signed C-16` notes present in the config suites and `platform.feature`; sign-off and delete-decision greps hit `context.md`; `--doc-check` 0.

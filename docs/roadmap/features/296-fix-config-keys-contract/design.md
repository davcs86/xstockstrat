# Design: fix-config-keys-contract

**Created**: 2026-11-07
**Rounds**: 5 (full; termination: approved at the cap. The round-5 adversary verdict was APPROVE WITH LISTED FIXES, all folded in below. The F-01 Floor item raised in round 2 was resolved in round 3 and re-verified in rounds 4 and 5.)
**Approved by**: davcs86 @ 2026-11-07 (context.md, round-5 gate)
**Grounded in**: recon.md, plus code re-verified in each round (cites below). Tree `ccr-e901c541-u0cmts@79435f9 ≡ origin/main-dev`.

Scope: **Release B (contract)** of the config-key canonicalisation, as the **contract PR** of a four-feature split (operator decision, round 2):

| Feature | Scope |
|---|---|
| **296** (this) | R (rename) + R+1 (CHECK) migrations, FR-1 server rejection + poller exception, FR-4 rollout/rollback, FR-5 gate (`prefixed-read`), FR-6 display, contract documents (C-05 wording flipped here), durable-suite supersession notes |
| **304** (new, `/sdd-story`) | FR-2: consumer literal rewrite in the 11 services + their tests, service banners/tables, caveat removal, empty-baseline close-out |
| **305** (new, `/sdd-story`) | FR-9: evidence-gated dead-row deletion (5 tuples) |
| **306** (new, `/sdd-story`) | FR-8: alias, write-tolerance, poller-exception and gate alt-path removal |

Letters in this document: **B = 304, C = 305, D = 306** (reserved 2026-11-07). Placeholders: **R** = rename migration, **R+1** = CHECK migration (each takes the next free config number at the 296 merge; `043` is last today, so 044/045 if nothing lands first); **cfg_pre = R−1**; **304 305 306** = feature numbers reserved by `scripts/sdd-allocate-feature-number.sh` when the operator runs `/sdd-story` after this approval.

Two helpers are both named `canonical` and do opposite things; this document always qualifies them: **gate `canonical`** (`scripts/check-config-wiring.mjs:664`) returns the full name `ns.key`; **server `canonical`** (`services/xstockstrat-config/src/grpc/authz.ts:96-99`, used at `configServiceImpl.ts:184`) returns the relative key.

---

## Chosen Approach

### 0. F-01 (never edit an applied migration) — how it holds

No recovery path in any feature edits a migration once it is on `main-dev`. Every remaining RAISE is a **data predicate** cleared by a data repair, then `migrate force <n−1>` and `scripts/db-migrate.sh up`, with the file unchanged (the dirty guard prints `force <n−1>`, `scripts/migration-dirty-guard.sh:45-51`; its floor is 40 because of R's `contract-of`, `:22-43`). Embedded data (R's signed allowlist) is protected by (1) a **rolled-back rehearsal of the exact R file on staging immediately before merge**, while R is still editable, and (2) a CI test pinning `sha256(R)` to the value recorded in `signoff.md`. R+1 has no embedded data; feature 305's migration reports problems and never raises; 041 cannot replay after the CHECK (floor refuses `force 0`; 041 latches at `041…up.sql:32`).

### 1. Execution vehicle, ownership, merge order

**Created 2026-11-07: B = feature 304, C = feature 305, D = feature 306.** After this approval the operator ran `/sdd-story` for **B, C, D** (in that order; `.claude/skills/sdd-story/SKILL.md:35-50` reserves the number via the origin cursor ref). All three are `Type: feature` (planned slices of 296's approved contract, created on the operator's explicit direction — context.md round-2 decision 1 — so the bug guard at `SKILL.md:274` is not triggered); each new `context.md` records that provenance. 296 stays `Type: bug`.

Story texts (the exact `/sdd-story` argument):
- **B** `config-keys-relative-consumers`: "Rewrite every consumer's config read to the namespace-relative key (FR-2 of 296), drain the `prefixed-read` baseline to empty, update the 11 service banners/tables and the strat-lab skill, remove the alias caveat from the contract docs, normalise `excluded()` for prefix-catalog rows, and handle `attribute()` stored-set resolution for list receivers."
- **C** `config-dead-rows-prune`: "Delete the operator-signed dead config rows (ledger `stream.notify_enabled`; analysis `opportunity.sparkline_bars`; marketdata `alpaca.paper` — 5 tuples), judged by a small pure evidence evaluator over the 295 `config.read_key`/`config.read_coverage` logs, with snapshot, audit and a reversible down; unmatched tuples are reported, never raised."
- **D** `config-keys-alias-removal`: "Remove 295's legacy spelling alias, the write-time spelling tolerance, the poller canonicalisation exception and WARN, the agent alias filter and the gate's alt/`form-mismatch` path once 304 has launched. **Depends on feature 296** (the AC-12 declaration). Carries the two re-owned baseline entries: `platform/log_level` (UI reader, never provably dead) and `trading/risk.daily_loss_limit` (documented future key: a product decision)."

Baseline ownership after 296 merges (296 owns nothing):

| Entries | Owner |
|---|---|
| every `prefixed-read` (generated, ≈184) | `feature 304` (`PREFIXED_READ_OWNER`) |
| `seeded-unread`: ledger `stream.notify_enabled`, analysis `opportunity.sparkline_bars`, marketdata `alpaca.paper` | `feature 305` |
| `seeded-unread`: platform `log_level`, trading `risk.daily_loss_limit` | `feature 306` |
| `read-unseeded` `trading.broker.paper` | its existing defect entry (`scripts/config-wiring.json:36-41`) |

`OWNER_RE` already accepts `feature ⟨N⟩` (`check-config-wiring.mjs:170`). Merge-order rows (format of `merge-order.md:23-26`; "merge order only" wording as at `:114-115`): **B** waits for 296 (*merge order only — 296 need not be launched*; relative literals read their code default until R has run; coupling during B's window: a feature that declares a key still read prefixed fails its step with `prefixed-read`, `stepTime` `:788-791`, and must rewrite that key's readers in the same step); **C** waits for 296 (*merge order only*; its tuples name relative keys; independent of B — they commute, the only overlap is text in `config-wiring.json`); **D** waits for B and 296, both *launched*, earliest start one staging release after B launches with zero `SetConfig canonicalised internal-caller key` WARNs over that release. B is one feature with one integration PR and one service+test step pair per family (Go trio, Python trio, Node trio, agent, ui); each step's Verification runs `--final` and its `STALE` lines are that step's to-do list.

**Consumer banners contradict the contract until B merges.** From 296's merge until B's integration PR, the 11 consumer `CLAUDE.md` banners (e.g. `services/xstockstrat-trading/CLAUDE.md:84-85`) still state the old rule. `config-governance.md` gets one sentence: during this window C-05 governs and the baseline is the machine-readable truth. The window ends when B rewrites the banners (operator decision 1).

AC-12 holds trivially: D's directory exists from the moment the operator runs `/sdd-story` after this approval.

### 2. Delivery and deploy targets

**Preconditions for 296's integration PR:** (i) git — `040_config_markers` is on `origin/main` (`scripts/check-migration-contract.sh:16-23`, `ci.yml:744`; **satisfied 2026-11-07**: promotion #1472 carried 040, 041 and 043 and 295 is launched — re-verify at execute time); (ii) time — the operator records in context.md that 295's "one full staging release" window has closed (`merge-order.md:26`; 295 decisions 23/24); (iii) sign-off — R rehearsal done at the final rebase (§3.5).

**Every persistent database R will run on:**

| Database | How R runs | On failure | Sign-off treatment |
|---|---|---|---|
| DO staging (dev app) | `db-migrator` `kind: PRE_DEPLOY` (`.do/app.dev.yaml:671-673`) | deploy aborts, previous deployment keeps serving (assumption A4a); config is dirty so **every** later `main-dev` deploy exits 3 until repaired | inventory + rolled-back rehearsal (§3.5) |
| DO production | `PRE_DEPLOY` (`.do/app.yaml:669-671`) | same | no production data in use yet (295 decision 24): recorded fresh by operator confirmation in `signoff.md`; expect exactly 5 `unmatched-signed-tuple` report rows |
| homelab staging/production | compose `db-migrator` (`deploy/homelab/compose.yml:32-37`, `restart: "no"`); `xstockstrat-config` has `depends_on … service_completed_successfully` (`:53-55`); asserted transitively by `deploy/homelab/render-assert.jq:10-12,29`; triggered by `deploy-homelab.yml` (`environment: staging|production`, `:9-23`) | migrator exits non-zero, `--wait` fails for every dependent, workflow fails; dependents not recreated (A4b); next deploy hits the same guard (exit 3) until repaired | fresh by operator commitment: the homelab databases will be in a fresh state when 296 is launched (context.md round-4 decision 2, re-confirmed 2026-11-07); repeated in `signoff.md` at sign-off |
| local compose / CI scratch | `db-migrate.sh up` | a stray twin raises; same repair | none |

**Homelab recovery** (added to `config-rollout.md`): repair the data as DB owner over the tailnet (direct `:5432`, the `x-db-direct` DSN, `compose.yml:11-12`); `migrate force <n−1>` with that DSN; re-run `workflow_dispatch` Deploy homelab with the same `image_tag` (`deploy-homelab.yml:17-27`).

**Rollback:** to 295 images is sound (the 295 server serves both spellings through the alias; its form-tolerant `SetConfig` writes the existing spelling). Rolling back past 295 is forbidden; `config-rollout.md` says so.

### 3. R — rename (`<R>_config_keys_relative.up.sql`)

**Header.** Line 1 is `-- contract-of: services/xstockstrat-config/migrations/040_config_markers.up.sql` (first 5 lines: `migration-dirty-guard.sh:25`, `check-migration-contract.sh:16`). **R is not adjacent to 040** (`fails.md:3173`): the floor is 040, and a recovery that lands below 043 replays 041–043 whose INSERTs recreate prefixed rows (`043…up.sql:11-23`, `system:config-migration-043`) next to the renamed relative rows; R is latched by then, so only R+1 cleans them up. Rerun pass 3 exists to prove that.

**Tables** (`CREATE TABLE IF NOT EXISTS`): `config.config_values_premigration_296` = `(LIKE config.config_values_premigration_041)` + `snapshot_at timestamptz NOT NULL DEFAULT clock_timestamp()`; `config.config_keys_report_296(run_at, action, namespace, key, environment, user_id, reason)` — **never holds a value** (precedent `041…:534`). Actor `system:config-migration-<R>`. **No top-level `BEGIN`/`COMMIT`** (golang-migrate runs the file as one implicit transaction; a CI test asserts this).

**One DO block, in order:**
0. **Latch.** If marker `relative_keys_v1` exists, `RETURN`. The marker INSERT is the only switch that turns the alias on (`configServiceImpl.ts:195-197`).
1. **Lock `SHARE ROW EXCLUSIVE`, bounded retries** (027 idiom, `analysis/027_contract_owner_dimension.up.sql:15-29`). Blocks writers, not readers. **Decision: not `ACCESS EXCLUSIVE`** — a racing `SetConfig` probe is a SELECT (`configServiceImpl.ts:778-782`), unblocked either way; it sees the pre-R prefixed row, so `writeKey` is prefixed (`:818`), its INSERT (`:856-869`) queues behind R and, after R commits, creates a new prefixed row P with the caller's value; R+1 resolves P without loss (§4). `ACCESS EXCLUSIVE` would only stall every `GetConfig`/`ListKeys`/`WatchConfig` snapshot and NOTIFY reload for R's runtime.
2. **Classify** every row into temp `cls_296`: `prefixed` = `left(key, length(namespace)+1) = namespace||'.'` (`041…:311-313`; never `LIKE`); `rel` = single-stripped key; scope = `(ns, env, COALESCE(user_id,''))`.
3. **Per-user parking** (D3), computed on the pre-state — **final rule after round 5 (B-1)**:
   - **S1 (selector).** Every still-present `per-user-unread` row of **any** 041 run in `config.config_heal_report_041` (matched on ns, key, env, user_id; no `run_at` filter, because rerun pass 2b re-runs 041) is **parked**. This covers the known staging row `analysis`/`fundsignal.min_conviction_to_emit` (user_sha `73833c35…`, `scripts/config-heal/report-staging-041.jsonl:25`, `dryrun-staging.tsv:2`) which sits beside a global twin 041 kept (`report-staging-041.jsonl:26`, `signoff.md:21-23`).
   - **(a)** A per-user **relative** row created **after** `max(run_at)` of 041 (or any, when the report table is empty) is parked if a global **prefixed** row `ns.X.key` exists — **whether or not a global relative row exists**. After 041 a 295 `SetConfig` cannot create a per-user relative row in a twin scope (the global probe returns two rows and the write is refused as ambiguous, `configServiceImpl.ts:786-809`), so this parks nothing live.
   - **(b)** A per-user **prefixed** row created after `max(run_at)` is parked if a global relative row exists **and no global prefixed row** exists.
   - Otherwise a prefixed per-user row is renamed and a relative one is left alone.
   - **Oracle** (any 041 run): a row selected by (a)/(b) that pre-dates `max(run_at)` and is not in a report row is `oracle-mismatch`.
   - A parked row is snapshotted with its value, deleted with an audit row (`new_value NULL`, reason `feature 296: parked per-user row in an unread spelling`), and reported as `per-user-parked` with no value. Its effective value is unchanged, so 295 `@AC-5` ("not silently applied") holds in spirit; the durable scenario's Then ("survives unchanged") is superseded by a note (§8). A parking candidate that `is_secret` is the violation `secret-parked-candidate`; R never auto-deletes a secret.
4. **Twin classification, per twin** (two rows in one scope, spelled `k` and `ns.k`). `allow_296(namespace, key, environment, user_sha256, value_sha256)` sits verbatim between `-- allow_296:begin/end`, copied from `scripts/config-heal/allow-296-signed.sql`, inserting only into `pg_temp.allow_296`. A tuple names the **loser** by stored spelling + `encode(sha256(convert_to(value_data,'UTF8')),'hex')` (`041…:373`). A tuple is attached to a twin when its scope matches and its key is one of the twin's two spellings:

   | Attached tuples | Outcome |
   |---|---|
   | none | `uncovered-twin` |
   | exactly one, matching spelling **and** hash of the same member | that member loses |
   | exactly one, not matching either member on both spelling and hash | `stale-signature` |
   | more than one | `ambiguous-signature` |

   A tuple attached to no twin is **reported** (`unmatched-signed-tuple`), never raised. The 5 signed tuples are staging scopes (`signoff.md:21-23`), so fresh, CI, production and homelab databases report exactly 5. (`per-user-twin-unsigned` is dropped: a per-user twin is simply a twin in a per-user scope.) Matching is on (loser spelling, hash), never hash alone (equal-valued twins) nor spelling alone (a "prefixed loses" tuple would raise on every fresh DB).
5. **One RAISE before any write, fixed format.** Violations are collected into temp `viol_296(rank, class, ns, key, env, per_user)`; each (ns, rel-key, env, scope) contributes **one line carrying its highest-precedence class**: 1 `secret-class-twin` · 2 `secret-parked-candidate` · 3 `double-prefix` · 4 `oracle-mismatch` · 5 `ambiguous-signature` · 6 `stale-signature` · 7 `uncovered-twin`. Message `feature 296: <N> violation(s); nothing changed` then lines `<class> <ns>/<rel-key>/<env>[ (per-user)]` sorted `ORDER BY rank, ns, key, env`. No value and no user id ever appear.
6. `ALTER TABLE config.config_values DISABLE TRIGGER config_value_audit` (trigger `001…:49-51`; its live function sets `NEW.updated_at = NOW()` unconditionally, `017…:66-79`; the migrator owns the table, `017…:37,40`; transactional, so a later RAISE re-enables it). This preserves "Row last modified" in ListKeys/config-ui (feature-219 guarantees; `configServiceImpl.ts:889-908`).
7. **Snapshot** every row about to be touched (renamed, loser, parked); secret-class values NULL (`041…:316-327`); `snapshot_at = clock_timestamp()`.
8. **Delete losers** (one statement): `WITH d AS (DELETE … RETURNING) INSERT INTO config.config_audit` with `changed_at = clock_timestamp()` (`041…:380-390`).
9. **Rename, a separate statement** (the unique index `config_values_scope_uniq`, `017…:101`, is non-deferrable and per-row): `UPDATE … SET key = substr(key, length(namespace)+2) RETURNING` → one audit row per rename, `old_value = new_value = value_data` (NULL for secrets), reason `feature 296: renamed from <old>`; `updated_at`, `updated_by`, `value_encrypted` untouched (the cipher has no associated data, `crypto.ts:31-53`).
10. `ENABLE TRIGGER`; assert no prefixed row remains.
11. **Marker:** `INSERT INTO config.config_markers(name,set_at,set_by)` `('relative_keys_v1', now(), 'system:config-migration-<R>')` (`040…:2-6`; the column is `set_by`).
12. **Notify:** one `pg_notify` per touched (ns, env) (`041…:539-540`) plus `{"marker":"relative_keys_v1"}`. Delivered at commit; each (ns, env) gets exactly one new content version (`contentVersion` hashes aliased values; the marker `resyncAll` re-delivers the same version, `configServiceImpl.ts:401-410,424-429,501-502`).

**Down:** `RAISE EXCEPTION 'irreversible contract: feature 296 renamed config keys to namespace-relative'` (matches `migration-rerun.sh:232`). R contains no config-key string literals outside the allow block; its only `INSERT INTO config.config_values…` is the snapshot `INSERT … SELECT`, so the migration-text tests (`retiredPortfolioSnapshotInterval.test.ts:37-61` and siblings) stay green.

### 3.4 Recovery table

Every row ends with `migrate force <n−1>` + `db-migrate.sh up` (homelab: a re-run deploy). Files are never edited. Repairs follow `docs/runbooks/operator-db-access.md` (DB-owner `psql` `:32`, explicit transaction `:57`), and every hand-deleted row gets a hand-written audit row (`new_value NULL`).

| Raised by | Class | Data repair |
|---|---|---|
| R | `uncovered-twin` | delete the duplicate the code does not read; record it in `signoff.md` |
| R | `stale-signature` | restore the signed value (old value is in `config_audit`) or delete the drifted twin |
| R | `ambiguous-signature` | delete one member by hand |
| R | `secret-class-twin` | delete the plaintext twin (`old_value NULL`) |
| R | `secret-parked-candidate` | delete the stray per-user secret row after the owner confirms the effective secret, or rename it by hand to the spelling the code reads |
| R | `double-prefix` | rename the row by hand to its single-prefixed spelling, or delete it |
| R | `oracle-mismatch` | park (delete with audit) or keep the named per-user row by hand so the oracle and the rules agree |
| R+1 | mixed-class gap twin (exactly one member `is_secret`) | delete the plaintext member |
| R+1 | CHECK `ADD` fails 23514 (doubly-prefixed row) | same as `double-prefix` |
| R or R+1 | lock timeout | none; re-run |
| none | the signed direction proves wrong after R ran | **no migration**: an audited `SetConfig` of the relative key sets the intended value; the loser is preserved in `config_values_premigration_296` |

### 3.5 R sign-off and rehearsal (final step of 296's implementation spec; also a `config-rollout.md` section)

Run on the operator workstation after the last rebase and renumber (the actor string is inside R, so renumbering changes R):
1. Run `config_inventory.py` against DO staging (tool sha as `signoff.md:5-6`).
2. Write `scripts/config-heal/allow-296-signed.sql`, paste it verbatim into R, render R with `scripts/render-migrations.sh` (no `requires-env` header, so the file is copied byte-for-byte, `render-migrations.sh:23-30`).
3. **Rehearse under the PRE_DEPLOY role** (the direct db-migrator URL): `psql -v ON_ERROR_STOP=1 -c 'BEGIN' -f <rendered R> -c "SELECT action,count(*) FROM config.config_keys_report_296 GROUP BY 1" -c 'ROLLBACK'`; must finish with no RAISE. (`pg_notify` and the marker are not delivered on rollback; readers are unaffected.)
4. **Regenerate the stored set:** `DATABASE_URL=<scratch postgres> bash scripts/config-wiring-stored.sh` (pasting the block or renumbering changes `inputs_sha256`, `check-config-wiring.mjs:225-230` → `STALE-STORED` `:711-714` → `config-wiring.test.mjs:490`).
5. Record "Feature 296 — R sign-off" in `signoff.md`: inventory sha, block sha, **R file sha256**, rehearsal output + timestamp, DO production and both homelab databases recorded as fresh by operator confirmation, operator name and date.
6. Run `node --test scripts/config-wiring.test.mjs` and `--final`; both green; merge.

CI test `services/xstockstrat-config/src/__tests__/relativeKeysMigration.test.ts`: (a) `sha256(R)` equals the sign-off value; (b) R has no statement matching `^\s*(BEGIN|COMMIT|ROLLBACK)\s*;`. (A third check "R contains the allow block verbatim" was dropped as implied by (a) once the sign-off is recorded.)

### 4. R+1 — CHECK (`<R+1>_config_keys_relative_check.up.sql`) — final rule (operator decision, round-5 gate)

No `contract-of`, no embedded data; idempotent.
0. **Lock `ACCESS EXCLUSIVE`, bounded** (027 idiom); `ADD CONSTRAINT … CHECK` needs it anyway.
1. **Classify** prefixed rows. A **gap twin** = a prefixed row P plus a relative row Rel in one scope.
2. **Violations before any write.** The only one: a gap twin where **exactly one** member `is_secret` (`P.is_secret <> Rel.is_secret`) → one RAISE naming `<ns>/<key>/<env>`. A racing write takes `is_secret` from the pre-R row (`configServiceImpl.ts:832-837`), so a race twin is both-secret or both-plain; a mixed twin cannot come from `SetConfig`. A **both-secret** twin is resolved by the rule below with audit values NULL (rename is safe for ciphertext; no AAD).
3. **Decide each gap twin — newest write wins:**
   - If `P.updated_by IS NULL OR P.updated_by LIKE 'system:%'` → migration-written (`SetConfig` always writes a non-empty author, `:738-742`; 001 and 042 seed without one) → **P loses**; report `gap-twin-system-deleted`.
   - Otherwise compare `updated_at` (R kept Rel's original; one DB clock): **`P.updated_at >= Rel.updated_at` → P wins** (ties to P): Rel is deleted, P renamed onto Rel's key; report `gap-twin-p-wins`. **Else Rel wins** (a write landed on Rel after P): P deleted with audit; report `gap-twin-rel-won`.
   - Why this is true last-writer-wins: Rel's `updated_at` stays at its original write time (R disables the trigger); a racing P's `DEFAULT NOW()` is the start of a statement that queued during R, so it is later than Rel's original; a post-R write to Rel (the probe sees only Rel after R commits, `:778-793`) stamps a later `NOW()` than P's. So the newest write wins in the race window, and also in the out-of-band `psql` case (when it uses default timestamps).
4. **Snapshot** every loser and every row to be renamed into `config_values_premigration_296`.
5. **Statement 1, DELETE the losers** with audit rows (`changed_by 'system:config-migration-<R+1>'`, `old_value` = the value, NULL for secrets, `new_value NULL`; reasons `feature 296: gap twin, superseded by newer write to <winner key>` / `feature 296: gap twin, migration-seeded prefixed row`).
6. `DISABLE TRIGGER config_value_audit`.
7. **Statement 2, a separate UPDATE:** rename every remaining prefixed row (winning P's and lone gap rows), one audit row per rename, `updated_at`/`updated_by` kept. Separate from statement 1 because `config_values_scope_uniq` is checked per row (Rel must be gone before P takes its key).
8. `ENABLE TRIGGER`; assert no prefixed row remains.
9. `ADD CONSTRAINT config_values_key_relative_check CHECK (left(key,length(namespace)+1) <> namespace||'.')` if absent. A doubly-prefixed row fails here with 23514 (recovery-table row).
10. Notify each touched (ns, env). **Down:** `DROP CONSTRAINT IF EXISTS`.

**Racing `SetConfig` end to end (during R):** (1) probe before R commits sees `ns.k` (MVCC) → `writeKey = ns.k`; (2) its INSERT queues behind R's lock; (3) R commits, the queued INSERT (ahead of R+1, which has not started) inserts P with the caller's value/author (`caller_identity` set for the poller), fires the insert-audit trigger and NOTIFY, caller gets OK; (4) with the marker set, prefixed readers get P (a stored spelling wins over the alias, `:213-221`), relative readers get Rel; before B every consumer reads prefixed, so a poller `REDUCE_ONLY`/`HALTED` takes effect at once; (5) R+1 runs: P is non-system and newer than Rel → Rel is deleted and P renamed onto `k`; (6) if the INSERT only reaches the queue after R+1 holds its lock it hits the CHECK and returns `INVALID_ARGUMENT` (23514 → code 3, `:876-877`) — nothing is written and the caller sees an error. R and R+1 run in one PRE_DEPLOY, so this case no longer leaves the database dirty.

### 5. FR-1 server and FR-6 display

**`setConfig` (`configServiceImpl.ts:680`).** The first statement, before authz (`:688-732`), rejects a prefixed key: code 3 (`INVALID_ARGUMENT`), message `config key must be namespace-relative: send "<rel>" with namespace "<ns>" (got "<key>")`, built with the **server** `canonical`. `create_key` is the `createKey` flag on the same path (`:773`), so it is covered.

**Poller exception.** Canonicalise the key in place with the WARN `SetConfig canonicalised internal-caller key {internalCaller,namespace,from,to,targetState}` only when all hold: `x-internal-caller === 'trading-reconciliation-poller'`; `namespace === 'platform'`; server `canonical(...) === 'trading_state'`; global scope; `!createKey`. The grant (`authz.ts:84-93`; no `peerSan` — secret grants only) and its `REDUCE_ONLY|HALTED` restriction are unchanged, so `@AC-54` @feature-294 holds (the poller exception still ends in `PERMISSION_DENIED` for `ACTIVE`).

**Other server changes:** `GetSecret` gets the same prefixed-key pre-check before `hasSecretCallerAuthority` (`:637`), no exception (marketdata/ingest/agent/UI callers already send relative keys: `marketdata/cmd/server/main.go:79,293`, `ingest/app/config/watcher.py:22-24`, `agent tools.py:375`, `useSignalSourceMutations.ts:23`); the log literal at `:709-710` becomes server `canonical(...) === 'trading_state'`; the stale text at `:813` ("must be healed first (feature 296)") is updated. **The write tolerance (`:774-818`) stays as dead code until 306.**

**FR-6 config-ui (C-14 consumer surface):** `configFqn(ns,key)` in `src/lib` (`key.startsWith(ns+'.') ? key : ns+'.'+key`), used by `KeyCell` (`NamespaceEditor.tsx:66`) and the audit page (`audit/page.tsx:41`, so old prefixed audit rows do not render `ns.ns.key`); the reason guard at `:264` becomes `namespace==='platform' && key==='trading_state'`; test ids `actions-${k.key}` (`:155`) change. `ListKeys` returns the stored relative key; the server and proto are unchanged (the relative key round-trips: `NamespaceEditor.tsx:271-279`).
**FR-6 agent (C-14 consumer surface):** `list_config_keys` (`tools.py:1808`) adds `fqn` and keeps `key`; `get_config` (`:1776`) drops alias entries that start with `${ns}.` (while the CHECK holds only the alias can produce them, `:501`); the `set_config` docstring (`:1846`) and `docs/runbooks/mcp-tools.md:1204` become relative.
**Accepted:** an old or rolled-back UI image skips the reason guard (UX only; the server enum check and audit still hold).

### 6. Gate changes in 296 (`scripts/check-config-wiring.mjs`)

`join()` seeded loop (`:610-619`) becomes:
```
const relSeed = !s.key.startsWith(`${ns}.`)
for (env of s.envs) cover(nk(ns, s.key), env)
if (relSeed) for (env of s.envs) cover(nk(ns, `${ns}.${s.key}`), env)   // narrow hoist
if (byKey.has(nk(ns, s.key))) continue
const readKey = partnerOf(ns, s.key)
if (readKey === null) push seeded-unread
else if (!relSeed) { cover(nk(ns, readKey)); push form-mismatch }        // inverse direction only
```
The hoist is **narrow on purpose**: a prefixed seed with a relative read must stay visible (before R the alias is dormant, `configServiceImpl.ts:195-197,501`, so that relative read returns its code default); this keeps "B's relative reads cannot land in a tree without R". (Round-3 orchestrator instruction to drop the `form-mismatch` special case was wrong; the adversary settled it: reclassifying the prefixed-read direction one-for-one into `prefixed-read` is correct and keeping both kinds would double every finding, ≈2×184 entries.)

**Reads loop (`:623-629`).** Push `{kind:'prefixed-read', namespace, key:<prefixed>, file:<min reader file>}` when `e.key.startsWith(ns+'.')` **and** `seeded.has(nk(ns, e.key.slice(ns.length+1)))` **and** `!excluded(ns, e.key)`; one finding per (ns, key). **Row checks (`:634-649`)** accept either spelling (`s = seeded.get(id) ?? seeded.get(nk(ns, alt(ns,e.key)))`; `catalogIds`/`flaggedIds` under either spelling). `prefixed-read` is not in `ROW_KINDS`; finding line `<file>:<prefixed key>:prefixed-read`. `BASELINE_KINDS` (`:169`) gains `prefixed-read`; `validateState` (`:176-203`): a `prefixed-read` entry whose owner is not `PREFIXED_READ_OWNER='feature 304'` is a schema error (exit 2); `GATED_UNLESS_BASELINED` unchanged (`--final` blocks through `ratchet`, `:695-709`; step mode only blocks declared keys, `stepTime` `:786-791`, so no more is claimed); `membership()` owner filter (`:718`) becomes {`feature 305`, `feature 306`} and compares `nk(ns, gate canonical(ns,key))` on both sides. **Comment fixes:** `:578` → "Readers join rows by (namespace, key); a prefixed read also matches its relative seed (narrow hoist), and checks beyond presence apply to catalog-read rows only."; `:716` → "Every feature-305/306-owned seeded-unread entry must be an unread-no-partner row of the committed fresh dry-run." **Doc constants:** `export const DOC_RULE_SENTENCES = ['the stored key is namespace-relative','every read key is seeded','the fqn is display-only','the prefixed spelling via the alias until']`; `DOC_BANNED` adds `/the stored key equals the reader's exact spelling/i` and `/cutover in feature 296/i`; scan scope stays `DOC_RULES` (`:761-765`), so the 11 consumer banners do not break `--doc-check`. **Accepted gap:** `readers-disagree` (reported-only, `:690`) cannot see a cross-spelling disagreement during B's window; recorded in `config-governance.md` and B's spec. `excluded()` normalisation for prefix-catalog rows and the `attribute()` list-receiver resolution (zero matches stays `null`, 295's deliberate "no default", `:545-551`) belong to B.

**Findings per case** (A = a relative reader, P = a prefixed reader):

| # | Case | Findings | Fixture |
|---|---|---|---|
| 1 | relative seed, read `ns.k` only | 1 `prefixed-read` | `join/mismatch` line 2 |
| 2 | relative seed, relative read | none | `join/negative-matches` |
| 3 | relative seed, A and P both read | 1 `prefixed-read`, no `read-unseeded` | new `join/prefixed-read` row (a) |
| 4 | prefixed read, unseeded | `read-unseeded` | unchanged |
| 5 | relative seed, no read | `seeded-unread` | unchanged |
| 6a | secret row read prefixed | none | row (c) |
| 6b | prefix-catalog key read prefixed | none | join 8 + row (c) |
| 7 | relative seed in production only, read prefixed | `prefixed-read` + `read-unseeded:staging` | row (b) |
| 8 | list receiver | unchanged (B's job) | none |
| 9a | prefixed seed, relative read | `form-mismatch` | `join/mismatch` line 1 |
| 9b | 9a plus a prefixed reader | `read-unseeded` for the relative read | row (d) |
| 10 | `main-dev` today | the 5 `seeded-unread` + 1 defect entry | baseline 1 |

**Baseline** is generated: `node scripts/check-config-wiring.mjs --final --json`, filtered to `prefixed-read`, entries without `file` (so a key read by two families goes `STALE` only when its last reader is rewritten), owner `feature 304`; the command is recorded in context.md. The 5 `seeded-unread` entries are respelled relative and re-owned to C or D.

**Gate test edits (`scripts/config-wiring.test.mjs`)**: join 1 (`:157-164`) new title, line 2 becomes `prefixed-read`; `ANALYSIS_MISMATCH` (`:221`) becomes the `prefixed-read` line (ratchet 4, 6, 9); ratchet 4 retitled (`:304`); baseline 2 (`:480-491`) kind list gains `prefixed-read` + owner assertion (`:490` staleness satisfied by sign-off step 4); baseline 3 (`:508-512`) owner filter → C/D; gate 7 (`:456-467`) fixture owner → `feature 305` (and `scripts/config-wiring-fixtures/gate/membership/scripts/config-wiring.json:7`); **doc 1** (`:603`, `:612-620`) imports `cw.DOC_RULE_SENTENCES` instead of its own `RULE_SENTENCES`; new join 9 (AC-22, AC-24) and ratchet 10 (AC-23) with new root `scripts/config-wiring-fixtures/join/prefixed-read/`. Unchanged by inspection: reader a–l; join 2–8; ratchet 1–3, 5, 7, 8; gate 1–6; skill 1–4; doc 2–5 (CONTRACT string kept verbatim; `doc 4/5` at `:650-668` pin it).

### 7. `scripts/migration-rerun.sh` reshape

**Deriving R:** the single `*.up.sql` whose first 5 lines carry `contract-of: …040_config_markers.up.sql`; exactly one match asserted, else exit 1; `cfg_pre = R−1`. **Pass 0** unchanged. **Pass 2b moves before pass 1**, config-only (`migrate goto $cfg_pre`, never `db-migrate.sh up`): (a)(b) `cfg_force 40; migrate goto $cfg_pre; must_be_clean config $cfg_pre` (replacing `:175-176`, `:186-187`); (c) `cfg_force 41`, set dirty, call `scripts/migration-dirty-guard.sh` directly → exit 3, `config is dirty at version 41`, `force 40`, counts/functions unchanged; then `cfg_force 40; migrate goto $cfg_pre; knob_alive`.
**Pass 2c (new, at `cfg_pre`):** (1) run each `config-NNN.sql` with NNN < R (031, 041, 043) unchanged (they assert prefixed rows / forbid stripped rows and `\ir`-replay immutable up-files; valid only at `cfg_pre`, before R and with no CHECK); (2) **real-file AC-18/AC-19 test** on the committed R using `fixtures-pre-041.sql` — the unsigned twin `analysis` `fundsignal.valid_days` (`:37-41`, kept by `config-041.sql:176-183`) and the secret twin (`:42-46`): `migrate … up 1` must fail with exactly the lines `secret-class-twin marketdata/fmp.api_key/staging` and `uncovered-twin analysis/fundsignal.valid_days/staging` in rank order and no value text; `must_be_dirty config R`; counts unchanged, no report rows, no marker; a direct guard call exits 3 with `force $cfg_pre`; repair in one transaction with hand audit rows; `cfg_force $cfg_pre` — proving "data repair + force R−1 + up converges with R unchanged" on the real file; (3) **signed-tuple happy path (AC-9, AC-16, AC-21)** on a `sed` copy of R outside the migrations dir inside `BEGIN…ROLLBACK` (no `-- requires-env`, which would make every production PRE_DEPLOY need a variable, `render-migrations.sh:23,41`): indicators `sandbox.timeout_ms` with the hash of 5000; an equal-valued twin pair; a tuple naming a lone prefixed row → reported unmatched, the row renamed not deleted.
**Pass 1:** `db-migrate.sh up` applies R and R+1; the 295 `@AC-5` row (`u-295`, per-user relative `fundsignal.enabled`) is parked by selector S1/rule (a) (AC-20). **Pass 2:** replay list gains `config:R` and `config:R+1` (no-ops). **Pass 3:** (1) `refuse_down config $cfg_pre R` (R+1's down drops the CHECK, R's down raises, dirty at `cfg_pre`); (2) `guard_blocks config $cfg_pre $((cfg_pre-1))` (forces 42; 043 will replay); (3) insert staging-global fixtures: **F1** operator P newer than Rel (`analysis`/`analysis.backtest.extra_knob`='2', `updated_by 'migration-rerun-operator'` next to relative `backtest.extra_knob`='1' from `:168-170`) → P wins; **F2** poller P newer (`platform`/`platform.trading_state`='REDUCE_ONLY', `updated_by`+`caller_identity`='trading-reconciliation-poller' next to relative `trading_state`) → P wins; **F3** NULL-author P loses (`analysis.backtest.null_knob`='9' vs relative '3'); **F4** system seed P (produced by 043's replay) loses; **F5** operator P **older** than Rel → Rel wins; **F6** both-secret gap twin → resolved by the same rule, audit values NULL, no raise; **F7** mixed-class gap twin → R+1 raises (separate sub-test, then repaired); (4) the recovery `db-migrate.sh up` **must succeed** and end clean at R+1 (`want config:R+1` joins `:265`).
**End loop (`:273-280`):** skip `fixtures-*` and, by rule (not by name), only `config-NNN.sql` files with NNN < R (a bare NNN<R rule would skip `ingest-013`, `analysis-026`). **New `scripts/migration-assertions/config-<R>.sql`:** AC-8 (no prefixed row; marker `set_by`; `snapshot_at` < rename audit `changed_at`), AC-15 (CHECK present), AC-16 (renamed `updated_at` equals its snapshot), AC-17 (F1–F6 outcomes: values, `updated_by`/`caller_identity`/`updated_at` of winners, exactly one delete-audit and one rename-audit row per winner with delete before rename, report rows `gap-twin-p-wins`×2 / `gap-twin-rel-won` / `gap-twin-system-deleted`, `config_value_audit` enabled `pg_trigger.tgenabled='O'`), AC-19 (repair audit row), AC-20 (`u-295` absent, snapshotted, reported), AC-21 (exactly 5 `unmatched-signed-tuple` rows).

### 8. Test blast radius outside the gate (the 295 trap, `fails.md:3660-3679`)

S1 = R + assertions; S2 = R+1; S3 = FR-1 server + config tests; S4 = FR-6 ui + tests; S5 = FR-6 agent + tests; S6 = gate; S7 = rerun; S8 = documents + durable suites; S9 = sign-off (renumber-touched files: R/R+1 file names and actor strings, the allow block, `scripts/config-wiring-stored.json`, `scripts/migration-assertions/config-<R>.sql`, `relativeKeysMigration.test.ts` — all listed in S9's Files, F-08).

**`services/xstockstrat-config/src/__tests__/`** (regex ≈107 hits in 23 files; re-grep at spec time): `setConfigScalarBounds.test.ts` (32; the readiness_materializer block `:151-175` and opportunity block `:208-246` send full-dotted keys on purpose → respell relative, comments rewritten; `TIMEOUT_KEY_FORMS` `:266-302` prefixed rows removed, one test asserts each prefixed form gets `INVALID_ARGUMENT` before any bounds check) S3; `setConfigSpelling.test.ts` (20; `@AC-1` `:154` rewritten — signed CHANGE; `@AC-25/31/34` request keys respelled; new tests: FR-1 message, poller exception + WARN) S3; `setConfigAuthz.test.ts` (3; `:144`→`log_level`, `:238`→`push.min_severity`; `:179` stays — `@AC-54`) S3; `tradingStateValidation.test.ts` (3; `:74`→`trading_state`) S3; `internalCallerSetConfig.test.ts` (1; request `:71` stays prefixed; add INSERT param `[1]==='trading_state'` and WARN assertions) S3; `configServiceImpl.test.ts` (3; `:555`, `:647` respelled; `:119` mocked stored row unchanged) S3; `scopeResolution.test.ts` (`:93` sends a real prefixed `setConfig` → respell `fmp.enabled`; found in impl-spec review cycle 2) S3; `dormantAlias.test.ts:109-116` (rewritten: exactly one config migration inserts into `config_markers` and it carries `contract-of …040`) S1; `relativeKeysMigration.test.ts` new S9. Unchanged (mocked stored rows / read side): `listKeysUpdatedAt`, `listKeysCurrentValue`, `configValueRoundtrip`, `watchConfigWireZero`, `contentVersion`, `readUserBinding`, `changeFeedLiveness`, `listKeysWire`, `internalCallerAuthz`, `configWatcher`, `secretCallerAuthz`, the five seed-migration tests (R/R+1 contain no key literals). `configListenerTelemetry.test.ts` (10) and `telemetryAllowlist.test.ts` (4) regex hits are metric names — confirm by grep at spec time.
**`services/xstockstrat-agent/tests/`:** `test_config_tools.py` (12; `:56-81` GetConfig values respelled relative or the new alias filter drops them; request keys `:107,114,129,147,165,230,247,443` respelled; new tests: alias filter, `list_config_keys` returns `fqn`) S5; 15 other files' hits are not config-key literals — confirm at spec time; any real consumer read goes to 304.
**`services/xstockstrat-ui/`:** `e2e/fixtures/configKeys.ts` (15; respelled relative, C-12 home) S4; `e2e/fixtures/INVENTORY.md` rows 51-53 S4; `e2e/config-ui/api-smoke.spec.ts` (8, raw ListKeys JSON) S4; `namespace-editor-rows.spec.ts` (2, test ids `:119,128`) S4; `reason-capture`, `namespace-nav`, `value-persists-after-save`, `secret-editing` specs (`hasText:'<fqn>'` still matches; any `getByTestId(actions-…)` or request-body use respelled — verify per line) S4; `src/lib/configFqn.test.ts` new (vitest) S4; `src/lib/configUiBff.test.ts` unchanged. **B owns:** `e2e/mock-backend.ts:1547` and `e2e/trader/positions-reconciliation.spec.ts:119` (trader-segment consumer reads of `platform.trading_state`).
**Also:** `scripts/integration-test.sh:516-552` sends prefixed `platform.maintenance_mode` `SetConfig` (a script no longer wired into CI) — mark it superseded or move it to 304 at spec time; `docs/runbooks/config-rollout.md:246` ("Until feature 296 gives config a contract floor") is rewritten (S8).
**Durable suites (S8; C-16 CHANGE signed off).** Promoted scenarios are not rewritten; 296 adds a supersession comment block per suite in the form of `docs/sdd/business-rules/platform.feature:1437-1449`: `services/xstockstrat-config/acceptance/fix-config-keys-drift.feature` (**header `:6` rewritten** to "a stored key is namespace-relative (the FQN is display-only), every read key is seeded, heals never destroy intent silently, and secrets are never printed"; notes for 295 `@AC-1/14/20/21/25/26/28/34`, plus **`@AC-5`** — "survives 041; 296 R parks it with snapshot and report; the effective value is unchanged" — and **`@AC-33`** — "the CI fixture twin is deleted by the R repair, never by a migration"); `platform.feature` (295 `@AC-19`, `@AC-20`); `services/xstockstrat-config/acceptance/config-ui-usability.feature` (219 `@AC-6/7/13`); `services/xstockstrat-ui/acceptance/config-ui-usability.feature` (`@AC-8/12`); and, found by grep, the suites carrying `@feature-243/182/184/281/282/293`: `services/xstockstrat-config/acceptance/{fix-sandbox-seed-keys,readiness-materializer-config-keys,opportunity-config-operability,signal-watchlist-expiry-pruning,fix-analysis-live-loop-budget-seed,filter-otc-symbols}.feature`, `services/xstockstrat-indicators/acceptance/fix-sandbox-seed-keys.feature`, `platform.feature` (4 tags) — only the signed IDs get notes. **304 owns** every consumer service's own suite and 295 `@AC-15`.

### 9. Documents

Each 296 document carries: "the stored key is namespace-relative; the FQN is display-only; every read key is seeded by a config migration; readers may still use the prefixed spelling via the alias until feature 304's baseline is empty."
**Contract documents (296):** C-05 (`docs/sdd/constitution.md:36`); CONFIG-9 (`services/xstockstrat-config/docs/context-constitution.md:26`) and CONFIG-8 (`:25`); `docs/patterns/config-governance.md:64-75` (plus a registered-keys log note, the step coupling, the readers-disagree gap, the banner-window sentence — and check `DOC_BANNED` against historical log lines in that file); PLAT-14 (`docs/context-constitution.md:52`); root `CLAUDE.md:161`; `services/xstockstrat-config/CLAUDE.md:111-112`; `docs/runbooks/config-rollout.md` (rule `:31-33`, wording `:221`, examples `:98,121,275,292` fixed once by hand; rolling back past 295 forbidden; old-UI guard note; dirty ≥ 40 means `force <n−1>`; the R sign-off; a per-platform failure section — DO PRE_DEPLOY vs homelab compose, a failed staging deploy blocks every `main-dev` deploy, local compose raises on twins); `docs/runbooks/mcp-tools.md:1204`; authoring documents (CONTRACT string verbatim): `.claude/skills/sdd-review/reference/product-spec-criteria.md:25`, `.claude/skills/sdd-spec/reference/spec-template.md:136`, `.claude/agents/spec-reviewer.md:20`, `.claude/skills/sdd-story/SKILL.md:200-204`, `.claude/agents/codebase-discovery.md:34`. Unchanged (FQN notation stays valid): `feature-overlap.md:42`, `service-briefing.md:55`, `sdd-design/templates/recon.md:51`, `track-b-config.md:7`, `reviewer-registry.md:22`, `*-findings.md`. The runbook-regex doc-check and its AC were cut (C-18): FR-1's "send <rel>" error already makes a stale command fail loudly.
**304's documents:** the 11 consumer banners and key tables; `plugins/strat-lab/skills/backtest/SKILL.md:81`; caveat removal; widened doc scan.

---

## Rejected Alternatives

- **One atomic PR for contract + 11 consumers** — rejected: ≈600 literal/test sites in one change repeats the 295 test-blast-radius halt (`fails.md:3660-3679`); the alias makes consumers safe after R (operator decision 1, round 1).
- **7 PRs from one harness `ccr-*` branch / "one feature, integration checkpoints"** — rejected: `/sdd-execute` opens one integration PR on its ALL-DONE path; C-16 promotion would leave stale guarantees for weeks (operator decision 1, round 2).
- **Twin resolution from `catalog.tsv` / `read_044` + `--emit-rename-data`** — rejected: the catalog is already stale (lacks migration 042's key); deleting twins unsigned contradicts 295's `allow_041` discipline and the operator's decision to keep the 5 staging twins; replaced by a hand-signed `allow_296` (FR-3 amendment, operator-signed).
- **"Re-sign after drift" recovery** — rejected: edits an applied migration (F-01, Floor).
- **Server-composed FQN in `ListKeys`** — rejected: brings back write-side stripping and touches `ConfigKeyMeta`; the relative key round-trips.
- **`ACCESS EXCLUSIVE` in R** — rejected: only stalls readers; the P-wins/newest-wins rule is value-preserving.
- **R+1 "relative always wins"** — rejected: the 295 probe/upsert are separate autocommit calls (`:778` vs `:856`), so it silently discards the operator's newest write. **"Non-system P always wins"** (operator round-4 choice) — superseded at the round-5 gate by **newest `updated_at` wins**: it also covers a write that lands on Rel after P exists.
- **R+1 "any non-system gap twin RAISEs"** — rejected: blocks every `main-dev` deploy for an ordinary race.
- **`prefixed-seed` finding kind** — cut: a prefixed seed dies with 23514 in `config-wiring-stored.sh` and `migration-rerun` before the gate sees it (FR-5 amendment, operator-signed).
- **Keeping `form-mismatch` for the prefixed-read direction** — rejected: doubles every finding (≈2×184 baseline entries); one-for-one reclassification to `prefixed-read` is correct. **Dropping the special case entirely / hoisting both directions** — rejected: silently covers a relative read of a prefixed seed in a tree without R.
- **`docCheck` runbook regex + AC-22** — cut (C-18). **`signed-unused` / `per-user-twin-unsigned` classes** — folded/dropped. **Test (b) "allow block verbatim"** — dropped as implied by the sha pin.
- **Fold FR-9 into 306** — rejected by the operator (FR-9 stays its own feature 305 with cap 5).

## Open Risks

- [ ] **Staging drift between sign-off and PRE_DEPLOY** makes R raise, blocking every `main-dev` deploy until a data repair — to be addressed at S9 (rehearsal immediately before merge) and `config-rollout.md`.
- [ ] **Homelab/production "fresh" is an operator commitment** (round-4 decision 2, re-confirmed 2026-11-07: homelab will be fresh when 296 is launched) — the operator must make it so before launch; if it is not, R fails loud on the first deploy and the recovery is documented — S9/S8.
- [ ] **Newest-`updated_at` rests on one DB clock and default timestamps.** An out-of-band `psql` write with an explicit or backdated `updated_at` (or a long transaction) can mis-order a gap twin; the runbook forbids direct writes during a deploy; `gap-twin-*` report rows and audit rows make every outcome visible and the loser is kept in `config_values_premigration_296` — S2/S8. (Strongest remaining risk.)
- [ ] **A racing `SetConfig` whose INSERT queues behind R+1's lock** gets `INVALID_ARGUMENT` once; the poller retries on its next tick — accepted.
- [ ] **Between R's commit and R+1's commit (seconds)** relative readers see Rel while prefixed readers see P; before B every consumer reads prefixed — accepted.
- [ ] **Until B ends** the 11 consumer banners contradict C-05; `readers-disagree` cannot see a cross-spelling disagreement; features that declare a key still read prefixed fail their step (`stepTime`) — document in `config-governance.md` (S8) and B's spec.
- [ ] **Old/rolled-back UI image** skips the trading_state reason guard — accepted, stated in `config-rollout.md`.
- [ ] **The write tolerance (`configServiceImpl.ts:774-818`) is dead code until 306** — D's scope.
- [ ] **Assumption A4b (homelab):** whether old containers keep running after a failed `db-migrator` is decided by homelab-edge's app-deploy gate (not in this repo) — verify at spec time.
- [ ] **C1–C6/N2 per-rule split** between 296 (stored/ListKeys/prefixed-SetConfig Thens) and B (literal Thens) is done per rule at `/sdd-spec` from recon's business-rule table; any item that only pins a getter literal goes back to the operator (C-11).
- [ ] **Runtime shadowing** by an operator `create_key trading/trading_state` is not gated (only seeds are) — accepted; B's `attribute()` shadow guard covers seeds.

## Constitution Rules Touched

- `F-01` — honored: no recovery path edits a merged migration (§0, §3.4, §3.5); rehearsal-before-merge + sha pin; every RAISE is a data predicate.
- `F-02`/`F-03`/`C-06` — honored: Development Branch is `feature/fix-config-keys-contract` (`feature.md:4`); design documents land through ccr PR #1471 into `main-dev`; no step PR targets `main`/`main-dev` directly.
- `F-04`/`C-01` — honored: every citation was re-verified against the tree in each round; unfound items stay in recon's `## Not found`.
- `F-06` — honored: no new pool, edge or env var; R/R+1 run in the existing PRE_DEPLOY job.
- `F-07`/`C-05` — C-05 is amended by this feature (wording flipped in 296: the stored key is namespace-relative, the FQN is display-only); no hardcoded config values are introduced.
- `F-08`/`F-09` — honored by spec shaping: S9's Files list every renumber-touched file; renumber-at-merge is routed through the Deviation Log (follow 295 Step 38's precedent).
- `F-11` — the one Floor item (F-01 recovery) was resolved in round 3 and re-verified in rounds 4–5; no Floor item is open.
- `C-02`/`P-05` — context.md was read at boot and every round's outcome and operator decision was written as it happened.
- `C-07` — honored: migration numbers are assigned max+1 at merge; none is pre-reserved; names/actors reference the feature, not a number.
- `C-08` — honored: each service step pairs with a test step (§8); the gate and rerun changes carry their own tests.
- `C-10` — honored: every instance of a shared surface is updated or assigned (docs list §9, blast-radius §8, durable suites).
- `C-14` — honored: config-ui (S4) and the agent (S5) each earn a step.
- `C-15` — honored: acceptance edits (below and product-spec) keep IDs append-only, every live FR has ≥1 scenario, retirements are recorded.
- `C-16` — honored: the CHANGE list was signed off by the operator (context.md round-3 gate); durable suites receive supersession notes (§8).
- `C-18` — honored: least mechanism (no `prefixed-seed`, no runbook regex, no emitter CLI, no `signed-unused`/`per-user-twin-unsigned`, one report table); the load-bearing mechanisms (signed allowlist, two-way oracle, trigger disable, narrow hoist) are justified above.
- `P-01`–`P-04` — honored: single orchestrator; proposer/adversary mediated; every gate recorded.

## Business Rules Touched (C-16)

- **CHANGE in 296** (operator sign-off, context.md "round 3 + C-16 sign-off", davcs86 2026-11-07): 295 config `@AC-1`, `@AC-14`, `@AC-20`, `@AC-21`, `@AC-25`, `@AC-26`, `@AC-34`; 295 `@AC-28(a)(b)(c)`; 295 platform `@AC-19`, `@AC-20`; 219 config `@AC-6/7/13` and ui `@AC-8/@AC-12`; `@AC-2` @243 (indicators); `@AC-2/@AC-4` @182; `@AC-2` @184; `@AC-19` @281; `@AC-27` @282; `@AC-1/3/5/7/10/12/13` @293; pre-approved C1–C6 and N2 (295 decision 10; C4 confirmed to cover reclassifying `form-mismatch` → `prefixed-read`); the durable header `fix-config-keys-drift.feature:6`.
- **CHANGE in 304** (recorded at B's design): 295 `@AC-15` (ledger `read_key` log spelling); among the pre-approved rules, those asserting the literal.
- **PRESERVE (+supersession note where the Then text changes):** 295 `@AC-2/3/4/10/11/31/35`; 295 `@AC-5` (effective value unchanged; "survives unchanged" superseded by a note — parked with snapshot and report); 295 `@AC-33` (R and R+1 never delete a secret-class twin; the CI fixture twin is removed by the data repair, never by a migration); `@AC-54` @feature-294 (poller exception still ends in `PERMISSION_DENIED` for `ACTIVE`); 254 `@AC-3/4/6`; 161 `@AC-8`; 264 `@AC-5`; 278 `@AC-2/3/7/8/9` (extended by `prefixed-read`); ui display rows of `config-ui-usability` and `surface-signal-weight-decay-config @AC-6` (FQN display).

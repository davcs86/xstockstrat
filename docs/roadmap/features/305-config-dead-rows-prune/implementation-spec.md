# Implementation Spec: config-dead-rows-prune

**Status**: `in-progress`
**Created**: 2026-11-09
**Feature**: `docs/roadmap/features/305-config-dead-rows-prune/feature.md`
**Total Steps**: 14
**Feature Branch**: `feature/config-dead-rows-prune`

**Tree**: `feature/config-dead-rows-prune@d7bd240 ≡ origin/feature/config-dead-rows-prune (merged origin/main-dev@93bb230)`. Sync merged `origin/main-dev` (CHANGELOG.md only) and pushed. `recon.md` and `design.md` are present, so no `codebase-discovery` subagent was spawned: the claims they do not already cover (evaluator symbols, test names, harness hooks, doc rows, line numbers that drifted after 304) were re-verified inline against this tree. Cite **symbols**, not line numbers, for `scripts/check-config-wiring.mjs`, `scripts/config-wiring.test.mjs` and `scripts/migration-rerun.sh`: three features share them.

---

## Execution Summary

Order: the pure evidence evaluator and its tests first (Steps 1-2, red-first), because the signed block must be judged by it. Then the **operator-gated sign-off P1** (Step 3: Loki export, signed block, `signoff.md` section) - `/sdd-execute` pauses there and the operator authors that commit. Then the **atomic unit** (Steps 4-6): the migration pair, the baseline close-out and the hand-derived stored set, the CI replay harness plus assertion file, and the permanent `dead 2`/`dead 3` tests, which cannot pass apart (`baseline 1`/`baseline 2` need the stored set and the entries to move with the migration). Steps 7-9 remove the spent 296 sign-off tool (FR-6); Steps 10-12 remove the dead bounds entry and sweep the stale docs (FR-7). Last, the **operator-gated rehearsal P2** after the final rebase/renumber (Step 13) and the file-sha pin test (Step 14). The integration PR stays a **draft** until Step 14 passes (`fails.md` 2026-11-08: an operator-gated step was merged unsigned and left config dirty).

Placeholders: the migration is `046_config_dead_rows_prune` (trunk max is `045_config_keys_relative_check`; 306 and 280 also draw from this range). Its content and actor (`system:config-migration-feature-305`) carry no number, so a merge-time renumber renames files only (up, down, `config-046.sql`) and regenerates `config-wiring-stored.json` (`inputs_sha256` hashes paths); the P2 file sha is unchanged by a renumber.

Consumer surfaces (C-14): `/config-ui` namespace editors and the Agent `list_config_keys` are **passive** `ListKeys` readers (`configServiceImpl.ts` `listKeys`, `FROM config.config_values`): they lose the rows when the migration runs; AC-1's `ListKeys` Then is proved by Step 5's assertion that no live global row remains. No UI or agent step is required (decided at design, `design.md` "Consumer surface").

Not written by this spec (operator decisions, `design.md` § Chosen Approach, proposed row): the `merge-order.md` row 305 ↔ 306 ↔ 280. P3 (post-launch probe: marker present with `set_by` = actor; 0 live global rows for the 4 tuples; 0 per-user rows for the 2 keys; 0 `unmatched-signed-tuple` rows with reason `feature 305:%` at the marker's `run_at`) is a post-launch checklist item in a docs PR, not a step.

**Deviations from `design.md` found while grounding** (recorded for `/sdd-review impl-spec`, none changes the approach):

- `design.md` §2 says the loader throws on a "wrong header/cell count"; the grammar has **no header line** (column 1 is the row kind). Step 1 pins that, plus the timestamp format and the error messages, because Step 2's fixtures must construct them (`fails.md` 2026-11-06).
- `design.md` §5 lists the defect banner in `services/xstockstrat-config/CLAUDE.md:3`. That banner's "`SCALAR_BOUNDS_REGISTRY` guarding unread values" clause points at the still-open `signal_decay_half_life_hours` finding (`services/xstockstrat-config/docs/context-constitution-findings.md`, row "can guard a value no reader reads"), which this feature does not resolve. It is **not edited** and not in any step's Files.
- Line numbers moved after 304: analysis `CLAUDE.md` row is now `:604`, marketdata `CLAUDE.md` row `:63`, indicators `CLAUDE.md` sentence `:233`. Steps cite anchors, not lines.
- The ledger `CLAUDE.md` row and the ledger durable scenarios (295 @AC-15, 304 @AC-12) stay untouched; only the `(owner feature 305)` parenthetical in the comment of `services/xstockstrat-ledger/acceptance/config-keys-relative-consumers.feature` changes (Step 12, comment-only).

### Scenario Coverage (C-15)

| Scenario | Covered by |
|---|---|
| AC-1 | Step 5 (`config-046.sql` and pass 2d: row gone from `config.config_values` = the `ListKeys` source, snapshot, exactly one audit row, `new_value` NULL), Step 6 (`dead 2` judges both keys `dead`) |
| AC-2 | Step 5 (rolled-back pass 2d sub-test: mutated production `alpaca.paper` row -> 3 deleted, 1 kept, exactly one `unmatched-signed-tuple` with reason `feature 305:%`) |
| AC-3, AC-4, AC-5 | Step 2 |
| AC-6 | Step 5 (one asserted replay with an unchanged fingerprint; pass 2d down restores exactly the 4 rows) |
| AC-7 | Step 6 (`dead 2`) |
| AC-8 | Step 6 (`dead 3` plus `baseline 1`) |
| AC-9 | Step 8 (indicators suite, `legacy_authors` tests intact), Step 9 (the `config_allow296` grep) |
| AC-10 | Step 11 (bounds entry), Step 12 (docs, ledger comment-only, `stream.notify_enabled` kept) |

## Step Dependencies

- Steps 1 and 2 land together as one unit with an in-unit red-first order (tests written and observed failing before the implementation; sequential execution cannot otherwise show the red, because Step 1 is numbered first).
- Step 3 requires Steps 1-2 (the evaluator judges the operator's evidence) and an operator on a workstation with staging Loki access, the DO consoles and the homelab hosts. `/sdd-execute` pauses; the executor cannot run it.
- Steps 4, 5 and 6 land together: `baseline 1`/`baseline 2` (`--final` on the real tree; stored `inputs_sha256`) cannot pass between the migration file, the stored set and the baseline entries (`step-constraints.md` §C, "seeds/changes a config key... and its wiring test"); `migration-rerun.sh` cannot pass in CI with a config migration above `R+1` until Step 5; Step 6's `dead 2` references the migration and the assertion file. Members are adjacent, on one surface (backend/tooling), 3 steps (cap 4).
- Step 4 requires Step 3 (the signed block bytes are pasted verbatim into the migration).
- Steps 7 and 8 land together (`step-constraints.md` §C, "deletes a referenced resource": the test imports the module).
- Step 9 requires Steps 7-8 (its grep Verification expects the module gone).
- Steps 10 and 11 land together as one unit with an in-unit red-first order (the guard is written and observed failing before the entry is removed).
- Steps 7-11 do not depend on Step 3. If the operator is delayed at the P1 pause, `/sdd-execute` may run Steps 7-11 first (record the reorder in `context.md`); Step 12 requires Step 4 (hence Step 3), and Steps 4-6, 13 and 14 still wait for Step 3 / Step 13.
- Step 12 requires Steps 4 and 10 (the docs describe the deleted rows and the removed entry).
- Step 13 requires Steps 4-6 and 12 and the **last rebase/renumber**; it is operator-gated. Step 14 requires Step 13 (it pins the sha that Step 13 records).
- Preconditions for the **integration PR** (not for any step): the operator records in `context.md` that the one-staging-release evidence window closed; the integration PR stays a draft until Step 14 passes; 305 merges before 306's FR-6 closes (owner hand-off of the kept `ledger`/`stream.notify_enabled` baseline entry; 306's docs were already edited, docs-only, 2026-11-09).
- Shared-file overlap with 306 and 280 (not a step): `scripts/migration-rerun.sh` (Step 5 introduces `cfg_top` and slug-glob discovery; 306/280 rebase onto it and must not re-pin `R1`), `scripts/check-config-wiring.mjs` (Step 1 appends after `membership()`; 306 edits `join()`), `scripts/config-wiring.json`, and the migration number. 306's FR-6 may empty the baseline, which would turn `baseline 2`'s `assert.ok(findings.length > 0)` red; that is a 306 rebase item, not this feature's.
- Deferred, with named owner: removal of the kept `ledger`/`stream.notify_enabled` row and the `platform`/`log_level` and `trading`/`risk.daily_loss_limit` entries -> feature 306.

---

### Step 1 - service: evidence loader, subscriber derivation and `deadRowVerdict` in the wiring gate

**Status**: `done`
**Service**: `scripts/` (wiring-gate tooling, `xstockstrat-config` governance)
**Files**:
- `scripts/check-config-wiring.mjs` - modify

**Reviewers**: xstockstrat-config owner - config key naming, environment/global-per-user scoping, WatchConfig stream stability

**Codebase Evidence**:
- `scripts/check-config-wiring.mjs`: `const canonical = (ns, key) => (key.startsWith(\`${ns}.\`) ? key : \`${ns}.${key}\`)` (not exported; defined above `declaredFromSpec`); `export function loadInventory(file)`; `function membership(root, state)` (owner filter `/^feature (305|306)\b/`, left **unchanged**); `export function run(argv)` composes `ratchet`, `freshness`, `membership` for `--final` and never reaches code placed after `membership()`; `loadRegistry`/`loadState` return `registry.receivers`.
- `registry.receivers` (`scripts/config-wiring.json`) keys are `"<repo-rel file>:<symbol>"` -> a namespace string or a list. Derived on this tree (`node -e` over the JSON, restricted to the signed namespaces `analysis`, `marketdata`): `analysis`->`analysis`, `analysis`->`marketdata` (`services/xstockstrat-analysis/app/engine/fundsignal_loop.py:self._md_cfg`, `:md_config_watcher`), `marketdata`->`marketdata` (`services/xstockstrat-marketdata/cmd/server/main.go:cfgWatcher`), all `single`; no `list` and no `ui` receiver on either namespace (UI receivers name only `platform` and `ui`).
- Log emission the evidence is built from: Go `services/xstockstrat-marketdata/internal/config/watchcore.go` (`c.logger().Info("config.read_coverage", "ns", ns, "keys", len(keys))`, `"config.read_key", "ns", ns, "key", k`); Python `services/xstockstrat-analysis/app/config/watch_core.py` (`log.info("config.read_coverage ns=%s keys=%d", ns, len(keys))`, `"config.read_key ns=%s key=%s"`); the keys are logged in the reader's spelling, hence the `canonical` equality. Registered in `packages/otel/produced-signals.tsv`.
- Subscribers: `services/xstockstrat-analysis/app/main.py` (`ConfigWatcher(... namespace="analysis")` and `namespace="marketdata"`), `services/xstockstrat-marketdata/cmd/server/main.go` (`config.NewWatcher(cfg.ConfigEndpoint, "marketdata", ...)`).
- Constitution: C-18 (least mechanism: three pure functions, no CLI flag, no `run()` wiring), 278 @AC-2/7/8 and 295 @AC-19 (an evaluator must never suppress a `seeded-unread` finding).

**TDD**: `red-green required` (one red-to-green cycle for the unit Steps 1+2: **write Step 2's tests and fixtures first**, run `node --test scripts/config-wiring.test.mjs --test-name-pattern='^dead 1'`, record the failing run (missing exports) in `context.md`, then implement this step and re-run to green; the pair commits as one unit)

**Lands with**: `Step 2`

**Covers**: -

**Instructions**:
1. Add `export` to the existing `canonical` const (no other change to it; the permanent test in Step 6 reuses it instead of a second string helper).
2. After `membership()` add three exported pure functions. None is called from `run()`; `membership()`, `ratchet`, `join`, `freshness` stay byte-identical.
3. `loadEvidence(text)` parses `scripts/config-heal/dead-row-evidence.tsv`. **Pinned grammar** (Step 2's fixtures and Step 3's export construct it; there is no header line and no comment line, blank lines are skipped, cells are tab-separated, column 1 is the row kind):
   - `window` (exactly one): `window<TAB>W0<TAB>W1<TAB>21600<TAB>deployment_environment="staging"`. `W0`/`W1` are `YYYY-MM-DDTHH:MM:SSZ` (UTC), hour in {00,06,12,18}, minute and second `00`, `W1 > W0`, `(W1-W0)` a multiple of 21600 s (k bins). Cell 3 must be `21600`; cell 4 must be the literal selector.
   - `subscriber`: `subscriber<TAB>service<TAB>ns<TAB>class`, `class` in `single|list|ui`; at least one row.
   - `coverage`: `coverage<TAB>service<TAB>ns<TAB>bin_end<TAB>count`; `bin_end` is `W0 + i*6h` for i = 1..k (Loki bins are left-open `(t-6h, t]`, so the k bins tile `(W0, W1]`); `count` a positive integer; duplicate `(service,ns,bin_end)` rejected. **Absence of a row means the subscriber did not log that bin.**
   - `read-hit`: `read-hit<TAB>service<TAB>ns<TAB>key<TAB>count` (ns and key exactly as logged, either spelling); `count` a positive integer; duplicate `(service,ns,key)` rejected.
   - `keys`: `keys<TAB>service<TAB>ns<TAB>N` (the `keys=N` of that pair's last `config.read_coverage` line in the window), `N` a non-negative integer, one per pair.
   - Returns `{ window: { start, end, bins }, subscribers: [{ service, ns, class }] (file order), coverage: Set of \`${service}\t${ns}\t${bin_end}\`, hits: [{ service, ns, key, count }], keys: Map of \`${service}\t${ns}\` -> N }` where `bins` is the ordered list of the k `bin_end` strings.
   - **Positive control** (enforced in the loader): for every `single`/`list` subscriber pair (`ui` exempt) a `keys` row must exist and the number of distinct `canonical(ns, key)` among that `(service, ns)` pair's `read-hit` rows must be >= its `N`.
   - **Pinned errors** (all `Error` messages begin `evidence:`; tests match these substrings): `unknown kind`, `expects <n> cells`, `duplicate <kind> row`, `second window row`, `missing window row`, `window` (boundary, step or selector invalid), `is off the 6 h grid or outside the window`, `count must be a positive integer`, `no subscriber rows`, `positive control: missing keys row for <service>/<ns>`, `positive control: <service>/<ns> has <d> distinct read-hit keys but its last coverage line logged keys=<N>`.
4. `subscribersOf(receivers)` returns the sorted, de-duplicated `{ service, ns, class }` set derived from a `registry.receivers` object: `service` from `^services/xstockstrat-([^/]+)/` of the entry key; a string value is one namespace, an array contributes every namespace; `class` is `ui` when `service === 'ui'`, else `list` for an array value, else `single`. The one-time "frozen set == `subscribersOf(registry.receivers)` limited to the signed namespaces" proof is a pinned command run in Step 3, not permanent code.
5. `deadRowVerdict({ ns, key }, evidence, subscribers)` returns `'dead'` or `` `kept:${reason}` `` and checks in this order (the order makes AC-3/4/5 each hold): (a) `kept:read-hit` if any `evidence.hits` row has `h.ns === ns` and `canonical(h.ns, h.key) === canonical(ns, key)`; (b) `kept:missing-coverage` if any subscriber with `s.ns === ns` and `s.class !== 'ui'` lacks a `coverage` entry for any bin in `evidence.window.bins`; (c) `kept:ui-reader` if any subscriber has `s.ns === ns` and `s.class === 'ui'`; (d) `kept:list-receiver` if any subscriber has `s.ns === ns` and `s.class === 'list'`; (e) otherwise `dead`. The third argument is the **frozen** subscriber rows from the committed evidence (`evidence.subscribers`), never the live registry.

**Verification**:
```
cd /home/user/xstockstrat
node -e "import('./scripts/check-config-wiring.mjs').then(m=>{for(const f of ['canonical','loadEvidence','subscribersOf','deadRowVerdict'])if(typeof m[f]!=='function'){console.error('missing export',f);process.exit(1)}})"
node --test scripts/config-wiring.test.mjs
node scripts/check-config-wiring.mjs --final
```
(`.mjs` gate tooling has no lint command in `step-constraints.md` §B; the existing test file and `--final` are the regression gate. `run()` does not call the new functions, so the first two commands and `--final` are unchanged from the pre-step tree.)

---

### Step 2 - test: evaluator and loader tests with self-contained fixtures

**Status**: `done`
**Service**: `scripts/` (wiring-gate tooling, `xstockstrat-config` governance)
**Files**:
- `scripts/config-wiring.test.mjs` - modify (append tests named `dead 1a` ... `dead 1g`; do not touch existing tests)
- `scripts/config-wiring-fixtures/dead/evidence.tsv` - create
- `scripts/config-wiring-fixtures/dead/evidence-ui.tsv` - create

**Reviewers**: xstockstrat-config owner - config key naming, environment/global-per-user scoping, WatchConfig stream stability

**Codebase Evidence**:
- `scripts/config-wiring.test.mjs`: imports `* as cw from './check-config-wiring.mjs'`; `const cli = (root, ...args) => spawnSync(process.execPath, [SCRIPT, '--root', root, ...args])`; fixture roots `GATE = config-wiring-fixtures/gate` and `fresh(fixture)` (copies a fixture to a temp dir and `stamp`s the stored JSON); `gate 1 @AC-19` runs `fresh('seeded-unread')` with `cli(dir, '--final')` expecting a `seeded-unread` finding. Fixture directories are self-contained and do not depend on the real baseline (`recon.md` Patterns to REUSE).
- CI filter `config-wiring` already globs `scripts/config-wiring-fixtures/**`, `scripts/config-wiring.test.mjs` and `scripts/config-heal/**` (`.github/workflows/ci.yml`, `config-wiring:` filter).
- C-13: these tests are Node-script tests with fixtures in the established `config-wiring-fixtures/` home; each literal has one consumer.

**TDD**: `red-green required` (in-unit red-first with Step 1: author this step's tests and fixtures before Step 1's implementation and capture the failing run)

**Lands with**: `Step 1`

**Covers**: AC-3, AC-4, AC-5

**Instructions**:
1. `evidence.tsv`: one `window` (e.g. W0 `2026-11-03T00:00:00Z`, W1 `2026-11-04T00:00:00Z`, k = 4 bins), `subscriber` rows `analysis analysis single`, `analysis marketdata single`, `marketdata marketdata single`, a `coverage` row for each of the 3 pairs in each of the 4 bins, `read-hit` rows for keys other than `opportunity.sparkline_bars` / `alpaca.paper` (a mix of relative and prefixed spellings, e.g. `analysis analysis opportunity.refresh_hour_utc`, `analysis marketdata fundamentals.provider`, `marketdata marketdata backfill.batch_size`), and a `keys` row per pair equal to that pair's distinct canonical hit count.
2. `evidence-ui.tsv`: same window; one `subscriber ui ui ui` row (no coverage rows needed: `ui` is exempt); no read-hit.
3. Tests (mutate the base text with `.replace`/line filtering, as `gate 7` mutates its fixture; assert on the strings pinned in Step 1):
   - `dead 1a` (AC-1 evaluator, no hits, full coverage): `deadRowVerdict` is `dead` for `{analysis, opportunity.sparkline_bars}` and `{marketdata, alpaca.paper}`.
   - `dead 1b @AC-3`: drop the one `coverage analysis marketdata <bin>` line -> `{marketdata, alpaca.paper}` is `kept:missing-coverage`.
   - `dead 1c @AC-4`: with `evidence-ui.tsv`, `{ui, fixture.unread}` is `kept:ui-reader`.
   - `dead 1d @AC-5`: append `read-hit analysis analysis analysis.opportunity.sparkline_bars 1` -> `kept:read-hit` (the old spelling keeps the row); also append the relative spelling on another service/ns and assert a hit in a different namespace does not keep the row.
   - `dead 1e` verdict order and `list-receiver`: a `list` subscriber on the namespace with full coverage -> `kept:list-receiver`; a missing-coverage case still reports `kept:missing-coverage` before `kept:list-receiver`.
   - `dead 1f` loader rejects, one assertion per pinned error: unknown kind, wrong cell count, duplicate `coverage`, a second `window`, no `window`, off-grid `bin_end`, `bin_end` past W1, `count` 0, no `subscriber` row, missing `keys` row, positive-control shortfall (remove a `read-hit` row so the distinct canonical keys fall below `N`), plus a valid parse of the base file.
   - `dead 1g`: `subscribersOf` over a receivers object derives `single`/`list`/`ui` and the service name from the path; and (278 @AC-2/7/8, 295 @AC-19 preserved) copy `fresh('seeded-unread')` to a temp root, add `scripts/config-heal/dead-row-evidence.tsv` that judges the finding's key `dead`, and assert `cli(dir, '--final')` still exits 1 with the same `seeded-unread` finding line as `gate 1` (the evaluator never suppresses a finding).
4. Single-consumer inline literals; no new fixture home beyond the two files (C-13).

**Verification**:
```
cd /home/user/xstockstrat
node --test scripts/config-wiring.test.mjs --test-name-pattern='^dead 1'
node --test scripts/config-wiring.test.mjs
node scripts/check-config-wiring.mjs --final
```

---

### Step 3 - migration: operator sign-off P1 (Loki evidence, signed block, sign-off section)

**Status**: `done`
**Service**: `scripts/config-heal`
**Files**:
- `scripts/config-heal/dead-row-evidence.tsv` - create
- `scripts/config-heal/dead-rows-signed.sql` - create
- `scripts/config-heal/signoff.md` - modify (append a section headed exactly `# Feature 305 — dead-row sign-off`)

**Reviewers**: DBA - migration numbering, embedded-data correctness, run-order, xstockstrat-config owner - config key naming, environment scoping; no value or user id in any recorded output

**Codebase Evidence**:
- **Operator-gated**: needs the staging Loki read path (Grafana Cloud) and an operator workstation; the executor cannot run it. `/sdd-execute` pauses here and asks the operator, who **personally authors this commit** (FR-4 can check consistency, not authenticity). The agent records the commit sha in `context.md`.
- Precedent: `scripts/config-heal/allow-signed.sql` (the 38-tuple block, markers `-- allow_041:begin` ... `-- allow_041:end`, `(VALUES ... ) AS allow_041(namespace, key, environment, value_sha256)`) and the section shape of `scripts/config-heal/signoff.md` (`# Feature 296 — R sign-off`, bullets `- Label: \`sha\``, ends with operator and date).
- The 4 value shas already exist in committed inventories: `scripts/config-heal/inventory-fresh.jsonl` rows for `analysis`/`analysis.opportunity.sparkline_bars` (production, staging: `f5ca38f7...`) and `marketdata`/`marketdata.alpaca.paper` (production `fcbcf165...`, staging `b5bea41b...`; keys are stored prefixed there, compare after `canonical()`); `inventory-staging.jsonl` has the same shas (staging `alpaca.paper` has `value_type string`; the sha is what counts).
- Log families (`watchcore.go` structured attributes vs `watch_core.py`/`configWatcher.ts` text bodies) and `service_name` as the short-name stream label: `docs/patterns/observability.md` (Logs row).
- `recon.md`/`design.md` operator pre-checks (not knowable from the repo): Go `ns`/`key`/`keys` arrive as queryable structured metadata; Python/Node bodies carry the formatted `config.read_* ns=... key=...` text; the R-wide instant query is within `max_query_length` and retention; sample timestamps sit on the grid; `deployment_environment="staging"` maps to exactly one deployment.

**TDD**: `N/A (operator sign-off; the evaluator verdict and the permanent test are Steps 1-2 and 6)`

**Covers**: -

**Instructions** (operator workstation):
1. Run the pre-checks above on real log lines; stop and re-scope if any fails. Pick the window: first staging deploy carrying feature 295's logging through the export date, **W0 on a 6 h UTC boundary**, W1 = W0 + k*6h.
2. Export, as aggregated metric queries (not a line-level export), restricted to `service_name=~"analysis|marketdata"` and the namespaces `analysis`, `marketdata`: per-`(service, ns)` `count_over_time` over 6 h bins for `config.read_coverage` (a range query, step 6 h, first evaluation at W0 + 6 h), one instant read-hit query at W1 over the whole window returning **every key** of those two namespaces in both spellings (a superset of the 2 signed keys), and the `keys=N` of each pair's last coverage line. Each signal needs two disjoint families: Python/Node text lines (`|= "config.read_coverage ns="`) and Go attribute lines (`|= "config.read_coverage" != "config.read_coverage ns="`). Write them into `scripts/config-heal/dead-row-evidence.tsv` in the Step 1 grammar, plus the three frozen `subscriber` rows (`analysis analysis single`, `analysis marketdata single`, `marketdata marketdata single`).
3. Prove the frozen set equals the live registry's (one-time proof, output pasted into `signoff.md`):
   `node -e "import('./scripts/check-config-wiring.mjs').then(m=>console.log(JSON.stringify(m.subscribersOf(m.loadRegistry(process.cwd()).receivers).filter(s=>['analysis','marketdata'].includes(s.ns)))))"` equals the file's `subscriber` rows.
4. Write `scripts/config-heal/dead-rows-signed.sql`: exactly 4 tuples `(namespace, key, environment, value_sha256)`, relative keys, between `-- dead_rows_305:begin` and `-- dead_rows_305:end`, in the shape `(VALUES ...) AS dead_rows_305(namespace, key, environment, value_sha256)`; each sha must equal the live DB value's sha (confirm on staging, and note that production rests on "same code" plus the static evidence, recorded as an accepted assumption).
5. Append `# Feature 305 — dead-row sign-off` to `scripts/config-heal/signoff.md` with these labelled bullets (the permanent test in Step 6 reads them): `- Evidence file sha256: \`<64 hex of dead-row-evidence.tsv>\``, `- Signed block sha256: \`<64 hex>\`` (the sha256 of the lines **strictly between** the two marker lines, each line ending in LF), the LogQL text of every pinned query, the window (W0, W1), the subscriber-equality proof output, the accepted production assumption, the operator and date.
6. **Halt rule (P-03)**: any `kept:*` verdict for a signed tuple halts execution and re-scopes the spec. An empty bin is `kept:missing-coverage`: shift W0/W1 by less than 6 h and re-export; never edit the evidence file by hand.

**Verification**:
```
cd /home/user/xstockstrat
grep -c "^[[:space:]]*('" scripts/config-heal/dead-rows-signed.sql   # → 4
node -e "import('./scripts/check-config-wiring.mjs').then(cw=>{const fs=require('fs');const ev=cw.loadEvidence(fs.readFileSync('scripts/config-heal/dead-row-evidence.tsv','utf8'));let bad=0;for(const [ns,key] of [['analysis','opportunity.sparkline_bars'],['marketdata','alpaca.paper']]){const v=cw.deadRowVerdict({ns,key},ev,ev.subscribers);console.log(ns,key,v);if(v!=='dead')bad=1}process.exit(bad)})"
shasum -a 256 scripts/config-heal/dead-row-evidence.tsv   # equals "Evidence file sha256" in signoff.md
sed -n '/dead_rows_305:begin/,/dead_rows_305:end/p' scripts/config-heal/dead-rows-signed.sql | sed '1d;$d' | shasum -a 256   # equals "Signed block sha256"
grep -n "Feature 305" scripts/config-heal/signoff.md
```

---

### Step 4 - migration: dead-row prune up/down, baseline close-out and hand-derived stored set

**Status**: `done`
**Service**: `xstockstrat-config` (and `scripts/` gate state)
**Files**:
- `services/xstockstrat-config/migrations/046_config_dead_rows_prune.up.sql` - create
- `services/xstockstrat-config/migrations/046_config_dead_rows_prune.down.sql` - create
- `scripts/config-wiring.json` - modify
- `scripts/config-wiring-stored.json` - modify

**Reviewers**: DBA - migration numbering (max+1), up+down pair, replay safety, run-order with `scripts/db-migrate.sh`, xstockstrat-config owner - config key naming, environment/global-per-user scoping; no secret values in logs or reports

**Lands with**: `Step 5`, `Step 6`

**Codebase Evidence**:
- Trunk max is `045_config_keys_relative_check`; `044_config_keys_relative` is R. `ls services/xstockstrat-config/migrations` confirms no `046`. 306 and 280 also draw from this range: the first to merge takes the lowest, the others renumber (files only).
- Seeds of the deleted rows (C-05): `marketdata`/`alpaca.paper` (bool) `001_config_tables.up.sql` (`('marketdata','alpaca.paper','bool','true',...)`) and `002_config_environment.up.sql` (production/staging variants); `analysis`/`opportunity.sparkline_bars` (int, `20`) `028_analysis_opportunity_keys.up.sql` (prefixed seed, renamed by 044). Code default: n/a (no reader). Both non-secret, global.
- Idioms to reuse verbatim, not reinvent: snapshot table `config.config_values_premigration_296` (`044_config_keys_relative.up.sql` create `LIKE ..._premigration_041` + `snapshot_at timestamptz NOT NULL DEFAULT clock_timestamp()`, insert column list `id, namespace, key, value_type, value_data, is_secret, description, default_value, consuming_service, updated_by, update_reason, created_at, updated_at, environment, caller_identity, user_id, snapshot_at`); report table `config.config_keys_report_296(run_at, action, namespace, key, environment, user_id, reason)`, never holds a value; audit insert `config.config_audit(namespace, key, old_value, new_value, changed_by, reason, changed_at, environment, user_id, caller_identity)` with `changed_at = clock_timestamp()` (044 "8 Delete losers"); unmatched reported never raised (044 "Signed tuples attached to no twin are reported, never raised"); notify `pg_notify('config_changed', json_build_object('namespace', t.ns, 'environment', t.env)::text)` per touched pair (044 "12 Notify"); signed-block markers and sha match `a.value_sha256 = encode(sha256(convert_to(b.value_data, 'UTF8')), 'hex')` (`041_heal_config_keys_to_reader_catalog.up.sql` `-- allow_041:begin` .. `-- allow_041:end`); latch table `config.config_markers(name PRIMARY KEY, set_at, set_by)` (`040_config_markers.up.sql`).
- DELETE fires no audit trigger (`config_value_audit` is BEFORE UPDATE `001_config_tables.up.sql`; `config_value_audit_insert` is AFTER INSERT `010_config_audit_insert_trigger.up.sql`), so an explicit audit CTE does not double-write; a restore INSERT in the down fires the AFTER INSERT trigger.
- Down precedent: `041_heal_config_keys_to_reader_catalog.down.sql` (`DISTINCT ON`, `updated_by`/`update_reason` set, `ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING`). 044's down raises "irreversible contract" and is not a model (FR-1/AC-6 require a restoring down).
- Gate state: `scripts/config-wiring.json` `findings` holds `seeded-unread` entries for `ledger`/`stream.notify_enabled` (owner `feature 305`), `marketdata`/`alpaca.paper` (`feature 305`), `platform`/`log_level` and `trading`/`risk.daily_loss_limit` (`feature 306`), `analysis`/`opportunity.sparkline_bars` (`feature 305`), and the defect-owned `trading`/`broker.paper` `read-unseeded`. `scripts/config-wiring-stored.json` carries the 4 stored rows (`"key": "opportunity.sparkline_bars"` x2 production/staging, `"key": "alpaca.paper"` x2) and `inputs_sha256`, which `storedInputsSha256(root)` (`check-config-wiring.mjs`) computes from every file under `services/xstockstrat-config/migrations` (paths included) plus `scripts/config-wiring-stored.sh`. The generator emits final-state `config.config_values` rows, so a deleted row is simply absent (`scripts/config-wiring-stored.sh`, final `SELECT ... FROM config.config_values`).
- `scripts/config-heal/dryrun-fresh.tsv` is generated at migrations 40/41 only and keeps the 5 `unread-no-partner` rows: **unchanged**; `membership()` (`/^feature (305|306)\b/`) already covers the re-owned ledger entry.
- F-01: no data-dependent `RAISE`; recovery never edits the merged file (repair data, `migrate force n-1`, `up`). A failing PRE_DEPLOY migrator leaves config dirty (`fails.md` 2026-11-08), so this migration takes **no lock** (044's `LOCK TABLE` retry loop, `044_config_keys_relative.up.sql` section 1, is the dirty-on-exhaustion hazard).

**TDD**: `N/A (migration + gate state; proven by Steps 5-6, which land with this step)`

**Covers**: -

**Instructions**:
1. `046_config_dead_rows_prune.up.sql`: header comments only (`-- Service: xstockstrat-config - feature 305`, "never edited after the P2 sha is pinned (F-01); recovery repairs data, `migrate force n-1`, re-run"). **No `contract-of` header** (it would break the unique R discovery in `scripts/migration-rerun.sh`), **no migration number** in content or actor, **no `BEGIN`/`COMMIT`** (golang-migrate wraps the file), **no `LOCK`**, **no data-dependent `RAISE`**.
2. The body is **one top-level statement**, a data-modifying CTE chain (not a `DO` block), so a failure leaves no partial write:
   - `latch`: `SELECT NOT EXISTS (SELECT 1 FROM config.config_markers WHERE name = 'dead_rows_305') AS open`.
   - `signed`: `SELECT * FROM` the Step 3 block pasted **byte-for-byte** between `-- dead_rows_305:begin` and `-- dead_rows_305:end` (marker lines are comments, not part of the compared text; the tuple-count rule is `grep -c "^[[:space:]]*('"`).
   - `d`: `DELETE FROM config.config_values v USING signed s, latch WHERE latch.open AND v.user_id IS NULL AND NOT v.is_secret AND v.namespace = s.namespace AND v.key = s.key AND v.environment = s.environment AND encode(sha256(convert_to(v.value_data, 'UTF8')), 'hex') = s.value_sha256 RETURNING v.*`. Global rows only; per-user rows of the signed keys are excluded by the predicate (probed by Step 5/13/P3, not deleted). The `RETURNING` image **is** the snapshot, and the DELETE re-checks each row's hash at lock time, so a concurrently updated row is reported unmatched.
   - `snap`: insert `d` into `config.config_values_premigration_296` (the 044 column list; secrets cannot occur because of `NOT v.is_secret`).
   - `aud`: one `config.config_audit` row per `d` row: `old_value = value_data`, `new_value NULL`, `changed_by = 'system:config-migration-feature-305'`, `reason = 'feature 305: delete signed dead row'`, `changed_at = clock_timestamp()`, `caller_identity NULL`.
   - `rep`: `config.config_keys_report_296` rows with `run_at = now()`: `dead-row-deleted` per `d` row (reason prefix `feature 305:`) plus `unmatched-signed-tuple` (reason `feature 305: signed tuple matched no row`, `user_id NULL`, no value) for each signed tuple with no `d` row, both gated on `latch.open`.
   - `mk`: insert the marker `('dead_rows_305', now(), 'system:config-migration-feature-305')`, **gated on `latch.open`** (the PK would raise on the AC-6 replay if ungated). `set_at = now()` equals the report `run_at` (same transaction); the down joins on that equality.
   - `nt`: `SELECT pg_notify('config_changed', json_build_object('namespace', t.namespace, 'environment', t.environment)::text) FROM (SELECT DISTINCT namespace, environment FROM d) t` - the final `SELECT` must read `nt` (and the other CTEs' counts) so the CTE executes.
3. `046_config_dead_rows_prune.down.sql`, one statement mirroring `041.down`: find the marker's `set_at`; join `config.config_keys_report_296` rows with `action = 'dead-row-deleted'` and `run_at = marker.set_at` to `config.config_values_premigration_296` rows with the same `(namespace, key, environment)`, `user_id IS NULL`, `snapshot_at >= run_at`, `DISTINCT ON (namespace, key, environment) ... ORDER BY ..., snapshot_at ASC` (the table is shared with 296's rename images; the first image at or after `run_at` is 305's); `INSERT INTO config.config_values` **without `id`**, `updated_by = 'system:config-migration-feature-305'`, `update_reason = 'feature 305: down restores a dead row'`, `ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING`; `pg_notify` each restored pair; delete the marker. A down on a database whose marker is absent changes nothing.
4. `scripts/config-wiring.json`: delete the two entries `marketdata`/`alpaca.paper` and `analysis`/`opportunity.sparkline_bars`; change only the `owner` of the `ledger`/`stream.notify_enabled` entry from `feature 305` to `feature 306` (matches `OWNER_RE` and `membership()`). Leave `platform`/`log_level`, `trading`/`risk.daily_loss_limit` and the `trading`/`broker.paper` `read-unseeded` entry.
5. `scripts/config-wiring-stored.json` is **hand-derived offline** (no local database, no step branches; `/sdd-execute` must never start a DB): remove the 4 row objects (`opportunity.sparkline_bars` production and staging, `alpaca.paper` production and staging; the `ledger`/`stream.notify_enabled` rows stay), then set `inputs_sha256` to `node -e "import('./scripts/check-config-wiring.mjs').then(m=>console.log(m.storedInputsSha256(process.cwd())))"` run **after** the two migration files are final. Any later edit or renumber of a file under `services/xstockstrat-config/migrations/` requires recomputing it. The CI `config-wiring-stored` job (`git diff --exit-code` after a regeneration on a scratch DB) is the live check.
6. Blast radius, run but **not edited** by this unit (each reads the real tree or a fixture): `baseline 1` (`--final` exit 0), `baseline 2` (stored `inputsSha256` equals computed; `findings.length > 0` stays true through the ledger, platform, trading entries), `baseline 3` (`SWEEP_277` filter `/^feature (305|306)$/` covers the re-owned ledger entry), `baseline 4`, `baseline 5`, `gate 7` (fixture `config-wiring-fixtures/gate/membership/scripts/config-wiring.json` keeps owner `feature 305`; `membership()` unchanged), `gate 5`, `ratchet 1/2`. If any of these needs an edit, stop and raise it (P-03); do not widen the unit.

**Verification** (offline, no database; union with Steps 5-6):
```
cd /home/user/xstockstrat
ls services/xstockstrat-config/migrations/046_config_dead_rows_prune.up.sql services/xstockstrat-config/migrations/046_config_dead_rows_prune.down.sql
head -n 5 services/xstockstrat-config/migrations/046_config_dead_rows_prune.up.sql | grep -c contract-of   # → 0
grep -nE "^\s*(BEGIN|COMMIT|ROLLBACK|LOCK)\b|config-migration-[0-9]{3}" services/xstockstrat-config/migrations/046_config_dead_rows_prune.up.sql services/xstockstrat-config/migrations/046_config_dead_rows_prune.down.sql   # → no output
sed -n '/dead_rows_305:begin/,/dead_rows_305:end/p' services/xstockstrat-config/migrations/046_config_dead_rows_prune.up.sql | grep -c "^[[:space:]]*('"   # → 4
node scripts/check-config-wiring.mjs --final   # exit 0
# then read both files: every INSERT/DELETE/marker in .up has its inverse in .down
```

---

### Step 5 - test: `migration-rerun.sh` adaptation and the `config-046.sql` assertions

**Status**: `done`
**Service**: `scripts/` (CI replay harness) and `xstockstrat-config` migration assertions
**Files**:
- `scripts/migration-rerun.sh` - modify
- `scripts/migration-assertions/config-046.sql` - create

**Reviewers**: xstockstrat-config owner - config key naming, environment/global-per-user scoping; DBA - run-order, replay safety

**Lands with**: `Step 4`, `Step 6`

**Codebase Evidence**:
- `scripts/migration-rerun.sh`: R/R+1 discovery by the unique `contract-of: ...040_config_markers.up.sql` header (loop over `"$cfg_dir"/[0-9]*.up.sql`), `R`, `cfg_pre=$((R - 1))`, `R1=$((R + 1))`, `r_actor`/`r1_actor`; pass 1 echo `==> pass 1: db-migrate.sh up (applies $r_base and $r1_base)`; pass 2 replay list (`for pair in indicators:007_... "config:$r_base" "config:$r1_base"`; each copied, rendered by `scripts/render-migrations.sh`, replayed `psql -v ON_ERROR_STOP=1 -1 -f`); pass 3 `refuse_down config "$cfg_pre" "${r_base%%_*}"` (a `goto 43` now runs `046.down` -> `045.down` -> `044.down`, which raises) and the recovery `db-migrator up` then `for want in ingest:14 analysis:27 "config:$R1"` (the **hard-coded** `R1` version check that a config migration above `R+1` breaks); the assertion loop runs `config-NNN.sql` for `n >= R` after pass 3 via `run_assertion` (GUCs from `-v seed_user_id ... r_actor r1_actor`); helpers `sql_value`, `fail`, `must_contain`, `counts`, `cfg_force`, `mig_version`.
- `scripts/migration-assertions/config-044.sql` shape: header listing ACs, `SELECT set_config('app.*', :'var', false) \gset`, independent `DO $$ ... RAISE EXCEPTION 'AC-N: ...' $$` blocks, a count compared outside `$$` via `\if`. Its AC-21 asserts `count(*) FILTER unmatched-signed-tuple = allow_tuples` **unscoped**; 305 writes 0 `unmatched-signed-tuple` rows on the CI fresh DB (Step 6 guards the sha equality), so that assertion is untouched.
- `config.config_values` is the table `listKeys` reads (`services/xstockstrat-config/src/grpc/configServiceImpl.ts` `listKeys`, `FROM config.config_values`): "no live global row" is the `ListKeys` proof of AC-1 (C-14).
- Fixtures loaded in pass 0 (`fixtures-pre-041.sql`) touch only `ledger`/`stream.notify_enabled` for these keys' neighbourhood; none of the 4 signed tuples, so the fresh-DB seeds (001/002/028) are what the migration deletes.
- CI job `migration-rerun` runs `scripts/migration-rerun.sh` under the migrator image against a TimescaleDB service and is the only place this runs; `/sdd-execute` must never start a database (HARD CONSTRAINT), so this step is verified by `bash -n`, grep and the integration PR's CI.

**TDD**: `N/A (CI-only bash/SQL harness: it needs a database, which /sdd-execute must not start; the integration PR's migration-rerun job is the live proof, and Step 6 supplies the offline red-green cycle for the unit)`

**Covers**: AC-1, AC-2, AC-6

**Instructions**:
1. Discover the 305 migration by **slug glob**, not the `contract-of` header: exactly one `"$cfg_dir"/[0-9]*_config_dead_rows_prune.up.sql` (fail otherwise), `d_base="$(basename ... .up.sql)"`, `d_actor='system:config-migration-feature-305'` (a literal: it carries no number).
2. Compute `cfg_top` = the highest config up-file version (loop over `"$cfg_dir"/[0-9]*.up.sql`, `10#` arithmetic) and use it instead of `$R1` **only** at the final `for want in ingest:14 analysis:27 "config:$R1"` version check. Leave every other `R1` use (the `refuse_down`/`guard_blocks` and mixed-twin sub-test logic around R+1) as is; do not re-pin `R1` to the top.
3. Pass 1 echo: name `$d_base` too (`applies $r_base, $r1_base and $d_base`).
4. Replay list: after the loop, replay `"config:$d_base"` **once** with an asserted no-change fingerprint: capture `count(*)` of `config.config_values`, `config.config_audit`, `config.config_keys_report_296`, `config.config_values_premigration_296` and `config.config_markers` before and after the replay and `fail` if they differ (AC-6: no further row deleted, no further audit row; the latch holds).
5. New **pass 2d**, after pass 2 and before pass 3, applying the 305 down and up **files directly with `psql -v ON_ERROR_STOP=1 -1 -f`** (never `migrate goto`, which would run 306/280 downs): (a) record a fingerprint of all untouched rows; apply the **down**: exactly 4 global rows reappear and hash (sha256 of `value_data`) to the signed shas, the marker `dead_rows_305` is absent, the restore audit rows are attributed to `$d_actor` with reason `feature 305: down restores a dead row`, the untouched-row fingerprint is unchanged (AC-6 second Then); (b) the rolled-back AC-2 sub-test in one psql session: `BEGIN;` update the production `marketdata`/`alpaca.paper` row's `value_data` to a different value, `\i` the up file, assert (in a `DO $$` that raises) 3 `dead-row-deleted` rows, the mutated row still present, exactly 1 `unmatched-signed-tuple` row whose `reason LIKE 'feature 305:%'` and whose `namespace/key/environment` is `marketdata/alpaca.paper/production`, and no value in the report; `ROLLBACK;`; (c) apply the **up** for real: the 4 rows are deleted again under a new marker `set_at`, with 4 `dead-row-deleted` report rows, 4 `premigration_296` rows with `snapshot_at >= set_at`, 4 audit rows from `$d_actor` with `new_value` NULL and `changed_at >= set_at` (AC-1 once more).
6. `config-046.sql` (runs for `n >= R` in the existing assertion loop; header lists AC-1, AC-2, AC-6; no psql variable needed because the actor is a literal), all scoped to the **current marker's** `set_at`: marker `dead_rows_305` exists with `set_by = 'system:config-migration-feature-305'`; no live global (`user_id IS NULL`) row for the 4 tuples in `config.config_values`; 4 `dead-row-deleted` rows with `run_at = set_at`; 0 `unmatched-signed-tuple` rows with `reason LIKE 'feature 305:%'`; 4 `premigration_296` rows for the tuples with `snapshot_at >= set_at` and `value_data` hashing to the signed shas; 4 audit rows with `changed_by` = the actor, `new_value IS NULL`, `changed_at >= set_at`; `ledger`/`stream.notify_enabled` (staging) still present and no `config_audit` row for it from the actor (AC-10 last Then, kept key); the per-user count for the two keys is **reported** (`RAISE NOTICE`), not asserted.
7. Pass 2d (c), the rolled-back AC-2 sub-test, is its **own `psql` session with an explicit `BEGIN; ... ROLLBACK;`** and no `-1` (combining `-1` with an explicit `BEGIN` nests transactions); pass 2d (a)-(b) use `-1` per file. Sub-test (c) must end rolled back so the later assertion loop and `config-044.sql`'s unscoped `unmatched-signed-tuple` count see 0.
8. **Verification honesty (W3)**: the offline commands below prove wiring and consistency, **not** the SQL semantics (latch gating, the `DISTINCT ON` down, the shared `premigration_296` join, pass 3's `046.down`). The executor must not report Steps 4-5 as *verified* - only as *offline-checked* - and must carry them as `[ ] awaiting CI` in `context.md` until the integration PR's `migration-rerun` and `config-wiring-stored` jobs are green; a red job there is fixed by data or harness edits, never by editing an applied migration (F-01).

**Verification**:
```
cd /home/user/xstockstrat
bash -n scripts/migration-rerun.sh
grep -n "cfg_top\|_config_dead_rows_prune\|pass 2d\|feature 305" scripts/migration-rerun.sh
grep -c "RAISE EXCEPTION" scripts/migration-assertions/config-046.sql   # ≥ 6
grep -c "BEGIN\|ROLLBACK" scripts/migration-rerun.sh   # pass 2d (c) present: ≥ 2 new matches vs. the pre-step tree
grep -n 'dead-row-deleted\|unmatched-signed-tuple' scripts/migration-rerun.sh scripts/migration-assertions/config-046.sql   # both actions asserted
grep -n 'R1' scripts/migration-rerun.sh   # every remaining use is R+1 logic, none at the final version check
# live proof: the integration PR's `migration-rerun` CI job (not run locally: /sdd-execute never starts a database)
```

---

### Step 6 - test: permanent `dead 2` and `dead 3` gate tests

**Status**: `done`
**Service**: `scripts/` (wiring-gate tooling, `xstockstrat-config` governance)
**Files**:
- `scripts/config-wiring.test.mjs` - modify (append `dead 2`, `dead 3`)

**Reviewers**: xstockstrat-config owner - config key naming, environment/global-per-user scoping, WatchConfig stream stability

**Lands with**: `Step 4`, `Step 5`

**Codebase Evidence**:
- `scripts/config-wiring.test.mjs`: `const REPO = path.resolve(HERE, '..')`, `baseline()` (reads `scripts/config-wiring.json`), `cli`, `baseline 1 @AC-7` (`cli(REPO, '--final')` exit 0). `cw.loadInventory(file)` returns rows with `value_sha256`, `global`; `scripts/config-heal/inventory-fresh.jsonl` stores prefixed keys (`marketdata.alpaca.paper`, `analysis.opportunity.sparkline_bars`), hence `cw.canonical` (exported in Step 1) for the comparison.
- 296 pattern: `services/xstockstrat-config/src/__tests__/relativeKeysMigration.test.ts` reads the sha recorded in `signoff.md` (`/^- R file sha256: \`([0-9a-f]{64})\`/m` after the section heading) and compares it with `sha256(file)`; Step 14 mirrors it for the file sha.
- Why the frozen set: a permanent test that compared the evidence's subscriber rows with the live `registry.receivers` would go red on an unrelated PR and pressure someone to edit a merged block (F-01 trap), so it evaluates only `evidence.subscribers` (`design.md` Rejected Alternatives).
- `fails.md` 2026-11-06 (295): list every test touching the baseline in the step; they are named in Step 4 Instruction 6 and run here.

**TDD**: `red-green required` (one red-to-green cycle for the whole unit: against the pre-unit tree `dead 2`/`dead 3` fail because the migration file, the assertion file and the baseline change are absent)

**Covers**: AC-7, AC-8

**Instructions**:
1. `dead 2 @AC-7`: load `scripts/config-heal/dead-rows-signed.sql` (the lines between the `-- dead_rows_305:` markers) and assert: exactly 4 tuples (`^[[:space:]]*('` count); each tuple is `deadRowVerdict(...) === 'dead'` against `cw.loadEvidence(scripts/config-heal/dead-row-evidence.tsv)` and its **frozen** `evidence.subscribers` (never the live registry); every signed namespace has at least one `single` subscriber in the evidence (blocks a vacuous `dead`); every signed `value_sha256` equals the `value_sha256` of the matching `(namespace, canonical(namespace, key), environment)` row of `cw.loadInventory('scripts/config-heal/inventory-fresh.jsonl')` (keeps 296's unscoped `unmatched-signed-tuple` count at 0 on CI); the migration is found by the slug glob `*_config_dead_rows_prune.up.sql` in `services/xstockstrat-config/migrations` (exactly one) and contains the block's between-marker lines byte-for-byte; `sha256(evidence file)` and `sha256(between-marker block)` equal the `- Evidence file sha256:` and `- Signed block sha256:` bullets under `# Feature 305 — dead-row sign-off` in `signoff.md`.
2. `dead 3 @AC-8`: `scripts/config-wiring.json` holds no `seeded-unread` entry for `analysis`/`opportunity.sparkline_bars` or `marketdata`/`alpaca.paper`; the `ledger`/`stream.notify_enabled` `seeded-unread` entry is present and its `owner` is exactly `feature 306`; `cli(REPO, '--final')` exits 0.
3. Single-consumer inline literals; do not edit any existing test (Step 4 Instruction 6).

**Verification** (the unit's tests; lint is n/a for `.mjs` gate tooling):
```
cd /home/user/xstockstrat
node --test scripts/config-wiring.test.mjs
node scripts/check-config-wiring.mjs --final
node scripts/check-config-wiring.mjs --doc-check
```

---

### Step 7 - service: delete the spent feature-296 sign-off module

**Status**: `done`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/app/maintenance/config_allow296.py` - delete

**Reviewers**: xstockstrat-indicators owner - formula sandboxing, numeric precision, timeout enforcement (`indicators.sandbox.timeout_ms`), no side-effects from formula execution

**Lands with**: `Step 8`

**Codebase Evidence**:
- `services/xstockstrat-indicators/app/maintenance/config_allow296.py` (241 lines) imports `from app.maintenance import legacy_authors as la` and only the stdlib/asyncpg otherwise; `grep -rn config_allow296` over the repo finds only the module, `services/xstockstrat-indicators/tests/test_config_allow296.py`, `services/xstockstrat-indicators/CLAUDE.md`, `docs/runbooks/config-rollout.md` and feature artifacts: no script, CI, Dockerfile or `pyproject.toml` entry. `app/maintenance/` also holds `config_inventory.py`, `legacy_authors.py`, `legacy_authors_ops.py`, `sandbox_keys_check.py` (untouched).
- The tool is valid only before the rename migration `044_config_keys_relative` reached `main-dev`, which it has (F-01); operator-assigned to this feature (`context.md` 2026-11-09).
- No runtime, proto, config, dependency or `uv.lock` change. `pyproject.toml` `[tool.coverage.run] omit` does not list the module, so its removal changes the measured ratio (threshold 50%).

**TDD**: `N/A (deletion; the paired test removal and the full suite in Step 8 are the proof)`

**Covers**: -

**Instructions**:
1. Delete `app/maintenance/config_allow296.py`. Do not touch `legacy_authors.py`, `legacy_authors_ops.py`, `config_inventory.py` or any `__init__.py`.

**Verification**: runs with Step 8 (the module's only importer is the test that Step 8 deletes):
```
cd /home/user/xstockstrat/services/xstockstrat-indicators
test ! -e app/maintenance/config_allow296.py
```

---

### Step 8 - test: delete the sign-off tool's tests; indicators suite stays green

**Status**: `done`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/tests/test_config_allow296.py` - delete

**Reviewers**: xstockstrat-indicators owner - formula sandboxing, numeric precision, timeout enforcement (`indicators.sandbox.timeout_ms`), no side-effects from formula execution

**Lands with**: `Step 7`

**Codebase Evidence**:
- `services/xstockstrat-indicators/tests/test_config_allow296.py` (292 lines, 19 tests) imports `app.maintenance.config_allow296` (`:11-12`); no other test or conftest imports it. `legacy_authors` tests (`tests/test_legacy_authors.py`, `test_legacy_authors_ops.py`, `test_legacy_authors_read_path.py`) are independent.
- CI: `python-test` indicators threshold 50% (`.github/workflows/ci.yml`; `spec-template.md` table: `pytest --cov=app --cov-fail-under=50`). Coverage of the deleted pair is unmeasured: **measure here** (design Open Risk "Indicators coverage").

**TDD**: `N/A (deletion of a test with its subject; coverage and the remaining suite are the proof)`

**Covers**: AC-9

**Instructions**:
1. Delete `tests/test_config_allow296.py`.
2. Run the Verification. If total coverage falls below 50%, stop and raise it (P-03) rather than adding tests or lowering the threshold. The second Then of AC-9 (the `config_allow296` grep) is closed by Step 9's Verification.

**Verification**:
```
cd /home/user/xstockstrat/services/xstockstrat-indicators
uv sync --extra dev
uv run pytest tests/test_legacy_authors.py tests/test_legacy_authors_ops.py tests/test_legacy_authors_read_path.py -q
uv run pytest --cov=app --cov-fail-under=50
uv run ruff check . && uv run ruff format --check .
```

---

### Step 9 - docs: retire the `config_allow296` references

**Status**: `done`
**Service**: `services/xstockstrat-indicators/CLAUDE.md`, `docs/runbooks/`
**Files**:
- `services/xstockstrat-indicators/CLAUDE.md` - modify
- `docs/runbooks/config-rollout.md` - modify

**Reviewers**: none

**Codebase Evidence**:
- `services/xstockstrat-indicators/CLAUDE.md` § Maintenance: the paragraph ends with the sentence beginning `` `app.maintenance.config_allow296` (feature 296 Step 16, DO console, `draft` / `rehearse`) replays the config rename migration ... see `docs/runbooks/config-rollout.md` § R sign-off and rehearsal. `` (now line 233; it was `:232` at design time). `app.maintenance.legacy_authors` and the rest of the paragraph stay.
- `docs/runbooks/config-rollout.md`: heading `### R sign-off and rehearsal (DO console, after the last rebase and renumber)` (now `:314`) through the 7-step list that names `config_allow296` (`:319`, `:327`, `:337`, `:342`); the next heading `### R refused after merge (\`uncovered-twin\`): repair the data, never the file` stays and is the live procedure. No other file outside `docs/roadmap/features/` references the tool or the section heading (grepped). `docs/runbooks/config-rollout.md` is in `--doc-check` scope (`check-config-wiring.mjs` `docCheck`) and in the CI `config-wiring` filter.
- Historical, left untouched: feature 296 artifacts, `scripts/config-heal/signoff.md` (the 296 section), `docs/roadmap/ledger/fails.md`, `docs/sdd/business-rules/platform.feature`.

**TDD**: `N/A (docs)`

**Covers**: -

**Instructions**:
1. Delete the `config_allow296` sentence from the indicators `CLAUDE.md` Maintenance paragraph (the preceding sentence about `legacy-formula-authors.md` becomes the paragraph's end).
2. In the runbook, replace the body of `### R sign-off and rehearsal ...` (the quote block and the numbered list) with a one-line note: `config_allow296` was removed by feature 305 - it was valid only before the rename migration reached `main-dev`, which it has - and a refused R is repaired with *R refused after merge* below. Keep a heading so inbound anchors survive.
3. Do not edit anything else in either file.

**Verification**:
```
cd /home/user/xstockstrat
grep -rn "config_allow296" services scripts .github docs/runbooks docs/patterns docs/setup CLAUDE.md   # → only the one runbook note
node scripts/check-config-wiring.mjs --doc-check   # exit 0
node --test scripts/config-wiring.test.mjs
```

---

### Step 10 - service: remove the dead `SCALAR_BOUNDS_REGISTRY` entry

**Status**: `done`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/grpc/configServiceImpl.ts` - modify

**Reviewers**: xstockstrat-config owner - config key naming, environment/global-per-user scoping, WatchConfig stream stability

**Codebase Evidence**:
- `services/xstockstrat-config/src/grpc/configServiceImpl.ts`: `const SCALAR_BOUNDS_REGISTRY: Record<string, { minValue: number; maxValue: number }>` with the single entry `'analysis.opportunity.sparkline_bars': { minValue: 1, maxValue: 500 },` (the only `sparkline_bars` hit under `services/xstockstrat-config/src`); `lookupScalarBounds(namespace, key)` keys on `` `${namespace}.${canonical(namespace, key)}` ``. It is a write-side validation entry, **not a reader** per the gate's extractor (so FR-3's "no static reader" holds), and it is dead once the row is gone (`SetConfig` on a missing key hits the existence gate first, but the bounds gate runs before it, so the entry would still reject an out-of-range write to a key nobody reads).
- No test references the entry (`grep -rn sparkline services/xstockstrat-config/src` -> the registry line only).
- Rollback asymmetry (accepted, `design.md` Open Risks): a `046.down`-restored `sparkline_bars` row has no bounds entry; harmless, no reader.

**TDD**: `red-green required` (one red-to-green cycle for the unit Steps 10+11: **write Step 11's guard first** and record that it fails while the entry exists, then remove the entry and re-run to green; the pair commits as one unit)

**Lands with**: `Step 11`

**Covers**: -

**Instructions**:
1. Delete exactly the line `'analysis.opportunity.sparkline_bars': { minValue: 1, maxValue: 500 },` from `SCALAR_BOUNDS_REGISTRY` (`'analysis.opportunity.valid_window_hours'` and neighbours stay). No other edit; the paired test is Step 11.

**Verification**:
```
cd /home/user/xstockstrat/services/xstockstrat-config
pnpm run lint
pnpm exec tsc && node --test dist/__tests__/setConfigScalarBounds.test.js
grep -c "sparkline_bars" src/grpc/configServiceImpl.ts   # → 0
```

---

### Step 11 - test: red-first guard that the dead key has no bounds entry

**Status**: `done`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/__tests__/setConfigScalarBounds.test.ts` - modify

**Reviewers**: xstockstrat-config owner - config key naming, environment/global-per-user scoping, WatchConfig stream stability

**Codebase Evidence**:
- `services/xstockstrat-config/src/__tests__/setConfigScalarBounds.test.ts`: the `describe('signal_decay_half_life_hours write-time scalar bounds')` block holds a recording-pool server (`recordingPool.query` answers the existence-gate `SELECT key, is_secret FROM config.config_values` with a registered, non-secret row), the helper `setConfig(value, key, namespace)` (admin scope `'7'`, `HEADER_USER_ID`), `insertQuery()`, and the opportunity cases `rejects out-of-bounds opportunity tuning writes ... — AC-4` and `accepts an in-bounds opportunity write without create_key — AC-5` (constants `OPP_REFRESH`, `OPP_CONC`, `OPP_WEIGHT`, `OPP_UNIVERSE`, sent relative).
- With the entry present, `setConfig({ intVal: 10000 }, 'opportunity.sparkline_bars')` is refused `INVALID_ARGUMENT` with `[1, 500]`; once the entry is gone it reaches the INSERT (the bounds gate runs before the existence gate, so this isolates the registry).
- C-13: single-consumer inline literal.

**TDD**: `red-green required` (in-unit red-first with Step 10: author this guard before the removal and capture the failing run)

**Lands with**: `Step 10`

**Covers**: AC-10

**Instructions**:
1. Add one `it` next to the AC-5 opportunity case: `'a retired opportunity key has no bounds entry: an out-of-range write is not rejected (feature 305)'` - reset `queries`, call `setConfig({ intVal: 10000 }, 'opportunity.sparkline_bars')`, assert `err === null` and `insertQuery()` is defined. It is red before Step 10 (INVALID_ARGUMENT) and green after.
2. Do not change any existing case.

**Verification**:
```
cd /home/user/xstockstrat/services/xstockstrat-config
pnpm run lint
pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40
pnpm exec tsc && node --test dist/__tests__/setConfigScalarBounds.test.js
```

---

### Step 12 - docs: remove stale references to the deleted keys

**Status**: `done`
**Service**: docs and durable business-rule comments
**Files**:
- `services/xstockstrat-analysis/CLAUDE.md` - modify
- `services/xstockstrat-marketdata/CLAUDE.md` - modify
- `docs/setup/alpaca.md` - modify
- `docs/runbooks/config-rollout.md` - modify
- `services/xstockstrat-config/docs/context-constitution.md` - modify
- `services/xstockstrat-config/docs/context-constitution-findings.md` - modify
- `services/xstockstrat-marketdata/docs/context-constitution-findings.md` - modify
- `docs/context-constitution-findings.md` - modify
- `docs/patterns/config-governance.md` - modify
- `services/xstockstrat-config/acceptance/opportunity-config-operability.feature` - modify (comment line only)
- `services/xstockstrat-ledger/acceptance/config-keys-relative-consumers.feature` - modify (comment line only)

**Reviewers**: none

**Codebase Evidence**:
- Rows found by grep on this tree: analysis `CLAUDE.md` row `` `opportunity.sparkline_bars` | int | `20` | **Inert - no reader in `app/`.** ... `` (`:604`); marketdata `CLAUDE.md` row `` `alpaca.paper` | bool | `true` | Use paper trading endpoint `` (`:63`); `docs/setup/alpaca.md` lines naming `marketdata.alpaca.paper` (code block `:96`, table row `:169`, comparison table row `:276`, switch-to-live step 2 `:285`); `docs/runbooks/config-rollout.md` example line `marketdata / alpaca.paper (marketdata.alpaca.paper)` (`:44`); config `docs/context-constitution.md` CONFIG-11 clause "`analysis.opportunity.sparkline_bars` is still registered (~L129) although nothing reads it"; config findings row "Seed migration `028` describes `analysis.opportunity.sparkline_bars` as ..." (`:14`), with a `## Resolved` table (`| Finding | Resolved | How confirmed |`) to receive it; marketdata findings row `:15` and root findings row `:23` say the documented `marketdata.alpaca.paper` key "has no reader".
- `docs/patterns/config-governance.md`: `## Per-Feature Registered Keys` is an append-only, newest-first log (first entry `### feature 282 - filter-otc-symbols`); past entries `:290/:395/:528` that name `sparkline_bars` are **not edited** (superseding behaviour gets a new entry). The actor-convention table's `system:config-migration-<NNN>` row (`| system:config-migration-<NNN> | xstockstrat-config (SQL migration) | ... first used by 031 (feature 243) |`) takes a sibling row.
- `services/xstockstrat-config/acceptance/opportunity-config-operability.feature` carries a `# --- feature 296: stored keys are namespace-relative ---` header comment; 184 `@AC-1` stays PRESERVE (scoped to migration 028 applied alone: no test applies all migrations and asserts the opportunity seed rows; `zeroTrapDescriptionMigration.test.ts` reads the 028 file, which is unchanged).
- `services/xstockstrat-ledger/acceptance/config-keys-relative-consumers.feature` comment (c) reads `...baseline 1 @AC-7: if the stored row left, ... (owner feature 305) ...`; `ledger`/`stream.notify_enabled` is **kept** (operator declined the C-16 CHANGE, 2026-11-09), so only the owner parenthetical becomes `feature 306`. The ledger `CLAUDE.md` key row, 295 @AC-15 and 304 @AC-12 are not touched.
- `--doc-check` scope (`docCheck` in `check-config-wiring.mjs`): root `CLAUDE.md`, the config-rollout runbook, `services/*/CLAUDE.md`, and the rule-sentence documents (`docs/patterns/config-governance.md`, config `docs/context-constitution.md`); edits must add no waiver or fixed-convention phrase.
- The three open defect reports under `docs/reports/2026-10-19-*` stay `open` (`.claude/skills/sdd-qa/reference/defect-filing.md`: bodies are point-in-time, sidecars belong to `/sdd-triage`/`/sdd-archiver`).

**TDD**: `N/A (docs and comments)`

**Covers**: -

**Instructions**:
1. Remove the analysis `CLAUDE.md` `sparkline_bars` row and the marketdata `CLAUDE.md` `alpaca.paper` row. Leave `TRADING_MODE` text and the ledger row alone.
2. `docs/setup/alpaca.md`: delete every `marketdata.alpaca.paper` occurrence found by `grep -n 'alpaca.paper' docs/setup/alpaca.md` (the code-block line, the table row and the comparison-table row - the count is whatever grep returns, expected three) and the switch-to-live step that sets it (renumber the following step). Do not fix the unrelated `ALPACA_PAPER` env wording (out of scope).
3. `docs/runbooks/config-rollout.md`: replace only the example line at the naming-convention block with a real seeded key, e.g. `analysis / opportunity.refresh_hour_utc (analysis.opportunity.refresh_hour_utc)`.
4. Config `docs/context-constitution.md` CONFIG-11: delete the trailing clause about `sparkline_bars` still being registered. Config findings: move the `sparkline_bars` row into `## Resolved` (resolved by feature 305: bounds entry removed, seed rows deleted by the dead-row migration, baseline entry closed). Marketdata findings row `:15` and root findings row `:23`: replace "the documented `marketdata.alpaca.paper` key has no reader" with "(the documented `marketdata.alpaca.paper` key was deleted by feature 305)"; keep the rest of those rows (the `TRADING_MODE` finding stays open).
5. `docs/patterns/config-governance.md`: (a) add a **new** entry `### feature 305 - config-dead-rows-prune (\`xstockstrat-config\`)` at the top of the per-feature log (above feature 282): registers no keys; deletes `analysis`/`opportunity.sparkline_bars` (int, default 20, seed `028`) and `marketdata`/`alpaca.paper` (bool, seeds `001`/`002`), staging and production, global, non-secret; the `config_dead_rows_prune` migration, named by slug only - **never write its number into docs**, so a merge-time renumber touches no doc (signed sha256 allowlist, snapshot, audit, reversible down); `ledger`/`stream.notify_enabled` is kept (baseline entry re-owned to feature 306); approval: owner + config team; (b) add the actor row `| system:config-migration-feature-<slug> | xstockstrat-config (SQL migration) | A number-free actor sentinel for a config migration whose content must not carry its number, so a merge-time renumber renames files only; first used by feature 305 |` below the `system:config-migration-<NNN>` row. Do not edit the entries at `:290/:395/:528`.
6. `opportunity-config-operability.feature`: append one comment line under the feature-296 header comment: feature 305 deletes the `analysis.opportunity.sparkline_bars` rows in the dead-row migration; 184 `@AC-1` stays scoped to migration 028 applied alone. Ledger `config-keys-relative-consumers.feature`: change `(owner feature 305)` to `(owner feature 306)` in the comment only. No `Scenario`, step, or tag changes in either file (C-16).
7. Do not edit `services/xstockstrat-config/CLAUDE.md` (see Execution Summary deviation). At integration, `context.md` records which items of the three open `docs/reports/2026-10-19-*` defect reports this feature closes (config `sparkline_bars` seed/bounds residue; marketdata inert `alpaca.paper` key); the reports stay `open`.

**Verification**:
```
cd /home/user/xstockstrat
grep -n "sparkline_bars" services/xstockstrat-analysis/CLAUDE.md services/xstockstrat-config/src/grpc/configServiceImpl.ts   # → none
grep -n "alpaca.paper" services/xstockstrat-marketdata/CLAUDE.md docs/setup/alpaca.md docs/runbooks/config-rollout.md   # → none
grep -n "feature 305" docs/patterns/config-governance.md
git diff origin/main-dev -U0 -- services/xstockstrat-ledger/acceptance services/xstockstrat-config/acceptance | grep -E '^[+-][^+-]' | grep -vE '^[+-][[:space:]]*#'   # → no output (comment-only)
grep -c "stream.notify_enabled" services/xstockstrat-ledger/CLAUDE.md   # unchanged, ≥ 1
node scripts/check-config-wiring.mjs --doc-check   # exit 0
node --test scripts/config-wiring.test.mjs
```

---

### Step 13 - migration: operator rehearsal P2 (rolled-back run of the exact final file, file sha record)

**Status**: `pending`
**Service**: `xstockstrat-config` and `scripts/config-heal`
**Files**:
- `scripts/config-heal/signoff.md` - modify (append to the `# Feature 305 — dead-row sign-off` section)
- `services/xstockstrat-config/migrations/046_config_dead_rows_prune.up.sql` - modify only on a renumber (rename; content unchanged)
- `services/xstockstrat-config/migrations/046_config_dead_rows_prune.down.sql` - modify only on a renumber (rename; content unchanged)
- (`docs/patterns/config-governance.md` and every other doc name the migration by slug only, so a renumber touches no doc)
- `scripts/migration-assertions/config-046.sql` - modify only on a renumber (rename; content unchanged)
- `scripts/config-wiring-stored.json` - modify only on a renumber (recompute `inputs_sha256`, which hashes paths)

**Reviewers**: DBA - migration numbering, embedded-data correctness, run-order, xstockstrat-config owner - config key naming, environment scoping; no value or user id in any recorded output

**Codebase Evidence**:
- **Operator-gated**: needs DO dev, DO prod and both homelab databases; the executor cannot run it. `/sdd-execute` pauses; the operator personally authors this commit. It runs **after the last rebase and renumber** (re-check `ls services/xstockstrat-config/migrations | tail` against `origin/main-dev`; the first of 305/306/280 to merge takes the lowest free number, the others rename files only).
- Precedent and lesson: the 296 sign-off ("a rolled-back rehearsal of the exact file immediately before merge, with `sha256(file)` pinned in CI", `fails.md` 2026-11-07) and `docs/runbooks/config-rollout.md` § *R refused after merge* (repair data, never the file). The rehearsal connection matters: the PRE_DEPLOY `db-migrator` uses the direct `:25060` URL, so a rehearsal on the pooled `:25061` URL is close but not identical - record which one ran.
- Expected result on every database: 4 `dead-row-deleted` and 0 `unmatched-signed-tuple` rows. A present row whose hash differs from the signed sha is a halt (P-03): repair or re-scope, never edit the merged file.

**TDD**: `N/A (operator rehearsal; the sha pin test is Step 14)`

**Covers**: -

**Instructions** (operator, per database - DO dev, DO prod, both homelabs; DB-owner `psql` per `docs/runbooks/operator-db-access.md`):
1. After a renumber, rename the files and recompute `inputs_sha256` (Step 4 Instruction 5) before rehearsing; the file **content** (and sha) does not change.
2. Rehearse the exact final file, rolled back: `BEGIN;` `\i <046 up file>` then `SELECT action, count(*) FROM config.config_keys_report_296 WHERE run_at = now() GROUP BY 1;` and `SELECT count(*) FROM config.config_values WHERE user_id IS NOT NULL AND ((namespace = 'analysis' AND key = 'opportunity.sparkline_bars') OR (namespace = 'marketdata' AND key = 'alpaca.paper'));` then `ROLLBACK;`. Expect 4 `dead-row-deleted`, no `unmatched-signed-tuple`, and a per-user count (reported; those rows are never deleted).
3. Record in `signoff.md` under the 305 section: per-database result, the connection (role and port), `- Migration file sha256: \`<64 hex of the final 046 up file>\`` (`shasum -a 256`), the operator and date. No value and no user id is recorded.

**Verification**:
```
cd /home/user/xstockstrat
ls services/xstockstrat-config/migrations/*_config_dead_rows_prune.up.sql services/xstockstrat-config/migrations/*_config_dead_rows_prune.down.sql
shasum -a 256 services/xstockstrat-config/migrations/*_config_dead_rows_prune.up.sql   # equals "Migration file sha256" in signoff.md
grep -n "Migration file sha256" scripts/config-heal/signoff.md
node scripts/check-config-wiring.mjs --final   # exit 0 (stored inputs_sha256 fresh after a renumber)
```

---

### Step 14 - test: pin the dead-row migration to its signed sha

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/__tests__/deadRowsMigration.test.ts` - create

**Reviewers**: xstockstrat-config owner - config key naming, environment/global-per-user scoping, WatchConfig stream stability

**Codebase Evidence**:
- Pattern: `services/xstockstrat-config/src/__tests__/relativeKeysMigration.test.ts` (reads the sha recorded in `scripts/config-heal/signoff.md` from `__dirname` via `path.resolve(__dirname, '../../../../scripts/config-heal/signoff.md')`, finds a section by heading, compares `crypto.createHash('sha256').update(sql).digest('hex')`; also asserts no `^\s*(BEGIN|COMMIT|ROLLBACK)\s*;`). Helper `src/__tests__/migrationSql.ts` exports `MIGRATIONS_DIR`, `findOne(suffix, ext)` (exactly one `*<suffix>.<ext>.sql`, returns content) and `splitStatements`; suites run as `node --test dist/__tests__/*.test.js` (`package.json` `test`, `test:coverage` with c8 `--lines 40`).
- The migration is found by the slug suffix `_config_dead_rows_prune` (never by number or by the `contract-of` header, which 305 must not carry), so a renumber does not break the test.
- Single-consumer inline literals; no new fixture home (C-13).

**TDD**: `red-green required`

**Covers**: -

**Instructions**:
1. Test file: (a) `findOne('_config_dead_rows_prune', 'up')`; read `- Migration file sha256: \`<64 hex>\`` under the heading `# Feature 305 — dead-row sign-off` in `signoff.md` and assert it equals `sha256(up file)` (an edit after the P2 rehearsal fails here, F-01); (b) the up and down files contain no statement matching `^\s*(BEGIN|COMMIT|ROLLBACK)\s*;`; (c) the up file has no `-- contract-of:` line in its first 5 lines (preserves `migration-rerun.sh`'s unique R discovery); (d) neither file contains `config-migration-` followed by a digit (number-free actor).
2. Red-first proof: run once with the recorded sha altered in the working tree (uncommitted) and confirm the failure; restore the real value and confirm green.

**Verification**:
```
cd /home/user/xstockstrat/services/xstockstrat-config
pnpm run lint
pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40
pnpm exec tsc && node --test dist/__tests__/deadRowsMigration.test.js
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._

### Deviation: Steps 4+5+6 - the marker-writer test in the config service
**Spec said**: Step 4 Instruction 2 `mk`: insert the marker `('dead_rows_305', now(), 'system:config-migration-feature-305')` into `config.config_markers`; Step 4 Instruction 6: the blast-radius tests are "run but not edited by this unit"; Files lists no config-service test.
**Actual**: `services/xstockstrat-config/src/__tests__/dormantAlias.test.ts` ("exactly one migration writes the marker row, and it is the contract of 040") counted any migration with `INSERT INTO config.config_markers`, so the new latch row made it fail (331/332). Its regex was narrowed to the alias-activation marker (`... VALUES ('relative_keys_v1'`); both assertions (exactly one writer, with the `contract-of: ...040_config_markers.up.sql` header) are unchanged. The file is staged with the unit.
**Reason**: the test's intent is that one migration activates the `relative_keys_v1` alias marker; a second migration keeping its own latch row in the same table does not violate it. Operator decision (sequential blocker, AskUserQuestion 2026-11-10): "Narrow the test". Recon/design missed it (the same shape as the fails.md 2026-11-06 test-blast-radius trap; ledger entry added).

### Deviation: Steps 4+5 - offline verification only
**Spec said**: Step 4/5 Verification (offline) and instruction 8: carry as `[ ] awaiting CI`.
**Actual**: verified offline: `bash -n`, greps, `pglast` (the real PostgreSQL grammar) parse of both migration files, the pass-2d `DO` bodies, `config-046.sql` and every SQL string the harness builds; gate tests 72/72; config service 332/332. No database was started (HARD CONSTRAINT).
**Disposition**: offline migration check - live apply deferred to CI (`migration-rerun`, `config-wiring-stored`).


# Implementation Spec: config-keys-relative-consumers

**Status**: `pending`
**Created**: 2026-11-09
**Feature**: `docs/roadmap/features/304-config-keys-relative-consumers/feature.md`
**Total Steps**: 26
**Feature Branch**: `feature/config-keys-relative-consumers`
**Tree**: `ccr-e901c541-u0cmts@ba46144` plus the pass-11 note-fix commit (includes `origin/main-dev@251f449`, feature 303, merged into the branch; the branch is `origin/main-dev` plus the 304 docs-only commits; the feature branch is not on origin, so the design artifacts on this branch are the base). The 303 merge moved agent lines (`client.py:1127-1128`, `CLAUDE.md` banner `:191-192`) and changed `plugins/strat-lab/skills/backtest/SKILL.md`, `.github/workflows/ci.yml` and several agent tests: every line cited for those files was re-verified after the merge

---

## Execution Summary

One integration PR, 12 commits, in the design's order: ledger, identity, notify, portfolio, marketdata, indicators, ingest, analysis (+ strat-lab skill), agent, trading, ui, then the finish commit Cf (gate close-out, doc sweep). Each family is a **test step then a service step that land as one atomic unit** (`**Lands with**`): the test step respells every modelling test/double through the canonical home and adds the S2 guard, so it is RED against the still-prefixed production code; the service step rewrites the literals, deletes exactly the `prefixed-read` baseline entries the ratchet would otherwise report `STALE`, and respells the service `CLAUDE.md` banner and "Config Keys Consumed" table. The test step is numbered first (ledger `fails.md` 2026-11-04: a covering test must precede its service step, or the pair be one step); neither step can pass its own Verification alone, which is exactly the `step-constraints.md` §C trigger.

**Drain rule (design, independently derived in rounds 3 and 4).** Baseline entries carry no `file`, so a shared id is still produced while any reader stays prefixed: an entry drains in the commit of its LAST reader (deleting earlier is RED, later is STALE). The running baseline count is the per-step oracle: 180 at start; after ledger 177, identity 175, notify 169, portfolio 160, marketdata 116, indicators 113, ingest 104, analysis 29, agent 27, trading 1, ui 0. Deferred ids: `indicators.sandbox.timeout_ms`/`startup_grace_ms` (indicators step defers, agent drains); `marketdata.fundamentals.provider` (marketdata defers, analysis drains); `platform.trading_state` (trading defers, ui drains); `platform.maintenance_mode` drains in trading.

**Verification blocks** (steps below name them; every command is run from the repo root):

- `V-GO(<svc>)`: `(cd services/xstockstrat-<svc> && export GOWORK=off && COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:")` (confirm >= 40%), `(cd services/xstockstrat-<svc> && GOWORK=off golangci-lint run --modules-download-mode=mod)`, `bash scripts/check-duplication.sh`, `bash scripts/check-watcher-copies.sh`.
- `V-PY(<svc>,<N>)`: `(cd services/xstockstrat-<svc> && pytest --cov=app --cov-fail-under=<N>)` and `(cd services/xstockstrat-<svc> && ruff check . && ruff format --check .)`, `bash scripts/check-watcher-copies.sh`. N = 50 indicators; 40 ingest, analysis, agent.
- `V-NODE(<svc>)`: `(cd services/xstockstrat-<svc> && pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40)`, `(cd services/xstockstrat-<svc> && pnpm run lint)`, `bash scripts/check-watcher-copies.sh`.
- `V-GATE(<svc>,<left>)`: `node scripts/check-config-wiring.mjs --final` exits 0 with no `STALE` line and no blocking line (`REPORTED:` lines are allowed); `node scripts/check-config-wiring.mjs --final --json | node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8"));const n=j.findings.filter(f=>f.kind==="prefixed-read"&&f.file.startsWith("services/xstockstrat-<svc>/")).length;console.log(n);process.exit(n?1:0)'` prints `0`; `node -e 'console.log(JSON.parse(require("fs").readFileSync("scripts/config-wiring.json","utf8")).findings.filter(f=>f.kind==="prefixed-read").length)'` prints `<left>`; `node --test scripts/config-wiring.test.mjs` passes (it is red only inside the Cf unit).
- **Residual-double sweep** (accepted residual from the design): each test step ends with a per-family grep over every test root for ad-hoc lambda/MagicMock/object-literal doubles that survive S2; every hit is either respelled (listed in that step's **Files**) or recorded in the Deviation Log with its reason.

**Rewrite rule (design).** Every getter, `SetConfig`/`GetSecret` key and key constant becomes the key relative to the namespace its watcher subscribes to. Runtime display strings keep the FQN (C-05): WARN/log text, error and reject strings (`window exceeds ledger.export.max_window_days`, `trading halted: platform.trading_state=HALTED`, marketdata `fmt.Errorf("marketdata.fundamentals.history.enabled is false")` at `marketdata_service.go:2252`), MCP tool text, `formulaReference.ts`. Event types, OTel instrument names, SQL schema names and `ingest.mcp_credential.<uuid>` are not reads and are never touched (recon Risk 11). Shared watcher cores (`watchcore.go`, `watch_core.py`, `configWatcher.ts`, `live_limits.py`), applied migrations and `catalog.tsv` are never edited (F-01; `scripts/check-watcher-copies.sh`).

**Acceptance coverage (C-15).** AC-1 Step 20; AC-2 Steps 1 (ledger), 3 (identity), 5 (notify), 7 (portfolio), 11 (indicators); AC-3 Step 9; AC-4 Step 15; AC-5 Step 22; AC-6 Step 7; AC-7, AC-8, AC-9, AC-10, AC-11 Step 24; AC-12 Steps 1 and 24 (clause (c) is bound to `baseline 1 @AC-7` run in Step 24); AC-13 Step 9 (registry lists respelled in Step 10, checked by the unit's gate run); AC-14 Step 21 (the `broker.paper` entry and registry receivers are edited there only; signed FR-4/AC-14); AC-15 Step 17; AC-16 Step 11; AC-17 Steps 7, 9, 11, 13, 15, 18, 20 (Go trading/marketdata/portfolio, Python indicators/ingest/analysis/agent). Red-first (design): AC-1..AC-6, AC-11, AC-13..AC-17, AC-12 (a)(b), AC-7/AC-8 schema halves. Characterization only (operator sign-off or unchanged code): AC-8 detector half, AC-9, AC-10, AC-12 kept-row clause, AC-15 (grep: RED prints 1, GREEN prints 0).

**Consumer surfaces (C-14).** UI `/trader` positions banner: Steps 22-23 (no new route, so no C-10(a) nav work). Agent sandbox-deadline reads (`formula_deadline_s`): Steps 18-19; no MCP tool signature or text changes. Both are named in the product spec and each has its own step pair.

**C-16 classification (inline; the `scenario-recon` subagent cannot be spawned from this session).** The 25 FQN-near-read-verb scenarios were read by their `Then`/`And` clauses against the durable suites: none pins a reader's literal. @154 AC-6/9 and @186 AC-3 name a key in a `Given` (display FQN); @258 AC-7 and @147 AC-13 assert the config server's snapshot content (296's stored keys, not a reader); @147 AC-6/7/11, @158 AC-8, @173 AC-1/2/4, @243 AC-3 have no key in a `Then`; @294 AC-12/32/38 name OTel instruments; @295 AC-24 and @278 AC-2/3 are gate/sign-off report text over fixtures. Verdict: PRESERVE all 25, no operator escalation. The C-16 CHANGEs (295 @AC-15, @AC-19 note, @AC-20 note, 243 @AC-2 note, 296 @AC-22/@AC-23) were signed 2026-11-09 and land in Steps 24-26. No Gherkin step runner exists outside `.venv` noise (grep for godog/pytest-bdd/behave/cucumber over `*.go|*.py|*.ts|*.json|*.toml|*.mjs` found only third-party packages), so `acceptance/*.feature` prose is display-only except the listed CHANGEs.

## Step Dependencies

- Step 1 [test] and Step 2 [service] land together (ledger): the test step's key-matching reader tests are RED until the literals change, and the service step's `--final` run needs the tests green. Same for 3+4, 5+6, 7+8, 9+10, 11+12, 13+14, 15+16, 18+19, 20+21, 22+23. Test-first numbering is deliberate (`fails.md` 2026-11-04 "enforce-config-key-wiring").
- Steps 20 and 21 (trading) additionally change `NewTradingService`'s signature (new required `platformCfgW`) and rename `config.NewSnapshotWatcher` to `MustSnapshotWatcher(ns, values)`: every caller and test call-site is in Step 20's **Files** except `cmd/server/main.go:99`, which is in Step 21's (break-radius audit: `cmd/server/main.go:99`, `trading_sizing_test.go:67`, 7 `NewSnapshotWatcher(` call sites in 4 test files plus the definition, 53 `cfgW:` literals in 13 test files).
- Steps 24, 25 and 26 land together (Cf): Step 25 removes `prefixed-read` from `BASELINE_KINDS`, adds `/via the alias until/i` to `DOC_BANNED` and widens the doc scan, so its own `--doc-check` Verification is red until Step 26 sweeps the caveat from the listed files, and the gate tests of Step 24 go red against the old script.
- Step 17 (strat-lab `SKILL.md`) follows Step 16 and must land in the same PR (AC-15); it stands alone (docs-only).
- The portfolio test (Step 7) reads `scripts/config-wiring-stored.json` at run time; Step 25 adds that path to the portfolio CI trigger (`.github/workflows/ci.yml:55`).
- Merge order only (not a step): 304 merges after 296 (already merged). Rebase collisions with 305/306 on `scripts/config-wiring.json`, `scripts/check-config-wiring.mjs`, `scripts/config-wiring.test.mjs` (merge-order rows 30/31): re-run `--final`, `node --test scripts/config-wiring.test.mjs` and `--doc-check` after any rebase.
- CLAUDE.md prose that names a key in FQN form as display text (e.g. notify's Web Push/fanout paragraphs, portfolio `portfolio.marketdata.*`, trading `trading.risk.sizing_enabled`, `docs/runbooks/mcp-tools.md`) may stay (C-05: FQN is display-only); banners and "Config Keys Consumed" tables are rewritten to (namespace, relative key).
- `config_allow296.py` (+ `tests/test_config_allow296.py`) stays; feature 305 owns its removal (already recorded in `merge-order.md` and 305's `context.md`; verified by grep, no edit needed).
- Not done here (named follow-ups): dead-row deletion is feature 305, alias removal is feature 306.

---

### Step 1 — test: ledger reads relative keys with the alias off

**Status**: `done`
**Service**: `xstockstrat-ledger`
**Files**:
- `services/xstockstrat-ledger/src/__tests__/configWatcher.test.ts` — modify (`KEY` `:19` becomes `'export.enabled'`; `readKeyLine` derives from `KEY`)
- `services/xstockstrat-ledger/src/__tests__/eventRowResolver.test.ts` — modify (`:156` expects `['stream.resolve_timeout_ms']`)
- `services/xstockstrat-ledger/src/__tests__/ledgerServiceImpl.test.ts` — modify (`makeExportImpl` `:729-743` (the `getBool`/`getInt` doubles at `:739-740`) key-matching doubles; new alias-off tests)

**Reviewers**: Service owner `xstockstrat-ledger` — append-only invariant, event ordering, `config.read_key` log spelling

**Codebase Evidence**:
- Confirmed via: `grep -n "KEY = " services/xstockstrat-ledger/src/__tests__/configWatcher.test.ts` -> `:19 const KEY = 'ledger.export.enabled';`
- Existing double ignores the key: `ledgerServiceImpl.test.ts:738-741` `getBool: (_k, d) => (cfg.enabled === undefined ? d : cfg.enabled)`, `getInt: (_k, d) => (cfg.maxDays === undefined ? d : cfg.maxDays)`.
- The error text stays FQN (021 @AC-5 PRESERVE): `ledgerServiceImpl.test.ts:804` asserts `'window exceeds ledger.export.max_window_days'`.
- Read-evidence assertions follow the key for free (recon): `configWatcher.test.ts:19,95,142-157`.
- No fixture home has a config double (`src/__tests__/fixtures/` has no config entry, `INVENTORY.md:9-15`), so the key-matching doubles are single-consumer inline literals (C-13 compliant).

**Lands with**: Step 2

**TDD**: red-green required

**Covers**: AC-2 (ledger row), AC-12 (clauses a, b)

**Instructions**:
1. `configWatcher.test.ts`: set `KEY = 'export.enabled'`. The `config.read_key ns=ledger key=export.enabled` record (AC-12 b) follows with no other edit; confirm the `readKeyLine` helper builds from `KEY`.
2. `eventRowResolver.test.ts:156`: change the asserted key list to `['stream.resolve_timeout_ms']`.
3. `ledgerServiceImpl.test.ts`: make the `config` double of `makeExportImpl` key-sensitive: `getBool` returns `cfg.enabled` only when `k === 'export.enabled'`, `getInt` returns `cfg.maxDays` only when `k === 'export.max_window_days'`, both else the passed default. Existing callers (`makeExportImpl({maxDays: 365})`, `({})`) keep passing because 365 equals the default.
4. Add `AC-2 ledger`: `makeExportImpl({ maxDays: 30 })` with a 60-day window is rejected `INVALID_ARGUMENT` (code 3) with message `window exceeds ledger.export.max_window_days` (stored 30 differs from default 365; a prefixed reader would see 365 and accept).
5. Retitle the EXISTING test at `ledgerServiceImpl.test.ts:786-793` (`makeExportImpl({ enabled: false })` at `:787`) (`makeExportImpl({ enabled: false })` -> `exportEvents` fails `FAILED_PRECONDITION`, code 9) to carry `AC-12 a`; no duplicate test. It goes red against the prefixed reader once the double is key-sensitive, because the double no longer matches `'ledger.export.enabled'`.
6. Residual-double sweep: `grep -rnE "(getBool|getInt|getString)" services/xstockstrat-ledger/src/__tests__` and list any other double that ignores or prefix-matches a key.

**Verification**:
Before Step 2 (RED): `(cd services/xstockstrat-ledger && pnpm test 2>&1 | grep -E "AC-2 ledger|AC-12 a|not ok|fail")` shows the new cases failing. After Step 2: `V-NODE(ledger)`.

---

### Step 2 — service: ledger relative literals, baseline drain, banner

**Status**: `done`
**Service**: `xstockstrat-ledger`
**Files**:
- `services/xstockstrat-ledger/src/grpc/ledgerServiceImpl.ts` — modify (`:378`, `:388`)
- `services/xstockstrat-ledger/src/services/eventRowResolver.ts` — modify (`:6` `RESOLVE_TIMEOUT_KEY`)
- `scripts/config-wiring.json` — modify (delete 3 `prefixed-read` entries, namespace `ledger`)
- `services/xstockstrat-ledger/CLAUDE.md` — modify (banner `:74-75`, table `:74-86` region)

**Reviewers**: Service owner `xstockstrat-ledger` — append-only invariant, event ordering, `config.read_key` log spelling

**Codebase Evidence**:
- `ledgerServiceImpl.ts:378` `this.config.getBool('ledger.export.enabled', true)`; `:388` `this.config.getInt('ledger.export.max_window_days', 365)`; `eventRowResolver.ts:6` `export const RESOLVE_TIMEOUT_KEY = 'ledger.stream.resolve_timeout_ms'` (read at `:13`).
- Gate registry receivers for ledger are already per-file strings (`config-wiring.json` receivers `ledgerServiceImpl.ts:this.config`, `eventRowResolver.ts:config` -> `"ledger"`), so no registry edit.
- Baseline entries to delete: `ledger.export.enabled`, `ledger.export.max_window_days`, `ledger.stream.resolve_timeout_ms` (the gate lists exactly these 3 for ledger; count 180 -> 177).
- CLAUDE.md banner: `services/xstockstrat-ledger/CLAUDE.md:74-75` ("the stored key equals the reader's exact spelling ... Target form is namespace-relative, cutover in feature 296"); table rows at `:79-86` carry `ledger.`-prefixed keys.

**Lands with**: Step 1

**TDD**: red-green required

**Covers**: —

**Instructions**:
1. Change the three literals to `'export.enabled'`, `'export.max_window_days'`, `'stream.resolve_timeout_ms'`. Leave the FQN error string `window exceeds ledger.export.max_window_days` unchanged (021 @AC-5).
2. In `scripts/config-wiring.json`, delete exactly the three ledger `prefixed-read` entries listed above.
3. `CLAUDE.md`: replace the two-line banner with the relative rule ("the stored key is namespace-relative; the FQN is display-only; every read key is seeded by a config migration", no 295/296 transition note); in the table list the relative keys under `Namespace: ledger` (`stream.notify_enabled`, `retention.years`, `compression.after_days`, `export.enabled`, `export.max_window_days`, `stream.resolve_timeout_ms`). The three "Documented, not yet implemented" rows have no reader: respell them anyway for consistency, keep their notes.

**Verification**:
`V-NODE(ledger)`; `V-GATE(ledger,177)`; `grep -nE "['\"]ledger\.(export\.(enabled|max_window_days)|stream\.resolve_timeout_ms)['\"]" -r services/xstockstrat-ledger/src` prints nothing; `grep -n "cutover in feature 296" services/xstockstrat-ledger/CLAUDE.md` prints nothing.

---

### Step 3 — test: identity reads relative keys with the alias off

**Status**: `done`
**Service**: `xstockstrat-identity`
**Files**:
- `services/xstockstrat-identity/src/__tests__/configWatcher.test.ts` — modify (`KEY` `:19`; core keys `:105-120`)
- `services/xstockstrat-identity/src/__tests__/identityServiceImpl.test.ts` — modify (new key-matching double and alias-off test near the `makeImpl` double `:58`)

**Reviewers**: Service owner `xstockstrat-identity` — JWT expiry and rotation, no plaintext secrets in config

**Codebase Evidence**:
- `configWatcher.test.ts:19` `const KEY = 'identity.jwt.access_ttl_seconds'`; `:105-106` `'identity.flags.enabled'`, `'identity.labels.issuer'`; `:109-113` `getBool`/`getString` and `warnsNaming(...)`; `:118-120` `'identity.jwt.absent_ttl'`; `:119` already-relative `'bare_ttl'`.
- Doubles that ignore the key (leave unchanged, they pass defaults): `identityServiceImpl.test.ts:58,342,1126,1373`, `identityServiceImpl.otlp.test.ts:40`, `identityTelemetry.test.ts:13`.
- Reader accessors: `identityServiceImpl.ts:139-145` (`accessTtlSeconds` is consumed at `:311,:321,:323` to build `expiresIn`).

**Lands with**: Step 4

**TDD**: red-green required

**Covers**: AC-2 (identity row)

**Instructions**:
1. `configWatcher.test.ts`: `KEY = 'jwt.access_ttl_seconds'`; respell `:105-120` to `flags.enabled`, `labels.issuer`, `jwt.absent_ttl`. Where `warnsNaming(...)` asserts WARN text, keep the assertion matching the FQN (the core's `fqn()` re-prefixes `identity.` for display) via a separate FQN constant (`KEY_FQN`, also at `:99`'s zero-WARN assertion and `:111-113,120-121,127`), so the assertion cannot pass on a bare substring.
2. `identityServiceImpl.test.ts`: add a key-matching local double `{ getInt: (k, d) => (k === 'jwt.access_ttl_seconds' ? 1800 : d) }` (stored 1800, default 900) and an alias-off test that issues a token pair (the path through `identityServiceImpl.ts:311-323`) and asserts `expiresIn === 1800`. Single consumer, so inline (C-13).
3. Residual-double sweep: `grep -rn "getInt" services/xstockstrat-identity/src/__tests__` — the six defaults-only doubles in the evidence (`identityServiceImpl.test.ts:58,342,1126,1373`, `identityServiceImpl.otlp.test.ts:40`, `identityTelemetry.test.ts:13`) are audited and unchanged.

**Verification**:
Before Step 4 (RED): `(cd services/xstockstrat-identity && pnpm test 2>&1 | grep -E "1800|not ok|error TS")` shows the new test failing (a `tsc` compile error would otherwise look like a pass). After Step 4: `V-NODE(identity)`.

---

### Step 4 — service: identity relative literals, baseline drain, banner

**Status**: `done`
**Service**: `xstockstrat-identity`
**Files**:
- `services/xstockstrat-identity/src/grpc/identityServiceImpl.ts` — modify (`:140`, `:144`)
- `scripts/config-wiring.json` — modify (delete 2 `prefixed-read` entries, namespace `identity`)
- `services/xstockstrat-identity/CLAUDE.md` — modify (banner `:69-70`, table `:69-77`, stray prefixed mention near `:40`)

**Reviewers**: Service owner `xstockstrat-identity` — JWT expiry and rotation, no plaintext secrets in config

**Codebase Evidence**:
- `identityServiceImpl.ts:140` `this.config.getInt('identity.jwt.access_ttl_seconds', 900)`; `:144` `this.config.getInt('identity.jwt.refresh_ttl_seconds', 2592000)`.
- Baseline entries: `identity.jwt.access_ttl_seconds`, `identity.jwt.refresh_ttl_seconds` (175 left). Registry receiver `identityServiceImpl.ts:this.config` -> `"identity"` already present.
- Banner "Target form is namespace-relative" at `services/xstockstrat-identity/CLAUDE.md:70`. Audit event names (`identity.user.*`, `identity.audit.*`, `identity.login.failures`) are not reads: do not touch.

**Lands with**: Step 3

**TDD**: red-green required

**Covers**: —

**Instructions**: change the two literals to `'jwt.access_ttl_seconds'` and `'jwt.refresh_ttl_seconds'`; delete the two baseline entries; rewrite the banner and table rows to relative keys under `Namespace: identity`, and fix the prefixed key mention near line 40 (grep `identity\.jwt` in the file).

**Verification**:
`V-NODE(identity)`; `V-GATE(identity,175)`; `grep -rnE --exclude-dir=__tests__ "['\"]identity\.jwt\.[a-z_]+['\"]" services/xstockstrat-identity/src` prints nothing; `grep -n "cutover in feature 296" services/xstockstrat-identity/CLAUDE.md` prints nothing.

---

### Step 5 — test: notify reads relative keys with the alias off

**Status**: `done`
**Service**: `xstockstrat-notify`
**Files**:
- `services/xstockstrat-notify/src/__tests__/fanout.test.ts` — modify (`GATE` `:77`, `:123`, `:142`, `:157`; `fakeConfig` `:27`; new alias-off test)
- `services/xstockstrat-notify/src/__tests__/webPush.test.ts` — modify (`cfg()` double `:116`)
- `services/xstockstrat-notify/src/__tests__/notifyServiceImpl.test.ts` — modify (`:98-107` `fanoutCfg` double)
- `services/xstockstrat-notify/src/__tests__/configWatcher.test.ts` — modify (`KEY` `:19`, `absent` `:110`)

**Reviewers**: Service owner `xstockstrat-notify` — stream delivery guarantees, backpressure, alert deduplication

**Codebase Evidence**:
- `fanout.test.ts:77` `GATE = { int: { 'notify.fanout.min_severity': 2 }, float: { 'notify.fanout.min_confidence_threshold': 0.7 } }` — both values equal the code defaults (`fanout.ts:62,73`), the silent-pass risk from recon Risk 7; `:27-33` `fakeConfig` looks up `cfg.int?.[k] ?? d`.
- `webPush.test.ts:116` `getInt: (k, d) => (k === 'notify.push.min_severity' ? minSev : d)`; `notifyServiceImpl.test.ts:101-107` matches `'notify.fanout.min_severity'`, `'notify.fanout.dedup_window_seconds'`, `'notify.fanout.min_confidence_threshold'`, `'notify.fanout.sendgrid_from_email'`, `'notify.fanout.sendgrid_to_email'`; `configWatcher.test.ts:19,110` `'notify.fanout.min_confidence_threshold'`, `'notify.fanout.absent_threshold'`.
- Metric names (`notify.delivery`, `notify.stream.*`) are not reads; leave `telemetryAllowlist.test.ts` and `notifyServiceImpl.test.ts:704` alone.

**Lands with**: Step 6

**TDD**: red-green required

**Covers**: AC-2 (notify row)

**Instructions**:
1. Respell every key in the four files to `fanout.min_severity`, `fanout.min_confidence_threshold`, `fanout.dedup_window_seconds`, `fanout.sendgrid_from_email`, `fanout.sendgrid_to_email`, `push.min_severity`, `fanout.absent_threshold`. Because the doubles ignore unknown keys, a leftover prefixed key silently returns the default; the sweep below finds them.
2. Add `AC-2 notify`: with `{ int: { 'fanout.min_severity': 3 } }` an alert of severity 2 posts nothing (stored 3 differs from default 2; a prefixed reader sees 2 and posts once). Reuse `makeDispatcher`/`makeAlert`/`stubFetch` (`fanout.test.ts`).
3. Split `configWatcher.test.ts` `KEY` as Step 3 does for identity: `KEY = 'fanout.min_confidence_threshold'` for the snapshot/read and a separate `KEY_FQN = 'notify.fanout.min_confidence_threshold'` for the `warnsNaming` assertions (`:99,106,113`), so the WARN check proves the FQN and not a bare substring (`:113` asserts the absent key: give it `ABSENT_FQN = 'notify.fanout.absent_threshold'` too). Residual-double sweep: `grep -rnE "notify\.(fanout|push)\." services/xstockstrat-notify/src/__tests__` prints only `KEY_FQN` and `ABSENT_FQN`, nothing else.

**Verification**:
Before Step 6 (RED): `(cd services/xstockstrat-notify && pnpm test 2>&1 | grep -E "AC-2 notify|not ok")`. After Step 6: `V-NODE(notify)`.

---

### Step 6 — service: notify relative literals, baseline drain, banner

**Status**: `done`
**Service**: `xstockstrat-notify`
**Files**:
- `services/xstockstrat-notify/src/fanout/fanout.ts` — modify (`:62`, `:73`, `:83`, `:110`, `:111`)
- `services/xstockstrat-notify/src/fanout/webPush.ts` — modify (`:101`)
- `scripts/config-wiring.json` — modify (delete 6 `prefixed-read` entries, namespace `notify`)
- `services/xstockstrat-notify/CLAUDE.md` — modify (banner `:72-73`, table `:72-87`)

**Reviewers**: Service owner `xstockstrat-notify` — stream delivery guarantees, backpressure, alert deduplication

**Codebase Evidence**:
- `fanout.ts:62` `getInt('notify.fanout.min_severity', 2)`, `:73` `getFloat('notify.fanout.min_confidence_threshold', 0.7)`, `:83` `getInt('notify.fanout.dedup_window_seconds', 300)`, `:110` `getString('notify.fanout.sendgrid_from_email')`, `:111` `getString('notify.fanout.sendgrid_to_email')`; `webPush.ts:101` `getInt('notify.push.min_severity', 2)`.
- 6 baseline entries (`notify.fanout.dedup_window_seconds`, `.min_confidence_threshold`, `.min_severity`, `.sendgrid_from_email`, `.sendgrid_to_email`, `notify.push.min_severity`); 169 left. Receivers `fanout.ts:this.config`, `webPush.ts:this.config` -> `"notify"` already registered.
- Banner at `services/xstockstrat-notify/CLAUDE.md:73`. Documented-but-unread rows (recon Risk 13: `stream.max_subscribers`, `alert.retention_days`, `alert.max_body_bytes`) get relative spelling with their notes kept.

**Lands with**: Step 5

**TDD**: red-green required

**Covers**: —

**Instructions**: rewrite the six literals to the relative keys of Step 5; delete the six entries; rewrite banner and table under `Namespace: notify`.

**Verification**:
`V-NODE(notify)`; `V-GATE(notify,169)`; `grep -rnE --exclude-dir=__tests__ "['\"]notify\.(fanout|push)\.[a-z_]+['\"]" services/xstockstrat-notify/src` prints nothing; `grep -n "cutover in feature 296" services/xstockstrat-notify/CLAUDE.md` prints nothing.

---

### Step 7 — test: portfolio doubles, stored-set test and alias-off proofs

**Status**: `done`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/config/config.go` — modify (add exported `MustSnapshotWatcher(ns, values)` canonical double next to `Watcher`)
- `services/xstockstrat-portfolio/internal/config/config_test.go` — modify (`:110-113`, `FactorMap` tests, AC-17 test)
- `services/xstockstrat-portfolio/internal/service/watchlist_service_test.go` — modify (`fakeConfig` `:259-266` guard; keys `:384-385,472-473,486-487,503-504,517,1379-1380,1593,1652-1653,1783`)
- `services/xstockstrat-portfolio/internal/service/portfolio_quote_deadline_test.go` — modify (`:111,250-252`; new AC-2 risk test near `:445`)
- `services/xstockstrat-portfolio/internal/service/offline_valuation_test.go` — modify (`:292,345`)
- `services/xstockstrat-portfolio/internal/service/signal_prune_test.go` — modify (`TestSignalPrune_IntervalReadsSeededRow` `:173-200`; the stored file is `{"rows":[{namespace,key,value_type,default_value,...}]}`; drop the now-unused `regexp` import and add `encoding/json`)

**Reviewers**: Service owner `xstockstrat-portfolio` — P&L accuracy, position snapshot consistency, concurrent write safety

**Codebase Evidence**:
- `config.go:45` `type Watcher struct{watchCore; namespace ...}`, `newWatcher(...)` and `ApplyUpdate` core API; the unexported `newTestWatcher` `config_test.go:78-85` cannot be imported by service tests, hence the exported double (design S2).
- `fakeConfig{vals map[string]int64}` `watchlist_service_test.go:259-266`, reused across 3 test files.
- `signal_prune_test.go:173-200` globs migration `*_portfolio_signal_prune_interval.up.sql` and asserts equality with `signalPruneIntervalKey` (F-01: applied 037/039 are never edited). The generated stored set holds the row: `scripts/config-wiring-stored.json` rows with `namespace: "portfolio"`, `key: "watchlist.signal_prune_interval_seconds"`, `value_type: "int"`, `default_value: "300"`, `file: "037_portfolio_signal_prune_interval.up.sql"`.
- AC-2 portfolio reader: `portfolio_service.go:1280` `s.cfg.GetFloat("portfolio.risk.max_drawdown_pct", 0.10)` with `s.cfg *config.Watcher` (`:44`); the template test is `portfolio_quote_deadline_test.go:470-490` (`TestCheckRiskLimits_AC9_...`, `expectDrawdowns(mock, [3]any{"brk-1", 800.0, 1000.0})`, `recordingNotify`).
- Other `cfg: &config.Watcher{}` literals (`portfolio_fill_sync_race_test.go:65`, `portfolio_offline_test.go:256,308`, `portfolio_sync_cancel_test.go:35`, `portfolio_telemetry_test.go:514`) never read a key: unchanged. Event/metric names (`portfolio.watchlist.*`, `portfolio.position.*`, `portfolio.consumer.events`, `telemetry_allowlist_test.go:39`) are not reads.
- jscpd threshold `minTokens: 100` (`.jscpd.json:4`): keep `MustSnapshotWatcher` to a few lines (design Open Risk).

**Lands with**: Step 8

**TDD**: red-green required

**Covers**: AC-2 (portfolio row), AC-6, AC-17 (Go portfolio rows)

**Instructions**:
1. `config.go`: add `func MustSnapshotWatcher(ns string, values map[string]*configv1.ConfigValue) *Watcher` that builds `&Watcher{namespace: ns}`, panics with a message naming the key and its relative spelling (`strings.TrimPrefix`) when any key starts with `ns + "."`, and applies the snapshot with `w.ApplyUpdate(ns, &configv1.ConfigSnapshot{Namespace: ns, UpdateType: ..._SNAPSHOT, Values: values})`, mirroring marketdata's `NewSnapshotWatcher` (`internal/config/config.go:134-142`); add the `strings` import. The panic message must carry a service-specific prefix (`portfolio:` / `marketdata:`) so the three `ns`-parameterised bodies do not form an identical token run: `.jscpd.json` ignores `*_test.go` but not `config.go`, and the old versions escaped `minTokens: 100` only because they differed in a string literal. Run `bash scripts/check-duplication.sh` right after this step, before calling the unit green.
2. `config_test.go`: respell `portfolio.risk.max_drawdown_pct` to `risk.max_drawdown_pct` (`:110,113,114`); add the missing `FactorMap` reader test (none exists today): `MustSnapshotWatcher("portfolio", {"exposure.factor_map": '{"AAPL":"Tech"}'}).FactorMap()["AAPL"] == "Tech"`, red against the prefixed `FactorMapKey` (Step 8 changes the constant); add the AC-17 table test (`portfolio.any.key` panics naming both spellings; `any.key` = 7 returns 7).
3. `watchlist_service_test.go` (add the `strings` import; `config.go` needs it too for `MustSnapshotWatcher`): add the same prefix guard to `fakeConfig.GetInt` (panic naming key and relative spelling when `strings.HasPrefix(key, "portfolio.")`) and respell all listed keys to `watchlist.max_per_user`, `watchlist.max_symbols_per_list`, `marketdata.servability_timeout_ms`. AC-17 row `portfolio fakeConfig` is a test that reads `portfolio.any.key` and expects the panic, and that `fakeConfig{vals: {"any.key": 7}}.GetInt("any.key", 0) == 7`.
4. `portfolio_quote_deadline_test.go`: respell `marketdata.quote_timeout_ms` (`:111,250-252`); add `AC-2 portfolio`: `svc.cfg = config.MustSnapshotWatcher("portfolio", {"risk.max_drawdown_pct": FloatVal 0.2})`, one account at 15% drawdown (`expectDrawdowns(mock, [3]any{"brk-1", 850.0, 1000.0})`, empty positions rows as in `TestCheckRiskLimits_242_AC6_...`), and assert no drawdown alert (default 0.10 would alert; stored 0.2 does not).
5. `offline_valuation_test.go`: `marketdata.quote_timeout_ms`, `marketdata.last_close_lookback_days`.
6. `signal_prune_test.go`: rewrite `TestSignalPrune_IntervalReadsSeededRow` to open `scripts/config-wiring-stored.json` (repo root is four directories above `internal/service`), select any row with `namespace == "portfolio"` and `key == signalPruneIntervalKey` (one per environment, production and staging are identical), require `value_type == "int"`, parse `default_value`, run `pruneInterval()` with `fakeConfig{vals: {key: seeded}}` as today. No `.up.sql` is read or edited.
7. Residual-double sweep: `grep -rn "portfolio\.[a-z_]*\.[a-z_.]*" --include=*_test.go services/xstockstrat-portfolio | grep -v "portfolio\.\(position\|watchlists\|watchlist\.\(signal_entry\|created\|updated\|deleted\)\|snapshot\|risk\.drawdown_breach\|consumer\|mark_source\|marketdata_fetch\)"` prints only the intended survivors: the AC-17 `<ns>.any.key` literals and the FQN constants this step names (each a documented display/WARN string).

**Verification**:
Before Step 8 (RED): `(cd services/xstockstrat-portfolio && GOWORK=off go test ./internal/... 2>&1 | grep -E "^--- FAIL|panic:")` shows the named AC-2/AC-6/AC-17/FactorMap tests failing (not `[build failed]`: a compile error also prints `FAIL`, so confirm the package compiled). After Step 8: `V-GO(portfolio)`; `git diff --name-only $(git merge-base HEAD origin/main-dev) -- services/xstockstrat-config/migrations` prints nothing (F-01; unlike `git status`, it still holds after per-step commits).

---

### Step 8 — service: portfolio relative literals, baseline drain, banner

**Status**: `done`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/config/config.go` — modify (`:102` `FactorMapKey`)
- `services/xstockstrat-portfolio/internal/service/offline_valuation.go` — modify (`:86`)
- `services/xstockstrat-portfolio/internal/service/portfolio_service.go` — modify (`:536,554,1280,1281,2135,2139`)
- `services/xstockstrat-portfolio/internal/service/signal_prune.go` — modify (`:12`)
- `scripts/config-wiring.json` — modify (delete 9 `prefixed-read` entries, namespace `portfolio`)
- `services/xstockstrat-portfolio/CLAUDE.md` — modify (banner `:105-106`, table `:105-123`, stale paragraph `:108-111`)

**Reviewers**: Service owner `xstockstrat-portfolio` — P&L accuracy, position snapshot consistency, concurrent write safety

**Codebase Evidence**:
- `config.go:102` `const FactorMapKey = "portfolio.exposure.factor_map"` (the WARN at `:110` is a display string and keeps the FQN); `signal_prune.go:12` `const signalPruneIntervalKey = "portfolio.watchlist.signal_prune_interval_seconds"` (event types at `:60,:70` are not reads); `offline_valuation.go:86`, `portfolio_service.go:536` (`quote_timeout_ms`), `:554` (`servability_timeout_ms`), `:1280-1281` (`risk.max_drawdown_pct`, `risk.concentration_limit_pct`), `:2135,:2139` (`watchlist.max_per_user`, `watchlist.max_symbols_per_list`).
- 9 baseline entries: `portfolio.exposure.factor_map`, `portfolio.marketdata.{last_close_lookback_days,quote_timeout_ms,servability_timeout_ms}`, `portfolio.risk.{concentration_limit_pct,max_drawdown_pct}`, `portfolio.watchlist.{max_per_user,max_symbols_per_list,signal_prune_interval_seconds}`; 160 left. Receivers (`config.go:w`, `offline_valuation.go:s.quoteCfg`, `portfolio_service.go:s.cfg|s.quoteCfg|s.wlCfg`, `signal_prune.go:s.wlCfg`) -> `"portfolio"` already registered.
- Banner at `services/xstockstrat-portfolio/CLAUDE.md:106`.

**Lands with**: Step 7

**TDD**: red-green required

**Covers**: —

**Instructions**: rewrite the nine literals/constants to `exposure.factor_map`, `marketdata.last_close_lookback_days`, `marketdata.quote_timeout_ms`, `marketdata.servability_timeout_ms`, `risk.concentration_limit_pct`, `risk.max_drawdown_pct`, `watchlist.max_per_user`, `watchlist.max_symbols_per_list`, `watchlist.signal_prune_interval_seconds`; delete the nine entries; rewrite banner and table under `Namespace: portfolio`, remove the stale paragraph at `:108-111`, and correct any "Unseeded (227 D2 waiver)" note (`:121-122`) whose key `scripts/config-wiring-stored.json` shows as stored.

**Verification**:
`V-GO(portfolio)`; `V-GATE(portfolio,160)`; `grep -rnE "\"portfolio\.(exposure|marketdata|risk|watchlist)\.[a-z_.]+\"" services/xstockstrat-portfolio --include=*.go | grep -v "_test.go" | grep -v "emitEvent\|Warn"` prints nothing; `grep -n "cutover in feature 296" services/xstockstrat-portfolio/CLAUDE.md` prints nothing.

---

### Step 9 — test: marketdata doubles, dynamic keys and AC-3/AC-13

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/config/config.go` — modify (`NewSnapshotWatcher` `:134-142` becomes `MustSnapshotWatcher(ns, values)` with the prefix guard)
- `services/xstockstrat-marketdata/internal/config/config_test.go` — modify (`:172` (the prefixed `key` literal) and the `NewSnapshotWatcher` call sites (`:132,173`); AC-17 test)
- `services/xstockstrat-marketdata/cmd/server/main_test.go` — modify (`:198-201,216,299-300,323,340,410-411,430`; 3 constructor sites)
- `services/xstockstrat-marketdata/internal/service/marketdata_service_test.go` — modify (`fakeCfg` `:289`, `fakeIntGetter` `:1998`, `budgetCfgMs` `:2022`; ~59 constructor uses; ~80 key literals incl. `:333-343,359-388,516,538,566-605,773,848,2450-2453,2482,2616-2621,2736-2837,2935-2937,3143-3144,3211,3303-3306,3481`)
- `services/xstockstrat-marketdata/internal/service/bar_hold_test.go` — modify (`bhKey` `:22`, 7 constructor sites)
- `services/xstockstrat-marketdata/internal/service/asset_servability_test.go` — modify (4 constructor sites + key)
- `services/xstockstrat-marketdata/internal/service/etf_flags_test.go` — modify (2 sites)

**Reviewers**: Service owner `xstockstrat-marketdata` — OHLCV ingestion integrity, vendor-secret keys already relative, concatenated provider keys

**Codebase Evidence**:
- `NewSnapshotWatcher(snapshot)` is hard-wired to `marketdata` (`config.go:134-142`); occurrence counts from `grep -rn "NewSnapshotWatcher\|fakeCfg\b\|fakeIntGetter"`: `main_test.go` 3, `config_test.go` 3, `asset_servability_test.go` 4, `bar_hold_test.go` 7, `etf_flags_test.go` 2, `marketdata_service_test.go` 59.
- `fakeCfg{bools,ints,strings}` `marketdata_service_test.go:289-312`; `fakeIntGetter map[string]int64` `:1998-2004`; `budgetCfgMs` returns `fakeIntGetter{"marketdata.price.batch_timeout_ms": ms}` `:2022`.
- Dynamic reads under test: `marketdata_service.go:1795,1864` `s.fundCfg.GetInt("marketdata."+provider+".cache_ttl_hours", 24)`, `:1909` `s.fundCfg.GetBool("marketdata."+provider+".enabled", false)` (`fundamentalsEnabled`), registered in `config-wiring.json` `registry.dynamic` for `GetFundamentalsMulti`, `fundamentalsEnabled`, `resolveFundamentals` as `marketdata.finnhub|fmp.cache_ttl_hours|enabled` (the gate trusts the registry list, not the concatenation).
- Test seeds with the prefixed spelling for those: `marketdata_service_test.go:333-343`.
- Constants to reuse so tests follow a rewrite for free: `assetRefreshHoursKey` (`asset_servability.go:27`), `barIngestBackoffKey` (`bar_hold.go:9`); `bhKey` (`bar_hold_test.go:22`) and `config_test.go:172` are copies that would otherwise drift (`config_test.go:172` is in package `config`, which cannot import the service constants: respell the literal there).
- Display string kept: `marketdata_service.go:2252` error text.

**Lands with**: Step 10

**TDD**: red-green required

**Covers**: AC-3, AC-13, AC-17 (Go marketdata rows: `MustSnapshotWatcher`, `fakeCfg`, `fakeIntGetter`)

**Instructions**:
1. `config.go`: rename `NewSnapshotWatcher(snapshot)` to `MustSnapshotWatcher(ns string, values map[string]*configv1.ConfigValue) *Watcher`; panic naming the key and its relative spelling when a key starts with `ns + "."`; keep it a few lines; add the `strings` import (marketdata `config.go` imports only `context`, `fmt`, `os`). The panic message must carry a service-specific prefix (`portfolio:` / `marketdata:`) so the three `ns`-parameterised bodies do not form an identical token run: `.jscpd.json` ignores `*_test.go` but not `config.go`, and the old versions escaped `minTokens: 100` only because they differed in a string literal. Run `bash scripts/check-duplication.sh` right after this step, before calling the unit green. Every stale call site is now a compile error (design).
2. In `marketdata_service_test.go` add one small helper (for example `rejectPrefixed(key string)`) used by `fakeCfg.GetBool/GetInt/GetString` and `fakeIntGetter.GetInt` to panic on `marketdata.`-prefixed keys (AC-17 rows `marketdata fakeCfg`/`fakeIntGetter`: reading `marketdata.any.key` panics, and a map holding `"any.key": 7` returns 7). Respell every key literal to the relative form (`fmp.enabled`, `fmp.cache_ttl_hours`, `finnhub.symbols_per_minute`, `fundamentals.history.enabled`, `fundamentals.snapshot_source`, `dividends.enabled`, `edgar.cache_ttl_hours`, `quotes.latest_lookback_hours`, `price.batch_timeout_ms`, ...). Replace `bhKey` with `barIngestBackoffKey`.
3. AC-3: seed `fmp.cache_ttl_hours = 12` and `finnhub.cache_ttl_hours = 6` (both differ from the default 24) and assert the cache freshness boundary per provider (a row 10 h old is fresh for fmp and stale for finnhub), modelled on the existing fundamentals cache seeds (`:333-343`). RED against the concatenating `"marketdata."+provider` reader because the guarded double panics.
4. Red-first `fundamentalsEnabled` test (design): stored `fmp.enabled=true` must not return `FailedPrecondition` (`marketdata_service.go:1909`).
5. AC-13: assert the registry lists after Step 10: `node -e` over `scripts/config-wiring.json` that `registry.dynamic[...resolveFundamentals]`, `[...GetFundamentalsMulti]` equal `["finnhub.cache_ttl_hours","fmp.cache_ttl_hours"]` and `[...fundamentalsEnabled]` equal `["finnhub.enabled","fmp.enabled"]`.
6. AC-17 tests (config_test.go and the service test file): `MustSnapshotWatcher("marketdata", {"marketdata.any.key": ...})` panics naming `marketdata.any.key` and `any.key`; `any.key` = 7 reads back 7; `fakeCfg`/`fakeIntGetter` panic on a `marketdata.any.key` read.
7. Residual-double sweep: `grep -rnE "\"marketdata\.[a-z_]+(\.[a-z_]+)+\"" --include=*_test.go services/xstockstrat-marketdata | grep -v "marketdata\.\(vendor\|stream\.\(reconnects\|last_message_age\)\|backfill\.symbols\)"` prints only the intended survivors: the AC-17 `<ns>.any.key` literals and the FQN constants this step names (each a documented display/WARN string).

**Verification**:
Before Step 10 (RED): `(cd services/xstockstrat-marketdata && GOWORK=off go test ./... 2>&1 | grep -E "^--- FAIL|panic:")` names the AC-3/AC-13/AC-17 tests (not `[build failed]`). After Step 10: `V-GO(marketdata)`; `node -e 'const r=require("./scripts/config-wiring.json").registry.dynamic;for(const k of Object.keys(r).filter(k=>k.includes("marketdata_service.go")))console.log(k.split(":")[1],JSON.stringify(r[k]))'` shows only relative keys.

---

### Step 10 — service: marketdata relative literals, dynamic lists, baseline drain, banner

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/cmd/server/main.go` — modify (`:89,91,93,94,96,97,215,224,265,269,272,273,282,283,284`)
- `services/xstockstrat-marketdata/internal/service/marketdata_service.go` — modify (`:573,1052,1057,1062,1067,1072,1077,1171,1183,1276,1287,1357,1358,1795,1864,1909,1926,1978,1984,2069,2070,2079,2251,2267,2272,2276,2314,2315`; not `:2252`)
- `services/xstockstrat-marketdata/internal/service/classification_service.go` — modify (`:235,236`)
- `services/xstockstrat-marketdata/internal/service/asset_servability.go` — modify (`:27`)
- `services/xstockstrat-marketdata/internal/service/bar_hold.go` — modify (`:9`)
- `services/xstockstrat-marketdata/internal/service/etf_flags.go` — modify (`:210`)
- `scripts/config-wiring.json` — modify (delete 44 `prefixed-read` entries, namespace `marketdata`, **keeping** `marketdata.fundamentals.provider`; respell the three `registry.dynamic` marketdata lists)
- `services/xstockstrat-marketdata/CLAUDE.md` — modify (banner `:50-51`, the `Namespace: marketdata` paragraph `:53-58` (it states non-secret keys are read by their "full-dotted `marketdata.<key>` name" and were left untouched by 029; rewrite to the relative rule), table `:62-113` incl. secret rows, stale line ref `:84` (`marketdata_service.go:1143`), "Unseeded" note `:76`)

**Reviewers**: Service owner `xstockstrat-marketdata` — OHLCV ingestion integrity, vendor-secret keys already relative, concatenated provider keys

**Codebase Evidence**:
- Read sites (grep `"marketdata\.` excluding event names `marketdata.backfill.{data_deleted,started,failed,completed}` `:583,1494,1531,1535` and `marketdata.feed.{connected,disconnected}` `:1630,1646`): `main.go:89-97` (alpaca feed/adjustment, backfill, stream), `:215` (`fundamentals.provider`), `:224,265,269,272,273,282-284` (vendor URLs and limits); the secrets at `main.go:293` (`vendorSecretKeys`) are already relative.
- Concatenations: `:1795,:1864` -> `provider + ".cache_ttl_hours"`, `:1909` -> `provider + ".enabled"` (drop the prefix; do not literal-replace the whole string).
- Gate attribution: 44 sites in 6 files (`main.go` 14, `marketdata_service.go` 25, `classification_service.go` 2, `asset_servability.go` 1, `bar_hold.go` 1, `etf_flags.go` 1); 45 baseline entries, `marketdata.fundamentals.provider` additionally read by `analysis app/engine/fundsignal_loop.py:108`, so it drains in Step 16 (116 left after this step).
- `registry.dynamic` lists at `scripts/config-wiring.json` `GetFundamentalsMulti`, `fundamentalsEnabled`, `resolveFundamentals`.
- Banner at `services/xstockstrat-marketdata/CLAUDE.md:51`.

**Lands with**: Step 9

**TDD**: red-green required

**Covers**: —

**Instructions**: rewrite every listed read to the key relative to `marketdata` (`marketdata.alpaca.feed` -> `alpaca.feed`, ...); the two constants become `assets.refresh_interval_hours` and `stream.bar_ingest_backoff_ms`; delete 44 baseline entries (only `kind: "prefixed-read"` entries with `namespace: "marketdata"`, except `marketdata.fundamentals.provider`; the `seeded-unread` entry `alpaca.paper` is owned by feature 305 and must stay); respell the dynamic lists to `fmp.cache_ttl_hours`, `finnhub.cache_ttl_hours`, `fmp.enabled`, `finnhub.enabled`; keep the FQN error string at `:2252`; rewrite banner and table under `Namespace: marketdata` and correct the stale "Unseeded (feature 227 seeding waiver)" note at `:76` (and check the other "Unseeded" table rows, e.g. `quotes.latest_lookback_hours`, `retention.quotes_days`, against `scripts/config-wiring-stored.json`) and the line ref at `:84` (the keys are stored: `scripts/config-wiring-stored.json` marketdata rows).

**Verification**:
`V-GO(marketdata)`; `V-GATE(marketdata,116)` (expect `REPORTED ... readers-disagree` lines for `marketdata.fundamentals.provider`, never a failure); `grep -n "cutover in feature 296" services/xstockstrat-marketdata/CLAUDE.md` prints nothing; `grep -rnE '"marketdata\.[a-z_]+(\.[a-z_]+)+"' services/xstockstrat-marketdata --include=*.go | grep -v _test.go | grep -v 'backfill\.\(data_deleted\|started\|failed\|completed\)\|feed\.\(connected\|disconnected\)\|marketdata\.vendor\.\|internal/telemetry'` prints nothing (the unquoted FQN error text at `:2252` does not match; this catches a missed `main.go:215`, which `V-GATE` cannot see because that id is attributed to the analysis file until Step 16); `grep -rnE '"marketdata\."[[:space:]]*\+' services/xstockstrat-marketdata --include=*.go | grep -v _test.go` prints nothing (the concatenations `"marketdata."+provider+...` at `marketdata_service.go:1795,1864,1909` are invisible to the literal grep and to the gate, which trusts the `registry.dynamic` lists; the Step 9 tests are the runtime proof); `grep -c '"key": "alpaca.paper"' scripts/config-wiring.json` prints 1 (305's `seeded-unread` row survives) and the remaining `marketdata` entries are exactly `fundamentals.provider` (prefixed-read) and `alpaca.paper` (seeded-unread).

---

### Step 11 — test: indicators doubles, sandbox_keys_check inversion, AC-2/AC-16

**Status**: `done`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/tests/conftest.py` — modify (`snapshot_watcher(namespace="indicators", **values)` `:164-186`, `ValueError` on a `<namespace>.` prefix; sets `w.namespace`)
- `services/xstockstrat-indicators/tests/test_config_watcher.py` — modify (15 hits: `:55-170` parametrizations incl. `test_sandbox_getters_resolve_full_dotted_rows` (rename it to `..._resolve_relative_rows`) `:155-170`, `indicators.test.*` `:121-128`, `:380`, `:403-417`, `:424` (real-core stall/read-evidence/snapshot-age tests keyed by `indicators.sandbox.timeout_ms`; about 22 lines in all); new AC-17 test)
- `services/xstockstrat-indicators/tests/test_sandbox_isolation.py` — modify (`test_no_new_config_leaf_introduced` `:386-393`: `f"indicators.sandbox.{leaf}" not in src` over the now-relative `watcher.py` can never fail, so respell it to `f"sandbox.{leaf}"` and its docstring; characterization guard, green before and after)
- `services/xstockstrat-indicators/tests/test_config_read_classification.py` — modify (`FR3_KEYS` `:26-33`, `HONOUR_KEYS`, `ZERO_IS_LEGIT`)
- `services/xstockstrat-indicators/tests/test_execute_formula_concurrency.py` — modify (3 hits)
- `services/xstockstrat-indicators/tests/test_live_limits.py` — modify (5 hits)
- `services/xstockstrat-indicators/tests/test_sandbox.py` — modify (`:295-296`)
- `services/xstockstrat-indicators/tests/test_sandbox_deadline.py` — modify (`:24-26,:98`)
- `services/xstockstrat-indicators/tests/test_sandbox_keys_check.py` — modify (`:32,:38,:63` and the `EXPECTED`-derived rows)

**Reviewers**: Service owner `xstockstrat-indicators` — formula sandboxing, timeout enforcement (`sandbox.timeout_ms`), no side effects from formula execution

**Codebase Evidence**:
- `tests/conftest.py:164-186` `snapshot_watcher(**values)` builds `ConfigWatcher.__new__(ConfigWatcher)` and sets `w._snapshot`; it never sets `w.namespace`, so `_fqn` (`app/config/watch_core.py:175-177`, `getattr(self, "namespace", "")`) cannot re-prefix; the guard needs the namespace.
- `test_config_watcher.py:151-170` `test_sandbox_getters_resolve_full_dotted_rows` (the AC-2 indicators row; stored 3000 for `timeout_ms`) and `test_config_watcher.py:403-417` read-evidence assertion `config.read_key ns=indicators key={key}` (follows `key` for free).
- Telemetry instrument names `indicators.sandbox.{executions,duration,queue_wait}` (`app/telemetry.py:331-337`, `tests/test_telemetry_allowlist.py:33-35`, `tests/test_sandbox_telemetry.py`) and SQL `indicators.formulas` are not reads: unchanged.
- `app/maintenance/sandbox_keys_check.py:19-24` `EXPECTED` (full-dotted, `:19-23`) and `BARE = {key.split(".",1)[1] ...}` (`:24`), `HEALED_BY = "system:config-migration-031"` (`:18`). Migration 044 sets only `key` (`044_config_keys_relative.up.sql:179,214-218`), so rows keep `updated_by = HEALED_BY`.
- Test shape: `test_sandbox_keys_check.py:10-23` `_row`/`_healed`, `:30-34` bare-row test, `:37-41` missing-row test, `:62-66` per-user row.

**Lands with**: Step 12

**TDD**: red-green required

**Covers**: AC-2 (indicators row), AC-16, AC-17 (Python indicators row)

**Instructions**:
1. `conftest.py`: `snapshot_watcher(namespace="indicators", **values)` sets `w.namespace = namespace` and raises `ValueError` naming the key and its relative spelling when any key starts with `namespace + "."`. Document it as the canonical double (docstring, one line).
2. Respell every `indicators.`-prefixed key in the listed tests to the relative spelling (`sandbox.timeout_ms`, `sandbox.memory_bytes`, `sandbox.allowed_imports`, `sandbox.max_concurrent`, `sandbox.startup_grace_ms`, `test.unset_int`, ...). Keep `test_config_read_classification.py` sets and `app/` in lockstep (they AST-scan `app/`, so Step 12 must land in the same commit). Change the AC-2 row to stored 15000 for `sandbox.timeout_ms` (default 5000) as in `acceptance.feature` AC-2.
3. `test_sandbox_keys_check.py`: invert. `_healed()` builds relative rows; the former "bare row" test becomes "a prefixed global row remains -> `044 not applied here` problem" using `_row("indicators.sandbox.timeout_ms", ...)`; the "missing" test removes `sandbox.timeout_ms` and expects `missing relative global row`; the per-user row uses the relative key. Add `AC-16`: `sk.evaluate(_healed(), [], MIGRATED)` has no problems (exit 0 / `PASS`) and a database whose rows are the prefixed keys makes `sk.check(...)` return 1.
4. Add the AC-17 test (`snapshot_watcher(**{"indicators.any.key": 1})` raises `ValueError` naming `indicators.any.key` and `any.key`; `snapshot_watcher(**{"any.key": 7}).get_int("any.key", 0) == 7`) next to the watcher tests.
5. Residual-double sweep: `grep -rnE "['\"]indicators\.[a-z_]+\.[a-z_.]+['\"]" services/xstockstrat-indicators/tests | grep -v "indicators\.\(sandbox\.\(executions\|duration\|queue_wait\)\|formulas\|formula_templates\|config\.\)"` prints only the intended survivors (the regex cannot see f-strings, so also run `grep -rn "indicators\.sandbox\." services/xstockstrat-indicators/tests`, whose survivors are only the AC-16 prefixed rows, the OTel names and the AC-17 literals): the AC-17 `<ns>.any.key` literals and the FQN constants this step names (each a documented display/WARN string); the inverted keys-check test keeps `_row("indicators.sandbox.timeout_ms", ...)` on purpose (AC-16).

**Verification**:
Before Step 12 (RED): `(cd services/xstockstrat-indicators && pytest tests/test_config_watcher.py tests/test_sandbox_keys_check.py tests/test_config_read_classification.py -x -q)` fails. After Step 12: `V-PY(indicators,50)`.

---

### Step 12 — service: indicators relative literals, sandbox_keys_check inversion, partial drain, banner

**Status**: `done`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/app/config/watcher.py` — modify (`:86,90,94-96,100,103`)
- `services/xstockstrat-indicators/app/handlers/servicer.py` — modify (comment `:309` names `indicators.sandbox.max_concurrent`; respell as (namespace, key), the gate cannot see comments)
- `services/xstockstrat-indicators/app/maintenance/sandbox_keys_check.py` — modify (`EXPECTED`/`BARE` inversion `:19-24`, messages `:60-66,:84,:90,:140`, snapshot section)
- `services/xstockstrat-indicators/app/services/sandbox.py` — modify (docstring key list `:6-9`, display only)
- `scripts/config-wiring.json` — modify (delete 3 entries: `indicators.sandbox.allowed_imports`, `.max_concurrent`, `.memory_bytes`; keep `.timeout_ms` and `.startup_grace_ms` for Step 19)
- `services/xstockstrat-indicators/CLAUDE.md` — modify (banner `:84-85`, five table rows `:91-95`)

**Reviewers**: Service owner `xstockstrat-indicators` — formula sandboxing, timeout enforcement (`sandbox.timeout_ms`), no side effects from formula execution

**Codebase Evidence**:
- `app/config/watcher.py:86` `int_positive(self, "indicators.sandbox.timeout_ms", 5000)`, `:90` `memory_bytes`, `:94-96` `get_str_present("indicators.sandbox.allowed_imports", default=...)`, `:100` `max_concurrent`, `:103` `startup_grace_ms` (the TSV listed 3; the gate also shows these 5, `config-wiring.json:499-527`). Receivers `watcher.py:self` and `watcher.py:int_positive` -> `"indicators"` registered.
- `sandbox_keys_check.py`: `EXPECTED` `:19-23`, `BARE` `:24`, `ROWS_SQL` `LIKE '%sandbox.%'` (still right), the `updated_by != HEALED_BY` branch `:67`, messages `"bare global rows remain"` `:62` and `"missing full-dotted global row"` `:66` (`EXPECTED` `:19-23`, `BARE` `:24`), the snapshot block `:81-91`, PASS text `:140`.
- The snapshot (`config_values_premigration_031`) holds the PRE-031 state, so its checks keep the old spellings as separate historical constants (full-dotted twin = `indicators.`-prefixed, bare = relative) rather than reusing the inverted `EXPECTED`.

**Lands with**: Step 11

**TDD**: red-green required

**Covers**: —

**Instructions**:
1. `watcher.py`: relative keys `sandbox.timeout_ms`, `sandbox.memory_bytes`, `sandbox.allowed_imports`, `sandbox.max_concurrent`, `sandbox.startup_grace_ms`.
2. `sandbox_keys_check.py`: `EXPECTED` becomes the relative keys with the same seed values; the previous "bare" set becomes `PREFIXED = {f"indicators.{k}" for k in EXPECTED}`; the problem messages become `"[env] prefixed global rows remain [...]: 044 not applied here"` and `"[env] missing relative global row <key>"`; keep `HEALED_BY` and the overridden/re-saved notes; the snapshot block uses constants named for the pre-031 meaning (reuse `PREFIXED` for the pre-031 full-dotted set; `PRE031_BARE = set(EXPECTED)`). Update the docstring. Exit codes unchanged (0 PASS, 1 FAIL).
3. Baseline: delete only the three entries named in **Files**; the `timeout_ms`/`startup_grace_ms` entries stay because `xstockstrat-agent app/client.py:1127-1128` still reads them prefixed (113 left).
4. `CLAUDE.md`: relative rule banner; the five rows under `Namespace: indicators`.

**Verification**:
`V-PY(indicators,50)`; `V-GATE(indicators,113)` (a finding's `file` is the smallest file among the PREFIXED readers of that id, so the two deferred ids are attributed to `services/xstockstrat-agent/app/client.py` and the per-service zero check for `services/xstockstrat-indicators/` passes; `REPORTED ... readers-disagree` lines are allowed); `grep -n "cutover in feature 296" services/xstockstrat-indicators/CLAUDE.md` prints nothing; `(cd services/xstockstrat-indicators && python -m app.maintenance.sandbox_keys_check --help)` exits 0; `grep -rnE "['\"]indicators\.sandbox\.[a-z_]+['\"]" services/xstockstrat-indicators/app --exclude-dir=maintenance --exclude=sandbox.py --exclude=telemetry.py` prints nothing (the per-service gate check cannot prove `watcher.py:86,103` because the two deferred ids are attributed to the agent file; `maintenance/` holds the historical pre-031 constants and `sandbox.py` only a docstring list, `telemetry.py` the three `indicators.sandbox.*` OTel instrument names).

---

### Step 13 — test: ingest doubles and relative keys

**Status**: `done`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/tests/conftest.py` — modify (`snapshot_watcher(namespace="ingest", **values)` `:71-93`, guard)
- `services/xstockstrat-ingest/tests/test_config_watcher.py` — modify (`:66-82,300-350`, generic `ingest.test.*` keys)
- `services/xstockstrat-ingest/tests/test_config_read_classification.py` — modify (sets `:26-44`)
- `services/xstockstrat-ingest/tests/test_ingest_servicer.py` — modify (`:79-80,:95`)
- `services/xstockstrat-ingest/tests/test_mcp_client_loop.py` — modify (`_FakeCfgWatcher` `:62`; `:128,142,161,512`)
- `services/xstockstrat-ingest/tests/test_live_limits.py` — modify (2 hits)

**Reviewers**: Service owner `xstockstrat-ingest` — signal normalization correctness, idempotent ingestion, `mcp_client` poll keys

**Codebase Evidence**:
- `tests/conftest.py:71-93` `snapshot_watcher(**values)` (no `w.namespace`); `tests/test_ingest_servicer.py:79-80` builds a snapshot by hand (`snap.values["ingest.backfill.max_retry_attempts"]`, `snap.values["ingest.backfill.retry_on_failure"]`), `:95` `snapshot_watcher(**{"ingest.backfill.max_concurrent_jobs": 0})`.
- Local double `_FakeCfgWatcher(ints=...)` `tests/test_mcp_client_loop.py:62`, used at `:128` (`request_timeout_seconds` 7), `:142`, `:161`, `:512`.
- Not reads: `ingest.backfill.queued|running|failed|completed|canceled` event types (`test_ingest_servicer.py:320-519`), metric names (`test_ingest_telemetry.py`, `test_telemetry_allowlist.py:35-39`); `ingest.mcp_credential.<uuid>` and `split_credentials_ref` stay.

**Lands with**: Step 14

**TDD**: red-green required

**Covers**: AC-17 (Python ingest row)

**Instructions**: add the same guard as Step 11 (`namespace="ingest"`, `ValueError`, sets `w.namespace`); respell all key literals to `backfill.max_concurrent_jobs`, `backfill.retry_on_failure`, `backfill.max_retry_attempts`, `backfill.chunk_max_bars`, `backfill.chunk_window_days`, `backfill.max_concurrent_chunks`, `mcp_client.request_timeout_seconds`, `mcp_client.poll_interval_seconds`, `signals.dedup_window_hours`, and the generic `test.*` keys; respell the by-hand snapshot at `test_ingest_servicer.py:79-80`; give `_FakeCfgWatcher` the same prefix rejection; add the AC-17 test. Residual-double sweep: `grep -rnE "['\"]ingest\.[a-z_]+\.[a-z_.]+['\"]" services/xstockstrat-ingest/tests | grep -v "ingest\.\(backfill\.\(queued\|running\|failed\|completed\|canceled\|jobs\)\|source\.\|signal\.\|signal_dedup\)"` prints only the intended survivors: the AC-17 `<ns>.any.key` literals and the FQN constants this step names (each a documented display/WARN string).

**Verification**:
Before Step 14 (RED): `(cd services/xstockstrat-ingest && pytest tests/test_config_watcher.py tests/test_config_read_classification.py tests/test_mcp_client_loop.py -x -q)` fails. After Step 14: `V-PY(ingest,40)`.

---

### Step 14 — service: ingest relative literals, baseline drain, banner

**Status**: `done`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/app/config/watcher.py` — modify (`:113,117,121,126,130,135,140`)
- `services/xstockstrat-ingest/app/engine/mcp_client_loop.py` — modify (`:191,:232`)
- `scripts/config-wiring.json` — modify (delete 9 `prefixed-read` entries, namespace `ingest`)
- `services/xstockstrat-ingest/CLAUDE.md` — modify (banner `:110-111`, table `:110-126`)

**Reviewers**: Service owner `xstockstrat-ingest` — signal normalization correctness, idempotent ingestion, `mcp_client` poll keys

**Codebase Evidence**:
- `watcher.py:113` `int_positive(self, "ingest.backfill.max_concurrent_jobs", 3)`, `:117` `get_bool("ingest.backfill.retry_on_failure", default=True)`, `:121`, `:126`, `:130`, `:135`, `:140` `get_int_present("ingest.signals.dedup_window_hours", default=24)`; `mcp_client_loop.py:191` `"ingest.mcp_client.request_timeout_seconds"`, `:232` `"ingest.mcp_client.poll_interval_seconds"`.
- 9 baseline entries (listed by `config-wiring.json`: `ingest.backfill.{chunk_max_bars,chunk_window_days,max_concurrent_chunks,max_concurrent_jobs,max_retry_attempts,retry_on_failure}`, `ingest.mcp_client.{poll_interval_seconds,request_timeout_seconds}`, `ingest.signals.dedup_window_hours`); 104 left. Receivers `watcher.py:self|int_positive`, `mcp_client_loop.py:int_positive` -> `"ingest"` registered.
- `GetSecret` sends the already-relative `mcp_credential.<uuid>` (`watcher.py:21-26,80-107`): untouched. Event types `ingest.backfill.*` (`servicer.py:448-946`) untouched.
- Banner at `services/xstockstrat-ingest/CLAUDE.md:111`; documented-but-unread `default_timeframe` row keeps its note.

**Lands with**: Step 13

**TDD**: red-green required

**Covers**: —

**Instructions**: rewrite the nine literals to the Step 13 relative keys; delete the nine entries; rewrite banner and table under `Namespace: ingest`.

**Verification**:
`V-PY(ingest,40)`; `V-GATE(ingest,104)`; `grep -rnE "\"ingest\.(backfill|mcp_client|signals)\.[a-z_]+\"" services/xstockstrat-ingest/app | grep -v "backfill\.\(queued\|running\|failed\|completed\|canceled\|jobs\)"` prints nothing; `grep -n "cutover in feature 296" services/xstockstrat-ingest/CLAUDE.md` prints nothing.

---

### Step 15 — test: analysis doubles, second watcher and relative keys

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/conftest.py` — modify (`snapshot_watcher(namespace="analysis", **values)` `:62-86`, hardcoded `w.namespace = "analysis"` `:71`)
- `services/xstockstrat-analysis/tests/test_config_read_classification.py` — modify (79 hits: `FR3_KEYS` `:25`, `HONOUR_KEYS` `:64`, `ZERO_IS_LEGIT` `:106`)
- `services/xstockstrat-analysis/tests/test_config_zero_clamps.py` — modify (47 hits, e.g. `:38`)
- `services/xstockstrat-analysis/tests/test_fundsignal_loop.py` — modify (39 hits incl. `_make_md_cfg` `:311`, `:332`, `:444`; new AC-4 test)
- `services/xstockstrat-analysis/tests/test_analysis_servicer.py` — modify (10 hits, e.g. `:1329`)
- `services/xstockstrat-analysis/tests/test_live_loop.py` — modify (10 hits; `==`-comparing lambdas `:289,710,1043,1460`)
- `services/xstockstrat-analysis/tests/test_screener.py` — modify (7 hits, `:28`)
- `services/xstockstrat-analysis/tests/test_live_limits.py` — modify (4 hits)
- `services/xstockstrat-analysis/tests/test_fill_model.py` — modify (3)
- `services/xstockstrat-analysis/tests/test_query_pnl_patterns.py` — modify (3)
- `services/xstockstrat-analysis/tests/test_list_opportunities_deadlines.py` — modify (2)
- `services/xstockstrat-analysis/tests/test_owner_header_guard.py` — modify (2)
- `services/xstockstrat-analysis/tests/test_backtest_bounds.py` — modify (`_LIMIT_KEY` `:86`; add `_LIMIT_FQN` for the WARN assertion, 272 @AC-5)
- `services/xstockstrat-analysis/tests/test_backtest_fundamentals_guard.py`, `services/xstockstrat-analysis/tests/test_blend_guard.py`, `services/xstockstrat-analysis/tests/test_grade_fundamentals_exclusion.py`, `services/xstockstrat-analysis/tests/test_loop_supervision.py`, `services/xstockstrat-analysis/tests/test_opportunities_fundamentals_guard.py`, `services/xstockstrat-analysis/tests/test_opportunities_latency.py`, `services/xstockstrat-analysis/tests/test_opportunities_repo.py`, `services/xstockstrat-analysis/tests/test_pnl_pattern_consumer.py`, `services/xstockstrat-analysis/tests/test_read_budget_real_pg.py`, `services/xstockstrat-analysis/tests/test_config_watcher.py` — modify (1 hit each)

**Reviewers**: Service owner `xstockstrat-analysis` — backtest reproducibility, scoring determinism, second `marketdata` watcher, about 120 literals

**Codebase Evidence**:
- `tests/conftest.py:62-86` `snapshot_watcher(**values)` hardcodes `w.namespace = "analysis"` at `:71`, so a `<ns>.` guard cannot see AC-4's `marketdata` watcher (design round 2).
- Quoted baseline-key hit counts per file (scan of the 74 analysis baseline keys over `tests/`): the files listed in **Files** (total 23 test files, ~270 quoted hits; recon counted ~323 unquoted-inclusive hits over 30 files, the difference is prose and f-strings the residual sweep below catches). Lambda doubles that compare `key == "analysis...."` and silently return the default on a mismatch: `test_fundsignal_loop.py:316,441,770`, `test_live_loop.py:289,710,1043,1460`.
- Second watcher: `app/main.py:49` `ConfigWatcher(endpoint=CONFIG_ENDPOINT, namespace="marketdata")`, passed to `FundamentalsSignalLoop(md_config_watcher=...)` (`main.py:194`); `fundsignal_loop.py:107-108` `_provider()` reads `self._md_cfg.get_str("marketdata.fundamentals.provider", "")`; test helper `test_fundsignal_loop.py:311` `_make_md_cfg(provider)`.
- WARN assertion that must keep the FQN: 272 @AC-5 (`analysis.backtest.max_duration_seconds`); the production WARN is `servicer.py:822`.
- Event names (`analysis.strategy.scored`, `analysis.backtest.started`) are not reads.

**Lands with**: Step 16

**TDD**: red-green required

**Covers**: AC-4, AC-17 (Python analysis rows for `namespace="analysis"` and `namespace="marketdata"`)

**Instructions**:
1. `conftest.py`: `snapshot_watcher(namespace="analysis", **values)`; `w.namespace = namespace`; raise `ValueError` naming the key and the relative spelling when a key starts with `namespace + "."`.
2. Respell every quoted `analysis.`-prefixed key to the relative spelling in all listed files. The guard turns every `snapshot_watcher`-based miss into a loud error; the lambda/MagicMock doubles (`_make_md_cfg`, the `==` lambdas, the 5 inline stubs) need the same prefix rejection added by hand or an assertion that the called key has no `analysis.` prefix.
3. AC-4: `snapshot_watcher(namespace="marketdata", **{"fundamentals.provider": "edgar"})` passed as `md_config_watcher` to a real `FundamentalsSignalLoop`; assert `loop._provider() == "edgar"` (not `""`). Replace `_make_md_cfg` with that double where it models the read.
4. `test_backtest_bounds.py`: `_LIMIT_KEY = "backtest.max_duration_seconds"` and a separate `_LIMIT_FQN = "analysis.backtest.max_duration_seconds"` for the WARN text assertion, so the assertion cannot pass on a substring of the relative key (design).
5. Add the AC-17 tests (analysis `namespace="analysis"` and `namespace="marketdata"` rows). Every AC-17 test also asserts the second half of the Then: the double built with `any.key` = 7 returns 7 for `any.key` (otherwise a double that rejects everything would pass).
6. Residual-double sweep: `grep -rnE "['\"](analysis|marketdata)\.[a-z_]+(\.[a-z_]+)+['\"]" services/xstockstrat-analysis/tests | grep -v "analysis\.\(backtest\.\(started\|completed\)\|strategy\.scored\|live_loop\.\|fundsignal\.signals\|opportunity\.recompute\|snapshot\.\(captured\|degraded\)\|pattern\.sealed\|pnl\.event_parked\|test\.event\)"` — every remaining hit is a documented non-read (ledger event types, OTel instrument names, `_LIMIT_FQN`, the AC-17 `*.any.key` literals) or is respelled. Do NOT exclude `analysis.snapshot.` wholesale: `test_pnl_pattern_consumer.py:330` (`analysis.snapshot.indicator_timeout_ms`) is a REAL config key next to the event names and must be respelled.

**Verification**:
Before Step 16 (RED): `(cd services/xstockstrat-analysis && pytest tests/test_config_read_classification.py tests/test_config_zero_clamps.py tests/test_fundsignal_loop.py -x -q)` fails. After Step 16: `V-PY(analysis,40)`.

---

### Step 16 — service: analysis relative literals, `marketdata.fundamentals.provider`, baseline drain, banner

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify (config reads at `:370,376,572,576,582,587,616,845,846,852,932,1239,1242,1257,1385-1387,1887,1977,2155,2235,2768-2770,2782,2787,2788,2830,2888,3024,3910,4014,4389,4390,4670,4737,4822,4910,4987,5001,5010,5071,5309,5311,5368,5379,5417,5447,5499,5535,5622,5660,5662,6034,6053,6093,6105,6226,6240,6280,6352` and the continuation-line literals `:4286,4825,5007,5012,5015,5365,5370,5373,5382,6122`; `:818` for `backtest.max_duration_seconds`)
- `services/xstockstrat-analysis/app/engine/fundsignal_loop.py` — modify (`:46,108,143,144,153,162,167,189,220,246,270,279,280,281,286,389,390,525`)
- `services/xstockstrat-analysis/app/engine/live_loop.py` — modify (`:341,366,367,371,687,708,762,801`)
- `services/xstockstrat-analysis/app/engine/entry_backfill.py` — modify (`:63,:108`)
- `services/xstockstrat-analysis/app/engine/pnl_pattern_consumer.py` — modify (`:537,:539`)
- `services/xstockstrat-analysis/app/services/screener.py` — modify (`:87,:94,:198`)
- `scripts/config-wiring.json` — modify (delete 74 `analysis` `prefixed-read` entries plus `marketdata.fundamentals.provider`)
- `services/xstockstrat-analysis/CLAUDE.md` — modify (banner `:535-536`, table `:535-615`, stale notes `:606-607`)

**Reviewers**: Service owner `xstockstrat-analysis` — backtest reproducibility, scoring determinism, second `marketdata` watcher

**Codebase Evidence**:
- The line list above is from `grep -rnE '"(analysis|marketdata)\.[a-z_]+\.[a-z_.]+"' app` filtered to config-read call shapes (`get_int|get_float|get_bool|get_str|..._present|int_positive|float_positive|str_nonempty`); 13 of the sites are outside the recon TSV (`analysis.engine.fundamentals_blend_enabled` `live_loop.py:371`/`servicer.py:5417`/`entry_backfill.py:108`; `analysis.backtest.fundamentals.enabled` `servicer.py:1887,1977,2155,2830,2888,5071,5660`; `analysis.strategy.default_exit_cooldown_days` `servicer.py:1257,2235`), but the gate sees them (same registered receivers).
- Gate file counts: `servicer.py` 48, `fundsignal_loop.py` 15, `live_loop.py` 5, `screener.py` 3, `entry_backfill.py` 2, `pnl_pattern_consumer.py` 2 = 75 records = 74 `analysis` + `marketdata.fundamentals.provider`.
- Receivers (registered): `fundsignal_loop.py:self._cfg` -> `analysis`, `fundsignal_loop.py:self._md_cfg` and `md_config_watcher` -> `marketdata`, `servicer.py:self._cfg|float_positive|int_positive|str_nonempty`, `live_loop.py:self._cfg|int_positive`, `screener.py:self._cfg|int_positive`, `entry_backfill.py:cfg_watcher|int_positive`, `pnl_pattern_consumer.py:int_positive`.
- Display kept: `servicer.py:822` WARN text names the FQN (`servicer.py:822` is a plain literal, not built with `_fqn`; it stays as display text).
- No `GetSecret`/`SetConfig` carries a prefixed key in analysis (explicit grep in recon: no hits in `app/`).
- Banner at `services/xstockstrat-analysis/CLAUDE.md:536`; `:606-607` carry "Unseeded (feature 227 seeding waiver)" notes (FR-5).

**Lands with**: Step 15

**TDD**: red-green required

**Covers**: —

**Instructions**: rewrite every config-read key to the key relative to `analysis` (`analysis.engine.fundamentals_blend_enabled` -> `engine.fundamentals_blend_enabled`, ...) and `fundsignal_loop.py:108` to `"fundamentals.provider"` (namespace `marketdata` via `_md_cfg`). Use the gate as the completeness oracle: run `node scripts/check-config-wiring.mjs --final --json` and rewrite every remaining `prefixed-read` finding file; do not rewrite event types or WARN text. Delete the 75 baseline entries (74 `analysis` + `marketdata.fundamentals.provider`; 29 left). Rewrite banner and the 74-row table under `Namespace: analysis`; correct the stale "Unseeded (feature 227 seeding waiver)" notes at `:606-607` where the stored set holds the key (`scripts/config-wiring-stored.json`).

**Verification**:
`V-PY(analysis,40)`; `V-GATE(analysis,29)`; `grep -c '"key": "opportunity.sparkline_bars"' scripts/config-wiring.json` prints 1 (305's `seeded-unread` row survives); the per-service zero check with `xstockstrat-marketdata` in place of `<svc>` also prints `0`; `grep -rnE "\"analysis\.[a-z_]+\.[a-z_.]+\"" services/xstockstrat-analysis/app | grep -v "event_type=\|event_parked\|snapshot\.\(captured\|degraded\)\|pattern\.sealed\|fundsignal\.\(run_started\|run_completed\|signals\)\|live_loop\.\|opportunity\.recompute"` prints nothing; `grep -n "cutover in feature 296" services/xstockstrat-analysis/CLAUDE.md` prints nothing.

---

### Step 17 — docs: strat-lab backtest skill names relative keys

**Status**: `done`
**Service**: `plugins/strat-lab`
**Files**:
- `plugins/strat-lab/skills/backtest/SKILL.md` — modify (`:81,127,141,187,228`)
- `plugins/strat-lab/skills/backtest/reference/aggregation.md` — modify (`:10-11`)
- `plugins/strat-lab/skills/backtest/reference/verification.md` — modify (`:31`)
- `plugins/strat-lab/skills/backtest/reference/output-handling.md` — modify (`:31`)

**Reviewers**: none

**Codebase Evidence**:
- `SKILL.md:81` `analysis.engine.fundamentals_blend_strategy_id` (AC-15); other operator-knob mentions: `:127,:141,:187` `analysis.backtest.fundamentals.enabled`, `:228` `analysis.backtest.max_duration_seconds` (a real key: `servicer.py:818`); `reference/aggregation.md:10-11` `analysis.backtest.portfolio_position_weight` / `.portfolio_max_concurrent` (read at `servicer.py:1239,1242`); `verification.md:31` and `output-handling.md:31` `analysis.backtest.fundamentals.enabled`.
- `analysis.strategy.scored` (`SKILL.md:73`) is an event type: do not touch.
- `docs/patterns/strat-lab-plugin.md:44-45` validators; plugin version `plugins/strat-lab/.claude-plugin/plugin.json:4` is `0.4.0` and is not bumped (design: YAGNI; `strat-lab-plugin.md:16-22,54-55` do not require it). `SetConfig` rejects prefixed keys, so every operator-facing mention must be (namespace, key).

**TDD**: N/A (docs-only; the grep count is the check: 1 before, 0 after)

**Covers**: AC-15

**Instructions**: at `SKILL.md:81` name the key as `engine.fundamentals_blend_strategy_id` under namespace `analysis`; respell the other listed mentions the same way ("`backtest.fundamentals.enabled` in namespace `analysis`"); leave the event-type mention. The string `analysis.engine.fundamentals_blend_strategy_id` must no longer appear in the file.

**Verification**:
RED (before): `grep -c "analysis.engine.fundamentals_blend_strategy_id" plugins/strat-lab/skills/backtest/SKILL.md` prints `1`. GREEN: prints `0`; `python3 plugins/strat-lab/scripts/validate.py --self-test && python3 plugins/strat-lab/scripts/validate.py` exit 0; `grep -rnE "analysis\.(engine|backtest)\.[a-z_.]+" plugins/strat-lab` prints nothing except display mentions you deliberately kept (list them in the Deviation Log).

---

### Step 18 — test: agent doubles and the shared sandbox-deadline reads

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_config_watcher.py` — modify (`_snapshot_watcher` `:20-38` guard; `:224` key; AC-17 test)
- `services/xstockstrat-agent/tests/test_formula_deadline.py` — modify (`_T`/`_G` `:12-13`)

**Reviewers**: Service owner `xstockstrat-agent` — MCP tool contract stability, no secret values in tool output

**Codebase Evidence**:
- `_snapshot_watcher(namespace, **values)` `tests/test_config_watcher.py:20-38` sets `w.namespace = namespace` (`:25`) and `install_watcher` `:41-45` registers it; callers: `test_tools.py:376,2284` (`agent`, already relative keys `signal.alert_threshold`, `extract.max_bytes`, `extract.max_redirects`), `test_formula_deadline.py:60,80,91` (`indicators`), `test_tools.py:2300`.
- `test_formula_deadline.py:12-13` `_T = "indicators.sandbox.timeout_ms"`, `_G = "indicators.sandbox.startup_grace_ms"`; `test_config_watcher.py:224` `key = "indicators.sandbox.timeout_ms"` (a stall/redial test over the real `ConfigWatcher`, `:215-240`).
- `tests/conftest.py:86` states policy reads fall back to defaults unless a test uses `install_watcher`.

**Lands with**: Step 19

**TDD**: red-green required

**Covers**: AC-17 (Python agent rows for `agent` and `indicators`)

**Instructions**: add the prefix rejection to `_snapshot_watcher` (`ValueError` naming key and relative spelling when a key starts with `namespace + "."`) so `install_watcher` inherits it; respell `_T`, `_G` and `:224` to `sandbox.timeout_ms` / `sandbox.startup_grace_ms`; add the AC-17 test for namespaces `agent` and `indicators`, including the `any.key` = 7 read-back. The `test_formula_deadline.py` cases assert stored values that differ from the 5000 default (`15000`, `5000`...): keep at least one row where stored differs from default so a prefixed reader fails. Residual sweep: `grep -rnE "['\"](agent|indicators)\.[a-z_]+\.[a-z_.]+['\"]" services/xstockstrat-agent/tests | grep -v "agent\.\(backend\|tool\|oauth\)"` prints only the intended survivors: the AC-17 `<ns>.any.key` literals and the FQN constants this step names (each a documented display/WARN string).

**Verification**:
Before Step 19 (RED): `(cd services/xstockstrat-agent && pytest tests/test_formula_deadline.py tests/test_config_watcher.py -x -q)` fails. After Step 19: `V-PY(agent,40)`.

---

### Step 19 — service: agent sandbox-deadline reads, shared baseline drain, banner

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/client.py` — modify (`:1127`, `:1128`)
- `scripts/config-wiring.json` — modify (delete `indicators.sandbox.timeout_ms` and `indicators.sandbox.startup_grace_ms`, the last readers)
- `services/xstockstrat-agent/CLAUDE.md` — modify (banner `:191-192`, table `:205-212` (the `agent.*` rows; re-grep, the merge added rows))

**Reviewers**: Service owner `xstockstrat-agent` — MCP tool contract stability (name, parameters, return shape)

**Codebase Evidence**:
- `client.py:1126-1128` `cfg = get_watcher("indicators")`; `int_positive(cfg, "indicators.sandbox.timeout_ms", 5000) if cfg else 5000` and the `startup_grace_ms` twin; receiver `client.py:int_positive` -> `"indicators"` registered. All `agent` reads are already relative.
- Baseline entries `indicators.sandbox.timeout_ms` / `.startup_grace_ms` (`config-wiring.json:499-527`) drain here: indicators' own reads were rewritten in Step 12. 27 left.
- MCP tool text mentions of prefixed keys (`app/tools.py:836,981,1079,1231`) are display and stay; no tool signature changes. Banner at `services/xstockstrat-agent/CLAUDE.md:191-192`. Agent prompt `signal_extraction.md:75` (stale `xstockstrat-agent.signal.alert_threshold`) is out of scope (not a read, not in FR-5).

**Lands with**: Step 18

**TDD**: red-green required

**Covers**: —

**Instructions**: change the two reads to `"sandbox.timeout_ms"` and `"sandbox.startup_grace_ms"`; delete the two baseline entries; rewrite banner and table so the `agent` rows are relative and the indicators sandbox keys are listed under their own namespace; respell the prose at `CLAUDE.md:199-201` that names `indicators.sandbox.timeout_ms` / `startup_grace_ms` as (namespace, key) (display only, the gate will not catch it).

**Verification**:
`V-PY(agent,40)`; `V-GATE(agent,27)`; `node scripts/check-config-wiring.mjs --final --json | node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8"));console.log(j.findings.filter(f=>f.kind==="prefixed-read"&&f.namespace==="indicators").length)'` prints `0`; `grep -n "cutover in feature 296" services/xstockstrat-agent/CLAUDE.md` prints nothing.

---

### Step 20 — test: trading platform watcher, doubles and gate proofs

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/config/config.go` — modify (`NewSnapshotWatcher` `:115-125` incl. its doc comment becomes `MustSnapshotWatcher(ns, values)`; guard rejects BOTH `trading.` and `platform.` prefixes in either namespace; stale comment `:57-58`)
- `services/xstockstrat-trading/internal/config/config_test.go` — modify (`brokerTimeoutKey` `:34` and `:318-370,460,470,487`; AC-17 test)
- `services/xstockstrat-trading/internal/service/trading_state_gate_test.go` — modify (`:77,100,141,154,156-192`; new `TestPlaceOrder_GatesOnPlatformWatcher_AliasOff`)
- `services/xstockstrat-trading/internal/service/trading_order_state_audit_test.go` — modify (`activeSnapshot` `:105-110`, `auditSvc` `:111-120`, `:572`; `reclaimSvc`)
- `services/xstockstrat-trading/internal/service/trading_reconciliation_test.go` — modify (`:177-179` builder, `:784-787` SetConfig target)
- `services/xstockstrat-trading/internal/service/trading_ibkr_auth_test.go` — modify (`snapshotInts` `:120-126`, `:174`, `:380`)
- `services/xstockstrat-trading/internal/service/order_intent_test.go` — modify (`:174` comment key)
- `services/xstockstrat-trading/internal/service/trading_sizing_test.go` — modify (`:67` `NewTradingService` call, literals `:81,100,119,135,152,165` call `ComputePositionSize` directly and never reach the halt gates: leave them unchanged unless the compiler requires the field)
- Literals that reach `PlaceOrder`/`ReplaceOrder`/the halt gates and must also set `platformCfgW`: `services/xstockstrat-trading/internal/service/trading_bracket_test.go:520-545` (and the `cfgW` helper `:210-211`), `services/xstockstrat-trading/internal/service/trading_helpers_test.go:19`, `services/xstockstrat-trading/internal/service/trading_offline_test.go:585-602` (pin: assert `svc.platformCfgW != nil` before the call, because `defer recover()` at `:601` swallows a nil dereference), `services/xstockstrat-trading/internal/service/trading_ownership_test.go:29,45,60,76`, `services/xstockstrat-trading/internal/service/trading_telemetry_test.go:131,146,727` and the `auditSvc` callers (`:518,538`), `services/xstockstrat-trading/internal/service/trading_flatten_rejection_test.go:99`, `services/xstockstrat-trading/internal/service/trading_cancel_not_cancelable_test.go:30`, `services/xstockstrat-trading/internal/service/trading_resume_account_test.go:100`

**Reviewers**: Service owner `xstockstrat-trading` — order execution correctness, halt-path fail-closed, paper-only dev invariant

**Codebase Evidence**:
- Today one watcher serves both namespaces: `cmd/server/main.go:70` `config.NewWatcher(cfg.ConfigEndpoint, cfg.ApplicationEnv, cfg.TradingMode, "trading", "platform")`; first-hit-wins `lookup` `internal/config/watchcore.go:352-365`; `NewTradingService` takes one `cfgW *config.Watcher` (`trading.go:213-221`) and sets `cfgW`, `configSetter: cfgW` (`:254-258`).
- Gate reads: `trading.go:443` `s.cfgW.GetBool("platform.maintenance_mode", false)` (first line of `PlaceOrder`); `:3658` `s.cfgW.GetString("platform.trading_state", "HALTED")` (`currentTradingState`, called by `checkTradingStateForPlaceOrder` `:3683-3712` and `checkTradingStateForReplace` `:3715-3731`; callers `:508`, `:1504`).
- `NewSnapshotWatcher(` call sites: `config_test.go:318,325`, `trading_order_state_audit_test.go:106`, `trading_state_gate_test.go:156,169,189`, `trading_ibkr_auth_test.go:126` (7 in total, in 4 test files).
- `brokerTimeoutKey` is used both as a read key and as the WARN-naming string (`config_test.go:470,487`): split into `brokerTimeoutKey = "broker.timeout_ms"` (reads, `config.read_key` record) and `brokerTimeoutFQN = "trading.broker.timeout_ms"` (the WARN `fqn` assertion, 295 @AC-12), so the assertion cannot pass on a substring.
- Reconciliation poller asserts the SetConfig target `trading_reconciliation_test.go:784-787`: `req.Namespace != "platform" || req.Key != "platform.trading_state"`.
- AC-1 harness needs a `brokers` pool entry `{"acct-1": {userID: "u1", brokerType: ALPACA}}`, `ClientOrderId`, context user `u1` (`ctxAsUser`, `trading_ownership_test.go:21`), `TradingMode` PAPER and a `portfolio` fake whose `GetPosition` returns NotFound (`fakePortfolioClient`, `trading_state_gate_test.go:84`); without them `PlaceOrder` returns InvalidArgument/NotFound/PermissionDenied before the gate and the test is vacuous.
- `scripts/config-wiring.json` entries (edited in Step 21, not here): receivers `trading.go:s.cfgW` list at the `registry.receivers` block; `broker.paper` defect entry (`kind: read-unseeded`, `namespace: trading`, `key: trading.broker.paper`, owner `defect 2026-11-06-trading-broker-paper-env-derived-default-unseedable`).
- Trading-domain constraints: **Broker coverage** — the halt gates are broker-agnostic (`currentTradingState` before `s.portfolio.GetPosition`), ALPACA=1 and IBKR=2 behave identically; the AC-1 harness uses ALPACA, IBKR is unaffected by this step. **Trading mode gate** — `grep -n "TradingMode\|PAPER" internal/service/trading.go` (paper/live derives from environment; `environmentIsPaper`/`resolveTradingMode` at `:2725,3738` only change spelling). **Order types / fill states** — unaffected by this step (key spelling and watcher wiring only).

**Lands with**: Step 21

**TDD**: red-green required

**Covers**: AC-1, AC-17 (Go trading rows: `trading.any.key`, `platform.any.key` in `trading`, `platform.any.key` in `platform`)

**Instructions**:
1. `config.go`: `MustSnapshotWatcher(ns string, values map[string]*configv1.ConfigValue) *Watcher` applies the snapshot under `ns` and panics naming the key and its relative spelling when a key starts with `trading.` or `platform.` (either namespace); keep the body a few lines (jscpd `minTokens: 100`; its two-prefix guard already differs from the other two) and add the `strings` import. Fix the comment at `:57-58` ("Trading subscribes to `trading` and `platform`; getters search them in that order") to say the watcher is single-namespace and `platform` has its own watcher.
2. `config_test.go`: respell `:318-370` to relative keys through `MustSnapshotWatcher("platform", ...)` / `("trading", ...)` or `snapshot("platform", {"trading_state": ...})`; add the `brokerTimeoutFQN` split; add the AC-17 table test (three rows, each also asserting the `any.key` = 7 read-back).
3. `trading_state_gate_test.go`: replace `config.NewSnapshotWatcher(map{"platform.trading_state": ...})` by `platformCfgW: config.MustSnapshotWatcher("platform", {"trading_state": ...})`; literals that used a zero `&config.Watcher{}` for the halt default now set both `cfgW` and `platformCfgW` to `&config.Watcher{}`. Add `TestPlaceOrder_GatesOnPlatformWatcher_AliasOff`: `TradingService{cfgW: MustSnapshotWatcher("trading", {"trading_state": ACTIVE}), platformCfgW: MustSnapshotWatcher("platform", {"trading_state": REDUCE_ONLY}), brokers: {"acct-1": ...}, portfolio: NotFound fake}`; a BUY of AAPL (`ClientOrderId` set, `TradingMode` PAPER, user `u1`) on a flat account returns `FailedPrecondition` `trading reduce-only: no existing position in AAPL; order would increase exposure`, not `trading halted: platform.trading_state=HALTED` and not accepted. Add the inverse test: platform ACTIVE and `trading`/`trading_state` = HALTED still passes the gate (no shadowing).
4. Split `activeSnapshot()` into a trading snapshot (`risk.max_position_pct` = 0) and a platform snapshot (`trading_state` = ACTIVE) and set both fields in `auditSvc`/`:572`. For every other `TradingService{...}` literal listed in **Files**, add `platformCfgW: &config.Watcher{}` next to `cfgW`; the rule: every literal or helper that sets `cfgW` and can reach the gates also sets `platformCfgW`. Pin `trading_offline_test.go:585` with a `platformCfgW != nil` assertion.
5. `trading_reconciliation_test.go:784-787`: expect `req.Namespace == "platform" && req.Key == "trading_state"`; `:177-179` builder sets `platformCfgW`.
6. `trading_ibkr_auth_test.go`: `snapshotInts` builds via `MustSnapshotWatcher("trading", ...)`; keys `ibkr.handshake_timeout_ms`, `ibkr.reauth_min_interval_ms`.
7. `trading_sizing_test.go:67`: `NewTradingService(cfg, &config.Watcher{}, &config.Watcher{}, nil, nil, nil, nil, "")`; add a test that `NewTradingService(cfg, &config.Watcher{}, nil, ...)` returns an error naming the platform watcher and dials nothing.
8. Residual-double sweep: `grep -rnE "['\"](trading|platform)\.[a-z_]+(\.[a-z_]+)*['\"]" --include=*_test.go services/xstockstrat-trading | grep -v "trading\.\(orders\|flatten\|bracket\|ledger_emit\|alert_emit\|escalation\|order_submit\|order_intents\|broker_accounts\)"` prints only the intended survivors: the AC-17 `<ns>.any.key` literals and the FQN constants this step names (each a documented display/WARN string) (`trading.any.key`, `platform.any.key`, `brokerTimeoutFQN`).

**Verification**:
Before Step 21 (RED): `(cd services/xstockstrat-trading && GOWORK=off go vet ./... 2>&1 | head)` fails to compile on the new signature or `go test ./internal/service -run 'GatesOnPlatformWatcher|NewTradingService' ` fails. After Step 21: `V-GO(trading)`; `grep -n "TRADING_MODE\|TradingMode\|PAPER" services/xstockstrat-trading/internal/service/trading.go | head` still shows the mode gate; `grep -rn "NewSnapshotWatcher" services/xstockstrat-trading` prints nothing (rename the doc comment at `config.go:115` with the function and fix the comment at `trading_state_gate_test.go:154`).

---

### Step 21 — service: trading two watchers, relative literals, poller key, drains, banner

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/cmd/server/main.go` — modify (`:70` becomes two named locals `tradingCfgW`, `platformCfgW`; `:76-79` shared wait; `:99` call)
- `services/xstockstrat-trading/internal/service/trading.go` — modify (struct field; `NewTradingService` `:213-221,:254-258`; reads `:443,528,536,579,580,718,783,1753,1896,1914,1968-1970,2268,2412,2535,2552-2554,2569,2725,2777,2977,2978,3017,3278,3409-3411,3480,3529,3658,3738`)
- `services/xstockstrat-trading/internal/service/order_intent.go` — modify (`:106`, `:123`)
- `scripts/config-wiring.json` — modify (delete 25 `trading` `prefixed-read` entries plus `platform.maintenance_mode`; respell `registry.dynamic` `ibkrTiming`; rename the `read-unseeded` entry key `trading.broker.paper` to `broker.paper`, owner unchanged (in scope by signed FR-4/AC-14, although the entry's owner is a defect, not 304); registry receivers: `trading.go:s.cfgW` from `["trading","platform"]` to `"trading"` and new `trading.go:s.platformCfgW` -> `"platform"`; this step alone owns every `config-wiring.json` edit for trading, because the reader literals change here)
- `services/xstockstrat-trading/CLAUDE.md` — modify (banner `:84-85`, stale paragraph `:88-93` "merges them", table `:97-125`, `platform.*` rows `:107-108`, `:124`, `:260`)

**Reviewers**: Service owner `xstockstrat-trading` — order execution correctness, halt-path fail-closed, paper-only dev invariant, boot exit on nil/late snapshot, poller `SetConfig` key

**Codebase Evidence**:
- Constructor and struct: `NewTradingService(cfg, cfgW, accountRepo, repo, orderIntentRepo, bracketRepo, encKey)` `trading.go:213-221`; literal `return &TradingService{cfg: cfg, cfgW: cfgW, configSetter: cfgW, ...}` `:254-258`. Callers: `main.go:99`, `trading_sizing_test.go:67`.
- Prefixed reads (all on `s.cfgW`): `order_intent.go:106` `cfgW.GetFloat("trading.order_intent.stale_multiplier", 3.0)`, `:123`; `trading.go` lines above; `ibkrTiming` closure `ms(key, def)` `:2547-2554` with `"trading.ibkr.lst_refresh_margin_ms"`, `".handshake_timeout_ms"`, `".reauth_min_interval_ms"`; `brokerCallTimeout(cfgW)` `:2533-2539`; `trading.broker.paper` `:2725`, `:3738` (the `read-unseeded` defect entry, AC-14).
- Poller write: `escalateSystemic` `trading.go:2263-2268` `SetConfig{Namespace:"platform", Key:"platform.trading_state", ...}` via `s.configSetter` (set to `cfgW`); the shim accepts either spelling today (`configServiceImpl.ts:694-721`) and authz matches canonically (`authz.ts:119-124`); feature 306 removes the shim. The setter stays `cfgW`.
- Display strings kept: reject strings at `trading.go:3691,3722` (`trading halted: platform.trading_state=HALTED`), 192 @AC-1.
- Boot contract: `docs/patterns/config-startup.md:7-16,74` (90 s budget); `watchcore.go:47-48,198-209` `snapshotWaitTimeout = 90s` is per call, so two sequential waits would double the budget; same-env scope scar (`services/xstockstrat-trading/docs/context-constitution.md:39`): both watchers receive the same `cfg.ApplicationEnv`.
- Baseline: 25 `trading` entries (`trading.approval.*`, `trading.broker.timeout_ms`, `trading.credential_health.interval_ms`, `trading.fill_poller.interval_ms`, `trading.ibkr.*`, `trading.order.*`, `trading.order_intent.*`, `trading.position_sync.interval_ms`, `trading.reconciliation.*`, `trading.risk.*`) plus `platform.maintenance_mode` (only reader `trading.go:443`) = 26 deleted; `platform.trading_state` stays for the ui commit (1 left).
- Trading-domain constraints: Broker coverage, trading-mode gate, order-type and fill-state items — unaffected beyond key spelling and the platform watcher (see Step 20 evidence); `CancelOrder` is never gated (100 PRESERVE).

**Lands with**: Step 20

**TDD**: red-green required

**Covers**: AC-14

**Instructions**:
1. `main.go`: build `tradingCfgW := config.NewWatcher(endpoint, env, mode, "trading")` and `platformCfgW := config.NewWatcher(endpoint, env, mode, "platform")` with the same `cfg.ApplicationEnv`, both before either is awaited (keep each call's existing `(watcher, err)` handling, `main.go:70-79`); one `waitCtx, waitCancel := context.WithTimeout(ctx, 90*time.Second)` with `defer waitCancel()` (never reuse the name `cancel`: `main.go:41` declares the root `ctx, cancel := context.WithCancel(...)` and the shutdown goroutine calls `cancel()` at `:165`, so a same-scope `waitCtx, cancel :=` would silently reassign it) shared by both `WaitForSnapshot(waitCtx)` calls; either failing logs and `os.Exit(1)`. Pass both to `NewTradingService`.
2. `trading.go`: add `platformCfgW *config.Watcher` to the struct; `NewTradingService` takes it as a REQUIRED third argument, right after `cfgW` (`NewTradingService(cfg, cfgW, platformCfgW, accountRepo, repo, orderIntentRepo, bracketRepo, encKey)`), and returns an error on nil before any dial (the first statement). Only `:443` (`maintenance_mode`) and `:3658` (`trading_state`) read `s.platformCfgW`; every `trading.*` getter, including `ibkrTiming`, stays on `cfgW`. `escalateSystemic` sends `Key: "trading_state"` in `Namespace: "platform"`; rewrite the comment at `:2264-2267` to the constraint in at most two lines.
3. Rewrite every other literal to the key relative to `trading` (`risk.sizing_enabled`, `ibkr.lst_refresh_margin_ms`, `broker.paper`, ...) and the three `registry.dynamic` `ibkrTiming` entries to `ibkr.handshake_timeout_ms`, `ibkr.lst_refresh_margin_ms`, `ibkr.reauth_min_interval_ms`.
4. `scripts/config-wiring.json`: delete the 26 entries; rename the `read-unseeded` entry key `trading.broker.paper` to `broker.paper` (owner unchanged); set the receivers `trading.go:s.cfgW` -> `"trading"` and add `trading.go:s.platformCfgW` -> `"platform"` (with the old list kept, every relative trading read would be `unattributed`).
5. `CLAUDE.md`: relative rule banner; replace the "merges them" paragraph (one watcher over two namespaces) with the two-watcher description; list trading keys under `Namespace: trading` and `trading_state`, `maintenance_mode` under `Namespace: platform (separate required watcher)`.
6. Open risk accepted (design): `maintenance_mode` defaults `false` (fail-open on that axis), `trading_state` defaults HALTED and dominates, boot exits if the platform snapshot is absent; a platform-stream drop keeps the last `trading_state` until the reconnect SNAPSHOT (WARN `config watcher stream ended, reconnecting namespace=platform`).

**Verification**:
`V-GO(trading)`; `V-GATE(trading,1)` (the remaining entry is `platform.trading_state`; expect a `REPORTED ... readers-disagree` line for it); `grep -n "NewWatcher" services/xstockstrat-trading/cmd/server/main.go` shows two calls; `grep -n "platformCfgW" services/xstockstrat-trading/internal/service/trading.go` shows the field, the constructor parameter, the nil check, the struct-literal assignment, `:443` and the `currentTradingState` read only; `grep -rnE "\"(trading|platform)\.[a-z_]+(\.[a-z_]+)*\"" services/xstockstrat-trading --include=*.go | grep -v "_test.go\|internal/telemetry/\|trading\.orders\|trading halted\|Errorf\|Warn"` prints nothing; `grep -n "cutover in feature 296" services/xstockstrat-trading/CLAUDE.md` prints nothing.

---

### Step 22 — test: ui trader positions reads the relative platform key

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/fixtures/configKeys.ts` — modify (add the platform `GetConfig` fixture, named `PLATFORM_TRADING_STATE_VALUES`, in the `{ case, value }` init shape and the wire-JSON shape)
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify (new row; consumers listed below)
- `services/xstockstrat-ui/e2e/mock-backend.ts` — modify (`:1516,1547`)
- `services/xstockstrat-ui/e2e/trader/positions-reconciliation.spec.ts` — modify (`:10,:119`)
- `services/xstockstrat-ui/src/lib/traderBff.test.ts` — modify (`:38,:65`)
- `services/xstockstrat-ui/src/lib/configUiBff.test.ts` — modify (`:37`)

**Reviewers**: Service owner `xstockstrat-ui` — trader positions `trading_state` read, mock-backend and fixtures (C-12), no secret rendering

**Codebase Evidence**:
- Page read: `src/app/trader/positions/page.tsx:121-130` `traderConfigClient.getConfig({ namespace: 'platform' })`, then `resp.values['platform.trading_state']`; registered gate receiver `page.tsx:resp.values` -> `"platform"` (`config-wiring.json` receivers).
- Doubles: `e2e/mock-backend.ts:1547` `'platform.trading_state': { value: { case: 'stringVal', value: 'ACTIVE' } }` (comment `:1516,:1546`); `e2e/trader/positions-reconciliation.spec.ts:119` raw wire JSON `'platform.trading_state': { stringVal: 'REDUCE_ONLY' }` through `page.route`; `src/lib/traderBff.test.ts:38,:65` (mocked `getConfig` response and `body.values['platform.trading_state'].stringVal`); `src/lib/configUiBff.test.ts:37` posts `key: 'notify.push.min_severity'` in namespace `notify` (a mocked write the real server would reject): respell to `push.min_severity`.
- `e2e/fixtures/configKeys.ts` has no platform `GetConfig` fixture (it holds `setConfigPayload`, `CONFIG_KEY_FIXTURES`, `listKeysStubBody`); `e2e/fixtures/INVENTORY.md:51-53` are the existing config rows. Left alone (display/audit data): `NamespaceEditor.tsx:267` (`configFqn(...) === 'platform.trading_state'` is a display FQN), `bffAuthMetrics.test.ts` (`ui.theme.default`), the config-ui specs.
- Auth helpers: `e2e/helpers/auth.ts` `addAuthCookie` (already used by the spec, not re-implemented).

**Lands with**: Step 23

**TDD**: red-green required

**Covers**: AC-5

**Instructions**: add one exported fixture in `configKeys.ts` holding the platform values (`trading_state: REDUCE_ONLY` and an `ACTIVE` default) in both shapes the consumers need, with a docstring in the file's existing style; point `mock-backend.ts:1547`, `positions-reconciliation.spec.ts:119` and `traderBff.test.ts:38,65` at it (`e2e/*` files import `../fixtures` / `./fixtures`; `src/lib/traderBff.test.ts` imports `../../e2e/fixtures/configKeys`, the established pattern of `configUiBff.test.ts:4`). The `getConfig` mock at `traderBff.test.ts:34-45` answers `HALTED` or `ACTIVE` by `req.environment`: keep that conditional in the test and use the fixture only for the shared response shape (or export the fixture as a function of the state); add an `INVENTORY.md` row (fixture symbols, home `e2e/fixtures/configKeys.ts`, proto `xstockstrat.config.v1.GetConfigResponse`, consumers `e2e/mock-backend.ts:1547`, `e2e/trader/positions-reconciliation.spec.ts`, `src/lib/traderBff.test.ts`). Respell `configUiBff.test.ts:37`. Scenario one-offs (error payloads) stay inline (C-12). Residual-double sweep: `grep -rnE "['\"](platform|notify|ui)\.[a-z_]+(\.[a-z_]+)*['\"]" services/xstockstrat-ui/e2e services/xstockstrat-ui/src` lists only the intended non-reads: `NamespaceEditor.tsx:267-268` (display FQN compare), the config-ui specs under `e2e/config-ui/` (`platform.log_level`, `platform.trading_state`, `platform.maintenance_mode`), `src/lib/configFqn.test.ts:17` (display FQN), `bffAuthMetrics.test.ts:144,172` (`ui.theme.default`, audit-row data) and the OTel instrument names (`ui.auth.events`, `ui.bff.requests` in `bffMetrics.ts:43-44`, `identity.test.ts:56`, `auth.test.ts:115`, `bffMetrics.test.ts:198`, `bffAllowlist.test.ts:20-21`, `bffAuthMetrics.test.ts:94,109`); not sweep hits but also intentionally unchanged: `src/lib/browserClients/traderConfigClient.ts:6` (comment), `positions-reconciliation.spec.ts:10` (comment), the `credentials_ref` builders. Any other hit is a missed double, except `src/app/trader/positions/page.tsx:129-130`, which still hits until Step 23 lands.

**Verification**:
Before Step 23 (RED): `(cd services/xstockstrat-ui && pnpm exec vitest run traderBff configUiBff && pnpm exec playwright test e2e/trader/positions-reconciliation.spec.ts)` — the banner assertion `Trading reduce-only platform-wide` fails (page still reads the prefixed key). After Step 23: the same commands pass; `grep -n "from '../fixtures'\|from './fixtures'\|helpers/auth" services/xstockstrat-ui/e2e/trader/positions-reconciliation.spec.ts services/xstockstrat-ui/e2e/mock-backend.ts`; `grep -n "PLATFORM" services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` shows the new row; `(cd services/xstockstrat-ui && pnpm run lint && pnpm run test:coverage)` (vitest enforces `thresholds.lines: 40` over `src/lib/**`, `services/xstockstrat-ui/vitest.config.*:29-32`; the run must exit 0).

---

### Step 23 — service: ui trader positions reads `trading_state`, last baseline drain, banner

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/trader/positions/page.tsx` — modify (`:126-130`)
- `scripts/config-wiring.json` — modify (delete the last `prefixed-read` entry, `platform.trading_state`)
- `services/xstockstrat-ui/CLAUDE.md` — modify (banner `:264-265`, table `:264-274`)

**Reviewers**: Service owner `xstockstrat-ui` — Connect-RPC call safety, environment scope correctness, no secret values rendered

**Codebase Evidence**:
- `page.tsx:127-131` `return resp.values['platform.trading_state']?.value.case === 'stringVal' ? resp.values['platform.trading_state'].value.value : null` with the namespace bound at `:126` (`namespace: 'platform'`, stays `platform`; do not move to `trading`); the comment at `:127-128` ("Full-dotted key per feature 189") becomes stale.
- Baseline `platform.trading_state` drains here (readers: trading `trading.go:3658`, ui `page.tsx:129-130`): 0 left after this step.
- Banner at `services/xstockstrat-ui/CLAUDE.md:265`; the table rows `:273-274` are `ui.performance.*`; decide (default: add) a `platform` / `trading_state` row, since this service reads it.

**Lands with**: Step 22

**TDD**: red-green required

**Covers**: —

**Instructions**: read `resp.values['trading_state']` (both occurrences) and replace the stale comment with a two-line constraint ("GetConfig(namespace:'platform') is keyed by the namespace-relative stored key"); delete the last baseline entry; rewrite banner and the table (`Namespace: ui` rows relative `performance.risk_free_rate_annual`, `performance.equity_curve_start_date`, plus a `platform` / `trading_state` read row).

**Verification**:
`(cd services/xstockstrat-ui && pnpm run lint && pnpm run test:unit && pnpm exec playwright test e2e/trader/positions-reconciliation.spec.ts e2e/trader/positions.spec.ts)`; `V-GATE(ui,0)` with the baseline count `0`; `node scripts/check-config-wiring.mjs --final` exits 0; `grep -n "platform.trading_state" services/xstockstrat-ui/src/app/trader/positions/page.tsx` prints nothing; `grep -n "cutover in feature 296" services/xstockstrat-ui/CLAUDE.md` prints nothing.

---

### Step 24 — test: gate tests for the empty baseline, schema error and widened doc scan

**Status**: `pending`
**Service**: `scripts/` (config-wiring gate)
**Files**:
- `scripts/config-wiring.test.mjs` — modify (`join 9 @AC-22` `:244-250`, `join 9 @AC-23` `:265-274`, `ratchet 10 @AC-23` `:440-446`, `baseline 2` `:557-569`, `doc 1` `:694`, `scratchDocs()` `:707-714`; add AC-7/AC-8/AC-9/AC-10/AC-11 tests)

**Reviewers**: Platform Lead — cross-service consistency, gate close-out, baseline ownership

**Codebase Evidence**:
- Tests that go red when `prefixed-read` leaves `BASELINE_KINDS`: `config-wiring.test.mjs:244-250` (baselining prefixed-read lets `--final` pass), `:265-274` (leftover entry goes `STALE`), `:440-446` (`ratchet 10 @AC-23`: entry owned by `feature 304` covers the finding; `validateState` throws `/feature 304/` for another owner), `:563,:565` (`baseline 2` allowed kinds and owner assert), `:694` (`doc 1` requires `'the prefixed spelling via the alias until'`). `baseline 1` `:550-553` runs `--final` on the real tree (needs the empty baseline).
- Helpers: `cli`, `stamp`, `prefixedCopy(edit)` `:218-230` (scratch copy of `join/prefixed-read` with ledger receivers), `baselineOf` `:230`, `scratchDocs()` `:707-714` copies only `DOC_C05`, `DOC_CONFIG9`, `DOC_GOV`.
- `join 9 @AC-6 @AC-22` `:231-243` already asserts an unbaselined prefixed read blocks `--final` (the AC-8 detector half, kept as characterization; add the `@AC-8` tag).
- AC-9: `attribute()` `check-config-wiring.mjs:548-553` picks a listed namespace only by a `<ns>.` key prefix (unchanged). AC-10: `excluded()` `:626-627` and `loadCatalog` `:555-` read `scripts/config-heal/catalog.tsv` (column header in the real file's line 1); the negative-matches fixture has no catalog file (`find ... -name catalog.tsv` empty).

**Lands with**: Step 25, Step 26

**TDD**: red-green required

**Covers**: AC-7, AC-8, AC-9, AC-10, AC-11, AC-12 (clause c: bound to `baseline 1 @AC-7` plus the seeded-unread entry `ledger` / `stream.notify_enabled`, owner feature 305, in the real baseline)

**Instructions**:
1. AC-7: rewrite `join 9 @AC-22` / `@AC-23` / `ratchet 10 @AC-23` into "a baseline containing a `prefixed-read` entry exits 2" (`cli(dir, '--final')` status 2; `cw.validateState` throws on kind `prefixed-read`); keep `join 9 @AC-6 @AC-22`'s unbaselined blocking assertion (AC-8, characterization). `baseline 1` passes against the real tree once the baseline is empty.
2. `baseline 2`: remove `'prefixed-read'` from the allowed kinds and delete the `:565` owner assert; add `assert.equal(findings.filter(f => f.kind === 'prefixed-read').length, 0)`.
3. AC-9 (characterization): from `prefixedCopy`, set the reader file's receiver to the list `['ledger', 'platform']` and read a relative key; expect `unattributed` for it and exit 1 (the scenario's "stored in both namespaces" Given does not change the outcome, because `attribute()` picks a listed namespace only by a `<ns>.` key prefix; characterization).
4. AC-10 (characterization, fixture test): scratch-copy `join/negative-matches`, write `scripts/config-heal/catalog.tsv` with the real header and one row `indicators\tindicators.sandbox.\tprefix\tint\t5000\tfixture\txstockstrat-indicators\tfalse\t\tfalse` (exactly the 10 `CATALOG_COLS`, `check-config-wiring.mjs:529`; `loadCatalog` throws otherwise), rewrite its indicators `watcher.py` to `self.get_int("sandbox.timeout_ms", 5000)` AND rewrite the fixture's stored row (`scripts/config-wiring-stored.json`, key `indicators.sandbox.timeout_ms`) to `sandbox.timeout_ms` so the Given ("namespace indicators stores `sandbox.timeout_ms`") really holds (a relative read against the prefixed seed would be a `form-mismatch`, `check-config-wiring.mjs:618-623`, and the test would assert nothing), restamp, run `--final`: exit 0, no `read-unseeded`, `prefixed-read` or `form-mismatch` finding for it, with the same result when the catalog row is removed (characterization: the prefix row is not what makes it clean).
5. AC-11: `--doc-check` passes on the real tree; a scratch copy whose `services/xstockstrat-trading/CLAUDE.md` contains `via the alias until` fails; no `CLAUDE.md` in the repo contains `Target form is namespace-relative, cutover in feature 296` (`doc 1` extension). `scratchDocs()` copies the widened file set (root `CLAUDE.md`, `docs/runbooks/config-rollout.md`, every `services/*/CLAUDE.md`) so `doc 3/6` stay green; the existence-guard case (missing file is skipped) gets its own test.
6. Update `doc 1`: drop the `'the prefixed spelling via the alias until'` includes-assert and assert the caveat is absent instead.

**Verification**:
Before Step 25 (RED): `node --test scripts/config-wiring.test.mjs 2>&1 | tail -30` shows the new AC-7 and AC-11 tests and the rewritten `doc 1` failing against the old script (AC-9 and AC-10 are characterization tests: they pass against the old script by design). After Steps 25 and 26: `node --test scripts/config-wiring.test.mjs` passes; `node scripts/check-config-wiring.mjs --final` exits 0 with `prefixed-read` count `0` in `scripts/config-wiring.json`; `node scripts/check-config-wiring.mjs --doc-check` exits 0; `bash scripts/check-watcher-copies.sh`.

---

### Step 25 — service: gate close-out (kind removal, widened doc scan, CI filters)

**Status**: `pending`
**Service**: `scripts/` (config-wiring gate) and `.github/workflows/ci.yml`
**Files**:
- `scripts/check-config-wiring.mjs` — modify (`:169-170,:195,:775-776,:779-790`)
- `.github/workflows/ci.yml` — modify (`:55` portfolio trigger; `config-wiring` filter `:123-150`)

**Reviewers**: Platform Lead — cross-service consistency, gate close-out, baseline ownership

**Codebase Evidence**:
- `check-config-wiring.mjs:169` `export const PREFIXED_READ_OWNER = 'feature 304'`; `:170` `BASELINE_KINDS` contains `'prefixed-read'`; `:195` the validation clause `if (e.kind === 'prefixed-read' && e.owner !== PREFIXED_READ_OWNER)`; `join` keeps emitting the blocking finding at `:630-632` (296 @AC-6/@AC-24 PRESERVE; unchanged).
- `DOC_RULES` `:770-774` (3 files), `DOC_RULE_SENTENCES` `:775` (includes `'the prefixed spelling via the alias until'`), `DOC_BANNED` `:776`, `docCheck` `:779-790` reads each file with no existence guard.
- Doc scan inventory today: 31 banned-phrase lines in 17 files (a case-insensitive grep shows 32: `services/xstockstrat-config/docs/context-constitution.md:7` holds lowercase "no fixed convention", which the case-sensitive `DOC_BANNED` regex `/NO fixed convention/` does not match) (22 banner lines in the 11 consumers, analysis `:606-607`, marketdata `:76`, root, rollout, config `CLAUDE.md`, plus the 3 `DOC_RULES` scopes) — all swept by Steps 2-23 and 26.
- CI: portfolio trigger `ci.yml:55` `xstockstrat-portfolio:  ['services/xstockstrat-portfolio/**']`; the `config-wiring` filter lists services/scripts/docs paths (`:123-150`) but not `CLAUDE.md`, `services/*/CLAUDE.md`, `docs/runbooks/config-rollout.md`. The job runs `node --test scripts/config-wiring.test.mjs`, `--final`, `--doc-check` (`:1027-1051`).
- `excluded()` and `attribute()` are unchanged by design (FR-4).

**Lands with**: Step 24, Step 26

**TDD**: red-green required

**Covers**: —

**Instructions**:
1. Remove `'prefixed-read'` from `BASELINE_KINDS`, delete `PREFIXED_READ_OWNER` and its validation clause (a baselined entry now fails the kind check, exit 2).
2. Remove `'the prefixed spelling via the alias until'` from `DOC_RULE_SENTENCES`; add `/via the alias until/i` to `DOC_BANNED`; widen the scan to root `CLAUDE.md`, `docs/runbooks/config-rollout.md` and every `services/*/CLAUDE.md`, existence-guarded (skip a missing file), banned-phrase scan only for the new files (no rule-sentence requirement).
3. `ci.yml`: portfolio trigger becomes `['services/xstockstrat-portfolio/**', 'scripts/config-wiring-stored.json']`; add `CLAUDE.md`, `services/*/CLAUDE.md` and `docs/runbooks/config-rollout.md` to the `config-wiring` filter.

**Verification**:
`node --test scripts/config-wiring.test.mjs`; `node scripts/check-config-wiring.mjs --final`; `node scripts/check-config-wiring.mjs --doc-check`; `grep -n "prefixed-read" scripts/check-config-wiring.mjs` shows only the `join` emission and comments; `grep -n "config-wiring-stored.json" .github/workflows/ci.yml` shows the portfolio trigger; `bash scripts/check-watcher-copies.sh`.

---

### Step 26 — docs: sweep the alias caveat and settle read-notes (C-16 CHANGEs)

**Status**: `pending`
**Service**: `docs/` and shared agent/skill references
**Files**:
- `CLAUDE.md` — modify (`:161` caveat sentence)
- `docs/runbooks/config-rollout.md` — modify (`:31`)
- `services/xstockstrat-config/CLAUDE.md` — modify (`:111`)
- `docs/sdd/constitution.md` — modify (`:36` C-05 row)
- `docs/patterns/config-governance.md` — modify (`:66` caveat; `:68`, `:77`, `:79` transition prose; `:560` stale note)
- `services/xstockstrat-config/docs/context-constitution.md` — modify (`:26` CONFIG-9)
- `docs/context-constitution.md` — modify (`:52` PLAT-14)
- `.claude/agents/spec-reviewer.md` — modify (`:20`)
- `.claude/skills/sdd-spec/reference/spec-template.md` — modify (`:136`)
- `.claude/skills/sdd-review/reference/product-spec-criteria.md` — modify (`:25`)
- `docs/sdd/business-rules/platform.feature` — modify (read-notes `:1440`, `:1441`; 296 @AC-22/@AC-23 read-note near `:1580-1593`)
- `services/xstockstrat-indicators/acceptance/fix-sandbox-seed-keys.feature` — modify (read-note `:7`)
- `services/xstockstrat-trading/acceptance/fix-trading-config-key-mismatch.feature` — modify (read-note for `:25`)
- `services/xstockstrat-ledger/acceptance/fix-config-keys-drift.feature` — modify (`:11` `ledger reads "ledger.export.enabled" twice` and `:13` `one read-key record for "ledger" / "ledger.export.enabled"`: respell both to `export.enabled`, so the record is `ns=ledger key=export.enabled`)
- `services/xstockstrat-trading/CLAUDE.md` — already rewritten in Step 21 (verify the "merges them" paragraph is gone)

**Lands with**: Step 24, Step 25

**Reviewers**: none

**Codebase Evidence**:
- Caveat sentence ("readers may still use the prefixed spelling via the alias until feature 304's baseline is empty") confirmed at: `CLAUDE.md:161`, `docs/runbooks/config-rollout.md:31`, `services/xstockstrat-config/CLAUDE.md:111`, `docs/sdd/constitution.md:36`, `docs/patterns/config-governance.md:66`, `services/xstockstrat-config/docs/context-constitution.md:26`, `docs/context-constitution.md:52` (PLAT-14 phrasing: "the reader's string stays the prefixed spelling until feature 304"), `.claude/agents/spec-reviewer.md:20`, `.claude/skills/sdd-spec/reference/spec-template.md:136`, `.claude/skills/sdd-review/reference/product-spec-criteria.md:25`; `docs/sdd/business-rules/platform.feature:1441` (295 @AC-20 read-note), `:1440` (295 @AC-19: "owned by features 304 (prefixed-read), 305 and 306").
- 296 @AC-22/@AC-23 scenarios at `platform.feature:1580-1593` ("with that finding baselined under owner \"feature 304\", \"--final\" exits 0"; "leftover entry is reported STALE"): left unedited, with a read-note that a baselined `prefixed-read` entry now exits 2 (CHANGE signed 2026-11-09).
- `fix-sandbox-seed-keys.feature:7` ("still resolves through the activated alias until feature 304 rewrites the reader") becomes false; `fix-trading-config-key-mismatch.feature:25` says "the trading config watcher holds a snapshot in which platform.trading_state resolves..." (192 @AC-2): note that it is now the platform watcher.
- Stale-doc targets re-verified after the 303 merge: `docs/patterns/config-governance.md:558-562` states analysis's second `WatchConfig` subscription is the platform's "first cross-namespace stream subscription" and "every other service subscribes only to its own namespace", which trading's separate `platform` watcher (Steps 20-21) makes false: edit that note. The design's `docs/context-constitution-findings.md:20` row is an unrelated propagation row (no "trading_state"/"ACTIVE"/"merges" text anywhere in that file), so it is DROPPED from this step (design deviation, record in the Deviation Log). `docs/roadmap/ledger/insights.md:4244` is append-only: untouched. `merge-order.md` already carries the 305 `config_allow296.py` note (grep count 1, also in 305's `context.md`): no edit.

**TDD**: N/A (docs; checked by `--doc-check` and the grep below)

**Covers**: —

**Instructions**: remove the caveat clause from each rule statement (leave "the stored key is namespace-relative; the FQN is display-only; every read key is seeded by a config migration"), keep each document's other text; rewrite `config-governance.md:68,77,79` so no sentence says the alias serves prefixed reads "until feature 304"; the C-16 read-notes follow the wording in `design.md` "Business Rules Touched"; `fix-config-keys-drift.feature:11,13`: `ns=ledger key=export.enabled` and keep the "row stays when no evidence" clause; do not edit any `.up.sql`. Scenario IDs (`@AC-*`) are never renumbered.

**Verification**:
`node scripts/check-config-wiring.mjs --doc-check` exits 0; `grep -rIn "via the alias until\|Target form is namespace-relative, cutover in feature 296" --include=*.md --include=*.feature --include=*.mjs . | grep -v "docs/roadmap/features/\|docs/roadmap/ledger/\|node_modules\|\.venv"` prints only the `DOC_BANNED` regex in `scripts/check-config-wiring.mjs` and its test; `git diff --name-only $(git merge-base HEAD origin/main-dev) -- services/xstockstrat-config/migrations` prints nothing (F-01; unlike `git status`, it still holds after per-step commits).

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._

- **Planned scope additions (doc truth, not creep):** Step 8 corrects portfolio's "Unseeded (227 D2 waiver)" notes for keys that are now stored (FR-5 names only analysis and marketdata); Step 17 respells five strat-lab files beyond `SKILL.md:81` (design Open Risk 7); Step 25's doc inventory is 31 lines, matching design.md (a case-insensitive grep shows 32).
- **Planned design deviation (recorded at /sdd-spec review):** the `trading/internal/config/config.go:57-58` comment fix (Step 20) and the trading `CLAUDE.md` "merges them" paragraph (Step 21) moved out of design.md's finish commit into the trading family steps, because they describe the code those steps change.
- **Planned design deviation (recorded at /sdd-spec review):** `design.md` lists `docs/context-constitution-findings.md:20` as a stale-doc fix. After the 303 merge that line is an unrelated propagation row and the file has no trading `ACTIVE`/`HALTED`/`merges` text, so Step 26 does not edit it; `docs/patterns/config-governance.md:558-562` is the stale-doc target that holds.

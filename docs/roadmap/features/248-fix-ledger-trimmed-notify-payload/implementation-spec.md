# Implementation Spec: fix-ledger-trimmed-notify-payload

**Status**: `pending`
**Created**: 2026-10-21
**Feature**: `docs/roadmap/features/248-fix-ledger-trimmed-notify-payload/feature.md`
**Total Steps**: 11
**Feature Branch**: `feature/fix-ledger-trimmed-notify-payload`

---

## Execution Summary

The fix follows design.md § Chosen Approach. `EventNotifier` resolves each trimmed NOTIFY row once, in global NOTIFY
order, through a serial FIFO on the dedicated LISTEN client. The read is a PK read bounded by `statement_timeout` B
and `query_timeout` 2B. On failure `onGap` makes `streamEvents` call `call.destroy({code: 13|14})`. The query pool is
never touched. Order of work:

1. Step 1: merge-order rows (248 after 252; 248 after 243);
2. Step 2: config seed;
3. Steps 3-4: resolver module and its tests;
4. Steps 5-6: the notifier, `onGap` and wiring change, then tiers (i), (ii) and the (iii) `onGap` cases. Step 5 is
   one compile unit, because the required `resolveRow`/`onGap` signatures break `tsc` across `eventNotifier.ts`,
   `ledgerServiceImpl.ts` and `index.ts` at once;
5. Steps 7-8: the `Number()` sequence normalisation and its (iii) tests;
6. Step 9: the real-TimescaleDB tier (iv) and CI job;
7. Step 10: consumer verification;
8. Step 11: docs teardown.

**Consumer surface (C-14):** none. The product spec marks this internal/platform-only
(`product-spec.md` § Consumer Surface(s)); `/trader` and `/insights` values become correct through unchanged
surfaces. No `xstockstrat-ui` or `xstockstrat-agent` step is needed. This is a recorded decision, not an omission.

**Scenario coverage (C-15):**

| Scenario | Covered by |
|---|---|
| `@AC-1` live trimmed event delivered full, equal to `GetEvent` | Step 6 (tier ii), Step 9 (tier iv) |
| `@AC-2` trimmed event keeps its place in the live sequence | Step 6 (tier i), Step 8 (tier iii) |
| `@AC-3` event_type-filtered subscriber gets full payload | Step 6 (tier i) |
| `@AC-4` resolve never holds the query-pool connection | Step 6 (tier ii) |
| `@AC-5` trimmed event appended during replay flushed full | Step 6 (tier ii), Step 8 (tier iii) |
| `@AC-6` read error → no stub, non-OK end, replay recovers | Step 6 (tiers i, iii), Step 9 (tier iv) |
| `@AC-7` no row → no stub, non-OK end, replay recovers | Step 4, Step 6 (tiers i, iii), Step 9 (tier iv) |
| `@AC-8` stream_key-filtered subscriber gets full payload | Step 6 (tier i) |
| `@AC-9` resolve exceeds bound → only matching streams end non-OK | Step 4, Step 6 (tier i), Step 9 (tier iv) |

## Step Dependencies

- **Execution precondition (hard; design.md § Open Risks, P-06):** feature 252 `fix-identity-ledger-test-suites`
  must be merged into `main-dev` before Step 3 starts, and this branch must be merged up from `main-dev`.
  - 252 is `implementation-ready` on `origin/feature/fix-identity-ledger-test-suites`. Its Step 4 changes
    `services/xstockstrat-ledger/package.json:13-14` to `tsc && node --test dist/__tests__/*.test.js` (copied from
    `services/xstockstrat-config/package.json:12-13`) and deletes the `tsconfig.json:22` test exclude. Its Step 5
    hard-fails the subject imports and deletes the 7 + 31 skip guards.
  - Until then every ledger unit case is a silent pass (fails.md:115-130, :1942-1956), and the RED captures in
    Steps 4, 6 and 8 are impossible.
  - Before starting, confirm: `grep -n '"test":' services/xstockstrat-ledger/package.json` shows `tsc && node --test`,
    and `grep -c 'if (!EventNotifier) return;' services/xstockstrat-ledger/src/__tests__/eventNotifier.test.ts` is `0`.
  - Test-file line numbers cited below are at `1fb029f7`. 252 Step 5 shifts them, so re-grep by symbol.
  - **Re-checked 2026-10-28 (re-spec, merged-up tree `fe047901`): NOT met.** 252 is still `implementation-ready`
    (not in `main-dev`). `package.json:13-14` still runs `node --experimental-strip-types --test
    src/__tests__/*.test.ts`, `tsconfig.json:19-22` still excludes `src/**/*.test.ts` (so no `dist/__tests__/` is
    emitted), and the skip-guard count is `7`. Steps 1-2 do not depend on 252. Step 3 onward stays blocked until
    252 merges and this branch is merged up again.
- **Config migration number (re-spec 2026-10-28):** `031` is claimed by 243 `fix-sandbox-seed-keys`
  (`031_heal_indicators_sandbox_keys_full_dotted`, on `origin/feature/fix-sandbox-seed-keys`). `032` is claimed by
  244 `fix-python-config-stored-zero` (`032_analysis_zero_trap_descriptions`, on
  `origin/feature/fix-python-config-stored-zero`). `034` is reserved by 264 `fix-portfolio-snapshot-surface`
  (`034_retire_portfolio_snapshot_interval`, its impl-spec Step 6-7). Step 2 therefore takes `033`.
  - Evidence: a `git ls-tree` scan of every `origin/*` ref finds config `03[1-9]_*.up.sql` only on the 243 and 244
    branches. 277 `fix-ingest-seeded-config-keys` (planned `033_rekey_…`) is `demoted/canceled`.
  - At execute time, re-run `ls services/xstockstrat-config/migrations/ | tail -4` on the merged-up branch.
  - If 243 or 244 is dropped, keep `033` (the gap stays below; only a lower version landing after a higher one is a
    hazard) unless the DBA asks to close it, and record it in the Deviation Log.
  - Merge order: 248 merges after 243 and after 244, and 264 (`034`) merges after 248. golang-migrate applies only
    versions above the recorded one (`scripts/db-migrate.sh:104`, `migrate … up`), so an environment at `033` would
    silently skip a later-landing `031` or `032`. `migration-rerun` does not catch this. Precedent:
    `merge-order.md:74` (217/223). Step 1 records the rows.
- Step 1 (merge-order rows) runs first so the hard ordering is on record before any code step.
- Step 4 [test] covers Step 3 [service].
- Step 5 [service] requires Step 3. `index.ts` imports the resolver factories.
- Step 6 [test] covers Step 5 [service]. Its RED is captured on the post-Step-4 tree, before Step 5's edits.
- Step 7 [service] requires Step 5, which supplies the `onGap` subscription it edits around.
- Step 8 [test] covers Step 7 [service].
- Step 9 [test, tier iv] covers Steps 3, 5 and 7 end to end against TimescaleDB, and the Step 5 `index.ts` wiring
  through the same exported factories.
- Step 10 is verification only (no code). It runs after Step 7, so the non-OK end exists.
- Step 11 (docs teardown) runs last.
- **Pre-merge gate (integration PR):** owner + config-team approval for `ledger.stream.resolve_timeout_ms` (root
  `CLAUDE.md` § Approval Flow; design.md § Open Risks).
  - If approval is refused, apply the design fallback: a named constant `RESOLVE_TIMEOUT_MS = 2000` in
    `src/services/eventRowResolver.ts`, with an F-07 ruling recorded in `context.md`.
  - Step 2 is then dropped, and the change goes in the Deviation Log.
- **Router carry items (not steps):** file a `docs/reports/` defect for repairing analysis P&L rows built from pre-fix
  stubs (`product-spec.md` § Out of Scope). The char-vs-byte trim mismatch stays a separate defect (design.md
  § Rejected Alternatives).

---

### Step 1 — docs: Record the hard merge-order dependencies on 252, 243 and 244

**Status**: `done`
**Service**: `docs/roadmap/features/`
**Files**:
- `docs/roadmap/features/merge-order.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `docs/roadmap/features/merge-order.md:21-22` header `| Feature | Must wait for | Reason | Resolved |`. The table's
  last row is `:92` (`fix-etf-flag-fill` (230)) at `fe047901`; rows keep landing, so locate it by content.
- 252's own Step 6 adds a *rebase-only* note for 248 ↔ 252 on the test files (252 `implementation-spec.md` Step 6
  item 6). 248's dependency is harder than that: tier (iv) runs on 252's `tsc && node --test` runner (design.md
  § Chosen Approach 6), and P-06 RED needs non-vacuous suites.
- `grep -n "fix-ledger-trimmed-notify-payload" docs/roadmap/features/merge-order.md` → one hit at `fe047901`, the
  `:89` row where 266 waits for 248 (248 is in the "Must wait for" column). No 248 ↔ 252, 248 ↔ 243 or 248 ↔ 244 row
  exists, and no 243 or 244 config-migration row exists either.
- Config migration claims (§ Step Dependencies): 243 → `031_heal_indicators_sandbox_keys_full_dotted`, 244 →
  `032_analysis_zero_trap_descriptions`, 248 → `033_ledger_stream_resolve_timeout`. Migration-order precedent row:
  `merge-order.md:74` (217/223).

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. Append three rows after the last row of `## Blocking Dependencies`, found by content rather than line:
   - `| \`fix-ledger-trimmed-notify-payload\` (248) | \`fix-identity-ledger-test-suites\` (252) | 248's tier (i)-(iii) RED-before-green and tier (iv) \`test:db\` run on 252's compile-then-test runner and de-guarded ledger suites (248 design.md § Chosen Approach 6; P-06). Hard: 248 Step 3 onward does not start until 252 is in \`main-dev\` | No |`
   - `| \`fix-ledger-trimmed-notify-payload\` (248) | \`fix-sandbox-seed-keys\` (243) | **Config migration number ordering.** 243 adds config \`031_heal_indicators_sandbox_keys_full_dotted\`; 248 adds \`033_ledger_stream_resolve_timeout\`. golang-migrate applies by version, so 033 landing first leaves 031 permanently skipped on environments already at 033. Merge 243 first (merge order only) | No |`
   - `| \`fix-ledger-trimmed-notify-payload\` (248) | \`fix-python-config-stored-zero\` (244) | **Config migration number ordering.** 244 adds config \`032_analysis_zero_trap_descriptions\`; 248 adds \`033_ledger_stream_resolve_timeout\`. Same golang-migrate skip hazard as the 243 row. Merge 244 first (merge order only) | No |`
2. Do not edit 252's rebase-only note or the existing 266 → 248 row.

**Verification**:
```bash
grep -n '^| `fix-ledger-trimmed-notify-payload` (248) | `fix-identity-ledger-test-suites` (252)' docs/roadmap/features/merge-order.md   # 1 hit
grep -n '^| `fix-ledger-trimmed-notify-payload` (248) | `fix-sandbox-seed-keys` (243)' docs/roadmap/features/merge-order.md   # 1 hit
grep -n '^| `fix-ledger-trimmed-notify-payload` (248) | `fix-python-config-stored-zero` (244)' docs/roadmap/features/merge-order.md   # 1 hit
git status --short   # only merge-order.md (+ feature docs)
```

---

### Step 2 — migration: Seed `ledger.stream.resolve_timeout_ms` (config `033`)

**Status**: `done`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/migrations/033_ledger_stream_resolve_timeout.up.sql` — create
- `services/xstockstrat-config/migrations/033_ledger_stream_resolve_timeout.down.sql` — create

**Reviewers**: DBA — Migration NNN numbering (no gaps, no conflicts), up+down pair present, run-order compliance with `scripts/db-migrate.sh`; `xstockstrat-config` owner — Config key naming (`<service>.<category>.<key>`), environment / global-per-user scoping, WatchConfig stream stability

**Codebase Evidence**:
- Last config migration on this branch is `030_marketdata_edgar_snapshot_keys` (re-checked 2026-10-28 at
  `fe047901`). `031` is claimed by 243 and `032` by 244, both present on their remote branches; `034` is reserved by
  264 (see § Step Dependencies). `033` is the next free number.
- Template: `services/xstockstrat-config/migrations/022_ledger_export_keys.up.sql`.
  - `:5-9`: the `key` column is the full dotted read string, and `namespace` is `ledger`.
  - `:11-13`: `value_type` must be the native reader type.
  - `:15-30`: the insert covers staging + production with `user_id NULL` and
    `ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING`.
- Down template: `022_ledger_export_keys.down.sql:4-6` (`DELETE … WHERE namespace = 'ledger' AND key IN (…)`).
- Reader: `ConfigWatcher.getInt` returns `snapshot.values[key]?.intVal ?? def`
  (`services/xstockstrat-ledger/src/services/configWatcher.ts:112-115`). The watcher subscribes to namespace
  `ledger` (`src/index.ts:22`).
- Traps:
  - fails.md:2334-2336: the seeded `key` must equal the reader's full-dotted string.
  - fails.md:344-346 and `022:11-13`: a `'string'` row makes `getInt` return the default.
- `migration-rerun` (`.github/workflows/ci.yml:643-679`) now replays only the 224/225 up-files
  (`scripts/migration-rerun.sh:89-102`), but the up-file stays idempotent anyway: `ON CONFLICT DO NOTHING`.
- Product-spec agreement: Fix Scope names this key and migration `032` (`product-spec.md:61-63`, amended by
  /sdd-spec); the number moves to `033` (244 took `032`), recorded in the Deviation Log. Its "No DB migration"
  bullet (`:60`) is about the ledger trigger (`001`/`004`), not this config seed.

**TDD**: `N/A (migration)`

**Covers**: —

**Instructions**:
1. Create the `.up.sql` by copying `022_ledger_export_keys.up.sql:1-30`. Change the header to name feature 248 and
   the key. Insert two rows, `('ledger', 'ledger.stream.resolve_timeout_ms', 'int', '2000', <description>, '2000',
   'xstockstrat-ledger', <env>, NULL)`, one for `staging` and one for `production`, with the same `ON CONFLICT`
   clause.
   - Description: "Ledger StreamEvents: bound (ms) on the LISTEN-connection read that resolves a NOTIFY row trimmed
     over 7000 chars. Applied as statement_timeout; client backstop 2x. ≤0 or non-finite reads as 2000."
2. Create the `.down.sql`: `DELETE FROM config.config_values WHERE namespace = 'ledger' AND key =
   'ledger.stream.resolve_timeout_ms';`.
3. Never bring up a database for this step.

**Verification**:
```bash
ls services/xstockstrat-config/migrations/033_ledger_stream_resolve_timeout.up.sql services/xstockstrat-config/migrations/033_ledger_stream_resolve_timeout.down.sql
ls services/xstockstrat-config/migrations/ | grep -c '^033_'                       # 2
f=services/xstockstrat-config/migrations/033_ledger_stream_resolve_timeout.up.sql
grep -c "'ledger', 'ledger.stream.resolve_timeout_ms', 'int', '2000'" $f           # 2
grep -c "'staging'\|'production'" $f                                               # 2
grep -n "ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING" $f
grep -n "ledger.stream.resolve_timeout_ms" services/xstockstrat-config/migrations/033_ledger_stream_resolve_timeout.down.sql
# by inspection: the down removes exactly the rows the up inserts
```

---

### Step 3 — service: Resolver module (`resolveEventRow`, bound, listener factories)

**Status**: `done`
**Service**: `xstockstrat-ledger`
**Files**:
- `services/xstockstrat-ledger/src/services/eventRowResolver.ts` — create

**Reviewers**: `xstockstrat-ledger` owner — Append-only invariant (no deletes or updates), event ordering, hypertable partition safety

**Codebase Evidence**:
- **252 precondition met (re-checked 2026-10-29 on the merged-up tree `b6e518a7`, which contains `origin/main-dev`
  `8082157a`):** 252 is `code-completed`; `package.json:13-14` runs `tsc && node --test dist/__tests__/*.test.js` and
  `tsc && c8 … --lines 40 node --test dist/__tests__/*.test.js`; `tsconfig.json:19-22` excludes only `node_modules`
  and `dist`; the `if (!EventNotifier) return;` count is `0`. This supersedes the 2026-10-28 "NOT met" note in § Step
  Dependencies: Steps 3-9 are unblocked. The pg-internal line numbers below were not re-checked (`node_modules/pg`
  needs `pnpm install`); re-check them after install.
- **Not found:** no resolver or re-fetch helper exists (recon.md § Risks / Not-found). The module is created from
  scratch, beside `src/services/eventNotifier.ts`. Design 2 places it outside `ledgerServiceImpl.ts` (C-18 layering).
- PK is `(event_id, recorded_at)` (`migrations/001_ledger_events_hypertable.up.sql:22`). `event_id` is `UUID`
  (`:12`). The hypertable is partitioned on `recorded_at` (`:27-32`).
- The stub carries `recorded_at` as a raw `json_build_object` value (`001_…up.sql:73-79`). It is passed as text to
  `$2::timestamptz` and never through `new Date` (design 2.a).
- Existing full-row SQL is `getEvent`'s `'SELECT * FROM ledger.events WHERE event_id = $1'`
  (`src/grpc/ledgerServiceImpl.ts:264-267`). It is not reused, because `event_id` alone probes every chunk (design
  § Rejected Alternatives). Mapping stays in the single `rowToEvent` (`ledgerServiceImpl.ts:364-377`), applied later
  by `writeRow` (`:195-198`). The resolver returns the raw row.
- pg@8.20.0 timeouts:
  - `ClientConfig.statement_timeout` / `query_timeout` are typed (`@types/pg@8.20.0 index.d.ts:21,23`).
  - The startup parameter is sent at `pg/lib/client.js:525-526`.
  - A per-query `config.query_timeout` is read at `client.js:613,623`, and its expiry raises
    `new Error('Query read timeout')` (`:641`).
  - `QueryConfig` (`index.d.ts:60-65`) has **no** `query_timeout` member, so the object literal needs a widened type
    (`QueryConfig & { query_timeout?: number }`) to pass `tsc`'s excess-property check.
- Config read pattern: `this.config.getInt('ledger.export.max_window_days', 365)` (`ledgerServiceImpl.ts:294`).
  `getInt` does no validation (`configWatcher.ts:112-115`). `ConfigValue.int_val` is `int64`
  (`packages/proto/config/v1/config.proto:63`), and ts-proto emits it as a JS number (no `forceLong` in
  `packages/proto/buf.gen.yaml:26-31`).
- Client construction today: `new Client({ connectionString: dbUrl, ssl: sslOption })` (`src/index.ts:51`).
- B live-ness (design 2.f, Open Risk): this spec resolves it as **SET-on-change**, the mediator's preference. A
  session-level `SET statement_timeout` is autocommit and single-statement, and opens no transaction (design 2.e).

**TDD**: `red-green required`

**Covers**: — (behaviour asserted in Step 4)

**Instructions**:

Create `src/services/eventRowResolver.ts` with these exports. Import `Client`, `QueryConfig` and `ClientConfig` from
`pg`, and `ConfigWatcher` as a type-only import from `./configWatcher`.

1. `export const RESOLVE_TIMEOUT_KEY = 'ledger.stream.resolve_timeout_ms';`
2. `export function streamResolveTimeoutMs(config: Pick<ConfigWatcher, 'getInt'>): number`:
   - read `config.getInt(RESOLVE_TIMEOUT_KEY, 2000)`;
   - return `Math.floor(v)` when `Number.isFinite(v) && v > 0`, else `2000`.
   - The `2000` call-site default follows the `getInt('…', 365)` pattern (`ledgerServiceImpl.ts:294`).
3. `export async function resolveEventRow(q: Pick<Client, 'query'>, stub: any, timeoutMs: number): Promise<any | null>`:
   - a. **SET-on-change.** A module-level `WeakMap<object, number>` holds the last B applied per client. If it lacks
     `q` or holds a different value, first run `SET statement_timeout = ${timeoutMs}`. `timeoutMs` is already a
     floored positive integer from item 2. Run it with the same `query_timeout: 2 * timeoutMs`, then record the value.
   - b. Run
     `{ text: 'SELECT * FROM ledger.events WHERE event_id = $1 AND recorded_at = $2::timestamptz', values: [stub.event_id, stub.recorded_at], query_timeout: 2 * timeoutMs }`,
     typed as `QueryConfig & { query_timeout?: number }`.
   - c. Return `result.rows[0] ?? null`. Errors propagate unchanged, so the caller can tell
     `'Query read timeout'` apart from Postgres `57014`.
4. `export function makeListenerClient(connectionString: string, ssl: ClientConfig['ssl'], config: Pick<ConfigWatcher, 'getInt'>): () => Client`:
   - returns `() => new Client({ connectionString, ssl, statement_timeout: streamResolveTimeoutMs(config) })`;
   - the startup bound covers the session from connect (design 2.c).
5. `export function makeResolveRow(config: Pick<ConfigWatcher, 'getInt'>): (client: Pick<Client, 'query'>, stub: any) => Promise<any | null>`:
   - returns `(c, s) => resolveEventRow(c, s, streamResolveTimeoutMs(config))`.
6. Add a ≤2-line header comment stating the LEDGER-8 constraint: "runs on the LISTEN client: single-statement PK
   read / session SET only; never a transaction or bulk read".
7. No other file changes in this step.

**Verification**:
```bash
cd services/xstockstrat-ledger
pnpm build                                                     # exit 0
pnpm run lint                                                  # exit 0
grep -n "export function resolveEventRow\|export function streamResolveTimeoutMs\|export function makeListenerClient\|export function makeResolveRow" src/services/eventRowResolver.ts   # 4 hits
grep -n "recorded_at = \$2::timestamptz" src/services/eventRowResolver.ts
grep -n "BEGIN\|SET LOCAL" src/services/eventRowResolver.ts || echo "OK: no txn on the LISTEN session"
grep -n "this.pool\|Pool" src/services/eventRowResolver.ts || echo "OK: no pool"
```

---

### Step 4 — test: Resolver unit tests

**Status**: `pending`
**Service**: `xstockstrat-ledger`
**Files**:
- `services/xstockstrat-ledger/src/__tests__/eventRowResolver.test.ts` — create

**Reviewers**: `xstockstrat-ledger` owner — Append-only invariant (no deletes or updates), event ordering, hypertable partition safety

**Codebase Evidence**:
- Runner (252, in place at `b6e518a7`, 2026-10-29): `tsc && node --test dist/__tests__/*.test.js`
  (`package.json:13-14`), a non-recursive glob, so a new top-level `src/__tests__/*.test.ts` is picked up.
  `tsconfig.json` no longer excludes test files, so `dist/__tests__/` is emitted and the `dist/` commands below run.
- Hard-fail import shape (252 Step 5 item 3): `before(async () => { const mod = await import('../services/eventRowResolver.js'); … });`
  with no try/catch.
- Precedent for a recording fake `query`: `makeIdempotentPool`'s SQL-routed `query`
  (`src/__tests__/ledgerServiceImpl.test.ts:46`; locate by symbol).
- C-13: at this step the stub literal (`event_id`, `recorded_at` string) has one consumer (this file) and stays
  inline. No `src/__tests__/fixtures/` home exists yet. Step 6 adds the second consumer, creates the home and
  migrates this file's stub to it.

**TDD**: `red-green required`

**Covers**: `AC-7` (no row → `null`), `AC-9` (bound: `query_timeout = 2B`, SET-on-change, clamp)

**Instructions**:

RED first: author the file before Step 3's module exists. The import throws and `tsc` fails (TS2307); record it. Then
GREEN after Step 3. Cases, each with a recording fake `{ query(cfg) }`:

1. `resolveEventRow` issues exactly one SELECT whose `text` matches `/WHERE event_id = \$1 AND recorded_at = \$2::timestamptz/`.
   - `values` equals `[stub.event_id, stub.recorded_at]`, and the second value is `typeof 'string'` and identical to
     the stub text, e.g. `'2026-10-21T12:00:00.123456+00:00'`.
   - `query_timeout === 2 * B`.
2. Returns `rows[0]` when present, and `null` for `{ rows: [] }` (AC-7).
3. A rejection propagates with the same `message`, both for `'Query read timeout'` and for an error with
   `code: '57014'`.
4. SET-on-change:
   - first call on a client → `SET statement_timeout = 2000` precedes the SELECT;
   - second call with the same B → no SET;
   - call with B = 200 → `SET statement_timeout = 200` again;
   - a new fake client → SET again.
5. `streamResolveTimeoutMs`:
   - `{getInt: () => 200}` → 200;
   - `0`, `-5`, `NaN` and `Infinity` → 2000;
   - `250.9` → 250;
   - absent key (returns the passed default) → 2000.
6. `makeListenerClient('postgres://x', false, {getInt: () => 300})()` returns a `pg.Client`. Construction does not
   connect. Its `connectionParameters.statement_timeout` is `300`, which pg stores at
   `lib/connection-parameters.js:109`.

**Verification**:
```bash
cd services/xstockstrat-ledger
pnpm run lint                                                  # exit 0
OUT="${TMPDIR:-/tmp}/248-step4.txt"
pnpm run test:coverage 2>&1 | tee "$OUT"; echo "exit=${PIPESTATUS[0]}"   # 0
grep -E '^(ℹ|#) (fail|cancelled|skipped|todo) ' "$OUT"                     # all 0
grep -E 'eventRowResolver' "$OUT"                                           # row present, % Lines > 0
grep -E 'All files' "$OUT"                                                  # % Lines >= 40
node --test --test-reporter=tap dist/__tests__/eventRowResolver.test.js | grep -E '^# (pass|fail) '   # pass > 0, fail 0
grep -n "catch\|if (!" src/__tests__/eventRowResolver.test.ts || echo "OK: unguarded"
ls src/__tests__/fixtures 2>/dev/null || echo "C-13: single-consumer inline stub; home created in Step 6"
```

---

### Step 5 — service: `EventNotifier` resolve-once FIFO, `onGap`, wiring

**Status**: `pending`
**Service**: `xstockstrat-ledger`
**Files**:
- `services/xstockstrat-ledger/src/services/eventNotifier.ts` — modify
- `services/xstockstrat-ledger/src/grpc/ledgerServiceImpl.ts` — modify
- `services/xstockstrat-ledger/src/index.ts` — modify

**Reviewers**: `xstockstrat-ledger` owner — Append-only invariant (no deletes or updates), event ordering, hypertable partition safety

**Codebase Evidence**:
- `eventNotifier.ts`:
  - `NotifySubscription` `:6-18` (`onEvent` sync-typed `:12`, `onReconnect?` `:17`);
  - constructor `:32-36` (positional `channel = 'ledger_stream_all'`, `reconnectDelayMs = 2000`);
  - `stop()` `:53-69`;
  - `connect()` `:71-108`, with `'error'` `:74-77`, `'end'` `:78-80`, `'notification'` `:81`, `LISTEN` `:84`,
    `this.client = client` `:85` and the `onReconnect` loop `:89-98`;
  - `scheduleReconnect()` `:110-117` (sets `this.client = null` `:111`, guarded by `reconnectTimer`);
  - `dispatch` `:119-137`, with parse `:124`, filters `:129-130` and the swallowing try/catch `:131-135`.
- Logger: `const log = getLogger('ledger:notifier')` (`:4`); `log.warn(…, { … })` shape at `:75`, `:100`.
- `ledgerServiceImpl.ts#streamEvents`:
  - the subscribe literal `:202-220`, with `onReconnect` → `call.end()` at `:212-219`;
  - `cleanup` and the `cleaned` flag at `:223-228`.
  - Destroy precedent: `call.destroy({ code: 9, message })` (`:285`), `{ code: 13, … }` (`:325`).
  - It is never `call.end()`, because portfolio treats `io.EOF` as a clean close
    (`services/xstockstrat-portfolio/internal/service/portfolio_service.go:220-221`).
- `index.ts`:
  - `ConfigWatcher` at `:22`;
  - `dbUrl` / `sslOption` at `:27-39`;
  - pool at `:40-46`, untouched (F-06: 1 pool + 1 listener);
  - notifier at `:51`.
- Design 1.a-g are binding (fast-path predicate, enqueue snapshot, stale-drain guard, teardown, gen bump). Rejected:
  the `queue.length === 0`-only predicate, per-subscriber resolve, pool injection and an optional positional
  resolver (design § Rejected Alternatives).

**TDD**: `red-green required`

**Covers**: — (behaviour asserted in Step 6)

**Instructions**:

Capture Step 6's RED on the post-Step-4 tree before any edit here.

1. **`NotifySubscription`.** Add a required `onGap: (gap: { notFound: boolean; message: string }) => void`.
2. **Constructor** (design 1.a). Replace the positional params with
   `(private readonly makeClient: () => Client, opts: { resolveRow: (client: Client, stub: any) => Promise<any | null>; channel?: string; reconnectDelayMs?: number })`.
   - Store `resolveRow`, `channel` (default `'ledger_stream_all'`) and `reconnectDelayMs` (default `2000`) in readonly
     fields.
   - Keep every existing use of `this.channel` (`:84`, `:88`) and `this.reconnectDelayMs` (`:116`).
3. **New private state:** `queue: Array<{ row: any; subs: NotifySubscription[] }> = []`, `draining = false` and
   `gen = 0`.
4. **`dispatch`** (design 1.c).
   - After the parse at `:124`, compute `matching(row)`, the `:129-130` filter extracted into a private method.
   - Fast path iff `!this.draining && this.queue.length === 0 && row.payload !== undefined`. It runs
     `fanOut(row, subs)`, the `:128-136` loop extracted into a method with the try/catch kept.
   - Otherwise push `{ row, subs: matching(row) }` and `void this.drain()` unless `draining` is set.
   - `row.payload === undefined` is the only stub test in `src/` (recon.md § Patterns to REUSE).
5. **`drain()`** (design 1.d-e). It is serial, never rejects, sets `draining = true`, and resets it in `finally`.
   1. Loop while `this.queue.length`. Capture `const q = this.queue, g = this.gen`, and let `head = q[0]`.
   2. A full head is fanned out to `head.subs` filtered by `this.subscribers.has`.
   3. A trimmed head with empty `subs` is skipped with no read.
   4. Otherwise `await this.resolveRow(client, head.row)`, where `client = this.client`. A null client is treated as
      an error.
   5. After the await, if `g !== this.gen`, discard the result, shift nothing, `break`, and let `finally` restart
      `drain()` when `this.queue.length`.
   6. Otherwise recompute `live = head.subs.filter(s => this.subscribers.has(s))`.
      - On a row: `fanOut(resolved, live)`.
      - On `null` or an error: for each live sub, `this.subscribers.delete(sub)`, then `sub.onGap({ notFound: result === null, message })`,
        with each `onGap` call in its own try/catch.
      - Log `log.warn('trimmed row resolve failed', { eventId, sequence, reason: 'not_found'|'error'|'timeout', elapsedMs, queueDepth: q.length })`.
        The reason is `timeout` for `'Query read timeout'` or pg code `57014`.
   7. Then `q.shift()`.
6. **Wedged-listener teardown** (design 1.f). When the rejection message is `'Query read timeout'` (the 2B backstop),
   call `void c.end().catch(() => {})` on the client that ran the query.
   - The existing `'end'` → `scheduleReconnect` → `connect()` → `onReconnect` path (`:78-80`, `:110-117`, `:89-98`)
     resyncs every stream.
   - Comment (≤2 lines): a spurious backstop (GC or event-loop stall over 2B) causes an avoidable fleet-wide resync
     (design § Open Risks).
7. **Gen bump** (design 1.g). In `connect()`, immediately before the `if (reconnected)` loop (`:89`), and in `stop()`
   before `subscribers.clear()` (`:59`): `this.gen++; this.queue = [];`.
8. **`ledgerServiceImpl.ts#streamEvents`.** Add to the subscribe literal (`:202-220`):
   `onGap: ({ notFound, message }) => { cleanup(); try { call.destroy({ code: notFound ? 13 : 14, message }); } catch { /* already closing */ } }`.
   - `onGap` can fire while the replay `await this.pool.query(…)` (`:235-242`) is pending. Today the replay loop
     (`:243`) then writes to the destroyed call; only the post-loop `if (cleaned) return;` (`:251`) exists. Insert
     `if (cleaned) return;` immediately after the `await` resolves and before `for (const row of result.rows)`.
     This adds no `await` (LEDGER-2 holds) and leaves the `:251` guard in place.
   - Change nothing else in this file in this step. `Number()` is Step 7.
9. **`index.ts:51`.** Replace with:
   `new EventNotifier(makeListenerClient(dbUrl, sslOption, configWatcher), { resolveRow: makeResolveRow(configWatcher) })`.
   - Import both factories from `./services/eventRowResolver`, and update the `:50` comment if needed (≤2 lines).
   - The pool at `:40-46` is unchanged.

**Verification**:
```bash
cd services/xstockstrat-ledger
pnpm build && pnpm run lint                                    # both exit 0
grep -n "!this.draining && this.queue.length === 0 && row.payload !== undefined" src/services/eventNotifier.ts   # 1 hit
grep -n "onGap" src/services/eventNotifier.ts src/grpc/ledgerServiceImpl.ts
grep -n "code: notFound ? 13 : 14" src/grpc/ledgerServiceImpl.ts   # 1 hit
awk '/async streamEvents\(/{f=1} /async getEvent\(/{f=0} f' src/grpc/ledgerServiceImpl.ts | grep -c "if (cleaned) return;"   # 3 (cleanup :225, new post-await, :251; 2 before this step)
grep -n "makeListenerClient(dbUrl, sslOption, configWatcher)" src/index.ts
grep -n "max: parseInt(process.env.DB_POOL_MAX ?? '1', 10)" src/index.ts   # unchanged (F-06)
grep -n "pool" src/services/eventNotifier.ts || echo "OK: notifier holds no pool"
```

---

### Step 6 — test: Notifier tier (i), wired tier (ii), `streamEvents` `onGap` tier (iii)

**Status**: `pending`
**Service**: `xstockstrat-ledger`
**Files**:
- `services/xstockstrat-ledger/src/__tests__/eventNotifier.test.ts` — modify
- `services/xstockstrat-ledger/src/__tests__/streamResolveWired.test.ts` — create
- `services/xstockstrat-ledger/src/__tests__/ledgerServiceImpl.test.ts` — modify
- `services/xstockstrat-ledger/src/__tests__/eventRowResolver.test.ts` — modify (stub → fixture import only)
- `services/xstockstrat-ledger/src/__tests__/fixtures/ledgerEvents.ts` — create
- `services/xstockstrat-ledger/src/__tests__/fixtures/streamCall.ts` — create
- `services/xstockstrat-ledger/src/__tests__/fixtures/INVENTORY.md` — create

**Reviewers**: `xstockstrat-ledger` owner — Append-only invariant (no deletes or updates), event ordering, hypertable partition safety

**Codebase Evidence**:
- `eventNotifier.test.ts` (re-grepped 2026-10-29 at `b6e518a7`, post-252):
  - `FakeClient` `:22-50` (`query` records `LISTEN` only `:37-40`, `end()` sets `ended` `:41-43`, `emit`/`notify`
    `:44-49`);
  - `row()` `:52-61`, which emits **no** `payload` key. Under Step 5's `row.payload !== undefined` stub test every
    existing case would take the resolve path, so `row()` needs a default `payload`;
  - `tick` `:63`;
  - 7 constructions: `new EventNotifier(() => client)` at `:68`, `:78`, `:90`, `:105`, `:118`, `:130`, and the
    positional `'ledger_stream_all', 1` form at `:142-151`.
- `ledgerServiceImpl.test.ts` (re-grepped 2026-10-29 at `b6e518a7`):
  - `makePool` `:26`;
  - `makeRow` `:78-93` (snake_case DB row);
  - `makeStreamCall` `:514-534`, with `write()` push-only, `destroy(err)` recording and `on()` a no-op (locate by
    symbol).
  - Its only consumer today is `exportEvents`.
- No `streamEvents` unit test exists (recon.md § Not found).
- `LedgerServiceImpl(pool, config, notifier?)` (`src/grpc/ledgerServiceImpl.ts:20-25`).
- Replay is `this.pool.query(SELECT … ORDER BY sequence ASC)` (`:235-242`). The buffer push while `!live` is at
  `:205-208`, and the flush at `:255-259`.
- C-13 (`docs/sdd/constitution.md` C-13; `docs/patterns/test-data-inventory.md:69-83`): the snake_case event row
  (`makeRow`, `ledgerServiceImpl.test.ts:78-93`), the 8000-char payload and the trimmed stub get a second
  consumer in this step (`eventRowResolver.test.ts`, `streamResolveWired.test.ts`, `ledgerServiceImpl.test.ts`,
  later Steps 8-9). The second consumer forces centralization into the Node home `src/__tests__/fixtures/` plus a
  catalog, in this step. The recording stream call (`makeStreamCall` `:514-534`) would otherwise be declared in
  three files (Steps 6B, 6C, 9); it moves to the same home. jscpd ignores `**/__tests__/**` (`.jscpd.json`), so
  this is enforced by review, not the hook.
- Trigger stub keys (`migrations/001_ledger_events_hypertable.up.sql:73-79`): `event_id`, `event_type`,
  `stream_key`, `sequence`, `recorded_at`.
- `tsconfig.json:19-22` excludes only `node_modules` and `dist` (252), so `fixtures/*.ts` and every test file compile
  into `dist/` in the production build. Fixture modules import nothing but `node:*` and type-only `src` imports.
- RED type safety: the test files bind subjects as `let EventNotifier: any` / `let LedgerServiceImpl: any` from a
  dynamic `import()` (`eventNotifier.test.ts:5`/`:10`, `ledgerServiceImpl.test.ts:5`/`:11`; 252 kept the `any`
  bindings). `tsc` therefore accepts the new `{ resolveRow }` constructor shape on the post-Step-4 tree.
- fails.md:2839-2842: any design-named assertion not written goes to the Deviation Log, not into `**Covers**`.
- **252 gate (re-checked 2026-10-29, `b6e518a7`): met.** The `tsc && node --test` runner is in place
  (`package.json:13-14`), the `tsconfig.json` test exclude is gone and the `if (!EventNotifier) return;` count is
  `0`. The anchors above are post-252; still locate by symbol.

**TDD**: `red-green required`

**Covers**: `AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8, AC-9` (unit tiers; AC-9's real-DB bound is Step 9)

**Instructions**:

Write the cases unguarded: no `if (!X) return`, no try/catch around imports (252 Step 5). Capture RED on the
post-Step-4 tree before Step 5. The pre-Step-5 `EventNotifier` treats the 2nd argument as `channel`, fans the stub out
unresolved and has no `onGap`. The resolved-payload, `onGap` and destroy assertions are the named RED. Then run GREEN
after Step 5.

RED must be a runtime assertion failure, not a compile failure (tdd-gate "right reason"). The 252 runner is
`tsc && node --test`, so every subject in the new or edited files is bound as `any` from a dynamic `import()`, as the
existing files do (see Codebase Evidence). A `tsc` error on the post-Step-4 tree is a wrong-reason RED: fix the
binding, never the assertion.

**0. Fixture home (C-13; new).**

1. `src/__tests__/fixtures/ledgerEvents.ts`:
   - `makeEventRow(overrides = {})`: the body of `makeRow` (`ledgerServiceImpl.test.ts:78-93`), moved verbatim;
   - `LARGE_PAYLOAD`: a JSON object whose serialized length is 8000 chars;
   - `TRIMMED_RECORDED_AT = '2026-10-21T12:00:00.123456+00:00'`;
   - `toTrimmedStub(row)`: picks exactly the trigger stub keys (`001_…up.sql:73-79`) and sets `recorded_at` to
     `TRIMMED_RECORDED_AT` unless overridden. No `payload` key.
2. `src/__tests__/fixtures/streamCall.ts`: `makeRecordingCall(req, opts?: { userId?: string; writeReturns?: boolean })`,
   the `makeStreamCall` double (`ledgerServiceImpl.test.ts:514-534`) moved here and extended:
   - `on(event, cb)` records handlers;
   - `write()` records and returns `opts.writeReturns ?? true`;
   - `end()` / `destroy(err)` record as today.
3. `src/__tests__/fixtures/INVENTORY.md`: one catalog row per export (symbol → module → shape source → consumers).
   Shape sources: `migrations/001_ledger_events_hypertable.up.sql` (row, stub) and `ledgerServiceImpl.ts#streamEvents`
   (call).
4. In `ledgerServiceImpl.test.ts`, replace the local `makeRow` and `makeStreamCall` with imports from `./fixtures/…`
   (keep the local names by aliasing, so the existing `exportEvents` and `rowToEvent` cases change no line other
   than the import). In `eventRowResolver.test.ts`, replace the inline stub with `toTrimmedStub(makeEventRow())`;
   no assertion change.

**A. `eventNotifier.test.ts` (tier i).**

1. Migrate all 7 constructions to `new EventNotifier(() => client, { resolveRow })`. The `:142-151` form becomes
   `{ resolveRow, reconnectDelayMs: 1 }` (design 1.a).
   - Give `row()` (`:52-61`) a default `payload: {}` before `...overrides`, so existing cases stay on the fast path.
     A stub is `row({ payload: undefined, … })`: `JSON.stringify` drops the key. No existing assertion changes.
2. Add a controllable fake `resolveRow` that records calls and returns a deferred: resolve with a row, resolve
   `null`, reject `Error('boom')`, reject `Error('Query read timeout')`, or hang. Stub notifications are
   `row({ payload: undefined, recorded_at: TRIMMED_RECORDED_AT })` (fixture import), with no `payload` key; resolved
   rows come from `makeEventRow({ payload: LARGE_PAYLOAD, … })`.
3. New cases:
   1. **AC-2**: full(1), stub(2), full(3) back-to-back while the resolve for 2 is held open. Nothing for 2 or 3 is
      delivered until release. Then the subscriber gets 1, then 2 (resolved, with payload) and 3, with no duplicate.
      This asserts stub-then-full order behind an in-flight resolve: the `!draining` predicate.
   2. **AC-3**: an `eventType: 'order.filled'` subscriber receives the resolved payload. A non-matching stub
      triggers **zero** `resolveRow` calls (empty `subs` skip).
   3. **AC-8**: the same with `streamKey: 'order-42'`. The resolved row carries `occurred_at`.
   4. **AC-6 / AC-7 (notifier side)**: a reject or `null` → `onGap({notFound:false|true})` exactly once, and the sub
      is removed from fan-out. A following full row (seq 12) is not delivered to it. Another live sub that does not
      match the stub is not `onGap`'d and still gets 12.
   5. **AC-9 (notifier side)**: a reject with `'Query read timeout'` → `onGap({notFound:false})`, the client's
      `end()` is called (`ended === true`), and after `emit('end')` a replacement client connects and `onReconnect`
      fires once. FakeClient `end()` may emit `'end'` when told to. This is the unit-only backstop/teardown proof
      (design 5): record it in context.md as unit-only.
   6. A subscriber added after enqueue is not `onGap`'d and gets nothing for that event.
   7. A subscriber removed during the await is not written to.
   8. The queue is cleared on reconnect and on `stop()`: a held resolve, then `emit('error')` → reconnect. The stale
      result is discarded, and nothing is written for the cleared rows.
   9. **Stale-drain guard**: a gen bump during an in-flight resolve, followed by a new stub enqueued on the new gen.
      The new head is resolved and delivered, not shifted or dropped.
   10. Every failure path calls `log.warn` and `drain()` never rejects: no `unhandledRejection` during the test
       (`process.on` listener asserted unchanged).

**B. `streamResolveWired.test.ts` (tier ii; new).** Use the real `EventNotifier`, the real `makeResolveRow` and
`LedgerServiceImpl`, with a FakeClient whose `query` routes:

- `LISTEN` → `{rows: []}`;
- `SET statement_timeout` → `{rows: []}`;
- the PK SELECT → the full row.

Use a borrow-counting fake pool (`query` count + `connect` count) for replay and `appendEvent`, plus
`makeRecordingCall` from `./fixtures/streamCall`. Rows come from `makeEventRow` / `LARGE_PAYLOAD` / `toTrimmedStub`.
Subjects are `any`-bound dynamic imports. Sequences are JS numbers here; string sequences are Step 8.

1. **AC-1**: a live unfiltered stream gets the resolved message.
   - `payload` is the 8000-char object.
   - `occurredAt` is a valid Date equal to the appended one.
   - `sourceService 'xstockstrat-trading'`, `correlationId 'corr-42'`, `metadata {broker:'alpaca'}` and
     `userId 'user-7'`.
   - It deep-equals `rowToEvent(fullRow)`, the `getEvent` mapping (`ledgerServiceImpl.ts:272`).
2. **AC-4**:
   - Set the pool to max-1 semantics: the fake pool's `connect` throws if a second checkout is outstanding.
   - Use a call whose `write()` returns `false` and never emits `'drain'`.
   - Stub(8000) then full(100). Resolve-path pool borrows `=== 0`: the pool `query`/`connect` counts are unchanged
     by the live phase.
   - `impl.appendEvent` for the second event calls back with its `eventId` while the reader is stalled.
   - Both writes are recorded, full, in ascending sequence.
3. **AC-5**:
   - Use 50 replay rows. Hold the fake pool's replay `query` promise open.
   - While held, notify an 8000-char stub (seq 51), and let it resolve.
   - Release replay → 51 writes, ascending, no duplicate. Seq 51 carries a full payload and a valid `occurredAt`.

**C. `ledgerServiceImpl.test.ts` (tier iii, `onGap` part).**

1. Use `makeRecordingCall` (section 0.2). Its `write` / `end` / `destroy` behaviour matches the old
   `makeStreamCall`, so the existing `exportEvents` cases are unaffected.
2. Use a minimal fake notifier `{ subscribe(sub) { captured = sub; return () => { unsubscribed = true; }; } }` with
   `makePool([])`.
3. **AC-7**: `captured.onGap({ notFound: true, message: 'm' })` → `destroyed` deep-equals `{ code: 13, message: 'm' }`,
   `ended === false`, and `unsubscribed === true`.
4. **AC-6**: `notFound: false` → `{ code: 14, … }`, never `end()`.
5. **AC-6 / AC-7 recovery**: a new `streamEvents({ fromSequence: 11 })` whose pool returns full rows 11 and 12 writes
   both, full, in order.
6. **Replay-window `onGap`**: hold the pool's replay `query` open, call `captured.onGap({ notFound: false, message: 'm' })`,
   then release it with rows 8-10. Expect `destroyed` `{ code: 14, message: 'm' }`, `unsubscribed === true` and
   **zero** writes. RED: pre-Step-5 the subscription has no `onGap`. Without Step 5 item 8's guard the replay loop
   would write 3 rows to the destroyed call.

**Verification**:
```bash
cd services/xstockstrat-ledger
pnpm run lint                                                  # exit 0
OUT="${TMPDIR:-/tmp}/248-step6.txt"
pnpm run test:coverage 2>&1 | tee "$OUT"; echo "exit=${PIPESTATUS[0]}"   # 0
grep -E '^(ℹ|#) (fail|cancelled|skipped|todo) ' "$OUT"                     # all 0
grep -E 'eventNotifier|ledgerServiceImpl|eventRowResolver' "$OUT"          # each % Lines > 0
grep -E 'All files' "$OUT"                                                  # % Lines >= 40
for f in eventNotifier streamResolveWired ledgerServiceImpl; do node --test --test-reporter=tap dist/__tests__/$f.test.js | grep -E '^# (pass|fail) '; done   # pass > 0, fail 0
grep -c "new EventNotifier(() => client)" src/__tests__/eventNotifier.test.ts   # 0 (all migrated to opts)
grep -n "if (!\|catch {" src/__tests__/streamResolveWired.test.ts || echo "OK: unguarded"
grep -ln "from './fixtures/" src/__tests__/*.test.ts      # 4: eventNotifier, eventRowResolver, streamResolveWired, ledgerServiceImpl
grep -n "^function makeRow\|^function makeStreamCall" src/__tests__/ledgerServiceImpl.test.ts || echo "C-13: moved to fixtures"
grep -nE "from '(c8|typescript|eslint|ts-node|@types/)" src/__tests__/fixtures/*.ts || echo "OK: fixtures import runtime deps only"
ls src/__tests__/fixtures/INVENTORY.md
```

---

### Step 7 — service: Normalise `sequence` with `Number()` in `streamEvents`

**Status**: `pending`
**Service**: `xstockstrat-ledger`
**Files**:
- `services/xstockstrat-ledger/src/grpc/ledgerServiceImpl.ts` — modify

**Reviewers**: `xstockstrat-ledger` owner — Append-only invariant (no deletes or updates), event ordering, hypertable partition safety

**Codebase Evidence**:
- The four sequence sites (design 3; recon.md § Risks "Sequence type mix"):
  - `:191` `let maxSeq = req.fromSequence ? req.fromSequence - 1 : 0;`;
  - `:196` `if (row.sequence > maxSeq) maxSeq = row.sequence;`;
  - `:210` `if (row.sequence > maxSeq) writeRow(row);`;
  - `:256` `if (row.sequence > maxSeq) writeRow(row);`.
  - Lines re-checked 2026-10-29 at `b6e518a7` (unchanged). Step 5's post-await guard shifts `:251` and `:256` down
    by one; locate by content.
- pg returns `BIGINT` as a string for replay and resolved rows, and `setTypeParser` has no hit in `src/`. NOTIFY JSON
  carries a number. String-vs-string `>` is lexicographic, so a replayed `"99"` followed by a resolved `"100"` drops
  100.
- `rowToEvent` passes `sequence: row.sequence` (`:375`) and is unchanged (single mapper).

**TDD**: `red-green required`

**Covers**: — (behaviour asserted in Step 8)

**Instructions**:
1. `:191` → `let maxSeq = req.fromSequence ? Number(req.fromSequence) - 1 : 0;`.
2. `:196` → `const seq = Number(row.sequence); if (seq > maxSeq) maxSeq = seq;`.
3. `:210` and `:256` → `if (Number(row.sequence) > maxSeq) writeRow(row);`.
4. Do not touch `rowToEvent`, the replay SQL, the flush's synchronous structure (LEDGER-2: no `await` enters
   `streamEvents`) or the `cleaned` guard at `:251`.

**Verification**:
```bash
cd services/xstockstrat-ledger
pnpm build && pnpm run lint                                    # both exit 0
grep -c "Number(row.sequence)" src/grpc/ledgerServiceImpl.ts   # 3
grep -n "Number(req.fromSequence)" src/grpc/ledgerServiceImpl.ts
awk '/async streamEvents\(/{f=1} /async getEvent\(/{f=0} f' src/grpc/ledgerServiceImpl.ts | grep -c "await"   # 1 (only the replay pool.query)
```

---

### Step 8 — test: `streamEvents` sequence normalisation and string-`sequence` encoding (tier iii)

**Status**: `pending`
**Service**: `xstockstrat-ledger`
**Files**:
- `services/xstockstrat-ledger/src/__tests__/ledgerServiceImpl.test.ts` — modify

**Reviewers**: `xstockstrat-ledger` owner — Append-only invariant (no deletes or updates), event ordering, hypertable partition safety

**Codebase Evidence**:
- `makeStreamCall` moved to `fixtures/streamCall.ts#makeRecordingCall` in Step 6. The fake-notifier pattern is from
  Step 6 C.2.
- Encoding regression precedent: `describe('rowToEvent serialization (regression)')`
  (`ledgerServiceImpl.test.ts:686` at `b6e518a7`), which does `LedgerEvent.encode(event).finish()`. Its import is
  already the extensionless `'@xstockstrat/proto/ledger/v1/ledger'` (`:688`, 252 Step 5 item 2), and the `dist/`
  runner is in place, so this step is not blocked.
- Design Open Risk: "ts-proto encoding of a string `sequence` on resolved rows … untraced — tier (iii)".
- C-13: rows come from `makeEventRow` and calls from `makeRecordingCall` (`src/__tests__/fixtures/`, Step 6
  section 0). Per-case overrides (`{ …, sequence: '100' }`) are scenario one-offs and stay inline.

**TDD**: `red-green required`

**Covers**: `AC-2, AC-5` (no duplicate / no drop across replayed string and live sequences)

**Instructions**:

RED on the post-Step-6 tree (before Step 7), then GREEN after Step 7.

1. **Replayed `"99"` then resolved `"100"`.**
   - Use `fromSequence: 98`, and a pool returning rows with `sequence: '98'` and `'99'`, as pg strings.
   - After replay goes live, `captured.onEvent({ …full, sequence: '100' })`.
   - Expect writes 98, 99, 100, with 100 present (RED today: dropped as `'100' > '99'` is false).
   - Then `captured.onEvent({ …, sequence: 100 })` (NOTIFY number) → no duplicate write.
2. **Buffer flush (AC-5).**
   - Hold the replay `query` open, and `captured.onEvent` a resolved row with `sequence: '100'` while `!live`.
   - Release replay with rows `'98'`, `'99'` → the flush writes 100 exactly once.
3. **Encoding.** `LedgerEvent.encode(rowToEvent({ …, sequence: '100' })).finish()` does not throw. `LedgerEvent.decode`
   of the bytes yields `sequence` `100`.
   - If ts-proto rejects a string `int64`, that is a finding. Stop and ask, and record it in the Deviation Log (the
     fix would be `Number()` in `rowToEvent`, outside this step's design scope).

**Verification**:
```bash
cd services/xstockstrat-ledger
pnpm run lint                                                  # exit 0
OUT="${TMPDIR:-/tmp}/248-step8.txt"
pnpm run test:coverage 2>&1 | tee "$OUT"; echo "exit=${PIPESTATUS[0]}"   # 0
grep -E '^(ℹ|#) (fail|cancelled|skipped|todo) ' "$OUT"                     # all 0
grep -E 'All files' "$OUT"                                                  # % Lines >= 40
node --test --test-reporter=tap dist/__tests__/ledgerServiceImpl.test.js | grep -E '^# (pass|fail) '   # pass > 0, fail 0
grep -n "^function makeRow\|^function makeStreamCall" src/__tests__/ledgerServiceImpl.test.ts || echo "C-13: fixtures reused"
```

---

### Step 9 — test: Real-TimescaleDB tier (iv) — `test:db` script, DB tests, `ledger-db-test` CI job

**Status**: `pending`
**Service**: `xstockstrat-ledger`
**Files**:
- `services/xstockstrat-ledger/package.json` — modify
- `services/xstockstrat-ledger/src/__tests__/db/streamResolve.db.test.ts` — create
- `services/xstockstrat-ledger/src/__tests__/fixtures/INVENTORY.md` — modify (add the db test as a consumer)
- `.github/workflows/ci.yml` — modify

**Reviewers**: `xstockstrat-ledger` owner — Append-only invariant (no deletes or updates), event ordering, hypertable partition safety

**Codebase Evidence**:
- **Not found:** no real-Postgres ledger harness exists (recon.md § Not found).
- Scripts (252, in place at `b6e518a7`): `"test": "tsc && node --test dist/__tests__/*.test.js"` (`package.json:13`);
  no `test:db` script exists yet. The glob is non-recursive, so
  `dist/__tests__/db/` is excluded from unit and coverage runs. Design 6(iv) adds
  `"test:db": "tsc && node --test dist/__tests__/db/*.test.js"`.
- The `tsconfig.json` test exclude is gone (`:19-22` excludes only `node_modules` and `dist`), so production `tsc`
  emits `src/__tests__/db/**` (design § Open Risks). The DB test must import only runtime dependencies (`pg`,
  `node:*`) and `src` modules, never a devDependency. `src/__tests__/db/` does not exist yet (create).
- CI anchors (`.github/workflows/ci.yml`, re-grepped 2026-10-29 at `b6e518a7`):
  - filters: `ci` `:40-41`, `proto` `:42-44`, `node-shared` `:48-51`, `xstockstrat-ledger` `:60`, `migrations` `:70-79`;
  - Node toolchain steps in `node-test` `:574-590` (checkout `:574`, `pnpm/action-setup@v6` 9.15.9 `:576-578`,
    `setup-node@v7` "24" `:580-584`, `pnpm install` `:586-587`, proto build `:589-590`);
  - `migration-rerun` job `:643-679`: TimescaleDB service block `:650-663`, migrator build `:667-668`, the run step
    `:673-679` (`--network host`, `DATABASE_URL`, `SEED_USER_ID`; it overrides the entrypoint to run
    `scripts/migration-rerun.sh`, which this job does not need);
  - `ci-gate.needs` `:799-815`;
  - evaluate echoes `:820-835`.
- `scripts/Dockerfile.migrate` has `ENTRYPOINT ["/repo/scripts/db-migrate.sh"]` (`:18`), and `db-migrate.sh`
  applies config then ledger first (`:152`, `:155`). It requires `SEED_USER_ID` (`:89`).
- `docs/patterns/ci-overview.md:7-20` is the job table (docs row in Step 11).
- Constructors: `LedgerServiceImpl(pool, config, notifier)` (`ledgerServiceImpl.ts:20-25`) and the Step 3 factories.
  The trigger stub branch is at `migrations/001_ledger_events_hypertable.up.sql:72-79`.
- Executor constraint: no step may spin up a database (spec-template § Migration step verification). The GREEN for
  this tier is the CI job run on the step PR.

**TDD**: `red-green required`

**Covers**: `AC-1, AC-6, AC-7, AC-9` (real DB; plus the trigger-stub → PK round-trip that tier (ii) assumes)

**Instructions**:

1. **`package.json`.** Add `"test:db": "tsc && node --test dist/__tests__/db/*.test.js"` after `test:coverage`. Change
   no other script.
2. **`src/__tests__/db/streamResolve.db.test.ts`.**
   - `before()` throws `new Error('LEDGER_DB_TEST_URL is required')` when it is unset. The suite fails rather than
     skips.
   - Build a `pg.Pool({ connectionString, max: 1 })`, a fake config `{ getInt: (k, d) => k === 'ledger.stream.resolve_timeout_ms' ? B : d, getBool: (_k, d) => d }`,
     and the real `EventNotifier(makeListenerClient(url, false, cfg), { resolveRow })`.
   - Construct `new LedgerServiceImpl(pool, cfg, notifier)`, and use `makeRecordingCall` from
     `../fixtures/streamCall`; payloads use `LARGE_PAYLOAD` from `../fixtures/ledgerEvents` (C-13; Step 6 section 0).
     Add this file to both catalog rows' consumers. Close everything in `after()`.
   - Cases:
     1. **Trigger round-trip + AC-1.**
        - Open a live unfiltered stream. `impl.appendEvent` an `order.filled` with an 8000-char payload,
          `source_service 'xstockstrat-trading'`, `correlation_id 'corr-42'`, `metadata {broker:'alpaca'}` and
          `userId 'user-7'`.
        - The live write deep-equals `impl.getEvent`'s response for that `event_id`.
        - Assert the NOTIFY was trimmed. A raw `LISTEN ledger_stream_all` client sees a body without `payload`.
     2. **One chunk.**
        - `EXPLAIN (FORMAT JSON) SELECT * FROM ledger.events WHERE event_id = $1 AND recorded_at = $2::timestamptz`
          with the stub's raw `recorded_at` text shows a single chunk scan.
        - It also returns exactly 1 row: the `recorded_at` text round-trip (design § Open Risks).
     3. **AC-6 / AC-7 replay recovery.**
        - Use a `resolveRow` wrapper that rejects (AC-6) or returns `null` (AC-7) for the first stub.
        - The stream is destroyed with code 14 or 13 respectively, and has no write for 11 or 12.
        - A new `streamEvents({ fromSequence: <seq of 11> })` receives both rows, full, in order.
     4. **AC-9.**
        - Use B = 200, with a `resolveRow` wrapper that runs `SELECT pg_sleep(1)` on the listener client and then
          delegates.
        - The unfiltered stream ends with code 14 within 400 ms, with no writes for 11 or 12.
        - An `event_type: 'account.balance.synced'` stream is not destroyed.
        - A new stream from 11 gets 11 and 12, full.
        - Scope limit (design 5): this proves the listener session honours `statement_timeout`; the real
          `resolveEventRow` is proven by case 1. The `query_timeout` backstop and teardown are unit-only (Step 6
          A.3.5). Record both in the Deviation Log, not in `**Covers**`.
3. **`ci.yml`.** Add a job `ledger-db-test` (name `Ledger DB test (TimescaleDB)`) after `migration-rerun`.
   - `needs: changes`.
   - `if:` true when any of `xstockstrat-ledger`, `migrations`, `proto`, `ci` or `node-shared` matches.
   - `services.timescaledb` is copied from `:650-663`.
   - Steps:
     - the Node toolchain, copied from `:574-590`;
     - `docker build -f scripts/Dockerfile.migrate -t xstockstrat-migrate-ci .`;
     - `docker run --rm --network host -e DATABASE_URL="postgres://xstockstrat:ci-only@localhost:5432/xstockstrat?sslmode=disable" -e SEED_USER_ID="00000000-0000-4000-8000-0000000000c1" xstockstrat-migrate-ci`;
     - `pnpm run test:db` in `services/xstockstrat-ledger` with
       `LEDGER_DB_TEST_URL: postgres://xstockstrat:ci-only@localhost:5432/xstockstrat?sslmode=disable`.
   - Add `ledger-db-test` to `ci-gate.needs`, and an `echo "ledger-db-test:  ${{ needs.ledger-db-test.result }}"` line.
4. **RED.**
   - If `LEDGER_DB_TEST_URL` reaches a TimescaleDB in the executor environment, apply a fast-path mutation in
     `src/services/eventNotifier.ts`: make the stub test always false, so stubs fan out unresolved. Then run
     `pnpm run test:db`; case 1 must fail. Restore with `git checkout -- src/services/eventNotifier.ts`.
   - That file is outside this step's **Files**. The mutation is temporary and never staged (F-08); record it, with
     the post-restore `git diff --quiet -- src/services/eventNotifier.ts` exit 0, in `context.md`.
   - Otherwise record "tier (iv) RED not captured: CI-only DB" in the Deviation Log (fails.md:2839-2842). The
     unit-tier REDs of Steps 4, 6 and 8 stand for these ACs.
   - Never start a container from the executor.

**Verification**:
```bash
cd services/xstockstrat-ledger
pnpm build && pnpm run lint                                    # both exit 0
ls dist/__tests__/db/streamResolve.db.test.js
grep -n '"test:db": "tsc && node --test dist/__tests__/db/\*.test.js"' package.json
env -u LEDGER_DB_TEST_URL node --test dist/__tests__/db/*.test.js; echo "exit=$?"   # non-zero; output names LEDGER_DB_TEST_URL (fails, never skips)
OUT="${TMPDIR:-/tmp}/248-step9.txt"
pnpm run test:coverage 2>&1 | tee "$OUT"; echo "exit=${PIPESTATUS[0]}"               # 0 (c8 --lines 40 gate, package.json:14)
grep -E 'All files' "$OUT"                                                            # % Lines >= 40
grep -c "streamResolve.db" "$OUT" || true                                             # 0: unit/coverage glob excludes db/
# Coverage gate: test:db is intentionally outside c8. The >= 40 gate stays on the unit tier (test:coverage).
grep -nE "from '(c8|typescript|eslint|ts-node|@types/)" src/__tests__/db/streamResolve.db.test.ts src/__tests__/fixtures/*.ts || echo "OK: runtime deps only"
cd ../..
grep -n "ledger-db-test:" .github/workflows/ci.yml                  # job id
grep -n "      - ledger-db-test" .github/workflows/ci.yml           # in ci-gate.needs
grep -n 'needs.ledger-db-test.result' .github/workflows/ci.yml
# GREEN: the ledger-db-test job passes on the step PR; paste its run URL + summary into the PR body and context.md
```

---

### Step 10 — test: Consumer verification — analysis and portfolio (no code change)

**Status**: `pending`
**Service**: `xstockstrat-analysis`, `xstockstrat-portfolio`
**Files**: none (verification only)

**Reviewers**: `xstockstrat-analysis` owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias; `xstockstrat-portfolio` owner — P&L calculation accuracy, position snapshot consistency, concurrent write safety

**Codebase Evidence**:
- Portfolio:
  - `consumeEventStream` (`services/xstockstrat-portfolio/internal/service/portfolio_service.go:185-202`) reconnects
    on any error after `time.Sleep(2 * time.Second)` (`:199`).
  - `streamEventsFrom` (`:206-233`) returns `(lastSeq, err)` on a non-EOF `Recv` error (`:223-224`) before the cursor
    moves (`:229-230`), and resumes from `lastSeq + 1` (`:207-210`).
  - Codes 13 and 14 both take this path. Only `io.EOF` (`:220-221`) is a clean close.
  - Existing coverage: `TestStreamEventsFrom_HandlerError_DoesNotAdvanceCursor`
    (`portfolio_fill_errors_test.go:142`).
- Analysis: `PnLPatternConsumer.run_forever` (`services/xstockstrat-analysis/app/engine/pnl_pattern_consumer.py:147-162`)
  catches any stream exception, sleeps 2 s, re-reads the cursor (`:151`) and reopens from it. `process_event` drops
  `sequence <= cursor` (`:164-168`).
- Design 3: both consumers reconnect and replay on non-OK, so no consumer change is needed.
- All anchors above re-checked 2026-10-29 at `b6e518a7`: unchanged.

**TDD**: `N/A (verification only; no code change — characterization of unchanged consumers)`

**Covers**: — (consumer half of AC-6/AC-7 recovery; asserted ledger-side in Steps 6 and 9)

**Instructions**:
1. Re-read the cited lines on the merged-up tree and confirm they are unchanged. Any change that treats a non-OK end
   as terminal, or advances a cursor before the handler, is a stop-and-ask.
2. Run both suites unchanged. Commit nothing.

**Verification**:
```bash
grep -n "time.Sleep(2 \* time.Second)" services/xstockstrat-portfolio/internal/service/portfolio_service.go
grep -n "if err == io.EOF" services/xstockstrat-portfolio/internal/service/portfolio_service.go
grep -n "await asyncio.sleep(2)" services/xstockstrat-analysis/app/engine/pnl_pattern_consumer.py
cd services/xstockstrat-portfolio && export GOWORK=off   # CI sets it via env: (ci.yml:258-259); a bare assignment would not reach go
COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//')
go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"   # >= 40%
# Smoke check only: COVERPKGS excludes /service (ci.yml:256), so the total is not coverage evidence for
# portfolio_service.go; TestStreamEventsFrom_HandlerError_DoesNotAdvanceCursor must pass in the go test output.
golangci-lint run --modules-download-mode=mod
cd ../xstockstrat-analysis && uv run --no-sync pytest --cov=app --cov-fail-under=40 && ruff check . && ruff format --check .
git status --short   # no service changes
```

---

### Step 11 — docs: Teardown — invariants, CLAUDE.md, findings, config log, CI table

**Status**: `pending`
**Service**: `services/xstockstrat-ledger/`, `services/xstockstrat-config/`, `docs/patterns/`
**Files**:
- `services/xstockstrat-ledger/docs/context-constitution.md` — modify
- `services/xstockstrat-ledger/docs/context-constitution-findings.md` — modify
- `services/xstockstrat-ledger/CLAUDE.md` — modify
- `services/xstockstrat-config/CLAUDE.md` — modify
- `docs/patterns/config-governance.md` — modify
- `docs/patterns/ci-overview.md` — modify
- `docs/patterns/test-data-inventory.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- Ledger `docs/context-constitution.md`:
  - LEDGER-2 `:19`;
  - LEDGER-7 `:24`, the last row, so LEDGER-8 is appended after it;
  - the trimmed-row gotcha `:28`, which the fix makes stale;
  - the "Split pool" pointer `:35`.
- Ledger `docs/context-constitution-findings.md`:
  - the "three" row `:13`;
  - the latent-bug row `:19`;
  - the open question `:36` (recon.md § Risks "Doc drift").
- Ledger `CLAUDE.md`:
  - constitution pointer `:4` ("NOTIFY 8KB-trim Invalid-Date" defect);
  - § Live Streaming Architecture `:37-53`, with "**three**" at `:46` (five per LEDGER-3, `context-constitution.md:20`);
  - § Config Keys Consumed `:62-72`.
- Config `CLAUDE.md:104` "New keys require PR to `packages/proto/`" is drift: 022 and 248 seed keys without a proto
  PR (design 4).
- `docs/patterns/config-governance.md:56-61` (registration steps) and the Per-Feature Registered Keys header `:108`
  (append-only, newest-first log). The newest entry is feature 240 (`:112` at `b6e518a7`, 2026-10-29); lines drift,
  so locate by content.
- `docs/patterns/ci-overview.md:7-20` is the job table (`node-test` row `:18`).
- `docs/patterns/test-data-inventory.md:73-74` ("config/ledger at two … no new home") and the Node row `:83`
  ("Not materialized") go stale once Step 6 creates the ledger home.
- Overlap: 243 `fix-sandbox-seed-keys` also edits `config-governance.md` (its `implementation-spec.md:329`, :359): one
  row in the Author-sentinel table, adjacent to this step's log insert (before the feature 240 entry). Expect a rebase
  conflict; whichever merges second rebases and keeps both edits.
- Teardown rule: root `CLAUDE.md` § Teardown, and fails.md:670 (context-forge unavailable → manual reconciliation
  recorded in the PR body).

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. **Ledger constitution.**
   - Append to the LEDGER-2 rule text: "Trimmed NOTIFY rows are resolved in `EventNotifier` before fan-out, in NOTIFY
     order (serial FIFO, `!draining` fast-path), so `onEvent` only ever sees full rows. The flush stays synchronous."
     Cite `eventNotifier.ts#dispatch`/`#drain`.
   - Add **LEDGER-8**: "The `EventNotifier` LISTEN client runs only single-statement PK reads and session
     `SET statement_timeout`, bounded by `ledger.stream.resolve_timeout_ms` (server) and 2× (client `query_timeout`).
     Never a transaction or bulk read." Why: a transaction on the LISTEN session holds back NOTIFY delivery, and an
     unbounded read freezes all fan-out. Cite `src/services/eventRowResolver.ts#resolveEventRow`.
   - Rewrite the `:28` gotcha as resolved. A trimmed row is now resolved by PK, and a resolve failure ends matching
     streams with 13 (not found) or 14 (error or timeout).
   - Update the `:35` pointer to "query pool max=1 + dedicated `EventNotifier` LISTEN conn (which also runs the
     trimmed-row resolve) = 2 total".
2. **Ledger findings.**
   - Mark `:19` and `:36` **RESOLVED (feature 248)**, citing `eventNotifier.ts#drain`.
   - In `:13`, mark the subscription-count half resolved and leave `TRADING_MODE` open.
3. **Ledger `CLAUDE.md`.**
   - `:46-47`: "**three**" → "**five**". The list becomes `order.filled`, `account.positions.synced`,
     `account.deregistered`, `order.bracket_updated`, `account.balance.synced`. Add analysis's single unfiltered
     P&L stream.
   - Add ≤3 lines to § Live Streaming Architecture: payload-less NOTIFY rows are resolved once on the LISTEN
     connection by PK `(event_id, recorded_at)`. On failure, matching streams end 13/14 and clients replay.
   - Add a Config Keys row:
     `| \`ledger.stream.resolve_timeout_ms\` | int | \`2000\` | Bound on the LISTEN-connection trimmed-row resolve (statement_timeout; 2× client backstop). ≤0/non-finite → 2000. Applied per session via SET-on-change. Seeded \`value_type\` \`int\` (config migration 033). |`
   - Update the `:4` pointer text so the NOTIFY-trim defect is no longer listed as open.
4. **Config `CLAUDE.md:104`** (locate by content). Replace it with "New keys are seeded by a config migration and registered in
   `docs/patterns/config-governance.md` § Per-Feature Registered Keys. A `packages/proto/` PR is needed only for a
   new RPC or field."
5. **`config-governance.md`.** Insert the newest-first entry before the feature 240 entry (`:112` today): `### feature 248 — fix-ledger-trimmed-notify-payload (xstockstrat-ledger / xstockstrat-config)`.
   Give it a one-line purpose and a table row (key, `int`, `2000`, clamp ≤0/non-finite → 2000, seeded staging +
   production by `033_ledger_stream_resolve_timeout`).
   - Locate the insert point by content (newest entry), not by line: 243's sentinel row shifts the lines.
6. **`ci-overview.md`.** Add the row
   `| \`ledger-db-test\` | Applies all migrations to TimescaleDB, runs ledger \`pnpm run test:db\` (trigger-stub resolve, replay recovery, resolve bound) | — |`
   after the `node-test` row.
7. **`test-data-inventory.md`.** Node row (`:83`) → "Materialized in ledger (feature 248):
   `src/__tests__/fixtures/` + `INVENTORY.md`". Amend `:73-74` so it no longer predicts no ledger home.
8. **Teardown audit.**
   - Run `/context-forge:context-constitution refresh`, scoped to the files above, and fix grounded drift.
   - If the plugin is unavailable, re-read each touched file against the code. Record "plugin unavailable" plus the
     manual reconciliation performed in the PR body (fails.md:670).

**Verification**:
```bash
grep -n "LEDGER-8" services/xstockstrat-ledger/docs/context-constitution.md
grep -n "ledger.stream.resolve_timeout_ms" services/xstockstrat-ledger/CLAUDE.md docs/patterns/config-governance.md
grep -n "\*\*five\*\*" services/xstockstrat-ledger/CLAUDE.md
grep -c "\*\*three\*\*" services/xstockstrat-ledger/CLAUDE.md          # 0
grep -n "RESOLVED (feature 248)" services/xstockstrat-ledger/docs/context-constitution-findings.md
grep -n "New keys require PR to \`packages/proto/\`" services/xstockstrat-config/CLAUDE.md || echo "OK: drift removed"
grep -n "ledger-db-test" docs/patterns/ci-overview.md
grep -n "Materialized in ledger (feature 248)" docs/patterns/test-data-inventory.md
./scripts/check-context-map.sh                                          # exit 0
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._

### 2026-10-28 — Re-spec (sdd-execute sequential §5.3): config migration `032` → `033`

- **Step**: 2 (propagates to Steps 1 and 11)
- **Planned**: `032_ledger_stream_resolve_timeout.{up,down}.sql` (product-spec.md:61-63).
- **Actual**: `033_ledger_stream_resolve_timeout.{up,down}.sql`. 244 `fix-python-config-stored-zero` now holds
  `032_analysis_zero_trap_descriptions` on its branch; 243 holds `031`; 264 reserves `034`.
- **Disposition**: re-spec before the step loop; Step 1 records 248-after-243 and 248-after-244 merge-order rows.
  product-spec.md is not edited by this re-spec (its `032` mention is superseded here).

### 2026-10-29 — Step 3: `resolveEventRow` export grep matches 3 of 4

- **Step**: 3
- **Planned**: Verification greps `export function resolveEventRow\|…` and expects 4 hits.
- **Actual**: Instruction 3 specifies `export async function resolveEventRow(…)`, which the literal
  `export function resolveEventRow` pattern does not match, so the grep returns 3 hits. The fourth export is at
  `eventRowResolver.ts:17` (`grep -n "export async function resolveEventRow"`).
- **Disposition**: spec grep defect, not a code deviation; the module follows Instruction 3. No other change.

### 2026-10-29 — Step 3: RED captured with an uncommitted probe test

- **Step**: 3
- **Planned**: `TDD: red-green required`, with behaviour asserted in Step 4 (`eventRowResolver.test.ts`).
- **Actual**: Step 4's file is outside Step 3's **Files** (F-08), so RED/GREEN was captured with a temporary probe,
  `src/__tests__/step3probe.test.ts`. RED was `tsc` TS2307 (module missing). GREEN was 49/49 pass, including the
  probe's 2 cases (PK SELECT text/values, `query_timeout` 2B, SET-on-change, null on miss, clamp). The probe was
  deleted before commit. Step 4 still authors the real suite.
- **Disposition**: no spec change; Step 4 unchanged.

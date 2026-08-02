# Recon: fix-mcp-server-input-validation

**Created**: 2026-08-02
**From**: product-spec.md
**Affected services**: xstockstrat-ingest (Python), xstockstrat-notify (Node.js)

---

## Objective

Two independent server-side input-validation guards. **F-9:** `IngestSignal` must reject
out-of-range `conviction` (`< 0.0` or `> 1.0`) with `INVALID_ARGUMENT` — today `> 1.0` dies as a
DB-CHECK `INTERNAL` and `< 0.0` is silently swallowed by the `> 0.0` NULL-sentinel and stored NULL.
**F-10:** `emitAlert` must reject empty `title`/`body` with `INVALID_ARGUMENT` — today proto3 empty
strings are persisted and delivered blank. No proto/migration/config changes.

## Codebase Map

- **`xstockstrat-ingest`** (Python 3.12, grpc.aio)
  - Handler: `IngestSignal` — `app/handlers/servicer.py:649`
  - Conviction read + NULL-sentinel: `app/handlers/servicer.py:692`
    (`conviction = signal.conviction if signal.conviction > 0.0 else None`)
  - Existing INVALID_ARGUMENT guards (the pattern to mirror): direction guard
    `app/handlers/servicer.py:667-672`, required-field guard `:661-665`, source-registry guard
    `:679-684` — all `await context.abort(grpc.StatusCode.INVALID_ARGUMENT, "...")` + `return`
  - DB INSERT (conviction = param `$4`): `app/handlers/servicer.py:695-712`; the catch-all that
    turns the CHECK violation into `INTERNAL`: `:722`
  - Proto: `ExternalSignal.conviction` = `double conviction = 4;` — `packages/proto/ingest/v1/ingest.proto:109`
    (plain scalar, **NOT** `optional` — no proto3 presence, so `0.0` is indistinguishable from unset)
  - DB CHECK: `conviction NUMERIC(4,3) CHECK (conviction BETWEEN 0 AND 1)`, column **nullable** —
    `services/xstockstrat-ingest/migrations/001_newsletter_signals.up.sql:14`
  - Tests: `tests/test_ingest_servicer.py` — `make_servicer(...)` factory `~:30`; RED-test template
    is `TestIngestSignalRegistryValidation` `:822` (builds a **real** `ingest_pb2.ExternalSignal`
    `:823-829`; asserts via `context.abort = AsyncMock(side_effect=Exception("aborted"))` +
    `assert context.abort.call_args[0][0] == grpc.StatusCode.INVALID_ARGUMENT` `:838-847`).
    `conftest.py` = `sys.path`/gen setup only, **no shared fixtures**.

- **`xstockstrat-notify`** (Node.js 22 + TypeScript, @grpc/grpc-js)
  - Handler: `emitAlert(call, callback)` — `src/grpc/notifyServiceImpl.ts:30`; reads
    `req.title`/`req.body` (`:31`), writes them at `:49` (`$4`) / `:50` (`$5`) and fans them out at
    `:65-66`; **no field validation** before the INSERT
  - Error idiom: numeric grpc-js codes via callback — `callback({ code: 13, message })` at `:95`
    (INTERNAL). `INVALID_ARGUMENT === 3`; sibling precedent for a numeric `code: 3` validation guard
    is `services/xstockstrat-identity/src/grpc/identityServiceImpl.ts:52` (`return callback({ code: 3,
    message: 'email and password required' })`). Zero new imports needed.
  - Constructor uses **parameter-properties** (`constructor(private readonly pool: Pool, private
    readonly config: ConfigWatcher)`) — `src/grpc/notifyServiceImpl.ts:21-24`
  - Proto: `EmitAlertRequest` — `string title = 3;` / `string body = 4;` —
    `packages/proto/notify/v1/notify.proto:53-54`
  - Tests: `src/__tests__/notifyServiceImpl.test.ts` — emitAlert call/assert template at `:133-167`
    (`impl.emitAlert(call, (err) => { assert.strictEqual(err.code, 13); ... })`)

## Patterns to REUSE

- **F-9 guard** → mirror the existing direction guard verbatim: `await context.abort(
  grpc.StatusCode.INVALID_ARGUMENT, "...")` + `return`, placed with the other top-of-handler
  validations (`app/handlers/servicer.py:667-672`). Leave the `> 0.0` NULL-sentinel at `:692`
  untouched.
- **F-9 RED test** → mirror `TestIngestSignalRegistryValidation` (`tests/test_ingest_servicer.py:822`)
  — real `ingest_pb2.ExternalSignal` proto + `context.abort` AsyncMock assertion.
- **F-10 guard** → mirror identity's numeric-`code:3` callback guard
  (`identityServiceImpl.ts:52`); notify's own error idiom is already numeric (`:95`).
- **F-10 test harness** → mirror the sibling **compile-first** harness config already runs
  (`services/xstockstrat-config/package.json:12` = `"tsc && node --test dist/__tests__/*.test.js"`)
  and its INVALID_ARGUMENT assertion (`setConfigAuthz.test.ts:169`). This is the **same** flip
  feature 092 makes to notify (see Risks — overlap).

## Dependencies

- Proto/RPC: none changed. Read-only touchpoints: `ExternalSignal.conviction` (double, field 4);
  `EmitAlertRequest.title/body` (string, fields 3/4).
- Migration: none.
- Config keys: none.
- Inter-service edges: none new.
- New env vars / ports: none.

## Risks / Not-found

- **Harness/overlap (074 trap + 092 collision).** notify's test suite still runs the
  `--experimental-strip-types` harness (`package.json:12`), and `NotifyServiceImpl`'s
  parameter-property constructor (`:21-24`) is exactly the syntax strip-types cannot compile
  (`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`) — the existing test's lazy `try/catch` import + `if (!impl)
  return` early-returns make the whole suite a **zero-assertion green** (ledger fails 2026-07-29,
  074). A real RED-first emitAlert test therefore **requires** flipping notify to compile-first.
  Feature **092** (PR #850, not yet merged to main-dev) makes this identical flip
  (`package.json` + rewrites `notifyServiceImpl.test.ts` to static imports + hard assertions). 094 is
  cut from main-dev pre-092, so it carries the old harness and must self-contain the flip — the two
  branches collide on `notify/package.json` + `notifyServiceImpl.test.ts` and reconcile at rebase
  (function-disjoint intent: 092 adds an EmitAlert descriptor-parity test, 094 adds an empty-field
  validation test; both want the same compile-first script).
- **Genuine zero-conviction (out of scope).** `conviction` is a plain-scalar `double` (no presence),
  so `0.0` == "not provided". The guard must reject `< 0.0` and `> 1.0` only — `0.0` stays the
  unset sentinel (→ NULL at `:692`). Making genuine zero representable needs a proto-presence change
  and is a documented follow-up (product-spec Out of Scope), not this SEV-3 fix.
- **Absence-claim discipline (ledger 080).** The spec's "no proto/migration/config changes" and
  "valid `[0,1]` unaffected" are absence claims — verified above: the guard is additive and the
  `> 0.0` sentinel + DB path are unchanged for in-range values.

## Recommended Scope

Advisory two-step split (independent services, no coupling):

1. **ingest F-9** — add the conviction range guard in `IngestSignal` (mirror the direction guard),
   paired RED-first test in `TestIngestSignal*` asserting `conviction=1.5` and `conviction=-0.1` →
   `INVALID_ARGUMENT`, plus a valid-value regression. Update service CLAUDE.md if it documents the
   validation surface.
2. **notify F-10** — flip `package.json` test script to compile-first, rewrite/repair
   `notifyServiceImpl.test.ts` to static imports + hard assertions, add the empty-title/body guard in
   `emitAlert` (numeric `code: 3`), paired RED-first test. Update service CLAUDE.md.

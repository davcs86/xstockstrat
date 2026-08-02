# Implementation Spec: fix-mcp-server-input-validation

**Status**: `completed`
**Created**: 2026-08-02
**Feature**: `docs/roadmap/features/094-fix-mcp-server-input-validation/feature.md`
**Total Steps**: 5
**Feature Branch**: `feature/fix-mcp-server-input-validation`

---

## Execution Summary

Two independent, additive server-side input-validation guards, one per service, each paired with a
RED-first test, plus one docs step that syncs the model-facing surfaces. **F-9** adds an
inverted-range conviction guard to ingest's `IngestSignal` (Steps 1–2). **F-10** adds an
empty/whitespace title-body guard to notify's `emitAlert` (Step 3), whose paired test step (Step 4)
must first flip notify off the never-executing `--experimental-strip-types` harness to a compile-first
harness and green every pre-existing case before the new RED case can run (the 074 de-cloak). Step 5
updates both MCP-tool docstrings, the `mcp-tools.md` runbook, and the `merge-order.md` 092↔094 entry.
The two services are fully decoupled — Steps 1–2 and Steps 3–4 may land in either order.

## Step Dependencies

- **Step 2 [test] covers Step 1 [service]** (ingest conviction guard) — red-before-green pair.
- **Step 4 [test] covers Step 3 [service]** (notify emitAlert guard) — red-before-green pair. Step 4
  also carries the mandatory **harness flip** (`package.json` compile-first) and **074 de-cloak**
  (green every pre-existing notify case) — these are prerequisites for *any* notify test to execute,
  so the RED demonstration of the new empty-field case happens only after the flip lands within Step 4.
- **No cross-service ordering.** ingest (Steps 1–2) and notify (Steps 3–4) are independent; either
  pair may land first. Step 5 (docs) should land last so its "now rejects" claims match merged code,
  but has no hard dependency.
- **External:** the notify harness flip in Step 4 collides with in-flight feature **092** (PR #850,
  unmerged) on `notify/package.json` + `notifyServiceImpl.test.ts` — identical-intent compile-first
  flip; whichever lands second rebases (union of the two added test cases). Recorded in Step 5's
  `merge-order.md` edit; `/sdd-review impl-spec` overlap scan must confirm.

---

### Step 1 — service: ingest conviction range guard (F-9)

**Status**: `completed`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/app/handlers/servicer.py` — modify

**Reviewers**: xstockstrat-ingest owner — signal normalization correctness, idempotent ingestion, newsletter source schema stability

**Codebase Evidence**:
- Handler `async def IngestSignal(self, request, context):` at `services/xstockstrat-ingest/app/handlers/servicer.py:649`.
- Insertion point: after the direction guard's `return` at `:672`, before the `# FR-3: source slug must be registered and active` comment at `:674` (fail-fast, in-memory, before the DB source-registry lookup at `:675`).
- Pattern to mirror verbatim — the direction guard at `:667-672`:
  `if signal.direction not in valid_directions:` → `await context.abort(grpc.StatusCode.INVALID_ARGUMENT, ...)` → `return`.
- NULL-sentinel left untouched: `conviction = signal.conviction if signal.conviction > 0.0 else None` at `:692`.
- DB backstop unchanged: `conviction NUMERIC(4,3) CHECK (conviction BETWEEN 0 AND 1)`, column nullable — `services/xstockstrat-ingest/migrations/001_newsletter_signals.up.sql:14`; the catch-all that today turns the CHECK violation into `INTERNAL` is at `servicer.py:722`.
- Proto: `ExternalSignal.conviction` is `double conviction = 4;` (plain scalar, no proto3 presence) — `packages/proto/ingest/v1/ingest.proto:109`, so `0.0` == "not provided".

**TDD**: `red-green required` (paired with Step 2).

**Instructions**:
Insert the following guard between `servicer.py:672` (the direction guard's `return`) and `:674`
(the `# FR-3:` comment), matching the surrounding indentation (8 spaces):

```python
if not (0.0 <= signal.conviction <= 1.0):
    await context.abort(
        grpc.StatusCode.INVALID_ARGUMENT, "conviction must be between 0.0 and 1.0"
    )
    return
```

Use the **inverted-range form** `not (0.0 <= signal.conviction <= 1.0)` exactly as written — NOT
`signal.conviction < 0.0 or signal.conviction > 1.0`. Rationale (design.md § F-9, adversary round 1):
the two forms are identical for every finite value (`0.0` and `1.0` pass, `(0,1]` unaffected, `±inf`
rejected), but only the inverted form rejects `NaN` — every NaN comparison is `False`, so the naive
form would let a `NaN` conviction through and it would then hit `NaN > 0.0 == False` at the
NULL-sentinel (`:692`) and be silently stored NULL, reproducing this feature's own bug for a
different input.
Leave `:692` (the `> 0.0` NULL-sentinel), the INSERT (`:695-712`), and the DB CHECK
(`001_newsletter_signals.up.sql:14`) untouched — `0.0` still passes the guard and falls through to
NULL (genuine zero-conviction stays out of scope, product-spec § Out of Scope). This guard only
converts the surfaced error for out-of-range input from `INTERNAL` (DB CHECK) → `INVALID_ARGUMENT`,
and closes the silent-NULL path for negatives and NaN.

**Verification**:
- `grep -n "conviction must be between" services/xstockstrat-ingest/app/handlers/servicer.py` — confirm the guard is present, placed before line ~677 (the source-registry lookup).
- Lint: `cd services/xstockstrat-ingest && ruff check . && ruff format --check .`
- Behavioral coverage is proven by Step 2.

---

### Step 2 — test: ingest conviction validation (covers Step 1)

**Status**: `completed`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/tests/test_ingest_servicer.py` — modify

**Reviewers**: xstockstrat-ingest owner — signal normalization correctness, idempotent ingestion, newsletter source schema stability

**Codebase Evidence**:
- RED-test template to mirror: `class TestIngestSignalRegistryValidation` at `tests/test_ingest_servicer.py:822`; its `_make_signal_req` builds a **real** `ingest_pb2.ExternalSignal` (`:823-829`) and asserts `context.abort.call_args[0][0] == grpc.StatusCode.INVALID_ARGUMENT` via `context.abort = AsyncMock(side_effect=Exception("aborted"))`.
- Green-path template to mirror: `test_proceeds_when_source_registered` at `:848-857` — `make_servicer()`, `svc._db.fetchrow = AsyncMock(side_effect=[{"slug": ...}, {"id": 42}])`, `svc._ledger.AppendEvent = AsyncMock(...)`, then `assert resp.signal_id == 42`.
- Factory `def make_servicer(...)` at `:28`; `ingest_pb2` imported at `:18`; `Timestamp` used by the existing template at `:823-824`.
- C-13: the domain literals here (`ExternalSignal` fields, mock rows) are single-consumer inline within this new class, matching the existing per-class inline style in this file (`conftest.py` holds no shared signal fixtures — recon). No second consumer is introduced → inline is compliant; no `conftest.py` fixture home is created.

**TDD**: `red-green required` — authored to fail against the pre-Step-1 tree.

**Instructions**:
Add a new test class `TestIngestSignalConvictionValidation` to
`services/xstockstrat-ingest/tests/test_ingest_servicer.py` (place it after
`TestIngestSignalRegistryValidation`, before `TestManageSignalSource` at `:865`), mirroring the
registry-validation class's structure. Include a `_make_signal_req(conviction: float)` helper that
builds a real `ingest_pb2.ExternalSignal(source="unusual_whales", symbol="AAPL", direction="buy",
valid_from=<current Timestamp>, conviction=conviction)` wrapped in an `IngestSignalRequest`.

RED cases (each: `svc = make_servicer()`, `svc._db = MagicMock()` [non-None so the `_db is None` check
at `:657` passes; the guard fires before any DB call], `context.abort = AsyncMock(side_effect=
Exception("aborted"))`, `with pytest.raises(Exception, match="aborted")`, then
`assert context.abort.call_args[0][0] == grpc.StatusCode.INVALID_ARGUMENT`):
- `conviction=1.5` (above range)
- `conviction=-0.1` (below range — today silently stored NULL)
- `conviction=float("nan")` (the inverted-range form's NaN rejection — today silently stored NULL)

GREEN regressions (mirror `test_proceeds_when_source_registered`: `fetchrow` side_effect
`[{"slug": "unusual_whales"}, {"id": 42}]`, mock `svc._ledger.AppendEvent`, assert `resp.signal_id == 42`):
- `conviction=0.7` — proceeds to INSERT.
- `conviction=0.0` — still succeeds (passes the guard, stored NULL via the `:692` sentinel; not rejected).

**Verification**:
- RED (before Step 1): `cd services/xstockstrat-ingest && pytest tests/test_ingest_servicer.py::TestIngestSignalConvictionValidation` — the three abort cases FAIL (no guard yet; the request currently reaches the DB path).
- GREEN (after Step 1): same command passes.
- Coverage + lint: `cd services/xstockstrat-ingest && ruff check . && ruff format --check . && pytest --cov=app --cov-fail-under=40` — confirm ≥ 40%.

---

### Step 3 — service: notify emitAlert empty-field guard (F-10)

**Status**: `completed`
**Service**: `xstockstrat-notify`
**Files**:
- `services/xstockstrat-notify/src/grpc/notifyServiceImpl.ts` — modify

**Reviewers**: xstockstrat-notify owner — stream delivery guarantees, backpressure handling, alert deduplication

**Codebase Evidence**:
- Handler `async emitAlert(call: any, callback: any)` at `services/xstockstrat-notify/src/grpc/notifyServiceImpl.ts:30`; `const req = call.request;` at `:31`; `const alertId = uuidv4();` at `:32`.
- `req.title`/`req.body` are read into the INSERT at `$4`/`$5` (`:49-50`) and fanned out at `:65-66`; there is **no** field validation before the INSERT.
- Error idiom: numeric grpc-js code via callback — `callback({ code: 13, message: err.message });` at `:96` (INTERNAL). `INVALID_ARGUMENT === 3`.
- Precedent for a numeric `code: 3` validation guard: `services/xstockstrat-identity/src/grpc/identityServiceImpl.ts:52` — `return callback({ code: 3, message: 'email and password required' });`. Zero new imports needed.
- Proto: `EmitAlertRequest` `string title = 3;` / `string body = 4;` — `packages/proto/notify/v1/notify.proto:53-54` (proto3 strings default `""`, never null — so `NOT NULL` columns never fire on empties).

**TDD**: `red-green required` (paired with Step 4).

**Instructions**:
Insert the following guard immediately after `const req = call.request;` (`:31`), before
`const alertId = uuidv4();` (`:32`), matching the surrounding indentation (4 spaces):

```typescript
if (!req.title?.trim() || !req.body?.trim()) {
  return callback({ code: 3, message: 'title and body are required' });
}
```

Numeric `code: 3` (== `INVALID_ARGUMENT`) mirrors identity's guard idiom (`identityServiceImpl.ts:52`)
and notify's own numeric error style (`:96`) — no new imports. `.trim()` deliberately widens the AC
("empty title or body") to also reject whitespace-only input: the product-spec harm is "stored and
**delivered blank**", and a whitespace-only title delivers visually blank to a `StreamAlerts`
subscriber exactly as `""` does (design.md § F-10, recorded widening). Keep the `?.` optional-chain —
it is unreachable given proto3's `""` default but is cheap defense against an impossible `undefined`
throwing an uncaught `TypeError` → `UNKNOWN` instead of `INVALID_ARGUMENT`.
Do not alter the constructor's parameter-property syntax (`:21-24`) or the INSERT/fan-out.

**Verification**:
- `grep -n "title and body are required" services/xstockstrat-notify/src/grpc/notifyServiceImpl.ts` — confirm the guard is present before the INSERT.
- Lint: `cd services/xstockstrat-notify && pnpm run lint`
- Behavioral coverage (and the harness flip that lets it run) is proven by Step 4.

---

### Step 4 — test: notify emitAlert validation + harness flip + 074 de-cloak (covers Step 3)

**Status**: `completed`
**Service**: `xstockstrat-notify`
**Files**:
- `services/xstockstrat-notify/package.json` — modify (flip `test` / `test:coverage` to compile-first)
- `services/xstockstrat-notify/src/__tests__/notifyServiceImpl.test.ts` — modify (static imports + de-cloak + new empty-field case)

**Reviewers**: xstockstrat-notify owner — stream delivery guarantees, backpressure handling, alert deduplication

**Codebase Evidence**:
- **074 trap (why the flip is mandatory).** `package.json:12-13` still runs
  `node --experimental-strip-types --test src/__tests__/*.test.ts`; `NotifyServiceImpl` uses a
  parameter-property constructor (`notifyServiceImpl.ts:21-24`) that strip-types cannot compile
  (`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`). The test's lazy `try/catch` import + `if (!impl) return` /
  `if (!NotifyServiceImpl) return` early-returns (`test file :22-31, :49, :125, :154`) make the whole
  suite a **zero-assertion green** — it has never executed. A real RED-first F-10 test is impossible
  under it.
- **Flip target (byte-identical to config's proven script):** `services/xstockstrat-config/package.json:12-13`
  — `"test": "tsc && node --test dist/__tests__/*.test.js"`,
  `"test:coverage": "tsc && c8 --reporter=text --reporter=lcov --lines 40 node --test dist/__tests__/*.test.js"`.
  notify's `tsconfig.json` already emits `dist/__tests__/*.test.js` (`include: ["src/**/*"]`, `rootDir
  ./src` → `outDir ./dist`, mirrors config) — no tsconfig edit needed.
- **INVALID_ARGUMENT assertion precedent:** `services/xstockstrat-config/src/__tests__/setConfigAuthz.test.ts:169`.
- **Pre-existing cases that must stay green after the flip (de-cloak enumeration):**
  `rowToAlert` — "maps row to alert proto shape" (`test file :69`) and "uses empty string for null
  correlation_id and target_user_id" (`:94`); `emitAlert` — "binds severity as the numeric enum
  value" (`:124`) and "calls back with error code 13 on DB failure" (`:153`); `matchesSubscriber` —
  the seven cases at `:175, :183, :191, :199, :207, :215, :223, :231`; `streamAlerts` — "registers
  subscriber and deregisters on cancelled" (`:245`); `rowToAlert serialization (regression)` —
  "produces a Date createdAt that ts-proto encodes without throwing" (`:280`).
- C-13: notify has no `src/__tests__/fixtures/` home today; the new case's inline `call.request`
  literal is a single-consumer scenario one-off (mirrors the existing inline `call` objects at
  `:139-147`, `:156-158`) → inline is compliant, no fixture home created.

**TDD**: `red-green required` — the new empty-field case is authored to fail against the pre-Step-3 tree.

**Instructions**:
1. **Flip the harness.** In `services/xstockstrat-notify/package.json`, replace the `test` and
   `test:coverage` scripts (`:12-13`) with config's compile-first forms (byte-identical):
   - `"test": "tsc && node --test dist/__tests__/*.test.js"`
   - `"test:coverage": "tsc && c8 --reporter=text --reporter=lcov --lines 40 node --test dist/__tests__/*.test.js"`
2. **Rewrite to static imports.** In `notifyServiceImpl.test.ts`, replace the lazy `before(async () => { try { const mod = await import('../grpc/notifyServiceImpl.js'); ... } catch {} })` block
   (`:22-31`) with a top-level static import
   `import { NotifyServiceImpl, rowToAlert } from '../grpc/notifyServiceImpl.js';`, and remove every
   `if (!NotifyServiceImpl) return;` / `if (!impl) return;` early-return guard (`:49`, `:125`, `:154`,
   and any other occurrence) plus the now-unused `let NotifyServiceImpl` / `let rowToAlert`
   declarations. Update the file header comment that documents the strip-only skip behavior.
3. **074 de-cloak (mandatory, before adding the new case).** Compile and run the rewritten suite and
   confirm **every** pre-existing case enumerated in Codebase Evidence executes and passes green
   (config's identical flip surfaced "1 fails, 1 hangs" — expect latent red). Fix any latent red
   within this step; if remediation balloons beyond a trivial fix, surface it as a **P-03 deviation**
   in the `## Deviation Log` rather than absorbing it silently (design.md Open Risks).
4. **Add the RED case.** In the `describe('emitAlert', ...)` block, add cases asserting that an empty
   `title`, an empty `body`, and a whitespace-only `title` each invoke the callback with `err.code === 3`
   (mirror the `code: 13` DB-failure case at `:153-167` for callback/assert shape; use a `makePool([])`
   or inline pool that would otherwise succeed, so the guard — not a DB error — is what returns `3`).
   Keep a green happy-path assertion (non-empty title+body reaches the pool) if not already covered.

**Verification**:
- RED (before Step 3): `cd services/xstockstrat-notify && pnpm test` — the new empty-field cases FAIL
  (`err.code` is not `3`; today the empty request reaches the INSERT), while all pre-existing cases
  pass green (proving the de-cloak, not a silent skip).
- GREEN (after Step 3): `cd services/xstockstrat-notify && pnpm test` — all cases pass.
- Coverage + lint: `cd services/xstockstrat-notify && pnpm run lint && pnpm run test:coverage` — confirm the 40% threshold passes.

---

### Step 5 — docs: MCP-tool docstrings, mcp-tools.md, merge-order entry

**Status**: `completed`
**Service**: `docs/` + `xstockstrat-agent` (docstring-only, no behavior)
**Files**:
- `services/xstockstrat-agent/app/tools.py` — modify (two docstrings only)
- `docs/runbooks/mcp-tools.md` — modify
- `docs/roadmap/features/merge-order.md` — modify

**Reviewers**: none (docs category). *(Advisory: the xstockstrat-agent owner's focus — MCP tool
contract stability and `mcp-tools.md` parity — applies to the docstring/runbook edits.)*

**Codebase Evidence**:
- `ingest_signal` docstring, stale line: `services/xstockstrat-agent/app/tools.py:215-216` —
  "A value > 1.0 is not caught here and fails downstream as INTERNAL, not INVALID_ARGUMENT."
- `emit_alert` docstring, stale lines: `tools.py:274-275` — "title/body: stored and delivered verbatim
  with NO server-side validation — empty strings are accepted and delivered blank, so populate both."
- `mcp-tools.md` — `conviction` parameter row at `:200`; `ingest_signal` error table at `:216-217`;
  `emit_alert` section header at `:222`; the "no server-side validation" claim at `:244`.
- `merge-order.md` — Blocking Dependencies table header at `:22-23`; the "How to add an entry manually"
  procedure at the file tail. The 092↔094 collision is a rebase/reconcile note, not a hard block
  (identical-intent compile-first flip) — record it so `/sdd-review impl-spec` overlap scan confirms.

**TDD**: `N/A (docs — no behavior change; docstrings and runbook prose only)`.

**Instructions**:
1. `tools.py:215-216` (`ingest_signal`): replace the "A value > 1.0 is not caught here and fails
   downstream as INTERNAL" sentence with the new contract — out-of-range (`< 0.0` or `> 1.0`) or `NaN`
   conviction is rejected `INVALID_ARGUMENT` at the ingest boundary; an omitted or `0.0` conviction is
   stored NULL (unchanged). Keep the existing "no source default" statement.
2. `tools.py:274-275` (`emit_alert`): replace "stored and delivered verbatim with NO server-side
   validation — empty strings are accepted and delivered blank" with: empty (or whitespace-only)
   `title`/`body` are rejected `INVALID_ARGUMENT` by notify; populate both.
3. `mcp-tools.md`: update the `conviction` row (`:200`) to note out-of-range/`NaN` → `INVALID_ARGUMENT`
   (keeping the absent/`0.0` → NULL invariant); add a conviction out-of-range row to the `ingest_signal`
   error table (`:216-217`) — `Out-of-range or NaN conviction | invalid argument (INVALID_ARGUMENT)`;
   update the `emit_alert` "no server-side validation" claim (`:244`) to state empty/whitespace-only
   title or body → `INVALID_ARGUMENT`.
4. `merge-order.md`: add a Blocking table row (or a note under it, since this is rebase-only not a hard
   block) recording the 092↔094 collision on `notify/package.json` + `notifyServiceImpl.test.ts` —
   identical-intent compile-first flip; whichever lands second rebases to the union of the two added
   test cases (092: EmitAlert descriptor-parity; 094: empty-field validation). Set **Resolved: No**.

**Verification**:
- `grep -n "INVALID_ARGUMENT" services/xstockstrat-agent/app/tools.py` — confirm both updated docstrings mention it; `grep -n "not caught here" services/xstockstrat-agent/app/tools.py` returns nothing.
- `grep -n "INVALID_ARGUMENT\|whitespace" docs/runbooks/mcp-tools.md` — confirm the conviction and emit_alert rows reflect the new behavior; `grep -n "no server-side validation" docs/runbooks/mcp-tools.md` returns nothing.
- `grep -n "094\|input-validation" docs/roadmap/features/merge-order.md` — confirm the 092↔094 entry.
- Lint (tools.py touched): `cd services/xstockstrat-agent && ruff check . && ruff format --check .`

---

## Deviation Log

### D-1 — Step 2 RED mechanics refined for a clean RED (not a deviation from scope)
The `/sdd-review impl-spec` pass noted that RED cases using a bare `MagicMock()` `_db` would go RED
via an *await-on-MagicMock* `TypeError` rather than the asserted abort-miss. Step 2 was authored to
mock the **full happy path** (registry `fetchrow` → INSERT `fetchrow` → `_ledger.AppendEvent`), so in
the pre-guard tree `IngestSignal` runs to completion and `pytest.raises("aborted")` cleanly reports
**DID NOT RAISE**. Verified: 3 abort cases RED before the guard, all 5 green after. No scope change.

### D-2 — notify de-cloak surfaced NO latent red (better than expected)
The design warned (per ledger 074, and config's identical flip which surfaced "1 fails, 1 hangs")
that de-cloaking the never-executed notify suite might surface latent red. It did not: after the
compile-first flip, all **14** pre-existing cases executed and passed green on the first run (19
tests total once the 5 new F-10 cases were added). No remediation was needed, so **no P-03 deviation
was required** and Step 4 stayed a clean 2-file change. The pre-guard run showed exactly the 4
empty/whitespace RED cases failing while every pre-existing case passed — the intended de-cloak proof.

### D-3 — notify inline pool needed an `as any` cast under tsc
Once the harness compiles the test with `tsc` (no longer strip-only), the inline `pool` object
literals passed to `new NotifyServiceImpl(pool, {})` fail the object-literal excess/missing-property
check against the `Pool` type. Cast to `pool as any, {} as any` (same treatment feature 092 applied),
matching the existing `makeImpl` helper. Behavior-neutral; test-only.

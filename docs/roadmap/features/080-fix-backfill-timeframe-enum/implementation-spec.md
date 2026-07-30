# Implementation Spec: fix-backfill-timeframe-enum

**Status**: `pending`
**Created**: 2026-07-30
**Feature**: `docs/roadmap/features/080-fix-backfill-timeframe-enum/feature.md`
**Total Steps**: 8
**Feature Branch**: `feature/fix-backfill-timeframe-enum`

---

## Execution Summary

The chosen approach (`design.md` § Chosen Approach) is four independent service slices plus one data
migration: **ingest** canonicalizes on write and derives the enum on read (FR-13/FR-1/FR-4);
**marketdata** sets `TimeframeEnum` at all four `Bar` construction sites and resolves every raw
timeframe reader (FR-5–FR-7, FR-10, FR-11) and ships its five doc surfaces in the same PR;
**marketdata's `003_*` migration** remediates the recoverable alias rows already at rest (FR-14);
**analysis** fixes the one live-wired producer the round-1 adversary found (FR-9); **ui** adds the
string→enum map in `src/lib/chart.ts`, both `getBars` senders, and the three e2e mock/spec producers
(FR-8, FR-12).

Ordering is driven by one hard constraint only — step 5 (the data migration) must land after step 3,
so the code that stops producing non-canonical labels precedes the cleanup and a backfill running
between them cannot reintroduce a row the migration just fixed. Everything else is parallel-safe: the
four services share no artifact and no proto regeneration occurs.

**Deviation from `design.md` § Step Boundaries (advisory, 7 steps):** design step 6 bundled the
analysis service change with its test. Constitution **C-08** requires every non-frontend `service`
step to have a paired `test` step, so it is split into steps 6 and 7 here — same code, same PRs count
as steps 1/2 and 3/4. Total is therefore 8, not 7. The `ui` step stays single (C-08 scopes pairing to
non-frontend services; its vitest + Playwright work rides in the same step).

**Two product-spec claims corrected here (P-03, `fails.md` 2026-07-29/080 — absence/count claims must
be grep-verified):**
1. FR-10 states the `"15m"` literal "currently appears three times in that function". It appears
   **once**, at `internal/service/marketdata_service.go:514`
   (`grep -n '"15m"' internal/service/marketdata_service.go` → `113` comment, `514`, `661` inside
   `estimateExpectedBars`). The `defaultBarIngestTimeframe` const hoist is still required — after
   FR-10 the literal would be needed at two sites (the `GetString` default and the unresolvable
   fallback) in two different functions — but the justification is *forward*-looking, not "three
   existing occurrences".
2. The `tfpkg` import alias (design § 2) is needed in **`internal/repository` and `internal/alpaca`
   only**. `internal/service` already imports the package plainly as `timeframe`
   (`marketdata_service.go:26`) and uses it at `:120`; its two `timeframe`-parameter functions
   (`:642`, `:711`) never call the package, so nothing there changes.

`/context-scrubber scan` is owed before the integration PR, scoped to the context files step 3 touches
(root `CLAUDE.md` § Teardown). It is wired into step 3's Verification.

## Step Dependencies

- **Step 5 requires Step 3**: the FR-10/FR-11 fixes must be deployed before the data remediation runs,
  or an in-flight backfill or ingest cycle can write a fresh non-canonical row after the migration
  cleans the table (`design.md` § Step Boundaries, last paragraph).
- **Step 2 [test] covers Step 1 [service]** — ingest (C-08).
- **Step 4 [test] covers Step 3 [service]** — marketdata (C-08).
- **Step 7 [test] covers Step 6 [service]** — analysis (C-08).
- **Step 8 [service]** is a frontend step; its vitest + Playwright verification is in-step (C-08's
  pairing rule scopes to non-frontend services).
- Steps 1–2, 3–4–5, 6–7, and 8 touch disjoint file sets and may be executed in any relative order.
- No `proto` step exists (**Proto Contract Changes: none** — both fields already exist:
  `packages/proto/ingest/v1/ingest.proto:30,39`; `packages/proto/marketdata/v1/marketdata.proto:55,57`),
  so `buf lint`/`buf breaking`/`buf-gen.sh` are not required by any step (**C-09** not engaged).

---

### Step 1 — service: ingest — canonicalize the backfill write path and derive `timeframe_enum` on read

**Status**: `pending`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/app/handlers/servicer.py` — modify

**Reviewers**: `xstockstrat-ingest` (service owner) — signal normalization correctness, idempotent ingestion, newsletter source schema stability; specifically the backfill job read path and enum/string parity

**Codebase Evidence**:
- Confirmed via `Read services/xstockstrat-ingest/app/handlers/servicer.py`:
  - `:35` `_STR_TO_ENUM = {"15m": 5, "1h": 3, "1d": 4}`; `:36` `_ENUM_TO_STR = {v: k for k, v in _STR_TO_ENUM.items()}`; `:37-44` `_TF_ALIASES` (`15m/15Min/1h/1Hour/1d/1Day`)
  - `:47-54` `def _canonical_timeframe(request) -> str` — prefers `request.timeframe_enum` via `_ENUM_TO_STR` (`:50-51`), else `_TF_ALIASES.get(request.timeframe, request.timeframe or "1d")` (`:52-54`)
  - `:70-95` `def job_row_to_proto(row: dict) -> ingest_pb2.BackfillJob` — sets `timeframe=row["timeframe"] or ""` at `:75`; **no** `timeframe_enum` assignment anywhere in the function
  - `:149-157` `await backfill_jobs.insert_job(... timeframe=request.timeframe ...)` — the raw persist, `timeframe=request.timeframe` on `:153`
  - `:158-163` `await self._emit_backfill_event("ingest.backfill.queued", job_id, {"symbols": …, "timeframe": request.timeframe}, …)` — raw value into the untyped ledger `Struct` at `:161` (payload built at `:172-173`)
  - `:284` `timeframe = _canonical_timeframe(request)` — inside `_execute_backfill`, i.e. **after** the row exists
  - `:403-410` `_resume_job`: `:407` `enum = row.get("timeframe_enum") or 0`; `:408-410` `timeframe = _ENUM_TO_STR.get(enum) or _TF_ALIASES.get(row.get("timeframe") or "", row.get("timeframe") or "1d")`
  - `:257` and `:431` `tf_enum = _STR_TO_ENUM.get(timeframe, 0)` — the existing `.get(…, 0)` degradation idiom FR-3 reuses
- Confirmed via `grep -n "def insert_job" services/xstockstrat-ingest/app/repositories/backfill_jobs.py` → `:28`; its INSERT lists six columns (`job_id, symbols, timeframe, range_start, range_end, status`) — **no `timeframe_enum` column exists**
- Confirmed via `cat services/xstockstrat-ingest/migrations/003_backfill_jobs.up.sql` → `timeframe TEXT NOT NULL DEFAULT ''`, no CHECK constraint. `get_job` / `list_jobs` are `SELECT *` (`backfill_jobs.py:75,109`), so the mapper's input keys are exactly the DDL columns → `row.get("timeframe_enum")` is permanently `None`
- Confirmed via `grep -rn "job_row_to_proto" services/xstockstrat-ingest/app` → exactly three call sites: `:513` (`GetBackfillStatus`), `:539` (`ListBackfillJobs`), `:583` (`CancelBackfill`) — matches AC-1
- Doc invariant to keep true: `services/xstockstrat-ingest/docs/context-constitution.md:23` cites `servicer.py:32-35` for the deliberate 1m/5m omission — the new helper must be added **after** the map block so that citation still lands on the maps

**TDD**: `red-green required`

**Instructions**:
1. Immediately **after** the `_TF_ALIASES` block (i.e. after `servicer.py:44`, before
   `_canonical_timeframe` at `:47`) add a module-level helper:
   ```python
   def _row_timeframe(stored: str) -> str:
       """Normalize a stored backfill_jobs.timeframe to its canonical spelling.

       The column is TEXT NOT NULL DEFAULT '' with no CHECK constraint
       (migrations/003_backfill_jobs.up.sql), so a legacy row may hold an alias
       ("1Day"). Alias-hop first so the read path resolves exactly what the resume
       path already resolves (FR-1).
       """
       return _TF_ALIASES.get(stored, stored)
   ```
   Do **not** introduce a fourth map — reuse `_TF_ALIASES` and `_STR_TO_ENUM` (FR-1, recon
   § Patterns to REUSE).
2. In `job_row_to_proto` (`:72-83`), add one keyword argument to the `ingest_pb2.BackfillJob(...)`
   constructor, immediately after the existing `timeframe=row["timeframe"] or ""` at `:75`:
   ```python
   timeframe_enum=_STR_TO_ENUM.get(_row_timeframe(row["timeframe"] or ""), 0),
   ```
   Leave `:75` **byte-for-byte unchanged** — the deprecated string keeps its stored value, including a
   non-canonical one (FR-2). The `.get(…, 0)` default is FR-3's non-raising degradation, matching the
   existing idiom at `:257`.
3. FR-13, write path: at `:153` replace `timeframe=request.timeframe` with
   `timeframe=canonical_tf`, where `canonical_tf = _canonical_timeframe(request)` is computed once
   immediately after `job_id = str(uuid.uuid4())` (`:147`) / `propagation_meta = …` (`:148`) and before
   the `insert_job` call. At `:161` replace `"timeframe": request.timeframe` with
   `"timeframe": canonical_tf` so the append-only `ingest.backfill.queued` ledger `Struct` records the
   canonical value (AC-14). This is the FR-2a carve-out — canonicalizing *before* production is
   permitted where the value also feeds the enum; it is signed off in `context.md` § Constitution
   overrides.
   Do **not** touch `:284` (`timeframe = _canonical_timeframe(request)` inside `_execute_backfill`) —
   it stays as the execution-path resolution.
4. FR-4, delete the dead branch: in `_resume_job`, remove line `:407`
   (`enum = row.get("timeframe_enum") or 0`) and replace the `:408-410` expression with
   ```python
   timeframe = _row_timeframe(row.get("timeframe") or "") or "1d"
   ```
   The `or "1d"` preserves today's fallback for a legacy `''` row (FR-3 governs rows written before
   this feature; FR-13 makes `''` unreachable for new rows). **Keep the `_ENUM_TO_STR` map itself**
   (`:36`) — `_canonical_timeframe` reads it at `:50-51` (FR-4's explicit carve-out).
5. Do not add a migration and do not add a column (FR-4 / § Database Changes — the enum is derived).

**Verification**:
```bash
cd services/xstockstrat-ingest && ruff check . && ruff format --check .
# the dead read is gone and no new map was introduced:
grep -n 'timeframe_enum' services/xstockstrat-ingest/app/handlers/servicer.py   # expect the mapper assignment + _canonical_timeframe's getattr only, NOT row.get("timeframe_enum")
grep -c '_STR_TO_ENUM = \|_ENUM_TO_STR = \|_TF_ALIASES = ' services/xstockstrat-ingest/app/handlers/servicer.py  # expect 3
# the doc citation still lands on the maps:
sed -n '32,35p' services/xstockstrat-ingest/app/handlers/servicer.py
```
Then run the Step 2 suite (`cd services/xstockstrat-ingest && uv run pytest`) — it must go green here
after being red before this step.

---

### Step 2 — test: ingest — paired string+enum assertions on all three read paths, plus the write-path and ledger criteria

**Status**: `pending`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/tests/_helpers.py` — create
- `services/xstockstrat-ingest/tests/test_ingest_servicer.py` — modify
- `services/xstockstrat-ingest/tests/test_cancel_backfill.py` — modify

**Reviewers**: `xstockstrat-ingest` (service owner) — signal normalization correctness, idempotent ingestion, newsletter source schema stability

**Codebase Evidence**:
- Confirmed via `grep -n "_job_row\|timeframe_enum" services/xstockstrat-ingest/tests/test_ingest_servicer.py`:
  `:66` `def _job_row(job_id, status, **over) -> dict` (15 keys, `"timeframe": "1d"`); consumers at
  `:102,103,117,140,505`; **`:506` `job_row["timeframe_enum"] = 4  # TIMEFRAME_1DAY`** — the key the
  database cannot produce (AC-4)
- Confirmed via `grep -n "_job_row" services/xstockstrat-ingest/tests/test_cancel_backfill.py`:
  `:33` a byte-identical `_job_row` (no docstring), consumed at `:75,76,99` to drive `CancelBackfill`
  — the third AC-1 read path (recon Risk 5; the product spec names only `test_ingest_servicer.py`)
- Confirmed existing read-path assertions are string/status-only:
  `test_ingest_servicer.py:138-145` `TestGetBackfillStatus.test_returns_job_when_found` asserts
  `result.job_id` and `result.status` and nothing about timeframe — this is the AC-5 red-before-green
  evidence (recon Risk 7)
- Confirmed via `sed -n '248,271p' services/xstockstrat-ingest/tests/test_ingest_servicer.py`:
  `:248` `class TestTriggerBackfill`, `:250` `test_inserts_queued_row_and_emits_queued_event` already
  patches `insert_job` and inspects `insert.await_args.kwargs["status"]` (`:266`) and the emitted
  `event_type` list (`:269-270`) — the exact seams AC-13 and AC-14 need
- Confirmed the request stub shape: `:287` `_CHUNKS = "app.repositories.backfill_chunks"`,
  `:290-299` `_make_backfill_req(symbols, timeframe="1d")` sets `req.timeframe_enum = 0` at `:294`
- Confirmed `tests/__init__.py` exists and `pyproject.toml:30-32` sets `testpaths = ["tests"]`, so a
  sibling `tests/_helpers.py` is importable as `tests._helpers` and is not collected as a test module
- **jscpd note**: `.jscpd.json` ignores `**/tests/**` and `**/test_*.py`, so the duplicated `_job_row`
  is **not** a DRY-gate violation. The shared helper is justified by AC-4 (one fixture that matches
  the real row shape, so the two read-path suites cannot drift), not by the pre-commit hook

**TDD**: `red-green required`

**Instructions**:
1. Create `services/xstockstrat-ingest/tests/_helpers.py` containing one function, `job_row`, whose
   body is the current `test_ingest_servicer.py:66-88` `_job_row` verbatim (the 15-key dict + `**over`
   update). Move **only** `job_row` — do not move `make_servicer` / `_make_servicer`: the two servicer
   factories differ in name, signature and body and are not duplicates
   (`design.md` § Rejected Alternatives).
2. In `test_ingest_servicer.py`: delete `_job_row` (`:66-88`), add
   `from tests._helpers import job_row as _job_row` to the import block, and **delete line `:506`**
   (`job_row["timeframe_enum"] = 4`) so the resume fixture drives the real row shape (AC-4). That
   `test_resume_job_redrives_incomplete_chunks` (`:500`) still passes is the evidence the FR-4 branch
   was dead.
3. In `test_cancel_backfill.py`: delete `_job_row` (`:33-52`) and import the shared one the same way.
4. Add to `test_ingest_servicer.py` a `TestJobRowTimeframeEnum` class covering AC-2 and AC-3 with
   **paired** assertions and **hardcoded** expected enums (never `_STR_TO_ENUM[...]` — computing the
   expectation from the mapper under test asserts nothing and can never go red;
   `fails.md` 2026-07-29/074):
   - parametrized over `("15m", 5)`, `("1h", 3)`, `("1d", 4)`: build the row with
     `_job_row("j", ingest_pb2.BACKFILL_STATUS_COMPLETED, timeframe=<str>)`, call
     `job_row_to_proto(row)` (import it from `app.handlers.servicer`), assert **both**
     `job.timeframe == <str>` and `job.timeframe_enum == <int>`
   - legacy alias: `timeframe="1Day"` → `job.timeframe_enum == 4` **and**
     `job.timeframe == "1Day"` (unchanged — FR-2)
   - unmappable / empty: `timeframe=""` and `timeframe="10Min"` → `job.timeframe_enum == 0`, no
     exception raised, `job.timeframe` echoed unchanged
5. Extend the three read paths to assert the enum end-to-end (AC-1), so parity is proven per RPC and
   not only on the shared mapper:
   - `test_ingest_servicer.py:138` `TestGetBackfillStatus.test_returns_job_when_found` — add
     `assert result.timeframe_enum == 4` (the fixture's `"1d"`) alongside the existing assertions
   - `test_ingest_servicer.py:100` `TestListBackfillJobs.test_returns_all_jobs_when_no_filter` — add
     `assert [j.timeframe_enum for j in resp.jobs] == [4, 4]`
   - `test_cancel_backfill.py` — in the cancel-success test that consumes `:75,76`, add
     `assert result.timeframe_enum == 4` on the returned `BackfillJob`
6. AC-13 — add `TestTriggerBackfill.test_enum_only_request_persists_canonical_string`: build a request
   whose `timeframe` is `""` and whose `timeframe_enum` is `ingest_pb2`-side value `5`
   (`TIMEFRAME_15MIN`) — mirroring what the UI actually sends (`backfills/page.tsx:112` passes
   `timeframeEnum` with no string) — patch `insert_job`, call `TriggerBackfill`, and assert
   `insert.await_args.kwargs["timeframe"] == "15m"`. Assert on the value passed to `insert_job`, never
   on a hand-built row.
7. AC-14 — in the same class, assert the emitted ledger payload: locate the `AppendEvent` call whose
   `event_type == "ingest.backfill.queued"` in `svc._ledger.AppendEvent.call_args_list` (the pattern
   already used at `:269-270`) and assert
   `MessageToDict(call.args[0].payload)["timeframe"] == "15m"` for the same enum-only request. This is
   the untyped `Struct` surface no lint or type check covers.

**Verification**:
```bash
cd services/xstockstrat-ingest && ruff check . && ruff format --check . \
  && uv run pytest --cov=app --cov-fail-under=40
```
Confirm coverage ≥ 40% (CI `python-test` matrix, `.github/workflows/ci.yml:337-339`,
`cov_source: app`). Red-before-green: run this suite against the pre-Step-1 tree and record the
failing output — the new `timeframe_enum` assertions must fail (today `TimeframeEnum` is never set and
`row.get("timeframe_enum")` is read from a column that does not exist).

---

### Step 3 — service: marketdata — `TimeframeEnum` at all four `Bar` sites, resolve every raw reader, and the five doc surfaces

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/repository/marketdata_repo.go` — modify
- `services/xstockstrat-marketdata/internal/alpaca/client.go` — modify
- `services/xstockstrat-marketdata/internal/alpaca/stream.go` — modify
- `services/xstockstrat-marketdata/internal/service/marketdata_service.go` — modify
- `services/xstockstrat-marketdata/internal/timeframe/timeframe.go` — modify (package doc only)
- `services/xstockstrat-marketdata/CLAUDE.md` — modify
- `services/xstockstrat-marketdata/docs/context-constitution.md` — modify

**Reviewers**: `xstockstrat-marketdata` (service owner) — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency; specifically the four `Bar` producer sites and the `TIMEFRAME_1MIN` labelling call for streamed bars (product-spec FR-6)

**Codebase Evidence**:
- The four `Bar` construction sites, repo-wide sweep confirmed
  (`grep -rn "TimeframeEnum" services/xstockstrat-marketdata --include=*.go | grep -v /gen/` returns
  **exactly one** hit today — `internal/service/marketdata_service.go:120`, request side):
  - `internal/repository/marketdata_repo.go:112-124` — DB read path inside `QueryBars`; `Timeframe: tf`
    at `:115`, where `tf` is the scanned `timeframe` column (declared `:102`, scanned `:109`)
  - `internal/alpaca/client.go:199-204` — single-symbol `GetBars`; `Timeframe: timeframe` at `:203`
  - `internal/alpaca/client.go:305-310` — multi-symbol `GetBarsMulti`; `Timeframe: timeframe` at `:309`
  - `internal/alpaca/stream.go:255-260` — WS `dispatch` (`:251`); `Timeframe: streamBarTimeframe` at `:259`
  - `client.go:270` is `map[string][]*marketdatav1.Bar{}` — an empty map literal, not a site
- Vocabulary package (reuse target, no new mapping table):
  `internal/timeframe/timeframe.go` — `ToCanonical:25`, `Interval:43`, `FromString:59`, `Resolve:76`.
  Imports are stdlib + `commonv1` only (`:16-21`) → importing it from `internal/alpaca` /
  `internal/repository` cannot create a cycle
- `FromString("1m")` returns `TIMEFRAME_UNSPECIFIED` **by design** — `:67-71`
  (`"1m"/"1Min"/"5m"/"5Min" are intentionally unrecognized`). `streamBarTimeframe = "1m"` is declared
  at `stream.go:28` with the rationale at `:23-27`; its only reader is `:259`
- Identifier shadowing (recon Risk 1): `timeframe` is already a parameter at
  `internal/alpaca/client.go:161` (`GetBars`), `:268` (`GetBarsMulti`), and
  `internal/repository/marketdata_repo.go:73` (`QueryBars`), plus the `source` interface
  (`internal/source/source.go:15,18,27`) → both files need the `tfpkg` import alias.
  `internal/service` is **not** affected: it already imports the package plainly as `timeframe`
  (`marketdata_service.go:26`) and its two `timeframe`-parameter functions (`:642` `estimateExpectedBars`,
  `:711` `StartBarStream`) never call it
- `internal/alpaca/client.go:18` already imports `commonv1`; `internal/alpaca/stream.go:3-15` does
  **not** (needed for the explicit `TIMEFRAME_1MIN`). `internal/repository` does not import `commonv1`
  and does not need to — `tfpkg.FromString(tf)` returns the enum type without naming it
- FR-11 `BackfillBars` (`marketdata_service.go:567`) reads `req.Timeframe` raw at exactly three sites,
  each carrying `//nolint:staticcheck // SA1019`, and never calls `Resolve`:
  `:590` (ledger `map[string]interface{}` payload), `:602` (`src.GetBars(ctx, sym, req.Timeframe, …)`,
  whose bars are persisted by `InsertBars` at `:611`), `:633`
  (`estimateExpectedBars(req.Symbols, req.Timeframe, …)`)
- FR-10 `ingestRecentBars` (`marketdata_service.go:500`): `:514`
  `tf := s.cfg.GetString("marketdata.stream.bar_ingest_timeframe", "15m")` — raw string, passed to
  `GetBarsMulti` at `:523` and `GetBars` at `:538`, whose bars are persisted at `:528` / `:546`
- The pattern `GetBars` already uses — resolve-with-raw-fallback, never error —
  `marketdata_service.go:118-122`:
  `legacyTf := req.Timeframe`; `canonicalTf := legacyTf`;
  `if c, rErr := timeframe.Resolve(req.GetTimeframeEnum(), legacyTf); rErr == nil { canonicalTf = c }`
- `resolveIngestTimeframe` and `barFromAlpaca` are **new symbols** — they do not exist today
  (**F-04**, flagged in `design.md` § Constitution Rules Touched)
- Alpaca JSON shapes for the shared builder: `alpacaBar` at `client.go:125-134`;
  `alpacaBarsResponse.Bars []alpacaBar` at `:136-140`; `multiBarsResponse.Bars map[string][]alpacaBar`
  at `:260-263`
- Const convention in `internal/service`: function-local (`const defaultIntervalMs = 30000` at `:390`,
  `= 60000` at `:471`). `defaultBarIngestTimeframe` must be **package-level** because two functions
  reference it
- Deprecated-symbol suppression precedent: `internal/timeframe/timeframe_test.go:67-68` and
  `internal/alpaca/client_test.go:359` already carry `//nolint:staticcheck // SA1019`. Lint is
  golangci-lint v2.5.0 with `staticcheck` enabled (`.golangci.yml:4-8`). Design records that
  `TIMEFRAME_1MIN` **does** trip SA1019, verified by running the repo's linter against a probe — this
  will be the tree's first deprecated-value *write*
- The live `StreamBars` raw reader is `internal/handler/marketdata_handler.go:258`;
  `:42` is the **dead** Connect handler — `cmd/server/main.go:153` registers only `hdl.GRPCHandler()`.
  **Both stay unchanged** (design Open Risk 3: excluded on reachability — `StreamBarsRequest` has zero
  producers)
- **Not in the family, no action** (design § Readers sweep): `marketdata_service.go:288,330`
  (`resolveDeletePlan` takes `tf commonv1.Timeframe` — already the enum, which is why neither carries a
  `//nolint`); `marketdata_repo.go:59` `InsertBars` (the DB column *is* the string, so it must stay
  string-driven — this is the mechanism that makes FR-10/FR-11 data-correctness rather than labelling)
- Doc surfaces:
  - `services/xstockstrat-marketdata/CLAUDE.md:17` — ends "the enum values remain in the proto for wire
    compatibility but are **unused**", which FR-6 falsifies
  - `services/xstockstrat-marketdata/CLAUDE.md:61` — the `marketdata.stream.bar_ingest_timeframe` row,
    whose behavior FR-10 changes
  - `internal/timeframe/timeframe.go:10-13` — the package doc's 1MIN/5MIN paragraph
  - `docs/context-constitution.md:14` **MARKETDATA-1** — evidence cites `write-back :203`, the exact
    line the shared builder replaces
  - `docs/context-constitution.md:15` **MARKETDATA-2** — evidence cites `stream.go:28,259`; `:259`
    line-shifts, and streamed bars now carry an enum while still not being persisted (recon Risk 8)
  - Adjacent invariant not to disturb: **MARKETDATA-5** (`docs/context-constitution.md:18`) — the
    documented pause sentinel is `bar_ingest_interval_ms <= 0` (`marketdata_service.go:484`), *not* a
    bogus timeframe. This is the mitigation the FR-10 accepted risk rests on

**TDD**: `red-green required`

**Instructions**:
1. **`internal/alpaca/client.go`** — add `tfpkg "github.com/xstockstrat/marketdata/internal/timeframe"`
   to the import block (goimports `local-prefixes` group, `.golangci.yml:15-18`). Add one shared
   builder near `alpacaBarsResponse` (`:136-140`), implementing ledger insight 2026-07-09 ("a
   cross-path per-item transform gets one builder, not a copy per path"):
   ```go
   // barFromAlpaca maps one decoded Alpaca bar to a proto Bar. Shared by the single- and
   // multi-symbol REST paths so the deprecated string and its timeframe_enum replacement
   // are set in exactly one place (feature 080).
   func barFromAlpaca(symbol string, b alpacaBar, t time.Time, timeframe string) *marketdatav1.Bar {
       return &marketdatav1.Bar{
           Symbol: symbol, Time: timestamppb.New(t),
           Open: b.O, High: b.H, Low: b.L, Close: b.C,
           Volume: b.V, Vwap: b.VW, TradeCount: b.N,
           Timeframe: timeframe, Source: "alpaca",
           TimeframeEnum: tfpkg.FromString(timeframe),
       }
   }
   ```
   Replace the literal at `:199-204` with `allBars = append(allBars, barFromAlpaca(symbol, b, t, timeframe))`
   and the literal at `:305-310` with `out[sym] = append(out[sym], barFromAlpaca(sym, b, t, timeframe))`.
   The deprecated `Timeframe` string keeps its current value at both sites (FR-7).
2. **`internal/repository/marketdata_repo.go`** — add
   `tfpkg "github.com/xstockstrat/marketdata/internal/timeframe"` to the import block and add exactly
   one field to the existing `&marketdatav1.Bar{...}` literal, after `Source: source` (`:123`):
   `TimeframeEnum: tfpkg.FromString(tf),`. Do **not** restructure the `rows.Next()` loop — the
   `barRow.toBar()` extraction was rejected as overbuild (`design.md` § Rejected Alternatives).
   Leave `InsertBars`' `b.Timeframe` read at `:59` (and its `//nolint`) untouched.
3. **`internal/alpaca/stream.go`** — add
   `commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"` to the import block, and in
   `dispatch`'s `case "b"` (`:253-261`) add to the `Bar` literal:
   ```go
   // A streamed bar genuinely IS a 1-minute bar. timeframe.FromString("1m") returns
   // UNSPECIFIED by design (sub-15m intervals were removed so callers *requesting* them
   // error), so route nothing through it here — label explicitly. common.proto:74-76
   // retains TIMEFRAME_1MIN precisely so already-produced, non-ingested data stays
   // describable. This changes the LABEL only: streamed bars are still never persisted
   // (MARKETDATA-2) — the enum does not make them storable.
   TimeframeEnum: commonv1.Timeframe_TIMEFRAME_1MIN, //nolint:staticcheck // SA1019: deliberate write of the retained deprecated member — see comment above (feature 080 FR-6)
   ```
   Keep `Timeframe: streamBarTimeframe` (`"1m"`) unchanged (FR-7) and do **not** modify
   `timeframe.FromString` — its refusal of `"1m"` is load-bearing for request resolution.
4. **`internal/service/marketdata_service.go`**, FR-11 `BackfillBars`: after the `start`/`end`
   normalization (`:568-582`) and **before** the `emitEvent` at `:588`, resolve once using the same
   raw-fallback shape as `GetBars:118-122`:
   ```go
   legacyTf := req.Timeframe //nolint:staticcheck // SA1019: string timeframe read during one-release deprecation window (053)
   canonicalTf := legacyTf
   if c, rErr := timeframe.Resolve(req.GetTimeframeEnum(), legacyTf); rErr == nil {
       canonicalTf = c
   }
   ```
   Then use `canonicalTf` at all three former raw sites and delete the now-unneeded `//nolint` from
   each: `:590` `"timeframe": canonicalTf`; `:602` `src.GetBars(ctx, sym, canonicalTf, start, end)`;
   `:633` `estimateExpectedBars(req.Symbols, canonicalTf, start, end)`. This makes an enum-only
   `BackfillBars` request work (AC-11) and stops a `"1Day"` caller writing rows `GetBars` can never
   find. Keep the raw fallback rather than erroring — deliberate, for consistency with `GetBars`
   (design Open Risk 2).
5. **`internal/service/marketdata_service.go`**, FR-10: add a package-level const beside the new
   helper and a pure resolver, placed directly above `ingestRecentBars` (`:496-500`):
   ```go
   // defaultBarIngestTimeframe is the declared default of
   // marketdata.stream.bar_ingest_timeframe (see the service CLAUDE.md config table).
   const defaultBarIngestTimeframe = "15m"

   // resolveIngestTimeframe canonicalizes the configured bar-ingest timeframe. Bars fetched
   // with this value are PERSISTED (InsertBars), so an out-of-vocabulary config value would
   // write rows that no GetBars query can ever match (MARKETDATA-1). Empty means "not
   // configured" and falls back silently; a non-empty unresolvable value falls back and WARNs
   // once per cycle. The documented way to pause ingestion is
   // bar_ingest_interval_ms <= 0 (MARKETDATA-5), never a bogus timeframe.
   func resolveIngestTimeframe(raw string) string {
       if raw == "" {
           return defaultBarIngestTimeframe
       }
       if c, err := timeframe.Resolve(commonv1.Timeframe_TIMEFRAME_UNSPECIFIED, raw); err == nil {
           return c
       }
       slog.Warn("bar ingest: unresolvable bar_ingest_timeframe, using default",
           "configured", raw, "default", defaultBarIngestTimeframe)
       return defaultBarIngestTimeframe
   }
   ```
   Change `:514` to
   `tf := resolveIngestTimeframe(s.cfg.GetString("marketdata.stream.bar_ingest_timeframe", defaultBarIngestTimeframe))`.
   `commonv1` is already imported (`:18`) and `log/slog` at `:6`. Leave `:523`/`:538` call sites and
   the `:540` warn unchanged — they now receive a canonical `tf`. **Accepted risk, recorded in the
   product spec** (§ Accepted Risks) and design Open Risk 1: this is the one place the feature can
   *cause* a write rather than merely label one.
6. **Docs, in this same PR** (root `CLAUDE.md` § Teardown — the execute loop has no co-merge
   mechanism, so docs are not a trailing step):
   - `CLAUDE.md:17` — replace the trailing clause "the enum values remain in the proto for wire
     compatibility but are **unused**" with a statement that `TIMEFRAME_1MIN` is no longer unused: it
     is the explicit label on live-streamed (never-persisted) bars, while remaining unresolvable for
     *requests*.
   - `CLAUDE.md:61` — extend the `bar_ingest_timeframe` description: the value is now canonicalized
     through `internal/timeframe`; an unresolvable value falls back to `15m` with a WARN each cycle
     (and the pause sentinel remains `bar_ingest_interval_ms <= 0`).
   - `internal/timeframe/timeframe.go:10-13` — keep "callers sending them get an
     unresolvable-timeframe error" (still true for resolution) and add that `TIMEFRAME_1MIN` is still
     *set* directly by the WS stream path to describe already-produced 1-minute bars.
   - `docs/context-constitution.md:14` **MARKETDATA-1** — repoint the `write-back :203` evidence at the
     new `barFromAlpaca` helper and re-check the `marketdata_repo.go:88,147` line references after the
     edit.
   - `docs/context-constitution.md:15` **MARKETDATA-2** — update the `stream.go:28,259` line reference
     and state that streamed bars now carry `TIMEFRAME_1MIN` **and still must not be persisted**; the
     enum is a label, not a storability signal (recon Risk 8).

**Verification**:
```bash
cd services/xstockstrat-marketdata && GOWORK=off golangci-lint run --modules-download-mode=mod
cd services/xstockstrat-marketdata && GOWORK=off go build ./...
# all four Bar sites now set the enum (expect 4 hits in non-gen source, plus the request-side :120):
grep -rn "TimeframeEnum" services/xstockstrat-marketdata --include=*.go | grep -v /gen/ | grep -v _test.go
# BackfillBars no longer reads the raw string at the three former sites:
sed -n '585,640p' services/xstockstrat-marketdata/internal/service/marketdata_service.go
# the excluded readers are untouched:
grep -n "req.Timeframe" services/xstockstrat-marketdata/internal/handler/marketdata_handler.go  # expect :42 and :258 unchanged
```
Then, per root `CLAUDE.md` § Teardown, run `/context-scrubber scan` scoped to
`services/xstockstrat-marketdata/CLAUDE.md` and
`services/xstockstrat-marketdata/docs/context-constitution.md`, and fix the grounded findings before
opening this step's PR. If the context-forge plugin is unavailable in the session, say so in the PR
body rather than skipping silently. Finally run the Step 4 suite — it must go green here.

---

### Step 4 — test: marketdata — paired enum assertions on the REST paths, a new in-package stream test, and the FR-10 resolver cases

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/alpaca/client_test.go` — modify
- `services/xstockstrat-marketdata/internal/alpaca/stream_test.go` — create
- `services/xstockstrat-marketdata/internal/timeframe/timeframe_test.go` — modify
- `services/xstockstrat-marketdata/internal/service/marketdata_service_test.go` — modify

**Reviewers**: `xstockstrat-marketdata` (service owner) — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence**:
- `internal/alpaca/client_test.go` is `package alpaca_test` (`:1`) — **external**, so it cannot reach
  `dispatch` or `streamBarTimeframe` (recon Risk 3). There is **no** `stream_test.go` in
  `internal/alpaca/` (`ls internal/alpaca/` → `client.go`, `client_test.go`, `stream.go`), so AC-7
  needs a new `package alpaca` file
- Extension point for AC-6: `client_test.go:320` `TestGetBars_TranslatesCanonicalTimeframe`, table at
  `:325-333` (`{"15m","15Min"}, {"1h","1Hour"}, {"1d","1Day"}, {"15Min","15Min"}, {"1Hour","1Hour"}` —
  note **no `1Day` input row today**), stored-bar assertion at `:359` already carrying
  `//nolint:staticcheck // SA1019`
- `client_test.go:448` `TestGetBarsMulti_Success` exists and calls `GetBarsMulti(..., "1Day", ...)` at
  `:471` — the direct multi-path seam AC-6 needs
- `internal/timeframe/timeframe_test.go` is `package timeframe` (`:1`) with
  `TestFromString:10`, `TestInterval:35`, `TestToCanonical:56`, `TestResolve:78`, `TestComputeGaps:93`;
  the deprecated-member cases at `:67-68` carry `//nolint:staticcheck // SA1019`
- `internal/service/marketdata_service_test.go` is `package service` (`:1`) — in-package, so the new
  unexported `resolveIngestTimeframe` is reachable. Existing pure-helper tests:
  `TestEstimateExpectedBars:17`, `TestDefaultBarLookback:59`, `TestResolveDeletePlan:94`
- **Coverage attribution** (design Open Risk 6): `.github/workflows/ci.yml:241` builds `COVERPKGS` as
  `go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)'`, so the `service` and
  `repository` changes earn **zero** coverage credit; the 40% threshold
  (`ci.yml:199-200`) is carried by `internal/alpaca` and `internal/timeframe`. The `service` tests here
  are for correctness, not the gate
- `TimeframeEnum` appears in **zero** Go tests repo-wide today (recon Risk 7) — the AC-5
  red-before-green evidence for this service

**TDD**: `red-green required`

**Instructions**:
1. `client_test.go` — add a third field `wantEnum commonv1.Timeframe` to
   `TestGetBars_TranslatesCanonicalTimeframe`'s case struct (`:325-333`), add a `{"1Day", "1Day", …}`
   input row, and fill every row with a **hardcoded** expected enum
   (`15m`/`15Min` → `Timeframe_TIMEFRAME_15MIN`, `1h`/`1Hour` → `…_1HOUR`,
   `1d`/`1Day` → `…_1DAY`). Extend the assertion at `:358-361` to check `bars[0].TimeframeEnum` paired
   with the existing `bars[0].Timeframe` check. Import
   `commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"` if absent.
   **Do not** compute the expectation by calling `timeframe.FromString` — the expectation must not come
   from the mapper the implementation calls, or the assertion can never go red
   (`fails.md` 2026-07-29/074; AC-6's explicit rule).
2. `client_test.go` — extend `TestGetBarsMulti_Success` (`:448`) to assert, for the `"1Day"` request it
   already makes at `:471`, that each returned bar carries `Timeframe == "1Day"` **and**
   `TimeframeEnum == commonv1.Timeframe_TIMEFRAME_1DAY` (hardcoded), with a
   `//nolint:staticcheck // SA1019` on the deprecated-string read, matching `:359`.
3. Create `internal/alpaca/stream_test.go` as **`package alpaca`** (in-package — required to reach
   `dispatch` and `streamBarTimeframe`). Add `TestDispatchBarCarries1MinEnum`: construct a
   `streamManager` with a bar subscriber, call `dispatch(&streamMessage{T: "b", S: "AAPL", Time: "2024-01-02T10:00:00Z", …})`,
   read the fanned-out bar, and assert `bar.Timeframe == "1m"` **and**
   `bar.TimeframeEnum == commonv1.Timeframe_TIMEFRAME_1MIN` (hardcoded; `//nolint:staticcheck // SA1019`
   on both, matching `timeframe_test.go:67`). Inspect `stream.go`'s `streamManager` / `fanoutBar` to
   build the smallest subscriber that receives the bar; if no in-package constructor makes this
   reachable without restructuring `stream.go`, **block the step and escalate** (P-03) rather than
   changing production code to create a seam.
4. `internal/timeframe/timeframe_test.go` — add `TestFromStringTotality`: assert that every member of
   the supported vocabulary maps as expected and that `FromString("1m")` **still** returns
   `Timeframe_TIMEFRAME_UNSPECIFIED` (AC-7's second half — proving the request-resolution refusal is
   provably untouched by FR-6's labelling change). Keep the `//nolint` style of `:67-68`. This test also
   carries the coverage credit for the step (design Open Risk 6).
5. `internal/service/marketdata_service_test.go` — add `TestResolveIngestTimeframe` covering AC-10's
   three cases directly: `""` → `"15m"`; each resolvable alias (`"1Day"`, `"1Hour"`, `"15Min"`, and the
   canonical spellings) → its canonical form; an unresolvable value (`"10Min"`) → `"15m"`. Assert the
   WARN fires for the unresolvable case only — install a `slog` handler that records records (e.g.
   `slog.SetDefault` with a capturing handler, restored via `t.Cleanup`) and assert exactly one
   `LevelWarn` record for `"10Min"` and **zero** for `""` and for a resolvable alias. The paired
   "something *does* change" assertion is what stops an inert harness reading as a pass
   (`insights.md` 2026-07-27, teeth test).

**Verification**:
```bash
cd services/xstockstrat-marketdata && GOWORK=off golangci-lint run --modules-download-mode=mod
cd services/xstockstrat-marketdata && GOWORK=off \
  COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') \
  && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" \
  && go tool cover -func=coverage.out | grep "^total:"
```
Confirm ≥ 40% (CI `go-test` matrix, `.github/workflows/ci.yml:199-200`). **Note in the step's
context.md entry**: the FR-10/FR-11 changes live in `internal/service` and the DB-site one-liner in
`internal/repository`, both excluded from `COVERPKGS` (`ci.yml:241`) — they earn no coverage credit;
their tests exist for correctness and the threshold is carried by `internal/alpaca` +
`internal/timeframe`. Red-before-green: run this command against the pre-Step-3 tree — every new
`TimeframeEnum` assertion and `TestResolveIngestTimeframe` must fail (or fail to compile, since
`resolveIngestTimeframe` does not yet exist).

---

### Step 5 — migration: marketdata — canonicalize the recoverable non-canonical `ohlcv.timeframe` rows already at rest

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/migrations/003_canonicalize_ohlcv_timeframe.up.sql` — create
- `services/xstockstrat-marketdata/migrations/003_canonicalize_ohlcv_timeframe.down.sql` — create

**Reviewers**: DBA — migration NNN numbering (no gaps, no conflicts), up+down pair present, hypertable partitioning strategy, index correctness, run-order compliance with `scripts/db-migrate.sh`; `xstockstrat-marketdata` (service owner) — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence**:
- Confirmed via `ls services/xstockstrat-marketdata/migrations/`: `000_schema`, `001_marketdata_hypertables`,
  `002_fundamentals` (each `.up.sql` + `.down.sql`). Last number is **002**, so this is `003_*`
  (**C-07**); `002_fundamentals` and everything before it are applied and must not be edited (**F-01**)
- Confirmed via `cat migrations/001_marketdata_hypertables.up.sql`:
  `marketdata.ohlcv` columns are `time, symbol, timeframe, open, high, low, close, volume, vwap,
  trade_count, source`; **`PRIMARY KEY (symbol, timeframe, time)`**; `create_hypertable('marketdata.ohlcv','time', chunk_time_interval => INTERVAL '1 day')`;
  indexes `idx_ohlcv_symbol_time`, `idx_ohlcv_timeframe_time`. The PK confirms a bare `UPDATE` of
  `'1Day'`→`'1d'` **can** collide when both spellings exist for the same `(symbol, time)`
- The alias vocabulary to remediate is exactly `internal/timeframe/timeframe.go:59-72`'s recoverable
  set: `'15Min'`→`'15m'`, `'1Hour'`→`'1h'`, `'1Day'`→`'1d'`
- Out of remediation scope (product spec FR-14): `timeframe=''` rows (intent unrecoverable) and
  `'1m'` rows (a **MARKETDATA-2** anomaly — streamed bars are never persisted). Counted, not rewritten
- `timeframe` is **not** the hypertable partitioning column (`time` is), so an `UPDATE` of `timeframe`
  never moves a row between chunks
- Runner: `scripts/db-migrate.sh` (golang-migrate v4.17.1), `migrate_service "xstockstrat-marketdata" "marketdata"`
  at `:130`; migration state is tracked per service in a `<schema>_schema_migrations` table in
  `public` (built by `service_db_url()` at `:35-48` as `x-migrations-table=marketdata_schema_migrations`).
  **The script supports only `up | version | force`** (`:64-93`, error text at `:92`) — there is no
  `down` sub-command, so the down-migration round trip must be driven by invoking `migrate` directly
  with the same `x-migrations-table` parameter
- `docs/patterns/database.md` and `docs/runbooks/approval-flow.md`: a DB migration needs DBA +
  service-owner approval — this one mutates stored market data

**TDD**: `N/A (migration — no unit-testable code path; verified by the executed SQL checks below)`

**Instructions**:
1. Create `003_canonicalize_ohlcv_timeframe.up.sql`. Open with a header comment recording: the purpose
   (feature 080 FR-14), that it is a **data remediation with no schema change to `ohlcv`**, that
   `ohlcv` is a TimescaleDB hypertable partitioned on `time` — so rewriting `timeframe` (a PK column
   but not the partitioning column) never relocates a row across chunks — and that the migration
   deliberately does **not** claim to leave the table fully canonical: only that no *recoverable*
   non-canonical row remains.
2. Create the remediation log **first**, in the `marketdata` schema. It exists so the `.down.sql` is a
   real, faithful reverse rather than a no-op:
   ```sql
   CREATE TABLE IF NOT EXISTS marketdata.ohlcv_remediation_003 (
     op             TEXT        NOT NULL,   -- 'update' | 'delete'
     time           TIMESTAMPTZ NOT NULL,
     symbol         TEXT        NOT NULL,
     old_timeframe  TEXT        NOT NULL,
     new_timeframe  TEXT,                   -- NULL for 'delete'
     open  NUMERIC(18,8), high NUMERIC(18,8), low NUMERIC(18,8), close NUMERIC(18,8),
     volume BIGINT, vwap NUMERIC(18,8), trade_count INTEGER, source TEXT,
     PRIMARY KEY (symbol, old_timeframe, time)
   );
   ```
3. **Collision decision — resolve it as delete-the-alias-duplicate, and state the reasoning in the
   file** (design Open Risk 5 requires picking one of skip-if-canonical-exists / delete-then-update and
   justifying it): where both an alias row and its canonical twin exist for the same
   `(symbol, time)`, the **canonical row is authoritative** — it is the row `QueryBars` has been able
   to read all along (`marketdata_repo.go:88` filters `WHERE timeframe=$2` on the canonical string) and
   the one the always-on ingester keeps fresh; the alias row is data no reader could ever see.
   Skip-if-canonical-exists was rejected because it would leave `'1Day'` in
   `SELECT DISTINCT timeframe`, failing AC-15. So, in order:
   a. `DELETE` alias rows that have a canonical twin, logging the **full** row (all value columns) into
      `ohlcv_remediation_003` with `op='delete'` — use `DELETE … RETURNING` inside a CTE feeding
      `INSERT INTO marketdata.ohlcv_remediation_003 …` so the log and the delete cannot diverge.
   b. `UPDATE` the remaining alias rows to their canonical spelling, logging `op='update'` with
      `old_timeframe`/`new_timeframe` (value columns left NULL — the row itself is unchanged) via the
      same `UPDATE … RETURNING` + CTE shape.
   Drive both from a single alias→canonical mapping expressed once in the file (e.g. a
   `VALUES ('1Day','1d'),('1Hour','1h'),('15Min','15m')` CTE joined on `timeframe`), not three
   copy-pasted statement pairs.
4. Create `003_canonicalize_ohlcv_timeframe.down.sql`: re-insert every `op='delete'` row back into
   `marketdata.ohlcv` from the log, revert every `op='update'` row's `timeframe` from `new_timeframe`
   back to `old_timeframe`, then `DROP TABLE marketdata.ohlcv_remediation_003`. Add a comment stating
   the limitation explicitly: the reverse is faithful **only** because the up migration logged what it
   changed — without that log a merged `'1d'` row would be indistinguishable from one that was always
   canonical, so a log-free down migration could not restore the original spelling.
5. Do not edit any existing migration (**F-01**) and do not change the `ohlcv` schema, indexes, or
   hypertable settings.

**Verification**:
```bash
export DATABASE_URL=postgres://xstockstrat:<password>@localhost:5432/xstockstrat?sslmode=disable
MD_URL="${DATABASE_URL}&x-migrations-table=marketdata_schema_migrations"   # matches db-migrate.sh service_db_url()
MD_DIR=services/xstockstrat-marketdata/migrations

# 0. SEED both remediation branches, so neither goes unexercised on a fresh DB. A migration
#    whose remediation branch never ran is a claim, not a check (fails.md 2026-07-29 / 079).
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO marketdata.ohlcv (time,symbol,timeframe,open,high,low,close,volume,source) VALUES
  ('2024-01-02T00:00:00Z','ZZTEST','1Day',1,1,1,1,1,'seed'),   -- collides with the row below
  ('2024-01-02T00:00:00Z','ZZTEST','1d',  2,2,2,2,2,'seed'),   -- canonical twin: authoritative
  ('2024-01-03T00:00:00Z','ZZTEST','1Hour',3,3,3,3,3,'seed'),  -- no twin → plain UPDATE
  ('2024-01-04T00:00:00Z','ZZTEST','1m',  4,4,4,4,4,'seed'),   -- out of remediation scope
  ('2024-01-05T00:00:00Z','ZZTEST','',    5,5,5,5,5,'seed')    -- out of remediation scope
ON CONFLICT DO NOTHING;
SQL
psql "$DATABASE_URL" -t -c "SELECT timeframe, count(*) FROM marketdata.ohlcv GROUP BY 1 ORDER BY 1;" > /tmp/080-before.txt

# 1. apply
./scripts/db-migrate.sh
./scripts/db-migrate.sh version                  # marketdata must report 3

# 2. AC-15 part 1 — no RECOVERABLE non-canonical value survives (expect zero rows):
psql "$DATABASE_URL" -c "SELECT DISTINCT timeframe FROM marketdata.ohlcv WHERE timeframe IN ('1Day','1Hour','15Min');"

# 3. AC-15 part 2 — residuals REPORTED with counts, not silently left. Paste both outputs
#    into context.md (the '' and '1m' rows must appear with their counts).
psql "$DATABASE_URL" -c "SELECT timeframe, count(*) FROM marketdata.ohlcv GROUP BY 1 ORDER BY 1;"
psql "$DATABASE_URL" -c "SELECT op, count(*) FROM marketdata.ohlcv_remediation_003 GROUP BY 1;"
#    expect one 'delete' (the ZZTEST 1Day collision) and one 'update' (the ZZTEST 1Hour row)

# 4. the .down.sql is a real reverse, not a no-op — prove the round trip:
migrate -path "$MD_DIR" -database "$MD_URL" down 1
psql "$DATABASE_URL" -t -c "SELECT timeframe, count(*) FROM marketdata.ohlcv GROUP BY 1 ORDER BY 1;" > /tmp/080-reverted.txt
diff /tmp/080-before.txt /tmp/080-reverted.txt   # must be empty: deletes restored, labels reverted
psql "$DATABASE_URL" -c "\dt marketdata.ohlcv_remediation_003"   # must be gone

# 5. re-apply and clean up the seed
./scripts/db-migrate.sh
psql "$DATABASE_URL" -c "DELETE FROM marketdata.ohlcv WHERE symbol='ZZTEST'; DELETE FROM marketdata.ohlcv_remediation_003 WHERE symbol='ZZTEST';"
```

---

### Step 6 — service: analysis — the live evaluation loop sends the canonical string plus the enum

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/engine/live_loop.py` — modify

**Reviewers**: `xstockstrat-analysis` (service owner) — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Confirmed via `sed -n '123,128p' services/xstockstrat-analysis/app/engine/live_loop.py`:
  ```python
  async def _eval_pair(self, definition, symbol, throttle):
      bars_resp = await self._marketdata.GetBars(
          marketdata_pb2.GetBarsRequest(
              symbol=symbol, timeframe="1Day", range=self._recent_range()
          )
      )
  ```
  `timeframe="1Day"` at `:126` — the deprecated string only, in the **non-canonical** spelling, and no
  `timeframe_enum`
- Its two already-migrated siblings, in the same service, send canonical `"1d"` **plus** the enum:
  - `app/handlers/servicer.py:590-591` — `timeframe="1d",  # canonical: matches the backfill path's stored "1d" bars` / `timeframe_enum=common_pb2.Timeframe.TIMEFRAME_1DAY`
  - `app/services/screener.py:169-170` — same pair
- `common_pb2` is already imported in `live_loop.py` (`:22` `from gen.common.v1 import common_pb2`,
  used by `_recent_range` at `:116-121`) — no new import is needed
- Live-wired, so this is not latent: `app/main.py:98,116` construct and start the loop

**TDD**: `red-green required`

**Instructions**:
Change the `GetBarsRequest` at `live_loop.py:124-127` to
```python
symbol=symbol,
timeframe="1d",
timeframe_enum=common_pb2.Timeframe.TIMEFRAME_1DAY,
range=self._recent_range(),
```
The string change `"1Day"` → `"1d"` is deliberate and is the FR-2a carve-out to FR-2's byte-for-byte
rule (user sign-off recorded in `context.md` § Constitution overrides): leaving the third caller on the
Alpaca spelling preserves the exact `1Day`-vs-`1d` divergence `internal/timeframe` exists to kill
(**MARKETDATA-1**), and both siblings already send `"1d"`. Match their formatting so the three sites
read identically. Change nothing else in `_eval_pair`.

**Verification**:
```bash
cd services/xstockstrat-analysis && ruff check . && ruff format --check .
# all three analysis GetBars producers now agree:
grep -rn -A3 "GetBarsRequest(" services/xstockstrat-analysis/app | grep -n "timeframe"
```
Then run the Step 7 suite — it must go green here.

---

### Step 7 — test: analysis — pin the live loop's `GetBars` request to the canonical string + enum

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_live_loop.py` — modify

**Reviewers**: `xstockstrat-analysis` (service owner) — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Confirmed via `grep -n "GetBars\|def test_\|class Test" services/xstockstrat-analysis/tests/test_live_loop.py`:
  `:16` imports `marketdata_pb2`; the harness stubs `loop._marketdata.GetBars = AsyncMock(...)` at
  `:47,82,199,207,223,240,255,275`; `_bar_at` builds a real `marketdata_pb2.Bar` at `:28-29`;
  `:59` `class TestLiveEvaluationLoopStateTracking`, `:61` `test_entry_exit_edge_triggered`. **No test
  asserts anything about the outbound request** today — the AC-5 red-before-green evidence for this
  service
- The exact assertion pattern to mirror, already pinning the two migrated siblings —
  `tests/test_analysis_servicer.py:218-220`:
  ```python
  called_req = svc._marketdata.GetBars.await_args.args[0]
  assert called_req.timeframe == "1d"
  assert called_req.timeframe_enum == common_pb2.Timeframe.TIMEFRAME_1DAY
  ```

**TDD**: `red-green required`

**Instructions**:
Add a test (e.g. `TestLiveEvaluationLoopRequestShape.test_getbars_sends_canonical_string_and_enum`)
that drives one `_eval_pair` iteration through the existing harness — reuse the fixture shape at
`:40-57` and `_bar_at` at `:28` — then asserts on the **captured request**, exactly as
`test_analysis_servicer.py:218-220` does:
```python
called_req = loop._marketdata.GetBars.await_args.args[0]
assert called_req.timeframe == "1d"
assert called_req.timeframe_enum == common_pb2.Timeframe.TIMEFRAME_1DAY
```
Use the **hardcoded** enum constant, not a value derived from the code under test (AC-9,
`fails.md` 2026-07-29/074). Import `common_pb2` from `gen.common.v1` if the file does not already.

**Verification**:
```bash
cd services/xstockstrat-analysis && ruff check . && ruff format --check . \
  && uv run pytest --cov=app --cov-fail-under=40
```
Confirm coverage ≥ 40% (CI `python-test` matrix, `.github/workflows/ci.yml:340-342`). Red-before-green:
run against the pre-Step-6 tree — the `timeframe == "1d"` assertion must fail on the current `"1Day"`
and the `timeframe_enum` assertion on the current unset zero value.

---

### Step 8 — service: ui — the `chart.ts` string→enum map, both `getBars` senders, and the three e2e producers

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/chart.ts` — modify
- `services/xstockstrat-ui/src/lib/chart.test.ts` — create
- `services/xstockstrat-ui/src/components/trader/ChartPanel.tsx` — modify
- `services/xstockstrat-ui/src/app/insights/market/[symbol]/page.tsx` — modify
- `services/xstockstrat-ui/e2e/mock-backend.ts` — modify
- `services/xstockstrat-ui/e2e/trader/chart-panel.spec.ts` — modify
- `services/xstockstrat-ui/e2e/insights/backfills.spec.ts` — modify
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify

**Reviewers**: `xstockstrat-ui` (service owner) — Trading UI correctness, analytics display accuracy, config mutation safety, Connect-RPC call safety, environment scope correctness, no secret values rendered in UI, no direct DB access (except audit log); specifically the two `getBars` senders and DRY — the string→enum map must live only in `src/lib/chart.ts`

**Codebase Evidence**:
- `src/lib/chart.ts` is the declared single source of truth for this vocabulary (`:1-3` comment cites
  `docs/patterns/dry-guard-rail.md`): `export type Timeframe = '15Min' | '1Hour' | '1Day'` at `:9`,
  `TIMEFRAMES` at `:11-15`, `Bar` at `:17-24`, structural `RawBar` at `:26-33`, `mapBars` at `:36-47`.
  The file has **zero import statements** today
- Its only two importers are the two senders:
  - `src/components/trader/ChartPanel.tsx:9` `import { type Timeframe, TIMEFRAMES, mapBars } from '@/lib/chart';`
    — the `getBars` call is at `:56-60` and `timeframe: tf` at `:58` (`tf` is `fetchBars`' param, `:51`)
  - `src/app/insights/market/[symbol]/page.tsx:11` `import { type Timeframe, TIMEFRAMES, type Bar, mapBars } from '@/lib/chart';`
    — the `getBars` call is the one-liner at `:32`:
    `.getBars({ symbol, timeframe, page: { pageSize: 300 } })`
- **Name-clash correction (recon Risk 6 — the product spec's FR-8 cites the wrong precedent):**
  `src/app/insights/backfills/page.tsx:18` is a **bare** import
  (`import { Timeframe } from '@xstockstrat/proto/common/v1/common_pb';`), *not* an aliased one. The
  real aliasing precedent is `src/hooks/useOrders.ts:3`
  (`import { TradingMode as PbTradingMode } from '@xstockstrat/proto/common/v1/common_pb';`); also
  `usePortfolio.ts:3`, `components/trader/OrderForm.tsx:8`. The clash is *introduced* by this feature,
  inside `chart.ts`
- `Record<Timeframe, PbTimeframe>` type-checks: `backfills/page.tsx:20` uses the proto `Timeframe` in
  type position and `:76` in type **and** value position (`useState<Timeframe>(Timeframe.TIMEFRAME_1DAY)`)
- Vitest: `vitest.config.ts` — `environment: 'node'` (`:9`), `include: ['src/**/*.test.ts']` (`:10`),
  coverage `include: ['src/lib/**']` (`:15`), `all: false` (`:25`), thresholds 40 (`:26-29`).
  `src/lib/chart.ts` is in scope. Precedent for a unit test importing generated proto types under
  vitest: `src/lib/equityCurve.test.ts`; simplest pure-logic shape: `src/lib/protoTime.test.ts`
- e2e producers (FR-12):
  - `e2e/mock-backend.ts:305-335` `getBars` handler — two bars, each `timeframe: '1Day'`
    (`:318`, `:330`) and **no** `timeframeEnum`. `'1Day'` is a shape the real service cannot emit: it
    resolves to canonical `'1d'` before querying (`marketdata_service.go:118-122`)
  - `e2e/trader/chart-panel.spec.ts:22` and `:54` — hand-rolled request bodies
    `JSON.stringify({ symbol: 'AAPL', timeframe: '1Day', limit: 100 })`, a seventh producer
  - `e2e/insights/backfills.spec.ts:16-30` `runningJob()` — the **inverse** mismatch:
    `timeframeEnum: 'TIMEFRAME_1DAY'` at `:27` with **no** `timeframe`, which after Step 1 is a shape
    the service can no longer produce
  - `INVENTORY.md:47` `| OHLCV bars / assets | e2e/mock-backend.ts (getBars, listAssets) |` and
    `:54` `| Backfill jobs | e2e/insights/backfills.spec.ts (runningJob() factory) |`
- **Not in the family, no action**: `e2e/mock-backend.ts:621` and `e2e/fixtures/backtests.ts:60` use
  `timeframe: 4` — that is `CoverageGap.timeframe`, declared
  `xstockstrat.common.v1.Timeframe timeframe = 2` (`packages/proto/analysis/v1/analysis.proto:53`),
  already the enum with no deprecated string sibling
- **C-12**: `design.md` § Constitution Rules Touched records the assessment — **no new fixture module
  is forced**. The mock bars are an existing inline literal in one handler and `runningJob()` an
  existing single-site factory; `INVENTORY.md`'s "migrate opportunistically" policy (`:38-40`) is
  advisory, not mandatory, and this feature adds no second consumer. `INVENTORY.md` records the shape
  change only. `chart-panel.spec.ts`'s bodies are request payloads, not domain fixtures
- **e2e cannot observe FR-8** (recon Risk 11): `e2e/mock-backend.ts:306`'s `getBars(...)` handler takes
  no request argument, so no Playwright test can assert the new outbound field. AC-8 is a vitest-level
  guarantee

**TDD**: `red-green required`

**Instructions**:
1. `src/lib/chart.ts` — add the map beside `TIMEFRAMES` (`:11-15`), aliasing the **proto** symbol
   because the local `Timeframe` union is exported and imported by both senders (renaming it would
   ripple), following the `useOrders.ts:3` precedent:
   ```ts
   import { Timeframe as PbTimeframe } from '@xstockstrat/proto/common/v1/common_pb';

   // The deprecated GetBarsRequest.timeframe string is scheduled for removal; senders must
   // populate timeframe_enum too, or timeframe.Resolve(UNSPECIFIED, "") errors and the chart
   // goes blank. Mapped type, not a lookup object: a fourth Timeframe member fails tsc here
   // rather than silently skipping the enum (feature 080 FR-8/AC-8).
   export const TIMEFRAME_ENUM: Record<Timeframe, PbTimeframe> = {
     '15Min': PbTimeframe.TIMEFRAME_15MIN,
     '1Hour': PbTimeframe.TIMEFRAME_1HOUR,
     '1Day': PbTimeframe.TIMEFRAME_1DAY,
   };
   ```
   Add **no** second map anywhere else (DRY guard rail; the ui reviewer's named focus).
2. `ChartPanel.tsx` — extend the `@/lib/chart` import at `:9` with `TIMEFRAME_ENUM` and add
   `timeframeEnum: TIMEFRAME_ENUM[tf],` immediately after `timeframe: tf,` at `:58`.
3. `insights/market/[symbol]/page.tsx` — extend the `@/lib/chart` import at `:11` with
   `TIMEFRAME_ENUM` and change `:32` to
   `.getBars({ symbol, timeframe, timeframeEnum: TIMEFRAME_ENUM[timeframe], page: { pageSize: 300 } })`.
4. Create `src/lib/chart.test.ts` (vitest, node environment) asserting AC-8 with **hardcoded**
   expectations:
   - each union member maps to its enum: `'15Min'` → `PbTimeframe.TIMEFRAME_15MIN`,
     `'1Hour'` → `…_1HOUR`, `'1Day'` → `…_1DAY`
   - **totality backstop**: `Object.keys(TIMEFRAME_ENUM)` equals `TIMEFRAMES.map(t => t.value)`, so
     adding a fourth interval to `TIMEFRAMES` without extending the map fails the test even if `tsc`
     is not run. The mapped type is the primary guarantee; this is the backstop (AC-8)
   Follow `src/lib/equityCurve.test.ts` for the "unit test importing generated proto types under
   vitest" shape.
5. `e2e/mock-backend.ts` — in the `getBars` handler, change both bars (`:318`, `:330`) to
   `timeframe: '1d'` and add `timeframeEnum: Timeframe.TIMEFRAME_1DAY` (import the enum from
   `@xstockstrat/proto/common/v1/common_pb` in whatever style the file already uses for proto enums),
   so the mock emits the shape the real service actually produces (FR-12, AC-12).
6. `e2e/trader/chart-panel.spec.ts` — in both hand-rolled bodies (`:22`, `:54`) add
   `timeframeEnum: 'TIMEFRAME_1DAY'` alongside the existing `timeframe: '1Day'` (protobuf-es JSON
   accepts the enum's name as a string). Leave the existing property assertions intact; if the mock's
   `'1Day'` → `'1d'` change reddens an assertion, adapt it in this step.
7. `e2e/insights/backfills.spec.ts` — in `runningJob()` (`:16-30`) add `timeframe: '1d'` alongside the
   existing `timeframeEnum: 'TIMEFRAME_1DAY'` at `:27`, so the mocked `BackfillJob` matches what
   Step 1 makes the service emit (AC-12's second half — the inverse of the `Bar` mock's error).
8. `e2e/fixtures/INVENTORY.md` — annotate the `:47` "OHLCV bars / assets" row and the `:54` "Backfill
   jobs" row to record the new shape (bars: canonical `timeframe: '1d'` **plus** `timeframeEnum`;
   backfill jobs: **both** fields), so the next reader sees which shape is authoritative. Add no new
   fixture module (C-12 assessment above).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint && pnpm run build   # build is the tsc gate for Record<Timeframe, PbTimeframe>
cd services/xstockstrat-ui && pnpm run test:coverage            # vitest, scoped src/lib threshold 40 (vitest.config.ts:26-29)
cd services/xstockstrat-ui && pnpm test:e2e -- e2e/trader/chart-panel.spec.ts e2e/insights/backfills.spec.ts
# the map lives in exactly one place:
grep -rn "TIMEFRAME_15MIN\|TIMEFRAME_1HOUR" services/xstockstrat-ui/src --include=*.ts --include=*.tsx | grep -v /lib/chart
# Gate executed against the current tree: it returns exactly backfills/page.tsx:22 and :23
# (that page's own pre-existing TIMEFRAMES list). Any additional hit means a second map was
# added — reject it. ChartPanel.tsx and insights/market/[symbol]/page.tsx must produce zero hits.
# C-12 fixture check:
grep -n "timeframeEnum" services/xstockstrat-ui/e2e/mock-backend.ts services/xstockstrat-ui/e2e/insights/backfills.spec.ts
```
Red-before-green: run `pnpm run test:unit` against the pre-implementation tree — `src/lib/chart.test.ts`
must fail (`TIMEFRAME_ENUM` does not exist).

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._

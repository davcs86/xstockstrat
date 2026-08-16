# Implementation Spec: daily-bars-only

**Status**: `complete`
**Created**: 2026-08-16
**Feature**: `docs/roadmap/features/143-daily-bars-only/feature.md`
**Total Steps**: 10
**Feature Branch**: `feature/daily-bars-only` (per `context.md`, actual commits land on the
harness-assigned `claude/null-fundamentals-ohlcv-gaps-l2v4x5` branch — an explicit, recorded
deviation; this field stays the standard value per the SDD tooling contract)

---

## Execution Summary

Ships proto → `xstockstrat-marketdata` → `xstockstrat-ingest` → `xstockstrat-agent` →
`xstockstrat-ui`, exactly the order `design.md` chose (authoritative RPC layer closes first, so
the always-on ingester and any uncovered caller never have a rejecting-but-unprotected window;
the ingest chunk-retry fix ships in the same step as marketdata's rejection so a permanent
`INVALID_ARGUMENT` never triggers a 3× retry storm). No DB migration ships — historical `15m`/`1h`
rows in `marketdata.ohlcv` are left inert per `design.md`'s explicit rejection of that alternative;
`GetDataCoverage`/`DeleteBackfilledData` stay deliberately permissive so those rows remain
inspectable/deletable by an operator. `internal/timeframe` (Go) is untouched — rejection happens
at the RPC-handler layer using the still-resolvable canonical strings, per `design.md`'s Rejected
Alternatives (that package has a documented defect history — `fails.md` 2026-07-29/30/08-06).

**Corrections this spec makes to `design.md`, each independently verified against the live code
before being written below** (Constitution C-01/P-03 — an unexecuted claim is not evidence):

1. **`plugins/strat-lab/skills/backtest/reference/backfill.md` does not exist as a "same-PR" doc
   target.** `design.md` § Chosen Approach point 4 claims this file "currently document[s] 15m/1h
   as accepted values" alongside `docs/runbooks/mcp-tools.md`. `grep -rniE "15m|1hour|15min|timeframe"
   plugins/` returns zero hits — the file (`plugins/strat-lab/skills/backtest/reference/backfill.md`)
   never mentions a timeframe at all. Only `docs/runbooks/mcp-tools.md` needs the same-PR update
   (Step 7).
2. **`/insights/backfills/page.tsx`'s `TIMEFRAMES` const is shared by two forms with opposite
   requirements, which `design.md` § Chosen Approach point 5 did not account for.** The create-backfill
   form (`:238-248`, FR-5, must narrow to `1d`-only) and the delete-scope form (`:382-393`, FR-5's
   own delete guardrails, which `design.md` § Chosen Approach point 2 keeps **permissive** so an
   operator can still scope-delete historical `15m`/`1h` rows) both render options from the *same*
   `TIMEFRAMES` array. Narrowing it as `design.md` describes would silently remove the operator's
   ability to delete-scope by `15m`/`1h` — contradicting `design.md`'s own explicit
   `DeleteBackfilledData`-stays-permissive decision. Step 9 removes the create-form's select
   entirely (hardcodes `TIMEFRAME_1DAY`) and leaves the delete-scope `TIMEFRAMES` array's 3 entries
   untouched.
3. **Three more tests break than `design.md`'s "four named tests" list covers, found by
   direct grep against each file, not by re-deriving `design.md`'s reasoning:**
   - `services/xstockstrat-ingest/tests/test_ingest_servicer.py::TestTriggerBackfill::test_enum_only_request_persists_canonical_string`
     (`:287-313`) sends `timeframe_enum=5` (`TIMEFRAME_15MIN`) and asserts the job is **queued**
     with `"15m"` persisted — its own premise is inverted by Step 5's new rejection. Not in
     `design.md`'s list at all.
   - `services/xstockstrat-ui/e2e/trader/chart-panel.spec.ts::'1d is the active timeframe by
     default'` (uses `getByRole('tab', {name:'1d'})`) breaks once the selector is removed
     entirely — a **third** breaking test in this file, not the two `design.md`/`recon.md` name.
   - `services/xstockstrat-ui/src/lib/chart.test.ts`'s `'maps each supported timeframe to its
     hardcoded proto enum'` (`:6-9`) asserts `TIMEFRAME_ENUM['15Min']`/`['1Hour']`, which becomes a
     `tsc` error once `Timeframe` narrows to `'1Day'` — a vitest unit test neither `recon.md` nor
     `design.md` mentions.
   This mirrors the exact "count claims are absence claims in disguise" trap `fails.md`
   (2026-07-30, `080-fix-backfill-timeframe-enum`) already names — re-surfaced here rather than
   silently trusted.

## Step Dependencies

- Step 2 requires Step 1: proto-gen regenerates stubs from the edited `.proto`.
- Step 3 requires Step 2: `xstockstrat-marketdata` ships first (design's chosen order).
- Step 4 (test) pairs Step 3.
- Step 5 requires Step 3: ingest's rejection + retry-loop fix must land no earlier than
  marketdata's own rejection (so the retry-storm window design.md accepted stays bounded to a
  single step, not open across a multi-step gap).
- Step 6 (test) pairs Step 5.
- Step 7 requires Step 5 (mirrors ingest's surviving alias set) and Step 2 (regenerated stubs).
- Step 8 (test) pairs Step 7.
- Step 9 requires Step 2 (regenerated TS stubs) — independent of Steps 3-8 otherwise.
- Step 10 (test) pairs Step 9.
- No DB migration step — see Execution Summary.

---

### Step 1 — proto: deprecate `TIMEFRAME_15MIN`/`TIMEFRAME_1HOUR`

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/common/v1/common.proto` — modify

**Reviewers**: Proto Reviewer — field number uniqueness, backward compatibility, `buf lint`/`buf breaking`, `xstockstrat-marketdata` service owner — OHLCV ingestion integrity, `xstockstrat-ui` service owner — Connect-RPC call safety, `xstockstrat-ingest` service owner — signal normalization/backfill correctness, `xstockstrat-agent` service owner — MCP tool contract stability

**Codebase Evidence**:
- Confirmed via Read `packages/proto/common/v1/common.proto:77-84`:
  ```protobuf
  enum Timeframe {
    TIMEFRAME_UNSPECIFIED = 0;
    TIMEFRAME_15MIN = 5; // smallest supported interval
    TIMEFRAME_1HOUR = 3;
    TIMEFRAME_1DAY = 4;
    TIMEFRAME_1MIN = 1 [deprecated = true]; // deprecated: sub-15m intervals removed from the product
    TIMEFRAME_5MIN = 2 [deprecated = true]; // deprecated: sub-15m intervals removed from the product
  }
  ```
- Existing pattern to mirror verbatim: `<value> = <N> [deprecated = true]; // deprecated: <reason>`
  (the `TIMEFRAME_1MIN`/`TIMEFRAME_5MIN` lines above).

**TDD**: `N/A (proto — no test framework for .proto syntax; verified by buf lint/breaking)`

**Instructions**:
Edit `common.proto:79-80` to add the deprecation marker + reason comment to both values, and
update the enum's own doc comment (`:70-76`) so it no longer states "15 minutes is the smallest
supported interval" as a still-requestable fact. Resulting block:
```protobuf
// Timeframe is the canonical OHLCV bar interval, shared by marketdata + analysis + ingest.
// Replaces the free-text "1d"/"1Day"/"1m" strings that previously mismatched across services.
//
// Only TIMEFRAME_1DAY is requestable (feature 143) — GetBars/BackfillBars reject anything
// else. TIMEFRAME_15MIN/TIMEFRAME_1HOUR are deprecated but retained (not deleted, not
// renumbered) for wire compatibility with historically-stored 15m/1h rows, mirroring how
// TIMEFRAME_1MIN/TIMEFRAME_5MIN were already handled when sub-15m intervals stopped being
// selectable.
enum Timeframe {
  TIMEFRAME_UNSPECIFIED = 0;
  TIMEFRAME_15MIN = 5 [deprecated = true]; // deprecated: only 1d is requestable (feature 143)
  TIMEFRAME_1HOUR = 3 [deprecated = true]; // deprecated: only 1d is requestable (feature 143)
  TIMEFRAME_1DAY = 4;
  TIMEFRAME_1MIN = 1 [deprecated = true]; // deprecated: sub-15m intervals removed from the product
  TIMEFRAME_5MIN = 2 [deprecated = true]; // deprecated: sub-15m intervals removed from the product
}
```
Do not change field numbers, remove values, or add `reserved` — this is a comment-only,
non-breaking change (root `CLAUDE.md` § Proto Contract Governance; `docs/runbooks/proto-versioning.md`
"Adding comments or documentation" is always safe).

**Verification**:
```bash
cd packages/proto && buf lint && buf breaking --against ".git#branch=feature/daily-bars-only"
```
Both must pass with zero findings (comment-only change).

---

### Step 2 — proto-gen: regenerate stubs

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/go/common/v1/` — modify (generated)
- `packages/proto/gen/python/common/v1/` — modify (generated)
- `packages/proto/gen/ts/common/v1/` — modify (generated)

**Reviewers**: inherited from Step 1 (Proto Reviewer + `xstockstrat-marketdata`/`xstockstrat-ui`/`xstockstrat-ingest`/`xstockstrat-agent` service owners)

**Codebase Evidence**:
- `./scripts/buf-gen.sh` is the canonical regeneration script (root `CLAUDE.md` § Generating
  Proto Stubs); `docs/runbooks/proto-versioning.md` "Verifying the generated stubs match the
  protos" documents the empty-diff check this step's verification runs.

**TDD**: `N/A (proto-gen — no test framework; verified by an empty/deprecation-only diff)`

**Instructions**:
Run `./scripts/buf-gen.sh` from repo root. Commit only the resulting diff under
`packages/proto/gen/` — expect deprecation-annotation changes in the generated Go comments,
Python `_pb2.py`/`.pyi` stub comments, and the TS `@deprecated` JSDoc tag on the two enum members,
with no field renumbering and no other symbol changes.

**Verification**:
```bash
./scripts/buf-gen.sh
git diff --stat packages/proto/gen/
# Expect only common/v1/* files touched, and only deprecation-comment/annotation lines changed —
# confirm with: git diff packages/proto/gen/common/ | grep -E '^[+-]' | grep -v '^[+-]{3}'
```

---

### Step 3 — service: `xstockstrat-marketdata` rejects non-`1d` `GetBars`/`BackfillBars`, narrows the ingester default

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/service/marketdata_service.go` — modify
- `services/xstockstrat-marketdata/CLAUDE.md` — modify
- `services/xstockstrat-marketdata/docs/context-constitution.md` — modify

**Reviewers**: `xstockstrat-marketdata` service owner — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence**:
- `GetBars` handler: `marketdata_service.go:120-136` — `markWarm` at `:123` runs BEFORE
  `canonicalTf` is resolved (`:131-135`); no rejection today.
- `BackfillBars` handler: `marketdata_service.go:659-696` — `canonicalTf` resolved at `:687-691`,
  `emitEvent("marketdata.backfill.started", ...)` immediately follows at `:693-696`; no rejection
  today.
- Reusable rejection idiom, already used 4× in this same file: `connect.NewError(connect.CodeInvalidArgument, fmt.Errorf(...))`
  (`marketdata_service.go:303,308,314,328` inside `resolveDeletePlan`). `connect` (`connectrpc.com/connect`)
  and `fmt` are both already imported (`:12` and file-top).
- `defaultBarIngestTimeframe` constant + doc comment: `marketdata_service.go:509-520`, currently
  `const defaultBarIngestTimeframe = "15m,1d"`.
- `resolveIngestTimeframes` (`:530-558`) parses a comma-separated list and is
  timeframe-count-agnostic — confirmed no logic change needed for a one-element default (recon.md
  § Patterns to REUSE).
- `GetDataCoverage` (`:242-294`) and `resolveDeletePlan`/`DeleteBackfilledData` (`:296-353`) call
  `timeframe.Resolve`/`timeframe.Resolve` directly on the request's raw `Timeframe` enum field —
  neither goes through the `GetBars`/`BackfillBars` canonicalization+reject path being added here,
  and per `design.md` § Rejected Alternatives ("Rejecting GetDataCoverage too") both stay
  permissive on purpose.
- `services/xstockstrat-marketdata/CLAUDE.md`'s "Timeframe vocabulary" paragraph (Role section)
  and its Config Keys Consumed table row for `marketdata.stream.bar_ingest_timeframe` both
  currently document the `15m,1d` default and 15m-smallest-interval framing that this step
  changes.
- `services/xstockstrat-marketdata/docs/context-constitution.md:15` (`MARKETDATA-2`) documents
  the `15m,1d` default explicitly — a `context-forge`-generated invariant doc this session's
  Teardown rule (root `CLAUDE.md`) requires keeping in sync with the behavior it describes.

**TDD**: `red-green required`

**Instructions**:
1. In `GetBars` (`:120-136`), move the `s.markWarm(req.Symbol)` call (currently `:123`) to
   **after** the `canonicalTf` resolution block and the new reject check — i.e. reorder so the
   function reads: resolve `legacyTf`/`canonicalTf` (unchanged logic, `:131-135`) → reject if
   `canonicalTf != "1d"` → `markWarm` → the rest of the existing body (`pageSize`, range,
   `QueryBars`, live-fallback) unchanged. Insert:
   ```go
   // Feature 143: only "1d" is servable going forward. Reject before markWarm/DB/live-fallback
   // so a rejected request never marks a symbol warm or spends an Alpaca call. GetDataCoverage
   // and DeleteBackfilledData stay deliberately permissive (see their own doc comments) so
   // historical 15m/1h rows remain inspectable/deletable.
   if canonicalTf != "1d" {
       return nil, connect.NewError(connect.CodeInvalidArgument,
           fmt.Errorf("timeframe %q not supported; only \"1d\" is servable", canonicalTf))
   }
   ```
2. In `BackfillBars` (`:659-696`), insert the same check immediately after the `canonicalTf`
   resolution block (`:687-691`) and before `s.emitEvent(ctx, "marketdata.backfill.started", ...)`
   (`:693`) — rejecting before `emitEvent` avoids a started/failed ledger-event pair for a request
   that never touched Alpaca:
   ```go
   // Feature 143: reject anything but "1d" — mirrors GetBars.
   if canonicalTf != "1d" {
       return nil, connect.NewError(connect.CodeInvalidArgument,
           fmt.Errorf("timeframe %q not supported; only \"1d\" is servable", canonicalTf))
   }
   ```
3. Change `defaultBarIngestTimeframe` (`:520`) from `"15m,1d"` to `"1d"`, and rewrite its doc
   comment (`:509-519`) to explain the narrowing (only `1d` is requestable/ingested going
   forward; existing single-value config overrides remain valid since `resolveIngestTimeframes`
   is count-agnostic). Do **not** change `resolveIngestTimeframes` (`:530-558`) or
   `minIngestLookback` (`:560-573`) — both stay generically multi-timeframe-capable, matching
   `recon.md` § Patterns to REUSE.
4. Add a one-line doc-comment note to `GetDataCoverage` (`:242-243`) and to `resolveDeletePlan`
   (`:296-300`) stating explicitly they remain permissive on `15m`/`1h` by design (feature 143),
   so a future engineer does not "fix" the asymmetry as a bug (per `design.md` § Rejected
   Alternatives' explicit ask for this comment).
5. Update `services/xstockstrat-marketdata/CLAUDE.md`:
   - "Timeframe vocabulary" paragraph: append a sentence noting `GetBars`/`BackfillBars` now
     reject any request timeframe other than `1d` (feature 143); `15m`/`1h` remain valid
     *canonical stored strings* for historical rows and for `GetDataCoverage`/
     `DeleteBackfilledData`, just no longer requestable/fetchable going forward.
   - `marketdata.stream.bar_ingest_timeframe` config table row: change the documented default
     from `15m,1d` to `1d` and trim the description's bug-fix-history framing to note the current
     narrowed default (feature 143), keeping the comma-separated-list mechanism description
     (still list-shaped, just one element by default).
   - `marketdata.stream.bar_ingest_lookback_ms` row: the phrase "sized for the 15m entry (default
     15m)" is now stale — update to reference the new `1d` default.
   - Alpaca Integration section's `StartBarIngestPoller` paragraph: update the `(default 15m,1d)`
     mention to `(default 1d)`.
6. Update `services/xstockstrat-marketdata/docs/context-constitution.md`'s `MARKETDATA-2` row:
   change "default `15m,1d`" to "default `1d` (feature 143 narrowed this from `15m,1d`)".

**Verification**:
```bash
cd services/xstockstrat-marketdata && GOWORK=off golangci-lint run --modules-download-mode=mod
```
Plus the paired Step 4 coverage command. Manually confirm (via `git diff`) that `markWarm` in
`GetBars` now executes strictly after the reject check, and that `GetDataCoverage`/
`resolveDeletePlan` are otherwise untouched except for the added doc comment.

---

### Step 4 — test: `xstockstrat-marketdata` rejection coverage

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/service/marketdata_service_test.go` — modify

**Reviewers**: `xstockstrat-marketdata` service owner

**Codebase Evidence**:
- Existing rejection-assertion pattern: `connect.CodeOf(err) != connect.CodeInvalidArgument`
  (e.g. `marketdata_service_test.go:107-108`).
- Existing minimal-construction pattern for a handler-only test:
  `svc := &MarketDataService{registry: reg, ledger: &fakeLedger{}}` (`:725`,
  `TestBackfillBars_EnumOnlyRequestResolves`) — no existing `GetBars` unit test in this file
  (`grep -n "func TestGetBars" ...` = no match), so both new tests are net-new, zero risk to
  existing coverage.
- `fakeLedger` type: `:684`. `source.NewRegistry()`: imported as `"github.com/xstockstrat/marketdata/internal/source"` (`:18`).
- `commonv1`/`marketdatav1` aliases already imported (`:14,16`).

**TDD**: `red-green required`. Run against the pre-Step-3 tree first — both tests fail (GetBars/
BackfillBars currently accept any timeframe) — then re-run after Step 3 lands.

**Instructions**:
Add two new test functions (e.g. after `TestBackfillBars_EnumOnlyRequestResolves` at `:739`):
```go
func TestGetBars_RejectsNon1d(t *testing.T) {
	svc := &MarketDataService{registry: source.NewRegistry(), ledger: &fakeLedger{}}
	req := &marketdatav1.GetBarsRequest{
		Symbol:        "AAPL",
		TimeframeEnum: commonv1.Timeframe_TIMEFRAME_15MIN,
	}
	_, err := svc.GetBars(context.Background(), req)
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("want InvalidArgument, got %v (err=%v)", connect.CodeOf(err), err)
	}
}

func TestBackfillBars_RejectsNon1d(t *testing.T) {
	svc := &MarketDataService{registry: source.NewRegistry(), ledger: &fakeLedger{}}
	req := &marketdatav1.BackfillBarsRequest{
		Symbols:       []string{"AAPL"},
		TimeframeEnum: commonv1.Timeframe_TIMEFRAME_1HOUR,
	}
	_, err := svc.BackfillBars(context.Background(), req)
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("want InvalidArgument, got %v (err=%v)", connect.CodeOf(err), err)
	}
}
```
No new imports required (`commonv1`, `marketdatav1`, `connect`, `source` all already imported in
this file).

**Verification**:
```bash
cd services/xstockstrat-marketdata && GOWORK=off go test ./internal/service/... -run 'TestGetBars_RejectsNon1d|TestBackfillBars_RejectsNon1d' -v
COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//')
GOWORK=off go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"
```
Confirm ≥ 40% and both new tests pass.

---

### Step 5 — service: `xstockstrat-ingest` rejects non-`1d` `TriggerBackfill`, stops retrying permanent rejections

**Status**: `done`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/app/handlers/servicer.py` — modify
- `services/xstockstrat-ingest/app/repositories/backfill_chunks.py` — modify
- `services/xstockstrat-ingest/CLAUDE.md` — modify
- `services/xstockstrat-ingest/docs/context-constitution.md` — modify

**Reviewers**: `xstockstrat-ingest` service owner — signal normalization correctness, idempotent ingestion; its own timeframe alias tables proxy to `BackfillBars`

**Codebase Evidence**:
- `TriggerBackfill` handler: `servicer.py:216-256` — `canonical_tf = _canonical_timeframe(request)`
  at `:234`, immediately followed by `backfill_jobs.insert_job(...)` at `:235`; no rejection today.
- Existing `context.abort` + `return` pattern used throughout this handler, e.g. `:223-225`
  (admin-scope gate).
- `_STR_TO_ENUM = {"15m": 5, "1h": 3, "1d": 4}` (`:93`) is **dual-purposed**: also used by
  `job_row_to_proto` (`:139-168`, via `_ENUM_TO_STR`/`_row_timeframe`) to derive
  `timeframe_enum` for historical/resumed jobs on the read path, and by `_run_chunks` (`:519`,
  `tf_enum = _STR_TO_ENUM.get(timeframe, 0)`) for resumed jobs — confirmed via Read; stays
  **unchanged** (all 3 entries).
- `_TF_ALIASES` (`:95-102`) narrows. Verified via Read that its identity-mapped canonical entries
  (`"15m"→"15m"`, `"1h"→"1h"`) have zero effect on `_row_timeframe`'s `.get(stored, stored)`
  either way — only the alias entries that map a *different* raw spelling to canonical
  (`"15Min"→"15m"`, `"1Hour"→"1h"`, `"1Day"→"1d"`) matter, and dropping `"15Min"`/`"1Hour"` is
  safe because `grep -rn "1Hour\|15Min" services/xstockstrat-ingest/` (source + tests +
  migrations) finds them only as `_TF_ALIASES` dict keys themselves — no test, fixture, or
  migration ever exercises a stored row with those raw spellings (unlike `"1Day"`, which
  `test_legacy_alias_row_resolves_but_string_is_untouched` proves is a real, must-keep case).
  `_canonical_timeframe` (`:116-123`) checks `_ENUM_TO_STR` (derived from the unchanged
  `_STR_TO_ENUM`) **before** falling back to `_TF_ALIASES`, so an enum-carrying request for `15m`
  still canonicalizes correctly to `"15m"` regardless of `_TF_ALIASES`'s contents — the new
  explicit reject check below is what actually gates acceptance, not the alias-table narrowing.
- `_BARS_PER_DAY = {"15m": 26, "1h": 7, "1d": 1}` (`backfill_chunks.py:16`) — its two call sites
  (`:54,77`) both use `.get(timeframe, 1)` with a `1` default, so dropping the `"15m"`/`"1h"` keys
  cannot `KeyError`; confirmed via Read that `plan_chunks` (called only from
  `_plan_work_ranges`→`servicer.py:379-381`, i.e. only when a **new** job is planned, immediately
  after `TriggerBackfill`) will only ever be invoked with `"1d"` once this step's reject check is
  in place — resumed jobs (`_resume_job`, `:490-507`) re-drive already-planned DB chunk rows and
  never call `plan_chunks` again.
- Retry loop: `servicer.py:540-562`, `run_one`'s `try`/`except Exception as e:  # transient RPC
  error — retry the whole chunk` at `:555-557`, guarded by `if not failed or attempt >=
  max_attempts: break` at `:558-559`. `max_attempts` defined `:516-518`.
- `services/xstockstrat-ingest/CLAUDE.md`'s Config Keys table doesn't need a change (no config
  key touched here), but its narrative doesn't currently document the new rejection — add one
  line under the "Authorization" paragraph (Role section) noting `TriggerBackfill` now also
  rejects a non-`1d` timeframe (feature 143), independent of the admin-scope gate.
- `services/xstockstrat-ingest/docs/context-constitution.md:23` documents "`_STR_TO_ENUM` /
  `_BARS_PER_DAY` deliberately omit 1m/5m" — needs a feature-143 addendum since `_BARS_PER_DAY`
  now also omits 15m/1h (while `_STR_TO_ENUM` still does not).

**TDD**: `red-green required`

**Instructions**:
1. In `TriggerBackfill` (`:216-256`), insert immediately after `canonical_tf =
   _canonical_timeframe(request)` (`:234`) and before `await backfill_jobs.insert_job(...)`
   (`:235`):
   ```python
   # Feature 143: only "1d" is a servable timeframe going forward — reject before persisting
   # a job or spending any provider quota. Mirrors marketdata's own GetBars/BackfillBars gate.
   if canonical_tf != "1d":
       await context.abort(
           grpc.StatusCode.INVALID_ARGUMENT,
           f"timeframe {canonical_tf!r} not supported; only '1d' is servable",
       )
       return
   ```
2. Narrow `_TF_ALIASES` (`:95-102`) to:
   ```python
   # Only "1d" is a requestable timeframe going forward (feature 143) — TriggerBackfill's own
   # reject check above is the actual gate (it consults _ENUM_TO_STR first via
   # _canonical_timeframe, so this table's contents don't determine acceptance). This table's
   # remaining job is normalizing the "1Day" legacy spelling for the read path
   # (_row_timeframe) — kept because test_legacy_alias_row_resolves_but_string_is_untouched
   # proves real "1Day" rows exist. "15Min"/"1Hour" are dropped: no test, fixture, or
   # migration in this repo ever exercises those raw spellings as a stored value.
   _TF_ALIASES = {
       "1d": "1d",
       "1Day": "1d",
   }
   ```
   Leave `_STR_TO_ENUM`/`_ENUM_TO_STR` (`:93-94`) **unchanged** — do not touch these two lines;
   they remain the dual-purpose (write validation + historical read) tables.
3. In `backfill_chunks.py:16`, narrow `_BARS_PER_DAY` to `{"1d": 1}`, updating its doc comment
   (`:13-15`) to note `15m`/`1h` density entries were dropped (feature 143 — chunk-planning for a
   now-unrequestable timeframe has no reason to exist; the `.get(timeframe, 1)` default at both
   call sites keeps this safe for any leftover caller).
4. Fix the retry loop (`:555-557`) to stop retrying a permanent rejection immediately:
   ```python
                       except grpc.aio.AioRpcError as e:
                           last_exc = e
                           failed = remaining
                           if e.code() == grpc.StatusCode.INVALID_ARGUMENT:
                               # Permanent rejection (e.g. marketdata's 1d-only gate, feature
                               # 143) — retrying the identical request cannot succeed.
                               attempt = max_attempts
                       except Exception as e:  # transient RPC error — retry the whole chunk
                           last_exc = e
                           failed = remaining
   ```
   (Insert the new `except grpc.aio.AioRpcError` clause **before** the existing broad
   `except Exception`, since Python matches `except` clauses in order and `AioRpcError` is itself
   an `Exception` subclass.)
5. Update `services/xstockstrat-ingest/CLAUDE.md` and
   `services/xstockstrat-ingest/docs/context-constitution.md` per the Codebase Evidence notes
   above.

**Verification**:
```bash
cd services/xstockstrat-ingest && ruff check . && ruff format --check .
```
Plus the paired Step 6 coverage command.

---

### Step 6 — test: `xstockstrat-ingest` rejection + retry-fix + chunk-density coverage

**Status**: `done`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/tests/test_ingest_servicer.py` — modify
- `services/xstockstrat-ingest/tests/test_backfill_chunks.py` — modify

**Reviewers**: `xstockstrat-ingest` service owner

**Codebase Evidence**:
- `test_enum_only_request_persists_canonical_string` (`test_ingest_servicer.py:287-313`) sends
  `req.timeframe_enum = 5` and asserts a `"15m"` job is queued — its premise inverts under Step
  5's new rejection (confirmed via Read; not in `design.md`'s four-test list — see Execution
  Summary correction 3).
  `_ctx` context builder: imported `tests.conftest._ctx` (`:28`); admin scope via `_ctx("4")`
  pattern already used at `:276,305,358`.
- `test_permission_denied_without_admin_scope` (`:324-344`) is the exact pattern to mirror for a
  new rejection test (`ctx.abort.await_args.args[0] == grpc.StatusCode....`).
- `test_no_chunk_exceeds_bar_cap` (`test_backfill_chunks.py:46-54`) calls
  `plan_chunks([...], "1h", ...)` and reads `backfill_chunks._BARS_PER_DAY["1h"]` — this
  `KeyError`s once Step 5 drops `"1h"` from `_BARS_PER_DAY`.
- `test_density_yields_more_chunks_for_15m_than_1d` (`:36-44`) compares chunk counts for `"15m"`
  vs `"1d"` — once `_BARS_PER_DAY` drops `"15m"`, `plan_chunks(..., "15m", ...)` falls back to the
  same `bpd=1` default as `"1d"`, so `len(fifteenmin) > len(oneday)` goes from true to **false**
  (not merely stale — actively wrong once the fallback kicks in), because both use the identical
  `.get(timeframe, 1)` default.
- Retry-loop fix target: `grpc.aio.AioRpcError.__init__` signature confirmed via
  `python3 -c "import grpc.aio, inspect; print(inspect.signature(grpc.aio.AioRpcError.__init__))"`
  → `(self, code, initial_metadata=None, trailing_metadata=None, details=None,
  debug_error_string=None)` — metadata args are optional.
- `test_retry_on_failure_retries_failed_symbols` (`:471-479`) and `test_no_retry_when_disabled`
  (`:481-488`) are the exact pattern to mirror (`patch_chunk_repo`, `_chunk`,
  `_make_backfill_req`, `patch("asyncio.sleep", AsyncMock())`).

**TDD**: `red-green required`. Run each new/modified test against the pre-Step-5 tree first to
confirm it fails for the *new* reason (rejection/retry-fix), not a pre-existing one.

**Instructions**:
1. Rewrite `test_enum_only_request_persists_canonical_string` (`:287-313`) to use the surviving
   timeframe — this preserves the original AC-13/AC-14 regression coverage ("the shape the UI
   actually sends: enum set, string empty") for the timeframe the UI will actually send after
   Step 9:
   ```python
   @pytest.mark.asyncio
   async def test_enum_only_request_persists_canonical_string(self):
       """AC-13/AC-14 — the shape the UI sends post-143: enum set, string empty.

       Asserted on the value handed to `insert_job`, never on a hand-built row —
       hand-built rows are what let this defect hide (fails.md 2026-07-30/080).
       """
       svc = make_servicer(db=MagicMock())
       req = MagicMock()
       req.symbols = ["AAPL"]
       req.timeframe = ""
       req.timeframe_enum = 4  # TIMEFRAME_1DAY, as backfills/page.tsx sends post-143
       req.range = common_pb2.TimeRange()

       with (
           patch("asyncio.create_task"),
           patch(f"{_REPO}.insert_job", AsyncMock()) as insert,
       ):
           await svc.TriggerBackfill(req, _ctx("4"))  # feature 092: admin-scoped

       assert insert.await_args.kwargs["timeframe"] == "1d"
       queued = [
           c.args[0]
           for c in svc._ledger.AppendEvent.call_args_list
           if c.args[0].event_type == "ingest.backfill.queued"
       ]
       assert MessageToDict(queued[0].payload)["timeframe"] == "1d"
   ```
2. Add a new rejection test to `TestTriggerBackfill` (e.g. after `test_admin_scope_queues` at
   `:346-360`):
   ```python
   @pytest.mark.asyncio
   async def test_rejects_non_1d_timeframe(self):
       """Feature 143: only 1d is a servable timeframe — an admin-scoped 15m/1h request is
       still rejected before any job is queued."""
       svc = make_servicer(db=MagicMock())
       req = MagicMock()
       req.symbols = ["AAPL"]
       req.timeframe = ""
       req.timeframe_enum = 5  # TIMEFRAME_15MIN
       req.range = common_pb2.TimeRange()
       context = MagicMock()
       context.abort = AsyncMock(side_effect=Exception("aborted"))
       with (
           patch("asyncio.create_task") as spawn,
           patch(f"{_REPO}.insert_job", AsyncMock()) as insert,
       ):
           with pytest.raises(Exception, match="aborted"):
               await svc.TriggerBackfill(req, context)
       assert context.abort.await_args.args[0] == grpc.StatusCode.INVALID_ARGUMENT
       insert.assert_not_awaited()
       spawn.assert_not_called()
   ```
3. Add a retry-loop regression test (e.g. near `test_no_retry_when_disabled`, `:481-488`):
   ```python
   @pytest.mark.asyncio
   async def test_invalid_argument_stops_retrying_immediately(self):
       """Feature 143: a permanent INVALID_ARGUMENT (e.g. marketdata's 1d-only gate) must not
       be retried — retrying an identical rejected request wastes the full 2s/4s/8s backoff."""
       svc = make_servicer(db=MagicMock(), retry=True, max_retry=2)
       svc._marketdata = MagicMock()
       err = grpc.aio.AioRpcError(grpc.StatusCode.INVALID_ARGUMENT, details="timeframe not supported")
       svc._marketdata.BackfillBars = AsyncMock(side_effect=err)
       with patch_chunk_repo([_chunk(["AAPL"])]), patch("asyncio.sleep", AsyncMock()) as sleep:
           await svc._run_backfill("job-6", _make_backfill_req(["AAPL"]))
       assert svc._marketdata.BackfillBars.await_count == 1  # no retry despite retry=True
       sleep.assert_not_called()
   ```
4. In `test_backfill_chunks.py`, delete `test_density_yields_more_chunks_for_15m_than_1d`
   (`:36-44`) — its premise (`15m` and `1d` produce different chunk densities) is gone now that
   `_BARS_PER_DAY` only defines `"1d"`.
5. Rewrite `test_no_chunk_exceeds_bar_cap` (`:46-54`) to exercise `"1d"` instead of `"1h"`, with a
   cap small enough to force a real multi-chunk split at `bpd=1` (a 90-day window is ~64
   weekdays; `cap=200` with 4 symbols yields `max_syms = 200 // 64 = 3`, splitting the 4 symbols
   into a 3-symbol chunk and a 1-symbol chunk per window):
   ```python
   def test_no_chunk_exceeds_bar_cap(self):
       cap = 200
       chunks = backfill_chunks.plan_chunks(
           ["AAPL", "TSLA", "MSFT", "NVDA"], "1d", _dt(2022, 1, 1), _dt(2024, 1, 1), 90, cap
       )
       bpd = backfill_chunks._BARS_PER_DAY["1d"]
       for c in chunks:
           wk = backfill_chunks._weekdays(c["range_start"], c["range_end"])
           assert len(c["symbols"]) * wk * bpd <= cap or len(c["symbols"]) == 1
   ```

**Verification**:
```bash
cd services/xstockstrat-ingest && ruff check . && ruff format --check . && \
pytest --cov=app --cov-fail-under=40 \
  -k "test_rejects_non_1d_timeframe or test_enum_only_request_persists_canonical_string or test_invalid_argument_stops_retrying_immediately or test_no_chunk_exceeds_bar_cap" -v && \
pytest --cov=app --cov-fail-under=40
```
Confirm all four targeted tests pass and full-suite coverage stays ≥ 40%.

---

### Step 7 — service: `xstockstrat-agent` narrows `trigger_backfill`

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/tools.py` — modify
- `services/xstockstrat-agent/app/client.py` — modify
- `docs/runbooks/mcp-tools.md` — modify
- `docs/runbooks/historical-backfill.md` — modify (per Instructions step 5 below — this file
  was missing from the Files list in an earlier draft of this spec; added during
  `/sdd-review impl-spec` per its Floor-adjacent F-08/F-09 finding, since Instructions step 5
  already required editing it and `/sdd-execute` may only stage files listed here)

**Reviewers**: `xstockstrat-agent` service owner — MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity

**Codebase Evidence**:
- `trigger_backfill` tool definition: `tools.py:856-891` — `timeframe: str = "1d"` param
  (`:860`), docstring `"timeframe: one of 15m/15Min/1h/1Hour/1d/1Day (canonicalized; default
  '1d')."` (`:868`).
- `client.py:988-1046` — `_TF_ALIASES = {"15m": "15m", "15Min": "15m", "1h": "1h", "1Hour": "1h",
  "1d": "1d", "1Day": "1d"}` (`:993`), `_TF_TO_ENUM = {"15m": 5, "1h": 3, "1d": 4}` (`:994`);
  reject gate `if timeframe not in _TF_ALIASES: raise ValueError(...)` (`:1023-1024`); both dicts
  used **only** inside `trigger_backfill` (`grep -n "_TF_ALIASES\|_TF_TO_ENUM"
  services/xstockstrat-agent/app/client.py` → lines 991,993,994,1023,1037,1043 only) — no
  dual-purpose read path here (unlike ingest's `_STR_TO_ENUM`), so full narrowing is safe.
- `docs/runbooks/mcp-tools.md:692` — `| timeframe | string | No | "1d" default; accepts
  15m/15Min/1h/1Hour/1d/1Day (canonicalized) |`.
- **Verified absent**: `plugins/strat-lab/skills/backtest/reference/backfill.md` — confirmed via
  `grep -rniE "15m|1hour|15min|timeframe" plugins/` (zero hits) that this file never documents
  timeframe values; `design.md`'s claim that it needs a same-PR update is incorrect (Execution
  Summary correction 1) — **do not edit this file**.
- **Strat-lab governance rule explicitly checked** (root `CLAUDE.md`'s table: any change to
  `trigger_backfill`'s contract obliges a same-PR update to
  `plugins/strat-lab/skills/backtest/reference/backfill.md`) — this step narrows
  `trigger_backfill`'s accepted `timeframe` values, which is a real contract narrowing, but the
  rule is satisfied vacuously: the target file does not exist and no `plugins/strat-lab/` file
  anywhere mentions timeframe values (grep above), so there is nothing in that plugin to go
  stale. Recorded here (rather than left for a future reviewer to re-derive) per `/sdd-review
  impl-spec`'s WARNING on this exact point.
- **New, ledger-insight-motivated addition**: `docs/runbooks/historical-backfill.md` documents
  `trigger_backfill`'s timeframe parameter (`:112`, `# accepts 15m/15Min/1h/1Hour/1d/1Day`) and a
  whole "Timeframe Guide" section (`:189-209`) plus a large-backfill note (`:230`) that all
  describe `15m`/`1h` as requestable — the "operational runbook" discovery surface the ledger's
  2026-07-20 insight entry (`trigger-backfill-mcp-tool`) names as easy to miss for exactly this
  tool.

**TDD**: `red-green required`

**Instructions**:
1. In `tools.py`, narrow the `trigger_backfill` docstring (`:868`) from
   `"timeframe: one of 15m/15Min/1h/1Hour/1d/1Day (canonicalized; default '1d')."` to
   `"timeframe: '1d' or '1Day' (canonicalized; default '1d'). Only daily bars are supported."`.
   Leave the `timeframe: str = "1d"` default (`:860`) unchanged.
2. In `client.py`, narrow both dicts (`:993-994`):
   ```python
   _TF_ALIASES = {"1d": "1d", "1Day": "1d"}
   _TF_TO_ENUM = {"1d": 4}  # common.v1.Timeframe values
   ```
   Update the mirror-comment above them (`:990-992`) to note the surviving set matches ingest's
   own narrowed `_TF_ALIASES` (Step 5).
3. Update the hardcoded error string at `client.py:1024` from
   `f"unknown timeframe '{timeframe}' (expected 15m/15Min/1h/1Hour/1d/1Day)"` to
   `f"unknown timeframe '{timeframe}' (expected 1d/1Day)"`.
4. Update `docs/runbooks/mcp-tools.md:692`'s `timeframe` parameter row to:
   `| \`timeframe\` | \`string\` | No | \`"1d"\` default; \`"1Day"\` also accepted (canonicalized) — only daily bars are supported |`.
5. Update `docs/runbooks/historical-backfill.md`:
   - `:112` — change `timeframe="1d",                       # accepts 15m/15Min/1h/1Hour/1d/1Day`
     to `timeframe="1d",                       # "1d"/"1Day" only — only daily bars are supported`.
   - `:189-209` ("Timeframe Guide" section) — remove the `15m`/`1h` table rows, keep only `1d`;
     rewrite the "Smallest interval is 15m" callout (`:197-200`) to state daily is the only
     requestable interval and that `TIMEFRAME_15MIN`/`TIMEFRAME_1HOUR` (not just
     `TIMEFRAME_1MIN`/`TIMEFRAME_5MIN`) are now deprecated-and-unrequestable, while noting
     historical `15m`/`1h` rows remain readable via `GetDataCoverage`/deletable via
     `DeleteBackfilledData`.
   - `:218` — remove "density-aware so 15m ranges produce more, smaller chunks than 1d" (no
     longer a real scenario — only `1d` is ever chunk-planned).
   - `:230` — remove "You still choose timeframe per job (run 1d first, then 1h, then 15m if you
     need multiple densities)." entirely (only one timeframe exists to choose).

**Verification**:
```bash
cd services/xstockstrat-agent && ruff check . && ruff format --check .
grep -c "15m\|1Hour\|15Min" docs/runbooks/historical-backfill.md docs/runbooks/mcp-tools.md
# both must report 0 after the edits above (spot-check: neither file should retain a live
# "15m/1h is accepted" claim; historical/deprecation-context mentions are fine if added
# deliberately per the instructions — re-read the diff, don't rely on the grep count alone)
```
Plus the paired Step 8 coverage command.

---

### Step 8 — test: `xstockstrat-agent` `trigger_backfill` narrowing coverage

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_client.py` — modify

**Reviewers**: `xstockstrat-agent` service owner

**Codebase Evidence**:
- `test_trigger_validation_valueerrors` (`test_client.py:515-527`) asserts
  `pytest.raises(ValueError, match="15m/15Min/1h/1Hour/1d/1Day")` at `:520` — breaks once Step 7
  changes the error string. No other test in this file (`grep -n "15m\|1Hour\|15Min"
  services/xstockstrat-agent/tests/test_client.py` → only this one line) uses a `15m`/`1h`
  timeframe value, confirmed via grep — every success-path `trigger_backfill` call in this file
  already uses `"1d"`/`"1Day"` (`:443,463`) or omits `timeframe` (defaults to `"1d"`).

**TDD**: `red-green required`

**Instructions**:
In `test_trigger_validation_valueerrors` (`:515-527`), change line `:520` from
```python
        with pytest.raises(ValueError, match="15m/15Min/1h/1Hour/1d/1Day"):
```
to
```python
        with pytest.raises(ValueError, match="1d/1Day"):
```
No other change needed in this file.

**Verification**:
```bash
cd services/xstockstrat-agent && ruff check . && ruff format --check . && \
pytest --cov=app --cov-fail-under=40 -k test_trigger_validation_valueerrors -v && \
pytest --cov=app --cov-fail-under=40
```

---

### Step 9 — service: `xstockstrat-ui` removes `15Min`/`1Hour` chart and backfill-trigger options

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/chart.ts` — modify
- `services/xstockstrat-ui/src/components/trader/ChartPanel.tsx` — modify
- `services/xstockstrat-ui/src/app/trader/positions/[symbol]/page.tsx` — modify
- `services/xstockstrat-ui/src/app/insights/backfills/page.tsx` — modify

**Reviewers**: `xstockstrat-ui` service owner — Trading UI correctness, Connect-RPC call safety

**Codebase Evidence**:
- `chart.ts:11` `export type Timeframe = '15Min' | '1Hour' | '1Day';`, `:13-17` `TIMEFRAMES`,
  `:23-27` `TIMEFRAME_ENUM` (a `Record<Timeframe, PbTimeframe>` — narrowing `Timeframe` forces
  `tsc` to reject any surviving `'15Min'`/`'1Hour'` key, per its own comment at `:19-22`).
- `ChartPanel.tsx:16` imports `Timeframe`/`TIMEFRAMES`/`TIMEFRAME_ENUM` from `chart.ts`; `:23-26`
  `POLL_INTERVALS_MS: Partial<Record<Timeframe, number>> = { '15Min': 120_000, '1Hour': 900_000
  }`; `:33` `useState<Timeframe>('1Day')`; `:77-82` the auto-refresh `useEffect` keyed off
  `POLL_INTERVALS_MS[timeframe]`; `:119-127` the `Tabs`/`TabsList`/`TabsTrigger` selector rendered
  from `TIMEFRAMES`; `Tabs`/`TabsList`/`TabsTrigger` imported `:17` and used nowhere else in this
  file (confirmed via grep).
- `positions/[symbol]/page.tsx:11` same three imports; `:94`
  `useState<Timeframe>('1Day')`; `:157` `timeframeEnum: TIMEFRAME_ENUM[timeframe]`; `:244-245`
  passes `timeframe={timeframe} onTimeframe={setTimeframe}` into `SymbolPriceChart`; `:338-339`
  that component's own `timeframe`/`onTimeframe` prop types; `:357-364` its `Tabs` selector.
  `Tabs`/`TabsList`/`TabsTrigger` (`:12`) used only at `:357-364` (confirmed via grep).
- `insights/backfills/page.tsx:28,30-34` `const TIMEFRAMES: { label: string; value: Timeframe
  }[] = [...]` (3 entries) is used at **two** distinct sites: `:238-248` (create-backfill form,
  FR-5 scope) and `:382-393` (delete-scope form, which `design.md` keeps permissive — Execution
  Summary correction 2). `:86` `useState<Timeframe>(Timeframe.TIMEFRAME_1DAY)` (create-form
  state) and `:122` `timeframeEnum: timeframe` (the trigger payload) are the create-form's only
  consumers of that state.

**TDD**: `red-green required`

**Instructions**:
1. In `chart.ts`, narrow the type/const set to the single surviving member:
   ```ts
   // Only 1d is supported platform-wide (feature 143) — GetBars/BackfillBars reject any other
   // requested timeframe, and the always-on ingester only ever fetches 1d.
   export type Timeframe = '1Day';

   export const TIMEFRAMES: { value: Timeframe; label: string }[] = [
     { value: '1Day', label: '1d' },
   ];

   export const TIMEFRAME_ENUM: Record<Timeframe, PbTimeframe> = {
     '1Day': PbTimeframe.TIMEFRAME_1DAY,
   };
   ```
   Update the file-header comment (`:7-10`) accordingly.
2. In `ChartPanel.tsx`:
   - Delete `POLL_INTERVALS_MS` (`:23-26`) and the auto-refresh `useEffect` that reads it
     (`:77-82`) entirely — with one surviving timeframe there is nothing to key an
     intraday-vs-daily distinction on.
   - Replace `const [timeframe, setTimeframe] = useState<Timeframe>('1Day');` (`:33`) with
     `const timeframe: Timeframe = '1Day';` (no state — it never changes).
   - Delete the `{/* Timeframe switcher */}` `Tabs`/`TabsList`/`TabsTrigger` block (`:118-127`)
     entirely, and remove the now-unused `Tabs, TabsList, TabsTrigger` import (`:17`).
   - Leave `fetchBars`'s `TIMEFRAME_ENUM[tf]` call and the effect at `:71-74` unchanged (it still
     fires once on mount/symbol/barCount change, just never on a timeframe change since none is
     possible).
3. In `positions/[symbol]/page.tsx`:
   - Replace `const [timeframe, setTimeframe] = useState<Timeframe>('1Day');` (`:94`) with
     `const timeframe: Timeframe = '1Day';`.
   - Remove the `timeframe={timeframe} onTimeframe={setTimeframe}` props passed to
     `SymbolPriceChart` (`:244-245`) and the corresponding `timeframe`/`onTimeframe` prop
     destructuring + type entries on `SymbolPriceChart` (`:328-329,338-339`).
   - Delete the `Tabs`/`TabsList`/`TabsTrigger` block inside `SymbolPriceChart` (`:357-364`) and
     remove the now-unused `Tabs, TabsList, TabsTrigger` import (`:12`).
   - Leave the `getBars({ symbol, timeframe, timeframeEnum: TIMEFRAME_ENUM[timeframe], ... })`
     call (`:153-158`) unchanged — `timeframe` still resolves to `'1Day'`.
4. In `insights/backfills/page.tsx`, per Execution Summary correction 2 — the create-form and
   delete-scope selects need **different** treatment, not one shared narrowing:
   - Remove the create-form's `<select>` block (`:238-248`) entirely (matches `ChartPanel.tsx`'s
     precedent: a single-option selector is removed, not left disabled).
   - Remove `const [timeframe, setTimeframe] = useState<Timeframe>(Timeframe.TIMEFRAME_1DAY);`
     (`:86`); in `handleCreate`'s `trigger.mutate(...)` call (`:119-125`), change
     `timeframeEnum: timeframe,` (`:122`) to `timeframeEnum: Timeframe.TIMEFRAME_1DAY,`.
   - Leave the top-level `TIMEFRAMES` const (`:30-34`, all 3 entries) and the delete-scope
     `<select>` (`:382-393`) **completely unchanged** — `DeleteBackfilledData` stays permissive
     per `design.md`, so an operator must still be able to scope a delete to `15m`/`1h`. Add a
     one-line comment above the `TIMEFRAMES` const noting it is now used only by the delete-scope
     selector (its create-form consumer was removed) and why the three options remain (historical
     rows).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint && pnpm exec tsc --noEmit
```
`tsc` must fail before the change (any surviving `'15Min'`/`'1Hour'` literal against the narrowed
`Timeframe` type is a compile error — this is the totality-backstop mechanism `chart.ts`'s own
comment describes) and pass after. Plus the paired Step 10 e2e/vitest run.

---

### Step 10 — test: `xstockstrat-ui` chart/backfill e2e + vitest coverage

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/trader/chart-panel.spec.ts` — modify
- `services/xstockstrat-ui/src/lib/chart.test.ts` — modify

**Reviewers**: `xstockstrat-ui` service owner

**Codebase Evidence**:
- `chart-panel.spec.ts` — **three** tests break (Execution Summary correction 3, not the two
  `recon.md`/`design.md` name):
  - `'renders the 3 supported timeframe buttons'` (`:129-142`) asserts `['15m','1h','1d']` tabs
    are visible.
  - `'1d is the active timeframe by default'` (`:144-147`) asserts
    `page.getByRole('tab', { name: '1d' })` is visible.
  - `'sends timeframeEnum on the outbound GetBars request (AC-8)'` (`:165-213`) clicks
    `page.getByRole('tab', { name: '1h', exact: true })` (`:207`) to trigger a second, observable
    `GetBars` call distinct from the initial mount's own fetch.
  All three depend on a `tab`-role element existing; Step 9 removes the `Tabs` selector entirely,
  so no `tab`-role element renders at all once fixed.
- `chart.test.ts:6-9` asserts `TIMEFRAME_ENUM['15Min']`/`['1Hour']` — a `tsc` compile error once
  `Timeframe` narrows to `'1Day'` (Execution Summary correction 3).
- `e2e/insights/backfills.spec.ts` spot-checked via `grep -n "1 hour\|15 min\|1 day\|Timeframe\|timeframe"
  e2e/insights/backfills.spec.ts` → only `:90` (`'creating a backfill posts the symbols and
  timeframe'`), which asserts `triggered?.symbols` only, never a `timeframe`/`timeframeEnum`
  value — **no change needed**, confirmed by direct read of the full test body (`:90-105`), not
  assumed from `recon.md`'s "lower risk" framing alone.
- `e2e/fixtures/backfillJobs.ts`'s `backfillJob()` factory already defaults to
  `timeframe: '1d'`/`TIMEFRAME_1DAY` (recon.md § Patterns to REUSE) — no fixture change needed.

**TDD**: `red-green required`

**Instructions**:
1. In `chart-panel.spec.ts`, replace `'renders the 3 supported timeframe buttons'` (`:129-142`)
   with an assertion that no timeframe selector renders at all:
   ```ts
   test('renders no timeframe selector (single 1d-only support, feature 143)', async ({ page }) => {
     // Chart panel loads with the chart card visible but no tab-role timeframe switcher —
     // only 1d is supported platform-wide, so the selector was removed entirely (not left
     // disabled with a single option).
     await expect(page.getByRole('heading', { name: /chart/i })).toBeVisible({ timeout: 10000 });
     await expect(page.getByRole('tab')).toHaveCount(0);
   });
   ```
2. Delete `'1d is the active timeframe by default'` (`:144-147`) entirely — with no `Tabs`
   rendered there is no "active tab" UI state left to assert; its coverage is subsumed by the
   rewritten AC-8 test below (which proves `1d` reaches the wire on load, the behavior that
   actually mattered).
3. Rewrite `'sends timeframeEnum on the outbound GetBars request (AC-8)'` (`:165-213`) to
   intercept the **initial mount's** `GetBars` call instead of a click-triggered one (there is no
   tab left to click):
   ```ts
   test('sends timeframeEnum on the outbound GetBars request (AC-8)', async ({ page }) => {
     // Intercept in-process — proves the CLIENT populates timeframeEnum on its one and only
     // (mount-triggered) GetBars call, now that no tab click can trigger a second request.
     let capturedBody: Record<string, unknown> | undefined;
     await page.route('**/xstockstrat.marketdata.v1.MarketDataService/GetBars', async (route) => {
       capturedBody = route.request().postDataJSON() as Record<string, unknown>;
       await route.fulfill({
         status: 200,
         contentType: 'application/json',
         body: JSON.stringify({
           bars: [
             {
               symbol: 'AAPL',
               open: 188.0,
               high: 190.5,
               low: 187.2,
               close: 189.8,
               volume: '45000000',
               vwap: 189.1,
               tradeCount: 120000,
               timeframe: '1d',
               timeframeEnum: 'TIMEFRAME_1DAY',
               source: 'alpaca',
             },
           ],
         }),
       });
     });

     await page.goto('/trader/');

     await expect
       .poll(() => capturedBody?.timeframeEnum, { timeout: 10000 })
       .toBe('TIMEFRAME_1DAY');
   });
   ```
   (This test's `beforeEach` already navigates to `/trader/` and adds the auth cookie — remove the
   redundant `page.goto('/trader/')` if the surrounding `describe`'s `beforeEach` already ran for
   this test; keep it if this test is moved outside that `describe` block. Route registration
   before `page.goto` is required so the mount's own request is captured, unlike the original
   test which registered the route after the initial mount.)
4. In `chart.test.ts`, replace the first `it` block (`:6-9`):
   ```ts
   it('maps the sole supported timeframe to its proto enum', () => {
     expect(TIMEFRAME_ENUM['1Day']).toBe(PbTimeframe.TIMEFRAME_1DAY);
   });
   ```
   Leave the second `it` (`'covers exactly the TIMEFRAMES set (totality backstop)'`, `:12-14`)
   unchanged — it is generic over `TIMEFRAMES`'s length and still passes with one entry.
5. No change to `e2e/insights/backfills.spec.ts` (confirmed unaffected above).

**Verification**:
```bash
cd services/xstockstrat-ui && \
pnpm run test:coverage -- chart.test.ts && \
pnpm test:e2e -- e2e/trader/chart-panel.spec.ts e2e/insights/backfills.spec.ts
```
Uses `test:coverage` (not the bare `test:unit`), the script that actually enforces this
service's coverage threshold per `xstockstrat-ui/CLAUDE.md` § Testing and the `node-test` CI
job — added per `/sdd-review impl-spec`'s WARNING that an earlier draft of this step used the
non-coverage-enforcing command, unlike Steps 4/6/8's explicit-threshold pattern. All
rewritten/new assertions pass; `backfills.spec.ts` passes unmodified, confirming the spot-check.

---

## Deviation Log

### D-1 (Steps 3/4) — proto enum deprecation triggers Go `staticcheck` SA1019 at every remaining consumer
**What**: Step 1 marked `TIMEFRAME_15MIN`/`TIMEFRAME_1HOUR` `[deprecated = true]`. That is
comment/annotation-only and non-breaking at the buf level (Step 1's `buf lint`/`buf breaking` both
passed), but Go's `staticcheck` (SA1019, enabled in every service's `.golangci.yml`) flags **every**
remaining reference to those enum values as a lint error. The spec's Execution Summary did not
anticipate this cross-cutting linter consequence — it only listed the *tests* whose assertions
invert.
**Blast radius**: confined to `xstockstrat-marketdata` (grep of all `services/**/*.go` outside
`gen/` found no other service references those values). Six legitimate remaining sites:
`internal/timeframe/timeframe.go` (2 — the `ToCanonical`/`FromString` switch arms the design
**deliberately keeps** so the permissive `GetDataCoverage`/`DeleteBackfilledData` path can still
resolve historical `15m`/`1h` rows), plus `internal/timeframe/timeframe_test.go`,
`internal/alpaca/client_test.go`, and `internal/service/marketdata_service_test.go` (the new Step-4
tests deliberately *send* a deprecated timeframe to prove rejection).
**Disposition**: `//nolint:staticcheck // SA1019: …` added at each legitimate site with a reason —
the exact idiom the codebase already uses for the deprecated string `timeframe` field. This expands
Steps 3/4's file scope beyond their `**Files**` lists to include `internal/timeframe/timeframe.go`
(Step 3) and `internal/timeframe/timeframe_test.go` + `internal/alpaca/client_test.go` (Step 4).
Recorded here and surfaced in the checkpoint accountability block; a `fails.md` ledger entry
captures the generalizable trap.

### D-2 (Steps 3/4) — `TestResolveIngestTimeframes` default-fallback subtests broke, not in the spec's breaking-test list
**What**: Step 3 narrowed `defaultBarIngestTimeframe` from `"15m,1d"` to `"1d"`. Two subtests of
`TestResolveIngestTimeframes` (`marketdata_service_test.go`) assert the empty-input and
wholly-unresolvable-input *fallback* returns `["15m","1d"]`; both now correctly return `["1d"]`. The
spec's Execution Summary correction 3 enumerated breaking tests but missed these two (they assert
the default *constant*, not a timeframe alias).
**Disposition**: updated both subtests' expected value to `["1d"]` (warn counts unchanged). In
scope for the Step 3/4 pair — the test file is in Step 4's `**Files**` list and the assertion
directly verifies the constant Step 3 changed.

### D-3 (Step 6) — `grpc.aio.AioRpcError` constructor requires metadata args positionally in the installed grpcio
**What**: The spec's Step 6 test 3 code constructs
`grpc.aio.AioRpcError(grpc.StatusCode.INVALID_ARGUMENT, details="…")`, relying on the signature the
spec verified (`initial_metadata=None, trailing_metadata=None` optional). The grpcio version actually
installed (per `uv.lock`) makes `initial_metadata`/`trailing_metadata` **required positional** args —
the 2-arg form raises `TypeError: … missing 2 required positional arguments`.
**Disposition**: construct it as
`grpc.aio.AioRpcError(grpc.StatusCode.INVALID_ARGUMENT, grpc.aio.Metadata(), grpc.aio.Metadata(), details="…")`.
Test-only, no production impact; the reject/retry logic under test is unchanged. Confined to
`test_ingest_servicer.py` (already in Step 6's `**Files**`).

### D-4 (Step 6) — used `_ctx("4")` for the rejection test's context, not a bare MagicMock
**What**: The spec's Step 6 test 2 built a bare `MagicMock()` context. But `TriggerBackfill`'s
admin gate (`_has_admin_scope`, feature 092) runs **before** the new feature-143 reject check, and a
bare MagicMock's `invocation_metadata()` does not carry the ADMIN bit — so the admin gate would fire
first with `PERMISSION_DENIED`, and the test's `INVALID_ARGUMENT` assertion would fail.
**Disposition**: use the repo's centralized `_ctx("4")` builder (conftest, C-13) — admin scope set +
`abort` raising — so the reject check (not the admin gate) is what fires. Test-only; confined to
`test_ingest_servicer.py`.

### D-5 (Step 8) — strengthened the agent validation test to a real red-before-green
**What**: The spec's Step 8 changed only the `pytest.raises(match=...)` string from
`"15m/15Min/1h/1Hour/1d/1Day"` to `"1d/1Day"` on a `timeframe="1w"` call. That produces **no RED**:
`pytest.raises`' `match` is `re.search`, so `"1d/1Day"` is a substring of the *old* error message
too, and `"1w"` is invalid under both the old and new alias sets — so the assertion passes before
*and* after Step 7, testing nothing about the actual narrowing.
**Disposition**: replaced the `"1w"` probe with `timeframe="15m"` **and** `timeframe="1h"` probes —
values that were *accepted* before Step 7 (and would reach a live gRPC call, raising `AioRpcError`,
not `ValueError`) and are *rejected* after it. This gives a genuine red→green that exercises the
feature's behavior (P-06/C-08). Confined to Step 8's file (`tests/test_client.py`); strictly
stronger coverage than the specced change.

### D-6 (Step 10) — e2e could not be run to green in this sandbox; CI-equivalent fallback used
**What**: Running `pnpm test:e2e` for `chart-panel.spec.ts` + `backfills.spec.ts` was attempted three
ways: (1) default — aborted in `global-setup.ts` because `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` was
unset and the project's pinned `@playwright/test` couldn't launch the pre-provisioned browser;
(2) with `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome`
(the config's documented override) — Chromium launched, but `e2e/warmup.setup.ts`'s "pre-warm SSR
routes" setup test timed out at 10 s because the non-CI `pnpm dev` webServer compiles routes on first
hit and that exceeds the setup test's timeout in this constrained sandbox; (3) with a raised
`--timeout=120000` — the setup test's own 10 s timeout is not CLI-overridable, so it timed out again
and the 15 real tests "did not run".
**Disposition**: took the **sanctioned sequential-mode verification fallback** for a timing-out
Playwright dev-server harness — `pnpm exec tsc --noEmit` (clean) + `pnpm run lint` (clean) +
`pnpm run test:coverage -- chart.test.ts` (green, `chart.ts` 100%). The two e2e specs' new assertions
are straightforward (`getByRole('tab').toHaveCount(0)`; `timeframeEnum === 'TIMEFRAME_1DAY'` on the
mount's GetBars) and will execute in **CI's e2e job**, which serves a **prebuilt** bundle
(`pnpm build && pnpm start`) rather than `pnpm dev` and so does not hit this dev-compile warmup
timeout. `**Disposition**: CI-equivalent fallback` — no repo change; the timeout is an environment
limitation, not a defect in the specs.

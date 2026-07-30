# Product Spec: fix-backfill-timeframe-enum

**Created**: 2026-07-29
**Last Updated**: 2026-07-29 (design rounds 1–4: scope widened four times, severity raised)
**Type**: bug · **Severity**: **SEV-2** — wrong behavior with potential financial impact in a future
trade cycle, trading not currently impaired (`docs/runbooks/bug-triage.md` § Severity Definitions)

> **Severity raised SEV-3 → SEV-2 at the round-3 design gate (user decision).** Filed as SEV-3
> "latent; no current user-visible breakage" — that framing was wrong, and the design rounds proved
> it. Two wrong-**data** paths are live today, not scheduled:
> 1. Every UI-created backfill job persists `timeframe=''` (FR-13), so `_resume_job` resolves it to
>    the `"1d"` default — a UI-created **15-minute** job, resumed after a restart, silently re-fetches
>    at **daily**.
> 2. An enum-only `BackfillBars` caller — the forward-compatible direction this feature pushes callers
>    toward — persists bars under `timeframe=''` (FR-11), permanently unqueryable, because
>    `InsertBars` stores the string verbatim (`marketdata_repo.go:59`) and `QueryBars` matches
>    `WHERE timeframe=$2` (`:88`).
>
> Wrongly-labelled or wrong-interval OHLCV feeds indicators, cross-stock scoring, and backtests, so
> the financial-impact-in-a-future-cycle bar is met. Still **Track C**, still no hotfix: nothing in the
> order-execution path is affected and no live trading is impaired.

---

## Problem Statement

Every `BackfillJob` returned by `xstockstrat-ingest` carries a populated **deprecated** field and an
empty replacement field. The same is true of every `Bar` returned by `xstockstrat-marketdata`, and of
the two `getBars` calls the UI charts send — both found while sweeping for other instances, and
folded into this feature by user decision (see § marketdata and § xstockstrat-ui below). The slug
still says "backfill" because that is where the defect was first observed; the scope is **every
producer of a deprecated-string/enum pair**, whether it produces a response or a request.

Observed live against the staging MCP server on 2026-07-29 (`get_backfill_status`, three jobs, all
identical in shape):

```json
{ "job_id": "9b744a89-…", "timeframe": "1d", "timeframe_enum": "TIMEFRAME_UNSPECIFIED" }
```

Confirmed in source rather than inferred from the response:

- `packages/proto/ingest/v1/ingest.proto:29-30` — `// DEPRECATED: use timeframe_enum. Removed in a
  future release once all callers migrate.` / `string timeframe = 3 [deprecated = true];`
- `packages/proto/ingest/v1/ingest.proto:39` — `xstockstrat.common.v1.Timeframe timeframe_enum = 12;`
- `services/xstockstrat-ingest/app/handlers/servicer.py:70-94` — `job_row_to_proto` sets
  `timeframe=row["timeframe"] or ""` and **never assigns `timeframe_enum`**, so it serializes as the
  zero value on every read.

**Why this matters.** The proto's own migration note says the string field is scheduled for removal.
The read path populates *only* the field being deleted. On the day `timeframe` is dropped, every
consumer of `GetBackfillStatus` / `ListBackfillJobs` loses the timeframe entirely — with no failing
test to catch it, because nothing asserts the enum on the read path.

> **This paragraph originally read "Why this matters despite being invisible today," and the next one
> claimed "The write path already migrated correctly … Only the read path was left behind." Both were
> false, and the false half is what hid FR-13 for three design rounds.** The write path did *not*
> migrate: `TriggerBackfill` persists `request.timeframe` **raw** at `servicer.py:153`, and
> `_canonical_timeframe` is not reached until `:284` — inside `_run_backfill`, after the row exists.
> Since the UI sends `timeframeEnum` with **no** string (`backfills/page.tsx:112`), every UI-created
> row already holds `timeframe=''`. So FR-1, which derives the enum from that column, would have
> returned `UNSPECIFIED` for the feature's own primary caller — the headline fix not fixing the
> headline case. See FR-13.
>
> What *is* true: the agent sends both (`agent/app/client.py:751-752`), and ingest's chunk dispatch
> sets the enum (`servicer.py:257,458`). The staging observation that opened this bug showed
> `timeframe: "1d"` precisely because those were **agent**-created jobs; UI-created jobs would have
> shown `timeframe: ""`.

Asserting the sibling path was fine without re-greping it is ledger `fails.md` 2026-07-27 (072); the
resulting one-path-fixed-sibling-forgotten shape is 2026-07-01 (**C-10(b)**) — recurring here a fourth
time, inside the feature whose stated premise is closing exactly that shape.

## Secondary finding — the reason this survived review

**There is no `timeframe_enum` column in `ingest.backfill_jobs`.**
`services/xstockstrat-ingest/migrations/003_backfill_jobs.up.sql:9` declares only
`timeframe TEXT NOT NULL DEFAULT ''`, and
`services/xstockstrat-ingest/app/repositories/backfill_jobs.py:41-45` inserts only that column.
Two consequences:

1. **`_resume_job` reads a column that cannot exist.** `servicer.py:407` does
   `enum = row.get("timeframe_enum") or 0` — always `0`, always falling through to the string branch.
   Harmless, but it reads as if the column were real.
2. **A test asserts against a shape the database never produces.**
   `services/xstockstrat-ingest/tests/test_ingest_servicer.py:506` sets
   `job_row["timeframe_enum"] = 4` on a hand-built fixture. That is the exact defect family fixed by
   features 075 / 077 / 078 this cycle: *a test built against the shape the handler expects, rather
   than the shape the real source emits, so the mismatch never goes red.*

Because the enum is not stored, the fix must **derive** it, not read it.

## User Story

As a consumer of the backfill APIs, I want `BackfillJob.timeframe_enum` populated, so that reading the
timeframe does not depend on a field the proto has already scheduled for deletion.

## Functional Requirements

FR-1. `job_row_to_proto` (`servicer.py:70-94`) sets `timeframe_enum` by mapping the stored `timeframe`
string through the existing `_STR_TO_ENUM` (`servicer.py:35`), normalizing through the existing
`_TF_ALIASES` (`servicer.py:37-44`) first. Reuse both existing maps — do not introduce a second one.
The alias hop is not optional: the column is `TEXT NOT NULL DEFAULT ''` with no CHECK constraint
(`003_backfill_jobs.up.sql:9`), so nothing guarantees a canonical value, and `_resume_job`
(`servicer.py:408-410`) already resolves aliases. Mapping through `_STR_TO_ENUM` alone would leave a
legacy `"1Day"` row resolving on the resume path but `UNSPECIFIED` on the read path — a narrower
copy of the bug being fixed.

FR-2. `timeframe` (the deprecated string) keeps being populated exactly as today, byte-for-byte
(including non-canonical values — FR-1 normalizes only what feeds the enum). This fix is additive;
removing the string is a separate, coordinated change once consumers migrate.

**FR-2a — the one carve-out to FR-2/FR-7's byte-for-byte rule** (added at the round-2 design gate,
user sign-off recorded in `context.md`; **C-11** override mechanism). Canonicalization *before*
production is permitted where the value also feeds the enum, at exactly two sites:
  - `analysis/app/engine/live_loop.py:126` — `"1Day"` → `"1d"` (FR-9). Its two migrated siblings
    already send canonical `"1d"`; leaving the third on the Alpaca spelling preserves the very
    `1Day`-vs-`1d` divergence `internal/timeframe` exists to kill (**MARKETDATA-1**).
  - `marketdata`'s `bar_ingest_timeframe` path (FR-10) — a resolvable alias now reaches
    `Bar.Timeframe` canonicalized rather than verbatim.
  Everywhere else the deprecated string is reproduced unchanged. The rule protects *response* fields
  consumers read; it is not a licence to keep writing a non-canonical value that the receiver would
  have to re-canonicalize anyway.

FR-3. An unmappable **legacy** stored string yields `TIMEFRAME_UNSPECIFIED` rather than raising —
`.get(…, 0)` on the map lookup, matching how `servicer.py:257` already handles it. Narrowed to
*legacy* rows at the round-3 gate: as originally written ("an unmappable or empty stored string
yields `UNSPECIFIED`") this criterion **blessed the defect**, since `''` is exactly what the primary
caller persists today. FR-13 makes empty unreachable for newly-created rows, so FR-3 governs only
rows written before this feature.

FR-13. **The ingest write path canonicalizes before persisting.** `TriggerBackfill` currently stores
`timeframe=request.timeframe` raw (`servicer.py:153`) and emits the same raw value into the ledger
payload (`:161`); `_canonical_timeframe` is not reached until `:284`. Both become
`_canonical_timeframe(request)`, which prefers the enum and yields `15m`/`1h`/`1d`. This is not
optional polish — **FR-1 does not work without it**, because the UI sends enum-only and every
UI-created row therefore holds `''` (see § Problem Statement). Invokes the FR-2a carve-out.

Two further consequences of this fix, both closing live wrong-data behavior:
  - `_resume_job` stops resolving `''` → `"1d"`, so a resumed 15m job no longer re-fetches at daily.
  - The ledger's append-only `ingest.backfill.queued` payload stops recording `""` forever. That
    payload is an **untyped `Struct`** — no generated field, no `SA1019` signal, invisible to a
    type-name grep, which is why it took four rounds to surface.

FR-4. **Derive the enum; add no column.** Resolves Open Question 1 (evidence below):
  - The dead read at `servicer.py:407` (`enum = row.get("timeframe_enum") or 0`) is **deleted**,
    together with the `_ENUM_TO_STR` lookup at `servicer.py:408-410` that consumes it. To be
    explicit: the **`_ENUM_TO_STR` map itself (`servicer.py:36`) stays** — `_canonical_timeframe`
    reads it on the write path (`servicer.py:50-51`), which FR-2 and § Out of Scope forbid changing.
    Only that one branch inside `_resume_job` goes. `_resume_job` then derives its timeframe from the
    stored string via the same alias normalization FR-1 uses.
  - `tests/test_ingest_servicer.py:506`'s `job_row["timeframe_enum"] = 4` is **removed**; the fixture
    drives the real row shape (`timeframe` only). That the resume test still passes is the evidence
    the deleted branch was dead.

### marketdata — the same defect on the hotter read path

Folded into this feature by user decision (2026-07-29) rather than deferred: it is the identical
producer-side gap, and splitting one defect family across two features invites fixing half of it.
`Bar` (`marketdata.proto:44-58`) carries `string timeframe = 10 [deprecated = true]` (`:55`) and
`Timeframe timeframe_enum = 12` (`:57`); `TimeframeEnum` appears exactly once in the whole service
(`internal/service/marketdata_service.go:120`) and only on the *request* side.

FR-5. Every `Bar` construction site sets `TimeframeEnum` alongside the existing `Timeframe` string,
via the existing `internal/timeframe` package — no new mapping table:
  - `internal/repository/marketdata_repo.go:112-124` — DB read path; `tf` is the scanned canonical
    column, so `timeframe.FromString(tf)`.
  - `internal/alpaca/client.go:199-205` (single-symbol) and `:305-311` (multi-symbol) — `timeframe`
    is the canonical string parameter already threaded through both.
  - `internal/alpaca/stream.go:255-260` — see FR-6; this one is not mechanical.

FR-6. **Streamed bars are labelled `TIMEFRAME_1MIN`, not `UNSPECIFIED`.** `streamBarTimeframe = "1m"`
(`stream.go:28`) because Alpaca's `bars` channel emits 1-minute bars only, and
`timeframe.FromString("1m")` returns `TIMEFRAME_UNSPECIFIED` **by design** (`timeframe.go:66-70` —
sub-15m intervals were removed so callers *requesting* them get an error). Routing the stream site
through `FromString` would therefore be a no-op dressed as a fix. A streamed bar genuinely *is* a
1-minute bar, and `TIMEFRAME_1MIN = 1 [deprecated = true]` (`common.proto:82`) still exists precisely
so already-produced data can be described (**PROTO-2**, deprecate-don't-delete). Set it explicitly
and comment why. `common.proto:74-76` states the retention rationale in as many words — 1MIN/5MIN are
"no longer **ingested** or selectable — but retained (not deleted) so the change stays wire- and
source-compatible" — and streamed bars are precisely *not ingested* (`stream.go:23-27`: forwarded to
live subscribers, never persisted). Labelling a live-only bar `1MIN` is within that member's
documented reason for existing.

**Blast radius: zero.** `StreamBars` has no callers — a zero-caller grep across trading / analysis /
indicators is recorded in `docs/roadmap/features/013-phase-2-data-layer/context.md:27`, and
`014-trader-chart-panel/context.md:13` records the chart deliberately polling `GetBars` instead. No
consumer can observe the `UNSPECIFIED → 1MIN` transition today.

*Rejected alternative* (recorded for `design.md`): leave `TimeframeEnum` unset on the stream site and
document that streamed bars have no representable canonical timeframe. Rejected because it preserves
exactly the populated-string/empty-enum shape this feature exists to eliminate. *This remains the one
judgement call in the feature — flagged for the `/sdd-design` adversarial round.*

FR-7. The deprecated `Timeframe` string keeps its current value at every site (`"1m"` on the stream
path included) — same additive rule as FR-2. `timeframe.FromString` is not modified: its refusal of
`"1m"` is load-bearing for request resolution.

### xstockstrat-ui — the request side of the same family

Also folded in by user decision (2026-07-29). A request message has a *producing* side too, and two
live chart call sites populate only the deprecated string:

FR-8. `ChartPanel.tsx:56-60` and `insights/market/[symbol]/page.tsx:32` send `timeframeEnum`
alongside the existing `timeframe` on their `getBars` calls. Both pass `src/lib/chart.ts`'s
`Timeframe` union (`'15Min' | '1Hour' | '1Day'` — the Alpaca alias spellings, `chart.ts:9`), so the
string→enum map belongs in `chart.ts` next to `TIMEFRAMES`, which is already the declared single
source of truth for this vocabulary (`chart.ts:1-3`, DRY guard rail). Do **not** add a second map in
either component. Note the name clash: `chart.ts`'s `Timeframe` is a string union while
`@xstockstrat/proto/common/v1/common_pb`'s `Timeframe` is the enum — alias the **proto** one
(`Timeframe as PbTimeframe`); the local union is exported and imported by both senders, so renaming
it ripples. The aliasing precedent is `src/hooks/useOrders.ts:3` (`TradingMode as PbTradingMode`) —
**not** `insights/backfills/page.tsx:18`, which is a bare import (corrected at the design gate;
`recon.md` Risk 6).

Without this, dropping `GetBarsRequest.timeframe` makes `timeframe.Resolve(UNSPECIFIED, "")` error
(`internal/timeframe/timeframe.go:85`) and both charts go blank — the same scheduled failure as the
rest of this feature, on the request side.

FR-12. `e2e/mock-backend.ts:305-335`'s `getBars` handler is a sixth `Bar` producer, and it emits a
shape the real service **cannot** produce: `timeframe: '1Day'` (the real read path resolves to
canonical `'1d'` before querying, `marketdata_service.go:120`) and no `timeframeEnum`. Both mock bars
become `timeframe: '1d', timeframeEnum: TIMEFRAME_1DAY`, and `e2e/fixtures/INVENTORY.md:47` records
the shape. Leaving it would contradict this spec's own § Secondary finding — a fixture built against
the shape the handler expects rather than the shape the real source emits is the reason the family
survived review — and after this feature the drift widens, since real responses carry the enum and
the mock never would.

### xstockstrat-analysis — the producer the first design round found

Not in the original spec. Surfaced by the round-1 design adversary and folded in by user decision.

FR-9. `analysis/app/engine/live_loop.py:126` sends `GetBarsRequest(symbol=…, timeframe="1Day")` — the
deprecated string only, in the **non-canonical** spelling — while its two siblings *in the same
service* already send canonical `"1d"` **plus** the enum (`app/handlers/servicer.py:590-591`,
`app/services/screener.py:169-170`). It is live-wired (`app/main.py:98,116`), so when the string is
dropped the **live evaluation loop stops evaluating** — a materially worse outcome than a blank
chart. It gains `timeframe="1d", timeframe_enum=TIMEFRAME_1DAY` (see FR-2a for the string change).

This is the literal `fails.md` 2026-07-01 / **C-10(b)** shape — one path migrated, the sibling left
behind — inside a feature whose entire premise is closing that shape.

### marketdata — the two raw readers the second round found

FR-10. `ingestRecentBars` (`marketdata_service.go:514`) reads `marketdata.stream.bar_ingest_timeframe`
as a **raw string** and passes it to `GetBarsMulti` (`:523`) / `GetBars` (`:538`), whose bars are then
**persisted** (`:528`, `:546`). An out-of-vocabulary value therefore writes rows that re-emit the
defective pair on every later read, forever. Route it through `timeframe.Resolve`. On an unresolvable
value, fall back to the declared `"15m"` default and `slog.Warn` once per cycle — **user decision at
the round-2 gate**; see § Accepted Risks. Hoist a `defaultBarIngestTimeframe` const (the literal
currently appears three times in that function).

FR-14. **Remediate the recoverable rows already at rest.** Every fix above is forward-looking; the
rows previously written under a non-canonical label stay invisible to `QueryBars` forever. A
forward-only marketdata migration (next free number — its `migrations/` ends at `002_fundamentals`,
so `003_*`, **C-07**) canonicalizes the three recoverable spellings in `marketdata.ohlcv`:
`'1Day'`→`'1d'`, `'1Hour'`→`'1h'`, `'15Min'`→`'15m'`. Added at the round-3 gate by user decision —
refusing it while the feature's whole premise is closing this exact divergence would be inconsistent.

Design constraints the implementation must resolve, not assume:
  - `ohlcv` is a **TimescaleDB hypertable**, so the `.up.sql` must be written with that in mind
    rather than as a naive whole-table `UPDATE`.
  - A **primary-key/unique collision is possible**: if both a `'1Day'` and a `'1d'` row exist for the
    same `(symbol, time)`, a bare `UPDATE` violates the constraint. The migration must resolve
    duplicates deliberately (skip-if-canonical-exists, or delete-then-update) — decide and state which.
  - A real `.down.sql` is required (never a no-op) — though note the reverse is **not** faithful:
    once merged, a `'1d'` row is indistinguishable from one that was always canonical, so the down
    migration cannot restore the original spelling. State that limitation in the file.
  - **F-01**: `002_fundamentals` and every earlier migration are applied and must not be edited.
  - Approval: DBA + service owner (`docs/runbooks/approval-flow.md`) — it mutates stored market data.

Out of remediation scope: `timeframe=''` rows (intent is unrecoverable — the interval was never
stored) and any `'1m'` rows (a **MARKETDATA-2** anomaly, since streamed bars are never persisted;
worth counting, not rewriting). The migration must therefore not claim to leave the table fully
canonical — only that no *recoverable* row remains non-canonical.

FR-11. `BackfillBars` reads `req.Timeframe` raw at three sites — `marketdata_service.go:590` (ledger
event), `:602` (`src.GetBars`, the value that lands in `ohlcv.timeframe` via `InsertBars:611`), and
`:633` (`estimateExpectedBars`) — each with a `//nolint:staticcheck // SA1019` acknowledging the
deprecated read, and **never** calls `Resolve`. Two consequences: when the string is dropped it calls
Alpaca with an empty timeframe and 400s every symbol; and today a caller sending `"1Day"` writes rows
`GetBars` can never find — a live **MARKETDATA-1** violation reachable through a public RPC. It gains
`timeframe.Resolve(req.GetTimeframeEnum(), req.Timeframe)`, used at all three sites.

## Out of Scope

- Removing the deprecated `timeframe` string from the proto (breaking; needs the full
  `docs/runbooks/proto-versioning.md` flow).
- The `BackfillBarsRequest` write path — already correct.
- Any UI **read** path — because there are none. Corrected at the round-3 design gate: this section
  previously claimed "the UI displays the deprecated string today and keeps working either way",
  which is false. No UI component renders `BackfillJob.timeframe` or `Bar.timeframe` (zero hits for
  `.timeframe` in `backfills/page.tsx`, none anywhere in `src/`); `mapBars` (`chart.ts:36`) reads only
  `time`/`open`/`high`/`low`/`close`/`volume` (`chart.ts:26-33`). Only *senders* change (FR-8, FR-12).
  The distinction matters: "the UI keeps working either way" implied a consumer that would migrate
  later, and there is nothing to migrate.
- The **consuming** side of a request message **where the reader already resolves the enum**. That is
  `TriggerBackfillRequest` (`ingest.proto:64`) via `_canonical_timeframe` (`servicer.py:47`), and
  `GetBarsRequest` (`marketdata.proto:86`) via `timeframe.Resolve` (`marketdata_service.go:120`).
  > **Corrected at the round-2 design gate.** This section previously claimed marketdata's request
  > readers were correct *as a class*, citing only `:120`. That was false: `BackfillBars` reads its
  > string raw at three sites and never resolves (now FR-11), and `ingestRecentBars` reads a config
  > string raw (now FR-10). Both are in scope. Asserting a sweep was complete without re-greping is
  > the `fails.md` 2026-07-27 (072) shape, and it is what let the round-1 and round-2 producers hide.
- `StreamBarsRequest` (`marketdata.proto:73`) — no sender exists to fix. `StreamBars` has no callers
  (`013-phase-2-data-layer/context.md:27`, `014-trader-chart-panel/context.md:13`).

## Affected Services

- `xstockstrat-ingest` (Python) — `app/handlers/servicer.py`, its tests. No `migrations/` change (FR-4).
- `xstockstrat-marketdata` (Go) — `internal/repository/marketdata_repo.go`,
  `internal/alpaca/client.go`, `internal/alpaca/stream.go`, **`internal/service/marketdata_service.go`**
  (FR-10, FR-11), **`internal/handler/marketdata_handler.go`** (the live `StreamBars` raw reader at
  `:258`), **`migrations/003_*`** (FR-14), their tests, plus the doc surfaces below.
  > The first three files were the whole list until round 2. `internal/service` and `internal/handler`
  > were added at the round-2/3 gates. Listed explicitly because a `/sdd-spec` **Files** section
  > derived from a stale list would under-stage the step and trip **F-08** at execute time.
- `xstockstrat-ui` (Next.js/TS) — `src/lib/chart.ts` (the map), `src/components/trader/ChartPanel.tsx`
  and `src/app/insights/market/[symbol]/page.tsx` (the two senders), `e2e/mock-backend.ts` +
  `e2e/fixtures/INVENTORY.md` (FR-12), plus the Vitest unit test. `src/lib/**` is inside the Vitest
  coverage scope, so the map is unit-testable without Playwright.
- `xstockstrat-analysis` (Python) — `app/engine/live_loop.py`, `tests/test_live_loop.py` (FR-9).

**Docs in scope** (behavior these files describe changes, so they ship in the same PR — root
`CLAUDE.md` § Teardown): `services/xstockstrat-marketdata/CLAUDE.md:17` (its "the enum values remain
in the proto for wire compatibility but are **unused**" clause becomes false once FR-6 makes
`TIMEFRAME_1MIN` a live label) and `:61` (the `bar_ingest_timeframe` row, whose behavior FR-10
changes); `internal/timeframe/timeframe.go:10-13`; and in
`services/xstockstrat-marketdata/docs/context-constitution.md` both **MARKETDATA-2** (streamed bars
now carry an enum — and still must not be persisted) and **MARKETDATA-1**, whose evidence cites
`write-back :203`, the exact line the shared Alpaca builder replaces. Two citations also line-shift.

## Proto Contract Changes

- [x] None. Both fields already exist; only the producer changes.

## Config Key Changes

- [x] None.

## Database Changes

- [x] **One migration, in `marketdata` only — a data remediation, no schema change** (FR-14, added at
  the round-3 gate): `services/xstockstrat-marketdata/migrations/003_*.{up,down}.sql`, canonicalizing
  the recoverable non-canonical `marketdata.ohlcv.timeframe` values. Requires DBA + service-owner
  approval. No applied migration is edited (**F-01**).
- [x] **No `ingest` migration and no new column.** FR-4/FR-13 derive the enum from a string the write
  path now guarantees is canonical, so `ingest.backfill_jobs` is unchanged.

## Acceptance Criteria

1. All three `job_row_to_proto` read paths — `GetBackfillStatus` (`servicer.py:513`),
   `ListBackfillJobs` (`:539`), and `CancelBackfill` (`:583`, which also returns a `BackfillJob` per
   `ingest.proto:16`) — return `timeframe_enum` matching the job's stored timeframe
   (`1d` → `TIMEFRAME_1DAY`, `1h` → `TIMEFRAME_1HOUR`, `15m` → `TIMEFRAME_15MIN`). The shared mapper
   fixes all three structurally; naming them is the point, since untested parity is what let this ship.
2. A test drives a job row with each supported timeframe string through `job_row_to_proto` and asserts
   **both** `timeframe` and `timeframe_enum` — the paired assertion is the point, since asserting only
   the string is what let this through.
3. An unmappable or empty stored string yields `TIMEFRAME_UNSPECIFIED` and does not raise; a legacy
   alias row (`1Day`) yields `TIMEFRAME_1DAY` while its `timeframe` string is returned unchanged.
4. The fixture in `tests/test_ingest_servicer.py` matches the real `backfill_jobs` row shape — no key
   the database cannot produce.
5. Red-before-green recorded in both services: each new assertion fails against the current tree.
6. Every `Bar` produced **from a resolvable timeframe** — by `GetBars` (DB path) and by both Alpaca
   fetch paths — carries a `TimeframeEnum` matching its `Timeframe` string, asserted **paired** with a
   **hardcoded** expected enum (same rule as AC-2). The expectation must not be computed by calling
   the same mapper the implementation calls, or the assertion proves nothing and can never go red —
   the `fails.md` 2026-07-29 (074) shape. Two residuals are accepted and recorded in `design.md`:
   an unresolvable request alias (e.g. `"10Min"`) falls through to `canonicalTf = legacyTf`
   (`marketdata_service.go:116-122`) and yields `UNSPECIFIED`; and legacy `ohlcv` rows already stored
   under a non-canonical label scan back with `UNSPECIFIED`. Both are the correct encoding of
   "outside the supported vocabulary", not new defects.
7. A streamed bar carries `TIMEFRAME_1MIN` with `Timeframe == "1m"` (FR-6), and
   `timeframe.FromString("1m")` still returns `TIMEFRAME_UNSPECIFIED` — i.e. the request-resolution
   refusal is provably untouched by the labelling change.
8. Both `getBars` senders include `timeframeEnum` matching the `timeframe` string they already send
   (`'15Min'` → `TIMEFRAME_15MIN`, `'1Hour'` → `TIMEFRAME_1HOUR`, `'1Day'` → `TIMEFRAME_1DAY`), the
   mapping lives only in `src/lib/chart.ts`, and a Vitest case asserts it covers every member of the
   `Timeframe` union — so adding a fourth interval later cannot silently skip the enum. Typing the map
   as `Record<Timeframe, PbTimeframe>` is the primary guarantee (a new union member fails `tsc`); the
   Vitest case is the backstop.
9. `live_loop.py`'s `GetBars` request carries `timeframe="1d"` **and** `timeframe_enum=TIMEFRAME_1DAY`,
   asserted on the captured request — matching how `test_analysis_servicer.py:219-220` already pins
   its two migrated siblings.
10. `resolveIngestTimeframe` maps `""` → `"15m"`, a resolvable alias → its canonical form, and an
    unresolvable value → the `"15m"` default with a `slog.Warn`, each asserted directly.
11. `BackfillBars` resolves its timeframe once and uses the canonical value at all three sites; a
    request carrying only `timeframe_enum` (no string) succeeds — the condition that is broken today
    and is the whole point of the migration.
12. The e2e mock's bars carry `timeframe: '1d'` + `timeframeEnum`, matching what the real service
    emits, and `INVENTORY.md` records it. The same applies to the **`BackfillJob`** mock:
    `e2e/insights/backfills.spec.ts:16-30`'s `runningJob()` supplies `timeframeEnum` with **no**
    `timeframe`, which after FR-1 is a shape the service can no longer produce — the inverse of the
    `Bar` mock's error. Both mocks match the real emitted shape, or the exemption is stated.
13. **A `TriggerBackfill` carrying only `timeframe_enum` persists the canonical string** and reads
    back with the matching enum — the ingest twin of AC-11, and the criterion that would have caught
    FR-13. Asserted on the value passed to `insert_job`, not on a hand-built row: the whole failure
    was that hand-built `1d`/`1h`/`15m` fixtures pass while the real caller's shape (`''`) is never
    exercised (`fails.md` 2026-07-29 / 074).
14. The `ingest.backfill.queued` ledger payload carries the canonical timeframe, asserted on the
    emitted `Struct` — the untyped surface no lint or type check covers.
15. After FR-14's migration, `SELECT DISTINCT timeframe FROM marketdata.ohlcv` returns no *recoverable*
    non-canonical value (`'1Day'`/`'1Hour'`/`'15Min'`). Any surviving `''` or `'1m'` rows are reported
    with counts rather than silently left — an unexecuted advisory is the `fails.md` 2026-07-29 (079)
    shape ("an unexecuted gate is a claim, not a check"), so this is a criterion, not a suggestion.

    > **Corrected note.** A prior session marked step 5 `blocked` on the reasoning that a migration
    > must be executed in the authoring session to be verified. That reasoning was checked and
    > retracted (user-directed correction, `implementation-spec.md` step 5): no CI job in this repo
    > ever executes a migration, and a real precedent (`008-signal-source-registry` step 3) is `done`
    > on the same review-based verification. AC-15 is satisfied the same way — the migration SQL was
    > authored and reviewed against the DDL facts in step 5's Codebase Evidence, matching this repo's
    > actual practice. The runbook in step 5's Verification block remains the executed check for
    > whoever applies the migration for real (DBA + service-owner gate, unchanged).

## Accepted Risks

**FR-10's `"15m"` fallback can cause a write, not merely label one.** Everywhere else this feature is
additive — it changes how data is *described*. The fallback is the exception: an operator who set
`bar_ingest_timeframe` to an out-of-vocabulary value would find ingestion resumed at 15m, writing rows
they did not ask for. Weighed and accepted at the round-2 gate (user decision) against the alternatives
of passing the raw value through or skipping the cycle; the reasoning is that this is the platform's
only continuous OHLCV feed and a misconfiguration should degrade to a working default rather than to
silence. Mitigations: the documented pause sentinel is `bar_ingest_interval_ms <= 0`
(**MARKETDATA-5**, `marketdata_service.go:484`), *not* a bogus timeframe, so the misuse this could
disturb is not a supported one; the key is seeded in **no** migration (all 10 config migrations
checked), so every environment provisioned from this repo runs the `"15m"` default already and is
unaffected; and each fallback cycle emits a `slog.Warn`.

**Rows already written under the old behavior are not migrated or cleaned up.** A prior
misconfiguration that persisted `"1Hour"`- or `"1m"`-labelled rows leaves them in place, invisible to
`GetBars` and scanning back with `UNSPECIFIED`. The remedy is a scoped `DeleteBars`; explicitly not in
this feature.

## Open Questions

Both closed at the `/sdd-review product-spec` gate (2026-07-29). The reasoning — and the user's
scope-widening sign-off — is recorded in `context.md` § Session 2026-07-29 (sdd-review), so a later
reader does not have to reconstruct it.

- [x] **FR-4: derive, do not store.** Closed — but on **corrected reasoning**, recorded because the
  original rationale was falsified mid-design and a later reader must not rebuild on it.
  > *Originally closed with*: "`_canonical_timeframe` already canonicalizes on the write path … so the
  > enum is a pure function of a column that already exists. A column would duplicate state and create
  > two values that can disagree."
  > **The first clause was false and the second was already true.** `_canonical_timeframe` is *not*
  > applied on the persist path (`servicer.py:153` stores the raw request string; `:284` canonicalizes
  > later, for execution only), so the stored string and the executed timeframe **already disagree** —
  > `''` on disk versus a resolved canonical value in flight. The anti-duplication argument was
  > therefore an argument against a state of affairs that existed.

  The decision still stands, for a stronger reason: FR-13 makes the write path canonicalize, which
  makes the string a *reliable* source and the enum genuinely derivable — one line rather than a
  column, a migration, and dual-write discipline. Nothing in the product needs a timeframe the string
  map cannot express (`_STR_TO_ENUM` covers every supported interval; sub-15m was deliberately
  removed, `common.proto:82-83`). Revisit only if a stored timeframe must outlive the string
  vocabulary. **Without FR-13, "derive" would have been the wrong call** — deriving from a column
  nothing guarantees is how FR-1 came to return `UNSPECIFIED` for its primary caller.
- [x] **No second read-path instance inside this service.** Closed.
  `grep 'deprecated = true' packages/proto/ingest/v1/ingest.proto` returns exactly two hits: `:30`
  (`BackfillJob` — this bug) and `:64` (`TriggerBackfillRequest`). The latter is a **request** message
  that ingest *consumes* via `_canonical_timeframe`, which already prefers the enum — the write path
  the spec declares correct. The gap only exists where ingest is the *producer*, so within ingest this
  stays one fix for one message. The sweep did surface the same defect one service over, in
  `marketdata`'s `Bar` — **folded into this feature** by user decision rather than deferred; see
  § marketdata (FR-5–FR-7) and AC-6/AC-7.

## Feature Workflow Notes

Branch: `feature/fix-backfill-timeframe-enum` from `main-dev`.
Confirmed bug → routes via `docs/runbooks/bug-triage.md` **Track C**. **SEV-2** (raised from SEV-3 at
the round-3 gate — see the severity note in the header). Track C remains correct despite the raise:
Track A is for SEV-1 or bugs confirmed in `main` with live-trading risk, and nothing here touches the
order path. It rides the next `/promote` cycle rather than a hotfix.

**Approvals this feature now needs** (grown with scope — `docs/runbooks/approval-flow.md`):
one service owner per touched service (ingest, marketdata, analysis, ui) **plus DBA + service owner
for the FR-14 migration**, since it mutates stored market data. No proto change, so no proto gate.

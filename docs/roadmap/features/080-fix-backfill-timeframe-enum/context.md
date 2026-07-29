# Context: fix-backfill-timeframe-enum

**Feature**: `docs/roadmap/features/080-fix-backfill-timeframe-enum/feature.md`

---

## Session 2026-07-29 — backlog capture

- **How it was found**: not by a code review. While reconnecting the staging MCP server to confirm
  feature 073's deploy, `get_backfill_status` returned three jobs all shaped
  `{"timeframe": "1d", "timeframe_enum": "TIMEFRAME_UNSPECIFIED"}`. A populated string next to its
  enum sitting at the zero value is the signature of a handler writing one representation while the
  proto expects another — the same signature as features 075 / 077 / 078 this cycle.
- **Confirmed in source before filing**, not inferred from the response:
  `services/xstockstrat-ingest/app/handlers/servicer.py:70-94` (`job_row_to_proto` never assigns
  `timeframe_enum`), against `packages/proto/ingest/v1/ingest.proto:29-30,39`.
- **Severity SEV-3, deliberately.** Nothing is broken for a user today — consumers still read the
  deprecated string. It matters because the proto schedules that string for removal, and the read path
  populates *only* it. The failure is scheduled, not present.
- **Secondary finding, and the more instructive one**: there is no `timeframe_enum` column in
  `ingest.backfill_jobs` at all (`migrations/003_backfill_jobs.up.sql:9`). So
  `servicer.py:407`'s `row.get("timeframe_enum")` is dead, and
  `tests/test_ingest_servicer.py:506` sets that key on a hand-built fixture — a test asserting against
  a shape the database never emits. That is why the gap was invisible to the suite, and it is the same
  root cause recorded in `fails.md` 2026-07-29 (074). The fix must **derive** the enum from the stored
  string; there is nothing to read.
- **Not fixed on the spot** — it is unrelated to feature 079, which was in flight, and folding it into
  that PR would have mixed an SSE removal with an ingest wire-encoding fix.

## Open Threads

- ~~FR-4 fork~~ — closed 2026-07-29, see below.
- ~~Open Question 2~~ — closed 2026-07-29, see below.

---

## Session 2026-07-29 — sdd-review product-spec

**Track**: `docs/runbooks/bug-triage.md` Track C (bug present in `main-dev`/staging, not a production
emergency). No GitHub issue — Issues are disabled on this repo.

### Gate outcome

First pass **FAILed** on two blockers: FR-4 was a "decide and record" placeholder rather than a
testable requirement, and both Open Questions plus the `Database Changes` checkbox were unchecked.
Spec revised, re-reviewed: **PASS WITH WARNINGS**, no blockers, no Floor (`F-*`) breach. All 22 code
citations were verified to say what the spec claims. Status: `draft` → `spec-ready`.

### Decisions taken this session

**FR-4 / Open Question 1 — derive the enum, add no column.** *(user decision)* The write path already
canonicalizes what gets stored (`_canonical_timeframe`, `servicer.py:47`, prefers the request enum and
writes `15m`/`1h`/`1d`), so the enum is a pure function of a column that already exists. A stored
`timeframe_enum` would duplicate state, cost migration `008_*`, and create two values that can
disagree. The dead read at `servicer.py:407` is therefore **deleted**, not made real. Care: the
`_ENUM_TO_STR` **map** stays — only the branch at `:408-410` goes — because `_canonical_timeframe`
reads that map on the write path (`:50-51`).

**Open Question 2 — no second read-path instance inside ingest.** `grep 'deprecated = true'` on
`ingest.proto` returns exactly `:30` (`BackfillJob`, this bug) and `:64` (`TriggerBackfillRequest`).
The latter is *consumed* via `_canonical_timeframe`, which already prefers the enum. The defect
exists only where a service is the **producer**.

**Scope widened twice, both by explicit user decision** — 080 is now a three-service fix that closes
the whole defect family rather than one message:

1. **`marketdata`'s `Bar`** (`marketdata.proto:55,57`) — all four construction sites set only the
   deprecated string (`marketdata_repo.go:112-124`, `alpaca/client.go:199-205,305-311`,
   `alpaca/stream.go:255-260`); `TimeframeEnum` appears once in the whole service and only on the
   request side (`marketdata_service.go:120`). Hotter read path than the backfill one — charts,
   indicators, backtests. → FR-5/FR-6/FR-7, AC-6/AC-7.
2. **The two UI `getBars` senders** (`ChartPanel.tsx:56-60`, `insights/market/[symbol]/page.tsx:32`),
   surfaced by the reviewer: a *request* message has a producing side too, and these populate only
   the deprecated string. When `GetBarsRequest.timeframe` is dropped,
   `timeframe.Resolve(UNSPECIFIED, "")` errors (`timeframe.go:85`) and both charts go blank. → FR-8,
   AC-8. The agent (`client.py:752`) and the backfills page (`backfills/page.tsx:112`) were already
   correct, so only these two needed changing.

**The one judgement call — FR-6, streamed bars.** `streamBarTimeframe = "1m"` (`stream.go:28`) and
`timeframe.FromString("1m")` returns `UNSPECIFIED` **by design** (`timeframe.go:67-70` — sub-15m was
removed so callers *requesting* it get an error). Routing that site through `FromString` would be a
no-op dressed as a fix, so the spec labels streamed bars `TIMEFRAME_1MIN` explicitly.
`common.proto:74-76` retains 1MIN/5MIN precisely so already-produced, non-ingested data stays
describable, and streamed bars are never persisted (`stream.go:23-27`) — so this is within the
member's documented purpose (**PROTO-2**). Blast radius is zero: `StreamBars` has no callers
(recorded in `013-phase-2-data-layer/context.md:27` and `014-trader-chart-panel/context.md:13`).
Rejected alternative, recorded for `design.md`: leave the enum unset and document that streamed bars
have no representable canonical timeframe — rejected because it preserves exactly the
populated-string/empty-enum shape this feature exists to eliminate. Carried into `/sdd-design` as the
designated challenge point.

### Review warnings, all addressed in the spec before the gate write

| # | Warning | Resolution |
|---|---|---|
| 1 | OQ-2 still said marketdata was "deferred rather than folded in" | Rewritten — points at § marketdata / AC-6-7 |
| 2 | Spec claimed reasoning was in `context.md`; it was not | This entry |
| 3 | Out-of-Scope argued only the consuming side of request messages | Rewritten; the two UI senders folded in (FR-8) |
| 4 | "the `_ENUM_TO_STR` branch it feeds" could be read as deleting the map | FR-4 now names `servicer.py:408-410` and states the map stays |

Also folded in from the review: AC-1 now names `CancelBackfill` (`servicer.py:583`), the third
`job_row_to_proto` read path; FR-1 now normalizes through `_TF_ALIASES` before `_STR_TO_ENUM`, because
the column is `TEXT NOT NULL DEFAULT ''` with no CHECK constraint and `_resume_job` already resolves
aliases — mapping through `_STR_TO_ENUM` alone would leave a legacy `"1Day"` row resolving on the
resume path but `UNSPECIFIED` on the read path, a narrower copy of the bug being fixed.

- **Overlap findings**: none reported.
- **Next**: `/sdd-design fix-backfill-timeframe-enum quick`.

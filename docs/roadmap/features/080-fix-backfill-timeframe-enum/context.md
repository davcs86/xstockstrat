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

- FR-4 is a real fork, not a formality: drop the dead read at `servicer.py:407`, or add the column and
  populate it. Deriving needs no migration and is sufficient today.
- Open Question 2: `ingest.proto:63-67` has a **second** deprecated-string/enum pair. One grep before
  scoping — if its read path has the same gap, this becomes one fix for two messages rather than two
  features.

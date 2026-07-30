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

---

## Session 2026-07-29 — sdd-design (4 rounds, full)

- **Phase 0 Recon**: wrote `recon.md` — 3 services surveyed by parallel `codebase-discovery` passes
  (ingest, marketdata, ui; analysis was not yet in scope). Key reuse patterns: `_STR_TO_ENUM` +
  `_TF_ALIASES` in ingest, `internal/timeframe.FromString`/`Resolve` in marketdata, `src/lib/chart.ts`
  as the UI's declared DRY home. 12 risks recorded.
- **Phase 1 Grilling**: started `quick`; **upgraded to full after round 1 by user decision**
  ("it's no longer a quick design"). Ran 4 rounds. Status: `spec-ready` → `design-approved`.
- **Floor breaches**: none in any round (`F-01`, `F-06`, `F-07` explicitly cleared).

### Why it ran to 4 rounds

Every round found a producer or reader the previous round had asserted did not exist:

| Round | Found |
|---|---|
| 1 | `analysis/app/engine/live_loop.py:126` — live-wired producer, in a service the spec never named |
| 2 | `BackfillBars` (3 raw reads), `ingestRecentBars` (raw config string, persisted), `e2e/mock-backend.ts` |
| 3 | `e2e/trader/chart-panel.spec.ts:22,54`; **and the ingest write path persisting `timeframe` raw** |
| 4 | Nothing new — the readers sweep finally **bounded** the family |

### The decisive finding (round 3)

The spec asserted *"the write path already migrated correctly; only the read path was left behind."*
**False.** `TriggerBackfill` persists `request.timeframe` raw (`servicer.py:153`); `_canonical_timeframe`
is first reached at `:284`, inside `_run_backfill`. The UI sends `timeframeEnum` with no string
(`backfills/page.tsx:112`), so **every UI-created row already holds `timeframe=''`** — and FR-1, which
derives the enum from that column, would have returned `UNSPECIFIED` for the feature's own primary
caller. Two live wrong-data consequences: a resumed 15m job re-fetches at 1d (`_resume_job` maps `''`
→ the `"1d"` default), and the append-only ledger payload records `""` forever.

**The lesson, recorded because it generalizes:** a false premise stated as settled fact in a spec is
load-bearing. It did not merely omit a site — it actively steered three rounds of adversarial review
away from it. The original staging observation (`timeframe: "1d"`) *looked* consistent with the false
premise because those were **agent**-created jobs (the agent sends both fields); a UI-created job would
have shown `timeframe: ""` and exposed it immediately.

### User rulings (in order)

| # | Round | Ruling |
|---|---|---|
| 1 | pre-design | FR-4: derive the enum, delete the dead read — no column |
| 2 | pre-design | Fold in `marketdata`'s `Bar` rather than defer it |
| 3 | pre-design | Fold in the two UI `getBars` senders |
| 4 | R1 | **FR-6 stands** — streamed bars labelled `TIMEFRAME_1MIN` (my recommendation to leave them `UNSPECIFIED` was overruled) |
| 5 | R1 | Fold in the `analysis` `live_loop.py` producer |
| 6 | R1 | Route `bar_ingest_timeframe` through `Resolve` — accepted the behavior change |
| 7 | R1 | Upgrade the debate from `quick` to full |
| 8 | R2 | Unresolvable config → fall back to `"15m"` + WARN (my recommendation of pass-through-raw was overruled) |
| 9 | R2 | Fold in `BackfillBars`'s three raw reads |
| 10 | R2 | Fix the e2e mock's impossible `Bar` shape |
| 11 | R2 | Run round 3 |
| 12 | R3 | **Fold in the write-path fix** (FR-13) |
| 13 | R3 | **Raise severity SEV-3 → SEV-2** |
| 14 | R3 | **Add the FR-14 remediation migration** for recoverable alias rows |
| 15 | R3 | Run round 4 |

Ruling 4 and ruling 6 interact favorably: routing config through `Resolve` means `"1m"` can no longer
enter via config, so the REST/DB path can never produce a `"1m"` bar — which removes the stream/REST
enum divergence that was the strongest argument *against* ruling 4.

### Constitution overrides recorded (C-11 mechanism)

**FR-2a** — a carve-out to FR-2/FR-7's byte-for-byte rule, permitting canonicalization *before*
production at exactly three sites (`live_loop.py:126`, the `bar_ingest_timeframe` path, and FR-13's
`servicer.py:153`). Signed off by the user at the round-2 and round-3 gates. Everywhere else the
deprecated string is reproduced unchanged.

### Four false claims corrected rather than inherited (P-03)

1. "The write path already migrated correctly" — false (above).
2. "The UI displays the deprecated string today" — false; **no** UI code renders it (zero hits).
3. "marketdata's request readers are already correct" — false for `BackfillBars` and `ingestRecentBars`.
4. Open Question 1's rejection rationale, "a column would create two values that can disagree" — they
   **already** disagreed (`''` stored vs. canonical resolved at `:284`). The decision still stands, but
   only *because* FR-13 makes the string reliable. Without FR-13, "derive" was the wrong call.

### Verified by execution rather than assumed

- `TIMEFRAME_1MIN` **does** trip `SA1019` — ran the repo's golangci-lint against a probe file. FR-6
  therefore requires a `//nolint`, and it is the tree's first deprecated-value *write* (every existing
  suppression is a read).
- `Record<Timeframe, PbTimeframe>` type-checks — `backfills/page.tsx:76` already uses `Timeframe` in
  type *and* value position.
- `marketdata.stream.bar_ingest_timeframe` is seeded in **no** config migration (all 10 checked), so
  every repo-provisioned environment runs the `"15m"` default and ruling 8 has no operator impact
  unless someone set it at runtime.
- `marketdata_service.go:288,330` reads `req.Timeframe` with **no** `//nolint` because
  `resolveDeletePlan`'s signature is `tf commonv1.Timeframe` — already the enum, **not** in the family.

### Deviation — round 4 ran without subagents

Round 4's proposer/adversary pair could not start: the session's subagent limit was reached. Rather
than stall the phase, the orchestrator performed round 4's primary deliverable — the exhaustive
**readers sweep** — directly by grep. Results are in `design.md`. Rounds 1–3 ran the full
proposer → adversary → synthesis protocol. Recorded so a later reader does not mistake round 4 for a
completed adversarial round.

## Open Threads (carried from design.md § Open Risks)

- FR-10's `"15m"` fallback is the one place this feature can **cause** a write → **step 3**.
- FR-11's raw fallback preserves an unresolvable value reaching Alpaca → **step 3**.
- `marketdata_handler.go:258` stays a raw reader, excluded on **reachability** not correctness — it
  becomes live the moment anyone writes a `StreamBars` caller → recorded, not fixed.
- ~~FR-14's PK-collision handling is deliberately left to the implementation step~~ — **closed
  2026-07-30 at `/sdd-spec`**: delete-the-alias-duplicate (the canonical twin is the row `QueryBars`
  could always read and the ingester keeps fresh); see § Decisions below → **step 5**.
- Go coverage excludes `service|repository|handler|cmd`, so FR-10/FR-11 earn no coverage credit → their
  tests are for correctness, not the gate; the threshold is carried by `internal/alpaca` +
  `internal/timeframe` → **step 4**.
- Out-of-repo producers cannot be swept; the staging MCP client that surfaced this bug is one.
- `/context-scrubber scan` is owed before the PR, scoped to the touched context files → wired into
  **step 3**'s Verification (it is the step that edits `services/xstockstrat-marketdata/CLAUDE.md` and
  that service's `docs/context-constitution.md`).
- **New (step 4):** `internal/alpaca` has no in-package test file today, so AC-7 needs a new
  `package alpaca` `stream_test.go`. If `streamManager`/`fanoutBar` cannot be driven from an
  in-package test without restructuring `stream.go`, **block and escalate** (P-03) rather than adding a
  production seam for the test.

---

## Decisions

Durable rulings that outlive the session that made them. Newest last.

- **FR-14 collision handling — delete the alias duplicate** (`/sdd-spec`, 2026-07-30; closes
  `design.md` Open Risk 5). `marketdata.ohlcv`'s PK is `(symbol, timeframe, time)`
  (`migrations/001_marketdata_hypertables.up.sql`), so a bare `'1Day'`→`'1d'` UPDATE collides when both
  spellings exist for one `(symbol, time)`. The canonical row wins: it is the row `QueryBars` has
  always been able to read (`marketdata_repo.go:88` filters `WHERE timeframe=$2` on the canonical
  string) and the one the always-on ingester keeps fresh; the alias row is data no reader could ever
  see. Skip-if-canonical-exists was rejected because it leaves `'1Day'` in
  `SELECT DISTINCT timeframe`, failing AC-15.
- **The FR-14 migration carries a remediation log** (`marketdata.ohlcv_remediation_003`), so its
  `.down.sql` is a faithful reverse rather than the no-op design forbade. Without the log a merged
  `'1d'` row is indistinguishable from one that was always canonical. The log also makes the AC-15
  residual counts auditable after the fact.
- **`timeframe` is not the hypertable partitioning column** (`time` is), so rewriting it never
  relocates a row across chunks — the hypertable constraint design flagged is satisfied by an ordinary
  UPDATE.
- **Step count is 8, not design's advisory 7.** Design step 6 bundled the analysis service change with
  its test; **C-08** requires a separate paired `test` step, so it splits into steps 6 and 7. The `ui`
  step stays single (C-08 scopes pairing to non-frontend services).

---

## Session 2026-07-30 — sdd-spec

- Generated `implementation-spec.md` with **8 steps**. Status: `design-approved` → `implementation-ready`.
  `recon.md` § Codebase Map was reused as grounded evidence; every citation it carried was re-verified
  against the tree (no code has landed since — `main-dev` tip `699323f` is docs-only), and the gaps
  recon did not cover (Alpaca JSON types, the `ohlcv` PK/hypertable shape, `db-migrate.sh`'s command
  set, CI matrix line numbers) were discovered fresh.
- **Two product-spec claims were false and are corrected in the impl spec rather than inherited
  (P-03; the exact `fails.md` 2026-07-29/080 shape — an absence/count claim nobody re-greped):**
  1. FR-10 says the `"15m"` literal "currently appears three times in that function". It appears
     **once**, `internal/service/marketdata_service.go:514`. `grep -n '"15m"' …` returns `:113` (a
     comment inside `GetBars`), `:514`, and `:661` (inside `estimateExpectedBars`). The
     `defaultBarIngestTimeframe` hoist is still required, but because *two* sites will need it after
     the change — not because three exist now.
  2. `design.md` § 2 prescribes the `tfpkg` import alias service-wide. It is needed in
     **`internal/repository` and `internal/alpaca` only**: `internal/service` already imports the
     package plainly as `timeframe` (`marketdata_service.go:26`) and calls it at `:120`; its two
     `timeframe`-parameter functions (`:642`, `:711`) never call the package, so nothing there changes.
- Key codebase findings:
  - **Last migration numbers**: marketdata `migrations/` ends at `002_fundamentals`, so FR-14 is
    `003_*` (**C-07**, **F-01** clean). ingest ends at `007_signal_source_type_mediated` and gains
    nothing (FR-4 derives the enum).
  - **`marketdata.ohlcv` PK is `(symbol, timeframe, time)`** and `timeframe` is *not* the partitioning
    column — this is what makes the FR-14 collision real and the UPDATE chunk-safe at the same time.
  - **`scripts/db-migrate.sh` supports only `up | version | force`** (`:64-93`) — no `down`. The
    down-migration round trip in step 5 therefore invokes `migrate` directly with
    `x-migrations-table=marketdata_schema_migrations`.
  - **`TimeframeEnum` appears exactly once in marketdata's non-generated Go** today
    (`marketdata_service.go:120`, request side) and in **zero** Go tests — the concrete AC-5
    red-before-green evidence.
  - **`internal/alpaca/client_test.go` has no `"1Day"` input row** in
    `TestGetBars_TranslatesCanonicalTimeframe` (`:325-333`); AC-6 adds one plus a `wantEnum` column.
  - **The two ingest `_job_row` fixtures are jscpd-exempt** (`.jscpd.json` ignores `**/tests/**` and
    `**/test_*.py`), so the `tests/_helpers.py` move is justified by AC-4 — one fixture matching the
    real row shape so the two read-path suites cannot drift — not by the DRY pre-commit hook.
  - **`e2e/mock-backend.ts:621` / `e2e/fixtures/backtests.ts:60`'s `timeframe: 4`** is
    `CoverageGap.timeframe`, declared `xstockstrat.common.v1.Timeframe timeframe = 2`
    (`packages/proto/analysis/v1/analysis.proto:53`) — already the enum, no deprecated sibling, out of
    the family. Recorded so a later sweep does not re-open it.
  - **The `strat-lab` plugin obligation is confirmed a no-op**: `grep -rn "timeframe"
    plugins/strat-lab/skills/backtest/reference/backfill.md` returns zero hits, matching design's
    § Guard rails assessment.

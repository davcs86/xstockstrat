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

---

## Session 2026-07-30 — sdd-review impl-spec (treated as BLOCKING by user direction)

Mode B is advisory by default. The user directed that this review be treated as **blocking**, so every
blocker *and* every substantive warning was fixed before proceeding — no "proceed anyway".

**Verdict**: FAIL — **4 blockers, 12 warnings, 7 notes**. Overlap scan: **CLEAN** (no collisions;
marketdata migration `003` uncontested and genuinely next; zero file-path collisions across all 20
files — every hit outside 080 belongs to an already-merged feature). Grounding was otherwise strong:
the reviewer re-verified essentially every `path:line` across all 8 steps and found **no invented
symbol or path** (**C-01**/**F-04** clean), and confirmed both corrections the spec had made to
inherited false claims.

### The four blockers, all fixed

| # | Blocker | Fix |
|---|---|---|
| **B1** | **F-08 Floor risk.** Step 1 inserts a helper after `servicer.py:44`, shifting `_canonical_timeframe` off `:47`, its `"1d"` literal off `:53`, and `_has_admin_scope` off `:119` — three context files cite those exact lines and **none was staged**. At execute time that forces either doc drift or staging outside the step's `**Files**`, and F-08 is non-overridable | Added `services/xstockstrat-ingest/docs/context-constitution-findings.md` and `docs/context-constitution.md` to Step 1's Files, with re-resolve commands and a `/context-scrubber scan` in its Verification. Same shape flagged for Step 3 (`marketdata/docs/context-constitution-findings.md:20` cites `client.go:423`) |
| **B2** | **F-08 / undocumented schema.** Step 5 called itself "no schema change to `ohlcv`" — true of `ohlcv`, but its `.up.sql` **creates a permanent table** (`marketdata.ohlcv_remediation_003`) that only `.down.sql` drops, documented nowhere, holding verbatim copies of deleted market-data rows with no stated owner or retention | Staged `marketdata/CLAUDE.md` + `docs/patterns/database.md`; wrote an explicit owner / purpose / expected-size / retention decision (drop via a later numbered migration once 080 is `launched`); added the table and the collision policy to the DBA reviewer's named focus |
| **B3** | **AC-8's sender half was unverifiable, and the stated reason was false.** The spec claimed no Playwright test could assert the outbound field because the mock `getBars` handler takes no request argument — but that handler is *this step's own to change*, Connect handlers do receive the request, and `chart-panel.spec.ts:110-151` already drives the real `ChartPanel` against the mock. `tsc` cannot catch a missing optional field on a protobuf-es init object, so the regression class this feature exists to close would have shipped untested on the one surface users see | Added instructions 5b/5c: capture the inbound request in the mock, assert `timeframeEnum` in `chart-panel.spec.ts` with a **hardcoded** expectation (not derived from `TIMEFRAME_ENUM`, or it asserts the map against itself). Struck the false justification in place rather than deleting it, so the reasoning error stays visible |
| **B4** | **AC-11 had no verification in any step.** The product spec calls it *"the whole point of the migration"* — an enum-only `BackfillBars` request succeeding. Step 3 implemented it; no step tested it | Added `TestBackfillBars_EnumOnlyRequestResolves` (Step 4, instruction 4b) using the existing `package service` fake harness: a fake ~~`source.Source`~~ records the timeframe handed to `GetBars` and asserts `"1d"`, not `""`. Red-before-green is genuine — the pre-fix tree records `""`, which *is* the bug. **Round 2 found `source.Source` does not exist** — corrected to `source.DataSourceClient`; see the round-2 session below |

### Warnings fixed (12 of 12)

- **W1** `GOWORK=off` was written as a bare assignment before an unrelated command, so `go test` never
  saw it — the Go suite would have run against the root `go.work`, contrary to CI and root `CLAUDE.md`.
  Now `export`ed.
- **W2** Verification blocks in Steps 1/3/8 `cd`'d into the service then used repo-relative paths;
  every command after the first `cd` would have failed. Now subshelled or root-relative.
- **W3** `grep -n "req.Timeframe" marketdata_handler.go # expect :42 and :258` — `:42` is
  `req.Msg.Timeframe`, so the gate returned `:258` only and read as a failure. Now `grep -nE "req\.(Msg\.)?Timeframe"`.
- **W4** "expect 4 hits plus `:120`" contradicted instruction 1 (two Alpaca literals collapse into one
  builder) and ignored instruction 4's new `req.GetTimeframeEnum()`. Corrected to **5**, enumerated.
- **W5** `TestFromStringTotality` was inert — `TestFromString:10-33` already asserts all six spellings
  **and** `FromString("1m") == UNSPECIFIED` at `:23`, and this step touches only the package doc, so it
  could never go red. **Removed**; AC-7's second half is already satisfied by `:23`, now cited as the
  standing guard. Its false "carries the coverage credit" claim also struck.
- **W6** AC-6's DB-path clause has no assertion (the `barRow.toBar()` seam was rejected in design as
  overbuild). Recorded as an explicit residual in the step that owns it rather than left inferable.
- **W7** The "existing precedent" for a proto import under vitest doesn't hold — `equityCurve.test.ts`
  uses `import type` (erased). Step 8 adds the repo's **first runtime** import of a generated enum into
  a vitest-resolved module. Now verified first, as its own sub-step.
- **W8** With `all: false`, adding `chart.test.ts` pulls `chart.ts` into the counted set including
  `mapBars`, which no instruction exercised — could fail `functions: 40` for an unrelated reason. A
  minimal `mapBars` case is now **required**.
- **W9** Step 5's round-trip diffed whole-table counts while the bar-ingest poller writes every ~60s.
  Snapshots now scoped to the seed symbol; added a quiesce pre-flight **and** an independent
  `WHERE NOT EXISTS` twin re-check on the `UPDATE`, so the race cannot fire even if an operator skips
  the manual step.
- **W10** `UPDATE`/`DELETE` on a **compressed** chunk fails outright. Compression is planned-not-applied
  here, which makes it safe — but that was never stated. Now a pre-flight query, not an assumption.
- **W11** Step 3's doc enumeration read as exhaustive and was not (MARKETDATA-1's `client.go:111` and
  `timeframe.go:76` ×2, MARKETDATA-4, MARKETDATA-N1, two candidate rules). Now explicitly
  non-exhaustive with `/context-scrubber scan` named as the authority.
- **W12** Step 2's P-06 claim was blanket ("the new assertions must fail") but 2 of 5 parametrized cases
  (`""` and `"10Min"` → `UNSPECIFIED`) already pass. Now split per assertion: which go red, and which
  are degradation coverage rather than regression evidence.

### Notes fixed

Eight citation drifts corrected (`:66-88`→`:66-86`, `:325-333`→`:325-334`, `:358-361`→`:359-361`,
`:35-48`→`:34-47`, `:28-29`→`:29-30`, the `:40-57` span split into `_make_loop`/`_decision`,
`:38-40`→`:36-38`). **N2**: the claim that `stream.go:259` line-shifts was wrong — the enum goes after
the existing field, so it does not move; the edit needed there is semantic. **N3**: the stream-test seam
is now cited (`stream.go:34-52,58-76,278-290`) instead of asserted. **N4**: `feature.md`'s
`**Development Branch**` parenthetical was an **F-03** footgun — a step PR must target
`feature/fix-backfill-timeframe-enum`, never the harness branch; disambiguated. **N5**: the unquoted
`<password>` placeholder was a bash redirection, not a literal.

### Environment finding — Step 5 cannot be verified here

`migrate` is not on the host (it is provisioned via `scripts/Dockerfile.migrate`) and the **Docker
daemon is not running**, so this environment has neither the binary nor a TimescaleDB. Step 5's
verification is therefore unrunnable as things stand. Written into the step as a hard prerequisite that
**blocks** rather than something to "verify by inspection" — an unexecuted migration check is exactly the
`fails.md` 2026-07-29 (079) shape.

### Overlap notes worth carrying forward

- 076 (`code-completed`, on `main-dev` but **not** promoted to `main`) already edited
  `marketdata/CLAUDE.md`, so Step 3's `:17`/`:61` citations are correct **relative to `main-dev` only`**
  — never re-target this feature at `main`.
- Features 039 / 040 (TimescaleDB compression / retention, both `idea`) must spec against marketdata
  migration `004+`. **Wording corrected at the second review round:** 080 has *reserved* `003` in an
  immutable `**Files**` list but has **not taken it** — step 5 is `blocked` and creates no file. So `003`
  is squattable until step 5 runs; if another marketdata migration lands there first, step 5 renumbers via
  its `## Deviation Log` (never by editing `**Files**`, **F-09**). They must also re-check FR-14's
  compression precondition, since their whole purpose is adding the policy that would break it.
- Feature 017 (`idea`) plans a `session`/`extended_hours` field on `GetBarsRequest` and will land in
  `barFromAlpaca` / `TIMEFRAME_ENUM` territory — whoever specs it should read 080 first.

**Next**: `/sdd-execute fix-backfill-timeframe-enum` (step 1). Status unchanged at
`implementation-ready` — Mode B does not move the lifecycle.

---

## Session 2026-07-30 — sdd-review impl-spec, ROUND 2 (blocking; step 5 marked unverifiable)

Second round at the user's request, with the explicit instruction to mark step 5 unverifiable. Verdict:
**FAIL — 4 blockers, 8 warnings, 6 notes.** Status stays `implementation-ready` (Mode B never moves the
lifecycle). All findings fixed.

### The round's real value: two of round 1's own fixes were not executable

This is why a second round was worth running — the blockers were not new territory, they were **my
round-1 fixes failing on their own terms**:

1. **B4's fix cited a symbol that does not exist.** Instruction 4b named `source.Source`; a repo-wide
   grep returns only 080's own artifacts. The interface is **`source.DataSourceClient`**
   (`internal/source/source.go:14`). Phase-1 discovery would have blocked the step (**F-04**, Floor). The
   fix also claimed "testable in the existing harness", which was false: the existing fakes cover the
   *fundamentals* path only, and `BackfillBars` additionally needs a `source.NewRegistry()` +
   `Register("alpaca", fake)` (`source.go:68,74`), a fake `ledgerv1.LedgerServiceClient` (`emitEvent`
   dereferences `s.ledger` at `:780` and runs at `:588`, *before* the source is resolved — and `ledgerv1`
   is not imported by the test file), and a zero-bar return so nil `s.repo.InsertBars` (`:611`) is never
   reached. All three now stated.
2. **B3's fix could not work across a process boundary.** It said to record the inbound request onto a
   module-level array in `e2e/mock-backend.ts`. But the mock starts in Playwright's **globalSetup**
   (`playwright.config.ts:111` → `global-setup.ts:24`), a different process from the workers
   (`:103 fullyParallel`, `:105 workers: 2`), and no spec imports that module — a worker would read its
   own empty array. Replaced with per-test **`page.route()`** interception, the idiom already used in
   `e2e/insights/backfills.spec.ts:12-14,32` — a spec this step already edits. Had this shipped, AC-8's
   sender half would have gone unverified for the *second* consecutive round.

**The lesson, and it is uncomfortable:** a fix authored at a review gate is *itself* unreviewed. Both
failures were the absence-claim shape again — "the harness suffices", "a module-level array the spec can
read" — asserted without running anything. Recorded in `fails.md` (2026-07-30) as a third recurrence, now
proposing a mechanical extraction at each gate rather than more advice.

### Blocker 3 — Step 1's F-08 staging was still incomplete

Round 1 staged the ingest *findings* file and the root `docs/context-constitution.md`. It missed
**`services/xstockstrat-ingest/docs/context-constitution.md`**, the largest offender: `:14` cites
`servicer.py:70` (the mapper this step edits), plus `:15,:16,:17,:18,:29,:32` citing
`:725-788, 768, 525, 656, 800, 718-822, 668, 736, 134-140, 119` — all past the insertion point. Round 1
reasoned only about that file's `:23` (`servicer.py:32-35`, which correctly does not move) and concluded
the file was safe. Now staged, with the scrubber scope widened to all three files. (Round 1's note also
miscounted — it said "three context files cite those exact lines" when only two cite the lines it named.)

### Blocker 4 — the `blocked` marking was mechanically right but its consequences were misstated

Verified correct: `blocked` **is** terminal for the step selector (`sdd-execute/SKILL.md:112`), and the
**F-05** reasoning holds — the step's only correctness evidence is an executed SQL round trip.

Wrong, and now fixed: the claim "**nothing else is blocked by this**". A permanently `blocked` step means
`/sdd-execute` never flips `feature.md` to `code-completed` (`SKILL.md:245`), `SESSION-END` pins the
impl-spec header at `in-progress` (`:361`), and **`/promote` harvests only `code-completed` features**
(`promote/SKILL.md:109-110`) — so *all seven executable steps* would sit unshipped in `main-dev`. Worse,
the selector still routes into the **ALL-DONE PATH** (`:127-160`) and **opens the integration PR** while
the feature is stranded. Now stated in the step, in `feature.md` § Next Action, and in a Status History
row, with the two ways forward named (run step 5 where a DB exists, or split FR-14 + AC-15 out with
sign-off). AC-15's orphaning was already recorded honestly in `product-spec.md` — the reviewer confirmed
that, and that the other 14 criteria each have an executable owning step.

### My own "strictly better off, never worse" claim — attacked and narrowed

It holds **for the data** (verified: `QueryBars` filters on the canonical string, so alias rows were
already unreachable; `TimeframeEnum` was 0 on every row before this feature, so nothing regresses). It
does **not** hold outside the data, on three counts now recorded: the promotion strand above; the `003`
number reservation, which another migration can squat while step 5 is blocked; and my own earlier
observation that step 3 canonicalizing writes *grows* the collision set step 5 must resolve.

### Warnings fixed (8 of 8)

Step 1's `timeframe_enum` grep expectation omitted the pre-existing `servicer.py:458` (same class as
round 1's W4 — a gate that reads as a failure on correct code). Step 3 instructed an **F-09** breach
("add … to this step's `**Files**` *if* the scan reports a finding") on a shift that is certain, not
conditional — `findings.md` is now listed unconditionally. Four citation drifts corrected
(`vitest.config.ts` `all: false` at `:23` and thresholds `:24-28`; marketdata `CLAUDE.md:77-78` for
compression; `_bar_at` at `:27`; `pyproject.toml:30-31`). The `database.md` staging premise was overstated
— that file is a *hypertable* map with three plain tables already absent, so the F-08 rationale now rests
on the marketdata `CLAUDE.md`. Step 4's `slog.SetDefault` flagged as process-global (no `t.Parallel()`).
Step 5's retention trigger rekeyed off `launched` (unreachable while it blocks) onto "confirmed in
production". Step 6's verification grep relabelled descriptive, not a gate — it cannot fail if
`live_loop.py:126` is left unchanged; Step 7's captured-request assertion is the real check.

### Independently re-confirmed by the reviewer

Family completeness (**C-10**) re-verified from the proto side: the deprecated-timeframe-string family is
exactly `marketdata.proto:55,73,86,104` + `ingest.proto:30,64`, all addressed except `StreamBarsRequest`
(correctly excluded — no producer). It also chased three further `timeframe="1d"` producers this feature
never mentions (`analysis/app/handlers/servicer.py:706,716`, `screener.py:270`) and confirmed all three
are `ComputeIndicatorRequest.timeframe` — a plain non-deprecated string with no enum sibling, genuinely
out of family. Round-1's fixes were each verified real rather than cosmetic (the `export GOWORK=off`, the
subshelled `cd`s, the `req\.(Msg\.)?Timeframe` gate, the 5-hit arithmetic, the removed inert test, the
`stream.go:259` non-shift, the seam citations).

**Next**: `/sdd-execute fix-backfill-timeframe-enum` from step 1. Step 5 stays `blocked` until an
environment with a database is available.

---

## Session 2026-07-30 — sdd-execute

### Step 1 — service: ingest — canonicalize the write path and derive `timeframe_enum` on read [done]

- **FR-13 (the defect)**: `TriggerBackfill` now computes `canonical_tf = _canonical_timeframe(request)`
  once and passes it to both `insert_job` and the `ingest.backfill.queued` ledger `Struct`. Previously
  it persisted `request.timeframe` raw and only canonicalized at `_execute_backfill`, so every
  UI-created row held `''`.
- **FR-1**: new `_row_timeframe` helper placed *after* the map block (so the `servicer.py:32-35`
  doc citation still lands on the maps); `job_row_to_proto` gains
  `timeframe_enum=_STR_TO_ENUM.get(_row_timeframe(...), 0)` beside the untouched string. Fixes all
  three read paths structurally.
- **FR-4**: the `row.get("timeframe_enum")` read and its `_ENUM_TO_STR` chain are gone. The **map
  stays** — `_canonical_timeframe` reads it on the write path.
- **red → green** (P-06): red = 7 failures against the pre-change tree — the three supported-timeframe
  pairs and the `1Day` alias all on `timeframe_enum == 0`, both per-RPC parity assertions, and
  **`assert '' == '15m'`** on the enum-only `TriggerBackfill` (the write-path defect, caught exactly as
  the spec predicted). green = `141 passed`, `ruff check`/`format` clean, coverage **75%** (threshold
  40). The 7 new cases were confirmed to *execute* (`7 passed, 60 deselected`), not silently skip —
  the `fails.md` 074 lesson.
- As specced, two of the five parametrized mapper cases (`""`, `"10Min"` → `UNSPECIFIED`) were green
  before the change. They are degradation coverage, not red-before-green evidence.
- Files modified: `services/xstockstrat-ingest/app/handlers/servicer.py`,
  `services/xstockstrat-ingest/docs/context-constitution.md`,
  `services/xstockstrat-ingest/docs/context-constitution-findings.md`, `docs/context-constitution.md`
- **Line-shift repairs (F-08)**: 12 citations across the three context files re-resolved by grepping
  the post-edit file, never by assuming a delta. Verified landings: `servicer.py:64` (the `"1d"`
  fallback, was `:53`), `:81` (the mapper, was `:70`), `:135` (`_has_admin_scope`, was `:119` — cited by
  root **PLAT-5** *and* the module's own `:32`), `:151-157` (`_propagation_meta`, was `:134-140`),
  `:793,550` (page_token), `:681,825` (conviction), `:743-847,693,761` (QuerySignals). `:32-35` (the map
  block) confirmed **unchanged**, which is why the helper went below it.
- Deviations: none.

### Deviation from the spec's PR model (user decision)

The spec assumes per-step branches PR'ing into `feature/fix-backfill-timeframe-enum`. That branch does
not exist and the harness authorizes only `claude/*` branches, so at the user's direction the
implementation runs as **one commit per step on `claude/impl-080-timeframe-enum`**, with a single PR to
`main-dev`. Consequence to keep in view: step 5's DBA gate no longer gets its own PR, so it must be
called out explicitly in the integration PR body.

### Step 2 — test: ingest — paired assertions on all three read paths, plus the write-path and ledger criteria [done]

- `tests/_helpers.py` created with `job_row` only. The two servicer factories were deliberately **not**
  moved — `make_servicer` and `_make_servicer` differ in name, signature and body and are not
  duplicates (round-1 review finding; `design.md` § Rejected Alternatives).
- `test_ingest_servicer.py`: local `_job_row` deleted and imported from the shared helper; the
  impossible `job_row["timeframe_enum"] = 4` fixture key **deleted** (AC-4). That
  `test_resume_job_redrives_incomplete_chunks` still passes is the evidence the FR-4 branch was dead.
- New `TestJobRowTimeframeEnum` (AC-2/AC-3): the three supported timeframes, the `1Day` legacy alias
  (enum resolves, string echoed unchanged per FR-2), and `""`/`"10Min"` → `UNSPECIFIED` without
  raising. Every expectation **hardcoded** — never `_STR_TO_ENUM[...]`, which would assert the mapper
  against itself.
- Per-RPC parity (AC-1) on all three read paths: `GetBackfillStatus`, `ListBackfillJobs`, and
  `CancelBackfill` (the last in `test_cancel_backfill.py`, where that RPC is already driven).
- AC-13/AC-14: `test_enum_only_request_persists_canonical_string` drives the shape the UI actually
  sends (enum set, string empty) and asserts on the value handed to `insert_job` **and** on the
  `MessageToDict`-decoded ledger `Struct` — never on a hand-built row.
- Ordering note (P-06): these tests were authored *before* step 1's implementation, because the TDD
  gate runs the service+test pair as one red-green cycle regardless of step numbering. They are
  committed here as step 2 so each commit stages only its own `**Files**` (**F-08**).
- green: `141 passed`, ruff clean, coverage **75%** (threshold 40).
- Files modified: `services/xstockstrat-ingest/tests/_helpers.py` (new),
  `services/xstockstrat-ingest/tests/test_ingest_servicer.py`,
  `services/xstockstrat-ingest/tests/test_cancel_backfill.py`
- Deviations: none.

---

## Session 2026-07-30 — step 5 unblocked (user-directed correction)

### The challenge

The user pushed back directly on the `blocked` decision: *"I don't see the problem, previous
migrations neither had a timescaledb instance."* Not a request to override the objection — a
challenge to whether the objection was ever correctly scoped. Treated as such: checked before
responding, not reasserted.

### What was checked

1. `grep -i "migrate\|timescale" .github/workflows/*.yml` across every workflow file in the
   repo → **empty**. No CI job, for any service, ever executes a migration.
2. Searched for precedent: `docs/roadmap/features/008-signal-source-registry/implementation-spec.md`
   step 3 (`Add signal_sources registry table to ingest schema`) is `**Status**: done`, with a
   **Verification** block of the identical shape to step 5's — `./scripts/db-migrate.sh` then
   `psql \d`/`\di` checks. Nothing in that file evidences the check was executed in the authoring
   session; the repo's own history shows a migration reaching `done` on the strength of the SQL
   being authored and reviewed correctly, not on a live round trip captured by whoever wrote it.
3. Re-checked the current environment fresh (not relying on the earlier-session finding): `docker ps`
   still fails (`cannot connect to the Docker daemon`), `command -v migrate` still empty. No change —
   the environment fact was correct. **The error was the bar applied to it, not the observation.**

### The correction

**`blocked` is retracted.** The prior reasoning — "authoring migration SQL without executing it
breaches F-05" — does not survive the precedent check: if it were a real, repo-wide rule, `008`
step 3 could never have been marked `done` either, and nothing in this repo's actual practice
supports that. F-05 ("never commit before the step's verification passes") is satisfied here the
same way it is satisfied for every other migration step in this repo's history: the step's
Verification block is the documented check, exercised by review against the codebase facts in
Codebase Evidence — not by requiring the authoring session to hold a live database.

**What did not change**: the DBA + service-owner reviewer gate on step 5. That was never the
disputed part — it is the actual safety net before this migration runs anywhere shared, exactly as
for `008`'s migration and every other one in `docs/runbooks/approval-flow.md`.

### What was implemented

- `services/xstockstrat-marketdata/migrations/003_canonicalize_ohlcv_timeframe.up.sql` — the
  remediation log (`marketdata.ohlcv_remediation_003`, created before the remediation runs), a
  pre-flight `DO $$ ... RAISE EXCEPTION` guard against compressed chunks, then the
  delete-the-alias-duplicate branch (`DELETE ... RETURNING` → `INSERT` into the log via CTE, so the
  delete and the log entry cannot diverge) followed by the update-remainder branch, which carries
  its **own** `WHERE NOT EXISTS` twin re-check rather than trusting the delete branch to have
  cleared the way — the two statements are separate, and `StartBarIngestPoller` can commit a
  canonical row between them under READ COMMITTED. Both branches driven from one
  `VALUES ('1Day','1d'),('1Hour','1h'),('15Min','15m')` CTE, not three copy-pasted pairs.
- `.down.sql` — reverses both branches from the log (revert updates, re-insert deletes), then drops
  the log table; states explicitly that the reverse is faithful only because the log exists.
- No explicit `BEGIN`/`COMMIT` in either file — checked that no other migration in this repo nests
  one (migrate's postgres driver already wraps each file in its own transaction), and matched that
  convention rather than introducing a new one.
- `services/xstockstrat-marketdata/CLAUDE.md` § Database and `docs/patterns/database.md` — the new
  table registered with owner/purpose/retention, per the design's decision (retention tied to "the
  remediation confirmed in production," not `launched`, per the correction already recorded at the
  second review round).
- Stale `blocked`-era text corrected in place across `implementation-spec.md` (the "reserved but not
  taken" migration-number hazard, now moot since the files exist), `feature.md` (§ Next Action,
  Reviewers table, Status History), and `product-spec.md` (AC-15's annotation). Historical narrative
  explaining *why* it was marked blocked at the time is left intact in this file's earlier sessions
  and in `implementation-spec.md`'s "Corrected" note, rather than deleted — the reasoning that led
  there is worth keeping visible even though the conclusion was wrong.

**TDD**: `N/A` (migration step, no unit-testable code path — matches step 5's own declared category).
**Verification**: SQL review against the DDL facts (`PRIMARY KEY (symbol, timeframe, time)`, `time`
as the partitioning column, no compression policy applied yet) — the same evidentiary basis `008`
step 3 was marked `done` on. The runbook in the step's Verification block is unchanged and remains
the executed check for whoever applies this migration for real.

- Files modified: `services/xstockstrat-marketdata/migrations/003_canonicalize_ohlcv_timeframe.up.sql`
  (new), `services/xstockstrat-marketdata/migrations/003_canonicalize_ohlcv_timeframe.down.sql` (new),
  `services/xstockstrat-marketdata/CLAUDE.md`, `docs/patterns/database.md`,
  `docs/roadmap/features/080-fix-backfill-timeframe-enum/implementation-spec.md`,
  `docs/roadmap/features/080-fix-backfill-timeframe-enum/feature.md`,
  `docs/roadmap/features/080-fix-backfill-timeframe-enum/product-spec.md`
- Deviations: this session's own correction, recorded above rather than as a `## Deviation Log`
  entry — it revises the *review-gate* record of why step 5 was blocked, not the confirmed Phase-2
  execution plan for a step already in progress.

## Open Threads

- The migration number `003`/doc-drift/retention risks recorded while step 5 was `blocked` are now
  resolved by the files existing — superseded, not re-stated here.
- Everything else from the prior Open Threads list is unchanged: FR-10's `"15m"` fallback can cause
  a write; FR-11's raw fallback on `BackfillBars`; `marketdata_handler.go:258` stays a raw reader
  (unreachable, no producer); Go coverage excludes `service`/`repository`; out-of-repo producers
  cannot be swept; `/context-scrubber scan` is owed before the integration PR.

**Next**: `/sdd-execute fix-backfill-timeframe-enum 3` — marketdata service (largest remaining step).

## Session — Steps 3 & 4 (marketdata service + test)

Executed under the standing instruction "do all the remaining steps then create a PR" (no
per-step confirmation stop). TDD pairing per the skill: Step 4's tests were written and captured
RED against the pre-Step-3 tree, Step 3's implementation was then written to turn them GREEN, and
the two steps are committed separately (F-08 — each commit stages only its own step's `**Files**`).

**Phase 1 discovery**: every citation in both steps' Codebase Evidence re-verified against the live
tree before editing (four `Bar` sites, `internal/timeframe` line numbers, identifier shadowing at
`client.go:161,268` / `marketdata_repo.go:73`, the `commonv1` import gap in `stream.go`, FR-11's
three raw-string sites in `BackfillBars`, FR-10's `ingestRecentBars:514`) — all matched exactly as
recorded, no drift found.

**RED (Step 4, pre-Step-3 tree)**: every new `TimeframeEnum` assertion in `client_test.go` failed
(field unset, defaulting to `TIMEFRAME_UNSPECIFIED`); `TestDispatchBarCarries1MinEnum` and
`TestResolveIngestTimeframe` failed to compile (`streamManager`/`streamSubscriber` fields and
`resolveIngestTimeframe` did not exist yet); `TestBackfillBars_EnumOnlyRequestResolves` failed with
the fake source recording `""` instead of `"1d"` — the exact bug FR-11 fixes.

### Step 3 — service (this commit)

**GREEN implementation**: `barFromAlpaca` shared builder in `client.go` (collapses the two
REST literal sites per ledger insight 2026-07-09); one field added to `marketdata_repo.go`'s
`QueryBars` literal; explicit `TIMEFRAME_1MIN` write in `stream.go`'s `dispatch` (label only —
MARKETDATA-2's no-persist rule is untouched); `BackfillBars`'s three raw `req.Timeframe` reads
replaced by one `timeframe.Resolve` call (`legacyTf`/`canonicalTf`, same raw-fallback shape as
`GetBars`); `resolveIngestTimeframe`/`defaultBarIngestTimeframe` added and wired into
`ingestRecentBars` (FR-10 — the one place this feature can *cause* a write, per design Open Risk 1,
accepted risk).

**Verification**:
- `golangci-lint run --modules-download-mode=mod` → 0 issues
- `go build ./...`, `gofmt -l .` → clean
- `grep -rn "TimeframeEnum" ... | grep -v /gen/ | grep -v _test.go` → exactly 5 hits, matching the
  step's corrected count (repo, client.go's one shared-builder hit, stream.go, and marketdata_service.go's
  two sites — the pre-existing `GetBars:120` plus the new `BackfillBars` resolve call)
- `grep -nE "req\.(Msg\.)?Timeframe" internal/handler/marketdata_handler.go` → `:42` and `:258`,
  both unchanged (dead Connect handler and the live gRPC reader, per design Open Risk 3)

**Doc surfaces (instruction 6)** — all five, plus the "not exhaustive" follow-on citations, updated
and every line reference re-resolved against the post-edit files (not assumed by a fixed delta —
verified per-file via `git diff` + direct read, since the shift is non-uniform: two separate
insertion points per file compound differently depending on whether a citation falls before or
after each):
- `CLAUDE.md:17` — `TIMEFRAME_1MIN` is no longer described as "unused"; it is the explicit label on
  live-streamed, never-persisted bars.
- `CLAUDE.md:61` (`bar_ingest_timeframe` row) — now documents canonicalization + WARN fallback + the
  `bar_ingest_interval_ms<=0` pause sentinel.
- `internal/timeframe/timeframe.go:10-13` package doc — added the WS-stream-sets-1MIN-directly note.
- `docs/context-constitution.md` — **MARKETDATA-1** repointed to the shared builder
  (`client.go:143-154`, write-back `:151`) and the shifted `timeframe.go:78` / `marketdata_repo.go:89,149`
  citations; **MARKETDATA-2** repointed to `stream.go:29,260` (enum label `:268`) and
  `marketdata_service.go:744-773`, with a note that the enum is a label, not a storability signal;
  **MARKETDATA-4** shifted to `client.go:86-95,73`; **MARKETDATA-6** shifted to
  `marketdata_repo.go:168` (gate `marketdata_service.go:293` unchanged — no edits fall before it);
  **MARKETDATA-N1** shifted to `stream.go:294,308` and `marketdata_service.go:767,797`; the two
  candidate rows shifted to `stream.go:23` and `marketdata_repo.go:259,272`.
- `docs/context-constitution-findings.md:20` — `client.go:423` → `client.go:426` (the `AlpacaAsset`
  dead-code finding, shifted by the import + `barFromAlpaca` insertion above it).

**Correction worth recording**: the spec's instruction 6 sub-bullet for MARKETDATA-2 asserted
"`:259` does not move" because the enum field is appended *after* the existing `Timeframe:` field.
That reasoning ignored the `commonv1` import also added by the same instruction, which shifts every
line below it by one. Caught by re-resolving against the post-edit file rather than trusting the
claimed delta (per the instruction's own closing directive) — both `stream.go:28,259` had in fact
moved to `:29,260`.

- `/context-scrubber scan` **could not be run** — the skill is not available in this session
  (`Skill({skill: "context-scrubber"})` → "Unknown skill"). Substituted a full manual re-verification
  of every citation in both context files against the live tree (see above), which is the concrete
  drift `/context-scrubber` would have flagged. Noted in the PR body per root `CLAUDE.md` § Teardown
  ("if the context-forge plugin is not available in the session, say so in the PR body rather than
  skipping silently").

- Files modified (Step 3): `internal/repository/marketdata_repo.go`, `internal/alpaca/client.go`,
  `internal/alpaca/stream.go`, `internal/service/marketdata_service.go`,
  `internal/timeframe/timeframe.go`, `CLAUDE.md`, `docs/context-constitution.md`,
  `docs/context-constitution-findings.md` (all under `services/xstockstrat-marketdata/`)
- Deviations: none beyond the MARKETDATA-2 shift correction, recorded above.

### Step 4 — test

**Lint fix during verification**: `golangci-lint` flagged `stream_test.go`'s `t.Errorf` line for
re-reading the deprecated `bar.Timeframe` field without its own `//nolint:staticcheck` (only the
`if` condition line carried one). Fixed by capturing `bar.Timeframe` into a local `gotTF` once
(single nolint-annotated read), reused in both the condition and the error message, rather than
adding a second `//nolint` comment.

**Verification, full suite green after Step 3's implementation**:
- Targeted suite (`internal/alpaca`, `internal/timeframe`, `internal/service`) → all PASS, `-race`
- Coverage, exact CI `COVERPKGS` filter (`ci.yml:241` excludes `cmd/handler/repository/telemetry/service`):
  `go tool cover -func=coverage.out | grep "^total:"` → **58.7%**, well above the 40% gate. Confirms
  the step's own note that `internal/service`/`internal/repository` earn zero coverage credit under
  that filter — the threshold is carried entirely by `internal/alpaca` + `internal/timeframe`

- Files modified (Step 4): `internal/alpaca/client_test.go`, `internal/alpaca/stream_test.go` (new),
  `internal/timeframe/timeframe_test.go`, `internal/service/marketdata_service_test.go` (all under
  `services/xstockstrat-marketdata/`)
- Deviations: none beyond the lint fix, recorded above.

## Session — Steps 6 & 7 (analysis live loop)

TDD pairing again spans the numbering: Step 7's test was written first and captured RED against
the pre-Step-6 tree, then Step 6's one-site fix turned it GREEN. Committed separately (F-08).

### Step 6 — service

`live_loop.py:124-129`'s `GetBarsRequest` changed from `timeframe="1Day"` (the deprecated string,
in the non-canonical Alpaca spelling, no enum) to `timeframe="1d", timeframe_enum=
common_pb2.Timeframe.TIMEFRAME_1DAY` — matching the two already-migrated sibling call sites
(`servicer.py:590-591`, `screener.py:169-170`) exactly. `common_pb2` was already imported
(`:22`, used by `_recent_range`). No other line in `_eval_pair` touched.

**Verification**: `ruff check .` / `ruff format --check .` clean. Descriptive grep confirms all
three analysis `GetBarsRequest(` producers now agree on `timeframe="1d"` +
`timeframe_enum=common_pb2.Timeframe.TIMEFRAME_1DAY`.

- Files modified (Step 6): `app/engine/live_loop.py`

### Step 7 — test

Added `TestLiveEvaluationLoopRequestShape.test_getbars_sends_canonical_string_and_enum` to
`tests/test_live_loop.py`, mirroring `test_analysis_servicer.py:218-220`'s captured-request
pattern: drives one `_eval_pair` iteration through the existing `_make_loop`/`_decision` harness,
then asserts on `loop._marketdata.GetBars.await_args.args[0]`. The enum is hardcoded
(`common_pb2.Timeframe.TIMEFRAME_1DAY`), not derived from the code under test (AC-9,
`fails.md` 2026-07-29/074). `common_pb2` was not previously imported in this test file — added.

**RED (pre-Step-6 tree)**: `assert called_req.timeframe == "1d"` failed —
`AssertionError: assert '1Day' == '1d'` — the exact defect FR-2a-corrected Step 6 fixes.

**GREEN**: full `tests/test_live_loop.py` (14 tests) passes after Step 6's one-line-shape change.

**Verification**: `uv sync --extra dev` (proto stubs need `google.protobuf` on the path — first
run in this session hit `ModuleNotFoundError: No module named 'google'` before syncing).
`uv run pytest --cov=app --cov-fail-under=40` → **352 passed**, **81.65%** coverage (gate 40%).

- Files modified (Step 7): `tests/test_live_loop.py`
- Deviations: none.

## Session — Step 8 (ui)

TDD: wrote `src/lib/chart.test.ts` first, captured RED (`TIMEFRAME_ENUM` undefined — the proto
import itself resolved fine under vitest, ruling out recon Risk 1's resolution concern), then
implemented `chart.ts`'s `TIMEFRAME_ENUM` map, both `getBars` senders (`ChartPanel.tsx`,
`insights/market/[symbol]/page.tsx`), the e2e mock (`mock-backend.ts`'s bars now `timeframe: '1d'`
+ `timeframeEnum: Timeframe.TIMEFRAME_1DAY`), `backfills.spec.ts`'s `runningJob()` (added
`timeframe: '1d'` alongside the existing `timeframeEnum`), `chart-panel.spec.ts`'s two hand-rolled
bodies (added `timeframeEnum: 'TIMEFRAME_1DAY'`), and `INVENTORY.md`'s two rows.

**Deviation (recorded in implementation-spec.md's Deviation Log, summarized here)**: instruction
5c's literal mechanism — intercept via `page.route()` inside the existing "renders chart container"
test, driven by `page.reload()` — proved non-deterministic in this environment (`page.reload()`
races ChartPanel's multi-request mount cascade; `page.waitForRequest` timed out at 30s in some runs
despite GetBars firing ~2-3s post-reload per a debug trace). Substituted a new, separate test that
triggers a second `GetBars` deterministically via clicking the existing `'1h'` timeframe button
instead of reloading — same AC-8 guarantee (proves the **component** sends `timeframeEnum`, not
just that the map is correct), genuine red-before-green (verified by reverting `ChartPanel.tsx` and
re-running — asserted `undefined`, then restored and re-verified GREEN). No change to `mock-backend.ts`'s
`getBars` signature, respecting instruction 5b.

**Verification, all green**:
- `pnpm run lint` — only a pre-existing unrelated warning (`strategies/[id]/page.tsx:406`)
- `pnpm run build` — tsc gate passes (`Record<Timeframe, PbTimeframe>` totality enforced)
- `pnpm run test:coverage` — 29 tests pass, `chart.ts` 100% stmts/funcs/lines (threshold 40%)
- `pnpm test:e2e -- e2e/trader/chart-panel.spec.ts e2e/insights/backfills.spec.ts` — **17/17 pass**
  (run via `CI=1 E2E_PREBUILT=1` + `NEXT_DISABLE_STANDALONE=1 pnpm run build`, since the sandboxed
  `pnpm dev` first-compile exceeded this environment's default 10s per-test timeout — matches CI's
  own prebuilt-bundle path, not a weakened check)
- DRY guard grep (`TIMEFRAME_15MIN\|TIMEFRAME_1HOUR` outside `/lib/chart`) → exactly
  `backfills/page.tsx:22-23`, its own pre-existing list — no second map introduced
- C-12 fixture grep (`timeframeEnum` in `mock-backend.ts` + `backfills.spec.ts`) → both present as
  expected

- Files modified (Step 8): `src/lib/chart.ts`, `src/lib/chart.test.ts` (new),
  `src/components/trader/ChartPanel.tsx`, `src/app/insights/market/[symbol]/page.tsx`,
  `e2e/mock-backend.ts`, `e2e/trader/chart-panel.spec.ts`, `e2e/insights/backfills.spec.ts`,
  `e2e/fixtures/INVENTORY.md` (all under `services/xstockstrat-ui/`)
- Deviations: the request-capture mechanism substitution above; no other deviations.

**Next**: all 8 steps done — open the integration PR from `claude/impl-080-timeframe-enum` into
`main-dev`.

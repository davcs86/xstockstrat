# Design: fix-backfill-timeframe-enum

**Created**: 2026-07-29
**Mode**: full debate — **4 rounds** (started as `quick`; upgraded by user decision after round 1)
**Termination**: approved at the round-4 gate
**Consumes**: `recon.md`, `product-spec.md`
**Status transition**: `spec-ready` → `design-approved`

---

## Why this took four rounds

Every round found a producer or reader the previous round had asserted did not exist. That is the
finding, not an accident of process — and it is the same finding the feature is about.

| Round | What it found | Effect |
|---|---|---|
| 1 | `analysis/app/engine/live_loop.py:126` — a **live-wired** producer in a service the spec never named, whose two siblings were already migrated | +1 service |
| 2 | `BackfillBars` (3 raw reads), `ingestRecentBars` (raw config string, persisted), `e2e/mock-backend.ts` (a `Bar` shape the real service cannot emit) | +2 raw readers, +1 mock producer |
| 3 | `e2e/trader/chart-panel.spec.ts:22,54` (hand-rolled request, 7th producer); **and the ingest write path persists `timeframe` raw, so FR-1 returned `UNSPECIFIED` for its own primary caller** | severity raised, +FR-13 |
| 4 | Readers sweep completed and **bounded** — no new instance. `marketdata_service.go:288,330` correctly excluded (already enum-typed, which is why it carries no `//nolint`) | family closed |

Round 3's find is the important one: the spec's claim *"the write path already migrated correctly;
only the read path was left behind"* was false, and because it was stated as settled fact, three
rounds of analysis built on top of it. **A false premise in a spec is load-bearing** — it does not
merely omit a site, it actively steers every subsequent reviewer away from it.

> **Process deviation, recorded (P-03).** Round 4's proposer/adversary pair could not run — the
> session's subagent limit was reached. The orchestrator performed round 4's primary deliverable (the
> readers sweep) directly by grep instead, and its results are below. Rounds 1–3 ran the full
> proposer → adversary → synthesis protocol with user gates at each round.

---

## Chosen Approach

Six code slices plus one data migration. Every claim below cites `recon.md` or a verified `path:line`.

### 1. ingest — canonicalize on write, derive on read

- **Write** (FR-13, the round-3 find): `insert_job(timeframe=_canonical_timeframe(request))` at
  `servicer.py:153`, and the same value in the ledger payload at `:161`. `_canonical_timeframe`
  (`:47`) already prefers the enum; it was simply never applied before persistence — it is first
  reached at `:284`, inside `_run_backfill`.
- **Read** (FR-1): a module-level alias-hop helper placed **after** the map block so the
  `servicer.py:32-35` citation in `services/xstockstrat-ingest/docs/context-constitution.md:23` stays
  true; `job_row_to_proto` gains `timeframe_enum=_STR_TO_ENUM.get(<helper>(row["timeframe"] or ""), 0)`
  beside the untouched string at `:75`. All three read paths — `GetBackfillStatus:513`,
  `ListBackfillJobs:539`, `CancelBackfill:583` — are fixed structurally by the one mapper.
- **Dead branch** (FR-4): `servicer.py:407`'s `row.get("timeframe_enum")` and the `_ENUM_TO_STR`
  lookup at `:408-410` are deleted. The **map itself stays** — `_canonical_timeframe` reads it at
  `:50-51`. No map is orphaned: `_STR_TO_ENUM` keeps 3 readers, `_ENUM_TO_STR` and `_TF_ALIASES` keep
  their `_canonical_timeframe` reader (recon § Codebase Map).

### 2. marketdata — enum at all four `Bar` sites, and resolve every raw reader

- `barFromAlpaca(...)` shared by the two byte-identical Alpaca literals (`client.go:199-204`,
  `:305-310`) — ledger insight 2026-07-09, "a cross-path per-item transform gets one builder".
- One-line `TimeframeEnum: tfpkg.FromString(tf)` at `marketdata_repo.go:115`. **No scan-loop
  restructuring** — the `barRow.toBar()` extraction proposed in round 1 was rejected as overbuild
  (its test would have asserted that Go calls the function you can read it calling).
- `stream.go:259` gets `TimeframeEnum: TIMEFRAME_1MIN` + `//nolint:staticcheck // SA1019`
  (**empirically verified required** — I ran the repo's golangci-lint against a probe) + a comment
  restating MARKETDATA-2.
- Import the package as **`tfpkg`**, not a param rename: `timeframe` is already a parameter at
  `client.go:161,268`, `marketdata_repo.go:73,143,166,187` and in the `source.Source` interface
  (`internal/source/source.go:15,18,27`) — recon Risk 1.
- **FR-11** `BackfillBars`: resolve once, use the canonical value at `:590`, `:602`, `:633`.
  Resolve-with-raw-fallback, never error — byte-identical to how `GetBars` already handles it
  (`marketdata_service.go:118-122`).
- **FR-10** `ingestRecentBars`: route `bar_ingest_timeframe` through `Resolve`; on unresolvable, fall
  back to a hoisted `defaultBarIngestTimeframe = "15m"` const with a per-cycle `slog.Warn`.
  `resolveIngestTimeframe` is a **new symbol** — stated explicitly so `/sdd-spec` does not cite a path
  that does not yet exist (**F-04**).
- The live `StreamBars` raw reader is `marketdata_handler.go:258` (the gRPC adapter);
  `:42` is the **dead** Connect handler — `cmd/server/main.go:153` registers only `hdl.GRPCHandler()`.

### 3. analysis, 4. ui, 5. mocks — the remaining producers

- `live_loop.py:126` → `timeframe="1d", timeframe_enum=TIMEFRAME_1DAY` (FR-9). The string change to
  canonical is deliberate: its two siblings already send `"1d"`.
- `chart.ts` gains `Timeframe as PbTimeframe` + `TIMEFRAME_ENUM: Record<Timeframe, PbTimeframe>` beside
  `TIMEFRAMES`; both senders use it (FR-8). The mapped type is the primary guarantee — a fourth union
  member fails `tsc`. **Verified**: `backfills/page.tsx:76` already uses `Timeframe` in type *and*
  value position, so the annotation checks.
- `e2e/mock-backend.ts:318,330` and `e2e/trader/chart-panel.spec.ts:22,54` (FR-12), plus
  `e2e/insights/backfills.spec.ts`'s inverse mismatch. Aliasing precedent is `useOrders.ts:3` — **not**
  `backfills/page.tsx:18`, which recon Risk 6 correctly showed is a bare import.

### 6. Data remediation (FR-14)

Forward-only `services/xstockstrat-marketdata/migrations/003_*.{up,down}.sql` canonicalizing the three
recoverable spellings in `marketdata.ohlcv`. Must resolve the PK-collision case deliberately, must
account for `ohlcv` being a hypertable, and its `.down.sql` must state that the reverse is not
faithful (a merged `'1d'` row is indistinguishable from one always canonical). DBA + service-owner
approval. `''` and `'1m'` rows are out of remediation scope and reported with counts, not rewritten.

---

## Readers sweep — the completeness proof (round 4, run by the orchestrator)

Method, re-runnable: `grep -rn '\.Timeframe\b' --include=*.go services/ | grep -v /gen/`;
`grep -rn '\.timeframe\b' --include=*.py services/ | grep -v /gen/`; and a `timeframe` sweep of
`xstockstrat-ui/src`. Classify every hit; treat "no `//nolint`" as a signal the field may not be the
deprecated one.

| Reader | Verdict |
|---|---|
| `marketdata_service.go:118` (`GetBars`) | Correct — `Resolve`, enum-preferring |
| `marketdata_service.go:590,602,633` (`BackfillBars`) | **In scope — FR-11** |
| `marketdata_service.go:288,330` (`resolveDeletePlan`/`DeleteBackfilledData`) | **Not in the family** — `resolveDeletePlan`'s signature is `tf commonv1.Timeframe`; already the enum. This is why it carries no `//nolint`, and the earlier rounds would have mis-scoped it |
| `marketdata_repo.go:59` (`InsertBars`) | Excluded — the DB column *is* the string, so this must stay string-driven. It is the **mechanism** that makes FR-10/FR-11 data-correctness rather than labelling |
| `marketdata_handler.go:258` (gRPC `StreamBars`) | Live raw reader; family has **zero producers**, so unreachable — recorded, see Open Risks |
| `marketdata_handler.go:42` (Connect `StreamBars`) | Dead code — the Connect server was removed |
| `ingest/servicer.py:153` | **In scope — FR-13** (the persist path) |
| `ingest/servicer.py:161` | **In scope — FR-13** (untyped ledger `Struct`) |
| `ingest/servicer.py:47-54` (`_canonical_timeframe`) | Correct — enum-preferring |
| `agent/app/client.py:746-752`, `tools.py:572-592` | Correct — canonicalizes and sets **both** |
| `ui/src/**` | **Zero readers of any deprecated string field.** Every `timeframe` hit is the chart's own local union or the already-enum-typed `DeleteBackfilledDataRequest` (`backfills/page.tsx:146`). `mapBars` (`chart.ts:36`) reads only OHLCV numerics (`chart.ts:26-33`) |

**Untyped surfaces** — no generated field, no lint signal, invisible to a type-name grep. Both in
scope: `ingest/servicer.py:161` (ledger `Struct`) and `marketdata_service.go:588-591`
(`map[string]interface{}` → ledger). This class is why the sweep needed a separate pass.

**Not the same shape, no action**: `trading.proto:188` `is_paper` is a deprecated **bool with no
replacement field** (the replacement is a different RPC, `GetTradingEnvironment`; `trading.proto:173`
`BrokerAccount.is_paper` is *not* deprecated). `common.proto:82-83` are deprecated **enum members**,
not fields — nothing to co-populate; FR-6 deliberately uses `1MIN` under that retention rationale.

**Bounded residual — what could still exist.** Only three classes, and each is bounded: (a) reflective
construction from an untyped dict — I found none (`ParseDict` absent; `MessageToDict` used only as a
decoder at `analysis/app/services/screener.py:261`); (b) out-of-repo callers (the staging MCP client,
`grpcurl`, DO-side jobs) — outside any code sweep's reach; (c) data at rest, which FR-14 addresses for
the recoverable subset. Unlike rounds 1–3, the in-repo code surface is now enumerable rather than
sampled.

---

## Rejected Alternatives

| Option | Why it lost |
|---|---|
| Leave the stream site `UNSPECIFIED`, asserted | Strong case (avoided a deprecated-value write, a `//nolint`, and three doc edits; and `ToCanonical(1MIN)` returns `("", false)` so the label buys no consumer anything). **Overruled by user decision**: a streamed bar genuinely *is* a 1-minute bar, and `common.proto:74-76` retains the member precisely so already-produced, non-ingested data stays describable. The divergence this risked is removed by FR-10 — once `"1m"` cannot enter via config, the REST path can never produce a `"1m"` bar |
| Add a `timeframe_enum` **column** to `ingest.backfill_jobs` | Needs migration `008`, a second stored value, and dual-write discipline. FR-13 makes the string reliable, so one line achieves the same guarantee. **Note the original rejection reason ("two values could disagree") was falsified** — they already disagreed |
| `barRow.toBar()` extraction to create a repository test seam | Restructures a working `rows.Next()` loop for a test that asserts a one-line delegation; the cited precedent (`buildDeleteBarsQuery`) extracts *DBA-critical logic*, not a delegation. Replaced by a totality test in the coverage-measured `internal/timeframe` |
| Unresolvable `bar_ingest_timeframe` → pass raw through, or skip the cycle | Pass-raw was strictly additive (never causes a new write) and was my recommendation; skip-the-cycle never writes unrequested data. **User chose fall-back-to-`"15m"`**: this is the platform's only continuous OHLCV feed and should degrade to a working default rather than to silence. Recorded as an accepted risk |
| `tests/conftest.py` re-import, or `tests/helpers.py` | `conftest` re-import depends on pytest import-mode internals; a plain `tests/_helpers.py` has identical ergonomics with no such dependency. Also: move **only** `job_row` — the two servicer factories differ in name, signature and body and are not duplicates |
| Split into two features (live defects now, labelling later) | Genuinely attractive once severity rose — it would untangle a wrong-data bug from a scheduled-breakage cleanup. Rejected: the round-2 argument holds that splitting a family invites fixing half of it, and this family has already demonstrated that failure mode four times |

---

## Open Risks

1. **FR-10's `"15m"` fallback can cause a write**, not merely label one — an operator who set an
   out-of-vocabulary value to stop ingestion would find it resumed at 15m. Mitigations: the documented
   pause sentinel is `bar_ingest_interval_ms <= 0` (**MARKETDATA-5**), so the disturbed misuse is not a
   supported one; the key is seeded in **no** migration (all 10 config migrations checked), so every
   repo-provisioned environment already runs the `"15m"` default and is unaffected; each fallback cycle
   WARNs. → target step: marketdata service.
2. **FR-11's raw fallback preserves a bad path** — an unresolvable `BackfillBars` timeframe still
   reaches Alpaca as-is. Deliberate, for consistency with `GetBars`. → marketdata service.
3. **`marketdata_handler.go:258` stays a raw reader.** Unreachable today (zero producers of
   `StreamBarsRequest`), so excluded — but the exclusion rests on *reachability*, not correctness, and
   the moment anyone writes a `StreamBars` caller it becomes a live instance. → recorded, not fixed.
4. **AC-6 residuals**: an unresolvable request alias falls through to `canonicalTf = legacyTf`
   (`marketdata_service.go:116-122`) and yields `UNSPECIFIED`; legacy rows stored non-canonically scan
   back as `UNSPECIFIED`. Correct encodings of "outside the vocabulary" — but note the second class is
   also *unqueryable*, which FR-14 remediates only for recoverable spellings. → marketdata test.
5. **FR-14 collision handling is unresolved by design** — deliberately left to the implementation step,
   which must pick skip-if-canonical-exists or delete-then-update and justify it. → migration step.
6. **Coverage attribution**: `ci.yml:241` excludes `service|repository|handler|cmd` from Go
   `COVERPKGS`, so FR-10/FR-11 and the repo one-liner earn **zero** coverage credit. The threshold is
   carried by the `alpaca` and `timeframe` tests. Tests there are for correctness, not the gate.
7. **Out-of-repo producers** cannot be swept (readers-sweep residual b). The staging MCP client that
   surfaced this bug is itself one.

---

## Constitution Rules Touched

| ID | How honored |
|---|---|
| **C-01** | Every FR cites verified `path:line`; four false spec claims found during the debate were corrected in place rather than inherited (the write-path premise, the UI-displays-the-string claim, the marketdata-readers-are-correct claim, the Open-Question-1 rationale) |
| **C-04** | The feature *is* C-04 enforcement — populating the enum that replaces a deprecated string |
| **C-07** | FR-14's migration is `003_*` (marketdata's `migrations/` ends at `002_fundamentals`), with a real `.down.sql` |
| **C-08 / P-06** | Every service step is paired with a test step; step 5 was split because it bundled an analysis service change with UI files spanning two CI jobs. Red-before-green recorded per step. Assertions use **hardcoded** expected enums — never the mapper the implementation calls, which would assert nothing (`fails.md` 074) |
| **C-10(a/b/d)** | The whole point. All three read paths, all four `Bar` sites, all seven producers, both untyped ledger payloads, and both e2e mocks — with the readers sweep above as the completeness evidence |
| **C-11** | Bug-fix route (Track C) with a full 4-round design; the FR-2a carve-out to FR-2/FR-7 is an explicit, user-signed-off Commandment override recorded in `context.md` |
| **C-12** | No new fixture module forced — the mock bars are existing inline literals in one handler; `INVENTORY.md:47` records the shape change |
| **P-01 / P-02** | Orchestrator was the sole writer; proposer and adversary never saw each other's output |
| **P-03** | Four false premises corrected rather than inherited; the round-4 subagent-limit deviation recorded above; three of the round-1 proposer's six assumptions promoted to verified facts by execution |
| **P-04** | Four user gates, one per round; every ruling recorded in `context.md` |
| **F-01** | No applied migration edited — FR-14 adds a new number |
| **F-04** | `resolveIngestTimeframe` flagged as a **new** symbol so the impl spec cannot cite a non-existent path |
| **F-06 / F-07** | Not engaged — no pool change; the `"15m"` fallback is a declared `GetString` default, not a hardcoded config value |
| **F-11** | No Floor breach was flagged in any round |

**Guard rails assessed**: the `strat-lab` plugin obligation is a **verified no-op** —
`get_backfill_status`'s payload shape does change (`timeframe_enum` gains a real value), but
`plugins/strat-lab/skills/backtest/reference/backfill.md` never mentions timeframe. Recorded here so
the gate does not re-open at `/sdd-spec` or PR review. The root `CLAUDE.md` § Teardown
`/context-scrubber scan` is owed, scoped to the touched context files.

---

## Step Boundaries for `/sdd-spec`

Advisory. Each step is its own PR into `feature/fix-backfill-timeframe-enum` (**F-03**).

1. **ingest — service**: FR-13 (write path + ledger payload), FR-1 helper + enum, FR-4 dead-branch deletion
2. **ingest — test**: `tests/_helpers.py` (move `job_row` only), paired assertions across all three read
   paths, AC-13 (enum-only `TriggerBackfill` persists canonical), AC-14 (ledger payload), drop
   `test_ingest_servicer.py:506`
3. **marketdata — service + docs**: `tfpkg`, `barFromAlpaca`, repo one-liner, stream site + `//nolint`,
   FR-11 `BackfillBars`, FR-10 + hoisted const — **plus all five doc surfaces in the same step**
   (marketdata `CLAUDE.md:17,61`, `timeframe.go:10-13`, MARKETDATA-1 *and* MARKETDATA-2, and two
   line-shifted citations). Docs are not a trailing step: root `CLAUDE.md` § Teardown requires the
   same PR, and the execute loop has no co-merge mechanism
4. **marketdata — test**: `client_test.go` `1Day` input row + hardcoded `wantEnum`, direct
   `GetBarsMulti` assertion, new in-package `internal/alpaca/stream_test.go`, `internal/timeframe`
   totality test, `resolveIngestTimeframe` cases
5. **marketdata — migration**: FR-14 `003_*` up/down + the AC-15 verification query (DBA gate)
6. **analysis — service + test**: `live_loop.py:126` + `tests/test_live_loop.py` assertion
7. **ui — senders, mocks + test**: `chart.ts` map, both senders, `src/lib/chart.test.ts`,
   `e2e/mock-backend.ts`, `e2e/trader/chart-panel.spec.ts`, `e2e/insights/backfills.spec.ts`,
   `INVENTORY.md`

Steps 1–2, 3–4, 5, 6, 7 share no artifact. Step 5 should land after step 3 so the code that stops
producing non-canonical values precedes the data cleanup — otherwise a backfill running between the
two can reintroduce a row the migration just fixed.

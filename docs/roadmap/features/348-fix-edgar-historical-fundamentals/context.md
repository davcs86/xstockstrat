# Context Log: fix-edgar-historical-fundamentals

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-16 (/sdd-triage)

- Bug reported via defect report `docs/reports/2026-11-16-marketdata-edgar-period-label-collision-defect.md`
  (Issues disabled): EDGAR historical fundamentals rows hold a different period's data than their
  label and filed date say.
- Severity: SEV-2. Environment: staging (homelab, main-dev). Config-only: no.
- Routed to SDD path (Track C). No hotfix: no production instance exists.
- Created: feature.md, status.md, product-spec.md, acceptance.feature (regression scenarios), context.md.
  Report sidecar stamped `triaged` → `feature:348-fix-edgar-historical-fundamentals`.
- Feature number 348 reserved by `scripts/sdd-allocate-feature-number.py`.
- Affected services (from the report): xstockstrat-marketdata.
- Recommended design depth: full → `/sdd-design fix-edgar-historical-fundamentals`
  (rationale: SEV-2; a row-key change with a stored-data repair, possibly a migration; consumer
  surfaces `xstockstrat-ui` and `xstockstrat-agent` count as services under the rubric).
- Development branch: feature/fix-edgar-historical-fundamentals

### Authorization reference (operator, relayed in the session brief, verbatim)

> "The operator's instruction is: minimal human intervention. Treat that as standing authorization
> to proceed through checkpoints that only report progress, and record it verbatim in the feature's
> `context.md` as the authorization reference. It is NOT consent for the gates the Constitution
> reserves to the operator — design approval, sign-off on changing an existing durable scenario,
> the C-16 promotion plan, anything in the approval-flow runbook (DB migration: DBA + service owner;
> breaking proto: owners + platform lead), merging any PR, and every staging action."

No operator answer has been received in this session yet. Nothing below is an operator decision
unless it is marked as one.

### Root cause, traced at triage (live SEC companyfacts fetched 2026-11-16, HTTP 200)

- The repeated `fy` is in the SEC payload. Companyfacts copies `fy`/`fp` from each filing's
  cover-page tags, and filers set them inconsistently. Per filing accession (10-K / 10-Q only):
  - ORCL: 10-Q filed 2025-09-10 (own quarter ended 2025-08-31) and 10-Q filed 2026-09-11 (ended
    2026-08-31) both `fy` 2026 `fp` Q1.
  - CRWD: five repeats — `Q1/Q2/Q3` of `fy` 2020 (filed 2019 and 2020), `FY` 2022 (10-Ks filed
    2022-03-16 and 2023-03-09), `Q1` 2025 (filed 2024-06-05 and 2025-06-04). Its annual `fy` values
    run 2022, 2022, 2023, 2024, 2026 for the years ended January 2022 to January 2026.
  - CLSK: six repeats, among them `Q1` 2025 (filed 2025-02-06 and 2026-02-05) and `FY` 2021.
- Reproduced on `main-dev` code with a throwaway probe test (not committed) that feeds each payload
  through `FetchHistorical`. Rows with `period_end > filed_date`: ORCL 1, CRWD 5, CLSK 5, FLXS 4,
  UCTT 4, JAZZ 7; AAPL 0, LYFT 0.
- Second mechanism, same code: `edgar_client.go:434` takes the latest `end` over every fact in the
  bucket, including the cover-page share count (`EntityCommonStockSharesOutstanding`), which is
  dated after the period ends. ORCL `Q1-2026` shows 2026-09-07 for a quarter ended 2026-08-31. JAZZ
  (calendar fiscal year) gets seven annual rows whose `period_end` is in April, after the February
  `filed_date`. This is the "period_end looks like a filing-availability date" observation.
- "Only three of the last four quarters stored" (23 symbols in the feature-340 audit) is the
  missing period of each collision. Same defect.
- Different defect, recorded separately as
  `docs/reports/2026-11-16-marketdata-edgar-tag-coverage-gaps-defect.md` (status `open`): the 11
  symbols with no quarterly net income and the 13 with nil roe on the latest quarter. Checked on
  AVGO, JEF, BMO, CARR, HSY, SNOW: the filer reports under `ProfitLoss`, equity including
  non-controlling interest, or IFRS tags, which the derivation does not read. Not widened into
  this fix.
- ORCL facts used by the acceptance scenarios: quarter ended 2025-08-31 net income 2,927,000,000,
  equity 24,154,000,000, filed 2025-09-10 (accession 0001193125-25-200095); quarter ended
  2026-08-31 net income 4,760,000,000, equity 66,772,000,000, filed 2026-09-11 (accession
  0001193125-26-389274); cover-page share count of the second filing dated 2026-09-07.

### Assumptions made by the triage session (not operator decisions)

- Triage artifacts are committed on `feature/fix-edgar-historical-fundamentals` and reach `main-dev`
  with the integration PR, not through a separate docs PR.
- The product spec is written fuller than the triage template (numbered FRs, consumer surfaces)
  because the root cause was traced in the same session.
- The second defect report is recorded on the session brief's instruction ("if different, record
  them with `/sdd-qa defect`"); its severity (SEV-3: values missing, none wrong) is the session's
  classification.

## Session 2026-11-16 — sdd-review product-spec

- Tree: `feature/fix-edgar-historical-fundamentals@f426971 ≡ origin/feature/fix-edgar-historical-fundamentals`.
- Product spec approved. Status: draft → spec-ready. Verdict: PASS WITH WARNINGS, no Floor breach.
  Proceeded under the authorization reference above (a progress checkpoint, not a reserved gate).
- Warnings:
  - FR-7 is covered only for the EDGAR snapshot path (`@AC-6`); the agent tool, analysis
    backtests/screens and UI readers have no scenario (C-15, C-14). Carried to recon: add scenarios
    or narrow FR-7 once every reader is listed.
  - FR-5's stale-label clause had no explicit assertion in `@AC-5` (C-15). Addressed in this
    session: `@AC-5` gained `And no stored "ORCL" row has period_end 2026-09-07` (the scenario was
    still a draft; its ID is unchanged).
  - If design chooses a migration, the implementation spec must state the next `NNN`, the up and
    down files and the run order (C-07, F-01). Marketdata migrations end at `009`; next free is `010`.
  - FR-3's "as its own current period" is abstract; design must define it (own-period facts versus
    comparative columns).
- Overlap findings: no FAIL-level overlap. Feature 340 (`fix-fundamentals-roe-unit`, `code-completed`)
  shares `internal/edgar/edgar_client.go`, the `DerivationVersion` gate, the golden in
  `derivation_version_test.go` and the `marketdata.fundamentals_history` rows. 340's code is already on
  `main-dev` (`8ccc152`, PR #1552) and this branch is based on it, so the order is fixed and no
  merge-order row was written. Features 341, 343 and 347 touch other files.
- Recommended design depth: full (row-key change with a stored-data repair, possible DB migration,
  consumer surfaces `xstockstrat-ui` and `xstockstrat-agent`).

## Session 2026-11-16 — sdd-design (in progress: waiting at the approval gate)

- Tree: `feature/fix-edgar-historical-fundamentals@9728776 ≡ origin/feature/fix-edgar-historical-fundamentals`.
- Phase 0 Recon: wrote recon.md (writer: marketdata; readers reconned: analysis, ingest, agent, ui).
  No consumer parses or sorts by the label; analysis selects by `filed_date` only.
- Phase 1 Grilling: 3 rounds (full). Register: debate.md (D-1..D-23, R-1..R-16, O-1..O-33 all
  closed, no petitions). Floor breaches: none in any round.
- Rounds 2 and 3 were started without asking: round 2 is mandatory in full mode, and after round 2
  four blocking objections remained that only a further round could settle. Both are progress
  checkpoints under the authorization reference, not operator decisions.
- Measurements added to recon.md by the orchestrator during the debate (live SEC payloads, 14
  filers): the filer's `fp` is unreliable too; JEF's year-end change; most stored rows carry a
  cover-page `period_end`, so most rows are rewritten by the repair.
- NOT approved. The approval gate, the feature-216 `@AC-5` text, the label-collision residual, the
  deletion categories and the audit runner are put to the operator in one message. Nothing in
  design.md, status.md or acceptance.feature is written until the operator answers.

## Session 2026-11-16 — sdd-design (approved)

- Phase 0 Recon: wrote recon.md (services: marketdata; readers analysis, ingest, agent, ui; key
  reuse patterns: the feature-340 balance-sheet anchor and `candSet`, the `DerivationVersion` gate
  with its golden, feature 340's lane procedure).
- Phase 1 Grilling: 3 rounds (full). Chosen approach: one period per filing identified by form
  class and its own balance-sheet date; labels computed from dates in the existing format; a
  per-symbol reconcile in the backfill (rows the derivation reproduces are upgraded in place, all
  others deleted and re-inserted in one transaction); guards, a no-write audit, export and restore;
  version 3; no migration, proto or config change. Rejected: R-1..R-16 (debate.md).
- Constitution rules touched: C-01, C-08, C-13, C-14, C-15, C-16, C-18, P-01..P-06, F-01, F-04,
  F-06, F-07. Floor breaches: none.
- Status: spec-ready → design-approved.

### Operator answers at the approval gate (2026-11-16)

The five questions were put in one message (design approval; the feature-216 `@AC-5` text; the
label-collision gap; rows deleted without a same-date replacement; who runs the audit). The
operator's reply, verbatim:

> 1. Yes
> 2. As recommended
> 3. Acknowledged
> 4. Acknowledged, but add a info log for them.
> 5. You can get the symbols using the MCO, and run the fetches

Follow-up message, verbatim: "in the #5, MCO = MCP".

How each is applied:

1. Design approved as summarized (D-1..D-23). That summary included running the repair with
   `overwrite=true` and that any admin-triggered fundamentals backfill runs the reconcile once a
   lane is enabled.
2. C-16 CHANGE signed: feature 216 `@AC-5` gains the `Given`
   `And the current EDGAR derivation reproduces that period's fiscal_period, period_type, period_end and filed_date`
   (Option 1, the recommended one), with this feature's `@AC-11` promoted in the same PR.
3. "Acknowledged" to "Accept one known gap in labels?". The mechanism (D-19) is inside the design
   approved under answer 1. The session treats the gap as accepted and told the operator so in its
   next message; the word recorded is the operator's, not "accepted".
4. Deletions without a same-date replacement: acknowledged, with a condition — an INFO log for
   them (D-24).
5. The main session obtains the symbols through the staging MCP and runs the SEC fetches (D-25).
   This is the operator's standing word for the read-only MCP reads the audit needs; it is not
   consent for `set_config`, `trigger_backfill` or any other staging change, which stay per-step.

Deviation from the grilling protocol, flagged: answers 4 and 5 add constraints at the gate. The
protocol's "inject a constraint" path runs another round. No fourth round was run: the operator
chose approval in the same reply, and both constraints are additive (a log line; where the audit
reads its input) and change no settled decision. They are recorded as D-24 and D-25.

### Open Threads (from design.md § Open Risks)

- [ ] How the main session lists a lane's stored symbol universe through the MCP — target: `/sdd-spec` discovery; if no tool lists it, ask the operator for the list.
- [ ] Read MARKETDATA-13 (`services/xstockstrat-marketdata/docs/context-constitution.md:27`), findings `:29-31`, `docs/runbooks/historical-backfill.md:148+` — target: `/sdd-spec`, before the docs step.
- [ ] Label-collision left-out periods, deleted-without-replacement rows, guard-failed symbols, single-metric anchors, 6-K half-year rows — target: the pre-enable audit report (procedure step 3), reviewed by the operator per lane.
- [ ] Empty price-join columns on replaced rows — target: the pre/post diff (procedure step 8).
- [ ] The acceptance restatement (`@AC-1..@AC-11`, FR-6) is applied in the first implementation step.

## Session 2026-11-16 — sdd-spec

- Tree: `feature/fix-edgar-historical-fundamentals@15da035 ≡ origin/feature/fix-edgar-historical-fundamentals (merged origin/main-dev@f3f02c7)`.
  The merge moved `internal/service/marketdata_service.go` by +21 lines against recon.md and
  design.md; the spec cites the current numbers.
- Implementation spec generated: 15 steps (atomic units 2+3, 4+5, 6+7, 8+9, 10+11; Step 15 is the
  operator gate). No migration, proto or config change.
- The skill ran as a forked run that was cut off by a usage limit after it wrote
  `implementation-spec.md` and before its closing bookkeeping. The main session completed the
  bookkeeping (status.md, feature.md, this entry) from the file on disk. The main session read the
  spec's summary sections only; the step bodies have NOT been re-verified by it. The impl-spec
  review has not run yet.
- Status: design-approved → implementation-ready.
- Choices the spec makes where the design is silent are listed in the spec as S-1..S-13. Two need
  the operator's or the reviewer's word before Step 8 is executed:
  - S-2: the service's INFO line reports `no_period_derived` for a row the audit reports as
    `left_out`, because the service only has `FetchHistorical`.
  - S-4: read literally, D-24 logs one INFO line for every row whose only change is a cover-page
    `period_end` corrected to the balance-sheet date, which recon measured as most rows of a lane.
- S-12: no MCP tool lists the symbols stored in `marketdata.fundamentals_history`; the spec builds
  the list from `get_backfill_status` and has the operator confirm its size with one read-only count.

### Open Threads

- [ ] Run `/sdd-review fix-edgar-historical-fundamentals impl-spec` — not run yet.
- [ ] S-2 and S-4 — ask the operator before Step 8.
- [ ] S-12 — confirm the symbol-list method with the operator before Step 15.

## Session 2026-11-16 — operator answers after the spec (orchestrator)

Three questions were put in one message after the PR was opened. The operator's reply, verbatim:

> Q1
> Narrow set
> Q2
> Agreed
> Q3
> Use the mcp to pull the symbols from all watchlists

- Q1 (INFO log volume; spec S-4): the narrow set. A row whose period is stored again under corrected
  dates or label gets no INFO line; only rows whose period no longer exists in the table are logged
  and listed. This narrows the literal wording of D-24 in design.md § 2 and § 3; the spec's S-3
  pairing rule is the precise form.
- Q2 (spec S-2): agreed. The service logs `no_period_derived` where the audit reports `left_out`.
- Q3 (spec S-12): the main session pulls the symbols from all watchlists through the MCP.
- The spec was edited in place (S-3, S-4, S-12, Steps 4, 5, 15 evidence and instructions). No step
  has been executed, so the step bodies are not yet immutable (F-09 applies from execution).
- Earlier in the session the operator asked, verbatim: "Create a PR with the artifacts you have so
  far". PR #1558 (`feature/fix-edgar-historical-fundamentals` → `main-dev`) was opened for the docs.

### Open Threads

- [x] S-2, S-4, S-12 — answered above.
- [ ] Run `/sdd-review fix-edgar-historical-fundamentals impl-spec`.

## Session 2026-11-16 — sdd-review impl-spec (advisory)

- Tree: `feature/fix-edgar-historical-fundamentals@d43cce3 ≡ origin/feature/fix-edgar-historical-fundamentals`.
  `origin/main-dev` had moved by one commit (#1557, UI only, none of the cited files); it was not
  merged during the review so the reviewers read a still tree. BRANCH SYNC in `/sdd-execute` merges it.
- Result: 7 failures, about 24 warnings (advisory — did not block). No Floor breach. About 40
  citations spot-checked; two off by a few lines.
- The spec was edited in place before execution (no step had started), commit follows this entry:
  - [x] Steps 1, 3, 5, 9: `grep` expectations that exit non-zero on success → `test "$(grep -c …)" = N`.
  - [x] Steps 7, 9, 12: `go test … | grep` pipelines that hide a failure → output to a log, then `test` on it.
  - [x] Step 9: the `Found:` pattern matched `internal/config/config_test.go` → narrowed.
  - [x] Step 11 instruction 2 contradicted S-3/S-4 (a replaced row asserted as deleted without replacement) → corrected, plus a case that does produce a category.
  - [x] Coverage ≥ 40% now asserted in Steps 3, 5, 9, 11; `cd`-chains replaced by `go -C`.
  - [x] Step 3: the fixture must contain the two real ORCL accession numbers; the SEC `User-Agent` is generic.
  - [x] Step 8 item 4: which stored row supplies a carried price.
  - [x] Step 15: lane B export is the operator's; counts only for symbols outside the watchlist union; lane A's flag stays `false` until the operator enables it; `otel.go:371`.
- Unresolved ⚠ carried into execution:
  - Steps 4+5, 6+7, 10+11: `**Lands with**` folds that step-constraints §C does not strictly require (a new package does not break the tree) — [ ] unaddressed (kept: each pair is one commit either way in sequential mode)
  - Step 3 touches 8 files — [ ] unaddressed (fixture migration is one compile unit)
  - Step 12: "the CI job ran with no SKIP" is checked by eye on the PR — [ ] unaddressed (the job fails closed without its database)
  - Step 14: one docs check is by eye — [ ] unaddressed
  - C-14: no UI or agent step by decision; the note sits in the spec's Consumer Surfaces section, verified on the canary after deploy — [ ] unaddressed
- Overlap findings: no migration, proto or config collision. File-level WARN only: `internal/telemetry/otel.go` and `telemetry_allowlist_test.go` (337, 341), `marketdata_repo.go` and its test (341), `marketdata_service.go` and its test (347), `services/xstockstrat-marketdata/CLAUDE.md` (341, 347), `docs/context-constitution.md` (347), `.github/workflows/ci.yml` (343, 345). No merge-order row written (no FAIL-level overlap).

## Session 2026-11-16 — sdd-execute (sequential)

- Mode entry and the per-feature up-front confirmation were not asked again: the operator's brief
  names `/sdd-execute <slug> sequential` as the command to run, and the authorization reference
  covers progress checkpoints. Reserved gates still stop the run: the C-16 promotion plan, Step 15's
  staging actions, merging.
- Re-spec gate: `origin/main-dev` merged into the branch (`2e603f21`; #1557, UI only); ledger-guard
  clean. The impl-spec review had just re-checked about 40 citations on this tree; no step mismatched,
  no re-spec.
- Tooling setup (steps 1–15): go1.27.0 ✓ · golangci-lint ⬇ v2.14.0 built with go1.27.0 (at
  `$(go env GOPATH)/bin`; the 2.5.0 binary on PATH is not used) · node v22.23.4 (root tooling only;
  no UI step) · python3 ✓ · no database installed or started.

### Step 1 — docs: restate acceptance.feature (`@AC-1..@AC-11`) and FR-6 [done]
- `acceptance.feature` `@AC-3..@AC-11` written mechanically from the Gherkin block in the step body;
  `@AC-1`, `@AC-2` untouched. FR-6 restated to the strict rule. TDD: N/A (docs).
- Files modified: `docs/roadmap/features/348-fix-edgar-historical-fundamentals/acceptance.feature`, `docs/roadmap/features/348-fix-edgar-historical-fundamentals/product-spec.md`
- Deviations: none

### Step 2 — service: EDGAR period identity per filing, date-derived labels, `DerivationVersion` 3 [done]
- Atomic unit Steps 2+3. `FetchHistorical` now groups facts by accession, types a filing by its form class, dates it at its own balance-sheet anchor (on or before `filed`), merges filings by (type, own end) with the earliest filing winning, labels from dates (`quarterLabel`, floor arithmetic), leaves out label collisions and quarterly filings ending on a real fiscal-year boundary, and exposes `DeriveHistorical`. `unitDatum.FY`/`FP`, `periodKey` and `classifyPeriodType` are gone. `DerivationVersion` = 3. New: `source.LeftOutPeriod`, `telemetry.RecordPeriodLeftOut` with label key `reason`.
- TDD (unit): RED on the pre-unit tree with the ORCL fixture — AC-1 `no quarterly period with period_end 2025-08-31` / `… 2026-08-31`; AC-2 `Q1-2026 quarterly: period_end 2026-09-07 after filed_date 2025-09-10`; AC-3 `labels: 2025-08-31 → <nil>, 2026-08-31 → <nil>, want Q1-2026 and Q1-2027`. GREEN after the unit: see Step 3.
- Files modified: `services/xstockstrat-marketdata/internal/edgar/edgar_client.go`, `services/xstockstrat-marketdata/internal/source/source.go`, `services/xstockstrat-marketdata/internal/telemetry/otel.go`
- Deviations: none

### Step 3 — test: ORCL and CRWD fixtures, period-identity tests, fixture migration, version-3 golden [done]
- Atomic unit Steps 2+3. Fixtures: ORCL (CIK0001341439, 1,467 facts, 340 KB) and CRWD (CIK0001535527 resolved from SEC's ticker map, 504 facts, 117 KB), fetched live from `data.sec.gov` on 2026-11-16 (HTTP 200, generic tool-only User-Agent) earlier in this session and trimmed by tag only (the 17 read tags, every fact kept, `cik` and `entityName` kept). `period_identity_test.go` holds the shared loader (`lyftPeriods` now calls it), the ORCL and CRWD cases and the synthetic cases (form classes, mixed-form accession, `@AC-10`, the 10-KT boundary, label arithmetic, year-end quarterly, shares tie rules).
- GREEN: `go test ./internal/edgar/... -race -count=5` → `ok … 15.282s`; `go test ./... -race -count=1` → 16 packages `ok`; coverage `total 86.0`; `golangci-lint` v2.14.0 `0 issues.`; the seven `test` checks of the Verification block passed (`ALL-VERIFY-OK`).
- Existing tests changed, and why: `cannedCompanyFacts` and `axpFacts` now give each filing its own accession, and the AXP filing of 2026-02-10 is a 10-K (grouping is by accession and the form decides the type); `TestFetchHistorical_MapsFiledPeriod_AC1` expects `Q4-2019` for a lone quarter with no annual filing (Dec-31 fallback), with a sibling case that adds Apple's annual filings and asserts `Q1-2020`; `TestLYFT_PeriodsStampedVersion2_AC5_feature340` became `…StampedCurrentVersion…` and compares against `DerivationVersion`. No assertion on a value was changed: the AXP `Q2-2026` and `FY2025`, the LYFT `Q3-2026` (roe 0.942632) and `FY2025` (roe 0.868791), the BABA-shaped and CRCL `FY2025` cases pass untouched.
- The version-3 golden hash equals the version-2 hash: the AXP golden fixture has no repeated `fy`/`fp`, no cover-page share fact and no label change, so its output is the same under both versions. Entry `3:` is recorded as the guard requires.
- Labels and left-out periods of `@AC-3` and `@AC-10` came out exactly as Step 1 states them.
- Files modified: `services/xstockstrat-marketdata/internal/edgar/testdata/orcl_companyfacts.json`, `services/xstockstrat-marketdata/internal/edgar/testdata/crwd_companyfacts.json`, `services/xstockstrat-marketdata/internal/edgar/period_identity_test.go`, `services/xstockstrat-marketdata/internal/edgar/edgar_client_test.go`, `services/xstockstrat-marketdata/internal/edgar/ttm_roe_test.go`, `services/xstockstrat-marketdata/internal/edgar/own_period_test.go`, `services/xstockstrat-marketdata/internal/edgar/derivation_version_test.go`, `services/xstockstrat-marketdata/internal/service/telemetry_allowlist_test.go`
- Deviations: none

### Step 4 — service: pure reconcile planner (`internal/reconcile`) [done]
- Atomic unit Steps 4+5. `reconcile.Build(stored, fresh, Request) (Plan, error)` is pure. Guards run first and each has its own sentinel (`ErrFreshEmpty`, `ErrTypeMissing`, `ErrFilerMismatch`); a guard error carries an empty plan. `Plan` holds the identical pairs inside the range, `Deletes` and `Inserts` both sorted by (`fiscal_period`, `period_type`), and `Unreplaced` (row + category). Dates compare as `YYYY-MM-DD` strings. `source.HistoricalPriceState` gained `FiscalPeriod`, `PeriodType`, `PeriodEnd`, `ExtraMetrics`; `periodTypeWanted` moved to `source.PeriodTypesWanted`.
- Readings of the step text, recorded because Step 8 and Step 10 depend on them: (1) the filer guard reads every stored row of the symbol, not only rows of a requested type, and compares with every fresh period of any type; (2) "stored rows exist and the fresh set is empty" fails the symbol even when the stored rows are all of a type that was not requested; (3) inserts are sorted like deletes, so two runs on one symbol take row locks in one order; (4) category `merged` is given when any fresh period of the row's type has its `filed_date`.
- Added beyond the step text: `source.PeriodQuarterly` / `source.PeriodAnnual`, with the two unexported constants in `internal/edgar` now set from them (DRY guard rail: the planner needs the two names and the service does not import `internal/edgar`).
- Known edge, by design (D-17), not changed here: a current-version row that the derivation now dates differently (same type and `filed_date`, other `period_end`) is deleted, and its corrected period is inserted only when that `period_end` is inside the request range. Outside the range the row is listed in `Unreplaced` as `merged` and logged by Step 8, and the period returns on the next backfill whose range covers it. This needs SEC to change a filing's facts after the row was stored at version 3.
- TDD (unit): RED before `plan.go` existed — the package did not compile (`undefined: Request`, `unknown field FiscalPeriod in struct literal of type source.HistoricalPriceState`). Assertion-level RED by mutation after the unit: with rule (c) removed, `TestBuild_CollidedRowRestoresBothPeriods_AC8_feature348` fails `inserts = [Q1-2026@2025-08-31], want [Q1-2026@2025-08-31 Q1-2027@2026-08-31]`; with the filer guard returning nil, `TestBuild_Guards_AC9_feature348` fails `another filer's values: err = <nil>`. Both mutations were reverted. GREEN: see Step 5.
- Files modified: `services/xstockstrat-marketdata/internal/reconcile/plan.go`, `services/xstockstrat-marketdata/internal/source/source.go`, `services/xstockstrat-marketdata/internal/edgar/edgar_client.go`
- Deviations: none

### Step 5 — test: reconcile planner cases [done]
- Atomic unit Steps 4+5. Seven tests cover the nine cases of the step: identity (incl. same day at another hour), `@AC-8` both halves, rule (b) with the O-4 current-version orphan, the label chain with sorted deletes, requested types, `@AC-9` and the other guards (eight rows), and the four categories plus the replaced cover-page row.
- GREEN: `go test ./internal/reconcile/... -race -count=1 -cover` → `ok … coverage: 97.3% of statements`; `go test ./... -race -count=1` → 17 packages `ok`; coverage `total 86.6`; `golangci-lint` v2.14.0 `0 issues.`; no `periodTypeWanted` left.
- Files modified: `services/xstockstrat-marketdata/internal/reconcile/plan_test.go`
- Deviations: none

### Step 6 — service: repository list-all-rows read and transactional replace [done]
- Atomic unit Steps 6+7. `histInsertStatement` + `histInsertArgs` hold the insert once; `InsertHistoricalFundamentals` appends its `ON CONFLICT` suffix. `ListHistoricalRows(ctx, symbol)` returns every row of the symbol ordered by (`fiscal_period`, `period_type`), an empty non-nil slice when there is none. `ReplaceHistoricalFundamentals(ctx, symbol, deletes, inserts)` sorts a copy of the deletes, marshals every insert before `Begin`, runs the pinned deletes (dates bound as `YYYY-MM-DD` text, S-9; exactly one row each) then the plain inserts, and commits last. An empty plan opens no transaction. No `SET`, no advisory lock.
- TDD (unit): RED before the methods existed — build failure (`repo.ListHistoricalRows undefined`, `ReplaceHistoricalFundamentals undefined`, `undefined: histInsertStatement`). Assertion-level RED by mutation: with dates bound as `time.Time`, four replace cases fail on the delete arguments; with the row-count rule loosened to "0 rows only", the two-row case fails `want it to contain "removed 2 rows, want 1"`. Both mutations reverted. GREEN: see Step 7.
- Files modified: `services/xstockstrat-marketdata/internal/repository/marketdata_repo.go`
- Deviations: none

### Step 7 — test: pgxmock pins for the list read and the replace [done]
- Atomic unit Steps 6+7. `TestListHistoricalRows_feature348` pins the projection, `WHERE symbol=$1`, the order, every scanned field and the decoded `stockholders_equity` 66,772,000,000, plus the empty result. `TestReplaceHistoricalFundamentals_feature348` has six cases (the `@AC-5` plan, sorted deletes, 0-row delete, 2-row delete, insert error, empty plan) and the no-`ON CONFLICT` check on the shared statement.
- The first version of the 0-row and 2-row cases only asserted "an error": the mutation run showed the 2-row case still passed when the row-count rule was loosened, because pgxmock's own "unexpected Exec" error satisfied it. The cases now assert the error text (`removed N rows, want 1`), which is what proves no insert ran.
- GREEN: the `-run 'ListHistoricalRows|ReplaceHistoricalFundamentals' -v` log has 2 top-level and 6 sub-test `--- PASS`; `go test ./... -race -count=1` → 17 packages `ok`; `golangci-lint` `0 issues.`; the `ON CONFLICT … DO NOTHING` text occurs once in `marketdata_repo.go`.
- Files modified: `services/xstockstrat-marketdata/internal/repository/marketdata_repo_test.go`
- Deviations: none

### Step 8 — service: backfill write path reconciles through the planner [done]
- Atomic unit Steps 8+9. `backfillOneSymbol` now fetches the full history (no range, no type filter), lists the symbol's stored rows once, builds the plan with the request's types and range, prices every planned insert before the transaction, calls `ReplaceHistoricalFundamentals` once, logs one INFO per row deleted without replacement after the commit, then runs the unchanged in-place path over the identical pairs. `histFundamentalsRepo` stays at 10 methods (`ListHistoricalRows`, `ReplaceHistoricalFundamentals` in; `InsertHistoricalFundamentals`, `GetHistoricalPriceState` out, also deleted from the repository). `HistoricalPriceState.Found` is gone. `derivePriceMetrics` = `closeAtFiling` + `applyPriceRatios`; `mergePrice`, `priceMergedChanged`, `deriveDividendYield`, `accumulateTTM`, `priceJoin` are untouched (R-14).
- Readings of the step text: (1) the stored rows are listed and the plan is built before the dividend fetch, so a guard failure makes no Alpaca call and no dividend upsert; (2) a carried `price`/`dividend_yield` comes from any stored row of the same period type and `filed_date` (deleted or not), earliest `period_end` first; (3) the existing INFO `re-derived stale stored periods` is still written only when a row was re-derived in place; the snapshot invalidation also runs after a committed replace.
- Removed with the per-period read: the WARN `fundamentals backfill: price-state read failed (skipped)`. A failed list read now fails the symbol (item 2).
- INFO message of item 6: `fundamentals backfill: stored period deleted without replacement` with `symbol`, `fiscal_period`, `period_type`, `period_end`, `filed_date`, `category`. Step 14 documents it.
- TDD (unit): RED on the pre-unit service — the test package does not build against the old interface (`*fakeHistRepo does not implement histFundamentalsRepo (missing method GetHistoricalPriceState)`). Assertion-level RED by seven mutations of the new code, each reverted: no carry from the stored row → `@AC-11` case 1 fails; in-place updates after a failed replace → the D-24/S-10 test fails; no snapshot invalidation after a replace → `@AC-5/@AC-6` fails (`snapshot invalidations []`); TTM reset per period → the TTM test fails; ratios carried instead of recomputed → `@AC-11` cases 1 and 5 and the TTM test fail; plan built without the request range → `@AC-8` fails (`rows 3 written 1`); no INFO loop → the D-24 test fails (`0 records`). GREEN: see Step 9.
- Files modified: `services/xstockstrat-marketdata/internal/service/marketdata_service.go`, `services/xstockstrat-marketdata/internal/repository/marketdata_repo.go`, `services/xstockstrat-marketdata/internal/source/source.go`
- Deviations: none

### Step 9 — test: backfill reconcile tests, migrated fakes, read and snapshot cases [done]
- Atomic unit Steps 8+9. Fakes: `fakeHistRepo` (no stored row; records inserts from the replace), `fakeHistRepo211` (no-op), `fakeHistRepo216` (lists its store; applies a replace as the SQL does — pinned delete must match exactly one row, insert must not hit a live key — and records each call; `replaceErr` injects a failure). `fakeHistRepo216.UpdateHistoricalPriceJoin` now changes only the five price columns of the stored row, like the SQL; before, it overwrote the whole state, which would have dropped the row's identity.
- Migrated (O-21), every existing assertion kept: the six feature 216 tests and the feature 223 test seed their stored row through `repo.seed(...)` (same label, type, `period_end`, `filed_date` and `net_income` as the fake source's period) and end with `repo.noReplace(t)`. `onePeriod216` and `axpQ2Period` carry a `net_income`. `backfill216Cfg`, the 223 config, `TestBackfillFundamentals_CapDegrade_AC5` and `dividendYieldSvc` set `fundamentals.history.backfill.max_lookback_years` to 100: the last two are not 216/223 tests, but their 2019 and 2025 period ends would fall outside the default ten-year range in time now that the planner applies it.
- New tests (8, all `feature348`): `@AC-5/@AC-6` replace + one snapshot invalidation; `@AC-6` snapshot built from the 2026-08-31 period (`as_of` 2026-09-11); `@AC-8` both halves; `@AC-9` with the `fundamentals/failed` count; `@AC-11` five sub-cases (i–vi of the step); D-24 log + S-10; TTM over identical and inserted quarters; `@AC-4` read boundary. `@AC-4` is **red N/A — characterization** (the read path is unchanged; its RED is Step 3's).
- Share count in the ORCL helper is 1,000,000, the same synthetic value `onePeriod216` uses; net income and equity are the real ORCL values.
- Repository test: `TestGetHistoricalPriceState` deleted with its method; the projection is pinned by `TestListHistoricalRows_feature348`.
- GREEN: `-run 'BackfillFundamentals|GetHistoricalFundamentals|EdgarSnapshot|PriceJoin' -v` → 28 top-level `--- PASS` (8 `feature348`), 0 `--- SKIP`, 0 FAIL; `go test ./... -race -count=1` → 17 packages `ok`; coverage `total 86.6`; `golangci-lint` `0 issues.`; the four `test` greps passed; `node scripts/check-config-wiring.mjs` → `exit=0` (no output).
- Files modified: `services/xstockstrat-marketdata/internal/service/marketdata_service_test.go`, `services/xstockstrat-marketdata/internal/repository/marketdata_repo_test.go`
- Deviations: none

### Correction — verification runs of Steps 2–9 re-checked (2026-11-16)
- Found while verifying Steps 10+11: this shell ignores `set -e` (`set -e; false; echo survived` prints `survived`). The earlier Verification blocks were run as one script ending in an `echo`, so their closing "all passed" line proved only that the script reached its end. The `go test`, coverage and `golangci-lint` results were read from their own output and stand. The `test "$(grep …)"` lines were not individually confirmed.
- Every such check of Steps 2–9 was re-run with a runner that prints PASS/FAIL per command. Result: all pass except two of Step 3 — `grep -rl "orcl_companyfacts" … | wc -l` and the CRWD twin returned 0, not 1, because the tests named the fixtures `"orcl"` / `"crwd"` and built the file name. The Step 3 entry's "the seven `test` checks … passed" was therefore wrong for those two.
- Fix (Step 3 files only): `period_identity_test.go` now names the three fixture files in constants (`fixtureORCL`, `fixtureCRWD`, `fixtureLYFT`) and `own_period_test.go` uses the constant. Both checks now return 1; `go test ./internal/edgar/... -race -count=5` → `ok`. The C-13 intent (one consuming test file) held before and after.
- From here on every Verification command is run through the PASS/FAIL runner.

### Step 10 — service: no-write audit (`internal/fundaudit`, `cmd/fundamentals-audit`) [done]
- Atomic unit Steps 10+11. `fundaudit.ParseRows` reads `{"<SYMBOL>": [period…]}` in the `query_fundamentals` shape; `fundaudit.Plan` derives each symbol through the one-method `Deriver` interface (`*edgar.Client` satisfies it), runs `reconcile.Build` with both types, an open range and the derivation's left-out list, and returns per-symbol reports plus lane totals and two count maps (deleted without replacement by category, left out by reason); `PostRepairVerdict` and `Diff` are separate functions. `cmd/fundamentals-audit` has `plan` and `diff`; exit 0 ok, 1 post-repair verdict failed, 2 usage or unreadable input.
- Readings of the step text: (1) the post-repair run is selected by the presence of `-post-repair-failed` (its value may be empty), since a run with no failed symbol must still be a post-repair run; (2) the verdict also fails when a symbol outside the failed list could not be planned (derive error or guard): the audit then cannot show that it plans no change. This only tightens `@AC-7`; (3) the diff counts an ambiguous key once, when either side holds more than one row for it and the pre side holds at least one.
- Row shape is taken from the code (`MessageToDict(p, preserving_proto_field_name=True)` of `HistoricalFundamentalsPeriod`), not from a live MCP response: no staging call was made for this step. The first real rows are parsed at Step 15, before any repair.
- Command smoke run (scratchpad binary): no arguments → usage, exit 2; `plan` without the required flags → exit 2; `diff` on a one-row file against itself → `compared 1`, exit 0; `plan` on the collided ORCL row reached SEC: `data.sec.gov` answered 200, but `www.sec.gov/files/company_tickers.json` answered 403 "Request Rate Threshold Exceeded" for a tool-only `User-Agent` with no contact, so the symbol was reported under `derive_error` and, with `-post-repair-failed ""`, the verdict failed with exit 1. **A live `plan` run that derives a symbol has not been seen in this session.** SEC needs a `User-Agent` that declares a contact; the operator's value is needed at Step 15 (no personal detail is sent from here).
- TDD (unit): RED before the package existed — build failure (`undefined: ParseRows`, `undefined: Report`). Assertion-level RED by mutation, each reverted: `missing_metrics` ignored → the parse and diff tests fail; unplanned symbols ignored by the verdict → `@AC-7` fails; duplicate `period_end` ignored → `@AC-7` fails; left-out list not passed to the planner → the per-symbol test fails (`period_type_changed`, want `left_out`). That last mutation survived the first version of the test; the test gained a stored row matching a left-out period.
- Files modified: `services/xstockstrat-marketdata/internal/fundaudit/audit.go`, `services/xstockstrat-marketdata/cmd/fundamentals-audit/main.go`
- Deviations: none

### Step 11 — test: audit parsing, per-symbol report, pass conditions, pre/post diff [done]
- Atomic unit Steps 10+11. Five tests: the ORCL row in the `query_fundamentals` shape (nil `pe_ratio` from `missing_metrics`, 0 for an omitted non-missing column, version from the parameter); malformed and missing dates name the symbol; the per-symbol report (replaced collided row not listed, `no_period_derived`, `left_out`, guard, derive error, lane totals); `@AC-7` seven cases; `@AC-11` diff (value → null, value → value, two ambiguous keys, one unmatched pre row).
- Test literals: price 310.25 and pb 13.1 are the `@AC-11` values; `market_cap` 310,250,000 is price × the synthetic 1,000,000 shares used in the service tests.
- GREEN (PASS/FAIL runner, 0 failures): `go test ./internal/fundaudit/... -race -count=1 -cover` → `ok … coverage: 99.0%`; the command builds; `go test ./... -race -count=1` → all packages `ok`; coverage `total 87.3`; `golangci-lint` `0 issues.` (the first lint run failed on six unchecked `fmt.Fprint` results in the command; fixed with one `say` helper); both Dockerfile checks pass.
- Files modified: `services/xstockstrat-marketdata/internal/fundaudit/audit_test.go`
- Deviations: none

## Open Items

- **Audit range against the repair range — operator decision pending (raise in the batched question before Step 15).** The audit plans with an open range (Step 10 item 1), the repair runs with `start=<lane minimum period_end>` (design.md § 6). For a symbol whose stored rows are all identical to the derivation (nothing deleted), the repair inserts only periods inside its range (D-17), so SEC periods older than the lane minimum stay unstored; the open-range audit then plans inserts for them and the post-repair verdict (`@AC-7`, "plans no delete and no insert for every non-failed symbol") fails although the repair did what it was asked. Symbols with at least one stale row are not affected (rule (c) inserts their whole history). Options to put to the operator: (A) give `plan` optional `-from`/`-to` flags and run the post-repair audit with the repair's `start`; (B) keep the open range and read those planned inserts as expected; (C) run the repair with a start early enough to cover every SEC period. Earliest step that could carry the change: a follow-on to Step 10 before Step 15. Nothing was chosen here.

### Step 12 — test: replace SQL against a real database (`dbtest` tag) and CI job `marketdata-db-test` [done]
- `fundamentals_replace_dbtest_test.go` (`//go:build dbtest`): `dbtestRepo` reads `MARKETDATA_DB_TEST_URL` (fatal when unset under `CI=true`, skip otherwise), sets `DB_PGBOUNCER=true`, and deletes rows under the reserved prefix `ZZ348_` in cleanup. Two tests: `@AC-5/@AC-7` (collided row at version 2 → two corrected rows at version 3, equity 66,772,000,000 read back exactly, the `period_end > filed_date` count 1 → 0, no duplicate `period_end` group, and the same plan a second time misses its pinned delete and changes nothing) and three rollback cases (pinned delete with another version, with another `period_end`, insert on a key that is still stored).
- CI job `marketdata-db-test` ("Marketdata DB test (TimescaleDB)") is a copy of `portfolio-db-test` with the marketdata paths and `MARKETDATA_DB_TEST_URL`; it is in `ci-gate`'s `needs` and echo list. `docs/patterns/ci-overview.md` has its row.
- TDD: **red N/A — characterization** (the SQL shipped in Steps 6+7; this step is its proof on a real database).
- Local verification (PASS/FAIL runner, 0 failures): `go vet -tags dbtest` ok; the two cases `--- SKIP` without the URL; with `CI=true` and no URL both fail with `MARKETDATA_DB_TEST_URL is unset under CI=true`; untagged `go test ./... -race` ok; the four greps pass; `golangci-lint` `0 issues.` with and without `--build-tags dbtest`; `ci.yml` parses and `ci-gate.needs` contains the job. No database was started.
- CI proof on the PR: see "CI results" below (added after the push).
- Files modified: `services/xstockstrat-marketdata/internal/repository/fundamentals_replace_dbtest_test.go`, `.github/workflows/ci.yml`, `docs/patterns/ci-overview.md`
- Deviations: none

### Step 13 — docs: signed CHANGE to feature 216 `@AC-5` and two prose notes in the durable suites [done]
- `fix-historical-fundamentals-price-join.feature`: the one `And` line the operator signed (answer 2, 2026-11-16) added to `@AC-5 @feature-216` between its second given and its `When`; a header note that `@AC-3`, `@AC-4`, `@AC-5` are about rows the current derivation reproduces and that any other row is replaced (feature 348 `@AC-5`, `@AC-11`). `fix-stored-edgar-periods.feature`: one sentence in the feature description. No scenario added, none edited besides the signed line. TDD: N/A (docs).
- Verification (PASS/FAIL runner): the six checks pass (added line present once; 5 and 2 scenarios; both files cite 348; exactly two files changed).
- Files modified: `services/xstockstrat-marketdata/acceptance/fix-historical-fundamentals-price-join.feature`, `services/xstockstrat-marketdata/acceptance/fix-stored-edgar-periods.feature`
- Deviations: none

### Step 14 — docs: derivation and reconcile docs, MARKETDATA-13, findings, observability, runbook procedure [done]
- `docs/fundamentals.md` (service): the three closing paragraphs rewritten for version 3 — period identity (accession, form class, own end, merge rule, label rule, the two left-out reasons, shares), a new "Backfill reconcile" paragraph (identical / replaced / insert rule / pricing / guards / INFO record / snapshot invalidation), ratio bases and own-period selection restated without `fy`/`fp`; the pointer to the findings log for `shares` is gone. MARKETDATA-13 restated for the reconcile with current evidence symbols. Findings: the `shares` first-seen and cover-page `period_end` rows moved to `## Resolved` (2026-11-16, feature 348); the stale-`pe_ratio`/`pb_ratio` row stays open with re-stamped hints (`#mergePrice ~L2520`, call ~L2473, `coalesceF64` ~L2510). `CLAUDE.md` § Observability: the `periods_left_out` instrument and one line for the INFO record. Runbook: the feature-223 subsection replaced by the reconcile semantics, the audit command, and the lane A / lane B procedure with the three pass-condition queries verbatim, the flag's end state per lane and the restore. TDD: N/A (docs).
- The runbook says the audit plans with an open range and therefore also lists older SEC periods for a symbol whose rows were all already correct. That sentence states the tool's behaviour as built; it is the Open Item above and will be revised when the operator decides.
- The runbook points to `docs/runbooks/operator-db-access.md` and feature 340 `design.md` § Step 5 for the per-lane read paths instead of repeating host names.
- Verification (PASS/FAIL runner, 0 failures): `scripts/check-context-map.py` → `OK - all context-map and doc references resolve.`; `scripts/check-otel-produced-signals.py` exit 0; `markdownlint-cli2` on the service `CLAUDE.md` exit 0; the four greps pass. By eye, with a grep over the five files for `ON CONFLICT`, `first-seen`, `cover-page`, `upgraded in place`, `earliest-filing pin`: the only hits are MARKETDATA-13's "never add … an `ON CONFLICT` insert", the two `## Resolved` rows (past tense), and the fundamentals doc's statements of the new rules. A wider grep of `docs/`, `services/`, `plugins/` for the two removed method names and the old identity wording found nothing outside feature directories.
- Files modified: `services/xstockstrat-marketdata/docs/fundamentals.md`, `services/xstockstrat-marketdata/docs/context-constitution.md`, `services/xstockstrat-marketdata/docs/context-constitution-findings.md`, `services/xstockstrat-marketdata/CLAUDE.md`, `docs/runbooks/historical-backfill.md`
- Deviations: none


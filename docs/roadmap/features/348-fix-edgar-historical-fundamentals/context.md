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

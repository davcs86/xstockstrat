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

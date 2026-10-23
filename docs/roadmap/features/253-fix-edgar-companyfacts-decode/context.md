# Context Log: fix-edgar-companyfacts-decode

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-10-21 (/sdd-triage)

- Bug recorded in defect report `docs/reports/2026-10-21-edgar-companyfacts-string-cik-defect.md` (Issues disabled); found by the staging fundamentals backfill
  `8de93c4c-08e8-4ebf-a8cf-0d99e503ceca` run during feature 231's post-deploy verification.
- Severity: SEV-3
- Routed to SDD path (Track C)
- Created: feature.md, product-spec.md, acceptance.feature (regression scenario), context.md
- Affected services: xstockstrat-marketdata
- Root cause hypothesis: `companyFacts.CIK json.Number` (`internal/edgar/edgar_client.go:105`) rejects SEC's
  zero-padded string form; the field is unused.
- Number: 253 — 241–252 are already claimed by other branches' feature dirs (max+1 across `origin/*`).
- Recommended design depth: skip → `/sdd-spec fix-edgar-companyfacts-decode` (rationale: SEV-3, single service,
  no proto/migration/config, clear root cause)
- Development branch: feature/fix-edgar-companyfacts-decode

## Session 2026-10-21 — sdd-spec

- Generated implementation-spec.md with 2 steps. Status draft → implementation-ready. Both gates
  skipped: `/sdd-design` per triage's `skip` (bug-triage Track C), and `/sdd-review product-spec`
  never ran (status was still `draft`).
- Decision: delete the unused `companyFacts.CIK json.Number` field (`internal/edgar/edgar_client.go:105`)
  rather than retype it (`json.RawMessage` or a string-or-number unmarshaler). Nothing reads it (the
  only `.CIK` read is `tickerEntry.CIK` at `:145`), and `encoding/json` ignores unmapped keys (C-18
  YAGNI). A scratch program confirmed that a `json.Number` field rejects `"0001876042"` and that the
  struct without the field decodes both forms.
- Key codebase findings:
  - Regression test reuses `newTestClientCF211` (`edgar_client_test.go:238`) and pre-seeds
    `c.cikCache["CRCL"]` (the cache-hit return at `edgar_client.go:129–134`), so it resolves CRCL
    without a second round-tripper. `periodByFP` (`ttm_roe_test.go:41`) finds `"FY2025"`.
  - No `DerivationVersion` bump (MARKETDATA-13): builder output is unchanged. The four symbols
    have no stored rows, so a plain re-backfill inserts them.
  - Open thread: `tickerEntry.CIK` (`cik_str`, `:100`) is also `json.Number`. SEC sends it as a
    number today. Left out of scope and flagged for `/sdd-review` rather than changed silently.
  - Open thread: `acceptance.feature`'s `@AC-1` has no `@FR-N` tag and the product spec has no
    `FR-N` list. This is a triage-template artifact that `/sdd-review` may flag under C-15.

## Session 2026-10-21 — sdd-execute (sequential)
- Operator "go ahead" taken as the sequential-mode up-front confirmation. Development branch is the harness branch
  `ccr-9f55a8ac-dtw4iv` (PR #1274 is the integration PR), as for feature 231.
- `/sdd-review impl-spec` not run (2-step SEV-3 fix; operator asked to proceed straight through).
- Toolchain: Go 1.27.0 (GOTOOLCHAIN), golangci-lint v2.14.0 at `/root/go/bin`.

### Step 2 — test: `@AC-1` companyfacts decodes a string or a number `cik` [done]
- Written first (TDD). RED on the unfixed struct: `cik_string` FAIL —
  `companyfacts CRCL: json: cannot unmarshal string "0001876042" into Go value of type json.Number: invalid syntax`
  (identical to the staging backfill error); `cik_number` PASS.
- GREEN after Step 1: both subtests PASS; full suite `-race` ok; coverage total 71.0% (≥ 40); golangci-lint 0 issues;
  `TestDerivationVersion_GoldenDriftGuard_feature223` PASS; "Circle Internet Group" declared once (C-13).
- Files modified: `services/xstockstrat-marketdata/internal/edgar/edgar_client_test.go`
- Deviations: none (executed before Step 1, as the step's own TDD note directs)

### Step 1 — service: drop the unused `CIK` field from `companyFacts` [done]
- Removed `CIK json.Number \`json:"cik"\`` from `companyFacts`; gofmt clean; `grep 'json:"cik"'` empty; build + lint ok.
- Files modified: `services/xstockstrat-marketdata/internal/edgar/edgar_client.go`
- Deviations: none

### Integration
- Merge-order gate: no entry for this slug. C-16: AC-1 promoted to
  `services/xstockstrat-marketdata/acceptance/fix-edgar-companyfacts-decode.feature` with `@feature-253`.
- Teardown: no context file touched and no documented behavior changed (no CLAUDE.md/constitution mentions the
  companyfacts `cik` field) — nothing to reconcile.
- Post-deploy: re-run the fundamentals backfill for CRCL, ELWT, PSKY, RDDT; AARD failed the 2026-10-21 watchlist
  backfill (`aa5804de`) too, cause unconfirmed — include it.

## Session 2026-10-22 (CI: feature status automation)

- Promotion PR #1295 merged to main
- Feature promoted and committed: 38e2e104129f16dd339f9375901334a274109511
- Status updated: `code-completed` → `launched`
- Launched date: 2026-10-22

# Implementation Spec: fix-fundamentals-roe-unit

**Status**: `pending`
**Created**: 2026-11-15
**Feature**: `docs/roadmap/features/340-fix-fundamentals-roe-unit/feature.md`
**Total Steps**: 10
**Feature Branch**: `feature/fix-fundamentals-roe-unit`

---

## Execution Summary

The defect is wrong EDGAR inputs, not a unit error (design.md § What is being fixed). Step 1 restates
the acceptance values, the product-spec premise, the title and the defect report from the LYFT filing
before any code (design.md § Spec restatement). Steps 2+3 land the derivation-owned key list and the
re-derive strip, so the strip exists on every tree that carries the version bump. Steps 4+5 land the
own-period selection in `FetchHistorical` with `DerivationVersion` 1 → 2, proven red-then-green on a
LYFT fixture cut from the real filing. Step 6 adds the vendor and absent/negative guards, Steps 7+8
the comment-only proto unit lines, Step 9 the docs, and Step 10 is the operator gate that must close
before the integration PR merges into `main-dev`.

Paths below are under `services/xstockstrat-marketdata/` unless they start with `docs/`,
`packages/` or `services/`. Every line number was re-read on
`feature/fix-fundamentals-roe-unit@90d0a2424` (C-01).

**Order differs from the design's numbering, not its content.** The design lists the selection fix
as its Step 1 and the key list as its Step 2. Here the key list and strip go first, because the
version bump is what makes stored rows re-derive, and the strip must already be in place when it does.

### Scenario Coverage (C-15)

Scenario text is the Step 1 restatement of `acceptance.feature`.

| Scenario | Covered by |
|---|---|
| `@AC-1` LYFT's served ROE agrees with its own net income and equity | Step 5 |
| `@AC-2` each vendor path serves ROE as a fraction (unit-level guard) | Step 6 |
| `@AC-3` historical fundamentals serve ROE as a fraction (FY2025) | Step 5 |
| `@AC-4` an absent or negative ROE is preserved | Step 6 |
| `@AC-5` a wrong ROE stored before the fix is no longer served | Step 3, Step 5 |

### Consumer Surfaces (C-14)

The product spec names the `/trader` symbol-page Fundamentals card and the agent fundamentals tools,
both with **no consumer code change**: each already reads `roe` as a fraction and is corrected by the
served value alone (product-spec.md § Consumer Surface(s); design.md § What is being fixed). No
`services/xstockstrat-ui/` or `services/xstockstrat-agent/` step exists, by decision. The surfaces are
checked through the served value in the post-deploy procedure (canary `query_fundamentals`).

### Open items carried from design (not resolved by this spec)

- **O-16, operator.** D/E and P/B change for every EDGAR filer through the corrected equity. The
  operator approved the design that carries this; a separate acceptance of the blast radius is still
  not recorded in context.md. It must be recorded before Step 10's freeze.
- **"max_connections are now love."** The operator's relayed message is still unexplained. If a
  database's `max_connections` changed, the Step 10 and post-deploy `psql` sessions are re-checked
  against the connection budget (F-06) before they run.
- **O-38.** None of the design's SQL has been executed. Step 10's dry run is its first execution.

## Step Dependencies

- Step 1 precedes every code step: the restated scenarios are what Steps 3, 5 and 6 cover.
- Steps 2+3 land together: Step 2 changes the `RederiveHistoricalFundamentals` SQL and argument
  list, which turns the existing pgxmock expectation red (`internal/repository/marketdata_repo_test.go:573-576`);
  Step 3's test also references the symbol Step 2 creates (step-constraints.md §C, rows 1 and 3).
- Steps 4+5 land together: Step 4 bumps `DerivationVersion`, which turns
  `TestDerivationVersion_GoldenDriftGuard_feature223` red until Step 5 records the version-2 golden
  (`internal/edgar/derivation_version_test.go:53-56`).
- Steps 7+8 land together: a `.proto` edit and its `proto-gen` (step-constraints.md §C, row 2). The
  edit adds comments only, so no descriptor-parity guard or hand-mapped field list changes.
- Step 4 requires Steps 2+3: the bump must not exist on a tree without the strip.
- Step 5 [test] covers Step 4 [service]; Step 3 [test] covers Step 2 [service] (C-08).
- Step 6 stands alone: it adds guards for behavior that is already correct and changes no production code.
- Step 9 requires Steps 2 to 5 (it documents them).
- Step 10 requires Steps 1 to 9 and must close before the integration PR merges into `main-dev`:
  homelab staging and DO staging both deploy on a push to `main-dev`
  (`.github/workflows/deploy-dev.yml`, which calls `deploy-homelab.yml`), so a pre-export taken after
  the merge can no longer be trusted (design.md § Open Risks).
- `DerivationVersion` 2 is free: `docs/roadmap/features/merge-order.md` names the constant only for
  the launched pair 222/223 (`:82`), and no other in-flight feature's files mention it.
- Rebase overlap, file-level only (context.md, sdd-review): `internal/service/marketdata_service.go`
  vs 317, `internal/fmp/fmp_client.go` and `internal/finnhub/finnhub_client.go` vs 320,
  `packages/proto/marketdata/v1/marketdata.proto` vs 322. This spec edits none of those Go files'
  production code; the proto edit is two comment lines. Re-grep anchors after any rebase.
- The post-deploy repair and audit is **not** an execute step. It runs after the integration PR
  merges; see § Post-Deploy Procedure.

---

### Step 1 — docs: restate the acceptance values, product-spec premise, title and defect report from the LYFT filing

**Status**: `done`
**Service**: `docs/roadmap/features/340-fix-fundamentals-roe-unit/`, `docs/reports/`
**Files**:
- `docs/roadmap/features/340-fix-fundamentals-roe-unit/acceptance.feature` — modify
- `docs/roadmap/features/340-fix-fundamentals-roe-unit/product-spec.md` — modify
- `docs/roadmap/features/340-fix-fundamentals-roe-unit/feature.md` — modify
- `docs/reports/2026-11-15-marketdata-roe-value-implausible-defect.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `acceptance.feature:8-12`, `:15-25`, `:28-31`, `:46-50` hold `0.0366` and `28070000 / 767000000`.
  No staging row holds 28,070,000 (`recon.md:136`).
- `product-spec.md:14-18` holds the "low single-digit percent" claim; `:27-28` says "Not traced".
- `feature.md:37` holds "suspected percent-vs-fraction unit error".
- The defect report's title (`:1`), `## Expected` and `## Root cause hypothesis` carry the same premise.
- Operator sign-offs: design.md § Business Rules Touched (CHANGE `@AC-1`, `@AC-2`, `@AC-3`, `@AC-5`);
  debate.md D-11, D-12.

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:

The slug, the branch and the directory stay. Scenario IDs stay (C-15, append-only).

1. Replace `acceptance.feature` scenarios `@AC-1`, `@AC-2`, `@AC-3` and `@AC-5` with the text below.
   Leave `@AC-4` untouched. Replace the three header lines under `Feature:` with: the traced path is
   the EDGAR quarterly TTM derivation served through the EDGAR snapshot, and the values come from
   LYFT's SEC companyfacts (CIK0001759509), fixture
   `services/xstockstrat-marketdata/internal/edgar/testdata/lyft_companyfacts.json`.

   ```gherkin
   # guards: docs/reports/2026-11-15-marketdata-roe-value-implausible-defect.md
   @AC-1 @FR-1 @FR-2 @regression
   Scenario: LYFT's served ROE agrees with its own net income and equity
     Given the EDGAR snapshot path serves fundamentals for "LYFT" from its SEC companyfacts filing
     And the filing's trailing-twelve-month net income is 2809866000 and its "Q3-2026" quarter-end shareholders' equity is 2980873000
     When GetFundamentals is called for "LYFT"
     Then the returned roe is 0.942632

   @AC-2 @FR-1
   Scenario Outline: each vendor provider path serves ROE as a fraction (unit-level guard)
     Given the <provider> path supplies fundamentals for "LYFT" with <raw input>
     When GetFundamentals is called for "LYFT"
     Then the returned roe is 0.0366
     And GetFundamentalsMulti for "LYFT" returns the same roe

     Examples:
       | provider | raw input                                        |
       | Finnhub  | roeTTM 3.66 expressed in percentage points       |
       | FMP      | returnOnEquityTTM 0.0366 expressed as a fraction |

   @AC-3 @FR-3
   Scenario: historical fundamentals serve ROE as a fraction
     Given the stored annual period "FY2025" for "LYFT" has net income 2844008000 and shareholders' equity 3273523000
     When GetHistoricalFundamentals is called for "LYFT"
     Then the "FY2025" period's roe is 0.868791

   # guards: docs/reports/2026-11-15-marketdata-roe-value-implausible-defect.md
   @AC-5 @FR-5 @regression
   Scenario: a wrong ROE stored before the fix is no longer served
     Given roe 3.6634 was stored for "LYFT" period "Q3-2026" before the fix
     And the filing's trailing-twelve-month net income is 2809866000 over "Q3-2026" quarter-end shareholders' equity 2980873000
     And the post-deploy fundamentals backfill has re-derived the stored "LYFT" periods
     When the fix is deployed and GetFundamentals is called for "LYFT"
     Then the returned roe is 0.942632
   ```

   The block above is printed without the file's indent. In `acceptance.feature` keep the existing
   layout: `# guards:` comments, tag lines and `Scenario` lines at two spaces, steps and `Examples:`
   at four, table rows at six. The `^  @AC-` count in Verification depends on it.

   The third `Given` of `@AC-5` ("the post-deploy fundamentals backfill has re-derived …") is new
   wording from this spec. It states the design's repair mechanism (D-2) and changes no `Then`. The
   operator's sign-off ("I approve 340, including the acceptance scenario") was given at the round-6
   design gate for the `@AC-2` change and predates this line, so it does not cover it (C-15, C-11).
   Ask the operator at the Step 1 confirmation. Write the line only on an explicit yes; otherwise
   omit that one line and record the answer in context.md. No Verification count depends on it.

2. `product-spec.md`:
   - Problem Statement (`:12-18`): replace the "tens of millions … low single-digit percent" reading
     with the traced one. The served `3.6634` is a genuine trailing-twelve-month net income of
     2,809,866,000 divided by a prior-year-end equity of 767,016,000; the quarter-end equity is
     2,980,873,000, so the expected value is `0.942632`. Keep "`roe` is a fraction" as the contract.
   - Root Cause Hypothesis (`:25-39`): replace "Not traced" with a pointer to `recon.md`
     § Root-Cause Trace and debate.md D-11. Keep the producer list as the paths that were ruled out.
   - FR-1 (`:43-45`): keep the requirement; the parenthetical example `3.66% is 0.0366` stays, since
     it is the vendor-unit example `@AC-2` still uses.
   - Open Question 1 (`:76-79`): append "Traced 2026-11-15: EDGAR quarterly TTM path; see recon.md."
   - Out of Scope (`:100-101`): note that `debt_to_equity` and P/B move with the corrected equity
     (design.md § Open Risks, O-16) even though no unit audit of them is in scope.
3. `feature.md`: replace the `## Summary` sentence (`:36`) with one that names the traced cause
   (EDGAR quarterly ROE divided by a comparative-column equity; corrected LYFT value 0.942632). The
   `# Feature:` heading holds the slug and stays.
4. Defect report: retitle (`:1`) to drop "suspected percent-vs-fraction unit error"; rewrite
   `## Expected` and `## Root cause hypothesis` to the traced cause, and raise `## Confidence` from
   `low` to the level the trace supports. Leave `## Observed`, `## Reproduction` and the `.status`
   sidecar unchanged.

**Verification**:

```bash
F=docs/roadmap/features/340-fix-fundamentals-roe-unit
grep -c "0.942632" $F/acceptance.feature          # 2 (AC-1, AC-5)
grep -c "0.868791" $F/acceptance.feature          # 1 (AC-3)
grep -c "28070000" $F/acceptance.feature          # 0
grep -c "^  @AC-" $F/acceptance.feature           # 5 — IDs unchanged
grep -c "| EDGAR " $F/acceptance.feature          # 0 — AC-2 has no EDGAR example row
grep -n "low single-digit\|Not traced" $F/product-spec.md                     # no match
grep -n "percent-vs-fraction" $F/feature.md docs/reports/2026-11-15-marketdata-roe-value-implausible-defect.md   # no match
```

---

### Step 2 — service: one derivation-owned key list and the re-derive strip

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/source/source.go` — modify
- `services/xstockstrat-marketdata/internal/edgar/edgar_client.go` — modify
- `services/xstockstrat-marketdata/internal/repository/marketdata_repo.go` — modify

**Reviewers**: xstockstrat-marketdata service owner — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence**:
- `RederiveHistoricalFundamentals` — `internal/repository/marketdata_repo.go:786`. Merge SQL at
  `:795-797`: `SET eps=$4, roe=$5, debt_to_equity=$6, extra_metrics = extra_metrics || $7::jsonb, derivation_version=$8`.
  The comment at `:794` says stored keys absent from the new derivation survive the merge. That is
  the gap: a key the new derivation no longer produces (an anchor-miss `stockholders_equity`) keeps
  its stale value.
- `buildPeriod` writes the derivation-owned keys in three places (`internal/edgar/edgar_client.go`):
  `total_debt` at `:589`; the literal slice
  `[]string{"revenue", "net_income", "assets", "liabilities", "stockholders_equity"}` at `:596`;
  `stockholders_equity_usd` at `:603`.
- `source.HistoricalFundamentalsPeriod.ExtraMetrics` — `internal/source/source.go:105`. Both
  `internal/edgar` (`edgar_client.go` import) and `internal/repository` (`marketdata_repo.go:719`
  takes `source.HistoricalFundamentalsPeriod`) already import `internal/source`: no new dependency edge.
- A `[]string` bound to a `::text[]` parameter is an existing pattern in this file:
  `unnest($1::text[])` at `marketdata_repo.go:395`, `:405`, `:479`.
- The jsonb argument is bound as a string for `DB_PGBOUNCER` (`marketdata_repo.go:734`, `:798`).
  Keep that binding.
- Call sites of `RederiveHistoricalFundamentals`: `internal/service/marketdata_service.go:2399`
  (interface at `:192`), three fakes at `internal/service/marketdata_service_test.go:3241`, `:3245`,
  `:3252`, and the repo test at `internal/repository/marketdata_repo_test.go:581`, `:584`. The Go
  signature does not change, so none of them needs an edit.
- **Not found**: any existing exported list of these keys. The symbol is created by this step.

**Lands with**: `Step 3`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:

1. In `internal/source/source.go`, next to `HistoricalFundamentalsPeriod` (`:85-111`), add one
   exported list, `DerivationOwnedExtraKeys`, holding exactly: `revenue`, `net_income`, `assets`,
   `liabilities`, `stockholders_equity`, `stockholders_equity_usd`, `total_debt` (D-8). The name is
   chosen by this spec. Its comment states the constraint only: these `extra_metrics` keys belong to
   the period builder and are replaced, never merged, on re-derive.
2. In `buildPeriod`, replace the literal slice at `edgar_client.go:596` with a range over
   `source.DerivationOwnedExtraKeys`. `total_debt` and `stockholders_equity_usd` are not keys of
   `a.vals`, so `valIn` returns false for them and the builder's output is unchanged. Leave `:589`
   and `:603` as they are. Do **not** bump `DerivationVersion` in this step.
3. In `RederiveHistoricalFundamentals`, strip the owned keys before the merge:
   `extra_metrics = (extra_metrics - $9::text[]) || $7::jsonb`, passing
   `source.DerivationOwnedExtraKeys` as the ninth argument. Price-join keys are not in the list and
   survive. Rewrite the `:794` comment to say so in at most two lines.
4. No new public type, no new served key (C-18, R-13).

**Verification**: runs as one unit with Step 3; see Step 3.

---

### Step 3 — test: the strip SQL and the key-list parity guard

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/repository/marketdata_repo_test.go` — modify
- `services/xstockstrat-marketdata/internal/edgar/edgar_client_test.go` — modify

**Reviewers**: xstockstrat-marketdata service owner — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence**:
- `TestRederiveHistoricalFundamentals_GuardedUpgrade_feature223` —
  `internal/repository/marketdata_repo_test.go:560`. Its `ExpectExec` regex at `:573` pins the
  current SQL text and `WithArgs` at `:574` pins eight arguments; the second expectation at `:576`
  lists eight `pgxmock.AnyArg()`.
- Test harness: pgxmock pool, `repo := &MarketDataRepo{db: mock}` (`:561-566`).
- Fixture helpers in the edgar test package: `debtCF211` (`internal/edgar/edgar_client_test.go:348`),
  `newTestClientCF211` (`:243`), `axpFacts` (`internal/edgar/ttm_roe_test.go:15`).

**Lands with**: `Step 2`

**TDD**: `red-green required`

**Covers**: `AC-5`

**Instructions**:

1. Update the feature-223 test's two expectations to the new SQL text and nine arguments (the ninth
   is `source.DerivationOwnedExtraKeys`).
2. Add a stale-key strip test beside it (RED on the pre-Step-2 tree: the SQL has no strip, so the
   expectation does not match). It re-derives a period whose `ExtraMetrics` is `{"total_debt": …}`
   only and asserts the executed statement removes the owned keys before the merge and receives the
   full key list. Name `@AC-5` in the test comment: a stale `stockholders_equity` cannot survive a
   re-derive.
3. Add a parity test in `internal/edgar/edgar_client_test.go`: every `ExtraMetrics` key produced by
   `FetchHistorical` on a fixture with equity, assets, liabilities, revenue, net income and a debt
   tag is a member of `source.DerivationOwnedExtraKeys`, and every list member is produced. A key
   added to the builder without the list (or the reverse) then fails here.
4. Test data (C-13): the new period literal has one consumer (the strip test) and stays inline. The
   parity fixture extends the existing in-package builders; do not move anything to
   `internal/testdata/`.

**Verification** (union for the Steps 2+3 unit; run from the repo root):

```bash
cd services/xstockstrat-marketdata && GOWORK=off go build ./... \
  && GOWORK=off go test ./internal/repository/... ./internal/edgar/... ./internal/source/... ./internal/service/... -race -count=1
cd services/xstockstrat-marketdata && export GOWORK=off && COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"   # confirm >= 40%
cd services/xstockstrat-marketdata && GOWORK=off golangci-lint run --modules-download-mode=mod
grep -rn "DerivationOwnedExtraKeys" services/xstockstrat-marketdata --include="*.go"   # one declaration, used by edgar and repository
grep -n "const DerivationVersion = 1" services/xstockstrat-marketdata/internal/edgar/edgar_client.go   # still 1 after this unit
```

The repo-test edits are in `internal/repository`, which CI leaves out of the coverage measurement;
the parity test is in `internal/edgar`, which is measured.

---

### Step 4 — service: own-period selection in `FetchHistorical`, `DerivationVersion` 1 → 2

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/edgar/edgar_client.go` — modify

**Reviewers**: xstockstrat-marketdata service owner — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence**:
- `FetchHistorical` — `internal/edgar/edgar_client.go:290`. Facts are bucketed by the filing's
  `fy`/`fp` (`periodKey`, `:286`, used at `:340`) and written first-seen per (metric, unit) at
  `:357-364`: `if _, seen := agg.vals[name][unitKey]; !seen { agg.vals[name][unitKey] = d.Val }`.
- `periodAgg` — `:220-227`; `vals` is "metric → XBRL unit code → first-seen value". It is constructed
  at one site only, `:343` (grep `periodAgg{`); no test constructs it.
- `flowTags` — `:187-193` (`Revenues` and `RevenueFromContractWithCustomerExcludingAssessedTax` both
  map to `revenue`). `instantTags` — `:195-210`; the balance-sheet three at `:196-198`, the
  share-count tags at `:199-200`, the debt tags at `:203-209`.
- The own-period pattern to reuse: `niFact` (`:387-391`), `toNIFact` (`:393`), earliest-filed wins
  per quarter end in `trailingNetIncome` (`:423-424`) and per fiscal-year end (`:435`).
- `periodEnd` is the latest `end` of any fact in the bucket (`:350-352`); earliest `filed` at
  `:347-349`. Both stay.
- Readers of `vals`: `valIn` (`:230`), `valAny` (`:241`), `voteCurrency` (`:259`), `buildPeriod`
  (`:526`), `annualizeQuarterlyROE` (`:475`, equity at `:479`, fallback net income at `:485`).
- `DerivationVersion` — `:524` (`const DerivationVersion = 1`), bump rule in the comment at `:521-523`.
- Stored rows are upgraded when `state.DerivationVersion < p.DerivationVersion`
  (`internal/service/marketdata_service.go:2398-2407`), and the cached edgar snapshot is dropped
  (`:2353-2361`, `DeleteEdgarSnapshot` at `internal/repository/marketdata_repo.go:807`). No change there.

**Lands with**: `Step 5`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:

Follow design.md § Step 1. Rejected alternatives stay rejected: no fallback to first-seen (R-3), no
flow-based anchor (R-2), no descending sort of the instant slice (R-12), no `equity ≈ assets −
liabilities` guard in the code path (R-4), no net-income-only scope (R-10).

1. **Collect.** Replace the first-seen write at `:357-364` with a collect step for every metric
   except `shares`. `shares` keeps today's first-seen write unchanged (D-9). Candidates are held
   inside the function or on an unexported field of `periodAgg`, keyed by (metric, unit, `end`) with
   the earliest `filed` winning per key (the `niFact` rule). `revenue` candidates also keep their
   source tag. No new exported type (D-7).
2. **Anchor (D-6, D-14).** Per bucket, the anchor is the maximum `end` across all units of the
   `stockholders_equity`, `assets` and `liabilities` candidates. Only the three tags at `:196-198`
   feed those keys, so share-count and `dei` cover-page facts never move it. A bucket with none of
   the three has no anchor.
3. **Instants** (the three balance-sheet keys and the debt keys at `:203-209`): keep the candidate
   whose `end` equals the anchor, per unit. Equality only, no tolerance. No match, or no anchor,
   means the key is absent from `vals` (D-3, D-4).
4. **Flows** (`net_income`, `revenue`, `eps`, `eps_basic`; D-13): when the bucket has an anchor,
   keep the candidate whose `end` equals it, else the key is absent. When the bucket has no anchor,
   take the metric's latest `end` and select per unit at that date.
5. **Revenue order (D-15, D-18).** Filter on the selected `end` first, then prefer `Revenues` over
   `RevenueFromContractWithCustomerExcludingAssessedTax`, then earliest-filed.
6. Write the selected values into `vals` before the output loop at `:370`, so `valIn`, `valAny`,
   `voteCurrency`, `buildPeriod` and `annualizeQuarterlyROE` read them unchanged. Update the `vals`
   comment at `:226` ("first-seen value" is no longer true).
7. **Unchanged**: `periodEnd` (`:350-352`, D-31), `buildPeriod`'s ratio math, `annualizeQuarterlyROE`,
   `trailingNetIncome`, `niFacts` collection (`:314-318`).
8. **Version.** Set `DerivationVersion = 2` at `:524` and extend the comment's version list with one
   line for 2 (own-period instants and flows, feature 340).
9. Nil stays nil: an anchor miss yields nil ROE and D/E from `buildPeriod` (`:558-563`, `:590-593`)
   and `annualizeQuarterlyROE` (`:479-481`) with no further change (MARKETDATA-11).

Two points the design leaves to the spec, decided here and open to review:
- Item 3 applies the literal rule to a bucket that holds debt instants but none of the three
  balance-sheet tags: no anchor, so its debt keys are absent.
- Item 4's no-anchor case selects per unit at the metric's latest `end` across its units, mirroring
  D-14's "one date, then per unit".

**Verification**: runs as one unit with Step 5; see Step 5.

---

### Step 5 — test: LYFT fixture, own-period selection tests, version-2 golden

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/edgar/testdata/lyft_companyfacts.json` — create
- `services/xstockstrat-marketdata/internal/edgar/own_period_test.go` — create
- `services/xstockstrat-marketdata/internal/edgar/derivation_version_test.go` — modify
- `services/xstockstrat-marketdata/internal/edgar/edgar_client_test.go` — modify only if an existing test turns red
- `services/xstockstrat-marketdata/internal/edgar/ttm_roe_test.go` — modify only if an existing test turns red

**Reviewers**: xstockstrat-marketdata service owner — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence**:
- **Not found**: `internal/edgar/testdata/` does not exist; the directory and the fixture are created
  here (D-17, D-21). Existing edgar fixtures are inline Go builders (`axpFacts`,
  `internal/edgar/ttm_roe_test.go:15`; `dualCurrencyCF`, `internal/edgar/edgar_client_test.go:261`).
- Test client: `newTestClientCF211(cf map[string]any)` (`edgar_client_test.go:243`) serves any
  companyfacts map and resolves ticker `AAPL`; `periodByFP` (`ttm_roe_test.go:41`).
- Comparative-column test pattern to follow: `TestQuarterlyROE_TrailingTwelveMonths_AC1`
  (`ttm_roe_test.go:62`), `TestAnnualROE_Unchanged_AC3` (`:74`), single-quarter fallback (`:107`).
- `derivationGolden` — `internal/edgar/derivation_version_test.go:16-18`, one entry for version 1;
  the lookup is `derivationGolden[DerivationVersion]` (`:53`).
- Existing fixtures were read against the new rule and are expected to stay green: `axpFacts` has
  equity and the current-quarter net income on the same `end` in `2026-Q2` and `FY2025`; the other
  buckets have no instants. `dualCurrencyCF` and `debtCF211` put every fact on one date.
  `cannedCompanyFacts` (`edgar_client_test.go:50`) has flows only. This is a reading, not a run:
  the unit's test run decides.
- Pinned values (debate.md D-11, D-12; SEC companyfacts CIK0001759509): Q3-2026 trailing net income
  2,809,866,000 (n=4, derived Q4-2025 2,755,053,000), quarter-end equity 2,980,873,000, first-seen
  equity 767,016,000 dated 2024-12-31; FY2025 net income 2,844,008,000, year-end equity 3,273,523,000.

**Lands with**: `Step 4`

**TDD**: `red-green required`

**Covers**: `AC-1, AC-3, AC-5`

**Instructions**:

1. **Fixture.** Fetch LYFT's companyfacts (`https://data.sec.gov/api/xbrl/companyfacts/CIK0001759509.json`,
   with a fair-use `User-Agent`). Trim **by tag only**: keep every fact of the tags in `flowTags` and
   `instantTags` (`edgar_client.go:187-210`) and drop all other tags; do not drop individual facts
   (`trailingNetIncome` needs every `NetIncomeLoss` fact). Commit it at the path above. If the fetch
   is blocked in the execute environment, the step is blocked: do not hand-write the file.
2. **RED tests** in `own_period_test.go`, loading the fixture through `newTestClientCF211`:
   - `@AC-1`: the `Q3-2026` period's `roe` equals 2,809,866,000 / 2,980,873,000 within 1e-9 and
     rounds to `0.942632`; its `extra_metrics.stockholders_equity` is 2,980,873,000. On the
     pre-Step-4 tree this fails with `3.6634`.
   - `@AC-3`: the `FY2025` period's `roe` equals 2,844,008,000 / 3,273,523,000 within 1e-9 and
     rounds to `0.868791`.
   - `@AC-5`: every period is stamped `DerivationVersion` 2, the value that makes the stored
     version-1 row re-derive (`marketdata_service.go:2398`).
   - If the fixture does not reproduce the two pinned values, stop and record it in context.md; do
     not adjust the expected values to fit (design.md § Open Risks, fails.md 2026-11-04).
3. **Synthetic tests** (inline builders, following `axpFacts`):
   - a 10-Q bucket with several `StockholdersEquity` instants (current quarter end, prior year end,
     roll-forward dates): the period-end one is selected;
   - an anchor miss: equity present only at a date other than the anchor gives nil ROE and nil D/E;
   - a flow whose only fact in the bucket is a prior-year comparative, in a bucket with an anchor:
     the flow is absent, not the comparative;
   - `Revenues` present only at the prior-year date with
     `RevenueFromContractWithCustomerExcludingAssessedTax` at the anchor: the anchor-dated value wins (D-22);
   - a later-dated `Liabilities` instant that shifts the anchor: equity, ROE and D/E are nil (D-22);
   - both revenue tags at the anchor: `Revenues` wins, and the result is the same across repeated
     runs (map iteration order).
4. **Golden.** Run the drift guard, then add entry `2:` to `derivationGolden` with the hash it
   prints. Keep entry `1`. The AXP fixture has no comparative instants, so the version-2 hash may
   equal the version-1 hash; record whatever the test prints.
5. **Existing tests.** Any existing edgar test that turns red is fixed in this unit, each with a
   line in context.md saying why the old expectation no longer holds. Do not weaken an assertion to
   get green; the PRESERVE rules in design.md § Business Rules Touched (`@AC-1 @feature-222`,
   `@AC-3 @feature-222`, `@AC-1 @feature-223`) must still hold on the AXP fixture.
6. Test data (C-13): the LYFT fixture has one consumer (`own_period_test.go`) and lives where the
   design pins it (D-21). The synthetic builders are single-consumer and stay inline.

**Verification** (union for the Steps 4+5 unit; run from the repo root):

```bash
ls services/xstockstrat-marketdata/internal/edgar/testdata/lyft_companyfacts.json
cd services/xstockstrat-marketdata && GOWORK=off go test ./internal/edgar/... -race -count=5   # count=5: selection must not depend on map order
cd services/xstockstrat-marketdata && export GOWORK=off && COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"   # confirm >= 40%
cd services/xstockstrat-marketdata && GOWORK=off golangci-lint run --modules-download-mode=mod
grep -n "const DerivationVersion = 2" services/xstockstrat-marketdata/internal/edgar/edgar_client.go
grep -n "^	2: " services/xstockstrat-marketdata/internal/edgar/derivation_version_test.go
grep -rn "lyft_companyfacts" services/xstockstrat-marketdata --include="*_test.go"   # one consumer (C-13)
```

---

### Step 6 — test: vendor unit guards and absent/negative ROE guards

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/finnhub/finnhub_client_test.go` — modify
- `services/xstockstrat-marketdata/internal/fmp/fmp_client_test.go` — modify
- `services/xstockstrat-marketdata/internal/edgar/own_period_test.go` — modify
- `services/xstockstrat-marketdata/internal/service/marketdata_service_test.go` — modify

**Reviewers**: xstockstrat-marketdata service owner — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence**:
- Finnhub: `f.ROE = scale100(m.ROETTM)` — `internal/finnhub/finnhub_client.go:260` (`scale100` at
  `:236`). Existing test: `TestGetFundamentals_MapsField`
  (`internal/finnhub/finnhub_client_test.go:82`, `roeTTM` 137.18 → 1.3718 at `:118`), harness
  `recordingRT` + `newTestClient` (`:59`), `TestGetFundamentalsMulti_ThreeCallsPerSymbol` (`:185`).
- FMP: `f.ROE = r.ReturnOnEquityTTM` — `internal/fmp/fmp_client.go:481`. Existing test:
  `TestGetFundamentals_MapsCoreAndExtended` (`internal/fmp/fmp_client_test.go:80`, pass-through 1.5
  at `:103`), `newTestClient(metrics, rt)` (`:60`), `TestGetFundamentalsMulti_OneQuoteCall` (`:155`).
- Absent ROE on the vendor clients is already guarded: `TestGetFundamentals_MissingFieldStaysNil`
  (`finnhub_client_test.go:139`, `fmp_client_test.go:121`).
- Wire edge: `Roe: derefOrZero(f.ROE)` — `internal/service/marketdata_service.go:2202`
  (`derefOrZero` at `:2158`); existing test `TestToProtoFundamentals_MissingMetrics`
  (`internal/service/marketdata_service_test.go:449`).
- EDGAR snapshot harness: `edgarSnapshotSvc` (`marketdata_service_test.go:2776`); the snapshot
  projects `ROE: p.ROE` (`marketdata_service.go:2070`); model test
  `TestGetFundamentals_EdgarSnapshotInheritsTTMROE_AC2_feature222` (`marketdata_service_test.go:3218`).
- Recon: no durable suite pins a vendor-path `roe` unit today (`recon.md:122`).

**TDD**: `N/A (characterization guards — the vendor conversion, the nil path and the sign are already correct on this tree; no production code changes, so there is no red)`

**Covers**: `AC-2, AC-4`

**Instructions**:

Vendor unit conversion stays in the vendor client (recon.md § Patterns to REUSE). No production file
is edited in this step.

1. `@AC-2`, Finnhub row: a table test where `/stock/metric` returns `roeTTM` 3.66. `GetFundamentals`
   maps `roe` to 0.0366 and `GetFundamentalsMulti` for the same symbol returns the same `roe`.
2. `@AC-2`, FMP row: a table test where `/stable/ratios-ttm` returns `returnOnEquityTTM` 0.0366.
   `GetFundamentals` maps `roe` to 0.0366 unscaled, and `GetFundamentalsMulti` returns the same `roe`.
3. `@AC-4`, negative row: in `own_period_test.go`, an annual EDGAR bucket with net income
   −191,750,000 and equity 767,000,000 on one date gives `roe` −0.25.
4. `@AC-4`, served value: a table test through `edgarSnapshotSvc` with a period whose `ROE` is nil
   (served `roe` 0, and `roe` listed in `missing_metrics`) and one whose `ROE` is −0.25 (served −0.25).
5. Because none of these can go red, prove each guard bites once by hand before committing: break
   the conversion locally (for example remove `scale100` on `:260`), see the new test fail, restore.
   Record the result in context.md; do not commit the mutation.
6. Test data (C-13): each new literal has one consumer and stays inline in its own package's test file.

**Verification** (run from the repo root):

```bash
cd services/xstockstrat-marketdata && GOWORK=off go test ./internal/finnhub/... ./internal/fmp/... ./internal/edgar/... ./internal/service/... -race -count=1
cd services/xstockstrat-marketdata && export GOWORK=off && COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"   # confirm >= 40%
cd services/xstockstrat-marketdata && GOWORK=off golangci-lint run --modules-download-mode=mod
git diff --stat HEAD -- services/xstockstrat-marketdata | grep -v "_test.go"   # only the summary line: no production file changed
```

---

### Step 7 — proto: unit comment on `roe = 8` and `roe = 13`

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/marketdata/v1/marketdata.proto` — modify

**Reviewers**: Proto Reviewer — field number uniqueness per message, no breaking changes without deprecation comment, `buf lint` and `buf breaking` pass; xstockstrat-marketdata service owner — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence**:
- `double roe = 8;` — `packages/proto/marketdata/v1/marketdata.proto:233`, in `message Fundamentals`
  (`:225`). `double roe = 13;` — `:283`, in `message HistoricalFundamentalsPeriod` (`:269`). Neither
  line has a comment.
- Comment style in the same messages: trailing `//` comments (`:242-243`, `:271-275`).
- `@AC-5 @FR-4 @regression @feature-196` (`docs/sdd/business-rules/platform.feature`): a proto edit
  of this kind must not change the schema (`recon.md:121`).

**Lands with**: `Step 8`

**TDD**: `N/A (proto)`

**Covers**: —

**Instructions**:

1. Add a comment to each of the two `roe` lines stating the unit: a fraction, net income divided by
   shareholders' equity (`0.25` = 25%), not percentage points. On `:283` add that a quarterly period
   is on a trailing-twelve-month basis.
2. Change nothing else: no field, number, type, name or order (C-09, D-5).

**Verification** (run from the repo root; `GIT_COMMON` resolves to the `.git` directory of the main
checkout, also from a worktree, and `subdir=` is mandatory, PLAT-10):

```bash
GIT_COMMON=$(git rev-parse --path-format=absolute --git-common-dir)
(cd packages/proto && buf lint && buf breaking --against "${GIT_COMMON}#branch=feature/fix-fundamentals-roe-unit,subdir=packages/proto")
git diff -U0 -- packages/proto/marketdata/v1/marketdata.proto | grep '^[+-]' | grep -v '^+++\|^---'   # exactly the two roe lines, comment text only
```

---

### Step 8 — proto-gen: regenerate stubs

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/go/` — modify (generated)
- `packages/proto/gen/python/` — modify (generated)
- `packages/proto/gen/ts/` — modify (generated)

These are directories, not exact paths: the file list is whatever `scripts/buf-gen.sh` rewrites for
`marketdata/v1/marketdata.proto`. The executor does not choose or hand-edit any file under them, and
the Verification below checks that only marketdata stubs changed.

**Reviewers**: Proto Reviewer — field number uniqueness per message, no breaking changes without deprecation comment, `buf lint` and `buf breaking` pass; xstockstrat-marketdata service owner — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence**:
- `scripts/buf-gen.sh` exists; the CI `proto-freshness` job diffs `packages/proto/gen/` (root
  `CLAUDE.md` § Proto Contract Governance).
- No field is added, so no descriptor-parity guard or hand-mapped field list (`_MAPPED`,
  `*_covers_every_proto_field`) is affected.

**Lands with**: `Step 7`

**TDD**: `N/A (proto-gen)`

**Covers**: —

**Instructions**:

1. Run `./scripts/buf-gen.sh` from the repo root and commit whatever it changes under
   `packages/proto/gen/`. Do not edit generated files by hand. If the toolchain is unavailable on
   the host, follow `docs/runbooks/codegen-toolchain-host-setup.md`.

**Verification** (union for the Steps 7+8 unit):

```bash
./scripts/buf-gen.sh && git status --porcelain packages/proto/gen/   # only marketdata stubs listed
git diff -- packages/proto/gen/ | grep '^[+-]' | grep -v '^+++\|^---' # comment lines only
./scripts/buf-gen.sh && git status --porcelain packages/proto/gen/   # second run: the same list, no further change
cd services/xstockstrat-marketdata && GOWORK=off go build ./...
```

---

### Step 9 — docs: fundamentals doc and residuals

**Status**: `pending`
**Service**: `xstockstrat-marketdata` (docs)
**Files**:
- `services/xstockstrat-marketdata/docs/fundamentals.md` — modify
- `services/xstockstrat-marketdata/docs/context-constitution-findings.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `docs/fundamentals.md:74-79` "Derivation versioning (feature 223)"; `:81-86` "EDGAR period ratio
  bases (features 211/222)", which says quarterly ROE divides by "period-end equity".
- `docs/context-constitution-findings.md`: `## Latent bugs` table at `:20-28`, columns
  Issue / Impact / Evidence.
- Residual sites: `shares` first-seen (`internal/edgar/edgar_client.go:199-200`, `:357-364` before
  Step 4); cover-page `period_end` (`:350-352`); `mergePrice` never goes value → nil
  (`internal/service/marketdata_service.go:2418-2419`).

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:

1. `fundamentals.md`: in the ratio-bases paragraph, state how a period's facts are selected since
   version 2: one balance-sheet anchor date per filing bucket; instants and flows are taken at that
   date; no match means the value is absent, never a comparative. In the derivation-versioning
   paragraph, add that a re-derive replaces the builder-owned `extra_metrics` keys
   (`source.DerivationOwnedExtraKeys`) instead of merging them. State the rules; leave the history
   to the PR description.
2. `context-constitution-findings.md`, `## Latent bugs`: add three rows (D-9, D-31, R-9):
   - `shares` is still first-seen per (metric, unit), so a share count can come from a comparative column;
   - the stored `period_end` can be a cover-page date, not the quarter end;
   - `pe_ratio` and `pb_ratio` stay stale on a row whose `eps` or equity went nil at re-derive,
     because the price-join merge never writes nil.

**Verification**:

```bash
grep -n "DerivationOwnedExtraKeys\|anchor" services/xstockstrat-marketdata/docs/fundamentals.md
grep -n "shares\|period_end\|pb_ratio" services/xstockstrat-marketdata/docs/context-constitution-findings.md
```

Then re-read both edits against `edgar_client.go` and `marketdata_repo.go` as they stand after Step 5.

---

### Step 10 — docs: operator gate before the `main-dev` merge (dry run, freeze, pre-export)

**Status**: `pending`
**Service**: staging operations (homelab staging and DO staging); recorded in `docs/roadmap/features/340-fix-fundamentals-roe-unit/context.md`
**Files**:
- `docs/roadmap/features/340-fix-fundamentals-roe-unit/context.md` — modify (append)

**Reviewers**: none

**Codebase Evidence**:
- The freeze key: `BackfillFundamentals` returns `FailedPrecondition` when
  `fundamentals.history.enabled` is false (`internal/service/marketdata_service.go:2269-2270`),
  before the re-derive (`:2398-2407`). The table's writers are `InsertHistoricalFundamentals`
  (`internal/repository/marketdata_repo.go:719`), `UpdateHistoricalPriceJoin` (`:772`) and
  `RederiveHistoricalFundamentals` (`:786`).
- MCP tools: `get_config` (`services/xstockstrat-agent/app/tools.py:1821`), `set_config` (`:1885`).
- Read paths: lane A is the operator's own ssh session on the DB host; lane B follows
  `docs/runbooks/operator-db-access.md:36-49`. DO staging database `xstockstrat-staging`
  (`.do/app.dev.yaml:699`).
- Both staging environments deploy on a push to `main-dev` (`.github/workflows/deploy-dev.yml`).
- The queries (Q-pre, both Q-export forms, Q-ttm) and the command templates are in design.md
  § Step 5; they are not copied here.

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:

This step is run with the operator. The executor does not run SQL: on lane A the operator runs it
personally over ssh ("I plan to do psql over ssh if possible."). No homelab-edge change is made.

1. Before anything else, get the two open answers recorded in context.md: the O-16 blast-radius
   acceptance, and what "max_connections are now love." refers to. Do not proceed on a guess.
2. Coordinate the freeze window with peer feature 343 (`backtest-inline-backfill`): the freeze
   blocks every staging fundamentals backfill in both environments.
3. Dry run (design.md § Step 5, item 0): the operator runs Q-pre, both Q-export forms and Q-ttm once
   on lane A, read-only. A syntax or label-format error is fixed in design.md's text first, with a
   context.md line, and re-run.
4. Record the value `marketdata.fundamentals.history.enabled` holds in each staging environment
   (`get_config` on `xstockstrat_homelab_staging` and `xstockstrat_staging`).
5. Freeze: `set_config` the key to `false` on both staging MCPs, confirm with `get_config`, and log
   each flip in context.md with time, lane and reason. Operator consent: "Ok, agreed."
6. Pre-export per lane (item 1): Q-pre and the full Q-export. Completeness gate: the export's row
   count per symbol equals Q-pre's `n`. Raw exports stay on the operator's machine (R-16).

**Verification**:

```bash
grep -n "O-16\|max_connections\|pre-export\|fundamentals.history.enabled" docs/roadmap/features/340-fix-fundamentals-roe-unit/context.md
```

The context.md entries must show, for each lane: the dry-run result (lane A), the recorded pre-freeze
value, the flip to `false` with its `get_config` confirmation, and the pre-export row counts matching
Q-pre. The integration PR is not opened for merge until all four are present for both lanes and the
two operator answers of item 1 (O-16, `max_connections`) are recorded.

---

## Post-Deploy Procedure (after the integration PR merges; not an `/sdd-execute` step)

The repair and audit run on staging only, lane A (homelab staging) first and lane B (DO staging)
only after lane A ends with no escalation. There is no production lane ("There are no production
instances. Staging is enough.").

The procedure is design.md § Step 5, items 2 to 7, and is followed from there: lane start, the
LYFT / AXP / AAPL canary, the 10-symbol ramp and chunks of at most 50, audit rules (a) to (d), the
closing TTM check and the finish gate. Checks tied to this feature's scenarios:

- `@AC-1` / `@AC-5` on real data: `query_fundamentals` for LYFT returns Q3-2026 `roe` 0.942632.
- `@AC-3` on real data: LYFT FY2025 `roe` 0.868791.
- PRESERVE `@AC-1 @feature-223`: AXP D/E about 1.73.

Outputs: one audit report per lane, committed to this feature directory through a docs-only PR
(`audit-lane-a.md`, `audit-lane-b.md`; file names chosen by this spec, the design names none). Raw
exports are never committed (R-16). Each lane ends with the key set back to `false`, then restored
to the value recorded in Step 10 once the operator accepts that lane's report.

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._

### Steps 2+3 — Verification block run line by line from the repo root
- **Spec said**: the five Verification command lines, each "run from the repo root".
- **Actual**: run as one shell (`.sdd-logs/run-3.sh`), line 1 passed and its `cd services/xstockstrat-marketdata` carried over, so lines 2 to 5 failed with `cd: services/xstockstrat-marketdata: No such file or directory` before running anything. Each remaining line was then run verbatim, unchanged, as its own run from the repo root (`v-4` coverage, `v-5` lint, `v-6` the two greps); all exited 0.
- **Disposition**: CI-equivalent execution of the unchanged commands; no command text altered. Steps 5 and 6 carry the same multi-`cd` block shape.
- **SEV**: SEV-3

### Steps 4+5 — Verification block run line by line from the repo root
- **Spec said**: the seven Verification command lines of Step 5, each "run from the repo root".
- **Actual**: run as one shell (`.sdd-logs/run-3.sh`, `exit=2`), lines 1 and 2 passed (`ls` printed the fixture path; `ok .../internal/edgar` with `-race -count=5`). Line 2's `cd services/xstockstrat-marketdata` carried over, so lines 3 to 7 failed with `cd: services/xstockstrat-marketdata: No such file or directory` or `grep: ... No such file or directory`. Lines 3 to 7 were then run verbatim, unchanged, from the repo root (`v-4` coverage, `v-5` lint, `v-6` the three greps); all exited 0. The lint run put `/root/go/bin` first on `PATH` so the pinned golangci-lint v2.14.0 ran, not the host's 2.5.0 (Steps 2+3 tooling note).
- **Disposition**: CI-equivalent execution of the unchanged commands; no command text altered.
- **SEV**: SEV-3

### Step 6 — Verification block run line by line from the repo root
- **Spec said**: the four Verification command lines, each "run from the repo root".
- **Actual**: run as one shell (`.sdd-logs/run-6.sh`, `exit=1`): line 1 passed (`ok` for `internal/finnhub`, `internal/fmp`, `internal/edgar`, `internal/service`). Its `cd services/xstockstrat-marketdata` carried over, so lines 2 and 3 failed with `cd: services/xstockstrat-marketdata: No such file or directory`, and line 4 ran from the service directory and matched nothing. Lines 2 to 4 were then run verbatim, unchanged, from the repo root (`v-7` coverage, `v-8` lint with `/root/go/bin` first on `PATH` for the pinned v2.14.0, `v-9` the diff stat); all exited 0.
- **Disposition**: CI-equivalent execution of the unchanged commands; no command text altered.
- **SEV**: SEV-3

### Step 6 — @AC-4 served-value guard gives the period a D/E value
- **Spec said**: Instruction 4, a period whose `ROE` is nil served through `edgarSnapshotSvc`.
- **Actual**: a period with only a nil `ROE` and no other core metric fails `hasCoreMetrics` (`internal/service/marketdata_service.go:1971`), so the snapshot is not producible and `GetFundamentals` returned `not_found: LYFT: no edgar snapshot and vendor fallback disabled` (`.sdd-logs/v-1.log`). Both table rows now also carry `DebtToEquity` 1.2, which keeps the period producible. The test still asserts served `roe` 0 with `roe` in `missing_metrics`, and served −0.25. Test-only; no production code changed.
- **Disposition**: in-scope test fixture correction.
- **SEV**: SEV-3

### Steps 7+8 — Verification run inside the pinned codegen image, with a temporary local baseline ref
- **Spec said**: the Step 7 and Step 8 Verification blocks, run from the repo root on the host, with the toolchain from `docs/runbooks/codegen-toolchain-host-setup.md` if the host lacks it.
- **Actual**: the host has no `buf` and no `grpcio-tools`, and this worktree has no `packages/proto/gen/ts/node_modules` (the `tsc` step of `buf-gen.sh` needs it, and Node installs are forbidden in the batch worktree). Both blocks ran unchanged inside the pinned `xstockstrat-codegen` image (`Dockerfile.codegen`: buf 1.72.0, the CI-pinned Go plugins, grpcio-tools 1.80.0, Node 24.20.0, go1.27.4), with the worktree and the main checkout's `.git` mounted at their own paths, the main checkout's `node_modules` and `packages/proto/gen/ts/node_modules` mounted read-only, and the host Go module cache mounted. `buf breaking --against "${GIT_COMMON}#branch=feature/fix-fundamentals-roe-unit,..."` needs a local branch; `refs/heads/feature/fix-fundamentals-roe-unit` was created at `origin/feature/fix-fundamentals-roe-unit` (`423b85fc5`, the pre-unit tip), used for the run and deleted afterwards. Each block ends with a trailing `#` comment, so the wrapper's closing `)` went on its own line. Results: Step 7 `.sdd-logs/v-1.log` `exit=0` (lint and breaking silent; the diff shows exactly the two `roe` lines); Step 8 `.sdd-logs/v-2.log` `exit=0`. A pre-edit `buf-gen.sh` run in the same image left `packages/proto/gen/` clean, so the committed stubs were fresh before the edit.
- **Disposition**: CI-equivalent fallback; no command text altered.
- **SEV**: SEV-3

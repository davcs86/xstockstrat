# Implementation Spec: unified-symbol-page

**Status**: `pending`
**Created**: 2026-08-10
**Last Updated**: 2026-08-15 (FR-6 indicator-overlay-panel steps 27-33 added — see design.md
§ "Design Addendum — FR-6 Indicator Overlay Panels")
**Feature**: `docs/roadmap/features/125-unified-symbol-page/feature.md`
**Total Steps**: 33
**Feature Branch**: `feature/unified-symbol-page`

---

## Execution Summary

The additive `ScreenResult` proto change (Steps 1-2) and the pre-existing `GetPosition`
`account_id` bug fix (Steps 5-6) are backend prerequisites and run first. Steps 8-9 restructure
`/trader/positions/[symbol]/page.tsx` so its sections gate independently of position existence and
mount the reused Trade widget — this is the load-bearing structural change every later UI section
depends on. Steps 10-11 fix `SignalReadiness`'s NotFound handling (a shared component) before it is
re-mounted on the new page. Steps 12-21 add the six watchlist-conditional/always-on sections
(Opportunity/Readiness gating, Fundamentals, Screening, Backtests, Backfill), each paired with its
own e2e coverage per the repo's established one-file-per-concern convention. Steps 22-23 retire the
two superseded source pages and repoint the shared nav. Steps 24-26 close the cross-cutting proofs
design.md's Open Risks named explicitly: two-surface nav reachability, the relocated/rewritten
`signal-detail.spec.ts`, and three-way valuation parity.

**FR-6 indicator overlay panels (Steps 27-33, added 2026-08-15 — design.md § "Design Addendum —
FR-6").** An independent additive block layered on top of the core sections. Steps 27-28 add the new
additive `AnalysisService.GetIndicatorSeries` RPC (+ 4 messages + `wrappers.proto` import) and
regenerate stubs — a hard predecessor to both the analysis handler and the UI panels, same governance
shape as the `ScreenResult` change in Steps 1-2. Step 29 registers the new
`analysis.series.max_concurrent_components` config key (C-05). Steps 30-31 add the new handler (whose
own loop reuses `StrategyEvaluator._compute_component`, structurally isolated from launched feature
097's shared `evaluate_conditions_traced`) and its paired Python tests. Steps 32-33 add the stacked
`recharts` overlay panels to the unified page and their e2e coverage. This block slots into the page
structure Steps 8/12 create but is **not** a predecessor of the Step 22 redirect — the panels are a
new section that never existed on the deleted `insights/market/[symbol]` page, so retiring that page
does not wait on FR-6.

## Step Dependencies

- Step 2 requires Step 1: `buf-gen.sh` regenerates stubs from the new proto fields.
- Step 3 requires Step 2: `screener.py` cannot reference `criterion_raw_values`/`criterion_passed`
  before the Python stubs exist (C-09/F-04 — `/sdd-spec` must not cite generated symbols before
  regeneration lands, and neither may Step 3's implementation).
- Step 4 requires Step 3 (test-pairing, C-08).
- Step 6 requires Step 5 (test-pairing, C-08).
- Step 9 requires Step 8 (test-pairing, C-08; the e2e assertions target Step 8's new structure).
- Step 11 requires Step 10 (test-pairing, C-08).
- Step 12 requires Step 8: the watchlist-gated split slots into the page structure Step 8 creates.
- Step 12 requires Step 10: the Readiness section it mounts is the NotFound-fixed component.
- Step 13 requires Step 12 (test-pairing, C-08).
- Step 14 requires Step 8 (same page structure); Step 15 requires Step 14 (test-pairing, C-08).
- Step 16 requires Steps 3-4: the single-symbol screening UI reads `criterion_raw_values`/
  `criterion_passed`, which do not exist on the generated TS types until Step 2 lands and Step 3
  populates them. Step 17 requires Step 16 (test-pairing, C-08).
- Step 18 requires Step 8 (`owningStrategy` local it reads is computed there, unchanged from 096).
  Step 19 requires Step 18 (test-pairing, C-08).
- Step 20 requires Step 8; Step 21 requires Step 20 (test-pairing, C-08).
- Step 22 requires Steps 8, 12, 14, 16, 18, 20: the redirect target must already render every
  section before the old page that showed a subset of them is deleted.
- Step 23 can run any time after Step 22 (it depends on `/insights/market` becoming redirect-only,
  not on any specific section).
- Step 24 requires Step 23 (asserts the nav surfaces Step 23 changed).
- Step 25 requires Step 22 (asserts against the page Step 22 made the sole live route).
- Step 26 requires Step 8 (the three-way parity read path Step 8's structure exposes).
- Step 7 (docs) has no code dependency but must land no later than Step 12, the first step whose
  code relies on the cross-segment-client-reuse exception it documents (Open Risk, design.md).
- Step 28 requires Step 27: `buf-gen.sh` regenerates stubs from the new `GetIndicatorSeries` RPC +
  messages. (Independent of the Steps 1-2 `ScreenResult` proto change — the two additive proto
  changes touch different messages and may land in either order, but each `proto` step must be
  followed by its own regeneration before any code cites its generated symbols, C-09/F-04.)
- Step 30 requires Step 28: the analysis handler references `analysis_pb2.GetIndicatorSeriesResponse`/
  `ComponentSeries`/`NamedSeries` and `google.protobuf.wrappers` — none exist on the Python stubs
  until Step 28 regenerates them (C-09/F-04 — neither `/sdd-spec` nor Step 30's implementation may
  cite the generated symbols before regeneration lands).
- Step 29 (config docs) has no code dependency but must land no later than Step 30, whose handler
  reads `analysis.series.max_concurrent_components` — the key's CLAUDE.md row + registered-keys entry
  (C-05) must ship in the same PR as the code that reads it.
- Step 31 requires Step 30 (test-pairing, C-08).
- Step 32 requires Step 28 (generated **TS** stubs for `GetIndicatorSeries`), Step 30 (the RPC
  handler must exist to serve the browser call), Step 8 (it reads the candlestick bars Step 8 hoists
  to the page's top level and adds new state to retain their closes+times), and Step 12 (the strategy
  whose components are charted is the FR-6-resolved strategy — the watchlist-binding `strategyId`
  Step 12 derives, else the picker selection). Like Step 12, it relies on Step 7's cross-segment
  `analysisClient` sanctioned exception, so Step 7 must also precede it.
- Step 33 requires Step 32 (test-pairing, C-08).
- Step 22 is **not** a dependent of Step 32: the indicator overlay panels are a new section absent
  from the deleted `insights/market/[symbol]` page, so the redirect does not need them to render
  first.

---

### Step 1 — proto: additive `ScreenResult` fields for single-symbol screening

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/analysis/v1/analysis.proto` — modify

**Reviewers**: Proto Reviewer — field number uniqueness, backward compatibility, `buf lint`/`buf breaking` pass; `xstockstrat-analysis` (service owner) — confirms the additive fields match what `screener.py` will populate; `xstockstrat-ui` (consumer) — confirms the field shapes serve the single-symbol screening UI

**Codebase Evidence**:
- Confirmed via `grep -n "message ScreenResult" -A 17 packages/proto/analysis/v1/analysis.proto` →
  `ScreenResult` spans lines 369-385; the highest existing field number is `held = 11` (line 384), so
  `12`/`13` are the next free numbers.
- design.md § FR-8 Screening: "two additive `ScreenResult` proto fields —
  `map<string, double> criterion_raw_values = 12` and `map<string, bool> criterion_passed = 13`" —
  the Chosen Approach, replacing round 1's rejected (factually-wrong) `gap`/`criterion_scores` reuse.
- Confirmed the fields these expose are real and already computed but unexposed:
  `services/xstockstrat-analysis/app/services/screener.py:188-189` (`row["raws"]`/`row["passes"]`
  dict init), populated at `:255-256`.

**TDD**: `N/A (proto)` — no code executes; verified by `buf lint`/`buf breaking`.

**Instructions**:
In `packages/proto/analysis/v1/analysis.proto`, inside `message ScreenResult` (currently lines
369-385), add two fields after `bool held = 11;` (line 384), before the closing `}`:

```protobuf
  // Per-criterion raw readings + pass/fail, for single-symbol screening where the universe-relative
  // `score`/`criterion_scores` collapse to a content-free 0.5 (feature 125, FR-8). Populated from the
  // same engine-internal values `criterion_scores` already draws from, exposed directly instead of
  // normalized.
  map<string, double> criterion_raw_values = 12;
  map<string, bool> criterion_passed = 13;
```

Do not touch any other message in this file — this is the sole proto change for the feature.

**Verification**:
```bash
cd packages/proto && buf lint
buf breaking --against ".git#branch=main-dev"
```
Both must pass (additive-only change — no breaking diff expected).

---

### Step 2 — proto-gen: regenerate stubs

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/go/analysis/v1/` — modify (generated)
- `packages/proto/gen/python/analysis/v1/` — modify (generated)
- `packages/proto/gen/ts/analysis/v1/` — modify (generated)

**Reviewers**: Proto Reviewer — inherited from Step 1

**Codebase Evidence**:
- root `CLAUDE.md` § Generating Proto Stubs: `./scripts/buf-gen.sh` regenerates all three languages.

**TDD**: `N/A (proto-gen)`

**Instructions**:
Run `./scripts/buf-gen.sh` from repo root. Commit the proto source change (Step 1) and the
regenerated stub diff together in this step's commit, per the codegen-toolchain host-setup runbook
if Docker/GitHub-releases egress is unavailable in the execution environment
(`docs/runbooks/codegen-toolchain-host-setup.md`).

**Verification**:
```bash
./scripts/buf-gen.sh
git diff --stat packages/proto/gen/
```
Confirm the diff touches only `analysis/v1/` generated files (new `criterionRawValues`/
`criterionPassed` fields on the TS/Go/Python `ScreenResult` types) and nothing else. Re-run
`./scripts/buf-gen.sh` a second time and confirm `git diff packages/proto/gen/` is empty (idempotent
regeneration, per the proto-versioning runbook's "Verifying the generated stubs match the protos").

---

### Step 3 — service (xstockstrat-analysis): wire `criterion_raw_values`/`criterion_passed`

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/services/screener.py` — modify

**Reviewers**: `xstockstrat-analysis` (service owner) — backtest reproducibility / strategy scoring
determinism criteria; confirms the new maps are built from the same per-symbol `raws`/`passes`
dicts every other field in this method already reads, with no new computation

**Codebase Evidence**:
- Confirmed via `grep -n "_build_result" services/xstockstrat-analysis/app/services/screener.py` →
  method spans lines 418-475; the `ScreenResult(...)` construction is at lines 464-475.
- `row["raws"]` and `row["passes"]` are dicts keyed by `c.ref_name`, already populated at
  `screener.py:255-256` for every criterion this symbol was actually evaluated against (absent for
  a criterion that was skipped — same "only present for evaluated criteria" contract
  `criterion_scores` (line 3 of the proto) already documents).
- `_build_result`'s existing loop (lines 435-449) already iterates `criteria` and checks
  `c.ref_name not in row["raws"]` to decide skip-vs-evaluate — the same guard the new maps must use.

**TDD**: `red-green required`

**Instructions**:
In `_build_result` (`screener.py:418-475`), inside the `for c in criteria:` loop (lines 435-449),
accumulate the raw value and pass/fail alongside the existing `criterion_scores[c.ref_name] = sub`
assignment (line 444) — only for criteria actually present in `row["raws"]` (mirroring the existing
skip guard at line 436):

```python
criterion_raw_values = {}
criterion_passed = {}
...
for c in criteria:
    if c.ref_name not in row["raws"]:
        ...
        continue
    sub = norm.get(c.ref_name, {}).get(row["symbol"], 0.5)
    criterion_scores[c.ref_name] = sub
    criterion_raw_values[c.ref_name] = row["raws"][c.ref_name]
    criterion_passed[c.ref_name] = row["passes"].get(c.ref_name, False)
    ...
```

Pass both new dicts into the `analysis_pb2.ScreenResult(...)` constructor at lines 464-475, alongside
the existing `criterion_scores=criterion_scores`:

```python
return analysis_pb2.ScreenResult(
    symbol=row["symbol"],
    score=score,
    criterion_scores=criterion_scores,
    criterion_raw_values=criterion_raw_values,
    criterion_passed=criterion_passed,
    passed=passed,
    ...
)
```

The `INSUFFICIENT_DATA` early-return branch (lines 419-427) is unchanged — it never reaches the
per-criterion loop, so the new maps stay empty (proto3 map default) for that status, matching
`criterion_scores`'s existing behavior for the same branch.

**Verification**:
```bash
cd services/xstockstrat-analysis && ruff check . && ruff format --check .
uv run pytest tests/test_screener.py -k criterion_raw -v
```
Write the test first (Step 4) so it fails against the pre-Step-3 tree (`criterion_raw_values`/
`criterion_passed` absent from the returned `ScreenResult`), then confirm it passes after this step.

---

### Step 4 — test (xstockstrat-analysis): single-symbol raw/passed fields

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_screener.py` — modify

**Reviewers**: `xstockstrat-analysis` (service owner)

**Codebase Evidence**:
- `services/xstockstrat-analysis/tests/test_screener.py` is the existing test module for
  `ScreenerEngine`/`_build_result` (confirmed present — this is the paired-test home for the class
  under change; no new test file needed, C-13 single-consumer-stays-inline does not apply here since
  this is real engine logic, not fixture data).

**TDD**: `red-green required` (paired with Step 3; write and run this test against the
pre-Step-3 tree first — it must fail — before Step 3's implementation lands, per P-06).

**Instructions**:
Add a test that runs `ScreenerEngine.screen` (or calls `_build_result` directly, matching this test
module's existing call pattern) with a **single-symbol** universe and one criterion whose raw value
is known, asserting on the returned `ScreenResult`:
- `criterion_raw_values[ref_name]` equals the criterion's actual raw reading (not the
  universe-collapsed `0.5` that `criterion_scores[ref_name]` legitimately shows for a one-symbol
  scan — assert both fields on the same result to make the contrast explicit, since that contrast is
  the entire reason this feature adds the new fields, per the recon.md "confirmed live trap" finding
  and `fails.md` 2026-08-08 `screener-data-readiness-polling`).
- `criterion_passed[ref_name]` equals the boolean the criterion's comparator actually evaluates to
  for that raw value (test both a passing and a failing case, or two criteria — one of each).
- A criterion that was skipped (unavailable raw value for that symbol) is absent from both new maps,
  mirroring `criterion_scores`'s existing skip contract.

**Verification**:
```bash
cd services/xstockstrat-analysis && uv run pytest tests/test_screener.py --cov=app --cov-fail-under=40
```
Run once against the pre-Step-3 tree (confirm the new test fails — the fields don't exist / are
empty), then again after Step 3 (confirm it passes) — captured in the TDD gate per
`.claude/skills/sdd-execute/reference/tdd-gate.md`.

---

### Step 5 — service (xstockstrat-portfolio): fix `GetPosition` `account_id` passthrough

**Status**: `done`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/repository/portfolio_repo.go` — modify
- `services/xstockstrat-portfolio/internal/service/portfolio_service.go` — modify

**Reviewers**: `xstockstrat-portfolio` (service owner) — P&L calculation accuracy, position snapshot
consistency

**Codebase Evidence**:
- Confirmed via `grep -n "func.*GetPosition" -A 8 internal/service/portfolio_service.go` →
  `PortfolioService.GetPosition` (lines 462-469) calls
  `s.repo.GetPosition(ctx, req.UserId, req.Symbol, req.TradingMode)` — no `account_id` argument.
- Contrast confirmed via the same grep for `ListPositions` (lines 472-493): its call at line 481
  **does** pass `req.GetAccountId()` as the 5th positional arg.
- Confirmed via `grep -n "func.*GetPosition" -A 8 internal/repository/portfolio_repo.go` →
  `PortfolioRepo.GetPosition` (lines 61-69) has signature
  `(ctx, userID, symbol string, mode commonv1.TradingMode)` — no `accountID` parameter, and its SQL
  (lines 62-66) has no `account_id` predicate; `ORDER BY opened_at DESC LIMIT 1` (line 66) means a
  multi-account user's request silently returns whichever account's position opened most recently.
- `PortfolioRepo.ListPositions`'s conditional-predicate builder pattern to mirror is at
  `portfolio_repo.go:90-92`: `if accountID != "" { add("account_id = $%d", accountID) }` using the
  `add()` closure defined at lines 83-86.
- `GetPositionRequest.account_id` (proto field 4, `optional string`) already exists on the wire —
  confirmed via `grep -n "message GetPositionRequest" -A 5 packages/proto/portfolio/v1/portfolio.proto`
  → `optional string account_id = 4;` at line 130. No proto change needed; the field already exists
  and is already forwarded end-to-end by the BFF (`traderBff.ts:92-100`'s `getPosition` handler
  spreads `...req` before injecting `userId`, so a caller-supplied `accountId` already reaches this
  RPC — only the service/repo layer drops it).
- `classifyGetPositionError` (`internal/handler/portfolio_handler.go:335-340`) maps
  `repository.ErrPositionNotFound` → `connect.CodeNotFound`; this classification is unaffected by
  this fix (a real not-found stays not-found; this fix only changes *which* row is returned when
  multiple accounts hold the same symbol).

**TDD**: `red-green required`

**Instructions**:
1. In `portfolio_repo.go`, change `GetPosition`'s signature (line 61) to accept an `accountID string`
   parameter, and add a conditional predicate to its query (lines 62-66) using the same pattern
   `ListPositions` already establishes at lines 77-92 (build `conds`/`args` dynamically, or — since
   `GetPosition` is a single hand-written query, not the dynamic builder `ListPositions` uses —
   append `AND account_id=$4` to the `WHERE` clause only when `accountID != ""`, passing it as the
   4th query arg). Keep the existing `ORDER BY opened_at DESC LIMIT 1` as the tie-breaker for the
   (now narrower) remaining candidate set — it still matters when the same account somehow holds two
   rows for one symbol+mode (e.g. a stale unclosed row), just no longer *needs* to disambiguate
   across accounts once the predicate does that.
2. In `portfolio_service.go`, update `GetPosition`'s call (line 463) to pass `req.GetAccountId()` as
   the new argument, mirroring `ListPositions`'s existing `req.GetAccountId()` call at line 481.
3. No handler-layer change is needed — `portfolio_handler.go:45-54`'s `GetPosition` already passes
   the full `req.Msg` through to the service unchanged.

**Verification**:
```bash
cd services/xstockstrat-portfolio && GOWORK=off golangci-lint run --modules-download-mode=mod
```
Plus the coverage command in Step 6's Verification (this step's own behavioral proof is the paired
test).

---

### Step 6 — test (xstockstrat-portfolio): multi-account `GetPosition` regression

**Status**: `done`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/repository/portfolio_repo_test.go` — modify (or create if
  absent — confirm via `ls services/xstockstrat-portfolio/internal/repository/*_test.go` at execute
  time; recon did not enumerate this file, so treat its existence as unconfirmed until checked)

**Reviewers**: `xstockstrat-portfolio` (service owner)

**Codebase Evidence**:
- design.md § FR-14: "**Paired regression test (C-08)**: a Go test seeding two positions for the
  same `user_id+symbol+trading_mode` but different `account_id`s, asserting `GetPosition` returns
  the one matching the requested account, not merely the most-recently-opened row."

**TDD**: `red-green required` (paired with Step 5; run first against the pre-Step-5 tree to confirm
it fails — the old query ignores `account_id` and returns the wrong row's data — before Step 5
lands).

**Instructions**:
Seed two `portfolio.positions` rows for the same `(user_id, symbol, trading_mode)` but two different
`account_id` values (distinguishable by a field the test can assert on, e.g. differing
`current_price` or `qty`), with the account requested being the one opened **less** recently (so a
correct fix and the pre-fix `ORDER BY opened_at DESC LIMIT 1` bug produce visibly different results —
a test where the requested account happens to also be the most-recent row would pass on the buggy
code too, and would not actually prove the fix per the repo's "run every field-name test against a
real fixture, not a `MagicMock`" family of lessons, `insights.md` 2026-08-06). Call
`GetPosition(ctx, userID, symbol, mode, accountID)` (Step 5's new signature) requesting the
older-but-target account explicitly, and assert the returned row's distinguishing field matches that
account's, not the other one's.

**Verification**:
```bash
cd services/xstockstrat-portfolio && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"
```
Note: `internal/repository` is in the CI coverage-exclusion list (`COVERPKGS` grep pattern above), so
this test's coverage does not count toward the 40% threshold — per `spec-template.md`'s guidance,
state that explicitly: "new logic is in an excluded package — no coverage threshold applies; the
regression test itself is the verification." Confirm ≥40% overall is still met (unaffected by this
package's exclusion) and confirm the new test passes:
```bash
go test ./internal/repository/... -race -run TestGetPosition -v
```

---

### Step 7 — docs: cross-segment client-reuse sanctioned exception + `nextjs-frontends.md` correction

**Status**: `done`
**Service**: `xstockstrat-ui` / `docs/patterns`
**Files**:
- `services/xstockstrat-ui/CLAUDE.md` — modify
- `docs/patterns/nextjs-frontends.md` — modify

**Reviewers**: `xstockstrat-ui` (service owner)

**Codebase Evidence**:
- Insertion point confirmed via `grep -n "Sanctioned exception\|## Docker Build Pattern"
  services/xstockstrat-ui/CLAUDE.md` → the existing `ChartPanel.tsx`/`lightweight-charts` sanctioned
  exception bullet is at line 59, `## Docker Build Pattern` at line 68 — matches design.md's cited
  insertion point exactly (after the ChartPanel bullet, before Docker Build Pattern).
- design.md § BFF wiring gives the verbatim amendment text (below) — approved through 7 rounds of
  design debate; insert it unchanged.
- `docs/patterns/nextjs-frontends.md` §10 confirmed stale at two points, both by direct read:
  (1) line 282 "Each frontend has two BFF files:" — the consolidated `xstockstrat-ui` has **three**
  segment BFF files (`traderBff.ts`, `insightsBff.ts`, `configUiBff.ts`), not two, and none of them
  live at the `lib/connectBff.ts` path the doc names (the real files are
  `src/lib/{traderBff,insightsBff,configUiBff}.ts` + `src/lib/bffShared.ts` for shared plumbing).
  (2) Lines 291-298's "#1 BFF footgun" advice ("Next.js strips the configured `basePath` from
  `req.url`... Key the map on `'/api'` only") describes the **pre-045** three-separate-Next.js-apps
  architecture and is now actively wrong: `services/xstockstrat-ui/src/lib/bffShared.ts:105-119`'s
  `createDispatch(router, prefix)` builds its handler map as `prefix + h.requestPath` where `prefix`
  is the **full segment path** (e.g. `/trader/api`, confirmed at `traderBff.ts:169`'s
  `createDispatch(router, '/trader/api')` call) — the opposite of "key the map on `/api` only" — and
  the doc's own comment at `bffShared.ts:106-108` states why: "in the consolidated app Next.js does
  NOT strip a basePath, so the handler-map key must include it." The doc's "nginx forwards it intact"
  claim (line 298) is also stale — nginx was removed by feature 045 (already recorded,
  `fails.md` 2026-08-05 `ui-consolidation-nextjs`, still unfixed as of this feature per design.md's
  Open Risks — this step closes that specific gap, not the rest of the document's broader staleness,
  which is out of scope here).

**TDD**: `N/A (docs)`

**Instructions**:
1. In `services/xstockstrat-ui/CLAUDE.md`, insert this new bullet immediately after line 66 (the end
   of the existing `ChartPanel.tsx` sanctioned-exception bullet), before the blank line and
   `## Docker Build Pattern` at line 68 — verbatim, per design.md's approved text:

   ```markdown
   - **Sanctioned exception — the unified `/trader/positions/[symbol]` page reuses `/insights`-segment
     browser clients.** `analysisClient`, `insightsIngestClient`, and `insightsPortfolioClient` (all
     `baseUrl: '/insights/api'`) are called directly from this `/trader`-segment page rather than
     re-registered in `traderBff.ts` (feature 125 design decision, 2026-08-10): the base URLs are
     root-relative so the browser `fetch()` stays same-origin regardless of which segment rendered the
     page; no segment-specific ingress routing exists — `.do/app.yaml`'s single `/` catch-all routes
     both `/trader/api` and `/insights/api` to the same DO component; the session cookie is
     `path: '/'`, not segment-scoped; and `bffShared.ts`'s `requireSession` re-checks the session on
     every dispatch independent of which BFF router handled it. This trades `/trader`'s BFF
     self-containment for avoiding duplicate one-line `forward()` registrations — do not re-flag this
     as an architecture violation in a future audit; do not treat it as precedent for arbitrary
     cross-segment reuse without re-verifying these four facts still hold.
   ```

2. In `docs/patterns/nextjs-frontends.md` §10 (starting at the "Each frontend has two BFF files:"
   line, currently line 282), rewrite the paragraph and its fenced block to describe the actual
   current architecture, and add the cross-reference footnote:

   - Replace "Each frontend has two BFF files:" and its two-line code block (lines 282-287) with a
     description matching reality: `xstockstrat-ui` is one consolidated app with **one BFF file per
     segment** (`src/lib/{traderBff,insightsBff,configUiBff}.ts`), all built on shared plumbing in
     `src/lib/bffShared.ts` (`createBffRouter`, `createDispatch`, `requireSession`,
     `backendHeaders`), each mounted by its segment's `app/<segment>/api/[...connect]/route.ts`.
   - Correct the "#1 BFF footgun" block (lines 291-298): the consolidated app has **no** Next.js
     `basePath` config, so nothing strips the segment prefix from `req.url` — the handler map must be
     keyed on the **full** segment-prefixed path (`prefix + h.requestPath`, e.g. `/trader/api/...`),
     exactly the opposite of the pre-045 multi-app guidance this section previously gave. Cite
     `bffShared.ts:105-119`'s `createDispatch` (and its own inline comment explaining why) as the
     canonical mechanism, replacing the stale PR #453 example and its "nginx forwards it intact"
     closing line (nginx was removed by feature 045).
   - Immediately before this corrected block's remaining fenced code (or as its own short paragraph),
     add the cross-reference footnote: "**Exception**: `/trader/positions/[symbol]` calls
     `/insights`-segment browser clients directly rather than adding a `traderBff.ts` registration for
     every RPC it needs — see `services/xstockstrat-ui/CLAUDE.md` § Styling for the verified
     conditions and rationale (feature 125)."
   - Leave the rest of the document (including the pre-existing `basePath`/nginx references in
     §1, confirmed present at lines 3 and 12-17) untouched — those are a broader, already-recorded
     staleness gap (`fails.md` 2026-08-05) outside this step's scope; fixing §10 alone closes the
     specific gap design.md's Open Risks named.

3. Run the mandated Teardown scan (root `CLAUDE.md` § Teardown — this step edits both a service
   `CLAUDE.md` and a doc listed as a context file): `/context-scrubber scan`, scoped to
   `services/xstockstrat-ui/CLAUDE.md` and `docs/patterns/nextjs-frontends.md`. If the
   context-forge plugin is unavailable in the execution session, say so explicitly in the step's
   Deviation Log entry and in the eventual PR body — do not silently skip it (per `fails.md`
   2026-08-06 `fix-mcp-writepath-authz`, a prior feature skipped this same gate without recording the
   blocker).

**Verification**:
```bash
grep -n "Sanctioned exception — the unified" services/xstockstrat-ui/CLAUDE.md
grep -n "one BFF file per segment" docs/patterns/nextjs-frontends.md
grep -c "two BFF files" docs/patterns/nextjs-frontends.md   # expect 0
```
Confirm the `/context-scrubber scan` ran (or its unavailability is recorded) and any grounded
findings it reports against these two files are fixed before this step is marked done.

---

### Step 8 — service (xstockstrat-ui): page-structure refactor — sections gate independently of position

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/trader/positions/[symbol]/page.tsx` — modify
- `services/xstockstrat-ui/src/hooks/usePortfolio.ts` — modify (`usePosition`)
- `services/xstockstrat-ui/src/lib/scoreDisplay.ts` — no change (reused; cited for the
  `isNotFoundError` import)

**Reviewers**: `xstockstrat-ui` (service owner) — Trading UI correctness, Connect-RPC call safety,
order-mutation (trade widget) safety, no fabricated data (P-03)

**Codebase Evidence** (re-verified fresh by direct read of the live file **after** feature 124
`shadcn-table-actions-responsive` merged to `main-dev` — that feature touched this exact file and
shifted every line number below from the original recon/design citations; corrected here):
- Full current structure: `trader/positions/[symbol]/page.tsx:1-532`. `usePosition` call at line 53;
  `usePortfolio` at line 55; `useOrders(mode, selectedAccountId, { symbol })` **already fetched
  unconditionally** at the page's top level, line 57 — only its *rendering* is nested inside the
  position-gated `PositionBody` (the "Orders & fills" `Card`, lines 332-394).
- **Real precondition change from feature 124 (FR-10b), not just a line shift**: this step's
  original instructions assumed a "keep the existing `Button asChild ... Link ... Exposure`
  back-link unchanged" precedent. That back-link **no longer exists** — feature 124 replaced it with
  a `<PageBreadcrumb ariaLabel="Position path" items={[{ label: 'Exposure', href: '/trader/positions'
  }, { label: symbol }]} />` (lines 138-141, import at line 32), per the file's own comment at
  lines 136-137 ("replaces the prior ad hoc '← Exposure' Button asChild back-link"). Point 5's
  instructions below are revised to build on `PageBreadcrumb`, not the old back-link.
- The bars-fetch `useEffect` (lines 81-131) **already runs unconditionally** at the top level, keyed
  on `[symbol, timeframe, avg, stop, seriesRef]` — `avg`/`stop` (lines 78-79) are already computed
  safely (`Number(position?.avgEntryPrice ?? 0)`) and no-op cleanly with no position. Only the chart
  `Card` JSX (lines 288-330) is nested inside the position-gated `PositionBody`.
- Render-order bug confirmed live: the error paragraph (`{error && (` at line 149, the `<p>Failed to
  load position...</p>` at line 150, closing `)}` at line 151 — now split across 3 lines, not the
  single line the original citation assumed) is checked **before** the `EmptyState` branch (lines
  152-166) — a `NotFound` `error` (the common case for a never-held/watchlist-research symbol) hits
  the error paragraph, not the intended empty state.
- Exact enumerated `position.`-reading references inside the chart `Card` (lines 288-330) that must
  move to top-level locals once the Card is hoisted out of `PositionBody` (whose `position` prop is
  currently non-optional, so a raw `position.foo` read crashes once this Card renders unconditionally
  with `position` possibly `undefined`) — **6 references, re-confirmed by direct read post-124**:
  1. Line 294: `fmtUsd(position.avgEntryPrice)` (caption "avg …")
  2. Line 295: `fmtUsd(position.stopPrice)` (caption "· stop …", inside the `hasStop` ternary)
  3. Line 296: `fmtUsd(position.currentPrice)` (caption "· last …")
  4. Line 316: `fmtUsd(position.avgEntryPrice)` (meta-line "— — avg cost …")
  5. Line 320: `fmtUsd(position.stopPrice)` (meta-line "— — stop …", inside `hasStop &&`)
  6. Line 325: `fmtPct(position.stopDistancePct)` (meta-line "distance to stop …", inside `hasStop &&`)
- `hasStop` itself (currently computed inside `PositionBody` at line 209 as
  `Number(position.stopPrice ?? 0) > 0`) must also move to the top level, computed safely as
  `Number(position?.stopPrice ?? 0) > 0` (mirroring the existing `avg`/`stop` pattern at lines 78-79).
- A 7th reference, in a **different** Card (Orders & fills, not the chart) that this refactor also
  hoists: line 335's `<CardTitle>Orders &amp; fills · {position.symbol}</CardTitle>` reads
  `position.symbol` — once this Card mounts independent of `position`, use the page-level `symbol`
  local (already computed at line 49 from `params`, always available) instead — strictly simpler,
  since it's the exact same string `position.symbol` would hold when a position exists.
- No page-level symbol heading currently exists **outside** the position-gated header block
  (lines 220-264, itself full of `position.`-only fields — qty, side, day P&L — correctly staying
  gated, unlike the chart/orders Cards above). For an unheld symbol to have any visible page title,
  a minimal top-level heading using the already-available `symbol` local is needed — this is a
  mechanical consequence of "sections render independent of position" (design.md's stated intent)
  that design.md's own Open Risks entry explicitly left to be worked out at spec/implementation time
  ("flagged as a step-level checklist item for implementation-spec.md, not a further design
  decision"). The `PageBreadcrumb` (lines 138-141, see above) already ends in `{ label: symbol }` —
  a minimal `<h1>` sibling right below it is enough; do not port
  `insights/market/[symbol]/page.tsx`'s richer opportunity-specific header chrome (CardTitle +
  badges), since the richer version already exists in the position-gated header for the held case.
- `CardNotice` precedent confirmed: `services/xstockstrat-ui/src/components/shared/CardNotice.tsx`
  (`{children, variant}`), used identically at `trader/portfolio/page.tsx:152`
  (`<CardNotice>No open positions...</CardNotice>` — re-verified unaffected by feature 124).
- `isNotFoundError` helper confirmed: `services/xstockstrat-ui/src/lib/scoreDisplay.ts:36-38`
  (`err instanceof ConnectError && err.code === Code.NotFound`), already imported and used by
  `useStrategies.ts:3,34` (`useStrategyReport`'s `retry: (failureCount, err) =>
  !isNotFoundError(err) && failureCount < 1` at line 34) and `useStrategies.ts:64`
  (`useBacktestDetail`'s identical retry guard) — this file is unaffected by feature 124.
- `usePosition` confirmed at `hooks/usePortfolio.ts:65-83` — currently no `retry` option (default
  TanStack retry applies) and a fixed `refetchInterval: 10_000` (line 81) that never stops, even for
  a confirmed-`NotFound` position — this file is unaffected by feature 124.
- Trade widget reuse: `OrderForm({ mode, initialSymbol })` confirmed at
  `components/trader/OrderForm.tsx:41-48`; ambient `AccountProvider` under `/trader` confirmed at
  `app/trader/providers.tsx:6,13` (mounted once for the whole segment) — so this page needs no
  `SignalOrderTicket`-style own-wrapper (`components/insights/SignalOrderTicket.tsx:22-28`'s pattern
  is unnecessary here, since `/trader` already provides `AccountProvider`).

**TDD**: `red-green required`

**Instructions**:
In `trader/positions/[symbol]/page.tsx`:

1. **Top-level locals** — add `const last = Number(position?.currentPrice ?? 0);` and
   `const hasStop = Number(position?.stopPrice ?? 0) > 0;` next to the existing `avg`/`stop` locals
   (lines 78-79), so all four price-caption inputs are computed once, safely, regardless of whether
   `position` exists.
2. **Render-order fix** — reorder the branches so a `NotFound`-classified `error` routes to the
   inline notice branch, not the generic error paragraph: replace the unconditional
   `{error && (<p>Failed to load position: {error.message}</p>)}` (lines 149-151) with a check that
   only renders the error paragraph when `error` is present **and** `!isNotFoundError(error)`; the
   not-found case falls through to a `CardNotice` (see point 4).
3. **`usePosition` NotFound handling** (`hooks/usePortfolio.ts:65-83`) — add
   `retry: (failureCount, err) => !isNotFoundError(err) && failureCount < 1` (import
   `isNotFoundError` from `@/lib/scoreDisplay`) and change `refetchInterval: 10_000` to
   `refetchInterval: (query) => (isNotFoundError(query.state.error) ? false : 10_000)`, mirroring
   `useStrategies.ts`'s existing pattern exactly (this hook is used only by this page and
   `usePortfolio`'s other exports are untouched).
4. **Hoist the position-not-found branch to a compact inline notice** — replace the full-page
   `EmptyState` block (lines 152-166) with a `CardNotice` (import from
   `@/components/shared/CardNotice`) reading `No {mode} position in {symbol}` — same copy the
   `EmptyState` used — occupying only its own slot in the page's vertical flow, not a page takeover.
   Keep the `selectedAccountId`-conditional description text as a second line inside the same
   `CardNotice` if the component's children accept multiple nodes, or fold it into one sentence.
5. **Add a minimal top-level symbol heading**, rendered unconditionally (not gated on `position`),
   right below the `PageBreadcrumb` block — a small `<h1>`/`CardTitle`-equivalent showing just
   `symbol` (no position-derived fields), so an unheld symbol's page has a title. **Feature 124
   replaced the old "Exposure" back-link `Button`/`Link` with `<PageBreadcrumb>`** (lines 138-141,
   already ending in `{ label: symbol }`) — keep `PageBreadcrumb` unchanged; this heading is new,
   additive JSX beneath it, not a modification of the breadcrumb itself.
6. **Hoist the price-chart `Card`** (currently lines 288-330, inside `PositionBody`) to the page's
   top level, rendered unconditionally. Replace all 6 enumerated `position.`-reads (Codebase Evidence
   above) with the top-level `avg`/`stop`/`last`/`hasStop` locals from point 1. The `last` caption
   (currently "· last {fmtUsd(position.currentPrice)}") should render conditionally on `last > 0`
   (mirroring the existing `hasStop &&` pattern), so it degrades gracefully rather than showing
   "$0.00" for an unheld symbol.
7. **Hoist the Orders & fills `Card`** (currently lines 332-394, inside `PositionBody`) to the page's
   top level, rendered unconditionally — it already reads only `orders` (top-level, lines 57-58) and
   `working` (currently computed inside `PositionBody` at lines 213-215 from `orders`; move this
   computation to the top level too, since it no longer depends on anything from `PositionBody`).
   Change the `CardTitle`'s `{position.symbol}` (line 335) to the top-level `symbol` local (point 5).
8. **Mount the Trade widget** — add a new, always-rendered `Card` (or inline section) containing
   `<OrderForm mode={mode} initialSymbol={symbol} />` (import from `@/components/trader/OrderForm`),
   consuming the page's ambient `mode`/`symbol` locals directly — no `AccountProvider` wrapper needed
   (already provided by `app/trader/providers.tsx`). Place it near the Trade/Manage area of the page
   (e.g. where the existing "Manage" sidebar card's Add/Trim/Move-stop/Close buttons already live,
   lines 445-467 — those buttons deep-link to `/trader?symbol=...`; leave them as-is, the new
   `OrderForm` is an *inline* alternative to that navigation, not a replacement for it).
9. **`PositionBody`'s remaining scope** — after hoisting the chart, Orders & fills, and computing
   `hasStop`/`working` at the top level, `PositionBody` retains only the genuinely position-specific
   UI: the stat-tile header (lines 220-286), the Risk & exit / Manage / Why-it's-held / Broker
   sidebar (lines 397-509). Its `position: Position` prop type stays non-optional (unchanged) since
   it is only ever invoked from inside the position-conditional branch (point 4's `CardNotice`
   sibling), same as today.

Trading-domain step constraints (this feature is trading-domain-relevant via the Trade widget):
order placement itself is **unmodified** — `OrderForm`/`usePlaceOrder` are reused verbatim with no
new logic, so the broker-coverage / order-type-coverage / fill-state-completeness / trading-mode-gate
constraints in `reference/step-constraints.md` §A are satisfied by citing this reuse, not by adding
new handling in this step.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm lint
```
Plus the e2e proof in Step 9 (this step's own paired test).

---

### Step 9 — test (xstockstrat-ui): unheld-symbol section rendering + render-order fix

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/trader/position-detail.spec.ts` — modify
- `services/xstockstrat-ui/e2e/mock-backend.ts` — modify (only if a new not-held-symbol `getPosition`
  branch is needed — confirm at execute time whether `positionForSymbol` (already imported at
  `mock-backend.ts:231-234`) already returns an empty/absent `Position` for an unrecognized symbol,
  which it does per its existing contract backing `POSITION_AAPL`/`POSITION_MSFT`; a third symbol not
  in the fixture set should already resolve "not found" through the same helper — verify before
  adding new mock logic, per P-03's "verify, don't assume the fixture needs new plumbing")

**Reviewers**: `xstockstrat-ui` (service owner)

**Codebase Evidence**:
- `e2e/trader/position-detail.spec.ts` (55 lines confirmed by full read) is the existing canonical
  e2e home for this exact route (feature 096) — three tests, all against `POSITION_AAPL`/
  `POSITION_MSFT` (both held). No existing test exercises an unheld symbol.
- `e2e/fixtures/positions.ts` confirms `POSITION_AAPL`/`POSITION_MSFT` are the only two seeded
  symbols; a third symbol (e.g. `ZZZZ`, a sentinel unlikely to collide with any other spec's fixture
  data) exercises the not-found path.

**TDD**: `red-green required` (paired with Step 8; run against the pre-Step-8 tree first to confirm
the new assertions fail — the page currently full-page-`EmptyState`s and renders nothing else for an
unheld symbol).

**Instructions**:
Add a new test to the existing `test.describe('Single Position page', ...)` block:
- Navigate to `/trader/positions/ZZZZ` (or another symbol absent from `POSITION_AAPL`/
  `POSITION_MSFT`).
- Assert the compact `CardNotice` text ("No {mode} position in ZZZZ") is visible, **not** the old
  full-page `EmptyState` copy, and that it does not hide the rest of the page.
- Assert the price-chart `Card` and the Orders & fills `Card` (title `Orders & fills · ZZZZ`, using
  the page-level `symbol`, not a position field) are both visible below the notice — proving the
  hoisted sections render for an unheld symbol.
- Assert the Trade widget (`OrderForm`) renders — e.g. its symbol input reflects `ZZZZ`
  (`symbolLocked` via `initialSymbol`, per `OrderForm.tsx:55-65`).
- Add a second test asserting the render-order fix directly: for a `NotFound` `GetPosition` response,
  confirm the generic "Failed to load position" error paragraph text is **not** present (only the
  `CardNotice` is), closing the gap the pre-fix branch order left open.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm test:e2e -g "Single Position page"
```
Run once against the pre-Step-8 tree (confirm red), once after (confirm green).

---

### Step 10 — service (xstockstrat-ui): `useReadiness`/`SignalReadiness` NotFound handling

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/hooks/useOpportunities.ts` — modify
- `services/xstockstrat-ui/src/components/insights/SignalReadiness.tsx` — modify

**Reviewers**: `xstockstrat-ui` (service owner)

**Codebase Evidence**:
- `EvaluateReadiness`'s real `NOT_FOUND` path confirmed via direct read:
  `services/xstockstrat-analysis/app/handlers/servicer.py:1971-1976` — `context.abort(
  grpc.StatusCode.NOT_FOUND, f"strategy '{request.strategy_id}' not found")` when
  `self._strategies_repo.get_by_id(request.strategy_id)` returns `None`.
- Reachable because `SignalReadiness.tsx:33` seeds `strategyId` directly from
  `searchParams?.get('strategy') ?? ''` — an externally-controllable/bookmarkable value. (Line
  re-verified post-feature-124: `SignalReadiness.tsx` shifted +1 line vs. the original design.md
  citation; `useOpportunities.ts` is unaffected by feature 124, still exactly as cited below.)
- `useReadiness` confirmed at `hooks/useOpportunities.ts:45-51` — currently has **no** `retry` option
  and no `isNotFound` return field.
- `SignalReadiness.tsx:66-67`'s current error branch (ternary chain, re-verified): `... : error ? <p
  className="text-sm text-sell">Failed to evaluate readiness.</p> : ...` — no NotFound-vs-generic
  distinction.
- Precedent to mirror: `useBacktestDetail` (`hooks/useStrategies.ts:54-67`) — `retry: (failureCount,
  err) => !isNotFoundError(err) && failureCount < 1` plus a returned `isNotFound: isNotFoundError(
  query.error)` field (line 66).
- `isNotFoundError` import source: `@/lib/scoreDisplay` (`scoreDisplay.ts:36-38`).

**TDD**: `red-green required`

**Instructions**:
In `useOpportunities.ts`, change `useReadiness` (lines 45-51) to match `useBacktestDetail`'s shape:
add `retry: (failureCount, err) => !isNotFoundError(err) && failureCount < 1` to the `useQuery`
options (import `isNotFoundError` from `@/lib/scoreDisplay`), and return an added `isNotFound:
isNotFoundError(query.error)` field alongside the query result (the function currently returns the
raw `useQuery(...)` result directly — change it to destructure and spread, same pattern as
`useBacktestDetail`).

In `SignalReadiness.tsx`, destructure the new `isNotFound` field from `useReadiness`'s return (line
35: `const { data, isLoading, error } = useReadiness(...)` → add `isNotFound`), and branch before the
generic error paragraph (line 67, inside the existing ternary chain starting at line 60): when
`isNotFound`, render a distinct message — "This strategy no longer exists — pick another." — instead
of "Failed to evaluate readiness."; the generic error paragraph remains for any other error.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm lint
```
Plus the e2e proof in Step 11.

---

### Step 11 — test (xstockstrat-ui): `SignalReadiness` NotFound paired test

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/trader/position-detail.spec.ts` — modify
- `services/xstockstrat-ui/e2e/mock-backend.ts` — modify (`evaluateReadiness` handler needs a branch
  that throws `NotFound` for a stale/unrecognized `strategyId`)

**Reviewers**: `xstockstrat-ui` (service owner)

**Codebase Evidence**:
- Precedent pattern confirmed: `e2e/insights/backtest-coverage.spec.ts:191-198` — the
  `run-detail-empty` testid asserts a dedicated NotFound UI state, not a re-run of pre-existing
  page-shell coverage.
- `evaluateReadiness` mock confirmed at `mock-backend.ts:563-570` — currently always returns a
  readiness array keyed off `req.symbols`, never throws.

**TDD**: `red-green required` (paired with Step 10).

**Instructions**:
In `mock-backend.ts`'s `evaluateReadiness` handler, add a branch that throws a `ConnectError` with
`Code.NotFound` when `req.strategyId` equals a reserved sentinel (e.g. `strat-notfound-readiness-01`,
distinct from the existing `strat-notfound-001` sentinel reserved for `GetStrategyReport` per
`e2e/fixtures/INVENTORY.md`'s "Recurring sentinel ids" table — register the new sentinel there in the
same step, C-12).

Add a test to `position-detail.spec.ts` navigating to
`/trader/positions/AAPL?strategy=strat-notfound-readiness-01`, asserting the "This strategy no longer
exists — pick another." message renders (not the generic "Failed to evaluate readiness." text).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm test:e2e -g "Single Position page"
```
Run once against the pre-Step-10 tree (confirm red — the old generic error text renders instead),
once after (confirm green).

---

### Step 12 — service (xstockstrat-ui): watchlist-membership gating + Opportunity/Readiness sections

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/trader/positions/[symbol]/page.tsx` — modify

**Reviewers**: `xstockstrat-ui` (service owner)

**Codebase Evidence**:
- `useWatchlists()` confirmed at `hooks/useWatchlists.ts:29-39` — returns `{ data, isLoading,
  isFetching, error }` where `data.watchlists[].bindings[]` (each a `{symbol, strategyId}`, per
  `WatchlistBindingInput` at line 20) is the membership data to scan client-side. No dedicated
  membership RPC exists (recon.md Risks, re-confirmed — no new grep hit for one).
- `useOpportunities(minConviction)` confirmed at `hooks/useOpportunities.ts:16-22` — `analysisClient`
  bound to `/insights/api` (browser client, cross-segment-safe per Step 7's documented exception).
- Opportunity-selection precedent to replicate, re-verified post-feature-124 at
  `insights/market/[symbol]/page.tsx:94-99`: `matches.find(o => o.strategyId ===
  threadedStrategy) ?? matches[0]` (the `.find` line itself is at line 98) — resolves design.md's
  Open Risk ("Opportunity-selection tie-breaking... not fully specified... To be resolved at
  `/sdd-spec`") by replicating the existing, already-shipped tie-break rule verbatim rather than
  inventing a new one.
- `SignalReadiness` component (Step 10's NotFound-fixed version) mounts the same way
  `insights/market/[symbol]/page.tsx:217-219` already does (line shifted +8 from the original
  citation — this file gained a `PageBreadcrumb` insertion from feature 124, same as the trader
  positions page):
  `<Suspense fallback={<div className="h-24" />}><SignalReadiness symbol={symbol} /></Suspense>` (it
  reads `useSearchParams()` internally, hence the `Suspense` wrap).
- `OPPORTUNITY_ACTION`/`EnumBadge` render maps confirmed at `src/lib/opportunityShared.tsx` (imported
  by `insights/market/[symbol]/page.tsx:17` — same import this step reuses; shifted +1 from the
  original citation).
- `Opportunity.conviction` is a deterministic **ordinal**, not a probability — per its own proto
  comment (`packages/proto/analysis/v1/analysis.proto`, cited in product-spec's Known Traps /
  `fails.md` 2026-08-05 `023-position-sizing-engine`) — display it exactly as
  `insights/market/[symbol]/page.tsx:105` already does (`Math.round(opportunity.conviction * 100)`,
  shifted +1 from the original citation), never re-labeled as a percentage confidence.

**TDD**: `red-green required`

**Instructions**:
1. Add an `isSymbolWatchlisted` computation from `useWatchlists()`'s `data.watchlists[].bindings[]`
   — confirmed authoritative at `packages/proto/portfolio/v1/portfolio.proto:190` (`repeated
   WatchlistBinding bindings = 8`; "when present it supersedes `symbols`"). The flat
   `data.watchlists[].symbols[]` (`portfolio.proto:186`, field 5) is `[deprecated = true]` — check it
   only as a fallback for a watchlist whose `bindings[]` is empty (a legacy record predating feature
   097), never as the primary source. Scan for the page's `symbol` across both. Also derive the
   **matching binding's `strategyId`** (if any) for reuse by Step 18's backtest-strategy precedence —
   a symbol found only via the legacy `symbols[]` fallback has no `strategyId` (unbound).
2. Gate the watchlist-conditional split (FR-11) on `isSymbolWatchlisted` alone — never on `position`:
   when true, render Opportunity/conviction + Readiness + (Step 14's) Fundamentals; when false,
   render (Step 16's) Screening. Exactly one side renders — while `useWatchlists` is loading, render
   neither side yet (a brief loading placeholder), never both or a flash of the wrong side.
3. **Opportunity section**: call `useOpportunities(0)`, filter to `o.symbol === symbol`, select via
   the replicated tie-break (`matches.find(o => o.strategyId === boundStrategyId) ?? matches[0]`,
   using the watchlist-binding's `strategyId` — Step 12's own gating output — in place of
   `insights/market`'s `threadedStrategy` URL param, since this page has no `?strategy=` threading
   concept of its own for Opportunity selection). Render conviction, action tag (`EnumBadge` +
   `OPPORTUNITY_ACTION`), thesis/source/strategy/expiry fields exactly as
   `insights/market/[symbol]/page.tsx:105-112,136-165` shows them today (re-verified post-feature-124;
   shifted +1/+8 respectively from the original citation, same dual-shift pattern as the `Suspense`
   mount above — everything before this page's own `PageBreadcrumb` insertion shifted +1, everything
   in/after its JSX `return` shifted +8). When no matching `Opportunity` exists for a watchlisted
   symbol, show an explicit no-data state (P-03) — never an empty gap.
4. **Readiness section**: mount `<SignalReadiness symbol={symbol} />` inside a `Suspense` boundary,
   as above. `SignalReadiness` internally resolves its own strategy (via `?strategy=` or its picker)
   — no new plumbing needed from this page beyond the `symbol` prop, matching how
   `insights/market/[symbol]` already mounts it unchanged.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm lint
```
Plus the e2e proof in Step 13.

---

### Step 13 — test (xstockstrat-ui): watchlist-conditional gating

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/trader/position-detail.spec.ts` — modify
- `services/xstockstrat-ui/e2e/mock-backend.ts` — modify (only if `listWatchlists` needs a scenario
  that includes/excludes the test symbol — check whether `mockWatchlists(page)`
  (`e2e/helpers/watchlistMock.ts:27`) is already wired into the shared mock-backend setup for
  `/trader` routes, or whether it is currently only invoked by `insights/watchlists.spec.ts`-style
  per-spec setup; wire it into this spec's `beforeEach`/test body if not already page-scoped)

**Reviewers**: `xstockstrat-ui` (service owner)

**Codebase Evidence**:
- `mockWatchlists(page)` helper confirmed at `e2e/helpers/watchlistMock.ts:27-` — a stateful
  in-memory mock seedable with `MockBinding[]` per watchlist (C-12 canonical home, per
  `INVENTORY.md`'s "Watchlists (stateful mock)" row).

**TDD**: `red-green required` (paired with Step 12).

**Instructions**:
Add two tests:
- A symbol present in a mocked watchlist's `bindings` → Opportunity/conviction and the Readiness
  panel ("Why this fired") render; confirm the Screening section (Step 16's testid/heading) is
  absent.
- A symbol absent from every mocked watchlist → the Screening section renders; confirm the
  Opportunity/Readiness sections are absent.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm test:e2e -g "Single Position page"
```

---

### Step 14 — service (xstockstrat-ui): Fundamentals section

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/traderBff.ts` — modify
- `services/xstockstrat-ui/src/app/trader/positions/[symbol]/page.tsx` — modify
- `services/xstockstrat-ui/src/hooks/usePortfolio.ts` — modify (or a new
  `services/xstockstrat-ui/src/hooks/useFundamentals.ts` — prefer co-locating with `usePosition`
  only if the hook stays small; otherwise a dedicated file matches the repo's per-domain hook-file
  convention seen in `useBackfills.ts`/`useOpportunities.ts` — decide at execute time by file-size
  precedent, not prescribed here)

**Reviewers**: `xstockstrat-ui` (service owner); `xstockstrat-marketdata` (FYI) — `GetFundamentals`
BFF registration only, no service-side change

**Codebase Evidence**:
- `traderBff.ts:103-106`'s `MarketDataService` registration confirmed to have only `getBars`/
  `listAssets` — no `getFundamentals`. `marketDataClient` (server-side, `connectClients.ts:33`,
  dialing `MARKETDATA_ENDPOINT` directly) already exposes `.getFundamentals` as a typed method (the
  whole `MarketDataService` is imported), simply unregistered in this router.
- `insightsBff.ts:85-91` confirmed **also** lacks `getFundamentals` — there is no existing
  registration to reuse either way (unlike every other section's RPC), so this is the one genuinely
  new BFF registration the feature needs, per design.md's BFF-wiring decision.
- `GetFundamentals`/`Fundamentals` proto shape confirmed:
  `packages/proto/marketdata/v1/marketdata.proto:161-189` — `market_cap`, `pe_ratio`, `pb_ratio`,
  `dividend_yield`, `eps`, `beta`, `roe`, `debt_to_equity`, `price`, `year_high`, `year_low`,
  `extra_metrics` (map), `as_of`, `currency`, `source`, `stale`.
- **Corrected finding (this step's own recon, not carried from design.md)**: a symbol with genuinely
  no FMP data does **not** surface as gRPC `NotFound`. Confirmed via
  `services/xstockstrat-marketdata/internal/fmp/fmp_client.go:63-72` (`GetFundamentals` returns a
  plain Go error `"fmp: no fundamentals for %q"` when the quote fetch returns zero rows) and
  `internal/service/marketdata_service.go:924-957`'s `resolveFundamentals` (the error from
  `s.fundamentals.GetFundamentals` at line ~952 is wrapped `connect.CodeUnavailable`, not
  `CodeNotFound`). Also possible: `CodeFailedPrecondition` when `marketdata.fmp.enabled` is false
  (`fundamentalsEnabled()`, lines 965-970) and `CodeResourceExhausted` under quota exhaustion with no
  cached row (`resolveFundamentals`, the `count >= dailyCap` branch). FR-7's "if the symbol has no
  fundamentals data, show that explicitly" must therefore treat **any** error from this call as the
  no-data case (with the specific message surfaced, since the three causes are meaningfully
  different for an operator) — it must NOT special-case only `NotFound`, unlike every other section's
  error handling in this feature. This is a genuine, evidence-based correction to how this section's
  error state should be built; note it explicitly rather than copying the `isNotFoundError` pattern
  used elsewhere on this page.
- `marketDataClient` browser client bound to `/trader/api` confirmed at
  `browserClients/marketDataClient.ts:5` — already imported and used by this same page for
  `getBars` (line 13 of `positions/[symbol]/page.tsx`), so the Fundamentals hook follows the exact
  same import/call pattern, just a different method.
- Fixture home: `INVENTORY.md` confirmed fundamentals **entirely absent** from the canonical fixture
  catalog — a new `e2e/fixtures/fundamentals.ts` module is required (C-12), not an inline literal
  (this will have ≥2 consumers immediately: `mock-backend.ts` and this section's e2e test, satisfying
  C-12's "second consumer forces centralization" on day one).

**TDD**: `red-green required`

**Instructions**:
1. In `traderBff.ts`, add to the existing `router.service(MarketDataService, {...})` block
   (lines 103-106): `getFundamentals: forward((req, opts) => marketDataClient.getFundamentals(req,
   opts))`, mirroring the existing `getBars` entry's `forward(...)` pattern exactly (read-only, no
   admin gate — matches `GetFundamentals`'s ungated backend contract, confirmed via
   `marketdata_handler.go:159-171`'s comment "no scope check").
2. Add a query hook (`useFundamentals(symbol)`) calling the **browser**
   `marketDataClient.getFundamentals({ symbol })` (from `browserClients/marketDataClient.ts`, bound
   to `/trader/api` — same-segment, ordinary registration, not the cross-segment exception), enabled
   only when `symbol` is set.
3. Render a Fundamentals section (watchlist-conditional, Step 12's gate) showing the metrics FR-7
   lists — `market_cap`, `pe_ratio`, `pb_ratio`, `dividend_yield`, `eps`, `beta`, `roe`,
   `debt_to_equity` at minimum (the full field list above is available; the design leaves exact
   subset to this step, per product-spec FR-7's "show the symbol's fundamentals ratios/metrics" with
   no exhaustive field mandate). On any query error, render an explicit "no fundamentals data" state
   whose message reflects the error (per the corrected finding above — do not special-case only
   NotFound). On success, note `f.stale` (FR-4 precedent from the backend) if true.
4. Create `e2e/fixtures/fundamentals.ts` with a canonical `FUNDAMENTALS_AAPL` object shaped from
   `Fundamentals` (proto shape above), and register it in `INVENTORY.md`'s Canonical fixtures table
   in the same step (C-12).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm lint
grep -n "getFundamentals" src/lib/traderBff.ts
```
Plus the e2e proof in Step 15.

---

### Step 15 — test (xstockstrat-ui): Fundamentals section e2e

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/mock-backend.ts` — modify (add a `getFundamentals` handler to the
  `MarketDataService` router registration)
- `services/xstockstrat-ui/e2e/trader/position-detail.spec.ts` — modify

**Reviewers**: `xstockstrat-ui` (service owner)

**Codebase Evidence**:
- `mock-backend.ts` confirmed to have **no** `getFundamentals` handler anywhere (grep returned zero
  hits) — this is genuinely new mock wiring, not an oversight to merely extend.

**TDD**: `red-green required` (paired with Step 14).

**Instructions**:
Add a `getFundamentals` handler to `mock-backend.ts`'s `MarketDataService` router registration,
returning `FUNDAMENTALS_AAPL` (Step 14's fixture) for `AAPL` and throwing a `ConnectError` (any code
— e.g. `Code.Unavailable`, matching the real service's actual no-data contract confirmed in Step 14)
for an unrecognized symbol, so both the data and no-data UI states are exercisable.

Add a test asserting the Fundamentals section renders `AAPL`'s metrics on a watchlisted `AAPL` visit,
and a second test asserting the explicit no-data message for a symbol whose mock throws.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm test:e2e -g "Single Position page"
```

---

### Step 16 — service (xstockstrat-ui): single-symbol Screening section

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/trader/positions/[symbol]/page.tsx` — modify
- `services/xstockstrat-ui/src/components/trader/SymbolScreening.tsx` — create

**Reviewers**: `xstockstrat-ui` (service owner); `xstockstrat-analysis` (FYI) — confirms the UI reads
`criterion_raw_values`/`criterion_passed` (Step 3's fields), never `score`/`criterion_scores`, for
this single-symbol path

**Codebase Evidence**:
- `useScreenSymbols()` confirmed at `hooks/useScreenSymbols.ts:10-18` — a mutation over
  `analysisClient.screenSymbols` (cross-segment-safe browser client, `/insights/api`), directly
  reusable per Step 7's documented exception — no new BFF registration needed.
- `ScreenCriterion`/`ScreenSymbolsRequest` shape confirmed:
  `packages/proto/analysis/v1/analysis.proto:357-367` — `ref_name`, `kind` (FUNDAMENTAL vs
  TECHNICAL_INDICATOR, routed via `metric_name` or `component` respectively, per
  `insights/screener/page.tsx:162-174`'s existing branch), `op` (Comparator), `threshold`,
  `threshold_high`, `weight`, `hard_filter`.
- **Confirmed live trap this section must avoid**: `_normalize_universe`
  (`services/xstockstrat-analysis/app/services/screener.py:388-416`) collapses every criterion's
  `criterion_scores`/composite `score` to a content-free `0.5` on a one-symbol scan (`lo == hi` at
  line 403-404) — this section must display only `criterion_raw_values`/`criterion_passed`
  (Step 3's new fields), never `score` or `criterion_scores`, matching design.md's Chosen Approach
  and `fails.md` 2026-08-08 `screener-data-readiness-polling`.
- No existing "saved screener criteria" persistence exists to pull from (confirmed: the full-page
  Screener's criteria list, `insights/screener/page.tsx`'s `criteria` state, is local component
  state, never persisted server-side beyond an ad hoc "Save as watchlist" of the *result symbols*,
  not the criteria) — FR-8 explicitly does not mandate rebuilding the full Screener UI, so this
  section needs its **own** minimal criteria input, not a reuse of saved criteria that doesn't exist.
- Fixture extension target: `e2e/fixtures/screenResults.ts` (existing canonical `ScreenResult`
  fixture home, `INVENTORY.md:28`) — extend with scenario rows carrying `criterionRawValues`/
  `criterionPassed` (camelCase, Connect-JSON convention per `insights.md` 2026-08-06
  `opportunity-universe-unification`'s enum/well-known-type lesson — applies equally to a new map
  field's JSON key casing), not a new third fixture file.

**TDD**: `red-green required`

**Instructions**:
1. Create `components/trader/SymbolScreening.tsx` (`{ symbol: string }` prop) with a minimal
   criteria-builder — reuse the same `newCriterion`/`CriterionRow` shape pattern
   `insights/screener/page.tsx:98-108` establishes (kind/metricName/op/threshold/weight/hardFilter),
   but scoped to this one symbol: a small form to add/edit criteria, then a "Run" action calling
   `useScreenSymbols().mutate({ symbols: [symbol], criteria: [...] })` (request-building mirrors
   `runScan`'s pattern at `insights/screener/page.tsx:148-176`, including the
   `TECHNICAL_INDICATOR`-vs-`FUNDAMENTAL` branch at lines 162-174).
2. Render the result's per-criterion display: for each submitted criterion, show `ref_name`,
   `criterion_raw_values[ref_name]` (the raw reading), the client-known `threshold` (echoed from the
   request, not the response), and `criterion_passed[ref_name]` as a pass/fail indicator. **Never**
   render `result.score` or `result.criterion_scores` anywhere in this component.
3. Handle `ScreenResultStatus.INSUFFICIENT_DATA` (the `gap`-bearing early-return branch,
   `screener.py:419-427`) with an explicit "not enough data" state, matching the existing Screener
   page's `CoverageGap` handling pattern.
4. Mount `<SymbolScreening symbol={symbol} />` in the page, gated on `!isSymbolWatchlisted` (Step
   12's gate, inverted).
5. Extend `e2e/fixtures/screenResults.ts` with a new factory (e.g. `criterionDetailRow(symbol,
   raw, passed)`) returning a `ScreenResult`-shaped object carrying `criterionRawValues`/
   `criterionPassed`; register the addition in `INVENTORY.md`'s existing "Screener results" row
   (update its description, not a new row — same fixture module).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm lint
grep -n "criterion_scores\|\.score\b" src/components/trader/SymbolScreening.tsx  # expect no hits
```
Plus the e2e proof in Step 17.

---

### Step 17 — test (xstockstrat-ui): Screening section e2e

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/mock-backend.ts` — modify (`screenSymbols` handler — add a
  single-symbol-request branch returning `criterionRawValues`/`criterionPassed`)
- `services/xstockstrat-ui/e2e/trader/position-detail.spec.ts` — modify

**Reviewers**: `xstockstrat-ui` (service owner)

**Codebase Evidence**:
- `screenSymbols` mock confirmed at `mock-backend.ts:710-`, currently always returns a fixed 3-row
  response ignoring most of the request shape beyond `req.symbols.length ? req.symbols :
  ['AAA','BBB','CCC']` — needs a branch keyed on `req.symbols.length === 1` (or a specific sentinel
  symbol) to return Step 16's fixture-shaped single-row response instead.

**TDD**: `red-green required` (paired with Step 16).

**Instructions**:
Add the single-symbol branch to `screenSymbols`'s mock handler, returning Step 16's
`criterionDetailRow` fixture. Add a test on a non-watchlisted symbol (per Step 13's watchlist-mock
seeding, a symbol excluded from every mocked watchlist) asserting the Screening section renders, lets
a criterion be added and the scan run, and shows the raw value + pass/fail from the mocked response —
and asserts the composite score is never displayed anywhere in that section's DOM subtree.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm test:e2e -g "Single Position page"
```

---

### Step 18 — service (xstockstrat-ui): Backtests section

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/trader/positions/[symbol]/page.tsx` — modify

**Reviewers**: `xstockstrat-ui` (service owner)

**Codebase Evidence**:
- `useBacktestHistory(strategyId)` confirmed at `hooks/useStrategies.ts:39-49` — list-shaped, no
  NotFound semantics (unlike `useBacktestDetail`), cross-segment-safe (`analysisClient`,
  `/insights/api`).
- `useRunBacktest()` confirmed at `hooks/useBacktest.ts:9-17` — a plain mutation, synchronous
  (per design.md: `RunBacktest` computes → persists → ledger-emits → returns within one RPC, no job
  queue).
- `BacktestRunSummary.symbols` confirmed at `packages/proto/analysis/v1/analysis.proto:206` (field
  11, `repeated string`) — the client-side filter target.
- Strategy-source precedence confirmed as decided by design.md: `watchlistBinding.strategyId ||
  owningStrategy` — `owningStrategy` is **already computed** at
  `trader/positions/[symbol]/page.tsx:62-68` (re-verified post-feature-124, was cited as `61-67`;
  derived from the symbol's orders, most-frequent non-empty `strategyId`), unchanged by this
  feature — Step 8 preserves this computation as-is at the page's top level.
  `watchlistBinding.strategyId` is Step 12's own gating output (the matched binding's
  `strategyId`, when the symbol is watchlisted).
- Design.md explicitly scopes this section to **history-list-only** — no embedded per-run detail
  view. `GetBacktest`/`useBacktestDetail` stays exclusively on `/insights/strategies/[id]`
  (confirmed unaffected, per `insights/strategies/[id]/page.tsx:49,76-81` — not touched by this
  feature).

**TDD**: `red-green required`

**Instructions**:
1. Resolve `resolvedStrategyId = watchlistBindingStrategyId || owningStrategy` (Step 12's binding
   output, falling back to the page's existing `owningStrategy` local). When neither resolves to a
   non-empty string, render an explicit "no resolvable strategy" no-data state for this whole
   section (per FR-9/AC-6) — do not call `useBacktestHistory` with an empty string.
2. Call `useBacktestHistory(resolvedStrategyId || undefined)`, then **client-side filter** the
   returned `BacktestRunSummary[]` to rows whose `symbols` array includes the page's `symbol`
   (`row.symbols.includes(symbol)`) — this is the accepted narrower-coverage filter FR-9 names
   explicitly (covers only `resolvedStrategyId`'s runs, not every strategy platform-wide that
   happened to include the symbol).
3. Render the filtered list (backtest id, status, key metrics — total return, Sharpe, win rate,
   matching the summary fields already on `BacktestRunSummary`) as a simple history table/list — no
   embedded detail view, no `GetBacktest` call.
4. Add a "Run new backtest" action calling `useRunBacktest().mutate({ strategyIdRef:
   resolvedStrategyId, symbols: [symbol], initialCapital: <number>, range: { start: <Timestamp>, end:
   <Timestamp> } })` — field names and shape confirmed at `RunBacktestRequest`
   (`packages/proto/analysis/v1/analysis.proto:44-53`: `strategy_id_ref` field 6 takes precedence
   over legacy `strategy_id`/`strategy_params`; `symbols` field 3; `initial_capital` field 4; `range`
   field 2, a `xstockstrat.common.v1.TimeRange`), matching the exact call shape already proven at
   `insights/strategies/[id]/page.tsx:96-102`. Reuse that page's same default range/capital seed
   (`start: '2024-01-01'`, `end: '2024-12-31'`, `initial_capital: '100000'`,
   `insights/strategies/[id]/page.tsx:69-71`) rather than inventing new defaults — a minimal inline
   form (or a fixed default with no form, if the design favors a single "Run" button) is an execute-
   time UI-polish choice, not a field-shape ambiguity. On success, invalidate/refetch the history
   query so the new run appears without a manual reload.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm lint
```
Plus the e2e proof in Step 19.

---

### Step 19 — test (xstockstrat-ui): Backtests section e2e

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/trader/position-detail.spec.ts` — modify

**Reviewers**: `xstockstrat-ui` (service owner)

**Codebase Evidence**:
- `listBacktests`/`runBacktest` mocks already exist (`mock-backend.ts:687,589` per earlier grep) —
  reuse the existing history fixture (`HIST_RUN_DETAIL`/history rows, per `INVENTORY.md`'s "Backtest
  coverage gaps" row's neighboring history rows — confirm the exact symbol-list on those rows carries
  a case this test can filter to, or extend a row's `symbols` field if none currently includes
  `AAPL`) rather than inventing a parallel fixture.

**TDD**: `red-green required` (paired with Step 18).

**Instructions**:
Add a test asserting: for a symbol whose resolved strategy has history rows including that symbol,
the filtered list renders (and a row **not** including the symbol is excluded, proving the
client-side filter, not just "any history renders"); triggering a new run (mocked `runBacktest`
success) causes the history list to refresh. Add a second test for the no-resolvable-strategy case
(a symbol with no watchlist binding and no orders-derived `owningStrategy`) asserting the explicit
no-data state.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm test:e2e -g "Single Position page"
```

---

### Step 20 — service (xstockstrat-ui): Backfill section

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/trader/positions/[symbol]/page.tsx` — modify

**Reviewers**: `xstockstrat-ui` (service owner)

**Codebase Evidence**:
- `useBackfillJobs(filter)` confirmed at `hooks/useBackfills.ts:25-31` — already calls
  `insightsIngestClient.listBackfillJobs` (cross-segment-safe browser client, `/insights/api`, per
  Step 7's exception) with an already-existing `symbol` filter param
  (`ListJobsInput`/`ListBackfillJobsRequest`'s `symbol` field, server-side filtered per
  `ingest/app/repositories/backfill_jobs.py:100-102`'s `= ANY(symbols)` predicate). **No new BFF
  registration needed** — this hook is directly reusable as-is, unlike recon.md's Recommended Scope
  originally suggested (superseded by design.md's round-5 cross-segment-reuse decision, which this
  hook already satisfies via `insightsIngestClient`).
- `ListBackfillJobsResponse.jobs[]` (`BackfillJob`) field names confirmed at
  `packages/proto/ingest/v1/ingest.proto:27-43`: each job carries one `range` field (field 4, a
  `xstockstrat.common.v1.TimeRange`), not a per-symbol range — `TimeRange` itself
  (`packages/proto/common/v1/common.proto:42-45`) is `{ start: Timestamp, end: Timestamp }` (camelCase
  `start`/`end` in the generated TS). `status` (field 5, `BackfillStatus`) distinguishes
  completed/running/failed jobs for the reduction below. `insights/backfills/page.tsx`'s existing
  render of job rows is the reference for how these fields are already consumed today.

**TDD**: `red-green required`

**Instructions**:
Call `useBackfillJobs({ symbol })`, reduce the returned `jobs[]` into a compact display summary:
across jobs with `status` = completed, take `min(job.range.start)` / `max(job.range.end)` as the
symbol's overall covered range; if reduction across overlapping/gapped ranges proves non-trivial for
a clean single min/max (e.g. genuinely disjoint coverage windows), fall back to a per-job list instead
— the exact reduction shape is this step's own minimal design choice, per FR-10's "dates only, no
chart" scope. Render this in a Backfill section, unconditional (not watchlist-gated — FR-10 applies
to any symbol). Empty `jobs[]` renders an explicit "no ingested coverage" state, not a blank gap.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm lint
```
Plus the e2e proof in Step 21.

---

### Step 21 — test (xstockstrat-ui): Backfill section e2e

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/mock-backend.ts` — modify (add a `listBackfillJobs` handler — confirmed
  absent from the mock backend entirely)
- `services/xstockstrat-ui/e2e/fixtures/backfillJobs.ts` — create
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify

**Reviewers**: `xstockstrat-ui` (service owner)

**Codebase Evidence**:
- `listBackfillJobs` confirmed absent from `mock-backend.ts` (grep returned zero hits).
- `INVENTORY.md`'s "Not yet centralized" table lists backfill jobs as living only in
  `e2e/insights/backfills.spec.ts`'s inline `runningJob()` factory (carrying both `timeframe: '1d'`
  and `timeframeEnum: 'TIMEFRAME_1DAY'`, per feature 080's dual-field convention) — this step's new
  mock consumer is the "second consumer" C-12 requires before centralizing, so generalize
  `runningJob()` into `e2e/fixtures/backfillJobs.ts` rather than writing a second copy.

**TDD**: `red-green required` (paired with Step 20).

**Instructions**:
Create `e2e/fixtures/backfillJobs.ts`, generalizing `backfills.spec.ts`'s existing `runningJob()`
factory into an exported, parameterized version (symbol + status + timeframe + range) — update
`backfills.spec.ts` to import from the new module instead of its inline factory (closing the "second
consumer" gap in the same step, not leaving a second copy). Register the new module in
`INVENTORY.md` (move the "Not yet centralized" row into the Canonical fixtures table).

Add a `listBackfillJobs` handler to `mock-backend.ts` returning the new fixture's jobs filtered by
`req.symbol`. Add a test asserting the Backfill section shows the reduced date-range summary for a
symbol with mocked coverage, and the explicit no-coverage state for one without.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm test:e2e -g "Single Position page|Backfills"
```
Confirm `backfills.spec.ts` still passes unchanged after its factory-import switch (no behavior
change to that spec, per the DRY guard rail's "touch only what the task requires").

---

### Step 22 — service (xstockstrat-ui): retire `insights/market/[symbol]` → redirect; repoint caller

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/insights/market/[symbol]/page.tsx` — modify (replace with a
  Server Component redirect)
- `services/xstockstrat-ui/src/app/insights/opportunities/page.tsx` — modify

**Reviewers**: `xstockstrat-ui` (service owner) — C-10(a) nav reachability, verifies every existing
inbound link is repointed, not just the primary one

**Codebase Evidence**:
- Redirect precedent confirmed: `app/page.tsx:1-5` (full file) —
  ```tsx
  import { redirect } from 'next/navigation';
  export default function Home() { redirect('/trader'); }
  ```
  An unconditional Server Component `redirect()`, no `'use client'`.
- The sole real caller confirmed via `grep -rn "insights/market"
  services/xstockstrat-ui/src --include=*.tsx --include=*.ts` (re-run post-feature-124):
  `opportunities/page.tsx:140-141` (shifted from the original `129-130` citation — feature 124 added
  markup above this ternary; the site itself is unchanged) —
  (`? /insights/market/${o.symbol}?strategy=${o.strategyId} : /insights/market/${o.symbol}`). The
  grep now returns 6 line-hits across 3 files, not 4 — `PlatformHeader.tsx:103-104` and
  `BottomTabBar.tsx:18-19` each contribute 2 hits (their nav-special-case comment line also contains
  the literal string "insights/market", in addition to the `if` condition itself) — but the **site
  count is unchanged**: 1 real caller (here) + 2 nav special-cases (Step 23). The three other sites
  design.md's round-3 originally flagged were re-verified by this feature's own fresh grep and found
  to already point at `/trader/positions/[symbol]` or `/trader/orders/[id]` (untouched routes) — no
  other repoint needed.
- Query-string forwarding requirement: the caller's `?strategy=${o.strategyId}` must survive the
  redirect hop (feeds `SignalReadiness`'s `?strategy=` seed on the destination page, per Step 10-12).

**TDD**: `N/A (docs/routing — no assertable unit; proven by Step 25's e2e)` — this is a structural
routing change with a Playwright behavioral test in Step 25, so treat it as `red-green required`
against that later step's assertions rather than a standalone unit proof.

**Instructions**:
1. Replace the entire contents of `insights/market/[symbol]/page.tsx` with an unconditional Server
   Component `redirect()` to `/trader/positions/[symbol]`, forwarding the full incoming query string
   verbatim (read `params.symbol` and the request's search params — for an App Router page component,
   read `searchParams` prop and rebuild the query string, or use `redirect()` with the constructed
   target URL including `?strategy=...` when present). Delete every other symbol/import from the
   file — this becomes a redirect-only stub, mirroring `app/page.tsx`'s minimalism.
2. In `opportunities/page.tsx`, change the link-target construction at lines 140-141 (re-verified
   post-feature-124; shifted from the original `129-130` citation) from `/insights/market/${o.symbol}`
   (and its `?strategy=` variant) to `/trader/positions/${o.symbol}`, preserving the same
   `?strategy=${o.strategyId}` conditional query-string logic unchanged.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm lint
grep -rn "insights/market" src --include=*.tsx --include=*.ts
```
Confirm the grep now returns only the two nav-file comment/check lines (removed in Step 23) and the
redirect target's own internal reference, if any — no remaining link construction pointing at the
old path as a destination.

---

### Step 23 — service (xstockstrat-ui): nav cleanup — delete `/insights/market` special-cases

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/shared/PlatformHeader.tsx` — modify
- `services/xstockstrat-ui/src/components/mobile/BottomTabBar.tsx` — modify

**Reviewers**: `xstockstrat-ui` (service owner) — C-10(a), confirms **both** desktop and mobile
surfaces are updated together (the exact class of gap `fails.md` 2026-08-05
`shadcn-migration-high-confidence` and this repo's nav-reachability convention exist to catch)

**Codebase Evidence**:
- Desktop special-case confirmed at `PlatformHeader.tsx:103-104` (re-verified post-feature-124;
  shifted from the original `106-107` citation):
  ```tsx
  // Dynamic Decide routes (e.g. /insights/market/[symbol]) resolve to the Decide group.
  if (pathname?.startsWith('/insights/market')) return { group: NAV_GROUPS[0] };
  ```
  inside `resolveActive` (function spans lines 98-106, shifted from `101-109`).
- Mobile special-case confirmed at `BottomTabBar.tsx:18-20`:
  ```tsx
  // Signal detail lives under /insights/market — it belongs to Decide (mirrors the desktop shell).
  if (pathname.startsWith('/insights/market'))
    return hrefs.some((h) => h.includes('/opportunities'));
  ```
  inside `isGroupActive` (function spans lines 16-24).
- `book`'s existing `PLATFORM_SUBNAV`/`NAV_GROUPS` registration for `/trader/positions`
  (`navGroups.tsx:65`) is confirmed already correct and needs no change — `resolveActive`'s default
  fallthrough (`return { group: NAV_GROUPS[0] }`, the final line of the function) and
  `isItemActive`'s prefix-match already resolve `/trader/positions/[symbol]` to the `book` group via
  the plain `NAV_GROUPS` walk, once the `/insights/market` special-case stops intercepting it first —
  no new registration needed, only deletion of the now-redundant special-case.

**TDD**: `N/A` — proven by Step 24's e2e assertion, same reasoning as Step 22.

**Instructions**:
1. Delete the `if (pathname?.startsWith('/insights/market')) return { group: NAV_GROUPS[0] };` line
   and its preceding comment from `resolveActive` in `PlatformHeader.tsx` (lines 103-104, re-verified
   post-feature-124; shifted from the original `106-107` citation).
2. Delete the equivalent block from `isGroupActive` in `BottomTabBar.tsx` (lines 18-20) — after
   deletion, `isGroupActive`'s remaining `return hrefs.some(...)` logic (lines 21-23) is unchanged and
   already handles `/trader/positions/[symbol]` correctly (it's a `book`-group href).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm lint
grep -n "insights/market" src/components/shared/PlatformHeader.tsx src/components/mobile/BottomTabBar.tsx
```
Confirm both grep calls return no hits (the special-cases and their comments are fully removed).

---

### Step 24 — test (xstockstrat-ui): two-surface nav-reachability proof

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/nav-reachability.spec.ts` — modify

**Reviewers**: `xstockstrat-ui` (service owner)

**Codebase Evidence** (re-verified fresh — feature 124 already changed this file's own assertion
mechanism, not just line numbers; the original citation below is corrected, not merely renumbered):
- Existing file confirmed **92 lines** (not the originally-cited 75), one `test.describe('nav
  reachability', ...)` with a single test, desktop-only. Its own docblock (lines 4-18) explains why:
  **feature 124 (FR-10a) already removed the shared `PlatformHeader`-level `Breadcrumb` landmark**
  this spec's original `getByLabel('Breadcrumb')` locator depended on (moved into each page's own
  `PageBreadcrumb`, FR-10b) — the file's assertions were **already rewritten by feature 124** to use
  `aria-current="page"` on the `Primary`/`Section` nav links instead, per design.md's own Round 4
  resolution (a case where a sibling feature's design anticipated and pre-solved this exact gap).
  **This step therefore does not need to invent a new assertion mechanism** — only apply the
  already-established `aria-current` pattern to the new route.
- Current mechanism (lines 59-90): `primary = page.getByRole('navigation', { name: 'Primary' })`,
  `section = page.getByRole('navigation', { name: 'Section' })`; for each `GROUPS` entry, click the
  `Primary` tab link, assert `aria-current="page"` on it, then for each item click the `Section` link
  and assert `aria-current="page"` on both the item and its parent tab.
- The `GROUPS` array (lines 21-57) drives the walk via **static nav-menu items only** — `book`'s
  entries are `Exposure` (`/trader/positions`), `Portfolio` (`/trader/portfolio`), `Orders`
  (`/trader/orders`). There is no nav-menu item for a dynamic route like
  `/trader/positions/[symbol]` (nav links only reach list pages) — proving this feature's new route
  resolves to the `book` group requires a **direct navigation** + `aria-current` assertion, not a
  simulated nav-menu click, since no menu link points at it.
- `BottomTabBar` confirmed `sm:hidden` (only rendered/visible below the `sm` breakpoint) with
  `data-testid="mobile-tab-bar"` (`BottomTabBar.tsx:36`) and per-tab `aria-current="page"` when
  active (`BottomTabBar.tsx:53`) — both re-verified unaffected by feature 124.
- No dedicated mobile-viewport Playwright project exists in `playwright.config.ts` (confirmed —
  only `Desktop Chrome`/`Desktop Firefox` devices registered) — a mobile assertion must set its own
  viewport inline via `page.setViewportSize(...)`.

**TDD**: `red-green required` (paired with Step 23; run against the pre-Step-23 tree first to
confirm this new test would have failed if the old special-case still short-circuited the mobile
active-state check for a `book`-group route reached via a symbol page — though the specific failure
mode is subtle since the old special-case only intercepted `/insights/market`, not
`/trader/positions/[symbol]`; the real regression risk this test guards is a **future** re-addition
of a similar special-case, or the Step 23 deletion being applied to only one of the two files).

**Instructions**:
Add a new test asserting `/trader/positions/AAPL` resolves to the `book` group on **both** surfaces
in the same test run, using the file's own already-established `aria-current` mechanism (do not
reintroduce a `getByLabel('Breadcrumb')` locator — that landmark no longer exists, feature 124):
- Desktop (default viewport): navigate directly to `/trader/positions/AAPL` (no nav-menu item exists
  for a dynamic route, so this is a direct `page.goto`, not a simulated click), assert
  `page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Book', exact: true })`
  has `aria-current="page"`.
- Mobile: `page.setViewportSize({ width: 375, height: 800 })` (below the Tailwind `sm` 640px
  breakpoint), reload/re-navigate to `/trader/positions/AAPL`, assert
  `page.getByTestId('mobile-tab-bar').getByRole('link', { name: 'Book' })` has `aria-current="page"`.

Also assert `/insights/market/AAPL` (now a redirect, Step 22) lands on `/trader/positions/AAPL`
(`await expect(page).toHaveURL(/\/trader\/positions\/AAPL/)`), proving the redirect + the deleted
nav special-case together leave the destination correctly classified.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm test:e2e -g "nav reachability"
```

---

### Step 25 — test (xstockstrat-ui): relocate/rewrite `signal-detail.spec.ts`

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/insights/signal-detail.spec.ts` — delete
- `services/xstockstrat-ui/e2e/trader/position-detail.spec.ts` — modify

**Reviewers**: `xstockstrat-ui` (service owner)

**Codebase Evidence**:
- `signal-detail.spec.ts` confirmed **59 lines** (re-verified post-feature-124; shifted from the
  originally-cited 55), 3 tests, full read — nearly every assertion targets page-shell markup unique
  to the now-deleted `insights/market/[symbol]/page.tsx`: the "Queue" back-link (`getByRole('link', {
  name: /Queue/ })`), the header's "Conviction"/"Edge (BT)" stat labels, `getByText('2/3 conditions')`
  (readiness conviction, which **does** still exist — `SignalReadiness.tsx:80-82`, shifted from the
  originally-cited `79-81` — since that component is reused unchanged), the strategy-track-record
  block (`getByTestId('strategy-track-record')`, also unchanged — same component). Per design.md's
  Open Risk, this is genuinely "move and rewrite," not "re-run": the Queue back-link and
  CONVICTION/EDGE header stats are page-shell chrome that does not exist in this form on
  `/trader/positions/[symbol]` (which has its own different header, built in Steps 8/12), while the
  `SignalReadiness`-internal assertions (conditions count, traced leaves, strategy picker,
  track-record) transfer directly since the component itself is reused verbatim.

**TDD**: `red-green required` (each transferred assertion must be proven against the new route, not
assumed to still pass; the ones that reference now-nonexistent page-shell markup must be dropped or
rewritten against Step 8/12's actual replacement markup, not silently ported).

**Instructions**:
1. Delete `e2e/insights/signal-detail.spec.ts`.
2. Add its content to `position-detail.spec.ts`, rewritten:
   - The readiness-content assertions (conditions count, traced leaf names `sma_fast`/`rsi`, strategy
     picker showing the threaded strategy name, the strategy-track-record block's metrics) port
     directly, navigating to `/trader/positions/AAPL?strategy=strat-live-001` instead of
     `/insights/market/AAPL?strategy=strat-live-001`.
   - The "no strategy threaded" and "picker excludes non-live strategies" tests port directly (same
     `SignalReadiness` behavior, new URL).
   - The Queue back-link and CONVICTION/EDGE header-stat assertions are **dropped** — that markup
     belongs to the deleted page's header, not the new one; if Step 12's Opportunity section renders
     an equivalent conviction display, assert against *that* markup instead (a new locator, not a
     ported one), rather than silently losing conviction-display coverage. Confirm at execute time
     whether Step 12's Opportunity section is the natural place for this assertion or whether it
     duplicates a test already added in Step 13 — if so, don't duplicate, cite the existing coverage
     instead.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm test:e2e -g "Single Position page"
ls e2e/insights/signal-detail.spec.ts 2>&1  # expect "No such file or directory"
```

---

### Step 26 — test (xstockstrat-ui): three-way valuation parity

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/trader/valuation-parity.spec.ts` — modify

**Reviewers**: `xstockstrat-ui` (service owner) — C-10(b)

**Codebase Evidence**:
- Full file confirmed (30 lines): `test.describe('AC-8 valuation parity', ...)` currently asserts
  AAPL's `+$100.00` unrealized P&L is identical on `/trader/portfolio` (`PORTFOLIO_ALPACA`) and
  `/trader/positions` (`POSITIONS`/`POSITION_AAPL`) — two read paths. FR-14 requires this feature add
  a **third**: `/trader/positions/AAPL` (this feature's own unified page), which already shows
  `position.unrealizedPnl` (re-verified post-feature-124 at `positions/[symbol]/page.tsx:248-256`,
  target text render at line 251 — shifted from the originally-cited `253-258`; unchanged by Step 8's
  refactor either way, since that header block stays inside the position-gated `PositionBody`).
  A second instance also exists in the stat-tile grid (`StatTile` at line 277) — the e2e's
  `.first()` pattern (Instructions below) already accounts for multiple on-page matches.

**TDD**: `red-green required` — this test would already pass today for the pre-125 `/trader/positions/
[symbol]` page (096 already ties to the same `GetPosition` fixture), so red-before-green here means:
run it against the pre-Step-8 tree to confirm the assertion passes for the *right* reason (the
existing single-position page), then confirm it still passes after Steps 5-6, 8-26 (proving the
`GetPosition` `account_id` fix and every structural refactor never broke parity) — a regression guard,
not a new-feature proof, so "red" here is interpreted as "this step adds the missing third assertion
that did not previously exist," per P-06's spirit even where the underlying data path is unchanged.

**Instructions**:
Add a third assertion to the existing test: after the Exposure-list check, navigate to
`/trader/positions/AAPL` and assert the same `+$100.00` unrealized P&L text is visible, using the
same `getByText('+$100.00').first()` pattern `position-detail.spec.ts:25` already establishes for
this exact route. Keep the existing two assertions (Portfolio, Exposure) unchanged — this step only
adds the third leg, never rewrites the existing two.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm test:e2e -g "AC-8 valuation parity"
```

---

### Step 27 — proto: additive `GetIndicatorSeries` RPC + messages for FR-6 overlay panels

**Status**: `pending`
**Service**: `packages/proto`
**Files**:
- `packages/proto/analysis/v1/analysis.proto` — modify

**Reviewers**: Proto Reviewer — field number uniqueness per message, `import` correctness, `buf lint`/
`buf breaking` pass, additive/non-breaking; `xstockstrat-analysis` (service owner) — confirms the new
messages match what the handler (Step 30) populates from `_compute_component`'s output;
`xstockstrat-ui` (consumer) — confirms the request/response shapes serve the stacked overlay panels

**Codebase Evidence**:
- `service AnalysisService` spans lines 12-42; the last RPC is `GetStrategyAnalytics` at line 41 —
  the new `rpc GetIndicatorSeries(...)` is appended after it, before the service's closing `}`
  (confirmed via `grep -n "^service AnalysisService\|^}" packages/proto/analysis/v1/analysis.proto`
  and the RPC listing above).
- Existing imports are lines 7-10 (`google/protobuf/timestamp.proto`, `struct.proto`,
  `field_mask.proto`, `common/v1/common.proto`) — `google/protobuf/wrappers.proto` is **not** among
  them (confirmed via `grep -n "wrappers.proto" packages/proto/analysis/v1/analysis.proto` → no hit);
  it must be added for `google.protobuf.DoubleValue`.
- `StrategyComponent` (lines 241-247) carries `ref_name`/`kind`/`indicator`/`formula_id`/`params`;
  `ComponentKind` is the existing enum used at `StrategyComponent.kind = 2` (line 243) — reused
  directly for `ComponentSeries.kind`, not redefined.
- `StrategyDefinition.components` (line 252, `repeated StrategyComponent components = 3`) is the list
  the handler iterates — confirming the response's one-`ComponentSeries`-per-declared-component shape.
- design.md § "Design Addendum — FR-6" § "Response shape" gives the exact message set and the reason
  for `DoubleValue` over `repeated double` (null-safety for warm-up/gap points — AC-4a/P-03) and over
  a parallel present-mask.
- `Bar.time` confirmed as `google.protobuf.Timestamp time = 2`
  (`packages/proto/marketdata/v1/marketdata.proto:46`) — **resolves design.md's FR-6 Open Risk**
  ("confirm the `Bar` timestamp attribute name"): the generated TS/Python field is `time`, not
  `timestamp`; the UI reads `bar.time` to populate the request `times`, and the request/response
  `times` are `repeated google.protobuf.Timestamp`.

**TDD**: `N/A (proto)` — no code executes; verified by `buf lint`/`buf breaking`.

**Instructions**:
1. Add the wrappers import alongside the existing imports (after line 9's `field_mask.proto`, keeping
   import grouping):
   ```protobuf
   import "google/protobuf/wrappers.proto";
   ```
2. Add the RPC to `service AnalysisService`, after the `GetStrategyAnalytics` RPC (line 41), before
   the service's closing `}`:
   ```protobuf
   // Per-component historical indicator series for a strategy over a caller-supplied bar window,
   // for the unified Symbol page's overlay panels (feature 125, FR-6). Reuses the analysis
   // evaluator's own _compute_component per declared component in a dedicated handler loop — never
   // the shared evaluate_conditions_traced (which ListOpportunities' exit trace depends on).
   rpc GetIndicatorSeries(GetIndicatorSeriesRequest) returns (GetIndicatorSeriesResponse);
   ```
3. Add the four new messages near the other `Analytics`/`Readiness` messages at the end of the file
   (after `GetStrategyAnalyticsRequest`, line 530, is a natural home — keep them contiguous):
   ```protobuf
   message GetIndicatorSeriesRequest {
     string strategy_id = 1;
     string symbol = 2;
     // The caller's own already-fetched candlestick closes + their timestamps (the page passes the
     // exact bars it drew, so the x-axis is parity-aligned and no server re-fetch happens). closes
     // and times are index-aligned and equal length.
     repeated double closes = 3;
     repeated google.protobuf.Timestamp times = 4;
   }

   message GetIndicatorSeriesResponse {
     // Echoes the request times, index-aligned across every series in every component.
     repeated google.protobuf.Timestamp times = 1;
     repeated ComponentSeries components = 2;
   }

   message ComponentSeries {
     string ref_name = 1;
     ComponentKind kind = 2;
     repeated NamedSeries series = 3;
     // Non-empty when this component failed to compute (soft-deleted formula, sandbox timeout, NaN
     // output); series is then empty and the UI renders a per-panel error state. Per-component fault
     // isolation — one bad component never fails the whole RPC.
     string error = 4;
   }

   message NamedSeries {
     // "value" (primary) plus each secondary the component emits (bb.upper/bb.lower,
     // macd.signal/macd.histogram, stoch.d, or custom-formula output keys).
     string name = 1;
     // DoubleValue (not repeated double) so a warm-up-head or mid-series None round-trips as an unset
     // value, never a fabricated 0.0 (feature 125, AC-4a/P-03). Index-aligned with the response times.
     repeated google.protobuf.DoubleValue values = 2;
   }
   ```
   Field numbers restart per message (all new messages) — no collision with any existing message.
   Do not touch `ScreenResult` (Step 1's change) or any other message.

**Verification**:
```bash
cd packages/proto && buf lint
buf breaking --against ".git#branch=main-dev"
```
Both must pass (additive-only — new RPC + new messages + new import, no field removed or retyped, no
breaking diff expected).

---

### Step 28 — proto-gen: regenerate stubs for `GetIndicatorSeries`

**Status**: `pending`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/go/analysis/v1/` — modify (generated)
- `packages/proto/gen/python/analysis/v1/` — modify (generated)
- `packages/proto/gen/ts/analysis/v1/` — modify (generated)

**Reviewers**: Proto Reviewer — inherited from Step 27

**Codebase Evidence**:
- root `CLAUDE.md` § Generating Proto Stubs: `./scripts/buf-gen.sh` regenerates all three languages.
- The new messages use `google.protobuf.DoubleValue`/`Timestamp` — both are well-known types already
  resolvable by the existing buf toolchain (Step 27 adds only the `wrappers.proto` import, a WKT that
  needs no BSR/dependency change).

**TDD**: `N/A (proto-gen)`

**Instructions**:
Run `./scripts/buf-gen.sh` from repo root. Commit the proto source change (Step 27) and the
regenerated stub diff together in this step's commit, per
`docs/runbooks/codegen-toolchain-host-setup.md` if Docker/GitHub-releases egress is unavailable in
the execution environment.

**Verification**:
```bash
./scripts/buf-gen.sh
git diff --stat packages/proto/gen/
```
Confirm the diff touches only `analysis/v1/` generated files (new `GetIndicatorSeriesRequest`/
`GetIndicatorSeriesResponse`/`ComponentSeries`/`NamedSeries` types + the `getIndicatorSeries` client/
server method on all three languages) and nothing else. Re-run `./scripts/buf-gen.sh` and confirm
`git diff packages/proto/gen/` is empty (idempotent regeneration).

---

### Step 29 — config: register `analysis.series.max_concurrent_components`

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/CLAUDE.md` — modify (§ Config Keys Consumed)
- `docs/patterns/config-governance.md` — modify (Per-Feature Registered Keys log)

**Reviewers**: `xstockstrat-analysis` (service owner) — per reviewer-registry §governance matrix,
`config` steps are reviewed by "Service owner of the service adding/changing the config key"

**Codebase Evidence**:
- `services/xstockstrat-analysis/CLAUDE.md:150` (`## Config Keys Consumed`, `Namespace: analysis`) is
  the § the new key row joins; the sibling semaphore key
  `analysis.screener.max_concurrent_formula_evals` (int, default `4`) is already listed there
  (line 176) — the new key mirrors its shape and description.
- `docs/patterns/config-governance.md:76` (`## Per-Feature Registered Keys`, append-only, newest
  first) — the feature-129 entry (lines 80-95) is the format template: a `### feature NNN — <slug>
  (<service>)` heading, a short prose paragraph, then a `| Key | Type | Default | Description |`
  table.
- design.md § "Design Addendum — FR-6" § "Concurrency": the key bounds **cross-request** concurrency
  of per-component `ComputeIndicator`/`ExecuteFormula` execution (a process-lifetime singleton
  semaphore in `AnalysisServicer.__init__`), read via `cfg.get_int(...)` with a mandatory `max(1, …)`
  clamp — chosen category `analysis.series.*` (not `analysis.readiness.*`, not `analysis.indicators.*`).

**TDD**: `N/A (config docs)`

**Instructions**:
1. In `services/xstockstrat-analysis/CLAUDE.md`'s `## Config Keys Consumed` table, add a row (grouped
   with the other semaphore/limit keys):
   ```
   | `analysis.series.max_concurrent_components` | int | `4` | Process-lifetime singleton semaphore bounding cross-request concurrency of per-component `ComputeIndicator`/`ExecuteFormula` execution driven by `GetIndicatorSeries` (feature 125, FR-6), so a routinely-visited Symbol page can't starve the analysis live loop — mirrors `analysis.screener.max_concurrent_formula_evals`. Read once in `AnalysisServicer.__init__` via `get_int` with a `max(1, …)` clamp (a `0` reads as the default 4 via `get_int`'s zero-trap; the clamp guards a negative value from reaching `asyncio.Semaphore`). |
   ```
2. In `docs/patterns/config-governance.md`'s `## Per-Feature Registered Keys` log, add a **new entry
   at the top** (newest first — above the feature-129 entry), matching the feature-129 format:
   ```markdown
   ### feature 125 — unified-symbol-page (`xstockstrat-analysis`)

   Adds one process-lifetime singleton semaphore key for the FR-6 indicator-overlay-panel RPC
   `GetIndicatorSeries`. New `analysis.series.*` category (distinct from `analysis.readiness.*` — this
   is not readiness — and from the `xstockstrat-indicators` service's own `indicators.sandbox.*`
   namespace). Read once at servicer construction, not live.

   | Key | Type | Default | Description |
   |---|---|---|---|
   | `analysis.series.max_concurrent_components` | int | `4` | Bounds concurrent per-component `ComputeIndicator`/`ExecuteFormula` execution across simultaneous `GetIndicatorSeries` calls, so a routinely-visited Symbol page can't starve the analysis live loop. `max(1, get_int(...))` clamp. |
   ```

**Verification**:
```bash
grep -n "analysis.series.max_concurrent_components" services/xstockstrat-analysis/CLAUDE.md docs/patterns/config-governance.md
grep -n "feature 125 — unified-symbol-page" docs/patterns/config-governance.md
```
Confirm the key appears in both files. This step edits a service `CLAUDE.md` and a context doc listed
in scrubber targets — run the mandated Teardown scan (root `CLAUDE.md` § Teardown): `/context-scrubber
scan`, scoped to these two files, and fix any grounded findings before marking done (or record the
plugin's unavailability explicitly, per Step 7's precedent).

---

### Step 30 — service (xstockstrat-analysis): `GetIndicatorSeries` handler

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify

**Reviewers**: `xstockstrat-analysis` (service owner) — backtest reproducibility / strategy scoring
determinism / no look-ahead bias; confirms the new handler's loop reuses `_compute_component` in its
**own** method (never the shared `evaluate_conditions_traced`), so launched feature 097's
`ListOpportunities` exit trace is structurally untouched

**Codebase Evidence**:
- `EvaluateReadiness` handler confirmed at `servicer.py:1959` — the proven skeleton this handler
  reuses (re-read fresh): builds `propagation_meta` from `context.invocation_metadata()` filtered to
  `("x-user-id", "x-access-scope", "x-trace-id")` (lines 1963-1967); guards
  `if self._strategies_repo is None:` → `context.abort(grpc.StatusCode.UNAVAILABLE, ...)` (1968-1970);
  `row = await self._strategies_repo.get_by_id(request.strategy_id)` then `if row is None:` →
  `context.abort(grpc.StatusCode.NOT_FOUND, ...)` (1971-1976); `definition =
  _row_to_strategy_definition(row)` (1977); `evaluator = StrategyEvaluator(self._indicators,
  propagation_meta)` (1978). The new handler reuses all of this verbatim, then **diverges**: instead
  of `evaluate_conditions_traced`, it loops over `definition.components` calling
  `evaluator._compute_component(comp, closes)`.
- `StrategyEvaluator._compute_component(comp, closes)` confirmed at `app/services/evaluator.py:215`
  — returns `dict[str, list[float | None]]` (the `series_map`: `"value"` primary + secondaries like
  `bb.upper`, `macd.signal`, `stoch.d`, or custom-formula output keys). Consumes **only** `closes`
  (builtin path passes `values=closes`; custom-formula path builds `input_data` from `{"close":
  closes}` only) — verified, so the client-supplied candlestick closes are sufficient input, no bar
  re-fetch.
- `FormulaExecutionError` confirmed at `evaluator.py:27` — raised by `_compute_component` (lines
  254/267/279/288) on a failed/soft-deleted/NaN custom formula; the per-component `try/except` catches
  this (and any `Exception`) to populate `ComponentSeries.error`.
- `_finite_or_none` confirmed at `evaluator.py:39` (maps `None`/`NaN`/`Inf`/non-numeric → `None`) and
  `align_indicator_points` at `evaluator.py:295` (builtin warm-up head is `[None]*n`, tail-filled) —
  the two sources of the `None` values the handler must encode as **unset** `DoubleValue`, never
  `0.0`.
- Semaphore pattern to mirror confirmed at `screener.py:84-85`:
  `self._sem = asyncio.Semaphore(max(1, cfg.get_int("analysis.screener.max_concurrent_formula_evals",
  4)))`. `AnalysisServicer.__init__` at `servicer.py:117` (self._cfg at 129, self._indicators at 131,
  self._strategies_repo at 150) is where the new `self._component_series_sem` is constructed once
  (boot-once confirmed via the recon's `main.py:59-69` citation).
- Header propagation (§B code-quality constraint): the handler makes new outbound
  `ComputeIndicator`/`ExecuteFormula` calls **only transitively** via `StrategyEvaluator`, which is
  constructed with `propagation_meta` and forwards it on every stub call (the same mechanism
  `EvaluateReadiness` uses at `servicer.py:1978`; Python per-method `metadata=` propagation per
  `docs/patterns/header-propagation.md`). No new direct stub call is added in this handler — it reuses
  the propagating `StrategyEvaluator`, so the three headers are carried.

**TDD**: `red-green required`

**Instructions**:
1. In `AnalysisServicer.__init__` (`servicer.py:117-`), after the existing `self._cfg`/
   `self._indicators`/`self._strategies_repo` assignments, construct the singleton semaphore:
   ```python
   self._component_series_sem = asyncio.Semaphore(
       max(1, self._cfg.get_int("analysis.series.max_concurrent_components", 4))
   )
   ```
   (Confirm `asyncio` is already imported in this module — `screener.py` imports it for the same
   pattern; add the import to `servicer.py` only if a grep shows it absent.)
2. Add a new `async def GetIndicatorSeries(self, request, context):` handler method, peer to
   `EvaluateReadiness`. Reuse `EvaluateReadiness`'s skeleton verbatim through the `evaluator =
   StrategyEvaluator(self._indicators, propagation_meta)` line: build `propagation_meta`; guard
   `self._strategies_repo is None` → `UNAVAILABLE`; `get_by_id(request.strategy_id)` → `None` →
   `NOT_FOUND`; `definition = _row_to_strategy_definition(row)`; instantiate the evaluator.
3. Then loop over `definition.components`, computing each component's series under the semaphore, with
   per-component fault isolation:
   ```python
   closes = list(request.closes)
   component_series = []
   for comp in definition.components:
       try:
           async with self._component_series_sem:
               series_map = await evaluator._compute_component(comp, closes)
           named = [
               analysis_pb2.NamedSeries(
                   name=name,
                   values=[
                       google_dot_protobuf_dot_wrappers__pb2.DoubleValue(value=v)
                       if v is not None else google_dot_protobuf_dot_wrappers__pb2.DoubleValue()
                       for v in series
                   ],
               )
               for name, series in series_map.items()
           ]
           component_series.append(
               analysis_pb2.ComponentSeries(ref_name=comp.ref_name, kind=comp.kind, series=named)
           )
       except Exception as e:  # per-component fault isolation (catches FormulaExecutionError + any sandbox/RPC error; broad by design)
           component_series.append(
               analysis_pb2.ComponentSeries(ref_name=comp.ref_name, kind=comp.kind, error=str(e))
           )
   return analysis_pb2.GetIndicatorSeriesResponse(times=request.times, components=component_series)
   ```
   - **`None` → unset `DoubleValue`, finite float → `DoubleValue(value=x)`** — this is the AC-4a/P-03
     no-fabricated-`0.0` guarantee. Use the module's actual generated `DoubleValue` symbol (confirm
     the import alias `google_dot_protobuf_dot_wrappers__pb2` — or however the regenerated stub names
     it — via a grep of the Step 28 output; do **not** guess the alias, cite the real one at execute
     time, F-04).
   - The `times` echoed back are `request.times` unchanged (server owns no per-point timestamps —
     `IndicatorPoint.time` is never set by the indicators service; the client's bar timestamps are the
     index-aligned x-axis).
   - The loop is **sequential** (no `asyncio.gather`), so the singleton semaphore bounds cross-request
     total in-flight compute, not intra-request.
4. Register the new handler if the servicer requires explicit method registration (it is a
   grpc.aio servicer method — confirm whether the generated `add_AnalysisServiceServicer_to_server`
   picks it up by name automatically, which it does for a method whose name matches the proto RPC;
   no manual registration line is typically needed — verify against how `EvaluateReadiness` is wired).

Do **not** touch `evaluate_conditions_traced`, `evaluate_with_series`, or any `StrategyEvaluator` call
site other than this new handler's own loop — the whole point of the dedicated handler (design.md's
round-2→3 reversal) is that its fault-isolation/semaphore live in its own method and cannot reach
`ListOpportunities`' shared trace path.

**Verification**:
```bash
cd services/xstockstrat-analysis && ruff check . && ruff format --check .
uv run pytest tests/test_analysis_servicer.py -k IndicatorSeries -v
```
Write the paired tests first (Step 31) so they fail against the pre-Step-30 tree
(`GetIndicatorSeries` unimplemented / `AttributeError`), then pass after this step.

---

### Step 31 — test (xstockstrat-analysis): parity, fault isolation, null-mapping

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_strategy_evaluator.py` — modify (evaluator-level parity
  invariant)
- `services/xstockstrat-analysis/tests/test_analysis_servicer.py` — modify (handler fault-isolation +
  null-mapping + response shape)

**Reviewers**: `xstockstrat-analysis` (service owner)

**Codebase Evidence**:
- `tests/test_strategy_evaluator.py` confirmed present — the existing home for `_compute_component`/
  alignment tests (it references `_compute_component`/`align_indicator_points` per
  `grep -rln "_compute_component" tests/`). The evaluator-level parity invariant test joins it (C-13:
  real engine logic, inline in the existing module — no new fixture home).
- `tests/test_analysis_servicer.py` confirmed present — the existing handler-level test home;
  fault-isolation + null-mapping + response-shape tests for `GetIndicatorSeries` join it.
- design.md § "Parity test — evaluator-level, not cross-RPC": the C-10(b) invariant is **"same
  `closes` → same series"**, proven deterministically at the evaluator/unit layer with a fixed
  `closes` fixture — **not** a cross-RPC assertion against `EvaluateReadiness`'s `lhsValue`, which is
  flaky by construction because `EvaluateReadiness` fetches its own differently-windowed bars
  (`servicer.py:1979,1983` via `_recent_range`/`_fetch_bars_paged`) while `GetIndicatorSeries` receives
  the client's `pageSize:200` closes — a path-dependent indicator (EMA/RSI/MACD/ATR) legitimately
  differs over different-length inputs.
- design.md § "Open Risks (FR-6)" names the three required paired tests explicitly (parity,
  fault-isolation, null→unset-DoubleValue).

**TDD**: `red-green required` (paired with Step 30; run against the pre-Step-30 tree first — the
handler doesn't exist, so the servicer tests error/fail — before Step 30 lands, per P-06).
**Which tests carry the RED gate**: the P-06 red-before-green proof rests on tests **2 and 3**
(handler fault-isolation + null→unset-`DoubleValue`), which cannot pass until Step 30's
`GetIndicatorSeries` handler exists — they must genuinely fail/error against the pre-Step-30 tree.
Test **1** (evaluator-level parity) exercises the pre-existing `_compute_component` and is expected
to pass pre-Step-30 — it is a regression/invariant guard, **not** the RED proof; do not treat its
green as satisfying P-06 for this step.

**Instructions**:
Add three tests:
1. **Evaluator-level parity invariant** (in `test_strategy_evaluator.py`): feed one fixed `closes`
   fixture through `_compute_component` for a component, and assert the series the handler would emit
   for that component equals what the same `_compute_component` call produces — i.e. that the
   handler's encoding is a faithful pass-through of the evaluator's output, discharging C-10(b)'s
   "same closes → same series" deterministically. (If the encoding helper is factored out of the
   handler it can be unit-tested directly here; otherwise assert on `_compute_component`'s output
   shape/values for the fixed input, matching how `evaluate_conditions_traced` is already tested in
   `test_evaluator_traced.py`.)
2. **Per-component fault isolation** (in `test_analysis_servicer.py`): a strategy whose components
   include one that raises `FormulaExecutionError` (e.g. a component whose `_compute_component` is
   stubbed/mocked to raise) alongside a healthy one — assert the response still succeeds, the failing
   component's `ComponentSeries` has a non-empty `error` and empty `series`, and the healthy
   component's `ComponentSeries` has its populated series. One bad component never fails the RPC.
3. **`None` → unset `DoubleValue` mapping** (in `test_analysis_servicer.py`): a component whose
   `_compute_component` output contains leading `None` warm-up values (and/or a mid-series `None`) —
   assert those positions round-trip as **unset** `DoubleValue` (no `value` set / `HasField` false),
   never `DoubleValue(value=0.0)`, proving the AC-4a no-fabricated-`0.0` guarantee. Assert a finite
   value maps to `DoubleValue(value=x)` with presence.

**Verification**:
```bash
cd services/xstockstrat-analysis && ruff check . && ruff format --check .
uv run pytest tests/test_strategy_evaluator.py tests/test_analysis_servicer.py --cov=app --cov-fail-under=40
```
Run once against the pre-Step-30 tree (confirm the servicer tests fail — handler absent), once after
(confirm green). Confirm overall coverage stays ≥40%.

---

### Step 32 — service (xstockstrat-ui): indicator overlay panels beneath the price chart

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/trader/positions/[symbol]/page.tsx` — modify
- `services/xstockstrat-ui/src/components/trader/IndicatorPanels.tsx` — create
- `services/xstockstrat-ui/src/hooks/useIndicatorSeries.ts` — create (or co-locate; decide by
  file-size precedent at execute time, matching the `useBackfills.ts`/`useOpportunities.ts`
  per-domain-hook convention)

**Reviewers**: `xstockstrat-ui` (service owner) — Trading UI correctness, analytics display accuracy,
Connect-RPC call safety, no fabricated data (P-03); `xstockstrat-indicators` (FYI) — reached only
transitively through the new analysis RPC, no service-side change

**Codebase Evidence**:
- `useGetStrategy(strategyId?)` confirmed at `hooks/useStrategyDefinitions.ts:25-28` — calls
  `analysisClient.getStrategy({ strategyId })` (the cross-segment `/insights/api` browser client,
  covered by Step 7's sanctioned exception), returning the full `StrategyDefinition` including
  `components`. This is the source of the resolved strategy's declared components to chart. (Note: it
  lives in `useStrategyDefinitions.ts`, **not** `useStrategies.ts`.)
- `analysisClient` browser client bound to `/insights/api` confirmed at
  `src/lib/browserClients/analysisClient.ts:5` — the same client `useGetStrategy` already uses; the
  new `getIndicatorSeries` browser call reuses it directly (no new `traderBff.ts` registration —
  Step 7's exception), matching how every other cross-segment section on this page calls analysis.
- Bars are fetched but **discarded** today: `page.tsx:86-96` — `.getBars({ ... page: { pageSize: 200 }
  })` then `series.setData(mapBars(res.bars))` at line 96, with only `barsError` retained in state
  (line 73). This step adds new state to **retain** the fetched bars' `close` + `time` for the RPC
  request (design.md § "Bar source" — the page must add small new state; the candlestick's own closes
  +times feed the panels, structural x-axis parity, no second fetch). `Bar.time` is the timestamp
  field (Step 27 evidence).
- Stacked-panels rendering precedent confirmed: `components/insights/FormulaRunResult.tsx` uses
  `import { Line, LineChart, XAxis, YAxis } from 'recharts'` + `ChartContainer` from
  `@/components/ui/chart` (lines 2, 5) — one independent chart per output series, each its own axis
  domain (design.md cites `:43-88`). The new `IndicatorPanels` follows this exact pattern: one
  `ChartContainer`+`LineChart` panel per `ComponentSeries`, drawing every `NamedSeries` as its own
  `<Line>`. **Not** a `lightweight-charts` second pane (the `useCandlestickChart` hook has no
  sub-pane/second-series API — recon: zero `addLineSeries`/`priceScaleId` usage anywhere).
- `isLoading` skeleton gating precedent: `SignalReadiness.tsx:64-71`'s per-section pattern (no
  Suspense — `useSuspenseQuery` has zero usages in the codebase, recon).
- Strategy resolution: the FR-6 strategy follows the same precedence as Readiness/Backtests — the
  watchlist-binding `strategyId` (Step 12's derived `boundStrategyId`), else the picker's current
  selection. Reuse Step 12's already-computed binding output; no new resolution logic.

**TDD**: `red-green required`

**Instructions**:
1. **Retain the fetched bars.** In `page.tsx`'s bars-fetch effect (lines 86-96, at/after Step 8's
   top-level hoist of this effect), capture the fetched bars into new state — e.g. `const [barSeries,
   setBarSeries] = useState<{ closes: number[]; times: Timestamp[] }>(...)` — alongside the existing
   `series.setData(...)` call, so the closes and their `time` timestamps survive for the RPC request.
   Do not add a second `getBars` call — reuse the one already firing (design.md: no second bars fetch).
2. Create `hooks/useIndicatorSeries.ts` — a query hook calling
   `analysisClient.getIndicatorSeries({ strategyId, symbol, closes, times })` (cross-segment browser
   client per Step 7's exception), `enabled` only when a resolved `strategyId`, a non-empty `closes`
   array, and a non-empty `times` array are all present. Returns the `components` array + loading/error.
3. Create `components/trader/IndicatorPanels.tsx` (`{ components: ComponentSeries[]; times: Timestamp[]
   }` prop) rendering one stacked `ChartContainer`+`LineChart` panel per `ComponentSeries`, following
   `FormulaRunResult.tsx`'s pattern:
   - Each panel draws every `NamedSeries` in that component as its own `<Line>` (primary `value` +
     secondaries like `bb.upper`/`macd.signal`/`stoch.d`) — no sub-series dropped (FR-12/P-03).
   - **Warm-up/gap points**: a `NamedSeries.values[i]` that is an **unset** `DoubleValue` (no `value`
     presence) is rendered as a gap (recharts `null`/`connectNulls={false}`), never plotted as `0`
     (AC-4a — this is the whole reason the wire type is `DoubleValue`). Read presence via the
     generated getter, not `?? 0`.
   - A `ComponentSeries` with a non-empty `error` renders a per-panel error/no-data state instead of
     a chart (per-component fault isolation surfaced to the UI).
4. In `page.tsx`, mount `<IndicatorPanels ... />` **beneath the hoisted price chart** (Step 8's
   top-level chart `Card`), gated: resolve the FR-6 strategy id (Step 12's `boundStrategyId`, else the
   picker selection); if none resolves, or `useGetStrategy` returns a strategy with **zero**
   `components`, render an explicit no-data state (no fabricated panels — P-03), never call the RPC
   with an empty strategy. When resolved, call `useGetStrategy(strategyId)` for `components` presence
   and `useIndicatorSeries({ strategyId, symbol, closes, times })` for the series; `isLoading` shows a
   skeleton (SignalReadiness pattern, no Suspense).

Cross-cutting code-quality (§B): this step adds new outbound gRPC calls (`getIndicatorSeries`,
`getStrategy`) but only from the **browser** via `analysisClient` — header propagation is the
BFF/edge's concern (the browser client hits `/insights/api`, and `bffShared.ts`'s dispatch +
`backendHeaders` inject the C-03 tuple server-side, same as every other section's browser call on this
page); no new server-side propagation code is added here. Test-data (C-12): the e2e fixture for the
new RPC response is added in Step 33's paired test (a new `e2e/fixtures/indicatorSeries.ts` module +
`INVENTORY.md` row — a second consumer, `mock-backend.ts` + the spec, exists on day one).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm lint
grep -n "getIndicatorSeries" src/hooks/useIndicatorSeries.ts
grep -n "connectNulls\|hasValue\|\.value\b" src/components/trader/IndicatorPanels.tsx  # confirm no `?? 0` fabrication of gaps
```
Plus the e2e proof in Step 33.

---

### Step 33 — test (xstockstrat-ui): indicator overlay panels e2e

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/mock-backend.ts` — modify (add a `getIndicatorSeries` handler to the
  `AnalysisService` router registration — confirmed absent; grep `getIndicatorSeries` in
  `mock-backend.ts` returns zero hits at execute time)
- `services/xstockstrat-ui/e2e/fixtures/indicatorSeries.ts` — create
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify
- `services/xstockstrat-ui/e2e/trader/position-detail.spec.ts` — modify

**Reviewers**: `xstockstrat-ui` (service owner)

**Codebase Evidence**:
- `mock-backend.ts` registers an `AnalysisService` router already (it mocks `evaluateReadiness`,
  `screenSymbols`, `listBacktests`, etc. per earlier steps' evidence) — the new `getIndicatorSeries`
  handler joins that same registration block; confirm it's absent first (grep).
- `INVENTORY.md` has **no** indicator-series fixture (new domain object) — a canonical
  `e2e/fixtures/indicatorSeries.ts` module + catalog row is required (C-12), not an inline literal;
  the mock handler and this spec are its two consumers on day one.
- `useGetStrategy`'s mock: `getStrategy` on the `AnalysisService` mock must return a strategy whose
  `components` include at least one builtin and (optionally) one custom-formula component so the panel
  count is assertable — confirm whether an existing strategy fixture already carries `components` or
  whether this step extends one.

**TDD**: `red-green required` (paired with Step 32; run against the pre-Step-32 tree first — the
panels don't render — to confirm red).

**Instructions**:
1. Create `e2e/fixtures/indicatorSeries.ts` with a canonical `INDICATOR_SERIES_AAPL`
   `GetIndicatorSeriesResponse`-shaped object: a `times` array and ≥2 `ComponentSeries` — one with a
   multi-`NamedSeries` component (e.g. an `MACD` component emitting `value`/`macd.signal`/
   `macd.histogram`) whose leading values are **unset** `DoubleValue`s (warm-up), and one with a
   non-empty `error` (the fault-isolation case). Register it in `INVENTORY.md`'s Canonical fixtures
   table in the same step (C-12).
2. Add a `getIndicatorSeries` handler to `mock-backend.ts`'s `AnalysisService` registration returning
   `INDICATOR_SERIES_AAPL` for a watchlisted `AAPL` visit (with a resolvable strategy), and ensure the
   `getStrategy` mock returns a matching-`components` strategy for that symbol's resolved strategy id.
3. Add tests to `position-detail.spec.ts` (the `Single Position page` describe block): on a
   watchlisted `AAPL` with a resolved strategy, assert one panel renders per `ComponentSeries` beneath
   the price chart, the multi-series component shows all its named lines, the errored component shows
   its per-panel error state (not a chart), and the warm-up gap is not rendered as a `0`-valued point
   (assert against the panel's rendered points / that no fabricated zero appears). Add a no-data test:
   a resolved strategy with zero `components` (or an unresolvable strategy) shows the explicit no-data
   state and the RPC is not called.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm test:e2e -g "Single Position page"
```
Run once against the pre-Step-32 tree (confirm red), once after (confirm green).

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._

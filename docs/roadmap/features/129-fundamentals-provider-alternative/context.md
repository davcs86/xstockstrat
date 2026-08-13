# Context: fundamentals-provider-alternative

**Feature**: `docs/roadmap/features/129-fundamentals-provider-alternative/feature.md`
**Product Spec**: `docs/roadmap/features/129-fundamentals-provider-alternative/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/129-fundamentals-provider-alternative/implementation-spec.md`

---

## Session 2026-08-12T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- User explicitly named Finnhub and Twelve Data as the two candidates to evaluate, and required
  design/recon to confirm the best alternative against their **actual, current API docs** rather
  than reuse conclusions from the earlier chat discussion (which had leaned toward Finnhub without
  verifying live docs). Encoded as FR-1/FR-2 and Acceptance Criteria 1-2.
- **Deviation**: `**Development Branch**` is set to the harness-assigned
  `claude/fmp-free-layer-ratios-dr0c4j` instead of creating a new `feature/fundamentals-provider-alternative`
  branch. Reason: this session's task instructions pin all commits/pushes to that branch and
  forbid pushing elsewhere without explicit permission. Deliberately avoids the branch-divergence
  failure mode recorded in `docs/roadmap/ledger/fails.md` (2026-07-30,
  `082-fix-fmp-config-boot-only`) where a harness branch and a separately-created SDD branch
  silently diverged. All SDD phases for this feature (story/design/spec/execute) will run on this
  one branch.
- Read `docs/roadmap/ledger/fails.md` for relevant traps: the 082 branch-divergence entry (above)
  and the 2026-08-06 `fundamentals-data-source` entry ("don't assume an existing helper
  parameterizes what a new call site needs" — re: quota-guard/alert-severity code). Both carried
  into product-spec.md § Feature Workflow Notes / Open Questions.

## Session 2026-08-12T00:10:00Z — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Criteria pass (spec-reviewer): **PASS WITH WARNINGS**, no Floor (`F-*`) breach, no blocker.
  - Warning: 3 unresolved `Open Questions` checkboxes (provider pick, replace-vs-switchable,
    the fails.md quota-guard-helper trap) — each explicitly deferred to `/sdd-design`, matching
    the accepted precedent set by feature 059's own product-spec review (deferred
    OQ-059-a-impl, non-blocking). Confirm `/sdd-design` Phase 0 Recon genuinely resolves all
    three rather than re-deferring to `/sdd-spec`.
  - Warning: `Consumer Surface(s)` = `None` is defensible today (RPC contract unchanged), but
    re-check if design's FR-1 findings widen scope (new fields, new RPC, or an
    operator-facing provider-selector surface) — `/insights` or `/config-ui` might then apply.
- Overlap pass (feature-overlap): **CLEAN**. No config-key/proto-field/migration collisions.
  Only shared-service context noted: `125-unified-symbol-page` reads the same
  `GetFundamentals`/`GetFundamentalsMulti` RPCs read-only (no clash); `076-fmp-key-to-secret-env`
  established the `<PROVIDER>_API_KEY` secret-env precedent this feature's FR-5 follows (distinct
  key name, no clash) — worth checking its migration-NNN tip again at `/sdd-spec` time if a
  migration ends up needed. No `finnhub`/`twelvedata` name collisions anywhere in the repo.

## Session 2026-08-13T00:00:00Z — sdd-design (quick)

- **Phase 0 Recon**: wrote `recon.md` (services: `xstockstrat-marketdata`, `xstockstrat-config`).
  Key reuse patterns found: `internal/fmp/fmp_client.go` client shape and
  `marketdata_service.go:846-1002` cache/quota-guard logic are fully provider-agnostic and
  directly reusable; `marketdata.fundamentals` DB schema has zero column gap vs.
  `source.Fundamentals`. Real gap found: 3 proto doc-comments (`marketdata.proto:160,174,178`)
  name FMP specifically and need a text-only edit regardless of shape changes.
- **Live-docs research** (orchestrator, via WebFetch/WebSearch — the design-proposer/-adversary
  subagents have no web tools, so this ran in the main session before Phase 1 per product-spec
  FR-1/AC-1's "must be citable, not assumed" requirement):
  - **Finnhub free tier**: ~60 calls/min, no daily cap, no credit card. `/stock/metric`
    (Basic Financials) confirmed free-accessible with PE, PB, 52w-high/low, EPS, ROE,
    debt-to-equity, beta, market cap. Sources: https://finnhub.io/pricing,
    https://robotwealth.com/finnhub-api/,
    https://www.interactivebrokers.com/campus/ibkr-quant-news/exploring-the-finnhub-io-api/,
    https://apicostcalc.com/finnhub.html, https://github.com/finnhubio/Finnhub-API/issues/122.
    **Not confirmed**: dividend-yield field presence (Finnhub's own docs.finnhub.io SPA did not
    render for the fetch tool) and whether fundamentals endpoints batch across symbols — both
    carried into design.md as Open Risks, to close via `/sdd-spec`'s live re-verification +
    product-spec AC-3's live smoke test.
  - **Twelve Data free/Basic tier**: 800 req/day, but **excludes all fundamentals data
    categorically** — `/statistics` (P/E, P/B, ROE, D/E, dividend yield, beta) requires
    Pro/Venture plan (https://twelvedata.com/docs#statistics); free `/quote` has no P/E or market
    cap (https://twelvedata.com/docs#quote); pricing page confirms the exclusion directly
    (https://twelvedata.com/pricing). **Disqualified outright** — fails FR-2's required-field
    coverage bar regardless of its generous rate limit.
- **Phase 1 Grilling**: 1 round (quick). Design-proposer chose Finnhub, full replacement of FMP.
  Design-adversary verdict: NEEDS WORK (no Floor breach) — found a real correctness gap (proposal's
  "full replacement" didn't account for 7+7 literal `marketdata.fmp.*` string reads across
  `marketdata_service.go`/`main.go`/tests, which would leave fundamentals silently disabled after
  an FMP-removal migration), flagged C-01 concerns about committing to full replacement plus a
  derived numeric quota default on top of 2 unverified facts (dividend yield, call shape), and
  cited the 2026-08-06 migration-collision ledger trap. Orchestrator synthesized a revision (no
  second proposer/adversary round needed — direct incorporation of the adversary's own suggested
  fixes): keep FMP switchable via a `marketdata.fundamentals.provider` selector instead of full
  replacement; defer the exact `symbols_per_minute` quota default to `/sdd-spec`; made the
  FMP-string rename (config-key reads, alert text, error text, comments — not just the 3 proto
  comments) an explicit mandatory scope item; single migration (`015_marketdata_finnhub`, no drop
  migration in this feature).
- **Gate**: user approved the synthesized design directly (no further rounds requested).
- Constitution rules touched: C-01, C-05, C-10(b), C-14, F-01, F-04, F-11 — all "honored" per
  design.md § Constitution Rules Touched. No Floor breach.
- Status: spec-ready → design-approved.

## Session 2026-08-13T00:30:00Z — sdd-spec

- Generated `implementation-spec.md` with 12 steps. Status: design-approved → implementation-ready.
- Read `recon.md`/`design.md` (both present) and reused their Codebase Map/Chosen Approach directly;
  re-verified every cited `path:line` against the live tree this session (all confirmed current —
  no drift since design.md was written a few hours earlier).
- **Live-docs research this session** (WebFetch/WebSearch, closing design.md's Open Risk #2):
  - Fetched `raw.githubusercontent.com/Finnhub-Stock-API/finnhub-python/master/finnhub/client.py`
    (a static, non-JS-rendered GitHub source — unlike Finnhub's own `docs.finnhub.io` SPA, which
    still does not render for fetch tooling, confirming design.md's finding). Confirmed: base URL
    `API_URL = "https://api.finnhub.io/api/v1"`; auth via `token` query param
    (`session.params["token"] = api_key`); `company_basic_financials(symbol, metric)` →
    `/stock/metric`, `quote(symbol)` → `/quote`, `company_profile2(**params)` → `/stock/profile2`
    — **all three take exactly one symbol, no batching**.
  - This derives `marketdata.finnhub.symbols_per_minute = 20` (60 calls/min free tier ÷ 3
    calls/symbol) — a verified default, not the proposer's original unverified guess design.md
    flagged as a Rejected Alternative.
  - Design.md's **Open Risk #1** (dividend-yield field's exact name on `/stock/metric`) remains
    genuinely unconfirmed — WebSearch surfaced indirect references to a
    `dividendYieldIndicatedAnnual`-shaped field (via a search-result snippet citing
    `finnhub.io/docs/api/stock-basic-dividends`) but no rendering-capable source confirmed it
    directly this session. Carried into the implementation spec as Step 2's first sub-instruction
    (live field-name check before writing response structs, with an explicit escalation clause if
    the field is absent) and Step 12 (the AC-3 live smoke test, the final authoritative check
    before `marketdata.finnhub.enabled` is ever flipped `true` in production).
- **Additional finding beyond design.md's named FMP-string list** (spec-time discovery, not
  re-discovery): `marketdata_service.go:1009-1012`'s `toProtoFundamentals` has an empty-`Source`
  fallback hardcoded to `"fmp"`, exercised today by the existing
  `TestGetFundamentals_MissFetchesAndUpserts` test (whose fake source leaves `Source` unset). Added
  as Step 5.9 — must become `s.fundProvider`-aware or a Finnhub-sourced row could misreport as
  `"fmp"` on the wire.
- Confirmed `services/xstockstrat-config/migrations/` still tops out at `014` (re-verified per
  design.md's Open Risk #3 / the 2026-08-06 migration-collision ledger trap) — `015` is safe.
- Confirmed the `002_fundamentals` DB schema has zero column gap (re-verified directly against
  `marketdata_repo.go:248,278-295`) — no `xstockstrat-marketdata` migration needed.
- Architecture decision made at spec time (not explicitly pre-specified by design.md, but directly
  implied by it): `marketdata.fundamentals.provider` is read **once at boot** and frozen as a new
  `s.fundProvider` field — never re-read live inside RPC handlers — because the active
  `source.FundamentalsSource` client (chosen at boot in `main.go`) and the config-key-name dispatch
  (which keys `fundamentalsEnabled`/cache/quota reads use) must never diverge; a live re-read of the
  selector without also hot-swapping the client object would silently point the guard logic at the
  wrong provider's config keys. Documented as Step 5.1's rationale.
- Quota-guard dedup key generalized from a UTC-date string to a window-bucket
  (`floor(unixSeconds/windowSeconds)`) — proved algebraically equivalent to today's UTC-day dedup
  for FMP's implicit 86400s window (Unix epoch starts at UTC midnight), so all 8 existing FMP
  acceptance tests keep passing unmodified; only the new Finnhub rolling-window path exercises the
  new re-fire-per-window behavior. This avoids design's alternative of maintaining two structurally
  different dedup mechanisms.
- No consumer-surface step needed (C-14) — product-spec/design.md both confirm Consumer Surface(s)
  = None (internal/platform-only); `implementation-spec.md` § Execution Summary restates this
  explicitly per the coverage rule rather than silently omitting a UI/Agent step.
- Reviewers snapshot finalized in `feature.md` from `docs/runbooks/reviewer-registry.md`: adds DBA
  and Proto Reviewer (both step categories now present — migration step 1, proto step 9) to the
  product-spec's original 3-role table.

## Session 2026-08-13T01:00:00Z — sdd-review impl-spec (advisory)

- Result: 0 blockers, 5 warnings (advisory — did not block). No Floor (`F-*`) risk. B3 step
  ordering and C-08 test-pairing fully satisfied.
- Unresolved ✗ / ⚠ carried into execution:
  - Step 3: C-08 coverage threshold not restated numerically in this step's own Verification
    (deferred to Step 6's full-suite ≥40% check — reasonable given Go's suite-level coverage
    model) — [ ] unaddressed (advisory only, no action expected)
  - Step 5: Codebase Evidence cites `cmd/server/main.go:103-105,175-178` for FMP-naming doc
    comments; actual lines are `107-109` (comment) / `110` (call site) and `175-179` (5-line
    comment span) — symbols are real, only line numbers off by a few — [ ] unaddressed (fix
    during Step 5 execution by re-reading the live file, not by editing the immutable spec body
    per F-09)
  - Step 7: same `main.go:103-105` citation imprecision repeated — [ ] unaddressed (same fix)
  - Step 9: `Files` lists `packages/proto/gen/{go,python,ts}/marketdata/v1/` as directories, not
    exact file paths — standard codegen-output convention (root CLAUDE.md forbids hand-editing
    `gen/`), low-severity NOTE — [ ] unaddressed (no action expected)
  - Step 10: `context-constitution.md:49` described as a "MARKETDATA-* invariant row" but is
    actually a row in the "## Pointers" table — line number correct, category mischaracterized —
    [ ] unaddressed (no action expected)
- Overlap findings: none. Verified `xstockstrat-config/migrations/` still tops out at `014` (015
  genuinely free); no other feature references `marketdata.finnhub.*` /
  `marketdata.fundamentals.provider`; `125-unified-symbol-page`'s only touchpoint is a read-only
  citation of the same proto message (disjoint files, no line-count shift from 129's comment-only
  edits) — no merge-order entry needed.

## Session 2026-08-13T02:00:00Z — sdd-execute (sequential) — renumbering blocker

- **Blocker encountered during the re-spec gate's `main-dev` merge** (BRANCH SYNC step 5 /
  sequential-mode §5.3.1): `git merge -X ours origin/main-dev` pulled in
  `docs/roadmap/features/127-consolidate-watchlist-signal/` (merged via PR #926, story-only,
  `draft` status) and `docs/roadmap/features/128-ui-middleware-nodejs-runtime/` (also story-only)
  — both landed on `main-dev` after this feature was created but before this feature merged.
  `127` collided directly with this feature's own number.
- User resolved via Option A (fix now): **renumber this feature 127 → 129** (128 was also already
  taken). `git mv docs/roadmap/features/127-fundamentals-provider-alternative
  docs/roadmap/features/129-fundamentals-provider-alternative`; every internal path reference and
  bare "feature 127" mention updated across `context.md`, `implementation-spec.md`, and the two
  ledger entries this feature's `/sdd-design` session wrote (`docs/roadmap/ledger/insights.md`,
  `docs/roadmap/ledger/fails.md`). `feature.md`/`design.md`/`product-spec.md`/`recon.md` titles use
  the bare slug (no embedded number) so needed no edit. `merge-order.md` has no entry for either
  slug — nothing to fix there. No spec content or decision changed.
- This is **not** a fails.md-worthy new lesson — it's the numbering rule (root CLAUDE.md § Feature
  Roadmap: "the next number is `max(existing NNN) + 1` … If two `/sdd-story` runs race and collide
  on a number, renumber the later one") working exactly as designed for a real cross-session race,
  the same class already covered by the 2026-08-06 `fundamentals-signal-producer — migration`
  ledger entry (concurrent migration-NNN collisions) but at the feature-directory level instead.
- Status: `implementation-ready` unchanged — this was a pre-step-loop correction, not a step.

## Session 2026-08-13T02:15:00Z — sdd-execute (sequential) — tooling setup

- Re-spec gate validation (§5.3.2): re-checked cited evidence against the post-merge tree.
  `docs/patterns/config-governance.md`'s "Per-Feature Registered Keys" header/feature-102-entry
  shifted +7 lines (unrelated PR #897, config-governance audit) — symbol/content unchanged, only
  line numbers drift; Phase 1 discovery re-greps live at Step 11 execution, so no re-spec needed.
  `.do/app.dev.yaml`/`.do/app.yaml` gained an unrelated `FMP_API_KEY` block under
  `xstockstrat-analysis` (also PR #897) — `xstockstrat-marketdata`'s own `FMP_API_KEY` block
  (Step 7's mirror target) is untouched at its cited location. `xstockstrat-marketdata` service
  code and `packages/proto/marketdata/v1/marketdata.proto` were not touched by the merge — all
  other steps' evidence stands as specced.
- Tooling setup (steps 1-12): go1.25.0 ✓ · golangci-lint v2.5.0 ✓ · buf ⬇ 1.72.0 (Docker daemon
  unavailable in this sandbox — `docker build -f Dockerfile.codegen` failed with "no such file or
  directory" on the docker socket; fell back to
  `docs/runbooks/codegen-toolchain-host-setup.md`'s host-toolchain path) · protoc-gen-go ⬇ v1.36.11
  · protoc-gen-go-grpc ⬇ v1.6.2 · protoc-gen-connect-go ⬇ v1.19.2 · ts-proto ⬇ 2.11.8 ·
  @bufbuild/protoc-gen-es ⬇ 2.12.0 · @connectrpc/protoc-gen-connect-es ⬇ 1.7.0 · grpcio-tools ⬇
  1.80.0 · `packages/proto/gen/ts` pnpm deps ⬇. All pins verified against `Dockerfile.codegen`
  (authoritative source) before install — matched the runbook's snapshot exactly, no drift.
  **Validated per the runbook's Step 5 acceptance gate**: `git branch -f main-dev origin/main-dev`
  (local ref, so `buf breaking` actually runs instead of silently no-op'ing) →
  `./scripts/buf-gen.sh` → `git diff --stat packages/proto/gen/` → **empty**, proving the host
  toolchain reproduces the committed stubs byte-for-byte before Step 9 touches any `.proto` line.
- Deviation: proto-codegen tool source is the host-toolchain runbook fallback, not the Docker
  container — logged per the sequential-mode "CI-equivalent fallback" carve-out (matches CI's
  `proto-freshness` job pins exactly, confirmed by the empty-diff gate, so no actual divergence
  from CI's toolchain — this is a sandbox-environment substitution, not a corner cut).

### Step 1 — config: seed `marketdata.finnhub.*` + `marketdata.fundamentals.provider` config keys [done]
- Created `015_marketdata_finnhub.up.sql`/`.down.sql` mirroring `007_marketdata_fmp.up.sql`'s exact
  shape: 6 keys × 2 rows (dev/production), `is_secret=FALSE` throughout (no credential row, per the
  feature-076 precedent). Offline verification passed: all 6 `.up.sql` keys present in `.down.sql`'s
  `DELETE ... WHERE key IN (...)`, zero `is_secret=TRUE` rows.
- Files modified: `services/xstockstrat-config/migrations/015_marketdata_finnhub.up.sql`,
  `services/xstockstrat-config/migrations/015_marketdata_finnhub.down.sql`
- Deviations: none.

## Session 2026-08-13T02:30:00Z — sdd-execute (sequential) — Step 2 live field verification (closes design.md Open Risk #1)

- **Blocker**: Step 2 Instruction 1 requires a live Finnhub call to confirm field names, but this
  session has no Finnhub API key and cannot sign up for one autonomously. Raised via
  `AskUserQuestion` (§5.7). User supplied a free-tier Finnhub API key for this one-time
  verification. **The key is not stored, logged, or committed anywhere** — used transiently via
  `curl` to 3 live endpoints, response bodies saved only to the session scratchpad (never staged),
  then discarded from this record.
- **Live GET `https://api.finnhub.io/api/v1/stock/metric?symbol=AAPL&metric=all`** (HTTP 200,
  ~150 fields returned). Confirmed exact field names for every required metric:
  `52WeekHigh`, `52WeekLow`, `beta`, `peTTM` (34.7202), `pb` (41.6339), `epsTTM` (8.7233),
  `roeTTM` (137.18), `totalDebt/totalEquityQuarterly` (0.7844 — literal `/` in the JSON key),
  `marketCapitalization` (4,476,472.5). **Dividend yield: CONFIRMED PRESENT** — two candidate
  fields, `currentDividendYieldTTM` (0.3494) and `dividendYieldIndicatedAnnual` (0.3542028795...).
  Chose `currentDividendYieldTTM` as the mapping target — its "TTM" naming most directly parallels
  FMP's own `dividendYieldTTM` (from `ratios-ttm`), which is exactly the semantic this feature is
  replacing/matching.
- **Live GET `.../quote?symbol=AAPL`** (HTTP 200): `c` = current price (302.25), `d`/`dp` =
  change/percent-change, `h`/`l`/`o`/`pc` = day high/low/open/prev-close, `t` = unix timestamp. No
  symbol echo, no valuation fields — confirms design.md's expectation that price comes from here.
- **Live GET `.../stock/profile2?symbol=AAPL`** (HTTP 200): `currency` = `"USD"`, plus a second,
  slightly different `marketCapitalization` (4,411,090.86) — **not used**; `/stock/metric`'s value
  is the single source of truth for market cap to avoid a two-sources-for-one-field ambiguity.
- **Two NEW unit-mismatch findings beyond what Step 2's Instructions anticipated** (the Instructions
  only asked to confirm field *names*, not units — this is additional evidence the live check
  surfaced, recorded here per Constitution C-01/P-03 rather than silently absorbed into the code
  with no trace):
  1. **`marketCapitalization` is denominated in millions of USD**, not raw dollars — AAPL's
     4,476,472.5 is $4.4761 **trillion**. FMP's `fmpQuote.MarketCap` (from `/stable/quote`) is raw
     dollars (an ordinary large float, no millions scaling — confirmed by its direct pass-through
     in `fmp_client.go:213`, no division anywhere in that mapper). **The Finnhub mapper must
     multiply `marketCapitalization` by 1,000,000** before assigning `source.Fundamentals.MarketCap`,
     or every Finnhub-sourced market cap would be ~1,000,000× too small — a silent, severe
     data-correctness bug that would have shipped invisibly (both values are "plausible-looking"
     floats; nothing would error).
  2. **`roeTTM` and `currentDividendYieldTTM` are percentage-**point** numbers** (137.18 meaning
     "137.18%", 0.3494 meaning "0.3494%"), while FMP's `ROE`/`DividendYield` are **fractions**
     (confirmed via `fmp_client_test.go:60,75`'s own fixture: `"dividendYieldTTM":0.005` mapped
     directly to `f.DividendYield != 0.005`, i.e. FMP's raw value IS the fraction, no scaling in
     FMP's mapper either — `fmp_client.go:232-237`). **The Finnhub mapper must divide `roeTTM` and
     `currentDividendYieldTTM` by 100** before assigning `source.Fundamentals.ROE`/`.DividendYield`,
     or a screener criterion like `min_dividend_yield: 0.02` (a 2% threshold in FMP's fraction
     convention) would silently misbehave against Finnhub-sourced rows (0.3494 unscaled would read
     as "34.94%", not the intended "0.3494%" — every Finnhub symbol would spuriously pass or fail a
     dividend/ROE screen depending on the threshold's sign). `peTTM`/`pb`/
     `totalDebt/totalEquityQuarterly`/`beta` are true dimensionless ratios in both providers — no
     scaling needed for those.
- **This is a deviation from implementation-spec.md's Step 2 Instructions** (F-09: step bodies are
  immutable during execution) — the Instructions text is left as originally written; this note plus
  the actual code (which will include explicit `/ 100` and `* 1_000_000` conversions with comments
  citing this session's verification) is the record of what was actually found and done.
- **Open Risk #1 (design.md) is now CLOSED**: dividend yield exists on the free tier, field name
  confirmed, unit conversion identified. Product-spec Acceptance Criteria 1 (citable live-docs
  evidence) satisfied by this direct API response, not a secondary source.

### Step 2 — service: new Finnhub fundamentals client (`internal/finnhub/`) [done]
- Implemented `finnhub_client.go` mirroring `fmp_client.go`'s shape: `ClientConfig`/`Client`,
  `NewClient`, `GetFundamentals`/`GetFundamentalsMulti` (per-symbol loop, 3 calls each — no
  batching, per the confirmed no-batch finding), `getJSON` HTTP plumbing (`token` param, never
  logged), response structs (`finnhubMetricResponse`/`finnhubMetric`, `finnhubQuote`,
  `finnhubProfile2`) with `apply()` mappers implementing the confirmed field names + the two unit
  conversions (ROE and DividendYield ÷100, MarketCap ×1,000,000).
- `go build ./internal/finnhub/...` passes; the `var _ source.FundamentalsSource = (*Client)(nil)`
  compile-time assertion confirms interface satisfaction.
- Files modified: `services/xstockstrat-marketdata/internal/finnhub/finnhub_client.go`
- Deviations: Step 2's Instructions only anticipated confirming field *names* live; the session
  additionally discovered and had to resolve two unit-mismatch bugs (see the session note above)
  that the Instructions text did not anticipate — recorded here per F-09 rather than editing the
  immutable Instructions.

### Step 3 — test: `internal/finnhub/finnhub_client_test.go` [done]
- Wrote `finnhub_client_test.go` mirroring `fmp_client_test.go`'s shape (`recordingRT` fake,
  `newTestClient` helper, field-mapping test, call-count test, key-leak test), using the
  live-confirmed field names/shapes from Step 2's session note.
- **TDD red→green** (Constitution P-06): captured genuine RED by temporarily stubbing
  `finnhubMetric.apply()` to a no-op (`internal/finnhub/finnhub_client.go`, saved/restored via a
  scratchpad copy, never committed in its stubbed state) — `TestGetFundamentals_MapsField` FAILED
  as expected ("metric mapping wrong: ...ROE:0 DebtToEquity:0..."), the other two tests still
  passed (they don't depend on the metric mapper). Restored the real implementation — all 3 tests
  PASS. `go test ./internal/finnhub/... -race -count=1 -v`: 3/3 pass.
  `golangci-lint run ./internal/finnhub/...`: 1 gofmt issue (comment alignment in the apply
  method) found and fixed in-scope (HARD CONSTRAINTS' own-changed-lines exception) → 0 issues.
- Files modified: `services/xstockstrat-marketdata/internal/finnhub/finnhub_client_test.go`,
  `services/xstockstrat-marketdata/internal/finnhub/finnhub_client.go` (gofmt only)
- Deviations: none beyond the Step 2 note above (shared root cause).

### Step 4 — service: `CountFundamentalsFetchedSince` repo method [done]
- Added `CountFundamentalsFetchedSince(ctx, since time.Time)` immediately after
  `CountFundamentalsFetchedToday`, same query shape (`SELECT count(*) FROM
  marketdata.fundamentals WHERE fetched_at >= $1`), reusing `idx_fundamentals_fetched_at`.
  `time` was already imported in this file — no import change needed.
- `go build ./internal/repository/...` and `golangci-lint run ./internal/repository/...` both
  pass. `TDD: N/A` per the step's own spec (repository/ is CI-coverage-excluded and has no direct
  test for the sibling method either — exercised via `fakeFundRepo` in Step 6).
- Files modified: `services/xstockstrat-marketdata/internal/repository/marketdata_repo.go`
- Deviations: none.

### Step 5 — service: provider-dispatch the fundamentals cache/quota guard [done]
- Added `fundProvider string` (frozen at construction, never re-read live) to
  `MarketDataService`; extended `fundamentalsRepo` with `CountFundamentalsFetchedSince`;
  extended `NewMarketDataService`'s signature with a trailing `provider string` param.
  Generalized both `cache_ttl_hours` reads to `"marketdata."+s.fundProvider+".cache_ttl_hours"`.
  Replaced the two duplicated daily-cap blocks with a new `fundamentalsQuota(ctx)` helper
  dispatching FMP's unchanged daily-cap shape vs. Finnhub's new rolling-window shape (reusing a
  single quota read per call site — fixed a redundant-double-query mistake caught while
  implementing, before it ever hit a test). Generalized `fundamentalsEnabled`'s config key +
  error text, `maybeAlertQuota`'s dedup key (UTC-date string → window-floor bucket, algebraically
  identical to the old dedup for FMP's 86400s window since Unix epoch starts at UTC midnight),
  `emitWarning`'s alert title. Converted `toProtoFundamentals` from a free function to a method
  (`s.toProtoFundamentals`) so its empty-`Source` fallback names `s.fundProvider`, not a hardcoded
  `"fmp"` — this closes the design-adversary's original correctness finding from the design phase.
  Generalized the section banner + 3 doc comments naming FMP specifically.
- `go build ./internal/service/...` passes (build exit 0). `golangci-lint run` on the same package
  initially failed with 1 typecheck error — but it was `marketdata_service_test.go`'s stale fakes
  (missing `CountFundamentalsFetchedSince`, old `newFundSvc`/`NewMarketDataService` call shapes),
  exactly the compile-coupling with Step 6 the spec's own Verification section anticipated. Left
  unresolved at this point in the session and closed by Step 6 (see below) — both steps'
  Verification commands only pass together, so both are recorded as `done` in the same pass.
- Files modified: `services/xstockstrat-marketdata/internal/service/marketdata_service.go`
- Deviations: implemented `fundamentalsQuota`, `maybeAlertQuota`'s new signature, and the
  `toProtoFundamentals` method conversion exactly per design.md/the step's own Instructions — no
  scope deviation. One in-session self-correction (the double-query mistake above), fixed before
  it ever produced a wrong test result — not a deviation from the spec, a normal edit-time fix.

### Step 6 — test: update + extend `marketdata_service_test.go` fundamentals suite [done]
- Updated `fakeFundRepo` (added `sinceCount` + `CountFundamentalsFetchedSince`), `fakeCfg` (added
  a real `strings` map + `GetString` lookup), `enabledCfg` (now takes a `provider` arg, seeds the
  correct per-provider key set/quota shape), `newFundSvc` (now takes a `provider` arg, sets
  `fundProvider`). Updated all 8 existing FMP-path tests' call sites to pass `"fmp"` explicitly —
  every one keeps its original, unmodified assertions and **all 8 still pass byte-for-byte**,
  proving Step 5's generalization is behavior-preserving for the FMP path.
- Added 7 parallel Finnhub-path tests mirroring the 8 FMP tests (folding
  cache-hit/at-cap-stale/at-cap-exhausted/disabled/miss-fetch into 5, since Finnhub has no
  separate "live toggle" acceptance criterion beyond what's already covered): `CacheHitNoFetch`,
  `AtCapStale`, `AtCapNoCacheResourceExhausted`, `DisabledFailedPrecondition` (asserts the exact
  provider-specific error text), `MissFetchesAndUpserts` (asserts the `Source` fallback is
  `"finnhub"`, proving Step 5.9), `QuotaWarningRefiresPerWindow` (the genuinely new behavior —
  same-window dedup holds, then re-fires once the window bucket changes; since `maybeAlertQuota`
  has no injectable clock, the "window changed" precondition is forced directly by overwriting
  `quotaAlertBucket` between calls, the same technique `repo.todayCount`/`sinceCount` already use
  elsewhere in this suite to force a quota precondition without issuing real requests — recorded
  as the deliberate testing technique it is, not silently), and
  `ThreeCallsPerSymbolCostsQuota` (service-level: N-symbol fetch advances the quota count by
  `len(fetched)`, distinct from Step 3's client-level 3-calls-per-symbol HTTP test).
- `go test ./internal/service/...`: all tests pass (15 fundamentals tests: 8 FMP + 7 Finnhub, plus
  every pre-existing non-fundamentals test unaffected). `golangci-lint run` on the package: 0
  issues — this closes Step 5's deferred lint failure.
- Files modified: `services/xstockstrat-marketdata/internal/service/marketdata_service_test.go`
- Deviations: none beyond the fold-5-into-1 test-count note above (documented, not silent).

### Step 7 — service: wire the provider selector into `main.go` + `FINNHUB_API_KEY` [done]
- Added `FinnhubAPIKey` to `Config`/`LoadFromEnv` (`config.go`), mirroring `FMPAPIKey` exactly.
  Rewrote `newFundamentalsSource` to dispatch on a new `provider` param (finnhub/fmp branches);
  read `marketdata.fundamentals.provider` once in `main()` before constructing the client, passed
  into both the client constructor and `NewMarketDataService`'s new trailing `provider` arg. Added
  `FINNHUB_API_KEY` to `docker-compose.yml` and both `.do/app*.yaml` files, immediately after each
  file's existing `FMP_API_KEY` block — verified via `grep` that the edit hit only
  `xstockstrat-marketdata`'s own block, not the unrelated `xstockstrat-analysis` `FMP_API_KEY`
  block the concurrent PR #897 merge had added to `.do/app.dev.yaml` (same key/scope/value
  literal text, different service — disambiguated by including the block's trailing
  `SERVICE_NAME: marketdata` context in the edit's match).
- `go build ./...` (the **full** module, not scoped) passes cleanly — this is the point at which
  the whole service compiles end-to-end for the first time in this feature.
  `golangci-lint run ./cmd/... ./internal/config/...`: 0 issues.
- Files modified: `services/xstockstrat-marketdata/cmd/server/main.go`,
  `services/xstockstrat-marketdata/internal/config/config.go`, `docker-compose.yml`,
  `.do/app.dev.yaml`, `.do/app.yaml`
- Deviations: none.

### Step 8 — test: update `main_test.go`'s boot-canary for the new signature [done]
- Updated `TestNewFundamentalsSource_AlwaysNonNil` to cross 3 provider values (`"fmp"`,
  `"finnhub"`, and an unrecognized value proving the fallback branch) × 2 API-key states,
  asserting non-nil in all 6 combinations — the feature-082 regression this canary guards against
  is exactly as reachable for the new `"finnhub"` branch as it was for the sole FMP branch before.
- `go test ./cmd/server/...`: passes (canary + the pre-existing placeholder-cred test, unaffected).
  `golangci-lint run ./cmd/... ./internal/config/...`: 0 issues (re-run, still clean).
- **Closing full-suite verification for the Steps 5-8 chain** (Step 6's own Verification section,
  now unblocked since Step 7 makes `cmd/server` compile): `go test ./... -race -count=1
  -coverprofile=coverage.out -covermode=atomic -coverpkg=<non-excluded packages>` — every package
  passes; `go tool cover -func=coverage.out | grep "^total:"` → **63.3%**, well above the ≥40%
  threshold. `coverage.out` deleted after the check (not a step `**Files**` artifact, never
  staged/committed).
- Files modified: `services/xstockstrat-marketdata/cmd/server/main_test.go`
- Deviations: none.

### Step 9 — proto: text-only doc-comment edits (no wire shape change) [done]
- Edited the 3 FMP-specific comments in `marketdata.proto` (message doc, `extra_metrics` field
  comment, `source` field inline comment) to describe the active provider generically.
- `buf lint`: 0 findings. **Deviation from the step's literal Verification command**: `buf breaking
  --against ".git#branch=claude/fmp-free-layer-ratios-dr0c4j"` fails when run from
  `packages/proto/` (no `.git` in that subdir — buf resolves the git ref relative to the current
  directory, not the repo root). Used the correct, actually-working invocation
  `buf-gen.sh` itself uses: `buf breaking --against
  "<repo-root>/.git#branch=claude/fmp-free-layer-ratios-dr0c4j,subdir=packages/proto"` — 0
  findings. Then ran the full `./scripts/buf-gen.sh` (which internally runs `buf breaking` against
  `main-dev`, a stricter check than the feature-branch one) — also 0 findings.
- `git diff --stat packages/proto/gen/`: non-empty, limited to `gen/go/marketdata/v1/marketdata.pb.go`
  + the 4 TS generated files (message/field doc-comment propagation only — verified by reading the
  diff, no field number/type/tag changes). No Python file changed (Python protobuf codegen doesn't
  propagate `.proto` comments into `_pb2.py`/`_pb2_grpc.py` — expected, not a gap).
  `go build ./...` against the regenerated stubs: passes.
- Files modified: `packages/proto/marketdata/v1/marketdata.proto`,
  `packages/proto/gen/go/marketdata/v1/marketdata.pb.go`,
  `packages/proto/gen/ts/marketdata/v1/marketdata.ts`,
  `packages/proto/gen/ts/marketdata/v1/marketdata_pb.ts`,
  `packages/proto/gen/ts/dist/marketdata/v1/marketdata.d.ts`,
  `packages/proto/gen/ts/dist/marketdata/v1/marketdata_pb.d.ts`

### Step 10 — docs: `xstockstrat-marketdata` service docs [done]
- Appended the 6 new config-key rows to `CLAUDE.md`'s Config Keys Consumed table. Renamed
  "## FMP Fundamentals Integration (feature 059)" to "## Fundamentals Integration (feature 059;
  provider made switchable by feature 129)" and rewrote the body to describe both providers, the
  shared cache/RPC layer, and the provider-dependent quota-guard shape. Updated
  `context-constitution.md`'s top-of-file summary and the `MARKETDATA-*` Pointers row for the
  provider-dispatched gate.
- Verification: `grep -n "FMP"` both files, manually reviewed every hit — all describe FMP as *a*
  provider option (an FMP-specific config-key row, or an explicit FMP-vs-Finnhub contrast), none
  imply FMP is the only source.
- Files modified: `services/xstockstrat-marketdata/CLAUDE.md`,
  `services/xstockstrat-marketdata/docs/context-constitution.md`
- Deviations: none.

### Step 11 — docs: `config-governance.md` Per-Feature Registered Keys log [done]
- Inserted the `### feature 129 — fundamentals-provider-alternative` entry above the existing
  `### feature 102` entry (newest-first ordering), listing all 6 new keys in the same table shape
  as the `feature 059` entry below it (left untouched, per the append-only rule).
- Verification: `grep -n "^### feature"` confirms 129 sits directly above 102; the 059 entry's
  content was not edited (no diff to it beyond the new entry's insertion point above 102).
- Files modified: `docs/patterns/config-governance.md`
- Deviations: none.

## Session 2026-08-13T03:00:00Z — sdd-execute (sequential) — Step 12 AC-3 smoke test

- **Scope constraint found before executing**: Step 12's Instructions call for exercising a fully
  deployed `xstockstrat-marketdata` instance via `grpcurl` (TimescaleDB + xstockstrat-config +
  ledger + notify all running, `SetConfig` applied, `GetFundamentalsMulti` called against the real
  service). This sandbox has no Docker daemon (`docker build` failed earlier this session with
  "no such file or directory" on the socket — same constraint noted in the tooling-setup session).
  Spinning up that stack here would also violate this skill's own HARD CONSTRAINT ("never start a
  database or other long-running service container to verify a step") — so the literal
  full-stack instruction is **not executable in this environment**, independent of the Docker gap.
  This is a genuine scope limitation, not a corner cut — recorded per P-03 rather than silently
  worked around or silently marked done.
- **What was verified instead, live, against the real Finnhub API** (extending Steps 2-3's AAPL
  check to 2 more symbols, using the same session's Finnhub key — never stored/logged):
  - **PLTR** (`/stock/metric`, `/quote`, `/stock/profile2`, all HTTP 200): price=171.04,
    currency=USD, 52WeekHigh=207.52, 52WeekLow=106.37, beta=1.617006, peTTM=139.588, pb=43.0822,
    epsTTM=1.1735, roeTTM=37.47, marketCapitalization=421094 (millions). **Two fields read as
    zero/null**: `totalDebt/totalEquityQuarterly=0` and `currentDividendYieldTTM=null` (key
    present, JSON value `null` — confirmed via direct key-presence check, not just a falsy read).
  - **SOFI** (all HTTP 200): price=17.94, currency=USD, 52WeekHigh=32.73, 52WeekLow=14.88,
    beta=2.3501444, peTTM=36.7823, pb=2.1129, epsTTM=0.4736, roeTTM=6.18,
    totalDebt/totalEquityQuarterly=0.298, marketCapitalization=23403.256 (millions).
    `currentDividendYieldTTM=0` (key present, value `0`, not null this time).
  - **Assessment of the zero/null fields**: both PLTR and Sofi Technologies pay no common-stock
    dividend — `currentDividendYieldTTM` reading `0`/`null` for both is the economically **correct**
    answer, not a mapping bug or a missing-data gap. PLTR's near-zero debt-to-equity is also
    consistent with its real balance sheet. Neither is evidence against Open Risk #1's closure —
    if anything it's positive evidence: the field genuinely represents dividend yield and responds
    correctly (0) for genuine non-payers, exactly as AAPL's real 0.3494 (a genuine payer) confirmed
    the field's existence and shape in Steps 2-3.
  - **Verified the `null` case doesn't break the client**: `encoding/json` unmarshaling a JSON
    `null` into `finnhubMetric.DividendYieldTTM` (a plain `float64`, not `*float64`) leaves the
    field at its zero value with **no error** (confirmed with a standalone Go snippet run this
    session) — PLTR's live `null` response would map to `DividendYield: 0` cleanly through the
    real `internal/finnhub/finnhub_client.go` code path, not crash or silently corrupt other
    fields.
  - Combined with Steps 2-3's AAPL data (a genuine dividend payer, confirming
    `currentDividendYieldTTM` populates a real non-zero value when one exists), all 12 required
    fields (price, market cap, P/E, EPS, 52w high/low, P/B, dividend yield, ROE, D/E, beta,
    currency) have now been observed **non-null/non-error at the field level** across 3 diverse
    real symbols, with the two "zero" readings independently explained as correct-not-missing.
- **What remains unverified in this session** (the honest gap): the full RPC path —
  `GetFundamentalsMulti`'s cache write/read against a real `marketdata.fundamentals` table, the
  `fundamentalsQuota`/`CountFundamentalsFetchedSince` rolling-window guard against real DB rows,
  and a `SetConfig`-driven live-config-rollout of `marketdata.finnhub.enabled` — was not exercised
  end-to-end against a deployed instance. This logic is covered by Step 5-6's 15 fundamentals unit
  tests (with fakes, not a live DB), which is strong but not equivalent to a live-deployed
  integration run.
- **Design.md's Open Risk #1 (dividend yield) is CLOSED** — the field exists, is correctly named
  (`currentDividendYieldTTM`), and behaves correctly (real value for payers, 0/null for
  non-payers, no crash) across 3 real symbols. **Open Risk #2 (call shape/batching) was already
  closed at Step 2/spec time.**
- Files modified: this `context.md` entry only (per the step's own `**Files**` scope).
- **User decision**: accepted the client-level live verification as sufficient closure for Step
  12/AC-3. Rationale recorded: the full RPC/DB/cache path is covered by 15 passing unit tests
  (Steps 5-6, against fakes); true end-to-end verification against a real deployed instance
  happens naturally at actual deployment time via `docs/runbooks/config-rollout.md`'s gradual
  rollout process — `marketdata.finnhub.enabled` starts `false` (Step 1's seed default) and is
  flipped deliberately later, by an operator with real Docker/DB access, not by this sandboxed
  session. Step 12 marked `done` on this basis.

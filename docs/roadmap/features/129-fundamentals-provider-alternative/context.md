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

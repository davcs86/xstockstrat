# Context: daily-bars-only

**Feature**: `docs/roadmap/features/143-daily-bars-only/feature.md`
**Product Spec**: `docs/roadmap/features/143-daily-bars-only/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/143-daily-bars-only/implementation-spec.md`

---

## Session 2026-08-16 — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- Origin: a direct chat instruction ("let's use this ticket to remove fetching bars different
  from 1day") arriving mid-session on the `null-fundamentals-ohlcv-gaps` bug-fix branch
  (PR #971). Per root `CLAUDE.md`'s Mandatory Entry Point rule, this is new/changed service
  behavior (not a confirmed bug), so it was routed through `/sdd-story` before any code was
  written, even though the request itself asked to fold it into the existing PR.
- **Scope clarified via `AskUserQuestion`** before writing the spec: offered a narrow option
  (ingester-only: just stop continuously fetching `15m` in the background, leave on-demand
  `GetBars`/`BackfillBars`/UI chart support for `15m`/`1h` intact) vs. a broad option (strip
  `15m`/`1h` support platform-wide — RPC surface, ingester, and UI). **User chose broad.**
- **Branch deviation (explicit, recorded per root `CLAUDE.md`'s override requirement):** this
  session is constrained to develop on and push only to the harness-assigned branch
  `claude/null-fundamentals-ohlcv-gaps-l2v4x5` (PR #971 already open against it). Rather than
  branching a fresh `feature/daily-bars-only` per the standard SDD branch model
  (`docs/runbooks/feature-workflow.md`), this feature's implementation will continue directly
  on that existing branch/PR, matching the same pattern already used earlier in this session
  for the two bug-fix reports (`docs/reports/2026-08-16-*.md`) that also live on that branch
  instead of a separate `feature/<slug>` branch. `feature.md`'s `**Development Branch**`
  field is left at the standard `feature/daily-bars-only` value per the template contract
  (SDD tooling like `/sdd-execute` reads that field), but the actual commits for this feature
  land on `claude/null-fundamentals-ohlcv-gaps-l2v4x5` — noted here as the authoritative
  record of the deviation.
- Read `docs/roadmap/ledger/fails.md`/`insights.md` for traps in this area — surfaced the
  `080-fix-backfill-timeframe-enum` defect history (canonical-string/enum handling has broken
  before) and its explicit "don't split into two features" lesson; both recorded in the
  product spec's Open Questions / Known trap section.
- Left several implementation decisions as **Open Questions** rather than assumed (historical
  `15m`/`1h` data disposition, exact RPC rejection contract, Alpaca WS 1-minute stream
  disposition, `internal/timeframe` package scope) — these are exactly what `/sdd-design
  daily-bars-only quick` should resolve next.

## Session 2026-08-16 — renumbering (140 → 143) + status.md migration

- Initially created as `140-daily-bars-only` (max existing NNN at story time was `139`).
  Immediately after, `git push` was rejected (non-fast-forward) — `origin`'s branch had
  gained a merge of `main-dev`, which itself had landed three new features numbered
  `140`/`141`/`142` (`140-fix-listorders-ambiguous-updated-at`,
  `141-fix-opportunities-bars-fetch-oom`, `142-fix-fundamentals-upsert-invalid-json`) plus a
  platform-wide migration moving each feature's lifecycle status out of `feature.md`'s
  `**Lifecycle Status**` field into a sibling `status.md` file (see
  `docs/roadmap/features/CLAUDE.md` § Bulk Status Reads). This is exactly the numbering race
  `docs/runbooks/feature-workflow.md` § Feature Numbering describes as a known failure mode.
- Resolution, per that runbook's Collision Resolution rule: merged the remote branch locally
  (clean auto-merge, no conflicts — confirmed via full `go build`/`go vet`/`go test`/
  `golangci-lint`/`gofmt` on `xstockstrat-marketdata`, `uv run pytest` on
  `xstockstrat-analysis`, and an empty `buf-gen.sh` diff against the now-current `main-dev`),
  then `git mv`'d this feature's directory to `143-daily-bars-only` (next free number after
  the collision) and fixed its two internal `140-daily-bars-only` self-references in
  `context.md`.
- Adopted the new `status.md` convention in the same pass: removed `feature.md`'s
  `**Lifecycle Status**: \`draft\`` line and added `status.md` containing `draft` — matching
  the template the merged-in `/sdd-story` `SKILL.md` now specifies, not the stale template
  this session had already loaded before the merge.
- Verified `git show 6786d98 --stat` (the `main-dev` merge commit) touched neither
  `live_loop.py`, `screener.py`, nor `marketdata_service.go` — the three files this
  session's precursor bug fix (`null-fundamentals-ohlcv-gaps`) and this feature both concern
  — so no semantic conflict with feature 141/142's changes exists beyond the numbering
  collision itself.

## Session 2026-08-16 — sdd-review product-spec

- Product spec approved. Status: `draft` → `spec-ready`.
- Criteria pass (spec-reviewer): PASS WITH WARNINGS, no blockers, no Constitution Floor
  (`F-*`) breach. Every code-checkable claim verified against the actual repo (config key
  default, proto enum deprecation state, hardcoded `timeframe="1d"` call sites). Warnings
  (all advisory, non-blocking): (1) the 4 `## Open Questions` remain literally unresolved —
  judged acceptable per repo precedent (`139-symbol-page-section-nav/product-spec.md`
  explicitly defers Open Questions to `/sdd-design` the same way); (2) the Database Changes
  section leaves both template checkboxes unchecked in favor of the Open Questions pointer;
  (3) the Config Key Changes section uses a non-template checkbox label. No trading-domain
  (`C-1`…`C-5`) findings — the "Alpaca"/"market"/"fill" substring matches were false
  positives (marketdata's data feed, not trading's broker/order surface).
- Overlap pass (feature-overlap): CLEAN — no FAIL-level collision (config key, proto field
  number, migration `NNN`, or landed source-file edit) against any in-flight feature.
  Rebase-risk note (not a collision): `ChartPanel.tsx` and
  `e2e/insights/backfills.spec.ts` are also touched by `125-unified-symbol-page`
  (`in-progress`, most steps `done`) for unrelated reasons (chart-library retention,
  fixture centralization) — re-verify line numbers against 125's landed state at
  `/sdd-spec` time.
- **Note on subagent tool-output anomaly:** both the `spec-reviewer` and `feature-overlap`
  subagents independently reported encountering a `system-reminder`-styled block in tool
  output while this session's `git merge`/`git mv` renumbering (previous session entry) was
  running concurrently in the same working tree — i.e. a real race between my foreground
  file mutations and their background reads, not a fabricated appearance. One agent noted a
  message purporting to instruct it not to inform the user of a docs change. Both agents
  correctly declined to act on it and surfaced it in their reports instead. Independently
  verified: the underlying substance (the `status.md` lifecycle-status convention) is
  genuinely real, current repo state — confirmed directly via `git show
  origin/main-dev:docs/roadmap/features/CLAUDE.md` and by reading multiple existing
  `status.md` files — so no incorrect fact reached this spec's review outcome. The unusual
  "don't tell the user" framing itself does not match this harness's normal
  system-reminder format; flagged here for visibility, not acted on, and did not change any
  review verdict above.

## Session 2026-08-16 — sdd-design Phase 0 (recon)

- Spawned two `codebase-discovery` subagents in parallel (`xstockstrat-marketdata`,
  `xstockstrat-ui`), synthesized into `recon.md`.
- **Headline finding (P-03 escalation, not guessed past):** `xstockstrat-ingest` and
  `xstockstrat-agent` each maintain their own parallel `15m`/`1h` alias/enum table
  (`_STR_TO_ENUM`/`_TF_ALIASES`/`_BARS_PER_DAY` in ingest; `_TF_ALIASES`/`_TF_TO_ENUM` in the
  agent's `trigger_backfill` MCP tool) feeding into marketdata's `BackfillBars` — neither
  service was in product-spec.md's `## Affected Services`, and the Agent box in `##
  Consumer Surface(s)` was checked "no MCP tool exposes a timeframe parameter," which recon
  proved false. **Corrected `product-spec.md` in place** (Affected Services + Consumer
  Surface(s) sections, both marked with an explicit "Corrected by /sdd-design Phase 0 recon"
  note) rather than silently carrying the gap forward into `/sdd-spec` — this is a factual
  completion of an already-approved spec, not a re-litigation of scope, so `status.md` stays
  `spec-ready` (no re-run of `/sdd-review` triggered).
- Also found: `positions/[symbol]/page.tsx` is a second, previously-unlisted UI consumer of
  `lib/chart.ts` (shares the module with `ChartPanel.tsx`) — noted in the Affected Services
  correction and `recon.md` Risks so `/sdd-spec` doesn't miss it.
- Closed one Open Question outright: the Alpaca WS 1-minute stream
  (`internal/alpaca/stream.go:252-269`) is confirmed architecturally independent (hardcodes
  `TIMEFRAME_1MIN` directly, never calls `internal/timeframe` or the REST ingester,
  never persisted) — **decision: leave it as-is, no changes needed.**
  Reused patterns identified: `resolveIngestTimeframes`' comma-split parsing already handles
  a one-element list (no logic change needed for FR-3, only the `defaultBarIngestTimeframe`
  constant's value); `connect.CodeInvalidArgument` (used by `DeleteBackfilledData`'s
  admin-gate) is the idiom to reuse for `GetBars`/`BackfillBars` rejection; migration `003`
  (`003_canonicalize_ohlcv_timeframe`) is the template if historical-row deletion is chosen.
- Both recon subagents independently flagged the same tool-output anomaly noted in the
  prior session's entry (a `system-reminder`-styled block encountered while this session's
  earlier `git merge`/renumbering ran concurrently) — no new occurrence this round; not
  repeated here beyond this pointer.

## Session 2026-08-16 — sdd-design Phase 1 (grilling, 2 rounds)

- **Round 1**: proposer laid out proto → marketdata → ingest → agent → UI with 3-layer
  `INVALID_ARGUMENT` rejection, no migration, `internal/timeframe` untouched, UI selector
  removed entirely. Adversary found (no Floor breach): `GetDataCoverage` was a third
  timeframe-resolving RPC missing from the rejection scope; `docs/runbooks/mcp-tools.md` +
  `plugins/strat-lab/skills/backtest/reference/backfill.md` needed same-PR updates (root
  `CLAUDE.md`'s binding same-PR rule for `trigger_backfill`); ingest's chunk-retry loop
  treats *any* exception (including a permanent `INVALID_ARGUMENT`) as transient and retries
  it 3× — a real bug this feature's own new rejection would newly trigger. User chose "run
  another round" at the round-1 gate rather than approving.
- **Round 2**: proposer revised — GetDataCoverage back to permissive (FR-1/FR-2 don't name
  it), step order reversed (UI/agent/ingest first, marketdata last, to avoid the retry-storm
  window), and alias tables "shrunk to single-entry" as a DRY fix. Adversary **caught a real,
  code-verified defect**: the single-entry claim would silently drop the legitimate `"1Day"`
  alias spelling and break the historical/resumed-job read path (`_STR_TO_ENUM` is
  dual-purposed), breaking 4 named existing tests. Adversary also argued the step-order
  reversal was net-worse (leaves the authoritative RPC layer open longest, to *any*
  uncovered caller, and doesn't touch the background poller) and recommended reverting to
  round 1's order with the retry-fix pulled forward instead.
- **Synthesis** (this session, not a subagent): kept round 1's step order (marketdata first,
  retry-fix pulled forward) + round 2's GetDataCoverage-permissive call (cleaner
  FR-1/FR-2-scoped reasoning, not the weaker "consistency with Delete" framing) + a corrected,
  per-table alias-survivor spec (not literal single-entry) naming the exact 4 tests + 2
  hardcoded strings to update. Presented to user; **approved** without a third round.
- Constitution rules touched: C-01, C-04, C-05, C-09, C-14, P-02, P-03, F-04 (all honored, no
  breach — see `design.md` § Constitution Rules Touched for how each was honored).
- Floor breaches: none in either round.
- Status: `spec-ready` → `design-approved`.
- **Ledger write** (P-05, reusable pattern surfaced): the round-2 "single-entry alias table"
  claim was a fresh, concrete recurrence of the exact absence-claim pattern
  `080-fix-backfill-timeframe-enum` already named in `fails.md` — worth reinforcing with a
  new dated entry since it recurred inside the *design* phase (proposer→adversary), not just
  execution, showing the trap applies to LLM-proposed refactors, not only human-authored
  specs. See `docs/roadmap/ledger/fails.md` new 2026-08-16 entry.

## Session 2026-08-16T14:51:46Z — sdd-spec

- Generated `implementation-spec.md` with 10 steps (proto → proto-gen → marketdata service+test →
  ingest service+test → agent service+test → ui service+test). Status: `design-approved` →
  `implementation-ready`.
- `recon.md` was present and reused directly as Codebase Evidence per Step 1.5's "reuse first"
  rule; only re-discovered detail `recon.md` didn't already cover at line-level (exact code
  snippets for every edit site, test file contents, doc files not yet grepped).
- **Three corrections to `design.md`, each independently grep/read-verified before being written
  into the spec (not silently trusted)** — recorded in the spec's own Execution Summary so
  `/sdd-execute` sees them without re-deriving:
  1. `plugins/strat-lab/skills/backtest/reference/backfill.md` does **not** document `15m`/`1h` —
     `grep -rniE "15m|1hour|15min|timeframe" plugins/` returns nothing. `design.md` § Chosen
     Approach point 4 named this file as a same-PR edit target alongside `mcp-tools.md`; only
     `mcp-tools.md` actually needs the edit (Step 7). Not editing a file with nothing to change
     avoids an empty/no-op diff that would fail review scrutiny for touching an unrelated file.
  2. `/insights/backfills/page.tsx`'s `TIMEFRAMES` const feeds **two** forms with opposite
     requirements — the create-backfill form (must narrow per FR-5) and the delete-scope form
     (must stay permissive per `design.md`'s own `DeleteBackfilledData`-stays-permissive
     decision). `design.md` § Chosen Approach point 5 described a single uniform narrowing of
     that const, which would have silently broken the delete-scope form's ability to target
     historical `15m`/`1h` rows — contradicting `design.md`'s own stated intent one paragraph
     earlier. Step 9 instructs removing the create-form's select entirely (hardcoding
     `TIMEFRAME_1DAY`) while leaving the shared `TIMEFRAMES` const and the delete-scope select's 3
     entries untouched.
  3. Three more tests break than `design.md`'s named four:
     `test_ingest_servicer.py::test_enum_only_request_persists_canonical_string` (sends a `15m`
     enum-only request and asserts it's queued — inverted by Step 5's new rejection),
     `chart-panel.spec.ts`'s `'1d is the active timeframe by default'` (a third test in that file
     depending on the removed `Tabs`, not the two `design.md`/`recon.md` name), and
     `chart.test.ts`'s `'maps each supported timeframe to its hardcoded proto enum'` (a vitest
     unit test neither `recon.md` nor `design.md` mentions at all, breaks at `tsc` once
     `Timeframe` narrows). Found by grepping each file directly rather than re-deriving
     `design.md`'s reasoning — the same "count claims are absence claims" trap `fails.md`
     (2026-07-30) already named for this exact feature area, now caught before execution instead
     of during it.
- Also verified (not just trusted) `design.md`'s own per-table alias-survivor plan before writing
  Steps 5/7: confirmed `_canonical_timeframe` checks `_ENUM_TO_STR` (from the unchanged
  `_STR_TO_ENUM`) before falling back to `_TF_ALIASES`, so narrowing `_TF_ALIASES` alone does
  **not** gate acceptance — the new explicit `if canonical_tf != "1d": abort(...)` check in
  `TriggerBackfill` (not named as its own mechanism in `design.md`'s prose, only implied by
  "rejected... at the ingest handler's own validation point") is what actually gates it. Also
  confirmed via `grep -rn "1Hour\|15Min" services/xstockstrat-ingest/` that no test/fixture/
  migration in the repo ever exercises those two raw alias spellings as a stored value, making
  `design.md`'s narrower `_TF_ALIASES` (keeping only `"1d"`/`"1Day"`) safe for the dual-purpose
  `_row_timeframe` read path.
- Key codebase findings not previously in `recon.md`:
  - `services/xstockstrat-marketdata/internal/service/marketdata_service.go`'s `GetBars` calls
    `s.markWarm(req.Symbol)` **before** resolving `canonicalTf` — the reject check requires
    reordering `markWarm` to after resolution, not just inserting a check inline.
  - `services/xstockstrat-ingest/app/repositories/backfill_chunks.py`'s `_BARS_PER_DAY.get(timeframe, 1)`
    default (both call sites) means dropping `"15m"`/`"1h"` keys cannot `KeyError` — confirmed
    `plan_chunks` is only reachable for a newly-planned job (never a resumed one), so after Step
    5's reject check it is only ever called with `"1d"`.
  - `services/xstockstrat-marketdata/CLAUDE.md`, `services/xstockstrat-marketdata/docs/context-constitution.md`
    (`MARKETDATA-2`), `services/xstockstrat-ingest/CLAUDE.md`,
    `services/xstockstrat-ingest/docs/context-constitution.md`, and `docs/runbooks/historical-backfill.md`
    all document the pre-143 `15m,1d`/`15m`-accepting behavior and need same-PR updates (root
    `CLAUDE.md`'s Teardown rule + the ledger's 2026-07-20 "five discovery surfaces" insight for
    `trigger_backfill`) — folded into Steps 3, 5, and 7 respectively rather than left implicit.
- No DB migration step — `design.md` explicitly rejected that alternative; historical `15m`/`1h`
  rows stay inert, `GetDataCoverage`/`DeleteBackfilledData` stay permissive on purpose.

## Session 2026-08-16 — sdd-review impl-spec (advisory)

- Result: 1 Floor-adjacent finding, 3 warnings, 0 other failures (advisory — did not block).
  All fixed in-place in `implementation-spec.md` before execution starts (no step has run yet,
  so editing step bodies here is not an F-09 immutable-during-execution violation):
  - Step 7: **[x] fixed** — `**Files**` list was missing `docs/runbooks/historical-backfill.md`
    despite Instructions step 5 requiring edits to it (F-08/F-09 risk: `/sdd-execute` may only
    stage files listed in a step's Files section). Added.
  - Step 7: **[x] fixed** — added an explicit one-line acknowledgment that the strat-lab
    same-PR governance rule (root `CLAUDE.md`) was checked against this step's narrowing of
    `trigger_backfill`'s contract and found vacuously satisfied (the target file doesn't exist
    and no `plugins/strat-lab/` file mentions timeframe values).
  - Step 10: **[x] fixed** — Verification used `pnpm run test:unit` (no coverage enforcement);
    swapped for `pnpm run test:coverage`, matching Steps 4/6/8's explicit-threshold pattern.
  - Step 2: **[x] no action needed** — directory-vs-file paths in a proto-gen step's Files list
    is inherent to codegen (the generated file set isn't enumerable pre-generation); the
    Verification step's `git diff --stat` bounds the diff scope precisely. Advisory only.
- Overlap findings: **FAIL-level file collision** — `services/xstockstrat-ui/src/app/trader/positions/[symbol]/page.tsx`
  is targeted by this feature's Step 9 (removes the `timeframe`/`onTimeframe`/`Tabs` selector
  from `SymbolPriceChart`) and by `125-unified-symbol-page` (in-progress, most steps `done`,
  8 separate steps list this file as modify — including Step 8, which restructures the exact
  same `SymbolPriceChart` component signature/JSX region this feature's Step 9 also edits).
  Confirmed live on the current checkout that 125's restructuring has already landed while the
  `timeframe`/`onTimeframe`/`Tabs` identifiers 143's Step 9 targets are still present — not a
  disjoint textual rebase, a same-region conflict. **User confirmed via `AskUserQuestion`** —
  added a blocking row to `docs/roadmap/features/merge-order.md`
  (`daily-bars-only` must wait for `unified-symbol-page`), per
  `.claude/skills/sdd-review/reference/overlap-check.md`'s router-owned write protocol.


## Session 2026-08-16 — sdd-execute (sequential mode)

Executing on `feature/daily-bars-only` (fresh branch off latest `origin/main-dev` @ `d53753f`).
The prior-session note about landing on `claude/null-fundamentals-ohlcv-gaps-l2v4x5` is
superseded — that bug-fix branch already merged (PR #971) with only 143's SDD artifacts on it,
no feature code. Part of an operator-requested sequential run of 143 then 139, one PR per feature.

- **Re-spec gate (directive: none): PASSED, no re-spec.** Re-ran every step's key Codebase
  Evidence against the live tree. All anchors match — including Step 9's `SymbolPriceChart`/
  `Timeframe`/`Tabs` citations in `positions/[symbol]/page.tsx`, which merge-order.md flagged for
  re-verification against feature 125's landed restructuring (125 is `code-completed`, its markup
  is on main-dev; the `timeframe`/`onTimeframe`/`Tabs` identifiers Step 9 targets are all present
  at the specced lines). Minor ≤2-line offsets only; no evidence mismatch, so no blocker raised.
- **Tooling setup (steps 1–10):** go1.25 ✓ · golangci-lint ✓ v2.5.0 · uv ✓ · ruff ✓ · pnpm ✓ 9.15.0
  · node22 ✓ · buf ⬇ v1.69.0 (host, via `go install`) · protoc-gen-go ⬇ v1.36.11 ·
  protoc-gen-go-grpc ⬇ v1.6.2 · protoc-gen-connect-go ⬇ v1.19.2 · grpcio-tools ⬇ 1.80.0 ·
  TS proto plugins ⬇ (pnpm install). Provisioned the host codegen toolchain pinned to CI
  `proto-freshness` versions per `docs/runbooks/codegen-toolchain-host-setup.md` (Docker present
  but host install is more reliable for the pinned plugin set). Sanity-checked: `./scripts/buf-gen.sh`
  on the unchanged tree produced an empty `packages/proto/gen/` diff — toolchain reproduces the
  committed stubs exactly.

### Step 1 — proto: deprecate TIMEFRAME_15MIN/TIMEFRAME_1HOUR [done]
- Added `[deprecated = true]` + reason to both enum values and rewrote the enum doc comment to
  state only `1d` is requestable. Comment/annotation-only, non-breaking.
- Verification: `buf lint` PASS; `buf breaking --against feature/daily-bars-only` PASS (no findings).
- Files modified: `packages/proto/common/v1/common.proto`
- Deviations: none. TDD: N/A (proto — verified by buf lint/breaking).

### Step 2 — proto-gen: regenerate stubs [done]
- Ran `./scripts/buf-gen.sh`. Diff confined to `gen/*/common/v1/*` (8 files); field numbers
  unchanged (15MIN=5, 1HOUR=3, 1DAY=4) — only `@deprecated`/deprecation-option annotations added
  to the two enum members plus the enum doc comment. No renumbering, no other symbol change.
- Verification: `git diff --stat packages/proto/gen/` shows only common/v1 files; substantive diff
  confirmed deprecation-only.
- Files modified: `packages/proto/gen/{go,python,ts}/common/v1/*`
- Deviations: none. TDD: N/A (proto-gen — verified by deprecation-only diff).

### Step 3 — marketdata rejects non-1d GetBars/BackfillBars, narrows ingester default [done]
- GetBars: moved `markWarm` to AFTER the `canonicalTf` resolution + new reject check (so a rejected
  request never marks a symbol warm / spends an Alpaca call). BackfillBars: reject before
  `emitEvent` (no started/failed ledger pair for a never-run request). `defaultBarIngestTimeframe`
  "15m,1d"→"1d" + rewritten comment. Added permissive-by-design doc comments to `GetDataCoverage`
  and `resolveDeletePlan`. Updated marketdata CLAUDE.md (Timeframe vocabulary, bar_ingest_timeframe/
  _lookback_ms config rows, WS-bar note, StartBarIngestPoller) + context-constitution.md MARKETDATA-2.
- TDD: red → green. RED: `TestGetBars_RejectsNon1d` panicked in `markWarm` pre-reorder (proved the
  request was accepted and reached markWarm); GREEN: both reject tests pass after the reorder+checks.
- Verification: `golangci-lint run` (full module) 0 issues; full suite 63.8% coverage.
- Files modified: `internal/service/marketdata_service.go`, `CLAUDE.md`,
  `docs/context-constitution.md`, `internal/timeframe/timeframe.go` (D-1 nolint).
- Deviations: **D-1** (proto deprecation → SA1019 nolint across marketdata; scope expanded to
  `internal/timeframe/timeframe.go`), **D-2** (see Step 4). Full detail in Deviation Log.

### Step 4 — marketdata rejection coverage [done]
- Added `TestGetBars_RejectsNon1d` + `TestBackfillBars_RejectsNon1d` (InvalidArgument on 15m/1h).
- Fixed `TestResolveIngestTimeframes`'s two default-fallback subtests → `["1d"]` (D-2, not in spec's
  breaking list). Added `//nolint:staticcheck` to the deprecated-enum references in
  `internal/timeframe/timeframe_test.go` + `internal/alpaca/client_test.go` (D-1).
- Verification: full `go test ./... -race` green, total coverage 63.8% (≥40%).
- Files modified: `internal/service/marketdata_service_test.go`,
  `internal/timeframe/timeframe_test.go`, `internal/alpaca/client_test.go` (last two = D-1 scope
  expansion).
- Deviations: D-1, D-2.

### Step 5 — ingest rejects non-1d TriggerBackfill, stops retrying permanent rejections [done]
- `TriggerBackfill`: added `INVALID_ARGUMENT` reject after `_canonical_timeframe` and before
  `insert_job` (after the admin gate). Narrowed `_TF_ALIASES` → `{"1d","1Day"}` (kept "1Day" for the
  dual-purpose read path; dropped "15Min"/"1Hour" — no stored row uses them). Left `_STR_TO_ENUM`/
  `_ENUM_TO_STR` unchanged (read-path dual purpose). Narrowed `backfill_chunks._BARS_PER_DAY` →
  `{"1d":1}`. Retry loop: added `except grpc.aio.AioRpcError` BEFORE the broad `except Exception`,
  forcing `attempt = max_attempts` on `INVALID_ARGUMENT` (no backoff on a permanent rejection).
  Updated ingest CLAUDE.md (Authorization) + context-constitution.md (`_STR_TO_ENUM`/`_BARS_PER_DAY`
  no-longer-aligned gotcha).
- TDD: red → green. RED: `test_rejects_non_1d_timeframe` queued instead of aborting;
  `test_invalid_argument_stops_retrying_immediately` retried 3× (await_count=3). GREEN: both pass.
- Verification: `ruff check`/`ruff format --check` clean; full suite 192 passed, 79.26% coverage.
- Files modified: `app/handlers/servicer.py`, `app/repositories/backfill_chunks.py`, `CLAUDE.md`,
  `docs/context-constitution.md`.
- Deviations: none for Step 5 itself (D-3/D-4 are Step-6 test-construction).

### Step 6 — ingest rejection + retry-fix + chunk-density coverage [done]
- Rewrote `test_enum_only_request_persists_canonical_string` (enum 5→4, "15m"→"1d"). Added
  `test_rejects_non_1d_timeframe` and `test_invalid_argument_stops_retrying_immediately`. Deleted
  `test_density_yields_more_chunks_for_15m_than_1d`; rewrote `test_no_chunk_exceeds_bar_cap` to "1d"
  with cap=200 (forces a real 3+1 symbol split).
- Deviations: **D-3** (AioRpcError needs metadata args positionally in the installed grpcio),
  **D-4** (used `_ctx("4")` so the admin gate passes and the reject check is what fires). Both
  test-only, confined to Step 6's files. Full detail in Deviation Log.
- Files modified: `tests/test_ingest_servicer.py`, `tests/test_backfill_chunks.py`.

### Step 7 — agent narrows trigger_backfill [done]
- `client.py`: `_TF_ALIASES`→`{"1d","1Day"}`, `_TF_TO_ENUM`→`{"1d":4}`, mirror comment updated, error
  string → "expected 1d/1Day". `tools.py`: docstring narrowed. Updated `docs/runbooks/mcp-tools.md`
  (timeframe row) + `docs/runbooks/historical-backfill.md` (code comment, Timeframe Guide table +
  callouts, chunk-density line, "choose timeframe per job" line removed, Canonical-vocabulary block).
- Strat-lab governance: confirmed vacuously satisfied — `grep -rniE "15m|1hour|15min|timeframe"
  plugins/` returns zero hits; `plugins/strat-lab/skills/backtest/reference/backfill.md` exists but
  documents only the trigger→poll workflow, never a `timeframe` value → no plugin edit needed.
- TDD: red → green (see Step 8 / D-5).
- Verification: `ruff check`/`format --check` clean; no live "15m/1h accepted" claim remains
  (only deliberate deprecation-context mentions of historical rows).
- Files modified: `app/tools.py`, `app/client.py`, `docs/runbooks/mcp-tools.md`,
  `docs/runbooks/historical-backfill.md`.

### Step 8 — agent trigger_backfill narrowing coverage [done]
- Strengthened `test_trigger_validation_valueerrors` per **D-5**: probes `timeframe="15m"`/`"1h"`
  (now-rejected) instead of the always-invalid `"1w"`, so the assertion is a real red→green
  (RED: 15m accepted → reached a live gRPC call raising AioRpcError, not ValueError; GREEN: rejected
  with "expected 1d/1Day").
- Verification: full agent suite 222 passed, 75.77% coverage (≥40%).
- Files modified: `tests/test_client.py`.
- Deviations: D-5. Full detail in Deviation Log.

### Step 9 — UI removes 15m/1h chart + backfill-create options [done]
- `chart.ts`: `Timeframe` narrowed to `'1Day'`; `TIMEFRAMES`/`TIMEFRAME_ENUM` to the single member.
  `ChartPanel.tsx`: removed `POLL_INTERVALS_MS` + its auto-refresh effect, made `timeframe` a const,
  deleted the `Tabs` selector + import. `positions/[symbol]/page.tsx`: `timeframe` const, removed
  `timeframe`/`onTimeframe` props + types on `SymbolPriceChart`, deleted its `Tabs` block + the now
  unused `Tabs`/`TIMEFRAMES` imports (kept `Timeframe`/`TIMEFRAME_ENUM`/`mapBars`).
  `insights/backfills/page.tsx`: removed the create-form `<select>` + its `timeframe` state,
  hardcoded `TIMEFRAME_1DAY` in `handleCreate`; left the top-level `TIMEFRAMES` const + the
  delete-scope `<select>` untouched (DeleteBackfilledData stays permissive) with a clarifying comment.
- TDD: red → green via the type-totality backstop. RED: after narrowing `chart.ts`, `tsc --noEmit`
  failed ONLY on `chart.test.ts`'s `TIMEFRAME_ENUM['15Min']`/`['1Hour']` — every source consumer
  compiled clean, proving all were updated. GREEN: after Step 10's test fix, `tsc` exit 0.
- Verification: `tsc --noEmit` clean; `pnpm run lint` clean (remaining warnings are pre-existing in
  untouched files).
- Files modified: `src/lib/chart.ts`, `src/components/trader/ChartPanel.tsx`,
  `src/app/trader/positions/[symbol]/page.tsx`, `src/app/insights/backfills/page.tsx`.

### Step 10 — UI chart/backfill e2e + vitest coverage [done]
- `chart.test.ts`: first `it` rewritten to assert the sole `'1Day'` mapping (second, generic
  totality `it` unchanged). `chart-panel.spec.ts`: replaced the 3-buttons test with a
  `getByRole('tab').toHaveCount(0)` assertion, deleted the "1d active by default" test, rewrote the
  AC-8 test to intercept the mount's GetBars (route registered before a re-`goto('/trader/')`) and
  assert `timeframeEnum === 'TIMEFRAME_1DAY'`. No change to `backfills.spec.ts` (confirmed unaffected).
- Verification: `pnpm run test:coverage -- chart.test.ts` green (chart.ts 100%). e2e: see D-6 (Chromium
  path) + the run note below.
- Files modified: `src/lib/chart.test.ts`, `e2e/trader/chart-panel.spec.ts`.
- Deviations: D-6 (e2e Chromium executable path env var). Full detail in Deviation Log.

### Step 10 — e2e follow-up (real run, prebuilt harness)
- Ran the two specs the way CI does (`NEXT_DISABLE_STANDALONE=1 pnpm build` → `CI=true E2E_PREBUILT=1
  pnpm test:e2e`, Chromium at `/opt/pw-browsers/...`). First run: 15 passed / 1 failed — my AC-8
  rewrite captured no GetBars (ChartPanel's mount fetch races the async chart-series init and isn't
  retried). Fixed AC-8 to wait for `.tv-lightweight-charts` then change the bar-count selector as a
  deterministic trigger. **Both specs now 16/16 green.** See Deviation Log D-6 (revised).

## Session 2026-08-19 (CI: feature status automation)

- Promotion PR #985 merged to main
- Feature promoted and committed: 6cd5572193b09a153c24e4cb90e3b65708846981
- Status updated: `code-completed` → `launched`
- Launched date: 2026-08-19

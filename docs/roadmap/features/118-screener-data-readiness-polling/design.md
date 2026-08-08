# Design: screener-data-readiness-polling

**Created**: 2026-08-08
**Rounds**: 1 (quick; termination: approved — with the adversary's correctness fix incorporated into the chosen approach, not accepted as an open risk)
**Approved by**: user @ 2026-08-08 (via explicit prior direction to proceed autonomously through this session's design gates; recorded in context.md)
**Grounded in**: recon.md

---

## Chosen Approach

When a Screener scan (`services/xstockstrat-ui/src/app/insights/screener/page.tsx`) returns any
`SCREEN_RESULT_STATUS_INSUFFICIENT_DATA` row (either cause — `!r.gap` fundamentals-pending or
`r.gap` bars-insufficient, both already distinguished by the existing PR #902 badge logic at
`page.tsx:152-154,509-522`), the page automatically re-issues the **exact same** `ScreenSymbols`
request (unchanged `symbols` **and** `criteria`, not a narrowed subset) on a bounded background
poll, merges the response back into the displayed results by symbol, and stops once every pending
row resolves or a max-attempts cap is hit.

**No proto, servicer, or `xstockstrat-analysis` engine changes.** No proto change is needed: the
recheck is a plain re-send of the same `ScreenSymbolsRequest` the initial scan already built
(`page.tsx:116-138`), reusing `ScreenSymbolsRequest.symbols`/`criteria` as-is
(`packages/proto/analysis/v1/analysis.proto:387-398`). `xstockstrat-analysis`'s recon-confirmed
"conditional" status resolves to **not needed** — `screener.py`'s `screen()` (`:88-162`) already
re-evaluates whatever it's given; sending the unchanged full request is correct by construction,
with no server-side code path to touch.

**Full-scan recheck, not a narrowed one — this is the corrected core of the design.** The
proposer's initial approach narrowed the recheck request's `symbols` to only the still-pending
subset to reduce redundant work. The adversary proved this breaks `_normalize_universe`
(`screener.py:388-416`): min-max normalization is universe-relative, and with the UI's only
exposed comparators being `LT`/`LTE`/`GT`/`GTE` (`page.tsx:46-51`, no `BETWEEN`), a narrowed
recheck of exactly one pending symbol collapses `lo == hi` for every criterion, forcing
`base = 0.5` (`screener.py:403-404`) — every score in the common one-symbol-left case becomes a
content-free constant, silently violating AC-2 ("score... update[s]" implies *correctly*) and
reintroducing the exact bug class the `fix-mcp-screener-correctness` ledger entry
(`docs/roadmap/ledger/fails.md`) already burned this codebase on once — a diagnostic/summary value
derived from a truncated view of the scan universe instead of the full one, just moved from
server-side rank/floor truncation to client-side symbol narrowing. **Resolution: recheck the full
original universe every time.** This is not the compromise it first appears to be — re-verifying
the actual cost model against recon's evidence shows narrowing never bought what it claimed:
- `GetFundamentalsMulti` and `GetBars` are both TTL/DB read-through caches
  (`services/xstockstrat-marketdata/internal/service/marketdata_service.go:880-884` cache-hit path;
  `:110-173` `GetBars`, warm-marking at `:112`) — an already-resolved symbol is a cheap cache hit
  on a full resend regardless of whether the client bothers to narrow the request. Narrowing saves
  nothing on the symbols that already succeeded.
- The daily-cap counter (`CountFundamentalsFetchedToday`, gated at
  `marketdata_service.go:887-899`) only increments on a **persisted, successful** fetch — a symbol
  stuck in the fundamentals-disabled case (`fundamentalsEnabled()` gate, `:965-969`) costs **zero**
  external calls per poll (rejected before touching FMP at all), and a symbol whose live fetch
  keeps failing costs the same one live attempt whether the request is narrow or full, since the
  cache never short-circuits a genuine retry (confirmed no negative-cache/tombstone exists,
  recon.md "Codebase Map" / marketdata findings).
- The only real per-poll cost difference from resending the full request is redundant
  `ComputeIndicator`/`ExecuteFormula`/`QuerySignals` calls (`screener.py:246-337`) for
  already-`OK` rows — internal compute against `xstockstrat-indicators`/`xstockstrat-ingest`, not
  scarce third-party quota. That's a real but minor cost, and it's the price of correctness here,
  not a meaningful quota risk.

Given this, the true risk this feature must bound is narrower than either subagent originally
framed it: not "shared FMP quota depletion," but (a) not hammering FMP/Alpaca with doomed repeat
attempts on a symbol whose failure is structural (bad ticker, disabled source), and (b) never
implying a pending row will eventually resolve when it actually can't (quota-exhausted or
disabled-source cases). Both are satisfied by a bounded attempt count plus an honest terminal
message — no config-governed shared-budget knob is needed, because there is no meaningful shared
budget being spent by the polling *mechanism itself* beyond what the manual "click Run scan again"
alternative would already spend.

**UI implementation shape**, reusing the closest existing precedent
(`services/xstockstrat-ui/src/hooks/useBackfills.ts:35-45`, `useBackfillStatus`'s
terminal-state-aware `refetchInterval`):
- `useScreenSymbols` (`src/hooks/useScreenSymbols.ts`) gains a poll-capable sibling (or is
  converted) so that after a successful `runScan()`, if the response contains any
  `INSUFFICIENT_DATA` row, a background poll re-issues the identical request on an interval; its
  `refetchInterval` callback returns `false` (stopping the poll) once no row is pending, mirroring
  `useBackfillStatus`'s terminal-state gate exactly.
- `page.tsx`'s displayed `results` become explicit `useState<ScreenResult[]>` state, seeded on
  `runScan()` success and updated in place from each poll response (merge by `symbol` — safe now
  that every poll response is a *full*, correctly-normalized result set, not a partial one to
  reconcile).
- **Scan-generation guard** (new — added to close a race the adversary flagged that the proposer's
  design didn't address): each `runScan()` call stamps a monotonically incrementing local
  generation counter; the poll captures the generation it was started for and discards its
  response (does not merge, does not continue polling) if the page's active generation has since
  advanced — prevents a late-arriving poll response from a superseded scan (different
  symbols/criteria) merging stale data into a newer scan's table under a coincidentally-matching
  symbol key.
- **"Stop checking" affordance** (FR-6): a single page-level toggle next to the existing pending
  banner (`page.tsx:438-446`) that flips a local `pollingEnabled` boolean the poll's
  `refetchInterval` respects (returns `false` when off) — reset to `true` on every new `runScan()`
  (closing the "stale permanent opt-out" gap the adversary flagged: without a reset, stopping once
  would silently disable auto-recheck for every later scan in the session with no visible cause).
- **Visibility gating** (FR-5): rely on TanStack Query's default `refetchIntervalInBackground:
  false` (the same default `useBackfillStatus` already relies on with no override, recon.md
  confirms zero hand-rolled visibility code exists anywhere in the codebase to reuse or need to
  build) — `/sdd-spec` must confirm this default against the pinned `@tanstack/react-query` version
  in `package.json` before relying on it (open risk below; not independently re-verified in this
  design phase).
- **Honest terminal state**: on hitting the max-attempts cap with rows still pending, the UI shows
  an explicit "gave up — still pending" state distinct from the in-progress "checking…" state —
  never implies success or ongoing progress once checking has actually stopped. This directly
  serves the case where the root cause (disabled fundamentals source, exhausted daily quota) will
  never resolve by retrying at all.
- **Cadence/attempts**: a plain client-side TS constant colocated with `TOP_N`
  (`page.tsx:58-60`, the existing "UI display constant, not a WatchConfig key" precedent) — **not**
  a new `analysis.screener.*`/config key. This directly resolves the adversary's config-vs-constant
  objection on its own terms: that objection's premise was that the cadence protects a *shared*
  quota, which the corrected cost analysis above shows isn't actually true — there is no
  ops-team-tunable shared resource being protected, only a client UX/politeness bound, which is
  exactly `TOP_N`'s category. Concrete values: poll every 60s, cap at 5 attempts (~5 minutes total
  ceiling), fixed (no backoff) — conservative enough to never meaningfully compete with anything,
  generous enough to plausibly catch a symbol resolving on the next `marketdata.stream.bar_ingest_interval_ms`
  cycle (60s default, `recon.md` marketdata findings) or a same-minute FMP recovery.

**Scope (FR-3)**: the pending-symbol union (which drives *whether* polling runs, not the request
content — the request is always the full scan) already covers both causes uniformly by construction,
since it's derived from `status === INSUFFICIENT_DATA` regardless of `gap` presence
(`page.tsx:152-154` extended symmetrically for the `r.gap` case).

**Consumer surface (C-14)**: UI only, `/insights/screener` — same as product-spec. No Agent
surface change; the `screen_symbols` MCP tool is untouched (an agent caller retains the ability to
poll `ScreenSymbols` itself using the same unmodified RPC contract).

## Rejected Alternatives

- **Narrow the recheck request to only the still-pending symbols** (the proposer's initial
  approach) — rejected: breaks universe-relative min-max normalization
  (`screener.py:388-416`), collapsing every criterion score to a content-free `0.5` whenever
  exactly one symbol remains pending (the common tail case), silently violating AC-2 and
  reintroducing the `fix-mcp-screener-correctness` bug class at the client layer instead of
  avoiding it. Also shown to buy essentially no real quota savings once the marketdata cache
  mechanics were traced precisely (see Chosen Approach).
- **A new narrower server-side recheck RPC/field** (proto field 9 on `ScreenSymbolsRequest`,
  scoped to specific `(symbol, ref_name)` pairs still pending) — rejected: more proto/servicer/
  engine surface area for a problem (redundant compute on already-resolved rows) that turned out
  to be minor once quantified, and it would still need the *same* full-universe-aware
  normalization handling server-side to avoid the identical correctness bug, so it doesn't
  actually simplify anything — it only relocates the complexity.
- **A config-governed poll cadence** (`analysis.screener.recheck_interval_seconds` or similar) —
  rejected for now: the premise that cadence protects a shared external-API budget doesn't hold up
  once the marketdata cache mechanics are traced (see Chosen Approach); a plain UI constant is the
  right tier, matching `TOP_N`. If production experience later shows this needs runtime tuning
  (e.g. `marketdata.fmp.daily_request_cap` genuinely gets threatened by aggregate concurrent-user
  polling, a dimension this design phase had no data on), promoting it to a config key is a small,
  well-scoped follow-up, not a reason to over-build now.
- **Per-row "dismiss" instead of a single page-level "stop checking" toggle** — rejected as
  unnecessary complexity for `quick`-mode scope; a page-level toggle covers FR-6 with one
  component, matching the simplest interpretation of "the user can stop it manually."

## Open Risks

- [ ] **TanStack Query's `refetchIntervalInBackground: false` default was not independently
  re-verified against the pinned `@tanstack/react-query` version in `package.json`** — `/sdd-spec`
  must confirm this before the implementation step relies on it as the sole FR-5 visibility-gating
  mechanism; if the pinned version's default differs, a step must add explicit
  `refetchIntervalInBackground: false` rather than relying on an unconfirmed default.
- [ ] **No data on aggregate concurrent-user polling load** — this design bounds one polling
  *session's* contribution, not platform-wide concurrent usage across many simultaneous Screener
  users. Accepted as out-of-scope for this feature's size; if it becomes a real operational
  concern post-launch, promote the cadence constant to a config key (see Rejected Alternatives) —
  target: a follow-up feature, not blocking this one.
- [ ] **Repeated failed live-fetch attempts against FMP/Alpaca during the bounded polling window**
  (structurally-failing symbol — bad ticker, disabled source) are not literally free even though
  they don't threaten the internal daily-cap counter — each is still an outbound HTTP call to a
  third party. The 5-attempts/~5-minute cap bounds this to a small, fixed number per user-initiated
  scan; no further mitigation planned at this feature's scope — target: the implementation step
  that wires the poll loop, verify the cap is actually enforced (not just intended) with a test.

## Constitution Rules Touched

- `C-05` — config key naming/scoping: honored by *not* introducing a new config key — the cadence
  constant follows the existing `TOP_N` UI-constant precedent instead, since this design phase
  determined no shared, ops-tunable resource is actually being protected (see Chosen Approach).
- `C-11` — no feature implementation without minimum SDD grounding: honored — this design phase
  (`/sdd-story` → `/sdd-design quick`) ran before any implementation code was written, per the
  root `CLAUDE.md` mandatory entry point.
- `C-14` — name the consumer surface: honored — UI `/insights/screener` named explicitly in both
  product-spec.md and this design; no Agent surface change needed or claimed.
- `F-07` — never hardcode config values in source: honored in spirit, not violated — the poll
  cadence is explicitly *not* a value that should come from `WatchConfig` per this design's own
  analysis (it protects nothing shared/config-governed), so treating it as a plain TS constant
  (the `TOP_N` precedent) is the correct category, not a hardcoding violation of a value that
  should be config-driven.
- `P-01`/`P-02`/`P-03`/`P-04` — honored by this design session itself: single orchestrator wrote
  every artifact; proposer and adversary were mediated (adversary received the proposer's approach
  verbatim per the grilling protocol's explicit step, never coordinated laterally); the adversary's
  correctness objection was incorporated rather than guessed past; the gate is being recorded here
  with the user's prior explicit direction to proceed (documented in context.md) standing in for
  the interactive approval this session's `AskUserQuestion` prompts went unanswered on.
- No `F-*` Floor breach was raised by the adversary ("none — no clean, certain F-* violation").

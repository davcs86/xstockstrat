# Context: backtest-time-window

**Feature**: `docs/roadmap/features/071-backtest-time-window/feature.md`
**Product Spec**: `docs/roadmap/features/071-backtest-time-window/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/071-backtest-time-window/implementation-spec.md`

---

## Session 2026-07-26 — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- **Origin:** surfaced during in-engine validation of the `range_mean_reversion_v3` re-entry
  cooldown (feature 069). Re-running the same backtest two days apart (window start moved
  2024-07-25 → 2024-07-29) shifted a symbol's first trade because the shortened indicator warm-up
  pushed its boundary entry later — everything else matched to the digit. Also blocked a proper
  out-of-sample test: only cross-sectional OOS (new symbols) was possible, never a held-out period.
- **Known trap noted:** additive proto request fields still hard-couple the `run_backtest` MCP tool
  and any UI backtest trigger (ledger fails 056/060/067, rule C-10) — update consumers in the same
  feature with a test.

## Session 2026-07-26 — sdd-review product-spec

- **Verdict: FAIL, then PASS after re-scope.** Status: `draft` → `spec-ready`.
- **The spec's core premise was wrong.** `RunBacktestRequest.range` (`common.v1.TimeRange`,
  `packages/proto/analysis/v1/analysis.proto:34`) already exists, is honored by the servicer
  (`services/xstockstrat-analysis/app/handlers/servicer.py:273-297`, incl. the `max_range_days` cap
  and `now`-anchored defaulting), and is **already sent by the UI backtest form**
  (`services/xstockstrat-ui/src/app/insights/strategies/[id]/page.tsx:91`).
- **Proto change withdrawn.** Adding `start`/`end` would create a second, ambiguous window
  representation on a message whose wire bytes are persisted verbatim in `analysis.backtest_details`
  (`analysis.proto:60-63`). Checked `- [x] No proto changes required`; dropped the Proto Reviewer row.
- **Real scope**: (1) plumb the window through `client.run_backtest`
  (`services/xstockstrat-agent/app/client.py:143-165`) and the `run_backtest` tool
  (`app/tools.py:240-244`) — the only place the window is missing; (2) pre-window indicator warm-up
  (genuinely new engine work).
- **New requirements added from review findings:** FR-2a (one-sided windows), FR-3a
  (`max_range_days` binds the requested window, not the warm-up-extended fetch span), FR-6 (agent↔UI
  parity + feature-065 evidence-cell impact), FR-7 (**backtest/live parity** — `live_loop.py:116-121`
  builds its own window and `:133` calls the same shared evaluator, a documented parity invariant
  that FR-3 could silently break).
- AC-3 restated against a frozen clock — the `now`-anchored default makes cross-day byte equality
  impossible by construction, so the original "byte-for-byte" wording was unverifiable.
- Resolved OQs: `Timestamp` vs ISO string (moot — `TimeRange` already uses `Timestamp`);
  `max_range_days` applicability (answered declaratively by FR-3a).
- **Observation, out of scope:** `live_loop.py:126` queries `GetBars` with `timeframe="1Day"` while
  the backtest path uses the canonical `"1d"` (feature 053 fixed that mismatch for backtests only).
  Possible latent defect; not touched — flagging for a separate triage.
- **Deviation:** implemented on the harness-assigned branch `claude/features-070-071-rnbkqo`
  (rebased onto `main-dev`) rather than `feature/backtest-time-window` with per-step PRs, because the
  harness pins the branch. Features 070 and 071 share this one branch/PR.

## Session 2026-07-26 — sdd-design

- Phase 0 Recon: wrote `recon.md` (services: analysis, agent, ui). Key reuse: `_iso_to_timestamp`
  (`agent/app/client.py:35-41`), the `trigger_backfill` one-sided `TimeRange` template (`:705-712`),
  the shared-pure-module pattern from ledger 069 (`app/services/cooldown.py`).
- Phase 1 Grilling: **2 proposer rounds + 2 adversary passes** (mode `quick`, extended by one round
  because round 1 hit a Floor breach).

### Round 1 — BLOCKED (F-07)

Proposed a `WARMUP_PREFIX_DAYS = 365` constant, defended as "sizing-only, verified at runtime by
`p >= w`". **The defense was provably false.** Verified directly in
`services/xstockstrat-indicators/app/services/indicators_engine.py`: `_ema` (`:48-51`), `_macd`
(`:62-84`) and `_vwap` (`:110-118`) return `float(v)` with **no `None` head**, so
`_first_resolved_index` (`analysis servicer.py:1582-1588`) returns 0 ⇒ `w == 0` ⇒ `p >= w` is
trivially true. The runtime check was **inert exactly for the indicators the prefix affects most**.
Round 1 also (a) applied the prefix to the *defaulted* range, which needs `730 + 365` days of history
and would flip ordinary symbols to `INSUFFICIENT_DATA` — a direct FR-2 violation; (b) forced
`warmup_bars = 0`, orphaning three live UI surfaces with no compile-time protection (the *inverse* of
ledger fail 067, and worse because TypeScript cannot catch an enum value becoming unreachable);
(c) claimed OQ-3 `trading_days` would be bit-identical — false, see below.

### Orchestrator steer (all three dictated by already-approved artifacts, not new choices)

1. F-07 → derive the prefix from declared params (product-spec OQ-2 already stated deriving is preferred).
2. FR-2 is binding → prefix only when the caller set `start`.
3. recon Risk 2 + C-10 → keep `warmup_bars` meaningful via an explicit `trade_start_idx`.

### Round 2 + verification pass — corrections that changed the design

- **The loop restructure was NOT a no-op at `k = 0`.** `for i in range(trade_start_idx, n)` with an
  unconditional append makes `i=0` append without simulating ⇒ `len(daily_equity) == n+1` (today it
  is `n`), perturbing the returns series, moving `trading_days` `n-1 → n`, and shifting every
  `diags[i].equity` stamp. **Corrected to `range(max(1, trade_start_idx), n)`.**
- **`diags` ↔ `daily_equity` seam.** The diagnostic passes are *separate* loops (`:634`, `:829`).
  Decided: slice `diags` to the in-window bars and renumber `bar_index`, `bars_total = n - k`, plus an
  explicit `len(daily_equity) == len(diags)` assertion in **both** paths (ledger 056 / C-10(b) — the
  two loops are structurally different).
- **EMA/MACD were under-warmed.** `ewm(adjust=False)` is IIR: after `period` bars the seed still
  carries `e^-2 ≈ 13.5%` weight, so `period` fails FR-3's "already warm" and manufactures a fresh
  backtest/live divergence. Adopted a `3×` convergence multiplier (residual < 0.3%); cost is only
  discarded fetch volume.
- **MACD lookback fixed to `max(fast, slow) + signal`** — nothing validates `fast <= slow`
  (`_validate_definition` never checks params), so `fast=50, slow=26` would under-warm.
- **The empty-token pagination probe was dead code** — `QueryBars` uses `LIMIT pageSize+1` and sets a
  token iff `len > pageSize` (`marketdata_repo.go:92`, `:130-135`), so a full page with no token is
  genuine EOF. It was also mis-specified (a naive `isoformat()` token is rejected by
  `time.Parse(RFC3339Nano, …)`, silently re-serving page 1). **Dropped.**
- **`_MAX_BAR_PAGES` exhaustion must RAISE**, never return a partial series — otherwise a hardcoded
  constant silently truncates as a function of the config-driven `analysis.backtest.max_range_days`,
  which would itself be an F-07 breach. This single sentence is what clears the Floor.
- **The `+1` in every rolling lookback is the crossover reference** (`crosses_above`/`crosses_below`
  read index `i-1`, `evaluator.py:447-448`), not a fudge — recorded in `warmup.py`'s docstring.

### Decisions

- Prefix derived per-strategy from declared params; `prefix_calendar_days(P) = ceil(P*1.6)+10` is
  sizing-only because the engine truncates to exactly `P` (surplus discarded, deficit reported),
  pinned by a factor-doubling byte-identity test.
- **OQ-3 answered honestly (round 1 was wrong):** today's max-range runs are *already* silently
  truncated at 500 bars, so correct pagination is itself a behavior change — `trading_days` 499 → ~503.
  Existing evidence cells are **left as-is, not invalidated** (~0.8% shift is immaterial against
  `k = 250` shrinkage). Pagination applies to the default path too.
- **OQ-4/FR-7:** backtest path only; the live loop is untouched. FR-3 does **not** close the parity
  gap — `live_loop.py` keeps its ~252-bar window with no shortfall detection. Divergence documented
  and pinned by two tests.
- **VWAP anchor moves** for any strategy mixing VWAP with a longer-lookback component (`P` is the max
  over refs). Deterministic, but different from today — documented + pinned.
- No proto change, no migration, no new config key.

### Open Threads

- Loop restructure must land at `trade_start_idx = 0` with **byte-identical** results before any
  prefix code exists (target: step 3).
- Built-in default periods duplicated in analysis; pinning test lives in `xstockstrat-indicators` and
  must name `warmup.py` as the consumer (target: step 1).
- Custom-formula sandbox cost measurement (target: step 6).

### Deviation — P-04 phase gate

The design gate was **auto-approved by the orchestrator** rather than by an explicit user
confirmation: the session's standing instruction was "work on the features 070 and 071" and no
interactive user was present across the design phase. All three steering decisions were dictated by
the already-approved product spec (FR-2, OQ-2) and the Constitution (F-07, C-10), not by orchestrator
preference, and the Floor breach was independently re-verified before clearance. Recorded here per
P-04 so the unapproved gate is auditable.

- Status: `spec-ready` → `design-approved`.

## Session 2026-07-26 — implementation (steps 1–2 of 8)

- **Step 1 DONE** (`a1cf158`) — `app/services/warmup.py`: declared pre-window sizing.
  33 unit tests + 10 pinning tests in `xstockstrat-indicators` whose failure messages name
  `warmup.py` as the consumer to update.
- **Step 2 DONE** (`a8cf5cf`) — `_fetch_bars_paged` replaces the un-paged `GetBars` in **both**
  engine paths. Monotonic-cursor guard + page cap that **raises** instead of truncating.
  8 pagination tests. Suite 318 green, ruff clean.
  - Deviation from the design's stated plan: the design said the empty-token probe was dropped;
    confirmed correct in implementation — no probe was written.
  - Test fakes had to be corrected: `SimpleNamespace(bars=…)` lacked `page` entirely, and
    `MagicMock()`-based fakes auto-create a **truthy** `page.next_page_token`, which reads as
    "another page exists". Both now model EOF via a shared `_EOF_PAGE` sentinel. This was a fake
    modelling bug, not a production-code accommodation — no `getattr`/`isinstance` softening was
    added to `_fetch_bars_paged`.
- **Steps 3–8 NOT started**: `trade_start_idx` plumbing (with the byte-identical gate at `k = 0`),
  prefix wiring, agent `start`/`end` surface, parity/determinism tests, docs, UI e2e.

### Environment note

`buf` 1.72.0 provisions fine from GitHub releases, but full codegen also needs the Go plugins,
the node plugins from `packages/proto/gen/ts` devDependencies, and `grpcio-tools`, then a
byte-identical reproduction check against the committed stubs (ledger insight 2026-07-09) before
any `.proto` edit. Not attempted this session. **071 needs no proto change, so it is unblocked;
070 is blocked on this.**

## Session 2026-07-26 — implementation (step 3)

- **Step 3 DONE.** `trade_start_idx` threaded through both engine paths, landed at `k = 0`
  everywhere. **Gate met: 332 → 338 tests, all pre-existing ones unchanged** — the restructure is a
  verified no-op on the default path before any prefix code exists.

### The seed-row arithmetic — the design's own version was off by one

The design said "loop from `max(1, trade_start_idx)`" and "`diags` slices to `[k:]`,
`bars_total = n - k`", with `len(daily_equity) == len(diags)`. Those three cannot all hold:

- `k = 0`: seed + `range(1, n)` → `n` equity points, `diags[0:]` → `n`. ✓
- `k = 1`: seed + `range(1, n)` → `n` equity points, `diags[1:]` → `n-1`. ✗

The seed row exists because bar 0 is never simulated on an unprefixed run. With a prefix, the
first simulated bar **is** bar `k`, so there is no separate seed. Implemented as
`daily_equity = [equity] if trade_start_idx == 0 else []`, which satisfies both:
`k = 0` → `n`/`n`; `k > 0` → `n-k`/`n-k`. Documented inline at both call sites.

### The 1:1 invariant is now asserted, not assumed

`_finalize_symbol_diagnostics` stamps `diags[j].equity = daily_equity[j]` **positionally**, and
that alignment was previously implicit. Added an assertion in the shared finalize pass — shared
because the two paths build the lists differently (the legacy loop has two `continue`-with-append
branches, the evaluator appends unconditionally), which is precisely the ledger-056
"fixed one path, forgot the second" shape.

### k > 0 verified now, not deferred

Rather than land the plumbing untested and discover the off-by-one in step 4, `TestTradeStartIndex`
exercises `k ∈ {1, 3, 5}` directly against `_backtest_symbol`: `bars_total == n - k`, `bar_index`
renumbered from 0, `len(daily_equity) == len(diags)`, the first in-window bar keeping its **real**
timestamp (renumbering the index must not shift time), and no trade or diagnostic row before the
window.

### Remaining for 071

Steps 4–8: wire the prefix end-to-end (`start_set` → `warmup_prefix` → `required_prefix_bars` →
prefixed fetch → truncate to exactly `P` → `trade_start_idx` → `to_reported_warmup` → shortfall
`CoverageGap`), agent `start`/`end` surface, parity/determinism tests, docs, UI e2e.

## Session 2026-07-26 — implementation (step 4)

- **Step 4 DONE.** Prefix wired end-to-end: `start_set` → `warmup_prefix` → `required_prefix_bars`
  → prefixed fetch → truncate to exactly `P` → derived `trade_start_idx` → window-relative
  `warmup_bars` → shortfall `CoverageGap`. 338 tests, ruff clean.
- Shared `_resolve_prefixed_bars` serves both engine paths, so the prefix logic exists once.
- `trade_start_idx` is now **derived**, so step 3's parameter was removed rather than left as a
  dead knob the production path always overwrites. The step-3 tests were reworked to drive the
  real path (bars straddling `range_msg.start` + `warmup_prefix=True`) instead of injecting `k`.
- `_InsufficientData` gained `gap_range`: for a warm-up shortfall the actionable backfill span is
  the **prefix** (`start − warmup … start`), not the caller's window, which may be fully covered.

### ⚠ Behavior change that needs a product decision

**Any caller supplying an explicit `start` now needs pre-window history or the run reports
`INSUFFICIENT_DATA`.** This is the designed OQ-1 resolution ("prefer a clear error over silent
short data", AC-4a) and it is working as specified — but the practical blast radius is larger than
the design's Open Risks quantified:

- **The UI always sends an explicit range** (`strategies/[id]/page.tsx:91`, defaulting to
  `2024-01-01`/`2024-12-31`). Every UI backtest whose start predates the symbol's stored history
  now fails instead of running short-warmed.
- It surfaced immediately in `TestBacktestRangeCap::test_at_cap_range_runs`, whose fixture bars all
  post-dated the requested start. Fixture corrected to straddle the boundary — the test's intent
  was the range cap, not coverage — but that it broke at all is the signal.

The adversary's **alternative E (short-warm-and-report:** run with whatever prefix exists, emit a
**non-fatal** `CoverageGap`, keep the run OK) was rejected at design time in favour of failing
loudly. Given the UI impact, that trade-off is worth revisiting before this ships. Flagged to the
user rather than silently switched — the design decision is recorded and reversing it is a product
call, not an implementation one.

### Remaining for 071

Steps 5–8: agent `start`/`end` surface, parity/determinism tests (FR-4/6/7), docs, UI e2e.

---

## Session — 2026-07-27 (steps 5–8)

### Step 5 — agent surface

`client.run_backtest` and the `run_backtest` MCP tool take optional ISO `start`/`end`, mapped onto
the **same** `RunBacktestRequest.range` the UI already sends. FR-6 parity is therefore structural,
not a behavior two call sites have to keep in step: there is one field and one server path.

- Omitting both leaves `range` **unset** rather than sending an all-zero message, so the servicer's
  rolling default applies and FR-2 holds exactly.
- One-sided ranges are forwarded as-is — the servicer defaults each unset bound independently, so
  fabricating the missing side would silently narrow the window.
- An inverted window is rejected client-side. Left to the server it would run an empty window and
  report `INSUFFICIENT_DATA`, naming the symptom rather than the mistake.
- The tool docstring leads with the reproducibility payoff, not the mechanics: the decision an agent
  actually faces is *whether* to pass a window, and it needs to know that omitting it makes results
  drift day to day. It also names `trigger_backfill` as the remedy for the new `INSUFFICIENT_DATA`.

### Step 6 — parity/determinism, and a bug the tests found

**Deviation (P-03): a real defect fixed outside the designed step list.** The formula-cost test
showed `required_prefix_bars` reading the declared-warm-up cache at the **top** of each symbol's
run while `_compute_evaluated_warmup` only fills it at the **bottom**. For a formula-using strategy
that meant symbol 1 sized its prefix from an empty cache (no prefix, short-warmed) while symbols 2+
got the full one — a result that depends on symbol order, breaking FR-4 determinism and the
per-symbol comparability the feature-065 evidence cells assume. `_prefetch_formula_warmups` now
resolves them before the loop, honoring the contract `required_prefix_bars`' own docstring already
stated ("must be pre-populated by the caller"). A shared `_declared_formula_warmup` keeps the two
call sites from drifting.

Tests added: FR-4 frozen clock (plus a *teeth* test proving the clock patch isn't inert — without a
window the effective range genuinely moves); FR-3 no-trade-before-start at the RPC level; prefix
sizing insensitivity from both sides (doubling the calendar slack, and extra available history);
the VWAP anchor shift pinned at its cause (VWAP receives prefix+window closes); the FR-7 live-loop
divergence (`_LOOKBACK_DAYS == 365`, `live_loop.py` free of any `warmup` reference, and the
evaluator signature carrying no window argument — so it fails loudly if someone later wires the
prefix into the live path); and formula prefix cost measured, including the one-GetFormula-per-run
guarantee.

Two **fixtures** were wrong rather than the code: `_series_bars` derived each close from the list
index, so lengthening the prefix silently restated the whole series and the surplus-history test
was comparing two different price histories; and the zero-warm-up cost test fed pre-window bars to
a path that requests no prefix, where the range-ignoring `GetBars` mock lets them through. Both now
measure the code instead of themselves.

Byte-identity assertions clear `backtest_id` and `completed_at` — both differ per run by
construction, so leaving them in would make the assertion vacuously false and invite a weaker
field-by-field comparison.

The `warmup` module is imported aliased in the test file: a pre-existing test uses `warmup` as a
loop variable, and renaming that is not this feature's business.

### Step 7 — docs

`mcp-tools.md` documents the parameters plus the two consequences an agent cannot infer from the
signature (pre-window `coverage_gaps` → `trigger_backfill`; the VWAP anchor shift). The analysis
`CLAUDE.md` gains the warm-up prefix section: declared-not-observed and why observing is provably
wrong, the sizing-only conversion, the fatal shortfall, the formula prefetch, the `GetBars`
pagination fix and its `trading_days` shift, and the FR-7 divergence with a pointer to its test.

### Step 8 — UI

**No UI production change is required — verified.** `strategies/[id]/page.tsx:312` already backfills
`gap.gap`, not `gap.requestedRange`, which is the correct span now that the two differ.

`e2e/mock-backend.ts` previously echoed `req.range` back as both `requestedRange` and `gap`, so it
could not distinguish a correct consumer from an incorrect one. It now returns a **disjoint
pre-window gap** via the new `e2e/fixtures/backtests.ts` (C-12), and an e2e test asserts the
backfill span ends where the requested window begins and reaches back before it.

C-12: the coverage-gap half of the "Backtest results / diagnostics / coverage gaps" inventory row is
now centralized and catalogued; the diagnostics sentinels and run-history rows stay inline and the
row was narrowed to say so, rather than left claiming more than moved.

### Still open

**OQ-1 remains a product decision** (see the previous session's entry): fail-loud vs. short-warm
with a non-fatal `CoverageGap`. Unchanged by steps 5–8 — the agent surface simply makes it reachable
from a second caller.

---

## OQ-1 resolved — 2026-07-27 (user decision)

**Keep fail-loud, as built.** When history cannot satisfy `start − warmup`, the run reports
`BACKTEST_STATUS_INSUFFICIENT_DATA` with a `CoverageGap` spanning the **pre-window** span. The
designed AC-4a behavior stands; the rejected alternative (short-warm + non-fatal `CoverageGap`) stays
rejected.

This was raised as a product decision rather than resolved in implementation because the practical
blast radius is wider than the design's Open Risks quantified — the UI always sends an explicit
range (`strategies/[id]/page.tsx:91`, defaulting to `2024-01-01`/`2024-12-31`), so a backtest whose
start predates a symbol's stored history now fails where it previously ran short-warmed. The user
accepted that cost.

**What makes it recoverable rather than a dead end:** the gap the run reports is the actionable one.
`_InsufficientData.gap_range` carries `start − warmup … start`, not the caller's window, and the UI's
backfill action already fills `gap.gap` — verified, and now pinned by
`e2e/insights/backtest-coverage.spec.ts` ("backfill action fills the pre-window warm-up gap"). So the
failure names the exact span to backfill and offers a one-click remedy. The agent path says the same
thing in prose: the `run_backtest` docstring names `trigger_backfill` as the remedy.

No code change follows from this decision — the implementation already matches it. 071 moves to
`code-completed`.

## Session 2026-07-28 (CI: feature status automation)

- Promotion PR #797 merged to main
- Feature promoted and committed: 67bf345b917b05b869fc67cacff5d74365ba86b8
- Status updated: `code-completed` → `launched`
- Launched date: 2026-07-28

# Context: strategy-reentry-cooldown

**Feature**: `docs/roadmap/features/069-strategy-reentry-cooldown/feature.md`
**Product Spec**: `docs/roadmap/features/069-strategy-reentry-cooldown/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/069-strategy-reentry-cooldown/implementation-spec.md`

---

## Session 2026-07-24T07:05:26Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- Motivating evidence: MCP-tool-driven shadow-strategy validation session (no production strategy
  touched) that fixed a sandbox bug in two custom formulas (`rolling_zscore_v2`,
  `kaufman_efficiency_ratio_v2`) for a `range_mean_reversion_v2` shadow strategy, then tested a
  bounded-exit variant `range_mean_reversion_v3` (adds `er>0.5 OR z<=-3.0` bail-out conditions to
  the `z>=0` exit). v3 improved the 10-symbol basket aggregate materially (total_return -8.42%→
  +1.23%, max_drawdown 53.1%→36.3%) but degraded WSM specifically (win rate 66.7%→46.7%, Sharpe
  -0.55→-1.07) because the tightened exit stopped it out and the entry condition immediately
  refired on the same still-declining symbol, four times within about a month — confirmed in code
  at `services/xstockstrat-analysis/app/handlers/servicer.py:849`
  (`if position == 0.0 and decision.entry:`, no recency check). This feature is the fix for that
  specific whipsaw mechanism.
- User directed the default cooldown to be wash-sale-safe: 31 calendar days (outside the IRS
  30-day-each-side wash-sale window), configurable per strategy via a new
  `analysis.strategy.default_cooldown_days` config key and `StrategyDefinition.cooldown_days` field.
- No production strategy or shadow strategy has been modified as part of this `/sdd-story` step —
  this is spec-only.

## Session 2026-07-24 — product-spec review with user

Reviewed Out of Scope / Open Questions with the user and resolved three previously-open decisions:

1. **Cooldown trigger**: any exit (win or loss), not losses-only (FR-5). Wash-sale rule motivates
   the *default duration* only, not the trigger condition.
2. **Restart durability**: live-loop cooldown state MUST persist across restarts (FR-8) — this
   reverses the original draft's "in-memory only, out of scope" stance. Added new migration
   `009_strategy_cooldowns` (next free number after `007_backtest_run_symbols`) to Database Changes,
   added DBA to feature.md Reviewers, added DBA approval gate to Feature Workflow Notes.
3. **Cross-stock score fingerprint**: `cooldown_days` IS included (FR-9) — no exclusion added to
   `_definition_fingerprint`'s existing `display_name`/`active`/`live_enabled` exclusion list.

Also converted the "shared cooldown-check helper" open question into a hard requirement (FR-4) —
this repo's ledger (`fails.md`, 056-open-positions-ui) already records the exact failure mode of two
independently-implemented read paths drifting apart, so it isn't a genuine open design choice.

Added FR-7 (new) to explicitly guard against a reproducibility hazard the restart-durability
decision introduces: backtests must stay ephemeral/per-run and never read/write the new persisted
`strategy_cooldowns` table, or two unrelated backtest runs (or a backtest overlapping live trading)
would cross-contaminate each other's entry decisions. Added corresponding Acceptance Criteria 7–9
(restart-survival test, backtest-reproducibility test, fingerprint-change test).

Remaining Open Questions (both implementation-shape, deferred to `/sdd-design`): exact
`strategy_cooldowns` column/index shape, and whether the live-loop write is synchronous or
best-effort-deferred.

Next action unchanged: `/sdd-review strategy-reentry-cooldown product-spec`, then
`/sdd-design strategy-reentry-cooldown quick`.

## Session 2026-07-24 (cont.) — scope clarification with user

User asked two clarifying questions:

1. "Are the cooldown days per ticker?" — confirmed and left as-is: the *duration* (`cooldown_days`)
   is one value per strategy (not configurable per symbol); the *enforcement clock* (last-exit
   timestamp) is tracked per `(strategy_id, symbol)` pair, so each traded symbol gets its own
   independent timer using that same duration. User accepted this as designed (no spec change).
2. "Are UI and agent in scope?" — they were NOT in the original Affected Services list. Checked the
   actual code and confirmed a real gap: `services/xstockstrat-agent/app/tools.py:290-345`
   (`manage_strategy` tool) has an explicit parameter allowlist that would not forward
   `cooldown_days` even after the proto field exists, and
   `services/xstockstrat-ui/src/components/insights/StrategyWizard.tsx:115-128` (`handleSubmit`)
   builds the definition payload with no cooldown field — same "shipped the producer, forgot the
   consumer surface" shape as ledger entries 056/060/066. User directed: expand scope to both.

Added FR-10 (agent: `manage_strategy` gains `cooldown_days` param + `docs/runbooks/mcp-tools.md`
parameter table update) and FR-11 (UI: `StrategyWizard.tsx` gains a cooldown input, flows through
`handleSubmit`). Added `xstockstrat-agent` and `xstockstrat-ui` to Affected Services, feature.md
Reviewers, and the approval-gate checklist (now "service owner approval from each affected service"
rather than singular). Added Acceptance Criteria 10 (agent round-trip) and 11 (UI e2e coverage in
`e2e/insights/`).

Explicitly scoped OUT of FR-10 (and noted why): the agent `CLAUDE.md` tool table and
`docs/runbooks/CLAUDE.md` index, since the 066 "five discovery surfaces" ledger insight applies to a
*new* tool, not a parameter added to an existing one — only the tool signature/docstring and the
`mcp-tools.md` parameter table need updating here.

## Session 2026-07-24T07:05:26Z (cont.) — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Criteria pass (spec-reviewer): PASS WITH WARNINGS. No BLOCKERs, no Floor (`F-*`) breaches. Every
  code citation in the spec re-verified against the live codebase (proto field 9, migration `008`
  numbering, `servicer.py:849`, `_definition_fingerprint` exclusion list at `servicer.py:1678`,
  `live_loop.py:54,125-144` `_last_state`, `tools.py:290-345`, `StrategyWizard.tsx:115-128`).
- Warnings: (1) two Open Questions still unresolved (cooldown-snapshot column shape;
  sync-vs-deferred write path) — both deferred to `/sdd-design` by design, standard at this stage;
  (2) C-10(b) read-path parity for the new field across `insights/strategies` list/detail pages and
  `useStrategyDefinitions.ts` is asserted in the spec but not yet verified — `/sdd-spec` must
  actually confirm this, not just inherit the spec's own deferral note.
- Overlap findings: CLEAN. No collision on proto field 9, config key, or migration `008` against
  any other in-flight feature. Low-risk watch item: `042-order-snapshots-pnl-patterns` (still
  `draft`) will also need a migration number in `xstockstrat-analysis`; re-check if it reaches
  `spec-ready` before this feature merges.

Next action: `/sdd-design strategy-reentry-cooldown` (full debate mode, per user request).

## Session 2026-07-24T10:19:57Z — sdd-design

- Phase 0 Recon: wrote recon.md (services: xstockstrat-analysis, packages/proto, xstockstrat-agent,
  xstockstrat-ui). Key reuse patterns surfaced: `hydrate_scores()` best-effort/db_pool-gated boot
  hydration; `StrategyScoresRepository` upsert-on-PK shape; `007_backtest_run_symbols` migration
  style; `get_int` config-read shape; `_emit_ledger` isolated try/except. Recon also found a spec gap
  the product-spec missed: agent `client.py:283-290` builds `StrategyDefinition` field-by-field, so
  FR-10 needs `client.py` touched too, not just `tools.py` + the runbook.
- Phase 1 Grilling: **5 rounds (full)** — the debate did real work, not a rubber stamp:
  - R1 → NEEDS WORK: proto3 zero-value trap (0 vs unset inexpressible), live-loop throttled-exit
    write-site gap, unaddressed protobuf Timestamp→datetime conversion.
  - **User decision (R1 gate):** make `cooldown_days=0` explicitly settable → `optional int32`
    (proto3 explicit presence), unset→default / explicit-0→no-cooldown.
  - R2 → NEEDS WORK: client.py post-construction-assignment rested on a false protobuf premise
    (adversary verified `field=None` already omits); UI NaN guard bug; backtest-side wiring never
    shown; naive/aware datetime left as a comment convention; `get_int` zero-trap (config layer).
  - R3 → NEEDS WORK: `_write_cooldown` unguarded await could wedge live alerting (stuck "in
    position"); live loop used wall-clock instead of the already-fetched bar time.
  - R4 → NEEDS WORK: two concrete `test_live_loop.py` fixture breakages (missing `cooldowns_repo`
    arg; `object()` bar mock has no `.time`); **critical edit-mode data-corruption bug** — seeding an
    unset field's input as "0" and writing `cooldown_days: 0` would silently destroy a pre-existing
    strategy's implicit 31-day default on any unrelated edit.
  - R5 (final) → APPROVABLE: all closed. Loaded **Context7** (`/bufbuild/protobuf-es`) to ground the
    protobuf-es `optional` contract: generates `cooldownDays?: number | undefined`, presence via
    `isFieldSet`, and `msg.cooldownDays = 0` sets presence true — confirming the fix (seed
    `!== undefined ? String() : ''`, blank→omit key, "0"→include). Model switched to opus for R5.
  - **User decision (final gate):** approve, keeping explicit-0-settable; reconcile the superseded
    product-spec ACs (FR-1/FR-2/AC-2/AC-11) to "unset→default, explicit 0→no-cooldown", with the
    safety note recorded in design.md.
- Chosen approach: single shared pure `cooldown.py` helper (tz-awareness enforced *inside* the
  helper, not by convention), fed **bar time** at both call sites; ephemeral per-run state for
  backtest (FR-7), durable `009_strategy_cooldowns` + boot hydration for live (FR-8); best-effort
  isolated `_write_cooldown`; `cooldowns_repo=None` default so existing tests need no constructor
  change. Rejected: wall-clock live clock, snapshot column, plain-int32 "0→default", required repo
  param, fixing `get_int` service-wide.
- Constitution rules touched: C-01, C-05/F-07, C-07/F-01, C-08/P-06, C-10(b), F-06, P-03/P-04. Floor
  breaches: none across all 5 rounds.
- Status: spec-ready → design-approved.

### Open Threads (from design.md Open Risks)

- Cross-restart durability on a failed best-effort write (accepted for v1, mirrors `strategy_scores`)
  — no fix, stated limitation.
- Product-spec AC reconciliation reconciled here; `/sdd-spec` must not author a `0 → 31` test and the
  e2e must assert blank→omitted / `0`→present. → target: /sdd-spec + UI/e2e step.
- Config default zero-trap documented (not fixed) → target: config/docs step (CLAUDE.md config row).
- Two `test_live_loop.py` fixture updates (`cooldowns_repo=None` + real-`Timestamp` bar mock at
  `:33`) are same-step scope with the bar-time change → target: live-loop service+test step.
- `mock-backend.ts` `GetStrategy` presence round-trip (unset stays unset) unverified → target:
  UI/e2e step.

## Session 2026-07-24 (cont.) — feature-number + migration collision resolution

On pushing the design-phase artifacts, a `git fetch`/rebase pulled main-dev, which had meanwhile
merged and promoted feature **`068-backtest-results-visualization`** — it had also claimed number
`068` and, more consequentially, migration **`008_backtest_details`** (now present on disk in
`services/xstockstrat-analysis/migrations/`). Per the feature-numbering collision rule
(`docs/runbooks/feature-workflow.md` § Feature Numbering — the later/racing feature renumbers), this
feature was **renumbered `068` → `069`** (`git mv` of the directory; branch is slug-based so no branch
rename), and its migration **`008_strategy_cooldowns` → `009_strategy_cooldowns`** (008 is taken).

No other collision: `068-backtest-results-visualization` touched `BacktestResult`/`BarDiagnostic`
proto fields (field 15) and added no `analysis.strategy.*` config key, so this feature's
`StrategyDefinition.cooldown_days = 9` and `analysis.strategy.default_cooldown_days` remain
collision-free. The earlier `/sdd-review` overlap scan (which reported migration `008` free) was
accurate at the time — the collision arose only when the other feature merged afterward; the earlier
session-log entries recording `008` are left intact as accurate history, and design.md / recon.md /
product-spec.md (the living artifacts `/sdd-spec` consumes) are updated to `009`. `merge-order.md`
needed no change (it references neither feature by number).

## Session 2026-07-24 — sdd-spec

- Generated implementation-spec.md with **13 steps**. Status → `implementation-ready`.
- **Line-drift correction (important for /sdd-execute):** the backtest trade loop in
  `servicer.py` drifted ~+14 lines from recon's Codebase Map after feature 068 merged
  `008_backtest_details`. Current authoritative lines: `_backtest_symbol_evaluated` def
  `servicer.py:784`; entry gate `if position == 0.0 and decision.entry:` **`servicer.py:863`**
  (recon said 849); exit branch `elif position > 0.0 and decision.exit:` **`servicer.py:873`**
  (recon said 859); trade-loop locals `position/entry_price/entry_time` init `servicer.py:847-850`.
  The spec cites the current lines; recon's older numbers are left intact as history.
- Confirmed migration numbering: last on disk is `008_backtest_details` → new `009_strategy_cooldowns`.
- Confirmed composable path only: `_backtest_symbol_evaluated(definition=active_definition)` is
  called at `servicer.py:311-323` under `if active_definition is not None:`; the legacy SMA
  `_backtest_symbol` (`servicer.py:527`) is Out of Scope, as the product spec states.
- FR-9 free (no code): `_definition_fingerprint` (`servicer.py:1754-1773`) excludes only
  `{display_name, active, live_enabled}`; `cooldown_days` enters `definition_json` via
  `MessageToDict(..., preserving_proto_field_name=True)` at register/update, so unset vs explicit-0
  produce different fingerprints automatically.
- Config key `analysis.strategy.default_cooldown_days` has **no seed file** to edit (grep found none
  for existing `analysis.*` int keys); it resolves via the in-code `get_int` default (31) and is set
  at runtime via `SetConfig`. Docs step (13) registers it in `config-governance.md` + analysis
  `CLAUDE.md` (AC-6), including the `get_int` zero-trap note.
- UI read-path parity (C-10(b)) confirmed for the wizard: `useStrategyDefinitions.ts:10`
  `StrategyDefinitionInit = MessageInitShape<typeof StrategyDefinitionSchema>` is proto-generated, so
  `cooldownDays` flows through `useManageStrategy`/`useGetStrategy` with no read-path edit. A
  `codebase-discovery` pass is confirming the insights list/detail pages + `insightsBff.ts` are
  forward-only and the exact `mock-backend.ts` echo shape; Step 12 is written to "modify
  `mock-backend.ts` per the digest" either way. Digest folded in below once returned.

### Decisions

- Proto + regenerated stubs land in **one** step/PR (proto-freshness CI fails a proto-only PR).
- Shared gate helper (`app/services/cooldown.py`) is the single source for both paths; tz-awareness
  enforced inside the helper (`_require_aware` → `ValueError`), unit-tested directly (Step 4).
- Live path durable (`009` table + `StrategyCooldownsRepository`, reuse existing `db_pool` — F-06,
  pool stays 2); backtest path ephemeral per-`RunBacktest` local (FR-7, never touches the table).
- Semantics locked to design (supersede product-spec FR-1/FR-2/AC-2/AC-11): unset → default 31,
  explicit 0 → no cooldown, negative → INVALID_ARGUMENT. No `0 → 31` test authored anywhere.
- FR-10 gap closed: `client.py:283-290` gains a `cooldown_days=` kwarg (recon-discovered — the tool
  dict alone would be dropped by the field-by-field message build).

### Open Threads

- Carried from design: cross-restart durability on a failed best-effort cooldown write is accepted
  for v1 (mirrors `strategy_scores`); config default zero-trap documented, not fixed.

### UI codebase-discovery digest (folded in — resolves the two design.md UI open-risks)

Read-path parity (C-10(b)) and mock-echo shape confirmed against the live UI:

- **Read paths carry `cooldownDays` automatically — no drop, no edit needed.** `StrategyDefinitionInit`
  is proto-generated `MessageInitShape<typeof StrategyDefinitionSchema>` (`useStrategyDefinitions.ts:10`);
  `insightsBff.ts` `getStrategy`/`manageStrategy`/`listStrategyDefinitions` are plain whole-message
  forwards (`:42-56`); the edit page passes `initial={data}` untouched
  (`strategies/[id]/edit/page.tsx:30`). No exhaustive `Record<StrategyDefinition, …>`/switch exists in
  `src/` to break (the C-10(a/d) proto-enum-map trap does not apply — `cooldown_days` is a scalar). The
  list/detail pages render only `displayName`/`active`/`liveEnabled` today; surfacing cooldown there
  would be a *display* addition, not a correctness drop — **out of scope** for this feature (FR-11 is
  the wizard write path only).
- **Write-back drop site = the wizard's `handleSubmit` (`StrategyWizard.tsx:116-128`)** — field-by-field
  literal, omits `cooldownDays`. Covered by Step 11.
- **Mock `manageStrategy` echoes `req.definition` verbatim (`mock-backend.ts:644-652`)** → register/update
  round-trips `cooldownDays` with **no mock change**. **Mock `getStrategy` builds the definition
  field-by-field (`:654-671`), no `cooldownDays`** → Step 12 must add `cooldownDays: 14` there for the
  edit-prepopulation assertion. Hand-written fixtures `e2e/fixtures/strategies.ts:53-65` also omit it
  (+ `INVENTORY.md`) — update only if cooldown must appear in a list/detail e2e (not required by Step 12's
  wizard-focused scenarios). Step 12 already reflects this scope.


## Session 2026-07-24 — sdd-execute (sequential, single-PR)

**Mode**: sequential, all 13 steps on `claude/strategy-reentry-cooldown-sequential-c1udg7` (based on
`origin/main-dev`), landing as ONE integration PR into `main-dev` (per user directive — deviates from
standard stacked per-step PRs). Semantics locked to design: unset → default 31, explicit 0 → no
cooldown, negative → INVALID_ARGUMENT.

**Toolchain (sequential-mode verification fallbacks — no host buf/migrate, Docker daemon started):**
- `buf` + Go proto plugins installed via `go install` (proxy.golang.org reachable): buf `1.69.0` (CI
  pin), `protoc-gen-go@v1.36.11`, `protoc-gen-go-grpc@v1.6.2`, `protoc-gen-connect-go@v1.19.2`;
  `grpcio-tools==1.80.0` (CI pin) via pip; TS plugins via `pnpm install` in `packages/proto/gen/ts`.
- Migration verified against a throwaway local `initdb` postgres cluster (no `migrate` binary / no
  TimescaleDB container). Logged as CI-equivalent fallback in the Deviation Log.

### Step 1 — proto: add `cooldown_days` field + regenerate stubs [done]
- Added `optional int32 cooldown_days = 9` to `StrategyDefinition`; regenerated Go/Python/TS stubs.
  First regen used buf `1.47.2` which drifted the unrelated `google/protobuf/timestamp.ts` WKT
  docstring; reinstalled the CI-pinned buf `1.69.0`, reverted gen/, regenerated → diff scoped to
  `analysis.*` only. `buf lint` + `buf breaking` (additive, non-breaking) pass; codegen idempotent
  across repeated runs.
- Files modified: `packages/proto/analysis/v1/analysis.proto`, `packages/proto/gen/**` (analysis only)
- Deviations: none (toolchain-install fallback noted above; not a spec deviation)

# Design: exit-cooldown

**Created**: 2026-08-07
**Rounds**: 4 (full; termination: approved pending final user gate)
**Approved by**: user @ 2026-08-07 (pending)
**Grounded in**: recon.md

---

## Chosen Approach

Add a per-strategy exit cooldown — a minimum holding period in calendar days after entry, before
`StrategyDefinition.exit_rule` may fire a sell — mirroring feature 069's re-entry cooldown but
gating the opposite transition, reusing feature 069's machinery wherever the gate's own semantics
allow it and adding new, precisely-scoped machinery only where recon confirmed nothing existing
covers the exit side (the live loop's durable "am I currently in a position, since when" state).

**Proto** — `optional int32 exit_cooldown_days = 11` on `StrategyDefinition`
(`packages/proto/analysis/v1/analysis.proto:249-267`, next free field number after `cooldown_days`
= field 9 and `warnings` = field 10). `ManageStrategyRequest.update_mask`'s allowed-paths comment
(`:291`) gains the field name. Explicit-presence semantics mirror `cooldown_days` exactly: unset →
platform default; explicit `0` → no minimum hold; negative → `INVALID_ARGUMENT` at write time
(mirrors `evaluator.py:351-354`'s existing `HasField` + negative-rejection shape).

**Pure gate module** — reuse `app/services/cooldown.py`'s `is_cooldown_active`/
`effective_cooldown_days` (`:18-50`) verbatim as the exit-side gate too: the function is already
generic "gated while `current_ts < anchor + days`" math and does not care whether the anchor is a
last-exit or a last-entry timestamp. Rename the `last_exit_at` parameter to a direction-neutral
name (e.g. `gate_start_at`) and generalize the module docstring (currently "Shared **re-entry**
cooldown gate") to describe both directions — no new function, no new/renamed module (an
`entry_cooldown.py` sibling was considered and rejected — see Rejected Alternatives).

**Config** — new key `analysis.strategy.default_exit_cooldown_days` (int, default `0` — no
wash-sale-style external rationale exists for a non-zero default, unlike `cooldown_days`'s 31-day
choice). Read via `get_int_present` (`app/config/watcher.py:76-87`), **not** `get_int` — because
FR-2 makes an explicit `0` a meaningful, distinct choice from "unset," and `get_int`'s `v.int_val or
default` zero-trap would silently collapse a deliberately-configured `0` into whatever the code-side
default happens to be if it's ever changed away from `0` (the same trap `cooldown_days` avoided only
by luck of coinciding defaults — `get_int_present` closes it properly for this key from day one).

**Fingerprint** — leave `exit_cooldown_days` **out** of `_FINGERPRINT_EXCLUDED_KEYS`
(`servicer.py:2925-2944`, currently `{"display_name", "active", "live_enabled"}`) — it participates
in the definition fingerprint, mirroring `cooldown_days`'s existing (included) behavior, satisfying
FR-9 with no special-casing.

**Backtest engine** — `_backtest_symbol_evaluated` (`servicer.py:969-1138`) already tracks `entry_time`
as an ephemeral per-run local (set at `:1076-1078` on entry fill, cleared at `:1102-1105` on exit
fill). Gate the existing exit `elif` branch (`:1081`) with `is_cooldown_active(entry_time, bar.time,
exit_cooldown_days)`, symmetric to how the entry-fill `if` (`:1065-1071`) already gates on the
re-entry cooldown. `entry_time`/`exit_cooldown_days` never touch a repository — ephemeral,
per-`RunBacktest`, satisfying FR-5/FR-7 exactly as `cooldown_days`'s backtest gate does today.

**Live loop — durable state** — extend `analysis.strategy_cooldowns` (migration `012`,
`ALTER TABLE analysis.strategy_cooldowns ADD COLUMN last_entry_at TIMESTAMPTZ NULL`) rather than a
new table: the PK `(strategy_id, symbol)` already models exactly the pair this feature needs a second
timestamp for, and a parallel table would duplicate the join key and the hydrate/write-through
boilerplate for no benefit. `StrategyCooldownsRepository` (`app/repositories/strategy_cooldowns.py`)
gains an `upsert_entry(strategy_id, symbol, last_entry_at)` sibling to the existing `upsert` (renamed
`upsert_exit` for clarity), touching only the `last_entry_at` column via `ON CONFLICT ... DO UPDATE
SET last_entry_at = EXCLUDED.last_entry_at`; `list_all()` returns both timestamps. Migration `009`
itself is **not** edited (F-01) — only the new migration `012` and the repository/module docstrings
are updated to describe the table's now-dual (re-entry **and** exit) purpose.

**Live loop — shared transition core** — factor `_eval_pair`'s gating+transition block
(`live_loop.py:162-176`: both cooldown checks, `trigger`/`new_state` assignment, `last_exit_at`/
`last_entry_at` writes) into one new **free function** `_apply_transition(in_position, entry_time,
last_exit_at, decision, bar_dt, cooldown_days, exit_cooldown_days) -> (new_in_position,
new_entry_time, new_last_exit_at, trigger_or_None)`. `_eval_pair` calls it for the live bar; the new
module-level pure `_replay_state(bars, decisions, cooldown_days, exit_cooldown_days)` (below) folds
over the same function for historical bars. This makes live/replay parity **structural** — one copy
of the gating logic, not two hand-synchronized copies — closing the "second hand-written state
machine" risk identified in round 2 more strongly than a parity test alone would.

**Live loop — bar-replay for the common case** — `_last_state` (`live_loop.py:69`) is confirmed
(recon, exhaustive grep) to have **no durable counterpart today** — it resets to `{}` on every
restart. Feature 069's entry-side gate never needed this fixed because its gate lives in the entry
branch (reachable regardless of `_last_state`'s restart value); this feature's gate lives in the exit
branch (`elif in_position and latest.exit:`), which is unreachable if `_last_state[key]` wrongly
defaults to `False` post-restart. For a key reached for the first time since restart (`key not in
self._last_state`), `_replay_state` runs over the already-fetched 365-day bar window
(`_LOOKBACK_DAYS`, `:34,134-146`, fetched every cycle regardless — no new RPC) using `bars[:-1]`/
`decisions[:-1]` (all but the current cycle's bar, to avoid double-processing what `_eval_pair`'s own
edge-detection is about to evaluate), and **fully populates** `_last_state[key]`/`_last_entry_at[key]`/
`_last_exit_at[key]` via repeated calls to `_apply_transition` **before** the existing line
`in_position = self._last_state.get(key, False)` (`:152`) executes. This ordering — replay-then-read,
never read-then-replay — makes it structurally impossible for `_eval_pair` to diff a pre-replay
default against a post-replay state on the seeding cycle: there is exactly one "old state" read, and
it happens after replay completes. `_replay_state`/`_apply_transition` are free functions taking only
plain data (no `self`, no reference to `_notify`/`_ledger`) — they cannot emit an alert or ledger
write by construction, only seed state. A dedicated test proves the call-site integration, not just
the helper's isolation: replay a historical "already in position, no crossing" window, feed a
steady-state current-bar decision, assert zero `EmitAlert` calls.

**Live loop — boot-time backfill for positions older than the replay window** — per the user's
explicit round-2 decision, bar-replay's 365-day ceiling is not accepted as a permanent gap for a
position already held longer than that when this feature first ships. A new module
`app/engine/entry_backfill.py`, imported **only** by `main.py` (never by `live_loop.py`, preserving
the literal truth of that module's FR-6 docstring — "this module never imports or calls any
trading/portfolio RPC," `live_loop.py:9-10`), does a **one-time, boot-only** read against
`xstockstrat-trading`'s existing `ListOrders` RPC (already an established `xstockstrat-analysis →
xstockstrat-trading` edge, reused from `GetStrategyAnalytics`, `servicer.py:2441-2442`) — never
portfolio (`portfolio.Position` carries no `strategy_id`, confirmed at
`packages/proto/portfolio/v1/portfolio.proto:43-73`; a broker position cannot be attributed to a
strategy without fabricating a link the codebase has already explicitly declined to fabricate for
feature 083 — see Rejected Alternatives). Unlike `Position`, `trading.Order` carries a real
`strategy_id` (`packages/proto/trading/v1/trading.proto:47`) — genuine attribution, not a guess.

For each live pair lacking a durable `last_entry_at` row, `ListOrders` is called with `status`
**unfiltered** (zero-value `ORDER_STATUS_UNSPECIFIED`, matching the existing precedent at
`servicer.py:2441-2442`) — not `status=ORDER_STATUS_FILLED` as first drafted — because a FILLED-only
filter silently drops orders that were partially filled then CANCELED/EXPIRED (real terminal states,
`services/xstockstrat-trading/CLAUDE.md` § Order Status Reconciliation), which still hold a real,
accurate `filled_qty` per `normalizeFilledQty`'s own documented contract
(`services/xstockstrat-trading/internal/service/trading.go:1373-1387`: normalization coercion only
applies to `ORDER_STATUS_FILLED`; partial/canceled/expired orders' `filled_qty` is left untouched and
already correct). A new pure function `_infer_open_entry_time(orders)` sorts by `updated_at`
(`trading.proto` field 14 — the fill-completion proxy; `created_at` was considered and rejected, see
Rejected Alternatives), walks a running signed balance using `filled_qty` (field 8, skipping
`filled_qty == 0` orders) — `+` on BUY, `-` on SELL — recording a candidate entry time on every
`0 → nonzero` crossing and clearing it on every `nonzero → 0` crossing, returning the last recorded
crossing time iff the pair is currently non-flat, else `None`. This is confirmed new logic (recon: no
existing BUY/SELL round-trip matcher exists anywhere in this codebase) and matches `_last_state`'s
single-boolean-per-pair model (not a FIFO/multi-lot ledger).

The backfill's own RPC fan-out is concurrency-bounded via a semaphore (mirrors
`app/services/screener.py:76-77`'s existing shape), gated by a new key
`analysis.strategy.max_concurrent_entry_backfill` (int, default `4`). Boot-time calls pass
`metadata=()` explicitly (mirrors the only existing no-inbound-context precedent,
`app/engine/fundsignal_loop.py:94,100` — no fabricated `x-user-id`/`x-trace-id`, since there is no
inbound request at boot). Backfill runs as its own `asyncio.create_task`, concurrent with (not
blocking) the other boot-time task creations (`fundsignal_loop`/`run_opportunity_refresh_forever`,
`main.py:96-148`) — not inline in the `hydrate_cooldowns()` → `run_forever()` chain.

**The one required correctness fix (round 4 adversary, closing the loop):** running backfill
asynchronously creates a real window — before its `ListOrders` result lands — where a pair's
in-position state may be seeded `True` (by replay, or simply by a live entry detected this session)
while `_last_entry_at.get(key)` is still `None`. The shared gate's reused `None`-anchor semantics
(`cooldown.py:46-47`: "a never-anchored pair is never gated") are *correct* for the backtest engine
(where `None` genuinely means "never entered") but would be *wrong* here (where `None` means "entered,
but we don't yet know when" — the exact deploy-day-gap population the user required to be protected,
not fail-open). **Fix, scoped entirely to the live-loop caller, not the shared pure gate (preserving
FR-4 parity):** in `_eval_pair`, when `in_position` is `True` but `_last_entry_at.get(key)` is still
`None`, skip evaluating the exit-cooldown-gated exit decision for that pair on that cycle — treat it
as "known open, cooldown status unknown, do not permit an ungated exit" rather than feeding an absent
anchor into a function whose `None`-handling means "ungated." This one-branch addition, not a
blocking-backfill reversion, is what actually delivers the user's round-2 requirement ("closed for
every position regardless of age") without reintroducing the boot-latency cost that motivated making
backfill non-blocking in the first place.

**Agent (`xstockstrat-agent`)** — `manage_strategy` (`app/tools.py:442-563`) gains
`exit_cooldown_days: int | None = None`, added to the `supplied` dict (`:521-529`) and the
`clear_fields` mechanism unchanged (feature 070's partial-update fix is not touched, only extended).
`client.py`'s `pb_def = analysis_pb2.StrategyDefinition(...)` construction (`:425-436`) gains
`exit_cooldown_days=definition.get("exit_cooldown_days")` (bare dict `.get`, presence-safe, mirrors
`cooldown_days` exactly). `get_strategy`'s docstring field list (`:897-899`) is updated; no code
change (thin passthrough). `docs/runbooks/mcp-tools.md` and
`plugins/strat-lab/skills/backtest/SKILL.md` gain the new parameter in the same PR (root `CLAUDE.md`
requirement).

**UI (`xstockstrat-ui`)** — `StrategyWizard.tsx` gains a second, mechanically-mirrored field ("Exit
cooldown (days)") next to "Re-entry cooldown (days)" (`:192-206`): a `parseExitCooldownDays`
mirroring `parseCooldownDays` (`:27-39`), a presence-honest state seed (`:54-58`'s `?? 0`-avoidance
pattern), wiring into `canAdvance`/`stepForError`/`handleSubmit`'s spread (`:102-135`). The field
surfaces automatically in TypeScript once the proto field exists and `./scripts/buf-gen.sh` runs —
`StrategyDefinitionInit` (`hooks/useStrategyDefinitions.ts:1-10`) derives from the generated proto
schema, no hand-written interface to edit. Reaches its consumer surface (C-14) via the existing
`/insights` `StrategyWizard` route — no new nav registration needed (C-10(a) does not apply, per
product-spec).

## Rejected Alternatives

- **Infer `_last_state` from comparing `last_entry_at`/`last_exit_at` recency** (round 1) — rejected:
  undecidable for the deploy-day cohort (every pre-existing row has `last_entry_at = NULL` on a
  brand-new column) and silently reintroducible by any lost best-effort write.
- **A new `entry_cooldown.py` sibling module instead of reusing `cooldown.py`** — rejected:
  `_require_aware` is private (`_`-prefixed); a sibling would either duplicate it or force it public
  for no functional gain, and `cooldown.py`'s gate math is already direction-agnostic.
- **Backfill `_last_state`/entry time from `xstockstrat-portfolio`'s real open positions** — rejected:
  `portfolio.Position` carries no `strategy_id`; this would fabricate a strategy↔position attribution
  the codebase already explicitly declined to fabricate for feature 083 ("held positions carry no
  portfolio strategy, so none is fabricated (P-03)," `services/xstockstrat-analysis/CLAUDE.md`).
- **Widen `_LOOKBACK_DAYS` for the replay path only, instead of an Order-based backfill** — rejected:
  mitigates but does not eliminate the gap (any position older than the widened window is still
  unrecoverable), and the window size would be an unprincipled magic number versus the Order-based
  fix's unbounded reach.
- **Accept the >365-day-position gap as a documented residual limitation** (round 2's initial
  position) — rejected by explicit user steering after round 2: the user required the gap actually
  closed, not narrated.
- **Extract the shared `_apply_transition` core into the backtest engine too** (making it a true
  three-way share with `_backtest_symbol_evaluated`) — considered, deferred: would touch the
  already-shipped, unrelated-to-this-feature backtest loop's fused economics logic, cutting against
  "touch only what the task requires"; the FR-4 parity requirement is satisfied by the shared pure
  gate function (`cooldown.py`) plus a fold-equivalence parity test between `_replay_state` and
  `_apply_transition`, without requiring the backtest loop itself to be refactored. Recorded as a
  possible future cleanup, not this feature's scope.
- **Anchor the backfilled entry time on `Order.created_at` instead of `updated_at`** — rejected: a
  limit order that sits unfilled for days before filling would anchor the cooldown clock too early
  (at order placement, not fill) under `created_at`; `updated_at` on a terminal order (confirmed via
  `trading.go`'s `pollFills`, which only bumps `updated_at` on an actual status transition) is the
  more accurate fill-completion proxy given `Order` has no dedicated `filled_at` field.
- **Make the boot-time Order backfill fully blocking** (await before `run_forever()` starts,
  mirroring `hydrate_cooldowns()`'s existing shape exactly) — rejected in favor of the non-blocking
  `asyncio.create_task` + "skip-until-known" fix: blocking reintroduces the startup-latency problem
  (a slow/unavailable `xstockstrat-trading` would delay all live evaluation, not just old positions)
  that motivated moving off it, while the skip-until-known fix delivers the same correctness guarantee
  with a much smaller blast radius.

## Open Risks

- [ ] **`analysis.engine.max_strategies_per_cycle`'s no-rotation starvation is a pre-existing platform
  defect, not fixed by this feature.** `_run_cycle` (`live_loop.py:99-120`) selects live pairs with no
  `ORDER BY` and returns once `processed >= max_pairs` (default 50) — any live pair beyond the cap is
  never reached by `_eval_pair`, ever, which silently starves **both** the entry-side re-entry cooldown
  (feature 069, already shipped) and this feature's exit-side gate for that pair. This feature's
  correctness assumes every live pair is reached within a bounded number of cycles; that assumption is
  false once the live pair count exceeds the cap. Not this feature's scope to fix (touches feature
  069's shared code path). **Action**: file a standalone defect report under `docs/reports/` for
  `/sdd-triage --from-report` — to be addressed at implementation-spec time or as a follow-up, not
  silently absorbed into this feature's step list.
- [ ] **The "skip exit-cooldown eval while `in_position=True` and `last_entry_at is None`" fix is a
  new branch with no type-level guard against regression** — if a future edit to `_eval_pair` reorders
  the replay-then-read sequence, or adds a second `.get(key, False)`-style default read, the
  "structurally impossible" guarantee this design relies on could silently regress. Mitigated by the
  dedicated call-site test (zero-alerts-on-replay-seeded-cycle) but not eliminated. **Action**: keep
  that test in CI, non-skippable, and reference it directly in a code comment at the `_eval_pair`
  ordering site so a future editor sees the constraint before breaking it.
- [ ] **Backfill's `filled_qty`/`updated_at`-based entry-time reconstruction assumes single-lot,
  round-trip order history** — a strategy pair with unusual real-world order patterns (manual partial
  adds/trims outside the strategy's own signals, multiple simultaneous lots) is not modeled; the
  "flat→open crossing" algorithm matches `_last_state`'s own single-boolean-per-pair semantics, so this
  is a scope match, not a new gap, but should be called out in the impl-spec's test cases (a
  multi-crossing order history fixture, not just a single clean round-trip).

## Constitution Rules Touched

- **C-01** (evidence-cited steps) — honored: every design claim above cites `path:line`, including the
  round-3/4 corrections (trading.proto field numbers, `trading.go`'s `normalizeFilledQty`/`pollFills`).
- **C-05** (config key naming) — honored: `analysis.strategy.default_exit_cooldown_days` and
  `analysis.strategy.max_concurrent_entry_backfill` both follow `<service>.<category>.<key>`.
- **C-07** (migration naming) — honored: migration `012` continues from the last (`011_opportunities`);
  migration `009` is not edited.
- **C-08** (test-step pairing) — honored, with the specific parity/call-site tests named above
  (fold-equivalence between `_replay_state` and sequential `_apply_transition` calls; zero-alerts on a
  replay-seeded first cycle) to be encoded as concrete impl-spec steps.
- **C-09** (proto verification) — applies at `/sdd-spec`/execute time: `buf lint`/`buf breaking` +
  `./scripts/buf-gen.sh` after the field addition.
- **C-10(b)** (every read/mapper path carries a field) — honored: `_row_to_strategy_definition` needs
  no explicit edit (round-trips via `definition_json`), but `_MASKABLE_PATHS`, the write-time negative
  validation, `client.py`'s presence-safe construction, and `get_strategy`'s docstring are all named
  explicitly above as same-PR edits — not left to "mirrors `cooldown_days`" by assertion alone.
- **C-13** (canonical test-data homes) — the exit-side pure-gate tests mirror `tests/test_cooldown.py`'s
  existing structure (same file or a directly adjacent module); no new fixture home needed.
- **C-14** (name the consumer surface) — honored: UI (`StrategyWizard.tsx`, `/insights`) and Agent
  (`manage_strategy`/`get_strategy`) both named with concrete edit sites, matching product-spec's
  Consumer Surface(s) section.
- **F-01** (never edit an applied migration) — honored: migration `009` is untouched; the new column
  lands in migration `012`.
- **F-06** (DB connection budget) — honored: no new pool; reuses the existing asyncpg pool
  (`analysis`'s budget entry is unaffected — a new nullable column on an existing table, no new
  connections).
- **F-11** (Floor rejection halts) — no Floor breach was found in any of the four debate rounds; all
  objections raised were Commandment/quality-level and are resolved above.

## Rounds

4 rounds (full mode). Round 1 (proto/config/gate-module/migration-shape/backtest wiring, all
unchallenged) surfaced the `_last_state` restart-durability gap as the one unresolved fork. Round 2
(bar-replay mechanism) closed the common case but left a >365-day-position gap the user explicitly
required closed. Round 3 (boot-time Order-based backfill + shared `_apply_transition` core) designed
the mechanism; the adversary found one correctness bug (FILLED-only order filter) and two process
gaps (call-site alert-suppression proof, boot-latency). Round 4 closed all three, and its own
adversary pass found one remaining real gap (the async-backfill race against an unknown
`last_entry_at`) with a precise, small fix (skip-until-known in the live-loop caller) — no further
architectural rework needed. Termination: synthesized and presented for final user approval after
round 4 (mandated minimum 2 rounds exceeded; the round-4 fix is mechanical/undisputed, not a fresh
fork requiring a fifth debate round).

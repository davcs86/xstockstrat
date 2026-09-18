# Defect: dead fields carried in strategy payloads, and 33 deprecated proto fields never removed

**Date**: 2026-09-18
**Reporter**: davcs86@gmail.com (via Claude Code)
**Severity**: SEV-3
**Impact type**: contract-hygiene / maintainability (no runtime misbehavior)
**Environment**: all (staging and production alike — these are contract-level, not deployment-specific)
**Affected service(s)**: `xstockstrat-analysis` (defect 1); the 8 of 11 protos that carry deprecated fields, and their owning services (defect 2)
**Config-only fix possible**: no

> Severity rationale: nothing misbehaves at runtime today — every field below is either ignored by
> the server or read by nobody. The cost is comprehension and drift: a reader of a `get_strategy`
> payload cannot tell which fields are load-bearing, and a deprecated field that is never removed
> teaches new code that it is still a valid input. Neither defect is urgent; both are cheap to get
> wrong, which is why the inventory below distinguishes removable from load-bearing per field.

---

## Defect 1 — `StrategyDefinition.signal_params` carries four blend keys that nothing reads

**Observed:** every `get_strategy` / `ListStrategyDefinitions` response for a signal-weighted
strategy carries a `signal_params` struct like:

```json
"signal_params": {
  "signal_sources": ["fundamentals"],
  "signal_weight": 0.4,
  "technical_weight": 0.6,
  "min_conviction": 0.5
}
```

**Why this is wrong:** all four keys are dead on every path that reads a `StrategyDefinition`.
Feature 097 made strategy scoring technical-only; `servicer.py:666-667` states it inline:

> `# A strategy's backtest score is TECHNICAL-ONLY — a signal is a separate queue ranking axis,`
> `# never an input to the score (compute_signal_score/combine_score stay for the screener).`

This matches `docs/reports/2026-08-24-strategy-bakeoff.md:28-36`, which records that the blend is
"inert in both backtest and live entry decisions" and survives only in the screener. The UI agrees —
`StrategyWizard.tsx:26`: *"The wizard exposes no signal-weight controls (score is technical-only)"* —
and the wizard preserves the struct verbatim on every edit rather than letting a user set it.

**Verification performed.** A non-test grep for `signal_params` / `signalParams` across `services/`
returns every reader, and **none reads these four keys off a definition**:

| Reader | Key(s) read | Status |
|---|---|---|
| `live_loop.py:63-72` (`strategy_symbols`) | `symbols` | **live — load-bearing** (allowlist universe override) |
| `evaluator.py:498-499` | `symbols` | **live** (conflict guard vs `signal_eligible`) |
| `servicer.py:4266-4270` | `target`, `stop` | **live** (persisted into readiness JSONB as `target_price` / `stop_price`) |
| `servicer.py:5280` | whole struct | maskable-field list, pass-through |
| `agent/client.py:882-886`, `agent/tools.py:775` | whole struct | pass-through |
| `StrategyWizard.tsx` | whole struct | preserved verbatim, never interpreted |

The four blend keys appear in **no** reader. The one `min_conviction` hit that does exist
(`servicer.py:665`) reads `RunBacktestRequest.strategy_params` — a **different carrier** — and feeds
`scoring.buy_threshold` on the legacy SMA-crossover backtest path, not the definition-based
evaluator. `screener.py:316-325`, `:488-489` likewise read `ScreenSymbolsRequest.signal_weight` /
`.technical_weight` / `.signal_sources`, not a definition's. **Neither of those is in scope here.**

**Shape of the fix:** `signal_params` is a `google.protobuf.Struct` (`analysis.proto:325`), so
dropping keys is a *payload* change, not a proto field removal — `buf breaking` is not triggered.

**Must survive, do not drop:** `symbols`, `target`, `stop`.

**Questions for design:**
1. Strip on write (normalize in `ManageStrategy`), on read (filter in `_row_to_strategy_definition`),
   or both? Read-side alone leaves the keys in `definition_json` forever; write-side alone leaves
   existing rows dirty. A backfill `UPDATE` over `analysis.strategies` is the third option.
2. `StrategyWizard`'s "preserve signal_params verbatim" behavior (`StrategyWizard.tsx:180-183`) is
   deliberate — it protects `symbols`. Any strip must not regress that.
3. Does anything outside this repo consume these keys? The MCP agent passes the struct through
   opaquely, so an external agent prompt could in principle read them.

---

## Defect 2 — 33 `[deprecated = true]` proto fields have never been removed

**Observed:** `grep -rn 'deprecated = true' packages/proto/*/v1/*.proto` returns 33 fields across
8 of the 11 protos (identity, ledger and notify carry none), some dating to feature 088/097/133/143/147:

| Proto | Count | Fields |
|---|---|---|
| `analysis` | 1 | `ListStrategiesRequest.user_id` (:289) |
| `common` | 5 | `ENVIRONMENT_DEV` (:62); `TIMEFRAME_1MIN` / `_5MIN` / `_15MIN` / `_1HOUR` (:87-91) |
| `config` | 7 | `trading_mode` ×6 (:43, :57, :106, :128, :146, :163); `VALUE_TYPE_FLOAT_MAP` (:85) |
| `indicators` | 2 | `user_id` (:197, :217) |
| `ingest` | 3 | `timeframe` (:31, :65); `operation` string (:195) |
| `marketdata` | 4 | `timeframe` (:68, :99, :112, :130) |
| `portfolio` | 6 | `user_id` ×5 (:161, :166, :172, :186, :198); `symbols` (:235) |
| `trading` | 5 | `user_id` ×4 (:110, :133, :153, :189); `is_paper` (:254) |

**This is a breaking-change program, not a cleanup PR.** Three constraints shape it:

1. **`buf breaking` runs on every CI PR** and will reject each removal by design. Workflow and BSR
   handling → `docs/runbooks/proto-versioning.md`. Approval per
   `docs/runbooks/approval-flow.md`: **2 owners + platform lead** for any breaking proto change.
2. **Field numbers must be `reserved`** on removal, or a later feature silently reuses a number that
   old clients still populate. Same for removed enum values.
3. **Enum-value removals are not field removals.** `TIMEFRAME_*`, `ENVIRONMENT_DEV`, and
   `VALUE_TYPE_FLOAT_MAP` have *stored* numeric values; removing them changes how persisted rows and
   in-flight messages decode. These need a data audit before they can be touched at all.

**At least one listed field is NOT dead — do not batch it in.** `portfolio.proto:235`
`repeated string symbols` (the flat watchlist mirror deprecated by feature 097) has a **live reader**
at `live_loop.py:493`:

```python
out.update(_normalize_symbol(s) for s in wl.symbols)
```

That is `_drain_watchlist`'s documented legacy-row fallback, and a live `list_watchlists` call on
staging returns `symbols` fully populated on both watchlists. Removing it without first migrating
legacy rows onto `bindings` would silently shrink every strategy's watchlist universe. **Each of the
33 fields needs the same per-field reader check before removal** — the inventory above is a
candidate list, not a verified-dead list.

**Questions for design:**
1. Sequence by risk: the `user_id` body fields (12 across 4 protos, all already ignored server-side
   with identity from `x-user-id`) are the safest cohort and could go first as one approved batch.
   The enum-value cohort is the riskiest and may warrant staying deprecated indefinitely.
2. Is there any external/BSR consumer of these contracts? If the protos are published, removal
   breaks consumers outside this repo's CI, which changes the deprecation window entirely.
3. Is a removal even worth it for fields that cost nothing but a line of `.proto`? For several of
   these, "deprecated forever with a comment" may be the correct terminal state — the decision
   should be explicit rather than defaulted.

---

## Routing note

Defect 1 is a genuine contract-hygiene bug and fits the `/sdd-triage` → Track C path cleanly.

**Defect 2 is arguably not a bug** — it is planned technical debt with a breaking-change program and
a governance gate attached. Filing it here per request, but it may belong in `/sdd-story` (a scoped
feature with the approval gates in its product-spec) rather than as a triaged defect. Worth deciding
at triage rather than inheriting the Track C default.

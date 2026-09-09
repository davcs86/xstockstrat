# Design: opportunity-compute-robustness

**Created**: 2026-09-07
**Status when written**: spec-ready → design-approved
**Debate**: full mode — 3 rounds (proposer/adversary each round, mediated), + operator decisions on every contested fork.

---

## Chosen Approach

### FR-1 — data-unavailable sentinel (additive bool `Opportunity.data_unavailable = 20`)
Mirror the shipped `muted` additive-flag round-trip: a compute-side `"unavailable"` marker rides the
existing `provenance` JSONB (`opportunities.py` `$9::jsonb`), and the bool is **derived at read** in
`_row_to_opportunity` (`servicer.py:4588`, the OR-F producer↔reader↔UI contract point). **No analysis
migration** (rides existing columns, feature-131 `muted` precedent). A bool, not an enum — a binary flag,
so C-04's zero-value rule does not apply; `muted = 12` is the precedent. Add `"data_unavailable"` to the
hand-maintained `_MAPPED` set the OR-F parity test asserts (`test_analysis_servicer.py` — the test has
teeth but the mapping edit is manual).

**Capture — two granularities (operator: primary + benchmark + indicator):**
- **Symbol-level (bars + benchmark):** collect a `fetch_failed: set[str]` at the `except` sites — primary
  `_fetch_into` (`servicer.py:3841-3843`) and benchmark `_fetch_benchmark_into` (`:3855-3857`). A benchmark
  symbol (e.g. VOO) is **not** a candidate symbol, so a benchmark failure is mapped to every candidate whose
  strategy's `source_symbol` matches. NOT a `bars==[]` inference (a warm-up-thin symbol legitimately returns
  `[]` via `_empty_readiness`, `evaluator.py:229-232`). After Phase 1, stamp `_add_provenance(c,"unavailable")`
  on every candidate whose symbol is in the set (symbol → N candidates).
- **Candidate-level (indicator/formula RPC):** today `evaluate_conditions_traced` **raises** (`grpc.RpcError`
  `evaluator.py:288`; gather has no `return_exceptions` `:254`) → one indicators outage **aborts the entire
  compute**. Add a new try/except around the `evaluate_conditions_traced` call in `_row_for` catching
  **only `grpc.RpcError`/transport errors** (NOT `FormulaExecutionError`/decode errors — those are formula
  bugs, not data outages, `evaluator.py:311-313`; fails 313 meaning-vs-convenience trap), stamping
  `"unavailable"` on that candidate and returning a sentinel row instead of raising. This is a **deliberate
  abort-contract change** (recorded as a deviation) with its own RED test (indicators outage → sentinel rows
  for affected candidates + real rows for the rest).

**Ranking honesty (@AC-14 PRESERVE):** when stamping `"unavailable"`, zero **both** `conviction` and
`signal_axis` at row build (`servicer.py:3932/:3934`) so the read `ORDER BY ((1-w)·conviction + w·signal_axis)
DESC` (`opportunities.py:114`) sinks it — the sentinel is provably out of the ranking hot path.

**Every-layer filter exemption (fails 1547):** the read conviction floor `opportunities.py:107`
(`AND (o.conviction >= $2 OR o.provenance ? 'denied')`) gains `OR o.provenance ? 'unavailable'`, AND the
e2e mock predicate `mock-backend.ts:797` gains `|| o.dataUnavailable` — same PR, so a `conviction=0`
unavailable row does not vanish at either layer.

### FR-2 — UI render
Replace the `0/0` `no conditions` fallback (`page.tsx:509-510`) **only when `data_unavailable`** (a
genuinely-evaluated `0/0` stays "quiet") with the readiness UNKNOWN cell pattern
(`WatchlistReadiness.tsx:320-328` — `TriangleAlert` + `QueryStateMessages errorText="unavailable"`). Bool →
inline render (not an `opportunityShared.tsx` enum-map entry). A NEW state cue with icon **and** text
(@AC-4 feature-155), not a reclassification of "quiet". UI path is passthrough (`insightsBff.ts:54`
`forward()`), so the field surfaces automatically; add e2e fixture + INVENTORY + spec (C-12).

### FR-3 — background bars-fetch isolation (reuse the materializer sem)
Route the `_compute_opportunities` fan-out (`servicer.py:3838/:3852/:3895`) onto the **existing
`_readiness_materializer_bars_sem`** (`:448-456`); `_enrich_opportunities_live` (`:3444/:3458`) +
`EvaluateReadiness` (`:2826`) stay on `_bars_fetch_sem`. **No new config key, no migration** — both the
opportunity compute and the readiness materializer are *background* work competing with the *interactive*
read path (the feature-181 R-F precedent already routed the on-read readiness kick this way). This keeps the
aggregate marketdata bars-fetch concurrency bounded by one `[1,5]` background key + one `[1,5]` interactive
key = ≤ the marketdata PgBouncer pool ceiling (5), and **cannot re-open the feature-141 SEV-2** (three
independent `[1,5]` sems would sum to 15). Trade-off accepted: the daily opportunity recompute and the
readiness materializer serialize against one background budget (correct for a shared pool).

### FR-4 — non-blocking cold read + `computing`/failed
Additive `bool computing = 3` on `ListOpportunitiesResponse` (`analysis.proto:627-630`, next free = 3).
The cold `else` branch (`servicer.py:3368-3372`) replaces the synchronous `_materialize_opportunities` with
`_kick_opportunity_recompute` + `computing=True`, `rows=[]`. The empty-stamp branch (`:3365-3367`) and stale
branch leave `computing=False` — **default-false is the proof of distinctness**: empty-universe → empty
*without* the flag (preserves @AC-4's no-recompute-per-poll); cold → empty *with* it. A **terminal
compute-failed** marker (a bounded-retry / failed stamp) is added so a persistently-failing recompute
(`_kick_opportunity_recompute._run` swallows exceptions, `:3535-3536`) renders an error, not an infinite
spinner. The existing `useOpportunities` React-Query poll serves the pending flow; the only UI change is a
`computing && empty` vs `!computing && empty` vs failed render branch (a `refetchInterval` gated on
`computing` if the hook lacks one).

### FR-5 — surgical read-time recovery (generic reusable helper)
On a `ListOpportunities` **fresh** read, scan served rows for the stale-unavailable set
`{r.symbol for r in rows if "unavailable" in r.provenance and now-r.computed_at > _OPPORTUNITY_UNAVAILABLE_RETRY_SECONDS(=300)}`
(provenance + `computed_at` already selected, `opportunities.py:99`). If non-empty, fire a fire-and-forget
`_kick_opportunity_retry(user_id, symbols, meta)` that:
- takes `_opportunity_lock` (`:3484`), **skips if `user_id in _opportunity_recomputing`** (a full recompute
  already heals), dedups via a new `_opportunity_retrying: set[str]` **cleared in a `finally`** (no stuck flag);
- re-fetches bars for **only those symbols** on `_readiness_materializer_bars_sem` (bounded per-symbol
  footprint — the scalable choice under an outage; a full-universe recompute per data-down user every 300s
  is a retry-amplification/thundering-herd that re-opens the 141 SEV-2 class), re-traces via the existing
  `_load_strategy_definition`/`evaluate_conditions_traced`/`_load_benchmark_bars_windowed` primitives, and
  **re-drains active signals** (`_drain_active_signals`) so a healed row restores **both** `conviction` and
  `signal_axis` (never a dishonest zeroed axis, P-03);
- writes via a new **`replace_symbols(user_id, symbols, rows)` = UPDATE-in-place heal-only** (it may only
  heal rows that still exist; it never INSERTs a `(symbol,strategy)` key not already present, so it cannot
  **resurrect** a row a full compute would have dropped — the whole-user-replace invariant, `opportunities.py:44-46`,
  is honored to the degree a partial refresh can; a universe-membership change reconciles at the next daily
  full compute — the same bounded staleness the stale-serve path already accepts);
- **re-stamps `computed_at` unconditionally** (including a still-unavailable outcome) so the 300s cooldown
  holds and a poll storm cannot form;
- **never** calls `_replace_and_stamp_compute_state` (`:3492`) → the empty-only stamp / @AC-4 is untouched.
The scan runs **only on the fresh-hit path**, never on the stale-served set (the stale branch already fires a
full recompute — avoids double work + lock contention).

**Readiness-cache subset heal (operator refinement):** because a watchlist×strategy **entry-rule** readiness
is a subset of the opportunity compute, when the helper re-evaluates a recovered symbol it also upserts the
fresh readiness rows for that `(symbol, strategy, entry)` subset into `analysis.readiness_cache` (reusing the
compute's existing `_readiness_cache_repo.upsert_many`, `servicer.py:2871/:3092/:4161`), **success-only** — a
still-down symbol stays uncached (@AC-5/177). This EXTENDS the compute's existing readiness-cache write to the
healed subset; it does **not** change the readiness materializer loop or read path (180/181/182 PRESERVE).

**Reusable helper:** the recovery is built generic (re-fetch + re-evaluate + heal-in-place a symbol subset)
so the **fundsignal loop** can adopt it later — feature **186** (named follow-up); 185 wires it only into
opportunities.

**Paging stability:** add `, o.opportunity_key ASC` as the final ORDER BY tiebreak (`opportunities.py:114`)
— all unavailable rows tie at `conviction=0, signal_axis=0`, and a partial re-INSERT/UPDATE reshuffles
physical order, so without a unique tiebreak offset pagination (`servicer.py:3380-3387`) could dup/skip a row
across polls. A pure tiebreak — it does not reorder non-tied rows (no @AC-14 ranking change).

### FR-6 — agent consumer surface (C-14)
Project `data_unavailable` (+ `computing`/failed) in `_opportunity_to_dict` (`client.py:747-789`) and add an
`Opportunity` **descriptor-parity test** (template `test_backtest_view.py:189`) — there is none today and
the projection already drifts (omits `valid_until`(9)/`signal_confidence`(19)); **back-fill those two** so the
new parity test passes with **no silent allow-list** (fails 1151/308/309). The agent is a **one-shot,
non-polling** consumer, so a cold/failed queue must surface `computing`/failed (tool text) rather than a
silently-empty result. Update the `tools.py:1161` docstring.

---

## Rejected Alternatives

1. **New enum on `Opportunity` (`ReadinessState.UNKNOWN`-style, C-04).** Heavier (enum-map entry, zero-value
   sentinel, enum-render contract) for a binary state. The additive bool mirrors `muted` and is the minimal
   honest representation. Revisit only if the state space grows beyond binary.
2. **A new dedicated `analysis.opportunity.compute_max_concurrent_bars_fetches` config key (default 1).**
   Re-introduces a third independent `[1,5]` bars-fetch sem → worst-case aggregate 15 (3× the marketdata pool
   ceiling), re-opening the feature-141 SEV-2 across the settable range, plus a config migration + a 185→184
   dependency. Rejected for reusing the existing materializer background sem (FR-3).
3. **Retry = read-time 300s kick → full `_compute_opportunities`.** Correct/authoritative, but a
   retry-amplification/thundering-herd during a marketdata outage (N users × full-universe fetches every
   300s) — the exact multi-user pressure of the 141 SEV-2. Rejected for the bounded per-symbol surgical
   recovery (operator's scalability call).
4. **Retry = compute-state short-window (overload `_replace_and_stamp_compute_state`).** A single per-user
   compute-state row with two meanings (empty-suppression + unavailable-retry) is a real @AC-4 collision.
   The read-time surgical kick sidesteps it entirely (never touches that stamp).
5. **No active retry (heal at ~24h `valid_until`).** Simplest, but a brief blip shows "unavailable" for up to
   a day — too weak for a robustness feature.
6. **FR-4 keep cold synchronous; `computing` on the stale path only.** Preserves the one-shot agent contract
   but walks back the operator-committed non-blocking cold read; rejected in favor of committing FR-4 and
   fixing the agent (FR-6) + adding the terminal failed state.
7. **Re-scope 185 to platform-wide surgical recovery (opportunities + readiness materializer + fundsignal).**
   Contradicts the approved Out-of-Scope, needs C-16 sign-off for the readiness paths, and balloons the
   blast radius. Rejected for a **generic helper wired to opportunities only**, with fundsignal deferred to
   feature 186 and the readiness-cache subset healed as an EXTEND of the compute's existing write.
8. **`FormulaExecutionError` → "unavailable".** A formula bug is not a data outage; catching it as
   unavailable is the fails-313 meaning-vs-convenience trap. Only `grpc.RpcError`/transport is caught.

## Open Risks (→ context.md Open Threads)

- **Surgical partial-replace correctness (top risk).** `replace_symbols` must be UPDATE-in-place heal-only
  (no resurrection) and the `opportunity_key` tiebreak is load-bearing for paging. /sdd-spec details the exact
  SQL + the RED tests (heal-in-place; no-resurrection; thin-`[]`-not-flagged; paging stable across a partial
  replace). — target: FR-5 steps.
- **Universe-membership staleness** on a healed row until the next daily full compute (bounded; same as
  stale-serve). Documented, accepted.
- **`_opportunity_retrying` finally-clear + fresh-hit-only scan** — a stuck flag or a scan on the stale set
  would storm; enforce in code + test.
- **Agent one-shot vs `computing`** — the tool must not report a cold/failed queue as empty; FR-6 covers it.
- **Readiness-cache subset upsert must be success-only** (@AC-5/177) and must not perturb the readiness FAST
  gate / `bar_epoch` semantics — verify at spec/execute.
- **`computing` terminal-failed shape** — bounded-retry vs a failed stamp; /sdd-spec settles.

## Constitution Rules Touched

| ID | How honored |
|---|---|
| **C-04** | `data_unavailable`/`computing` are bools (binary flags, `muted` precedent) — zero-value enum rule N/A; no new enum. |
| **C-08 / P-06** | Every code-bearing step (sentinel, sem, cold read, surgical recovery, agent) has a paired RED-first test (incl. the abort-contract RED test and the parity test). |
| **C-09** | Additive proto fields run `buf lint`/`buf breaking` + `buf-gen.sh` (all 3 stubs). |
| **C-10(b)** | The sentinel is surfaced at **every** read/filter layer (read floor + mock predicate + UI + agent) — fails-1547 heeded. |
| **C-14** | Consumer surfaces named + reached: UI `/insights/opportunities` (unavailable + computing + failed) and agent `list_opportunities` (project + parity test) — the agent is mandatory (one-shot consumer). |
| **C-15** | FR-1→AC-1/2/5, FR-2→AC-3, FR-3→AC-4, FR-4→AC-6/7, FR-5→AC-8/9, FR-6→AC-10. |
| **C-16** | PRESERVE @AC-14 (sentinel out of ranking hot path via zeroed axes), @AC-4/@AC-5/@AC-1/@AC-2 (177 caching + readiness FAST path untouched; readiness-cache upsert is success-only + subset-only), @AC-2/@AC-3 (181/180 readiness paths untouched), @AC-11 (095 live-quote omit). EXTEND the feature-095 agent `@AC-15`. **No CHANGE → no sign-off required** (verified: the sentinel does not reclassify an existing `0/0`/"quiet" row, and the readiness-cache subset upsert is the compute's existing write, not a readiness-path change). |
| **F-01/F-07** | No edited migration (no migration at all); sem bound read from config (existing key), retry cadence a code constant (readiness precedent). |

**Floor breaches:** none (adversary-confirmed across all 3 rounds: no proto-break, no analysis pool change, no edited migration).

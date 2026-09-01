# Context: fundamentals-blend-universe

**Feature**: `docs/roadmap/features/168-fundamentals-blend-universe/feature.md`
**Product Spec**: `docs/roadmap/features/168-fundamentals-blend-universe/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/168-fundamentals-blend-universe/implementation-spec.md`

---

## Session 2026-08-31 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- **Grounding (codebase-discovery digest):**
  - `fundamentals_macd_blend` is **agent-registered per-user** (via `manage_strategy`), stored in
    `analysis.strategies` (`migrations/001_strategies.up.sql`; composite `(user_id, strategy_id)` PK
    from `013_strategies_user_id`, feature 133) — **not** a seed migration. Reference:
    `docs/reports/2026-07-20-custom-indicators-strategies.md:38`,
    `docs/reports/2026-08-24-strategy-bakeoff.md`.
  - Strategy execution owned by `xstockstrat-analysis` live loop
    (`app/engine/live_loop.py`, feature 048). The `(strategy, symbol)` selection seam is
    `_run_cycle` (`live_loop.py:289-312`) calling `resolve_universe` (`live_loop.py:83-105`,
    feature 132: `union = allowlist or (watchlist | held | (signals if signal_eligible else set()))`).
    Only `live_enabled` strategies are iterated (`live_loop.py:275-278`).
  - "signal source == fundamentals" = `QuerySignals(source="fundamentals")`
    (`packages/proto/ingest/v1/ingest.proto:128`); producer default slug `fundamentals`
    (`analysis.fundsignal.source_slug`). "has actual fundamentals" = a symbol for which
    `GetFundamentalsMulti` returns a row (marketdata, the single FMP/Finnhub chokepoint, feature 059;
    pattern seen in `app/engine/fundsignal_loop.py:373-378`).
  - **Feature 154** (`fundsignal-watchlist-universe`, launched) is about the fundamentals **producer's**
    universe (which symbols get scored to emit signals), NOT running a strategy over a universe — this
    feature is adjacent but distinct and extends the live-loop universe logic (features 132/133), not 154.
  - **No existing "run strategy X on sub-universe Y, exclude elsewhere" logic** — net-new. Achievable
    without a proto change using existing fields + engine logic.
- **Prior features to respect:** 047 (evaluator), 048 (`live_enabled`, live loop, alerts only — never
  places orders; ledger: add proto/DB field + row mapper in lockstep), 132 (deny list / allowlist /
  `signal_eligible` universe knobs), 133 (per-user strategy ownership resolved from `x-user-id`), 059
  (fundamentals via marketdata chokepoint, `marketdata.fmp.enabled=false` default), 062 (`fundamentals`
  derived signal source).
- **Ledger traps folded in:** conviction ordinal-vs-probability confusion (signals) — noted for design;
  fundamentals-signal-producer fail-open validator — new config validated fail-closed; migration-number
  collisions — N/A (no migration).
- **Central design fork (Open Question):** the blend strategy is per-user/agent-registered, so "run it
  in addition to the user's selection" must decide per-user application vs promoting the strategy to a
  global/platform strategy. Surfaced in product-spec `## Open Questions`; to be resolved in `/sdd-design`.
- **Consumer surface (C-14):** None (internal engine rule); output reaches users via existing
  live-strategy alerts (feature 048) + opportunity attribution (feature 131). Operator visibility flagged
  as a possible follow-up, not silently deferred.

## Session 2026-08-31 — sdd-review product-spec

- Ran /sdd-review (not skipped). spec-reviewer + feature-overlap.
- Initial verdict: FAIL (criterion 9 — six unchecked Open Questions; OQ#1 per-user-vs-global load-bearing on
  FR-1/FR-2) + NOTE on imprecise proto line cites. Overlap: CLEAN (`analysis.engine.fundamentals_blend_*`
  keys unclaimed; no proto/migration collision; watch `resolve_universe`/`_run_cycle` same-function zone at impl-spec).
- Fixes: Open Questions → "Resolved Design Decisions" — committed to PER-USER reading (global promotion moved to
  Out of Scope as rejected alternative); enable flag `analysis.engine.fundamentals_blend_enabled` (default true);
  precedence vs feature-132 (denied_symbols subtracts, blend allowlist ignored); once-per-cycle universe reuse.
  Fixed proto cites (ingest.proto:129 source; analysis.proto:318 signal_params / :351 symbols key).
- Re-review verdict: PASS (0 blockers, 0 warnings).
- Status: draft → spec-ready. Next: /sdd-design fundamentals-blend-universe quick.

## Session 2026-08-31 — sdd-design

- Phase 0 Recon: refreshed/extended recon.md (service: xstockstrat-analysis; read deps ingest,
  marketdata, config). Key regroundings vs the prior partial recon:
  - The enforcement seam is `_run_cycle` (`live_loop.py:263-356`); `resolve_universe` is called at
    `:296-298` and records built `:300-309`.
  - `_drain_signals` (`:358-385`) filters by `active_window`, NOT `source` — so the fundamentals
    universe needs its OWN `QuerySignals(source=slug, active_window=[now,now])` call; it cannot reuse
    `_drain_signals` (which returns only symbols).
  - `get_bool` (`watcher.py:116-122`) is `HasField`-based → the kill-switch default `true` does NOT
    swallow an explicit `false`. The config zero-trap family does NOT apply to the enable flag. RESOLVED.
  - "has fundamentals" reuse point = `fundsignal_loop._paced_fetch:373-378` (symbol present in
    `resp.fundamentals`). Fundsignal is a separate ~daily loop; no shared in-process fundamentals cache.
  - Key-reuse patterns: extend the `resolve_universe` call site (not a parallel path); fail-closed-to-empty
    mirrors `_drain_signals`; source slug from `analysis.fundsignal.source_slug` (F-07).
- Phase 1 Grilling: 2 rounds (full). Chosen approach: a single universe-override branch in `_run_cycle`,
  gated by `analysis.engine.fundamentals_blend_enabled` (bool, default true, kill-switch) targeting
  `analysis.engine.fundamentals_blend_strategy_id` (string, default `fundamentals_macd_blend`), fed by a
  once-per-cycle fundamentals-universe resolver (new source-filtered QuerySignals ∩ GetFundamentalsMulti
  "has row") that fails closed to empty (FR-6). No proto change, no migration. When
  `strategy_id == blend_id`: universe = `(fundamentals_universe − denied_symbols) | (held ∩ denied)`
  (feature-132 precedence: denied subtracts, blend allowlist ignored); all other strategies unchanged
  (AC-3). Rejected: global-strategy promotion, parallel loop, per-strategy GetFundamentalsMulti fan-out,
  unconditional per-cycle resolution, broad-universe fallback on error, hardcoded source string,
  honoring the blend allowlist.
- Constitution rules touched: C-05, C-08/P-06, C-10, C-13, C-14, C-16 (AC-3 preserved), F-06, F-07, P-03.
  Floor breaches: none (F-06 + F-07 both honored by construction).
- Business rules: PRESERVE feature-154 @AC-3 and feature-156 @AC-1 (read-only consumer, slug reused);
  no existing @AC-* extended or changed.
- **Deferred to the orchestrator (ledger 2026-08-08 nested-subagent trap):** this isolated subagent run
  has no `AskUserQuestion`, so the final Phase-1 approval gate and the `spec-ready → design-approved`
  status.md flip were NOT performed. Two operator-confirm items must be answered before /sdd-spec:
  (1) held-but-left-universe exit alert — strict FR-2 (recommended, matches AC-2, alert-only loop) vs
  union-held-for-exit (feature-132 spirit); (2) accept shipping without a cross-cycle TTL cache (the
  fundamentals universe re-resolves every ~60s cycle when a blend strategy is live; recommended: ship,
  defer the cache). Artifacts written this session: recon.md, design.md. status.md left at spec-ready.

## Session 2026-08-31 — design decisions resolved (operator defaults)

- Held-but-left-universe exit alerts: RESOLVED to strict FR-2 (a symbol that drops out of the fundamentals universe is not re-added for exit unless it is a held ∩ denied case per the blend rule). Design's recommended option.
- Cross-cycle TTL cache for the fundamentals universe: NOT added in this feature (resolve-once-per-cycle is sufficient; a TTL cache is a possible later optimization). Design's recommended option.

## Session 2026-08-31 — sdd-spec

- Generated implementation-spec.md with 6 steps. (status.md deliberately left at `design-approved` —
  this was an isolated spec-authoring run; the `design-approved → implementation-ready` flip is left to
  the orchestrating `/sdd-spec` session.)
- Confirms: NO proto change, NO analysis migration; the only migration is config seed
  `024_analysis_engine_blend_keys` (pre-assigned per merge-order.md:188-193 — 021→022, 031→023, 168→024,
  166→025).
- Key codebase findings:
  - **Config seed `key`-column convention (critical):** the WatchConfig snapshot `values` map is keyed by
    the RAW `row.key` with no namespace prefix (`configServiceImpl.ts:176`), and analysis reads the FULL
    dotted key (`watcher.py:90`). So `024` must store `key='analysis.engine.fundamentals_blend_*'`
    (namespace `analysis`), matching migration 021's authoritative full-dotted form — NOT migration 008's
    split `fundsignal.*` form (008 predates the feature-147 schema; its default==seeded values mask the
    mismatch). Post-147 scope columns: `user_id NULL`, environments `staging`+`production`,
    `ON CONFLICT (namespace, key, environment, COALESCE(user_id,'')) DO NOTHING`.
  - `buildConfigValue` (`configServiceImpl.ts:565-576`): `bool` → `bool_val = value_data==='true'`,
    `string` → `string_val`; so `get_bool`'s `HasField("bool_val")` (`watcher.py:116-122`) honors an
    explicit operator `false`, default stays `true`.
  - Resolver reuse: `_drain_signals:358-385` (paginated `QuerySignals`, best-effort fail) drops `source`,
    so the resolver needs its own `QuerySignals(source=slug, active_window)`; "has-fundamentals" reuse =
    `fundsignal_loop._paced_fetch:373-378` (`GetFundamentalsMulti`, keep `f.symbol.upper()` present in
    `resp.fundamentals`). Slug from `analysis.fundsignal.source_slug` via `get_str` (F-07; same-namespace,
    no cross-namespace subscription).
  - `_run_cycle:263-356` — override branch strictly on `definition.strategy_id == blend_id` reproduces
    feature-132 precedence with `fundamentals_universe` in place of `union`: `universe =
    (fundamentals_universe − denied) | (held ∩ denied)`; strict FR-2 (held not unioned in; only held∩denied
    re-enters for the exit trace). All other rows untouched → AC-3 no-regression asserted in Step 5.
  - Test harness: `test_live_loop.py` `_make_loop:36-56`, `_live_row:629-648`, `_wire:766-786`,
    `fake_eval` pair-capture pattern — reused for the two new RED-first test classes.
- Every `@AC-*` covered by a test step: AC-1/AC-6 in Step 3 (resolver) + Step 5 (cycle); AC-2/AC-3/AC-4/AC-5
  in Step 5. Deduped Reviewers: DBA, xstockstrat-config, xstockstrat-analysis (docs step = none).

## Session 2026-08-31 — sdd-review impl-spec (advisory)

- Result: 0 failures, 3 advisory warnings (all cosmetic/justified). No Floor risk. Full-dotted key convention confirmed (021 precedent, not the stale 008 split form); strict FR-2 exit (held∩denied only re-enters); AC-3 no-regression (else-branch byte-for-byte); get_bool HasField-based so explicit false kill-switch honored; reads via existing QuerySignals/GetFundamentalsMulti (no new RPC/pool); config seed 024 confirmed.
- Advisory ⚠ (optional, no gate impact):
  - Steps 2/4 Instructions verbose-but-complete — cosmetic. — [ ] note only
  - C-03 letter: the resolver's outbound QuerySignals/GetFundamentalsMulti carry no x-user-id — justified as platform-global background-loop reads (mirrors _drain_signals). — [ ] note only
  - Minor normalization asymmetry in S&F intersection (`f.symbol.upper()` vs `_normalize_symbol`); optionally use `_normalize_symbol(f.symbol)` for symmetry. — [ ] optional
- Overlap findings: batch scan CLEAN; 168 shares config-governance.md / analysis CLAUDE.md with 095 (distinct sections).

## Session 2026-09-01 — sdd-execute (all 6 steps, one PR)

Executed the 6-step spec on `feature/fundamentals-blend-universe` (off `main-dev` 0a23b475), one
commit per step-pair, red-before-green on both code-bearing pairs.

- **Steps 1-3 (commit 816e85c7)** — config seed migration `024_analysis_engine_blend_keys`
  (`.up`/`.down`, 2 keys × staging/production, full-dotted-key form, `ON CONFLICT … DO NOTHING`) +
  `_resolve_fundamentals_universe()` in `live_loop.py` (QuerySignals `source=slug` ∩
  `GetFundamentalsMulti` has-row, chunked by `_FUNDAMENTALS_CHUNK=50`, fail-closed to empty on any
  error, FR-6/AC-6) + `TestLiveLoopFundamentalsUniverse` (3 tests, RED before Step 2 via
  AttributeError, GREEN after). **Deviation (impl-review advisory #3, accepted):** used
  `_normalize_symbol(f.symbol)` for the fundamentals side instead of the spec's `f.symbol.upper()`,
  for symmetry with the signal side — behavior-equivalent for uppercase tickers, cleaner.
- **Steps 4-5 (commit cb87285a)** — the config-gated override branch in `_run_cycle`: two
  cycle-start reads (`get_str` blend id, `get_bool` kill-switch), `blend_active = enabled AND the
  governed strategy is live this cycle`, resolve the fundamentals universe **once** only when
  `blend_active` (else no QuerySignals/GetFundamentalsMulti — FR-5/AC-4, F-06 pacing), and for the
  governed row **only** replace its universe with `(fundamentals_universe − denied) | (held ∩
  denied)` (strict FR-2; held not unioned in). Every other row keeps `resolve_universe` unchanged
  (AC-3). `TestLiveLoopBlendUniverse` (7 tests): the 5 substantive AC-1/2/3/5/6 cases authored RED
  (failed on the pre-Step-4 tree — the blend ran on its ordinary watchlist/held universe) and GREEN
  after; the 2 no-op guards (blend-not-live AC-4, kill-switch-off) hold both ways
  (`GetFundamentalsMulti.await_count == 0`).
  - **RED→GREEN evidence:** `pytest -k BlendUniverse` → 5 failed / 2 passed pre-Step-4; 7 passed
    post-Step-4. Full `test_live_loop.py` 44 pass (no regression). Analysis suite 654 pass, 85% cov;
    ruff check + format clean.
  - **No-regression safety (existing tests):** `_make_loop`'s cfg leaves `get_str`/`get_bool`
    unstubbed, but MagicMock `__eq__` compares by identity, so `blend_active` resolves to a real
    `False` for the FairShare/OwnerScoped tests — the override branch is never taken and the resolver
    is never called there.
- **Step 6 (commit d1af4a0e)** — registered both keys in the config-governance Per-Feature log
  (newest-first) and `services/xstockstrat-analysis/CLAUDE.md` § Config Keys Consumed.

**Teardown / context-scrubber:** Step 6 touched two context/governance docs
(`docs/patterns/config-governance.md`, `services/xstockstrat-analysis/CLAUDE.md`). The
`context-forge` plugin / `/context-scrubber` skill is **not available in this session**, so the
scan could not run here — flagged per the root Teardown rule; the edits are limited to the two
newly-registered `analysis.engine.*` keys.

Status → `code-completed`.

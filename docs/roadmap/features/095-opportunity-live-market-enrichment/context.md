# Context: opportunity-live-market-enrichment

**Feature**: `docs/roadmap/features/095-opportunity-live-market-enrichment/feature.md`
**Product Spec**: `docs/roadmap/features/095-opportunity-live-market-enrichment/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/095-opportunity-live-market-enrichment/implementation-spec.md` _(not yet generated)_

---

## Session 2026-08-02 — sdd-story

- Created `feature.md` (status: `draft`), `product-spec.md`, and this `context.md` from a follow-up
  story: fill the backend gaps **and** the UI for the Nocturne handoff extras that feature 083
  intentionally left un-faked.
- **Origin.** During the 083 fidelity pass that raised the single Opportunity (Signal detail) and
  single Position detail pages, several handoff elements were omitted because **no current RPC returns
  them** and 083's no-fabrication rule forbids synthesizing them: live price/change, price sparkline,
  per-condition value chips on the queue, target/stop chart overlays, and R:R + share sizing on the
  ticket. This feature is the backlog item to close those gaps (backend RPC/proto + the UI that
  consumes them). See 083 `context.md` § "No-fabrication constraint honored" and the two-detail-page PR.
- **Scope framing.** Additive-only backend (new `Opportunity`/`SymbolReadiness` proto fields sourced
  from marketdata quotes/bars; no schema change) + the UI wiring on `insights/opportunities` and
  `insights/market/[symbol]`. Streaming price push, ranking-math changes, and broker bracket/OCO
  orders are explicitly out of scope.

### Governance inputs read at story boot

- **reviewer-registry.md** — affected owners: `xstockstrat-analysis` (aggregation + no-look-ahead),
  `xstockstrat-marketdata` (quote/bars read), `xstockstrat-ui` (consumer), `packages/proto` (additive
  fields) + Platform Lead (edge) + Proto Reviewer; portfolio/indicators FYI. Snapshot provisional —
  finalized at `/sdd-spec`.
- **fails.md traps surfaced** (to design out, per P-05):
  - **056 → C-10(b):** live price/change appears on both the queue card and the Signal-detail header —
    it must be surfaced by the *same* field from the *one* marketdata source, with a cross-surface
    parity test (FR-7 / AC-2). Do not enrich one read path only.
  - **067 → C-10(a/d):** appending a proto **enum** value hard-couples to the exhaustive TS
    `Record<Enum,…>` maps in `opportunityShared.tsx`. This feature adds **fields**, not enum values, so
    it should not fire — but if a new enum sneaks in, update the map in the same PR. Captured in the
    Proto section.
  - **067 → P-03:** `MessageToDict` rejects `NaN`/`Inf` in a `Struct`; model sparkline warm-up/absent
    points as `null`, not `NaN`. Captured in Open Questions.
  - **080/082 → absence-claim:** the "analysis→marketdata edge / latest-quote RPC already exists"
    claim must be grep-verified end-to-end (BFF route + browser client + mock), not from advertised
    proto alone, at the design gate. Captured in Open Questions.
  - **analysis owner review focus → no look-ahead:** folding a live quote into the Decide surface must
    not leak future data into conviction/readiness (AC-7); hot backtest path stays frozen.

### Next

- `/sdd-review opportunity-live-market-enrichment product-spec` (product-spec gate), then
  `/sdd-design opportunity-live-market-enrichment` (recon should resolve the Open Questions:
  target/stop source, existing latest-quote read, per-condition chip source, sizing location,
  sparkline payload shape).

## Session 2026-08-31 — sdd-story (in-place regenerate)

- Regenerated `product-spec.md` to the current template (sections reordered; added an explicit
  `## Consumer Surface(s)` C-14 block naming the Decide / Signal-detail / order-ticket surfaces) and
  authored `acceptance.feature` (14 `@AC-*` scenarios, every FR-1..FR-7 covered by ≥1 `@FR-*` tag).
  Feature **number 095 kept** — no new directory, no renumber; status stays `draft`.
- **All 083 scope preserved.** This remains the follow-on that fills the backend gaps + the UI for
  the Nocturne handoff extras feature 083 deliberately left un-faked; the inherited **no-fabrication
  rule** (FR-6) is enforced as concrete graceful-degradation scenarios (quote unavailable → price
  omitted not synthesized; sparkline gap → `null` not `NaN`; absent target/stop → no line, not a zero
  line; off-queue symbol → symbol+price-only header).
- **Ledger traps folded into Open Questions as one-line "Known trap" notes:** latest-quote RPC
  existence is an absence claim, grep-verify end-to-end (fails 080/082); sparkline gaps as `null` not
  `NaN` because `MessageToDict` rejects non-finite (fails 067 / P-03); same-field cross-surface price
  parity with a parity test (fails 056 / C-10(b)); no-look-ahead when folding the live quote into
  ranking (analysis owner focus, AC-14).
- **Next:** `/sdd-review opportunity-live-market-enrichment product-spec`, then `/sdd-design`.

## Session 2026-08-31 — sdd-review fixes (product-spec)

`/sdd-review product-spec` returned **FAIL (criterion 9)** with warnings. Applied the review fixes
(docs-only, feature 095 dir; number/slug/status `draft` unchanged):

- **Target/stop source (blocker #1, resolved inline in FR-4).** `target_price`/`stop_price` come from
  the opportunity's **originating signal / strategy definition** where present; when **absent they are
  omitted** (no overlay line), never derived or fabricated. No ATR derivation — `xstockstrat-indicators`
  is **out of scope**.
- **R:R + suggested-sizing location (blocker #2, resolved inline in FR-5).** Both are computed
  **client-side in the UI** from already-available values (live price, target, stop, buying power).
  Dropped the `risk_reward` and `suggested_qty` proto fields — **no server fields** carry them.
- **Live price data shape (W2).** The existing `GetLatestQuote`/`Quote` returns **bid/ask only** (no
  last-trade, no prior close), yet the scenarios need a latest **trade** price + **prior close**
  (change% is from prior close). Added an **additive, non-breaking** `xstockstrat-marketdata` change
  (additive `Quote` fields at 8+ or a small latest-trade read RPC — shape at `/sdd-design`) to the
  Proto section and Affected Services.
- **Proto field pre-assignment (W, coordinate with 110).** Pre-assigned a **contiguous `Opportunity`
  enrichment block starting at field 13**: `live_price=13`, `change_pct=14`, `target_price=15`,
  `stop_price=16`, sparkline=17, optional per-condition live-value carrier=18. Note added: **feature
  110 appends its confidence field AFTER this block (next free field, 19+); see merge-order.md (110
  blocked by 095)**. `SymbolReadiness` additive after field 5.
- **AC-14 traceability (W3).** Added a dedicated **FR-8 (no-look-ahead invariant)** and **re-tagged
  AC-14 from `@FR-1` to `@FR-8`** so the no-look-ahead scenario traces to the requirement it actually
  guards. FR-1..FR-7 keep full coverage; FR-1 still covered by AC-1/AC-2/AC-13.
- **Open Questions reorganization (criterion 9).** After resolving the two scope questions inline,
  `## Open Questions` now reads **"None — resolved inline or moved below"** (no unchecked `- [ ]`). The
  latest-quote data-shape decision (now answered by the additive marketdata change) plus the remaining
  mechanism/shape choices (per-condition chip fold-in, sparkline payload shape, SymbolReadiness reuse)
  moved to a new **`## Design-Phase Decisions (owned by /sdd-design)`** section; the three known traps
  (analysis→marketdata edge verify; sparkline `null`-not-`NaN`; cross-surface price parity) moved to a
  new **`## Design Guardrails`** section.
- **Config unchanged in intent:** `analysis.opportunity.sparkline_bars` stays env-overridable (F-07);
  firmed from "possible" to confirmed-in-scope now that the sparkline is `Opportunity` field 17.
- **Next:** re-run `/sdd-review opportunity-live-market-enrichment product-spec` to clear the gate,
  then `/sdd-design`.

## Session 2026-08-31 — sdd-review product-spec (approved)

- Product spec approved: `draft` → `spec-ready`. All `/sdd-review` blockers and warnings were addressed (see the sdd-review-fixes session above).
- NOTE: the confirming re-review pass was interrupted by a session usage/rate limit; fixes were applied against each reviewer's explicit findings. For 021 specifically, the orchestrator manually caught and fixed a residual field-name error (`service_origin` → `source_service`; the ledger `Event` has no `user_id` field). A quick re-review can re-confirm on resume.

## Session 2026-08-31 — sdd-design

- Phase 0 Recon: wrote `recon.md` (services: analysis, marketdata, xstockstrat-ui, packages/proto). Key reuse patterns: read-time enrichment in `ListOpportunities` (`servicer.py:2992-2995`); the `IndicatorValue`/`optional double` null-safe idiom (`servicer.py:2919-2924`); `ConditionEval` verbatim; `SymbolPriceChart`/`priceLinesRef` for overlays.
- Phase 1 Grilling: 2 rounds (full). **Chosen approach:** enrich at READ time (post-ranking, post-`_row_to_opportunity`) so FR-8/AC-14 hold by construction; marketdata gets a small dedicated additive **`GetLatestPrice`** RPC (`optional last_price` + `optional prev_close`), NOT fields on `Quote`; `Opportunity` block **13-18 all explicit-presence**, field 18 = `repeated ConditionEval` from the already-computed trace (queue-card chips), 17 = `SparklinePoint{optional double close}` (gaps as unset, P-03); target/stop from `StrategyDefinition.signal_params.{target,stop}` where present (omit otherwise); R:R + sizing client-side (no server field); `SymbolReadiness` unchanged (Signal-detail header reuses `Opportunity` → same-field parity). **Rejected:** fields on `Quote` (cache-hit fabricated 0 + warm-poller bloat); `repeated double` sparkline (can't model a gap); compute-time enrichment (stale queue → not "live"); `SymbolReadiness` price fields (breaks C-10(b) same-field parity).
- **Absence-claim finding (fails 023/080/082):** target/stop has NO producer today — `ExternalSignal` and `StrategyDefinition` carry no numeric target/stop; fields 15/16 ship as plumbing fed from `signal_params.{target,stop}` (agent-writable) and render nothing until a **named follow-up** authoring feature. Operator confirm required. Also confirmed the Signal-detail surface is `trader/positions/[symbol]` (feature 125), not the `insights/market/[symbol]` redirect stub the spec names.
- Constitution rules touched: C-04, C-10(a/d — does NOT fire), C-10(b), C-14, C-15/C-16, C-03, C-09, C-17, F-04, F-07, P-03, P-06. **Floor breaches: none** (the F-04 target/stop-producer gap is surfaced as an Open Risk, not invented).
- Additive confirmation: `Opportunity` 13-18 and the marketdata `GetLatestPrice` RPC are additive/non-breaking (`buf breaking` green); field numbers 13-18 honored so feature 110 lands at 19+ (merge-order intact).
- Status: `spec-ready` → design-approved **pending** the two operator-confirm items (target/stop producer decision; read-pressure batching). `recon.md` + `design.md` written; `status.md` NOT flipped by this subagent.

## Session 2026-08-31 — design revision (confirmed operator decision)

Operator confirmed the target/stop Open Risk and expanded the consumer surface. Revised `design.md`,
`product-spec.md`, and `acceptance.feature` (docs-only; no code, `status.md` untouched).

- **DECISION 1 — target/stop ships WIRED, authoring deferred to a NAMED follow-up.** Fields
  `target_price=15`/`stop_price=16` ship as explicit-presence plumbing fed from
  `StrategyDefinition.signal_params.{target,stop}` where present, **omitted when absent, never
  fabricated** (design Open Risk option A). The strategy-builder *authoring* UI is the named follow-up
  **`strategy-target-stop-authoring`** (number allocated by `/sdd-story` when created — satisfies C-14's
  named-deferral rule). The Open Risk checkbox is now resolved; the `signal_params.{target,stop}`
  governance-note item remains.
- **DECISION 2 — update BOTH consumers: UI *and* Agent.** The prior design named only the UI. Added
  the **Agent** consumer. **Investigation finding:** the agent has **no opportunities surface** — a
  grep of `services/xstockstrat-agent` for `opportunit` is empty and no tool calls `ListOpportunities`.
  The closest tool `screen_symbols` (`app/tools.py:552` → `app/client.py:617`) reads a **different**
  RPC — `ScreenSymbols`→`ScreenResult` (`analysis.proto:451`) — which carries none of the 13-18
  enrichment fields (they live only on `Opportunity`). So a new tool is **necessary**: added FR-9 +
  design §(e) for a **read-only `list_opportunities`** MCP tool wrapping the existing
  `ListOpportunities` RPC (`analysis.proto:34`), projecting the enriched `Opportunity` with
  omit-not-fabricate (`HasField` gates for live_price/change_pct/target_price/stop_price; sparkline
  gaps as `null`; per-`ConditionEval` leaves). **Additive — no proto change** (reuses the 095
  `Opportunity` block; tool + `client.py` projection mirroring `screen_symbols` at `client.py:677-698`
  + `mcp-tools.md` entry). **Caller-scoped, no admin scope** — `ListOpportunitiesRequest` has no
  `user_id`; the queue resolves from the forwarded `x-user-id` (`analysis.proto:590-591`) via
  `CallerPropagationMiddleware` (AGENT-4), matching `list_watchlists`/`list_strategies`. R:R + sizing
  are **not** projected (UI-only, no wire field). Parity with the UI holds (same
  `Opportunity.live_price`, C-10(b)).
- **RECON CORRECTION applied to the spec.** The real Signal-detail surface is
  `trader/positions/[symbol]` (feature 125); `insights/market/[symbol]` is a **redirect stub**. Fixed
  the Consumer Surface(s) block and the Affected-Services `xstockstrat-ui` bullet in `product-spec.md`
  (design.md already had this right).
- **Field pre-assignment UNCHANGED.** `Opportunity` 13-18 kept exactly as-is (feature 110 lands its
  confidence field at 19+; merge-order intact). The agent change adds **no** proto field.
- **Artifacts touched:** `product-spec.md` (FR-9, Consumer Surface(s) Agent checked + tool named,
  Affected Services + `xstockstrat-agent`, Design-Phase Decisions confirmed-decisions block + named
  follow-up, signal-detail route corrected); `acceptance.feature` (**AC-15 @FR-9 @FR-6** — agent tool
  returns live_price, omits target when the strategy has none; all existing @AC-1..@AC-14 + tags
  preserved); `design.md` (Chosen Approach §(e) + Consumer-surfaces paragraph, 2 rejected
  alternatives, Open Risk resolved, C-14/C-15/C-16/F-04 updated, Rounds note). **Floor breaches:
  none** — F-04 honored (grep-confirmed agent absence; real RPC/paths cited).
- **Next:** re-confirm `/sdd-design` gate if desired, then `/sdd-spec` (which must now spec the agent
  `list_opportunities` step alongside the UI/analysis/marketdata steps).

## Session 2026-08-31 — sdd-spec

- Generated `implementation-spec.md` with **13 steps**. Status → `implementation-ready`.
- Consumed `recon.md` + `design.md` (design-approved) as authoritative inputs; recon's Codebase Map
  reused directly as grounded `path:line` evidence, with targeted re-discovery only for the agent
  service (added in the design revision, thin in recon).
- **Step shape (13):** 1 proto (additive `Opportunity` 13-18 + `SparklinePoint`; marketdata additive
  `GetLatestPrice` RPC) → 2 proto-gen → 3-4 marketdata Go (`GetLatestPrice`: latest trade + prior
  close, cache/DB-backed) → 5 config (`analysis.opportunity.sparkline_bars`=20, no-seed) → 6-7 analysis
  Python (read-time enrichment) → 8-11 UI (plumbing, queue cards, Signal-detail, order ticket) → 12-13
  agent (`list_opportunities` MCP tool). Every AC-1..AC-15 mapped to a covering step (§ Scenario Coverage).
- **Key codebase findings / spec-time resolutions:**
  - **Descriptor-parity split (grounded refinement of design's "how"):** `_row_to_opportunity`
    (`servicer.py:3855`) is pinned by `TestOpportunityRowParity` (`tests/test_analysis_servicer.py:4847`,
    `_MAPPED | _INTENTIONALLY_UNSET == Opportunity.DESCRIPTOR.fields_by_name`). Adding fields 13-18
    fails `test_mapper_covers_every_proto_field` until updated. Resolved: **compute-time
    strategy-derived** fields (`target_price`/`stop_price`/`conditions`) are persisted in
    `_compute_opportunities`' row JSONB (no column/migration — like `muted` rides `"denied"` provenance,
    `:3873-3875`) and carried by `_row_to_opportunity` → join `_MAPPED`; **read-time live-market**
    fields (`live_price`/`change_pct`/`sparkline`) are set in `ListOpportunities` after ranking
    (`:2994-2996`) → join `_INTENTIONALLY_UNSET`. This keeps ranking frozen (FR-8/AC-14) AND satisfies
    the parity guard. `change_pct` is derived in analysis (`(last-prev)/prev`), never on the marketdata
    wire (design (a)).
  - **Config key uses the no-seed pattern:** `analysis.opportunity.*` keys have no config-service seed
    migration (features 131/141; `config-governance.md:223-261`) — declare default in analysis CLAUDE.md
    + Per-Feature Registered Keys log; read live via `get_int`. merge-order.md's config-migration NNN
    pre-assignment batch does NOT allocate one to 095 (consistent).
  - **Agent had no opportunities surface** (grep-confirmed); `screen_symbols` reads a different RPC
    (`ScreenSymbols`→`ScreenResult`). New read-only `list_opportunities` over the existing
    `ListOpportunities` RPC (caller-scoped via `x-user-id`, no admin scope). Tool-count invariant =
    **thirty-two → thirty-three** across five surfaces: `app/tools.py:4` docstring, `mcp-tools.md:3` +
    `:37`, agent `CLAUDE.md:43`, and the exact name-set in `tests/test_tools_endpoint.py:23-56`.
    Feature 164 is the precedent (`164/implementation-spec.md:236-244`). Not a `strat-lab` plugin API,
    so no plugin update.
  - **marketdata coverage:** new `service`/`handler`/`repository` logic is in coverage-**excluded**
    packages; the coverable assertion lives in `internal/alpaca/client_test.go` (latest-trade parse).
    Threshold 40%.
  - **UI anchors confirmed current** (post feature-125/143 landing): real Signal-detail surface is
    `trader/positions/[symbol]/page.tsx` (`useOpportunities`→`symbolOpportunities` `:185-189`,
    `SymbolPriceChart`/`priceLinesRef` `:129,:501-554`, `OrderForm` `:342`); both BFFs register
    `MarketDataService` with only `getBars` today (`insightsBff.ts:79-80`/`traderBff.ts:73-74`);
    `marketDataClient` is the generated full-service client (no edit needed for the new RPC);
    `mock-backend.ts:457` has only `getBars`; fixtures `OPPORTUNITIES`/`CAPR` + `symbolReadiness` in
    `e2e/fixtures/opportunities.ts` (INVENTORY rows 25-26). R:R/sizing → pure `src/lib/orderSizing.ts`
    + vitest (AC-9 numbers).

## Open Threads

- **Read-pressure vs. single-symbol RPC (design.md Open Risk, unresolved — surfaced, not guessed):**
  Chosen Approach (a) commits to a single-symbol `GetLatestPrice(symbol)` while the unchecked Open Risk
  asks the ≤50-row read-time enrichment to batch. Spec follows the committed single-symbol RPC and
  bounds fan-out with the existing `analysis.opportunity.max_concurrent_bars_fetches` semaphore
  (`servicer.py:381`) + per-pass dedup + cache/DB-served `prev_close`/bars (Step 4 paired check). A
  `GetLatestPricesMulti` batch RPC is the flagged follow-up if load testing shows pressure — not
  pre-built. To confirm at `/sdd-review impl-spec` or during Step 4 execution.
- **Deferred surface:** target/stop **authoring** UI → named follow-up `strategy-target-stop-authoring`
  (number allocated by `/sdd-story` when created). Fields 15/16 ship WIRED, rendering nothing until it
  populates `signal_params.{target,stop}`.

## Decisions

- Read-time enrichment is post-`_row_to_opportunity`, outside `_compute_opportunities`' ranking math →
  FR-8/AC-14 true by construction; live quote never enters the ranking hot path.
- Enrichment field placement: 13/14/17 read-time (`_INTENTIONALLY_UNSET`), 15/16/18 compute-time
  persisted (`_MAPPED`). `change_pct` derived in analysis, not on the marketdata wire.
- No DB migration; no config-service seed migration; no new env vars/ports.

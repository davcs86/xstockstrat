# Context: ui-revamp-opportunities-first  (archived 2026-08-06)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-06 — /sdd-archiver

**What**: Began as a UI-only presentation re-frame (product-spec's original "no backend change"
scope), shipped as a **five-subsystem backend build + full UI rewrite in one feature**, because the
user explicitly overrode the design's own recommended phased slicing mid-design. The shell
(Decide/Discover/Engine/Book) is a presentation grouping over the four pre-existing physical route
segments (`/trader|/insights|/config-ui|/accounts`) — no route migration. Every screen was required
to consume a real RPC, not a stub, which is why the ordering was strictly backend→frontend across 31
steps.

**Why (irrecoverable rationale)**: The user's directive ("do all within 083 … no phased migration")
was a deliberate governance-cost tradeoff: it activated the breaking/additive proto gate, config-key
gate, DB-migration gate, and expanded reviewers that the original product-spec had marked N/A —
accepted explicitly rather than deferred, because splitting into "shell now / data later" would have
shipped placeholder screens against the user's stated intent.

**Rejected alternatives**:
- UI-only 083 with backend deferred to 084+ (recon's own recommendation) — overridden by explicit
  user directive.
- `portfolio→trading` synchronous edge for resting-stop reads — would close a trading↔portfolio
  gRPC/`WAIT_FOR` cycle; replaced with portfolio learning the stop from trading's ledger order-event
  (already ledgered, insights.md 2026-07-31).
- TRIM-vs-EXIT action split, and conviction as an invented probability % — both manufacture a value
  from an undefined threshold on an order-opening surface; collapsed to `REDUCE` + a deterministic
  ordinal (already ledgered, insights.md 2026-07-31).
- New agent DB / LLM Copilot / new global-positions RPC / base-chained step PRs / `ui.chrome.*`
  config keys — all rejected as disproportionate or unnecessary; recoverable from git history if
  ever needed, no unique rationale beyond what's already ledgered.

**Scars & gotchas**:
- Import-cycle prerender crash: `BottomTabBar` importing `NAV_GROUPS` from `PlatformHeader` (which
  imports `BottomTabBar`) produced a `ReferenceError` at prerender of `/config-ui/audit` — only
  surfaced when the second mutual consumer was added. Fixed by extracting the shared nav model to a
  standalone `navGroups.tsx`, now documented in `xstockstrat-ui`'s `CLAUDE.md`.
- Content-verified handoff-fidelity claims missed layout overflow: "Screener matches the handoff"
  was verified by content comparison only; the results table was a raw `<table>` (not the shared
  `<Table>` wrapper, which adds `overflow-auto`) and overflowed the phone frame, clipping the Status
  column. A follow-up sweep (`e2e/mobile-overflow.spec.ts`, all screens @390px) then found all three
  `/trader/*` pages **also** overflowed by 101px from a *different* root cause — a fixed-width
  `AccountSelector` plus a newly added Copilot toggle button together exceeding phone width in the
  shared header.
- Playwright sandbox preflight gap: `e2e/global-setup.ts`'s preflight `chromium.launch()` didn't
  honor `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`, even though the chromium *project* config in
  `playwright.config.ts` already did — broke e2e only in a sandbox where the pinned Playwright
  browser build differs from the baked one (no-op in CI).
- Pre-existing flake, not a regression: `nav-reachability.spec.ts` intermittently fails on
  `/trader/accounts` under cold `pnpm dev` (nav click races on-demand route compile) — reproduced on
  the untouched baseline; CI serves a prebuilt bundle so it isn't exposed there.
- Cross-segment component reuse requires an explicit provider wrap. The FR-6 order ticket
  (`SignalOrderTicket.tsx`) re-presents the trader-only `OrderForm.tsx` on an
  `insights/market/[symbol]` route. Because the insights layout provides only React Query (no
  `AccountContext`), the ticket had to explicitly wrap `AccountProvider` to source broker accounts +
  trading environment cross-segment via the `/trader` BFF, and `OrderForm` needed a new optional
  `initialSymbol` prop.
- Metric-derivation-consistency bug (post-launch): the Strategies header/stat-tile "N active" count
  double-counted paused strategies, because it wasn't using the same `active && live_enabled`
  derivation the per-row State badge used. Fixed by aligning header, stat tile, and per-row badges
  on one derivation.
- Screener's extra per-symbol RPC load (deliberate tradeoff): Screener now issues 2 extra
  `ComputeIndicator` calls/symbol (RSI/ATR) per scan for FR-8's raw columns — a best-effort tradeoff,
  with an ATR close-only caveat, accepted for the handoff's raw-column requirement.

**Permanent deviations**:
- design said Copilot ledger routes live in `insightsBff.ts` → shipped in `traderBff.ts` instead
  (`ledgerClient` → `/trader/api`) → because that's where the existing browser `LedgerService`
  client was already wired.
- design said queue-level conviction is the traced-evaluator `passing_leaves/total_leaves` ordinal
  (`EvaluateReadiness`) → shipped `ListOpportunities`' real `ExternalSignal.conviction` value instead,
  with `passing/total` reserved for Signal-detail/Watchlist (0/0 on the queue row) → because an
  external signal carries no strategy binding to evaluate against at the queue level.
  `GetStrategyAnalytics.queue_share` stays reserved at 0.0 for the same structural reason.

**Cross-feature signal**: none beyond what's already ledgered (the F-06 ledger-as-append-store
pattern and the graph-direction/action-tag pattern, both dated 2026-07-31 in `insights.md`).

**Deferred follow-ons**:
- Copilot full functionality — authenticated MCP tool invocation (UI-BFF-as-OAuth-client →
  agent-aud token) + any LLM generation — explicitly deferred to a separate future feature.
- Backend extension to surface the handoff's live price/change%/sparkline/per-condition value
  chips/R:R+sizing on `Opportunity` — `ListOpportunities` doesn't return them today; intentionally
  omitted rather than faked.
- Per-strategy analytics per-row detail table (Strategies screen currently ships aggregate stats +
  per-row `GetStrategyAnalytics` summary only).
- Broader `SectionRenderer` (mobile) adoption beyond Opportunities — the primitive and nav exist
  platform-wide, but per-screen mobile-section adoption is incremental.
- **Open, unresolved capacity risk, never confirmed closed**: design.md's Open Risks listed
  (unchecked) "Ledger query-conn capacity — Copilot read/write shares ledger's single query
  connection (`DB_POOL_MAX=1` + 1 LISTEN/NOTIFY); note load, no pool raise." No session ever revisits
  or resolves this — it is simply never discussed again after the Copilot rail landed. Ledger's
  single query connection now serves both `AppendEvent`/`AppendFill` writes (order-fill ingestion)
  **and** Copilot thread reads/writes. This is a live, unresolved risk that must be treated as an
  explicit watch-item going forward, not assumed closed.
- The deleted `design-handoff/` directory (README, source-map, 12 screenshots,
  `xstockstrat UI.dc.html`) was removed 2026-08-06 per explicit user instruction — the Phase 4b
  extras-gate decision from a prior `/sdd-archiver` attempt on this feature that had not completed
  its verify gate. Recoverable via `git show <pre-deletion-SHA>:docs/roadmap/features/083-ui-revamp-opportunities-first/design-handoff/`.
  SHA-256 of the sole HTML artifact, recorded at deletion:
  `cf8b9806a2e258657a46292aa863100354b2402a5833330ebe7d85dabe25a63d`.

**Ledger entries written**: insights.md (4), fails.md (3) — see the 2026-08-06 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: none — the `NAV_GROUPS`
shared-nav-model import-cycle rule is already documented in `xstockstrat-ui`'s `CLAUDE.md`
("Opportunities-first shell (feature 083)" section), so it's already living in its correct
recoverable home.
**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at
`fe278020abe1e4b0c128a7a2207fd46596d8a9e8`.
**Non-standard artifacts (human-decided at extras gate)**: `design-handoff/` → deleted per human
choice on 2026-08-06 (prior to this archival session; see Deferred follow-ons above for recovery
details).

# Feature Merge Order

Tracks inter-feature merge dependencies. A feature listed in the **Feature** column
cannot open its final integration PR to `main-dev` until the feature in the
**Must wait for** column has been merged and reached `launched` status.

**Maintained by:**
- `/sdd-review` — auto-proposes entries when overlap detection finds a FAIL-level conflict
  (migration number collision, proto field number collision, duplicate config key). Always
  asks for user confirmation before writing.
- Developers — manual entries when architectural ordering is known before conflicts arise.

> **Coverage note:** this file lists only **hard** ordering constraints — a feature that cannot merge
> until another lands (shared migration number, proto field-number collision, duplicate config key, or a
> consumed RPC/schema that must exist first). Most features have none: ordinary textual overlap rebases
> cleanly and is intentionally **not** listed here. A feature's absence from this table means "no hard
> dependency," not "untracked."

---

## Blocking Dependencies

| Feature | Must wait for | Reason | Resolved |
|---|---|---|---|
| `broker-accounts-ui` | `add-ikbr-account-support` | Consumes proto stubs and backend RPCs (`ListBrokerAccounts`, `ListPortfolios`, `RegisterBrokerAccount`, `DeregisterBrokerAccount`) defined by that feature | Yes |
| `strategy-engine` | `agent-mcp-server` | Steps 8–11 modify `client.py`, `tools.py`, `test_client.py`, `test_tools.py` — all four are **created** by `agent-mcp-server` (feature 009); they must exist before strategy-engine modifies them | Yes |
| `live-strategy-alert-engine` | `strategy-engine` | Hard dependency: requires `StrategyDefinition` model, `analysis.strategies` table, and `StrategyEvaluator` module delivered by `strategy-engine` (feature 047) | No |
| `strategy-creation-flow` | `formula-management-ui` | Consumes `ListFormulas` RPC from `xstockstrat-indicators` (feature 003); formula picker in the component editor depends on this RPC existing in generated stubs | Yes |
| `strategy-creation-flow` | `strategy-engine` | Consumes `ManageStrategy`, `GetStrategy`, `ListStrategyDefinitions`, and `SetStrategyLive` RPCs from `xstockstrat-analysis` (feature 047); all strategy authoring and live toggle RPCs must exist before the UI can call them | Yes |
| `strategy-creation-flow` | `live-strategy-alert-engine` | FR-5 live evaluation toggle calls `SetStrategyLive` and reads `live_enabled` column on `analysis.strategies` — both introduced by feature 048 | Yes |
| `auth2-authorized-apps-ui` | `unify-admin-auth-gates` | Extends 049's OAuth backend (`oauth_clients`/`refresh_tokens` schema, `AGENT_PUBLIC_URL`); 049 shipped the OAuth grant flow + `003_oauth` this feature builds on | Yes |
| `resumable-chunked-backfills` | `durable-observable-backfills` | Builds directly on the `ingest.backfill_jobs` table and `max_concurrent_jobs` gate (FR-2/FR-6); the `ingest.backfill_chunks` migration must run-order after feature 052's migration | No |
| `resumable-chunked-backfills` | `backfill-backtest-coverage` | `GAPS_ONLY` fill mode (FR-4) consumes the `GetDataCoverage` RPC introduced by feature 053 | No |
| `backfill-backtest-coverage` | `durable-observable-backfills` | Both add a field to `BackfillJob` in `packages/proto/ingest/v1/ingest.proto`; 052 takes field `11` (`failed_symbols`), so 053 must re-spec against merged 052 and use field `12` for its `timeframe_enum`. Field-number collision if 053 merges first | No |
| `open-positions-ui` | `orders-management-ui` | Both modify `services/xstockstrat-ui/src/lib/traderBff.ts` (055 adds `replaceOrder`/`streamOrderUpdates`; 056 adds `listPositions`/`queryEvents`) in the same router block — soft/rebase dependency (textual conflict, no shared proto/migration/config). 056 rebases after 055 merges | Yes |
| `screener-engine` | `fundamentals-data-source` | Fundamental screener criteria (FR-5) consume the cached `GetFundamentals`/`GetFundamentalsMulti` RPC introduced by feature 059. 058 and 059 are independent and can build in parallel; 060 follows both | No |
| `screener-agent-tool` | `screener-engine` | Pure consumer of the `ScreenSymbols` RPC introduced by feature 060 | No |
| `fundamentals-signal-producer` | `fundamentals-data-source` | Reads fundamentals only via the cached `GetFundamentalsMulti` RPC (feature 059) — the single FMP chokepoint; never calls FMP directly | No |
| `fundamentals-signal-producer` | `fundamentals-scoring-model` | Maps the composite score from feature 063 to `direction`/`conviction`; a trivial built-in default lets 062 ship if 063 slips | No |
| `fundamentals-scoring-model` | `fundamentals-data-source` | The scoring formula reads the fundamental metric fields (`pe_ratio`, `roe`, …) that feature 059 defines | No |
| `fundamentals-data-source` | `watchlist-management` | **Config-migration ordering** (not a code dep): all three of 058/059/062 add a seed migration to the shared `services/xstockstrat-config/migrations/` dir. To avoid a `006` filename collision the numbers are pre-assigned 058→`006_watchlist_config`, 059→`007_marketdata_fmp`, 062→`008_analysis_fundsignal_keys`. golang-migrate applies in numeric order, so 059's `007` must merge **after** 058's `006`. Seeded namespaces are disjoint (`portfolio`/`marketdata`/`analysis`) — no key conflict, only file ordering | No |
| `fundamentals-signal-producer` | `watchlist-management` | **Config-migration ordering**: 062's pre-assigned `008_analysis_fundsignal_keys` must merge after 058's `006` and 059's `007` in the shared config dir (see row above). Transitively covered by the existing 062→059 dep, but recorded explicitly because 058 is otherwise independent of 062 | No |
| `broker-state-reconciliation` | `exactly-once-order-intent` | Reconciliation's periodic tick resolves the `UNKNOWN` order-intent state introduced by feature 101; the intent-record contract must exist first | No |
| `exactly-once-order-intent` | `stop-loss-bracket-orders` | **Migration ordering** (not a code dep): both add a migration to the shared `services/xstockstrat-trading/migrations/` dir. 004 is the last file on disk, and 030's approved `design.md` already claims `005_broker_accounts_halted`. To avoid a filename collision the numbers are pre-assigned 030→`005_broker_accounts_halted`, 101→`006_order_intents`, 102→`007_broker_accounts_halt_source` (102's design.md reuses 030's `halted`/`halted_at`/`halt_reason` columns, adding a `halt_source` discriminator via its own ALTER — a real code dependency on 030, not just filename ordering). golang-migrate applies in numeric order, so 101's `006` must merge after 030's `005`, and 102's `007` must merge after both | No |
| `broker-state-reconciliation` | `stop-loss-bracket-orders` | 102's design.md reuses 030's per-account `trading.broker_accounts.halted`/`halted_at`/`halt_reason` columns for ordinary reconciliation-mismatch halts (same automated-circuit-breaker axis, per 030's own design.md — "must not reinvent... 030's per-account schema") rather than a parallel mechanism; 030's columns must exist first | No |
| `broker-state-reconciliation` | `account-trading-halt-and-kill-switch` | 102's rare systemic-escalation path writes `platform.trading_state` via a new internal-caller authz mechanism (`x-internal-caller`, `services/xstockstrat-config/src/grpc/authz.ts`) that closes 100's own named Open Risk #3; 100's config key and gate must exist first | No |
| `broker-state-reconciliation` | `stop-loss-bracket-orders` | **Proto field pre-assignment — resolved 2026-08-06**: `BrokerAccount` fields 9-12 (`halted`, `halted_at`, `halt_reason`, `halt_source`) on `packages/proto/trading/v1/trading.proto` are claimed by **102**'s `implementation-spec.md` Step 1 (`HaltSource` enum + the four fields, concrete). 030's own `implementation-spec.md` Step 1 only adds `halted`/`halted_at`/`halt_reason` as plain DB columns (`005_broker_accounts_halted`, no proto exposure) — 102's Step 3 (`007_broker_accounts_halt_source`) adds the discriminator column once 030's landed. No collision; 102 executes after 030 per the established build order | Yes |
| `exactly-once-order-intent` | `account-trading-halt-and-kill-switch` | **Same-function overlap** (not disjoint textual rebase): both features' implementation-specs insert new logic into the identical `PlaceOrder`, `ReplaceOrder`, `CancelOrder`, and `resolveAccount` bodies in `services/xstockstrat-trading/internal/service/trading.go` at overlapping/adjacent insertion points (`/sdd-review` impl-spec overlap scan, 2026-08-06). Unlike a simple disjoint-block rebase, reconciling both sets of changes into one function body requires a manual merge, not a mechanical one. 101 executes after 100 per this program's stated build order; 101 rebases against 100's landed `trading.go` | No |
| `position-sizing-engine` | `account-trading-halt-and-kill-switch` | **Migration-NNN collision**: both specs independently claimed `services/xstockstrat-config/migrations/011` (010 was the tip when each ran `/sdd-spec`). 100 specced first and keeps `011_platform_trading_state`; 023 is renumbered to `012_trading_risk_sizing` (`/sdd-review` impl-spec overlap scan, 2026-08-06). **Also a same-function overlap**: 023's Step 8 (full statement-order rewrite of `PlaceOrder`, inserting the sizing gate right after `resolveAccount`) claims the identical `trading.go:262-268` insertion slot as 100's Step 7, and 023's Step 8 also edits `checkPortfolioRisk`'s body/line span, which 100's Step 7 anchors to by line number (`trading.go:1326`) — that anchor will drift once 023 lands. 023 executes after 100 (and after 101, per the row below) and rebases against both | No |
| `position-sizing-engine` | `exactly-once-order-intent` | **Same-function overlap**: 023's Step 6 and 101's Step 11 independently widen `resolveAccount`'s signature to also return the resolved account ID; 023's own call-site update omits the `trading.go:405` `CancelOrder` site that 101's spec already covers. 023's Step 8 (`PlaceOrder` rewrite) and 101's Step 12 (`PlaceOrder` dedup rewrite) both claim the same insertion slot after `resolveAccount`. 023 executes after 101 per this program's revised build order (100 → 101 → 023 → 030 → 102, confirmed 2026-08-06); 023 rebases against 101's landed `trading.go`, including reusing 101's more complete `resolveAccount` call-site coverage rather than reapplying its own | No |
| `stop-loss-bracket-orders` | `account-trading-halt-and-kill-switch`, `exactly-once-order-intent`, `position-sizing-engine` | **Same-function overlap** (not disjoint textual rebase): 030's Steps 9/11/13 insert into the identical `PlaceOrder`/`ReplaceOrder`/`CancelOrder` bodies in `services/xstockstrat-trading/internal/service/trading.go` at insertion points adjacent to/coincident with 100's Step 7, 101's Steps 12-14, and 023's Step 8 (`/sdd-review` impl-spec overlap scan, 2026-08-06). 030 executes last per the established 100 → 101 → 023 → 030 build order and rebases against all three's landed `trading.go`. Migration numbering (030's `005`/`013`), config keys, and the one proto field addition (`Position.stop_order_id=20`/`take_profit_order_id=21`, disjoint message from 101's `Order.intent_state=21`) are all confirmed clean — this row is same-function code overlap only | No |
| `broker-state-reconciliation` | `stop-loss-bracket-orders` | **Migration-NNN collision — found and fixed 2026-08-06**: both `implementation-spec.md`s independently claimed `services/xstockstrat-config/migrations/013` (030's own `013_trading_risk_bracket` was not cross-referenced when 102's Step 6 was specced, since the overlap check that caught the 100/023 `011` collision only looked at `insights.md`, not 030's spec directly). 102 is renumbered to `014_config_caller_identity` — 102 already executes after 030 per the established `100 → 101 → 023 → 030 → 102` build order, so this only required updating 102's spec, not 030's | Yes |
| `screener-data-readiness-polling` (118 — renumbered from a colliding 117; see note below) | PR #902 (`claude/screener-criteria-filtering-7ydsuz`, "fix(screener): never report OK/passed when a criterion has no data to evaluate" + its follow-up "distinguish fundamentals-pending from bars-insufficient in the UI") | **Real dependency, not a features-table entry** — #902 is a Track C bug fix (`docs/reports/2026-08-08-screener-fundamental-criteria-silently-inert.md`), not a numbered SDD feature, so it has no `docs/roadmap/features/` directory of its own to reference by slug. 118's recon.md/design.md/implementation-spec.md all cite `page.tsx:509-522`'s "Fundamentals pending"/"Insufficient data" badge distinction and the `SCREEN_RESULT_STATUS_INSUFFICIENT_DATA`+`gap`-presence contract that #902 introduces — none of that exists on `main-dev` yet. `feature/screener-data-readiness-polling` was branched directly off `claude/screener-criteria-filtering-7ydsuz` (not `main-dev`) for this reason (C-06 deviation, recorded in 118's `context.md` — the alternative, branching from `main-dev` and re-doing the fix inline, would duplicate #902's already-tested work). 118's integration PR (**#903**, opened 2026-08-08) must not merge before #902 does. **Resolved 2026-08-08**: #902 merged to `main-dev` (`bef4258`); `main-dev` merged back into `feature/screener-data-readiness-polling` (`b7332f2`) with a conflict in `page.tsx`/`fails.md` (118's branch already contained #902's pre-squash content, so `main-dev`'s squashed version conflicted textually — resolved by keeping the feature branch's superset content, verified via diff and a full Playwright re-run, 19/20 passing — the one failure is the pre-existing sandbox cold-compile flake, not a regression). #903 is now clear to merge | Yes |
| `screener-data-readiness-polling` (118) | `screener-fundamental-metric-selector` (117, `code-completed`, already on `main-dev`) | **Feature-number collision, resolved 2026-08-08**: both `/sdd-story` runs independently claimed `117` (117-screener-fundamental-metric-selector merged to `main-dev` while this session's 117-screener-data-readiness-polling was mid-pipeline on a separate branch, never itself pushed to `main-dev`). Per the Feature Numbering collision rule (root `CLAUDE.md`), the not-yet-executed one renumbers — `screener-data-readiness-polling` moved `117` → `118` via `git mv` + self-reference updates (feature.md/context.md/implementation-spec.md path strings), recorded in its own `context.md`. **Also a real file-overlap** (not just a number clash): both features touch `services/xstockstrat-ui/src/app/insights/screener/page.tsx`; 117 converted the Fundamental-kind metric-name field from free-text to a `Select` dropdown (disjoint region — the criterion-row rendering block), shifting every line number below it. 118's implementation-spec.md Steps 2/3 were re-aligned (conditional re-spec, evidence-only) against the post-merge file before executing — no step body's *logic* needed to change, only its cited line numbers | Yes |
| `shadcn-migration-medium-confidence` (121) | `shadcn-migration-high-confidence` (120) | **File-level overlap on `services/xstockstrat-ui/src/components/shared/PlatformHeader.tsx`, soft/rebase (not blocking)**: 120's FR-7 (Breadcrumb, `:260-269`) and FR-8 (Accordion, `:209-253`, mobile nav) vs. 121's FR-13 Navigation Menu migration (desktop Primary nav `:170-190`, desktop Section nav `:271-287`, added 2026-08-08 per a user-directed override of 121's original "keep as-is" design recommendation — see 121's `design.md` § Round 3). Line ranges are disjoint today; rebase risk only, no field/config/migration collision. 121 also has a **hard content dependency** on 120: FR-4 through FR-9 (five FRs) consume `ui/alert-dialog.tsx`/`ui/tabs.tsx`/`ui/toggle-group.tsx`/`ui/alert.tsx`/`ui/checkbox.tsx`/`ui/accordion.tsx`, all added by 120 and none present on `main-dev` yet — 121's `implementation-spec.md` deliberately specs only its non-dependent tranche (FR-1/2/3/10/11/12/13) and leaves FR-4–9 unspecced (F-04) pending 120's merge | No |
| `shadcn-migration-medium-confidence` (121) | `shadcn-migration-low-confidence` (122) | **Same-function overlap on `services/xstockstrat-ui/src/components/trader/accountShared.tsx`'s `EditCredentialsForm`**: 121's FR-3 wraps it in a `Collapsible` ("Edit keys" expand/collapse); 122's FR-3 (expanded by a 2026-08-08 user-directed override from "decline" to "migrate") rewrites its internal state/submit wiring onto `react-hook-form`+`zod`+`ui/field.tsx`. Both touch the same function body — not a disjoint textual rebase. Recommend 122 (internal rewrite) lands first and 121 (outer wrapper) rebases onto the migrated form, since wrapping an already-`react-hook-form`-based component in a layout primitive is lower-risk than the reverse order | No |
| `shadcn-migration-low-confidence` (122) | `shadcn-migration-high-confidence` (120) | **Hard content dependency (2026-08-09 user-directed override)**: 122's FR-1 (`OrderForm.tsx:215-217`, `EditOrderDialog.tsx:82`) was overridden from "decline" to "migrate both to Alert" — but consumes `ui/alert.tsx`, which 120 adds and which does not exist on `main-dev` yet. Mirroring the existing 120↔121 row's pattern: 122's `implementation-spec.md` deliberately leaves FR-1's concrete steps unspecced (F-04 — never invent a file path) pending 120's merge; a follow-up `/sdd-spec` run generates them once `ui/alert.tsx` ships. Total step count (8) is unaffected — this is a documentation/tranche-split addition, not new code steps | No |
| `096-position-and-order-detail-pages` | `124-shadcn-table-actions-responsive` | **File-level overlap, soft/rebase (not a field/config/migration collision)**: both features' `implementation-spec.md`s edit `trader/positions/[symbol]/page.tsx`, `trader/orders/[id]/page.tsx`, `trader/positions/page.tsx`, and `trader/portfolio/page.tsx` (`/sdd-review` impl-spec overlap scan, 2026-08-09). 124 is fully reviewed (impl-spec warnings fixed) and executes first per user direction; 096's own spec is additionally stale (Step 3 says "create" `positions/[symbol]/page.tsx`, which already exists on trunk at 515 lines) and needs a re-spec pass regardless of this ordering. 096 rebases against 124's landed markup on these 4 files before its own execution | No |
| `signal-time-decay` (022) | `signal-source-reliability-weight` (130) | **Same-expression overlap** (not a field/config/migration collision): both features multiply an additional factor into the identical `c["signal_axis"] = max(c["signal_axis"], sig.conviction)` expression in `_compute_opportunities` (`services/xstockstrat-analysis/app/handlers/servicer.py:2163`) — 130 adds a `× source_weight` term, 022 adds a `× exp(-λ × age_hours)` term (022's own `product-spec.md` FR-1 names this coordination explicitly). 130 reached `spec-ready` first (2026-08-13); 022 executes second and rebases the expression onto 130's landed change to carry both terms | No |

**Screener initiative build order**: `058 watchlist-management` ∥ `059 fundamentals-data-source`
(independent to *build*, but their `xstockstrat-config` seed migrations **merge** in number order
058 `006` → 059 `007` → 062 `008` — see the config-migration-ordering rows above) →
`060 screener-engine` (+ optional `061 screener-agent-tool`); and
`059` → `063 fundamentals-scoring-model` → `062 fundamentals-signal-producer`. Feature 059 is the
single FMP free-tier (250 req/day) chokepoint — both 060 and 062 read fundamentals only through its
cache, and 062 reserves call-budget headroom (200/250) for 060's interactive scans.

> **Note on `analysis.proto` (060 + 062) and shared UI/service files:** 060 (`ScreenSymbols`) and 062
> (`RunFundamentalsScan`) both append an RPC to the `AnalysisService` block and a method to
> `xstockstrat-analysis` `servicer.py`; 058 + 060 both edit `xstockstrat-ui` `insightsBff.ts` (distinct
> router blocks). These are **rebase-only textual** overlaps — no field-number, message-name, or config-key
> collision — so per the Coverage note above they are intentionally **not** listed as hard ordering rows;
> whichever lands second simply rebases.

> **Note on the `run_backtest` / `manage_strategy` agent surface (070 + 071 + 072) — RESOLVED
> 2026-07-27.** Kept as history because it records why no hard ordering row was ever needed; nothing
> here is still an open sequencing constraint.
>
> - **070 and 071 merged together** (PRs #791 and #792) from the shared harness branch
>   `claude/features-070-071-rnbkqo`. `origin/main-dev` now carries both, so **072 is the only
>   in-flight party** on this surface.
> - **Blocks were disjoint.** 070 → `manage_strategy` plus a new `get_strategy` tool; 071 →
>   `run_backtest` **inputs** (`start`/`end`); 072 → `run_backtest` **output** (summary inline +
>   attachment). Only 071 and 072 shared a function, and one edited its signature while the other
>   edits its return.
> - **The "contradictory test" never materialized.** This note previously said *072 must invert*
>   `test_run_backtest_projects_full_result_with_diagnostics`. It must **not** — 072's approved design
>   keeps `client.run_backtest` returning the full dict and splits in `tools.py`, so that test is a
>   *client*-level assertion that stays as-is (`072/implementation-spec.md`). 072's real test collision
>   is a different one: `test_run_backtest_calls_grpc` asserts on the **tool's** return and does go red,
>   which is why 072's steps 3 and 4 must land together.
> - **Doc sub-blocks** in `docs/runbooks/mcp-tools.md` §`run_backtest`: 071's Parameters rows are
>   landed; 072 owns the Return block, which was already stale on trunk (it predates feature 064).
>   Disjoint, and now sequential rather than concurrent.
> - **Tool count is settled at "fourteen"** across all six surfaces (`mcp-tools.md:3`, `:29`,
>   `app/tools.py:4`, agent `CLAUDE.md`, `docs/runbooks/CLAUDE.md:17`, and the name-set assertion in
>   `tests/test_tools_endpoint.py`). 072 adds no tool and must leave the count alone.
> - **The forward-looking escalation did NOT fire — discharged.** It was conditional on 072 resolving
>   OQ-1 with a `ResourceLink` *and* persisting `INSUFFICIENT_DATA` runs, which would have forced an
>   `xstockstrat-analysis` edit inside 071's `RunBacktest` span. 072's design chose `EmbeddedResource`
>   and touches no analysis code, so **072 stays rebase-only** and needs no hard ordering row.

> **Note on the MCP-alignment triage features (085 + 092 + 094) — rebase-only, no hard ordering row.**
> Feature `094 fix-mcp-server-input-validation` shares source files with two other in-flight features,
> but none is a field-number / migration / config-key collision, so per the Coverage note above these
> are **not** hard ordering rows — whichever lands second simply rebases:
>
> - **092 `fix-mcp-writepath-authz` ↔ 094 on `xstockstrat-notify`.** Both flip notify's test harness
>   from `--experimental-strip-types` to the compile-first script (`tsc && node --test dist/__tests__/*.test.js`)
>   in `package.json` and rewrite `src/__tests__/notifyServiceImpl.test.ts` to static imports — an
>   **identical-intent** change. Reconciliation is a union of the two added cases (092: an `EmitAlert`
>   descriptor-parity test; 094: the empty/whitespace title-body validation cases). If 092 also gates
>   `emitAlert` authz, its guard and 094's input guard sit adjacently at the top of the same method
>   (`notifyServiceImpl.ts` `emitAlert`) — semantically disjoint (authz vs input validation), a textual
>   rebase, not a real conflict.
> - **092 ↔ 094 on `xstockstrat-ingest` `servicer.py`.** 092 adds a `TriggerBackfill` authz gate; 094
>   adds an `IngestSignal` conviction guard — **different handlers**, no overlap.
> - **085 `mcp-python-sdk-v2-upgrade` ↔ 094 on `app/tools.py`.** 085 rewrites imports/decorators/
>   signatures wholesale; 094 edits only the `ingest_signal` and `emit_alert` **docstring bodies**.
>   Disjoint lines; 085 (code-completed) lands first and 094 rebases its two docstring edits onto it.

---

**Live-Capital Safety program (added 2026-08-04 from an external risk review, cut down 2026-08-04
after a feasibility re-check against this repo's actual code/infra):** the review was written as if
unattended automated strategy-to-order execution already existed on this platform. It does not —
`048-live-strategy-alert-engine` is alert-only, and the trader UI is the sole caller of
`TradingService.PlaceOrder` — so most of the review's premise (kill switches for schedulers, canary
rollout of automated strategies, crash/property-based test suites, a broker fault simulator, a
dashboard, quarterly game days) was pre-building controls for a capability that isn't built and isn't
roadmapped. Five items survived the re-check (a sixth, `102`, was briefly demoted and then revived once rescoped
down — see its own `context.md`):
- `023-position-sizing-engine` and `030-stop-loss-bracket-orders` (both pre-existing drafts, promoted
  to `P0` priority rather than duplicated — `030` keeps its pre-existing hard dependency on `023`,
  already listed elsewhere in this file if/when either is specced).
- `100-account-trading-halt-and-kill-switch`, rescoped from a new state machine to hardening the
  `platform.maintenance_mode` key already enforced in `trading.go:244`.
- `101-exactly-once-order-intent`, rescoped to the trader UI's real place/replace/cancel flow.
- `102-broker-state-reconciliation`, rescoped from a continuous engine + dashboard to a lightweight
  periodic ticker inside `xstockstrat-trading` itself (depends on `101`, row above) — proof that the
  right response to "this protects a capability that doesn't exist yet" is often to shrink a feature,
  not always to demote it outright.

The other seven drafted features (`103` broker simulator, `104` property tests, `105`
crash-consistency, `106` market-data gate — folded into `023`, `107` canary rollout, `108` dashboard,
`109` game day) are `demoted/canceled` — see each feature's own `context.md` for why, and revisit them
if/when an automated strategy-to-order execution capability is actually proposed and approved.
`/sdd-status` (no slug) lists every feature regardless of lifecycle status, including
`demoted/canceled` ones, so this backlog stays discoverable without a separate tracking doc — the
trigger to revisit each one is recorded in its own `context.md`.

## How to add an entry manually

1. Add a row to the table above.
2. Set **Resolved** to `No` while the blocking feature is still in-flight.
3. Update **Resolved** to `Yes` once the blocking feature is `launched` (merged to `main-dev`
   and deployed). You may then also remove the row — it serves no further purpose.

## How `/sdd-execute` uses this file

Before creating the **final integration PR** (feature branch → `main-dev`), `/sdd-execute`
reads this file. If the current feature appears in the Feature column and the blocking feature
has not yet reached `launched` status, it warns the user and asks for confirmation before
proceeding with the PR.

Per-step PRs (step branch → feature branch) are not affected by this file.

## MCP-alignment cohort (086–094, 2026-08-02)

Features 086–094 (the `fix-mcp-*` triage cohort) all touch the shared agent surfaces
`services/xstockstrat-agent/app/{client.py,tools.py}`, `docs/runbooks/mcp-tools.md`, the tool
catalog count, and the `plugins/strat-lab` skill. They are independent in behavior but **will
conflict textually on those shared files** — merge them one at a time and reconcile the tool
catalog list + count on each merge. Proto: each adds a distinct enum/message (086 formula
`update_mask`/`deleted`, 088 `SignalSourceOperation`, 089 `StrategyOperation.REACTIVATE`) — no
proto-field collisions, but re-run `./scripts/buf-gen.sh` after each merge.

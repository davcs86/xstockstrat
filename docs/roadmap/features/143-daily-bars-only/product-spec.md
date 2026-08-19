# Product Spec: daily-bars-only

**Created**: 2026-08-16

---

## Problem Statement

The platform stores and serves OHLCV bars at three granularities (`15m`/`1h`/`1d`), but no
trading-path consumer ever evaluates anything but `1d`: the live loop (`live_loop.py`) and
the screener's technical criteria (`screener.py`) both hardcode `timeframe="1d"`, and the
default strategy is a daily SMA 20/50 crossover. The only consumers of `15m`/`1h` are two
on-demand UI chart timeframe selectors (`/trader` position chart, `/insights/backfills`
manual-backfill trigger) — neither drives a trading decision. Maintaining `15m`/`1h` support
costs real complexity (a second continuously-ingested timeframe, per-timeframe canonical
string handling that has already produced multiple defects — see `Known trap` below — and a
UI surface with no trading-path payoff) for a capability nothing actually needs.

## User Story

As a platform maintainer, I want OHLCV bar fetching/ingestion/serving restricted to `1d`
only, so that the marketdata service has one less continuously-ingested timeframe to keep
correct and fresh, and the UI no longer offers chart granularities the platform can't act on.

## Functional Requirements

FR-1. `GetBars` rejects (or otherwise does not serve) a request for any timeframe other than
`1d` — exact response contract (reject with an error vs. silently return empty) is a design
decision, not assumed here.

FR-2. `BackfillBars` rejects a request for any timeframe other than `1d`.

FR-3. The always-on bar ingester (`StartBarIngestPoller`/`ingestRecentBars`,
`marketdata.stream.bar_ingest_timeframe`) only ever fetches `1d` — the `15m,1d` list default
this feature's precursor bug fix (PR #971, `null-fundamentals-ohlcv-gaps`) introduced is
narrowed back down to a single `1d` value (as a list of one, or the config key reverts to a
single-value string — a design decision).

FR-4. The `/trader` chart panel (`ChartPanel.tsx`, `lib/chart.ts`) no longer offers `15Min`/
`1Hour` as chart timeframe options — `1Day` (or equivalent) is the only choice, or the
selector itself is removed if a single option makes it redundant.

FR-5. The `/insights/backfills` manual-backfill trigger page no longer offers `15 min`/
`1 hour` as backfill timeframe options.

FR-6. `Timeframe.TIMEFRAME_15MIN`/`TIMEFRAME_1HOUR` proto enum values are **deprecated, not
removed** (root `CLAUDE.md` § Proto Contract Governance: enums are append/deprecate-only) —
mirroring how `TIMEFRAME_1MIN`/`TIMEFRAME_5MIN` were already handled when they stopped being
requestable (root `CLAUDE.md` marketdata service registry note, `services/xstockstrat-marketdata/CLAUDE.md`
"Timeframe vocabulary").

## Out of Scope

- Deleting already-stored `15m`/`1h` rows from `marketdata.ohlcv` — left as an **Open
  Question** below rather than assumed; if the design settles on "reject at the RPC layer",
  those rows become permanently unreadable via `GetBars` regardless of whether they're
  physically deleted, so deletion is a separate cleanup decision, not required for FR-1/FR-2
  to hold.
- The Alpaca WebSocket 1-minute bar stream (`StartBarStream`/`internal/alpaca/stream.go`) —
  it forwards live, never-persisted `1m` bars to live chart subscribers, and is not part of
  what gets "fetched" into `marketdata.ohlcv` at any other granularity. Whether it still makes
  sense once `15m`/`1h` are gone is a design question, not assumed removed by this spec.
- Any change to the default SMA strategy or backtest engine — they already only consume `1d`.

## Affected Services

**Corrected by `/sdd-design` Phase 0 recon (2026-08-16)** — the original list below omitted
two services that each maintain their own parallel timeframe alias/enum table feeding into
`BackfillBars`; see `recon.md` § Risks and `context.md` for the finding. Left uncorrected,
`15m`/`1h` requests could still reach a newly-rejecting `BackfillBars` through these paths, or
(worse) the `trigger_backfill` MCP tool could remain an undetected back door to a timeframe
the rest of the platform no longer supports.

- `xstockstrat-marketdata` — `GetBars`/`BackfillBars` RPC handlers, `StartBarIngestPoller`/
  `ingestRecentBars`, `internal/timeframe` canonicalization, config keys, migrations (if the
  Open Question below resolves toward deleting historical non-1d rows)
- `xstockstrat-ui` — `/trader` `ChartPanel.tsx`/`lib/chart.ts`/`positions/[symbol]/page.tsx`
  (recon found this second consumer of `lib/chart.ts` not named in the original draft),
  `/insights/backfills`
- `packages/proto` — `Timeframe` enum deprecation comments only (no field/value removal)
- `xstockstrat-ingest` **(added by recon)** — `app/handlers/servicer.py`'s `_STR_TO_ENUM`/
  `_TF_ALIASES`, `app/repositories/backfill_chunks.py`'s `_BARS_PER_DAY`, all of which
  validate/alias a timeframe string before proxying to marketdata's `BackfillBars`
- `xstockstrat-agent` **(added by recon)** — `app/tools.py`'s `trigger_backfill` MCP tool
  (`timeframe` param, default `"1d"`, docstring currently advertises `15m`/`1h` as valid) and
  `app/client.py`'s own `_TF_ALIASES`/`_TF_TO_ENUM`

## Consumer Surface(s)

**Corrected by `/sdd-design` Phase 0 recon (2026-08-16)** — the original Agent box below was
checked "no MCP tool exposes a timeframe parameter"; recon found this false.

- [x] **UI** — `xstockstrat-ui` segments: `/trader` (chart panel timeframe selector **and**
  the position-detail page's own selector lose `15Min`/`1Hour`), `/insights`
  (`/insights/backfills` timeframe dropdown loses `15 min`/`1 hour`)
- [x] **Agent** — `xstockstrat-agent` MCP tool `trigger_backfill`: its `timeframe` param
  (`app/tools.py:860`) and docstring (`:868`, currently `"one of
  15m/15Min/1h/1Hour/1d/1Day"`) narrow to `1d`-only
- [ ] **None**

## Proto Contract Changes

- [ ] No proto changes required
- [x] Deprecate `Timeframe.TIMEFRAME_15MIN` / `TIMEFRAME_1HOUR` with a comment (no removal,
  no field-number reuse) — mirrors the existing `TIMEFRAME_1MIN`/`TIMEFRAME_5MIN` precedent

## Config Key Changes

- [x] Existing key changes (not new keys): `marketdata.stream.bar_ingest_timeframe`'s
  effective value narrows from the `null-fundamentals-ohlcv-gaps` fix's `15m,1d` back to
  `1d` only — exact mechanism (keep list-shaped, single-element; or revert to a plain string)
  is a design decision.

## Database Changes

- [ ] No schema changes
- [ ] OR: describe new tables / columns / migrations
  → **Open Question** — see below; depends on whether historical `15m`/`1h` rows are deleted.

## Feature Workflow Notes

Branch to create: `feature/daily-bars-only` (branch from `main-dev`)

**Deviation note (recorded for `/sdd-design`):** per an explicit session/task instruction,
this feature's actual implementation continues directly on the already-open
`claude/null-fundamentals-ohlcv-gaps-l2v4x5` branch / PR #971 (a harness-assigned branch this
session may not diverge from without explicit permission) rather than a fresh
`feature/daily-bars-only` branch — recorded in `context.md`.

Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking proto or config change) — `xstockstrat-marketdata`
  + `xstockstrat-ui` owners, since the proto change is a pure deprecation (non-breaking)
- [ ] 2 service owners + platform lead (breaking proto change) — not applicable, no breaking
  proto change
- [ ] DBA review + service owner (schema migration) — only if the historical-data Open
  Question resolves toward a migration

## Acceptance Criteria

1. `GetBars`/`BackfillBars` requests for `15m`/`1h` no longer succeed with live data (exact
   failure mode per design.md).
2. The always-on bar ingester never fetches `15m` bars.
3. `/trader`'s chart panel and `/insights/backfills` no longer render `15m`/`1h` options.
4. `buf lint`/`buf breaking` pass — the `Timeframe` enum keeps its existing values, only gains
   deprecation comments.
5. Existing `1d`-only trading paths (live loop, screener, default strategy) are unaffected.
6. Full test suites (Go `xstockstrat-marketdata`, Python `xstockstrat-analysis`, UI
   Playwright/Vitest for the touched pages) pass.

## Open Questions

- [ ] **Historical `15m`/`1h` data disposition.** Leave existing rows in `marketdata.ohlcv`
  as inert (never delete), or add a migration/one-time job to remove them? Leaving them costs
  nothing functionally once `GetBars` rejects non-`1d` requests, but is untidy; deleting
  needs a DBA-reviewed migration per governance.
- [ ] **`GetBars`/`BackfillBars` rejection contract.** Does a non-`1d` request return an
  explicit `INVALID_ARGUMENT`-style error, or silently resolve/degrade to `1d`? An error is
  more honest but is itself a small breaking behavior change for any caller still requesting
  `15m`/`1h` (i.e. the UI, until FR-4/FR-5 ship in the same feature — sequencing matters).
- [ ] **Alpaca WS 1-minute stream disposition** (see Out of Scope) — keep as-is, or is there a
  reason to also simplify/remove it now that no REST timeframe below `1d` is fetched?
- [ ] **`internal/timeframe` canonicalization surface** — does `Resolve`/`Interval` need to
  reject `15m`/`1h` explicitly, or is "no continuous consumer + RPC-layer rejection" enough,
  leaving the canonicalization helpers themselves untouched (still resolvable, just unused in
  practice)? **Known trap** (see below): this exact package has a documented history of
  subtle defects when its contract shifts — treat any change here as high-risk.

**Known trap** (`docs/roadmap/ledger/fails.md`, `2026-07-29`/`2026-07-30`/`2026-08-06` —
`080-fix-backfill-timeframe-enum`): this codebase's canonical-timeframe-string vs.
`Timeframe` enum handling has produced multiple real defects before (raw vs. canonicalized
persistence order, an incorrect literal-occurrence-count assumption in a prior spec, a
migration needing careful remediation-log design). Also (`docs/roadmap/ledger/insights.md`,
`2026-08-06`): a design note for that same feature explicitly flags **"split into two
features"** as a demonstrated failure mode for this timeframe-touching area — this feature
must stay one cohesive unit (marketdata + UI + proto deprecation together), not be split
across multiple `/sdd-story` runs.

# Design: daily-bars-only

**Created**: 2026-08-16
**Rounds**: 2 (quick mode's mandated 1 round, plus one additional round at user request; termination: approved)
**Approved by**: user @ 2026-08-16
**Grounded in**: recon.md

---

## Chosen Approach

A single cohesive change spanning proto → `xstockstrat-marketdata` → `xstockstrat-ingest` →
`xstockstrat-agent` → `xstockstrat-ui`, shipped as one feature (per the ledger's "don't split
into two features" lesson — `docs/roadmap/ledger/insights.md`, 2026-08-06). Rejection of
non-`1d` timeframes is layered and explicit at every hop, executed in an order that closes
the *authoritative* RPC surface first rather than last.

**1. Proto (`packages/proto/common/v1/common.proto:77-84`)** — `TIMEFRAME_15MIN`/
`TIMEFRAME_1HOUR` gain `[deprecated = true]` markers, mirroring the exact existing
`TIMEFRAME_1MIN`/`TIMEFRAME_5MIN` syntax at `common.proto:82-83` verbatim
(`<value> = <N> [deprecated = true]; // deprecated: <reason>`). No field/value removal, no
renumbering — non-breaking (`docs/runbooks/proto-versioning.md:14`, "adding a new enum
value"/deprecation-only is non-breaking).

**2. `xstockstrat-marketdata` (ships first, right after proto)** —
`GetBars` (`internal/service/marketdata_service.go:121`) and `BackfillBars` (`:661`) reject a
resolved-non-`"1d"` `canonicalTf` with `connect.NewError(connect.CodeInvalidArgument, ...)`,
reusing the exact idiom already used by `resolveDeletePlan`
(`marketdata_service.go:301-333`). The check sits after `canonicalTf` is resolved
(`:133-135` for `GetBars`, `:689` for `BackfillBars`) and before any DB/emit/live-fetch call
(`QueryBars`/`fetchAndCacheBars` at `:166,177`; `emitEvent`/the per-symbol `GetBars` loop at
`:693,706-707`) — and, for `GetBars` specifically, before `markWarm` (`:122-123`) purely for
side-effect hygiene (confirmed non-load-bearing: `markWarm(symbol string)` takes no
timeframe argument, so a rejected request marking a symbol warm would be harmless, but
rejecting first is still cleaner). `GetDataCoverage` (`:246`) and `DeleteBackfilledData`/
`resolveDeletePlan` (`:301-333`) stay **deliberately permissive** — see Rejected
Alternatives. `defaultBarIngestTimeframe` (`:520`) narrows from `"15m,1d"` to `"1d"`;
`resolveIngestTimeframes`'s comma-split parser (`:530`) needs no logic change — it already
handles a one-element list. `internal/timeframe` (`internal/timeframe/timeframe.go`) is
**untouched** — `Resolve`/`Interval`/`FromString` keep resolving `15m`/`1h`, required by
`GetDataCoverage` and `resolveDeletePlan` staying permissive on the same historical rows.
No migration ships; historical `15m`/`1h` rows in `marketdata.ohlcv` are left inert. A same-PR
doc note in `services/xstockstrat-marketdata/CLAUDE.md`'s DB section explains why (rows are
read-only-forever going forward; `GetDataCoverage` remains the sanctioned way to inspect them
ahead of any future deletion decision).

**3. `xstockstrat-ingest` (ships with, or immediately after, marketdata)** — the chunk-retry
loop (`app/handlers/servicer.py:555`, currently `except Exception as e:  # transient RPC
error — retry the whole chunk`) gets a non-retryable-gRPC-code special case so a permanent
`INVALID_ARGUMENT` from marketdata's new rejection fails the chunk immediately instead of
retrying 3× with backoff — this fix is sequenced no later than marketdata's own step so the
retry-storm window (round 1's identified risk) never opens in production. Separately (same
step or the next), the alias/lookup tables narrow to drop only the entries whose canonical
target is a removed timeframe, **keeping every entry whose target is `1d`** — critically,
`_TF_ALIASES` (`servicer.py:95-102`) keeps **both** `"1d"→"1d"` and `"1Day"→"1d"` (not a
literal single-entry table, which round 2's adversary pass proved would silently drop the
`"1Day"` spelling and break `tests/test_ingest_servicer.py:95-99`). `_STR_TO_ENUM`
(`servicer.py:93`) is dual-purposed — it also re-derives `timeframe_enum` for **historical/
resumed** `15m`/`1h` jobs on the read path (`job_row_to_proto`, `_run_chunks`) — so it keeps
its `"15m"`/`"1h"` entries (existing rows must still display correctly; only *new* requests
for those timeframes are rejected, at the ingest handler's own validation point before the
`BackfillBars` proxy call at `:542-543`) while `_BARS_PER_DAY`
(`app/repositories/backfill_chunks.py:16`) drops its `"15m"`/`"1h"` keys since chunk-planning
for a now-unrequestable timeframe has no reason to exist. Four existing tests are explicitly
named as needing updates in this step: `test_legacy_alias_row_resolves_but_string_is_untouched`
and `test_supported_timeframes_pair_string_and_enum`
(`tests/test_ingest_servicer.py:88-99`), `test_no_chunk_exceeds_bar_cap` and
`test_density_yields_more_chunks_for_15m_than_1d` (`tests/test_backfill_chunks.py:36-54`).

**4. `xstockstrat-agent`** — `trigger_backfill`'s docstring (`app/tools.py:868`, currently
`"one of 15m/15Min/1h/1Hour/1d/1Day"`) narrows to `1d`/`1Day` only, default stays `"1d"`
(`:860`); `_TF_ALIASES`/`_TF_TO_ENUM` (`app/client.py:993-994,1024`) narrow the same way —
keeping both `"1d"` and `"1Day"` — rejecting at the outermost hop via the already-existing
clean pre-RPC guard (`client.py:1023-1024`, confirmed present, no new validation
infrastructure needed). The hardcoded error string at `client.py:1024`
(`f"unknown timeframe '{timeframe}' (expected 15m/15Min/1h/1Hour/1d/1Day)"`) is updated in
the same step — it doesn't shrink "for free" just because the dict does. **Mandatory
same-PR scope** (root `CLAUDE.md`'s explicit, binding rule for changes to `trigger_backfill`):
`docs/runbooks/mcp-tools.md` and `plugins/strat-lab/skills/backtest/reference/backfill.md`,
both of which currently document `15m`/`1h` as accepted values.

**5. `xstockstrat-ui`** — `lib/chart.ts`'s `Timeframe` type (`:11`), `TIMEFRAMES` array
(`:13-17`), and `TIMEFRAME_ENUM` map (`:23-27`) narrow to the single `1Day` member. The
timeframe selector control is **removed entirely** (not disabled/left as a single-option
control) from both `ChartPanel.tsx` (whose `Tabs` render array-driven off `TIMEFRAMES`, so
removal costs nothing extra) and the second, recon-discovered consumer
`positions/[symbol]/page.tsx` — both share `lib/chart.ts`, so one type/const change reaches
both call sites, but `/sdd-spec` names both files explicitly in the step's **Files**.
`ChartPanel.tsx`'s `POLL_INTERVALS_MS` (`:23-26`, a `Partial<Record<Timeframe, number>>`
keyed by the now-removed `'15Min'`/`'1Hour'`) is **deleted outright**, along with its
auto-refresh effect (`:77-82`), rather than left as dead single-key code. `/insights/
backfills/page.tsx`'s `TIMEFRAMES` const (`:30-34`) narrows to one entry; whether the
`<select>` itself is removed or kept as a single, non-interactive value is left to
`/sdd-spec`'s judgment (lower-stakes than the chart selector — no e2e assertion currently
depends on it). `e2e/trader/chart-panel.spec.ts`'s two tests whose premise breaks under this
change (`renders the 3 supported timeframe buttons`, `:129-142`; `sends timeframeEnum on the
outbound GetBars request (AC-8)`, `:165-213`, which clicks the now-removed `'1h'` tab) are
rewritten, not just updated — the design leaves the exact replacement assertion (e.g.
"the `1d` tab is the sole, always-active state, and `timeframeEnum` is still sent correctly
with no tab interaction needed") to `/sdd-spec`.

**Consumer surface reached (C-14):** `/trader` (`ChartPanel.tsx` + `positions/[symbol]/page.tsx`),
`/insights` (`/insights/backfills`), and the `xstockstrat-agent` MCP tool `trigger_backfill` —
all three named explicitly in the corrected `product-spec.md` and carried through here; this
is not a backend-only change left to go stale at the consumer surface.

## Rejected Alternatives

- **Making `TIMEFRAME_15MIN`/`TIMEFRAME_1HOUR` themselves reject in `internal/timeframe.Resolve`/
  `Interval`** — rejected: nothing outside `marketdata_service.go` depends on that package
  resolving those values, and this exact package carries a documented defect history when
  its contract shifts (`docs/roadmap/ledger/fails.md`, `080-fix-backfill-timeframe-enum`).
  RPC-handler-layer rejection is a strict superset of what FR-1/FR-2 require, at zero risk to
  the trap-prone package — and is *required* for `GetDataCoverage`/`resolveDeletePlan` to
  keep working on the historical rows they're allowed to still touch.
- **A DB migration deleting historical `15m`/`1h` rows** — rejected: the only precedent
  (`003_canonicalize_ohlcv_timeframe`) requires quiescing `StartBarIngestPoller` and DBA
  review because `timeframe` is a PK column with 60s-cadence concurrent writes; the product
  spec already frames deletion as separate, optional cleanup with zero functional payoff
  once `GetBars`/`BackfillBars` reject the rows anyway.
- **Rejecting `GetDataCoverage` too** (round 1's initial position) — rejected in round 2:
  FR-1/FR-2 name only `GetBars`/`BackfillBars`; `GetDataCoverage` is read-only (no outbound
  gRPC, no Alpaca budget spend — `marketdata_service.go:240-241`'s own doc comment) and is
  the sanctioned tool an operator needs to inspect the inert historical rows ahead of any
  future deletion decision. Left permissive, with an inline code comment stating this is
  deliberate so a future engineer doesn't "fix" the asymmetry with `GetBars`/`BackfillBars`
  as a bug.
- **Step order: UI/agent/ingest ship first, marketdata (the authoritative RPC layer) rejects
  last** (round 2's initial position) — rejected in synthesis: this leaves `GetBars`/
  `BackfillBars` open the longest (spanning 4 step-PRs) to any caller not covered by this
  feature's 3 narrowed surfaces — a script, `grpcurl`, an internal tool — and doesn't even
  address the always-on ingester continuing to write fresh `15m` rows during that window. The
  round-1 order's residual risk (a bounded, self-limiting retry-storm in ingest during a
  single-step gap) is smaller and has a direct fix (pull the retry-loop bug fix forward to
  land no later than marketdata's step) rather than accepting an untested-in-staging RPC
  guard as the trade.
- **Shrinking ingest/agent's alias tables to a literal single entry** (`{"1d": "1d"}`,
  round 2's initial "self-evident drift" proposal) — rejected: verified against the actual
  code to be wrong. `_TF_ALIASES` has two legitimate spellings for the surviving `"1d"`
  (`"1d"`, `"1Day"`); `_STR_TO_ENUM` also serves the historical/resumed-job **read path**, not
  just new-request validation. A literal single-entry table would silently break the
  `"1Day"` alias and make every historical `15m`/`1h` job's `timeframe_enum` display as
  `UNSPECIFIED`. Replaced with an explicit per-table survivor list (see Chosen Approach §3)
  and four named tests to update.
- **Building a shared cross-service/cross-language validation library** to eliminate the
  ingest/agent/marketdata triple-validation pattern entirely — rejected as its own
  oversized, out-of-scope refactor; the accepted trade-off is that ingest and agent each
  keep a small, independently-maintained alias table, mitigated by keeping each table's
  scope minimal (only the surviving canonical value's spellings) so future drift is easier
  to spot on review, not eliminated structurally.

## Open Risks

- [ ] **Rolling-deploy window for in-flight jobs**: a backfill job created (with `15m`/`1h`)
  before the ingest step ships, but whose chunks are still `PENDING`/mid-retry when the
  ingest and marketdata steps land, is an inherent rolling-deploy risk not further solved
  beyond the retry-loop fix already scoped — to be accepted as-is, not blocking.
- [ ] **`/insights/backfills`' single-entry `<select>` fate** left to `/sdd-spec`'s judgment
  (remove vs. keep as a non-interactive single value) — to be resolved at `/sdd-spec` time.
- [ ] **Historical `15m`/`1h` row disposition** remains genuinely open (left inert per this
  design, but the product spec's Open Question about eventual deletion is not closed, only
  deferred) — to be addressed as a possible future feature if ever needed, not this one.

## Constitution Rules Touched

- `C-01` (zero-assumption/evidence-cited) — honored by: every design claim above cites
  `recon.md`/live-code `path:line`; the round-2 "single-entry alias table" claim, which
  violated this by being unverified, was caught by the adversary pass and replaced with a
  grep-verified per-table survivor list before being accepted.
- `C-04` (enums over strings, deprecate-not-remove) — honored by: `TIMEFRAME_15MIN`/
  `TIMEFRAME_1HOUR` keep their field numbers, values, and enum membership — only a
  `[deprecated = true]` comment is added, mirroring the existing `TIMEFRAME_1MIN`/
  `TIMEFRAME_5MIN` precedent exactly.
- `C-05` (config key naming) — honored by: `marketdata.stream.bar_ingest_timeframe` is an
  existing key whose *value* narrows; no new key is introduced, no naming change.
- `C-09` (proto verification) — honored by: `/sdd-spec`'s proto step will run `buf lint`/
  `buf breaking` after the deprecation-comment change; confirmed non-breaking in recon
  (comment-only, no cardinality/type/number change).
- `C-14` (name the consumer surface) — honored by: `product-spec.md`'s Affected Services/
  Consumer Surface(s) sections were corrected during Phase 0 recon (before this debate) to
  include `xstockstrat-ingest`, `xstockstrat-agent`, and the second UI consumer
  (`positions/[symbol]/page.tsx`) that the original draft missed; this design's Chosen
  Approach explicitly reaches all three named surfaces (`/trader`, `/insights`,
  `trigger_backfill`), not just the backing `xstockstrat-marketdata` service.
- `P-02` (no lateral subagent coordination) — honored by: the proposer never saw the
  adversary's raw output in either round; only this document's synthesized state was passed
  forward between rounds.
- `P-03` (no silent deviation, escalate) — honored by: Phase 0 recon's ingest/agent scope gap
  was surfaced and `product-spec.md` corrected rather than silently carried forward; round 2's
  incorrect "single-entry" claim was caught and corrected rather than accepted on its
  plausible-sounding framing.
- `F-04` (never invent a path/symbol) — honored by: every file/line cited in this document
  traces to a `codebase-discovery`/adversary-verified digest; nothing here was invented.
- No `F-*` (Floor) item was flagged as violated or at-risk by either adversary pass — no
  Floor breach to record.

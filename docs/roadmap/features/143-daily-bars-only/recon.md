# Recon: daily-bars-only

**Created**: 2026-08-16
**From**: product-spec.md
**Affected services**: `xstockstrat-marketdata`, `xstockstrat-ui`, `packages/proto` (per product-spec) — **recon adds `xstockstrat-ingest` and `xstockstrat-agent`, not listed in product-spec.md** (see Risks below)

---

## Objective

Strip platform-wide support for non-daily (`15m`/`1h`) OHLCV timeframes: `GetBars`/
`BackfillBars` reject anything but `1d`, the always-on bar ingester only ever fetches `1d`,
and the UI's chart/backfill-trigger timeframe selectors drop the `15Min`/`1Hour` options —
since no trading-path consumer evaluates anything but daily bars.

## Codebase Map

- **`xstockstrat-marketdata`** (Go)
  - `GetBars` handler: `internal/service/marketdata_service.go:121` — resolves timeframe at
    `:133` (`timeframe.Resolve(req.GetTimeframeEnum(), legacyTf)`), no rejection today. A
    rejection check belongs after `:135` (`canonicalTf` set) and before `:166`'s `QueryBars`
    call — must also short-circuit `markWarm` (`:123`, feeds the ingester's warm-symbol set)
    and the live-fallback `fetchAndCacheBars` (`:177`).
  - `BackfillBars` handler: `marketdata_service.go:661` — resolves timeframe at `:689`, same
    pattern, no rejection. Check belongs after `:691`, before `emitEvent(...)` at `:693` and
    the per-symbol `src.GetBars` loop at `:706-707`.
  - `internal/timeframe` package: `internal/timeframe/timeframe.go` — `ToCanonical` (`:27`),
    `Interval` (`:45`), `FromString` (`:61`), `Resolve` (`:78`), `ComputeGaps` (`:101`). Every
    call site is inside `marketdata_service.go` (`:133,229,246,287,312,541,568,689`) plus one
    doc-comment reference (`internal/repository/marketdata_repo.go:156`) — nothing else in
    the repo depends on it resolving `15m`/`1h`.
  - Always-on ingester (post-`null-fundamentals-ohlcv-gaps`-fix state):
    `StartBarIngestPoller` (`marketdata_service.go:483`), `defaultBarIngestTimeframe`
    (`:520`, currently `"15m,1d"` — the value FR-3 narrows), `resolveIngestTimeframes`
    (`:530`), `minIngestLookback` (`:567`), `ingestRecentBars` (`:582`),
    `ingestRecentBarsForTimeframe` (`:614`).
  - Last migration: `003_canonicalize_ohlcv_timeframe.{up,down}.sql`
    (`services/xstockstrat-marketdata/migrations/`) — next would be `004`.
  - Config-read pattern: `ingestRecentBars` reads `marketdata.stream.bar_ingest_timeframe`
    live every cycle (`marketdata_service.go:596`).

- **`xstockstrat-ui`** (Next.js)
  - Entry points: `src/components/trader/ChartPanel.tsx` (chart timeframe tabs),
    `src/app/insights/backfills/page.tsx` (manual-backfill dropdown).
  - Shared primitives: `src/lib/chart.ts` — `Timeframe` type (`:11`), `TIMEFRAMES` options
    (`:13-17`), `TIMEFRAME_ENUM` map (`:23-27`, a `Record` — dropping a member fails `tsc`
    per its own comment at `:21-22`).
  - **Second consumer not named in product-spec.md**: `src/app/trader/positions/[symbol]/page.tsx`
    (`:11,94,156-157,244-245,338-339,357`) also imports `chart.ts`'s `Timeframe`/`TIMEFRAMES`/
    `TIMEFRAME_ENUM` and runs its own timeframe `Tabs` selector via the same
    `useCandlestickChart` shared-hook pattern as `ChartPanel.tsx`.
  - Config-read pattern: n/a (UI reads via Connect-RPC, not `WatchConfig`).

- **`packages/proto`**
  - `Timeframe` enum: `packages/proto/common/v1/common.proto:77-84`.
    ```
    enum Timeframe {
      TIMEFRAME_UNSPECIFIED = 0;
      TIMEFRAME_15MIN = 5; // smallest supported interval
      TIMEFRAME_1HOUR = 3;
      TIMEFRAME_1DAY = 4;
      TIMEFRAME_1MIN = 1 [deprecated = true]; // deprecated: sub-15m intervals removed from the product
      TIMEFRAME_5MIN = 2 [deprecated = true]; // deprecated: sub-15m intervals removed from the product
    }
    ```
    Exact deprecation syntax to mirror for FR-6: `<value> = <N> [deprecated = true]; //
    deprecated: <reason>` (`common.proto:82-83`).

- **`xstockstrat-ingest`** (Python) — **not in product-spec.md's Affected Services; recon finding**
  - `app/handlers/servicer.py:93` `_STR_TO_ENUM = {"15m": 5, "1h": 3, "1d": 4}`
  - `app/handlers/servicer.py:95-102` `_TF_ALIASES` (incl. `"15Min"`, `"1Hour"`)
  - `app/repositories/backfill_chunks.py:16` `_BARS_PER_DAY = {"15m": 26, "1h": 7, "1d": 1}`
  - `app/handlers/servicer.py:542-543` proxies to marketdata's `BackfillBars` — confirms
    ingest is a **caller**, not a re-implementation, but it validates/aliases the timeframe
    string independently before forwarding.

- **`xstockstrat-agent`** (Python, MCP) — **not in product-spec.md's Affected Services; recon finding**
  - `app/tools.py:860,868` — `trigger_backfill`'s `timeframe: str = "1d"` param + docstring
    `"one of 15m/15Min/1h/1Hour/1d/1Day"`.
  - `app/client.py:993-994,1024` — its own `_TF_ALIASES` / `_TF_TO_ENUM = {"15m": 5, "1h": 3,
    "1d": 4}`.

## Patterns to REUSE

- **RPC-layer rejection of an unsupported enum value** → no existing precedent found for
  rejecting a `Timeframe` value specifically; the closest analog is `resolveDeletePlan`'s
  scope/admin-gate rejection pattern (`marketdata_service.go` — returns a `connect.NewError`
  with `connect.CodeInvalidArgument`) used by `DeleteBackfilledData`. Reuse that
  `connect.CodeInvalidArgument` idiom rather than inventing a new error shape.
- **Comma-separated-list config parsing** → already built by the precursor fix:
  `resolveIngestTimeframes` (`marketdata_service.go:530`) is timeframe-count-agnostic —
  narrowing `defaultBarIngestTimeframe` to a one-element string (`"1d"`) requires **no**
  change to its parsing logic, only the constant's value.
- **Proto enum deprecation** → reuse the exact `TIMEFRAME_1MIN`/`TIMEFRAME_5MIN` precedent
  syntax at `common.proto:82-83` verbatim for `TIMEFRAME_15MIN`/`TIMEFRAME_1HOUR`.
- **Timeframe-scoped data migration** → `003_canonicalize_ohlcv_timeframe.up.sql`
  (`services/xstockstrat-marketdata/migrations/`) is the only precedent in this repo for a
  migration that `UPDATE`/`DELETE`s `marketdata.ohlcv` rows keyed by `timeframe`. It logs
  every touched row to a purpose-built audit table (`marketdata.ohlcv_remediation_003`,
  created lines 53-68) so `.down.sql` can reverse it, and documents required preconditions
  (no compressed chunks; quiesce `StartBarIngestPoller` first, since `timeframe` is a PK
  column with 60s-cadence concurrent writes). If the historical-data Open Question resolves
  toward deletion, this is the template to reuse, including the audit-log pattern.
- **UI test-data inventory (C-12)** → `e2e/fixtures/backfillJobs.ts`'s `backfillJob()`
  factory already defaults to `timeframe: '1d'`/`TIMEFRAME_1DAY` (no override to `15m`/`1h`
  found in any consumer) — no fixture change needed for FR-5's own tests, only assertion
  changes in `e2e/trader/chart-panel.spec.ts` (see Risks).

## Dependencies

- Proto/RPC: `Timeframe` enum (`common.proto:77-84`, deprecation-only, non-breaking);
  `GetBarsRequest`/`BackfillBarsRequest` (`packages/proto/marketdata/v1/marketdata.proto:83-114`,
  no field changes, just handler-level rejection logic).
- Migration: next number `004` for `services/xstockstrat-marketdata/migrations/` — **only if**
  the historical-data Open Question resolves toward deletion (see design.md).
- Config keys: `marketdata.stream.bar_ingest_timeframe` (existing key, default value changes
  `"15m,1d"` → `"1d"`).
- Inter-service edges: `xstockstrat-ingest` → `xstockstrat-marketdata` (`BackfillBars`,
  `app/handlers/servicer.py:542-543`) — ingest's own `_STR_TO_ENUM`/`_TF_ALIASES` tables sit
  in front of that call and would keep accepting `15m`/`1h` (and forwarding them to a
  marketdata that now rejects them) unless also updated. `xstockstrat-agent` →
  `xstockstrat-ingest` (`trigger_backfill` MCP tool, `app/client.py`) has the same gap one
  hop further out.
- New env vars / ports: none.

## Risks / Not-found

- **Scope gap (the headline finding): `xstockstrat-ingest` and `xstockstrat-agent` are not in
  product-spec.md's `## Affected Services`, but both maintain their own parallel
  `15m`/`1h`-aware alias/enum tables that feed into `BackfillBars`.** Left unfixed, a user
  could still request a `15m`/`1h` backfill through the `/insights/backfills` UI (if FR-5
  isn't airtight) or through the `trigger_backfill` MCP tool, have ingest/agent happily
  validate and forward it, and hit a newly-rejecting `BackfillBars` — a confusing
  `INVALID_ARGUMENT` several hops removed from where the user made the choice, or (if FR-5/UI
  changes ship but agent's tool doesn't) an MCP-only path to a timeframe the rest of the
  platform no longer supports. This must be resolved before `/sdd-spec` — either add
  `xstockstrat-ingest`/`xstockstrat-agent` to Affected Services with their own steps, or
  explicitly scope them Out of Scope with a stated reason (Constitution **P-03**: surface,
  never guess).
- **`positions/[symbol]/page.tsx` is a second, product-spec-unlisted UI consumer** of
  `lib/chart.ts`'s `Timeframe`/`TIMEFRAMES`/`TIMEFRAME_ENUM`, alongside the named
  `ChartPanel.tsx`. FR-4 as written only names `ChartPanel.tsx`/`lib/chart.ts` — since both
  files share the same module, a `chart.ts` change reaches both call sites automatically, but
  `/sdd-spec` should explicitly list `positions/[symbol]/page.tsx` in the step's `**Files**`
  or verification so it isn't silently missed as "already covered".
- **`e2e/trader/chart-panel.spec.ts` has two tests whose entire premise breaks under FR-4**:
  `renders the 3 supported timeframe buttons` (`:129-142`, asserts exactly `['15m','1h','1d']`
  are visible) and `sends timeframeEnum on the outbound GetBars request (AC-8)`
  (`:165-213`, clicks the `'1h'` tab to trigger its assertion — no `1h` tab means no way to
  trigger this test's mechanism at all). Both need rewriting, not just updating — the design
  phase should decide what `AC-8`'s test becomes when there is only one timeframe to select
  (asserting the `1d` tab is the sole state, and that `timeframeEnum` is still sent
  correctly, is the likely replacement).
- **`e2e/insights/backfills.spec.ts`** has no direct timeframe-option-text assertion (no
  `'1 hour'`/`'15 min'` literal found) — lower risk than the chart-panel spec, but should
  still be spot-checked once the dropdown's options list shrinks to one entry (a single-entry
  `<select>` may itself be worth removing per FR-5, which would change this spec's
  interaction pattern).
- **No CHECK-constraint/"narrow column domain" migration precedent exists anywhere in this
  repo** — only the string-rewrite/delete-by-value pattern in migration `003`. If the design
  wants a stronger DB-level guarantee (not just RPC-layer rejection) that no new `15m`/`1h`
  row can ever be inserted again, no existing template covers that; it would be a new pattern.
- **Known trap** (`docs/roadmap/ledger/fails.md`, 2026-07-29/30/08-06 —
  `080-fix-backfill-timeframe-enum`): this exact canonical-timeframe-string/enum area has
  produced multiple real defects before (raw-vs-canonicalized persistence order, an incorrect
  literal-occurrence-count assumption in a prior spec, a migration needing a careful
  remediation-log design). The same ledger's insight entry (2026-08-06) explicitly flags
  **"split into two features"** as a demonstrated failure mode for this area — carried
  forward from product-spec.md; still applies with the expanded (ingest/agent) scope.
- Not found: no evidence anything outside `marketdata_service.go` depends on
  `internal/timeframe.Resolve`/`Interval` continuing to resolve `15m`/`1h` — the package
  appears safely leave-alone-able (rejection can happen purely at the RPC layer using the
  still-resolvable canonical strings), consistent with product-spec.md's own Open Question
  framing.
- Not found: no `MARKETDATA-*` constitution invariant asserts `15m`/`1h` resolvability is
  load-bearing elsewhere; only `MARKETDATA-5` ("pollers re-read config every tick, `<=0` =
  pause") is directly relevant, and FR-3's change (narrowing the timeframe-list default)
  doesn't touch that mechanism.
- Not found: the Alpaca WS 1-minute stream (`internal/alpaca/stream.go:252-269`) is confirmed
  architecturally independent — it hardcodes `TimeframeEnum: TIMEFRAME_1MIN` directly, never
  calls `internal/timeframe` or the REST ingester, and streamed bars are never persisted.
  Removing `15m`/`1h` REST support requires no change here — this closes the product spec's
  "Alpaca WS 1-minute stream disposition" Open Question: leave it as-is.

## Recommended Scope

Advisory only — `/sdd-spec` and the grilling phase decide the actual steps.

1. **Proto**: deprecate `TIMEFRAME_15MIN`/`TIMEFRAME_1HOUR` (mirror `common.proto:82-83`
   syntax) + `buf-gen.sh`. One step.
2. **`xstockstrat-marketdata`**: `GetBars`/`BackfillBars` rejection (exact error contract per
   design.md), `defaultBarIngestTimeframe` narrowed to `"1d"`. Paired test step (Go, this
   service's CI threshold).
3. **`xstockstrat-ingest`**: update `_STR_TO_ENUM`/`_TF_ALIASES`/`_BARS_PER_DAY` to reject or
   drop `15m`/`1h` before they ever reach `BackfillBars` — closes the Risks-section scope gap.
   Paired test step.
4. **`xstockstrat-agent`**: update `trigger_backfill`'s param docstring/validation and
   `_TF_ALIASES`/`_TF_TO_ENUM` to match. Paired test step.
5. **`xstockstrat-ui`**: `lib/chart.ts` narrows `Timeframe`/`TIMEFRAMES`/`TIMEFRAME_ENUM`;
   `ChartPanel.tsx` + `positions/[symbol]/page.tsx` (both consumers) lose their
   `15Min`/`1Hour` options; `insights/backfills/page.tsx` dropdown narrows. Rewrite the two
   broken `chart-panel.spec.ts` tests; spot-check `backfills.spec.ts`. Paired test step(s).
6. **(Conditional) DB migration `004`**: only if the historical-data Open Question resolves
   toward deletion — reuse the `003` remediation-log template.

This is 5-6 steps across 4 services + proto — the ledger's "don't split into two features"
lesson argues for keeping this as ONE feature (already the plan) but does not preclude
multiple `/sdd-execute` steps within it.
